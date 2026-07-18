# 对象存储与附件安全模块

## MVP 范围

本模块为电子病历附件、检验报告、影像索引、互联网护理记录和上线证据包提供统一的安全附件元数据、外部对象存储上传授权、服务端完整性校验、恶意文件扫描、短时下载授权和生命周期控制。

## 运行接口

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

## 配置契约

生产环境需要 `OBJECT_STORAGE_GATEWAY_URL`、`OBJECT_STORAGE_BUCKET`、`OBJECT_STORAGE_SIGNING_SECRET`，可选 `OBJECT_STORAGE_TOKEN`、`OBJECT_STORAGE_TIMEOUT_MS`、`OBJECT_STORAGE_MAX_BYTES` 和 `OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS`。生产网关和签名 URL 必须使用 HTTPS，凭据只能通过密钥托管或环境注入。

## 生产边界

当前完成通用对象存储网关和安全元数据基础。真实 S3/OBS/OSS/私有云适配、存储桶策略、KMS 加密、病毒库更新、DICOM 专项扫描、跨域直传、WORM/对象锁、生命周期任务、备份恢复、容量压测、数据出境评估和现场验收仍是生产阻断项。适配器基础通过不等于真实附件存储已经正式验收。

## 验证

```powershell
npm.cmd run object-storage:readiness
npm.cmd test
npm.cmd run release:report
npm.cmd run deploy:check
```
