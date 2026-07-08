#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-readiness-report.md");

const SOURCE_DOCUMENTS = [
  {
    id: "public-health-standard-2020",
    name: "全国公共卫生信息化建设标准与规范（试行）",
    type: "PDF",
    localPath: "C:/Users/drxuj/OneDrive/3.信息化/公共卫生/全国公共卫生信息化建设标准与规范.pdf",
    extractedFacts: ["21 个一级指标", "125 个二级指标", "421 个三级指标", "平战结合", "依托全民健康信息平台", "医防融合"]
  },
  {
    id: "public-health-standard-map",
    name: "全国公共卫生信息化建设标准与规范示意图",
    type: "JPG",
    localPath: "C:/Users/drxuj/OneDrive/3.信息化/公共卫生/全国公共卫生信息化建设标准与规范.jpg",
    extractedFacts: ["疾控中心", "基层医疗卫生机构", "卫生健康管理部门", "卫生监督机构", "妇幼保健机构", "二级及以上医院", "其他公共卫生机构"]
  }
];

const STANDARD_TOTALS = {
  management: { domains: 18, secondary: 105, tertiary: 365 },
  technology: { domains: 3, secondary: 20, tertiary: 56 },
  total: { domains: 21, secondary: 125, tertiary: 421 }
};

const STANDARD_DOMAINS = [
  ["ph-infectious", 1, "传染病防控", "management", 6, 49, "1-49", "疾控中心", ["病例报告", "流行病学调查", "实验室检测", "报告质量控制"], ["publicHealthEvents", "emergencySignals", "diagnosticReports"], ["传染病网络直报", "实验室报告", "电子病历"]],
  ["ph-parasitic", 2, "寄生虫病防控", "management", 7, 55, "50-104", "疾控中心", ["流行区调查", "病例发现", "媒介监测", "健康教育"], ["publicHealthEvents", "healthStatistics"], ["寄生虫病监测系统", "区域统计直报"]],
  ["ph-immunization", 3, "免疫规划", "management", 2, 7, "105-111", "疾控中心/基层机构", ["预防接种服务", "疫苗管理", "冷链管理", "异常反应监测"], ["immunizationPlans", "birthCertificates", "publicHealthEvents"], ["预防接种系统", "出生证照", "居民端提醒"]],
  ["ph-chronic", 4, "慢性病防控", "management", 14, 21, "112-132", "基层卫生/疾控中心", ["高血压", "糖尿病", "慢阻肺", "心脑血管", "癌症", "死因监测"], ["chronicScreeningTasks", "chronicManagementPlans", "followups", "deathCertificates"], ["慢病平台", "家庭医生签约", "死因监测"]],
  ["ph-endemic", 5, "地方病防控", "management", 12, 55, "133-187", "疾控中心/基层机构", ["碘缺乏", "高碘危害", "氟中毒", "砷中毒", "大骨节病", "克山病"], ["publicHealthEvents", "healthStatistics"], ["地方病监测", "实验室质控"]],
  ["ph-mental", 6, "精神卫生防治", "management", 6, 9, "188-196", "精卫中心/基层机构", ["严重精神障碍", "抑郁测评", "认知筛查", "心理健康宣教"], ["publicHealthEvents", "followups", "personalRecords"], ["精神卫生系统", "基层随访"]],
  ["ph-epilepsy", 7, "癫痫防治", "management", 2, 4, "197-200", "基层机构/专科机构", ["病例报告", "患者服务", "健康教育", "个案管理"], ["publicHealthEvents", "followups"], ["癫痫个案管理", "基层随访"]],
  ["ph-senior", 8, "老年人健康服务管理", "management", 8, 15, "201-215", "基层机构/民政协同", ["健康教育", "预防保健", "失能评估", "医养结合", "中医药管理"], ["seniorServices", "personalRecords", "followups"], ["老年健康服务", "医养结合"]],
  ["ph-maternal-child", 9, "妇幼健康服务管理", "management", 7, 28, "216-243", "妇幼保健机构/医疗机构", ["孕产保健", "儿童保健", "出生缺陷防治", "妇幼证照", "母婴传播预防"], ["birthCertificates", "birthStatistics", "personalRecords"], ["妇幼保健系统", "出生医学证明", "电子证照"]],
  ["ph-health-education", 10, "健康教育", "management", 1, 3, "244-246", "疾控中心/基层机构", ["健康教育计划", "宣传活动", "效果评价"], ["chronicEducationPushes", "publicHealthEvents"], ["健康教育平台", "居民端消息"]],
  ["ph-nutrition", 11, "营养健康服务管理", "management", 3, 5, "247-251", "疾控中心/基层机构", ["营养监测", "营养干预", "食品营养宣教"], ["publicHealthEvents", "personalRecords"], ["营养监测系统", "健康档案"]],
  ["ph-archive", 12, "健康档案管理服务", "management", 1, 1, "252", "基层机构", ["居民健康档案"], ["residents", "personalRecords", "healthArchiveStandard"], ["居民主索引", "个人健康信息库"]],
  ["ph-injury", 13, "伤害防控", "management", 2, 3, "253-255", "疾控中心/医疗机构", ["伤害监测", "伤害干预", "健康教育"], ["publicHealthEvents", "diagnosticReports"], ["伤害监测", "急诊病历"]],
  ["ph-emergency", 14, "突发公共卫生事件管理", "management", 3, 12, "256-267", "卫健管理部门/疾控中心", ["事件报告", "应急处置", "资源调配", "信息发布"], ["publicHealthEvents", "emergencySignals", "resourceDispatchRequests"], ["应急指挥", "视频会商", "物资调度"]],
  ["ph-environment", 15, "环境卫生管理", "management", 6, 21, "268-288", "疾控中心/监督机构", ["饮用水", "公共场所", "学校卫生", "病媒生物", "环境监测"], ["publicHealthEvents", "healthStatistics"], ["环境卫生监测", "卫生监督"]],
  ["ph-supervision", 16, "监督执法服务管理", "management", 14, 34, "289-322", "卫生监督机构", ["监督检查", "行政处罚", "信用管理", "投诉举报", "监督协管"], ["institutionSupervisions", "institutionCreditEvaluations", "publicHealthEvents"], ["监督执法系统", "信用评价"]],
  ["ph-food", 17, "食品安全风险监测", "management", 4, 21, "323-343", "疾控中心/食品安全部门", ["污染物监测", "食源性疾病", "暴发事件", "实验室检测"], ["publicHealthEvents", "diagnosticReports"], ["食品安全风险监测", "实验室系统"]],
  ["ph-occupational", 18, "职业病防控", "management", 7, 22, "344-365", "职业健康机构/监督机构", ["职业健康检查", "职业病诊断", "危害因素监测", "风险预警", "宣教培训"], ["publicHealthEvents", "institutionSupervisions"], ["职业健康检查", "职业病防治"]],
  ["ph-portal", 19, "信息平台管理", "technology", 7, 12, "366-377", "平台技术组", ["统一门户", "用户注册", "授权管理", "数据交换", "日志管理"], ["platformInterfaces", "integrationContracts", "dataAccessLogs"], ["统一应用门户", "数据交换平台"]],
  ["ph-security", 20, "网络安全管理", "technology", 10, 34, "378-411", "安全管理岗", ["身份认证", "终端安全", "通信安全", "数据防泄露", "容灾备份", "安全运维"], ["securityEvents", "securityAcceptanceLedger", "dataAccessLogs"], ["等保三级", "密评", "审计保全"]],
  ["ph-emerging-tech", 21, "新兴技术应用", "technology", 3, 10, "412-421", "平台技术组/科研治理", ["大数据", "云计算", "人工智能", "可视化展示", "预测预警"], ["researchDatasets", "diseaseRegistryModels", "healthDashboardSnapshots"], ["AI 预警", "科研沙箱", "云平台"]]
];

