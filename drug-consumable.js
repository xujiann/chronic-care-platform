(function drugConsumableWorkbench(root) {
  "use strict";
  function normalize(item) {
    const status = item.status || item.normalizedStatus || item.reviewStatus || "待复核";
    return {
      raw: item, id: item.id, title: `${item.category || item.boundary || "药耗线索"} · ${item.institution || "医疗机构"}`, status,
      owner: item.owner || item.institution || "药耗协同责任方", nextAction: item.nextAction || "按职责完成复核、整改或医保核验",
      lines: [`风险：${item.riskLevel || "待评估"} · 复核：${item.reviewStatus || "待复核"}`, `整改：${item.remediationStatus || "待提交"} · 医保：${item.insuranceStatus || "待协同"}`],
      details: [["问题摘要", item.issue], ["来源编号", item.sourceId], ["证据覆盖", item.traceabilityEvidenceCoverage?.status], ["审计记录", item.auditCount], ["更新时间", item.lastUpdated]]
    };
  }
  const actions = [
    { id: "review", label: "完成线索复核", visible: (row, role) => ["commission", "insurance"].includes(role) && !/reviewed|closed/.test(row.raw.reviewStatus || row.status), run: (client, row) => client.post(`/drug-consumable-supervision/${encodeURIComponent(row.id)}/review`, { expectedVersion: Number(row.raw.domainVersion || 0), reviewStatus: "reviewed", status: "in-review", note: "工作台完成线索复核", nextAction: "由医疗机构提交整改与追溯证据" }) },
    { id: "remediation", label: "提交整改说明", visible: (row, role) => ["commission", "institution"].includes(role) && !/closed|accepted/.test(row.raw.remediationStatus || ""), run: (client, row) => client.post(`/drug-consumable-supervision/${encodeURIComponent(row.id)}/remediation`, { expectedVersion: Number(row.raw.domainVersion || 0), remediationStatus: "submitted", evidence: `evidence:drug-consumable:${row.id}`, note: "机构整改说明已提交", nextAction: "监管或医保复核整改证据" }) },
    { id: "insurance", label: "确认医保同步", visible: (row, role) => ["commission", "insurance"].includes(role) && !/synced|closed/.test(row.raw.insuranceStatus || ""), run: (client, row) => client.post(`/drug-consumable-supervision/${encodeURIComponent(row.id)}/insurance-sync`, { expectedVersion: Number(row.raw.domainVersion || 0), insuranceStatus: "synced", settlementBatch: `workbench-${new Date().toISOString().slice(0, 10)}`, note: "医保目录与结算状态已同步", nextAction: "归档药耗协同证据" }) }
  ];
  function boot() { root.DomainTaskUI.start({ load: (client) => client.get("/drug-consumable-supervision").then((result) => result.data), rows: (payload) => payload.rows || [], normalize, actions }); }
  if (typeof module === "object" && module.exports) module.exports = { normalize, actions };
  else if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})(typeof window !== "undefined" ? window : globalThis);
