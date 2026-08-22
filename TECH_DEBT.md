# TECH DEBT — 主线技术债与风险台账

> 实施分支 AS-IS 快照：基于 `main@4fcdd61`。严重级别表示建议治理优先级；已关闭项以专项测试及 PR/main CI 为回归依据。

## P0 — 必须先决策

当前没有仍处于未决状态的仓库内 P0。真实生产证据和外部历史审计链迁移继续默认阻断上线。

## P1 — 近期治理

| ID | 类别 | 现状与证据 | 风险/缺失测试 |
|---|---|---|---|
| ARC-001 | 超大组合根 | `server.js` 约 28.2k 行 | 变更冲突、初始化耦合、难隔离测试 |
| ARC-003 | 宽接口 | public-health runtime context 160 个依赖 | 组合根和路由同步变化，难形成领域端口 |
| ARC-004 | 前端超大模块 | 数智医院 app 10.5k、citizen 6k、公卫 4.4k | 全局状态、渲染和流程耦合 |
| ARC-007 | 临床子域隔离 | 急救、血液、影像、体检首个查询端口已建立，但两个混合路由仍承载写命令；血液 GET 有内存规范化，影像和体检 GET 有审计持久化；33 个 operations 字面路径已全部移交 T02 | 按特征测试逐用例迁移；禁止 operations 回流 T06，不把兼容副作用误写成纯查询 |
| CHR-001 | 慢病随访事件投递 | T04 已有原子内嵌 outbox、幂等 inbox、稳定幂等键、独立 activation verifier、范围过滤、审计和签名 HTTPS publisher；单进程并发可合并，但批次/写回失败会再次发出同幂等键请求 | 仍需 T00/T04 独立任务建立 verifier 组合、持久 worker、lease、attempt/backoff、死信、供应方幂等核对和部署观测；当前不能承诺跨进程 exactly-once，不得关闭生产 Go/No-Go |
| OBJ-001 | 对象存储生产闭环 | 应用侧 v1 响应信任已建立；500 条兼容上限已改为网关调用前失败关闭，既有 immutable/legal-hold 元数据不再被静默淘汰，但仍无无损分页仓储；外部 upload/complete/lifecycle 成功后再写本地状态，缺少 outbox、幂等收敛、失败对账和补偿；网关能力尚无签名声明 | 容量耗尽现在表现为明确不可用而非静默丢证据；外部对象与权威元数据仍可能不一致。后续分别建立无损分页/保留策略、请求外事务的持久命令轨道与对账 worker、版本化能力证明，禁止在请求路径直接双写 |
| OPS-001 | 连续审计耐久信任 | 仓库内来源缺口已关闭：v15 同事务 append-only source、最小投影、cursor 批次、target/source 绑定和 checkpoint v3 已有专项测试；已淘汰历史不可恢复，checkpoint/head 仍在同一本地信任域，SIEM receipt 未独立验签，filesystem 仅是 WORM rehearsal | 继续 NO-GO：需真实签名耐久 receipt、外部单调 anchor、WORM/KMS/保留与恢复能力、Data Owner 投影审批、专用账号及现场验收 |
| SEC-004 | XSS 面 | 871 个 HTML sink，CSP 允许 inline | 需可信渲染接口和逐页负向测试 |
| SEC-005 | 混合会话 | 服务端 token 已禁止写入 localStorage，Cookie/Authorization 并存时 Cookie 优先，旧凭据自动清理；生产 bearer/hybrid 需显式兼容门禁并保持 NO-GO，静态演示仅保存无凭据身份状态 | bearer-only 仍有页面内存凭据、刷新即失效和额外运维状态；XSS/CSP 风险及真实 Cookie/CSRF 现场验证尚未关闭 |
| DATA-003 | 集合治理 | JSON 252 个集合，只有 83 个有 owner | 169 个遗留集合不能安全晋升生产 |
| TEST-002 | 覆盖率 | c8 只 include `server.js`，固定测试清单 | 新 `src/` 模块和浏览器代码不在覆盖率结论中 |
| TEST-003 | 安全负向测试 | 已建立源码、配置、环境模板、Git 元数据、文档和 `data/db.json` 拒绝矩阵 | 后续新增敏感类别必须扩展矩阵 |
| GOV-001 | 规则冲突 | 基线中的路由工作流仍写旧集成分支/旧 baseline；本 T00 已校准，待合入关闭 | 操作人员可能走错误合入路径 |

