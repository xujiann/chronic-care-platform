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

本轮完成①–④的主线重验；⑤–⑧需要 Proposed ADR 接受后分步实施。
