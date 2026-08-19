const ESCORT_API_BASE = location.protocol === "file:" ? "" : "/api";
let escortDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindEscortOrderForm();
  await loadEscortDashboard();
});

async function loadEscortDashboard() {
  escortDashboard = await fetchEscortDashboard();
  escortDashboard = withEscortDispatchControls(escortDashboard);
  renderEscortDashboard(escortDashboard);
}

async function fetchEscortDashboard() {
  if (ESCORT_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${ESCORT_API_BASE}/escort-services/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/public-demo.json");
  const state = response.ok ? await response.json() : {};
  return buildStaticEscortDashboard(state);
}

function buildStaticEscortDashboard(state) {
  const providers = Array.isArray(state.escortServiceProviders) ? state.escortServiceProviders : [];
  const workers = Array.isArray(state.escortWorkers) ? state.escortWorkers : [];
  const orders = Array.isArray(state.escortServiceOrders) ? state.escortServiceOrders : [];
  const providerById = new Map(providers.map((item) => [item.id, item]));
  const workerById = new Map(workers.map((item) => [item.id, item]));
  return {
    ok: true,
    policy: state.escortServicePolicy || {},
    boundaries: state.escortServicePolicy?.scope || [],
    integrationTargets: state.escortServicePolicy?.integrationTargets || [],
    summary: {
      providers: providers.length,
      publishedProviders: providers.filter((item) => item.published).length,
      trainedWorkers: providers.reduce((sum, item) => sum + Number(item.trainedWorkers || 0), 0),
      orders: orders.length,
      openOrders: orders.filter((item) => !["completed", "closed", "cancelled"].includes(item.status)).length,
      highRisk: orders.filter((item) => item.priority === "high" || item.riskLevel === "high").length,
      subsidyOrders: orders.filter((item) => item.subsidyType && item.subsidyType !== "self-pay").length,
      qualityReviewRequired: orders.filter((item) => item.qualityReview && !["closed", "passed"].includes(item.qualityReview)).length,
      hospitalConfirmed: orders.filter((item) => item.hospitalInterfaceStatus === "confirmed").length,
      hospitalReturned: orders.filter((item) => item.hospitalInterfaceStatus === "returned").length
    },
    providers,
    workers,
    orders: orders.map((item) => ({ ...item, provider: providerById.get(item.providerId), worker: workerById.get(item.workerId) })),
    riskQueue: orders.filter((item) => item.priority === "high" || item.riskLevel === "high"),
    qualityQueue: orders.filter((item) => item.qualityReview && !["closed", "passed"].includes(item.qualityReview))
  };
}

function withEscortDispatchControls(dashboard = {}) {
  const domain = window.NursingEscortDomain;
  if (!domain) return dashboard;
  const workers = Array.isArray(dashboard.workers) ? dashboard.workers : [];
  return {
    ...dashboard,
    orders: (Array.isArray(dashboard.orders) ? dashboard.orders : []).map((order) => ({
      ...order,
      dispatchControl: buildEscortDispatchControl(order, workers, domain),
      serviceEvidenceControl: buildEscortServiceEvidenceControl(order, domain),
      financialEvidenceControl: buildEscortFinancialEvidenceControl(order, domain),
      riskQualityControl: buildEscortRiskQualityControl(order, domain),
      schedulingControl: buildEscortSchedulingControl(order, domain),
      cancellationRefundControl: buildEscortCancellationRefundControl(order, domain),
      timelineNotificationControl: buildEscortTimelineNotificationControl(order, domain)
    }))
  };
}

function buildEscortDispatchControl(order, workers, domain) {
  const worker = order.worker || workers.find((item) => item.id === order.workerId);
  const current = domain.canonicalStatus(order.status, "escort");
  if (worker && !["requested", "eligibility-checked", "provider-matched", "risk-hold", "hospital-returned", "evidence-pending"].includes(current)) {
    const qualification = domain.validateEscortWorkerQualification(worker, order, { now: new Date() });
    return {
      eligible: qualification.ok,
      assigned: true,
      personId: worker.id,
      personName: worker.name,
      blockers: qualification.reasons.map((item) => `qualification:${item}`)
    };
  }
  const ranked = domain.rankDispatchCandidates("escort", order, workers, { now: new Date(), limit: 3 });
  return {
    eligible: ranked.candidates.length > 0,
    assigned: false,
    personId: ranked.candidates[0]?.personId || "",
    personName: ranked.candidates[0]?.personName || "",
    score: ranked.candidates[0]?.score || 0,
    remainingCapacity: ranked.candidates[0]?.capacity?.remaining ?? 0,
    serviceDate: ranked.candidates[0]?.capacity?.serviceDate || "",
    blockers: ranked.blockers
  };
}

function escortDispatchControlText(item) {
  const control = item.dispatchControl;
  if (!control) return "";
  if (control.assigned && control.eligible) return `assigned qualification passed: ${control.personName || control.personId}`;
  if (control.eligible) return `dispatch ready: ${control.personName || control.personId} / ${control.serviceDate || "service date"} remaining capacity ${control.remainingCapacity} / score ${Math.round(control.score * 10) / 10}`;
  return `dispatch blocked: ${(control.blockers || []).slice(0, 4).join(", ") || "no eligible worker"}`;
}

function buildEscortServiceEvidenceControl(order, domain) {
  const current = domain.canonicalStatus(order.status, "escort");
  const target = current === "in-service" ? "completed" : "in-service";
  const transition = domain.validateTransition("escort", current, target);
  const evidence = domain.validateServiceEvidence("escort", order, target);
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function escortServiceEvidenceText(item) {
  const control = item.serviceEvidenceControl;
  if (!control) return "";
  if (control.ok) return control.target === "completed" ? "completion evidence passed" : "service-start evidence passed";
  return `service blocked: ${control.blockers.slice(0, 5).join(", ")}`;
}

function buildEscortFinancialEvidenceControl(order, domain) {
  const current = domain.canonicalStatus(order.status, "escort");
  const target = current === "settlement-pending" ? "settled" : "settlement-pending";
  const transition = domain.validateTransition("escort", current, target);
  const evidence = domain.validateFinancialEvidence("escort", order, target);
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function escortFinancialEvidenceText(item) {
  const control = item.financialEvidenceControl;
  if (!control) return "";
  if (control.ok) return control.target === "settled" ? "settlement callback and reconciliation passed" : "pricing and financial dispatch passed";
  return `settlement blocked: ${control.blockers.slice(0, 5).join(", ")}`;
}

function buildEscortRiskQualityControl(order, domain) {
  const current = domain.canonicalStatus(order.status, "escort");
  const target = current === "complaint-open"
    ? "quality-review"
    : ["quality-review", "adverse-event", "closed"].includes(current) ? "closed" : "quality-review";
  const transition = current === "closed" ? { ok: true } : domain.validateTransition("escort", current, target);
  const evidence = domain.validateRiskQualityEvidence("escort", order, target, { currentStatus: current });
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function escortRiskQualityText(item) {
  const control = item.riskQualityControl;
  if (!control) return "";
  if (control.ok) return control.target === "closed" ? "risk and quality closure passed" : "quality review evidence passed";
  return `risk/quality blocked: ${control.blockers.slice(0, 5).join(", ")}`;
}

function escortRiskQualityActionAttributes(item, target) {
  const control = item.riskQualityControl;
  if (control?.ok && control.target === target) return "";
  return `disabled aria-disabled="true" title="${escapeHtml(escortRiskQualityText(item) || `transition to ${target} blocked`)}"`;
}

function buildEscortSchedulingControl(order, domain) {
  const current = domain.canonicalStatus(order.status, "escort");
  if (!order.resourceReservation && !["reschedule-requested", "no-show-review"].includes(current)) return null;
  let target = "reschedule-requested";
  if (current === "reschedule-requested") target = "requested";
  else if (current === "no-show-review") {
    target = order.noShowDecision?.outcome === "cancel"
      ? "cancel-requested"
      : order.noShowDecision?.outcome === "reschedule" ? "reschedule-requested" : "accepted";
  } else {
    const slotAt = Date.parse(order.resourceReservation?.slotAt || "");
    if (["accepted", "hospital-confirmed"].includes(current) && Number.isFinite(slotAt) && slotAt < Date.now()) target = "no-show-review";
  }
  const transition = domain.validateTransition("escort", current, target);
  const evidence = domain.validateSchedulingEvidence("escort", order, target, { currentStatus: current });
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function escortSchedulingText(item) {
  const control = item.schedulingControl;
  if (!control) return "";
  if (control.ok) return `reschedule/no-show evidence passed: ${control.target}`;
  return `reschedule/no-show blocked: ${control.blockers.slice(0, 5).join(", ")}`;
}

function buildEscortCancellationRefundControl(order, domain) {
  const current = domain.canonicalStatus(order.status, "escort");
  let target = "";
  if (current === "refund-pending") target = "refunded";
  else if (current === "cancel-requested") target = order.cancellationRequest?.refundRequested ? "refund-pending" : "cancelled";
  else if (["settlement-pending", "settled"].includes(current)) target = "refund-pending";
  else if (["requested", "eligibility-checked", "provider-matched", "worker-dispatched", "accepted", "hospital-returned", "evidence-pending", "hospital-confirmed", "risk-hold"].includes(current)) {
    target = "cancel-requested";
  }
  if (!target) return null;
  const transition = domain.validateTransition("escort", current, target);
  const evidence = domain.validateCancellationRefundEvidence("escort", order, target, { currentStatus: current });
  return {
    ok: transition.ok && evidence.ok,
    target,
    blockers: [
      ...(transition.ok ? [] : [`transition:${current}->${target}`]),
      ...evidence.reasons
    ]
  };
}

function escortCancellationRefundText(item) {
  const control = item.cancellationRefundControl;
  if (!control) return "";
  if (control.ok) return `cancellation/refund evidence passed: ${control.target}`;
  return `cancellation/refund blocked: ${control.blockers.slice(0, 5).join(", ")}`;
}

function buildEscortTimelineNotificationControl(order, domain) {
  const events = Array.isArray(order.timelineEvents) ? order.timelineEvents : [];
  const plans = Array.isArray(order.notificationPlans) ? order.notificationPlans : [];
  if (!events.length && !plans.length) return null;
  const timeline = domain.validateTimelineIntegrity("escort", order);
  const planReasons = plans.flatMap((plan) => domain.validateNotificationPlan("escort", order, plan).reasons);
  const receipts = Array.isArray(order.notificationReceipts) ? order.notificationReceipts : [];
  const completedStatuses = new Set(["sent", "delivered", "read"]);
  const pending = plans.flatMap((plan) => plan.messages || []).filter((message) => message.required
    && !receipts.some((receipt) => receipt.messageId === message.id && completedStatuses.has(receipt.status))).length;
  return {
    ok: timeline.ok && planReasons.length === 0,
    eventCount: events.length,
    pending,
    blockers: [...timeline.reasons, ...planReasons]
  };
}

function escortTimelineNotificationText(item) {
  const control = item.timelineNotificationControl;
  if (!control) return "";
  if (!control.ok) return `resident timeline blocked: ${control.blockers.slice(0, 5).join(", ")}`;
  return `resident timeline ${control.eventCount}, notification receipts pending ${control.pending}`;
}

function renderEscortDashboard(dashboard) {
  renderEscortMetrics(dashboard.summary || {});
  renderProviderSelect(dashboard.providers || []);
  renderEscortOrders(dashboard.orders || []);
  renderEscortProviders(dashboard.providers || []);
  renderEscortWorkers(dashboard.workers || []);
  renderEscortRisks(dashboard.riskQueue || []);
  renderEscortPolicy(dashboard);
  const boundary = document.querySelector("#escort-boundary");
  if (boundary) boundary.textContent = `${(dashboard.boundaries || []).join(" / ")} | ${(dashboard.integrationTargets || []).join(", ")}`;
}

function renderEscortMetrics(summary) {
  const metrics = [
    ["服务主体", summary.providers || 0, `${summary.publishedProviders || 0} published`],
    ["陪诊师", summary.trainedWorkers || 0, "trained worker capacity"],
    ["订单", summary.orders || 0, `${summary.openOrders || 0} open`],
    ["高风险", summary.highRisk || 0, "priority or risk high"],
    ["补贴保障", summary.subsidyOrders || 0, "subsidy / time-bank"],
    ["质量回访", summary.qualityReviewRequired || 0, "callback required"]
  ];
  document.querySelector("#escort-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join("");
}

function renderProviderSelect(providers) {
  const select = document.querySelector("#escort-provider-select");
  if (!select) return;
  select.innerHTML = providers.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
}

function renderEscortOrders(items) {
  document.querySelector("#escort-orders").innerHTML = `
    <table>
      <thead><tr><th>订单</th><th>居民</th><th>服务主体</th><th>陪诊师</th><th>就医安排</th><th>保障</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.sourceChannel || "")}</small></td>
          <td>${escapeHtml(item.residentId || "")}<br><small>${escapeHtml(item.familyContactStatus || "")}</small></td>
          <td>${escapeHtml(item.provider?.name || item.providerName || item.providerId || "")}<br><small>${escapeHtml(item.district || "")}</small></td>
          <td>${escapeHtml(item.worker?.name || item.workerId || "pending")}<br><small>${escapeHtml((item.serviceItems || []).join(", "))}</small><br><small>${escapeHtml(escortDispatchControlText(item))}</small></td>
          <td>${escapeHtml(item.hospital || "")}<br><small>${escapeHtml(item.department || "")} / ${escapeHtml(item.appointmentAt || item.due || "")}</small><br><small>${statusBadge(item.hospitalInterfaceStatus || "pending")} ${escapeHtml(item.hospitalCheckInNo || item.outpatientQueueNo || item.hospitalNotice || "")}</small><br><small>${escapeHtml(item.hisVisitId || item.appointmentSource || "")} ${escapeHtml(item.departmentCode || "")} ${escapeHtml(item.doctorCode || "")}</small></td>
          <td>${statusBadge(item.subsidyType)} ${statusBadge(item.contractStatus)} ${statusBadge(item.insuranceStatus)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.priority)}<br><small>${escapeHtml(item.qualityReview || "")}</small><br><small>${escapeHtml(escortServiceEvidenceText(item))}</small><br><small>${escapeHtml(escortFinancialEvidenceText(item))}</small><br><small>${escapeHtml(escortRiskQualityText(item))}</small><br><small>${escapeHtml(escortSchedulingText(item))}</small><br><small>${escapeHtml(escortCancellationRefundText(item))}</small><br><small>${escapeHtml(escortTimelineNotificationText(item))}</small></td>
          <td>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="in-service" ${item.serviceEvidenceControl?.ok ? "" : `disabled aria-disabled="true" title="${escapeHtml(escortServiceEvidenceText(item))}"`}>开始</button>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="quality-review" ${escortRiskQualityActionAttributes(item, "quality-review")}>回访</button>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="closed" ${escortRiskQualityActionAttributes(item, "closed")}>关闭</button>
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll('[data-escort-action][data-status="closed"]').forEach((button) => {
    const id = escapeHtml(button.dataset.escortAction || "");
    button.insertAdjacentHTML("beforebegin", `
      <button class="inline-action" type="button" data-escort-hospital="${id}" data-decision="confirm">医院确认</button>
      <button class="inline-action" type="button" data-escort-hospital="${id}" data-decision="return">退回</button>
    `);
  });
  document.querySelectorAll("[data-escort-action]").forEach((button) => {
    button.addEventListener("click", () => updateEscortOrder(button.dataset.escortAction, button.dataset.status));
  });
  document.querySelectorAll("[data-escort-hospital]").forEach((button) => {
    button.addEventListener("click", () => updateEscortHospitalHandoff(button.dataset.escortHospital, button.dataset.decision));
  });
}

function renderEscortProviders(items) {
  document.querySelector("#escort-providers").innerHTML = `
    <table>
      <thead><tr><th>主体</th><th>区</th><th>能力</th><th>收费</th><th>风险保障</th><th>发布</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.type || "")}</small></td>
          <td>${escapeHtml(item.district || "")}</td>
          <td>${escapeHtml(item.trainedWorkers || 0)} workers<br><small>${escapeHtml(item.serviceCapacity || "")}</small></td>
          <td>${escapeHtml(item.pricing?.halfDayFee || 0)} half day<br><small>subsidy ${escapeHtml(item.pricing?.subsidyAccepted)}</small></td>
          <td>${escapeHtml(item.insurance || "")}<br><small>${escapeHtml(item.emergencyPlan || "")}</small></td>
          <td>${statusBadge(item.status)}<br><small>score ${escapeHtml(item.qualityScore || "")}</small></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderEscortWorkers(items) {
  document.querySelector("#escort-workers").innerHTML = `
    <table>
      <thead><tr><th>陪诊师</th><th>服务主体</th><th>培训</th><th>技能</th><th>状态</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.district || "")}</small></td>
          <td>${escapeHtml(item.providerId || "")}</td>
          <td>${escapeHtml(item.trainingHours || 0)}h / ${statusBadge(item.examStatus)}</td>
          <td>${escapeHtml((item.skills || []).join(", "))}</td>
          <td>${statusBadge(item.status)} ${statusBadge(escortWorkerQualification(item).ok ? "qualified" : "blocked")}<br><small>${escapeHtml(escortWorkerQualificationText(item))}</small></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function escortWorkerQualification(item, order = {}) {
  const domain = window.NursingEscortDomain;
  if (!domain) {
    const ok = Number(item.trainingHours || 0) >= 32 && item.examStatus === "passed" && item.insuranceStatus === "covered" && !["training", "suspended", "disabled"].includes(item.status);
    return { ok, reasons: ok ? [] : ["qualification-incomplete"], missingSkills: [] };
  }
  return domain.validateEscortWorkerQualification(item, order, { now: new Date() });
}

function escortWorkerQualificationText(item) {
  const result = escortWorkerQualification(item);
  return result.ok ? `qualified / ${item.insuranceStatus || "insurance pending"}` : `blocked: ${result.reasons.join(", ")}`;
}

function renderEscortRisks(items) {
  document.querySelector("#escort-risks").innerHTML = items.map((item) => `
    <div>
      <strong>${escapeHtml(item.id)}</strong>
      <span>${statusBadge(item.priority)} ${statusBadge(item.riskLevel)} ${escapeHtml(item.status || "")}</span>
      <span>${escapeHtml(item.nextAction || item.qualityReview || "")}</span>
    </div>
  `).join("") || "<div><strong>No high-risk escort order</strong><span>All open escort orders are routine.</span></div>";
}

function renderEscortPolicy(dashboard) {
  const policy = dashboard.policy || {};
  const rows = [
    ["Provider entry", policy.providerEntryRule || ""],
    ["District target", `${policy.trainingTargetPerDistrict || 0} trained workers per pilot district`],
    ["Required evidence", (policy.requiredEvidence || []).join(", ")],
    ["Service items", (policy.serviceItems || []).join(", ")]
  ];
  document.querySelector("#escort-policy").innerHTML = rows.map(([label, value]) => `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
}

function bindEscortOrderForm() {
  const form = document.querySelector("#escort-order-form");
  if (!form) return;
  const dateInput = form.querySelector("input[name='appointmentAt']");
  if (dateInput && !dateInput.value) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.serviceItems = String(values.serviceItems || "").split(",").map((item) => item.trim()).filter(Boolean);
    values.due = values.appointmentAt;
    values.riskLevel = values.priority === "high" ? "high" : "medium";
    if (ESCORT_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      await request(`${ESCORT_API_BASE}/escort-services/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(values)
      });
    }
    await loadEscortDashboard();
  });
}

async function updateEscortOrder(id, status) {
  if (!ESCORT_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  await request(`${ESCORT_API_BASE}/escort-services/orders/${encodeURIComponent(id)}/actions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      status,
      qualityReview: status === "closed" ? "closed" : "follow-up-call-required",
      action: `set-${status}`,
      note: `Escort order moved to ${status}.`
    })
  });
  await loadEscortDashboard();
}

async function updateEscortHospitalHandoff(id, decision) {
  if (!ESCORT_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const confirmed = decision !== "return";
  await request(`${ESCORT_API_BASE}/escort-services/orders/${encodeURIComponent(id)}/hospital-handoff`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify({
      decision,
      hospitalCheckInStatus: confirmed ? "confirmed" : "pending",
      hospitalCheckInNo: confirmed ? `HIS-${id}` : "",
      hisVisitId: confirmed ? `HIS-VISIT-${id}` : "",
      appointmentSource: "escort-console",
      departmentCode: "OUTP",
      doctorCode: "",
      outpatientQueueNo: confirmed ? `Q-${id.slice(-4)}` : "",
      hospitalNotice: confirmed ? "Hospital outpatient desk confirmed the escort handoff." : "Hospital returned the handoff for supplementary appointment evidence.",
      note: confirmed ? "Confirmed from escort console." : "Returned from escort console."
    })
  });
  await loadEscortDashboard();
}

function statusBadge(status) {
  const text = String(status ?? "unknown");
  const danger = ["high", "blocked", "training-gap", "overdue", "returned", "hospital-returned"].includes(text);
  const warn = ["medium", "pending", "contract-pending", "requested", "quality-review", "follow-up-call-required", "training", "reschedule-requested", "no-show-review"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  const label = {
    "reschedule-requested": "改约待审核",
    "no-show-review": "爽约待复核"
  }[text] || text;
  return `<span class="badge ${type}">${escapeHtml(label)}</span>`;
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
