# CURRENT ARCHITECTURE — 主线现状地图

## 2026-09-02 招标需求治理 v2

- `procurement-requirement-governance-v1` 以中性来源别名、PDF SHA-256、受复核页数、文本质量、外部未扫描状态和页码/章节锚点登记候选；原始 PDF、文件名、本地路径和全文不进入仓库状态或浏览器响应。
- 独立能力注册表完整覆盖历史目录引用的 27 个稳定 ID，并以仓库证据、仅声明、缺失或外部证据待补四种状态派生差距；仓库证据不等于现场或生产就绪。
- 产品化中心保持 v1 顶层兼容并增加 `requirementGovernance`；commission 复核入口使用显式幂等键、操作者绑定和乐观版本。复核只能接受、退回补充或本期不纳入，不能自动改代码、创建任务或解除生产门禁。
- 首批 PDF CLI 只做允许目录、普通文件、魔数、大小、摘要、加密/活动内容预检并绑定人工提取清单；不在 HTTP 请求中解析，不调用 OCR、模型、网络或外部工具。全部投影固定 `productionReady=false`。

## 2026-09-01 T03 卫生监督业务闭环

- `public-health-05 / health-supervision` 承载 1 个受范围约束的工作台查询和 4 个命令入口；路由只做认证、manager/组织范围、幂等/CAS、审计和持久化适配，纯状态转换位于 `src/public-health/health-supervision/`。
- 领域模型由主体、任务、不可变检查记录和问题四类集合组成；整改轮次内嵌于问题，父任务在每次提交/复核后重算，只有全部问题 `verified` 才关闭。
- 主体仅保存 `authOrganizations` 的代码化目录引用；API 和页面不返回目录名称或居民/患者字段。通用检查模板是未定版草案，案件、GIS、视频、外部交换和附件不在本增量，生产固定 `NO-GO`。

## 2026-09-01 地区需求产品化接入

- `config/regional-requirement-catalog.json` 以 `regional-requirement-catalog-v1` 登记地区需求来源和 19 项归一化需求；`src/platform/productization/regional-requirement-catalog.js` 负责闭集校验、汇总及只读白名单投影，不读取原始 PDF，也不保存居民、患者、凭据或外部系统载荷。
- 既有 `GET /api/platform/productization/center` 保持 method/path、commission 鉴权和 `platform-productization-center-v1` 顶层版本，仅向响应增加 `regionalRequirements`。未新增 endpoint、写命令、路由插槽或组合根依赖，`server.js` 保持不变。
- 19 项当前均为 `normalized`，只能表示已进入产品化需求目录，不能表示业务能力已经实现、Owner 已审批或现场已验收。Owner review 仍待闭环；R009 已按原始 PDF 第 73–79 页完成视觉复核并标记 `source-verified`，其余条目基于研究稿完成归一化且 PDF 页码仍待补充。
- 本切片不新增业务集合、SQLite/PostgreSQL 表、字段、DDL、migration、worker、第三方依赖或部署单元。地区需求目录和页面摘要均不能替代真实需求确认、领域 Owner 决策、外部联调与签名现场证据，平台继续 `productionReady=false`、生产 `NO-GO`。

## 2026-08-31 T06 急救信号更新资源范围

`PATCH /api/emergency-signals/:id` 保持原 method/path、三类角色、成功响应、领域事件、outbox、CAS 和幂等协议。路由现在于请求体解析前读取目标并执行资源预检，命令在同聚合进程锁内、receipt replay 前再次读取并授权：机构仅能更新自身作为来源、目标或受保护创建者组织的信号，医共体仅能更新所属区县、成员机构或本组织创建的信号，commission 保持既有全局范围。机构范围复用组合根既有 `rowMatchesOrganizationScope`，区县范围只读取现有 `authOrganizations`/`authUsers` 组织事实及信号已有组织/地区/创建者字段；可解析到辖区外组织时拒绝，完全模糊归属失败关闭。拒绝使用既有安全审计端口单独记录，不与业务写混称原子事务。T00 现已把该 endpoint 登记为第 30 个完整行为验证 endpoint；该登记不新增路由、集合、DDL、依赖或部署单元，也不改变生产 `NO-GO`。

## 2026-08-31 当前架构事实机器对账

- `scripts/documentation-fact-drift.js` 现以生产 API 目录、首批生产范围、SQLite migration、仓库 Markdown/PDF 闭集和 Accepted ADR 注册表为机器权威，对 ROADMAP、ARCHITECTURE、六张架构地图和 ADR 索引共 9 份当前文档失败关闭。
- 当前对账值为 SQLite head v17/38 张非内部表、生产 API 615 项/352 个写入口/318 个行为证明缺口/320 个总复核项、首批范围 `FROZEN-NO-GO` 且范围内 API/集合复核与仓库迁移计划缺口均为 0、Markdown 274 份（205 current、68 snapshot、1 superseded）。
- 该验证仅在内存 SQLite 中重放既有 migration 并读取仓库权威；不写 `data/db.json`、运行时 SQLite、生产证据、生成报告或归档产物，不改变任何运行时行为。

## 2026-08-31 首发数据迁移计划闭集

- `config/first-release-data-migration-portfolio.json` 现在唯一分类首发 21 个生产写受阻引用：20 个持久化引用进入唯一迁移波次，`operationsReadiness` 是无 wave、无 promotion 的派生读模型。
- 19 个 Owner-reviewed legacy 为 `repository-plan-ready`，既有 promoted 保持 12；`referrals` 继续使用 T05 Owner source binding。因此注册 phase 为 12/19/31，首发计划为 20+1，仓库计划缺口为 0。
- 该闭集不执行数据迁移、不增加 DDL、不激活 worker、不选择 PostgreSQL primary。21 个引用仍禁止生产写入，真实演练、核对、回滚、多实例、容量/故障切换及现场审批继续 `NO-GO`。

## 2026-08-30 血液路由实现源接入中央治理

