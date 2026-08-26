# TECH DEBT — 主线技术债与风险台账

## 2026-08-26 T09 写接口闭环后的剩余债务

| ID | 现状 | 剩余风险/下一步 |
|---|---|---|
| API-IDEM-T09-001 | 八个首发写入口已有直接行为测试和 T00 机器合同：身份先行、角色/机构/资源范围、actor-scoped key、聚合变化后仍返回首次响应快照的零写回放、异载荷 409、CAS、同聚合锁、单次业务+审计持久化和失败无 fallback | 真实多实例与生产数据库证据未闭合；不得宣称跨实例 exactly-once |
| DATA-T09-001 | 遗留聚合以内嵌最多 100 条、含首次公共响应快照的 receipt 和 `domainVersion` 兼容，未改 schema | 响应快照会增加聚合体积；生产 PostgreSQL 应拆分 command receipt 表并建立容量/保留策略、事务仓储、历史回填/回滚及真实多实例竞态证据，需要正式 migration/ADR 后才能推进 |
| RESEARCH-T09-001 | 伦理/数据使用证据、最小化、禁止再识别和独立审批已失败关闭；导出申请保持 pending/blocked | 伦理系统、DLP/导出 worker、审批人与发布人现场责任、长期 WORM/SIEM 证据仍属外部/现场 NO-GO |
| DRUG-T09-001 | 机构整改、医保同步职责已分离；T07 标准 use-case 未被混用 | 医保/HIS 真实回执、机构主数据绑定、PG 多实例与长期审计仍未闭合；兼容命令不可取代 T07 标准状态机 |

T00 机器登记完成后，`production-release-scope` 中对应 `apiReviewRequired` 已减少 8 项（由 17 变为 9）；范围仍为 `FROZEN-NO-GO`。

> 实施分支 AS-IS 快照：基于 `main@4fcdd61`。严重级别表示建议治理优先级；已关闭项以专项测试及 PR/main CI 为回归依据。

## P0 — 必须先决策

当前没有仍处于未决状态的仓库内 P0。真实生产证据和外部历史审计链迁移继续默认阻断上线。

## P1 — 近期治理

