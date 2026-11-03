import fs from "node:fs";
import path from "node:path";
import type {
  RuntimeSyncResult,
  SetupConfigInput,
  WorkspaceCheck,
} from "../shared/types";
import {
  backupDir,
  workspaceConfigFile,
  workspaceDataDir,
  workspaceRuntimeManifest,
} from "./paths";
import {
  copyDir,
  copyFilePreserving,
  isWritableDir,
  readJson,
  sha256File,
  toPosix,
  walkFiles,
  writeJsonAtomic,
} from "./filesystem";
import {
  buildManifest,
  decideSyncAction,
  readManifest,
  writeManifest,
  type RuntimeManifest,
} from "./manifest";

// 工作区模型：
//   - 新建：复制 resources/runtime 的受管资产 + 从 example/ seed 用户文件
//   - 接管：校验现有目录，不覆盖任何文件；首次启动生成基线快照
//   - 升级：manifest 三方哈希比对，用户改过的文件永不覆盖

export const USER_FILE_TEMPLATES: ReadonlyArray<{ src: string; dst: string }> = [
  { src: "example/febot.config.json", dst: "febot.config.json" },
  { src: "example/tasks.md", dst: "tasks.md" },
  { src: "example/file-lock.md", dst: "file-lock.md" },
  { src: "example/om-data.json", dst: "om/data.json" },
  { src: "example/claude-settings.json", dst: ".claude/settings.json" },
  { src: "example/swagger-services.conf", dst: "swagger-mcp-server/services.conf" },
  { src: "example/hindsight.env", dst: "scripts/hindsight.env" },
];

/** 工作区必需目录（与仓库现有布局一致） */
export function ensureWorkspaceDirs(workspace: string): void {
  const dirs = [
    workspace,
    path.join(workspace, "docs", "requirements"),
    path.join(workspace, "gitlab"),
    path.join(workspace, "xiaoqian-manager", "data", "runs"),
    path.join(workspace, "xiaoqian-manager", "data", "temp"),
    path.join(workspace, ".febot", "index"),
    path.join(workspace, ".febot", "tmp"),
  ];
  for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });
}

export interface ValidateOptions {
  /** 新建模式允许目录为空/不存在；接管模式要求已有内容 */
  mode?: "new" | "takeover";
}

