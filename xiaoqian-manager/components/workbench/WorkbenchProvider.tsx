"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { Task } from "@/lib/domain/schema";
import type { PipelineRun } from "@/lib/domain/run";
import { useRuns } from "@/components/pipeline/useRuns";

// 三栏共享状态：任务、run 轮询、当前右栏会话。
// 全页只保留一份 useRuns()，左栏通知与右栏共用。

interface WorkbenchContextValue {
  tasks: Task[];
  runs: PipelineRun[];
  byTask: Record<string, PipelineRun>;
  online: boolean;
  selectedRunId: string | null;
  openRun: (runId: string) => void;
  closeRun: () => void;
  refreshTasks: () => void;
  refreshRuns: () => void;
}

const WorkbenchContext = createContext<WorkbenchContextValue | null>(null);

export function useWorkbench(): WorkbenchContextValue {
  const ctx = useContext(WorkbenchContext);
  if (!ctx) throw new Error("useWorkbench 必须在 WorkbenchProvider 内使用");
  return ctx;
}

function urlWithRun(runId: string | null): string {
  const url = new URL(window.location.href);
  if (runId) url.searchParams.set("run", runId);
  else url.searchParams.delete("run");
  return `${url.pathname}${url.search}${url.hash}`;
}

export default function WorkbenchProvider({
  initialTasks,
  initialRunId,
  children,
}: {
  initialTasks: Task[];
  initialRunId: string | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRunId);
  const { online, runs, byTask, refresh } = useRuns();

  // 服务端 router.refresh() 后把新快照同步进 Provider。
  // 在渲染期同步（React 的「props 变化时调整 state」模式），避免额外一次渲染。
  const [lastInitialTasks, setLastInitialTasks] = useState(initialTasks);
  if (initialTasks !== lastInitialTasks) {
    setLastInitialTasks(initialTasks);
    setTasks(initialTasks);
  }

  // 浏览器前进/后退时同步 ?run=
  useEffect(() => {
    const onPop = () => {
      const id = new URL(window.location.href).searchParams.get("run");
      setSelectedRunId(id || null);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // 首次渲染时如果 URL 与 props 不一致（客户端导航），以 URL 为准
  useEffect(() => {
    const id = new URL(window.location.href).searchParams.get("run");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id !== initialRunId) setSelectedRunId(id || null);
    // 只在挂载时对齐一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    window.history.replaceState(null, "", urlWithRun(runId));
  }, []);

  const closeRun = useCallback(() => {
    setSelectedRunId(null);
    window.history.replaceState(null, "", urlWithRun(null));
  }, []);

  const refreshTasks = useCallback(() => router.refresh(), [router]);

  const value = useMemo<WorkbenchContextValue>(
    () => ({
      tasks,
      runs,
      byTask,
      online,
      selectedRunId,
      openRun,
      closeRun,
      refreshTasks,
      refreshRuns: refresh,
    }),
    [tasks, runs, byTask, online, selectedRunId, openRun, closeRun, refreshTasks, refresh],
  );

  return <WorkbenchContext.Provider value={value}>{children}</WorkbenchContext.Provider>;
}