| ID | 类别 | 现状与证据 | 风险/缺失测试 |
|---|---|---|---|
| ARC-001 | 超大组合根 | `server.js` 约 28.7k 行 | 变更冲突、初始化耦合、难隔离测试 |
| ARC-003 | 宽接口 | public-health runtime context 160 个依赖 | 组合根和路由同步变化，难形成领域端口 |
| ARC-004 | 前端超大模块 | 数智医院 app 10.5k、citizen 6k、公卫 4.4k | 全局状态、渲染和流程耦合 |
| ARC-007 | 临床子域隔离 | 急救、血液、影像、体检首个查询端口已建立；影像 share/QC 与体检专项分流 action 三个写用例已有目标命令端口、单元测试及顺序/失败特征保护。两个混合路由仍承载其余写命令；血液 GET 有内存规范化，影像和体检 GET 有审计持久化；33 个 operations 字面路径已全部移交 T02 | 继续按特征测试逐用例迁移；专项分流仍使用宽快照/同步写入，未新增幂等、CAS 或事务边界；QC 仍缺幂等、CAS、机构范围且外调先于本地写入；`clinical-blood` 仍混合 blood/imaging，`blood-innovation` 仍混合 blood/physical-examination；禁止已迁用例和 operations 回流，不把兼容切片误写为生产闭环 |
| CHR-001 | 慢病随访事件投递 | 仓库内闭环已建立：SQLite v16 同事务 enqueue、专用 outbox、lease owner/token hash/version/expiry fencing、有界退避、死信、digest-only replay、独立 worker/CLI/systemd 合同与 Ed25519 activation provider；HTTP 请求路径不再同步外发 | 继续 NO-GO：真实 endpoint/凭据、外部签名 activation decision、可信签名回执、供应方幂等核对、PostgreSQL 多节点主存储、监控告警、服务启用和现场验收仍外置；只能承诺至少一次，不得宣称 exactly-once |
| OBJ-001 | 对象存储生产闭环 | OBJ-ADR-002 已 Accepted；T08/T00 owner 固定，SQLite v17 完成结构化元数据/命令/回执/对账、无损回填与 legacy 写冻结；v2 202/status/replay、围栏 worker、退避/DLQ、scope-bound keyset 分页、部署/readiness 合同已建立 | 真实 provider status/abort capability、可信回执、KMS/WORM/扫描、容量/告警、备份恢复、PostgreSQL 多节点主存储和现场验收仍外置，production promotion=false；v1 调用方仍需按有界窗口迁移 |
| OPS-001 | 连续审计耐久信任 | 仓库内来源缺口已关闭：v15 同事务 append-only source、最小投影、cursor 批次、target/source 绑定和 checkpoint v3 已有专项测试；已淘汰历史不可恢复，checkpoint/head 仍在同一本地信任域，SIEM receipt 未独立验签，filesystem 仅是 WORM rehearsal | 继续 NO-GO：需真实签名耐久 receipt、外部单调 anchor、WORM/KMS/保留与恢复能力、Data Owner 投影审批、专用账号及现场验收 |
| SEC-004 | XSS / CSP 面 | 37 个可执行内联脚本、8 个样式块和 13 个静态样式属性已外移；血液主工作台 25 个、急救生命链 6 个、医生工作台 6 个、血液上线看板 8 个、陪诊工作台 8 个、血液创新指挥中心 10 个、体检工作台全部 27 个、产品运行驾驶舱、产品区域运行驾驶舱与质量安全工作台各 1 个、区域切换工作台和血液召回面板各 2 个 HTML sink 已迁为 DOM/text/class/dataset，并分别补恶意 API 载荷 E2E；体检工作台 3 个动态样式 sink 也已迁为固定 class。Inventory v2 对 145 个发布资产锁定 799 个 DOM HTML、6 个动态 URL 和 42 个动态样式风险。Safe URL port 拒绝 javascript/data/userinfo/协议相对/未批准 Origin；兼容 CSP 仍含 `unsafe-inline`，严格策略仅 Report-Only | 2 个 OHIF 导航须在真实 exact-Origin 到位后复核；全清单仍有 799 个 HTML 与 42 个动态样式 sink。真实 OHIF/对象存储 Origin、托管头、严格 CSP 强制试点、独立扫描和渗透验收前继续 NO-GO |
| SEC-005 | 混合会话 | 服务端 token 已禁止写入 localStorage，Cookie/Authorization 并存时 Cookie 优先，旧凭据自动清理；生产 bearer/hybrid 需显式兼容门禁并保持 NO-GO，静态演示仅保存无凭据身份状态 | bearer-only 仍有页面内存凭据、刷新即失效和额外运维状态；XSS/CSP 风险及真实 Cookie/CSRF 现场验证尚未关闭 |
| DATA-008 | 集合 owner 决策 | 252/252 已有机器状态；首发范围 19 个 legacy 集合已按实际读写调用点确认唯一业务 owner/readers/classification 并冻结摘要，169 个 `review-required` 与 1 个 `legacy-quarantined` 仍无可证明数据 owner | 继续按领域 owner 分批确认、归档或迁移；已确认的 19 个仍无版本化生产写合同/migration/现场证据，固定 `productionWriteAllowed=false`，不得把 owner 审查解释为晋升 |
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
| API-002 | 接口目录复核 | v3 仍为 593 项、13 项认证证据且未分类为 0。T00 已登记 21 份幂等合同、19 个 endpoint verified；新增八份 T09 合同覆盖药械/科研职责范围、首次响应快照回放、CAS 和原子审计。`reviewedProofRequired` 为零。314 个写接口仍缺 endpoint 级证明，316 项保持 review-required | 继续逐 owner 补证；`GET /api/state` 最小权限、PG 多实例、长期审计/归档和现场证据仍未决。进程锁不等于跨实例 exactly-once，相关 endpoint 保持 NO-GO |
| JOB-001 | Worker 一致性 | 12 个既有 worker profile、9 个部署入口已建立 `platform-worker-observability.v1` 脱敏兼容投影；领域 state/retry/lease/checkpoint/receipt 仍各自权威，仓库不据此推导生产授权 | 后续接入真实指标/日志采集器与告警路由前，必须另行确认 owner、留存、访问控制和现场启用证据；不得把兼容投影演变为统一领域状态机 |
| TEST-006 | 静态基线与测试性能 | `test/api.test.js` 的全文件 `no-unreachable` 已关闭，原 3 个 care 显式 skip 已由 T05 owner/route 独立特征测试逐块重验并恢复执行；陪诊引用挂号单的存在性/scope 缺口与 handoff `reject/return` 投影已最小修复。typecheck 为 13 个唯一文件；两个前端文件的 16 个重复翻译键已有逐键 shadow/final 值和真实调用保护，去重保持首次插入顺序及最终生效值，lint 文件级例外已归零；API 热点仍作为独立 integration 批次输出耗时。五个可逆夹具切片已分别提取临时 seed/env/server、单个 HIS hospital mock、单个 SIEM alert mock、单个 financial gateway mock 和单个 object-storage gateway mock 生命周期；storage 的签名响应、四类 operation、动态 URL 与 mutable scan 状态通过领域 helper 和最小 setter 保真。43 个子测试顺序摘要继续锁定 suite 成员、断言、超时、单进程语义、CI 预算与 required checks 不降低 | API 巨型测试仍集中约 8,200 行业务断言和其余共享状态。后续只按一个共享服务生命周期继续小步拆分，不得按耗时并行化共享状态或把 helper 变成生产接口。耗时先观察多次 CI 分布，不凭单机样本设门槛；不得恢复文件级 lint 豁免；外部护理/陪诊/HIS/SIEM/financial/storage 投递与现场证据继续由生产 readiness 跟踪，不以本测试关闭 |

