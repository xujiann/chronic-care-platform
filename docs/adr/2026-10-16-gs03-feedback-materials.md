# 反馈业务受控材料离线核验

- 状态：Accepted
- 日期：2026-10-16；决策：ADR-GS03-FEEDBACK-MATERIALS-001；任务：GOV-044；Owner：T00。
- 用户批准 USER-FEEDBACK-MATERIALS-OFFLINE-2026-10-16 仅覆盖材料索引格式、版本和摘要格式、跨组引用、缺失检查及负向测试。专业签署由用户协调，正式业务实现、推送、合并和上线另行批准。

## Problem

S01至S09可填写表单已经形成，材料仍须由真实有权责任方填写。GOV031现有六区段工具固定feedback/schedule/report三合同，不能为反馈业务虚填其他合同或把格式齐备当作专业接受。本片仅为反馈材料索引提供独立非生产格式，未收到材料不解释为外部不存在。

## Options

1. 继续只用人工表单，跨组引用和版本漏项容易遗漏。
2. 新增独立反馈材料索引和离线校验，复用GOV031有界只读JSON读取函数，保留旧输入及判定语义。
3. 改三合同校验器或接入签署验真和正式审批，超出授权。

## Recommendation

采用方案2。仅新增 scripts/gs03-feedback-materials.js、config/gs03-feedback-materials.example.json 和专项测试。旧 gs03-admission.js 只加法导出 readInput，不改三合同规则、CLI退出语义或旧模板。本片是B类治理工具增量，不新增业务模型、权威、服务或依赖。

输入 gs03-feedback-materials-input.v1，environment仅development/test，scope固定feedback-only。baseline含commit、contractRef、contractSha256。groups必须恰含S01至S09，每项包含id、decisionVersion、ownerAuthorizationRef、signoffRef、materialIds、dependsOn。每组至少关联一份本组材料，dependsOn只表示用户提交的依赖，不自动推断业务政策。

materials每条包含recordId、groupId、nameRef、version、ownerAuthorizationRef、controlledRef、digestObjectRef、sha256、signoffRef、accessRef、scopeRef、validityRef、submissionRef、dependencyIds。对应既有提交表的材料记录/名称版本、责任授权、稳定引用、摘要对象、摘要、签认、调阅、适用范围、有效条件、依赖和提交记录。人员、批准参数、有效期和签署原件均只用受控引用，不在Git中填写真实值。所有空模板字段保持null或空列表。

引用仅作有界不透明格式检查，不打开引用目标、不联网、不加载签署原件、不计算材料原文摘要、不校验签署权限或业务决定真伪。SHA-256仅校验64位小写十六进制且非全零，commit仅校验40位小写十六进制且非全零，均不证明内容匹配、来源或批准。索引ID唯一，拒绝未知字段、占位值、非普通数据属性、重复/悬空/跨组错属引用、自依赖和循环依赖；依赖涉及另一组时要求声明该组依赖。格式上限仅用于工具资源约束，不是生产批准参数。

输出固定schema、metadataComplete、稳定字段路径及错误码；professionalSignaturesVerified、materialContentVerified、admissionAllowed、runtimeImplementationAuthorized、productionReady恒false，productionDecision恒NO-GO。不得输出输入值、真实人员、引用字符串、异常栈或文件路径。metadataComplete只表示格式和索引关系齐备，不代表有效签署、专业接受或架构准入。

## Interface

纯函数 validateFeedbackMaterials(input) 不修改输入；只接受普通或null原型的JSON数据形状，不执行访问器。CLI显式运行 node scripts/gs03-feedback-materials.js --input <json-file>，无参数读取pending空模板。单文件最多64KiB，沿用GOV031普通文件/符号链接/UTF8检查，不写文件。重复JSON键沿用JSON.parse最后键语义，绝不用于签名字节或审批验真。CLI不提供approve/apply/enable；退出0仅格式齐备，1格式缺失或不合法，2错参或输入不可读。

## Advantages

沿用受控引用、版本、摘要和人工核验边界；反馈索引不伪造排期或报告材料，旧工具行为可由原专项保护。

## Disadvantages

索引内容可能虚假、过期或权限不足，算法不能发现真实政策矛盾。人工仍须核对来源、签署权限、有效条件、材料内容及跨组业务一致性。工具不宣称真实材料已核。

## Migration cost

无API、数据库、schema、运行时、部署、依赖包或CI拓扑变化。回滚只撤GOV044工具、模板、测试及治理增量，保留所有原业务、签署和证据，不改旧工具语义。

## Risk

格式完整可能被误解为批准。通过恒false投影、伪造批准字段拒绝、零回显和独立审查约束。OPS059候选整条、S01至S09待签、三父CALLBACK/STORAGE/S2 Proposed、GS03未建设及六域NO-GO保持。原未决不销项，不提供默认算法、天数、容量、时钟容差、RPO或RTO。

## PLAN

基线origin/main@f5fb989000fbb6695e533079d5c6b665bd058e8c，主线CI38835820511成功，当前无开放PR。T00在process/t00-feedback-material-index-20261016独立工作树唯一写登记范围，WIP2增3，其他任务不变。先登记并建立失败专项，再实现最小补丁，独审无P0至P2后冻结精确SHA/tree，串行18项门禁，保留失败及环境跳过。独审只读，不并行修改。冻结及证据复审后仅待集成，不创建PR或推送合并上线。

验收涵盖每字段缺失/错型/占位、版本与摘要格式、所有组完整性、唯一性/错属/孤立/悬空/循环依赖、访问器零调用及输入不变、CLI坏参/坏JSON/非UTF8/文件界限/链接、恒拒绝授权与零回显，原GOV031专项不变。正式业务与生产测试本轮不执行；离线工具不承担运行能力观测，保留后续专业核验和正式准入。
