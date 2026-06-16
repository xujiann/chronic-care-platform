# 健康城市四端协同系统整体流程结构图

## 1. 整体系统结构

```mermaid
flowchart TB
  Login["统一登录与角色授权"] --> Portal["健康城市系统总览"]
  Login --> Citizen["个人端"]
  Login --> Institution["医疗机构端"]
  Login --> Insurance["医保端"]
  Login --> Commission["卫生健康委端"]
  Login --> County["县域医共体平台"]

  Citizen --> PersonIndex["统一个人主索引 personIndex\n身份证号 + 手机号"]
  Institution --> PersonIndex
  Insurance --> PersonIndex
  Commission --> PersonIndex
  County --> PersonIndex

  PersonIndex --> Archive["个人健康信息库\n健康档案、电子病历、检查检验、用药、接种、过敏、住院、授权"]
  Archive --> Standard["健康档案标准模型\n三维架构 + 32类基础数据集"]
  Archive --> Audit["访问审计与授权留痕"]

  Commission --> Resource["医疗资源监管"]
  Commission --> Emergency["公共卫生应急"]
  Commission --> Quality["数据质量与规划对齐"]

  Institution --> CareOrder["转诊、复诊、随访协同任务"]
  Institution --> EMR["电子病历补充与标准档案视图"]
  Institution --> ReferralCenter["分级诊疗转诊中心\n上转、下转、号源床位预留"]

  Insurance --> Claim["慢病结算审核"]
  Insurance --> Supervision["医疗机构监管"]
  Insurance --> PaymentGuide["分级诊疗支付引导\n连续起付线、差异化报销、长期处方"]

  County --> SharedCenters["区域医技共享中心\n影像、心电、检验、病理、会诊、急救、消毒供应"]
  County --> CountyPublicHealth["公共卫生协同\n慢病、老年、妇幼、疫苗、应急"]
  County --> CountyOps["基层综合管理\n人财物、药耗、行政、绩效、医废"]
  County --> ReferralBuild["分级诊疗体系建设\n紧密型医联体、基层首诊、双向转诊"]

  Citizen --> Pickup["每月固定取药申请"]
  Pickup --> Institution
  Pickup --> Insurance
  Pickup --> Commission
```

## 2. 慢病医防整合与固定取药闭环

```mermaid
flowchart LR
  Screening["基层筛查/体检/居民上传"] --> Register["慢病登记"]
  Register --> Risk["风险评估"]
  Risk --> Followup["家庭医生随访"]
  Followup --> Referral["医疗机构复诊/转诊"]
  Referral --> EMR["电子病历与检查检验回流"]
  EMR --> Archive["个人健康信息库更新"]
  Archive --> Pickup["居民每月固定取药"]
  Pickup --> InstitutionReview["医疗机构确认处方和用药"]
  InstitutionReview --> InsuranceReview["医保审核支付范围"]
  InsuranceReview --> Pharmacy["药房取药/家属代取"]
  Pharmacy --> Audit["闭环状态与访问留痕"]
  Audit --> Commission["卫健委监管看板"]
  Audit --> County["县域医共体运营监管"]
```

## 3. 健康档案与电子病历贯通

```mermaid
flowchart TB
  Sources["信息来源"] --> PublicHealth["公共卫生服务记录"]
  Sources --> EMR["门诊/住院电子病历"]
  Sources --> PersonalUpload["居民上传资料"]
  Sources --> InsuranceData["医保结算和取药记录"]

  PublicHealth --> Archive["个人健康信息库"]
  EMR --> Archive
  PersonalUpload --> Archive
  InsuranceData --> Archive

  Archive --> LifeStage["生命阶段"]
  Archive --> Problem["健康和疾病问题"]
  Archive --> Activity["卫生服务活动"]

  LifeStage --> StandardDatasets["32类基础数据集映射"]
  Problem --> StandardDatasets
  Activity --> StandardDatasets

  StandardDatasets --> CitizenView["居民查看：已归集/待补齐"]
  StandardDatasets --> DoctorView["医生查看：授权标准档案视图"]
  StandardDatasets --> GovView["卫健委查看：质量和覆盖率"]
```

## 4. 登录与权限流程

```mermaid
sequenceDiagram
  participant U as 用户
  participant L as 登录页
  participant A as 认证模块
  participant P as 端系统
  participant Log as 审计日志

  U->>L: 选择角色账号并登录
  L->>A: 校验账号、生成会话
  A-->>L: 返回角色、姓名、首页
  L->>P: 跳转到角色端系统
  P->>A: requireRole 校验当前角色
  A-->>P: 允许访问或重定向
  P->>Log: 后续查看健康档案、病历、医保数据时留痕
```

## 5. 登录系统后续生产化方向

- 前端演示账号替换为后端认证接口。
- 密码改为加盐哈希存储，不在前端保存任何明文凭据。
- 增加短信验证码、电子健康码、医保电子凭证、政务统一身份认证。
- 后端签发短期访问令牌和刷新令牌。
- 按角色、机构、居民授权范围做细粒度接口权限。
- 所有健康档案、电子病历、医保数据访问写入 `dataAccessLogs`。
