## 动机

<!-- 这个改动解决什么问题？关联的 Issue：Fixes # -->

## 改了什么

<!-- 一句话列表；范围之外的顺带改动请拆到另一个 PR -->

-

## 怎么验证

<!-- 复现步骤 / 截图 / GIF。CI 会跑 setup 冒烟、lint、typecheck 和单测。 -->

- [ ] `yarn --cwd xiaoqian-manager lint`
- [ ] `yarn --cwd code-indexer typecheck`
- [ ] `yarn --cwd desktop typecheck`
- [ ] `yarn --cwd desktop test`

## 检查清单

- [ ] 没有提交真实业务名、内部域名、账号、cookie、token 或 API key
- [ ] 没有改动 node / npm / yarn 版本
- [ ] 文档（README / ROADMAP / 相关子项目 README）已同步
- [ ] 行为变更已说明兼容性影响（尤其是 `febot.config.json` 与 `tasks.md` 格式）

## 截图 / 录屏（UI 改动必填）