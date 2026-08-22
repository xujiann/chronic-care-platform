# ADR：临床专科拆分为五个可治理子域

- 状态：Accepted
- 日期：2026-08-18
- Owner：T06；中央路由、数据所有权和 CI 变更由 T00 review/handoff
- 影响范围：`clinical-specialties` 的代码、API、数据、测试和后续迁移

## Problem

`clinical-specialties` 同时承载急救、血液、影像、体检和质量安全，运行时上下文有 76 项依赖。现有 10 个路由子上下文已经降低了单文件耦合，但 `clinical-blood.js` 同时包含血液和影像，`blood-innovation.js` 同时包含血液和体检，两个 operations 子上下文也错位在临床域。若继续以一个大域开发，Owner、数据写入、接口兼容和测试责任无法独立。

## Options

1. 保持一个 `clinical-specialties` 大域，只按文件分工。
2. 在模块化单体内建立急救、血液、影像、体检、质量安全五个可治理子域，先固化契约和门禁，再逐用例迁移。
3. 立即建立五个仓库、数据库和微服务。

## Advantages

方案 2 允许五个子域分别规划、开发和测试，同时保留统一身份、MPI、机构目录、审计、集成网关、outbox 和部署门禁。先建立兼容契约可以控制遗留迁移，不引入跨进程事务和五套运维体系。

## Disadvantages

迁移期仍会存在混合路由文件、候选数据集合和兼容适配器；统一部署意味着某个子域的发布仍需通过全平台 CI；中央所有权和 CI 入口需要 T00 后续 handoff。

## Migration cost

中高。第一阶段建立注册表、资产盘点、跨子域契约和测试；随后按急救、血液、影像、体检、质量安全逐个迁移路由、用例端口、仓储和测试。operations 错位路由需单独交给 T00/T02。数据库不在本 ADR 中直接拆分。

## Risk

- 仅移动目录会制造伪边界，必须先有 API、数据和依赖门禁。
- 质量安全若直接读写其他子域集合，会变成超级模块；它只能维护自己的写模型，通过事件/版本化查询形成读模型。
- 把候选集合直接登记为生产 owner 会绕过数据分类、migration 和回滚评审。
- 同时改路由、协议、schema 和部署将扩大回归面，因此每次只迁移一个用例或端口。

## Recommendation

采用方案 2。`config/clinical-subdomains.json` 是五个子域的 T06 机器治理事实，中央 `domain-data-ownership` 继续作为生产 Owner 权威。当前保持模块化单体和统一部署，不授权独立微服务。跨子域访问只允许版本化查询、领域事件读模型或 owner command port；禁止新代码反向依赖 `server.js` 或直接导入其他子域内部实现。

独立部署仍受既有“模块化单体与微服务提取标准”约束，必须达到评分、数据自治、SLO、团队、运维和站点证据门槛后另立 ADR。

## Implementation status

- 第一切片：五子域注册表、136 个 API 字面路径归属、9 个中央登记集合映射、66 个候选集合盘点和 3 个跨子域契约已建立。
- 第二切片：`GET /api/emergency/dashboard` 已通过 `emergency-dashboard-query.v1` 迁入急救目标源码根，保持原鉴权、脱敏、状态码和只读语义。
- 第三切片：`GET /api/blood-system` 已通过 `blood-dashboard-query.v1` 迁入血液目标源码根，保持 commission/institution 范围、状态码和遗留内存规范化顺序，不新增持久化。
- 第四切片：`GET /api/imaging-cloud` 已通过 `imaging-dashboard-query.v1` 迁入影像目标源码根，公开响应净化也归位影像子域；保持原角色、居民范围、访问审计和状态码。
- 第五切片：`GET /api/physical-exams` 已通过 `physical-examination-dashboard-query.v1` 迁入体检目标源码根，保持原角色投影、居民范围、访问审计、最终脱敏和状态码。
- OPS-01：`GET /api/operations/dashboard` 已由 T00 从 T06 原子移交 T02 `platform-governance/operations-dashboard`，保持 method/path、commission 角色、响应和全局 manifest 插槽；T06 删除对应子上下文及三个不再使用的依赖，并以唯一归属和禁止回流测试保护。
- OPS-02：其余 32 个 `/api/operations` 字面路径已由 T00 从 T06 原子移交 T02 `platform-governance/operations-command`；原 20 项依赖和全局 manifest 插槽整体迁移，handler 除 route id/domain 外逐字不变，method/path、角色、状态码、响应、写库和审计语义保持兼容。T06 的 operations 路由计数归零，机器注册表标记 handoff complete。
- OPS-02 保留了既有 `resourceDispatchRequests`、`taskMessages` 跨域直写，数据机器 Owner 仍为 T05 care-coordination；该兼容债由 TECH_DEBT ARC-008 跟踪，后续 owner port/事件治理必须另立 ADR，不属于本次路由归属移交。
- TEST-007：复用既有 handoff harness，对 operations-command 的 32/32 路径补齐角色、拒绝先于读取、
  payload/错误、响应、副作用、审计—写入顺序及失败语义；该测试保护 OPS-02 的兼容承诺，不改变
  handler 或关闭 ARC-008。
- 尚未实施：五个临床子域路由全面移动、完整运行时上下文拆分、中央数据 Owner 晋升、独立 CI、数据库拆分和独立部署；operations 大 handler 的后续用例端口拆分也不属于本次原子移交。