## P2 — 触及时改善

| ID | 类别 | 现状 | Boy Scout 方向 |
|---|---|---|---|
| ARC-005 | shared 边界 | 12 个路由段、50 个上下文依赖 | 新逻辑优先回归所属领域 |
| ARC-006 | 同名模块 | 根目录与 `src/` 有 6 组同名 | 文档明确前端/服务端/迁移角色，不做全仓改名 |
| ARC-008 | operations 跨域写入 | OPS-02 为保持兼容，将 T06 的既有直写整体移入 T02；其中 `resourceDispatchRequests`、`taskMessages` 的机器 Owner 仍是 T05 care-coordination | 后续仅在独立 ADR/切片中改为 T05 owner port 或版本化事件；在完成行为矩阵前不得直接改写副作用 |
| API-001 | 错误契约 | 多种 JSON 错误格式 | 新 API 使用版本化标准错误接口 |
| API-002 | 接口目录 | 368+ API 缺完整机器目录 | 逐域补 owner/角色/范围/幂等/审计元数据 |
| JOB-001 | Worker 一致性 | 多套 worker/retry/checkpoint 语义 | 建立共同任务状态和观测契约 |
| TEST-006 | 静态基线与测试性能 | lint 对 2 个前端文件的 16 个重复键、`test/api.test.js` 的 3 个不可达块保留精确例外；typecheck 仅覆盖 6 个治理/安全文件；集成首批 API 契约在并发负载下约 174 秒 | 逐规则/逐目录消除例外并扩大类型基线；拆分超大 API 测试和测量 CI 时长，不降低断言或超时门禁 |
| TEST-005 | 浏览器一致性 | Windows 本地配置优先系统 Chrome；完整 36 项中小程序超时恢复用例可受前序共享服务状态影响，而同文件 13/13、单例 1/1、CI Chromium 36/36 通过 | 后续独立测试任务统一本地/CI 浏览器选择并隔离 E2E 服务状态，不在数据治理切片中修改业务代码 |
| TEST-007 | operations 命令行为矩阵 | 32 条路径已有唯一 Owner、静态等价、路由顺序、依赖、授权矩阵和代表性读写/审计保护；直接运行时行为约覆盖 7/32 条 | 在拆分 699 行 handler 或治理 ARC-008 前，补齐每条 action 的 role/scope、deny-before-read、响应、写入与审计顺序契约 |
| DOC-001 | 历史文档 | 205 份 Markdown，历史快照与当前规则并存 | 标明 snapshot/current/superseded，不删除历史证据 |
| REPO-001 | 跟踪制品 | `output/pdf` 有 3 个 PDF | 明确生成源、是否保留及禁止手工编辑 |

## 已关闭

