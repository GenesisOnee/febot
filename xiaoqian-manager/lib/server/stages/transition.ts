import type { StageStatus, Task } from "@/lib/domain/schema";
import { stageDefinition } from "@/lib/domain/pipeline";
import { readTasks, updateTask } from "@/lib/server/store";
import { getStageHandler } from "./registry";
import {
  StageTransitionError,
  type StageHandler,
  type StageHandlerOptions,
  type StageTransitionContext,
} from "./types";

// 阶段转换的唯一入口。旧的 PATCH /api/tasks/[id]/stage 与新的
// PATCH /api/tasks/[id]/stages/[stageKey] 都转调这里。
//
// 处理器顺序：所有 beforeComplete 成功后才写 tasks.json；任一失败则整次转换
// 不落本地状态、也不回写平台（本地已写入的部分由各处理器自行回滚）。

export interface StageTransitionInput {
  status: StageStatus;
  owner?: string;
  note?: string;
  payload?: Record<string, unknown>;
  options?: StageHandlerOptions;
}

export async function applyStageTransition(
  taskId: string,
  stageKey: string,
  input: StageTransitionInput
): Promise<Task> {
  const existing = readTasks().tasks.find((t) => t.id === taskId);
  if (!existing) {
    throw new StageTransitionError("task not found", { status: 404, code: "task-not-found" });
  }

  const definition = stageDefinition(stageKey);
  if (!definition) {
    throw new StageTransitionError(`未知阶段：${stageKey}`, {
      status: 400,
      code: "unknown-stage",
    });
  }

  const stage = existing.stages.find((s) => s.key === stageKey) ?? null;
  if (
    stageKey === "deploy" &&
    input.status === "done" &&
    stage?.status === "done"
  ) {
    throw new StageTransitionError("该任务已标记完成，不能重复提交", {
      status: 409,
      code: "already-complete",
    });
  }

  const ctx: StageTransitionContext = {
    task: existing,
    stage,
    stageKey,
    nextStatus: input.status,
    payload: input.payload ?? {},
    options: input.options ?? {},
  };

  const handlers = resolveHandlers(definition.handlers);
  if (input.status === "done") {
    for (const handler of handlers) {
      await handler.beforeComplete?.(ctx);
    }
  }

  const now = new Date().toISOString();
  const payload = input.payload ?? {};
  const plannedDescription =
    stageKey === "planer" && typeof payload.plannedDescription === "string"
      ? payload.plannedDescription
      : undefined;

  const task = await updateTask(taskId, (t) => ({
    ...t,
    ...(plannedDescription !== undefined ? { plannedDescription } : {}),
    // 「标记完成」在本地收口：任务状态同步为已完成
    ...(stageKey === "deploy" && input.status === "done" ? { twStatus: "已完成" } : {}),
    stages: t.stages.map((s) => {
      if (s.key !== stageKey) return s;
      return {
        ...s,
        status: input.status,
        owner: input.owner ?? s.owner,
        note: input.note ?? s.note,
        startedAt: input.status === "pending" ? null : (s.startedAt ?? now),
        finishedAt:
          input.status === "done" || input.status === "failed"
            ? (s.finishedAt ?? now)
            : null,
      };
    }),
  }));

  if (!task) {
    throw new StageTransitionError("task not found", { status: 404, code: "task-not-found" });
  }

  if (input.status === "done") {
    for (const handler of handlers) {
      await handler.afterComplete?.({ ...ctx, task });
    }
  }

  return task;
}

function resolveHandlers(ids: string[]): StageHandler[] {
  return ids.map((id) => {
    const handler = getStageHandler(id);
    if (!handler) {
      throw new StageTransitionError(`阶段处理器未注册：${id}`, {
        status: 500,
        code: "handler-not-registered",
      });
    }
    return handler;
  });
}