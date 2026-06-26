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
  if (citizenSummary) citizenSummary.textContent = `${dashboard.summary?.publishedInstitutions || 0} 家已发布机构`;
  const nurseSummary = document.querySelector("#nursing-nurse-summary");
  if (nurseSummary) nurseSummary.textContent = `${dashboard.summary?.qualifiedNurses || 0}/${dashboard.summary?.nurses || 0} 名护士合格`;
}

function renderNursingMetrics(summary) {
  const metrics = [
    ["试点机构", summary.institutions || 0, `${summary.publishedInstitutions || 0} 家已发布`],
    ["合格护士", summary.qualifiedNurses || 0, `共 ${summary.nurses || 0} 名`],
    ["服务订单", summary.orders || 0, `${summary.openOrders || 0} 单待处理`],
    ["首诊评估", summary.pendingAssessment || 0, "待评估"],
    ["知情同意", summary.consentPending || 0, "待签署"],
    ["服务轨迹", summary.trackingActive || 0, "进行中轨迹"]
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
    .map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(displayText(item.name))} / ${escapeHtml(displayText(item.district || ""))}</option>`)
    .join("");
}

function renderNurseSelect(nurses) {
  const select = document.querySelector("#nursing-nurse-select");
  if (!select) return;
  const sessionNurseId = currentNursingUser().nurseId;
  select.innerHTML = nurses.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(displayText(item.name))} / ${escapeHtml(displayText(item.title || ""))}</option>`).join("");
  if (sessionNurseId && nurses.some((item) => item.id === sessionNurseId)) select.value = sessionNurseId;
  select.disabled = Boolean(sessionNurseId);
}

