import fs from "node:fs";
import path from "node:path";
import { DEFAULT_PIPELINE } from "@/lib/domain/pipeline";
import { TasksFile, Task, createStages, type TrajectoryItem } from "@/lib/domain/schema";
import { DATA_DIR } from "@/lib/server/workspace";

// 仅服务端可用（node:fs）。浏览器端严禁 import 本文件。
//
// 并发约定：模块级 Promise 链串行化所有写操作，读-改-写必须在同一
// 临界区内完成。仅适配单进程（next dev 或 next start 二选一），同时
// 跑两个实例会互相覆盖。

const TASKS_FILE = path.join(DATA_DIR, "tasks.json");

let chain: Promise<unknown> = Promise.resolve();

function serialize<T>(job: () => T | Promise<T>): Promise<T> {
  const run = chain.then(job, job);
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function writePayload(tasks: Task[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const payload: TasksFile = {
    version: 1,
    updatedAt: new Date().toISOString(),
    tasks,
  };
  const tmp = TASKS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), "utf8");
  fs.renameSync(tmp, TASKS_FILE);
}

// 旧数据兼容：按当前 PipelineDefinition 重排/补齐阶段。
// 已有 key 保留状态；已删除的步骤直接丢弃（旧 test 阶段）；新步骤补 pending。
function normalizeStages(raw: unknown): unknown {
  const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  const byKey = new Map(list.map((s) => [String(s?.key ?? ""), s]));
  const stages: Record<string, unknown>[] = DEFAULT_PIPELINE.stages.map((d) => {
    const found = byKey.get(d.key);
    return found ? { ...found, name: d.name } : { key: d.key, name: d.name };
  });
  // 阶段状态一律由人工维护，这里不补 done、不改写状态。
  return stages;
}

