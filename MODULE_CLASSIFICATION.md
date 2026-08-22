# 模块 A/B/C/D 分级（实施分支）

> 历史采样基线：`main@a15d10d`，当前对账基线：`main@21d8f3c`，更新于 2026-08-21；
> ARC-002 已通过 PR #132 合入主线。本表覆盖可分配 owner 的架构模块；文件级清单
> 后续由机器治理生成。标签不是立即重构授权。

## 判定规则

| 标签 | 定义 | 处置 |
|---|---|---|
| A KEEP | 功能正确、边界合理、测试较好 | 不动 |
| B KEEP + IMPROVE | 功能正常，结构可渐进改善 | 触及时小步优化 |
| C REFACTOR | 严重耦合、重复、过大或难扩展 | 测试保护后逐块重构 |
| D REPLACE | 根本错误、严重安全、无法测试、路线废弃或重做更便宜 | ADR 批准后替换 |

## 平台与横切模块

| 模块 | Owner | 标签 | 依据 | 下一原则 |
|---|---|---|---|---|
| `src/http/api-router.js` + route registry | T00 | A | 顺序、ID 唯一和短路有测试 | 保持稳定，不加领域逻辑 |
| process worktree/ownership | T00 | A | 可执行计划、创建和越界验证 | 保持主线唯一性 |
| regional manifests/runtime | T00 | B | 边界明确、入度较高 | 逐步降低 manifest 耦合 |
| `server.js` 组合根 | T00 | C | 28.2k 行、职责过多 | 先测后抽端口，不整体重写 |
| 静态资源发布实现 | T00 | B | Node/Pages 共用显式 allowlist 与负向测试 | 新资源必须注册，不扩大默认发布面 |
| runtime contexts | T00/各域 | C | 最宽 160 项依赖 | 按子域端口缩窄 |
| technical evidence | T00 | B | 稳定共享但入度 22 | 固化版本化契约 |
| platform data/storage | T00/T02 | B | 契约、CAS、outbox 测试较强 | 修复版本治理后逐步 KEEP |
| alert cutover runtime | T00 | B | 已改为显式 provider 端口，并有缺失/无效/异常失败测试和禁止反向依赖的架构测试 | 保持接口与 NO-GO 语义；worker 加载大组合根的残余随 ARC-001 渐进治理 |
| CI/readiness pipeline | T00 | B | 已按风险域拆分、建立六个标准入口并保留 fail-closed 聚合门禁 | 扩大静态检查基线，继续治理测试性能、供应链固定与 worker 观测 |
| continuous audit delivery | T00 | C | adapter、preflight、部署闭包与默认信号已标准化，但仍轮询 120 条展示快照，receipt/checkpoint/lock/WORM 不能证明生产耐久 | 按 ADR 先建事务内 append-only source，再依次治理可信 receipt、target binding、lease/fencing 与外部 anchor；当前只允许 rehearsal |

## 领域模块

| 领域 | Owner | 标签 | 依据 |
|---|---|---|---|
| runtime | T01 | B | 健康/指标边界清楚，仍依赖大上下文 |
| identity-security | T01 | B | Cookie/CSRF/session 边界已建立；兼容路径和静态资产待治理 |
| platform-governance | T02 | B/C | 子模块已拆，但 72+ API、证据/发布职责很宽 |
| health-dashboard indicator contract | T02 | B | 首个版本化聚合指标采用小型纯合同端口；旧 summary 聚合器和未版本化指标仍需渐进治理 |
| state-data | T02 | C | 兼容适配必要，但容易成为通用写入口 |
| public-health | T03 | C | 上下文 160 项，前端/脚本/外部运行时庞大 |
| citizen-chronic | T04 | C | 浏览器文件 6k 行、上下文 64 项 |
| care-coordination | T05 | C | 路由文件 2.1k 行、上下文 102 项 |
| clinical-specialties | T06 | C | 领域仍含急救/血液/影像/体检/质安，但 operations dashboard 与 command 均已移出 |
| clinical five-subdomain governance | T06 | B | 五个 Owner/API 边界已机器登记，源码、数据和 CI 隔离尚未完成 |
| emergency dashboard query | T06/emergency | B | 首个只读用例已通过小端口隔离并具备特征/单元测试；其余急救仍是遗留边界 |
| blood dashboard query | T06/blood | B | 首个查询用例已隔离角色范围并具备特征/单元测试；仍接收宽快照并保留内存规范化兼容 |
| imaging dashboard query / public response | T06/imaging | B | 查询和响应安全策略已归位并有单元、特征及真实 API 安全测试；审计与宽快照仍在兼容边界 |
| physical examination dashboard query | T06/physical-examination | B | 构建、readiness 和角色投影已有标准查询端口与测试；范围、审计、脱敏和宽快照仍在适配边界 |
| insurance-payment | T07 | B | 聚合、仓储、outbox 边界较清楚 |
| integration | T08 | B | 契约和外部联合测试边界明确 |
| research | T09 | B | 范围小，有授权和审计要求 |
| shared | T09/T00 review | C | 12 段、50 依赖，有聚合继续膨胀风险 |

## 前端应用

| 模块 | 标签 | 依据 |
|---|---|---|
| platform shell / API client / design system | B | 已有共享壳，仍与全局脚本并存 |
| `app.js` 管理端 | C | 2k+ 行、90 个 HTML sink |
| `citizen.js` | C | 6k 行、94 个 HTML sink |
| `public-health.js` | C | 4.4k 行、78 个 HTML sink |
| `platform.js` / `operations.js` | C | 3.7k+ 行、全局状态和渲染耦合 |
| 数智医院子站 app | C | 10.5k 单文件 |
| access policy | B | 页面策略集中且 fail closed，有测试 |
| Service Worker 的公开演示缓存策略 | B | 只缓存合成脱敏 `public-demo.json`，旧源快照缓存已撤销 |

## 数据与任务

| 模块 | 标签 | 依据 |
|---|---|---|
| domain data ownership registry | A/B | 83 个集合有 owner，仍需扩大覆盖 |
| JSON 静态快照（演示用途） | B | 本地演示有效，但必须合成/脱敏/隔离 |
| JSON 静态快照（生产事实源用途） | D | 与生产 PostgreSQL 目标冲突，安全风险高 |
| SQLite migration 注册表/runner | B | 已独立、连续、事务化；v1–v14 指纹冻结，v15+ 内容 checksum，专项回归齐备 |
| PostgreSQL primary/outbox contracts | B | fail closed、CAS、TLS、核对测试较强 |
| 领域 worker 集合 | B/C | 功能可测但状态/观测接口不统一 |

## 标签使用

- A 模块不能因“顺手整理”被改动。
- B 模块只做与任务直接相关的小改进。
- C 模块先写特征测试，按接口分块迁移。
- D 只替换明确组件，不把整个应用标 D；必须先有 Accepted ADR。
- 标签变化需更新证据和 review，不凭代码审美升级或降级。
