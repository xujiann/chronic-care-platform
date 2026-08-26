# 对象存储与附件安全模块

## MVP 范围

本模块为电子病历附件、检验报告、影像索引、互联网护理记录和上线证据包提供统一的安全附件元数据、外部对象存储上传授权、服务端完整性校验、恶意文件扫描、短时下载授权和生命周期控制。

## 运行接口

### v2 耐久异步接口

`POST /api/attachments/v2/upload-intents`、complete/download/lifecycle v2 入口只在 SQLite v17 本地事务中
登记结构化附件和命令，返回 `202 + commandId + statusUrl`；`GET /api/attachments/v2/commands/:id` 查询
状态，commission 可对 dead-letter 执行带幂等键和摘要审计的 replay。列表使用角色范围绑定、固定 high-water
的 HMAC keyset cursor。请求路径不调用外部网关，独立 worker 才执行 provider 操作，并以完整 lease fencing、
有界退避、dead-letter 和不可变摘要回执收敛。短效上传/下载 URL 到期即从命令结果持久清除，对外永不返回
对象键。worker 每次首次执行和重试都固定使用 `commandId` 作为 provider `requestId`，使外部幂等键保持稳定；
该设计仍是 at-least-once，不宣称 exactly-once。

v1 在获批的有界迁移窗口保留，调用方应迁移到 v2 异步合同。仓库实现与测试不代表外部 provider status/
abort capability、KMS/WORM、恶意文件扫描、备份恢复或现场验收已经完成；`productionReady=false`。

- `GET /api/attachments/storage`：监管和医疗机构角色查看适配器配置与控制状态，不返回网关地址、存储桶、密钥或令牌。
- `GET /api/attachments`：按居民、创建机构和角色范围查询附件安全元数据，不返回上传凭据。
- `POST /api/attachments/upload-intents`：校验文件名、类型、大小、SHA-256、数据分类和留存策略，再向对象存储网关申请短期直传授权。
- `POST /api/attachments/:id/complete`：由网关返回实际大小、摘要和服务端恶意文件扫描结果；不一致或非 clean 状态立即隔离。
- `POST /api/attachments/:id/download-intent`：仅对 active 且 scanStatus=clean 的附件签发短期下载授权。
- `POST /api/attachments/:id/actions`：执行隔离、法律保全、解除保全和删除；不可变留存或法律保全对象禁止删除。

## 安全控制

- 文件内容不经过平台 JSON API，客户端不能提交任意对象存储地址或永久访问地址。
- 上传前必须声明 SHA-256 和精确字节数，完成后以对象存储网关实测值复核。
- 扫描结果必须来自服务端网关，客户端自报的扫描状态不参与放行。
- 默认允许 PDF、图片、DICOM、JSON、文本和受控 Office Open XML 类型，不允许可执行文件和任意二进制类型。
- 临床病历、医疗同意书和审计证据使用不可变留存策略；法律保全由监管角色控制。
- 居民仅访问本人及家庭授权范围，医疗机构仅访问本机构创建的附件，监管角色可以审计全量。
- 平台只保存对象键、版本、摘要、扫描状态、分类、留存和审计元数据，不保存签名上传/下载 URL。

## 网关信任契约 v1

生产环境固定使用 `object-storage-gateway-trust-v1`，不允许回退到旧响应契约。应用请求仍使用
`OBJECT_STORAGE_SIGNING_SECRET`；网关响应必须使用独立且不同的
`OBJECT_STORAGE_RECEIPT_SIGNING_SECRET`。两个方向的密钥均不得写入响应、日志、报告或制品。
v1 请求同时携带 `X-Object-Storage-Contract`，签名 JSON envelope 内固定包含同一 `contractVersion`
和当前 `operation`，防止把已签请求降级或重放到其他操作。

网关响应必须携带以下响应头：

- `X-Object-Storage-Contract: object-storage-gateway-trust-v1`
- `X-Request-Id`，必须等于当前请求 ID
- `X-Timestamp`，必须是带时区的 RFC3339 时间并处于配置的时钟偏差窗口
- `X-Signature-Algorithm: HMAC-SHA256`
- `X-Signature`

响应签名对原始响应 body（JSON 解析前）计算 SHA-256，并对以下换行分隔字符串计算 HMAC-SHA256：

