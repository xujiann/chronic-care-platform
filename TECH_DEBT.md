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
| CHR-001 | 慢病随访事件投递 | 仓库内闭环已建立：SQLite v16 同事务 enqueue、专用 outbox、lease owner/token hash/version/expiry fencing、有界退避、死信、digest-only replay、独立 worker/CLI/systemd 合同与 Ed25519 activation provider；HTTP 请求路径不再同步外发 | 继续 NO-GO：真实 endpoint/凭据、外部签名 activation decision、可信签名回执、供应方幂等核对、PostgreSQL 多节点主存储、监控告警、服务启用和现场验收仍外置；只能承诺至少一次，不得宣称 exactly-once |
| OBJ-001 | 对象存储生产闭环 | 应用侧 v1 响应信任已建立；500 条兼容上限已改为网关调用前失败关闭，但仍无无损分页仓储，外部成功后再写本地状态；Proposed OBJ-ADR-002 已登记 T08 data owner/T00 technical owner 建议、v17/回填冻结/异步 API/worker/reconcile/readiness 路线和机器阻断台账，未实施任何运行时 | data owner 与 v1/v2 兼容策略仍待人类确认；ADR 未 Accepted 时 CI 禁止 v17/runtime/API/promotion。外部对象与权威元数据仍可能不一致，真实网关 capability、KMS/WORM/扫描、容量、备份恢复和现场验收继续 NO-GO |
| OPS-001 | 连续审计耐久信任 | 仓库内来源缺口已关闭：v15 同事务 append-only source、最小投影、cursor 批次、target/source 绑定和 checkpoint v3 已有专项测试；已淘汰历史不可恢复，checkpoint/head 仍在同一本地信任域，SIEM receipt 未独立验签，filesystem 仅是 WORM rehearsal | 继续 NO-GO：需真实签名耐久 receipt、外部单调 anchor、WORM/KMS/保留与恢复能力、Data Owner 投影审批、专用账号及现场验收 |
| SEC-004 | XSS / CSP 面 | 37 个可执行内联脚本、8 个样式块和 13 个静态样式属性已外移；血液主工作台 25 个、急救生命链 6 个、医生工作台 6 个、血液上线看板 8 个、陪诊工作台 8 个、产品运行驾驶舱与产品区域运行驾驶舱各 1 个 HTML sink 已迁为 DOM/text/class/dataset，并分别补恶意 API 载荷 E2E。29 个原模板 URL occurrence 已由 28 个真实 DOM 绑定迁移和 1 个 `item.action` 扫描误报校正闭合；Inventory v2 对 145 个发布资产锁定 841 个 DOM HTML、6 个动态 URL 和 45 个动态样式风险。Safe URL port 拒绝 javascript/data/userinfo/协议相对/未批准 Origin；兼容 CSP 仍含 `unsafe-inline`，严格策略仅 Report-Only | 仅 2 个 OHIF 导航仍 `review-required`；清单不判断 HTML 输入可信度，仍须治理 841 个 HTML 与 45 个动态样式 sink，并补全角色浏览器回归。真实 OHIF/对象存储 Origin、托管头、独立扫描和渗透验收前继续 NO-GO |
| SEC-005 | 混合会话 | 服务端 token 已禁止写入 localStorage，Cookie/Authorization 并存时 Cookie 优先，旧凭据自动清理；生产 bearer/hybrid 需显式兼容门禁并保持 NO-GO，静态演示仅保存无凭据身份状态 | bearer-only 仍有页面内存凭据、刷新即失效和额外运维状态；XSS/CSP 风险及真实 Cookie/CSRF 现场验证尚未关闭 |
| DATA-008 | 集合 owner 决策 | 252/252 已有机器状态，但 188 个 `review-required` 与 1 个 `legacy-quarantined` 仍无可证明数据 owner | 按领域 owner 分批确认、归档或通过合同/migration 晋升；当前全部生产失败关闭 |
| TEST-002 | 覆盖率 | 原 `server.js` c8 门禁之外，内部边界已从 4 组扩展为 10 组；新增 worker observability、区域共享命令、转诊 owner command、科研合规导出、浏览器响应头和 Safe URL，并把 API governance 基线提高到最新主线实测 99.18/100/82.9 | 其余 `src/` 与页面控制器仍不在覆盖率结论中；Safe URL 的 Node 端口覆盖不等于页面/真实 Origin 覆盖，浏览器业务仍须 Playwright；按风险继续扩展且不得降低任何已合并阈值 |
| TEST-003 | 安全负向测试 | 已建立源码、配置、环境模板、Git 元数据、文档和 `data/db.json` 拒绝矩阵 | 后续新增敏感类别必须扩展矩阵 |
| GOV-002 | 生产授权权威 | runtime 已拒绝仅凭本地 JSON、DR 布尔、普通 evidenceRef 或 synthetic GO 放行，并要求 release/digest/fingerprint/有效期/anti-replay/verifier 的受信 receipt；ADR 仍为 Proposed | 唯一外部签发权威、信任根轮换、耐久 nonce ledger、provider 可用性/灾备和现场验收仍待人工接受；此前生产 false-positive 已关闭，但生产继续 NO-GO |

