"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Bell,
  CheckCheck,
  CircleCheck,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  WifiOff,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useWorkbench } from "./WorkbenchProvider";
import {
  buildNotifications,
  groupByDay,
  readNotified,
  readSyncLast,
  writeNotified,
  type NotificationItem,
  type NotificationKind,
} from "./notifications";
import UserMenu from "./UserMenu";

function iconOf(kind: NotificationKind) {
  switch (kind) {
    case "needs_input":
      return <Bell className="h-3.5 w-3.5 text-warning" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-destructive" />;
    case "done":
      return <CircleCheck className="h-3.5 w-3.5 text-success" />;
    case "review":
      return <Inbox className="h-3.5 w-3.5 text-primary" />;
    case "runner_offline":
      return <WifiOff className="h-3.5 w-3.5 text-warning" />;
    case "sync_error":
      return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  }
}

export default function Sidebar({
  collapsed,
  onToggle,
  onOpenSettings,
  onOpenSync,
}: {
  collapsed: boolean;
  onToggle: () => void;
  onOpenSettings: () => void;
  onOpenSync: () => void;
}) {
  const { tasks, runs, online, openRun } = useWorkbench();
  const [notified, setNotified] = useState<Record<string, string>>({});
  const [userOpen, setUserOpen] = useState(false);
  const [syncLast, setSyncLast] = useState<ReturnType<typeof readSyncLast>>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNotified(readNotified());
  }, []);

  // run 变化顺带刷新一次同步失败摘要（同步弹窗写 localStorage）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSyncLast(readSyncLast());
  }, [runs, online]);

  const items = useMemo(
    () => buildNotifications(runs, tasks, online, syncLast),
    [runs, tasks, online, syncLast],
  );
  const unread = items.filter((n) => !notified[n.id]);
  const groups = groupByDay(items);

  const openItem = (item: NotificationItem) => {
    const next = { ...notified, [item.id]: new Date().toISOString() };
    setNotified(next);
    writeNotified(next);
    if (item.kind === "review" && item.runId) {
      window.open(`/runs/${encodeURIComponent(item.runId)}/review`, "_blank", "noopener,noreferrer");
      return;
    }
    if (item.kind === "sync_error") {
      onOpenSync();
      return;
    }
    if (item.runId) openRun(item.runId);
  };

  const markAll = () => {
    const now = new Date().toISOString();
    const next = { ...notified };
    for (const item of items) next[item.id] = now;
    setNotified(next);
    writeNotified(next);
  };

  return (
    <aside
      className={cn(
        "flex h-dvh shrink-0 flex-col border-r bg-sidebar",
        collapsed ? "w-14" : "w-14 md:w-[15%] md:min-w-[220px]",
      )}
    >
      <div className="flex h-12 items-center gap-2 border-b px-2">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground">
          前
        </span>
        {!collapsed && <span className="hidden truncate text-sm font-medium md:inline">小前工作台</span>}
        <Button
          variant="ghost"
          size="icon-sm"
          className="ml-auto hidden md:inline-flex"
          onClick={onToggle}
          title={collapsed ? "展开左栏" : "折叠左栏"}
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </Button>
      </div>

      {!collapsed && (
        <div className="hidden items-center justify-between px-3 pt-3 md:flex">
          <span className="text-xs font-medium text-muted-foreground">
            消息{unread.length > 0 ? ` · ${unread.length}` : ""}
          </span>
          {unread.length > 0 && (
            <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[11px]" onClick={markAll}>
              <CheckCheck className="h-3 w-3" />
              全部已读
            </Button>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
        {collapsed ? (
          <div className="flex flex-col items-center gap-2 py-1">
            <Button variant="ghost" size="icon-sm" title={`消息 ${unread.length}`} onClick={() => onToggle()}>
              <Bell className="h-4 w-4" />
              {unread.length > 0 && (
                <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-warning" />
              )}
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">暂无消息</p>
        ) : (
          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.label}>
                <p className="px-2 pb-1 text-[11px] text-muted-foreground">{group.label}</p>
                <div className="space-y-0.5">
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={cn(
                        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted",
                        !notified[item.id] && "bg-muted/40",
                      )}
                      onClick={() => openItem(item)}
                    >
                      <span className="mt-0.5 shrink-0">{iconOf(item.kind)}</span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block truncate", !notified[item.id] && "font-medium")}>
                          {item.title}
                        </span>
                        {item.body && (
                          <span className="block truncate text-muted-foreground">{item.body}</span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="border-t p-1.5">
        {collapsed ? (
          <div className="flex flex-col items-center gap-1">
            <Button variant="ghost" size="icon-sm" title="本机用户" onClick={() => setUserOpen(true)}>
              <span className="text-xs">本</span>
            </Button>
            <Button variant="ghost" size="icon-sm" title="设置" onClick={onOpenSettings}>
              <Settings className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="hidden space-y-1 md:block">
            <UserMenu open={userOpen} onOpenChange={setUserOpen} />
            <Button
              variant="ghost"
              className="h-9 w-full justify-start gap-2 px-2"
              onClick={onOpenSettings}
            >
              <Settings className="h-4 w-4" />
              <span className="text-sm">设置</span>
            </Button>
          </div>
        )}
      </div>
    </aside>
  );
}