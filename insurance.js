const fallbackState = { residents: [], diseases: [], followups: [], personalRecords: [], careOrders: [], insuranceClaims: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  renderMetrics(state);
  renderClaims(state);
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
