#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { buildPublicHealthHighlights } = require("../public-health-highlights-service");

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

function seedPublicHealthStandardImplementationLedger() {
  return seedPublicHealthStandards().map((domain) => ({
    id: `phsil-${String(domain.id || "").replace(/^ph-/, "")}`,
    standardDomainId: domain.id,
    order: domain.order,
    name: domain.name,
    category: domain.category,
    owner: domain.owner,
    secondaryCount: domain.secondaryCount,
    tertiaryCount: domain.tertiaryCount,
    tertiaryRange: domain.tertiaryRange,
    dataCollections: domain.dataCollections || [],
    interfaces: domain.interfaces || [],
    requiredChecks: ["责任方确认", "数据集合映射", "接口映射", "现场验收证据"],
    status: "modeled",
    gapStatus: "not-assessed",
    siteEvidenceId: "",
    nextAction: "与责任机构复核标准映射；现场签署证据形成后单独关联，不以映射记录替代验收。"
  }));
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

function seedPublicHealthCutoverBlockers() {
  return [
    { id: "phcb-direct-report-endpoint", category: "外部接口", name: "疾控直报正式接口地址和回执规则", severity: "P0", owner: "疾控中心/规划信息", assignee: "接口联调专班", dependency: "疾控直报", status: "open", remediationStatus: "待联调", escalationLevel: "red", blocker: "缺少正式接口地址、VPN/专线策略、字段版本和回执样例。", requiredEvidence: ["接口地址确认单", "字段版本", "回执样例"], linkedAcceptanceId: "phoa-interface-joint-test", linkedExchangeTaskId: "phx-national-direct-report", dueAt: "2026-07-18", siteWindow: "接口联调日 T-3", reminderChannel: "项目群+电话", resolutionAction: "完成现场联调并上传直报回执和字段版本签字页。" },
    { id: "phcb-lis-emr-credentials", category: "院内系统", name: "HIS/EMR/LIS/PACS 院内接口账号和签名密钥", severity: "P0", owner: "医院信息/院感/检验联络员", assignee: "医院接口负责人", dependency: "HIS/EMR/LIS/PACS", status: "open", remediationStatus: "待授权", escalationLevel: "red", blocker: "缺少院内测试账号、签名密钥、样本编号规则和阳性回传回执。", requiredEvidence: ["账号授权单", "签名密钥交接", "阳性回传回执"], linkedAcceptanceId: "phoa-interface-joint-test", linkedExchangeTaskId: "phx-lab-surveillance", dueAt: "2026-07-19", siteWindow: "医院联调日 T-2", reminderChannel: "项目群+院内工单", resolutionAction: "完成院内系统样例联调并保全签名哈希。" },
    { id: "phcb-immunization-registry", category: "专项系统", name: "预防接种档案、冷链和异常反应回执", severity: "P1", owner: "疾控免疫规划/基层公卫专班", assignee: "免疫规划联络员", dependency: "预防接种系统", status: "open", remediationStatus: "待样例", escalationLevel: "amber", blocker: "缺少儿童接种档案、冷链异常和异常反应的正式回执口径。", requiredEvidence: ["接种档案样例", "冷链异常回执", "异常反应回执"], linkedAcceptanceId: "phoa-emergency-drill", linkedExchangeTaskId: "phx-immunization", dueAt: "2026-07-20", siteWindow: "专项系统联调日", reminderChannel: "项目群", resolutionAction: "完成接种档案和冷链异常样例回放。" },
    { id: "phcb-security-assessment", category: "安全合规", name: "等保密评、国密设备和日志保全报告", severity: "P0", owner: "安全管理岗", assignee: "安全合规负责人", dependency: "等保密评和国密设备", status: "open", remediationStatus: "待报告", escalationLevel: "red", blocker: "缺少正式测评报告、整改承诺、国密设备配置和日志保全截图。", requiredEvidence: ["等保报告", "密评报告", "国密配置", "日志保全截图"], linkedAcceptanceId: "phoa-security-level-protection", linkedExchangeTaskId: "phx-security-audit", dueAt: "2026-07-21", siteWindow: "安全验收日 T-1", reminderChannel: "安全例会", resolutionAction: "归档测评报告、整改清单和日志保全证据。" },
    { id: "phcb-backup-drill", category: "运维演练", name: "公共卫生数据备份恢复演练", severity: "P0", owner: "运维保障组", assignee: "运维值班长", dependency: "备份系统", status: "open", remediationStatus: "待演练", escalationLevel: "red", blocker: "缺少现场备份介质、恢复截图、RPO/RTO 记录和演练签字。", requiredEvidence: ["备份介质记录", "恢复截图", "RPO/RTO", "演练签字页"], linkedAcceptanceId: "phoa-backup-restore", linkedExchangeTaskId: "phx-security-audit", dueAt: "2026-07-22", siteWindow: "切换演练日", reminderChannel: "运维工单", resolutionAction: "完成一次公共卫生事件和交换台账恢复演练。" },
    { id: "phcb-site-contacts", category: "现场组织", name: "七类机构联系人、授权范围和账号清单", severity: "P1", owner: "卫健管理部门/各机构联络员", assignee: "项目办", dependency: "现场联系人和账号授权", status: "open", remediationStatus: "待签字", escalationLevel: "amber", blocker: "缺少疾控、基层、卫健、监督、妇幼、医院和其他公卫机构联系人签字。", requiredEvidence: ["联系人清单", "授权范围", "账号清单"], linkedAcceptanceId: "phoa-institution-accounts", linkedExchangeTaskId: "", dueAt: "2026-07-23", siteWindow: "上线确认会", reminderChannel: "项目群+邮件", resolutionAction: "完成七类机构账号、联系人和数据范围确认。" }
  ];
}

function seedPublicHealthCutoverEvidencePackets(blockers = seedPublicHealthCutoverBlockers()) {
  return (Array.isArray(blockers) ? blockers : []).map((blocker) => ({
    id: `phcep-${String(blocker.id || "").replace(/^phcb-/, "")}`,
    blockerId: blocker.id,
    category: blocker.category,
    name: `${blocker.name}证据包`,
    severity: blocker.severity,
    owner: blocker.owner,
    assignee: blocker.assignee || blocker.owner,
    status: "pending-site-evidence",
    signoffStatus: "pending",
    dueAt: blocker.dueAt || "",
    siteWindow: blocker.siteWindow || "",
    reminderChannel: blocker.reminderChannel || "",
    requiredItems: (blocker.requiredEvidence || []).map((name, index) => ({
      id: `${blocker.id}-e${index + 1}`,
      name,
      required: true,
      status: "pending",
      artifactName: "",
      attachmentNames: [],
      verifiedBy: "",
      verifiedAt: "",
      note: ""
    })),
    evidenceRecords: [],
    nextAction: blocker.resolutionAction || ""
  }));
}

function seedPublicHealthLaunchApprovals() {
  return [
    { id: "phla-health-admin", gateId: "public-health-production-launch", role: "health-admin", owner: "市卫健委规划信息处", approver: "卫健委上线审批人", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["上线审批单", "值守排班", "发布版本号"], nextAction: "确认公共卫生生产上线范围、窗口和回退责任人。" },
    { id: "phla-cdc", gateId: "public-health-production-launch", role: "cdc", owner: "市疾控中心应急办", approver: "疾控业务负责人", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["直报接口回执", "流调责任人", "应急会商记录"], nextAction: "确认疾控直报、流调、实验室和应急指挥闭环已签收。" },
    { id: "phla-hospital", gateId: "public-health-production-launch", role: "hospital", owner: "医院信息/院感/检验联络员", approver: "医院接口负责人", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["HIS/EMR/LIS/PACS 联调回执", "账号授权单", "签名密钥交接"], nextAction: "确认医疗机构医防协同接口和账号授权已签收。" },
    { id: "phla-security", gateId: "public-health-production-launch", role: "security", owner: "安全管理岗", approver: "安全合规负责人", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["等保报告", "密评报告", "国密配置", "日志保全截图"], nextAction: "确认安全测评、国密和日志保全材料已归档。" },
    { id: "phla-operations", gateId: "public-health-production-launch", role: "operations", owner: "运维保障组", approver: "运维值班长", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["备份恢复演练", "RPO/RTO 记录", "值守工单"], nextAction: "确认备份恢复、监控值守和回退窗口已签收。" },
    { id: "phla-project-office", gateId: "public-health-production-launch", role: "project-office", owner: "项目办/发布经理", approver: "项目发布经理", status: "pending", decision: "pending", dueAt: "2026-07-24", requiredEvidence: ["验收清单", "培训签到", "发布报告"], nextAction: "汇总所有现场签字页并提交最终上线申请。" }
  ];
}

function seedPublicHealthCutoverDrills() {
  return [
    {
      id: "phdr-interface-dry-run",
      scenario: "interface-cutover",
      name: "Public health interface cutover dry run",
      phase: "T-3",
      owner: "interface joint-test team",
      status: "blocked",
      goNoGo: "no-go",
      retestStatus: "pending",
      linkedBlockerIds: ["phcb-direct-report-endpoint", "phcb-lis-emr-credentials"],
      linkedAcceptanceIds: ["phoa-interface-joint-test"],
      evidence: ["publicHealthExchangeRuns", "publicHealthSiteEvidenceBridge"],
      blockers: ["formal direct-report receipt missing", "hospital signature key handoff pending"],
      findings: [
        { id: "phdr-interface-dry-run-f1", severity: "P0", status: "open", finding: "Direct-report endpoint receipt and hospital signature key must be signed before production.", owner: "interface joint-test team", retestStatus: "pending" }
      ],
      nextAction: "Complete direct-report endpoint receipt, hospital account authorization and signature key handoff retest."
    },
    {
      id: "phdr-emergency-command",
      scenario: "emergency-command",
      name: "Emergency command tabletop and dispatch drill",
      phase: "T-2",
      owner: "health emergency and CDC team",
      status: "retest-required",
      goNoGo: "conditional",
      retestStatus: "pending",
      linkedBlockerIds: ["phcb-immunization-registry"],
      linkedAcceptanceIds: ["phoa-emergency-drill"],
      evidence: ["publicHealthEvents", "resourceDispatchRequests"],
      blockers: ["duty roster signoff pending"],
      findings: [
        { id: "phdr-emergency-command-f1", severity: "P1", status: "open", finding: "Duty roster, video conference record and dispatch receipt need one signed retest.", owner: "health emergency and CDC team", retestStatus: "pending" }
      ],
      nextAction: "Replay one high-priority event from signal to dispatch receipt and signed review."
    },
    {
      id: "phdr-security-compliance",
      scenario: "security-compliance",
      name: "Security assessment and audit retention drill",
      phase: "T-1",
      owner: "security compliance team",
      status: "blocked",
      goNoGo: "no-go",
      retestStatus: "pending",
      linkedBlockerIds: ["phcb-security-assessment"],
      linkedAcceptanceIds: ["phoa-security-level-protection"],
      evidence: ["securityAcceptanceLedger", "audit:retention"],
      blockers: ["assessment report pending", "GM device screenshots pending"],
      findings: [
        { id: "phdr-security-compliance-f1", severity: "P0", status: "open", finding: "Security assessment report, remediation commitment and GM screenshots are not signed.", owner: "security compliance team", retestStatus: "pending" }
      ],
      nextAction: "Record assessment report, remediation list, GM configuration and audit-retention screenshots."
    },
    {
      id: "phdr-backup-rollback",
      scenario: "backup-rollback",
      name: "Backup restore and rollback rehearsal",
      phase: "T-1",
      owner: "operations support team",
      status: "blocked",
      goNoGo: "no-go",
      retestStatus: "pending",
      linkedBlockerIds: ["phcb-backup-drill"],
      linkedAcceptanceIds: ["phoa-backup-restore"],
      evidence: ["launch:smoke", "rollback:snapshot"],
      blockers: ["RPO/RTO screenshot pending"],
      findings: [
        { id: "phdr-backup-rollback-f1", severity: "P0", status: "open", finding: "Backup media, restore screenshot and RPO/RTO record are not signed.", owner: "operations support team", retestStatus: "pending" }
      ],
      nextAction: "Run one restore rehearsal for public-health event and exchange ledgers, then archive RPO/RTO evidence."
    },
    {
      id: "phdr-launch-tabletop",
      scenario: "launch-tabletop",
      name: "Launch command tabletop and go/no-go meeting",
      phase: "T-0",
      owner: "project office and release manager",
      status: "pending",
      goNoGo: "no-go",
      retestStatus: "pending",
      linkedBlockerIds: ["phcb-site-contacts"],
      linkedAcceptanceIds: ["phoa-institution-accounts", "phoa-release-package"],
      evidence: ["publicHealthLaunchApprovals", "publicHealthReadinessEvidence"],
      blockers: ["multi-party final signatures pending"],
      findings: [
        { id: "phdr-launch-tabletop-f1", severity: "P1", status: "open", finding: "Final health-admin, CDC, hospital, security, operations and project-office approvals are pending.", owner: "project office and release manager", retestStatus: "pending" }
      ],
      nextAction: "Hold launch tabletop after all P0/P1 blockers and evidence packets are closed."
    }
  ];
}

function seedPublicHealthProductionHandoffs() {
  return [
    {
      id: "phhandoff-interface",
      packageType: "interface",
      name: "Direct-report and hospital interface handoff pack",
      owner: "interface joint-test team",
      receiver: "CDC direct-report owner and hospital interface owner",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["CDC direct-report receipt", "HIS/EMR/LIS/PACS account sheet", "signature key handoff"],
      evidencePacketIds: ["phcep-direct-report-endpoint", "phcep-lis-emr-credentials"],
      blockerIds: ["phcb-direct-report-endpoint", "phcb-lis-emr-credentials"],
      acceptanceIds: ["phoa-interface-joint-test"],
      drillIds: ["phdr-interface-dry-run"],
      approvalIds: ["phla-cdc", "phla-hospital"],
      releaseArtifacts: ["release/public-health-readiness-report.md", "release/integration-readiness-report.md"],
      nextAction: "Collect signed direct-report receipt, hospital account sheet and signature-key custody page."
    },
    {
      id: "phhandoff-command",
      packageType: "command",
      name: "Emergency command and duty-roster handoff pack",
      owner: "health emergency and CDC team",
      receiver: "health emergency duty office",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["duty roster", "video meeting record", "dispatch receipt"],
      evidencePacketIds: ["phcep-immunization-registry"],
      blockerIds: ["phcb-immunization-registry"],
      acceptanceIds: ["phoa-emergency-drill"],
      drillIds: ["phdr-emergency-command"],
      approvalIds: ["phla-cdc", "phla-health-admin"],
      releaseArtifacts: ["release/public-health-readiness-report.md"],
      nextAction: "Archive emergency tabletop minutes, dispatch receipt and duty roster before go/no-go."
    },
    {
      id: "phhandoff-security",
      packageType: "security",
      name: "Security assessment and national-crypto handoff pack",
      owner: "security compliance team",
      receiver: "security compliance owner",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["classified protection report", "cryptography assessment", "GM configuration screenshot", "audit retention screenshot"],
      evidencePacketIds: ["phcep-security-assessment"],
      blockerIds: ["phcb-security-assessment"],
      acceptanceIds: ["phoa-security-level-protection"],
      drillIds: ["phdr-security-compliance"],
      approvalIds: ["phla-security"],
      releaseArtifacts: ["release/audit-retention-report.md", "release/site-readiness-pack.md"],
      nextAction: "Attach assessment report, remediation commitment, GM configuration and audit-retention screenshots."
    },
    {
      id: "phhandoff-operations",
      packageType: "operations",
      name: "Backup restore and rollback handoff pack",
      owner: "operations support team",
      receiver: "operations duty lead",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["backup media record", "restore screenshot", "RPO/RTO record", "rollback window"],
      evidencePacketIds: ["phcep-backup-drill"],
      blockerIds: ["phcb-backup-drill"],
      acceptanceIds: ["phoa-backup-restore"],
      drillIds: ["phdr-backup-rollback"],
      approvalIds: ["phla-operations"],
      releaseArtifacts: ["release/launch-smoke-report.md", "release/production-cutover-checklist.md"],
      nextAction: "Complete one restore rehearsal and attach RPO/RTO plus rollback owner evidence."
    },
    {
      id: "phhandoff-institution",
      packageType: "institution",
      name: "Seven-institution account and contact handoff pack",
      owner: "project office",
      receiver: "institution liaison group",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["contact list", "authorization scope", "account list"],
      evidencePacketIds: ["phcep-site-contacts"],
      blockerIds: ["phcb-site-contacts"],
      acceptanceIds: ["phoa-institution-accounts"],
      drillIds: ["phdr-launch-tabletop"],
      approvalIds: ["phla-health-admin", "phla-project-office"],
      releaseArtifacts: ["release/site-readiness-pack.md"],
      nextAction: "Confirm seven institution contacts, account scopes and escalation owners."
    },
    {
      id: "phhandoff-release",
      packageType: "release",
      name: "Release archive and final go/no-go handoff pack",
      owner: "release manager",
      receiver: "health commission launch board",
      status: "pending-site-handoff",
      dueAt: "2026-07-24",
      requiredSignoffs: ["release report", "deploy check", "launch smoke", "final go/no-go minutes"],
      evidencePacketIds: ["phcep-site-contacts"],
      blockerIds: ["phcb-site-contacts"],
      acceptanceIds: ["phoa-release-package"],
      drillIds: ["phdr-launch-tabletop"],
      approvalIds: ["phla-health-admin", "phla-project-office"],
      releaseArtifacts: ["release/release-report.md", "release/release-artifact-manifest.md", "release/launch-smoke-report.md"],
      nextAction: "Archive release manifest, deploy check, launch smoke and final go/no-go minutes."
    }
  ];
}

function seedPublicHealthGoLiveObservations() {
  return [
    {
      id: "phgl-live-smoke",
      window: "T+0-15m",
      phase: "launch-open",
      name: "Live health and public-health API smoke watch",
      owner: "release manager",
      status: "scheduled",
      severity: "P0",
      metric: "/api/health and /api/public-health/system",
      threshold: "HTTP 200 within 5 seconds for three consecutive probes",
      rollbackTrigger: "Health or public-health system API unavailable for 5 minutes",
      rollbackOwner: "operations duty lead",
      evidence: ["/api/health", "/api/public-health/system", "launch:smoke"],
      linkedHandoffIds: ["phhandoff-release", "phhandoff-operations"],
      linkedApprovalIds: ["phla-operations", "phla-project-office"],
      requiredArtifacts: ["live-smoke-report", "launch-room-screenshot"],
      nextAction: "Run authenticated live smoke from the launch room and archive the report."
    },
    {
      id: "phgl-direct-report-receipt",
      window: "T+15-60m",
      phase: "first-exchange",
      name: "Direct-report and hospital receipt watch",
      owner: "interface joint-test team",
      status: "scheduled",
      severity: "P0",
      metric: "direct-report, LIS and hospital callback receipts",
      threshold: "First production exchange batch has accepted receipt and zero untriaged failures",
      rollbackTrigger: "Receipt missing or untriaged P0 callback failure after 30 minutes",
      rollbackOwner: "CDC direct-report owner",
      evidence: ["publicHealthExchangeRuns", "publicHealthCutoverEvidencePackets"],
      linkedHandoffIds: ["phhandoff-interface"],
      linkedApprovalIds: ["phla-cdc", "phla-hospital"],
      requiredArtifacts: ["direct-report-receipt", "hospital-callback-screenshot"],
      nextAction: "Capture the first accepted production receipt and any compensation decision."
    },
    {
      id: "phgl-command-duty",
      window: "T+1h-4h",
      phase: "command-duty",
      name: "Emergency command duty and event dispatch watch",
      owner: "health emergency duty office",
      status: "scheduled",
      severity: "P1",
      metric: "event dispatch, duty roster and command receipt",
      threshold: "Duty owner confirms event queue, dispatch channel and command receipt",
      rollbackTrigger: "Duty roster unavailable or command channel cannot receive event dispatch",
      rollbackOwner: "health emergency duty lead",
      evidence: ["publicHealthEvents", "resourceDispatchRequests"],
      linkedHandoffIds: ["phhandoff-command"],
      linkedApprovalIds: ["phla-health-admin", "phla-cdc"],
      requiredArtifacts: ["duty-roster-confirmation", "event-dispatch-screenshot"],
      nextAction: "Record the duty roster confirmation and one command-channel probe."
    },
    {
      id: "phgl-security-audit",
      window: "T+0-4h",
      phase: "security-watch",
      name: "Security audit, authentication and GM-device watch",
      owner: "security compliance team",
      status: "scheduled",
      severity: "P0",
      metric: "login audit, high-risk event audit and GM-device evidence",
      threshold: "Audit chain verifies and no critical denied security event is open",
      rollbackTrigger: "Audit chain verification fails or GM/signature device is unavailable",
      rollbackOwner: "security compliance owner",
      evidence: ["securityEvents", "dataAccessLogs", "audit:retention"],
      linkedHandoffIds: ["phhandoff-security"],
      linkedApprovalIds: ["phla-security"],
      requiredArtifacts: ["audit-verify-report", "gm-device-screenshot"],
      nextAction: "Run audit verification and archive security watch screenshots."
    },
    {
      id: "phgl-rollback-window",
      window: "T+0-24h",
      phase: "rollback-standby",
      name: "Backup restore and rollback standby watch",
      owner: "operations support team",
      status: "scheduled",
      severity: "P0",
      metric: "backup snapshot, restore rehearsal and rollback owner availability",
      threshold: "Rollback owner, latest backup and rollback checklist are available during the watch window",
      rollbackTrigger: "Latest backup unavailable, RPO/RTO breach, or rollback owner unreachable",
      rollbackOwner: "operations duty lead",
      evidence: ["rollback:snapshot", "release/production-cutover-checklist.md"],
      linkedHandoffIds: ["phhandoff-operations", "phhandoff-release"],
      linkedApprovalIds: ["phla-operations"],
      requiredArtifacts: ["backup-snapshot-id", "rollback-owner-confirmation"],
      nextAction: "Confirm backup snapshot id, rollback owner and RPO/RTO watch interval."
    },
    {
      id: "phgl-institution-helpdesk",
      window: "T+0-24h",
      phase: "institution-support",
      name: "Seven-institution account and helpdesk watch",
      owner: "project office",
      status: "scheduled",
      severity: "P1",
      metric: "institution login, helpdesk queue and account authorization",
      threshold: "Seven institution contact paths and account support queue are staffed",
      rollbackTrigger: "More than one institution cannot access launch-critical role scope",
      rollbackOwner: "project office launch coordinator",
      evidence: ["publicHealthInstitutionTasks", "authUsers", "siteLaunchEvidence"],
      linkedHandoffIds: ["phhandoff-institution"],
      linkedApprovalIds: ["phla-health-admin", "phla-project-office"],
      requiredArtifacts: ["institution-contact-roster", "account-support-log"],
      nextAction: "Confirm institution contact roster and launch-day account support queue."
    }
  ];
}

function seedPublicHealthLaunchIncidents() {
  return [
    {
      id: "phli-api-smoke",
      lane: "api-smoke",
      name: "Launch health and public-health API incident lane",
      owner: "release manager",
      status: "standby",
      severity: "P0",
      sla: "triage within 15 minutes, rollback decision within 30 minutes",
      escalationPath: ["release manager", "operations duty lead", "health commission launch board"],
      rollbackDecisionOwner: "operations duty lead",
      linkedObservationIds: ["phgl-live-smoke"],
      linkedHandoffIds: ["phhandoff-release", "phhandoff-operations"],
      evidence: ["/api/health", "/api/public-health/system", "launch:smoke"],
      requiredArtifacts: ["incident-ticket", "decision-log", "live-smoke-screenshot"],
      nextAction: "Keep launch room ticket owner, health check probe and rollback decision owner online."
    },
    {
      id: "phli-direct-report",
      lane: "direct-report",
      name: "Direct-report and hospital callback incident lane",
      owner: "interface joint-test team",
      status: "standby",
      severity: "P0",
      sla: "triage within 20 minutes, compensation or rollback decision within 45 minutes",
      escalationPath: ["CDC direct-report owner", "hospital interface owner", "release manager"],
      rollbackDecisionOwner: "CDC direct-report owner",
      linkedObservationIds: ["phgl-direct-report-receipt"],
      linkedHandoffIds: ["phhandoff-interface"],
      evidence: ["publicHealthExchangeRuns", "publicHealthCutoverEvidencePackets"],
      requiredArtifacts: ["receipt-screenshot", "failed-payload-sample", "compensation-decision"],
      nextAction: "Prepare first-batch receipt triage and compensation owner before opening production exchange."
    },
    {
      id: "phli-command-duty",
      lane: "command-duty",
      name: "Emergency command duty incident lane",
      owner: "health emergency duty office",
      status: "standby",
      severity: "P1",
      sla: "triage within 30 minutes, command workaround within 60 minutes",
      escalationPath: ["health emergency duty lead", "CDC command owner", "health-admin approver"],
      rollbackDecisionOwner: "health emergency duty lead",
      linkedObservationIds: ["phgl-command-duty"],
      linkedHandoffIds: ["phhandoff-command"],
      evidence: ["publicHealthEvents", "resourceDispatchRequests"],
      requiredArtifacts: ["duty-roster-note", "dispatch-channel-test", "workaround-decision"],
      nextAction: "Keep duty roster, video meeting room and fallback dispatch channel ready."
    },
    {
      id: "phli-security-audit",
      lane: "security-audit",
      name: "Security audit and authentication incident lane",
      owner: "security compliance team",
      status: "standby",
      severity: "P0",
      sla: "triage within 15 minutes, security go/no-go within 30 minutes",
      escalationPath: ["security compliance owner", "operations duty lead", "health commission launch board"],
      rollbackDecisionOwner: "security compliance owner",
      linkedObservationIds: ["phgl-security-audit"],
      linkedHandoffIds: ["phhandoff-security"],
      evidence: ["securityEvents", "dataAccessLogs", "audit:retention"],
      requiredArtifacts: ["audit-verify-report", "authentication-error-sample", "security-decision-log"],
      nextAction: "Keep audit verification owner and authentication fallback decision path online."
    },
    {
      id: "phli-backup-rollback",
      lane: "backup-rollback",
      name: "Backup restore and rollback execution incident lane",
      owner: "operations support team",
      status: "standby",
      severity: "P0",
      sla: "triage within 15 minutes, rollback execution decision within 30 minutes",
      escalationPath: ["operations duty lead", "release manager", "health commission launch board"],
      rollbackDecisionOwner: "operations duty lead",
      linkedObservationIds: ["phgl-rollback-window"],
      linkedHandoffIds: ["phhandoff-operations", "phhandoff-release"],
      evidence: ["rollback:snapshot", "release/production-cutover-checklist.md"],
      requiredArtifacts: ["backup-snapshot-id", "rollback-command-log", "rpo-rto-note"],
      nextAction: "Keep latest backup snapshot id, rollback command owner and RPO/RTO decision log ready."
    },
    {
      id: "phli-institution-helpdesk",
      lane: "institution-helpdesk",
      name: "Institution account and helpdesk incident lane",
      owner: "project office",
      status: "standby",
      severity: "P1",
      sla: "triage within 30 minutes, account workaround within 60 minutes",
      escalationPath: ["project office launch coordinator", "institution liaison", "identity administrator"],
      rollbackDecisionOwner: "project office launch coordinator",
      linkedObservationIds: ["phgl-institution-helpdesk"],
      linkedHandoffIds: ["phhandoff-institution"],
      evidence: ["publicHealthInstitutionTasks", "authUsers", "siteLaunchEvidence"],
      requiredArtifacts: ["helpdesk-ticket", "account-scope-check", "institution-contact-note"],
      nextAction: "Keep institution contact roster and account-support escalation path ready."
    }
  ];
}

function seedPublicHealthLaunchDutyShifts() {
  return [
    {
      id: "phlds-release-room",
      shiftWindow: "T-2h to T+4h",
      lane: "release-room",
      name: "Release command room duty handoff",
      owner: "release manager",
      backupOwner: "project office launch coordinator",
      status: "scheduled",
      contactChannel: "launch-room bridge + work order group",
      escalationOwner: "health commission launch board",
      linkedObservationIds: ["phgl-live-smoke"],
      linkedIncidentIds: ["phli-api-smoke", "phli-backup-rollback"],
      linkedHandoffIds: ["phhandoff-release"],
      handoffChecklist: ["go/no-go minutes", "launch smoke owner", "rollback decision path"],
      requiredArtifacts: ["duty-roster", "bridge-room-screenshot", "handoff-note"],
      nextAction: "Confirm command room bridge, go/no-go recorder and release duty owner before launch window opens."
    },
    {
      id: "phlds-cdc-direct-report",
      shiftWindow: "T+0 to T+8h",
      lane: "direct-report",
      name: "CDC direct-report duty handoff",
      owner: "CDC direct-report owner",
      backupOwner: "CDC surveillance duty backup",
      status: "scheduled",
      contactChannel: "CDC duty phone + direct-report group",
      escalationOwner: "CDC business lead",
      linkedObservationIds: ["phgl-direct-report-receipt"],
      linkedIncidentIds: ["phli-direct-report"],
      linkedHandoffIds: ["phhandoff-interface", "phhandoff-command"],
      handoffChecklist: ["first batch receipt", "failed payload triage", "manual compensation owner"],
      requiredArtifacts: ["cdc-duty-roster", "receipt-watch-note", "compensation-owner-note"],
      nextAction: "Keep CDC receipt reviewer and compensation owner reachable for the first exchange batch."
    },
    {
      id: "phlds-hospital-interface",
      shiftWindow: "T+0 to T+8h",
      lane: "hospital-callback",
      name: "Hospital callback and LIS/EMR duty handoff",
      owner: "hospital interface owner",
      backupOwner: "hospital information duty engineer",
      status: "scheduled",
      contactChannel: "hospital IT group + interface vendor bridge",
      escalationOwner: "hospital launch approver",
      linkedObservationIds: ["phgl-direct-report-receipt"],
      linkedIncidentIds: ["phli-direct-report"],
      linkedHandoffIds: ["phhandoff-interface"],
      handoffChecklist: ["callback receipt owner", "signature key owner", "sample id query owner"],
      requiredArtifacts: ["hospital-duty-roster", "callback-receipt-note", "interface-vendor-contact"],
      nextAction: "Confirm callback receipt and signature-key owners before the first production callback."
    },
    {
      id: "phlds-security-audit",
      shiftWindow: "T-1h to T+8h",
      lane: "security-audit",
      name: "Security audit and authentication duty handoff",
      owner: "security compliance owner",
      backupOwner: "security operations backup",
      status: "scheduled",
      contactChannel: "security duty phone + audit channel",
      escalationOwner: "security launch approver",
      linkedObservationIds: ["phgl-security-audit"],
      linkedIncidentIds: ["phli-security-audit"],
      linkedHandoffIds: ["phhandoff-security"],
      handoffChecklist: ["login audit monitor", "denied event triage", "GM device fallback"],
      requiredArtifacts: ["security-duty-roster", "audit-monitor-screenshot", "gm-device-contact"],
      nextAction: "Confirm audit monitor, denied-event triage owner and GM-device fallback owner."
    },
    {
      id: "phlds-operations-rollback",
      shiftWindow: "T-2h to T+24h",
      lane: "operations-rollback",
      name: "Operations rollback and backup duty handoff",
      owner: "operations duty lead",
      backupOwner: "backup restore engineer",
      status: "scheduled",
      contactChannel: "operations bridge + backup restore group",
      escalationOwner: "operations launch approver",
      linkedObservationIds: ["phgl-rollback-window"],
      linkedIncidentIds: ["phli-backup-rollback"],
      linkedHandoffIds: ["phhandoff-operations", "phhandoff-release"],
      handoffChecklist: ["backup snapshot id", "restore command owner", "RPO/RTO watch"],
      requiredArtifacts: ["backup-snapshot-note", "rollback-owner-roster", "rpo-rto-watch-note"],
      nextAction: "Confirm backup snapshot id, restore command owner and rollback bridge before launch."
    },
    {
      id: "phlds-institution-helpdesk",
      shiftWindow: "T+0 to T+24h",
      lane: "institution-helpdesk",
      name: "Seven-institution helpdesk duty handoff",
      owner: "project office launch coordinator",
      backupOwner: "institution liaison backup",
      status: "scheduled",
      contactChannel: "institution helpdesk queue + contact roster",
      escalationOwner: "project office approver",
      linkedObservationIds: ["phgl-institution-helpdesk"],
      linkedIncidentIds: ["phli-institution-helpdesk"],
      linkedHandoffIds: ["phhandoff-institution"],
      handoffChecklist: ["contact roster", "account scope support", "first-line FAQ owner"],
      requiredArtifacts: ["institution-contact-roster", "account-helpdesk-log", "faq-owner-note"],
      nextAction: "Confirm contact roster, account helpdesk queue and first-line FAQ owner."
    }
  ];
}

function seedPublicHealthLaunchCommandBriefs() {
  return [
    {
      id: "phlcb-prelaunch-go-no-go",
      briefWindow: "T-1h",
      phase: "prelaunch",
      name: "Prelaunch go/no-go command brief",
      owner: "release manager",
      recorder: "command room recorder",
      status: "draft-ready",
      audience: ["health commission launch board", "CDC command owner", "operations duty lead"],
      sourceBoards: ["launchGate", "cutoverReadiness", "productionHandoffBoard", "launchDutyBoard"],
      linkedDutyShiftIds: ["phlds-release-room", "phlds-operations-rollback", "phlds-security-audit"],
      linkedObservationIds: ["phgl-live-smoke", "phgl-security-audit", "phgl-rollback-window"],
      linkedIncidentIds: ["phli-api-smoke", "phli-security-audit", "phli-backup-rollback"],
      requiredSections: ["gate status", "open P0/P1 blockers", "rollback decision path", "duty roster confirmation"],
      publishChannel: "launch-room bridge + signed go/no-go minutes",
      publishTarget: "go/no-go meeting minutes",
      decisionOwner: "health commission launch board",
      nextAction: "Publish the prelaunch go/no-go status only after current launch gate, blockers, handoffs and rollback owners are reviewed."
    },
    {
      id: "phlcb-t0-launch-start",
      briefWindow: "T+0",
      phase: "launch-start",
      name: "Launch start command status brief",
      owner: "release manager",
      recorder: "project office launch coordinator",
      status: "draft-ready",
      audience: ["release room", "CDC direct-report owner", "hospital interface owner", "security compliance owner"],
      sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "launchDutyBoard"],
      linkedDutyShiftIds: ["phlds-release-room", "phlds-cdc-direct-report", "phlds-hospital-interface", "phlds-security-audit"],
      linkedObservationIds: ["phgl-live-smoke", "phgl-direct-report-receipt", "phgl-security-audit"],
      linkedIncidentIds: ["phli-api-smoke", "phli-direct-report", "phli-security-audit"],
      requiredSections: ["API smoke", "first exchange window", "security audit watch", "incident lane standby"],
      publishChannel: "launch-room bridge + work order group",
      publishTarget: "launch start status broadcast",
      decisionOwner: "release manager",
      nextAction: "Broadcast launch start state after health check, first exchange owner and incident desk standby are confirmed."
    },
    {
      id: "phlcb-t2-first-receipts",
      briefWindow: "T+2h",
      phase: "first-receipts",
      name: "First receipt and callback command brief",
      owner: "CDC direct-report owner",
      recorder: "interface joint-test recorder",
      status: "draft-ready",
      audience: ["CDC command owner", "hospital interface owner", "interface vendor bridge"],
      sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "siteEvidenceBridge"],
      linkedDutyShiftIds: ["phlds-cdc-direct-report", "phlds-hospital-interface"],
      linkedObservationIds: ["phgl-direct-report-receipt"],
      linkedIncidentIds: ["phli-direct-report"],
      requiredSections: ["direct-report receipt", "hospital callback receipt", "failed payload triage", "manual compensation owner"],
      publishChannel: "CDC duty group + interface work order",
      publishTarget: "first receipt status note",
      decisionOwner: "CDC business lead",
      nextAction: "Record first receipt outcome and any manual compensation decision without closing external evidence blockers automatically."
    },
    {
      id: "phlcb-t8-stability-watch",
      briefWindow: "T+8h",
      phase: "stability-watch",
      name: "Stability watch and risk command brief",
      owner: "operations duty lead",
      recorder: "operations duty recorder",
      status: "draft-ready",
      audience: ["operations bridge", "security compliance owner", "institution helpdesk"],
      sourceBoards: ["goLiveObservationBoard", "launchIncidentBoard", "productionHandoffBoard"],
      linkedDutyShiftIds: ["phlds-security-audit", "phlds-operations-rollback", "phlds-institution-helpdesk"],
      linkedObservationIds: ["phgl-security-audit", "phgl-rollback-window", "phgl-institution-helpdesk"],
      linkedIncidentIds: ["phli-security-audit", "phli-backup-rollback", "phli-institution-helpdesk"],
      requiredSections: ["critical signals", "security audit result", "rollback standby", "institution helpdesk queue"],
      publishChannel: "operations bridge + security channel",
      publishTarget: "T+8 stability watch note",
      decisionOwner: "operations launch approver",
      nextAction: "Publish stability watch summary while keeping rollback and incident decision owners reachable."
    },
    {
      id: "phlcb-t24-closure-handoff",
      briefWindow: "T+24h",
      phase: "closure-handoff",
      name: "First-day closure and handoff command brief",
      owner: "project office launch coordinator",
      recorder: "release archive owner",
      status: "draft-ready",
      audience: ["health commission launch board", "project office", "operations duty lead", "institution liaison"],
      sourceBoards: ["launchGate", "goLiveObservationBoard", "launchIncidentBoard", "launchDutyBoard", "productionHandoffBoard"],
      linkedDutyShiftIds: ["phlds-release-room", "phlds-operations-rollback", "phlds-institution-helpdesk"],
      linkedObservationIds: ["phgl-live-smoke", "phgl-rollback-window", "phgl-institution-helpdesk"],
      linkedIncidentIds: ["phli-api-smoke", "phli-backup-rollback", "phli-institution-helpdesk"],
      requiredSections: ["first-day observations", "open incidents", "handoff gaps", "next 72h watch plan"],
      publishChannel: "project office archive + launch board email",
      publishTarget: "first-day closure handoff brief",
      decisionOwner: "project office approver",
      nextAction: "Archive first-day closure brief and explicitly carry open site evidence, blocker and approval gaps into the next watch cycle."
    }
  ];
}

