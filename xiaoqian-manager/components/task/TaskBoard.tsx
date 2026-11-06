"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Inbox, Plus, RefreshCw, Search, Settings, WifiOff } from "lucide-react";
import { toast } from "sonner";
import { Accordion } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Stage, Task } from "@/lib/domain/schema";
import type { GitOptions } from "@/lib/domain/git";
import type { PipelineRun } from "@/lib/domain/run";
import { ATTENTION_WEIGHT, NO_RUN_WEIGHT } from "@/components/pipeline/useRuns";
import { useWorkbench } from "@/components/workbench/WorkbenchProvider";
import TaskRow from "./TaskRow";
import StageDialog from "./StageDialog";
import NewTaskDialog from "./NewTaskDialog";

// 状态筛选按「当前所处节点」归类；deploy 的展示名改为「已完成」，key 不变。

const COMPLETED_STAGE_KEY = "deploy";

const STATUS_FILTERS = [
  { value: "not_started", label: "未开始" },
  { value: "planer", label: "计划" },
  { value: "coder", label: "写代码" },
  { value: COMPLETED_STAGE_KEY, label: "已完成" },
] as const;

function currentStageKey(t: Task): string {
  const started = t.stages.filter((s) => s.status !== "pending");
  return started[started.length - 1]?.key ?? "not_started";
}

