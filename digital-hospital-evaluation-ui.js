const DIGITAL_EVALUATION_ENDPOINTS = {
  catalog: "/api/digital-hospital/evaluation-catalog",
  pilot: "/api/digital-hospital/pilot-readiness",
  collection: "/api/digital-hospital/collection-jobs",
  evidence: "/api/digital-hospital/evaluation-evidence",
  preassessments: "/api/digital-hospital/pre-assessments"
};

const digitalEvaluationState = { catalog: null, board: null, user: window.HealthCityAuth?.getUser?.() || null };
const escapeHtml = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
const setHtml = (id, html) => { const element = document.getElementById(id); if (element) element.innerHTML = html; };
const authFetch = (...args) => (window.HealthCityAuth?.authFetch || fetch)(...args);

async function jsonRequest(url, options = {}) {
  const response = await authFetch(url, { ...options, headers: { "Content-Type": "application/json", ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || `请求失败（${response.status}）`);
  return payload;
}

function renderMetrics() {
  const summary = digitalEvaluationState.board?.summary || {};
  const metrics = [
    ["评价规则包", summary.packs || 0, "电子病历、智慧服务、智慧管理、互联互通"],
    ["评价项目", summary.projects || 0, "条款级可计算项目"],
    ["采集适配器", summary.collectionJobs || 0, "六类医院系统受控采集"],
    ["预评批次", summary.preAssessments || 0, "建设预评与整改留痕"],
    ["开放整改", summary.openFindings || 0, "P0/P1差距项"],
    ["试点状态", digitalEvaluationState.board?.functionalState || "待加载", digitalEvaluationState.board?.formalGoLiveState || ""]
  ];
  setHtml("digital-evaluation-metrics", metrics.map(([label, value, hint]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(hint)}</small></article>`).join(""));
}

function renderCatalog() {
  const catalog = digitalEvaluationState.catalog || {};
  const packFilter = document.getElementById("digital-evaluation-pack-filter");
  if (packFilter && packFilter.options.length === 1) catalog.packs?.forEach((pack) => packFilter.add(new Option(`${pack.name}（${pack.projects}项）`, pack.id)));
  const profileSelect = document.getElementById("digital-evaluation-profile-id");
  if (profileSelect && !profileSelect.options.length) catalog.profiles?.forEach((profile) => profileSelect.add(new Option(profile.name, profile.id)));
  const packId = packFilter?.value || "";
  const query = String(document.getElementById("digital-evaluation-project-search")?.value || "").trim().toLowerCase();
  const projects = (catalog.projects || []).filter((item) => (!packId || item.packId === packId) && (!query || `${item.category} ${item.title} ${item.code}`.toLowerCase().includes(query)));
  setHtml("digital-evaluation-catalog", `<div class="evaluation-pack-grid">${(catalog.packs || []).map((pack) => `<div class="evaluation-pack"><strong>${escapeHtml(pack.name)}</strong><span>${pack.projects} 项 / 目标 ${escapeHtml(pack.pilotTarget)}级</span><small>${escapeHtml(pack.sourceId)}</small></div>`).join("")}</div><table><thead><tr><th>体系/编码</th><th>角色或维度</th><th>评价项目</th><th>最低等级</th><th>项目类型</th></tr></thead><tbody>${projects.map((item) => `<tr><td>${escapeHtml(item.packId)}<br><small>${escapeHtml(item.code)}</small></td><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.minLevel)}</td><td>${item.itemType === "basic" ? "基本项" : "选择项"}</td></tr>`).join("")}</tbody></table>`);
}

function renderCollectionJobs() {
  const jobs = digitalEvaluationState.board?.jobs || [];
  setHtml("digital-evaluation-collection-jobs", `<table><thead><tr><th>来源系统</th><th>采集范围</th><th>契约</th><th>样本质量</th><th>状态</th></tr></thead><tbody>${jobs.map((item) => `<tr><td><strong>${escapeHtml(item.system)}</strong></td><td>${escapeHtml((item.scopes || []).join("、"))}</td><td>${escapeHtml(item.contractId)}</td><td>${escapeHtml(item.validRows)}/${escapeHtml(item.sampleSize)}<br><small>${escapeHtml(item.receiptRef)}</small></td><td><span class="badge info">${escapeHtml(item.status)}</span></td></tr>`).join("")}</tbody></table>`);
  const select = document.getElementById("digital-evaluation-job-id");
  if (select) select.innerHTML = jobs.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.system)} / ${escapeHtml(item.contractId)}</option>`).join("");
}

function renderEvidence() {
  const evidence = digitalEvaluationState.board?.evidence || [];
  setHtml("digital-evaluation-evidence", `<table><thead><tr><th>证据项</th><th>级别</th><th>引用与摘要</th><th>状态</th></tr></thead><tbody>${evidence.map((item) => `<tr><td>${escapeHtml(item.title)}</td><td>${escapeHtml(item.evidenceLevel)}</td><td>${escapeHtml(item.evidenceRef || "待登记")}<br><small>${escapeHtml(item.sha256 ? item.sha256.slice(0, 16) : "无摘要")}</small></td><td><span class="badge ${item.status === "verified" ? "info" : "warn"}">${escapeHtml(item.status)}</span></td></tr>`).join("")}</tbody></table>`);
  const select = document.getElementById("digital-evaluation-evidence-id");
  if (select) select.innerHTML = evidence.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.title)}</option>`).join("");
}

function selectedAssessment() {
  const id = document.getElementById("digital-evaluation-assessment-id")?.value;
  const rows = digitalEvaluationState.board?.preAssessments || [];
  return rows.find((item) => item.id === id) || rows[0] || null;
}

function renderPreAssessments() {
  const rows = digitalEvaluationState.board?.preAssessments || [];
  setHtml("digital-evaluation-preassessments", rows.map((item) => `<article><h3>${escapeHtml(item.institutionName)} · ${escapeHtml(item.cycle)}</h3><div class="evaluation-pack-grid">${(item.results || []).map((result) => `<div class="evaluation-pack"><strong>${escapeHtml(result.packName)}</strong><span>模拟 ${escapeHtml(result.achievedLevel)} / 目标 ${escapeHtml(result.targetLevel)}</span><small>${escapeHtml(result.gapCount)} 项差距 · 非正式结论</small></div>`).join("")}</div></article>`).join(""));
  const select = document.getElementById("digital-evaluation-assessment-id");
  const current = select?.value;
  if (select) {
    select.innerHTML = rows.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.institutionName)} / ${escapeHtml(item.cycle)}</option>`).join("");
    if (current && rows.some((item) => item.id === current)) select.value = current;
  }
  renderFindings();
}

