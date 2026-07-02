const STORAGE_KEY = "chronic-care-platform-state";
const CITIZEN_EXTRA_KEY = "chronic-care-citizen-extra";
const LARGE_MODE_KEY = "chronic-care-large-mode";
const CLIENT_CHANNEL_KEY = "chronic-care-client-channel";
const API_BASE = location.protocol === "file:" ? "" : "/api";
const RESIDENT_TASK_CLOSED_STATUSES = new Set(["closed", "completed", "cancel-requested", "cancelled", "canceled"]);

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
const citizenServiceTabs = [
  { key: "health-record", label: "健康档案", status: "已实现", detail: "健康指标、标准档案、授权共享", title: "健康档案二级页面", actionLabel: "查看健康档案" },
  { key: "emr", label: "电子病历", status: "已实现", detail: "诊疗时间线、慢病和访问记录", title: "电子病历二级页面", actionLabel: "查看电子病历" },
  { key: "nursing", label: "护理", status: "已实现", detail: "互联网护理预约与追踪", title: "护理服务二级页面", actionLabel: "进入护理服务", actionHref: "./internet-nursing.html" },
  { key: "escort", label: "陪诊", status: "已实现", detail: "陪诊预约、合同、保障和回访", title: "陪诊服务二级页面", actionLabel: "提交陪诊预约" },
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

function mobileServiceBadgeLabel(tab, active) {
  return active ? "当前" : `${serviceNavigationMeta(tab).featureCount}项`;
}

const registrationSchedules = [
  { id: "reg-sch-cardio-am", hospital: "大连市中心医院", department: "心内科", doctor: "王医生", date: todayOffset(2), period: "上午", remaining: 6, fee: 18, cancelBeforeHours: 24, source: "医院号源池", tags: ["高血压复诊", "支持陪诊"] },
  { id: "reg-sch-endocrine-pm", hospital: "大连医科大学附属医院", department: "内分泌科", doctor: "赵医生", date: todayOffset(3), period: "下午", remaining: 4, fee: 22, cancelBeforeHours: 12, source: "医院号源池", tags: ["糖尿病复诊", "检查解读"] },
  { id: "reg-sch-community-am", hospital: "青泥洼桥社区卫生服务中心", department: "全科门诊", doctor: "刘医生", date: todayOffset(1), period: "上午", remaining: 12, fee: 8, cancelBeforeHours: 4, source: "基层预约池", tags: ["家庭医生", "慢病随访"] }
];

const citizenModuleInterfaces = [
  { module: "健康档案", status: "已实现", api: "/api/state, /api/personal-records", collections: "residents, accounts, diseases, followups, personalRecords", boundary: "生产需接入主索引、基层公卫和居民实名关系核验" },
  { module: "电子病历", status: "已实现", api: "/api/personal-records", collections: "personalRecords.emr, labs, medications, imaging, attachments", boundary: "生产需接入 EMR/LIS/PACS 和文档存储授权" },
  { module: "护理", status: "已实现", api: "/api/internet-nursing/dashboard, /api/internet-nursing/orders", collections: "internetNursingOrders, internetNursingNurses, taskMessages, citizenExtra.longTermCareAssessments", boundary: "生产需补齐护士资质、电子签名、定位轨迹、长期护理险和质控监管接入" },
  { module: "陪诊", status: "已实现", api: "/api/escort-services/dashboard, /api/escort-services/orders, /api/messages", collections: "escortServiceOrders, escortServiceProviders, escortWorkers, taskMessages", boundary: "生产需对接医院接诊回执、保险保障和陪诊服务主体监管" },
  { module: "挂号", status: "已实现", api: "/api/registrations/dashboard, /api/registrations/orders, /api/registrations/orders/:id/cancel", collections: "registrationSchedules, registrationOrders, taskMessages", boundary: "已具备 HIS/互联网医院号源、支付、退号、医保电子凭证和短信通知契约，生产需替换真实网关" },
  { module: "消息与待办", status: "已实现", api: "/api/messages, /api/tasks/:id/actions", collections: "taskMessages, service tasks, dataAccessLogs", boundary: "生产需接入真实短信、订阅消息、站内信送达回执和审计保全" }
];

const citizenGovernanceChecks = [
  { key: "identity", title: "实名与家庭关系", interface: "/api/auth/phone-login", ready: "演示可用", production: "接入真实短信、实名核验和监护人关系校验后生产上线" },
  { key: "authorization", title: "授权共享与撤销", interface: "/api/personal-records", ready: "已实现", production: "撤销后需要后端强制拦截、访问复核和审计保全联动" },
  { key: "emr", title: "电子病历来源", interface: "EMR/LIS/PACS -> /api/personal-records", ready: "演示归集", production: "接入院内 EMR、LIS、PACS、对象存储和原文调阅授权" },
  { key: "access", title: "访问日志复核", interface: "dataAccessLogs, /api/messages", ready: "已展示", production: "接入统一审计链、SIEM 或审计导出路径" },
  { key: "notification", title: "消息触达回执", interface: "/api/messages, /api/tasks/:id/actions", ready: "已实现", production: "接入短信、订阅消息、APP 推送和送达回执" }
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
    launchChecklist: [
      { label: "实名登录", state: "已就绪", note: "手机号验证码进入居民端" },
      { label: "服务入口", state: "已就绪", note: "按二级页面生成可分享链接" },
      { label: "订阅提醒", state: "上线前确认", note: "需绑定平台消息模板" }
    ]
  },
  {
    key: "app",
    label: "APP",
    status: "可上线配置",
    entry: "citizen.html?client=app&page=health-record",
    audience: "Android / iOS 应用壳、桌面图标、离线缓存",
    capabilities: ["PWA 安装入口", "离线健康档案壳", "大字模式", "系统推送预留"],
    readiness: ["应用签名与包名", "应用市场隐私合规", "推送证书", "崩溃监控与版本升级"],
    nextAction: "打包 APP 上架材料",
    launchChecklist: [
      { label: "安装入口", state: "已就绪", note: "PWA 壳支持浏览器安装" },
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
  { service: "health-record", name: "健康档案归集", status: "已实现", evidence: "标准档案、检查检验、用药、过敏、疫苗、影像和附件统一索引", mobile: "档案标签横向滑动" },
  { service: "health-record", name: "上传资料", status: "已实现", evidence: "居民可补充报告、图片或自测记录", mobile: "弹窗在窄屏占满可用宽度" },
  { service: "health-record", name: "授权共享与撤销", status: "已实现", evidence: "可新增授权并记录授权对象、范围和来源", mobile: "表单字段单列录入" },
  { service: "emr", name: "电子病历时间线", status: "已实现", evidence: "门诊、随访、检查和用药摘要按时间展示", mobile: "时间线与详情卡片单列显示" },
  { service: "emr", name: "慢病管理", status: "已实现", evidence: "展示慢病登记、随访提醒和院后反馈", mobile: "表单控件触控高度优化" },
  { service: "emr", name: "转诊和家庭医生服务", status: "已实现", evidence: "居民端可查看转诊指引和签约服务记录", mobile: "服务卡片单列呈现" },
  { service: "emr", name: "出生健康与妇幼接续", status: "已实现", evidence: "居民授权范围内查看出生证明和妇幼连续服务", mobile: "信息卡片按宽度自适应" },
  { service: "emr", name: "固定取药和电子凭证", status: "已实现", evidence: "固定取药、数字凭证和访问记录进入个人视角", mobile: "状态标签不挤压正文" },
  { service: "nursing", name: "互联网护理预约", status: "已实现", evidence: "居民可进入护理服务页提交上门护理申请", mobile: "以独立护理页承载完整预约流程" },
  { service: "nursing", name: "护理订单追踪", status: "已实现", evidence: "复用机构派单、护士接单、服务记录和质控回访", mobile: "订单状态卡片移动端可读" },
  { service: "nursing", name: "长期照护评估", status: "已实现", evidence: "居民端可录入失能风险、照护人、长护险和民政预核验并生成照护建议", mobile: "护理标签内表单单列触控，评估结果即时更新" },
  { service: "escort", name: "助医陪诊预约", status: "已实现", evidence: "可为本人或家庭成员提交陪诊预约", mobile: "预约表单在手机端单列输入" },
  { service: "escort", name: "陪诊合同、保险和回访", status: "已实现", evidence: "订单同步服务主体、保障类型、保险和质控状态", mobile: "订单卡片跟随陪诊标签展示" },
  { service: "registration", name: "医院号源查询", status: "已实现", evidence: "居民端展示医院号源池，按医院、科室、医生、日期、余号和费用呈现", mobile: "号源卡片单列显示，适合手机端选择" },
  { service: "registration", name: "预约挂号确认", status: "已实现", evidence: "可提交挂号预约，生成待支付/待医保核验状态并展示取消规则", mobile: "表单单列录入，订单卡可直接取消" },
  { service: "registration", name: "就医协同底座", status: "已实现", evidence: "陪诊、转诊和电子病历归集可支撑挂号上线", mobile: "作为挂号标签内已实现底座展示" }
];

let activeServiceTab = serviceTabFromRoute() || "health-record";
let activeClientChannel = clientChannelFromRoute() || localStorage.getItem(CLIENT_CHANNEL_KEY) || "mini-program";
let state = fallbackState;
let citizenExtra = loadCitizenExtra();
let escortDashboard = null;
let registrationDashboard = null;
let citizenMessages = [];
let currentResidentId;
let currentAccountId;

document.addEventListener("DOMContentLoaded", async () => {
  state = await loadState();
  escortDashboard = await fetchCitizenEscortDashboard();
  registrationDashboard = await fetchCitizenRegistrationDashboard();
  citizenMessages = await fetchCitizenMessages();
  ensureAccounts();
  populateAccounts();
  bindLargeMode();
  bindServiceTabs();
  renderModuleInterfaces();
  renderDataGovernance();
  renderClientChannels();
  window.addEventListener("popstate", () => setServiceTab(serviceTabFromRoute() || "health-record", { syncUrl: false }));
  window.addEventListener("hashchange", () => setServiceTab(serviceTabFromRoute() || "health-record", { syncUrl: false }));
  window.addEventListener("message", (event) => {
    if (event.origin !== location.origin || event.data?.type !== "set-service-tab") return;
    setServiceTab(event.data.service, { pushState: true, scrollToPane: true, notifyPreview: false });
  });
  document.querySelector("#account-select").addEventListener("change", (event) => {
    currentAccountId = event.target.value;
    const account = getCurrentAccount();
    renderAccount(account);
    renderCitizen(account.members[0]?.residentId);
  });
  bindDialogs();
  bindFollowupFeedback();
  bindResidentCheckin();
  bindEscortAppointment();
  bindRegistrationAppointment();
  bindLongTermCareAssessment();
  bindResidentTaskActions();
  bindLifecycleActionButtons();
  bindCitizenMessageReceipts();
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
      <small class="service-tab-interface">${meta.interfaceLabel}</small>
      <small class="service-tab-boundary">待生产化：${meta.productionBoundary}</small>
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
    return `<a href="${citizenPageHref(item.key)}" data-mobile-service-tab="${item.key}" data-mobile-service-state="${item.status}" data-mobile-service-count="${meta.featureCount}" title="${item.label}：${meta.featureCount}项已实现能力；接口：${meta.interfaceLabel}；待生产化：${meta.productionBoundary}" aria-label="${item.label}，${item.status}，${meta.featureCount}项已实现能力，接口：${meta.interfaceLabel}，待生产化：${meta.productionBoundary}" aria-current="${active ? "page" : "false"}">
    <span>${item.label}</span>
    <small class="ready service-count-badge">${mobileServiceBadgeLabel(item, active)}</small>
  </a>`;
  }).join("");
  target.querySelectorAll("[data-mobile-service-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setServiceTab(link.dataset.mobileServiceTab, { pushState: true, scrollToPane: true });
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
      return `<a href="${citizenPageHref(item.key)}" role="listitem" data-mobile-rail-tab="${item.key}" data-mobile-rail-index="${index + 1}" aria-current="${activeItem ? "page" : "false"}" aria-label="${item.label} - ${activeItem ? "current secondary page" : `${meta.featureCount} launched features`}">
        <span>${item.label}</span>
        <small>${activeItem ? "当前" : `${meta.featureCount}项`}</small>
      </a>`;
    }).join("")}
  </div>`;
  target.querySelectorAll("[data-mobile-rail-tab]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      setServiceTab(link.dataset.mobileRailTab, { pushState: true, scrollToPane: true });
    });
  });
  const activeLink = target.querySelector('[data-mobile-rail-tab][aria-current="page"]');
  activeLink?.scrollIntoView?.({ block: "nearest", inline: "center" });
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
  const activeAuthorizations = authorizations.filter((item) => !isRevoked(item));
  const emrSources = residentId ? new Set(getPersonalRecords(residentId, "emr").map((item) => classifyDataSource(item).label)) : new Set();
  const accessLogs = residentId ? (state.dataAccessLogs || []).filter((item) => item.residentId === residentId) : [];
  const residentMessages = residentId ? citizenMessages.filter((item) => !item.residentId || item.residentId === residentId) : [];
  const metrics = {
    identity: currentAccountId ? "居民账号已绑定" : "待登录",
    authorization: `${activeAuthorizations.length}/${authorizations.length || 0} 条有效授权`,
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

function renderClientChannels() {
  const switcher = document.querySelector("#client-channel-switch");
  const detail = document.querySelector("#client-channel-detail");
  if (!switcher || !detail) return;
  const active = getActiveClientChannel();
  const currentEntry = clientChannelEntry(active.key, activeServiceTab);
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
    </div>
    <div class="client-channel-entry">
      <code>${currentEntry}</code>
      <div class="client-channel-actions">
        <a class="client-channel-action primary" href="./${currentEntry}">打开入口</a>
        <button type="button" class="client-channel-action" data-copy-client-entry="${currentEntry}">复制入口</button>
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

function clientChannelEntry(channelKey, serviceKey) {
  const params = new URLSearchParams();
  params.set("client", channelKey);
  params.set("page", serviceKey);
  return `citizen.html?${params.toString()}#service-${serviceKey}`;
}

