import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_SETTINGS,
  deriveGitOptions,
  isSettingsInitialized,
  nonEmptyStrings,
  parseRepositoryEntries,
  type AppSettings,
  type ConfigPatch,
  type SanitizedSettings,
  type SettingsDefaults,
} from "@/lib/domain/settings";
import type { GitOptions } from "@/lib/domain/git";
import { ensureDemoConfigFile, isDemoMode } from "@/lib/server/demo";

// febot.config.json 的唯一读写入口。
//
// 读取：按文件 mtime 感知外部改动；找不到返回 null。
// 写入：临时文件 + rename 原子替换；保存后立即失效缓存。
// 脱敏：password / cookie / autograph 永不返回给前端，只给 hasCredentials。
//
// 主应用只读取 repoRoot / jenkinsBase / defaults / repositories / features /
// nextDevOrigins / teamwork；devplatform / codeNameMap / jenkins 属 om/，原样保留。

export interface RootConfig {
  /** 配置文件绝对路径 */
  path: string;
  /** 配置文件所在目录——相对 repoRoot 以此为基准解析 */
  dir: string;
  raw: Record<string, unknown>;
}

function candidatePaths(): string[] {
  const list: string[] = [];
  const fromEnv = process.env.FEBOT_CONFIG;
  if (fromEnv && fromEnv.trim()) list.push(path.resolve(fromEnv.trim()));
  // 演示模式：把 example/demo/febot.config.json 复制到隔离工作区后优先读，
  // 这样设置页的写入不会改到入库模板。
  if (isDemoMode()) {
    const demo = ensureDemoConfigFile();
    if (demo) list.push(demo);
  }
  // 桌面端显式注入工作区：standalone 启动后 cwd 是安装目录，不能再靠 cwd 探测
  const workspace = process.env.FEBOT_WORKSPACE?.trim();
  if (workspace) list.push(path.join(path.resolve(workspace), "febot.config.json"));
  list.push(path.join(process.cwd(), "febot.config.json"));
  list.push(path.join(process.cwd(), "..", "febot.config.json"));
  return [...new Set(list)];
}

export function configCandidates(): string[] {
  return candidatePaths();
}

interface CacheEntry {
  mtimeMs: number;
  config: RootConfig;
}

let cached: CacheEntry | null = null;

export function resetConfigCache(): void {
  cached = null;
}

function readJsonFile(p: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    throw new Error(
      `febot.config.json 不是合法 JSON（原因：文件里有多余逗号、注释或写入中断）：${p}。` +
        `下一步：用 JSON 校验工具修正，或备份后从 example/febot.config.json 重新生成。`
    );
  }
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function readConfig(): RootConfig | null {
  for (const p of candidatePaths()) {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(p);
    } catch {
      continue;
    }
    if (!stat.isFile()) continue;
    if (cached && cached.config.path === p && cached.mtimeMs === stat.mtimeMs) {
      return cached.config;
    }
    const config: RootConfig = {
      path: p,
      dir: path.dirname(p),
      raw: readJsonFile(p),
    };
    cached = { mtimeMs: stat.mtimeMs, config };
    return config;
  }
  cached = null;
  return null;
}

/** 兼容旧调用方的别名 */
export const readRootConfig = readConfig;

