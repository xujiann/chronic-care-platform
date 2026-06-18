const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [], deathCertificates: [], deathCertificateForms: [], deathStatistics: {}, birthCertificates: [], birthCertificateForms: [], birthStatistics: {}, doctorProfiles: [], multiPracticeApplications: [], multiPracticePolicy: {} };
let platformState = fallbackState;

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackState);
  bindInstitutionActions();
  renderAll(platformState);
});

function renderAll(state) {
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
    const updates = JSON.parse(button.dataset.updates || "{}");
    button.disabled = true;
    const result = await updateWorkflowAction(platformState, button.dataset.collection, button.dataset.id, updates, button.dataset.note || "机构端更新业务状态");
    button.disabled = false;
    if (result.ok) renderAll(platformState);
  });
}

function actionButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function residentOf(state, id) {
  return state.residents.find((item) => item.id === id);
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
  if (!countEl || !metricEl || !listEl || !formsEl) return;

  countEl.textContent = `${certificates.length} 张证明`;
  metricEl.innerHTML = [
    ["首次签发", metrics.firstIssued || certificates.filter((item) => item.issueType === "首次签发").length, "机构内出生直接签发"],
    ["电子证照", metrics.electronicLicenses || certificates.filter((item) => String(item.electronicLicenseStatus || "").includes("已生成")).length, "第七版编号/条形码"],
    ["公安共享", metrics.publicSecuritySynced || certificates.filter((item) => String(item.publicSecuritySync || "").includes("已共享")).length, "户口出生登记依据"],
    ["待处理", metrics.pending || certificates.filter((item) => ["待签发", "待上报"].includes(item.status)).length, "补正、签发或上报"]
  ].map(([label, value, hint]) => `<article class="claim-card">
    <strong>${label}</strong>
    <span>${value}<br>${hint}</span>
  </article>`).join("");

  listEl.innerHTML = certificates.map((item) => {
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
    ["医保结算", claims, "与医保端贯通"]
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
