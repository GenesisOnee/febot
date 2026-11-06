import fs from "node:fs";
import path from "node:path";
import type {
  DiffFile,
  DiffSummary,
  FilePatch,
  PipelineRun,
  TimelineEvent,
} from "@/lib/domain/run";
import { isTerminalStatus } from "@/lib/domain/run";

// 演示模式（FEBOT_DEMO=1）的唯一服务端入口。
//
// 目标：不填任何配置、不启动 runner，也能看到队列 / 计划 / 审阅 / 会话四个页面。
// 数据来自 example/demo/ 的静态夹具，所有写操作都落在 .febot/demo-workspace，
// 不会碰到使用者的 febot.config.json、tasks.json 或业务仓库。
//
// 这里只 import node 内置模块与领域类型，不能 import workspace.ts（会成环）。

const DEMO_VALUES = new Set(["1", "true", "yes", "on"]);

export function isDemoMode(): boolean {
  const v = process.env.FEBOT_DEMO?.trim().toLowerCase();
  return Boolean(v && DEMO_VALUES.has(v));
}

/** 演示数据目录：优先 FEBOT_DEMO_DIR，其次仓库内的 example/demo */
export function demoFixtureDir(): string {
  const explicit = process.env.FEBOT_DEMO_DIR?.trim();
  const candidates = [
    explicit ? path.resolve(explicit) : "",
    path.resolve(process.cwd(), "example", "demo"),
    path.resolve(process.cwd(), "..", "example", "demo"),
    path.resolve(process.cwd(), "..", "..", "example", "demo"),
  ].filter(Boolean);

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "tasks.json"))) return dir;
  }
  return path.resolve(process.cwd(), "..", "example", "demo");
}

/**
 * 演示工作区：与 --cwd xiaoqian-manager 时的默认工作区保持同样的两层深度，
 * 这样 example/demo/febot.config.json 里的相对 repoRoot 在复制后仍然有效。
 */
export function demoWorkspaceDir(): string {
  const ws = process.env.FEBOT_WORKSPACE?.trim();
  if (ws) return path.resolve(ws);
  return path.resolve(process.cwd(), "..", ".febot", "demo-workspace");
}

export function demoTasksSource(): string | null {
  const file = path.join(demoFixtureDir(), "tasks.json");
  return fs.existsSync(file) ? file : null;
}

/** 演示配置：没有显式 FEBOT_CONFIG 时，把模板复制到演示工作区再读 */
export function ensureDemoConfigFile(): string | null {
  const ws = demoWorkspaceDir();
  const target = path.join(ws, "febot.config.json");
  if (fs.existsSync(target)) return target;

  const source = path.join(demoFixtureDir(), "febot.config.json");
  if (!fs.existsSync(source)) return null;
  try {
    fs.mkdirSync(ws, { recursive: true });
    fs.copyFileSync(source, target);
    return target;
  } catch {
    return null;
  }
}

// ---------- run / diff / 事件夹具 ----------

interface DemoDiff {
  baseSha: string;
  files: DiffFile[];
  patches: Record<string, string>;
}

interface DemoFixtureRun extends PipelineRun {
  /** 夹具里的时间可以写成 @-25m / @-2h，加载时换算成绝对时间 */
  [key: string]: unknown;
}

