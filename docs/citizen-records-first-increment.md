# 居民健康档案与电子病历首个可验收增量

## 增量范围

首个增量限定为“本人健康档案与电子病历只读闭环 V1”。实名居民可查看本人健康档案、电子病历、检验检查、用药记录、影像报告摘要和附件状态，并可按用途、范围和有效期创建授权后主动撤销。家庭成员数据访问、原始 DICOM、医院病历写入和生产对象存储上传不属于本增量的上线承诺。

## 居民旅程

1. 居民完成受控试点登录并进入本人健康档案。
2. 页面展示只读记录数、分类数、可信来源数、个人补充数、有效授权数和受控原文数。
3. 居民按健康档案、病历、检验、用药、影像报告、附件和授权分类查看数据。
4. 每条记录展示来源、居民可读摘要、业务日期和可用的更新时间；医院/基层/公卫来源与个人补充资料分开标识。
5. 居民创建授权时必须填写被授权主体、主体类型、用途、至少一项范围、有效期并确认撤销权利。
6. 居民撤销授权时调用 `POST /api/authorizations/:id/revoke`；平台失败时不写入本地替代成功状态。
7. 原文和影像调阅继续受有效授权、短时凭据、恶意文件扫描和访问审计约束。

## 第二增量：影像报告与服务端策略契约

居民端通过现有 `GET /api/imaging-cloud` 读取本人影像检查，`imagingStudyToRecord` 将检查映射成居民档案中的“影像报告”记录。映射只保留检查号、模态、部位、报告结论、审核/质控状态、必要计数和受控调阅标识；`patientName`、`personIndex`、`mainIndex`、`objectPath`、`accessUrl`、设备和网关内部信息均不进入居民记录。重复的 `imageCloudStudyId` 不会二次归档。

存在浏览能力时，页面显示“进入受控影像调阅”。点击后才调用 `GET /api/imaging-cloud/studies/:id/viewer`，由后端再次校验居民范围并写访问日志；页面 HTML 不预埋对象地址或查看器地址。当前公共接口返回的 `expiresAt=null` 尚不满足生产短时凭据要求，因此本增量只验收受控入口和审计调用，不把永久 OHIF 地址认定为生产就绪。

新增的 `citizen-records-policy.js` 是供 T00 接入公共服务端的纯策略模块，本线程不修改 `server.js`。策略规定：

- 本人记录可读；家庭账户成员必须同时具备权威关系核验状态、核验时间、证据来源和面向当前账户/居民的有效按范围授权；
- 仅加入 `account.members` 不产生读取权限；过期、撤销或范围不匹配的授权均拒绝；
- 居民补充记录只能写本人，且强制标记为 `resident-upload / self-reported / unverified`；
- 居民不得通过通用记录接口新增 `emr` 或 `authorizations`，授权继续走专用授权接口；
- 服务端响应可复用与浏览器一致的字段白名单投影。

### T00 接入点

1. 在公共 `allowedResidentIdsForUser` 的 citizen 分支调用 `allowedResidentIdsForCitizen(data, user, { scope, now })`，不要直接展开全部 `account.members`。
2. 在居民健康档案、影像云、原文、分享、会诊等接口按业务传入明确 scope，例如 `health-record-summary`、`emr-summary`、`labs`、`medications`、`imaging-report`。
3. 在 `POST /api/personal-records` 的 citizen 分支先调用 `normalizeCitizenSupplement(payload, user)`，拒绝权威分类和跨居民写入；服务端生成 id、时间及审计字段。
4. 在居民记录响应出口调用 `projectCitizenRecordResponse(record, residentId)`，并保留现有全局敏感字段脱敏作为纵深防御。
5. 正式启用家庭访问前，为关系记录补齐 `relationshipStatus`、`verifiedAt`、`evidenceSource`，为授权补齐 `granteeAccountId` 或 `granteeResidentId`；当前演示库不具备这些证据，按策略默认拒绝家庭成员读取。

## 第三增量：检验检查与用药服务

