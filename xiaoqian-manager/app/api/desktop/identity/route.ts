import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 仅桌面端使用：守护进程用随机 instance 确认「这个端口上响应的是我自己拉起的 Next」，
// 避免端口被占用时把别的服务误判为就绪。浏览器直接访问只会看到 null。
export async function GET() {
  return NextResponse.json({ instance: process.env.FEBOT_DESKTOP_INSTANCE ?? null });
}