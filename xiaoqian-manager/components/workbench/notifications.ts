import type { PipelineRun } from "@/lib/domain/run";
import type { Task } from "@/lib/domain/schema";

// 通知全部由客户端派生，不新增后端存储。去重键保持稳定，已读状态存 localStorage。

export type NotificationKind =
  | "needs_input"
  | "failed"
  | "done"
  | "review"
  | "runner_offline"
  | "sync_error";

export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  taskId?: string;
  runId?: string;
  createdAt: string;
  readAt?: string;
}

export interface SyncLastResult {
  ok: boolean;
  at: string;
  message?: string;
  sourceName?: string;
}

export const SYNC_LAST_KEY = "febot.sync.last";
const READ_KEY = "febot.notified.guest";

export function readNotified(): Record<string, string> {
  try {
    const raw = JSON.parse(localStorage.getItem(READ_KEY) ?? "{}") as Record<string, string>;
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeNotified(map: Record<string, string>): void {
  try {
    localStorage.setItem(READ_KEY, JSON.stringify(map));
  } catch {
    // ignore
  }
}

export function readSyncLast(): SyncLastResult | null {
  try {
    const raw = JSON.parse(localStorage.getItem(SYNC_LAST_KEY) ?? "null") as SyncLastResult | null;
    return raw && typeof raw === "object" ? raw : null;
  } catch {
    return null;
  }
}

export function writeSyncLast(result: SyncLastResult): void {
  try {
    localStorage.setItem(SYNC_LAST_KEY, JSON.stringify(result));
  } catch {
    // ignore
  }
}

function within24h(iso: string): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && Date.now() - t < 24 * 60 * 60 * 1000;
}

export function buildNotifications(
  runs: PipelineRun[],
  tasks: Task[],
  online: boolean,
  syncError: SyncLastResult | null,
): NotificationItem[] {
  const titles = new Map(tasks.map((t) => [t.id, t.title]));
  const items: NotificationItem[] = [];

  for (const run of runs) {
    const title = titles.get(run.taskId) ?? `任务 ${run.taskId}`;
    if (run.status === "needs_input") {
      items.push({
        id: `${run.id}:needs_input`,
        kind: "needs_input",
        title: "待你确认",
        body: title,
        taskId: run.taskId,
        runId: run.id,
        createdAt: run.startedAt,
      });
    } else if (run.status === "failed" || run.status === "interrupted") {
      items.push({
        id: `${run.id}:${run.status}`,
        kind: "failed",
        title: run.status === "interrupted" ? "会话中断" : "流水线失败",
        body: `${title}${run.error ? `：${run.error}` : ""}`,
        taskId: run.taskId,
        runId: run.id,
        createdAt: run.endedAt ?? run.startedAt,
      });
    } else if (run.status === "done" && within24h(run.endedAt ?? run.startedAt)) {
      items.push({
        id: `${run.id}:done`,
        kind: "done",
        title: "流水线完成",
        body: title,
        taskId: run.taskId,
        runId: run.id,
        createdAt: run.endedAt ?? run.startedAt,
      });
      if (run.changedFiles > 0 && !run.acceptedAt) {
        items.push({
          id: `${run.id}:review`,
          kind: "review",
          title: "待审阅",
          body: `${title} · ${run.changedFiles} 个文件`,
          taskId: run.taskId,
          runId: run.id,
          createdAt: run.endedAt ?? run.startedAt,
        });
      }
    }
  }

  if (!online) {
    items.push({
      id: "runner_offline",
      kind: "runner_offline",
      title: "runner 未启动",
      body: "请在项目目录执行 yarn runner",
      createdAt: new Date().toISOString(),
    });
  }

  if (syncError && !syncError.ok) {
    items.push({
      id: `sync_error:${syncError.at}`,
      kind: "sync_error",
      title: "同步失败",
      body: `${syncError.sourceName ?? "任务来源"}：${syncError.message ?? "未知错误"}`,
      createdAt: syncError.at,
    });
  }

  return items.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

function dayKey(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export function groupByDay(items: NotificationItem[]): { label: string; items: NotificationItem[] }[] {
  const today = dayKey(new Date().toISOString());
  const groups: Record<string, NotificationItem[]> = {};
  for (const item of items) {
    const key = dayKey(item.createdAt) === today ? "今天" : "更早";
    (groups[key] ??= []).push(item);
  }
  return ["今天", "更早"]
    .filter((label) => groups[label]?.length)
    .map((label) => ({ label, items: groups[label] }));
}