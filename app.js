const STORAGE_KEY = "chronic-care-platform-state";
const API_BASE = location.protocol === "file:" ? "" : "/api";
let apiEnabled = false;

const organizations = ["青泥洼桥社区卫生服务中心", "星海湾社区卫生服务中心", "甘井子区人民医院", "金普新区疾控中心"];

const seedState = {
  residents: [
    {
      id: "r1",
      name: "演示居民A",
      idCard: "DEMO-ID-R1",
      gender: "男",
      birthDate: "1968-02-11",
      phone: "DEMO-MOBILE-R1",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "演示地址A",
      metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
    },
    {
      id: "r2",
      name: "演示居民B",
      idCard: "DEMO-ID-R2",
      gender: "女",
      birthDate: "1975-05-20",
      phone: "DEMO-MOBILE-R2",
      organization: "星海湾社区卫生服务中心",
      familyDoctor: "赵医生",
      address: "演示地址B",
      metrics: { systolic: 138, diastolic: 84, glucose: 7.8, bmi: 25.1 }
    },
    {
      id: "r3",
      name: "演示居民C",
      idCard: "DEMO-ID-R3",
      gender: "男",
      birthDate: "1988-11-09",
      phone: "DEMO-MOBILE-R3",
      organization: "甘井子区人民医院",
      familyDoctor: "孙医生",
      address: "演示地址C",
      metrics: { systolic: 126, diastolic: 78, glucose: 5.5, bmi: 24.2 }
    },
    {
      id: "r4",
      name: "演示居民D",
      idCard: "DEMO-ID-R4",
      gender: "女",
      birthDate: "1964-10-01",
      phone: "DEMO-MOBILE-R4",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "演示地址D",
      metrics: { systolic: 148, diastolic: 88, glucose: 6.3, bmi: 28.6 }
    }
  ],
  diseases: [
    { id: "d1", residentId: "r1", type: "高血压", diagnosedAt: "2024-10-12", source: "社区筛查", status: "管理中", note: "需加强用药依从性" },
    { id: "d2", residentId: "r2", type: "糖尿病", diagnosedAt: "2024-11-03", source: "医院门诊", status: "需转诊", note: "血糖控制不佳" },
    { id: "d3", residentId: "r4", type: "高血压", diagnosedAt: "2025-01-18", source: "家庭医生随访", status: "稳定管理", note: "按季度复查" }
  ],
  followups: [
    { id: "f1", residentId: "r1", diseaseType: "高血压", plannedAt: todayOffset(-2), assignee: "刘医生", status: "已逾期", result: "未记录", advice: "补充电话随访" },
    { id: "f2", residentId: "r2", diseaseType: "糖尿病", plannedAt: todayOffset(0), assignee: "赵医生", status: "待随访", result: "未记录", advice: "复测空腹血糖" },
    { id: "f3", residentId: "r4", diseaseType: "高血压", plannedAt: todayOffset(5), assignee: "刘医生", status: "待随访", result: "未记录", advice: "记录家庭血压" },
    { id: "f4", residentId: "r3", diseaseType: "健康管理", plannedAt: todayOffset(-5), assignee: "孙医生", status: "已完成", result: "控制良好", advice: "保持运动" }
  ]
};

let state = structuredClone(seedState);

const titles = {
  dashboard: ["监管总览", "卫生健康委端：统筹居民、医疗机构、医保和基层随访协同。"],
  chronic: ["慢病医防整合", "作为卫健委端独立管理模块，统一管理筛查建档、慢病登记、随访干预、转诊协同、医保审核和固定取药。"],
  residents: ["居民档案", "管理居民基础信息、家庭医生和关键健康指标。"],
  diseases: ["慢病登记", "登记重点病种并基于指标生成风险分层。"],
  followups: ["随访管理", "跟踪计划、逾期提醒、干预建议和随访结果。"],
  analytics: ["统计分析", "按病种、机构、风险等级观察管理成效。"],
  governance: ["协同监管", "监测四端贯通、机构绩效、数据质量和风险预警。"],
  referral: ["分级诊疗", "落实基层首诊、双向转诊、急慢分治、上下联动和医保支付引导。"],
  emergency: ["公共卫生应急", "建设多点触发预警、资源调配、快速报送和协同处置能力，支撑早发现、早报告、早处置。"],
  security: ["数据安全审计", "围绕个人健康信息授权、访问留痕、脱敏展示、分级权限和合规审计构建安全底座。"],
  planning: ["国家规划对齐", "对照《“十四五”国家信息化规划》，补齐普惠数字医疗、数据共享、智慧监管、公共卫生应急和适老化服务。"]
};

const policyAlignmentDefaults = [
  { domain: "普惠数字医疗", requirement: "建设权威统一、互通共享的全民健康信息平台，推动医疗卫生机构数据共享互认和业务协同。", capability: "以个人健康信息库聚合电子病历、检查检验、用药、授权和慢病管理数据。", status: "已启动" },
  { domain: "医疗全流程在线办理", requirement: "加快异地转诊、就医、住院、医保等医疗全流程在线办理。", capability: "医疗机构端承接转诊协同，医保端承接结算审核，个人端承接固定取药和授权共享。", status: "原型完成" },
  { domain: "互联网医疗监管", requirement: "完善互联网医疗服务监管体系，推进互联网+监管和智慧监管。", capability: "卫健委端建设四端运行监测、机构绩效、风险预警和数据质量看板。", status: "已纳入" },
  { domain: "电子健康码与医保凭证", requirement: "普及居民电子健康码，加快医保电子凭证推广应用。", capability: "以身份证号+手机号形成 personIndex，后续可对接电子健康码、医保电子凭证和居民一卡通。", status: "数据底座完成" },
  { domain: "公共卫生应急", requirement: "建立智慧化预警多点触发机制，支持公共卫生机构和医疗机构数据共享，做到早发现、早报告、早处置。", capability: "在风险预警中汇聚慢病高危、随访逾期、医保异常和资源负荷，预留公共卫生应急监测入口。", status: "待扩展" },
  { domain: "基层智慧治理", requirement: "以数据驱动、信息共享提升基层治理和疫情防控能力。", capability: "基层机构、家庭医生、居民端、医保端共用同一居民主索引和慢病闭环台账。", status: "已启动" },
  { domain: "数据安全与合规", requirement: "完善数据脱敏、加密保护、合规评估和安全保障体系。", capability: "增加授权共享、撤销授权、数据质量审计，后续补充分级权限、脱敏展示和日志留痕。", status: "待扩展" },
  { domain: "适老化与无障碍", requirement: "优化信息无障碍环境，解决老年人等群体数字鸿沟。", capability: "个人端按手机视口设计，后续补充大字模式、家属代办、语音提示和线下帮办。", status: "待扩展" }
];

document.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  normalizePersonIndexes();
  bindNavigation();
  bindDialogs();
  bindForms();
  populateSelects();
  renderDataSource();
  render();
});

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function normalizePersonIndexes() {
  const residents = Array.isArray(state.residents) ? state.residents : [];
  residents.forEach((resident) => {
    resident.personIndex = personIndexFromParts(resident.idCard, resident.phone);
    resident.identityIndex = resident.personIndex;
  });
  const residentMap = new Map(residents.map((resident) => [resident.id, resident]));
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims", "seniorServices", "deathCertificates", "birthCertificates", "chronicScreeningTasks", "chronicEducationPushes", "chronicManagementPlans", "countyCollaborationOrders", "countyAiDiagnosisCases", "countyMutualRecognitionRecords"].forEach((key) => {
    (Array.isArray(state[key]) ? state[key] : []).forEach((item) => {
      item.personIndex = item.personIndex || personIndexForResident(residentMap, item.residentId);
    });
  });
  (Array.isArray(state.accounts) ? state.accounts : []).forEach((account) => {
    (Array.isArray(account.members) ? account.members : []).forEach((member) => {
      member.personIndex = member.personIndex || personIndexForResident(residentMap, member.residentId);
    });
  });
}

function personIndexFromParts(idCard, phone) {
  return `${String(idCard || "").trim()}#${String(phone || "").trim()}`;
}

function personIndexForResident(residentMap, residentId) {
  const resident = residentMap.get(residentId);
  return resident ? personIndexFromParts(resident.idCard, resident.phone) : "";
}

async function loadState() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`);
      if (response.ok) {
        apiEnabled = true;
        showToast("已连接本地服务，数据保存到 data/db.json");
        return await response.json();
      }
    } catch (error) {
      apiEnabled = false;
    }
  }
  try {
    const response = await fetch("./data/db.json");
    if (response.ok) {
      showToast("已加载开源演示数据");
      return await response.json();
    }
  } catch (error) {
    // Browser data fallback below.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  showToast("未连接本地服务，已切换为浏览器本地模式");
  return saved ? JSON.parse(saved) : structuredClone(seedState);
}

async function saveState() {
  normalizePersonIndexes();
  if (apiEnabled) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(state)
      });
      if (response.ok) return;
    } catch (error) {
      apiEnabled = false;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function bindNavigation() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.addEventListener("click", () => showView(button.dataset.view));
  });
  document.querySelector("#seed-data").addEventListener("click", async () => {
    if (apiEnabled) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/reset`, { method: "POST" });
      state = await response.json();
    } else {
      state = structuredClone(seedState);
    }
    await saveState();
    populateSelects();
    renderDataSource();
    render();
    showToast("演示数据已重置");
  });
  document.querySelector("#quick-add").addEventListener("click", () => openResidentDialog());
  document.querySelector("#export-data").addEventListener("click", exportCsv);
  document.querySelector("#resident-search").addEventListener("input", renderResidents);
  document.querySelector("#resident-org-filter").addEventListener("change", renderResidents);
}

