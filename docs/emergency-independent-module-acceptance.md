# 120 急救生命链独立模块：现场验收与回退门禁

模块标识为 `emergency-life-chain`。它只依赖急救域代码、持久化适配器、身份适配器以及经现场批准的 120 接入；不引用用血、影像或体检模块。

## 现场证据与回执

`emergency-module-gate.js` 中的 `validateSiteEvidenceReceipt` 是只读校验器，不能签署、篡改或替代现场证据。每一份回执必须具有：要求编号、回执编号和引用、接收时间、接收方、外部系统、接受结果、确认短语及与已签署要求完全一致的 SHA-256 证据摘要。

对于 CTI、定位、车载/穿戴设备、医院与区域健康平台，关联接口还必须已通过探测并进入生产就绪；要求本身必须已由不同责任人完成提交和复核。任一条件缺失均返回 `no-go-site-evidence-pending`。

## 120、车载和穿戴设备安全契约

`emergency-device-gateway.js` 导出三个可由总控接入的契约：

| 契约 | 传输与签名 | 时钟窗 | 必填关联字段 |
| --- | --- | --- | --- |
| `120-dispatch-receipt` | mTLS + JWS-ES256 | 180 秒 | 回执、事件、关联号、调度决定 |
| `ambulance-monitor` | mTLS + HMAC-SHA256 | 120 秒 | 设备、信号、计数器、时间 |
| `wearable-sos` | mTLS + HMAC-SHA256 | 120 秒 | 设备、信号、计数器、时间 |

调用方必须将 TLS 终止层实际验证过的证书指纹和签名验证器传给 `validateIntegrationEnvelope`。模块不保存原始证书、私钥或设备密钥；设备注册仅保留密钥库引用和 SHA-256 指纹。

## 院前—院内交接验收

`runHandoverAcceptanceScenario()` 在仅含急救域种子数据的内存状态中执行：居民信息入队、120 派车、车组节点与生命体征、医院接收、到院及电子交接。它检查 `WS/T 621-2018`、调度、车辆轨迹、院前病历、医院接收与交接证据章节均完整。

执行独立冒烟：

```powershell
node scripts/emergency-module-smoke.js
node --test test/emergency-module-gate.test.js test/emergency-device-gateway.test.js
```

冒烟通过仅说明代码侧独立验收场景成立。输出仍会保留真实 `formalGoLiveState`，初始状态必须为 `blocked-until-site-evidence-signed`。

## 回退门禁

`evaluateRollbackGate()` 在以下任一情形输出 `rollback-required`：未关闭的 P0/P1 上线事件、失败观察窗口、死信投递或未关闭的 P0/P1 告警。回退动作是停止新增数字化调度、使用经 120 批准的电话/纸质等降级流程、保全审计证据，并通知调度和医院值班。回退不会取消现实世界中的救护调度。

共享 `server.js` 的路由绑定和实际现场接入由 T00 执行；本模块不修改公共服务端。
