"use strict";

const bloodState = { role: "center", view: "dashboard", api: null, integration: null };
const stocks = [
  { type: "A Rh+", red: 126, platelet: 7, status: "充足" },
  { type: "B Rh+", red: 98, platelet: 5, status: "正常" },
  { type: "O Rh+", red: 42, platelet: 3, status: "预警" },
  { type: "AB Rh+", red: 57, platelet: 2, status: "正常" }
];
const centerTasks = ["2袋核酸检测结果待综合判定", "O型红细胞库存低于3日安全线", "配送单 PS20260711-036 冷链温度待确认", "1例献血不良反应待回访"];
const hospitalTasks = ["3份用血申请待输血科审核", "1份交叉配血结果待复核", "床旁输注 TX20260711-009 待15分钟监测", "2例输血后疗效评价待完成"];

const $ = (selector) => document.querySelector(selector);
const displayText = (value) => value == null ? "" : String(value);

function append(parent, values) {
  (Array.isArray(values) ? values : [values]).flat(Infinity).forEach((value) => {
    if (value == null) return;
    parent.append(value instanceof Node ? value : document.createTextNode(displayText(value)));
  });
  return parent;
}

function element(tagName, options = {}, children = []) {
  const node = document.createElement(tagName);
  if (options.className) node.className = options.className;
  if (Object.hasOwn(options, "text")) node.textContent = displayText(options.text);
  if (options.type) node.type = options.type;
  Object.entries(options.dataset || {}).forEach(([key, value]) => { node.dataset[key] = displayText(value); });
  return append(node, children);
}

function fragment(...children) {
  return append(document.createDocumentFragment(), children);
}

function replace(selector, children) {
  const target = $(selector);
  if (!target) return;
  const fragmentNode = fragment(children);
  target.replaceChildren(fragmentNode);
}

const signal = (label, tone = "ok") => element("span", { className: `signal ${tone}`, text: label });
const detail = (primary, secondary) => secondary == null
  ? displayText(primary)
  : fragment(displayText(primary), element("br"), element("small", { text: secondary }));
const actionButton = (label, dataset) => element("button", { className: "blood-action", type: "button", text: label, dataset });

function standardItem(label, body, trailing) {
  return element("div", { className: "standard-item" }, [
    element("b", { text: label }),
    element("span", {}, body),
    trailing
  ]);
}

function metricCard(label, value, hint, tone = "ok") {
  return element("article", { className: "blood-card" }, [
    element("small", { text: label }), element("strong", { text: value }), signal(hint, tone)
  ]);
}

function table(headers, rows) {
  return element("div", { className: "blood-table-scroll" }, element("table", { className: "blood-table" }, [
    element("thead", {}, element("tr", {}, headers.map((header) => element("th", { text: header })))),
    element("tbody", {}, rows.map((row) => element("tr", {}, row.map((cell) => element("td", {}, cell)))))
  ]));
}

function flow(items) {
  return items.map((item, index) => element("div", { className: "flow-step" }, [
    element("b", { text: `0${index + 1}` }),
    element("strong", { text: item }),
    element("small", { text: index < items.length - 1 ? "状态在线 · 可追溯" : "闭环完成" })
  ]));
}

document.addEventListener("DOMContentLoaded", async () => {
  bind();
  await Promise.all([loadBloodSystem(), loadBloodIntegration()]);
  render();
});

async function loadBloodSystem() {
  if (location.protocol === "file:") return;
  try {
    const response = await (window.HealthCityAuth?.authFetch || fetch)(`${location.origin}/api/blood-system`);
    if (response.ok) bloodState.api = await response.json();
  } catch (error) { bloodState.api = null; }
}

async function loadBloodIntegration() {
  if (location.protocol === "file:") return;
  try {
    const response = await (window.HealthCityAuth?.authFetch || fetch)(`${location.origin}/api/blood-system/integration`);
    if (response.ok) bloodState.integration = await response.json();
  } catch (error) { bloodState.integration = null; }
}

