# ADR：PostgreSQL 受控切换评估与部署闭包边界

- 状态：Accepted
- 日期：2026-08-24
- Owner：T00（数据库组合、部署制品与生产门禁）

## Problem

仓库已有 PostgreSQL migration package、shadow sync、只读核对、primary-read rehearsal、生产适配器和主存储核心契约，但缺少一个可部署、失败关闭的统一评估入口，部署包也没有把这些命令、systemd 模板和环境变量登记成完整闭包。现场人员容易把分散命令的局部成功误解为主库已经可以切换，或者在缺文件、缺配置时仍得到不完整的部署制品。

## Options

1. 继续由人工分别执行现有命令并在交接文档中汇总结论。
2. 把 PostgreSQL 切换判断直接接入 strict production preflight 或主服务启动流程。
3. 新增独立的 metadata-only 评估 CLI，复用现有主存储配置与七门评估函数；同时把迁移、演练、核验、备份、shadow worker 和 reconciliation 的依赖闭包纳入不可变部署包，但不接入主库激活。

## Advantages

- 方案 3 复用 `buildPostgresPrimaryStorageConfig` 与 `buildTransitionAssessment`，不创建第二套切换判定语义。
- 输入限定为绝对路径、普通非符号链接、最多 1 MiB 的闭集 metadata-only JSON，并由必填小写 SHA-256 固定内容；缺输入、摘要不符、畸形输入和未知字段均失败关闭。
- 部署包能够机器校验 migration、primary-read、adapter、storage-admin、sync/reconcile 服务和变量是否齐全。
- `DATABASE_URL` 只作为 secret contract 引用出现，不进入进程合同、评估结果或部署制品值。
- 七门全部通过最多证明 `readyForControlledRehearsal=true`；激活、生产主库和生产就绪状态始终保持 false。

## Disadvantages

- 现场必须额外维护一份受控 metadata-only JSON，并保证其引用的容量、故障切换、恢复和审批证据可独立复核。
- systemd 模板与部署包的闭集门禁更严格，新增或改名 PostgreSQL 变量、入口和模板时必须同步更新合同及测试。
- 该 CLI 不读取原始业务记录或外部证据正文，因此不能独立判断证据真实性。

## Migration cost

- 在部署 secret/metadata 挂载区提供 `POSTGRES_PRIMARY_TRANSITION_INPUT_FILE` 指向的只读普通文件，并单独注入其 `POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256`。
- 用统一占位符渲染 sync/reconcile service，并安装配套 timer。
- 在受控验证环境依次执行迁移包生成/核验、备份与检查、shadow sync/reconciliation、primary-read rehearsal、adapter verify 和 transition readiness。
- 旧部署包需要重新构建并通过 verifier；不涉及 SQLite migration、业务数据回填或 HTTP 客户端迁移。

## Risk

- 伪造 `verified` 元数据可能让评估结果达到受控演练资格；因此它不得进入 strict preflight，也不得授权运行时切换，真实证据和独立签字仍由现场流程验证。
- PostgreSQL 连接、容量、主从故障切换、原生恢复和回退只可能在真实环境证明，仓库测试不能替代。
- shadow worker 仍消费 SQLite 事务 outbox；当前不授权请求路径双写、worker 启动、主读或主写。

## Recommendation

采用方案 3。把 CLI 和部署闭包作为进入受控演练前的仓库侧必要门禁；任何通过结果都必须继续标记 production `NO-GO`，并由后续独立现场变更、外部证据和审批决定是否允许运行时切换。

## Decision

- 新增 `postgres-primary-transition-readiness-v1` CLI 输出，输入合同为 `postgres-primary-transition-metadata-v1`。
- 输入顶层只允许 `requestedMode`、`migration`、`reconciliation`、`delivery`、`recovery`、`capacity`、`failover`、`fallback`，各 section 也使用闭集标量字段。
- CLI 必须从打开的 descriptor 有界读取并核验调用方提供的 SHA-256，不能依赖文件时间戳判断内容稳定性。
- 评估严格复用既有七门：配置、迁移、核对、outbox、备份恢复、容量与故障切换、fallback。
- 配置门还要求当前 `POSTGRES_PRIMARY_STORAGE_MODE` 与输入 `requestedMode` 完全一致，禁止跨模式借用环境配置。
- 部署包登记 `postgres-shadow-sync` 和 `postgres-shadow-reconciliation`，两者固定 `productionReady=false`，且不由本 ADR 启动。
- `databaseTransition` 登记 readiness、migration package/verify、primary-read rehearsal、adapter verify、storage backup/inspect、shadow sync/reconciliation 命令。
- 缺少任一文件、模板、变量或任何 transition/job 生产标志被伪造成 true 时，部署 verifier 与 deploy check 必须失败。
- 本 ADR 不修改 HTTP API、SQLite/schema、业务数据、strict preflight、对象存储 v2 或连续审计。
