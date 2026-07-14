const paymentFallback = { state: { policy: {}, cases: [], specialCases: [], settlementBatches: [], budgets: [], feedbacks: [], auditTrail: [], schemeVersions: [], parameterVersions: [], externalDependencies: [] }, summary: {}, institutions: [] };
let paymentView = paymentFallback;

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#calculate-all").addEventListener("click", calculateAll);
  document.querySelector("#create-settlement").addEventListener("click", createSettlement);
  document.querySelector("#feedback-form").addEventListener("submit", submitFeedback);
  document.addEventListener("click", handleAction);
  await refresh();
});

async function requestPayment(path = "", options = {}) {
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${API_BASE}/disease-payment${path}`, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || body.error || "操作失败");
  return body;
}

async function refresh() {
  try { paymentView = await requestPayment(); render(); } catch (error) { message(error.message, true); }
}

function message(text, error = false) { const node = document.querySelector("#action-message"); node.textContent = text; node.style.color = error ? "#b91c1c" : "#0f766e"; }
function fmt(value) { return Number(value || 0).toLocaleString("zh-CN", { style: "currency", currency: "CNY" }); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }

async function calculateAll() {
  const button = document.querySelector("#calculate-all"); button.disabled = true;
  try { paymentView = await requestPayment("/calculate", { method: "POST", body: JSON.stringify({ mode: document.querySelector("#payment-mode").value }) }); render(); message("分组、测算与智能审核已完成"); } catch (error) { message(error.message, true); } finally { button.disabled = false; }
}

async function createSettlement() {
  const period = paymentView.state.cases.map((item) => item.dischargeDate?.slice(0, 7)).filter(Boolean).sort().at(-1) || new Date().toISOString().slice(0, 7);
  try { await requestPayment("/settlements", { method: "POST", body: JSON.stringify({ period }) }); await refresh(); message(`${period}月度结算批次已生成`); } catch (error) { message(error.message, true); }
}

async function submitFeedback(event) {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try { await requestPayment("/feedbacks", { method: "POST", body: JSON.stringify(Object.fromEntries(form)) }); event.currentTarget.reset(); await refresh(); message("意见已进入反馈台账"); } catch (error) { message(error.message, true); }
}

async function handleAction(event) {
  const button = event.target.closest("[data-payment-action]"); if (!button) return;
  try {
    if (button.dataset.paymentAction === "special") await requestPayment("/special-cases", { method: "POST", body: JSON.stringify({ caseId: button.dataset.id, reason: "资源消耗显著偏离病种标准，申请特例单议", requestedMethod: "调整支付标准", evidence: ["结算清单", "病案摘要", "费用明细"] }) });
    if (button.dataset.paymentAction === "review") await requestPayment(`/special-cases/${encodeURIComponent(button.dataset.id)}/review`, { method: "POST", body: JSON.stringify({ approved: true, opinion: "智能初审和专家评审通过" }) });
    if (button.dataset.paymentAction === "reconcile") await requestPayment(`/settlements/${encodeURIComponent(button.dataset.id)}/reconcile`, { method: "POST", body: JSON.stringify({ status: "已对账", adjustedAmount: button.dataset.amount }) });
    if (button.dataset.paymentAction === "pay") await requestPayment(`/settlements/${encodeURIComponent(button.dataset.id)}/reconcile`, { method: "POST", body: JSON.stringify({ status: "已拨付", adjustedAmount: button.dataset.amount }) });
    if (button.dataset.paymentAction === "governance") await requestPayment(`/governance/${button.dataset.resource}/${encodeURIComponent(button.dataset.id)}`, { method: "POST", body: JSON.stringify({ status: button.dataset.status, conclusion: button.dataset.conclusion || undefined }) });
    if (button.dataset.paymentAction === "import-sample") await importSample(false);
    if (button.dataset.paymentAction === "import-error-sample") await importSample(true);
    if (button.dataset.paymentAction === "run-simulation") await requestPayment("/grouping-runs", { method: "POST", body: JSON.stringify({ environment: "simulation", mode: document.querySelector("#payment-mode").value }) });
    if (button.dataset.paymentAction === "retry-import") await requestPayment(`/intake/retries/${encodeURIComponent(button.dataset.id)}`, { method: "POST", body: JSON.stringify({ institutionCode: "HOSP-DEMO", totalAmount: 1200, declaredFundAmount: 900, costItems: [{ itemCode: "TEST-001", itemName: "补正诊疗项目", amount: 1200, catalogVersion: "2026" }] }) });
    await refresh(); message("业务状态已更新并记录审计");
  } catch (error) { message(error.message, true); }
}

function render() {
  const { state, summary, institutions } = paymentView;
  document.querySelector("#payment-mode").value = state.mode || "DRG";
  document.querySelector("#payment-metrics").innerHTML = [["住院病例", summary.caseCount, `已测算 ${summary.calculatedCount || 0}`],["支付标准", fmt(summary.paymentStandard), `总费用 ${fmt(summary.totalCost)}`],["预计结余", fmt(summary.projectedBalance), "负值表示费用超出标准"],["监管线索", summary.riskCount, `未入组 ${summary.ungroupedCount || 0}`],["特例待评", summary.specialPending, "支持复杂危重与新药新技术"],["待办批次", summary.settlementPending, "月结算与年度清算"]].map(([label,value,hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
  renderIntake(state, summary.intake || {}); renderCases(state); renderPolicy(state); renderVersions(state); renderSpecial(state); renderSettlements(state); renderMonitoring(state, institutions); renderGovernance(state); renderFeedback(state); renderAudit(state);
}

async function importSample(withError) {
  const suffix = String(Date.now()).slice(-7);
  const row = { settlementListNo: `DL-BATCH-${suffix}`, institutionCode: withError ? "" : "HOSP-DEMO", institution: "大连市示范医院", residentId: "r1", patientName: "脱敏患者", admissionDate: "2026-07-01", dischargeDate: "2026-07-05", principalDiagnosis: "I10", principalDiagnosisName: "原发性高血压", totalAmount: 1200, declaredFundAmount: 900, costItems: withError ? [{ itemCode: "TEST-001", itemName: "错误金额项目", amount: 1000 }] : [{ itemCode: "TEST-001", itemName: "诊疗项目", amount: 1200, catalogVersion: "2026" }] };
  return requestPayment("/intake/imports", { method: "POST", body: JSON.stringify({ sourceSystem: "workbench-sample", rows: [row] }) });
}

function renderIntake(state, summary) {
  document.querySelector("#intake-summary").textContent = `清单${summary.acceptedLists || 0}份 · 待补正${summary.pendingRetries || 0}份 · 账本${summary.ledgerValid === false ? "异常" : "有效"}`;
  document.querySelector("#adapter-list").innerHTML = (state.grouperAdapters || []).map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.environment)} · ${escapeHtml(item.authority)}</p></div><span class="badge ${item.status === "ready" ? "info" : "warn"}">${escapeHtml(item.status)}</span></section>`).join("");
  document.querySelector("#import-list").innerHTML = (state.settlementListImports || []).slice(0, 3).map((item) => `<section class="item"><div><h3>${escapeHtml(item.id)} · ${escapeHtml(item.sourceSystem)}</h3><p>${item.rowCount}行 · 接收${item.accepted} · 拒绝${item.rejected} · 重复${item.duplicates}</p></div><span class="badge ${item.rejected ? "warn" : "info"}">${escapeHtml(item.status)}</span></section>`).join("") || `<p class="muted">尚未执行批量导入。</p>`;
  document.querySelector("#retry-list").innerHTML = (state.importRetryQueue || []).filter((item) => item.status !== "resolved").slice(0, 3).map((item) => `<section class="item"><div><h3>第${item.rowNumber}行待补正</h3><p>${item.issues.map((issue) => escapeHtml(issue.message)).join("；")}</p><div class="case-actions"><button data-payment-action="retry-import" data-id="${item.id}">使用补正样例重试</button></div></div><span class="badge warn">${escapeHtml(item.status)}</span></section>`).join("");
  document.querySelector("#grouping-run-list").innerHTML = (state.groupingRuns || []).slice(-3).reverse().map((item) => `<section class="item"><div><h3>${item.environment === "formal" ? "正式" : "模拟"}分组 · ${escapeHtml(item.mode)}</h3><p>${item.caseCount}例 · 成功${item.succeeded} · 失败${item.failed} · 哈希${item.recordHash.slice(0, 12)}</p></div><span class="badge ${item.environment === "formal" ? "info" : "warn"}">${escapeHtml(item.authority || item.adapterId)}</span></section>`).join("") || `<p class="muted">尚未生成分组运行账本。</p>`;
}

