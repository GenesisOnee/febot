/**
 * 需求 / 仓库 / 分支解析。
 *
 * 从 feed.mjs / recon.mjs 抽出，避免两套 tasks.md 与 repositories[] 语义漂移。
 * 纯函数优先；调用方（feed / recon / locate / advance）按自己的退出码契约
 * 把 ScriptError 转换出去。
 */
import fs from "node:fs";
import path from "node:path";
import {
  ALIAS_RE,
  REQUIREMENTS_DIR,
  ROOT,
  ScriptError,
  TASKS_PATH,
  displayPath,
  readText,
  reposRoot,
  section,
} from "./febot.mjs";

/** 需求目录与 state 路径 */
export function requirementPaths(alias) {
  const reqDir = path.join(REQUIREMENTS_DIR, alias);
  return {
    alias,
    reqDir,
    contextPath: path.join(reqDir, "context.md"),
    statePath: path.join(reqDir, "state.json"),
  };
}

function assertAlias(alias) {
  if (!alias || !ALIAS_RE.test(alias)) {
    throw new ScriptError(5, `别名不合法：${alias ?? "（空）"}（只允许 "R-" 后接字母、数字、连字符）`);
  }
}

/**
 * 读需求：context.md 全文 + 标题 + 描述 + state（可能不存在）。
 * 不跑 git、不改任何文件。
 */
export function readRequirement(alias) {
  assertAlias(alias);
  const paths = requirementPaths(alias);
  if (!fs.existsSync(paths.contextPath)) {
    throw new ScriptError(5, `context.md 不存在：${displayPath(paths.contextPath)}（请先跑 feed）`, {
      contextPath: displayPath(paths.contextPath),
    });
  }
  const context = readText(paths.contextPath);
  let state = null;
  if (fs.existsSync(paths.statePath)) {
    try {
      state = JSON.parse(readText(paths.statePath));
    } catch {
      throw new ScriptError(6, `state.json 不是合法 JSON：${displayPath(paths.statePath)}`);
    }
  }
  return {
    ...paths,
    context,
    title: section(context, "需求标题"),
    description: section(context, "需求描述（全文）"),
    state,
  };
}

/**
 * 解析 tasks.md 中该别名的行。
 * 列：| 需求ID | 项目 | 优先级 | tier | 仓库 | 状态 | 入口 |
 */
export function parseTasksRow(alias) {
  if (!fs.existsSync(TASKS_PATH)) {
    throw new ScriptError(6, `tasks.md 不存在：${displayPath(TASKS_PATH)}（请先跑 yarn setup 生成）`);
  }
  const lines = fs.readFileSync(TASKS_PATH, "utf8").split(/\r?\n/);
  const idx = lines.findIndex(
    (l) => l.startsWith("|") && l.split("|").map((s) => s.trim())[1] === alias,
  );
  if (idx < 0) throw new ScriptError(6, `tasks.md 中找不到 ${alias} 的行，请先重跑 feed`);
  const cells = lines[idx].split("|").map((s) => s.trim());
  return {
    line: idx,
    cells,
    project: cells[2] || null,
    priority: cells[3] || null,
    tier: cells[4] || null,
    repo: cells[5] && cells[5] !== "-" ? cells[5] : null,
    status: cells[6] || null,
    entry: cells[7] || null,
  };
}

/** 仓库注册表（新 schema）：repositories[] */
export function repositoryEntries(cfg) {
  const list = cfg?.raw?.repositories;
  return Array.isArray(list) ? list.filter((r) => r && typeof r.name === "string" && r.name.trim()) : [];
}

/**
 * 分支解析：repositories[repo].devBranch > defaults.devBranch。
 * 与 App 端 deriveGitOptions 同语义。
 */
export function resolveBranch(cfg, _entry, repo) {
  const entry = repositoryEntries(cfg).find((r) => r.name.trim() === repo);
  if (entry && typeof entry.devBranch === "string" && entry.devBranch.trim()) {
    return { branch: entry.devBranch.trim(), source: "repositories.devBranch" };
  }
  const dev = cfg?.raw?.defaults?.devBranch;
  if (typeof dev === "string" && dev.trim()) {
    return { branch: dev.trim(), source: "defaults.devBranch" };
  }
  throw new ScriptError(
    6,
    `无法确定仓库 ${repo} 的基准分支：请配置 repositories[].devBranch 或 defaults.devBranch`,
    { repo },
  );
}

