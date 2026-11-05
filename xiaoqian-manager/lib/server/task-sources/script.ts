import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  CompleteMode,
  RawTask,
  TaskSource,
  TaskSourceCompleteResult,
  TaskSourceContext,
  TaskSourceSummary,
} from "@/lib/domain/task-source";
import type { Task, TaskHandler, TrajectoryItem } from "@/lib/domain/schema";
import { DATA_DIR } from "@/lib/server/workspace";

// 自定义 Node 脚本来源：读取 febot.source.json，独立子进程执行拉取/完成脚本。
//
// 安全边界：
//   - 只支持 runtime: "node"
//   - shell: false，独立进程，清理敏感环境变量
//   - 超时 + stdout/stderr 截断
//   - 只接受白名单输出字段

export const SOURCES_DIR = path.join(DATA_DIR, "task-sources");

export interface SourceManifest {
  name: string;
  runtime: "node";
  entry: string;
  timeoutMs: number;
  maxOutputBytes: number;
  input: string[];
  complete?: {
    entry: string;
    timeoutMs: number;
    mode: CompleteMode;
    input: string[];
  };
}

export interface LastRun {
  ok: boolean;
  at: string;
  message?: string;
  fetched?: number;
}

export function sourceDir(sourceId: string): string {
  return path.join(SOURCES_DIR, sourceId);
}

export function currentDir(sourceId: string): string {
  return path.join(sourceDir(sourceId), "current");
}

export function versionsDir(sourceId: string): string {
  return path.join(sourceDir(sourceId), "versions");
}

export function lastRunPath(sourceId: string): string {
  return path.join(sourceDir(sourceId), "last-run.json");
}

export function isSafeSourceId(sourceId: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(sourceId) && !sourceId.includes("..");
}

/** 相对路径安全校验：拒绝绝对路径、盘符、..、空段 */
export function safeRelativePath(input: string): string | null {
  const s = String(input ?? "").replace(/\\/g, "/").trim();
  if (!s) return null;
  if (s.startsWith("/") || /^[A-Za-z]:/.test(s)) return null;
  const parts = s.split("/");
  if (parts.some((p) => p === "" || p === "." || p === "..")) return null;
  return parts.join("/");
}

function resolveInside(dir: string, rel: string): string {
  const full = path.resolve(dir, rel);
  const relCheck = path.relative(path.resolve(dir), full);
  if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
    throw new Error(`脚本路径越界：${rel}`);
  }
  return full;
}

export function readManifest(sourceId: string): SourceManifest | null {
  if (!isSafeSourceId(sourceId)) return null;
  return readManifestAt(currentDir(sourceId));
}

/** 从任意目录读取并校验 manifest（上传落盘前先在临时目录里校验） */
export function readManifestAt(dir: string): SourceManifest | null {
  const file = path.join(dir, "febot.source.json");
  if (!fs.existsSync(file)) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  } catch {
    throw new Error(`febot.source.json 不是合法 JSON：${dir}`);
  }
  const str = (v: unknown, fallback = "") => (typeof v === "string" ? v.trim() : fallback);
  const num = (v: unknown, fallback: number) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
  const runtime = str(raw.runtime, "node");
  if (runtime !== "node") throw new Error(`只支持 runtime: "node"（当前：${runtime}）`);

  const entry = safeRelativePath(str(raw.entry));
  if (!entry) throw new Error("febot.source.json 缺少合法 entry");
  if (!fs.existsSync(resolveInside(dir, entry))) {
    throw new Error(`入口文件不存在：${entry}`);
  }

  let complete: SourceManifest["complete"];
  if (raw.complete && typeof raw.complete === "object" && !Array.isArray(raw.complete)) {
    const c = raw.complete as Record<string, unknown>;
    const cEntry = safeRelativePath(str(c.entry));
    if (!cEntry) throw new Error("complete.entry 不合法");
    if (!fs.existsSync(resolveInside(dir, cEntry))) {
      throw new Error(`完成脚本不存在：${cEntry}`);
    }
    const modeRaw = str(c.mode, "optional");
    const mode: CompleteMode =
      modeRaw === "required" || modeRaw === "none" || modeRaw === "optional" ? modeRaw : "optional";
    complete = {
      entry: cEntry,
      timeoutMs: num(c.timeoutMs, 60_000),
      mode,
      input: Array.isArray(c.input) ? c.input.map(String) : [],
    };
  }

  return {
    name: str(raw.name, path.basename(dir)),
    runtime: "node",
    entry,
    timeoutMs: num(raw.timeoutMs, 60_000),
    maxOutputBytes: num(raw.maxOutputBytes, 2 * 1024 * 1024),
    input: Array.isArray(raw.input) ? raw.input.map(String) : [],
    ...(complete ? { complete } : {}),
  };
}

interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

function runNodeScript(opts: {
  cwd: string;
  entry: string;
  input: unknown;
  timeoutMs: number;
  maxOutputBytes: number;
}): Promise<ExecResult> {
  return new Promise((resolve) => {
    // 子进程只拿到最小环境：不带口令、令牌等父进程环境变量
    const env = {
      PATH: process.env.PATH ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      FEBOT_INPUT: JSON.stringify(opts.input ?? {}),
    } as unknown as NodeJS.ProcessEnv;
    const child = spawn(process.execPath, [opts.entry], {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let truncated = false;
    let finished = false;

    const append = (current: string, chunk: string): string => {
      if (current.length >= opts.maxOutputBytes) {
        truncated = true;
        return current;
      }
      const remain = opts.maxOutputBytes - current.length;
      const next = chunk.length > remain ? chunk.slice(0, remain) : chunk;
      if (chunk.length > remain) truncated = true;
      return current + next;
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = append(stderr, chunk);
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {
        // ignore
      }
    }, opts.timeoutMs);

    const done = (code: number | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut, truncated });
    };

    child.on("error", (e) => {
      stderr = append(stderr, e instanceof Error ? e.message : String(e));
      done(-1);
    });
    child.on("close", (code) => done(code));

    try {
      child.stdin.write(JSON.stringify(opts.input ?? {}));
      child.stdin.end();
    } catch {
      // 脚本不读 stdin 也无妨
    }
  });
}

function parseJsonOutput(stdout: string): unknown {
  const text = stdout.trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // 有些脚本会打印日志；取最后一行 JSON
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        return JSON.parse(lines[i]);
      } catch {
        // continue
      }
    }
    return null;
  }
}

function strField(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  return v;
}

function arrOfStrings(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function trajectoryOf(v: unknown): TrajectoryItem[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TrajectoryItem[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    out.push({
      time: String(o.time ?? ""),
      operator: String(o.operator ?? ""),
      action: String(o.action ?? ""),
      content: String(o.content ?? ""),
    });
  }
  return out;
}

function handlersOf(v: unknown): TaskHandler[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: TaskHandler[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    out.push({
      taskId: String(o.taskId ?? ""),
      username: String(o.username ?? ""),
      status: String(o.status ?? ""),
    });
  }
  return out;
}

/** 白名单：只接受契约字段，未知字段丢弃 */
function toRawTask(item: unknown): RawTask | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const o = item as Record<string, unknown>;
  const externalId = String(o.externalId ?? "").trim();
  const title = String(o.title ?? "").trim();
  if (!externalId || !title) return null;
  return {
    externalId,
    title,
    ...(strField(o.module) !== undefined ? { module: String(o.module) } : {}),
    ...(strField(o.assignee) !== undefined ? { assignee: String(o.assignee) } : {}),
    ...(strField(o.customerName) !== undefined ? { customerName: String(o.customerName) } : {}),
    ...(strField(o.twStatus) !== undefined ? { twStatus: String(o.twStatus) } : {}),
    ...(strField(o.demandId) !== undefined ? { demandId: String(o.demandId) } : {}),
    ...(strField(o.demandLevel) !== undefined ? { demandLevel: String(o.demandLevel) } : {}),
    ...(strField(o.description) !== undefined ? { description: String(o.description) } : {}),
    ...(strField(o.assignDescription) !== undefined
      ? { assignDescription: String(o.assignDescription) }
      : {}),
    ...(arrOfStrings(o.attachments) ? { attachments: arrOfStrings(o.attachments) } : {}),
    ...(handlersOf(o.handlers) ? { handlers: handlersOf(o.handlers) } : {}),
    ...(trajectoryOf(o.trajectory) ? { trajectory: trajectoryOf(o.trajectory) } : {}),
    ...(strField(o.createdName) !== undefined ? { createdName: String(o.createdName) } : {}),
    ...(strField(o.createdTime) !== undefined ? { createdTime: String(o.createdTime) } : {}),
  };
}

export function readLastRun(sourceId: string): LastRun | null {
  try {
    return JSON.parse(fs.readFileSync(lastRunPath(sourceId), "utf8")) as LastRun;
  } catch {
    return null;
  }
}

export function writeLastRun(sourceId: string, run: LastRun): void {
  try {
    fs.mkdirSync(sourceDir(sourceId), { recursive: true });
    fs.writeFileSync(lastRunPath(sourceId), JSON.stringify(run, null, 2), "utf8");
  } catch {
    // 摘要写失败不影响主流程
  }
}

