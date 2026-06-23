const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [], medicationPickups: [], chronicScreeningTasks: [], chronicManagementPlans: [], chronicFollowupStatusPolicy: {}, deathCertificates: [], deathCertificateForms: [], deathStatistics: {}, birthCertificates: [], birthCertificateForms: [], birthStatistics: {}, doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {} };
const institutionApiBase = location.protocol === "file:" || location.hostname.endsWith("github.io") ? "" : "/api";
let platformState = fallbackState;

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackState);
  bindInstitutionActions();
  renderAll(platformState);
});

function renderAll(state) {
  renderChronicFollowupWorkbench(state);
  populateBirthCertificateForm(state);
  populateMultiPracticeForm(state);
  renderMetrics(state);
  renderDoctorAccounts(state);
  renderMultiPracticePolicy(state);
  renderMultiPracticeApplications(state);
  renderCareOrders(state);
  renderAuthorizedRecords(state);
  renderClaimLinks(state);
  renderReferralCenter(state);
  renderReservedResources(state);
  renderIntegratedProfiles(state);
  renderStandardArchiveProfiles(state);
  renderInstitutionAudit(state);
  renderPickups(state);
  renderDeathCertificates(state);
  renderBirthCertificates(state);
}

function bindInstitutionActions() {
  document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-workflow-action]");
      if (!button) return;
    if (button.dataset.chronicDispatch) {
      button.disabled = true;
      const result = await dispatchChronicFollowup(button.dataset.collection, button.dataset.id, JSON.parse(button.dataset.updates || "{}"), button.dataset.note || "chronic follow-up disposition");
      button.disabled = false;
      if (result.ok) renderAll(platformState);
      return;
    }
    const updates = JSON.parse(button.dataset.updates || "{}");
    button.disabled = true;
    const result = await updateWorkflowAction(platformState, button.dataset.collection, button.dataset.id, updates, button.dataset.note || "机构端更新业务状态");
    button.disabled = false;
    if (result.ok) renderAll(platformState);
  });
  document.querySelector("#birth-certificate-form")?.addEventListener("submit", submitBirthCertificate);
  document.querySelector("#birth-status-filter")?.addEventListener("change", () => renderBirthCertificates(platformState));
  document.querySelector("#birth-risk-filter")?.addEventListener("change", () => renderBirthCertificates(platformState));
  document.querySelector("#multi-practice-form")?.addEventListener("submit", submitMultiPracticeApplication);
}

function actionButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function chronicDispatchButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-chronic-dispatch="true" data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function chronicClosed(state, status) {
  const closed = state.chronicFollowupStatusPolicy?.statusGroups?.closed || [];
  return closed.some((item) => String(status || "").includes(item) || String(item || "").includes(String(status || "")));
}

