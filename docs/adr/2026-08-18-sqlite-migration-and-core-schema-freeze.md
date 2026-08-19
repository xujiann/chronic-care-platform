# ADR：SQLite migration 与核心 Schema 冻结

- 状态：Accepted
- 日期：2026-08-18
- Owner：T00 / 数据治理
- 影响范围：SQLite migration、schema version、核心表、部署检查

## Problem

主线已有事务化 migration v1–v14，但定义内嵌 `server.js`，checksum 只覆盖 version/name，且公开 `STORAGE_SCHEMA_VERSION` 仍为 11。历史 migration 如果被修改无法可靠检测，schema 文档、运行时和部署检查可能分叉。

## Options

1. 继续内嵌 migration 并手工同步版本。
2. 冻结 v1–v14，从 v15 起使用独立、连续、内容指纹化 migration 注册表，并建立 schema 基线门禁。
3. 删除 SQLite migration，立即只支持 PostgreSQL。

## Advantages

方案 2 保留现有兼容和本地开发能力，又能阻止历史漂移；独立 migration 更容易测试、review 和生成 schema 指纹。

## Disadvantages

需要先核对 v1–v14 内容、修复 v14/v11 偏差，并维护迁移 runner 与测试。迁移期间存在新旧注册方式共存窗口。

## Migration cost

中。主要是提取注册表、建立内容摘要/fixture、更新版本消费者和补空库/升级/失败测试；不要求立即迁移业务数据到 PostgreSQL。

## Risk

错误重算历史 checksum 会拒绝已有数据库；直接修改旧版本会让现场库不可预测；版本常量修复若没有兼容测试可能影响 readiness 判断。

## Recommendation

冻结 v1–v14 语义；v15 起采用独立 migration、内容 SHA-256、事务和可执行校验。核心身份、记录、业务镜像、会话和 outbox 表不得由功能任务随意改列/索引/FK。任何改变都需 migration、owner、测试和必要 ADR。

## Implementation

2026-08-20 的 T00 切片已将 v1–v14 提取到独立注册表，并以固定 SHA-256 校验历史定义。为避免拒绝既有数据库，历史 ledger checksum 不重算，仍验证原 `version:name` 摘要；v15+ 才把内容 SHA-256 写入 ledger。公开 schema head、部署检查、生产 readiness 和发布报告统一消费注册表 v14。空库、v11 升级、重跑、历史漂移、未来 v15 checksum、失败回滚和 schema fingerprint 已建立回归测试。

该实施没有修改任何数据库文件、业务表数据、API 形状、鉴权或审计语义。生产环境升级与 PostgreSQL 切换仍需独立现场证据。
