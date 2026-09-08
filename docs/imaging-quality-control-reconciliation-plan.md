# 影像质控结果查看与耐久对账计划

- 日期：2026-09-07
- Owner：T06/影像；T00 负责中央 registry、runtime composition、schema/migration、worker、CI 与部署
- 基线：`origin/main@99bdfb27a4051192bffc828d45d58f5d991e8e44`
- 当前状态：OPS-015 能力已实现但任务受阻；生产继续 `NO-GO`

## 问题与复现证据

现有 `POST /api/imaging-cloud/studies/:id/qc` 已经避免盲重试：FHIR 明确拒绝时允许按错误语义重试；
FHIR 结果未知或外部成功后本地提交失败时，本地不保存质控记录并返回 `reconciliationRequired=true`。
浏览器同时把该检查锁定为“需对账”。

仍存在以下可复现的用户体验与可观测性缺口：

1. `imaging-cloud.js` 的“需对账”按钮只有禁用与重新加载提示，用户不能在当前页面只读查看本地状态。
2. 普通 `loadImagingCloud()` 在 GET 失败时会降级到嵌入式演示数据；恢复核对若复用该结果，会把非权威
   数据误当作当前状态。
3. `projectImagingErrorResponse()` 当前不保留已通过校验的 DiagnosticReport 最小回执；FHIR 成功、
   本地提交失败时，用户只能看到泛化错误，无法知道本页已确认的外部资源标识。
4. 当前 runtime 只有 DiagnosticReport 写端口，没有 DiagnosticReport 外部回读端口。仅凭现有代码无法
   在刷新后证明外部事实，也不能可靠自动关闭对账。

基线行为由 `test/imaging-dashboard-route-characterization.test.js` 证明：外部成功、本地写失败返回 503，
原始 `imageCloudStudies` 与 `imageCloudQualityReviews` 不变；未知结果返回 502 并只允许人工对账；浏览器
锁定第二次提交。`test/t06-imaging-response-security.test.js` 证明公开响应会递归剔除 endpoint、token 与路径。

## 已授权的兼容切片

此切片只增加观察能力与恢复指引，不改变持久化、权威状态机、鉴权、路由顺序或外部副作用：

1. 对外部结果未知的错误返回最小 `reconciliation` 描述：本地未提交、外部未知。
2. 对 FHIR 回执已验证但本地提交失败的错误返回最小 `reconciliation` 描述：检查 ID、
   `DiagnosticReport` 资源 ID、外部已确认、本地未提交。不得返回 endpoint、凭据或原始 provider 内容。
3. 浏览器以内存保存本页恢复上下文；写按钮继续锁定，在旁边增加“查看状态”只读动作。
4. “查看状态”严格调用现有 `GET /api/imaging-cloud`。失败就明确报告无法读取，不使用演示 fallback；
   成功后展示本地 `qcStatus`、FHIR 同步状态、FHIR 资源 ID 和该检查最新质控记录。
5. 观察结果只使用“当前本地快照”“本页外部回执”“相符/不相符/未知”等措辞。即使字段相符，也不作为
   耐久命令已完成的证明；查看后保持锁定，不自动重发、不自动解锁、不写数据库。

### 验收

- FHIR 结果未知：公开响应不包含资源 ID，UI 可查看严格本地快照但仍显示外部未知并保持锁定。
- FHIR 已确认、本地提交失败：公开响应只包含最小回执，UI 同时呈现外部与本地观察并保持锁定。
- 严格 GET 失败：不得使用 fallback，不得声称状态相符或成功。
- 查看状态只发生 GET；未知结果路径不存在第二次 QC POST。
- 明确 provider rejection 仍释放浏览器锁，并保留当前可重试语义。
- 公共投影继续剥离 endpoint、token、路径和嵌套敏感字段。

## 非目标与禁止行为

- 不新增 collection、DDL、migration、outbox、worker、定时任务或第二套状态机。
- 不新增 DiagnosticReport 外部回读端口或修改 T00 runtime composition。
- 不把浏览器内存、错误响应或 dashboard 字段当作耐久对账台账。
- 不根据字段相符自动提交本地状态，不自动调用 QC POST，不把 unknown 改写为 success。
- 不修改 OPS-016 体检或 OPS-017 居民反馈范围。
- 不修改中央 registry、六图、CI、部署、`server.js` 或路由顺序；相应更新建议交 T00。

## 高风险后续

耐久闭环见 Proposed ADR
[`docs/adr/2026-09-07-imaging-quality-control-durable-reconciliation.md`](./adr/2026-09-07-imaging-quality-control-durable-reconciliation.md)。
它需要高风险审批后另开受控切片，不属于本次实现授权。

## 验证与回滚

验证包括 route/public-boundary/browser VM 定向测试、影像专项回归、路由/架构/流程门禁、`npm run check`
与风险相称的完整测试。回滚只需回退本兼容提交；没有数据迁移或后台作业需要撤销。回滚后旧的“需对账”
锁仍保留，但用户将失去当前页面只读查看入口和最小回执提示，生产状态仍为 `NO-GO`。

