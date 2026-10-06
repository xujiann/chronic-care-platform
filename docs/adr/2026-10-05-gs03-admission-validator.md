# GS03 离线准入资料校验

- 状态：Accepted
- 日期：2026-10-05；决策：ADR-GS03-ADMISSION-001；任务：GOV-031；Owner：T00。
- 批准 USER-GS03-ADMISSION-VALIDATOR-2026-10-05 仅覆盖独立非生产校验与负向测试，不含推送、合并、上线；父 CALLBACK/STORAGE/S2 ADR 继续 Proposed。

## Problem

隔离实验不证明正式协议、Owner、身份绑定、共同事务和留存恢复已确定。缺项和待定不能变成准入凭证。

## Options

1. 人工清单，容易漏项。
2. 独立离线只读资料校验，不授予权限。
3. 运行时或审批验真接线；不在本片范围。

## Recommendation

采用方案2。复用 scripts 治理组织和 lifecycle 登记，不扩展对象存储专属规则，不新建 Owner 或签名权威。工具 scripts/gs03-admission.js、专项 test/gs03-admission.test.js、空模板 config/gs03-admission.example.json。

输入 gs03-admission-input.v1；environment 仅 development/test。六区段 owners、identity、protocol、transaction、retention、recovery 均需 status=documented 和全部字段。documented 只表示资料已填，不表示已审批。引用只验证有界格式，不读取其目标、不联网、不执行内容、不验证真伪/时效/签署/政策语义。字段涵盖审批责任、主体绑定、三合同版本/规范化/签名/最小回执、全部写者/事务责任/外部scope围栏、留存天数/到期/隐私/容量、RPO/RTO/恢复世代/对账；无生产默认数值。

缺失/null/空白/待定/TBD/pending/unknown、错型、未知字段、非整数/非法范围均阻断；合同必须恰为 feedback/schedule/report，无重复。输出只含固定字段路径及稳定错误码，禁止输入回显、异常栈和文件路径。documentationComplete/eligibleForManualReview 仅资料格式齐备；admissionAllowed/runtimeImplementationAuthorized/productionReady 永远 false，productionDecision 永远 NO-GO。正式实施仍须父ADR接受、Owner核验和另批切片。

CLI 默认只读pending模板，或 node scripts/gs03-admission.js --input <json-file>。单文件最多64 KiB，拒绝符号链接和非普通文件，不写文件、不联网、不导入server/HTTP/存储。退出0仅资料齐备，1缺项/不合法，2错参/文件/JSON失败，均不放行。重复JSON键按JSON.parse最后键规则；不能用此工具作签名字节或审批验真。

## Advantages

独立可测试、无运行时副作用；资料齐备与批准分离。

## Disadvantages

合法引用也可能虚假、过期或业务矛盾；不证明Owner签字、不替代生产准入。

## Migration cost

无API、数据库、依赖或CI拓扑变化。回滚仅撤本片文件和治理增量，不动数据与父ADR。

## Risk

防止资料齐备被误作批准：固定false输出及伪造放行负测，不提供enable/approve/apply。真实业务输入继续待定。

## PLAN

T00唯一写工具、模板、专项、lifecycle、文档清单、路线图、索引及六图；WIP2增3。先登记后实现；测每字段缺失/待定/错型、合同漂移、数字边界、CLI错参/坏JSON/大文件/链接、不回显/零写。独审后冻结串行重型门禁，未执行如实保留；不推送合并，不接HTTP/现库/生产。
