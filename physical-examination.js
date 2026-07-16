const PHYSICAL_EXAM_API = location.protocol === "file:" ? "" : `${location.origin}/api`;
const physicalExamState = { overview: null, residentId: "", year: "", user: null };

document.addEventListener("DOMContentLoaded", async () => {
  const user = window.HealthCityAuth?.getUser?.();
  physicalExamState.user = user;
  if (user?.role === "citizen") {
    document.querySelector("#physical-exam-import-panel")?.remove();
    document.querySelectorAll(".operations-panel").forEach((item) => item.remove());
  }
  bindPhysicalExamControls();
  seedImportDefaults();
  await loadPhysicalExams();
  renderPhysicalExamSystem();
});

async function loadPhysicalExams() {
  const params = new URLSearchParams();
  if (physicalExamState.residentId) params.set("residentId", physicalExamState.residentId);
  if (PHYSICAL_EXAM_API) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${PHYSICAL_EXAM_API}/physical-exams${params.toString() ? `?${params}` : ""}`);
      if (response.ok) {
        physicalExamState.overview = await response.json();
        return;
      }
    } catch (error) {
      // Static/demo fallback remains available.
    }
  }
  physicalExamState.overview = buildFallbackOverview();
}

function buildFallbackOverview() {
  const service = window.PhysicalExaminationService;
  const residents = [
    { id: "r1", name: "演示居民A" },
    { id: "r2", name: "演示居民B" },
    { id: "r3", name: "演示居民C" }
  ];
  const fallback = { residents, personalRecords: service.seedRecords(), chronicScreeningTasks: [], taskMessages: [], phase2FamilyDoctorContracts: [] };
  service.synchronizeCareLinks(fallback, { notify: false, actor: "static-preview" });
  return service.buildOverview(fallback, { residentId: physicalExamState.residentId });
}

function renderPhysicalExamSystem() {
  const overview = physicalExamState.overview || buildFallbackOverview();
  renderPhysicalExamSummary(overview.summary || {});
  renderPhysicalExamHighlights(overview.highlights || {});
  renderSourceContracts(overview.sourceContracts || []);
  renderStandards(overview.standards || window.PhysicalExaminationStandards?.STANDARD_CATALOG || []);
  renderQualityIndicators(overview.qualityIndicators || []);
  renderPhysicalExamFilters(overview);
  renderPhysicalExamReports(overview.reports || []);
  renderProductionReadiness(overview.readiness);
  renderAbnormalCases(overview.abnormalCases || []);
  renderJointTests(overview.jointTests || []);
  renderGatewayEvents(overview.gatewayEvents || []);
  populateImportResidents(overview.residents || []);
}

function renderPhysicalExamSummary(summary) {
  const cards = [
    ["历史报告", summary.reports || 0, "全部年份统一归档"],
    ["覆盖居民", summary.residents || 0, "按居民主索引合并"],
    ["接入机构", summary.institutions || 0, "体检中心与医院"],
    ["异常报告", summary.abnormalReports || 0, "保留异常项和建议"],
    ["历史跨度", summary.years || 0, "可按年度连续查看"],
    ["档案同步", summary.synced || 0, "已写入健康档案"],
    ["电子签章", `${summary.signedReports || 0}/${summary.reports || 0}`, "报告签章核验"],
    ["字典映射", `${summary.mappingRate ?? 100}%`, "标准项目编码"],
    ["国标数据元", `${summary.nationalMappingRate ?? 0}%`, "WS/T 363-2023"],
    ["规范合规", `${summary.standardCompliantReports || 0}/${summary.reports || 0}`, "逐报告生产门禁"],
    ["慢病分层", `${summary.careLinkedReports || 0}/${summary.abnormalReports || 0}`, "体检异常自动入层"],
    ["家医建议", summary.familyDoctorSuggestions || 0, "不替代居民签约同意"],
    ["居民待办", summary.residentRiskTasks || 0, "复测、复诊与确认"],
    ["待闭环", summary.openAbnormalCases || 0, "异常随访任务"],
    ["死信事件", summary.deadLetters || 0, "需补偿的接入事件"]
  ];
  document.querySelector("#physical-exam-summary").innerHTML = cards.map(([label, value, hint]) => `<article class="metric-card"><span>${escapeExamHtml(label)}</span><strong>${escapeExamHtml(value)}</strong><small>${escapeExamHtml(hint)}</small></article>`).join("");
}

function renderPhysicalExamHighlights(highlights) {
  const summary = highlights.summary || {};
  const summaryTarget = document.querySelector("#physical-exam-highlight-summary");
  if (summaryTarget) {
    const cards = [
      ["健康轨迹", summary.trajectories || 0, "跨年度可计算指标"],
      ["居民解释", summary.translatedFindings || 0, "专业报告分层翻译"],
      ["行动卡", summary.openActions || 0, "异常到复查/家医"],
      ["重复候选", summary.repeatCandidates || 0, "医师判断能否互认"],
      ["放射记录", summary.radiationRecords || 0, "正当化与剂量台账"],
      ["质量问题", summary.qualityIssues || 0, "报告啄木鸟发现"],
      ["健康护照", summary.activePassports || 0, "居民授权的数据范围"]
    ];
    summaryTarget.innerHTML = cards.map(([name, value, detail]) => `<article><span>${escapeExamHtml(name)}</span><strong>${escapeExamHtml(value)}</strong><small>${escapeExamHtml(detail)}</small></article>`).join("");
  }
  renderHighlightTrajectories(highlights.trajectories || []);
  renderHighlightTranslations(highlights.translations || []);
  renderHighlightPlans(highlights.examPlans || []);
  renderRepeatRadiation(highlights.repeatAvoidance || [], highlights.radiationLedger || []);
  renderQualityReviews(highlights.qualityReviews || []);
  renderInstitutionBenchmarks(highlights.institutionBenchmarks || []);
  renderCityRadar(highlights.cityRadar || []);
  renderStandardsImpact(highlights.standardsImpact || []);
  renderCriticalPaths(highlights.criticalPaths || []);
}

function renderHighlightTrajectories(rows) {
  const target = document.querySelector("#physical-exam-trajectories");
  if (!target) return;
  target.innerHTML = rows.slice(0, 12).map((item) => {
    const values = (item.points || []).map((point) => Number(point.value)).filter(Number.isFinite);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(1, max - min);
    const bars = (item.points || []).map((point) => `<span title="${escapeExamHtml(`${point.date} ${point.value}${point.unit || ""}`)}" style="height:${24 + ((Number(point.value) - min) / range) * 42}px" class="${point.abnormal ? "warn" : "ok"}"></span>`).join("");
    return `<article class="trajectory-card"><div><strong>${escapeExamHtml(item.name)}</strong><small>${escapeExamHtml(item.latest ? `${item.latest.value}${item.latest.unit || ""}` : "-")} · ${escapeExamHtml(item.evidenceLevel)}</small></div><div class="mini-bars">${bars}</div><em>${item.delta === null ? "建立基线" : `较上次 ${item.delta > 0 ? "+" : ""}${escapeExamHtml(item.delta)}`}</em></article>`;
  }).join("") || `<p class="muted">接入至少一份含结构化数值的报告后生成健康时间轴。</p>`;
}

function renderHighlightTranslations(rows) {
  const target = document.querySelector("#physical-exam-translations");
  if (!target) return;
  const prioritized = [...rows].sort((a, b) => Number(b.status !== "within-report-range") - Number(a.status !== "within-report-range"));
  target.innerHTML = prioritized.slice(0, 8).map((item) => `<article class="translation-card ${item.status}"><header><strong>${escapeExamHtml(item.title)}</strong><span>${escapeExamHtml(item.value)}</span></header><p>${escapeExamHtml(item.plainMeaning)}</p><small>下一步：${escapeExamHtml(item.nextStep)} · ${escapeExamHtml(item.department)}</small><em>${escapeExamHtml(item.boundary)}</em></article>`).join("") || `<p class="muted">暂无可翻译的结构化项目。</p>`;
}

function renderHighlightPlans(rows) {
  const target = document.querySelector("#physical-exam-plans");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article class="plan-card"><header><strong>${escapeExamHtml(item.nextExamDate || "下次日期待医师确认")}</strong><span>医师待审核</span></header><p>${escapeExamHtml(item.reason)}</p><div class="tag-row">${(item.personalizedItems || []).map((value) => `<span>${escapeExamHtml(value)}</span>`).join("") || "<span>保持基础体检项目</span>"}</div>${(item.reduceOrReview || []).map((value) => `<small>${escapeExamHtml(value)}</small>`).join("")}<em>${escapeExamHtml(item.ruleVersion)}</em></article>`).join("") || `<p class="muted">暂无居民体检计划。</p>`;
}

