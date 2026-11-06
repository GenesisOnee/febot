import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 把 example/demo-repo 复制成 .febot/demo-repo，并初始化一个独立的 git 仓库。
// 模板本身入库；生成物在 .febot/ 下，已被 gitignore，不会污染 febot 主仓。
//
// 用法：yarn demo:repo [--reset]
//   --reset 会删掉已有副本重新生成（演示期间产生的改动会丢失）。

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "example", "demo-repo");
const DST = path.join(ROOT, ".febot", "demo-repo");
const RESET = process.argv.includes("--reset");

function log(msg) {
  console.log(`[demo:repo] ${msg}`);
}

function fail(msg, next) {
  console.error(`[demo:repo] ${msg}`);
  console.error(`[demo:repo] 下一步：${next}`);
  process.exit(1);
}

function runGit(args) {
  try {
    execFileSync("git", args, { cwd: DST, stdio: "pipe", windowsHide: true });
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    fail(
      `git ${args.join(" ")} 失败（原因：${detail}）`,
      "确认已安装 git 并在 PATH 中，然后重新执行 yarn demo:repo"
    );
  }
}

export function ensureDemoRepo() {
  if (!fs.existsSync(SRC)) {
    fail(
      `找不到模板目录 ${SRC}`,
      "重新拉取仓库，或确认 example/demo-repo 没有被删除"
    );
  }

  if (RESET && fs.existsSync(DST)) {
    fs.rmSync(DST, { recursive: true, force: true });
    log("已清空旧副本");
  }

  if (fs.existsSync(path.join(DST, ".git"))) {
    log(`复用已有仓库 ${path.relative(ROOT, DST)}`);
    return DST;
  }

  fs.rmSync(DST, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(DST), { recursive: true });
  fs.cpSync(SRC, DST, {
    recursive: true,
    filter: (src) => path.basename(src) !== ".git" && path.basename(src) !== "node_modules",
  });
  log(`已复制模板到 ${path.relative(ROOT, DST)}`);

  runGit(["init"]);
  runGit(["symbolic-ref", "HEAD", "refs/heads/dev"]);
  runGit(["add", "-A"]);
  try {
    execFileSync(
      "git",
      [
        "-c",
        "user.name=febot demo",
        "-c",
        "user.email=demo@febot.local",
        "commit",
        "-m",
        "chore: init demo repo",
      ],
      { cwd: DST, stdio: "pipe", windowsHide: true }
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    fail(
      `初始化提交失败（原因：${detail}）`,
      "确认 git 可用后执行 yarn demo:repo --reset"
    );
  }
  log("已创建 dev 分支并完成首个提交");
  return DST;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureDemoRepo();
}
