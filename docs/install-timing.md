# 安装耗时实测

目标：从拿到仓库到在浏览器里看到工作台，**≤ 10 分钟**。

## 实测记录（2026-11-06）

环境：Windows 11（D 盘，本地 SSD）、Node v25.0.0、yarn 1.22.19、Git 2.20.1。
yarn 全局缓存**已预热**（本机之前装过同版本依赖）。

| 步骤 | 命令 | 实测耗时 |
| --- | --- | --- |
| 获取源码 | `git clone …` | 未单独计时（本次用 `git archive HEAD` 导出等价源码树） |
| 生成配置 + 安装四个子项目依赖 | `yarn setup` | **64 秒**（`Done in 63.50s`） |
| 启动演示工作台 | `yarn demo` | **约 5 秒**（Next 日志 `Ready in 0.7s`，其余为复制示例仓/重建工作区） |
| 打开队列、审阅、会话页 | 浏览器访问 | 首次访问按需编译，单个页面 1~3 秒 |

结论：预热缓存下，**约 75 秒**即可从源码到可点击的演示界面，远低于 10 分钟目标。

冷缓存（第一次安装）的耗时主要取决于 npm 下载带宽，本次未单独实测；依赖总量不大，
按常见家用/办公带宽估算仍在 10 分钟以内。如果网络较慢，可以分步执行
`yarn --cwd xiaoqian-manager` 等单项目安装，失败时只重试失败的那个。

## 复现方式

```bash
# 1) 导出干净的源码树（等价于 clone，不含本机 node_modules）
git archive HEAD | tar -x -C /tmp/febot-bench
cd /tmp/febot-bench

# 2) 计时安装
start=$(date +%s)
yarn setup
echo "setup: $(( $(date +%s) - start ))s"

# 3) 计时启动演示（3010 被占用会自动顺延端口）
start=$(date +%s)
yarn demo
# 看到 "Ready in …" 后按 Ctrl+C，或另开终端访问 http://localhost:3010
```

> 想测冷缓存：先执行 `yarn cache clean`，再重复第 2 步。注意这会影响本机其它项目的安装速度。
