# 八应用试点验收控制中心

## 目标

把八个优先应用的集成回归、生产告警预检、P0现场验收、重点接口联调样例、端到端试运行和问题台账放到同一可核验入口中。运行页面位于 `platform.html#pilot-acceptance-center`，实时数据接口为 `GET /api/pilot-acceptance/center`。

## 已实现能力

- 八应用逐项核验前端入口、API路由、自动化测试和发布证据。
- 校验SIEM与Webhook环境变量合同，不回显端点、令牌或签名密钥。
- 将P0-01至P0-10整理为带责任方、目标窗口、材料和完成标准的现场任务包。
- 提供正式分组器、医保核心、HIS/EMR和体检报告四类无患者数据合成样例。
- 覆盖登录权限、应用导航、跨模块边界、告警预检、接口重试、证据包和Go/No-Go边界七类试运行场景。
- 将生产告警、现场证据和四类外部接口联调缺口集中形成问题台账。

## 告警配置

复制 `deploy/pilot-alerting.env.template` 到部署环境的秘密配置系统，至少配置一条真实告警路由：

- `SIEM_ENDPOINT` 与 `SIEM_SIGNING_SECRET`
- 或 `ALERT_WEBHOOK_URL` 与 `ALERT_WEBHOOK_SECRET`

生产环境端点必须使用HTTPS。完成真实演练回执、值班升级确认和现场签字后，才能设置 `CUTOVER_MONITORING_SIGNOFF=true`。

## 验证命令

```powershell
npm.cmd run pilot:acceptance-readiness
npm.cmd run check
npm.cmd test
npm.cmd run deploy:check
npm.cmd run release:report
```

## 生产边界

控制中心只验证代码合同并生成不含患者数据的合成联调材料。它不会写入真实接收端、传输患者数据、代替医院签字、完成外部机构联合测试，也不会绕过全局Go/No-Go门禁执行生产割接。
