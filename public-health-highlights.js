const HIGHLIGHTS_API = "/api/public-health/highlights";
let currentHighlights = null;

document.addEventListener("DOMContentLoaded", () => loadHighlights().then(renderHighlights));
document.addEventListener("click", handleAction);
document.addEventListener("submit", handleSignalSubmit);

async function requestJson(url, options = {}) {
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(url, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || `请求失败（${response.status}）`);
  return response.json();
}

async function loadHighlights() {
  try {
    currentHighlights = await requestJson(HIGHLIGHTS_API);
  } catch (error) {
    document.querySelector("#highlight-api-error").textContent = `当前为静态预览：${error.message}`;
    try {
      const response = await fetch("./data/public-demo.json");
      const state = response.ok ? await response.json() : {};
      currentHighlights = buildStaticHighlights(state);
    } catch (fallbackError) {
      currentHighlights = buildStaticHighlights({});
    }
  }
  return currentHighlights;
}

function buildStaticHighlights(state = {}) {
  const signals = Array.isArray(state.publicHealthSignals) && state.publicHealthSignals.length ? state.publicHealthSignals : [
    { id: "static-signal-1", sourceType: "临床症候群", metric: "fever-respiratory-cases", value: 8, unit: "例/24小时", region: "示范一区", institution: "区域中心医院", qualityStatus: "verified", location: { x: 48, y: 32 } },
    { id: "static-signal-2", sourceType: "实验室", metric: "same-pathogen-positive", value: 4, unit: "例/48小时", region: "示范二区", institution: "示范区人民医院", qualityStatus: "verified", location: { x: 65, y: 53 } },
    { id: "static-signal-3", sourceType: "学校/养老", metric: "clustered-symptoms", value: 7, unit: "人/24小时", region: "示范三区", institution: "示范实验学校", qualityStatus: "verified", location: { x: 45, y: 58 } }
  ];
  const alerts = Array.isArray(state.publicHealthAlerts) && state.publicHealthAlerts.length ? state.publicHealthAlerts : [
    { id: "static-alert-1", title: "示范一区呼吸道症候群聚集预警", severity: "high", status: "open", region: "示范一区", triggerCount: 14, threshold: 5, confidence: .91, signalIds: [signals[0].id], recommendedAction: "完成病例核实、采样和流调派单", actionHistory: [] },
    { id: "static-alert-2", title: "示范二区实验室阳性结果聚集预警", severity: "critical", status: "acknowledged", region: "示范二区", triggerCount: 4, threshold: 3, confidence: .96, signalIds: [signals[1].id], recommendedAction: "锁定阳性样本并启动关联病例核查", actionHistory: [] }
  ];
  const tasks = Array.isArray(state.publicHealthCommandTasks) && state.publicHealthCommandTasks.length ? state.publicHealthCommandTasks : [
    { id: "static-task-1", title: "示范一区呼吸道聚集事件核实与流调", status: "pending-acceptance", priority: "high", owner: "市级疾控流调一组", institution: "区域中心医院", region: "示范一区", dueAt: "2026-07-18T08:12:00+08:00", requiredActions: ["病例清单核对", "采样复核"] },
    { id: "static-task-2", title: "示范二区阳性样本实验室质量复核", status: "in-progress", priority: "critical", owner: "市级疾控实验室质量组", institution: "示范区人民医院", region: "示范二区", dueAt: "2026-07-17T19:10:00+08:00", requiredActions: ["样本链核对", "复检"] }
  ];
  const resources = Array.isArray(state.publicHealthResources) && state.publicHealthResources.length ? state.publicHealthResources : [
    { id: "static-resource-1", name: "市级疾控流调一组", type: "流调队伍", region: "示范一区", available: 5, capacity: 8, unit: "人", status: "available" },
    { id: "static-resource-2", name: "区域快速复检能力", type: "实验室能力", region: "示范二区", available: 18, capacity: 30, unit: "样本/日", status: "available" }
  ];
  const reviews = Array.isArray(state.publicHealthAiReviews) && state.publicHealthAiReviews.length ? state.publicHealthAiReviews : [
    { id: "static-ai-1", title: "建议优先核查示范一区医疗机构间的共同暴露线索", status: "pending-review", confidence: .88, summary: "两个机构在24小时窗口内同时超过症候群基线，建议核对共同场所。", reasoning: ["时间窗口重叠", "超过规则阈值"], recommendedActions: ["生成病例核查表", "人工复核"], evidenceRefs: [signals[0].id], humanApprovalRequired: true }
  ];
  const records = Array.isArray(state.publicHealthEvidenceRecords) && state.publicHealthEvidenceRecords.length ? state.publicHealthEvidenceRecords : [
    { id: "static-evidence-1", name: "多源信号来源可追溯", sourceCollection: "publicHealthSignals", expected: signals.length, observed: signals.length, status: "verified", owner: "平台技术组", evidenceRefs: ["sourceSystem", "observedAt", "evidenceRefs"] },
    { id: "static-evidence-2", name: "预警动作闭环可回放", sourceCollection: "publicHealthAlerts", expected: alerts.length, observed: alerts.length, status: "recorded", owner: "应急办", evidenceRefs: ["actionHistory", "status"] },
    { id: "static-evidence-3", name: "AI建议具备人工确认边界", sourceCollection: "publicHealthAiReviews", expected: reviews.length, observed: reviews.length, status: "verified", owner: "疾控研判组", evidenceRefs: ["modelVersion", "humanApprovalRequired"] }
  ];
  const activeAlerts = alerts.filter((item) => !/closed|resolved|complete/i.test(item.status || ""));
  const evidenceRecorded = records.filter((item) => /verified|recorded/i.test(item.status || "")).length;
  const nodes = signals.concat(activeAlerts.map((alert) => ({ ...alert, type: "alert", location: signals.find((signal) => alert.signalIds?.includes(signal.id))?.location || { x: 50, y: 50 } })));
  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    functionalState: "five-suite-runnable",
    formalGoLiveState: "blocked-until-site-evidence-signed",
    capabilities: [
      { id: "trigger-engine", name: "多点触发监测预警", shortName: "监测预警", description: "多源信号按规则形成可解释预警。", owner: "疾控中心/平台技术组" },
      { id: "gis-command-map", name: "GIS公共卫生一张图", shortName: "一张图", description: "区域、机构、事件和资源同屏查看。", owner: "卫健管理部门/应急办" },
      { id: "ai-investigation-assistant", name: "AI流调研判助手", shortName: "AI研判", description: "基于证据生成可审计建议。", owner: "疾控中心/流调专班" },
      { id: "emergency-command-dispatch", name: "应急指挥与资源调度", shortName: "应急调度", description: "预警直接派发任务和资源。", owner: "应急办/卫健管理部门" },
      { id: "evidence-cockpit", name: "数据质量与证据链驾驶舱", shortName: "证据驾驶舱", description: "来源、动作和审计记录可追溯。", owner: "项目办/安全管理岗" }
    ],
    summary: { capabilities: 5, rules: 5, signals: signals.length, sourceTypes: new Set(signals.map((item) => item.sourceType)).size, activeAlerts: activeAlerts.length, criticalAlerts: activeAlerts.filter((item) => item.severity === "critical").length, openTasks: tasks.filter((item) => !/complete|closed/i.test(item.status || "")).length, resources: resources.length, readyResources: resources.filter((item) => item.available > 0).length, aiReviews: reviews.length, aiPendingReviews: reviews.filter((item) => item.status === "pending-review").length, evidenceScore: records.length ? Math.round((evidenceRecorded / records.length) * 100) : 0, evidenceVerified: records.filter((item) => item.status === "verified").length, evidencePending: records.length - evidenceRecorded, auditEvents: 0 },
    triggerCenter: { rules: [], signals, alerts: activeAlerts, quality: { verifiedSignals: signals.filter((item) => item.qualityStatus === "verified").length, reviewSignals: signals.filter((item) => item.qualityStatus !== "verified").length, ruleCoverage: 5, sourceTypes: [...new Set(signals.map((item) => item.sourceType))] } },
    mapBoard: { regions: [...new Set(nodes.map((item) => item.region).filter(Boolean))].map((name) => ({ name })), nodes: nodes.map((item) => ({ ...item, type: item.type || "signal", label: item.title || item.sourceType })) },
    aiCenter: { reviews, modelCard: { modelVersion: "ph-risk-assist-demo-1.0", humanApprovalRequired: true } },
    commandCenter: { tasks, openTasks: tasks.filter((item) => !/complete|closed/i.test(item.status || "")), resources, readyResources: resources.filter((item) => item.available > 0), escalationQueue: tasks.filter((item) => item.priority === "critical") },
    evidenceCenter: { records, summary: { total: records.length, verified: records.filter((item) => item.status === "verified").length, recorded: evidenceRecorded, pending: records.length - evidenceRecorded, score: records.length ? Math.round((evidenceRecorded / records.length) * 100) : 0 }, quality: {} }
  };
}

