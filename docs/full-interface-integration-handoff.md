# T03 医疗与政务接口完整联调交接包

## 结论

本线程已经形成 HIS、EMR、LIS、PACS、医保、电子证照、公卫直报七项 P0 接口的业务落库与异常补偿基础。当前状态是 `handoffReady=true`、`productionReady=false`：代码、样例和自动化测试可交给 T00 接入共享服务，但真实地址、账号、密钥、网络、正式字段版本及现场签字证据仍由外部联调提供。

首个可验收增量是“LIS 阳性检验结果落库并最小化直报公卫平台”，详见 `docs/lis-public-health-first-increment.md`。完整增量在此基础上增加 HIS/EMR/PACS 统一入站落库、医保/证照业务投影和 P0 对账补偿。

## P0 接口清单与责任部门

| P0 | 接口 | 契约 | 平台目标 | 业务责任部门 | 技术责任部门 | 外部责任方 |
|---|---|---|---|---|---|---|
| P0-01 | HIS 就诊 | `his-patient-v1` | `personalRecords` | 医务部门 | 医院信息中心 | 试点医院 HIS 厂商 |
| P0-02 | EMR 摘要 | `emr-summary-v1` | `personalRecords` | 医务部门 | 医院信息中心 | 试点医院 EMR 厂商 |
| P0-03 | LIS 检验 | `lis-report-v1` | `diagnosticReports` | 检验科 | 医疗资源中心 | 试点医院 LIS 厂商 |
| P0-04 | PACS 报告 | `pacs-report-v1` | `diagnosticReports` | 放射科 | 医疗资源中心 | 试点医院 PACS 厂商 |
| P0-05 | 医保结算 | `insurance-settlement-v1` | `insuranceClaims` | 医保办 | 跨部门接口组 | 区域医保平台 |
| P0-06 | 电子证照 | `certificate-sync-v1` | `digitalCredentials` | 政务服务部门 | 跨部门接口组 | 电子证照平台 |
| P0-07 | 公卫直报 | `public-health-direct-report-v1` | 共享契约中的 `publicHealthEvents` | 疾控/公卫部门 | 公卫接口组 | 公卫直报平台 |

机器可读的完整清单位于 `interface-joint-test-package.js`。

## 字段责任矩阵

| 契约 | 身份字段责任 | 业务字段责任 | 机构字段责任 | 平台责任 |
|---|---|---|---|---|
| HIS | HIS 产生 `externalId/residentId/visitNo` | 医务确认就诊类型与状态 | 医院信息中心维护机构、科室编码 | T03 验证、机构范围幂等、就诊记录投影 |
| EMR | EMR 产生 `externalId/residentId/documentNo` | 医务确认诊断、编码、摘要 | 医院信息中心维护作者科室 | T03 最小化、幂等、病历摘要投影 |
| LIS | LIS 产生 `externalId/residentId/specimenNo` | 检验科确认项目、结果、标志、时间 | 医院信息中心维护报告机构编码 | T03 检验落库、公卫触发与补偿 |
| PACS | PACS 产生 `externalId/residentId/accessionNo` | 放射科确认检查类型、部位、结论 | 医院信息中心维护报告机构编码 | T03 只保存影像引用，不接收二进制 DICOM |
| 医保 | 医院/医保共同确认 `claimNo/residentId/settlementNo` | 医保办确认结算类型、金额及状态 | 医院维护 `institutionCode` | T03 回调状态保护、业务投影和金额对账 |
| 证照 | 证照平台产生 `externalId/certificateNo/subjectReference` | 政务部门确认证照类型与状态 | 政务部门确认签发机构 | T03 居民映射、业务投影和人工补偿 |
| 公卫 | T03 使用独立密钥生成 `hmac-sha256:v1` 主体/标本假名 | 疾控与检验科确认病种、项目、阳性标志 | 医院提供报告机构编码 | T03 最小化签名发送、回调、防重放和死信 |

禁止在业务报文中嵌入密码、令牌、私钥、证照正文、Base64 影像或 DICOM。公卫直报不得携带 `residentId`、身份证号、手机号等直接标识。

## 样例报文

七个无真实个人数据的完整样例由 `interface-joint-test-package.js` 的 `SAMPLE_MESSAGES` 导出。统一医院入站形态如下：

```json
{
  "contractId": "pacs-report-v1",
  "idempotencyKey": "jt-pacs-001",
  "payload": {
    "externalId": "JT-PACS-001",
    "residentId": "JT-RESIDENT-001",
    "institutionCode": "JT-HOSP-001",
    "modality": "CT",
    "conclusion": "joint test conclusion",
    "reportedAt": "2026-07-22T01:40:00Z",
    "imagingReference": "dicom-study:JT-1.2.3"
  }
}
```

公卫报文仅包含带版本、带密钥的主体/标本假名；不得使用可字典枚举的裸 SHA-256。医保金额入站使用元，金融网关使用整数分；两者不得混用。

## 异常补偿与对账