export function validateWorkspace(dir: string, options: ValidateOptions = {}): WorkspaceCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const workspace = path.resolve(dir);

  if (!dir || !dir.trim()) {
    return { ok: false, errors: ["请选择工作区目录"], warnings };
  }

  if (!fs.existsSync(workspace)) {
    if (options.mode === "new") {
      const parent = path.dirname(workspace);
      if (!fs.existsSync(parent)) errors.push(`上级目录不存在：${parent}`);
      else if (!isWritableDir(parent)) errors.push(`上级目录不可写：${parent}`);
    } else {
      errors.push(`目录不存在：${workspace}`);
    }
  } else if (!fs.statSync(workspace).isDirectory()) {
    errors.push(`不是目录：${workspace}`);
  } else if (!isWritableDir(workspace)) {
    errors.push(`目录不可写：${workspace}`);
  }

  if (errors.length) return { ok: false, errors, warnings };

  // 同步盘 / 网络盘警告
  const lower = workspace.toLowerCase();
  if (lower.startsWith("\\\\")) {
    warnings.push("工作区位于网络路径，文件锁与性能可能异常，建议使用本地 NTFS 目录");
  }
  const oneDrive = process.env.OneDrive?.trim();
  if (lower.includes("onedrive") || (oneDrive && lower.startsWith(oneDrive.toLowerCase()))) {
    warnings.push("工作区位于 OneDrive 同步盘，可能触发文件锁/重命名异常，建议使用本地目录");
  }

  // 配置
  const configFile = workspaceConfigFile(workspace);
  if (fs.existsSync(configFile)) {
    const raw = readJson<Record<string, unknown>>(configFile);
    if (!raw || typeof raw !== "object") {
      errors.push(`febot.config.json 不是合法 JSON：${configFile}`);
    } else {
      const repoRootRaw = typeof raw.repoRoot === "string" ? raw.repoRoot : "";
      if (!repoRootRaw) {
        warnings.push("febot.config.json 未填写 repoRoot，同步/定仓会失败");
      } else {
        const repoRoot = path.isAbsolute(repoRootRaw)
          ? repoRootRaw
          : path.resolve(workspace, repoRootRaw);
        if (!fs.existsSync(repoRoot)) warnings.push(`repoRoot 目录不存在：${repoRoot}`);
      }
      const repos = Array.isArray(raw.repos) ? raw.repos.filter((r) => typeof r === "string") : [];
      if (repos.length === 0) warnings.push("配置里没有仓库清单（repos）");
      else {
        const repoRoot = path.isAbsolute(repoRootRaw) ? repoRootRaw : path.resolve(workspace, repoRootRaw);
        const exists = repos.filter((r) => fs.existsSync(path.join(repoRoot, r)));
        if (exists.length === 0) warnings.push("repos 中的仓库目录都不存在");
      }
    }
  } else {
    warnings.push("尚无 febot.config.json，完成向导后会生成");
  }

  // 磁盘余量
  try {
    const stat = (fs as unknown as { statfsSync?: (p: string) => { bavail: number; bsize: number } })
      .statfsSync;
    if (stat) {
      const s = stat(workspace);
      const freeGb = (s.bavail * s.bsize) / 1024 ** 3;
      if (freeGb < 2) warnings.push(`剩余磁盘不足 2 GB（当前 ${freeGb.toFixed(1)} GB）`);
    }
  } catch {
    // statfs 在部分环境不可用，忽略
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** 接管模式：至少两项关键文件存在，避免把空目录/无关目录当成工作区。 */
export function checkTakeoverWorkspace(workspace: string): WorkspaceCheck {
  const base = validateWorkspace(workspace, { mode: "takeover" });
  if (!base.ok) return base;
  const markers = [
    workspaceConfigFile(workspace),
    path.join(workspace, "scripts", "advance.mjs"),
    path.join(workspace, ".claude", "commands", "pipeline.md"),
  ].filter((p) => fs.existsSync(p));
  if (markers.length < 2) {
    return {
      ok: false,
      errors: [
        "接管目录缺少 febot 工作区标志文件（febot.config.json / scripts/advance.mjs / .claude/commands/pipeline.md 至少需要两项）",
      ],
      warnings: base.warnings,
    };
  }
  return base;
}

/** 从 example/ 生成用户文件；已存在则跳过，绝不覆盖。 */
export function seedUserFiles(workspace: string): string[] {
  const created: string[] = [];
  for (const { src, dst } of USER_FILE_TEMPLATES) {
    const srcPath = path.join(workspace, src);
    const dstPath = path.join(workspace, dst);
    if (fs.existsSync(dstPath) || !fs.existsSync(srcPath)) continue;
    fs.mkdirSync(path.dirname(dstPath), { recursive: true });
    fs.copyFileSync(srcPath, dstPath);
    created.push(dst);
  }
  return created;
}

export interface CreateWorkspaceResult {
  created: string[];
  runtime: RuntimeSyncResult;
}

export function createWorkspace(
  workspace: string,
  runtimeDir: string,
  manifestFile: string,
  version: string
): CreateWorkspaceResult {
  fs.mkdirSync(workspace, { recursive: true });
  ensureWorkspaceDirs(workspace);

  // 全新目录：直接复制受管资产（无旧基线，走首次同步的全量备份路径没有意义）
  const copied = copyDir(runtimeDir, workspace);
  const created = seedUserFiles(workspace);

  const manifest = readManifest(manifestFile) ?? buildManifest(runtimeDir, version);
  writeManifest(workspaceRuntimeManifest(workspace), manifest);

  return {
    created,
    runtime: {
      version: manifest.version,
      copied,
      skipped: 0,
      conflicts: [],
      backupPath: null,
      error: null,
    },
  };
}

/** 接管模式：只在缺失时生成基线快照，不复制、不覆盖任何文件。 */
export function ensureTakeoverBaseline(
  workspace: string,
  runtimeDir: string,
  version: string
): void {
  const target = workspaceRuntimeManifest(workspace);
  if (fs.existsSync(target)) return;
  // 只取运行时文件清单，不计算资源侧哈希——首次接管时对 5000+ 个资源文件
  // 全量哈希会让启动多等数十秒（杀毒软件冷扫描更慢）。
  const managed = walkFiles(runtimeDir).map((f) => toPosix(path.relative(runtimeDir, f)));
  const files: Record<string, string> = {};
  // 只记录工作区里真实存在、且属于受管集合的文件
  for (const rel of managed) {
    const full = path.join(workspace, rel);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) files[rel] = sha256File(full);
  }
  writeManifest(target, { version, files });
}