function renderHighlights(board) {
  if (!board) return;
  renderMetrics(board.summary || {});
  document.querySelector("#highlight-state").textContent = `${board.functionalState} · ${board.formalGoLiveState}`;
  document.querySelector("#highlight-capabilities").innerHTML = (board.capabilities || []).map((item) => `<article class="highlight-card active"><strong>${escapeHtml(item.shortName || item.name)}</strong><span>${escapeHtml(item.description || "")}</span><em>${escapeHtml(item.owner || "")}</em></article>`).join("");
  renderMap(board.mapBoard || {});
  renderSignals(board.triggerCenter || {});
  renderAlerts(board.triggerCenter?.alerts || []);
  renderAi(board.aiCenter || {});
  renderTasks(board.commandCenter || {});
  renderResources(board.commandCenter?.resources || []);
  renderEvidence(board.evidenceCenter || {});
}

function renderMetrics(summary) {
  const metrics = [
    ["活跃预警", summary.activeAlerts || 0, `${summary.criticalAlerts || 0} 项危急`],
    ["监测信号", summary.signals || 0, `${summary.sourceTypes || 0} 类来源`],
    ["待处置任务", summary.openTasks || 0, `${summary.readyResources || 0} 类资源可用`],
    ["AI待复核", summary.aiPendingReviews || 0, `${summary.aiReviews || 0} 条研判建议`],
    ["证据完整度", `${summary.evidenceScore || 0}%`, `${summary.evidenceVerified || 0} 条已核验`]
  ];
  document.querySelector("#highlight-metrics").innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(label)}</span><small>${escapeHtml(hint)}</small></article>`).join("");
}

function renderMap(map) {
  const labels = [["北部", 55, 16], ["中部", 55, 49], ["南部", 25, 78], ["东部", 82, 53]];
  const nodes = (map.nodes || []).map((node) => `<button class="map-node ${node.type === "alert" ? "alert" : ""}" style="left:${Number(node.location?.x || 50)}%;top:${Number(node.location?.y || 50)}%" data-label="${escapeHtml(node.label || node.title || node.sourceType || "节点")}" title="${escapeHtml(`${node.region || ""} ${node.institution || ""}`)}"></button>`).join("");
  document.querySelector("#highlight-map").innerHTML = labels.map(([label, left, top]) => `<span class="map-label" style="left:${left}%;top:${top}%">${label}</span>`).join("") + nodes;
  document.querySelector("#map-summary").textContent = `${map.regions?.length || 0} 个区域 · ${(map.nodes || []).filter((item) => item.type === "alert").length} 个预警节点 · ${(map.nodes || []).filter((item) => item.type !== "alert").length} 个信号节点`;
}

function renderSignals(center) {
  const signals = center.signals || [];
  document.querySelector("#signal-quality").textContent = `${center.quality?.verifiedSignals || 0} 条已核验 / ${center.quality?.reviewSignals || 0} 条待复核`;
  document.querySelector("#highlight-signals").innerHTML = signals.length ? `<table class="data-table"><thead><tr><th>来源</th><th>区域</th><th>数值</th><th>质量</th></tr></thead><tbody>${signals.slice(0, 8).map((item) => `<tr><td>${escapeHtml(item.sourceType)}<br><small>${escapeHtml(item.sourceSystem || "")}</small></td><td>${escapeHtml(item.region)}<br><small>${escapeHtml(item.institution)}</small></td><td>${escapeHtml(String(item.value))} ${escapeHtml(item.unit || "")}</td><td><span class="status ${item.qualityStatus === "verified" ? "verified" : "medium"}">${escapeHtml(item.qualityStatus || "received")}</span></td></tr>`).join("")}</tbody></table>` : `<p class="empty">暂无信号</p>`;
}

function renderAlerts(alerts) {
  document.querySelector("#highlight-alerts").innerHTML = alerts.length ? `<table class="data-table"><thead><tr><th>预警</th><th>等级</th><th>区域</th><th>命中</th><th>动作</th></tr></thead><tbody>${alerts.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><br><small>置信度 ${Math.round(Number(item.confidence || 0) * 100)}% · ${escapeHtml((item.evidenceRefs || []).join("、"))}</small></td><td><span class="status ${escapeHtml(item.severity)}">${escapeHtml(item.severity)}</span></td><td>${escapeHtml(item.region)}</td><td>${escapeHtml(String(item.triggerCount))}/${escapeHtml(String(item.threshold))}</td><td><div class="action-row"><button data-highlight-action="alert:acknowledge" data-id="${escapeHtml(item.id)}">确认</button><button data-highlight-action="alert:dispatch" data-id="${escapeHtml(item.id)}">派发</button><button data-highlight-action="alert:close" data-id="${escapeHtml(item.id)}">关闭</button></div></td></tr>`).join("")}</tbody></table>` : `<p class="empty">暂无活跃预警</p>`;
}