- `src/http/runtime-source.js` 继续递归发现 `src/http/routes/**/*.js`，并可从 `config/clinical-subdomains.json#routeImplementationSources` 加载显式登记的子域 HTTP 实现源；不扫描整个目标源码目录。
- 登记项只声明 `subdomain`、仓库相对 `source` 与非空 `mountedBy` facade 清单。domain、T00–T09 process owner、`targetSourceRoot` 和 `routePrefixes` 从同一临床注册表派生；owner/domain 不符合中央映射、API 字面量或授权声明越过唯一子域前缀、facade 未静态 require handler、路径越界/别名/缺失/类型不符时均失败关闭，重复登记只产生一个源码记录。`mountedBy` 是最小静态挂载证明，不替代 T06 的真实 HTTP integration test，也不单独宣称完整运行时可达。
- 血液子域现将唯一可执行实现 `src/clinical-specialties/blood/http-handler.js` 登记为实现源，两个遗留 route facade 只保留静态 require 与委托，不再保存 `String.raw` 治理副本。readiness、授权矩阵与生产目录均由同一 canonical handler 派生；当前授权声明 616、字面条件路由 374、生产目录 609，32 条 `/api/blood-system` 授权记录全部归属 T06 / `clinical-specialties` / `blood`。这不改变模块化单体、共享 Node 运行时或统一部署状态。

## 2026-08-27 生产 Go/No-Go 页面可信渲染增量

- `production-go-no-go-ui.js` 的 4 个 `innerHTML` 与 2 个 `insertAdjacentHTML` 已迁为显式 DOM、`textContent`、闭集 class 和 dataset；指标、前置检查、四方审批及指挥决策的结构与交互保持兼容。
- 恶意 API 字段 E2E 直接覆盖状态、指标、检查、审批、证据引用、决策和边界文本，证明载荷保持惰性文本且不执行事件处理器。
- Inventory v2 当前锁定 793 个 DOM HTML sink、6 个动态 URL sink 与 42 个动态样式风险；严格 CSP、真实托管响应头、独立安全评估和现场验收仍未完成，生产状态保持 `NO-GO`。

## 2026-08-26 T09 写接口行为增量

- 药械监管的 `review`、`remediation`、`insurance-sync` 三个兼容写入口，以及科研数据集的 `approval`、`evidence`、`sandbox-access`、`compliant-exports`、`outcomes` 五个入口，已收敛到两个 T09 command/service 边界。
- 两个边界均在身份/角色/机构与资源范围校验后处理 actor-scoped `Idempotency-Key`，同键同载荷返回首次提交的公共响应快照且不写入，同键异载荷返回稳定 409；`expectedVersion` 显式请求执行聚合 CAS，旧调用未传版本时保留兼容模式。
- 路由按聚合串行并在锁内重读；业务状态、内部 receipt 与既有审计集合只调用一次持久化端口。持久层失败不会回退或二次写。该进程锁不构成跨实例 exactly-once。
- 科研审批要求伦理与数据使用证据、最小必要和禁止再识别，并拒绝申请人自批；机构提交的证据固定为 `submitted`，合规导出仍需后续独立审批/发布。药械监管继续区分机构整改与医保同步职责。
- 仓库没有为这八个入口虚构外部 outbox；T00 已登记八份直接行为合同并验证首发范围缺口减少八项。真实 PostgreSQL、多实例、外部系统和现场证据仍未闭合，全部保持 `productionReady=false`、生产 `NO-GO`。

> 实施分支 AS-IS 快照：历史采样基于 `main@a15d10dc67a7fd89540d3073ece34b5d8c7b942e`；
> 当前对账基线为 `origin/main@fbe815dcb17ddb5a87874e6c6db16aaf8a4d5d70` 加
> `process/t00-postgres-transition-ops-20260824`
> 采集日期：2026-08-24
> 性质：AS-IS，只描述已存在实现，不表达目标状态或实施授权。

## 1. 系统轮廓

```mermaid
flowchart TB
  B["浏览器多页面应用"] --> H["Node HTTP 入口\nserver.js"]
  H --> P["请求壳\n会话水合 / 错误边界 / 静态文件"]
  P --> R["API Router\n77 个有序路由段"]
  R --> C["运行时上下文\n13 个路由域"]
  C --> D["领域与平台模块\nsrc/ + 根目录遗留服务"]
  D --> J["JSON 快照\n252 个集合"]
  D --> S["SQLite\n本地/迁移事实源"]
  D --> PG["PostgreSQL\n生产目标事实源"]
  D --> E["HIS / EMR / LIS / PACS\nOIDC / SMS / FHIR / DICOM"]
  W["systemd timer / worker / outbox"] --> S
  W --> PG
  G["GitHub Actions / Pages"] --> B
  G --> H
```

平台是一个模块化单体，但迁移并不完整：HTTP 路由已经模块化，SQLite migration 注册表已从组合根分离，种子数据、存储装配和大量领域函数仍集中在 `server.js`；浏览器应用仍以多个大体量全局脚本为主。

## 2. 仓库结构

历史 AS-IS 采样曾盘点 1,585 个受跟踪及当时分支待跟踪文件，其中 JavaScript 1,083、Markdown 267、JSON 107、HTML 44；这些是采样快照，不是当前仓库计数权威。当前 Markdown 闭集由 `repository-governance-v1` 动态校验。主要目录：

