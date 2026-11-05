"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Stage, StageStatus, Task } from "@/lib/domain/schema";
import { resolveGitDefault, type GitOptions } from "@/lib/domain/git";
import { stageVisual } from "@/lib/domain/stage-visual";
import { fmtDateTime } from "@/lib/ui/format";

const STATUS_OPTIONS: { value: StageStatus; label: string }[] = [
  { value: "pending", label: "未开始" },
  { value: "active", label: "进行中" },
  { value: "done", label: "已完成" },
  { value: "failed", label: "失败" },
];

// 阶段弹窗：通用字段 + 计划描述。代码提交已移到审阅页，这里不再选仓库/分支。
// 「标记完成」（deploy）的 ✓ 快捷入口在 StageNode 上。

export default function StageDialog({
  sheet,
  task,
  gitOptions,
  onClose,
  onSaved,
}: {
  sheet: { taskId: string; stage: Stage } | null;
  task: Task | null;
  gitOptions: GitOptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isDeploy = sheet?.stage.key === "deploy";
  const isPlaner = sheet?.stage.key === "planer";
  const [status, setStatus] = useState<StageStatus>(
    isDeploy ? "done" : (sheet?.stage.status ?? "pending"),
  );
  const [owner, setOwner] = useState(sheet?.stage.owner ?? "");
  const [note, setNote] = useState(sheet?.stage.note ?? "");
  const [plannedDescription, setPlannedDescription] = useState(
    task?.plannedDescription || task?.description || "",
  );
  const [saving, setSaving] = useState(false);

  if (!sheet) return null;
  const { stage, taskId } = sheet;
  const gitDefault = resolveGitDefault(gitOptions, task?.module ?? "", task?.title ?? "");
  const jenkinsUrl = gitDefault ? gitOptions.jenkins[gitDefault.repo] : "";

  const send = async (localOnly: boolean) => {
    const body: Record<string, unknown> = { status, owner, note };
    if (isPlaner) body.plannedDescription = plannedDescription;
    if (localOnly) body.localOnly = true;
    const res = await fetch(
      `/api/tasks/${encodeURIComponent(taskId)}/stages/${encodeURIComponent(stage.key)}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const json = (await res.json().catch(() => ({}))) as {
      error?: string;
      code?: string;
    };
    return { ok: res.ok, json };
  };

  const save = async () => {
    if (isDeploy && status === "done") {
      const ok = window.confirm(
        "将标记完成并同步远程任务，确定？\n\n代码提交请在审阅页完成。",
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      let result = await send(false);
      // 自定义来源未配置完成脚本：二次确认后允许仅本地完成
      if (!result.ok && result.json.code === "complete-script-missing") {
        const onlyLocal = window.confirm(
          `${result.json.error}\n\n仍要仅本地完成吗？`,
        );
        if (!onlyLocal) return;
        result = await send(true);
      }
      if (!result.ok) throw new Error(result.json.error || "保存失败");
      toast.success("阶段状态已更新");
      onSaved();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const v = stageVisual(status);

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{stage.name}</DialogTitle>
          <DialogDescription>
            任务 {task?.title || taskId} · 更新该阶段的状态与信息
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[58vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            <Label>状态</Label>
            <Select value={status} onValueChange={(val) => setStatus(val as StageStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {isPlaner && (
            <div className="space-y-2">
              <Label htmlFor="stage-planned-description">修改描述</Label>
              <textarea
                id="stage-planned-description"
                value={plannedDescription}
                onChange={(e) => setPlannedDescription(e.target.value)}
                rows={10}
                className="max-h-64 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                placeholder="整理需求背景、要改的页面与期望效果"
              />
              <p className="text-xs text-muted-foreground">
                这里整理后的描述会作为「写代码」阶段 AI 的需求输入（留空则使用平台原文）。
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="stage-owner">负责人</Label>
            <Input
              id="stage-owner"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="如：你的协作平台用户名"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="stage-note">备注</Label>
            <textarea
              id="stage-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="（可选）"
            />
          </div>

          {isDeploy && (
            <p className="text-xs text-muted-foreground">
              「标记完成」只更新本地状态并同步远程任务，不再操作仓库代码。代码提交在审阅页完成。
            </p>
          )}

          {jenkinsUrl && (
            <p className="text-sm">
              Jenkins：
              <a
                href={jenkinsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline underline-offset-4"
              >
                {jenkinsUrl}
              </a>
            </p>
          )}

          <dl className="space-y-1.5 rounded-lg border bg-muted/20 px-4 py-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">当前标记</dt>
              <dd>{v.badgeLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">开始时间</dt>
              <dd className="tabular-nums">{fmtDateTime(stage.startedAt) || "-"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">完成时间</dt>
              <dd className="tabular-nums">{fmtDateTime(stage.finishedAt) || "-"}</dd>
            </div>
          </dl>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? "保存中…" : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}