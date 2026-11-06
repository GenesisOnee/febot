"use client";

import { Badge } from "@/components/ui/badge";
import type { RunStatus } from "@/lib/domain/run";
import { cn } from "@/lib/utils";

export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  starting: "启动中",
  running: "进行中",
  needs_input: "待你处理",
  settling: "收尾中",
  done: "已完成",
  failed: "失败",
  cancelled: "已终止",
  interrupted: "已中断",
};

const CLASS: Record<RunStatus, string> = {
  starting: "border-border text-muted-foreground",
  running: "border-primary/40 text-primary",
  needs_input: "border-warning/50 bg-warning/10 text-warning",
  settling: "border-border text-muted-foreground",
  done: "border-success/40 text-success",
  failed: "border-destructive/40 text-destructive",
  cancelled: "border-border text-muted-foreground",
  interrupted: "border-warning/40 bg-warning/5 text-warning",
};

export function RunStatusBadge({
  status,
  className,
}: {
  status: RunStatus;
  className?: string;
}) {
  return (
    <Badge variant="outline" className={cn("h-5 font-normal", CLASS[status], className)}>
      {status === "needs_input" && (
        <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-warning" />
      )}
      {RUN_STATUS_LABEL[status]}
    </Badge>
  );
}
