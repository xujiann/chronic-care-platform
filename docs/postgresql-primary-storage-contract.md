# PostgreSQL 业务主存储核心契约

## 当前结论

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
    sourceTransactionId: "sqlite-tx-...",
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