function seedPublicHealthSiteEvidenceVerificationTasks() {
  return PUBLIC_HEALTH_SITE_EVIDENCE_LINKS.map((link, index) => ({
    id: `phsevt-${link.id.replace(/^ph-sle-/, "")}`,
    sequence: index + 1,
    linkId: link.id,
    templateId: link.templateId,
    packetId: link.packetId,
    blockerId: link.blockerId,
    acceptanceId: link.acceptanceId,
    name: `Site evidence verification: ${link.requirement}`,
    owner: link.owner,
    reviewerRole: "commission",
    status: "scheduled",
    priority: /security|backup|direct-report|immunization/.test(link.id) ? "P0" : "P1",
    verificationWindow: "T-3d to T-1h",
    requiredChecks: ["site evidence recorded", "joint-test receipt or signed artifact", "commission verification"],
    escalationPath: ["site implementation owner", "release manager", "health commission launch board"],
    nextAction: "Record the site evidence first, then verify this task against the matching evidence ID."
  }));
}

const PUBLIC_HEALTH_SITE_EVIDENCE_LINKS = [
  {
    id: "ph-sle-direct-report",
    templateId: "interface-statistics-report-v1",
    packetId: "phcep-direct-report-endpoint",
    blockerId: "phcb-direct-report-endpoint",
    acceptanceId: "phoa-interface-joint-test",
    itemIds: ["phcb-direct-report-endpoint-e1", "phcb-direct-report-endpoint-e2", "phcb-direct-report-endpoint-e3"],
    owner: "cdc-direct-report",
    requirement: "Direct report endpoint, field version and receipt sample"
  },
  {
    id: "ph-sle-his-account",
    templateId: "interface-his-patient-v1",
    packetId: "phcep-lis-emr-credentials",
    blockerId: "phcb-lis-emr-credentials",
    acceptanceId: "phoa-interface-joint-test",
    itemIds: ["phcb-lis-emr-credentials-e1"],
    owner: "hospital-interface",
    requirement: "Hospital account authorization"
  },
  {
    id: "ph-sle-emr-signature",
    templateId: "interface-emr-summary-v1",
    packetId: "phcep-lis-emr-credentials",
    blockerId: "phcb-lis-emr-credentials",
    acceptanceId: "phoa-interface-joint-test",
    itemIds: ["phcb-lis-emr-credentials-e2"],
    owner: "hospital-interface",
    requirement: "Signature key handoff"
  },
  {
    id: "ph-sle-lis-positive-receipt",
    templateId: "interface-lis-report-v1",
    packetId: "phcep-lis-emr-credentials",
    blockerId: "phcb-lis-emr-credentials",
    acceptanceId: "phoa-interface-joint-test",
    itemIds: ["phcb-lis-emr-credentials-e3"],
    owner: "hospital-lab",
    requirement: "Positive result callback receipt"
  },
  {
    id: "ph-sle-immunization-registry",
    templateId: "interface-certificate-sync-v1",
    packetId: "phcep-immunization-registry",
    blockerId: "phcb-immunization-registry",
    acceptanceId: "phoa-emergency-drill",
    itemIds: ["phcb-immunization-registry-e1", "phcb-immunization-registry-e2", "phcb-immunization-registry-e3"],
    owner: "immunization-registry",
    requirement: "Immunization registry, cold-chain and AEFI receipts"
  },
  {
    id: "ph-sle-security-assessment",
    templateId: "signoff-cutover-audit-retention",
    packetId: "phcep-security-assessment",
    blockerId: "phcb-security-assessment",
    acceptanceId: "phoa-security-level-protection",
    itemIds: ["phcb-security-assessment-e1", "phcb-security-assessment-e2", "phcb-security-assessment-e4"],
    owner: "security-compliance",
    requirement: "Security assessment and audit retention evidence"
  },
  {
    id: "ph-sle-gm-config",
    templateId: "signoff-cutover-secrets",
    packetId: "phcep-security-assessment",
    blockerId: "phcb-security-assessment",
    acceptanceId: "phoa-security-level-protection",
    itemIds: ["phcb-security-assessment-e3"],
    owner: "security-compliance",
    requirement: "Secret and national crypto configuration handoff"
  },
  {
    id: "ph-sle-backup-drill",
    templateId: "signoff-cutover-dr-rehearsal",
    packetId: "phcep-backup-drill",
    blockerId: "phcb-backup-drill",
    acceptanceId: "phoa-backup-restore",
    itemIds: ["phcb-backup-drill-e1", "phcb-backup-drill-e2", "phcb-backup-drill-e3", "phcb-backup-drill-e4"],
    owner: "platform-ops",
    requirement: "Backup media, restore screenshots, RPO/RTO and rehearsal signoff"
  },
  {
    id: "ph-sle-institution-accounts",
    templateId: "signoff-cutover-identity",
    packetId: "phcep-site-contacts",
    blockerId: "phcb-site-contacts",
    acceptanceId: "phoa-institution-accounts",
    itemIds: ["phcb-site-contacts-e1", "phcb-site-contacts-e2", "phcb-site-contacts-e3"],
    owner: "project-office",
    requirement: "Institution contacts, authorization scope and account list"
  }
];

