"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Check,
  CornerDownLeft,
  Loader2,
  Maximize2,
  RotateCcw,
  Square,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PipelineRun } from "@/lib/domain/run";
import { cn } from "@/lib/utils";
import DiffPanel from "./DiffPanel";
import Timeline from "./Timeline";
import TerminalPane from "./TerminalPane";
import { RunStatusBadge } from "./run-status";
import { isLiveStatus, useRunSession } from "./useRunSession";

// 整页会话（仅保留代码/排查用）：时间线 + 终端 + diff。
// 工作台入口已改为右栏 RunPanel，两者共用 useRunSession。

export default function SessionView({
  initialRun,
  taskTitle,
  taskModule,
  planPath,
}: {
  initialRun: PipelineRun;
  taskTitle: string;
  taskModule: string;
  planPath?: string;
}) {
  const router = useRouter();
  const runId = initialRun.id;
  const session = useRunSession(initialRun);
  const { run, events, connected, online, notice, setNotice } = session;

  const [selected, setSelected] = useState<string[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);
  const [redoText, setRedoText] = useState("");
  const [busy, setBusy] = useState<"" | "accept" | "reject" | "redo" | "cancel">("");
  const lastRejected = useRef<string[]>([]);

  const act = async (kind: "accept" | "reject" | "redo" | "cancel") => {
    setNotice("");
    if (kind === "cancel" && !window.confirm("终止后本次会话的 PTY 会被杀掉，确定？")) return;
    if (kind === "reject" && selected.length === 0) return;
    setBusy(kind);
    try {
      let res: Response;
      if (kind === "accept") {
        res = await fetch(`/api/runs/${encodeURIComponent(runId)}/accept`, { method: "POST" });
      } else if (kind === "reject") {
        res = await fetch(`/api/runs/${encodeURIComponent(runId)}/reject`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ paths: selected }),
        });
      } else if (kind === "redo") {
        res = await fetch(`/api/runs/${encodeURIComponent(runId)}/input`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ data: redoText }),
        });
      } else {
        res = await fetch(`/api/tasks/${encodeURIComponent(run.taskId)}/pipeline`, {
          method: "DELETE",
        });
      }
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        results?: { path: string; action: "deleted" | "restored" }[];
      };
      if (!res.ok) {
        setNotice(json.error ?? `操作失败（${res.status}）`);
        return;
      }
      if (kind === "accept") setNotice("已标记接受");
      if (kind === "reject") {
        lastRejected.current = selected;
        setNotice(`已驳回 ${json.results?.length ?? selected.length} 个文件`);
        setSelected([]);
        session.bumpRefresh();
      }
      if (kind === "redo") {
        setRedoText("");
        setRedoOpen(false);
        setNotice("已发送给会话");
      }
      if (kind === "cancel") setNotice("已终止");
      router.refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy("");
    }
  };

  const live = isLiveStatus(run.status);
  const canCancel = live || run.pid !== null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col gap-2 overflow-hidden p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Button asChild variant="ghost" size="sm">
          <Link href="/">
            <CornerDownLeft className="h-3.5 w-3.5" />
            返回
          </Link>
        </Button>
        <span className="truncate text-sm font-medium" title={taskTitle}>
          {taskTitle}
        </span>
        <span className="truncate text-xs text-muted-foreground">{taskModule}</span>
        <RunStatusBadge status={run.status} />
        {live && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs",
              connected ? "text-muted-foreground" : "text-amber-600",
            )}
            title={connected ? "WS 已连接" : "WS 断开，正在重连"}
          >
            {!online ? (
              <>
                <WifiOff className="h-3 w-3" /> runner 离线
              </>
            ) : connected ? (
              <>已连接</>
            ) : (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> 重连中
              </>
            )}
          </span>
        )}
        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {run.repoKey.split("/").pop()} @ {run.baseSha.slice(0, 8)}
        </span>
        {planPath && (
          <span className="truncate text-[11px] text-muted-foreground" title={planPath}>
            计划：{planPath}
          </span>
        )}
      </div>

      <Timeline events={events} expanded={expanded} onToggle={() => setExpanded((v) => !v)} />

      {notice && (
        <div className="rounded-md border border-border bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
          {notice}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-2 grid-rows-[minmax(0,1.5fr)_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_420px] lg:grid-rows-1">
        <div className="min-h-0 overflow-hidden">
          <TerminalPane
            onData={session.sendInput}
            onResize={session.sendResize}
            onReady={session.handleReady}
          />
        </div>
        <DiffPanel
          runId={runId}
          refreshToken={session.refreshToken}
          selected={selected}
          onSelectedChange={setSelected}
          className="min-h-0"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2">
        <Button asChild variant="outline" size="sm">
          <Link href={`/runs/${encodeURIComponent(runId)}/review`} target="_blank" rel="noopener noreferrer">
            <Maximize2 className="h-3.5 w-3.5" />
            全屏审阅
          </Link>
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== "" || run.status === "cancelled"}
          onClick={() => void act("accept")}
          title="仅记录接受标记，不改工作区"
        >
          {busy === "accept" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          接受
        </Button>
        <Button
          size="sm"
          variant="destructive"
          disabled={busy !== "" || selected.length === 0}
          onClick={() => void act("reject")}
          title="把选中文件恢复到 baseSha，不动其他改动"
        >
          驳回{selected.length > 0 ? ` ${selected.length}` : ""}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== "" || !live}
          onClick={() => {
            const next = !redoOpen;
            setRedoOpen(next);
            if (next && !redoText && lastRejected.current.length > 0) {
              setRedoText(
                `以下文件已驳回：${lastRejected.current.join("、")}。请只重做这些文件，不要动其他改动。`,
              );
            }
          }}
        >
          <RotateCcw className="h-3.5 w-3.5" />
          要求重做
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto text-destructive"
          disabled={busy !== "" || !canCancel}
          onClick={() => void act("cancel")}
        >
          {busy === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
          终止
        </Button>
      </div>

      {redoOpen && (
        <div className="rounded-lg border bg-card p-2">
          <textarea
            className="h-20 w-full resize-none rounded-md border bg-background p-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="输入给会话的指令，Ctrl/⌘ + Enter 发送"
            value={redoText}
            onChange={(e) => setRedoText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                if (redoText.trim() && busy === "") void act("redo");
              }
            }}
          />
          <div className="mt-1 flex items-center justify-end gap-2">
            <span className="mr-auto text-[11px] text-muted-foreground">Ctrl/⌘ + Enter 发送</span>
            <Button variant="ghost" size="sm" onClick={() => setRedoOpen(false)}>
              取消
            </Button>
            <Button size="sm" disabled={busy !== "" || redoText.trim() === ""} onClick={() => void act("redo")}>
              {busy === "redo" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              发送
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}