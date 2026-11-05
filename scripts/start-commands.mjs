#!/usr/bin/env node
/**
 * start-commands - 汇总 gitlab/ 下所有项目的启动指令
 *
 * 数据来源：
 *   1. 各仓 README.md 中的 dev / start / serve 命令
 *      （扫描 fenced code、行内代码、列表项三类位置）；
 *   2. README 未给出时，回退 package.json 的 dev / start / serve 脚本。
 *
 * 结果维护到集合文件 docs/start-commands.md，并在终端打印。
 *
 * 用法：
 *   yarn start:list              # 更新集合文件并打印
 *   yarn start:list --json       # 只输出 JSON（不写文件）
 *   yarn start:list --no-write   # 只打印，不更新集合文件
 *   node scripts/start-commands.mjs --root ../other-gitlab
 *
 * 退出码：0 成功；5 参数错误；6 配置 / 仓库根目录错误。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  ScriptError,
  displayPath,
  readConfig,
  readText,
  reposRoot,
  writeTextAtomic,
} from "./lib/febot.mjs";

const OUTPUT_PATH = path.join(ROOT, "docs", "start-commands.md");

const HELP = `start-commands - 打印 gitlab/ 下所有项目的启动指令

用法：node scripts/start-commands.mjs [选项]

选项：
  --json        只输出 JSON，不写集合文件
  --no-write    只打印，不更新集合文件
  --root <dir>  指定仓库根目录（默认取 febot.config.json 的 repoRoot）
  -h, --help    显示帮助
`;

// ---------- 参数 ----------

function parseArgs(argv) {
  const out = { json: false, write: true, root: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--json") out.json = true;
    else if (a === "--no-write") out.write = false;
    else if (a === "-h" || a === "--help") out.help = true;
    else if (a === "--root") {
      const v = argv[i + 1];
      if (!v || v.startsWith("--")) throw new ScriptError(5, "--root 缺少目录参数");
      out.root = v;
      i += 1;
    } else throw new ScriptError(5, `未知参数：${a}`);
  }
  return out;
}

// ---------- README 抽取 ----------

/** 包管理器命令：yarn / npm / pnpm / npx pnpm@N，后接脚本名 */
const PM_CMD_RE =
  /(?:^|[\s`(（])((?:npx\s+pnpm@[\d.]+\s+|(?:yarn|npm|pnpm)\s+)(?:run\s+)?[A-Za-z][\w:.-]*)/g;

/** 解析一条候选文本；不是启动命令返回 null */
function parseStartCommand(text) {
  if (!text) return null;
  let cmd = String(text).trim().replace(/^\$\s+/, "").replace(/\s+#.*$/, "").trim();
  cmd = cmd.replace(/[，,；;。)）\]】]+$/, "").trim();
  const m = cmd.match(
    /^(npx\s+pnpm@[\d.]+\s+(?:run\s+)?|(?:yarn|npm|pnpm)\s+(?:run\s+)?)([A-Za-z][\w:.-]*)(?:\s+.*)?$/,
  );
  if (!m) return null;
  const script = m[2];
  if (!/^(?:dev|start|serve)(?::[A-Za-z0-9_.-]+)?$/.test(script)) return null;
  return { command: cmd, script };
}

/** 从 README 文本抽取启动命令，保持出现顺序并去重 */
function extractFromReadme(text) {
  const found = [];
  const lines = String(text).split(/\r?\n/);
  let fence = null;

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const line = raw.trim();
    const fenceMatch = line.match(/^(```+|~~~+)/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (line[0] === fence) fence = null;
      continue;
    }

    const source = `README.md:${i + 1}`;
    if (fence) {
      if (!line || /^[#/]/.test(line)) continue; // 代码块里的注释行
      const parsed = parseStartCommand(line);
      if (parsed) found.push({ ...parsed, source });
      continue;
    }

    // 行内代码：`yarn dev`
    for (const m of raw.matchAll(/`([^`\n]+)`/g)) {
      const parsed = parseStartCommand(m[1]);
      if (parsed) found.push({ ...parsed, source });
    }

    // 列表项里的裸命令：- 示例产品 J 启动 yarn dev:module-a
    if (/^\s*[-*+]\s+/.test(raw)) {
      for (const m of raw.matchAll(PM_CMD_RE)) {
        const parsed = parseStartCommand(m[1]);
        if (parsed) found.push({ ...parsed, source });
      }
    }
  }

  const seen = new Set();
  return found.filter((c) => {
    const key = c.command.replace(/\s+/g, " ");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- package.json 回退 ----------

function readPackage(repoDir) {
  const p = path.join(repoDir, "package.json");
  if (!fs.existsSync(p)) return null;
  try {
    const pkg = JSON.parse(readText(p));
    return pkg && typeof pkg === "object" ? pkg : null;
  } catch {
    return null;
  }
}

function commandFor(pm, script) {
  return pm === "npm" ? `npm run ${script}` : `${pm} ${script}`;
}

/** 从 package.json 脚本推断启动指令：dev/start/serve 优先，其次 dev:* 等变体 */
function fallbackCommands(pkg, pm) {
  const scripts = pkg && pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};
  const names = Object.keys(scripts);
  const picked = [];
  for (const k of ["dev", "start", "serve"]) if (k in scripts) picked.push(k);
  for (const k of names) if (/^(?:dev|start|serve):/.test(k)) picked.push(k);
  return [...new Set(picked)].map((k) => ({
    command: commandFor(pm, k),
    script: k,
    source: `package.json:scripts.${k}`,
  }));
}

// ---------- 包管理器 ----------

function pmOfCommand(cmd) {
  if (/^npx\s+pnpm@/.test(cmd)) return "pnpm";
  const m = cmd.match(/^(yarn|npm|pnpm)\b/);
  return m ? m[1] : null;
}

function declaredPackageManager(readme) {
  if (/npx\s+pnpm@\d/.test(readme) || /强制使用\s*pnpm|统一使用\s*`?pnpm/.test(readme)) return "pnpm";
  if (/统一使用\s*`?yarn|使用\s*`?yarn\s*作为包管理/.test(readme)) return "yarn";
  return null;
}

