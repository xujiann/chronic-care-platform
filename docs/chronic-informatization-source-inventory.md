# 慢病信息化相关文件梳理与开发追溯

本清单用于把 OneDrive 工作区中的慢病政策、规划、建设方案、外地案例、监测研究和系统设计文件，转化为平台内可持续检查的开发依据。脚本 `npm.cmd run chronic:informatization-sources` 会优先扫描本机 `../慢病` 原始资料夹；在 CI 或发布环境没有原始资料夹时，使用本文件中的清单作为可审计基线。

## 文件目录

| ID | 文件 | 分类 | 原始路径 | 对应能力 |
| --- | --- | --- | --- | --- |
| src-policy-2012 | 2012慢性病监测信息系统基本功能规范.pdf | policy-standards, monitoring-research | ../慢病/2012慢性病监测信息系统基本功能规范.pdf | monitoring-quality-public-health, screening-tiered-management |
| src-policy-2014 | 2014 规范.pdf | policy-standards | ../慢病/2014 规范.pdf | screening-tiered-management, followup-resident-feedback |
| src-policy-demo-zone | 国家慢性病综合防控示范区建设指标体系（2020版）责任分工.docx | policy-standards, monitoring-research | ../慢病/国家慢性病综合防控示范区建设指标体系（2020版）责任分工.docx | monitoring-quality-public-health |
| src-policy-opinion | 慢病意见.docx | policy-standards | ../慢病/慢病意见.docx | screening-tiered-management, medication-insurance-pharmacy |
| src-policy-primary-chronic-2025 | 关于加强基层慢性病健康管理服务的指导意见（国卫基层发〔2025〕15号）.docx | policy-standards | ../../../2.工作/基层卫生/基层慢性病/关于加强基层慢性病健康管理服务的指导意见（国卫基层发〔2025〕15号））.docx | screening-tiered-management, followup-resident-feedback, institution-integration-launch, monitoring-quality-public-health |
| src-guideline-primary-chronic-capability-2025 | 基层慢性病健康管理服务能力建设指引.pdf | policy-standards, system-design | ../../../2.工作/基层卫生/基层慢性病/基层慢性病健康管理服务能力建设指引.pdf | screening-tiered-management, followup-resident-feedback, institution-integration-launch, monitoring-quality-public-health |
| src-dalian-feasibility | 大连市慢病管理平台可行性研究报告-V1.3.docx | dalian-planning | ../慢病/大连市慢病管理平台可行性研究报告-V1.3.docx | institution-integration-launch, medication-insurance-pharmacy |
| src-dalian-plan | 大连市慢性病管理平台规划方案（初稿）.docx | dalian-planning, system-design | ../慢病/大连市慢性病管理平台规划方案（初稿）.docx | screening-tiered-management, institution-integration-launch |
| src-dalian-network | 大连市医防融合慢病大数据综合管理网络体系2024(2).docx | dalian-planning, system-design | ../慢病/大连市医防融合慢病大数据综合管理网络体系2024(2).docx | institution-integration-launch, monitoring-quality-public-health |
| src-city-plan | 城市慢病管理系统规划方案.docx | system-design | ../慢病/城市慢病管理系统规划方案.docx | screening-tiered-management, followup-resident-feedback |
| src-sanming-1 | 三明三高共管慢病健康管理-建设方案-V1.0.2.doc | sanming-yuxi-case | ../慢病/三明三高共管慢病健康管理-建设方案-V1.0.2.doc | comorbidity-tcm-self-management, medication-insurance-pharmacy |
| src-sanming-2 | 三高共管慢病健康管理-建设方案-V1.0.2.doc | sanming-yuxi-case | ../慢病/三高共管慢病健康管理-建设方案-V1.0.2.doc | comorbidity-tcm-self-management, followup-resident-feedback |
| src-yuxi-doc | 尤溪县总医院慢性病一体化管理信息系统介绍20191031v2.docx | sanming-yuxi-case, system-design | ../慢病/尤溪县总医院慢性病一体化管理信息系统介绍20191031v2.docx | institution-integration-launch, followup-resident-feedback |
| src-yuxi-ppt | 尤溪县总医院慢性病一体化管理信息系统介绍20191031v2.pptx | sanming-yuxi-case, system-design | ../慢病/尤溪县总医院慢性病一体化管理信息系统介绍20191031v2.pptx | institution-integration-launch |
| src-zhejiang-monitor | 浙江省慢性病综合监测系统构建及应用研究.pdf | monitoring-research | ../慢病/浙江省慢性病综合监测系统构建及应用研究.pdf | monitoring-quality-public-health |
| src-zhejiang-news | 浙江省慢性病防制工作动态.pdf | monitoring-research | ../慢病/浙江省慢性病防制工作动态.pdf | monitoring-quality-public-health, followup-resident-feedback |
| src-local-diff | 我市慢性病管理信息化平台与三明市慢病管理建设框架存在一定的不同之处.docx | dalian-planning, sanming-yuxi-case | ../慢病/我市慢性病管理信息化平台与三明市慢病管理建设框架存在一定的不同之处.docx | institution-integration-launch, comorbidity-tcm-self-management |
| src-system-structure | 慢性病体系.png | system-design | ../慢病/慢性病体系.png | screening-tiered-management, institution-integration-launch |
| src-platform-doc | 慢病平台.docx | system-design, dalian-planning | ../慢病/慢病平台.docx | screening-tiered-management, followup-resident-feedback |
| src-repo-followup | chronic-followup-readiness.md | repo-evidence | docs/chronic-followup-readiness.md | followup-resident-feedback, monitoring-quality-public-health |
| src-repo-launch | chronic-launch-core.md | repo-evidence | docs/chronic-launch-core.md | institution-integration-launch, medication-insurance-pharmacy |
| src-repo-interface | chronic-institution-interfaces.md | repo-evidence | docs/chronic-institution-interfaces.md | institution-integration-launch |
| src-repo-policy | 政策依据说明.md | repo-evidence, policy-standards | docs/政策依据说明.md | screening-tiered-management, comorbidity-tcm-self-management |
| src-repo-structure | 慢病平台系统结构图与优化建议.md | repo-evidence, system-design | docs/慢病平台系统结构图与优化建议.md | screening-tiered-management, medication-insurance-pharmacy |

