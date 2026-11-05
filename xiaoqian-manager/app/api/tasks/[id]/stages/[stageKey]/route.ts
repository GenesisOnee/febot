import { NextResponse } from "next/server";
import { z } from "zod";
import { StageStatus } from "@/lib/domain/schema";
import { applyStageTransition } from "@/lib/server/stages/transition";
import { StageTransitionError } from "@/lib/server/stages/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  status: StageStatus,
  owner: z.string().optional(),
  note: z.string().optional(),
  // 仅「计划」节点使用：研发人员整理后的需求描述
  plannedDescription: z.string().optional(),
  // 兼容旧「直接完成」参数；阶段完成本身不再操作仓库代码
  skipGit: z.boolean().optional(),
  // 来源未配置完成脚本时，用户二次确认后仅本地完成
  localOnly: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; stageKey: string }> }
) {
  const { id, stageKey } = await params;
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
  const { status, owner, note, plannedDescription, skipGit, localOnly } = parsed.data;
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
    console.error(`[stages] ${id}/${stageKey} 转换失败`, e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}