# 平台能力运营中心

## 目标

平台能力运营中心把全程审计中的 10 个主要能力域转为可持续运行的复核台账，统一承载责任分派、仓库证据补录、生产前复核、整改要求和操作留痕。

## 运行入口

- 页面：`platform.html#platform-capability-operations-center`
- 查询：`GET /api/platform/capability-operations`
- 操作：`POST /api/platform/capability-operations/:capabilityId/actions`
- 角色：仅 `commission`

支持的操作为 `assign`、`record-evidence`、`review`、`request-improvement` 和 `comment`。所有写操作必须填写说明，复核通过必须具备责任人和至少一条证据引用，并写入安全审计链。

## 状态口径

- `pending-review`：等待责任人复核。
- `in-review`：已分派或已开始补录证据。
- `reviewed-preproduction`：仓库实现与当前边界已经完成生产前复核。
- `improvement-required`：发现缺口，进入整改闭环。

任何操作都会强制保留 `productionReady: false`。`reviewed-preproduction` 只表示代码、自动化检查和仓库证据已复核，不表示完成真实环境联调、测评、灾备演练或正式上线审批。

## 上线门禁

`platform:production-audit` 校验领域模块、API、页面、交互和本文档是否同时存在。该审计继续由发布报告和部署检查消费，因此能力运营中心缺失时不能形成完整发布证据。