## P2 — 触及时改善

| ID | 类别 | 现状 | Boy Scout 方向 |
|---|---|---|---|
| ARC-005 | shared 边界 | 12 个路由段、50 个上下文依赖 | 新逻辑优先回归所属领域 |
| ARC-006 | 同名模块 | 根目录与 `src/` 有 6 组同名 | 文档明确前端/服务端/迁移角色，不做全仓改名 |
| ARC-008 | operations 跨域写入 | OPS-02 为保持兼容，将 T06 的既有直写整体移入 T02；其中 `resourceDispatchRequests`、`taskMessages` 的机器 Owner 仍是 T05 care-coordination | 后续仅在独立 ADR/切片中改为 T05 owner port 或版本化事件；在完成行为矩阵前不得直接改写副作用 |
| API-001 | 错误契约 | 多种 JSON 错误格式 | 新 API 使用版本化标准错误接口 |
| API-002 | 接口目录复核 | v3 仍为 593 项、13 项认证证据且未分类为 0。T02 quality-governance item action 已以 session/RBAC、scope-before-receipt、404 零写、exact replay/conflict、record 级串行、SQLite CAS、稳定脱敏错误和一次 record+receipt+三类 audit 写入闭合，使注册表达到 10 份合同、8 个 endpoint verified；未新增 schema/outbox/外部依赖，也不宣称跨实例 exactly-once。325 个写接口仍缺 endpoint 级证明，327 项保持 review-required | 继续逐 owner 补证；financial dispatch 与 formal grouping job 保留 `reviewedProofRequired`。来源集合 owner、真实多实例/PG 行为和现场证据仍未决，该 endpoint 保持 NO-GO |
| JOB-001 | Worker 一致性 | 12 个既有 worker profile、9 个部署入口已建立 `platform-worker-observability.v1` 脱敏兼容投影；领域 state/retry/lease/checkpoint/receipt 仍各自权威，仓库不据此推导生产授权 | 后续接入真实指标/日志采集器与告警路由前，必须另行确认 owner、留存、访问控制和现场启用证据；不得把兼容投影演变为统一领域状态机 |
| TEST-006 | 静态基线与测试性能 | `test/api.test.js` 的全文件 `no-unreachable` 已关闭，原 3 个 care 显式 skip 已由 T05 owner/route 独立特征测试逐块重验并恢复执行；陪诊引用挂号单的存在性/scope 缺口与 handoff `reject/return` 投影已最小修复。typecheck 为 13 个唯一文件；两个前端文件的 16 个重复翻译键已有逐键 shadow/final 值和真实调用保护，去重保持首次插入顺序及最终生效值，lint 文件级例外已归零；API 热点仍作为独立 integration 批次输出耗时。三个可逆夹具切片已分别提取临时 seed/env/server、单个 HIS hospital mock 和单个 SIEM alert mock 生命周期，并以 43 个子测试顺序摘要锁定 suite 成员、断言、超时、单进程语义、CI 预算与 required checks 不降低 | API 巨型测试仍集中约 8,300 行业务断言；financial/storage mock 和其余共享状态仍内联。后续只按一个共享服务生命周期继续小步拆分，不得按耗时并行化共享状态或把 helper 变成生产接口。耗时先观察多次 CI 分布，不凭单机样本设门槛；不得恢复文件级 lint 豁免；外部护理/陪诊/HIS/SIEM 投递与现场证据继续由生产 readiness 跟踪，不以本测试关闭 |

## 已关闭

