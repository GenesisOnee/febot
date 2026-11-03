import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { DesktopSettings } from "../shared/types";
import { appDataDir, settingsFile } from "./paths";

const windowStateSchema = z.object({
  x: z.number().int().optional(),
  y: z.number().int().optional(),
  width: z.number().int().min(800).default(1440),
  height: z.number().int().min(600).default(900),
});

const settingsSchema = z.object({
  workspace: z.string().default(""),
  workspaceMode: z.enum(["new", "takeover"]).default("new"),
  claudePath: z.string().default(""),
  minimizeToTray: z.boolean().default(true),
  autoLaunchAtLogin: z.boolean().default(false),
  autoUpdate: z.boolean().default(true),
  updateChannel: z.enum(["stable", "beta"]).default("stable"),
  lastWindow: windowStateSchema.default({ width: 1440, height: 900 }),
  runtimeVersion: z.string().default(""),
  appPort: z.number().int().nullable().default(null),
  runnerPort: z.number().int().nullable().default(null),
  navigationAllowlist: z.array(z.string()).default([]),
});

export function defaultSettings(): DesktopSettings {
  return {
    workspace: process.env.FEBOT_DESKTOP_WORKSPACE?.trim() ?? "",
    workspaceMode: "takeover",
    claudePath: process.env.FEBOT_CLAUDE_PATH?.trim() ?? "",
    minimizeToTray: true,
    autoLaunchAtLogin: false,
    autoUpdate: true,
    updateChannel: "stable",
    lastWindow: { width: 1440, height: 900 },
    runtimeVersion: "",
    appPort: null,
    runnerPort: null,
    navigationAllowlist: [],
  };
}

function normalize(raw: unknown): DesktopSettings {
  const parsed = settingsSchema.safeParse(raw);
  if (parsed.success) return parsed.data as DesktopSettings;
  // 配置损坏时按默认值启动，坏文件另存一份便于排查
  const file = settingsFile();
  try {
    fs.copyFileSync(file, `${file}.broken-${Date.now()}`);
  } catch {
    // ignore
  }
  return defaultSettings();
}

export function loadSettings(): DesktopSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsFile(), "utf8"));
    return normalize(raw);
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(next: DesktopSettings): void {
  fs.mkdirSync(appDataDir(), { recursive: true });
  const file = settingsFile();
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settingsSchema.parse(next), null, 2), "utf8");
  fs.renameSync(tmp, file);
}

export function patchSettings(
  current: DesktopSettings,
  patch: Partial<DesktopSettings>
): DesktopSettings {
  const merged = normalize({ ...current, ...patch });
  saveSettings(merged);
  return merged;
}

/** 便于测试的纯函数 */
export function parseSettings(raw: unknown): DesktopSettings {
  return normalize(raw);
}

export function settingsFilePath(): string {
  return path.resolve(settingsFile());
}