function renderCases(state) {
  document.querySelector("#case-count").textContent = `${state.cases.length}例`;
  document.querySelector("#case-list").innerHTML = `<table class="payment-table"><thead><tr><th>病例/机构</th><th>诊断</th><th>费用</th><th>分组结果</th><th>支付测算</th><th>监管</th><th>操作</th></tr></thead><tbody>${state.cases.map((item) => { const c = item.calculation || {}; const g = c.grouping || {}; const risks = c.risks || []; return `<tr><td><strong>${escapeHtml(item.patientName)}</strong><small>${escapeHtml(item.settlementListNo)} · ${escapeHtml(item.institution)}</small></td><td>${escapeHtml(item.principalDiagnosis)} ${escapeHtml(item.principalDiagnosisName)}<small>${item.admissionDate} 至 ${item.dischargeDate}</small></td><td>${fmt(item.totalAmount)}<small>申报基金 ${fmt(item.declaredFundAmount)}</small></td><td><strong>${escapeHtml(g.groupCode || "待分组")}</strong><small>${escapeHtml(g.groupName || item.qualityStatus)}</small></td><td>${c.paymentStandard == null ? "待测算" : fmt(c.paymentStandard)}<small>${escapeHtml(c.formula || "")}</small></td><td><div class="risk-list">${risks.length ? risks.map((risk) => `<span class="risk-pill">${escapeHtml(risk.name)}</span>`).join("") : `<span class="ok-pill">未发现线索</span>`}</div></td><td><div class="case-actions">${item.specialCaseStatus === "未申报" ? `<button data-payment-action="special" data-id="${item.id}">特例申报</button>` : `<span>${item.specialCaseStatus}</span>`}</div></td></tr>`; }).join("")}</tbody></table>`;
}

