import { NextResponse } from "next/server";
import { z } from "zod";
import { StageStatus } from "@/lib/domain/schema";
import { applyStageTransition } from "@/lib/server/stages/transition";
import { StageTransitionError } from "@/lib/server/stages/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 旧接口保留为薄适配层：内部转调通用阶段转换。
// 新代码请使用 PATCH /api/tasks/[id]/stages/[stageKey]。

const Body = z.object({
  stageKey: z.string().min(1),
  status: StageStatus,
  owner: z.string().optional(),
  note: z.string().optional(),
  plannedDescription: z.string().optional(),
  // 兼容别名：旧「直接完成」不操作仓库代码；远程完成仍按来源执行
  skipGit: z.boolean().optional(),
  localOnly: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "请求体校验失败" }, { status: 400 });
  }
  const { stageKey, status, owner, note, plannedDescription, skipGit, localOnly } =
    parsed.data;
  try {
    const task = await applyStageTransition(id, stageKey, {
      status,
      owner,
      note,
      payload: plannedDescription !== undefined ? { plannedDescription } : {},
      options: { skipGit, localOnly },
    });
    return NextResponse.json({ task });
  } catch (e) {
    if (e instanceof StageTransitionError) {
      return NextResponse.json(
        { error: e.message, code: e.code },
        { status: e.status }
      );
    }
    console.error(`[stage] ${id} PATCH 执行失败`, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}