export function createScriptSource(sourceId: string): TaskSource {
  const manifest = readManifest(sourceId);
  if (!manifest) throw new Error(`自定义来源不存在或缺少 manifest：${sourceId}`);
  const id = sourceId;
  return {
    id,
    name: manifest.name,
    kind: "script",
    completeMode: manifest.complete?.mode ?? "optional",
    hasComplete: Boolean(manifest.complete),

    async fetchTasks(ctx: TaskSourceContext): Promise<RawTask[]> {
      const dir = currentDir(id);
      const result = await runNodeScript({
        cwd: dir,
        entry: manifest.entry,
        input: ctx.params,
        timeoutMs: manifest.timeoutMs,
        maxOutputBytes: manifest.maxOutputBytes,
      });
      if (result.timedOut) {
        writeLastRun(id, { ok: false, at: new Date().toISOString(), message: "脚本超时" });
        throw new Error(`拉取脚本超时（>${manifest.timeoutMs}ms）`);
      }
      if (result.code !== 0) {
        const detail = (result.stderr || result.stdout).trim().slice(0, 500);
        writeLastRun(id, {
          ok: false,
          at: new Date().toISOString(),
          message: detail || `退出码 ${result.code}`,
        });
        throw new Error(`拉取脚本失败（退出码 ${result.code}）：${detail}`);
      }
      const json = parseJsonOutput(result.stdout);
      const list = json && typeof json === "object" && Array.isArray((json as { tasks?: unknown }).tasks)
        ? ((json as { tasks: unknown[] }).tasks)
        : null;
      if (!list) {
        writeLastRun(id, {
          ok: false,
          at: new Date().toISOString(),
          message: "输出不是 { tasks: [...] }",
        });
        throw new Error("拉取脚本输出不是 { tasks: [...] }");
      }
      const tasks = list.map(toRawTask).filter((t): t is RawTask => t !== null);
      writeLastRun(id, {
        ok: true,
        at: new Date().toISOString(),
        fetched: tasks.length,
        message: `解析 ${tasks.length} 条`,
      });
      return tasks;
    },

    async complete(task: Task): Promise<TaskSourceCompleteResult> {
      if (!manifest.complete) {
        return { ok: true, message: "仅本地完成（未配置完成同步脚本）" };
      }
      const result = await runNodeScript({
        cwd: currentDir(id),
        entry: manifest.complete.entry,
        input: {
          action: "complete",
          taskId: task.id,
          externalId: task.externalId,
          title: task.title,
          module: task.module,
          plannedDescription: task.plannedDescription,
          completedAt: new Date().toISOString(),
        },
        timeoutMs: manifest.complete.timeoutMs,
        maxOutputBytes: manifest.maxOutputBytes,
      });
      if (result.timedOut) {
        return { ok: false, message: "完成脚本超时" };
      }
      if (result.code !== 0) {
        return {
          ok: false,
          message: `完成脚本失败（退出码 ${result.code}）：${(result.stderr || result.stdout).trim().slice(0, 300)}`,
        };
      }
      const json = parseJsonOutput(result.stdout);
      const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
      if (obj.ok === false) {
        return { ok: false, message: String(obj.message ?? "完成脚本返回失败") };
      }
      return {
        ok: true,
        message: String(obj.message ?? "已完成"),
        remoteStatus: typeof obj.remoteStatus === "string" ? obj.remoteStatus : undefined,
      };
    },
  };
}

export function listScriptSourceSummaries(): TaskSourceSummary[] {
  if (!fs.existsSync(SOURCES_DIR)) return [];
  const out: TaskSourceSummary[] = [];
  for (const entry of fs.readdirSync(SOURCES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (!isSafeSourceId(entry.name)) continue;
    let manifest: SourceManifest | null = null;
    try {
      manifest = readManifest(entry.name);
    } catch {
      manifest = null;
    }
    if (!manifest) continue;
    let updatedAt = "";
    try {
      updatedAt = fs.statSync(path.join(currentDir(entry.name), "febot.source.json")).mtime.toISOString();
    } catch {
      // ignore
    }
    out.push({
      id: entry.name,
      name: manifest.name,
      kind: "script",
      input: manifest.input,
      fetchEntry: manifest.entry,
      completeEntry: manifest.complete?.entry,
      completeMode: manifest.complete?.mode ?? "optional",
      lastRun: readLastRun(entry.name) ?? undefined,
      updatedAt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}