/** 只打一次的告警，避免 dev server 每次请求都刷屏 */
let warned = false;
export function warnMissingConfig(): void {
  if (warned) return;
  warned = true;
  console.warn(
    "[config] 未找到 febot.config.json（原因：工作台不知道仓库根目录与分支），仓库/分支下拉为空。" +
      "下一步：左下角「设置」完成初始化，或执行 yarn setup 后填写 febot.config.json",
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function defaultsOf(raw: Record<string, unknown>): SettingsDefaults {
  const defaults = raw.defaults && typeof raw.defaults === "object" && !Array.isArray(raw.defaults)
    ? (raw.defaults as Record<string, unknown>)
    : {};
  return {
    devBranch: str(defaults.devBranch),
    mergeBranch: str(defaults.mergeBranch),
  };
}

export function parseAppSettings(raw: Record<string, unknown>): AppSettings {
  const features =
    raw.features && typeof raw.features === "object" && !Array.isArray(raw.features)
      ? (raw.features as Record<string, unknown>)
      : {};
  return {
    repoRoot: str(raw.repoRoot),
    jenkinsBase: str(raw.jenkinsBase).replace(/\/+$/, ""),
    defaults: defaultsOf(raw),
    repositories: parseRepositoryEntries(raw.repositories),
    features: { hindsight: features.hindsight === true },
    nextDevOrigins: nonEmptyStrings(raw.nextDevOrigins),
  };
}

export function readAppSettings(): AppSettings {
  const config = readConfig();
  return config ? parseAppSettings(config.raw) : { ...EMPTY_SETTINGS, defaults: { ...EMPTY_SETTINGS.defaults } };
}

/** 仓库根绝对路径；repoRoot 相对配置目录解析 */
export function repoRootPath(settings?: AppSettings): string {
  const s = settings ?? readAppSettings();
  const config = readConfig();
  if (!s.repoRoot) return "";
  return path.isAbsolute(s.repoRoot)
    ? s.repoRoot
    : path.resolve(config?.dir ?? process.cwd(), s.repoRoot);
}

export function readGitOptions(): GitOptions {
  return deriveGitOptions(readAppSettings());
}

export function isInitialized(): boolean {
  return isSettingsInitialized(readAppSettings());
}

// ---------- teamwork 段（仍由本文件统一读，避免多处解析） ----------

export interface TeamworkConfig {
  base: string;
  username: string;
  /** 登录账号。password 是前端加密后的密文，原样透传，不解密 */
  loginName: string;
  password: string;
  userTag: string;
  tableId: string;
  autograph: string;
  cookie: string;
  users: string[];
}

export function readTeamworkConfig(): TeamworkConfig {
  const raw = readConfig()?.raw ?? {};
  const tw = (raw.teamwork ?? {}) as Record<string, unknown>;
  return {
    base: str(tw.base).replace(/\/+$/, ""),
    username: str(tw.username),
    loginName: str(tw.loginName),
    password: str(tw.password),
    userTag: str(tw.userTag),
    tableId: str(tw.tableId),
    autograph: str(tw.autograph),
    cookie: str(tw.cookie),
    users: nonEmptyStrings(tw.users),
  };
}

export function readNextDevOrigins(): string[] {
  const raw = readConfig()?.raw ?? {};
  return nonEmptyStrings(raw.nextDevOrigins);
}

export function readSanitizedSettings(): SanitizedSettings {
  const settings = readAppSettings();
  const tw = readTeamworkConfig();
  return {
    repoRoot: settings.repoRoot,
    jenkinsBase: settings.jenkinsBase,
    defaults: settings.defaults,
    repositories: settings.repositories,
    teamwork: {
      base: tw.base,
      username: tw.username,
      loginName: tw.loginName,
      userTag: tw.userTag,
      tableId: tw.tableId,
      users: tw.users,
      hasCredentials: tw.loginName !== "" && tw.password !== "",
    },
    features: settings.features,
    nextDevOrigins: settings.nextDevOrigins,
  };
}

// ---------- 写入 ----------

// 主项目已切换为 repositories[]，旧的多表键在首次保存时显式剥离。
// devplatform / codeNameMap / jenkins 属 om/，原样保留、主应用不读取不改写。
const LEGACY_MAIN_KEYS = ["repos", "projectMap", "branches"];

function mergePatch(raw: Record<string, unknown>, patch: ConfigPatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...raw };

  if (patch.repoRoot !== undefined) next.repoRoot = str(patch.repoRoot);
  if (patch.jenkinsBase !== undefined) next.jenkinsBase = str(patch.jenkinsBase).replace(/\/+$/, "");
  if (patch.nextDevOrigins !== undefined) next.nextDevOrigins = nonEmptyStrings(patch.nextDevOrigins);
  if (patch.repositories !== undefined) next.repositories = parseRepositoryEntries(patch.repositories);

  if (patch.defaults !== undefined) {
    const prev =
      next.defaults && typeof next.defaults === "object" && !Array.isArray(next.defaults)
        ? (next.defaults as Record<string, unknown>)
        : {};
    next.defaults = {
      ...prev,
      ...(patch.defaults.devBranch !== undefined ? { devBranch: str(patch.defaults.devBranch) } : {}),
      ...(patch.defaults.mergeBranch !== undefined ? { mergeBranch: str(patch.defaults.mergeBranch) } : {}),
    };
  }

  if (patch.features !== undefined) {
    const prev =
      next.features && typeof next.features === "object" && !Array.isArray(next.features)
        ? (next.features as Record<string, unknown>)
        : {};
    next.features = {
      ...prev,
      ...(patch.features.hindsight !== undefined ? { hindsight: patch.features.hindsight === true } : {}),
    };
  }

  for (const key of LEGACY_MAIN_KEYS) delete next[key];
  return next;
}

function writeAtomic(file: string, raw: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, file);
}

/**
 * 只覆盖 patch 中出现的字段；其余顶层键原样保留。
 * 首次保存会剥离主项目已废弃的 repos / projectMap / branches。
 */
export function patchConfig(patch: ConfigPatch): AppSettings {
  const config = readConfig();
  const file = config?.path ?? candidatePaths()[0];
  const raw = config?.raw ?? {};
  const next = mergePatch(raw, patch);
  writeAtomic(file, next);
  resetConfigCache();
  // 重新读一次，让调用方拿到落盘后的规范化结果
  return readAppSettings();
}
