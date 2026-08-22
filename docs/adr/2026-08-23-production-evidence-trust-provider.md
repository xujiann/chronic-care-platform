# ADR：严格生产预检采用可部署的签名证据 Trust Provider

- 状态：Accepted
- 日期：2026-08-23
- Owner：T00
- 影响范围：production preflight、生产证据信任适配器、部署包、环境合同与发布就绪 CI

## Problem

`scripts/production-preflight.js` 已把外部信任判断抽象为 `externalTrustVerifier`，并要求 registry
attestation 与五份生产证据都绑定当前 release ID 和 artifact digest。但是该 verifier 只能由测试代码
注入；实际 CLI 没有从生产配置装配 provider。即使外部证据、签名和现场结果全部齐备，
`npm run production:preflight:strict` 仍固定返回 `external trust verifier is not configured`。

结构校验器 `production-release-evidence-readiness` 可以判断字段、角色和受控引用，但明确不能证明
签名身份或外部真实性。不能把结构正确的 synthetic JSON 提升为生产信任，也不能让仓库生成私钥、
审批决定或现场证据。需要补齐既有注入点的可部署实现，同时保持默认 `NO-GO`，且不改变 Runtime
Go/No-Go 的生产授权权威、公开 API 或数据库。

## Options

1. **保持仅测试注入。** 继续要求部署方在仓库外包装 Node 调用并传入函数。
2. **受控文件型 Ed25519 provider。** CLI 从服务账号控制的绝对路径读取签名 envelope 与信任锚，
   对信任锚文件做独立 SHA-256 pin，校验 key 生命周期、撤销、签名、角色独立性、时间窗以及
   release/artifact/evidence/registry 精确绑定。
3. **直接接入单一 KMS/Vault 厂商 API。** preflight 在线调用指定产品完成验签和身份查询。
4. **让结构 evidence validator 直接返回可信。** 五份文档结构通过即视为 external trust 已验证。

## Advantages

- **方案 1：** 仓库改动最少。
- **方案 2：** 补齐现有 CLI 组合缺口；不引入 npm 依赖或厂商绑定；公钥、签名 envelope 与证据正文
  分离；可在断网切换窗口重验；generic signed-envelope 函数可被后续 action evidence 复用。
- **方案 3：** 撤销和密钥轮换可由集中系统实时管理。
- **方案 4：** 实现最简单，现有测试数据无需改变。

## Disadvantages

- **方案 1：** 正式 CLI 永远不能通过，生产运行手册与代码行为不一致。
- **方案 2：** 运维方必须原子发布 trust-anchor snapshot 与 envelope，并独立注入 anchor bundle digest；
  文件权限、时钟和轮换流程需要现场治理。
- **方案 3：** 引入网络可用性、厂商 SDK、凭据、超时和供应链依赖，不适合作为本次最小修复。
- **方案 4：** 任意人都可构造满足 schema 的 JSON，违反签名证据和独立审批边界。

## Migration cost

推荐方案 2，迁移成本为中：

- 新增 T00 `production-evidence-trust-provider`，复用 `technical-evidence` 的稳定序列化和摘要语义；
- `production-preflight` 保留显式测试注入优先级，未注入时才从现有环境配置装配 provider；
- 部署方在仓库外准备 trust-anchor JSON 与 signed-envelope JSON，并通过基础设施配置注入绝对路径及
  anchor 文件 SHA-256；私钥始终留在外部签名系统；
- deployment package 固化 provider 模块、严格 preflight 入口和三个非秘密配置变量；
- 不需要 API、数据库、migration、业务数据、Runtime center 或发布拓扑迁移。

回滚只需回退本实现提交；回退后 strict CLI 会重新固定 NO-GO，不会误放行。外部 trust 文件无需写回
仓库或转换为业务状态。

## Risk

- 信任锚文件若能与 pin 同时被同一未授权主体改写，攻击者可替换公钥；digest 必须由独立配置/密钥
  管理面注入，不能与文件放在同一可写来源。
- 陈旧 envelope、未来时间、超长有效期、撤销 key、重复 signer、同一角色重复签名或 release/artifact
  漂移必须失败关闭。
- provider 文件可能包含原始证据、患者数据或秘密；模块使用 metadata-only 约束、1 MiB 上限、普通
  非符号链接文件和字段 allowlist，报告只输出摘要与稳定 code。
- 错误正文或绝对路径若进入 CLI/报告会暴露基础设施信息；顶层错误统一为稳定脱敏结果。
- provider 验证通过只是 strict preflight 的一个必要条件，不能跳过 audit、worker、live probe、备份、
  registry、现场证据或最终人类授权。

## Recommendation

采用方案 2，并冻结以下合同：

1. trust bundle schema 为 `platform-governance.evidence-trust-anchors.v1`，每个 key 必须声明唯一 key ID、
   signer ID、角色、Ed25519、公钥 digest、状态和有效期；`revoked|retired` 不可验签。
2. envelope schema 为 `platform-governance.signed-evidence-envelope.v1`，production purpose 固定为
   `production-release-evidence-verification`，record schema 固定为
   `platform-governance.production-evidence-trust-decision.v1`。
3. production decision 必须由不同 signer/key 分别以 `release-verifier`、`security-verifier` 签署，
   并绑定 release ID、source commit、artifact digest、五份 evidence records digest、evidence
   fingerprint、registry entry digest 及 registry attestation ref/digest。
4. 签名输入是稳定序列化的 `{ envelope: { schema, purpose, record }, signer: { keyId, signerId, role } }`；
   签名编码为 base64url。默认决策有效期最多 24 小时，未来时钟容差最多 5 分钟。
5. CLI 仅接受绝对路径、普通非 symlink 且不超过 1 MiB 的 JSON；anchor bundle 原始字节摘要必须与
   `PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256` 精确一致。
6. 缺配置、文件、pin、签名、角色、有效期、撤销或上下文漂移全部返回稳定脱敏 code 并保持 NO-GO；
   禁止 fallback 到结构 validator、模拟成功或测试 fixture。
7. generic `verifySignedEnvelope`、subject 与 signature-payload 构造函数作为 T00 共享治理端口，后续
   action evidence 可复用；不得复制第二套 Ed25519 语义。
8. 本 ADR 只修复既有 strict preflight 的 provider 装配，不改变 Runtime Go/No-Go 权威、公开 API、
   鉴权、数据库或生产最终授权。

本 ADR 已由 T00 于 2026-08-23 接受并授权上述最小实现。真实 trust anchor、签名 envelope、外部证据、
密钥轮换、现场权限和最终切换审批继续由仓库外提供，默认 `productionReady=false`。
