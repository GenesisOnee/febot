import { NextResponse } from "next/server";
import { runSync } from "@/lib/server/tasks/sync-service";
import { TwLoginError } from "@/lib/server/teamwork/client";
import { MANUAL_SOURCE_ID } from "@/lib/server/task-sources/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SyncBody {
  source?: string;
  sourceId?: string;
  params?: Record<string, unknown>;
  /** 兼容旧前端：未传 source 时按协作平台处理 */
  user?: string;
  statuses?: string[];
  module?: string;
}

export async function POST(req: Request) {
  let body: SyncBody = {};
  try {
    body = (await req.json()) as SyncBody;
  } catch {
    // 空 body：走协作平台默认筛选
  }

  const sourceId = (body.source ?? body.sourceId ?? "teamwork").trim();
  if (!sourceId || sourceId === MANUAL_SOURCE_ID) {
    return NextResponse.json({ error: "请选择要同步的任务来源" }, { status: 400 });
  }

  const params: Record<string, unknown> = { ...(body.params ?? {}) };
  if (body.user !== undefined) params.user = body.user;
  if (body.statuses !== undefined) params.statuses = body.statuses;
  if (body.module !== undefined) params.module = body.module;

  try {
    const result = await runSync({ sourceId, params });
    return NextResponse.json({
      ...result,
      synced: result.created + result.updated + result.unchanged,
      errors: [],
    });
  } catch (e) {
    if (e instanceof TwLoginError) {
      return NextResponse.json({ error: e.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}