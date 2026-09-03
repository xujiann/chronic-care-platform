(function researchSandboxWorkbench(root) {
  "use strict";
  function normalize(item) {
    const status = item.status || item.authorizationStatus || "requested";
    const ready = item.authorizationStatus === "approved" && ["released", "approved", "completed"].includes(item.deidentificationStatus) && item.sandboxStatus !== "blocked";
    return {
      raw: item, id: item.id, title: item.name || `${item.diseaseType || "专病"}数据集`, status,
      owner: item.createdBy || item.requestedBy || "科研数据治理责任方", nextAction: ready ? "按批准目的进入安全沙箱或申请合规导出" : "补齐伦理、去标识化、授权和治理证据",
      lines: [`伦理：${item.ethicsStatus || "待审核"} · 去标识化：${item.deidentificationStatus || "待完成"}`, `授权：${item.authorizationStatus || "待审批"} · 沙箱：${item.sandboxStatus || item.sandbox?.status || "待开放"}`],
      details: [["病种", item.diseaseType], ["数据量", item.records], ["来源集合", item.sourceCollections], ["使用协议", item.dataUseAgreement || item.governance?.dataUseAgreement], ["证据数量", item.evidenceDocumentCount || item.evidenceDocuments?.length], ["保留天数", item.retentionDays || item.governance?.retentionDays]]
    };
  }
  const actions = [
    { id: "approve", label: "独立审批通过", visible: (row, role) => role === "commission" && row.raw.authorizationStatus !== "approved", run: (client, row) => client.post(`/research/datasets/${encodeURIComponent(row.id)}/approval`, { expectedVersion: Number(row.raw.domainVersion || 0), decision: "approved", governance: { minimumNecessary: true, reidentificationProhibited: true }, note: "工作台独立复核通过" }) },
    { id: "sandbox", label: "登记沙箱访问", visible: (row) => row.raw.authorizationStatus === "approved" && ["released", "approved", "completed"].includes(row.raw.deidentificationStatus), run: (client, row) => client.post(`/research/datasets/${encodeURIComponent(row.id)}/sandbox-access`, { ...(row.raw.domainVersion === undefined ? {} : { expectedVersion: row.raw.domainVersion }), purpose: "经批准的去标识化队列分析" }) },
    { id: "outcome", label: "回流研究成果", visible: (row) => row.raw.authorizationStatus === "approved", run: (client, row) => client.post(`/research/datasets/${encodeURIComponent(row.id)}/outcomes`, { ...(row.raw.domainVersion === undefined ? {} : { expectedVersion: row.raw.domainVersion }), title: "阶段性研究成果", summary: "仅回流去标识化聚合结论，不包含个人级数据。" }) }
  ];
  async function load(client) {
    const role = String(root.HealthCityAuth?.getUser?.()?.role || "");
    return (await client.get(role === "commission" ? "/research/datasets" : "/research/sandbox")).data;
  }
  function boot() { root.DomainTaskUI.start({ load, rows: (payload) => payload.datasets || [], normalize, actions }); }
  if (typeof module === "object" && module.exports) module.exports = { normalize, actions };
  else if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})(typeof window !== "undefined" ? window : globalThis);