| 路径 | 作用 | 当前边界 |
|---|---|---|
| `/` | 服务入口、浏览器页面、遗留领域服务 | 仍然平铺，存在同名模块和超大文件 |
| `src/http/` | API router、路由段、运行时上下文、静态资产发布策略 | T00 管组合、顺序和显式静态发布边界；T01–T09 管领域路由 |
| `src/platform/` | 数据、事件、区域、部署、治理与切换控制 | 模块化程度较高，仍依赖组合根注入 |
| `src/identity-security/` | 会话、认证、授权、静态页面守卫、安全审计 | 页面授权与资产发布策略分层执行，均默认拒绝 |
| `src/*领域*/` | 新领域服务、仓储、传输和 worker | 与根目录遗留服务并存 |
| `config/` | 进程、数据所有权、区域、迁移和发布策略 | 多数为机器可读治理事实 |
| `data/` | 被跟踪的 `db.json` 开发/迁移输入 | 浏览器只读取运行时或构建时生成的 `public-demo.json`；生成物不入库 |
| `deploy/` | SQL、systemd、Compose、环境模板和现场验证 | 生产证据默认 NO-GO |
| `scripts/` | 测试、readiness、报告、部署和后台 worker | 187 个根级文件，职责和产物较分散 |
| `test/` | Node test 与 Playwright | 480 个 test/spec 文件（460 Node、20 个 Playwright E2E spec 文件，含居民与 PWA 专项） |
| `regions/` | 多地区部署配置 | 由区域清单和发布注册表控制 |
| `digital-hospital-standard-platform/` | 内嵌数智医院展示前端 | 独立页面但仍共享主仓发布生命周期 |
| `resident-mini-program-platform/` | 居民小程序适配前端 | 独立页面但仍共享主仓发布生命周期 |
| `output/` | 已跟踪的 PDF 制品 | 属生成物，不应作为源码直接编辑 |

`national-access-showcase/`、应急发布 worktree 和视频项目不在此主线跟踪树内；它们不能被描述为主线源码模块，也不能与主应用依赖或数据混用。

## 3. 主应用与入口

| 应用/入口 | 技术 | 责任 |
|---|---|---|
| Node API 服务 | `server.js` | 启动、依赖装配、会话、allowlist 静态读取、合成演示快照、API 调度、SQLite/JSON 兼容；SQLite DDL 委托独立注册表 |
| 平台管理端 | `index.html`、`app.js` | 监管、资源、统计、公共卫生与治理入口 |
| 居民端 | `citizen.html`、`citizen.js` | 居民档案、授权、慢病和服务旅程 |
| 机构/医生/医保/县域端 | 对应 HTML/JS | 各角色工作台 |
| 专项应用 | 公卫、急救、血液、影像、体检、护理、陪诊等页面 | 专项领域体验与演示 |
| 数智医院子站 | `digital-hospital-standard-platform/` | 标准能力展示；单个 `app.js` 约 10.5k 行 |
| 居民小程序适配 | `resident-mini-program-platform/` | 居民端交付适配 |
| API 路由入口 | `src/http/api-router.js`、`src/http/routes/index.js` | 77 个路由段的固定顺序与短路 |
| 后台入口 | `scripts/*worker.js`、systemd timer | outbox 投递、同步、核对和控制任务 |

## 4. 运行时边界

- `main` 是唯一集成和发布分支。
- `config/process-workstreams.json` 定义 T00–T09 所有权；跨域协议、路由顺序、CI、组合根和部署属于 T00。
- `config/domain-data-ownership.json` 登记 111 个 owner 合同；`shared` 和 `state-data` 明确为非所有者域。
- 开发环境允许 JSON 或 SQLite；生产策略声明 PostgreSQL 为事实源且禁止 fallback write。
- 生产 Go/No-Go 默认 `NO-GO`，真实环境、联调、审批和站点证据不能由仓库生成。

## 5. 已确认的边界偏差

1. 静态服务器与 Pages 现按 `config/static-publication.json` 的 45 个入口递归收集显式浏览器资源；未知路径统一 404。
2. 浏览器和 Service Worker 已迁移到合成的 `data/public-demo.json`；`data/db.json` 不进入静态制品。
3. `server.js` 仍约 28.7k 行；SQLite migration 已抽离约 550 行，但路由拆分没有同步拆完组合根和领域实现。
4. ARC-002 已删除 `pilot-cutover-alert-runtime` 对 `server.js` 的反向
   `require`：运行时只消费显式 `controlProvider`，worker CLI 在组合边界懒注入现有
   `pilotCutoverControlPlaneReadiness`。provider 缺失、返回值无效或抛错均投影为受限
   `controlErrorCode` 和 `NO-GO`，不泄露错误正文；当前静态图不再形成该环。PR #132、
   required checks、合并后 main CI 与 Pages 均已通过，主线 ARC-002 已关闭。
