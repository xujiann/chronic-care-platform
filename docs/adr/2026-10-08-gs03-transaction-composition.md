# GS03 事务组件组合验收

- 状态：Accepted
- 日期：2026-10-08；决策 ADR-GS03-COMPOSITION-001；任务 GOV-034、TEST-028。
- 批准依据：用户批准上一轮提出的事务组件组合验收开发与测试。用户统一协调，专业事项另签；不授权推送、合并或上线。

## Problem

已集成的结果执行器与内存事务适配器已有阶段专项，尚需在多类合成事实的一次事务中组合验收。此片验证组件协作，不新增正式业务命令，不替代既有隔离存储实验或其真实S1/v15验证。

## Options

1. 直接接入正式会诊、授权、回执及HTTP：父决策与专业前置未完成，不采用。
2. 测试目录内组合已有两个组件，以清楚标记的合成状态、消息、审计占位和回执事实检验原子性：采用。
3. 再造事务执行器或复制生产协议：不采用。

## Contract

仅新增test/helpers/gs03-transaction-composition.js与test/gs03-transaction-composition.test.js。helper使用createGs03MemoryTransactionSession及runGs03Transaction，environment显式test，内部库仅:memory:。不修改src、server、路由、默认schema、migration、旧实验或外部依赖。

合成表采用synthetic_前缀，只用于一次性内存测试，不是新生产实体或正式回执权威。合成输入只有命名空间、键、目标和意图；它们不代表认证principal、确切授权或正式canonical协议。唯一合成回执键绑定namespace/key，命中必须比较目标及意图；完全一致零新增事实，异意图/目标失败且不泄露旧值。

首次同一事务更新一条目标状态、两条合成消息、一条明确非真实审计的占位事实及一条合成回执。回执引用与各事实关联须验证，不能只检查行数。审计占位仅用于原子提交测试，不称真实v15 hook、审计链或专业证据；真实平台schema与审计组合仍由既有隔离实验承担。

同步回调只做合成SQL；故障注入为测试专用固定检查点，在状态/各消息/审计占位/回执后以及verify阶段抛错，必须独立比较完整前后快照证明已确认回滚。commit前拒绝与commit后丢响应用测试包装端口触发，unknown不能被解释为零写；隔离后同session新请求不得确认。无自动重试、清除隔离、恢复或跨进程保证。

helper私有保存回调取得的连接仅供测试观察器只读SELECT及检查isTransaction；不向外暴露原生连接、路径或可执行SQL。观察器可读取当前连接可见事实，但事务未结束时不得将其称为持久提交；closed后不得观察。测试可显式close销毁整份内存，不能借此宣称业务恢复。正常请求只使用组件端口，不由helper自行BEGIN/COMMIT/ROLLBACK。

同session并发由组件租约拒绝竞争者；测试确认竞争调用不回滚成功调用，可在前次确定结束后显式同key再验重放，但不实现自动重试。不同session不共享事实，不承诺跨session幂等。

提交前包装拒绝未调用原生commit；runner保守返回unknown，即使后续rollback确认成功。此路径应观察事务已结束和事实未变，但不能声称组件自动隔离session。真正提交后响应丢失须验证已提交事实保留、session隔离及新请求不再确认；不靠helper私设隔离标志代替组件行为。

测试helper接口为异步createGs03CompositionHarness({environment:'test'})，返回execute(command,{fault}可选)、snapshot()、close()及productionReady=false。command仅含namespace、key、target、intent四个合成字符串。fault为固定检查点after-state/after-message-1/after-message-2/after-audit/after-receipt/verify/commit-before/commit-after；snapshot返回按固定顺序排序的cases/messages/audit/receipts完整行及transactionOpen。只读观察不暴露db；close为显式销毁，不实现恢复。

## Advantages and Disadvantages

组合验收能验证真实SQLite对多类合成事实的提交与回滚；不能证明正式授权、外部scope、真实审计、全部写者围栏、长期幂等或持久恢复。固定非生产输出，不晋升GS03黄金场景。

## Migration cost

无正式迁移、数据回填或包变更。回滚仅撤新测试文件及必要治理增量，不触碰现库、旧事实或父Proposed决策。

## Risk

保留内存适配器的可信同步回调边界及未知隔离语义；不是SQL沙箱。合成审计与回执不得写成生产能力；专业签署和生产六域NO-GO不变。若发现既有src缺陷，先报告并确认修复归属，不在测试切片暗中修改生产模块。

## PLAN

基线main@302919c5，PR338冻结b57f44d5与merge同tree1e12e7f9，PR37709583644/main37710600695各9成功；先闭合GOV033/OPS053限定交付并保留开放风险，再登记本两任务，WIP2增4。T00唯一写治理/ADR/六图；T08开发A唯一写helper，开发B唯一写专项，不互改；独立审查只读。

先准入审查并约定helper接口，再实现首次、重放、多目标/意图冲突、命名空间隔离、逐阶段故障完整零写、commit前后未知、隔离拒绝及并发租约验收。专项和独立实现审查通过后冻结，串行18门禁；本轮无推送合并上线。交付精确提交、测试计数及失败修复证据。
