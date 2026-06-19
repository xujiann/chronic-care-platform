const fallbackPlatformState = {
  residents: [],
  diseases: [],
  followups: [],
  personalRecords: [],
  careOrders: [],
  medicationPickups: [],
  insuranceClaims: [],
  countyCollaborationOrders: [],
  countyMutualRecognitionRecords: [],
  countyAiDiagnosisCases: [],
  deathCertificates: [],
  birthCertificates: [],
  healthStatistics: {},
  healthStatisticsIngestion: {},
  securityEvents: [],
  dataAccessLogs: [],
  platformRoadmap: [],
  platformProcessAudit: [],
  platformCapabilities: [],
  platformIntegrations: [],
  platformInterfaces: [],
  platformDeliveryBatches: [],
  platformEvidence: [],
  platformChangeLogs: []
};

const PLATFORM_API_BASE = location.protocol === "file:" ? "" : "/api";
const PLATFORM_STORAGE_KEY = "chronic-care-platform-state";
let platformState = structuredClone(fallbackPlatformState);
let platformData = null;
let activeEditSnapshot = null;

const defaultPlatformCapabilities = [
  {
    group: "城市级医疗健康大数据平台",
    source: "申报材料（五）项目建设目标及内容、七（二）本期建设方案",
    target: "统一平台底座、区域医疗健康大数据中心、全域互联互通、数据资产管理、信创及国产密码改造",
    existing: ["residents", "personalRecords", "healthStatistics", "dataAccessLogs", "securityEvents"],
    status: "开发中",
    next: "补齐共享文档、信息资源中心、运行监控、标签模型、数据资产目录和存量模块统一纳管。"
  },
  {
    group: "助医应用",
    source: "分级诊疗、临床治疗辅助、居民健康数字身份",
    target: "远程会诊、双向转诊、远程影像、远程心电、委托检验、远程教育、临床辅助提醒",
    existing: ["careOrders", "referralSystem", "personalRecords", "countyMutualRecognitionRecords"],
    status: "已衔接",
    next: "将现有转诊、协同工单、检验检查互认扩展为远程会诊和区域专科诊断业务流。"
  },
  {
    group: "惠民应用",
    source: "健康大连互联网应用统一入口、互联网+药事服务、居民健康画像",
    target: "居民统一入口、诊后用药、用药提醒、个性化健康标签、授权共享",
    existing: ["accounts", "residents", "personalRecords", "medicationPickups", "digitalCredentials"],
    status: "已衔接",
    next: "把居民端、移动预览、固定取药和授权共享归入健康大连统一入口。"
  },
  {
    group: "辅政应用",
    source: "数智健康大脑、卫生统计质控共享、医疗机构信用评价",
    target: "综合监管专题、统计直报质控、数据可视化、信用评价、公示",
    existing: ["healthStatistics", "healthStatisticsIngestion", "platformAudit", "platformProcessAudit"],
    status: "开发中",
    next: "新增医疗机构信用评价模型，并把统计质控问题沉淀为闭环工单。"
  },
  {
    group: "医疗科研创新平台",
    source: "专病库、多模态医疗数据集、科研研究落地验证",
    target: "结构化、标准化、高质量、可计算数据集，支撑专病库和科研协作",
    existing: ["diseases", "chronicScreeningTasks", "chronicManagementPlans", "personalRecords"],
    status: "待深化",
    next: "在慢病专病库基础上补充病种版本、数据脱敏、伦理审批、科研项目授权和数据集发布流程。"
  },
  {
    group: "区级机构对接及应用实施",
    source: "中山区、沙河口区、甘井子区、高新区区属医疗机构数据采集和应用下沉",
    target: "区属医院、基层医疗机构、妇幼机构、体检机构接入，市级应用下沉",
    existing: ["countyConsortium", "countyCollaborationOrders", "countyAiDiagnosisCases", "medicalResources"],
    status: "已衔接",
    next: "沿用医共体和机构端组织模型，补齐区级接入批次、接口验收和应用培训台账。"
  },
  {
    group: "互联互通测评服务",
    source: "互联互通四甲、五乙测评材料、模拟演练、现场查验",
    target: "标准化改造、健康医疗数据归集、文审材料、模拟演练、测评证据",
    existing: ["interfaceRequirements", "platformProcessAudit", "platformRoadmap"],
    status: "待深化",
    next: "建立测评证据库，按共享文档、术语标准、主索引、互联互通交易逐项归档。"
  },
  {
    group: "安全可靠和密码应用",
    source: "等保三级、密码应用安全性评估、信创适配",
    target: "统一认证、国密传输、数据库关键信息加密、日志审计、国产软硬件适配",
    existing: ["authUsers", "authOrganizations", "securityEvents", "dataAccessLogs"],
    status: "开发中",
    next: "把当前登录、角色、审计能力升级为等保和密评验收清单。"
  }
];