function renderRepeatRadiation(repeats, radiation) {
  const target = document.querySelector("#physical-exam-repeat-radiation");
  if (!target) return;
  const repeatHtml = repeats.map((item) => `<article><strong>重复检查候选 · ${escapeExamHtml(item.name || item.code)}</strong><p>${escapeExamHtml(item.previousDate)} 至 ${escapeExamHtml(item.date)}，间隔 ${escapeExamHtml(item.intervalDays)} 天</p><small>${escapeExamHtml(item.recommendation)}</small></article>`).join("") || `<article class="ok-card"><strong>未发现30天内重复项目</strong><p>继续在接入新报告时自动检查。</p></article>`;
  const radiationHtml = radiation.map((item) => `<article><strong>${escapeExamHtml(item.modality)} · ${escapeExamHtml(item.date)}</strong><p>${escapeExamHtml(item.purpose || "检查目的待补")} · ${escapeExamHtml(item.dose ?? "-")}${escapeExamHtml(item.doseUnit || "")}</p><small>${item.governanceStatus === "complete" ? "正当化、告知、防护与剂量记录完整" : "放射治理记录待复核"}</small></article>`).join("") || `<article class="ok-card"><strong>暂无放射剂量记录</strong><p>不是“零辐射”结论，仅表示当前接入数据无记录。</p></article>`;
  target.innerHTML = repeatHtml + radiationHtml;
}