5. SQLite v1–v14 已冻结内容指纹，v15 追加 append-only 连续审计 source，v16 追加慢病随访 durable outbox，v17 追加对象存储耐久元数据/命令轨道；`STORAGE_SCHEMA_VERSION`、部署检查和测试统一从注册表 head v17 派生。历史 ledger 的 v1–v14 checksum 保持兼容，v15 起写入内容 SHA-256。
6. TEST-001 已建立统一的 `build`、`lint`、`typecheck`、`test:unit`、`test:integration`、`test:smoke` 入口；build 复用静态发布 allowlist 并默认输出到仓库外，unit/integration 完整分区根测试，smoke 独立启动临时 JSON 运行时。治理 CI 执行 `data:collection-governance:verify`，以源码、owner 和隔离清单漂移失败关闭；原 `server.js` c8 门禁保持 85/85/55，内部边界现以 10 个职责独立组锁定真实覆盖基线和直接负向矩阵：原 identity、audit、object storage、API governance 四组，加上 worker observability、区域共享命令、转诊 owner command、科研合规导出、浏览器响应头策略和 Safe URL 端口六组。所有报告只存在临时目录。TEST-006 已恢复全文件 `no-unreachable`；`internet-nursing.js` 与 `quality-safety.js` 的 16 个重复翻译键已按显式 shadow map 去重，保留原首次插入顺序和最终生效值，lint 不再有文件级规则例外。typecheck 去重后由 9 个唯一文件扩大到 13 个治理/安全边界文件。集成套件成员、顺序、断言和超时不变，但本机三次采样约 294–371 秒的 API 热点现在独立进程执行，并向 CI 日志输出无阈值的批次/套件耗时。
   TEST-006 care revalidation 已把这 3 段显式 skip 全部恢复为可执行断言，并新增陪诊 owner route、护理闭环、护士生命周期 3 个可独立运行的真实 HTTP 特征测试。测试只使用临时 JSON 副本和进程内 owner 证据签发能力；陪诊 handoff 现统一解释 `reject/return`，引用挂号单在补字段前先校验存在性与当前用户 scope。护理通知继续以 planned message + pending outbox 表达，仓库测试不伪造外部送达或现场证据。API 巨型测试的第一个可逆夹具切片已将临时 JSON seed、环境变量和同一 server 生命周期移入 `test/helpers/api-regression-runtime.js`；第二至第五个切片分别只将单个 HIS hospital adapter mock、单个 SIEM alert delivery mock、单个 financial gateway mock 与单个 object-storage gateway mock 的创建、动态回环监听、测试环境和关闭移入各自测试 helper。对象存储 helper 只额外暴露测试正文按原顺序驱动的 `setScanStatus` 控制口。43 个有序子测试、请求/响应与签名断言、告警失败/恢复顺序、金融 callback/reconciliation/retry、对象存储 clean/恶意 provider 文本与 quarantine 断言、超时、单进程执行和 integration 成员均保持不变，并由顺序摘要门禁锁定；synthetic HIS/SIEM/financial/storage 响应均不是外部回执或上线证据。
   TEST-005 将浏览器 E2E 精确分为根 40 项与居民 13 项：两套配置统一使用 Playwright Chromium、
   `serviceWorkers=block` 和动态回环端口；居民套件复用独占 runner、独立临时数据目录并在结束后释放服务。
   在线 53 项并集/唯一性、浏览器策略和 runner 生命周期由专项测试锁定。PWA 专项另以 3 项独占套件允许
   Service Worker，验证居民登录后的 v61 安装、v60 清理、同源成功响应缓存边界、离线导航回退及最终
   unregister/Cache Storage 清理。SEC-004 另增加急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心及体检风险卡各 1 项恶意 API 载荷回归；Go/No-Go 回归锁定四方业务责任属性不再被登录角色过滤器误删。
   当前根 40 + 居民 13 + PWA 3 = 56 项；标准在线 context 仍保持阻止 Service Worker。
7. 审计验证已收敛到 `src/identity-security/audit-chain.js` 的 v2 严格端口；内容、链接、结构和重复 ID 任一异常均失败，验证 API/合规报告不再读取时重封。全量状态写入中的审计数组由服务端管理。
8. 机器 API 授权矩阵现从路由扫描和小型认证证据合同派生 622 条声明；`production-api-catalog-v3` 与 377 个字面条件路由取并集，形成 615 个唯一接口条目（607 个字面路由、8 个运行时策略）。认证证据共 13 项且无未分类。幂等证据注册表现有 36 份直接行为合同：34 个完整 endpoint 与 2 个转诊 action-slice。招标需求人工复核入口保持高风险授权、幂等键和 CAS 失败关闭，复核状态、回执与安全审计已一次持久化，但稳定 HTTP 错误仍待直接证明；T03 卫生监督四个写入口已以直接测试绑定角色/资源范围、精确回放、冲突、CAS、单次持久化和审计行为。352 个写接口中 34 个 endpoint 为 `behavior-verified`，318 个仍为 `behavior-proof-required`；两个通用 action endpoint 使当前 320 项需复核，615 项全部 `NO-GO`。进程锁和 SQLite collection-version CAS 均不被解释为跨实例 exactly-once，`reviewedProofRequired` 当前为 1。
9. P1 生产适配器增量保持现有 owner：T01 的 `production-adapters.js` 承担 JWKS/JWT 与 SMS 协议；OTP、发送/登录限流和失败锁定由共享 `auth-security-state-store` 承载，单主机 SQLite 复用 `state_collections`、生产多实例使用组合根长期 PostgreSQL pool；T00 的 PostgreSQL 组合保持 shadow/rehearsal 且 `productionPrimary=false`，受控迁移评估继续失败关闭。连续审计已使用 v15 同事务 append-only source、最小投影和 checkpoint v3，worker/preflight/systemd 已进入部署制品；未签名 receipt、外部单调 anchor、真实 WORM/KMS 与现场证据使 `productionReady=false` 继续失败关闭。
   浏览器服务端登录不再把 token/bearer 写入 `localStorage`；Cookie 上下文在服务端和浏览器
   水合链路均优先，旧脚本可读 token 会在上下文请求前清除。生产 bearer/hybrid 只有显式
   `AUTH_BEARER_COMPATIBILITY=enabled` 才能启用，启用后仍固定形成 `NO-GO` blocker。
10. T04 的慢病随访事件保留 `citizen-chronic.followup-updated.v1` 和既有 API，T00 在同一 SQLite
    事务中写入 v16 专用 outbox。HTTP dispatch 只在真实 durable queue 可用且健康时确认排队，请求路径
    不再调用外部系统。独立 worker 使用 lease owner/token hash/version/expiry fencing、有界退避、死信和
    digest-only replay；completion/failure 被 stale fence 拒绝时记录摘要化 outcome 并继续批次。可部署的
    file-backed provider 验证外部 Ed25519 签名 activation decision，但真实 decision、endpoint、凭据、可信回执和
    现场验收仍外置，因此当前 `productionReady=false`；有效外部 trust verifier 可通过当前
    release/artifact 绑定的正式证据驱动中央 preflight，无需再改代码。
11. T00 共享对象存储端口新增 `object-storage-gateway-trust-v1`。生产配置缺少合同版本、独立响应
    验签密钥或上传/下载 exact-Origin 白名单时，在发起网络请求前失败关闭；响应先按原始 body 验证
    HMAC、时间窗和 request ID，再绑定 operation、bucket、attachment、object/version。上传/下载
    URL 受 Origin 与 TTL 约束，完成和生命周期必须返回显式扫描/执行回执。非生产未声明版本时暂保留
    legacy 迁移路径，所有生产就绪投影仍为 `false`。当前没有修改 T08 公开路由、数据库或 Schema；
    元数据兼容上限仍为 500 条，但创建第 501 条时会在网关调用前以稳定错误失败关闭，既有
    immutable/legal-hold 元数据不再被静默淘汰；无损分页仓储、外部调用与本地写入双写以及
    供应商能力证明仍是后续债务。