const defaultIntegrationRegistry = [
  { name: "全民健康信息平台一、二期", approach: "原生升级", keep: "主索引、注册服务、四大数据库、业务协同、监管和便民能力", target: "市级平台底座" },
  { name: "医疗机构药事管理平台", approach: "接口接入+场景合并", keep: "药事管理数据、药事服务流程", target: "互联网+药事服务、固定取药、医保审核" },
  { name: "保健管理系统", approach: "数据回流+门户集成", keep: "医疗管理、健康管理、综合管理、统计分析", target: "居民健康画像、行业治理专题" },
  { name: "疫情防控应急指挥视频通讯平台", approach: "能力复用", keep: "视频会议、应急指挥调度、可视化政务管理", target: "公共卫生应急、远程会诊、远程教育" },
  { name: "慢病管理平台", approach: "模块纳管", keep: "筛查、建档、风险分级、随访、宣教、固定取药", target: "医疗科研专病库、医防协同和居民画像" },
  { name: "医共体信息平台", approach: "能力复用+边界清晰", keep: "县乡村一体化、医技共享、基层AI辅助、协同工单", target: "区级应用下沉、分级诊疗和区域诊断中心" }
];

const defaultInterfacePlan = [
  { domain: "统一认证", existing: "现有登录、角色、会话、审计", next: "政务统一认证、CA、短信、人脸核验", priority: "P0", owner: "市级平台", status: "开发中" },
  { domain: "居民主索引", existing: "personIndex、居民档案、家庭成员", next: "人口库、电子健康码、标准健康档案主索引", priority: "P0", owner: "市级平台", status: "开发中" },
  { domain: "医疗机构业务系统", existing: "个人健康信息库、机构端协同", next: "HIS、EMR、LIS、PACS、心电、体检系统", priority: "P0", owner: "医疗机构", status: "待接口" },
  { domain: "分级诊疗", existing: "转诊规则、协同工单、预留资源", next: "远程会诊、双向转诊、远程影像、心电、检验、教育", priority: "P0", owner: "医政医管", status: "开发中" },
  { domain: "医保结算监管", existing: "医保审核、凭证核验、固定取药审核", next: "医保核心结算、门慢门特、异地转诊规则", priority: "P1", owner: "医保局", status: "演示对接完成" },
  { domain: "卫生统计", existing: "统计导入任务、资源直报对账、质控看板", next: "辽宁省卫统直报、国家统计直报系统", priority: "P1", owner: "规划信息", status: "演示对接完成" },
  { domain: "电子证照", existing: "出生/死亡医学证明模型和统计", next: "电子证照平台、公安户籍、民政殡葬、疾控死因监测", priority: "P1", owner: "医政/妇幼", status: "已建模" },
  { domain: "互联互通测评", existing: "接口需求清单、流程审计、路线图", next: "共享文档、术语标准、交易服务、测评文审材料", priority: "P1", owner: "项目办", status: "待深化" },
  { domain: "安全信创", existing: "角色权限、安全事件、访问日志", next: "国密传输、数据库加密、日志保全、密评和等保证据", priority: "P0", owner: "安全管理", status: "开发中" }
];