function seedPublicHealthReadinessEvidence() {
  return [
    { id: "phev-standard-implementation-ledger", category: "standard implementation", name: "Public health standard implementation ledger", owner: "project office / standards owner", status: "mapping-review-pending", evidence: ["publicHealthStandardImplementationLedger", "/api/public-health/standard-implementation-ledger"], nextAction: "Review all 21 standard-domain mappings and record site implementation gaps without treating mapped rows as signed acceptance." },
    { id: "phev-site-evidence-verification-desk", category: "site evidence verification", name: "Public health site evidence verification desk", owner: "release manager / commission reviewer", status: "verification-planned", evidence: ["publicHealthSiteEvidenceVerificationTasks", "/api/public-health/site-evidence-verification-tasks"], nextAction: "Assign each bridge item, record the signed source evidence, and verify it by matching evidence ID before launch approval." },
    { id: "phev-launch-command-briefs", category: "launch command brief", name: "Public health launch command brief and status broadcast desk", owner: "release manager / command room recorder", status: "briefing-ready", evidence: ["publicHealthLaunchCommandBriefs", "/api/public-health/launch-command-briefs"], nextAction: "Keep launch command briefs aligned with gate status, duty handoffs, incident lanes, observation windows and rollback decisions." },
    { id: "phev-launch-incident-desk", category: "launch incident desk", name: "Public health launch-day incident triage and rollback decision desk", owner: "release manager / emergency duty office", status: "desk-ready", evidence: ["publicHealthLaunchIncidents", "/api/public-health/launch-incidents"], nextAction: "Keep launch-day incident lanes, SLA, escalation paths, rollback decision owners and evidence artifacts ready." },
    { id: "phev-launch-duty-shifts", category: "launch duty handoff", name: "Public health launch-day duty roster and command handoff desk", owner: "release manager / operations duty office", status: "roster-ready", evidence: ["publicHealthLaunchDutyShifts", "/api/public-health/launch-duty-shifts"], nextAction: "Keep launch-day duty windows, primary and backup contacts, contact channels, handoff checklists and escalation owners ready." },
    { id: "phev-go-live-observation", category: "go-live observation", name: "Public health launch-day observation and rollback watch", owner: "release manager / operations duty lead", status: "watch-plan-ready", evidence: ["publicHealthGoLiveObservations", "/api/public-health/go-live-observations"], nextAction: "Record launch-day API smoke, exchange receipts, security audit, rollback standby and institution helpdesk observations during the first 24 hours." },
    { id: "phev-production-handoffs", category: "production handoff", name: "Public health production handoff packs", owner: "release manager / site implementation owner", status: "pending-site-handoff", evidence: ["publicHealthProductionHandoffs", "/api/public-health/production-handoffs"], nextAction: "Accept all interface, command, security, operations, institution and release handoff packs before final go/no-go." },
    { id: "phev-standard-coverage", category: "标准覆盖", name: "21/125/421 标准矩阵覆盖", owner: "项目办/标准管理", status: "已建档", evidence: ["publicHealthStandards", "public-health:readiness"], nextAction: "按现场验收版本维护标准条目差异。" },
    { id: "phev-institution-scope", category: "机构覆盖", name: "七类机构责任边界", owner: "卫健管理部门", status: "已建档", evidence: ["publicHealthInstitutionScopes"], nextAction: "确认属地真实机构清单、联系人和系统账号。" },
    { id: "phev-event-command", category: "平战结合", name: "监测预警-指挥处置-随访复盘闭环", owner: "疾控中心/应急办", status: "演示闭环", evidence: ["publicHealthEvents", "/api/public-health/system"], nextAction: "接入正式事件分级、处置时限和信息发布审批。" },
    { id: "phev-event-action-api", category: "处置闭环", name: "事件动作 API 与审计留痕", owner: "卫健管理部门/疾控中心", status: "已接入", evidence: ["POST /api/public-health/events/:id/actions", "publicHealthEvents.actionHistory", "securityEvents"], nextAction: "接入正式责任人、处置时限、会商记录和现场签字材料。" },
    { id: "phev-exchange-security", category: "数据交换安全", name: "直报、实验室、妇幼、应急、安全审计交换", owner: "平台技术组/安全管理岗", status: "演示契约就绪", evidence: ["publicHealthExchangeTasks", "publicHealthExchangeRuns", "integrationContracts", "audit:retention"], nextAction: "完成外部接口联调、密钥、回执和异常补偿策略。" },
    { id: "phev-institution-collaboration", category: "机构协同", name: "七类机构角色化任务和现场账号清单", owner: "卫健管理部门/各机构联络员", status: "已建档", evidence: ["publicHealthInstitutionTasks", "authUsers"], nextAction: "现场确认联系人、授权范围和机构账号。" },
    { id: "phev-onsite-acceptance", category: "现场验收", name: "等保密评、备份恢复、接口联调和签字材料", owner: "项目办/安全管理岗/运维保障组", status: "待现场签字", evidence: ["publicHealthOnsiteAcceptances", "release:report", "deploy:check"], nextAction: "收集现场签字页、测评报告和演练截图。" },
    { id: "phev-cutover-blockers", category: "上线阻塞", name: "正式接口、密钥、等保密评、备份演练和账号授权阻塞项", owner: "项目办/接口联调专班/安全管理岗", status: "已建档", evidence: ["publicHealthCutoverBlockers", "publicHealthOnsiteAcceptances"], nextAction: "按 P0/P1 阻塞项收集现场证据并逐项关闭。" },
    { id: "phev-cutover-evidence-packets", category: "上线证据包", name: "P0/P1 阻塞项现场证据包签收", owner: "项目办/现场实施负责人", status: "待现场签收", evidence: ["publicHealthCutoverEvidencePackets", "securityEvents"], nextAction: "逐项登记接口、密钥、测评、备份演练和账号授权证据并完成签收。" },
    { id: "phev-launch-gate", category: "上线审批", name: "公共卫生生产上线 gate 和多方审批", owner: "卫健委/疾控/医院/安全/运维/项目办", status: "待审批", evidence: ["publicHealthLaunchApprovals", "/api/public-health/launch-gate"], nextAction: "材料全部核验、阻塞全部关闭、审批全部签署后才能转为 production-ready。" },
    { id: "phev-cutover-drills", category: "上线演练", name: "公共卫生切换彩排和 go/no-go 台账", owner: "项目办/运维/疾控", status: "待现场复测", evidence: ["publicHealthCutoverDrills", "/api/public-health/cutover-drills"], nextAction: "记录接口、应急、安全、备份和上线会演练问题，现场复测通过后才能提交生产上线审批。" },
    { id: "phev-site-evidence-bridge", category: "现场材料桥接", name: "现场上线材料与公共卫生证据包映射", owner: "项目办/现场实施负责人", status: "待现场核验", evidence: ["siteLaunchEvidence", "publicHealthSiteEvidenceBridge", "/api/public-health/site-evidence-bridge"], nextAction: "现场材料 verified 后自动抵扣公共卫生证据包，但阻塞项仍需责任人确认关闭。" }
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

function isCutoverClosed(item) {
  return /closed|resolved|signed|passed|complete|已关闭|已完成|已签署|通过/i.test(`${item?.status || ""} ${item?.resolutionStatus || ""} ${item?.signoffStatus || ""}`);
}

function isCutoverEvidenceRecorded(item) {
  const latest = item?.lastAction || {};
  const text = [
    item?.status,
    item?.resolutionStatus,
    item?.evidenceStatus,
    latest.action,
    latest.status,
    latest.note
  ].filter(Boolean).join(" ");
  return (Array.isArray(item?.evidence) && item.evidence.length > 0) ||
    /evidence-recorded|recorded|verified|resolved|closed|signed|passed|complete|已记录|已收集|已整改|已关闭|已完成|已签署|通过/i.test(text);
}

function daysUntil(dateValue, now = new Date()) {
  const time = Date.parse(dateValue || "");
  if (!Number.isFinite(time)) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return Math.ceil((time - today.getTime()) / 86_400_000);
}

function isEvidenceItemVerified(item) {
  return /verified|signed|accepted|complete|已核验|已签收|已完成|通过/i.test(`${item?.status || ""} ${item?.signoffStatus || ""}`);
}

function isEvidenceItemRecorded(item) {
  return isEvidenceItemVerified(item) ||
    /submitted|recorded|received|已提交|已记录|已收集/i.test(`${item?.status || ""}`) ||
    Boolean(item?.artifactName) ||
    (Array.isArray(item?.attachmentNames) && item.attachmentNames.length > 0);
}

function isLaunchApprovalSigned(item) {
  return /approved|signed|accepted|complete|已批准|已签署|已签收|已完成|通过/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.signoffStatus || ""}`);
}

function buildPublicHealthCutoverEvidenceBoard(packets = [], blockers = []) {
  const blockerById = new Map((Array.isArray(blockers) ? blockers : []).map((item) => [item.id, item]));
  const rows = (Array.isArray(packets) ? packets : []).map((packet) => {
    const blocker = blockerById.get(packet.blockerId) || {};
    const requiredItems = Array.isArray(packet.requiredItems) ? packet.requiredItems : [];
    const recordedItems = requiredItems.filter(isEvidenceItemRecorded).length;
    const verifiedItems = requiredItems.filter(isEvidenceItemVerified).length;
    const complete = requiredItems.length > 0 && verifiedItems === requiredItems.length;
    return {
      ...packet,
      blockerName: blocker.name || packet.name,
      requiredCount: requiredItems.length,
      recordedCount: recordedItems,
      verifiedCount: verifiedItems,
      missingCount: Math.max(requiredItems.length - verifiedItems, 0),
      complete
    };
  });
  const requiredItems = rows.reduce((sum, item) => sum + item.requiredCount, 0);
  const recordedItems = rows.reduce((sum, item) => sum + item.recordedCount, 0);
  const verifiedItems = rows.reduce((sum, item) => sum + item.verifiedCount, 0);
  const completePackets = rows.filter((item) => item.complete).length;
  return {
    status: completePackets === rows.length && rows.length > 0 ? "verified" : recordedItems > 0 ? "in-progress" : "pending-site-evidence",
    summary: {
      packets: rows.length,
      requiredItems,
      recordedItems,
      verifiedItems,
      missingItems: Math.max(requiredItems - verifiedItems, 0),
      completePackets,
      p0Packets: rows.filter((item) => String(item.severity || "").includes("P0")).length,
      p0CompletePackets: rows.filter((item) => String(item.severity || "").includes("P0") && item.complete).length
    },
    packets: rows.sort((a, b) => (
      (String(b.severity || "").includes("P0") ? 1 : 0) - (String(a.severity || "").includes("P0") ? 1 : 0) ||
      b.missingCount - a.missingCount ||
      String(a.id || "").localeCompare(String(b.id || ""))
    )),
    missingItems: rows.flatMap((packet) => (packet.requiredItems || [])
      .filter((item) => !isEvidenceItemVerified(item))
      .map((item) => ({
        packetId: packet.id,
        blockerId: packet.blockerId,
        severity: packet.severity,
        owner: packet.owner,
        assignee: packet.assignee,
        itemId: item.id,
        name: item.name,
        dueAt: packet.dueAt,
        siteWindow: packet.siteWindow
      })))
  };
}

function isSiteLaunchEvidenceVerified(item) {
  return String(item?.status || "").toLowerCase() === "verified";
}

function buildPublicHealthSiteEvidenceBridge(siteLaunchEvidence = [], links = PUBLIC_HEALTH_SITE_EVIDENCE_LINKS) {
  const evidenceRows = Array.isArray(siteLaunchEvidence) ? siteLaunchEvidence : [];
  const verifiedByTemplate = new Map();
  evidenceRows
    .filter(isSiteLaunchEvidenceVerified)
    .sort((a, b) => String(b.verifiedAt || b.submittedAt || "").localeCompare(String(a.verifiedAt || a.submittedAt || "")))
    .forEach((item) => {
      if (!verifiedByTemplate.has(item.templateId)) verifiedByTemplate.set(item.templateId, item);
    });
  const rows = links.map((link) => {
    const evidence = verifiedByTemplate.get(link.templateId) || null;
    return {
      ...link,
      status: evidence ? "verified" : "missing-site-evidence",
      verified: Boolean(evidence),
      evidenceId: evidence?.id || "",
      artifactName: evidence?.artifactName || "",
      jointTestNo: evidence?.jointTestNo || "",
      verifiedAt: evidence?.verifiedAt || "",
      verifiedBy: evidence?.verifiedBy || "",
      attachmentNames: Array.isArray(evidence?.attachmentNames) ? evidence.attachmentNames : []
    };
  });
  const verifiedRows = rows.filter((item) => item.verified);
  return {
    status: verifiedRows.length === rows.length && rows.length > 0 ? "verified" : verifiedRows.length > 0 ? "partial" : "missing-site-evidence",
    summary: {
      links: rows.length,
      verifiedLinks: verifiedRows.length,
      missingLinks: Math.max(rows.length - verifiedRows.length, 0),
      linkedPackets: new Set(rows.map((item) => item.packetId).filter(Boolean)).size,
      linkedItems: rows.reduce((sum, item) => sum + (Array.isArray(item.itemIds) ? item.itemIds.length : 0), 0),
      verifiedItems: verifiedRows.reduce((sum, item) => sum + (Array.isArray(item.itemIds) ? item.itemIds.length : 0), 0),
      siteEvidenceRows: evidenceRows.length,
      verifiedSiteEvidenceRows: evidenceRows.filter(isSiteLaunchEvidenceVerified).length
    },
    links: rows,
    missingLinks: rows.filter((item) => !item.verified),
    verifiedLinks: verifiedRows
  };
}

function applyPublicHealthSiteEvidenceBridge(collections = {}, siteEvidenceBridge = buildPublicHealthSiteEvidenceBridge()) {
  const verifiedLinks = Array.isArray(siteEvidenceBridge.verifiedLinks) ? siteEvidenceBridge.verifiedLinks : [];
  if (!verifiedLinks.length) return collections;
  const linkByPacket = new Map();
  verifiedLinks.forEach((link) => {
    if (!linkByPacket.has(link.packetId)) linkByPacket.set(link.packetId, []);
    linkByPacket.get(link.packetId).push(link);
  });
  const linkedAcceptanceIds = new Set(verifiedLinks.map((item) => item.acceptanceId).filter(Boolean));
  const linkedBlockerIds = new Set(verifiedLinks.map((item) => item.blockerId).filter(Boolean));
  const cutoverEvidencePackets = (collections.cutoverEvidencePackets || []).map((packet) => {
    const links = linkByPacket.get(packet.id) || [];
    if (!links.length) return packet;
    const historyRows = links.map((link) => ({
      id: `site-evidence-${link.id}`,
      at: link.verifiedAt || "",
      action: "site-launch-evidence-bridge",
      status: "verified",
      itemId: (link.itemIds || []).join(","),
      itemName: link.requirement || "",
      artifactName: link.artifactName || link.requirement || "",
      attachmentNames: link.attachmentNames || [],
      actor: link.verifiedBy || "",
      role: "commission",
      note: `Mapped from siteLaunchEvidence template ${link.templateId}.`
    }));
    const linkedItemIds = new Set(links.flatMap((link) => link.itemIds || []));
    const requiredItems = (packet.requiredItems || []).map((item) => {
      const link = links.find((entry) => (entry.itemIds || []).includes(item.id));
      if (!linkedItemIds.has(item.id)) return item;
      return {
        ...item,
        status: "verified",
        artifactName: link?.artifactName || item.artifactName || link?.requirement || "",
        attachmentNames: link?.attachmentNames || item.attachmentNames || [],
        verifiedBy: link?.verifiedBy || item.verifiedBy || "",
        verifiedAt: link?.verifiedAt || item.verifiedAt || "",
        note: `Mapped from siteLaunchEvidence template ${link?.templateId || ""}.`
      };
    });
    const complete = requiredItems.length > 0 && requiredItems.every(isEvidenceItemVerified);
    return {
      ...packet,
      status: complete ? "verified" : "evidence-recorded",
      signoffStatus: complete ? "signed" : (packet.signoffStatus || "partial"),
      bridgeStatus: "site-evidence-linked",
      requiredItems,
      evidenceRecords: [...historyRows, ...(Array.isArray(packet.evidenceRecords) ? packet.evidenceRecords : [])].slice(0, 50),
      linkedSiteEvidence: links.map((link) => ({ id: link.evidenceId, templateId: link.templateId, artifactName: link.artifactName })),
      lastAction: historyRows[0] || packet.lastAction
    };
  });
  const cutoverBlockers = (collections.cutoverBlockers || []).map((blocker) => linkedBlockerIds.has(blocker.id)
    ? {
        ...blocker,
        evidenceStatus: blocker.evidenceStatus || "site-evidence-linked",
        remediationStatus: blocker.remediationStatus || "site evidence linked",
        evidence: Array.from(new Set([...(blocker.evidence || []), "siteLaunchEvidence", "publicHealthSiteEvidenceBridge"])),
        linkedSiteEvidenceTemplates: verifiedLinks.filter((link) => link.blockerId === blocker.id).map((link) => link.templateId)
      }
    : blocker);
  const onsiteAcceptances = (collections.onsiteAcceptances || []).map((item) => linkedAcceptanceIds.has(item.id)
    ? {
        ...item,
        status: "signed",
        signoffStatus: "signed",
        evidence: Array.from(new Set([...(item.evidence || []), "siteLaunchEvidence"])),
        linkedSiteEvidenceTemplates: verifiedLinks.filter((link) => link.acceptanceId === item.id).map((link) => link.templateId)
      }
    : item);
  return {
    ...collections,
    cutoverEvidencePackets,
    cutoverBlockers,
    onsiteAcceptances
  };
}

function buildPublicHealthSiteEvidenceVerificationBoard(tasks = [], options = {}) {
  const bridgeLinks = Array.isArray(options.siteEvidenceBridge?.links) ? options.siteEvidenceBridge.links : [];
  const bridgeById = new Map(bridgeLinks.map((item) => [item.id, item]));
  const rows = (Array.isArray(tasks) ? tasks : []).map((task) => {
    const bridgeLink = bridgeById.get(task.linkId) || null;
    const bridgeEvidenceId = bridgeLink?.evidenceId || "";
    const evidenceAvailable = Boolean(bridgeLink?.verified && bridgeEvidenceId);
    const blocked = /rejected|escalated|blocked/i.test(String(task.status || ""));
    const verified = String(task.status || "").toLowerCase() === "verified"
      && evidenceAvailable
      && String(task.evidenceId || "") === bridgeEvidenceId;
    const checks = Array.isArray(task.requiredChecks) ? task.requiredChecks : [];
    const escalationPath = Array.isArray(task.escalationPath) ? task.escalationPath : [];
    const structurallyReady = Boolean(task.linkId && task.templateId && task.packetId && task.owner && task.reviewerRole && task.verificationWindow && checks.length >= 3 && escalationPath.length >= 2 && bridgeLink);
    return {
      ...task,
      bridgeLink,
      bridgeEvidenceId,
      evidenceAvailable,
      checks,
      escalationPath,
      blocked,
      verified,
      structurallyReady,
      pending: !verified && !blocked
    };
  });
  const verifiedTasks = rows.filter((item) => item.verified);
  const blockedTasks = rows.filter((item) => item.blocked);
  const evidenceAvailableTasks = rows.filter((item) => item.evidenceAvailable);
  const structurallyReadyTasks = rows.filter((item) => item.structurallyReady);
  const status = rows.length > 0 && verifiedTasks.length === rows.length && blockedTasks.length === 0
    ? "verified"
    : blockedTasks.length > 0
      ? "blocked"
      : evidenceAvailableTasks.length === 0
        ? "evidence-pending"
        : "verification-pending";
  return {
    id: "public-health-site-evidence-verification-board",
    status,
    verificationReady: rows.length > 0 && structurallyReadyTasks.length === rows.length,
    summary: {
      tasks: rows.length,
      structurallyReadyTasks: structurallyReadyTasks.length,
      evidenceAvailableTasks: evidenceAvailableTasks.length,
      verifiedTasks: verifiedTasks.length,
      pendingTasks: rows.filter((item) => item.pending).length,
      blockedTasks: blockedTasks.length,
      p0Tasks: rows.filter((item) => item.priority === "P0").length,
      missingEvidenceTasks: Math.max(rows.length - evidenceAvailableTasks.length, 0),
      escalationPaths: new Set(rows.flatMap((item) => item.escalationPath || [])).size
    },
    tasks: rows,
    nextActions: rows.filter((item) => !item.verified).map((item) => ({
      id: item.id,
      linkId: item.linkId,
      priority: item.priority || "",
      owner: item.owner || "",
      nextAction: item.evidenceAvailable
        ? "Verify the matching site evidence ID and record the commission review."
        : item.nextAction || "Record the matching site evidence before verification."
    }))
  };
}

function buildPublicHealthStandardImplementationBoard(ledger = [], standards = [], options = {}) {
  const standardById = new Map((Array.isArray(standards) ? standards : []).map((item) => [item.id, item]));
  const reference = new Date(options.now || Date.now());
  const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const rows = (Array.isArray(ledger) ? ledger : []).map((item) => {
    const standard = standardById.get(item.standardDomainId) || null;
    const dataCollections = Array.isArray(item.dataCollections) ? item.dataCollections : [];
    const interfaces = Array.isArray(item.interfaces) ? item.interfaces : [];
    const requiredChecks = Array.isArray(item.requiredChecks) ? item.requiredChecks : [];
    const status = String(item.status || "modeled").toLowerCase();
    const gapStatus = String(item.gapStatus || "").toLowerCase();
    const remediationStatus = String(item.remediationStatus || "not-planned").toLowerCase();
    const gapRecorded = !["verified", "resolved"].includes(gapStatus) && (status === "gap-recorded" || /open|gap|blocked|escalated|assigned|in-progress|evidence-submitted/i.test(gapStatus));
    const dueAt = String(item.remediationDueAt || "");
    const dueDay = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? Date.parse(`${dueAt}T00:00:00Z`) : Number.NaN;
    const remediationDueInDays = gapRecorded && Number.isFinite(dueDay) ? Math.round((dueDay - referenceDay) / 86400000) : null;
    const remediationOverdue = Number.isFinite(remediationDueInDays) && remediationDueInDays < 0;
    const remediationDueSoon = Number.isFinite(remediationDueInDays) && remediationDueInDays >= 0 && remediationDueInDays <= 7;
    const remediationUnassigned = gapRecorded && !["assigned", "verified"].includes(remediationStatus);
    const mappingComplete = Boolean(standard && item.owner && item.tertiaryRange && dataCollections.length > 0 && interfaces.length > 0 && requiredChecks.length >= 4);
    return {
      ...item,
      standard,
      dataCollections,
      interfaces,
      requiredChecks,
      mappingComplete,
      reviewed: status === "reviewed",
      gapRecorded,
      remediationStatus,
      remediationAssigned: remediationStatus === "assigned",
      remediationVerified: remediationStatus === "verified",
      remediationDueInDays,
      remediationOverdue,
      remediationDueSoon,
      remediationUnassigned,
      evidenceLinked: Boolean(item.siteEvidenceId),
      pendingReview: status !== "reviewed" && !gapRecorded
    };
  });
  const mappingComplete = rows.filter((item) => item.mappingComplete);
  const reviewed = rows.filter((item) => item.reviewed);
  const gaps = rows.filter((item) => item.gapRecorded);
  const evidenceLinked = rows.filter((item) => item.evidenceLinked);
  const status = rows.some((item) => item.remediationOverdue)
    ? "remediation-overdue"
    : gaps.length > 0
      ? "gap-review-required"
    : reviewed.length === rows.length && rows.length > 0
      ? "reviewed"
      : "mapping-review-pending";
  return {
    id: "public-health-standard-implementation-board",
    status,
    traceabilityReady: rows.length > 0 && mappingComplete.length === rows.length,
    summary: {
      domains: rows.length,
      mappingComplete: mappingComplete.length,
      reviewed: reviewed.length,
      gaps: gaps.length,
      assignedRemediations: rows.filter((item) => item.remediationAssigned).length,
      verifiedRemediations: rows.filter((item) => item.remediationVerified).length,
      unassignedRemediations: rows.filter((item) => item.remediationUnassigned).length,
      dueSoonRemediations: rows.filter((item) => item.remediationDueSoon).length,
      overdueRemediations: rows.filter((item) => item.remediationOverdue).length,
      pendingReviews: rows.filter((item) => item.pendingReview).length,
      evidenceLinked: evidenceLinked.length,
      requiredChecks: rows.reduce((sum, item) => sum + item.requiredChecks.length, 0)
    },
    entries: rows,
    nextActions: rows.filter((item) => !item.reviewed || item.gapRecorded).map((item) => ({
      id: item.id,
      standardDomainId: item.standardDomainId,
      owner: item.owner || "",
      status: item.status || "modeled",
      nextAction: item.remediationOverdue
        ? "Escalate the overdue standard remediation and retain the verified field evidence."
        : item.remediationDueSoon
          ? "Confirm the remediation owner and complete the evidence review before the due date."
          : item.remediationUnassigned
            ? "Assign a remediation owner and due date before pursuing evidence verification."
            : item.gapRecorded
        ? "Resolve the recorded standard implementation gap and retain the field acceptance evidence."
        : item.nextAction || "Review the responsibility, data mapping and interface mapping."
    }))
  };
}

function launchRequirement(id, name, passed, evidence = [], nextAction = "") {
  return {
    id,
    name,
    status: passed ? "passed" : "blocked",
    passed: Boolean(passed),
    evidence,
    nextAction
  };
}

function buildPublicHealthCutoverReadiness(blockers = [], options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const evidenceBoard = buildPublicHealthCutoverEvidenceBoard(options.evidencePackets || [], blockers);
  const rows = (Array.isArray(blockers) ? blockers : []).map((item) => {
    const closed = isCutoverClosed(item);
    const daysRemaining = daysUntil(item.dueAt, now);
    return {
      ...item,
      closed,
      evidenceRecorded: isCutoverEvidenceRecorded(item),
      daysRemaining,
      dueSoon: !closed && daysRemaining !== null && daysRemaining >= 0 && daysRemaining <= 7,
      overdue: !closed && daysRemaining !== null && daysRemaining < 0
    };
  });
  const open = rows.filter((item) => !item.closed);
  const severityRank = (value) => String(value || "").includes("P0") ? 0 : 1;
  const escalationRank = (value) => {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("red")) return 0;
    if (normalized.includes("amber")) return 1;
    return 2;
  };
  const nextActions = open
    .slice()
    .sort((a, b) => (
      severityRank(a.severity) - severityRank(b.severity) ||
      escalationRank(a.escalationLevel) - escalationRank(b.escalationLevel) ||
      Number(a.daysRemaining ?? 9999) - Number(b.daysRemaining ?? 9999) ||
      String(a.id || "").localeCompare(String(b.id || ""))
    ))
    .map((item) => ({
      id: item.id,
      category: item.category,
      name: item.name,
      severity: item.severity,
      owner: item.owner,
      assignee: item.assignee || item.owner,
      dueAt: item.dueAt || "",
      daysRemaining: item.daysRemaining,
      siteWindow: item.siteWindow || "",
      reminderChannel: item.reminderChannel || "",
      remediationStatus: item.remediationStatus || item.status || "",
      escalationLevel: item.escalationLevel || "",
      resolutionAction: item.resolutionAction || item.nextAction || ""
    }));
  const p0Open = open.filter((item) => String(item.severity || "").includes("P0")).length;
  const readinessLevel = p0Open > 0 ? "blocked" : open.length > 0 ? "conditional" : "ready";
  const categoryMap = new Map();
  rows.forEach((item) => {
    const key = item.category || "uncategorized";
    const current = categoryMap.get(key) || { category: key, total: 0, open: 0, p0Open: 0 };
    current.total += 1;
    if (!item.closed) current.open += 1;
    if (!item.closed && String(item.severity || "").includes("P0")) current.p0Open += 1;
    categoryMap.set(key, current);
  });
  return {
    readinessLevel,
    releaseGate: readinessLevel === "ready" ? "production-ready" : "site-evidence-required",
    summary: {
      total: rows.length,
      open: open.length,
      closed: rows.filter((item) => item.closed).length,
      evidenceRecorded: rows.filter((item) => item.evidenceRecorded).length,
      p0Open,
      p1Open: open.filter((item) => String(item.severity || "").includes("P1")).length,
      dueSoon: rows.filter((item) => item.dueSoon).length,
      overdue: rows.filter((item) => item.overdue).length,
      red: open.filter((item) => /red/i.test(String(item.escalationLevel || ""))).length,
      amber: open.filter((item) => /amber/i.test(String(item.escalationLevel || ""))).length
    },
    evidence: evidenceBoard.summary,
    categories: Array.from(categoryMap.values()).sort((a, b) => b.p0Open - a.p0Open || b.open - a.open || a.category.localeCompare(b.category)),
    nextActions
  };
}

function buildPublicHealthExchangeExceptionBoard(exchangeRuns = [], options = {}) {
  const reference = options.now ? new Date(options.now) : new Date();
  const referenceDay = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  const rows = (Array.isArray(exchangeRuns) ? exchangeRuns : [])
    .filter((item) => Number(item.failedRecords || 0) > 0)
    .map((item) => {
      const compensationText = `${item.exceptionStatus || ""} ${item.compensationStatus || ""} ${item.receiptStatus || ""} ${item.status || ""}`.toLowerCase();
      const exceptionStatus = String(item.exceptionStatus || (
        /resolved|replayed|accepted-after-retry/.test(compensationText)
          ? "resolved"
          : /escalated|rollback/.test(compensationText)
            ? "escalated"
            : /assigned/.test(compensationText)
              ? "assigned"
              : "open"
      )).trim();
      const open = !["resolved", "closed"].includes(exceptionStatus.toLowerCase());
      const dueAt = String(item.exceptionDueAt || "").trim();
      const dueTime = /^\d{4}-\d{2}-\d{2}$/.test(dueAt) ? Date.parse(`${dueAt}T00:00:00Z`) : Number.NaN;
      const dueInDays = Number.isFinite(dueTime) ? Math.round((dueTime - referenceDay) / 86400000) : null;
      return {
        ...item,
        exceptionStatus,
        exceptionOwner: String(item.exceptionOwner || "").trim(),
        exceptionDueAt: dueAt,
        exceptionDueInDays: dueInDays,
        exceptionOpen: open,
        exceptionUnassigned: open && !String(item.exceptionOwner || "").trim(),
        exceptionDueSoon: open && Number.isFinite(dueInDays) && dueInDays >= 0 && dueInDays <= 7,
        exceptionOverdue: open && Number.isFinite(dueInDays) && dueInDays < 0
      };
    })
    .sort((a, b) => Number(b.exceptionOverdue) - Number(a.exceptionOverdue) || Number(b.exceptionOpen) - Number(a.exceptionOpen) || String(a.category || "").localeCompare(String(b.category || "")));
  const openRows = rows.filter((item) => item.exceptionOpen);
  return {
    status: rows.some((item) => item.exceptionOverdue) ? "exchange-exception-overdue" : openRows.length ? "exchange-exception-open" : rows.length ? "exchange-exceptions-resolved" : "exchange-exception-clear",
    entries: rows,
    summary: {
      exceptions: rows.length,
      openExceptions: openRows.length,
      resolvedExceptions: rows.filter((item) => !item.exceptionOpen).length,
      unassignedExceptions: rows.filter((item) => item.exceptionUnassigned).length,
      dueSoonExceptions: rows.filter((item) => item.exceptionDueSoon).length,
      overdueExceptions: rows.filter((item) => item.exceptionOverdue).length
    }
  };
}

function buildPublicHealthLaunchGate(options = {}) {
  const standard = options.standardCoverage || {};
  const events = Array.isArray(options.events) ? options.events : [];
  const exchangeTasks = Array.isArray(options.exchangeTasks) ? options.exchangeTasks : [];
  const exchangeRuns = Array.isArray(options.exchangeRuns) ? options.exchangeRuns : [];
  const exchangeExceptionBoard = options.exchangeExceptionBoard || buildPublicHealthExchangeExceptionBoard(exchangeRuns);
  const institutionTasks = Array.isArray(options.institutionTasks) ? options.institutionTasks : [];
  const onsiteAcceptances = Array.isArray(options.onsiteAcceptances) ? options.onsiteAcceptances : [];
  const cutoverReadiness = options.cutoverReadiness || buildPublicHealthCutoverReadiness(options.cutoverBlockers || [], { evidencePackets: options.cutoverEvidencePackets || [] });
  const cutoverEvidenceBoard = options.cutoverEvidenceBoard || buildPublicHealthCutoverEvidenceBoard(options.cutoverEvidencePackets || [], options.cutoverBlockers || []);
  const productionHandoffBoard = options.productionHandoffBoard || buildPublicHealthProductionHandoffBoard(options.productionHandoffs || []);
  const goLiveObservationBoard = options.goLiveObservationBoard || buildPublicHealthGoLiveObservationBoard(options.goLiveObservations || []);
  const launchIncidentBoard = options.launchIncidentBoard || buildPublicHealthLaunchIncidentBoard(options.launchIncidents || []);
  const launchDutyBoard = options.launchDutyBoard || buildPublicHealthLaunchDutyBoard(options.launchDutyShifts || []);
  const launchCommandBriefBoard = options.launchCommandBriefBoard || buildPublicHealthLaunchCommandBriefBoard(options.launchCommandBriefs || []);
  const siteEvidenceVerificationBoard = options.siteEvidenceVerificationBoard || buildPublicHealthSiteEvidenceVerificationBoard(options.siteEvidenceVerificationTasks || [], { siteEvidenceBridge: options.siteEvidenceBridge || {} });
  const approvals = Array.isArray(options.launchApprovals) ? options.launchApprovals : [];
  const exchangeRunTaskIds = new Set(exchangeRuns.map((item) => item.taskId));
  const requirements = [
    launchRequirement(
      "launch-standard-matrix",
      "21/125/421 standard matrix",
      standard.total?.domains === 21 && standard.total?.secondary === 125 && standard.total?.tertiary === 421,
      ["publicHealthStandards", "public-health:readiness"],
      "Keep the source-derived standard matrix unchanged before launch."
    ),
    launchRequirement(
      "launch-event-loop",
      "Public health event command loop",
      events.length >= 6 && events.every((item) => item.commandAction && item.followupAction),
      ["publicHealthEvents", "POST /api/public-health/events/:id/actions"],
      "Close or assign all high-priority event actions before production launch."
    ),
    launchRequirement(
      "launch-exchange-receipts",
      "Six exchange categories with receipts",
      exchangeTasks.length >= 6 && exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) && exchangeRuns.every((item) => item.receiptStatus && item.compensationStatus) && exchangeExceptionBoard.summary.openExceptions === 0,
      ["publicHealthExchangeTasks", "publicHealthExchangeRuns"],
      "Archive direct-report, laboratory, immunization, maternal-child, emergency and audit receipts, and close every exchange exception."
    ),
    launchRequirement(
      "launch-institution-handoff",
      "Seven institution handoff and account confirmations",
      institutionTasks.length >= 7 && institutionTasks.every((item) => Number(item.openItems || 0) === 0 && /confirmed|ready|signed|complete|已确认|已签署|已完成/i.test(`${item.handoffStatus || ""} ${item.accountStatus || ""}`)),
      ["publicHealthInstitutionTasks"],
      "Confirm all institution contacts, account scopes and handoff owners."
    ),
    launchRequirement(
      "launch-onsite-signoff",
      "On-site acceptance signatures",
      onsiteAcceptances.length >= 6 && onsiteAcceptances.every((item) => /signed|passed|complete|已签署|已通过|已完成/i.test(`${item.status || ""} ${item.signoffStatus || ""}`)),
      ["publicHealthOnsiteAcceptances"],
      "Collect signed pages for joint test, security, backup, drill, account and release package."
    ),
    launchRequirement(
      "launch-cutover-evidence",
      "Cutover evidence packet completion",
      cutoverEvidenceBoard.summary?.requiredItems >= 20 && cutoverEvidenceBoard.summary?.missingItems === 0,
      ["publicHealthCutoverEvidencePackets"],
      "Verify every interface, key, assessment, backup and account authorization material."
    ),
    launchRequirement(
      "launch-cutover-blockers",
      "No open P0/P1 production blockers",
      cutoverReadiness.releaseGate === "production-ready" && cutoverReadiness.summary?.open === 0,
      ["publicHealthCutoverReadiness", "publicHealthCutoverBlockers"],
      "Resolve all production blockers before removing the site-evidence-required gate."
    ),
    launchRequirement(
      "launch-production-handoffs",
      "Production handoff packs accepted",
      productionHandoffBoard.summary?.handoffs >= 6 && productionHandoffBoard.summary?.pendingHandoffs === 0 && productionHandoffBoard.summary?.missingSignoffs === 0 && productionHandoffBoard.summary?.blockedHandoffs === 0,
      ["publicHealthProductionHandoffs", "/api/public-health/production-handoffs"],
      "Accept every production handoff pack and archive required release artifacts before final go/no-go."
    ),
    launchRequirement(
      "launch-go-live-observation",
      "Launch-day observation and rollback watch plan",
      goLiveObservationBoard.summary?.observations >= 6 && goLiveObservationBoard.summary?.planReady === goLiveObservationBoard.summary?.observations && goLiveObservationBoard.summary?.rollbackPlans === goLiveObservationBoard.summary?.observations && goLiveObservationBoard.summary?.openCriticalSignals === 0,
      ["publicHealthGoLiveObservations", "/api/public-health/go-live-observations"],
      "Keep a launch-day watch plan with API smoke, exchange receipts, security audit, rollback standby and institution helpdesk owners."
    ),
    launchRequirement(
      "launch-incident-desk",
      "Launch-day incident triage and rollback decision desk",
      launchIncidentBoard.summary?.lanes >= 6 && launchIncidentBoard.summary?.deskReady === launchIncidentBoard.summary?.lanes && launchIncidentBoard.summary?.rollbackDecisionOwners >= 4 && launchIncidentBoard.summary?.criticalOpenTickets === 0,
      ["publicHealthLaunchIncidents", "/api/public-health/launch-incidents"],
      "Keep incident lanes, SLA, escalation paths and rollback decision owners ready before launch day."
    ),
    launchRequirement(
      "launch-duty-handoffs",
      "Launch-day duty roster and command handoff desk",
      launchDutyBoard.summary?.shifts >= 6 && launchDutyBoard.summary?.readyShifts === launchDutyBoard.summary?.shifts && launchDutyBoard.summary?.backupContacts === launchDutyBoard.summary?.shifts && launchDutyBoard.summary?.escalationOwners >= 4 && launchDutyBoard.summary?.missedHandoffs === 0,
      ["publicHealthLaunchDutyShifts", "/api/public-health/launch-duty-shifts"],
      "Keep launch-day duty windows, primary and backup contacts, contact channels and escalation owners ready before launch day."
    ),
    launchRequirement(
      "launch-command-briefs",
      "Launch command briefs and status broadcast desk",
      launchCommandBriefBoard.summary?.briefs >= 5 && launchCommandBriefBoard.summary?.readyBriefs === launchCommandBriefBoard.summary?.briefs && launchCommandBriefBoard.summary?.sourceBoards >= 4 && launchCommandBriefBoard.summary?.blockedBriefs === 0,
      ["publicHealthLaunchCommandBriefs", "/api/public-health/launch-command-briefs"],
      "Keep prelaunch, launch-start, first-receipt, stability-watch and first-day closure command briefs ready without bypassing site evidence gates."
    ),
    launchRequirement(
      "launch-site-evidence-verification",
      "Site evidence verification task desk",
      siteEvidenceVerificationBoard.summary?.tasks >= 9 && siteEvidenceVerificationBoard.summary?.verifiedTasks === siteEvidenceVerificationBoard.summary?.tasks && siteEvidenceVerificationBoard.summary?.blockedTasks === 0,
      ["publicHealthSiteEvidenceVerificationTasks", "publicHealthSiteEvidenceBridge", "/api/public-health/site-evidence-verification-tasks"],
      "Verify every site-evidence task against the matching signed evidence ID."
    ),
    launchRequirement(
      "launch-multi-party-approval",
      "Multi-party launch approvals",
      approvals.length >= 6 && approvals.every(isLaunchApprovalSigned),
      ["publicHealthLaunchApprovals", "/api/public-health/launch-gate/actions"],
      "Collect approvals from health admin, CDC, hospital, security, operations and project office."
    )
  ];
  const approvalPrerequisites = requirements.filter((item) => item.id !== "launch-multi-party-approval");
  const blockedApprovalPrerequisites = approvalPrerequisites.filter((item) => !item.passed);
  const approvalPreflight = {
    id: "public-health-launch-approval-preflight",
    status: blockedApprovalPrerequisites.length === 0 ? "eligible" : "blocked",
    eligible: blockedApprovalPrerequisites.length === 0,
    prerequisiteRequirements: approvalPrerequisites.length,
    passedPrerequisites: approvalPrerequisites.length - blockedApprovalPrerequisites.length,
    blockedPrerequisites: blockedApprovalPrerequisites.length,
    blockedRequirementIds: blockedApprovalPrerequisites.map((item) => item.id),
    blockedRequirements: blockedApprovalPrerequisites.map((item) => ({ id: item.id, name: item.name, nextAction: item.nextAction })),
    nextAction: blockedApprovalPrerequisites.length === 0
      ? "Collect the six independent final launch approvals with signed artifacts."
      : "Resolve every non-approval launch requirement before recording a final approval."
  };
  const approvalRows = approvals.map((item) => ({
    ...item,
    approvalEligible: approvalPreflight.eligible,
    blockedRequirementIds: approvalPreflight.blockedRequirementIds,
    blockedPrerequisites: approvalPreflight.blockedRequirements
  }));
  const blocked = requirements.filter((item) => !item.passed);
  const signedApprovals = approvalRows.filter(isLaunchApprovalSigned).length;
  return {
    id: "public-health-production-launch",
    status: blocked.length === 0 ? "production-ready" : "blocked",
    releaseGate: blocked.length === 0 ? "production-ready" : "site-evidence-required",
    productionReady: blocked.length === 0,
    summary: {
      requirements: requirements.length,
      passedRequirements: requirements.length - blocked.length,
      blockedRequirements: blocked.length,
      approvals: approvalRows.length,
      signedApprovals,
      pendingApprovals: Math.max(approvalRows.length - signedApprovals, 0),
      approvalPreflightStatus: approvalPreflight.status,
      approvalPrerequisiteRequirements: approvalPreflight.prerequisiteRequirements,
      approvalPassedPrerequisites: approvalPreflight.passedPrerequisites,
      approvalBlockedPrerequisites: approvalPreflight.blockedPrerequisites,
      cutoverMissingItems: cutoverEvidenceBoard.summary?.missingItems || 0,
      openBlockers: cutoverReadiness.summary?.open || 0,
      p0Open: cutoverReadiness.summary?.p0Open || 0,
      handoffs: productionHandoffBoard.summary?.handoffs || 0,
      pendingHandoffs: productionHandoffBoard.summary?.pendingHandoffs || 0,
      missingHandoffSignoffs: productionHandoffBoard.summary?.missingSignoffs || 0,
      goLiveObservations: goLiveObservationBoard.summary?.observations || 0,
      goLiveObservationPlanReady: goLiveObservationBoard.summary?.planReady || 0,
      goLiveOpenCriticalSignals: goLiveObservationBoard.summary?.openCriticalSignals || 0,
      launchIncidentLanes: launchIncidentBoard.summary?.lanes || 0,
      launchIncidentDeskReady: launchIncidentBoard.summary?.deskReady || 0,
      launchIncidentCriticalOpen: launchIncidentBoard.summary?.criticalOpenTickets || 0,
      launchDutyShifts: launchDutyBoard.summary?.shifts || 0,
      launchDutyReadyShifts: launchDutyBoard.summary?.readyShifts || 0,
      launchDutyMissedHandoffs: launchDutyBoard.summary?.missedHandoffs || 0,
      launchCommandBriefs: launchCommandBriefBoard.summary?.briefs || 0,
      launchCommandReadyBriefs: launchCommandBriefBoard.summary?.readyBriefs || 0,
      launchCommandPendingBriefs: launchCommandBriefBoard.summary?.pendingBriefs || 0,
      launchCommandBlockedBriefs: launchCommandBriefBoard.summary?.blockedBriefs || 0
    },
    requirements,
    approvals: approvalRows,
    approvalPreflight,
    nextActions: blocked.map((item) => ({
      id: item.id,
      name: item.name,
      status: item.status,
      nextAction: item.nextAction,
      evidence: item.evidence
    }))
  };
}

function isProductionHandoffAccepted(item) {
  return /accepted|signed|complete|verified|handed-off|approved/i.test(`${item?.status || ""} ${item?.signoffStatus || ""} ${item?.handoffStatus || ""}`);
}

function buildPublicHealthProductionHandoffBoard(handoffs = [], options = {}) {
  const evidenceBoard = options.cutoverEvidenceBoard || buildPublicHealthCutoverEvidenceBoard(options.cutoverEvidencePackets || [], options.cutoverBlockers || []);
  const verifiedPacketIds = new Set((evidenceBoard.packets || []).filter((item) => item.complete).map((item) => item.id));
  const openBlockerIds = new Set((Array.isArray(options.cutoverBlockers) ? options.cutoverBlockers : []).filter((item) => !isCutoverClosed(item)).map((item) => item.id));
  const signedApprovalIds = new Set((Array.isArray(options.launchApprovals) ? options.launchApprovals : []).filter(isLaunchApprovalSigned).map((item) => item.id));
  const rows = (Array.isArray(handoffs) ? handoffs : []).map((item) => {
    const requiredSignoffs = Array.isArray(item.requiredSignoffs) ? item.requiredSignoffs : [];
    const accepted = isProductionHandoffAccepted(item);
    const packetIds = Array.isArray(item.evidencePacketIds) ? item.evidencePacketIds : [];
    const blockerIds = Array.isArray(item.blockerIds) ? item.blockerIds : [];
    const approvalIds = Array.isArray(item.approvalIds) ? item.approvalIds : [];
    const missingPacketIds = packetIds.filter((id) => !verifiedPacketIds.has(id));
    const openLinkedBlockers = blockerIds.filter((id) => openBlockerIds.has(id));
    const pendingApprovalIds = approvalIds.filter((id) => !signedApprovalIds.has(id));
    return {
      ...item,
      requiredSignoffs,
      accepted,
      missingSignoffCount: accepted ? 0 : requiredSignoffs.length,
      missingPacketIds,
      openLinkedBlockers,
      pendingApprovalIds,
      releaseArtifactCount: Array.isArray(item.releaseArtifacts) ? item.releaseArtifacts.length : 0,
      blocked: !accepted || missingPacketIds.length > 0 || openLinkedBlockers.length > 0 || pendingApprovalIds.length > 0
    };
  });
  const linkedPacketIds = new Set(rows.flatMap((item) => item.evidencePacketIds || []));
  const linkedBlockerIds = new Set(rows.flatMap((item) => item.blockerIds || []));
  const linkedAcceptanceIds = new Set(rows.flatMap((item) => item.acceptanceIds || []));
  const linkedApprovalIds = new Set(rows.flatMap((item) => item.approvalIds || []));
  const releaseArtifactCount = rows.reduce((sum, item) => sum + item.releaseArtifactCount, 0);
  const acceptedHandoffs = rows.filter((item) => item.accepted).length;
  const missingSignoffs = rows.reduce((sum, item) => sum + item.missingSignoffCount, 0);
  const pendingHandoffs = Math.max(rows.length - acceptedHandoffs, 0);
  const blockedHandoffs = rows.filter((item) => item.blocked).length;
  return {
    id: "public-health-production-handoff-board",
    status: rows.length > 0 && pendingHandoffs === 0 && missingSignoffs === 0 && blockedHandoffs === 0 ? "accepted" : "blocked",
    summary: {
      handoffs: rows.length,
      acceptedHandoffs,
      pendingHandoffs,
      blockedHandoffs,
      missingSignoffs,
      linkedEvidencePackets: linkedPacketIds.size,
      linkedBlockers: linkedBlockerIds.size,
      linkedAcceptances: linkedAcceptanceIds.size,
      linkedApprovals: linkedApprovalIds.size,
      releaseArtifacts: releaseArtifactCount,
      cutoverMissingItems: evidenceBoard.summary?.missingItems || 0,
      openLinkedBlockers: rows.reduce((sum, item) => sum + item.openLinkedBlockers.length, 0),
      pendingLinkedApprovals: rows.reduce((sum, item) => sum + item.pendingApprovalIds.length, 0)
    },
    handoffs: rows,
    nextActions: rows
      .filter((item) => item.blocked)
      .map((item) => ({
        id: item.id,
        packageType: item.packageType,
        owner: item.owner,
        receiver: item.receiver,
        dueAt: item.dueAt || "",
        missingSignoffCount: item.missingSignoffCount,
        missingPacketIds: item.missingPacketIds,
        openLinkedBlockers: item.openLinkedBlockers,
        pendingApprovalIds: item.pendingApprovalIds,
        nextAction: item.nextAction || ""
      }))
  };
}

function isGoLiveObservationPassed(item) {
  const text = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return /passed|stable|green|closed|complete|accepted|verified/i.test(text) && !/rollback|blocked|failed|red|critical|open/i.test(text);
}

function isGoLiveObservationCritical(item) {
  const signal = `${item?.status || ""} ${item?.signalStatus || ""} ${item?.decision || ""}`;
  return /critical|red|rollback|blocked|failed/i.test(signal);
}

function buildPublicHealthGoLiveObservationBoard(observations = [], options = {}) {
  const rows = (Array.isArray(observations) ? observations : []).map((item) => {
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const linkedApprovalIds = Array.isArray(item.linkedApprovalIds) ? item.linkedApprovalIds : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const planReady = Boolean(item.window && item.owner && item.metric && item.threshold && item.rollbackTrigger && item.rollbackOwner && evidence.length && requiredArtifacts.length);
    const passed = isGoLiveObservationPassed(item);
    const criticalOpen = isGoLiveObservationCritical(item) && !passed;
    return {
      ...item,
      evidence,
      linkedHandoffIds,
      linkedApprovalIds,
      requiredArtifacts,
      planReady,
      passed,
      criticalOpen,
      rollbackPlanned: Boolean(item.rollbackTrigger && item.rollbackOwner),
      pending: !passed
    };
  });
  const planReadyRows = rows.filter((item) => item.planReady).length;
  const passedObservations = rows.filter((item) => item.passed).length;
  const openCriticalSignals = rows.filter((item) => item.criticalOpen).length;
  const rollbackPlans = rows.filter((item) => item.rollbackPlanned).length;
  const linkedHandoffIds = new Set(rows.flatMap((item) => item.linkedHandoffIds || []));
  const linkedApprovalIds = new Set(rows.flatMap((item) => item.linkedApprovalIds || []));
  const status = rows.length > 0 && planReadyRows === rows.length && rollbackPlans === rows.length && openCriticalSignals === 0
    ? "watch-ready"
    : openCriticalSignals > 0
      ? "rollback-watch"
      : "blocked";
  return {
    id: "public-health-go-live-observation-board",
    status,
    planReady: status === "watch-ready",
    summary: {
      observations: rows.length,
      planReady: planReadyRows,
      passedObservations,
      pendingObservations: Math.max(rows.length - passedObservations, 0),
      openCriticalSignals,
      rollbackPlans,
      linkedHandoffs: linkedHandoffIds.size,
      linkedApprovals: linkedApprovalIds.size,
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    observations: rows,
    nextActions: rows
      .filter((item) => !item.passed)
      .map((item) => ({
        id: item.id,
        window: item.window || "",
        phase: item.phase || "",
        owner: item.owner || "",
        severity: item.severity || "",
        metric: item.metric || "",
        rollbackOwner: item.rollbackOwner || "",
        rollbackTrigger: item.rollbackTrigger || "",
        nextAction: item.nextAction || ""
      }))
  };
}

function isLaunchIncidentResolved(item) {
  return /resolved|closed|false-positive|no-action|complete|accepted/i.test(`${item?.status || ""} ${item?.decision || ""}`);
}

function isLaunchIncidentOpen(item) {
  const text = `${item?.status || ""} ${item?.decision || ""}`;
  return /opened|open|triaged|monitoring|escalated|rollback-recommended|blocked|failed|red|critical/i.test(text) && !isLaunchIncidentResolved(item);
}

function isLaunchIncidentCritical(item) {
  const signal = `${item?.status || ""} ${item?.decision || ""} ${item?.signalStatus || ""}`;
  return /critical|red|rollback-recommended|blocked|failed|escalated/i.test(signal) && !isLaunchIncidentResolved(item);
}

function buildPublicHealthLaunchIncidentBoard(incidents = [], options = {}) {
  const rows = (Array.isArray(incidents) ? incidents : []).map((item) => {
    const escalationPath = Array.isArray(item.escalationPath) ? item.escalationPath : [];
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const evidence = Array.isArray(item.evidence) ? item.evidence : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const deskReady = Boolean(item.lane && item.owner && item.sla && escalationPath.length && item.rollbackDecisionOwner && evidence.length && requiredArtifacts.length);
    const resolved = isLaunchIncidentResolved(item);
    const open = isLaunchIncidentOpen(item);
    const criticalOpen = isLaunchIncidentCritical(item);
    return {
      ...item,
      escalationPath,
      linkedObservationIds,
      linkedHandoffIds,
      evidence,
      requiredArtifacts,
      deskReady,
      open,
      resolved,
      criticalOpen,
      pending: open && !resolved
    };
  });
  const deskReadyRows = rows.filter((item) => item.deskReady).length;
  const openTickets = rows.filter((item) => item.open).length;
  const criticalOpenTickets = rows.filter((item) => item.criticalOpen).length;
  const resolvedTickets = rows.filter((item) => item.resolved).length;
  const rollbackDecisionOwners = new Set(rows.map((item) => item.rollbackDecisionOwner).filter(Boolean));
  const linkedObservationIds = new Set(rows.flatMap((item) => item.linkedObservationIds || []));
  const linkedHandoffIds = new Set(rows.flatMap((item) => item.linkedHandoffIds || []));
  const status = rows.length > 0 && deskReadyRows === rows.length && criticalOpenTickets === 0
    ? "desk-ready"
    : criticalOpenTickets > 0
      ? "incident-watch"
      : "blocked";
  return {
    id: "public-health-launch-incident-board",
    status,
    deskReady: status === "desk-ready",
    summary: {
      lanes: rows.length,
      deskReady: deskReadyRows,
      openTickets,
      criticalOpenTickets,
      resolvedTickets,
      rollbackDecisionOwners: rollbackDecisionOwners.size,
      escalationPaths: rows.filter((item) => item.escalationPath.length).length,
      linkedObservations: linkedObservationIds.size,
      linkedHandoffs: linkedHandoffIds.size,
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    incidents: rows,
    nextActions: rows
      .filter((item) => item.open || !item.deskReady)
      .map((item) => ({
        id: item.id,
        lane: item.lane || "",
        owner: item.owner || "",
        severity: item.severity || "",
        status: item.status || "",
        rollbackDecisionOwner: item.rollbackDecisionOwner || "",
        nextAction: item.nextAction || ""
      }))
  };
}

function isLaunchDutyShiftMissed(item) {
  return /missed|unreachable|blocked|failed|red|critical/i.test(`${item?.status || ""} ${item?.signalStatus || ""} ${item?.handoffStatus || ""} ${item?.decision || ""}`);
}

function isLaunchDutyShiftEscalated(item) {
  return /escalated|amber|watch|delayed/i.test(`${item?.status || ""} ${item?.signalStatus || ""} ${item?.handoffStatus || ""} ${item?.decision || ""}`) && !isLaunchDutyShiftMissed(item);
}

function buildPublicHealthLaunchDutyBoard(shifts = [], options = {}) {
  const rows = (Array.isArray(shifts) ? shifts : []).map((item) => {
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedIncidentIds = Array.isArray(item.linkedIncidentIds) ? item.linkedIncidentIds : [];
    const linkedHandoffIds = Array.isArray(item.linkedHandoffIds) ? item.linkedHandoffIds : [];
    const handoffChecklist = Array.isArray(item.handoffChecklist) ? item.handoffChecklist : [];
    const requiredArtifacts = Array.isArray(item.requiredArtifacts) ? item.requiredArtifacts : [];
    const missed = isLaunchDutyShiftMissed(item);
    const escalated = isLaunchDutyShiftEscalated(item);
    const shiftReady = Boolean(
      item.shiftWindow &&
      item.owner &&
      item.backupOwner &&
      item.contactChannel &&
      item.escalationOwner &&
      linkedObservationIds.length &&
      linkedIncidentIds.length &&
      handoffChecklist.length &&
      requiredArtifacts.length &&
      !missed
    );
    return {
      ...item,
      linkedObservationIds,
      linkedIncidentIds,
      linkedHandoffIds,
      handoffChecklist,
      requiredArtifacts,
      missed,
      escalated,
      shiftReady,
      pending: !/confirmed|relieved|closed|complete|accepted/i.test(`${item.status || ""} ${item.handoffStatus || ""}`)
    };
  });
  const readyShifts = rows.filter((item) => item.shiftReady).length;
  const missedHandoffs = rows.filter((item) => item.missed).length;
  const escalatedShifts = rows.filter((item) => item.escalated).length;
  const status = rows.length > 0 && readyShifts === rows.length && missedHandoffs === 0
    ? "roster-ready"
    : missedHandoffs > 0 || escalatedShifts > 0
      ? "handoff-watch"
      : "blocked";
  return {
    id: "public-health-launch-duty-board",
    status,
    rosterReady: status === "roster-ready",
    summary: {
      shifts: rows.length,
      readyShifts,
      pendingShifts: rows.filter((item) => item.pending).length,
      missedHandoffs,
      escalatedShifts,
      backupContacts: rows.filter((item) => item.backupOwner).length,
      contactChannels: rows.filter((item) => item.contactChannel).length,
      escalationOwners: new Set(rows.map((item) => item.escalationOwner).filter(Boolean)).size,
      linkedObservations: new Set(rows.flatMap((item) => item.linkedObservationIds || [])).size,
      linkedIncidents: new Set(rows.flatMap((item) => item.linkedIncidentIds || [])).size,
      linkedHandoffs: new Set(rows.flatMap((item) => item.linkedHandoffIds || [])).size,
      checklistItems: rows.reduce((sum, item) => sum + item.handoffChecklist.length, 0),
      requiredArtifacts: rows.reduce((sum, item) => sum + item.requiredArtifacts.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    shifts: rows,
    nextActions: rows
      .filter((item) => !item.shiftReady || item.missed || item.escalated)
      .map((item) => ({
        id: item.id,
        lane: item.lane || "",
        owner: item.owner || "",
        backupOwner: item.backupOwner || "",
        shiftWindow: item.shiftWindow || "",
        escalationOwner: item.escalationOwner || "",
        nextAction: item.nextAction || ""
      }))
  };
}

function isLaunchCommandBriefPublished(item) {
  return /published|sent|approved|archived|complete|closed/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.publishStatus || ""}`);
}