function renderQualityReviews(rows) {
  const target = document.querySelector("#physical-exam-quality-reviews");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article class="quality-review-card ${item.status}"><header><strong>${escapeExamHtml(item.institution)}</strong><span>${escapeExamHtml(item.score)}分</span></header><p>${escapeExamHtml(item.reportId)} · ${escapeExamHtml(item.date)}</p><div>${(item.issues || []).slice(0, 5).map((issue) => `<span class="issue ${issue.level}">${escapeExamHtml(issue.message)}</span>`).join("") || `<span class="issue passed">自动检查未发现结构缺口</span>`}</div></article>`).join("") || `<p class="muted">暂无报告质检结果。</p>`;
}

function renderInstitutionBenchmarks(rows) {
  const target = document.querySelector("#physical-exam-benchmarks");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article><strong>${escapeExamHtml(item.institutionName)}</strong><p>报告 ${escapeExamHtml(item.reports)} · 异常任务 ${escapeExamHtml(item.abnormalCases)}</p><small>通知率 ${item.notificationRate === null ? "暂无分母" : `${escapeExamHtml(item.notificationRate)}%`} · 随访率 ${item.followupRate === null ? "暂无分母" : `${escapeExamHtml(item.followupRate)}%`}</small><em>${item.comparisonStatus === "sample-too-small" ? "样本不足，不排名" : "需完成风险校正后比较"}</em></article>`).join("") || `<p class="muted">暂无机构质量画像。</p>`;
}

function renderCityRadar(rows) {
  const target = document.querySelector("#physical-exam-city-radar");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article><strong>${escapeExamHtml(item.name)}</strong><p>异常报告 ${escapeExamHtml(item.abnormalReports)} · 来源机构 ${escapeExamHtml(item.institutionCount)}</p><small>${escapeExamHtml(item.message)}</small><em>${escapeExamHtml(item.privacyStatus)}</em></article>`).join("") || `<p class="muted">暂无可聚合异常趋势。</p>`;
}

function renderStandardsImpact(rows) {
  const target = document.querySelector("#physical-exam-standards-impact");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article><strong>${escapeExamHtml(item.code)} · ${escapeExamHtml(item.affectedReports)}份</strong><div class="tag-row">${(item.affectedLayers || []).map((layer) => `<span>${escapeExamHtml(layer)}</span>`).join("")}</div><small>${escapeExamHtml(item.nextAction)}</small></article>`).join("") || `<p class="muted">当前没有规范影响项。</p>`;
}