function pruneBackups(): void {
  const root = backupDir();
  if (!fs.existsSync(root)) return;
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, mtime: fs.statSync(path.join(root, d.name)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
  for (const stale of dirs.slice(3)) {
    fs.rmSync(path.join(root, stale.name), { recursive: true, force: true });
  }
}

function backupPaths(
  workspace: string,
  rels: string[],
  backupName: string
): string | null {
  if (rels.length === 0) return null;
  const target = path.join(backupDir(), backupName);
  for (const rel of rels) {
    const src = path.join(workspace, rel);
    if (!fs.existsSync(src)) continue;
    copyFilePreserving(src, path.join(target, rel));
  }
  pruneBackups();
  return fs.existsSync(target) ? target : null;
}

/**
 * 运行时同步（升级）。
 *
 * - 无基线：首次同步，覆盖前做一次全量备份（仅此一次）
 * - 有基线：逐文件三方比对；用户改过的写 `<file>.febot-new` 并记冲突
 * - 任何失败都不阻断启动，由调用方降级提示
 */
export function syncRuntime(
  workspace: string,
  runtimeDir: string,
  manifestFile: string,
  version: string
): RuntimeSyncResult {
  const result: RuntimeSyncResult = {
    version,
    copied: 0,
    skipped: 0,
    conflicts: [],
    backupPath: null,
    error: null,
  };

  try {
    if (!fs.existsSync(runtimeDir)) {
      result.error = `运行时资产不存在：${runtimeDir}`;
      return result;
    }
    const next = readManifest(manifestFile) ?? buildManifest(runtimeDir, version);
    result.version = next.version;
    const old = readManifest(workspaceRuntimeManifest(workspace));

    if (old && old.version === next.version) {
      // 版本相同也要检查文件是否齐全（用户可能误删）
      for (const [rel, sha] of Object.entries(next.files)) {
        const dest = path.join(workspace, rel);
        if (!fs.existsSync(dest)) {
          copyFilePreserving(path.join(runtimeDir, rel), dest);
          result.copied += 1;
        } else if (sha256File(dest) === sha) {
          result.skipped += 1;
        }
      }
      return result;
    }

    const decisions: Array<{ rel: string; action: string }> = [];
    for (const [rel, newSha] of Object.entries(next.files)) {
      const dest = path.join(workspace, rel);
      const currentSha = fs.existsSync(dest) ? sha256File(dest) : null;
      const action = decideSyncAction({
        currentSha,
        oldSha: old?.files[rel] ?? null,
        newSha,
      });
      decisions.push({ rel, action });
    }

    const backupTargets = old
      ? decisions.filter((d) => d.action === "overwrite").map((d) => d.rel)
      : decisions.filter((d) => d.action !== "copy").map((d) => d.rel);
    result.backupPath = backupPaths(
      workspace,
      backupTargets,
      `${next.version}-${new Date().toISOString().replace(/[:.]/g, "-")}`
    );

    const finalFiles: Record<string, string> = { ...next.files };
    for (const { rel, action } of decisions) {
      const src = path.join(runtimeDir, rel);
      const dest = path.join(workspace, rel);
      switch (action) {
        case "copy":
        case "overwrite":
          copyFilePreserving(src, dest);
          result.copied += 1;
          break;
        case "skip":
          result.skipped += 1;
          break;
        case "conflict": {
          copyFilePreserving(src, `${dest}.febot-new`);
          result.conflicts.push(rel);
          // 保留旧哈希，下次升级仍能识别“用户改过”
          if (old?.files[rel]) finalFiles[rel] = old.files[rel];
          else delete finalFiles[rel];
          break;
        }
      }
    }

    writeManifest(workspaceRuntimeManifest(workspace), {
      version: next.version,
      files: finalFiles,
    });
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  return result;
}

/** 新建向导里写配置：保留用户已有字段，只覆盖向导提供的项。 */
export function applySetupConfig(workspace: string, input: SetupConfigInput): void {
  const file = workspaceConfigFile(workspace);
  const raw = readJson<Record<string, unknown>>(file) ?? {};
  if (typeof input.repoRoot === "string" && input.repoRoot.trim()) {
    raw.repoRoot = input.repoRoot.trim();
  }
  if (Array.isArray(input.repos)) {
    raw.repos = input.repos.map((r) => r.trim()).filter(Boolean);
  }
  if (typeof input.defaultBranch === "string" && input.defaultBranch.trim()) {
    const branches =
      raw.branches && typeof raw.branches === "object" && !Array.isArray(raw.branches)
        ? (raw.branches as Record<string, unknown>)
        : {};
    branches.default = input.defaultBranch.trim();
    raw.branches = branches;
  }
  writeJsonAtomic(file, raw);
}

/** 工作区锁：避免桌面端与 `yarn dev` 同时操作同一工作区。 */
export function writeDesktopLock(workspace: string): void {
  const file = path.join(workspace, ".febot", "desktop.lock");
  writeJsonAtomic(file, { pid: process.pid, startedAt: new Date().toISOString() });
}

export function removeDesktopLock(workspace: string): void {
  try {
    fs.rmSync(path.join(workspace, ".febot", "desktop.lock"), { force: true });
  } catch {
    // ignore
  }
}

/** 诊断包里的配置脱敏 */
export function redactConfig(raw: unknown): unknown {
  const SECRET_KEYS = /password|cookie|token|autograph/i;
  const walk = (value: unknown, key: string): unknown => {
    if (SECRET_KEYS.test(key)) return "***";
    if (Array.isArray(value)) return value.map((v) => walk(v, key));
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, walk(v, k)])
      );
    }
    return value;
  };
  return walk(raw, "");
}

export function listManagedRelativePaths(workspace: string): string[] {
  const root = path.join(workspace, ".febot");
  if (!fs.existsSync(root)) return [];
  return walkFiles(workspace)
    .map((f) => toPosix(path.relative(workspace, f)))
    .filter((rel) => !rel.startsWith("gitlab/") && !rel.startsWith(".febot/"));
}

export function dataDirOf(workspace: string): string {
  return workspaceDataDir(workspace);
}

export function runtimeManifestOf(workspace: string): RuntimeManifest | null {
  return readManifest(workspaceRuntimeManifest(workspace));
}