export default function TaskBoard({
  gitOptions,
  error,
  onOpenSync,
  onOpenSettings,
}: {
  gitOptions: GitOptions;
  error?: string;
  onOpenSync: () => void;
  onOpenSettings?: () => void;
}) {
  const router = useRouter();
  const { tasks, runs, byTask, online, openRun, selectedRunId, refreshRuns } = useWorkbench();
  const [query, setQuery] = useState("");
  const [moduleFilter, setModuleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ taskId: string; stage: Stage } | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const modules = useMemo(
    () => [...new Set(tasks.map((t) => t.module).filter(Boolean))].sort(),
    [tasks],
  );

  // 注意力排序：needs_input > failed > running > 其他有 run > 无 run
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const weightOf = (t: Task): number => {
      const run = byTask[t.id];
      return run ? ATTENTION_WEIGHT[run.status] : NO_RUN_WEIGHT;
    };
    return tasks
      .filter((t) => {
        if (moduleFilter !== "all" && t.module !== moduleFilter) return false;
        const stageKey = currentStageKey(t);
        // 「全部状态」只查未完成的任务，已完成（deploy）需显式选择才展示
        if (statusFilter === "all" ? stageKey === COMPLETED_STAGE_KEY : stageKey !== statusFilter) {
          return false;
        }
        if (q && !`${t.title} ${t.id} ${t.module}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => weightOf(a) - weightOf(b));
  }, [tasks, query, moduleFilter, statusFilter, byTask]);

  const hasLiveRun = runs.some(
    (r) =>
      r.status === "starting" ||
      r.status === "running" ||
      r.status === "needs_input" ||
      r.status === "settling",
  );
  const pendingReview = runs.filter((r) => r.status === "needs_input").length;

  // 弹窗始终取当前任务列表里的最新快照
  const sheetTask = sheet ? (tasks.find((t) => t.id === sheet.taskId) ?? null) : null;

  // run 收口时由 runner 回调服务端写任务轨迹；这里轮询让页面看到结果
  useEffect(() => {
    if (!hasLiveRun) return;
    const timer = setInterval(() => router.refresh(), 10000);
    return () => clearInterval(timer);
  }, [hasLiveRun, router]);

  // 标记完成：先同步远程（协作平台 / 完成脚本），成功后再写本地状态；不操作仓库代码。
  const completeDirectly = async (task: Task) => {
    const hasRemote = task.source !== "manual";
    const run = byTask[task.id];
    const unsubmitted = Boolean(run && run.changedFiles > 0 && !task.codeSubmission);
    const ok = window.confirm(
      [
        hasRemote
          ? "将标记完成并同步远程任务，确定？"
          : "将该任务标记为已完成？\n\n本地任务没有远程来源，只更新本地状态。",
        "代码提交在审阅页完成，这里不操作仓库代码。",
        unsubmitted ? "代码尚未提交，仍要标记完成？" : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    if (!ok) return;

    const patchComplete = async (localOnly: boolean) => {
      const res = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/stage`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stageKey: "deploy",
          status: "done",
          skipGit: true,
          ...(localOnly ? { localOnly: true } : {}),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
      };
      return { ok: res.ok, json };
    };

    try {
      let result = await patchComplete(false);
      // 自定义来源没配完成脚本：二次确认后允许仅本地完成
      if (!result.ok && result.json.code === "complete-script-missing") {
        const onlyLocal = window.confirm(
          `${result.json.error}\n\n仍要仅本地完成吗？`,
        );
        if (onlyLocal) result = await patchComplete(true);
      }
      if (!result.ok) {
        toast.error(result.json.error || "标记完成失败");
        return;
      }
      toast.success("任务已标记完成");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "标记完成失败");
    }
  };

  const startPipeline = async (taskId: string) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/pipeline`, {
        method: "POST",
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        details?: string;
        run?: PipelineRun;
      };
      if (!res.ok) {
        toast.error(json.error || "启动流水线失败", { description: json.details });
        return;
      }
      toast.success("流水线已启动");
      refreshRuns();
      if (json.run?.id) openRun(json.run.id);
      else router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "启动流水线失败");
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 头部筛选区固定，只有下方任务列表滚动 */}
      <div className="shrink-0 space-y-4 p-4 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-48 flex-1 sm:max-w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题 / 任务ID / 模块"
              className="pl-9"
            />
          </div>
          <Select value={moduleFilter} onValueChange={setModuleFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="全部模块" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部模块</SelectItem>
              {modules.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="全部状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {STATUS_FILTERS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {pendingReview > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-400">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500" />
                {pendingReview} 个会话待你处理
              </span>
            )}
            <Button variant="outline" size="icon" title="新增任务" onClick={() => setNewOpen(true)}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="icon" title="同步任务" onClick={onOpenSync}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            {onOpenSettings && (
              <Button
                variant="outline"
                size="icon"
                title="设置"
                onClick={onOpenSettings}
              >
                <Settings className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>共 {filtered.length} 个任务</span>
          {!online && (
            <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
              <WifiOff className="h-3.5 w-3.5" />
              runner 未启动
            </span>
          )}
        </div>

        {!online && (
          <div className="flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-700 dark:text-amber-400">
            <WifiOff className="h-3.5 w-3.5" />
            runner 未启动（原因：流水线会话需要独立进程承载 PTY），启动/读取会话不可用。下一步：在项目根目录另开终端执行{" "}
            <code className="font-mono">yarn runner</code>。
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable px-4 pb-4">
        {tasks.length === 0 && !error ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-20 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/50" />
            <div>
              <p className="font-medium">还没有任务</p>
              <p className="mt-1 text-sm text-muted-foreground">
                点击右上角「同步」拉取任务，或「+」新建本地任务。
              </p>
            </div>
          </div>
        ) : (
          <Accordion
            type="single"
            collapsible
            value={openId ?? undefined}
            onValueChange={(v) => setOpenId(v || null)}
            className="space-y-3"
          >
            {filtered.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                run={byTask[t.id]}
                selected={Boolean(byTask[t.id]?.id && byTask[t.id]?.id === selectedRunId)}
                onOpenStage={(stage) => setSheet({ taskId: t.id, stage })}
                onStartPipeline={startPipeline}
                onDirectComplete={() => void completeDirectly(t)}
                onOpenRun={openRun}
              />
            ))}
          </Accordion>
        )}
      </div>

      <StageDialog
        key={sheet ? `${sheet.taskId}:${sheet.stage.key}` : "closed"}
        sheet={sheet}
        task={sheetTask}
        gitOptions={gitOptions}
        onClose={() => setSheet(null)}
        onSaved={() => router.refresh()}
      />

      <NewTaskDialog
        open={newOpen}
        onOpenChange={setNewOpen}
        moduleOptions={[...new Set([...modules, ...gitOptions.projectMap.map((p) => p.product)])]}
      />
    </div>
  );
}
