const paymentFallback = { state: { policy: {}, cases: [], specialCases: [], settlementBatches: [], budgets: [], feedbacks: [], auditTrail: [], schemeVersions: [], parameterVersions: [], parameterImpactReports: [], localPaymentPackages: [], localPaymentPackageValidationReports: [], localPaymentPackageImpactReports: [], localPaymentPackageDiffReports: [], localPaymentPackageActivationSnapshots: [], localPaymentPackageSimulationJobs: [], formalGroupingJobs: [], formalGroupingDeadLetters: [], externalDependencies: [], groupCatalog: [], drg2LibraryProfile: {}, drgPreviewRules: {} }, summary: {}, institutions: [], supervision: { summary: {}, profiles: [], policyBoundary: "" }, localPackageView: { packages: [], validationReports: [], impactReports: [], diffReports: [], activationSnapshots: [], simulationJobs: [], checklist: [] } };
let paymentView = paymentFallback;

document.addEventListener("DOMContentLoaded", async () => {
  document.querySelector("#calculate-all").addEventListener("click", calculateAll);
  document.querySelector("#create-settlement").addEventListener("click", createSettlement);
  document.querySelector("#feedback-form").addEventListener("submit", submitFeedback);
  document.querySelector("#local-package-file").addEventListener("change", importLocalPackageFile);
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
  try {
    const [overview, localPackageView] = await Promise.all([requestPayment(), requestPayment("/local-packages")]);
    paymentView = { ...overview, localPackageView };
    render();
  } catch (error) { message(error.message, true); }
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

async function importLocalPackageFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const result = await requestPayment("/local-packages", { method: "POST", body: JSON.stringify(payload) });
    await refresh();
    message(result.validation.ok ? `规则包${result.package.id}校验通过，可开始影响试算` : `规则包校验未通过：${result.validation.errors.join("；")}`, !result.validation.ok);
  } catch (error) { message(`规则包导入失败：${error.message}`, true); }
  finally { event.target.value = ""; }
}

