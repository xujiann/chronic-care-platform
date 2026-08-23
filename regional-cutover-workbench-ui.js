(function (root) {
  "use strict";

  function createElement(tagName, options = {}, children = []) {
    const element = document.createElement(tagName);
    if (options.className) element.className = options.className;
    if (Object.prototype.hasOwnProperty.call(options, "text")) element.textContent = String(options.text ?? "");
    Object.entries(options.dataset || {}).forEach(([key, value]) => {
      element.dataset[key] = String(value ?? "");
    });
    const childList = Array.isArray(children) ? children : [children];
    element.append(...childList.filter(Boolean));
    return element;
  }

  function metric(label, value) {
    return createElement("article", { className: "metric" }, [
      createElement("strong", { text: value }),
      createElement("span", { text: label })
    ]);
  }

  function render(report) {
    const status = document.querySelector("#regional-cutover-workbench-status");
    const metrics = document.querySelector("#regional-cutover-workbench-metrics");
    const regions = document.querySelector("#regional-cutover-workbench-regions");
    const boundary = document.querySelector("#regional-cutover-workbench-boundary");
    if (!status || !metrics || !regions || !boundary) return;
    status.textContent = report.candidateReady ? "存在候选地区" : "投产门禁关闭";
    status.className = `badge ${report.candidateReady ? "warn" : "danger"}`;
    metrics.replaceChildren(...[
      metric("地区", report.summary.regions),
      metric("配置就绪", report.summary.technicalReady),
      metric("运维就绪", report.summary.operationsReady),
      metric("证据就绪", report.summary.evidenceReady),
      metric("候选就绪", report.summary.candidateReady),
      metric("阻断", report.summary.blocked)
    ]);
    regions.replaceChildren(...report.regions.map((item) => createElement("article", {
      className: "evidence-card",
      dataset: { regionalCutoverRegion: item.regionCode }
    }, [
      createElement("h3", { text: `${item.regionName ?? ""} · ${item.regionCode ?? ""}` }),
      createElement("p", { text: `发布：${item.release.state ?? ""}；运维：${item.operations.status ?? ""}；存储：${item.storage.mode ?? ""}` }),
      createElement("p", { text: `证据：${item.evidence.lifecycleState ?? ""}，${item.evidence.readyScopes}/${item.evidence.requiredScopes} 范围就绪` }),
      createElement("p", { className: "muted", text: item.blockers.join("；") || "无本地阻断项" })
    ])));
    boundary.textContent = report.boundary;
  }

  async function load() {
    if (!root.HealthPlatformApi) return;
    try {
      const response = await root.HealthPlatformApi.createClient().get("/regional/cutover-workbench");
      render(response.data);
    } catch (error) {
      const status = document.querySelector("#regional-cutover-workbench-status");
      if (status) {
        status.textContent = "控制面不可用";
        status.className = "badge danger";
      }
    }
  }

  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", load);
  root.HealthRegionalCutoverWorkbench = Object.freeze({ load, render });
})(typeof globalThis === "object" ? globalThis : this);
