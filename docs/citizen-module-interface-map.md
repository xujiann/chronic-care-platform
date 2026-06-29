# C端居民端模块接口说明

## 1. 范围

本文说明居民端与平台各业务模块的接口关系，供小程序、APP、PWA 试运行和现场接口联调使用。当前居民端已经形成演示闭环，生产上线时仍需按模块替换真实外部系统。

## 2. 接口关系

| C端模块 | 当前接口 | 数据集合 | 当前状态 | 生产边界 |
| --- | --- | --- | --- | --- |
| 健康档案 | `/api/state`, `/api/personal-records` | `residents`, `accounts`, `diseases`, `followups`, `personalRecords` | 已实现 | 接入主索引、基层公卫、居民实名关系核验 |
| 电子病历 | `/api/personal-records` | `personalRecords.emr`, `labs`, `medications`, `imaging`, `attachments` | 已实现 | 接入 EMR/LIS/PACS、影像和文档存储授权 |
| 护理 | `/api/internet-nursing/dashboard`, `/api/internet-nursing/orders` | `internetNursingOrders`, `internetNursingNurses`, `taskMessages` | 已实现 | 补齐护士资质、电子签名、定位轨迹和质控监管 |
| 陪诊 | `/api/escort-services/dashboard`, `/api/escort-services/orders`, `/api/messages` | `escortServiceOrders`, `escortServiceProviders`, `escortWorkers`, `taskMessages` | 已实现 | 对接医院接诊回执、保险保障和服务主体监管 |
| 挂号 | 居民端本地挂号状态，后续对接 HIS/互联网医院号源 | `citizenExtra.registrations`, `registrationSchedules` | 演示闭环 | 接入号源池、支付、退号、医保电子凭证和短信通知 |
| 消息与待办 | `/api/messages`, `/api/tasks/:id/actions` | `taskMessages`, `service tasks`, `dataAccessLogs` | 已实现 | 接入真实短信、订阅消息、送达回执和审计保全 |

## 3. 发布验证

- 页面证据：`citizen.html?client=app&page=registration#service-registration`
- 手机预览：`mobile-preview.html?client=app`
- 静态测试：`node --test --test-name-pattern "citizen portal exposes PWA install|citizen portal exposes resident service tabs" test/static.test.js`
- 全量语法检查：`npm.cmd run check`

## 4. 下一步

优先把挂号接口从演示号源替换为医院 HIS/互联网医院号源池，并增加支付、退号、医保电子凭证和短信通知的 API 契约测试。
