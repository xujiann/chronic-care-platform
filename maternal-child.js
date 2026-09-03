(function maternalChildWorkbench(root) {
  "use strict";
  function normalize(item) {
    const status = item.status || item.maternalChildSync || "待处理";
    const nextAction = item.status === "待签发" ? "核对材料并完成签发" : item.maternalChildSync !== "已入册" ? "上报妇幼健康管理入册" : item.publicSecuritySync !== "已共享" ? "完成跨部门共享" : item.nextService || "持续儿童健康管理";
    return {
      raw: item, id: item.id, title: `${item.newbornName || "新生儿"} · ${item.issueType || "出生医学证明"}`, status,
      owner: item.issuingInstitution || "签发机构", nextAction,
      lines: [`证明编号：${item.certificateNo || "待生成"}`, `妇幼入册：${item.maternalChildSync || "待入册"} · 公安共享：${item.publicSecuritySync || "待共享"}`],
      details: [["出生时间", item.birthDateTime], ["出生体重", item.birthWeight], ["电子证照", item.electronicLicenseStatus], ["健康管理", item.healthManagementStatus], ["后续服务", item.nextService]]
    };
  }
  const actions = [
    { id: "issue", label: "确认签发", visible: (row, role) => ["commission", "institution"].includes(role) && row.raw.status === "待签发", run: (client, row) => client.post("/workflow-actions", { collection: "birthCertificates", id: row.id, status: "已签发", updates: { electronicLicenseStatus: "已生成", qualityCheck: "通过" }, note: "妇幼工作台完成签发" }) },
    { id: "enroll", label: "上报妇幼入册", visible: (row, role) => ["commission", "institution"].includes(role) && row.raw.maternalChildSync !== "已入册", run: (client, row) => client.post("/workflow-actions", { collection: "birthCertificates", id: row.id, status: "已上报", updates: { maternalChildSync: "已入册", healthManagementStatus: "已建档" }, note: "妇幼工作台完成健康管理接续" }) }
  ];
  function boot() { root.DomainTaskUI.start({ load: (client) => client.get("/birth-certificates").then((result) => result.data), rows: (payload) => payload.certificates || [], normalize, actions }); }
  if (typeof module === "object" && module.exports) module.exports = { normalize, actions };
  else if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})(typeof window !== "undefined" ? window : globalThis);
