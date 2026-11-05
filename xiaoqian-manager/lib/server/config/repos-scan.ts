import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// 扫描仓库根目录的直接子目录，只保留含 .git 的目录（.git 为目录或文件，兼容 worktree）。
// 只读：readdir + git branch --show-current，不写任何文件。

export interface ScannedRepo {
  name: string;
  path: string;
  currentBranch: string;
  isGit: boolean;
}

function currentBranch(repoDir: string): string {
  try {
    return execFileSync("git", ["-C", repoDir, "rev-parse", "--abbrev-ref", "HEAD"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .trim()
      .replace(/^HEAD$/, "");
  } catch {
    return "";
  }
}

/**
 * @throws Error 目录不存在 / 不是目录
 */
export function scanRepositories(root: string): ScannedRepo[] {
  const abs = path.resolve(root);
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) throw new Error(`不是目录：${abs}`);

  const entries = fs.readdirSync(abs, { withFileTypes: true });
  const out: ScannedRepo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const repoDir = path.join(abs, entry.name);
    if (!fs.existsSync(path.join(repoDir, ".git"))) continue;
    out.push({
      name: entry.name,
      path: repoDir,
      currentBranch: currentBranch(repoDir),
      isGit: true,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}