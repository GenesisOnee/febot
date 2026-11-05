import { NextResponse } from "next/server";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { listTaskSourceSummaries } from "@/lib/server/task-sources/registry";
import {
  installCompleteScript,
  readUploadForm,
  UploadError,
} from "@/lib/server/task-sources/upload";

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
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请使用 multipart/form-data 上传" }, { status: 400 });
  }
  try {
    const files = await readUploadForm(form);
    const manifest = installCompleteScript(id, files);
    return NextResponse.json({
      ok: true,
      completeEntry: manifest.complete?.entry ?? "",
      sources: listTaskSourceSummaries(),
    });
  } catch (e) {
    const status = e instanceof UploadError ? 400 : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "更新完成脚本失败" },
      { status },
    );
  }
}