居民端继续复用已经按登录用户裁剪的 `/api/state`，将 `diagnosticReports` 和 `medicationPickups` 转换为居民可读记录，不增加新的公共接口：

- 检验检查只保留项目、结果/结论、报告时间、报告号、来源机构和互认状态；报告 PDF 哈希、居民主索引、互认内部证据和目标机构工作字段不进入投影。
- 未关联影像云的超声、放射等诊断报告可进入影像报告分类；已有关联 `imageCloudStudyId` 的报告由影像云适配器统一处理，避免重复。
- 固定取药记录只展示药品、用法、药房、下次取药、机构/医保审核和药房状态，并明确标注为“药事服务状态不替代医嘱”。
- 药事服务记录的 `authority=pharmacy-service`，不能被页面或下游当成医生处方；居民自行补充的用药信息仍保持 `self-reported / unverified`。
- `sourceRecordId` 用于适配器幂等去重，但只在白名单元数据中使用，不向页面暴露内部结算、理赔或报告哈希。

服务端策略新增按记录分类选择授权范围：电子病历对应 `emr-summary`，检验检查对应 `labs`，用药对应 `medications`，影像对应 `imaging-report`，其他档案默认 `health-record-summary`。家庭成员即使拥有某一范围，也不能读取其他分类。

## 第四增量：电子病历、附件与访问复核收口

- 既有 `personalRecords.category=emr` 统一规范为 `recordKind=emr-summary`；只有系统或医疗机构来源才能标为临床可信，居民提供内容仍不能成为 EMR。
- 居民端按本人范围读取 `GET /api/attachments?residentId=:id`，只投影文件名、类型、大小、扫描状态、留存策略和法律保全状态。对象键、上传 ID、校验哈希和存储版本不进入页面状态。
- 仅 `status=active` 且 `scanStatus=clean` 的附件显示“申请短时下载”；点击后调用 `POST /api/attachments/:id/download-intent`，页面不预埋下载 URL。
- 隔离、扫描失败或待扫描附件明确显示不可下载，不能通过前端状态绕过后端完整性和恶意文件扫描。
- 居民通过“复核授权与访问”显式调用 `GET /api/access-reviews?residentId=:id`。返回数据再次经过前端最小化投影，只保留访问时间、主体、角色、范围、用途和结果；`personIndex`、`auditHash` 和 `previousAuditHash` 不进入页面状态。

## T04 软件范围完成判断

本分支已覆盖本人健康档案、电子病历摘要、检验检查、影像报告、用药与取药服务、附件安全状态、授权创建/到期/撤销、访问复核、数据最小化、可信来源分级及移动端 44px 触控验收。仓库内且属于 T04 文件边界的已规划功能已完成。

以下项目不是代码缺口，仍需 T00 或现场依赖后才能宣布生产上线：公共 `server.js` 接入 `citizen-records-policy.js`、服务工作线程缓存新脚本、影像查看器短时凭据、真实家庭/监护关系核验、HIS/EMR/LIS/PACS 正式接口、对象存储/KMS/扫描引擎、授权告知书法务版本、统一审计/SIEM 以及医院和监管签字。草稿 PR 不应将这些项目表述为已生产就绪。

## 数据最小化

`citizen-records-v1.js` 为居民页面建立白名单投影。页面只消费记录标识、居民标识、分类、业务日期、标题、居民可读摘要、来源、状态、创建/更新时间及经过白名单筛选的显示元数据。`personIndex`、对象键、存储桶、上传地址、永久下载地址和任意内部 `meta` 字段不进入居民显示投影。

居民个人补充资料统一写入：

- `authority=resident-upload`
- `sourceTrust=self-reported`
- `dataQualityStatus=unverified`
- `originalAvailable=false`

个人资料不能覆盖或冒充医院 EMR、LIS、PACS 原始记录。

## 授权模型

