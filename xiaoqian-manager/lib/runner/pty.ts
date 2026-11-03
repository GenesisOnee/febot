import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import * as pty from "node-pty";
import * as headlessPkg from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { watch, type FSWatcher } from "chokidar";
import type {
  DiffFile,
  DiffSummary,
  FilePatch,
  PipelineRun,
  RunStatus,
  TimelineEvent,
} from "../domain/run";
import { isTerminalStatus } from "../domain/run";
import type {
  ServerEvent,
  ServerEventInput,
  ServerMessage,
  StartRunRequest,
} from "./protocol";
import {
  DATA_DIR,
  FEBOT_ROOT,
  RUNS_DIR,
  SAFE_ID,
  TEMP_DIR,
  doneMarker,
  eventsFile,
  planFile,
  runFile,
  wrapperFile,
} from "./paths";
import { acquireRepo, releaseRepo, rebuildRegistry, listRunFiles } from "./repos";
import { EventsTailer, readAllEvents } from "./events";
import { countChanged, headSha, listDiff, readPatch, rejectFile } from "./git";

// PTY 会话池：runner 独占。
//
// 生命周期与 Next 完全解耦：Next 重启不影响这里；runner 重启则所有进行中 run
// 一律 failed（ConPTY 句柄不可跨进程重挂，不做热恢复）。
//
// 输出/状态/时间线共享同一单调 seq（按 run 递增），用于断线补发。
// 输出另受 256KB 环形缓冲限制，滚出部分以「截断」快照替代。

// @xterm/headless 是 CJS 包且没有 exports 字段：ESM 下 Node 只暴露 default，
// 直接 `import { Terminal }` 会在运行时抛 "does not provide an export named 'Terminal'"。
type HeadlessTerminalCtor = typeof import("@xterm/headless").Terminal;
type HeadlessTerminalInstance = InstanceType<HeadlessTerminalCtor>;
const HeadlessTerminal: HeadlessTerminalCtor | undefined =
  (headlessPkg as unknown as { Terminal?: HeadlessTerminalCtor }).Terminal ??
  (headlessPkg as unknown as { default?: { Terminal?: HeadlessTerminalCtor } }).default
    ?.Terminal;

const OUTPUT_LIMIT_BYTES = 256 * 1024;
const OUTPUT_CHUNK_CHARS = 16 * 1024;
const HISTORY_LIMIT = 8000;
const DEFAULT_TIMEOUT_MS = 6 * 60 * 60 * 1000;
const APP_URL = process.env.XQ_APP_URL?.trim() || "http://127.0.0.1:3010";

export class RepoBusyError extends Error {
  occupant: string;
  constructor(occupant: string) {
    super(`仓库正被 #${occupant} 占用`);
    this.name = "RepoBusyError";
    this.occupant = occupant;
  }
}

export class RunNotFoundError extends Error {
  constructor(id: string) {
    super(`run 不存在：${id}`);
    this.name = "RunNotFoundError";
  }
}

interface HistoryEntry {
  seq: number;
  message: ServerEvent;
  outputBytes: number;
}

interface Session {
  run: PipelineRun;
  pty: pty.IPty | null;
  seq: number;
  history: HistoryEntry[];
  outputBytes: number;
  /** 环形缓冲是否丢弃过输出：attach 时据此如实标记 truncated */
  outputEvicted: boolean;
  /** 影子终端：只消费输出，attach 时序列化屏幕快照代替原始字节流回放 */
  headless: HeadlessTerminalInstance | null;
  serializer: SerializeAddon | null;
  /** 已入队但 headless 尚未处理完的写入数 */
  headlessPending: number;
  /** headless 消化完队列后要唤醒的 attach 等待者 */
  headlessWaiters: (() => void)[];
  tailer: EventsTailer | null;
  markerWatcher: FSWatcher | null;
  workspaceWatcher: FSWatcher | null;
  workspaceTimer: NodeJS.Timeout | null;
  timeoutTimer: NodeJS.Timeout | null;
  markerTimer: NodeJS.Timeout | null;
  /** 语义完成（done）或异常收口后置 true；PTY 仍可存活供用户继续查看/输入 */
  finalized: boolean;
  exited: boolean;
}

