import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// allowedDevOrigins 来自仓库根的 febot.config.json（不入库）。
// 这里就地读而不是 import lib/server/config/root：next.config 的加载上下文里
// 路径别名不可靠，且它只需要这一个字段。
function readNextDevOrigins(): string[] {
  const candidates = [
    process.env.FEBOT_CONFIG ? path.resolve(process.env.FEBOT_CONFIG) : "",
    path.join(process.cwd(), "febot.config.json"),
    path.join(process.cwd(), "..", "febot.config.json"),
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = JSON.parse(fs.readFileSync(p, "utf8")) as { nextDevOrigins?: unknown };
      const v = raw.nextDevOrigins;
      if (Array.isArray(v)) {
        return v.filter((o): o is string => typeof o === "string" && o.trim() !== "").map((o) => o.trim());
      }
      return [];
    } catch {
      // 配置读不了就当没配，不阻塞 dev server 启动
    }
  }
  return [];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: readNextDevOrigins(),
  // 演示模式用独立构建目录：Next 16 的 dev server 按 distDir 加锁，
  // 否则 yarn demo 会因为你已经开着一个 yarn dev 而直接退出。
  distDir: process.env.FEBOT_DIST_DIR?.trim() || ".next",
  // 桌面端（resources/next）以 standalone server 启动；dev 下该选项无副作用。
  output: "standalone",
  // 关键安全项：Next 的文件追踪会把构建机的 data/ 原样打进 standalone 产物，
  // 其中含 tasks.json、runs/、runner.json（真实 token）与 .tw-cookie.json。
  // 桌面端构建脚本还会二次断言，双保险。
  outputFileTracingExcludes: {
    "*": ["./data/**"],
  },
};

export default nextConfig;
