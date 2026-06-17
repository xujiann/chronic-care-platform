const fallbackState = {
  residents: [],
  diseases: [],
  followups: [],
  personalRecords: [],
  insuranceClaims: [],
  medicationPickups: [],
  emergencySignals: [],
  countyConsortium: null,
  referralSystem: null,
  platformRoadmap: []
};

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  const tasks = collectUnifiedTasks(state);
  const roadmap = state.platformRoadmap?.length ? state.platformRoadmap : defaultRoadmap();
  renderMetrics(state, tasks, roadmap);
  renderPlatformMap(state);
  renderPriorityList(roadmap);
  renderUnifiedTasks(tasks);
  renderDataMaturity(state);
  renderNextQueue(roadmap);
});

function renderMetrics(state, tasks, roadmap) {
  const dataCollections = Object.keys(state).filter((key) => Array.isArray(state[key]) || (state[key] && typeof state[key] === "object")).length;
  const p0 = roadmap.filter((item) => item.priority === "P0").length;
  const activeTasks = tasks.filter((item) => !["已完成", "已取药", "已通过"].includes(item.status)).length;
  document.querySelector("#workbench-metrics").innerHTML = [
    ["业务端", 5, "卫健委、机构、医保、个人、医共体"],
    ["核心数据集", dataCollections, "data/db.json 当前集合"],
    ["跨端待办", activeTasks, "自动从业务数据汇总"],
    ["P0 优先项", p0, "先补平台底座"],
    ["居民主索引", state.residents?.length || 0, "身份证号 + 手机号"],
    ["开源阶段", "MVP", "可演示、可继续拆分"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderPlatformMap(state) {
  const modules = [
    ["统一入口", "login.html / health-city.html / workbench.html", "角色登录、系统总览、总控台。"],
    ["卫健委端", "index.html", "监管总览、慢病医防整合、分级诊疗、公共卫生应急、数据安全审计。"],
    ["县域医共体平台", "county.html", "36 项功能、医技共享、基层综合管理、分级诊疗建设。"],
    ["医疗机构端", "institution.html", "授权档案、标准健康档案、转诊中心、固定取药协同。"],
    ["医保端", "insurance.html", "结算审核、支付引导、凭证核验、医疗机构监管。"],
    ["个人端", "citizen.html", "个人健康信息库、电子病历、固定取药、分级诊疗服务。"],
    ["统一数据底座", "data/db.json / server.js", `${Object.keys(state).length} 类数据集合，后续升级 SQLite/PostgreSQL。`],
    ["标准模型", "health-archive-standard.js / referralSystem", "健康档案标准、分级诊疗、县域医共体、个人主索引。"]
  ];
  document.querySelector("#platform-map").innerHTML = modules.map(([title, path, text]) => `<article>
    <strong>${title}</strong>
    <span>${path}</span>
    <p>${text}</p>
  </article>`).join("");
}

function renderPriorityList(roadmap) {
  document.querySelector("#priority-list").innerHTML = roadmap.map((item) => {
    const badge = item.priority === "P0" ? "danger" : item.priority === "P1" ? "warn" : "info";
    const statusClass = item.status === "已完成" ? "" : item.status === "进行中" ? "info" : "warn";
    return `<article class="priority-row">
      <div class="priority-rank ${badge}">${item.priority}</div>
      <div>
        <h3>${item.title}</h3>
        <p>${item.reason}</p>
        <div class="standard-tags">
          ${(item.scope || []).map((scope) => `<span class="badge info">${scope}</span>`).join("")}
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${statusClass}">${item.status}</span>
        <small>${item.nextAction}</small>
      </div>
    </article>`;
  }).join("");
}

function renderUnifiedTasks(tasks) {
  document.querySelector("#task-count").textContent = `${tasks.length} 项`;
  document.querySelector("#unified-tasks").innerHTML = tasks.slice(0, 12).map((task) => `<section class="item">
    <div>
      <h3>${task.title}</h3>
      <p>${task.owner} · ${task.module}</p>
      <p>${task.detail}</p>
    </div>
    <span class="badge ${task.level === "高" ? "danger" : task.level === "中" ? "warn" : "info"}">${task.status}</span>
  </section>`).join("") || `<p class="muted">暂无跨端待办。</p>`;
}

function renderDataMaturity(state) {
  const rows = [
    ["居民主索引", state.residents?.every((item) => item.personIndex || item.identityIndex), "跨端数据已使用 personIndex 贯通。"],
    ["健康档案标准", Boolean(state.healthArchiveStandard), "32 类基础数据集已经进入个人端和医生端。"],
    ["分级诊疗模型", Boolean(state.referralSystem), "基层首诊、转诊、医保支付和家庭医生服务已入模。"],
    ["县域医共体模型", Boolean(state.countyConsortium), "36 项功能清单和运营监管已入模。"],
    ["登录权限", Boolean(state.authUsers?.length && state.securityEvents?.length), "已具备后端会话、角色校验和安全事件日志第一版。"],
    ["持久化数据库", Boolean(state.storageMeta?.engine), `${state.storageMeta?.mode || "已配置 SQLite 主存储与 JSON 快照兼容策略。"}${state.storageMeta?.sqliteFile ? ` · ${state.storageMeta.sqliteFile}` : ""}`]
  ];
  document.querySelector("#data-maturity").innerHTML = rows.map(([name, ok, detail]) => `<section class="item">
    <div>
      <h3>${name}</h3>
      <p>${detail}</p>
    </div>
    <span class="badge ${ok ? "info" : "warn"}">${ok ? "已具备" : "待建设"}</span>
  </section>`).join("");
}

function renderNextQueue(roadmap) {
  const next = roadmap.filter((item) => item.status !== "已完成").slice(0, 5);
  document.querySelector("#next-queue").innerHTML = next.map((item) => `<div>
    <strong>${item.priority} · ${item.title}</strong>
    <span>${item.nextAction}</span>
  </div>`).join("");
}

function collectUnifiedTasks(state) {
  const tasks = [];
  (state.followups || []).filter((item) => item.status !== "已完成").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.diseaseType}随访`,
      owner: item.assignee,
      module: "慢病医防整合",
      detail: `${item.plannedAt} · ${item.advice || item.result}`,
      status: item.status,
      level: item.status === "已逾期" ? "高" : "中"
    });
  });
  (state.referralSystem?.referrals || []).filter((item) => !["已完成", "已接诊", "基层承接"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.type}`,
      owner: "转诊中心",
      module: "分级诊疗",
      detail: `${item.from} -> ${item.to} · ${item.reason}`,
      status: item.status,
      level: item.priority === "高" ? "高" : "中"
    });
  });
  (state.insuranceClaims || []).filter((item) => item.status !== "已通过").forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · ${item.claimType}`,
      owner: "医保端",
      module: "医保审核",
      detail: `${item.institution} · ${money(item.totalAmount)} · ${item.risk}`,
      status: item.status,
      level: item.status === "待审核" ? "高" : "中"
    });
  });
  (state.medicationPickups || []).filter((item) => !["已取药", "已完成"].includes(item.status)).forEach((item) => {
    const resident = residentOf(state, item.residentId);
    tasks.push({
      title: `${resident?.name || "未知居民"} · 固定取药`,
      owner: item.pharmacy,
      module: "个人端/医疗机构/医保",
      detail: `${item.medication} · ${item.nextPickup} · ${item.institutionReview || "待机构确认"} / ${item.insuranceReview || "待医保审核"}`,
      status: item.status,
      level: item.status === "待取药" ? "中" : "高"
    });
  });
  (state.emergencySignals || []).filter((item) => item.status !== "已处置").forEach((item) => {
    tasks.push({
      title: item.title,
      owner: "卫健委端",
      module: "公共卫生应急",
      detail: `${item.region} · ${item.action}`,
      status: item.status,
      level: item.level
    });
  });
  (state.countyConsortium?.tasks || []).filter((item) => item.status !== "已完成").forEach((item) => {
    tasks.push({
      title: item.title,
      owner: item.owner,
      module: "县域医共体平台",
      detail: `${item.due} · ${item.action}`,
      status: item.status,
      level: item.level
    });
  });
  return tasks.sort((a, b) => weightOf(b.level) - weightOf(a.level));
}

function residentOf(state, id) {
  return (state.residents || []).find((item) => item.id === id);
}

function weightOf(level) {
  return { 高: 3, 中: 2, 低: 1 }[level] || 0;
}

function defaultRoadmap() {
  return [
    {
      priority: "P0",
      title: "统一运营工作台",
      reason: "系统功能多、端口多，需要总控台承接整体梳理、跨端待办和后续开发顺序。",
      scope: ["系统总览", "跨端待办", "路线图"],
      status: "已完成",
      nextAction: "继续从工作台选择下一项 P0。"
    },
    {
      priority: "P0",
      title: "真实认证、角色权限和审计闭环",
      reason: "健康档案和电子病历属于敏感数据，当前登录仍是前端演示，需要后端会话、接口权限和审计。",
      scope: ["登录", "权限", "审计", "API"],
      status: "进行中",
      nextAction: "已完成后端会话、接口权限和安全事件第一版；下一步接入真实身份源、密码哈希和机构级权限。"
    },
    {
      priority: "P0",
      title: "SQLite 数据库迁移",
      reason: "JSON 适合演示，不适合长期开发。需要结构化表、索引、迁移脚本和数据备份。",
      scope: ["数据层", "持久化", "迁移"],
      status: "进行中",
      nextAction: "已完成 SQLite 主存储与 JSON 快照第一版；下一步拆分居民、病历、统计等结构化表和索引。"
    },
    {
      priority: "P1",
      title: "居民 360 详情与趋势图",
      reason: "医生和居民都需要按时间查看指标、病历、用药、检查、随访、取药和转诊。",
      scope: ["个人端", "医疗机构端", "健康档案"],
      status: "进行中",
      nextAction: "已在卫健委端居民详情中加入 360 总览、健康指标趋势、档案病历、协同闭环和访问审计；下一步接入真实连续指标。"
    },
    {
      priority: "P1",
      title: "业务动作闭环",
      reason: "当前多数状态为展示型，下一步要能接诊、审核、下转、完成取药、完成随访。",
      scope: ["分级诊疗", "医保", "取药", "随访"],
      status: "进行中",
      nextAction: "已新增通用业务闭环状态接口 /api/workflow-actions，并验证固定取药从机构确认到医保审核通过；下一步把四端页面按钮接入该接口。"
    },
    {
      priority: "P1",
      title: "检查检验互认与资源共享中心深化",
      reason: "县域医共体和分级诊疗都依赖医技共享、结果互认、危急值和质控。",
      scope: ["医共体", "医疗机构", "医保监管"],
      status: "待开发",
      nextAction: "新增影像、心电、检验互认台账和质控规则。"
    },
    {
      priority: "P2",
      title: "统计报表和绩效考核",
      reason: "卫健委和医共体办公室需要面向管理的月报、绩效、机构排名和导出能力。",
      scope: ["卫健委端", "县域医共体", "导出"],
      status: "待开发",
      nextAction: "补充月报生成、机构绩效评分和 CSV/JSON 导出。"
    },
    {
      priority: "P2",
      title: "移动端和适老化深化",
      reason: "居民端最终要在手机上使用，需要大字模式、家属代办、消息提醒和无障碍优化。",
      scope: ["个人端", "手机预览", "适老化"],
      status: "待开发",
      nextAction: "新增大字模式、提醒中心、家属代办入口。"
    }
  ];
}