12. SEC-004 第一切片把 `server.js` 的浏览器响应头抽到
    `src/http/browser-security-policy.js`，动态 HTML、静态资源、API、下载与错误响应继续复用同一端口。
    第二切片把 37 个可执行内联脚本统一迁至外部脚本，把 8 个内联样式块和 13 个样式属性迁至外部
    CSS/class；页面角色与账户守卫由 `page-auth-bootstrap.js` 复用同一标准接口。显式发布图的 P0/P1
    静态风险基线现为 0，CI 和静态构建拒绝新增高风险。兼容 CSP 暂时仍含 `unsafe-inline`，严格目标
    仅以 Report-Only 下发，因为动态 CSSOM/全角色运行时回归、真实托管响应头、独立扫描和现场验收
    均未证明，`productionReady` 保持 `false`。
13. DATA-003 首个仓库内治理切片复用现有 `collection-governance`，不新建第二份 owner 清单。
    当前快照 252 个集合已全部获得机器状态：61 个命中既有可写 owner 合同，19 个首发 legacy
    引用完成唯一业务 owner/reader/classification 审查但仍禁止生产写入，3 个为既有系统集合，168 个
    源码精确引用但 owner 未明确的集合标为 `review-required`，1 个仅存在种子的集合标为
    `legacy-quarantined`。owner 清单共 111 个合同，31 个当前不在快照。静态扫描覆盖 599 个受跟踪
    JS/HTML 运行时源；process owner 只作为
    review 证据且固定禁止推断数据 owner。新增/删除、重复状态、引用漂移、非 owner 域和生产晋升
    都在 CI 失败关闭；本切片没有修改 JSON/SQLite、schema、API 或运行时，仍为 `NO-GO`。
14. SEC-004 治理清单已升级为 `browser-security-risk-inventory.v2`，当前扫描 148 个显式发布资产。
    `browser-safe-url-policy.v1` 复用居民短时凭据/对象存储的 HTTPS、无凭据和 exact-Origin 语义，
    为 internal navigation、official source、object storage、`tel` 与 blob download 建立唯一公共端口。
    血液主工作台、急救生命链、医生工作台、血液上线看板、陪诊工作台、产品运行驾驶舱、产品区域运行驾驶舱、质量安全工作台、区域切换工作台、血液召回面板、血液创新指挥中心及体检工作台的可信 DOM/text 切片与 Safe URL 内部闭环后，机器基线锁定
    793 个 DOM HTML sink（31 个资产）、6 个动态 URL sink（2 个资产）和 42 个动态样式/CSSOM/runtime style element
    （13 个资产）；体检工作台自身已无 Inventory v2 P0/P1 finding。29 个原模板 occurrence 中 28 个真实 URL 已改为无 URL 模板加 DOM 绑定，另 1 个
    `item.action` 普通赋值已从扫描误报中排除。当前 4 项是公共端口内受控 mutation/navigation，只有
    2 个缺真实 OHIF exact-Origin allowlist 的导航继续 `review-required`。每个资产/类型同时绑定
    occurrence 数量和规范化源行聚合 SHA-256。相同数量的片段替换、数量增加和新类型/资产都会失败关闭；
    该清单和 Safe URL 端口不是可信 HTML 渲染、严格 CSP、外部 Origin 或生产安全证明；兼容
    `unsafe-inline`、严格 Report-Only 与 `productionReady=false` 均未改变。
15. TEST-007 已在既有 `operations-command-handoff` harness 上建立 32/32 路径的闭集行为矩阵。
    19 条读取和 13 条写入逐路径锁定角色、拒绝先于读取、payload/错误、响应与实际副作用；三条集成入口
    另覆盖签名和机构范围，全部写入口覆盖审计/写入顺序及审计或写入失败不返回成功。专项门禁进入
    governance-api；本切片没有修改 699 行 handler、HTTP、数据、Schema 或生产状态，ARC-008 仍未关闭。

## 6. T06 五子域治理切片

本分支新增 `config/clinical-subdomains.json`，把临床专科正式定义为急救、血液、影像、体检、质量安全五个治理子域。运行时、公开 API、数据库和部署拓扑均未改变，仍由同一个 Node 模块化单体承载。`GET /api/operations/dashboard` 与其余 32 个 operations 命令/治理字面路径均已由 T00 原子移交至 T02 `platform-governance/operations-*`；每个 route segment 保持原 method/path、角色、响应、写入/审计副作用和全局路由插槽。T06 已不再拥有 operations 子上下文，operations 不能被描述成第六个临床子域。

急救第二切片将 `GET /api/emergency/dashboard` 的查询组合移入 `src/clinical-specialties/emergency/dashboard-query.js`。HTTP 路由、鉴权、数据库读取、响应脱敏和全局运行时上下文保持原位；这是一个用例端口迁移，不代表急救子域已完成源码隔离。

血液第三切片将 `GET /api/blood-system` 的组合和机构范围投影移入 `src/clinical-specialties/blood/dashboard-query.js`。旧 HTTP 路由仍负责鉴权、读取和响应；既有交易数组内存规范化仍在查询执行前发生，但没有新增 `writeDatabase`、schema、审计或部署变化。

影像第四切片将 `GET /api/imaging-cloud` 的构建、脱敏和公开响应投影移入 `src/clinical-specialties/imaging/`。旧 HTTP 路由继续负责角色、居民范围和数据访问审计；带 `residentId` 的 GET 仍按遗留行为持久化审计。通用影像响应净化不再由血液混合路由实现，但旧导出保持兼容。

