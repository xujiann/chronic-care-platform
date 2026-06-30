const doctorApiBase = location.protocol === "file:" || location.hostname.endsWith("github.io") ? "" : "/api";
const doctorFallbackState = { doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {}, taskMessages: [] };
let doctorRuntime = { doctor: null, applications: [], messages: [], policy: {}, ledger: [] };

document.addEventListener("DOMContentLoaded", async () => {
  doctorRuntime = await loadDoctorRuntime();
  bindDoctorForm();
  renderDoctorWorkbench();
});

async function loadDoctorRuntime() {
  const session = window.HealthCityAuth?.getUser?.() || {};
  if (doctorApiBase) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const [meResponse, ledgerResponse] = await Promise.all([
        request(`${doctorApiBase}/doctors/me`),
        fetch(`${doctorApiBase}/public/multi-practice-ledger`)
      ]);
      if (meResponse.ok) {
        const me = await meResponse.json();
        const ledger = ledgerResponse.ok ? (await ledgerResponse.json()).publicLedger || [] : [];
        return {
          doctor: me.doctor,
          applications: me.multiPracticeApplications || [],
          messages: me.multiPracticeMessages || [],
          policy: me.policy || {},
          summary: me.multiPracticeSummary || {},
          ledger
        };
      }
    } catch (error) {
      // Static preview falls back to the bundled snapshot below.
    }
  }

  const state = await loadPlatformState(doctorFallbackState);
  const doctor = (state.doctorProfiles || []).find((item) => item.id === session.doctorId || item.username === session.username) || (state.doctorProfiles || [])[0] || {};
  const applications = (state.multiPracticeApplications || []).filter((item) => item.doctorId === doctor.id);
  const messages = (state.taskMessages || []).filter((item) => item.collection === "multiPracticeApplications" && applications.some((application) => application.id === item.sourceId));
  return {
    doctor: { ...doctor, electronicRegistrationVerification: doctor.electronicRegistration || {} },
    applications,
    messages,
    policy: state.multiPracticePolicy || {},
    summary: { total: applications.length, pending: applications.filter((item) => String(item.status || "").includes("待")).length },
    ledger: (state.multiPracticeApplications || []).filter((item) => item.publicVisible !== false)
  };
}

function bindDoctorForm() {
  const form = document.querySelector("#doctor-multi-practice-form");
  if (!form) return;
  const scopeInput = form.elements.practiceScope;
  if (scopeInput && !scopeInput.value) scopeInput.value = doctorRuntime.doctor?.practiceScope || "";
  form.addEventListener("submit", submitDoctorMultiPractice);
}

async function submitDoctorMultiPractice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.querySelector("#doctor-submit-status");
  const submit = form.querySelector("button[type='submit']");
  const payload = {
    ...Object.fromEntries(new FormData(form)),
    doctorId: doctorRuntime.doctor?.id,
    publicVisible: form.elements.publicVisible?.checked !== false
  };
  submit.disabled = true;
  if (status) status.textContent = "提交中";
  try {
    if (!doctorApiBase) throw new Error("静态预览模式下不提交申请");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${doctorApiBase}/multi-practice-applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `提交失败：${response.status}`);
    }
    doctorRuntime = await loadDoctorRuntime();
    form.reset();
    bindDoctorForm();
    renderDoctorWorkbench();
    if (status) status.textContent = "已提交到医院端待办";
  } catch (error) {
    if (status) status.textContent = error.message || "提交失败";
  } finally {
    submit.disabled = false;
  }
}

function renderDoctorWorkbench() {
  renderDoctorMetrics();
  renderDoctorProfile();
  renderDoctorPolicy();
  renderDoctorApplications();
  renderDoctorPublicLedger();
}

function renderDoctorMetrics() {
  const target = document.querySelector("#doctor-metrics");
  if (!target) return;
  const applications = doctorRuntime.applications || [];
  const messages = doctorRuntime.messages || [];
  const registry = doctorRuntime.doctor?.electronicRegistrationVerification || doctorRuntime.doctor?.electronicRegistration || {};
  const pending = applications.filter((item) => /待|补正|pending/i.test(String(item.status || ""))).length;
  const publicRows = applications.filter((item) => item.publicVisible !== false).length;
  target.innerHTML = [
    ["本人申请", applications.length, "多点执业申请和备案记录"],
    ["待处理", pending, "医院端或医生端仍需处理"],
    ["医院消息", messages.length, "医院端确认、退回和备案通知"],
    ["电子注册", registry.verificationStatus || "待核验", registry.registryId || "医生电子化注册系统"]
  ].map(([label, value, hint]) => `<article class="metric-card"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(hint)}</small></article>`).join("");
  const status = document.querySelector("#doctor-profile-status");
  if (status) status.textContent = `${publicRows} 条公开备案相关记录`;
}

