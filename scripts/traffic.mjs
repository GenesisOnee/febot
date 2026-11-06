#!/usr/bin/env node
// 每周 GitHub Traffic 记录：views / clones / referrers / popular paths。
//
// 用法：
//   GITHUB_TOKEN=ghp_xxx node scripts/traffic.mjs
//   GITHUB_TOKEN=... node scripts/traffic.mjs --repo Zombiesix/febot
//
// Token 需要能读仓库流量（对仓库有 push 权限的 classic PAT 勾 `repo`，
// 或 fine-grained PAT 勾 Repository → Administration: Read）。
// 数据只写 .febot/metrics/traffic.csv（已 gitignore），并打印最近几周的 Markdown 行。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, ".febot", "metrics");
const CSV = path.join(OUT_DIR, "traffic.csv");

function fail(msg, next) {
  console.error(`[traffic] ${msg}`);
  console.error(`[traffic] 下一步：${next}`);
  process.exitCode = 1;
  throw new Error("__febot_fail__");
}

function parseArgs(argv) {
  const args = { repo: process.env.GITHUB_REPOSITORY || "", help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && argv[i + 1]) {
      args.repo = argv[++i];
    } else if (argv[i] === "--help" || argv[i] === "-h") {
      args.help = true;
    }
  }
  return args;
}

function repoFromGit() {
  try {
    const url = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim();
    const m = url.match(/github\.com[:/]+([^/]+)\/([^/.]+)(?:\.git)?$/i);
    return m ? `${m[1]}/${m[2]}` : "";
  } catch {
    return "";
  }
}

const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) {
  console.log("用法：GITHUB_TOKEN=... node scripts/traffic.mjs [--repo Owner/Name]");
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN?.trim();
let repo = "";

async function api(pathname) {
  const res = await fetch(`${API}/repos/${repo}${pathname}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "febot-traffic-script",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (res.status === 401) {
    fail(
      "Token 无效或已过期（原因：GitHub 返回 401）",
      "重新生成 token；classic PAT 勾 `repo`，fine-grained PAT 勾 Repository → Administration: Read",
    );
  }
  if (res.status === 403 || res.status === 404) {
    fail(
      `无权读取 ${repo} 的流量数据（原因：${pathname} 返回 ${res.status}，Traffic API 要求对该仓库有 push 权限）`,
      "确认 token 对应账号是该仓库的 collaborator；fork 仓库或组织仓库可能拿不到 traffic 权限",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`请求 ${pathname} 失败（HTTP ${res.status}）`, `稍后重试；响应：${body.slice(0, 200)}`);
  }
  return res.json();
}

function isoWeekStart(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // 周一 = 1
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

function aggregate(entries) {
  const weeks = new Map();
  for (const e of entries ?? []) {
    const key = isoWeekStart(String(e.timestamp).slice(0, 10));
    const cur = weeks.get(key) ?? { views: 0, uniques: 0 };
    cur.views += e.count ?? 0;
    cur.uniques += e.uniques ?? 0;
    weeks.set(key, cur);
  }
  return weeks;
}

function readCsv(file) {
  if (!fs.existsSync(file)) return new Map();
  const rows = fs.readFileSync(file, "utf8").trim().split(/\r?\n/);
  const map = new Map();
  for (const line of rows.slice(1)) {
    const [week, views, visitors, clones, cloners] = line.split(",");
    if (!week) continue;
    map.set(week, {
      views: Number(views) || 0,
      visitors: Number(visitors) || 0,
      clones: Number(clones) || 0,
      cloners: Number(cloners) || 0,
    });
  }
  return map;
}

function writeCsv(file, map) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const lines = ["week_start,views,unique_visitors,clones,unique_cloners"];
  for (const week of [...map.keys()].sort()) {
    const r = map.get(week);
    lines.push([week, r.views, r.visitors, r.clones, r.cloners].join(","));
  }
  fs.writeFileSync(file, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  if (!token) {
    fail(
      "缺少 GITHUB_TOKEN（原因：Traffic API 必须带仓库读权限的 token）",
      "在 GitHub Settings → Developer settings → Personal access tokens 新建 token，然后执行 GITHUB_TOKEN=xxx node scripts/traffic.mjs",
    );
  }

  repo = ARGS.repo || repoFromGit();
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    fail(
      `无法确定仓库（原因：当前值 "${repo || "(空)"}" 不是 Owner/Name）`,
      "显式传入：node scripts/traffic.mjs --repo Zombiesix/febot",
    );
  }

  // 顺序请求：401/403 时只报一次，不把四个失败堆在一起
  const views = await api("/traffic/views?per=week");
  const clones = await api("/traffic/clones?per=week");
  // referrers 的真实路径是 /traffic/popular/referrers，且不接受 per 参数
  const referrers = await api("/traffic/popular/referrers");
  const paths = await api("/traffic/popular/paths");

  const rows = readCsv(CSV);
  const viewWeeks = aggregate(views.views);
  const cloneWeeks = aggregate(clones.clones);
  for (const week of new Set([...viewWeeks.keys(), ...cloneWeeks.keys()])) {
    const cur = rows.get(week) ?? { views: 0, visitors: 0, clones: 0, cloners: 0 };
    const v = viewWeeks.get(week);
    const c = cloneWeeks.get(week);
    if (v) {
      cur.views = v.views;
      cur.visitors = v.uniques;
    }
    if (c) {
      cur.clones = c.views;
      cur.cloners = c.uniques;
    }
    rows.set(week, cur);
  }
  writeCsv(CSV, rows);

  const recent = [...rows.keys()].sort().slice(-6);
  console.log(`\nGitHub Traffic · ${repo}`);
  console.log(`CSV：${path.relative(ROOT, CSV)}\n`);
  console.log("| 周起始 | Views | Unique visitors | Clones | Unique cloners |");
  console.log("| --- | --- | --- | --- | --- |");
  for (const week of recent) {
    const r = rows.get(week);
    console.log(`| ${week} | ${r.views} | ${r.visitors} | ${r.clones} | ${r.cloners} |`);
  }

  console.log("\n参考来源（近 14 天）：");
  for (const r of referrers ?? []) {
    if (r.referrer === "github.com") continue;
    console.log(`- ${r.referrer}: ${r.count} 次（${r.uniques} 人）`);
  }

  console.log("\n热门页面（近 14 天）：");
  for (const p of (paths ?? []).slice(0, 10)) {
    console.log(`- ${p.path}: ${p.count} 次（${p.uniques} 人）`);
  }
  console.log("\n把上面的表格行贴进 .febot/metrics/weekly-report.md 对应周次。");
}

main().catch((e) => {
  if (e instanceof Error && e.message === "__febot_fail__") return;
  console.error(`[traffic] 未预期的错误：${e instanceof Error ? e.message : String(e)}`);
  console.error("[traffic] 下一步：检查网络与 GitHub API 状态；若持续失败，带上完整报错开 Issue。");
  process.exitCode = 1;
});