const defaultDeliveryRoadmap = [
  { phase: "第一批：平台底座和存量纳管", owner: "市级平台", items: ["统一应用目录", "统一身份认证", "数据资源目录", "存量模块登记", "运行监控"], status: "启动" },
  { phase: "第二批：助医和分级诊疗闭环", owner: "医政医管/医疗机构", items: ["双向转诊", "远程会诊", "区域影像", "区域心电", "委托检验", "远程教育"], status: "衔接现有机构端和医共体模块" },
  { phase: "第三批：惠民统一入口", owner: "基层卫生/居民端", items: ["健康大连统一入口", "互联网+药事服务", "居民健康画像", "授权共享", "固定取药提醒"], status: "衔接居民端和慢病模块" },
  { phase: "第四批：辅政和科研", owner: "规划信息/科研管理", items: ["数智健康大脑", "统计质控共享", "信用评价", "专病库", "科研数据集"], status: "补齐治理和科研能力" },
  { phase: "第五批：测评、安全和验收", owner: "项目办/安全管理", items: ["互联互通五乙材料", "等保三级", "密评", "信创适配", "接口验收"], status: "贯穿全周期沉淀证据" }
];

const defaultPlatformEvidence = [
  { id: "ev-application", category: "申报材料", name: "提级论证申报材料闭环", owner: "项目办", source: "项目申报材料、建设方案、预算和论证意见", artifacts: ["建设范围矩阵", "存量模块合并清单", "开发批次计划", "周报素材"], status: "已建档", next: "持续补充需求变更、会议纪要和专家论证反馈。" },
  { id: "ev-interoperability", category: "互联互通测评", name: "四甲/五乙测评证据包", owner: "项目办/标准管理", source: "共享文档、术语字典、主索引、交易服务、测评文审材料", artifacts: ["接口清单", "标准映射", "交易样例", "整改记录"], status: "待补齐", next: "按接口域逐项挂接截图、报文样例、测试记录和整改状态。" },
  { id: "ev-security", category: "安全合规", name: "等保、密评和信创适配证据", owner: "安全管理岗", source: "统一认证、访问审计、安全事件、数据访问日志、信创适配清单", artifacts: ["权限矩阵", "审计日志", "安全事件", "密评整改项"], status: "开发中", next: "补齐国密传输、数据库加密、日志保全和国产化适配证明。" },
  { id: "ev-interface", category: "接口联调", name: "外部系统接口联调验收", owner: "市级平台/医疗机构", source: "HIS、EMR、LIS、PACS、医保、电子证照、卫生统计等对接计划", artifacts: ["联调计划", "字段映射", "异常清单", "回归测试"], status: "开发中", next: "为每个接口域建立责任人、环境、频率、样例和验收规则。" },
  { id: "ev-launch", category: "上线验收", name: "区级实施和应用上线材料", owner: "实施组", source: "中山、沙河口、甘井子、高新区实施批次和应用培训记录", artifacts: ["上线确认", "培训签到", "试运行问题", "用户反馈"], status: "待启动", next: "按区县、机构、应用和批次沉淀上线确认与问题闭环。" }
];

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackPlatformState);
  ensureEditablePlatformData(platformState);
  bindPlatformEditor();
  renderPlatform();
});

function renderPlatform() {
  platformData = platformModel(platformState);
  renderMetrics(platformState, platformData);
  renderCapabilities(platformState, platformData.capabilities);
  renderIntegrationRegistry(platformData.integrations);
  renderInterfacePlan(platformData.interfaces);
  renderDataFoundation(platformState);
  renderRoadmap(platformData.deliveryBatches);
  renderEvidenceLibrary(platformData.evidence);
  renderChangeLogs(platformState.platformChangeLogs || []);
  renderReportFilters(platformData);
  renderReportSummary(platformData, platformState.platformChangeLogs || []);
}

function platformModel(state) {
  return {
    capabilities: Array.isArray(state.platformCapabilities) && state.platformCapabilities.length ? state.platformCapabilities : defaultPlatformCapabilities,
    integrations: Array.isArray(state.platformIntegrations) && state.platformIntegrations.length ? state.platformIntegrations : defaultIntegrationRegistry,
    interfaces: Array.isArray(state.platformInterfaces) && state.platformInterfaces.length ? state.platformInterfaces : defaultInterfacePlan,
    deliveryBatches: Array.isArray(state.platformDeliveryBatches) && state.platformDeliveryBatches.length ? state.platformDeliveryBatches : defaultDeliveryRoadmap,
    evidence: Array.isArray(state.platformEvidence) && state.platformEvidence.length ? state.platformEvidence : defaultPlatformEvidence
  };
}

