# PostgreSQL 居民主索引基础批次

## 增量边界

本增量建立 `health_master` 居民主索引领域模型和受控迁移包，不修改主服务存储引擎，不启用 PostgreSQL 生产读写，也不宣称已经接入人口库或电子健康码权威源。

默认 manifest 包只包含 DDL、执行模板、集合计数和 SHA-256 摘要。full 包包含姓名、出生日期等敏感居民字段，只允许在受控主机生成到仓库外目录：

```powershell
$env:MPI_IDENTITY_HASH_KEY="从密钥托管注入的至少32字节随机密钥"
$env:MPI_IDENTITY_HASH_KEY_VERSION="identity-v1"
$env:MPI_NAMESPACE_KEY="独立且稳定的至少32字节MPI命名空间密钥"
$env:MPI_NAMESPACE_KEY_VERSION="namespace-v1"
node scripts/postgres-mpi-foundation.js build --mode=full --output-dir=D:\secure-migration\MPI-001 --migration-run-id=MPI-001 --source-system=masked-his --default-authority=authority-a --acknowledge-sensitive-data
node scripts/postgres-mpi-foundation.js verify --output-dir=D:\secure-migration\MPI-001
```

`MPI_IDENTITY_HASH_KEY`、`MPI_NAMESPACE_KEY`、数据库连接信息、证件原文和手机号原文都不会写入制品。制品只记录非秘密的密钥版本标识。full 包仍含敏感人口属性，不得上传 Git、普通 CI artifact、即时通信或非加密共享盘。

身份哈希密钥轮换采用双读双写：轮换窗口通过 `MPI_IDENTITY_HASH_KEYS_JSON` 同时注入旧、新版本，例如 `[ { "version": "identity-v1", "key": "..." }, { "version": "identity-v2", "key": "..." } ]`。新旧摘要分别带 `hash_key_version`，只有相同版本的摘要才能比较；待历史数据补齐新摘要并完成核对后，才能停用旧版本。`MPI_NAMESPACE_KEY` 与身份查询密钥分离并在轮换期间保持稳定，因此轮换身份哈希密钥不会改变已经分配的 MPI ID。命名空间密钥如必须轮换，应走单独的 MPI 映射迁移和多方审批，不得直接重新生成居民主索引。

## 领域模型

- `health_master.mpi_migration_runs`：批次、源摘要、规则版本和验证状态。
- `health_master.resident_master`：不可变 MPI 标识、存续状态和合并指向。
- `health_master.resident_identifier`：证件、健康码和手机号的 HMAC-SHA-256 索引，不保存原文。
- `health_master.mpi_conflict_case`：身份碰撞、强标识冲突等无居民正文的处置工单。
- `health_master.mpi_match_candidate`：待人工复核候选、分数、原因和结论。
- `health_master.mpi_conflict_case_action`：分派、签收、关闭、重开和备注的不可变动作历史。
- `health_master.mpi_merge_event`：合并与拆分的操作者、原因和证据引用。
- `health_master.mpi_attribute_provenance`：姓名、出生日期、性别等存续字段的来源和摘要。
- `health_master.mpi_rule_version`：匹配规则版本和“手机号禁止自动合并”硬约束。

## 匹配规则

1. 已核验证件号或电子健康码唯一命中一个居民时允许自动关联。
2. 同一次匹配中出现其他已核验强标识冲突时转人工复核。
3. 一个已核验强标识命中多个 MPI 时按身份碰撞处理，不自动合并。
4. 姓名、出生日期、性别、地址和手机号只形成候选分；即使高分也必须人工复核。
5. 手机号单独命中不得自动关联，因为存在家庭共用、回收和变更风险。
6. 无权威命中且候选分不足时创建新的不可变 MPI 标识。

人工复核工单只记录源记录 HMAC、候选 MPI、分数、原因码、责任人、状态和证据引用，不记录姓名、证件号、手机号或其他居民正文。工单必须按 `open → acknowledged → resolved` 闭环；同一冲突再次出现时进入 `reopened`，未关闭工单阻断批次验收。

MPI 标识由已核验强标识的密钥化摘要派生；没有强标识时由来源系统与源记录号派生。标识本身不包含证件号、手机号或姓名。

## 迁移与回滚

1. 在脱敏居民样本上生成并验证 full 包。
2. 应用 `schema.sql`，登记 `migration_run_id` 后在同一受控 `psql` 会话装载 TSV。
3. 执行 `verify.sql`，复核居民数、标识数、唯一性、非法合并状态和未处理候选。
4. 发现标识碰撞时停止批次，将冲突交由居民主索引责任人处理，不得绕过唯一约束。
5. 回滚前必须验证 PostgreSQL 原生备份；`rollback.sql` 只删除本批创建且未参与合并的记录。

## 首批验收

- manifest 包不含居民正文、原始证件号、手机号、哈希密钥或数据库凭据。
- full 包只能写到仓库外，并且原始证件号和手机号不进入标识 TSV。
- 强标识唯一命中自动关联；手机号单独命中不自动关联；冲突进入人工复核。
- 强标识重复为零、错误自动合并为零、未处置身份碰撞为零。
- 迁移居民计数、标识计数和制品摘要验证一致，回滚使用批准的 `migration_run_id`。
- PostgreSQL 原生备份恢复实测达到当前建议基准：RPO 不超过 120 分钟、RTO 不超过 720 分钟。
- 数据库管理员、居民主索引责任人、平台运维和发布负责人完成证据签字。

manifest 中的 RPO/RTO 状态固定为 `proposed-unmeasured`，实测值、证据引用和生产验收均为空或 false；生成制品和单元测试不得把建议目标写成已达标。只有原生备份恢复演练产生实测分钟数、证据编号并完成多方签字后，才能由后续现场验收流程更新结论。

满足以上条件仍只代表 MPI 基础批次验收，不会解除 `STORAGE_ENGINE=postgres` 的生产阻断。
