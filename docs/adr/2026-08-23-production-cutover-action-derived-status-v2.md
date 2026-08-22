# ADR：生产切换行动状态由外部可信证据派生

- 状态：Accepted
- 日期：2026-08-23
- Owner：T00（发布治理与证据验证）
- 影响范围：生产切换行动定义、外部证据决定、严格预检与发布 provenance

## Problem

`production-cutover-actions-v1` 同时保存行动定义和可手工编辑的 `status`。现有检查只验证字段形状；把
14 项状态全部改成 `verified` 就会得到 `productionReady=true`，却不要求证据摘要、验证人、有效期、
release/artifact 绑定、转换历史或命令执行回执。Git 中的声明因此可能被误当成生产授权事实。

## Options

1. 保留 v1，只依赖评审阻止手工修改状态。
2. 为 v1 增加更多状态字段，仍把结果提交在定义文件中。
3. 将提交到仓库的文件降为 definitions-only；effective status 只由仓库外、经可信 provider 验证、绑定
   当前 release/artifact 的证据决定派生，并进入 strict preflight。
4. 把完整现场证据、签名或原始命令输出归档进仓库。

## Advantages

方案 3 消除定义与证据的双重职责。Git 只能描述 14 项必须完成的行动，不能宣称完成；验证决定必须具备
受控引用、证据/指纹/命令回执摘要、有效期、前态转换、独立角色和至少两个不同 signer，并精确绑定当前
release ID 与 artifact digest。输出只保留摘要化投影，可进入 provenance 而不归档现场正文。

## Disadvantages

生产预检增加一个外部 evidence provider 和受控目录依赖。证据到期、release 变化或 verifier 不可用会
使行动重新阻断；现场团队必须维护转换历史与签名决定，不能再通过编辑配置快速解除门禁。

## Migration cost

中等。v1 配置升级为 `production-cutover-action-definitions-v2` 并删除所有 `status`；新增 v2 evaluator、
负向测试和 strict preflight 接线。真实 evidence envelope、trust anchor、私钥和现场命令输出仍在仓库外。
无需数据库 migration、公开 API 变化或运行时业务数据迁移。

## Risk

- 若 evaluator 信任 envelope 内自报的 `verified=true`，仍会形成绕过；必须先经外部 provider 验证。
- 若 release/artifact、有效期或转换历史不绑定，旧证据可能被重放。
- 若 owner、evidence producer、verifier 或 signer 重合，会破坏职责分离。
- 若把原始证据归档进 release package，可能泄露敏感数据；只允许 digest-only report。
- promotion receipt 不能放回它绑定的 package 内，否则形成摘要循环。

## Recommendation

采用方案 3。定义报告永远 `productionReady=false`；只有 14 项外部决定均通过可信 provider、时间窗、
release/artifact、前态转换、命令回执和角色独立性验证时，派生报告才可为
`verified-for-bound-release`。该派生结果仍不是最终生产授权，必须作为 strict preflight 的额外必要条件；
缺失 provider、记录或任一绑定时默认 `NO-GO`。真实签名、现场证据和 protected-environment 审批不由仓库生成。

## Rollback

整体回滚 v2 evaluator 与 preflight 接线，并恢复 v1 结构；回滚期间生产保持 `NO-GO`。不得只恢复可编辑
`status` 的生产就绪计算，也不得放宽证据绑定以维持 GO。
