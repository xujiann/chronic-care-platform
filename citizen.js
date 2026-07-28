const STORAGE_KEY = "chronic-care-platform-state";
const CITIZEN_EXTRA_KEY = "chronic-care-citizen-extra";
const LARGE_MODE_KEY = "chronic-care-large-mode";
const CLIENT_CHANNEL_KEY = "chronic-care-client-channel";
const CITIZEN_RECENT_ACTION_KEY = "chronic-care-citizen-recent-actions";
const CITIZEN_RECORDS_ACCESSIBILITY_KEY = "chronic-care-citizen-records-accessibility";
let citizenRecentActionCache = null;
const citizenRecentActionSession = {};
const API_BASE = location.protocol === "file:" ? "" : "/api";
const RESIDENT_TASK_CLOSED_STATUSES = new Set(["closed", "completed", "cancel-requested", "cancelled", "canceled"]);
const CITIZEN_SERVICE_SWIPE_THRESHOLD = 54;
const CITIZEN_SERVICE_SWIPE_VERTICAL_LIMIT = 48;

const fallbackState = {
  accounts: [
    {
      id: "a1",
      name: "演示居民A账户",
      phone: "DEMO-MOBILE-R1",
      role: "本人",
      members: [{ residentId: "r1", relation: "本人" }]
    }
  ],
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
    }
  ],
  diseases: [
    { id: "d1", residentId: "r1", type: "高血压", diagnosedAt: "2024-10-12", source: "社区筛查", status: "管理中", note: "需加强用药依从性" }
  ],
  followups: [
    { id: "f1", residentId: "r1", diseaseType: "高血压", plannedAt: todayOffset(3), assignee: "刘医生", status: "待随访", result: "未记录", advice: "记录家庭血压" }
  ],
  escortServiceProviders: [
    {
      id: "esp-demo-community",
      name: "社区助医陪诊服务站",
      district: "中山区",
      published: true,
      trainedWorkers: 8,
      pricing: { halfDayFee: 120 }
    }
  ],
  escortServiceOrders: [
    {
      id: "eso-demo-citizen",
      residentId: "r1",
      providerId: "esp-demo-community",
      providerName: "社区助医陪诊服务站",
      hospital: "大连市中心医院",
      department: "心内科",
      appointmentAt: todayOffset(3),
      due: todayOffset(3),
      serviceItems: ["registration", "exam escort"],
      status: "requested",
      priority: "medium",
      riskLevel: "medium",
      subsidyType: "self-pay",
      contractStatus: "pending",
      insuranceStatus: "covered",
      qualityReview: "pending",
      feeEstimate: 120
    }
  ],
  phase2FamilyDoctorTemplates: [
    { id: "p2fdt-basic", name: "家庭医生基础签约模板", requiredFields: ["residentId", "teamId", "packageId"], reviewSteps: ["resident-apply", "institution-review"], status: "active" },
    { id: "p2fdt-chronic", name: "慢病连续管理签约模板", requiredFields: ["residentId", "diseaseType", "teamId", "packageId"], reviewSteps: ["resident-apply", "team-assessment", "institution-review"], status: "active" }
  ],
  phase2FamilyDoctorTeams: [
    { id: "p2fdtm-qnw", teamName: "青泥洼桥社区家庭医生团队", institutionCode: "MR3", institutionName: "青泥洼桥社区卫生服务中心", leaderDoctorId: "doc-liu", leaderDoctorName: "刘医生", doctorIds: ["doc-liu"], status: "active" }
  ],
  phase2FamilyDoctorServicePackages: [
    { id: "p2fdp-basic", packageCode: "FD-PKG-BASIC", templateId: "p2fdt-basic", name: "基础公卫签约包", serviceItems: ["健康档案复核", "年度健康评估"], visitFrequency: "quarterly", status: "active" },
    { id: "p2fdp-hypertension", packageCode: "FD-PKG-HBP", templateId: "p2fdt-chronic", name: "高血压连续管理包", serviceItems: ["血压随访", "用药依从性", "复诊预约"], visitFrequency: "monthly", status: "active" }
  ],
  phase2FamilyDoctorApplications: [
    { id: "p2fda-r1", residentId: "r1", residentName: "演示居民A", packageId: "p2fdp-hypertension", teamId: "p2fdtm-qnw", templateId: "p2fdt-chronic", applicationType: "new-contract", status: "approved", reviewStatus: "approved", consentStatus: "signed", desiredStartDate: todayOffset(-18), lastAction: "机构审核通过并生成签约合同。" }
  ],
  phase2FamilyDoctorContracts: [
    { id: "p2fdc-r1", residentId: "r1", residentName: "演示居民A", applicationId: "p2fda-r1", packageId: "p2fdp-hypertension", teamId: "p2fdtm-qnw", templateId: "p2fdt-chronic", startDate: todayOffset(-18), endDate: todayOffset(347), status: "active", fulfillmentPercent: 72, renewalStatus: "not-due", satisfactionScore: 96, nextServiceAt: todayOffset(7) }
  ],
  phase2FamilyDoctorFulfillments: [
    { id: "p2fdf-r1-bp", contractId: "p2fdc-r1", residentId: "r1", teamId: "p2fdtm-qnw", packageId: "p2fdp-hypertension", serviceDate: todayOffset(-12), serviceType: "monthly-followup", serviceItem: "血压随访", status: "completed" }
  ]
};

const emrRecords = [
  {
    residentId: "r1",
    date: "2026-05-21",
    institution: "大连市中心医院",
    department: "心内科",
    type: "门诊",
    diagnosis: "原发性高血压 2 级",
    summary: "复诊血压偏高，建议调整生活方式并规律服药。",
    exams: ["心电图：窦性心律", "肾功能：未见明显异常"],
    medications: ["苯磺酸氨氯地平片", "厄贝沙坦片"]
  },
  {
    residentId: "r1",
    date: "2026-04-12",
    institution: "青泥洼桥社区卫生服务中心",
    department: "全科门诊",
    type: "随访",
    diagnosis: "高血压随访",
    summary: "家庭血压记录不规律，已进行用药依从性宣教。",
    exams: ["血压：158/92 mmHg"],
    medications: ["继续原方案"]
  },
  {
    residentId: "r2",
    date: "2026-05-18",
    institution: "大连医科大学附属医院",
    department: "内分泌科",
    type: "门诊",
    diagnosis: "2 型糖尿病",
    summary: "空腹血糖控制不佳，建议复查糖化血红蛋白。",
    exams: ["空腹血糖：7.8 mmol/L", "糖化血红蛋白：待复查"],
    medications: ["二甲双胍片"]
  },
  {
    residentId: "r4",
    date: "2026-03-30",
    institution: "青泥洼桥社区卫生服务中心",
    department: "家庭医生工作室",
    type: "签约服务",
    diagnosis: "高血压稳定管理",
    summary: "血压较前稳定，继续季度随访。",
    exams: ["血压：148/88 mmHg"],
    medications: ["继续原用药"]
  }
];

const personalHealthData = {
  labs: [
    { residentId: "r1", date: "2026-05-21", name: "肾功能", result: "未见明显异常", source: "大连市中心医院" },
    { residentId: "r1", date: "2026-05-21", name: "心电图", result: "窦性心律", source: "大连市中心医院" },
    { residentId: "r2", date: "2026-05-18", name: "空腹血糖", result: "7.8 mmol/L，偏高", source: "大连医科大学附属医院" },
    { residentId: "r4", date: "2026-03-30", name: "血压复测", result: "148/88 mmHg", source: "青泥洼桥社区卫生服务中心" }
  ],
  medications: [
    { residentId: "r1", date: "2026-05-21", name: "苯磺酸氨氯地平片", usage: "每日 1 次", source: "心内科门诊" },
    { residentId: "r1", date: "2026-05-21", name: "厄贝沙坦片", usage: "每日 1 次", source: "心内科门诊" },
    { residentId: "r2", date: "2026-05-18", name: "二甲双胍片", usage: "每日 2 次", source: "内分泌科门诊" }
  ],
  allergies: [
    { residentId: "r1", date: "2025-10-02", name: "青霉素", result: "既往皮疹", source: "居民自述" },
    { residentId: "r2", date: "2025-08-14", name: "无明确药物过敏史", result: "已确认", source: "门诊问诊" }
  ],
  vaccines: [
    { residentId: "r1", date: "2025-11-01", name: "流感疫苗", result: "已接种", source: "社区卫生服务中心" },
    { residentId: "r4", date: "2025-11-05", name: "流感疫苗", result: "已接种", source: "社区卫生服务中心" }
  ],
  admissions: [
    { residentId: "r1", date: "2024-06-18", name: "日间观察", result: "血压波动观察，未住院", source: "大连市中心医院" },
    { residentId: "r3", date: "2025-12-09", name: "体检中心", result: "年度体检，无住院记录", source: "甘井子区人民医院" }
  ],
  imaging: [
    { residentId: "r1", date: "2026-05-21", name: "胸部 CT 影像索引", result: "影像号 IMG-DEMO-20260521，结论摘要已归档，原始 DICOM 待院内 PACS 授权调阅。", source: "大连市中心医院 PACS", meta: { attachmentType: "影像", fileName: "IMG-DEMO-20260521.dcm", accessMode: "院内授权调阅" } },
    { residentId: "r2", date: "2026-05-18", name: "眼底照相报告", result: "糖尿病眼底筛查未见明显新生血管，建议年度复查。", source: "大连医科大学附属医院", meta: { attachmentType: "图片", fileName: "fundus-r2-20260518.jpg", accessMode: "报告摘要" } }
  ],
  attachments: [
    { residentId: "r1", date: "2026-05-22", name: "门诊报告 PDF", result: "心内科复诊报告、检查摘要和用药建议已归档。", source: "居民上传", meta: { attachmentType: "PDF", fileName: "cardiology-visit-r1-20260522.pdf", accessMode: "居民端留存" } },
    { residentId: "r1", date: "2026-04-12", name: "家庭血压记录照片", result: "连续 7 天家庭血压手写记录照片，供家庭医生复核。", source: "个人上传", meta: { attachmentType: "图片", fileName: "home-bp-r1-20260412.jpg", accessMode: "居民端留存" } }
  ],
  authorizations: [
    { residentId: "r1", date: "2026-01-01", name: "家庭医生团队", result: "允许查看健康档案和随访记录", source: "居民授权" },
    { residentId: "r1", date: "2026-01-01", name: "区域医疗机构", result: "允许查看电子病历摘要", source: "居民授权" },
    { residentId: "r2", date: "2026-01-01", name: "家庭医生团队", result: "允许查看慢病管理信息", source: "居民授权" }
  ]
};

const vaultSections = [
  { key: "timeline", label: "健康时间线" },
  { key: "standard", label: "标准健康档案" },
  { key: "archive", label: "健康档案" },
  { key: "emr", label: "电子病历" },
  { key: "physical-exam", label: "体检报告" },
  { key: "labs", label: "检查检验" },
  { key: "medications", label: "用药处方" },
  { key: "allergies", label: "过敏史" },
  { key: "vaccines", label: "免疫接种" },
  { key: "admissions", label: "手术住院" },
  { key: "imaging", label: "影像资料" },
  { key: "attachments", label: "附件资料" },
  { key: "authorizations", label: "授权共享" }
];

let activeVaultSection = "timeline";
let vaultSearchResidentId = "";
const vaultSearchState = {
  keyword: "",
  trust: "all",
  dateFrom: "",
  dateTo: ""
};
const citizenServiceTabs = [
  { key: "health-record", label: "健康档案", status: "已实现", detail: "健康指标、标准档案、授权共享", title: "健康档案二级页面", actionLabel: "查看健康档案" },
  { key: "emr", label: "电子病历", status: "已实现", detail: "诊疗时间线、慢病和访问记录", title: "电子病历二级页面", actionLabel: "查看电子病历" },
  { key: "nursing", label: "护理", status: "已实现", detail: "互联网护理预约与追踪", title: "护理服务二级页面", actionLabel: "进入护理服务", actionHref: "./internet-nursing.html" },
  { key: "emergency", label: "急救", status: "已实现", detail: "拨打120、位置和健康资料辅助补充", title: "院前急救协同入口", actionLabel: "进入急救协同", actionHref: "./emergency.html" },
  { key: "escort", label: "陪诊", status: "已实现", detail: "陪诊预约、合同、保障和回访", title: "陪诊服务二级页面", actionLabel: "提交陪诊预约" },
  { key: "family-doctor", label: "家医", status: "已实现", detail: "签约申请、机构审核、履约、续约和满意度", title: "家庭医生签约二级页面", actionLabel: "申请家庭医生签约" },
  { key: "registration", label: "挂号", status: "已实现", detail: "号源查询、预约确认、支付医保和取消规则", title: "挂号服务二级页面", actionLabel: "提交挂号预约" }
];

const CITIZEN_HIDDEN_STATUS_PATTERN = /待开发|待上线|未上线|规划中|pending|todo|backlog/i;

function isCitizenLaunchVisible(item) {
  return !CITIZEN_HIDDEN_STATUS_PATTERN.test(String(item?.status || ""));
}

function getLaunchedCitizenServiceTabs() {
  const launched = citizenServiceTabs.filter(isCitizenLaunchVisible);
  return launched.length ? launched : citizenServiceTabs;
}

function getLaunchedResidentFunctionAudit(serviceKey = "") {
  const launchedServices = new Set(getLaunchedCitizenServiceTabs().map((item) => item.key));
  return residentFunctionAudit.filter((item) => {
    if (!launchedServices.has(item.service)) return false;
    if (!isCitizenLaunchVisible(item)) return false;
    return serviceKey ? item.service === serviceKey : true;
  });
}

function getActiveCitizenService() {
  const launched = getLaunchedCitizenServiceTabs();
  return launched.find((item) => item.key === activeServiceTab) || launched[0] || citizenServiceTabs[0];
}

function serviceInterfaceForTab(tab) {
  return citizenModuleInterfaces.find((item) => item.module === tab.label) || null;
}

function serviceNavigationMeta(tab) {
  const features = getLaunchedResidentFunctionAudit(tab.key);
  const serviceInterface = serviceInterfaceForTab(tab);
  return {
    featureCount: features.length,
    interfaceLabel: serviceInterface?.api || "居民端本地页面",
    productionBoundary: serviceInterface?.boundary || tab.detail
  };
}

function serviceCallContract(tab) {
  const meta = serviceNavigationMeta(tab);
  const internal = !tab.actionHref;
  return {
    mode: internal ? "页面内调用" : "独立模块调用",
    entry: internal ? citizenPageHref(tab.key) : tab.actionHref,
    api: meta.interfaceLabel,
    handoff: internal ? "定位到当前二级页主要功能区" : "打开独立业务模块并继承登录会话",
    boundary: meta.productionBoundary
  };
}

function adjacentCitizenServiceTab(direction) {
  const tabs = getLaunchedCitizenServiceTabs();
  if (!tabs.length) return null;
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.key === activeServiceTab));
  const nextIndex = (activeIndex + direction + tabs.length) % tabs.length;
  return tabs[nextIndex] || tabs[0];
}

function mobileServiceBadgeLabel(tab, active) {
  return active ? "当前" : `${serviceNavigationMeta(tab).featureCount}项`;
}

function readCitizenRecentActions() {
  if (citizenRecentActionCache) return citizenRecentActionCache;
  try {
    const saved = JSON.parse(localStorage.getItem(CITIZEN_RECENT_ACTION_KEY) || "{}");
    citizenRecentActionCache = saved && typeof saved === "object" ? saved : {};
  } catch (error) {
    citizenRecentActionCache = {};
  }
  return citizenRecentActionCache;
}

function rememberCitizenAction(serviceKey, label) {
  if (!serviceKey || !label) return;
  const saved = readCitizenRecentActions();
  const current = Array.isArray(saved[serviceKey]) ? saved[serviceKey] : [];
  saved[serviceKey] = [label, ...current.filter((item) => item !== label)].slice(0, 3);
  citizenRecentActionSession[serviceKey] = [...saved[serviceKey]];
  try {
    localStorage.setItem(CITIZEN_RECENT_ACTION_KEY, JSON.stringify(saved));
  } catch (error) {
    // Ignore private browsing or storage quota failures.
  }
}

function clearCitizenRecentActions(serviceKey) {
  if (!serviceKey) return;
  const saved = readCitizenRecentActions();
  const hasSavedActions = Array.isArray(saved[serviceKey]) && saved[serviceKey].length > 0;
  const hasSessionActions = Array.isArray(citizenRecentActionSession[serviceKey]) && citizenRecentActionSession[serviceKey].length > 0;
  if (!hasSavedActions && !hasSessionActions) return;
  delete saved[serviceKey];
  delete citizenRecentActionSession[serviceKey];
  try {
    if (Object.keys(saved).length > 0) {
      localStorage.setItem(CITIZEN_RECENT_ACTION_KEY, JSON.stringify(saved));
    } else {
      localStorage.removeItem(CITIZEN_RECENT_ACTION_KEY);
    }
  } catch (error) {
    // Keep the default action order available when storage is restricted.
  }
}

const citizenActionDockFallbacks = {
  "health-record": [
    { label: "看时间轴", target: "#citizen-highlight-center", tone: "primary" },
    { label: "查订单", target: ".service-order-center-panel" },
    { label: "隐私授权", target: "#grant-auth" }
  ],
  emr: [
    { label: "看病历", target: "#service-emr", tone: "primary" },
    { label: "查检验", target: ".vault-panel" },
    { label: "授权记录", target: "#grant-auth" }
  ],
  nursing: [
    { label: "预约护理", target: "#service-nursing", tone: "primary" },
    { label: "长期照护", target: ".longterm-care-panel" },
    { label: "查订单", target: ".service-order-center-panel" }
  ],
  escort: [
    { label: "约陪诊", target: "#service-escort", tone: "primary" },
    { label: "服务订单", target: ".service-order-center-panel" },
    { label: "通知待办", target: ".service-task-panel" }
  ],
  "family-doctor": [
    { label: "签约家医", target: "#service-family-doctor", tone: "primary" },
    { label: "履约进度", target: "#family-doctor-contract-cards" },
    { label: "家庭成员", target: "#member-list" }
  ],
  registration: [
    { label: "预约挂号", target: "#service-registration", tone: "primary" },
    { label: "候补号源", target: "#registration-waitlist-cards" },
    { label: "查订单", target: ".service-order-center-panel" }
  ]
};

function citizenActionDockItems(tab, immediateRecentLabel = "") {
  const items = [];
  if (tab) {
    items.push({
      label: tab.actionLabel || "进入服务",
      key: tab.key,
      href: tab.actionHref || citizenPageHref(tab.key),
      primary: true,
      internal: !tab.actionHref
    });
  }
  (citizenActionDockFallbacks[tab?.key] || []).forEach((item) => {
    if (!items.some((existing) => existing.label === item.label)) items.push(item);
  });
  const savedRecentValue = citizenRecentActionSession[tab?.key] || readCitizenRecentActions()[tab?.key];
  const savedRecentLabels = Array.isArray(savedRecentValue) ? savedRecentValue : [];
  const recentLabels = immediateRecentLabel
    ? [immediateRecentLabel, ...savedRecentLabels.filter((label) => label !== immediateRecentLabel)]
    : savedRecentLabels;
  return items
    .map((item) => ({ ...item, recent: recentLabels.includes(item.label) }))
    .sort((a, b) => Number(Boolean(b.primary)) - Number(Boolean(a.primary)) || Number(Boolean(b.recent)) - Number(Boolean(a.recent)))
    .slice(0, 4);
}

function citizenActionDockHint(tab, items) {
  const recent = items.find((item) => item.recent);
  if (recent) return `最近使用：${recent.label}`;
  const count = serviceNavigationMeta(tab).featureCount;
  return `${count} 项可用能力`;
}

const registrationSchedules = [
  { id: "reg-sch-cardio-am", hospital: "大连市中心医院", department: "心内科", doctor: "王医生", date: todayOffset(2), period: "上午", remaining: 6, fee: 18, cancelBeforeHours: 24, source: "医院号源池", tags: ["高血压复诊", "支持陪诊"] },
  { id: "reg-sch-cardio-waitlist-am", hospital: "大连市中心医院", department: "心内科", doctor: "孙医生", date: todayOffset(1), period: "上午", remaining: 0, fee: 18, cancelBeforeHours: 12, source: "医院号源池", tags: ["号源已满", "支持候补"] },
  { id: "reg-sch-endocrine-pm", hospital: "大连医科大学附属医院", department: "内分泌科", doctor: "赵医生", date: todayOffset(3), period: "下午", remaining: 4, fee: 22, cancelBeforeHours: 12, source: "医院号源池", tags: ["糖尿病复诊", "检查解读"] },
  { id: "reg-sch-community-am", hospital: "青泥洼桥社区卫生服务中心", department: "全科门诊", doctor: "刘医生", date: todayOffset(1), period: "上午", remaining: 12, fee: 8, cancelBeforeHours: 4, source: "基层预约池", tags: ["家庭医生", "慢病随访"] }
];

const citizenModuleInterfaces = [
  { module: "健康档案", status: "已实现", api: "/api/state, /api/personal-records", collections: "residents, accounts, diseases, followups, personalRecords", boundary: "生产需接入主索引、基层公卫和居民实名关系核验" },
  { module: "电子病历", status: "已实现", api: "/api/personal-records", collections: "personalRecords.emr, labs, medications, imaging, attachments", boundary: "生产需接入 EMR/LIS/PACS 和文档存储授权" },
  { module: "护理", status: "已实现", api: "/api/internet-nursing/dashboard, /api/internet-nursing/orders", collections: "internetNursingOrders, internetNursingNurses, taskMessages, citizenExtra.longTermCareAssessments", boundary: "生产需补齐护士资质、电子签名、定位轨迹、长期护理险和质控监管接入" },
  { module: "陪诊", status: "已实现", api: "/api/escort-services/dashboard, /api/escort-services/orders, /api/messages", collections: "escortServiceOrders, escortServiceProviders, escortWorkers, taskMessages", boundary: "生产需对接医院接诊回执、保险保障和陪诊服务主体监管" },
  { module: "家医", status: "已实现", api: "/api/phase2/family-doctor-contracts, /api/phase2/family-doctor-contracts/applications", collections: "phase2FamilyDoctorTemplates, phase2FamilyDoctorTeams, phase2FamilyDoctorServicePackages, phase2FamilyDoctorApplications, phase2FamilyDoctorContracts, phase2FamilyDoctorFulfillments", boundary: "生产需接入居民实名签约、电子签名、服务包资金口径和基层机构正式签章" },
  { module: "挂号", status: "已实现", api: "/api/registrations/dashboard, /api/registrations/orders, /api/registrations/waitlist, /api/registrations/orders/:id/actions, /api/registrations/orders/:id/cancel", collections: "registrationSchedules, registrationOrders, registrationWaitlistEntries, taskMessages", boundary: "已具备 HIS/互联网医院号源、候补补位、支付、医院确认、报到、完诊、退号退款、医保电子凭证和短信通知契约，生产需替换真实网关" },
  { module: "消息与待办", status: "已实现", api: "/api/messages, /api/tasks/:id/actions", collections: "taskMessages, service tasks, dataAccessLogs", boundary: "生产需接入真实短信、订阅消息、站内信送达回执和审计保全" }
];

const citizenGovernanceChecks = [
  { key: "identity", title: "实名与家庭关系", interface: "/api/auth/phone-login", ready: "演示可用", production: "接入真实短信、实名核验和监护人关系校验后生产上线" },
  { key: "authorization", title: "授权共享与撤销", interface: "/api/personal-records", ready: "已实现", production: "撤销后需要后端强制拦截、访问复核和审计保全联动" },
  { key: "emr", title: "电子病历来源", interface: "EMR/LIS/PACS -> /api/personal-records", ready: "演示归集", production: "接入院内 EMR、LIS、PACS、对象存储和原文调阅授权" },
  { key: "access", title: "访问日志复核", interface: "dataAccessLogs, /api/messages", ready: "已展示", production: "接入统一审计链、SIEM 或审计导出路径" },
  { key: "notification", title: "消息触达回执", interface: "/api/messages, /api/tasks/:id/actions", ready: "已实现", production: "接入短信、订阅消息、手机应用推送和送达回执" }
];

const citizenPipelineAudit = [
  { pipeline: "登录与账号", entry: "login.html", interface: "/api/auth/phone-code, /api/auth/phone-login", status: "演示闭环", owner: "平台信息科/身份集成组", onsiteAcceptance: "现场发送验证码、核对回执、确认居民ID绑定审计", blocker: "SMS_GATEWAY_URL、实名/OIDC、家庭关系和短信回执", evidence: "citizen:launch-foundation" },
  { pipeline: "居民首页聚合", entry: "citizen.html", interface: "/api/state", status: "已裁剪", owner: "居民主索引组", onsiteAcceptance: "抽查本人、家庭成员和越权访问样例", blocker: "居民主索引、监护关系核验和越权测试", evidence: "test/static.test.js" },
  { pipeline: "健康档案", entry: "page=health-record", interface: "/api/personal-records", status: "只读展示", owner: "公卫档案接口组", onsiteAcceptance: "核对来源机构、更新时间和慢病档案样例", blocker: "公卫档案、基层慢病档案和来源更新时间", evidence: "citizen-module-interface-map" },
  { pipeline: "电子病历", entry: "page=emr", interface: "HIS/EMR/LIS/PACS -> /api/personal-records", status: "摘要归集", owner: "医院接口联调组", onsiteAcceptance: "核对门诊摘要、检验报告、影像授权和原文追溯", blocker: "真实 EMR/LIS/PACS 契约和影像对象授权", evidence: "C端开发报告" },
  { pipeline: "授权与审计", entry: "授权共享/访问复核", interface: "/api/authorizations/:id/revoke, /api/access-reviews", status: "已展示", owner: "安全合规组", onsiteAcceptance: "演练撤权拒绝访问、访问复核和审计导出", blocker: "撤权强拦截、SIEM/审计导出和复核台账", evidence: "citizen-authorization-emr-governance" },
  { pipeline: "消息与待办", entry: "服务待办中心", interface: "/api/messages, /api/tasks/:id/actions", status: "站内闭环", owner: "消息平台组", onsiteAcceptance: "演练站内信、短信或订阅消息送达和失败补偿", blocker: "短信、订阅消息、移动端推送和失败补偿", evidence: "消息回执样例" },
  { pipeline: "护理服务", entry: "page=nursing", interface: "/api/internet-nursing/dashboard", status: "演示闭环", owner: "护理服务运营组", onsiteAcceptance: "核对护士资质、知情同意、位置轨迹和质控回访", blocker: "护士资质、知情同意、位置轨迹和监管报送", evidence: "internet-nursing:readiness" },
  { pipeline: "陪诊服务", entry: "page=escort", interface: "/api/escort-services/orders", status: "演示闭环", owner: "陪诊服务运营组", onsiteAcceptance: "核对服务主体、陪诊师签到、合同保险和评价投诉", blocker: "服务主体、HIS/导诊台、陪诊师签到和合同保险", evidence: "escort:readiness" },
  { pipeline: "挂号服务", entry: "page=registration", interface: "/api/registrations/orders, /api/registrations/integration-center", status: "回调对账", owner: "互联网医院/HIS 联调组", onsiteAcceptance: "演练锁号、支付退费、排班变更回调和人工对账", blocker: "真实号源、支付退款、医保电子凭证和签署字典", evidence: "registration:integration-readiness" },
  { pipeline: "移动发布", entry: "mobile-preview.html", interface: "manifest.webmanifest, service-worker.js", status: "可预览", owner: "移动端发布组/运营合规组", onsiteAcceptance: "核对备案域名、HTTPS、隐私协议、签名包和真机截图", blocker: "域名备案、HTTPS、隐私协议、APP签名和推送证书", evidence: "launch:smoke" }
];

const citizenClientChannels = [
  {
    key: "mini-program",
    label: "小程序",
    status: "可上线配置",
    entry: "citizen.html?client=mini-program&page=health-record",
    audience: "微信/支付宝服务入口、扫码、机构公众号菜单",
    capabilities: ["手机号授权登录", "轻量健康档案", "服务预约", "订阅消息提醒"],
    readiness: ["HTTPS 域名备案", "小程序隐私协议", "类目与医疗服务资质", "消息模板审核"],
    nextAction: "提交小程序审核包",
    productionMaterials: [
      { label: "生产短信网关", status: "现场补齐", owner: "平台信息科", acceptance: "验证码可发、可验、可追踪失败回执", note: "SMS_GATEWAY_URL、模板、签名和频控回执" },
      { label: "实名与家庭关系核验", status: "现场补齐", owner: "居民服务窗口", acceptance: "本人、监护人和家庭成员授权范围可核验", note: "政务身份/OIDC、监护关系和家庭成员授权范围" },
      { label: "HTTPS 与隐私协议", status: "现场补齐", owner: "运营合规组", acceptance: "备案域名、隐私协议、类目和医疗服务资质完成审核", note: "备案域名、隐私协议、类目和医疗服务资质" }
    ],
    launchChecklist: [
      { label: "实名登录", state: "已就绪", note: "手机号验证码进入居民端" },
      { label: "服务入口", state: "已就绪", note: "按二级页面生成可分享链接" },
      { label: "订阅提醒", state: "上线前确认", note: "需绑定平台消息模板" }
    ]
  },
  {
    key: "app",
    label: "手机应用",
    status: "可上线配置",
    entry: "citizen.html?client=app&page=health-record",
    audience: "安卓/苹果手机应用壳、桌面图标、离线缓存",
    capabilities: ["可安装网页应用入口", "离线健康档案壳", "大字模式", "系统推送预留"],
    readiness: ["应用签名与包名", "应用市场隐私合规", "推送证书", "崩溃监控与版本升级"],
    nextAction: "打包手机应用上架材料",
    productionMaterials: [
      { label: "应用签名与包名", status: "现场补齐", owner: "移动端发布组", acceptance: "Android/iOS 包名、签名、版本升级通道一致", note: "Android/iOS 签名、包名和升级通道" },
      { label: "推送与崩溃监控", status: "现场补齐", owner: "运维监控组", acceptance: "推送证书、崩溃告警和版本回滚策略可演练", note: "推送证书、崩溃监控和版本回滚策略" },
      { label: "HTTPS 与隐私合规", status: "现场补齐", owner: "运营合规组", acceptance: "生产域名、隐私政策和应用市场材料完成复核", note: "生产域名、隐私政策、应用市场合规材料" }
    ],
    launchChecklist: [
      { label: "安装入口", state: "已就绪", note: "可安装网页应用壳支持浏览器安装" },
      { label: "离线访问", state: "已就绪", note: "Service Worker 缓存居民端壳" },
      { label: "应用上架", state: "上线前确认", note: "需补齐签名、隐私和推送证书" }
    ]
  }
];

const residentFunctionAudit = [
  { service: "health-record", name: "手机号验证码登录", status: "已实现", evidence: "登录页支持手机号和演示验证码进入居民端", mobile: "独立表单，按钮满足触控尺寸" },
  { service: "health-record", name: "家庭成员切换", status: "已实现", evidence: "居民账户按成员裁剪档案和服务记录", mobile: "成员卡片可横向滚动选择" },
  { service: "health-record", name: "健康指标与风险等级", status: "已实现", evidence: "展示血压、血糖、BMI、家庭医生和风险分层", mobile: "摘要卡片单列堆叠" },
  { service: "health-record", name: "全生命周期健康管理", status: "已实现", evidence: "出生、儿童、成人慢病、老年服务和死亡证明线索归集", mobile: "阶段卡片单列显示" },
  { service: "health-record", name: "健康档案归集", status: "已实现", evidence: "标准档案、历年体检报告、检查检验、用药、过敏、疫苗、影像和附件统一索引", mobile: "档案标签横向滑动" },
  { service: "health-record", name: "档案检索与快速定位", status: "已实现", evidence: "按关键词、可信来源和日期范围检索当前居民最小化摘要", mobile: "筛选字段单列且触控高度不低于44像素" },
  { service: "health-record", name: "历史体检报告", status: "已实现", evidence: "体检中心和医院结果按居民主索引同步，保留异常项、建议、来源机构和外部报告号", mobile: "可按年度查看全部历史报告" },
  { service: "health-record", name: "上传资料", status: "已实现", evidence: "居民可补充报告、图片或自测记录", mobile: "弹窗在窄屏占满可用宽度" },
  { service: "health-record", name: "授权共享与撤销", status: "已实现", evidence: "可新增授权并记录授权对象、范围和来源", mobile: "表单字段单列录入" },
  { service: "health-record", name: "授权范围影响预览", status: "已实现", evidence: "每项范围实时说明允许查看内容和明确排除项，未知范围拒绝", mobile: "说明卡片单列展示" },
  { service: "health-record", name: "服务端授权强制契约", status: "已实现", evidence: "本人、家庭关系、受权人、范围、状态和有效期统一 fail-closed 判定", mobile: "拒绝原因以居民可理解状态显示" },
  { service: "health-record", name: "跨院来源归集与去重", status: "已实现", evidence: "按来源系统和来源记录保留最新版本与可信等级", mobile: "来源和版本信息紧凑展示" },
  { service: "health-record", name: "短时原文与影像调阅", status: "已实现", evidence: "单次使用、最长五分钟、按用途和范围申请服务端凭据", mobile: "受控入口满足触控尺寸" },
  { service: "health-record", name: "家庭与监护关系核验", status: "已实现", evidence: "关系证据、到期和成年转换均参与访问判定", mobile: "当前对象与拒绝原因始终可见" },
  { service: "health-record", name: "异常结果闭环", status: "已实现", evidence: "异常结果关联联系医生、复诊和随访进度", mobile: "危急和一般异常分级展示" },
  { service: "health-record", name: "档案纠错与异议", status: "已实现", evidence: "纠错申请保留原记录并按状态流转", mobile: "纠错表单单列输入" },
  { service: "health-record", name: "档案完整度与更新提醒", status: "已实现", evidence: "八类档案区分缺失与超过十八个月未更新", mobile: "提醒逐项堆叠" },
  { service: "health-record", name: "一次性健康资料包", status: "已实现", evidence: "白名单范围、最长七天、单次访问码、审计与主动撤销", mobile: "分享表单与撤销按钮可单手操作" },
  { service: "health-record", name: "适老化与无障碍增强", status: "已实现", evidence: "简洁、高对比、朗读、当前对象和敏感操作确认", mobile: "核心按钮不低于44像素" },
  { service: "health-record", name: "隐私审计与访问异议", status: "已实现", evidence: "访问匹配、拦截说明、居民确认、异议受理和最小化导出形成闭环", mobile: "访问复核卡片与异议表单单列展示" },
  { service: "emr", name: "电子病历时间线", status: "已实现", evidence: "门诊、随访、检查和用药摘要按时间展示", mobile: "时间线与详情卡片单列显示" },
  { service: "emr", name: "结构化电子病历", status: "已实现", evidence: "展示就诊、诊断、处置、医嘱、复诊计划和更正版本", mobile: "病历详情分段阅读" },
  { service: "emr", name: "用药核对", status: "已实现", evidence: "重复来源、自报和过敏线索进入医生或药师复核", mobile: "风险线索标签化展示" },
  { service: "emr", name: "趋势与疾病专题", status: "已实现", evidence: "指标保留来源可信等级并按疾病关联记录", mobile: "专题与最新指标卡片展示" },
  { service: "emr", name: "慢病管理", status: "已实现", evidence: "展示慢病登记、随访提醒和院后反馈", mobile: "表单控件触控高度优化" },
  { service: "emr", name: "转诊和家庭医生服务", status: "已实现", evidence: "居民端可查看转诊指引和签约服务记录", mobile: "服务卡片单列呈现" },
  { service: "emr", name: "出生健康与妇幼接续", status: "已实现", evidence: "居民授权范围内查看出生证明和妇幼连续服务", mobile: "信息卡片按宽度自适应" },
  { service: "emr", name: "固定取药和电子凭证", status: "已实现", evidence: "固定取药、数字凭证和访问记录进入个人视角", mobile: "状态标签不挤压正文" },
  { service: "nursing", name: "互联网护理预约", status: "已实现", evidence: "居民可进入护理服务页提交上门护理申请", mobile: "以独立护理页承载完整预约流程" },
  { service: "nursing", name: "护理订单追踪", status: "已实现", evidence: "复用机构派单、护士接单、服务记录和质控回访", mobile: "订单状态卡片移动端可读" },
  { service: "nursing", name: "长期照护评估", status: "已实现", evidence: "居民端可录入失能风险、照护人、长护险和民政预核验并生成照护建议", mobile: "护理标签内表单单列触控，评估结果即时更新" },
  { service: "escort", name: "助医陪诊预约", status: "已实现", evidence: "可为本人或家庭成员提交陪诊预约", mobile: "预约表单在手机端单列输入" },
  { service: "escort", name: "陪诊合同、保险和回访", status: "已实现", evidence: "订单同步服务主体、保障类型、保险和质控状态", mobile: "订单卡片跟随陪诊标签展示" },
  { service: "family-doctor", name: "家庭医生签约申请", status: "已实现", evidence: "居民可选择服务包和团队提交签约申请，接口记录知情确认和机构审核状态", mobile: "签约表单单列展示，服务包可快速选择" },
  { service: "family-doctor", name: "签约履约与续约", status: "已实现", evidence: "居民端展示签约合同、履约百分比、下一次服务、续约和满意度记录", mobile: "合同与履约卡片跟随家医标签展示" },
  { service: "registration", name: "医院号源查询", status: "已实现", evidence: "居民端展示医院号源池，按医院、科室、医生、日期、余号和费用呈现", mobile: "号源卡片单列显示，适合手机端选择" },
  { service: "registration", name: "预约挂号确认", status: "已实现", evidence: "可提交挂号预约，生成待支付/待医保核验状态并展示取消规则", mobile: "表单单列录入，订单卡可直接取消" },
  { service: "registration", name: "就医协同底座", status: "已实现", evidence: "陪诊、转诊和电子病历归集可支撑挂号上线", mobile: "作为挂号标签内已实现底座展示" }
];

let activeServiceTab = serviceTabFromRoute() || "health-record";
let activeClientChannel = clientChannelFromRoute() || localStorage.getItem(CLIENT_CHANNEL_KEY) || "mini-program";
let state = fallbackState;
let citizenExtra = loadCitizenExtra();
const citizenCareSession = new Map();
const citizenCareSyncStatus = new Map();
const citizenCareSyncRequested = new Set();
let citizenImagingDashboard = null;
let citizenSecureAttachments = [];
let escortDashboard = null;
let registrationDashboard = null;
let familyDoctorDashboard = null;
const physicalExamHighlightsCache = new Map();
let serviceOrderCenter = null;
let citizenMessages = [];
let citizenOperationsPublicFeed = {
  ok: true,
  contents: [
    { id: "cop-content-banner-registration", type: "banner", title: "预约挂号试点服务", summary: "展示预约、支付与退费状态，正式号源以医院联调结果为准。", status: "published-demo", owner: "居民服务运营岗" },
    { id: "cop-content-family-doctor", type: "article", title: "家庭医生签约与履约说明", summary: "查看签约申请、机构审核、履约、续约和满意度记录。", status: "published-demo", owner: "基层卫生处" }
  ],
  agreements: [
    { id: "cop-agreement-privacy-v2", name: "居民端隐私政策", version: "2.0-demo", acceptanceMode: "explicit-checkbox", status: "active-demo", legalReviewStatus: "onsite-pending" },
    { id: "cop-agreement-service-v1", name: "居民服务使用协议", version: "1.0-demo", acceptanceMode: "explicit-checkbox", status: "active-demo", legalReviewStatus: "onsite-pending" }
  ],
  hospitalServices: [
    { id: "cop-hospital-mr1", institutionName: "大连市中心医院", enabledServices: ["appointment", "report-query", "internet-nursing", "escort"], status: "active-demo", launchScope: "white-list-demo", productionReady: false },
    { id: "cop-hospital-mr3", institutionName: "青泥洼桥社区卫生服务中心", enabledServices: ["family-doctor", "chronic-followup", "internet-nursing"], status: "active-demo", launchScope: "white-list-demo", productionReady: false }
  ],
  boundary: "当前为演示公开信息，正式服务范围、协议和支付退费规则以现场联调及审核发布版本为准。"
};
let currentResidentId;
let currentAccountId;

