// 与 xiaoqian-manager/lib/domain/run.ts 对齐的最小状态集合。
// 主进程不 import 产品代码（打包后不可见），保持一处常量即可。

export const RUN_STATUSES = [
  "starting",
  "running",
  "needs_input",
  "settling",
  "done",
  "failed",
  "cancelled",
  "interrupted",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const TERMINAL_RUN_STATUSES: RunStatus[] = [
  "done",
  "failed",
  "cancelled",
  "interrupted",
];

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATUSES.includes(status);
}