function bind() {
  document.querySelectorAll("[data-role]").forEach((button) => button.addEventListener("click", () => {
    bloodState.role = button.dataset.role;
    document.querySelectorAll("[data-role]").forEach((item) => item.classList.toggle("active", item === button));
    render();
  }));
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => {
    bloodState.view = button.dataset.view;
    document.querySelectorAll("[data-view]").forEach((item) => item.classList.toggle("active", item === button));
    document.querySelectorAll(".blood-view").forEach((item) => item.classList.toggle("active", item.id === bloodState.view));
  }));
  $("#trace-button").addEventListener("click", queryTrace);
  $("#request-form").addEventListener("submit", submitBloodRequest);
  $("#standard-filter").addEventListener("change", renderStandards);
  $("#reload-transaction").addEventListener("click", async () => { await loadBloodSystem(); render(); toast("事务状态已刷新"); });
  document.addEventListener("click", (event) => {
    const transaction = event.target.closest?.("[data-transaction-action]");
    const demo = event.target.closest?.("[data-demo-action]");
    if (transaction) runTransactionAction(transaction.dataset.transactionAction, transaction.dataset.id);
    if (demo) toast(`${demo.dataset.demoAction}已记录，审计日志已生成`);
  });
}

async function queryTrace() {
  const code = $("#trace-code").value.trim();
  $("#trace-title").textContent = code || "未输入编码";
  if (location.protocol !== "file:" && code) {
    try {
      const response = await (window.HealthCityAuth?.authFetch || fetch)(`${location.origin}/api/blood-system/trace/${encodeURIComponent(code)}`);
      const result = await response.json();
      toast(response.ok ? `追溯链已核验：${result.events.length}条服务端事件` : result.message);
      return;
    } catch (error) { /* retain the local trace when the service is unavailable */ }
  }
  toast("追溯链已通过本地规则核验");
}

async function submitBloodRequest(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const payload = {
    patientId: form.get("patientId") || "ZY20260711018", patientName: "患者*",
    bloodType: form.get("bloodType") || "A Rh+", component: form.get("component") || "悬浮红细胞",
    amount: "2U", indication: form.get("indication") || "Hb 62g/L，拟手术",
    urgency: form.get("urgency") || "常规", preAssessmentComplete: true, consentSigned: true
  };
  if (location.protocol !== "file:") {
    try {
      const response = await (window.HealthCityAuth?.authFetch || fetch)(`${location.origin}/api/blood-system/transfusion-requests`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
      });
      const result = await response.json();
      toast(response.ok ? `申请已持久化：${result.request.id}` : result.message);
      if (response.ok) { await loadBloodSystem(); render(); }
      return;
    } catch (error) { /* retain the local demonstration when the service is unavailable */ }
  }
  toast(`静态演示申请：${BloodDomain.buildExchangeMessage("blood_order", payload).messageId}`);
}

function render() {
  const hospital = bloodState.role === "hospital";
  $("#queue-title").textContent = hospital ? "用血机构今日任务" : "血液中心今日任务";
  renderMetrics(hospital); renderTasks(hospital); renderStocks(); renderFlows(); renderTables();
  renderTransaction(); renderIntegration(); renderSafety(); renderTrace(); renderStandards();
}

function renderMetrics(hospital) {
  const summary = bloodState.api?.summary;
  const data = summary ? (hospital
    ? [["用血申请", summary.requests, "本机构数据范围"], ["血液单元", summary.bloodUnits, "已授权库存"], ["风险预警", summary.alerts, "效期与冷链"], ["审计事件", summary.traceEvents, "全程留痕"]]
    : [["血液单元", summary.bloodUnits, "区域可见"], ["用血申请", summary.requests, "跨机构协同"], ["风险预警", summary.alerts, "需优先处置"], ["审计事件", summary.traceEvents, "全程留痕"]]) : (hospital
    ? [["待审核申请", 3, "较昨日 -2"], ["待配血", 5, "含紧急 1 例"], ["可用红细胞", 86, "单位"], ["输注中", 2, "床旁监测正常"]]
    : [["今日采集", 286, "人次"], ["待检测", 34, "袋"], ["已放行", 219, "袋"], ["区域保障", 4.6, "安全库存天数"]]);
  replace("#metrics", data.map((row) => metricCard(...row)));
}

