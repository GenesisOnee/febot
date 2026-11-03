import path from "node:path";

// 工作区路径的唯一事实源。
//
// 桌面端由 Electron 主进程显式注入 FEBOT_WORKSPACE；本地开发不设置时回退到
// 现有仓库布局（xiaoqian-manager 的上级目录），与改造前逐字节等价。
//
// 注意：Next standalone 产物会在启动时 process.chdir(__dirname)，因此这里的
// 路径必须在模块加载期就解析成绝对路径，不能延后到请求时才读 cwd。

const WS = process.env.FEBOT_WORKSPACE?.trim();

/** 工作区根：桌面端显式注入；本地开发回退为 xiaoqian-manager 的上级目录 */
export const WORKSPACE_ROOT = WS ? path.resolve(WS) : path.resolve(process.cwd(), "..");

/** 数据目录：保持与现有仓库布局一致（<workspace>/xiaoqian-manager/data） */
export const DATA_DIR = path.join(WORKSPACE_ROOT, "xiaoqian-manager", "data");

/** 配置路径：优先显式 env，其次工作区根 */
export const CONFIG_PATH = process.env.FEBOT_CONFIG?.trim()
  ? path.resolve(process.env.FEBOT_CONFIG.trim())
  : path.join(WORKSPACE_ROOT, "febot.config.json");