import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

// yarn demo：不填配置、不启动 runner，直接看队列 / 计划 / 审阅 / 会话。
//
// 数据隔离：
//   example/demo/*           入库的静态夹具（任务、run、diff、事件、终端快照）
//   .febot/demo-workspace/   运行时工作区（每次启动重建，被 gitignore）
//   .febot/demo-repo/        最小示例仓（独立 git 仓库，dev 分支）
//
// 真实安装/配置不会被读取或改写。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WS = path.join(ROOT, ".febot", "demo-workspace");
const FIXTURES = path.join(ROOT, "example", "demo");
const APP = path.join(ROOT, "xiaoqian-manager");

function fail(msg, next) {
  console.error(`[demo] ${msg}`);
  console.error(`[demo] 下一步：${next}`);
  process.exit(1);
}

function seedWorkspace() {
  const dataDir = path.join(WS, "xiaoqian-manager", "data");
  try {
    fs.rmSync(WS, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });
    fs.cpSync(path.join(FIXTURES, "tasks.json"), path.join(dataDir, "tasks.json"));
    fs.cpSync(path.join(FIXTURES, "febot.config.json"), path.join(WS, "febot.config.json"));
  } catch (e) {
    fail(
      `重建演示工作区失败（原因：${e instanceof Error ? e.message : String(e)}）`,
      "确认 .febot 目录可写，并且 example/demo/ 没有被删除；必要时重新拉取仓库"
    );
  }
  console.log(`[demo] 已重建演示工作区 ${path.relative(ROOT, WS)}`);
}

if (!fs.existsSync(path.join(APP, "node_modules", "next"))) {
  fail(
    "xiaoqian-manager 依赖未安装（原因：node_modules/next 不存在）",
    "先在项目根目录执行 yarn setup，再执行 yarn demo"
  );
}

const init = spawnSync(process.execPath, [path.join(ROOT, "scripts", "init-demo-repo.mjs")], {
  stdio: "inherit",
  windowsHide: true,
});
if (init.status !== 0) process.exit(init.status ?? 1);

seedWorkspace();

function listening(host, port) {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (busy) => {
      sock.destroy();
      resolve(busy);
    };
    // 连不上（ECONNREFUSED）才算空闲；超时按占用处理，宁可换端口
    sock.setTimeout(600, () => done(true));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

async function portFree(port) {
  if (await listening("127.0.0.1", port)) return false;
  if (await listening("::1", port)) return false;
  // 兜底再试一次绑定：覆盖只监听通配地址、但不接受连接的特殊情况
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => srv.close(() => resolve(true)));
    srv.listen(port);
  });
}

// 默认从 3010 开始找空闲端口；显式指定 FEBOT_PORT 时不动，占用了就明确报错。
let PORT;
if (process.env.FEBOT_PORT) {
  PORT = Number(process.env.FEBOT_PORT);
  if (!Number.isInteger(PORT) || PORT <= 0) {
    fail(`FEBOT_PORT=${process.env.FEBOT_PORT} 不是合法端口`, "写成 3000–65535 之间的整数，例如 FEBOT_PORT=3011");
  }
  if (!(await portFree(PORT))) {
    fail(
      `端口 ${PORT} 已被占用（原因：本机已经有一个 dev server 在跑）`,
      "换一个端口：FEBOT_PORT=3011 yarn demo；或先停掉占用该端口的进程"
    );
  }
} else {
  for (let p = 3010; p <= 3030; p += 1) {
    if (await portFree(p)) {
      PORT = p;
      break;
    }
  }
  if (!PORT) fail("3010–3030 端口全部被占用", "用 FEBOT_PORT 指定一个空闲端口，例如 FEBOT_PORT=3050 yarn demo");
}

const env = {
  ...process.env,
  FEBOT_DEMO: "1",
  FEBOT_WORKSPACE: WS,
  FEBOT_CONFIG: path.join(WS, "febot.config.json"),
  FEBOT_DEMO_DIR: FIXTURES,
  // 独立 .next，避免和已经在跑的 yarn dev 抢 dev server 锁
  FEBOT_DIST_DIR: ".next-demo",
};

console.log("");
if (PORT !== 3010) console.log(`[demo] 3010 已被占用，改用 ${PORT}`);
console.log(`演示模式： http://localhost:${PORT}`);
console.log("  /            任务队列（计划弹窗、会话面板）");
console.log("  /review      待审队列（含 1 个待审 diff）");
console.log("");
console.log("演示数据只写 .febot/demo-workspace，不会读写你的业务仓库。");
console.log("按 Ctrl+C 退出。");
console.log("");

const nextBin = path.join(APP, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
  cwd: APP,
  env,
  stdio: "inherit",
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  child.kill();
  process.exit(code);
}

child.on("exit", (code) => {
  if (!shuttingDown) process.exit(code ?? 0);
});
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
