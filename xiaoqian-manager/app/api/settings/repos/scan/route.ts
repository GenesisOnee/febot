import { NextResponse } from "next/server";
import { z } from "zod";
import { scanRepositories } from "@/lib/server/config/repos-scan";
import { guardLocalWrite } from "@/lib/server/config/request-guard";
import { readAppSettings, repoRootPath } from "@/lib/server/config/store";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  /** 允许传相对路径；相对路径按配置文件目录解析 */
  root: z.string().optional(),
});

export async function POST(req: Request) {
  const guard = guardLocalWrite(req);
  if (!guard.ok) {
    return NextResponse.json({ error: guard.message }, { status: 403 });
  }
  let body: z.infer<typeof Body> = {};
  try {
    body = Body.parse(await req.json().catch(() => ({})));
  } catch {
    return NextResponse.json({ error: "请求体校验失败" }, { status: 400 });
  }
  const root = body.root?.trim() ? body.root.trim() : readAppSettings().repoRoot;
  if (!root) {
    return NextResponse.json({ error: "请先填写仓库根目录" }, { status: 400 });
  }
  try {
    const abs = path.isAbsolute(root) ? root : repoRootPath({ ...readAppSettings(), repoRoot: root });
    return NextResponse.json({ root: abs, repos: scanRepositories(abs) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "扫描仓库失败" },
      { status: 400 },
    );
  }
}