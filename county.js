const fallbackState = { countyConsortium: null, countyProjectBlueprint: null, residents: [], medicalResources: [], personalRecords: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const state = await loadPlatformState(fallbackState);
  const county = state.countyConsortium || buildCountyConsortiumDefaults(state);
  renderCountyMetrics(county, state);
  renderCountyNetwork(county);
  renderCountyProjectBlueprint(state);
  renderCapabilityFilter(county);
  renderCountyCapabilities(county, "all");
  renderCountyTasks(county);
  renderCountyWorkflows(county);
  renderCountyReferral(state);
  renderCountyIndicators(county);
  renderCountyGovernance(county);
});

function renderCountyMetrics(county, state) {
  const capabilities = county.capabilities || [];
  const live = capabilities.filter((item) => item.status === "运行中").length;
  const warning = capabilities.filter((item) => item.risk === "需推进").length;
  document.querySelector("#county-metrics").innerHTML = [
    ["医共体成员", county.organizations.length, "县、乡、村、公卫机构"],
    ["功能清单", capabilities.length, "指引 36 项"],
    ["运行中模块", live, "已形成协同能力"],
    ["待推进模块", warning, "建设缺口跟踪"],
    ["个人健康档案", state.residents.length, "与健康城市系统贯通"],
    ["共享数据集", 8, "档案、病历、医技、医保、公卫"]
  ].map(([label, value, hint]) => `<article class="metric-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`).join("");
}

function renderCountyNetwork(county) {
  document.querySelector("#county-network").innerHTML = county.organizations.map((org) => `<article>
    <span>${org.level}</span>
    <strong>${org.name}</strong>
    <p>${org.role}</p>
    <small>${org.systems.join("、")}</small>
  </article>`).join("");
}

function renderCountyProjectBlueprint(state) {
  const blueprint = state.countyProjectBlueprint || {};
  const coverage = blueprint.coverage || [];
  const centers = blueprint.centers || [];
  const ai = blueprint.grassrootsAi || {};
  const dataResources = blueprint.dataResources || {};
  const totalHospitals = coverage.reduce((sum, item) => sum + Number(item.hospitals || 0), 0);
  const totalPrimary = coverage.reduce((sum, item) => sum + Number(item.primaryCenters || 0), 0);

  const sourceEl = document.querySelector("#county-blueprint-source");
  if (sourceEl) {
    sourceEl.textContent = blueprint.source || "";
  }

  const modelEl = document.querySelector("#county-16255");
  if (modelEl) {
    modelEl.innerHTML = (blueprint.modelItems || []).map((item) => `<article class="capability-row">
      <div class="capability-index">${item.code}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.detail}</p>
      </div>
      <div class="capability-side">
        <span class="badge info">${blueprint.model || "16255"}</span>
      </div>
    </article>`).join("");
  }

  const coverageEl = document.querySelector("#county-coverage");
  if (coverageEl) {
    coverageEl.innerHTML = [
      { region: "合计", consortiums: coverage.reduce((sum, item) => sum + Number(item.consortiums || 0), 0), hospitals: totalHospitals, primaryCenters: totalPrimary },
      ...coverage
    ].map((item) => `<section class="item">
      <div>
        <h3>${item.region}</h3>
        <p>${item.consortiums} 个医共体 / ${item.hospitals} 家医院 / ${item.primaryCenters} 家乡镇卫生院</p>
      </div>
      <span class="badge info">${item.primaryCenters}</span>
    </section>`).join("");
  }

  const appsEl = document.querySelector("#county-apps");
  if (appsEl) {
    appsEl.innerHTML = [
      ["复用全民健康信息平台", blueprint.reusedApps || []],
      ["新建医共体专项应用", blueprint.newApps || []],
      ["数据资源与安全", [`${dataResources.catalogs || 0} 项目录`, dataResources.sharing, dataResources.network, ...(dataResources.security || [])].filter(Boolean)]
    ].map(([title, items]) => `<div>
      <strong>${title}</strong>
      <span>${items.join("、")}</span>
    </div>`).join("");
  }

  const aiEl = document.querySelector("#county-grassroots-ai");
  if (aiEl) {
    aiEl.innerHTML = [
      ["覆盖范围", ai.coverage || "待配置"],
      ["辅助能力", (ai.functions || []).join("、")],
      ["运行监测", (ai.indicators || []).join("、")]
    ].map(([title, text]) => `<div><strong>${title}</strong><span>${text}</span></div>`).join("");
  }

  const centersEl = document.querySelector("#county-resource-centers");
  if (centersEl) {
    centersEl.innerHTML = centers.map((item) => `<article>
      <strong>${item.name}</strong>
      <div class="flow-steps">
        <span>1. 接入：${item.integration}</span>
        <span>2. 流程：${item.workflow}</span>
      </div>
    </article>`).join("");
  }
}