async function copyClientEntry(entry) {
  const url = new URL(entry, location.href).href;
  try {
    if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
    await navigator.clipboard.writeText(url);
    showToast("入口链接已复制");
  } catch (error) {
    const helper = document.createElement("textarea");
    helper.value = url;
    helper.setAttribute("readonly", "");
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    document.execCommand("copy");
    helper.remove();
    showToast("入口链接已复制");
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
  if (options.scrollToPane) {
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
  renderServiceSummary();
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
    pane.hidden = !launched || pane.dataset.servicePane !== activeServiceTab;
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
  target.innerHTML = `<div class="service-summary-copy">
    <span>当前二级页面 · ${channel.label}</span>
    <strong>${active.label}</strong>
    <small>${active.title} · ${active.detail}</small>
    <div class="service-summary-meta">
      <span>${meta.featureCount} 项已实现能力</span>
      <span>接口：${meta.interfaceLabel}</span>
      <span>待生产化：${meta.productionBoundary}</span>
    </div>
  </div>
  <div class="service-summary-actions">
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
    getServicePageTarget(event.currentTarget.dataset.serviceAction)?.scrollIntoView({ block: "start", behavior: "smooth" });
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
      if (response.ok) return await response.json();
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
    integration: { status: "static-preview" }
  };
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
  renderReminderCenter(resident.id);
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
  renderRegistration(resident.id);
  renderLongTermCareAssessment(resident.id);
  renderPickups(resident.id);
  renderSeniorServices(resident.id);
  renderDigitalCredentials(resident.id);
  renderAccessLogs(resident.id);
  renderDataGovernance(resident.id);
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
      service: "慢病筛查",
      title: `${item.taskName}筛查`,
      detail: `${item.due} · ${item.institution} · ${item.nextStep}`,
      status: item.status,
      due: item.due,
      page: "health-record",
      action: "查看档案"
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
    ...getPersonalRecords(residentId, "authorizations").filter((item) => !isRevoked(item) && item.date <= todayOffset(30)).map((item) => ({
      taskId: `digitalCredentials:${item.id}`,
      collection: "digitalCredentials",
      service: "授权管理",
      title: `${item.name}授权`,
      detail: `${item.result} · 有效期至 ${item.date}`,
      status: item.date < todayOffset(0) ? "已过期" : "即将到期",
      due: item.date,
      page: "health-record",
      action: "管理授权",
      priority: item.date < todayOffset(0) ? "high" : "normal"
    }))
  ].sort((a, b) => String(a.due || "9999-12-31").localeCompare(String(b.due || "9999-12-31")));
}

function renderServiceTaskButtons(item) {
  const buttons = [];
  if (shouldShowResidentConfirm(item)) buttons.push(["resident-confirm", "确认"]);
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

function renderVault(resident, diseases, followups, records) {
  const grouped = collectVaultData(resident, diseases, followups, records);
  const completeCount = vaultSections.filter((section) => section.key === "standard" || grouped[section.key]?.length).length;
  const score = Math.round((completeCount / vaultSections.length) * 100);
  document.querySelector("#completeness-score").textContent = `${score}%`;
  document.querySelector("#completeness-bar").style.width = `${score}%`;
  document.querySelector("#vault-updated").textContent = `最近更新：${latestDate(grouped)}`;

  document.querySelector("#vault-tabs").innerHTML = vaultSections
    .map((section) => {
      const count = grouped[section.key]?.length || 0;
      const active = section.key === activeVaultSection ? "active" : "";
      return `<button class="${active}" data-vault="${section.key}">${section.label}<span>${count}</span></button>`;
    })
    .join("");

  document.querySelectorAll("[data-vault]").forEach((button) => {
    button.addEventListener("click", () => {
      activeVaultSection = button.dataset.vault;
      renderVault(resident, diseases, followups, records);
    });
  });

  if (activeVaultSection === "standard") {
    document.querySelector("#vault-content").innerHTML = renderStandardArchive(resident.id);
    return;
  }

  const activeItems = grouped[activeVaultSection] || [];
  document.querySelector("#vault-content").innerHTML = activeItems
    .map((item) => `<article class="vault-item">
      <div>
        <strong>${item.name}</strong>
        <p>${item.result}</p>
        ${item.categoryLabel ? `<p class="muted">${item.categoryLabel}${item.related ? ` · ${item.related}` : ""}</p>` : ""}
        ${renderSourceBadge(item)}
        ${renderAttachmentMeta(item)}
        ${activeVaultSection === "authorizations" ? renderAuthorizationState(item) : ""}
      </div>
      <span>${item.date}<br>${item.source}</span>
      ${activeVaultSection === "authorizations" && !isRevoked(item) ? `<button class="revoke-button" data-revoke-auth="${item.id}">撤销</button>` : ""}
    </article>`)
    .join("") || `<p class="muted">当前分类暂无数据，可通过区域平台、医院电子病历或个人上传更新。</p>`;
  document.querySelectorAll("[data-revoke-auth]").forEach((button) => {
    button.addEventListener("click", () => revokeAuthorization(button.dataset.revokeAuth));
  });
}

function collectVaultData(resident, diseases, followups, records) {
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
    timeline: buildHealthTimeline(archive, records, labs, medications, allergies, vaccines, admissions, imaging, attachments),
    standard: buildStandardArchiveItems(resident.id),
    archive,
    emr: records.map((item) => ({ ...item, categoryLabel: "电子病历", related: relatedArchiveSummary(diseases, followups) })),
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

function buildHealthTimeline(archive, records, labs, medications, allergies, vaccines, admissions, imaging = [], attachments = []) {
  return [
    ...archive,
    ...records.map((item) => ({ ...item, categoryLabel: "电子病历" })),
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
      <div class="visit-date">${record.date}<br><span class="tag">${record.meta?.visitType || "病历"}</span></div>
      <div class="visit-body">
        <h3>${record.source}</h3>
        <p class="muted">${record.name}</p>
        <p>${record.result}</p>
        <p class="muted">关联健康档案：${archiveLink}</p>
        ${renderSourceBadge(record)}
        <details class="record-detail">
          <summary>查看诊疗详情、医嘱和来源</summary>
          <dl>
            <div><dt>诊疗来源</dt><dd>${record.source || "居民健康信息库"}</dd></div>
            <div><dt>记录类型</dt><dd>${record.meta?.visitType || record.category || "电子病历"}</dd></div>
            <div><dt>诊断/标题</dt><dd>${record.name}</dd></div>
            <div><dt>医嘱摘要</dt><dd>${record.result}</dd></div>
          </dl>
        </details>
        <div class="visit-tags">
          ${(record.meta?.exams || []).map((item) => `<span class="tag">${item}</span>`).join("")}
          ${(record.meta?.medications || []).map((item) => `<span class="tag">${item}</span>`).join("")}
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

function bindResidentCheckin() {
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
  if (!container) return;
  const certificates = (state.birthCertificates || []).filter((item) => item.maternalResidentId === residentId || item.residentId === residentId);
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
  cards.innerHTML = orders
    .sort((a, b) => String(a.appointmentAt || a.due || "").localeCompare(String(b.appointmentAt || b.due || "")))
    .map((item) => `<article class="mini-card escort-order-card">
      <h3>${formatEscortHospital(item.hospital)} · ${formatEscortDepartment(item.department)}</h3>
      <p class="muted">${item.appointmentAt || item.due || "日期待确认"} · ${item.providerName ? formatEscortProviderName(item) : providerName(item.providerId)}</p>
      <p>${formatEscortItems(item.serviceItems)} · ${formatSubsidy(item.subsidyType)} · 预估 ${item.feeEstimate || 0} 元</p>
      <p>合同 ${formatEscortStatus(item.contractStatus)} · 保障 ${formatEscortStatus(item.insuranceStatus)} · 回访 ${formatEscortStatus(item.qualityReview)}</p>
      <p>${formatEscortHospitalHandoff(item)}</p>
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

function bindEscortAppointment() {
  const form = document.querySelector("#escort-appointment-form");
  if (!form) return;
  form.elements.registrationOrderId?.addEventListener("change", () => {
    applyLinkedRegistrationToEscortForm(form, form.elements.registrationOrderId.value);
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
      serviceItems: data.getAll("serviceItems").length ? data.getAll("serviceItems") : ["registration", "exam escort"],
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
        if (!response.ok) throw new Error(`escort appointment failed: ${response.status}`);
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
    pending: "待确认",
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

function renderRegistration(residentId) {
  const form = document.querySelector("#registration-form");
  const scheduleCards = document.querySelector("#registration-schedule-cards");
  const orderCards = document.querySelector("#registration-order-cards");
  const summary = document.querySelector("#registration-summary");
  if (!form || !scheduleCards || !orderCards) return;
  const schedules = activeRegistrationSchedules();
  const selected = form.elements.scheduleId.value;
  form.elements.scheduleId.innerHTML = schedules.map((item) => `<option value="${item.id}">${item.hospital} · ${item.department} · ${item.date} ${item.period} · ${item.remaining} 个号</option>`).join("");
  if (selected && schedules.some((item) => item.id === selected)) form.elements.scheduleId.value = selected;
  scheduleCards.innerHTML = schedules.map((item) => `<article class="mini-card registration-schedule-card">
    <h3>${item.hospital} · ${item.department}</h3>
    <p class="muted">${item.date} ${item.period} · ${item.doctor} · ${item.source || item.sourceSystem || "HIS号源池"}</p>
    <p>HIS号源 ${item.hisScheduleId || item.id} · 余号 ${item.remaining} 个 · 挂号费 ${item.fee} 元</p>
    <p>支付 ${item.paymentRequired === false ? "免预付" : "待支付"} · 医保 ${item.insuranceSupported === false ? "不支持" : "电子凭证预核验"} · ${item.cancelBeforeHours} 小时前可取消</p>
    <div class="visit-tags">${(item.tags || []).map((tag) => `<span class="tag">${tag}</span>`).join("")}</div>
  </article>`).join("");
  const orders = activeRegistrationOrders(residentId);
  if (summary) {
    const openOrders = orders.filter((item) => canCancelRegistration(item)).length;
    const hisOrders = orders.filter((item) => item.hisVisitId || item.registrationNo).length;
    const insuranceReady = orders.filter((item) => item.insuranceStatus === "prechecked").length;
    summary.textContent = `${schedules.length} 个可约号源 · ${orders.length} 个我的挂号 · HIS ${hisOrders} 个回执 · 医保 ${insuranceReady} 个预核验 · ${openOrders} 个可操作`;
  }
  orderCards.innerHTML = orders
    .sort((a, b) => String(a.appointmentDate || "").localeCompare(String(b.appointmentDate || "")))
    .map((item) => `<article class="mini-card registration-order-card">
      <h3>${item.hospital} · ${item.department}</h3>
      <p class="muted">${item.appointmentDate} ${item.period} · ${item.doctor} · ${item.visitType === "internet" ? "互联网复诊" : "到院就诊"}</p>
      <p>${item.reason || "居民端预约"} · 挂号费 ${item.fee} 元 · 队列 ${item.queueNo || item.registrationNo || "待回执"}</p>
      <p>HIS ${item.hisVisitId || item.hisScheduleId || "待同步"} · 支付 ${formatRegistrationStatus(item.paymentStatus)} · 退费 ${formatRegistrationStatus(item.refundStatus)}</p>
      <p>医保 ${formatRegistrationStatus(item.insuranceStatus)} ${item.insurancePrecheckNo ? `· ${item.insurancePrecheckNo}` : ""} · 短信 ${formatRegistrationDeliveryStatus(item)}</p>
      <div class="registration-order-actions">
        <span class="status ${item.status === "cancelled" ? "danger" : item.paymentStatus === "pending" ? "warn" : ""}">${formatRegistrationStatus(item.status)}</span>
        ${canCancelRegistration(item) ? `<button type="button" class="small-button" data-registration-cancel="${item.id}">取消预约</button>` : ""}
      </div>
    </article>`)
    .join("") || `<p class="muted">暂无挂号预约。提交后将生成 HIS 回执、支付、医保电子凭证和短信通知状态。</p>`;
  orderCards.querySelectorAll("[data-registration-cancel]").forEach((button) => {
    button.addEventListener("click", () => cancelRegistrationOrder(residentId, button.dataset.registrationCancel));
  });
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
  return !["cancelled", "completed", "closed"].includes(order.status);
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
    waived: "免预付",
    closed: "已关闭",
    "refund-pending": "待退款",
    "not-required": "无需退款",
    "not-supported": "不支持",
    prechecked: "已预核验",
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
  const logs = (state.dataAccessLogs || []).filter((item) => item.residentId === residentId).slice(0, 4);
  target.innerHTML = logs
    .map((item) => `<article class="mini-card">
      <h3>${item.actor}</h3>
      <p class="muted">${item.at} · ${item.purpose}</p>
      <p>${item.scope}</p>
      <span class="status ${item.result === "拒绝" ? "danger" : ""}">${item.result}</span>
    </article>`)
    .join("") || `<p class="muted">暂无访问记录。</p>`;
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
    form.elements.date.value = todayOffset(365);
    form.elements.source.value = "居民主动授权";
    document.querySelector("#auth-dialog").showModal();
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });
  document.querySelector("#upload-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await addPersonalRecord({
      residentId: currentResidentId,
      category: data.category,
      date: data.date,
      name: data.name,
      result: data.result,
      source: data.source
    });
    activeVaultSection = data.category;
    event.currentTarget.closest("dialog").close();
    renderCitizen(currentResidentId);
    showToast("健康资料已纳入个人健康信息库");
  });
  document.querySelector("#auth-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await addPersonalRecord({
      residentId: currentResidentId,
      category: "authorizations",
      date: data.date,
      name: data.name,
      result: data.result,
      source: data.source
    });
    activeVaultSection = "authorizations";
    event.currentTarget.closest("dialog").close();
    renderCitizen(currentResidentId);
    showToast("授权记录已保存");
  });
}

