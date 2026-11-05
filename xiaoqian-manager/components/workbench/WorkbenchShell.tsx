"use client";

import { useEffect, useState } from "react";
import type { Task } from "@/lib/domain/schema";
import type { GitOptions } from "@/lib/domain/git";
import type { SanitizedSettings } from "@/lib/domain/settings";
import TaskBoard from "@/components/task/TaskBoard";
import SyncDialog from "@/components/sync/SyncDialog";
import SettingsDialog from "@/components/settings/SettingsDialog";
import WorkbenchProvider, { useWorkbench } from "./WorkbenchProvider";
import Sidebar from "./Sidebar";
import RunPanel from "./RunPanel";

// 三栏工作台：左 15% 导航/通知，中 flex 任务列表，右 30% 常驻会话。
// 路由仍是 `/`，右栏由 ?run= 控制，页面内组合，不使用 route group。

const COLLAPSE_KEY = "febot.sidebar.collapsed";

export default function WorkbenchShell({
  initialTasks,
  initialRunId,
  gitOptions,
  defaultUser,
  settings,
  initialized,
  error,
}: {
  initialTasks: Task[];
  initialRunId: string | null;
  gitOptions: GitOptions;
  defaultUser: string;
  settings: SanitizedSettings | null;
  initialized: boolean;
  error?: string;
}) {
  return (
    <WorkbenchProvider initialTasks={initialTasks} initialRunId={initialRunId}>
      <ShellInner
        gitOptions={gitOptions}
        defaultUser={defaultUser}
        settings={settings}
        initialized={initialized}
        error={error}
      />
    </WorkbenchProvider>
  );
}

function ShellInner({
  gitOptions,
  defaultUser,
  settings,
  initialized,
  error,
}: {
  gitOptions: GitOptions;
  defaultUser: string;
  settings: SanitizedSettings | null;
  initialized: boolean;
  error?: string;
}) {
  const { tasks, byTask, selectedRunId } = useWorkbench();
  const [collapsed, setCollapsed] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(!initialized);
  const [syncOpen, setSyncOpen] = useState(false);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // ignore
      }
      return next;
    });
  };

  const selectedTask = selectedRunId
    ? tasks.find((t) => byTask[t.id]?.id === selectedRunId)
    : undefined;
  const selectedRun = selectedTask ? byTask[selectedTask.id] : undefined;

  return (
    <div className="flex h-dvh w-full overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={toggleCollapsed}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenSync={() => setSyncOpen(true)}
      />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TaskBoard
          gitOptions={gitOptions}
          error={error}
          onOpenSync={() => setSyncOpen(true)}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      </main>

      {selectedRunId && (
        <RunPanel
          key={selectedRunId}
          runId={selectedRunId}
          initialRun={selectedRun}
          taskTitle={selectedTask?.title}
          taskModule={selectedTask?.module}
          onClose={() => {
            const url = new URL(window.location.href);
            url.searchParams.delete("run");
            window.history.replaceState(null, "", `${url.pathname}${url.search}`);
            window.dispatchEvent(new PopStateEvent("popstate"));
          }}
        />
      )}

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        initialSettings={settings}
        initialized={initialized}
      />

      <SyncDialog
        open={syncOpen}
        onOpenChange={setSyncOpen}
        defaultUser={defaultUser}
        onOpenSettings={() => {
          setSyncOpen(false);
          setSettingsOpen(true);
        }}
      />
    </div>
  );
}