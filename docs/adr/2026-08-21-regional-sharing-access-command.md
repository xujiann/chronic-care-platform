# ADR：区域共享调阅命令以居民授权事实为唯一许可依据

- 状态：Accepted
- 日期：2026-08-21
- Owner：T00 integration（目标 bounded context：T02 platform-governance）
- 影响范围：区域共享调阅命令、居民授权跨域合同、共享包版本、调阅回执、审计与非生产兼容

## Problem

既有 `POST /api/regional-data-sharing/access-reviews` 由共享路由直接调用组合根函数，并把客户端 `decision` 默认成 `approved`。实现只检查机构和居民范围，未核验 `personalRecords` 授权状态、授权对象、用途、授权范围、授权版本、地区或共享包版本，也没有幂等合同；客户端备注和用途明文进入审计，共享包历史回执还会被截断。`consentStatus` 是遗留展示字段，不能成为生产授权事实。当前演示数据又缺少生产命令需要的地区、版本和授权元数据，不能把配置或页面完整误报为生产就绪。

## Options

1. 保持现有 review 写入函数，只补少量字段校验。
2. 新建独立授权事实或把区域现场 evidence lifecycle 当成调阅许可。
3. 在 T02 建立 `regional-sharing-access-command.v1`，以 T04 `personalRecords[category=authorizations]` 为唯一居民授权事实，通过版本化跨域合同消费；原 method/path/路由顺序只作为兼容 HTTP 适配器保留。

## Advantages

- 方案 1 成本最低，但仍保留客户端决策、重复实现和不可证明的授权闭环。
- 方案 2 可以快速形成独立模型，但会创造第二套授权真相，并把部署证据错误提升为居民同意。
- 方案 3 复用现有授权创建、续期和撤销生命周期；机构、地区、用途、范围、授权版本、共享包版本与幂等证据集中在一个服务端命令合同中。撤销后的下一次命令读取最新 `personalRecords` 即立即拒绝，回执只追加且不保存备注、原始幂等键或自由文本用途。

## Disadvantages

- 方案 3 要求历史共享包和授权记录补齐结构化字段；严格生产调用方还必须携带 `Idempotency-Key`、`expectedVersion` 和 `authorizationVersion`，且持久化必须绑定已授权的 PostgreSQL atomic repository。
- 当前仍通过 `shared-05` 保留旧 URL 插槽；两个 GET builder 已进入目标 T02 read-model 模块，但 legacy normalize/seed/handoff evidence 与源码 owner 仍处于 T00 integration 边界，尚不是最终形态。
- 模块级 package queue 与应用层共享包 CAS 只能保护当前单进程兼容适配器，不能替代跨进程数据库事务；正式切换前仍需把同一命令绑定到 PostgreSQL 原子仓储。

## Migration cost

中。首切片不改变 SQLite v1-v14 DDL，既有集合继续使用 `state_collections` payload；新增 v1 回执和共享包 `version` 字段。非生产对“缺字段”的历史记录显式降级并返回弃用头与 `productionReady=false`，但已有机构、地区、用途、范围、版本冲突和撤销事实不降级。生产切换前必须按 `config/regional-sharing-access-data-contract.json` 回填地区、共享包版本、必需范围及授权对象/用途/范围/版本，并完成遮罩数据迁移、核对和回滚演练。

## Risk

- 安全：错误选择历史授权、允许未知共享包状态、截断存量标识或信任客户端决定会造成越权；因此请求和持久化边界都失败关闭，共享包只接受明确 `ready + passed`。
- 数据：共享包与回执当前仍是 JSON payload；并发原子性取决于后续生产仓储绑定。
- 旁路：commission legacy state writer 可能删除、改写、重排或伪造区域回执并篡改 package CAS；因此四个区域 owner 集合在通用写边界只能省略或深相等，集合级写入被拒绝。生产 reset 固定关闭；非生产 demo reset 不提供永久保全语义。
- 兼容：历史调用会得到显式 legacy 标志、弃用响应头和新的服务端 `allowed/denied` 结论；旧页面不得把它解释成生产就绪。
- 审计：审计链追加失败必须阻止状态写入；原始幂等键、备注、自由文本用途、人员姓名和居民身份证/电话索引不得写入新安全审计。受限数据访问日志保留内部 `residentId` 以支持居民访问历史，但 `personIndex` 仅保存以随机回执 ID 加盐的摘要引用，主体和用途同样使用摘要引用。通用日志仍有 120 条窗口，未截断 receipt history 才是本命令的长期权威证据。
- 回滚：禁止删除或重写已生成回执；回滚仅关闭命令 capability 并保留历史。

## Recommendation

采用方案 3。T00 负责本次跨 owner integration，目标 T02 拥有 `regionalDataSharingScope`、`regionalSharingPackages`、`regionalSharingSnapshots` 和 `regionalSharingAccessReviews`；T04 保持 `personalRecords` 授权事实 owner，T02 consumer-side adapter 通过 `resident-authorization-decision.v1` 读取并净化决策，命令不直接读取 T04 meta。命令使用服务端 allow/deny、精确机构/地区范围、用途/范围完全匹配、授权和共享包版本 CAS、幂等键 SHA-256 与规范请求摘要；每次 inbox 重放前重新计算授权。请求与持久化字段均拒绝超长/畸形值，不做截断比较。HTTP GET/POST 均使用专用 review allowlist。commission 在非生产保留历史全域范围并显式降级，生产仍必须通过独立现场授权。

`config/process-workstreams.json` 将当前三个 regional-sharing `src/platform/governance` 文件登记为 T00 integration 源码 owner，机器门禁与当前跨 owner 接线责任一致；目标数据 owner 仍是 T02。T00 同时修改 T02 state-data 兼容边界，确保 legacy full-state/collection writer 不能成为第二写 owner。后续源码正式移交 T02 必须另行更新 ADR 和流程 owner。

首切片非目标包括：移动两个 GET API、改写业务 builder、改变路由顺序、增加 SQLite migration、把现场 evidence lifecycle 当授权、授权生产切换。单进程 package queue 只防止当前进程内全状态丢写；`productionCutoverAuthorized=false`、`atomicRepositoryReady=false`，generic JSON/SQLite 在 production 返回 503。非生产 demo reset 仍可恢复 seed，但 production 固定拒绝。生产 readiness 保持 false，直到完成 PostgreSQL 原子仓储、真实机构/地区映射、迁移核对、回滚演练和现场批准。

## Decision

本 ADR 已按批准的方案 B 接受。实现和后续增量必须遵守上述 owner、跨域合同、失败关闭、不可变回执和生产 NO-GO 边界。

## Read-model implementation status（2026-08-23）

后续 T00 integration 增量将 `buildRegionalDataSharingView`、`buildRegionalHandoffReport` 及 Markdown 投影
从 `server.js` 移入 `regional-sharing-read-model.v1`。`shared-05` 的两个 GET 仍位于原全局插槽，通过 shared
runtime context 注入同一个冻结 read-model capability；组合根仅装配既有 legacy helper、UUID 和时钟。
特征测试锁定 method/path、身份先于读取、机构范围、access-review allowlist、角色脱敏、记录排序、响应 shape、
handoff 审计时点和错误语义；架构门禁禁止 read model 反向导入 `server.js` 或 HTTP route。

该增量不修改 access command、公开 API、collection、schema、migration、依赖或生产状态，也不将仓库测试
解释为 PostgreSQL atomic repository、外部地区/机构映射、不可变审计留存或现场验收证据。回滚只需恢复上一
版本组合委托，不得删除/改写既有 access receipts 或放宽生产 NO-GO。