function detectPmByLockfile(repoDir) {
  const has = (f) => fs.existsSync(path.join(repoDir, f));
  // 同时存在多个锁文件时按本工作区约定优先 yarn
  if (has("yarn.lock")) return "yarn";
  if (has("pnpm-lock.yaml")) return "pnpm";
  if (has("package-lock.json")) return "npm";
  return "npm";
}

function resolvePackageManager(repoDir, readme, commands) {
  return (
    declaredPackageManager(readme) ||
    (commands[0] && pmOfCommand(commands[0].command)) ||
    detectPmByLockfile(repoDir)
  );
}

// ---------- 汇总 ----------

function repositoriesOf(cfg) {
  const list = cfg?.raw?.repositories;
  return Array.isArray(list)
    ? list.filter((r) => r && typeof r.name === "string" && r.name.trim())
    : [];
}

function listRepos(cfg, root) {
  const configured = repositoriesOf(cfg).map((r) => r.name.trim());
  if (configured.length) return configured;
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => e.name)
    .sort();
}

function productOf(cfg, repo) {
  const entry = repositoriesOf(cfg).find((r) => r.name.trim() === repo);
  const projects = Array.isArray(entry?.projects) ? entry.projects : [];
  const names = [
    ...new Set(
      projects
        .filter((p) => p && typeof p.name === "string" && p.name.trim())
        .map((p) => p.name.trim()),
    ),
  ];
  return names.join(" / ");
}

