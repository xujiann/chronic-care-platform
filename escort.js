const ESCORT_API_BASE = location.protocol === "file:" ? "" : "/api";
let escortDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindEscortOrderForm();
  await loadEscortDashboard();
});

async function loadEscortDashboard() {
  escortDashboard = await fetchEscortDashboard();
  renderEscortDashboard(escortDashboard);
}

async function fetchEscortDashboard() {
  if (ESCORT_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${ESCORT_API_BASE}/escort-services/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/db.json");
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
          <td>${escapeHtml(item.worker?.name || item.workerId || "pending")}<br><small>${escapeHtml((item.serviceItems || []).join(", "))}</small></td>
          <td>${escapeHtml(item.hospital || "")}<br><small>${escapeHtml(item.department || "")} / ${escapeHtml(item.appointmentAt || item.due || "")}</small><br><small>${statusBadge(item.hospitalInterfaceStatus || "pending")} ${escapeHtml(item.hospitalCheckInNo || item.hospitalNotice || "")}</small></td>
          <td>${statusBadge(item.subsidyType)} ${statusBadge(item.contractStatus)} ${statusBadge(item.insuranceStatus)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.priority)}<br><small>${escapeHtml(item.qualityReview || "")}</small></td>
          <td>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="in-service">开始</button>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="quality-review">回访</button>
            <button class="inline-action" type="button" data-escort-action="${escapeHtml(item.id)}" data-status="closed">关闭</button>
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-escort-action]").forEach((button) => {
    button.addEventListener("click", () => updateEscortOrder(button.dataset.escortAction, button.dataset.status));
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
          <td>${statusBadge(item.status)}<br><small>${escapeHtml(item.insuranceStatus || "")}</small></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
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
        headers: { "Content-Type": "application/json" },
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status,
      qualityReview: status === "closed" ? "closed" : "follow-up-call-required",
      action: `set-${status}`,
      note: `Escort order moved to ${status}.`
    })
  });
  await loadEscortDashboard();
}

function statusBadge(status) {
  const text = String(status ?? "unknown");
  const danger = ["high", "blocked", "training-gap", "overdue", "returned", "hospital-returned"].includes(text);
  const warn = ["medium", "pending", "contract-pending", "requested", "quality-review", "follow-up-call-required", "training"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  return `<span class="badge ${type}">${escapeHtml(text)}</span>`;
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
