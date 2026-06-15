const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  renderMetrics(state);
  renderCareOrders(state);
  renderAuthorizedRecords(state);
  renderClaimLinks(state);
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
