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
      state.textContent = `接口实时汇总 / ${report.summary?.functions || 0} 项功能 / ${report.summary?.ready || 0} 已就绪 / ${report.summary?.watch || 0} 需关注`;
      state.dataset.sourceMode = "api";
    }
  } catch (error) {
    renderAboutRuntime(staticAboutRuntimeReport(), "static");
    if (state) {
      state.textContent = "静态快照 / 摘要接口不可用，显示模板说明边界";
      state.dataset.sourceMode = "static";
    }
  }
});

function aboutStatusLabel(status) {
  const key = String(status || "").toLowerCase();
  return {
    ready: "已就绪",
    watch: "需关注",
    blocked: "受阻",
    empty: "暂无数据",
    normal: "正常"
  }[key] || status || "未标注";
}

function aboutEvidenceLabel(text) {
  return String(text || "")
    .replace(/\/api\/health-dashboard\/summary/g, "综合管理服务系统摘要接口")
    .replace(/health-dashboard-applications\.js/g, "应用清单")
    .replace(/health-dashboard:summary/g, "综合管理服务系统摘要脚本")
    .replace(/riskDrilldowns/g, "风险下钻记录")
    .replace(/openActions/g, "待办清单")
    .replace(/day\/week\/month\/year/g, "日、周、月、年")
    .replace(/npm\.cmd run /g, "运行脚本：");
}

function renderAboutRuntime(report, sourceMode) {
  renderAboutFunctionCards(report.functions || [], sourceMode);
  renderAboutMatrix("#dashboard-about-department-matrix", report.departmentFunctionMatrix || [], "department");
  renderAboutMatrix("#dashboard-about-city-county-matrix", report.cityCountyFunctionMatrix || [], "agency");
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
  status.textContent = aboutStatusLabel(item.status || "ready");
  const title = document.createElement("strong");
  title.textContent = item.name || item.id || "模块功能";
  const evidence = document.createElement("small");
  evidence.textContent = aboutEvidenceLabel(item.evidence || "");
  const boundary = document.createElement("p");
  boundary.textContent = item.boundary || "";
  card.append(status, title, evidence, boundary);
  return card;
}

function renderAboutMatrix(selector, items, type) {
  const target = document.querySelector(selector);
  if (!target) return;
  target.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("article");
    empty.className = "function-matrix-card empty";
    empty.textContent = "等待摘要接口返回机构功能矩阵。";
    target.appendChild(empty);
    return;
  }
  items.forEach((item) => target.appendChild(aboutMatrixCard(item, type)));
}

function aboutMatrixCard(item, type) {
  const card = document.createElement("article");
  card.className = `function-matrix-card ${item.status || "normal"}`;
  card.dataset.aboutFunctionMatrix = item.id || type || "matrix";
  const meta = document.createElement("span");
  meta.textContent = type === "agency" ? `${item.level || ""} · ${aboutStatusLabel(item.status || "ready")}` : `${item.level || "内部机构"} · ${aboutStatusLabel(item.status || "ready")}`;
  const title = document.createElement("strong");
  title.textContent = item.name || item.agency || item.id || "机构功能";
  const list = document.createElement("ul");
  (item.implemented || []).forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    list.appendChild(li);
  });
  const next = document.createElement("p");
  next.textContent = item.nextPlan || "";
  const evidence = document.createElement("small");
  evidence.textContent = aboutEvidenceLabel(item.evidence || "");
  card.append(meta, title, list, next, evidence);
  return card;
}

function renderAboutReleaseEvidence(items) {
  const target = document.querySelector("#dashboard-about-release-evidence");
  if (!target) return;
  target.innerHTML = "";
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.dataset.aboutRuntimeEvidence = item.id || "evidence";
    chip.textContent = `${item.name || item.id}：${aboutEvidenceLabel(item.evidence || "")}`;
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
        boundary: "就诊、入院已按日报快照汇总日周月年，小时级预警和生产切换仍需实时明细。"
      }
    ],
    releaseEvidence: [
      { id: "summary-script", name: "模块摘要与功能报告", evidence: "npm.cmd run health-dashboard:summary" }
    ],
    departmentFunctionMatrix: [
      {
        id: "planning-information",
        name: "规划信息处/信息中心",
        level: "内部机构",
        status: "ready",
        implemented: ["前七应用汇总入口", "日周月年服务量看板", "接口联调与发布证据"],
        nextPlan: "接入真实统计日报、机构目录、运行监控和生产数据库。",
        evidence: "health-dashboard:summary"
      },
      {
        id: "medical-administration",
        name: "医政医管处",
        level: "内部机构",
        status: "watch",
        implemented: ["就诊入院看板", "转诊与高风险任务下钻", "源应用导航"],
        nextPlan: "联调 HIS、EMR、LIS、PACS、床位和远程会诊接口。",
        evidence: "riskDrilldowns"
      }
    ],
    cityCountyFunctionMatrix: [
      {
        id: "city-health-commission",
        level: "市级",
        agency: "市卫生健康委",
        status: "ready",
        implemented: ["综合管理入口", "指标风险任务证据汇总", "按行政职能关联源模块"],
        nextPlan: "接入真实统一身份、统计直报和跨部门证照回执；医疗机构和专业中心仅作为数据来源或协同对象。",
        evidence: "/api/health-dashboard/summary"
      },
      {
        id: "county-health-bureau",
        level: "县级",
        agency: "区县卫生健康局",
        status: "watch",
        implemented: ["辖区监管信号汇总", "源应用查看督办入口", "现场问题证据挂接"],
        nextPlan: "增加区县筛选、辖区机构监管看板和任务闭环率；具体业务办理仍回源业务系统。",
        evidence: "county.html/openActions"
      }
    ],
    onsiteBoundaries: [
      "现场真实接口、统一身份、生产数据库、审计留存和运维监控接入前，本页只展示模板能力边界。"
    ]
  };
}