document.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  const initialResidentId = state.accounts?.[0]?.members?.[0]?.residentId || state.residents?.[0]?.id || "";
  citizenImagingDashboard = await fetchCitizenImagingDashboard();
  citizenSecureAttachments = await fetchCitizenSecureAttachments(initialResidentId);
  if (window.CitizenRecordsV1) {
    state.dataAccessLogs = (state.dataAccessLogs || []).map(window.CitizenRecordsV1.projectAccessLog).filter(Boolean);
    state.personalRecords = window.CitizenRecordsV1.mergeResidentImagingRecords(state.personalRecords, citizenImagingDashboard);
    state.personalRecords = window.CitizenRecordsV1.mergeResidentClinicalRecords(state.personalRecords, state);
    state.personalRecords = window.CitizenRecordsV1.mergeResidentSecureAttachments(state.personalRecords, citizenSecureAttachments);
  }
  escortDashboard = await fetchCitizenEscortDashboard();
  registrationDashboard = await fetchCitizenRegistrationDashboard();
  familyDoctorDashboard = await fetchCitizenFamilyDoctorDashboard();
  serviceOrderCenter = await fetchCitizenServiceOrders();
  citizenMessages = await fetchCitizenMessages();
  citizenOperationsPublicFeed = await fetchCitizenOperationsPublicFeed();
  ensureAccounts();
  populateAccounts();
  bindLargeMode();
  bindServiceTabs();
  renderModuleInterfaces();
  renderDataGovernance();
  renderCitizenPipelineAudit();
  renderClientChannels();
  renderCitizenOperationsPublicFeed();
  window.addEventListener("popstate", () => setServiceTab(serviceTabFromRoute() || "health-record", { syncUrl: false }));
  window.addEventListener("hashchange", () => setServiceTab(serviceTabFromRoute() || "health-record", { syncUrl: false }));
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "set-service-tab") return;
    setServiceTab(event.data.service, { pushState: true, scrollToPane: false, notifyPreview: false });
  });
  document.querySelector("#account-select").addEventListener("change", (event) => {
    currentAccountId = event.target.value;
    const account = getCurrentAccount();
    renderAccount(account);
    renderCitizen(account.members[0]?.residentId);
  });
  bindDialogs();
  bindAccessReview();
  bindCitizenCareWorkspace();
  bindFollowupFeedback();
  bindResidentExperienceCheckin();
  bindEscortAppointment();
  bindFamilyDoctorApplication();
  bindRegistrationAppointment();
  bindLongTermCareAssessment();
  bindResidentTaskActions();
  bindLifecycleActionButtons();
  bindCitizenMessageReceipts();
  bindCitizenServiceSwipe();
  currentAccountId = state.accounts[0]?.id;
  const account = getCurrentAccount();
  renderAccount(account);
  renderCitizen(account?.members[0]?.residentId || state.residents[0]?.id);
});

function bindServiceTabs() {
  const target = document.querySelector("#service-tabs");
  const launchedTabs = getLaunchedCitizenServiceTabs();
  if (target) {
    target.innerHTML = launchedTabs.map((item) => {
      const meta = serviceNavigationMeta(item);
      return `<a href="${citizenPageHref(item.key)}" data-service-tab="${item.key}" data-service-state="${item.status}" aria-current="${item.key === activeServiceTab ? "page" : "false"}">
      <span>${item.label}</span>
      <strong class="ready">${item.status}</strong>
      <small>${item.detail}</small>
      <small class="service-tab-meta">${meta.featureCount} 项可用能力</small>
      <small class="service-tab-interface">按身份与授权范围展示</small>
      <small class="service-tab-boundary">连接状态由平台后台核验</small>
      <em>二级页面</em>
    </a>`;
    }).join("");
    target.querySelectorAll("[data-service-tab]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        setServiceTab(link.dataset.serviceTab, { pushState: true, scrollToPane: true });
      });
    });
  }
  renderMobileServiceNav();
  updateServicePanes();
}

function renderMobileServiceNav() {
  const target = document.querySelector("#mobile-service-nav");
  if (!target) return;
  target.innerHTML = getLaunchedCitizenServiceTabs().map((item) => {
    const active = item.key === activeServiceTab;
    const meta = serviceNavigationMeta(item);
    return `<a href="${citizenPageHref(item.key)}" data-mobile-service-tab="${item.key}" data-mobile-service-state="${item.status}" data-mobile-service-count="${meta.featureCount}" title="${item.label}：${meta.featureCount}项已实现能力；连接状态由平台后台核验" aria-label="${item.label}，${item.status}，${meta.featureCount}项已实现能力，连接状态由平台后台核验" aria-current="${active ? "page" : "false"}">
    <span>${item.label}</span>
    <small class="ready service-count-badge">${mobileServiceBadgeLabel(item, active)}</small>
  </a>`;
  }).join("");
  target.querySelectorAll("[data-mobile-service-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setServiceTab(link.dataset.mobileServiceTab, { pushState: true, scrollToPane: false });
    });
  });
}

function renderMobileServiceRail() {
  const target = document.querySelector("#mobile-service-rail");
  if (!target) return;
  const tabs = getLaunchedCitizenServiceTabs();
  if (!tabs.length) {
    target.innerHTML = "";
    return;
  }
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.key === activeServiceTab));
  const active = tabs[activeIndex] || tabs[0];
  target.innerHTML = `<div class="mobile-service-rail-status" data-mobile-rail-status aria-live="polite">
    <span>${active ? `${activeIndex + 1}/${tabs.length}` : "0/0"}</span>
    <strong>${active?.label || "居民服务"}</strong>
    <small>左右滑动切换二级页面</small>
  </div>
  <div class="mobile-service-rail-scroll" role="list">
    ${tabs.map((item, index) => {
      const activeItem = item.key === activeServiceTab;
      const meta = serviceNavigationMeta(item);
      return `<a href="${citizenPageHref(item.key)}" role="listitem" data-mobile-rail-tab="${item.key}" data-mobile-rail-index="${index + 1}" aria-current="${activeItem ? "page" : "false"}" aria-label="${item.label}，${activeItem ? "当前二级页面" : `${meta.featureCount}项已上线功能`}">
        <span>${item.label}</span>
        <small class="mobile-service-rail-state">${item.status}</small>
        <small>${activeItem ? "\u5f53\u524d" : `${meta.featureCount}\u9879`}</small>
      </a>`;
    }).join("")}
  </div>`;
  target.querySelectorAll("[data-mobile-rail-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setServiceTab(link.dataset.mobileRailTab, { pushState: true, scrollToPane: false });
    });
  });
  alignActiveMobileServiceRail(target);
}

function alignActiveMobileServiceRail(target) {
  const scroller = target?.querySelector(".mobile-service-rail-scroll");
  const activeLink = scroller?.querySelector('[data-mobile-rail-tab][aria-current="page"]');
  if (!scroller || !activeLink) return;
  requestAnimationFrame(() => {
    const centeredLeft = activeLink.offsetLeft - (scroller.clientWidth - activeLink.offsetWidth) / 2;
    const maximumLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    scroller.scrollLeft = Math.min(maximumLeft, Math.max(0, centeredLeft));
  });
}

function renderMobileServicePagebar() {
  const target = document.querySelector("#service-mobile-pagebar");
  if (!target) return;
  const tabs = getLaunchedCitizenServiceTabs();
  const active = getActiveCitizenService();
  const activeIndex = Math.max(0, tabs.findIndex((item) => item.key === active.key));
  const meta = serviceNavigationMeta(active);
  const previous = adjacentCitizenServiceTab(-1);
  const next = adjacentCitizenServiceTab(1);
  const internalAction = !active.actionHref;
  target.hidden = !isPagedCitizenServiceMode();
  target.innerHTML = `<button type="button" class="service-page-step" data-service-page-step="-1" aria-label="上一项：${previous?.label || active.label}">上一项</button>
    <div class="service-mobile-pagebar-current" aria-live="polite">
      <span>${activeIndex + 1}/${tabs.length} · ${getActiveClientChannel().label}</span>
      <strong>${active.label}</strong>
      <small>${active.status} · ${meta.featureCount} 项可用能力</small>
    </div>
    <button type="button" class="service-page-step primary" data-service-page-step="1" aria-label="下一项：${next?.label || active.label}">下一项</button>
    <div class="service-mobile-actionbar" aria-label="${active.label}手机端快捷操作">
      <a class="service-mobile-action primary" href="${internalAction ? citizenPageHref(active.key) : active.actionHref}" ${internalAction ? `data-mobile-primary-action="${active.key}"` : ""}>${active.actionLabel}</a>
      <button type="button" class="service-mobile-action" data-mobile-feature-list>功能清单</button>
    </div>`;
  target.querySelectorAll("[data-service-page-step]").forEach((button) => {
    button.addEventListener("click", () => {
      const destination = adjacentCitizenServiceTab(Number(button.dataset.servicePageStep || 1));
      if (destination) setServiceTab(destination.key, { pushState: true, scrollToPane: false });
    });
  });
  target.querySelector("[data-mobile-primary-action]")?.addEventListener("click", (event) => {
    event.preventDefault();
    invokeInternalServiceAction(event.currentTarget.dataset.mobilePrimaryAction);
  });
  target.querySelector("[data-mobile-feature-list]")?.addEventListener("click", () => {
    document.querySelector("#service-summary .service-subnav")?.scrollIntoView({ block: "start", behavior: "smooth" });
  });
}

function renderCitizenActionDock(immediateRecentLabel = "") {
  const target = document.querySelector("#citizen-action-dock");
  if (!target) return;
  const active = getActiveCitizenService();
  const items = citizenActionDockItems(active, immediateRecentLabel);
  const hint = citizenActionDockHint(active, items);
  const hasRecent = items.some((item) => item.recent);
  target.innerHTML = `<div class="citizen-action-dock-copy">
    <span>常用操作</span>
    <strong>${active.label}</strong>
    <div class="citizen-action-dock-meta">
      <small>${hint}</small>
      ${hasRecent ? `<button type="button" class="citizen-action-dock-reset" data-action-dock-reset aria-label="恢复${active.label}常用操作默认顺序">恢复默认</button>` : ""}
    </div>
  </div>
  <div class="citizen-action-dock-actions">
    ${items.map((item) => {
      const recentBadge = item.recent ? `<small>最近</small>` : "";
      if (item.href) {
        return `<a class="citizen-action-chip ${item.primary ? "primary" : ""} ${item.recent ? "recent" : ""}" href="${item.href}" data-action-dock-label="${item.label}" data-action-dock-service="${item.internal ? item.key : ""}" aria-label="${active.label}：${item.label}">${item.label}${recentBadge}</a>`;
      }
      return `<button type="button" class="citizen-action-chip ${item.tone === "primary" ? "primary" : ""} ${item.recent ? "recent" : ""}" data-action-dock-label="${item.label}" data-action-dock-target="${item.target || ""}" aria-label="${active.label}：${item.label}">${item.label}${recentBadge}</button>`;
    }).join("")}
  </div>`;
  target.querySelectorAll("[data-action-dock-service]").forEach((link) => {
    if (!link.dataset.actionDockService) {
      link.addEventListener("click", () => rememberCitizenAction(active.key, link.dataset.actionDockLabel));
      return;
    }
    link.addEventListener("click", (event) => {
      event.preventDefault();
      rememberCitizenAction(active.key, event.currentTarget.dataset.actionDockLabel);
      invokeInternalServiceAction(event.currentTarget.dataset.actionDockService);
      renderCitizenActionDock(event.currentTarget.dataset.actionDockLabel);
    });
  });
  target.querySelectorAll("[data-action-dock-target]").forEach((button) => {
    button.addEventListener("click", () => {
      rememberCitizenAction(active.key, button.dataset.actionDockLabel);
      const selector = button.dataset.actionDockTarget;
      const destination = selector ? document.querySelector(selector) : null;
      if (destination?.closest("[data-service-pane]")?.hidden) {
        setServiceTab(destination.closest("[data-service-pane]").dataset.servicePane, { pushState: true, scrollToPane: false });
      }
      (destination || getServicePageTarget(active.key))?.scrollIntoView({ block: "start", behavior: "smooth" });
      renderCitizenActionDock(button.dataset.actionDockLabel);
    });
  });
  target.querySelector("[data-action-dock-reset]")?.addEventListener("click", () => {
    clearCitizenRecentActions(active.key);
    renderCitizenActionDock();
  });
}

function bindCitizenServiceSwipe() {
  const shell = document.querySelector(".citizen-shell");
  if (!shell) return;
  let startX = 0;
  let startY = 0;
  let startedAt = 0;
  const interactiveSelector = "button, a, input, select, textarea, label, [role='button']";
  shell.addEventListener("touchstart", (event) => {
    if (!isPagedCitizenServiceMode() || event.touches.length !== 1) return;
    if (event.target.closest(interactiveSelector)) return;
    startX = event.touches[0].clientX;
    startY = event.touches[0].clientY;
    startedAt = Date.now();
  }, { passive: true });
  shell.addEventListener("touchend", (event) => {
    if (!startX || !isPagedCitizenServiceMode()) return;
    const touch = event.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    const elapsed = Date.now() - startedAt;
    startX = 0;
    startY = 0;
    startedAt = 0;
    if (elapsed > 900 || Math.abs(dx) < CITIZEN_SERVICE_SWIPE_THRESHOLD || Math.abs(dy) > CITIZEN_SERVICE_SWIPE_VERTICAL_LIMIT) return;
    const destination = adjacentCitizenServiceTab(dx < 0 ? 1 : -1);
    if (destination) setServiceTab(destination.key, { pushState: true, scrollToPane: false });
  }, { passive: true });
}

function renderModuleInterfaces() {
  const target = document.querySelector("#module-interface-grid");
  if (!target) return;
  target.innerHTML = citizenModuleInterfaces.map((item) => `<article class="module-interface-card">
    <div>
      <strong>${item.module}</strong>
      <span class="status ${item.status.includes("演示") ? "warn" : ""}">${item.status}</span>
    </div>
    <p><b>接口</b>${item.api}</p>
    <p><b>数据</b>${item.collections}</p>
    <small>${item.boundary}</small>
  </article>`).join("");
}

function renderDataGovernance(residentId = currentResidentId) {
  const target = document.querySelector("#data-governance-grid");
  if (!target) return;
  const authorizations = residentId ? getPersonalRecords(residentId, "authorizations") : [];
  const authorizationLifecycle = getAuthorizationLifecycle(authorizations);
  const emrSources = residentId ? new Set(getPersonalRecords(residentId, "emr").map((item) => classifyDataSource(item).label)) : new Set();
  const accessLogs = residentId ? (state.dataAccessLogs || []).filter((item) => item.residentId === residentId) : [];
  const residentMessages = residentId ? citizenMessages.filter((item) => !item.residentId || item.residentId === residentId) : [];
  const metrics = {
    identity: currentAccountId ? "居民账号已绑定" : "待登录",
    authorization: `${authorizationLifecycle.active}/${authorizations.length || 0} 条有效授权`,
    emr: `${emrSources.size || 0} 类来源`,
    access: `${accessLogs.length} 条访问记录`,
    notification: `${residentMessages.length} 条消息`
  };
  target.innerHTML = citizenGovernanceChecks.map((item) => `<article class="data-governance-card">
    <div>
      <strong>${item.title}</strong>
      <span class="status ${item.ready.includes("演示") ? "warn" : ""}">${item.ready}</span>
    </div>
    <p><b>当前证据</b>${metrics[item.key] || "待生成"}</p>
    <p><b>接口</b>${item.interface}</p>
    <small>${item.production}</small>
  </article>`).join("");
}

function renderCitizenPipelineAudit() {
  const target = document.querySelector("#citizen-pipeline-grid");
  const summary = document.querySelector("#citizen-pipeline-summary");
  const copyButton = document.querySelector("#copy-citizen-pipeline-audit");
  if (!target) return;
  const blocked = citizenPipelineAudit.filter((item) => item.blocker).length;
  const owners = new Set(citizenPipelineAudit.map((item) => item.owner).filter(Boolean));
  if (summary) summary.textContent = `${citizenPipelineAudit.length} 条管线 · ${blocked} 项上线阻断 · ${owners.size} 类责任方`;
  target.innerHTML = citizenPipelineAudit.map((item) => `<article class="citizen-pipeline-card">
    <div>
      <strong>${item.pipeline}</strong>
      <span class="status ${item.status.includes("演示") || item.status.includes("可预览") ? "warn" : ""}">${item.status}</span>
    </div>
    <p><b>入口</b>${item.entry}</p>
    <p><b>接口</b>${item.interface}</p>
    <p><b>责任</b>${item.owner}</p>
    <p><b>验收</b>${item.evidence}</p>
    <p><b>现场动作</b>${item.onsiteAcceptance}</p>
    <small>${item.blocker}</small>
  </article>`).join("");
  copyButton?.addEventListener("click", copyCitizenPipelineAcceptance);
}

async function copyCitizenPipelineAcceptance() {
  const lines = [
    "C端全管线现场验收清单",
    `摘要：${citizenPipelineAudit.length}条管线，${citizenPipelineAudit.filter((item) => item.blocker).length}项上线阻断`,
    ...citizenPipelineAudit.map((item, index) => `${index + 1}. ${item.pipeline}｜状态：${item.status}｜入口：${item.entry}｜接口：${item.interface}｜责任方：${item.owner}｜现场动作：${item.onsiteAcceptance}｜阻断项：${item.blocker}｜证据：${item.evidence}`)
  ];
  await copyTextToClipboard(lines.join("\n"), "C端验收清单已复制");
}

function renderClientChannels() {
  const switcher = document.querySelector("#client-channel-switch");
  const detail = document.querySelector("#client-channel-detail");
  if (!switcher || !detail) return;
  const active = getActiveClientChannel();
  const currentEntry = clientChannelEntry(active.key, activeServiceTab);
  const materialSummary = productionMaterialSummary(active);
  document.body.dataset.clientChannel = active.key;
  switcher.innerHTML = citizenClientChannels.map((item) => `<button type="button" data-client-channel="${item.key}" aria-pressed="${item.key === active.key}">
    <span>${item.label}</span>
    <small>${item.status}</small>
  </button>`).join("");
  switcher.querySelectorAll("[data-client-channel]").forEach((button) => {
    button.addEventListener("click", () => setClientChannel(button.dataset.clientChannel));
  });
  detail.innerHTML = `<article>
    <div>
      <span>当前运行形态</span>
      <strong>${active.label}</strong>
      <small>${active.audience}</small>
      <div class="client-material-summary" aria-label="P0上线材料摘要">
        <span><b>${materialSummary.total}</b><small>P0材料</small></span>
        <span><b>${materialSummary.onsite}</b><small>现场补齐</small></span>
        <span><b>${materialSummary.owners}</b><small>责任方</small></span>
      </div>
    </div>
    <div class="client-channel-entry">
      <code>${currentEntry}</code>
      <div class="client-channel-actions">
        <a class="client-channel-action primary" href="./${currentEntry}">打开入口</a>
        <button type="button" class="client-channel-action" data-copy-client-entry="${currentEntry}">复制入口</button>
        <button type="button" class="client-channel-action wide" data-copy-launch-materials="${active.key}">复制材料清单</button>
      </div>
    </div>
  </article>
  <div class="client-channel-grid">
    <section>
      <h3>上线能力</h3>
      ${active.capabilities.map((item) => `<p>${item}</p>`).join("")}
    </section>
    <section>
      <h3>发布条件</h3>
      ${active.readiness.map((item) => `<p>${item}</p>`).join("")}
    </section>
    <section class="client-production-materials">
      <h3>P0现场材料</h3>
      ${active.productionMaterials.map((item) => `<p><strong>${item.label}</strong><span>${item.status}</span><em>${item.owner}</em><small>${item.note}</small><small>验收：${item.acceptance}</small></p>`).join("")}
    </section>
    <section>
      <h3>下一步</h3>
      <p>${active.nextAction}</p>
    </section>
    <section class="client-launch-checklist">
      <h3>发布检查</h3>
      ${active.launchChecklist.map((item) => `<p><strong>${item.label}</strong><span>${item.state}</span><small>${item.note}</small></p>`).join("")}
    </section>
  </div>`;
  detail.querySelector("[data-copy-client-entry]")?.addEventListener("click", (event) => copyClientEntry(event.currentTarget.dataset.copyClientEntry));
  detail.querySelector("[data-copy-launch-materials]")?.addEventListener("click", () => copyLaunchMaterials(active, currentEntry));
}

function productionMaterialSummary(channel) {
  const materials = channel.productionMaterials || [];
  const onsite = materials.filter((item) => String(item.status || "").includes("现场补齐")).length;
  const owners = new Set(materials.map((item) => item.owner).filter(Boolean));
  return {
    total: materials.length,
    onsite,
    owners: owners.size
  };
}

function setClientChannel(key) {
  if (!citizenClientChannels.some((item) => item.key === key)) return;
  activeClientChannel = key;
  localStorage.setItem(CLIENT_CHANNEL_KEY, key);
  const params = new URLSearchParams(location.search);
  params.set("client", key);
  params.set("page", activeServiceTab);
  params.delete("service");
  history.replaceState({ citizenChannel: key, citizenPage: activeServiceTab }, "", `${location.pathname}?${params.toString()}#service-${activeServiceTab}`);
  renderClientChannels();
  updateServicePanes();
}

function getActiveClientChannel() {
  return citizenClientChannels.find((item) => item.key === activeClientChannel) || citizenClientChannels[0];
}

function clientChannelFromRoute() {
  const key = new URLSearchParams(location.search).get("client");
  return citizenClientChannels.some((item) => item.key === key) ? key : "";
}

function isPagedCitizenServiceMode() {
  const params = new URLSearchParams(location.search);
  return params.get("preview") === "mobile-nav" || ["app", "mini-program"].includes(activeClientChannel);
}

function isLaunchReviewMode() {
  return new URLSearchParams(location.search).get("launch") === "1";
}

function clientChannelEntry(channelKey, serviceKey) {
  const params = new URLSearchParams();
  params.set("client", channelKey);
  params.set("page", serviceKey);
  return `citizen.html?${params.toString()}#service-${serviceKey}`;
}

async function copyClientEntry(entry) {
  const url = new URL(entry, location.href).href;
  await copyTextToClipboard(url, "入口链接已复制");
}

async function copyLaunchMaterials(channel, entry) {
  const summary = productionMaterialSummary(channel);
  const active = getActiveCitizenService();
  const url = new URL(entry, location.href).href;
  const lines = [
    `居民端${channel.label}P0上线材料`,
    `二级页面：${active.label}`,
    `入口：${url}`,
    `摘要：${summary.total}项P0材料，${summary.onsite}项现场补齐，${summary.owners}个责任方`,
    ...channel.productionMaterials.map((item, index) => `${index + 1}. ${item.label}｜${item.status}｜责任方：${item.owner}｜验收：${item.acceptance}｜材料：${item.note}`)
  ];
  await copyTextToClipboard(lines.join("\n"), "P0材料清单已复制");
}

async function copyTextToClipboard(text, successMessage) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(text);
    showToast(successMessage);
  } catch (error) {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    showToast(successMessage);
  }
}

function serviceTabFromRoute() {
  const params = new URLSearchParams(location.search);
  const key = params.get("page") || params.get("service") || serviceTabFromHash();
  return getLaunchedCitizenServiceTabs().some((item) => item.key === key) ? key : "";
}

function serviceTabFromHash() {
  const key = decodeURIComponent(String(location.hash || "").replace(/^#service-/, ""));
  return getLaunchedCitizenServiceTabs().some((item) => item.key === key) ? key : "";
}

function featureNavId(item) {
  const index = residentFunctionAudit.filter((row) => row.service === item.service).indexOf(item);
  return `service-feature-${item.service}-${index + 1}`;
}

function setServiceTab(key, options = {}) {
  const launchedTabs = getLaunchedCitizenServiceTabs();
  const next = launchedTabs.some((item) => item.key === key) ? key : launchedTabs[0]?.key;
  if (!next) return;
  activeServiceTab = next;
  activeClientChannel = clientChannelFromRoute() || activeClientChannel;
  if (options.syncUrl !== false) {
    const nextUrl = citizenPageHref(next);
    if (`${location.pathname}${location.search}${location.hash}` !== nextUrl) {
      const historyMethod = options.pushState ? "pushState" : "replaceState";
      history[historyMethod]({ citizenPage: next }, "", nextUrl);
    }
  }
  updateServicePanes();
  if (options.scrollToPane && !isPagedCitizenServiceMode()) {
    requestAnimationFrame(() => {
      getServicePageTarget(next)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  }
  if (options.notifyPreview !== false) {
    notifyPreviewServiceChange(next);
  }
}

function notifyPreviewServiceChange(service) {
  if (window.parent === window) return;
  window.parent.postMessage({ type: "citizen-service-changed", service }, location.origin);
}

function getServicePageTarget(key) {
  return document.querySelector(`[data-service-pane="${key}"]`) || document.querySelector("#service-page-content") || document.querySelector("#service-summary");
}

function invokeInternalServiceAction(key) {
  getServicePageTarget(key)?.scrollIntoView({ block: "start", behavior: "smooth" });
}

function citizenPageHref(key) {
  const params = new URLSearchParams(location.search);
  params.set("client", activeClientChannel);
  params.set("page", key);
  params.delete("service");
  const query = params.toString();
  return `${location.pathname}${query ? `?${query}` : ""}#service-${key}`;
}

function updateServicePanes() {
  const launchedTabs = getLaunchedCitizenServiceTabs();
  if (!launchedTabs.some((item) => item.key === activeServiceTab) && launchedTabs[0]) {
    activeServiceTab = launchedTabs[0].key;
  }
  document.body.classList.toggle("service-paged-mode", isPagedCitizenServiceMode());
  document.body.classList.toggle("launch-review-mode", isLaunchReviewMode());
  document.body.dataset.activeServicePage = activeServiceTab;
  renderServiceSummary();
  renderMobileServicePagebar();
  renderCitizenActionDock();
  renderMobileServiceRail();
  renderResidentFunctionAudit();
  renderClientChannels();
  document.querySelectorAll("[data-service-tab]").forEach((link) => {
    const active = link.dataset.serviceTab === activeServiceTab;
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
    link.setAttribute("href", citizenPageHref(link.dataset.serviceTab));
  });
  document.querySelectorAll("[data-mobile-service-tab]").forEach((link) => {
    const active = link.dataset.mobileServiceTab === activeServiceTab;
    link.classList.toggle("active", active);
    link.setAttribute("aria-current", active ? "page" : "false");
    link.setAttribute("href", citizenPageHref(link.dataset.mobileServiceTab));
    const badge = link.querySelector("small");
    const tab = launchedTabs.find((item) => item.key === link.dataset.mobileServiceTab);
    if (tab) link.dataset.mobileServiceCount = String(serviceNavigationMeta(tab).featureCount);
    if (badge && tab) badge.textContent = mobileServiceBadgeLabel(tab, active);
  });
  document.querySelectorAll("[data-service-pane]").forEach((pane) => {
    const launched = launchedTabs.some((item) => item.key === pane.dataset.servicePane);
    const activePane = launched && pane.dataset.servicePane === activeServiceTab;
    pane.hidden = !activePane;
    pane.dataset.activeServicePane = activePane ? "true" : "false";
    pane.setAttribute("aria-hidden", activePane ? "false" : "true");
  });
  const active = getActiveCitizenService();
  document.title = `${active.label} · 居民端`;
}

function renderServiceSummary() {
  const target = document.querySelector("#service-summary");
  if (!target) return;
  const launchedTabs = getLaunchedCitizenServiceTabs();
  const active = getActiveCitizenService();
  const channel = getActiveClientChannel();
  const internalAction = !active.actionHref;
  const activeItems = getLaunchedResidentFunctionAudit(active.key);
  const meta = serviceNavigationMeta(active);
  const activeIndex = Math.max(0, launchedTabs.findIndex((item) => item.key === active.key));
  target.innerHTML = `<div class="service-summary-copy">
    <span>当前二级页面 · ${channel.label}</span>
    <strong>${active.label}</strong>
    <small>${active.title} · ${active.detail}</small>
    <div class="service-summary-meta">
      <span>${meta.featureCount} 项已实现能力</span>
      <span>仅展示当前居民有权查看的内容</span>
      <span>正式连接状态由平台后台统一核验</span>
    </div>
    <div class="service-call-contract" data-service-call-contract>
      <span>居民服务入口已就绪</span>
      <strong>按本人身份和授权范围读取</strong>
      <small>敏感操作会再次确认当前居民</small>
      <small>访问行为进入安全审计记录</small>
    </div>
  </div>
  <div class="service-summary-actions">
    <div class="service-summary-mobile-status" aria-live="polite">
      <span>${activeIndex + 1}/${launchedTabs.length}</span>
      <strong>${active.label}</strong>
      <small>${active.status} · ${meta.featureCount} 项可用</small>
    </div>
    <div class="service-summary-stats">
      <span class="feature-state ready">${launchedTabs.length} 项已上线</span>
      <span class="feature-state ready">仅显示上线功能</span>
    </div>
    <a class="service-page-action" href="${internalAction ? citizenPageHref(active.key) : active.actionHref}" ${internalAction ? `data-service-action="${active.key}"` : ""}>${active.actionLabel}</a>
  </div>
  <nav class="service-subnav" aria-label="${active.label}功能导航">
    ${activeItems.map((item) => {
      return `<a href="#${featureNavId(item)}" data-service-feature="${featureNavId(item)}">
        <span>${item.name}</span>
        <small class="ready">${item.status}</small>
      </a>`;
    }).join("")}
  </nav>`;
  target.querySelector("[data-service-action]")?.addEventListener("click", (event) => {
    event.preventDefault();
    invokeInternalServiceAction(event.currentTarget.dataset.serviceAction);
  });
  target.querySelectorAll("[data-service-feature]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      document.querySelector(`#${event.currentTarget.dataset.serviceFeature}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
    });
  });
}

function renderResidentFunctionAudit() {
  const grid = document.querySelector("#resident-audit-grid");
  const stats = document.querySelector("#resident-audit-stats");
  const summary = document.querySelector("#resident-audit-summary");
  if (!grid || !stats || !summary) return;
  const visibleItems = getLaunchedResidentFunctionAudit();
  const activeService = getActiveCitizenService();
  const activeItems = getLaunchedResidentFunctionAudit(activeService.key);
  summary.textContent = `${activeService.label}：${activeItems.length} 项已上线功能`;
  stats.innerHTML = `
    <span class="feature-state ready">居民端显示 ${visibleItems.length} 项上线功能</span>
    <span class="feature-state ready">仅展示上线能力</span>
    <span class="feature-state mobile">手机端触控审计已覆盖</span>`;
  grid.innerHTML = visibleItems.map((item) => {
    const service = getLaunchedCitizenServiceTabs().find((tab) => tab.key === item.service) || getActiveCitizenService();
    const active = item.service === activeServiceTab ? "active" : "";
    return `<article class="resident-audit-card ready ${active}" id="${featureNavId(item)}" data-audit-service="${item.service}">
      <div>
        <span>${service.label}</span>
        <strong>${item.name}</strong>
      </div>
      <em class="feature-state ready">${item.status}</em>
      <p>${item.evidence}</p>
      <small>${item.mobile}</small>
    </article>`;
  }).join("");
}

async function loadState() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/state`);
      if (response.ok) {
        const data = await response.json();
        data.chronicFollowupSummary = await loadChronicFollowupSummary();
        return data;
      }
    } catch (error) {
      // Fall back to browser data below.
    }
  }
  try {
    const response = await fetch("./data/db.json");
    if (response.ok) return await response.json();
  } catch (error) {
    // Fall back to browser data below.
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  return saved ? JSON.parse(saved) : fallbackState;
}

async function fetchCitizenMessages() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/messages`);
      if (response.ok) return (await response.json()).messages || [];
    } catch (error) {
      // Static and offline previews use the scoped state already loaded.
    }
  }
  return Array.isArray(state.taskMessages) ? state.taskMessages : [];
}

async function fetchCitizenImagingDashboard() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/imaging-cloud`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews use the already scoped local study collection.
    }
  }
  return {
    studies: Array.isArray(state.imageCloudStudies) ? state.imageCloudStudies : [],
    emrCompatibility: {
      diagnosticReports: Array.isArray(state.diagnosticReports) ? state.diagnosticReports : []
    }
  };
}

async function fetchCitizenSecureAttachments(residentId) {
  if (API_BASE && residentId) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/attachments?residentId=${encodeURIComponent(residentId)}`);
      if (response.ok) return (await response.json()).attachments || [];
    } catch (error) {
      // Static and offline previews use local attachment metadata when available.
    }
  }
  return Array.isArray(state.secureAttachments)
    ? state.secureAttachments.filter((item) => !residentId || item.residentId === residentId)
    : [];
}

async function fetchCitizenRegistrationDashboard() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/registrations/dashboard`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews use local registration schedules.
    }
  }
  return {
    ok: true,
    schedules: Array.isArray(state.registrationSchedules) && state.registrationSchedules.length ? state.registrationSchedules : registrationSchedules,
    orders: Array.isArray(state.registrationOrders) ? state.registrationOrders : [],
    summary: {},
    waitlist: { summary: {}, entries: [], boundary: "静态预览不提交候补队列操作。" },
    integration: { status: "static-preview" }
  };
}

async function fetchCitizenFamilyDoctorDashboard() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/phase2/family-doctor-contracts`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews use local family doctor collections.
    }
  }
  return {
    ok: true,
    templates: Array.isArray(state.phase2FamilyDoctorTemplates) ? state.phase2FamilyDoctorTemplates : [],
    teams: Array.isArray(state.phase2FamilyDoctorTeams) ? state.phase2FamilyDoctorTeams : [],
    packages: Array.isArray(state.phase2FamilyDoctorServicePackages) ? state.phase2FamilyDoctorServicePackages : [],
    applications: Array.isArray(state.phase2FamilyDoctorApplications) ? state.phase2FamilyDoctorApplications : [],
    contracts: Array.isArray(state.phase2FamilyDoctorContracts) ? state.phase2FamilyDoctorContracts : [],
    fulfillments: Array.isArray(state.phase2FamilyDoctorFulfillments) ? state.phase2FamilyDoctorFulfillments : [],
    summary: {}
  };
}

async function fetchCitizenServiceOrders(residentId = "") {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const query = residentId ? `?residentId=${encodeURIComponent(residentId)}` : "";
      const response = await request(`${API_BASE}/service-orders${query}`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews keep the locally aggregated service orders.
    }
  }
  return {
    ok: true,
    collection: "serviceOrders",
    orders: Array.isArray(state.serviceOrders) ? state.serviceOrders : [],
    summary: {}
  };
}

async function fetchCitizenOperationsPublicFeed() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/citizen-operations/public`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews keep the public demo feed.
    }
  }
  return citizenOperationsPublicFeed;
}

function renderCitizenOperationsPublicFeed() {
  const contentTarget = document.querySelector("#citizen-operation-content-feed");
  const agreementTarget = document.querySelector("#citizen-agreement-feed");
  const hospitalTarget = document.querySelector("#citizen-hospital-service-feed");
  if (!contentTarget || !agreementTarget || !hospitalTarget) return;
  const contents = citizenOperationsPublicFeed.contents || [];
  const agreements = citizenOperationsPublicFeed.agreements || [];
  const hospitals = citizenOperationsPublicFeed.hospitalServices || [];
  const contentTypeLabels = { banner: "服务焦点", article: "服务指南", message: "安全提示" };
  const acceptanceLabels = { "explicit-checkbox": "勾选确认", "signed-consent": "签署授权" };
  const serviceLabels = { appointment: "预约挂号", "report-query": "报告查询", "internet-nursing": "互联网护理", escort: "助医陪诊", "family-doctor": "家庭医生", "chronic-followup": "慢病随访" };
  contentTarget.innerHTML = contents.map((item) => `<article class="card" data-citizen-operation-content="${escapeHtml(item.id)}">
    <div class="card-head">
      <span>${escapeHtml(contentTypeLabels[item.type] || "服务公告")}</span>
      <em class="status">已发布</em>
    </div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.summary || "")}</p>
    <small>${escapeHtml(item.owner || "居民服务运营岗")}</small>
  </article>`).join("") || `<p class="muted">暂无已发布公告。</p>`;
  agreementTarget.innerHTML = agreements.map((item) => `<div data-citizen-agreement="${escapeHtml(item.id)}">
    <strong>${escapeHtml(item.name)}</strong>
    <span>${escapeHtml(item.version)} · ${escapeHtml(acceptanceLabels[item.acceptanceMode] || "明确确认")}</span>
    <small>${item.legalReviewStatus === "onsite-pending" ? "正式版待审核" : escapeHtml(item.legalReviewStatus || "有效")}</small>
  </div>`).join("") || `<div><strong>暂无协议版本</strong><span>请联系居民服务窗口</span></div>`;
  hospitalTarget.innerHTML = hospitals.map((item) => `<div data-citizen-hospital-service="${escapeHtml(item.id)}">
    <strong>${escapeHtml(item.institutionName)}</strong>
    <span>${(item.enabledServices || []).map((service) => escapeHtml(serviceLabels[service] || service)).join("、")}</span>
    <small>${item.launchScope === "white-list-demo" ? "白名单演示" : "待开通"} · 生产：${item.productionReady ? "已开通" : "未开通"}</small>
  </div>`).join("") || `<div><strong>暂无开放机构</strong><span>请稍后查看</span></div>`;
  const summaryTarget = document.querySelector("#citizen-service-public-feed-summary");
  if (summaryTarget) summaryTarget.textContent = `${contents.length} 条公告 · ${agreements.length} 个有效协议 · ${hospitals.length} 家演示开放机构`;
  const boundaryTarget = document.querySelector("#citizen-service-public-boundary");
  if (boundaryTarget) boundaryTarget.textContent = "当前为演示公开信息，不代表生产服务已经开通；正式服务范围、协议版本、实名结果及支付退费规则以现场联调和审核发布结果为准。";
}

function ensureAccounts() {
  if (Array.isArray(state.accounts) && state.accounts.length) return;
  state.accounts = [
    {
      id: "a1",
      name: `${state.residents[0]?.name || "居民"}账户`,
      phone: state.residents[0]?.phone || "",
      role: "本人",
      members: state.residents.slice(0, 1).map((resident) => ({ residentId: resident.id, relation: "本人" }))
    }
  ];
}

function populateAccounts() {
  const select = document.querySelector("#account-select");
  select.innerHTML = state.accounts.map((item) => `<option value="${item.id}">${item.name}</option>`).join("");
}

function getCurrentAccount() {
  return state.accounts.find((item) => item.id === currentAccountId) || state.accounts[0];
}

function renderAccount(account) {
  if (!account) return;
  document.querySelector("#account-select").value = account.id;
  document.querySelector("#account-name").textContent = account.name;
  document.querySelector("#account-meta").textContent = `${account.phone} · ${account.role} · ${account.members.length} 名成员`;
  document.querySelector("#member-list").innerHTML = account.members
    .map((member) => {
      const resident = state.residents.find((item) => item.id === member.residentId);
      const active = member.residentId === currentResidentId ? "active" : "";
      return `<button class="member-card ${active}" data-member="${member.residentId}">
        <strong>${resident?.name || "未知成员"}</strong>
        <span>${member.relation}</span>
      </button>`;
    })
    .join("");
  document.querySelectorAll("[data-member]").forEach((button) => {
    button.addEventListener("click", () => renderCitizen(button.dataset.member));
  });
}

function renderCitizen(residentId) {
  const resident = state.residents.find((item) => item.id === residentId) || state.residents[0];
  if (!resident) return;
  currentResidentId = resident.id;
  renderAccount(getCurrentAccount());

  const risk = assessRisk(resident);
  const diseases = state.diseases.filter((item) => item.residentId === resident.id);
  const followups = state.followups.filter((item) => item.residentId === resident.id);
  const records = getPersonalRecords(resident.id, "emr");

  document.querySelector("#profile-name").textContent = resident.name;
  document.querySelector("#profile-meta").textContent = `${resident.gender} · ${ageOf(resident.birthDate)} 岁 · ${resident.organization} · 家庭医生：${resident.familyDoctor}`;
  const riskPill = document.querySelector("#profile-risk");
  riskPill.textContent = risk.level;
  riskPill.className = `risk-pill risk-${risk.level}`;

  renderSummary(resident, diseases, followups, records);
  renderHealthTrends(resident);
  renderCitizenPhysicalExamHighlights(resident.id);
  renderReminderCenter(resident.id);
  renderServiceOrderCenter(resident.id);
  renderCitizenHighlightCenter(resident, diseases, followups, records);
  renderCitizenNotifications(resident.id);
  renderLifeCycle(resident, diseases, followups, records);
  renderVault(resident, diseases, followups, records);
  renderEmr(records, resident, diseases, followups);
  renderDiseases(diseases, risk);
  renderFollowups(followups);
  renderFollowupFeedback(resident.id, followups);
  renderResidentCheckin(resident.id);
  renderChronicServices(resident.id);
  renderReferrals(resident.id);
  renderBirthHealth(resident.id);
  renderMaternalChildContinuity(resident.id);
  renderEscortAppointments(resident.id);
  renderFamilyDoctorContracts(resident.id);
  renderRegistration(resident.id);
  renderLongTermCareAssessment(resident.id);
  renderPickups(resident.id);
  renderSeniorServices(resident.id);
  renderDigitalCredentials(resident.id);
  renderAccessLogs(resident.id);
  renderDataGovernance(resident.id);
  renderCitizenCareWorkspace(resident, diseases);
}

function bindLargeMode() {
  const button = document.querySelector("#large-mode");
  const enabled = localStorage.getItem(LARGE_MODE_KEY) === "1";
  document.body.classList.toggle("large-mode", enabled);
  button.setAttribute("aria-pressed", String(enabled));
  button.addEventListener("click", () => {
    const next = !document.body.classList.contains("large-mode");
    document.body.classList.toggle("large-mode", next);
    button.setAttribute("aria-pressed", String(next));
    localStorage.setItem(LARGE_MODE_KEY, next ? "1" : "0");
  });
}

function chronicReminderDaysUntil(dateText) {
  if (!dateText) return 999;
  const date = new Date(`${String(dateText).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 999;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86400000);
}