影像首个写边界切片将 `POST /api/imaging-cloud/studies/:id/share` 从 `clinical-blood` 路由迁入既有 `imaging-cloud` 路由，并由 `imaging-study-share-command.v1` 负责既有 share 状态构造和数据访问审计。中央路由段顺序、method/path、角色、居民范围、先范围后 body、单次状态写入、201/403/404 响应及公开响应去密保持不变；其余影像写命令仍在混合路由。

影像第二个写边界切片将 `POST /api/imaging-cloud/studies/:id/qc` 从 `clinical-blood` 路由迁入既有
`imaging-cloud` 路由，并由 `imaging-study-quality-control-command.v1` 构造原质控记录、调用既有
FHIR DiagnosticReport provider，再在成功后更新检查与最多 300 条质控记录。角色、鉴权—读取—404—body
顺序、默认值、FHIR 失败审计、502、单次本地写入、200 响应与公开投影保持不变；没有新增幂等、CAS、机构
范围、schema、worker 或生产授权。外部调用仍先于本地提交，因此该接口和全平台继续 `NO-GO`。

体检第五切片将 `GET /api/physical-exams` 的 Overview 构建、生产 readiness 组合和角色投影移入 `src/clinical-specialties/physical-examination/dashboard-query.js`。后续专项分流切片将 `POST /api/physical-exams/specialized-intakes/:id/actions` 的业务动作、访问审计、安全审计和规范化持久化委托给 `physical-examination-specialized-intake-action-command.v1`；混合 HTTP 路由继续负责鉴权、body、读取/定位、居民范围、错误映射和响应，公开顺序与协议不变。其余体检写命令仍留在 `blood-innovation`，该路由仍是 blood/physical-examination 的遗留混合边界。

## 7. REG-01A 区域共享调阅现状

`POST /api/regional-data-sharing/access-reviews` 的 method/path、commission/institution 角色声明和 `shared-05` 全局插槽保持不变；T00 integration 切片把写决策接到 `src/platform/governance/regional-sharing-access-command.js` 的目标 T02 命令端口，并通过同目录 anti-corruption adapter 只读消费 T04 授权事实。institution 按精确 `orgCode` 调阅来源或目标共享包；commission 在非生产兼容模式保留历史全域范围并显式标记 blocker。GET 的 `accessReviews` 与 POST 响应均使用专用最小投影。

两个区域共享 GET builder 已从 `server.js` 移入 `src/platform/governance/regional-sharing-read-model.js` 的
`regional-sharing-read-model.v1` 只读端口；`shared-05` 继续保留原 URL 插槽，并通过 shared runtime context
消费一个显式、冻结的 read-model capability。组合根只注入现有 normalize、seed、scope、handoff evidence、
UUID 和时钟端口；鉴权先行、一次读取、专用 review 投影、角色脱敏、`latestRecords` 排序以及 handoff
成功后追加安全审计的顺序均保持不变。该模块仍由 T00 integration 源码 owner 承载，目标 bounded context
和四个集合的数据 owner 仍为 T02。

`personalRecords[category=authorizations]` 是当前唯一居民许可事实，撤销状态在每次执行及 inbox replay 前重新读取。客户端 `decision`、`consentStatus` 和备注不参与结论。共享包只允许明确 `ready + passed`，请求与存量边界都拒绝超长或畸形证据。兼容 HTTP 层以模块级 package queue 串行化当前单进程全状态写入；这不等于跨进程事务，因此 production 还要求已授权的 PostgreSQL atomic repository，当前门禁固定 NO-GO。区域现场 evidence lifecycle 仍只证明部署/验收状态，不提供居民数据访问许可。

T00 同时在 T02 `state-data` 兼容边界关闭通用写旁路：四个已登记的区域 owner 集合在 `PUT /api/state` 中只能省略或与当前服务端值深相等，集合级 legacy writer 一律拒绝。命令回执不能由 commission 删除、改写、重排或伪造追加，共享包版本和 `lastAccessReviewId` 也不能绕过命令改写。

演示数据重置仍保留旧 path/角色以支持非生产验收，但 production 请求在读取 seed 或写库前返回 `DEMO_RESET_DISABLED_IN_PRODUCTION`；因此 reset 不是生产回执删除入口。

`GET /api/state` 仍是 T02 的遗留聚合读取兼容边界。commission 响应在既有角色范围投影之后，现通过 `authUsers` 专用读取投影删除 `password` 与 `passwordHash`，保留账号标识、角色、机构、状态及外部身份主体等管理字段；投影创建新账号对象，不修改底层状态快照。其他业务集合、居民数据范围和非 commission 的既有脱敏语义未改变，因此本切片只关闭认证口令直接泄露，不宣称整个 commission 全状态读取已完成最小权限治理。

## 8. T05 转诊单一命令轨道

本实施分支保留 `/api/referrals/:id/actions`、`/api/workflow-actions` 和 `/api/tasks/:id/actions` 三条公开路径及原成功响应形状，但 `collection=referrals` 的写入统一委托 `src/care-coordination/referral-command-service.js`。权限先于 inbox 重放和 CAS；机构按 from/to/org、区县主体按 region、居民按本人或家庭授权校验。聚合、command inbox 和 outbox 继续由既有 UoW 原子提交，未新增 schema、部署进程或转诊核心概念。

## 9. 健康驾驶舱指标治理首切片

`src/platform/governance/health-dashboard-indicator-contract.js` 已建立
`health-dashboard-indicator-contract.v1`，首个定义为月度门急诊人次
`population-service-visits.v1`。合同冻结 T02 聚合 owner、T03 来源 owner、公式、类型、
单位、自然月周期和 `Asia/Shanghai` 时区；测量附带服务端范围、水位、来源版本、质量状态、
阻断项和稳定摘要。现有两个 API、commission 鉴权和旧字段不变，新元数据通过指标条目和
summary 加法暴露。当前样例日报缺受认可的签名/版本且运行时未注入区域范围，因此测量保持
`blocked`，不能作为生产证据。三个历史 `industry-*` ID 由按 canonical ID 键控的显式弃用
alias 兼容，不再按数组位置改名。

## 2026-08-22 慢病随访耐久外部投递增量

