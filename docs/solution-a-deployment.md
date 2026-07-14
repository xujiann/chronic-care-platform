# 方案A：FHIR与影像开源组件部署

本增量部署 HAPI FHIR、PostgreSQL、Orthanc 与 OHIF，并通过 `solution-a-connectors.js` 向现有平台提供健康检查和影像调阅地址。它是试点集成环境，不替代医院生产 HIS、EMR 或 PACS。

## 启动

1. 将 `deploy/solution-a/.env.example` 复制为 `.env`，设置强密码且不要提交。
2. 在 `deploy/solution-a` 执行 `docker compose config`，确认镜像和变量。
3. 执行 `docker compose up -d`。
4. 运行 `node scripts/solution-a-readiness.js`，再调用 `solutionAHealth()` 做在线探测。

默认仅将管理Web端口绑定到本机；DICOM 4242端口供受控设备网络连接。为便于本机试点，`ORTHANC_AUTHENTICATION_ENABLED=false`，OHIF通过内部Nginx代理访问DICOMweb；任何网络共享或生产部署都必须改为统一认证并启用TLS。试点默认使用官方 `latest` 镜像以便首次验证；生产部署必须用已验证版本或镜像摘要锁定镜像，并增加网络白名单、备份恢复、日志审计、镜像漏洞扫描和真实数据合规审批。

## 平台环境变量

`HAPI_FHIR_BASE_URL`、`ORTHANC_BASE_URL`、`ORTHANC_USERNAME`、`ORTHANC_PASSWORD`、`OHIF_BASE_URL`、`SOLUTION_A_TIMEOUT_MS`。

验收：三个服务健康；FHIR `/metadata` 可达；Orthanc `/system` 鉴权成功；OHIF可加载；测试DICOM进入Orthanc后可通过StudyInstanceUID生成OHIF调阅地址；敏感凭据不写入代码或发布物。

平台接入入口：`GET /api/imaging-cloud/solution-a/health` 返回三项实时探测；`GET /api/imaging-cloud/studies/:id/viewer` 在居民数据权限校验后生成OHIF调阅地址。影像云页面展示实时状态并提供“OHIF调阅”按钮，调阅行为写入数据访问日志。

`GET /api/imaging-cloud/solution-a/studies` 将Orthanc DICOMweb元数据规范化为外部检查摘要。合成数据保留测试身份标记；非合成患者姓名不返回，患者号仅显示末四位。该清单只用于发现与调阅，不能自动关联居民主索引，正式关联必须经过受控映射和人工复核。

`POST /api/imaging-cloud/solution-a/studies/:uid/link` 执行受控居民关联，只有卫健委和医疗机构角色可调用。合成检查可用 `synthetic-test-data` 证据进入演示索引；非合成检查缺少主索引人工复核证据时返回409。接口按StudyInstanceUID幂等写入，并记录关联人、关联时间和数据访问日志。

关联事务会先向HAPI FHIR幂等写入 `Patient` 与 `ImagingStudy`，再保存平台影像索引；FHIR同步失败时返回502且不把本次关联标记为成功。FHIR标识由平台居民ID和StudyInstanceUID的SHA-256摘要生成，不把身份证号用作FHIR资源ID。

## 数据交换验收

运行 `node scripts/solution-a-acceptance.js`。脚本只使用带有 `synthetic-test-data` 标签的合成FHIR患者和 `SOLUTION^A^SYNTHETIC` 合成DICOM对象，执行Patient写入与回读、DICOM入库、Orthanc与DICOMweb检查清单查询、OHIF链接生成及三项服务健康探测，并生成 `release/solution-a-acceptance-report.json`。禁止将真实患者身份信息写入该验收脚本。

合成DICOM由 `synthetic-dicom.js` 生成，为128×128、12位有效灰阶、Explicit VR Little Endian的Secondary Capture影像，包含可见渐变、十字定位线和环形结构。验收还应确认DICOMweb rendered端点返回HTTP 200，以证明对象包含可渲染像素，而不仅是元数据。