function chronicReminderStatus(dateText, status = "", risk = "") {
  const days = chronicReminderDaysUntil(dateText);
  const text = `${status} ${risk}`;
  if (String(text).includes("逾期") || days < 0) return "已逾期";
  if (days === 0) return "今日到期";
  if (/高危|预警|high|alert/i.test(text) || days <= 7) return "重点提醒";
  return "计划内";
}

function buildResidentChronicReminderQueue(residentId) {
  const apiAlerts = (state.chronicFollowupSummary?.alertQueue || []).filter((item) => item.residentId === residentId);
  if (apiAlerts.length) {
    return apiAlerts.map((item) => ({
      title: item.title || `${item.type || "chronic"}提醒`,
      detail: `${item.dueAt || ""} · ${item.owner || item.familyDoctor || ""} · ${item.nextAction || item.detail || ""}`,
      status: item.dueBucket === "overdue" ? "已逾期" : item.dueBucket === "due-today" ? "今日到期" : ["critical", "high"].includes(item.priority) ? "重点提醒" : "计划内"
    }));
  }
  return [
    ...(state.followups || []).filter((item) => item.residentId === residentId && item.status !== "已完成").map((item) => ({
      title: `${item.diseaseType}随访提醒`,
      detail: `${item.plannedAt} · ${item.assignee} · ${item.advice || "按计划随访"}`,
      status: chronicReminderStatus(item.plannedAt, item.status, item.diseaseType)
    })),
    ...(state.medicationPickups || []).filter((item) => item.residentId === residentId && !["已完成", "已取药"].includes(item.status)).map((item) => ({
      title: `${item.medication}取药提醒`,
      detail: `${item.nextPickup} · ${item.pharmacy} · ${item.insuranceReview || "待医保审核"}`,
      status: chronicReminderStatus(item.nextPickup, item.status, item.medication)
    })),
    ...(state.chronicManagementPlans || []).filter((item) => item.residentId === residentId && !["已完成", "已复核"].includes(item.status)).map((item) => ({
      title: `${item.diseaseType}管理复核`,
      detail: `${item.nextReview} · ${item.owner} · ${item.intervention || item.plan || "按管理计划复核"}`,
      status: chronicReminderStatus(item.nextReview, item.status, item.grade)
    })),
    ...(state.taskMessages || []).filter((item) => item.residentId === residentId && item.targetRole === "citizen" && item.chronicFollowup && !["read", "handled"].includes(String(item.status || "").toLowerCase())).map((item) => ({
      title: item.title || "慢病随访处置",
      detail: `${item.createdAt ? item.createdAt.slice(0, 10) : ""} · ${item.body || "请查看家庭医生处置意见"}`,
      status: "机构回执"
    }))
  ].sort((a, b) => ({ "已逾期": 0, "今日到期": 1, "重点提醒": 2, "机构回执": 3, "计划内": 4 }[a.status] ?? 9) - ({ "已逾期": 0, "今日到期": 1, "重点提醒": 2, "机构回执": 3, "计划内": 4 }[b.status] ?? 9));
}

function renderReminderCenter(residentId) {
  const reminders = buildResidentServiceTasks(residentId);
  const countEl = document.querySelector("#reminder-count");
  const listEl = document.querySelector("#reminder-cards");
  if (!countEl || !listEl) return;
  countEl.textContent = `${reminders.length} 项待办`;
  listEl.innerHTML = reminders.map((item) => `<article class="mini-card service-task-card ${item.priority === "high" ? "urgent" : ""}">
    <div class="service-task-head">
      <span>${item.service}</span>
      <a class="service-task-action" href="${citizenPageHref(item.page)}">${item.action}</a>
    </div>
    <h3>${item.title}</h3>
    <p class="muted">${item.detail}</p>
    <div class="service-task-meta">
      <small>${item.due || "时间待确认"}</small>
      <span class="status ${serviceTaskStatusClass(item.status, item.due)}">${item.status}</span>
    </div>
    <div class="service-task-buttons">
      ${renderServiceTaskButtons(item)}
    </div>
  </article>`).join("") || `<p class="muted">暂无服务待办，居民端会在预约、随访或授权到期时自动汇总。</p>`;
}

function isResidentServiceTaskOpen(item) {
  return !RESIDENT_TASK_CLOSED_STATUSES.has(String(item?.status || "").trim());
}

function buildResidentServiceTasks(residentId) {
  return [
    ...(state.followups || []).filter((item) => item.residentId === residentId && item.status !== "已完成").map((item) => ({
      taskId: `followups:${item.id}`,
      collection: "followups",
      service: "慢病随访",
      title: `${item.diseaseType}随访`,
      detail: `${item.plannedAt} · ${item.assignee} · ${item.advice || "按计划随访"}`,
      status: item.status,
      due: item.plannedAt,
      page: "emr",
      action: "填写反馈"
    })),
    ...(state.chronicScreeningTasks || []).filter((item) => item.residentId === residentId && !["已评估", "已推送干预"].includes(item.status)).map((item) => ({
      taskId: `chronicScreeningTasks:${item.id}`,
      collection: "chronicScreeningTasks",
      service: item.sourceType === "physical-exam" ? "体检异常" : "慢病筛查",
      title: item.sourceType === "physical-exam" ? `${item.taskName}（${item.riskLevel}）` : `${item.taskName}筛查`,
      detail: `${item.due} · ${item.institution} · ${item.nextStep}${item.sourceReportNo ? ` · 报告号 ${item.sourceReportNo}` : ""}`,
      status: item.status,
      due: item.due,
      page: "health-record",
      action: item.sourceType === "physical-exam" ? "查看体检报告" : "查看档案",
      sourceType: item.sourceType,
      residentConfirmation: item.residentConfirmation,
      priority: item.sourceType === "physical-exam" && item.riskLevel === "高危" ? "high" : "normal"
    })),
    ...(state.chronicEducationPushes || []).filter((item) => item.residentId === residentId && !["已确认", "已阅读"].includes(item.status)).map((item) => ({
      taskId: `chronicEducationPushes:${item.id}`,
      collection: "chronicEducationPushes",
      service: "健康宣教",
      title: `${item.topic}宣教`,
      detail: `${item.pushAt} · ${item.channel} · ${item.feedback}`,
      status: item.status,
      due: item.pushAt,
      page: "health-record",
      action: "查看内容"
    })),
    ...(state.medicationPickups || []).filter((item) => item.residentId === residentId && !["已完成", "已取药"].includes(item.status)).map((item) => ({
      taskId: `medicationPickups:${item.id}`,
      collection: "medicationPickups",
      service: "固定取药",
      title: `${item.medication}固定取药`,
      detail: `${item.nextPickup} · ${item.pharmacy} · ${item.insuranceReview || "待医保审核"}`,
      status: item.status,
      due: item.nextPickup,
      page: "health-record",
      action: "查看用药"
    })),
    ...(state.referralSystem?.referrals || []).filter((item) => item.residentId === residentId && !["已完成", "基层承接"].includes(item.status)).map((item) => ({
      taskId: `referrals:${item.id}`,
      collection: "referrals",
      service: "转诊号源",
      title: `${item.type}转诊`,
      detail: `${item.from} -> ${item.to} · ${item.reservedResource}`,
      status: item.status,
      due: item.date,
      page: "registration",
      action: "查看挂号"
    })),
    ...getEscortOrders(residentId).filter(isResidentServiceTaskOpen).map((item) => ({
      taskId: `escortServiceOrders:${item.id}`,
      collection: "escortServiceOrders",
      service: "助医陪诊",
      title: `${item.hospital || "陪诊预约"} · ${item.department || "科室待确认"}`,
      detail: `${item.providerName || providerName(item.providerId)} · ${formatEscortItems(item.serviceItems)} · 合同 ${formatEscortStatus(item.contractStatus)}`,
      status: formatEscortStatus(item.status),
      due: item.appointmentAt || item.due,
      page: "escort",
      action: "查看陪诊",
      rawStatus: item.status,
      taskAction: item.taskAction,
      residentConfirmation: item.residentConfirmation,
      familyContactStatus: item.familyContactStatus,
      qualityReview: item.qualityReview,
      priority: item.priority === "high" || item.riskLevel === "high" ? "high" : "normal"
    })),
    ...(state.internetNursingOrders || []).filter((item) => item.residentId === residentId && !["completed", "closed"].includes(item.status)).map((item) => ({
      taskId: `internetNursingOrders:${item.id}`,
      collection: "internetNursingOrders",
      service: "互联网护理",
      title: `${formatNursingServiceItem(item.serviceItem)}上门护理`,
      detail: `${item.institutionName || "机构待确认"} · ${item.nurseName || "护士待派单"} · ${formatNursingStage(item)}`,
      status: formatNursingStatus(item.status),
      due: item.preferredAt || item.requestedAt,
      page: "nursing",
      action: "查看护理",
      rawStatus: item.status,
      taskAction: item.taskAction,
      residentServiceConfirmation: item.residentServiceConfirmation,
      qualityCallback: item.qualityCallback,
      priority: item.riskLevel === "high" ? "high" : "normal"
    })),
    ...getAuthorizationLifecycle(getPersonalRecords(residentId, "authorizations"), new Date(), 30).items
      .filter((item) => ["expiring", "expired"].includes(item.lifecycleKey))
      .map((item) => ({
      taskId: `digitalCredentials:${item.id}`,
      collection: "digitalCredentials",
      service: "授权管理",
      title: `${item.granteeName || "授权对象待核验"}授权`,
      detail: `${item.purpose || "用途待补录"} · 有效期至 ${item.expiresAt.slice(0, 10)}`,
      status: item.lifecycleKey === "expired" ? "已过期" : "即将到期",
      due: item.expiresAt,
      page: "health-record",
      action: "管理授权",
      priority: item.lifecycleKey === "expired" ? "high" : "normal"
    }))
  ].sort((a, b) => String(a.due || "9999-12-31").localeCompare(String(b.due || "9999-12-31")));
}

