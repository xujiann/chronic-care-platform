# 真实 PostgreSQL 目标账本下的 checkpoint 验证

- 状态：Accepted
- 决策：ADR-OPS-047；2026-09-23 用户批准独立 ADR 准入实施。
- 任务：GOV-021 / OPS-047；基线 `origin/main@7be0041e`。

## Problem and options

ADR-OPS-046 只在合成目标驱动下证明独立 SQLite checkpoint 的状态机；现有真实 PostgreSQL 专项只证明主存储、身份和重放合同。两者的组合、目标提交后进度未写的恢复窗口，尚无真实数据库证据。

1. 仅接受合成目标测试：成本低，但保留组合缺口。
2. 复用现有隔离真实 PostgreSQL fixture、正式驱动和独立 SQLite checkpoint（采用）：不改变运行时或生产 schema，验证实际目标账本读回与故障恢复。
3. 在 PostgreSQL 增加生产 checkpoint 表：需要新 migration、多实例与部署方案，不属于本切片。

## Decision and scope

T00 单写新的真实 PG 专项用例及专用 runner 入口，复用现有随机测试库、显式源/目标身份、正式 DDL 和清理钩子。测试空目标初始化、目标提交前拒绝、目标提交后 checkpoint 失败窗口重放、进度重启读取、重复推进、错误目标身份及非空目标初始化拒绝。runner 必须零跳过并在现有 PostgreSQL CI 作业内串行执行；无本地真实 PG 时仅报告环境跳过，不将其算作真实证据。

不更改 `src/`、生产 DDL、API、worker、自动 relay、业务请求、生产配置或数据；不宣称跨主机/多实例、TLS、容量、灾备、独立信任锚或现场审批。生产保持 NO-GO。

## Risk, recovery and verification

隔离 fixture 只清理由本次成功创建、身份重新核实的随机库和专用合成文件；不得连接真实业务库。若测试或 CI 失败，停止本切片并保留失败证据，修复后重新独审及冻结门禁；回滚只撤销测试、runner、治理登记，不删除任何生产或历史事实。验收需独立审查、冻结提交的全部规定门禁、PR 真实 PG 零跳过结果；合并及上线另按授权，仓库通过不改变六域 NO-GO。
