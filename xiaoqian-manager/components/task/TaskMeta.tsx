import type { Task } from "@/lib/domain/schema";
import { fmtDateTime } from "@/lib/ui/format";

export default function TaskMeta({ task }: { task: Task }) {
  const items: [string, string][] = [
    ["任务ID", task.id],
    ["需求ID", task.demandId],
    ["产品/模块", task.module],
    ["客户", task.customerName],
    ["执行人", task.assignee],
    ["难度", task.demandLevel],
    ["创建", `${task.createdName} ${fmtDateTime(task.createdTime)}`],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 rounded-lg border bg-muted/20 px-4 py-3 sm:grid-cols-3 lg:grid-cols-4">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{k}</dt>
          <dd className="truncate text-sm" title={v}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  );
}
