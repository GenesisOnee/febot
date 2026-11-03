import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { app } from "electron";
import { packagedNodeExe } from "./paths";

// 从资源管理器启动时 PATH 常常不含 npm 全局 bin / Git Bash，导致 PTY 里
// `claude` / `bash` 直接 127。这里统一收口“子进程该看到的 PATH”。

const DEFAULT_DIRS = [
  "C:\\Program Files\\nodejs",
  "C:\\Program Files\\Git\\cmd",
  "C:\\Program Files\\Git\\bin",
  "C:\\Program Files\\Git\\usr\\bin",
];

function pushUnique(list: string[], value: string | undefined | null): void {
  if (!value) return;
  const clean = value.trim().replace(/^"|"$/g, "");
  if (!clean) return;
  if (!list.some((d) => d.toLowerCase() === clean.toLowerCase())) list.push(clean);
}

/**
 * Git for Windows 的安装根。
 *
 * 不能假设装在 C 盘：PATH 里通常只有 `<root>\cmd`（安装器的默认选项），
 * 它不含 bash.exe；而注册表 InstallPath 才是权威位置。两条路都试，
 * 再退回常见默认目录。
 */
function gitRoots(): string[] {
  const roots: string[] = [];
  const addRoot = (root: string | undefined | null): void => pushUnique(roots, root);

  // 1) 从 PATH 反推：<root>\cmd / <root>\bin / <root>\usr\bin / <root>\mingw64\bin
  //    后缀从长到短匹配，避免把 <root>\mingw64\bin 误判成 <root>\mingw64。
  const suffixes = ["\\mingw64\\bin", "\\mingw32\\bin", "\\usr\\bin", "\\cmd", "\\bin"];
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const clean = dir.trim().replace(/^"|"$/g, "");
    if (!clean) continue;
    const lower = clean.toLowerCase();
    for (const suffix of suffixes) {
      if (lower.endsWith(suffix)) {
        addRoot(clean.slice(0, clean.length - suffix.length));
        break;
      }
    }
  }

  // 2) 注册表：Git 不在 PATH 时也能找到
  for (const key of ["HKLM\\SOFTWARE\\GitForWindows", "HKCU\\SOFTWARE\\GitForWindows"]) {
    try {
      const out = execFileSync("reg", ["query", key, "/v", "InstallPath"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const match = out.match(/InstallPath\s+REG_SZ\s+(.+)/i);
      if (match?.[1]) addRoot(match[1].trim());
    } catch {
      // 键不存在或 reg 不可用时忽略
    }
  }

  return roots;
}

let bashCache: string[] | null = null;

function computeGitBashPaths(): string[] {
  const out: string[] = [];

  // PATH 里已经能直接解析到 bash.exe 的目录
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const clean = dir.trim().replace(/^"|"$/g, "");
    if (clean) pushUnique(out, path.join(clean, "bash.exe"));
  }

  for (const root of gitRoots()) {
    pushUnique(out, path.join(root, "bin", "bash.exe"));
    pushUnique(out, path.join(root, "usr", "bin", "bash.exe"));
  }

  pushUnique(out, "C:\\Program Files\\Git\\bin\\bash.exe");
  pushUnique(out, "C:\\Program Files\\Git\\usr\\bin\\bash.exe");
  if (process.env.LOCALAPPDATA) {
    pushUnique(out, path.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
  }

  return out;
}

export function enrichedPath(extraDirs: string[] = []): string {
  const dirs: string[] = [];
  const push = (dir: string | undefined | null): void => {
    if (!dir) return;
    const clean = dir.trim().replace(/^"|"$/g, "");
    if (!clean) return;
    if (!dirs.some((d) => d.toLowerCase() === clean.toLowerCase())) dirs.push(clean);
  };

  if (app.isPackaged) push(path.dirname(packagedNodeExe()));
  for (const dir of extraDirs) push(dir);

  // Git 可能装在非 C 盘；把实际找到的 bash 目录补进 PATH，保证子进程能执行 bash。
  for (const bash of commonGitBashPaths()) {
    if (fs.existsSync(bash)) push(path.dirname(bash));
  }

  const appData = process.env.APPDATA;
  if (appData) push(path.join(appData, "npm"));
  push(process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs") : undefined);
  push(process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "Programs", "nodejs") : undefined);
  for (const dir of DEFAULT_DIRS) push(dir);
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) push(dir);

  return dirs.join(path.delimiter);
}

/** claude 候选路径：显式配置 → PATH → %APPDATA%\npm（Claude Code 默认安装位） */
export function claudeCandidates(configured: string): string[] {
  const out: string[] = [];
  if (configured.trim()) out.push(configured.trim());
  const appData = process.env.APPDATA;
  if (appData) {
    out.push(path.join(appData, "npm", "claude.cmd"));
    out.push(path.join(appData, "npm", "claude"));
  }
  const local = process.env.LOCALAPPDATA;
  if (local) {
    out.push(path.join(local, "Programs", "claude", "claude.exe"));
  }
  return out.filter((p) => fs.existsSync(p));
}

/** 将 claude 解析为可执行绝对路径；解析不到返回 null。 */
export function resolveClaude(configured: string): string | null {
  for (const candidate of claudeCandidates(configured)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  // PATH 里存在 claude.exe 时直接交给子进程解析
  for (const dir of enrichedPath().split(path.delimiter)) {
    for (const name of ["claude.exe", "claude.cmd", "claude"]) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

export function commonGitBashPaths(): string[] {
  if (!bashCache) bashCache = computeGitBashPaths();
  return bashCache;
}