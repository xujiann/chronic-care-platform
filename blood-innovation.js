const state = { data: null };
const request = () => window.HealthCityAuth?.authFetch || fetch;

function text(value) {
  return document.createTextNode(String(value ?? ""));
}

function element(tagName, options = {}, children = []) {
  const target = document.createElement(tagName);
  if (options.className) target.className = options.className;
  if (Object.prototype.hasOwnProperty.call(options, "text")) target.textContent = String(options.text ?? "");
  Object.entries(options.dataset || {}).forEach(([key, value]) => {
    target.dataset[key] = String(value ?? "");
  });
  const items = Array.isArray(children) ? children : [children];
  items.filter((item) => item !== null && item !== undefined).forEach((item) => {
    target.append(item?.nodeType ? item : text(item));
  });
  return target;
}

function status(label, risk = false) {
  return element("span", { className: `bi-status${risk ? " risk" : ""}`, text: label });
}

function table(headers, rows) {
  const head = element("thead", {}, element("tr", {}, headers.map((header) => element("th", { text: header }))));
  const body = element("tbody", {}, rows.map((row) => element("tr", {}, row.map((value) => {
    return element("td", {}, value?.nodeType ? value : text(value));
  }))));
  return element("table", { className: "bi-table" }, [head, body]);
}

async function load(code = "") {
  const response = await request()(`${location.origin}/api/blood-system/innovation${code ? `?code=${encodeURIComponent(code)}` : ""}`);
  if (!response.ok) throw new Error("创新中心数据加载失败");
  state.data = await response.json();
  render();
}

function renderSummary(data) {
  const summary = data.summary;
  const cards = [
    ["已实现能力", `${summary.implemented}/${summary.total}`],
    ["协同机构", summary.institutions],
    ["开放风险", summary.openRisks],
    ["自动符合率", `${data.compliance.passed}/${data.compliance.total}`]
  ].map(([label, value]) => element("article", { className: "bi-card" }, [
    element("small", { text: label }),
    element("strong", { text: value })
  ]));
  document.querySelector("#summary").replaceChildren(...cards);
}

function renderCapabilities(capabilities) {
  const items = capabilities.map((item) => element("article", { className: "bi-capability" }, [
    element("span", { className: "bi-number", text: item.order }),
    element("span", {}, [text(item.name), element("br"), element("small", { text: item.side })]),
    element("span", { className: "bi-ok", text: "已实现" })
  ]));
  document.querySelector("#capabilities").replaceChildren(...items);
}

function renderRisks(risks) {
  const items = risks.length
    ? risks.map((item) => element("div", { className: "bi-timeline" }, [
      element("b", { text: item.type }),
      text(` · ${String(item.message ?? "")}`),
      element("br"),
      element("small", { text: `${String(item.level ?? "")} / ${String(item.subjectId ?? "")}` })
    ]))
    : [status("当前无开放风险")];
  document.querySelector("#risks").replaceChildren(...items);
}

function render() {
  const data = state.data;
  renderSummary(data);
  renderCapabilities(data.capabilities);
  document.querySelector("#inventory").replaceChildren(table(
    ["机构", "可用", "在途", "状态"],
    data.inventoryNodes.map((item) => [item.institutionName, item.available, item.inTransit, status(item.alert === "low" ? "偏低" : "正常", item.alert === "low")])
  ));
  renderRisks(data.riskSignals);
  document.querySelector("#forecast").replaceChildren(table(
    ["血型", "可用", "7日需求", "缺口/余量", "建议"],
    data.forecast.map((item) => [item.bloodType, item.available, item.predictedDemand, item.gap, item.recommendation])
  ));
  document.querySelector("#compliance").replaceChildren(table(
    ["检查项", "结果", "证据"],
    data.compliance.checks.map((item) => [item.name, status(item.ok ? "通过" : "待整改", !item.ok), item.evidence])
  ));
  renderEventHub(data.eventHub);
  renderTwin(data.digitalTwin);
}

