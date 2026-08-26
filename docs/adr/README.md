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
| [仓库文档与跟踪 PDF 采用闭集治理](./2026-08-23-repository-documentation-and-artifact-governance.md) | Accepted | 当前工作流、Markdown 分类、历史快照冻结与 PDF 来源/摘要治理 |
| [综合 CI 采用 15 分钟有界时间预算](./2026-08-19-ci-comprehensive-test-time-budget.md) | Superseded | 综合 test job 的超时预算与回归约束 |
| [CI 按风险域拆分并保留聚合必需检查](./2026-08-19-ci-risk-domain-job-split.md) | Accepted | 治理/API、浏览器 E2E、发布就绪与 required test 聚合 |
| [Playwright E2E 采用统一浏览器策略与独占测试服务](./2026-08-23-playwright-e2e-isolation-and-browser-policy.md) | Accepted | Playwright Chromium、在线 Service Worker 隔离、PWA 专项、动态端口与当前 55 项套件分区 |
| [模块化单体与微服务提取标准](../ADR-模块化单体与微服务提取标准-2026-08-03.md) | Accepted | 模块边界和服务提取 |
| [SQLite migration 与核心 schema 冻结](./2026-08-18-sqlite-migration-and-core-schema-freeze.md) | Accepted | 已合入 `main@026762f`（PR #129）；v1–v14 冻结，v15+ 内容指纹化 |
| [核心数据 closed-world 定义](./2026-08-18-core-data-closed-world.md) | Accepted | 核心概念不可随意平行创建 |
| [临床专科五个可治理子域](./2026-08-18-clinical-five-governed-subdomains.md) | Accepted | 急救、血液、影像、体检、质量安全的开发边界 |
| [9 个一级开发域加 5 个临床子域的开发组织](./2026-08-25-nine-plus-five-development-organization.md) | Accepted | T00 集成治理、T01–T09 一级域、T06 五个嵌套子域和统一集成边界 |
| [静态内容安全边界](./2026-08-18-static-content-security-boundary.md) | Accepted | 已合入 `main@6c18221`；发布 allowlist、数据和缓存隔离 |
| [浏览器安全响应头与 CSP 分批强制](./2026-08-22-browser-security-headers-and-csp-migration.md) | Accepted | 集中响应头端口、兼容 CSP、严格 Report-Only 目标、资产风险基线与生产 NO-GO |
| [浏览器动态 URL 统一进入 Safe URL Port](./2026-08-23-browser-safe-url-policy.md) | Accepted | internal/official/object-storage/tel/blob 能力、稳定错误、exact-Origin 与分批 URL sink 迁移 |
| [审计链失败语义与兼容迁移](./2026-08-19-audit-chain-failure-semantics.md) | Accepted | v2 严格验证、服务端管理审计字段、失败传播和受控旧链迁移 |
| [切换告警运行时采用显式控制面 Provider 注入](./2026-08-20-pilot-cutover-alert-provider-injection.md) | Accepted | 已合入 `main@21d8f3c`（PR #132）；显式 provider、默认拒绝投影与反向依赖守卫 |
| [严格生产预检采用可部署的签名证据 Trust Provider](./2026-08-23-production-evidence-trust-provider.md) | Accepted | 既有 externalTrustVerifier 的受控文件装配、Ed25519 双角色验签、release/artifact/evidence/registry 绑定与默认 NO-GO |
| [生产身份与短信适配器信任边界](./2026-08-21-production-identity-sms-trust-boundary.md) | Accepted | JWKS/JWT、脱敏 transport、SMS 凭据/幂等/重试/健康及共享 OTP/锁定状态 |
| [生产 API 目录从现有授权清单派生并默认拒绝](./2026-08-22-production-api-catalog.md) | Accepted | method/path/owner/auth/scope/idempotency/生产状态机器目录与 CI 门禁 |
| [JSON/SQLite State Collection 的 Owner 与隔离治理](./2026-08-22-state-collection-ownership-and-quarantine.md) | Accepted | 252/252 集合状态、源码使用证据、owner/共享边界、隔离和生产晋升失败关闭 |
| [API 幂等行为证据必须显式登记且默认拒绝](./2026-08-22-api-idempotency-behavior-evidence.md) | Accepted | source marker 与行为证明分层、SMS callback pilot、custom external auth 与生产 NO-GO |
| [Custom API 认证必须绑定控制流与可执行负向测试证据](./2026-08-23-api-custom-authentication-evidence.md) | Accepted | 认证机制、credential source、required/optional/none、replay/CSRF、scope、负向测试与生产 NO-GO |
| [PostgreSQL shadow 合同强化](./2026-08-21-postgresql-shadow-contract-hardening.md) | Accepted | schema 隔离、健康探针、batch/digest/version/tombstone 冲突 |
| [PostgreSQL 受控切换评估与部署闭包边界](./2026-08-24-postgresql-transition-readiness-boundary.md) | Accepted | metadata-only 七门评估、迁移/演练/worker 部署闭包、secret 引用与固定生产 NO-GO |
| [Solution A 容器部署采用安全默认值与不可变镜像](./2026-08-22-solution-a-secure-container-defaults.md) | Accepted | 容器镜像、Orthanc 认证、DICOM 绑定和生产失败关闭门禁 |
| [连续审计投递与耐久 checkpoint](./2026-08-21-continuous-audit-delivery.md) | Accepted | SIEM/WORM rehearsal、checkpoint v2、部署信任合同 A；append-only source/可信 receipt/外部 anchor 前生产 NO-GO |
| [连续审计采用 append-only source v2](./2026-08-22-append-only-audit-source-v2.md) | Accepted | SQLite v15 事务内审计来源、稳定 cursor、最小投影与 checkpoint v3；外部信任仍 NO-GO |
| [对象存储网关采用版本化响应信任合同 v1](./2026-08-22-object-storage-gateway-trust-v1.md) | Accepted | 独立响应验签、请求/对象绑定、签名 URL Origin/TTL 与严格回执 |
| [对象存储采用结构化元数据与耐久异步命令轨道 v2](./2026-08-23-object-storage-durable-command-and-metadata-v2.md) | Proposed | T08 data owner/T00 technical owner 建议、SQLite v17 候选、异步 API、worker、分页、对账与默认 NO-GO；不授权实施 |
| [Worker 统一脱敏观测合同 v1](./2026-08-23-worker-observability-contract-v1.md) | Accepted | 12 个现有 worker profile 的兼容投影、部署入口漂移门禁与固定生产非授权；不统一业务状态机 |
| [生产切换行动状态由外部可信证据派生](./2026-08-23-production-cutover-action-derived-status-v2.md) | Accepted | definitions-only 台账、release/artifact 绑定、有效期、转换历史、职责分离与 strict preflight |
| [首批生产范围以机器合同冻结](./2026-08-26-production-release-scope-freeze.md) | Accepted | 8 个优先应用及其入口、API、数据引用、worker、外部依赖和证据指纹；部署包/smoke/preflight 绑定并固定 NO-GO |
| [生产 Go/No-Go 采用受信 preflight decision receipt 边界](./2026-08-23-production-go-no-go-trusted-receipt-boundary.md) | Proposed | 关闭本地证据误放行；唯一外部授权权威、签发/验签与耐久防重放仍待人工接受 |
| [区域共享调阅命令以居民授权事实为唯一许可依据](./2026-08-21-regional-sharing-access-command.md) | Accepted | T00 integration、目标 T02、T04 授权事实、幂等/CAS、不可变回执与生产 NO-GO |
| [慢病随访外部 publisher 协议与失败语义](./2026-08-21-chronic-followup-external-publisher-protocol.md) | Accepted | T04 安全外发、activation、幂等回执、范围、审计与持久证据 |
| [慢病随访耐久 outbox 与独立 worker](./2026-08-22-chronic-followup-durable-dispatch-outbox.md) | Accepted | SQLite v16 同事务 enqueue、租约 fencing、重试/死信/replay、请求路径隔离与生产 NO-GO |
| [转诊写操作统一进入单一命令轨道](./2026-08-21-referral-single-command-track.md) | Accepted | 三条兼容 API、T05 owner command、CAS/幂等与资源范围 |
| [科研合规导出职责分离与版本化命令](./2026-08-21-research-export-separation-of-duties.md) | Accepted | 导出申请、独立审核、发布证据、CAS、幂等与历史兼容 |

模板见 [ADR_TEMPLATE.md](./ADR_TEMPLATE.md)。
