# 全仓库工程体检基线（主线 AS-IS）

> 基线提交：`b1e489852e85db982fca9239da694e2a641f5945`
> 分支来源：最新 `origin/main`
> 体检日期：2026-08-18
> 方法：Git/GitHub 状态、静态代码/依赖/Schema 分析、只读命令和现有 CI 证据。未修改运行时代码、数据库或生成产物。

## 1. 结论

主线已经从单文件路由演进为受 T00–T09 所有权约束的模块化单体，具备较强的回归测试、生产 NO-GO 证据门禁、PostgreSQL 迁移控制和 fail-closed 身份基础。它仍不是结构稳定的终态：组合根、浏览器控制器、JSON 快照和治理脚本体量很大，且存在静态发布 P0、审计链 P0、真实循环依赖、schema 版本漂移及标准测试入口缺失。

本次体检最重要的修正是：旧工作分支的六张地图不能直接迁移。主线文件数、路由模块、schema head、身份实现和所有权制度均已变化。因此本工作树中的六张地图全部以 `b1e4898` 重新采样。

## 2. 核心指标

| 维度 | 主线事实 |
|---|---|
| 跟踪文件 | 1,335 |
| JavaScript / Markdown / JSON / HTML | 924 / 205 / 92 / 44 |
| 路由模块文件 | 45 |
| 有序路由段 / 路由域 | 76 / 13 |
| 可静态识别精确 API | 368，未发现重复 method/path |
| 非测试 CommonJS 图 | 526 文件、861 边、1 条循环 |
| test/spec | 393（Node 388、E2E 5） |
| JSON 集合 | 252；83 个有生产数据 owner |
| SQLite migration | 实际 head v14；公开常量仍为 v11 |
| 主 SQLite 表 | 逻辑 30 张，另有专项 SQLite 表 |
| npm audit | 0 个已知漏洞 |

## 3. 十四项架构检查

| 项目 | 结论 |
|---|---|
| Repository structure | `src/config/deploy/regions` 已成形，但 261 个根文件仍高度平铺 |
| Main applications | 主平台、多角色页面、数智医院子站、居民小程序适配、区域部署；外部 showcase/应急/video 不在主线 |
| Major modules | 13 路由域、平台数据/事件/区域/治理、身份安全、领域仓储与 worker |
| Entry points | `server.js`、HTML/JS 页面、router、worker/systemd、GitHub workflows |
| Database | JSON、SQLite v14 migrations、PostgreSQL 目标和专项状态库并存 |
| APIs | 76 路由段、368 精确路由下限，授权与错误契约仍分散 |
| External dependencies | npm 生产仅 `pg`；外部依赖包括 HIS/EMR/LIS/PACS/OIDC/SMS/FHIR/DICOM/对象存储 |
| Shared components | auth、access policy、runtime-source、technical-evidence、shared/state-data；部分入度/宽度过高 |
| Authentication/authorization | HttpOnly Cookie/CSRF/会话仓储已建立；legacy localStorage/demo 与分散数据范围仍需治理 |
| Data flow | 浏览器→API→路由→领域→JSON/SQLite/PostgreSQL/outbox→审计/投影 |
| Background jobs | session timer + 多套 systemd/领域 outbox worker，无统一任务接口 |
| Configuration | `.env` 模板、35 个 config 文件、区域清单、部署模板；外部证据默认阻断生产 |
| Tests | 393 个文件、完整测试/架构/路由/进程门禁较强；缺标准六类入口和广覆盖率 |
| Deployment | GitHub Actions/Pages、systemd、Compose、SQL/现场验证；存在浮动镜像和静态根风险 |

## 4. 主要发现

### 安全

- P0：静态文件服务以仓库根目录为发布根，非 HTML 资产默认允许。
- P0：`data/db.json` 被跟踪、页面读取、Pages 发布并离线缓存。
- P0：审计 `linkBroken` 不导致 `passed=false`。
- P1：871 个浏览器 HTML sink 与 inline CSP 组合扩大 XSS 审计面。
- P1：Cookie 安全路径与 legacy localStorage/demo 路径并存。
- P1：OTP/失败锁定仍有进程内状态。