## 已关闭

| ID | 关闭日期 | 结果 | 回归保护 |
|---|---|---|---|
| SEC-001 | 2026-08-19 | Node 与 Pages 共用 44 入口显式资源图，未知、越界和敏感路径默认拒绝 | 静态清单构建、HTTP 负向矩阵、PR/main CI 与 Pages 构建 |
| SEC-002 | 2026-08-19 | 浏览器和 Service Worker 只消费生成的 `public-demo.json`；凭据删除、身份联系字段掩码；v61 激活清理 v60 并拒绝缓存源快照 404 | 共享脱敏纯函数、源快照拒绝、Pages 仓库外构建和 PWA 缓存边界 E2E；仓库历史分类残余风险继续由 `DATA_MODEL.md` 的 DATA-006 跟踪 |
| CI-001 | 2026-08-19 | 综合 CI 拆为 governance-api、browser-e2e、release-readiness，并保留 fail-closed 聚合 test | workflow 契约测试锁定步骤归属、预算、always 聚合和三个上游结果 |
| TEST-004 | 2026-08-19 | 居民小程序 JSON 制品改为递归扫描语义字符串值，仅跳过精确摘要字段中的合法 SHA-256；非 JSON 仍全文扫描 | 摘要命中放行，伪造摘要字段、`123456`、`888888`、`DEMO-MOBILE` 语义值和非 JSON 文本均拒绝 |
| DATA-001 | 2026-08-26 | `STORAGE_SCHEMA_VERSION`、storageMeta、部署/readiness/release 门禁统一派生注册表 head v17 | 静态契约、storage、迁移指纹、部署、生产就绪与发布报告测试 |
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
| DATA-003 | 2026-08-22 | 复用既有 collection governance，对 252/252 集合建立唯一 owner/system/review/quarantine 状态；2026-08-26 扩展 `owner-reviewed-legacy`，19 个首发集合完成责任审查但不获得生产写资格；源码 process owner 不推断数据 owner，生产晋升固定失败关闭 | 完整性、唯一性、陈旧/冲突、owner/reader/shared 边界、源码引用漂移、核心概念匹配、缺失/伪造 write policy、Owner/reader 摘要篡改、生产写与晋升负向及治理 CI |
| API-IDEM-001 | 2026-08-22 | `production-api-catalog-v2/v3` 将 source marker 与行为证明分层；2026-08-23 已扩展为 9 个 endpoint 与 2 个 action-slice。T07 financial dispatch 在既有 Accepted 机制内复用 gateway adapter，以 integration event 作为有容量上限的耐久 reservation；按 key 命令锁允许异 key 外调并行，短时状态写锁、SQLite 事务内再校验和显式金融写意图禁止普通全状态写改绑、回退或覆盖 callback evidence/provider projection。其余 1 条 `reviewedProofRequired` 仍不得与合同同 key 并存 | 合同唯一性、身份/范围、重放/冲突、同/异键并发、外调前 reservation、真实 SQLite stale-write/HTTP 映射、JSON 语法及集合形状失败关闭、真实双路由 callback/retry 竞态、终态 dead-letter 防降级、容量 headroom/告警、最终原子审计、失败重放/脱敏、生产晋升与 distributed exactly-once 否定断言；CI 执行全部登记专项行为测试 |
| API-AUTH-001 | 2026-08-23 | `api-authentication-evidence-v1` 为 13 个客观可证入口登记 owner、mechanism、credential source、required/optional/none、replay/CSRF、scope 和负向测试；原 13 个未分类 key 中 12 个真实入口已闭合，1 个跨 handler 虚假 POST 已删除，目录升级 v3 | 唯一性、owner/route、credential、replay-CSRF、实现/测试锚点、T10 401/403、相邻 handler 误配、证据伪造和生产 promotion 负向；所有 593 项继续 NO-GO |
| SEC-010 | 2026-08-23 | strict production preflight 不再只能靠测试注入 externalTrustVerifier；可部署 provider 使用 pinned anchor bundle、Ed25519 双角色签名、撤销/时窗和 release/source/artifact/evidence/registry 精确绑定，默认仍 NO-GO | generic signed-envelope 负向矩阵、CLI 自动装配、synthetic fixture 不提升全局生产状态、deployment package/env/CI 合同与脱敏错误 |
| DEPLOY-002 | 2026-08-23 | 切换行动定义升级为 definitions-only v2；14/14 effective status 仅由共享 Ed25519 provider 验证的当前 release/artifact 绑定决定派生，并接入 strict preflight 与 protected manual workflow；手改 `verified` 固定失败 | 缺 provider/记录、错签/撤销、异 release/digest、过期/未来时间、角色重合、重复 signer、缺转换历史/命令回执、symlink/超限、错误脱敏与 digest-only receipt 负向测试 |
| TEST-007 | 2026-08-23 | 复用既有 T02 handoff harness，对 operations-command 32/32 路径建立数据驱动运行时矩阵；覆盖 19 条只读、13 条写入、三条签名集成入口及 institution 范围 | 闭集唯一性、role/deny-before-read、payload/400/403/404、响应/副作用、审计—写入顺序、审计和写入失败语义；governance-api 显式专项门禁 |
| TEST-005 | 2026-08-23 | 本地/CI 统一 Playwright Chromium；在线根 39 项与居民 13 项继续阻止 Service Worker；PWA 3 项使用独立允许策略、动态端口和临时数据；Go/No-Go 四方业务责任属性不再复用登录角色 `data-role` | 55 项唯一并集/漂移测试、居民同文件 13/13、PWA 重复 9/9、完整标准 E2E；不得把仓库浏览器测试解释为真实 HTTPS、托管安全头或现场验收 |
| TEST-008 | 2026-08-23 | 专用 PWA/Service Worker E2E 验证居民登录后安装、v60→v61 激活清理、受控 update、离线 mobile/citizen 回退、API/源快照 404 缓存边界与逐项注销/清缓存 | 真实 HTTPS 终止、OS 安装提示/策略、浏览器设备矩阵、外部 Origin、现场缓存升级与独立安全验收继续外置；仓库测试不产生生产 GO |
| GOV-001 | 2026-08-23 | `main`/`origin/main` 成为唯一当前集成与默认开发基线；固定 governance tag 仅作可复现证据，旧日期化 workflow 原文冻结 | process plan/verify 默认值、manifest/AGENTS/iteration program 漂移和 CI 目标分支负向测试 |
| DOC-001 | 2026-08-24 | 当前 267 份 Markdown 以路径和 ADR 台账唯一分类为 198 current、68 snapshot、1 superseded；不删除历史证据 | 闭集路径/分类摘要、规则重叠、ADR status 和 snapshot 内容聚合摘要失败关闭 |
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
- 两个区域共享 GET builder 已归位到 `regional-sharing-read-model.v1` 并从 shared runtime 的两个散函数收敛为
  一个 capability；`shared-05` 仍是混合兼容路由，legacy normalize/seed/handoff evidence 仍由组合根注入，
  三个 regional-sharing governance 源文件也仍由 T00 integration 保护，因此不能宣称整个区域共享模块已解耦或已正式完成源码 owner 移交。
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

