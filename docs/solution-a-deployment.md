# 方案A：FHIR与影像开源组件部署

本增量部署 HAPI FHIR、PostgreSQL、Orthanc 与 OHIF，并通过 `solution-a-connectors.js` 向现有平台提供健康检查和影像调阅地址。它是试点集成环境，不替代医院生产 HIS、EMR 或 PACS。

受控关联会同步FHIR Patient与ImagingStudy；影像质控完成后同步DiagnosticReport，并保持Patient、ImagingStudy、DiagnosticReport引用闭环。医院生产接入的接口矩阵、安全边界和实施计划见[方案A医院系统对接方案](./方案A医院系统对接方案.md)。

## 启动

1. 将 `deploy/solution-a/.env.example` 复制为 `.env`；替换全部凭据占位符，密码至少 24 个字符，且不要提交 `.env`。
2. 运行 `node scripts/solution-a-readiness.js`，确认仓库默认合同通过；生产候选必须运行 `node scripts/solution-a-readiness.js --production`，只要配置或外部证据未齐，该命令即以非零状态失败关闭。
3. 在 `deploy/solution-a` 执行 `docker compose config`，确认生效镜像仍为审核过的 `tag@sha256` 引用、Orthanc 认证为 `true`、DICOM 绑定地址符合现场方案。
4. 仅在获批的试点环境执行 `docker compose up -d`，再调用 `solutionAHealth()` 做在线探测。

默认将管理 Web 端口和 Orthanc DICOM 4242 端口绑定到 `127.0.0.1`，并默认启用 Orthanc 认证。受控设备网络需要显式设置 `ORTHANC_DICOM_BIND_ADDRESS` 为获批的 RFC1918 私网接口地址；禁止使用 `0.0.0.0`、公网地址或未审批的接口。非回环绑定仍须完成现场 TLS、网络分段、防火墙白名单和设备连通验收。

四个镜像均锁定为审核过的精确版本及 registry manifest digest；Compose 默认值与 `.env.example` 必须一致，环境覆盖也必须使用仓库已审核引用。2026-08-22 的版本来源为 [HAPI FHIR JPA Starter](https://github.com/hapifhir/hapi-fhir-jpaserver-starter)、[Orthanc 官方容器文档](https://orthanc.uclouvain.be/book/users/docker-orthancteam.html)、[OHIF v3.12.11 发布](https://github.com/OHIF/Viewers/releases/tag/v3.12.11)及 [PostgreSQL 官方镜像](https://hub.docker.com/_/postgres)；摘要来自对应 Docker Hub registry 元数据核验。该核验不等于真实拉取、签名验证、SBOM 或漏洞扫描。

升级镜像时必须重新核验官方 release/tag 与 registry digest，在同一变更中同步 Compose、`.env.example`、readiness 镜像策略、专项测试和本 ADR 的实施记录；不得只改 tag，也不得回退到 `latest`。当前仓库仍缺真实镜像拉取与漏洞扫描、证书和密钥托管、备份恢复、外部日志审计及现场网络证据，所以 `productionReady` 必须保持 `false`。

## 平台环境变量

`HAPI_FHIR_BASE_URL`、`ORTHANC_BASE_URL`、`ORTHANC_USERNAME`、`ORTHANC_PASSWORD`、`OHIF_BASE_URL`、`SOLUTION_A_TIMEOUT_MS`。

验收：占位凭据、默认用户名、认证关闭、可变/未审核镜像覆盖、通配或公网 DICOM 绑定均在生产配置门禁失败；三个服务健康；FHIR `/metadata` 可达；Orthanc `/system` 鉴权成功；OHIF可加载；测试DICOM进入Orthanc后可通过StudyInstanceUID生成OHIF调阅地址；敏感凭据不写入代码或发布物。

平台接入入口：`GET /api/imaging-cloud/solution-a/health` 返回三项实时探测；`GET /api/imaging-cloud/studies/:id/viewer` 在居民数据权限校验后生成OHIF调阅地址。影像云页面展示实时状态并提供“OHIF调阅”按钮，调阅行为写入数据访问日志。

`GET /api/imaging-cloud/solution-a/studies` 将Orthanc DICOMweb元数据规范化为外部检查摘要。合成数据保留测试身份标记；非合成患者姓名不返回，患者号仅显示末四位。该清单只用于发现与调阅，不能自动关联居民主索引，正式关联必须经过受控映射和人工复核。

`POST /api/imaging-cloud/solution-a/studies/:uid/link` 执行受控居民关联，只有卫健委和医疗机构角色可调用。合成检查可用 `synthetic-test-data` 证据进入演示索引；非合成检查缺少主索引人工复核证据时返回409。接口按StudyInstanceUID幂等写入，并记录关联人、关联时间和数据访问日志。

关联事务会先向HAPI FHIR幂等写入 `Patient` 与 `ImagingStudy`，再保存平台影像索引；FHIR同步失败时返回502且不把本次关联标记为成功。FHIR标识由平台居民ID和StudyInstanceUID的SHA-256摘要生成，不把身份证号用作FHIR资源ID。

## 数据交换验收

运行 `node scripts/solution-a-acceptance.js`。脚本只使用带有 `synthetic-test-data` 标签的合成FHIR患者和 `SOLUTION^A^SYNTHETIC` 合成DICOM对象，执行Patient写入与回读、DICOM入库、Orthanc与DICOMweb检查清单查询、OHIF链接生成及三项服务健康探测，并生成 `release/solution-a-acceptance-report.json`。禁止将真实患者身份信息写入该验收脚本。

合成DICOM由 `synthetic-dicom.js` 生成，为128×128、12位有效灰阶、Explicit VR Little Endian的Secondary Capture影像，包含可见渐变、十字定位线和环形结构。验收还应确认DICOMweb rendered端点返回HTTP 200，以证明对象包含可渲染像素，而不仅是元数据。