function renderDoctorProfile() {
  const doctor = doctorRuntime.doctor || {};
  const registry = doctor.electronicRegistrationVerification || doctor.electronicRegistration || {};
  const target = document.querySelector("#doctor-profile");
  if (!target) return;
  target.innerHTML = `<section class="item">
    <div>
      <h3>${escapeHtml(doctor.name || "医生账户")} · ${escapeHtml(doctor.title || "职称待同步")} · ${escapeHtml(doctor.specialty || "专业待同步")}</h3>
      <p>${escapeHtml(doctor.primaryInstitution || "第一执业地点待同步")} · ${escapeHtml(doctor.department || "科室待同步")}</p>
      <p>执业证号：${escapeHtml(doctor.licenseNo || "待同步")} · 执业范围：${escapeHtml(doctor.practiceScope || "待同步")} · 有效期至 ${escapeHtml(doctor.registrationValidUntil || registry.validUntil || "待同步")}</p>
      <p>电子化注册：${escapeHtml(registry.registryId || "待同步")} · ${escapeHtml(registry.verificationStatus || "待核验")} · 签章 ${escapeHtml(registry.signatureNo || "待签章")}</p>
    </div>
    <span class="badge ${registry.verificationStatus === "已核验" || registry.verificationStatus === "verified" ? "info" : "warn"}">${escapeHtml(doctor.accountStatus || "启用")}</span>
  </section>`;
}

function renderDoctorPolicy() {
  const policy = doctorRuntime.policy || {};
  const target = document.querySelector("#doctor-policy");
  if (!target) return;
  const rows = [
    ["资格", (policy.qualificationRules || []).slice(0, 2).join("；") || "执业范围、任职年限、考核和电子注册需一致"],
    ["材料", (policy.agreementFields || []).join("、") || "协议、薪酬、责任、保险、第一执业地点意见"],
    ["公开", "公开台账只展示姓名、执业类别、执业范围、第一执业地点、拟执业机构和监管状态"],
    ["风险", "排班冲突、责任保险缺失、第一执业地点未确认时进入补正队列"]
  ];
  target.innerHTML = rows.map(([label, detail]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(detail)}</span></div>`).join("");
}

function renderDoctorApplications() {
  const target = document.querySelector("#doctor-applications");
  const count = document.querySelector("#doctor-application-count");
  if (!target || !count) return;
  const applications = doctorRuntime.applications || [];
  const messages = doctorRuntime.messages || [];
  count.textContent = `${applications.length} 条`;
  target.innerHTML = applications.map((item) => {
    const relatedMessages = messages.filter((message) => message.sourceId === item.id).slice(0, 3);
    const riskFlags = Array.isArray(item.riskFlags) ? item.riskFlags : [];
    const externalSync = item.externalSync || {};
    const confirmation = item.primaryPracticeConfirmation || {};
    return `<section class="item">
      <div>
        <h3>${escapeHtml(item.targetInstitution || "拟执业机构待定")} · ${escapeHtml(item.targetDepartment || "科室待定")}</h3>
        <p>${escapeHtml(item.period || "期限待定")} · ${escapeHtml(item.schedule || "时间待定")} · ${escapeHtml(item.practiceScope || "范围待定")}</p>
        <p>第一执业地点：${escapeHtml(confirmation.status || item.primaryConsent || "待确认")} · 签章 ${escapeHtml(confirmation.signatureNo || "待签章")} · 公开 ${item.publicVisible === false ? "否" : "是"}</p>
        <p>外部同步：电子注册 ${escapeHtml(externalSync.electronicRegistration?.status || "待同步")} · 电子签章 ${escapeHtml(externalSync.eSignature?.status || "待签")} · HIS/HR ${escapeHtml(externalSync.hisHr?.status || "待映射")}</p>
        ${riskFlags.length ? `<p class="muted">补正提示：${riskFlags.map(escapeHtml).join("、")}</p>` : ""}
        ${relatedMessages.length ? `<div class="list compact">${relatedMessages.map((message) => `<p><strong>${escapeHtml(message.title || "医院消息")}</strong>：${escapeHtml(message.body || "待处理")}</p>`).join("")}</div>` : ""}
      </div>
      <span class="badge ${doctorStatusClass(item.status)}">${escapeHtml(item.status || "待处理")}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无本人多点执业申请。</p>`;
}

function renderDoctorPublicLedger() {
  const target = document.querySelector("#doctor-public-ledger");
  const count = document.querySelector("#doctor-ledger-count");
  if (!target || !count) return;
  const doctorName = doctorRuntime.doctor?.name || "";
  const rows = (doctorRuntime.ledger || []).filter((item) => !doctorName || item.doctorName === doctorName || item.doctorId === doctorRuntime.doctor?.id);
  count.textContent = `${rows.length} 条`;
  target.innerHTML = `<table>
    <thead><tr><th>医生</th><th>第一执业地点</th><th>拟执业机构</th><th>范围</th><th>状态</th></tr></thead>
    <tbody>${rows.map((item) => `<tr>
      <td>${escapeHtml(item.doctorName || doctorName)}</td>
      <td>${escapeHtml(item.primaryInstitution || "")}</td>
      <td>${escapeHtml(item.targetInstitution || "")}</td>
      <td>${escapeHtml(item.practiceScope || "")}</td>
      <td>${escapeHtml(item.status || "")}</td>
    </tr>`).join("") || `<tr><td colspan="5">暂无公开备案记录</td></tr>`}</tbody>
  </table>`;
}

function doctorStatusClass(status) {
  const text = String(status || "");
  if (/退回|暂停|冲突|补正/.test(text)) return "danger";
  if (/待|审核|处理中/.test(text)) return "warn";
  return "info";
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
