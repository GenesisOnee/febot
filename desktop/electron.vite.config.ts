import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

// electron-vite 以项目根为 cwd 运行，这里不依赖 __dirname（config 可能被按 ESM 加载）。
const root = process.cwd();

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/main/index.ts") },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(root, "src/preload/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(root, "src/renderer"),
    build: {
      rollupOptions: {
        input: {
          setup: resolve(root, "src/renderer/setup/index.html"),
          error: resolve(root, "src/renderer/error/index.html"),
        },
      },
    },
  },
});