function renderCitizenPhysicalExamHighlights(residentId) {
  const engine = window.PhysicalExaminationHighlights;
  if (!engine) return;
  const reports = (state.personalRecords || []).filter((item) => item.residentId === residentId && (item.category === "physical-exam" || item.meta?.physicalExam === true));
  const cases = (state.physicalExamAbnormalCases || []).filter((item) => item.residentId === residentId);
  const highlights = physicalExamHighlightsCache.get(residentId) || engine.build(state, reports, cases, { minimumAggregate: 3 });
  const summaryTarget = document.querySelector("#citizen-exam-highlight-summary");
  if (!summaryTarget) return;
  const summary = highlights.summary || {};
  summaryTarget.innerHTML = [
    ["历史报告", reports.length],
    ["健康轨迹", summary.trajectories || 0],
    ["待处理行动", summary.openActions || 0],
    ["放射记录", summary.radiationRecords || 0],
    ["健康护照", summary.activePassports || 0]
  ].map(([name, value]) => `<article><span>${escapeHtml(name)}</span><strong>${escapeHtml(value)}</strong></article>`).join("");

  const trajectories = (highlights.trajectories || []).filter((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-timeline", trajectories.map((item) => `<div class="exam-highlight-row"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.latest ? `${item.latest.value}${item.latest.unit || ""}` : "-")}</span><small>${item.delta === null ? "已建立基线" : `较上次 ${item.delta > 0 ? "+" : ""}${escapeHtml(item.delta)}`} · ${(item.points || []).length}个时间点</small></div>`).join("") || citizenExamEmpty("接入结构化报告后生成趋势。"));

  const actions = (highlights.actionCards || []).filter((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-actions", actions.map((item) => `<div class="exam-action-card ${item.priority}"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml((item.evidence || []).join("；"))}</p><small>${escapeHtml(item.nextStep)} · ${escapeHtml(item.dueAt || "尽快")}</small><div class="exam-action-buttons"><button type="button" data-exam-ack="${escapeHtml(item.id)}">我已了解</button><button type="button" data-exam-review="${escapeHtml(item.reportId)}" data-exam-department="${escapeHtml(item.appointmentDepartment)}">申请复查</button><a href="${escapeHtml(citizenPageHref("family-doctor"))}">联系家医</a></div><ol>${(item.steps || []).map((step) => `<li class="${step.completed ? "done" : "pending"}">${step.completed ? "✓" : "○"} ${escapeHtml(step.name)}</li>`).join("")}</ol></div>`).join("") || citizenExamEmpty("当前没有需要处理的体检异常。"));

  const translations = (highlights.translations || []).filter((item) => item.residentId === residentId).sort((a, b) => Number(b.status !== "within-report-range") - Number(a.status !== "within-report-range"));
  setCitizenExamHtml("citizen-exam-translations", translations.slice(0, 5).map((item) => `<details class="exam-translation"><summary><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.value)}</span></summary><p>${escapeHtml(item.plainMeaning)}</p><small>下一步：${escapeHtml(item.nextStep)} · ${escapeHtml(item.department)}</small><em>${escapeHtml(item.boundary)}</em></details>`).join("") || citizenExamEmpty("暂无可解释的结构化项目。"));

  const plan = (highlights.examPlans || []).find((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-plan", plan ? `<div class="exam-plan"><strong>${escapeHtml(plan.nextExamDate || "日期待医师确认")}</strong><p>${escapeHtml(plan.reason)}</p><div>${(plan.personalizedItems || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("") || "<span>基础年度体检</span>"}</div><small>生成方案须经医师审核，不能替代医学判断。</small></div>` : citizenExamEmpty("完成一次体检后生成下一年度计划。"));

  const repeats = (highlights.repeatAvoidance || []).filter((item) => item.residentId === residentId);
  const radiation = (highlights.radiationLedger || []).filter((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-radiation", `${repeats.map((item) => `<div class="exam-highlight-row warn"><strong>${escapeHtml(item.name || item.code)}可能重复</strong><span>${escapeHtml(item.intervalDays)}天</span><small>${escapeHtml(item.recommendation)}</small></div>`).join("") || `<div class="exam-highlight-row ok"><strong>未发现30天内重复项目</strong><small>是否复用结果仍由医师决定。</small></div>`}${radiation.map((item) => `<div class="exam-highlight-row"><strong>${escapeHtml(item.modality)} · ${escapeHtml(item.date)}</strong><span>${escapeHtml(item.dose ?? "-")}${escapeHtml(item.doseUnit || "")}</span><small>${escapeHtml(item.purpose || "检查目的待补")} · ${item.governanceStatus === "complete" ? "治理记录完整" : "待复核"}</small></div>`).join("") || `<div class="exam-highlight-row"><strong>暂无放射剂量记录</strong><small>不等于没有接受过放射检查。</small></div>`}`);

  const familyMap = (highlights.familyRiskMaps || [])[0];
  setCitizenExamHtml("citizen-exam-family-map", familyMap ? `<div class="family-risk-map"><p>${escapeHtml(familyMap.boundary)}</p>${(familyMap.members || []).map((member) => `<div class="family-risk-member ${member.authorized ? "authorized" : "locked"}"><strong>${escapeHtml(member.relation)} · ${escapeHtml(member.name)}</strong><span>${member.authorized ? escapeHtml((member.riskSignals || []).join("、") || "暂无风险线索") : "🔒 未授权不展示"}</span>${member.consentRequired && member.residentId === residentId ? `<button type="button" data-exam-family-consent data-account-id="${escapeHtml(familyMap.accountId)}">授权展示风险线索</button>` : ""}</div>`).join("")}</div>` : citizenExamEmpty("当前账户没有可展示的家庭成员。"));

  const achievements = (highlights.achievements || []).filter((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-achievements", achievements.map((item) => `<div class="exam-achievement ${item.achieved ? "achieved" : "locked"}"><span>${item.achieved ? "★" : "☆"}</span><div><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`).join("") || citizenExamEmpty("归集报告后点亮健康里程碑。"));

  const passports = (highlights.healthPassports || []).filter((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-passport", `<div class="passport-actions"><button type="button" data-exam-create-passport>创建7天健康护照</button><small>默认仅授权报告、趋势、异常和建议；所有访问需审计。</small></div>${passports.map((item) => `<div class="health-passport ${item.status}"><strong>${escapeHtml(item.accessRef)}</strong><span>${escapeHtml(item.status)} · 至 ${escapeHtml(item.expiresAt)}</span><small>${escapeHtml((item.scopes || []).join("、"))}</small>${item.status === "active" ? `<button type="button" data-exam-revoke-passport="${escapeHtml(item.id)}">撤销</button>` : ""}</div>`).join("")}`);

  const simulation = (highlights.simulations || []).find((item) => item.residentId === residentId);
  setCitizenExamHtml("citizen-exam-simulation", simulation ? `<div class="simulation-baseline"><span>当前教育基线</span><strong>${escapeHtml(simulation.baselineScore)}分</strong></div><div class="simulation-options">${(simulation.scenarios || []).map((item) => `<button type="button" data-exam-scenario="${escapeHtml(item.id)}" data-score="${escapeHtml(item.simulatedScore)}" data-range="${escapeHtml(item.changeRange)}">${escapeHtml(item.name)}</button>`).join("")}</div><div id="citizen-exam-simulation-result" class="simulation-result">选择一个情景查看方向性变化区间。</div><small>${escapeHtml(simulation.boundary)}</small>` : citizenExamEmpty("暂无可模拟的体检风险基线。"));
  document.querySelector("#citizen-exam-boundary").textContent = highlights.safetyBoundary || "";
  bindCitizenPhysicalExamHighlightActions(residentId);
}

function setCitizenExamHtml(id, html) {
  const target = document.querySelector(`#${id}`);
  if (target) target.innerHTML = html;
}

function citizenExamEmpty(message) {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function bindCitizenPhysicalExamHighlightActions(residentId) {
  document.querySelectorAll("[data-exam-scenario]").forEach((button) => button.addEventListener("click", () => {
    const target = document.querySelector("#citizen-exam-simulation-result");
    if (target) target.innerHTML = `<strong>模拟分值 ${escapeHtml(button.dataset.score)}</strong><span>${escapeHtml(button.dataset.range)}</span><small>这是健康教育情景，不预测个人疗效。</small>`;
  }));
  document.querySelectorAll("[data-exam-ack]").forEach((button) => button.addEventListener("click", () => performPhysicalExamHighlightAction({ action: "acknowledge-action", residentId, actionCardId: button.dataset.examAck }, "已记录您了解该异常行动")));
  document.querySelectorAll("[data-exam-review]").forEach((button) => button.addEventListener("click", () => performPhysicalExamHighlightAction({ action: "request-review", residentId, reportId: button.dataset.examReview, department: button.dataset.examDepartment, preferredDate: todayOffset(7), reason: "居民根据体检异常行动卡申请复查" }, "复查申请已进入号源确认队列")));
  document.querySelector("[data-exam-create-passport]")?.addEventListener("click", () => performPhysicalExamHighlightAction({ action: "create-passport", residentId, scopes: ["reports", "trends", "abnormal-findings", "recommendations"], expiresInDays: 7, purpose: "转诊或复诊资料调阅" }, "7天健康护照授权已创建"));
  document.querySelectorAll("[data-exam-revoke-passport]").forEach((button) => button.addEventListener("click", () => performPhysicalExamHighlightAction({ action: "revoke-passport", residentId, passportId: button.dataset.examRevokePassport }, "健康护照授权已撤销")));
  document.querySelector("[data-exam-family-consent]")?.addEventListener("click", (event) => performPhysicalExamHighlightAction({ action: "authorize-family-map", residentId, accountId: event.currentTarget.dataset.accountId }, "家庭健康地图授权已记录"));
}

async function performPhysicalExamHighlightAction(payload, successMessage) {
  try {
    if (!API_BASE) {
      window.PhysicalExaminationHighlights.applyAction(state, payload, { actor: "static-resident", canAccessResident: (id) => id === payload.residentId });
      physicalExamHighlightsCache.delete(payload.residentId);
    } else {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/physical-exams/highlights/actions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || `操作失败：${response.status}`);
      physicalExamHighlightsCache.set(payload.residentId, result.highlights);
    }
    renderCitizenPhysicalExamHighlights(payload.residentId);
    showToast(successMessage);
  } catch (error) {
    showToast(error.message);
  }
}

function serviceOrderStatusClass(status = "") {
  const value = String(status).toLowerCase();
  if (/cancel|reject|failed|异常|取消|拒绝|失败/.test(value)) return "danger";
  if (/pending|wait|待|审核|处理中|requested|submitted/.test(value)) return "warn";
  return "";
}

function serviceOrderLifecycle(status = "") {
  const value = String(status).toLowerCase();
  if (/completed|closed|done|已完成|已关闭|完诊|履约/.test(value)) return "已完成";
  if (/cancel|reject|failed|取消|拒绝|失败/.test(value)) return "已终止";
  if (/pending|wait|submitted|requested|待|审核|处理中/.test(value)) return "待处理";
  return "进行中";
}

function normalizeServiceOrder(row) {
  return {
    ...row,
    lifecycle: serviceOrderLifecycle(row.status),
    statusClass: serviceOrderStatusClass(row.status)
  };
}

function serviceOrderTypeLabel(type = "") {
  return {
    nursing: "护理",
    escort: "陪诊",
    registration: "挂号",
    "physical-exam": "体检",
    "family-doctor": "家医"
  }[String(type || "").trim()] || String(type || "服务");
}

function serviceOrderTypePage(type = "") {
  return {
    nursing: "nursing",
    escort: "escort",
    registration: "registration",
    "physical-exam": "health-record",
    "family-doctor": "family-doctor"
  }[String(type || "").trim()] || "service-orders";
}

function serviceOrderTypeAction(type = "") {
  return {
    nursing: "查看护理",
    escort: "查看陪诊",
    registration: "查看挂号",
    "physical-exam": "查看报告",
    "family-doctor": "查看家医"
  }[String(type || "").trim()] || "查看服务";
}

function officialServiceOrdersForResident(residentId) {
  const rows = Array.isArray(serviceOrderCenter?.orders) ? serviceOrderCenter.orders : [];
  return rows
    .filter((item) => item.residentId === residentId)
    .map((item) => normalizeServiceOrder({
      id: item.serviceOrderId || item.id,
      collection: item.sourceCollection || "serviceOrders",
      service: serviceOrderTypeLabel(item.serviceType || item.serviceName),
      title: item.title || "服务订单",
      status: item.status || item.lifecycle || "pending",
      date: item.scheduledAt || item.updatedAt || item.createdAt || "",
      institution: item.providerName || "服务机构待确认",
      primaryAction: serviceOrderTypeAction(item.serviceType || item.serviceName),
      page: item.entryPage || serviceOrderTypePage(item.serviceType || item.serviceName),
      sourceModel: item.sourceCollection || "serviceOrders"
    }))
    .sort((a, b) => String(b.date || "0000-00-00").localeCompare(String(a.date || "0000-00-00")));
}

function buildUnifiedServiceOrders(residentId) {
  const officialOrders = officialServiceOrdersForResident(residentId);
  if (officialOrders.length) return officialOrders;
  const physicalExams = getPersonalRecords(residentId, "physical-exam");
  return [
    ...(state.internetNursingOrders || []).filter((item) => item.residentId === residentId).map((item) => normalizeServiceOrder({
      id: `internetNursingOrders:${item.id}`,
      collection: "internetNursingOrders",
      service: "护理",
      title: `${formatNursingServiceItem(item.serviceItem)}上门护理`,
      status: formatNursingStatus(item.status),
      date: item.preferredAt || item.requestedAt || "",
      institution: item.institutionName || "护理机构待确认",
      primaryAction: "查看护理",
      page: "nursing",
      sourceModel: "internetNursingOrders"
    })),
    ...getEscortOrders(residentId).map((item) => normalizeServiceOrder({
      id: `escortServiceOrders:${item.id}`,
      collection: "escortServiceOrders",
      service: "陪诊",
      title: `${item.hospital || "陪诊预约"} · ${item.department || "科室待确认"}`,
      status: formatEscortStatus(item.status),
      date: item.appointmentAt || item.due || "",
      institution: item.providerName || providerName(item.providerId),
      primaryAction: "查看陪诊",
      page: "escort",
      sourceModel: "escortServiceOrders"
    })),
    ...activeRegistrationOrders(residentId).map((item) => normalizeServiceOrder({
      id: `registrationOrders:${item.id}`,
      collection: "registrationOrders",
      service: "挂号",
      title: `${formatRegistrationHospital(item.hospital)} · ${formatRegistrationDepartment(item.department)}`,
      status: formatRegistrationStatus(item.status),
      date: item.appointmentDate || item.createdAt || "",
      institution: `${formatRegistrationDoctor(item.doctor)} · ${item.queueNo || item.registrationNo || "待回执"}`,
      primaryAction: "查看挂号",
      page: "registration",
      sourceModel: "registrationOrders"
    })),
    ...physicalExams.map((item) => normalizeServiceOrder({
      id: `physicalExamRecords:${item.id}`,
      collection: "personalRecords",
      service: "体检",
      title: item.name || "体检报告",
      status: item.meta?.reviewStatus || item.meta?.status || "已归档",
      date: item.date || item.examDate || "",
      institution: item.source || item.meta?.institutionName || "体检机构",
      primaryAction: "查看报告",
      page: "health-record",
      sourceModel: "personalRecords[physical-exam]"
    })),
    ...familyDoctorApplications(residentId).map((item) => normalizeServiceOrder({
      id: `phase2FamilyDoctorApplications:${item.id}`,
      collection: "phase2FamilyDoctorApplications",
      service: "家医",
      title: `签约申请：${familyDoctorPackageName(item.packageId)}`,
      status: item.reviewStatus || item.status || "pending",
      date: item.desiredStartDate || item.submittedAt || "",
      institution: familyDoctorTeamName(item.teamId),
      primaryAction: "查看家医",
      page: "family-doctor",
      sourceModel: "phase2FamilyDoctorApplications"
    })),
    ...familyDoctorContracts(residentId).map((item) => normalizeServiceOrder({
      id: `phase2FamilyDoctorContracts:${item.id}`,
      collection: "phase2FamilyDoctorContracts",
      service: "家医",
      title: `签约服务：${familyDoctorPackageName(item.packageId)}`,
      status: item.status || item.renewalStatus || "active",
      date: item.nextServiceAt || item.endDate || "",
      institution: familyDoctorTeamName(item.teamId),
      primaryAction: "查看家医",
      page: "family-doctor",
      sourceModel: "phase2FamilyDoctorContracts"
    }))
  ].sort((a, b) => String(b.date || "0000-00-00").localeCompare(String(a.date || "0000-00-00")));
}

function renderServiceOrderCenter(residentId) {
  const summary = document.querySelector("#service-order-summary");
  const metrics = document.querySelector("#service-order-metrics");
  const cards = document.querySelector("#service-order-cards");
  if (!summary || !metrics || !cards) return;
  const orders = buildUnifiedServiceOrders(residentId);
  const services = ["护理", "陪诊", "挂号", "体检", "家医"];
  const openCount = orders.filter((item) => !["已完成", "已终止"].includes(item.lifecycle)).length;
  summary.textContent = `${orders.length} 个服务订单 · ${openCount} 个进行中/待处理 · 统一字段：服务、状态、时间、来源模型`;
  metrics.innerHTML = services.map((service) => {
    const rows = orders.filter((item) => item.service === service);
    const open = rows.filter((item) => !["已完成", "已终止"].includes(item.lifecycle)).length;
    return `<article><strong>${rows.length}</strong><span>${service}</span><small>${open} 个未完成</small></article>`;
  }).join("");
  cards.innerHTML = orders.slice(0, 12).map((item) => `<article class="service-order-card">
    <div>
      <span>${escapeHtml(item.service)}</span>
      <a class="service-task-action" href="${citizenPageHref(item.page)}">${escapeHtml(item.primaryAction)}</a>
    </div>
    <h3>${escapeHtml(item.title)}</h3>
    <p>${escapeHtml(item.institution || "服务机构待确认")}</p>
    <p class="muted">${escapeHtml(item.date || "时间待确认")} · ${escapeHtml(item.sourceModel)}</p>
    <div class="service-task-meta">
      <small>${escapeHtml(item.collection)}</small>
      <span class="status ${item.statusClass}">${escapeHtml(item.lifecycle)} · ${escapeHtml(item.status)}</span>
    </div>
  </article>`).join("") || `<p class="muted">暂无服务订单。提交护理、陪诊、挂号、体检或家医申请后会统一汇总在这里。</p>`;
}

function buildCitizenHighlightItems(resident, diseases = [], followups = [], records = []) {
  const residentId = resident.id;
  const physicalExams = getPersonalRecords(residentId, "physical-exam");
  const labs = getPersonalRecords(residentId, "labs");
  const medications = getPersonalRecords(residentId, "medications");
  const authorizations = getPersonalRecords(residentId, "authorizations");
  const authorizationLifecycle = getAuthorizationLifecycle(authorizations);
  const accessLogs = (state.dataAccessLogs || []).filter((item) => item.residentId === residentId).slice(0, 6);
  const orders = buildUnifiedServiceOrders(residentId);
  const reminders = buildResidentServiceTasks(residentId);
  const account = getCurrentAccount();
  const familyMembers = (account?.members || []).filter((item) => item.residentId !== residentId);
  const launchChannel = citizenClientChannels.find((item) => item.key === activeClientChannel) || citizenClientChannels[0];
  const openOrders = orders.filter((item) => !["已完成", "已终止", "completed", "closed"].includes(item.lifecycle));
  const vaultData = collectVaultData(resident, diseases, followups, records);
  const healthEvents = vaultData.timeline.slice(0, 5);
  const urgentReminders = reminders.filter((item) => item.priority === "high" || serviceTaskStatusClass(item.status, item.due) === "danger");
  const onsiteMaterials = launchChannel?.productionMaterials || [];
  const onsitePending = onsiteMaterials.filter((item) => String(item.status || "").includes("现场补齐") || String(item.status || "").includes("待")).length;
  return [
    {
      id: "health-timeline-2",
      title: "个人健康时间轴 2.0",
      status: `${healthEvents.length} 条近期事件`,
      metric: `${records.length + physicalExams.length + labs.length + medications.length}`,
      action: "查看时间轴",
      href: citizenPageHref("health-record"),
      detail: healthEvents.length ? healthEvents.map((item) => `${item.date || "待确认"} ${item.categoryLabel || item.category || "记录"}: ${item.name}`).join("；") : "暂无新增档案事件，上传报告或同步病历后自动进入时间轴。",
      evidence: "健康档案、电子病历、体检、检查检验和用药记录统一排序。",
      ready: Boolean(healthEvents.length)
    },
    {
      id: "service-order-center-plus",
      title: "统一服务订单中心深化",
      status: `${orders.length} 单 / ${openOrders.length} 未完成`,
      metric: openOrders.length,
      action: "查看订单",
      href: citizenPageHref("health-record"),
      detail: orders.slice(0, 4).map((item) => `${item.service}:${item.lifecycle}`).join("；") || "护理、陪诊、挂号、体检、家医提交后统一进入 serviceOrders。",
      evidence: "/api/service-orders 正式接口优先，保留本地聚合回退。",
      ready: true
    },
    {
      id: "privacy-control-deck",
      title: "居民授权与隐私驾驶舱",
      status: `${authorizationLifecycle.active}/${authorizations.length} 有效授权`,
      metric: accessLogs.length,
      action: "管理授权",
      href: citizenPageHref("health-record"),
      detail: accessLogs.length ? accessLogs.map((item) => `${item.actor || item.role || "系统"} ${item.action || item.reason || "访问"}`).join("；") : "暂无近期访问日志，授权、撤权和复核会进入审计记录。",
      evidence: "授权记录、撤权入口、访问日志和消息回执集中呈现。",
      ready: true
    },
    {
      id: "senior-accessibility",
      title: "适老化与无障碍增强",
      status: document.body.classList.contains("large-mode") ? "大字模式开启" : "大字模式可用",
      metric: "44px+",
      action: "切换大字",
      command: "toggle-large-mode",
      detail: "大字模式、底部导航、触控按钮、单列卡片和手机预览共同服务老人单手操作。",
      evidence: "居民端按钮、表单、底部导航和移动预览均按触控尺寸设计。",
      ready: true
    },
    {
      id: "family-health-collaboration",
      title: "家庭健康协同",
      status: `${familyMembers.length} 名家庭成员`,
      metric: familyMembers.length + 1,
      action: "切换成员",
      href: citizenPageHref("health-record"),
      detail: familyMembers.length ? familyMembers.map((member) => `${member.relation}:${residentDisplayName(member.residentId)}`).join("；") : "当前账号暂无其他家庭成员，可接入监护或亲情代办关系。",
      evidence: "家庭成员、授权范围、代办服务和家医签约统一按居民范围裁剪。",
      ready: true
    },
    {
      id: "smart-reminder-center",
      title: "智能提醒但不替代诊疗",
      status: `${reminders.length} 项提醒`,
      metric: urgentReminders.length,
      action: "查看提醒",
      href: citizenPageHref("health-record"),
      detail: reminders.slice(0, 4).map((item) => `${item.service}:${item.title}`).join("；") || "复诊、用药、体检异常、授权到期和服务回访会自动进入提醒。",
      evidence: "提醒只做服务导航和复核提示，不生成诊断结论。",
      ready: true
    },
    {
      id: "mobile-launch-pack",
      title: "小程序/APP 上线包",
      status: `${launchChannel?.label || "居民端"} / ${onsitePending} 项待补`,
      metric: onsiteMaterials.length,
      action: "复制材料",
      command: "copy-launch-pack",
      detail: onsiteMaterials.slice(0, 4).map((item) => `${item.label}:${item.status}`).join("；") || "生产域名、HTTPS、隐私协议、签名包、推送证书和真机截图待现场归档。",
      evidence: "mobile-preview、manifest、service worker、验收摘要和材料清单已串联。",
      ready: onsitePending === 0
    },
    {
      id: "emergency-assist-entry",
      title: "院前急救辅助入口",
      status: "拨打120优先",
      metric: "120",
      action: "进入急救",
      href: "./emergency.html",
      detail: "只提供拨打120、位置与健康摘要授权补充、紧急联系人和状态通知，不替代急救中心统一调度。",
      evidence: "院前急救入口复用居民身份、授权和健康摘要，正式出车必须进入120指挥调度。",
      ready: true
    }
  ];
}

function renderCitizenHighlightCenter(resident, diseases, followups, records) {
  const summary = document.querySelector("#citizen-highlight-summary");
  const grid = document.querySelector("#citizen-highlight-grid");
  if (!summary || !grid || !resident) return;
  const items = buildCitizenHighlightItems(resident, diseases, followups, records);
  const ready = items.filter((item) => item.ready).length;
  summary.textContent = `${items.length} 项亮点 · ${ready} 项已形成可操作闭环 · ${items.length - ready} 项待现场材料补齐`;
  grid.innerHTML = items.map((item, index) => `<article class="citizen-highlight-card" data-highlight="${item.id}">
    <div class="citizen-highlight-card-head">
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <em class="${item.ready ? "ready" : "pending"}">${item.ready ? "已实现" : "待补齐"}</em>
    </div>
    <div class="citizen-highlight-metric">
      <b>${escapeHtml(String(item.metric))}</b>
      <small>${escapeHtml(item.status)}</small>
    </div>
    <p>${escapeHtml(item.detail)}</p>
    <small>${escapeHtml(item.evidence)}</small>
    <div class="citizen-highlight-actions">
      ${item.href ? `<a class="service-task-action" href="${item.href}">${escapeHtml(item.action)}</a>` : ""}
      ${item.command ? `<button type="button" class="service-task-action" data-highlight-command="${item.command}">${escapeHtml(item.action)}</button>` : ""}
    </div>
  </article>`).join("");
  grid.querySelectorAll("[data-highlight-command]").forEach((button) => {
    button.addEventListener("click", () => runCitizenHighlightCommand(button.dataset.highlightCommand));
  });
}

function runCitizenHighlightCommand(command) {
  if (command === "toggle-large-mode") {
    document.querySelector("#large-mode")?.click();
    renderCitizen(currentResidentId);
    return;
  }
  if (command === "copy-launch-pack") {
    const channel = citizenClientChannels.find((item) => item.key === activeClientChannel) || citizenClientChannels[0];
    copyLaunchMaterials(channel, clientChannelEntry(channel.key, activeServiceTab));
  }
}

function residentDisplayName(residentId) {
  return (state.residents || []).find((item) => item.id === residentId)?.name || residentId || "家庭成员";
}

function renderServiceTaskButtons(item) {
  const buttons = [];
  if (shouldShowResidentConfirm(item)) buttons.push(["resident-confirm", "确认"]);
  if (item.collection === "chronicScreeningTasks" && item.sourceType === "physical-exam") {
    return buttons.map(([action, label]) => `<button type="button" data-task-id="${item.taskId}" data-task-collection="${item.collection}" data-resident-task-action="${action}">${label}</button>`).join("");
  }
  if (shouldShowCancelRequest(item)) buttons.push(["cancel-request", "取消"]);
  if (item.collection === "followups") buttons.push(["followup-feedback", "反馈"]);
  if (shouldShowQualityFeedback(item)) buttons.push(["quality-feedback", "评价"]);
  return buttons.map(([action, label]) => `<button type="button" data-task-id="${item.taskId}" data-task-collection="${item.collection}" data-resident-task-action="${action}">${label}</button>`).join("");
}

function shouldShowResidentConfirm(item) {
  return ![
    item.residentConfirmation,
    item.familyContactStatus,
    item.residentServiceConfirmation,
    item.taskAction
  ].includes("confirmed") && item.taskAction !== "resident-confirm";
}

function shouldShowCancelRequest(item) {
  const status = String(item.rawStatus || item.status || "").trim();
  return !RESIDENT_TASK_CLOSED_STATUSES.has(status) && item.taskAction !== "cancel-request";
}

function shouldShowQualityFeedback(item) {
  if (!["escortServiceOrders", "internetNursingOrders"].includes(item.collection)) return false;
  return ![
    item.qualityReview,
    item.qualityCallback,
    item.taskAction
  ].includes("citizen-feedback") && item.taskAction !== "quality-feedback";
}

function bindResidentTaskActions() {
  const target = document.querySelector("#reminder-cards");
  if (!target) return;
  target.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-resident-task-action]");
    if (!button) return;
    const action = button.dataset.residentTaskAction;
    const comment = action === "resident-confirm" ? "居民端确认服务安排" : window.prompt("请填写处理说明", defaultResidentTaskComment(action)) || defaultResidentTaskComment(action);
    button.disabled = true;
    try {
      await submitResidentTaskAction(button.dataset.taskId, button.dataset.taskCollection, {
        action,
        comment,
        satisfaction: action === "quality-feedback" ? "满意" : "",
        complaintStatus: action === "quality-feedback" ? "none" : ""
      });
      showToast("服务待办已更新");
      renderCitizen(currentResidentId);
    } catch (error) {
      showToast(error.message || "服务待办更新失败");
    } finally {
      button.disabled = false;
    }
  });
}

function defaultResidentTaskComment(action) {
  return {
    "cancel-request": "居民端申请取消，请服务团队确认",
    "followup-feedback": "居民已补充随访反馈，请家庭医生查看",
    "quality-feedback": "居民已完成服务评价"
  }[action] || "居民端确认服务安排";
}

async function submitResidentTaskAction(taskId, collection, payload) {
  if (API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/tasks/${encodeURIComponent(taskId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`服务待办更新失败：${response.status}`);
    const updated = await response.json();
    replaceResidentTaskItem(collection, updated);
    citizenMessages = await fetchCitizenMessages();
    serviceOrderCenter = await fetchCitizenServiceOrders();
    return updated;
  }
  const updated = applyLocalResidentTaskAction(taskId, collection, payload);
  citizenMessages.unshift(buildLocalCitizenMessage(updated, collection, payload));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return updated;
}

function applyLocalResidentTaskAction(taskId, collection, payload) {
  const itemId = String(taskId || "").split(":")[1];
  const rows = findResidentTaskRows(collection);
  const index = rows.findIndex((item) => item.id === itemId);
  if (index < 0) throw new Error("未找到服务待办");
  const now = new Date().toISOString();
  rows[index] = {
    ...rows[index],
    taskAction: payload.action,
    taskComment: payload.comment,
    handledAt: now,
    residentActionAt: now,
    residentFeedback: payload.comment || rows[index].residentFeedback,
    satisfaction: payload.satisfaction || rows[index].satisfaction
  };
  if (payload.action === "cancel-request") {
    rows[index].status = "cancel-requested";
    rows[index].cancellationReason = payload.comment || rows[index].cancellationReason;
    if (collection === "escortServiceOrders") rows[index].familyContactStatus = "cancel-requested";
  }
  if (payload.action === "resident-confirm" && collection === "escortServiceOrders") rows[index].familyContactStatus = "confirmed";
  if (payload.action === "quality-feedback" && collection === "escortServiceOrders") rows[index].qualityReview = "citizen-feedback";
  if (payload.action === "quality-feedback" && collection === "internetNursingOrders") rows[index].qualityCallback = "citizen-feedback";
  return rows[index];
}

function replaceResidentTaskItem(collection, updated) {
  const rows = findResidentTaskRows(collection);
  const index = rows.findIndex((item) => item.id === updated.id);
  if (index >= 0) rows[index] = updated;
}

function findResidentTaskRows(collection) {
  if (collection === "referrals") return state.referralSystem?.referrals || [];
  if (collection === "digitalCredentials") return state.personalRecords || [];
  if (!Array.isArray(state[collection])) state[collection] = [];
  return state[collection];
}

function buildLocalCitizenMessage(item, collection, payload) {
  return {
    id: `msg-local-${crypto.randomUUID()}`,
    taskId: `${collection}:${item.id}`,
    collection,
    sourceId: item.id,
    residentId: item.residentId || currentResidentId,
    targetRole: "institution",
    channel: "in_app",
    title: `居民端服务动作：${defaultResidentTaskComment(payload.action)}`,
    body: payload.comment || "居民端已处理服务待办",
    status: "sent",
    receipts: [],
    createdAt: new Date().toISOString(),
    createdBy: "citizen"
  };
}

function renderCitizenNotifications(residentId) {
  const summary = document.querySelector("#citizen-notification-summary");
  const cards = document.querySelector("#citizen-notification-cards");
  if (!summary || !cards) return;
  const messages = citizenMessages
    .filter((item) => !item.residentId || item.residentId === residentId)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, 6);
  summary.textContent = `${messages.length} 条消息`;
  cards.innerHTML = messages.map((item) => `<article class="mini-card citizen-notification-card">
    <div class="service-task-head">
      <span>${item.channel || "in_app"}</span>
      <button type="button" data-message-receipt="${item.id}" ${item.status === "read" ? "disabled" : ""}>${item.status === "read" ? "已读" : "标记已读"}</button>
    </div>
    <h3>${item.title || "服务通知"}</h3>
    <p class="muted">${item.body || "暂无消息内容"}</p>
    <small>${item.createdAt || "时间待确认"}</small>
  </article>`).join("") || `<p class="muted">暂无居民通知。预约变更、护士接单、陪诊师匹配和授权到期会在这里展示。</p>`;
}

function bindCitizenMessageReceipts() {
  const target = document.querySelector("#citizen-notification-cards");
  if (!target) return;
  target.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-message-receipt]");
    if (!button || button.disabled) return;
    button.disabled = true;
    try {
      await submitMessageReceipt(button.dataset.messageReceipt);
      renderCitizen(currentResidentId);
      showToast("通知已标记为已读");
    } catch (error) {
      showToast(error.message || "通知回执失败");
      button.disabled = false;
    }
  });
}

async function submitMessageReceipt(messageId) {
  if (API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/messages/${encodeURIComponent(messageId)}/receipt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "read" })
    });
    if (!response.ok) throw new Error(`通知回执失败：${response.status}`);
    const updated = await response.json();
    const index = citizenMessages.findIndex((item) => item.id === updated.id);
    if (index >= 0) citizenMessages[index] = updated;
    return updated;
  }
  const message = citizenMessages.find((item) => item.id === messageId);
  if (message) message.status = "read";
  return message;
}

function serviceTaskStatusClass(status, due) {
  if (["已逾期", "已过期"].includes(status) || (due && due < todayOffset(0))) return "danger";
  return String(status).includes("待") || String(status).includes("pending") || String(status).includes("requested") ? "warn" : "";
}

function formatNursingServiceItem(value) {
  const labels = {
    "wound care": "伤口护理",
    "blood glucose measurement": "血糖监测",
    "PICC maintenance": "PICC 维护"
  };
  return labels[value] || value || "护理";
}

function formatNursingStatus(value) {
  const labels = {
    requested: "待评估",
    dispatched: "已派单",
    accepted: "护士已接单",
    "in-service": "服务中",
    completed: "已完成"
  };
  return labels[value] || value || "待确认";
}

function formatNursingStage(item) {
  if (item.serviceRecordStatus && item.serviceRecordStatus !== "pending") return `服务记录 ${formatNursingStatus(item.serviceRecordStatus)}`;
  if (item.locationTrace && item.locationTrace !== "pending") return "位置轨迹已开启";
  if (item.informedConsent === "pending") return "待签署知情同意";
  if (item.firstVisitAssessment === "pending") return "待首诊评估";
  return "等待上门服务";
}

function resetVaultSearchState() {
  vaultSearchState.keyword = "";
  vaultSearchState.trust = "all";
  vaultSearchState.dateFrom = "";
  vaultSearchState.dateTo = "";
}

function bindVaultSearch(resident, diseases, followups, records) {
  if (vaultSearchResidentId !== resident.id) {
    vaultSearchResidentId = resident.id;
    resetVaultSearchState();
  }
  const fields = {
    keyword: document.querySelector("#vault-search-keyword"),
    trust: document.querySelector("#vault-search-trust"),
    dateFrom: document.querySelector("#vault-search-from"),
    dateTo: document.querySelector("#vault-search-to")
  };
  Object.entries(fields).forEach(([key, field]) => {
    if (!field) return;
    field.value = vaultSearchState[key];
    const update = () => {
      vaultSearchState[key] = field.value;
      renderVault(resident, diseases, followups, records);
    };
    field.oninput = key === "keyword" ? update : null;
    field.onchange = key === "keyword" ? null : update;
  });
  const clearButton = document.querySelector("#vault-search-clear");
  if (clearButton) {
    clearButton.onclick = () => {
      resetVaultSearchState();
      renderVault(resident, diseases, followups, records);
      document.querySelector("#vault-search-keyword")?.focus();
    };
  }
  const exportButton = document.querySelector("#export-health-record");
  if (exportButton) exportButton.onclick = () => openCitizenHealthRecordExport(resident.id);
}

function renderVault(resident, diseases, followups, records) {
  const grouped = collectVaultData(resident, diseases, followups, records);
  renderResidentRecordsV1Summary(resident.id);
  bindVaultSearch(resident, diseases, followups, records);
  const completeCount = vaultSections.filter((section) => section.key === "standard" || grouped[section.key]?.length).length;
  const score = Math.round((completeCount / vaultSections.length) * 100);
  document.querySelector("#completeness-score").textContent = `${score}%`;
  document.querySelector("#completeness-bar").style.width = `${score}%`;
  document.querySelector("#vault-updated").textContent = `最近更新：${latestDate(grouped)}`;

  document.querySelector("#vault-tabs").innerHTML = vaultSections
    .map((section) => {
      const count = grouped[section.key]?.length || 0;
      const active = section.key === activeVaultSection ? "active" : "";
      return `<button class="${active}" type="button" role="tab" aria-selected="${section.key === activeVaultSection}" data-vault="${escapeHtml(section.key)}">${escapeHtml(section.label)}<span>${count}</span></button>`;
    })
    .join("");

  document.querySelectorAll("[data-vault]").forEach((button) => {
    button.addEventListener("click", () => {
      activeVaultSection = button.dataset.vault;
      renderVault(resident, diseases, followups, records);
    });
  });

  if (activeVaultSection === "standard") {
    document.querySelector("#vault-search-status").textContent = "居民健康档案标准视图不使用记录筛选";
    document.querySelector("#vault-content").innerHTML = renderStandardArchive(resident.id);
    return;
  }

  const activeItems = grouped[activeVaultSection] || [];
  const filtered = window.CitizenRecordsV2?.filterResidentRecords(activeItems, {
    residentId: resident.id,
    ...vaultSearchState
  }) || { items: activeItems, total: activeItems.length, matched: activeItems.length, invalidRange: false, applied: false };
  const activeLabel = vaultSections.find((section) => section.key === activeVaultSection)?.label || "当前分类";
  document.querySelector("#vault-search-status").textContent = filtered.invalidRange
    ? "开始日期不能晚于结束日期"
    : filtered.applied
      ? `${activeLabel}：显示 ${filtered.matched} / ${filtered.total} 条`
      : `${activeLabel}：共 ${filtered.total} 条`;
  document.querySelector("#vault-content").innerHTML = filtered.items
    .map((item) => `<article class="vault-item">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <p>${escapeHtml(item.result)}</p>
        ${item.categoryLabel ? `<p class="muted">${escapeHtml(item.categoryLabel)}${item.related ? ` · ${escapeHtml(item.related)}` : ""}</p>` : ""}
        ${renderSourceBadge(item)}
        ${renderClinicalRecordMeta(item)}
        ${renderPhysicalExamMeta(item)}
        ${renderAttachmentMeta(item)}
        ${activeVaultSection === "authorizations" ? renderAuthorizationState(item) : ""}
      </div>
      <span>${escapeHtml(item.date)}<br>${escapeHtml(item.source)}</span>
      ${activeVaultSection === "authorizations" && isAuthorizationActive(item) ? `<button type="button" class="revoke-button" data-revoke-auth="${escapeHtml(item.id)}" aria-label="撤销对${escapeHtml(item.name)}的授权">撤销授权</button>` : ""}
    </article>`)
    .join("") || `<p class="muted">${filtered.invalidRange ? "请调整日期范围后重试。" : filtered.total && filtered.applied ? "没有符合当前筛选条件的记录。" : "当前分类暂无数据，可通过区域平台、医院电子病历或个人上传更新。"}</p>`;
  document.querySelectorAll("[data-revoke-auth]").forEach((button) => {
    button.addEventListener("click", () => revokeAuthorization(button.dataset.revokeAuth));
  });
  document.querySelectorAll("[data-view-imaging]").forEach((button) => {
    button.addEventListener("click", () => openCitizenImagingViewer(button.dataset.viewImaging));
  });
  document.querySelectorAll("[data-download-attachment]").forEach((button) => {
    button.addEventListener("click", () => downloadCitizenAttachment(button.dataset.downloadAttachment));
  });
}

function renderResidentRecordsV1Summary(residentId) {
  const target = document.querySelector("#resident-records-v1");
  if (!target) return;
  const records = Array.isArray(state.personalRecords) ? state.personalRecords : [];
  const summary = window.CitizenRecordsV1?.summarizeResidentRecords(records, residentId) || {
    records: records.filter((item) => item.residentId === residentId && item.category !== "authorizations").length,
    categories: 0,
    authoritative: 0,
    selfReported: 0,
    activeAuthorizations: 0,
    restrictedOriginals: 0
  };
  const cards = [
    ["只读健康记录", summary.records, `${summary.categories} 类资料`],
    ["可信来源", summary.authoritative, "医院/基层/公卫"],
    ["个人补充", summary.selfReported, "单独标记、待核验"],
    ["有效授权", summary.activeAuthorizations, `${summary.restrictedOriginals} 项原文受控`]
  ];
  target.innerHTML = cards.map(([label, value, detail]) => `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(detail)}</small>
  </article>`).join("");
}

function residentCareRecords(residentId) {
  const categories = window.CitizenRecordsV1
    ? [...window.CitizenRecordsV1.RESIDENT_RECORD_CATEGORIES]
    : vaultSections.map((item) => item.key);
  const seen = new Set();
  return categories.flatMap((category) => getPersonalRecords(residentId, category)).filter((record) => {
    const key = `${record.category}:${record.id || record.meta?.sourceRecordId || record.name}:${record.date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clearCitizenCareLocalPreview(residentId) {
  const preview = citizenExtra[residentId];
  if (!preview || typeof preview !== "object") return false;
  const keys = ["recordCorrections", "recordSharePackages", "careTaskUpdates", "accessAcknowledgements", "accessDisputes", "careWorkspaceMeta"];
  const changed = keys.some((key) => Object.hasOwn(preview, key));
  keys.forEach((key) => delete preview[key]);
  if (changed) localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  return changed;
}

function ensureCitizenCareCollections(residentId) {
  if (API_BASE) {
    clearCitizenCareLocalPreview(residentId);
    if (!citizenCareSession.has(residentId)) {
      citizenCareSession.set(residentId, {
        recordCorrections: [],
        recordSharePackages: [],
        accessAcknowledgements: [],
        accessDisputes: [],
        careTaskUpdates: {},
        sync: {}
      });
    }
    return citizenCareSession.get(residentId);
  }
  if (!citizenExtra[residentId]) citizenExtra[residentId] = {};
  const preview = citizenExtra[residentId];
  const hasPreviewData = ["recordCorrections", "recordSharePackages", "accessAcknowledgements", "accessDisputes"].some((key) => Array.isArray(preview[key]) && preview[key].length)
    || Object.keys(preview.careTaskUpdates || {}).length > 0;
  if (hasPreviewData && window.CitizenRecordsV2?.isCarePreviewExpired(preview.careWorkspaceMeta || {})) {
    clearCitizenCareLocalPreview(residentId);
  }
  ["recordCorrections", "recordSharePackages", "accessAcknowledgements", "accessDisputes"].forEach((key) => {
    if (!Array.isArray(preview[key])) preview[key] = [];
  });
  if (!preview.careTaskUpdates || typeof preview.careTaskUpdates !== "object") {
    preview.careTaskUpdates = {};
  }
  return preview;
}

function saveCitizenCareCollections(residentId) {
  if (API_BASE) return;
  const preview = ensureCitizenCareCollections(residentId);
  preview.careWorkspaceMeta = window.CitizenRecordsV2.buildCarePreviewMetadata();
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
}

function renderCitizenCareSyncStatus(residentId) {
  const target = document.querySelector("#citizen-care-sync-status");
  const clearButton = document.querySelector("[data-clear-care-workspace]");
  if (!target) return;
  if (!API_BASE) {
    const metadata = ensureCitizenCareCollections(residentId).careWorkspaceMeta;
    target.textContent = metadata?.expiresAt
      ? `本机演示 · ${metadata.expiresAt.slice(0, 16).replace("T", " ")} 前自动清理`
      : "本机演示 · 尚无敏感操作留存";
    if (clearButton) clearButton.textContent = "清理本机演示数据";
    return;
  }
  const status = citizenCareSyncStatus.get(residentId) || { key: "idle", label: "等待同步" };
  target.textContent = status.label;
  target.dataset.syncState = status.key;
  if (clearButton) clearButton.textContent = "清除本次会话缓存";
}

async function refreshCitizenCareWorkspace(residentId, options = {}) {
  if (!residentId) return;
  if (!API_BASE) {
    renderCitizenCareSyncStatus(residentId);
    if (!options.silent) showToast("静态预览使用本机演示数据，不连接生产工作台");
    return;
  }
  citizenCareSyncStatus.set(residentId, { key: "loading", label: "正在安全同步…" });
  renderCitizenCareSyncStatus(residentId);
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/record-care-workspace?residentId=${encodeURIComponent(residentId)}`, {
      headers: { Accept: "application/json" }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "工作台同步失败");
    const projected = window.CitizenRecordsV2.projectCareWorkspacePayload(payload, residentId);
    const merged = window.CitizenRecordsV2.mergeCareWorkspaceState(ensureCitizenCareCollections(residentId), projected);
    citizenCareSession.set(residentId, merged);
    const syncedAt = projected.sync.syncedAt || new Date().toISOString();
    citizenCareSyncStatus.set(residentId, {
      key: "synced",
      label: `已安全同步 · ${syncedAt.slice(0, 16).replace("T", " ")}`
    });
    if (currentResidentId === residentId) {
      const resident = state.residents.find((item) => item.id === residentId);
      const diseases = state.diseases.filter((item) => item.residentId === residentId);
      renderCitizenCareWorkspace(resident, diseases);
    }
    if (!options.silent) showToast("居民工作台已从服务端安全同步");
  } catch (error) {
    citizenCareSyncStatus.set(residentId, {
      key: "error",
      label: "同步失败 · 本次会话数据未写入本机"
    });
    renderCitizenCareSyncStatus(residentId);
    if (!options.silent) showToast(error.message || "工作台同步失败");
  }
}

function scheduleCitizenCareWorkspaceSync(residentId) {
  if (!API_BASE || citizenCareSyncRequested.has(residentId)) return;
  citizenCareSyncRequested.add(residentId);
  void refreshCitizenCareWorkspace(residentId, { silent: true });
}

function markCitizenCareActionSynced(residentId, receipt = {}) {
  if (!API_BASE) return;
  citizenCareSyncStatus.set(residentId, {
    key: "synced",
    label: `在线已确认 · ${receipt.auditRef || receipt.receiptId || "审计回执已生成"}`
  });
}

function citizenCareEmpty(message) {
  return `<p class="muted">${escapeHtml(message)}</p>`;
}

function citizenAccessReviewQueue(residentId) {
  if (!window.CitizenRecordsV2) return [];
  const logs = (state.dataAccessLogs || []).filter((item) => item.residentId === residentId);
  const authorizations = getPersonalRecords(residentId, "authorizations");
  return window.CitizenRecordsV2.buildAccessReviewQueue(logs, residentId, authorizations, new Date());
}

function safeCsvCell(value) {
  let text = String(value ?? "").replace(/\r?\n/g, " ");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function exportCitizenAccessReview(residentId) {
  const rows = window.CitizenRecordsV2.buildAccessExportRows(citizenAccessReviewQueue(residentId));
  if (!rows.length) {
    showToast("暂无可导出的访问记录");
    return;
  }
  const headers = ["访问时间", "访问主体", "主体角色", "访问范围", "访问用途", "访问结果", "居民复核"];
  const fields = ["time", "actor", "role", "scope", "purpose", "result", "review"];
  const csv = `\uFEFF${headers.map(safeCsvCell).join(",")}\r\n${rows.map((row) => fields.map((field) => safeCsvCell(row[field])).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resident-access-review-${residentId}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("最小化访问清单已导出");
}

function exportCitizenAuthorizationReceipts(residentId) {
  const records = getPersonalRecords(residentId, "authorizations");
  const rows = window.CitizenRecordsV2.buildAuthorizationReceiptExportRows(records, residentId);
  if (!rows.length) {
    showToast("暂无可导出的授权回执");
    return;
  }
  const headers = ["授权标识", "授权对象", "生命周期", "证据状态", "创建受理号", "创建审计号", "创建受理时间", "撤销受理号", "撤销审计号", "撤销受理时间"];
  const fields = ["authorizationId", "granteeName", "lifecycle", "evidenceState", "creationReceiptId", "creationAuditRef", "creationAcceptedAt", "revocationReceiptId", "revocationAuditRef", "revocationAcceptedAt"];
  const csv = `\uFEFF${headers.map(safeCsvCell).join(",")}\r\n${rows.map((row) => fields.map((field) => safeCsvCell(row[field])).join(",")).join("\r\n")}`;
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resident-authorization-receipts-${residentId}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("最小化授权回执证据已导出");
}

const citizenHealthRecordExportLabels = {
  emr: "电子病历摘要",
  labs: "检验检查",
  medications: "用药记录",
  imaging: "影像报告",
  attachments: "附件摘要",
  "physical-exam": "体检摘要",
  allergies: "过敏史",
  vaccines: "免疫接种",
  admissions: "住院记录摘要"
};

function selectedCitizenHealthRecordExportCategories(form = document.querySelector("#health-record-export-form")) {
  return form ? new FormData(form).getAll("categories") : [];
}

function renderCitizenHealthRecordExportPreview(residentId) {
  const form = document.querySelector("#health-record-export-form");
  const output = document.querySelector("#health-record-export-preview");
  const confirmButton = document.querySelector("#health-record-export-confirm");
  if (!form || !output || !confirmButton) return;
  const categories = selectedCitizenHealthRecordExportCategories(form);
  const archive = window.CitizenRecordsV2.buildResidentPortableArchive(residentCareRecords(residentId), residentId, new Date(), categories);
  confirmButton.disabled = categories.length === 0;
  output.textContent = categories.length
    ? `已选择 ${categories.length} 类，预计导出 ${archive.recordCount} 条：${categories.map((category) => `${citizenHealthRecordExportLabels[category]} ${archive.categoryCounts[category] || 0} 条`).join("；")}`
    : "请选择至少一类资料；未选择时不会生成文件";
}

function openCitizenHealthRecordExport(residentId) {
  const dialog = document.querySelector("#health-record-export-dialog");
  const form = document.querySelector("#health-record-export-form");
  if (!dialog || !form) return;
  form.reset();
  const verifyResult = document.querySelector("#health-record-verify-result");
  if (verifyResult) verifyResult.textContent = "文件仅在本机读取；最大 2 兆字节，不会上传或保存";
  renderCitizenHealthRecordExportPreview(residentId);
  dialog.showModal();
}

async function verifyCitizenHealthRecordFile(file) {
  const output = document.querySelector("#health-record-verify-result");
  if (!output || !file) return;
  output.textContent = "正在本机校验档案副本…";
  try {
    if (file.size > window.CitizenRecordsV2.MAX_PORTABLE_ARCHIVE_BYTES) {
      throw new Error("健康档案副本超过 2 兆字节大小上限");
    }
    const archive = window.CitizenRecordsV2.parseResidentPortableArchive(await file.text());
    const valid = await window.CitizenRecordsV2.verifyResidentPortableArchive(archive);
    output.textContent = valid
      ? `完整性校验通过：${archive.recordCount} 条记录，生成于 ${archive.generatedAt || "时间待核验"}。该结果不是来源真实性证明。`
      : "完整性校验失败：文件内容与 SHA-256 摘要不一致，或缺少受支持的完整性信息。";
  } catch (error) {
    output.textContent = `校验失败：${error.message || "文件格式不受支持"}`;
  }
}

async function exportCitizenHealthRecord(residentId, categories) {
  const records = residentCareRecords(residentId);
  const archive = window.CitizenRecordsV2.buildResidentPortableArchive(records, residentId, new Date(), categories);
  if (!archive.recordCount) {
    showToast("所选分类暂无可导出的健康档案摘要");
    return false;
  }
  const sealedArchive = await window.CitizenRecordsV2.sealResidentPortableArchive(archive);
  const payload = JSON.stringify(sealedArchive, null, 2).replace(/</g, "\\u003c");
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `resident-health-record-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast(`已导出 ${archive.recordCount} 条摘要，并附 SHA-256 完整性校验`);
  return true;
}

function renderCitizenCareWorkspace(resident, diseases = []) {
  const api = window.CitizenRecordsV2;
  const target = document.querySelector("#citizen-care-workspace");
  if (!api || !target || !resident) return;
  const careState = ensureCitizenCareCollections(resident.id);
  const records = residentCareRecords(resident.id);
  const workspace = api.summarizeCareWorkspace({
    residentId: resident.id,
    resident: { ...resident, identityVerified: Boolean(resident.id && resident.phone) },
    records,
    diseases,
    now: new Date()
  });
  const taskUpdates = careState.careTaskUpdates;
  const activeTasks = workspace.careTasks.map((task) => ({ ...task, ...(taskUpdates[task.id] || {}) }));
  const activeShares = careState.recordSharePackages.filter((item) => api.sharePackageState(item).active).length;
  const openCorrections = careState.recordCorrections.filter((item) => !["corrected", "rejected", "withdrawn"].includes(item.status)).length;
  const summaryCards = [
    ["跨院归集", workspace.records.length, `${new Set(workspace.records.map((item) => item.provenance?.sourceOrganization).filter(Boolean)).size} 个来源`],
    ["异常待办", activeTasks.filter((item) => !["completed", "closed"].includes(item.status)).length, "结果—复诊—随访"],
    ["结构化病历", workspace.emr.length, "保留更正版本"],
    ["用药核对", workspace.medications.flags.length, workspace.medications.reviewRequired ? "需医师/药师复核" : "暂无核对线索"],
    ["档案完整度", `${workspace.completeness.score}%`, `${workspace.completeness.reminders.length} 项提醒`],
    ["安全分享", activeShares, `${openCorrections} 项纠错处理中`]
  ];
  document.querySelector("#citizen-care-workspace-summary").innerHTML = summaryCards.map(([label, value, detail]) => `<article>
    <span>${escapeHtml(label)}</span>
    <strong>${escapeHtml(value)}</strong>
    <small>${escapeHtml(detail)}</small>
  </article>`).join("");
  document.querySelector("#citizen-current-subject").textContent = `当前查看：${resident.name}（${resident.id}）· 敏感操作会再次确认当前居民与授权范围`;

  document.querySelector("#citizen-care-task-cards").innerHTML = activeTasks.map((task) => `<div class="citizen-care-row ${escapeHtml(task.severity)}">
    <div><strong>${escapeHtml(task.title)}</strong><span>${task.severity === "critical" ? "危急结果" : "异常结果"}</span><em>${escapeHtml(task.status)}</em></div>
    <p>${escapeHtml(task.summary)}</p>
    <small>应于 ${escapeHtml(task.dueAt.slice(0, 10))} 前处理 · ${escapeHtml(task.clinicalBoundary)}${task.auditRef ? ` · 审计 ${escapeHtml(task.auditRef)}` : ""}</small>
    <footer>${task.actions.map((action) => `<span>${escapeHtml(action)}</span>`).join("")}
      ${["completed", "closed"].includes(task.status) ? "" : `<button type="button" class="small-button" data-care-task-complete="${escapeHtml(task.id)}">记录已联系/复诊</button>`}
    </footer>
  </div>`).join("") || citizenCareEmpty("当前没有需要居民处理的异常结果。");

  document.querySelector("#citizen-provenance-cards").innerHTML = workspace.records.slice(0, 6).map((record) => `<div class="citizen-care-row">
    <strong>${escapeHtml(record.name || "健康资料")}</strong>
    <p>${escapeHtml(record.provenance?.sourceOrganization || record.source || "来源待核验")} · ${escapeHtml(record.provenance?.sourceSystem || "系统待核验")}</p>
    <small>来源记录 ${escapeHtml(record.provenance?.sourceRecordId || "待补录")} · 版本 ${escapeHtml(record.provenance?.version || "1")} · ${escapeHtml(record.provenance?.trust || "待核验")}</small>
    ${["imaging", "attachments"].includes(record.category) ? `<span>原文仅可申请单次、最长 5 分钟凭据</span>` : ""}
  </div>`).join("") || citizenCareEmpty("暂无可核验的跨院来源记录。");

  const account = getCurrentAccount();
  const relationship = account?.members?.find((item) => item.residentId === resident.id) || {};
  const selfMember = /本人|self/i.test(relationship.relation || "") || account?.role === "本人" && account?.members?.[0]?.residentId === resident.id;
  const relationshipResult = selfMember
    ? { active: true, label: "本人访问", reason: "self" }
    : api.relationshipAccessState(relationship);
  document.querySelector("#citizen-relationship-status").innerHTML = `<div class="citizen-care-row ${relationshipResult.active ? "" : "denied"}">
    <div><strong>${escapeHtml(relationship.relation || "家庭成员关系")}</strong><span>${escapeHtml(relationshipResult.label)}</span></div>
    <p>${selfMember ? "本人读取自己的居民可读摘要；原文仍需受控调阅和审计。" : relationshipResult.active ? "关系核验有效；读取具体分类仍需匹配受权人和授权范围。" : "当前按最小权限拒绝家庭读取，需补齐权威关系证据或重新授权。"}</p>
    <small>核验时间：${escapeHtml(relationship.verifiedAt || "待补录")} · 证据：${escapeHtml(relationship.evidenceSource || relationship.evidenceId || "待补录")}</small>
  </div>`;

  document.querySelector("#citizen-emr-structured-cards").innerHTML = workspace.emr.slice(0, 5).map((item) => `<div class="citizen-care-row">
    <div><strong>${escapeHtml(item.visitAt || "日期待核验")} · ${escapeHtml(item.visitType)}</strong><span>${escapeHtml(item.department || "科室待核验")}</span><em>版本 ${escapeHtml(item.correctedVersion)}</em></div>
    <p>${item.diagnoses.length ? `诊断：${item.diagnoses.map(escapeHtml).join("、")}` : "诊断表述待机构回传"}；处置：${escapeHtml(item.treatment || "待回传")}</p>
    <small>${escapeHtml(item.institution)} · 复诊计划：${escapeHtml(item.followupPlan || "待回传")}</small>
  </div>`).join("") || citizenCareEmpty("暂无结构化电子病历。");

  const medicationFlags = {
    "duplicate-source": "存在重复来源",
    "self-reported-review": "居民自报待核验",
    "allergy-review": "过敏线索待核对"
  };
  document.querySelector("#citizen-medication-review").innerHTML = workspace.medications.items.map((item) => `<div class="citizen-care-row ${item.flags.length ? "warning" : ""}">
    <div><strong>${escapeHtml(item.name)}</strong>${item.flags.map((flag) => `<span>${escapeHtml(medicationFlags[flag] || flag)}</span>`).join("")}</div>
    <p>${escapeHtml(item.dosage || "剂量待核验")} · ${escapeHtml(item.status)}</p>
    <small>${escapeHtml(item.source || "来源待核验")} · ${escapeHtml(item.authority)}</small>
  </div>`).join("") + `<small>${escapeHtml(workspace.medications.clinicalBoundary)}</small>` || citizenCareEmpty("暂无用药记录。");

  const trends = api.buildMetricTrends([{
    id: `metrics-${resident.id}`,
    residentId: resident.id,
    date: new Date().toISOString(),
    metrics: resident.metrics || {},
    meta: { sourceTrust: "health-archive" }
  }]);
  document.querySelector("#citizen-disease-topics").innerHTML = workspace.diseaseTopics.map((topic) => `<div class="citizen-care-row">
    <div><strong>${escapeHtml(topic.title)}</strong><span>${escapeHtml(topic.status)}</span></div>
    <p>${topic.recordIds.length} 条关联资料 · ${topic.categories.map(escapeHtml).join("、") || "待关联"}</p>
    <small>最近记录：${escapeHtml(topic.latestAt || "待更新")}</small>
  </div>`).join("") + (trends.length ? `<div class="citizen-care-row"><strong>最新健康指标</strong><div>${trends.map((item) => `<span>${escapeHtml(item.key)} ${escapeHtml(item.latest)}</span>`).join("")}</div><small>居民自测与医疗机构数据在生产接口中须分开展示。</small></div>` : "") || citizenCareEmpty("暂无疾病专题或趋势数据。");

  document.querySelector("#citizen-completeness-v2").innerHTML = `<div class="citizen-care-row">
    <div><strong>${workspace.completeness.score}%</strong><span>${workspace.completeness.items.filter((item) => item.available).length}/${workspace.completeness.items.length} 类已归集</span></div>
    <p>${workspace.completeness.reminders.map(escapeHtml).join("；") || "核心档案已归集，继续按机构更新周期同步。"}</p>
  </div>${workspace.completeness.items.map((item) => `<div class="citizen-care-row ${item.available && !item.stale ? "" : "pending"}">
    <div><strong>${escapeHtml(item.label)}</strong><span>${item.available ? item.stale ? "需更新" : "已归集" : "待补齐"}</span></div>
    <small>${item.latestAt ? `最近更新 ${escapeHtml(item.latestAt.slice(0, 10))}` : "暂无可信更新时间"}</small>
  </div>`).join("")}`;

  const correctionSelect = document.querySelector("#citizen-correction-form select[name='recordId']");
  if (correctionSelect) correctionSelect.innerHTML = records.slice(0, 50).map((record) => `<option value="${escapeHtml(record.id)}">${escapeHtml(record.date || "日期待核验")} · ${escapeHtml(record.name)}</option>`).join("");
  document.querySelector("#citizen-correction-list").innerHTML = careState.recordCorrections.map((item) => `<div class="citizen-care-row ${item.status === "rejected" ? "denied" : "pending"}">
    <div><strong>${escapeHtml(item.field)}纠错</strong><span>${escapeHtml(item.status)}</span></div>
    <p>${escapeHtml(item.reason)}</p>
    <small>源记录 ${escapeHtml(item.recordId)} · 原始版本保留${item.receiptId ? ` · 受理 ${escapeHtml(item.receiptId)}` : ""}${item.auditRef ? ` · 审计 ${escapeHtml(item.auditRef)}` : ""}</small>
  </div>`).join("") || citizenCareEmpty("尚未提交档案纠错申请。");

  document.querySelector("#citizen-share-package-list").innerHTML = careState.recordSharePackages.map((item) => {
    const packageState = api.sharePackageState(item);
    return `<div class="citizen-care-row ${packageState.active ? "" : "pending"}">
      <div><strong>${escapeHtml(item.accessRef)}</strong><span>${escapeHtml(packageState.label)}</span></div>
      <p>${escapeHtml(item.purpose)} · ${item.scopes.map(escapeHtml).join("、")}</p>
      <small>接收方 ${escapeHtml(item.granteeId)} · 单次访问码 · 全程审计${item.receiptId ? ` · 受理 ${escapeHtml(item.receiptId)}` : ""}${item.auditRef ? ` · ${escapeHtml(item.auditRef)}` : ""}</small>
      ${packageState.active ? `<footer><button type="button" class="small-button" data-revoke-share-package="${escapeHtml(item.id)}">立即撤销</button></footer>` : ""}
    </div>`;
  }).join("") || citizenCareEmpty("尚未创建一次性健康资料包。");

  const authorizationLifecycle = api.buildAuthorizationLifecycle(records, new Date(), 30);
  document.querySelector("#citizen-authorization-lifecycle-summary").innerHTML = `<div class="citizen-care-row ${authorizationLifecycle.expiring || authorizationLifecycle.incomplete ? "warning" : ""}">
    <div><strong>${authorizationLifecycle.active} 条有效授权</strong><span>${authorizationLifecycle.expiring} 条 30 天内到期</span><em>${authorizationLifecycle.incomplete} 条历史资料待补录</em></div>
    <p>续授权会创建新的同意记录；原授权历史、撤权状态和审计记录保持不变。</p>
  </div>`;
  document.querySelector("#citizen-authorization-lifecycle-list").innerHTML = authorizationLifecycle.items.slice(0, 12).map((item) => `<div class="citizen-care-row ${["expiring", "incomplete"].includes(item.lifecycleKey) ? "warning" : item.lifecycleKey === "revoked" ? "pending" : ""}">
    <div><strong>${escapeHtml(item.granteeName || "授权对象待核验")}</strong><span>${escapeHtml(item.label)}</span>${item.remainingDays !== null && item.active ? `<em>剩余 ${escapeHtml(item.remainingDays)} 天</em>` : ""}</div>
    <p>${escapeHtml(item.purpose || "用途待补录")} · ${item.scopes.map(escapeHtml).join("、") || "范围待补录"}</p>
    <small>对象标识：${escapeHtml(item.granteeId || "待重新核验")}${item.expiresAt ? ` · 有效期 ${escapeHtml(item.expiresAt.slice(0, 10))}` : ""}</small>
    ${item.renewEligible ? `<footer><button type="button" class="small-button" data-renew-authorization="${escapeHtml(item.id)}">准备续授权</button></footer>` : ""}
  </div>`).join("") || citizenCareEmpty("暂无授权记录。");

  const authorizationReceipts = api.buildAuthorizationReceiptLedger(records, resident.id);
  document.querySelector("#citizen-authorization-receipt-summary").innerHTML = `<div class="citizen-care-row ${authorizationReceipts.incomplete ? "warning" : ""}">
    <div><strong>${authorizationReceipts.verified}/${authorizationReceipts.total} 条操作证据完整</strong><span>${authorizationReceipts.incomplete} 条待补回执</span><em>${authorizationReceipts.revoked} 条已撤销</em></div>
    <p>只有受理编号和审计关联号同时存在，居民端才将本次授权写操作标记为已核验。</p>
  </div>`;
  document.querySelector("#citizen-authorization-receipt-list").innerHTML = authorizationReceipts.items.slice(0, 12).map((item) => `<div class="citizen-care-row ${item.verified ? "" : "warning"}">
    <div><strong>${escapeHtml(item.granteeName || "授权对象待核验")}</strong><span>${item.verified ? "回执已核验" : "回执待补录"}</span><em>${escapeHtml(item.lifecycleLabel)}</em></div>
    <p>创建：${item.creation.verified ? `受理 ${escapeHtml(item.creation.receiptId)} · 审计 ${escapeHtml(item.creation.auditRef)}` : "缺少受理编号或审计关联号"}</p>
    ${item.revocation.required ? `<p>撤销：${item.revocation.verified ? `受理 ${escapeHtml(item.revocation.receiptId)} · 审计 ${escapeHtml(item.revocation.auditRef)}` : "缺少受理编号或审计关联号"}</p>` : ""}
    <small>${item.issues.length ? escapeHtml(item.issues.join("；")) : "授权操作证据链完整，可供居民复核。"}</small>
  </div>`).join("") || citizenCareEmpty("暂无可核验的授权操作回执。");

  const accessQueue = citizenAccessReviewQueue(resident.id);
  const acknowledged = new Set(careState.accessAcknowledgements.map((item) => item.accessLogId));
  const disputed = new Set(careState.accessDisputes.filter((item) => !["resolved", "rejected", "withdrawn"].includes(item.status)).map((item) => item.accessLogId));
  const reviewCount = accessQueue.filter((item) => item.reviewState === "review" && !acknowledged.has(item.eventId)).length;
  const blockedCount = accessQueue.filter((item) => item.reviewState === "blocked").length;
  document.querySelector("#citizen-access-review-v2-summary").innerHTML = `<div class="citizen-care-row ${reviewCount ? "warning" : ""}">
    <div><strong>${accessQueue.length} 条访问事件</strong><span>${reviewCount} 条待复核</span><em>${blockedCount} 条已拦截</em></div>
    <p>“已拦截”表示访问未获允许，不代表健康数据已经披露；无法确认的已允许访问可提交异议。</p>
  </div>`;
  document.querySelector("#citizen-access-review-v2-list").innerHTML = accessQueue.slice(0, 12).map((item) => {
    const acknowledgedItem = acknowledged.has(item.eventId);
    const disputedItem = disputed.has(item.eventId);
    const tone = item.reviewState === "review" ? "warning" : item.reviewState === "blocked" ? "denied" : "";
    return `<div class="citizen-care-row ${tone}">
      <div><strong>${escapeHtml(item.actor)}</strong><span>${escapeHtml(item.label)}</span>${acknowledgedItem ? "<em>居民已确认</em>" : ""}${disputedItem ? "<em>异议处理中</em>" : ""}</div>
      <p>${escapeHtml(item.at || "时间待核验")} · ${escapeHtml(item.scope || "范围待核验")} · ${escapeHtml(item.purpose || "用途待补录")}</p>
      <small>${escapeHtml(item.result)}${item.recommendedAction ? ` · ${escapeHtml(item.recommendedAction)}` : ""}</small>
      <footer>
        ${!acknowledgedItem && item.reviewState !== "blocked" ? `<button type="button" class="small-button" data-acknowledge-access="${escapeHtml(item.eventId)}">这是正常访问</button>` : ""}
        <button type="button" class="small-button" data-fill-access-dispute="${escapeHtml(item.eventId)}">对此访问有异议</button>
      </footer>
    </div>`;
  }).join("") || citizenCareEmpty("暂无访问事件；可先点击电子病历页的“复核授权与访问”。");
  const disputeSelect = document.querySelector("#citizen-access-dispute-form select[name='accessLogId']");
  if (disputeSelect) disputeSelect.innerHTML = accessQueue.map((item) => `<option value="${escapeHtml(item.eventId)}">${escapeHtml(item.at || "时间待核验")} · ${escapeHtml(item.actor)} · ${escapeHtml(item.scope)}</option>`).join("");
  document.querySelector("#citizen-access-dispute-list").innerHTML = careState.accessDisputes.map((item) => `<div class="citizen-care-row pending">
    <div><strong>访问异议</strong><span>${escapeHtml(item.status)}</span></div>
    <p>${escapeHtml(item.reason)}</p>
    <small>访问事件 ${escapeHtml(item.accessLogId)}${item.receiptId ? ` · 受理 ${escapeHtml(item.receiptId)}` : ""}${item.auditRef ? ` · 审计 ${escapeHtml(item.auditRef)}` : ""}</small>
  </div>`).join("") || citizenCareEmpty("尚未提交访问异议。");

  const shareExpiry = document.querySelector("#citizen-share-package-form input[name='expiresAt']");
  if (shareExpiry && !shareExpiry.value) {
    const tomorrow = new Date(Date.now() + 24 * 3600000);
    shareExpiry.value = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}T${String(tomorrow.getHours()).padStart(2, "0")}:${String(tomorrow.getMinutes()).padStart(2, "0")}`;
  }
  renderCitizenRecordsNextStage(resident, diseases, records, careState);
  renderCitizenCareSyncStatus(resident.id);
  applyCitizenRecordAccessibility();
  scheduleCitizenCareWorkspaceSync(resident.id);
}

function renderCitizenRecordsNextStage(resident, diseases = [], records = [], careState = {}) {
  const api = window.CitizenRecordsV3;
  if (!api || !resident) return;
  const account = getCurrentAccount() || {};
  const members = (account.members || []).map((member) => ({
    ...member,
    name: state.residents?.find((item) => item.id === member.residentId)?.name || member.name || member.relation
  }));
  const authorizations = records.filter((record) => record.category === "authorizations");
  const emergencyConsent = authorizations.find((record) => (
    /急救|紧急/i.test(`${record.name || ""}${record.meta?.purpose || ""}`)
    && record.meta?.scopes?.includes("health-record-summary")
  ));
  const workspace = api.buildNextStageWorkspace({
    resident: {
      ...resident,
      age: ageOf(resident.birthDate)
    },
    records,
    diseases,
    members,
    authorizations,
    followups: (state.followups || []).filter((item) => item.residentId === resident.id),
    pickups: (state.medicationPickups || []).filter((item) => item.residentId === resident.id),
    contacts: (state.emergencyContacts || resident.emergencyContacts || []).filter((item) => !item.residentId || item.residentId === resident.id),
    emergencyConsent,
    integrations: globalThis.__CITIZEN_PRODUCTION_EVIDENCE__ || {},
    accessLogs: citizenAccessReviewQueue(resident.id),
    corrections: careState.recordCorrections || [],
    complaints: (state.citizenComplaints || state.serviceComplaints || []).filter((item) => !item.residentId || item.residentId === resident.id),
    now: new Date()
  });

  const integrationTarget = document.querySelector("#citizen-integration-v3");
  if (integrationTarget) integrationTarget.innerHTML = `<div class="citizen-care-row ${workspace.integration.productionReady ? "" : "warning"}">
    <div><strong>${workspace.integration.readyCount}/${workspace.integration.items.length} 类已核验</strong><span>${escapeHtml(workspace.integration.summary)}</span></div>
    <p>${workspace.integration.items.map((item) => `${escapeHtml(item.label)}：${escapeHtml(item.status)}`).join("；")}</p>
    <small>${escapeHtml(workspace.integration.boundary)}</small>
    <footer><button type="button" class="small-button" data-v3-action="review-integration-boundary">查看接入边界</button></footer>
  </div>`;

  const governanceTarget = document.querySelector("#citizen-governance-v3");
  if (governanceTarget) governanceTarget.innerHTML = `<div class="citizen-care-row ${workspace.governance.conflicts.length ? "warning" : ""}">
    <div><strong>${workspace.governance.sourceCount} 个可信来源</strong><span>${workspace.governance.duplicates.length} 组重复</span><em>${workspace.governance.conflicts.length} 组冲突</em></div>
    <p>${workspace.governance.conflicts.slice(0, 3).map((item) => `${escapeHtml(item.label)}：${escapeHtml(item.action)}`).join("；") || "当前没有需要居民处理的跨院冲突。"}</p>
    <small>${escapeHtml(workspace.governance.boundary)}</small>
    <footer><button type="button" class="small-button" data-v3-action="${workspace.governance.conflicts.length ? "correct-conflict" : "review-provenance"}">${workspace.governance.conflicts.length ? "发起纠错复核" : "查看来源明细"}</button></footer>
  </div>`;

  const familyTarget = document.querySelector("#citizen-family-v3");
  if (familyTarget) familyTarget.innerHTML = workspace.family.items.slice(0, 6).map((item) => `<div class="citizen-care-row ${item.canAct ? "" : "denied"}">
    <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.relation)}</span><em>${item.canAct ? "可按范围访问" : "暂不可代办"}</em></div>
    <p>${escapeHtml(item.action)}${item.scopes.length ? ` · ${item.scopes.map(escapeHtml).join("、")}` : ""}</p>
  </div>`).join("") + `<small>${escapeHtml(workspace.family.boundary)}</small><footer><button type="button" class="small-button" data-v3-action="manage-family-authorization">管理家庭授权</button></footer>`;

  const carePlanTarget = document.querySelector("#citizen-care-plan-v3");
  if (carePlanTarget) carePlanTarget.innerHTML = workspace.carePlan.tasks.slice(0, 6).map((item) => {
    const intent = api.buildCareTaskActionIntent(item);
    return `<div class="citizen-care-row ${["逾期", "紧急"].includes(item.priority) ? "warning" : ""}">
      <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.type)}</span><em>${escapeHtml(item.priority)}</em></div>
      <p>${escapeHtml(item.action)}${item.dueAt ? ` · ${escapeHtml(item.dueAt)}` : ""}</p>
      <footer><button type="button" class="small-button" data-v3-care-task="${escapeHtml(intent.taskId)}" data-v3-care-task-type="${escapeHtml(intent.type)}">${escapeHtml(intent.buttonLabel)}</button></footer>
    </div>`;
  }).join("") + `<small>${escapeHtml(workspace.carePlan.boundary)}</small>` || citizenCareEmpty("当前没有需要处理的主动健康任务。");

  const explanationTarget = document.querySelector("#citizen-report-explain-v3");
  if (explanationTarget) explanationTarget.innerHTML = workspace.explanations.reports.slice(0, 4).map((item) => `<div class="citizen-care-row ${["critical", "abnormal"].includes(item.severity) ? "warning" : ""}">
    <div><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.level)}</span></div>
    <p>${escapeHtml(item.plainSummary)}</p>
    <small>${escapeHtml(item.explanations.join("；") || "暂无需要解释的医学术语")} · ${escapeHtml(item.nextStep)}</small>
  </div>`).join("") + `<small>${escapeHtml(workspace.explanations.boundary)}</small><footer><button type="button" class="small-button" data-v3-action="schedule-report-revisit">预约报告复诊</button></footer>` || citizenCareEmpty("暂无可解读的检查或影像报告。");

  const medicationTarget = document.querySelector("#citizen-medication-safety-v3");
  if (medicationTarget) {
    const warnings = [
      ...workspace.medicationSafety.duplicateGroups.map((item) => `${item.label}存在 ${item.count} 条来源记录`),
      ...workspace.medicationSafety.allergyWarnings.map((item) => `${item.medication}与过敏信息存在文字匹配`),
      ...workspace.medicationSafety.interactionWarnings.map((item) => item.warning)
    ];
    medicationTarget.innerHTML = `<div class="citizen-care-row ${warnings.length ? "warning" : ""}">
      <div><strong>${workspace.medicationSafety.medications.length} 种用药</strong><span>${workspace.medicationSafety.warningCount} 项需复核</span></div>
      <p>${warnings.map(escapeHtml).join("；") || "当前未识别到重复、过敏文字匹配或已配置的严重相互作用。"}</p>
      <small>${escapeHtml(workspace.medicationSafety.boundary)}</small>
      <footer><button type="button" class="small-button" data-v3-action="review-medications">查看用药核对</button></footer>
    </div>`;
  }

  const emergencyTarget = document.querySelector("#citizen-emergency-pack-v3");
  if (emergencyTarget) emergencyTarget.innerHTML = `<div class="citizen-care-row ${workspace.emergencyPack.ready ? "" : "warning"}">
    <div><strong>${escapeHtml(workspace.emergencyPack.status)}</strong><span>过敏 ${workspace.emergencyPack.allergies.length} 项</span><em>用药 ${workspace.emergencyPack.medications.length} 项</em></div>
    <p>慢病：${workspace.emergencyPack.diseases.map(escapeHtml).join("、") || "待补齐"}；联系人：${workspace.emergencyPack.contacts.map((item) => `${escapeHtml(item.relation)} ${escapeHtml(item.name)} ${escapeHtml(item.phone)}`).join("、") || "待补齐"}</p>
    <small>${escapeHtml(workspace.emergencyPack.boundary)}</small>
    <footer><button type="button" class="small-button" data-v3-action="prepare-emergency-authorization">准备紧急授权</button></footer>
  </div>`;

  const operationsTarget = document.querySelector("#citizen-operations-v3");
  if (operationsTarget) operationsTarget.innerHTML = `<div class="citizen-care-row ${workspace.operations.productionReady ? "" : "warning"}">
    <div>${workspace.operations.metrics.map((item) => `<span><strong>${escapeHtml(item.label)}</strong> ${escapeHtml(item.value)} · ${escapeHtml(item.status)}</span>`).join("")}</div>
    <p>${workspace.operations.latestEventAt ? `最近居民范围事件：${escapeHtml(workspace.operations.latestEventAt.slice(0, 19).replace("T", " "))}` : "暂无可展示的居民范围运营事件。"}</p>
    <small>${escapeHtml(workspace.operations.boundary)}</small>
    <footer><button type="button" class="small-button" data-v3-action="review-operations">复核访问记录</button></footer>
  </div>`;
}

function focusCitizenRecordsV3Target(selector) {
  const target = document.querySelector(selector);
  if (!target) throw new Error("未找到对应的居民服务入口");
  document.querySelectorAll(".v3-action-target").forEach((item) => item.classList.remove("v3-action-target"));
  target.classList.add("v3-action-target");
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  const control = target.matches("input, select, textarea, button")
    ? target
    : target.querySelector("input:not([type='hidden']), select, textarea, button");
  control?.focus({ preventScroll: true });
  window.setTimeout(() => target.classList.remove("v3-action-target"), 2400);
}

function openCitizenRecordsV3Authorization(intent) {
  const form = document.querySelector("#auth-form");
  const dialog = document.querySelector(`#${intent.dialogId}`);
  if (!form || !dialog || !intent.authorizationDraft) throw new Error("授权服务暂不可用");
  form.reset();
  document.querySelector("#auth-dialog-title").textContent = intent.action === "prepare-emergency-authorization" ? "紧急救治授权" : "家庭代办授权";
  form.elements.previousAuthorizationId.value = "";
  form.elements.granteeName.value = "";
  form.elements.granteeId.value = "";
  form.elements.granteeType.value = intent.authorizationDraft.granteeType;
  form.elements.purpose.value = intent.authorizationDraft.purpose;
  form.elements.expiresAt.min = todayOffset(1);
  form.elements.expiresAt.value = "";
  form.elements.source.value = "居民主动授权";
  form.querySelectorAll("input[name='scopes']").forEach((input) => {
    input.checked = intent.authorizationDraft.scopes.includes(input.value);
  });
  form.elements.consentConfirmed.checked = false;
  renderAuthorizationScopePreview(form);
  dialog.showModal();
  form.elements.granteeName.focus();
}

