# C端居民端模块接口说明

## 1. 范围

本文说明居民端与平台各业务模块的接口关系，供小程序、APP、PWA 试运行和现场接口联调用。当前居民端已经形成可操作闭环，生产上线时按模块替换真实外部系统网关。

## 2. 接口关系

| C端模块 | 当前接口 | 数据集合 | 当前状态 | 生产边界 |
| --- | --- | --- | --- | --- |
| 健康档案 | `/api/state`, `/api/personal-records` | `residents`, `accounts`, `diseases`, `followups`, `personalRecords` | 已实现 | 接入主索引、基层公卫、居民实名关系核验 |
| 电子病历 | `/api/personal-records` | `personalRecords.emr`, `labs`, `medications`, `imaging`, `attachments` | 已实现 | 接入 EMR/LIS/PACS、影像和文档存储授权 |
| 全生命周期待办 | `/api/citizen/lifecycle-actions`, `/api/state` | `birthCertificates`, `deathCertificates`, `followups`, `medicationPickups`, `seniorServices`, `personalRecords.authorizations` | 已实现 | 接入真实妇幼、公卫、慢病、老年照护和身后事项经办系统，按居民授权范围裁剪 |
| 护理 | `/api/internet-nursing/dashboard`, `/api/internet-nursing/orders` | `internetNursingOrders`, `internetNursingNurses`, `taskMessages`, `citizenExtra.longTermCareAssessments` | 已实现 | 补齐护士资质、电子签名、定位轨迹、质控监管、长期护理险和民政补贴正式接口 |
| 陪诊 | `/api/escort-services/dashboard`, `/api/escort-services/orders`, `/api/messages` | `escortServiceOrders`, `escortServiceProviders`, `escortWorkers`, `taskMessages` | 已实现 | 对接医院接诊回执、保险保障和服务主体监管 |
| 挂号 | `/api/registrations/dashboard`, `/api/registrations/orders`, `/api/registrations/orders/:id/cancel` | `registrationSchedules`, `registrationOrders`, `taskMessages`, `dataAccessLogs` | 接口闭环 | 替换为医院 HIS/互联网医院号源池、支付平台、医保电子凭证和短信网关 |
| 消息与待办 | `/api/messages`, `/api/tasks/:id/actions` | `taskMessages`, `service tasks`, `dataAccessLogs` | 已实现 | 接入真实短信、订阅消息、送达回执和审计保全 |

## 3. 挂号接口契约

- `GET /api/registrations/dashboard`: 返回可预约号源、居民可见挂号订单、HIS/支付/医保/短信集成摘要。
- `POST /api/registrations/orders`: 居民端提交挂号预约，锁定 `hisScheduleId`，生成 `hisVisitId`、`registrationNo`、`paymentTradeNo`、`insurancePrecheckNo` 和短信/站内信送达记录。
- `POST /api/registrations/orders/:id/cancel`: 居民端或机构端取消预约，释放号源，更新 `scheduleLockStatus`、`paymentStatus`、`refundStatus`，并生成取消通知。

## 4. 发布验证

- 页面证据：`citizen.html?client=app&page=registration#service-registration`
- 手机预览：`mobile-preview.html?client=app`
- 静态测试：`node --test --test-name-pattern "citizen portal exposes resident service tabs" test/static.test.js`
- API 测试：`node --test --test-name-pattern "supports citizen registration HIS payment insurance and SMS workflow" test/api.test.js`
- 全量验证：`npm.cmd run check`, `npm.cmd test`, `npm.cmd run deploy:check`

## 5. 下一步

挂号接口化已完成。下一步建议进入真实网关联调：医院 HIS/互联网医院号源、支付平台、医保电子凭证、短信服务商分别提供测试环境、签名密钥、幂等号规则和回调样例后，替换当前模拟契约。