function renderTasks(hospital) {
  replace("#task-table", table(["优先级", "任务", "状态", "操作"], (hospital ? hospitalTasks : centerTasks).map((task, index) => [
    signal(index < 2 ? "高" : "中", index === 1 ? "danger" : "warn"), task, "待处理", actionButton("处置", { demoAction: "处置" })
  ])));
}

function renderStocks() {
  replace("#stock-cards", stocks.map((stock) => standardItem(stock.type, `红细胞 ${stock.red}U · 血小板 ${stock.platelet}治疗量`, signal(stock.status, stock.status === "预警" ? "danger" : "ok"))));
}

function renderFlows() {
  replace("#main-flow", flow(["献血登记", "采集制备", "检测放行", "储运交付", "配血输注", "评价追溯"]));
  replace("#supply-flow", flow(["献血者服务", "血液采集", "成分制备", "血液检测", "储存发放运输", "质量管理"]));
}

function renderTables() {
  replace("#release-table", table(["献血码", "成分", "血型", "检测", "状态"], [
    ["CN2102-20260711-00182", "悬浮红细胞", "O Rh+", "ELISA/核酸阴性", "待双人放行"],
    ["CN2102-20260711-00195", "血小板", "A Rh+", "检测合格", "待贴签核查"],
    ["CN2102-20260711-00201", "血浆", "B Rh+", "复检中", "信息隔离"]
  ]));
  replace("#clinical-table", table(["用血标识", "患者", "品种", "环节", "安全核查"], [
    ["BT-0711-0032", "张* · ZY018", "悬浮红细胞 2U", "交叉配血", "标本身份一致"],
    ["BT-0711-0027", "王* · ZY006", "血小板 1治疗量", "床旁输注", "三查八对完成"],
    ["BT-0711-0018", "李* · ZY192", "血浆 400ml", "输血后评价", "待疗效评价"]
  ]));
  replace("#inventory-table", table(["血型", "红细胞", "血小板", "效期风险", "调度建议"], stocks.map((stock) => [stock.type, `${stock.red}U`, `${stock.platelet}治疗量`, stock.status === "预警" ? "12袋<48h" : "正常", stock.status === "预警" ? "启动区域调剂" : "按需供应"])));
  replace("#transport-list", [["PS20260711-036", "2-6℃ · 运输中", "3.8℃"], ["PS20260711-034", "20-24℃ · 已交付", "22.1℃"], ["PS20260711-031", "2-6℃ · 已交付", "4.2℃"]].map(([id, state, temperature]) => standardItem(id, state, signal(temperature))));
}

function renderTrace() {
  const events = [["08:12 献血登记", "身份核验完成，生成唯一献血码"], ["09:06 血液采集", "全血 400ml，血袋与标本自动核查一致"], ["13:42 检测与制备", "核酸/ELISA 合格，制成悬浮红细胞"], ["16:10 放行与配送", "双人放行，冷链 3.8℃，交付市中心医院"], ["18:25 配血发放", "患者标本一致，交叉配血相合"], ["19:02 床旁输注", "患者/血袋/医嘱核对完成，生命体征正常"]];
  replace("#trace-timeline", events.map(([title, description]) => element("div", { className: "timeline-item done" }, [element("strong", { text: title }), element("span", { text: description })])));
}