| ID | 关闭日期 | 结果 | 回归保护 |
|---|---|---|---|
| SEC-001 | 2026-08-19 | Node 与 Pages 共用 44 入口显式资源图，未知、越界和敏感路径默认拒绝 | 静态清单构建、HTTP 负向矩阵、PR/main CI 与 Pages 构建 |
| SEC-002 | 2026-08-19 | 浏览器和 Service Worker 只消费生成的 `public-demo.json`；凭据删除、身份联系字段掩码、v60 撤销旧缓存 | 共享脱敏纯函数、源快照拒绝、Pages 仓库外构建；仓库历史分类残余风险继续由 `DATA_MODEL.md` 的 DATA-006 跟踪 |
| CI-001 | 2026-08-19 | 综合 CI 拆为 governance-api、browser-e2e、release-readiness，并保留 fail-closed 聚合 test | workflow 契约测试锁定步骤归属、预算、always 聚合和三个上游结果 |
| TEST-004 | 2026-08-19 | 居民小程序 JSON 制品改为递归扫描语义字符串值，仅跳过精确摘要字段中的合法 SHA-256；非 JSON 仍全文扫描 | 摘要命中放行，伪造摘要字段、`123456`、`888888`、`DEMO-MOBILE` 语义值和非 JSON 文本均拒绝 |
| DATA-001 | 2026-08-22 | `STORAGE_SCHEMA_VERSION`、storageMeta、部署/readiness/release 门禁统一派生注册表 head v15 | 静态契约、storage、部署、生产就绪与发布报告测试 |
| DATA-002 | 2026-08-22 | v1–v14 独立注册并冻结内容指纹，v15+ ledger 写内容 SHA-256，runner 拒绝连续性/name/checksum 漂移 | 空库、v11 升级、重跑、指纹/ledger 漂移、v15 checksum、未来 v16 与失败回滚测试 |
| TEST-001 | 2026-08-20 | 建立 build/lint/typecheck/unit/integration/smoke 标准入口并映射 CI/Pages；test:all 语义不变 | 标准门禁契约、完整测试分区、隔离 smoke、静态发布链、CI 映射和全量回归 |
| ARC-002 | 2026-08-21 | alert runtime 改为显式 provider，worker 在组合边界懒注入既有 readiness；静态环由 1 降为 0，并已通过 PR #132 与 main CI/Pages | 缺失/无效/异常 provider、CLI 默认组合、反向依赖架构守卫和 Chromium E2E |
| SEC-003 | 2026-08-20 | v2 验证器统一运行时/留存语义；内容、链接、结构、重复 ID 严格失败；全量 state 写入不能修改服务端审计数组 | 普通字段、首中尾链接、删除、插入、重排、结构和 API 拒绝回归 |
| SEC-006 | 2026-08-21 | OTP、发送/登录限流和失败锁定迁入共享认证安全状态；生产多实例强制 PostgreSQL，签发/消费/撤销原子化 | SQLite 跨实例、PG 序列化重试、TTL、尝试耗尽、重启、并发单次消费与真实 PG CI 合同 |
| SEC-007 | 2026-08-21 | OIDC ID token 使用 JWKS 验签与完整 trust claims；SMS 生产凭据、随机幂等键、有界重试和健康探针 fail closed | RS/PS/ES、issuer/audience/expiry/nonce、重试稳定性和日志脱敏专项 |
| PG-001 | 2026-08-21 | PostgreSQL schema 隔离、目标 probe、outbox CAS、batch 内容绑定和等版本/tombstone 冲突回滚 | PG/session/identity repository 专项与负向事务测试 |
| SEC-008 | 2026-08-21 | 区域共享 access command 改为服务端授权，复用 `personalRecords`，加入机构/地区/用途/范围/版本、幂等摘要、应用层 CAS、撤销即时拒绝和脱敏审计；state-data 关闭四个 owner 集合与生产 reset 旁路 | 严格/legacy、客户端决定忽略、冲突、撤销、重放、append-only、删改/重排/伪造追加、package CAS 旁路、生产 reset、审计失败与所有权专项 |
| SEC-009 | 2026-08-22 | 对象存储生产端口采用 v1 原始响应 HMAC、独立方向密钥、request/object/version 绑定、上传/下载精确 Origin 与 TTL、RFC3339 时间和显式扫描/生命周期回执；生产配置不完整时在 fetch 前失败关闭，legacy 仅限非生产未启用版本的迁移路径；现场 probe digest 绑定合同与 Origin | 独立已知签名向量；未签名/错签/陈旧/错配响应、空/漂移版本、恶意 Origin、userinfo/fragment、非标准时间、过期/超长 URL、缺失回执、类型强制和上游错误泄露负向及 v1 API 集成测试；readiness、发布环境、部署密钥合同与 ADR 同步 |
| SUPPLY-001 | 2026-08-22 | CI 与 Pages 的六种官方 GitHub Action 全部固定到从官方 `refs/tags/vN` 核验的完整 commit SHA，并保留版本注释 | workflow 契约锁定 18 个引用、40 位 SHA、精确 tag 对应值和版本注释，并拒绝 `actions/*@vN` 回流 |
| DEPLOY-001 | 2026-08-22 | Solution A 四个容器镜像固定到审核版本与 registry digest；Orthanc 认证默认启用，DICOM 默认回环且只接受显式私网接口；占位凭据和漂移镜像生产失败关闭 | readiness 锁定 Compose/环境模板/镜像策略一致性，并覆盖可变镜像、占位凭据、认证关闭、通配/公网绑定和外部证据持续 `NO-GO` |