function renderAi(center) {
  document.querySelector("#ai-model-card").textContent = `${center.modelCard?.modelVersion || "assist"} · 人工确认必需`;
  document.querySelector("#highlight-ai").innerHTML = (center.reviews || []).map((item) => `<article class="insight-item"><header><strong>${escapeHtml(item.title)}</strong><span class="status ${item.status === "approved" ? "approved" : "medium"}">${escapeHtml(item.status)}</span></header><p>${escapeHtml(item.summary || "")}</p><p>置信度 ${Math.round(Number(item.confidence || 0) * 100)}% · 证据：${escapeHtml((item.evidenceRefs || []).join("、"))}</p><div class="action-row"><button data-highlight-action="ai:approve" data-id="${escapeHtml(item.id)}">采纳建议</button><button data-highlight-action="ai:request-more-evidence" data-id="${escapeHtml(item.id)}">补证据</button></div></article>`).join("") || `<p class="empty">暂无AI研判建议</p>`;
}

function renderTasks(center) {
  document.querySelector("#highlight-tasks").innerHTML = (center.openTasks || center.tasks || []).map((item) => `<article class="task-item"><header><strong>${escapeHtml(item.title)}</strong><span class="status ${item.priority === "critical" ? "critical" : item.priority === "high" ? "high" : "medium"}">${escapeHtml(item.priority || "normal")}</span></header><p>${escapeHtml(item.region)} · ${escapeHtml(item.institution)} · 责任人：${escapeHtml(item.owner)}</p><p>截止：${escapeHtml(item.dueAt || "未设定")}<br>动作：${escapeHtml((item.requiredActions || []).join("、"))}</p><div class="action-row"><button data-highlight-action="task:accept" data-id="${escapeHtml(item.id)}">接单</button><button data-highlight-action="task:complete" data-id="${escapeHtml(item.id)}">完成</button><button data-highlight-action="task:escalate" data-id="${escapeHtml(item.id)}">升级</button></div></article>`).join("") || `<p class="empty">暂无待处置任务</p>`;
}

