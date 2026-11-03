import { Notification } from "electron";
import type { RunStatus } from "./run-types";
import type { RunLite } from "./runs";

const TITLES: Record<string, string> = {
  done: "流水线已完成",
  failed: "流水线失败",
  interrupted: "流水线已中断",
  cancelled: "流水线已终止",
};

export function notifyRunStatus(run: RunLite, to: RunStatus, onClick: () => void): void {
  if (!Notification.isSupported()) return;
  const title = TITLES[to] ?? `流水线状态：${to}`;
  const body = run.error ? `#${run.id} · ${run.error}` : `#${run.id}`;
  const notification = new Notification({ title, body, silent: false });
  notification.on("click", onClick);
  notification.show();
}

export function notifySimple(title: string, body: string): void {
  if (!Notification.isSupported()) return;
  new Notification({ title, body }).show();
}