function renderPolicy(state) {
  const p = state.policy || {}; document.querySelector("#policy-panel").innerHTML = `<div><strong>${escapeHtml(p.documentNo)}</strong><span>${escapeHtml(p.name)}</span></div><div><strong>适用范围</strong><span>住院费用DRG/DIP付费管理</span></div><div><strong>系统边界</strong><span>本平台负责协同、测算和证据留痕；正式分组、结算和拨付以医保核心系统为准。</span></div>`;
  document.querySelector("#dependency-list").innerHTML = state.externalDependencies.map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.owner)} · ${item.requiredForProduction ? "生产必需" : "可选"}</p></div><span class="badge ${item.status.includes("待") ? "warn" : "info"}">${escapeHtml(item.status)}</span></section>`).join("");
}

function renderVersions(state) { const dip = state.dip2LibraryProfile; document.querySelector("#version-list").innerHTML = `<section class="item"><div><h3>${escapeHtml(dip.name)}</h3><p>${dip.coreDiseaseGroups}组：保守治疗${dip.conservativeTreatmentGroups}组、手术操作${dip.surgeryOperationGroups}组</p><p>${escapeHtml(dip.groupingFormula)} · 相关操作费用占比≥${dip.relatedOperationCostThreshold * 100}%单独成组</p></div><span class="badge info">国家2.0版</span></section>` + [...state.schemeVersions, ...state.parameterVersions].map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.mode)} · ${escapeHtml(item.localVersion || item.rateMethod || "")} · ${escapeHtml(item.effectiveFrom)}</p></div><span class="badge ${item.status === "已发布" ? "info" : "warn"}">${escapeHtml(item.status)}</span></section>`).join(""); }
function renderSpecial(state) { document.querySelector("#special-count").textContent = `${state.specialCases.length}项`; document.querySelector("#special-list").innerHTML = state.specialCases.map((item) => `<section class="item"><div><h3>${escapeHtml(item.caseId)} · ${escapeHtml(item.reason)}</h3><p>${escapeHtml(item.requestedMethod)} · ${escapeHtml(item.submittedBy)}</p><div class="case-actions">${item.status === "待评审" ? `<button data-payment-action="review" data-id="${item.id}">评审通过</button>` : ""}</div></div><span class="badge ${item.status === "待评审" ? "warn" : "info"}">${escapeHtml(item.status)}</span></section>`).join("") || `<p class="muted">暂无特例单议申请。</p>`; }
function renderSettlements(state) { document.querySelector("#settlement-count").textContent = `${state.settlementBatches.length}批`; document.querySelector("#settlement-list").innerHTML = state.settlementBatches.map((item) => `<section class="item"><div><h3>${escapeHtml(item.type)} · ${escapeHtml(item.period)}</h3><p>${item.caseCount}例 · 标准金额 ${fmt(item.standardAmount)} · 调整后 ${fmt(item.adjustedAmount)}</p><div class="case-actions">${item.status === "待对账" ? `<button data-payment-action="reconcile" data-id="${item.id}" data-amount="${item.standardAmount}">确认对账</button>` : ""}${item.status === "已对账" ? `<button data-payment-action="pay" data-id="${item.id}" data-amount="${item.adjustedAmount || item.standardAmount}">确认拨付</button>` : ""}</div></div><span class="badge ${item.status === "已拨付" ? "info" : "warn"}">${escapeHtml(item.status)}</span></section>`).join("") || `<p class="muted">暂无结算批次。</p>`; }
function renderMonitoring(state, institutions) { const budget = state.budgets[0]; document.querySelector("#budget-list").innerHTML = budget ? `<section class="item"><div><h3>${budget.year}年按病种预算</h3><p>${fmt(budget.diseasePaymentTotal)} · 已执行 ${fmt(budget.executed)} · 执行率 ${Math.round(budget.executed / budget.diseasePaymentTotal * 100)}%</p></div><span class="badge info">${budget.status}</span></section>` : ""; document.querySelector("#institution-list").innerHTML = institutions.map((item) => `<section class="item"><div><h3>${escapeHtml(item.institution)}</h3><p>${item.caseCount}例 · 费用 ${fmt(item.totalCost)} · 标准 ${fmt(item.standardAmount)}</p></div><span class="badge ${item.riskCount ? "warn" : "info"}">${item.riskCount}条线索</span></section>`).join(""); }
function renderGovernance(state) {
  document.querySelector("#prepayment-list").innerHTML = state.prepayments.map((item) => `<section class="item"><div><h3>预付金 · ${escapeHtml(item.institution)}</h3><p>${fmt(item.amount)} · ${item.recommendedMonths}个月 · 信用${escapeHtml(item.creditLevel)} · 追溯码${item.traceabilityReportingRate}%</p>${item.status === "待审批" ? `<div class="case-actions"><button data-payment-action="governance" data-resource="prepayments" data-id="${item.id}" data-status="已审批">审批预付</button></div>` : ""}</div><span class="badge ${item.status === "待审批" ? "warn" : "info"}">${item.status}</span></section>`).join("");
  document.querySelector("#unpaid-list").innerHTML = state.unpaidItems.map((item) => `<section class="item"><div><h3>应付未付 · ${item.serviceYear}年</h3><p>${escapeHtml(item.institution)} · ${fmt(item.amount)} · ${escapeHtml(item.reason)}</p>${item.status !== "已支付" ? `<div class="case-actions"><button data-payment-action="governance" data-resource="unpaid" data-id="${item.id}" data-status="已支付">确认清理支付</button></div>` : ""}</div><span class="badge ${item.status === "已支付" ? "info" : "warn"}">${item.status}</span></section>`).join("");
  document.querySelector("#negotiation-list").innerHTML = state.negotiationRounds.map((item) => `<section class="item"><div><h3>${escapeHtml(item.topic)}</h3><p>${item.participants.map(escapeHtml).join("、")} · ${escapeHtml(item.meetingDate)}</p>${item.status !== "已达成一致" ? `<div class="case-actions"><button data-payment-action="governance" data-resource="negotiations" data-id="${item.id}" data-status="已达成一致" data-conclusion="基于历史费用、基金预算和实际病种数据协商一致">记录协商一致</button></div>` : ""}</div><span class="badge ${item.status === "已达成一致" ? "info" : "warn"}">${item.status}</span></section>`).join("");
  const group = state.dataWorkingGroup; document.querySelector("#working-group").innerHTML = `<div><strong>${escapeHtml(group.name)}</strong><span>${group.members.length}名不同级别、类型代表 · ${escapeHtml(group.status)}</span></div><div><strong>定期通报</strong><span>${group.disclosureItems.join("、")} · 上次 ${group.lastBriefingAt}</span></div>`;
  document.querySelector("#training-count").textContent = `${state.trainings.length}项`; document.querySelector("#training-list").innerHTML = state.trainings.map((item) => `<section class="item"><div><h3>${escapeHtml(item.audience)}</h3><p>${escapeHtml(item.category)} · ${item.scheduledAt} · ${item.attendees}人</p>${item.status !== "已完成" ? `<div class="case-actions"><button data-payment-action="governance" data-resource="trainings" data-id="${item.id}" data-status="已完成">完成培训</button></div>` : ""}</div><span class="badge ${item.status === "已完成" ? "info" : "warn"}">${item.status}</span></section>`).join("");
  document.querySelector("#compliance-list").innerHTML = state.complianceRules.map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.severity)}控制 · ${escapeHtml(item.status)}</p></div><span class="badge ${item.severity === "阻断" ? "danger" : "warn"}">${escapeHtml(item.severity)}</span></section>`).join("");
}
function renderFeedback(state) { document.querySelector("#feedback-list").innerHTML = state.feedbacks.slice(0,5).map((item) => `<section class="item"><div><h3>${escapeHtml(item.category)}</h3><p>${escapeHtml(item.content)} · ${escapeHtml(item.institution)}</p></div><span class="badge warn">${escapeHtml(item.status)}</span></section>`).join(""); }
function renderAudit(state) { document.querySelector("#audit-list").innerHTML = state.auditTrail.slice(0,10).map((item) => `<section class="item"><div><h3>${escapeHtml(item.action)}</h3><p>${escapeHtml(item.actor)} · ${new Date(item.at).toLocaleString("zh-CN")} · ${escapeHtml(item.detail)}</p></div></section>`).join("") || `<p class="muted">完成首次操作后生成审计记录。</p>`; }
