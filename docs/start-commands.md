# 启动指令集合

> 由 `yarn start:list` 自动生成（脚本：`scripts/start-commands.mjs`），请勿手改。
> 数据来源：各仓 `README.md` 的 dev / start / serve 命令；README 未给出时回退 `package.json` 脚本。

| 项目 | 产品 | 包管理器 | 启动指令 | 来源 |
| --- | --- | --- | --- | --- |
| demo-product-h-web | 示例产品 H | yarn | `yarn dev` | package.json:scripts.dev |
| demo-product-h-web | 示例产品 H | yarn | `yarn start` | package.json:scripts.start |
| demo-product-i-ui | 示例产品 I | yarn | `yarn dev` | README.md:23 |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:weapp` | package.json:scripts.dev:weapp |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:swan` | package.json:scripts.dev:swan |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:alipay` | package.json:scripts.dev:alipay |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:tt` | package.json:scripts.dev:tt |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:h5` | package.json:scripts.dev:h5 |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:rn` | package.json:scripts.dev:rn |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:qq` | package.json:scripts.dev:qq |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:jd` | package.json:scripts.dev:jd |
| demo-product-i-mobile | 示例产品 I | yarn | `yarn dev:quickapp` | package.json:scripts.dev:quickapp |
| demo-product-k-ui | 示例产品 K | yarn | `yarn dev` | README.md:24 |
| demo-product-l-ui | 示例产品 L | yarn | `yarn dev` | README.md:56 |
| demo-product-e-ui | 示例产品 E | npm | `npm run dev:auto-token` | README.md:10 |
| demo-product-e-ui | 示例产品 E | npm | `npm run dev` | package.json:scripts.dev |
| demo-product-f-ui | 示例产品 F | yarn | `yarn dev` | README.md:22 |
| demo-product-j-ui | 示例产品 J | yarn | `yarn dev:module-a` | README.md:8 |
| demo-product-j-ui | 示例产品 J | yarn | `yarn dev:module-b` | README.md:9 |
| demo-product-j-ui | 示例产品 J | yarn | `yarn dev:example` | README.md:10 |
| demo-product-j-ui | 示例产品 J | yarn | `yarn dev` | README.md:16 |
| demo-product-b-web | 示例产品 B | yarn | `yarn dev` | README.md:46 |
| demo-product-b-ui | 示例产品 B / 示例产品 C / 示例产品 D | yarn | `yarn dev` | README.md:60 |
| demo-product-a-ui | 示例产品 A | pnpm | `npm run dev` | README.md:29 |
| demo-product-a-ui | 示例产品 A | pnpm | `npx pnpm@8 dev` | README.md:31 |
| demo-product-g-web | 示例产品 G | pnpm | `pnpm dev` | README.md:34 |
| demo-product-g-web | 示例产品 G | pnpm | `pnpm serve` | package.json:scripts.serve |

## 备注

- **demo-product-h-web**：README 未给出启动命令，回退 package.json
- **demo-product-i-mobile**：README 未给出启动命令，回退 package.json
- **demo-product-e-ui**：存在多个 dev:* 入口，已按 README 列出的为准
- **demo-product-j-ui**：存在多个 dev:* 入口，已按 README 列出的为准
