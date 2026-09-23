# PostgreSQL 业务主存储核心契约

## 真实目标 checkpoint 验证（ADR-OPS-047，在制）

仅在隔离随机真实 PostgreSQL 测试库中，把已绑定主存储批次账本与独立合成 SQLite checkpoint 组合验证。目标提交后进度未写可从目标权威账本核对后重放；目标未提交、错误身份、跳号及非空初始化必须拒绝。专用 runner 的 CI 结果需零跳过；本地环境跳过不算真实证据。本切片无生产 DDL、运行接线、自动 relay 或多实例承诺，生产 NO-GO。

## 当前结论

### OPS-045 源目标身份绑定（库级切片）

PR #314 已保护 squash 合并为 `6b10def4b0f3a39cb7eefd21b063acb92c3a5467`，与独立审查冻结 `f2fa372999a1b5dea345ce451de45608a1466e58` 和 PR 合成提交共享 tree `53e31652c91765109c1f89ec6f98e5f5897f2f18`。PR CI35712865240 九项成功，真实 primary 39/39、零跳过；完整本地串行门禁通过（全量 3726pass/40 环境 skip）。main CI35713934328 九项及 Pages35713934423 均成功（Pages 仅静态演示）；主线真实 primary 同样 39/39、零跳过。GOV-019 / OPS-045 关闭限定代码交付，WIP 2/5；OPS-045 运行能力仍为已实现，观测/跨进程/克隆/TLS/容量灾备和现场缺口保留。本收尾仅事实同步，仍需自身独审、冻结与门禁，生产 NO-GO。

Accepted ADR-OPS-045 新增 SQLite v19 空身份/genesis 结构和 PG 独立 v1 身份迁移；旧 PG DDL 不变。仅隔离合成库显式执行 initializeSqliteOutboxSourceIdentity、initializeTargetIdentity 和 bindSource，不自动初始化、回填历史或绑定。

applyBoundCommittedOutbox 只接受同进程真实 SQLite 只读 loader 返回的品牌 envelope，以及独立 expectedTargetId/namespace pin。PG 的写事务在 advisory lock 内核验 schema、实际目标和不可变源/genesis 绑定，再处理幂等/CAS；旧入口或直接事务在已迁移目标上缺 binding 均拒绝，载荷写入也必须完整匹配品牌批次。原六字段 commitment 不变。

未迁移目标仅保留 legacy 兼容；requireBoundIdentity 必须在实例构造时固定，已观察迁移的实例也不得回落。完整物理克隆、管理员删除全部标记后未配置 bound 要求的新实例、恶意同进程代码和跨进程来源证明不能由本机制解决。品牌不支持 JSON/复制后恢复，不是签名。未接 relay/checkpoint/业务请求/生产，productionPrimary=false，runtimeCutoverEnabled=false。

专项覆盖源/目标初始化、重启、错库/错源、旧入口、直接事务、重复返回、metadata 与实际 schema 漂移、迁移原子性及真实独立连接竞争；主入口串行保留既有 23 项 live 并追加身份用例。开发阶段结果不替代冻结提交的 CI，不以本地 skip 作为真实 PG 证据。升级后不自动 DROP/重绑，回滚必须保留事实并受控前滚或恢复备份。

代码库已提供一个与主服务隔离的 PostgreSQL 主存储核心契约：

- `disabled`：默认模式，不读、不写 PostgreSQL。
- `shadow`：仅允许独立 worker 消费已提交的 SQLite 事务 outbox。
- `primary-read`：允许在只读、可重复读事务中读取并验证集合摘要。
- `primary-write`：仍只允许独立 worker 消费已提交 outbox，不允许请求路径直接双写。

模式名称表示适配器演练能力，不表示平台已经切换生产主库。所有模式始终返回：

```json
{
  "productionPrimary": false,
  "runtimeCutoverEnabled": false,
  "externalEvidenceVerified": false
}
```

仓库测试只能证明契约、门禁和事务语义；不能证明现场数据库容量、备份恢复、故障切换或审批已经完成。

## 模块

- `src/platform/storage/postgres-primary-storage-contract.js`
  - 配置和证据门禁。
  - 集合读取、完整快照读取和影子核对。
  - 已提交 outbox 的事务应用。
  - 集合版本 CAS、批次幂等和链式连续性检查。
  - 迁移、核对、outbox 清空、RTO/RPO 和切回评估。
- `src/platform/storage/memory-postgres-primary-driver.js`
  - 确定性内存驱动，仅用于单元测试和集成适配器开发。
  - 模拟可重复读、串行化提交和事务回滚。
