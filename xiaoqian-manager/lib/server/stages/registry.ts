import type { StageHandler } from "./types";
import { StageTransitionError } from "./types";
import { getTaskSource, MANUAL_SOURCE_ID } from "@/lib/server/task-sources/registry";
import { teamworkSource } from "@/lib/server/task-sources/teamwork";
import { pushDevOperation } from "@/lib/server/teamwork/client";

// 阶段处理器注册表：阶段定义里写 handlers: ["manual", ...]，
// 转换时按定义顺序执行，不再在 API 里写 if (stageKey === "deploy")。

const manual: StageHandler = {
  id: "manual",
  // 纯人工阶段：无副作用
};

const pipelineRun: StageHandler = {
  id: "pipeline-run",
  // 「写代码」的启动入口是 POST /api/tasks/[id]/pipeline（需要 runner 与被拒绝模型），
  // 阶段状态转换本身只记录进度，不在这里重复起会话。
};

const remoteComplete: StageHandler = {
  id: "remote-complete",
  async beforeComplete(ctx) {
    if (ctx.nextStatus !== "done") return;
    const sourceId = ctx.task.source?.trim() || teamworkSource.id;
    if (sourceId === MANUAL_SOURCE_ID) return;

    const source = getTaskSource(sourceId);
    if (!source) {
      throw new StageTransitionError(`任务来源不可用：${sourceId}`, {
        status: 409,
        code: "source-unavailable",
      });
    }

    if (source.kind === "builtin") {
      await pushDevOperation(ctx.task.id, ctx.task.plannedDescription);
      return;
    }
    if (source.kind === "manual") return;

    // 自定义脚本来源：manifest 没配 complete 时不能静默当作远程完成
    if (!source.complete || source.hasComplete === false) {
      if (ctx.options.localOnly) return;
      if (source.completeMode === "required") {
        throw new StageTransitionError(
          `来源「${source.name}」要求远程完成脚本，但当前未配置，无法标记完成`,
          { status: 409, code: "complete-script-required" }
        );
      }
      throw new StageTransitionError(
        `该来源未配置完成同步脚本：${source.name}`,
        { status: 409, code: "complete-script-missing" }
      );
    }

    const result = await source.complete(ctx.task);
    if (!result.ok) {
      throw new StageTransitionError(
        result.message || `远程完成失败：${source.name}`,
        { status: 502, code: "remote-complete-failed" }
      );
    }
  },
};

const HANDLERS: Record<string, StageHandler> = {
  [manual.id]: manual,
  [pipelineRun.id]: pipelineRun,
  [remoteComplete.id]: remoteComplete,
};

export function getStageHandler(id: string): StageHandler | null {
  return HANDLERS[id] ?? null;
}