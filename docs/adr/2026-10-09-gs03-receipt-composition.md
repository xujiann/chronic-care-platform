# GS03 回执检查修复与组件组合验收

- 状态：Accepted
- 日期：2026-10-09；决策 ADR-GS03-RECEIPT-COMPOSITION-001；任务 GOV-036、OPS-055。
- 范围：按用户继续开发的指示，修复既有已批准回执组件的组合缺陷并增加隔离回归。此前推送与保护合并流程继续适用于该技术修复；用户统一协调、专业事项另签。正式 CALLBACK/STORAGE/S2 决策继续 Proposed。

## Problem

在真实内存事务适配器中调用回执 lookup，会因读取 temp.sqlite_master 创建空 TEMP 库。回执查询虽返回 absent，适配器检查却由仅 main 变为 main 加 temp，导致 unknown/apply，后续 port 无法继续。需要消除检查的连接副作用，同时保留已存在 TEMP 对象和附加数据库的拒绝条件。

真实 migration runner 自身执行逐版本 BEGIN/COMMIT，放入已有适配器事务会产生嵌套事务错误并由异常清理回滚外层事务。适配器没有初始化端口；本片不能私留连接到事务外执行 runner 或自行结束适配器事务。

## Options

1. 放宽适配器允许 TEMP：扩大已批准边界，不采用。
2. 回执组件先读 database_list，仅在 temp 已存在时查询 TEMP 对象：采用。
3. 增加 bootstrap 或正式事务装配入口：属于后续接口决策，本片不实施。

## Contract

生产源码仅修改 src/platform/storage/gs03-receipt-store.js 的 TEMP 检查顺序。无 temp 时不执行 temp.sqlite_master 查询；存在空 temp 时仍按既有回执合同允许，存在任何 TEMP 对象或 main/temp 外数据库时仍拒绝。不改 namespace、selector/record、稳定错误、matched/staged 输出、S1验证或参数化写入语义，不修改内存适配器和结果执行器。

新增测试 helper test/helpers/gs03-receipt-composition.js 与专项 test/gs03-receipt-composition.test.js，并在旧 test/gs03-receipt-store.test.js 增加元数据观察无副作用的回归。A 唯一写源码/helper，B 唯一写两份测试；同一 T08 工作树串行 Git 索引，T00 唯一集成。

helper仅创建测试环境自有内存 session，setup 在适配器拥有的事务内调用既有原生 v15/S1 建表函数。执行调用既有 outcome、memory adapter、receipt store 和真实 appendAuditDeliverySourceChanges。合成目标、两条应用内消息及成功审计事件仅为测试夹具；命名空间、授权 ID 和意图摘要为可信固定测试输入，不提供正式认证、授权检查或 canonical HTTP 协议。

setup 不调用 migration runner，不写 migration ledger、不宣称本组合由完整 runner 初始化。旧真实 runner 迁移专项保持独立且不改；默认注册表仍 v19/41。新 fixture 结构计数不作为正式 schema head。

helper对外仅提供有限合成 execute、只读 snapshot 和 close，不暴露原生连接/路径/SQL或事务控制。内部持有连接只用于封闭只读观察；业务写全部在受控 apply/verify 内。unknown 后保留 session 隔离语义，销毁内存不代表耐久恢复。

## Verification

三合同分别验证首次提交、精确重放无新增、同键异目标/授权/意图冲突无污染；命名空间隔离只证明绑定 SQL 范围。断言 S1 回执与两条真实 v15 source 的 stream/event ID、摘要及合成目标/审计关联，不用 FK 存在或行数替代内容核验。

在目标更新、两条消息、成功安全审计/访问审计及其 source、回执后和 verify 注入错误，比较完整状态、消息、审计链、source与回执快照，保留先前已提交历史。补同目标更新后回滚、历史回执重放，以及缺父引用拒绝。

commit前包装拒绝保守返回 unknown，不将事后 rollback成功冒充 rolled-back；此时可只读观察事实未变和事务结束，不宣称 session 必然隔离。真实 commit后丢响应须确认已提交事实保留，session 隔离且新 port不能再确认。合作port并发租约拒绝，关闭后不能观察。

旧回执专项保持 TEMP trigger/遮蔽、ATTACH、零影响行、FK/schema/事务、严格输入及 Proxy 回归。新增对 main-only 连接查询/插入前后 database_list 不变的断言。不降低任何历史测试、门禁或检查。

## 后续正式接线需要的决定

| 决定 | 待签输入与责任边界 |
|---|---|
| 调用方与协议 | T08/T05核实真实 principal 与账号机构绑定、三合同规范化/签名/最小投影、重试及 legacy 兼容期限。当前不从合成摘要产生正式协议。 |
| 授权与数据责任 | T04/T05及身份、隐私责任人确认确切授权、居民/用途/机构绑定、到期时钟与撤销/续权规则；T00不代签。 |
| 事务与全部写者 | T00与各数据Owner决定唯一权威、同快照读写、授权/案例/档案/全状态/导入恢复旁路及外部scope围栏；任何未封堵写者使新lane保持关闭。 |
| 审计与恢复 | 审计/存储/隐私责任人签本次成功语义、未知提交对账渠道、留存/删除/容量、RPO/RTO与恢复源世代；数值无默认值。 |
| 初始化与迁移 | 独立定义私有bootstrap或正式共同事务装配，重新核schema head、历史兼容、迁移runner与升级/回退；本片直接DDL专项不替代迁移证据。 |

本表为 Proposed 接线输入清单。引用格式校验、技术审查和用户协调不能代替各项签署，不能将父决策改为 Accepted。

## Migration cost

无新依赖、schema或migration注册，不动现库、默认启动、HTTP或部署拓扑。回滚仅撤 TEMP检查修复和新增测试/本片治理，保留所有既有事实与独立迁移专项。

## Risk

测试只证明既有组件的合成组合行为；真实外部身份、当前授权、全写者围栏、业务恢复和专业现场证据仍开放。GS03整体未建设，六域生产NO-GO；既有生产上线授权仍受真实环境和签署门禁约束。

## PLAN

基线main@42a90fee，与PR340冻结8f3b810c同tree d1bf2cbb；PR37756020796/main37757996865各九成功，Pages37757996885成功仅说明公开演示发布。先关闭GOV035/OPS054限定交付，风险保持open，WIP2登记为4。T00写ADR、台账、六图和文档清单，T08按A/B文件所有权实施；独审通过后冻结，串行执行18项必需门禁。按既有授权通过精确CI后保护合并，不绕过生产准入。
