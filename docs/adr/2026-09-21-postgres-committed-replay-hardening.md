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

## 2026-09-22 Accepted 附录：ADR-OPS-044 真实主存储测试切片

本附录依据用户对明确限定的真实 PostgreSQL 验证计划回复“批准”，随后要求继续。原 ADR-OPS-043 代码交付边界不变；本次仅接受测试和既有 CI 串行验证入口，GOV-018/OPS-044 为独立任务，不授权运行时修复、生产 DDL、relay/checkpoint 或上线。

### Problem / Options

现有真实 PG 门禁仅覆盖 auth/shadow，primary 仍主要由 SQL 替身证明。直接接 relay 会把未验证的精度、回滚与竞争语义带入新链路；本次选择在独立随机测试数据库中运行正式 driver 与原 DDL，保留旧门禁。暂不采用修改生产数据库、重新设计 schema 或克隆源历史的方案。

### Advantages / Disadvantages / Migration cost

复用既有 pg、CI PostgreSQL 服务、正式 SQLite receipt 与 driver，无新增依赖或生产迁移。真实 SQL 可证明限定版本数据库语义，但受控 loopback 明文连接不证明生产 TLS、完整服务多进程、容量和现场配置。本地 Docker 服务当前不可连接，允许本地明确跳过，不能用跳过替代 CI 必执行证据。

### Risk

连接前验证专用显式开关和独立 URL，禁止通用 URL 回退；严格 loopback、测试账号和管理库，拒绝生产模式、参数与非规范值。每个测试只创建随机库，成功创建后才取得清理资格；核对当前数据库，关闭自有 pools 后精确删除，不批量 DROP、不删除已有库、不终止无关连接。正式 DDL 文件保持不变，仅安装在本轮隔离测试库。

真实 SQLite 包装器及只读 loader 产生重放输入。直接查询精确时间和文本 bigint 验证零写与回滚；不得用 SQL mock 替代。并发以独立 pools/PID、真实 advisory lock 等待证明重叠；仅显式有界重试已确认的序列化冲突，不能把任意失败吞成成功。低层异载荷 CAS 测试不声称两条合法完整源链或自动重试能力。

### Recommendation

按 ROADMAP 同日 PLAN 的四角色精确单写范围执行。CI 保留原 auth/shadow 步骤并追加串行 primary 步骤；显式启用后缺配置、连接失败、测试失败或全跳过均拒绝。先专项与独立审查，再冻结并串行重型门禁；新精确 CI 实际执行后才登记真实 PG 测试证据，不提升生产能力。若发现需要修改 runtime/schema 的问题，应报告并另行准入，不为绿灯改变断言。
