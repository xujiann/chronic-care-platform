# TECH DEBT — 主线技术债与风险台账

> 快照：`main@b1e4898`。严重级别表示建议治理优先级，不代表已获得修复授权。

## P0 — 必须先决策

| ID | 类别 | 现状与证据 | 影响 | 当前动作 |
|---|---|---|---|---|
| SEC-001 | 静态发布 | `serveStatic` 从仓库根目录读取；非 HTML 默认 `ASSET` 放行 | 数据、配置、源码或 Git 元数据可能被读取 | Proposed ADR；建立最小发布 allowlist 和负向测试 |
| SEC-002 | 数据暴露 | `data/db.json` 被跟踪、前端读取、Pages 发布并由 Service Worker 缓存 | 演示/敏感边界失效、离线副本难撤销 | 先分类和迁移缓存，再隔离发布面 |
| SEC-003 | 审计完整性 | `linkBroken` 不计入 `passed`，测试明确允许链漂移通过 | 审计证据可能在链断裂时误报有效 | 独立 ADR 明确语义和兼容成本 |

## P1 — 近期治理

| ID | 类别 | 现状与证据 | 风险/缺失测试 |
|---|---|---|---|
| DATA-001 | Schema | migration head v14，`STORAGE_SCHEMA_VERSION` 与门禁仍为 v11 | 版本报告错误、部署判断漂移；缺版本一致性测试 |
| DATA-002 | Migration | checksum 仅散列 version/name，不散列 migration 内容 | 已应用 SQL 漂移不可检测 |
| ARC-001 | 超大组合根 | `server.js` 约 28.7k 行 | 变更冲突、初始化耦合、难隔离测试 |
| ARC-002 | 循环依赖 | `server.js ↔ pilot-cutover-alert-runtime.js` | 部分初始化、测试顺序和模块复用风险 |
| ARC-003 | 宽接口 | public-health runtime context 160 个依赖 | 组合根和路由同步变化，难形成领域端口 |
| ARC-004 | 前端超大模块 | 数智医院 app 10.5k、citizen 6k、公卫 4.4k | 全局状态、渲染和流程耦合 |
| ARC-007 | 临床子域隔离 | 急救、血液、影像、体检首个查询端口已建立，但两个混合路由仍承载写命令；血液 GET 有内存规范化，影像和体检 GET 有审计持久化，operations 仍错位 | 按特征测试逐用例迁移；禁止新增混合依赖或把兼容副作用误写成纯查询 |
| SEC-004 | XSS 面 | 871 个 HTML sink，CSP 允许 inline | 需可信渲染接口和逐页负向测试 |
| SEC-005 | 混合会话 | HttpOnly Cookie 已建立，但 localStorage/demo bearer 兼容仍存在 | 降级路径、XSS 后凭据暴露面 |
| SEC-006 | OTP 状态 | 验证码和失败锁定仍使用进程内 Map | 多实例/重启下状态不一致 |
| DATA-003 | 集合治理 | JSON 252 个集合，只有 83 个有 owner | 169 个遗留集合不能安全晋升生产 |
| TEST-001 | 标准门禁 | 缺 `build/lint/typecheck/test:unit/test:integration/test:smoke` | 本地与 AI 工作流缺统一入口 |
| TEST-002 | 覆盖率 | c8 只 include `server.js`，固定测试清单 | 新 `src/` 模块和浏览器代码不在覆盖率结论中 |
| TEST-003 | 安全负向测试 | 没有仓库敏感静态路径拒绝矩阵 | SEC-001 无回归保护 |
| DEPLOY-001 | Compose | HAPI 默认 `latest`；Orthanc 暴露 4242 | 不可复现和网络攻击面 |
| SUPPLY-001 | Actions | workflow actions 未固定 commit SHA | 上游标签漂移的供应链风险 |
| GOV-001 | 规则冲突 | 基线中的路由工作流仍写旧集成分支/旧 baseline；本 T00 已校准，待合入关闭 | 操作人员可能走错误合入路径 |

## P2 — 触及时改善

| ID | 类别 | 现状 | Boy Scout 方向 |
|---|---|---|---|
| ARC-005 | shared 边界 | 12 个路由段、50 个上下文依赖 | 新逻辑优先回归所属领域 |
| ARC-006 | 同名模块 | 根目录与 `src/` 有 6 组同名 | 文档明确前端/服务端/迁移角色，不做全仓改名 |
| API-001 | 错误契约 | 多种 JSON 错误格式 | 新 API 使用版本化标准错误接口 |
| API-002 | 接口目录 | 368+ API 缺完整机器目录 | 逐域补 owner/角色/范围/幂等/审计元数据 |
| JOB-001 | Worker 一致性 | 多套 worker/retry/checkpoint 语义 | 建立共同任务状态和观测契约 |
| TEST-004 | 制品扫描误报 | 居民小程序测试对整个 manifest 做 `123456/888888` 文本扫描，SHA-256 摘要可偶然命中 | 改为结构化扫描语义字段，并保留真实演示凭证负向 fixture |
| DOC-001 | 历史文档 | 205 份 Markdown，历史快照与当前规则并存 | 标明 snapshot/current/superseded，不删除历史证据 |
| REPO-001 | 跟踪制品 | `output/pdf` 有 3 个 PDF | 明确生成源、是否保留及禁止手工编辑 |

## 已关闭

| ID | 关闭依据 | 回归保护 |
|---|---|---|
| CI-001 | 综合 CI 已拆为 governance-api、browser-e2e、release-readiness，并保留 fail-closed 聚合 test | workflow 契约测试锁定步骤归属、预算、always 聚合和三个上游结果 |

## 重复、死代码和命名结论

- 主线路由检查和字面路由扫描均未发现重复精确路由；旧分支的 6 组重复公卫路由不能直接套用于主线。
- 同名文件和新旧目录是重复候选，不是删除证据。
- 未确认可直接删除的死代码；删除必须有调用图、测试/运行证据和 owner 决策。
- 英文代码、中文文档、日期化治理文档、readiness/report/audit 命名同时存在。新文件按现行标准命名，旧公共入口不做批量重命名。

## 测试缺口优先顺序

1. 静态敏感路径拒绝矩阵和 Service Worker 缓存撤销。
2. 审计链任意内容/链接断裂均按 ADR 语义判定。
3. schema head、公开版本、migration 内容指纹一致。
4. OTP/锁定在多实例、重启、并发下的一致性。
5. role × permission × resident/institution/region 数据范围矩阵。
6. 组合根循环移除前后的启动、注入和故障测试。
7. 前端 sink 的可信输入/恶意输入回归。
