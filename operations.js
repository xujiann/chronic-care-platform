const OPERATIONS_API_BASE = location.protocol === "file:" ? "" : "/api";
let operationsDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindDispatchForm();
  await loadOperationsDashboard();
});

async function loadOperationsDashboard() {
  operationsDashboard = await fetchOperationsDashboard();
  renderOperationsDashboard(operationsDashboard);
}

async function fetchOperationsDashboard() {
  if (OPERATIONS_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${OPERATIONS_API_BASE}/operations/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/db.json");
  const state = response.ok ? await response.json() : {};
  return buildStaticOperationsDashboard(state);
}

function buildStaticOperationsDashboard(state) {
  const snapshots = Array.isArray(state.hospitalOperationSnapshots) ? state.hospitalOperationSnapshots : [];
  const dispatchRequests = Array.isArray(state.resourceDispatchRequests) ? state.resourceDispatchRequests : [];
  const reconciliationReviews = Array.isArray(state.statisticsReconciliationReviews) ? state.statisticsReconciliationReviews : [];
  const alertRules = Array.isArray(state.operationAlertRules) ? state.operationAlertRules : [];
  return {
    ok: true,
    boundaries: ["hospital-operation-monitoring", "resource-dispatch", "statistics-reconciliation"],
    reusedCollections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit"],
    summary: {
      institutions: snapshots.length,
      critical: snapshots.filter((item) => item.normalizedStatus === "critical").length,
      warning: snapshots.filter((item) => item.normalizedStatus === "warning").length,
      alerts: snapshots.reduce((sum, item) => sum + (item.alerts || []).length, 0),
      openDispatchRequests: dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status)).length,
      pendingReconciliation: reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status)).length,
      bedOccupancyRate: snapshots.reduce((sum, item) => sum + Number(item.beds?.occupied || 0), 0) / Math.max(snapshots.reduce((sum, item) => sum + Number(item.beds?.open || 0), 0), 1)
    },
    snapshots,
    dispatchRequests,
    reconciliationReviews,
    alertRules
  };
}

function renderOperationsDashboard(dashboard) {
  renderOperationsMetrics(dashboard.summary || {});
  renderOperationsSnapshots(dashboard.snapshots || []);
  renderAlertRules(dashboard.alertRules || []);
  renderDispatchRequests(dashboard.dispatchRequests || []);
  renderReconciliationReviews(dashboard.reconciliationReviews || []);
  const boundary = document.querySelector("#operations-boundary");
  if (boundary) boundary.textContent = `${(dashboard.boundaries || []).join(" / ")} | reuse: ${(dashboard.reusedCollections || []).join(", ")}`;
}

function renderOperationsMetrics(summary) {
  const metrics = [
    ["机构数", summary.institutions || 0, "纳入运行监测的机构"],
    ["严重预警", summary.critical || 0, "critical operation status"],
    ["一般预警", summary.warning || 0, "warning operation status"],
    ["告警项", summary.alerts || 0, "规则触发总数"],
    ["待调度", summary.openDispatchRequests || 0, "pending / assigned / in-progress"],
    ["待对账", summary.pendingReconciliation || 0, "未关闭的直报复核"],
    ["床位使用率", `${Math.round((summary.bedOccupancyRate || 0) * 1000) / 10}%`, "occupied/open beds"]
  ];
  document.querySelector("#operations-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");
}

function renderOperationsSnapshots(items) {
  document.querySelector("#operations-snapshots").innerHTML = `
    <table>
      <thead><tr><th>机构</th><th>状态</th><th>床位</th><th>人员</th><th>设备</th><th>门急诊</th><th>住院</th><th>直报差异</th><th>调度建议</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.institution}</strong><br /><small>${item.snapshotAt || ""}</small></td>
          <td>${statusBadge(item.normalizedStatus)}</td>
          <td>${item.beds?.occupied || 0}/${item.beds?.open || 0}<br /><small>ICU ${item.beds?.icuOccupied || 0}/${item.beds?.icuTotal || 0}</small></td>
          <td>${item.staff?.doctorsOnDuty || 0} 医 / ${item.staff?.nursesOnDuty || 0} 护<br /><small>缺口 ${item.staff?.shortage || 0}</small></td>
          <td>CT ${item.equipment?.ctAvailable || 0}/${item.equipment?.ctTotal || 0}<br /><small>呼吸机 ${item.equipment?.ventilatorsAvailable || 0}</small></td>
          <td>${item.outpatient?.visitsToday || 0}<br /><small>急诊 ${item.outpatient?.emergencyVisits || 0}</small></td>
          <td>${item.inpatient?.admissionsToday || 0} 入 / ${item.inpatient?.dischargesToday || 0} 出</td>
          <td>${Math.round(Number(item.reporting?.varianceRate || 0) * 1000) / 10}%</td>
          <td>${item.dispatchSuggestion || ""}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderAlertRules(items) {
  document.querySelector("#operations-alert-rules").innerHTML = items.map((item) => `
    <div>
      <strong>${item.id}</strong>
      <span>${item.domain} / ${item.threshold}</span>
      <span>${statusBadge(item.severity)} ${item.dispatchBoundary || ""}</span>
    </div>
  `).join("");
}

function renderDispatchRequests(items) {
  document.querySelector("#dispatch-requests").innerHTML = `
    <table>
      <thead><tr><th>工单</th><th>资源</th><th>来源</th><th>目标</th><th>优先级</th><th>状态</th><th>原因</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.id}</strong><br /><small>${item.requiredBy || ""}</small></td>
          <td>${item.resourceType} x ${item.quantity}</td>
          <td>${item.sourceInstitution || ""}</td>
          <td>${item.targetInstitution || ""}</td>
          <td>${statusBadge(item.priority)}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${item.reason || ""}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderReconciliationReviews(items) {
  document.querySelector("#reconciliation-reviews").innerHTML = `
    <table>
      <thead><tr><th>复核单</th><th>机构</th><th>周期</th><th>差异</th><th>字段</th><th>状态</th><th>说明</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.id}</strong></td>
          <td>${item.institution}</td>
          <td>${item.period}</td>
          <td>${Math.round(Number(item.varianceRate || 0) * 1000) / 10}%</td>
          <td>${(item.fields || []).join(", ")}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${item.reviewNote || ""}</td>
          <td><button class="inline-action" type="button" data-review-recon="${item.id}">通过</button></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-review-recon]").forEach((button) => {
    button.addEventListener("click", () => approveReconciliation(button.dataset.reviewRecon));
  });
}

function bindDispatchForm() {
  const form = document.querySelector("#dispatch-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.quantity = Number(values.quantity || 1);
    if (OPERATIONS_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      await request(`${OPERATIONS_API_BASE}/operations/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
    }
    await loadOperationsDashboard();
  });
}

async function approveReconciliation(id) {
  if (!OPERATIONS_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  await request(`${OPERATIONS_API_BASE}/operations/reconciliation/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "approved", reviewNote: "Approved from operations dispatch console." })
  });
  await loadOperationsDashboard();
}

function statusBadge(status) {
  const text = String(status || "unknown");
  const danger = ["critical", "high", "blocked"].includes(text);
  const warn = ["warning", "medium", "pending", "assigned", "in-progress", "pending-review"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  return `<span class="badge ${type}">${text}</span>`;
}