- `src/platform/storage/postgres-primary-driver.js`
  - 正式 `pg` 驱动，使用受控连接池和参数化 SQL。
  - 只读事务固定为 `REPEATABLE READ READ ONLY`。
  - 写事务固定为 `SERIALIZABLE`，并先取得事务级 advisory lock。
  - 在数据库中执行集合版本 CAS，负责事务提交、回滚、客户端释放和连接池关闭。
- `deploy/postgres-primary-storage-schema.sql`
  - 建立独立的主存储批次账本和集合状态表。
  - 删除集合保留版本墓碑，批次外键采用延迟校验，使集合变化和批次证据在同一事务提交。

## 环境契约

启用任一非禁用模式必须配置：

```dotenv
POSTGRES_PRIMARY_STORAGE_MODE=shadow
DATABASE_URL=postgresql://<受控凭据>@<受控地址>/<数据库>
POSTGRES_SSL_MODE=verify-full
POSTGRES_SCHEMA_EVIDENCE_ID=<证据引用>
POSTGRES_MIGRATION_EVIDENCE_ID=<证据引用>
```

进入 `primary-read` 或 `primary-write` 演练还必须配置：

```dotenv
POSTGRES_RECONCILIATION_EVIDENCE_ID=<证据引用>
POSTGRES_BACKUP_EVIDENCE_ID=<证据引用>
POSTGRES_RTO_RPO_EVIDENCE_ID=<证据引用>
POSTGRES_ROLLBACK_EVIDENCE_ID=<证据引用>
POSTGRES_CUTOVER_APPROVAL_ID=<审批引用>
```

环境状态输出只包含配置项是否满足，不回显 `DATABASE_URL` 或证据正文。

## 写入边界

业务请求必须先在当前主存储事务中提交业务状态、集合版本和 outbox。独立 worker 随后将批次及其提交凭证交给：

```js
await storage.applyCommittedOutbox(batch, {
  executionContext: "worker",
  commitment: {
    state: "committed",
    source: "sqlite-transactional-outbox",
    sourceTransactionId: "00000000-0000-4000-8000-000000000001",
    outboxSequence: 123,
    committedAt: "2026-08-06T00:00:00.000Z",
    payloadSha256: batch.payloadSha256
  }
});
```

契约会拒绝以下情况：

- `executionContext=request-path`；
- outbox 尚未提交或提交凭证不完整；
- payload、批次链或集合摘要不一致；
- 批次链乱序；
- 集合版本跳跃、回退或同版本不同内容；
- 同一批次 ID 被不同证据重复使用。

批次内任一集合失败，整批事务回滚。重复提交完全相同的批次返回 `duplicate`，不会重复写入。

### 重放合同加固切片（2026-09-21，已准入实施）

ADR `2026-09-21-postgres-committed-replay-hardening.md` 只批准合同与正式驱动边界加固。上例 UUID 是文档合成示例，不是可用于真实迁移的凭证；实际输入必须来自已提交 SQLite wrapper/loader，不接受从 batch ID 或调用时间补造证明。

凭证精确包含 `state/source/sourceTransactionId/outboxSequence/committedAt/payloadSha256` 六个普通数据属性。状态与来源取固定原值，事务 ID 为小写规范 UUIDv4，序号为正安全整数，时间为可往返 UTC 毫秒 ISO，摘要为小写 SHA-256 且与批次一致。未知字段、访问器、数字字符串、空白、大小写和日期偏移变体均拒绝，不先转换、截断或 trim。

重复批次须与目标账本逐项相等：`batchId/payloadSha256/previousChainHash/chainHash/sourceTransactionId/outboxSequence/committedAt`。任一缺失/漂移报冲突且不写集合或账本；`appliedAt/appliedChanges` 是目标执行结果，不属于源提交身份。PG 时间读取须保留足够精度，亚毫秒历史值不允许截断成合法毫秒凭证。

普通首次不存在集合允许源版本 0（旧兼容）或 1（SQLite 新凭证），均向驱动传 `expectedVersion=-1`，不把不存在伪装成现有 v0。已有集合和 tombstone 继续原后继 CAS/同版本同内容规则；显式 `baseline-snapshot` 的历史初始版本兼容保持不变，不因此新增历史导入权。

本轮使用正式 SQLite 临时合成库、内存主合同与受控 SQL 驱动测试；SQL mock 不是实际 PostgreSQL。现有远端真实 PostgreSQL 门禁只覆盖 auth/shadow，不能替代 primary 真实数据库、并发和现场证据。无 DDL、relay/checkpoint 或服务端接线；生产及 worker 激活继续禁止。

## 隔离真实主存储验证（2026-09-22）

新增 `npm run postgres:primary-live-contract` 专用入口，顺序执行 20 项实际重放/精度/回滚测试与 3 项独立连接并发测试。输入必须是正式 SQLite wrapper/loader 产生的合成凭证；原样加载既有主存储 DDL，调用正式 pg 驱动，不使用 SQL mock 替代数据库。