function renderSafety() {
  const api = bloodState.api || {};
  const donors = api.donorSafetyCases || [{ donorCode: "DNR-2102-00628", type: "临时屏蔽", reason: "近期接受疫苗接种", status: "active", notificationStatus: "已告知" }];
  const recalls = api.recalls || [];
  const reactions = api.reactions || [{ id: "tr-001", requestId: "BT-0711-0032", severity: "一般", symptoms: ["发热"], status: "reported" }];
  const specimens = api.specimens || [];
  const emergency = api.emergencyAllocations || [{ id: "ea-001", bloodType: "O Rh+", component: "悬浮红细胞", amount: "10U", reason: "急诊创伤批量救治", status: "approved" }];
  const metrics = [["活动屏蔽", donors.filter((item) => item.status === "active").length, "献血者健康保护"], ["活动召回", recalls.filter((item) => item.status !== "closed").length, "报告收回联动"], ["待调查反应", reactions.filter((item) => item.status !== "closed").length, "反向追溯"], ["标本拒收", specimens.filter((item) => item.status === "rejected").length, "质量门禁"]];
  replace("#safety-metrics", metrics.map(([label, value, hint]) => metricCard(label, value, hint, value ? "warn" : "ok")));
  replace("#donor-recall-table", table(["对象", "类型", "原因", "状态"], [...donors.map((item) => [item.donorCode, item.type, item.reason, `${item.status} · ${item.notificationStatus || ""}`]), ...recalls.map((item) => [item.id, "血液召回", item.reason, `${item.status} · ${(item.bloodUnitIds || []).length}袋`])]))
  replace("#emergency-list", emergency.map((item) => standardItem(item.priority === "critical" ? "特急" : "应急", detail(`${displayText(item.bloodType)} ${displayText(item.component)} ${displayText(item.amount)}`, item.reason), signal(item.status, item.status === "approved" ? "ok" : "warn"))));
  replace("#reaction-table", table(["记录", "申请/患者", "异常", "处置状态"], [...specimens.map((item) => [item.specimenCode, item.requestId, item.decisionReason, item.status]), ...reactions.map((item) => [item.id, item.requestId, `${item.severity} · ${(item.symptoms || []).join("、")}`, item.status])]))
}

function renderTransaction() {
  const api = bloodState.api || {};
  const units = api.bloodUnits || [];
  const role = api.role || (bloodState.role === "hospital" ? "institution" : "commission");
  replace("#transaction-flow", flow(["检测签发", "双人放行", "库存锁定", "配送交付", "医院接收", "配血复核", "床旁输注", "疗效评价"]));
  replace("#transaction-units", table(["献血码", "成分/血型", "业务状态", "库存锁"], units.map((item) => [item.donationCode, detail(item.component, `${displayText(item.bloodType)} · ${displayText(item.volume)}`), signal(item.status, ["recalled", "quarantined"].includes(item.status) ? "danger" : "ok"), detail(item.inventoryLock?.status || "未锁定", `v${item.inventoryLock?.version || 0}`)])));
  const actions = [];
  if (role === "commission") {
    const testing = units.find((item) => item.status === "testing"); const qualified = units.find((item) => item.status === "qualified"); const released = units.find((item) => item.status === "released");
    if (testing) actions.push(["签发检测报告", testing.id, "sign-report", "生成检测摘要并判定合格"]);
    if (qualified) actions.push(["放行电子复核", qualified.id, "release-review", "必须由两名不同账号完成"]);
    if (released) actions.push(["创建配送单", released.id, "create-shipment", "锁定库存并配送至MR1"]);
  } else {
    const shipment = (api.shipments || []).find((item) => item.status === "in_transit"); const received = units.find((item) => item.status === "hospital_received"); const issued = units.find((item) => item.status === "issued"); const episode = (api.transfusionEpisodes || []).find((item) => item.status === "transfusing");
    if (shipment) actions.push(["扫码接收配送", shipment.id, "receive-shipment", "确认冷链温度合格"]);
    if (received) actions.push(["记录配血复核", received.id, "compatibility", "两名检验人员复核相合"]);
    if (issued) actions.push(["床旁核对并输注", issued.id, "start-transfusion", "患者、医嘱、血袋三方一致"]);
    if (episode) actions.push(["完成疗效评价", episode.id, "complete-transfusion", "记录结局及评价"]);
  }
  replace("#transaction-actions", actions.length ? actions.map(([label, id, action, hint]) => standardItem(role === "commission" ? "中心" : "医院", detail(label, hint), actionButton("执行", { transactionAction: action, id }))) : standardItem("完成", "当前角色暂无待执行操作", signal("已闭环")));
  const evidence = [...(api.releaseReviews || []).map((item) => ["放行签名", item.bloodUnitId, item.reviewerName, item.signedAt]), ...(api.shipments || []).map((item) => ["配送", item.id, item.status, item.receivedAt || item.createdAt]), ...(api.compatibilityTests || []).map((item) => ["配血", item.bloodUnitId, `${(item.reviewerIds || []).length}人复核`, item.testedAt]), ...(api.transfusionEpisodes || []).map((item) => ["输注", item.bloodUnitId, item.status, item.completedAt || item.startedAt])];
  replace("#transaction-evidence", table(["证据类型", "对象", "签名/状态", "时间"], evidence.length ? evidence : [["检测报告", units[0]?.id || "-", "等待后续证据", "-"]]));
}