function renderCapabilityFilter(county) {
  const select = document.querySelector("#capability-filter");
  const domains = [...new Set(county.capabilities.map((item) => item.domain))];
  select.innerHTML = [`<option value="all">全部功能域</option>`, ...domains.map((domain) => `<option value="${domain}">${domain}</option>`)].join("");
  select.addEventListener("change", () => renderCountyCapabilities(county, select.value));
}

function renderCountyCapabilities(county, domain) {
  const items = county.capabilities.filter((item) => domain === "all" || item.domain === domain);
  document.querySelector("#county-capabilities").innerHTML = items.map((item) => {
    const badge = item.status === "运行中" ? "" : item.status === "建设中" ? "info" : "warn";
    return `<article class="capability-row">
      <div class="capability-index">${item.no}</div>
      <div>
        <h3>${item.name}</h3>
        <p>${item.summary}</p>
        <div class="standard-tags">
          ${item.functions.map((fn) => `<span class="badge info">${fn}</span>`).join("")}
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${badge}">${item.status}</span>
        <small>${item.owner}</small>
      </div>
    </article>`;
  }).join("");
}

function renderCountyTasks(county) {
  const tasks = county.tasks || [];
  document.querySelector("#county-task-count").textContent = `${tasks.length} 项`;
  document.querySelector("#county-tasks").innerHTML = tasks.map((task) => `<section class="item">
    <div>
      <h3>${task.title}</h3>
      <p>${task.owner} · ${task.due}</p>
      <p>${task.action}</p>
    </div>
    <span class="badge ${task.level === "高" ? "danger" : task.status === "进行中" ? "info" : "warn"}">${task.status}</span>
  </section>`).join("");
}

function renderCountyWorkflows(county) {
  document.querySelector("#county-workflows").innerHTML = county.workflows.map((flow) => `<article>
    <strong>${flow.name}</strong>
    <div class="flow-steps">
      ${flow.steps.map((step, index) => `<span>${index + 1}. ${step}</span>`).join("")}
    </div>
  </article>`).join("");
}

function renderCountyReferral(state) {
  const referral = state.referralSystem || {};
  const referrals = referral.referrals || [];
  const blocks = [
    {
      name: "紧密型医联体协同",
      steps: referral.goals || ["以紧密型医联体为抓手完善分级诊疗协同机制"]
    },
    {
      name: "转诊中心运行",
      steps: referrals.map((item) => `${item.type}：${item.from} → ${item.to} · ${item.status}`)
    },
    {
      name: "预留资源",
      steps: (referral.reservedResources || []).map((item) => `${item.institution}${item.department}：号源 ${item.outpatientSlots}，床位 ${item.beds}`)
    },
    {
      name: "医保与长期处方",
      steps: (referral.insuranceGuidance || []).map((item) => `${item.item}：${item.status}`)
    }
  ];
  document.querySelector("#county-referral").innerHTML = blocks.map((flow) => `<article>
    <strong>${flow.name}</strong>
    <div class="flow-steps">
      ${(flow.steps.length ? flow.steps : ["待配置"]).map((step, index) => `<span>${index + 1}. ${step}</span>`).join("")}
    </div>
  </article>`).join("");
}

