import { NextResponse } from "next/server";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { previewSync } from "@/lib/server/tasks/sync-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = guardLocalWrite(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: 403 });
  }
  const { id } = await params;
  let body: { params?: Record<string, unknown> } = {};
  try {
    body = (await req.json()) as { params?: Record<string, unknown> };
  } catch {
    // 无参数试运行
  }
  try {
    const preview = await previewSync({ sourceId: id, params: body.params ?? {} });
    return NextResponse.json(preview);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "试运行失败" },
      { status: 500 },
    );
  }
}