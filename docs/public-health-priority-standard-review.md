# 公共卫生重点领域标准映射复核包

## 范围

本复核包覆盖八个业务轨道：传染病发现与直报、免疫规划、妇幼健康、老年健康、慢性病防控、基本公卫随访、健康教育和家庭医生协同。

八个业务轨道复用七个既有标准域，不新造与现行标准重复的领域：

| 业务轨道 | 标准域 | 主责部门 |
|---|---|---|
| 传染病发现与直报 | `ph-infectious` | 疾控中心传染病监测部门 |
| 免疫规划 | `ph-immunization` | 疾控免疫规划部门 |
| 妇幼健康 | `ph-maternal-child` | 妇幼保健机构/妇幼健康处 |
| 老年健康 | `ph-senior` | 基层医疗卫生机构 |
| 慢性病防控 | `ph-chronic` | 基层卫生部门/疾控慢病部门 |
| 基本公卫随访 | `ph-chronic`、`ph-archive` | 基层公卫专班 |
| 健康教育 | `ph-health-education` | 疾控健康教育部门/基层机构 |
| 家庭医生协同 | `ph-chronic`、`ph-archive` | 基层卫生部门/家庭医生团队 |

## 复核内容

每个轨道必须同时复核：

1. 主责部门和协同部门；
2. 对应标准域及现有实施台账条目；
3. 业务数据集合；
4. 外部及内部接口；
5. 已存在的代码、readiness 和说明文档；
6. 独立的现场签字证据。

只完成代码和数据映射时，轨道可以进入 `mapping-reviewed`，但不能标记为正式验收。只有关联状态为 `verified`、具备制品名称和签字人的现场证据后，单个轨道才能进入 `site-evidence-linked`。

## 责任确认

`confirm-responsibility` 必须记录：

- `responsibleOwner`：最终负责部门；
- `collaborators`：参与数据提供、接口联调和业务处置的部门；
- 确认人、确认时间和说明；
- `idempotencyKey`，以及可选的 `expectedVersion`。

责任确认不能由居民角色执行。业务机构可确认责任边界，最终标准映射复核由卫健管理部门或疾控复核角色完成。

## 映射复核

`review-standard-mapping` 要求调用方逐项回传完整且精确匹配的：

- `reviewedDomainIds`
- `reviewedDataCollections`
- `reviewedInterfaces`
- `evidenceRefs`

缺少标准域、少报数据集合、漏报接口或替换制品证据都会阻断复核。该规则用于防止只点击“已复核”而未真正核对责任、数据和接口。

## 现场证据门禁

`link-site-evidence` 首先只登记现场材料声明，要求：

- 非空材料状态 `status`（即使客户端填写 `verified`，也只视为声明）
- 非空证据编号 `id`
- 非空制品名称 `artifactName`
- 非空签字责任方 `signedBy`

材料登记与生产可信核验严格拆分。客户端提交的 `status`、`signedBy`、`signatureVerified`、`verificationSource` 或摘要字段都不能直接形成正式接受。只有服务端通过第四个 `context.trustedSiteEvidenceRegistry` 参数注入可信证据仓记录，并同时满足可信来源、签名验证、SHA-256 制品摘要、服务端核验人、核验时间以及材料字段一致性，轨道才可 `formallyAccepted`。`summarizePack(tracks, context)` 还会在每次汇总时重新查询该可信上下文；仅有持久化投影而未传入服务端 registry 时仍会重新降级为阻断。

未取得服务端可信结果时，汇总会返回逐轨 `productionBlockers`，状态为 `evidence-not-registered` 或 `evidence-registered-trust-pending`，`productionReady` 必须保持 `false`。代码测试报告、演示数据和映射记录不能替代现场证据。当前源台账七个目标标准域的持久化复核数仍为 0，现场证据也尚未签署，因此正式上线必须继续阻断。

`buildTrustedSiteEvidenceRegistry()` 是供 T00 公共路由调用的服务端适配边界。它会把 `siteLaunchEvidence` 与 `publicHealthSiteEvidenceVerificationTasks` 按证据编号、模板和服务端回执关联。旧式 `status: verified`、人工 `verifiedBy` 或单独的核验任务均不会进入 registry；证据还必须包含仅由服务器生成的 `trustedVerification`，其中具备可信来源、已验证签名、允许的签名算法、密钥编号、SHA-256 摘要、签字方、服务端核验人、时间和匹配回执。registry 构建本身始终 `productionReady: false`，最终仍由八轨汇总和全局上线审批共同决定。

## 八轨道主要证据

### 传染病发现与直报

- `publicHealthEvents`
- `phase2DiseaseReportQueue`
- `phase2DiseaseReportReceipts`
- 传染病事件上报闭环服务、readiness 和交接文档

### 免疫规划

- 出生医学证明和公卫异常事件
- 2026 版免疫程序规则库
- 免疫规划 readiness 与政策说明

### 妇幼健康

- 出生证明、出生统计和个人健康记录
- 妇幼 readiness、政策说明和主要功能报告

### 老年健康

- 老年服务、个人记录和随访
- 慢病随访 readiness 与基层外展证据

### 慢性病防控

- 高危筛查、分层管理和随访
- 慢病随访 readiness、机构接口清单

### 基本公卫随访

- 随访、任务消息和健康档案记录
- 监测、预警、派发、干预、随访和汇总六阶段证据

### 健康教育

- 慢病教育推送、公卫事件和居民端消息接口
- 活动效果评价仍需现场平台回执补证

### 家庭医生协同

- 签约申请、合同、履约和公卫随访
- 家庭医生 readiness 与慢病随访 readiness

## T00 集成交接

本线程不修改公共 `server.js`、`package.json`、公共样式、README 或发布总表。T00 应：

1. 将责任确认和复核动作持久化到现有标准实施台账 API；
2. 保留现有 `review-standard-mapping` 和 `link-standard-site-evidence` 动作名称；
3. 在 `package.json` 中接入语法检查、专项测试和 readiness；
4. 在公卫页面增加八轨道聚合视图，公共样式由 T00 统一处理；
5. 将专项报告纳入发布总表；
6. 在七个标准域的责任人复核尚未持久化、现场证据未核验时，禁止通过生产审批。

## 测试和验收

```powershell
node --test test/public-health-priority-standard-review-service.test.js test/public-health-priority-standard-review-readiness.test.js
```

业务验收要求：

- 八个业务轨道全部存在并映射到七个既有标准域；
- 每个轨道均有主责和协同部门；
- 数据集合、接口和制品证据完整；
- 复核动作具备角色、幂等和版本控制；
- 少报任何复核项时动作失败；
- 缺少状态、编号、制品名称或签字声明的现场材料不能登记；
- 伪造 `verified`、`signedBy` 或客户端自报签名验证结果不能清除生产 blocker；
- 正式接受必须来自服务端可信证据仓，并核验可信来源、签名、摘要、核验人和时间；
- 演示复核完成后状态为 `mapping-reviewed-site-evidence-pending`，`productionReady` 保持 `false`。