async function addPersonalRecord(record) {
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/personal-records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(record)
      });
      if (response.ok) {
        const saved = await response.json();
        if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
        state.personalRecords.push(saved);
        return;
      }
    } catch (error) {
      // Fall back to browser storage below.
    }
  }
    addExtraRecord(record.residentId, record.category, record);
}

function addExtraRecord(residentId, category, record) {
  const savedRecord = { ...record, residentId, category, id: crypto.randomUUID(), createdBy: "resident", createdAt: new Date().toISOString() };
  if (!citizenExtra[residentId]) citizenExtra[residentId] = {};
  if (!citizenExtra[residentId][category]) citizenExtra[residentId][category] = [];
  citizenExtra[residentId][category].push(savedRecord);
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  if (!Array.isArray(state.personalRecords)) state.personalRecords = [];
  state.personalRecords.push(savedRecord);
}

function loadCitizenExtra() {
  const saved = localStorage.getItem(CITIZEN_EXTRA_KEY);
  return saved ? JSON.parse(saved) : {};
}

function sortByDateDesc(a, b) {
  return String(b.date || "").localeCompare(String(a.date || ""));
}

function renderSourceBadge(item) {
  const source = classifyDataSource(item);
  return `<span class="source-badge source-${source.key}">来源：${source.label}</span>`;
}

