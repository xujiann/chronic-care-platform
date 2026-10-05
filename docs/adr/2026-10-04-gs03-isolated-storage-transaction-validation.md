# ADR-GS03-S3-EXPERIMENT-001 GS03 隔离存储事务验证

- 状态：Accepted
- 日期：2026-10-04
- 批准依据：用户批准下一限定切片；`USER-GS03-STORAGE-EXPERIMENT-2026-10-04` 仅授权开发和测试，不推送、合并或上线。
- 有效范围：GOV-030 技术准入及 TEST-027 测试目录内一次性合成库验证。父 CALLBACK、STORAGE 和 S2 ADR 均保持 Proposed；本决策不接受其正式协议、Owner、权威、留存或恢复政策。
- Owner：T00 协调技术边界；T08 负责测试专用实验，不改变正式业务数据 Owner。

本片检验真实平台迁移与审计机制能否参与同一 SQLite 事务。结果仅是隔离技术证据，不是正式共同事务端口、回调修复或现场交付。

## 2026-10-05 限定交付授权补充

用户追加USER-GS03-STORAGE-CI-REPAIR-MERGE-2026-10-05，允许原三测试文件范围内修复PR334的Linux符号链接错误分类，并在独审、重新冻结、18项串行门禁及精确新head CI全通过后推送与保护合并。原2026-10-04仅开发测试的批准保留为历史，不覆盖本次新候选验证。本补充不修改实验有效范围或接受父Proposed，不授予部署、现库迁移、正式协议、业务接线、Owner签认或生产权限。

## Problem

TEST-026 使用模拟 audit source，S1 只证明真实 v15 外键结构；两者不能证明会诊、确切授权、档案、消息、成功双审计及真实 append-only source 和 S1 receipt 同事务。本片只弥合这项实验验证缺口，不接正式写入口。

## Options

1. 继续扩展旧模拟实验：成本低，但仍无法证明真实 v15 hook。
2. 新测试专用隔离 harness 复用真实 runner、未注册 S1 定义、audit-chain 和 `appendAuditDeliverySourceChanges`：选择本方案，证据独立且不改应用运行路径。
3. 正式 repository/UoW 与 HTTP 装配：必须先解决 Owner、外部 scope fence、完整写者、正式协议、源世代和历史留存，不属于本片。

## Advantages 与 Disadvantages

真实 schema、checksum、严格链校验、v15 源追加和 S1 唯一约束可在同一连接验证；双进程不靠进程内模拟锁。代价是新测试 harness 与故障 seam，仍不能替代真实 Owner 适配、provider、外部身份共同提交或恢复策略。旧实验不重写，两个 harness 不互相冒充证据。

## Migration cost 与隔离边界

只新增三份测试文件：`test/helpers/gs03-storage-transaction-experiment.js`、同目录 `gs03-storage-transaction-experiment-child.js`、`test/gs03-storage-transaction-experiment.test.js`。无新依赖、HTTP、运行模块、CI 拓扑或正式 schema 变化。

创建函数只能在明确批准、已解析且非 OneDrive 的临时根下建立自有随机目录与新空库：Windows 使用 `C:/Users/drxuj/Temp` 或工作树内项目专用 tmp，Linux CI 可用系统临时根。由fixture或当前测试子进程配置指定，不修改全局环境，不默认采用Windows的AppData临时目录。操作函数在任何写入前核路径、符号链接、随机身份、应用标记、精确对象结构和 migration ledger；陌生现库、应用库、失配身份、额外对象或结构漂移均拒绝，不以打开或自动迁移修复。不得覆盖已有文件或接受任意 dbPath。清理只允许核实属于本次实验的整个临时目录，不删除单条回执。

新空库显式调用 `applySqliteMigrations`，拼接默认注册表与未注册 S1 候选，再独立 `verifyGs03CallbackReceiptSchema`。默认仍 v19/41 表，只有实验库到候选 v20/42 表；不修改历史 migration、S1 定义、默认注册表、真实 hook 或共享 runner。业务合成事实复用 `state_collections` 的既有授权/会诊/档案/消息及审计集合，不新造同义生产实体或 fake audit_source。

随机实验身份及对象指纹可存于既有 `state_collections` 的专用实验元数据键或既有 `storage_events`，不新增metadata表、生产集合或Owner。业务只更新显式相关集合，不同步镜像或调用server。每个审计轨道最多120条合成事件，满时失败关闭，不裁剪、重封或宣称长期容量。

## 实验命令合同

