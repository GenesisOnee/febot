import { NextResponse } from "next/server";
import { demoAccept, isDemoMode } from "@/lib/server/demo";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 接受：不改工作区，仅在 run 上记一个标记
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (isDemoMode()) {
    const run = demoAccept(id);
    return run
      ? NextResponse.json({ run, demo: true })
      : NextResponse.json(
          { error: "演示数据里没有这个会话。下一步：回到工作台重新点开任务。" },
          { status: 404 }
        );
  }
  try {
    const data = await runnerFetch<unknown>(`/runs/${encodeURIComponent(id)}/accept`, {
      method: "POST",
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
}