function renderFindings() {
  const assessment = selectedAssessment();
  const findings = assessment?.findings || [];
  setHtml("digital-evaluation-findings", `<table><thead><tr><th>优先级</th><th>体系/维度</th><th>整改项</th><th>责任与期限</th><th>状态</th></tr></thead><tbody>${findings.map((item) => `<tr><td><span class="badge ${item.severity === "P0" ? "danger" : "warn"}">${escapeHtml(item.severity)}</span></td><td>${escapeHtml(item.packId)}<br><small>${escapeHtml(item.category)}</small></td><td>${escapeHtml(item.title)}<br><small>${escapeHtml(item.reason)}</small></td><td>${escapeHtml(item.assignedTo || "待分派")}<br><small>${escapeHtml(item.dueAt || "未设期限")}</small></td><td>${escapeHtml(item.status)}</td></tr>`).join("")}</tbody></table>`);
  const findingSelect = document.getElementById("digital-evaluation-finding-id");
  if (findingSelect) findingSelect.innerHTML = findings.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.severity)} / ${escapeHtml(item.title)}</option>`).join("");
}

function renderBoundary() {
  const board = digitalEvaluationState.board || {};
  const status = document.getElementById("digital-evaluation-boundary-status");
  if (status) status.innerHTML = `<span class="${board.functionalState === "pilot-launch-ready" ? "result-ready" : "result-blocked"}">${escapeHtml(board.functionalState || "待核验")}</span> / ${escapeHtml(board.formalGoLiveState || "")}`;
  setHtml("digital-evaluation-site-blockers", `<p>平台功能达到受控试点上线要求；正式生产评价仍需真实系统联调和现场签字。</p>${(board.siteBlockers || []).map((item) => `<p><strong>${escapeHtml(item.title)}</strong>：${escapeHtml(item.nextAction)}</p>`).join("")}`);
}

function renderAll() { renderMetrics(); renderCatalog(); renderCollectionJobs(); renderEvidence(); renderPreAssessments(); renderBoundary(); }

async function refreshBoard() {
  const [catalog, board] = await Promise.all([jsonRequest(DIGITAL_EVALUATION_ENDPOINTS.catalog), jsonRequest(DIGITAL_EVALUATION_ENDPOINTS.pilot)]);
  digitalEvaluationState.catalog = catalog;
  digitalEvaluationState.board = board;
  const user = digitalEvaluationState.user;
  if (user?.role === "institution") {
    document.getElementById("digital-evaluation-institution-id").value = user.orgCode || "";
    document.getElementById("digital-evaluation-institution-name").value = user.orgName || "";
    document.getElementById("digital-evaluation-institution-id").readOnly = true;
  }
  renderAll();
}

function bindForms() {
  ["digital-evaluation-pack-filter", "digital-evaluation-project-search"].forEach((id) => document.getElementById(id)?.addEventListener("input", renderCatalog));
  document.getElementById("digital-evaluation-assessment-id")?.addEventListener("change", renderFindings);
  document.getElementById("digital-evaluation-collection-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("digital-evaluation-job-id").value;
    const payload = { action: "run-validation", sampleSize: Number(document.getElementById("digital-evaluation-job-sample-size").value), validRows: Number(document.getElementById("digital-evaluation-job-valid-rows").value), receiptRef: document.getElementById("digital-evaluation-job-receipt").value, note: document.getElementById("digital-evaluation-job-note").value, noPatientPii: document.getElementById("digital-evaluation-job-no-pii").checked };
    const result = await jsonRequest(`${DIGITAL_EVALUATION_ENDPOINTS.collection}/${encodeURIComponent(id)}/actions`, { method: "POST", body: JSON.stringify(payload) });
    digitalEvaluationState.board = result.board; renderAll();
  });
  document.getElementById("digital-evaluation-evidence-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = document.getElementById("digital-evaluation-evidence-id").value;
    const payload = { action: document.getElementById("digital-evaluation-evidence-action").value, evidenceLevel: document.getElementById("digital-evaluation-evidence-level").value, evidenceRef: document.getElementById("digital-evaluation-evidence-ref").value, note: document.getElementById("digital-evaluation-evidence-note").value, noPatientPii: document.getElementById("digital-evaluation-evidence-no-pii").checked };
    const result = await jsonRequest(`${DIGITAL_EVALUATION_ENDPOINTS.evidence}/${encodeURIComponent(id)}/actions`, { method: "POST", body: JSON.stringify(payload) });
    digitalEvaluationState.board = result.board; renderAll();
  });
  document.getElementById("digital-evaluation-run-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = { action: "run-preassessment", institutionId: document.getElementById("digital-evaluation-institution-id").value, institutionName: document.getElementById("digital-evaluation-institution-name").value, cycle: document.getElementById("digital-evaluation-cycle").value, profileId: document.getElementById("digital-evaluation-profile-id").value };
    const result = await jsonRequest(`${DIGITAL_EVALUATION_ENDPOINTS.preassessments}/actions`, { method: "POST", body: JSON.stringify(payload) });
    digitalEvaluationState.board = result.board; document.getElementById("digital-evaluation-feedback").textContent = `已生成 ${result.assessment.summary.gaps} 项差距，进入整改闭环`; renderAll();
  });
  document.getElementById("digital-evaluation-finding-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const assessmentId = document.getElementById("digital-evaluation-assessment-id").value;
    const payload = { action: document.getElementById("digital-evaluation-finding-action").value, findingId: document.getElementById("digital-evaluation-finding-id").value, assignedTo: document.getElementById("digital-evaluation-finding-owner").value, dueAt: document.getElementById("digital-evaluation-finding-due-at").value, evidenceRef: document.getElementById("digital-evaluation-finding-evidence-ref").value, note: document.getElementById("digital-evaluation-finding-note").value, noPatientPii: document.getElementById("digital-evaluation-finding-no-pii").checked };
    const result = await jsonRequest(`${DIGITAL_EVALUATION_ENDPOINTS.preassessments}/${encodeURIComponent(assessmentId)}/actions`, { method: "POST", body: JSON.stringify(payload) });
    digitalEvaluationState.board = result.board; renderAll();
  });
}

bindForms();
refreshBoard().catch((error) => { setHtml("digital-evaluation-boundary-status", `<span class="result-blocked">${escapeHtml(error.message)}</span>`); });
