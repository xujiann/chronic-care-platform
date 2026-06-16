const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  renderMetrics(state);
  renderCareOrders(state);
  renderAuthorizedRecords(state);
  renderClaimLinks(state);
  renderReferralCenter(state);
  renderReservedResources(state);
  renderIntegratedProfiles(state);
  renderStandardArchiveProfiles(state);
  renderInstitutionAudit(state);
  renderPickups(state);
});

function residentOf(state, id) {
  return state.residents.find((item) => item.id === id);
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
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无固定取药计划。</p>`;
}
