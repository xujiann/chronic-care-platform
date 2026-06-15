const STORAGE_KEY = "chronic-care-platform-state";
const API_BASE = location.protocol === "file:" ? "" : "/api";
let apiEnabled = false;

const organizations = ["青泥洼桥社区卫生服务中心", "星海湾社区卫生服务中心", "甘井子区人民医院", "金普新区疾控中心"];

const seedState = {
  residents: [
    {
      id: "r1",
      name: "王建国",
      idCard: "210204196802113219",
      gender: "男",
      birthDate: "1968-02-11",
      phone: "13800010001",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "中山区人民路 18 号",
      metrics: { systolic: 166, diastolic: 96, glucose: 6.8, bmi: 29.4 }
    },
    {
      id: "r2",
      name: "李秀兰",
      idCard: "210203197505203427",
      gender: "女",
      birthDate: "1975-05-20",
      phone: "13800010002",
      organization: "星海湾社区卫生服务中心",
      familyDoctor: "赵医生",
      address: "沙河口区西南路 60 号",
      metrics: { systolic: 138, diastolic: 84, glucose: 7.8, bmi: 25.1 }
    },
    {
      id: "r3",
      name: "陈海涛",
      idCard: "210211198811093014",
      gender: "男",
      birthDate: "1988-11-09",
      phone: "13800010003",
      organization: "甘井子区人民医院",
      familyDoctor: "孙医生",
      address: "甘井子区山东路 88 号",
      metrics: { systolic: 126, diastolic: 78, glucose: 5.5, bmi: 24.2 }
    },
    {
      id: "r4",
      name: "赵敏",
      idCard: "210213196410013521",
      gender: "女",
      birthDate: "1964-10-01",
      phone: "13800010004",
      organization: "青泥洼桥社区卫生服务中心",
      familyDoctor: "刘医生",
      address: "中山区解放街 7 号",
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
  ["diseases", "followups", "personalRecords", "careOrders", "medicationPickups", "insuranceClaims"].forEach((key) => {
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
      const response = await fetch(`${API_BASE}/state`);
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
      const response = await fetch(`${API_BASE}/state`, {
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
      const response = await fetch(`${API_BASE}/reset`, { method: "POST" });
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
}

function renderGovernance() {
  renderPortalGrid();
  renderWarnings();
  renderMedicalResources();
  renderPerformanceTable();
  renderQualityBars();
}

function renderPlanning() {
  const items = state.policyAlignment || policyAlignmentDefaults;
  const started = items.filter((item) => ["已启动", "原型完成", "已纳入", "数据底座完成"].includes(item.status)).length;
  const pending = items.length - started;
  const sharedCollections = ["residents", "personalRecords", "diseases", "followups", "careOrders", "insuranceClaims", "medicationPickups"];
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
      <h3>慢病登记</h3>
      ${diseases.map((item) => `<div class="detail-row"><strong>${item.type}</strong><span>${item.diagnosedAt} · ${item.source}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无慢病登记。</p>`}
    </section>
    <section class="detail-section">
      <h3>随访计划</h3>
      ${followups.map((item) => `<div class="detail-row"><strong>${item.diseaseType}</strong><span>${item.plannedAt} · ${item.assignee} · ${item.result}</span><span class="badge status-${item.status}">${item.status}</span></div>`).join("") || `<p class="subtle">暂无随访计划。</p>`}
    </section>
  `;
  document.querySelector("#resident-detail-dialog").showModal();
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
