# ADR：连续审计采用 append-only source v2

- 状态：Accepted
- 日期：2026-08-22
- Owner：T00（存储、worker 与部署）+ T01/T02（审计数据定义）
- 影响范围：SQLite migration、平台状态事务、连续审计 worker/checkpoint；不授权生产切换

## Problem

当前 worker 轮询 `state_collections` 中最多保留 120 条的 `securityEvents` 与
`dataAccessLogs` 展示链。窗口淘汰会重封剩余记录，因此两次 timer 之间既可能永久漏掉已被淘汰的
事件，也可能把同一事件识别成新内容。现有 checkpoint 不保存稳定 source cursor，也没有绑定来源、
目标与合同；直接发送原始记录还会扩大敏感字段出域范围。该实现只能演练，不能形成连续审计来源。

## Options

1. 提高展示链上限并继续按记录摘要去重。
2. 在每个 HTTP handler 内同步写独立审计日志或同步发送 SIEM。
3. 在既有平台状态 SQLite 事务内追加版本化、单调、不可截断的审计 source；worker 通过稳定 cursor
   消费最小投影，旧展示链继续只承担兼容查询。
4. 立即把全部状态写入和审计迁到 PostgreSQL，并同时切换生产主库。

## Advantages

- 方案 1 改动小。
- 方案 2 能在事件产生点直接获得上下文。
- 方案 3 不改变公开 API，以同一 SQLite `BEGIN/COMMIT` 原子提交业务快照和审计 source，能在展示窗口
  淘汰后继续按单调 cursor 消费；最小投影和稳定摘要减少外发数据；后续可用相同端口迁移到 PostgreSQL。
- 方案 4 最接近最终生产拓扑。

## Disadvantages

- 方案 1 仍存在任意高峰下的丢失窗口，重封也继续造成摘要漂移。
- 方案 2 增加请求延迟和外部故障耦合，无法保证业务与外送原子性。
- 方案 3 需要 SQLite v15 migration、事务 hook、source repository、checkpoint v3、回填与专项测试；
  历史上已经淘汰的事件无法由仓库恢复。
- 方案 4 会同时改变主事实源、同步调用模型、部署和回滚边界，约 865 个同步状态调用不能安全地一次迁移。

## Migration cost

迁移成本为中高。SQLite v15 新增单主题 append-only source 表与索引；首次升级只把当前能够通过 v2
严格验证的窗口登记为 `historical-baseline`。后续状态写入必须在同一事务内比较旧/新事件 ID，拒绝同
ID 异内容，并按旧到新的顺序追加。worker 使用 checkpoint v3 保存 source cursor、source/sink contract、
目标摘要和已确认 receipt 摘要。checkpoint v2 与 snapshot source 继续作为 rehearsal，不静默提升。组合根
新增一个显式 source 依赖，`maximumServerRequires` 的冻结预算只随当前值由 128 调整为 129，不留额外余量。

## Risk

- 现存窗口之前的历史事件已经不可恢复；任何基线都不得声称覆盖该时期。
- 遗留代码存在多种追加/重封方式；事务 hook 必须以稳定 event ID 和去除链字段后的 source digest 判重，
  并在同 ID 异内容时失败关闭。
- 最小投影可能遗漏监管所需字段；v1 只包含事件身份、时间、分类/动作、结果、角色以及主体/目标的单向摘要，
  不包含姓名、居民标识、自由文本详情、原始 purpose、签名或凭据。扩展字段必须版本化并经 Data Owner 审批。
- 本地文件 checkpoint、未签 SIEM receipt 和 filesystem WORM 仍不能证明外部耐久性。

## Recommendation

选择方案 3。采用 `append-only-audit-source-v2` 与
`audit-delivery-minimal-projection-v1`。SQLite source 的 `sequence` 是唯一消费 cursor；每条记录绑定
stream、source event ID、稳定 source digest、投影 digest、前驱 source hash 和 baseline 标记。source
表不提供更新或删除路径。worker 只读取已提交行，批次必须绑定连续的 start/end cursor 与 source head。

完成仓库实现后，`productionReady` 仍固定为 `false`。真实 SIEM 独立签名 receipt、外部单调 anchor、
WORM/KMS/保留能力、历史链盘点、Data Owner 投影审批、专用账号、恢复演练和现场签字仍是外部门禁。