function collectRepo(repo, repoDir, cfg) {
  const notes = [];
  const entry = {
    repo,
    products: productOf(cfg, repo),
    dir: repoDir,
    packageManager: "npm",
    commands: [],
    notes,
  };

  if (!fs.existsSync(repoDir)) {
    notes.push("仓库目录不存在");
    return entry;
  }

  const readmePath = ["README.md", "readme.md", "Readme.md"]
    .map((f) => path.join(repoDir, f))
    .find((p) => fs.existsSync(p));
  const readme = readmePath ? readText(readmePath) : "";
  const pkg = readPackage(repoDir);
  const readmeCommands = readmePath ? extractFromReadme(readme) : [];
  const pm = resolvePackageManager(repoDir, readme, readmeCommands);
  entry.packageManager = pm;

  if (readmeCommands.length) {
    entry.commands = readmeCommands;
    // README 只写了 dev:* 时，补上 package.json 里缺失的 dev/start/serve 主脚本
    const mainPm = pmOfCommand(readmeCommands[0].command) || pm;
    if (pkg?.scripts && typeof pkg.scripts === "object") {
      for (const k of ["dev", "start", "serve"]) {
        if (k in pkg.scripts && !entry.commands.some((c) => c.script === k)) {
          entry.commands.push({
            command: commandFor(mainPm, k),
            script: k,
            source: `package.json:scripts.${k}`,
          });
        }
      }
    }
    if (pkg?.scripts && Object.keys(pkg.scripts).some((k) => /^(?:dev|start|serve):/.test(k))) {
      notes.push("存在多个 dev:* 入口，已按 README 列出的为准");
    }
  } else {
    entry.commands = fallbackCommands(pkg, pm);
    if (entry.commands.length) notes.push("README 未给出启动命令，回退 package.json");
    else notes.push("README / package.json 均未找到启动脚本");
  }

  return entry;
}

// ---------- 输出 ----------

function renderMarkdown(result) {
  const lines = [
    "# 启动指令集合",
    "",
    "> 由 `yarn start:list` 自动生成（脚本：`scripts/start-commands.mjs`），请勿手改。",
    "> 数据来源：各仓 `README.md` 的 dev / start / serve 命令；README 未给出时回退 `package.json` 脚本。",
    "",
    "| 项目 | 产品 | 包管理器 | 启动指令 | 来源 |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const r of result.repos) {
    const products = r.products || "-";
    if (!r.commands.length) {
      lines.push(`| ${r.repo} | ${products} | ${r.packageManager} | - | ${r.notes.join("；") || "未找到"} |`);
      continue;
    }
    for (const c of r.commands) {
      lines.push(`| ${r.repo} | ${products} | ${r.packageManager} | \`${c.command}\` | ${c.source} |`);
    }
  }

  const noted = result.repos.filter((r) => r.notes.length);
  if (noted.length) {
    lines.push("", "## 备注", "");
    for (const r of noted) {
      for (const n of r.notes) lines.push(`- **${r.repo}**：${n}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}

function printConsole(result) {
  const total = result.repos.reduce((n, r) => n + r.commands.length, 0);
  console.log(`启动指令集合：${result.repos.length} 个项目 / ${total} 条指令`);
  console.log(`仓库根：${displayPath(result.root)}`);

  for (const r of result.repos) {
    console.log("");
    console.log(`■ ${r.repo}${r.products ? `（${r.products}）` : ""}  [${r.packageManager}]`);
    if (!r.commands.length) {
      console.log("  （未找到启动指令）");
    } else {
      for (const c of r.commands) console.log(`  - ${c.command.padEnd(34)} ${c.source}`);
    }
    for (const n of r.notes) console.log(`  ! ${n}`);
  }

  if (result.written) console.log(`\n已更新集合文件：${displayPath(result.written)}`);
}

// ---------- 入口 ----------

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(HELP);
    return;
  }

  const cfg = readConfig();
  const root = args.root ? path.resolve(args.root) : reposRoot(cfg);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new ScriptError(6, `仓库根目录不存在：${root}`);
  }

  const result = {
    root,
    repos: listRepos(cfg, root).map((repo) => collectRepo(repo, path.join(root, repo), cfg)),
  };

  if (args.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (args.write) {
    writeTextAtomic(OUTPUT_PATH, renderMarkdown(result));
    result.written = OUTPUT_PATH;
  }

  printConsole(result);
}

try {
  main();
} catch (e) {
  if (e instanceof ScriptError) {
    console.error(`[start-commands] ${e.message}`);
    process.exit(e.code || 1);
  }
  throw e;
}
