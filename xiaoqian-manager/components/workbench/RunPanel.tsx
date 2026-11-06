"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ExternalLink, Loader2, RotateCcw, Square, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import TerminalPane from "@/components/pipeline/TerminalPane";
import { RunStatusBadge } from "@/components/pipeline/run-status";
import { isLiveStatus, useRunSession } from "@/components/pipeline/useRunSession";
import type { PipelineRun } from "@/lib/domain/run";
import { cn } from "@/lib/utils";

// 右栏会话：只保留标题/终端/操作，不放时间线与 diff。
// 驳回只在独立审阅页；代码提交也在审阅页。

export default function RunPanel({
  runId,
  taskTitle,
  taskModule,
  initialRun,
  demo = false,
  onClose,
}: {
  runId: string;
  taskTitle?: string;
  taskModule?: string;
  initialRun?: PipelineRun;
  demo?: boolean;
  onClose: () => void;
}) {
  const [run, setRun] = useState<PipelineRun | null>(initialRun ?? null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialRun) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRun(initialRun);
      return;
    }
    let stopped = false;
    fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" })
      .then(async (res) => {
        const json = (await res.json()) as { run?: PipelineRun; error?: string };
        if (stopped) return;
        if (!res.ok || !json.run) {
          setError(json.error ?? "会话不存在或 runner 未启动");
          return;
        }
        setRun(json.run);
      })
      .catch((e: unknown) => {
        if (!stopped) setError(e instanceof Error ? e.message : "读取会话失败");
      });
    return () => {
      stopped = true;
    };
  }, [runId, initialRun]);

  return (
    <aside
      className={cn(
        "z-40 flex min-h-0 flex-col border-l bg-background",
        "fixed inset-0 xl:static xl:w-[30%] xl:min-w-[420px] xl:max-w-[720px]",
      )}
    >
      {run ? (
        <RunPanelInner
          key={run.id}
          initialRun={run}
          taskTitle={taskTitle}
          taskModule={taskModule}
          demo={demo}
          onClose={onClose}
        />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">{error || "正在加载会话…"}</p>
          <Button variant="outline" size="sm" onClick={onClose}>
            关闭
          </Button>
        </div>
      )}
    </aside>
  );
}

function RunPanelInner({
  initialRun,
  taskTitle,
  taskModule,
  demo = false,
  onClose,
}: {
  initialRun: PipelineRun;
  taskTitle?: string;
  taskModule?: string;
  demo?: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const session = useRunSession(initialRun, demo);
  const { run, connected, online, notice, setNotice } = session;
  const [busy, setBusy] = useState<"" | "accept" | "redo" | "cancel">("");
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoText, setRedoText] = useState("");

  const live = isLiveStatus(run.status);
  const canCancel = live || run.pid !== null;

  const act = async (kind: "accept" | "redo" | "cancel") => {
    setNotice("");
    if (kind === "cancel" && !window.confirm("终止后本次会话的 PTY 会被杀掉，确定？")) return;
    setBusy(kind);
    try {
      let res: Response;
      if (kind === "accept") {
        res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/accept`, { method: "POST" });
      } else if (kind === "redo") {
        res = await fetch(`/api/runs/${encodeURIComponent(run.id)}/input`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: redoText }),
        });
      } else {
        res = await fetch(`/api/tasks/${encodeURIComponent(run.taskId)}/pipeline`, { method: "DELETE" });
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice(json.error ?? `操作失败（${res.status}）`);
        return;
      }
      toast.success(kind === "accept" ? "已标记接受" : kind === "redo" ? "已发送给会话" : "已终止");
      if (kind === "redo") {
        setRedoOpen(false);
        setRedoText("");
      }
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium" title={taskTitle}>
          {taskTitle ?? `任务 ${run.taskId}`}
        </span>
        <RunStatusBadge status={run.status} />
        {taskModule && <span className="truncate text-xs text-muted-foreground">{taskModule}</span>}
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px]",
            online && connected ? "text-muted-foreground" : "text-warning",
          )}
          title={demo ? "演示模式：静态会话" : connected ? "WS 已连接" : "WS 断开，正在重连"}
        >
          {!online ? (
            <>
              <WifiOff className="h-3 w-3" /> runner 离线
            </>
          ) : demo ? (
            "演示会话"
          ) : connected ? (
            "已连接"
          ) : (
            <>
              <Loader2 className="h-3 w-3 animate-spin" /> 重连中
            </>
          )}
        </span>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭会话">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {notice && (
        <div className="border-b bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">{notice}</div>
      )}

      {!online && !demo && (
        <div className="border-b bg-warning/10 px-3 py-2 text-xs text-warning">
          runner 未启动（原因：会话需要独立进程承载 PTY）。下一步：在项目目录执行{" "}
          <code className="font-mono">yarn runner</code>。
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        <TerminalPane
          onData={session.sendInput}
          onResize={session.sendResize}
          onReady={session.handleReady}
        />
      </div>

      {redoOpen && (
        <div className="border-t bg-card p-2">
          <textarea
            className="h-16 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="要求重做：说明要改什么，Ctrl/⌘ + Enter 发送"
            value={redoText}
            onChange={(e) => setRedoText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (redoText.trim() && busy === "") void act("redo");
              }
            }}
          />
          <div className="mt-1 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setRedoOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={busy !== "" || !redoText.trim()} onClick={() => void act("redo")}>
              {busy === "redo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              发送
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t px-3 py-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== "" || run.status === "cancelled"}
          onClick={() => void act("accept")}
        >
          {busy === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          接受
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== "" || !live || demo}
          title={demo ? "演示模式不能给静态会话发消息" : undefined}
          onClick={() => setRedoOpen((v) => !v)}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          要求重做
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          disabled={busy !== "" || !canCancel || demo}
          title={demo ? "演示模式没有真实进程可终止" : undefined}
          onClick={() => void act("cancel")}
        >
          {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          终止
        </Button>
        <a
          className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline"
          href={`/runs/${encodeURIComponent(run.id)}/review`}
          target="_blank"
          rel="noopener noreferrer"
        >
          审阅
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </>
  );
}
