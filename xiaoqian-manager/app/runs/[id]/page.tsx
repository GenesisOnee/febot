import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// 兼容入口：旧链接与浏览器通知仍用 /runs/<id>，统一回到工作台右栏。
export default async function RunSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/?run=${encodeURIComponent(id)}`);
}