## 金融账本剩余债务

- 仓库内已关闭自报 `signatureVerified`、跨账项 callback event/nonce 重放和无 provider receipt 的成功 finalize；失败 finalize 也要求完整稳定证据。
- 进程内 attestation 只保护当前进程到当前写调用，不等于跨实例 exactly-once、KMS/HSM 验签、生产 PostgreSQL 事务或外部供应方事实证明。
- 真实 provider 字段映射、来源网络白名单、凭据、对账传输、归档迁移、容量基线及现场签收仍为外部/现场 NO-GO。

## PostgreSQL 主库切换剩余债务

- 仓库已关闭受控评估入口和 deployment artifact 缺脚本/模板/变量的闭包缺口，但没有启用 worker、主读、
  主写、请求路径双写或 runtime cutover。
- SHA-256 固定的 metadata-only 文件只证明交接内容、字段形状和七门计算，不能证明证据真实；真实 PostgreSQL schema 安装、全量迁移、
  连续核对、容量、故障切换、原生备份恢复、回退、监控、审批和现场签字仍是 P0 `NO-GO`。
- sync/reconcile 仍以 SQLite outbox 为当前提交权威；多实例 fencing、正式运维账号、TLS/CA、secret provider
  和 systemd 实际启用必须在目标环境验证。