function isLaunchCommandBriefBlocked(item) {
  return /blocked|failed|red|critical|rollback/i.test(`${item?.status || ""} ${item?.decision || ""} ${item?.signalStatus || ""}`) && !isLaunchCommandBriefPublished(item);
}

function buildPublicHealthLaunchCommandBriefBoard(briefs = [], options = {}) {
  const rows = (Array.isArray(briefs) ? briefs : []).map((item) => {
    const audience = Array.isArray(item.audience) ? item.audience : [];
    const sourceBoards = Array.isArray(item.sourceBoards) ? item.sourceBoards : [];
    const linkedDutyShiftIds = Array.isArray(item.linkedDutyShiftIds) ? item.linkedDutyShiftIds : [];
    const linkedObservationIds = Array.isArray(item.linkedObservationIds) ? item.linkedObservationIds : [];
    const linkedIncidentIds = Array.isArray(item.linkedIncidentIds) ? item.linkedIncidentIds : [];
    const requiredSections = Array.isArray(item.requiredSections) ? item.requiredSections : [];
    const published = isLaunchCommandBriefPublished(item);
    const blocked = isLaunchCommandBriefBlocked(item);
    const acknowledgementByTarget = new Map(
      (Array.isArray(item.acknowledgements) ? item.acknowledgements : [])
        .filter((entry) => entry && typeof entry === "object" && audience.includes(String(entry.target || "")))
        .map((entry) => [String(entry.target || ""), { ...entry, status: String(entry.status || "").toLowerCase() }])
    );
    const acknowledgements = Array.from(acknowledgementByTarget.values());
    const acknowledgedTargets = published ? audience.filter((target) => acknowledgementByTarget.get(target)?.status === "acknowledged") : [];
    const escalatedTargets = published ? audience.filter((target) => acknowledgementByTarget.get(target)?.status === "escalated") : [];
    const pendingAcknowledgementTargets = published ? audience.filter((target) => !acknowledgementByTarget.has(target) || acknowledgementByTarget.get(target)?.status !== "acknowledged") : [];
    const briefReady = Boolean(
      item.briefWindow &&
      item.phase &&
      item.owner &&
      item.recorder &&
      item.publishChannel &&
      item.publishTarget &&
      item.decisionOwner &&
      audience.length &&
      sourceBoards.length >= 2 &&
      linkedDutyShiftIds.length &&
      linkedObservationIds.length &&
      linkedIncidentIds.length &&
      requiredSections.length >= 3 &&
      !blocked
    );
    return {
      ...item,
      audience,
      sourceBoards,
      linkedDutyShiftIds,
      linkedObservationIds,
      linkedIncidentIds,
      requiredSections,
      acknowledgements,
      acknowledgedTargets,
      escalatedTargets,
      pendingAcknowledgementTargets,
      expectedAcknowledgementCount: published ? audience.length : 0,
      acknowledgedRecipientCount: acknowledgedTargets.length,
      escalatedRecipientCount: escalatedTargets.length,
      pendingAcknowledgementCount: pendingAcknowledgementTargets.length,
      published,
      blocked,
      briefReady,
      pending: !published
    };
  });
  const readyBriefs = rows.filter((item) => item.briefReady).length;
  const blockedBriefs = rows.filter((item) => item.blocked).length;
  const publishedBriefs = rows.filter((item) => item.published).length;
  const status = rows.length > 0 && readyBriefs === rows.length && blockedBriefs === 0
    ? "briefing-ready"
    : blockedBriefs > 0
      ? "briefing-watch"
      : "blocked";
  return {
    id: "public-health-launch-command-brief-board",
    status,
    briefingReady: status === "briefing-ready",
    summary: {
      briefs: rows.length,
      readyBriefs,
      pendingBriefs: Math.max(rows.length - publishedBriefs, 0),
      publishedBriefs,
      blockedBriefs,
      expectedAcknowledgements: rows.reduce((sum, item) => sum + item.expectedAcknowledgementCount, 0),
      acknowledgedRecipients: rows.reduce((sum, item) => sum + item.acknowledgedRecipientCount, 0),
      pendingAcknowledgements: rows.reduce((sum, item) => sum + item.pendingAcknowledgementCount, 0),
      escalatedAcknowledgements: rows.reduce((sum, item) => sum + item.escalatedRecipientCount, 0),
      deliveryCompleteBriefs: rows.filter((item) => item.published && item.pendingAcknowledgementCount === 0).length,
      audiences: new Set(rows.flatMap((item) => item.audience || [])).size,
      sourceBoards: new Set(rows.flatMap((item) => item.sourceBoards || [])).size,
      linkedDutyShifts: new Set(rows.flatMap((item) => item.linkedDutyShiftIds || [])).size,
      linkedObservations: new Set(rows.flatMap((item) => item.linkedObservationIds || [])).size,
      linkedIncidents: new Set(rows.flatMap((item) => item.linkedIncidentIds || [])).size,
      requiredSections: rows.reduce((sum, item) => sum + item.requiredSections.length, 0),
      launchGateStatus: options.launchGate?.status || "unknown",
      launchReleaseGate: options.launchGate?.releaseGate || "unknown"
    },
    briefs: rows,
    nextActions: rows
      .filter((item) => !item.briefReady || item.blocked || item.pendingAcknowledgementCount > 0)
      .map((item) => ({
        id: item.id,
        phase: item.phase || "",
        briefWindow: item.briefWindow || "",
        owner: item.owner || "",
        recorder: item.recorder || "",
        decisionOwner: item.decisionOwner || "",
        pendingAcknowledgementTargets: item.pendingAcknowledgementTargets || [],
        nextAction: item.published && item.pendingAcknowledgementCount > 0
          ? "Record delivery receipts for every configured audience or escalate the missing receipt."
          : item.nextAction || ""
      }))
  };
}

