# TECH DEBT — 主线技术债与风险台账

> 实施分支 AS-IS 快照：基于 `main@a15d10d`。严重级别表示建议治理优先级；已关闭项以专项测试及 PR/main CI 为回归依据。

## P0 — 必须先决策

当前没有仍处于未决状态的仓库内 P0。真实生产证据和外部历史审计链迁移继续默认阻断上线。

## P1 — 近期治理

| ID | 类别 | 现状与证据 | 风险/缺失测试 |
|---|---|---|---|
| ARC-001 | 超大组合根 | `server.js` 约 28.2k 行 | 变更冲突、初始化耦合、难隔离测试 |
| ARC-003 | 宽接口 | public-health runtime context 160 个依赖 | 组合根和路由同步变化，难形成领域端口 |
| ARC-004 | 前端超大模块 | 数智医院 app 10.5k、citizen 6k、公卫 4.4k | 全局状态、渲染和流程耦合 |
| ARC-007 | 临床子域隔离 | 急救、血液、影像、体检首个查询端口已建立，但两个混合路由仍承载写命令；血液 GET 有内存规范化，影像和体检 GET 有审计持久化；operations dashboard 已移交 T02，32 个 command 字面路径仍错位 | 按特征测试逐用例迁移；禁止 dashboard 回流 T06，后续独立移交 command，不把兼容副作用误写成纯查询 |
| SEC-004 | XSS 面 | 871 个 HTML sink，CSP 允许 inline | 需可信渲染接口和逐页负向测试 |
| SEC-005 | 混合会话 | HttpOnly Cookie 已建立，但 localStorage/demo bearer 兼容仍存在 | 降级路径、XSS 后凭据暴露面 |
| DATA-003 | 集合治理 | JSON 252 个集合，只有 83 个有 owner | 169 个遗留集合不能安全晋升生产 |
| TEST-002 | 覆盖率 | c8 只 include `server.js`，固定测试清单 | 新 `src/` 模块和浏览器代码不在覆盖率结论中 |
| TEST-003 | 安全负向测试 | 已建立源码、配置、环境模板、Git 元数据、文档和 `data/db.json` 拒绝矩阵 | 后续新增敏感类别必须扩展矩阵 |
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
| TEST-006 | 静态基线与测试性能 | lint 对 2 个前端文件的 16 个重复键、`test/api.test.js` 的 3 个不可达块保留精确例外；typecheck 仅覆盖 6 个治理/安全文件；集成首批 API 契约在并发负载下约 174 秒 | 逐规则/逐目录消除例外并扩大类型基线；拆分超大 API 测试和测量 CI 时长，不降低断言或超时门禁 |
| TEST-005 | 浏览器一致性 | Windows 本地配置优先系统 Chrome；完整 36 项中小程序超时恢复用例可受前序共享服务状态影响，而同文件 13/13、单例 1/1、CI Chromium 36/36 通过 | 后续独立测试任务统一本地/CI 浏览器选择并隔离 E2E 服务状态，不在数据治理切片中修改业务代码 |
| DOC-001 | 历史文档 | 205 份 Markdown，历史快照与当前规则并存 | 标明 snapshot/current/superseded，不删除历史证据 |
| REPO-001 | 跟踪制品 | `output/pdf` 有 3 个 PDF | 明确生成源、是否保留及禁止手工编辑 |

## 已关闭

