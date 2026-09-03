(function referralWorkbench(root) {
  "use strict";
  function normalize(item) {
    const status = item.status || "待受理";
    const nextAction = item.nextAction || (item.reportStatus === "returned" ? "完成接诊反馈与连续服务" : /scheduled|已排期/.test(status) ? "接诊并回传会诊结果" : "确认排期和接诊资源");
    return {
      raw: item, id: item.id, title: `${item.type || "远程会诊"} · ${item.department || "待分科"}`, status,
      owner: item.targetInstitution || "接诊机构", nextAction,
      lines: [`转出：${item.sourceInstitution || "基层医疗机构"} → 接诊：${item.targetInstitution || "待确认"}`, `报告：${item.reportStatus || "待回传"} · 反馈：${item.receivingFeedback || "待反馈"}`],
      details: [["居民索引", item.residentId], ["临床问题", item.clinicalQuestion], ["会诊时间", item.meetingWindow], ["接诊医生", item.receivingDoctor], ["报告摘要", item.reportSummary], ["更新时间", item.lastUpdated]]
    };
  }
  function postStatus(status, note, extra = {}) { return (client, row) => client.post(`/referral-teleconsultations/${encodeURIComponent(row.id)}/actions`, { status, note, ...extra }); }
  const actions = [
    { id: "accept", label: "确认接诊", visible: (row) => !/accepted|scheduled|report-returned|closed|已完成/.test(row.status), run: postStatus("accepted", "转诊会诊工作台确认接诊") },
    { id: "schedule", label: "确认排期", visible: (row) => /accepted|pending|待/.test(row.status), run: postStatus("scheduled", "转诊会诊工作台确认进入排期") },
    { id: "report", label: "登记报告已回传", visible: (row) => row.raw.reportStatus !== "returned", run: postStatus("report-returned", "转诊会诊工作台登记报告回传", { reportSummary: "会诊报告已由接诊机构回传，待源系统归档。" }) }
  ];
  function boot() { root.DomainTaskUI.start({ load: (client) => client.get("/referral-teleconsultations").then((result) => result.data), rows: (payload) => payload.teleconsultations || [], normalize, actions }); }
  if (typeof module === "object" && module.exports) module.exports = { normalize, actions };
  else if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})(typeof window !== "undefined" ? window : globalThis);
