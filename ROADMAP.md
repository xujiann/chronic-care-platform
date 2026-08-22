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
| 3 | Schema migration 与指纹 | v1–v14 冻结，v15 append-only audit source、v16 慢病随访 durable outbox 已追加并覆盖空库/v11 升级/重跑/回滚门禁 / P1 | 后续 v17+ 按冻结规则追加，生产迁移仍需备份、核对和现场证据 |
| 4 | 标准 build/lint/typecheck/unit/integration/smoke 入口 | 已合入 `main@fc42833`（PR #130）；内部边界覆盖候选另锁定 identity/audit/object storage/API governance 四组真实基线 / P1 | 保持 test:all 与原 server.js 85/85/55 语义；覆盖阈值只升不降，报告只留临时目录；逐步扩大 lint/typecheck 基线并治理测试时长 |
| 5 | 移除组合根循环依赖 | 已合入 `main@21d8f3c`（PR #132）；PR/main CI 与 Pages 验证通过 / P1 | ARC-002 已关闭；后续组合根瘦身归 ARC-001，不扩大本切片 |
| 6 | 生产身份/SMS、PostgreSQL shadow、连续审计投递 | 身份/SMS 与 PG shadow 已存在；连续审计已完成 v15 同事务 append-only source、最小投影、cursor/source binding 和 checkpoint v3，部署/preflight 默认精确合同 / P1 | 可信签名 receipt、外部单调锚、真实 provider/PG/SIEM/WORM/KMS、恢复演练和现场证据继续 NO-GO；不做 PG 主切换 |
| 6A | OTP/锁定共享状态 | 已纳入生产身份 ADR；#131 候选已完成 P1 代码增量，待最新 PR/main CI | 保持 SQLite 单主机、PostgreSQL 多实例及原子消费/限流/锁定契约；真实 PG 由 CI 和现场重跑 |
| 7 | 运行时上下文瘦身 | 候选 / P1 | 按领域子端口，逐块迁移，不重写 server |
| 7A | 临床五个可治理子域 | 治理切片完成，急救/血液/影像/体检首用例已迁移；operations dashboard 与 command 已由 T00 移交 T02 / P1 | Accepted ADR；保持协议兼容，继续按五子域逐用例迁移并禁止 operations 回流 T06 |
| 7B | 健康驾驶舱版本化指标 | 首个 `population-service-visits.v1` 合同已建立 / P1 | 由 T03 确认来源版本与签名证据、由 T00 注入服务端 region scope；其余指标按 owner 逐项接入 |
| 7C | 生产 API 机器目录 | v2 已把源码观察与行为证据分层；SMS callback 是首个合同 pilot，594 项全部 NO-GO / P1 | T01–T09 逐 owner 复核 7 个运行时策略、13 个自定义鉴权和 333 个缺行为证明的写接口；233 个未观察到标记项优先排查，不得用源码标记或猜测 owner 替代行为测试 |
| 8 | JSON/SQLite state collection 治理 | DATA-003 首切片完成：252/252 状态完整，188 review-required、1 quarantined / P1 | 按 DATA-008 分 owner 确认、归档或 migration 晋升；process owner 证据不得自动变成 data owner |
| 9 | 前端可信渲染与 CSP | Accepted ADR；37 个脚本和 21 个静态样式风险已外移；血液主工作台完成首个可信 DOM/text 试点，Inventory v2 现锁定 871 个 DOM HTML、69 个动态 URL、45 个动态样式风险且禁止增加/替换 / P1 | 沿用页面 Owner 小批次迁移和恶意输入回归；真实托管头验证与独立安全评估后才移除兼容 `unsafe-inline` 并强制严格 CSP |
| 10 | CI/worker/部署依赖治理 | CI 风险域拆分已合入并经 main 验证；Action 完整 SHA 固定已形成 T00 候选，worker 仍候选 / P2 | 不降低 required checks；合入后持续按官方 tag 升级并核验 commit SHA，继续评审 worker 观测契约 |
| 11 | 居民小程序制品凭证扫描消除哈希误报 | 已完成 / P2 | JSON 仅扫描语义字符串值并精确跳过两个字段中的合法 SHA-256；非 JSON 保留文本扫描；真实演示凭证与伪造摘要负向测试已建立 |
| 12 | 对象存储结构化元数据与耐久命令轨道 | Proposed OBJ-ADR-002；仅完成机器 decision/action register、v17 冲突预留和 CI fail-closed 治理 / P1 | 人类确认 T08 data owner 与 v1/v2 兼容策略，ADR 转 Accepted 后才可按 v17→全量回填/冻结→异步 API→fenced worker→无损分页→持久 reconcile→readiness 的独立切片实施；真实 provider/KMS/WORM/扫描/容量/备份/现场证据继续 NO-GO |

## 每日任务模板

- 目标与依据；
- 范围和非目标；
- process owner / 保护路径；
- 相关地图、ADR、调用方和数据；
- 方案、代价、风险、迁移和回滚；
- 测试计划与完成条件。

输出 PLAN 后停止编码，等待方向审批。

## 2026-08-22 慢病随访 durable dispatch

- 已形成候选：SQLite v16 事务 enqueue、租约 fencing、有界退避、死信、digest-only replay、worker CLI、
  preflight/readiness、部署包与 systemd 合同。
- 下一现场阶段：绑定真实 endpoint/secret provider/activation trust files 与外部签名 decision，核验供应方幂等与签名回执，启用服务
  和告警并完成故障/恢复/死信 replay/回滚演练。
- PostgreSQL 多节点主存储需另立 ADR/migration；在外部证据完成前保持 production NO-GO。

## 2026-08-23 对象存储 ADR 前置治理

- 基于 `origin/main@0796886` 建立 Proposed ADR；不改变 schema head v16、API、runtime 或数据。
- 机器台账明确建议 T08 data owner、T00 technical owner，并把 owner/兼容策略标为两项未决人类决策。
- governance-api 执行 fail-closed 检查：ADR/台账漂移、v17 被占用、owner 被推断、行动提前或任何
  migration/runtime/API/promotion 标志误启用均失败。
- 下一步不是直接编码；先完成人类决策和 ADR Acceptance，再按每个可回滚阶段独立审批。