function renderChronicFollowupWorkbench(state) {
  const summaryEl = document.querySelector("#chronic-followup-summary");
  const metricsEl = document.querySelector("#chronic-followup-metrics");
  const listEl = document.querySelector("#chronic-followup-workbench");
  if (!summaryEl || !metricsEl || !listEl) return;
  const feedback = (state.personalRecords || []).filter((item) => item.category === "chronic-feedback" || item.meta?.followupFeedback);
  const openFollowups = (state.followups || []).filter((item) => !chronicClosed(state, item.status));
  const openPlans = (state.chronicManagementPlans || []).filter((item) => !chronicClosed(state, item.status));
  const openScreenings = (state.chronicScreeningTasks || []).filter((item) => !chronicClosed(state, item.status));
  const pendingMedication = (state.medicationPickups || []).filter((item) => !chronicClosed(state, item.status || item.pharmacyStatus));
  summaryEl.textContent = `${openFollowups.length + openPlans.length + openScreenings.length} 项待处置`;
  metricsEl.innerHTML = [
    ["筛查分级", openScreenings.length, "高风险发现与分级评估"],
    ["管理计划", openPlans.length, "复核、升级预警、下次随访"],
    ["院后随访", openFollowups.length, "逾期、待随访、复诊提醒"],
    ["用药依从", pendingMedication.length, "固定取药与长处方闭环"],
    ["居民反馈", feedback.length, "居民端主动回填"]
  ].map(([label, value, hint]) => `<article class="claim-card"><strong>${label}</strong><span>${value}<br>${hint}</span></article>`).join("");

  const rows = [
    ...openScreenings.map((item) => ({ ...item, collection: "chronicScreeningTasks", title: item.taskName, due: item.due, primary: "完成评估", updates: { status: "已评估", result: "已生成风险分级和干预建议" } })),
    ...openPlans.map((item) => ({ ...item, collection: "chronicManagementPlans", title: `${item.diseaseType}管理计划`, due: item.nextReview, primary: "复核完成", updates: { status: "已复核", intervention: "已完成阶段复核并更新管理方案" } })),
    ...openFollowups.map((item) => ({ ...item, collection: "followups", title: `${item.diseaseType}随访`, due: item.plannedAt, primary: "完成随访", updates: { status: "已完成", result: "已完成院后随访并同步居民反馈" } })),
    ...pendingMedication.map((item) => ({ ...item, collection: "medicationPickups", title: item.medication, due: item.nextPickup, primary: "确认依从", updates: { status: "已完成", pharmacyStatus: "已取药" } }))
  ].slice(0, 12);
  listEl.innerHTML = rows.map((item) => {
    const resident = residentOf(state, item.residentId);
    const latestFeedback = feedback.find((record) => record.residentId === item.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.title || item.id}</h3>
        <p>${item.collection} · ${item.status || "待处理"} · ${item.due || "待排期"} · ${item.assignee || item.owner || item.pharmacy || "责任人待定"}</p>
        <p>${item.nextStep || item.intervention || item.advice || item.result || "按慢病随访计划处置"}</p>
        <p>居民反馈：${latestFeedback ? `${latestFeedback.result} · ${latestFeedback.meta?.nextRequest || ""}` : "暂无新增反馈"}</p>
        <div class="action-row">
          ${chronicDispatchButton(item.collection, item.id, item.primary, item.updates, `慢病随访处置：${item.primary}`)}
          ${item.collection === "chronicManagementPlans" ? chronicDispatchButton(item.collection, item.id, "升级预警", { status: "预警中", intervention: "已升级家庭医生重点管理" }, "慢病管理计划升级预警") : ""}
        </div>
      </div>
      <span class="badge ${String(item.status || "").includes("逾期") || String(item.status || "").includes("预警") ? "danger" : "warn"}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无待处置慢病随访事项。</p>`;
}

async function dispatchChronicFollowup(collection, id, updates, note) {
  if (!institutionApiBase) {
    Object.assign((platformState[collection] || []).find((item) => item.id === id) || {}, updates, { lastUpdated: new Date().toISOString() });
    return { ok: true };
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${institutionApiBase}/chronic/followup-dispatch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, id, updates, status: updates.status, note })
    });
    if (!response.ok) throw new Error(`dispatch failed: ${response.status}`);
    const saved = await response.json();
    const rows = platformState[collection] || [];
    const index = rows.findIndex((item) => item.id === id);
    if (index >= 0) rows[index] = saved;
    return { ok: true, saved };
  } catch (error) {
    alert(error.message || "慢病随访处置失败，请检查登录状态和网络连接");
    return { ok: false };
  }
}

function residentOf(state, id) {
  return state.residents.find((item) => item.id === id);
}

function populateMultiPracticeForm(state) {
  const form = document.querySelector("#multi-practice-form");
  const select = form?.querySelector("select[name='doctorId']");
  if (!form || !select) return;
  const doctors = state.doctorProfiles || [];
  select.innerHTML = doctors.map((doctor) => `<option value="${doctor.id}">${doctor.name} · ${doctor.title} · ${doctor.primaryInstitution}</option>`).join("");
  const doctor = doctors[0];
  if (!doctor) return;
  const scopeInput = form.querySelector("input[name='practiceScope']");
  if (scopeInput && !scopeInput.value) scopeInput.value = doctor.practiceScope || "";
  const responsibility = form.querySelector("input[name='responsibility']");
  if (responsibility && !responsibility.value) responsibility.value = "由当事医疗机构和医师按协议依法承担医疗责任";
  const compensation = form.querySelector("input[name='compensation']");
  if (compensation && !compensation.value) compensation.value = "按实际工作时间、工作量和绩效协商结算";
  const insurance = form.querySelector("input[name='insurance']");
  if (insurance && !insurance.value) insurance.value = "已购买医师个人医疗执业保险";
}

