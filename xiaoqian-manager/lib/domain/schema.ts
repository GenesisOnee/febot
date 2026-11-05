import { z } from "zod";
import { DEFAULT_PIPELINE } from "./pipeline";

// 流水线会话（run）相关类型：PipelineRun / RunStatus / TimelineEvent / DiffFile
export * from "./run";
export { STAGE_KEYS } from "./pipeline";

// 阶段 key 不再固定枚举：新增/调整步骤只改 DEFAULT_PIPELINE。
// 旧任务数据里的 key 原样保留（normalizeStages 按定义重排/补齐）。
export const StageStatus = z.enum(["pending", "active", "done", "failed"]);
export type StageStatus = z.infer<typeof StageStatus>;

export const STAGE_DEFS: { key: string; name: string }[] = DEFAULT_PIPELINE.stages.map((s) => ({
  key: s.key,
  name: s.name,
}));

export const Stage = z.object({
  key: z.string().min(1),
  name: z.string(),
  owner: z.string().default(""),
  status: StageStatus.default("pending"),
  startedAt: z.string().nullable().default(null),
  finishedAt: z.string().nullable().default(null),
  note: z.string().default(""),
});
export type Stage = z.infer<typeof Stage>;

export function createStages(): Stage[] {
  return STAGE_DEFS.map((d) => Stage.parse({ key: d.key, name: d.name }));
}

export const TrajectoryItem = z.object({
  time: z.string(),
  operator: z.string().default(""),
  action: z.string().default(""),
  content: z.string().default(""),
});
export type TrajectoryItem = z.infer<typeof TrajectoryItem>;

// 需求处理人明细：来自协作平台 getByDemand（入参为需求 id），一行 = 需求下的一个任务。
// status 已在服务端映射为中文（待处理/处理中/已完成）；taskId 用于标出当前任务所在行。
export const TaskHandler = z.object({
  taskId: z.string().default(""),
  username: z.string().default(""),
  status: z.string().default(""),
});
export type TaskHandler = z.infer<typeof TaskHandler>;

// 代码提交记录：本地生成，同步永不覆盖；仅保留最近一次
export const CodeSubmission = z.object({
  repo: z.string(),
  targetBranch: z.string(),
  commit: z.string(),
  at: z.string(),
  sourceRunId: z.string().default(""),
});
export type CodeSubmission = z.infer<typeof CodeSubmission>;

export const Task = z.object({
  id: z.string(),
  demandId: z.string().default(""),
  title: z.string(),
  module: z.string().default(""),
  assignee: z.string().default(""),
  twStatus: z.string().default(""),

  // 可选展示字段：缺失时不展示
  customerName: z.string().default(""),
  handlers: z.array(TaskHandler).default([]),
  demandLevel: z.string().default(""),
  createdName: z.string().default(""),
  createdTime: z.string().default(""),
  attachments: z.array(z.string()).default([]),

  // 工作流字段
  stages: z.array(Stage),
  trajectory: z.array(TrajectoryItem).default([]),
  description: z.string().default(""),
  // 研发人员在「计划」节点整理后的描述；为空时回退到平台原文 description
  plannedDescription: z.string().default(""),
  assignDescription: z.string().default(""),

  // 来源与提交
  source: z.string().default("teamwork"),
  externalId: z.string().default(""),
  codeSubmission: CodeSubmission.nullable().default(null),

  syncedAt: z.string(),
});
export type Task = z.infer<typeof Task>;

export const TasksFile = z.object({
  version: z.number(),
  updatedAt: z.string(),
  tasks: z.array(Task),
});
export type TasksFile = z.infer<typeof TasksFile>;

// 工时接口契约（本期只预留，不实现存储）
export const TimeEntry = z.object({
  id: z.string(),
  taskId: z.string().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  hours: z.number().positive().max(24),
  description: z.string().default(""),
  createdAt: z.string(),
});
export type TimeEntry = z.infer<typeof TimeEntry>;