| ID | 关闭日期 | 结果 | 回归保护 |
|---|---|---|---|
| SEC-001 | 2026-08-19 | Node 与 Pages 共用 44 入口显式资源图，未知、越界和敏感路径默认拒绝 | 静态清单构建、HTTP 负向矩阵、PR/main CI 与 Pages 构建 |
| SEC-002 | 2026-08-19 | 浏览器和 Service Worker 只消费生成的 `public-demo.json`；凭据删除、身份联系字段掩码、v60 撤销旧缓存 | 共享脱敏纯函数、源快照拒绝、Pages 仓库外构建；仓库历史分类残余风险继续由 `DATA_MODEL.md` 的 DATA-006 跟踪 |
| CI-001 | 2026-08-19 | 综合 CI 拆为 governance-api、browser-e2e、release-readiness，并保留 fail-closed 聚合 test | workflow 契约测试锁定步骤归属、预算、always 聚合和三个上游结果 |
| TEST-004 | 2026-08-19 | 居民小程序 JSON 制品改为递归扫描语义字符串值，仅跳过精确摘要字段中的合法 SHA-256；非 JSON 仍全文扫描 | 摘要命中放行，伪造摘要字段、`123456`、`888888`、`DEMO-MOBILE` 语义值和非 JSON 文本均拒绝 |
| DATA-001 | 2026-08-20 | `STORAGE_SCHEMA_VERSION`、storageMeta、部署/readiness/release 门禁统一派生注册表 head v14 | 静态契约、storage、部署、生产就绪与发布报告测试 |
| DATA-002 | 2026-08-20 | v1–v14 独立注册并冻结内容指纹，保留历史 ledger；v15+ ledger 写内容 SHA-256，runner 拒绝连续性/name/checksum 漂移 | 空库、v11 升级、重跑、指纹/ledger 漂移、v15 checksum、失败回滚与 schema fingerprint 测试 |
| TEST-001 | 2026-08-20 | 建立 build/lint/typecheck/unit/integration/smoke 标准入口并映射 CI/Pages；test:all 语义不变 | 标准门禁契约、完整测试分区、隔离 smoke、静态发布链、CI 映射和全量回归 |
| ARC-002 | 2026-08-21 | alert runtime 改为显式 provider，worker 在组合边界懒注入既有 readiness；静态环由 1 降为 0，并已通过 PR #132 与 main CI/Pages | 缺失/无效/异常 provider、CLI 默认组合、反向依赖架构守卫和 Chromium E2E |
| SEC-003 | 2026-08-20 | v2 验证器统一运行时/留存语义；内容、链接、结构、重复 ID 严格失败；全量 state 写入不能修改服务端审计数组 | 普通字段、首中尾链接、删除、插入、重排、结构和 API 拒绝回归 |
| SEC-006 | 2026-08-21 | OTP、发送/登录限流和失败锁定迁入共享认证安全状态；生产多实例强制 PostgreSQL，签发/消费/撤销原子化 | SQLite 跨实例、PG 序列化重试、TTL、尝试耗尽、重启、并发单次消费与真实 PG CI 合同 |
| SEC-007 | 2026-08-21 | OIDC ID token 使用 JWKS 验签与完整 trust claims；SMS 生产凭据、随机幂等键、有界重试和健康探针 fail closed | RS/PS/ES、issuer/audience/expiry/nonce、重试稳定性和日志脱敏专项 |
| PG-001 | 2026-08-21 | PostgreSQL schema 隔离、目标 probe、outbox CAS、batch 内容绑定和等版本/tombstone 冲突回滚 | PG/session/identity repository 专项与负向事务测试 |
| OPS-001 | 2026-08-21 | 连续审计投递使用安全 SIEM/WORM adapter、checkpoint v2 和既有 cutover alert lifecycle | TLS/receipt/retry/WORM/rollback/lock/systemd 专项 |

## 重复、死代码和命名结论

- 主线路由段 ID 和跨模块字面扫描未发现重复，但 P0 对账进一步发现同一公卫 handler 内六组不可达重复分支；已删除第二组并以源码契约测试锁定唯一实现。
- 同名文件和新旧目录是重复候选，不是删除证据。
- 未确认可直接删除的死代码；删除必须有调用图、测试/运行证据和 owner 决策。
- 英文代码、中文文档、日期化治理文档、readiness/report/audit 命名同时存在。新文件按现行标准命名，旧公共入口不做批量重命名。
- 转诊聚合原有 direct、workflow、task 三套并行写语义已在 REF-01a 收敛为 T05 owner command；兼容 API 保留，但守卫测试禁止重新直接写 `referralSystem.referrals`。

## 测试缺口优先顺序

1. 后续 v15+ migration 的数据回填、前滚恢复和多历史版本 fixture。
2. role × permission × resident/institution/region 数据范围矩阵。
3. 前端 sink 的可信输入/恶意输入回归。
4. 将覆盖率从 `server.js` 扩展到新增 `src/` 安全、存储和 worker 模块。
5. 在真实 provider/PostgreSQL/SIEM/WORM 环境重跑合同并封存受控证据引用。
