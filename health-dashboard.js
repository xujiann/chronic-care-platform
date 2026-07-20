const DASHBOARD_API_BASE = location.protocol === "file:" ? "" : "/api";
const DASHBOARD_SUMMARY_ROUTE = "/api/health-dashboard/summary";
const DASHBOARD_SUMMARY_PATH = DASHBOARD_SUMMARY_ROUTE.replace(/^\/api/, "");
let currentDashboardSummary = null;
const industryIndicatorFilters = { category: "all", status: "all", period: "month" };

document.addEventListener("DOMContentLoaded", async () => {
  const summary = await loadDashboardSummary();
  currentDashboardSummary = summary;
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
      collections: ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
      functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, compliant data export, usage audit, and outcome return without AI diagnosis.",
      reusePoints: ["research datasets", "disease registry models", "compliant data exports", "data access logs", "security acceptance ledger", "clinical source records"],
      apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "GET /api/research/compliant-exports", "POST /api/research/datasets/:id/evidence", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/compliant-exports", "POST /api/research/datasets/:id/outcomes"],
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
  const indicatorCenter = buildStaticIndustryGovernanceIndicatorCenter(state);
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
    indicatorCenter,
    applications,
    risks: [],
    openActions: [],
    interfaces: interfaces.map((item) => ({ id: item.id, domain: item.domain || item.name, priority: item.priority, owner: item.owner, status: item.status, nextAction: item.next })),
    evidence: evidence.map((item) => ({ id: item.id, name: item.name || item.category, owner: item.owner, status: item.status, records: Array.isArray(item.records) ? item.records.length : 0, nextAction: item.next })),
    siteDependencies: dependencies.map((item) => ({ id: item.id, track: item.track || item.name, owner: item.owner, status: item.status, nextAction: item.nextAction || item.next }))
  };
}

function buildStaticIndustryGovernanceIndicatorCenter(state) {
  const month = new Date().toISOString().slice(0, 7);
  const year = new Date().toISOString().slice(0, 4);
  const definitions = [
    ["industry-physical-exam", "健康体检覆盖", "专项监管", "医政医管处/基层卫生处", ["physicalExaminationRecords", "healthExamRecords"], "./citizen.html"],
    ["industry-fever-clinic", "发热门诊报告闭环", "专项监管", "医政医管处/疾控处", ["feverClinicVisits", "publicHealthEvents"], "./public-health.html"],
    ["industry-disease-reporting", "疾病报卡回执率", "公卫监管", "疾控处/区县信息中心", ["phase2DiseaseReportQueue", "phase2DiseaseReportReceipts"], "./platform.html#phase2-disease-reporting"],
    ["industry-clinical-assist", "临床辅助消息回执率", "医政质量", "医政医管处/质控中心", ["phase2ClinicalAssistAlerts", "phase2ClinicalAssistReceipts"], "./platform.html#phase2-clinical-assist"],
    ["industry-archive-access", "健康档案调阅合规率", "便民服务", "规划信息处/数据安全岗", ["dataAccessLogs", "personalRecords"], "./regional-data-sharing.html"],
    ["industry-appointment-reconciliation", "预约订单对账完成率", "便民服务", "医政医管处/便民服务运营", ["registrationOrders", "careOrders"], "./citizen.html"],
    ["industry-family-doctor", "家庭医生履约覆盖率", "基层卫生", "基层卫生处/区县卫健局", ["phase2FamilyDoctorContracts", "phase2FamilyDoctorFulfillments"], "./platform.html#phase2-family-doctor-contracts"],
    ["industry-regional-performance", "区域绩效证据就绪率", "区域绩效", "规划信息处/医政医管处", ["institutionCreditEvaluations", "countyAcceptanceLedger", "healthDashboardSnapshots"], "./county.html"]
  ];
  const indicators = definitions.map(([id, topic, category, owner, sourceCollections, href]) => {
    const records = sourceCollections.reduce((sum, collection) => sum + countRows(state[collection]), 0);
    const status = records > 0 ? "watch" : "blocked";
    const currentValue = `${records} records`;
    return {
      id,
      topic,
      category,
      definition: `${topic}的静态预览口径，正式统计需由源系统按周期回传。`,
      currentValue,
      status,
      exceptionCount: records > 0 ? 0 : 1,
      owner,
      sourceCollections,
      sourceSystems: sourceCollections,
      dataQuality: records > 0 ? "medium" : "source-required",
      reports: [
        { id: "month", label: "月报", period: month, value: currentValue, status, basis: "static snapshot" },
        { id: "year", label: "年报", period: year, value: currentValue, status, basis: "static snapshot" }
      ],
      drilldown: { label: "查看源业务", href },
      nextAction: records > 0 ? "核对源数据版本和正式统计口径。" : "接入并核验正式源数据。"
    };
  });
  const categories = [...new Set(indicators.map((item) => item.category))];
  const periodViews = [
    { id: "month", label: "月报", period: month, indicators: indicators.length },
    { id: "year", label: "年报", period: year, indicators: indicators.length }
  ];
  return {
    title: "二期行业治理指标中心",
    summary: { indicators: indicators.length, categories: categories.length, ready: 0, watch: indicators.filter((item) => item.status === "watch").length, blocked: indicators.filter((item) => item.status === "blocked").length, exceptions: indicators.reduce((sum, item) => sum + item.exceptionCount, 0), reportViews: 2 },
    categories,
    periodViews,
    indicators,
    exportFields: ["topic", "category", "definition", "currentValue", "status", "exceptionCount", "owner", "sourceCollections", "sourceSystems", "nextAction"],
    boundary: "指标中心仅用于监管口径、报告和下钻，不能替代源系统法定上报或现场签字统计。"
  };
}

