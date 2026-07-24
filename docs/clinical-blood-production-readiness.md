# 临床用血独立模块生产化基线

模块标识为 `clinical-blood`，支持血液中心与用血机构独立部署。模块不依赖急救、影像或体检模块；运行依赖限定为统一身份、MPI、HIS、LIS、PDA、冷链 IoT 与审计服务。

## 契约与现场证据

- BIS/BTIS 主数据必须携带机构编码、系统类型、代码、名称、版本及生效时间。
- 血袋唯一标识采用 `献血码-成分码-分装序号`，献血码 13 位，成分码 3–8 位，序号 2 位。
- 现场回执必须包含证据引用、SHA-256 摘要、机构、签署人、签署时间、关联 ID 和幂等键。
- 现场回执采用提交人与复核人分离，幂等键重放时必须保持证据摘要一致。
- BIS/BTIS 至少存在一个共享映射代码，同机构、同系统、同代码不得映射为不同名称。
- 冷链设备必须提供校准证书、有效期、告警测试证据，并由不同人员执行和复核。
- 验收覆盖双人配血、床旁四码核对和召回确认/隔离/闭环。
- 独立运行冒烟及回退恢复验证均为上线硬门禁。

## 上线判定

软件完成状态与正式上线状态分离。代码和自动化测试通过仅表示 `software-release-ready`。现场回执、BIS/BTIS 契约、冷链证据、三类业务验收、独立冒烟、回退演练全部签收前，真实 Go-Live 始终为 `blocked-until-site-evidence-signed`（No-Go）。

运行检查：

```powershell
node scripts/blood-clinical-module-readiness.js
node scripts/blood-clinical-smoke.js
```

提供现场证据 JSON 后，可使用 `--evidence=<path>` 重新计算门禁；流水线使用 `--require-go` 时，No-Go 将返回退出码 2。
现场填写可从 `docs/clinical-blood-site-evidence-template.json` 开始，模板中的占位值不能作为生产证据。
