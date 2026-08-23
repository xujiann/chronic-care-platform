# ADR：API 幂等行为证据必须显式登记且默认拒绝

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00 证据门禁；T01 首个身份/SMS pilot 行为 owner
- 影响范围：生产 API 目录、外部回调鉴权分类、CI、测试与六张地图

## Problem

`production-api-catalog-v1` 能观察写接口附近的 `idempotent`、`nonce`、request ID 等字符串，但目录曾仅在完全未观察到标记时增加复核阻断。这会让“源码出现过相关词”在目录状态上等同于“幂等行为已由测试验证”，无法区分精确重放、同键异载荷、多实例耐久性和现场生产证据。既有 SMS delivery callback 已有 HMAC、事件级去重和行为测试，却仍被归入未分类自定义鉴权。

## Options

1. 保持源码标记启发式，把观察到标记的写接口视为仓库内已完成。
2. 为全部写接口人工维护第二份完整幂等清单。
3. 保留源码观察字段，另建只登记已验证 endpoint 的小型行为证据合同；未登记写接口一律 `behavior-proof-required`，从单一 SMS callback vertical pilot 开始。

## Advantages

- 方案 1 成本最低，不增加配置。
- 方案 2 可以一次性记录所有接口的理想状态。
- 方案 3 不复制路由目录；合同同时绑定 owner、认证模型、幂等键、载荷绑定、实现锚点与可执行测试，并允许逐 owner 小步扩展。
- 外部 HMAC principal 与平台 session/RBAC 分开表达，不创造并不存在的平台角色。

## Disadvantages

- 方案 1 会持续产生虚假的完成信号。
- 方案 2 容易漂移，并诱使维护者为凑齐清单猜测 owner 或行为。
- 方案 3 会让当前 `review-required` 数量上升，因为过去观察到标记但无行为合同的接口重新失败关闭。
- 文件/测试锚点只能证明受控仓库证据存在，不能证明测试在真实分布式生产环境通过。

## Migration cost

低到中等。目录 schema 从 v1 加法升级到 v2，增加一个小型证据注册表、验证 CLI、负向测试和 governance-api CI 步骤；授权矩阵加入一条既有 SMS callback 的 custom external authentication 声明。HTTP method/path、响应、数据写入、schema、migration、运行时依赖和部署拓扑不变。

## Risk

- 行为测试可能覆盖单进程内存/JSON ledger 而非多实例原子写，因此合同必须显式保持 `distributedExactlyOnceClaimed=false`。
- HMAC nonce 防重放与业务 `eventId` 幂等不是同一保证，目录不能合并二者。
- 测试锚点可能随合理重命名漂移；漂移应触发 owner 复核并更新合同，而不是静默放行。
- 仓库验证通过仍缺真实 provider、密钥托管、网络、耐久数据库、审计留存与现场签字。

## Recommendation

采用方案 3。`production-api-catalog-v2` 同时保留 `source-marker-observed/not-observed` 与独立的 `behavior-verified/behavior-proof-required`。源码标记永远不能自动晋升行为状态；只有机器合同、owner、实现锚点和可执行测试证据一致时才允许 `behavior-verified`。

首个 pilot 为 `POST /api/auth/sms-delivery-callback`：T01 owner，认证机制为 HMAC-SHA256 签名外部 SMS provider，授权范围为 provider message delivery；业务幂等键为 `eventId`，精确重放返回既有事件，同键异载荷返回 `SMS_CALLBACK_EVENT_CONFLICT`。该结论只适用于当前 ledger 行为，不宣称分布式 exactly-once。

所有条目继续固定 `NO-GO`、`productionReady=false` 和外部现场证据阻断。后续扩展必须由相应 owner 提供行为合同和真实负向测试；不得用批量源码扫描结果、注释或猜测 owner 填充注册表。

## 2026-08-23 existing-proof 扩展状态

在不修改运行时和数据库 schema 的前提下，注册表已扩展到 6 份合同。区域共享、直接转诊、科研合规导出 action 与 SMS callback 共 4 个完整 endpoint；两条通用兼容转诊入口只登记 `collection=referrals` / `referrals:*` action-slice。目录必须让 action-slice 保留 `behavior-proof-required` 和 `review-required`，禁止用局部证明晋升整个通用入口。专项测试直接执行身份先于读取、精确重放、同键异载荷、CAS、稳定错误和 AS-IS 审计语义；全部合同仍为 `productionReady=false`、`distributedExactlyOnceClaimed=false`。

同日第二个 owner 切片将注册表扩展到 7 份：只把 T07 `POST /api/online-payments/refunds` 登记为第 5 个完整 endpoint。选择该入口是因为既有 HTTP 与事务测试能够直接证明匿名/角色拒绝、服务端机构绑定、幂等键摘要、精确重放、同键异载荷 `PERSISTENCE_COMMAND_CONFLICT`、版本冲突、并发余额保护及 command/outbox 原子提交。相邻退款 action regex 未登记；T08 普通 integration event/dispatch 因同键异载荷当前只返回旧事件，也未登记。退款 endpoint 在目录中仍受 `runtime-role-policy-not-resolved` 阻断，故全局 `review-required` 数保持 330；该合同不改变运行时、数据库或生产 NO-GO。

## 2026-08-23 T07 第二批零晋升审计

同一注册表新增 3 条最小 `reviewedProofRequired` 记录，但没有新增行为合同。`POST /api/financial-gateways/dispatch` 缺少同键异载荷冲突、并发/CAS 和原子审计/outbox；`POST /api/financial-gateways/reconciliation-runs` 虽有摘要重放/冲突但缺少并发 fencing 与原子命令；`POST /api/disease-payment/formal-grouping/jobs` 虽有重放/冲突和角色检查，但缺资源范围、CAS、稳定 HTTP 错误和原子审计/outbox。拒绝记录与行为合同同 key 时验证失败；它只防止部分证据被误升级，不复制路由目录或创造目标语义。三项及全目录继续 `NO-GO`。