function isCutoverDrillFindingClosed(item) {
  return /closed|resolved|passed|complete|signed|verified/i.test(`${item?.status || ""} ${item?.retestStatus || ""}`);
}

function isCutoverDrillPassed(item) {
  const text = `${item?.status || ""} ${item?.goNoGo || ""} ${item?.retestStatus || ""}`;
  return /passed|go|approved|signed|complete/i.test(text) && !/no-go|blocked|failed|retest-required|pending/i.test(text);
}

function buildPublicHealthCutoverDrillBoard(drills = [], options = {}) {
  const rows = (Array.isArray(drills) ? drills : []).map((item) => {
    const findings = Array.isArray(item.findings) ? item.findings : [];
    const blockers = Array.isArray(item.blockers) ? item.blockers : [];
    const linkedBlockerIds = Array.isArray(item.linkedBlockerIds) ? item.linkedBlockerIds : [];
    const linkedAcceptanceIds = Array.isArray(item.linkedAcceptanceIds) ? item.linkedAcceptanceIds : [];
    const openFindings = findings.filter((finding) => !isCutoverDrillFindingClosed(finding));
    const noGo = /no-go|blocked|failed/i.test(`${item.status || ""} ${item.goNoGo || ""}`);
    const retestRequired = /retest|pending/i.test(`${item.status || ""} ${item.retestStatus || ""}`);
    const passed = isCutoverDrillPassed(item) && openFindings.length === 0 && blockers.length === 0;
    const blocked = !passed && (
      noGo ||
      blockers.length > 0 ||
      openFindings.some((finding) => /P0|critical/i.test(String(finding.severity || "")))
    );
    return {
      ...item,
      findings,
      blockers,
      linkedBlockerIds,
      linkedAcceptanceIds,
      openFindings,
      openFindingCount: openFindings.length,
      passed,
      blocked,
      retestRequired
    };
  });
  const linkedBlockers = new Set(rows.flatMap((item) => item.linkedBlockerIds || []));
  const linkedAcceptances = new Set(rows.flatMap((item) => item.linkedAcceptanceIds || []));
  const summary = {
    drills: rows.length,
    passedDrills: rows.filter((item) => item.passed).length,
    blockedDrills: rows.filter((item) => item.blocked).length,
    retestRequired: rows.filter((item) => item.retestRequired).length,
    openFindings: rows.reduce((sum, item) => sum + item.openFindingCount, 0),
    goNoGoNo: rows.filter((item) => /no-go/i.test(String(item.goNoGo || ""))).length,
    goNoGoConditional: rows.filter((item) => /conditional/i.test(String(item.goNoGo || ""))).length,
    linkedBlockers: linkedBlockers.size,
    linkedAcceptances: linkedAcceptances.size,
    launchGateStatus: options.launchGate?.status || "unknown",
    launchReleaseGate: options.launchGate?.releaseGate || "unknown",
    cutoverReleaseGate: options.cutoverReadiness?.releaseGate || "unknown",
    evidencePacketsMissingItems: options.cutoverEvidenceBoard?.summary?.missingItems || 0
  };
  const blockedByLaunchGate = options.launchGate?.productionReady === false;
  return {
    id: "public-health-cutover-drill-board",
    status: summary.blockedDrills > 0 || blockedByLaunchGate ? "blocked" : summary.retestRequired > 0 ? "retest-required" : "passed",
    blockedByLaunchGate,
    summary,
    drills: rows,
    nextActions: rows
      .filter((item) => item.blocked || item.retestRequired || item.openFindingCount > 0)
      .map((item) => ({
        id: item.id,
        scenario: item.scenario,
        phase: item.phase,
        owner: item.owner,
        goNoGo: item.goNoGo,
        openFindingCount: item.openFindingCount,
        linkedBlockerIds: item.linkedBlockerIds,
        nextAction: item.nextAction || ""
      }))
  };
}