function bindDialogs() {
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelector("#add-disease").addEventListener("click", () => document.querySelector("#disease-dialog").showModal());
  document.querySelector("#add-followup").addEventListener("click", () => openFollowupDialog());
}

function bindForms() {
  document.querySelector("#resident-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const resident = {
      id: data.id || crypto.randomUUID(),
      name: data.name,
      idCard: data.idCard,
      gender: data.gender,
      birthDate: data.birthDate,
      phone: data.phone,
      personIndex: personIndexFromParts(data.idCard, data.phone),
      identityIndex: personIndexFromParts(data.idCard, data.phone),
      organization: data.organization,
      familyDoctor: data.familyDoctor,
      address: data.address,
      metrics: {
        systolic: Number(data.systolic),
        diastolic: Number(data.diastolic),
        glucose: Number(data.glucose),
        bmi: Number(data.bmi)
      }
    };
    upsert(state.residents, resident);
    saveState();
    event.currentTarget.closest("dialog").close();
    populateSelects();
    render();
    showToast("居民档案已保存");
  });

  document.querySelector("#disease-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const disease = { id: crypto.randomUUID(), ...Object.fromEntries(new FormData(event.currentTarget)) };
    disease.personIndex = personIndexForResident(new Map(state.residents.map((resident) => [resident.id, resident])), disease.residentId);
    state.diseases.push(disease);
    saveState();
    event.currentTarget.reset();
    event.currentTarget.closest("dialog").close();
    render();
    showToast("慢病登记已保存");
  });

  document.querySelector("#followup-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const followup = Object.fromEntries(new FormData(event.currentTarget));
    followup.id = followup.id || crypto.randomUUID();
    followup.personIndex = personIndexForResident(new Map(state.residents.map((resident) => [resident.id, resident])), followup.residentId);
    upsert(state.followups, followup);
    saveState();
    event.currentTarget.closest("dialog").close();
    render();
    showToast("随访记录已保存");
  });
}

function populateSelects() {
  const residentOptions = state.residents.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
  document.querySelectorAll('select[name="residentId"]').forEach((select) => {
    select.innerHTML = residentOptions;
  });
  document.querySelector('select[name="organization"]').innerHTML = organizations.map((org) => `<option>${org}</option>`).join("");
  document.querySelector("#resident-org-filter").innerHTML = `<option value="">全部机构</option>${organizations.map((org) => `<option>${org}</option>`).join("")}`;
}

function showView(view) {
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.view === view));
  document.querySelectorAll(".view").forEach((item) => item.classList.toggle("active", item.id === view));
  document.querySelector("#view-title").textContent = titles[view][0];
  document.querySelector("#view-subtitle").textContent = titles[view][1];
  render();
}

function render() {
  refreshFollowupStatus();
  renderDataSource();
  renderDashboard();
  renderChronicModule();
  renderResidents();
  renderDiseases();
  renderFollowups();
  renderAnalytics();
  renderGovernance();
  renderReferralSystem();
  renderEmergency();
  renderSecurity();
  renderPlanning();
}

function refreshFollowupStatus() {
  const today = todayOffset(0);
  state.followups.forEach((item) => {
    if (item.status !== "已完成" && item.plannedAt < today) {
      item.status = "已逾期";
    }
  });
  saveState();
}

