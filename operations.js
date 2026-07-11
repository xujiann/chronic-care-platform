const OPERATIONS_API_BASE = location.protocol === "file:" ? "" : "/api";
let operationsDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindDispatchForm();
  bindProductionOperationsActions();
  bindObservabilityAlertActions();
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
  const serviceLevels = Array.isArray(state.productionServiceLevels) ? state.productionServiceLevels : [];
  const dutyShifts = Array.isArray(state.operationsDutyShifts) ? state.operationsDutyShifts : [];
  const incidents = Array.isArray(state.operationsIncidents) ? state.operationsIncidents : [];
  const drills = Array.isArray(state.disasterRecoveryDrills) ? state.disasterRecoveryDrills : [];
  const evidencePackets = Array.isArray(state.operationsEvidencePackets) ? state.operationsEvidencePackets : [];
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
    alertRules,
    observability: {
      ok: true,
      status: "adapter-foundation-ready-configuration-pending",
      productionReady: false,
      routing: {
        adapterReady: false,
        productionReady: false,
        summary: { total: 2, configured: 0 },
        routes: [
          { route: "SIEM", configured: false, productionHttps: true },
          { route: "WEBHOOK", configured: false, productionHttps: true }
        ]
      },
      summary: { activeSignals: 0, deliveries: 0, accepted: 0, failed: 0, configuredRoutes: 0, totalRoutes: 2 },
      activeSignals: [],
      deliveries: [],
      boundary: "Static preview exposes the alert-routing contract only. Production requires a configured receiver and signed acceptance."
    },
    runCenter: {
      ok: true,
      status: "run-center-ready-onsite-blocked",
      summary: {
        serviceLevels: serviceLevels.length,
        dutyShifts: dutyShifts.length,
        handoffsRecorded: dutyShifts.filter((item) => item.handoffStatus === "recorded-demo").length,
        incidents: incidents.length,
        openIncidents: incidents.filter((item) => !/resolved|closed/i.test(item.status)).length,
        drills: drills.length,
        validatedDrills: drills.filter((item) => item.status === "validated-demo").length,
        evidencePackets: evidencePackets.length,
        productionReady: 0,
        onsiteBlockers: 5
      },
      serviceLevels,
      dutyShifts,
      incidents,
      drills,
      evidencePackets,
      blockers: ["signed duty roster", "remote backup", "full-volume recovery", "live paging and ticketing", "DR signoff"],
      boundary: "Static preview shows the operating model only. Production operation requires live monitoring, remote backup, measured recovery, signed duty rosters and multi-party approval."
    }
  };
}

function renderOperationsDashboard(dashboard) {
  renderOperationsMetrics(dashboard.summary || {});
  renderOperationsSnapshots(dashboard.snapshots || []);
  renderAlertRules(dashboard.alertRules || []);
  renderDispatchRequests(dashboard.dispatchRequests || []);
  renderReconciliationReviews(dashboard.reconciliationReviews || []);
  renderProductionOperationsCenter(dashboard.runCenter || {});
  renderObservabilityAlertCenter(dashboard.observability || {});
  const boundary = document.querySelector("#operations-boundary");
  if (boundary) boundary.textContent = `${(dashboard.boundaries || []).join(" / ")} | reuse: ${(dashboard.reusedCollections || []).join(", ")}`;
}

