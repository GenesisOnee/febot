import type { Task, TaskHandler, TrajectoryItem } from "./schema";

// 任务来源适配器接口。内置协作平台与用户上传的 Node 脚本都实现同一套契约，
// 同步编排（SyncService）不再认识具体平台。

export interface TaskSourceContext {
  params: Record<string, unknown>;
  signal?: AbortSignal;
}

/** 脚本 / 平台返回的原始任务：只带来源实际提供的字段 */
export interface RawTask {
  externalId: string;
  title: string;
  module?: string;
  assignee?: string;
  customerName?: string;
  twStatus?: string;
  demandId?: string;
  demandLevel?: string;
  description?: string;
  assignDescription?: string;
  plannedDescription?: string;
  attachments?: string[];
  handlers?: TaskHandler[];
  trajectory?: TrajectoryItem[];
  createdName?: string;
  createdTime?: string;
}

export type CompleteMode = "optional" | "required" | "none";

export interface TaskSourceCompleteResult {
  ok: boolean;
  message?: string;
  remoteStatus?: string;
}

export interface TaskSource {
  id: string;
  name: string;
  kind: "builtin" | "script" | "manual";
  fetchTasks(ctx: TaskSourceContext): Promise<RawTask[]>;
  /** 标记完成时同步远程；manual 来源不实现 */
  complete?(task: Task): Promise<TaskSourceCompleteResult>;
  /** 是否真的配置了远程完成能力（脚本来源 manifest 没有 complete 时为 false） */
  hasComplete?: boolean;
  test?(): Promise<TaskSourceCompleteResult>;
  /** 自定义来源的完成脚本策略 */
  completeMode?: CompleteMode;
}

export interface TaskSourceSummary {
  id: string;
  name: string;
  kind: "builtin" | "script" | "manual";
  hasCredential?: boolean;
  /** manifest.input：同步弹窗据此渲染参数输入框 */
  input?: string[];
  fetchEntry?: string;
  completeEntry?: string;
  completeMode?: CompleteMode;
  lastRun?: {
    ok: boolean;
    at: string;
    message?: string;
    fetched?: number;
  };
  updatedAt?: string;
}