function renderDashboard(summary) {
  renderMetrics(summary);
  renderIndustryGovernanceIndicatorCenter(summary.indicatorCenter || {});
  document.querySelector("#dashboard-scope").textContent = summary.scope?.rule || "";
  renderApplications(summary.applications || []);
  renderTemplates(summary.applications || []);
  renderRisks(summary.risks || []);
  renderActions(summary.openActions || []);
  renderDependencies(summary.siteDependencies || []);
  renderInterfaces(summary.interfaces || []);
  renderEvidence(summary.evidence || []);
  renderBloodCoordination(summary.bloodCoordination || {});
}

function renderBloodCoordination(coordination) {
  const target = document.querySelector("#dashboard-blood-coordination");
  if (!target) return;
  const rows = coordination.projections || [];
  target.innerHTML = rows.length ? `<table><thead><tr><th>级别</th><th>治理事件</th><th>订阅模块</th><th>对象</th><th>发生时间</th></tr></thead><tbody>${rows.map((item) => `<tr><td>${escapeHtml(item.severity)}</td><td>${escapeHtml(item.eventType)}</td><td>${escapeHtml(item.consumer)}</td><td>${escapeHtml(item.subjectId)}</td><td>${escapeHtml(item.occurredAt)}</td></tr>`).join("")}</tbody></table>` : "<p>尚无区域血液事件投影。</p>";
}