function renderDashboard() {
  const stats = getStats();
  const cards = [
    ["建档人数", stats.residents, "居民健康档案"],
    ["慢病人数", stats.chronicResidents, "已登记重点慢病"],
    ["高危人数", stats.highRisk, "需重点干预"],
    ["待随访", stats.pending, "含今日计划"],
    ["逾期随访", stats.overdue, "需尽快处理"],
    ["控制率", `${stats.controlRate}%`, "已完成随访中控制良好"]
  ];
  document.querySelector("#metric-cards").innerHTML = cards
    .map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`)
    .join("");

  const todos = state.followups
    .filter((item) => item.status !== "已完成")
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  document.querySelector("#todo-count").textContent = `${todos.length} 项`;
  document.querySelector("#todo-list").innerHTML = todos
    .map((item) => {
      const resident = findResident(item.residentId);
      return `<div class="list-item"><div><strong>${resident?.name || "未知居民"} · ${item.diseaseType}</strong><br><small>${item.plannedAt} · ${item.assignee} · ${item.advice || "暂无建议"}</small></div><span class="badge status-${item.status}">${item.status}</span></div>`;
    })
    .join("") || `<div class="subtle">暂无待办随访。</div>`;

  renderBars("#risk-bars", countBy(state.residents.map((item) => assessRisk(item).level)), ["低危", "中危", "高危"]);
}

function renderChronicModule() {
  const container = document.querySelector("#chronic-module-cards");
  if (!container) return;
  const stats = getStats();
  const chronicIds = new Set(state.diseases.map((item) => item.residentId));
  const chronicResidents = state.residents.filter((item) => chronicIds.has(item.id));
  const careOrders = state.careOrders || [];
  const pickups = state.medicationPickups || [];
  const claims = state.insuranceClaims || [];
  const linkedIndexes = new Set([
    ...state.diseases.map((item) => item.personIndex),
    ...state.followups.map((item) => item.personIndex),
    ...careOrders.map((item) => item.personIndex),
    ...pickups.map((item) => item.personIndex),
    ...claims.map((item) => item.personIndex)
  ].filter(Boolean));

  container.innerHTML = [
    ["纳管居民", stats.chronicResidents, "已进入慢病医防整合管理"],
    ["待随访", stats.pending, "基层家庭医生待处理"],
    ["转诊协同", careOrders.length, "医疗机构协同任务"],
    ["固定取药", pickups.length, "居民端每月取药计划"],
    ["医保审核", claims.filter((item) => item.status !== "已通过").length, "待医保联审"],
    ["主索引贯通", linkedIndexes.size, "身份证号 + 手机号"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#chronic-flow").innerHTML = [
    "筛查建档",
    "慢病登记",
    "风险分层",
    "随访干预",
    "转诊协同",
    "医保审核",
    "固定取药"
  ].map((step) => `<div>${step}</div>`).join("");

  document.querySelector("#chronic-ledger").innerHTML = `<table>
    <thead><tr><th>居民</th><th>统一索引</th><th>病种</th><th>风险</th><th>随访</th><th>协同</th><th>取药</th><th>医保</th></tr></thead>
    <tbody>${chronicResidents.map((resident) => {
      const diseases = state.diseases.filter((item) => item.residentId === resident.id).map((item) => item.type).join("、");
      const followups = state.followups.filter((item) => item.residentId === resident.id && item.status !== "已完成").length;
      const orders = careOrders.filter((item) => item.residentId === resident.id).length;
      const residentPickups = pickups.filter((item) => item.residentId === resident.id).length;
      const residentClaims = claims.filter((item) => item.residentId === resident.id && item.status !== "已通过").length;
      const risk = assessRisk(resident);
      return `<tr>
        <td>${resident.name}</td>
        <td><span class="subtle">${resident.personIndex}</span></td>
        <td>${diseases}</td>
        <td><span class="badge risk-${risk.level}">${risk.level}</span></td>
        <td>${followups}</td>
        <td>${orders}</td>
        <td>${residentPickups}</td>
        <td>${residentClaims}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  document.querySelector("#chronic-rules").innerHTML = [
    ["统一主索引", "居民个人数据统一使用“身份证号 + 手机号”形成 personIndex，跨端数据仍保留 residentId 便于内部关联。"],
    ["卫健委管理职责", "负责慢病纳管、质量控制、机构绩效、资源配置和跨端运行监测。"],
    ["跨端闭环", "个人端固定取药、医疗机构协同、医保审核结果统一回流到慢病医防整合模块。"]
  ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");

  document.querySelector("#pickup-workflow-table").innerHTML = `<table>
    <thead><tr><th>居民</th><th>药品</th><th>申请</th><th>机构确认</th><th>医保审核</th><th>药房状态</th><th>下次取药</th></tr></thead>
    <tbody>${pickups.map((item) => {
      const resident = findResident(item.residentId);
      return `<tr>
        <td>${resident?.name || "未知居民"}</td>
        <td>${item.medication}</td>
        <td>${item.applyMode || "本人申请"} · ${item.requestStatus || "待申请"}</td>
        <td>${item.institutionReview || "待确认"}</td>
        <td>${item.insuranceReview || "待审核"}</td>
        <td>${item.pharmacyStatus || item.status}</td>
        <td>${item.nextPickup}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  renderChronicProjectBlueprint();
  renderChronicOperations();
}

function renderChronicProjectBlueprint() {
  const blueprint = state.chronicProjectBlueprint || {};
  const architecture = blueprint.architecture || [];
  const networks = blueprint.networks || [];
  const aiAgents = blueprint.aiAgents || [];
  const studentCommonDisease = blueprint.studentCommonDisease || [];
  const assetRows = [
    ["专病库", (blueprint.diseaseLibraries || []).join("、")],
    ["筛查模型", (blueprint.screeningModels || []).join("、")],
    ["外部接口", (blueprint.externalInterfaces || []).join("、")],
    ["安全要求", (blueprint.security || []).join("、")]
  ];

  const architectureEl = document.querySelector("#chronic-blueprint-architecture");
  if (architectureEl) {
    architectureEl.innerHTML = architecture.map((item) => `<article class="metric-card">
      <span>${item.name}</span>
      <strong>${item.status || "已入模"}</strong>
      <em>${item.detail}</em>
    </article>`).join("");
  }

  const networksEl = document.querySelector("#chronic-blueprint-networks");
  if (networksEl) {
    networksEl.innerHTML = networks.map((item) => `<div>
      <strong>${item.name}</strong>
      <span>${item.users}：${(item.functions || []).join("、")}</span>
    </div>`).join("");
  }

  const aiEl = document.querySelector("#chronic-ai-agents");
  if (aiEl) {
    aiEl.innerHTML = aiAgents.map((item) => `<div>
      <strong>${item.name}</strong>
      <span>${item.scenario} 输出：${item.output}</span>
    </div>`).join("");
  }

  const assetsEl = document.querySelector("#chronic-blueprint-assets");
  if (assetsEl) {
    assetsEl.innerHTML = `<table>
      <thead><tr><th>类别</th><th>申报材料要求</th></tr></thead>
      <tbody>
        ${assetRows.map(([name, detail]) => `<tr><td>${name}</td><td>${detail || "待配置"}</td></tr>`).join("")}
        <tr>
          <td>学生常见病</td>
          <td>${studentCommonDisease.map((item) => `${item.name}：${item.workflow}，${item.output}`).join("；") || "待配置"}</td>
        </tr>
      </tbody>
    </table>`;
  }
}

function renderChronicOperations() {
  const screeningEl = document.querySelector("#chronic-screening-tasks");
  if (screeningEl) {
    const rows = state.chronicScreeningTasks || [];
    screeningEl.innerHTML = `<table>
      <thead><tr><th>居民</th><th>任务</th><th>模型</th><th>风险</th><th>责任人</th><th>截止</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${rows.map((item) => {
        const resident = findResident(item.residentId);
        return `<tr>
          <td>${resident?.name || "未知居民"}</td>
          <td>${item.taskName}<br><small>${item.nextStep}</small></td>
          <td>${item.model}</td>
          <td><span class="badge ${item.riskLevel === "高危" ? "danger" : "warn"}">${item.riskLevel}</span></td>
          <td>${item.assignee}<br><small>${item.institution}</small></td>
          <td>${item.due}</td>
          <td>${item.status}</td>
          <td>
            ${chronicActionButton("chronicScreeningTasks", item.id, "完成评估", { status: "已评估", result: "已生成风险分级和干预建议" })}
            ${chronicActionButton("chronicScreeningTasks", item.id, "推送干预", { status: "已推送干预", result: "已推送筛查后干预任务" })}
          </td>
        </tr>`;
      }).join("")}</tbody>
    </table>`;
  }

  const educationEl = document.querySelector("#chronic-education-pushes");
  if (educationEl) {
    educationEl.innerHTML = (state.chronicEducationPushes || []).map((item) => {
      const resident = findResident(item.residentId);
      return `<div>
        <strong>${resident?.name || "未知居民"} · ${item.topic}</strong>
        <span>${item.channel} · ${item.trigger} · ${item.status} · ${item.feedback}</span>
        ${chronicActionButton("chronicEducationPushes", item.id, "确认推送", { status: "已推送", feedback: "待阅读" })}
        ${chronicActionButton("chronicEducationPushes", item.id, "居民已读", { status: "已确认", feedback: "已阅读并确认" })}
      </div>`;
    }).join("");
  }

  const planEl = document.querySelector("#chronic-management-plans");
  if (planEl) {
    planEl.innerHTML = (state.chronicManagementPlans || []).map((item) => {
      const resident = findResident(item.residentId);
      return `<div>
        <strong>${resident?.name || "未知居民"} · ${item.diseaseType} · ${item.grade}</strong>
        <span>${item.plan}；指标：${(item.indicators || []).join("、")}；下次复核：${item.nextReview}</span>
        ${chronicActionButton("chronicManagementPlans", item.id, "复核完成", { status: "已复核", intervention: "已完成阶段复核并更新管理方案" })}
        ${chronicActionButton("chronicManagementPlans", item.id, "升级预警", { status: "预警中", intervention: "已升级为重点预警管理" })}
      </div>`;
    }).join("");
  }

  document.querySelectorAll("[data-chronic-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const collection = button.dataset.collection;
      const item = (state[collection] || []).find((row) => row.id === button.dataset.id);
      if (!item) return;
      Object.assign(item, JSON.parse(button.dataset.updates), { lastUpdated: new Date().toISOString() });
      await saveState();
      renderChronicModule();
      showToast("慢病业务状态已更新");
    });
  });
}

function chronicActionButton(collection, id, label, updates) {
  return `<button class="action-link" type="button" data-chronic-action data-collection="${collection}" data-id="${id}" data-updates='${JSON.stringify(updates)}'>${label}</button>`;
}

function renderResidents() {
  const keyword = document.querySelector("#resident-search")?.value?.trim() || "";
  const org = document.querySelector("#resident-org-filter")?.value || "";
  const rows = state.residents.filter((item) => {
    const matchesKeyword = [item.name, item.idCard, item.phone, item.personIndex].some((value) => String(value || "").includes(keyword));
    const matchesOrg = !org || item.organization === org;
    return matchesKeyword && matchesOrg;
  });
  document.querySelector("#resident-table").innerHTML = rows
    .map((item) => {
      const risk = assessRisk(item);
      return `<tr>
        <td><strong>${item.name}</strong><br><span class="subtle">${item.personIndex}</span></td>
        <td>${item.gender}</td>
        <td>${ageOf(item.birthDate)}</td>
        <td>${item.organization}</td>
        <td>${item.familyDoctor}</td>
        <td><span class="badge risk-${risk.level}">${risk.level}</span></td>
        <td>
          <button class="action-link" data-view-resident="${item.id}">详情</button>
          <button class="action-link" data-edit-resident="${item.id}">编辑</button>
        </td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-view-resident]").forEach((button) => {
    button.addEventListener("click", () => openResidentDetail(button.dataset.viewResident));
  });
  document.querySelectorAll("[data-edit-resident]").forEach((button) => {
    button.addEventListener("click", () => openResidentDialog(button.dataset.editResident));
  });
}

function renderDiseases() {
  document.querySelector("#disease-list").innerHTML = state.diseases
    .map((item) => {
      const resident = findResident(item.residentId);
      const risk = resident ? assessRisk(resident) : { level: "低危", reason: "" };
      return `<div class="list-item">
        <div>
          <strong>${resident?.name || "未知居民"} · ${item.type}</strong>
          <br><small>${item.diagnosedAt} · ${item.source} · ${item.note || "无备注"}</small>
          <br><small>评估依据：${risk.reason}</small>
        </div>
        <div><span class="badge risk-${risk.level}">${risk.level}</span> <span class="badge status-${item.status}">${item.status}</span></div>
      </div>`;
    })
    .join("") || `<div class="subtle">暂无慢病登记。</div>`;
}

function renderFollowups() {
  document.querySelector("#followup-table").innerHTML = state.followups
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .map((item) => {
      const resident = findResident(item.residentId);
      return `<tr>
        <td>${resident?.name || "未知居民"}</td>
        <td>${item.diseaseType}</td>
        <td>${item.plannedAt}</td>
        <td>${item.assignee}</td>
        <td><span class="badge status-${item.status}">${item.status}</span></td>
        <td>${item.result}</td>
        <td>
          <button class="action-link" data-edit-followup="${item.id}">记录</button>
          ${item.status === "已完成" ? "" : `<button class="action-link" data-complete-followup="${item.id}">完成</button>`}
        </td>
      </tr>`;
    })
    .join("");
  document.querySelectorAll("[data-edit-followup]").forEach((button) => {
    button.addEventListener("click", () => openFollowupDialog(button.dataset.editFollowup));
  });
  document.querySelectorAll("[data-complete-followup]").forEach((button) => {
    button.addEventListener("click", () => completeFollowup(button.dataset.completeFollowup));
  });
}

function renderAnalytics() {
  renderBars("#disease-bars", countBy(state.diseases.map((item) => item.type)), ["高血压", "糖尿病", "冠心病", "脑卒中"]);
  renderBars("#org-bars", countBy(state.residents.map((item) => item.organization)), organizations);
  renderStatisticsAnalytics();
  renderDalianHealthStatistics2025();
  renderBirthHealthManagement();
  renderHealthStatisticsIngestion();
  renderHealthBulletin2024();
}

function renderGovernance() {
  renderPortalGrid();
  renderWarnings();
  renderMedicalResources();
  renderHealthStatistics();
  renderDeathStatistics();
  renderBirthStatistics();
  renderPerformanceTable();
  renderQualityBars();
}

function renderReferralSystem() {
  const referral = state.referralSystem || {};
  const referrals = referral.referrals || [];
  const up = referrals.filter((item) => item.type === "上转").length;
  const down = referrals.filter((item) => item.type === "下转").length;
  const pending = referrals.filter((item) => !["已接诊", "基层承接", "已完成"].includes(item.status)).length;
  const slots = (referral.reservedResources || []).reduce((sum, item) => sum + Number(item.outpatientSlots || 0), 0);
  const beds = (referral.reservedResources || []).reduce((sum, item) => sum + Number(item.beds || 0), 0);
  document.querySelector("#referral-cards").innerHTML = [
    ["转诊单", referrals.length, "上转、下转、跨域转诊"],
    ["上转", up, "基层到二三级医院"],
    ["下转", down, "恢复期和稳定期回基层"],
    ["待接诊", pending, "需转诊中心跟踪"],
    ["预留号源", slots, "牵头医院优先接诊"],
    ["预留床位", beds, "住院一体化管理"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#referral-rules").innerHTML = (referral.rules || [])
    .map((item) => `<div><strong>${item.name}</strong><span>${item.scenario}：${item.action}<br>${item.owner}</span></div>`)
    .join("") || `<div class="subtle">暂无分级诊疗规则。</div>`;

  document.querySelector("#referral-roles").innerHTML = (referral.institutionRoles || [])
    .map((item) => `<div><strong>${item.level}</strong><span>${item.role}<br>门诊重点：${item.outpatientFocus}<br>转诊职责：${item.gatekeeping}</span></div>`)
    .join("") || `<div class="subtle">暂无机构功能定位。</div>`;

  document.querySelector("#referral-count").textContent = `${referrals.length} 条`;
  document.querySelector("#referral-table").innerHTML = `<table>
    <thead><tr><th>居民</th><th>类型</th><th>病种</th><th>转出</th><th>转入</th><th>原因</th><th>资源</th><th>状态</th></tr></thead>
    <tbody>${referrals.map((item) => {
      const resident = findResident(item.residentId);
      const badge = item.priority === "高" ? "danger" : item.status.includes("待") ? "warn" : "info";
      return `<tr>
        <td>${resident?.name || "未知居民"}</td>
        <td>${item.type}</td>
        <td>${item.diseaseType}</td>
        <td>${item.from}</td>
        <td>${item.to}</td>
        <td>${item.reason}</td>
        <td>${item.reservedResource}</td>
        <td><span class="badge ${badge}">${item.status}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  document.querySelector("#reserved-resource-table").innerHTML = `<table>
    <thead><tr><th>机构</th><th>科室</th><th>预留号源</th><th>床位</th><th>用途</th><th>状态</th></tr></thead>
    <tbody>${(referral.reservedResources || []).map((item) => `<tr>
      <td>${item.institution}</td>
      <td>${item.department}</td>
      <td>${item.outpatientSlots}</td>
      <td>${item.beds}</td>
      <td>${item.forPrimaryReferral}</td>
      <td><span class="badge info">${item.status}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;

  document.querySelector("#referral-insurance-rules").innerHTML = (referral.insuranceGuidance || [])
    .map((item) => `<div><strong>${item.item}</strong><span>${item.policy}<br>${item.status}</span></div>`)
    .join("") || `<div class="subtle">暂无医保支付引导规则。</div>`;

  document.querySelector("#referral-education").innerHTML = (referral.education || [])
    .map((item) => `<div><strong>${item.title}</strong><span>${item.audience} · ${item.channel}<br>${item.message}</span></div>`)
    .join("") || `<div class="subtle">暂无分级诊疗宣传内容。</div>`;
}

function renderPlanning() {
  const items = state.policyAlignment || policyAlignmentDefaults;
  const started = items.filter((item) => ["已启动", "原型完成", "已纳入", "数据底座完成"].includes(item.status)).length;
  const pending = items.length - started;
  const sharedCollections = ["residents", "personalRecords", "diseases", "followups", "careOrders", "insuranceClaims", "medicationPickups", "seniorServices", "digitalCredentials"];
  const indexedCollections = sharedCollections.filter((key) => (state[key] || []).some((item) => item.personIndex));
  document.querySelector("#planning-cards").innerHTML = [
    ["规划映射", items.length, "国家信息化规划能力项"],
    ["已落地/已启动", started, "可在当前 MVP 中演示"],
    ["待扩展", pending, "安全、应急、适老化深化"],
    ["共享数据集", indexedCollections.length, "已接入 personIndex"],
    ["授权记录", (state.personalRecords || []).filter((item) => item.category === "authorizations").length, "居民授权共享"],
    ["监管预警", document.querySelectorAll("#warning-list .list-item").length || 0, "风险识别入口"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#planning-table").innerHTML = `<table>
    <thead><tr><th>规划方向</th><th>规划要求</th><th>系统落点</th><th>状态</th></tr></thead>
    <tbody>${items.map((item) => `<tr><td>${item.domain}</td><td>${item.requirement}</td><td>${item.capability}</td><td><span class="badge ${item.status.includes("待") ? "warn" : "info"}">${item.status}</span></td></tr>`).join("")}</tbody>
  </table>`;

  document.querySelector("#planning-rules").innerHTML = [
    ["一体化", "卫健委、医疗机构、医保、个人端共享同一居民主索引，减少重复采集。"],
    ["普惠化", "个人端优先围绕健康档案、电子病历、慢病取药和授权共享，服务普通居民与老年慢病人群。"],
    ["监管化", "把医疗资源、机构绩效、医保审核、慢病质量和数据质量纳入卫健委端统一监管。"],
    ["开放化", "项目按 MIT 协议开源，适合继续拆分为前端静态演示和后端 API 服务。"]
  ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");

  document.querySelector("#planning-security").innerHTML = [
    ["数据最小够用", "演示环境只使用样例身份证号和手机号；真实部署需采用脱敏、加密、分级授权和审计日志。"],
    ["授权优先", "个人健康信息库通过授权记录控制医疗机构、家庭医生和区域平台的数据查看范围。"],
    ["应急预留", "公共卫生应急可从风险预警扩展，接入传染病、资源负荷、药品物资和多点触发预警。"],
    ["适老化预留", "居民端后续增加大字模式、家属代办、固定取药提醒、线下服务二维码和无障碍标签。"]
  ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
}

function renderEmergency() {
  const signals = state.emergencySignals || [];
  const high = signals.filter((item) => item.level === "高").length;
  const pending = signals.filter((item) => item.status !== "已处置").length;
  const resources = state.medicalResources || [];
  const beds = resources.reduce((sum, item) => sum + Number(item.beds || 0), 0);
  document.querySelector("#emergency-cards").innerHTML = [
    ["预警信号", signals.length, "多点触发监测"],
    ["高等级", high, "需联动处置"],
    ["待处置", pending, "需跟踪闭环"],
    ["可调配床位", beds, "区域医疗资源"],
    ["基层机构", resources.filter((item) => String(item.type || "").includes("基层")).length, "社区服务承接"],
    ["固定取药", (state.medicationPickups || []).length, "慢病药品保障"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#emergency-count").textContent = `${signals.length} 条`;
  document.querySelector("#emergency-signals").innerHTML = signals
    .map((item) => `<div class="list-item">
      <div>
        <strong>${item.title}</strong><br>
        <small>${item.source} · ${item.region} · ${item.date}</small><br>
        <small>${item.action}</small>
      </div>
      <span class="badge ${item.level === "高" ? "danger" : item.level === "中" ? "warn" : "info"}">${item.level} · ${item.status}</span>
    </div>`)
    .join("") || `<div class="subtle">暂无公共卫生应急预警。</div>`;

  document.querySelector("#emergency-flow").innerHTML = [
    "多点触发",
    "自动汇聚",
    "集中研判",
    "快速报送",
    "资源调配",
    "处置反馈"
  ].map((step) => `<div>${step}</div>`).join("");

  document.querySelector("#emergency-resources").innerHTML = `<table>
    <thead><tr><th>机构</th><th>区域</th><th>床位</th><th>医生</th><th>慢病门诊</th><th>应急角色</th></tr></thead>
    <tbody>${resources.map((item) => `<tr>
      <td>${item.institution}</td>
      <td>${item.region}</td>
      <td>${item.beds}</td>
      <td>${item.doctors}</td>
      <td>${item.chronicClinics}</td>
      <td>${Number(item.beds || 0) >= 500 ? "区域救治支撑" : "基层监测随访"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderSecurity() {
  const logs = state.dataAccessLogs || [];
  const authorizations = (state.personalRecords || []).filter((item) => item.category === "authorizations");
  const activeAuth = authorizations.filter((item) => item.meta?.status !== "revoked").length;
  const sensitiveCollections = ["residents", "personalRecords", "insuranceClaims", "medicationPickups", "seniorServices"];
  const indexed = sensitiveCollections.filter((key) => (state[key] || []).some((item) => item.personIndex || item.identityIndex)).length;
  const denied = logs.filter((item) => item.result === "拒绝").length;

  document.querySelector("#security-cards").innerHTML = [
    ["访问日志", logs.length, "跨端访问留痕"],
    ["有效授权", activeAuth, "居民授权共享"],
    ["拒绝访问", denied, "越权或授权不足"],
    ["敏感数据集", sensitiveCollections.length, "需分级保护"],
    ["已索引数据集", indexed, "personIndex 贯通"],
    ["脱敏策略", 4, "身份证、手机号、病历、医保"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#audit-count").textContent = `${logs.length} 条`;
  document.querySelector("#audit-table").innerHTML = `<table>
    <thead><tr><th>时间</th><th>访问方</th><th>居民</th><th>数据范围</th><th>用途</th><th>结果</th></tr></thead>
    <tbody>${logs.map((log) => {
      const resident = findResident(log.residentId);
      return `<tr>
        <td>${log.at}</td>
        <td>${log.actor}</td>
        <td>${resident?.name || log.personIndex || "未知"}</td>
        <td>${log.scope}</td>
        <td>${log.purpose}</td>
        <td><span class="badge ${log.result === "拒绝" ? "danger" : "info"}">${log.result}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  document.querySelector("#authorization-list").innerHTML = authorizations
    .map((item) => {
      const resident = findResident(item.residentId);
      const revoked = item.meta?.status === "revoked";
      return `<div class="list-item">
        <div>
          <strong>${resident?.name || "未知居民"} · ${item.name}</strong><br>
          <small>${item.result} · ${item.date}</small>
        </div>
        <span class="badge ${revoked ? "warn" : "info"}">${revoked ? "已撤销" : "有效"}</span>
      </div>`;
    })
    .join("") || `<div class="subtle">暂无居民授权记录。</div>`;

  document.querySelector("#security-rules").innerHTML = [
    ["身份证与手机号脱敏", "列表默认只展示后四位，完整 personIndex 仅在授权详情、审计导出或管理员权限下查看。"],
    ["最小必要授权", "医疗机构、医保端和基层团队按诊疗、审核、随访、取药等用途申请不同数据范围。"],
    ["全量访问留痕", "所有查看电子病历、检查检验、医保结算和授权记录的动作写入 dataAccessLogs。"],
    ["异常访问预警", "拒绝访问、非工作时间批量查看、跨机构查看等行为进入协同监管和安全审计看板。"]
  ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
}

function renderPortalGrid() {
  const portals = [
    ["居民端", state.accounts?.length || 0, "个人账户"],
    ["医疗机构端", state.careOrders?.length || 0, "协同任务"],
    ["医保端", state.insuranceClaims?.length || 0, "结算审核"],
    ["卫健委端", state.residents.length, "监管对象"]
  ];
  document.querySelector("#portal-health").textContent = "运行中";
  document.querySelector("#portal-grid").innerHTML = portals
    .map(([name, value, hint]) => `<article><span>${name}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");
}

function renderWarnings() {
  const warnings = [];
  state.residents.forEach((resident) => {
    const risk = assessRisk(resident);
    if (risk.level === "高危") warnings.push([resident.name, "高危慢病指标", risk.reason, "danger"]);
  });
  state.followups.filter((item) => item.status === "已逾期").forEach((item) => {
    warnings.push([findResident(item.residentId)?.name || "未知居民", "随访逾期", `${item.diseaseType} · ${item.plannedAt}`, "warn"]);
  });
  (state.insuranceClaims || []).filter((item) => item.status !== "已通过").forEach((item) => {
    warnings.push([findResident(item.residentId)?.name || "未知居民", "医保审核待处理", `${item.claimType} · ${item.risk}`, "info"]);
  });
  document.querySelector("#warning-count").textContent = `${warnings.length} 项`;
  document.querySelector("#warning-list").innerHTML = warnings
    .map(([name, title, detail, level]) => `<div class="list-item"><div><strong>${name} · ${title}</strong><br><small>${detail}</small></div><span class="badge ${level}">${level === "danger" ? "高" : level === "warn" ? "中" : "提示"}</span></div>`)
    .join("") || `<div class="subtle">暂无风险预警。</div>`;
}

function renderMedicalResources() {
  const resources = state.medicalResources || [];
  const beds = resources.reduce((sum, item) => sum + Number(item.beds || 0), 0);
  const doctors = resources.reduce((sum, item) => sum + Number(item.doctors || 0), 0);
  const clinics = resources.reduce((sum, item) => sum + Number(item.chronicClinics || 0), 0);
  document.querySelector("#resource-summary").textContent = `${resources.length} 家机构 · ${beds} 张床位 · ${doctors} 名医生 · ${clinics} 个慢病门诊`;
  document.querySelector("#resource-table").innerHTML = `<table>
    <thead><tr><th>机构</th><th>类型</th><th>区域</th><th>床位</th><th>医生</th><th>护士</th><th>慢病门诊</th><th>设备</th></tr></thead>
    <tbody>${resources.map((row) => `<tr><td>${row.institution}</td><td>${row.type}</td><td>${row.region}</td><td>${row.beds}</td><td>${row.doctors}</td><td>${row.nurses}</td><td>${row.chronicClinics}</td><td>${row.devices}</td></tr>`).join("")}</tbody>
  </table>`;
}

function renderHealthStatistics() {
  const statistics = getHealthStatistics();
  const resourceTotals = sumNested(statistics.resourceReports, "interfaceData", ["beds", "doctors", "nurses"]);
  const directResourceTotals = sumNested(statistics.resourceReports, "directReport", ["beds", "doctors", "nurses"]);
  const serviceTotals = sumNested(statistics.serviceReports, "interfaceData", ["outpatientVisits", "emergencyVisits", "inpatientAdmissions", "discharges", "bedDays"]);
  const directServiceTotals = sumNested(statistics.serviceReports, "directReport", ["outpatientVisits", "emergencyVisits", "inpatientAdmissions", "discharges", "bedDays"]);
  const resourceIssues = statistics.resourceReports.filter((item) => item.status !== "已一致").length;
  const serviceIssues = statistics.serviceReports.filter((item) => item.status !== "已一致").length;

  document.querySelector("#health-stat-summary").textContent = `${formatPeriod(statistics.period)} · 医疗机构接口 + 卫生健康统计直报系统`;
  document.querySelector("#health-stat-metrics").innerHTML = [
    ["实有床位", resourceTotals.beds, `直报 ${directResourceTotals.beds}`],
    ["执业医生", resourceTotals.doctors, `直报 ${directResourceTotals.doctors}`],
    ["注册护士", resourceTotals.nurses, `直报 ${directResourceTotals.nurses}`],
    ["门急诊量", serviceTotals.outpatientVisits + serviceTotals.emergencyVisits, `直报 ${directServiceTotals.outpatientVisits + directServiceTotals.emergencyVisits}`],
    ["入院量", serviceTotals.inpatientAdmissions, `直报 ${directServiceTotals.inpatientAdmissions}`],
    ["出院量", serviceTotals.discharges, `直报 ${directServiceTotals.discharges}`],
    ["实际占用总床日", serviceTotals.bedDays, `直报 ${directServiceTotals.bedDays}`],
    ["待复核机构", resourceIssues + serviceIssues, "资源/服务量差异"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${formatNumber(value)}</strong><em>${hint}</em></article>`).join("");

  document.querySelector("#health-stat-sources").innerHTML = (statistics.sources || []).map((source) => `<article>
    <span>${source.name}</span>
    <strong>${source.status}</strong>
    <small>${source.system}<br>${source.scope}<br>${source.updateCycle}</small>
  </article>`).join("");

  document.querySelector("#health-stat-resource-check").innerHTML = `<table>
    <thead><tr><th>机构</th><th>区域</th><th>类型</th><th>接口床位/医生/护士</th><th>直报床位/医生/护士</th><th>差异</th><th>状态</th><th>说明</th></tr></thead>
    <tbody>${statistics.resourceReports.map((row) => {
      const diff = resourceDiff(row);
      return `<tr>
        <td>${row.institution}</td>
        <td>${row.region}</td>
        <td>${row.type}</td>
        <td>${row.interfaceData.beds}/${row.interfaceData.doctors}/${row.interfaceData.nurses}</td>
        <td>${row.directReport.beds}/${row.directReport.doctors}/${row.directReport.nurses}</td>
        <td>${diff.beds}/${diff.doctors}/${diff.nurses}</td>
        <td><span class="badge ${row.status === "已一致" ? "info" : "warn"}">${row.status}</span></td>
        <td>${row.issue}</td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;

  document.querySelector("#health-stat-service-table").innerHTML = `<table>
    <thead><tr><th>机构</th><th>接口门急诊</th><th>接口入院</th><th>接口出院</th><th>接口床日</th><th>直报门急诊</th><th>直报入院/出院/床日</th><th>状态</th></tr></thead>
    <tbody>${statistics.serviceReports.map((row) => {
      const interfaceVisits = row.interfaceData.outpatientVisits + row.interfaceData.emergencyVisits;
      const directVisits = row.directReport.outpatientVisits + row.directReport.emergencyVisits;
      return `<tr>
        <td>${row.institution}</td>
        <td>${formatNumber(interfaceVisits)}</td>
        <td>${formatNumber(row.interfaceData.inpatientAdmissions)}</td>
        <td>${formatNumber(row.interfaceData.discharges)}</td>
        <td>${formatNumber(row.interfaceData.bedDays)}</td>
        <td>${formatNumber(directVisits)}</td>
        <td>${formatNumber(row.directReport.inpatientAdmissions)} / ${formatNumber(row.directReport.discharges)} / ${formatNumber(row.directReport.bedDays)}</td>
        <td><span class="badge ${row.status === "已一致" ? "info" : "warn"}">${row.status}</span></td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}

function renderDeathStatistics() {
  const death = getDeathStatistics();
  const metrics = death.metrics || {};
  const summary = document.querySelector("#death-stat-summary");
  const cards = document.querySelector("#death-stat-cards");
  const sources = document.querySelector("#death-stat-sources");
  const causeTable = document.querySelector("#death-cause-ranking");
  const regionTable = document.querySelector("#death-region-table");
  const rules = document.querySelector("#death-stat-rules");
  if (!summary || !cards || !sources || !causeTable || !regionTable || !rules) return;

  summary.textContent = `${formatPeriod(death.period)} · 医疗机构死亡医学证明系统 + 人口死亡信息登记系统`;
  cards.innerHTML = [
    ["死亡证明", metrics.total || 0, "医疗机构登记个案"],
    ["已签发", metrics.signed || 0, "正常死亡 1 日内"],
    ["已上报", metrics.reported || 0, "人口死亡信息登记"],
    ["电子证照", metrics.electronicLicenses || 0, "省级/国家平台"],
    ["纸质证明", metrics.paperCertificates || 0, "公安、近亲属、存根联"],
    ["待处理", metrics.pending || 0, "待签发或待上报"],
    ["院外死亡", metrics.homeOrOtherPlace || 0, "家中、民政或其他场所"],
    ["质控通过", metrics.qualityPass || 0, "死因链与编码"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${formatNumber(value)}</strong><em>${hint}</em></article>`).join("");

  sources.innerHTML = (death.sources || []).map((source) => `<article>
    <span>${source.name}</span>
    <strong>${source.status}</strong>
    <small>${source.scope}</small>
  </article>`).join("");

  causeTable.innerHTML = `<table>
    <thead><tr><th>死因类别</th><th>ICD-10</th><th>死亡数</th><th>占比</th><th>趋势</th></tr></thead>
    <tbody>${(death.causeRanking || []).map((row) => `<tr>
      <td>${row.cause}</td>
      <td>${row.icd10Range}</td>
      <td>${row.deaths}</td>
      <td>${row.share}</td>
      <td><span class="badge ${row.trend === "需关注" ? "warn" : "info"}">${row.trend}</span></td>
    </tr>`).join("")}</tbody>
  </table>`;

  regionTable.innerHTML = `<table>
    <thead><tr><th>地区</th><th>死亡证明数</th><th>粗死亡率</th><th>上报率</th><th>逾期</th></tr></thead>
    <tbody>${(death.regionStats || []).map((row) => `<tr>
      <td>${row.region}</td>
      <td>${row.deaths}</td>
      <td>${row.crudeMortality}</td>
      <td>${row.reportedRate}</td>
      <td>${row.overdue}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  rules.innerHTML = [
    ...(death.workflowRules || []),
    ...(death.dataSharing || []).map((item) => ({ rule: item.target, deadline: item.data, owner: item.status, status: item.status }))
  ].map((item) => `<div><strong>${item.rule}</strong><span>${item.deadline || item.detail}<br>${item.owner || ""} · ${item.status || ""}</span></div>`).join("");
}

function renderBirthStatistics() {
  const birth = getBirthStatistics();
  const metrics = birth.metrics || {};
  const summary = document.querySelector("#birth-stat-summary");
  const cards = document.querySelector("#birth-stat-cards");
  const sources = document.querySelector("#birth-stat-sources");
  const regionTable = document.querySelector("#birth-region-table");
  const rules = document.querySelector("#birth-stat-rules");
  if (!summary || !cards || !sources || !regionTable || !rules) return;

  summary.textContent = `${formatPeriod(birth.period)} · 出生医学证明系统 + 妇幼健康管理 + 公安户籍共享`;
  cards.innerHTML = [
    ["出生证明", metrics.total || 0, "医疗机构登记个案"],
    ["首次签发", metrics.firstIssued || 0, "机构内出生直接签发"],
    ["换发补发", metrics.reissued || 0, "原因登记与原证归档"],
    ["电子证照", metrics.electronicLicenses || 0, "第七版证件同步"],
    ["公安共享", metrics.publicSecuritySynced || 0, "出生登记依据"],
    ["妇幼入册", metrics.maternalChildSynced || 0, "新生儿健康管理"],
    ["低体重儿", metrics.lowBirthWeight || 0, "专案随访"],
    ["待处理", metrics.pending || 0, "待签发或待上报"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${formatNumber(value)}</strong><em>${hint}</em></article>`).join("");

  sources.innerHTML = (birth.sources || []).map((source) => `<article>
    <span>${source.name}</span>
    <strong>${source.status}</strong>
    <small>${source.scope}</small>
  </article>`).join("");

  regionTable.innerHTML = `<table>
    <thead><tr><th>地区</th><th>出生证明数</th><th>首次签发率</th><th>公安共享率</th><th>低体重儿</th></tr></thead>
    <tbody>${(birth.regionStats || []).map((row) => `<tr>
      <td>${row.region}</td>
      <td>${row.births}</td>
      <td>${row.firstIssueRate}</td>
      <td>${row.publicSecuritySyncRate}</td>
      <td>${row.lowBirthWeight}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  rules.innerHTML = (birth.workflowRules || []).map((item) => `<div><strong>${item.rule}</strong><span>${item.deadline || item.detail}<br>${item.owner || ""} · ${item.status || ""}</span></div>`).join("");
}

function renderBirthHealthManagement() {
  const birth = getBirthStatistics();
  const metrics = birth.metrics || {};
  const summary = document.querySelector("#birth-health-summary");
  const cards = document.querySelector("#birth-health-cards");
  const services = document.querySelector("#birth-health-services");
  if (!summary || !cards || !services) return;

  summary.textContent = `${formatPeriod(birth.period)} · 出生证明自动触发新生儿健康管理任务`;
  cards.innerHTML = [
    ["妇幼入册", metrics.maternalChildSynced || 0, "出生个案转健康管理"],
    ["待访视", metrics.pending || 0, "待签发/待上报同步处理"],
    ["低体重儿", metrics.lowBirthWeight || 0, "专案随访"],
    ["质控通过", metrics.qualityPass || 0, "材料与证件编号核验"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${formatNumber(value)}</strong><em>${hint}</em></article>`).join("");
  services.innerHTML = (birth.healthManagement || []).map((item) => `<article>
    <strong>${item.service}</strong>
    <span>${item.target}</span>
    <span class="badge info">${item.status}</span>
  </article>`).join("");
}

function renderStatisticsAnalytics() {
  const statistics = getHealthStatistics();
  const resourceTotals = sumNested(statistics.resourceReports, "interfaceData", ["beds", "doctors", "nurses"]);
  const serviceTotals = sumNested(statistics.serviceReports, "interfaceData", ["outpatientVisits", "emergencyVisits", "inpatientAdmissions", "discharges", "bedDays"]);
  const resourceIssues = statistics.resourceReports.filter((item) => item.status !== "已一致").length;
  const serviceIssues = statistics.serviceReports.filter((item) => item.status !== "已一致").length;
  document.querySelector("#analytics-stat-summary").textContent = `${formatPeriod(statistics.period)} · 资源、诊疗量、住院量统一统计`;
  document.querySelector("#analytics-stat-cards").innerHTML = [
    ["床位", resourceTotals.beds, "医疗卫生资源"],
    ["医生", resourceTotals.doctors, "医疗卫生人员"],
    ["护士", resourceTotals.nurses, "护理人员"],
    ["门急诊量", serviceTotals.outpatientVisits + serviceTotals.emergencyVisits, "诊疗服务量"],
    ["住院量", serviceTotals.inpatientAdmissions, "入院人次"],
    ["出院量", serviceTotals.discharges, "出院人次"],
    ["床日", serviceTotals.bedDays, "实际占用总床日"],
    ["复核项", resourceIssues + serviceIssues, "双源对账差异"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${formatNumber(value)}</strong><em>${hint}</em></article>`).join("");
  document.querySelector("#analytics-stat-quality").innerHTML = (statistics.qualityRules || []).map((rule) => `<article>
    <strong>${rule.rule}</strong>
    <span>${rule.detail}</span>
    <span class="badge info">${rule.status}</span>
  </article>`).join("");
}

function renderHealthBulletin2024() {
  const bulletin = getHealthBulletin2024();
  document.querySelector("#bulletin-summary").textContent = `${bulletin.year} · ${bulletin.source}`;
  document.querySelector("#bulletin-key-cards").innerHTML = (bulletin.keyIndicators || []).map((item) => `<article class="metric-card">
    <span>${item.label}</span>
    <strong>${formatNumber(item.value)}${item.unit}</strong>
    <em>${item.hint}</em>
  </article>`).join("");

  document.querySelector("#bulletin-domain-grid").innerHTML = (bulletin.domains || []).map((item) => `<article>
    <span>${item.name}</span>
    <strong>${item.value}</strong>
    <p>${item.detail}</p>
    <small>${item.status}</small>
  </article>`).join("");

  document.querySelector("#bulletin-trend-bars").innerHTML = (bulletin.trends || []).map((item) => {
    const max = Math.max(Number(item.previous || 0), Number(item.current || 0), 1);
    const previousWidth = Math.max(3, (Number(item.previous || 0) / max) * 100);
    const currentWidth = Math.max(3, (Number(item.current || 0) / max) * 100);
    const diff = Number(item.current || 0) - Number(item.previous || 0);
    const change = item.previous ? ((diff / Number(item.previous)) * 100).toFixed(1) : "0.0";
    return `<section class="bulletin-bar">
      <header>
        <strong>${item.label}</strong>
        <span>${diff >= 0 ? "+" : ""}${formatNumber(diff)}${item.unit} · ${change}%</span>
      </header>
      <div class="compare-row"><span>2023</span><div class="compare-track"><i style="width:${previousWidth}%"></i></div><em>${formatNumber(item.previous)}${item.unit}</em></div>
      <div class="compare-row current"><span>2024</span><div class="compare-track"><i style="width:${currentWidth}%"></i></div><em>${formatNumber(item.current)}${item.unit}</em></div>
    </section>`;
  }).join("");

  document.querySelector("#bulletin-detail-table").innerHTML = `<table>
    <thead><tr><th>领域</th><th>指标</th><th>2023</th><th>2024</th><th>变化</th></tr></thead>
    <tbody>${(bulletin.details || []).map((row) => `<tr>
      <td>${row.domain}</td>
      <td>${row.indicator}</td>
      <td>${row.value2023}</td>
      <td>${row.value2024}</td>
      <td>${row.change}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function renderDalianHealthStatistics2025() {
  const dalian = getDalianHealthStatistics2025();
  document.querySelector("#dalian-stat-summary").textContent = `${dalian.year} · ${dalian.source} · ${dalian.status}`;
  document.querySelector("#dalian-stat-cards").innerHTML = (dalian.keyIndicators || []).map((item) => `<article class="metric-card">
    <span>${item.label}</span>
    <strong>${formatNumber(item.value)}${item.unit}</strong>
    <em>${item.hint}</em>
  </article>`).join("");

  document.querySelector("#dalian-stat-domains").innerHTML = (dalian.domains || []).map((item) => `<article>
    <span>${item.name}</span>
    <strong>${item.value}</strong>
    <p>${item.detail}</p>
    <small>${item.status}</small>
  </article>`).join("");

  document.querySelector("#dalian-national-compare").innerHTML = `<table>
    <thead><tr><th>指标</th><th>大连 2025</th><th>全国 2024</th><th>差异</th><th>解读</th></tr></thead>
    <tbody>${(dalian.nationalComparisons || []).map((row) => `<tr>
      <td>${row.indicator}</td>
      <td>${row.dalian}</td>
      <td>${row.national}</td>
      <td>${row.delta}</td>
      <td>${row.interpretation}</td>
    </tr>`).join("")}</tbody>
  </table>`;

  document.querySelector("#dalian-stat-pipeline").innerHTML = (dalian.dataPipeline || []).map((step) => `<article>
    <strong>${step.name}</strong>
    <span>${step.detail}</span>
    <span class="badge info">${step.status}</span>
  </article>`).join("");
}

function renderHealthStatisticsIngestion() {
  const ingestion = getHealthStatisticsIngestion();
  document.querySelector("#stat-ingestion-workflow").innerHTML = (ingestion.workflow || []).map((step, index) => {
    const width = Math.min(100, Math.max(8, Number(step.progress || 0)));
    return `<section class="bulletin-bar">
      <header>
        <strong>${index + 1}. ${step.name}</strong>
        <span>${step.owner} · ${step.status}</span>
      </header>
      <div class="compare-row current"><span>${step.input}</span><div class="compare-track"><i style="width:${width}%"></i></div><em>${step.output}</em></div>
    </section>`;
  }).join("");

  document.querySelector("#stat-ingestion-jobs").innerHTML = `<table>
    <thead><tr><th>任务</th><th>来源</th><th>周期</th><th>状态</th><th>质控</th><th>入库目标</th><th>下一步</th></tr></thead>
    <tbody>${(ingestion.jobs || []).map((job) => `<tr>
      <td>${job.name}</td>
      <td>${job.source}</td>
      <td>${job.period}</td>
      <td><span class="badge info">${job.status}</span></td>
      <td>${job.quality}</td>
      <td>${job.target}</td>
      <td>${job.nextAction}</td>
    </tr>`).join("")}</tbody>
  </table>`;
}

function getDalianHealthStatistics2025() {
  return state.dalianHealthStatistics2025 || {
    title: "2025 年大连市卫生健康统计提要",
    source: "2025 年国家卫生统计信息网络直报系统年报数据",
    year: 2025,
    status: "本地提要数据，待正式年报汇编确认",
    keyIndicators: [],
    domains: [],
    nationalComparisons: [],
    dataPipeline: []
  };
}

function getHealthStatisticsIngestion() {
  return state.healthStatisticsIngestion || {
    title: "卫生健康统计数据接入流程",
    workflow: [],
    jobs: []
  };
}

function getHealthBulletin2024() {
  return state.healthBulletin2024 || {
    title: "2024 年我国卫生健康事业发展统计公报",
    source: "统计公报",
    year: 2024,
    summary: "",
    keyIndicators: [],
    domains: [],
    trends: [],
    details: []
  };
}

function getHealthStatistics() {
  return state.healthStatistics || {
    period: "2026-05",
    basis: "卫生健康统计监测",
    sources: [],
    resourceReports: (state.medicalResources || []).map((item) => ({
      institutionId: item.id,
      institution: item.institution,
      region: item.region,
      type: item.type,
      interfaceData: { beds: item.beds || 0, doctors: item.doctors || 0, nurses: item.nurses || 0 },
      directReport: { beds: item.beds || 0, doctors: item.doctors || 0, nurses: item.nurses || 0 },
      status: "已一致",
      issue: "无"
    })),
    serviceReports: [],
    qualityRules: []
  };
}

function getDeathStatistics() {
  return state.deathStatistics || {
    period: "2026-06",
    title: "居民死亡医学证明与死亡统计",
    sources: [],
    metrics: {},
    causeRanking: [],
    regionStats: [],
    workflowRules: [],
    dataSharing: []
  };
}

function getBirthStatistics() {
  return state.birthStatistics || {
    period: "2026-06",
    title: "出生医学证明与出生人口统计",
    sources: [],
    metrics: {},
    regionStats: [],
    workflowRules: [],
    healthManagement: []
  };
}

function sumNested(rows, key, fields) {
  return fields.reduce((totals, field) => {
    totals[field] = (rows || []).reduce((sum, row) => sum + Number(row[key]?.[field] || 0), 0);
    return totals;
  }, {});
}

function resourceDiff(row) {
  return {
    beds: Number(row.interfaceData?.beds || 0) - Number(row.directReport?.beds || 0),
    doctors: Number(row.interfaceData?.doctors || 0) - Number(row.directReport?.doctors || 0),
    nurses: Number(row.interfaceData?.nurses || 0) - Number(row.directReport?.nurses || 0)
  };
}

function formatPeriod(period) {
  const [year, month] = String(period || "").split("-");
  return year && month ? `${year} 年 ${Number(month)} 月` : period || "当前周期";
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function renderPerformanceTable() {
  const rows = organizations.map((org) => {
    const residents = state.residents.filter((item) => item.organization === org);
    const residentIds = new Set(residents.map((item) => item.id));
    const diseases = state.diseases.filter((item) => residentIds.has(item.residentId));
    const followups = state.followups.filter((item) => residentIds.has(item.residentId));
    const completed = followups.filter((item) => item.status === "已完成").length;
    const orders = (state.careOrders || []).filter((item) => residentIds.has(item.residentId)).length;
    const rate = followups.length ? Math.round((completed / followups.length) * 100) : 0;
    return { org, residents: residents.length, diseases: diseases.length, followups: followups.length, rate, orders };
  });
  document.querySelector("#performance-table").innerHTML = `<table>
    <thead><tr><th>机构</th><th>建档</th><th>慢病登记</th><th>随访计划</th><th>完成率</th><th>协同任务</th></tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${row.org}</td><td>${row.residents}</td><td>${row.diseases}</td><td>${row.followups}</td><td>${row.rate}%</td><td>${row.orders}</td></tr>`).join("")}</tbody>
  </table>`;
}

function renderQualityBars() {
  const total = Math.max(1, state.residents.length);
  const hasPhone = state.residents.filter((item) => item.phone).length;
  const hasDoctor = state.residents.filter((item) => item.familyDoctor).length;
  const hasMetrics = state.residents.filter((item) => item.metrics?.systolic && item.metrics?.glucose && item.metrics?.bmi).length;
  const withPersonalRecords = new Set((state.personalRecords || []).map((item) => item.residentId)).size;
  renderBars("#quality-bars", {
    "联系方式完整": Math.round((hasPhone / total) * 100),
    "家庭医生绑定": Math.round((hasDoctor / total) * 100),
    "指标完整": Math.round((hasMetrics / total) * 100),
    "健康信息归集": Math.round((withPersonalRecords / total) * 100)
  }, ["联系方式完整", "家庭医生绑定", "指标完整", "健康信息归集"]);
}

function renderBars(selector, counts, order) {
  const max = selector === "#quality-bars" ? 100 : Math.max(1, ...Object.values(counts));
  document.querySelector(selector).innerHTML = order
    .filter((label) => counts[label] !== undefined || selector !== "#org-bars")
    .map((label) => {
      const value = counts[label] || 0;
      const suffix = selector === "#quality-bars" ? "%" : "";
      return `<div class="bar-row"><span>${label}</span><div class="bar-track"><div class="bar-fill" style="width:${(value / max) * 100}%"></div></div><strong>${value}${suffix}</strong></div>`;
    })
    .join("");
}

function openResidentDialog(id) {
  const dialog = document.querySelector("#resident-dialog");
  const form = document.querySelector("#resident-form");
  form.reset();
  const resident = id ? findResident(id) : null;
  if (resident) {
    Object.entries({ ...resident, ...resident.metrics }).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  }
  dialog.showModal();
}

function openResidentDetail(id) {
  const resident = findResident(id);
  if (!resident) return;
  const risk = assessRisk(resident);
  const diseases = state.diseases.filter((item) => item.residentId === id);
  const followups = state.followups.filter((item) => item.residentId === id).sort((a, b) => a.plannedAt.localeCompare(b.plannedAt));
  const records = (state.personalRecords || []).filter((item) => item.residentId === id);
  const careOrders = (state.careOrders || []).filter((item) => item.residentId === id);
  const pickups = (state.medicationPickups || []).filter((item) => item.residentId === id);
  const claims = (state.insuranceClaims || []).filter((item) => item.residentId === id);
  const credentials = (state.digitalCredentials || []).filter((item) => item.residentId === id);
  const accessLogs = (state.dataAccessLogs || []).filter((item) => item.residentId === id).slice(0, 5);
  const trendSeries = buildResidentTrendSeries(resident);
  document.querySelector("#detail-name").textContent = resident.name;
  document.querySelector("#detail-meta").textContent = `${resident.gender} · ${ageOf(resident.birthDate)} 岁 · ${resident.organization} · ${resident.familyDoctor}`;
  document.querySelector("#detail-content").innerHTML = `
    <div class="detail-grid">
      <article>
        <span>联系电话</span>
        <strong>${resident.phone}</strong>
      </article>
      <article>
        <span>身份证号</span>
        <strong>${resident.idCard}</strong>
      </article>
      <article>
        <span>统一索引</span>
        <strong>${resident.personIndex}</strong>
      </article>
      <article>
        <span>风险等级</span>
        <strong><span class="badge risk-${risk.level}">${risk.level}</span></strong>
      </article>
      <article>
        <span>住址</span>
        <strong>${resident.address}</strong>
      </article>
    </div>
    <section class="detail-section">
      <h3>最近健康指标</h3>
      <div class="vitals">
        <div><span>收缩压</span><strong>${resident.metrics.systolic}</strong><small>mmHg</small></div>
        <div><span>舒张压</span><strong>${resident.metrics.diastolic}</strong><small>mmHg</small></div>
        <div><span>空腹血糖</span><strong>${resident.metrics.glucose}</strong><small>mmol/L</small></div>
        <div><span>BMI</span><strong>${resident.metrics.bmi}</strong><small>kg/m²</small></div>
      </div>
      <p class="subtle">评估依据：${risk.reason}</p>
    </section>
    <section class="detail-section">
      <h3>居民 360 总览</h3>
      <div class="detail-grid">
        <article><span>健康档案/病历</span><strong>${records.length}</strong></article>
        <article><span>转诊协同</span><strong>${careOrders.length}</strong></article>
        <article><span>固定取药</span><strong>${pickups.length}</strong></article>
        <article><span>医保事项</span><strong>${claims.length}</strong></article>
        <article><span>数字凭证</span><strong>${credentials.length}</strong></article>
        <article><span>访问留痕</span><strong>${accessLogs.length}</strong></article>
      </div>
    </section>
    <section class="detail-section">
      <h3>健康指标趋势</h3>
      <div class="resident-trends">
        ${trendSeries.map((item) => renderResidentTrend(item)).join("")}
      </div>
    </section>
    <section class="detail-section">
      <h3>慢病登记</h3>
      ${diseases.map((item) => `<div class="detail-row"><strong>${item.type}</strong><span>${item.diagnosedAt} · ${item.source}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无慢病登记。</p>`}
    </section>
    <section class="detail-section">
      <h3>随访计划</h3>
      ${followups.map((item) => `<div class="detail-row"><strong>${item.diseaseType}</strong><span>${item.plannedAt} · ${item.assignee} · ${item.result}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无随访计划。</p>`}
    </section>
    <section class="detail-section">
      <h3>健康档案与电子病历</h3>
      ${records.slice(0, 6).map((item) => `<div class="detail-row"><strong>${item.title || item.category}</strong><span>${item.category} · ${item.source || item.provider || "居民健康信息库"}</span><span>${item.recordedAt || item.createdAt || ""}</span></div>`).join("") || `<p class="subtle">暂无健康档案或电子病历记录。</p>`}
    </section>
    <section class="detail-section">
      <h3>协同闭环</h3>
      ${[
        ...careOrders.map((item) => ["医疗协同", item.task || item.type || item.title, item.status || "进行中"]),
        ...pickups.map((item) => ["固定取药", item.medication, item.pharmacyStatus || item.status]),
        ...claims.map((item) => ["医保监管", item.claimType || item.type, item.status])
      ].slice(0, 8).map(([type, name, status]) => `<div class="detail-row"><strong>${type}</strong><span>${name}</span><span class="badge info">${status}</span></div>`).join("") || `<p class="subtle">暂无跨端协同事项。</p>`}
    </section>
    <section class="detail-section">
      <h3>访问审计</h3>
      ${accessLogs.map((item) => `<div class="detail-row"><strong>${item.actor}</strong><span>${item.scope} · ${item.purpose}</span><span>${item.at}</span></div>`).join("") || `<p class="subtle">暂无近期访问记录。</p>`}
    </section>
  `;
  document.querySelector("#resident-detail-dialog").showModal();
}

function buildResidentTrendSeries(resident) {
  const metrics = resident.metrics || {};
  return [
    { label: "收缩压", unit: "mmHg", values: trendValues(Number(metrics.systolic || 0), [8, 5, 2, 0]), target: 140 },
    { label: "舒张压", unit: "mmHg", values: trendValues(Number(metrics.diastolic || 0), [4, 3, 1, 0]), target: 90 },
    { label: "空腹血糖", unit: "mmol/L", values: trendValues(Number(metrics.glucose || 0), [0.6, 0.3, 0.1, 0]), target: 7 },
    { label: "BMI", unit: "kg/m²", values: trendValues(Number(metrics.bmi || 0), [0.7, 0.4, 0.2, 0]), target: 24 }
  ];
}

function trendValues(current, offsets) {
  return offsets.map((offset) => Math.max(0, Number((current + offset).toFixed(1))));
}

function renderResidentTrend(item) {
  const max = Math.max(...item.values, item.target, 1);
  return `<article class="resident-trend">
    <header><strong>${item.label}</strong><span>目标 ${item.target}${item.unit}</span></header>
    <div class="trend-points">
      ${item.values.map((value, index) => `<div>
        <i style="height:${Math.max(8, (value / max) * 100)}%"></i>
        <span>${["三月前", "两月前", "上月", "当前"][index]}</span>
        <em>${value}${item.unit}</em>
      </div>`).join("")}
    </div>
  </article>`;
}

function openFollowupDialog(id) {
  const dialog = document.querySelector("#followup-dialog");
  const form = document.querySelector("#followup-form");
  form.reset();
  form.elements.plannedAt.value = todayOffset(7);
  const followup = id ? state.followups.find((item) => item.id === id) : null;
  if (followup) {
    Object.entries(followup).forEach(([key, value]) => {
      if (form.elements[key]) form.elements[key].value = value;
    });
  }
  dialog.showModal();
}

function completeFollowup(id) {
  const followup = state.followups.find((item) => item.id === id);
  if (!followup) return;
  followup.status = "已完成";
  followup.result = followup.result === "未记录" ? "控制良好" : followup.result;
  saveState();
  render();
  showToast("随访已标记完成");
}

function assessRisk(resident) {
  const { systolic, glucose, bmi } = resident.metrics;
  if (systolic >= 160 || glucose >= 7 || bmi >= 30) {
    return { level: "高危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
  }
  if (systolic >= 140 || glucose >= 6.1 || bmi >= 28) {
    return { level: "中危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
  }
  return { level: "低危", reason: `收缩压 ${systolic}，血糖 ${glucose}，BMI ${bmi}` };
}

function getStats() {
  const chronicResidents = new Set(state.diseases.map((item) => item.residentId)).size;
  const highRisk = state.residents.filter((item) => assessRisk(item).level === "高危").length;
  const pending = state.followups.filter((item) => item.status === "待随访").length;
  const overdue = state.followups.filter((item) => item.status === "已逾期").length;
  const completed = state.followups.filter((item) => item.status === "已完成");
  const controlled = completed.filter((item) => item.result === "控制良好").length;
  return {
    residents: state.residents.length,
    chronicResidents,
    highRisk,
    pending,
    overdue,
    controlRate: completed.length ? Math.round((controlled / completed.length) * 100) : 0
  };
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function upsert(collection, item) {
  const index = collection.findIndex((entry) => entry.id === item.id);
  if (index >= 0) collection[index] = item;
  else collection.push(item);
}

function findResident(id) {
  return state.residents.find((item) => item.id === id);
}

function ageOf(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function exportCsv() {
  const rows = [
    ["姓名", "统一索引", "身份证号", "性别", "年龄", "联系电话", "管理机构", "家庭医生", "风险等级", "收缩压", "舒张压", "空腹血糖", "BMI", "慢病登记", "待随访数", "逾期随访数"],
    ...state.residents.map((resident) => {
      const risk = assessRisk(resident);
      const diseases = state.diseases.filter((item) => item.residentId === resident.id).map((item) => item.type).join("、") || "无";
      const followups = state.followups.filter((item) => item.residentId === resident.id);
      return [
        resident.name,
        resident.personIndex,
        resident.idCard,
        resident.gender,
        ageOf(resident.birthDate),
        resident.phone,
        resident.organization,
        resident.familyDoctor,
        risk.level,
        resident.metrics.systolic,
        resident.metrics.diastolic,
        resident.metrics.glucose,
        resident.metrics.bmi,
        diseases,
        followups.filter((item) => item.status === "待随访").length,
        followups.filter((item) => item.status === "已逾期").length
      ];
    })
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `慢病管理台账-${todayOffset(0)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("CSV 台账已导出");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function renderDataSource() {
  const badge = document.querySelector("#data-source");
  if (!badge) return;
  badge.textContent = apiEnabled ? "本地服务" : "浏览器本地";
  badge.classList.toggle("online", apiEnabled);
}

let toastTimer;
function showToast(message) {
  const toast = document.querySelector("#toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}
