import { NextResponse } from "next/server";
import { demoReject, isDemoMode } from "@/lib/server/demo";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 整文件驳回（不做 hunk 级反向 patch）
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let body: { paths?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  if (!Array.isArray(body.paths) || body.paths.length === 0) {
    return NextResponse.json({ error: "paths 必须是非空数组" }, { status: 400 });
  }

  if (isDemoMode()) {
    const results = demoReject(id, body.paths.map(String));
    return results
      ? NextResponse.json({ results, demo: true })
      : NextResponse.json(
          { error: "演示数据里没有这个会话。下一步：回到工作台重新点开任务。" },
          { status: 404 }
        );
  }

  try {
    const data = await runnerFetch<unknown>(`/runs/${encodeURIComponent(id)}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paths: body.paths }),
    });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
}