async function submitMultiPracticeApplication(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = Object.fromEntries(new FormData(form));
  const payload = {
    ...formData,
    scheduleConflict: form.querySelector("input[name='scheduleConflict']")?.checked || false,
    publicVisible: form.querySelector("input[name='publicVisible']")?.checked !== false
  };
  const submit = form.querySelector("button[type='submit']");
  submit.disabled = true;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    if (!institutionApiBase) throw new Error("静态预览模式暂不支持提交多点执业申请，请使用本地服务或部署 API");
    const response = await request(`${institutionApiBase}/multi-practice-applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `多点执业申请提交失败：${response.status}`);
    }
    const saved = await response.json();
    platformState.multiPracticeApplications = [saved, ...(platformState.multiPracticeApplications || [])];
    form.reset();
    populateMultiPracticeForm(platformState);
    renderMultiPracticeApplications(platformState);
  } catch (error) {
    alert(error.message || "多点执业申请提交失败，请检查登录角色和网络连接");
  } finally {
    submit.disabled = false;
  }
}

function formatBirthDateTime(value) {
  if (!value) return new Date().toLocaleString("zh-CN", { hour12: false });
  return String(value).replace("T", " ");
}

function birthCertificateNo() {
  const year = new Date().getFullYear();
  const count = (platformState.birthCertificates || []).length + 1;
  return `B${year}${String(count).padStart(6, "0")}`;
}

function populateBirthCertificateForm(state) {
  const select = document.querySelector("#birth-certificate-form select[name='maternalResidentId']");
  if (!select) return;
  select.innerHTML = (state.residents || []).map((resident) => `<option value="${resident.id}">${resident.name} · ${resident.idCard || resident.phone || resident.organization}</option>`).join("");
  const dateInput = document.querySelector("#birth-certificate-form input[name='birthDateTime']");
  if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 16);
}

async function submitBirthCertificate(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = Object.fromEntries(new FormData(form));
  const mother = residentOf(platformState, formData.maternalResidentId);
  const weight = Number(formData.birthWeight || 0);
  const payload = {
    certificateNo: birthCertificateNo(),
    certificateVersion: "第七版",
    issueType: formData.issueType || "首次签发",
    maternalResidentId: formData.maternalResidentId,
    motherName: mother?.name || "待核验",
    fatherName: formData.fatherName || "待核验",
    newbornName: formData.newbornName || "未命名新生儿",
    newbornGender: formData.newbornGender || "待确认",
    birthDateTime: formatBirthDateTime(formData.birthDateTime),
    birthWeight: weight,
    birthLength: Number(formData.birthLength || 0),
    birthPlace: "医疗卫生机构",
    issuingInstitution: mother?.organization || "本机构",
    issuingPhysician: formData.issuingPhysician || "签发医师待确认",
    materials: ["父母有效身份证件", "分娩信息核验", "首次签发登记表"],
    status: formData.status || "待签发",
    electronicLicenseStatus: formData.status === "已签发" ? "已生成" : "待生成",
    publicSecuritySync: "未共享",
    maternalChildSync: "待入册",
    healthManagementStatus: weight > 0 && weight < 2500 ? "低体重儿专案待建档" : "待建档",
    qualityCheck: "待质控",
    nextService: formData.nextService || (weight > 0 && weight < 2500 ? "低体重儿专案随访与喂养指导" : "新生儿访视、出生缺陷筛查和接种提醒")
  };
  form.querySelector("button[type='submit']").disabled = true;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    if (!institutionApiBase) throw new Error("静态预览模式暂不支持登记出生医学证明，请使用本地服务或部署 API");
    const response = await request(`${institutionApiBase}/birth-certificates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`出生证明登记失败：${response.status}`);
    await response.json();
    platformState = await loadPlatformState(fallbackState);
    form.reset();
    populateBirthCertificateForm(platformState);
    renderAll(platformState);
  } catch (error) {
    alert(error.message || "出生证明登记失败，请检查登录角色和网络连接");
  } finally {
    form.querySelector("button[type='submit']").disabled = false;
  }
}

function renderDoctorAccounts(state) {
  const doctors = state.doctorProfiles || [];
  const countEl = document.querySelector("#doctor-account-count");
  const listEl = document.querySelector("#doctor-accounts");
  if (!countEl || !listEl) return;
  countEl.textContent = `${doctors.length} 个账户`;
  listEl.innerHTML = doctors.map((doctor) => `<section class="item">
    <div>
      <h3>${doctor.name} · ${doctor.title} · ${doctor.specialty}</h3>
      <p>${doctor.primaryInstitution} · ${doctor.department} · ${doctor.practiceScope}</p>
      <p>执业证号：${doctor.licenseNo} · 注册有效期至 ${doctor.registrationValidUntil} · 考核 ${doctor.assessmentRecords?.slice(-2).join("、") || "待补齐"}</p>
      <p>关联功能：${(doctor.functions || []).join("、")}</p>
    </div>
    <span class="badge ${doctor.accountStatus === "启用" ? "info" : "warn"}">${doctor.accountStatus || "待启用"}</span>
  </section>`).join("") || `<p class="muted">暂无医生账户档案。</p>`;
}

