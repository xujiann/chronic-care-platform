"use strict";

const SECTION_ORDER = Object.freeze([
  "work-items",
  "frontend",
  "monitoring",
  "nonfunctional",
  "regional-replication"
]);

function boundedText(value, maximum = 96) {
  return String(value ?? "").trim().slice(0, maximum);
}

function buildProductOperationsViewModel(input, options = {}) {
  const maximumVisibleWorkItems = Number(options.maximumVisibleWorkItems ?? 12);
  if (!Number.isInteger(maximumVisibleWorkItems) || maximumVisibleWorkItems < 1 || maximumVisibleWorkItems > 50) {
    throw new TypeError("maximumVisibleWorkItems must be an integer between 1 and 50");
  }
  const workItems = input?.workItems || { summary: {}, items: [] };
  const monitoring = input?.monitoring || { ok: false, summary: {} };
  const nonfunctional = input?.nonfunctional || { ok: false, summary: {} };
  const replication = input?.replication || { ok: false, summary: {}, sites: [] };
  const cards = Object.freeze([
    Object.freeze({ id: "open-work-items", label: "开放事项", value: Number(workItems.summary?.open) || 0, state: workItems.ok ? "ready" : "blocked" }),
    Object.freeze({ id: "blocked-work-items", label: "阻断事项", value: Number(workItems.summary?.blocked) || 0, state: Number(workItems.summary?.blocked) > 0 ? "attention" : "ready" }),
    Object.freeze({ id: "monitoring-controls", label: "监控控制", value: Number(monitoring.summary?.controls) || 0, state: monitoring.ok ? "ready" : "blocked" }),
    Object.freeze({ id: "frontend-assets", label: "前端预算", value: Number(nonfunctional.summary?.assetsWithinBudget) || 0, state: nonfunctional.ok ? "ready" : "blocked" }),
    Object.freeze({ id: "regional-sites", label: "地区实例", value: Number(replication.summary?.sites) || 0, state: replication.ok ? "ready" : "blocked" })
  ]);
  const visibleItems = Object.freeze((Array.isArray(workItems.items) ? workItems.items : [])
    .slice(0, maximumVisibleWorkItems)
    .map((item) => Object.freeze({
      id: boundedText(item.id, 48),
      label: boundedText(item.label, 80),
      domain: boundedText(item.domain, 48),
      status: boundedText(item.status, 32),
      priority: boundedText(item.priority, 24),
      version: Number.isInteger(item.version) ? item.version : 0
    })));
  const sections = Object.freeze(SECTION_ORDER.map((id) => Object.freeze({
    id,
    state: id === "work-items" ? (workItems.ok ? "ready" : "blocked")
      : id === "frontend" || id === "nonfunctional" ? (nonfunctional.ok ? "ready" : "blocked")
        : id === "monitoring" ? (monitoring.ok ? "ready" : "blocked")
          : (replication.ok ? "ready" : "blocked")
  })));
  const locallyReady = sections.every((section) => section.state === "ready");
  return Object.freeze({
    schemaVersion: "product-operations-view-model-v1",
    status: locallyReady ? "local-control-ready" : "blocked",
    productionReady: false,
    cards,
    sections,
    workItems: visibleItems,
    boundary: "The view model contains allowlisted operational metadata only; production authorization is never inferred from UI state."
  });
}

module.exports = { SECTION_ORDER, buildProductOperationsViewModel };
