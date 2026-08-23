# 架构与治理入口

> 更新：2026-08-19。AS-IS、决策和计划必须分开阅读。

## 每日阅读顺序

1. `AGENTS.md` 与 `ENGINEERING_GOVERNANCE.md`。
2. `ROADMAP.md` 和当天计划。
3. 六张 AS-IS 地图及任务专项标准。
4. `docs/adr/README.md` 与相关 ADR。

## 六张地图

| 文档 | 回答的问题 |
|---|---|
| [CURRENT_ARCHITECTURE.md](./CURRENT_ARCHITECTURE.md) | 应用、入口、存储和部署当前如何组成？ |
| [MODULE_MAP.md](./MODULE_MAP.md) | 模块、owner、耦合、循环、重复和大文件在哪里？ |
| [DATA_MODEL.md](./DATA_MODEL.md) | JSON/SQLite/PostgreSQL 的关系、事实源和风险是什么？ |
| [API_MAP.md](./API_MAP.md) | 路由域、鉴权、外部接口和错误边界是什么？ |
| [DEPENDENCY_MAP.md](./DEPENDENCY_MAP.md) | 代码、浏览器、数据、worker 和外部依赖如何连接？ |
| [TECH_DEBT.md](./TECH_DEBT.md) | 已确认风险、优先级和测试缺口是什么？ |

## 标准

| 文档 | 用途 |
|---|---|
| [ENGINEERING_HEALTH_CHECK.md](./ENGINEERING_HEALTH_CHECK.md) | `main@b1e4898` 只读体检基线 |
| [ENGINEERING_GOVERNANCE.md](./ENGINEERING_GOVERNANCE.md) | 单一主线、所有权、数据、安全、测试与交付治理 |
| [MODULE_CLASSIFICATION.md](./MODULE_CLASSIFICATION.md) | A/B/C/D 模块处置 |
| [MODULE_INTERFACE_STANDARD.md](./MODULE_INTERFACE_STANDARD.md) | 标准依赖方向和接口约束 |
| [REFACTORING_SAFETY_NET.md](./REFACTORING_SAFETY_NET.md) | 遗留代码测试保护 |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | 当前 schema/migration 台账 |
| [DATABASE_DEVELOPMENT_STANDARD.md](./DATABASE_DEVELOPMENT_STANDARD.md) | 数据库开发规则 |
| [CORE_DATA_DEFINITIONS.md](./CORE_DATA_DEFINITIONS.md) | 核心数据不可变概念 |
| [ADR 台账](./docs/adr/README.md) | Accepted/Proposed 架构决策 |
| [仓库治理机器合同](./config/repository-governance.json) | 当前工作流、Markdown 闭集分类与跟踪 PDF 来源/摘要 |

## 已接受方向

- `main` 是唯一集成和发布主干。
- 采用模块化单体；微服务提取必须达到机器评分和运维/数据门槛。
- v1–v14 SQLite migration 语义冻结，后续采用独立、内容指纹化 migration。
- 核心数据采用 closed-world 定义，不随功能任务创建平行概念。
- 静态内容安全边界已按 Accepted ADR 实施并合入 `main@6c18221`；Node 与 Pages 共用显式发布清单，浏览器只消费合成脱敏快照。
- 生产 API 目录从现有 route source inventory 与授权矩阵派生；所有条目默认 `NO-GO`，静态幂等标记和仓库门禁不构成生产证据。
- State collection 数据 owner 只来自现有 owner/system 合同；process owner 和源码引用仅作为证据。
  无明确 owner 的集合必须显式 `review-required` 或 `legacy-quarantined`，仓库检查不能授权生产晋升。
- 关键内部边界现按 10 个职责独立组测量覆盖率：identity、audit、object storage、API governance、worker observability、区域共享、转诊、科研导出、浏览器响应头与 Safe URL；原 server.js 门禁保持不变，基线只能持平或提高，临时覆盖报告不构成浏览器页面或生产证据。
- 在线 Playwright 继续在 35 + 13 项 context 中阻止 Service Worker；PWA 只在独立 3 项 context 中允许，
  使用同一 Chromium/动态端口策略并逐项注销 registration、删除 Cache Storage。v61 只缓存同源成功响应，
  仓库测试不替代真实 HTTPS、设备策略或现场安装验收。
- 急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台与区域切换工作台八个单页 controller 分别将 6、6、8、8、1、1、1、2 个 API 驱动 HTML sink 迁为显式
  DOM/text/class/dataset，Inventory v2 的 HTML occurrence 由 871 降至 838；八页恶意响应浏览器测试
  不替代真实托管头、渗透或现场验收。
- strict production preflight 通过 T00 受控文件 provider 装配既有 external trust verifier；只接受独立
  pin 的 Ed25519 anchor bundle、双角色签名和当前 release/artifact/evidence/registry 绑定，默认继续 NO-GO。

## Proposed 方向（不授权实施）

- `OBJ-ADR-002` 建议 T08 作为对象存储附件元数据 data owner、T00 作为共享存储/worker technical owner，
  并规划 v17 结构化模型、版本化异步 API、回填冻结、无损分页、worker、reconcile 和 readiness。
- data owner 与 v1/v2 兼容策略仍需人类确认；机器台账和 CI 在 ADR 未 Accepted 时禁止任何 v17、runtime/
  API implementation 或 production promotion。当前 schema/API/runtime 仍保持 AS-IS 与 `NO-GO`。
