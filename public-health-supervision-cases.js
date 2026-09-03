(function supervisionCasesWorkbench(root) {
  "use strict";
  const FLOW = ["立案", "调查取证", "审核", "处罚", "整改", "复查", "结案"];
  function normalize(item) {
    const status = item.status || "立案";
    const index = FLOW.indexOf(status);
    return {
      raw: item, id: item.id, title: `${item.cause || "卫生监督案件"} · ${item.subjectCode || "监督主体"}`, status,
      owner: item.owner || item.responsibleOrganization || "卫生监督执法责任方", nextAction: item.nextAction || (index >= 0 && index < FLOW.length - 1 ? `进入${FLOW[index + 1]}` : "归档案卷并持续复盘"),
      lines: [`主体：${item.subjectCode || "待关联"} · 来源任务：${item.inspectionTaskId || "独立立案"}`, `证据：${(item.evidenceRefs || []).length} 项 · 版本：${item.version ?? item.domainVersion ?? 0}`],
      details: [["案由", item.cause], ["案件等级", item.priority], ["处罚决定", item.penaltyDecision], ["整改期限", item.remediationDueAt], ["复查结论", item.reinspectionDecision], ["最近更新", item.updatedAt]]
    };
  }
  const stagePayload = {
    "调查取证": (row) => ({ evidenceRefs: [`evidence:supervision-case:${row.id}:investigation`] }),
    "处罚": () => ({ penaltyDecision: "依法作出处罚决定，正式文书以执法系统归档件为准。" }),
    "整改": (row) => ({ evidenceRefs: [`evidence:supervision-case:${row.id}:remediation`], remediationDueAt: new Date(Date.now() + 7 * 86400000).toISOString() }),
    "复查": () => ({ reinspectionDecision: "通过", evidenceRefs: ["evidence:supervision-case:reinspection"] }),
    "结案": () => ({ reinspectionDecision: "通过" })
  };
  const actions = FLOW.slice(1).map((status) => ({
    id: `to-${status}`, label: `进入${status}`,
    visible: (row, role) => role === "commission" && FLOW.indexOf(row.status) === FLOW.indexOf(status) - 1,
    run: (client, row) => client.post(`/public-health/supervision/cases/${encodeURIComponent(row.id)}/actions`, { action: `transition-to-${FLOW.indexOf(status)}`, toStatus: status, expectedVersion: Number(row.raw.version ?? row.raw.domainVersion ?? 0), note: `案件工作台提交${status}动作`, ...(stagePayload[status]?.(row) || {}) })
  }));
  function boot() {
    const controller = root.DomainTaskUI.start({ load: (client) => client.get("/public-health/supervision/cases").then((result) => result.data), rows: (payload) => payload.cases || [], normalize, actions });
    const form = root.document.querySelector("#supervision-case-create-form");
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new root.FormData(form);
      const submit = form.querySelector("button[type='submit']");
      submit.disabled = true;
      try {
        const client = root.HealthPlatformApi.createClient({ baseUrl: "/api" });
        await client.post("/public-health/supervision/cases", {
          subjectCode: String(data.get("subjectCode") || "").trim(),
          subjectOrganizationCode: String(data.get("subjectOrganizationCode") || "").trim(),
          inspectionTaskId: String(data.get("inspectionTaskId") || "").trim(),
          cause: String(data.get("cause") || "").trim(),
          priority: String(data.get("priority") || "普通")
        });
        form.reset();
        await controller.load();
      } catch (error) {
        root.document.querySelector("#domain-workbench-status").textContent = "立案未完成";
        root.document.querySelector("#domain-workbench-error").textContent = `立案失败，页面未伪造成功：${error.message || "请检查输入"}`;
      } finally { submit.disabled = false; }
    });
  }
  if (typeof module === "object" && module.exports) module.exports = { FLOW, normalize, actions };
  else if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})(typeof window !== "undefined" ? window : globalThis);