function renderCriticalPaths(rows) {
  const target = document.querySelector("#physical-exam-critical-paths");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article class="critical-path-card ${item.overdue ? "overdue" : ""}"><header><strong>${item.classification === "high-risk" ? "高危异常" : "重要异常"}</strong><span>${escapeExamHtml(item.status)}</span></header><div class="critical-steps">${(item.steps || []).map((step) => `<span class="${step.completed ? "done" : "pending"}">${step.completed ? "✓" : "○"} ${escapeExamHtml(step.name)}</span>`).join("")}</div><small>时限 ${escapeExamHtml(item.dueAt || "待确定")} · ${escapeExamHtml(item.escalation)}</small></article>`).join("") || `<p class="muted">暂无重要异常生命通道任务。</p>`;
}

function renderProductionReadiness(readiness) {
  const target = document.querySelector("#physical-exam-readiness");
  if (!target) return;
  const status = document.querySelector("#physical-exam-readiness-status");
  if (!readiness) {
    target.innerHTML = `<p class="muted">静态预览不判定生产门禁，启动服务后读取真实环境配置。</p>`;
    return;
  }
  const cards = [
    ["代码能力", readiness.codeReady ? "已就绪" : "未就绪", "接口、归档、闭环与审计"],
    ["签名网关", readiness.gateway?.secretConfigured ? "已配置" : "待配置", readiness.gateway?.signatureAlgorithm || "HMAC-SHA256"],
    ["原件存储", readiness.storage?.adapterReady ? "已配置" : "待配置", "校验和、扫描、15年留存"],
    ["报告质量", readiness.quality?.standardsReady ? "通过" : "待治理", `国标 ${readiness.quality?.nationalMappingRate ?? 0}% · 合规 ${readiness.quality?.standardCompliantReports || 0}/${readiness.quality?.reports || 0}`],
    ["现场验收", readiness.siteAcceptance?.ready ? "已签署" : "待签署", `${readiness.siteAcceptance?.signed || 0}/${readiness.siteAcceptance?.jointTests || 0} 家机构`]
  ];
  target.innerHTML = cards.map(([label, value, hint]) => `<article class="readiness-card"><span>${escapeExamHtml(label)}</span><strong>${escapeExamHtml(value)}</strong><small>${escapeExamHtml(hint)}</small></article>`).join("");
  const ready = readiness.goLiveReady === true;
  status.textContent = ready ? "可上线" : "上线阻断";
  status.className = `status-chip ${ready ? "ok" : "warn"}`;
  const blockers = document.querySelector("#physical-exam-blockers");
  blockers.innerHTML = (readiness.blockers || []).map((item) => `<span>阻断 · ${escapeExamHtml(item)}</span>`).join("") || `<span class="ok-line">所有上线门禁已通过</span>`;
}

function renderAbnormalCases(cases) {
  const target = document.querySelector("#physical-exam-abnormal-cases");
  if (!target) return;
  target.innerHTML = cases.map((item) => `<article class="workflow-card">
    <header><strong>${escapeExamHtml(item.findingCodes?.join("、") || "异常项目")}</strong><span class="status-chip ${item.status === "closed" ? "ok" : "warn"}">${escapeExamHtml(item.classification === "high-risk" ? "高危异常" : "重要异常")} · ${escapeExamHtml(item.status)}</span></header>
    <p>${escapeExamHtml(item.latestAction || "待处置")}</p><small>负责人：${escapeExamHtml(item.owner || "待分派")} · 时限：${escapeExamHtml(item.dueAt || "待确定")}</small>
    <div class="inline-actions"><button type="button" data-case-id="${escapeExamHtml(item.id)}" data-case-action="confirm">确认异常</button><button type="button" data-case-id="${escapeExamHtml(item.id)}" data-case-action="notify">通知居民</button><button type="button" data-case-id="${escapeExamHtml(item.id)}" data-case-action="schedule">安排复查</button><button type="button" data-case-id="${escapeExamHtml(item.id)}" data-case-action="followup">记录随访</button><button type="button" data-case-id="${escapeExamHtml(item.id)}" data-case-action="close">关闭</button></div>
  </article>`).join("") || `<p class="muted">当前没有待处置的异常报告。</p>`;
}

function renderJointTests(rows) {
  const target = document.querySelector("#physical-exam-joint-tests");
  if (!target) return;
  target.innerHTML = rows.map((item) => `<article class="workflow-card" data-joint-test="${escapeExamHtml(item.id)}">
    <header><strong>${escapeExamHtml(item.institutionName)}</strong><span class="status-chip ${item.siteSignoff ? "ok" : "warn"}">${item.siteSignoff ? "已签署" : "待现场验收"}</span></header>
    <ul class="check-list">${(item.checks || []).map((check) => `<li><span>${escapeExamHtml(check.name)}</span><em>${escapeExamHtml(check.status)}</em>${check.status !== "site-passed" && check.status !== "not-applicable" ? `<button type="button" data-joint-check="${escapeExamHtml(check.id)}">现场通过</button>` : ""}</li>`).join("")}</ul>
    <label class="evidence-field">验收证据编号或附件引用<input data-joint-evidence placeholder="例如 UAT-${escapeExamHtml(item.sourceType)}-001" /></label>
    <button class="text-action" type="button" data-joint-signoff>签署上线确认</button>
  </article>`).join("") || `<p class="muted">暂无机构联调记录。</p>`;
}

function renderGatewayEvents(events) {
  const target = document.querySelector("#physical-exam-gateway-events");
  if (!target) return;
  target.innerHTML = events.map((item) => `<article><strong>${escapeExamHtml(item.externalId || item.id)}</strong><span>${escapeExamHtml(item.status)}</span><small>${escapeExamHtml(item.receivedAt || "")} · 重试 ${escapeExamHtml(item.retryCount || 0)} 次${item.deadLetter ? ` · ${escapeExamHtml(item.deadLetterReason)}` : ""}</small></article>`).join("") || `<p class="muted">暂无签名网关接入事件。</p>`;
}

function renderSourceContracts(contracts) {
  document.querySelector("#physical-exam-contracts").innerHTML = contracts.map((item) => `<article class="contract-card">
    <header><div><h3>${escapeExamHtml(item.name)}</h3><small>${escapeExamHtml((item.systems || []).join(" / "))}</small></div><span class="status-chip ok">可联调</span></header>
    <p>${escapeExamHtml(item.transport)} · ${escapeExamHtml(item.identity)}</p>
    <div class="contract-fields">必填：${escapeExamHtml((item.required || []).join("、"))}</div>
  </article>`).join("");
}

function renderStandards(standards) {
  const target = document.querySelector("#physical-exam-standards");
  if (!target) return;
  target.innerHTML = standards.map((item) => `<article class="contract-card">
    <header><div><h3>${escapeExamHtml(item.code)}</h3><small>${escapeExamHtml(item.level)} · ${escapeExamHtml(item.status)}</small></div><span class="status-chip ${item.mandatory ? "warn" : "ok"}">${item.mandatory ? "强制依据" : "标准依据"}</span></header>
    <p>${escapeExamHtml(item.name)}</p>
    <a class="text-action" href="${escapeExamHtml(item.source)}" target="_blank" rel="noreferrer">查看官方文件</a>
  </article>`).join("");
}

function renderQualityIndicators(indicators) {
  const target = document.querySelector("#physical-exam-quality-indicators");
  if (!target) return;
  target.innerHTML = indicators.map((item) => `<article class="readiness-card"><span>${escapeExamHtml(item.code)}</span><strong>${!item.collectable ? "待采集" : item.value === null ? "暂无分母" : `${escapeExamHtml(item.value)}${escapeExamHtml(item.unit)}`}</strong><small>${escapeExamHtml(item.name)} · ${escapeExamHtml(item.numerator || 0)}/${escapeExamHtml(item.denominator || 0)}</small></article>`).join("");
}

function renderPhysicalExamFilters(overview) {
  const residentSelect = document.querySelector("#physical-exam-resident-filter");
  const residentOptions = [`<option value="">全部可授权居民</option>`].concat((overview.residents || []).map((item) => `<option value="${escapeExamHtml(item.id)}">${escapeExamHtml(item.name)}</option>`));
  residentSelect.innerHTML = residentOptions.join("");
  residentSelect.value = physicalExamState.residentId;
  const yearSelect = document.querySelector("#physical-exam-year-filter");
  yearSelect.innerHTML = [`<option value="">全部年度</option>`].concat((overview.years || []).map((year) => `<option value="${escapeExamHtml(year)}">${escapeExamHtml(year)} 年</option>`)).join("");
  yearSelect.value = physicalExamState.year;
}

function renderPhysicalExamReports(reports) {
  const visible = reports.filter((item) => !physicalExamState.year || String(item.date || "").startsWith(physicalExamState.year));
  document.querySelector("#physical-exam-report-summary").textContent = `已从健康档案同步 ${visible.length} 份报告`;
  document.querySelector("#physical-exam-report-list").innerHTML = visible.map((item) => {
    const [year, month, day] = String(item.date || "---- -- --").split("-");
    const abnormal = Number(item.meta?.abnormalCount || 0);
    return `<article class="report-card">
      <div class="report-date"><strong>${escapeExamHtml(year)}</strong><span>${escapeExamHtml(`${month || "--"}-${day || "--"}`)}</span></div>
      <div><h3>${escapeExamHtml(item.name)}</h3><p>${escapeExamHtml(item.result)}</p><small>${escapeExamHtml(item.source)} · 报告号 ${escapeExamHtml(item.meta?.reportNo || item.meta?.externalId || "已归档")}</small></div>
      <div class="report-actions"><span class="status-chip ${abnormal ? "warn" : "ok"}">${abnormal ? `${abnormal} 项异常` : "未标记异常"}</span><button class="text-action" type="button" data-report-id="${escapeExamHtml(item.id)}">查看报告</button></div>
    </article>`;
  }).join("") || `<p class="muted">当前筛选条件下暂无体检报告。</p>`;
}

function populateImportResidents(residents) {
  const select = document.querySelector("#physical-exam-import-form select[name='residentId']");
  if (!select) return;
  select.innerHTML = residents.map((item) => `<option value="${escapeExamHtml(item.id)}">${escapeExamHtml(item.name)} · ${escapeExamHtml(item.id)}</option>`).join("");
}

function bindPhysicalExamControls() {
  document.querySelector("#physical-exam-resident-filter")?.addEventListener("change", async (event) => {
    physicalExamState.residentId = event.target.value;
    physicalExamState.year = "";
    await loadPhysicalExams();
    renderPhysicalExamSystem();
  });
  document.querySelector("#physical-exam-year-filter")?.addEventListener("change", (event) => {
    physicalExamState.year = event.target.value;
    renderPhysicalExamReports(physicalExamState.overview?.reports || []);
  });
  document.querySelector("#physical-exam-refresh")?.addEventListener("click", async () => {
    await loadPhysicalExams();
    renderPhysicalExamSystem();
    showPhysicalExamToast("体检报告已与健康档案重新同步");
  });
  document.querySelector("#physical-exam-import-form")?.addEventListener("submit", submitPhysicalExamImport);
  document.querySelector("#physical-exam-report-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-report-id]");
    if (button) showPhysicalExamDetail(button.dataset.reportId);
  });
  document.querySelector("#physical-exam-abnormal-cases")?.addEventListener("click", handleAbnormalCaseAction);
  document.querySelector("#physical-exam-joint-tests")?.addEventListener("click", handleJointTestAction);
  document.querySelector("#physical-exam-detail")?.addEventListener("click", handleAttachmentLink);
  document.querySelector("[data-close-report]")?.addEventListener("click", () => document.querySelector("#physical-exam-detail-dialog")?.close());
}

async function handleAbnormalCaseAction(event) {
  const button = event.target.closest("[data-case-action]");
  if (!button) return;
  const labels = { confirm: "医师已确认重要异常结果及分级", notify: "已向居民发送异常项目随访提醒", schedule: "已安排复查并进入任务队列", followup: "已回收后续诊疗情况并完成随访记录", close: "确认、通知和随访证据完整，异常处置已闭环" };
  button.disabled = true;
  try {
    await postPhysicalExamAction(`/physical-exams/abnormal-cases/${encodeURIComponent(button.dataset.caseId)}/actions`, { action: button.dataset.caseAction, note: labels[button.dataset.caseAction] });
    await refreshPhysicalExamWorkbench("异常处置状态已更新");
  } catch (error) {
    showPhysicalExamToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleJointTestAction(event) {
  const card = event.target.closest("[data-joint-test]");
  if (!card) return;
  const evidenceRef = card.querySelector("[data-joint-evidence]")?.value.trim();
  if (!evidenceRef) {
    showPhysicalExamToast("请先填写真实验收证据编号或附件引用");
    return;
  }
  const checkButton = event.target.closest("[data-joint-check]");
  const signoffButton = event.target.closest("[data-joint-signoff]");
  if (!checkButton && !signoffButton) return;
  const payload = checkButton
    ? { action: "update-check", checkId: checkButton.dataset.jointCheck, status: "site-passed", note: "现场联调验证通过", evidenceRef }
    : { action: "signoff", note: "机构现场验收完成并签署上线确认", evidenceRef };
  const button = checkButton || signoffButton;
  button.disabled = true;
  try {
    await postPhysicalExamAction(`/physical-exams/joint-tests/${encodeURIComponent(card.dataset.jointTest)}/actions`, payload);
    await refreshPhysicalExamWorkbench(checkButton ? "联调检查项已留证" : "机构上线确认已签署");
  } catch (error) {
    showPhysicalExamToast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleAttachmentLink(event) {
  const button = event.target.closest("[data-link-attachment]");
  if (!button) return;
  const input = document.querySelector("#physical-exam-attachment-id");
  const attachmentId = input?.value.trim();
  if (!attachmentId) {
    showPhysicalExamToast("请填写已完成扫描的安全附件 ID");
    return;
  }
  try {
    await postPhysicalExamAction(`/physical-exams/${encodeURIComponent(button.dataset.linkAttachment)}/link-attachment`, { attachmentId });
    document.querySelector("#physical-exam-detail-dialog")?.close();
    await refreshPhysicalExamWorkbench("原始体检报告已安全归档关联");
  } catch (error) {
    showPhysicalExamToast(error.message);
  }
}

async function postPhysicalExamAction(path, payload) {
  if (!PHYSICAL_EXAM_API) throw new Error("静态预览不执行写入操作");
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${PHYSICAL_EXAM_API}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.message || `操作失败：${response.status}`);
  return result;
}

async function refreshPhysicalExamWorkbench(message) {
  await loadPhysicalExams();
  renderPhysicalExamSystem();
  showPhysicalExamToast(message);
}

function seedImportDefaults() {
  const form = document.querySelector("#physical-exam-import-form");
  if (!form) return;
  const token = Date.now().toString().slice(-8);
  form.elements.externalId.value = `DEMO-PE-${token}`;
  form.elements.reportNo.value = `TJ${token}`;
  form.elements.examDate.value = new Date().toISOString().slice(0, 10);
}

async function submitPhysicalExamImport(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const itemCodes = { "血压": "BP", "空腹血糖": "GLU", "糖化血红蛋白": "HBA1C", "体质指数": "BMI", "肌酐": "CRE", "心电图": "ECG" };
  const findings = String(values.abnormalFindings || "").split("\n").map((line) => line.trim()).filter(Boolean).map((line, index) => {
    const [name, value, unit] = line.split("|").map((part) => part.trim());
    return { code: itemCodes[name] || `MANUAL-${index + 1}`, name, value, unit, abnormal: true, status: "异常" };
  });
  const token = String(values.reportNo || values.externalId || Date.now());
  const payload = {
    ...values,
    findings,
    recommendations: String(values.recommendations || "").split("\n").filter(Boolean),
    signature: { standardCode: "WS/T 847-2024", status: "verified", mode: "demo", asymmetricAlgorithm: "SM2 demo", digestAlgorithm: "SM3 demo", format: "ES-T XML demo", signatureNo: `DEMO-${token}`, signer: "接入演示总检医师", signedAt: new Date().toISOString(), certificateSerial: "DEMO-CERT", certificateChainVerified: true, revocationStatusVerified: true, timestamp: new Date().toISOString(), timestampVerified: true, digestValue: "demo-digest", signatureValueRef: `demo://${token}`, verifiedAt: new Date().toISOString() }
  };
  delete payload.abnormalFindings;
  const resultTarget = document.querySelector("#physical-exam-import-result");
  if (!PHYSICAL_EXAM_API) {
    resultTarget.textContent = "静态预览不执行写入；启动本地服务后可验证接入与幂等去重。";
    return;
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${PHYSICAL_EXAM_API}/physical-exams/import`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || `接入失败：${response.status}`);
    resultTarget.textContent = result.imported ? `已接入 ${result.imported} 份报告并同步健康档案。` : `检测到 ${result.duplicates} 份重复报告，未重复归档。`;
    physicalExamState.residentId = values.residentId;
    await loadPhysicalExams();
    renderPhysicalExamSystem();
    seedImportDefaults();
  } catch (error) {
    resultTarget.textContent = error.message;
  }
}

function showPhysicalExamDetail(id) {
  const report = physicalExamState.overview?.reports?.find((item) => item.id === id);
  if (!report) return;
  const findings = report.meta?.findings || [];
  const recommendations = report.meta?.recommendations || [];
  const signature = report.meta?.signature || {};
  const compliance = report.meta?.standardCompliance || { compliant: false, gaps: ["未执行规范核验"] };
  const careLinkage = report.meta?.careLinkage;
  const qualification = report.meta?.institutionQualification || {};
  const sectionSignatures = report.meta?.sectionSignatures || [];
  const questionnaire = report.meta?.healthQuestionnaire || {};
  const radiationExaminations = report.meta?.radiationExaminations || [];
  const canOperate = ["commission", "institution"].includes(physicalExamState.user?.role);
  document.querySelector("#physical-exam-detail").innerHTML = `<h3>${escapeExamHtml(report.name)}</h3>
    <p>${escapeExamHtml(report.residentName)} · ${escapeExamHtml(report.date)} · ${escapeExamHtml(report.source)}</p>
    <p>${escapeExamHtml(report.result)}</p>
    <table class="finding-table"><thead><tr><th>项目</th><th>结果</th><th>参考</th><th>标准映射</th><th>判定</th></tr></thead><tbody>${findings.map((item) => `<tr class="${item.abnormal ? "abnormal" : ""}"><td>${escapeExamHtml(item.name)}</td><td>${escapeExamHtml(`${item.value}${item.unit || ""}`)}</td><td>${escapeExamHtml(item.reference || "-")}</td><td>${escapeExamHtml(item.standard || item.mappingStatus || "待映射")}</td><td>${item.abnormal ? "异常" : "正常/未标记"}</td></tr>`).join("")}</tbody></table>
    <h4>健康建议</h4><ul>${recommendations.map((item) => `<li>${escapeExamHtml(item)}</li>`).join("") || "<li>遵医嘱保持定期体检</li>"}</ul>
    <div class="report-proof"><span>电子签章</span><strong>${signature.status === "verified" ? "核验通过" : "待核验"}</strong><small>${escapeExamHtml(signature.algorithm || "-")} · ${escapeExamHtml(signature.signatureNo || "无签章号")}</small></div>
    <div class="report-proof"><span>规范门禁</span><strong>${compliance.compliant ? "生产合规" : "未达生产合规"}</strong><small>${escapeExamHtml(compliance.compliant ? `${compliance.passed}/${compliance.total} 项通过` : `缺口：${(compliance.gaps || []).join("、")}`)}</small></div>
    <div class="report-proof"><span>分项与主检签署</span><strong>${escapeExamHtml(`${sectionSignatures.length} 个分项 · ${qualification.signerProfessionalTitle || "主检资质待核"}`)}</strong><small>${escapeExamHtml(sectionSignatures.map((item) => `${item.sectionId}:${item.physicianName || item.physicianId}`).join("；") || "分项医师签名待接入")}</small></div>
    <div class="report-proof"><span>健康问卷</span><strong>${window.PhysicalExaminationStandards?.questionnaireComplete?.(questionnaire) ? "已完成" : "待补齐"}</strong><small>基本信息、健康史、生活方式、心理健康</small></div>
    ${radiationExaminations.length ? `<div class="report-proof"><span>放射检查治理</span><strong>${escapeExamHtml(`${radiationExaminations.length} 项已记录`)}</strong><small>${escapeExamHtml(radiationExaminations.map((item) => `${item.modality} ${item.dose ?? "-"}${item.doseUnit || ""}`).join("；"))}</small></div>` : ""}
    ${careLinkage ? `<div class="report-proof"><span>慢病与家医联动</span><strong>${escapeExamHtml(careLinkage.riskLevel)} · 已生成居民待办</strong><small>${escapeExamHtml(careLinkage.familyDoctorSuggestion?.suggestion || "家庭医生复核") } · ${escapeExamHtml(careLinkage.dueAt || "尽快处理")}</small></div>` : ""}
    <div class="report-proof"><span>原报告归档</span><strong>${report.attachment ? "安全附件已关联" : "待关联"}</strong><small>${escapeExamHtml(report.attachment?.filename || "需经校验和与恶意文件扫描后关联")}</small></div>
    ${canOperate && !report.attachment ? `<div class="attachment-link"><label>安全附件 ID<input id="physical-exam-attachment-id" placeholder="att-..." /></label><button class="text-action" type="button" data-link-attachment="${escapeExamHtml(report.id)}">关联原报告</button></div>` : ""}
    <p class="muted">来源标识：${escapeExamHtml(report.meta?.externalId)} · 标准版本：${escapeExamHtml(report.meta?.standardVersion)} · 质量：${escapeExamHtml(report.meta?.qualityStatus || "待核验")}</p>`;
  document.querySelector("#physical-exam-detail-dialog")?.showModal();
}

function showPhysicalExamToast(message) {
  const toast = document.querySelector("#physical-exam-toast");
  toast.textContent = message;
  toast.style.display = "block";
  setTimeout(() => { toast.style.display = "none"; }, 2200);
}

function escapeExamHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}
