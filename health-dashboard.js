const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");
let currentDashboardSummary = null;

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  currentDashboardSummary = summary;
  bindDashboardFilters();
  renderDashboard(summary);
});

async function loadDashboardSummary() {
  let fallbackReason = "静态预览";
  if (DASHBOARD_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${DASHBOARD_API_BASE}${DASHBOARD_SUMMARY_PATH}`);
      if (response.ok) {
        const summary = await response.json();
        summary.sourceMode = "api";
        summary.sourceLabel = "管理端动态汇总";
        return summary;
      }
      fallbackReason = `接口返回 ${response.status}`;
    } catch (error) {
      fallbackReason = "接口不可用";
      // Static preview falls back to local data.
    }
  }
  const state = await loadPlatformState({});
  const summary = buildStaticDashboardSummary(state);
  summary.sourceMode = "static";
  summary.sourceLabel = "静态快照兜底";
  summary.sourceReason = fallbackReason;
  return summary;
}

function buildStaticDashboardSummary(state) {
  const applications = [
    ["commission-supervision", "卫健委端", "index.html", ["residents", "diseases", "followups", "emergencySignals", "healthStatistics"]],
    ["institution-services", "医疗机构端", "institution.html", ["personalRecords", "careOrders", "medicationPickups", "birthCertificates", "deathCertificates"]],
    ["insurance-governance", "医保治理", "insurance.html", ["insuranceClaims", "digitalCredentials", "medicationPickups"]],
    ["citizen-portal", "居民端", "citizen.html", ["accounts", "residents", "personalRecords", "seniorServices"]],
    ["county-consortium", "县域医共体", "county.html", ["countyCollaborationOrders", "countyMutualRecognitionRecords", "countyAiDiagnosisCases"]],
    ["platform-governance", "平台建设", "platform.html", ["platformCapabilities", "platformInterfaces", "platformEvidence", "hospitalInteroperabilityFunctions"]],
    ["operations-workbench", "运营工作台", "workbench.html", ["platformRoadmap", "platformProcessAudit", "productionDeploymentPlan"]]
  ].map(([id, name, entry, collections]) => {
    const records = collections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    return {
      id,
      name,
      entry,
      collections: collections.map((collection) => ({ collection, records: countRows(state[collection]) })),
      records,
      openActions: 0,
      highRisks: 0,
      evidenceRecords: 0,
      status: records ? "modeled" : "empty-ready",
      boundary: "Aggregated in the dashboard; detailed workflow remains in the source application."
    };
  });
  const evidence = Array.isArray(state.platformEvidence) ? state.platformEvidence : [];
  const interfaces = Array.isArray(state.platformInterfaces) ? state.platformInterfaces : [];
  const dependencies = Array.isArray(state.productionDeploymentPlan) ? state.productionDeploymentPlan : [];
  const openActions = collectStaticOpenActions(state, applications);
  const actionSummary = openActions.reduce((summary, item) => {
    const current = summary[item.applicationId] || { openActions: 0, highRisks: 0 };
    current.openActions += 1;
    if (item.priority === "high") current.highRisks += 1;
    summary[item.applicationId] = current;
    return summary;
  }, {});
  const enrichedApplications = applications.map((item) => ({
    ...item,
    openActions: actionSummary[item.id]?.openActions || 0,
    highRisks: actionSummary[item.id]?.highRisks || 0
  }));
  const sourceOpenActions = enrichedApplications.reduce((sum, item) => sum + item.openActions, 0);
  const risks = enrichedApplications
    .filter((item) => item.highRisks > 0 || item.openActions > 0)
    .map((item) => ({
      applicationId: item.id,
      application: item.name,
      highRisks: item.highRisks,
      openActions: item.openActions,
      nextAction: item.highRisks > 0 ? "回到源应用复核高风险记录。" : "回到源应用闭环待办。"
    }));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: {
      rule: "静态预览模式：仅汇总本地快照，不替代源业务应用。"
    },
    totals: {
      applications: enrichedApplications.length,
      sourceRecords: enrichedApplications.reduce((sum, item) => sum + item.records, 0),
      openActions: openActions.length,
      previewOpenActions: openActions.length,
      sourceOpenActions,
      highRisks: openActions.filter((item) => item.priority === "high").length,
      interfaceTracks: interfaces.length,
      evidenceRecords: evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0),
      siteDependencies: dependencies.length
    },
    applications: enrichedApplications,
    risks,
    openActions,
    interfaces: interfaces.map((item) => ({ id: item.id, domain: item.domain || item.name, priority: item.priority, owner: item.owner, status: item.status, nextAction: item.next })),
    evidence: evidence.map((item) => ({ id: item.id, name: item.name || item.category, owner: item.owner, status: item.status, records: Array.isArray(item.records) ? item.records.length : 0, nextAction: item.next })),
    siteDependencies: dependencies.map((item) => ({ id: item.id, track: item.track || item.name, owner: item.owner, status: item.status, nextAction: item.nextAction || item.next }))
  };
}

function renderDashboard(summary) {
  renderMetrics(summary);
  renderDataState(summary);
  document.querySelector("#dashboard-scope").textContent = summary.scope?.rule || "";
  renderFilterOptions(summary);
  renderApplications(summary.applications || []);
  renderRisks(summary.risks || []);
  renderActions(filteredDashboardActions(summary));
  renderDependencies(summary.siteDependencies || []);
  renderInterfaces(summary.interfaces || []);
  renderEvidence(summary.evidence || []);
  renderFilterSummary(summary);
}

function renderDataState(summary) {
  const state = document.querySelector("#dashboard-api-state");
  const boundary = document.querySelector("#dashboard-data-boundary");
  if (state) {
    state.textContent = summary.sourceMode === "api"
      ? `${summary.sourceLabel || "管理端动态汇总"} / ${summary.generatedAt || ""}`
      : `${summary.sourceLabel || "静态快照兜底"} / ${summary.sourceReason || "本地数据"}`;
  }
  if (boundary) {
    boundary.textContent = summary.scope?.rule || "综合驾驶舱只汇总源应用，不替代源业务办理。";
  }
}

function renderMetrics(summary) {
  const totals = summary.totals || {};
  document.querySelector("#dashboard-metrics").innerHTML = [
    ["应用入口", totals.applications || 0, "前 7 个应用汇总"],
    ["源记录", totals.sourceRecords || 0, "来自 data/db.json 与业务 API"],
    ["源待办", totals.sourceOpenActions ?? totals.openActions ?? 0, "源应用全部待闭环"],
    ["预览待办", totals.previewOpenActions ?? totals.openActions ?? 0, "驾驶舱优先展示"],
    ["高风险", totals.highRisks || 0, "状态/优先级归一化"],
    ["接口轨道", totals.interfaceTracks || 0, "platformInterfaces"],
    ["验收证据", totals.evidenceRecords || 0, "platformEvidence records"],
    ["现场依赖", totals.siteDependencies || 0, "生产切换签字项"],
    ["就绪状态", summary.ok ? "OK" : "Check", summary.generatedAt || ""]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderApplications(applications) {
  document.querySelector("#dashboard-applications").innerHTML = `<table>
    <thead><tr><th>应用</th><th>入口</th><th>源记录</th><th>Open actions</th><th>高风险</th><th>状态</th></tr></thead>
    <tbody>${applications.map((item) => `<tr>
      <td>${item.name}</td>
      <td><a href="./${item.entry}">${item.entry}</a></td>
      <td>${item.records}</td>
      <td>${item.openActions}</td>
      <td>${item.highRisks}</td>
      <td><span class="badge ${item.status === "modeled" ? "info" : "warn"}">${item.status}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRisks(risks) {
  document.querySelector("#dashboard-risks").innerHTML = risks.map((item) => `<div>
    <strong>${item.application}</strong>
    <span>${item.highRisks} high / ${item.openActions} open</span>
    <small>${item.nextAction}</small>
  </div>`).join("") || `<div><strong>暂无高风险汇总</strong><span>等待源应用产生风险或现场联调数据。</span></div>`;
}

function renderActions(actions) {
  document.querySelector("#dashboard-actions").innerHTML = actions.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${index + 1}</div>
    <div>
      <h3>${item.title}</h3>
      <p>${item.application || item.collection} / ${item.collection} / ${item.status}</p>
    </div>
    <div class="capability-side">
      <span class="badge ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${item.priority}</span>
      ${item.entry ? `<a href="./${item.entry}">源应用</a>` : ""}
      <small>${item.owner || "owner-pending"}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>暂无跨应用待办</h3><p>源应用 open action 完成后这里会归零。</p></div></article>`;
}

function bindDashboardFilters() {
  ["#dashboard-application-filter", "#dashboard-priority-filter"].forEach((selector) => {
    const control = document.querySelector(selector);
    if (!control || control.dataset.bound === "true") return;
    control.dataset.bound = "true";
    control.addEventListener("change", () => {
      if (currentDashboardSummary) renderDashboard(currentDashboardSummary);
    });
  });
}

function renderFilterOptions(summary) {
  const select = document.querySelector("#dashboard-application-filter");
  if (!select || select.dataset.ready === "1") return;
  const options = (summary.applications || []).map((item) => `<option value="${item.id}">${item.name}</option>`);
  select.innerHTML = [`<option value="">全部应用</option>`, ...options].join("");
  select.dataset.ready = "1";
}

function dashboardFilters() {
  return {
    applicationId: document.querySelector("#dashboard-application-filter")?.value || "",
    priority: document.querySelector("#dashboard-priority-filter")?.value || ""
  };
}

function filteredDashboardActions(summary) {
  const filters = dashboardFilters();
  return (summary.openActions || []).filter((item) =>
    (!filters.applicationId || item.applicationId === filters.applicationId) &&
    (!filters.priority || item.priority === filters.priority)
  );
}

function renderFilterSummary(summary) {
  const filters = dashboardFilters();
  const app = (summary.applications || []).find((item) => item.id === filters.applicationId);
  const count = filteredDashboardActions(summary).length;
  document.querySelector("#dashboard-filter-summary").textContent = [
    app?.name || "全部应用",
    filters.priority || "全部优先级",
    `${count} open actions`
  ].join(" / ");
}

function renderDependencies(items) {
  document.querySelector("#dashboard-dependencies").innerHTML = items.map((item) => `<div>
    <strong>${item.track || item.id}</strong>
    <span>${item.status || "pending"} / ${item.owner || "owner-pending"}</span>
    <small>${item.nextAction || ""}</small>
  </div>`).join("") || `<div><strong>暂无现场依赖</strong><span>生产签字项尚未进入快照。</span></div>`;
}

function renderInterfaces(items) {
  document.querySelector("#dashboard-interfaces").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.domain || item.id}</strong>
    <span>${item.priority || "P2"} / ${item.status || "pending"}</span>
    <small>${item.nextAction || ""}</small>
  </div>`).join("") || `<div><strong>暂无接口轨道</strong><span>等待 platformInterfaces 数据。</span></div>`;
}

function renderEvidence(items) {
  document.querySelector("#dashboard-evidence").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${item.name || item.id}</strong>
    <span>${item.status || "pending"} / ${item.records || 0} records</span>
    <small>${item.owner || ""}</small>
  </div>`).join("") || `<div><strong>暂无验收证据</strong><span>等待平台证据归档。</span></div>`;
}

function collectStaticOpenActions(state, applications) {
  const appByCollection = Object.fromEntries(applications.flatMap((app) =>
    app.collections.map((item) => [item.collection, app])
  ));
  return ["followups", "careOrders", "medicationPickups", "insuranceClaims", "emergencySignals", "countyCollaborationOrders", "countyMutualRecognitionRecords", "countyAiDiagnosisCases"]
    .flatMap((collection) => {
      const app = appByCollection[collection] || applications[0];
      return (Array.isArray(state[collection]) ? state[collection] : []).filter((item) => !isClosedDashboardStatus(item.status)).map((item) => ({
        id: item.id || `${collection}-open`,
        collection,
        applicationId: app.id,
        application: app.name,
        entry: app.entry,
        title: item.title || item.taskName || item.orderType || item.item || item.claimType || item.medication || collection,
        owner: item.owner || item.assignee || item.institution || item.center || "owner-pending",
        status: item.status || "open",
        priority: dashboardPriority(item)
      }));
    }).slice(0, 12);
}

function isClosedDashboardStatus(status) {
  return /closed|resolved|approved|recognized|completed|passed|ready|signed|done|已完成|已通过|已闭环/.test(String(status || ""));
}

function dashboardPriority(item) {
  const text = [item.priority, item.level, item.risk, item.riskLevel, item.status].filter(Boolean).join(" ");
  if (/high|urgent|critical|overdue|高|逾期|危急/i.test(text)) return "high";
  if (/medium|warning|中|待/i.test(text)) return "medium";
  return "normal";
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  return 0;
}
