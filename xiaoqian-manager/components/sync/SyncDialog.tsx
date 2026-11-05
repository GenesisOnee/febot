"use client";

import { useCallback, useEffect, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { RawTask, TaskSourceSummary } from "@/lib/domain/task-source";
import { writeSyncLast } from "@/components/workbench/notifications";

const STATUS_OPTIONS = [
  { label: "待处理 + 处理中", value: "1,2" },
  { label: "仅处理中", value: "2" },
  { label: "仅待处理", value: "1" },
];

interface SyncResponse {
  synced?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  removed?: number;
  failed?: number;
  error?: string;
  sourceName?: string;
}

interface PreviewResponse {
  total?: number;
  created?: number;
  updated?: number;
  unchanged?: number;
  failed?: number;
  tasks?: RawTask[];
  error?: string;
}

export default function SyncDialog({
  open,
  onOpenChange,
  defaultUser = "",
  onOpenSettings,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultUser?: string;
  onOpenSettings?: () => void;
}) {
  const router = useRouter();
  const [sources, setSources] = useState<TaskSourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("teamwork");
  const [user, setUser] = useState(defaultUser);
  const [statusOpt, setStatusOpt] = useState("1,2");
  const [moduleName, setModuleName] = useState("");
  const [params, setParams] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<SyncResponse | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const loadSources = useCallback(async () => {
    try {
      const res = await fetch("/api/task-sources", { cache: "no-store" });
      const json = (await res.json()) as { sources?: TaskSourceSummary[] };
      if (res.ok) setSources(json.sources ?? []);
    } catch {
      // 来源列表失败时至少保留内置来源
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setResult(null);
    setPreview(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    void loadSources();
  }, [open, loadSources]);

  const current = sources.find((s) => s.id === sourceId);

  const buildParams = (): Record<string, unknown> => {
    if (sourceId === "teamwork") {
      return { user, statuses: statusOpt.split(","), module: moduleName };
    }
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params)) {
      if (!value.trim()) continue;
      out[key] = key === "statuses" ? value.split(",").map((s) => s.trim()) : value;
    }
    return out;
  };

  const runPreview = async () => {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await fetch(`/api/task-sources/${encodeURIComponent(sourceId)}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ params: buildParams() }),
      });
      const json = (await res.json()) as PreviewResponse;
      if (!res.ok) {
        toast.error(json.error ?? "试运行失败");
        return;
      }
      setPreview(json);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "试运行失败");
    } finally {
      setPreviewing(false);
    }
  };

  const runSync = async () => {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/tasks/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: sourceId, params: buildParams() }),
      });
      const json = (await res.json()) as SyncResponse;
      if (!res.ok) {
        writeSyncLast({
          ok: false,
          at: new Date().toISOString(),
          message: json.error ?? "同步失败",
          sourceName: current?.name ?? sourceId,
        });
        toast.error(json.error ?? "同步失败");
        return;
      }
      setResult(json);
      writeSyncLast({
        ok: true,
        at: new Date().toISOString(),
        message: `新增 ${json.created ?? 0}，更新 ${json.updated ?? 0}`,
        sourceName: json.sourceName ?? current?.name ?? sourceId,
      });
      toast.success(
        `同步完成：新增 ${json.created ?? 0}，更新 ${json.updated ?? 0}，未变 ${json.unchanged ?? 0}，失败 ${json.failed ?? 0}`,
      );
      router.refresh();
    } catch (e) {
      writeSyncLast({
        ok: false,
        at: new Date().toISOString(),
        message: e instanceof Error ? e.message : "同步失败",
        sourceName: current?.name ?? sourceId,
      });
      toast.error(e instanceof Error ? e.message : "同步失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !running && onOpenChange(v)}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>同步任务</DialogTitle>
          <DialogDescription>
            同步只做新增与合并，不会删除本地任务；本地阶段进度、计划描述与完成状态不会被覆盖。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>任务来源</Label>
            <Select
              value={sourceId}
              onValueChange={(v) => {
                setSourceId(v);
                setPreview(null);
                setResult(null);
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sources
                  .filter((s) => s.kind !== "manual")
                  .map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                      {s.kind === "script" ? "（自定义）" : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {current?.kind === "builtin" && !current.hasCredential && (
              <p className="text-xs text-destructive">
                未配置协作平台账号：请先在 febot.config.json 的 teamwork 段填写 loginName / password。
              </p>
            )}
            {current?.kind === "script" && (
              <p className="text-xs text-muted-foreground">
                脚本以当前用户权限在本机执行，请只上传你自己信任的代码。
              </p>
            )}
          </div>

          {sourceId === "teamwork" ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="sync-user">执行人</Label>
                <Input
                  id="sync-user"
                  value={user}
                  onChange={(e) => setUser(e.target.value)}
                  placeholder={defaultUser || "你的协作平台用户名"}
                />
              </div>
              <div className="space-y-2">
                <Label>状态</Label>
                <Select value={statusOpt} onValueChange={setStatusOpt}>
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
              <div className="space-y-2">
                <Label htmlFor="sync-module">模块（可选，精确匹配）</Label>
                <Input
                  id="sync-module"
                  value={moduleName}
                  onChange={(e) => setModuleName(e.target.value)}
                  placeholder="如：产品/模块名"
                />
              </div>
            </>
          ) : (
            <div className="space-y-2">
              {(current?.input ?? []).length === 0 ? (
                <p className="text-xs text-muted-foreground">该来源不需要参数。</p>
              ) : (
                (current?.input ?? []).map((name) => (
                  <div key={name} className="space-y-1">
                    <Label htmlFor={`param-${name}`}>{name}</Label>
                    <Input
                      id={`param-${name}`}
                      value={params[name] ?? ""}
                      onChange={(e) => setParams((prev) => ({ ...prev, [name]: e.target.value }))}
                      placeholder={name === "statuses" ? "逗号分隔，如 1,2" : ""}
                    />
                  </div>
                ))
              )}
            </div>
          )}

          {preview && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              <p className="font-medium">
                试运行：共 {preview.total ?? 0} 条 · 新增 {preview.created ?? 0} · 可能更新{" "}
                {preview.updated ?? 0}
                {preview.failed ? ` · 失败 ${preview.failed}` : ""}
              </p>
              {preview.tasks && preview.tasks.length > 0 && (
                <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-muted-foreground">
                  {preview.tasks.map((t) => (
                    <li key={t.externalId} className="truncate">
                      [{t.externalId}] {t.title}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && (
            <div className="rounded-lg border bg-muted/30 p-3 text-xs">
              新增 {result.created ?? 0} · 更新 {result.updated ?? 0} · 未变 {result.unchanged ?? 0} · 失败{" "}
              {result.failed ?? 0}
            </div>
          )}
        </div>

        <DialogFooter>
          {onOpenSettings && (
            <Button variant="ghost" className="mr-auto" onClick={onOpenSettings}>
              上传来源 / 设置
            </Button>
          )}
          <Button variant="outline" onClick={() => void runPreview()} disabled={previewing || running}>
            {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            试运行
          </Button>
          <Button onClick={() => void runSync()} disabled={running || previewing}>
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            开始同步
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}