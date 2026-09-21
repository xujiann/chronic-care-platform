# ADR：PostgreSQL 已提交批次重放合同加固

- 状态：Accepted
- 日期：2026-09-21
- Owner：T00
- 批准：用户对限定的重放合同加固计划回复“批准”。只接受本文范围，不扩大原 receipt ADR 后续 relay/checkpoint 的授权。
- 基线：main@6e5ba723，PR #309、PR/main CI 各九项成功，SQLite head 18。

## Problem

SQLite receipt 首个集合版本为 1，而主存储普通首次应用只接受 0。主合同凭证校验仍 trim/截断/转换，重放只比较 payload 和 chain 摘要，不能拒绝同批次事务引用、序号或提交时间变化。PG timestamptz 的亚毫秒差异也不能被 JavaScript Date 投影掩盖。

## Options

1. 保持现状并直接接 relay：版本不兼容且重放身份不完整，拒绝。
2. 仅加固既有合同及正式驱动证据边界，复用现有字段并保留明确旧版本兼容；本轮采用。
3. 同时修改 schema、身份绑定、checkpoint 和 relay：范围过大，另行 PLAN/准入。

## Advantages

无 DDL、无新事实源；七个源身份字段均已存在于 primary_storage_batches。真实 SQLite 合成源可验证首版本兼容，不需伪造事务证明。

## Disadvantages

历史不规范凭证将被拒绝，不自动修复或补造。源/目标身份、完整历史认证、耐久 checkpoint、容量与生产接线仍未解决。SQL 适配器 mock 不证明真实 PG primary 语义；既有真实 PG auth/shadow CI 不能替代此证据。

## Migration cost

低至中：不改 SQLite v1–v18、PG DDL、数据或依赖。仅更新合同、正式驱动和测试 fixture 为规范 UUID，并同步接口与六图文档。

## Risk

- 凭证保持六字段闭集，普通数据属性，规范 UUIDv4、正安全整数、小写 SHA-256、可往返 UTC 毫秒 ISO；拒绝未知字段、访问器及任何类型/大小写/空白规范化。
- 重放精确比较 batchId、payloadSha256、previousChainHash、chainHash、sourceTransactionId、outboxSequence、committedAt；缺失或漂移均冲突零写。appliedAt/appliedChanges 是目标结果，不当作源提交身份。
- PG 已持久化时间须无损核验；亚毫秒历史值不能截断后视为同一凭证。正式驱动写入同样严格校验，不给规范化旁路。
- 普通不存在集合允许首次 v0（旧兼容）或 v1（SQLite receipt），仍以 expectedVersion=-1 执行插入 CAS；已有集合、tombstone、同版本同摘要重放及 baseline-snapshot 原规则不变，禁止跳版本或伪造已有 v0。
- 保持事务、advisory lock、参数化 SQL、延迟外键及失败回滚，不改旧 worker delivery 状态。

## Recommendation

GOV-017 先核实 PR309 并关闭已交付台账；OPS-043 独立登记技术存储范围。开发 A 单写主合同及其测试和 SQLite→内存主合同专项；开发 B 单写正式驱动及对应测试；协调者单写治理/文档；审查者只读。

专项覆盖严格输入、每个重放字段冲突与零写、首次 0/1、首次 >1 拒绝、baseline 兼容、后继 CAS、墓碑、真实 SQLite 生成 receipt 及全批回滚。审查后冻结，按原必需门禁串行验证，按既有保护流程推送/合并。真实 PostgreSQL primary 的安装、多实例及现场测试仍未由本轮 mock 证明。

禁止 relay/checkpoint、服务端/HTTP 接线、源目标身份 DDL、真实数据迁移、worker/主库或生产激活。回退只停止新调用方并保留所有账本与源事实；不得以恢复宽松比较消除历史冲突。生产保持 NO-GO。