function normalizeRawTasks(json: unknown): unknown {
  if (!json || typeof json !== "object") return json;
  const tasks = (json as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return json;
  return {
    ...(json as object),
    tasks: tasks.map((t) => {
      if (!t || typeof t !== "object") return t;
      return { ...(t as object), stages: normalizeStages((t as { stages?: unknown }).stages) };
    }),
  };
}

export function readTasks(): { tasks: Task[]; updatedAt: string } {
  if (!fs.existsSync(TASKS_FILE)) return { tasks: [], updatedAt: "" };
  const raw = fs.readFileSync(TASKS_FILE, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error(`tasks.json is not valid JSON: ${TASKS_FILE}`);
  }
  const parsed = TasksFile.safeParse(normalizeRawTasks(json));
  if (!parsed.success) {
    throw new Error(`tasks.json failed schema validation: ${TASKS_FILE}`);
  }
  return { tasks: parsed.data.tasks, updatedAt: parsed.data.updatedAt };
}

export function writeTasks(tasks: Task[]): Promise<void> {
  return serialize(() => {
    writePayload(tasks);
  });
}

export function updateTask(
  id: string,
  mutate: (task: Task) => Task,
): Promise<Task | null> {
  return serialize(() => {
    const { tasks } = readTasks();
    const idx = tasks.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    tasks[idx] = mutate(tasks[idx]);
    writePayload(tasks);
    return tasks[idx];
  });
}

// ---------- 新增任务 ----------

export interface CreateTaskInput {
  title: string;
  module: string;
  twStatus?: string;
  assignee?: string;
  customerName?: string;
  demandLevel?: string;
  description?: string;
  plannedDescription?: string;
  assignDescription?: string;
  attachments?: string[];
  createdName?: string;
}

function localId(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  const rand = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `local-${stamp}-${rand}`;
}

function fmtLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

export function createTask(input: CreateTaskInput): Promise<Task> {
  return serialize(() => {
    const { tasks } = readTasks();
    const now = new Date();
    const ids = new Set(tasks.map((t) => t.id));
    let id = localId(now);
    while (ids.has(id)) id = localId(now);
    const task = Task.parse({
      id,
      demandId: "",
      title: input.title,
      module: input.module,
      assignee: input.assignee ?? "",
      twStatus: input.twStatus || "待处理",
      customerName: input.customerName ?? "",
      handlers: [],
      demandLevel: input.demandLevel ?? "",
      createdName: input.createdName ?? "本机用户",
      createdTime: now.toISOString(),
      attachments: input.attachments ?? [],
      stages: createStages(),
      trajectory: [
        {
          time: fmtLocal(now),
          operator: input.createdName ?? "本机用户",
          action: "新建任务",
          content: input.title,
        },
      ],
      description: input.description ?? "",
      plannedDescription: input.plannedDescription ?? "",
      assignDescription: input.assignDescription ?? "",
      source: "manual",
      externalId: "",
      codeSubmission: null,
      syncedAt: now.toISOString(),
    });
    tasks.push(task);
    writePayload(tasks);
    return task;
  });
}

// ---------- 同步合并（本地全量） ----------

export interface MergeResult {
  created: number;
  updated: number;
  unchanged: number;
  /** 兼容旧前端：同步从不删除本地任务，固定为 0 */
  removed: number;
}

/**
 * 同步条目：只带来源实际提供的字段。
 * 用 undefined 表示「远程未提供」，不能拿空串覆盖本地已有值。
 */
export interface IncomingTask extends Partial<Task> {
  id: string;
  source: string;
  externalId: string;
}

/** 远程可覆盖的展示/原文字段（twStatus 与所有本地生成字段永不覆盖） */
const REMOTE_FIELDS = [
  "title",
  "module",
  "customerName",
  "assignee",
  "demandLevel",
  "description",
  "assignDescription",
] as const;

function nonEmpty(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== undefined && v !== null;
}

function trajectoryKey(t: TrajectoryItem): string {
  return [t.time, t.operator, t.action, t.content].join("|");
}

function mergeTrajectory(local: TrajectoryItem[], remote: TrajectoryItem[]): TrajectoryItem[] {
  const seen = new Set(local.map(trajectoryKey));
  const out = [...local];
  for (const t of remote) {
    const k = trajectoryKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 本地全量合并：远程只做新增/字段增量合并，从不删除本地任务。
 * 同一来源内按 id 匹配（id 已包含来源前缀，跨来源不会撞）。
 */
export function mergeTasks(
  incoming: IncomingTask[],
  _opts?: { sourceId?: string },
): Promise<MergeResult> {
  return serialize(() => {
    const { tasks } = readTasks();
    const now = new Date().toISOString();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    let created = 0;
    let updated = 0;
    let unchanged = 0;

    for (const inc of incoming) {
      const existing = byId.get(inc.id);
      if (!existing) {
        const base = {
          demandId: "",
          title: "",
          module: "",
          assignee: "",
          twStatus: "",
          customerName: "",
          handlers: [],
          demandLevel: "",
          createdName: "",
          createdTime: "",
          attachments: [],
          trajectory: [],
          description: "",
          plannedDescription: "",
          assignDescription: "",
          codeSubmission: null,
          ...inc,
          source: inc.source,
          externalId: inc.externalId,
          stages: createStages(),
          syncedAt: now,
        };
        byId.set(inc.id, Task.parse(base));
        created++;
        continue;
      }

      // 本地生成/人工维护字段永不覆盖
      const next: Task = { ...existing };
      let changed = false;
      for (const field of REMOTE_FIELDS) {
        const value = inc[field];
        if (!nonEmpty(value)) continue;
        if (next[field] !== value) {
          // 类型已由 IncomingTask 约束为 string 字段
          (next as Record<string, unknown>)[field] = value;
          changed = true;
        }
      }
      if (Array.isArray(inc.attachments) && !sameJson(next.attachments, inc.attachments)) {
        next.attachments = inc.attachments;
        changed = true;
      }
      if (Array.isArray(inc.handlers) && !sameJson(next.handlers, inc.handlers)) {
        next.handlers = inc.handlers;
        changed = true;
      }
      if (Array.isArray(inc.trajectory) && inc.trajectory.length) {
        const merged = mergeTrajectory(next.trajectory, inc.trajectory);
        if (merged.length !== next.trajectory.length) {
          next.trajectory = merged;
          changed = true;
        }
      }
      if (next.syncedAt !== now) changed = true;
      next.syncedAt = now;

      if (changed) {
        byId.set(inc.id, next);
        updated++;
      } else {
        unchanged++;
      }
    }

    writePayload([...byId.values()]);
    return { created, updated, unchanged, removed: 0 };
  });
}