### 架构

- `server.js` 28.7k 行，仍是组合、种子、存储和领域函数中心。
- `server.js ↔ pilot-cutover-alert-runtime.js` 是真实循环依赖。
- public-health/care runtime context 分别暴露 160/102 个依赖。
- `shared` 有 12 个路由段，需防止继续成为跨域聚合点。
- 六组根目录/`src` 同名模块需逐项确认前后端或迁移角色。

### 数据

- migration 已到 v14，但版本常量、部署检查和测试固定 v11。
- migration checksum 不覆盖 SQL/函数内容。
- 169 个 JSON 集合未进入生产 owner 清单。
- `data/db.json` 同时承担页面、种子、报告和兼容回退，耦合过高。

### 测试与交付

- 主线缺 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 标准脚本。
- coverage 只 include `server.js`。
- CI 综合 job 串接大量报告命令；Actions 未固定 SHA。
- Solution A 使用 `latest` 默认镜像，Orthanc DICOM 端口对宿主开放。

## 5. 本次只读验证证据

- 最新 `main` CI：成功。
- `npm audit --package-lock-only --registry=https://registry.npmjs.org`：0 vulnerabilities。
- `npm run routes:check`：通过，64 files。
- 路由字面扫描：368 个唯一精确 method/path，无重复。
- CommonJS 图：发现 1 条循环。
- 当前 T00 工作树创建时干净并精确基于 `b1e4898`。

迁移后验证补充：`process:verify`、`process:test`、路由门禁、架构测试、平台迭代测试和语法检查均通过。`test:all` 的 388 个 Node 测试文件中仅有一个断言失败：居民小程序发布清单的 SHA-256 摘要偶然包含 `888888`，被面向演示验证码的纯文本正则误报；失败与本次仅文档 diff 无关，且本任务未修改该运行时逻辑。第 10 批已单独补跑并 221/221 通过。

文档迁移完成后的新变更验证结果在 `TODAY_PLAN.md` 和交付说明中更新；不能用上述主线基线结果替代新变更验证。

## 6. 总体评级

| 维度 | 评级 | 说明 |
|---|---|---|
| 功能与领域覆盖 | B | 覆盖广、测试多，但外部现场仍 NO-GO |
| 模块边界 | C | 路由已拆，组合根和上下文仍过宽 |
| 数据治理 | C | 已有所有权和迁移控制，但版本/多事实源不一致 |
| 安全 | C | 身份基础改善，静态发布与审计存在 P0 |
| 测试 | B | 数量和专项门禁强，标准入口与覆盖边界不足 |
| 部署运维 | B/C | 证据门禁完整，静态发布、浮动版本和大 CI 仍有风险 |

结论：允许继续做治理和测试保护，不应在解决 P0 决策前扩大静态数据发布或进行大规模重写。

## 7. 2026-08-20 治理状态更新

原体检中的 schema v14/v11 偏差与 migration 内容漂移风险已由独立 T00 切片治理：v1–v14 注册表和内容指纹冻结，历史 ledger checksum 保持兼容，v15+ 使用内容 checksum；运行时和发布门禁统一派生 head v14。此更新不改写 2026-08-18 的历史采样结论，完成证据以专项测试、PR/main CI 和六张最新地图为准。

TEST-001 候选随后建立六个标准工程入口和 CI/Pages 映射，未改变 API、鉴权、
数据库或 `test:all` 自动发现语义。当前边界是全仓 JavaScript lint 加 3 个文件的
精确遗留规则例外、6 文件增量 typecheck，以及 338/64 文件的 unit/integration
分区；扩大静态基线和缩短超大 API 集成测试继续由 TEST-006 跟踪。历史章节中“标准入口缺失”
保留为 2026-08-18 采样结论，不应再作为当前状态引用。
