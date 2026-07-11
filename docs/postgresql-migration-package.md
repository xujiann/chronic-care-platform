# PostgreSQL 迁移包与数据校验

## 使用边界

`postgres:migration-package` 默认只生成表结构、装载模板、回滚脚本、集合计数和 SHA-256 摘要，不包含居民、就诊、报告或运营记录正文，也不保存 `DATABASE_URL`、用户名或密码。该制品可进入 CI 发布归档。

全量迁移文件包含敏感业务数据，只允许在受控主机生成到仓库之外的访问受限目录：

```powershell
npm.cmd run postgres:migration-package -- --mode=full --output-dir=D:\secure-migration\PDB-001 --migration-run-id=PDB-001 --acknowledge-sensitive-data
npm.cmd run postgres:migration-verify -- --output-dir=D:\secure-migration\PDB-001
```

工具会拒绝把全量导出写入仓库目录。全量目录不得上传 Git、普通 CI artifact、即时通信或非加密共享盘。

## 制品内容

- `manifest.json`：源快照摘要、集合计数、逐集合摘要、文件摘要和生产阻断项。
- `schema.sql`：`health_platform` schema、迁移运行台账、记录表和快照表。
- `load.sql`：迁移运行登记和受控装载事务模板。
- `verify.sql`：导入记录数、唯一键和摘要格式复核。
- `rollback.sql`：按 `migration_run_id` 删除本批数据；执行前仍必须有可验证的数据库原生备份。
- `records.copy.tsv`、`snapshots.copy.tsv`：仅全量模式生成，用于受控 `psql \\copy`。

## 上线流程

1. 先生成默认 manifest 模式制品并执行 `postgres:migration-verify`。
2. 在脱敏数据上完成一次全量生成、装载、计数复核和回滚演练。
3. 在目标容量数据上验证事务时长、索引构建、锁等待、磁盘增长、主从延迟和故障切换。
4. 归档源摘要、目标计数、差异清单、原生备份编号、RPO/RTO、回滚回执和责任方签字。
5. 只有运行时 PostgreSQL 适配器、读写一致性、容量与灾备全部验收后，才允许解除 `STORAGE_ENGINE=postgres` 阻断。

迁移包通过不等于 PostgreSQL 运行时适配器已经启用，也不等于生产数据库已经正式验收。
