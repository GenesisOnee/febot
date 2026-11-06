import { NextResponse } from "next/server";
import { demoDiffSummary, demoFilePatch, isDemoMode } from "@/lib/server/demo";
import { runnerFetch } from "@/lib/server/runner-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 文件列表；带 ?path= 时懒加载单文件 patch
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const p = new URL(req.url).searchParams.get("path");

  if (isDemoMode()) {
    if (p) {
      const patch = demoFilePatch(id, p);
      return patch
        ? NextResponse.json(patch)
        : NextResponse.json(
            { error: "演示数据里没有这个文件。下一步：刷新 diff 列表后重新选择。" },
            { status: 404 }
          );
    }
    const summary = demoDiffSummary(id);
    return summary
      ? NextResponse.json(summary)
      : NextResponse.json(
          { error: "演示数据里没有这个会话。下一步：回到工作台重新点开任务。" },
          { status: 404 }
        );
  }

  const pathname = `/runs/${encodeURIComponent(id)}/diff${
    p ? `?path=${encodeURIComponent(p)}` : ""
  }`;
  try {
    const data = await runnerFetch<unknown>(pathname);
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: (e as { status?: number })?.status ?? 503 }
    );
  }
}
