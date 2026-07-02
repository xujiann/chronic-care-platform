# 真实上线现场补齐工作材料清单

本文档用于把当前系统从演示/试点能力推进到真实生产上线时，现场必须补齐的材料、责任方、验收口径和归档位置统一到一个清单中。清单与 `docs/production-go-live-requirements.md`、`docs/citizen-production-launch-requirements.md`、`release/site-readiness-pack.md`、`release/production-cutover-checklist.md` 配套使用。

## 使用方式

1. 项目办在 T-7 前冻结上线范围，逐项确认材料责任方。
2. 现场实施方按本清单收集原始材料、截图、样例报文、签字页和演练记录。
3. 发布经理执行 `npm.cmd run site:pack`、`npm.cmd run release:report`、`npm.cmd run deploy:check` 和 `npm.cmd run launch:smoke`。
4. 委端统一工作台通过 `POST /api/site-launch-evidence` 登记身份源、接口联调、监控值守和生产签字证据，形成 `siteLaunchEvidence` 运行台账。
5. 任何 P0 材料缺失时，不进入正式生产切换；可降级为白名单试点、只读试运行或继续联调。

## 材料总表

| 编号 | 材料域 | 必备材料 | 验收口径 | 责任方 | 归档位置 |
| --- | --- | --- | --- | --- | --- |
| GLM-01 | 生产环境与域名 | 生产域名、HTTPS 证书、反向代理、Node.js 运行参数、进程守护、日志目录权限 | `/api/health` 在线返回 200；`launch:smoke -- --base-url=<生产地址>` 通过 | 运维团队 | `release/launch-smoke-report.md`、部署变更单 |
| GLM-02 | 生产密钥与环境变量 | `.env`、`NODE_ENV=production`、`SESSION_SECRETS`、`INTEGRATION_GATEWAY_SECRET`、密钥交接记录 | `env:check:production` 无阻断；密钥不使用占位值 | 安全团队/运维团队 | 密钥交接单、`release/environment-matrix-report.md` |
| GLM-03 | 统一身份与居民实名 | OIDC/SAML 元数据、回调地址、样例 claims、角色/机构映射、居民实名核验规则 | `identity:contract` 与现场身份源字段一致；登录、登出、token 刷新可追踪 | 身份平台/项目办 | `release/identity-contract.md`、身份联调记录 |
| GLM-04 | 居民验证码短信 | `SMS_GATEWAY_URL`、短信模板、签名、发送回执、失败重试规则、频控规则 | 手机号验证码登录可在生产网关真实发送；失败锁定和审计可复核 | 短信网关/移动端团队 | 短信发送记录、居民端验收截图 |
| GLM-05 | HIS/EMR/LIS/PACS 接口 | 字段字典、样例请求/响应、签名日志、幂等键、失败重试、接收端确认 | 健康档案、电子病历、检查检验、影像索引只读查询闭环通过 | 医院信息科 | `release/interface-mapping-report.md`、接口联调单 |
| GLM-06 | 护理/陪诊/挂号服务接口 | 服务目录、人员资质、派单规则、号源锁定、取消/评价、消息通知、院内回执 | 护理、陪诊、挂号从居民提交到机构处理、消息回执、质控评价可闭环 | 业务主管部门/服务机构 | 专项联调记录、订单回执截图 |
| GLM-07 | 医保/支付/电子证照 | 医保预核验、支付回调、退款规则、出生证/死亡证/执业证照授权文件 | 交易样例、失败重试、回执和人工补偿流程均有证据 | 医保/证照接口方 | 医保联调单、证照授权文件 |
| GLM-08 | 生产数据库与数据迁移 | 数据库选型、初始化脚本、迁移记录、备份策略、恢复演练、RTO/RPO | 生产主存储不使用演示 JSON；恢复演练有签字结论 | 数据平台/DBA | `release/production-db-readiness-report.md`、恢复演练记录 |
| GLM-09 | 安全合规与隐私 | 等保、密评、漏洞扫描、权限穿透测试、隐私政策、数据最小化规则 | 高危问题清零或有书面豁免；居民授权、撤权、审计留痕可复核 | 安全团队/法务 | 测评报告、整改闭环台账 |
| GLM-10 | 监控告警与值守 | Prometheus/OpenTelemetry 或日志平台绑定、SLO 阈值、告警规则、on-call 表 | `/api/metrics` 可采集；慢请求、错误率、死信、数据质量告警可触达 | 运维团队 | `release/monitoring-readiness-report.md`、值班表 |
| GLM-11 | 灾备与回滚 | 备份副本、回滚脚本、只读降级策略、应急联系人、灾备演练记录 | 至少完成一次恢复演练；回滚窗口和责任人明确 | 运维团队/项目办 | 灾备演练记录、回滚确认单 |
| GLM-12 | 上线签字与灰度方案 | 上线范围、白名单、问题清零表、风险豁免、业务/技术/安全/现场签字 | 无 P0/P1 阻断后方可扩大居民范围；签字材料归档 | 项目办/业务方 | `release/production-cutover-checklist.md`、签字页 |

## 居民端专项材料

| 编号 | 材料 | 验收重点 |
| --- | --- | --- |
| CIT-01 | 小程序备案、APP 签名、PWA 域名和隐私协议 | 三种运行形态入口一致，隐私政策可访问，版本可回退 |
| CIT-02 | 手机号验证码模板和网关回执 | 发送、冷却、锁定、失败提示、审计记录完整 |
| CIT-03 | 健康档案和电子病历授权材料 | 居民本人和家庭成员授权范围清晰，撤权后立即生效 |
| CIT-04 | 护理、陪诊、挂号试点白名单 | 白名单居民、机构、服务人员、号源范围可控 |
| CIT-05 | 消息通知和待办回执 | 站内信、短信、APP 推送至少一种生产通道可用 |
| CIT-06 | 适老化和移动端验收截图 | 44px 触控区、底部导航、二级页面返回、弱网提示通过 |

## 发布阻断条件

- 没有生产身份源、短信网关或居民实名核验材料。
- HIS/EMR/LIS/PACS、医保、支付或证照接口没有现场联调记录。
- 生产主存储仍依赖演示 JSON，且没有正式数据库或受控 SQLite 生产部署方案。
- 等保、密评、漏洞扫描、权限测试存在未豁免高危问题。
- `/api/health`、`/api/metrics`、日志、告警、备份恢复、回滚任一核心能力不可用。
- 没有灰度白名单、上线签字、问题清零表和应急值班安排。

## 仓库内验证命令

```powershell
npm.cmd run check
npm.cmd test
npm.cmd run site:pack
npm.cmd run release:report
npm.cmd run deploy:check
npm.cmd run launch:smoke
npm.cmd run launch:smoke -- --base-url=https://your-production-host
```

## 交付物归档建议

- 需求与边界：`docs/production-go-live-requirements.md`、`docs/citizen-production-launch-requirements.md`、本文档。
- 现场模板：`release/site-readiness-pack.md`、`release/templates/*/README.md`。
- 发布结论：`release/release-report.md`、`release/production-cutover-checklist.md`、`release/launch-smoke-report.md`。
- 接口证据：`release/interface-mapping-report.md`、`release/integration-readiness-report.md`、现场样例报文和签名日志。
- 运维证据：`release/environment-matrix-report.md`、`release/monitoring-readiness-report.md`、备份恢复演练记录。