function handleCitizenRecordsV3Action(action) {
  const intent = window.CitizenRecordsV3?.buildSafeActionIntent(action);
  if (!intent || intent.writes) throw new Error("该居民操作未通过安全校验");
  if (intent.authorizationDraft) openCitizenRecordsV3Authorization(intent);
  else if (intent.targetSelector) focusCitizenRecordsV3Target(intent.targetSelector);
  else if (intent.page) window.location.href = citizenPageHref(intent.page);
  showToast(intent.announcement);
}

function handleCitizenRecordsV3CareTaskAction(taskId, taskType) {
  const intent = window.CitizenRecordsV3?.buildCareTaskActionIntent({ id: taskId, type: taskType });
  if (!intent || intent.writes) throw new Error("该健康任务未通过安全校验");
  if (intent.authorizationId) openAuthorizationRenewal(intent.authorizationId);
  else if (intent.targetSelector) focusCitizenRecordsV3Target(intent.targetSelector);
  else if (intent.page) window.location.href = citizenPageHref(intent.page);
  showToast(intent.announcement);
}

function citizenCareRequestNonce() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function submitCitizenCareAction(path, payload, operation) {
  const action = window.CitizenRecordsV2.buildIdempotentAction({
    operation,
    residentId: currentResidentId,
    nonce: citizenCareRequestNonce(),
    payload
  });
  if (!API_BASE) {
    return {
      ...payload,
      receiptId: `local-${action.idempotencyKey.slice(-32)}`,
      auditRef: `preview-audit-${Date.now()}`,
      syncStatus: "local-preview",
      idempotencyKey: action.idempotencyKey,
      requestedAt: action.requestedAt
    };
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  const response = await request(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": action.idempotencyKey
    },
    body: JSON.stringify(action)
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.message || "平台未接受本次操作");
  return { ...result, idempotencyKey: action.idempotencyKey, requestedAt: action.requestedAt };
}

function currentRecordAccessibility() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(CITIZEN_RECORDS_ACCESSIBILITY_KEY) || "{}");
  } catch {
    localStorage.removeItem(CITIZEN_RECORDS_ACCESSIBILITY_KEY);
  }
  return window.CitizenRecordsV2?.normalizeAccessibilityPreferences(saved) || saved;
}

function applyCitizenRecordAccessibility() {
  const preferences = currentRecordAccessibility();
  document.body.classList.toggle("record-simple-mode", Boolean(preferences.simpleMode));
  document.body.classList.toggle("record-high-contrast", Boolean(preferences.highContrast));
  document.documentElement.style.setProperty("--citizen-record-text-scale", String(preferences.textScale || 1));
  document.querySelectorAll("[data-record-accessibility='simple']").forEach((button) => button.setAttribute("aria-pressed", String(Boolean(preferences.simpleMode))));
  document.querySelectorAll("[data-record-accessibility='contrast']").forEach((button) => button.setAttribute("aria-pressed", String(Boolean(preferences.highContrast))));
  const scaleOutput = document.querySelector("#citizen-record-text-scale");
  if (scaleOutput) scaleOutput.value = `${Math.round((preferences.textScale || 1) * 100)}%`;
}

function renderAuthorizationScopePreview(form = document.querySelector("#auth-form")) {
  const target = document.querySelector("#auth-scope-preview");
  if (!target || !form || !window.CitizenRecordsV2?.buildAuthorizationScopeDisclosure) return;
  const scopes = [...form.querySelectorAll("input[name='scopes']:checked")].map((input) => input.value);
  try {
    const disclosure = window.CitizenRecordsV2.buildAuthorizationScopeDisclosure(scopes);
    target.innerHTML = `<strong>${escapeHtml(disclosure.summary)}</strong>
      ${disclosure.items.length ? `<div class="authorization-scope-preview-list">${disclosure.items.map((item) => `<article>
        <b>${escapeHtml(item.label)}</b>
        <p><span>允许</span>${escapeHtml(item.allows)}</p>
        <small><span>不包含</span>${escapeHtml(item.excludes)}</small>
      </article>`).join("")}</div>` : "<p>勾选范围后，这里会说明允许查看的内容和明确排除项。</p>"}
      <em>${escapeHtml(disclosure.boundary)}</em>`;
  } catch (error) {
    target.innerHTML = `<strong>授权范围待核验</strong><p>${escapeHtml(error.message || "存在不受支持的授权范围")}</p>`;
  }
}

function openAuthorizationRenewal(recordId) {
  const record = getPersonalRecords(currentResidentId, "authorizations").find((item) => item.id === recordId);
  if (!record) {
    showToast("未找到可续签的授权记录");
    return;
  }
  try {
    const draft = window.CitizenRecordsV2.buildAuthorizationRenewalDraft(record);
    const form = document.querySelector("#auth-form");
    form.reset();
    document.querySelector("#auth-dialog-title").textContent = "续授权";
    form.elements.previousAuthorizationId.value = draft.previousAuthorizationId;
    form.elements.granteeName.value = draft.granteeName;
    form.elements.granteeId.value = draft.granteeId;
    form.elements.granteeType.value = draft.granteeType;
    form.elements.purpose.value = draft.purpose;
    form.elements.expiresAt.min = todayOffset(1);
    form.elements.expiresAt.value = "";
    form.elements.source.value = draft.source;
    form.querySelectorAll("input[name='scopes']").forEach((input) => {
      input.checked = draft.scopes.includes(input.value);
    });
    form.elements.consentConfirmed.checked = false;
    renderAuthorizationScopePreview(form);
    document.querySelector("#auth-dialog").showModal();
  } catch (error) {
    showToast(error.message || "该授权暂不能续签");
  }
}

function bindCitizenCareWorkspace() {
  const api = window.CitizenRecordsV2;
  const section = document.querySelector("#citizen-care-workspace");
  if (!api || !section) return;
  applyCitizenRecordAccessibility();
  document.querySelectorAll("[data-record-accessibility]").forEach((button) => button.addEventListener("click", () => {
    const action = button.dataset.recordAccessibility;
    const preferences = currentRecordAccessibility();
    if (action === "simple") preferences.simpleMode = !preferences.simpleMode;
    if (action === "contrast") preferences.highContrast = !preferences.highContrast;
    if (action === "text-down") preferences.textScale = Math.max(1, (preferences.textScale || 1) - 0.1);
    if (action === "text-up") preferences.textScale = Math.min(1.5, (preferences.textScale || 1) + 0.1);
    if (action === "read") {
      const text = cleanTextForSpeech(section.innerText, 1000);
      if ("speechSynthesis" in window && text) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
        showToast("正在朗读照护中心摘要");
      } else {
        showToast("当前浏览器不支持语音朗读");
      }
      return;
    }
    localStorage.setItem(CITIZEN_RECORDS_ACCESSIBILITY_KEY, JSON.stringify(api.normalizeAccessibilityPreferences(preferences)));
    applyCitizenRecordAccessibility();
  }));

  document.querySelector("#citizen-correction-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const request = api.buildCorrectionRequest({
        recordId: form.elements.recordId.value,
        residentId: currentResidentId,
        field: form.elements.field.value,
        requestedValue: form.elements.requestedValue.value,
        reason: form.elements.reason.value
      });
      const response = await submitCitizenCareAction("/record-corrections", request, "correction-submit");
      const saved = api.projectCorrectionReceipt(response, request);
      const careState = ensureCitizenCareCollections(currentResidentId);
      careState.recordCorrections.unshift(saved);
      saveCitizenCareCollections(currentResidentId);
      markCitizenCareActionSynced(currentResidentId, saved);
      form.reset();
      renderCitizen(currentResidentId);
      showToast("纠错申请已提交，原始记录保持不变");
    } catch (error) {
      showToast(error.message || "纠错申请提交失败");
    }
  });

  document.querySelector("#citizen-share-package-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const scopes = [...form.querySelectorAll("input[name='scopes']:checked")].map((item) => item.value);
      const packageRecord = api.buildSharePackage({
        residentId: currentResidentId,
        granteeId: form.elements.granteeId.value,
        purpose: form.elements.purpose.value,
        scopes,
        expiresAt: form.elements.expiresAt.value
      });
      const response = await submitCitizenCareAction("/record-share-packages", packageRecord, "share-create");
      const saved = api.projectSharePackageReceipt(response, packageRecord);
      const careState = ensureCitizenCareCollections(currentResidentId);
      careState.recordSharePackages.unshift(saved);
      saveCitizenCareCollections(currentResidentId);
      markCitizenCareActionSynced(currentResidentId, saved);
      form.reset();
      renderCitizen(currentResidentId);
      showToast("一次性健康资料包已创建");
    } catch (error) {
      showToast(error.message || "资料包创建失败");
    }
  });

  document.querySelector("#citizen-access-dispute-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const dispute = api.buildAccessDispute({
        residentId: currentResidentId,
        accessLogId: form.elements.accessLogId.value,
        category: form.elements.category.value,
        reason: form.elements.reason.value,
        contactPreference: form.elements.contactPreference.value
      });
      const response = await submitCitizenCareAction(
        `/access-reviews/${encodeURIComponent(dispute.accessLogId)}/disputes`,
        dispute,
        "access-dispute"
      );
      const saved = api.projectAccessReviewActionReceipt(response, dispute);
      const careState = ensureCitizenCareCollections(currentResidentId);
      careState.accessDisputes.unshift(saved);
      saveCitizenCareCollections(currentResidentId);
      markCitizenCareActionSynced(currentResidentId, saved);
      form.reset();
      renderCitizen(currentResidentId);
      showToast("访问异议已提交，平台将按审计回执复核");
    } catch (error) {
      showToast(error.message || "访问异议提交失败");
    }
  });

  document.querySelector("[data-export-access-review]")?.addEventListener("click", () => {
    exportCitizenAccessReview(currentResidentId);
  });

  document.querySelector("[data-export-authorization-receipts]")?.addEventListener("click", () => {
    exportCitizenAuthorizationReceipts(currentResidentId);
  });

  document.querySelector("[data-refresh-care-workspace]")?.addEventListener("click", () => {
    void refreshCitizenCareWorkspace(currentResidentId);
  });

  document.querySelector("[data-clear-care-workspace]")?.addEventListener("click", () => {
    const label = API_BASE ? "本次会话中的工作台缓存" : "本机保存的纠错、资料包和异常处置演示数据";
    if (!window.confirm(`确认清理${label}？居民主动补充的其他健康资料不会被删除。`)) return;
    if (API_BASE) {
      citizenCareSession.delete(currentResidentId);
      citizenCareSyncStatus.set(currentResidentId, { key: "cleared", label: "本次会话缓存已清理" });
      citizenCareSyncRequested.add(currentResidentId);
    } else {
      clearCitizenCareLocalPreview(currentResidentId);
    }
    renderCitizen(currentResidentId);
    showToast(`${label}已清理`);
  });

  section.addEventListener("click", async (event) => {
    const nextStageActionButton = event.target.closest("[data-v3-action]");
    const carePlanTaskButton = event.target.closest("[data-v3-care-task]");
    const revokeButton = event.target.closest("[data-revoke-share-package]");
    const taskButton = event.target.closest("[data-care-task-complete]");
    const acknowledgeButton = event.target.closest("[data-acknowledge-access]");
    const fillDisputeButton = event.target.closest("[data-fill-access-dispute]");
    const renewAuthorizationButton = event.target.closest("[data-renew-authorization]");
    if (carePlanTaskButton) {
      try {
        handleCitizenRecordsV3CareTaskAction(carePlanTaskButton.dataset.v3CareTask, carePlanTaskButton.dataset.v3CareTaskType);
      } catch (error) {
        showToast(error.message || "主动健康任务入口暂不可用");
      }
      return;
    }
    if (nextStageActionButton) {
      try {
        handleCitizenRecordsV3Action(nextStageActionButton.dataset.v3Action);
      } catch (error) {
        showToast(error.message || "居民服务入口暂不可用");
      }
      return;
    }
    if (renewAuthorizationButton) {
      openAuthorizationRenewal(renewAuthorizationButton.dataset.renewAuthorization);
      return;
    }
    if (fillDisputeButton) {
      const form = document.querySelector("#citizen-access-dispute-form");
      form.elements.accessLogId.value = fillDisputeButton.dataset.fillAccessDispute;
      form.elements.reason.focus();
      form.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (acknowledgeButton) {
      try {
        const acknowledgement = api.buildAccessAcknowledgement({
          residentId: currentResidentId,
          accessLogId: acknowledgeButton.dataset.acknowledgeAccess
        });
        const response = await submitCitizenCareAction(
          `/access-reviews/${encodeURIComponent(acknowledgement.accessLogId)}/acknowledge`,
          acknowledgement,
          "access-acknowledge"
        );
        const saved = api.projectAccessReviewActionReceipt(response, acknowledgement);
        const careState = ensureCitizenCareCollections(currentResidentId);
        careState.accessAcknowledgements.unshift(saved);
        saveCitizenCareCollections(currentResidentId);
        markCitizenCareActionSynced(currentResidentId, saved);
        renderCitizen(currentResidentId);
        showToast("已记录为居民确认的正常访问");
      } catch (error) {
        showToast(error.message || "访问确认失败");
      }
      return;
    }
    if (revokeButton) {
      const careState = ensureCitizenCareCollections(currentResidentId);
      const item = careState.recordSharePackages.find((candidate) => candidate.id === revokeButton.dataset.revokeSharePackage);
      if (!item || !window.confirm(`确认撤销一次性资料包“${item.accessRef}”？`)) return;
      try {
        const revoked = api.revokeSharePackage(item);
        const response = await submitCitizenCareAction(`/record-share-packages/${encodeURIComponent(item.id)}/revoke`, {
          residentId: currentResidentId,
          resourceId: item.id,
          revokedAt: revoked.revokedAt
        }, "share-revoke");
        const receipt = api.projectActionReceipt(response, { residentId: currentResidentId, resourceId: item.id });
        Object.assign(item, revoked, receipt);
        saveCitizenCareCollections(currentResidentId);
        markCitizenCareActionSynced(currentResidentId, receipt);
        renderCitizen(currentResidentId);
        showToast("一次性资料包已撤销");
      } catch (error) {
        showToast(error.message || "资料包撤销失败");
      }
    }
    if (taskButton) {
      const careState = ensureCitizenCareCollections(currentResidentId);
      const update = { status: "completed", completedAt: new Date().toISOString() };
      try {
        const response = await submitCitizenCareAction(`/care-tasks/${encodeURIComponent(taskButton.dataset.careTaskComplete)}/actions`, {
          ...update,
          residentId: currentResidentId,
          resourceId: taskButton.dataset.careTaskComplete
        }, "care-task-complete");
        const receipt = api.projectActionReceipt(response, {
          residentId: currentResidentId,
          resourceId: taskButton.dataset.careTaskComplete
        });
        careState.careTaskUpdates[taskButton.dataset.careTaskComplete] = { ...update, ...receipt };
        saveCitizenCareCollections(currentResidentId);
        markCitizenCareActionSynced(currentResidentId, receipt);
        renderCitizen(currentResidentId);
        showToast("异常结果处置进度已记录");
      } catch (error) {
        showToast(error.message || "处置进度保存失败");
      }
    }
  });
}

function cleanTextForSpeech(value, maximum = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function collectVaultData(resident, diseases, followups, records) {
  const physicalExams = getPersonalRecords(resident.id, "physical-exam");
  const labs = getPersonalRecords(resident.id, "labs");
  const medications = getPersonalRecords(resident.id, "medications");
  const allergies = getPersonalRecords(resident.id, "allergies");
  const vaccines = getPersonalRecords(resident.id, "vaccines");
  const admissions = getPersonalRecords(resident.id, "admissions");
  const imaging = getPersonalRecords(resident.id, "imaging");
  const attachments = getPersonalRecords(resident.id, "attachments");
  const authorizations = getPersonalRecords(resident.id, "authorizations");
  const archive = [
    { date: todayOffset(0), name: "基础档案", result: `${resident.gender}，${ageOf(resident.birthDate)} 岁，${resident.address}`, source: resident.organization, categoryLabel: "健康档案" },
    { date: todayOffset(0), name: "健康指标", result: `血压 ${resident.metrics.systolic}/${resident.metrics.diastolic}，血糖 ${resident.metrics.glucose}，BMI ${resident.metrics.bmi}`, source: "居民健康档案", categoryLabel: "健康档案" },
    ...diseases.map((item) => ({ date: item.diagnosedAt, name: item.type, result: item.status, source: item.source, categoryLabel: "慢病登记" })),
    ...followups.map((item) => ({ date: item.plannedAt, name: `${item.diseaseType}随访`, result: `${item.status} · ${item.advice || item.result}`, source: item.assignee, categoryLabel: "随访管理" }))
  ];
  return {
    timeline: buildHealthTimeline(archive, records, physicalExams, labs, medications, allergies, vaccines, admissions, imaging, attachments),
    standard: buildStandardArchiveItems(resident.id),
    archive,
    emr: records.map((item) => ({ ...item, categoryLabel: "电子病历", related: relatedArchiveSummary(diseases, followups) })),
    "physical-exam": physicalExams,
    labs,
    medications,
    allergies,
    vaccines,
    admissions,
    imaging,
    attachments,
    authorizations
  };
}

function buildStandardArchiveItems(residentId) {
  const coverage = getStandardCoverage(residentId);
  return coverage.datasets.filter((item) => item.status === "已归集");
}

function renderStandardArchive(residentId) {
  const coverage = getStandardCoverage(residentId);
  const standard = coverage.standard;
  const groups = standard.contentGroups.map((group) => {
    const datasets = coverage.datasets.filter((item) => item.group === group.key);
    const done = datasets.filter((item) => item.status === "已归集").length;
    const applicable = datasets.filter((item) => item.applicable).length;
    return { ...group, done, applicable, datasets };
  });
  return `<div class="standard-archive">
    <section class="standard-hero">
      <div>
        <span>${standard.version}</span>
        <h3>${coverage.lifeStage} · ${coverage.risk}</h3>
        <p>以居民个人为中心，将健康档案、电子病历、慢病随访、检查检验、用药处方和固定取药统一索引到 ${coverage.resident.personIndex || "personIndex 待生成"}。</p>
      </div>
      <div class="standard-score">
        <strong>${coverage.score}%</strong>
        <span>适用数据集归集度</span>
        <small>${coverage.applicableCompleted}/${coverage.applicableTotal} 项适用数据集已归集</small>
      </div>
    </section>
    <section class="dimension-grid">
      ${standard.dimensions.map((item) => `<article>
        <strong>${item.title}</strong>
        <span>${item.key === "lifeStage" ? coverage.lifeStage : item.key === "healthProblem" ? coverage.problems.join("、") : coverage.activities.map((activity) => activity.title).join("、")}</span>
        <p>${item.detail}</p>
      </article>`).join("")}
    </section>
    <section class="activity-grid">
      ${coverage.activities.map((item) => `<article>
        <strong>${item.title}</strong>
        <span>${item.detail}</span>
      </article>`).join("")}
    </section>
    <section class="standard-groups">
      ${groups.map((group) => `<article>
        <div class="standard-group-head">
          <div>
            <strong>${group.title}</strong>
            <p>${group.detail}</p>
          </div>
          <span>${group.done}/${group.applicable || group.datasets.length}</span>
        </div>
        <div class="dataset-list">
          ${group.datasets.map((dataset) => renderDataset(dataset)).join("")}
        </div>
      </article>`).join("")}
    </section>
  </div>`;
}

function renderDataset(dataset) {
  const statusClass = dataset.status === "已归集" ? "ready" : dataset.status === "待补齐" ? "missing" : "idle";
  const evidence = dataset.evidence.length ? dataset.evidence.slice(0, 2).join("；") : dataset.status === "当前不适用" ? "按当前年龄、性别或疾病情况暂不适用。" : "后续由医疗机构、公共卫生服务或个人上传补齐。";
  return `<div class="dataset-row ${statusClass}">
    <span>${dataset.code}</span>
    <strong>${dataset.name}</strong>
    <em>${dataset.status}</em>
    <small>${evidence}</small>
  </div>`;
}

function getStandardCoverage(residentId) {
  if (window.HealthArchiveStandard) {
    return window.HealthArchiveStandard.getResidentCoverage(state, residentId);
  }
  return { standard: { dimensions: [], contentGroups: [], datasets: [] }, datasets: [], score: 0, applicableCompleted: 0, applicableTotal: 0, activities: [], problems: [] };
}

function buildHealthTimeline(archive, records, physicalExams, labs, medications, allergies, vaccines, admissions, imaging = [], attachments = []) {
  return [
    ...archive,
    ...records.map((item) => ({ ...item, categoryLabel: "电子病历" })),
    ...physicalExams.map((item) => ({ ...item, categoryLabel: "体检报告" })),
    ...labs.map((item) => ({ ...item, categoryLabel: "检查检验" })),
    ...medications.map((item) => ({ ...item, categoryLabel: "用药处方" })),
    ...allergies.map((item) => ({ ...item, categoryLabel: "过敏史" })),
    ...vaccines.map((item) => ({ ...item, categoryLabel: "免疫接种" })),
    ...admissions.map((item) => ({ ...item, categoryLabel: "手术住院" })),
    ...imaging.map((item) => ({ ...item, categoryLabel: "影像资料" })),
    ...attachments.map((item) => ({ ...item, categoryLabel: "附件资料" }))
  ].sort(sortByDateDesc);
}

function relatedArchiveSummary(diseases, followups) {
  const diseaseText = diseases.map((item) => item.type).join("、") || "暂无慢病登记";
  const pending = followups.filter((item) => item.status !== "已完成").length;
  return `${diseaseText} · ${pending} 项待随访`;
}

function renderSummary(resident, diseases, followups, records) {
  const pending = followups.filter((item) => item.status !== "已完成").length;
  const cards = [
    ["血压", `${resident.metrics.systolic}/${resident.metrics.diastolic}`, "mmHg"],
    ["空腹血糖", resident.metrics.glucose, "mmol/L"],
    ["BMI", resident.metrics.bmi, "kg/m²"],
    ["电子病历", records.length, "条诊疗记录"],
    ["慢病登记", diseases.length, diseases.map((item) => item.type).join("、") || "暂无"],
    ["待随访", pending, "项待处理"],
    ["家庭医生", resident.familyDoctor, resident.organization],
    ["档案地址", resident.address, resident.phone]
  ];
  document.querySelector("#summary-grid").innerHTML = cards
    .map(([label, value, hint]) => `<article class="summary-card"><span>${label}</span><strong>${value}</strong><small>${hint}</small></article>`)
    .join("");
}

function renderHealthTrends(resident) {
  const target = document.querySelector("#citizen-trend-grid");
  if (!target) return;
  const series = buildCitizenTrendSeries(resident);
  document.querySelector("#trend-source-summary").textContent = `${resident.name} · ${series.length} 项核心指标 · 来源：居民健康档案/随访记录`;
  target.innerHTML = series.map(renderCitizenTrend).join("");
}

function buildCitizenTrendSeries(resident) {
  const metrics = resident.metrics || {};
  return [
    { key: "systolic", label: "收缩压", unit: "mmHg", target: "目标 <140", values: trendValues(Number(metrics.systolic || 0), [10, 7, 3, 0]), riskAt: 140 },
    { key: "diastolic", label: "舒张压", unit: "mmHg", target: "目标 <90", values: trendValues(Number(metrics.diastolic || 0), [5, 3, 1, 0]), riskAt: 90 },
    { key: "glucose", label: "空腹血糖", unit: "mmol/L", target: "目标 <7.0", values: trendValues(Number(metrics.glucose || 0), [0.7, 0.4, 0.2, 0]), riskAt: 7 },
    { key: "bmi", label: "BMI", unit: "kg/m²", target: "目标 <24", values: trendValues(Number(metrics.bmi || 0), [0.8, 0.5, 0.2, 0]), riskAt: 24 }
  ];
}

function trendValues(current, offsets) {
  if (!Number.isFinite(current) || current <= 0) return [];
  return offsets.map((offset, index) => ({
    label: index === offsets.length - 1 ? "当前" : `${offsets.length - index}期前`,
    value: Number((current - offset).toFixed(1))
  }));
}

function renderCitizenTrend(item) {
  const max = Math.max(...item.values.map((point) => point.value), item.riskAt);
  const latest = item.values[item.values.length - 1] || { value: 0 };
  const improving = item.values.length > 1 && latest.value <= item.values[0].value;
  return `<article class="citizen-trend-card" data-trend="${item.key}">
    <div class="trend-card-head">
      <div>
        <strong>${item.label}</strong>
        <span>${item.target}</span>
      </div>
      <em class="${latest.value >= item.riskAt ? "warn" : "ok"}">${latest.value} ${item.unit}</em>
    </div>
    <div class="trend-bars" aria-label="${item.label}趋势">
      ${item.values.map((point) => `<div class="trend-bar">
        <i style="height:${Math.max(18, Math.round((point.value / max) * 100))}%"></i>
        <small>${point.value}</small>
        <span>${point.label}</span>
      </div>`).join("")}
    </div>
    <p class="muted">${improving ? "较早期趋势趋稳，继续按随访计划观察。" : "近期指标仍需重点关注，建议复测并联系家庭医生。"}</p>
  </article>`;
}

function renderLifeCycle(resident, diseases, followups, records) {
  const container = document.querySelector("#lifecycle-cards");
  if (!container) return;
  const birthCertificates = getBirthCertificatesForResident(resident.id);
  const deathCertificates = getDeathCertificatesForResident(resident.id);
  const labs = getPersonalRecords(resident.id, "labs");
  const vaccines = getPersonalRecords(resident.id, "vaccines");
  const medications = getPersonalRecords(resident.id, "medications");
  const admissions = getPersonalRecords(resident.id, "admissions");
  const authorizations = getPersonalRecords(resident.id, "authorizations");
  const senior = (state.seniorServices || []).filter((item) => item.residentId === resident.id);
  const age = ageOf(resident.birthDate);
  const latestRecord = [records[0], labs[0], medications[0]].filter(Boolean).sort(sortByDateDesc)[0];
  const pendingFollowups = followups.filter((item) => item.status !== "已完成");
  const activeStatuses = new Set(["已归集", "有记录", "持续更新", "管理中", "已纳入", "已授权", "已归档"]);
  const urgentActions = [];
  const stages = [
    {
      title: "出生与建档",
      status: birthCertificates.length ? "已归集" : "待归集",
      detail: birthCertificates[0]
        ? `${birthCertificates[0].newbornName || resident.name} · ${birthCertificates[0].certificateNo} · ${birthCertificates[0].healthManagementStatus || "新生儿管理"}`
        : "出生医学证明、母婴三证和新生儿访视信息可在归集后查看。",
      action: birthCertificates[0]?.nextService || "补齐出生证、出生筛查和接种起始记录",
      urgent: !birthCertificates.length || /待|复测|确认|专案/.test(birthCertificates[0]?.nextService || "")
    },
    {
      title: "儿童保健",
      status: vaccines.length ? "有记录" : age < 18 ? "待跟进" : "历史阶段",
      detail: vaccines[0] ? `${vaccines.length} 条免疫接种记录，最近：${vaccines[0].name}` : "儿童体检、免疫规划、发育评估和体弱儿童管理可持续归集。",
      action: age < 7 ? "下发月龄体检、接种和发育评估提醒" : "保留历史儿童保健和接种档案",
      urgent: age < 7 && !vaccines.length
    },
    {
      title: "青少年健康",
      status: age >= 7 && age < 18 ? "管理中" : vaccines.length ? "有记录" : "历史阶段",
      detail: "学校健康、视力口腔、心理筛查、运动处方和传染病防控记录按授权汇入。",
      action: age >= 7 && age < 18 ? "下发视力、口腔、心理和疫苗补种计划" : "沉淀青少年阶段风险与干预记录",
      urgent: age >= 7 && age < 18
    },
    {
      title: "成人健康",
      status: latestRecord ? "持续更新" : "待补齐",
      detail: latestRecord ? `${latestRecord.date} · ${latestRecord.name} · ${latestRecord.source}` : "体检、门诊病历、检查检验和用药处方待补齐。",
      action: "保持年度体检、授权共享和异常指标随访",
      urgent: !latestRecord
    },
    {
      title: "慢病与康复",
      status: diseases.length ? "管理中" : "未登记慢病",
      detail: diseases.length ? diseases.map((item) => `${item.type}/${item.status}`).join("、") : "暂无慢病登记，继续风险筛查和健康教育。",
      action: pendingFollowups.length ? `${pendingFollowups.length} 项随访待处理` : "按需开展慢病筛查、复诊和康复管理",
      urgent: Boolean(pendingFollowups.length)
    },
    {
      title: "老年与照护",
      status: age >= 60 || senior.length ? "已纳入" : "预备阶段",
      detail: senior.length ? senior.map((item) => `${item.serviceName || item.type || "适老服务"} · ${item.status || "服务中"}`).join("、") : "适老服务、家庭代办、长期处方、失能评估和照护资源可接续。",
      action: age >= 60 ? "完善老年健康评估、用药安全和照护计划" : "提前建立家庭联系人和授权代办",
      urgent: age >= 60 && !senior.length
    },
    {
      title: "临终关怀与授权",
      status: authorizations.length || admissions.length ? "已授权" : "预备阶段",
      detail: authorizations[0] ? `${authorizations.length} 条授权记录，最近：${authorizations[0].name}` : "急危重症、住院、临终关怀、家属代办和预立医疗照护计划可接续。",
      action: admissions.length ? "联动住院记录、家庭联系人和转归随访" : "完善紧急联系人、授权代办和照护意愿",
      urgent: age >= 60 && !authorizations.length
    },
    {
      title: "死亡与身后事项",
      status: deathCertificates.length ? "已归档" : "未发生",
      detail: deathCertificates[0]
        ? `${deathCertificates[0].certificateNo} · ${deathCertificates[0].deathDateTime} · ${deathCertificates[0].qualityCheck || "待质控"}`
        : "死亡医学证明、公安民政共享和家属事项尚未触发。",
      action: deathCertificates[0] ? `${deathCertificates[0].publicSecuritySync || "公安待共享"} · ${deathCertificates[0].civilAffairsSync || "民政待共享"}` : "保留预立授权、紧急联系人和身后事务指引",
      urgent: deathCertificates.some((item) => item.publicSecuritySync !== "已共享" || item.civilAffairsSync !== "已共享")
    }
  ];
  stages.forEach((stage) => {
    if (stage.urgent) urgentActions.push(`${stage.title}：${stage.action}`);
  });
  document.querySelector("#lifecycle-summary").textContent = `${resident.name} · ${age} 岁 · ${stages.filter((item) => activeStatuses.has(item.status)).length}/${stages.length} 个阶段已有数据 · ${urgentActions.length} 项需下发`;
  container.innerHTML = stages.map((stage, index) => `<article class="lifecycle-card">
    <span>${String(index + 1).padStart(2, "0")}</span>
    <strong>${stage.title}</strong>
    <p>${stage.detail}</p>
    <small class="${stage.urgent ? "warn" : ""}">${stage.status} · ${stage.action}</small>
  </article>`).join("");
  renderLifecycleActions(resident.id);
}

function renderLifecycleActions(residentId) {
  const container = document.querySelector("#lifecycle-action-cards");
  if (!container) return;
  const actions = (state.citizenLifecycleActions || [])
    .filter((item) => item.residentId === residentId)
    .slice(0, 6);
  if (!actions.length) {
    container.innerHTML = `<article class="lifecycle-action-card stable">
      <strong>暂无待办事项</strong>
      <span>当前账号可见范围内，出生、儿童、成人、老年和身后事项未触发新的健康管理待办。</span>
      <small>继续按家庭医生提醒和年度体检更新健康档案</small>
    </article>`;
    return;
  }
  const priorityLabel = { high: "高优先级", medium: "需办理", low: "可完善" };
  container.innerHTML = actions.map((item) => `<article class="lifecycle-action-card ${item.priority || "medium"}">
    <div>
      <strong>${item.title || "生命周期健康管理事项"}</strong>
      <span>${item.status || "待办理"} · ${item.sourceCollection || "healthRecords"}</span>
    </div>
    <p>${item.action || "请按家庭医生或经办机构提示完成。"}${item.due ? ` · ${item.due}` : ""}</p>
    <small>${priorityLabel[item.priority] || "需办理"} · ${item.ownerRole === "citizen" ? "居民端" : item.ownerRole}</small>
    <div class="lifecycle-action-buttons">
      <button type="button" data-lifecycle-action="${item.id}" data-lifecycle-action-type="resident-remind">提醒医生</button>
      <button type="button" data-lifecycle-action="${item.id}" data-lifecycle-action-type="acknowledge">我已知晓</button>
    </div>
  </article>`).join("");
}

function bindLifecycleActionButtons() {
  const target = document.querySelector("#lifecycle-action-cards");
  if (!target) return;
  target.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-lifecycle-action]");
    if (!button) return;
    const actionId = button.dataset.lifecycleAction;
    const actionType = button.dataset.lifecycleActionType || "resident-remind";
    const lifecycleAction = (state.citizenLifecycleActions || []).find((item) => item.id === actionId);
    const defaultComment = actionType === "acknowledge"
      ? "居民已知晓该生命周期健康管理事项"
      : lifecycleAction?.action || "请家庭医生协助处理生命周期健康管理待办";
    const comment = actionType === "acknowledge"
      ? defaultComment
      : window.prompt("请补充提醒内容", defaultComment) || defaultComment;
    button.disabled = true;
    try {
      await submitLifecycleAction(actionId, { action: actionType, comment });
      showToast(actionType === "acknowledge" ? "已记录知晓回执" : "已发送医生提醒");
      renderCitizen(currentResidentId);
    } catch (error) {
      showToast(error.message || "生命周期待办提交失败");
    } finally {
      button.disabled = false;
    }
  });
}