T04 的随访 PATCH 仍在聚合内生成 `citizen-chronic.followup-updated.v1`；T00 在同一 SQLite 写事务中
把事件插入/核对 v16 专用 outbox。HTTP dispatch 已变为本地排队确认，不再同步访问外部。独立 worker
完成 lease、外发、回执摘要、退避、死信与 replay；生产 endpoint/凭据/activation/可信回执/现场验收
未由仓库提供，当前 `productionReady=false`；中央 preflight 已可消费外部验证且绑定当前发布的
正式证据解除该门禁。PostgreSQL 主切换不在本切片。

## 2026-08-26 对象存储耐久 v2（AS-IS）

OBJ-ADR-002 已 Accepted，T08 integration 是 data owner、T00 是 technical owner。SQLite head v17 建立五张
结构化附件/命令/不可变回执/对账表；migration 对 legacy collection 做全量 count/digest/orphan 核对并冻结
后续写入。v2 API 以 202/status/replay 与 scope-bound keyset 分页提交本地事务，HTTP 请求路径不调用 provider。

独立 worker 使用 lease owner/token hash/version/expiry fencing、有界退避、dead-letter、digest-only 回执/
错误和审计 replay；持久对账只记录 observation/case/action，不覆盖法律保全或附件事实。机器治理已授权
v17/runtime/API，但 production promotion 仍为 false。真实 provider status/abort capability、KMS/WORM、扫描、
备份恢复、容量告警及现场证据不在仓库内，平台继续生产 `NO-GO`。

## 2026-08-23 严格生产预检证据信任装配

`production-preflight` 的既有 `externalTrustVerifier` 注入点已有可部署 T00 文件型 provider：从仓库外
受控绝对路径读取不超过 1 MiB 的普通非 symlink trust-anchor bundle 与 signed envelope，以独立配置的
bundle SHA-256 固定 Ed25519 公钥集合，并验证 active/revoked/retired 生命周期、双角色独立 signer、
24 小时时窗以及 release/source/artifact/evidence/registry 精确绑定。CLI 缺少或无法验证任一材料时只返回
稳定脱敏原因并保持 NO-GO；结构正确的 synthetic evidence 不能替代外部签名。本切片不改变 Runtime
Go/No-Go、公开 API、数据库或最终生产授权。

## 2026-08-23 生产切换行动证据 v2

`config/production-cutover-actions.json` 只保留 14 项行动定义，已删除可手工宣称完成的 `status`。
`production-cutover-action-evaluation-v2` 只从外部可信 provider 返回的当前 release/artifact 绑定决定派生
effective status；缺记录、provider、有效期、转换历史、命令回执摘要或独立 signer 时均保持 `NO-GO`。
仓库不保存原始现场证据、签名或命令输出。strict preflight 已把 14/14 验证作为额外必要条件；
`production-promotion.yml` 仅允许 main 上手工触发、production environment 与专用 self-hosted label，
通过后只生成不可覆盖的 digest-only eligibility receipt，不宣称部署已执行。

## 2026-08-23 生产 Go/No-Go 受信 receipt 边界（AS-IS）

`buildRuntimeProductionGoNoGoCenter()` 现先从五类本地事实计算当前 `evidenceFingerprint`，再通过显式
`preflightDecisionReceipt + preflightDecisionVerifier` 端口验证第六项 prerequisite。receipt 必须精确绑定
当前 `releaseId`、`sha256:` 制品摘要和证据指纹，并在有效期内由 verifier 确认 single-use 且未重放。
默认 server 未配置 verifier，因此本地 launch/cutover JSON、DR 布尔、普通 evidenceRef、四方签字和
历史 GO 都不能单独形成 `productionGoRecorded=true`。唯一外部生产授权权威仍待 Proposed ADR 人工接受，
真实签发、信任根、耐久防重放和现场验收未完成，平台保持 `NO-GO`。

## 2026-08-23 Worker 兼容观测层

AS-IS 仍是多套独立 worker 状态机：12 个 profile 分别保留自己的 retry、lease、checkpoint、receipt 和终态，
没有引入单一队列或共同任务状态。T00 新增 `platform-worker-observability.v1`，在现有报告上附加闭集、
metadata-only 投影；worker/run 只输出 SHA-256 摘要，错误只输出稳定 code，完整业务报告不进入投影摘要。
部署模板发现的 9 个 server-side 入口均由机器清单登记和 CI 校验。该层固定生产非授权；浏览器 Service
Worker、外部数字医院注册及仍为 Proposed 的对象存储 v2 worker 不在运行合同内。

## 2026-08-23 仓库文档与跟踪 PDF 治理

日常开发和本地 ownership 校验默认使用最新 fetched `origin/main`；固定
`baseline/governance-20260817-enhancement-v1` 仅保留为可复现证据 tag。历史日期化路由/治理文档不再被
`AGENTS.md` 作为当前工作流入口引用，原文和摘要保持不变。

`repository-governance-v1` 从 Git 路径派生；当前闭集为 274 份 Markdown：205 份 `current`、68 份
`snapshot`、1 份 `superseded`，每个路径必须唯一命中规则；snapshot 内容聚合摘要失败关闭。
`output/pdf` 的 3 个 PDF 未修改，分别绑定 SHA-256、大小、页数、引入提交、来源与保留理由。现有仓库
没有任何一个 PDF 的可复现生成器；医院运行脚本只是 verifier，不能被描述为 generator。机器门禁只读，
不生成报告、PDF 或归档产物。

## 2026-08-23 金融写入证据边界

金融 callback 的中央落盘守卫只接受 HMAC 验签器生成、绑定目标 gateway event 的进程内单次证明，并在全账本拒绝 callback event/nonce 跨账项重放。证明不入库、不写日志、不出公共响应。成功 finalize 必须携带与 gateway type、operation、status 一致的 provider receipt 和 dispatchedAt；失败 finalize 必须携带稳定失败码、失败时间、死信原因和死信标记。该边界仍不替代真实 provider、PostgreSQL 多实例和现场验收。