function renderCountyIndicators(county) {
  document.querySelector("#county-indicators").innerHTML = county.indicators.map((item) => `<section class="item">
    <div>
      <h3>${item.name}</h3>
      <p>${item.source} · ${item.target}</p>
    </div>
    <span class="badge ${item.trend === "预警" ? "warn" : "info"}">${item.value}</span>
  </section>`).join("");
}

function renderCountyGovernance(county) {
  document.querySelector("#county-governance").innerHTML = county.governance.map((item) => `<div>
    <strong>${item.title}</strong>
    <span>${item.detail}</span>
  </div>`).join("");
}

function buildCountyConsortiumDefaults(state) {
  return {
    organizations: [
      { name: "县域医共体总医院", level: "牵头医院", role: "统一医技中心、远程会诊、质控、绩效和运营管理", systems: ["HIS", "EMR", "医技共享", "运营监管"] },
      { name: "县中医医院", level: "专科牵头", role: "中医智能辅诊、中药共享药房、中医适宜技术推广", systems: ["中医知识库", "中药房", "远程中医"] },
      { name: "乡镇卫生院", level: "成员单位", role: "基层首诊、签约服务、慢病随访、样本采集和转诊申请", systems: ["基层医疗", "公卫", "家医签约"] },
      { name: "村卫生室", level: "网底机构", role: "健康监测、随访提醒、取药登记、检查申请和居民服务触点", systems: ["移动随访", "电子健康卡"] },
      { name: "疾控/妇幼/急救中心", level: "公共卫生", role: "疾控协同、妇幼保健、疫苗接种、应急指挥和院前急救", systems: ["疾控", "妇幼", "急救"] }
    ],
    capabilities: countyCapabilities(),
    tasks: [
      { title: "检验检查结果互认规则上线", owner: "医共体办公室", due: "2026-07-15", action: "统一互认项目、质控标准和不互认理由填报。", status: "进行中", level: "高" },
      { title: "基层缺药登记与药物配供闭环", owner: "总医院药学中心", due: "2026-07-30", action: "接入固定取药、延伸处方、中心药房配送状态。", status: "进行中", level: "中" },
      { title: "家庭医生签约履约评价", owner: "基层医疗卫生机构", due: "2026-08-10", action: "把签约、咨询、随访、转诊和满意度纳入绩效。", status: "待启动", level: "中" },
      { title: "医疗废弃物追溯监管", owner: "后勤安全中心", due: "2026-08-30", action: "建设收集、暂存、交接、转运、处置追溯台账。", status: "待启动", level: "中" }
    ],
    workflows: [
      { name: "影像/心电/检验共享", steps: ["基层申请", "数据采集", "中心诊断", "报告回传", "结果互认", "医保/质控监管"] },
      { name: "双向转诊预约", steps: ["基层评估", "电子病历调阅", "转诊申请", "号源/床位预约", "接诊反馈", "下转随访"] },
      { name: "互联网+慢病", steps: ["筛查建档", "风险评估", "分级分组", "干预随访", "转诊复诊", "长期用药监测"] },
      { name: "公共卫生应急", steps: ["多源监测", "智能预警", "指挥调度", "资源联动", "处置反馈", "复盘评估"] }
    ],
    indicators: [
      { name: "县域内就诊率", value: "82.4%", target: "逐季提升", source: "HIS/医保结算", trend: "正常" },
      { name: "基层首诊率", value: "61.8%", target: "提升基层能力", source: "预约与门诊记录", trend: "正常" },
      { name: "检验检查互认率", value: "46.2%", target: "减少重复检查", source: "医技共享中心", trend: "预警" },
      { name: "慢病规范管理率", value: "73.5%", target: "防筛诊治管闭环", source: "健康档案/随访", trend: "正常" },
      { name: "家庭医生履约率", value: "68.9%", target: "按服务包评价", source: "签约服务系统", trend: "预警" },
      { name: "医保协同审核通过率", value: "91.6%", target: "结算合规", source: "医保端", trend: "正常" }
    ],
    governance: [
      { title: "省市统筹、县域落地", detail: "依托全民健康信息平台，统一网络、标准、接口和安全要求，避免重复建设。" },
      { title: "一平台一中心一张图", detail: "建设医共体基础平台、大数据中心和运营监管驾驶舱，支撑县乡村一体化治理。" },
      { title: "数据安全与最小授权", detail: "健康档案、电子病历、医保、药品、绩效和人财物数据分级授权、访问留痕。" },
      { title: "信创与网络安全", detail: "预留信创适配、专网接入、边界防护、入侵检测、容灾备份和数据质控能力。" }
    ]
  };
}

