import type { RawTask, TaskSource } from "@/lib/domain/task-source";
import type { IncomingTask } from "@/lib/server/store";
import { mergeTasks, readTasks } from "@/lib/server/store";
import { getTaskSource } from "@/lib/server/task-sources/registry";

// 同步编排：fetchTasks -> normalize -> mergeTasks。
// 这里不认识任何具体平台；内置协作平台和自定义脚本都只是 TaskSource。

export interface SyncRequest {
  sourceId: string;
  params?: Record<string, unknown>;
}

export interface SyncPreview {
  sourceId: string;
  sourceName: string;
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** 前 20 条，供弹窗预览 */
  tasks: RawTask[];
}

export interface SyncResult {
  sourceId: string;
  sourceName: string;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** 本地全量同步，固定 0 */
  removed: number;
}

/** 自定义来源家 id 前缀，避免与平台 id 冲突 */
export function taskIdFor(source: TaskSource, externalId: string): string {
  if (source.kind === "script") return `src-${source.id}-${externalId}`;
  return externalId;
}

function toIncoming(source: TaskSource, raw: RawTask): IncomingTask {
  return {
    id: taskIdFor(source, raw.externalId),
    source: source.id,
    externalId: raw.externalId,
    title: raw.title,
    module: raw.module,
    assignee: raw.assignee,
    customerName: raw.customerName,
    twStatus: raw.twStatus,
    demandId: raw.demandId,
    demandLevel: raw.demandLevel,
    description: raw.description,
    assignDescription: raw.assignDescription,
    plannedDescription: raw.plannedDescription,
    attachments: raw.attachments,
    handlers: raw.handlers,
    trajectory: raw.trajectory,
    createdName: raw.createdName,
    createdTime: raw.createdTime,
  };
}

function requireSource(sourceId: string): TaskSource {
  const source = getTaskSource(sourceId);
  if (!source) throw new Error(`未知任务来源：${sourceId}`);
  if (source.kind === "manual") throw new Error("手动新建来源不支持同步");
  return source;
}

async function fetchRaw(source: TaskSource, params: Record<string, unknown>): Promise<{
  raws: RawTask[];
  failed: number;
}> {
  const list = await source.fetchTasks({ params });
  // 适配器已过滤非法条目；这里再兜一道，计数不丢
  const raws: RawTask[] = [];
  let failed = 0;
  for (const item of list) {
    if (!item || typeof item.externalId !== "string" || !item.externalId.trim()) {
      failed++;
      continue;
    }
    if (typeof item.title !== "string" || !item.title.trim()) {
      failed++;
      continue;
    }
    raws.push(item);
  }
  return { raws, failed };
}

/** 试运行：执行拉取，不写库，返回预估新增/更新 */
export async function previewSync(req: SyncRequest): Promise<SyncPreview> {
  const source = requireSource(req.sourceId);
  const { raws, failed } = await fetchRaw(source, req.params ?? {});
  const local = new Set(readTasks().tasks.map((t) => t.id));
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  for (const raw of raws) {
    const id = taskIdFor(source, raw.externalId);
    if (!local.has(id)) created++;
    // 已存在的没法在预览阶段精确算字段差异，归入「可能更新」
    else updated++;
  }
  if (!raws.length) unchanged = 0;
  return {
    sourceId: source.id,
    sourceName: source.name,
    total: raws.length,
    created,
    updated,
    unchanged,
    failed,
    tasks: raws.slice(0, 20),
  };
}

/** 正式同步：本地全量合并，从不删除本地任务 */
export async function runSync(req: SyncRequest): Promise<SyncResult> {
  const source = requireSource(req.sourceId);
  const { raws, failed } = await fetchRaw(source, req.params ?? {});
  const incoming = raws.map((raw) => toIncoming(source, raw));
  const merged = await mergeTasks(incoming, { sourceId: source.id });
  return {
    sourceId: source.id,
    sourceName: source.name,
    created: merged.created,
    updated: merged.updated,
    unchanged: merged.unchanged,
    failed,
    removed: 0,
  };
}