interface DemoFixtures {
  runs: DemoFixtureRun[];
  diffs: Record<string, DemoDiff>;
  events: Record<string, TimelineEvent[]>;
  transcripts: Record<string, string>;
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function loadFixtures(): DemoFixtures {
  return readJson<DemoFixtures>(path.join(demoFixtureDir(), "runs.json"), {
    runs: [],
    diffs: {},
    events: {},
    transcripts: {},
  });
}

function parseOffset(raw: string): number | null {
  const m = /^@-(\d+)([smhd])$/.exec(raw.trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  const ms = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return n * ms;
}

function materializeTime(value: string | null): string | null {
  if (!value) return value;
  const offset = parseOffset(value);
  return offset === null ? value : new Date(Date.now() - offset).toISOString();
}

function materializeRun(raw: DemoFixtureRun): PipelineRun {
  return {
    ...raw,
    startedAt: materializeTime(raw.startedAt) ?? raw.startedAt,
    endedAt: materializeTime(raw.endedAt),
    settledAt: materializeTime(raw.settledAt),
    timeoutAt: materializeTime(raw.timeoutAt),
    acceptedAt: materializeTime(raw.acceptedAt),
  };
}

// 演示期间的人工动作只记在进程内存里：刷新页面还在，重启 demo 即复位。
const accepted = new Map<string, string>();
const rejected = new Map<string, Set<string>>();

function visibleFiles(runId: string, diff: DemoDiff | undefined): DiffFile[] {
  if (!diff) return [];
  const hidden = rejected.get(runId);
  if (!hidden?.size) return diff.files;
  return diff.files.filter((f) => !hidden.has(f.path));
}

function overlayRun(run: PipelineRun, diff: DemoDiff | undefined): PipelineRun {
  const files = visibleFiles(run.id, diff);
  return {
    ...run,
    changedFiles: files.length,
    acceptedAt: accepted.get(run.id) ?? run.acceptedAt,
  };
}

export function demoRuns(status?: string | null): PipelineRun[] {
  const fixtures = loadFixtures();
  let runs = fixtures.runs.map((r) => overlayRun(materializeRun(r), fixtures.diffs[r.id]));
  if (status === "review") {
    runs = runs.filter(
      (r) => isTerminalStatus(r.status) && r.changedFiles > 0 && !r.acceptedAt
    );
  }
  return runs;
}

export function demoRun(id: string): PipelineRun | null {
  return demoRuns().find((r) => r.id === id) ?? null;
}

export function demoDiffSummary(id: string): DiffSummary | null {
  const fixtures = loadFixtures();
  const run = fixtures.runs.find((r) => r.id === id);
  if (!run) return null;
  const diff = fixtures.diffs[id];
  return {
    baseSha: diff?.baseSha ?? run.baseSha,
    files: visibleFiles(id, diff),
  };
}

export function demoFilePatch(id: string, filePath: string): FilePatch | null {
  const fixtures = loadFixtures();
  const diff = fixtures.diffs[id];
  const file = diff?.files.find((f) => f.path === filePath);
  if (!diff || !file) return null;
  if (rejected.get(id)?.has(filePath)) {
    return {
      path: filePath,
      patch: "",
      binary: file.binary,
      tooLarge: file.tooLarge,
      note: "演示模式下该文件已被驳回，改动已从列表移除。",
    };
  }
  return {
    path: filePath,
    patch: diff.patches[filePath] ?? "",
    binary: file.binary,
    tooLarge: file.tooLarge,
    note: file.binary ? "二进制文件，不渲染内容。" : undefined,
  };
}

export function demoEvents(id: string): TimelineEvent[] {
  const events = loadFixtures().events[id] ?? [];
  return events.map((e) => ({ ...e, ts: materializeTime(e.ts) ?? e.ts }));
}

export function demoTranscript(id: string): string {
  return loadFixtures().transcripts[id] ?? "";
}

export function demoAccept(id: string): PipelineRun | null {
  const run = demoRun(id);
  if (!run) return null;
  if (!accepted.has(id)) accepted.set(id, new Date().toISOString());
  return demoRun(id);
}

export interface DemoRejectResult {
  path: string;
  action: "restored" | "deleted";
}

export function demoReject(id: string, paths: string[]): DemoRejectResult[] | null {
  const fixtures = loadFixtures();
  if (!fixtures.runs.some((r) => r.id === id)) return null;
  const hidden = rejected.get(id) ?? new Set<string>();
  const results: DemoRejectResult[] = [];
  for (const p of paths) {
    hidden.add(p);
    const file = fixtures.diffs[id]?.files.find((f) => f.path === p);
    results.push({ path: p, action: file?.status === "added" ? "deleted" : "restored" });
  }
  rejected.set(id, hidden);
  return results;
}

/** 演示模式下的写操作统一返回的结构：原因 + 下一步 */
export function demoBlocked(action: "start" | "cancel" | "input" | "submit"): {
  error: string;
  code: string;
  next: string;
} {
  const common = {
    code: "demo-mode",
    next: "按 README「快速开始」配置自己的仓库，并执行 yarn runner 后即可解锁。",
  };
  switch (action) {
    case "start":
      return {
        ...common,
        error: "演示模式不会真的启动流水线（原因：没有连接 Claude runner）。",
      };
    case "cancel":
      return {
        ...common,
        error: "演示模式没有真实进程可终止（原因：会话是静态示例）。",
      };
    case "input":
      return {
        ...common,
        error: "演示模式不能给会话发消息（原因：会话是静态示例，没有 PTY）。",
      };
    case "submit":
      return {
        ...common,
        error: "演示模式不会提交代码（原因：示例仓库只读展示，不执行 git 操作）。",
      };
  }
}

export function demoStatus(): { demo: true; fixtureDir: string; workspace: string } {
  return { demo: true, fixtureDir: demoFixtureDir(), workspace: demoWorkspaceDir() };
}
