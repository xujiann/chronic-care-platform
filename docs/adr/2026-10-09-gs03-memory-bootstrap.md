# GS03 非生产内存初始化

- 状态：Accepted
- 日期：2026-10-09；决策 ADR-GS03-MEMORY-BOOTSTRAP-001；任务 GOV-037、OPS-056。
- 用户批准本轮非生产内存初始化开发测试，沿用已有保护推送合并流程；专业事项另签。仅技术初始化准入，不接受父 CALLBACK/STORAGE/S2 的正式业务或生产决定。

## Problem

既有内存适配器只能在已拥有事务中执行 apply；真实 migration runner 自身逐版 BEGIN/COMMIT，直接嵌套会失去事务所有权。上一片通过直接原生DDL完成分层测试，没有完整 runner 初始化入口。

## Options

1. 放宽业务回调任意事务控制或接外部连接：不采用，违反既有租约和来源边界。
2. 增加显式自有内存初始化工厂，初始化完成后复用原租约引擎：采用。
3. 建立持久共同事务、现库升级或正式业务装配：需专业、Owner和独立接口决定，不在本片。

## Contract

仅修改 src/platform/storage/gs03-memory-transaction.js，并新增 test/gs03-memory-bootstrap.test.js。两个公有工厂均只接受精确自有数据属性 environment=development/test；拒绝路径、连接、初始化函数、任意migration、额外或访问器选项。旧 createGs03MemoryTransactionSession 的空库、错误码、租约、阶段、隔离和close保持原样。

新 createGs03MigratedMemoryTransactionSession 使用内部 new DatabaseSync(':memory:')，在任何session/port/lease可交调用方前完成固定初始化。私有共同引擎不导出外部连接、SQL或initializer入口，不复制事务状态机。初始化后返回原有冻结 createPort、close、productionReady=false 接口；没有公共重复initialize或销毁后恢复功能。

初始化依次核原生 isTransaction 为布尔且false、仅main，启用FK并读回1；默认head必须19、默认完整注册表连续19项、未包含S1，S1必须20。只在该自有空内存库显式拼接默认注册表与S1，调用真实 applySqliteMigrations。首跑须head20/applied20；显式S1验证，保存完整ledger，再真实重跑，须head20/applied0、registryFingerprint相同及ledger逐行所有字段不变。再次显式S1验证、FK、仅main、无活动事务，全部成立才交出session。不能截断变化后的默认注册表绕过head漂移，默认应用registry/head19/41表不变，显式候选库20/42表。

初始化失败不返回session；尝试关闭整份自有连接，使用稳定脱敏 GS03_MEMORY_BOOTSTRAP。若初始化后的close也失败，抛 GS03_MEMORY_BOOTSTRAP_CLOSE 表示清理未确认，不能声称库已销毁。旧开库/能力错误不变。runner逐版事务，不承诺全部迁移原子回滚；关闭成功只是销毁这份无外部事实的内存。错误不包含SQL、路径、cause或原始底层内容。

默认工厂不依赖或启动候选初始化，应用无新require装配。可信同步apply/verify回调和旧适配器不是不可信SQL沙箱；禁止私留连接事务外写入、事务ABA或裸控制。初始化不提供正式身份授权、全写者围栏、业务事实恢复或幂等权威。

## Verification

新专项以真实SQLite、真实runner为正向基线，独立核完整ledger、默认19注册表不变、候选20/42结构及指纹；重复factory独立、后续多个port不重迁移。旧memory、store、receipt组合、S1专项继续执行不弱化。

在迁移初始化session事务中组合真实v15 hook与receipt store，验证首次、精确重放、回滚完整事实及真实COMMIT后响应丢失的unknown/隔离。并发租约拒绝、关闭行为沿既有组件语义；不将同连接观察当持久恢复。

失败矩阵覆盖输入/生产拒绝、初始状态/FK/head/registry、迁移异常与结果不符、S1结构漂移、重跑ledger变化、TEMP/ATTACH/活动事务、关闭异常及脱敏。测试内部故障注入可靠恢复Module._load/cache，优先隔离进程，不新增运行时fault参数。真实正向不得全mock runner；失败日志保留。

## Migration cost

无新依赖、正式schema、默认注册、历史migration、现库或数据迁移。回滚只撤新工厂与专项，并复原私有提取；旧行为由旧专项保护。不DROP现库、不回填历史，不启用HTTP、默认启动、文件存储或生产worker。

## Risk

只能初始化无事实自有内存，销毁不能替代未知提交对账。候选20不是正式head。身份、授权、全写者、外部scope、留存隐私、耐久恢复与专业现场仍待父Proposed审定；GS03整体未建设，生产六域NO-GO。

## PLAN

基线origin/main@e835fd2f，与PR341冻结f30aa0ec同tree93bf2ccf；PR37871620160/main37872522574各9成功，Pages37872522618/HTTP200仅公开演示。关闭GOV036/OPS055限定交付，原风险open；登记GOV037/OPS056，WIP2增4。T00唯一写ADR/台账/六图/文档清单；A只写原适配器，B只写新专项，T08 Git索引串行。独立方向准入后实现，组合独审通过后冻结，串行18必需门禁，精确CI成功后按已有授权保护合并；不绕过生产准入。