export type Broadcast = (runId: string, message: ServerMessage) => void;

function isDoneMarker(file: string): boolean {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8")) as { phase?: string };
    return json.phase === "done";
  } catch {
    return false;
  }
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, file);
}

function buildWrapper(taskId: string): string {
  // 只保留 claude 自检；退出码由 PTY onExit 直接拿到，不再落 .exit 文件。
  return [
    "@echo off",
    "where claude >nul 2>nul",
    "if errorlevel 1 (",
    "  echo [xiaoqian] 未找到 claude 命令，流水线未启动。",
    "  exit /b 127",
    ")",
    `call claude "/pipeline ${taskId}"`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

function chunkOutput(data: string): string[] {
  if (data.length <= OUTPUT_CHUNK_CHARS) return [data];
  const chunks: string[] = [];
  for (let i = 0; i < data.length; i += OUTPUT_CHUNK_CHARS) {
    chunks.push(data.slice(i, i + OUTPUT_CHUNK_CHARS));
  }
  return chunks;
}

export class RunManager {
  private sessions = new Map<string, Session>();

  constructor(
    private readonly broadcast: Broadcast,
    private readonly runnerToken: string
  ) {}

  // ---------- 启动 / 清扫 ----------

  /**
   * 启动清扫：非终态 run 一律置 interrupted（保留现场，供桌面端恢复），
   * 注册表从零重建。仅真实执行错误才由 finalize 置 failed。
   */
  cleanupStale(): number {
    let interrupted = 0;
    for (const file of listRunFiles()) {
      let run: PipelineRun;
      try {
        run = JSON.parse(fs.readFileSync(file, "utf8")) as PipelineRun;
      } catch {
        continue;
      }
      if (!run?.id || isTerminalStatus(run.status) || run.status === "interrupted") continue;
      run.status = "interrupted";
      run.error = "runner 重启（现场保留，可恢复会话）";
      run.endedAt = new Date().toISOString();
      run.pid = null;
      atomicWrite(file, JSON.stringify(run, null, 2));
      interrupted += 1;
    }
    rebuildRegistry([]);
    return interrupted;
  }

  start(req: StartRunRequest): PipelineRun {
    const taskId = req.taskId;
    if (!SAFE_ID.test(taskId)) throw new Error(`任务 ID 含不支持的字符：${taskId}`);
    const existing = this.sessions.get(taskId);
    if (existing) {
      // 同任务重跑：上一个 PTY 还活着说明会话仍在使用；已退出则丢弃旧会话，
      // 终态数据在 data/runs 里，重放不受影响。
      if (!existing.exited) throw new RepoBusyError(taskId);
      this.disposeHeadless(existing);
      this.sessions.delete(taskId);
    }

    const baseSha = headSha(req.repoRoot); // 失败则不占用仓库

    const acquire = acquireRepo(req.repoKey, req.repoRoot, taskId);
    if (!acquire.ok) throw new RepoBusyError(acquire.occupant ?? "unknown");

    const now = new Date().toISOString();
    const timeoutMs = Number(process.env.XQ_RUN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
    const run: PipelineRun = {
      id: taskId,
      taskId,
      repoRoot: req.repoRoot,
      repoKey: req.repoKey,
      baseSha,
      status: "starting",
      pid: null,
      cols: Math.max(20, Math.min(400, req.cols || 120)),
      rows: Math.max(5, Math.min(200, req.rows || 32)),
      startedAt: now,
      endedAt: null,
      exitCode: null,
      error: null,
      eventsFile: eventsFile(taskId),
      changedFiles: 0,
      acceptedAt: null,
      settledAt: null,
      timeoutAt: new Date(Date.now() + timeoutMs).toISOString(),
    };

    const session: Session = {
      run,
      pty: null,
      seq: 0,
      history: [],
      outputBytes: 0,
      outputEvicted: false,
      headless: null,
      serializer: null,
      headlessPending: 0,
      headlessWaiters: [],
      tailer: null,
      markerWatcher: null,
      workspaceWatcher: null,
      workspaceTimer: null,
      timeoutTimer: null,
      markerTimer: null,
      finalized: false,
      exited: false,
    };
    this.sessions.set(taskId, session);

    try {
      this.prepareFiles(taskId, req.planContent);
      this.persist(session);
      this.spawnPty(session);
    } catch (e) {
      this.sessions.delete(taskId);
      releaseRepo(req.repoKey, taskId);
      this.cleanupFiles(taskId);
      throw e;
    }

    return run;
  }

  private prepareFiles(taskId: string, planContent: string): void {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    // 上一轮（dev 重启/异常）可能残留完成标记：先清掉，避免旧标记直接判成功
    for (const f of [doneMarker(taskId), eventsFile(taskId)]) {
      fs.rmSync(f, { force: true });
    }
    atomicWrite(planFile(taskId), planContent);
    atomicWrite(wrapperFile(taskId), buildWrapper(taskId));
  }

  private spawnPty(session: Session): void {
    const { run } = session;
    this.initHeadless(session);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    env.TERM = "xterm-256color";
    env.XQ_EVENTS_FILE = run.eventsFile;

    const child = pty.spawn("cmd.exe", ["/d", "/c", wrapperFile(run.taskId)], {
      name: "xterm-color",
      cwd: FEBOT_ROOT,
      cols: run.cols,
      rows: run.rows,
      env,
    });
    session.pty = child;
    run.pid = child.pid;
    run.status = "running";
    this.persist(session);
    this.emit(session, {
      type: "status",
      runId: run.id,
      seq: 0,
      status: "running",
      pid: run.pid,
      changedFiles: run.changedFiles,
    });

    child.onData((data) => {
      this.writeHeadless(session, data);
      for (const chunk of chunkOutput(data)) {
        this.emit(session, { type: "output", runId: run.id, seq: 0, data: chunk });
      }
    });

    child.onExit(({ exitCode }) => {
      session.exited = true;
      session.pty = null;
      session.run.pid = null;
      session.run.exitCode = exitCode;
      if (!session.finalized) {
        const ok = isDoneMarker(doneMarker(run.taskId));
        this.finalize(
          session,
          ok ? "done" : "failed",
          ok ? null : this.noteForExit(exitCode)
        );
      }
      this.emit(session, { type: "exit", runId: run.id, seq: 0, exitCode });
      this.persist(session);
      void this.stopWatching(session);
    });

    this.startWatching(session);
    session.timeoutTimer = setTimeout(() => {
      if (session.finalized) return;
      this.finalize(session, "failed", "会话超时（默认 6h）");
      this.killProcess(session);
    }, Number(process.env.XQ_RUN_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS);
  }

  // ---------- 影子终端（屏幕快照） ----------

  /** 影子终端只消费输出，作为 attach 时序列化屏幕状态的唯一事实源。失败则退回原始回放。 */
  private initHeadless(session: Session): void {
    try {
      if (!HeadlessTerminal) throw new Error("@xterm/headless 未导出 Terminal");
      const term = new HeadlessTerminal({
        cols: session.run.cols,
        rows: session.run.rows,
        scrollback: 8000,
        allowProposedApi: true,
      });
      const serializer = new SerializeAddon();
      term.loadAddon(serializer as unknown as Parameters<typeof term.loadAddon>[0]);
      // 必须和浏览器端用同一张字符宽度表，否则快照里 CJK 的列位置对不上
      term.loadAddon(
        new Unicode11Addon() as unknown as Parameters<typeof term.loadAddon>[0]
      );
      term.unicode.activeVersion = "11";
      session.headless = term;
      session.serializer = serializer;
    } catch (e) {
      console.error("[pty] 影子终端初始化失败，回退到原始输出回放", e);
      session.headless = null;
      session.serializer = null;
    }
  }

  private writeHeadless(session: Session, data: string): void {
    const term = session.headless;
    if (!term || data.length === 0) return;
    session.headlessPending += 1;
    term.write(data, () => {
      session.headlessPending = Math.max(0, session.headlessPending - 1);
      if (session.headlessPending === 0 && session.headlessWaiters.length > 0) {
        const waiters = session.headlessWaiters.splice(0);
        for (const wake of waiters) wake();
      }
    });
  }

  /**
   * 等影子终端消化完已入队的输出后，序列化「滚动缓冲 + 当前屏幕」。
   * 返回 null 表示影子终端不可用，调用方退回原始输出回放。
   */
  private async serializeScreen(session: Session): Promise<string | null> {
    if (!session.headless || !session.serializer) return null;
    if (session.headlessPending > 0) {
      // 输出持续涌入时最多等 300ms：宁可少最后几帧，也不能卡住 attach
      await Promise.race([
        new Promise<void>((resolve) => session.headlessWaiters.push(resolve)),
        new Promise<void>((resolve) => setTimeout(resolve, 300)),
      ]);
    }
    try {
      // 限制回放体积：只带最近 2000 行滚动缓冲
      return session.serializer.serialize({ scrollback: 2000 });
    } catch (e) {
      console.error("[pty] 屏幕序列化失败", e);
      return null;
    }
  }

  private disposeHeadless(session: Session): void {
    const term = session.headless;
    session.headless = null;
    session.serializer = null;
    const waiters = session.headlessWaiters.splice(0);
    for (const wake of waiters) wake();
    try {
      term?.dispose();
    } catch {
      // 已释放
    }
  }

  private noteForExit(code: number | null): string {
    if (code === 127) return "未找到 claude 命令（会话内启动失败）";
    if (code === null) return "Claude 已退出，退出码无法解析，且未产出完成标记";
    return `Claude 退出码 ${code}，且未产出完成标记（流水线未走到 done）`;
  }

  private startWatching(session: Session): void {
    const { run } = session;
    const marker = doneMarker(run.taskId);
    session.tailer = new EventsTailer(run.eventsFile, (event) =>
      this.onTimelineEvent(session, event)
    );
    session.tailer.start();

    // done 标记由剧本在收尾最后一步写入；claude 结束后仍可能停在交互提示符，
    // 所以不能等 onExit，必须监听标记本身。
    const markerExists = () => {
      if (session.finalized) return;
      if (isDoneMarker(marker)) this.finalize(session, "done", null);
    };
    try {
      session.markerWatcher = watch(marker, { ignoreInitial: false, persistent: true });
      session.markerWatcher.on("add", markerExists);
      session.markerWatcher.on("change", markerExists);
    } catch {
      // 监听失败时退回轮询
    }
    session.markerTimer = setInterval(markerExists, 2000);

    this.startWorkspaceWatch(session);
  }

  private startWorkspaceWatch(session: Session): void {
    const { run } = session;
    try {
      session.workspaceWatcher = watch(run.repoRoot, {
        ignoreInitial: true,
        persistent: true,
        ignored: /(^|[\/\\])(\.git|node_modules|\.next|dist|data)([\/\\]|$)/,
      });
      const refresh = () => {
        if (session.finalized) return;
        if (session.workspaceTimer) clearTimeout(session.workspaceTimer);
        session.workspaceTimer = setTimeout(() => {
          try {
            const changed = countChanged(run.repoRoot, run.baseSha);
            run.changedFiles = changed;
            this.persist(session);
            this.emit(session, { type: "git", runId: run.id, seq: 0, changed });
          } catch {
            // git 暂时不可用（例如用户正在切分支）忽略这一轮
          }
        }, 300);
      };
      session.workspaceWatcher.on("add", refresh);
      session.workspaceWatcher.on("change", refresh);
      session.workspaceWatcher.on("unlink", refresh);
    } catch (e) {
      console.error("[pty] 工作区监听失败", run.repoRoot, e);
    }
  }

  private onTimelineEvent(session: Session, event: TimelineEvent): void {
    this.emit(session, { type: "timeline", runId: session.run.id, seq: 0, event });
    if (event.type === "wait") {
      if (event.status === "waiting" && session.run.status === "running") {
        this.setStatus(session, "needs_input");
      } else if (event.status === "done" && session.run.status === "needs_input") {
        this.setStatus(session, "running");
      }
    }
    if (event.type === "done" && !session.finalized) {
      this.finalize(session, "done", null);
    }
  }

  private setStatus(session: Session, status: RunStatus): void {
    if (session.run.status === status) return;
    session.run.status = status;
    this.persist(session);
    this.emit(session, {
      type: "status",
      runId: session.run.id,
      seq: 0,
      status,
      pid: session.run.pid,
      changedFiles: session.run.changedFiles,
    });
  }

  /** 收口：写终态、释放仓库、回调 Next。幂等。 */
  private finalize(session: Session, status: RunStatus, note: string | null): void {
    if (session.finalized) return;
    const { run } = session;
    session.finalized = true;
    run.status = status;
    run.error = status === "failed" || status === "interrupted" ? note : null;
    run.endedAt = run.endedAt ?? new Date().toISOString();
    try {
      run.changedFiles = countChanged(run.repoRoot, run.baseSha);
    } catch {
      // 保留旧值
    }
    releaseRepo(run.repoKey, run.id);
    this.persist(session);
    this.emit(session, {
      type: "status",
      runId: run.id,
      seq: 0,
      status,
      pid: run.pid,
      changedFiles: run.changedFiles,
    });
    if (session.workspaceTimer) {
      clearTimeout(session.workspaceTimer);
      session.workspaceTimer = null;
    }
    void this.stopWorkspaceWatch(session);
    void this.notifySettled(run.id, {
      ok: status === "done",
      note: note ?? "",
      exitCode: run.exitCode,
    });
  }

  private async stopWorkspaceWatch(session: Session): Promise<void> {
    if (session.workspaceWatcher) {
      try {
        await session.workspaceWatcher.close();
      } catch {
        // ignore
      }
      session.workspaceWatcher = null;
    }
  }

  private async stopWatching(session: Session): Promise<void> {
    if (session.markerTimer) {
      clearInterval(session.markerTimer);
      session.markerTimer = null;
    }
    if (session.timeoutTimer) {
      clearTimeout(session.timeoutTimer);
      session.timeoutTimer = null;
    }
    if (session.markerWatcher) {
      try {
        await session.markerWatcher.close();
      } catch {
        // ignore
      }
      session.markerWatcher = null;
    }
    if (session.tailer) {
      await session.tailer.stop();
      session.tailer = null;
    }
    await this.stopWorkspaceWatch(session);
  }

  private async notifySettled(runId: string, body: {
    ok: boolean;
    note: string;
    exitCode: number | null;
  }): Promise<void> {
    const url = `${APP_URL}/api/internal/runs/${encodeURIComponent(runId)}/settled`;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-internal-token": this.runnerToken,
          },
          body: JSON.stringify(body),
        });
        if (res.ok) {
          const session = this.sessions.get(runId);
          if (session) {
            session.run.settledAt = new Date().toISOString();
            this.persist(session);
          }
          return;
        }
        console.error("[pty] 收口回调失败", runId, res.status);
      } catch (e) {
        console.error("[pty] 收口回调异常", runId, e instanceof Error ? e.message : e);
      }
      await new Promise((r) => setTimeout(r, Math.min(30_000, 1000 * 2 ** attempt)));
    }
  }

  // ---------- 事件 / 缓冲 ----------

  private emit(session: Session, message: ServerEventInput): void {
    session.seq += 1;
    const full = { ...message, seq: session.seq } as ServerEvent;
    const bytes =
      full.type === "output" ? Buffer.byteLength(full.data, "utf8") : 0;
    session.history.push({ seq: full.seq, message: full, outputBytes: bytes });
    if (bytes) session.outputBytes += bytes;
    this.evict(session);
    this.broadcast(session.run.id, full);
  }

  private evict(session: Session): void {
    while (session.outputBytes > OUTPUT_LIMIT_BYTES) {
      const idx = session.history.findIndex((h) => h.message.type === "output");
      if (idx === -1) break;
      const [removed] = session.history.splice(idx, 1);
      session.outputBytes -= removed.outputBytes;
      session.outputEvicted = true;
    }
    if (session.history.length > HISTORY_LIMIT) {
      const removed = session.history.splice(0, session.history.length - HISTORY_LIMIT);
      if (removed.some((h) => h.message.type === "output")) {
        session.outputEvicted = true;
      }
    }
  }

  /**
   * attach 补发。
   * - 还能按 seq 续传：增量补发（全部类型）。
   * - 不能续传（首次接入 / 缺失区间已滚出缓冲）：用影子终端的屏幕快照代替原始字节流回放。
   *   影子终端不可用时退回原始输出回放。
   */
  async replay(
    runId: string,
    lastSeq?: number
  ): Promise<{ messages: ServerMessage[]; truncated: boolean }> {
    const session = this.sessions.get(runId);
    if (!session) {
      // 历史 run（runner 重启前 / 已收口）：没有内存缓冲，只回快照，
      // 时间线走 GET /runs/:id/events，不依赖 WS。
      const run = this.get(runId);
      if (!run) return { messages: [], truncated: false };
      return {
        messages: [{ type: "snapshot", runId, seq: 0, run, truncated: false }],
        truncated: false,
      };
    }
    const snapshot = (truncated: boolean, screen?: string): ServerMessage => ({
      type: "snapshot",
      runId,
      seq: session.seq,
      run: session.run,
      truncated,
      ...(screen !== undefined ? { screen } : {}),
    });

    const firstSeq = session.history[0]?.seq ?? session.seq + 1;
    if (lastSeq === undefined || lastSeq < firstSeq - 1) {
      // TUI 的增量重绘依赖输出发出时的屏幕状态，原始字节流不能安全重放。
      const screen = await this.serializeScreen(session);
      if (screen !== null) {
        const truncated = session.outputEvicted;
        return { messages: [snapshot(truncated, screen)], truncated };
      }
      // 兜底：影子终端不可用，退回原始输出回放。
      // 客户端有 lastSeq 说明它手里已有旧内容，必须 reset，避免重复写入。
      const truncated = session.outputEvicted || lastSeq !== undefined;
      const messages: ServerMessage[] = [snapshot(truncated)];
      for (const entry of session.history) {
        if (entry.message.type !== "output") continue;
        messages.push({
          ...entry.message,
          seq: entry.seq,
          replay: true,
        } as ServerMessage);
      }
      return { messages, truncated };
    }

    const messages: ServerMessage[] = [snapshot(false)];
    for (const entry of session.history) {
      if (entry.seq > lastSeq) messages.push(entry.message);
    }
    return { messages, truncated: false };
  }

  // ---------- 操作 ----------

  input(runId: string, data: string): void {
    const session = this.sessions.get(runId);
    if (!session?.pty) throw new Error("会话未运行");
    session.pty.write(data);
  }

  resize(runId: string, cols: number, rows: number): void {
    const session = this.sessions.get(runId);
    if (!session) return;
    session.run.cols = Math.max(20, Math.min(400, cols));
    session.run.rows = Math.max(5, Math.min(200, rows));
    try {
      session.pty?.resize(session.run.cols, session.run.rows);
    } catch {
      // PTY 已退出
    }
    // 影子终端必须跟 PTY 同尺寸，否则序列化出的快照行列错位
    try {
      session.headless?.resize(session.run.cols, session.run.rows);
    } catch {
      // 已释放
    }
    this.persist(session);
  }

  cancel(runId: string): PipelineRun {
    const session = this.sessions.get(runId);
    if (!session) throw new RunNotFoundError(runId);
    this.finalize(session, "cancelled", "人工终止");
    this.killProcess(session);
    return session.run;
  }

  private killProcess(session: Session): void {
    const child = session.pty;
    if (!child) return;
    const pid = child.pid;
    try {
      child.kill();
    } catch {
      // 已退出
    }
    // ConPTY 下偶有进程树残留，兜底 taskkill
    setTimeout(() => {
      if (session.exited) return;
      try {
        execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
          stdio: "ignore",
        });
      } catch {
        // 进程已不存在
      }
    }, 2000);
  }

  accept(runId: string): PipelineRun {
    const run = this.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    run.acceptedAt = new Date().toISOString();
    const session = this.sessions.get(runId);
    if (session) this.persist(session);
    else atomicWrite(runFile(runId), JSON.stringify(run, null, 2));
    return run;
  }

  reject(
    runId: string,
    paths: string[]
  ): { path: string; action: "deleted" | "restored" }[] {
    const run = this.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    const files = listDiff(run.repoRoot, run.baseSha);
    const results: { path: string; action: "deleted" | "restored" }[] = [];
    for (const p of paths) {
      const file = files.find((f) => f.path === p);
      if (!file) throw new Error(`工作区没有该路径的改动：${p}`);
      results.push({ path: p, ...rejectFile(run.repoRoot, run.baseSha, file) });
    }
    void this.notifyTrajectory(runId, {
      operator: "人工",
      action: "驳回文件",
      content: results.map((r) => `${r.path}（${r.action === "deleted" ? "删除" : "还原"}）`).join("、"),
    });
    const session = this.sessions.get(runId);
    if (session) {
      try {
        run.changedFiles = countChanged(run.repoRoot, run.baseSha);
        this.persist(session);
        this.emit(session, { type: "git", runId, seq: 0, changed: run.changedFiles });
      } catch {
        // ignore
      }
    }
    return results;
  }

  private async notifyTrajectory(
    runId: string,
    body: { operator: string; action: string; content: string }
  ): Promise<void> {
    const url = `${APP_URL}/api/internal/runs/${encodeURIComponent(runId)}/trajectory`;
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-internal-token": this.runnerToken,
        },
        body: JSON.stringify(body),
      });
    } catch (e) {
      console.error("[pty] 轨迹回写失败", runId, e instanceof Error ? e.message : e);
    }
  }

  // ---------- 查询 ----------

  get(runId: string): PipelineRun | null {
    const session = this.sessions.get(runId);
    if (session) return session.run;
    try {
      return JSON.parse(fs.readFileSync(runFile(runId), "utf8")) as PipelineRun;
    } catch {
      return null;
    }
  }

  list(): PipelineRun[] {
    const byId = new Map<string, PipelineRun>();
    for (const file of listRunFiles()) {
      try {
        const run = JSON.parse(fs.readFileSync(file, "utf8")) as PipelineRun;
        if (run?.id) byId.set(run.id, run);
      } catch {
        // 跳过坏文件
      }
    }
    for (const [id, session] of this.sessions) byId.set(id, session.run);
    return [...byId.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  events(runId: string): TimelineEvent[] {
    const run = this.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    return readAllEvents(run.eventsFile);
  }

  diff(runId: string): DiffSummary {
    const run = this.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    return { baseSha: run.baseSha, files: listDiff(run.repoRoot, run.baseSha) };
  }

  patch(runId: string, relPath: string): FilePatch {
    const run = this.get(runId);
    if (!run) throw new RunNotFoundError(runId);
    const files = listDiff(run.repoRoot, run.baseSha);
    const file: DiffFile | undefined = files.find((f) => f.path === relPath);
    if (!file) throw new Error(`工作区没有该路径的改动：${relPath}`);
    return readPatch(run.repoRoot, run.baseSha, relPath, file);
  }

  // ---------- 持久化 ----------

  private persist(session: Session): void {
    try {
      atomicWrite(runFile(session.run.id), JSON.stringify(session.run, null, 2));
    } catch (e) {
      console.error("[pty] run 持久化失败", session.run.id, e);
    }
  }

  private cleanupFiles(taskId: string): void {
    for (const f of [doneMarker(taskId), planFile(taskId), wrapperFile(taskId)]) {
      try {
        fs.rmSync(f, { force: true });
      } catch {
        // ignore
      }
    }
  }

  /**
   * 应用/runner 正常收尾：进行中的 run 落盘为 interrupted（不是 failed），
   * 保留输出与事件现场，下次启动可恢复。仅进程内真实执行错误才 failed。
   */
  async shutdown(note = "应用退出（现场保留，可恢复会话）"): Promise<void> {
    for (const session of this.sessions.values()) {
      if (!session.finalized) {
        this.finalize(session, "interrupted", note);
      }
      this.killProcess(session);
      this.disposeHeadless(session);
      await this.stopWatching(session);
    }
    this.sessions.clear();
  }

  /** 供 httP 层使用的随机 token 生成（保持单点） */
  static newToken(): string {
    return crypto.randomBytes(24).toString("hex");
  }
}

export function ensureDataDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

export type { PipelineRun as RunnerRun };