/** 把 repositories[].projects 摊平成 { product, keywords, repo } 列表 */
export function deriveProjectMap(cfg) {
  const out = [];
  for (const repo of repositoryEntries(cfg)) {
    const projects = Array.isArray(repo.projects) ? repo.projects : [];
    for (const p of projects) {
      if (!p || typeof p.name !== "string" || !p.name.trim()) continue;
      out.push({
        product: p.name.trim(),
        keywords: Array.isArray(p.keywords) ? p.keywords : [],
        repo: repo.name.trim(),
      });
    }
  }
  return out;
}

/**
 * repositories[] 定仓：产品/模块精确匹配 + 标题 keywords + 无关键词兜底。
 * 返回 { repo, repoDir, branch, branchSource }；未命中抛 2，配置歧义抛 6。
 */
export function resolveRepo(cfg, module, title) {
  const projectMap = deriveProjectMap(cfg);
  if (projectMap.length === 0) {
    throw new ScriptError(
      6,
      "febot.config.json 的 repositories[] 里没有任何 projects（请参考 example/febot.config.json）",
    );
  }

  const candidates = projectMap.filter((e) => e && e.product === module);
  if (candidates.length === 0) {
    const known = [...new Set(projectMap.map((e) => e?.product).filter(Boolean))];
    throw new ScriptError(2, `repositories[].projects 未命中：产品/模块 "${module}" 没有映射`, {
      module,
      knownProducts: known,
    });
  }

  const titleLower = String(title ?? "").toLowerCase();
  const keywordHits = candidates.filter(
    (e) =>
      Array.isArray(e.keywords) &&
      e.keywords.some((k) => String(k).trim() && titleLower.includes(String(k).trim().toLowerCase())),
  );
  let entry = keywordHits[0] ?? null;

  if (!entry) {
    const fallbacks = candidates.filter((e) => !Array.isArray(e.keywords) || e.keywords.length === 0);
    if (fallbacks.length === 0) {
      throw new ScriptError(2, `repositories[].projects 命中 "${module}" 但没有无关键词的兜底条目`, {
        module,
        candidates: candidates.map((e) => ({ keywords: e.keywords ?? [], repo: e.repo })),
      });
    }
    if (fallbacks.length > 1) {
      throw new ScriptError(
        6,
        `repositories[].projects 配置歧义："${module}" 有 ${fallbacks.length} 条无关键词兜底条目`,
        {
          module,
          repos: fallbacks.map((e) => e.repo),
        },
      );
    }
    entry = fallbacks[0];
  }

  const repo = typeof entry.repo === "string" ? entry.repo.trim() : "";
  if (!repo) throw new ScriptError(6, `repositories[].projects 中 "${module}" 的条目缺少 repo`);

  const repos = repositoryEntries(cfg).map((r) => r.name.trim());
  if (!repos.includes(repo)) {
    throw new ScriptError(6, `仓库 "${repo}" 不在 febot.config.json 的 repositories[] 中`, { repo, repos });
  }

  let reposDir;
  try {
    reposDir = reposRoot(cfg);
  } catch (e) {
    throw new ScriptError(6, e.message);
  }

  const resolved = resolveBranch(cfg, entry, repo);
  return {
    repo,
    repoDir: path.join(reposDir, repo),
    branch: resolved.branch,
    branchSource: resolved.source,
  };
}

/**
 * 只改 tasks.md 的 tier 列（第 4 列），供 advance set-tier 使用。
 * 找不到行抛 6；幂等（相同值也重写）。
 */
export function updateTasksTier(alias, tier) {
  const row = parseTasksRow(alias);
  const lines = fs.readFileSync(TASKS_PATH, "utf8").split(/\r?\n/);
  const cells = lines[row.line].split("|");
  // | 需求ID | 项目 | 优先级 | tier | 仓库 | 状态 | 入口 |
  cells[4] = ` ${tier} `;
  lines[row.line] = cells.join("|");
  fs.writeFileSync(TASKS_PATH, lines.join("\n"), "utf8");
  return { file: displayPath(TASKS_PATH), alias, tier };
}

/** 计划文件必须位于这些目录之一（相对 ROOT） */
export function allowedPlanDirs(alias) {
  return [path.join(ROOT, "xiaoqian-manager", "data", "temp"), requirementPaths(alias).reqDir];
}
