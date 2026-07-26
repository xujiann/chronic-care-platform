# 试点证据仓与验收包

## 建设范围

证据仓以试点批次为最小管理单元，将 20 required controls 纳入同一批次：

- 10 项现场上线任务；
- HIS、EMR、LIS、PACS 4 项接口联调回执；
- 主告警和升级告警 2 条路由回执；
- 卫健委、试点医院、平台厂商和运维服务方 4 项签字。

批次在开放状态下允许提交、替换和复核证据。冻结后不得继续修改，只能通过新批次或新版本重新履行验收流程。

## 证据控制

正式证据只登记对象存储元数据，不通过平台业务接口传输附件二进制。每个版本必须具备：

- `evidence` 密级；
- `audit-evidence` 保留策略和 immutable 对象锁；
- 64 位 SHA-256；
- 服务端病毒扫描结果 `clean`；
- 对象键和不可为空的对象版本；
- 提交人、提交时间和审计事件。

替换证据时，原版本标记为 `superseded` 并继续保留，不覆盖原始对象和摘要。

## 独立复核

提交人不得复核本人证据。independent review 必须由允许的审计、卫健委、专家、安全或发布管理角色完成，并再次提交证据摘要。复核摘要与登记 SHA-256 不一致时拒绝验收。

访问证据必须登记访问目的、允许或拒绝结果、访问人、对象版本和时间。审计事件使用前序哈希形成链式记录。

## 冻结验收包

只有 20 项要求全部通过独立复核后，卫健委或发布管理角色才能冻结批次。冻结包包含：

- 批次和试点医院标识；
- 20 项要求及当前有效证据版本；
- 文件名、大小、密级、保留期、扫描结果、对象版本和 SHA-256；
- 提交人与复核人；
- 审计事件数量和尾哈希；
- 整包 manifest SHA-256。

验收包不包含附件正文。接收方可重新计算 manifest SHA-256，识别清单、证据引用或复核记录被篡改的情况。

## 持久化接口与操作台

`pilot-evidence.html` 提供批次、20 项验收要求、证据版本、独立复核、访问审计、冻结和导出操作台。运行接口包括：

- `GET /api/pilot-evidence`：读取当前角色可访问的批次中心；
- `POST /api/pilot-evidence/batches`：建立绑定当前机构的试点批次；
- `GET /api/pilot-evidence/batches/:id`：读取批次、证据和审计链；
- `POST /api/pilot-evidence/batches/:id/artifacts`：通过安全附件 ID 登记已完成扫描的对象版本；
- `POST /api/pilot-evidence/batches/:id/artifacts/:artifactId/review`：卫健委角色独立复核；
- `POST /api/pilot-evidence/batches/:id/artifacts/:artifactId/access`：登记证据调阅目的；
- `POST /api/pilot-evidence/batches/:id/freeze`：在 20/20 通过后冻结；
- `GET /api/pilot-evidence/batches/:id/acceptance-pack`：复验或下载冻结验收包。

批次写操作必须提交 `expectedRevision`。版本不一致返回冲突，不覆盖其他操作者刚刚提交的证据或复核结果。机构用户只能访问本机构批次和本机构上传的安全附件；冻结和独立复核仅允许卫健委角色执行。

## production boundary

当前增量完成批次模型、持久化接口、角色化操作台、对象存储回执联动、版本替换、独立复核、访问审计、冻结封包和摘要复验。正式试点上线前仍需完成：

1. `pilotEvidenceBatches` 生产数据库迁移、保留期和备份恢复验收；
2. 真实对象存储、KMS、WORM/对象锁和备份恢复验收；
3. 生产病毒库更新与扫描回执；
4. 医院真实接口回执、告警确认和四方签字原件；
5. 调阅审计和容灾演练签字。

仓库内演练通过仅证明软件控制可运行，不代表现场材料已经提交或正式生产已经批准。