function renderIndustryGovernanceIndicatorCenter(center) {
  const indicators = Array.isArray(center.indicators) ? center.indicators : [];
  const categories = Array.isArray(center.categories) ? center.categories : [];
  const periodViews = Array.isArray(center.periodViews) ? center.periodViews : [];
  const categorySelect = document.querySelector("#industry-indicator-category");
  const statusSelect = document.querySelector("#industry-indicator-status");
  const periodSelect = document.querySelector("#industry-indicator-period");
  if (!categorySelect || !statusSelect || !periodSelect) return;
  categorySelect.innerHTML = `<option value="all">全部分类</option>${categories.map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join("")}`;
  periodSelect.innerHTML = periodViews.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.label)} · ${escapeHtml(item.period)}</option>`).join("") || `<option value="month">月报</option><option value="year">年报</option>`;
  categorySelect.value = industryIndicatorFilters.category;
  statusSelect.value = industryIndicatorFilters.status;
  periodSelect.value = industryIndicatorFilters.period;
  const visible = indicators.filter((item) =>
    (industryIndicatorFilters.category === "all" || item.category === industryIndicatorFilters.category) &&
    (industryIndicatorFilters.status === "all" || item.status === industryIndicatorFilters.status)
  );
  const selectedPeriod = periodViews.find((item) => item.id === industryIndicatorFilters.period) || periodViews[0] || {};
  const selectedReports = visible.map((item) => ({ item, report: (item.reports || []).find((report) => report.id === industryIndicatorFilters.period) || item.reports?.[0] || {} }));
  document.querySelector("#industry-indicator-summary").textContent = `${selectedPeriod.label || "报告"} ${selectedPeriod.period || ""} / ${visible.length}/${indicators.length} 项 / ${visible.filter((item) => item.status === "blocked").length} 项数据源阻断`;
  document.querySelector("#industry-indicator-metrics").innerHTML = [
    ["监管指标", indicators.length, `${categories.length} 个分类`],
    ["当前显示", visible.length, `${selectedPeriod.label || "报告"} ${selectedPeriod.period || ""}`],
    ["数据源阻断", visible.filter((item) => item.status === "blocked").length, "不得纳入正式报表"],
    ["异常记录", visible.reduce((sum, item) => sum + Number(item.exceptionCount || 0), 0), "回到源业务闭环"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join("");
  document.querySelector("#industry-indicator-list").innerHTML = selectedReports.map(({ item, report }) => `
    <article class="governance-indicator-card ${escapeHtml(item.status)}" data-industry-indicator="${escapeHtml(item.id)}" data-industry-category="${escapeHtml(item.category)}" data-industry-status="${escapeHtml(item.status)}">
      <div class="governance-indicator-heading">
        <span>${escapeHtml(item.category)}</span>
        <span class="badge ${item.status === "ready" ? "info" : item.status === "watch" ? "warn" : "danger"}">${escapeHtml(item.status)}</span>
      </div>
      <strong>${escapeHtml(item.topic)}</strong>
      <div class="governance-indicator-value">${escapeHtml(report.value || item.currentValue)}</div>
      <p>${escapeHtml(item.definition)}</p>
      <small>${escapeHtml(report.label || "报告")} ${escapeHtml(report.period || "")} / 异常 ${escapeHtml(item.exceptionCount || 0)}</small>
      <small>${escapeHtml(item.owner)} / ${escapeHtml((item.sourceCollections || []).join(", "))}</small>
      <p>${escapeHtml(item.nextAction)}</p>
      <a class="inline-action" href="${escapeHtml(item.drilldown?.href || "#")}">${escapeHtml(item.drilldown?.label || "查看源业务")}</a>
    </article>
  `).join("") || `<article class="governance-indicator-card empty"><strong>暂无匹配指标</strong><p>调整分类或状态筛选后查看。</p></article>`;
  document.querySelector("#industry-indicator-boundary").textContent = center.boundary || "指标中心不替代源系统法定上报。";
  bindIndustryGovernanceIndicatorControls(center);
}

function bindIndustryGovernanceIndicatorControls(center) {
  ["industry-indicator-category", "industry-indicator-status", "industry-indicator-period"].forEach((id) => {
    const control = document.getElementById(id);
    if (!control || control.dataset.industryIndicatorBound === "1") return;
    control.dataset.industryIndicatorBound = "1";
    control.addEventListener("change", () => {
      industryIndicatorFilters.category = document.querySelector("#industry-indicator-category")?.value || "all";
      industryIndicatorFilters.status = document.querySelector("#industry-indicator-status")?.value || "all";
      industryIndicatorFilters.period = document.querySelector("#industry-indicator-period")?.value || "month";
      renderIndustryGovernanceIndicatorCenter(center);
    });
  });
  const exportButton = document.querySelector("#industry-indicator-export");
  if (!exportButton || exportButton.dataset.industryIndicatorBound === "1") return;
  exportButton.dataset.industryIndicatorBound = "1";
  exportButton.addEventListener("click", () => {
    const indicators = (center.indicators || []).filter((item) =>
      (industryIndicatorFilters.category === "all" || item.category === industryIndicatorFilters.category) &&
      (industryIndicatorFilters.status === "all" || item.status === industryIndicatorFilters.status)
    );
    const payload = {
      generatedAt: currentDashboardSummary?.generatedAt || new Date().toISOString(),
      period: industryIndicatorFilters.period,
      category: industryIndicatorFilters.category,
      status: industryIndicatorFilters.status,
      boundary: center.boundary,
      indicators
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `industry-governance-indicators-${industryIndicatorFilters.period}.json`;
    link.click();
    URL.revokeObjectURL(url);
  });
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
