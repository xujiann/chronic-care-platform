# TEST-007：医院运行命令行为矩阵

> 状态：仓库内运行时行为保护已建立；不改变 HTTP、handler、数据、Schema、部署或生产状态。

## 目标

`src/http/routes/platform-governance/operations-command.js` 是从 T06 原子移交到 T02 的 699 行遗留
handler。它包含 32 条公开路径，并保留跨域写入 `resourceDispatchRequests`、`taskMessages` 的兼容债务。
在拆分 handler 或治理 ARC-008 前，必须先锁定当前真实行为，防止用例迁移改变授权、响应、数据或审计语义。

## 机器事实

唯一可执行行为矩阵位于 `test/operations-command-handoff.test.js`，直接复用既有
`createRuntime` harness，不建立第二份路由注册表或平行测试装配。矩阵与源码扫描得到的 32 条路径做
闭集等价和唯一性校验；文档不手工复制路径清单。

矩阵逐路径登记并执行：

- method、模板路径、动态请求样例和允许角色；
- 允许路径的读取、payload、状态码和响应投影；
- 未授权时在 payload 收集和数据库读取前停止；
- 三条集成入口的签名边界，以及 institution 的机构范围拒绝；
- 13 条写路径的持久化集合、安全审计副作用和调用顺序；其中 7 条治理动作还写过程审计；
- 每条写路径适用的 400、403、404 或 normalizer 失败语义；
- 审计失败阻止持久写入和成功响应；写入失败向上抛出且不发送成功响应。

测试只描述当前行为。内存对象可能在审计或写入异常前已被 handler 修改，但没有调用成功的
`writeDatabase` 就不视为耐久提交；该遗留语义不能被误写为事务保证。

## 门禁

- 专项：`npm run operations-command:behavior-test`
- 标准测试：该文件属于 `test:unit` 对 `test:all` 的自动补集。
- CI：`governance-api` 显式运行专项门禁；聚合 required check 继续失败关闭。
- 组合验证：`npm run routes:check`、`npm run routes:test`、`npm run architecture:test`、
  `npm run process:verify`、`npm run process:test`。

## 不在本切片

- 不修改 `operations-command.js`、路由顺序、鉴权策略、错误结构或响应字段；
- 不新增幂等键、CAS、事务、outbox、数据库 migration 或生产晋升；
- 不把 T02 route owner 推断为 `resourceDispatchRequests`、`taskMessages` 的数据 owner；
- 不关闭 ARC-008。后续改为 T05 owner port 或版本化事件必须另立 ADR，并先保持本矩阵通过或明确批准契约变化。
