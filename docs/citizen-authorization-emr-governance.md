# C端授权与病历可信来源治理

## 1. 目标

居民端需要把“能看到数据”和“数据可信、授权可控、访问可复核”分开表达。当前系统已在页面内展示授权状态、病历来源、访问日志和消息回执边界，避免把演示数据误表述为正式生产接入。

## 2. 接口边界

| 治理项 | 当前接口/集合 | 当前能力 | 生产化要求 |
| --- | --- | --- | --- |
| 实名与家庭关系 | `/api/auth/phone-login`, `accounts`, `residents` | 手机号验证码演示登录、家庭成员视图 | 接入真实短信、实名核验、监护人/家庭关系核验 |
| 授权共享与撤销 | `/api/personal-records`, `/api/authorizations/:id/revoke`, `/api/access-reviews`, `personalRecords.authorizations` | 新增授权、撤销授权、居民端状态展示、后端拦截撤销后远程会诊复用、形成安全事件和访问复核入口 | 接入统一审计链、授权凭证签名和现场复核流程 |
| 电子病历来源 | `EMR/LIS/PACS -> /api/personal-records` | 展示病历、检验、用药、影像和附件来源 | 接入院内 EMR/LIS/PACS、对象存储和原文调阅授权 |
| 访问日志复核 | `dataAccessLogs`, `/api/messages` | 居民端展示近期访问记录，管理端可通过 `/api/audit/export` 复核撤销、拒绝和敏感访问 | 接入统一审计链、SIEM 或审计导出路径 |
| 消息触达回执 | `/api/messages`, `/api/tasks/:id/actions` | 居民通知、任务动作和回执提示 | 接入短信、订阅消息、APP 推送和送达回执 |

## 3. 页面证据

- `citizen.html` 展示“授权与病历可信来源”面板。
- `citizen.html?page=health-record` 可查看授权共享、访问日志和健康档案来源。
- `citizen.html?page=emr` 可查看电子病历来源、检查/用药标签和影像附件索引。

## 4. 已闭环能力

- 居民端可新增授权并撤销授权，撤销结果写入 `personalRecords.authorizations`。
- `POST /api/authorizations/:id/revoke` 会写入安全事件和 `dataAccessLogs`。
- `GET /api/access-reviews?residentId=...` 可复核授权记录与访问日志，并按居民范围裁剪。
- 撤销后的授权 ID 不能再用于 `POST /api/referral-teleconsultations` 创建远程会诊，拒绝事件会进入 `/api/audit/export?trail=securityEvents`。

## 5. 下一步

继续为 EMR/LIS/PACS 接入增加字段映射和样例报文校验，并把授权凭证签名、原文调阅授权、SIEM/审计导出路径纳入现场联调证据。