async function submitLifecycleAction(actionId, payload) {
  if (API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/citizen/lifecycle-actions/${encodeURIComponent(actionId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`生命周期待办提交失败：${response.status}`);
    const result = await response.json();
    state.citizenLifecycleActions = [
      ...(state.citizenLifecycleActions || []).filter((item) => item.residentId !== currentResidentId),
      ...(Array.isArray(result.actions) ? result.actions : [])
    ];
    citizenMessages = await fetchCitizenMessages();
    return result;
  }
  const action = applyLocalLifecycleAction(actionId, payload);
  citizenMessages.unshift(buildLocalLifecycleMessage(action, payload));
  state.taskMessages = citizenMessages;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  return { ok: true, action };
}

function applyLocalLifecycleAction(actionId, payload) {
  const actions = state.citizenLifecycleActions || [];
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw new Error("未找到生命周期待办");
  if (payload.action === "acknowledge" && action.sourceId) {
    const rows = findResidentTaskRows(action.sourceCollection);
    const index = rows.findIndex((item) => item.id === action.sourceId);
    if (index >= 0) {
      rows[index] = {
        ...rows[index],
        lifecycleResidentAction: "acknowledge",
        lifecycleResidentActionAt: new Date().toISOString(),
        lifecycleResidentComment: payload.comment || ""
      };
    }
    state.citizenLifecycleActions = actions.filter((item) => item.id !== actionId);
  }
  return action;
}

function buildLocalLifecycleMessage(action, payload) {
  return {
    id: `msg-local-${crypto.randomUUID()}`,
    taskId: `citizenLifecycleActions:${action.id}`,
    collection: "citizenLifecycleActions",
    sourceId: action.sourceId || action.id,
    residentId: action.residentId || currentResidentId,
    targetRole: "institution",
    channel: "in_app",
    title: payload.action === "acknowledge" ? "生命周期待办：居民已知晓" : "生命周期待办：居民提醒医生",
    body: payload.comment || action.action || "居民端已处理生命周期待办",
    status: "sent",
    receipts: [],
    createdAt: new Date().toISOString(),
    createdBy: "citizen"
  };
}

function getBirthCertificatesForResident(residentId) {
  return (state.birthCertificates || [])
    .filter((item) => item.maternalResidentId === residentId || item.residentId === residentId)
    .sort((a, b) => String(b.birthDateTime || b.lastUpdated || "").localeCompare(String(a.birthDateTime || a.lastUpdated || "")));
}

function getDeathCertificatesForResident(residentId) {
  return (state.deathCertificates || [])
    .filter((item) => item.residentId === residentId)
    .sort((a, b) => String(b.deathDateTime || b.lastUpdated || "").localeCompare(String(a.deathDateTime || a.lastUpdated || "")));
}

function renderEmr(records, resident, diseases, followups) {
  document.querySelector("#emr-count").textContent = `${records.length} 条`;
  const archiveLink = `${resident.organization} · ${diseases.map((item) => item.type).join("、") || "暂无慢病登记"} · ${followups.filter((item) => item.status !== "已完成").length} 项待随访`;
  document.querySelector("#emr-timeline").innerHTML = records
    .map((record) => `<section class="visit">
      <div class="visit-date">${escapeHtml(record.date)}<br><span class="tag">${escapeHtml(record.meta?.visitType || "病历")}</span></div>
      <div class="visit-body">
        <h3>${escapeHtml(record.source)}</h3>
        <p class="muted">${escapeHtml(record.name)}</p>
        <p>${escapeHtml(record.result)}</p>
        <p class="muted">关联健康档案：${escapeHtml(archiveLink)}</p>
        ${renderSourceBadge(record)}
        <details class="record-detail">
          <summary>查看诊疗详情、医嘱和来源</summary>
          <dl>
            <div><dt>诊疗来源</dt><dd>${escapeHtml(record.source || "居民健康信息库")}</dd></div>
            <div><dt>记录类型</dt><dd>${escapeHtml(record.meta?.visitType || record.category || "电子病历")}</dd></div>
            <div><dt>诊断/标题</dt><dd>${escapeHtml(record.name)}</dd></div>
            <div><dt>医嘱摘要</dt><dd>${escapeHtml(record.result)}</dd></div>
            <div><dt>最近更新</dt><dd>${escapeHtml(record.updatedAt?.slice(0, 19) || record.date || "待同步")}</dd></div>
          </dl>
        </details>
        <div class="visit-tags">
          ${(record.meta?.exams || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          ${(record.meta?.medications || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        </div>
      </div>
    </section>`)
    .join("") || `<p class="muted">暂无电子病历记录。</p>`;
}

function renderDiseases(diseases, risk) {
  document.querySelector("#disease-cards").innerHTML = diseases
    .map((item) => `<article class="mini-card">
      <h3>${item.type}</h3>
      <p class="muted">${item.diagnosedAt} · ${item.source}</p>
      <p>${item.note || "按计划持续管理。"}</p>
      <span class="status ${risk.level === "高危" ? "danger" : risk.level === "中危" ? "warn" : ""}">${item.status} · ${risk.level}</span>
    </article>`)
    .join("") || `<p class="muted">暂无慢病登记。</p>`;
}

function renderFollowups(followups) {
  document.querySelector("#followup-cards").innerHTML = followups
    .sort((a, b) => a.plannedAt.localeCompare(b.plannedAt))
    .map((item) => `<article class="mini-card">
      <h3>${item.diseaseType}</h3>
      <p class="muted">${item.plannedAt} · ${item.assignee}</p>
      <p>${item.advice || "按计划完成随访。"}</p>
      <span class="status ${item.status === "已逾期" ? "danger" : item.status === "待随访" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无随访提醒。</p>`;
}

function renderFollowupFeedback(residentId, followups) {
  const form = document.querySelector("#followup-feedback-form");
  const status = document.querySelector("#followup-feedback-status");
  if (!form || !status) return;
  const select = form.querySelector("select[name='followupId']");
  const available = followups.length ? followups : (state.followups || []).filter((item) => item.residentId === residentId);
  select.innerHTML = available.map((item) => `<option value="${item.id}">${item.diseaseType} · ${item.plannedAt} · ${item.status}</option>`).join("");
  const feedback = (state.personalRecords || []).filter((item) => item.residentId === residentId && (item.category === "chronic-feedback" || item.meta?.followupFeedback));
  status.textContent = feedback.length ? `${feedback.length} 条已反馈` : "待反馈";
}

function bindFollowupFeedback() {
  const form = document.querySelector("#followup-feedback-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const followup = (state.followups || []).find((item) => item.id === data.followupId);
    const payload = {
      residentId: currentResidentId,
      followupId: data.followupId,
      name: "院后随访居民反馈",
      result: `${data.medicationTaken === "true" ? "已按医嘱服药" : "未完全按医嘱服药"}；${data.symptoms || "暂无明显不适"}；${data.nextRequest || "继续按计划随访"}`,
      source: "居民端主动反馈",
      medicationTaken: data.medicationTaken === "true",
      symptoms: data.symptoms || "",
      nextRequest: data.nextRequest || "",
      satisfaction: data.nextRequest ? "需要协助" : "继续观察"
    };
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      let saved;
      if (API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${API_BASE}/chronic/followup-feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`feedback failed: ${response.status}`);
        saved = await response.json();
      } else {
        saved = { ...payload, id: crypto.randomUUID(), category: "chronic-feedback", date: todayOffset(0), meta: { followupFeedback: true, followupId: data.followupId, medicationTaken: payload.medicationTaken, symptoms: payload.symptoms, nextRequest: payload.nextRequest, satisfaction: payload.satisfaction }, createdAt: new Date().toISOString() };
      }
      if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
      state.personalRecords.unshift(saved);
      if (followup) {
        followup.feedbackStatus = "received";
        followup.feedbackSummary = saved.result;
        followup.medicationTaken = payload.medicationTaken;
      }
      if (API_BASE) state.chronicFollowupSummary = await loadChronicFollowupSummary();
      form.reset();
      renderCitizen(currentResidentId);
      showToast("院后随访反馈已提交，家庭医生可在机构端处置");
    } catch (error) {
      showToast(error.message || "反馈提交失败，请检查登录状态和网络连接");
    } finally {
      submit.disabled = false;
    }
  });
}

function renderResidentCheckin(residentId) {
  const status = document.querySelector("#resident-checkin-status");
  if (!status) return;
  const records = (state.personalRecords || []).filter((item) => item.residentId === residentId && (item.category === "chronic-self-checkin" || item.meta?.residentExperience));
  status.textContent = records.length ? `${records.length} check-ins recorded` : "Ready";
}