function toStandardDomain(row) {
  const [id, order, name, category, secondaryCount, tertiaryCount, tertiaryRange, owner, capabilities, dataCollections, interfaces] = row;
  return {
    id,
    order,
    name,
    category,
    source: "全国公共卫生信息化建设标准与规范（试行）",
    owner,
    secondaryCount,
    tertiaryCount,
    tertiaryRange,
    capabilities,
    dataCollections,
    interfaces,
    status: "已建模",
    nextAction: "接入现场业务系统、正式指标口径和属地验收证据。"
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function seedPublicHealthStandards() {
  return STANDARD_DOMAINS.map(toStandardDomain);
}

function seedPublicHealthInstitutionScopes() {
  return [
    { id: "scope-cdc", name: "国家/省/市/县区级疾病预防控制中心", institutionType: "CDC", responsibilities: ["监测预警", "病例报告", "流调溯源", "实验室质控", "健康教育"], coveredDomains: ["传染病防控", "寄生虫病防控", "地方病防控", "食品安全风险监测"], status: "标准覆盖已建模", interfaceMode: "国家/省/市县直报与实验室数据交换", nextAction: "补齐真实疾控直报账号、交换规则和应急会商责任人。" },
    { id: "scope-primary", name: "基层医疗卫生机构", institutionType: "primary-care", responsibilities: ["居民档案", "慢病随访", "免疫接种", "老年健康", "健康教育"], coveredDomains: ["慢性病防控", "免疫规划", "健康档案管理服务", "老年人健康服务管理"], status: "业务闭环已复用", interfaceMode: "家庭医生/基层公卫系统/居民端", nextAction: "接入正式家庭医生签约、预防接种和基本公卫绩效口径。" },
    { id: "scope-health-admin", name: "卫生健康管理部门", institutionType: "health-admin", responsibilities: ["综合监管", "资源调配", "统计质控", "应急指挥", "绩效评价"], coveredDomains: ["突发公共卫生事件管理", "信息平台管理", "网络安全管理"], status: "驾驶舱已建模", interfaceMode: "统一门户、数据交换、指标看板", nextAction: "补齐属地月报、值守班表和现场签字材料。" },
    { id: "scope-supervision", name: "各级卫生健康监督机构", institutionType: "supervision", responsibilities: ["监督检查", "行政处罚", "信用评价", "投诉举报", "协管巡查"], coveredDomains: ["监督执法服务管理", "环境卫生管理", "职业病防控"], status: "监管台账已建模", interfaceMode: "卫生监督系统/信用评价/整改闭环", nextAction: "接入正式监督执法案件编号和处罚决定书归档。" },
    { id: "scope-maternal-child", name: "各级妇幼保健机构", institutionType: "maternal-child", responsibilities: ["孕产保健", "儿童保健", "出生缺陷防治", "妇幼入册", "母婴安全"], coveredDomains: ["妇幼健康服务管理", "免疫规划", "健康教育"], status: "妇幼证照已复用", interfaceMode: "妇幼保健系统/出生医学证明/电子证照", nextAction: "补齐真实妇幼入册、筛查和随访回传接口。" },
    { id: "scope-hospital", name: "二级及以上医院", institutionType: "hospital", responsibilities: ["诊疗发现", "实验室报告", "院感预警", "危急值协同", "出院后连续管理"], coveredDomains: ["传染病防控", "突发公共卫生事件管理", "食品安全风险监测", "职业病防控"], status: "医防协同已建模", interfaceMode: "HIS/EMR/LIS/PACS/院感/报告回传", nextAction: "完成 HIS/EMR/LIS/PACS 和院感系统现场联调。" },
    { id: "scope-other-public-health", name: "其他公共卫生机构", institutionType: "public-health-other", responsibilities: ["职业健康", "采供血", "急救", "健康教育", "专项监测"], coveredDomains: ["职业病防控", "伤害防控", "营养健康服务管理", "环境卫生管理"], status: "机构边界已纳入", interfaceMode: "专项业务系统/API/批量报送", nextAction: "按机构类型补齐业务目录、接口协议和数据共享授权。" }
  ];
}

function seedPublicHealthEvents() {
  return [
    { id: "phe-infectious-001", domain: "传染病防控", signal: "发热门诊聚集性呼吸道病例", institution: "大连市中心医院", region: "中山区", sourceSystem: "EMR/LIS", status: "待疾控复核", priority: "high", reportedAt: "2026-07-08T08:30:00+08:00", commandAction: "市疾控发起流调任务并锁定实验室复核样本。", followupAction: "24 小时内回写流调结论和报告质量控制记录。", linkedStandardItems: ["病例报告", "流行病学调查", "呼吸道传染病实验室检测"] },
    { id: "phe-immunization-001", domain: "免疫规划", signal: "冷链温度越界与接种库存风险", institution: "青泥洼桥社区卫生服务中心", region: "中山区", sourceSystem: "预防接种系统", status: "处置中", priority: "medium", reportedAt: "2026-07-08T09:10:00+08:00", commandAction: "暂停相关批号出库并通知接种单位复核。", followupAction: "归档冷链记录、库存盘点和异常反应监测交叉核验。", linkedStandardItems: ["疫苗管理", "冷链管理", "接种单位管理"] },
    { id: "phe-chronic-001", domain: "慢性病防控", signal: "高危慢病随访逾期", institution: "星海湾社区卫生服务中心", region: "沙河口区", sourceSystem: "慢病平台", status: "待家庭医生补访", priority: "high", reportedAt: "2026-07-08T10:00:00+08:00", commandAction: "推送家庭医生补访任务并同步居民端提醒。", followupAction: "补录随访结果、用药依从性和转诊建议。", linkedStandardItems: ["高血压服务", "2 型糖尿病服务", "慢性病监测"] },
    { id: "phe-food-001", domain: "食品安全风险监测", signal: "疑似食源性疾病暴发事件", institution: "甘井子区人民医院", region: "甘井子区", sourceSystem: "急诊/LIS", status: "待样本检测", priority: "high", reportedAt: "2026-07-08T11:20:00+08:00", commandAction: "疾控中心登记可疑食品、生物标本和环境标本。", followupAction: "形成报告结论并同步监督执法线索。", linkedStandardItems: ["报告基本信息", "可疑食品信息", "生物标本检测信息"] },
    { id: "phe-occupational-001", domain: "职业病防控", signal: "重点用人单位职业健康风险预警", institution: "职业健康检查机构", region: "金普新区", sourceSystem: "职业健康检查", status: "监督复核中", priority: "medium", reportedAt: "2026-07-08T13:20:00+08:00", commandAction: "触发监督机构现场核查和用人单位整改通知。", followupAction: "归档职业健康检查、危害因素检测和整改闭环。", linkedStandardItems: ["职业健康检查", "职业病危害因素监测", "职业健康风险监控预警"] },
    { id: "phe-emergency-001", domain: "突发公共卫生事件管理", signal: "区县应急资源紧急调度", institution: "市卫生健康委", region: "全市", sourceSystem: "应急指挥", status: "已派发", priority: "high", reportedAt: "2026-07-08T14:00:00+08:00", commandAction: "联动医院床位、急救、检验和防控物资调度。", followupAction: "完成处置复盘、信息发布记录和资源消耗对账。", linkedStandardItems: ["事件报告", "应急处置", "资源调配"] }
  ];
}

function seedPublicHealthExchangeTasks() {
  return [
    { id: "phx-national-direct-report", name: "国家/省市县公卫直报交换", category: "direct-report", sourceSystems: ["疾控直报", "卫生统计", "基层公卫"], targetCollections: ["publicHealthEvents", "healthStatisticsIngestion"], frequency: "event/daily/monthly", owner: "疾控中心/规划信息", status: "演示契约就绪", evidence: ["publicHealthStandards", "healthStatisticsIngestion"], nextAction: "配置正式直报接口地址、指标版本和回执规则。" },
    { id: "phx-lab-surveillance", name: "实验室检测与质量控制交换", category: "laboratory", sourceSystems: ["LIS", "疾控实验室", "食品安全实验室"], targetCollections: ["diagnosticReports", "publicHealthEvents"], frequency: "event", owner: "疾控实验室/医疗机构", status: "演示契约就绪", evidence: ["diagnosticReports", "integrationContracts"], nextAction: "补齐样本编号、检测方法、质控批次和阳性回传签名。" },
    { id: "phx-immunization", name: "免疫规划与出生证照接续", category: "immunization", sourceSystems: ["预防接种系统", "出生医学证明", "居民端"], targetCollections: ["birthCertificates", "personalRecords", "publicHealthEvents"], frequency: "event", owner: "疾控免疫规划/妇幼", status: "演示闭环", evidence: ["immunization:readiness", "birthCertificates"], nextAction: "接入正式儿童接种档案和冷链异常回执。" },
    { id: "phx-maternal-child", name: "妇幼健康入册与证照共享", category: "maternal-child", sourceSystems: ["妇幼保健", "电子证照", "公安出生登记"], targetCollections: ["birthCertificates", "birthStatistics"], frequency: "event", owner: "妇幼保健/医政", status: "演示闭环", evidence: ["maternal-child:readiness"], nextAction: "补齐妇幼入册、筛查、公安共享和质控补正接口。" },
    { id: "phx-emergency-command", name: "突发事件应急指挥协同", category: "emergency", sourceSystems: ["应急指挥", "医院运行", "急救", "物资调度"], targetCollections: ["publicHealthEvents", "emergencySignals", "resourceDispatchRequests"], frequency: "real-time", owner: "卫健应急/疾控", status: "演示联动", evidence: ["operations:readiness", "publicHealthEvents"], nextAction: "绑定真实值班表、会商视频和资源消耗回执。" },
    { id: "phx-security-audit", name: "网络安全、审计与容灾证据交换", category: "security", sourceSystems: ["统一认证", "审计日志", "安全设备", "备份系统"], targetCollections: ["securityEvents", "dataAccessLogs", "securityAcceptanceLedger"], frequency: "continuous", owner: "安全管理岗", status: "演示证据就绪", evidence: ["audit:retention", "securityAcceptanceLedger"], nextAction: "归档等保、密评、国密、备份恢复和日志保全现场证据。" }
  ];
}

function seedPublicHealthExchangeRuns() {
  return [
    { id: "phxr-direct-report-001", taskId: "phx-national-direct-report", category: "direct-report", sourceSystem: "疾控直报", targetCollection: "publicHealthEvents", runType: "scheduled", status: "receipt-confirmed", receiptStatus: "accepted", compensationStatus: "not-required", payloadRecords: 18, failedRecords: 0, receiptId: "PH-DR-20260708-001", owner: "疾控中心/规划信息", startedAt: "2026-07-08T08:40:00+08:00", finishedAt: "2026-07-08T08:43:00+08:00", evidence: ["publicHealthEvents", "healthStatisticsIngestion"], nextAction: "归档国家/省市县直报回执和字段版本。" },
    { id: "phxr-lab-001", taskId: "phx-lab-surveillance", category: "laboratory", sourceSystem: "LIS/疾控实验室", targetCollection: "diagnosticReports", runType: "event", status: "compensated", receiptStatus: "accepted-after-retry", compensationStatus: "replayed", payloadRecords: 12, failedRecords: 2, receiptId: "PH-LAB-20260708-007", owner: "疾控实验室/医疗机构", startedAt: "2026-07-08T09:05:00+08:00", finishedAt: "2026-07-08T09:16:00+08:00", evidence: ["diagnosticReports", "integrationContracts"], nextAction: "保留失败样本重放日志、签名哈希和阳性回传回执。" },
    { id: "phxr-immunization-001", taskId: "phx-immunization", category: "immunization", sourceSystem: "预防接种系统", targetCollection: "birthCertificates", runType: "event", status: "receipt-confirmed", receiptStatus: "accepted", compensationStatus: "not-required", payloadRecords: 7, failedRecords: 0, receiptId: "PH-IMM-20260708-003", owner: "疾控免疫规划/妇幼", startedAt: "2026-07-08T09:30:00+08:00", finishedAt: "2026-07-08T09:33:00+08:00", evidence: ["immunization:readiness", "birthCertificates"], nextAction: "接入正式儿童接种档案和冷链异常回执。" },
    { id: "phxr-maternal-child-001", taskId: "phx-maternal-child", category: "maternal-child", sourceSystem: "妇幼保健/电子证照", targetCollection: "birthStatistics", runType: "daily", status: "manual-review", receiptStatus: "pending-manual-signoff", compensationStatus: "manual-review", payloadRecords: 6, failedRecords: 1, receiptId: "PH-MCH-20260708-002", owner: "妇幼保健/医政", startedAt: "2026-07-08T10:10:00+08:00", finishedAt: "2026-07-08T10:25:00+08:00", evidence: ["maternal-child:readiness", "birthStatistics"], nextAction: "补齐公安共享字段和质控补正签字材料。" },
    { id: "phxr-emergency-001", taskId: "phx-emergency-command", category: "emergency", sourceSystem: "应急指挥/医院运行", targetCollection: "resourceDispatchRequests", runType: "real-time", status: "receipt-confirmed", receiptStatus: "accepted", compensationStatus: "not-required", payloadRecords: 5, failedRecords: 0, receiptId: "PH-EMG-20260708-004", owner: "卫健应急/疾控", startedAt: "2026-07-08T14:05:00+08:00", finishedAt: "2026-07-08T14:08:00+08:00", evidence: ["operations:readiness", "publicHealthEvents"], nextAction: "绑定真实值班表、会商视频和资源消耗回执。" },
    { id: "phxr-security-001", taskId: "phx-security-audit", category: "security", sourceSystem: "统一认证/审计日志", targetCollection: "securityEvents", runType: "continuous", status: "receipt-confirmed", receiptStatus: "accepted", compensationStatus: "not-required", payloadRecords: 20, failedRecords: 0, receiptId: "PH-SEC-20260708-001", owner: "安全管理岗", startedAt: "2026-07-08T15:00:00+08:00", finishedAt: "2026-07-08T15:03:00+08:00", evidence: ["audit:retention", "securityAcceptanceLedger"], nextAction: "归档等保、密评、国密、备份恢复和日志保全现场证据。" }
  ];
}

function seedPublicHealthInstitutionTasks() {
  return [
    { id: "phit-cdc", scopeId: "scope-cdc", institutionType: "CDC", roleView: "疾控中心", taskType: "monitor-command", owner: "市疾控中心应急办", status: "ready-for-site", handoffStatus: "command-ready", accountStatus: "demo-account-ready", openItems: 1, dueAt: "2026-07-12", evidence: ["publicHealthEvents", "publicHealthExchangeRuns"], nextAction: "确认疾控直报账号、流调责任人和实验室回执规则。" },
    { id: "phit-primary", scopeId: "scope-primary", institutionType: "primary-care", roleView: "基层医疗卫生机构", taskType: "followup-service", owner: "基层公卫专班", status: "ready-for-site", handoffStatus: "task-ready", accountStatus: "demo-account-ready", openItems: 2, dueAt: "2026-07-13", evidence: ["followups", "chronicManagementPlans"], nextAction: "确认家庭医生签约、随访回写和居民端提醒口径。" },
    { id: "phit-health-admin", scopeId: "scope-health-admin", institutionType: "health-admin", roleView: "卫生健康管理部门", taskType: "command-dashboard", owner: "市卫健委规划信息处", status: "ready-for-site", handoffStatus: "dashboard-ready", accountStatus: "demo-account-ready", openItems: 1, dueAt: "2026-07-12", evidence: ["/api/public-health/system", "release:report"], nextAction: "确认属地月报、值守班表和发布审批责任人。" },
    { id: "phit-supervision", scopeId: "scope-supervision", institutionType: "supervision", roleView: "卫生健康监督机构", taskType: "rectification", owner: "卫生监督执法专班", status: "ready-for-site", handoffStatus: "rectification-ready", accountStatus: "demo-account-ready", openItems: 2, dueAt: "2026-07-14", evidence: ["institutionSupervisions", "institutionCreditEvaluations"], nextAction: "接入正式监督执法案件编号和处罚决定书归档。" },
    { id: "phit-maternal-child", scopeId: "scope-maternal-child", institutionType: "maternal-child", roleView: "妇幼保健机构", taskType: "certificate-continuity", owner: "妇幼保健/医政", status: "ready-for-site", handoffStatus: "certificate-ready", accountStatus: "demo-account-ready", openItems: 1, dueAt: "2026-07-14", evidence: ["birthCertificates", "birthStatistics"], nextAction: "补齐妇幼入册、筛查和公安共享回执。" },
    { id: "phit-hospital", scopeId: "scope-hospital", institutionType: "hospital", roleView: "二级及以上医院", taskType: "medical-prevention", owner: "医院信息/院感/检验联络员", status: "ready-for-site", handoffStatus: "interface-ready", accountStatus: "demo-account-ready", openItems: 3, dueAt: "2026-07-15", evidence: ["diagnosticReports", "integrationContracts"], nextAction: "完成 HIS/EMR/LIS/PACS 和院感系统现场联调。" },
    { id: "phit-other-public-health", scopeId: "scope-other-public-health", institutionType: "public-health-other", roleView: "其他公共卫生机构", taskType: "special-monitoring", owner: "职业健康/急救/采供血联络员", status: "ready-for-site", handoffStatus: "catalog-ready", accountStatus: "demo-account-ready", openItems: 2, dueAt: "2026-07-16", evidence: ["publicHealthStandards", "publicHealthOnsiteAcceptances"], nextAction: "按机构类型补齐业务目录、接口协议和数据共享授权。" }
  ];
}

function seedPublicHealthOnsiteAcceptances() {
  return [
    { id: "phoa-interface-joint-test", category: "接口联调", name: "疾控直报、实验室、妇幼、应急和安全审计接口联调", owner: "平台技术组/接口联调专班", status: "ready-for-signoff", severity: "P0", blocker: "需现场系统地址、密钥和回执样例", evidence: ["publicHealthExchangeRuns", "integrationContracts"], onsiteAction: "现场抽取 3 类接口样例并签署联调回执。", signoffStatus: "pending-site-signature" },
    { id: "phoa-security-level-protection", category: "等保密评", name: "等保、密评、国密设备和日志保全证据", owner: "安全管理岗", status: "ready-for-signoff", severity: "P0", blocker: "需正式测评报告或整改承诺", evidence: ["securityAcceptanceLedger", "audit:retention"], onsiteAction: "归档测评报告、整改项和日志保全截图。", signoffStatus: "pending-site-signature" },
    { id: "phoa-backup-restore", category: "备份恢复", name: "公共卫生事件和交换台账备份恢复演练", owner: "运维保障组", status: "ready-for-signoff", severity: "P0", blocker: "需现场备份介质和恢复截图", evidence: ["rollback:snapshot", "launch:smoke"], onsiteAction: "执行一次公共卫生数据恢复演练并记录 RPO/RTO。", signoffStatus: "pending-site-signature" },
    { id: "phoa-emergency-drill", category: "平战结合", name: "突发公共卫生事件指挥处置演练", owner: "卫健应急/疾控中心", status: "ready-for-signoff", severity: "P0", blocker: "需值班表、会商记录和资源调度回执", evidence: ["publicHealthEvents", "resourceDispatchRequests"], onsiteAction: "抽取一个高优先级事件完成派发、回执和复盘签字。", signoffStatus: "pending-site-signature" },
    { id: "phoa-institution-accounts", category: "机构协同", name: "七类机构账号、职责和现场联系人确认", owner: "卫健管理部门/各机构联络员", status: "ready-for-signoff", severity: "P1", blocker: "需现场联系人名单和授权确认", evidence: ["publicHealthInstitutionTasks", "authUsers"], onsiteAction: "按七类机构逐项核对账号、职责、数据范围和联系人。", signoffStatus: "pending-site-signature" },
    { id: "phoa-release-package", category: "发布材料", name: "公共卫生发布包、建设报告和下一步计划归档", owner: "项目办/发布经理", status: "ready-for-signoff", severity: "P1", blocker: "需现场签字页和版本号确认", evidence: ["public-health:readiness", "release:report", "deploy:check"], onsiteAction: "归档发布报告、截图、验收清单和版本签字页。", signoffStatus: "pending-site-signature" }
  ];
}

function seedPublicHealthReadinessEvidence() {
  return [
    { id: "phev-standard-coverage", category: "标准覆盖", name: "21/125/421 标准矩阵覆盖", owner: "项目办/标准管理", status: "已建档", evidence: ["publicHealthStandards", "public-health:readiness"], nextAction: "按现场验收版本维护标准条目差异。" },
    { id: "phev-institution-scope", category: "机构覆盖", name: "七类机构责任边界", owner: "卫健管理部门", status: "已建档", evidence: ["publicHealthInstitutionScopes"], nextAction: "确认属地真实机构清单、联系人和系统账号。" },
    { id: "phev-event-command", category: "平战结合", name: "监测预警-指挥处置-随访复盘闭环", owner: "疾控中心/应急办", status: "演示闭环", evidence: ["publicHealthEvents", "/api/public-health/system"], nextAction: "接入正式事件分级、处置时限和信息发布审批。" },
    { id: "phev-event-action-api", category: "处置闭环", name: "事件动作 API 与审计留痕", owner: "卫健管理部门/疾控中心", status: "已接入", evidence: ["POST /api/public-health/events/:id/actions", "publicHealthEvents.actionHistory", "securityEvents"], nextAction: "接入正式责任人、处置时限、会商记录和现场签字材料。" },
    { id: "phev-exchange-security", category: "数据交换安全", name: "直报、实验室、妇幼、应急、安全审计交换", owner: "平台技术组/安全管理岗", status: "演示契约就绪", evidence: ["publicHealthExchangeTasks", "publicHealthExchangeRuns", "integrationContracts", "audit:retention"], nextAction: "完成外部接口联调、密钥、回执和异常补偿策略。" },
    { id: "phev-institution-collaboration", category: "机构协同", name: "七类机构角色化任务和现场账号清单", owner: "卫健管理部门/各机构联络员", status: "已建档", evidence: ["publicHealthInstitutionTasks", "authUsers"], nextAction: "现场确认联系人、授权范围和机构账号。" },
    { id: "phev-onsite-acceptance", category: "现场验收", name: "等保密评、备份恢复、接口联调和签字材料", owner: "项目办/安全管理岗/运维保障组", status: "待现场签字", evidence: ["publicHealthOnsiteAcceptances", "release:report", "deploy:check"], nextAction: "收集现场签字页、测评报告和演练截图。" }
  ];
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readIfExists(relativePath) {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function mergeById(defaultRows, currentRows) {
  const current = Array.isArray(currentRows) ? currentRows : [];
  const map = new Map(current.map((item) => [item.id, item]));
  return defaultRows.map((item) => ({ ...item, ...(map.get(item.id) || {}) }))
    .concat(current.filter((item) => !defaultRows.some((seed) => seed.id === item.id)));
}

function countRows(data, collection) {
  const value = data?.[collection];
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === "object") return Object.values(value).flatMap((item) => Array.isArray(item) ? item : [item]).length;
  return 0;
}

function isHighPriority(item) {
  return /high|urgent|critical|高|危急|紧急|逾期/.test(`${item.priority || ""} ${item.status || ""} ${item.signal || ""}`);
}

function eventActionCount(events) {
  return (Array.isArray(events) ? events : []).reduce((sum, item) => (
    sum + (Array.isArray(item.actionHistory) ? item.actionHistory.length : 0)
  ), 0);
}

function summarizeStandards(standards) {
  const management = standards.filter((item) => item.category === "management");
  const technology = standards.filter((item) => item.category === "technology");
  const summarize = (items) => ({
    domains: items.length,
    secondary: items.reduce((sum, item) => sum + Number(item.secondaryCount || 0), 0),
    tertiary: items.reduce((sum, item) => sum + Number(item.tertiaryCount || 0), 0)
  });
  return {
    management: summarize(management),
    technology: summarize(technology),
    total: summarize(standards)
  };
}

function buildPublicHealthSystem(options = {}) {
  const data = options.data || readJson("data/db.json");
  const standards = mergeById(seedPublicHealthStandards(), data.publicHealthStandards);
  const institutionScopes = mergeById(seedPublicHealthInstitutionScopes(), data.publicHealthInstitutionScopes);
  const events = mergeById(seedPublicHealthEvents(), data.publicHealthEvents);
  const exchangeTasks = mergeById(seedPublicHealthExchangeTasks(), data.publicHealthExchangeTasks);
  const exchangeRuns = mergeById(seedPublicHealthExchangeRuns(), data.publicHealthExchangeRuns);
  const institutionTasks = mergeById(seedPublicHealthInstitutionTasks(), data.publicHealthInstitutionTasks);
  const onsiteAcceptances = mergeById(seedPublicHealthOnsiteAcceptances(), data.publicHealthOnsiteAcceptances);
  const readinessEvidence = mergeById(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence);
  const standardCoverage = summarizeStandards(standards);
  const domainCoverage = standards.map((domain) => ({
    ...domain,
    linkedRecords: (domain.dataCollections || []).reduce((sum, collection) => sum + countRows(data, collection), 0),
    linkedCollections: (domain.dataCollections || []).filter((collection) => countRows(data, collection) > 0)
  }));
  const riskQueue = events
    .filter((item) => isHighPriority(item) || !/已闭环|已完成|closed|resolved/i.test(String(item.status || "")))
    .sort((a, b) => Number(isHighPriority(b)) - Number(isHighPriority(a)));
  const exchangeCategories = Array.from(new Set(exchangeTasks.map((item) => item.category))).sort();
  const scopeDomains = Array.from(new Set(institutionScopes.flatMap((item) => item.coveredDomains || []))).sort();
  const exchangeRunTaskIds = new Set(exchangeRuns.map((item) => item.taskId));
  const compensatedExchangeRuns = exchangeRuns.filter((item) => /replay|compensat|manual|retry|重放|补偿|人工/i.test(`${item.compensationStatus || ""} ${item.status || ""}`));
  const institutionTaskScopeIds = new Set(institutionTasks.map((item) => item.scopeId));
  const onsiteReady = onsiteAcceptances.filter((item) => /ready|signed|passed|complete|就绪|通过|签/i.test(`${item.status || ""} ${item.signoffStatus || ""}`));

  return {
    ok: standardCoverage.total.domains === STANDARD_TOTALS.total.domains &&
      standardCoverage.total.secondary === STANDARD_TOTALS.total.secondary &&
      standardCoverage.total.tertiary === STANDARD_TOTALS.total.tertiary &&
      institutionScopes.length >= 7 &&
      events.length >= 6 &&
      exchangeCategories.length >= 6 &&
      exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) &&
      institutionScopes.every((item) => institutionTaskScopeIds.has(item.id)) &&
      onsiteAcceptances.length >= 6,
    generatedAt: new Date().toISOString(),
    sourceDocuments: clone(SOURCE_DOCUMENTS),
    standardTotals: clone(STANDARD_TOTALS),
    summary: {
      domains: standardCoverage.total.domains,
      secondaryIndicators: standardCoverage.total.secondary,
      tertiaryIndicators: standardCoverage.total.tertiary,
      managementDomains: standardCoverage.management.domains,
      technologyDomains: standardCoverage.technology.domains,
      institutionScopes: institutionScopes.length,
      scopeDomains: scopeDomains.length,
      events: events.length,
      highPriorityEvents: events.filter(isHighPriority).length,
      eventActions: eventActionCount(events),
      exchangeTasks: exchangeTasks.length,
      exchangeCategories: exchangeCategories.length,
      exchangeRuns: exchangeRuns.length,
      compensatedExchangeRuns: compensatedExchangeRuns.length,
      institutionTasks: institutionTasks.length,
      onsiteAcceptances: onsiteAcceptances.length,
      onsiteReady: onsiteReady.length,
      readinessEvidence: readinessEvidence.length
    },
    standardCoverage,
    standardDomains: domainCoverage,
    institutionScopes,
    events,
    riskQueue,
    exchangeTasks,
    exchangeCategories,
    exchangeRuns,
    institutionTasks,
    onsiteAcceptances,
    readinessEvidence,
    implementationBoundary: {
      platformRole: "依托全民健康信息平台承载公共卫生信息化建设",
      normalMode: "支撑宏观管理、资源配置、绩效评价、日常监测和服务协同",
      emergencyMode: "支撑分级、分层、分流的重大疫情和突发公共卫生事件处置",
      externalDependencies: ["疾控直报", "预防接种", "妇幼保健", "卫生监督", "LIS/EMR/HIS/PACS", "等保密评和国密设备"]
    }
  };
}

function check(id, passed, detail, category = "public-health") {
  return { id, category, passed: Boolean(passed), detail };
}

function defaultSources() {
  return {
    server: readIfExists("server.js"),
    html: readIfExists("public-health.html"),
    js: readIfExists("public-health.js"),
    packageSource: readIfExists("package.json"),
    docs: readIfExists("docs/公共卫生信息化系统建设报告.md"),
    plan: readIfExists("docs/公共卫生信息化下一步开发计划.md"),
    manifest: readIfExists("scripts/release-artifact-manifest.js")
  };
}

function buildPublicHealthReadinessReport(options = {}) {
  const pkg = options.pkg || (options.packageSource ? JSON.parse(options.packageSource) : readJson("package.json"));
  const system = buildPublicHealthSystem(options);
  const sources = options.sources || defaultSources();
  const standard = system.standardCoverage;
  const scopeText = system.institutionScopes.map((item) => `${item.name} ${item.institutionType}`).join("\n");
  const exchangeRunTaskIds = new Set(system.exchangeRuns.map((item) => item.taskId));
  const institutionTaskScopeIds = new Set(system.institutionTasks.map((item) => item.scopeId));
  const checks = [
    check("standard:total", standard.total.domains === 21 && standard.total.secondary === 125 && standard.total.tertiary === 421, `${standard.total.domains}/${standard.total.secondary}/${standard.total.tertiary}`, "standard"),
    check("standard:management", standard.management.domains === 18 && standard.management.secondary === 105 && standard.management.tertiary === 365, `${standard.management.domains}/${standard.management.secondary}/${standard.management.tertiary}`, "standard"),
    check("standard:technology", standard.technology.domains === 3 && standard.technology.secondary === 20 && standard.technology.tertiary === 56, `${standard.technology.domains}/${standard.technology.secondary}/${standard.technology.tertiary}`, "standard"),
    check("institution:scopes", ["疾病预防控制", "基层", "卫生健康管理", "监督", "妇幼", "二级及以上医院", "其他公共卫生"].every((token) => scopeText.includes(token)), `${system.institutionScopes.length} institution scopes`, "institution"),
    check("events:closed-loop", system.events.length >= 6 && system.events.every((item) => item.commandAction && item.followupAction && item.linkedStandardItems?.length), `${system.events.length} events`, "event"),
    check("events:high-priority", system.summary.highPriorityEvents >= 3 && system.riskQueue.some((item) => item.domain === "突发公共卫生事件管理"), `${system.summary.highPriorityEvents} high priority events`, "event"),
    check("events:action-api", sources.server.includes("/api/public-health/events/:id/actions") && sources.server.includes("public-health-event-action"), "event action API with audit evidence", "event"),
    check("frontend:event-actions", sources.js.includes("data-public-health-action") && sources.html.includes("public-health-risk-queue"), "risk queue exposes command actions", "frontend"),
    check("exchange:categories", ["direct-report", "laboratory", "immunization", "maternal-child", "emergency", "security"].every((category) => system.exchangeCategories.includes(category)), system.exchangeCategories.join(","), "exchange"),
    check("exchange:runs", system.exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) && system.exchangeRuns.every((item) => item.receiptStatus && item.compensationStatus), `${system.exchangeRuns.length} exchange runs with receipts`, "exchange"),
    check("exchange:compensation", system.exchangeRuns.some((item) => /replay|compensat|manual|retry|重放|补偿|人工/i.test(`${item.compensationStatus || ""} ${item.status || ""}`)), "failed exchange compensation path is modeled", "exchange"),
    check("institution:tasks", system.institutionScopes.every((item) => institutionTaskScopeIds.has(item.id)) && system.institutionTasks.every((item) => item.owner && item.handoffStatus && item.accountStatus), `${system.institutionTasks.length} institution collaboration tasks`, "institution"),
    check("onsite:acceptance", system.onsiteAcceptances.length >= 6 && system.onsiteAcceptances.every((item) => item.owner && item.blocker && item.onsiteAction && item.evidence?.length), `${system.onsiteAcceptances.length} onsite acceptance rows`, "onsite"),
    check("frontend:advanced-panels", ["public-health-exchange-runs", "public-health-institution-tasks", "public-health-onsite-acceptances"].every((id) => sources.html.includes(id)) && ["renderExchangeRuns", "renderInstitutionTasks", "renderOnsiteAcceptances"].every((token) => sources.js.includes(token)), "exchange, institution and onsite panels are visible", "frontend"),
    check("api:advanced-actions", ["/api/public-health/exchange-tasks/:id/runs", "/api/public-health/institution-tasks/:id/actions", "/api/public-health/onsite-acceptances/:id/actions"].every((token) => sources.server.includes(token)), "exchange, institution and onsite action APIs are wired", "api"),
    check("frontend:page", sources.html.includes("public-health-metrics") && sources.js.includes("renderPublicHealthSystem"), "public-health.html and public-health.js are wired", "frontend"),
    check("api:route", sources.server.includes("/api/public-health/system") && sources.server.includes("buildPublicHealthSystem"), "GET /api/public-health/system", "api"),
    check("package:script", Boolean(pkg.scripts?.["public-health:readiness"]) && sources.packageSource.includes("public-health-readiness.js"), pkg.scripts?.["public-health:readiness"] || "missing", "release"),
    check("manifest:artifact", sources.manifest.includes("public-health-readiness-report.md") && sources.manifest.includes("public-health:readiness"), "release manifest indexes public health artifact", "release"),
    check("docs:report", ["21/125/421", "平战结合", "医防融合", "/api/public-health/system", "/api/public-health/exchange-tasks/:id/runs", "publicHealthExchangeRuns", "publicHealthInstitutionTasks", "publicHealthOnsiteAcceptances", "public-health:readiness"].every((token) => sources.docs.includes(token)), "public health build report documents scope, APIs, exchange runs, institution tasks, onsite acceptance, and readiness", "docs"),
    check("docs:next-plan", ["5 小时开发切片", "事件处置闭环", "验收清单"].every((token) => sources.plan.includes(token)), "next development plan is documented", "docs")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: system.summary,
    sourceDocuments: system.sourceDocuments,
    standardCoverage: system.standardCoverage,
    institutionScopes: system.institutionScopes,
    exchangeTasks: system.exchangeTasks,
    exchangeRuns: system.exchangeRuns,
    institutionTasks: system.institutionTasks,
    onsiteAcceptances: system.onsiteAcceptances,
    riskQueue: system.riskQueue,
    readinessEvidence: system.readinessEvidence,
    checks,
    system
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const domainRows = report.system.standardDomains.map((item) => `| ${item.order} | ${item.category} | ${item.name} | ${item.secondaryCount} | ${item.tertiaryCount} | ${item.owner} | ${item.linkedRecords} |`);
  const scopeRows = report.institutionScopes.map((item) => `| ${item.name} | ${item.responsibilities.join("、")} | ${item.coveredDomains.join("、")} | ${item.status} |`);
  const riskRows = report.riskQueue.slice(0, 12).map((item) => `| ${item.priority} | ${item.domain} | ${item.signal} | ${item.institution} | ${item.status} | ${item.commandAction.replace(/\|/g, "/")} |`);
  const exchangeRows = report.exchangeTasks.map((item) => `| ${item.category} | ${item.name} | ${item.sourceSystems.join("、")} | ${item.targetCollections.join("、")} | ${item.status} |`);
  const exchangeRunRows = report.exchangeRuns.map((item) => `| ${item.category} | ${item.sourceSystem} | ${item.status} | ${item.receiptStatus} | ${item.compensationStatus} | ${item.payloadRecords || 0}/${item.failedRecords || 0} | ${item.nextAction.replace(/\|/g, "/")} |`);
  const institutionTaskRows = report.institutionTasks.map((item) => `| ${item.roleView} | ${item.taskType} | ${item.owner} | ${item.status} | ${item.handoffStatus} | ${item.accountStatus} | ${item.nextAction.replace(/\|/g, "/")} |`);
  const onsiteRows = report.onsiteAcceptances.map((item) => `| ${item.severity} | ${item.category} | ${item.name} | ${item.owner} | ${item.status} | ${item.signoffStatus} | ${item.onsiteAction.replace(/\|/g, "/")} |`);
  return [
    "# Public health informatization readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Standard coverage: ${report.summary.domains}/${report.summary.secondaryIndicators}/${report.summary.tertiaryIndicators}`,
    `- Institution scopes: ${report.summary.institutionScopes}`,
    `- Events: ${report.summary.events}, high priority ${report.summary.highPriorityEvents}`,
    `- Event actions recorded: ${report.summary.eventActions}`,
    `- Exchange tasks: ${report.summary.exchangeTasks}`,
    `- Exchange runs: ${report.summary.exchangeRuns}, compensated ${report.summary.compensatedExchangeRuns}`,
    `- Institution tasks: ${report.summary.institutionTasks}`,
    `- On-site acceptance rows: ${report.summary.onsiteAcceptances}, ready ${report.summary.onsiteReady}`,
    "",
    "## Checks",
    "",
    "| Result | Category | Check | Detail |",
    "|---|---|---|---|",
    ...checkRows,
    "",
    "## Standard domains",
    "",
    "| # | Type | Domain | Secondary | Tertiary | Owner | Linked records |",
    "|---:|---|---|---:|---:|---|---:|",
    ...domainRows,
    "",
    "## Institution scopes",
    "",
    "| Institution | Responsibilities | Domains | Status |",
    "|---|---|---|---|",
    ...scopeRows,
    "",
    "## Risk queue",
    "",
    "| Priority | Domain | Signal | Institution | Status | Command action |",
    "|---|---|---|---|---|---|",
    ...riskRows,
    "",
    "## Exchange tasks",
    "",
    "| Category | Task | Sources | Platform collections | Status |",
    "|---|---|---|---|---|",
    ...exchangeRows,
    "",
    "## Exchange runs",
    "",
    "| Category | Source | Status | Receipt | Compensation | Records failed | Next action |",
    "|---|---|---|---|---|---|---|",
    ...exchangeRunRows,
    "",
    "## Institution collaboration tasks",
    "",
    "| Role view | Task | Owner | Status | Handoff | Account | Next action |",
    "|---|---|---|---|---|---|---|",
    ...institutionTaskRows,
    "",
    "## On-site acceptance",
    "",
    "| Severity | Category | Name | Owner | Status | Signoff | On-site action |",
    "|---|---|---|---|---|---|---|",
    ...onsiteRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildPublicHealthReadinessReport();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  SOURCE_DOCUMENTS,
  STANDARD_TOTALS,
  buildPublicHealthReadinessReport,
  buildPublicHealthSystem,
  parseArgs,
  renderMarkdown,
  seedPublicHealthExchangeRuns,
  seedPublicHealthExchangeTasks,
  seedPublicHealthEvents,
  seedPublicHealthInstitutionTasks,
  seedPublicHealthInstitutionScopes,
  seedPublicHealthOnsiteAcceptances,
  seedPublicHealthReadinessEvidence,
  seedPublicHealthStandards,
  writeOutput
};
