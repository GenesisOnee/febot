// 流水线 / 阶段定义。纯类型 + 常量，前后端共享。
//
// 阶段顺序、名称与完成时执行的处理器都在这里定义，新增步骤不再改核心 API。
// 「代码提交」不是阶段处理器，而是 run 动作：POST /api/runs/[id]/submit-code。

export type StageFieldType = "text" | "textarea" | "select" | "repo" | "branch";

export interface StageFieldDefinition {
  key: string;
  label: string;
  type: StageFieldType;
  required?: boolean;
  visibleWhen?: "always" | "complete";
}

export interface StageDefinition {
  key: string;
  name: string;
  order: number;
  /** 完成时按顺序执行的处理器 id */
  handlers: string[];
  fields?: StageFieldDefinition[];
  ui?: { tone?: string };
}

export interface PipelineDefinition {
  stages: StageDefinition[];
}

/** 内置默认：计划 -> 写代码 -> 标记完成（deploy key 保留，旧任务数据无需迁移） */
export const DEFAULT_PIPELINE: PipelineDefinition = {
  stages: [
    { key: "planer", name: "计划", order: 1, handlers: ["manual"] },
    { key: "coder", name: "写代码", order: 2, handlers: ["pipeline-run"] },
    { key: "deploy", name: "标记完成", order: 3, handlers: ["remote-complete"] },
  ],
};

export function stageDefinition(key: string): StageDefinition | null {
  return DEFAULT_PIPELINE.stages.find((s) => s.key === key) ?? null;
}

/** 流水线协议 / runner 侧仍按这三个 key 写事件 */
export const STAGE_KEYS = DEFAULT_PIPELINE.stages.map((s) => s.key) as [string, string, string];
export type StageKey = string;