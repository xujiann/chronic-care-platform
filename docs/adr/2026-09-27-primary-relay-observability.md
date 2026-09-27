# 隔离单批次 relay 观测与故障状态

- 状态：Accepted
- 决策：ADR-OPS-049；2026-09-27 用户批准限定切片。
- 基线：main@0875adae；任务 GOV-023 / OPS-049，T00 单写。

## Problem and options

现有显式 relay 只有成功状态与抛出异常，缺少跨目标提交与 checkpoint 推进窗口的安全观测。备选为另建观测协议、直接接生产监控、或复用 platform-worker-observability.v1。采用既有共同合同，新增隔离 rehearsal profile；不启用 worker 或生产监控。

## Decision and scope

保留 runOnce 的返回和异常兼容。新增显式观测调用，以同一执行路径生成固定字段的脱敏报告；区分读取进度、读取源、目标投递、进度推进与完成阶段，以及未尝试目标写入、提交未知、目标已确认、checkpoint 已确认。目标投递异常可能发生在实际提交之后，必须标记未知，不声称零写或完整成功。稳定错误码只来自明确允许清单，未知异常映射固定码，不输出原消息。

复用既有共同投影，仅向其传入自建技术元数据；不传异常对象、业务正文、路径、URL、凭据或原始回执。无日志 sink、指标 exporter、告警 provider、HTTP、自动调度、数据迁移、DDL 或生产配置变化。不把单批次观测等同于生产运行观测完整。

## Advantages, disadvantages, migration cost, risk, recommendation

优势是复用共同合同与安全边界，并使故障窗口可解释；缺点是仍无真实监控投递、SLO或多实例证据。迁移成本为加法方法、profile、测试与文档；风险为故障被误报成功或敏感错误外泄，推荐固定字段、允许码、各阶段负测和独立审查。

## Compatibility, rollback and safety

旧调用不变；停止新增观测调用即可回退，不删除源、目标或checkpoint事实。只使用隔离合成数据；真实PG专项仍由专用CI零跳过执行。先治理与窄测、独立审查、冻结，再串行必需门禁与保护PR。多进程、多实例、TLS、容量、灾备、可信锚及现场签署仍外置，生产六域NO-GO。
