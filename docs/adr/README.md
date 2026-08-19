# 架构决策记录（ADR）

## 状态

| 状态 | 含义 | 可实施 |
|---|---|---|
| Proposed | 正在评审 | 否 |
| Accepted | 已批准，实施遵循决策 | 是 |
| Rejected | 不采用 | 否 |
| Superseded | 被新 ADR 替代 | 按新 ADR |
| Deprecated | 不再用于新工作 | 否 |

自 2026-08-18 起，新建 ADR 必须包含 problem、options、advantages、disadvantages、migration cost、risk、recommendation。此前已接受的两份 ADR 保留原格式，只追加事实性的实施状态；改变决策时新增 ADR 并 supersede。

## 台账

| 决策 | 状态 | 范围 |
|---|---|---|
| [main 作为唯一集成主干](../ADR-main唯一集成主干-2026-08-03.md) | Accepted | 分支、PR、CI 和发布基线 |
| [PR 所有权门禁跟随目标集成分支](./2026-08-19-pr-ownership-gate-target-base.md) | Accepted | process PR 的比较基线与所有权校验 |
| [模块化单体与微服务提取标准](../ADR-模块化单体与微服务提取标准-2026-08-03.md) | Accepted | 模块边界和服务提取 |
| [SQLite migration 与核心 schema 冻结](./2026-08-18-sqlite-migration-and-core-schema-freeze.md) | Accepted | 数据库演进治理；实施未完成 |
| [核心数据 closed-world 定义](./2026-08-18-core-data-closed-world.md) | Accepted | 核心概念不可随意平行创建 |
| [临床专科五个可治理子域](./2026-08-18-clinical-five-governed-subdomains.md) | Accepted | 急救、血液、影像、体检、质量安全的开发边界 |
| [静态内容安全边界](./2026-08-18-static-content-security-boundary.md) | Proposed | 发布 allowlist、数据和缓存隔离 |

模板见 [ADR_TEMPLATE.md](./ADR_TEMPLATE.md)。
