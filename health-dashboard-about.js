const DASHBOARD_ABOUT_SUMMARY_ROUTE = "/api/health-dashboard/summary";

document.addEventListener("DOMContentLoaded", async () => {
  const state = document.querySelector("#dashboard-about-runtime-state");
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(DASHBOARD_ABOUT_SUMMARY_ROUTE);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const summary = await response.json();
    renderAboutRuntime(summary.functionalReport || {}, "api");
    if (state) {
      const report = summary.functionalReport || {};
      state.textContent = `api / ${report.summary?.functions || 0} functions / ${report.summary?.ready || 0} ready / ${report.summary?.watch || 0} watch`;
      state.dataset.sourceMode = "api";
    }
  } catch (error) {
    renderAboutRuntime(staticAboutRuntimeReport(), "static");
    if (state) {
      state.textContent = "static / 摘要接口不可用，显示模板说明边界";
      state.dataset.sourceMode = "static";
    }
  }
});

function renderAboutRuntime(report, sourceMode) {
  renderAboutFunctionCards(report.functions || [], sourceMode);
  renderAboutReleaseEvidence(report.releaseEvidence || []);
  renderAboutOnsiteBoundaries(report.onsiteBoundaries || []);
}

function renderAboutFunctionCards(items, sourceMode) {
  const target = document.querySelector("#dashboard-about-function-report");
  if (!target) return;
  target.innerHTML = "";
  if (!items.length) {
    target.appendChild(aboutCard({
      id: "empty-runtime-report",
      name: "等待模块功能报告",
      status: "empty",
      evidence: sourceMode,
      boundary: "摘要接口返回后显示当前功能、证据和现场边界。"
    }));
    return;
  }
  items.forEach((item) => target.appendChild(aboutCard(item)));
}

function aboutCard(item) {
  const card = document.createElement("article");
  card.className = `function-report-card ${item.status || "normal"}`;
  card.dataset.aboutRuntimeFunction = item.id || "runtime-function";
  const status = document.createElement("span");
  status.textContent = item.status || "ready";
  const title = document.createElement("strong");
  title.textContent = item.name || item.id || "模块功能";
  const evidence = document.createElement("small");
  evidence.textContent = item.evidence || "";
  const boundary = document.createElement("p");
  boundary.textContent = item.boundary || "";
  card.append(status, title, evidence, boundary);
  return card;
}

function renderAboutReleaseEvidence(items) {
  const target = document.querySelector("#dashboard-about-release-evidence");
  if (!target) return;
  target.innerHTML = "";
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.dataset.aboutRuntimeEvidence = item.id || "evidence";
    chip.textContent = `${item.name || item.id}: ${item.evidence || ""}`;
    target.appendChild(chip);
  });
}

function renderAboutOnsiteBoundaries(items) {
  const target = document.querySelector("#dashboard-about-onsite-boundaries");
  if (!target) return;
  target.innerHTML = "";
  items.forEach((text, index) => {
    const row = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = `现场边界 ${index + 1}`;
    const detail = document.createElement("span");
    detail.textContent = text;
    row.append(title, detail);
    target.appendChild(row);
  });
}

function staticAboutRuntimeReport() {
  return {
    functions: [
      {
        id: "aggregate-entry",
        name: "前七应用汇总入口",
        status: "ready",
        evidence: "health-dashboard-applications.js",
        boundary: "只做跨应用总览与导航，不替代源应用业务办理。"
      },
      {
        id: "population-service-board",
        name: "出生死亡就诊入院看板",
        status: "ready",
        evidence: "day/week/month/year",
        boundary: "日报接口接入前，就诊和入院使用月度快照折算。"
      }
    ],
    releaseEvidence: [
      { id: "summary-script", name: "模块摘要与功能报告", evidence: "npm.cmd run health-dashboard:summary" }
    ],
    onsiteBoundaries: [
      "现场真实接口、统一身份、生产数据库、审计留存和运维监控接入前，本页只展示模板能力边界。"
    ]
  };
}