## 重复、死代码和命名结论

- 主线路由段 ID 和跨模块字面扫描未发现重复，但 P0 对账进一步发现同一公卫 handler 内六组不可达重复分支；已删除第二组并以源码契约测试锁定唯一实现。
- 同名文件和新旧目录是重复候选，不是删除证据。
- 未确认可直接删除的死代码；删除必须有调用图、测试/运行证据和 owner 决策。
- 英文代码、中文文档、日期化治理文档、readiness/report/audit 命名同时存在。新文件按现行标准命名，旧公共入口不做批量重命名。
- 转诊聚合原有 direct、workflow、task 三套并行写语义已在 REF-01a 收敛为 T05 owner command；兼容 API 保留，但守卫测试禁止重新直接写 `referralSystem.referrals`。

## 测试缺口优先顺序

1. 后续 v16+ migration 的数据回填、前滚恢复和多历史版本 fixture。
2. role × permission × resident/institution/region 数据范围矩阵。
3. 前端 sink 的可信输入/恶意输入回归。
4. 将覆盖率从 `server.js` 扩展到新增 `src/` 安全、存储和 worker 模块。
5. 在真实 provider/PostgreSQL/SIEM/WORM 环境重跑合同并封存受控证据引用。

## REG-01A 剩余债务

- `regionalSharingPackages` 与回执仍通过全状态 JSON/SQLite payload 写入；模块级 package queue 已消除当前单进程并发丢写，但不提供跨进程事务，生产必须绑定 PostgreSQL atomic repository，当前门禁继续 NO-GO。
- legacy full-state writer 已拒绝区域集合删改并在省略时保留，生产 reset 也已关闭；非生产 demo reset 仍会恢复 seed，因此演示环境不提供跨 reset 的永久保全，不能作为法定生产 WORM 证据。
- 历史共享包缺少 `regionCode`、`version`、`requiredAuthorizationScopes`，历史授权缺少 grantee/purpose/scopes/version；非生产兼容不能替代回填与核对。
- 两个区域共享 GET builder 和 `shared-05` 混合路由尚未移交 T02；当前只完成 access command 的唯一实现，不能宣称整个区域共享模块已解耦。
- 仍需生产级 role × org × region × purpose × scope × revoke 运行矩阵、真实多实例并发冲突、遮罩全量迁移/回滚及不可变外部审计留存证据。
- 通用 `dataAccessLogs/securityEvents` 仍只有 120 条保留窗口；未截断 access receipt 是当前权威历史，长期 WORM/SIEM 留存仍待生产适配。
## 健康驾驶舱指标治理状态

- DASH-001 已建立首个版本化指标合同，并消除三个 `industry-*` 兼容 ID 的数组位置映射；
  alias 仍保留旧展示语义，必须在调用方迁移完成前视为弃用兼容债务。
- 当前 `population-service-visits.v1` 因来源缺少受认可的签名/版本以及服务端 region scope
  注入而保持 `blocked`。真实日报 owner 签字、字段字典、水位、迟到修订和质量阈值仍是 P1/现场
  阻断项；不得以样例 receipt 或仓库测试替代。
- 其余指标仍是未版本化的展示定义。后续按 T03–T09 数据 owner 逐项建立合同，不能把驾驶舱
  变成跨域写模型或居民级下钻入口。