async function handleAction(event) {
  const button = event.target.closest("[data-payment-action]"); if (!button) return;
  try {
    if (button.dataset.paymentAction === "special") await requestPayment("/special-cases", { method: "POST", body: JSON.stringify({ caseId: button.dataset.id, reason: "资源消耗显著偏离病种标准，申请特例单议", requestedMethod: "调整支付标准", evidence: ["结算清单", "病案摘要", "费用明细"] }) });
    if (button.dataset.paymentAction === "review") await requestPayment(`/special-cases/${encodeURIComponent(button.dataset.id)}/review`, { method: "POST", body: JSON.stringify({ approved: true, opinion: "智能初审和专家评审通过" }) });
    if (button.dataset.paymentAction.startsWith("settlement-")) {
      const batch = (paymentView.state.settlementBatches || []).find((item) => item.id === button.dataset.id);
      const action = button.dataset.paymentAction.replace("settlement-", "");
      const amountFen = Number(batch?.adjustedAmountFen ?? batch?.standardAmountFen ?? 0);
      const coreReturnCycle = (batch?.coreReturnCycles || []).at(-1);
      const paymentFailureCycle = (batch?.paymentFailureCycles || []).at(-1);
      const correctionInput = action === "resubmit-core" ? await window.HealthStructuredDialog.prompt({ title: "补正证据摘要", label: "SHA-256 摘要（64位十六进制）", multiline: false, pattern: "^[a-fA-F0-9]{64}$", patternMessage: "请输入64位SHA-256十六进制摘要。" }) : "";
      if (correctionInput === null) return;
      const correctionDigest = String(correctionInput).trim().toLowerCase();
      const paymentResolution = action === "retry-payment" ? await window.HealthStructuredDialog.prompt({ title: "拨付失败处置结论", minLength: 2 }) : "";
      if (paymentResolution === null) return;
      const paymentResolutionInput = action === "retry-payment" ? await window.HealthStructuredDialog.prompt({ title: "处置证据摘要", label: "SHA-256 摘要（64位十六进制）", multiline: false, pattern: "^[a-fA-F0-9]{64}$", patternMessage: "请输入64位SHA-256十六进制摘要。" }) : "";
      if (paymentResolutionInput === null) return;
      const paymentResolutionDigest = String(paymentResolutionInput).trim().toLowerCase();
      if (action === "resubmit-core" && !/^[a-f0-9]{64}$/.test(correctionDigest)) throw new Error("补正证据摘要必须为64位SHA-256十六进制");
      if (action === "retry-payment" && (!paymentResolution || !/^[a-f0-9]{64}$/.test(paymentResolutionDigest))) throw new Error("拨付失败处置结论和64位SHA-256证据摘要不能为空");
      const payloads = {
        "submit-core": { action, externalRequestId: `UI-CORE-${batch?.id}`, idempotencyKey: `UI-CORE-${batch?.batchDigest}` },
        "resubmit-core": { action, returnCycleId: coreReturnCycle?.id, externalRequestId: `UI-CORE-${batch?.id}-R${Number(batch?.coreSubmission?.revision || 1) + 1}`, idempotencyKey: `UI-CORE-${batch?.batchDigest}-R${Number(batch?.coreSubmission?.revision || 1) + 1}`, correctionDigest },
        "start-reconciliation": { action, idempotencyKey: `UI-RECON-${batch?.id}`, providerSummaryDigest: "0".repeat(64) },
        "confirm-matched": { action, idempotencyKey: `UI-MATCH-${batch?.id}`, providerAmountFen: amountFen },
        "request-payment": { action, paymentRequestId: `UI-PAY-REQUEST-${batch?.id}` },
        "retry-payment": { action, failureCycleId: paymentFailureCycle?.id, paymentRequestId: `UI-PAY-REQUEST-${batch?.id}-R${Number(batch?.paymentRequest?.revision || 1) + 1}`, idempotencyKey: `UI-PAY-RETRY-${batch?.id}-R${Number(batch?.paymentRequest?.revision || 1) + 1}`, resolution: paymentResolution, resolutionDigest: paymentResolutionDigest },
        close: { action, closeReference: `UI-CLOSE-${batch?.id}` }
      };
      await requestPayment(`/settlements/${encodeURIComponent(button.dataset.id)}/reconcile`, { method: "POST", body: JSON.stringify(payloads[action]) });
    }
    if (button.dataset.paymentAction === "governance") await requestPayment(`/governance/${button.dataset.resource}/${encodeURIComponent(button.dataset.id)}`, { method: "POST", body: JSON.stringify({ status: button.dataset.status, conclusion: button.dataset.conclusion || undefined }) });
    if (button.dataset.paymentAction === "import-sample") await importSample(false);
    if (button.dataset.paymentAction === "import-error-sample") await importSample(true);
    if (button.dataset.paymentAction === "run-simulation") await requestPayment("/grouping-runs", { method: "POST", body: JSON.stringify({ environment: "simulation", mode: document.querySelector("#payment-mode").value }) });
    if (button.dataset.paymentAction === "preview-drg") {
      const preview = await requestPayment("/drg/simulate", { method: "POST", body: JSON.stringify({ caseId: button.dataset.id }) });
      const group = preview.calculation?.grouping;
      message(group?.ok ? `DRG模拟：${group.mdcCode} → ${group.adrgCode} → ${group.groupCode}（非正式结果）` : `DRG模拟未入组：${group?.reason || preview.calculation?.error || "请复核病例"}`, !group?.ok);
      return;
    }
    if (button.dataset.paymentAction === "create-parameter") {
      const mode = document.querySelector("#payment-mode").value;
      const active = paymentView.state.parameterVersions.find((item) => item.mode === mode && item.status === "已发布");
      await requestPayment("/parameters", { method: "POST", body: JSON.stringify({ mode, schemeId: paymentView.state.schemeVersions.find((item) => item.mode === mode && item.status === "已发布")?.id, name: `${new Date().getFullYear() + 1}年度${mode}支付参数草案`, rate: Number(active?.rate || 1) * 1.02, effectiveFrom: `${new Date().getFullYear() + 1}-01-01` }) });
    }
    if (button.dataset.paymentAction === "choose-local-package") {
      document.querySelector("#local-package-file").click();
      return;
    }
    if (button.dataset.paymentAction === "activate-due-local-packages") await requestPayment("/local-packages/activate-due", { method: "POST", body: "{}" });
    if (button.dataset.paymentAction === "local-package-job-create") await requestPayment(`/local-packages/${encodeURIComponent(button.dataset.id)}/simulation-jobs`, { method: "POST", body: JSON.stringify({ batchSize: 500 }) });
    if (["local-package-job-process", "local-package-job-retry", "local-package-job-cancel"].includes(button.dataset.paymentAction)) {
      const action = button.dataset.paymentAction.replace("local-package-job-", "");
      const body = action === "cancel" ? { reason: "操作人员从工作台取消" } : {};
      await requestPayment(`/local-packages/simulation-jobs/${encodeURIComponent(button.dataset.id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
    }
    if (["local-package-simulate", "local-package-submit", "local-package-review", "local-package-publish", "local-package-activate", "local-package-rollback"].includes(button.dataset.paymentAction)) {
      const action = button.dataset.paymentAction.replace("local-package-", "");
      let body = action === "review" ? { approved: true, role: "当地医保规则包复核", opinion: "来源、目录、支付参数、差异和影响报告已复核" } : {};
      if (action === "rollback") {
        if (!window.confirm("仅在尚未生成生效后结算批次时允许回退。确认继续？")) return;
        const reason = await window.HealthStructuredDialog.prompt({ title: "规则包回退原因", minLength: 2 });
        if (reason === null) return;
        body = { reason };
      }
      await requestPayment(`/local-packages/${encodeURIComponent(button.dataset.id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
    }
    if (["parameter-simulate", "parameter-submit", "parameter-review", "parameter-publish"].includes(button.dataset.paymentAction)) {
      const action = button.dataset.paymentAction.replace("parameter-", "");
      const body = action === "review" ? { approved: true, role: "医保参数复核", opinion: "影响分析已复核" } : {};
      await requestPayment(`/parameters/${encodeURIComponent(button.dataset.id)}/${action}`, { method: "POST", body: JSON.stringify(body) });
    }
    if (button.dataset.paymentAction === "retry-import") await requestPayment(`/intake/retries/${encodeURIComponent(button.dataset.id)}`, { method: "POST", body: JSON.stringify({ institutionCode: "HOSP-DEMO", totalAmount: 1200, declaredFundAmount: 900, costItems: [{ itemCode: "TEST-001", itemName: "补正诊疗项目", amount: 1200, catalogVersion: "2026" }] }) });
    if (button.dataset.paymentAction === "create-formal-job") {
      const mode = document.querySelector("#payment-mode").value;
      const adapter = (paymentView.state.grouperAdapters || []).find((item) => item.id === "official-adapter-v1");
      await requestPayment("/formal-grouping/jobs", { method: "POST", body: JSON.stringify({ mode, schemeVersion: adapter?.acceptedSchemeVersions?.find((item) => item.startsWith(mode)), caseIds: paymentView.state.cases.slice(0, 2).map((item) => item.id) }) });
    }
    if (button.dataset.paymentAction === "formal-dispatch") await requestPayment(`/formal-grouping/jobs/${encodeURIComponent(button.dataset.id)}/dispatch`, { method: "POST", body: JSON.stringify({ accepted: true, endpoint: "official-grouper-adapter" }) });
    if (button.dataset.paymentAction === "formal-fail") await requestPayment(`/formal-grouping/jobs/${encodeURIComponent(button.dataset.id)}/fail`, { method: "POST", body: JSON.stringify({ errorCode: "RECEIPT_TIMEOUT", errorMessage: "演示：30分钟内未收到正式回执" }) });
    if (button.dataset.paymentAction === "formal-retry") await requestPayment(`/formal-grouping/jobs/${encodeURIComponent(button.dataset.id)}/retry`, { method: "POST", body: "{}" });
    if (button.dataset.paymentAction === "formal-reconcile") await requestPayment(`/formal-grouping/jobs/${encodeURIComponent(button.dataset.id)}/reconcile`, { method: "POST", body: JSON.stringify({ resolution: "已与医保分组器运维核对传输链路，允许重新派发" }) });
    await refresh(); message("业务状态已更新并记录审计");
  } catch (error) { message(error.message, true); }
}

function render() {
  const { state, summary, institutions } = paymentView;
  document.querySelector("#payment-mode").value = state.mode || "DRG";
  document.querySelector("#payment-metrics").innerHTML = [["住院病例", summary.caseCount, `已测算 ${summary.calculatedCount || 0}`],["支付标准", fmt(summary.paymentStandard), `总费用 ${fmt(summary.totalCost)}`],["预计结余", fmt(summary.projectedBalance), "负值表示费用超出标准"],["监管线索", summary.riskCount, `未入组 ${summary.ungroupedCount || 0}`],["特例待评", summary.specialPending, "支持复杂危重与新药新技术"],["待办批次", summary.settlementPending, "月结算与年度清算"]].map(([label,value,hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
  renderDrgWorkbench(state, summary.drg || {}); renderParameterGovernance(state); renderLocalPackageGovernance(paymentView.localPackageView || {}); renderFormalGroupingOperations(state); renderIntake(state, summary.intake || {}); renderCases(state); renderDiseaseSupervision(paymentView.supervision || {}); renderPolicy(state); renderVersions(state); renderSpecial(state); renderSettlements(state); renderMonitoring(state, institutions); renderGovernance(state); renderFeedback(state); renderAudit(state);
}

function renderDrgWorkbench(state, analytics) {
  const profile = state.drg2LibraryProfile || {};
  document.querySelector("#drg-profile").innerHTML = [["MDC", profile.mdcCount, "主要诊断大类"],["ADRG", profile.adrgCount, "核心分组"],["DRG", profile.drgCount, "细分病组"],["外科组", profile.surgicalGroups, "手术室操作"],["非手术室操作组", profile.nonOperatingRoomProcedureGroups, "操作分组"],["内科组", profile.medicalGroups, "内科诊疗"]].map(([label,value,hint]) => `<div class="drg-profile-card"><span>${label}</span><strong>${value ?? "-"}</strong><small>${hint}</small></div>`).join("");
  const groups = (state.groupCatalog || []).filter((item) => item.mode === "DRG");
  const adrgs = [...new Map(groups.map((group) => [group.adrgCode, group])).values()].filter((group) => group.adrgCode);
  document.querySelector("#drg-hierarchy").innerHTML = adrgs.map((group) => { const children = groups.filter((item) => item.adrgCode === group.adrgCode); return `<div class="drg-hierarchy-row"><strong>${escapeHtml(group.mdcCode)} ${escapeHtml(group.mdcName)} → ${escapeHtml(group.adrgCode)} ${escapeHtml(group.adrgName)}</strong><small>${children.map((item) => `${escapeHtml(item.code)}（${escapeHtml(item.complicationLevel)}，权重${item.weight}）`).join(" · ")}</small></div>`; }).join("") || `<p class="muted">本地预览目录尚未配置。</p>`;
  document.querySelector("#drg-analytics").innerHTML = [["入组率", `${Math.round(Number(analytics.groupingRate || 0) * 1000) / 10}%`],["CMI", Number(analytics.cmi || 0).toFixed(3)],["总权重", Number(analytics.totalWeight || 0).toFixed(2)],["覆盖MDC", analytics.mdcCount || 0],["覆盖ADRG", analytics.adrgCount || 0],["覆盖DRG", analytics.drgCount || 0],["MCC病例", analytics.mccCases || 0],["高倍率", analytics.highOutliers || 0],["低倍率", analytics.lowOutliers || 0]].map(([label,value]) => `<div class="drg-analytics-card"><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderParameterGovernance(state) {
  const actionFor = { "草案": ["parameter-simulate", "影响试算"], "已试算": ["parameter-submit", "提交复核"], "待复核": ["parameter-review", "签署复核"], "复核中": ["parameter-review", "第二人复核"], "已批准": ["parameter-publish", "发布并冻结旧版"] };
  document.querySelector("#parameter-version-list").innerHTML = (state.parameterVersions || []).map((item) => { const action = actionFor[item.status]; return `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.mode)} · ${escapeHtml(item.rateMethod)} ${item.rate} · 方案${escapeHtml(item.schemeId)}</p><small>${(item.approvals || []).length}人签署 · 生效${escapeHtml(item.effectiveFrom)}</small>${action ? `<div class="case-actions"><button data-payment-action="${action[0]}" data-id="${item.id}">${action[1]}</button></div>` : ""}</div><span class="badge ${item.status === "已发布" ? "info" : item.status === "已驳回" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></section>`; }).join("");
  document.querySelector("#parameter-impact-list").innerHTML = (state.parameterImpactReports || []).slice(0, 5).map((item) => `<section class="item"><div><h3>影响报告 · ${escapeHtml(item.parameterId)}</h3><p>${item.caseCount}例 · 当前${fmt(item.currentTotal)} · 候选${fmt(item.candidateTotal)}</p><small>变化${fmt(item.delta)}（${item.changeRate == null ? "无基线" : `${Math.round(item.changeRate * 10000) / 100}%`}） · ${item.byInstitution.length}家机构 · 摘要${item.inputDigest.slice(0, 12)}</small></div><span class="badge ${Math.abs(item.changeRate || 0) > 0.05 ? "warn" : "info"}">${item.delta >= 0 ? "+" : ""}${fmt(item.delta)}</span></section>`).join("") || `<p class="muted">创建草案并完成试算后生成机构影响报告。</p>`;
}

function renderLocalPackageGovernance(view) {
  const actionFor = { "校验通过": ["local-package-job-create", "创建分批试算"], "已试算": ["local-package-submit", "提交复核"], "待复核": ["local-package-review", "签署复核"], "复核中": ["local-package-review", "第二人复核"], "已批准": ["local-package-publish", "发布/排期"], "待生效": ["local-package-activate", "到期激活"], "已发布": ["local-package-rollback", "安全回退"] };
  document.querySelector("#local-package-checklist").innerHTML = (view.checklist || []).map((item, index) => `<div><strong>${index + 1}</strong><span>${escapeHtml(item)}</span></div>`).join("");
  document.querySelector("#local-package-list").innerHTML = (view.packages || []).map((item) => {
    const action = actionFor[item.status];
    const official = item.authority === view.officialAuthority;
    const signature = item.signatureVerification?.ok ? `签名可信 ${escapeHtml(item.signatureVerification.keyFingerprint?.slice(0, 12))}` : official ? "签名未通过" : "无需正式签名";
    return `<section class="item"><div><h3>${escapeHtml(item.regionName)} · ${escapeHtml(item.mode)} ${escapeHtml(item.packageVersion)}</h3><p>${escapeHtml(item.documentNo)} · 目录${item.catalogCount || 0}条 · ${escapeHtml(item.payment?.rateMethod)} ${item.payment?.rate ?? "-"}</p><small>${escapeHtml(item.effectiveFrom)}至${escapeHtml(item.effectiveTo)} · 摘要${escapeHtml(item.contentDigest?.slice(0, 16))} · ${official ? "正式批准来源" : "模板/联调用途"} · ${signature} · ${(item.approvals || []).length}人复核</small>${action ? `<div class="case-actions"><button data-payment-action="${action[0]}" data-id="${escapeHtml(item.id)}">${action[1]}</button></div>` : ""}</div><span class="badge ${item.status === "已发布" ? "info" : item.status === "校验失败" || item.status === "已驳回" || item.status === "已回退" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></section>`;
  }).join("") || `<p class="muted">尚未导入当地医保规则包。可先下载DRG/DIP模板准备数据。</p>`;
  const validationRows = (view.validationReports || []).slice(0, 4).map((item) => `<section class="item"><div><h3>完整性与签名校验 · ${escapeHtml(item.packageId || "未编号")}</h3><p>${item.summary.catalogCount}条目录 · ${item.summary.coefficientCount}项机构系数 · ${item.summary.sourceFileCount}个来源文件${item.signature ? ` · ${item.signature.trusted ? "可信签名" : "签名不可信"}` : ""}</p><small>${item.ok ? `校验通过${item.warnings.length ? `，提示：${escapeHtml(item.warnings.join("；"))}` : ""}` : escapeHtml(item.errors.join("；"))}</small></div><span class="badge ${item.ok ? "info" : "danger"}">${item.ok ? "通过" : `${item.errors.length}项错误`}</span></section>`);
  const impactRows = (view.impactReports || []).slice(0, 4).map((item) => `<section class="item"><div><h3>影响试算 · ${escapeHtml(item.packageId)}</h3><p>${item.groupedCount}/${item.caseCount}例入组 · 当前${fmt(item.currentTotal)} · 候选${fmt(item.candidateTotal)}</p><small>变化${fmt(item.delta)} · ${item.byInstitution.length}家机构 · 摘要${escapeHtml(item.inputDigest.slice(0, 16))}</small></div><span class="badge ${Math.abs(item.changeRate || 0) > 0.05 ? "warn" : "info"}">${item.delta >= 0 ? "+" : ""}${fmt(item.delta)}</span></section>`);
  const diffRows = (view.diffReports || []).slice(0, 4).map((item) => `<section class="item"><div><h3>版本差异 · ${escapeHtml(item.packageId)}</h3><p>目录新增${item.catalog.addedCount} · 删除${item.catalog.removedCount} · 变更${item.catalog.changedCount}</p><small>费率 ${item.payment.rateBefore} → ${item.payment.rateAfter} · 机构系数新增${item.payment.coefficientAddedCount}/删除${item.payment.coefficientRemovedCount}/变更${item.payment.coefficientChangedCount}</small></div><span class="badge info">已比对</span></section>`);
  const snapshotRows = (view.activationSnapshots || []).slice(0, 3).map((item) => `<section class="item"><div><h3>生效快照 · ${escapeHtml(item.packageId)}</h3><p>${item.catalogCount}条目录 · ${item.schemeCount}个方案 · ${item.parameterCount}个参数</p><small>${escapeHtml(item.activationDate)} · 摘要${escapeHtml(item.snapshotDigest.slice(0, 16))}</small></div><span class="badge info">可回退</span></section>`);
  document.querySelector("#local-package-report-list").innerHTML = [...impactRows, ...diffRows, ...snapshotRows, ...validationRows].join("") || `<p class="muted">导入后生成完整性、版本差异、影响试算和生效快照报告。</p>`;
  const jobAction = { queued: ["local-package-job-process", "处理下一批"], running: ["local-package-job-process", "继续下一批"], "retry-ready": ["local-package-job-process", "继续重试"], failed: ["local-package-job-retry", "恢复作业"] };
  document.querySelector("#local-package-job-list").innerHTML = (view.simulationJobs || []).slice(0, 8).map((item) => { const action = jobAction[item.status]; const percent = item.total ? Math.round(item.processed / item.total * 100) : 0; return `<section class="item"><div><h3>${escapeHtml(item.packageId)} · ${item.processed}/${item.total}例</h3><p>进度${percent}% · 成功${item.succeeded} · 失败${item.failed} · 每批${item.batchSize}</p><small>${item.latestEvent ? `${escapeHtml(item.latestEvent.type)}：${escapeHtml(item.latestEvent.detail)}` : "等待处理"}</small>${action ? `<div class="case-actions"><button data-payment-action="${action[0]}" data-id="${escapeHtml(item.id)}">${action[1]}</button><button class="secondary" data-payment-action="local-package-job-cancel" data-id="${escapeHtml(item.id)}">取消</button></div>` : ""}</div><span class="badge ${item.status === "completed" ? "info" : item.status === "failed" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></section>`; }).join("") || `<p class="muted">尚无批量影响试算作业。</p>`;
}

function renderFormalGroupingOperations(state) {
  const jobs = state.formalGroupingJobs || [];
  const deadLetters = state.formalGroupingDeadLetters || [];
  const pending = jobs.filter((item) => item.status !== "completed").length;
  document.querySelector("#formal-grouping-summary").textContent = `作业${jobs.length}个 · 待处理${pending}个 · 待对账死信${deadLetters.filter((item) => item.status === "pending-reconciliation").length}个`;
  const actions = { queued: ["formal-dispatch", "派发适配器"], "awaiting-receipt": ["formal-fail", "登记回执超时"], "retry-scheduled": ["formal-retry", "重新入队"], "receipt-rejected": ["formal-retry", "修复后重试"], "dead-letter": ["formal-reconcile", "对账并重开"] };
  document.querySelector("#formal-grouping-job-list").innerHTML = jobs.slice(0, 8).map((item) => {
    const action = actions[item.status];
    const latest = (item.events || []).at(-1);
    return `<section class="item"><div><h3>${escapeHtml(item.mode)}正式作业 · ${item.caseIds.length}例</h3><p>${escapeHtml(item.schemeVersion)} · 尝试${item.attemptCount}/${item.maxAttempts} · 关联号${escapeHtml(item.correlationId)}</p><small>请求摘要${escapeHtml(item.requestDigest?.slice(0, 16))}${latest ? ` · ${escapeHtml(latest.type)}：${escapeHtml(latest.detail)}` : ""}</small>${action ? `<div class="case-actions"><button data-payment-action="${action[0]}" data-id="${item.id}">${action[1]}</button></div>` : ""}</div><span class="badge ${item.status === "completed" ? "info" : item.status === "dead-letter" ? "danger" : "warn"}">${escapeHtml(item.status)}</span></section>`;
  }).join("") || `<p class="muted">创建作业后生成带病例摘要和幂等键的出站信封。</p>`;
  document.querySelector("#formal-grouping-dead-letter-list").innerHTML = deadLetters.slice(0, 8).map((item) => `<section class="item"><div><h3>死信 · ${escapeHtml(item.errorCode)}</h3><p>${escapeHtml(item.errorMessage)} · ${item.attempts}次尝试</p><small>${item.status === "resolved" ? `处置：${escapeHtml(item.resolution)}` : "待医保经办与适配器运维共同对账"}</small></div><span class="badge ${item.status === "resolved" ? "info" : "danger"}">${escapeHtml(item.status)}</span></section>`).join("") || `<p class="muted">暂无正式分组死信。</p>`;
}

async function importSample(withError) {
  const suffix = String(Date.now()).slice(-7);
  const row = { settlementListNo: `DL-BATCH-${suffix}`, institutionCode: withError ? "" : "HOSP-DEMO", institution: "区域示范医院", residentId: "r1", patientName: "脱敏患者", admissionDate: "2026-07-01", dischargeDate: "2026-07-05", principalDiagnosis: "I10", principalDiagnosisName: "原发性高血压", totalAmount: 1200, declaredFundAmount: 900, costItems: withError ? [{ itemCode: "TEST-001", itemName: "错误金额项目", amount: 1000 }] : [{ itemCode: "TEST-001", itemName: "诊疗项目", amount: 1200, catalogVersion: "2026" }] };
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
  document.querySelector("#case-list").innerHTML = `<table class="payment-table"><thead><tr><th>病例/机构</th><th>诊断</th><th>费用</th><th>分组结果</th><th>支付测算</th><th>监管</th><th>操作</th></tr></thead><tbody>${state.cases.map((item) => { const c = item.calculation || {}; const g = c.grouping || {}; const risks = c.risks || []; const hierarchy = g.mode === "DRG" && g.mdcCode ? `${g.mdcCode} → ${g.adrgCode} → ${g.groupCode} · ${g.complicationLevel}` : g.groupCode || "待分组"; return `<tr><td><strong>${escapeHtml(item.patientName)}</strong><small>${escapeHtml(item.settlementListNo)} · ${escapeHtml(item.institution)}</small></td><td>${escapeHtml(item.principalDiagnosis)} ${escapeHtml(item.principalDiagnosisName)}<small>${item.admissionDate} 至 ${item.dischargeDate}</small></td><td>${fmt(item.totalAmount)}<small>申报基金 ${fmt(item.declaredFundAmount)}</small></td><td><strong>${escapeHtml(hierarchy)}</strong><small>${escapeHtml(g.groupName || item.qualityStatus)}</small></td><td>${c.paymentStandard == null ? "待测算" : fmt(c.paymentStandard)}<small>${escapeHtml(c.formula || "")}${c.costRatio ? ` · 倍率${Number(c.costRatio).toFixed(2)}` : ""}</small></td><td><div class="risk-list">${risks.length ? risks.map((risk) => `<span class="risk-pill">${escapeHtml(risk.name)}</span>`).join("") : `<span class="ok-pill">未发现线索</span>`}</div></td><td><div class="case-actions"><button class="secondary" data-payment-action="preview-drg" data-id="${item.id}">DRG试分组</button>${item.specialCaseStatus === "未申报" ? `<button data-payment-action="special" data-id="${item.id}">特例申报</button>` : `<span>${item.specialCaseStatus}</span>`}</div></td></tr>`; }).join("")}</tbody></table>`;
}

function renderDiseaseSupervision(view) {
  const summary = view.summary || {};
  const profiles = view.profiles || [];
  document.querySelector("#supervision-boundary").textContent = view.policyBoundary || "风险线索须经人工复核";
  document.querySelector("#supervision-summary").innerHTML = [
    ["病种档案", summary.profiles || 0],
    ["风险档案", summary.riskProfiles || 0],
    ["短期重复住院", summary.repeatAdmissions || 0],
    ["跨机构重复住院", summary.crossInstitutionAdmissions || 0],
    ["编码复杂度跃升", summary.codingEscalations || 0],
    ["疑似基金影响", fmt(summary.estimatedFundImpact || 0)]
  ].map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join("");
  document.querySelector("#supervision-profile-list").innerHTML = profiles.length ? `<table class="payment-table supervision-table"><thead><tr><th>居民/病种</th><th>住院轨迹</th><th>费用与支付</th><th>监管线索</th><th>疑似影响</th></tr></thead><tbody>${profiles.map((profile) => `<tr><td><strong>${escapeHtml(profile.patientName || profile.residentId)}</strong><small>${escapeHtml(profile.diseaseCode)} · ${escapeHtml(profile.diseaseName)}</small></td><td>${profile.admissionCount}次 / ${profile.institutionCount}家机构<small>${escapeHtml(profile.firstAdmissionDate)} 至 ${escapeHtml(profile.lastDischargeDate)}</small><small>${profile.institutions.map(escapeHtml).join("、")}</small></td><td>${fmt(profile.declaredFundAmount)}<small>支付标准 ${fmt(profile.paymentStandard)} · 总费用 ${fmt(profile.totalAmount)}</small></td><td><div class="risk-list">${profile.signals.length ? profile.signals.map((signal) => `<span class="risk-pill" title="${escapeHtml(signal.basis)}">${escapeHtml(signal.name)}</span>`).join("") : `<span class="ok-pill">未发现跨次线索</span>`}</div><small>${profile.signals.slice(0, 2).map((signal) => escapeHtml(signal.basis)).join("；")}</small></td><td><strong>${fmt(profile.estimatedFundImpact)}</strong><small>${escapeHtml(profile.riskLevel)}风险 · 仅供复核</small></td></tr>`).join("")}</tbody></table>` : `<p class="muted">当前筛选范围暂无病种档案。</p>`;
}

function renderPolicy(state) {
  const p = state.policy || {}; document.querySelector("#policy-panel").innerHTML = `<div><strong>${escapeHtml(p.documentNo)}</strong><span>${escapeHtml(p.name)}</span></div><div><strong>适用范围</strong><span>住院费用DRG/DIP付费管理</span></div><div><strong>系统边界</strong><span>本平台负责协同、测算和证据留痕；正式分组、结算和拨付以医保核心系统为准。</span></div>`;
  document.querySelector("#dependency-list").innerHTML = state.externalDependencies.map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.owner)} · ${item.requiredForProduction ? "生产必需" : "可选"}</p></div><span class="badge ${item.status.includes("待") ? "warn" : "info"}">${escapeHtml(item.status)}</span></section>`).join("");
}

function renderVersions(state) { const dip = state.dip2LibraryProfile; document.querySelector("#version-list").innerHTML = `<section class="item"><div><h3>${escapeHtml(dip.name)}</h3><p>${dip.coreDiseaseGroups}组：保守治疗${dip.conservativeTreatmentGroups}组、手术操作${dip.surgeryOperationGroups}组</p><p>${escapeHtml(dip.groupingFormula)} · 相关操作费用占比≥${dip.relatedOperationCostThreshold * 100}%单独成组</p></div><span class="badge info">国家2.0版</span></section>` + [...state.schemeVersions, ...state.parameterVersions].map((item) => `<section class="item"><div><h3>${escapeHtml(item.name)}</h3><p>${escapeHtml(item.mode)} · ${escapeHtml(item.localVersion || item.rateMethod || "")} · ${escapeHtml(item.effectiveFrom)}</p></div><span class="badge ${item.status === "已发布" ? "info" : "warn"}">${escapeHtml(item.status)}</span></section>`).join(""); }
function renderSpecial(state) { document.querySelector("#special-count").textContent = `${state.specialCases.length}项`; document.querySelector("#special-list").innerHTML = state.specialCases.map((item) => `<section class="item"><div><h3>${escapeHtml(item.caseId)} · ${escapeHtml(item.reason)}</h3><p>${escapeHtml(item.requestedMethod)} · ${escapeHtml(item.submittedBy)}</p><div class="case-actions">${item.status === "待评审" ? `<button data-payment-action="review" data-id="${item.id}">评审通过</button>` : ""}</div></div><span class="badge ${item.status === "待评审" ? "warn" : "info"}">${escapeHtml(item.status)}</span></section>`).join("") || `<p class="muted">暂无特例单议申请。</p>`; }
function renderSettlements(state) { const actions = { BATCH_FROZEN: ["submit-core", "申报医保核心"], RETURNED: ["resubmit-core", "补正后重报"], CORE_ACCEPTED: ["start-reconciliation", "开始对账"], RECONCILING: ["confirm-matched", "确认账款一致"], RECONCILED: ["request-payment", "发起拨付申请"], PAYMENT_FAILED: ["retry-payment", "核验后重试拨付"], PAID: ["close", "结案"] }; document.querySelector("#settlement-count").textContent = `${state.settlementBatches.length}批`; document.querySelector("#settlement-list").innerHTML = state.settlementBatches.map((item) => { const action = actions[item.settlementState]; const waiting = item.settlementState === "CORE_SUBMITTED" ? "等待医保核心受理/退回回调" : item.settlementState === "PAYMENT_REQUESTED" ? "等待医保核心拨付回调" : ""; return `<section class="item"><div><h3>${escapeHtml(item.type)} · ${escapeHtml(item.period)}</h3><p>${item.caseCount}例 · 标准金额 ${fmt(item.standardAmount)} · 调整后 ${fmt(item.adjustedAmount)}</p><small>状态 ${escapeHtml(item.settlementState || "BATCH_FROZEN")} · 事件${(item.events || []).length}条 · 摘要${escapeHtml(item.batchDigest?.slice(0, 12) || "待生成")}${waiting ? ` · ${waiting}` : ""}</small><div class="case-actions">${action ? `<button data-payment-action="settlement-${action[0]}" data-id="${item.id}">${action[1]}</button>` : ""}</div></div><span class="badge ${["PAID", "CLOSED"].includes(item.settlementState) ? "info" : "warn"}">${escapeHtml(item.status)}</span></section>`; }).join("") || `<p class="muted">暂无结算批次。</p>`; }
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
