#!/usr/bin/env node
// 把 .github/labels.yml 同步到 GitHub 仓库（创建缺失的，更新颜色/描述）。
//
// 用法：
//   GITHUB_TOKEN=ghp_xxx yarn labels
//   GITHUB_TOKEN=... node scripts/labels.mjs --repo Zombiesix/febot --dry-run
//
// Token：classic PAT 勾 `repo`；fine-grained PAT 勾 Issues: Read and write。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const API = "https://api.github.com";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LABELS_FILE = path.join(ROOT, ".github", "labels.yml");

function fail(msg, next) {
  console.error(`[labels] ${msg}`);
  console.error(`[labels] 下一步：${next}`);
  process.exitCode = 1;
  throw new Error("__febot_fail__");
}

function parseArgs(argv) {
  const args = { repo: process.env.GITHUB_REPOSITORY || "", dryRun: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && argv[i + 1]) args.repo = argv[++i];
    else if (argv[i] === "--dry-run") args.dryRun = true;
    else if (argv[i] === "--help" || argv[i] === "-h") args.help = true;
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

// 只解析本文件用到的极简 YAML：- name / color / description 三个键。
function readLabels(file) {
  if (!fs.existsSync(file)) {
    fail(
      `找不到 ${path.relative(ROOT, file)}（原因：标签定义文件缺失）`,
      "从仓库重新拉取，或执行 git checkout -- .github/labels.yml",
    );
  }
  const labels = [];
  let cur = null;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;
    const item = line.match(/^-\s+name:\s*(.+)$/);
    if (item) {
      if (cur) labels.push(cur);
      cur = { name: item[1].trim().replace(/^["']|["']$/g, ""), color: "", description: "" };
      continue;
    }
    const field = line.match(/^\s+(color|description):\s*(.*)$/);
    if (field && cur) {
      cur[field[1]] = field[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  if (cur) labels.push(cur);
  if (labels.length === 0) {
    fail(
      `${path.relative(ROOT, file)} 里没有解析到标签（原因：格式不是 - name / color / description）`,
      "对照文件顶部的示例检查缩进；不要用 tab",
    );
  }
  for (const l of labels) {
    if (!/^[0-9a-fA-F]{6}$/.test(l.color)) {
      fail(
        `标签 "${l.name}" 的颜色 "${l.color}" 不合法（原因：需要 6 位十六进制，不带 #）`,
        "改成例如 \"0e8a16\"",
      );
    }
  }
  return labels;
}

async function gh(pathname, init = {}) {
  const res = await fetch(`${API}/repos/${repo}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "febot-labels-script",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    fail(
      "Token 无效或已过期（原因：GitHub 返回 401）",
      "重新生成 token；classic PAT 勾 `repo`，fine-grained PAT 勾 Issues: Read and write",
    );
  }
  if (res.status === 403 || res.status === 404) {
    fail(
      `无权读写 ${repo} 的标签（原因：GitHub 返回 ${res.status}）`,
      "确认 token 对应账号对该仓库有 write 权限；组织仓库可能需要在组织层批准 token",
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`请求 ${pathname} 失败（HTTP ${res.status}）`, `稍后重试；响应：${body.slice(0, 200)}`);
  }
  return res.status === 204 ? null : res.json();
}

const ARGS = parseArgs(process.argv.slice(2));
if (ARGS.help) {
  console.log("用法：GITHUB_TOKEN=... node scripts/labels.mjs [--repo Owner/Name] [--dry-run]");
  process.exit(0);
}

const token = process.env.GITHUB_TOKEN?.trim();
let repo = "";

async function main() {
  if (!token) {
    fail(
      "缺少 GITHUB_TOKEN（原因：同步标签需要仓库写权限的 token）",
      "新建 token 后执行 GITHUB_TOKEN=xxx yarn labels；或在浏览器按 .github/labels.yml 手动创建",
    );
  }
  repo = ARGS.repo || repoFromGit();
  if (!/^[^/]+\/[^/]+$/.test(repo)) {
    fail(
      `无法确定仓库（原因：当前值 "${repo || "(空)"}" 不是 Owner/Name）`,
      "显式传入：node scripts/labels.mjs --repo Zombiesix/febot",
    );
  }

  const desired = readLabels(LABELS_FILE);
  const existing = await gh("/labels?per_page=100");
  const byName = new Map((existing ?? []).map((l) => [l.name, l]));

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const label of desired) {
    const cur = byName.get(label.name);
    const body = { color: label.color, description: label.description };
    if (!cur) {
      if (ARGS.dryRun) {
        console.log(`[dry-run] 创建 ${label.name}（#${label.color}）`);
      } else {
        await gh("/labels", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: label.name, ...body }),
        });
        console.log(`创建 ${label.name}（#${label.color}）`);
      }
      created += 1;
    } else if (cur.color.toLowerCase() !== label.color.toLowerCase() || (cur.description ?? "") !== label.description) {
      if (ARGS.dryRun) {
        console.log(
          `[dry-run] 更新 ${label.name}：#${cur.color} → #${label.color}，"${cur.description ?? ""}" → "${label.description}"`,
        );
      } else {
        await gh(`/labels/${encodeURIComponent(label.name)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        console.log(`更新 ${label.name}`);
      }
      updated += 1;
    } else {
      skipped += 1;
    }
  }

  console.log(`\n完成：新建 ${created}，更新 ${updated}，未变 ${skipped}（共 ${desired.length} 个）`);
  if (ARGS.dryRun) console.log("--dry-run：没有发出任何写请求。");
}

main().catch((e) => {
  if (e instanceof Error && e.message === "__febot_fail__") return;
  console.error(`[labels] 未预期的错误：${e instanceof Error ? e.message : String(e)}`);
  console.error("[labels] 下一步：检查网络与 GitHub API 状态；若持续失败，带上完整报错开 Issue。");
  process.exitCode = 1;
});