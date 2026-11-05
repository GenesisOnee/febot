import type { Stage, StageStatus, Task } from "@/lib/domain/schema";

// 阶段转换的处理器契约。阶段定义（顺序 / 名称 / 处理器链）在
// lib/domain/pipeline.ts；这里只放服务端执行所需的上下文与注册项。

export interface StageHandlerOptions {
  /** 旧「直接完成」参数：仅为兼容保留，阶段完成本身不再操作仓库代码 */
  skipGit?: boolean;
  /** 来源未配置完成脚本时，用户二次确认后仅本地完成 */
  localOnly?: boolean;
}

export interface StageTransitionContext {
  task: Task;
  stage: Stage | null;
  stageKey: string;
  nextStatus: StageStatus;
  payload: Record<string, unknown>;
  options: StageHandlerOptions;
}

export interface StageHandler {
  id: string;
  /** 远程/外部副作用：全部成功后才会写本地 tasks.json */
  beforeComplete?(ctx: StageTransitionContext): Promise<void>;
  afterComplete?(ctx: StageTransitionContext): Promise<void>;
}

export class StageTransitionError extends Error {
  status: number;
  code: string;
  constructor(
    message: string,
    opts: { status?: number; code?: string } = {}
  ) {
    super(message);
    this.name = "StageTransitionError";
    this.status = opts.status ?? 500;
    this.code = opts.code ?? "stage-transition-failed";
  }
}