```text
object-storage-response-v1
<operation>
<HTTP status>
<X-Timestamp>
<X-Request-Id>
<sha256(raw response body)>
```

应用必须以流式方式读取响应，累计超过 1 MiB 时立即取消读取并失败关闭；v1 不接受缺少可控响应流的
fetch 实现，禁止先完整缓冲再执行大小检查。

签名通过后，JSON body 仍必须使用 `object-storage-gateway-response-v1`，并精确回显 `requestId`、
`operation`、`bucket`、`attachmentId`、`objectKey`；下载和生命周期操作还必须绑定请求中的
`objectVersion`。下载以及 legal-hold/release-hold/delete 必须提交非空对象版本；完成失败后的 quarantine
可暂时使用空版本，但响应也必须精确回显空值，不能替换成“当前版本”。上传、下载 URL 分别命中各自
exact-Origin 白名单，禁止 wildcard、userinfo、fragment，并且带时区 RFC3339 `expiresAt` 必须在请求
时间和配置 TTL 内。完成回执必须显式提供并绑定 `uploadId`、`objectVersion`、带时区 RFC3339
`scannedAt`、`scanReceiptId`、实际大小、实际摘要及 `clean` 扫描状态；生命周期回执必须明确
`accepted=true`、`status=applied`、动作、`receiptId` 和 `effectiveAt`。不完整、过期、错配、未签名或
签名错误的响应全部失败关闭。应用只验证 provider 的扫描/生命周期 receipt ID，不把这些内部 ID 加入
既有公开 API 响应；非 clean 扫描和上游错误只返回稳定错误码/通用文案，不透传上游正文。

## 配置契约

生产环境必需配置：

- `OBJECT_STORAGE_GATEWAY_URL`、`OBJECT_STORAGE_BUCKET`；
- `OBJECT_STORAGE_SIGNING_SECRET`；
- `OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION=object-storage-gateway-trust-v1`；
- `OBJECT_STORAGE_RECEIPT_SIGNING_SECRET`，至少 32 字符且不得等于请求签名密钥；
- `OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS`、`OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS`，逗号分隔的精确 HTTPS Origin。

可选配置包括 `OBJECT_STORAGE_TOKEN`、`OBJECT_STORAGE_TIMEOUT_MS`、`OBJECT_STORAGE_MAX_BYTES`、
`OBJECT_STORAGE_UPLOAD_TTL_SECONDS`、`OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS` 和
`OBJECT_STORAGE_RESPONSE_MAX_SKEW_SECONDS`。生产网关和签名 URL 必须使用 HTTPS，凭据只能通过密钥
托管或环境注入。非生产环境未声明合同版本时暂保留旧网关迁移路径；一旦显式启用 v1，即执行与生产一致
的响应验签和回执校验。

迁移必须按“网关先双发 v1 响应头和字段 → 非生产显式启用并运行正负合同测试 → 生产注入独立密钥和
Origin 白名单 → 部署应用”执行。回滚只允许恢复旧应用制品并保留网关 v1 输出，不允许在生产关闭验签。
现场 object-storage probe 的 target digest 同时绑定网关地址、bucket、合同版本以及规范化后的上传/下载
Origin；任一信任边界变化都必须重新探测，密钥值不进入 digest 或报告。

## 生产边界

当前完成通用对象存储网关、安全元数据基础和应用侧响应信任合同。真实 S3/OBS/OSS/私有云适配、存储桶
策略、KMS 加密、病毒库更新、DICOM 专项扫描、跨域直传、WORM/对象锁、生命周期任务、备份恢复、容量
压测、数据出境评估和现场验收仍是生产阻断项。附件元数据兼容上限仍为 500 条；达到或超过上限时，
上传授权入口会在调用外部网关前返回 `507 SECURE_ATTACHMENT_METADATA_CAPACITY_EXCEEDED`，不写数据库、
不删除任何既有 immutable/legal-hold 元数据，也不在错误响应中暴露文件名、附件 ID、对象地址或容量
明细。该失败关闭只用于阻止继续静默丢失，不能替代无损分页仓储。外部对象操作与本地元数据写入仍
缺少 outbox/幂等/对账，供应商能力声明与证据也尚未建立，必须在后续独立切片治理。
适配器基础通过不等于真实附件存储已经正式验收。

## 验证

```powershell
npm.cmd run object-storage:readiness
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
