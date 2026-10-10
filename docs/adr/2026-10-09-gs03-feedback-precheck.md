# GS03 非生产反馈协议预检

- 状态：Accepted
- 日期：2026-10-09；决策 ADR-GS03-FEEDBACK-PRECHECK-001；任务 GOV-039、OPS-058。
- 用户批准仅合成协议预检开发和测试；不授权本片推送、合并、上线。父 CALLBACK/STORAGE/S2 保持 Proposed，专业事项另签。

## Problem

已有回调规范和内存事务组件不能证明严格反馈输入或正式摘要算法。本片交付未接线的纯函数，验证候选输入一致性；不宣称修复现有 HTTP 回调或获得专业准入。

## Options

1. 接既有 HTTP、真实身份与 S1：需独立正式决定，不采用。
2. 新建通用 canonical 工具：已有轻量纯 helper，不采用重复实现。
3. T05 新增合成预检，复用 technical-evidence 的 sha256，仅序列化新建 primitive 数组：采用。

## Contract

仅新增 src/care-coordination/gs03-feedback-precheck.js，导出 precheckSyntheticFeedback(options)，不增默认调用方。options 精确自有数据字段 environment、request、target；environment 只允许 development/test。三层对象仅普通 Object.prototype 或 null 原型，拒绝数组、额外字段、symbol、非枚举或访问器属性；不调用输入 getter/toJSON，反射异常和撤销 Proxy 收敛固定错误。不承诺隔离任意恶意 Proxy trap 的副作用。

request 精确字段为 protocol、idempotencyKey、caseId、residentId、authorizationId、externalSystemId、feedbackStatus、occurredAt、summary。protocol 固定 gs03-feedback-synthetic.v1；五个标识字段使用 ASCII [A-Za-z0-9][A-Za-z0-9._:-]{0,127}，不 trim、转换、补默认或大小写折叠。feedbackStatus 仅 accepted/declined/completed；occurredAt 为 0..8640000000000000 的安全整数且拒绝 -0；summary 为 well-formed Unicode 字符串，UTF-8 不超过 1024 字节，拒绝 C0 与 DEL，可为空。不做 Unicode 归一化。这些枚举和上限仅为合成技术夹具，不是正式反馈业务决定。

target 精确自有四字段 caseId、residentId、authorizationId、externalSystemId，遵守同一标识格式，必须与 request 完全相等。它只是调用方显式提供的合成目标，不是当前授权、可信主体、身份认证、外部 scope 或撤权证明。真实数据可被调用方误传，本组件无法判别；禁止在真实路径接线。

摘要投影固定数组顺序：[protocol,idempotencyKey,caseId,residentId,authorizationId,externalSystemId,feedbackStatus,occurredAt,summary]，通过现有 sha256 计算其紧凑 JSON 的 UTF-8 SHA-256，再添加 synthetic: 前缀，结果格式 synthetic:sha256:<64小写hex>。protocol 提供域分隔；环境及字段插入顺序不影响摘要，任何接纳字段变化都影响摘要。无时钟、随机数、签名、日志或状态写入。不得将其剥前缀写为 S1 intent_digest_version=2，也不产生正式 idempotency namespace 或凭据。

返回冻结对象：接纳 {status:'accepted',code:'GS03_SYNTHETIC_PRECHECK_ACCEPTED',syntheticIntentDigest,productionReady:false,productionPrimary:false}；拒绝不带摘要或输入值，status='rejected'，同样两个 false，code 为 GS03_SYNTHETIC_PRECHECK_ENVIRONMENT / GS03_SYNTHETIC_PRECHECK_INPUT / GS03_SYNTHETIC_PRECHECK_TARGET。结构或反射异常统一 INPUT；外层结构合法但环境不合法为 ENVIRONMENT，环境不合法不检查 request/target。合法字段但目标不等为 TARGET。输出不带原始异常、路径、患者信息、cause 或业务投影。

## Verification

独立测试覆盖双环境、精确冻结结果、固定手算 golden digest、字段插入顺序、每个字段摘要敏感性、目标四项错配、空/类型/字段上下限、Unicode UTF-8/孤立代理项、无隐式转换、getter不执行、继承/symbol/非枚举/额外字段、抛异常与撤销 Proxy、循环/toJSON 拒绝、输入不变与重复调用无状态。不修改旧测试或共享 helper。旧 GS03 离线准入和既有结果/存储/内存专项继续通过。

## Migration cost

无新依赖、API、真实数据库、migration、权限、正式摘要协议、文件或网络读写。回滚撤新增组件及专项和本片治理登记即可，不改历史事实。

## Risk

纯合成接纳不等于真实身份授权、签名有效、撤权围栏、持久幂等或提交。正式反馈算法、全写者共事务、留存、耐久恢复和现场签署仍待父 Proposed 决定；GS03 整体验收未建设，六生产域 NO-GO。

## PLAN

基线 origin/main@5929fe18046d202d00c9df7ac11638b6e7975137；PR343冻结95ba51a8与main同tree ba2e2ecb，18本地门禁及PR/main各9成功，只关闭GOV038/OPS057限定交付，风险open。WIP先4降2再登记4，单写与既有OPS040/SEC016无重叠。T00独占ADR、台账、六地图、ROADMAP、ADR索引、文档清单；T05开发A唯一写新src，B唯一写新test，两作者不操作Git索引。独立准入审查后实施，独审通过后T00串行提交、冻结，并串行18必需门禁。未完成门禁不标闭合；本片不推送合并上线。