function renderObservabilityAlertCenter(center) {
  const metricsTarget = document.querySelector("#observability-alert-metrics");
  const routesTarget = document.querySelector("#observability-alert-routes");
  const signalsTarget = document.querySelector("#observability-active-signals");
  const deliveriesTarget = document.querySelector("#observability-alert-deliveries");
  if (!metricsTarget || !routesTarget || !signalsTarget || !deliveriesTarget) return;
  const summary = center.summary || {};
  const routes = center.routing?.routes || [];
  const configuredRoutes = routes.filter((item) => item.configured && item.productionHttps);
  const signals = center.activeSignals || [];
  const deliveries = center.deliveries || [];
  const metrics = [
    ["活动信号", summary.activeSignals || 0, "慢请求、死信、数据质量、医院运行与安全"],
    ["已配置路由", summary.configuredRoutes || 0, `${summary.totalRoutes || 0} 条候选路由`],
    ["接收回执", summary.accepted || 0, `${summary.deliveries || 0} 次投递`],
    ["失败待重放", summary.failed || 0, "失败自动进入运维事件队列"]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card"><span>${operationsEscapeHtml(label)}</span><strong>${operationsEscapeHtml(value)}</strong><small>${operationsEscapeHtml(hint)}</small></article>`).join("");
  routesTarget.innerHTML = `<table><thead><tr><th>路由</th><th>地址</th><th>签名</th><th>HTTPS</th><th>生产验收</th></tr></thead><tbody>${routes.map((item) => `<tr><td><strong>${operationsEscapeHtml(item.route)}</strong></td><td>${item.endpointConfigured ? "已配置" : "未配置"}</td><td>${item.signingSecretConfigured ? "已配置" : "未配置"}</td><td>${item.productionHttps ? "通过" : "阻断"}</td><td>未完成</td></tr>`).join("")}</tbody></table>`;
  signalsTarget.innerHTML = signals.length ? `<table><thead><tr><th>级别</th><th>信号</th><th>摘要</th><th>指标</th><th>投递</th></tr></thead><tbody>${signals.map((item) => `<tr><td><span class="badge ${productionOperationsBadge(item.severity)}">${operationsEscapeHtml(item.severity)}</span></td><td><strong>${operationsEscapeHtml(item.title)}</strong><br><small>${operationsEscapeHtml(item.source)}</small></td><td>${operationsEscapeHtml(item.summary)}</td><td>${operationsEscapeHtml(Object.entries(item.metrics || {}).map(([key, value]) => `${key}=${value}`).join("；"))}</td><td>${configuredRoutes.length ? configuredRoutes.map((route) => `<button class="inline-action" type="button" data-observability-alert-action="dispatch" data-fingerprint="${operationsEscapeHtml(item.fingerprint)}" data-route="${operationsEscapeHtml(route.route)}">发送至 ${operationsEscapeHtml(route.route)}</button>`).join(" ") : "待配置生产路由"}</td></tr>`).join("")}</tbody></table>` : "<p>当前没有达到投递条件的运行信号。</p>";
  deliveriesTarget.innerHTML = deliveries.length ? `<table><thead><tr><th>时间</th><th>路由</th><th>告警</th><th>状态</th><th>回执</th><th>操作</th></tr></thead><tbody>${deliveries.map((item) => `<tr><td>${operationsEscapeHtml(item.createdAt || "")}</td><td>${operationsEscapeHtml(item.route)}</td><td><strong>${operationsEscapeHtml(item.alert?.title || item.fingerprint)}</strong><br><small>${operationsEscapeHtml(item.idempotencyKey)}</small></td><td><span class="badge ${productionOperationsBadge(item.deadLetter ? "critical" : item.status)}">${operationsEscapeHtml(item.status)}</span></td><td>${operationsEscapeHtml(item.adapterReceipt?.receiptId || item.deadLetterReason || "-")}</td><td>${item.deadLetter ? `<button class="inline-action" type="button" data-observability-alert-action="retry" data-delivery-id="${operationsEscapeHtml(item.id)}">重试</button>` : "已接收"}</td></tr>`).join("")}</tbody></table>` : "<p>尚无告警投递记录。</p>";
  const statusTarget = document.querySelector("#observability-alert-status");
  if (statusTarget) {
    statusTarget.textContent = center.routing?.adapterReady ? "路由已配置，现场验收待完成" : "生产路由待配置";
    statusTarget.className = `badge ${center.routing?.adapterReady ? "info" : "warn"}`;
  }
  const boundaryTarget = document.querySelector("#observability-alert-boundary");
  if (boundaryTarget) boundaryTarget.textContent = center.boundary || "告警适配器基础不等于生产监控验收完成。";
}

function bindObservabilityAlertActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-observability-alert-action]");
    if (!button) return;
    if (button.dataset.observabilityAlertAction === "dispatch") {
      dispatchObservabilityAlert(button.dataset.fingerprint, button.dataset.route, button);
    } else if (button.dataset.observabilityAlertAction === "retry") {
      retryObservabilityAlert(button.dataset.deliveryId, button);
    }
  });
}

