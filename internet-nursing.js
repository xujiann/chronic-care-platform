const NURSING_API_BASE = location.protocol === "file:" ? "" : "/api";
let nursingDashboard = null;

document.addEventListener("DOMContentLoaded", async () => {
  bindNursingAppointmentForm();
  document.querySelector("#nursing-nurse-select")?.addEventListener("change", () => renderNurseQueue(nursingDashboard?.orders || []));
  await loadInternetNursingDashboard();
});

async function loadInternetNursingDashboard() {
  nursingDashboard = await fetchInternetNursingDashboard();
  renderInternetNursingDashboard(nursingDashboard);
}

async function fetchInternetNursingDashboard() {
  if (NURSING_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${NURSING_API_BASE}/internet-nursing/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/db.json");
  const state = response.ok ? await response.json() : {};
  return buildStaticInternetNursingDashboard(state);
}

function buildStaticInternetNursingDashboard(state) {
  const institutions = state.internetNursingInstitutions?.length ? state.internetNursingInstitutions : defaultNursingInstitutions();
  const nurses = state.internetNursingNurses?.length ? state.internetNursingNurses : defaultNursingNurses();
  const orders = state.internetNursingOrders?.length ? state.internetNursingOrders : defaultNursingOrders();
  const institutionById = new Map(institutions.map((item) => [item.id, item]));
  const nurseById = new Map(nurses.map((item) => [item.id, item]));
  const policy = state.internetNursingPolicy || defaultNursingPolicy();
  return {
    ok: true,
    policy,
    summary: {
      institutions: institutions.length,
      publishedInstitutions: institutions.filter((item) => item.published).length,
      nurses: nurses.length,
      qualifiedNurses: nurses.filter(isQualifiedNurse).length,
      orders: orders.length,
      openOrders: orders.filter((item) => !["completed", "closed", "cancelled"].includes(item.status)).length,
      pendingAssessment: orders.filter((item) => item.firstVisitAssessment !== "passed").length,
      consentPending: orders.filter((item) => item.informedConsent !== "signed").length,
      highRisk: orders.filter((item) => item.riskLevel === "high").length,
      trackingActive: orders.filter((item) => item.locationTrace === "tracking").length
    },
    institutions,
    nurses,
    orders: orders.map((item) => ({ ...item, institution: institutionById.get(item.institutionId), nurse: nurseById.get(item.nurseId) })),
    nurseQueue: orders,
    riskQueue: orders.filter((item) => item.riskLevel === "high")
  };
}

function renderInternetNursingDashboard(dashboard) {
  renderNursingMetrics(dashboard.summary || {});
  renderInstitutionSelect(dashboard.institutions || []);
  renderNurseSelect(dashboard.nurses || []);
  renderHospitalOrders(dashboard.orders || []);
  renderNurseQueue(dashboard.orders || []);
  renderPolicyControls(dashboard.policy || {});
  const citizenSummary = document.querySelector("#nursing-citizen-summary");
  if (citizenSummary) citizenSummary.textContent = `${dashboard.summary?.publishedInstitutions || 0} published institutions`;
  const nurseSummary = document.querySelector("#nursing-nurse-summary");
  if (nurseSummary) nurseSummary.textContent = `${dashboard.summary?.qualifiedNurses || 0}/${dashboard.summary?.nurses || 0} qualified`;
}

function renderNursingMetrics(summary) {
  const metrics = [
    ["Pilot institutions", summary.institutions || 0, `${summary.publishedInstitutions || 0} published`],
    ["Qualified nurses", summary.qualifiedNurses || 0, `${summary.nurses || 0} total`],
    ["Orders", summary.orders || 0, `${summary.openOrders || 0} open`],
    ["Assessment", summary.pendingAssessment || 0, "pending first visit"],
    ["Consent", summary.consentPending || 0, "pending consent"],
    ["Tracking", summary.trackingActive || 0, "active service traces"]
  ];
  document.querySelector("#nursing-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(hint)}</small>
    </article>
  `).join("");
}

function renderInstitutionSelect(institutions) {
  const select = document.querySelector("#nursing-institution-select");
  if (!select) return;
  select.innerHTML = institutions
    .filter((item) => item.published !== false)
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} / ${escapeHtml(item.district || "")}</option>`)
    .join("");
}

function renderNurseSelect(nurses) {
  const select = document.querySelector("#nursing-nurse-select");
  if (!select) return;
  const sessionNurseId = currentNursingUser().nurseId;
  select.innerHTML = nurses.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} / ${escapeHtml(item.title || "")}</option>`).join("");
  if (sessionNurseId && nurses.some((item) => item.id === sessionNurseId)) select.value = sessionNurseId;
  select.disabled = Boolean(sessionNurseId);
}

function renderHospitalOrders(items) {
  const target = document.querySelector("#nursing-orders");
  const user = currentNursingUser();
  const canManage = ["commission", "institution"].includes(user.role) && user.accountType !== "nurse";
  target.innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Resident</th><th>Service</th><th>Institution</th><th>Nurse</th><th>Evidence</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.preferredAt || "")}</small></td>
          <td>${escapeHtml(item.residentName || item.residentId || "")}<br><small>${escapeHtml(item.serviceObject || "")}</small></td>
          <td>${escapeHtml(item.serviceItem || "")}<br><small>${escapeHtml(item.address || "")}</small></td>
          <td>${escapeHtml(item.institution?.name || item.institutionName || "")}<br><small>${escapeHtml(item.institutionCode || "")}</small></td>
          <td>${escapeHtml(item.nurse?.name || item.nurseName || "pending")}<br><small>${escapeHtml(item.nurse?.registrationStatus || "")}</small></td>
          <td>${statusBadge(item.firstVisitAssessment)} ${statusBadge(item.informedConsent)} ${statusBadge(item.locationTrace)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}<br><small>${escapeHtml(item.qualityCallback || "")}</small></td>
          <td>
            ${canManage ? `
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="assessment">Assess</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="dispatch">Dispatch</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="review">Review</button>
            ` : `<span class="badge info">view only</span>`}
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  target.querySelectorAll("[data-nursing-action]").forEach((button) => {
    button.addEventListener("click", () => updateNursingOrder(button.dataset.nursingAction, hospitalActionPayload(button.dataset.actionKind)));
  });
}

function renderNurseQueue(items) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  const user = currentNursingUser();
  const canAct = user.accountType === "nurse" || ["commission", "institution"].includes(user.role);
  const queue = items.filter((item) => !nurseId || !item.nurseId || item.nurseId === nurseId || item.status === "dispatched");
  document.querySelector("#nursing-nurse-queue").innerHTML = `
    <table>
      <thead><tr><th>Order</th><th>Visit</th><th>Resident</th><th>Evidence</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${queue.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.serviceItem || "")}</small></td>
          <td>${escapeHtml(item.preferredAt || "")}<br><small>${escapeHtml(item.address || "")}</small></td>
          <td>${escapeHtml(item.residentName || item.residentId || "")}<br><small>${escapeHtml(item.serviceObject || "")}</small></td>
          <td>${statusBadge(item.locationTrace)} ${statusBadge(item.serviceRecordStatus)} ${statusBadge(item.qualityCallback)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}</td>
          <td>
            ${canAct ? `
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="accept">Accept</button>
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="start">Start</button>
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="complete">Complete</button>
            ` : `<span class="badge info">hospital dispatch required</span>`}
          </td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-nurse-action]").forEach((button) => {
    button.addEventListener("click", () => updateNursingOrder(button.dataset.nurseAction, nurseActionPayload(button.dataset.actionKind)));
  });
}