| ID | 关闭日期 | 结果 | 回归保护 |
|---|---|---|---|
| SEC-001 | 2026-08-19 | Node 与 Pages 共用 44 入口显式资源图，未知、越界和敏感路径默认拒绝 | 静态清单构建、HTTP 负向矩阵、PR/main CI 与 Pages 构建 |
| SEC-002 | 2026-08-19 | 浏览器和 Service Worker 只消费生成的 `public-demo.json`；凭据删除、身份联系字段掩码；v61 激活清理 v60 并拒绝缓存源快照 404 | 共享脱敏纯函数、源快照拒绝、Pages 仓库外构建和 PWA 缓存边界 E2E；仓库历史分类残余风险继续由 `DATA_MODEL.md` 的 DATA-006 跟踪 |
| CI-001 | 2026-08-19 | 综合 CI 拆为 governance-api、browser-e2e、release-readiness，并保留 fail-closed 聚合 test | workflow 契约测试锁定步骤归属、预算、always 聚合和三个上游结果 |
| TEST-004 | 2026-08-19 | 居民小程序 JSON 制品改为递归扫描语义字符串值，仅跳过精确摘要字段中的合法 SHA-256；非 JSON 仍全文扫描 | 摘要命中放行，伪造摘要字段、`123456`、`888888`、`DEMO-MOBILE` 语义值和非 JSON 文本均拒绝 |
| DATA-001 | 2026-08-22 | `STORAGE_SCHEMA_VERSION`、storageMeta、部署/readiness/release 门禁统一派生注册表 head v16 | 静态契约、storage、部署、生产就绪与发布报告测试 |
| DATA-002 | 2026-08-22 | v1–v14 独立注册并冻结内容指纹，v15+ ledger 写内容 SHA-256，runner 拒绝连续性/name/checksum 漂移 | 空库、v11/v15 升级、重跑、指纹/ledger 漂移、v15/v16 checksum、未来 v17 与失败回滚测试 |
| TEST-001 | 2026-08-22 | 建立 build/lint/typecheck/unit/integration/smoke 标准入口并映射 CI/Pages；test:all 与原 server.js 85/85/55 覆盖门禁语义不变；governance-api 静态发布链包含 Safe URL port、Browser Inventory v2，并在 2026-08-23 增加对象存储 Proposed ADR fail-closed 验证 | 标准门禁契约、完整测试分区、隔离 smoke、静态发布链、Inventory v2 精确 occurrence/指纹与 synthetic 负向矩阵、Safe URL 模块/Playwright 恶意协议和 Origin 拒绝、CI 映射、独立内部边界覆盖和全量回归；对象存储专项拒绝未批准 v17/runtime/API/promotion、owner 推断和 ADR/行动台账漂移 |
| JOB-001 | 2026-08-23 | 盘点 12 套真实 worker 语义并建立 `platform-worker-observability.v1` 兼容投影；保留各业务 state/retry/lease/checkpoint/receipt，未创造第二状态机 | 9 个部署入口自动发现、登记/接入漂移、未知 profile、字段扩宽、敏感正文/原始身份/lease token 泄露和生产误授权负向测试；真实采集、告警与现场验收仍外置 |
| TEST-002 | 2026-08-22 | 为 runtime identity、audit chain/source、object storage trust、API catalog/authorization 建立首批四组；2026-08-23 existing-proof 扩展再增加 worker observability、区域共享、转诊、科研导出、浏览器响应头和 Safe URL 六组，合计 10 组，并提高 API governance 旧阈值；报告只存在临时目录 | 配置/脚本治理测试锁定实测阈值不得降低、源码范围不跨组重复，且每组至少一条实际执行的直接负向合同；浏览器端口覆盖不冒充页面、OHIF Origin、CSP 或现场安全证据 |
| ARC-002 | 2026-08-21 | alert runtime 改为显式 provider，worker 在组合边界懒注入既有 readiness；静态环由 1 降为 0，并已通过 PR #132 与 main CI/Pages | 缺失/无效/异常 provider、CLI 默认组合、反向依赖架构守卫和 Chromium E2E |
| SEC-003 | 2026-08-20 | v2 验证器统一运行时/留存语义；内容、链接、结构、重复 ID 严格失败；全量 state 写入不能修改服务端审计数组 | 普通字段、首中尾链接、删除、插入、重排、结构和 API 拒绝回归 |
| SEC-006 | 2026-08-21 | OTP、发送/登录限流和失败锁定迁入共享认证安全状态；生产多实例强制 PostgreSQL，签发/消费/撤销原子化 | SQLite 跨实例、PG 序列化重试、TTL、尝试耗尽、重启、并发单次消费与真实 PG CI 合同 |
| SEC-007 | 2026-08-21 | OIDC ID token 使用 JWKS 验签与完整 trust claims；SMS 生产凭据、随机幂等键、有界重试和健康探针 fail closed | RS/PS/ES、issuer/audience/expiry/nonce、重试稳定性和日志脱敏专项 |
| PG-001 | 2026-08-21 | PostgreSQL schema 隔离、目标 probe、outbox CAS、batch 内容绑定和等版本/tombstone 冲突回滚 | PG/session/identity repository 专项与负向事务测试 |
| SEC-008 | 2026-08-21 | 区域共享 access command 改为服务端授权，复用 `personalRecords`，加入机构/地区/用途/范围/版本、幂等摘要、应用层 CAS、撤销即时拒绝和脱敏审计；state-data 关闭四个 owner 集合与生产 reset 旁路 | 严格/legacy、客户端决定忽略、冲突、撤销、重放、append-only、删改/重排/伪造追加、package CAS 旁路、生产 reset、审计失败与所有权专项 |
| SEC-009 | 2026-08-22 | 对象存储生产端口采用 v1 原始响应 HMAC、独立方向密钥、request/object/version 绑定、上传/下载精确 Origin 与 TTL、RFC3339 时间和显式扫描/生命周期回执；生产配置不完整时在 fetch 前失败关闭，legacy 仅限非生产未启用版本的迁移路径；现场 probe digest 绑定合同与 Origin | 独立已知签名向量；未签名/错签/陈旧/错配响应、空/漂移版本、恶意 Origin、userinfo/fragment、非标准时间、过期/超长 URL、缺失回执、类型强制和上游错误泄露负向及 v1 API 集成测试；readiness、发布环境、部署密钥合同与 ADR 同步 |
| SUPPLY-001 | 2026-08-22 | CI、Pages 与 production promotion 的六种官方 GitHub Action 全部固定到从官方 `refs/tags/vN` 核验的完整 commit SHA，并保留版本注释 | workflow 契约锁定 21 个引用、40 位 SHA、精确 tag 对应值和版本注释，并拒绝 `actions/*@vN` 回流 |
| DEPLOY-001 | 2026-08-22 | Solution A 四个容器镜像固定到审核版本与 registry digest；Orthanc 认证默认启用，DICOM 默认回环且只接受显式私网接口；占位凭据和漂移镜像生产失败关闭 | readiness 锁定 Compose/环境模板/镜像策略一致性，并覆盖可变镜像、占位凭据、认证关闭、通配/公网绑定和外部证据持续 `NO-GO` |
| API-CATALOG-001 | 2026-08-22 | 从 `api-authorization-matrix-v2` 派生 `production-api-catalog-v1`，逐项覆盖 method/path/owner/auth/roles-or-scope/idempotency/生产状态且全部 NO-GO | 目录集合等价、唯一键、必要字段、动态策略、幂等观察和生产放行负向测试；governance-api CI 同时校验矩阵与目录 |
| DATA-003 | 2026-08-22 | 复用既有 collection governance，对 252/252 集合建立唯一 owner/system/review/quarantine 状态；87 个 owner 合同不被复制，源码 process owner 不推断数据 owner，生产晋升固定失败关闭 | 完整性、唯一性、陈旧/冲突、owner/reader/shared 边界、源码引用漂移、核心概念匹配、生产晋升负向与治理 CI |
| API-IDEM-001 | 2026-08-22 | `production-api-catalog-v2/v3` 将 source marker 与行为证明分层；2026-08-23 已扩展为 8 个 endpoint 与 2 个 action-slice。T02 quality-governance item action 在既有 Accepted 机制内复用 owner 状态机、adapter 和全状态 UoW；其余 2 条 `reviewedProofRequired` 仍不得与合同同 key 并存 | 合同唯一性、身份/范围、重放/冲突、同/异载荷并发、SQLite CAS 稳定错误、原子审计、404/写失败零 fallback、生产晋升与 distributed exactly-once 否定断言；CI 执行全部登记专项行为测试 |
| API-AUTH-001 | 2026-08-23 | `api-authentication-evidence-v1` 为 13 个客观可证入口登记 owner、mechanism、credential source、required/optional/none、replay/CSRF、scope 和负向测试；原 13 个未分类 key 中 12 个真实入口已闭合，1 个跨 handler 虚假 POST 已删除，目录升级 v3 | 唯一性、owner/route、credential、replay-CSRF、实现/测试锚点、T10 401/403、相邻 handler 误配、证据伪造和生产 promotion 负向；所有 593 项继续 NO-GO |
| SEC-010 | 2026-08-23 | strict production preflight 不再只能靠测试注入 externalTrustVerifier；可部署 provider 使用 pinned anchor bundle、Ed25519 双角色签名、撤销/时窗和 release/source/artifact/evidence/registry 精确绑定，默认仍 NO-GO | generic signed-envelope 负向矩阵、CLI 自动装配、synthetic fixture 不提升全局生产状态、deployment package/env/CI 合同与脱敏错误 |
| DEPLOY-002 | 2026-08-23 | 切换行动定义升级为 definitions-only v2；14/14 effective status 仅由共享 Ed25519 provider 验证的当前 release/artifact 绑定决定派生，并接入 strict preflight 与 protected manual workflow；手改 `verified` 固定失败 | 缺 provider/记录、错签/撤销、异 release/digest、过期/未来时间、角色重合、重复 signer、缺转换历史/命令回执、symlink/超限、错误脱敏与 digest-only receipt 负向测试 |
| TEST-007 | 2026-08-23 | 复用既有 T02 handoff harness，对 operations-command 32/32 路径建立数据驱动运行时矩阵；覆盖 19 条只读、13 条写入、三条签名集成入口及 institution 范围 | 闭集唯一性、role/deny-before-read、payload/400/403/404、响应/副作用、审计—写入顺序、审计和写入失败语义；governance-api 显式专项门禁 |
| TEST-005 | 2026-08-23 | 本地/CI 统一 Playwright Chromium；在线根 33 项与居民 13 项继续阻止 Service Worker；PWA 3 项使用独立允许策略、动态端口和临时数据 | 49 项唯一并集/漂移测试、居民同文件 13/13、PWA 重复 9/9、完整标准 E2E；不得把仓库浏览器测试解释为真实 HTTPS、托管安全头或现场验收 |
| TEST-008 | 2026-08-23 | 专用 PWA/Service Worker E2E 验证居民登录后安装、v60→v61 激活清理、受控 update、离线 mobile/citizen 回退、API/源快照 404 缓存边界与逐项注销/清缓存 | 真实 HTTPS 终止、OS 安装提示/策略、浏览器设备矩阵、外部 Origin、现场缓存升级与独立安全验收继续外置；仓库测试不产生生产 GO |
| GOV-001 | 2026-08-23 | `main`/`origin/main` 成为唯一当前集成与默认开发基线；固定 governance tag 仅作可复现证据，旧日期化 workflow 原文冻结 | process plan/verify 默认值、manifest/AGENTS/iteration program 漂移和 CI 目标分支负向测试 |
| DOC-001 | 2026-08-23 | 264 份 Markdown 以路径和 ADR 台账唯一分类为 195 current、68 snapshot、1 superseded；不删除历史证据 | 闭集路径/分类摘要、规则重叠、ADR status 和 snapshot 内容聚合摘要失败关闭 |
| REPO-001 | 2026-08-23 | 3 个跟踪 PDF 均登记 SHA-256、大小、页数、引入提交、来源、保留理由和真实 generator 可用性；二进制本体未修改 | exact tracked inventory、digest/size/page/source 漂移负向测试；替换前必须补可复现生成源，禁止手工编辑 |