async function dispatchObservabilityAlert(fingerprint, route, button) {
  if (!OPERATIONS_API_BASE || !fingerprint || !route) return;
  const alert = (operationsDashboard?.observability?.activeSignals || []).find((item) => item.fingerprint === fingerprint);
  if (!alert) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  button.disabled = true;
  try {
    const response = await request(`${OPERATIONS_API_BASE}/observability/alerts/dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ route, idempotencyKey: `${route}:${fingerprint}`, alert })
    });
    const payload = await response.json().catch(() => ({}));
    await loadOperationsDashboard();
    const statusTarget = document.querySelector("#observability-alert-status");
    if (statusTarget) {
      statusTarget.textContent = response.ok ? `已投递：${payload.delivery?.adapterReceipt?.receiptId || route}` : `投递失败：${payload.delivery?.deadLetterReason || payload.message || response.status}`;
      statusTarget.className = `badge ${response.ok ? "info" : "danger"}`;
    }
  } catch (error) {
    const statusTarget = document.querySelector("#observability-alert-status");
    if (statusTarget) {
      statusTarget.textContent = `投递失败：${error.message}`;
      statusTarget.className = "badge danger";
    }
  } finally {
    button.disabled = false;
  }
}

async function retryObservabilityAlert(deliveryId, button) {
  if (!OPERATIONS_API_BASE || !deliveryId) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  button.disabled = true;
  try {
    const response = await request(`${OPERATIONS_API_BASE}/observability/alert-deliveries/${encodeURIComponent(deliveryId)}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "operations console manual retry" })
    });
    const payload = await response.json().catch(() => ({}));
    await loadOperationsDashboard();
    const statusTarget = document.querySelector("#observability-alert-status");
    if (statusTarget) {
      statusTarget.textContent = payload.ok ? `重放成功：${payload.delivery?.adapterReceipt?.receiptId || deliveryId}` : `重放失败：${payload.delivery?.deadLetterReason || payload.message || response.status}`;
      statusTarget.className = `badge ${payload.ok ? "info" : "danger"}`;
    }
  } catch (error) {
    const statusTarget = document.querySelector("#observability-alert-status");
    if (statusTarget) {
      statusTarget.textContent = `重放失败：${error.message}`;
      statusTarget.className = "badge danger";
    }
  } finally {
    button.disabled = false;
  }
}

function productionOperationsBadge(status) {
  const text = String(status || "pending");
  if (/validated-demo|recorded-demo|acknowledged-demo|resolved-demo|policy-defined/i.test(text)) return "info";
  if (/P1|critical|escalated/i.test(text)) return "danger";
  return "warn";
}