function renderResources(resources) {
  document.querySelector("#highlight-resources").innerHTML = resources.map((item) => `<article class="resource-item"><header><strong>${escapeHtml(item.name)}</strong><span class="status ${item.status === "available" ? "available" : "medium"}">${escapeHtml(item.status)}</span></header><p>${escapeHtml(item.type)} · ${escapeHtml(item.region)}</p><p>可用 ${escapeHtml(String(item.available))} / ${escapeHtml(String(item.capacity))} ${escapeHtml(item.unit || "")}</p></article>`).join("") || `<p class="empty">暂无资源</p>`;
}

function renderEvidence(center) {
  const summary = center.summary || {};
  document.querySelector("#evidence-summary").textContent = `${summary.recorded || 0}/${summary.total || 0} 已记录 · ${summary.verified || 0} 已核验 · ${summary.score || 0}%`;
  document.querySelector("#highlight-evidence").innerHTML = (center.records || []).length ? `<table class="data-table"><thead><tr><th>证据域</th><th>来源集合</th><th>完成度</th><th>状态</th><th>动作</th></tr></thead><tbody>${center.records.map((item) => `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small>${escapeHtml(item.owner || "")}</small></td><td><code>${escapeHtml(item.sourceCollection || "")}</code><br><small>${escapeHtml((item.evidenceRefs || []).join("、"))}</small></td><td>${escapeHtml(String(item.observed || 0))}/${escapeHtml(String(item.expected || 0))}</td><td><span class="status ${item.status === "verified" ? "verified" : "medium"}">${escapeHtml(item.status || "pending")}</span></td><td><div class="action-row"><button data-highlight-action="evidence:verify" data-id="${escapeHtml(item.id)}">核验</button><button data-highlight-action="evidence:record" data-id="${escapeHtml(item.id)}">记录</button></div></td></tr>`).join("")}</tbody></table>` : `<p class="empty">暂无证据记录</p>`;
}

