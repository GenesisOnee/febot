import fs from "node:fs";
import path from "node:path";
import log from "electron-log/main";
import { logsDir } from "./paths";

let initialized = false;

export function initLogging(): typeof log {
  if (initialized) return log;
  initialized = true;
  fs.mkdirSync(logsDir(), { recursive: true });

  log.initialize();
  log.transports.file.resolvePathFn = () => path.join(logsDir(), "main.log");
  log.transports.file.maxSize = 10 * 1024 * 1024;
  log.transports.file.level = "info";
  log.transports.console.level = process.env.FEBOT_DEBUG === "1" ? "debug" : "info";
  return log;
}

export function childLog(prefix: string, line: string): void {
  const clean = line.replace(/\r$/, "");
  if (!clean) return;
  log.info(`[${prefix}] ${clean}`);
}

export { log };