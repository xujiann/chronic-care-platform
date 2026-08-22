# ADR：慢病随访外部投递采用 SQLite v16 耐久 outbox 与独立 worker

- 状态：Accepted
- 日期：2026-08-22
- Owner：T04（领域事件/投递语义）+ T00（migration、事务 hook、worker、部署与生产门禁）
- 基线：`origin/main@be0c691`

## Problem

既有 `citizen-chronic.followup-updated.v1` 在随访聚合内原子生成事件，但 HTTP `dispatch` 会同步调用
外部 publisher，再把回执写回整份状态。外部成功与本地写回之间不是同一事务；多进程没有租约、退避、
死信和 stale worker fencing，请求超时会诱发重复外部副作用。生产请求路径不能继续直接调用外部系统。

## Options

1. 继续同步 HTTP dispatch，依赖供应方幂等。
2. 只增加内存 worker，不改变持久化。
3. 新增 SQLite v16 专用耐久 outbox；随访状态与 enqueue 同一事务提交，独立 worker 使用版本化租约、
   有界重试、死信和审批摘要 replay，HTTP 仅报告已排队。
4. 直接切换 PostgreSQL 主存储并同时建设 worker。

## Advantages

- 方案 3 消除请求路径外部调用与本地双写；新事件只有在业务状态提交成功时才可见。
- `event_id + source_sha256` 提供幂等与同 ID 内容漂移拒绝；源码列由触发器冻结。
- lease owner、token SHA-256、lease version/expiry 共同 fencing，过期 worker 不能提交结果。
- 尝试次数、指数退避、dead-letter、append-only replay ledger 可运维且不保存原始错误、token、回执 ID。
- 保留既有 PATCH、事件类型和 dispatch path；dispatch path 改为兼容的本地排队确认。

## Disadvantages

- SQLite 适合当前单主机主存储，不提供 PostgreSQL 多节点生产主库语义。
- 领域聚合内嵌 outbox 与专用 outbox 暂时双重表达；专用表是外部投递权威状态，内嵌状态保持兼容 pending。
- 仓库提供 file-backed Ed25519 verifier 装配，但 worker 在仓库内不能自行生成外部签名决定、
  证明供应方回执或伪造现场验收。
- worker 只能打开 canonical `DATA_DIR/health-city.sqlite`；双配置不一致必须启动失败，避免误连空队列。

## Migration cost

中高。追加单主题 SQLite v16 migration、历史内嵌事件回填、`server.js` 同事务 hook、专用 repository/
worker/CLI、systemd/env 合同、preflight/readiness、专项与升级测试。v1–v15 不改写；失败 migration 整体回滚。
PostgreSQL 主切换不在本 ADR 内。

## Risk

- 至少一次发送不可避免：外部接受后 worker 在本地完成前崩溃，租约过期后会重发稳定 event ID；供应方必须
  实现同一幂等请求返回同一绑定回执。
- SQLite writer 与 worker 存在锁竞争，必须使用小批量、busy timeout 和短事务，网络调用不得持有事务。
- 外部成功后本地 completion 可能被过期 lease fencing；worker 必须返回摘要化 `persistence-rejected`
  outcome 并继续后续 claim，不得用同一 stale fence 再次写 failure。单次 run 产生任一
  `persistenceRejected` 或新 `deadLettered` 时，CLI 在打印摘要报告后以非零退出，让 systemd/timer 告警；
  status/preflight/replay 不受影响。
- readiness 和 CLI 只输出稳定 error/reason code、布尔门禁和摘要；不得回显 filesystem/provider
  原始 message、绝对路径或密钥文件名。
- 人工 replay 只接受 actor/reason/replay key 摘要并保持 replay ledger append-only；真实审批原件外置。
- v16 本地通过不代表生产 endpoint、凭据、证书、回执、服务账号、监控和现场演练通过。

## Recommendation

接受方案 3。`server.js` 在既有 SQLite `BEGIN/COMMIT` 内从下一份 followups 状态提取事件，插入或核对
`chronic_followup_dispatch_outbox`；同 ID 异 source digest 失败并回滚。worker 仅在事务提交后领取 due 事件，
存储 token hash 而非 token，所有完成/失败按 owner+token hash+lease version+未过期条件 fencing。失败按有界
指数退避，耗尽进入 `dead-letter`；replay 仅允许死信、使用 digest-only 幂等命令并递增 lease version。

HTTP dispatch 不再调用 publisher、不写外部结果，仅在内部真实 durable storage 可用且健康时返回
`durable-worker` 排队状态；否则 503 失败关闭。`productionReady` 默认 false；仅在运行配置完整、
activation provider 可用，且中央 production-preflight 确认外部 trust verifier 已验证注册表 attestation、
当前 release/artifact 绑定的正式生产证据时才可为 true；本地形状正确的文件或环境开关不能替代外部验证。
worker 可从仓库外 activation registry 读取逐事件决定，决定按 contract、endpoint、event 与 payload
稳定绑定，由 worker 运行时 `requestedAt` 校验已签名的有效时窗，不将不可预知的运行时时间作为 registry 查找键。公钥以
固定 SHA-256 的 Ed25519 SPKI digest 验证；
审批决定及私钥仍由外部信任域生成。真实 HTTPS endpoint、凭据注入、签名回执、供应方幂等核对、systemd 启用、
监控告警和现场验收全部保持外部 NO-GO。方案 4 需另立 PostgreSQL 主切换 ADR/migration/回滚证据。
