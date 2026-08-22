# ADR：Custom API 认证必须绑定控制流与可执行负向测试证据

- 状态：Accepted
- 日期：2026-08-23
- Owner：T00 目录与证据门禁；T01/T02/T09 维持既有运行时行为 owner
- 影响范围：API 认证证据、授权矩阵、生产目录、CI、测试和六张地图

## Problem

`production-api-catalog-v2` 已区分幂等源码 marker 与行为证明，但仍有 13 个字面入口因为使用 current session、自定义外部 token、mTLS、签名 callback 或显式 public projection，而未进入 `requireApiRole` 声明矩阵。若按路径名称或相邻字符串批量猜测认证，会把 public、optional session、外部 principal 和词法扫描误配混为一类；若全部长期留空，又无法机器保护已经存在并有负向测试的安全控制流。

## Options

1. 继续把全部 13 项保持未分类，完全依赖人工阅读源码。
2. 按路径和源码 marker 自动推断 required/public、机制、角色与生产状态。
3. 建立只登记客观可证入口的小型认证证据合同，要求 owner、机制、credential source、required/optional/none、replay/CSRF、scope、实现锚点和可执行负向测试同时存在；无法证明的入口继续 `review-required`。

## Advantages

- 方案 1 不增加配置，但已存在的控制不会获得漂移保护。
- 方案 2 自动化覆盖快，却会把相邻分支和字符串误配当成认证事实。
- 方案 3 不复制 593 项路由清单，只保存已验证 custom auth；required、optional 和无凭据公开读取不再混淆。
- SMS callback 的认证从既有幂等合同派生，不形成第二份手工真相。
- 合同只记录 credential 来源类别，不记录 token、Cookie、证书、密钥或真实 provider 数据。

## Disadvantages

- 方案 3 增加配置、验证脚本、负向测试和目录 schema 版本。
- 实现/测试锚点在合理重命名时会触发复核，需要 owner 同步更新。
- 仓库证据只能证明当前控制流和测试行为，不能证明真实 IdP、mTLS 终止层、密钥托管或现场配置。
- 未补直接拒绝测试或存在扫描歧义的入口仍必须保留未分类状态。

## Migration cost

中等。新增 `api-authentication-evidence-v1`、CLI/CI 和治理负向测试；授权矩阵升级 v3，生产目录升级 v3；同步 ADR、六图、ROADMAP、TECH_DEBT 和 TEST-001。HTTP method/path、响应、运行时控制流、数据、schema、migration 和部署拓扑不变；回滚只需移除派生证据层并恢复 v2 目录，不需要数据回滚。

## Risk

- 锚点存在不代表目标政策充分，因此合同必须明确 `replayCsrf` 的 AS-IS 结论，包括“没有仓库单次使用声明”或“兼容 session 路径不声明 CSRF”这类限制。
- `authentication.required=false` 可能表示 public 或 optional；必须由独立 `mode=none|optional` 区分。
- `GET /api/t10-specialty/cutover-pack` 只有在真实 handler、commission 校验及该精确 path 的 401/403 直接拒绝测试同时存在时才能登记。
- method/path 词法提取不能跨越已结束的 handler；否则会把 GET health 与相邻 POST dispatch 拼成不存在的 POST health。
- 所有目录条目仍缺真实环境和现场证据，认证合同不得改变生产状态。

## Recommendation

采用方案 3。当前登记 13 项认证证据：既有 SMS callback 加上原 13 个未分类 key 中的 12 个真实入口；T10 以直接拒绝行为测试闭合，公卫虚假 POST key 由解析器修正删除，未分类认证为 0。`api-authorization-matrix-v3` 和 `production-api-catalog-v3` 只消费验证通过的合同，源码 marker 永远不能自动晋升认证状态。

CI 必须拒绝重复 key/contract、owner 或 route 漂移、跨 handler method/path 误配、credential source 缺失、required/mode 冲突、replay/CSRF 或 scope 缺失、测试锚点漂移、伪造证据 ID 和任何生产 promotion。全部 593 项继续 `NO-GO`、`productionReady=false`；真实 provider、mTLS、Cookie/CSRF、网络和现场验收仍需外部受控证据。
