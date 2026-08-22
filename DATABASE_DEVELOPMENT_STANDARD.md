# 数据库开发标准

## 1. 强制规则

1. 不直接编辑 `data/db.json`、SQLite、WAL/SHM、备份或生产 PostgreSQL。
2. schema 变化必须有 migration；禁止用启动时无版本 SQL 绕过。
3. 已发布 migration 默认不可变；修正通过新版本完成。
4. 每个 migration 只能承担一个清楚主题，版本连续且 owner 明确。
5. migration 内容必须进入 checksum/fingerprint，不能只散列版本和名称。
6. 更新 schema head 时同步运行时常量、检查脚本、测试和 `DATABASE_SCHEMA.md`。
7. 生产写模型必须先登记 data owner 和版本化写契约。
8. 请求路径不得执行 SQLite/PostgreSQL 双写；使用事务 outbox。
9. 新增或引用 state collection 必须同步 `state-collection-governance`；未知 owner 只能进入
   `review-required`/`legacy-quarantined`，不得用 route/process owner 自动推断数据 owner。

## 2. Migration 必备结构

- version、name、owner、problem/ADR；
- apply 和可执行验证；
- 前置版本和环境约束；
- 事务边界；
- 内容 SHA-256；
- 空库、历史升级、重复执行、部分失败测试；
- 数据回填、核对、回滚或前滚恢复；
- 兼容窗口和旧版本退出条件。

## 3. 禁止模式

- 修改历史 migration 后保持同一 checksum。
- 在路由 handler 中执行 DDL。
- 新建未注册 JSON 集合作为生产事实源。
- 为同一实体创建平行 ID 体系而无映射/合并策略。
- 把演示快照或 readiness 报告当作生产迁移证据。
- 以测试环境成功推断现场 PostgreSQL 已就绪。

## 4. 验收矩阵

| 场景 | 必须验证 |
|---|---|
| 空库 | 从 0 到 head，表/索引/FK/ledger 正确 |
| 历史库 | 每个受支持版本到 head |
| 重跑 | 已应用版本不重复，内容漂移被拒绝 |
| 失败 | 事务回滚，无半结构状态 |
| 数据 | 行数、摘要、孤儿、版本、抽样业务语义 |
| outbox | 顺序、幂等、重试、链、checkpoint |
| 回滚 | 明确可逆、前滚恢复或备份恢复步骤 |

## 5. 当前迁移路线

① 输出 schema → ② 分析关系 → ③ 核对实际使用 → ④ 维护 `DATA_MODEL.md` → ⑤ 加固 migration 体系 → ⑥ 冻结核心表/定义 → ⑦ 新需求按新标准 → ⑧ 旧结构渐进迁移。

①–④已完成主线重验；⑤已由 Accepted ADR 和独立 migration 注册表实施，⑥由 v1–v14 冻结指纹、`CORE_DATA_DEFINITIONS.md` 与 owner 规则共同约束。⑦–⑧继续按新 migration 标准和逐批数据核对实施，不得回写历史版本。

DATA-003 已为 252/252 个当前 state collection 建立机器状态与源码使用证据；这只关闭未分类缺口。
188 个 review-required 与 1 个 quarantine 仍须按 owner 批次确认、归档或迁移，不能因 CI 通过晋升。

### 当前兼容约束

- v1–v14 的 `schema_migrations.checksum` 保持既有 `version:name` 算法，禁止批量重算或更新现场 ledger。
- v1–v14 的源码内容必须匹配仓库冻结 SHA-256；任何修正都新建 v15+ migration。
- v15+ 的 ledger checksum 使用注册表内容 SHA-256，并继续要求事务、空库/升级/重跑/失败测试。
- schema head 只能从注册表导出；运行时、部署、readiness、报告和测试不得另建数字常量。
