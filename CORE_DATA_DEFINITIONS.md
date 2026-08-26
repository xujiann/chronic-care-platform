# 核心数据不可变定义 v1

> “不可变”指概念身份、主键语义和 owner 不能被功能任务随意重新创造；允许通过版本化、兼容字段扩展。机器所有权仍以 `config/domain-data-ownership.json` 为准。

| 核心概念 | 稳定含义 | 身份/关键关系 | 默认 owner |
|---|---|---|---|
| Resident | 被提供健康服务的自然人主体 | residentId；映射 PersonIndex | citizen-chronic |
| PersonIndex | 跨来源居民身份主索引 | 不暴露原始证件组合；可合并/溯源 | identity-security |
| Account | 可认证的用户/家庭/机构账户 | accountId；成员关系指向 Resident | identity-security |
| Session | 已认证主体的有期限、可撤销上下文 | sessionId；绑定 Account/actor | identity-security |
| Institution | 医疗、行政、医保或服务机构 | institution/org code；区域关系 | platform-governance |
| Practitioner | 具有执业身份的医护/服务人员 | practitioner/doctor/nurse id；隶属机构 | care-coordination |
| HealthRecord | Resident 的临床/健康事实记录 | recordId + residentId + version + provenance | citizen-chronic |
| DiseaseDefinition | 疾病/专病语义和编码 | code system + code + version | platform-governance |
| ServiceOrder | 挂号、转诊、护理、陪诊等履约请求 | orderId + residentId + owner + state version | care-coordination |
| ClaimPayment | 医保/支付结算聚合 | aggregate/claim/payment id + version | insurance-payment |
| IntegrationContract | 外部系统交换的版本化契约 | contractId + version + source/target | integration |
| AuditEvent | 对安全、数据和业务关键动作的不可抵赖记录 | eventId + actor + target + time + chain/evidence | identity-security/platform-governance |

## 不可变约束

- 不创建 `Citizen`、`Patient`、`Person` 等与 Resident 平行且无映射的新核心主体。
- 不用手机号、证件号或姓名直接充当跨系统主键。
- 不让 `shared`、`state-data`、页面或报告脚本成为核心数据 owner。
- 不复制记录后改变 owner 来绕过跨域契约。
- 登记 legacy 集合 owner 只冻结责任边界，不生成核心概念、版本化写合同或生产事实源；显式
  `productionWriteAllowed=false` 只能通过独立 ADR、migration、核对、回滚和现场证据演进。
- 新字段必须说明来源、分类、保留、访问范围和版本兼容。
- 概念合并、拆分、主键变化或 owner 变化必须有 ADR、迁移、核对和回滚。

## 新需求检查

1. 是否可扩展上表既有概念？
2. 是否已有 owner 集合或写契约？
3. 是否需要新的跨域读/写契约，而不是新建副本？
4. 是否涉及敏感字段、最小必要和保留期？
5. 是否有旧 ID 映射、数据迁移和兼容窗口？

## State collection 治理投影

集合治理 CLI 只对表中英文概念名做保守的精确单复数匹配，作为 closed-world review 证据；当前
匹配 `accounts→Account`、`residents→Resident`、`integrationContracts→IntegrationContract`、
`serviceOrders→ServiceOrder`。匹配不创建 owner、不证明语义等价，也不授权生产晋升；未匹配集合
更不能据名称猜测概念。概念/主键/owner 变化仍必须遵守本文件的 ADR、migration、核对和回滚规则。

## 对象存储提案的 closed-world 边界

Proposed `OBJ-ADR-002` 不创建新的核心主体。安全附件元数据继续被视为既有 `HealthRecord` 的受限对象
引用/保留投影，对象存储命令属于既有 `IntegrationContract` 的执行记录，安全与生命周期操作继续产生
既有 `AuditEvent`；不得另造 Resident、Record、Institution 或 Audit 身份体系。

T08 integration 作为 data owner 只是建议，T00 只是建议的 technical storage/worker owner。未由人类确认
并更新机器 owner 合同前，不能把 `secureAttachments` 或未来结构化表登记为核心 owner，也不能用 route
owner 推断。附件 ID、对象版本、命令 ID、resident/record/institution 关系、分类、保留和 legal-hold 语义
如需冻结，必须在 Accepted ADR、v17 migration、回填核对和兼容/回滚方案中明确。
