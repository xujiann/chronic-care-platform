const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [] };
let platformState = fallbackState;

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackState);
  bindInsuranceActions();
  renderAll(platformState);
});

function renderAll(state) {
  renderInsuranceOrgScope();
  renderMetrics(state);
  renderClaims(state);
  renderSupervisions(state);
  renderReferralPayments(state);
  renderPickupAudits(state);
  renderCredentialChecks(state);
  renderInsuranceAudit(state);
}

function bindInsuranceActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-workflow-action]");
    if (!button) return;
    const updates = JSON.parse(button.dataset.updates || "{}");
    button.disabled = true;
    const result = await updateWorkflowAction(platformState, button.dataset.collection, button.dataset.id, updates, button.dataset.note || "医保经办/监管更新业务状态");
    button.disabled = false;
    if (result.ok) renderAll(platformState);
  });
}

function renderInsuranceOrgScope() {
  const user = window.HealthCityAuth?.getUser?.();
  const typeMap = {
    insurance_bureau: ["医保行政监管", "政策、待遇、基金监管、跨区县监督"],
    insurance_center: ["医保经办服务", "结算审核、凭证核验、固定取药审核、经办留痕"],
    district_insurance_bureau: ["区市县医保监管", "本区机构监管、慢病待遇协同、基层医保服务监督"]
  };
  const [label, scope] = typeMap[user?.orgType] || ["医保协同", user?.dataScope || "医保审核与基金监管"];
  document.querySelector("#insurance-org-type").textContent = label;
  document.querySelector("#insurance-org-scope").innerHTML = `
    <div><strong>${user?.orgName || "未登录机构"}</strong><span>${user?.roleName || "医保角色"} · ${user?.orgLevel || ""}</span></div>
    <div><strong>职责范围</strong><span>${scope}</span></div>
    <div><strong>数据范围</strong><span>${user?.dataScope || "按账号授权范围展示"}</span></div>
  `;
}

function actionButton(collection, id, label, updates, note) {
  return `<button class="inline-action" type="button" data-workflow-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}' data-note="${note || label}">${label}</button>`;
}

function residentOf(state, id) {
  return state.residents.find((item) => item.id === id);
}

