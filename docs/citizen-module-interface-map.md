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
| 登录与身份 | `/api/auth/phone-code`, `/api/auth/phone-login`, `/api/auth/me` | `accounts`, `authUsers`, `securityEvents` | 已实现 | 已具备演示短信验证码签发、冷却、有效期、居民会话和安全审计；生产接入真实短信网关、实名核验和风控策略 |
| 消息与待办 | `/api/messages`, `/api/tasks/:id/actions` | `taskMessages`, `service tasks`, `dataAccessLogs` | 已实现 | 接入真实短信、订阅消息、送达回执和审计保全；居民端按确认、取消、评价状态隐藏重复操作按钮 |

服务待办中心仅展示已上线动作，并按订单状态隐藏已确认、已申请取消或已完成评价后的重复按钮；陪诊和护理订单历史仍保留在各自业务页，供居民追溯医院回执、服务安排和质控记录。居民端陪诊预约表单仅在存在已发布服务主体时启用，无已发布服务主体时保留订单追踪但禁止提交新预约。后端创建陪诊订单前会校验 `providerId` 必须存在于 `escortServiceProviders`，无效服务主体返回 `provider not found`，未发布服务主体返回 `provider is not published`，同一居民同一挂号单或同一就诊日期/医院/科室存在开放陪诊预约时返回 `duplicate active escort appointment`，避免居民端生成游离于监管目录之外或重复派单的预约。

## 3. 挂号接口契约

- `GET /api/registrations/dashboard`: 返回可预约号源、居民可见挂号订单、HIS/支付/医保/短信集成摘要。
- `POST /api/registrations/orders`: 居民端提交挂号预约，锁定 `hisScheduleId`，生成 `hisVisitId`、`registrationNo`、`paymentTradeNo`、`insurancePrecheckNo` 和短信/站内信送达记录。
- `POST /api/registrations/orders/:id/cancel`: 居民端或机构端取消预约，释放号源，更新 `scheduleLockStatus`、`paymentStatus`、`refundStatus`，并生成取消通知。

## 4. 发布验证

- 页面证据：`citizen.html?client=app&page=registration#service-registration`
- 导航证据：`citizen.html?page=health-record|emr|nursing|escort|registration` 的服务导航卡展示已实现能力数、当前接口和“待生产化”边界；底部手机导航非当前项显示能力数量，提供 `data-mobile-service-count` 供预览/自动化读取，并在无障碍标签中带出接口和生产边界。
- 手机预览：`mobile-preview.html?client=app`
- 静态测试：`node --test --test-name-pattern "citizen portal exposes resident service tabs" test/static.test.js`
- 陪诊验收：`npm.cmd run escort:readiness`
- API 测试：`node --test --test-name-pattern "supports citizen registration HIS payment insurance and SMS workflow" test/api.test.js`
- 全量验证：`npm.cmd run check`, `npm.cmd test`, `npm.cmd run deploy:check`

## 5. 下一步

挂号接口化已完成。下一步建议进入真实网关联调：医院 HIS/互联网医院号源、支付平台、医保电子凭证、短信服务商分别提供测试环境、签名密钥、幂等号规则和回调样例后，替换当前模拟契约。
