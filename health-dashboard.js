const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  renderDashboard(summary);
});

async function loadDashboardSummary() {
  if (DASHBOARD_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${DASHBOARD_API_BASE}${DASHBOARD_SUMMARY_PATH}`);
      if (response.ok) return response.json();
    } catch (error) {
      // Static preview falls back to local data.
    }
  }
  const state = await loadPlatformState({});
  return buildStaticDashboardSummary(state);
}

function buildStaticDashboardSummary(state) {
  const applications = [
    {
      id: "regional-data-sharing",
      name: "Regional diagnosis data sharing",
      entry: "regional-data-sharing.html",
      collections: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "dataAccessLogs", "platformInterfaces"],
      functionalBoundary: "Share regional diagnosis and treatment data, authorization evidence, report lookup, and access review without becoming the clinical source system.",
      reusePoints: ["resident master index", "personal health records", "diagnostic reports", "integration contracts", "audit logs"],
      apiRoutes: ["GET /api/regional-data-sharing", "POST /api/regional-data-sharing/access-reviews"],
      testEvidence: ["test/static.test.js regional-data-sharing checks", "regional-data-sharing:report"],
      acceptanceEvidence: ["regional-data-sharing-report.json", "regional-data-sharing-report.md"]
    },
    {
      id: "referral-teleconsultation",
      name: "Referral and teleconsultation",
      entry: "county.html",
      collections: ["referralSystem", "referrals", "referralTeleconsultations", "careOrders", "countyCollaborationOrders", "countyAcceptanceLedger"],
      functionalBoundary: "Coordinate referral, remote consultation, receiving feedback, report return, resident authorization, and consortium performance evidence.",
      reusePoints: ["county consortium workflows", "care orders", "collaboration orders", "resident authorization", "acceptance ledger"],
      apiRoutes: ["GET /api/referral-teleconsultations", "POST /api/referral-teleconsultations", "POST /api/referral-teleconsultations/:id/actions"],
      testEvidence: ["test/referral-teleconsultation-readiness.test.js", "referral:readiness"],
      acceptanceEvidence: ["referral-teleconsultation-readiness-report.json", "referral-teleconsultation-readiness-report.md"]
    },
    {
      id: "quality-safety",
      name: "Medical quality and safety supervision",
      entry: "quality-safety.html",
      collections: ["diagnosticReports", "countyMutualRecognitionRecords", "dataQualityIssues", "institutionCreditEvaluations", "securityEvents", "hospitalInteroperabilityFunctions"],
      functionalBoundary: "Supervise quality events, critical values, clinical pathway evidence, mutual-recognition quality control, dispatch, feedback, and review.",
      reusePoints: ["diagnostic reports", "mutual-recognition records", "data-quality issues", "institution credit evaluation", "security audit events"],
      apiRoutes: ["GET /api/quality-safety/dashboard", "POST /api/quality-safety/issues/:id/dispatch", "POST /api/quality-safety/rectifications/:id/feedback", "POST /api/quality-safety/rectifications/:id/review"],
      testEvidence: ["test/quality-safety-report.test.js", "quality-safety:report"],
      acceptanceEvidence: ["quality-safety-report.json", "quality-safety-report.md"]
    },
    {
      id: "operations-dispatch",
      name: "Hospital operations and resource dispatch",
      entry: "operations.html",
      collections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit", "operationsReadiness"],
      functionalBoundary: "Monitor hospital operation indicators and coordinate resource dispatch, alert handling, and statistics reconciliation.",
      reusePoints: ["health statistics", "statistics ingestion", "medical resources", "platform process audit", "runtime metrics"],
      apiRoutes: ["GET /api/operations/dashboard", "POST /api/operations/dispatch", "POST /api/operations/reconciliation/:id/review"],
      testEvidence: ["test/hospital-operations-readiness.test.js", "operations:readiness"],
      acceptanceEvidence: ["hospital-operations-readiness-report.json", "hospital-operations-readiness-report.md"]
    },
    {
      id: "drug-consumable-supervision",
      name: "Drug, consumable, and rational medication supervision",
      entry: "insurance.html",
      collections: ["drugConsumableSupervisions", "medicationPickups", "insuranceClaims", "institutionSupervisions", "integrationContracts"],
      functionalBoundary: "Regulate rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement, and remediation loops.",
      reusePoints: ["drug and consumable supervision records", "medication pickup records", "insurance claims", "institution supervision", "integration contracts"],
      apiRoutes: ["GET /api/drug-consumable-supervision", "POST /api/drug-consumable-supervision/:id/review", "POST /api/drug-consumable-supervision/:id/remediation", "POST /api/drug-consumable-supervision/:id/insurance-sync"],
      testEvidence: ["test/drug-consumable-readiness.test.js", "drug-consumable:readiness"],
      acceptanceEvidence: ["drug-consumable-readiness-report.json", "drug-consumable-readiness-report.md"]
    },
    {
      id: "chronic-followup",
      name: "Chronic disease management and post-discharge follow-up",
      entry: "index.html",
      collections: ["chronicScreeningTasks", "chronicManagementPlans", "followups", "personalRecords", "medicationPickups", "chronicAcceptanceLedger"],
      functionalBoundary: "Manage screening, tiered intervention, post-discharge follow-up, medication adherence, family doctor collaboration, and resident feedback.",
      reusePoints: ["chronic screening tasks", "management plans", "followups", "personal records", "medication pickup evidence", "chronic acceptance ledger"],
      apiRoutes: ["GET /api/service-acceptance-summary", "POST /api/chronic/followup-feedback", "PATCH /api/chronic-management-plans/:id"],
      testEvidence: ["test/chronic-followup-readiness.test.js", "chronic:followup-readiness"],
      acceptanceEvidence: ["chronic-followup-readiness-report.json", "chronic-followup-readiness-report.md"]
    },
    {
      id: "research-sandbox",
      name: "Research datasets and data sandbox",
      entry: "platform.html",
      collections: ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
      functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, usage audit, and outcome return.",
      reusePoints: ["research datasets", "disease registry models", "data access logs", "security acceptance ledger", "clinical source records"],
      apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/outcomes"],
      testEvidence: ["test/research-sandbox-readiness.test.js", "research:sandbox"],
      acceptanceEvidence: ["research-sandbox-readiness-report.json", "research-sandbox-readiness-report.md"]
    },
    {
      id: "health-dashboard",
      name: "Health commission aggregate dashboard",
      entry: "health-dashboard.html",
      collections: ["healthDashboardSnapshots", "platformEvidence", "platformInterfaces", "productionDeploymentPlan", "platformRoadmap"],
      aggregate: true,
      functionalBoundary: "Aggregate indicators, risks, open actions, interfaces, acceptance evidence, and site dependencies from the first seven source applications.",
      reusePoints: ["health dashboard snapshots", "platform evidence", "platform interfaces", "production deployment plan", "platform roadmap"],
      apiRoutes: ["GET /api/health-dashboard/summary"],
      testEvidence: ["test/health-dashboard-summary.test.js", "test/api.test.js health-dashboard summary assertions", "health-dashboard:summary"],
      acceptanceEvidence: ["health-dashboard-summary.json", "health-dashboard-summary.md"]
    }
  ].map((app) => {
    const dataCollections = app.collections;
    const records = dataCollections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    return {
      ...app,
      collections: dataCollections.map((collection) => ({ collection, records: countRows(state[collection]) })),
      dataCollections,
      frontendEntry: app.entry,
      records,
      openActions: 0,
      highRisks: 0,
      evidenceRecords: 0,
      status: records ? "modeled" : "empty-ready",
      boundary: app.aggregate
        ? "Aggregate dashboard only; the first seven source applications remain the system of record."
        : "Aggregated in the dashboard; detailed workflow remains in the source application."
    };
  });
  const evidence = Array.isArray(state.platformEvidence) ? state.platformEvidence : [];
  const interfaces = Array.isArray(state.platformInterfaces) ? state.platformInterfaces : [];
  const dependencies = Array.isArray(state.productionDeploymentPlan) ? state.productionDeploymentPlan : [];
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    scope: {
      role: "priority-eight-application-portfolio",
      rule: "Static preview tracks the eight priority applications; source workflows stay in their owning applications."
    },
    totals: {
      applications: applications.length,
      sourceApplications: applications.filter((item) => item.id !== "health-dashboard").length,
      sourceRecords: applications.reduce((sum, item) => sum + item.records, 0),
      openActions: 0,
      highRisks: 0,
      interfaceTracks: interfaces.length,
      evidenceRecords: evidence.reduce((sum, item) => sum + (Array.isArray(item.records) ? item.records.length : 0), 0),
      siteDependencies: dependencies.length
    },
    applications,
    risks: [],
    openActions: [],
    interfaces: interfaces.map((item) => ({ id: item.id, domain: item.domain || item.name, priority: item.priority, owner: item.owner, status: item.status, nextAction: item.next })),
    evidence: evidence.map((item) => ({ id: item.id, name: item.name || item.category, owner: item.owner, status: item.status, records: Array.isArray(item.records) ? item.records.length : 0, nextAction: item.next })),
    siteDependencies: dependencies.map((item) => ({ id: item.id, track: item.track || item.name, owner: item.owner, status: item.status, nextAction: item.nextAction || item.next }))
  };
}

function renderDashboard(summary) {
  renderMetrics(summary);
  document.querySelector("#dashboard-scope").textContent = summary.scope?.rule || "";
  renderApplications(summary.applications || []);
  renderTemplates(summary.applications || []);
  renderRisks(summary.risks || []);
  renderActions(summary.openActions || []);
  renderDependencies(summary.siteDependencies || []);
  renderInterfaces(summary.interfaces || []);
  renderEvidence(summary.evidence || []);
}

function renderTemplates(applications) {
  document.querySelector("#dashboard-templates").innerHTML = applications.map((item) => `<article class="item">
    <div>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.functionalBoundary || item.boundary || "")}</p>
      <div class="template-meta">
        <span><strong>Reuse</strong>${escapeHtml((item.reusePoints || []).join(", "))}</span>
        <span><strong>Data</strong>${escapeHtml((item.dataCollections || []).join(", "))}</span>
        <span><strong>API</strong>${escapeHtml((item.apiRoutes || []).join(", "))}</span>
        <span><strong>Tests</strong>${escapeHtml((item.testEvidence || []).join(", "))}</span>
        <span><strong>Acceptance</strong>${escapeHtml((item.acceptanceEvidence || []).join(", "))}</span>
      </div>
    </div>
    <a class="inline-action" href="./${escapeHtml(item.frontendEntry || item.entry)}">Open</a>
  </article>`).join("");
}

function renderMetrics(summary) {
  const totals = summary.totals || {};
  document.querySelector("#dashboard-metrics").innerHTML = [
    ["Applications", totals.applications || 0, `${totals.sourceApplications || 0} source workflows plus dashboard`],
    ["Source records", totals.sourceRecords || 0, "From data/db.json and business APIs"],
    ["Open actions", totals.openActions || 0, "Cross-application items"],
    ["High risks", totals.highRisks || 0, "Normalized risk signals"],
    ["Interfaces", totals.interfaceTracks || 0, "platformInterfaces"],
    ["Evidence", totals.evidenceRecords || 0, "platformEvidence records"],
    ["Site dependencies", totals.siteDependencies || 0, "Cutover signoff items"],
    ["Readiness", summary.ok ? "OK" : "Check", summary.generatedAt || ""]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
}

function renderApplications(applications) {
  document.querySelector("#dashboard-applications").innerHTML = `<table>
    <thead><tr><th>Application</th><th>Entry</th><th>Records</th><th>Open actions</th><th>High risks</th><th>Status</th></tr></thead>
    <tbody>${applications.map((item) => `<tr>
      <td>${escapeHtml(item.name)}</td>
      <td><a href="./${escapeHtml(item.entry)}">${escapeHtml(item.entry)}</a></td>
      <td>${escapeHtml(item.records)}</td>
      <td>${escapeHtml(item.openActions)}</td>
      <td>${escapeHtml(item.highRisks)}</td>
      <td><span class="badge ${item.status === "modeled" ? "info" : "warn"}">${escapeHtml(item.status)}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRisks(risks) {
  document.querySelector("#dashboard-risks").innerHTML = risks.map((item) => `<div>
    <strong>${escapeHtml(item.application)}</strong>
    <span>${escapeHtml(item.highRisks)} high / ${escapeHtml(item.openActions)} open</span>
    <small>${escapeHtml(item.nextAction)}</small>
  </div>`).join("") || `<div><strong>No high-risk summary</strong><span>Waiting for source applications or site joint-test data.</span></div>`;
}

function renderActions(actions) {
  document.querySelector("#dashboard-actions").innerHTML = actions.map((item, index) => `<article class="priority-row">
    <div class="priority-rank ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${index + 1}</div>
    <div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.collection)} / ${escapeHtml(item.status)}</p>
    </div>
    <div class="capability-side">
      <span class="badge ${item.priority === "high" ? "danger" : item.priority === "medium" ? "warn" : "info"}">${escapeHtml(item.priority)}</span>
      <small>${escapeHtml(item.owner || "owner-pending")}</small>
    </div>
  </article>`).join("") || `<article class="priority-row"><div class="priority-rank info">0</div><div><h3>No cross-application action</h3><p>Open actions stay owned by their source applications.</p></div></article>`;
}

function renderDependencies(items) {
  document.querySelector("#dashboard-dependencies").innerHTML = items.map((item) => `<div>
    <strong>${escapeHtml(item.track || item.id)}</strong>
    <span>${escapeHtml(item.status || "pending")} / ${escapeHtml(item.owner || "owner-pending")}</span>
    <small>${escapeHtml(item.nextAction || "")}</small>
  </div>`).join("") || `<div><strong>No site dependency</strong><span>Cutover signoff items are not in the snapshot.</span></div>`;
}

function renderInterfaces(items) {
  document.querySelector("#dashboard-interfaces").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${escapeHtml(item.domain || item.id)}</strong>
    <span>${escapeHtml(item.priority || "P2")} / ${escapeHtml(item.status || "pending")}</span>
    <small>${escapeHtml(item.nextAction || "")}</small>
  </div>`).join("") || `<div><strong>No interface track</strong><span>Waiting for platformInterfaces data.</span></div>`;
}

function renderEvidence(items) {
  document.querySelector("#dashboard-evidence").innerHTML = items.slice(0, 8).map((item) => `<div>
    <strong>${escapeHtml(item.name || item.id)}</strong>
    <span>${escapeHtml(item.status || "pending")} / ${escapeHtml(item.records || 0)} records</span>
    <small>${escapeHtml(item.owner || "")}</small>
  </div>`).join("") || `<div><strong>No evidence</strong><span>Waiting for platform evidence records.</span></div>`;
}

function countRows(value) {
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? item.length : 0), 0);
  return 0;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}
