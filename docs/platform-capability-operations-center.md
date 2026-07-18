# 平台能力运营中心

## 目标

平台能力运营中心把全程审计中的 10 个主要能力域转为可持续运行的复核台账，统一承载责任分派、仓库证据补录、生产前复核、整改要求和操作留痕。

## 运行入口

- 页面：`platform.html#platform-capability-operations-center`
- 查询：`GET /api/platform/capability-operations`
- 操作：`POST /api/platform/capability-operations/:capabilityId/actions`
- 生产阻断操作：`POST /api/platform/capability-operations/blockers/:blockerId/actions`
- 角色：仅 `commission`

支持的操作为 `assign`、`record-evidence`、`review`、`request-improvement` 和 `comment`。所有写操作必须填写说明，复核通过必须具备责任人和至少一条证据引用，并写入安全审计链。

## 状态口径

- `pending-review`：等待责任人复核。
- `in-review`：已分派或已开始补录证据。
- `reviewed-preproduction`：仓库实现与当前边界已经完成生产前复核。
- `improvement-required`：发现缺口，进入整改闭环。

任何操作都会强制保留 `productionReady: false`。`reviewed-preproduction` 只表示代码、自动化检查和仓库证据已复核，不表示完成真实环境联调、测评、灾备演练或正式上线审批。

## 生产阻断处置

10 个 P0 生产阻断使用独立持久化台账，支持 `assign`、`start-remediation`、`record-evidence`、`submit-evidence`、`review-evidence`、`reopen` 和 `comment`。状态只能按以下顺序推进：

1. `open`：生产阻断尚未启动整改。
2. `in-progress`：责任方正在整改，可补录证据。
3. `evidence-submitted`：证据已提交，等待卫健委生产前复核。
4. `evidence-reviewed-site-pending`：当前证据已复核，但真实环境验收和正式签字仍未完成。

系统禁止从 `open` 直接提交证据，禁止在未提交证据时复核，也禁止把复核结果标记为生产就绪。证据条件变化时必须通过 `reopen` 返回整改状态，所有操作均进入安全审计链。

## 上线门禁

`platform:production-audit` 校验能力复核、生产阻断状态机、API、页面、交互和本文档是否同时存在。该审计继续由发布报告和部署检查消费，因此能力运营闭环缺失时不能形成完整发布证据。