async function handleAction(event) {
  const button = event.target.closest("[data-highlight-action]");
  if (!button || !currentHighlights) return;
  const [type, action] = button.dataset.highlightAction.split(":");
  const id = button.dataset.id;
  const routes = { alert: `alerts/${encodeURIComponent(id)}`, task: `command-tasks/${encodeURIComponent(id)}`, ai: `ai-reviews/${encodeURIComponent(id)}`, evidence: `evidence/${encodeURIComponent(id)}` };
  if (!routes[type]) return;
  button.disabled = true;
  try {
    const response = await requestJson(`${HIGHLIGHTS_API}/${routes[type]}/actions`, { method: "POST", body: JSON.stringify({ action, note: `${type} action from command center` }) });
    currentHighlights = response.highlights || currentHighlights;
    renderHighlights(currentHighlights);
  } catch (error) {
    document.querySelector("#highlight-api-error").textContent = error.message;
    button.disabled = false;
  }
}

async function handleSignalSubmit(event) {
  if (event.target.id !== "signal-form") return;
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  payload.value = Number(payload.value);
  try {
    const response = await requestJson(`${HIGHLIGHTS_API}/signals`, { method: "POST", body: JSON.stringify(payload) });
    currentHighlights = response.highlights || currentHighlights;
    renderHighlights(currentHighlights);
    event.target.reset();
  } catch (error) {
    document.querySelector("#highlight-api-error").textContent = error.message;
  }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}
