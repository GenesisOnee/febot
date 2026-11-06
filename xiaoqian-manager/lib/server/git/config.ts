import fs from "node:fs";
import path from "node:path";
import type { GitOptions } from "@/lib/domain/git";
import { deriveGitOptions } from "@/lib/domain/settings";
import {
  parseAppSettings,
  readConfig,
  readGitOptions as readDerivedGitOptions,
  repoRootPath,
  warnMissingConfig,
  type RootConfig,
} from "@/lib/server/config/store";

// 仓库/分支/Jenkins 视图全部从 febot.config.json 的 repositories[] 派生。
// 不保留旧的多表配置，也不回退 data/repos.json。
//
// 仅保留 GIT_REPOS_FILE 测试夹具：内容必须使用新 schema
// （repoRoot / defaults / repositories[]）。

interface GitConfig extends GitOptions {
  root: string;
}

const EMPTY_CONFIG: GitConfig = {
  root: "",
  repos: [],
  branches: [],
  jenkins: {},
  projectMap: [],
  devDefault: "",
  devByRepo: {},
  mergeDefault: "",
  mergeByRepo: {},
};

let cached: GitConfig | null = null;

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function fromRaw(raw: Record<string, unknown>, dir: string): GitConfig {
  const settings = parseAppSettings(raw);
  const repoRootRaw = str(raw.repoRoot);
  const root = repoRootRaw
    ? path.isAbsolute(repoRootRaw)
      ? repoRootRaw
      : path.resolve(dir, repoRootRaw)
    : "";
  return { root, ...deriveGitOptions(settings) };
}

function fromFixture(file: string): GitConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(`配置文件不是合法 JSON：${file}`);
  }
  const obj = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return fromRaw(obj, path.dirname(file));
}

function loadConfig(): GitConfig {
  if (cached) return cached;

  // 1. GIT_REPOS_FILE：测试夹具显式指定，优先级最高
  const fromEnv = str(process.env.GIT_REPOS_FILE);
  if (fromEnv) {
    const p = path.resolve(fromEnv);
    if (fs.existsSync(p)) {
      cached = fromFixture(p);
      return cached;
    }
  }

  // 2. febot.config.json（FEBOT_CONFIG → FEBOT_WORKSPACE → cwd → cwd/..）
  const rootCfg: RootConfig | null = readConfig();
  if (rootCfg) {
    cached = { root: repoRootPath(), ...readDerivedGitOptions() };
    return cached;
  }

  warnMissingConfig();
  cached = { ...EMPTY_CONFIG };
  return cached;
}

export function readGitOptions(): GitOptions {
  const { repos, branches, jenkins, projectMap, devDefault, devByRepo, mergeDefault, mergeByRepo } =
    loadConfig();
  return { repos, branches, jenkins, projectMap, devDefault, devByRepo, mergeDefault, mergeByRepo };
}

// 仓库名必须来自配置白名单，且不含路径分隔符 —— 两道锁一起挡目录穿越。
export function resolveRepoPath(repo: string): string {
  const cfg = loadConfig();
  if (!cfg.root) {
    throw new Error(
      "未配置仓库根目录（原因：feeder / 定仓脚本无法定位业务仓）。" +
        "下一步：打开工作台「设置 → 仓库与分支」填写仓库根目录，或检查 febot.config.json 的 repoRoot。"
    );
  }
  if (!cfg.repos.includes(repo)) {
    throw new Error(
      `仓库不在配置列表中：${repo}（原因：repositories[] 没有登记这个仓库名）。` +
        "下一步：在「设置 → 仓库与分支」添加该仓库，或检查任务模块是否映射到了正确的仓库。"
    );
  }
  if (/[\\/:]|\.\./.test(repo)) {
    throw new Error(`仓库名不合法：${repo}`);
  }
  const root = path.resolve(cfg.root);
  const full = path.join(root, repo);
  if (path.dirname(full) !== root) {
    throw new Error(`仓库路径越界：${repo}`);
  }
  if (!fs.existsSync(path.join(full, ".git"))) {
    throw new Error(
      `不是 git 仓库或目录不存在：${full}（原因：仓库根目录 + 仓库名拼出的路径下没有 .git）。` +
        "下一步：确认仓库已克隆到该路径，或在「设置 → 仓库与分支」修正仓库根目录。"
    );
  }
  return full;
}

export function assertBranch(branch: string): void {
  const cfg = loadConfig();
  if (!cfg.branches.includes(branch)) {
    throw new Error(
      `目标分支不在配置列表中：${branch}（原因：分支候选只来自 defaults 与 repositories[] 的登记值）。` +
        "下一步：在「设置 → 仓库与分支」补充该分支，或改用已登记的分支。"
    );
  }
}