- 医院入站以 `contractId|institutionCode|externalId` 作为平台幂等身份。同一身份同一报文返回幂等结果，不同报文返回 409 冲突。
- 医院机构账号必须具有非空认证 `orgCode`，并与报文 `institutionCode` 一致。跨机构代理只能由服务器调用 `issueCrossInstitutionAuthorization(authorizedBy)` 在当前进程签发；授权对象由 `WeakSet` 认证，JSON 复制或同形对象均无效，不得来自调用方报文或普通布尔参数。
- PACS 只接受不含查询参数/凭据的 HTTPS 引用或 `dicom-study:` 引用；医保分项金额同时提供时必须与总金额一致；医保及证照状态必须属于平台规范字典。
- HIS、EMR、PACS 和证照入站投影失败进入死信及 P0 `interfaceReconciliationCases`；最多自动/人工重试三次，修正报文不得改变原始接口身份。
- 修正重试保留 `originalPayloadDigest` 和最多十条摘要替换历史；不得用修正报文覆盖原始审计证据。
- LIS 先落 `diagnosticReports` 再触发公卫直报。直报失败不回滚检验记录，而是进入独立死信；补偿不得重复创建检验记录。
- LIS 与公卫直报要求 `occurredAt <= reportedAt`，且报告时间不得超过平台当前时间允许的五分钟时钟偏差。
- 金融回调必须先通过现有 HMAC、时间窗、nonce、防金额错配、乱序和终态保护，再调用业务投影。`stateApplied=false` 的回调不得更新医保或证照业务记录。
- 证照主体无法映射居民时不得创建无归属证照，必须进入 P0 人工对账；补齐授权映射后由 `retryFinancialProjection` 处理。
- 对账必须同时核对源端、平台网关账本、业务集合和外部回执。医保还要核对总金额，验收差异必须为零。
- 公开状态只返回摘要，不返回原始报文、居民标识、nonce、签名密钥或接口地址。

## 联调环境

公共配置：

- `NODE_ENV=production` 时所有外部地址必须为 HTTPS。
- `INTEGRATION_GATEWAY_SECRET` 用于统一入站验签，正式值不得使用示例或占位内容。

医院适配器：

- `HIS_ADAPTER_URL/HIS_ADAPTER_SECRET`
- `EMR_ADAPTER_URL/EMR_ADAPTER_SECRET`
- `LIS_ADAPTER_URL/LIS_ADAPTER_SECRET`
- `PACS_ADAPTER_URL/PACS_ADAPTER_SECRET`
- 可选域令牌 `HIS_ADAPTER_TOKEN` 等，以及 `HOSPITAL_ADAPTER_TIMEOUT_MS/HOSPITAL_ADAPTER_MAX_ATTEMPTS`

医保与证照：

- `INSURANCE_GATEWAY_URL/INSURANCE_GATEWAY_SECRET/INSURANCE_CALLBACK_SECRET`
- `CERTIFICATE_GATEWAY_URL/CERTIFICATE_GATEWAY_SECRET/CERTIFICATE_CALLBACK_SECRET`
- `FINANCIAL_GATEWAY_TIMEOUT_MS/FINANCIAL_GATEWAY_MAX_ATTEMPTS`

公卫直报：

- `PUBLIC_HEALTH_DIRECT_REPORT_URL`
- `PUBLIC_HEALTH_DIRECT_REPORT_SECRET`
- `PUBLIC_HEALTH_REFERENCE_SECRET`（独立 HMAC 假名密钥，生产环境至少 32 字节）
- `PUBLIC_HEALTH_DIRECT_REPORT_TOKEN`（仅外部平台要求时）
- `PUBLIC_HEALTH_DIRECT_REPORT_CALLBACK_SECRET`
- `PUBLIC_HEALTH_DIRECT_REPORT_TIMEOUT_MS/PUBLIC_HEALTH_DIRECT_REPORT_MAX_ATTEMPTS`

密钥只能由密钥管理或部署环境注入，不写入样例、日志、仓库或验收截图。引用密钥不得来自 API 调用方；缺失时阳性直报必须在落库和发送前失败关闭。联调环境还必须具备 VPN/白名单、DNS/TLS 链、回调可达性、机器账号和轮换责任人。

## 外部依赖

- 七个接口的正式字段字典、代码集、版本号和责任方签字。
- 试点医院及三方平台的测试地址、网络白名单、证书或 HMAC 密钥。
- 获得授权的虚拟居民映射数据，不使用真实患者样本。
- 医保、证照、公卫平台回调规范、签名密钥与回调窗口。
- 现场联调时段、厂商联系人、故障升级链和回退窗口。
- 医保对账单、公卫回执、证照签发/撤销回执及失败补偿证据。

## 实施步骤