async function runTransactionAction(action, id) {
  if (location.protocol === "file:") { toast("静态预览不执行事务写入"); return; }
  const requestId = bloodState.api?.transfusionRequests?.[0]?.id;
  const actionMap = {
    "sign-report": ["/api/blood-system/test-reports/sign", { bloodUnitId: id, conclusion: "qualified", results: { nat: "negative", elisa: "negative" } }],
    "release-review": ["/api/blood-system/release-reviews", { bloodUnitId: id, decision: "approved" }],
    "create-shipment": ["/api/blood-system/shipments", { bloodUnitIds: [id], destinationInstitution: "MR1" }],
    "receive-shipment": ["/api/blood-system/shipments/receive", { shipmentId: id, temperatureOk: true, temperatureCelsius: 4.2, temperatureDeviceId: "PDA-WEB", temperatureSource: "handover_scan" }],
    "compatibility": ["/api/blood-system/compatibility-tests", { requestId, bloodUnitId: id, aboRhMatched: true, crossmatchCompatible: true }],
    "start-transfusion": ["/api/blood-system/transfusions/start", { requestId, bloodUnitId: id, patientMatched: true, orderMatched: true, bloodUnitMatched: true, scannerId: "PDA-WEB" }],
    "complete-transfusion": ["/api/blood-system/transfusions/complete", { episodeId: id, outcome: "completed", evaluation: "输注完成，生命体征平稳" }]
  };
  const [path, payload] = actionMap[action] || [];
  if (!path) return;
  try {
    const response = await (window.HealthCityAuth?.authFetch || fetch)(`${location.origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": `web-${action}-${id}-${Date.now()}` }, body: JSON.stringify(payload) });
    const result = await response.json();
    toast(response.ok ? "操作完成，事务证据已生成" : result.message || "操作失败");
    await loadBloodSystem(); render();
  } catch (error) { toast("服务连接失败，请稍后重试"); }
}

function renderStandards() {
  const filter = $("#standard-filter")?.value || "";
  const rows = BloodDomain.standards.filter((item) => !filter || item.source === filter).map((item) => [detail(item.source, `${displayText(item.clause)} · ${displayText(item.id)}`), detail(item.domain, item.requirement), fragment(displayText(item.evidence), element("br"), signal(`${displayText(item.level)} · 已映射`))]);
  replace("#standard-matrix", table(["依据与条款", "功能要求", "系统证据"], rows));
  const scenarios = [["检测报告未签发", BloodDomain.canTransition("qualified", "released", { dualReview: true })], ["冷链温度越限", BloodDomain.canTransition("in_transit", "hospital_received", { temperatureOk: false })], ["交叉配血不相合", BloodDomain.canTransition("crossmatched", "issued", { crossmatchCompatible: false })], ["床旁身份不一致", BloodDomain.canTransition("issued", "transfusing", { bedsideIdentityMatched: false })]];
  replace("#safety-scenarios", scenarios.map(([name, result]) => standardItem("阻断", detail(name, result.reasons.join("；")), signal(result.ok ? "异常放行" : "已拦截", result.ok ? "danger" : "ok"))));
  replace("#quality-list", ["献血者屏蔽、回访和检测结果回告", "检测报告收回与关联血液召回", "特殊用血分级审批与知情同意", "标本拒收、疑难配血与结果复核", "输血反应调查、自体输血和疗效评价", "应急储备、跨机构调配与演练"].map((item, index) => standardItem(`QC-${index + 1}`, item, signal("已纳管"))));
}

function renderIntegration() {
  const data = bloodState.integration || { summary: { contracts: 7, endpoints: 3, accepted: 0, queued: 0, deadLetters: 0 }, contracts: [{ id: "BIS-LAB-RESULT", name: "血液检测结果", source: "血站LIS/检测设备", target: "BIS", standard: "设备协议+血站标准", required: ["messageId", "bloodUnitId", "testCode", "result", "testedAt"] }, { id: "IOT-TEMPERATURE", name: "冷链温度遥测", source: "温控IoT", target: "BIS/BTIS", standard: "IoT JSON 1.0", required: ["messageId", "deviceId", "shipmentId", "temperature", "measuredAt"] }], endpoints: [], events: [], deadLetters: [] };
  const summary = data.summary || {};
  replace("#integration-metrics", [["接口契约", summary.contracts || 0, "设备与业务交换"], ["配置端点", summary.endpoints || 0, "联调环境"], ["已接收", summary.accepted || 0, "校验通过"], ["死信", summary.deadLetters || 0, "等待修复或重试"]].map(([label, value, hint]) => metricCard(label, value, hint, label === "死信" && value ? "danger" : "ok")));
  const endpoints = new Map((data.endpoints || []).flatMap((endpoint) => (endpoint.contractIds || []).map((id) => [id, endpoint])));
  replace("#integration-contracts", table(["契约", "流向", "标准/必填字段", "端点状态"], (data.contracts || []).map((contract) => {
    const endpoint = endpoints.get(contract.id);
    return [detail(contract.name, contract.id), `${displayText(contract.source)} → ${displayText(contract.target)}`, detail(contract.standard, (contract.required || []).join("、")), endpoint ? fragment(displayText(endpoint.name), element("br"), signal(endpoint.status, endpoint.status === "configured" ? "ok" : "warn")) : signal("待配置", "warn")];
  })));
  replace("#integration-events", table(["消息", "契约", "方向", "状态"], (data.events || []).slice(0, 20).map((event) => [detail(event.messageId, event.receivedAt || event.queuedAt || ""), event.contractId, event.direction, signal(event.status, event.status === "dead_letter" ? "danger" : "ok")])));
  const deadLetters = (data.deadLetters || []).map((item) => standardItem(item.contractId, detail(item.messageId, (item.errors || []).join("；")), actionButton("重试", { integrationAction: "retry", id: item.id })));
  replace("#integration-deadletters", deadLetters.length ? deadLetters : standardItem("正常", "当前无死信事件", signal("队列健康")));
}

async function handleIntegrationClick(event) {
  const button = event.target.closest?.("[data-integration-action]");
  const action = button?.dataset.integrationAction;
  if (!action) return;
  if (location.protocol === "file:") { toast("静态预览不发送接口消息"); return; }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const path = action === "iot-test" ? "/api/blood-system/integration/contracts/IOT-TEMPERATURE/receive" : `/api/blood-system/integration/dead-letters/${encodeURIComponent(button.dataset.id)}/retry`;
  const payload = action === "iot-test" ? { messageId: `IOT-WEB-${Date.now()}`, deviceId: "TEMP-BOX-01", shipmentId: "BS-JOINT-TEST", temperature: 4.1, measuredAt: new Date().toISOString(), sourceOrg: "IOT-TEST" } : {};
  try {
    const response = await request(`${location.origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json();
    toast(response.ok ? "接口操作完成" : result.message || (result.validation?.errors || []).join("；") || "接口操作失败");
    await loadBloodIntegration(); renderIntegration();
  } catch (error) { toast("接口网关连接失败"); }
}

document.addEventListener("click", handleIntegrationClick);

function toast(message) {
  const node = $("#toast");
  node.textContent = displayText(message);
  node.classList.add("visible");
  clearTimeout(window.__bloodToast);
  window.__bloodToast = setTimeout(() => node.classList.remove("visible"), 2400);
}