function renderMultiPracticePolicy(state) {
  const policy = state.multiPracticePolicy || {};
  const el = document.querySelector("#multi-practice-policy");
  if (!el) return;
  const rules = [
    ["定义", policy.definition || "两个或两个以上医疗机构定期执业"],
    ["资格", (policy.qualificationRules || []).slice(0, 3).join("；")],
    ["协议字段", (policy.agreementFields || []).join("、")],
    ["管理", (policy.managementRules || []).slice(0, 3).join("；")]
  ];
  el.innerHTML = rules.map(([title, detail]) => `<div>
    <strong>${title}</strong>
    <span>${detail || "待配置"}</span>
  </div>`).join("");
}

function renderMultiPracticeApplications(state) {
  const applications = state.multiPracticeApplications || [];
  const countEl = document.querySelector("#multi-practice-count");
  const listEl = document.querySelector("#multi-practice-applications");
  if (!countEl || !listEl) return;
  countEl.textContent = `${applications.length} 条`;
  listEl.innerHTML = applications.map((item) => {
    const checks = item.compliance || {};
    const passed = Object.entries(checks).filter(([key, value]) => key !== "publicHospitalLeaderRestricted" && value).length;
    const blocked = checks.publicHospitalLeaderRestricted || Object.entries(checks).some(([key, value]) => key !== "publicHospitalLeaderRestricted" && !value);
    const badge = item.status?.includes("待") ? "warn" : item.status?.includes("退回") || blocked ? "danger" : "info";
    return `<section class="item multi-practice-item">
      <div>
        <h3>${item.doctorName} · ${item.primaryInstitution} → ${item.targetInstitution}</h3>
        <p>${item.targetDepartment || "科室待定"} · ${item.period || "期限待定"} · ${item.schedule || "时间待定"}</p>
        <p>任务：${item.tasks || "待补充"} · 范围：${item.practiceScope || "待核验"}</p>
        <p>协议：${item.responsibility || "责任待约定"} · ${item.compensation || "薪酬待约定"} · ${item.insurance || "保险待补充"}</p>
        <div class="standard-tags">
          <span class="badge ${checks.titleQualified ? "info" : "warn"}">职称${checks.titleQualified ? "符合" : "待核"}</span>
          <span class="badge ${checks.fiveYears ? "info" : "warn"}">年限${checks.fiveYears ? "符合" : "待核"}</span>
          <span class="badge ${checks.assessmentQualified ? "info" : "warn"}">考核${checks.assessmentQualified ? "合格" : "待核"}</span>
          <span class="badge ${checks.scopeMatched ? "info" : "warn"}">范围${checks.scopeMatched ? "一致" : "待核"}</span>
          <span class="badge ${checks.agreementCompleted ? "info" : "warn"}">协议${checks.agreementCompleted ? "完整" : "待补"}</span>
        </div>
        <p>第一执业地点：${item.primaryConsent || "待确认"} · ${item.registrationMode || "注册管理"} · 信息公开：${item.publicVisible ? "公开" : "不公开"} · 校验 ${passed}/6</p>
        <div class="action-row">
          ${item.primaryConsent !== "已同意" ? actionButton("multiPracticeApplications", item.id, "同意/报备", { primaryConsent: "已同意", status: "待卫健审核" }, "第一执业地点同意多点执业") : ""}
          ${item.status !== "已备案" ? actionButton("multiPracticeApplications", item.id, "备案通过", { status: "已备案", publicVisible: true }, "多点执业备案通过并公开") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无多点执业申请。</p>`;
}

function renderBirthCertificates(state) {
  const certificates = state.birthCertificates || [];
  const forms = state.birthCertificateForms || [];
  const statistics = state.birthStatistics || {};
  const metrics = statistics.metrics || {};
  const countEl = document.querySelector("#birth-certificate-count");
  const metricEl = document.querySelector("#birth-certificate-metrics");
  const listEl = document.querySelector("#birth-certificate-list");
  const formsEl = document.querySelector("#birth-certificate-forms");
  const alertsEl = document.querySelector("#birth-certificate-alerts");
  if (!countEl || !metricEl || !listEl || !formsEl) return;

  const statusFilter = document.querySelector("#birth-status-filter")?.value || "";
  const riskFilter = document.querySelector("#birth-risk-filter")?.value || "";
  const filtered = certificates.filter((item) => {
    const statusMatched = !statusFilter || item.status === statusFilter;
    const riskMatched = !riskFilter
      || (riskFilter === "low-weight" && Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500)
      || (riskFilter === "pending-sync" && (item.publicSecuritySync !== "已共享" || item.maternalChildSync !== "已入册"));
    return statusMatched && riskMatched;
  });
  const alerts = [
    ["待签发", certificates.filter((item) => item.status === "待签发").length, "签发医师、材料和证件编号需核验"],
    ["待入册共享", certificates.filter((item) => item.publicSecuritySync !== "已共享" || item.maternalChildSync !== "已入册").length, "公安户籍和妇幼健康管理未闭环"],
    ["低体重儿", certificates.filter((item) => Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500).length, "需纳入专案访视和喂养指导"],
    ["质控补正", certificates.filter((item) => ["待质控", "待复核", "待补正"].includes(item.qualityCheck)).length, "材料、编号、签章或共享状态需复核"]
  ];

  countEl.textContent = `${filtered.length}/${certificates.length} 张证明`;
  if (alertsEl) {
    alertsEl.innerHTML = alerts.map(([label, value, hint]) => `<article class="claim-card">
      <strong>${label}</strong>
      <span>${value}<br>${hint}</span>
    </article>`).join("");
  }
  metricEl.innerHTML = [
    ["首次签发", metrics.firstIssued || certificates.filter((item) => item.issueType === "首次签发").length, "机构内出生直接签发"],
    ["电子证照", metrics.electronicLicenses || certificates.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length, "第七版编号/条形码"],
    ["公安共享", metrics.publicSecuritySynced || certificates.filter((item) => String(item.publicSecuritySync || "").includes("已共享")).length, "户口出生登记依据"],
    ["待处理", metrics.pending || certificates.filter((item) => ["待签发", "待上报"].includes(item.status)).length, "补正、签发或上报"]
  ].map(([label, value, hint]) => `<article class="claim-card">
    <strong>${label}</strong>
    <span>${value}<br>${hint}</span>
  </article>`).join("");

  listEl.innerHTML = filtered.map((item) => {
    const resident = residentOf(state, item.maternalResidentId || item.residentId);
    const badge = item.status === "待签发" || item.status === "待上报" ? "warn" : item.qualityCheck === "待补正" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${item.newbornName || "未命名新生儿"} · ${item.certificateNo}</h3>
        <p>${item.certificateVersion || "第七版"} · ${item.issueType || "首次签发"} · ${item.birthDateTime} · ${item.newbornGender || "性别待确认"}</p>
        <p>母亲：${item.motherName || resident?.name || "待核验"} · 父亲：${item.fatherName || "待核验"} · 出生体重 ${item.birthWeight || "-"}g</p>
        <p>签发：${item.issuingInstitution || "待明确"} · ${item.issuingPhysician || "待签名"} · 材料 ${Array.isArray(item.materials) ? item.materials.join("、") : "待补齐"}</p>
        <p>共享：电子证照 ${item.electronicLicenseStatus || "待生成"} · 公安 ${item.publicSecuritySync || "未共享"} · 妇幼 ${item.maternalChildSync || "待入册"}</p>
        <p>健康管理：${item.healthManagementStatus || "待建档"} · ${item.nextService || "新生儿访视与接种提醒"}</p>
        <div class="action-row">
          ${item.status === "待签发" ? actionButton("birthCertificates", item.id, "签发", { status: "已签发", electronicLicenseStatus: "已生成", qualityCheck: "通过" }, "签发出生医学证明") : ""}
          ${item.status !== "已上报" && item.maternalChildSync !== "已入册" ? actionButton("birthCertificates", item.id, "上报入册", { status: "已上报", maternalChildSync: "已入册", publicSecuritySync: "已共享", healthManagementStatus: "已建档" }, "出生证明上报并纳入妇幼管理") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无出生医学证明记录。</p>`;

  formsEl.innerHTML = forms.map((form) => `<article class="claim-card">
    <strong>${form.name}</strong>
    <span>${form.scope}<br>${(form.keyFields || []).slice(0, 4).join("、")}<br>${form.status}</span>
  </article>`).join("") || `<p class="muted">暂无出生证明材料模板。</p>`;
}

function renderMetrics(state) {
  const highRisk = state.residents.filter((item) => assessRisk(item) === "高危").length;
  const pending = state.careOrders.filter((item) => item.status !== "已完成").length;
  const emr = state.personalRecords.filter((item) => item.category === "emr").length;
  const claims = state.insuranceClaims.length;
  document.querySelector("#institution-metrics").innerHTML = [
    ["协同患者", state.residents.length, "来自基层和居民授权"],
    ["高危患者", highRisk, "需专科关注"],
    ["待处理任务", pending, "转诊/复诊/随访"],
    ["医保结算", claims, "与医保中心经办贯通"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderCareOrders(state) {
  document.querySelector("#order-count").textContent = `${state.careOrders.length} 项`;
  document.querySelector("#care-orders").innerHTML = state.careOrders.map((order) => {
    const resident = residentOf(state, order.residentId);
    const risk = resident ? assessRisk(resident) : "未知";
    const badge = order.priority === "高" ? "danger" : order.status === "已接诊" ? "" : "warn";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${order.type}</h3>
        <p>${order.institution} · ${order.department} · ${order.date}</p>
        <p>${order.summary}</p>
        <div class="action-row">
          ${order.status === "待接诊" ? actionButton("careOrders", order.id, "接诊", { status: "已接诊", institutionReview: "已接诊" }, "医疗机构接诊协同任务") : ""}
          ${order.status !== "已完成" ? actionButton("careOrders", order.id, "完成", { status: "已完成", result: "已完成诊疗协同" }, "医疗机构完成协同任务") : ""}
        </div>
      </div>
      <div>
        <span class="badge ${badge}">${order.status}</span>
        <span class="badge info">${risk}</span>
      </div>
    </section>`;
  }).join("");
}

function renderAuthorizedRecords(state) {
  const authorized = state.personalRecords.filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked");
  document.querySelector("#authorized-records").innerHTML = authorized.map((record) => {
    const resident = residentOf(state, record.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${record.name}</h3>
        <p>${record.result}</p>
        <p>${record.date} · ${record.source}</p>
      </div>
    </section>`;
  }).join("") || `<p class="muted">暂无有效授权。</p>`;
}

function renderClaimLinks(state) {
  document.querySelector("#claim-links").innerHTML = state.insuranceClaims.map((claim) => {
    const resident = residentOf(state, claim.residentId);
    return `<article class="claim-card">
      <strong>${resident?.name || "未知居民"} · ${claim.claimType}</strong>
      <span>${claim.institution}<br>${money(claim.totalAmount)} · ${claim.status}</span>
    </article>`;
  }).join("");
}

function renderReferralCenter(state) {
  const referrals = state.referralSystem?.referrals || [];
  document.querySelector("#referral-center-count").textContent = `${referrals.length} 条`;
  document.querySelector("#referral-center").innerHTML = referrals.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.priority === "高" ? "danger" : item.status.includes("待") ? "warn" : "info";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.type} · ${item.diseaseType}</h3>
        <p>${item.from} → ${item.to} · ${item.date}</p>
        <p>${item.reason}</p>
        <p>资源安排：${item.reservedResource} · 医保衔接：${item.insurancePolicy}</p>
        <div class="action-row">
          ${item.status === "待接诊" ? actionButton("referrals", item.id, "接诊", { status: "已接诊" }, "医疗机构接诊转诊") : ""}
          ${item.type === "下转" && item.status !== "基层承接" ? actionButton("referrals", item.id, "基层承接", { status: "基层承接" }, "基层承接下转患者") : ""}
          ${item.status !== "已完成" ? actionButton("referrals", item.id, "结案", { status: "已完成" }, "转诊闭环结案") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无转诊中心任务。</p>`;
}

function renderReservedResources(state) {
  const resources = state.referralSystem?.reservedResources || [];
  document.querySelector("#reserved-resources").innerHTML = resources.map((item) => `<article class="claim-card">
    <strong>${item.institution} · ${item.department}</strong>
    <span>号源 ${item.outpatientSlots} · 床位 ${item.beds}<br>${item.forPrimaryReferral} · ${item.status}</span>
  </article>`).join("") || `<p class="muted">暂无预留号源床位配置。</p>`;
}

function renderIntegratedProfiles(state) {
  const authorizedResidentIds = [...new Set(state.personalRecords
    .filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked")
    .map((item) => item.residentId))];
  document.querySelector("#integrated-profile-count").textContent = `${authorizedResidentIds.length} 人`;
  document.querySelector("#integrated-profiles").innerHTML = authorizedResidentIds.map((residentId) => {
    const resident = residentOf(state, residentId);
    const diseases = state.diseases.filter((item) => item.residentId === residentId).map((item) => item.type).join("、") || "暂无慢病";
    const emrs = state.personalRecords.filter((item) => item.residentId === residentId && item.category === "emr").sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const labs = state.personalRecords.filter((item) => item.residentId === residentId && item.category === "labs").length;
    const latest = emrs[0];
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${diseases}</h3>
        <p>${resident ? `血压 ${resident.metrics.systolic}/${resident.metrics.diastolic} · 血糖 ${resident.metrics.glucose} · BMI ${resident.metrics.bmi}` : "健康指标待补充"}</p>
        <p>最新病历：${latest ? `${latest.date} · ${latest.name} · ${latest.source}` : "暂无电子病历"} · 检查检验 ${labs} 条</p>
      </div>
      <span class="badge info">${resident?.personIndex || "待索引"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无可贯通的授权档案。</p>`;
}

function renderStandardArchiveProfiles(state) {
  const authorizedResidentIds = getAuthorizedResidentIds(state);
  document.querySelector("#standard-profile-count").textContent = `${authorizedResidentIds.length} 人`;
  document.querySelector("#standard-profiles").innerHTML = authorizedResidentIds.map((residentId) => {
    const coverage = getStandardCoverage(state, residentId);
    const resident = coverage.resident;
    const ready = coverage.datasets.filter((item) => item.status === "已归集").slice(0, 5);
    const missing = coverage.datasets.filter((item) => item.status === "待补齐").slice(0, 4);
    return `<section class="item standard-item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${coverage.lifeStage || "生命阶段待识别"} · ${coverage.risk || "风险待评估"}</h3>
        <p>健康问题：${coverage.problems.join("、")} · 适用数据集归集度 ${coverage.score}% (${coverage.applicableCompleted}/${coverage.applicableTotal})</p>
        <div class="model-grid standard-dimensions">
          ${coverage.activities.map((activity) => `<div><strong>${activity.title}</strong><span>${activity.detail}</span></div>`).join("")}
        </div>
        <div class="standard-tags">
          ${ready.map((item) => `<span class="badge">${item.code} ${item.name}</span>`).join("")}
          ${missing.map((item) => `<span class="badge warn">待补齐 ${item.code}</span>`).join("")}
        </div>
        <p>医生查看重点：基础身份和主索引、慢病管理、门诊病历、检查检验、用药处方、固定取药与授权审计。</p>
      </div>
      <div class="score-badge">
        <strong>${coverage.score}%</strong>
        <span>标准档案</span>
      </div>
    </section>`;
  }).join("") || `<p class="muted">暂无可按标准查看的授权健康档案。</p>`;
}

function getAuthorizedResidentIds(state) {
  return [...new Set(state.personalRecords
    .filter((item) => item.category === "authorizations" && item.meta?.status !== "revoked")
    .map((item) => item.residentId))];
}

function getStandardCoverage(state, residentId) {
  if (window.HealthArchiveStandard) {
    return window.HealthArchiveStandard.getResidentCoverage(state, residentId);
  }
  return { datasets: [], activities: [], problems: [], score: 0, applicableCompleted: 0, applicableTotal: 0 };
}

function renderInstitutionAudit(state) {
  const logs = state.dataAccessLogs || [];
  const institutionLogs = logs.filter((item) => ["医疗机构", "家庭医生"].includes(item.role));
  document.querySelector("#audit-link-count").textContent = `${institutionLogs.length} 条`;
  document.querySelector("#institution-audit").innerHTML = institutionLogs.map((log) => {
    const resident = residentOf(state, log.residentId);
    const badge = log.result === "拒绝" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${log.scope}</h3>
        <p>${log.actor} · ${log.role} · ${log.at}</p>
        <p>${log.purpose} · ${log.personIndex || "未生成统一索引"}</p>
      </div>
      <span class="badge ${badge}">${log.result}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无机构端访问审计记录。</p>`;
}

function renderPickups(state) {
  const pickups = state.medicationPickups || [];
  document.querySelector("#pickup-count").textContent = `${pickups.length} 项`;
  document.querySelector("#pickup-list").innerHTML = pickups.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.status === "待取药" ? "warn" : item.status === "已预约" ? "info" : "";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.medication}</h3>
        <p>${item.pharmacy} · 每月 ${item.pickupDay} 日 · 下次 ${item.nextPickup}</p>
        <p>${item.dosage} · ${item.coverage}</p>
        <p>机构确认：${item.institutionReview || "待确认"} · 医保审核：${item.insuranceReview || "待审核"} · ${item.deliveryMode || "社区药房自取"}</p>
        <div class="action-row">
          ${item.institutionReview !== "已确认" ? actionButton("medicationPickups", item.id, "确认处方", { institutionReview: "已确认", status: "待医保审核" }, "医疗机构确认固定取药处方") : ""}
          ${item.status !== "已完成" && item.insuranceReview === "已通过" ? actionButton("medicationPickups", item.id, "完成取药", { status: "已完成", pharmacyStatus: "已取药" }, "药房完成固定取药") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无固定取药计划。</p>`;
}

function renderDeathCertificates(state) {
  const certificates = state.deathCertificates || [];
  const forms = state.deathCertificateForms || [];
  const statistics = state.deathStatistics || {};
  const metrics = statistics.metrics || {};
  const countEl = document.querySelector("#death-certificate-count");
  const metricEl = document.querySelector("#death-certificate-metrics");
  const listEl = document.querySelector("#death-certificate-list");
  const formsEl = document.querySelector("#death-certificate-forms");
  if (!countEl || !metricEl || !listEl || !formsEl) return;

  countEl.textContent = `${certificates.length} 张证明`;
  metricEl.innerHTML = [
    ["已签发", metrics.signed || certificates.filter((item) => item.status === "已签发").length, "1 日内签发"],
    ["已上报", metrics.reported || certificates.filter((item) => String(item.cdcReportStatus || "").includes("已上报")).length, "人口死亡信息登记"],
    ["电子证照", metrics.electronicLicenses || certificates.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length, "省级平台/国家平台"],
    ["待处理", metrics.pending || certificates.filter((item) => ["待签发", "待上报"].includes(item.status)).length, "补正、签发或上报"]
  ].map(([label, value, hint]) => `<article class="claim-card">
    <strong>${label}</strong>
    <span>${value}<br>${hint}</span>
  </article>`).join("");

  listEl.innerHTML = certificates.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.status === "待签发" || item.status === "待上报" ? "warn" : item.qualityCheck === "待补正" ? "danger" : "info";
    return `<section class="item">
      <div>
        <h3>${item.deceasedName || resident?.name || "未知居民"} · ${item.certificateNo}</h3>
        <p>${item.deathDateTime} · ${item.deathPlace} · ${item.deathType} · ${item.deathReasonType}</p>
        <p>死因：${item.immediateCause || "待填"} / 根本死因 ${item.underlyingCause || "待编码"} · ICD ${item.icd10 || "待编码"}</p>
        <p>签发：${item.issuingInstitution || "待明确"} · ${item.issuingPhysician || "待签名"} · 材料 ${Array.isArray(item.materials) ? item.materials.join("、") : "待补齐"}</p>
        <p>上报：${item.reportChannel || "人口死亡信息登记系统"} · ${item.cdcReportStatus || "未上报"} · 国家平台 ${item.nationalPlatformStatus || "待提交"}</p>
        <p>共享：公安 ${item.publicSecuritySync || "未共享"} · 民政 ${item.civilAffairsSync || "未共享"} · 质控 ${item.qualityCheck || "待复核"}</p>
        <div class="action-row">
          ${item.status === "待签发" ? actionButton("deathCertificates", item.id, "签发", { status: "已签发", qualityCheck: "通过", electronicLicenseStatus: "已生成" }, "签发死亡医学证明") : ""}
          ${item.status !== "已上报" && item.cdcReportStatus !== "已上报" ? actionButton("deathCertificates", item.id, "上报共享", { status: "已上报", cdcReportStatus: "已上报", nationalPlatformStatus: "已同步", publicSecuritySync: "已共享", civilAffairsSync: "已共享" }, "死亡证明上报并共享") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status || "待处理"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无居民死亡医学证明记录。</p>`;

  formsEl.innerHTML = forms.map((form) => `<article class="claim-card">
    <strong>${form.name}</strong>
    <span>${form.scope}<br>${(form.keyFields || []).slice(0, 4).join("、")}<br>${form.status}</span>
  </article>`).join("") || `<p class="muted">暂无死亡证明材料模板。</p>`;
}
