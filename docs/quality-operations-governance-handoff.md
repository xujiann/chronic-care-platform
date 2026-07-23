# 医疗质量、运营调度与药耗监管统一领域核心交接说明

## 1. 本次候选范围

本候选新增 `quality-operations-governance.js`，作为医疗质量整改、床位/人力/设备资源调度、药品耗材监管三个业务域的共享、无外部副作用领域核心。

本次完成：

- 三域统一状态集合和各域合法迁移表；
- 现有质量、运营、药耗源状态到统一状态的显式映射，未知状态返回 `unknown`；
- 委端、医疗机构、医保角色授权和机构范围校验；
- 运营执行动作限定为目标机构办理；
- 命令幂等回执、相同键冲突检测和乐观版本校验；
- 成功与拒绝事件的哈希链审计；
- 14 项首批指标的责任部门、数据负责人、周期、来源字段和阈值定义；
- 跨机构、越权角色、无效迁移、终态重复迁移、幂等冲突和版本冲突负向测试。

本候选不修改现有源应用状态，不写入数据库，不注册 HTTP 路由，不宣称生产 ready。

## 2. 统一状态与源状态边界

统一状态仅用于跨域监管、任务汇总和指标计算：

`detected → triaged → assigned → in_progress → evidence_submitted → under_review → closed`

`under_review → returned → in_progress`

开放状态可以按各域迁移表进入 `escalated`；`closed` 和 `cancelled` 为终态。

接入层必须同时保存：

- `sourceStatus`：源应用原始状态；
- `status`：统一领域状态；
- `sourceVersion`：源应用记录版本或更新时间；
- `version`：统一领域对象乐观锁版本；
- `lastCommandId`：最后一次领域命令幂等键。

不得把未知源状态默认为关闭，不得直接用统一状态覆盖源系统状态。

## 3. T00 公共层接线清单

以下工作需要 T00 在公共文件中完成，本线程未改动相关文件：

1. 在 `server.js` 创建薄适配层，将现有集合转换为统一领域记录：
   - `qualityRectificationOrders`；
   - `resourceDispatchRequests`；
   - `drugConsumableSupervisions`。
2. 在现有写接口调用 `executeGovernanceCommand` 后，再持久化通过的源域更新：
   - 质量整改派发、反馈、复核和升级；
   - 资源调度创建、接收、执行、完成、复核和关闭；
   - 药耗审查、整改证据、医保同步和监管复核。
3. 统一生成并持久化 `auditEvent`，接入 `platformProcessAudit` 或安全审计集合；拒绝事件也必须保留。
4. 为写命令要求 `Idempotency-Key`、演员身份、机构编码和 `expectedVersion`。
5. 将领域错误码映射到 HTTP：
   - `ACTOR_FORBIDDEN`、`INSTITUTION_SCOPE_DENIED` → 403；
   - `RECORD_NOT_FOUND` → 404；
   - `INVALID_TRANSITION`、`DOMAIN_MISMATCH` → 409；
   - `VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT` → 409；
   - `INVALID_COMMAND` → 400。
6. 建议增加只读端点：
   - `GET /api/quality-operations-governance/catalog`；
   - `GET /api/quality-operations-governance/items`；
   - `GET /api/quality-operations-governance/items/:id/audit`。
7. 在 `package.json` 注册专项检查，在 `README.md` 和发布总表登记候选；这些文件归 T00 所有。

## 4. 真实端点与现场证据阻断项

| 阻断项 | 现场依赖 | 必备证据 |
|---|---|---|
| 真实身份与机构范围 | 政务统一身份、医院机构目录、医保经办身份 | 角色映射、机构编码、拒绝访问日志、停用账号验证 |
| 医疗质量接口 | HIS、EMR、LIS、PACS、危急值和病历质控系统 | 真实报文、字段映射、幂等重放、整改附件、科室签收 |
| 运营资源接口 | 住院床位、HR/排班、设备、门急诊、120/转运 | 运行快照、调度接收/到位/关闭回执、跨院责任边界、SLA 记录 |
| 药耗监管接口 | 扫码终端、药房/药库、耗材系统、医保核心、追溯解析 | 追溯码样例、编码版本、审方记录、结算回调、耗材目录与收费项目对账 |
| 幂等与并发 | API 网关、生产数据库、消息重试和死信 | 同键重放、同键异载荷冲突、并发版本冲突、死信人工补偿记录 |
| 审计保全 | 审计库或 SIEM、留存策略、时间同步 | 哈希链校验、导出样例、留存年限、查询权限、时钟同步证明 |
| 告警与升级 | 短信/政务消息/院内消息、值班表 | 超时升级演练、发送回执、值班签收、失败补偿 |
| 灾备与回滚 | 生产数据库、备份介质、异地副本 | RTO/RPO、恢复演练、回滚脚本、演练签字 |

上述证据未完成前，只允许演示、联调或受控试点标识。

## 5. 接入验收标准

- 三个源集合的所有在用状态均能映射到统一状态；新增未知状态会被阻断或进入人工映射队列。
- 医疗机构账号不能操作其他机构质量或药耗记录。
- 资源调度的执行类命令只能由目标机构或有范围权限的委端办理。
- 同一幂等键和相同载荷只产生一次业务迁移和一次审计事件。
- 同一幂等键更换载荷、终态重复关闭、越权机构、非法跳转和旧版本更新均被拒绝并审计。
- 每项指标均包含责任部门、数据负责人、周期、来源字段和可计算阈值。
- 审计事件哈希链可连续验证，拒绝事件不改变业务记录版本。
- dashboard 仅下钻到源记录，不成为质量整改、资源调度或药耗处置的事实来源。
- T00 公共层接线后，专项测试、相关源域测试和 `git diff --check` 全部通过。

## 6. 本地验证

无需生产账号或外部系统即可运行：

```powershell
node --check quality-operations-governance.js
node --check test/quality-operations-governance.test.js
node --test test/quality-operations-governance.test.js
```

接线后还应回归：

```powershell
node --test test/quality-safety-report.test.js test/hospital-operations-readiness.test.js test/drug-consumable-readiness.test.js test/health-dashboard-summary.test.js
```