function ensureEditablePlatformData(state) {
  if (!Array.isArray(state.platformCapabilities) || !state.platformCapabilities.length) {
    state.platformCapabilities = structuredClone(defaultPlatformCapabilities).map((item, index) => ({ id: item.id || `cap-${index + 1}`, ...item }));
  }
  if (!Array.isArray(state.platformIntegrations) || !state.platformIntegrations.length) {
    state.platformIntegrations = structuredClone(defaultIntegrationRegistry).map((item, index) => ({ id: item.id || `int-${index + 1}`, status: item.status || "待确认", ...item }));
  }
  if (!Array.isArray(state.platformInterfaces) || !state.platformInterfaces.length) {
    state.platformInterfaces = structuredClone(defaultInterfacePlan).map((item, index) => ({ id: item.id || `if-${index + 1}`, ...item }));
  }
  if (!Array.isArray(state.platformDeliveryBatches) || !state.platformDeliveryBatches.length) {
    state.platformDeliveryBatches = structuredClone(defaultDeliveryRoadmap).map((item, index) => ({ id: item.id || `batch-${index + 1}`, ...item }));
  }
  if (!Array.isArray(state.platformEvidence) || !state.platformEvidence.length) {
    state.platformEvidence = structuredClone(defaultPlatformEvidence);
  }
  if (!Array.isArray(state.platformChangeLogs)) state.platformChangeLogs = [];
}

function renderMetrics(state, platform) {
  const metrics = [
    ["建设域", platform.capabilities.length, "覆盖申报材料主要建设内容"],
    ["已衔接域", platform.capabilities.filter((item) => item.status === "已衔接").length, "由现有慢病、医共体、机构、居民、医保模块承接"],
    ["居民主索引", count(state.residents), "复用现有居民档案和 personIndex"],
    ["健康记录", count(state.personalRecords), "电子病历、检查检验、用药、授权等"],
    ["业务闭环", count(state.careOrders) + count(state.medicationPickups) + count(state.insuranceClaims), "转诊、取药、医保审核等跨端流程"],
    ["审计留痕", count(state.securityEvents) + count(state.dataAccessLogs), "登录、访问、业务操作和拒绝访问"],
    ["验收证据", count(state.platformEvidence), "申报、测评、安全、联调、上线材料统一归档"]
  ];
  document.querySelector("#platform-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");
}

