import { NextResponse } from "next/server";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { listTaskSourceSummaries } from "@/lib/server/task-sources/registry";
import { readUploadForm, UploadError, installSource } from "@/lib/server/task-sources/upload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return NextResponse.json({ sources: listTaskSourceSummaries() });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "读取任务来源失败" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const guard = guardLocalWrite(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: 403 });
  }
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "请使用 multipart/form-data 上传" }, { status: 400 });
  }
  try {
    const files = await readUploadForm(form);
    const sourceIdField = String(form.get("sourceId") ?? "").trim();
    const result = installSource(files, sourceIdField || undefined);
    return NextResponse.json({
      sourceId: result.sourceId,
      name: result.manifest.name,
      manifests: result.manifest,
      sources: listTaskSourceSummaries(),
    });
  } catch (e) {
    const status = e instanceof UploadError ? 400 : 500;
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "上传失败" },
      { status },
    );
  }
}