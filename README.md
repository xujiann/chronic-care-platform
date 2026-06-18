# 大连卫生健康信息平台 MVP

这是一个面向卫生健康信息化场景的本地演示系统，用于验证卫健委端、医疗机构端、医保端、居民端、县域医共体平台和统一运营工作台之间的数据贯通、业务闭环和审计管理。

系统当前重点覆盖：

- 慢病医防融合：筛查、建档、风险分级、随访、宣教、分级管理、固定取药。
- 全民健康信息：居民主索引、个人健康信息库、标准健康档案、电子病历、检查检验、用药、授权共享。
- 县域医共体：16255 建设模型、医技共享、结果互认、基层 AI 辅诊、协同工单、运营指标。
- 分级诊疗：基层首诊、双向转诊、号源床位预留、医保支付引导、长期处方。
- 卫生统计与证照：卫生统计导入、统计公报、出生医学证明、死亡医学证明。
- 安全审计：统一登录、角色权限、访问日志、安全事件、接口拒绝留痕。

## 启动方式

推荐本地服务模式：

```powershell
cd "C:\Users\drxuj\OneDrive\3.信息化\0.高质量发展 信息化\chronic-care-platform"
npm.cmd run dev
```

打开：

```text
http://localhost:5173/login.html
```

如果只查看静态页面，也可以直接打开 HTML 文件或使用 `open-static.cmd`。静态模式会降级为浏览器本地存储，不能使用后端 API。

## 演示账号

统一密码均为：

```text
123456
```

| 账号 | 入口 | 角色 |
|---|---|---|
| `city` | `workbench.html` | 市级健康城市管理 |
| `district` | `workbench.html` | 区市县管理端 |
| `health` | `index.html` | 卫生健康行政部门 |
| `whjw` | `index.html` | 卫健委端 |
| `hospital` | `institution.html` | 三级医疗机构 |
| `community` | `institution.html` | 基层医疗机构 |
| `doctor` | `institution.html` | 医疗机构端 |
| `doctor_wang` | `institution.html` | 医生账户 |
| `mi` | `insurance.html` | 医保局 |
| `insurance` | `insurance.html` | 医保端 |
| `citizen` | `citizen.html` | 居民端 |
| `county` | `county.html` | 县域医共体平台 |

## 页面入口

| 页面 | 说明 |
|---|---|
| `login.html` | 统一登录入口 |
| `health-city.html` | 健康城市系统总览 |
| `workbench.html` | 统一运营工作台，含全流程审计矩阵 |
| `index.html` | 卫健委端，含慢病、统计、应急、审计等模块 |
| `institution.html` | 医疗机构端，含授权档案、转诊、死亡证明、多点执业 |
| `insurance.html` | 医保端，含审核、控费、凭证核验、固定取药 |
| `citizen.html` | 居民端个人健康信息库 |
| `mobile-preview.html` | 居民端手机预览 |
| `county.html` | 县域医共体平台 |

## 当前已实现功能

### 统一运营工作台

- 系统入口和跨端导航。
- 慢病、医共体申报材料对齐。
- 审计结论、专项缺口推进。
- 全流程审计矩阵，覆盖 11 条业务链路。
- 平台结构图、跨端待办、数据成熟度、继续开发队列。

### 卫健委端

- 监管总览：建档人数、慢病人数、高危人数、随访、控制率。
- 慢病医防整合：筛查任务、精准宣教、分级管理计划、固定取药监管、慢病推进审计。
- 居民档案：新增、编辑、检索、详情、居民 360 总览。
- 慢病登记：高血压、糖尿病、冠心病、脑卒中等示例病种。
- 随访管理：待随访、逾期识别、一键完成。
- 卫生统计：资源报表、服务量、统计导入、统计公报。
- 出生/死亡医学证明统计。
- 公共卫生应急：多点触发预警和处置任务。
- 数据安全审计：访问日志、安全事件、授权记录、拒绝访问。

### 医疗机构端

- 授权健康档案查看。
- 标准健康档案视图。
- 转诊中心与协同任务。
- 固定取药处方确认。
- 死亡医学证明办理。
- 医生档案和多点执业申请。

### 医保端

- 慢病结算审核。
- 医保支付和控费规则。
- 医疗机构监管事项。
- 医保电子凭证核验。
- 固定取药审核。
- 审核访问留痕。

### 居民端

- 个人/家庭成员切换。
- 个人健康信息库。
- 标准健康档案完整度。
- 电子病历、检查检验、用药处方、过敏史、免疫接种、手术住院。
- 慢病管理、筛查宣教、出生人口健康管理。
- 固定取药、分级诊疗服务、健康码凭证。
- 健康资料上传、授权共享、访问透明。
- 手机预览和适老化服务入口。

### 县域医共体平台

- 县乡村一体化组织网络。
- 16255 建设模型。
- 36 项功能清单。
- 六大医疗服务协同中心。
- 协同中心工单、检查检验互认、基层 AI 辅诊运行病例。
- 分级诊疗体系建设。
- 运营监管指标和建设缺口审计。

## 数据与存储

本地服务启动后优先使用：

```text
data/health-city.sqlite
```

同时维护 GitHub Pages 可读的静态快照：

```text
data/db.json
```

核心集合包括：

- `residents`、`accounts`、`personalRecords`
- `diseases`、`followups`、`chronicScreeningTasks`
- `chronicEducationPushes`、`chronicManagementPlans`
- `careOrders`、`medicationPickups`、`insuranceClaims`
- `countyConsortium`、`countyCollaborationOrders`
- `countyMutualRecognitionRecords`、`countyAiDiagnosisCases`
- `referralSystem`、`healthArchiveStandard`
- `deathCertificates`、`birthCertificates`
- `healthStatistics`、`healthStatisticsIngestion`
- `securityEvents`、`dataAccessLogs`
- `platformAudit`、`platformProcessAudit`、`platformRoadmap`

## 后端 API

服务端在 `server.js` 中，当前支持：

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/state`
- `PUT /api/state`
- `POST /api/reset`
- `GET /api/personal-records`
- `POST /api/personal-records`
- `PATCH /api/personal-records/:id`
- `GET /api/death-certificates`
- `POST /api/death-certificates`
- `GET /api/doctors/me`
- `GET /api/multi-practice-applications`
- `POST /api/multi-practice-applications`
- `POST /api/health-statistics/import-jobs`
- `POST /api/workflow-actions`

## 当前边界

这是可运行 MVP，不是生产系统。真实上线仍需：

- 对接政务统一认证、短信/CA/人脸核验。
- 对接正式人口库、电子健康码、医保电子凭证。
- 对接 HIS、EMR、LIS、PACS、医保结算、统计直报、电子证照、公安民政共享。
- 将当前集合级 SQLite/JSON 存储拆分为生产数据库表。
- 完成等保、密评、日志保全、脱敏和容灾。

## 验证命令

```powershell
npm.cmd run check
```

该命令会检查核心 JavaScript 语法。
