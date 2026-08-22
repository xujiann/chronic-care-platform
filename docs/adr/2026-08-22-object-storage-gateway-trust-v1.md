# ADR：对象存储网关采用版本化响应信任合同 v1

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00（共享 transport/config/readiness）；T08（既有附件 HTTP caller）
- 影响范围：`secure-object-storage.js`、对象存储网关响应、生产环境与发布门禁；不含数据库和公开附件 API

## Problem

现有共享对象存储端口只签名出站请求，入站响应仅依赖 HTTPS 和宽松 JSON 形状：任意 HTTPS
Origin 的上传/下载 URL 可被接受，`expiresAt` 未验证；完成响应缺少对象版本或扫描时间时会由本地补值；
生命周期空响应也可能被视为成功。源码 marker 只能证明函数存在，不能证明响应来自受信网关并绑定当前
请求、对象和动作。平台需要在未选定云厂商、不修改业务 API 或 Schema 的条件下建立默认拒绝、可测试、
可渐进迁移的生产响应信任合同。

## Options

1. 维持 HTTPS、请求 HMAC 和宽松响应解析；
2. 直接接入 S3、OBS、OSS 或私有云 SDK，并分别实现安全校验；
3. 在现有厂商中立网关端口内增加版本化、独立响应签名、请求/对象绑定和 URL 白名单合同 v1；
4. 同时重做网关信任、KMS/WORM、multipart、附件持久化、outbox 和对账。

## Advantages

- 方案 1 无迁移成本；
- 方案 2 可以直接使用已选厂商的专有能力；
- 方案 3 复用现有 adapter，不新增依赖、路由或 Schema，上传和下载信任域可以最小化，响应密钥可独立
  轮换，旧应用可以先忽略网关新增字段后再按受控顺序升级；
- 方案 4 理论上一次覆盖更多生产缺口。

## Disadvantages

- 方案 1 保留响应伪造/错配、任意 Origin、过期 URL 和生命周期失败开放风险；
- 方案 2 在厂商未确定时造成锁定、重复 adapter 和新增 SDK 供应链面；
- 方案 3 要求网关先实现 canonical response signature、回显绑定字段和严格回执，部署顺序错误会导致
  附件操作失败关闭；它仍不证明 KMS、WORM、扫描能力、备份或容量；
- 方案 4 跨越 T00、T08、数据库、migration 和后台工作流，无法作为小步、可回滚切片。

## Migration cost

方案 1 为低但风险不可接受；方案 2 为高；方案 3 为中，需要网关响应头/字段、三项非敏感配置、一个
独立响应密钥、测试和门禁同步，无数据迁移；方案 4 为极高。

## Risk

- 应用先于网关升级会造成附件暂不可用；通过 gateway-first、非生产 opt-in 和合同测试缓解；
- 时钟漂移会误拒绝回执；依赖 NTP 并只允许有界 skew；
- 代理可能剥离签名头；联合测试必须覆盖完整 header；
- CDN/Origin 变更会被白名单拒绝；只能通过受控配置变更，不允许 wildcard；
- 新信任控制可能被误读为生产就绪；所有投影继续固定 `productionReady=false`。

## Recommendation

选择方案 3。使用 `OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION=object-storage-gateway-trust-v1`；生产环境
不允许 legacy 回退。请求继续使用 `OBJECT_STORAGE_SIGNING_SECRET`，响应使用独立且不同的
`OBJECT_STORAGE_RECEIPT_SIGNING_SECRET`。上传与下载分别使用 exact-Origin 白名单；响应签名绑定合同、
operation、HTTP status、timestamp、requestId 和原始 body 摘要，业务字段再绑定 bucket、attachment、
object、version、upload 或 lifecycle action。时间采用带时区 RFC3339；下载和非 quarantine 生命周期动作
要求非空对象版本，quarantine 的空版本也必须由响应精确回显。完成和生命周期必须返回显式、已生效的
严格回执，但 provider receipt ID 只用于校验，不改变现有公开 API 响应形状。现场 probe target digest
绑定合同版本和规范化 Origin，不绑定任何密钥值。响应 body 使用 1 MiB 有界流式读取，超限立即取消，
不得先完整缓冲再校验大小。

迁移顺序为：网关先双发 v1 头与字段，非生产应用启用 v1 并跑负向合同，再部署生产应用和受控配置。
回滚只允许回退旧应用制品并保留网关 v1 输出，不允许在生产关闭验签。KMS/WORM/multipart/扫描能力证明、
备份容量、`secureAttachments.slice(0, 500)` 静默淘汰、请求路径外部调用与本地写入双写均为后续独立
切片；本 ADR 不新增 retry、provider SDK、公开路由、数据库字段或现场证据。
