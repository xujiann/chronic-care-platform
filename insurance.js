const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  renderMetrics(state);
  renderClaims(state);
  renderSupervisions(state);
});

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