function renderEventHub(hub = { summary: {}, consumers: [], deliveries: [] }) {
  const summary = hub.summary || {};
  const overview = element("p", { text: `契约 ${String(summary.contracts || 0)} · 事件 ${String(summary.events || 0)} · 已投递 ${String(summary.delivered || 0)} · 死信 ${String(summary.deadLetters || 0)} · 投影 ${String(summary.projections || 0)}` });
  const consumers = table(["订阅模块", "投影记录", "严重事件"], (hub.consumers || []).map((item) => [item.id, item.records, item.critical]));
  const deadLetters = (hub.deliveries || []).filter((item) => item.status === "dead_letter").map((item) => element("p", {}, [
    status("死信", true),
    text(` ${String(item.consumer ?? "")} / ${String(item.eventId ?? "")} `),
    element("button", { text: "重试", dataset: { retryDelivery: item.id } })
  ]));
  document.querySelector("#event-hub").replaceChildren(overview, consumers, ...deadLetters);
}

function renderTwin(twin) {
  const target = document.querySelector("#twin");
  if (!twin) {
    target.replaceChildren(text("未找到血液单元"));
    return;
  }
  const summary = element("p", {}, [
    element("b", { text: twin.unit.donationCode }),
    text(` · ${String(twin.unit.component ?? "")} · ${String(twin.unit.status ?? "")} · 当前保管方 ${String(twin.currentCustodian ?? "")}`)
  ]);
  const events = twin.events.map((item) => element("div", { className: "bi-timeline" }, [
    element("b", { text: item.action }),
    text(` ${String(item.detail ?? "")}`),
    element("br"),
    element("small", { text: `${String(item.at ?? "")} · ${String(item.actor ?? "")}` })
  ]));
  target.replaceChildren(summary, ...events);
}

function renderDecision(result) {
  const supported = result.decision === "supported";
  document.querySelector("#decision").replaceChildren(element("p", {}, [
    status(supported ? "建议支持" : "需要复核", !supported),
    text(` ${(result.flags || []).map((item) => String(item ?? "")).join("；")}`)
  ]));
}

function renderPda(result) {
  const verified = result.status === "verified";
  document.querySelector("#pda").replaceChildren(element("p", {}, status(verified ? "四码核对通过" : "门禁阻断", !verified)));
}

async function execute(id) {
  const payload = id === "supply-forecast"
    ? { horizonDays: 7 }
    : id === "rational-use"
      ? { requestId: "BT-0711-0032", component: "悬浮红细胞", hemoglobin: Number(document.querySelector("#hb").value), amount: Number(document.querySelector("#amount").value), indication: "贫血", consentSigned: true, urgency: "常规" }
      : id === "pda-bedside"
        ? { patientCode: document.querySelector("#patient-code").value, requestId: "BT-0711-0032", bloodUnitCode: document.querySelector("#unit-code").value, operatorId: "current-user", scannerId: "PDA-WEB" }
        : {};
  const response = await request()(`${location.origin}/api/blood-system/innovation/${id}/execute`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "操作失败");
  if (id === "rational-use") renderDecision(body.result);
  if (id === "pda-bedside") renderPda(body.result);
  await load(document.querySelector("#trace-code").value);
}

async function eventAction(path) {
  const response = await request()(`${location.origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  const body = await response.json();
  if (!response.ok) throw new Error(body.message || "事件操作失败");
  await load(document.querySelector("#trace-code").value);
}

document.addEventListener("DOMContentLoaded", () => load().catch((error) => alert(error.message)));
document.addEventListener("click", (event) => {
  if (event.target.dataset.run) execute(event.target.dataset.run).catch((error) => alert(error.message));
  if (event.target.id === "trace") load(document.querySelector("#trace-code").value).catch((error) => alert(error.message));
  if (event.target.id === "publish-events") eventAction("/api/blood-system/events/publish").catch((error) => alert(error.message));
  if (event.target.dataset.retryDelivery) eventAction(`/api/blood-system/events/deliveries/${encodeURIComponent(event.target.dataset.retryDelivery)}/retry`).catch((error) => alert(error.message));
});