function bindResidentExperienceCheckin() {
  const form = document.querySelector("#resident-checkin-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const payload = {
      residentId: currentResidentId,
      measurementType: data.measurementType || "home self-monitoring",
      measurementValue: data.measurementValue || "",
      medicationTaken: data.medicationTaken === "true",
      symptoms: data.symptoms || "",
      source: "resident portal"
    };
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      let saved;
      if (API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${API_BASE}/chronic/resident-checkins`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error(`check-in failed: ${response.status}`);
        saved = await response.json();
      } else {
        saved = {
          record: { id: crypto.randomUUID(), residentId: currentResidentId, category: "chronic-self-checkin", date: todayOffset(0), name: "resident self-management check-in", result: `${payload.measurementType}: ${payload.measurementValue}`, source: payload.source, meta: { residentExperience: true, medicationTaken: payload.medicationTaken, symptoms: payload.symptoms }, createdAt: new Date().toISOString() },
          selfManagement: { id: `csm-${crypto.randomUUID()}`, residentId: currentResidentId, device: payload.measurementType, latestValue: payload.measurementValue, uploadSource: payload.source, status: "resident checked in", nextAction: "continue self-management plan" }
        };
      }
      if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
      if (!Array.isArray(state.chronicSelfManagement)) state.chronicSelfManagement = [];
      if (saved.record) state.personalRecords.unshift(saved.record);
      if (saved.selfManagement) state.chronicSelfManagement.unshift(saved.selfManagement);
      form.reset();
      renderCitizen(currentResidentId);
      showToast("Resident self-management check-in submitted.");
    } catch (error) {
      showToast(error.message || "Check-in failed.");
    } finally {
      submit.disabled = false;
    }
  });
}

function renderChronicServices(residentId) {
  const target = document.querySelector("#chronic-service-cards");
  if (!target) return;
  const cards = [
    ...(state.chronicScreeningTasks || []).filter((item) => item.residentId === residentId).map((item) => ({
      title: item.taskName,
      detail: `${item.riskLevel} · ${item.model}`,
      meta: `${item.institution} · ${item.due}`,
      status: item.status
    })),
    ...(state.chronicEducationPushes || []).filter((item) => item.residentId === residentId).map((item) => ({
      title: item.topic,
      detail: `${item.contentType} · ${item.trigger}`,
      meta: `${item.channel} · ${item.feedback}`,
      status: item.status
    })),
    ...(state.chronicManagementPlans || []).filter((item) => item.residentId === residentId).map((item) => ({
      title: `${item.diseaseType}管理计划`,
      detail: `${item.grade} · ${item.plan}`,
      meta: `下次复核 ${item.nextReview}`,
      status: item.status
    }))
  ];
  target.innerHTML = cards.map((item) => `<article class="mini-card">
    <h3>${item.title}</h3>
    <p>${item.detail}</p>
    <p class="muted">${item.meta}</p>
    <span class="status ${String(item.status).includes("预警") ? "danger" : ""}">${item.status}</span>
  </article>`).join("") || `<p class="muted">暂无慢病筛查、宣教或管理计划。</p>`;
}

function renderReferrals(residentId) {
  const target = document.querySelector("#referral-cards");
  if (!target) return;
  const referrals = (state.referralSystem?.referrals || []).filter((item) => item.residentId === residentId);
  const services = (state.referralSystem?.familyDoctorServices || []).filter((item) => item.residentId === residentId);
  const education = state.referralSystem?.education || [];
  target.innerHTML = [
    ...referrals.map((item) => `<article class="mini-card">
      <h3>${item.type} · ${item.diseaseType}</h3>
      <p class="muted">${item.from} → ${item.to}</p>
      <p>${item.reason}</p>
      <p>${item.reservedResource}</p>
      <span class="status ${item.priority === "高" ? "danger" : item.status.includes("待") ? "warn" : ""}">${item.status}</span>
    </article>`),
    ...services.map((item) => `<article class="mini-card">
      <h3>${item.servicePackage}</h3>
      <p class="muted">${item.provider} · ${item.fulfillment}</p>
      <p>${item.items.join("、")}</p>
      <p>${item.nextAction}</p>
      <span class="status">家庭医生签约</span>
    </article>`),
    ...education.slice(0, referrals.length ? 1 : 2).map((item) => `<article class="mini-card">
      <h3>${item.title}</h3>
      <p class="muted">${item.audience} · ${item.channel}</p>
      <p>${item.message}</p>
      <span class="status">就医指引</span>
    </article>`)
  ].join("") || `<p class="muted">暂无转诊服务。常见病、慢性病稳定期建议优先基层首诊。</p>`;
}

function renderBirthHealth(residentId) {
  const container = document.querySelector("#birth-health-cards");
  const summary = document.querySelector("#birth-health-summary-strip");
  if (!container) return;
  const certificates = (state.birthCertificates || []).filter((item) => item.maternalResidentId === residentId || item.residentId === residentId);
  if (summary) {
    const pendingCount = certificates.filter((item) => item.healthManagementStatus?.includes("待") || item.status?.includes("待") || item.publicSecuritySync !== "已共享" || item.maternalChildSync !== "已入册").length;
    const lowWeightCount = certificates.filter((item) => Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500).length;
    const closureRows = birthServiceClosureRows(certificates);
    const closureDone = closureRows.filter((item) => item.done).length;
    const closureTotal = closureRows.length || 1;
    const closurePercent = Math.round((closureDone / closureTotal) * 100);
    const nextService = certificates.find((item) => item.nextService)?.nextService || "等待出生医学证明归集后生成接续任务";
    summary.innerHTML = [
      ["出生证", certificates.length, "家庭成员归集"],
      ["待接续", pendingCount, "共享、入册或访视未闭环"],
      ["低体重专案", lowWeightCount, "需营养和体重随访"],
      ["闭环率", `${closurePercent}%`, `${closureDone}/${closureTotal} 项已完成`],
      ["下一服务", nextService, "居民端提醒"]
    ].map(([label, value, hint]) => `<article>
      <span>${label}</span>
      <strong>${value}</strong>
      ${label === "闭环率" ? `<div class="birth-health-progress" aria-hidden="true"><i style="width: ${closurePercent}%"></i></div>` : ""}
      <small>${hint}</small>
    </article>`).join("");
  }
  container.innerHTML = certificates.map((item) => {
    const lowWeight = Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500;
    const pending = item.healthManagementStatus?.includes("待") || item.status?.includes("待") || item.publicSecuritySync !== "已共享" || item.maternalChildSync !== "已入册";
    const badge = pending || lowWeight ? "warn" : "info";
    const services = [
      ["出生证明", item.status || "待处理"],
      ["电子证照", item.electronicLicenseStatus || "待生成"],
      ["公安共享", item.publicSecuritySync || "未共享"],
      ["妇幼入册", item.maternalChildSync || "待入册"],
      ["新生儿访视", item.healthManagementStatus || "待建档"],
      lowWeight ? ["低体重儿专案", "需随访"] : ["出生体重", `${item.birthWeight || "-"}g`]
    ];
    return `<article class="card">
      <div>
        <strong>${item.newbornName || "未命名新生儿"} · ${item.certificateNo}</strong>
        <p>${item.birthDateTime || "出生时间待确认"} · ${item.newbornGender || "性别待确认"} · ${item.birthWeight || "-"}g</p>
        <p>${services.map(([name, status]) => `${name}：${status}`).join(" · ")}</p>
        <p>健康管理：${item.healthManagementStatus || "待建档"} · ${item.nextService || "新生儿访视与预防接种提醒"}</p>
      </div>
      <span class="badge ${badge}">${item.issueType || "首次签发"}</span>
    </article>`;
  }).join("") || `<p class="muted">当前家庭成员暂无出生医学证明或新生儿健康管理任务。</p>`;
}

function birthServiceClosureRows(certificates) {
  return certificates.flatMap((item) => {
    const lowWeight = Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500;
    return [
      { label: "出生证明", status: item.status || "待处理", done: /已|完成|签发|核验/.test(item.status || "") },
      { label: "电子证照", status: item.electronicLicenseStatus || "待生成", done: /已|完成|生成|签发/.test(item.electronicLicenseStatus || "") },
      { label: "公安共享", status: item.publicSecuritySync || "未共享", done: item.publicSecuritySync === "已共享" },
      { label: "妇幼入册", status: item.maternalChildSync || "待入册", done: item.maternalChildSync === "已入册" },
      { label: lowWeight ? "低体重专案" : "新生儿访视", status: lowWeight ? "需随访" : (item.healthManagementStatus || "待建档"), done: !/待|需|未/.test(`${lowWeight ? "需随访" : item.healthManagementStatus || ""}`) }
    ];
  });
}

function renderMaternalChildContinuity(residentId) {
  const container = document.querySelector("#mch-continuity-cards");
  if (!container) return;
  const certificates = (state.birthCertificates || [])
    .filter((item) => item.maternalResidentId === residentId || item.residentId === residentId)
    .sort((a, b) => String(b.birthDateTime || "").localeCompare(String(a.birthDateTime || "")));
  if (!certificates.length) {
    container.innerHTML = `<p class="muted">暂无妇幼接续清单。出生证明接入后将自动生成访视、筛查、接种和儿童保健提醒。</p>`;
    return;
  }
  const rows = certificates.flatMap((item) => {
    const lowWeight = Number(item.birthWeight || 0) > 0 && Number(item.birthWeight || 0) < 2500;
    return [
      { title: "出生医学证明", status: item.status || "待处理", detail: `${item.certificateNo} · ${item.issueType || "首次签发"}`, urgent: String(item.status || "").includes("待") },
      { title: "妇幼健康入册", status: item.maternalChildSync || "待入册", detail: "同步孕产妇与新生儿健康管理系统", urgent: item.maternalChildSync !== "已入册" },
      { title: "新生儿家庭访视", status: item.healthManagementStatus || "待建档", detail: item.nextService || "出生后 7 天内或出院后一周内访视", urgent: /待|复测|确认/.test(`${item.healthManagementStatus || ""}${item.nextService || ""}`) },
      { title: "出生缺陷筛查", status: /筛查|黄疸|听力|遗传/.test(item.nextService || "") ? "待确认" : "持续关注", detail: "听力、遗传代谢病、先心病和黄疸复测结果归集", urgent: /筛查|黄疸|听力|遗传/.test(item.nextService || "") },
      ...renderImmunizationPlanCards(item),
      { title: lowWeight ? "低体重儿专案" : "儿童保健接续", status: lowWeight ? "需随访" : "按月龄管理", detail: lowWeight ? "喂养指导、体重复测和高危儿随访" : "预防接种、儿童体检、发育评估和体弱儿童管理", urgent: lowWeight }
    ].map((row) => ({ ...row, newbornName: item.newbornName || "新生儿", birthDateTime: item.birthDateTime || "出生时间待确认" }));
  });
  container.innerHTML = rows.map((row) => `<article class="mini-card">
    <h3>${row.title} · ${row.newbornName}</h3>
    <p class="muted">${row.birthDateTime}</p>
    <p>${row.detail}</p>
    <span class="status ${row.urgent ? "warn" : ""}">${row.status}</span>
  </article>`).join("");
}

function renderImmunizationPlanCards(certificate) {
  const toolkit = window.ImmunizationSchedule2026;
  if (!toolkit?.buildPlan) {
    return [{ title: "免疫规划（2026版）", status: "待加载", detail: "规则库加载后生成国家免疫规划接种提醒", urgent: false }];
  }
  const child = toolkit.childFromCertificate(certificate);
  const records = (state.personalRecords || []).filter((record) => record.meta?.birthCertificateId === certificate.id || record.residentId === child.id);
  const plan = toolkit.buildPlan(child, { records, referenceDate: toolkit.POLICY.referenceDate });
  const next = plan.nextDose;
  return [{
    title: "免疫规划（2026版）",
    status: plan.summary.overdue ? `${plan.summary.overdue} 剂逾期` : plan.summary.dueSoon ? `${plan.summary.dueSoon} 剂将到期` : "按月龄提醒",
    detail: next ? `${next.dueDate} · ${next.vaccine} 第 ${next.doseNo} 剂 · ${next.route}` : "默认程序下暂无待接种剂次",
    urgent: Boolean(plan.summary.overdue || plan.summary.dueSoon)
  }];
}

async function fetchCitizenEscortDashboard() {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/escort-services/dashboard`);
      if (response.ok) return await response.json();
    } catch (error) {
      // Static and offline previews use the scoped state already loaded.
    }
  }
  return {
    providers: (state.escortServiceProviders || []).filter((item) => item.published !== false),
    orders: state.escortServiceOrders || [],
    summary: {
      providers: (state.escortServiceProviders || []).filter((item) => item.published !== false).length,
      orders: (state.escortServiceOrders || []).length
    }
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function renderEscortAppointments(residentId) {
  const form = document.querySelector("#escort-appointment-form");
  const cards = document.querySelector("#escort-appointment-cards");
  const summary = document.querySelector("#escort-appointment-summary");
  if (!form || !cards || !summary) return;
  const providers = getEscortProviders();
  const orders = getEscortOrders(residentId);
  const providerSelect = form.elements.providerId;
  const registrationSelect = form.elements.registrationOrderId;
  const selected = providerSelect.value;
  providerSelect.innerHTML = providers.length
    ? providers
      .map((item) => `<option value="${item.id}">${formatEscortProviderName(item)} · ${formatEscortDistrict(item.district)} · ${item.pricing?.halfDayFee || item.feeEstimate || "待估价"} 元起</option>`)
      .join("")
    : `<option value="">暂无可预约服务主体</option>`;
  if (selected && providers.some((item) => item.id === selected)) providerSelect.value = selected;
  if (registrationSelect) {
    const selectedRegistration = registrationSelect.value;
    const registrationOptions = getEscortRegistrationOptions(residentId);
    registrationSelect.innerHTML = [
      `<option value="">不关联挂号</option>`,
      ...registrationOptions.map((item) => `<option value="${item.id}">${formatEscortHospital(item.hospital)} · ${formatEscortDepartment(item.department)} · ${item.appointmentDate || item.appointmentAt || "日期待确认"} · ${item.queueNo || item.registrationNo || "待回执"}</option>`)
    ].join("");
    if (selectedRegistration && registrationOptions.some((item) => item.id === selectedRegistration)) registrationSelect.value = selectedRegistration;
  }
  if (!providerSelect.value && providers[0]) providerSelect.value = providers[0].id;
  if (!form.elements.appointmentAt.value) form.elements.appointmentAt.value = todayOffset(1);
  setEscortAppointmentAvailability(form, providers.length > 0);
  summary.textContent = providers.length
    ? `${providers.length} 家可预约服务主体 · ${orders.length} 单本人/家庭陪诊预约`
    : `暂无已发布服务主体 · ${orders.length} 单本人/家庭陪诊预约可追踪`;
  renderEscortAppointmentCheck(form, residentId);
  cards.innerHTML = orders
    .sort((a, b) => String(a.appointmentAt || a.due || "").localeCompare(String(b.appointmentAt || b.due || "")))
    .map((item) => `<article class="mini-card escort-order-card">
      <h3>${formatEscortHospital(item.hospital)} · ${formatEscortDepartment(item.department)}</h3>
      <p class="muted">${item.appointmentAt || item.due || "日期待确认"} · ${item.providerName ? formatEscortProviderName(item) : providerName(item.providerId)}</p>
      <p>${formatEscortItems(item.serviceItems)} · ${formatSubsidy(item.subsidyType)} · 预估 ${item.feeEstimate || 0} 元</p>
      <p>合同 ${formatEscortStatus(item.contractStatus)} · 保障 ${formatEscortStatus(item.insuranceStatus)} · 回访 ${formatEscortStatus(item.qualityReview)}</p>
      <p>${formatEscortHospitalHandoff(item)}</p>
      ${renderEscortOrderProgress(item)}
      <span class="status ${item.priority === "high" || item.riskLevel === "high" ? "danger" : String(item.status || "").includes("requested") ? "warn" : ""}">${formatEscortStatus(item.status)}</span>
    </article>`)
    .join("") || `<p class="muted">暂无陪诊预约。提交后将同步到助医陪诊监管端和服务主体待办。</p>`;
}

function setEscortAppointmentAvailability(form, available) {
  form.dataset.escortProviderReady = available ? "true" : "false";
  form.classList.toggle("is-unavailable", !available);
  Array.from(form.elements).forEach((control) => {
    if (control.type === "submit" || control.name) control.disabled = !available;
  });
  const submit = form.querySelector("button[type='submit']");
  if (submit) submit.textContent = available ? "提交陪诊预约" : "暂无可预约服务主体";
}

function renderEscortAppointmentCheck(form = document.querySelector("#escort-appointment-form"), residentId = currentResidentId) {
  const target = document.querySelector("#escort-appointment-check");
  if (!target || !form) return;
  const providers = getEscortProviders();
  const provider = providers.find((item) => item.id === form.elements.providerId?.value) || providers[0] || null;
  const linkedRegistration = findEscortRegistrationOrder(residentId, form.elements.registrationOrderId?.value);
  const validation = buildEscortAppointmentValidation(form, residentId, provider, linkedRegistration);
  const blockers = validation.filter((item) => !item.ready);
  const readyCount = validation.length - blockers.length;
  const serviceLabels = Array.from(form.elements.serviceItems?.selectedOptions || [])
    .map((option) => option.textContent.trim())
    .filter(Boolean);
  const fee = Number(provider?.pricing?.halfDayFee || provider?.feeEstimate || provider?.fee || 0);
  const hospital = form.elements.hospital?.value || linkedRegistration?.hospital || "";
  const department = form.elements.department?.value || linkedRegistration?.department || "";
  const appointmentAt = form.elements.appointmentAt?.value || linkedRegistration?.appointmentDate || linkedRegistration?.appointmentAt || "";
  const handoff = linkedRegistration
    ? `${linkedRegistration.registrationNo || linkedRegistration.queueNo || "挂号回执待同步"} · ${linkedRegistration.hisVisitId || "HIS 就诊号待同步"}`
    : "未关联挂号，提交后由服务主体确认医院接诊信息";
  const rows = [
    ["服务主体", provider ? formatEscortProviderName(provider) : "暂无可预约服务主体"],
    ["预计费用", provider ? `${fee || "待评估"} 元起 · ${formatSubsidy(form.elements.subsidyType?.value)}` : "待确认"],
    ["就诊安排", `${formatEscortHospital(hospital || "医院待填写")} · ${formatEscortDepartment(department || "科室待填写")} · ${appointmentAt || "日期待选择"}`],
    ["服务内容", serviceLabels.length ? serviceLabels.join("、") : "挂号取号、检查陪同"],
    ["医院交接", handoff],
    ["保障状态", provider ? `保险 ${formatEscortStatus(provider.insurance || "covered")} · 家属 ${formatEscortContact(form.elements.familyContactStatus?.value)}` : "待发布服务主体"]
  ];
  target.innerHTML = `<strong>预约核对</strong>
    <p>${provider ? "提交前请核对服务主体、医院、日期和保障信息。" : "暂无可预约服务主体时，表单会保持不可提交状态。"}</p>
    <dl>${rows.map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>
    <div class="escort-appointment-gate-summary" aria-live="polite">已满足 ${readyCount} 项，${blockers.length ? `需补齐 ${blockers.length} 项` : "全部条件已满足"}</div>
    <ul class="escort-appointment-gates" aria-label="陪诊预约提交条件">
      ${validation.map((item) => `<li class="${item.ready ? "is-ready" : "is-blocked"}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.detail)}</span></li>`).join("")}
    </ul>
    <span class="status ${blockers.length ? "warn" : ""}">${blockers.length ? `需补齐 ${blockers.map((item) => item.label).join("、")}` : "可提交预约"}</span>`;
}

function buildEscortAppointmentValidation(form, residentId = currentResidentId, provider = null, linkedRegistration = null) {
  if (!form) return [];
  const hospital = form.elements.hospital?.value || linkedRegistration?.hospital || "";
  const department = form.elements.department?.value || linkedRegistration?.department || "";
  const appointmentAt = form.elements.appointmentAt?.value || linkedRegistration?.appointmentDate || linkedRegistration?.appointmentAt || "";
  const serviceItems = getEscortAppointmentServiceItems(form, linkedRegistration);
  const serviceReady = serviceItems.length > 0;
  return [
    {
      label: "服务主体",
      ready: Boolean(provider),
      detail: provider ? "已发布服务主体，可承接居民预约" : "暂无已发布服务主体"
    },
    {
      label: "就诊医院",
      ready: Boolean(String(hospital).trim()),
      detail: hospital || "请填写医院或关联挂号"
    },
    {
      label: "就诊科室",
      ready: Boolean(String(department).trim()),
      detail: department || "请填写科室或关联挂号"
    },
    {
      label: "预约日期",
      ready: Boolean(appointmentAt) && appointmentAt >= todayOffset(0),
      detail: appointmentAt ? (appointmentAt < todayOffset(0) ? "预约日期不能早于今天" : appointmentAt) : "请选择就诊日期"
    },
    {
      label: "服务内容",
      ready: serviceReady,
      detail: serviceReady ? "已选择陪诊服务内容" : "请选择至少一项服务内容"
    }
  ];
}

function getEscortAppointmentServiceItems(form, linkedRegistration = null) {
  const selectedItems = Array.from(form?.elements.serviceItems?.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean);
  if (selectedItems.length) return selectedItems;
  return linkedRegistration ? ["registration", "exam escort"] : [];
}

function bindEscortAppointment() {
  const form = document.querySelector("#escort-appointment-form");
  if (!form) return;
  const refreshCheck = () => renderEscortAppointmentCheck(form, currentResidentId);
  ["providerId", "appointmentAt", "serviceItems", "subsidyType", "priority", "familyContactStatus"].forEach((name) => {
    form.elements[name]?.addEventListener("change", refreshCheck);
  });
  ["hospital", "department"].forEach((name) => {
    form.elements[name]?.addEventListener("input", refreshCheck);
  });
  form.elements.registrationOrderId?.addEventListener("change", () => {
    applyLinkedRegistrationToEscortForm(form, form.elements.registrationOrderId.value);
    refreshCheck();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const providers = getEscortProviders();
    if (!providers.length) {
      setEscortAppointmentAvailability(form, false);
      showToast("暂无已发布陪诊服务主体，暂不能提交预约");
      return;
    }
    const provider = providers.find((item) => item.id === data.get("providerId"));
    const linkedRegistration = findEscortRegistrationOrder(currentResidentId, data.get("registrationOrderId"));
    const validation = buildEscortAppointmentValidation(form, currentResidentId, provider, linkedRegistration);
    const blockers = validation.filter((item) => !item.ready);
    if (blockers.length) {
      renderEscortAppointmentCheck(form, currentResidentId);
      showToast(`请补齐${blockers.map((item) => item.label).join("、")}后再提交陪诊预约`);
      return;
    }
    const payload = {
      residentId: currentResidentId,
      providerId: data.get("providerId"),
      registrationOrderId: data.get("registrationOrderId"),
      hospital: data.get("hospital") || linkedRegistration?.hospital || "",
      hospitalCode: linkedRegistration?.hospitalCode || "",
      department: data.get("department") || linkedRegistration?.department || "",
      departmentCode: linkedRegistration?.departmentCode || "",
      doctorCode: linkedRegistration?.doctorCode || "",
      appointmentAt: data.get("appointmentAt") || linkedRegistration?.appointmentDate || "",
      due: data.get("appointmentAt") || linkedRegistration?.appointmentDate || "",
      serviceItems: getEscortAppointmentServiceItems(form, linkedRegistration),
      subsidyType: data.get("subsidyType"),
      priority: data.get("priority"),
      riskLevel: data.get("priority") === "high" ? "high" : "medium",
      familyContactStatus: data.get("familyContactStatus"),
      hisVisitId: linkedRegistration?.hisVisitId || "",
      hospitalCheckInNo: linkedRegistration?.registrationNo || "",
      outpatientQueueNo: linkedRegistration?.queueNo || "",
      appointmentSource: linkedRegistration ? "registration-order" : "citizen.html",
      hospitalDepartmentContact: linkedRegistration?.hospitalDepartmentContact || "",
      sourceChannel: "citizen.html",
      note: data.get("note")
    };
    const submit = form.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      let saved;
      if (API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${API_BASE}/escort-services/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
        if (!response.ok) {
          const errorBody = await response.json().catch(() => ({}));
          throw new Error(errorBody.message || `escort appointment failed: ${response.status}`);
        }
        saved = await response.json();
      } else {
        saved = {
          ...payload,
          id: `eso-local-${crypto.randomUUID()}`,
          status: "requested",
          providerName: provider?.name || "社区助医陪诊服务站",
          feeEstimate: Number(provider?.pricing?.halfDayFee || 120),
          contractStatus: "pending",
          insuranceStatus: provider?.insurance || "covered",
          qualityReview: "pending",
          createdAt: new Date().toISOString(),
          createdBy: "citizen"
        };
      }
      if (!Array.isArray(state.escortServiceOrders)) state.escortServiceOrders = [];
      state.escortServiceOrders.unshift(saved);
      if (escortDashboard?.orders && escortDashboard.orders !== state.escortServiceOrders) escortDashboard.orders.unshift(saved);
      serviceOrderCenter = await fetchCitizenServiceOrders();
      form.reset();
      form.elements.appointmentAt.value = todayOffset(1);
      renderCitizen(currentResidentId);
      showToast("陪诊预约已提交，服务主体将在监管端确认合同、保险和陪诊安排");
    } catch (error) {
      showToast(error.message || "陪诊预约提交失败，请检查登录状态和网络连接");
    } finally {
      submit.disabled = false;
    }
  });
}

function getEscortProviders() {
  const providers = escortDashboard?.providers?.length ? escortDashboard.providers : state.escortServiceProviders || [];
  return providers.filter((item) => item.published !== false);
}

function getEscortOrders(residentId) {
  const orders = escortDashboard?.orders?.length ? escortDashboard.orders : state.escortServiceOrders || [];
  return orders.filter((item) => item.residentId === residentId);
}

function getEscortRegistrationOptions(residentId) {
  return activeRegistrationOrders(residentId).filter((item) => !["cancelled", "closed"].includes(item.status));
}

function findEscortRegistrationOrder(residentId, orderId) {
  if (!orderId) return null;
  return getEscortRegistrationOptions(residentId).find((item) => item.id === orderId) || null;
}

function applyLinkedRegistrationToEscortForm(form, orderId) {
  const order = findEscortRegistrationOrder(currentResidentId, orderId);
  if (!order) return;
  form.elements.hospital.value = formatEscortHospital(order.hospital);
  form.elements.department.value = formatEscortDepartment(order.department);
  form.elements.appointmentAt.value = order.appointmentDate || order.appointmentAt || form.elements.appointmentAt.value;
}

function providerName(providerId) {
  const provider = getEscortProviders().find((item) => item.id === providerId);
  return provider ? formatEscortProviderName(provider) : "服务主体待确认";
}

function formatEscortProviderName(item) {
  const value = typeof item === "string" ? item : item?.providerName || item?.name || "";
  return {
    "Pudong Elder Care Service Center": "浦东助医陪诊服务中心",
    "Xuhui Community Day-care Escort Team": "徐汇社区日间照护陪诊队",
    "Hongkou Time-bank Escort Service Station": "虹口时间银行陪诊服务站"
  }[value] || value || "服务主体待确认";
}

function formatEscortDistrict(value) {
  return {
    Pudong: "浦东新区",
    Xuhui: "徐汇区",
    Hongkou: "虹口区",
    Yangpu: "杨浦区",
    Songjiang: "松江区",
    Changning: "长宁区",
    Putuo: "普陀区",
    "Jing'an": "静安区",
    Huangpu: "黄浦区"
  }[value] || value || "本市";
}

function formatEscortHospital(value) {
  return {
    "Dalian Central Hospital outpatient clinic demo": "大连市中心医院门诊",
    "Community follow-up clinic demo": "社区随访门诊",
    "Specialist outpatient demo": "专科门诊"
  }[value] || value || "待确认医院";
}

function formatEscortDepartment(value) {
  return {
    Cardiology: "心内科",
    Endocrinology: "内分泌科",
    Ophthalmology: "眼科"
  }[value] || value || "待确认科室";
}

function formatEscortItems(items) {
  const labels = {
    "mobility assistance": "行动协助",
    registration: "挂号取号",
    "exam escort": "检查陪同",
    "medication pickup": "取药结算",
    "payment and medication pickup": "缴费取药",
    "report explanation": "报告协助",
    "family communication": "家属沟通",
    "psychological comfort": "心理慰藉"
  };
  const values = Array.isArray(items) ? items : String(items || "").split(",").map((item) => item.trim()).filter(Boolean);
  return values.map((item) => labels[item] || item).join("、") || "基础陪诊";
}

function formatSubsidy(value) {
  return {
    "self-pay": "自费",
    "80plus-living-alone": "80 岁以上独居",
    "low-income": "低收入补贴",
    "time-bank": "时间银行"
  }[value] || value || "保障待确认";
}

function formatEscortStatus(value) {
  return {
    confirmed: "已确认",
    returned: "已退回",
    "hospital-confirmed": "医院已确认",
    "hospital-returned": "医院退回补充",
    requested: "待确认",
    matched: "已匹配",
    "contract-pending": "合同待签",
    "in-service": "服务中",
    completed: "已完成",
    closed: "已关闭",
    "cancel-requested": "取消待确认",
    "citizen-feedback": "居民已反馈",
    pending: "待确认",
    required: "待回访",
    covered: "已保障",
    signed: "已签约",
    high: "较急",
    medium: "普通",
    low: "不急"
  }[value] || value || "待确认";
}

function formatEscortHospitalHandoff(item) {
  const status = formatEscortStatus(item.hospitalInterfaceStatus || "pending");
  const queue = item.outpatientQueueNo || item.hospitalCheckInNo || "待医院确认";
  const source = item.hisVisitId || item.appointmentSource || "HIS/预约回执待同步";
  const contact = formatEscortContact(item.hospitalDepartmentContact || item.hospitalNotice || "");
  return `医院回执 ${status} · ${queue} · ${source}${contact ? ` · ${contact}` : ""}`;
}

function renderEscortOrderProgress(item) {
  const milestones = [
    { label: "提交", ready: true, detail: formatEscortStatus(item.status || "requested") },
    { label: "合同", ready: isEscortMilestoneReady(item.contractStatus, ["signed", "confirmed"]), detail: formatEscortStatus(item.contractStatus || "pending") },
    { label: "保障", ready: isEscortMilestoneReady(item.insuranceStatus, ["covered", "confirmed"]), detail: formatEscortStatus(item.insuranceStatus || "pending") },
    { label: "医院", ready: isEscortMilestoneReady(item.hospitalInterfaceStatus, ["confirmed", "hospital-confirmed"]), detail: formatEscortStatus(item.hospitalInterfaceStatus || "pending") },
    { label: "回访", ready: isEscortMilestoneReady(item.qualityReview, ["closed", "citizen-feedback"]) || isEscortMilestoneReady(item.status, ["closed", "completed"]), detail: formatEscortStatus(item.qualityReview || "pending") }
  ];
  return `<ol class="escort-order-progress" aria-label="陪诊订单闭环进度">
    ${milestones.map((step) => `<li class="${step.ready ? "is-ready" : "is-waiting"}"><strong>${escapeHtml(step.label)}</strong><span>${escapeHtml(step.detail)}</span></li>`).join("")}
  </ol>`;
}

function isEscortMilestoneReady(value, readyStatuses = []) {
  const normalized = String(value || "").toLowerCase();
  return readyStatuses.includes(normalized);
}

function formatEscortContact(value) {
  return {
    "Cardiology outpatient guidance desk": "心内科门诊导诊台",
    "Outpatient volunteer desk": "门诊志愿服务台",
    "Arrive at first-floor outpatient service desk 20 minutes before the appointment.": "请提前 20 分钟到一楼门诊服务台报到",
    "Quality callback required after volunteer escort completion.": "服务完成后需进行质控回访"
  }[value] || value;
}

function bindLongTermCareAssessment() {
  const form = document.querySelector("#longterm-care-form");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!currentResidentId) return;
    const values = Object.fromEntries(new FormData(form).entries());
    const assessment = buildLongTermCareAssessment(values, currentResidentId);
    if (!citizenExtra[currentResidentId]) citizenExtra[currentResidentId] = {};
    if (!Array.isArray(citizenExtra[currentResidentId].longTermCareAssessments)) citizenExtra[currentResidentId].longTermCareAssessments = [];
    citizenExtra[currentResidentId].longTermCareAssessments.unshift(assessment);
    localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
    form.reset();
    renderLongTermCareAssessment(currentResidentId);
    renderResidentFunctionAudit();
    showToast("长期照护评估已生成，照护建议已进入居民端");
  });
}

function buildLongTermCareAssessment(values, residentId) {
  const score = ["mobility", "selfCare", "cognition"].reduce((sum, key) => sum + Number(values[key] || 0), 0) * 20;
  const highNeed = score >= 80 || values.insurance === "eligible" || values.civilAffairs === "home-visit";
  return {
    id: `ltc-${Date.now()}`,
    residentId,
    service: "长期照护评估",
    channel: "居民端自评",
    status: highNeed ? "待上门复评" : "已生成建议",
    contact: formatCaregiver(values.caregiver),
    nextAction: highNeed ? "推送社区照护站上门复评并同步长护险预核验" : "纳入家庭医生随访时复核",
    careLevel: score >= 80 ? "重度失能风险" : score >= 40 ? "中度照护风险" : "轻度照护风险",
    eligibility: formatLongTermCareEligibility(values.insurance, values.civilAffairs),
    assessmentScore: score,
    carePlan: highNeed ? "建议每周 2 次上门照护、用药复核、跌倒风险评估和家属照护指导" : "建议开启适老提醒、家庭监测和月度随访复核",
    provider: values.caregiver === "institution" ? "养老/护理机构" : values.caregiver === "community" ? "社区照护站" : "家庭医生团队",
    reviewCycle: highNeed ? "7 天内复评" : "90 天复评",
    createdAt: new Date().toISOString()
  };
}

function renderLongTermCareAssessment(residentId) {
  const target = document.querySelector("#longterm-care-cards");
  const result = document.querySelector("#longterm-care-result");
  const summary = document.querySelector("#longterm-care-summary");
  if (!target || !result || !summary) return;
  const seeded = (state.seniorServices || []).filter((item) => item.residentId === residentId);
  const generated = Array.isArray(citizenExtra[residentId]?.longTermCareAssessments) ? citizenExtra[residentId].longTermCareAssessments : [];
  const assessments = [...generated, ...seeded].filter((item) => item.careLevel || item.assessmentScore || item.carePlan);
  const latest = assessments[0];
  summary.textContent = assessments.length ? `${assessments.length} 条照护评估，最近：${latest.careLevel || latest.service}` : "暂无照护评估，提交表单后生成建议";
  result.innerHTML = latest ? `
    <strong>${latest.careLevel || "照护风险待评估"}</strong>
    <span>${latest.eligibility || "待遇预核验待补充"} · ${latest.reviewCycle || "随访时复核"}</span>
    <p>${latest.carePlan || latest.nextAction || "请补充评估信息。"}</p>
  ` : `<p class="muted">可按行动能力、自理能力、认知状态、照护人和待遇预核验生成长期照护建议。</p>`;
  target.innerHTML = assessments.map((item) => `<article class="longterm-care-card">
    <div>
      <strong>${item.service || "长期照护评估"}</strong>
      <span>${item.status || "已生成建议"}</span>
    </div>
    <p>${item.carePlan || item.nextAction || "照护计划待补充。"}</p>
    <dl>
      <div><dt>等级</dt><dd>${item.careLevel || "待评估"}</dd></div>
      <div><dt>预核验</dt><dd>${item.eligibility || "待核验"}</dd></div>
      <div><dt>服务团队</dt><dd>${item.provider || item.contact || "家庭医生团队"}</dd></div>
      <div><dt>复评</dt><dd>${item.reviewCycle || "随访时复核"}</dd></div>
    </dl>
  </article>`).join("") || `<p class="muted">暂无长期照护评估记录。</p>`;
}

function formatCaregiver(value) {
  return { family: "家庭照护人", community: "社区照护站", institution: "养老/护理机构" }[value] || "家庭照护人";
}

function formatLongTermCareEligibility(insurance, civilAffairs) {
  const insuranceText = { eligible: "长护险预核验条件符合", review: "长护险需人工复核", missing: "长护险材料待补充" }[insurance] || "长护险待核验";
  const civilText = { none: "暂无民政补贴", subsidy: "疑似可享民政补贴", "home-visit": "需民政上门复评" }[civilAffairs] || "民政服务待核验";
  return `${insuranceText}；${civilText}`;
}

function familyDoctorTemplates() {
  return familyDoctorDashboard?.templates?.length ? familyDoctorDashboard.templates : state.phase2FamilyDoctorTemplates || [];
}

function familyDoctorTeams() {
  return familyDoctorDashboard?.teams?.length ? familyDoctorDashboard.teams : state.phase2FamilyDoctorTeams || [];
}

function familyDoctorPackages() {
  return familyDoctorDashboard?.packages?.length ? familyDoctorDashboard.packages : state.phase2FamilyDoctorServicePackages || [];
}

function familyDoctorApplications(residentId) {
  const rows = familyDoctorDashboard?.applications?.length ? familyDoctorDashboard.applications : state.phase2FamilyDoctorApplications || [];
  return rows.filter((item) => item.residentId === residentId);
}

function familyDoctorContracts(residentId) {
  const rows = familyDoctorDashboard?.contracts?.length ? familyDoctorDashboard.contracts : state.phase2FamilyDoctorContracts || [];
  return rows.filter((item) => item.residentId === residentId);
}

function familyDoctorFulfillments(residentId) {
  const rows = familyDoctorDashboard?.fulfillments?.length ? familyDoctorDashboard.fulfillments : state.phase2FamilyDoctorFulfillments || [];
  return rows.filter((item) => item.residentId === residentId);
}

function familyDoctorSuggestions(residentId) {
  const remote = familyDoctorDashboard?.suggestions || [];
  if (remote.length) return remote.filter((item) => item.residentId === residentId);
  return (state.personalRecords || [])
    .filter((item) => item.residentId === residentId && item.category === "physical-exam" && item.meta?.careLinkage?.familyDoctorSuggestion)
    .map((item) => ({ reportId: item.id, reportNo: item.meta?.reportNo || "", examDate: item.date, riskLevel: item.meta.careLinkage.riskLevel, dueAt: item.meta.careLinkage.dueAt, ...item.meta.careLinkage.familyDoctorSuggestion }));
}

function familyDoctorPackageName(packageId) {
  const item = familyDoctorPackages().find((row) => row.id === packageId);
  return item?.name || packageId || "服务包待确认";
}

function familyDoctorTeamName(teamId) {
  const item = familyDoctorTeams().find((row) => row.id === teamId);
  return item?.teamName || item?.institutionName || teamId || "团队待确认";
}

function renderFamilyDoctorContracts(residentId) {
  const form = document.querySelector("#family-doctor-contract-form");
  const packageCards = document.querySelector("#family-doctor-package-cards");
  const contractCards = document.querySelector("#family-doctor-contract-cards");
  const summary = document.querySelector("#family-doctor-summary");
  if (!form || !packageCards || !contractCards) return;
  const packages = familyDoctorPackages();
  const teams = familyDoctorTeams();
  const packageSelect = form.elements.packageId;
  const teamSelect = form.elements.teamId;
  const selectedPackage = packageSelect.value;
  const selectedTeam = teamSelect.value;
  packageSelect.innerHTML = packages.map((item) => `<option value="${item.id}">${escapeHtml(item.name || item.id)} · ${escapeHtml(item.visitFrequency || "服务周期")}</option>`).join("");
  teamSelect.innerHTML = teams.map((item) => `<option value="${item.id}">${escapeHtml(item.teamName || item.id)} · ${escapeHtml(item.institutionName || item.institutionCode || "")}</option>`).join("");
  if (selectedPackage && packages.some((item) => item.id === selectedPackage)) packageSelect.value = selectedPackage;
  if (selectedTeam && teams.some((item) => item.id === selectedTeam)) teamSelect.value = selectedTeam;
  const applications = familyDoctorApplications(residentId);
  const contracts = familyDoctorContracts(residentId);
  const fulfillments = familyDoctorFulfillments(residentId);
  const suggestions = familyDoctorSuggestions(residentId);
  const pending = applications.filter((item) => /pending|submitted|review/i.test(`${item.reviewStatus || ""} ${item.status || ""}`));
  const avg = contracts.length ? Math.round(contracts.reduce((sum, item) => sum + Number(item.fulfillmentPercent || 0), 0) / contracts.length) : 0;
  if (summary) summary.textContent = `${packages.length} 个服务包 · ${contracts.length} 份签约 · ${suggestions.length} 条体检建议 · ${pending.length} 条待审 · ${fulfillments.length} 条履约 · 平均履约 ${avg}%`;
  packageCards.innerHTML = packages.map((item) => `<article class="mini-card family-doctor-package-card">
    <h3>${escapeHtml(item.name || item.id)}</h3>
    <p class="muted">${escapeHtml(item.packageCode || item.id)} · ${escapeHtml(item.visitFrequency || "周期待确认")} · ${escapeHtml(item.priceType || "公卫服务")}</p>
    <p>${(item.serviceItems || []).map(escapeHtml).join("、") || "服务项目待确认"}</p>
    <span class="status">${escapeHtml(item.status || "active")}</span>
  </article>`).join("") || `<p class="muted">暂无可选家庭医生服务包。</p>`;
  const applicationCards = applications.map((item) => `<article class="mini-card family-doctor-contract-card">
    <h3>申请：${escapeHtml(familyDoctorPackageName(item.packageId))}</h3>
    <p class="muted">${escapeHtml(familyDoctorTeamName(item.teamId))} · ${escapeHtml(item.applicationType || "new-contract")} · ${escapeHtml(item.desiredStartDate || item.submittedAt || "")}</p>
    <p>${escapeHtml(item.lastAction || "等待机构审核。")}</p>
    <span class="status ${item.reviewStatus === "pending" ? "warn" : item.reviewStatus === "rejected" ? "danger" : ""}">${escapeHtml(item.reviewStatus || item.status || "pending")}</span>
  </article>`);
  const suggestionCards = suggestions.map((item) => `<article class="mini-card family-doctor-contract-card family-doctor-suggestion-card">
    <h3>体检异常家医建议 · ${escapeHtml(item.riskLevel || "待分层")}</h3>
    <p class="muted">${escapeHtml(item.examDate || "")} · 报告号 ${escapeHtml(item.reportNo || "已归档")} · 建议处理 ${escapeHtml(item.dueAt || "尽快")}</p>
    <p>${escapeHtml(item.suggestion || item.reason || "请家庭医生复核体检异常。")}</p>
    <span class="status warn">建议服务包：${escapeHtml(familyDoctorPackageName(item.suggestedPackageId))}</span>
  </article>`);
  const contractRows = contracts.map((item) => {
    const rows = fulfillments.filter((row) => row.contractId === item.id);
    return `<article class="mini-card family-doctor-contract-card">
      <h3>${escapeHtml(familyDoctorPackageName(item.packageId))}</h3>
      <p class="muted">${escapeHtml(familyDoctorTeamName(item.teamId))} · ${escapeHtml(item.startDate || "")} 至 ${escapeHtml(item.endDate || "")}</p>
      <p>履约 ${Number(item.fulfillmentPercent || 0)}% · 续约 ${escapeHtml(item.renewalStatus || "not-due")} · 满意度 ${escapeHtml(item.satisfactionScore || "待回访")}</p>
      <p>下次服务：${escapeHtml(item.nextServiceAt || "待排期")}</p>
      <ol class="escort-order-progress" aria-label="家庭医生签约履约进度">
        <li class="is-ready"><strong>签约</strong><span>${escapeHtml(item.status || "active")}</span></li>
        <li class="${Number(item.fulfillmentPercent || 0) >= 50 ? "is-ready" : "is-waiting"}"><strong>履约</strong><span>${Number(item.fulfillmentPercent || 0)}%</span></li>
        <li class="${/renew|family|pending/i.test(String(item.renewalStatus || "")) ? "is-ready" : "is-waiting"}"><strong>续约</strong><span>${escapeHtml(item.renewalStatus || "not-due")}</span></li>
      </ol>
      <div class="visit-tags">${rows.slice(0, 4).map((row) => `<span class="tag">${escapeHtml(row.serviceItem || row.serviceType)} · ${escapeHtml(row.status || "")}</span>`).join("")}</div>
    </article>`;
  });
  contractCards.innerHTML = [...suggestionCards, ...contractRows, ...applicationCards].join("") || `<p class="muted">暂无家庭医生签约记录。选择服务包并提交申请后，机构审核状态会显示在这里。</p>`;
}

function bindFamilyDoctorApplication() {
  const form = document.querySelector("#family-doctor-contract-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    try {
      const application = await submitFamilyDoctorApplication({ ...data, residentId: currentResidentId });
      if (!Array.isArray(state.phase2FamilyDoctorApplications)) state.phase2FamilyDoctorApplications = [];
      state.phase2FamilyDoctorApplications = [application, ...state.phase2FamilyDoctorApplications.filter((item) => item.id !== application.id)];
      form.reset();
      renderCitizen(currentResidentId);
      showToast("家庭医生签约申请已提交，机构审核和履约状态会持续更新。");
    } catch (error) {
      showToast(error.message || "家庭医生签约申请提交失败，请检查登录状态。");
    } finally {
      submit.disabled = false;
    }
  });
}

async function submitFamilyDoctorApplication(payload) {
  if (API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/phase2/family-doctor-contracts/applications`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error(`家庭医生签约申请失败：${response.status}`);
    const result = await response.json();
    familyDoctorDashboard = await fetchCitizenFamilyDoctorDashboard();
    citizenMessages = await fetchCitizenMessages();
    serviceOrderCenter = await fetchCitizenServiceOrders();
    return result.application;
  }
  return {
    id: `p2fda-local-${crypto.randomUUID()}`,
    residentId: payload.residentId,
    packageId: payload.packageId,
    teamId: payload.teamId,
    applicationType: payload.applicationType || "new-contract",
    consentStatus: "resident-confirmed",
    status: "submitted",
    reviewStatus: "pending",
    desiredStartDate: todayOffset(1),
    submittedAt: new Date().toISOString(),
    lastAction: payload.note || "居民提交签约申请，等待机构审核。"
  };
}

function activeRegistrationSchedules() {
  const schedules = registrationDashboard?.schedules;
  if (Array.isArray(schedules) && schedules.length) return schedules;
  if (Array.isArray(state.registrationSchedules) && state.registrationSchedules.length) return state.registrationSchedules;
  return registrationSchedules;
}

function activeRegistrationOrders(residentId) {
  const apiOrders = registrationDashboard?.orders;
  const scopedApiOrders = Array.isArray(apiOrders) ? apiOrders.filter((item) => item.residentId === residentId) : [];
  return [...scopedApiOrders, ...getLocalRegistrationOrders(residentId)]
    .filter((item, index, rows) => rows.findIndex((row) => row.id === item.id) === index);
}

function formatRegistrationHospital(value) {
  return {
    "Dalian Central Hospital outpatient clinic demo": "大连市中心医院门诊",
    "Dalian Medical University Affiliated Hospital demo": "大连医科大学附属医院门诊",
    "Dalian Central Hospital": "大连市中心医院",
    "Dalian Medical University Hospital": "大连医科大学附属医院"
  }[value] || value || "待确认医院";
}

function formatRegistrationDepartment(value) {
  return {
    Cardiology: "心内科",
    Endocrinology: "内分泌科",
    Ophthalmology: "眼科"
  }[value] || value || "待确认科室";
}

function formatRegistrationDoctor(value) {
  return {
    "Doctor Wang": "王医生"
  }[value] || value || "待确认医生";
}

function formatRegistrationSource(value) {
  return {
    "HIS outpatient source pool": "HIS 门诊号源池",
    "citizen-registration-static": "居民端挂号",
    "citizen-registration-api": "居民端挂号接口"
  }[value] || value || "HIS 号源池";
}

function formatRegistrationTag(value) {
  return {
    "hypertension follow-up": "高血压随访",
    "escort supported": "支持陪诊"
  }[value] || value || "";
}

function registrationJourneySteps(order) {
  const paid = ["paid", "paid-demo", "waived"].includes(order.paymentStatus);
  const confirmed = ["confirmed", "confirmed-demo"].includes(order.hisConfirmationStatus);
  const cancelled = order.status === "cancelled";
  const steps = [
    { name: "号源锁定", done: ["confirmed", "released"].includes(order.scheduleLockStatus), detail: order.registrationNo || order.hisScheduleId || "待回执" },
    { name: "支付", done: paid, detail: formatRegistrationStatus(order.paymentStatus) },
    { name: "医院确认", done: confirmed, detail: formatRegistrationStatus(order.hisConfirmationStatus) },
    { name: "到院报到", done: order.checkInStatus === "checked-in-demo", detail: formatRegistrationStatus(order.checkInStatus) },
    { name: cancelled ? "退款" : "完诊", done: cancelled ? ["not-required", "refunded-demo"].includes(order.refundStatus) : order.status === "completed", detail: cancelled ? formatRegistrationStatus(order.refundStatus) : formatRegistrationStatus(order.status) }
  ];
  if (order.disruption) {
    steps.splice(1, 0, {
      name: "停诊改签",
      done: ["accepted", "cancelled", "withdrawn"].includes(order.disruption.status),
      detail: citizenRegistrationDisruptionLabel(order.disruption.status)
    });
  }
  return steps;
}

function localRegistrationAllowedActions(order) {
  if (order.disruption?.status === "pending-resident") return [];
  if (order.status === "cancelled" || ["completed", "closed"].includes(order.status)) return [];
  const actions = [];
  if (order.paymentStatus === "pending") actions.push("pay-demo");
  if (["paid", "paid-demo", "waived"].includes(order.paymentStatus) && ["confirmed", "confirmed-demo"].includes(order.hisConfirmationStatus) && order.checkInStatus !== "checked-in-demo") actions.push("check-in-demo");
  return actions;
}

function citizenRegistrationDisruptionLabel(value) {
  return {
    "doctor-unavailable": "医生停诊",
    "schedule-adjustment": "排班调整",
    "clinic-suspended": "门诊暂停",
    "pending-resident": "待我确认",
    accepted: "改签已确认",
    cancelled: "已选择退号",
    withdrawn: "医院已撤回",
    "supplement-pending": "待补缴差额",
    "partial-refund-pending": "待退差额",
    "not-required": "无需补退"
  }[value] || value || "待处理";
}

function renderRegistrationDisruptionPanel(order) {
  const disruption = order.disruption && typeof order.disruption === "object" ? order.disruption : null;
  if (!disruption) return "";
  const proposed = disruption.proposedSchedule || {};
  const actions = Array.isArray(order.disruptionActions) ? order.disruptionActions : [];
  const dueTime = Date.parse(disruption.acknowledgementDueAt || "");
  const overdue = disruption.status === "pending-resident" && Number.isFinite(dueTime) && dueTime < Date.now();
  const controls = disruption.status === "pending-resident"
    ? `<div class="registration-order-actions">
        ${actions.includes("accept") ? `<button type="button" class="small-button" data-registration-disruption-action="accept" data-registration-id="${escapeHtml(order.id)}">确认改签</button>` : ""}
        ${actions.includes("cancel") ? `<button type="button" class="small-button danger" data-registration-disruption-action="cancel" data-registration-id="${escapeHtml(order.id)}">不接受并退号</button>` : ""}
      </div>`
    : "";
  const feeSummary = disruption.status === "accepted"
    ? `<p>费用差额 ${Number(disruption.feeDifference || 0).toFixed(2)} 元 · ${citizenRegistrationDisruptionLabel(disruption.paymentAdjustmentStatus)} · 新号源待医院再次确认</p>`
    : "";
  return `<section class="registration-disruption-panel" data-registration-disruption-status="${escapeHtml(disruption.status)}">
    <strong>${escapeHtml(citizenRegistrationDisruptionLabel(disruption.type))} · ${escapeHtml(citizenRegistrationDisruptionLabel(disruption.status))}${overdue ? " · 已逾期" : ""}</strong>
    <p>${escapeHtml(disruption.reason || "医院排班发生变更")}</p>
    <p>原预约 ${escapeHtml(disruption.originalSchedule?.appointmentDate || "待确认")} ${escapeHtml(disruption.originalSchedule?.period || "")} · ${escapeHtml(disruption.originalSchedule?.doctor || "医生待确认")}</p>
    <p>建议改至 ${escapeHtml(proposed.appointmentDate || "待确认")} ${escapeHtml(proposed.period || "")} · ${escapeHtml(proposed.doctor || "医生待确认")} · 确认时限 ${escapeHtml(disruption.acknowledgementDueAt || "待医院确认")}</p>
    ${feeSummary}${controls}
  </section>`;
}

function citizenRegistrationWaitlistLabel(value) {
  return {
    waiting: "候补排队中",
    "offer-pending": "号源待我确认",
    accepted: "候补已转预约",
    declined: "已拒绝候补号源",
    withdrawn: "已退出候补",
    expired: "确认已超时"
  }[value] || value || "待处理";
}

function citizenRegistrationWaitlistTime(value) {
  const parsed = new Date(value || "");
  return Number.isNaN(parsed.getTime()) ? String(value || "待确认") : parsed.toLocaleString("zh-CN", { hour12: false });
}

function activeRegistrationWaitlistEntries(residentId) {
  return (registrationDashboard?.waitlist?.entries || []).filter((entry) => entry.residentId === residentId);
}

function renderRegistrationWaitlistCards(residentId) {
  const target = document.querySelector("#registration-waitlist-cards");
  const boundary = document.querySelector("#registration-waitlist-boundary");
  if (!target || !boundary) return;
  const entries = activeRegistrationWaitlistEntries(residentId);
  target.innerHTML = entries.map((entry) => {
    const schedule = entry.schedule || {};
    const actions = Array.isArray(entry.allowedActions) ? entry.allowedActions : [];
    const actionButtons = [
      actions.includes("accept") ? `<button type="button" class="small-button primary" data-registration-waitlist-action="accept" data-registration-waitlist-id="${escapeHtml(entry.id)}">确认候补号源</button>` : "",
      actions.includes("decline") ? `<button type="button" class="small-button danger" data-registration-waitlist-action="decline" data-registration-waitlist-id="${escapeHtml(entry.id)}">放弃本次号源</button>` : "",
      actions.includes("withdraw") ? `<button type="button" class="small-button" data-registration-waitlist-action="withdraw" data-registration-waitlist-id="${escapeHtml(entry.id)}">退出候补</button>` : ""
    ].filter(Boolean).join("");
    return `<article class="mini-card registration-waitlist-card" data-registration-waitlist-entry="${escapeHtml(entry.id)}">
      <h3>${escapeHtml(formatRegistrationHospital(schedule.hospital || entry.hospital))} · ${escapeHtml(formatRegistrationDepartment(schedule.department || entry.department))}</h3>
      <p class="muted">${escapeHtml(schedule.date || entry.appointmentDate || "待确认")} ${escapeHtml(schedule.period || entry.period || "")} · ${escapeHtml(formatRegistrationDoctor(schedule.doctor || entry.doctor))}</p>
      <p>${entry.position ? `当前第 ${Number(entry.position)} 位 · ` : ""}${escapeHtml(citizenRegistrationWaitlistLabel(entry.status))}${entry.offerExpiresAt ? ` · 确认截止 ${escapeHtml(citizenRegistrationWaitlistTime(entry.offerExpiresAt))}` : ""}</p>
      <p>通知方式 ${escapeHtml(entry.preferredChannel || "sms")} · 生产：否</p>
      ${actionButtons ? `<div class="registration-order-actions">${actionButtons}</div>` : ""}
    </article>`;
  }).join("") || `<p class="muted">暂无候补记录。满号时可在号源卡片加入候补队列。</p>`;
  boundary.textContent = registrationDashboard?.waitlist?.boundary || "候补补位仅作为本地流程证据，生产仍需 HIS 锁号和正式通知回执。";
  target.querySelectorAll("[data-registration-waitlist-action]").forEach((button) => {
    button.addEventListener("click", () => runRegistrationWaitlistAction(residentId, button.dataset.registrationWaitlistId, button.dataset.registrationWaitlistAction, button));
  });
}

function renderRegistrationJourneySummary(orders, waitlistEntries = []) {
  const target = document.querySelector("#registration-journey-timeline");
  if (!target) return;
  const metrics = [
    ["待支付", orders.filter((item) => item.paymentStatus === "pending").length, "居民处理"],
    ["医院已确认", orders.filter((item) => ["confirmed", "confirmed-demo"].includes(item.hisConfirmationStatus)).length, "HIS 回执"],
    ["已报到", orders.filter((item) => item.checkInStatus === "checked-in-demo").length, "到院闭环"],
    ["退款处理中", orders.filter((item) => item.refundStatus === "refund-pending").length, "机构处理"],
    ["待确认改签", orders.filter((item) => item.disruption?.status === "pending-resident").length, "停诊变更"],
    ["已确认改签", orders.filter((item) => item.disruption?.status === "accepted").length, "新号源"],
    ["候补排队", waitlistEntries.filter((item) => item.status === "waiting").length, "等待余号"],
    ["候补待确认", waitlistEntries.filter((item) => item.status === "offer-pending").length, "限时占号"]
  ];
  target.innerHTML = metrics.map(([name, value, detail]) => `<article><strong>${name}</strong><span>${value} 条 · ${detail}</span></article>`).join("");
}

function renderRegistration(residentId) {
  const form = document.querySelector("#registration-form");
  const scheduleCards = document.querySelector("#registration-schedule-cards");
  const orderCards = document.querySelector("#registration-order-cards");
  const summary = document.querySelector("#registration-summary");
  if (!form || !scheduleCards || !orderCards) return;
  const schedules = activeRegistrationSchedules();
  const availableSchedules = schedules.filter((item) => item.status !== "closed" && Number(item.remaining || 0) > 0);
  const waitlistEntries = activeRegistrationWaitlistEntries(residentId);
  const selected = form.elements.scheduleId.value;
  form.elements.scheduleId.innerHTML = availableSchedules.map((item) => `<option value="${item.id}">${formatRegistrationHospital(item.hospital)} · ${formatRegistrationDepartment(item.department)} · ${item.date} ${item.period} · ${item.remaining} 个号</option>`).join("");
  if (selected && availableSchedules.some((item) => item.id === selected)) form.elements.scheduleId.value = selected;
  form.querySelector("button[type='submit']").disabled = availableSchedules.length === 0;
  const orders = activeRegistrationOrders(residentId);
  scheduleCards.innerHTML = schedules.map((item) => {
    const tags = (item.tags || []).map(formatRegistrationTag).filter(Boolean);
    const activeWaitlist = waitlistEntries.find((entry) => entry.scheduleId === item.id && ["waiting", "offer-pending"].includes(entry.status));
    const activeOrder = orders.find((order) => order.scheduleId === item.id && !["cancelled", "completed", "closed"].includes(order.status));
    const full = item.status !== "closed" && Number(item.remaining || 0) <= 0;
    const waitlistControls = full && !activeWaitlist && !activeOrder ? `<div class="registration-order-actions" data-registration-waitlist-join-form>
      <select aria-label="候补通知方式" data-registration-waitlist-channel><option value="sms">短信优先</option><option value="in_app">站内信</option><option value="phone">电话联系</option></select>
      <button type="button" class="small-button" data-registration-waitlist-join="${escapeHtml(item.id)}">加入候补</button>
    </div>` : activeWaitlist ? `<p class="registration-waitlist-inline">${escapeHtml(citizenRegistrationWaitlistLabel(activeWaitlist.status))}${activeWaitlist.position ? ` · 第 ${Number(activeWaitlist.position)} 位` : ""}</p>` : activeOrder ? `<p class="registration-waitlist-inline">该号源已有预约订单</p>` : "";
    return `<article class="mini-card registration-schedule-card">
    <h3>${formatRegistrationHospital(item.hospital)} · ${formatRegistrationDepartment(item.department)}</h3>
    <p class="muted">${item.date} ${item.period} · ${formatRegistrationDoctor(item.doctor)} · ${formatRegistrationSource(item.source || item.sourceSystem)}</p>
    <p>HIS号源 ${item.hisScheduleId || item.id} · 余号 ${item.remaining} 个 · 挂号费 ${item.fee} 元</p>
    <p>支付 ${item.paymentRequired === false ? "免预付" : "待支付"} · 医保 ${item.insuranceSupported === false ? "不支持" : "电子凭证预核验"} · ${item.cancelBeforeHours} 小时前可取消</p>
    <div class="visit-tags">${tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
    ${waitlistControls}
  </article>`;
  }).join("");
  renderRegistrationJourneySummary(orders, waitlistEntries);
  renderRegistrationWaitlistCards(residentId);
  if (summary) {
    const openOrders = orders.filter((item) => canCancelRegistration(item)).length;
    const hisOrders = orders.filter((item) => item.hisVisitId || item.registrationNo).length;
    const insuranceReady = orders.filter((item) => item.insuranceStatus === "prechecked").length;
    summary.textContent = `${availableSchedules.length} 个可约号源 · ${waitlistEntries.filter((item) => ["waiting", "offer-pending"].includes(item.status)).length} 个候补 · ${orders.length} 个我的挂号 · HIS ${hisOrders} 个回执 · 医保 ${insuranceReady} 个预核验 · ${openOrders} 个可操作`;
  }
  orderCards.innerHTML = orders
    .sort((a, b) => String(a.appointmentDate || "").localeCompare(String(b.appointmentDate || "")))
    .map((item) => `<article class="mini-card registration-order-card" data-registration-order="${escapeHtml(item.id)}">
      <h3>${formatRegistrationHospital(item.hospital)} · ${formatRegistrationDepartment(item.department)}</h3>
      <p class="muted">${item.appointmentDate} ${item.period} · ${formatRegistrationDoctor(item.doctor)} · ${item.visitType === "internet" ? "互联网复诊" : "到院就诊"}</p>
      <p>${item.reason || "居民端预约"} · 挂号费 ${item.fee} 元 · 队列 ${item.queueNo || item.registrationNo || "待回执"}</p>
      <p>HIS ${item.hisVisitId || item.hisScheduleId || "待同步"} · 支付 ${formatRegistrationStatus(item.paymentStatus)} · 退费 ${formatRegistrationStatus(item.refundStatus)}</p>
      <p>医保 ${formatRegistrationStatus(item.insuranceStatus)} ${item.insurancePrecheckNo ? `· ${item.insurancePrecheckNo}` : ""} · 短信 ${formatRegistrationDeliveryStatus(item)}</p>
      ${renderRegistrationDisruptionPanel(item)}
      <div class="registration-journey-steps">${registrationJourneySteps(item).map((step) => `<span class="${step.done ? "done" : "pending"}"><strong>${step.name}</strong><small>${step.detail}</small></span>`).join("")}</div>
      <div class="registration-order-actions">
        <span class="status ${item.status === "cancelled" ? "danger" : item.paymentStatus === "pending" ? "warn" : ""}">${formatRegistrationStatus(item.status)}</span>
        ${(item.allowedActions || localRegistrationAllowedActions(item)).includes("pay-demo") ? `<button type="button" class="small-button" data-registration-journey-action="pay-demo" data-registration-id="${item.id}">模拟支付</button>` : ""}
        ${(item.allowedActions || localRegistrationAllowedActions(item)).includes("check-in-demo") ? `<button type="button" class="small-button" data-registration-journey-action="check-in-demo" data-registration-id="${item.id}">到院报到</button>` : ""}
        ${canCancelRegistration(item) ? `<button type="button" class="small-button" data-registration-cancel="${item.id}">取消预约</button>` : ""}
      </div>
    </article>`)
    .join("") || `<p class="muted">暂无挂号预约。提交后将生成 HIS 回执、支付、医保电子凭证和短信通知状态。</p>`;
  orderCards.querySelectorAll("[data-registration-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelRegistrationOrder(residentId, button.dataset.registrationCancel));
  });
  orderCards.querySelectorAll("[data-registration-journey-action]").forEach((button) => {
    button.addEventListener("click", () => runRegistrationJourneyAction(residentId, button.dataset.registrationId, button.dataset.registrationJourneyAction, button));
  });
  orderCards.querySelectorAll("[data-registration-disruption-action]").forEach((button) => {
    button.addEventListener("click", () => runRegistrationDisruptionAction(residentId, button.dataset.registrationId, button.dataset.registrationDisruptionAction, button));
  });
  scheduleCards.querySelectorAll("[data-registration-waitlist-join]").forEach((button) => {
    button.addEventListener("click", () => {
      const formRow = button.closest("[data-registration-waitlist-join-form]");
      joinRegistrationWaitlist(residentId, button.dataset.registrationWaitlistJoin, formRow?.querySelector("[data-registration-waitlist-channel]")?.value || "sms", button);
    });
  });
}

