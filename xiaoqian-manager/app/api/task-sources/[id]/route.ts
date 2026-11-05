import { NextResponse } from "next/server";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { isSafeSourceId } from "@/lib/server/task-sources/script";
import { deleteSource } from "@/lib/server/task-sources/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const guard = guardLocalWrite(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: 403 });
  }
  const { id } = await params;
  if (!isSafeSourceId(id) || id === "teamwork" || id === "manual") {
    return NextResponse.json({ error: "不能删除内置来源" }, { status: 400 });
  }
  const removed = deleteSource(id);
  if (!removed) {
    return NextResponse.json({ error: "来源不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}