function renderProductionOperationsCenter(center) {
  const metricsTarget = document.querySelector("#production-operations-metrics");
  const serviceTarget = document.querySelector("#production-service-levels");
  const dutyTarget = document.querySelector("#production-duty-shifts");
  const incidentTarget = document.querySelector("#production-incidents");
  const drillTarget = document.querySelector("#production-recovery-drills");
  const evidenceTarget = document.querySelector("#production-operations-evidence");
  if (!metricsTarget || !serviceTarget || !dutyTarget || !incidentTarget || !drillTarget || !evidenceTarget) return;
  const summary = center.summary || {};
  const serviceLevels = center.serviceLevels || [];
  const dutyShifts = center.dutyShifts || [];
  const incidents = center.incidents || [];
  const drills = center.drills || [];
  const evidencePackets = center.evidencePackets || [];
  const metrics = [
    ["服务级别", summary.serviceLevels || 0, "API、接口、数据与恢复"],
    ["值班班次", summary.dutyShifts || 0, `${summary.handoffsRecorded || 0} 次演示交接`],
    ["开放事件", summary.openIncidents || 0, `${summary.incidents || 0} 条事件`],
    ["恢复演练", summary.validatedDrills || 0, `${summary.drills || 0} 个场景`],
    ["运行证据", summary.evidencePackets || 0, "待现场复核"],
    ["生产就绪", 0, `${summary.onsiteBlockers || 0} 项现场阻断`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card"><span>${operationsEscapeHtml(label)}</span><strong>${operationsEscapeHtml(value)}</strong><small>${operationsEscapeHtml(hint)}</small></article>`).join("");
  serviceTarget.innerHTML = `<table>
    <thead><tr><th>服务</th><th>范围</th><th>目标</th><th>响应</th><th>责任方</th><th>生产</th></tr></thead>
    <tbody>${serviceLevels.map((item) => `<tr><td><strong>${operationsEscapeHtml(item.name)}</strong></td><td>${operationsEscapeHtml(item.scope)}</td><td>${operationsEscapeHtml(item.target)}</td><td>${operationsEscapeHtml(item.responseTarget)}</td><td>${operationsEscapeHtml(item.owner)}</td><td>否</td></tr>`).join("")}</tbody>
  </table>`;
  dutyTarget.innerHTML = dutyShifts.map((item, index) => `<article class="priority-row" data-production-duty-shift="${operationsEscapeHtml(item.id)}">
    <div class="priority-rank ${productionOperationsBadge(item.status)}">${index + 1}</div>
    <div><h3>${operationsEscapeHtml(item.name)}</h3><p>${operationsEscapeHtml(item.window)} · ${operationsEscapeHtml(item.primaryRole)} / ${operationsEscapeHtml(item.backupRole)}</p><small>${operationsEscapeHtml((item.handoffChecklist || []).join("；"))}</small><div class="action-row"><button class="inline-action" type="button" data-production-operations-action="record-handoff" data-resource="duty-shifts" data-id="${operationsEscapeHtml(item.id)}">记录演示交接</button><button class="inline-action" type="button" data-production-operations-action="request-onsite" data-resource="duty-shifts" data-id="${operationsEscapeHtml(item.id)}">申请现场签班</button></div></div>
    <div class="capability-side"><span class="badge ${productionOperationsBadge(item.handoffStatus)}">${operationsEscapeHtml(item.handoffStatus || "pending")}</span><small>生产：否</small></div>
  </article>`).join("");
  incidentTarget.innerHTML = incidents.map((item, index) => `<article class="priority-row" data-production-incident="${operationsEscapeHtml(item.id)}">
    <div class="priority-rank ${productionOperationsBadge(item.severity)}">${index + 1}</div>
    <div><h3>${operationsEscapeHtml(item.title)}</h3><p>${operationsEscapeHtml(item.source)} · ${operationsEscapeHtml(item.owner)}</p><small>响应 ${operationsEscapeHtml(item.acknowledgeWithinMinutes || "-")} 分钟 · 回滚责任 ${operationsEscapeHtml(item.rollbackDecisionOwner || "待确认")}</small><div class="action-row"><button class="inline-action" type="button" data-production-operations-action="acknowledge" data-resource="incidents" data-id="${operationsEscapeHtml(item.id)}">确认</button><button class="inline-action" type="button" data-production-operations-action="escalate" data-resource="incidents" data-id="${operationsEscapeHtml(item.id)}">升级</button><button class="inline-action" type="button" data-production-operations-action="resolve-demo" data-resource="incidents" data-id="${operationsEscapeHtml(item.id)}">演示关闭</button></div></div>
    <div class="capability-side"><span class="badge ${productionOperationsBadge(item.status)}">${operationsEscapeHtml(item.status)}</span><small>${operationsEscapeHtml(item.severity)}</small></div>
  </article>`).join("");
  drillTarget.innerHTML = drills.map((item, index) => `<article class="priority-row" data-production-drill="${operationsEscapeHtml(item.id)}">
    <div class="priority-rank ${productionOperationsBadge(item.status)}">${index + 1}</div>
    <div><h3>${operationsEscapeHtml(item.name)}</h3><p>${operationsEscapeHtml(item.scenario)} · 目标 RPO ${operationsEscapeHtml(item.targetRpoMinutes)} 分钟 / RTO ${operationsEscapeHtml(item.targetRtoMinutes)} 分钟</p><small>实测 RPO ${operationsEscapeHtml(item.measuredRpoMinutes ?? "-")} / RTO ${operationsEscapeHtml(item.measuredRtoMinutes ?? "-")} · ${operationsEscapeHtml((item.requiredEvidence || []).join("；"))}</small><div class="action-row"><button class="inline-action" type="button" data-production-operations-action="rehearse-demo" data-resource="drills" data-id="${operationsEscapeHtml(item.id)}">运行样例演练</button><button class="inline-action" type="button" data-production-operations-action="record-evidence" data-resource="drills" data-id="${operationsEscapeHtml(item.id)}">登记证据</button><button class="inline-action" type="button" data-production-operations-action="request-onsite" data-resource="drills" data-id="${operationsEscapeHtml(item.id)}">申请现场演练</button></div></div>
    <div class="capability-side"><span class="badge ${productionOperationsBadge(item.status)}">${operationsEscapeHtml(item.status)}</span><small>生产：否</small></div>
  </article>`).join("");
  evidenceTarget.innerHTML = `<table><thead><tr><th>资源</th><th>类型</th><th>引用</th><th>状态</th><th>生产证据</th></tr></thead><tbody>${evidencePackets.slice(0, 12).map((item) => `<tr><td>${operationsEscapeHtml(item.resource)}</td><td>${operationsEscapeHtml(item.type)}</td><td><strong>${operationsEscapeHtml(item.reference)}</strong><br><small>${operationsEscapeHtml(item.note || "")}</small></td><td>${operationsEscapeHtml(item.status)}</td><td>否</td></tr>`).join("")}</tbody></table>`;
  const statusTarget = document.querySelector("#production-operations-status");
  if (statusTarget) {
    statusTarget.textContent = "运行中心已就绪，现场运维受阻";
    statusTarget.className = "badge warn";
  }
  const boundaryTarget = document.querySelector("#production-operations-boundary");
  if (boundaryTarget) boundaryTarget.textContent = "本页记录策略、交接、事件和本地恢复样例，不代表生产灾备通过。正式运行仍需真实监控与呼叫、远端备份、全量恢复实测、签字值班表和多方灾备验收。";
}

function bindProductionOperationsActions() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-production-operations-action]");
    if (!button) return;
    runProductionOperationsAction(button.dataset.resource, button.dataset.productionOperationsAction, button.dataset.id, button);
  });
}

