// 兼容层：配置读写统一收敛到 lib/server/config/store.ts。
// 保留本文件原有的导出名，避免既有模块大范围改 import。

export {
  readConfig,
  readRootConfig,
  readAppSettings,
  readGitOptions,
  readTeamworkConfig,
  readNextDevOrigins,
  readSanitizedSettings,
  repoRootPath,
  resetConfigCache,
  warnMissingConfig,
  type RootConfig,
  type TeamworkConfig,
} from "./store";