# ADR：切换告警运行时采用显式控制面 Provider 注入

- 状态：Accepted
- 日期：2026-08-20
- Owner：T00
- 影响范围：`pilot-cutover-alert-runtime`、切换告警 worker 组合、组合根依赖方向与架构测试

## Problem

当前 `server.js` 在模块初始化时导入
`src/platform/cutover/pilot-cutover-alert-runtime.js`，以提供告警状态读取和命令执行；
同一运行时的 delivery cycle 在没有传入 `controlProvider` 时，又通过
`require("../../../server").pilotCutoverControlPlaneReadiness()` 反向读取组合根。
实际依赖链为：

```text
server.js
  -> pilot-cutover-alert-runtime.js
  -> server.js.pilotCutoverControlPlaneReadiness
```

仓库内只有 `scripts/platform-cutover-alert-worker.js` 会启动 delivery cycle。该 CLI 把
`runtime.controlProvider` 原样传入；直接执行 `run-once` 时 runtime 默认为空对象，因此会
进入上述反向加载。现有 delivery cycle 测试都显式注入 provider；CLI 的无配置测试在
适配器检查处提前返回，没有覆盖 adapter 已就绪但 provider 未注入的默认路径。

该环不会改变当前公开 HTTP 路径，但会把平台运行时与组合根的加载顺序绑定在一起，增加
CommonJS 部分初始化、测试顺序、独立 worker 启动和模块复用风险。项目接口标准明确禁止
领域或平台模块反向 `require("server.js")`。需要决定如何移除该环，同时保持现有 worker、
公共 readiness 导出、告警报告 schema 和生产默认 `NO-GO` 语义。

## Options

1. **维持现状。** 保留 alert runtime 内的懒加载 fallback，以调用方便换取循环依赖。
2. **显式 Provider 注入。** delivery cycle 只消费调用方提供的
   `controlProvider`；worker CLI 在自己的组合边界注入现有
   `server.pilotCutoverControlPlaneReadiness`。provider 缺失或抛错时使用稳定错误码进入
   既有 fail-closed 控制投影，不再由平台模块寻找组合根。
3. **立即抽取中立控制面模块。** 把 `pilotCutoverControlPlaneReadiness` 及其 trust、ledger
   装配从 `server.js` 移到新的 T00 provider 模块，再由 server 和 worker 共同导入。
4. **使用全局注册表或 setter。** 由组合根启动后注册 provider，运行时从进程全局状态取用。

## Advantages

- **方案 1：** 不改代码和调用方式，短期迁移成本为零。
- **方案 2：** 最小范围内恢复单向依赖；测试可直接替换 provider；worker 继续复用既有控制面
  实现，不创建平行 readiness；无需移动组合根中的 trust、ledger 或环境装配。
- **方案 3：** 组合根进一步瘦身，server 与 worker 都只依赖中立模块，长期边界最清楚。
- **方案 4：** 调用签名可以保持较短，也能避免源码中的直接反向 import。

## Disadvantages

- **方案 1：** 保留已确认的 P1 环，初始化与复用风险继续存在，也违反目标接口标准。
- **方案 2：** worker 组合层仍会加载较大的 `server.js`；直接调用 delivery cycle 的未登记外部
  消费者若依赖隐式 fallback，需要改为显式注入。provider 缺失路径必须定义并测试。
- **方案 3：** 需要同时移动控制面函数、环境读取、trust provider 和错误投影，影响面明显大于
  单一循环；容易把 ARC-002 扩大为 `server.js` 重构。
- **方案 4：** 引入可变全局初始化顺序，测试之间可能泄漏注册状态；多实例或重复初始化语义不清。

## Migration cost

推荐方案 2，成本为低到中：

- 在 alert runtime 中把 `controlProvider` 固化为显式端口，删除对 `server.js` 的反向 require；
- 在 worker CLI 组合边界建立默认 runtime，注入现有
  `pilotCutoverControlPlaneReadiness`，不复制其实现；
