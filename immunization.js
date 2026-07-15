const state = {
  data: null,
  selectedCertificateId: "",
  healthProfile: "routine"
};

const API_BASE = location.protocol === "file:" ? "" : `${location.origin}/api`;

document.addEventListener("DOMContentLoaded", async () => {
  state.data = await loadPlatformState();
  bindControls();
  render();
});

async function loadPlatformState() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static preview falls through to data/db.json.
    }
  }
  const response = await fetch("./data/db.json");
  return response.json();
}

function bindControls() {
  document.querySelector("#certificate-select")?.addEventListener("change", (event) => {
    state.selectedCertificateId = event.target.value;
    render();
  });
  document.querySelector("#health-profile-select")?.addEventListener("change", (event) => {
    state.healthProfile = event.target.value || "routine";
    render();
  });
}

function render() {
  const data = state.data || {};
  const certificates = data.birthCertificates || [];
  const select = document.querySelector("#certificate-select");
  if (!state.selectedCertificateId && certificates.length) state.selectedCertificateId = certificates[0].id;
  if (select) {
    select.innerHTML = certificates.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.newbornName || "新生儿")} · ${escapeHtml(item.birthDateTime || "")}</option>`).join("");
    select.value = state.selectedCertificateId;
  }
  const profileSelect = document.querySelector("#health-profile-select");
  if (profileSelect) {
    profileSelect.innerHTML = window.ImmunizationSchedule2026.HEALTH_PROFILES.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join("");
    profileSelect.value = state.healthProfile;
  }
  const certificate = certificates.find((item) => item.id === state.selectedCertificateId) || certificates[0];
  if (!certificate) return;
  const child = window.ImmunizationSchedule2026.childFromCertificate(certificate);
  const plan = window.ImmunizationSchedule2026.buildPlan(child, {
    healthProfile: state.healthProfile,
    records: (data.personalRecords || []).filter((record) => record.meta?.birthCertificateId === certificate.id || record.residentId === child.id)
  });
  renderSummary(certificate, plan);
  renderTimeline(plan);
  renderTable(plan);
  renderRules(plan);
  renderLaunchBoard(plan);
}

function renderSummary(certificate, plan) {
  const target = document.querySelector("#immunization-summary");
  const child = plan.child || {};
  target.innerHTML = [
    ["儿童", child.name || "新生儿", `${certificate.certificateNo || "出生证明待归集"} · ${child.gender || "性别待确认"}`],
    ["程序剂次", plan.summary.total, "按 2026 版默认程序生成"],
    ["逾期未种", plan.summary.overdue, "需疾控/接种门诊核验补种"],
    ["30天内到期", plan.summary.dueSoon, "居民端提醒与门诊预约"],
    ["禁种/暂缓", plan.summary.prohibited + plan.summary.deferred, `禁种 ${plan.summary.prohibited} · 暂缓 ${plan.summary.deferred}`],
    ["需评估", plan.summary.needsEvaluation + plan.summary.specialProgram, `评估 ${plan.summary.needsEvaluation} · 特殊程序 ${plan.summary.specialProgram}`],
    ["下一剂次", plan.nextDose ? `${plan.nextDose.vaccine} ${plan.nextDose.doseNo}` : "已完成", plan.nextDose ? `${plan.nextDose.dueDate} · ${plan.nextDose.timing}` : "当前默认程序无待办"]
  ].map(([label, value, hint]) => `<article class="metric-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(hint)}</small>
  </article>`).join("");
}

function renderTimeline(plan) {
  const target = document.querySelector("#immunization-timeline");
  const groups = [
    ["出生-6月龄", plan.rows.filter((row) => row.ageMonths <= 6)],
    ["8-24月龄", plan.rows.filter((row) => row.ageMonths > 6 && row.ageMonths <= 24)],
    ["3-6周岁", plan.rows.filter((row) => row.ageMonths >= 36 && row.ageMonths <= 72)],
    ["13周岁", plan.rows.filter((row) => row.ageMonths >= 156)]
  ];
  target.innerHTML = groups.map(([title, rows]) => `<article class="immunization-stage">
    <strong>${title}</strong>
    <span>${rows.length} 剂次</span>
    <p>${rows.map((row) => `${row.vaccine}${row.doseNo}`).join("、") || "本儿童默认程序无该阶段剂次"}</p>
  </article>`).join("");
}

function renderTable(plan) {
  const target = document.querySelector("#immunization-table");
  target.innerHTML = `<table>
    <thead><tr><th>应种日期</th><th>疫苗</th><th>剂次</th><th>预防疾病</th><th>接种途径</th><th>剂量</th><th>状态</th><th>健康状态评估</th></tr></thead>
    <tbody>${plan.rows.map((row) => `<tr>
      <td>${escapeHtml(row.dueDate)}</td>
      <td>${escapeHtml(row.vaccine)} <small>${escapeHtml(row.code)} · ${escapeHtml(row.timing)}</small></td>
      <td>第 ${escapeHtml(row.doseNo)} 剂</td>
      <td>${escapeHtml(row.disease)}</td>
      <td>${escapeHtml(row.route)}</td>
      <td>${escapeHtml(row.amount)}</td>
      <td><span class="badge ${row.status === "逾期未种" ? "warn" : row.status === "已接种" ? "info" : ""}">${escapeHtml(row.status)}</span></td>
      <td><span class="badge ${safetyBadgeClass(row.safetyAction)}">${escapeHtml(row.safetyLabel || "按程序")}</span><small>${escapeHtml(row.safetyReason || "")}</small></td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderRules(plan) {
  const target = document.querySelector("#immunization-rules");
  const special = document.querySelector("#immunization-special-rules");
  const profile = window.ImmunizationSchedule2026.HEALTH_PROFILES.find((item) => item.id === plan.healthProfile);
  target.innerHTML = plan.principles.map((item) => `<div><strong>通用原则</strong><span>${escapeHtml(item)}</span></div>`).join("");
  special.innerHTML = [`<article class="capability-card">
    <strong>当前健康状态</strong>
    <span>${escapeHtml(profile?.name || "常规儿童")}：${escapeHtml(profile?.description || "按常规程序提醒")}</span>
  </article>`].concat(plan.specialHealthRules.map((item) => `<article class="capability-card">
    <strong>${escapeHtml(item.name)}</strong>
    <span>${escapeHtml(item.guidance)}</span>
  </article>`)).join("");
}

function renderLaunchBoard(plan) {
  const summaryTarget = document.querySelector("#immunization-launch-summary");
  const boardTarget = document.querySelector("#immunization-launch-board");
  if (!summaryTarget || !boardTarget) return;
  const requirements = plan.launchRequirements || window.ImmunizationSchedule2026.LAUNCH_REQUIREMENTS || [];
  const ready = requirements.filter((item) => item.status === "ready").length;
  const sitePending = requirements.filter((item) => item.status !== "ready").length;
  const p0 = requirements.filter((item) => item.severity === "P0").length;
  const evidence = requirements.reduce((total, item) => total + (item.evidence || []).length, 0);
  summaryTarget.innerHTML = [
    ["Launch state", sitePending ? "Site pending" : "Ready", sitePending ? "Formal production go-live waits for signed site evidence" : "All launch requirements are ready"],
    ["Ready requirements", `${ready}/${requirements.length}`, "Modeled requirements with current evidence"],
    ["P0 controls", p0, "Registry, safety, audit and signoff controls"],
    ["Evidence refs", evidence, "Readiness, release and onsite evidence links"]
  ].map(([label, value, hint]) => `<article class="metric-card">
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(hint)}</small>
  </article>`).join("");
  boardTarget.innerHTML = requirements.map((item) => `<article class="immunization-launch-item">
    <div>
      <span class="badge ${launchRequirementBadgeClass(item.status)}">${escapeHtml(item.status === "ready" ? "Ready" : "Site pending")}</span>
      <span class="badge ${item.severity === "P0" ? "warn" : "info"}">${escapeHtml(item.severity)}</span>
    </div>
    <strong>${escapeHtml(item.title)}</strong>
    <small>${escapeHtml(item.category)} · ${escapeHtml(item.owner)}</small>
    <p>${escapeHtml(item.nextAction)}</p>
    <span>${escapeHtml((item.evidence || []).join(" / "))}</span>
  </article>`).join("");
}

function launchRequirementBadgeClass(status) {
  return status === "ready" ? "info" : "warn";
}

function safetyBadgeClass(action) {
  if (action === "prohibit" || action === "defer") return "warn";
  if (action === "evaluate" || action === "special") return "info";
  return "";
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}