仅在隔离测试服务配置 `POSTGRES_PRIMARY_LIVE_TEST=1` 和专用 `POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL`。后者只接受 loopback（localhost、127.0.0.1、::1）、账号 `contract_runner`、管理库 `health_platform_contract` 及显式密码；不接受 URL 参数、片段或通用 DATABASE_URL/POSTGRES_URL 回退。NODE_ENV 为 production 时拒绝。该管理账号需要创建测试数据库的权限，不能用于生产。

每例创建随机 `platform_primary_test_<uuid>` 数据库，只清理本次成功创建且 OID/owner 仍一致的目标；先关闭自有连接池，不强制删除或终止其他连接。SQLite 文件位于临时目录，仅含合成数据。故障触发器只安装于本例随机库，不改正式 DDL 文件。

普通本地测试未启用开关时明确跳过；专用入口缺配置、执行失败、取消或任何跳过均失败。CI 在既有 PostgreSQL 16 隔离服务的 auth/shadow 步骤后串行执行此入口，不新增服务或放宽必需检查。PR #312 的 CI35689960332 已实际执行 23 项 primary 测试，全部通过且零跳过，代码已合入 main `fbaab2a0`；main CI35690591338 九项及 Pages35690591198 成功（Pages 仅静态演示）；main primary 同样 23/23 通过且零跳过。本机数据库不可用，本地跳过仍不是通过证据。清理钩子无错误，不等于另行完成残留库盘点。

并发测试以独立后端 PID 和实际 advisory-lock 等待证明连接重叠；只对明确的 40001 做一次重试。异载荷 CAS 用例验证低层竞争，不声称两条合法源链可同时推进。本测试服务禁用 TLS，驱动状态如实为 false；不提供生产 TLS、多进程、容量灾备、源目标绑定、relay/checkpoint 或上线审批证据。

## 驱动接入要求

正式驱动已经实现以下受限接口；调用方不能取得原始 `pg` client：

```text
driver.transaction({ isolation, readOnly }, callback)
  tx.getAppliedBatch(batchId)
  tx.getLastAppliedBatch()
  tx.getCollection(collection)
  tx.listCollections()
  tx.applyCollectionChange(change, { expectedVersion, batchId, appliedAt })
  tx.recordAppliedBatch(receipt)
```

连接池必须从 `DATABASE_URL` 创建，并强制
`POSTGRES_SSL_MODE=verify-full`。可选 CA 文件必须使用绝对路径。连接池大小、
连接超时和空闲超时分别由以下变量控制，并采用严格范围校验：

```dotenv
POSTGRES_PRIMARY_POOL_MAX=4
POSTGRES_PRIMARY_CONNECT_TIMEOUT_MS=5000
POSTGRES_PRIMARY_IDLE_TIMEOUT_MS=30000
POSTGRES_PRIMARY_APPLICATION_NAME=health-platform-primary-storage
POSTGRES_CA_FILE=/受控只读目录/root-ca.pem
```

测试或中央装配根可以注入共享 pool，但必须显式传入
`controlledPool: true`，避免把未知生命周期的连接池误认为生产受控连接池。
驱动自行创建的 pool 由 `close()` 关闭；注入的共享 pool 仍由其装配者关闭。

正式驱动满足：

- 只读使用 `REPEATABLE READ READ ONLY`。
- outbox 应用使用 `SERIALIZABLE`。
- 写事务在访问批次链前取得固定名称的事务级 advisory lock。
- 集合版本更新通过 `ON CONFLICT ... WHERE source_version = expectedVersion`
  在数据库中执行 CAS，不只依靠应用内检查。
- 删除操作保存 `payload=NULL`、空摘要、`deleted=true` 和递增版本墓碑，
  避免旧批次重新创建或删除新数据。
- 批次幂等记录、集合变化和链式检查在同一事务提交。
- 数据库账号采用最小权限，TLS 为 `verify-full`。
- 日志和异常不得包含连接串、凭据或集合正文。

全部业务值只通过 `$1 ... $n` 参数传入 SQL。驱动对连接错误进行脱敏，
事务异常会执行 `ROLLBACK`，并始终释放 client。

### Schema 安装边界

在受控验证库中由数据库变更流程执行：

```powershell
psql "$env:DATABASE_URL" `
  --set=ON_ERROR_STOP=on `
  --file deploy/postgres-primary-storage-schema.sql
```

执行前后必须分别归档 schema 变更审批、文件 SHA-256、数据库备份和结构验证
结果。该 SQL 不删除或改写现有 `runtime_collection_state` 影子表，也不会改变
主服务的 `STORAGE_ENGINE`。

## 切换评估

`assessTransition()` 只有在以下检查全部通过时返回
`readyForControlledRehearsal=true`：

