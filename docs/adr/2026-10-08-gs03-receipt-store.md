# GS03 未接线回执读写组件

- 状态：Accepted
- 日期：2026-10-08；决策 ADR-GS03-RECEIPT-STORE-001；任务 GOV-035、OPS-054。
- 批准依据：用户批准未接线回执读写组件开发测试，用户统一协调、专业另签。无HTTP、现库、生产、推送或合并授权；父CALLBACK/STORAGE/S2继续Proposed。

## Problem

S1已有未装配结构，回执SQL仍只在测试实验中使用。需要小型可复用读写组件，以固定命名空间及精确意图匹配约束读写，不把实验命令或测试审计移入生产路径。

## Options

1. 复制实验harness成为正式业务命令：身份、审计、恢复前置不足，不采用。
2. 新建未接线存储组件，仅操作已有S1表：采用。
3. 注册migration并接HTTP/正式权威：超出批准范围。

## Contract

仅新增src/platform/storage/gs03-receipt-store.js与test/gs03-receipt-store.test.js。不修改S1定义/默认注册表、事务执行器、内存适配器、旧实验、server或路由，不新增依赖包。

同步工厂createGs03ReceiptStore({environment,db,namespaceDigest})只接受这三项。environment仅development/test；namespaceDigest为精确64位小写hex，来自可信调用方且构造后不可变。db是可信调用方已持有的SQLite连接，组件不打开/关闭连接、不接受路径、不证明连接为内存。当前调用与测试只用自建:memory:，应用没有装配入口；生产环境字符串拒绝不代表生产授权已证明。命名空间隔离只是持有不同绑定store时SQL范围分离，不是用户身份认证，创建store的可信代码可指定namespace，调用方必须先核当前身份/权限。

store仅提供lookup(selector)、insert(record)、productionReady=false。lookup的selector恰为contract_id、contract_version、key_digest、target_id、authorization_id、intent_digest_version、intent_digest七字段。insert接受S1原始列名中除namespace_digest外的十四字段，namespace由store绑定注入；调用方不得传入或改写namespace。

输入采用自有数据属性精确键集，拒绝额外字段、getter、symbol、错型/空值；校验S1的三个contract_id、两个固定版本2、固定result_status/streams、64位小写hex、UTF8 ID字节界限及边缘空白/NUL、recorded_at_ms整数0至8640000000000000。不得归一化或截断意图/标识。

标识中的未配对UTF16代理项不能无损存入UTF8，必须在SQL前拒绝，不允许编码替换造成输入与已存值不一致。

每次lookup/insert均要求db.isTransaction严格true，并调用既有verifyGs03CallbackReceiptSchema确认S1结构、外键开启及一致性；缺失/漂移/关闭连接或状态能力失败关闭。不创建修复schema，不执行BEGIN/COMMIT/ROLLBACK/SAVEPOINT，不承诺此处检查证明写锁级别、事务所有权、全写者围栏或耐久提交。调用方负责完整事务和失败清理；禁止把store交给不可信SQL/连接修改者。

既有S1验证器不覆盖TEMP schema。新组件每次操作额外拒绝所有TEMP对象及main/temp以外的附加数据库（空TEMP schema可接受）；查询与插入显式限定main.gs03_callback_receipts。INSERT必须核实changes===1才返回staged，零行或无法确认影响数时稳定拒绝；不修改S1验证器或历史指纹。此检查防止意外TEMP触发器/遮蔽，不声称防御恶意连接实现或动态替换原生方法。

lookup用绑定namespace+contract/version/key精确查找。无行返回冻结{status:'absent',productionReady:false}；命中但target/authorization/intent版本或摘要不同返回冻结{status:'conflict',productionReady:false}，不附旧值；完全匹配返回冻结{status:'matched',receipt:{receiptId,recordedAtMs},productionReady:false}，嵌套投影也冻结。matched只是当前事务所见可供上层判断的精确重放候选，不代表授权仍有效、业务完成或已提交。

insert仅执行一条参数化INSERT，返回冻结{status:'staged',productionReady:false}；不UPSERT、不替换、不自动重放或更新删除。重复主键/同namespace唯一键、外键和约束错误拒绝，错误只含稳定code，不回显原始SQL/输入/数据库路径或cause。先lookup可供调用方选择精确重放，但不能绕过数据库唯一约束。

S1 result_status='committed'是已有结构字段，不改变其DDL；事务内insert返回staged明确尚未确认提交。成功回执的审计引用FK只证存在，不能证明本次actor/目标/成功语义或同事务；这些由后续受权业务端口负责，本片不宣称解决。读到本事务内未提交回执也不能作为外部成功回执。

## Verification

专项只用真实SQLite :memory:，显式通过真实migration runner追加未注册S1并verify，默认仍19/41表；合成候选到20/42，不改历史checksum。真实v15 hook写入合成审计父行，不能将这些引用存在断言解释为业务验真。

覆盖三合同、精确字段/边界负测、无事务/已提交或回滚后调用拒绝、schema/FK漂移、完整匹配与各字段冲突最小投影、不同绑定namespace同key独立、无法在方法参数覆盖namespace、重复INSERT及UPDATE/DELETE/REPLACE不可变。零写只证明本组件失败的回执表不变；另验证调用方rollback使同事务合成审计及回执共同回滚，并保留先前已提交事实。原生提交前后由调用方控制，store不负责unknown恢复。

## Advantages and Disadvantages

将S1读写与测试脚手架分离，保留可组合事务边界；无真实身份、授权、审计语义、跨进程锁/恢复或长期幂等保证。外部专业签署和全写者准入仍待完成。

## Migration cost

不注册migration、不执行现库变更、不回填旧事件。回滚仅移除未装配组件及专项和本片治理，不删历史业务、审计或回执。

## Risk

调用方若伪造namespace或注入已污染连接，存储组件不能提供身份保护；unknown与重放必须由更高层在当前授权下处理。查询事务内S1状态不能证明耐久提交。专业另签，GS03未建设及生产六域NO-GO不变。

## PLAN

基线main@c69e25b0。PR339冻结8871d6e3与merge同tree67932107，PR37720619176/main37732322868各9成功；先闭合GOV034/TEST028限定测试交付，再登记GOV035/OPS054，WIP2增4。T00单写治理/ADR/六图；T08开发A单写组件，开发B单写专项，独审只读。准入审查后实现、专项及独审，冻结后串行18门禁；不推送合并上线。