1. 冻结契约版本、字段责任、代码字典和时区/金额口径。
2. 由运维配置隔离联调地址、机器身份、密钥、VPN/白名单和回调路由。
3. T00 接入共享服务路由与持久化；先在测试环境执行就绪检查。
4. 每个 P0 接口执行验签、必填、格式、最小化和机构边界负向用例。
5. 每个接口执行一笔正常业务和一次同报文幂等重放。
6. 执行超时、有限重试、死信、回调重放、乱序、金额错配与人工补偿。
7. 核对源端、平台账本、业务集合和外部平台数量/金额，收集脱敏证据。
8. 由业务、技术、安全和外部责任方签字，T00 更新发布总表和生产门禁。

## 文件边界

T03 新增或维护：

- `interface-domain-integration.js`：HIS/EMR/LIS/PACS/医保/证照统一入站业务落库。
- `interface-security-context.js`：进程内签发、不可 JSON 伪造的跨机构授权能力。
- `financial-domain-integration.js`：医保、证照可信回调后的业务投影和补偿。
- `medical-public-health-integration.js`、`public-health-connectors.js`：LIS 到公卫直报首个增量。
- `interface-joint-test-package.js`：P0 清单、责任矩阵、样例、环境、测试和验收数据。
- `scripts/interface-mapping.js`：字段映射。
- `scripts/full-interface-integration-readiness.js` 与 T03 测试、文档。

T00 统一维护，T03 不编辑：

- `server.js`
- `portal.css`
- `package.json`
- `README.md`
- 发布总表及共享 `release/` 证据

## T00 集成钩子

1. 在共享 `server.js` 导入 `ingestInterfaceEvent/retryInboundLanding/interfaceDomainStatus`。
2. 仅在经过服务器端权限策略批准的系统中继场景调用 `issueCrossInstitutionAuthorization(authorizedBy)`；绝不从请求体构造或恢复授权对象。
3. 统一入站验签成功后将 `signatureVerified:true`、当前用户和数据库状态传给 `ingestInterfaceEvent`，替换 HIS/EMR/LIS/PACS 只记网关事件不落业务集合的路径。
4. 金融回调验签后用 `applyFinancialCallbackAndSync` 替代只调用 `applyFinancialCallback`；补偿路由调用 `retryFinancialProjection`。
5. 接入公卫直报状态、回调、死信重试路由，沿用 `docs/lis-public-health-first-increment.md` 的钩子说明。
6. 数据持久化必须包含 `interfaceReconciliationCases`，写入仍由共享存储层统一完成。
7. 将 `CONTRACTS` 与 `public-health-direct-report-v1` 合并到共享契约注册表，不删除现有预约、体检、转诊契约。
8. 将就绪检查纳入 T00 发布检查，但不要把本地自动化通过解释为真实生产联调完成。

验证命令（不生成共享发布文件）：

```powershell
node --test test/interface-domain-integration.test.js test/financial-domain-integration.test.js test/medical-public-health-integration.test.js test/public-health-connectors.test.js test/interface-joint-test-package.test.js test/full-interface-integration-readiness.test.js
node scripts/full-interface-integration-readiness.js --write=false
```

## 测试清单

- 正确签名通过；错误、过期或未验签请求拒绝。
- 机构角色缺失或伪造 `orgCode` 时拒绝且不产生业务记录、网关事件或外部发送。
- keyed-HMAC 主体/标本假名同密钥稳定、不同密钥不同，且摘要不等于裸 SHA-256；缺失或弱生产引用密钥拒绝。
- 必填字段、日期、金额、摘要引用及正式代码值校验。
- PACS 带令牌的影像 URL、医保分项金额不平、未知医保/证照状态拒绝。
- 同机构同外部身份幂等；身份相同但报文不同返回冲突。
- 跨机构不能覆盖其他机构记录。
- LIS/公卫事件时间倒置或超过未来时钟窗口时拒绝。
- 嵌入密钥、令牌、证照正文、Base64 影像/DICOM 拒绝。
- 七个 P0 正常流程各生成一个目标业务记录及可追溯账本证据。
- 暂态超时有限重试，重试期间保持请求身份不变。
- 永久失败进入死信或 P0 对账，不产生部分无归属记录。
- 修正重试在三次上限内关闭对账问题。
- 回调 nonce 重放、金额错配、乱序、终态回退均不改变业务状态。
- 源端、平台、外部数量一致，医保金额一致。
- 公共状态不泄露密钥、地址、nonce、原始报文或居民标识。

## 验收标准

- 七个 P0 接口均有明确的业务、技术和外部责任人。
- 每个契约的正常、幂等、负向校验和补偿用例全部通过。
- HIS/EMR/LIS/PACS 记录可在目标集合查询，并能反查网关事件 ID。
- 医保/证照仅在可信回调状态被应用后更新业务记录。
- LIS 阳性样例产生最小化公卫报文、平台回执和可信最终回调。
- 验收截止时 P0 对账问题为零。
- 源端/外部/平台数量差异为零，医保金额差异为零。
- 证据包含脱敏报文摘要、回执、回调、失败重试和责任方签字。
- T00 就绪检查通过；只有真实现场证据齐全后才能把 `productionReady=false` 改为 true。
