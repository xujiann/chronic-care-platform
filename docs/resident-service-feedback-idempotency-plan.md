# OPS-017 居民服务评价投诉幂等集成 PLAN

- 任务：`OPS-017`
- 领域 Owner：`T04`
- 集成 Owner：`T00`
- 分支：`process/t00-resident-feedback-integration-20260908`
- 基线：`origin/main@7d18c57e`
- Draft PR：[#272](https://github.com/xujiann/chronic-care-platform/pull/272)，替代 Draft PR #264
- 状态：实施中；仓库候选证据待 required CI 全绿和合并后由 T00 固化

## 目标与范围

在 SEC-011 已合并的机构消息授权边界上，集成居民护理与陪诊评价投诉入口、投诉状态投影和草稿恢复，并复用统一状态命令协议补齐稳定幂等键、锁内重读、集合 CAS、精确回执重放和旧客户端自然键兼容。范围限于居民端反馈模块、统一任务动作路由、生命周期总账与对应单元、真实 HTTP、浏览器测试；不修改 Service Worker、PWA 缓存或生产准入结论。

## 风险与验收

- 路径任务标识必须是两个非空段，命令、自然键、锁和审计只使用服务端规范化任务标识；正文 `taskId` 不得改变路径身份。
- 同键同载荷精确重放；同键异载荷返回 409；不同键并发只产生一次订单、机构消息和安全审计写入。
- SQLite 持久层乐观锁冲突稳定映射 409；目标集合版本递增且无关集合版本保留。
- 投诉关闭时间不得早于确认时间；消息仅对目标角色和机构可见；居民端动态文本保持 DOM 转义。
- 单元/HTTP、浏览器 E2E、架构预算、quick、T00 ownership 和 required CI 均通过后，PR 才可由独立复核转为 Ready。

## 回滚

合并前直接关闭 #272；合并后对 #272 的 merge commit 执行 `git revert <merge-commit>` 并重新运行 required CI。回滚不得删除已持久化的评价、投诉、`_writeCommandReceipts`、消息或审计；旧读取会忽略加法回执字段。若回滚前已接收评价，继续按原任务记录保留并由人工投诉流程跟进。

## 已知边界

当前并发测试覆盖单进程命令锁、真实 SQLite CAS 和注入的持久层 CAS 冲突，但尚未证明多实例 exactly-once。PWA 资产刷新由 OPS-019 独立完成；专用指标、告警、追踪、SLO、手册、降级与补偿仍是生产 NO-GO 缺口。
