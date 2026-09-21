# ADR：SQLite outbox 提交凭证与主存储样本投递边界

- 状态：Proposed
- 日期：2026-09-21
- Owner：T00 存储组合与迁移；T02 数据质量问题集合；T09 兼容路由
- 依据：用户于 2026-09-20 批准迁移样本方向；本文件把后续涉及 schema 的实施范围具体化，尚不授权 DDL、运行时接线或 worker 激活。
- 基线：已知主线 `b54c9a6c`；只读样本候选 `17df11d7` 已独立复审并完成本地全量测试，尚未远端集成。开始实施前须重新核对主线、schema head 和并行 migration。

## Problem

当前 SQLite v8 建立的 `postgres_sync_outbox` 已有耐久 `sequence`，并在业务写事务中插入 batch、payload 摘要和链摘要。问题不是数据库没有序号，而是 `loadPendingPostgresSyncBatches` 没有投影序号，也没有与业务事务绑定的 `sourceTransactionId`。主存储 `applyCommittedOutbox` 要求两者；不能由读取时间、测试常量或 batch ID 冒充事务提交证明。

现有 worker 投递至 `runtime_collection_state`；首发计划目标则是 `primary_collection_state`。共享旧 delivery 状态会使一个目标的成功掩盖另一个目标的漏投。批次摘要链覆盖全部集合，过滤出 `dataQualityIssues`、删除其他 changes 或重算原链均会破坏原始提交边界。

此外，现有主存储重复判定只比较 payload/chain 摘要，未对事务引用和 outbox 序号作完整重放绑定。源证明补齐后，必须一并验证该边界。

## Options

1. 在读取时以 batch ID 合成事务引用，并复用旧 worker delivery 状态。改动小，但改变事务引用语义且没有独立目标进度，拒绝采用。
2. 在原 outbox 增加可空事务字段，历史保持 null，未来事务原子填入。这是可行的较小 DDL 方案；缺点是同一表同时承担可变旧投递状态和不可变凭证，需额外防止 UPDATE 状态时覆盖凭证。自动补历史值的变体则无法证明原事务，拒绝采用。
3. 新增提交凭证表，与原 outbox 在同一 SQLite 事务原子提交；新增只读装载端口和独立目标 checkpoint，完整重放批次。历史缺凭证行保持阻断，首个样本使用全新、隔离、仅合成数据的源库及目标命名空间。
4. 改造所有领域写 API 或直接切换 PostgreSQL 主库。超出本样本范围。

## Advantages

方案 3 保持 SQLite 为当前事实源，保留既有 outbox、旧 worker 和 API 兼容性。独立 receipt 表隔离不可变提交证明与旧 worker 可变投递状态，单独实施保留与禁止补证策略；代价是 join 和外键校验。凭证唯一关联已存在的 batch 和 sequence，不复制业务 payload。读取者只能在事务提交后通过另一连接看到 outbox 与凭证；回滚时两者均不可见。目标投递独立记账，可在目标提交后、checkpoint 写入前宕机时安全重放。

## Disadvantages

增加一次版本化 SQLite migration 及独立目标进度绑定。checkpoint 优先评估复用现有表和存储端口；只有确认其不能提供不可变身份绑定与 CAS 后，才在后续 relay 切片提出新表，不提前指定重复表。旧库含无凭证链前缀时不能直接启动新的主存储 relay。真实源库的重新基线、链纪元或历史认证方案需要后续独立设计；本 ADR 不解决这一生产迁移问题。

## Migration cost

实施时从注册表取得当前 head，并核对 Proposed migration 预留；不得硬编码或抢占版本号。保留全部历史 migration checksum，增加新版本及内容指纹，同步 schema 文档和验证测试。

拟议 `postgres_sync_commit_receipts`：

| 字段 | 约束与用途 |
|---|---|
| outbox_sequence | 主键，外键指向 outbox.sequence，ON DELETE RESTRICT |
| batch_id | 唯一且非空；装载时必须与被引用 outbox 行严格相同 |
| source_transaction_id | 唯一且非空；受控事务包装器在 BEGIN 后产生随机 ID，禁止调用者注入或从 payload 推导 |
| recorded_at | 事务内记录时间；只表示记录时间，不宣称数据库精确 COMMIT 时刻 |
| payload_sha256 / chain_hash | 小写 SHA-256；装载时与 outbox 行、解析后的 envelope 一致 |

必须先由事务包装器建立一个明确事务，每个受控事务恰好生成一个完整 batch/receipt，再依次提交业务状态、outbox、凭证和现有 storage event；任一步失败全部回滚。拒绝嵌套事务、向包装器提供既有 batch/receipt，及为已存在 outbox 补发 receipt。禁止 `enqueuePostgresSyncBatch` 在事务外单独制造凭证。

