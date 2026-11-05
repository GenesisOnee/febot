import path from "node:path";
import { NextResponse } from "next/server";
import type { DiffSummary, PipelineRun } from "@/lib/domain/run";
import { isTerminalStatus } from "@/lib/domain/run";
import { mergeBranchForRepo } from "@/lib/domain/git";
import type { Task } from "@/lib/domain/schema";
import { readGitOptions } from "@/lib/server/git/config";
import { buildDeployMessage, submitCode } from "@/lib/server/git/deploy";
import { readTasks, updateTask } from "@/lib/server/store";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 审阅页「代码提交」：commit → push 源分支 → cherry-pick 合并分支。
// 与「标记完成」完全解耦；成功后自动把 run 标记为已接受，并写入任务 codeSubmission。

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = guardLocalWrite(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: 403 });
  }

  const { id } = await params;
  let run: PipelineRun;
  try {
    const payload = await runnerFetch<{ run: PipelineRun }>(
      `/runs/${encodeURIComponent(id)}`
    );
    run = payload.run;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取会话失败" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }

  if (!isTerminalStatus(run.status)) {
    return NextResponse.json(
      { error: `会话仍在进行（${run.status}），结束后才能提交代码` },
      { status: 409 }
    );
  }

  let diff: DiffSummary;
  try {
    diff = await runnerFetch<DiffSummary>(`/runs/${encodeURIComponent(id)}/diff`);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取改动失败" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
  if (diff.files.length === 0) {
    return NextResponse.json({ error: "当前没有可提交的改动" }, { status: 422 });
  }

  const repo = path.basename(run.repoRoot);
  const targetBranch = mergeBranchForRepo(readGitOptions(), repo);
  if (!targetBranch) {
    return NextResponse.json(
      { error: "请先在设置中配置该仓库的合并分支" },
      { status: 422 }
    );
  }

  const task = readTasks().tasks.find((t) => t.id === run.taskId);
  if (!task) {
    return NextResponse.json({ error: "task not found" }, { status: 404 });
  }

  let gitResult;
  try {
    gitResult = await submitCode({
      repoRoot: run.repoRoot,
      targetBranch,
      message: buildDeployMessage(task.id, task.title),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "代码提交失败" },
      { status: 500 }
    );
  }

  // 提交成功后自动接受；接受失败不影响已完成的 git 操作，只回传提示
  let acceptedRun = run;
  let warning = "";
  try {
    const payload = await runnerFetch<{ run: PipelineRun }>(
      `/runs/${encodeURIComponent(id)}/accept`,
      { method: "POST" }
    );
    acceptedRun = payload.run;
  } catch (e) {
    warning = `代码已提交，但自动接受失败：${e instanceof Error ? e.message : "未知错误"}`;
  }

  const now = new Date().toISOString();
  const codeSubmission = {
    repo,
    targetBranch,
    commit: gitResult.commitSha,
    at: now,
    sourceRunId: run.id,
  };
  const updated = await updateTask(task.id, (t): Task => ({
    ...t,
    codeSubmission,
    trajectory: [
      ...t.trajectory,
      {
        time: now,
        operator: "系统",
        action: "代码提交",
        content: `${gitResult.commitSha.slice(0, 8)} → ${targetBranch}（${repo}）`,
      },
    ],
  }));

  return NextResponse.json({
    run: acceptedRun,
    task: updated,
    git: gitResult,
    codeSubmission,
    ...(warning ? { warning } : {}),
  });
}