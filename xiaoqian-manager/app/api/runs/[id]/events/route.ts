import { NextResponse } from "next/server";
import type { TimelineEvent } from "@/lib/domain/run";
import { demoEvents, demoRun, demoTranscript, isDemoMode } from "@/lib/server/demo";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 时间线首屏加载与历史回看（不依赖 WS 是否已连上）
// 演示模式额外带回终端假快照，右栏会话才有内容可看。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isDemoMode()) {
    if (!demoRun(id)) {
      return NextResponse.json(
        { error: "演示数据里没有这个会话。下一步：回到工作台重新点开任务。" },
        { status: 404 }
      );
    }
    return NextResponse.json({
      demo: true,
      events: demoEvents(id),
      transcript: demoTranscript(id),
    });
  }
  try {
    const data = await runnerFetch<{ events: TimelineEvent[] }>(
      `/runs/${encodeURIComponent(id)}/events`
    );
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
}
