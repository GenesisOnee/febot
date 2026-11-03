import fs from "node:fs";
import path from "node:path";
import type { RunStatus } from "./run-types";
import { isTerminalStatus } from "./run-types";
import { workspaceRunsDir } from "./paths";
import { readJson, writeJsonAtomic } from "./filesystem";

export interface RunLite {
  id: string;
  taskId: string;
  status: RunStatus;
  repoRoot: string;
  startedAt: string;
  endedAt: string | null;
  error: string | null;
  pid: number | null;
}

export function readRuns(workspace: string): RunLite[] {
  const dir = workspaceRunsDir(workspace);
  if (!fs.existsSync(dir)) return [];
  const runs: RunLite[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".events.jsonl")) continue;
    const run = readJson<RunLite>(path.join(dir, name));
    if (run?.id && run.status) runs.push(run);
  }
  return runs.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

export function countActiveRuns(workspace: string): number {
  return readRuns(workspace).filter((r) => !isTerminalStatus(r.status)).length;
}

/** runner 意外退出后，把非终态 run 落盘为 interrupted（保留现场，供下次恢复）。 */
export function markInterruptedRuns(workspace: string, note: string): number {
  const dir = workspaceRunsDir(workspace);
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json") || name.endsWith(".events.jsonl")) continue;
    const file = path.join(dir, name);
    const run = readJson<RunLite>(file);
    if (!run?.id || isTerminalStatus(run.status)) continue;
    run.status = "interrupted";
    run.error = note;
    run.endedAt = new Date().toISOString();
    run.pid = null;
    writeJsonAtomic(file, run);
    count += 1;
  }
  return count;
}

export interface RunTransition {
  run: RunLite;
  from: RunStatus;
  to: RunStatus;
}

/** 轮询 runs/ 目录，状态变化时回调（主进程据此发 Windows 通知）。 */
export function watchRuns(
  workspace: string,
  onTransition: (transition: RunTransition) => void,
  intervalMs = 2_000
): () => void {
  let snapshot = new Map<string, RunStatus>();
  let stopped = false;

  const tick = (): void => {
    if (stopped || !workspace) return;
    const next = new Map<string, RunStatus>();
    for (const run of readRuns(workspace)) {
      next.set(run.id, run.status);
      const from = snapshot.get(run.id);
      if (from && from !== run.status && isTerminalStatus(run.status)) {
        onTransition({ run, from, to: run.status });
      }
    }
    snapshot = next;
  };

  tick();
  const timer = setInterval(tick, intervalMs);
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}