1. 当前模式和证据配置完整。
2. 迁移集合计数一致，源目标摘要一致。
3. 最近核对为 `matched`，无差异和未关闭工单。
4. outbox 的 pending、retry、failed 均为零。
5. 原生备份和恢复已验证，实测 RTO/RPO 不超过目标。
6. 容量测试达到已批准的数据量、并发和吞吐目标，P95/P99 延迟不超过目标，且无未关闭严重问题；
   故障切换已验证、耗时不超过目标且未观察到数据丢失。
7. 已验证切回 SQLite 且未观察到数据丢失。

其中当前配置的 `POSTGRES_PRIMARY_STORAGE_MODE` 必须与输入中的 `requestedMode` 完全一致；
不能用已配置的 `primary-read` 环境评估 `primary-write`，也不能用其他模式的配置代替目标模式。

容量与故障切换只接收元数据和受控证据引用，不接收测试数据、日志正文、连接串或凭据。
`capacity.profileRef`、`capacity.evidenceRef` 和 `failover.evidenceRef` 必须是 4 至 240 字符且不含
换行的字符串受控引用；目标数值必须为规范十进制有限正数，实测耗时和延迟必须为规范十进制
有限非负数，集合、计数、数据量、并发和严重问题数还必须为安全整数。空字符串、空白、
`NaN`、`Infinity`、负数、十六进制或指数形式、未验证状态、数据丢失或未关闭严重问题均失败关闭。

即使全部通过，`activationAuthorized`、`productionReady` 和
`productionPrimary` 仍为 `false`。正式启用必须由 T00 在中央装配根接线，
并在现场证据和独立审批完成后另行发布。

### 可部署评估入口

将七门元数据写入仓库之外的受控 JSON 普通文件，并设置：

```dotenv
POSTGRES_PRIMARY_TRANSITION_INPUT_FILE=/run/health-platform/postgres-transition-readiness.json
POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256=<该文件的 64 位小写 SHA-256>
```

然后执行 `npm run postgres:transition-readiness`。文件必须使用绝对路径、不是 symlink、非空且不超过
1 MiB；顶层和每个 section 都是闭集 metadata-only 字段，未知字段、业务 payload 和连接信息会被拒绝；
合同禁止任何凭据，CLI 额外拒绝常见凭据模式，但该启发式检查不替代 secret scanning 或 DLP。
CLI 从已打开的文件描述符有界读取，并要求内容与必填的预期 SHA-256 完全一致；摘要缺失、格式错误或
内容在交接后被同长度原地改写都会失败关闭。
命令复用 `buildPostgresPrimaryStorageConfig` 与 `buildTransitionAssessment`；七项检查全部通过时最多
返回 `readyForControlledRehearsal=true`，而 `activationAuthorized`、`productionReady`、
`productionPrimary`、`runtimeCutoverEnabled` 始终为 `false`。该入口没有接入 strict preflight。

## 建议集成顺序

1. T00 将配置状态接入环境检查和发布报告，但保持主服务启动阻断。
2. 在隔离 PostgreSQL 验证库安装主存储 schema，运行正式驱动的现场契约测试。
3. 将现有 SQLite outbox worker 改为调用 `applyCommittedOutbox()`。
4. 完成影子连续核对后，才在隔离环境装配 `primary-read`。
5. 完成容量、故障切换、原生恢复和切回演练后，再评审 `primary-write`。
6. 生产启用属于独立现场变更，不能由环境变量或仓库测试自动批准。

# 独立持久 checkpoint（合成首切片，2026-09-23）

`createPrimaryDurableCheckpoint({checkpointFile, sourceFile, driver, expectedTargetId})` 是显式本地合成端口，不由服务、HTTP 或 worker 导入。调用方对全新隔离路径显式 `await initialize()` 一次；目标身份绑定且批次账本为空才可初始化，缺失的已用文件不会自动重建。独立 SQLite v1 文件只存技术身份、序号和摘要，不存集合 payload。调用方必须先经原有绑定合同提交目标批次；`advance(envelope)` 从源 loader 原始品牌对象和目标只读、身份绑定的已应用账本核对完整凭证，再以 `BEGIN IMMEDIATE` 单调追加。目标提交后 checkpoint 写入前中断，可再次核验并推进；已有最后批次精确重放返回原游标，不写新行。`await read()` 重新扫描源链，空进度也复核目标绑定；非空进度同时核验目标凭证。丢失/漂移、跳号、错身份或目标凭证不符均失败关闭，不自动补历史。

此文件不是可信外部 anchor；完整文件回滚/克隆、跨主机并发、真实 TLS/容量/灾备和现场签署仍需独立方案。无自动 relay、业务请求或生产接线；六域生产继续 NO-GO。决策见 [ADR-OPS-046](adr/2026-09-23-primary-durable-checkpoint.md)。