## 预生产现场控制剩余债务

- 仓库侧五个只读评估入口、参数闭集、部署依赖闭包和 0/2/1 行为测试已建立；不会再把缺失 flag、位置参数、
  重复/空值或 boolean 带值静默接受。
- descriptor 有界读取关闭 symlink 与换 inode 路径替换窗口，但没有为所有通用输入强制独立 SHA-256，不能
  宣称同 inode 同长度的原地内容变更已由该边界证明；真实性仍依赖既有签名/指纹、文件权限与现场复核。
- candidate 已用部署环境摘要检查 anchor 漂移，并拒绝账号、key ID、公钥材料复用及超过 48 小时的信封；
  普通 CLI 不把同进程环境当作信任授权，固定 NO-GO。受信部署宿主绑定、anchor 密钥轮换、HSM/KMS 托管
  和目标环境权限仍须由安全与运维现场验收。
- 96 份联调回执、真实 120、对象存储、生产监控/灾备、四方签字和现场执行仍由外部系统及现场完成，继续
  `NO-GO`。`GO-CANDIDATE` 不等于执行授权或生产上线。

## 9+5 开发组织剩余债务

- 九个一级域和五个临床子域的组合、Owner 对齐、单仓、共享运行时和独立部署未授权现已进入机器门禁。
- 该组织闭集不关闭 ARC-001/003/007：宽运行时上下文、混合临床路由、候选数据 Owner、独立领域测试和独立 CI 仍需逐域治理。
- 组织边界不能用来推断数据 Owner、生产就绪或微服务资格；服务提取仍须满足评分、SLO、运维和现场证据门槛。

## 2026-08-26 首批生产范围治理

- `DEPLOY-003` 已关闭：首批八应用不再只靠文档描述，范围数量、摘要和部署包绑定可机器校验。
- 仓库审查：32 个 scoped API 中 9 个仍需要 repository behavior review；首发 19 个 legacy 数据引用已关闭 owner/governance review，范围 `collectionReviewRequired=0`。它们与 T05 `referrals` exact source binding、T00 `operationsReadiness` derived read model 共 21 个引用仍不具备生产写资格，且全部 38 个引用禁止生产晋级。
- 仍外置：14 个外部依赖/14 个切换行动的真实签名证据、7 个 worker 的现场激活、PostgreSQL 主存储选择以及完整 smoke/回滚/验收。任何一项不得以冻结指纹替代，当前生产状态固定 NO-GO。