function renderCapabilities(state, capabilities) {
  document.querySelector("#scope-summary").textContent = `${capabilities.length} 个建设域，${capabilities.filter((item) => item.status !== "待深化").length} 个已进入衔接或开发状态`;
  document.querySelector("#capability-matrix").innerHTML = capabilities.map((item, index) => {
    const linked = (item.existing || []).filter((key) => hasData(state, key));
    return `
      <article class="capability-row">
        <div class="capability-index">${index + 1}</div>
        <div>
          <h3>${item.group}</h3>
          <p>${item.target}</p>
          <small>依据：${item.source}</small>
        </div>
        <div class="capability-side">
          <strong>${item.status}</strong>
          <small>已复用：${linked.length ? linked.join("、") : "待接入"}</small>
          <small>${item.next}</small>
          <button class="inline-action" type="button" data-edit-platform="capabilities" data-id="${item.id}">维护</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderIntegrationRegistry(integrations) {
  document.querySelector("#integration-registry").innerHTML = integrations.map((item) => `
    <div>
      <strong>${item.name}</strong>
      <span>${item.approach}：保留 ${item.keep}，并入 ${item.target}。</span>
      <span class="badge info">${item.status || "待确认"}</span>
      <button class="inline-action" type="button" data-edit-platform="integrations" data-id="${item.id}">维护</button>
    </div>
  `).join("");
}

function renderInterfacePlan(interfaces) {
  document.querySelector("#interface-table").innerHTML = `
    <table>
      <thead><tr><th>接口域</th><th>现有承接</th><th>后续对接</th><th>责任方</th><th>优先级</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${interfaces.map((item) => `
        <tr>
          <td>${item.domain}</td>
          <td>${item.existing}</td>
          <td>${item.next}</td>
          <td>${item.owner || "待定"}</td>
          <td><span class="badge info">${item.priority}</span></td>
          <td>${statusBadge(item.status)}</td>
          <td><button class="inline-action" type="button" data-edit-platform="interfaces" data-id="${item.id}">维护</button></td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
}

function renderDataFoundation(state) {
  const rows = [
    ["居民与档案", ["residents", "personalRecords", "accounts"]],
    ["慢病与随访", ["diseases", "followups", "chronicScreeningTasks", "chronicManagementPlans"]],
    ["分级诊疗", ["referralSystem", "careOrders", "countyCollaborationOrders"]],
    ["医技共享", ["countyMutualRecognitionRecords", "countyAiDiagnosisCases"]],
    ["医保与药事", ["insuranceClaims", "medicationPickups", "digitalCredentials"]],
    ["统计与证照", ["healthStatistics", "healthStatisticsIngestion", "deathCertificates", "birthCertificates"]],
    ["安全审计", ["authUsers", "authOrganizations", "securityEvents", "dataAccessLogs"]]
  ];
  document.querySelector("#data-foundation").innerHTML = rows.map(([label, keys]) => {
    const ready = keys.filter((key) => hasData(state, key));
    return `<div><strong>${label}</strong><span>${ready.length}/${keys.length} 个数据集合已在原项目中存在：${ready.join("、") || "待建设"}。</span></div>`;
  }).join("");
}

function renderRoadmap(deliveryBatches) {
  document.querySelector("#delivery-roadmap").innerHTML = deliveryBatches.map((item) => `
    <div class="priority-row">
      <span class="badge info">${item.id || "batch"}</span>
      <div>
        <strong>${item.phase}</strong>
        <p>${item.items.join("、")}</p>
      </div>
      <div class="capability-side">
        <small>${item.owner}</small>
        <span class="badge info">${item.status}</span>
        <button class="inline-action" type="button" data-edit-platform="deliveryBatches" data-id="${item.id}">维护</button>
      </div>
    </div>
  `).join("");
}

function renderEvidenceLibrary(evidence) {
  const rows = Array.isArray(evidence) ? evidence : [];
  document.querySelector("#platform-evidence-library").innerHTML = rows.map((item) => `
    <article>
      <div>
        <span class="badge info">${item.category}</span>
        ${statusBadge(item.status)}
      </div>
      <h3>${item.name}</h3>
      <p>${item.source}</p>
      <div class="evidence-tags">
        ${(item.artifacts || []).map((artifact) => `<span>${artifact}</span>`).join("")}
      </div>
      <footer>
        <strong>${item.owner}</strong>
        <small>${item.next}</small>
      </footer>
    </article>
  `).join("") || `<div class="muted">暂无验收证据。</div>`;
}

function statusBadge(status) {
  const value = status || "待确认";
  const cls = value.includes("待") ? "warn" : value.includes("完成") || value.includes("已") ? "info" : "";
  return `<span class="badge ${cls}">${value}</span>`;
}

function bindPlatformEditor() {
  document.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-platform]");
    if (editButton) {
      openPlatformEditor(editButton.dataset.editPlatform, editButton.dataset.id);
      return;
    }
    if (event.target.matches("[data-close]")) {
      event.target.closest("dialog")?.close();
    }
  });

  document.querySelector("#platform-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const item = findEditableItem(data.collection, data.id);
    if (!item) return;
    const before = activeEditSnapshot || summarizeEditableItem(item);
    item.status = data.status.trim();
    if ("owner" in item || data.owner.trim()) item.owner = data.owner.trim();
    if ("next" in item) item.next = data.next.trim();
    else if ("target" in item) item.target = data.next.trim();
    else if ("items" in item) item.items = data.next.split(/[、,\n]/).map((entry) => entry.trim()).filter(Boolean);
    const after = summarizeEditableItem(item);
    if (before !== after) {
      appendPlatformChangeLog(data.collection, item, before, after);
    }
    await savePlatformState();
    form.closest("dialog").close();
    renderPlatform();
  });

  document.querySelector("#export-platform-report")?.addEventListener("click", exportPlatformReport);
  const filters = document.querySelector("#platform-report-filters");
  filters?.addEventListener("input", refreshReportSummary);
  filters?.addEventListener("change", refreshReportSummary);
  document.querySelector("#reset-platform-report-filters")?.addEventListener("click", () => {
    filters?.querySelectorAll("input, select").forEach((control) => {
      control.value = "";
    });
    refreshReportSummary();
  });
}

function openPlatformEditor(collection, id) {
  const item = findEditableItem(collection, id);
  if (!item) return;
  const dialog = document.querySelector("#platform-edit-dialog");
  const form = document.querySelector("#platform-edit-form");
  form.elements.namedItem("collection").value = collection;
  form.elements.namedItem("id").value = id;
  form.elements.namedItem("name").value = item.group || item.name || item.domain || item.phase || id;
  form.elements.namedItem("status").value = item.status || "";
  form.elements.namedItem("owner").value = item.owner || "";
  form.elements.namedItem("next").value = editableNextValue(item);
  activeEditSnapshot = summarizeEditableItem(item);
  document.querySelector("#platform-edit-title").textContent = `维护：${form.elements.namedItem("name").value}`;
  dialog.showModal();
}

function editableNextValue(item) {
  if ("next" in item) return item.next || "";
  if ("target" in item) return item.target || "";
  if (Array.isArray(item.items)) return item.items.join("、");
  return "";
}

function findEditableItem(collection, id) {
  const key = {
    capabilities: "platformCapabilities",
    integrations: "platformIntegrations",
    interfaces: "platformInterfaces",
    deliveryBatches: "platformDeliveryBatches"
  }[collection];
  if (!key) return null;
  return (platformState[key] || []).find((item) => item.id === id);
}

function summarizeEditableItem(item) {
  const parts = [
    `状态=${item.status || "未填"}`,
    `责任方=${item.owner || "未填"}`
  ];
  if ("next" in item) parts.push(`下一步=${item.next || "未填"}`);
  else if ("target" in item) parts.push(`目标=${item.target || "未填"}`);
  else if (Array.isArray(item.items)) parts.push(`任务=${item.items.join("、") || "未填"}`);
  return parts.join("；");
}

function appendPlatformChangeLog(collection, item, before, after) {
  const user = window.HealthCityAuth?.getUser?.();
  platformState.platformChangeLogs = [
    {
      id: crypto.randomUUID ? crypto.randomUUID() : `pcl-${Date.now()}`,
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
      actor: user?.name || "本地维护",
      role: user?.role || "local",
      collection: collectionKey(collection),
      itemId: item.id,
      itemName: item.group || item.name || item.domain || item.phase || item.id,
      action: "维护建设项",
      before,
      after,
      note: "平台驾驶舱维护表单自动记录"
    },
    ...(Array.isArray(platformState.platformChangeLogs) ? platformState.platformChangeLogs : [])
  ].slice(0, 200);
}

function collectionKey(collection) {
  return {
    capabilities: "platformCapabilities",
    integrations: "platformIntegrations",
    interfaces: "platformInterfaces",
    deliveryBatches: "platformDeliveryBatches"
  }[collection] || collection;
}

function renderChangeLogs(logs) {
  const recent = (Array.isArray(logs) ? logs : []).slice(0, 8);
  document.querySelector("#platform-change-logs").innerHTML = recent.map((log) => `
    <div class="priority-row platform-log-row">
      <span class="badge info">${log.collection || "平台"}</span>
      <div>
        <strong>${log.itemName || log.itemId || "建设项"}</strong>
        <p>${log.before || "无"} -> ${log.after || "无"}</p>
        <p>${log.note || ""}</p>
      </div>
      <div class="capability-side">
        <small>${log.actor || "未知"}</small>
        <small>${log.at || ""}</small>
      </div>
    </div>
  `).join("") || `<div class="muted">暂无维护记录。</div>`;
}

function refreshReportSummary() {
  if (!platformData) return;
  renderReportSummary(platformData, platformState.platformChangeLogs || []);
}

function renderReportFilters(platform) {
  const current = reportFilters();
  const items = reportItems(platform);
  fillSelect("#report-owner-filter", uniqueValues(items.map((item) => item.owner)), current.owner, "全部责任方");
  fillSelect("#report-status-filter", uniqueValues(items.map((item) => item.status)), current.status, "全部状态");
}

function renderReportSummary(platform, logs) {
  const filters = reportFilters();
  const allItems = filteredReportItems(platform, filters);
  const reportLogs = filteredReportLogs(logs, filters);
  const byStatus = countBy(allItems.map((item) => item.status || "未填"));
  const byOwner = countBy(allItems.map((item) => item.owner || "未填"));
  const pending = allItems.filter((item) => /待|开发中|启动/.test(item.status || "")).slice(0, 8);
  document.querySelector("#platform-report-summary").innerHTML = `
    <article>
      <h3>筛选结果</h3>
      <p><strong>建设事项</strong><span>${allItems.length} 项</span></p>
      <p><strong>维护记录</strong><span>${reportLogs.length} 条</span></p>
      <p><strong>条件</strong><span>${filterLabel(filters)}</span></p>
    </article>
    <article>
      <h3>状态汇总</h3>
      ${renderSummaryList(byStatus)}
    </article>
    <article>
      <h3>责任方汇总</h3>
      ${renderSummaryList(byOwner)}
    </article>
    <article class="wide">
      <h3>本周重点推进</h3>
      ${pending.map((item) => `<p><strong>${item.name}</strong><span>${item.status} · ${item.owner || "未填"} · ${item.next || "待补充下一步"}</span></p>`).join("") || `<p class="muted">暂无待推进事项。</p>`}
    </article>
    <article class="wide">
      <h3>最近维护</h3>
      ${reportLogs.slice(0, 5).map((log) => `<p><strong>${log.itemName}</strong><span>${log.at || ""} · ${log.actor || ""} · ${log.after || ""}</span></p>`).join("") || `<p class="muted">暂无维护记录。</p>`}
    </article>
  `;
}

function reportItems(platform) {
  return [
    ...platform.capabilities.map((item) => ({ type: "建设域", name: item.group, status: item.status, owner: item.owner, next: item.next })),
    ...platform.integrations.map((item) => ({ type: "存量整合", name: item.name, status: item.status, owner: item.owner, next: item.target })),
    ...platform.interfaces.map((item) => ({ type: "接口衔接", name: item.domain, status: item.status, owner: item.owner, next: item.next })),
    ...platform.deliveryBatches.map((item) => ({ type: "开发批次", name: item.phase, status: item.status, owner: item.owner, next: Array.isArray(item.items) ? item.items.join("、") : "" }))
  ];
}

function reportFilters() {
  return {
    from: document.querySelector("#report-date-from")?.value || "",
    to: document.querySelector("#report-date-to")?.value || "",
    owner: document.querySelector("#report-owner-filter")?.value || "",
    status: document.querySelector("#report-status-filter")?.value || "",
    type: document.querySelector("#report-type-filter")?.value || ""
  };
}

function filteredReportItems(platform, filters) {
  return reportItems(platform).filter((item) => {
    if (filters.owner && item.owner !== filters.owner) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.type && item.type !== filters.type) return false;
    return true;
  });
}

function filteredReportLogs(logs, filters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`) : null;
  const to = filters.to ? new Date(`${filters.to}T23:59:59`) : null;
  return (logs || []).filter((log) => {
    const logDate = parseLogDate(log.at);
    if ((from || to) && !logDate) return false;
    if (from && logDate < from) return false;
    if (to && logDate > to) return false;
    const logText = `${log.before || ""} ${log.after || ""} ${log.note || ""}`;
    if (filters.owner && !logText.includes(filters.owner)) return false;
    if (filters.status && !logText.includes(filters.status)) return false;
    if (filters.type && log.collection && collectionTypeName(log.collection) !== filters.type) return false;
    return true;
  });
}

function parseLogDate(value) {
  const text = String(value || "").replace(/\//g, "-");
  const match = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function collectionTypeName(collection) {
  return {
    platformCapabilities: "建设域",
    platformIntegrations: "存量整合",
    platformInterfaces: "接口衔接",
    platformDeliveryBatches: "开发批次"
  }[collection] || "";
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-CN"));
}

function fillSelect(selector, options, selected, label) {
  const select = document.querySelector(selector);
  if (!select) return;
  select.innerHTML = [`<option value="">${label}</option>`, ...options.map((option) => `<option value="${option}">${option}</option>`)].join("");
  select.value = options.includes(selected) ? selected : "";
}

function renderSummaryList(summary) {
  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => `<p><strong>${label}</strong><span>${value} 项</span></p>`)
    .join("");
}

function countBy(values) {
  return values.reduce((acc, value) => {
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function exportPlatformReport() {
  const platform = platformModel(platformState);
  const filters = reportFilters();
  const allItems = filteredReportItems(platform, filters);
  const byStatus = countBy(allItems.map((item) => item.status || "未填"));
  const byOwner = countBy(allItems.map((item) => item.owner || "未填"));
  const logs = filteredReportLogs(platformState.platformChangeLogs || [], filters).slice(0, 10);
  const pending = allItems.filter((item) => /待|开发中|启动/.test(item.status || ""));
  const lines = [
    "# 全民健康信息平台建设周报素材",
    "",
    `生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
    "",
    "## 筛选条件",
    "",
    `- 时间范围：${filters.from || "不限"} 至 ${filters.to || "不限"}`,
    `- 责任方：${filters.owner || "全部"}`,
    `- 状态：${filters.status || "全部"}`,
    `- 建设类别：${filters.type || "全部"}`,
    "",
    "## 一、总体概况",
    "",
    `- 建设事项：${allItems.length} 项`,
    `- 维护记录：${logs.length} 条`,
    `- 建设域：${allItems.filter((item) => item.type === "建设域").length} 项`,
    `- 存量整合：${allItems.filter((item) => item.type === "存量整合").length} 项`,
    `- 接口衔接：${allItems.filter((item) => item.type === "接口衔接").length} 项`,
    `- 开发批次：${allItems.filter((item) => item.type === "开发批次").length} 项`,
    "",
    "## 二、状态汇总",
    "",
    ...markdownBullets(byStatus),
    "",
    "## 三、责任方汇总",
    "",
    ...markdownBullets(byOwner),
    "",
    "## 四、本周重点推进",
    "",
    ...(pending.length ? pending.map((item) => `- 【${item.type}】${item.name}：${item.status}；责任方：${item.owner || "未填"}；下一步：${item.next || "待补充"}`) : ["- 暂无待推进事项。"]),
    "",
    "## 五、最近维护记录",
    "",
    ...(logs.length ? logs.map((log) => `- ${log.at || ""} ${log.actor || ""} 维护【${log.itemName || log.itemId}】：${log.before || "无"} -> ${log.after || "无"}`) : ["- 暂无维护记录。"]),
    ""
  ];
  downloadText(`全民健康信息平台建设周报素材-${todayStamp()}.md`, lines.join("\n"));
}

function filterLabel(filters) {
  const labels = [
    filters.from || filters.to ? `${filters.from || "不限"} 至 ${filters.to || "不限"}` : "",
    filters.owner,
    filters.status,
    filters.type
  ].filter(Boolean);
  return labels.join(" / ") || "全部";
}

function markdownBullets(summary) {
  return Object.entries(summary)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => `- ${label}：${value} 项`);
}

function todayStamp() {
  const date = new Date();
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function downloadText(filename, text) {
  const blob = new Blob([`\ufeff${text}`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function savePlatformState() {
  if (PLATFORM_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${PLATFORM_API_BASE}/state`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(platformState)
      });
      if (response.ok) {
        platformState = await response.json();
        ensureEditablePlatformData(platformState);
        return;
      }
    } catch (error) {
      // Static/local fallback below.
    }
  }
  localStorage.setItem(PLATFORM_STORAGE_KEY, JSON.stringify(platformState));
}

function hasData(state, key) {
  const value = state[key];
  if (Array.isArray(value)) return value.length > 0;
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
}

function count(value) {
  return Array.isArray(value) ? value.length : 0;
}
