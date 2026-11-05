import type { TaskSource, TaskSourceSummary } from "@/lib/domain/task-source";
import { hasCredentials } from "@/lib/server/teamwork/credentials";
import { createScriptSource, listScriptSourceSummaries } from "./script";
import { teamworkSource } from "./teamwork";

// 任务来源注册表：内置来源 + 磁盘上的自定义脚本来源。
// 所有同步/完成逻辑只通过这里拿适配器，不再直接 import teamwork。

export const MANUAL_SOURCE_ID = "manual";

const manualSource: TaskSource = {
  id: MANUAL_SOURCE_ID,
  name: "手动新建",
  kind: "manual",
  completeMode: "none",
  hasComplete: false,
  async fetchTasks() {
    return [];
  },
};

export function listTaskSources(): TaskSource[] {
  const scripts: TaskSource[] = [];
  for (const summary of listScriptSourceSummaries()) {
    try {
      scripts.push(createScriptSource(summary.id));
    } catch {
      // manifest 坏掉的来源在摘要里仍可见，但不可执行
    }
  }
  return [teamworkSource, manualSource, ...scripts];
}

export function getTaskSource(sourceId: string): TaskSource | null {
  if (sourceId === teamworkSource.id) return teamworkSource;
  if (sourceId === MANUAL_SOURCE_ID) return manualSource;
  try {
    return createScriptSource(sourceId);
  } catch {
    return null;
  }
}

export function listTaskSourceSummaries(): TaskSourceSummary[] {
  const summaries: TaskSourceSummary[] = [
    {
      id: teamworkSource.id,
      name: teamworkSource.name,
      kind: "builtin",
      hasCredential: hasCredentials(),
      input: ["user", "statuses", "module"],
      completeMode: "optional",
    },
    {
      id: manualSource.id,
      name: manualSource.name,
      kind: "manual",
      completeMode: "none",
    },
    ...listScriptSourceSummaries(),
  ];
  return summaries;
}