import { NextResponse } from "next/server";
import { z } from "zod";
import { createTask, readTasks } from "@/lib/server/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CreateBody = z.object({
  title: z.string().trim().min(1, "标题不能为空"),
  module: z.string().trim().min(1, "模块不能为空"),
  assignee: z.string().optional(),
  customerName: z.string().optional(),
  demandLevel: z.string().optional(),
  description: z.string().optional(),
  plannedDescription: z.string().optional(),
  assignDescription: z.string().optional(),
  createdName: z.string().optional(),
});

export async function POST(req: Request) {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体不是合法 JSON" }, { status: 400 });
  }
  const parsed = CreateBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "请求体校验失败" },
      { status: 400 },
    );
  }
  try {
    const task = await createTask(parsed.data);
    return NextResponse.json({ task }, { status: 201 });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "新建任务失败" },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim().toLowerCase() ?? "";
    const moduleFilter = url.searchParams.get("module")?.trim() ?? "";
    const data = readTasks();
    let tasks = data.tasks;
    const updatedAt = data.updatedAt;
    if (q) {
      tasks = tasks.filter((t) =>
        `${t.title} ${t.id} ${t.module}`.toLowerCase().includes(q)
      );
    }
    if (moduleFilter) {
      tasks = tasks.filter((t) => t.module === moduleFilter);
    }
    // 列表不返回 trajectory 与大段描述（体积大），展开时走 /api/tasks/[id]
    const list = tasks.map(
      ({
        trajectory: _traj,
        description: _desc,
        plannedDescription: _pd,
        assignDescription: _ad,
        attachments: _at,
        ...rest
      }) => rest
    );
    return NextResponse.json({ tasks: list, updatedAt });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "unknown error" },
      { status: 500 }
    );
  }
}