function renderPolicyControls(policy) {
  const rows = [
    ["Service objects", (policy.serviceObjects || []).join(", ")],
    ["Catalog", (policy.serviceCatalog || []).join(", ")],
    ["Evidence", (policy.requiredEvidence || []).join(", ")],
    ["Risk controls", (policy.riskControls || []).join(", ")],
    ["Platform", (policy.platformRequirements || []).join(", ")]
  ];
  document.querySelector("#nursing-policy").innerHTML = rows.map(([label, value]) => `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
  const summary = document.querySelector("#nursing-policy-summary");
  if (summary) summary.textContent = policy.source || "pilot policy";
}

function currentNursingUser() {
  return window.HealthCityAuth?.getUser?.() || {};
}

function bindNursingAppointmentForm() {
  const form = document.querySelector("#nursing-appointment-form");
  if (!form) return;
  const dateInput = form.querySelector("input[name='preferredAt']");
  if (dateInput && !dateInput.value) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.sourceChannel = "internet-nursing.html";
    if (NURSING_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${NURSING_API_BASE}/internet-nursing/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
      if (!response.ok) throw new Error(`internet nursing appointment failed: ${response.status}`);
    } else {
      nursingDashboard.orders.unshift({ ...values, id: `ino-local-${crypto.randomUUID()}`, status: "requested", firstVisitAssessment: "pending", informedConsent: "pending", locationTrace: "pending", serviceRecordStatus: "pending", qualityCallback: "pending" });
    }
    form.reset();
    if (dateInput) dateInput.value = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    await loadInternetNursingDashboard();
  });
}

function hospitalActionPayload(kind) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  if (kind === "assessment") return { firstVisitAssessment: "passed", informedConsent: "signed", status: "assessed", action: "first-visit-assessment", note: "First-visit assessment and informed consent completed." };
  if (kind === "dispatch") return { nurseId, status: "dispatched", action: "dispatch-qualified-nurse", note: "Hospital dispatched a qualified nurse." };
  return { qualityCallback: "closed", status: "closed", action: "quality-review", note: "Quality callback closed." };
}

function nurseActionPayload(kind) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  if (kind === "accept") return { nurseId, status: "accepted", locationTrace: "tracking", action: "nurse-accept", note: "Nurse accepted the order and location tracking started." };
  if (kind === "start") return { nurseId, status: "in-service", locationTrace: "tracking", serviceRecordStatus: "in-progress", action: "service-start", note: "Home nursing service started." };
  return { nurseId, status: "completed", serviceRecordStatus: "completed", qualityCallback: "pending", action: "service-complete", note: "Nursing record completed and callback pending." };
}

async function updateNursingOrder(id, payload) {
  if (NURSING_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    await request(`${NURSING_API_BASE}/internet-nursing/orders/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  } else {
    const item = nursingDashboard.orders.find((row) => row.id === id);
    if (item) Object.assign(item, payload);
  }
  await loadInternetNursingDashboard();
}