V1 授权元数据包括 `granteeType`、`granteeId`、`purpose`、`scopes`、`expiresAt`、`consentVersion`、`grantedAt`、`version` 和 `status`。新授权必须绑定稳定的团队、机构、账户或居民标识，不能仅凭显示名称授权；家庭读取时该标识必须精确匹配当前账户或居民。前后端均应以主体匹配、撤销状态和到期时间计算有效性。家庭/监护关系只决定是否具备申请授权的前提，有效授权凭证才决定是否可以读取相应数据。

居民授权范围采用显式最小白名单：`health-record-summary`、`emr-summary`、`labs`、`medications`、`imaging-report` 和 `attachments`。通配符、未知范围以及“合法范围 + 未知范围”的混合记录均 fail-closed；附件不会继承影像或健康档案摘要权限。未来有效期只能作为必要条件，授权状态还必须全部属于 `active / authorized / 有效 / 已授权` 最小白名单。

授权构建器拒绝有效期早于授权时间的记录。历史授权若缺少 `granteeId`，可以只读展示，但不能用于家庭成员权限判定，需重新核验主体后再签发。

当前公共后端仍需由 T00 在集成时进一步收紧：

- 家庭成员读取必须同时满足权威关系核验和有效授权；
- 居民记录读取应使用与本投影一致的服务端字段白名单；
- 居民只能新增个人补充记录和授权，不得新增或修改权威 EMR/LIS/PACS 分类；
- 授权过期必须与撤销一样阻断远程会诊、机构查看和原文调阅；
- 专用撤销响应应带回可供居民复核的审计关联号。

## 文件边界

T04 本增量修改 `citizen.html`、`citizen.js`、`citizen.css`，新增 `citizen-records-v1.js`、专项单元测试和居民旅程 E2E 测试。`server.js`、`portal.css`、`package.json`、`README.md` 和发布总表继续由 T00 集成。新增浏览器脚本的 PWA 缓存清单也应由 T00 在公共发布合入时统一更新。

## 验收标准

1. 居民投影不会返回对象键、上传地址、身份主索引或非白名单元数据。
2. 非当前居民记录不会进入页面投影。
3. 授权缺少对象、用途、范围或有效期时不能保存。
4. 有效、过期和撤销状态按同一规则显示；过期或撤销记录不再显示撤销按钮。
5. 在线保存或撤销失败时页面不产生本地替代成功记录。
6. 电子病历和居民记录正文按文本转义后展示。
7. 健康资料分类和撤销按钮触控高度不低于 44px，大字模式可保持核心操作可用。
8. `node --test test/citizen-records-v1.test.js` 和 `npx playwright test test/e2e/citizen-records-v1.spec.js` 通过。
9. 影像云检查映射后可在居民“影像资料”分类看到报告摘要和受控调阅入口，页面与投影中不出现对象存储地址、永久访问地址或患者姓名。
10. `node --test test/citizen-records-policy.test.js` 证明家庭访问默认拒绝、关系与授权双条件、范围/到期/撤销校验及居民写入降权生效。
11. 检验检查互认报告显示报告号、互认状态和原文授权边界，投影中不包含报告哈希或居民主索引。
12. 用药分类可显示取药服务进度，但不得把取药记录表述为处方或变更用药建议。
13. 同一 `diagnosticReports.id` 或 `medicationPickups.id` 重复合并时不生成重复居民记录。
14. 系统接入的 EMR 摘要标识可信来源；居民补充资料不能转换为 EMR。
15. 安全附件投影不包含对象键、上传 ID 或校验哈希，只有扫描通过的有效附件能申请短时下载。
16. 主动访问复核后页面不保存或显示审计链哈希及居民主索引。

## 外部依赖

- 居民主索引、实名和家庭/监护关系核验；
- 试点医院 HIS/EMR/LIS/PACS 字段映射及脱敏样例；
- 对象存储网关、KMS、恶意文件/DICOM 扫描、WORM 和备份恢复；
- 统一审计链或 SIEM、授权告知书法务版本；
- 试点医院、卫健监管、安全合规和居民代表现场签字。
