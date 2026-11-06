import { NextResponse } from "next/server";
import type { PipelineRun } from "@/lib/domain/run";
import { demoRun, isDemoMode } from "@/lib/server/demo";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isDemoMode()) {
    const run = demoRun(id);
    return run
      ? NextResponse.json({ run, demo: true })
      : NextResponse.json(
          { error: "演示数据里没有这个会话。下一步：回到工作台重新点开任务。" },
          { status: 404 }
        );
  }
  try {
    const data = await runnerFetch<{ run: PipelineRun }>(`/runs/${encodeURIComponent(id)}`);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
}