独立装载器使用只读连接和一致快照，从 outbox 驱动 LEFT JOIN receipt，按 sequence 与独立游标读取全部状态，包含旧 worker 已标记 delivered/failed 的行；不能调用只返回 pending/retry 的旧 reader。缺 receipt、join 不唯一、首行不是游标所绑定链的直接后继，或摘要/链/版本不符时停止；不静默跳过。SQLite sequence 可以因事务/分配历史出现数值空隙，连续性通过原批次 previous_chain_hash 和已验证游标共同判断，不能以 sequence+1 代替链核验。

输出既有 commitment 形状：事务 ID 必须为严格规范 UUID 字符串，序号为正安全整数，摘要为小写 SHA-256，时间为可往返解析的 UTC 毫秒 ISO 字符串。拒绝前后空白、截断、数字字符串、无效日历日期和未知字段，不先 trim/截断再比较。原始 outbox batch_id 与 receipt.batch_id 必须精确相等。`committedAt` 采用已提交行的 recorded_at 并明确时间语义；不得用该字段判定生产证据的新鲜度。现有主存储入口的 normalizeCommitReceipt 需要在独立 replay 切片同步收紧。

本地首样本限全新合成源库，从链起点完整消费单源 outbox。目标限定一个独占 `primary_storage_batches/primary_collection_state` 命名空间；不得让两个源库竞争全局唯一 outbox_sequence。首次启动须源链从起点可验证且目标为空；恢复启动允许同一绑定下由目标 batch ledger 精确证明的既有数据。未知数据、多源或缺凭证链前缀阻断。

relay 切片实施前，必须为源实例、目标实例/命名空间、链起点和 checkpoint 定义不可变绑定：源实例标识耐久保存且重建新库不得沿用；目标身份须由受控连接/目标侧绑定校验，不能只散列连接串或相信调用者字符串；链起点绑定首 batch ID 与 chain hash。恢复时核对 checkpoint 的最后 sequence/batch/digest/chain 和目标账本；目标可领先 checkpoint 一个已证实原子批次并走精确重放，checkpoint 领先目标、目标恢复为空、实例或命名空间改变均停止。禁止自动重置游标或把旧 checkpoint 迁到新目标。目标身份存储、现有 checkpoint 复用结果和必要 DDL 必须在 relay 的具体 PLAN 中列明，经审查后才能接线；本次首个 receipt 切片不实现 relay。

## Risk

- **原子性**：在每个写入步骤注入失败，分别从新连接检查业务、outbox、receipt 和 storage event，拒绝半提交。
- **历史伪证**：migration 只建结构，不为历史行回填事务 ID。历史缺凭证行必须明确报告并停止，不能跳过后续接链。
- **批次破坏**：完整 payload 与 changes 必须保持原始摘要；未批准集合出现在样本批次时拒绝整批，不能过滤后再签发新批次。
- **双目标丢投**：主存储 relay 不修改旧 worker 的 pending/retry/delivered 状态；使用独立 checkpoint，故障重放核验完整 payload、chain、sourceTransactionId、outboxSequence 绑定。
- **回放漂移**：同 batch ID 的事务引用、序号、提交时间或摘要不一致必须冲突；不得沿用仅 payload/chain 相同就成功的判定。覆盖 UUID 空白/超长变体、数字字符串、时间偏移/无效日历日期及跨事务重放。
- **回滚**：目标事务失败回滚全部集合和 batch ledger。目标提交而 checkpoint 失败时保留源行重放；停 relay 后保留 receipt/checkpoint，不自动 DROP 或删除源事实。
- **证据真实性**：本地测试和 metadata 不能代替真实 PostgreSQL、多实例 CAS、容量、备份恢复或现场签署。生产与本地真实数据激活开关保持关闭。

## Recommendation

推荐方案 3，按以下独立切片审查：

1. T00：版本化 receipt 表、schema 文档、事务包装器与只读 receipt loader；验收空库、实施基线 head 升级、重跑、指纹、历史缺凭证、旧 delivered/failed 行仍被读取、嵌套/补证拒绝与所有写步骤回滚。先只使用合成测试库，禁止服务端接线。
2. T00：主存储重放凭证完整比较、独立 checkpoint 与受控 relay；测试重复、异载荷/凭证冲突、链断裂、CAS、目标故障和 checkpoint 故障。不得修改旧 worker 的目标和投递状态。
3. T02：数据质量覆盖项样本，复用 OPS-041 校验；仅完整合成批次，验证源/目标精确数量、版本、摘要和恢复。T09 路由本轮仍无需修改。
4. T00：独立审查后冻结提交，串行运行必需测试；真实 PG 未配置则如实保留跳过与未验证项，不晋级迁移能力或生产准入。

拟议写范围在实施前登记到机器任务总账：`src/platform/storage/sqlite-migrations.js`、新的 receipt/loader 模块、对应测试和 schema 文档；第二切片才扩展主存储 replay/checkpoint 模块。禁止借本 ADR 改写 `server.js`、T09 路由、历史 migration、生产配置或自动发布。新增 schema、事务组件与读取合同的具体实现需本 ADR Accepted 后进入独立任务。
