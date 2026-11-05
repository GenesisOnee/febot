// 部署/提交相关的仓库、分支解析。纯类型 + 纯函数，浏览器端可安全 import
// （服务端读取实现见 lib/server/git/config.ts）。
//
// 分支语义拆成两套，不再混用：
//   - 开发分支 dev：流水线前置定仓、开工门禁、push 源分支。
//   - 合并分支 merge：代码提交后 cherry-pick 的目标分支。

/** projectMap 的一条映射：产品/模块 → 目标仓库（由 repositories[].projects[] 派生） */
export interface GitProjectEntry {
  product: string;
  /** 标题命中任一关键词时优先用这条（多条按数组顺序取第一条） */
  keywords?: string[];
  repo: string;
}

export interface GitOptions {
  repos: string[];
  /** 开发/合并分支候选值并集（从 repositories[] 派生，不落盘） */
  branches: string[];
  // 仓库目录名 -> Jenkins 构建地址
  jenkins: Record<string, string>;
  /** 产品/模块 → 目标仓库（定仓的唯一依据） */
  projectMap: GitProjectEntry[];
  /** 全局开发基准分支 */
  devDefault: string;
  /** 按仓库覆盖的开发基准分支 */
  devByRepo: Record<string, string>;
  /** 全局合并目标分支 */
  mergeDefault: string;
  /** 按仓库覆盖的合并目标分支 */
  mergeByRepo: Record<string, string>;
}

export interface GitDefault {
  repo: string;
  branch: string;
}

export const EMPTY_GIT_OPTIONS: GitOptions = {
  repos: [],
  branches: [],
  jenkins: {},
  projectMap: [],
  devDefault: "",
  devByRepo: {},
  mergeDefault: "",
  mergeByRepo: {},
};

/**
 * 按 projectMap 定仓：产品/模块精确匹配 → 标题关键词 → 无关键词兜底。
 * 未命中或多条兜底（歧义）时返回 null —— 不猜，留给用户手选。
 */
function resolveProjectEntry(
  options: GitOptions,
  module: string,
  title: string,
): GitProjectEntry | null {
  const candidates = options.projectMap.filter((e) => e.product === module);
  if (candidates.length === 0) return null;

  const titleLower = String(title ?? "").toLowerCase();
  const keywordHit = candidates.find((e) =>
    e.keywords?.some((k) => {
      const keyword = k.trim().toLowerCase();
      return keyword !== "" && titleLower.includes(keyword);
    }),
  );
  if (keywordHit) return keywordHit;

  const fallbacks = candidates.filter((e) => !e.keywords?.length);
  return fallbacks.length === 1 ? fallbacks[0] : null;
}

/** 开发分支解析：仓库 devBranch > defaults.devBranch */
export function branchForRepo(options: GitOptions, repo: string): string {
  const branch = options.devByRepo[repo]?.trim() || options.devDefault.trim();
  return branch && options.branches.includes(branch) ? branch : branch;
}

/** 合并分支解析：仓库 mergeBranch > defaults.mergeBranch；都没有返回空串 */
export function mergeBranchForRepo(options: GitOptions, repo: string): string {
  return options.mergeByRepo[repo]?.trim() || options.mergeDefault.trim();
}

/** 打开部署节点时回填的默认仓库与开发分支；任务数据不足以判定时返回 null。 */
export function resolveGitDefault(
  options: GitOptions,
  module: string,
  title: string,
): GitDefault | null {
  const entry = resolveProjectEntry(options, module, title);
  const repo = entry?.repo.trim() ?? "";
  if (!repo || !options.repos.includes(repo)) return null;
  return { repo, branch: branchForRepo(options, repo) };
}