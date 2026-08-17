"use strict";

const CARD_LABELS = Object.freeze({
  "work-items": "统一事项",
  "sla-breaches": "SLA超时",
  "unread-messages": "未读协作",
  "regional-sites": "地区实例",
  "configuration-ready": "配置就绪",
  "alert-blockers": "告警阻断"
});
const SAFE_ITEM_STATUS = new Set(["queued", "dispatched", "in-progress", "blocked", "escalated", "resolved", "observed"]);
const SAFE_SLA_STATE = new Set(["within-sla", "due-soon", "breached", "closed"]);
const SAFE_ACCEPTANCE = new Set(["pending", "reviewing", "accepted", "rejected", "expired"]);

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function identifier(value, maximum = 96) {
  const text = String(value || "").trim();
  return /^[A-Za-z0-9._:-]+$/.test(text) ? text.slice(0, maximum) : "redacted";
}

function buildProductRegionalOperationsViewModel(workItems, regional, options = {}) {
  const maximumItems = Math.min(Math.max(integer(options.maximumItems) || 12, 1), 50);
  const cards = Object.freeze([
    Object.freeze({ id: "work-items", label: CARD_LABELS["work-items"], value: integer(workItems?.summary?.total), state: workItems?.ok === true ? "ready" : "blocked" }),
    Object.freeze({ id: "sla-breaches", label: CARD_LABELS["sla-breaches"], value: integer(workItems?.summary?.breached), state: integer(workItems?.summary?.breached) > 0 ? "attention" : "ready" }),
    Object.freeze({ id: "unread-messages", label: CARD_LABELS["unread-messages"], value: integer(workItems?.summary?.unreadMessages), state: integer(workItems?.summary?.unreadMessages) > 0 ? "attention" : "ready" }),
    Object.freeze({ id: "regional-sites", label: CARD_LABELS["regional-sites"], value: integer(regional?.summary?.regions), state: regional?.ok === true ? "ready" : "blocked" }),
    Object.freeze({ id: "configuration-ready", label: CARD_LABELS["configuration-ready"], value: integer(regional?.summary?.configurationReady), state: regional?.summary?.configurationReady === regional?.summary?.regions ? "ready" : "blocked" }),
    Object.freeze({ id: "alert-blockers", label: CARD_LABELS["alert-blockers"], value: integer(regional?.summary?.alertBlockers), state: regional?.alerts?.ok === true ? "ready" : "blocked" })
  ]);
  const items = Object.freeze((Array.isArray(workItems?.items) ? workItems.items : []).slice(0, maximumItems).map((item) => Object.freeze({
    id: identifier(item?.id, 48),
    category: "平台运行事项",
    domain: identifier(item?.domain, 48),
    priority: identifier(item?.priority, 16),
    status: SAFE_ITEM_STATUS.has(item?.status) ? item.status : "blocked",
    slaState: SAFE_SLA_STATE.has(item?.slaState) ? item.slaState : "breached",
    assignedRole: identifier(item?.assignedRole || "unassigned", 48),
    unreadMessages: integer(item?.unreadMessages),
    version: integer(item?.version),
    timeline: Object.freeze((Array.isArray(item?.timeline) ? item.timeline : []).slice(-5).map((event) => Object.freeze({
      action: identifier(event?.action, 24),
      at: String(event?.at || "").slice(0, 40),
      actorRole: identifier(event?.actorRole, 48),
      resultingStatus: SAFE_ITEM_STATUS.has(event?.resultingStatus) ? event.resultingStatus : "blocked"
    })))
  })));
  const regions = Object.freeze((Array.isArray(regional?.regions) ? regional.regions : []).map((region) => Object.freeze({
    regionCode: /^\d{6}$/.test(String(region?.regionCode || "")) ? region.regionCode : "redacted",
    deploymentClass: identifier(region?.deploymentClass, 24),
    enabledCapabilities: (Array.isArray(region?.capabilities) ? region.capabilities : []).filter((capability) => capability.enabled === true).length,
    configurationReady: region?.configuration?.technicalReady === true,
    deploymentStatus: identifier(region?.deployment?.status, 24),
    replicationStatus: identifier(region?.replication?.status, 24),
    acceptanceState: SAFE_ACCEPTANCE.has(region?.acceptance?.state) ? region.acceptance.state : "pending",
    productionReady: false
  })));
  const configurationDiffs = Object.freeze((Array.isArray(regional?.configurationDiffs) ? regional.configurationDiffs : []).map((diff) => Object.freeze({
    baselineRegionCode: /^\d{6}$/.test(String(diff?.baselineRegionCode || "")) ? diff.baselineRegionCode : "redacted",
    targetRegionCode: /^\d{6}$/.test(String(diff?.targetRegionCode || "")) ? diff.targetRegionCode : "redacted",
    featureDifferenceCount: Array.isArray(diff?.featureKeys) ? diff.featureKeys.length : 0,
    configDifferenceCount: Array.isArray(diff?.configKeys) ? diff.configKeys.length : 0,
    extensionDifferenceCount: Array.isArray(diff?.extensionIds) ? diff.extensionIds.length : 0,
    containsConfigurationValues: false
  })));
  return Object.freeze({
    schemaVersion: "product-regional-operations-view-model-v1",
    status: workItems?.ok === true && regional?.ok === true ? "local-control-ready" : "blocked",
    productionReady: false,
    cards,
    workItems: items,
    regions,
    configurationDiffs,
    boundary: "页面只显示脱敏事项协作元数据和地区运行摘要；不显示业务载荷、配置值、基础设施或生产授权。"
  });
}

module.exports = { CARD_LABELS, buildProductRegionalOperationsViewModel };