function countyCapabilities() {
  const groups = {
    "区域医疗服务协同": [
      ["医学影像诊断资源共享中心", "基层检查、上级诊断、影像报告回传与互认。", "总医院影像中心", "运行中", ["申请管理", "影像质控", "报告发布", "危急值"]],
      ["心电诊断资源共享中心", "基层采集心电波形，县级中心诊断并回传报告。", "总医院心电中心", "运行中", ["心电采集", "任务分配", "移动诊断", "危急值"]],
      ["医学检验资源共享中心", "基层采样、冷链转运、中心检测、报告实时查阅。", "医学检验中心", "运行中", ["检验申请", "样本运输", "结果审核", "质控"]],
      ["病理诊断资源共享中心", "县域机构申请病理诊断，牵头医院审核出具报告。", "病理中心", "建设中", ["标本核收", "诊断分析", "图文报告", "权限管理"]],
      ["远程会诊资源共享中心", "向上联通省市医院，向下连接基层机构，实现会诊全过程管理。", "远程会诊中心", "运行中", ["会诊申请", "病历调阅", "健康档案调阅", "评估"]],
      ["消毒供应资源共享中心", "复用器械清洗、消毒、灭菌、配送和全流程追溯。", "消毒供应中心", "建设中", ["物品申领", "追溯", "配送监管", "成本核算"]],
      ["县域智慧医疗急救中心", "院前院内急救信息共享，救护车定位和生命体征实时传输。", "急救中心", "建设中", ["急救病历", "车辆定位", "联合质控", "指挥调度"]]
    ],
    "便民惠民服务协同": [
      ["电子健康卡应用", "统一身份主索引，一码通用，跨机构统一认证。", "数字健康中心", "运行中", ["实名认证", "授权", "一码通", "主索引"]],
      ["互联网+诊疗服务", "咨询、复诊、续方、支付、报告查询、护理服务一体化。", "互联网医院", "建设中", ["在线咨询", "复诊续方", "在线支付", "处方流转"]],
      ["互联网+慢病协同管理", "为高血压、糖尿病、慢阻肺等人群提供线上线下一体化管理。", "慢病中心", "运行中", ["筛查", "建档", "评估", "随访"]],
      ["互联网+家庭医生签约", "线上签约、健康咨询、随访、转诊和履约评价。", "基层机构", "建设中", ["协议管理", "服务包", "满意度", "绩效"]],
      ["预约诊疗服务", "挂号、检查、检验、体检、住院、转诊预约统一管理。", "预约转诊中心", "运行中", ["资源同步", "转诊申请", "接诊", "结案"]],
      ["中医智能辅诊服务", "智能辨证、体质辨识、中医处方推荐和知识库支持。", "县中医医院", "待启动", ["智能问诊", "辅助诊疗", "体质辨识", "知识库"]],
      ["中药智能药学服务", "共享中药房，中药库存、调剂、煎药、配送和追溯。", "共享中药房", "待启动", ["库存", "调剂", "煎药", "配送"]],
      ["基层缺药登记服务", "基层缺药登记、采购申请、配送到登记机构。", "药物配供中心", "建设中", ["药品登记", "采购申请", "使用管理", "统计"]],
      ["居民用药监测服务", "形成居民用药地图、用药画像和供应风险评估。", "药学中心", "建设中", ["自动采集", "用药提醒", "供应评估", "统计"]]
    ],
    "医疗管理服务协同": [
      ["检验检查结果互认服务", "医共体内检查检验结果互认、参保人查询、医保调阅。", "医技质控中心", "建设中", ["互认规则", "不互认理由", "互认监管", "统计"]],
      ["合理用药审核及药事管理", "前置审方、药师审方、处方点评和用药跟踪。", "审方中心", "建设中", ["智能审方", "药师审方", "处方点评", "知识库"]],
      ["医保业务协同服务", "医保结算、异地转诊、特殊病种和双通道申报协同。", "医保管理中心", "运行中", ["医保结算", "转诊证明", "特殊病种", "监测"]],
      ["远程医学教育", "在线直播、课程点播、疑难病案讨论和培训考核。", "医教科研中心", "待启动", ["课程", "直播", "考核", "统计"]],
      ["县域中医药适宜技术推广", "技术库、师资库、培训交流、远程指导和考核评估。", "中医药推广中心", "待启动", ["教学", "实训", "技术库", "考核"]]
    ],
    "公共卫生服务协同": [
      ["慢性病业务协同服务", "防、筛、诊、治、管全流程慢病协同管理。", "医防融合中心", "运行中", ["筛查", "分级分组", "预警", "转诊"]],
      ["老年健康业务协同服务", "预防、筛查、诊治、护理、康复、安宁疗护一体管理。", "老年健康中心", "建设中", ["自理评估", "体检", "预警", "指导"]],
      ["妇幼保健业务协同服务", "妇女儿童全生命周期健康服务与数据共享。", "妇幼保健机构", "建设中", ["孕产保健", "儿童保健", "高危管理", "统计"]],
      ["疫苗接种业务协同服务", "接种史、禁忌、异常反应和免疫规划信息共享。", "疾控中心", "建设中", ["接种查询", "禁忌评估", "异常反应", "分析"]],
      ["突发公共卫生事件应急指挥", "多渠道数据整合、智能预警、指挥调度和处置反馈。", "应急指挥中心", "运行中", ["监测", "预警", "调度", "复盘"]],
      ["基层医疗与公卫业务协同", "把预防融入临床诊治全过程，诊间建档、签约、随访。", "基层机构", "运行中", ["诊间建档", "诊间随访", "公卫提醒", "协同"]],
      ["其他卫生业务协同服务", "营养、环境、职业、放射、学校卫生等业务协同。", "公共卫生机构", "待启动", ["数据共享", "监测", "填报", "统计"]]
    ],
    "基层医疗卫生综合管理": [
      ["综合决策统一可视化展示", "医共体运营监管驾驶舱，医疗、医保、医药、公卫一图统览。", "医共体办公室", "运行中", ["驾驶舱", "预警", "资源配置", "绩效"]],
      ["人力资源统一协同管理", "组织、人员、变动、合同、岗位、薪酬和排班统筹。", "人力资源中心", "建设中", ["组织机构", "人员档案", "排班", "薪酬"]],
      ["财务统一协同管理", "统一管理、集中核算、预算执行、成本和绩效分析。", "财务审计中心", "建设中", ["集中核算", "预算", "成本", "报表"]],
      ["物资统一协同管理", "非医疗设备、办公用品分类、编码、采购、库存和调拨。", "后勤中心", "建设中", ["分类编码", "采购", "库存", "调拨"]],
      ["药品耗材统一协同管理", "药品耗材集中采购、入库、调拨、盘点、出库和追溯。", "药耗管理中心", "建设中", ["采购", "调拨", "盘点", "追溯"]],
      ["行政统一协同管理", "一体化办公、流程、公文、会议、信息发布和督办。", "行政管理中心", "待启动", ["门户", "流程", "公文", "督办"]],
      ["医共体绩效统一协同管理", "工作指标、质量、效率、服务、费用和满意度综合评价。", "绩效考核中心", "建设中", ["指标", "考核", "分配", "分析"]],
      ["医疗废弃物统一协同管理", "医废收集、暂存、交接、转运和处置全过程追溯。", "后勤安全中心", "待启动", ["追溯码", "交接", "转运", "监管"]]
    ]
  };
  let no = 1;
  return Object.entries(groups).flatMap(([domain, items]) =>
    items.map(([name, summary, owner, status, functions]) => ({
      no: no++,
      domain,
      name,
      summary,
      owner,
      status,
      functions,
      risk: status === "待启动" ? "需推进" : "正常"
    }))
  );
}