async function runProductionOperationsAction(resource, action, id, button) {
  if (!OPERATIONS_API_BASE || !resource || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const notes = {
    "record-handoff": "Commission operations recorded a demo handoff checklist; named roster and duty phone remain onsite requirements.",
    acknowledge: "Commission operations acknowledged the demo incident signal.",
    escalate: "Commission operations escalated the demo incident to the configured owner.",
    "resolve-demo": "Commission operations closed the demo incident after local verification.",
    "rehearse-demo": "Commission operations ran an isolated sample recovery rehearsal; full-volume production recovery remains required.",
    "record-evidence": "Commission operations registered a recovery evidence reference for onsite validation.",
    "request-onsite": "Commission operations requested signed onsite duty or recovery verification."
  };
  if (button) button.disabled = true;
  try {
    const response = await request(`${OPERATIONS_API_BASE}/production-operations/${encodeURIComponent(resource)}/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[action] || "Production operations action recorded.", evidenceRef: action === "record-evidence" ? `operations-console/${id}/${Date.now()}` : "" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    operationsDashboard.runCenter = payload.center;
    renderProductionOperationsCenter(payload.center);
  } catch (error) {
    const statusTarget = document.querySelector("#production-operations-status");
    if (statusTarget) {
      statusTarget.textContent = error.message || "操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

function operationsEscapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
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