## 开发追溯结论

| 能力轨道 | 已落地系统证据 | 下一步现场化风险 |
| --- | --- | --- |
| 筛查、风险分层和分类分级管理 | `chronicScreeningTasks`、`chronicManagementPlans`、`/api/chronic/risk-stratification`、`/api/chronic/followup-summary` | 需要接入真实体检、公卫筛查、家庭医生签约和连续指标。 |
| 随访、居民反馈和外呼督办 | `followups`、`taskMessages`、`personalRecords`、`/api/chronic/followup-feedback`、`/api/chronic/followup-escalations` | 需要现场短信、电话、App 推送回执和机构人员排班。 |
| 多病共管、中医药和自我管理 | `chronicComorbidityPlans`、`chronicTcmServices`、`chronicSelfManagement` | 需要医疗质控专家确认高血压、糖尿病等病种模型和干预路径。 |
| 用药保障、长期处方和医保药房闭环 | `medicationPickups`、`insuranceClaims`、`chronicPharmacyInsuranceLinks`、`/api/chronic/pharmacy-callbacks` | 需要药品目录、库存、医保待遇和结算回调的真实接口。 |
| 机构接口与上线核心联调 | `chronicExternalIntegrations`、`chronicLaunchCoreSignoffs`、`/api/chronic/institution-interfaces`、`/api/chronic/launch-core` | HIS/EMR/LIS/PACS、身份目录、消息渠道和现场签字仍是生产切换前置条件。 |
| 转诊回转、档案回写和基层承接 | `referralSystem`、`referralTeleconsultations`、`personalRecords[category=chronic-referral-continuity]`、`/api/chronic/referral-continuity` | 需以真实转诊中心、上级医院回传、基层承接和居民授权联调证明替换演示证据。 |
| 监测质控和公卫闭环 | `chronicQualityMetrics`、`diseaseRegistryModels`、`/api/chronic/public-health-loop`、`process:audit` | 需要疾控直报、区域监测、质量抽查和真实统计口径验收。 |

## 发布要求

- `chronic:informatization-sources` 生成 `release/chronic-informatization-sources.json` 和 `release/chronic-informatization-sources.md`。
- `chronic:followup-readiness` 必须引用本追溯报告，确保慢病功能不是孤立页面，而是有文件依据、数据对象、API 和发布证据的闭环。
- `release:report` 和 `deploy:check` 应保留该追溯项，作为后续继续开发慢病与医共体功能时的增量入口。
