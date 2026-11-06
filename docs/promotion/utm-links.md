# 外链 UTM 规范与落地链接

> 目的：区分「哪个渠道 / 哪篇内容」带来了访问与 Star。每次对外发链接都从这里复制，不要临场拼。
> 仓库：https://github.com/Zombiesix/febot ｜ 制定：2026-11-06

## 1. 命名规则

| 参数 | 取值 | 说明 |
| --- | --- | --- |
| `utm_source` | `juejin` `v2ex` `okjike` `zhihu` `wechat` `bilibili` `x` `hackernews` `reddit` `producthunt` `devto` `medium` `awesome` | 渠道，小写、无空格 |
| `utm_medium` | `article` `post` `video` `social` `forum` `referral` | 内容形态 |
| `utm_campaign` | `phase1-cn` `phase2-global` `evergreen` | 按阶段固定；同一波内容不要换 |
| `utm_content` | `main-article` `arch-deepdive` `video-5min` `gif-60s` `show-hn` `x-thread` 等 | 具体素材，小写 + 连字符 |

规则：

- 只用小写字母、数字、连字符；**不要写中文**（部分平台会二次编码）。
- 同一素材在多个渠道发，`utm_source` 不同、`utm_content` 相同，方便横向比较。
- 只在**对外投放的链接**上加 UTM；README、Issue、文档内部链接不加。
- GitHub 本身不展示 UTM，需要 landing page 或短链服务（Plausible / Umami / Bitly）才能看到点击；没有 landing page 时，优先看 GitHub Traffic 的 referrers。

## 2. Phase 1（中文首发，11-23 ~ 12-06）

| 日期 | 渠道 | 素材 | 链接 |
| --- | --- | --- | --- |
| 11-23 | 掘金 | 主长文 | `https://github.com/Zombiesix/febot?utm_source=juejin&utm_medium=article&utm_campaign=phase1-cn&utm_content=main-article` |
| 11-23 | V2EX 分享创造 | 精简版 | `https://github.com/Zombiesix/febot?utm_source=v2ex&utm_medium=forum&utm_campaign=phase1-cn&utm_content=short-post` |
| 11-24 | 即刻 | 短帖 + GIF | `https://github.com/Zombiesix/febot?utm_source=okjike&utm_medium=social&utm_campaign=phase1-cn&utm_content=gif-60s` |
| 11-25 | 知乎 | 回答 + 文章 | `https://github.com/Zombiesix/febot?utm_source=zhihu&utm_medium=article&utm_campaign=phase1-cn&utm_content=qa-answer` |
| 11-26 | 微信公众号 | 长文排版版 | `https://github.com/Zombiesix/febot?utm_source=wechat&utm_medium=article&utm_campaign=phase1-cn&utm_content=main-article` |
| 11-27 | B 站 | 5 分钟演示 | `https://github.com/Zombiesix/febot?utm_source=bilibili&utm_medium=video&utm_campaign=phase1-cn&utm_content=video-5min` |
| 11-30 | 掘金 | 架构深潜 | `https://github.com/Zombiesix/febot?utm_source=juejin&utm_medium=article&utm_campaign=phase1-cn&utm_content=arch-deepdive` |
| 12-03 | 社群 | 微信群 / 知识星球 | `https://github.com/Zombiesix/febot?utm_source=wechat&utm_medium=social&utm_campaign=phase1-cn&utm_content=community-share` |

## 3. Phase 2（海外扩散，12-07 ~ 12-27）

| 日期 | 渠道 | 素材 | 链接 |
| --- | --- | --- | --- |
| 12-08 | X | thread | `https://github.com/Zombiesix/febot?utm_source=x&utm_medium=social&utm_campaign=phase2-global&utm_content=x-thread` |
| 12-09 | Hacker News | Show HN | `https://github.com/Zombiesix/febot?utm_source=hackernews&utm_medium=forum&utm_campaign=phase2-global&utm_content=show-hn` |
| 12-10 | Reddit | r/ClaudeAI、r/AI_Agents | `https://github.com/Zombiesix/febot?utm_source=reddit&utm_medium=forum&utm_campaign=phase2-global&utm_content=reddit-post` |
| 12-15 | Product Hunt | 产品页 | `https://github.com/Zombiesix/febot?utm_source=producthunt&utm_medium=referral&utm_campaign=phase2-global&utm_content=ph-launch` |
| 12-17 | Dev.to | 架构文英文版 | `https://github.com/Zombiesix/febot?utm_source=devto&utm_medium=article&utm_campaign=phase2-global&utm_content=arch-deepdive` |
| 持续 | Medium | 架构文英文版 | `https://github.com/Zombiesix/febot?utm_source=medium&utm_medium=article&utm_campaign=phase2-global&utm_content=arch-deepdive` |
| 持续 | Awesome Lists | PR 描述 | `https://github.com/Zombiesix/febot?utm_source=awesome&utm_medium=referral&utm_campaign=evergreen&utm_content=awesome-pr` |

## 4. 有 landing page 之后

把上面的 `https://github.com/Zombiesix/febot` 换成 landing page 地址，参数保持不变；
landing 页上的「Star on GitHub」按钮不要再套一层 UTM（否则原始 source 会丢）。

推荐落地页结构（GitHub Pages 即可）：

1. 一句话定位 + 60 秒 GIF
2. 三个卖点（需求不再散 / 人只做决策 / Agent 分工）
3. 两张图：架构、流程对比
4. Quick Start 代码块
5. 能力边界与已知限制
6. Star / Discussions / Issue 入口