## 重复、死代码和命名结论

- 主线路由段 ID 和跨模块字面扫描未发现重复，但 P0 对账进一步发现同一公卫 handler 内六组不可达重复分支；已删除第二组并以源码契约测试锁定唯一实现。
- 同名文件和新旧目录是重复候选，不是删除证据。
- 未确认可直接删除的死代码；删除必须有调用图、测试/运行证据和 owner 决策。
- 英文代码、中文文档、日期化治理文档、readiness/report/audit 命名同时存在。新文件按现行标准命名，旧公共入口不做批量重命名。
- 转诊聚合原有 direct、workflow、task 三套并行写语义已在 REF-01a 收敛为 T05 owner command；兼容 API 保留，但守卫测试禁止重新直接写 `referralSystem.referrals`。

## 测试缺口优先顺序

1. 后续 v17+ migration 的数据回填、前滚恢复和多历史版本 fixture。
2. role × permission × resident/institution/region 数据范围矩阵。
3. 前端 sink 的可信输入/恶意输入回归。
4. 在现有 10 个内部边界覆盖组上逐步纳入其余高风险 `src/` 模块；不得降低基线、跨组重复源码，或以静态加载替代行为负向断言。
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

## 慢病随访 durable dispatch 剩余债务

- CHR-001 的仓库内持久 worker/lease/backoff/dead-letter/replay 缺口已关闭；HTTP 不再同步外发。
- 仍是至少一次投递，供应方必须按稳定 event/request identity 幂等并返回同一绑定回执；不得宣称 exactly-once。
- SQLite v16 只覆盖单主机当前存储；多节点 PostgreSQL 主库、正式 migration/rollback/容量演练仍未完成。
- 真实 endpoint、凭据、独立 activation、签名回执、监控告警、systemd 启用与现场联合验收继续 NO-GO。
- 内嵌聚合 outbox 与专用投递表暂时双表达，后续只能在兼容迁移与独立 ADR 下逐步收敛。
