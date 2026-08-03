const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[character]);

const table = (headers, rows) => `
  <table class="gl-table">
    <thead><tr>${headers.map((item) => `<th>${escapeHtml(item)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;

const clinicalGateLabels = {
  receiptsValid: "现场证据回执双签",
  mastersValid: "BIS/BTIS 主数据契约",
  coldChainValid: "冷链校准与告警证据",
  scenariosValid: "配血、床旁与召回验收",
  smokePassed: "独立运行冒烟",
  rollbackPassed: "回退恢复演练"
};

async function load() {
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${location.origin}/api/blood-system/go-live`);
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || "加载失败");
  render(data);
}

function render(data) {
  const summary = data.summary;
  const summaryRows = [
    ["正式上线状态", data.productionReady ? "可切换" : "现场证据阻断"],
    ["生产接口", `${summary.endpointsReady}/${summary.endpoints}`],
    ["现场要求", `${summary.requirementsSigned}/${summary.requirements}`],
    ["演练", `${summary.drillsPassed}/${summary.drills}`],
    ["迁移对账", `${summary.migrationsReconciled}/${summary.migrations}`]
  ];
  document.querySelector("#gl-summary").innerHTML = summaryRows.map(([label, value]) => `
    <article class="gl-card">
      <small>${escapeHtml(label)}</small>
      <strong class="${data.productionReady ? "ready" : "blocked"}">${escapeHtml(value)}</strong>
    </article>`).join("");

  const gates = data.clinicalProduction?.gates || {};
  document.querySelector("#gl-clinical-gates").innerHTML = table(
    ["生产门禁", "状态", "上线判定"],
    Object.entries(clinicalGateLabels).map(([key, label]) => [
      escapeHtml(label),
      `<span class="${gates[key] ? "ready" : "blocked"}">${gates[key] ? "已签收" : "待现场签收"}</span>`,
      gates[key] ? "通过" : "No-Go"
    ])
  );

  const registry = window.BloodStandardRegistry;
  const coverage = registry.coverage();
  document.querySelector("#gl-standard-registry").innerHTML = table(
    ["标准", "数据子集", "登记数据元", "状态"],
    [[
      `${escapeHtml(coverage.standard.number)}<br><small>${escapeHtml(coverage.standard.datasetId)} · ${escapeHtml(coverage.standard.effectiveAt)} 生效</small>`,
      `${coverage.representedSubsets}/${coverage.subsets}`,
      String(coverage.registeredElements),
      `<span class="${coverage.completeSubsetCoverage ? "ready" : "blocked"}">${coverage.completeSubsetCoverage ? "十二类子集已建档" : "存在缺失"}</span>`
    ]]
  );

  document.querySelector("#gl-endpoints").innerHTML = table(
    ["接口/设备", "责任方", "状态"],
    data.endpoints.map((item) => [escapeHtml(item.name), escapeHtml(item.owner), escapeHtml(item.status)])
  );
  document.querySelector("#gl-requirements").innerHTML = table(
    ["要求", "责任方", "状态"],
    data.requirements.map((item) => [escapeHtml(item.title), escapeHtml(item.owner), escapeHtml(item.status)])
  );
  document.querySelector("#gl-drills").innerHTML = table(
    ["演练", "状态", "证据"],
    data.drills.map((item) => [escapeHtml(item.title), escapeHtml(item.status), escapeHtml(item.evidenceRef || "待现场执行")])
  );
  document.querySelector("#gl-migrations").innerHTML = table(
    ["批次", "源/目标", "状态"],
    data.migrations.map((item) => [escapeHtml(item.name), `${escapeHtml(item.sourceCount ?? "-")}/${escapeHtml(item.targetCount ?? "-")}`, escapeHtml(item.status)])
  );
  document.querySelector("#gl-approvals").innerHTML = table(
    ["审批", "状态", "签署人"],
    data.approvals.map((item) => [escapeHtml(item.title), escapeHtml(item.status), escapeHtml(item.signedBy || "待签")])
  );
  document.querySelector("#gl-rollback").textContent = `回滚：${data.rollback.strategy}；RPO ${data.rollback.rpoMinutes}分钟，RTO ${data.rollback.rtoMinutes}分钟；触发条件：${data.rollback.triggers.join("、")}`;
}

document.addEventListener("DOMContentLoaded", () => load().catch((error) => alert(error.message)));