function renderMetrics(state) {
  const total = state.insuranceClaims.reduce((sum, item) => sum + Number(item.totalAmount || 0), 0);
  const pay = state.insuranceClaims.reduce((sum, item) => sum + Number(item.insurancePay || 0), 0);
  const pending = state.insuranceClaims.filter((item) => item.status !== "已通过").length;
  const chronic = new Set(state.insuranceClaims.map((item) => item.diseaseType)).size;
  document.querySelector("#insurance-metrics").innerHTML = [
    ["审核单据", state.insuranceClaims.length, "慢病相关结算"],
    ["总费用", money(total), "本期申报金额"],
    ["医保支付", money(pay), "基金预计支出"],
    ["待审核", pending, `${chronic} 类慢病病种`]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderClaims(state) {
  document.querySelector("#claim-count").textContent = `${state.insuranceClaims.length} 条`;
  document.querySelector("#claim-list").innerHTML = state.insuranceClaims.map((claim) => {
    const resident = residentOf(state, claim.residentId);
    const risk = claim.status === "待审核" ? "warn" : claim.status === "智能初审" ? "info" : "";
    const records = state.personalRecords.filter((item) => item.residentId === claim.residentId && ["emr", "medications", "labs"].includes(item.category)).length;
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${claim.claimType}</h3>
        <p>${claim.institution} · ${claim.diseaseType} · ${claim.date}</p>
        <p>总费用 ${money(claim.totalAmount)}，医保支付 ${money(claim.insurancePay)}，自付 ${money(claim.selfPay)}</p>
        <p>关联健康资料 ${records} 条 · ${claim.risk}</p>
        <div class="action-row">
          ${claim.status !== "已通过" ? actionButton("insuranceClaims", claim.id, "审核通过", { status: "已通过", reviewResult: "合规通过" }, "医保结算审核通过") : ""}
          ${claim.status !== "退回补正" ? actionButton("insuranceClaims", claim.id, "退回补正", { status: "退回补正", reviewResult: "需补充病历或处方依据" }, "医保结算退回补正") : ""}
        </div>
      </div>
      <span class="badge ${risk}">${claim.status}</span>
    </section>`;
  }).join("");
}

function renderSupervisions(state) {
  const items = state.institutionSupervisions || [];
  document.querySelector("#supervision-count").textContent = `${items.length} 项`;
  document.querySelector("#supervision-list").innerHTML = items.map((item) => {
    const badge = item.level === "关注" ? "warn" : item.level === "提示" ? "info" : "";
    const resource = (state.medicalResources || []).find((row) => row.institution === item.institution);
    return `<section class="item">
      <div>
        <h3>${item.institution} · ${item.issue}</h3>
        <p>${resource ? `${resource.type} · ${resource.region} · 医生 ${resource.doctors} · 床位 ${resource.beds}` : "机构资源待补充"}</p>
        <p>${item.action} · ${item.status}</p>
      </div>
      <span class="badge ${badge}">${item.level}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无机构监管事项。</p>`;
}

function renderReferralPayments(state) {
  const rules = state.referralSystem?.insuranceGuidance || [];
  const referrals = state.referralSystem?.referrals || [];
  document.querySelector("#referral-payment-count").textContent = `${rules.length} 项`;
  document.querySelector("#referral-payment-list").innerHTML = rules.map((item) => {
    const related = referrals.filter((referral) => referral.insurancePolicy?.includes(item.item.slice(0, 4))).length;
    const badge = item.status.includes("待") ? "warn" : "info";
    return `<section class="item">
      <div>
        <h3>${item.item}</h3>
        <p>${item.policy}</p>
        <p>关联转诊 ${related} 条 · 用于结算审核、差异化支付和基金监管。</p>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无分级诊疗支付政策配置。</p>`;
}

function renderPickupAudits(state) {
  const pickups = state.medicationPickups || [];
  document.querySelector("#pickup-audit-count").textContent = `${pickups.length} 项`;
  document.querySelector("#pickup-audit-list").innerHTML = pickups.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.insuranceReview === "已通过" ? "info" : "warn";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.medication}</h3>
        <p>${item.coverage} · ${item.dosage} · ${item.nextPickup}</p>
        <p>机构确认：${item.institutionReview || "待确认"} · 药房状态：${item.pharmacyStatus || item.status}</p>
        <div class="action-row">
          ${item.insuranceReview !== "已通过" ? actionButton("medicationPickups", item.id, "医保通过", { insuranceReview: "已通过", status: "待取药" }, "医保通过固定取药审核") : ""}
          ${item.insuranceReview !== "退回补正" ? actionButton("medicationPickups", item.id, "退回补正", { insuranceReview: "退回补正", status: "待补正" }, "固定取药医保退回补正") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.insuranceReview || "待审核"}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无固定取药审核事项。</p>`;
}

function renderCredentialChecks(state) {
  const items = (state.digitalCredentials || []).filter((item) => item.type.includes("医保"));
  document.querySelector("#credential-check-count").textContent = `${items.length} 项`;
  document.querySelector("#credential-check-list").innerHTML = items.map((item) => {
    const resident = residentOf(state, item.residentId);
    const badge = item.status === "待核验" ? "warn" : "info";
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${item.type}</h3>
        <p>${item.provider} · ${item.lastVerified}</p>
        <p>${item.usage} · ${item.personIndex || "待索引"}</p>
        <div class="action-row">
          ${item.status === "待核验" ? actionButton("digitalCredentials", item.id, "核验通过", { status: "已核验", lastVerified: new Date().toISOString().slice(0, 10) }, "医保凭证核验通过") : ""}
        </div>
      </div>
      <span class="badge ${badge}">${item.status}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无医保电子凭证核验事项。</p>`;
}

function renderInsuranceAudit(state) {
  const logs = (state.dataAccessLogs || []).filter((item) => item.role === "医保监管");
  document.querySelector("#insurance-audit-count").textContent = `${logs.length} 条`;
  document.querySelector("#insurance-audit").innerHTML = logs.map((log) => {
    const resident = residentOf(state, log.residentId);
    return `<section class="item">
      <div>
        <h3>${resident?.name || "未知居民"} · ${log.scope}</h3>
        <p>${log.actor} · ${log.at}</p>
        <p>${log.purpose} · ${log.personIndex || "未生成统一索引"}</p>
      </div>
      <span class="badge info">${log.result}</span>
    </section>`;
  }).join("") || `<p class="muted">暂无医保审核访问留痕。</p>`;
}