- 为 provider 调用次数、缺失、抛错、adapter 提前阻断、CLI 默认装配和敏感字段隔离补测试；
- 增加精确架构回归，禁止该平台模块重新导入组合根；
- 更新依赖地图、模块标签、技术债和当天实施记录。

不需要 schema、数据、journal、API、鉴权、审计或部署迁移，也不增加 npm 依赖。

## Risk

- 若 worker 默认装配遗漏，adapter 已就绪的周期可能只产生 provider-unavailable 控制结果，
  无法读取真实控制面；必须用 CLI 组合测试和非零/NO-GO 断言保护。
- 若把 provider 缺失直接抛到进程顶层，可能改变 worker 既有 metadata-only、可观测的失败行为；
  推荐继续在 delivery cycle 内转成受限错误投影，不泄露 provider 原始错误。
- 仓库搜索只发现 worker 和测试调用 delivery cycle，但无法证明不存在仓库外的 Node 消费者；
  需在发布说明中明确 `controlProvider` 成为必需端口，并保持函数返回 schema 稳定。
- worker 组合层继续加载 `server.js`，启动成本不会因本决策降低；该问题属于 ARC-001/运行时
  上下文瘦身，不应在本切片顺带处理。
- 延迟决策会继续保留唯一已确认的 CommonJS 环。

## Recommendation

推荐方案 2，并设置以下实施约束：

1. `pilot-cutover-alert-runtime.js` 不得直接或动态导入 `server.js`；provider 只能由调用方注入。
2. provider 缺失、非函数或执行失败必须转成稳定、脱敏、默认 `NO-GO` 的控制投影；不得启用
   模拟成功或生产降级开关。
3. worker CLI 是该用例的组合边界，应注入现有
   `pilotCutoverControlPlaneReadiness`；不得复制 ledger、trust 或 readiness 实现。
4. 保持 `runPilotCutoverAlertDeliveryCycle(options)` 导出、worker 的 `status`/`run-once` 命令、
   报告 schema、退出码原则、journal 格式和 `productionReady: false` 边界。
5. 不修改 HTTP method/path、角色权限、数据库、migration、审计语义、systemd 模板或部署拓扑。
6. 测试先行：先让“平台运行时不得加载 server”和“CLI 必须装配 provider”在旧实现下失败，
   再实施最小变更；完成时运行专项、架构、流程、平台迭代和全量标准门禁。
7. 回滚仅回退未来的实现提交；告警 journal 不需回滚。紧急回退会暂时恢复循环依赖，必须登记
   ARC-002 重新开放，不能把回退状态视为目标架构。

本 ADR 已由 T00 于 2026-08-20 按方案 2 批准。批准只授权 `TODAY_PLAN.md` 明示的测试保护、
最小 provider 注入和事实文档同步；不授权扩大到 `server.js` 重构或其他技术债。Accepted
不代表自动完成；本决策已按下述实施状态通过测试、review、PR 与 main CI，并关闭 ARC-002。

## Implementation status

方案 2 已在 `process/t00-arc002-provider-decoupling-20260820` 完成，并通过 PR #132 合入
`main@21d8f3c8f659c70e3d4980c3a67c39ca72d1712a`：alert runtime
不再导入组合根，worker CLI 提供懒默认 provider，缺失、无效和异常 provider 均返回受限
错误码并保持 `NO-GO`。报告 schema 标识、HTTP API、鉴权、数据库、migration、journal、
审计语义和部署拓扑未改变；周期报告仅兼容性增加 `controlErrorCode`。

测试先行证据、专项/架构/路由/流程验证、六个标准工程门禁、11 批 `test:all`、Chromium
E2E、部署检查及完整/生产依赖审计均已通过。`API_MAP.md` 与 `DATA_MODEL.md` 因无 API 或
数据变化保持不变。只读 review 未发现 P0/P1；PR required checks、合并后 main CI 与 Pages
均成功，ARC-002 已从技术债台账关闭。
