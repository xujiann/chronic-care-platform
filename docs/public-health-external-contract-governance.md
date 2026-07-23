# 公共卫生外部接口契约版本治理

## 范围与边界

`public-health-external-contract-governance-service.js` 为传染病直报、免疫规划、妇幼、老年健康、慢病、公卫随访、健康教育和家庭医生八领域建立统一的契约版本台账。

治理台账解决“哪个版本何时允许使用、旧版何时必须退出、审批材料是否可信”的问题，不替代适配器代码、生产部署或现场联调。签名审批通过后 `productionReady` 仍保持 `false`；新版本只有在 T08 运行时实现、T00 公共接线、生产发布和现场证据全部验证后才能实际启用。

## 基线与版本规则

八领域基线从 `EXTERNAL_ADAPTER_PROFILES` 读取，每个领域默认只有当前 `-v1` 契约，并绑定：

- `public-health-external-dispatch/v1` 请求 Schema；
- `public-health-external-receipt/v1` 回执 Schema；
- 领域标识和适配器标识。

变更只能在同一契约族内严格递增一个版本，例如 `family-doctor-fulfillment-v1` 到 `family-doctor-fulfillment-v2`。禁止跳过版本、跨契约族替换或让请求、回执 Schema 与契约版本不一致。

## 签名审批凭据

每次下一版本审批必须由服务端调用 `signPublicHealthExternalContractAttestation()` 生成，签名载荷包含：

- 领域、原契约、目标契约、请求和回执 Schema；
- `additive` 或 `breaking` 变更类型；
- 字段字典、请求样例、回执样例和运行时发布物的 SHA-256 摘要；
- 生产方和消费方组织标识、角色、审批人哈希与审批时间；
- 至少三项证据引用；
- 生效时间、旧版废止时间、凭据签发/失效时间和 nonce；
- 签名密钥 `keyId`、状态和审批状态。

生产方角色必须是 `producer-contract-owner`，消费方角色必须是 `consumer-contract-owner`。两方组织和审批人哈希必须相互独立。审批人姓名、证件号等原始身份信息不得进入凭据、台账或报告。

所有信任字段都进入 HMAC 签名载荷。签名后修改版本、Schema、变更类型、摘要、审批、时间窗、状态、nonce 或 `keyId` 都会失败。未知、过期或吊销密钥签发的凭据同样拒绝。

## 生效状态

`buildPublicHealthExternalContractGovernance()` 按服务端时间计算：

- `scheduled`：尚未到 `effectiveAt`，仅旧版允许使用；
- `active`：新版本已经生效；
- `deprecated`：新版本生效至 `sunsetAt` 之间，旧版仍兼容但必须迁移；
- `retired`：达到 `sunsetAt` 后，旧版不再允许。

同一领域同时出现多条已批准迁移时，不自动选择任何一条，而是产生 P0 `contract-transition-conflict`，保持原版本并等待人工治理。无效签名或材料产生 P0 `contract-attestation-invalid`。

`authorizePublicHealthExternalContract()` 同时校验领域、契约、请求 Schema 和回执 Schema：

- 当前活动版本返回 `verified`；
- 兼容期旧版返回 `contract-version-deprecated`；
- 计划中、已废止、未知或 Schema 不匹配均拒绝。

## 运维巡检

`buildPublicHealthExternalOperationsBoard()` 可接收契约治理快照并逐任务对账：

- P0 `contract-governance-mismatch`：任务使用未知、计划中、已废止或 Schema 不匹配的契约；
- P1 `contract-version-deprecated`：任务仍在使用兼容期旧版。

兼容期告警必须包含签名废止日期，并在 `sunsetAt` 前完成生产方、消费方和历史待投递任务迁移。达到废止时间后，旧版任务不得继续领取或通过重试绕过门禁。

## T00 集成事项

1. 契约审批接口只能由服务端治理角色调用；客户端不得提交 `status=approved` 后直接生效。
2. 签名密钥由生产密钥服务注入，审批凭据和治理报告不得包含密钥正文。
3. 持久化审批凭据时按领域和 `fromContract` 保证唯一性；冲突不得以“最后写入覆盖”解决。
4. 所有时间判断使用服务端时间；不得使用客户端自报生效时间作为校验时钟。
5. 将治理快照传给 operations board，并为 P0/P1 风险接入告警和迁移工单。
6. 新版本生效前校验 `runtimeReleaseDigest` 对应的 T08/T00 发布物已经部署，并完成字段字典、双向样例、回滚和现场联合测试。
7. 废止前处理所有旧版 pending、retry-scheduled、dead-letter successor 和半开探针任务，避免到期后形成无法投递的积压。

T00 继续负责 `server.js`、`package.json`、`portal.css`、`README.md`、公共发布总表、生产配置和统一持久化。本线程不修改这些公共文件。

## 验收标准

- 八领域均存在唯一基线契约和请求/回执 Schema。
- 下一版本严格递增，生产/消费双边审批独立且全部字段进入签名。
- 字段字典、双向样例和运行时发布物摘要不可在签名后替换。
- 计划、生效、兼容和废止边界由服务端时间稳定复现。
- 冲突审批、伪造审批、跳版、Schema 漂移、过期和吊销凭据全部失败关闭。
- 运维巡检在兼容期产生 P1、废止后产生 P0。
- 报告不包含密钥和审批人原始身份，并始终保持 `productionReady=false`。
