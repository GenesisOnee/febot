"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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

// 新增本地任务：id 走 local- 前缀，来源标记 manual，不会被同步删除。

export default function NewTaskDialog({
  open,
  onOpenChange,
  moduleOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  moduleOptions: string[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [moduleName, setModuleName] = useState("");
  const [assignee, setAssignee] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [plannedDescription, setPlannedDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setTitle("");
    setModuleName("");
    setAssignee("");
    setCustomerName("");
    setPlannedDescription("");
  };

  const save = async () => {
    if (!title.trim() || !moduleName.trim()) {
      toast.error("标题与模块必填");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          module: moduleName.trim(),
          assignee: assignee.trim(),
          customerName: customerName.trim(),
          plannedDescription,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        toast.error(json.error ?? "新建任务失败");
        return;
      }
      toast.success("任务已创建");
      reset();
      onOpenChange(false);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "新建任务失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !saving && onOpenChange(v)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新增任务</DialogTitle>
          <DialogDescription>
            本地任务来源标记为「手动新建」，同步不会覆盖或删除。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-title">标题</Label>
            <Input id="new-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-module">模块</Label>
              <Input
                id="new-module"
                list="new-module-options"
                value={moduleName}
                onChange={(e) => setModuleName(e.target.value)}
                placeholder="如：示例产品 A"
              />
              <datalist id="new-module-options">
                {moduleOptions.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-assignee">执行人</Label>
              <Input id="new-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-customer">客户名称（可选）</Label>
            <Input
              id="new-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-plan">计划描述（可选）</Label>
            <textarea
              id="new-plan"
              className="min-h-24 w-full resize-y rounded-md border bg-background p-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={plannedDescription}
              onChange={(e) => setPlannedDescription(e.target.value)}
              placeholder="研发整理后的需求描述；填了才能启动流水线"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}