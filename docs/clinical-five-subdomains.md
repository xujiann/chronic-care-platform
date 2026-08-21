# 临床五个可治理子域

> 当前状态：治理边界已建立，运行时仍是统一部署的模块化单体。本文不是微服务拆分或生产切换授权。

## 1. 正式子域

| 子域 | Owner | API 前缀 | 当前 API 字面路径 | 目标源码根 |
|---|---|---|---:|---|
| 急救 | `T06/emergency` | `/api/emergency`、`/api/emergency-signals` | 37 | `src/clinical-specialties/emergency/` |
| 血液 | `T06/blood` | `/api/blood-system` | 28 | `src/clinical-specialties/blood/` |
| 影像 | `T06/imaging` | `/api/imaging-cloud`、`/api/mutual-recognition` | 17 | `src/clinical-specialties/imaging/` |
| 体检 | `T06/physical-examination` | `/api/physical-exams` | 7 | `src/clinical-specialties/physical-examination/` |
| 质量安全 | `T06/quality-safety` | `/api/quality-safety` | 14 | `src/clinical-specialties/quality-safety/` |

计数来自路由源码中的去重 API 字面路径，不等同于 method/path 唯一路由数。现有公开路径和路由顺序均未改变。

## 2. 遗留混合与错位

| 当前子上下文 | 现状 | 迁移方向 |
|---|---|---|
| `clinical-blood` | 同时包含血液和影像 | 先以 API 前缀保护，再逐用例移入 blood/imaging 端口 |
| `blood-innovation` | 同时包含血液和体检 | 先以 API 前缀保护，再逐用例移入 blood/physical-examination 端口 |
| `operations-dashboard` | 不属于五个临床子域 | 已由 T00 handoff 至 T02 `platform-governance/operations-dashboard` |
| `operations-command` | 不属于五个临床子域 | T00/T02 handoff 至 platform-governance/operations |

`/api/operations` 原有 33 个字面路径；dashboard 1 个已移交 T02，operations-command 仍保留 32 个待移交路径。dashboard handoff 保持公开协议，并在原全局路由插槽替换 owner segment；后续 command 迁移仍不得由 T06 单独改变全局路由顺序。

## 3. 数据边界

- 中央登记为 `clinical-specialties` 的 9 个集合已映射到具体子域，但生产 Owner 仍以 `config/domain-data-ownership.json` 为准。
- 66 个当前源码使用的遗留集合只登记为 `candidateCollections`；它们不是生产模型，不允许据此新增生产写入。
- 居民、个人记录、机构、附件、任务消息和安全审计属于共享或其他领域，只能通过已有授权端口/后续版本化契约读取。
- 质量安全只维护质量写模型，不直接写急救、血液、影像或体检集合。

任何候选集合晋升都需要 T00 数据任务完成分类、reader allowlist、写契约、migration、核对和回滚。

## 4. 跨子域契约

| 契约 | Provider → Consumer | 当前状态 |
|---|---|---|
| `blood-emergency-coordination.v1` | blood → emergency | 现由 `BloodEventHub.dashboard` 兼容，待换版本化查询端口 |
| `blood-quality-signal.v1` | blood → quality-safety | 现由 `BloodEventHub.dashboard` 兼容，待换版本化查询端口 |
| `clinical-quality-observation.v1` | 四个业务子域 → quality-safety | 目标事件读模型，不授权跨域写入 |

新跨子域调用不得直接导入另一个子域的 service/repository 实现。

## 5. 独立开发判定

当前已满足：机器注册表、API 前缀归属。部分满足：数据子域 Owner、版本化契约、源码目录隔离、独立领域测试。尚未满足：独立 CI。因此五个子域目前可以分别规划和建立测试保护，但还不能宣布完全独立开发，更不能独立部署。

急救、血液、影像与体检首个切片已完成：急救组合血液协调投影；血液统一角色范围并保留内存规范化；影像统一构建、脱敏和公开响应净化；体检统一 Overview、readiness 和角色投影。影像与体检均保留居民访问审计兼容。下一切片进入质量安全子域，先锁定其 Dashboard 的跨域只读投影、角色范围和审计，再迁出一个查询用例。