function buildPublicHealthSystem(options = {}) {
  const data = options.data || readJson("data/db.json");
  const standards = mergeById(seedPublicHealthStandards(), data.publicHealthStandards);
  const standardImplementationLedger = mergeById(seedPublicHealthStandardImplementationLedger(), data.publicHealthStandardImplementationLedger);
  const institutionScopes = mergeById(seedPublicHealthInstitutionScopes(), data.publicHealthInstitutionScopes);
  const events = mergeById(seedPublicHealthEvents(), data.publicHealthEvents);
  const exchangeTasks = mergeById(seedPublicHealthExchangeTasks(), data.publicHealthExchangeTasks);
  const exchangeRuns = mergeById(seedPublicHealthExchangeRuns(), data.publicHealthExchangeRuns);
  const institutionTasks = mergeById(seedPublicHealthInstitutionTasks(), data.publicHealthInstitutionTasks);
  const rawOnsiteAcceptances = mergeById(seedPublicHealthOnsiteAcceptances(), data.publicHealthOnsiteAcceptances);
  const rawCutoverBlockers = mergeById(seedPublicHealthCutoverBlockers(), data.publicHealthCutoverBlockers);
  const rawCutoverEvidencePackets = mergeById(seedPublicHealthCutoverEvidencePackets(rawCutoverBlockers), data.publicHealthCutoverEvidencePackets);
  const launchApprovals = mergeById(seedPublicHealthLaunchApprovals(), data.publicHealthLaunchApprovals);
  const cutoverDrills = mergeById(seedPublicHealthCutoverDrills(), data.publicHealthCutoverDrills);
  const productionHandoffs = mergeById(seedPublicHealthProductionHandoffs(), data.publicHealthProductionHandoffs);
  const goLiveObservations = mergeById(seedPublicHealthGoLiveObservations(), data.publicHealthGoLiveObservations);
  const launchIncidents = mergeById(seedPublicHealthLaunchIncidents(), data.publicHealthLaunchIncidents);
  const launchDutyShifts = mergeById(seedPublicHealthLaunchDutyShifts(), data.publicHealthLaunchDutyShifts);
  const launchCommandBriefs = mergeById(seedPublicHealthLaunchCommandBriefs(), data.publicHealthLaunchCommandBriefs);
  const siteEvidenceVerificationTasks = mergeById(seedPublicHealthSiteEvidenceVerificationTasks(), data.publicHealthSiteEvidenceVerificationTasks);
  const readinessEvidence = mergeById(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence);
  const siteEvidenceBridge = buildPublicHealthSiteEvidenceBridge(data.siteLaunchEvidence);
  const bridgedCollections = applyPublicHealthSiteEvidenceBridge({
    onsiteAcceptances: rawOnsiteAcceptances,
    cutoverBlockers: rawCutoverBlockers,
    cutoverEvidencePackets: rawCutoverEvidencePackets
  }, siteEvidenceBridge);
  const onsiteAcceptances = bridgedCollections.onsiteAcceptances;
  const cutoverBlockers = bridgedCollections.cutoverBlockers;
  const cutoverEvidencePackets = bridgedCollections.cutoverEvidencePackets;
  const standardCoverage = summarizeStandards(standards);
  const standardImplementationBoard = buildPublicHealthStandardImplementationBoard(standardImplementationLedger, standards, { now: options.now });
  const standardImplementationEvidenceCandidates = (Array.isArray(data.siteLaunchEvidence) ? data.siteLaunchEvidence : [])
    .filter((item) => String(item.status || "").toLowerCase() === "verified")
    .map((item) => ({
      id: item.id,
      templateId: item.templateId || "",
      artifactName: item.artifactName || item.id,
      verifiedAt: item.verifiedAt || item.updatedAt || ""
    }));
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
  const exchangeExceptionBoard = buildPublicHealthExchangeExceptionBoard(exchangeRuns, { now: options.now });
  const institutionTaskScopeIds = new Set(institutionTasks.map((item) => item.scopeId));
  const onsiteReady = onsiteAcceptances.filter((item) => /ready|signed|passed|complete|就绪|通过|签/i.test(`${item.status || ""} ${item.signoffStatus || ""}`));
  const openCutoverBlockers = cutoverBlockers.filter((item) => !isCutoverClosed(item));
  const p0OpenCutoverBlockers = openCutoverBlockers.filter((item) => String(item.severity || "").includes("P0"));
  const cutoverEvidenceBoard = buildPublicHealthCutoverEvidenceBoard(cutoverEvidencePackets, cutoverBlockers);
  const cutoverReadiness = buildPublicHealthCutoverReadiness(cutoverBlockers, { ...options, evidencePackets: cutoverEvidencePackets });
  const productionHandoffBoard = buildPublicHealthProductionHandoffBoard(productionHandoffs, {
    cutoverBlockers,
    cutoverEvidencePackets,
    cutoverEvidenceBoard,
    launchApprovals
  });
  const goLiveObservationBoard = buildPublicHealthGoLiveObservationBoard(goLiveObservations);
  const launchIncidentBoard = buildPublicHealthLaunchIncidentBoard(launchIncidents);
  const launchDutyBoard = buildPublicHealthLaunchDutyBoard(launchDutyShifts);
  const launchCommandBriefBoard = buildPublicHealthLaunchCommandBriefBoard(launchCommandBriefs);
  const siteEvidenceVerificationBoard = buildPublicHealthSiteEvidenceVerificationBoard(siteEvidenceVerificationTasks, { siteEvidenceBridge });
  const launchGate = buildPublicHealthLaunchGate({
    standardCoverage,
    events,
    exchangeTasks,
    exchangeRuns,
    exchangeExceptionBoard,
    institutionTasks,
    onsiteAcceptances,
    cutoverBlockers,
    cutoverEvidencePackets,
    cutoverEvidenceBoard,
    cutoverReadiness,
    productionHandoffs,
    productionHandoffBoard,
    goLiveObservations,
    goLiveObservationBoard,
    launchIncidents,
    launchIncidentBoard,
    launchDutyShifts,
    launchDutyBoard,
    launchCommandBriefs,
    launchCommandBriefBoard,
    siteEvidenceVerificationTasks,
    siteEvidenceVerificationBoard,
    siteEvidenceBridge,
    launchApprovals
  });
  goLiveObservationBoard.summary.launchGateStatus = launchGate.status;
  goLiveObservationBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchIncidentBoard.summary.launchGateStatus = launchGate.status;
  launchIncidentBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchDutyBoard.summary.launchGateStatus = launchGate.status;
  launchDutyBoard.summary.launchReleaseGate = launchGate.releaseGate;
  launchCommandBriefBoard.summary.launchGateStatus = launchGate.status;
  launchCommandBriefBoard.summary.launchReleaseGate = launchGate.releaseGate;
  const cutoverDrillBoard = buildPublicHealthCutoverDrillBoard(cutoverDrills, {
    cutoverReadiness,
    cutoverEvidenceBoard,
    launchGate
  });

  return {
    ok: standardCoverage.total.domains === STANDARD_TOTALS.total.domains &&
      standardCoverage.total.secondary === STANDARD_TOTALS.total.secondary &&
      standardCoverage.total.tertiary === STANDARD_TOTALS.total.tertiary &&
      standardImplementationBoard.traceabilityReady &&
      institutionScopes.length >= 7 &&
      events.length >= 6 &&
      exchangeCategories.length >= 6 &&
      exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) &&
      institutionScopes.every((item) => institutionTaskScopeIds.has(item.id)) &&
      onsiteAcceptances.length >= 6 &&
      cutoverBlockers.length >= 6 &&
      cutoverEvidencePackets.length >= cutoverBlockers.length &&
      launchApprovals.length >= 6 &&
      cutoverDrills.length >= 4 &&
      productionHandoffs.length >= 6 &&
      goLiveObservations.length >= 6 &&
      launchIncidents.length >= 6 &&
      launchDutyShifts.length >= 6 &&
      launchCommandBriefs.length >= 5 &&
      siteEvidenceVerificationTasks.length >= 9,
    generatedAt: new Date().toISOString(),
    sourceDocuments: clone(SOURCE_DOCUMENTS),
    standardTotals: clone(STANDARD_TOTALS),
    summary: {
      domains: standardCoverage.total.domains,
      secondaryIndicators: standardCoverage.total.secondary,
      tertiaryIndicators: standardCoverage.total.tertiary,
      managementDomains: standardCoverage.management.domains,
      technologyDomains: standardCoverage.technology.domains,
      standardImplementationDomains: standardImplementationBoard.summary.domains,
      standardImplementationMappingComplete: standardImplementationBoard.summary.mappingComplete,
      standardImplementationReviewed: standardImplementationBoard.summary.reviewed,
      standardImplementationGaps: standardImplementationBoard.summary.gaps,
      standardImplementationAssignedGaps: standardImplementationBoard.summary.assignedRemediations,
      standardImplementationVerifiedGaps: standardImplementationBoard.summary.verifiedRemediations,
      standardImplementationUnassignedGaps: standardImplementationBoard.summary.unassignedRemediations,
      standardImplementationDueSoonGaps: standardImplementationBoard.summary.dueSoonRemediations,
      standardImplementationOverdueGaps: standardImplementationBoard.summary.overdueRemediations,
      standardImplementationStatus: standardImplementationBoard.status,
      standardImplementationEvidenceCandidates: standardImplementationEvidenceCandidates.length,
      institutionScopes: institutionScopes.length,
      scopeDomains: scopeDomains.length,
      events: events.length,
      highPriorityEvents: events.filter(isHighPriority).length,
      eventActions: eventActionCount(events),
      exchangeTasks: exchangeTasks.length,
      exchangeCategories: exchangeCategories.length,
      exchangeRuns: exchangeRuns.length,
      compensatedExchangeRuns: compensatedExchangeRuns.length,
      exchangeExceptions: exchangeExceptionBoard.summary.exceptions,
      openExchangeExceptions: exchangeExceptionBoard.summary.openExceptions,
      resolvedExchangeExceptions: exchangeExceptionBoard.summary.resolvedExceptions,
      unassignedExchangeExceptions: exchangeExceptionBoard.summary.unassignedExceptions,
      dueSoonExchangeExceptions: exchangeExceptionBoard.summary.dueSoonExceptions,
      overdueExchangeExceptions: exchangeExceptionBoard.summary.overdueExceptions,
      institutionTasks: institutionTasks.length,
      onsiteAcceptances: onsiteAcceptances.length,
      onsiteReady: onsiteReady.length,
      cutoverBlockers: cutoverBlockers.length,
      openCutoverBlockers: openCutoverBlockers.length,
      p0OpenCutoverBlockers: p0OpenCutoverBlockers.length,
      cutoverEvidenceRecorded: cutoverReadiness.summary.evidenceRecorded,
      cutoverEvidencePackets: cutoverEvidenceBoard.summary.packets,
      cutoverEvidenceItems: cutoverEvidenceBoard.summary.requiredItems,
      cutoverEvidenceVerifiedItems: cutoverEvidenceBoard.summary.verifiedItems,
      cutoverEvidenceMissingItems: cutoverEvidenceBoard.summary.missingItems,
      cutoverEvidenceCompletePackets: cutoverEvidenceBoard.summary.completePackets,
      siteEvidenceBridgeLinks: siteEvidenceBridge.summary.links,
      siteEvidenceBridgeVerifiedLinks: siteEvidenceBridge.summary.verifiedLinks,
      siteEvidenceBridgeMissingLinks: siteEvidenceBridge.summary.missingLinks,
      siteEvidenceVerificationTasks: siteEvidenceVerificationBoard.summary.tasks,
      siteEvidenceVerificationReadyTasks: siteEvidenceVerificationBoard.summary.structurallyReadyTasks,
      siteEvidenceVerificationEvidenceAvailable: siteEvidenceVerificationBoard.summary.evidenceAvailableTasks,
      siteEvidenceVerificationVerifiedTasks: siteEvidenceVerificationBoard.summary.verifiedTasks,
      siteEvidenceVerificationPendingTasks: siteEvidenceVerificationBoard.summary.pendingTasks,
      siteEvidenceVerificationBlockedTasks: siteEvidenceVerificationBoard.summary.blockedTasks,
      siteEvidenceVerificationStatus: siteEvidenceVerificationBoard.status,
      launchApprovals: launchGate.summary.approvals,
      launchSignedApprovals: launchGate.summary.signedApprovals,
      launchBlockedRequirements: launchGate.summary.blockedRequirements,
      launchGateStatus: launchGate.status,
      cutoverDrills: cutoverDrillBoard.summary.drills,
      cutoverDrillBlocked: cutoverDrillBoard.summary.blockedDrills,
      cutoverDrillOpenFindings: cutoverDrillBoard.summary.openFindings,
      cutoverDrillStatus: cutoverDrillBoard.status,
      productionHandoffs: productionHandoffBoard.summary.handoffs,
      productionHandoffAccepted: productionHandoffBoard.summary.acceptedHandoffs,
      productionHandoffPending: productionHandoffBoard.summary.pendingHandoffs,
      productionHandoffMissingSignoffs: productionHandoffBoard.summary.missingSignoffs,
      productionHandoffStatus: productionHandoffBoard.status,
      goLiveObservations: goLiveObservationBoard.summary.observations,
      goLiveObservationPlanReady: goLiveObservationBoard.summary.planReady,
      goLiveObservationPassed: goLiveObservationBoard.summary.passedObservations,
      goLiveObservationPending: goLiveObservationBoard.summary.pendingObservations,
      goLiveOpenCriticalSignals: goLiveObservationBoard.summary.openCriticalSignals,
      goLiveRollbackPlans: goLiveObservationBoard.summary.rollbackPlans,
      goLiveObservationStatus: goLiveObservationBoard.status,
      launchIncidentLanes: launchIncidentBoard.summary.lanes,
      launchIncidentDeskReady: launchIncidentBoard.summary.deskReady,
      launchIncidentOpenTickets: launchIncidentBoard.summary.openTickets,
      launchIncidentCriticalOpen: launchIncidentBoard.summary.criticalOpenTickets,
      launchIncidentRollbackOwners: launchIncidentBoard.summary.rollbackDecisionOwners,
      launchIncidentStatus: launchIncidentBoard.status,
      launchDutyShifts: launchDutyBoard.summary.shifts,
      launchDutyReadyShifts: launchDutyBoard.summary.readyShifts,
      launchDutyPendingShifts: launchDutyBoard.summary.pendingShifts,
      launchDutyMissedHandoffs: launchDutyBoard.summary.missedHandoffs,
      launchDutyEscalatedShifts: launchDutyBoard.summary.escalatedShifts,
      launchDutyStatus: launchDutyBoard.status,
      launchCommandBriefs: launchCommandBriefBoard.summary.briefs,
      launchCommandReadyBriefs: launchCommandBriefBoard.summary.readyBriefs,
      launchCommandPendingBriefs: launchCommandBriefBoard.summary.pendingBriefs,
      launchCommandPublishedBriefs: launchCommandBriefBoard.summary.publishedBriefs,
      launchCommandBlockedBriefs: launchCommandBriefBoard.summary.blockedBriefs,
      launchCommandExpectedAcknowledgements: launchCommandBriefBoard.summary.expectedAcknowledgements,
      launchCommandAcknowledgedRecipients: launchCommandBriefBoard.summary.acknowledgedRecipients,
      launchCommandPendingAcknowledgements: launchCommandBriefBoard.summary.pendingAcknowledgements,
      launchCommandEscalatedAcknowledgements: launchCommandBriefBoard.summary.escalatedAcknowledgements,
      launchCommandStatus: launchCommandBriefBoard.status,
      dueSoonCutoverBlockers: cutoverReadiness.summary.dueSoon,
      overdueCutoverBlockers: cutoverReadiness.summary.overdue,
      redCutoverBlockers: cutoverReadiness.summary.red,
      amberCutoverBlockers: cutoverReadiness.summary.amber,
      cutoverReadinessLevel: cutoverReadiness.readinessLevel,
      readinessEvidence: readinessEvidence.length
    },
    standardCoverage,
    standardDomains: domainCoverage,
    standardImplementationLedger,
    standardImplementationBoard,
    standardImplementationEvidenceCandidates,
    institutionScopes,
    events,
    riskQueue,
    exchangeTasks,
    exchangeCategories,
    exchangeRuns,
    exchangeExceptionBoard,
    institutionTasks,
    onsiteAcceptances,
    cutoverBlockers,
    cutoverEvidencePackets,
    cutoverEvidenceBoard,
    siteEvidenceBridge,
    siteEvidenceVerificationTasks,
    siteEvidenceVerificationBoard,
    launchApprovals,
    launchGate,
    cutoverDrills,
    cutoverDrillBoard,
    productionHandoffs,
    productionHandoffBoard,
    goLiveObservations,
    goLiveObservationBoard,
    launchIncidents,
    launchIncidentBoard,
    launchDutyShifts,
    launchDutyBoard,
    launchCommandBriefs,
    launchCommandBriefBoard,
    openCutoverBlockers,
    cutoverReadiness,
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
  const highlights = buildPublicHealthHighlights({ data: options.data || {} });
  const sources = options.sources || defaultSources();
  const standard = system.standardCoverage;
  const scopeText = system.institutionScopes.map((item) => `${item.name} ${item.institutionType}`).join("\n");
  const exchangeRunTaskIds = new Set(system.exchangeRuns.map((item) => item.taskId));
  const institutionTaskScopeIds = new Set(system.institutionTasks.map((item) => item.scopeId));
  const checks = [
    check("standard:total", standard.total.domains === 21 && standard.total.secondary === 125 && standard.total.tertiary === 421, `${standard.total.domains}/${standard.total.secondary}/${standard.total.tertiary}`, "standard"),
    check("standard:management", standard.management.domains === 18 && standard.management.secondary === 105 && standard.management.tertiary === 365, `${standard.management.domains}/${standard.management.secondary}/${standard.management.tertiary}`, "standard"),
    check("standard:technology", standard.technology.domains === 3 && standard.technology.secondary === 20 && standard.technology.tertiary === 56, `${standard.technology.domains}/${standard.technology.secondary}/${standard.technology.tertiary}`, "standard"),
    check("standard:implementation-ledger", system.standardImplementationBoard?.traceabilityReady === true && system.standardImplementationBoard?.summary?.domains === 21 && system.standardImplementationBoard?.summary?.mappingComplete === 21, `${system.standardImplementationBoard?.summary?.mappingComplete || 0}/${system.standardImplementationBoard?.summary?.domains || 0} standard mappings complete`, "standard"),
    check("institution:scopes", ["疾病预防控制", "基层", "卫生健康管理", "监督", "妇幼", "二级及以上医院", "其他公共卫生"].every((token) => scopeText.includes(token)), `${system.institutionScopes.length} institution scopes`, "institution"),
    check("events:closed-loop", system.events.length >= 6 && system.events.every((item) => item.commandAction && item.followupAction && item.linkedStandardItems?.length), `${system.events.length} events`, "event"),
    check("events:high-priority", system.summary.highPriorityEvents >= 3 && system.riskQueue.some((item) => item.domain === "突发公共卫生事件管理"), `${system.summary.highPriorityEvents} high priority events`, "event"),
    check("events:action-api", sources.server.includes("/api/public-health/events/:id/actions") && sources.server.includes("public-health-event-action"), "event action API with audit evidence", "event"),
    check("frontend:event-actions", sources.js.includes("data-public-health-action") && sources.html.includes("public-health-risk-queue"), "risk queue exposes command actions", "frontend"),
    check("exchange:categories", ["direct-report", "laboratory", "immunization", "maternal-child", "emergency", "security"].every((category) => system.exchangeCategories.includes(category)), system.exchangeCategories.join(","), "exchange"),
    check("exchange:runs", system.exchangeTasks.every((item) => exchangeRunTaskIds.has(item.id)) && system.exchangeRuns.every((item) => item.receiptStatus && item.compensationStatus), `${system.exchangeRuns.length} exchange runs with receipts`, "exchange"),
    check("exchange:compensation", system.exchangeRuns.some((item) => /replay|compensat|manual|retry|重放|补偿|人工/i.test(`${item.compensationStatus || ""} ${item.status || ""}`)), "failed exchange compensation path is modeled", "exchange"),
    check("exchange:exception-board", system.exchangeExceptionBoard?.summary?.exceptions >= 1 && system.exchangeExceptionBoard?.entries?.every((item) => item.exceptionStatus && typeof item.exceptionOpen === "boolean") && ["exchange-exception-open", "exchange-exception-overdue", "exchange-exceptions-resolved", "exchange-exception-clear"].includes(system.exchangeExceptionBoard?.status), `${system.exchangeExceptionBoard?.summary?.openExceptions || 0}/${system.exchangeExceptionBoard?.summary?.exceptions || 0} exchange exceptions remain open`, "exchange"),
    check("institution:tasks", system.institutionScopes.every((item) => institutionTaskScopeIds.has(item.id)) && system.institutionTasks.every((item) => item.owner && item.handoffStatus && item.accountStatus), `${system.institutionTasks.length} institution collaboration tasks`, "institution"),
    check("onsite:acceptance", system.onsiteAcceptances.length >= 6 && system.onsiteAcceptances.every((item) => item.owner && item.blocker && item.onsiteAction && item.evidence?.length), `${system.onsiteAcceptances.length} onsite acceptance rows`, "onsite"),
    check("cutover:blockers", system.cutoverBlockers.length >= 6 && system.cutoverBlockers.every((item) => item.owner && item.dependency && item.blocker && item.requiredEvidence?.length && item.resolutionAction), `${system.cutoverBlockers.length} production cutover blockers`, "cutover"),
    check("cutover:open-boundary", system.summary.p0OpenCutoverBlockers >= 1 && system.openCutoverBlockers.every((item) => item.dueAt && item.linkedAcceptanceId), `${system.summary.openCutoverBlockers} open blockers, ${system.summary.p0OpenCutoverBlockers} P0`, "cutover"),
    check("cutover:evidence-packets", system.cutoverEvidencePackets.length >= system.cutoverBlockers.length && system.cutoverEvidenceBoard?.summary?.requiredItems >= 20 && system.cutoverEvidencePackets.every((item) => item.blockerId && item.assignee && item.requiredItems?.length), `${system.cutoverEvidenceBoard?.summary?.packets || 0} packets / ${system.cutoverEvidenceBoard?.summary?.requiredItems || 0} required items`, "cutover"),
    check("cutover:readiness-board", system.cutoverReadiness?.releaseGate === "site-evidence-required" && system.cutoverReadiness?.nextActions?.length >= system.summary.openCutoverBlockers && system.cutoverReadiness?.summary?.p0Open === system.summary.p0OpenCutoverBlockers, `${system.cutoverReadiness?.readinessLevel || "unknown"} / ${system.cutoverReadiness?.summary?.p0Open || 0} P0 open`, "cutover"),
    check("cutover:drill-board", system.cutoverDrillBoard?.summary?.drills >= 4 && system.cutoverDrillBoard?.summary?.linkedBlockers >= 5 && system.cutoverDrillBoard?.status === "blocked", `${system.cutoverDrillBoard?.summary?.blockedDrills || 0}/${system.cutoverDrillBoard?.summary?.drills || 0} drills blocked with ${system.cutoverDrillBoard?.summary?.openFindings || 0} open findings`, "cutover"),
    check("production:handoffs", system.productionHandoffBoard?.summary?.handoffs >= 6 && system.productionHandoffBoard?.summary?.linkedEvidencePackets >= 5 && system.productionHandoffBoard?.summary?.releaseArtifacts >= 8 && system.productionHandoffBoard?.status === "blocked", `${system.productionHandoffBoard?.summary?.acceptedHandoffs || 0}/${system.productionHandoffBoard?.summary?.handoffs || 0} production handoffs accepted`, "production"),
    check("go-live:observation-plan", system.goLiveObservationBoard?.summary?.observations >= 6 && system.goLiveObservationBoard?.summary?.planReady === system.goLiveObservationBoard?.summary?.observations && system.goLiveObservationBoard?.summary?.rollbackPlans === system.goLiveObservationBoard?.summary?.observations && system.goLiveObservationBoard?.status === "watch-ready", `${system.goLiveObservationBoard?.summary?.observations || 0} observation windows / ${system.goLiveObservationBoard?.summary?.rollbackPlans || 0} rollback plans`, "go-live"),
    check("go-live:incident-desk", system.launchIncidentBoard?.summary?.lanes >= 6 && system.launchIncidentBoard?.summary?.deskReady === system.launchIncidentBoard?.summary?.lanes && system.launchIncidentBoard?.summary?.rollbackDecisionOwners >= 4 && system.launchIncidentBoard?.summary?.criticalOpenTickets === 0 && system.launchIncidentBoard?.status === "desk-ready", `${system.launchIncidentBoard?.summary?.deskReady || 0}/${system.launchIncidentBoard?.summary?.lanes || 0} incident lanes ready`, "go-live"),
    check("go-live:duty-handoffs", system.launchDutyBoard?.summary?.shifts >= 6 && system.launchDutyBoard?.summary?.readyShifts === system.launchDutyBoard?.summary?.shifts && system.launchDutyBoard?.summary?.backupContacts === system.launchDutyBoard?.summary?.shifts && system.launchDutyBoard?.summary?.missedHandoffs === 0 && system.launchDutyBoard?.status === "roster-ready", `${system.launchDutyBoard?.summary?.readyShifts || 0}/${system.launchDutyBoard?.summary?.shifts || 0} duty shifts ready`, "go-live"),
    check("go-live:command-briefs", system.launchCommandBriefBoard?.summary?.briefs >= 5 && system.launchCommandBriefBoard?.summary?.readyBriefs === system.launchCommandBriefBoard?.summary?.briefs && system.launchCommandBriefBoard?.summary?.sourceBoards >= 4 && system.launchCommandBriefBoard?.summary?.blockedBriefs === 0 && system.launchCommandBriefBoard?.status === "briefing-ready", `${system.launchCommandBriefBoard?.summary?.readyBriefs || 0}/${system.launchCommandBriefBoard?.summary?.briefs || 0} launch command briefs ready`, "go-live"),
    check("go-live:command-brief-delivery-receipts", Number.isInteger(system.launchCommandBriefBoard?.summary?.expectedAcknowledgements) && Number.isInteger(system.launchCommandBriefBoard?.summary?.acknowledgedRecipients) && Number.isInteger(system.launchCommandBriefBoard?.summary?.pendingAcknowledgements) && Number.isInteger(system.launchCommandBriefBoard?.summary?.escalatedAcknowledgements), `${system.launchCommandBriefBoard?.summary?.acknowledgedRecipients || 0}/${system.launchCommandBriefBoard?.summary?.expectedAcknowledgements || 0} command brief delivery receipts / ${system.launchCommandBriefBoard?.summary?.pendingAcknowledgements || 0} pending`, "go-live"),
    check("site-evidence:bridge", system.siteEvidenceBridge?.summary?.links >= 8 && system.siteEvidenceBridge?.summary?.linkedItems >= 20 && ["missing-site-evidence", "partial", "verified"].includes(system.siteEvidenceBridge?.status), `${system.siteEvidenceBridge?.summary?.verifiedLinks || 0}/${system.siteEvidenceBridge?.summary?.links || 0} site evidence links verified`, "site-evidence"),
    check("site-evidence:verification-desk", system.siteEvidenceVerificationBoard?.summary?.tasks >= 9 && system.siteEvidenceVerificationBoard?.summary?.structurallyReadyTasks === system.siteEvidenceVerificationBoard?.summary?.tasks && ["evidence-pending", "verification-pending", "blocked", "verified"].includes(system.siteEvidenceVerificationBoard?.status), `${system.siteEvidenceVerificationBoard?.summary?.verifiedTasks || 0}/${system.siteEvidenceVerificationBoard?.summary?.tasks || 0} site evidence tasks verified`, "site-evidence"),
    check("launch:gate", system.launchGate?.releaseGate === "site-evidence-required" && system.launchGate?.requirements?.length >= 8 && system.launchGate?.approvals?.length >= 6 && system.launchGate?.summary?.blockedRequirements >= 1, `${system.launchGate?.summary?.passedRequirements || 0}/${system.launchGate?.summary?.requirements || 0} launch requirements passed`, "launch"),
    check("launch:approval-preflight", system.launchGate?.approvalPreflight?.status === "blocked" && system.launchGate?.approvalPreflight?.blockedPrerequisites >= 1 && system.launchGate?.approvalPreflight?.blockedRequirementIds?.includes("launch-site-evidence-verification"), `${system.launchGate?.approvalPreflight?.passedPrerequisites || 0}/${system.launchGate?.approvalPreflight?.prerequisiteRequirements || 0} approval prerequisites passed`, "launch"),
    check("frontend:advanced-panels", ["public-health-exchange-runs", "public-health-institution-tasks", "public-health-onsite-acceptances"].every((id) => sources.html.includes(id)) && ["renderExchangeRuns", "renderInstitutionTasks", "renderOnsiteAcceptances"].every((token) => sources.js.includes(token)), "exchange, institution and onsite panels are visible", "frontend"),
    check("frontend:exchange-exception-actions", ["data-public-health-exchange-exception", "data-public-health-exchange-exception-owner", "data-public-health-exchange-exception-due-at", "data-public-health-exchange-exception-receipt", "assign-exchange-exception", "resolve-exchange-exception"].every((token) => sources.js.includes(token)), "exchange exception assignment, escalation and compensation receipt controls are wired", "frontend"),
    check("frontend:cutover-panel", sources.html.includes("public-health-cutover-blockers") && sources.js.includes("renderCutoverBlockers") && sources.js.includes("data-public-health-cutover-blocker"), "cutover blockers panel is visible and actionable", "frontend"),
    check("frontend:cutover-readiness-panel", sources.html.includes("public-health-cutover-readiness") && sources.js.includes("renderCutoverReadiness") && sources.js.includes("buildStaticCutoverReadiness"), "cutover readiness board is visible", "frontend"),
    check("frontend:cutover-evidence-panel", sources.html.includes("public-health-cutover-evidence-packets") && sources.js.includes("renderCutoverEvidencePackets") && sources.js.includes("data-public-health-cutover-evidence-packet"), "cutover evidence packets panel is visible and actionable", "frontend"),
    check("frontend:cutover-drill-panel", sources.html.includes("public-health-cutover-drills") && sources.js.includes("renderCutoverDrills") && sources.js.includes("data-public-health-cutover-drill"), "cutover drill board is visible and actionable", "frontend"),
    check("frontend:production-handoff-panel", sources.html.includes("public-health-production-handoffs") && sources.js.includes("renderProductionHandoffs") && sources.js.includes("data-public-health-production-handoff"), "production handoff panel is visible and actionable", "frontend"),
    check("frontend:go-live-observation-panel", sources.html.includes("public-health-go-live-observations") && sources.js.includes("renderGoLiveObservations") && sources.js.includes("data-public-health-go-live-observation"), "go-live observation panel is visible and actionable", "frontend"),
    check("frontend:launch-incident-panel", sources.html.includes("public-health-launch-incidents") && sources.js.includes("renderLaunchIncidents") && sources.js.includes("data-public-health-launch-incident"), "launch incident desk panel is visible and actionable", "frontend"),
    check("frontend:launch-duty-panel", sources.html.includes("public-health-launch-duty-shifts") && sources.js.includes("renderLaunchDutyShifts") && sources.js.includes("data-public-health-launch-duty-shift"), "launch duty handoff panel is visible and actionable", "frontend"),
    check("frontend:launch-command-brief-panel", sources.html.includes("public-health-launch-command-briefs") && sources.js.includes("renderLaunchCommandBriefs") && sources.js.includes("data-public-health-launch-command-brief"), "launch command brief panel is visible and actionable", "frontend"),
    check("frontend:launch-command-brief-receipts", ["data-public-health-launch-command-brief-receipt-target", "data-public-health-launch-command-brief-receipt-note", "acknowledge-launch-command-brief", "escalate-launch-command-brief-receipt", "pendingAcknowledgementTargets"].every((token) => sources.js.includes(token)), "launch command brief delivery receipt and escalation controls are wired", "frontend"),
    check("frontend:site-evidence-bridge-panel", sources.html.includes("public-health-site-evidence-bridge") && sources.js.includes("renderSiteEvidenceBridge") && sources.js.includes("data-public-health-site-evidence-link"), "site evidence bridge panel is visible and actionable", "frontend"),
    check("frontend:site-evidence-verification-panel", sources.html.includes("public-health-site-evidence-verification") && sources.js.includes("renderSiteEvidenceVerificationTasks") && sources.js.includes("data-public-health-site-evidence-verification-task"), "site evidence verification task desk is visible and actionable", "frontend"),
    check("frontend:standard-implementation-panel", sources.html.includes("public-health-standard-implementation") && sources.js.includes("renderStandardImplementationLedger") && sources.js.includes("data-public-health-standard-implementation"), "standard implementation ledger is visible and actionable", "frontend"),
    check("frontend:standard-implementation-actions", ["data-public-health-standard-action", "data-public-health-standard-note", "data-public-health-standard-evidence-id", "data-public-health-standard-remediation-owner", "data-public-health-standard-remediation-due-at", "assign-standard-gap-remediation", "verify-standard-gap-remediation", "standardImplementationEvidenceCandidates", "remediationUnassigned", "remediationDueSoon", "remediationOverdue"].every((token) => sources.js.includes(token)), "standard mapping review, remediation assignment, due-date watch, verification and verified-evidence link controls are wired", "frontend"),
    check("frontend:launch-gate-panel", sources.html.includes("public-health-launch-gate") && sources.js.includes("renderLaunchGate") && sources.js.includes("data-public-health-launch-approval"), "production launch gate panel is visible and actionable", "frontend"),
    check("frontend:launch-approval-preflight", sources.js.includes("data-public-health-launch-approval-preflight") && sources.js.includes("submit-launch-approval"), "launch approval preflight is visible and submits before final approval", "frontend"),
    check("api:advanced-actions", ["/api/public-health/exchange-tasks/:id/runs", "/api/public-health/exchange-runs/:id/actions", "/api/public-health/institution-tasks/:id/actions", "/api/public-health/onsite-acceptances/:id/actions", "/api/public-health/cutover-blockers/:id/actions"].every((token) => sources.server.includes(token)), "exchange, institution, onsite and cutover action APIs are wired", "api"),
    check("api:exchange-exception-actions", ["/api/public-health/exchange-runs/:id/actions", "public-health-exchange-exception-action", "assign-exchange-exception", "resolve-exchange-exception"].every((token) => sources.server.includes(token)), "exchange exception action API is wired with compensation safeguards", "api"),
    check("api:cutover-readiness", sources.server.includes("/api/public-health/cutover-readiness") && sources.server.includes("public-health-cutover-readiness"), "GET /api/public-health/cutover-readiness", "api"),
    check("api:cutover-evidence-packets", sources.server.includes("/api/public-health/cutover-evidence-packets/:id/actions") && sources.server.includes("public-health-cutover-evidence-packet-action"), "cutover evidence packet action API is wired", "api"),
    check("api:cutover-drills", sources.server.includes("/api/public-health/cutover-drills/:id/actions") && sources.server.includes("public-health-cutover-drill-action"), "cutover drill action API is wired", "api"),
    check("api:production-handoffs", sources.server.includes("/api/public-health/production-handoffs/:id/actions") && sources.server.includes("public-health-production-handoff-action"), "production handoff API is wired", "api"),
    check("api:go-live-observations", sources.server.includes("/api/public-health/go-live-observations/:id/actions") && sources.server.includes("public-health-go-live-observation-action"), "go-live observation API is wired", "api"),
    check("api:launch-incidents", sources.server.includes("/api/public-health/launch-incidents/:id/actions") && sources.server.includes("public-health-launch-incident-action"), "launch incident desk API is wired", "api"),
    check("api:launch-duty-shifts", sources.server.includes("/api/public-health/launch-duty-shifts/:id/actions") && sources.server.includes("public-health-launch-duty-shift-action"), "launch duty shift API is wired", "api"),
    check("api:launch-command-briefs", ["/api/public-health/launch-command-briefs/:id/actions", "public-health-launch-command-brief-action", "acknowledge-launch-command-brief", "escalate-launch-command-brief-receipt", "acknowledgementTarget"].every((token) => sources.server.includes(token)), "launch command brief API is wired with delivery receipt safeguards", "api"),
    check("api:site-evidence-bridge", sources.server.includes("/api/public-health/site-evidence-bridge") && sources.server.includes("public-health-site-evidence-bridge-action"), "site evidence bridge API is wired", "api"),
    check("api:site-evidence-verification-tasks", sources.server.includes("/api/public-health/site-evidence-verification-tasks/:id/actions") && sources.server.includes("public-health-site-evidence-verification-action"), "site evidence verification task API is wired", "api"),
    check("api:standard-implementation-ledger", ["/api/public-health/standard-implementation-ledger/:id/actions", "public-health-standard-implementation-action", "assign-standard-gap-remediation", "verify-standard-gap-remediation", "remediationOwner and remediationDueAt"].every((token) => sources.server.includes(token)), "standard implementation ledger API is wired with remediation safeguards", "api"),
    check("api:launch-gate", sources.server.includes("/api/public-health/launch-gate") && sources.server.includes("public-health-launch-gate-action") && sources.server.includes("launch approval is blocked until all prerequisite launch requirements pass"), "public health production launch gate API is wired", "api"),
    check("publicHealth:highlightCapabilities", highlights.summary.capabilities === 5 && highlights.capabilities.length === 5 && highlights.formalGoLiveState === "blocked-until-site-evidence-signed", `${highlights.summary.capabilities} highlight capabilities / ${highlights.summary.activeAlerts} active alerts / ${highlights.summary.openTasks} open tasks`, "public-health"),
    check("api:highlight-actions", ["/api/public-health/highlights", "/api/public-health/highlights/signals", "/api/public-health/highlights/alerts/:id/actions", "/api/public-health/highlights/command-tasks/:id/actions", "/api/public-health/highlights/ai-reviews/:id/actions", "/api/public-health/highlights/evidence/:id/actions"].every((token) => sources.server.includes(token)), "five-suite public health highlight APIs are wired", "api"),
    check("frontend:highlight-center", sources.html.includes("public-health-highlight-center") && sources.js.includes("renderPublicHealthHighlights"), "public health highlight center is visible", "frontend"),
    check("frontend:page", sources.html.includes("public-health-metrics") && sources.js.includes("renderPublicHealthSystem"), "public-health.html and public-health.js are wired", "frontend"),
    check("api:route", sources.server.includes("/api/public-health/system") && sources.server.includes("buildPublicHealthSystem"), "GET /api/public-health/system", "api"),
    check("package:script", Boolean(pkg.scripts?.["public-health:readiness"]) && sources.packageSource.includes("public-health-readiness.js"), pkg.scripts?.["public-health:readiness"] || "missing", "release"),
    check("manifest:artifact", sources.manifest.includes("public-health-readiness-report.md") && sources.manifest.includes("public-health:readiness"), "release manifest indexes public health artifact", "release"),
    check("docs:report", ["21/125/421", "平战结合", "医防融合", "/api/public-health/system", "/api/public-health/exchange-tasks/:id/runs", "/api/public-health/exchange-runs/:id/actions", "/api/public-health/cutover-blockers/:id/actions", "/api/public-health/cutover-readiness", "/api/public-health/cutover-evidence-packets/:id/actions", "/api/public-health/cutover-drills/:id/actions", "/api/public-health/site-evidence-bridge/actions", "/api/public-health/site-evidence-verification-tasks/:id/actions", "/api/public-health/standard-implementation-ledger/:id/actions", "/api/public-health/launch-gate/actions", "assign-exchange-exception", "resolve-exchange-exception", "record-standard-gap", "escalate-standard-gap", "assign-standard-gap-remediation", "verify-standard-gap-remediation", "remediationOverdue", "link-standard-site-evidence", "publicHealthExchangeRuns", "publicHealthInstitutionTasks", "publicHealthOnsiteAcceptances", "publicHealthCutoverBlockers", "publicHealthCutoverReadiness", "publicHealthCutoverEvidencePackets", "publicHealthCutoverDrills", "publicHealthSiteEvidenceBridge", "publicHealthSiteEvidenceVerificationTasks", "publicHealthStandardImplementationLedger", "publicHealthLaunchApprovals", "approvalPreflight", "APPROVE PUBLIC HEALTH LAUNCH", "public-health:readiness"].every((token) => sources.docs.includes(token)), "public health build report documents scope, exchange exception compensation, standard implementation remediation watch, exchange runs, institution tasks, onsite acceptance, cutover blockers, cutover readiness, site evidence verification, launch approval preflight, and release evidence", "docs"),
    check("docs:production-handoffs", ["/api/public-health/production-handoffs/:id/actions", "publicHealthProductionHandoffs", "production handoff"].every((token) => sources.docs.includes(token)), "public health report documents production handoff packs", "docs"),
    check("docs:go-live-observations", ["/api/public-health/go-live-observations/:id/actions", "publicHealthGoLiveObservations", "go-live observation"].every((token) => sources.docs.includes(token)), "public health report documents launch-day observation and rollback watch", "docs"),
    check("docs:launch-incidents", ["/api/public-health/launch-incidents/:id/actions", "publicHealthLaunchIncidents", "launch incident desk"].every((token) => sources.docs.includes(token)), "public health report documents launch incident triage and rollback decision desk", "docs"),
    check("docs:launch-duty", ["/api/public-health/launch-duty-shifts/:id/actions", "publicHealthLaunchDutyShifts", "launch duty handoff"].every((token) => sources.docs.includes(token)), "public health report documents launch duty roster and command handoff desk", "docs"),
    check("docs:launch-command-briefs", ["/api/public-health/launch-command-briefs/:id/actions", "publicHealthLaunchCommandBriefs", "launch command brief", "acknowledge-launch-command-brief", "delivery receipt"].every((token) => sources.docs.includes(token)), "public health report documents launch command briefs, delivery receipts and status broadcasts", "docs"),
    check("docs:next-plan", ["5 小时开发切片", "事件处置闭环", "验收清单"].every((token) => sources.plan.includes(token)), "next development plan is documented", "docs")
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: system.summary,
    sourceDocuments: system.sourceDocuments,
    standardCoverage: system.standardCoverage,
    standardImplementationLedger: system.standardImplementationLedger,
    standardImplementationBoard: system.standardImplementationBoard,
    standardImplementationEvidenceCandidates: system.standardImplementationEvidenceCandidates,
    institutionScopes: system.institutionScopes,
    exchangeTasks: system.exchangeTasks,
    exchangeRuns: system.exchangeRuns,
    exchangeExceptionBoard: system.exchangeExceptionBoard,
    institutionTasks: system.institutionTasks,
    onsiteAcceptances: system.onsiteAcceptances,
    cutoverBlockers: system.cutoverBlockers,
    cutoverEvidencePackets: system.cutoverEvidencePackets,
    cutoverEvidenceBoard: system.cutoverEvidenceBoard,
    cutoverDrills: system.cutoverDrills,
    cutoverDrillBoard: system.cutoverDrillBoard,
    productionHandoffs: system.productionHandoffs,
    productionHandoffBoard: system.productionHandoffBoard,
    goLiveObservations: system.goLiveObservations,
    goLiveObservationBoard: system.goLiveObservationBoard,
    launchIncidents: system.launchIncidents,
    launchIncidentBoard: system.launchIncidentBoard,
    launchDutyShifts: system.launchDutyShifts,
    launchDutyBoard: system.launchDutyBoard,
    launchCommandBriefs: system.launchCommandBriefs,
    launchCommandBriefBoard: system.launchCommandBriefBoard,
    siteEvidenceBridge: system.siteEvidenceBridge,
    siteEvidenceVerificationTasks: system.siteEvidenceVerificationTasks,
    siteEvidenceVerificationBoard: system.siteEvidenceVerificationBoard,
    launchApprovals: system.launchApprovals,
    launchGate: system.launchGate,
    highlights,
    openCutoverBlockers: system.openCutoverBlockers,
    cutoverReadiness: system.cutoverReadiness,
    riskQueue: system.riskQueue,
    readinessEvidence: system.readinessEvidence,
    checks,
    system
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const domainRows = report.system.standardDomains.map((item) => `| ${item.order} | ${item.category} | ${item.name} | ${item.secondaryCount} | ${item.tertiaryCount} | ${item.owner} | ${item.linkedRecords} |`);
  const standardImplementationBoard = report.standardImplementationBoard || {};
  const standardImplementationSummary = standardImplementationBoard.summary || {};
  const standardImplementationRows = (standardImplementationBoard.entries || report.standardImplementationLedger || []).map((item) => `| ${item.order || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.status || ""} | ${item.mappingComplete ? "COMPLETE" : "MISSING"} | ${item.gapStatus || ""} | ${item.remediationStatus || "not-planned"} | ${item.remediationOwner || ""} | ${item.remediationDueAt || ""} | ${item.remediationDueInDays ?? ""} | ${item.remediationOverdue ? "OVERDUE" : item.remediationDueSoon ? "DUE SOON" : item.remediationUnassigned ? "UNASSIGNED" : ""} | ${item.siteEvidenceId || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const scopeRows = report.institutionScopes.map((item) => `| ${item.name} | ${item.responsibilities.join("、")} | ${item.coveredDomains.join("、")} | ${item.status} |`);
  const riskRows = report.riskQueue.slice(0, 12).map((item) => `| ${item.priority} | ${item.domain} | ${item.signal} | ${item.institution} | ${item.status} | ${item.commandAction.replace(/\|/g, "/")} |`);
  const exchangeRows = report.exchangeTasks.map((item) => `| ${item.category} | ${item.name} | ${item.sourceSystems.join("、")} | ${item.targetCollections.join("、")} | ${item.status} |`);
  const exchangeRunRows = report.exchangeRuns.map((item) => `| ${item.category} | ${item.sourceSystem} | ${item.status} | ${item.receiptStatus} | ${item.compensationStatus} | ${item.payloadRecords || 0}/${item.failedRecords || 0} | ${item.nextAction.replace(/\|/g, "/")} |`);
  const exchangeExceptionBoard = report.exchangeExceptionBoard || {};
  const exchangeExceptionSummary = exchangeExceptionBoard.summary || {};
  const exchangeExceptionRows = (exchangeExceptionBoard.entries || []).map((item) => `| ${item.exceptionOpen ? "OPEN" : "RESOLVED"} | ${item.category || ""} | ${item.sourceSystem || ""} | ${item.failedRecords || 0} | ${item.exceptionStatus || ""} | ${item.exceptionOwner || ""} | ${item.exceptionDueAt || ""} | ${item.exceptionDueInDays ?? ""} | ${item.compensationReceiptId || ""} | ${String(item.exceptionSummary || item.nextAction || "").replace(/\|/g, "/")} |`);
  const institutionTaskRows = report.institutionTasks.map((item) => `| ${item.roleView} | ${item.taskType} | ${item.owner} | ${item.status} | ${item.handoffStatus} | ${item.accountStatus} | ${item.nextAction.replace(/\|/g, "/")} |`);
  const onsiteRows = report.onsiteAcceptances.map((item) => `| ${item.severity} | ${item.category} | ${item.name} | ${item.owner} | ${item.status} | ${item.signoffStatus} | ${item.onsiteAction.replace(/\|/g, "/")} |`);
  const cutoverRows = report.cutoverBlockers.map((item) => `| ${item.severity} | ${item.category} | ${item.name} | ${item.owner} | ${item.dependency} | ${item.status} | ${item.dueAt || ""} | ${item.resolutionAction.replace(/\|/g, "/")} |`);
  const cutoverReadiness = report.cutoverReadiness || {};
  const cutoverReadinessSummary = cutoverReadiness.summary || {};
  const cutoverReadinessRows = (cutoverReadiness.nextActions || []).map((item) => `| ${item.severity || ""} | ${item.escalationLevel || ""} | ${item.category || ""} | ${item.name || ""} | ${item.assignee || item.owner || ""} | ${item.dueAt || ""} | ${item.siteWindow || ""} | ${item.reminderChannel || ""} | ${item.remediationStatus || ""} | ${String(item.resolutionAction || "").replace(/\|/g, "/")} |`);
  const cutoverEvidenceSummary = report.cutoverEvidenceBoard?.summary || {};
  const cutoverEvidenceRows = (report.cutoverEvidenceBoard?.packets || report.cutoverEvidencePackets || []).map((item) => `| ${item.severity || ""} | ${item.category || ""} | ${item.name || ""} | ${item.assignee || item.owner || ""} | ${item.status || ""} | ${item.verifiedCount || 0}/${item.requiredCount || item.requiredItems?.length || 0} | ${item.dueAt || ""} | ${item.siteWindow || ""} |`);
  const cutoverDrillBoard = report.cutoverDrillBoard || {};
  const cutoverDrillSummary = cutoverDrillBoard.summary || {};
  const cutoverDrillRows = (cutoverDrillBoard.drills || report.cutoverDrills || []).map((item) => `| ${item.blocked ? "BLOCKED" : item.passed ? "PASS" : "RETEST"} | ${item.phase || ""} | ${item.scenario || ""} | ${item.owner || ""} | ${item.goNoGo || ""} | ${item.openFindingCount || 0} | ${(item.linkedBlockerIds || []).join(", ")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const productionHandoffBoard = report.productionHandoffBoard || {};
  const productionHandoffSummary = productionHandoffBoard.summary || {};
  const productionHandoffRows = (productionHandoffBoard.handoffs || report.productionHandoffs || []).map((item) => `| ${item.accepted ? "ACCEPTED" : "PENDING"} | ${item.packageType || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.receiver || ""} | ${item.dueAt || ""} | ${item.missingSignoffCount || 0} | ${(item.releaseArtifacts || []).join(", ")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const goLiveObservationBoard = report.goLiveObservationBoard || {};
  const goLiveObservationSummary = goLiveObservationBoard.summary || {};
  const goLiveObservationRows = (goLiveObservationBoard.observations || report.goLiveObservations || []).map((item) => `| ${item.passed ? "PASS" : item.criticalOpen ? "CRITICAL" : "PENDING"} | ${item.window || ""} | ${item.phase || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.metric || ""} | ${item.rollbackOwner || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const launchIncidentBoard = report.launchIncidentBoard || {};
  const launchIncidentSummary = launchIncidentBoard.summary || {};
  const launchIncidentRows = (launchIncidentBoard.incidents || report.launchIncidents || []).map((item) => `| ${item.criticalOpen ? "CRITICAL" : item.open ? "OPEN" : item.resolved ? "RESOLVED" : "STANDBY"} | ${item.lane || ""} | ${item.severity || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.sla || ""} | ${item.rollbackDecisionOwner || ""} | ${(item.escalationPath || []).join(", ")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const launchDutyBoard = report.launchDutyBoard || {};
  const launchDutySummary = launchDutyBoard.summary || {};
  const launchDutyRows = (launchDutyBoard.shifts || report.launchDutyShifts || []).map((item) => `| ${item.missed ? "MISSED" : item.escalated ? "WATCH" : item.shiftReady ? "READY" : "BLOCKED"} | ${item.shiftWindow || ""} | ${item.lane || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.backupOwner || ""} | ${item.contactChannel || ""} | ${item.escalationOwner || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const launchCommandBriefBoard = report.launchCommandBriefBoard || {};
  const launchCommandBriefSummary = launchCommandBriefBoard.summary || {};
  const launchCommandBriefRows = (launchCommandBriefBoard.briefs || report.launchCommandBriefs || []).map((item) => `| ${item.blocked ? "WATCH" : item.briefReady ? "READY" : "BLOCKED"} | ${item.briefWindow || ""} | ${item.phase || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.recorder || ""} | ${(item.sourceBoards || []).join(", ")} | ${item.publishChannel || ""} | ${item.acknowledgedRecipientCount || 0}/${item.expectedAcknowledgementCount || 0} | ${(item.pendingAcknowledgementTargets || []).join(", ")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const siteEvidenceBridge = report.siteEvidenceBridge || {};
  const siteEvidenceSummary = siteEvidenceBridge.summary || {};
  const siteEvidenceRows = (siteEvidenceBridge.links || []).map((item) => `| ${item.verified ? "PASS" : "MISSING"} | ${item.templateId || ""} | ${item.packetId || ""} | ${(item.itemIds || []).join(", ")} | ${item.acceptanceId || ""} | ${item.artifactName || ""} | ${String(item.requirement || "").replace(/\|/g, "/")} |`);
  const siteEvidenceVerificationBoard = report.siteEvidenceVerificationBoard || {};
  const siteEvidenceVerificationSummary = siteEvidenceVerificationBoard.summary || {};
  const siteEvidenceVerificationRows = (siteEvidenceVerificationBoard.tasks || report.siteEvidenceVerificationTasks || []).map((item) => `| ${item.verified ? "VERIFIED" : item.blocked ? "BLOCKED" : item.evidenceAvailable ? "PENDING REVIEW" : "EVIDENCE PENDING"} | ${item.priority || ""} | ${item.name || ""} | ${item.owner || ""} | ${item.bridgeEvidenceId || ""} | ${item.status || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const launchGate = report.launchGate || {};
  const launchSummary = launchGate.summary || {};
  const approvalPreflight = launchGate.approvalPreflight || {};
  const launchRequirementRows = (launchGate.requirements || []).map((item) => `| ${item.passed ? "PASS" : "BLOCKED"} | ${item.id || ""} | ${item.name || ""} | ${(item.evidence || []).join(", ")} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  const launchApprovalRows = (launchGate.approvals || report.launchApprovals || []).map((item) => `| ${item.status || ""} | ${item.role || ""} | ${item.owner || ""} | ${item.approver || ""} | ${item.dueAt || ""} | ${String(item.nextAction || "").replace(/\|/g, "/")} |`);
  return [
    "# Public health informatization readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Standard coverage: ${report.summary.domains}/${report.summary.secondaryIndicators}/${report.summary.tertiaryIndicators}`,
    `- Standard implementation ledger: ${standardImplementationBoard.status || "unknown"}; mappings ${standardImplementationSummary.mappingComplete || 0}/${standardImplementationSummary.domains || 0}, reviewed ${standardImplementationSummary.reviewed || 0}, gaps ${standardImplementationSummary.gaps || 0}, unassigned ${standardImplementationSummary.unassignedRemediations || 0}, due soon ${standardImplementationSummary.dueSoonRemediations || 0}, overdue ${standardImplementationSummary.overdueRemediations || 0}, assigned ${standardImplementationSummary.assignedRemediations || 0}, remediation verified ${standardImplementationSummary.verifiedRemediations || 0}, verified evidence candidates ${(report.standardImplementationEvidenceCandidates || []).length}`,
    `- Institution scopes: ${report.summary.institutionScopes}`,
    `- Events: ${report.summary.events}, high priority ${report.summary.highPriorityEvents}`,
    `- Event actions recorded: ${report.summary.eventActions}`,
    `- Exchange tasks: ${report.summary.exchangeTasks}`,
    `- Exchange runs: ${report.summary.exchangeRuns}, compensated ${report.summary.compensatedExchangeRuns}`,
    `- Exchange exception compensation: ${exchangeExceptionBoard.status || "unknown"}; open ${exchangeExceptionSummary.openExceptions || 0}/${exchangeExceptionSummary.exceptions || 0}, unassigned ${exchangeExceptionSummary.unassignedExceptions || 0}, due soon ${exchangeExceptionSummary.dueSoonExceptions || 0}, overdue ${exchangeExceptionSummary.overdueExceptions || 0}`,
    `- Institution tasks: ${report.summary.institutionTasks}`,
    `- On-site acceptance rows: ${report.summary.onsiteAcceptances}, ready ${report.summary.onsiteReady}`,
    `- Cutover blockers: ${report.summary.cutoverBlockers}, open ${report.summary.openCutoverBlockers}, P0 open ${report.summary.p0OpenCutoverBlockers}`,
    `- Cutover readiness: ${cutoverReadiness.readinessLevel || "unknown"} / ${cutoverReadiness.releaseGate || "unknown"}; evidence recorded ${cutoverReadinessSummary.evidenceRecorded || 0}, due soon ${cutoverReadinessSummary.dueSoon || 0}, overdue ${cutoverReadinessSummary.overdue || 0}`,
    `- Cutover evidence packets: ${cutoverEvidenceSummary.packets || 0}, required items ${cutoverEvidenceSummary.requiredItems || 0}, verified ${cutoverEvidenceSummary.verifiedItems || 0}, missing ${cutoverEvidenceSummary.missingItems || 0}`,
    `- Cutover drills: ${cutoverDrillBoard.status || "unknown"}; blocked ${cutoverDrillSummary.blockedDrills || 0}/${cutoverDrillSummary.drills || 0}, open findings ${cutoverDrillSummary.openFindings || 0}`,
    `- Production handoffs: ${productionHandoffBoard.status || "unknown"}; accepted ${productionHandoffSummary.acceptedHandoffs || 0}/${productionHandoffSummary.handoffs || 0}, missing signoffs ${productionHandoffSummary.missingSignoffs || 0}`,
    `- Go-live observation: ${goLiveObservationBoard.status || "unknown"}; plan ready ${goLiveObservationSummary.planReady || 0}/${goLiveObservationSummary.observations || 0}, pending observations ${goLiveObservationSummary.pendingObservations || 0}`,
    `- Launch incident desk: ${launchIncidentBoard.status || "unknown"}; lanes ready ${launchIncidentSummary.deskReady || 0}/${launchIncidentSummary.lanes || 0}, critical open ${launchIncidentSummary.criticalOpenTickets || 0}`,
    `- Launch duty handoff: ${launchDutyBoard.status || "unknown"}; shifts ready ${launchDutySummary.readyShifts || 0}/${launchDutySummary.shifts || 0}, missed handoffs ${launchDutySummary.missedHandoffs || 0}`,
    `- Launch command briefs: ${launchCommandBriefBoard.status || "unknown"}; briefs ready ${launchCommandBriefSummary.readyBriefs || 0}/${launchCommandBriefSummary.briefs || 0}, pending publication ${launchCommandBriefSummary.pendingBriefs || 0}, delivery receipts ${launchCommandBriefSummary.acknowledgedRecipients || 0}/${launchCommandBriefSummary.expectedAcknowledgements || 0}, delivery pending ${launchCommandBriefSummary.pendingAcknowledgements || 0}, escalated ${launchCommandBriefSummary.escalatedAcknowledgements || 0}`,
    `- Site evidence bridge: ${siteEvidenceBridge.status || "unknown"}; links ${siteEvidenceSummary.verifiedLinks || 0}/${siteEvidenceSummary.links || 0}, mapped items ${siteEvidenceSummary.verifiedItems || 0}/${siteEvidenceSummary.linkedItems || 0}`,
    `- Site evidence verification desk: ${siteEvidenceVerificationBoard.status || "unknown"}; verified ${siteEvidenceVerificationSummary.verifiedTasks || 0}/${siteEvidenceVerificationSummary.tasks || 0}, evidence available ${siteEvidenceVerificationSummary.evidenceAvailableTasks || 0}, blocked ${siteEvidenceVerificationSummary.blockedTasks || 0}`,
    `- Production launch gate: ${launchGate.status || "unknown"} / ${launchGate.releaseGate || "unknown"}; requirements ${launchSummary.passedRequirements || 0}/${launchSummary.requirements || 0}, approvals ${launchSummary.signedApprovals || 0}/${launchSummary.approvals || 0}; approval preflight ${approvalPreflight.status || "unknown"} ${approvalPreflight.passedPrerequisites || 0}/${approvalPreflight.prerequisiteRequirements || 0}`,
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
    "## Standard implementation ledger",
    "",
    `Ledger status: ${standardImplementationBoard.status || "unknown"}; this is a mapping and gap-review ledger, not a substitute for signed site acceptance.`,
    "",
    "| # | Domain | Owner | Mapping status | Traceability | Gap | Remediation status | Remediation owner | Due date | Days | Watch | Linked site evidence | Next action |",
    "|---:|---|---|---|---|---|---|---|---|---:|---|---|---|",
    ...standardImplementationRows,
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
    "## Exchange exception compensation",
    "",
    `Status: ${exchangeExceptionBoard.status || "unknown"}; unresolved exceptions continue to block the exchange-receipt launch requirement.`,
    "",
    "| Result | Category | Source | Failed records | Status | Owner | Due | Days | Compensation receipt | Exception summary |",
    "|---|---|---|---:|---|---|---|---:|---|---|",
    ...exchangeExceptionRows,
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
    "",
    "## Production cutover readiness",
    "",
    `Release gate: ${cutoverReadiness.releaseGate || "unknown"}; readiness level: ${cutoverReadiness.readinessLevel || "unknown"}`,
    "",
    "| Severity | Escalation | Category | Name | Assignee | Due | Site window | Reminder | Remediation | Resolution action |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...cutoverReadinessRows,
    "",
    "## Production cutover evidence packets",
    "",
    "| Severity | Category | Packet | Assignee | Status | Verified items | Due | Site window |",
    "|---|---|---|---|---|---:|---|---|",
    ...cutoverEvidenceRows,
    "",
    "## Production cutover drills",
    "",
    `Status: ${cutoverDrillBoard.status || "unknown"}; launch gate: ${cutoverDrillSummary.launchReleaseGate || "unknown"}; linked blockers: ${cutoverDrillSummary.linkedBlockers || 0}`,
    "",
    "| Result | Phase | Scenario | Owner | Go/no-go | Open findings | Linked blockers | Next action |",
    "|---|---|---|---|---|---:|---|---|",
    ...cutoverDrillRows,
    "",
    "## Production handoff packs",
    "",
    `Status: ${productionHandoffBoard.status || "unknown"}; release artifacts ${productionHandoffSummary.releaseArtifacts || 0}; pending handoffs ${productionHandoffSummary.pendingHandoffs || 0}`,
    "",
    "| Result | Type | Handoff pack | Owner | Receiver | Due | Missing signoffs | Release artifacts | Next action |",
    "|---|---|---|---|---|---|---:|---|---|",
    ...productionHandoffRows,
    "",
    "## Go-live observation and rollback watch",
    "",
    `Status: ${goLiveObservationBoard.status || "unknown"}; rollback plans ${goLiveObservationSummary.rollbackPlans || 0}; open critical signals ${goLiveObservationSummary.openCriticalSignals || 0}`,
    "",
    "| Result | Window | Phase | Observation | Owner | Metric | Rollback owner | Next action |",
    "|---|---|---|---|---|---|---|---|",
    ...goLiveObservationRows,
    "",
    "## Launch incident triage and rollback decision desk",
    "",
    `Status: ${launchIncidentBoard.status || "unknown"}; ready lanes ${launchIncidentSummary.deskReady || 0}/${launchIncidentSummary.lanes || 0}; open tickets ${launchIncidentSummary.openTickets || 0}; critical open ${launchIncidentSummary.criticalOpenTickets || 0}`,
    "",
    "| Result | Lane | Severity | Incident lane | Owner | SLA | Rollback decision owner | Escalation path | Next action |",
    "|---|---|---|---|---|---|---|---|---|",
    ...launchIncidentRows,
    "",
    "## Launch duty roster and command handoff desk",
    "",
    `Status: ${launchDutyBoard.status || "unknown"}; ready shifts ${launchDutySummary.readyShifts || 0}/${launchDutySummary.shifts || 0}; backup contacts ${launchDutySummary.backupContacts || 0}; escalation owners ${launchDutySummary.escalationOwners || 0}`,
    "",
    "| Result | Window | Lane | Duty shift | Primary owner | Backup owner | Contact channel | Escalation owner | Next action |",
    "|---|---|---|---|---|---|---|---|---|",
    ...launchDutyRows,
    "",
    "## Launch command briefs and status broadcast desk",
    "",
    `Status: ${launchCommandBriefBoard.status || "unknown"}; ready briefs ${launchCommandBriefSummary.readyBriefs || 0}/${launchCommandBriefSummary.briefs || 0}; source boards ${launchCommandBriefSummary.sourceBoards || 0}; linked incidents ${launchCommandBriefSummary.linkedIncidents || 0}; delivery receipts ${launchCommandBriefSummary.acknowledgedRecipients || 0}/${launchCommandBriefSummary.expectedAcknowledgements || 0}; pending ${launchCommandBriefSummary.pendingAcknowledgements || 0}; escalated ${launchCommandBriefSummary.escalatedAcknowledgements || 0}. Delivery receipts are an operational record and never replace site evidence or production approvals.`,
    "",
    "| Result | Window | Phase | Brief | Owner | Recorder | Source boards | Publish channel | Delivery receipts | Pending recipients | Next action |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
    ...launchCommandBriefRows,
    "",
    "## Public health site evidence bridge",
    "",
    "| Result | Site template | Packet | Evidence items | Acceptance | Artifact | Requirement |",
    "|---|---|---|---|---|---|---|",
    ...siteEvidenceRows,
    "",
    "## Site evidence verification task desk",
    "",
    `Status: ${siteEvidenceVerificationBoard.status || "unknown"}; structurally ready ${siteEvidenceVerificationSummary.structurallyReadyTasks || 0}/${siteEvidenceVerificationSummary.tasks || 0}; missing evidence ${siteEvidenceVerificationSummary.missingEvidenceTasks || 0}; escalation contacts ${siteEvidenceVerificationSummary.escalationPaths || 0}`,
    "",
    "| Result | Priority | Task | Owner | Matched evidence ID | Task status | Next action |",
    "|---|---|---|---|---|---|---|",
    ...siteEvidenceVerificationRows,
    "",
    "## Production launch gate",
    "",
    `Release gate: ${launchGate.releaseGate || "unknown"}; status: ${launchGate.status || "unknown"}; production ready: ${launchGate.productionReady ? "yes" : "no"}`,
    `Approval preflight: ${approvalPreflight.status || "unknown"}; prerequisites passed: ${approvalPreflight.passedPrerequisites || 0}/${approvalPreflight.prerequisiteRequirements || 0}; blocked: ${approvalPreflight.blockedPrerequisites || 0}`,
    "",
    "| Result | Requirement | Name | Evidence | Next action |",
    "|---|---|---|---|---|",
    ...launchRequirementRows,
    "",
    "## Production launch approvals",
    "",
    "| Status | Role | Owner | Approver | Due | Next action |",
    "|---|---|---|---|---|---|",
    ...launchApprovalRows,
    "",
    "## Production cutover blockers",
    "",
    "| Severity | Category | Name | Owner | Dependency | Status | Due | Resolution action |",
    "|---|---|---|---|---|---|---|---|",
    ...cutoverRows,
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
  PUBLIC_HEALTH_SITE_EVIDENCE_LINKS,
  applyPublicHealthSiteEvidenceBridge,
  buildPublicHealthCutoverEvidenceBoard,
  buildPublicHealthCutoverDrillBoard,
  buildPublicHealthCutoverReadiness,
  buildPublicHealthExchangeExceptionBoard,
  buildPublicHealthGoLiveObservationBoard,
  buildPublicHealthLaunchCommandBriefBoard,
  buildPublicHealthLaunchDutyBoard,
  buildPublicHealthLaunchIncidentBoard,
  buildPublicHealthLaunchGate,
  buildPublicHealthProductionHandoffBoard,
  buildPublicHealthReadinessReport,
  buildPublicHealthSiteEvidenceBridge,
  buildPublicHealthSiteEvidenceVerificationBoard,
  buildPublicHealthStandardImplementationBoard,
  buildPublicHealthSystem,
  parseArgs,
  renderMarkdown,
  seedPublicHealthCutoverBlockers,
  seedPublicHealthCutoverDrills,
  seedPublicHealthCutoverEvidencePackets,
  seedPublicHealthExchangeRuns,
  seedPublicHealthExchangeTasks,
  seedPublicHealthEvents,
  seedPublicHealthGoLiveObservations,
  seedPublicHealthInstitutionTasks,
  seedPublicHealthInstitutionScopes,
  seedPublicHealthLaunchCommandBriefs,
  seedPublicHealthSiteEvidenceVerificationTasks,
  seedPublicHealthLaunchDutyShifts,
  seedPublicHealthLaunchIncidents,
  seedPublicHealthLaunchApprovals,
  seedPublicHealthOnsiteAcceptances,
  seedPublicHealthProductionHandoffs,
  seedPublicHealthReadinessEvidence,
  seedPublicHealthStandardImplementationLedger,
  seedPublicHealthStandards,
  writeOutput
};