function renderHospitalOrders(items) {
  const target = document.querySelector("#nursing-orders");
  const user = currentNursingUser();
  const canManage = ["commission", "institution"].includes(user.role) && user.accountType !== "nurse";
  target.innerHTML = `
    <table>
      <thead><tr><th>订单</th><th>居民</th><th>服务</th><th>机构</th><th>护士</th><th>证据</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(item.preferredAt || "")}</small></td>
          <td>${escapeHtml(displayText(item.residentName || item.residentId || ""))}<br><small>${escapeHtml(displayText(item.serviceObject || ""))}</small></td>
          <td>${escapeHtml(displayText(item.serviceItem || ""))}<br><small>${escapeHtml(displayText(item.address || ""))}</small></td>
          <td>${escapeHtml(displayText(item.institution?.name || item.institutionName || ""))}<br><small>${escapeHtml(item.institutionCode || "")}</small></td>
          <td>${escapeHtml(displayText(item.nurse?.name || item.nurseName || "pending"))}<br><small>${escapeHtml(displayText(item.nurse?.registrationStatus || ""))}</small></td>
          <td>${statusBadge(item.firstVisitAssessment)} ${statusBadge(item.informedConsent)} ${statusBadge(item.locationTrace)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}<br><small>${escapeHtml(displayText(item.qualityCallback || ""))}</small></td>
          <td>
            ${canManage ? `
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="assessment">评估</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="dispatch">派单</button>
            <button class="inline-action" type="button" data-nursing-action="${escapeHtml(item.id)}" data-action-kind="review">回访</button>
            ` : `<span class="badge info">仅查看</span>`}
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
      <thead><tr><th>订单</th><th>上门时间</th><th>居民</th><th>证据</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${queue.map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.id)}</strong><br><small>${escapeHtml(displayText(item.serviceItem || ""))}</small></td>
          <td>${escapeHtml(item.preferredAt || "")}<br><small>${escapeHtml(displayText(item.address || ""))}</small></td>
          <td>${escapeHtml(displayText(item.residentName || item.residentId || ""))}<br><small>${escapeHtml(displayText(item.serviceObject || ""))}</small></td>
          <td>${statusBadge(item.locationTrace)} ${statusBadge(item.serviceRecordStatus)} ${statusBadge(item.qualityCallback)}</td>
          <td>${statusBadge(item.status)} ${statusBadge(item.riskLevel)}</td>
          <td>
            ${canAct ? `
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="accept">接单</button>
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="start">开始服务</button>
            <button class="inline-action" type="button" data-nurse-action="${escapeHtml(item.id)}" data-action-kind="complete">完成记录</button>
            ` : `<span class="badge info">需医院派单</span>`}
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
    ["服务对象", (policy.serviceObjects || []).map(displayText).join("、")],
    ["服务目录", (policy.serviceCatalog || []).map(displayText).join("、")],
    ["证据要求", (policy.requiredEvidence || []).map(displayText).join("、")],
    ["风险控制", (policy.riskControls || []).map(displayText).join("、")],
    ["平台要求", (policy.platformRequirements || []).map(displayText).join("、")]
  ];
  document.querySelector("#nursing-policy").innerHTML = rows.map(([label, value]) => `
    <div>
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(value)}</span>
    </div>
  `).join("");
  const summary = document.querySelector("#nursing-policy-summary");
  if (summary) summary.textContent = displayText(policy.source || "pilot policy");
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
  if (kind === "assessment") return { firstVisitAssessment: "passed", informedConsent: "signed", status: "assessed", action: "first-visit-assessment", note: "已完成首诊评估和知情同意。" };
  if (kind === "dispatch") return { nurseId, status: "dispatched", action: "dispatch-qualified-nurse", note: "医院已派出合格护士。" };
  return { qualityCallback: "closed", status: "closed", action: "quality-review", note: "质量回访已关闭。" };
}

function nurseActionPayload(kind) {
  const nurseId = document.querySelector("#nursing-nurse-select")?.value || "";
  if (kind === "accept") return { nurseId, status: "accepted", locationTrace: "tracking", action: "nurse-accept", note: "护士已接单，位置轨迹已开启。" };
  if (kind === "start") return { nurseId, status: "in-service", locationTrace: "tracking", serviceRecordStatus: "in-progress", action: "service-start", note: "上门护理服务已开始。" };
  return { nurseId, status: "completed", serviceRecordStatus: "completed", qualityCallback: "pending", action: "service-complete", note: "护理记录已完成，等待质量回访。" };
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
    source: "辽宁省互联网+护理服务试点实施方案",
    serviceObjects: ["elderly or disabled people", "rehabilitation patients", "terminal-stage patients", "maternal and infant people"],
    serviceCatalog: ["daily living ability assessment", "vital signs measurement", "blood glucose measurement", "wound care", "tube care", "postpartum care", "infant care", "PICC maintenance"],
    requiredEvidence: ["identity authentication", "first diagnosis assessment", "signed informed consent", "nurse practice certificate", "service location trace", "nursing record", "quality callback"],
    riskControls: ["emergency plan", "one-click alert", "liability insurance", "medical accident insurance", "service recorder"],
    platformRequirements: ["grade-3 security protection", "privacy protection", "medical record storage", "traceable service behavior", "workload statistics"]
  };
}

function defaultNursingInstitutions() {
  return [
    { id: "inh-mr1", institutionCode: "MR1", name: "大连市中心医院", district: "中山区", published: true, serviceItems: ["wound care", "PICC maintenance", "blood glucose measurement"], dailyCapacity: 18 },
    { id: "inh-mr3", institutionCode: "MR3", name: "青泥洼桥社区卫生服务中心", district: "中山区", published: true, serviceItems: ["vital signs measurement", "tube care"], dailyCapacity: 10 }
  ];
}

function defaultNursingNurses() {
  return [
    { id: "inn-001", name: "孙护士", institutionId: "inh-mr1", institutionCode: "MR1", title: "主管护师", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" },
    { id: "inn-002", name: "赵护士", institutionId: "inh-mr3", institutionCode: "MR3", title: "专科护士", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", status: "available" }
  ];
}

function defaultNursingOrders() {
  return [
    { id: "ino-001", residentId: "r1", residentName: "演示居民A", institutionId: "inh-mr1", institutionCode: "MR1", institutionName: "大连市中心医院", nurseId: "inn-001", nurseName: "孙护士", serviceItem: "wound care", serviceObject: "mobility-limited chronic disease patient", preferredAt: new Date(Date.now() + 86400000).toISOString().slice(0, 10), address: "中山区示例地址", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "medium", status: "dispatched", locationTrace: "pending", serviceRecordStatus: "pending", qualityCallback: "pending" },
    { id: "ino-002", residentId: "r2", residentName: "演示居民B", institutionId: "inh-mr3", institutionCode: "MR3", institutionName: "青泥洼桥社区卫生服务中心", nurseId: "inn-002", nurseName: "赵护士", serviceItem: "blood glucose measurement", serviceObject: "elderly or disabled people", preferredAt: new Date().toISOString().slice(0, 10), address: "青泥洼桥示例家庭地址", firstVisitAssessment: "passed", informedConsent: "signed", riskLevel: "low", status: "accepted", locationTrace: "tracking", serviceRecordStatus: "in-progress", qualityCallback: "pending" }
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
  return `<span class="badge ${type}">${escapeHtml(displayText(text))}</span>`;
}

function displayText(value) {
  const text = String(value ?? "");
  const labels = {
    "Liaoning Internet+ Nursing pilot implementation plan": "辽宁省互联网+护理服务试点实施方案",
    "pilot policy": "试点政策",
    "Dalian Central Hospital": "大连市中心医院",
    "Qingniwaqiao Community Health Service Center": "青泥洼桥社区卫生服务中心",
    "Ganjingzi District People's Hospital": "甘井子区人民医院",
    Zhongshan: "中山区",
    Ganjingzi: "甘井子区",
    "Nurse Sun": "孙护士",
    "Nurse Zhao": "赵护士",
    "Nurse Liu": "刘护士",
    "Demo resident A": "演示居民A",
    "Demo resident B": "演示居民B",
    "Demo resident C": "演示居民C",
    "Zhongshan district demo address": "中山区示例地址",
    "Qingniwaqiao demo home": "青泥洼桥示例家庭地址",
    "Shahekou demo address": "沙河口区示例地址",
    "daily living ability assessment": "日常生活能力评估",
    "vital signs measurement": "生命体征测量",
    "blood glucose measurement": "血糖测量",
    "wound care": "伤口护理",
    "tube care": "管路护理",
    "postpartum care": "产后护理",
    "infant care": "婴幼儿护理",
    "PICC maintenance": "PICC 维护",
    "elderly or disabled people": "老年人或失能人群",
    "rehabilitation patient": "康复期患者",
    "rehabilitation patients": "康复期患者",
    "terminal-stage patients": "终末期患者",
    "maternal and infant people": "母婴人群",
    "mobility-limited chronic disease patient": "行动不便慢病患者",
    "mobility-limited chronic disease patients": "行动不便慢病患者",
    "identity authentication": "身份认证",
    "first diagnosis assessment": "首诊评估",
    "signed informed consent": "已签署知情同意",
    "nurse practice certificate": "护士执业证书",
    "service location trace": "服务位置轨迹",
    "nursing record": "护理记录",
    "quality callback": "质量回访",
    "grade-3 security protection": "等保三级防护",
    "privacy protection": "隐私保护",
    "medical record storage": "病历资料留存",
    "traceable service behavior": "服务行为可追溯",
    "workload statistics": "工作量统计",
    "emergency plan": "应急预案",
    "one-click alert": "一键报警",
    "liability insurance": "责任保险",
    "medical accident insurance": "医疗事故保险",
    "service recorder": "服务记录仪",
    "senior nurse": "主管护师",
    "nurse practitioner": "专科护士",
    "specialist nurse": "专科护士",
    verified: "已核验",
    none: "无",
    passed: "已通过",
    signed: "已签署",
    pending: "待处理",
    requested: "已申请",
    assessed: "已评估",
    dispatched: "已派单",
    accepted: "已接单",
    "in-service": "服务中",
    completed: "已完成",
    closed: "已关闭",
    tracking: "轨迹开启",
    "in-progress": "进行中",
    high: "高风险",
    medium: "中风险",
    low: "低风险",
    unknown: "未知"
  };
  return labels[text] || text;
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