## 2026-08-24 PostgreSQL 受控切换评估与部署闭包

T00 新增独立 `postgres-primary-transition-readiness-v1` CLI，只读取仓库外绝对路径的普通非 symlink、
不超过 1 MiB 的闭集 metadata-only JSON，并以调用方必填的小写 SHA-256 固定打开 descriptor 的内容，
再复用现有主存储配置和七门评估。部署包现包含 migration、
primary-read、adapter、storage-admin、shadow sync/reconciliation 的脚本、schema、service/timer 与 env
模板；两个 PostgreSQL job 已登记但不启动。七门全部通过最多表示可进入受控演练，所有 production/activation
标志保持 false，`DATABASE_URL` 只登记为 secret 引用；HTTP、SQLite、schema 和 strict preflight 未改变。

## 2026-08-25 预生产现场控制闭包

`scripts/platform-preproduction-control.js` 现提供 environment、joint-test、monitoring、rehearsal、candidate
五个只读评估入口。入口参数按命令闭集验证，运行结果用 0/2/1 区分满足门禁、正常 NO-GO 与输入/运行异常；
错误只输出稳定脱敏投影。JSON 与 alert journal 通过打开 descriptor 的有界读取拒绝 symlink 和换 inode 路径
替换；通用输入没有新增内容摘要，真实性仍由既有签名/指纹、权限和现场流程负责。

deployment package 已登记五个入口、完整直接/传递源码、环境变量模板和固定非授权字段。联调仍使用现有
12 系统 × 8 场景（96 份双签回执），监控复用 dead-letter redrive 检查，演练复用六检查点与 outbox/
reconciliation 观察。所有入口要求调用方提供发布号和包指纹并使用系统时钟；candidate 用部署环境 anchor
摘要发现文件漂移，但普通 CLI 不信任同进程可覆盖的环境值并固定 NO-GO/退出 2；五个不同账号、key ID、
公钥材料仍须提交摘要绑定且不超过 48 小时的 Ed25519
签名报告信封，并强校验上游报告与授权账本契约。候选最多
`GO-CANDIDATE`；所有入口固定 `cutoverExecutionAuthorized=false`、
`executionAuthorized=false`、`runtimeCutoverEnabled=false`、`productionPrimary=false`、
`productionReady=false`，没有启动 worker、执行 rollback、写数据库或修改 HTTP。

## 2026-08-25 9+5 开发组织

当前开发组织由 T00 集成治理单元、T01–T09 九个一级开发域和 T06 下五个临床子域组成。T00 不计入一级开发域；五个临床子域也不提升为一级域。机器合同只组合既有 process 与 clinical Owner 权威，不复制路由或数据 Owner。各域可以独立 PLAN、工作树和领域测试，但仓库、`main`、Node.js 运行时、CI 和模块化单体部署保持统一，独立部署继续未授权。

## 2026-08-26 首批生产范围冻结

T00 新增只读 `production-release-scope.v1`，从现有八应用清单、静态发布清单、生产 API 目录、数据集合治理、worker 观测合同、外部联调活动及切换行动定义派生并冻结范围。当前指纹覆盖 8 个应用、9 个页面、32 个 API、38 个数据引用、7 个 worker、14 个外部依赖、16 个应用证据名和 14 个 definitions-only 切换动作。完整校验只在 CI/build-time 读取仓库权威；部署包仅保存已验证的冻结 config 与同一指纹并声明 runtime verifier 不可用，standard smoke 与 strict preflight 失败关闭校验绑定。19 个首发 legacy 引用的 owner/governance review 已关闭，范围内 `collectionReviewRequired=0`；19 个 legacy 集合连同 `referrals` 精确 owner 绑定和 `operationsReadiness` 派生只读模型共 21 个引用仍不具备生产写合同。T09、T04/T05、T02/T06 的 17 份首发行为合同使范围内 `apiReviewRequired=0`；所有 API、集合生产晋级与 worker 激活仍保持 NO-GO，`productionReady=false`。

## 2026-08-28 血液子域最大化独立切片

血液服务端唯一实现已归入 `src/clinical-specialties/blood/`；根目录九个既有 CommonJS 入口仅保留向后兼容导出，浏览器直接加载的 `blood-domain.js` 与 `blood-standard-registry.js` 继续作为公开静态适配器。`clinical-blood`、`blood-innovation` 两个遗留路由段仍占用原全局插槽，但已不再实现 `/api/blood-system`，只向血液子域 HTTP handler 委托，因此 URL、角色、状态码、写入和路由顺序不变。

血液边界 v1 冻结 API 前缀、34 个实际自有集合、1 个外部只读集合、共享平台端口和三个版本化跨域契约。写路径通过 legacy state repository 的顶层集合白名单进入原统一持久化函数；dashboard 为保持既有端口对象身份仍使用只读兼容入口。运行时仍是共享 Node 模块化单体，中央数据 Owner、migration、独立 CI 与独立部署均未被本切片授权。

T00 收尾已将 34 个冻结集合完整同步为临床注册表的 `candidateCollections`，`registeredCollections` 继续为空，因而没有生产 Owner 晋升。`blood-system:test` 现包含边界测试并在治理 CI 中显式执行。T10 对临床用血的展示已改为 `shared-platform-node-runtime`、逻辑模块选择和逻辑禁用回滚；`independentDeploymentAuthorized=false`、`productionReady=false` 与 `NO-GO` 为固定平台边界。

## T07 医保支付独立开发产品线（2026-08-30）

`config/development-organization.json` 已将 `insurance-payment` 确立为 T07 拥有的独立开发产品线。独立性只覆盖产品 Roadmap、Backlog、process 工作树和领域测试；既有按病种付费、金融网关、退款、凭证、验收和证据能力不迁移、不复制，也不改变公共 API。当前仍是单仓、T00/main 集成、共享 Node.js、模块化单体统一部署，`independentDeploymentAuthorized=false`、`productionReady=false`。