async function runRegistrationJourneyAction(residentId, orderId, action, button) {
  if (button) button.disabled = true;
  const notes = {
    "pay-demo": "Resident recorded isolated demo payment evidence; no real financial transaction occurred.",
    "check-in-demo": "Resident recorded local arrival evidence; production QR or HIS check-in remains required."
  };
  try {
    if (API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/registrations/orders/${encodeURIComponent(orderId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note: notes[action] || "Resident registration journey action." })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      registrationDashboard = payload.dashboard || await fetchCitizenRegistrationDashboard();
      citizenMessages = await fetchCitizenMessages();
      serviceOrderCenter = await fetchCitizenServiceOrders();
    } else {
      const order = getLocalRegistrationOrders(residentId).find((item) => item.id === orderId);
      if (!order) return;
      if (action === "pay-demo") {
        order.paymentStatus = "paid-demo";
        order.journeyStage = "payment-recorded-demo";
      }
      if (action === "check-in-demo") {
        order.checkInStatus = "checked-in-demo";
        order.journeyStage = "checked-in-demo";
      }
      order.productionReady = false;
      order.updatedAt = new Date().toISOString();
      localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
    }
    renderCitizen(residentId);
    showToast(action === "pay-demo" ? "支付演示凭据已记录，等待医院确认" : "到院报到已记录，等待医院接诊");
  } catch (error) {
    showToast(error.message || "挂号流程操作失败");
  } finally {
    if (button) button.disabled = false;
  }
}

async function runRegistrationDisruptionAction(residentId, orderId, action, button) {
  if (button) button.disabled = true;
  const notes = {
    accept: "居民确认接受医院提供的替代号源，并同意释放原号源。",
    cancel: "居民不接受替代号源，选择退号并进入原支付退款流程。"
  };
  try {
    if (!API_BASE) throw new Error("静态预览不提交停诊改签操作");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/registrations/orders/${encodeURIComponent(orderId)}/disruption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[action] || "居民处理停诊改签通知。" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    registrationDashboard = payload.dashboard || await fetchCitizenRegistrationDashboard();
    citizenMessages = await fetchCitizenMessages();
    serviceOrderCenter = await fetchCitizenServiceOrders();
    renderCitizen(residentId);
    showToast(action === "accept" ? "改签已确认，原号源已释放，新号源等待医院确认" : "已选择退号，退款状态和通知已同步");
  } catch (error) {
    showToast(error.message || "停诊改签处理失败");
  } finally {
    if (button) button.disabled = false;
  }
}

async function joinRegistrationWaitlist(residentId, scheduleId, preferredChannel, button) {
  if (button) button.disabled = true;
  try {
    if (!API_BASE) throw new Error("静态预览不提交预约候补");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/registrations/waitlist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        residentId,
        scheduleId,
        preferredChannel,
        visitType: "onsite",
        note: "居民在满号后申请进入预约候补队列"
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    registrationDashboard = payload.dashboard || await fetchCitizenRegistrationDashboard();
    citizenMessages = await fetchCitizenMessages();
    serviceOrderCenter = await fetchCitizenServiceOrders();
    renderCitizen(residentId);
    showToast(`已加入候补队列，当前第 ${Number(payload.entry?.position || 1)} 位`);
  } catch (error) {
    showToast(error.message || "加入候补失败");
  } finally {
    if (button) button.disabled = false;
  }
}

async function runRegistrationWaitlistAction(residentId, entryId, action, button) {
  if (button) button.disabled = true;
  const notes = {
    accept: "居民确认候补号源并生成预约订单",
    decline: "居民放弃本次候补号源，继续递补下一位",
    withdraw: "居民主动退出预约候补队列"
  };
  try {
    if (!API_BASE) throw new Error("静态预览不提交候补操作");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/registrations/waitlist/${encodeURIComponent(entryId)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[action] || "居民处理预约候补" })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    registrationDashboard = payload.dashboard || await fetchCitizenRegistrationDashboard();
    citizenMessages = await fetchCitizenMessages();
    serviceOrderCenter = await fetchCitizenServiceOrders();
    renderCitizen(residentId);
    const messages = {
      accept: "候补号源已确认，预约订单已经生成",
      decline: "已放弃本次号源，系统将递补下一位",
      withdraw: "已退出候补队列"
    };
    showToast(messages[action] || "候补状态已更新");
  } catch (error) {
    showToast(error.message || "候补操作失败");
  } finally {
    if (button) button.disabled = false;
  }
}

function bindRegistrationAppointment() {
  const form = document.querySelector("#registration-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector("button[type='submit']");
    const data = Object.fromEntries(new FormData(form));
    submit.disabled = true;
    try {
      let order;
      if (API_BASE) {
        const request = window.HealthCityAuth?.authFetch || fetch;
        const response = await request(`${API_BASE}/registrations/orders`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...data, residentId: currentResidentId })
        });
        if (!response.ok) throw new Error(`挂号预约失败：${response.status}`);
        order = await response.json();
        registrationDashboard = await fetchCitizenRegistrationDashboard();
        citizenMessages = await fetchCitizenMessages();
        serviceOrderCenter = await fetchCitizenServiceOrders();
      } else {
        order = createLocalRegistrationOrder(currentResidentId, data);
      }
      if (!API_BASE) persistLocalRegistrationOrder(currentResidentId, order);
      form.reset();
      renderCitizen(currentResidentId);
      showToast("挂号预约已确认，HIS、支付、医保和短信状态已更新");
    } catch (error) {
      const order = createLocalRegistrationOrder(currentResidentId, data);
      persistLocalRegistrationOrder(currentResidentId, order);
      form.reset();
      renderCitizen(currentResidentId);
      showToast(error.message || "已切换到本地挂号服务");
    } finally {
      submit.disabled = false;
    }
  });
}

function createLocalRegistrationOrder(residentId, data) {
  const schedules = activeRegistrationSchedules();
  const schedule = schedules.find((item) => item.id === data.scheduleId) || schedules[0] || {};
  const id = `reg-local-${crypto.randomUUID()}`;
  return {
    id,
    residentId,
    scheduleId: schedule.id,
    hisScheduleId: schedule.hisScheduleId || schedule.id,
    hisVisitId: `HIS-LOCAL-${id.slice(-8)}`,
    registrationNo: `REG-LOCAL-${id.slice(-6)}`,
    queueNo: `L${Math.floor(10 + Math.random() * 80)}`,
    hospital: schedule.hospital,
    hospitalCode: schedule.hospitalCode || "",
    department: schedule.department,
    departmentCode: schedule.departmentCode || "",
    doctor: schedule.doctor,
    doctorCode: schedule.doctorCode || "",
    appointmentDate: schedule.date,
    period: schedule.period,
    visitType: data.visitType,
    reason: data.reason,
    fee: Number(schedule.fee || 0),
    cancelBeforeHours: Number(schedule.cancelBeforeHours || 0),
    status: "confirmed",
    journeyStage: "slot-reserved-demo",
    hisConfirmationStatus: "pending-demo",
    checkInStatus: "not-checked-in",
    productionReady: false,
    paymentStatus: schedule.paymentRequired === false ? "waived" : "pending",
    paymentTradeNo: schedule.paymentRequired === false ? "" : `PAY-LOCAL-${id.slice(-8)}`,
    refundStatus: "none",
    insuranceStatus: schedule.insuranceSupported === false ? "not-supported" : "prechecked",
    insuranceCredentialNo: "MI-DEMO-CITIZEN",
    insurancePrecheckNo: schedule.insuranceSupported === false ? "" : `MI-PRE-LOCAL-${id.slice(-8)}`,
    notificationStatus: "queued",
    notificationDeliveries: [
      { event: "registration-submitted", channel: "in_app", status: "sent" },
      { event: "registration-submitted", channel: "sms", status: "queued" }
    ],
    source: schedule.sourceSystem || schedule.source || "citizen-registration-static",
    createdAt: new Date().toISOString()
  };
}

function persistLocalRegistrationOrder(residentId, order) {
  if (!citizenExtra[residentId]) citizenExtra[residentId] = {};
  if (!Array.isArray(citizenExtra[residentId].registrations)) citizenExtra[residentId].registrations = [];
  citizenExtra[residentId].registrations = [order, ...citizenExtra[residentId].registrations.filter((item) => item.id !== order.id)];
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
}

function getLocalRegistrationOrders(residentId) {
  return Array.isArray(citizenExtra[residentId]?.registrations) ? citizenExtra[residentId].registrations : [];
}

function getRegistrationOrders(residentId) {
  return activeRegistrationOrders(residentId);
}

function canCancelRegistration(order) {
  return order.disruption?.status !== "pending-resident" && !["cancelled", "completed", "closed"].includes(order.status);
}

async function cancelRegistrationOrder(residentId, orderId) {
  const apiOrder = (registrationDashboard?.orders || []).find((item) => item.id === orderId);
  if (apiOrder && API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/registrations/orders/${encodeURIComponent(orderId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "resident cancellation from citizen portal" })
      });
      if (!response.ok) throw new Error(`取消挂号失败：${response.status}`);
      registrationDashboard = await fetchCitizenRegistrationDashboard();
      citizenMessages = await fetchCitizenMessages();
      serviceOrderCenter = await fetchCitizenServiceOrders();
      renderCitizen(residentId);
      showToast("挂号预约已取消，退号、支付和短信状态已同步");
      return;
    } catch (error) {
      showToast(error.message || "取消挂号失败，请稍后重试");
      return;
    }
  }
  const order = getLocalRegistrationOrders(residentId).find((item) => item.id === orderId);
  if (!order) return;
  order.status = "cancelled";
  order.paymentStatus = order.paymentStatus === "paid" ? "refund-pending" : "closed";
  order.refundStatus = order.paymentStatus === "refund-pending" ? "refund-pending" : "not-required";
  order.notificationStatus = "queued";
  order.notificationDeliveries = [
    { event: "registration-cancelled", channel: "in_app", status: "sent" },
    { event: "registration-cancelled", channel: "sms", status: "queued" },
    ...(order.notificationDeliveries || [])
  ];
  order.cancelledAt = new Date().toISOString();
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  renderCitizen(residentId);
  showToast("挂号预约已取消，通知状态已更新");
}

function formatRegistrationDeliveryStatus(item) {
  const deliveries = Array.isArray(item.notificationDeliveries) ? item.notificationDeliveries : [];
  const sms = deliveries.find((delivery) => delivery.channel === "sms");
  return formatRegistrationStatus(sms?.status || item.notificationStatus);
}

function formatRegistrationStatus(value) {
  return {
    confirmed: "已确认",
    cancelled: "已取消",
    completed: "已完成",
    pending: "待处理",
    paid: "已支付",
    "paid-demo": "演示支付已记录",
    waived: "免预付",
    closed: "已关闭",
    "refund-pending": "待退款",
    "refunded-demo": "演示退款已完成",
    "not-required": "无需退款",
    "not-supported": "不支持",
    prechecked: "已预核验",
    "confirmed-demo": "演示确认",
    "pending-demo": "待医院确认",
    "checked-in-demo": "已演示报到",
    "not-checked-in": "未报到",
    queued: "待通知",
    sent: "已通知",
    none: "无",
    available: "可预约"
  }[value] || value || "待处理";
}

function renderPickups(residentId) {
  const pickups = (state.medicationPickups || []).filter((item) => item.residentId === residentId).sort(sortByDateDesc);
  document.querySelector("#pickup-cards").innerHTML = pickups
    .map((item) => `<article class="mini-card">
      <h3>${item.medication}</h3>
      <p class="muted">${item.dosage} · 每月 ${item.pickupDay} 日</p>
      <p>${item.pharmacy}</p>
      <p>下次取药：${item.nextPickup}</p>
      <p>闭环：${item.requestStatus || "待申请"} · ${item.institutionReview || "待机构确认"} · ${item.insuranceReview || "待医保审核"} · ${item.pharmacyStatus || item.status}</p>
      <p class="muted">${item.applyMode || "本人申请"} · ${item.deliveryMode || "社区药房自取"}</p>
      <span class="status ${item.status === "待取药" ? "warn" : ""}">${item.status} · ${item.coverage}</span>
    </article>`)
    .join("") || `<p class="muted">暂无固定取药计划。</p>`;
}

function renderSeniorServices(residentId) {
  const target = document.querySelector("#senior-service-cards");
  if (!target) return;
  const services = (state.seniorServices || []).filter((item) => item.residentId === residentId);
  target.innerHTML = services
    .map((item) => `<article class="mini-card">
      <h3>${item.service}</h3>
      <p class="muted">${item.channel} · ${item.contact}</p>
      <p>${item.nextAction}</p>
      <span class="status ${item.status === "待开通" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无适老服务配置。</p>`;
}

function renderDigitalCredentials(residentId) {
  const target = document.querySelector("#credential-cards");
  if (!target) return;
  const credentials = (state.digitalCredentials || []).filter((item) => item.residentId === residentId);
  target.innerHTML = credentials
    .map((item) => `<article class="mini-card">
      <h3>${item.type}</h3>
      <p class="muted">${item.provider} · ${item.lastVerified}</p>
      <p>${maskCredential(item.credentialNo)} · ${item.usage}</p>
      <span class="status ${item.status === "待核验" ? "warn" : ""}">${item.status}</span>
    </article>`)
    .join("") || `<p class="muted">暂无电子健康码或医保电子凭证。</p>`;
}

function maskCredential(value) {
  const text = String(value || "");
  return text.length > 6 ? `${text.slice(0, 3)}****${text.slice(-4)}` : text;
}

function renderAccessLogs(residentId) {
  const target = document.querySelector("#access-log-cards");
  if (!target) return;
  const residentLogs = (state.dataAccessLogs || []).filter((item) => item.residentId === residentId);
  const logs = residentLogs.slice(0, 6);
  const summary = document.querySelector("#access-review-summary");
  if (summary) summary.textContent = residentLogs.length
    ? `${residentLogs.length} 条记录 · 最近 ${residentLogs[0].at || "时间待核验"}`
    : "暂无访问记录，可主动发起授权与访问复核";
  target.innerHTML = logs
    .map((item) => `<article class="mini-card">
      <h3>${escapeHtml(item.actor)}</h3>
      <p class="muted">${escapeHtml(item.at)} · ${escapeHtml(item.purpose)}</p>
      <p>${escapeHtml(item.scope)}</p>
      <span class="status ${item.result === "拒绝" ? "danger" : ""}">${escapeHtml(item.result)}</span>
    </article>`)
    .join("") || `<p class="muted">暂无访问记录。</p>`;
}

function bindAccessReview() {
  const button = document.querySelector("#refresh-access-review");
  if (!button) return;
  button.addEventListener("click", async () => {
    if (!currentResidentId) return;
    if (!API_BASE) {
      renderAccessLogs(currentResidentId);
      showToast("静态预览已展示本机访问记录");
      return;
    }
    button.disabled = true;
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/access-reviews?residentId=${encodeURIComponent(currentResidentId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || "授权与访问复核失败");
      const review = window.CitizenRecordsV1
        ? window.CitizenRecordsV1.projectAccessReviewPayload(payload, currentResidentId)
        : payload;
      const otherLogs = (state.dataAccessLogs || []).filter((item) => item.residentId !== currentResidentId);
      state.dataAccessLogs = [...(review.accessLogs || []), ...otherLogs];
      const otherRecords = (state.personalRecords || []).filter((item) => item.residentId !== currentResidentId || item.category !== "authorizations");
      state.personalRecords = [...otherRecords, ...(review.authorizations || [])];
      renderCitizen(currentResidentId);
      showToast(`已复核 ${(review.authorizations || []).length} 项授权和 ${(review.accessLogs || []).length} 条访问记录`);
    } catch (error) {
      showToast(error.message || "授权与访问复核失败");
    } finally {
      button.disabled = false;
    }
  });
}

function assessRisk(resident) {
  const { systolic, glucose, bmi } = resident.metrics;
  if (systolic >= 160 || glucose >= 7 || bmi >= 30) return { level: "高危" };
  if (systolic >= 140 || glucose >= 6.1 || bmi >= 28) return { level: "中危" };
  return { level: "低危" };
}

function ageOf(birthDate) {
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

function todayOffset(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function byResident(items, residentId) {
  return items.filter((item) => item.residentId === residentId).sort((a, b) => b.date.localeCompare(a.date));
}

function latestDate(grouped) {
  const dates = Object.values(grouped).flat().map((item) => item.date).filter(Boolean).sort().reverse();
  return dates[0] || todayOffset(0);
}

function bindDialogs() {
  document.querySelector("#upload-record").addEventListener("click", () => {
    const form = document.querySelector("#upload-form");
    form.reset();
    form.elements.date.value = todayOffset(0);
    document.querySelector("#upload-dialog").showModal();
  });
  document.querySelector("#grant-auth").addEventListener("click", () => {
    const form = document.querySelector("#auth-form");
    form.reset();
    document.querySelector("#auth-dialog-title").textContent = "新增授权";
    form.elements.previousAuthorizationId.value = "";
    form.elements.expiresAt.min = todayOffset(1);
    form.elements.expiresAt.value = todayOffset(365);
    form.elements.source.value = "居民主动授权";
    renderAuthorizationScopePreview(form);
    document.querySelector("#auth-dialog").showModal();
  });
  document.querySelectorAll("#auth-form input[name='scopes']").forEach((input) => {
    input.addEventListener("change", () => renderAuthorizationScopePreview(input.form));
  });
  document.querySelectorAll("#health-record-export-form input[name='categories']").forEach((input) => {
    input.addEventListener("change", () => renderCitizenHealthRecordExportPreview(currentResidentId));
  });
  document.querySelector("#health-record-verify-file")?.addEventListener("change", (event) => {
    void verifyCitizenHealthRecordFile(event.currentTarget.files?.[0]);
  });
  document.querySelector("#health-record-export-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const categories = selectedCitizenHealthRecordExportCategories(event.currentTarget);
    if (!categories.length) {
      showToast("请至少选择一类健康资料");
      return;
    }
    const confirmButton = document.querySelector("#health-record-export-confirm");
    if (confirmButton) confirmButton.disabled = true;
    try {
      if (await exportCitizenHealthRecord(currentResidentId, categories)) event.currentTarget.closest("dialog").close();
    } catch (error) {
      showToast(error.message || "档案副本完整性校验失败，未生成文件");
    } finally {
      if (event.currentTarget.closest("dialog")?.open) renderCitizenHealthRecordExportPreview(currentResidentId);
    }
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelector("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      await addPersonalRecord({
        residentId: currentResidentId,
        category: data.category,
        date: data.date,
        name: data.name,
        result: data.result,
        source: "居民个人提供（待核验）",
        meta: {
          authority: "resident-upload",
          sourceTrust: "self-reported",
          dataQualityStatus: "unverified",
          originalAvailable: false,
          authorizationRequired: false
        }
      });
      activeVaultSection = data.category;
      form.closest("dialog").close();
      renderCitizen(currentResidentId);
      showToast("个人资料已保存并标记为待核验");
    } catch (error) {
      showToast(error.message || "保存失败，未写入本地替代记录");
    }
  });
  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    try {
      const authorization = window.CitizenRecordsV1.buildAuthorizationRecord({
        residentId: currentResidentId,
        granteeName: formData.get("granteeName"),
        granteeId: formData.get("granteeId"),
        granteeType: formData.get("granteeType"),
        previousAuthorizationId: formData.get("previousAuthorizationId"),
        purpose: formData.get("purpose"),
        scopes: formData.getAll("scopes"),
        expiresAt: formData.get("expiresAt"),
        source: formData.get("source")
      });
      await addPersonalRecord(authorization);
      activeVaultSection = "authorizations";
      form.closest("dialog").close();
      renderCitizen(currentResidentId);
      showToast("授权已保存，可随时在授权共享中撤销");
    } catch (error) {
      showToast(error.message || "授权保存失败");
    }
  });
}

async function addPersonalRecord(record) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const recordAction = window.CitizenRecordsV2
        ? window.CitizenRecordsV2.buildIdempotentAction({
          operation: record.category === "authorizations" ? "authorization-create" : "record-supplement",
          residentId: record.residentId,
          nonce: citizenCareRequestNonce(),
          payload: {}
        })
        : null;
      const response = await request(`${API_BASE}/personal-records`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(recordAction ? { "Idempotency-Key": recordAction.idempotencyKey } : {})
        },
        body: JSON.stringify(recordAction ? {
          ...record,
          idempotencyKey: recordAction.idempotencyKey,
          requestedAt: recordAction.requestedAt
        } : record)
      });
      if (response.ok) {
        const payload = await response.json();
        const saved = record.category === "authorizations"
          ? window.CitizenRecordsV2.projectAuthorizationCreateResponse(payload, record)
          : payload;
        if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
        state.personalRecords.push(saved);
        return saved;
      }
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || "平台未接受本次保存");
    } catch (error) {
      throw new Error(error.message || "平台连接失败，本次内容未保存");
    }
  }
  return addExtraRecord(record.residentId, record.category, record);
}

function addExtraRecord(residentId, category, record) {
  const savedRecord = { ...record, residentId, category, id: crypto.randomUUID(), createdBy: "resident", createdAt: new Date().toISOString() };
  if (!citizenExtra[residentId]) citizenExtra[residentId] = {};
  if (!citizenExtra[residentId][category]) citizenExtra[residentId][category] = [];
  citizenExtra[residentId][category].push(savedRecord);
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
  state.personalRecords.push(savedRecord);
  return savedRecord;
}

function loadCitizenExtra() {
  const saved = localStorage.getItem(CITIZEN_EXTRA_KEY);
  if (!saved) return {};
  try {
    const parsed = JSON.parse(saved);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    localStorage.removeItem(CITIZEN_EXTRA_KEY);
    return {};
  }
}

function sortByDateDesc(a, b) {
  return String(b.date || "").localeCompare(String(a.date || ""));
}

function renderSourceBadge(item) {
  const source = classifyDataSource(item);
  const trust = window.CitizenRecordsV1?.sourceTrust(item);
  const trustLabel = trust === "authoritative" ? "可信来源" : trust === "self-reported" ? "个人提供·待核验" : "来源待核验";
  return `<span class="source-badge source-${escapeHtml(source.key)}">来源：${escapeHtml(source.label)} · ${escapeHtml(trustLabel)}</span>`;
}

function renderAttachmentMeta(item) {
  if (!["imaging", "attachments"].includes(item.category) && !["影像资料", "附件资料"].includes(item.categoryLabel)) return "";
  const meta = item.meta || {};
  const accessMode = meta.accessMode || "原文需有效授权并记录访问日志";
  const reportDetail = meta.imageCloudStudyId
    ? `<span>${escapeHtml(meta.modality || "影像")} · ${escapeHtml(meta.bodyPart || "检查部位待补录")} · ${escapeHtml(meta.reportStatus || "报告状态待核验")} · ${escapeHtml(meta.qcStatus || "质控状态待核验")}</span>`
    : "";
  const controlledViewer = meta.imageCloudStudyId && meta.originalAvailable
    ? `<button type="button" class="controlled-viewer-button" data-view-imaging="${escapeHtml(meta.imageCloudStudyId)}" aria-label="受控调阅${escapeHtml(item.name)}">进入受控影像调阅</button>`
    : "";
  const secureAttachmentDetail = meta.recordKind === "secure-attachment"
    ? `<span>安全扫描：${escapeHtml(meta.scanStatus || "pending")} · ${escapeHtml(formatFileSize(meta.sizeBytes))} · ${meta.immutable ? "不可变留存" : "按策略留存"}${meta.legalHold ? " · 法律保全" : ""}</span>`
    : "";
  const secureDownload = meta.recordKind === "secure-attachment" && meta.originalAvailable
    ? `<button type="button" class="controlled-viewer-button" data-download-attachment="${escapeHtml(meta.attachmentId)}" aria-label="短时下载${escapeHtml(item.name)}">申请短时下载</button>`
    : "";
  return `<div class="attachment-meta">
    <p>${escapeHtml(meta.attachmentType || "资料")} · ${escapeHtml(meta.fileName || item.name)} · ${escapeHtml(accessMode)}</p>
    ${reportDetail}
    ${secureAttachmentDetail}
    ${controlledViewer}
    ${secureDownload}
  </div>`;
}

function formatFileSize(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "大小待核验";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderClinicalRecordMeta(item) {
  const meta = item.meta || {};
  if (meta.recordKind === "diagnostic-report") {
    const recognition = /recognized|已互认/i.test(meta.mutualRecognitionStatus || "") ? "已互认" : meta.mutualRecognitionStatus || "状态待核验";
    return `<div class="clinical-record-meta">
      <span><strong>报告号</strong>${escapeHtml(meta.reportNo || "待回传")}</span>
      <span><strong>报告状态</strong>${escapeHtml(recognition)}</span>
      <small>本页展示居民可读摘要；报告原文仍按授权和访问审计规则调阅。</small>
    </div>`;
  }
  if (meta.recordKind === "medication-service") {
    return `<div class="clinical-record-meta medication-service-meta">
      <span><strong>用法</strong>${escapeHtml(meta.dosage || "待药师确认")}</span>
      <span><strong>下次取药</strong>${escapeHtml(meta.nextPickup || "待安排")}</span>
      <span><strong>机构审核</strong>${escapeHtml(meta.institutionReview || "待确认")}</span>
      <span><strong>医保审核</strong>${escapeHtml(meta.insuranceReview || "待确认")}</span>
      <small>取药服务状态不替代医嘱；调整或停用药物请咨询医生或药师。</small>
    </div>`;
  }
  return "";
}

function controlledCredentialOptions() {
  const configured = Array.isArray(window.CITIZEN_CONTROLLED_ACCESS_ORIGINS)
    ? window.CITIZEN_CONTROLLED_ACCESS_ORIGINS
    : [];
  return {
    baseUrl: location.href,
    allowedOrigins: [...new Set([location.origin, ...configured])],
    allowHttpLocalhost: ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)
  };
}

async function openCitizenImagingViewer(studyId) {
  if (!studyId) return;
  const accessIntent = window.CitizenRecordsV2?.buildControlledAccessIntent({
    accessDecision: window.CitizenRecordsV2.evaluateProtectedAccess({
      actor: { residentId: currentResidentId },
      residentId: currentResidentId,
      scope: "imaging-report",
      purpose: "居民本人调阅影像"
    }),
    resourceId: studyId,
    resourceType: "imaging",
    purpose: "居民本人调阅影像",
    ttlSeconds: 300
  });
  if (!API_BASE) {
    showToast("静态预览仅展示影像报告摘要，正式调阅需登录区域平台");
    return;
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const query = accessIntent ? `?purpose=${encodeURIComponent(accessIntent.purpose)}&ttlSeconds=${accessIntent.ttlSeconds}&oneTime=true` : "";
    const response = await request(`${API_BASE}/imaging-cloud/studies/${encodeURIComponent(studyId)}/viewer${query}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "影像调阅凭据获取失败");
    const credential = window.CitizenRecordsV2.validateControlledCredential(payload, accessIntent, controlledCredentialOptions());
    window.location.assign(credential.url);
  } catch (error) {
    showToast(error.message || "影像调阅失败，请稍后重试");
  }
}

async function downloadCitizenAttachment(attachmentId) {
  if (!attachmentId) return;
  const accessIntent = window.CitizenRecordsV2?.buildControlledAccessIntent({
    accessDecision: window.CitizenRecordsV2.evaluateProtectedAccess({
      actor: { residentId: currentResidentId },
      residentId: currentResidentId,
      scope: "attachments",
      purpose: "居民本人下载健康附件"
    }),
    resourceId: attachmentId,
    resourceType: "attachment",
    purpose: "居民本人下载健康附件",
    ttlSeconds: 300
  });
  if (!API_BASE) {
    showToast("静态预览不签发附件下载凭据");
    return;
  }
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${API_BASE}/attachments/${encodeURIComponent(attachmentId)}/download-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(accessIntent)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || "附件短时下载凭据获取失败");
    const credential = window.CitizenRecordsV2.validateControlledCredential(payload, accessIntent, controlledCredentialOptions());
    window.location.assign(credential.url);
  } catch (error) {
    showToast(error.message || "附件下载失败，请稍后重试");
  }
}

function renderPhysicalExamMeta(item) {
  if (item.category !== "physical-exam" && !item.meta?.physicalExam) return "";
  const meta = item.meta || {};
  const findings = Array.isArray(meta.findings) ? meta.findings : [];
  const abnormal = findings.filter((finding) => finding.abnormal);
  const recommendations = Array.isArray(meta.recommendations) ? meta.recommendations : [];
  return `<div class="physical-exam-meta">
    <p><strong>报告号：</strong>${escapeHtml(meta.reportNo || meta.externalId || "已归档")} · ${meta.sourceType === "exam-center" ? "体检中心接入" : "医院接入"}</p>
    <p><strong>异常项：</strong>${abnormal.length ? abnormal.map((finding) => escapeHtml(`${finding.name} ${finding.value}${finding.unit || ""}`)).join("；") : "未标记明显异常"}</p>
    <p><strong>健康建议：</strong>${recommendations.length ? recommendations.map(escapeHtml).join("；") : "遵医嘱保持定期体检"}</p>
  </div>`;
}

function classifyDataSource(item) {
  const text = `${item.source || ""} ${item.provider || ""} ${item.createdBy || ""} ${item.categoryLabel || ""}`;
  if (/医保|insurance/i.test(text)) return { key: "insurance", label: "医保" };
  if (/社区|基层|家庭医生|卫生服务|随访/i.test(text)) return { key: "primary", label: "基层/家庭医生" };
  if (/公卫|疾控|疫苗|接种|公共卫生/i.test(text)) return { key: "public", label: "公卫" };
  if (/居民健康档案/i.test(text)) return { key: "platform", label: "区域健康档案" };
  if (/居民|个人|resident|citizen/i.test(text)) return { key: "self", label: "个人上传/授权" };
  if (/体检中心|医院|医科|中心医院|门诊|住院|HIS|EMR/i.test(text)) return { key: "hospital", label: "体检中心/医院" };
  return { key: "platform", label: "平台归集" };
}

function getPersonalRecords(residentId, category) {
  const fromState = Array.isArray(state.personalRecords) && state.personalRecords.length ? state.personalRecords : buildFallbackPersonalRecords();
  const stateItems = fromState.filter((item) => item.residentId === residentId && item.category === category);
  const stateIds = new Set(stateItems.map((item) => item.id).filter(Boolean));
  const seededPhysicalExams = category === "physical-exam" && window.PhysicalExaminationService
    ? window.PhysicalExaminationService.seedRecords().filter((item) => item.residentId === residentId && !stateIds.has(item.id))
    : [];
  const extra = (citizenExtra[residentId]?.[category] || []).filter((item) => !stateIds.has(item.id));
  const items = [...stateItems, ...seededPhysicalExams, ...extra.map((item) => ({ ...item, residentId, category }))];
  const projected = window.CitizenRecordsV1
    ? items.map((item) => window.CitizenRecordsV1.projectRecord(item)).filter(Boolean)
    : items;
  return projected.sort(sortByDateDesc);
}

function buildFallbackPersonalRecords() {
  return [
    ...emrRecords.map((item) => ({
      id: `fallback-emr-${item.residentId}-${item.date}-${item.diagnosis}`,
      residentId: item.residentId,
      category: "emr",
      date: item.date,
      name: item.diagnosis,
      result: item.summary,
      source: `${item.institution} · ${item.department}`,
      meta: { visitType: item.type, exams: item.exams, medications: item.medications }
    })),
    ...Object.entries(personalHealthData).flatMap(([category, items]) =>
      items.map((item) => ({
        id: `fallback-${category}-${item.residentId}-${item.date}-${item.name}`,
        residentId: item.residentId,
        category,
        date: item.date,
        name: item.name,
        result: item.result || item.usage,
        source: item.source,
        meta: {}
      }))
    )
  ];
}

function renderAuthorizationState(item) {
  const status = getAuthorizationStatus(item);
  const scopes = Array.isArray(item.meta?.scopes) ? item.meta.scopes.join("、") : item.result;
  return `<div class="authorization-detail">
    <div class="auth-state ${escapeHtml(status.className)}">${escapeHtml(status.label)}</div>
    <dl>
      <div><dt>用途</dt><dd>${escapeHtml(item.meta?.purpose || "历史授权，目的待补录")}</dd></div>
      <div><dt>对象标识</dt><dd>${escapeHtml(item.meta?.granteeId || item.meta?.granteeAccountId || item.meta?.granteeResidentId || "历史授权待补录")}</dd></div>
      <div><dt>范围</dt><dd>${escapeHtml(scopes || "范围待补录")}</dd></div>
      <div><dt>凭证版本</dt><dd>${escapeHtml(item.meta?.consentVersion || "legacy-record")}</dd></div>
    </dl>
  </div>`;
}

function getAuthorizationStatus(item) {
  const authorization = window.CitizenRecordsV1?.authorizationState(item);
  if (authorization) return { label: authorization.label, className: authorization.key };
  if (isRevoked(item)) return { label: `已撤销 · ${item.revokedAt || item.meta?.revokedAt || ""}`, className: "revoked" };
  if (item.date && item.date < todayOffset(0)) return { label: "已过期", className: "expired" };
  return { label: `有效期至 ${item.date || "长期"}`, className: "active" };
}

function isRevoked(item) {
  return Boolean(item.revokedAt || item.meta?.revokedAt || /revoked|withdrawn|cancelled|撤销/i.test(`${item.status || ""} ${item.meta?.status || ""}`));
}

function isAuthorizationActive(item) {
  const status = window.CitizenRecordsV1?.authorizationState(item);
  return status ? status.active : !isRevoked(item) && (!item.date || item.date >= todayOffset(0));
}

function getAuthorizationLifecycle(records = [], now = new Date(), warningDays = 30) {
  const scoped = Array.isArray(records) ? records.filter((item) => item?.category === "authorizations") : [];
  if (window.CitizenRecordsV2?.buildAuthorizationLifecycle) {
    return window.CitizenRecordsV2.buildAuthorizationLifecycle(scoped, now, warningDays);
  }
  return {
    items: scoped.map((item) => {
      const active = isAuthorizationActive(item);
      const expired = !active && !isRevoked(item) && item.date && item.date < todayOffset(0);
      return {
        id: item.id,
        residentId: item.residentId,
        granteeName: item.name,
        purpose: item.meta?.purpose || item.result,
        expiresAt: item.meta?.expiresAt || item.date || "",
        lifecycleKey: active ? "active" : expired ? "expired" : "inactive",
        active
      };
    }),
    active: scoped.filter((item) => isAuthorizationActive(item)).length,
    expiring: 0,
    expired: scoped.filter((item) => !isAuthorizationActive(item) && !isRevoked(item) && item.date && item.date < todayOffset(0)).length,
    incomplete: 0
  };
}

async function revokeAuthorization(id) {
  const recordIndex = state.personalRecords?.findIndex((item) => item.id === id) ?? -1;
  const record = recordIndex >= 0 ? state.personalRecords[recordIndex] : null;
  if (!record) return;
  if (!window.confirm(`确认撤销对“${record.name || "该对象"}”的授权？撤销后相关调阅应立即停止。`)) return;
  const reason = "居民通过居民端主动撤销";
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const action = window.CitizenRecordsV2.buildIdempotentAction({
        operation: "authorization-revoke",
        residentId: record.residentId,
        nonce: citizenCareRequestNonce(),
        payload: { resourceId: id, reason }
      });
      const response = await request(`${API_BASE}/authorizations/${encodeURIComponent(id)}/revoke`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": action.idempotencyKey
        },
        body: JSON.stringify(action)
      });
      if (response.ok) {
        const payload = await response.json();
        const updated = window.CitizenRecordsV2.projectAuthorizationRevocationResponse(payload, record, reason);
        state.personalRecords[recordIndex] = updated;
        renderCitizen(currentResidentId);
        showToast("授权已撤销，后续调阅将重新校验");
        return;
      }
      const error = await response.json().catch(() => ({}));
      showToast(error.message || "撤销失败，授权状态未改变");
      return;
    } catch (error) {
      showToast("撤销失败，授权状态未改变");
      return;
    }
  }
  record.status = "已撤销";
  record.revokedAt = new Date().toISOString();
  record.revokeReason = reason;
  record.meta = { ...(record.meta || {}), status: "revoked", revokedAt: record.revokedAt };
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  renderCitizen(currentResidentId);
  showToast("静态预览：授权已在本机撤销");
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
