# 八应用试点验收控制中心

## 目标

把八个优先应用的集成回归、生产告警预检、P0现场验收、重点接口联调样例、端到端试运行和问题台账放到同一可核验入口中。运行页面位于 `platform.html#pilot-acceptance-center`，实时数据接口为 `GET /api/pilot-acceptance/center`。

## 已实现能力

- 八应用逐项核验前端入口、API路由、自动化测试和发布证据。
- 校验SIEM与Webhook环境变量合同，不回显端点、令牌或签名密钥；正式评审还必须存在生产环境接收回执。
- 将P0-01至P0-10整理为带责任方、目标窗口、材料和完成标准的现场任务包。
- 提供正式分组器、医保核心、HIS/EMR和体检报告四类无患者数据合成样例。
- 提供四类重点接口联调台账，登记成功、失败、重试、对账结果及执行单和接收端回执；四项全部通过后才可提交复核。
- 联调证据必须经过独立复核，复核人与联调登记人必须不同；接收端配置或证据变化后可撤销复核，问题台账会自动重新打开。
- 覆盖登录权限、应用导航、跨模块边界、告警预检、接口重试、证据包和Go/No-Go边界七类试运行场景。
- 将生产告警、现场证据和四类外部接口联调缺口集中形成问题台账。

## 告警配置

复制 `deploy/pilot-alerting.env.template` 到部署环境的秘密配置系统，至少配置一条真实告警路由：

- `SIEM_ENDPOINT` 与 `SIEM_SIGNING_SECRET`
- 或 `ALERT_WEBHOOK_URL` 与 `ALERT_WEBHOOK_SECRET`

生产环境端点必须使用HTTPS。通过 `/api/observability/alerts/dispatch` 完成去标识化测试告警并取得真实接收回执，验证失败重试和值班升级后，才能设置 `CUTOVER_MONITORING_SIGNOFF=true`。只有“接收端配置、生产回执、监控签字”三项同时成立，告警环节才进入正式Go/No-Go评审。

P0现场任务复用 `/api/platform/capability-operations/blockers/:id/actions` 工作流，依次完成整改、证据登记、提交、独立复核和四方现场验收。每项验收需要业务、技术、运维和安全四类签字，证据变化后必须撤销并重新验收。

## 验证命令

```powershell
npm.cmd run pilot:acceptance-readiness
npm.cmd run check
npm.cmd test
npm.cmd run deploy:check
npm.cmd run release:report
```

接口操作通过 `POST /api/pilot-acceptance/interfaces/:id/actions` 完成，支持 `record-joint-test`、`review-joint-test` 和 `revoke-joint-test`。所有写操作仅向卫健委管理角色开放并写入 `securityEvents`，证据编号和复核身份进入 readiness 与 release report。

## 生产边界

控制中心只验证代码合同并生成不含患者数据的合成联调材料。它不会写入真实接收端、传输患者数据、代替医院签字、完成外部机构联合测试，也不会绕过全局Go/No-Go门禁执行生产割接。