主体、居民、机构、确切授权和三类意图全部为显式合成输入，没有外部 provider 或签名验真。固定实验 canonical 标识及 namespace 域分隔；S1 的 intent_digest_version=2 仅为候选结构约束，不宣称实验摘要就是正式 v2 算法。正式 principal 命名空间与规范化协议仍待父 ADR 接受。

每次 `BEGIN IMMEDIATE` 成功后重读同库授权、案例、receipt 与版本；锁外旧快照不得决定成功。首次与重放都核当前主体范围、确切授权 ID、居民、用途、机构、状态和有效期，在提交前复核受控时钟。撤权写同一库事务；不寻找另一有效授权替代，不支持外部 scope 协议或默认恢复。

唯一 receipt 命中须同时匹配目标、授权、主体 namespace 和精确意图；精确重放零新副作用，冲突不泄露旧目标。跨主体同 key 独立命名空间且各自授权。不允许借回执摘要跳过当前权限。

首次同事务更新案例、报告档案（report 合同）、两条应用内消息和成功安全/访问审计。审计数组用真实 `auditHashFor`/`verifyAuditTrail`，源调用真实 `appendAuditDeliverySourceChanges(db, previousState, nextState)`；S1 receipt 引用这次生成的两个 source ID。写 receipt 前核当前事件的 actor、目标、receipt、result、stream 及真实 source 内容摘要/投影，不接受“存在但属于旧主体/旧目标”的有效审计引用。应用内消息不是外部送达证明；无网络、outbox 或双写。

## 失败四态与 Risk

确认提交才返回最小成功；确认 rollback 才断言本次所有事实零写。提交成功但响应丢失和 COMMIT 结果未知均不换 key 或补成功审计；调用方 unknown 必须由重新打开同一权威并以当前授权同 key 核验区分 committed/rolled-back，无法确定则继续 unknown。进程在 COMMIT 前后退出不得由退出码推断事实。撤权后重放和核验不得披露旧 receipt。

核验必须先证明原连接/子进程终结且事务收束，或由新连接取得覆盖原writer的 `BEGIN IMMEDIATE`，从此序列化点的新快照核当前授权与同key。原writer仍持锁时，即使普通读能看到receipt缺失也不能判rolled-back；锁忙、超时或无法排除在途事务均返回unknown。验收需确定性交错原writer暂停在COMMIT前，恢复不得提前报回滚或披露结果，随后原事务分别commit/rollback，再核终态；不以一次absence替代串行化证明。

故障 seam 仅测试调用，可在每事实写后、每真实 source 追加后、receipt 前后及 COMMIT 前后抛错或同步子进程；不暴露到应用。测试必须证明真实回滚而非仅错误码。拒绝策略为本片零业务/成功审计，不交付正式拒绝审计政策。

本片不证明全部写者 fence、外部 scope、500 条裁剪治理、历史无摘要迁移、容量/长期去重、真实备份恢复/源世代、正式 v15 hook 在现库的 Owner 接线或生产。禁止 TTL、删 receipt、key 复用、旧事件回填及 JSON fallback。实验库不得交给旧 runtime；回滚停止实验，只清理自有合成目录，保留失败证据，不 DROP 现库或删历史事实。

## PLAN 与单写者

GOV-030 由 T00 唯一写 ADR、索引、机器台账、路线图和六图必要事实；TEST-027 在独立 T08 process 工作树。开发 A 唯一写主 harness，开发 B 唯一写测试和 child；双方不互改，接口先约定，独立审查者只读。先完成准入独审及治理专项，协调者明确放行后才落代码。

验收至少覆盖三合同逐字段首次、精确重放、异意图/目标/授权冲突、跨主体同 key、越权零事实及最小响应；真实两连接/两进程同 key 零重复、撤权先提交/回调先提交、锁外旧快照与锁内新授权版本、提交前时钟过期；逐业务/档案/消息/安全/访问/source/receipt 故障回滚；存在但 actor/目标错绑的旧成功 source 引用拒绝；COMMIT 前/后子进程退出、丢响应、unknown 同 key 受权恢复；路径/身份/结构/ledger 拒绝且陌生文件字节不变；默认注册表与应用依赖不接新 harness。证据需精确计数及真实事实/source 关联，不能只断言存在或复用旧专项代替本片。

开发专项通过后独立代码审查，修复批准范围内问题；组合冻结后串行执行18项中央/标准/全发现门禁。冻结期间不并发重型测试，失败保留日志并回到修复/复审/重新冻结。任务只能记验证中、已实现，不能提前已集成；本轮不推送合并上线，GS03 未建设、生产六域 NO-GO。