function renderAttachmentMeta(item) {
  if (!["imaging", "attachments"].includes(item.category) && !["影像资料", "附件资料"].includes(item.categoryLabel)) return "";
  const meta = item.meta || {};
  return `<p class="attachment-meta">${meta.attachmentType || "资料"} · ${meta.fileName || item.name} · ${meta.accessMode || "需授权调阅"}</p>`;
}

function classifyDataSource(item) {
  const text = `${item.source || ""} ${item.provider || ""} ${item.createdBy || ""} ${item.categoryLabel || ""}`;
  if (/医保|insurance/i.test(text)) return { key: "insurance", label: "医保" };
  if (/社区|基层|家庭医生|卫生服务|随访/i.test(text)) return { key: "primary", label: "基层/家庭医生" };
  if (/公卫|疾控|疫苗|接种|公共卫生/i.test(text)) return { key: "public", label: "公卫" };
  if (/居民|个人|resident|citizen/i.test(text)) return { key: "self", label: "个人上传/授权" };
  if (/医院|医科|中心医院|门诊|住院|HIS|EMR/i.test(text)) return { key: "hospital", label: "医院" };
  return { key: "platform", label: "平台归集" };
}

function getPersonalRecords(residentId, category) {
  const fromState = Array.isArray(state.personalRecords) && state.personalRecords.length ? state.personalRecords : buildFallbackPersonalRecords();
  const stateItems = fromState.filter((item) => item.residentId === residentId && item.category === category);
  const stateIds = new Set(stateItems.map((item) => item.id).filter(Boolean));
  const extra = (citizenExtra[residentId]?.[category] || []).filter((item) => !stateIds.has(item.id));
  return [...stateItems, ...extra.map((item) => ({ ...item, residentId, category }))]
    .sort(sortByDateDesc);
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
  return `<div class="auth-state ${status.className}">${status.label}</div>`;
}

function getAuthorizationStatus(item) {
  if (isRevoked(item)) return { label: `已撤销 · ${item.meta?.revokedAt || ""}`, className: "revoked" };
  if (item.date && item.date < todayOffset(0)) return { label: "已过期", className: "expired" };
  return { label: `有效期至 ${item.date || "长期"}`, className: "active" };
}

function isRevoked(item) {
  return item.meta?.status === "revoked";
}

async function revokeAuthorization(id) {
  const record = state.personalRecords?.find((item) => item.id === id);
  if (!record) return;
  const patch = { meta: { status: "revoked", revokedAt: todayOffset(0) } };
  if (API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${API_BASE}/personal-records/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch)
      });
      if (response.ok) {
        const updated = await response.json();
        Object.assign(record, updated);
        renderCitizen(currentResidentId);
        showToast("授权已撤销");
        return;
      }
    } catch (error) {
      // Fall back to local state update below.
    }
  }
  record.meta = { ...(record.meta || {}), ...patch.meta };
  localStorage.setItem(CITIZEN_EXTRA_KEY, JSON.stringify(citizenExtra));
  renderCitizen(currentResidentId);
  showToast("授权已撤销");
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
