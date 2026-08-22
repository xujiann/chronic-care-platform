# ADR：生产 Go/No-Go 采用受信 preflight decision receipt 边界

- 状态：Proposed
- 日期：2026-08-23
- 决策 Owner：待变更管理委员会与 T00 共同确认
- 影响范围：全局生产 Go/No-Go runtime、发布标识、制品摘要、证据指纹与防重放验证端口
- 非目标：本 ADR 不指定唯一生产授权系统，不签发真实 receipt，也不把仓库或测试提升为生产权威

## Problem

既有 runtime 可仅凭本地 launch-smoke/cutover JSON、DR 布尔、普通 evidenceRef、四方签字和一条本地
GO 记录得到 `productionGoRecorded=true`。这些事实不能证明当前 release、当前不可变制品和当前证据包
已由受信变更管理权威批准，也不能证明同一授权未被重放。

## Options

1. 保留本地聚合逻辑，把文件、环境布尔和 evidenceRef 视为生产授权；
2. 在 runtime 增加受信 decision receipt 验证端口，严格绑定 `releaseId + artifactDigest + evidenceFingerprint`、有效期与防重放 verdict；
3. 立即选定某个外部 CAB/发布平台并将所有审批、签名和发布操作一次迁入。

## Advantages

- 方案 1 无迁移成本；
- 方案 2 以最小改动关闭本地证据误放行，验证器缺失、异常、漂移、过期或重放均失败关闭，并且不猜测现场权威；
- 方案 3 可形成单一签发权威和端到端运行闭环。

## Disadvantages

- 方案 1 保留生产 false-positive；
- 方案 2 只定义消费和验证边界，尚无真实签发者、密钥/信任根、耐久 nonce ledger 或现场流程；
- 方案 3 在 owner、外部系统和信任方案未批准时会造成厂商锁定与高风险迁移。

## Migration cost

方案 2 为低到中：增加纯验证端口、runtime 两阶段指纹计算、负向测试和文档；后续接入真实权威需要
独立 provider、信任根轮换、防重放持久存储、可用性/灾备和现场演练。方案 3 为高，必须另立 Accepted
ADR、迁移/回滚计划及多方验收。

## Risk

- verifier 若由本地布尔、synthetic fixture 或普通文件替代，会重新打开漏洞；默认 server 不得提供此替代；
- receipt 若不精确绑定 release、SHA-256 制品摘要和当前证据指纹，旧授权可被移用；
- receipt 只允许八个合同字段，receipt/release/verifier 标识符必须符合稳定白名单；额外或敏感字段一律拒绝；
- 无有效期、超过 24 小时有效窗、未来时间检查和外部 single-use/replay verdict 会允许陈旧或重复授权；
- verifier 错误正文可能包含密钥或供应方响应，runtime 只允许输出稳定脱敏代码；
- 当前内存验证投影不是签发权威，进程重启后必须重新验证，不能序列化后当作可信事实；
- 唯一生产授权权威、信任根、receipt 签名格式和防重放存储仍待人工接受，生产继续 `NO-GO`。

## Recommendation

建议先实施方案 2 的最小 fail-closed 不变量：只有由显式 verifier 确认、在有效期内、精确绑定当前
`releaseId + sha256 artifactDigest + evidenceFingerprint` 且返回 `singleUseEnforced=true`、
`replayDetected=false` 的 GO receipt，才可通过第六项 runtime prerequisite。本地 JSON、DR 布尔、
普通 evidenceRef、布尔 verdict、Promise、异常 verifier 和可伪造投影全部不能替代。

本 ADR 保持 `Proposed`。它仅关闭 false-positive，不宣称已经形成统一生产授权权威。由哪一套外部
变更管理系统签发、如何验签和耐久防重放，必须经人工接受的新 ADR 与现场验收后才能接入。
