# ADR：Solution A 容器部署采用安全默认值与不可变镜像

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00 平台集成与部署，T08 影像子域协作
- 影响范围：`deploy/solution-a/`、`scripts/solution-a-readiness.js`、部署文档、依赖地图与技术债台账

## Problem

Solution A 的 HAPI FHIR、Orthanc 和 OHIF 使用可变 `latest` 标签；Orthanc DICOM 4242 默认绑定所有宿主接口，认证默认关闭，环境模板还包含可直接复制的用户名和密码占位符。这些默认值使重复部署不可复现，扩大未授权 DICOM/DICOMweb 暴露面，并可能让占位凭据进入生产配置。仓库同时无法执行真实镜像拉取、漏洞扫描、签名验证或现场网络验收，因此不能用静态测试伪造生产证据。

## Options

### Option 1：维持试点默认值，仅在生产手册中提示加固

继续使用 `latest`、宿主 DICOM 端口和默认关闭认证，把风险交由现场人员处理。

### Option 2：仅固定精确版本 tag

将镜像改为 `repository:version`，但不绑定 digest；认证和网络保持现状。

### Option 3：版本加 digest、回环绑定、默认认证与生产失败关闭

所有镜像使用经官方 release/tag 与 registry 元数据核验的 `repository:tag@sha256:digest`；Orthanc DICOM 默认绑定回环，只允许显式的回环或私网接口配置；认证默认启用。readiness 同时校验仓库合同与生产配置，占位凭据、未审核镜像覆盖、认证关闭、通配或公网绑定均不满足生产配置。真实拉取/扫描和现场网络验收继续作为外部 `NO-GO`。

## Advantages

- 部署默认值可复现，tag 被覆盖时 digest 仍锁定审核内容。
- 管理端口和 DICOM 默认不对宿主外部网络开放，减少误部署攻击面。
- 认证默认开启，复制环境模板不会静默进入匿名模式。
- 静态合同、环境模板和负向测试共同阻止 `latest`、占位凭据及不安全绑定回流。
- 明确区分仓库配置就绪与真实生产证据，避免错误关闭上线门禁。

## Disadvantages

- 镜像升级必须人工核验 release/tag 与 registry digest，并同步多处合同。
- digest 可能受镜像重发、多架构 manifest 或 registry 生命周期影响，升级和回滚成本高于可变 tag。
- DICOM 设备不能依赖默认宿主暴露；现场必须明确选择私网接口并配置防火墙。
- HAPI FHIR starter 本身不提供完整生产身份安全与企业级审计，固定镜像不能解决其产品化能力缺口。

## Migration cost

中等。需要更新 Compose 与环境模板、增强 readiness 和负向测试、同步部署文档及地图。既有试点若显式设置 `ORTHANC_AUTHENTICATION_ENABLED=false`、使用默认用户名或依赖 `0.0.0.0:4242`，必须先配置账户、私网接口和设备白名单；数据卷无需迁移。

## Risk

- registry digest 若核验对象与目标架构不一致，真实拉取可能失败；必须在目标环境重新拉取并记录 manifest、平台架构和扫描结果。
- 非回环私网地址只是候选配置，不证明网络分段、TLS、设备来源或防火墙已合规。
- 认证启用后，OHIF/DICOMweb 代理和现场设备凭据若未同步会导致可用性中断。
- 静态环境门禁无法证明密钥已进入 Vault/KMS、已轮换或未泄漏。
- 本决策不解除真实镜像供应链、漏洞、备份恢复、性能、容灾和现场审批阻断。

## Recommendation

接受 Option 3。2026-08-22 审核基线为 HAPI FHIR `v8.10.0-3`、PostgreSQL `16.4-alpine`、Orthanc `26.8.1`、OHIF `v3.12.11`，并使用 `scripts/solution-a-readiness.js` 中记录的完整 registry digest 与官方来源。镜像更新只能通过新的审核变更完成，不允许环境侧用 `latest` 或其他引用绕过策略。

Orthanc DICOM 默认 `127.0.0.1`；只有现场网络方案已获批时才配置 RFC1918 私网接口，禁止通配和公网绑定。认证默认 `true`；生产用户名不得为 `orthanc`、`admin` 或 `root`，数据库和 Orthanc 密码必须是至少 24 个字符的非占位值。

仓库专项门禁通过只表示安全默认合同成立。生产候选必须运行 `node scripts/solution-a-readiness.js --production`；真实镜像拉取、SBOM/漏洞扫描/签名、registry 可用性、TLS、网络白名单、设备连通、备份恢复和现场审批未形成受控证据前，该命令非零退出且 Solution A 生产状态保持 `NO-GO`。