function defaultNursingPolicy() {
  return {
    source: "Liaoning Internet+ Nursing pilot implementation plan",
    serviceObjects: ["elderly or disabled people", "rehabilitation patients", "terminal-stage patients", "maternal and infant people"],
    serviceCatalog: ["daily living ability assessment", "vital signs measurement", "blood glucose measurement", "wound care", "tube care", "postpartum care", "infant care", "PICC maintenance"],
    requiredEvidence: ["identity authentication", "first diagnosis assessment", "signed informed consent", "nurse practice certificate", "service location trace", "nursing record", "quality callback"],
    riskControls: ["emergency plan", "one-click alert", "liability insurance", "medical accident insurance", "service recorder"],
    platformRequirements: ["grade-3 security protection", "privacy protection", "medical record storage", "traceable service behavior", "workload statistics"]
  };
}

function defaultNursingInstitutions() {
  return [
    { id: "inh-mr1", institutionCode: "MR1", name: "Dalian Central Hospital", district: "Zhongshan", published: true, serviceItems: ["wound care", "PICC maintenance", "blood glucose measurement"], dailyCapacity: 18 },
    { id: "inh-mr3", institutionCode: "MR3", name: "Qingniwaqiao Community Health Service Center", district: "Zhongshan", published: true, serviceItems: ["vital signs measurement", "tube care"], dailyCapacity: 10 }
  ];
}

function defaultNursingNurses() {
  return [
    { id: "inn-001", name: "Nurse Sun", institutionId: "inh-mr1", institutionCode: "MR1", title: "senior nurse", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" },
    { id: "inn-002", name: "Nurse Zhao", institutionId: "inh-mr3", institutionCode: "MR3", title: "nurse practitioner", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" }
  ];
}

function defaultNursingOrders() {
  return [
    { id: "ino-001", residentId: "r1", residentName: "Demo resident A", institutionId: "inh-mr1", institutionCode: "MR1", institutionName: "Dalian Central Hospital", nurseId: "inn-001", nurseName: "Nurse Sun", serviceItem: "wound care", serviceObject: "mobility-limited chronic disease patient", preferredAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10), address: "Zhongshan district demo address", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "medium", status: "dispatched", locationTrace: "pending", serviceRecordStatus: "pending", qualityCallback: "pending" },
    { id: "ino-002", residentId: "r2", residentName: "Demo resident B", institutionId: "inh-mr3", institutionCode: "MR3", institutionName: "Qingniwaqiao Community Health Service Center", nurseId: "inn-002", nurseName: "Nurse Zhao", serviceItem: "blood glucose measurement", serviceObject: "elderly or disabled people", preferredAt: new Date().toISOString().slice(0, 10), address: "Qingniwaqiao demo home", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "low", status: "accepted", locationTrace: "tracking", serviceRecordStatus: "in-progress", qualityCallback: "pending" }
  ];
}

function isQualifiedNurse(item) {
  return Number(item.yearsClinical || 0) >= 5 && item.registrationStatus === "verified" && item.badPracticeRecord === "none" && item.trainingStatus === "passed" && item.insuranceStatus === "covered";
}

function statusBadge(status) {
  const text = String(status ?? "unknown");
  const danger = ["high", "blocked", "overdue"].includes(text);
  const warn = ["medium", "pending", "requested", "assessed", "dispatched", "accepted", "in-service", "tracking"].includes(text);
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
