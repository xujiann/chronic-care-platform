# 工程治理路线图

> 更新：2026-08-21。队列不是实施授权；只有 Accepted ADR/明确 owner 审批的范围可进入实现。

## 已建立基线

- T00–T09 主线与所有权制度。
- 六张 `main@b1e4898` AS-IS 地图和全仓体检。
- A/B/C/D 模块分级、标准接口和重构安全网。
- Schema 台账、数据库标准、核心数据定义。
- ADR 模板、台账和每日 PLAN 审批循环。

## 决策与实施队列

| 优先级 | 事项 | 状态 | 进入实现条件 |
|---:|---|---|---|
| 0 | T00 治理基线迁移 | 已合入 `main@58e05e5` | 按每日循环持续维护 |
| 1 | 静态内容 allowlist 与快照隔离 | 已合入 `main@6c18221`；PR/main CI 与 Pages 验证通过 | 持续执行清单审查、负向测试与缓存版本治理 |
| 2 | 审计链失败语义 | Accepted ADR；#131 候选已实施，待最新 PR/main CI / P0 | 持续运行严格验证、全量写入拒绝和外部历史链 preflight；真实历史链迁移继续 NO-GO |
| 3 | Schema v14/v11 一致与 migration 指纹 | 已合入 `main@026762f`（PR #129）/ P1 | 后续 v15+ 按冻结规则追加，并保持空库/升级/重跑/失败回滚门禁 |
| 4 | 标准 build/lint/typecheck/unit/integration/smoke 入口 | 已合入 `main@fc42833`（PR #130）；PR/main CI 与 Pages 验证通过 / P1 | 保持 test:all 语义；逐步扩大 lint/typecheck 基线并治理测试时长 |
| 5 | 移除组合根循环依赖 | 已合入 `main@21d8f3c`（PR #132）；PR/main CI 与 Pages 验证通过 / P1 | ARC-002 已关闭；后续组合根瘦身归 ARC-001，不扩大本切片 |
| 6 | 生产身份/SMS、PostgreSQL shadow、连续审计投递 | Accepted ADR；#131 候选已完成 P1 代码增量，待最新 PR/main CI | 真实 provider/PG/SIEM/WORM 联调与现场证据继续 NO-GO |
| 6A | OTP/锁定共享状态 | 已纳入生产身份 ADR；#131 候选已完成 P1 代码增量，待最新 PR/main CI | 保持 SQLite 单主机、PostgreSQL 多实例及原子消费/限流/锁定契约；真实 PG 由 CI 和现场重跑 |
| 7 | 运行时上下文瘦身 | 候选 / P1 | 按领域子端口，逐块迁移，不重写 server |
| 7A | 临床五个可治理子域 | 治理切片完成，急救/血液/影像/体检首用例已迁移；operations dashboard 已由 T00 移交 T02 / P1 | Accepted ADR；保持协议兼容，按子域逐用例迁移；operations command 另行移交 |
| 7B | 健康驾驶舱版本化指标 | 首个 `population-service-visits.v1` 合同已建立 / P1 | 由 T03 确认来源版本与签名证据、由 T00 注入服务端 region scope；其余指标按 owner 逐项接入 |
| 8 | JSON 169 个遗留集合治理 | 候选 / P1 | owner 分类、使用证据、晋升/归档/迁移批次 |
| 9 | 前端可信渲染与 CSP | 待 ADR / P1 | sink 清单、兼容策略、逐页 E2E/负向测试 |
| 10 | CI/worker/部署依赖治理 | CI 风险域拆分已合入并经 main 验证，供应链/worker 仍候选 / P2 | 不降低 required checks；继续评审 Action 固定和 worker 观测契约 |
| 11 | 居民小程序制品凭证扫描消除哈希误报 | 已完成 / P2 | JSON 仅扫描语义字符串值并精确跳过两个字段中的合法 SHA-256；非 JSON 保留文本扫描；真实演示凭证与伪造摘要负向测试已建立 |

## 每日任务模板

- 目标与依据；
- 范围和非目标；
- process owner / 保护路径；
- 相关地图、ADR、调用方和数据；
- 方案、代价、风险、迁移和回滚；
- 测试计划与完成条件。

输出 PLAN 后停止编码，等待方向审批。
