const fallbackPlatformState = {
  authUsers: [],
  residents: [],
  diseases: [],
  followups: [],
  personalRecords: [],
  careOrders: [],
  registrationOrders: [],
  escortServiceOrders: [],
  internetNursingOrders: [],
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
  platformCapabilityReviews: [],
  platformProductionBlockerReviews: [],
  applicationCatalog: [],
  hospitalInteroperabilityFunctions: [],
  dataGovernanceAssets: [],
  standardDataDictionaries: [],
  dataLineageControls: [],
  platformDataBusChannels: [],
  phase2DataCatalogs: [],
  phase2ServiceCatalogs: [],
  phase2FieldLineage: [],
  phase2CatalogQualityRules: [],
  phase2PilotInstitutions: [],
  phase2JointTestLinks: [],
  phase2SamplePayloads: [],
  phase2GatewayTraces: [],
  phase2JointTestIssues: [],
  phase2DiseaseReportingRules: [],
  phase2DiseaseReportQueue: [],
  phase2DiseaseReportReceipts: [],
  phase2ClinicalAssistRules: [],
  phase2ClinicalAssistAlerts: [],
  phase2ClinicalAssistReceipts: [],
  phase2ClinicalAssistPluginContracts: [],
  phase2FamilyDoctorTemplates: [],
  phase2FamilyDoctorTeams: [],
  phase2FamilyDoctorServicePackages: [],
  phase2FamilyDoctorApplications: [],
  phase2FamilyDoctorContracts: [],
  phase2FamilyDoctorFulfillments: [],
  institutionCreditEvaluations: [],
  researchDatasets: [],
  diseaseRegistryModels: [],
  compliantDataExports: [],
  securityAcceptanceLedger: [],
  productionDeploymentPlan: [],
  productionDatabaseMigrationBatches: [],
  productionDatabaseCutoverRuns: [],
  citizenOperationContents: [],
  citizenAgreementVersions: [],
  citizenIdentityReviewCases: [],
  citizenServiceBlacklist: [],
  citizenHospitalServiceConfigs: [],
  commercialCryptoCapabilities: [],
  commercialCryptoProbeRuns: [],
  commercialCryptoEvidencePackets: [],
  platformChangeLogs: []
};

const PLATFORM_API_BASE = location.protocol === "file:" ? "" : "/api";
const PLATFORM_STORAGE_KEY = "chronic-care-platform-state";
let platformState = structuredClone(fallbackPlatformState);
let platformData = null;
let researchSandboxSummary = null;
let activeEditSnapshot = null;
let platformCapabilityMap = null;
let platformGoLiveSlices = null;
let platformStandardsLedgers = null;
let platformStandardsLedgerDetail = null;
let platformCapabilityOperationsCenter = {
  productionReady: false,
  summary: { capabilityDomains: 0, repositoryEvidenceReady: 0, reviewedPreproduction: 0, improvementRequired: 0, pendingReview: 0, evidenceRecorded: 0, productionReady: 0, mvpRequiredModules: 0, productionBlockers: 0, blockersOpen: 0, blockersInProgress: 0, blockerEvidenceSubmitted: 0, blockerEvidenceReviewed: 0, blockerEvidenceRecorded: 0 },
  capabilities: [],
  mvpRequiredModules: [],
  productionBlockers: [],
  boundary: ""
};
let postgresReconciliationCenter = {
  configured: false,
  productionPrimary: false,
  summary: { total: 0, open: 0, acknowledged: 0, resolved: 0, reopened: 0, unresolved: 0, clearedAwaitingResolution: 0 },
  cases: [],
  historySummary: { runs: 0, matched: 0, mismatched: 0, errors: 0 },
  runs: []
};
let postgresProductionAdapterCenter = {
  configured: false,
  adapterMode: "disabled",
  writeMode: "disabled",
  writeEnabled: false,
  evidenceReady: false,
  requirements: {},
  capabilities: {},
  productionPrimary: false,
  runtimeCutoverEnabled: false,
  primaryReadConfigured: false,
  primaryReadReport: null
};
let identityLifecycleCenter = {
  identity: {
    configured: false,
    refreshConfigured: false,
    revocationConfigured: false,
    directoryConfigured: false,
    productionHttps: true
  },
  sms: {
    configured: false,
    callbackConfigured: false,
    productionHttps: true
  },
  smsDelivery: {
    callbackConfigured: false,
    productionReady: false,
    summary: { receipts: 0, pending: 0, delivered: 0, failed: 0, callbackEvents: 0, ignoredEvents: 0 },
    receipts: [],
    boundary: ""
  },
  capabilities: {},
  blockers: [],
  plan: null,
  result: null,
  productionReady: false,
  boundary: ""
};
let financialGatewayOperationsCenter = {
  callbackReady: false,
  productionReady: false,
  summary: { dispatched: 0, pending: 0, succeeded: 0, exceptions: 0, callbackEvents: 0, ignoredEvents: 0, reconciliationRuns: 0, reconciliationDifferences: 0 },
  gateways: [],
  events: [],
  reconciliationRuns: [],
  boundary: ""
};

const defaultPlatformCapabilities = [
  {
    group: "城市级医疗健康大数据平台",
    source: "申报材料（五）项目建设目标及内容、七（二）本期建设方案",
    target: "统一平台底座、区域医疗健康大数据中心、全域互联互通、数据资产管理、信创及国产密码改造",
    existing: ["residents", "personalRecords", "healthStatistics", "dataAccessLogs", "securityEvents", "productionDeploymentPlan", "platformEvidence"],
    status: "演示底座闭环",
    next: "现场继续补充共享文档、数据资产目录、真实运行监控和生产环境验收材料。"
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
    source: "健康区域互联网应用统一入口、互联网+药事服务、居民健康画像",
    target: "居民统一入口、诊后用药、用药提醒、个性化健康标签、授权共享",
    existing: ["accounts", "residents", "personalRecords", "medicationPickups", "digitalCredentials"],
    status: "已衔接",
    next: "把居民端、移动预览、固定取药和授权共享归入健康区域统一入口。"
  },
  {
    group: "辅政应用",
    source: "数智健康大脑、卫生统计质控共享、医疗机构信用评价",
    target: "综合监管专题、统计直报质控、数据可视化、信用评价、公示",
    existing: ["healthStatistics", "healthStatisticsIngestion", "platformAudit", "platformProcessAudit", "institutionCreditEvaluations", "creditEvaluationRules"],
    status: "已闭环",
    next: "按现场月报和信用公示口径配置生产模板。"
  },
  {
    group: "医疗科研创新平台",
    source: "专病库、多模态医疗数据集、科研研究落地验证",
    target: "结构化、标准化、高质量、可计算数据集，支撑专病库和科研协作",
    existing: ["diseases", "chronicScreeningTasks", "chronicManagementPlans", "personalRecords", "researchDatasets", "diseaseRegistryModels"],
    status: "已闭环",
    next: "按真实伦理审批和科研项目协议接入现场授权流程。"
  },
  {
    group: "区级机构对接及应用实施",
    source: "示范一区、示范二区、示范三区及高新区医疗机构数据采集和应用下沉",
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
    status: "测评证据已建档",
    next: "现场继续补充第三方测评截图、真实交易样例和整改复测记录。"
  },
  {
    group: "安全可靠和密码应用",
    source: "等保三级、密码应用安全性评估、信创适配",
    target: "统一认证、国密传输、数据库关键信息加密、日志审计、国产软硬件适配",
    existing: ["authUsers", "authOrganizations", "securityEvents", "dataAccessLogs", "securityAcceptanceLedger"],
    status: "安全证据已建档",
    next: "现场继续补充国密设备、生产密钥、数据库加密、等保和密评报告。"
  }
];

const defaultIntegrationRegistry = [
  { name: "全民健康信息平台一、二期", approach: "原生升级", keep: "主索引、注册服务、四大数据库、业务协同、监管和便民能力", target: "市级平台底座" },
  { name: "医疗机构药事管理平台", approach: "接口接入+场景合并", keep: "药事管理数据、药事服务流程", target: "互联网+药事服务、固定取药、医保审核", status: "演示对接完成" },
  { name: "保健管理系统", approach: "数据回流+门户集成", keep: "医疗管理、健康管理、综合管理、统计分析", target: "居民健康画像、行业治理专题", status: "纳管方案已建档" },
  { name: "疫情防控应急指挥视频通讯平台", approach: "能力复用", keep: "视频会议、应急指挥调度、可视化政务管理", target: "公共卫生应急、远程会诊、远程教育", status: "能力复用已建档" },
  { name: "慢病管理平台", approach: "模块纳管", keep: "筛查、建档、风险分级、随访、宣教、固定取药", target: "医疗科研专病库、医防协同和居民画像" },
  { name: "医共体信息平台", approach: "能力复用+边界清晰", keep: "县乡村一体化、医技共享、基层AI辅助、协同工单", target: "区级应用下沉、分级诊疗和区域诊断中心" }
];

const defaultInterfacePlan = [
  { domain: "统一认证", existing: "现有登录、角色、签名会话、接口权限和审计", next: "政务统一认证、CA、短信、人脸核验作为现场身份源配置", priority: "P0", owner: "市级平台", status: "演示对接完成" },
  { domain: "居民主索引", existing: "personIndex、居民档案、家庭成员、主索引质量报告", next: "人口库、电子健康码、标准健康档案主索引作为现场数据源配置", priority: "P0", owner: "市级平台", status: "演示对接完成" },
  { domain: "医疗机构业务系统", existing: "个人健康信息库、机构端协同、HIS/EMR/LIS/PACS 契约和网关模拟接入", next: "真实 HIS、EMR、LIS、PACS、心电、体检系统联调", priority: "P0", owner: "医疗机构", status: "演示对接完成" },
  { domain: "分级诊疗", existing: "转诊规则、协同工单、预留资源、接诊回写和居民宣教", next: "远程会诊、真实号源床位、远程影像、心电、检验和教育系统联调", priority: "P0", owner: "医政医管", status: "演示对接完成" },
  { domain: "医保结算监管", existing: "医保审核、凭证核验、固定取药审核", next: "医保核心结算、门慢门特、异地转诊规则", priority: "P1", owner: "医保局/医保中心/区市县医保局", status: "演示对接完成" },
  { domain: "卫生统计", existing: "统计导入任务、资源直报对账、质控看板", next: "辽宁省卫统直报、国家统计直报系统", priority: "P1", owner: "规划信息", status: "演示对接完成" },
  { domain: "电子证照", existing: "出生/死亡医学证明模型和统计", next: "电子证照平台、公安户籍、民政殡葬、疾控死因监测", priority: "P1", owner: "医政/妇幼", status: "已建模" },
  { domain: "互联互通测评", existing: "接口需求清单、流程审计、标准映射、交易样例和测评证据库", next: "现场截图、第三方测评结论和整改复测记录", priority: "P1", owner: "项目办", status: "已建档" },
  { domain: "安全信创", existing: "角色权限、安全事件、访问日志、审计哈希链、安全合规证据和发布门禁", next: "国密传输、数据库加密、日志保全、密评和等保证据现场归档", priority: "P0", owner: "安全管理", status: "演示闭环完成" }
];

const defaultDeliveryRoadmap = [
  { phase: "第一批：平台底座和存量纳管", owner: "市级平台", items: ["统一应用目录", "统一身份认证", "数据资源目录", "存量模块登记", "运行监控"], status: "演示底座闭环" },
  { phase: "第二批：助医和分级诊疗闭环", owner: "医政医管/医疗机构", items: ["双向转诊", "远程会诊", "区域影像", "区域心电", "委托检验", "远程教育"], status: "衔接现有机构端和医共体模块" },
  { phase: "第三批：惠民统一入口", owner: "基层卫生/居民端", items: ["健康区域统一入口", "互联网+药事服务", "居民健康画像", "授权共享", "固定取药提醒"], status: "衔接居民端和慢病模块" },
  { phase: "第四批：辅政和科研", owner: "规划信息/科研管理", items: ["数智健康大脑", "统计质控共享", "信用评价", "专病库", "科研数据集"], status: "补齐治理和科研能力" },
  { phase: "第五批：测评、安全和验收", owner: "项目办/安全管理", items: ["互联互通五乙材料", "等保三级", "密评", "信创适配", "接口验收"], status: "贯穿全周期沉淀证据" }
];

const defaultPlatformEvidence = [
  { id: "ev-application", category: "申报材料", name: "提级论证申报材料闭环", owner: "项目办", source: "项目申报材料、建设方案、预算和论证意见", artifacts: ["建设范围矩阵", "存量模块合并清单", "开发批次计划", "周报素材"], status: "已建档", next: "持续补充需求变更、会议纪要和专家论证反馈。", records: [] },
  { id: "ev-interoperability", category: "互联互通测评", name: "四甲/五乙测评证据包", owner: "项目办/标准管理", source: "共享文档、术语字典、主索引、交易服务、测评文审材料", artifacts: ["接口清单", "标准映射", "交易样例", "整改记录"], status: "已建档", next: "持续补充现场截图、第三方测评结论和整改复测记录。", records: [
    { id: "evr-interoperability-contracts", owner: "项目办/标准管理", testRecord: "接口契约、主索引、交易样例和测评整改清单已完成演示归档", at: "2026-06-22 07:20:00", link: "/api/system/readiness", fileName: "interoperability-contracts-readiness-2026-06-22.md", status: "演示证据已归档" },
    { id: "evr-interoperability-gateway", owner: "平台技术组/接口联调", testRecord: "HMAC 签名、幂等键、死信重试和回调事件通过 API 自动化测试", at: "2026-06-22 07:25:00", link: "test/api.test.js", fileName: "integration-gateway-api-regression.md", status: "自动化测试通过" }
  ] },
  { id: "ev-security", category: "安全合规", name: "等保、密评和信创适配证据", owner: "安全管理岗", source: "统一认证、访问审计、安全事件、数据访问日志、信创适配清单", artifacts: ["权限矩阵", "审计日志", "安全事件", "密评整改项"], status: "已建档", next: "继续补充国密传输、数据库加密、第三方密评和等保测评现场材料。", records: [
    { id: "evr-audit-retention", owner: "安全管理岗", testRecord: "审计哈希链、导出摘要、安全验收台账和保全目标已纳入发布报告", at: "2026-06-22 07:30:00", link: "release/audit-retention-report.md", fileName: "audit-retention-report.md", status: "自动化证据已归档" },
    { id: "evr-identity-contract", owner: "统一认证组", testRecord: "政务身份 claims、角色门户映射和机构覆盖度已形成身份契约", at: "2026-06-22 07:32:00", link: "release/identity-contract.md", fileName: "identity-contract.md", status: "自动化证据已归档" },
    { id: "evr-security-regression", owner: "安全测试组", testRecord: "拒绝访问、字段脱敏、会话篡改拒绝和审计哈希链已通过回归测试", at: "2026-06-22 07:34:00", link: "test/security.test.js", fileName: "security-regression.md", status: "自动化测试通过" }
  ] },
  { id: "ev-interface", category: "接口联调", name: "外部系统接口联调验收", owner: "市级平台/医疗机构", source: "HIS、EMR、LIS、PACS、医保、电子证照、卫生统计等对接计划", artifacts: ["联调计划", "字段映射", "异常清单", "回归测试"], status: "演示对接完成", next: "真实院内系统、医保核心和电子证照联调仍按现场窗口推进。", records: [
    { id: "evr-integration-readiness", owner: "平台技术组/接口联调", testRecord: "HIS/EMR/LIS/PACS/医保/证照/统计接口契约、签名、幂等和重试策略已完成演示门禁", at: "2026-06-22 07:35:00", link: "release/integration-readiness-report.md", fileName: "integration-readiness-report.md", status: "自动化证据已归档" }
  ] },
  { id: "ev-launch", category: "上线验收", name: "区级实施和应用上线材料", owner: "实施组", source: "示范一区、示范二区、示范三区及高新区实施批次和应用培训记录", artifacts: ["上线确认", "培训签到", "试运行问题", "用户反馈"], status: "演示验收建档", next: "按真实区县、机构、应用和批次补充上线签字、培训签到、试运行问题和用户反馈。", records: [
    { id: "evr-operations-readiness", owner: "实施组/运维组", testRecord: "健康检查、运行指标、外部依赖和生产运维脚本已形成运维就绪证据", at: "2026-06-22 07:40:00", link: "release/operations-readiness-report.md", fileName: "operations-readiness-report.md", status: "自动化证据已归档" },
    { id: "evr-release-readiness", owner: "项目办/发布经理", testRecord: "发布门禁、生产切换清单、存储模型和测评证据已纳入 release report", at: "2026-06-22 07:42:00", link: "release/release-report.md", fileName: "release-report.md", status: "自动化证据已归档" },
    { id: "evr-mobile-pwa", owner: "居民端实施组", testRecord: "居民端 manifest、service worker、弱网回退和移动入口已通过静态测试", at: "2026-06-22 07:44:00", link: "citizen.html", fileName: "citizen-pwa-static-check.md", status: "居民端 PWA 壳已验证" }
  ] }
];

const defaultApplicationCatalog = [
  { id: "app-health-platform", name: "全民健康信息平台一、二期", sourceSystem: "市级存量平台", interfaceMode: "原生升级", owner: "规划信息处", reuseMode: "底座复用", batch: "第一批", evidence: "平台现状清单/架构图", status: "已纳管", next: "补齐运行监控和数据资源目录关联。" },
  { id: "app-chronic", name: "慢病医防融合管理", sourceSystem: "慢病管理平台", interfaceMode: "模块纳管", owner: "基层卫生处/疾控", reuseMode: "业务与数据复用", batch: "第一批", evidence: "筛查随访闭环/接口清单", status: "已纳管", next: "挂接专病库版本和科研数据集目录。" },
  { id: "app-county", name: "县域医共体协同", sourceSystem: "医共体信息平台", interfaceMode: "API/能力复用", owner: "医政医管处", reuseMode: "协同中心复用", batch: "第二批", evidence: "16255 功能清单/工单样例", status: "已纳管", next: "补齐区级实施批次和培训证据。" },
  { id: "app-institution", name: "医疗机构业务协同", sourceSystem: "HIS/EMR/LIS/PACS", interfaceMode: "标准接口", owner: "医疗机构", reuseMode: "门户集成+数据回流", batch: "第二批", evidence: "字段映射/联调记录", status: "演示对接完成", next: "现场按机构登记真实接口环境、版本和联调责任人。" },
  { id: "app-physical-exam", name: "区域体检系统", sourceSystem: "体检中心/HIS/EMR", interfaceMode: "标准接口+报告回流", owner: "医疗机构/体检中心", reuseMode: "居民主索引+健康档案复用", batch: "第二批", evidence: "physical-examination.html / /api/physical-exams", status: "演示对接完成", next: "按试点机构确认体检项目字典、报告签章和原报告存储地址。" },
  { id: "app-citizen", name: "健康区域居民服务", sourceSystem: "居民端/健康码", interfaceMode: "统一入口", owner: "基层卫生处", reuseMode: "入口整合", batch: "第三批", evidence: "居民旅程/授权记录", status: "已纳管", next: "接入政务身份源和正式消息服务。" },
  { id: "app-insurance", name: "医保结算监管协同", sourceSystem: "医保核心平台", interfaceMode: "接口接入", owner: "医保局/医保中心", reuseMode: "业务协同", batch: "第三批", evidence: "结算审核/凭证核验样例", status: "演示对接完成", next: "确认生产接口规范和联调窗口。" }
];

const defaultHospitalInteroperabilityFunctions = [
  { id: "mgmt-medical-quality", functionName: "医疗质量与安全监管", owner: "医政医管处/质控中心", sourceSystems: ["EMR", "LIS", "PACS", "HIS"], platformCollections: ["personalRecords", "diagnosticReports", "countyMutualRecognitionRecords", "dataQualityIssues"], managementActions: ["临床路径监管", "危急值闭环", "检查检验互认质控", "病历质检抽查"], evidence: ["emr-summary-v1", "lis-report-v1", "pacs-report-v1"], status: "demo-ready", nextAction: "接入真实质控规则和危急值确认记录。" },
  { id: "mgmt-referral-coordination", functionName: "分级诊疗与医联体协同", owner: "医政医管处/医共体办公室", sourceSystems: ["HIS", "EMR", "PACS", "LIS"], platformCollections: ["referralSystem", "careOrders", "countyCollaborationOrders", "diagnosticReports"], managementActions: ["双向转诊", "远程会诊", "资源预约", "报告回传"], evidence: ["his-patient-v1", "emr-summary-v1", "workflow-actions"], status: "demo-ready", nextAction: "补齐试点医院签字确认和接诊回执。" },
  { id: "mgmt-resource-operations", functionName: "资源运行与运营监管", owner: "规划信息处/运行监测组", sourceSystems: ["HIS", "住院管理", "人力资源", "设备物联"], platformCollections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit"], managementActions: ["床位监测", "门急诊与住院运行", "设备利用", "统计直报对账"], evidence: ["statistics-report-v1", "operations-readiness-report.md"], status: "demo-ready", nextAction: "接入机构日/月报并设置差异复核阈值。" },
  { id: "mgmt-drug-insurance", functionName: "药品耗材与医保协同监管", owner: "药政处/医保局/医保中心", sourceSystems: ["HIS", "药品耗材", "医保核心"], platformCollections: ["medicationPickups", "insuranceClaims", "institutionSupervisions", "securityEvents"], managementActions: ["合理用药", "固定取药审核", "医保结算监管", "高值耗材线索留痕"], evidence: ["insurance-settlement-v1", "medicationPickups"], status: "demo-ready", nextAction: "确认医保结算字段和药耗目录版本。" },
  { id: "mgmt-public-health", functionName: "公共卫生与慢病管理", owner: "基层卫生处/疾控中心", sourceSystems: ["EMR", "LIS", "公卫系统", "慢病平台"], platformCollections: ["chronicScreeningTasks", "chronicManagementPlans", "followups", "personalRecords"], managementActions: ["慢病筛查", "分级随访", "院后管理", "重点人群闭环"], evidence: ["chronicAcceptanceLedger", "personal-records-api"], status: "demo-ready", nextAction: "接入公卫专病登记和正式随访消息服务。" },
  { id: "mgmt-research-data", functionName: "科研数据资产与合规共享", owner: "科研管理/数据资产管理", sourceSystems: ["EMR", "LIS", "PACS", "专病库"], platformCollections: ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger"], managementActions: ["数据集治理", "伦理审批", "脱敏发布", "使用审计"], evidence: ["researchDatasets", "diseaseRegistryModels"], status: "demo-ready", nextAction: "归档伦理批件、数据使用协议和沙箱访问记录。" }
];

const defaultDataGovernanceAssets = [
  { id: "asset-his", sourceSystem: "HIS", domain: "patient-visit", owner: "institution-integration", status: "demo-contract-ready", updateFrequency: "near-real-time", platformCollections: ["personalRecords", "careOrders"], qualityScore: 92, risk: "onsite blocked: live HIS endpoint and signed sample messages are still required" },
  { id: "asset-emr", sourceSystem: "EMR", domain: "clinical-summary", owner: "institution-integration", status: "demo-contract-ready", updateFrequency: "near-real-time", platformCollections: ["personalRecords", "diagnosticReports"], qualityScore: 91, risk: "onsite blocked: live EMR document templates and doctor signature policy are pending" },
  { id: "asset-lis", sourceSystem: "LIS", domain: "lab-report", owner: "medical-resource-center", status: "demo-contract-ready", updateFrequency: "hourly", platformCollections: ["diagnosticReports", "countyMutualRecognitionRecords"], qualityScore: 90, risk: "onsite blocked: lab item dictionary and abnormal-value confirmation need hospital signoff" },
  { id: "asset-pacs", sourceSystem: "PACS", domain: "image-report", owner: "medical-resource-center", status: "demo-contract-ready", updateFrequency: "hourly", platformCollections: ["diagnosticReports", "imageCloudStudies", "personalRecords"], qualityScore: 89, risk: "onsite blocked: image index, report callback, and storage authorization remain external" },
  { id: "asset-insurance", sourceSystem: "Insurance core", domain: "settlement-and-benefit", owner: "cross-agency-integration", status: "demo-contract-ready", updateFrequency: "daily-or-event", platformCollections: ["insuranceClaims", "medicationPickups", "institutionSupervisions"], qualityScore: 88, risk: "external blocked: production settlement fields require insurance agency joint testing" },
  { id: "asset-public-health", sourceSystem: "Public health/statistics", domain: "statistics-and-public-health", owner: "commission-statistics", status: "demo-ingestion-ready", updateFrequency: "daily/monthly", platformCollections: ["healthStatistics", "healthStatisticsIngestion", "chronicScreeningTasks"], qualityScore: 90, risk: "onsite blocked: national direct-report interface and reconciliation threshold need configuration" },
  { id: "asset-followup-nursing", sourceSystem: "Follow-up / internet nursing", domain: "continuity-care", owner: "primary-care-and-nursing", status: "demo-closed-loop-ready", updateFrequency: "event", platformCollections: ["followups", "chronicManagementPlans", "internetNursingOrders", "personalRecords"], qualityScore: 87, risk: "onsite blocked: mobile service records, nurse qualification source, and payment callback are pending" }
];

const defaultStandardDataDictionaries = [
  { id: "dict-person-index", name: "Resident master index", domain: "master-data", standardItems: ["personIndex", "residentId", "idCard", "phone", "accountId"], owner: "resident-master-index", platformCollections: ["residents", "accounts", "personalRecords"], status: "implemented-demo", blocker: "production population registry and electronic health code source are pending" },
  { id: "dict-org-staff", name: "Organization, department and staff", domain: "master-data", standardItems: ["orgCode", "institutionId", "doctorId", "nurseId", "orgType"], owner: "platform-identity", platformCollections: ["authOrganizations", "authUsers", "medicalResources", "doctorProfiles", "internetNursingNurses"], status: "implemented-demo", blocker: "live unified social credit code, department code and staff registry need onsite mapping" },
  { id: "dict-disease-surgery", name: "Disease and procedure dictionary", domain: "clinical-standard", standardItems: ["diseaseType", "diagnosis", "icdCode", "procedureCode"], owner: "medical-quality", platformCollections: ["diseases", "chronicManagementPlans", "diagnosticReports", "diseaseRegistryModels"], status: "structured-summary", blocker: "formal ICD/procedure version and mapping signoff are pending" },
  { id: "dict-drug-consumable", name: "Drug and consumable dictionary", domain: "pharmacy-insurance", standardItems: ["drugCode", "consumableCode", "medication", "catalogVersion"], owner: "pharmacy-insurance", platformCollections: ["medicationPickups", "drugConsumableSupervisions", "insuranceClaims"], status: "structured-summary", blocker: "production drug/consumable catalog and insurance catalog version are pending" },
  { id: "dict-lab-imaging", name: "Lab, examination and imaging dictionary", domain: "diagnostic-standard", standardItems: ["item", "modality", "result", "reportedAt", "recognitionRecordId"], owner: "medical-resource-center", platformCollections: ["diagnosticReports", "countyMutualRecognitionRecords", "imageCloudStudies"], status: "structured-summary", blocker: "LIS/PACS item code dictionary and mutual-recognition catalog need site confirmation" },
  { id: "dict-indicator", name: "Statistics and operation indicators", domain: "indicator-standard", standardItems: ["period", "institution", "metrics", "varianceRate", "qualityScore"], owner: "commission-statistics", platformCollections: ["healthStatistics", "healthStatisticsIngestion", "hospitalOperationSnapshots", "dataQualityIssues"], status: "implemented-demo", blocker: "official direct-report indicator version and monthly reconciliation rules are pending" }
];

const defaultDataLineageControls = [
  { id: "lineage-his-patient", sourceSystem: "HIS", targetCollection: "personalRecords", requiredControls: ["externalId", "residentId", "institution", "visitedAt", "HMAC-SHA256", "idempotency"], status: "demo-ready" },
  { id: "lineage-emr-summary", sourceSystem: "EMR", targetCollection: "personalRecords", requiredControls: ["externalId", "residentId", "diagnosis", "recordDate", "HMAC-SHA256", "idempotency"], status: "demo-ready" },
  { id: "lineage-lis-report", sourceSystem: "LIS", targetCollection: "diagnosticReports", requiredControls: ["externalId", "residentId", "item", "result", "reportedAt", "HMAC-SHA256"], status: "demo-ready" },
  { id: "lineage-pacs-report", sourceSystem: "PACS", targetCollection: "diagnosticReports", requiredControls: ["externalId", "residentId", "modality", "conclusion", "reportedAt", "HMAC-SHA256"], status: "demo-ready" },
  { id: "lineage-insurance", sourceSystem: "Insurance core", targetCollection: "insuranceClaims", requiredControls: ["externalId", "residentId", "claimStatus", "amount", "idempotency"], status: "external-blocked" },
  { id: "lineage-statistics", sourceSystem: "Public health/statistics", targetCollection: "healthStatisticsIngestion", requiredControls: ["externalId", "period", "institution", "metrics", "manual-review"], status: "demo-ready" },
  { id: "lineage-followup-nursing", sourceSystem: "Follow-up / internet nursing", targetCollection: "personalRecords", requiredControls: ["residentId", "serviceRecord", "nurseQualification", "auditTrail"], status: "onsite-blocked" }
];

const defaultPlatformDataBusChannels = [
  { id: "bus-master-data-directory", name: "Master data directory bus", domain: "master-data", owner: "resident-master-index", producerCollections: ["residents", "authOrganizations", "authUsers", "medicalResources"], consumerModules: ["platform", "health-dashboard", "citizen", "institution", "county"], evidence: ["dict-person-index", "dict-org-staff"], blockerSource: "production population registry and staff registry onsite mapping", status: "implemented-demo" },
  { id: "bus-standard-dictionary", name: "Standard dictionary bus", domain: "standard-dictionary", owner: "medical-quality", producerCollections: ["diseases", "diagnosticReports", "medicationPickups", "drugConsumableSupervisions"], consumerModules: ["quality-safety", "drug-consumable", "referral", "internet-nursing"], evidence: ["dict-disease-surgery", "dict-drug-consumable", "dict-lab-imaging"], blockerSource: "formal ICD, procedure, drug, consumable, LIS and PACS dictionary signoff", status: "structured-summary" },
  { id: "bus-lineage-evidence", name: "Lineage evidence bus", domain: "lineage-quality", owner: "institution-integration", producerCollections: ["integrationContracts", "personalRecords", "diagnosticReports", "healthStatisticsIngestion"], consumerModules: ["release-report", "deploy-check", "interface-mapping", "data-quality"], evidence: ["lineage-his-patient", "lineage-emr-summary", "lineage-lis-report", "lineage-pacs-report", "lineage-statistics"], blockerSource: "live HIS/EMR/LIS/PACS endpoint, signature sample and callback joint testing", status: "demo-ready" },
  { id: "bus-interface-blockers", name: "Interface blocker bus", domain: "external-blocker", owner: "cross-agency-integration", producerCollections: ["platformInterfaces", "productionDeploymentPlan", "siteLaunchEvidence", "securityAcceptanceLedger"], consumerModules: ["site-readiness", "onsite-launch", "operations", "release-manifest"], evidence: ["insurance-settlement-v1", "lineage-insurance", "lineage-followup-nursing"], blockerSource: "insurance agency settlement joint testing, image authorization, nurse qualification and payment callback", status: "external-blocked" }
];

const defaultInstitutionCreditEvaluations = [
  { id: "credit-central", name: "区域中心医院", institutionType: "三级医院", period: "2026上半年", score: 92, grade: "A", indicators: "依法执业98/质量安全90/数据报送88/服务信用92", owner: "医政医管处", status: "已评价", next: "保持月度数据质量复核并公示优秀项。" },
  { id: "credit-ganjingzi", name: "示范区人民医院", institutionType: "二级医院", period: "2026上半年", score: 84, grade: "B", indicators: "依法执业92/质量安全86/数据报送76/服务信用82", owner: "属地卫生健康行政部门", status: "整改中", next: "30日内完成统计迟报和接口数据缺项整改。" },
  { id: "credit-community", name: "示范社区卫生服务中心", institutionType: "基层机构", period: "2026上半年", score: 88, grade: "B+", indicators: "依法执业95/质量安全87/数据报送85/服务信用86", owner: "示范区卫生健康行政部门", status: "已评价", next: "补齐家庭医生签约数据质控证据。" }
];

const defaultSecurityAcceptanceLedger = [
  { id: "security-level3", name: "网络安全等级保护三级", category: "等保", control: "定级备案、差距测评、安全整改、复测", evidence: "audit-retention-report.md / security.test.js / securityAcceptanceLedger", owner: "安全管理岗", status: "演示证据已建档", next: "生产环境继续补定级备案、测评机构进场计划和正式测评报告。" },
  { id: "security-crypto", name: "密码应用安全性评估", category: "密评", control: "国密传输、身份鉴别、存储加密、密钥管理", evidence: "env:check:production / identity-contract.md / production cutover checklist", owner: "密码应用责任人", status: "测评边界已建档", next: "现场确定密码设备、电子签名边界、国密证书链和第三方密评计划。" },
  { id: "security-gm", name: "国产密码改造", category: "国密改造", control: "SM2/SM3/SM4、国密SSL、关键字段加密", evidence: "productionDeploymentPlan / audit-retention-report.md / release-report.md", owner: "平台技术组", status: "改造路径已建档", next: "现场补接口、数据库、证书链的国密改造排期和兼容性记录。" },
  { id: "security-domestic", name: "信创适配", category: "信创适配", control: "国产CPU、操作系统、数据库、中间件和浏览器", evidence: "production-db-readiness-report.md / operations-readiness-report.md", owner: "基础设施组", status: "适配路径已建档", next: "现场建立软硬件版本矩阵并执行功能、性能和容灾测试。" }
];

const defaultProductionDeploymentPlan = [
  {
    id: "prod-env-gate",
    name: "Release readiness gate",
    track: "release-governance",
    status: "ready",
    owner: "platform lead",
    nextAction: "Run env:check, release:report:full, deploy:check, coverage, e2e, and audit before every production tag.",
    requiredConfig: ["NODE_ENV", "SESSION_SECRETS", "INTEGRATION_GATEWAY_SECRET"],
    evidence: ["scripts/release-report.js", "scripts/deploy-check.js", "release-report"]
  },
  {
    id: "prod-storage-adapter",
    name: "Production database adapter",
    track: "database",
    status: "rehearsal-center-ready-onsite-blocked",
    owner: "data platform",
    nextAction: "Bind the cutover center to the selected database driver, run masked full-volume migration and rollback, then freeze a signed migration window.",
    requiredConfig: ["STORAGE_ENGINE=postgres", "DATABASE_URL", "BACKUP_RETENTION_DAYS"],
    evidence: ["four-domain sample validation", "rollback checkpoint", "migration checklist"]
  },
  {
    id: "prod-identity-adapter",
    name: "Government identity adapter",
    track: "identity",
    status: "planned",
    owner: "identity integration",
    nextAction: "Connect OIDC/SAML, CA, SMS, and citizen verification sources through a staged adapter.",
    requiredConfig: ["OIDC_ISSUER_URL", "OIDC_CLIENT_ID", "OIDC_CLIENT_SECRET"],
    evidence: ["role mapping", "login audit", "fallback login plan"]
  },
  {
    id: "prod-audit-retention",
    name: "Audit retention and evidence preservation",
    track: "security",
    status: "planned",
    owner: "security operations",
    nextAction: "Route audit logs to SIEM/WORM storage and define retention, export, and incident review procedures.",
    requiredConfig: ["AUDIT_EXPORT_PATH", "SIEM_ENDPOINT", "RETENTION_POLICY"],
    evidence: ["security ledger", "data access logs", "retention policy"]
  }
];

const defaultProductionDatabaseMigrationBatches = [
  { id: "pdbm-resident-master", sequence: 1, domain: "resident-master", name: "Resident master and identity index", sourceCollections: ["residents", "authUsers"], targetTables: ["resident_master", "identity_account"], owner: "resident-master-index", status: "rehearsal-ready", rollbackStrategy: "Restore the pre-cutover resident master checkpoint." },
  { id: "pdbm-clinical-encounter", sequence: 2, domain: "clinical-encounter", name: "Clinical encounter and health archive", sourceCollections: ["personalRecords", "careOrders"], targetTables: ["clinical_record", "care_order"], owner: "institution-integration", status: "rehearsal-ready", rollbackStrategy: "Revert the encounter batch and rebuild resident links." },
  { id: "pdbm-lab-report", sequence: 3, domain: "lab-report", name: "Laboratory and diagnostic report", sourceCollections: ["diagnosticReports", "imageCloudStudies"], targetTables: ["diagnostic_report", "report_evidence"], owner: "medical-resource-center", status: "rehearsal-ready", rollbackStrategy: "Remove migrated report rows and replay the source receipt." },
  { id: "pdbm-health-statistic", sequence: 4, domain: "health-statistic", name: "Health statistics and reconciliation evidence", sourceCollections: ["healthStatistics", "healthStatisticsIngestion"], targetTables: ["health_statistic", "statistic_ingestion"], owner: "commission-governance", status: "rehearsal-ready", rollbackStrategy: "Restore the signed period snapshot and rerun reconciliation." }
];

const defaultProductionDatabaseCutoverRuns = [
  { id: "pdbcr-baseline", runNo: "PDB-DRYRUN-BASELINE", mode: "dry-run", targetAdapter: "postgresql", status: "planned", reviewStatus: "pending", createdAt: "2026-07-10T00:00:00.000Z", sampleValidations: [], rollbackCheckpoint: { id: "pdbcp-baseline", status: "planned", evidence: "" }, productionReady: false, blockers: ["live PostgreSQL-compatible target connection and driver", "masked full-volume migration rehearsal", "capacity and failover test evidence", "database owner and release manager signoff"] }
];

const defaultCitizenOperationContents = [
  { id: "cop-content-banner-registration", type: "banner", title: "预约挂号试点服务", status: "published-demo", owner: "居民服务运营岗", channels: ["citizen-web", "app-shell"], productionReady: false },
  { id: "cop-content-family-doctor", type: "article", title: "家庭医生签约与履约说明", status: "published-demo", owner: "基层卫生处", channels: ["citizen-web"], productionReady: false },
  { id: "cop-content-refund-policy", type: "article", title: "预约退号与退费规则草案", status: "review-pending", owner: "财务与居民服务组", channels: ["citizen-web"], productionReady: false }
];

const defaultCitizenAgreementVersions = [
  { id: "cop-agreement-privacy-v2", name: "居民端隐私政策", version: "2.0-demo", status: "active-demo", acceptanceMode: "explicit-checkbox", legalReviewStatus: "onsite-pending", productionReady: false },
  { id: "cop-agreement-service-v1", name: "居民服务使用协议", version: "1.0-demo", status: "active-demo", acceptanceMode: "explicit-checkbox", legalReviewStatus: "onsite-pending", productionReady: false },
  { id: "cop-agreement-health-auth-v1", name: "健康数据调阅授权书", version: "1.0-demo", status: "active-demo", acceptanceMode: "signed-consent", legalReviewStatus: "onsite-pending", productionReady: false }
];

const defaultCitizenIdentityReviewCases = [
  { id: "cop-identity-r3", residentId: "r3", residentName: "演示居民 C", riskLevel: "medium", status: "pending-review", submittedEvidence: ["phone-token", "masked-id-card"], productionReady: false },
  { id: "cop-identity-r4", residentId: "r4", residentName: "演示居民 D", riskLevel: "high", status: "material-requested", submittedEvidence: ["phone-token", "guardian-statement"], productionReady: false },
  { id: "cop-identity-r1", residentId: "r1", residentName: "演示居民 A", riskLevel: "low", status: "approved-demo", submittedEvidence: ["phone-token", "master-index-match"], productionReady: false }
];

const defaultCitizenServiceBlacklist = [
  { id: "cop-block-provider-demo", subjectType: "provider", subjectName: "演示暂停服务商", reason: "演示资质到期，暂停居民端服务展示。", status: "active-demo", productionReady: false },
  { id: "cop-block-account-review", subjectType: "account", subjectName: "异常频次演示账号", reason: "短时间重复提交订单，等待人工复核。", status: "under-review", productionReady: false }
];

const defaultCitizenHospitalServiceConfigs = [
  { id: "cop-hospital-mr1", institutionCode: "MR1", institutionName: "区域中心医院", enabledServices: ["appointment", "report-query", "internet-nursing", "escort"], status: "active-demo", launchScope: "white-list-demo", productionReady: false },
  { id: "cop-hospital-mr3", institutionCode: "MR3", institutionName: "示范社区卫生服务中心", enabledServices: ["family-doctor", "chronic-followup", "internet-nursing"], status: "active-demo", launchScope: "white-list-demo", productionReady: false },
  { id: "cop-hospital-mr5", institutionCode: "MR5", institutionName: "示范区人民医院", enabledServices: ["appointment", "report-query"], status: "onsite-confirmation-pending", launchScope: "disabled", productionReady: false }
];

const defaultCommercialCryptoCapabilities = [
  { id: "cc-gm-tls", name: "国密 HTTPS 与传输保护", adapterKind: "gm-tls-gateway", requiredPrimitives: ["SM2", "SM3", "SM4"], status: "contract-ready", owner: "平台技术组/安全管理", evidenceRefs: ["securityAcceptanceLedger:security-crypto"], blockers: ["通过检测的国密 SSL 产品", "生产证书链"], onsiteVerification: "not-requested", productionReady: false },
  { id: "cc-signature-service", name: "电子签名与验签服务", adapterKind: "signing-server", requiredPrimitives: ["SM2", "SM3"], status: "contract-ready", owner: "安全管理/业务应用组", evidenceRefs: ["identity-contract.md"], blockers: ["签名验签服务器", "时间戳服务"], onsiteVerification: "not-requested", productionReady: false },
  { id: "cc-data-encryption", name: "重要数据与数据库加密", adapterKind: "kms-database-encryption", requiredPrimitives: ["SM4"], status: "contract-ready", owner: "数据管理/安全管理", evidenceRefs: ["production-database-cutover-center.md"], blockers: ["生产 KMS 或密码机", "密钥管理制度"], onsiteVerification: "not-requested", productionReady: false },
  { id: "cc-audit-integrity", name: "审计日志完整性保护", adapterKind: "sm3-timestamp-worm", requiredPrimitives: ["SM3"], status: "contract-ready", owner: "安全管理/运维中心", evidenceRefs: ["audit-retention-report.md"], blockers: ["可信时间戳", "不可改写归档"], onsiteVerification: "not-requested", productionReady: false },
  { id: "cc-ca-usbkey", name: "CA 身份认证与 USBKey", adapterKind: "ca-usbkey", requiredPrimitives: ["SM2", "SM3"], status: "contract-ready", owner: "统一认证组/安全管理", evidenceRefs: ["identity-source-mapping"], blockers: ["CA 信任协议", "USBKey 选型"], onsiteVerification: "not-requested", productionReady: false },
  { id: "cc-secure-browser", name: "安全浏览器与终端兼容", adapterKind: "secure-browser-bridge", requiredPrimitives: ["SM2", "SM3", "SM4"], status: "contract-ready", owner: "终端运维/安全管理", evidenceRefs: ["environment-matrix-report.md"], blockers: ["安全浏览器采购", "中间件兼容矩阵"], onsiteVerification: "not-requested", productionReady: false }
];

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackPlatformState);
  ensureEditablePlatformData(platformState);
  bindPlatformEditor();
  renderPlatform();
  refreshResearchSandboxSummary();

  await loadIdentityLifecycleCenter();
  renderIdentityLifecycleCenter();
  await Promise.all([
    loadPlatformCapabilityMap(),
    loadPlatformGoLiveSlices(),
    loadPlatformStandardsLedgers(),
    loadPlatformCapabilityOperationsCenter(),
    loadCommercialCryptoCenter(),
    loadPostgresReconciliationCenter(),
    loadPostgresProductionAdapterCenter(),
    loadFinancialGatewayOperationsCenter()
  ]);
  renderPlatform();
  refreshResearchSandboxSummary();
});

function renderPlatform() {
  platformData = platformModel(platformState);
  renderMetrics(platformState, platformData);
  renderPlatformCapabilityMap();
  renderPlatformGoLiveSlices();
  renderPlatformStandardsLedgers();
  renderCapabilities(platformState, platformData.capabilities);
  renderIntegrationRegistry(platformData.integrations);
  renderInterfacePlan(platformData.interfaces);
  renderDataFoundation(platformState);
  renderDataGovernanceFoundation(platformData);
  renderPhase2Catalog(platformData);
  renderPhase2JointTestPilot(platformData);
  renderPhase2DiseaseReporting(platformData);
  renderPhase2ClinicalAssist(platformData);
  renderPhase2FamilyDoctorContracts(platformData);
  renderRoadmap(platformData.deliveryBatches);
  renderHospitalManagementFunctions(platformData.hospitalManagementFunctions);
  renderApplicationCatalog(platformData.applicationCatalog);
  renderInstitutionCreditEvaluations(platformData.creditEvaluations);
  renderSecurityAcceptanceLedger(platformData.securityLedger);
  renderPlatformCapabilityOperationsCenter();
  renderProductionDeploymentPlan(platformData.productionDeploymentPlan);
  renderIdentityLifecycleCenter();
  renderFinancialGatewayOperationsCenter();
  renderProductionDatabaseCutoverCenter(platformData);
  renderCitizenOperationsCenter(platformData);
  renderCommercialCryptoCenter(platformData);
  renderResearchGovernance(platformData);
  renderMobileAccessibilityGovernance(platformData);
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
    evidence: Array.isArray(state.platformEvidence) && state.platformEvidence.length ? state.platformEvidence : defaultPlatformEvidence,
    applicationCatalog: Array.isArray(state.applicationCatalog) && state.applicationCatalog.length ? state.applicationCatalog : defaultApplicationCatalog,
    hospitalManagementFunctions: Array.isArray(state.hospitalInteroperabilityFunctions) && state.hospitalInteroperabilityFunctions.length ? state.hospitalInteroperabilityFunctions : defaultHospitalInteroperabilityFunctions,
    dataGovernanceAssets: Array.isArray(state.dataGovernanceAssets) && state.dataGovernanceAssets.length ? state.dataGovernanceAssets : defaultDataGovernanceAssets,
    standardDataDictionaries: Array.isArray(state.standardDataDictionaries) && state.standardDataDictionaries.length ? state.standardDataDictionaries : defaultStandardDataDictionaries,
    dataLineageControls: Array.isArray(state.dataLineageControls) && state.dataLineageControls.length ? state.dataLineageControls : defaultDataLineageControls,
    platformDataBusChannels: Array.isArray(state.platformDataBusChannels) && state.platformDataBusChannels.length ? state.platformDataBusChannels : defaultPlatformDataBusChannels,
    phase2DataCatalogs: Array.isArray(state.phase2DataCatalogs) ? state.phase2DataCatalogs : [],
    phase2ServiceCatalogs: Array.isArray(state.phase2ServiceCatalogs) ? state.phase2ServiceCatalogs : [],
    phase2FieldLineage: Array.isArray(state.phase2FieldLineage) ? state.phase2FieldLineage : [],
    phase2CatalogQualityRules: Array.isArray(state.phase2CatalogQualityRules) ? state.phase2CatalogQualityRules : [],
    phase2PilotInstitutions: Array.isArray(state.phase2PilotInstitutions) ? state.phase2PilotInstitutions : [],
    phase2JointTestLinks: Array.isArray(state.phase2JointTestLinks) ? state.phase2JointTestLinks : [],
    phase2SamplePayloads: Array.isArray(state.phase2SamplePayloads) ? state.phase2SamplePayloads : [],
    phase2GatewayTraces: Array.isArray(state.phase2GatewayTraces) ? state.phase2GatewayTraces : [],
    phase2JointTestIssues: Array.isArray(state.phase2JointTestIssues) ? state.phase2JointTestIssues : [],
    phase2DiseaseReportingRules: Array.isArray(state.phase2DiseaseReportingRules) ? state.phase2DiseaseReportingRules : [],
    phase2DiseaseReportQueue: Array.isArray(state.phase2DiseaseReportQueue) ? state.phase2DiseaseReportQueue : [],
    phase2DiseaseReportReceipts: Array.isArray(state.phase2DiseaseReportReceipts) ? state.phase2DiseaseReportReceipts : [],
    phase2ClinicalAssistRules: Array.isArray(state.phase2ClinicalAssistRules) ? state.phase2ClinicalAssistRules : [],
    phase2ClinicalAssistAlerts: Array.isArray(state.phase2ClinicalAssistAlerts) ? state.phase2ClinicalAssistAlerts : [],
    phase2ClinicalAssistReceipts: Array.isArray(state.phase2ClinicalAssistReceipts) ? state.phase2ClinicalAssistReceipts : [],
    phase2ClinicalAssistPluginContracts: Array.isArray(state.phase2ClinicalAssistPluginContracts) ? state.phase2ClinicalAssistPluginContracts : [],
    phase2FamilyDoctorTemplates: Array.isArray(state.phase2FamilyDoctorTemplates) ? state.phase2FamilyDoctorTemplates : [],
    phase2FamilyDoctorTeams: Array.isArray(state.phase2FamilyDoctorTeams) ? state.phase2FamilyDoctorTeams : [],
    phase2FamilyDoctorServicePackages: Array.isArray(state.phase2FamilyDoctorServicePackages) ? state.phase2FamilyDoctorServicePackages : [],
    phase2FamilyDoctorApplications: Array.isArray(state.phase2FamilyDoctorApplications) ? state.phase2FamilyDoctorApplications : [],
    phase2FamilyDoctorContracts: Array.isArray(state.phase2FamilyDoctorContracts) ? state.phase2FamilyDoctorContracts : [],
    phase2FamilyDoctorFulfillments: Array.isArray(state.phase2FamilyDoctorFulfillments) ? state.phase2FamilyDoctorFulfillments : [],
    creditEvaluations: Array.isArray(state.institutionCreditEvaluations) && state.institutionCreditEvaluations.length ? state.institutionCreditEvaluations : defaultInstitutionCreditEvaluations,
    securityLedger: Array.isArray(state.securityAcceptanceLedger) && state.securityAcceptanceLedger.length ? state.securityAcceptanceLedger : defaultSecurityAcceptanceLedger,
    productionDeploymentPlan: Array.isArray(state.productionDeploymentPlan) && state.productionDeploymentPlan.length ? state.productionDeploymentPlan : defaultProductionDeploymentPlan,
    productionDatabaseMigrationBatches: Array.isArray(state.productionDatabaseMigrationBatches) && state.productionDatabaseMigrationBatches.length ? state.productionDatabaseMigrationBatches : defaultProductionDatabaseMigrationBatches,
    productionDatabaseCutoverRuns: Array.isArray(state.productionDatabaseCutoverRuns) && state.productionDatabaseCutoverRuns.length ? state.productionDatabaseCutoverRuns : defaultProductionDatabaseCutoverRuns,
    citizenOperationContents: Array.isArray(state.citizenOperationContents) && state.citizenOperationContents.length ? state.citizenOperationContents : defaultCitizenOperationContents,
    citizenAgreementVersions: Array.isArray(state.citizenAgreementVersions) && state.citizenAgreementVersions.length ? state.citizenAgreementVersions : defaultCitizenAgreementVersions,
    citizenIdentityReviewCases: Array.isArray(state.citizenIdentityReviewCases) && state.citizenIdentityReviewCases.length ? state.citizenIdentityReviewCases : defaultCitizenIdentityReviewCases,
    citizenServiceBlacklist: Array.isArray(state.citizenServiceBlacklist) && state.citizenServiceBlacklist.length ? state.citizenServiceBlacklist : defaultCitizenServiceBlacklist,
    citizenHospitalServiceConfigs: Array.isArray(state.citizenHospitalServiceConfigs) && state.citizenHospitalServiceConfigs.length ? state.citizenHospitalServiceConfigs : defaultCitizenHospitalServiceConfigs,
    citizenOperationsOrders: buildCitizenOperationsOrderRows(state),
    commercialCryptoCapabilities: Array.isArray(state.commercialCryptoCapabilities) && state.commercialCryptoCapabilities.length ? state.commercialCryptoCapabilities : defaultCommercialCryptoCapabilities,
    commercialCryptoProbeRuns: Array.isArray(state.commercialCryptoProbeRuns) ? state.commercialCryptoProbeRuns : [],
    commercialCryptoEvidencePackets: Array.isArray(state.commercialCryptoEvidencePackets) ? state.commercialCryptoEvidencePackets : [],
    commercialCryptoRuntimeProbe: state.commercialCryptoRuntimeProbe && typeof state.commercialCryptoRuntimeProbe === "object" ? state.commercialCryptoRuntimeProbe : null,
    researchDatasets: Array.isArray(state.researchDatasets) ? state.researchDatasets : [],
    diseaseRegistryModels: Array.isArray(state.diseaseRegistryModels) ? state.diseaseRegistryModels : [],
    accessibilityChecklist: Array.isArray(state.accessibilityChecklist) ? state.accessibilityChecklist : [],
    mobileExperienceSettings: state.mobileExperienceSettings && typeof state.mobileExperienceSettings === "object" ? state.mobileExperienceSettings : {}
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
  state.platformEvidence = state.platformEvidence.map((item) => ({
    ...item,
    records: Array.isArray(item.records) ? item.records : []
  }));
  if (!Array.isArray(state.applicationCatalog) || !state.applicationCatalog.length) state.applicationCatalog = structuredClone(defaultApplicationCatalog);
  if (!Array.isArray(state.hospitalInteroperabilityFunctions) || !state.hospitalInteroperabilityFunctions.length) state.hospitalInteroperabilityFunctions = structuredClone(defaultHospitalInteroperabilityFunctions);
  if (!Array.isArray(state.institutionCreditEvaluations) || !state.institutionCreditEvaluations.length) state.institutionCreditEvaluations = structuredClone(defaultInstitutionCreditEvaluations);
  if (!Array.isArray(state.securityAcceptanceLedger) || !state.securityAcceptanceLedger.length) state.securityAcceptanceLedger = structuredClone(defaultSecurityAcceptanceLedger);
  if (!Array.isArray(state.productionDeploymentPlan) || !state.productionDeploymentPlan.length) state.productionDeploymentPlan = structuredClone(defaultProductionDeploymentPlan);
  if (!Array.isArray(state.commercialCryptoCapabilities) || !state.commercialCryptoCapabilities.length) state.commercialCryptoCapabilities = structuredClone(defaultCommercialCryptoCapabilities);
  if (!Array.isArray(state.commercialCryptoProbeRuns)) state.commercialCryptoProbeRuns = [];
  if (!Array.isArray(state.commercialCryptoEvidencePackets)) state.commercialCryptoEvidencePackets = [];
  if (!Array.isArray(state.researchDatasets)) state.researchDatasets = [];
  if (!Array.isArray(state.diseaseRegistryModels)) state.diseaseRegistryModels = [];
  if (!Array.isArray(state.accessibilityChecklist)) state.accessibilityChecklist = [];
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
    ["纳管应用", count(state.applicationCatalog), "来源、接口、责任、批次和验收证据统一登记"],
    ["管理职能", count(state.hospitalInteroperabilityFunctions), "医院系统数据支撑医政、质控、运营、公卫和科研管理"],
    ["信用评价", count(state.institutionCreditEvaluations), "机构评分、等级与整改闭环"],
    ["科研数据集", count(state.researchDatasets), "伦理、脱敏、授权和成果回流"],
    ["专病模型", count(state.diseaseRegistryModels), "版本、阈值和人工复核"],
    ["无障碍项", count(state.accessibilityChecklist), "移动适老化验收清单"],
    ["安全信创", count(state.securityAcceptanceLedger), "等保、密评、国密和信创分账验收"],
    ["生产轨道", count(state.productionDeploymentPlan), "发布门禁、正式数据库、政务身份和审计保全"],
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

function renderPlatformCapabilityMap() {
  const statusTarget = document.querySelector("#platform-capability-map-status");
  const metricsTarget = document.querySelector("#platform-capability-map-metrics");
  const risksTarget = document.querySelector("#platform-capability-map-risks");
  const domainsTarget = document.querySelector("#platform-capability-map-domains");
  if (!statusTarget || !metricsTarget || !domainsTarget) return;
  if (!platformCapabilityMap) {
    statusTarget.textContent = PLATFORM_API_BASE ? "等待功能总览 API" : "静态预览需连接动态后端";
    statusTarget.className = "badge warn";
    metricsTarget.innerHTML = `
      <article class="metric-card">
        <span>动态 API</span>
        <strong>/api/platform/capability-map</strong>
        <small>连接 Node 后端后汇总 release、scripts、readiness 和数据集合</small>
      </article>
    `;
    domainsTarget.innerHTML = `<article class="evidence-card"><h3>功能总览未加载</h3><p>静态预览不会伪造发布工件和 readiness 结果，请在动态服务下查看。</p></article>`;
    return;
  }
  const summary = platformCapabilityMap.summary || {};
  const riskRegister = platformCapabilityMap.riskRegister || {};
  statusTarget.textContent = platformCapabilityMap.ok ? "功能总览已生成" : "存在需关注证据";
  statusTarget.className = platformCapabilityMap.ok ? "badge success" : "badge warn";
  const metricRows = [
    ["发布工件", summary.releaseArtifacts || 0, `${summary.releaseEvidencePresent || 0} 个已有报告/文档证据`],
    ["脚本", summary.packageScripts || 0, `${summary.readinessScripts || 0} 个 readiness/report 脚本`],
    ["数据集合", summary.dataCollections || 0, `${summary.totalRecords || 0} 条快照记录`],
    ["能力域", summary.capabilityDomains || 0, `${summary.releaseAttention || 0} 个需关注工件`],
    ["生产脚本", summary.productionScripts || 0, "部署、数据库、审计、身份和上线检查"],
    ["测试脚本", summary.testScripts || 0, "聚焦测试和全量测试入口"]
  ];
  metricsTarget.innerHTML = metricRows.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${platformEscapeHtml(label)}</span>
      <strong>${platformEscapeHtml(value)}</strong>
      <small>${platformEscapeHtml(hint)}</small>
    </article>
  `).join("");
  if (risksTarget) {
    const riskItems = (riskRegister.items || []).slice(0, 8);
    risksTarget.innerHTML = riskItems.length ? riskItems.map((item) => `
      <article class="evidence-card" data-capability-map-risk="${platformEscapeHtml(item.id)}">
        <h3>${platformEscapeHtml(item.severity || "P2")} ${platformEscapeHtml(item.title || item.source || "Risk")}</h3>
        <p>${platformEscapeHtml(item.nextAction || "Awaiting evidence closure.")}</p>
        <small>${platformEscapeHtml(item.source || "source")} / ${platformEscapeHtml(item.owner || "unassigned")} / ${platformEscapeHtml(item.status || "open")}</small>
      </article>
    `).join("") : `<article class="evidence-card"><h3>No open risk register items</h3><p>Release artifacts and onsite blockers have no current attention rows.</p></article>`;
  }
  const domains = (platformCapabilityMap.domains || []).slice(0, 12);
  domainsTarget.innerHTML = domains.map((item) => `
    <article class="evidence-card" data-capability-map-domain="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.title)}</h3>
      <p>${platformEscapeHtml(item.artifacts)} 个发布工件 / ${platformEscapeHtml(item.evidencePresent)} 个证据文件 / ${platformEscapeHtml(item.scripts)} 个脚本</p>
      <small>数据集合 ${platformEscapeHtml(item.collections)} 个；关注项 ${platformEscapeHtml(item.attention || 0)} 个</small>
    </article>
  `).join("");
}

function renderPlatformGoLiveSlices() {
  const statusTarget = document.querySelector("#platform-go-live-slices-status");
  const metricsTarget = document.querySelector("#platform-go-live-slices-metrics");
  const blockersTarget = document.querySelector("#platform-go-live-blockers");
  const serviceTarget = document.querySelector("#platform-service-order-center");
  const masterTarget = document.querySelector("#platform-master-data-directory");
  if (!statusTarget || !metricsTarget || !blockersTarget || !serviceTarget || !masterTarget) return;
  if (!platformGoLiveSlices) {
    statusTarget.textContent = PLATFORM_API_BASE ? "等待上线切片 API" : "静态预览需连接动态后端";
    statusTarget.className = "badge warn";
    metricsTarget.innerHTML = `
      <article class="metric-card">
        <span>动态 API</span>
        <strong>/api/platform/go-live-slices</strong>
        <small>统一汇总阻塞项、服务订单和主数据目录。</small>
      </article>
    `;
    blockersTarget.innerHTML = `<article class="evidence-card"><h3>未加载阻塞台账</h3><p>启动 Node 后端后可查看。</p></article>`;
    serviceTarget.innerHTML = `<article class="evidence-card"><h3>未加载服务订单</h3><p>启动 Node 后端后可查看。</p></article>`;
    masterTarget.innerHTML = `<article class="evidence-card"><h3>未加载主数据目录</h3><p>启动 Node 后端后可查看。</p></article>`;
    return;
  }
  const summary = platformGoLiveSlices.summary || {};
  statusTarget.textContent = platformGoLiveSlices.ok ? "上线切片已汇总" : "上线切片存在阻塞";
  statusTarget.className = platformGoLiveSlices.ok ? "badge success" : "badge warn";
  const metricRows = [
    ["开放阻塞项", summary.openBlockers || 0, `${summary.p0Blockers || 0} 个 P0 仍需现场收口`],
    ["服务订单", summary.serviceOrders || 0, `${summary.serviceTypes || 0} 类服务统一纳管`],
    ["主数据域", summary.masterDataDomains || 0, `${summary.onsiteMasterDataGaps || 0} 个现场缺口显式保留`]
  ];
  metricsTarget.innerHTML = metricRows.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${platformEscapeHtml(label)}</span>
      <strong>${platformEscapeHtml(value)}</strong>
      <small>${platformEscapeHtml(hint)}</small>
    </article>
  `).join("");
  blockersTarget.innerHTML = (platformGoLiveSlices.blockerRegister?.blockers || []).slice(0, 6).map((item) => `
    <article class="evidence-card" data-go-live-blocker="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.severity || "P2")} ${platformEscapeHtml(item.title || item.source)}</h3>
      <p>${platformEscapeHtml(item.nextAction || "Awaiting action.")}</p>
      <small>${platformEscapeHtml(item.source)} / ${platformEscapeHtml(item.owner || "unassigned")} / ${platformEscapeHtml(item.status || "open")}</small>
    </article>
  `).join("");
  serviceTarget.innerHTML = (platformGoLiveSlices.serviceOrderCenter?.orders || []).slice(0, 6).map((item) => `
    <article class="evidence-card" data-service-order="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.serviceType)} / ${platformEscapeHtml(item.title)}</h3>
      <p>${platformEscapeHtml(item.providerName || item.ownerRole || "provider pending")}</p>
      <small>${platformEscapeHtml(item.residentId || "no resident")} / ${platformEscapeHtml(item.status || item.lifecycle)}</small>
    </article>
  `).join("");
  masterTarget.innerHTML = (platformGoLiveSlices.masterDataDirectory?.domains || []).slice(0, 8).map((item) => `
    <article class="evidence-card" data-master-data-domain="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.name || item.domain)}</h3>
      <p>${platformEscapeHtml((item.standardItems || []).slice(0, 4).join(" / "))}</p>
      <small>${platformEscapeHtml(item.owner || "unassigned")} / ${platformEscapeHtml(item.signoffStatus || "pending")} / ${item.onsiteBlocked ? "onsite blocked" : "ready"}</small>
    </article>
  `).join("");
}

function renderPlatformStandardsLedgers() {
  const statusTarget = document.querySelector("#platform-standards-ledgers-status");
  const metricsTarget = document.querySelector("#platform-standards-ledgers-metrics");
  const gridTarget = document.querySelector("#platform-standards-ledgers-grid");
  if (!statusTarget || !metricsTarget || !gridTarget) return;
  if (!platformStandardsLedgers) {
    statusTarget.textContent = PLATFORM_API_BASE ? "等待台账 API" : "静态预览需连接动态后端";
    statusTarget.className = "badge warn";
    metricsTarget.innerHTML = `<article class="metric-card"><span>动态 API</span><strong>/api/platform/standards-ledgers</strong><small>连接 Node 后端后汇总六类台账和验收边界。</small></article>`;
    gridTarget.innerHTML = `<article class="evidence-card"><h3>台账未加载</h3><p>静态预览不伪造标准符合性和现场签字状态。</p></article>`;
    return;
  }
  const summary = platformStandardsLedgers.summary || {};
  const functionStateLabels = { implemented: "功能已实现", partial: "部分实现" };
  const goLiveStateLabels = { ready: "正式上线就绪", "blocked-until-onsite-evidence": "待现场证据" };
  statusTarget.textContent = platformStandardsLedgers.ok ? "六类台账结构可验收" : "台账结构存在缺口";
  statusTarget.className = platformStandardsLedgers.ok ? "badge success" : "badge warn";
  const metricRows = [
    ["台账", summary.ledgers || 0, `${summary.implemented || 0} 张功能结构已实现`],
    ["归集记录", summary.records || 0, "仅展示治理摘要，不汇聚患者可识别明细"],
    ["验收口径", summary.acceptanceCriteria || 0, `${summary.automatedChecks || 0} 项自动检查`],
    ["正式上线", summary.formalGoLiveReady || 0, `${summary.onsiteBlockers || 0} 类现场阻断仍显式保留`]
  ];
  metricsTarget.innerHTML = metricRows.map(([label, value, hint]) => `
    <article class="metric-card"><span>${platformEscapeHtml(label)}</span><strong>${platformEscapeHtml(value)}</strong><small>${platformEscapeHtml(hint)}</small></article>
  `).join("");
  gridTarget.innerHTML = (platformStandardsLedgers.ledgers || []).map((item) => `
    <article class="evidence-card" data-platform-standards-ledger="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.title)}</h3>
      <p>${platformEscapeHtml(item.purpose)}</p>
      <small>责任方：${platformEscapeHtml(item.owner)}；记录 ${platformEscapeHtml(item.summary?.records || 0)}；${platformEscapeHtml(functionStateLabels[item.functionalState] || item.functionalState)}；${platformEscapeHtml(goLiveStateLabels[item.formalGoLiveState] || item.formalGoLiveState)}</small>
      <p>${platformEscapeHtml((item.onsiteBlockers || []).join("；"))}</p>
    </article>
  `).join("");
  populatePlatformStandardsLedgerSelect();
}

function populatePlatformStandardsLedgerSelect() {
  const select = document.querySelector("#platform-standards-ledger-select");
  if (!select) return;
  const selected = select.value;
  select.innerHTML = (platformStandardsLedgers?.ledgers || []).map((item) => `
    <option value="${platformEscapeHtml(item.id)}">${platformEscapeHtml(item.title)}</option>
  `).join("");
  if (selected && Array.from(select.options).some((option) => option.value === selected)) select.value = selected;
}

function platformStandardsLedgerFilterParams(includeFormat = false) {
  const params = new URLSearchParams();
  const query = document.querySelector("#platform-standards-ledger-query")?.value.trim() || "";
  const status = document.querySelector("#platform-standards-ledger-row-status")?.value || "";
  const collection = document.querySelector("#platform-standards-ledger-collection")?.value || "";
  if (query) params.set("q", query);
  if (status) params.set("status", status);
  if (collection) params.set("collection", collection);
  if (includeFormat) params.set("format", "markdown");
  return params;
}

function populatePlatformStandardsLedgerFacet(selector, values, emptyLabel) {
  const select = document.querySelector(selector);
  if (!select) return;
  const selected = select.value;
  select.innerHTML = `<option value="">${platformEscapeHtml(emptyLabel)}</option>${(values || []).map((value) => `
    <option value="${platformEscapeHtml(value)}">${platformEscapeHtml(value)}</option>
  `).join("")}`;
  if (selected && (values || []).includes(selected)) select.value = selected;
}

function renderPlatformStandardsLedgerDetail() {
  const statusTarget = document.querySelector("#platform-standards-ledger-detail-status");
  const acceptanceTarget = document.querySelector("#platform-standards-ledger-acceptance");
  const detailTarget = document.querySelector("#platform-standards-ledger-detail");
  if (!statusTarget || !acceptanceTarget || !detailTarget) return;
  if (!platformStandardsLedgerDetail) {
    statusTarget.textContent = "明细未加载";
    statusTarget.className = "badge warn";
    acceptanceTarget.innerHTML = "";
    detailTarget.innerHTML = `<p class="muted">请连接动态后端并选择台账。</p>`;
    return;
  }
  const detail = platformStandardsLedgerDetail;
  populatePlatformStandardsLedgerFacet("#platform-standards-ledger-row-status", detail.facets?.statuses, "全部状态");
  populatePlatformStandardsLedgerFacet("#platform-standards-ledger-collection", detail.facets?.collections, "全部来源");
  statusTarget.textContent = `${detail.summary?.filteredRows || 0}/${detail.summary?.totalRows || 0} 条；${detail.ledger.formalGoLiveState === "ready" ? "正式上线就绪" : "待现场证据"}`;
  statusTarget.className = detail.ledger.formalGoLiveState === "ready" ? "badge success" : "badge warn";
  acceptanceTarget.innerHTML = (detail.acceptanceItems || []).map((item) => `
    <article class="evidence-card" data-platform-ledger-acceptance="${platformEscapeHtml(item.id)}">
      <h3>${platformEscapeHtml(item.criterion)}</h3>
      <p>${platformEscapeHtml(item.automatedCheck || "人工复核")}</p>
      <small>${platformEscapeHtml(item.evidenceRef || "待归档证据")}；${platformEscapeHtml(item.formalGoLiveState)}</small>
    </article>
  `).join("");
  const rows = detail.rows || [];
  detailTarget.innerHTML = `
    <table>
      <thead><tr><th>来源集合</th><th>事项</th><th>责任方</th><th>状态</th><th>证据摘要</th></tr></thead>
      <tbody>${rows.length ? rows.map((item) => `
        <tr>
          <td>${platformEscapeHtml(item.collection)}</td>
          <td>${platformEscapeHtml(item.title)}</td>
          <td>${platformEscapeHtml(item.owner || "待明确")}</td>
          <td><span class="badge ${item.productionReady ? "success" : "warn"}">${platformEscapeHtml(item.status)}</span></td>
          <td>${platformEscapeHtml(item.evidence || "待补证据")}</td>
        </tr>
      `).join("") : `<tr><td colspan="5">当前筛选条件下无台账记录。</td></tr>`}</tbody>
    </table>
    <p class="muted">${platformEscapeHtml(detail.boundary)}</p>
  `;
}

async function loadPlatformStandardsLedgerDetail() {
  const ledgerId = document.querySelector("#platform-standards-ledger-select")?.value;
  if (!PLATFORM_API_BASE || !ledgerId) {
    platformStandardsLedgerDetail = null;
    renderPlatformStandardsLedgerDetail();
    return;
  }
  const statusTarget = document.querySelector("#platform-standards-ledger-detail-status");
  if (statusTarget) {
    statusTarget.textContent = "正在加载";
    statusTarget.className = "badge info";
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const params = platformStandardsLedgerFilterParams();
    const suffix = params.toString() ? `?${params}` : "";
    const response = await request(`${PLATFORM_API_BASE}/platform/standards-ledgers/${encodeURIComponent(ledgerId)}${suffix}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    platformStandardsLedgerDetail = await response.json();
  } catch (error) {
    platformStandardsLedgerDetail = null;
  }
  renderPlatformStandardsLedgerDetail();
}

function renderCapabilities(state, capabilities) {
  document.querySelector("#scope-summary").textContent = `${capabilities.length} 个建设域，${capabilities.filter((item) => !isPendingPlatformStatus(item.status)).length} 个已完成演示衔接或证据建档`;
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

function renderHospitalManagementFunctions(items) {
  const target = document.querySelector("#hospital-management-functions");
  if (!target) return;
  target.innerHTML = `
    <table>
      <thead><tr><th>管理职能</th><th>来源系统</th><th>平台集合</th><th>管理动作</th><th>责任方</th><th>证据</th><th>状态</th><th>下一步</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.functionName}</strong></td>
          <td>${listText(item.sourceSystems)}</td>
          <td>${listText(item.platformCollections)}</td>
          <td>${listText(item.managementActions)}</td>
          <td>${item.owner || ""}</td>
          <td>${listText(item.evidence)}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${item.nextAction || ""}</td>
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

function renderDataGovernanceFoundation(data) {
  const container = document.querySelector("#data-governance-foundation");
  if (!container) return;
  const assets = data.dataGovernanceAssets || [];
  const dictionaries = data.standardDataDictionaries || [];
  const lineage = data.dataLineageControls || [];
  const busChannels = data.platformDataBusChannels || [];
  const averageScore = Math.round(assets.reduce((sum, item) => sum + Number(item.qualityScore || 0), 0) / Math.max(assets.length, 1));
  const blockers = [...assets.map((item) => item.risk || ""), ...lineage.map((item) => item.status || "")]
    .filter((text) => /blocked/i.test(text)).length;
  const cards = [
    {
      title: `数据资产目录 ${assets.length} 项`,
      meta: `平均质量评分 ${averageScore} / 阻塞项 ${blockers}`,
      rows: assets.map((item) => `${platformEscapeHtml(item.sourceSystem)}: ${platformEscapeHtml(item.domain)} -> ${listText(item.platformCollections)} (${platformEscapeHtml(item.status)})`)
    },
    {
      title: `标准字典与主数据 ${dictionaries.length} 类`,
      meta: "personIndex / 机构人员 / 疾病手术 / 药品耗材 / 检查检验 / 指标",
      rows: dictionaries.map((item) => `${platformEscapeHtml(item.name)}: ${listText(item.standardItems)} (${platformEscapeHtml(item.status)})`)
    },
    {
      title: `数据质量与血缘 ${lineage.length} 条`,
      meta: "必填、幂等、签名、质量规则和来源落点可审查",
      rows: lineage.map((item) => `${platformEscapeHtml(item.sourceSystem)} -> ${platformEscapeHtml(item.targetCollection)}: ${listText(item.requiredControls)} (${platformEscapeHtml(item.status)})`)
    },
    {
      title: `平台总线复用出口 ${busChannels.length} 条`,
      meta: "主数据、标准字典、血缘证据和接口阻断项统一给指标中心与智慧医院复用",
      rows: busChannels.map((item) => `${platformEscapeHtml(item.name)}: ${listText(item.producerCollections)} -> ${listText(item.consumerModules)} (${platformEscapeHtml(item.status)})`)
    }
  ];
  container.innerHTML = cards.map((card) => `
    <article class="evidence-card">
      <h3>${platformEscapeHtml(card.title)}</h3>
      <p>${platformEscapeHtml(card.meta)}</p>
      <ul>${card.rows.slice(0, 8).map((row) => `<li>${row}</li>`).join("")}</ul>
    </article>
  `).join("");
}

function renderPhase2Catalog(data) {
  const container = document.querySelector("#phase2-catalog");
  if (!container) return;
  const dataCatalogs = data.phase2DataCatalogs || [];
  const serviceCatalogs = data.phase2ServiceCatalogs || [];
  const fieldLineage = data.phase2FieldLineage || [];
  const qualityRules = data.phase2CatalogQualityRules || [];
  const tableCount = dataCatalogs.reduce((sum, item) => sum + Number(item.tableCount || 0), 0);
  const blocked = [...dataCatalogs, ...serviceCatalogs, ...fieldLineage, ...qualityRules]
    .filter((item) => /blocked|external/i.test(`${item.status || ""} ${item.blocker || ""}`)).length;
  container.innerHTML = `
    <div class="evidence-grid">
      <article class="evidence-card">
        <h3>216 表映射 ${tableCount}/216</h3>
        <p>覆盖 ${dataCatalogs.length} 个二期数据域，${blocked} 个现场/外部阻塞项单独列出。</p>
        <ul>${dataCatalogs.map((item) => `<li>${item.tableRange} · ${item.name}：${item.tableCount} 张表 · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>服务资源目录 ${serviceCatalogs.length} 项</h3>
        <p>统一登记 API、消费角色、权限范围、SLA 和责任部门。</p>
        <ul>${serviceCatalogs.slice(0, 8).map((item) => `<li>${item.name} · ${item.apiRoute} · ${item.owner} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>字段血缘 ${fieldLineage.length} 条</h3>
        <p>把源系统字段、目标集合、契约和质量规则绑定到验收证据。</p>
        <ul>${fieldLineage.slice(0, 8).map((item) => `<li>${item.sourceSystem} ${item.sourceField} -> ${item.targetCollection}.${item.targetField}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>质量规则 ${qualityRules.length} 条</h3>
        <p>按 P0/P1/P2 标记规则严重级、责任人和证据来源。</p>
        <ul>${qualityRules.slice(0, 8).map((item) => `<li>${item.severity} · ${item.id} · ${item.owner} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderPhase2JointTestPilot(data) {
  const container = document.querySelector("#phase2-joint-test-pilot");
  if (!container) return;
  const institutions = data.phase2PilotInstitutions || [];
  const links = data.phase2JointTestLinks || [];
  const payloads = data.phase2SamplePayloads || [];
  const traces = data.phase2GatewayTraces || [];
  const issues = data.phase2JointTestIssues || [];
  const landed = traces.filter((item) => /landed|compensated/i.test(String(item.status || ""))).length;
  const runnable = links.filter((item) => /passed|compensated/i.test(String(item.status || ""))).length;
  container.innerHTML = `
    <div class="evidence-grid">
      <article class="evidence-card">
        <h3>试点机构 ${institutions.length} 个</h3>
        <p>覆盖三级医院、区县平台和基层机构，账号、环境和签字状态单独登记。</p>
        <ul>${institutions.map((item) => `<li>${item.institutionLevel} · ${item.name} · ${item.region} · ${statusBadge(item.signoffStatus)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>联调链路 ${runnable}/${links.length}</h3>
        <p>把机构、系统、接口、字段、样例报文和目标集合绑定到同一条链路。</p>
        <ul>${links.slice(0, 8).map((item) => `<li>${item.chain} · ${item.sourceSystem} -> ${item.targetCollection} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>样例报文 ${payloads.length} 份</h3>
        <p>患者、就诊、检验报告、统计指标等样例均保留幂等键、签名算法和哈希。</p>
        <ul>${payloads.slice(0, 8).map((item) => `<li>${item.category} · ${item.sourceSystem} · ${item.idempotencyKey} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>网关轨迹 ${landed}/${traces.length}</h3>
        <p>记录验签、落库集合、落库 ID、死信补偿和回放状态。</p>
        <ul>${traces.slice(0, 8).map((item) => `<li>${item.payloadId} -> ${item.targetCollection} · ${item.replayStatus} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>问题复测 ${issues.length} 项</h3>
        <p>现场账号、密钥、字典、指标版本和回调口径保持开放阻塞边界。</p>
        <ul>${issues.map((item) => `<li>${item.severity} · ${item.title} · ${item.owner} · ${statusBadge(item.retestStatus)}</li>`).join("")}</ul>
      </article>
    </div>
  `;
}

function renderPhase2DiseaseReporting(data) {
  const container = document.querySelector("#phase2-disease-reporting");
  if (!container) return;
  const rules = data.phase2DiseaseReportingRules || [];
  const queue = data.phase2DiseaseReportQueue || [];
  const receipts = data.phase2DiseaseReportReceipts || [];
  const categories = [...new Set(rules.map((item) => item.diseaseCategory).filter(Boolean))];
  const pushed = queue.filter((item) => /accepted|sent|pushed|receipt/i.test(`${item.status || ""} ${item.pushStatus || ""}`));
  const openExceptions = queue.filter((item) => /open|review|required|pending/i.test(`${item.exceptionStatus || ""} ${item.pushStatus || ""}`));
  const patientCenterRows = queue.filter((item) => item.patientCenterStatus && item.patientCenterRecordId);
  const supervisionRows = categories.map((category) => {
    const rows = queue.filter((item) => item.diseaseCategory === category);
    const counties = [...new Set(rows.map((item) => item.targetCounty).filter(Boolean))].join(" / ");
    return `<li>${category}：${rows.length} 张报卡 · ${counties || "待区县确认"} · ${rows.filter((item) => /open|review|required|pending/i.test(`${item.exceptionStatus || ""} ${item.pushStatus || ""}`)).length} 个异常</li>`;
  }).join("");
  container.innerHTML = `
    <div class="evidence-grid">
      <article class="evidence-card">
        <h3>诊断触发规则 ${rules.length} 条</h3>
        <p>覆盖慢病、传染病和重性精神障碍，绑定 HIS/EMR/LIS/专科随访触发源。</p>
        <ul>${rules.map((item) => `<li>${item.diseaseCode} · ${item.diseaseName} · ${item.triggerSource} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>报卡队列 ${pushed.length}/${queue.length}</h3>
        <p>每条报卡保留规则、居民、区县平台、患者中心状态和异常闭环。</p>
        <ul>${queue.map((item) => `<li>${item.reportCardNo} · ${item.diseaseName} · ${item.targetCounty} · ${statusBadge(item.pushStatus || item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>区县回执 ${receipts.length} 条</h3>
        <p>回执保留状态、编号、重试次数和审计哈希，支撑补偿重放。</p>
        <ul>${receipts.map((item) => `<li>${item.receiptCode} · ${item.targetCounty} · ${item.receiptStatus} · retry ${item.retryCount || 0}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>患者中心 ${patientCenterRows.length} 条</h3>
        <p>导入导出状态与隐私展示策略单独保留，传染病和精防只展示授权摘要。</p>
        <ul>${patientCenterRows.map((item) => `<li>${item.residentName || item.residentId} · ${item.diseaseName} · ${item.patientCenterStatus}/${item.exportStatus}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>监管分类 ${categories.length} 类</h3>
        <p>按病种类别、区县、推送状态和异常状态统计。</p>
        <ul>${supervisionRows}</ul>
      </article>
      <article class="evidence-card">
        <h3>异常闭环 ${openExceptions.length} 个</h3>
        <p>现场接口、直报复核、精防签字和字段版本问题不会误报为生产完成。</p>
        <ul>${openExceptions.map((item) => `<li>${item.diseaseName} · ${item.exceptionStatus} · ${item.lastAction}</li>`).join("") || "<li>暂无开放异常。</li>"}</ul>
      </article>
    </div>
  `;
}

function renderPhase2ClinicalAssist(data) {
  const container = document.querySelector("#phase2-clinical-assist");
  if (!container) return;
  const rules = data.phase2ClinicalAssistRules || [];
  const alerts = data.phase2ClinicalAssistAlerts || [];
  const receipts = data.phase2ClinicalAssistReceipts || [];
  const contracts = data.phase2ClinicalAssistPluginContracts || [];
  const categories = [...new Set(rules.map((item) => item.category).filter(Boolean))];
  const pending = alerts.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`));
  const acknowledged = alerts.filter((item) => /acknowledged|received|已/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`));
  const doctors = [...new Set(alerts.map((item) => item.doctorName || item.doctorId).filter(Boolean))];
  const supervisionRows = categories.map((category) => {
    const rows = alerts.filter((item) => item.category === category);
    return `<li>${category}：${rows.length} 条提醒 · ${rows.filter((item) => /pending|待/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`)).length} 条待回执 · ${rows.filter((item) => /acknowledged|received|已/i.test(`${item.status || ""} ${item.messageReceiptStatus || ""}`)).length} 条已处理</li>`;
  }).join("");
  container.innerHTML = `
    <div class="evidence-grid">
      <article class="evidence-card">
        <h3>规则配置 ${rules.length} 条</h3>
        <p>覆盖重复诊断、重复检查、重复检验和重复用药，保留责任处室和灰度口径。</p>
        <ul>${rules.map((item) => `<li>${item.name} · ${item.sourceSystem} · ${statusBadge(item.configStatus)} · ${item.owner}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>工作站提醒 ${acknowledged.length}/${alerts.length}</h3>
        <p>每条提醒绑定医生、居民、规则、医嘱来源、建议动作和患者中心关联。</p>
        <ul>${alerts.map((item) => `<li>${item.doctorName} · ${item.alertTitle} · ${item.residentName} · ${statusBadge(item.messageReceiptStatus || item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>消息回执 ${receipts.length} 条</h3>
        <p>回执保留医生动作、消息通道、审计哈希和院内工作站处理记录。</p>
        <ul>${receipts.map((item) => `<li>${item.doctorName} · ${item.doctorAction} · ${item.receiptStatus} · ${item.messageChannel}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>插件契约 ${contracts.length} 项</h3>
        <p>将提醒拉取、回执提交和规则配置固化为医生工作站集成协议。</p>
        <ul>${contracts.map((item) => `<li>${item.name} · ${item.endpoint} · ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>监管分类 ${categories.length} 类</h3>
        <p>按辅助类型、医生、机构、回执状态和现场阻塞项统计。</p>
        <ul>${supervisionRows}</ul>
      </article>
      <article class="evidence-card">
        <h3>上线边界 ${pending.length} 条待回执</h3>
        <p>医生工作站、院内消息中心、电子签名和质控规则审批仍保留现场签字边界。</p>
        <ul>
          <li>医生范围：${doctors.join(" / ") || "待绑定"}</li>
          ${pending.map((item) => `<li>${item.alertTitle} · ${item.lastAction}</li>`).join("") || "<li>暂无待回执提醒。</li>"}
        </ul>
      </article>
    </div>
  `;
}

function renderPhase2FamilyDoctorContracts(data) {
  const container = document.querySelector("#phase2-family-doctor-contracts");
  if (!container) return;
  const templates = data.phase2FamilyDoctorTemplates || [];
  const teams = data.phase2FamilyDoctorTeams || [];
  const packages = data.phase2FamilyDoctorServicePackages || [];
  const applications = data.phase2FamilyDoctorApplications || [];
  const contracts = data.phase2FamilyDoctorContracts || [];
  const fulfillments = data.phase2FamilyDoctorFulfillments || [];
  const pendingApplications = applications.filter((item) => /pending|submitted|review/i.test(`${item.reviewStatus || ""} ${item.status || ""}`));
  const activeContracts = contracts.filter((item) => /active|renewal/i.test(String(item.status || "")));
  const renewals = [...applications, ...contracts].filter((item) => /renewal|续约/i.test(`${item.applicationType || ""} ${item.renewalStatus || ""} ${item.status || ""}`));
  const avgFulfillment = contracts.length ? Math.round(contracts.reduce((sum, item) => sum + Number(item.fulfillmentPercent || 0), 0) / contracts.length) : 0;
  const teamRows = teams.map((team) => {
    const teamContracts = contracts.filter((item) => item.teamId === team.id);
    const teamApplications = applications.filter((item) => item.teamId === team.id);
    const teamFulfillments = fulfillments.filter((item) => item.teamId === team.id);
    const teamAvg = teamContracts.length ? Math.round(teamContracts.reduce((sum, item) => sum + Number(item.fulfillmentPercent || 0), 0) / teamContracts.length) : 0;
    return `<li>${team.teamName || team.id}：${teamApplications.length} 申请 / ${teamContracts.length} 合同 / ${teamFulfillments.length} 履约 / ${teamAvg}%</li>`;
  }).join("");
  container.innerHTML = `
    <div class="evidence-grid">
      <article class="evidence-card">
        <h3>签约模板 ${templates.length} 套</h3>
        <p>模板固定必填字段、审核步骤、服务范围和版本，支撑居民端申请与机构端审核一致。</p>
        <ul>${templates.map((item) => `<li>${item.name || item.id} / ${item.templateCode || item.version} / ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>团队与服务包 ${teams.length}/${packages.length}</h3>
        <p>家庭医生团队、基层机构、负责人、容量与服务包可按机构监管。</p>
        <ul>${packages.map((item) => `<li>${item.name || item.id} / ${item.visitFrequency || "cycle"} / ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>居民申请 ${pendingApplications.length}/${applications.length} 待审</h3>
        <p>申请保留居民、服务包、团队、知情确认、目标起始日期和机构审核状态。</p>
        <ul>${applications.map((item) => `<li>${item.residentName || item.residentId} / ${item.packageId} / ${item.reviewInstitutionCode} / ${statusBadge(item.reviewStatus || item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>签约合同 ${activeContracts.length}/${contracts.length}</h3>
        <p>合同记录服务包、团队、起止日期、履约进度、续约状态和居民满意度。</p>
        <ul>${contracts.map((item) => `<li>${item.residentName || item.residentId} / ${item.packageId} / ${item.fulfillmentPercent || 0}% / ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>履约与续约 ${fulfillments.length} / ${renewals.length}</h3>
        <p>履约记录绑定合同、服务项目、证据集合、满意度和审计哈希，平均履约 ${avgFulfillment}%。</p>
        <ul>${fulfillments.map((item) => `<li>${item.contractId} / ${item.serviceType} / ${item.serviceDate} / ${statusBadge(item.status)}</li>`).join("")}</ul>
      </article>
      <article class="evidence-card">
        <h3>团队监管 ${teams.length} 行</h3>
        <p>按团队查看申请、合同、履约和平均履约率，保留正式签约和资金口径现场确认边界。</p>
        <ul>${teamRows || "<li>暂无团队监管数据</li>"}</ul>
      </article>
    </div>
  `;
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

function renderApplicationCatalog(items) {
  document.querySelector("#application-catalog").innerHTML = `
    <table>
      <thead><tr><th>应用/模块</th><th>来源系统</th><th>接口方式</th><th>责任处室</th><th>复用方式</th><th>批次</th><th>验收证据</th><th>状态</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.name}</strong></td><td>${item.sourceSystem}</td><td>${item.interfaceMode}</td>
          <td>${item.owner}</td><td>${item.reuseMode}</td><td>${item.batch}</td><td>${item.evidence}</td>
          <td>${statusBadge(item.status)}</td>
          <td><button class="inline-action" type="button" data-edit-platform="applicationCatalog" data-id="${item.id}">维护</button></td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function renderInstitutionCreditEvaluations(items) {
  document.querySelector("#institution-credit-evaluations").innerHTML = `
    <table>
      <thead><tr><th>机构</th><th>类型</th><th>周期</th><th>得分/等级</th><th>指标明细</th><th>状态</th><th>整改责任</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${item.name}</strong></td><td>${item.institutionType}</td><td>${item.period}</td>
          <td><strong>${item.score}</strong> / ${item.grade}</td><td>${item.indicators}</td><td>${statusBadge(item.status)}</td>
          <td>${item.owner}</td>
          <td><button class="inline-action" type="button" data-edit-platform="creditEvaluations" data-id="${item.id}">维护</button></td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function renderSecurityAcceptanceLedger(items) {
  document.querySelector("#security-acceptance-ledger").innerHTML = items.map((item) => `
    <div>
      <strong>${item.category} · ${item.name}</strong>
      <span>${item.control}</span>
      <span>证据：${item.evidence}</span>
      <span>${item.owner} · ${statusBadge(item.status)}</span>
      <button class="inline-action" type="button" data-edit-platform="securityLedger" data-id="${item.id}">维护</button>
    </div>`).join("");
}

function renderProductionDeploymentPlan(items) {
  const container = document.querySelector("#production-deployment-plan");
  if (!container) return;
  container.innerHTML = items.map((item, index) => {
    const badge = item.status === "ready" ? "info" : item.status === "blocked" ? "danger" : "warn";
    const configs = (item.requiredConfig || []).map((config) => `<span class="badge info">${config}</span>`).join("");
    const evidence = (item.evidence || []).slice(0, 3).map((entry) => `<small>${entry}</small>`).join("");
    return `
      <article class="priority-row">
        <div class="priority-rank ${badge}">${index + 1}</div>
        <div>
          <h3>${item.name}</h3>
          <p>${item.nextAction || item.next || ""}</p>
          <div class="standard-tags">${configs}</div>
        </div>
        <div class="capability-side">
          <span class="badge ${badge}">${item.status || "planned"}</span>
          <small>${item.owner || "责任人待分派"} · ${item.track || "生产轨道"}</small>
          ${evidence}
          <button class="inline-action" type="button" data-edit-platform="productionDeploymentPlan" data-id="${item.id}">维护</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderIdentityLifecycleCenter() {
  const metricsTarget = document.querySelector("#identity-lifecycle-metrics");
  const planTarget = document.querySelector("#identity-directory-plan");
  const statusTarget = document.querySelector("#identity-lifecycle-status");
  const boundaryTarget = document.querySelector("#identity-lifecycle-boundary");
  const smsMetricsTarget = document.querySelector("#sms-delivery-metrics");
  const smsReceiptsTarget = document.querySelector("#sms-delivery-receipts");
  const smsStatusTarget = document.querySelector("#sms-delivery-status");
  if (!metricsTarget || !planTarget || !smsMetricsTarget || !smsReceiptsTarget) return;
  const center = identityLifecycleCenter;
  const identity = center.identity || {};
  const sms = center.sms || {};
  const smsDelivery = center.smsDelivery || {};
  const smsSummary = smsDelivery.summary || {};
  const summary = center.plan?.summary || {};
  const sessionStore = center.capabilities?.sessionStore || {};
  const sessionRetention = sessionStore.retention || {};
  const sessionCleanup = sessionStore.cleanup || {};
  const metrics = [
    ["会话存储", sessionStore.durable ? `${sessionStore.mode || "sqlite"} 持久化` : "进程内存", sessionStore.crossHost ? "多主机中央会话可跨节点撤销" : sessionStore.crossProcess ? "同一主机共享数据目录可跨进程撤销" : "仅限本地开发和测试"],
    ["会话保留", `${sessionRetention.expiredDays || 7}/${sessionRetention.revokedDays || 30} 天`, sessionCleanup.status === "ok" ? `最近清理 ${sessionCleanup.deletedTotal || 0} 条` : "等待首次清理"],
    ["OIDC 登录", identity.configured ? "已配置" : "未配置", "UserInfo + 受控账号绑定"],
    ["令牌刷新", identity.refreshConfigured ? "可用" : "未配置", "刷新后重新校验身份"],
    ["撤销登出", identity.revocationConfigured ? "可用" : "未配置", "上游撤销 + 本地会话删除"],
    ["目录停用", identity.directoryConfigured ? `${summary.deactivations || 0} 待停用` : "未配置", `${summary.bindingReviews || 0} 项待绑定复核`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  const ready = identity.configured && identity.refreshConfigured && identity.revocationConfigured && identity.directoryConfigured && identity.productionHttps;
  if (statusTarget) {
    statusTarget.textContent = ready ? "生命周期适配就绪" : "配置待补";
    statusTarget.className = `badge ${ready ? "info" : "warn"}`;
    statusTarget.removeAttribute("title");
  }
  const items = center.plan?.items || [];
  planTarget.innerHTML = items.length ? items.map((item) => `<article class="priority-row" data-identity-directory-item="${platformEscapeHtml(item.localUserId || item.externalSubject)}">
    <div class="priority-rank ${item.action === "deactivate" ? "danger" : item.action.includes("review") || item.action.includes("binding") ? "warn" : "ok"}">${item.remoteActive ? "启" : "停"}</div>
    <div>
      <h3>${platformEscapeHtml(item.displayName || item.username || "未命名目录账号")}</h3>
      <p>${platformEscapeHtml(item.username || "-")} · ${platformEscapeHtml(item.orgCode || "机构待映射")}</p>
      <small>${platformEscapeHtml(item.action)}</small>
    </div>
    <div class="capability-side">
      <span class="badge ${item.action === "deactivate" ? "danger" : "info"}">${platformEscapeHtml(item.localStatus)}</span>
      <small>${platformEscapeHtml(item.localRole || "unbound")}</small>
      ${item.action === "controlled-binding-required" && item.localUserId && item.externalSubject && item.remoteActive ? `<button class="inline-action" type="button" data-identity-binding-action data-local-user-id="${platformEscapeHtml(item.localUserId)}" data-external-subject="${platformEscapeHtml(item.externalSubject)}">受控绑定</button>` : ""}
    </div>
  </article>`).join("") : `<p class="muted">尚未运行目录同步预检。</p>`;
  const smsMetrics = [
    ["受理回执", smsSummary.receipts || 0, sms.configured ? "短信网关已配置" : "短信网关待配置"],
    ["待送达", smsSummary.pending || 0, "已受理、排队或已发送"],
    ["已送达", smsSummary.delivered || 0, "供应商最终送达回执"],
    ["失败", smsSummary.failed || 0, "失败、过期、不可达或拒绝"],
    ["回调事件", smsSummary.callbackEvents || 0, `${smsSummary.ignoredEvents || 0} 条乱序或冲突事件未覆盖状态`]
  ];
  smsMetricsTarget.innerHTML = smsMetrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  const smsReceipts = smsDelivery.receipts || [];
  smsReceiptsTarget.innerHTML = smsReceipts.length ? smsReceipts.slice(0, 20).map((item, index) => {
    const failed = ["failed", "expired", "undeliverable", "rejected"].includes(item.status);
    const badge = item.status === "delivered" ? "info" : failed ? "danger" : "warn";
    return `<article class="priority-row" data-sms-delivery-receipt="${platformEscapeHtml(item.id)}">
      <div class="priority-rank ${badge}">${index + 1}</div>
      <div>
        <h3>${platformEscapeHtml(item.purpose || "短信送达")}</h3>
        <p>${platformEscapeHtml(item.maskedPhone || "-")} · ${platformEscapeHtml(item.providerMessageId || "-")}</p>
        <small>${platformEscapeHtml(item.latestEventAt || item.acceptedAt || "-")}${item.providerCode ? ` · ${platformEscapeHtml(item.providerCode)}` : ""}</small>
      </div>
      <div class="capability-side">
        <span class="badge ${badge}">${platformEscapeHtml(item.status || "accepted")}</span>
        <small>${(item.events || []).length} 条回调</small>
      </div>
    </article>`;
  }).join("") : `<p class="muted">尚无短信受理回执。</p>`;
  if (smsStatusTarget) {
    smsStatusTarget.textContent = sms.callbackConfigured ? "签名回调就绪" : "回调待配置";
    smsStatusTarget.className = `badge ${sms.callbackConfigured ? "info" : "warn"}`;
  }
  if (boundaryTarget) boundaryTarget.textContent = [center.boundary, smsDelivery.boundary].filter(Boolean).join(" ") || "身份和短信供应商仍需现场联合验收。";
  window.HealthPlatformIdentityGovernanceUi?.render(platformState.authUsers || [], {
    policy: window.HealthAccessPolicy
  });
}

function renderFinancialGatewayOperationsCenter() {
  const metricsTarget = document.querySelector("#financial-gateway-operations-metrics");
  const eventsTarget = document.querySelector("#financial-gateway-callback-events");
  const runsTarget = document.querySelector("#financial-reconciliation-runs");
  const statusTarget = document.querySelector("#financial-gateway-operations-status");
  const boundaryTarget = document.querySelector("#financial-gateway-operations-boundary");
  if (!metricsTarget || !eventsTarget || !runsTarget) return;
  const center = financialGatewayOperationsCenter;
  const summary = center.summary || {};
  const callbackDomains = (center.gateways || []).filter((item) => item.callbackConfigured).length;
  const metrics = [
    ["回调域", `${callbackDomains}/${(center.gateways || []).length || 3}`, center.callbackReady ? "三类签名回调已配置" : "回调密钥待配置"],
    ["待回调", summary.pending || 0, `${summary.dispatched || 0} 笔出站请求`],
    ["成功", summary.succeeded || 0, `${summary.callbackEvents || 0} 条签名事件`],
    ["异常", summary.exceptions || 0, `${summary.ignoredEvents || 0} 条未覆盖状态`],
    ["对账差异", summary.reconciliationDifferences || 0, `${summary.reconciliationRuns || 0} 次日终对账`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  const events = center.events || [];
  eventsTarget.innerHTML = events.length ? events.slice(0, 20).map((item, index) => {
    const exception = item.reconciliationStatus === "provider-exception";
    const succeeded = item.status === "succeeded";
    const badge = exception ? "danger" : succeeded ? "info" : "warn";
    return `<article class="priority-row" data-financial-callback-event="${platformEscapeHtml(item.id)}">
      <div class="priority-rank ${badge}">${index + 1}</div>
      <div>
        <h3>${platformEscapeHtml(item.gatewayType)} · ${platformEscapeHtml(item.operation)}</h3>
        <p>${platformEscapeHtml(item.receiptId || "回执待生成")}</p>
        <small>${platformEscapeHtml(item.latestCallbackAt || item.businessDate || "等待最终回调")}</small>
      </div>
      <div class="capability-side">
        <span class="badge ${badge}">${platformEscapeHtml(item.status || "accepted")}</span>
        <small>${(item.callbackEvents || []).length} 条回调</small>
      </div>
    </article>`;
  }).join("") : `<p class="muted">尚无金融网关出站记录。</p>`;
  const runs = center.reconciliationRuns || [];
  runsTarget.innerHTML = runs.length ? runs.slice(0, 20).map((item, index) => {
    const matched = item.status === "matched";
    return `<article class="priority-row" data-financial-reconciliation-run="${platformEscapeHtml(item.id)}">
      <div class="priority-rank ${matched ? "ok" : "danger"}">${index + 1}</div>
      <div>
        <h3>${platformEscapeHtml(item.gatewayType)} · ${platformEscapeHtml(item.businessDate)}</h3>
        <p>本地 ${platformEscapeHtml(item.localSummary?.total || 0)} 笔 · 账单 ${platformEscapeHtml(item.providerSummary?.total || 0)} 笔</p>
        <small>金额差 ${platformEscapeHtml(item.differences?.grossAmountFen || 0)} 分 · ${platformEscapeHtml(item.createdBy || "operations")}</small>
      </div>
      <div class="capability-side">
        <span class="badge ${matched ? "info" : "danger"}">${matched ? "一致" : "有差异"}</span>
      </div>
    </article>`;
  }).join("") : `<p class="muted">尚无日终对账摘要。</p>`;
  if (statusTarget) {
    const hasDifference = Number(summary.exceptions || 0) + Number(summary.reconciliationDifferences || 0) > 0;
    statusTarget.textContent = hasDifference ? "存在待处置差异" : center.callbackReady ? "签名回调就绪" : "回调待配置";
    statusTarget.className = `badge ${hasDifference ? "danger" : center.callbackReady ? "info" : "warn"}`;
  }
  if (boundaryTarget) boundaryTarget.textContent = center.boundary || "真实机构字段、回调白名单、账单传输和联合签字仍需现场验收。";
}

function platformEscapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function productionDatabaseCutoverModel(platform) {
  const migrationBatches = platform.productionDatabaseMigrationBatches || [];
  const cutoverRuns = [...(platform.productionDatabaseCutoverRuns || [])]
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latestRun = cutoverRuns[0] || null;
  const sampleValidations = Array.isArray(latestRun?.sampleValidations) ? latestRun.sampleValidations : [];
  return {
    migrationBatches,
    cutoverRuns,
    latestRun,
    summary: {
      migrationBatches: migrationBatches.length,
      cutoverRuns: cutoverRuns.length,
      sampleDomains: sampleValidations.length,
      passedSamples: sampleValidations.filter((item) => item.passed).length,
      rollbackCheckpoints: cutoverRuns.filter((item) => item.rollbackCheckpoint?.id).length,
      productionReadyRuns: cutoverRuns.filter((item) => item.productionReady).length,
      blockers: new Set(cutoverRuns.flatMap((item) => item.blockers || [])).size
    },
    boundary: "割接中心只校验迁移样例与回滚证据，不写入真实目标数据库。正式切换仍需 PostgreSQL 兼容驱动、脱敏全量演练、容量与故障转移证据及签字审批。"
  };
}

function platformCapabilityReviewBadge(status) {
  if (status === "reviewed-preproduction") return "info";
  if (status === "improvement-required") return "danger";
  return "warn";
}

function platformCapabilityBlockerLabel(status) {
  if (String(status).includes("automation-foundation")) return "自动化基础就绪";
  if (String(status).includes("shadow-case-workflow")) return "影子核对闭环就绪";
  if (String(status).includes("adapter-foundation")) return "适配基础就绪";
  return "等待现场证据";
}

function platformProductionBlockerBadge(status) {
  if (status === "site-accepted") return "ok";
  if (status === "evidence-reviewed-site-pending") return "info";
  if (status === "evidence-submitted") return "warn";
  if (status === "in-progress") return "warn";
  return "danger";
}

function renderPlatformCapabilityOperationsCenter() {
  const metricsTarget = document.querySelector("#platform-capability-operations-metrics");
  const ledgerTarget = document.querySelector("#platform-capability-review-ledger");
  const blockerTarget = document.querySelector("#platform-capability-production-blockers");
  const statusTarget = document.querySelector("#platform-capability-operations-status");
  const boundaryTarget = document.querySelector("#platform-capability-operations-boundary");
  if (!metricsTarget || !ledgerTarget || !blockerTarget) return;
  const center = platformCapabilityOperationsCenter;
  const summary = center.summary || {};
  const metrics = [
    ["主要能力域", summary.capabilityDomains || 0, `${summary.repositoryEvidenceReady || 0} 项仓库证据齐备`],
    ["生产前复核", summary.reviewedPreproduction || 0, `${summary.pendingReview || 0} 项待复核`],
    ["已补录证据", summary.evidenceRecorded || 0, `${summary.improvementRequired || 0} 项要求整改`],
    ["生产阻断", summary.productionBlockers || 0, `${summary.blockerEvidenceRecorded || 0} 项有证据 / ${summary.blockerEvidenceReviewed || 0} 项已复核`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  if (statusTarget) {
    statusTarget.textContent = `${summary.reviewedPreproduction || 0}/${summary.capabilityDomains || 0} 已完成生产前复核`;
    statusTarget.className = `badge ${summary.reviewedPreproduction ? "info" : "warn"}`;
  }
  ledgerTarget.innerHTML = (center.capabilities || []).map((item, index) => {
    const review = item.review || {};
    const latest = review.actionHistory?.[0];
    return `<article class="priority-row" data-platform-capability="${platformEscapeHtml(item.id)}">
      <div class="priority-rank ${item.repositoryEvidenceReady ? "ok" : "danger"}">${platformEscapeHtml(index + 1)}</div>
      <div>
        <h3>${platformEscapeHtml(item.name)}</h3>
        <p>${platformEscapeHtml((item.functions || []).join(" / "))}</p>
        <small>责任人：${platformEscapeHtml(review.owner || "待分派")} · 证据 ${platformEscapeHtml(review.evidenceRefs?.length || 0)} 条</small>
        <small>${latest ? `${platformEscapeHtml(latest.action)} · ${platformEscapeHtml(latest.actor)} · ${platformEscapeHtml(latest.at)}` : "尚无人工复核记录"}</small>
        <div class="action-row">
          <button class="inline-action" type="button" data-platform-capability-action="assign" data-id="${platformEscapeHtml(item.id)}">分派</button>
          <button class="inline-action" type="button" data-platform-capability-action="record-evidence" data-id="${platformEscapeHtml(item.id)}">补录证据</button>
          <button class="inline-action" type="button" data-platform-capability-action="review" data-id="${platformEscapeHtml(item.id)}">生产前复核</button>
          <button class="inline-action" type="button" data-platform-capability-action="request-improvement" data-id="${platformEscapeHtml(item.id)}">要求整改</button>
          <button class="inline-action" type="button" data-platform-capability-action="comment" data-id="${platformEscapeHtml(item.id)}">备注</button>
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${platformCapabilityReviewBadge(review.reviewStatus)}">${platformEscapeHtml(review.reviewStatus || "pending-review")}</span>
        <small>${item.repositoryEvidenceReady ? "仓库证据齐备" : "仓库证据缺失"}</small>
        <small>productionReady: no</small>
      </div>
    </article>`;
  }).join("") || `<p class="muted">当前没有可复核能力域。</p>`;
  blockerTarget.innerHTML = (center.productionBlockers || []).map((item) => {
    const review = item.review || {};
    const latest = review.actionHistory?.[0];
    const status = review.workflowStatus || "open";
    return `<article class="priority-row" data-platform-blocker="${platformEscapeHtml(item.id)}">
      <div class="priority-rank danger">${platformEscapeHtml(item.id)}</div>
      <div>
        <h3>${platformEscapeHtml(item.name)}</h3>
        <p>${platformEscapeHtml(item.progress || item.status)}</p>
        <small>责任人：${platformEscapeHtml(review.owner || item.owner)} · 证据 ${platformEscapeHtml(review.evidenceRefs?.length || 0)} 条</small>
        <small>${latest ? `${platformEscapeHtml(latest.action)} · ${platformEscapeHtml(latest.actor)} · ${platformEscapeHtml(latest.at)}` : platformEscapeHtml(item.doneWhen)}</small>
        <div class="action-row">
          ${status === "evidence-reviewed-site-pending" ? `<button class="inline-action" type="button" data-platform-blocker-action="record-site-acceptance" data-id="${platformEscapeHtml(item.id)}">Record site acceptance</button>` : ""}
          ${status === "site-accepted" ? `<button class="inline-action" type="button" data-platform-blocker-action="revoke-site-acceptance" data-id="${platformEscapeHtml(item.id)}">Revoke site acceptance</button>` : ""}
          <button class="inline-action" type="button" data-platform-blocker-action="assign" data-id="${platformEscapeHtml(item.id)}">分派</button>
          <button class="inline-action" type="button" data-platform-blocker-action="record-evidence" data-id="${platformEscapeHtml(item.id)}">补录证据</button>
          ${status === "open" ? `<button class="inline-action" type="button" data-platform-blocker-action="start-remediation" data-id="${platformEscapeHtml(item.id)}">启动整改</button>` : ""}
          ${status === "in-progress" && review.evidenceRefs?.length ? `<button class="inline-action" type="button" data-platform-blocker-action="submit-evidence" data-id="${platformEscapeHtml(item.id)}">提交证据</button>` : ""}
          ${status === "evidence-submitted" ? `<button class="inline-action" type="button" data-platform-blocker-action="review-evidence" data-id="${platformEscapeHtml(item.id)}">复核证据</button>` : ""}
          ${status === "evidence-reviewed-site-pending" ? `<button class="inline-action" type="button" data-platform-blocker-action="reopen" data-id="${platformEscapeHtml(item.id)}">重新整改</button>` : ""}
          <button class="inline-action" type="button" data-platform-blocker-action="comment" data-id="${platformEscapeHtml(item.id)}">备注</button>
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${platformProductionBlockerBadge(status)}">${platformEscapeHtml(status)}</span>
        <small>Site acceptance: ${platformEscapeHtml(review.siteAcceptance?.status || "pending")}</small>
        <small title="${platformEscapeHtml(item.status)}">${platformEscapeHtml(platformCapabilityBlockerLabel(item.status))}</small>
        <small>现场验收：仍需完成</small>
      </div>
    </article>`;
  }).join("") || `<p class="muted">当前没有生产阻断记录。</p>`;
  if (boundaryTarget) boundaryTarget.textContent = center.boundary || "正式上线仍需完成现场验收与 go/no-go 签字。";
}

function renderProductionDatabaseCutoverCenter(platform) {
  const metricsTarget = document.querySelector("#production-database-cutover-metrics");
  const runsTarget = document.querySelector("#production-database-cutover-runs");
  const batchesTarget = document.querySelector("#production-database-migration-batches");
  const statusTarget = document.querySelector("#production-database-cutover-status");
  const boundaryTarget = document.querySelector("#production-database-cutover-boundary");
  if (!metricsTarget || !runsTarget || !batchesTarget) return;
  const center = productionDatabaseCutoverModel(platform);
  const summary = center.summary;
  const latest = center.latestRun;
  const metrics = [
    ["迁移批次", summary.migrationBatches, "居民、诊疗、报告、统计"],
    ["样例校验", `${summary.passedSamples}/${summary.sampleDomains}`, latest?.status || "planned"],
    ["回滚检查点", summary.rollbackCheckpoints, latest?.rollbackCheckpoint?.status || "planned"],
    ["生产就绪", summary.productionReadyRuns, `${summary.blockers} 项外部阻断`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  if (statusTarget) {
    statusTarget.textContent = latest?.status || "planned";
    statusTarget.className = `badge ${latest?.productionReady ? "ok" : latest?.status === "validation-failed" || latest?.status === "retest-required" ? "danger" : "warn"}`;
  }
  runsTarget.innerHTML = latest ? `<article class="priority-row" data-production-db-run="${platformEscapeHtml(latest.id)}">
    <div class="priority-rank ${latest.productionReady ? "ok" : "warn"}">${platformEscapeHtml(latest.mode || "dry-run")}</div>
    <div>
      <h3>${platformEscapeHtml(latest.runNo || latest.id)}</h3>
      <p>${platformEscapeHtml(latest.createdBy || "release-manager")} / ${platformEscapeHtml(latest.createdAt || "")}</p>
      <small>样例：${platformEscapeHtml(summary.passedSamples)}/${platformEscapeHtml(summary.sampleDomains)}；复核：${platformEscapeHtml(latest.reviewStatus || "pending")}；回滚：${platformEscapeHtml(latest.rollbackCheckpoint?.status || "planned")}</small>
      <small>${platformEscapeHtml((latest.blockers || []).join(" / "))}</small>
      <div class="action-row">
        <button class="inline-action" type="button" data-production-db-action="review" data-id="${platformEscapeHtml(latest.id)}">记录复核</button>
        <button class="inline-action" type="button" data-production-db-action="record-rollback" data-id="${platformEscapeHtml(latest.id)}">记录回滚演练</button>
        <button class="inline-action" type="button" data-production-db-action="request-retest" data-id="${platformEscapeHtml(latest.id)}">要求复测</button>
      </div>
    </div>
    <div class="capability-side">
      <span class="badge ${latest.productionReady ? "ok" : "warn"}">${platformEscapeHtml(latest.status || "planned")}</span>
      <small>target: ${platformEscapeHtml(latest.targetAdapter || "postgresql")}</small>
      <small>productionReady: ${latest.productionReady ? "yes" : "no"}</small>
    </div>
  </article>` : "";
  batchesTarget.innerHTML = center.migrationBatches.map((item) => `<article class="priority-row" data-production-db-batch="${platformEscapeHtml(item.id)}">
    <div class="priority-rank info">${platformEscapeHtml(item.sequence || "")}</div>
    <div>
      <h3>${platformEscapeHtml(item.name || item.domain)}</h3>
      <p>${platformEscapeHtml((item.sourceCollections || []).join(" + "))} -> ${platformEscapeHtml((item.targetTables || []).join(" + "))}</p>
      <small>${platformEscapeHtml(item.rollbackStrategy || "")}</small>
    </div>
    <div class="capability-side">
      <span class="badge info">${platformEscapeHtml(item.status || "planned")}</span>
      <small>${platformEscapeHtml(item.owner || "owner-pending")}</small>
    </div>
  </article>`).join("");
  renderPostgresProductionAdapterCenter();
  renderPostgresReconciliationCenter();
  if (boundaryTarget) boundaryTarget.textContent = center.boundary;
}

function renderPostgresProductionAdapterCenter() {
  const metricsTarget = document.querySelector("#postgres-adapter-metrics");
  const adapterStatusTarget = document.querySelector("#postgres-adapter-status");
  const primaryReadStatusTarget = document.querySelector("#postgres-primary-read-status");
  if (!metricsTarget) return;
  const center = postgresProductionAdapterCenter;
  const report = center.primaryReadReport;
  const requirements = center.requirements || {};
  const evidenceCount = [requirements.cutoverApproval, requirements.backupEvidence, requirements.recoveryEvidence].filter(Boolean).length;
  const metrics = [
    ["主读取配置", center.primaryReadConfigured ? "已就绪" : "未配置", "REPEATABLE READ / READ ONLY"],
    ["最近演练", report?.status || "尚未运行", report ? `${report.collections || 0} collections / ${report.durationMs || 0} ms` : "全量摘要与 SQLite 基线核对"],
    ["写入证据门禁", center.writeEnabled ? "已满足" : `${evidenceCount}/3`, center.writeMode || "disabled"],
    ["生产主库", center.productionPrimary ? "已切换" : "未切换", "runtimeCutoverEnabled=false"]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  if (adapterStatusTarget) {
    adapterStatusTarget.textContent = center.configured ? `${center.adapterMode} / ${center.writeMode}` : "未配置";
    adapterStatusTarget.className = `badge ${center.writeEnabled ? "ok" : center.configured ? "info" : "warn"}`;
  }
  if (primaryReadStatusTarget) {
    const status = report?.status || (center.primaryReadConfigured ? "可演练" : "等待配置");
    primaryReadStatusTarget.textContent = status;
    primaryReadStatusTarget.className = `badge ${report?.ok ? "ok" : center.primaryReadConfigured ? "info" : "warn"}`;
  }
}

function postgresReconciliationBadgeClass(status) {
  if (status === "matched" || status === "resolved") return "ok";
  if (status === "mismatched" || status === "error" || status === "reopened") return "danger";
  return "warn";
}

function renderPostgresReconciliationCenter() {
  const metricsTarget = document.querySelector("#postgres-reconciliation-metrics");
  const casesTarget = document.querySelector("#postgres-reconciliation-cases");
  const historyTarget = document.querySelector("#postgres-reconciliation-history");
  const statusTarget = document.querySelector("#postgres-reconciliation-status");
  if (!metricsTarget || !casesTarget || !historyTarget) return;
  const summary = postgresReconciliationCenter.summary || {};
  const historySummary = postgresReconciliationCenter.historySummary || {};
  const latestRun = postgresReconciliationCenter.runs?.[0] || null;
  const metrics = [
    ["未关闭工单", summary.unresolved || 0, `${summary.reopened || 0} 项重新打开`],
    ["已签收", summary.acknowledged || 0, `${summary.clearedAwaitingResolution || 0} 项可核验关闭`],
    ["最近核对", latestRun?.status || "never", latestRun?.checkedAt || "尚无运行记录"],
    ["核对历史", historySummary.runs || 0, `${historySummary.mismatched || 0} 次发现差异`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  if (statusTarget) {
    const status = latestRun?.status || (postgresReconciliationCenter.configured ? "never" : "disabled");
    statusTarget.textContent = status;
    statusTarget.className = `badge ${postgresReconciliationBadgeClass(status)}`;
  }
  const cases = postgresReconciliationCenter.cases || [];
  casesTarget.innerHTML = cases.length ? cases.map((item) => {
    const canAcknowledge = ["open", "reopened"].includes(item.status);
    const canResolve = item.status === "acknowledged" && item.clearedAt;
    const canReopen = item.status === "resolved";
    return `<article class="priority-row" data-postgres-reconciliation-case="${platformEscapeHtml(item.caseId)}">
      <div class="priority-rank ${postgresReconciliationBadgeClass(item.status)}">${platformEscapeHtml(item.severity || "high")}</div>
      <div>
        <h3>${platformEscapeHtml(item.collection || item.caseId)}</h3>
        <p>${platformEscapeHtml((item.differenceTypes || []).join(" / ") || "difference pending classification")}</p>
        <small>${platformEscapeHtml(item.owner || "未分派")} · ${platformEscapeHtml(item.occurrenceCount || 0)} 次 · ${platformEscapeHtml(item.updatedAt || "")}</small>
        <small>${item.clearedAt ? `核对清除：${platformEscapeHtml(item.clearedRunId || item.clearedAt)}` : "等待 matched 核对结果"}</small>
        <div class="action-row">
          <button class="inline-action" type="button" data-postgres-reconciliation-action="assign" data-id="${platformEscapeHtml(item.caseId)}">分派</button>
          ${canAcknowledge ? `<button class="inline-action" type="button" data-postgres-reconciliation-action="acknowledge" data-id="${platformEscapeHtml(item.caseId)}">签收</button>` : ""}
          ${canResolve ? `<button class="inline-action" type="button" data-postgres-reconciliation-action="resolve" data-id="${platformEscapeHtml(item.caseId)}">核验关闭</button>` : ""}
          ${canReopen ? `<button class="inline-action" type="button" data-postgres-reconciliation-action="reopen" data-id="${platformEscapeHtml(item.caseId)}">重新打开</button>` : ""}
          <button class="inline-action" type="button" data-postgres-reconciliation-action="comment" data-id="${platformEscapeHtml(item.caseId)}">备注</button>
        </div>
      </div>
      <div class="capability-side">
        <span class="badge ${postgresReconciliationBadgeClass(item.status)}">${platformEscapeHtml(item.status)}</span>
        <small>local v${platformEscapeHtml(item.localVersion ?? "-")}</small>
        <small>remote v${platformEscapeHtml(item.remoteVersion ?? "-")}</small>
      </div>
    </article>`;
  }).join("") : `<p class="muted">当前没有差异工单。</p>`;
  const runs = postgresReconciliationCenter.runs || [];
  historyTarget.innerHTML = runs.length ? runs.map((run) => `<article class="priority-row" data-postgres-reconciliation-run="${platformEscapeHtml(run.runId)}">
    <div class="priority-rank ${postgresReconciliationBadgeClass(run.status)}">${platformEscapeHtml(run.status)}</div>
    <div>
      <h3>${platformEscapeHtml(run.runId)}</h3>
      <p>${platformEscapeHtml(run.checkedAt || "")}</p>
      <small>matched ${platformEscapeHtml(run.summary?.matched || 0)} · mismatched ${platformEscapeHtml(run.summary?.mismatched || 0)} · ${platformEscapeHtml(run.durationMs || 0)} ms</small>
    </div>
  </article>`).join("") : `<p class="muted">当前没有核对运行记录。</p>`;
}

function buildCitizenOperationsOrderRows(state) {
  const sources = [
    ["预约挂号", state.registrationOrders],
    ["互联网护理", state.internetNursingOrders],
    ["助医陪诊", state.escortServiceOrders],
    ["家庭医生", state.phase2FamilyDoctorApplications]
  ];
  return sources.flatMap(([serviceType, rows]) => (Array.isArray(rows) ? rows : []).map((item) => ({
    id: item.id,
    serviceType,
    residentId: item.residentId || "",
    institutionCode: item.institutionCode || item.hospitalCode || item.reviewInstitutionCode || "",
    status: item.status || item.reviewStatus || "pending",
    paymentStatus: item.paymentStatus || item.settlement?.paymentStatus || "not-applicable",
    refundStatus: item.refundStatus || "none",
    createdAt: item.createdAt || item.requestedAt || item.applicationAt || ""
  })));
}

function citizenOperationsBadgeClass(status) {
  if (/approved|active-demo|published-demo|completed/i.test(String(status || ""))) return "ok";
  if (/reject|disabled|withdrawn/i.test(String(status || ""))) return "danger";
  return "warn";
}

function citizenOperationsStatusLabel(status) {
  return {
    "published-demo": "演示发布",
    "review-pending": "待内容复核",
    "active-demo": "演示生效",
    archived: "已归档",
    "pending-review": "待实名复核",
    "material-requested": "待补材料",
    "approved-demo": "演示通过",
    "rejected-demo": "已驳回",
    "under-review": "人工复核中",
    "lifted-demo": "演示解除",
    "onsite-confirmation-pending": "待现场确认",
    "disabled-demo": "演示停用",
    withdrawn: "已撤下"
  }[status] || status || "待确认";
}

function renderCitizenOperationsCenter(platform) {
  const metricsTarget = document.querySelector("#citizen-operations-metrics");
  const identityTarget = document.querySelector("#citizen-identity-review-queue");
  const hospitalTarget = document.querySelector("#citizen-hospital-service-configs");
  const governanceTarget = document.querySelector("#citizen-operations-governance");
  const ordersTarget = document.querySelector("#citizen-operations-orders");
  if (!metricsTarget || !identityTarget || !hospitalTarget || !governanceTarget || !ordersTarget) return;
  const contents = platform.citizenOperationContents || [];
  const agreements = platform.citizenAgreementVersions || [];
  const identityReviews = platform.citizenIdentityReviewCases || [];
  const blacklist = platform.citizenServiceBlacklist || [];
  const hospitals = platform.citizenHospitalServiceConfigs || [];
  const orders = platform.citizenOperationsOrders || [];
  const publishedContents = contents.filter((item) => item.status === "published-demo").length;
  const activeAgreements = agreements.filter((item) => item.status === "active-demo").length;
  const pendingIdentity = identityReviews.filter((item) => /pending|material-requested/i.test(item.status)).length;
  const activeBlacklist = blacklist.filter((item) => item.status === "active-demo").length;
  const enabledHospitals = hospitals.filter((item) => item.status === "active-demo").length;
  const openOrders = orders.filter((item) => !/completed|closed|cancelled|canceled|refunded|rejected/i.test(item.status)).length;
  const metrics = [
    ["已发布内容", publishedContents, `${contents.length} 条运营内容`],
    ["有效协议", activeAgreements, `${agreements.length} 个版本`],
    ["实名待复核", pendingIdentity, `${identityReviews.length} 个案例`],
    ["生效黑名单", activeBlacklist, `${blacklist.length} 条规则记录`],
    ["演示开通机构", enabledHospitals, "生产开通 0"],
    ["跨服务订单", orders.length, `${openOrders} 条处理中`]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  identityTarget.innerHTML = identityReviews.map((item, index) => `<article class="priority-row" data-citizen-identity-review="${platformEscapeHtml(item.id)}">
    <div class="priority-rank ${citizenOperationsBadgeClass(item.status)}">${index + 1}</div>
    <div>
      <h3>${platformEscapeHtml(item.residentName || item.residentId)}</h3>
      <p>${platformEscapeHtml((item.submittedEvidence || []).join(" / "))}</p>
      <small>${platformEscapeHtml(item.decisionNote || "等待人工复核说明")}</small>
      <div class="action-row">
        <button class="inline-action" type="button" data-citizen-operations-action="approve" data-resource="identity-reviews" data-id="${platformEscapeHtml(item.id)}">演示通过</button>
        <button class="inline-action" type="button" data-citizen-operations-action="request-material" data-resource="identity-reviews" data-id="${platformEscapeHtml(item.id)}">补充材料</button>
        <button class="inline-action" type="button" data-citizen-operations-action="reject" data-resource="identity-reviews" data-id="${platformEscapeHtml(item.id)}">驳回</button>
      </div>
    </div>
    <div class="capability-side">
      <span class="badge ${citizenOperationsBadgeClass(item.status)}">${platformEscapeHtml(citizenOperationsStatusLabel(item.status))}</span>
      <small>${platformEscapeHtml(item.riskLevel || "low")} risk</small>
    </div>
  </article>`).join("");
  hospitalTarget.innerHTML = hospitals.map((item, index) => `<article class="priority-row" data-citizen-hospital-service="${platformEscapeHtml(item.id)}">
    <div class="priority-rank ${citizenOperationsBadgeClass(item.status)}">${index + 1}</div>
    <div>
      <h3>${platformEscapeHtml(item.institutionName)}</h3>
      <p>${platformEscapeHtml((item.enabledServices || []).join(" / "))}</p>
      <small>${platformEscapeHtml(item.onsiteBlocker || "生产参数待现场确认")}</small>
      <div class="action-row">
        <button class="inline-action" type="button" data-citizen-operations-action="enable-demo" data-resource="hospitals" data-id="${platformEscapeHtml(item.id)}">演示开通</button>
        <button class="inline-action" type="button" data-citizen-operations-action="request-onsite" data-resource="hospitals" data-id="${platformEscapeHtml(item.id)}">转现场确认</button>
        <button class="inline-action" type="button" data-citizen-operations-action="disable-demo" data-resource="hospitals" data-id="${platformEscapeHtml(item.id)}">停用</button>
      </div>
    </div>
    <div class="capability-side">
      <span class="badge ${citizenOperationsBadgeClass(item.status)}">${platformEscapeHtml(citizenOperationsStatusLabel(item.status))}</span>
      <small>生产：否</small>
    </div>
  </article>`).join("");
  const governanceRows = [
    ...contents.map((item) => ({
      type: "内容",
      id: item.id,
      name: item.title,
      version: item.type,
      owner: item.owner,
      status: item.status,
      action: item.status === "published-demo" ? "withdraw" : "publish",
      actionLabel: item.status === "published-demo" ? "撤下" : "演示发布",
      resource: "contents"
    })),
    ...agreements.map((item) => ({ type: "协议", id: item.id, name: item.name, version: item.version, owner: item.legalReviewStatus, status: item.status })),
    ...blacklist.map((item) => ({
      type: "黑名单",
      id: item.id,
      name: item.subjectName,
      version: item.subjectType,
      owner: item.reason,
      status: item.status,
      action: item.status === "active-demo" ? "lift" : "activate",
      actionLabel: item.status === "active-demo" ? "解除" : "演示生效",
      resource: "blacklist"
    }))
  ];
  governanceTarget.innerHTML = `<table>
    <thead><tr><th>类型</th><th>名称</th><th>版本/对象</th><th>责任与说明</th><th>状态</th><th>操作</th></tr></thead>
    <tbody>${governanceRows.map((item) => `<tr>
      <td>${platformEscapeHtml(item.type)}</td>
      <td><strong>${platformEscapeHtml(item.name)}</strong></td>
      <td>${platformEscapeHtml(item.version)}</td>
      <td>${platformEscapeHtml(item.owner || "")}</td>
      <td><span class="badge ${citizenOperationsBadgeClass(item.status)}">${platformEscapeHtml(citizenOperationsStatusLabel(item.status))}</span></td>
      <td>${item.action ? `<button class="inline-action" type="button" data-citizen-operations-action="${item.action}" data-resource="${item.resource}" data-id="${platformEscapeHtml(item.id)}">${item.actionLabel}</button>` : "现场法务复核"}</td>
    </tr>`).join("")}</tbody>
  </table>`;
  ordersTarget.innerHTML = `<table>
    <thead><tr><th>服务</th><th>订单</th><th>居民</th><th>机构</th><th>业务状态</th><th>支付</th><th>退费</th></tr></thead>
    <tbody>${orders.slice(0, 20).map((item) => `<tr>
      <td>${platformEscapeHtml(item.serviceType)}</td>
      <td><strong>${platformEscapeHtml(item.id)}</strong></td>
      <td>${platformEscapeHtml(item.residentId || "-")}</td>
      <td>${platformEscapeHtml(item.institutionCode || "-")}</td>
      <td>${platformEscapeHtml(item.status)}</td>
      <td>${platformEscapeHtml(item.paymentStatus)}</td>
      <td>${platformEscapeHtml(item.refundStatus)}</td>
    </tr>`).join("") || `<tr><td colspan="7">暂无服务订单。</td></tr>`}</tbody>
  </table>`;
  const statusTarget = document.querySelector("#citizen-operations-status");
  if (statusTarget) {
    statusTarget.textContent = "运营 MVP，待现场联调";
    statusTarget.className = "badge warn";
  }
  const boundaryTarget = document.querySelector("#citizen-operations-boundary");
  if (boundaryTarget) boundaryTarget.textContent = "演示发布、复核和机构开通不产生生产授权。正式上线仍需政务实名、医院号源与支付退费回调、法务审定协议以及医院服务开通和黑名单制度签字。";
}

function commercialCryptoBadgeClass(status) {
  if (/runtime-probe-recorded|evidence-recorded/i.test(String(status || ""))) return "info";
  if (/onsite-requested/i.test(String(status || ""))) return "warn";
  return "warn";
}

function commercialCryptoStatusLabel(status) {
  return {
    "contract-ready": "适配合同已建档",
    "runtime-probe-recorded": "运行时自检已留痕",
    "evidence-recorded": "证据已登记",
    "onsite-requested": "已申请现场验证"
  }[status] || status || "待建档";
}

function renderCommercialCryptoCenter(platform) {
  const metricsTarget = document.querySelector("#commercial-crypto-metrics");
  const runtimeTarget = document.querySelector("#commercial-crypto-runtime");
  const capabilityTarget = document.querySelector("#commercial-crypto-capabilities");
  const evidenceTarget = document.querySelector("#commercial-crypto-evidence");
  if (!metricsTarget || !runtimeTarget || !capabilityTarget || !evidenceTarget) return;
  const capabilities = platform.commercialCryptoCapabilities || [];
  const probeRuns = platform.commercialCryptoProbeRuns || [];
  const evidencePackets = platform.commercialCryptoEvidencePackets || [];
  const runtimeProbe = platform.commercialCryptoRuntimeProbe;
  const primitiveRows = runtimeProbe?.primitives || probeRuns[0]?.primitives || [];
  const availableCount = primitiveRows.filter((item) => item.available).length;
  const onsiteRequested = capabilities.filter((item) => item.onsiteVerification === "requested").length;
  const metrics = [
    ["能力合同", capabilities.length, "覆盖传输、签名、加密、审计、身份与终端"],
    ["运行时算法", `${availableCount}/3`, "仅代表本机兼容性"],
    ["自检记录", probeRuns.length, "不等同检测认证"],
    ["证据包", evidencePackets.length, "均待现场复核"],
    ["现场申请", onsiteRequested, "设备与证书验证"],
    ["生产就绪", 0, "密评报告前保持阻断"]
  ];
  metricsTarget.innerHTML = metrics.map(([label, value, hint]) => `<article class="metric-card">
    <span>${platformEscapeHtml(label)}</span>
    <strong>${platformEscapeHtml(value)}</strong>
    <small>${platformEscapeHtml(hint)}</small>
  </article>`).join("");
  runtimeTarget.innerHTML = primitiveRows.length ? `<table>
    <thead><tr><th>算法</th><th>运行时可用</th><th>自检</th><th>证据</th></tr></thead>
    <tbody>${primitiveRows.map((item) => `<tr>
      <td><strong>${platformEscapeHtml(item.id)}</strong></td>
      <td><span class="badge ${item.available ? "info" : "warn"}">${item.available ? "可用" : "未发现"}</span></td>
      <td>${item.selfTestPassed ? "通过" : "未通过/未执行"}</td>
      <td>${platformEscapeHtml(item.evidence || "-")}</td>
    </tr>`).join("")}</tbody>
  </table>` : `<p class="implementation-boundary">尚无运行时自检记录。可从任一能力执行“运行时自检”；结果仅作为适配兼容性证据。</p>`;
  capabilityTarget.innerHTML = capabilities.map((item, index) => `<article class="priority-row" data-commercial-crypto-capability="${platformEscapeHtml(item.id)}">
    <div class="priority-rank ${commercialCryptoBadgeClass(item.status)}">${index + 1}</div>
    <div>
      <h3>${platformEscapeHtml(item.name)}</h3>
      <p>${platformEscapeHtml(item.adapterKind)} · ${platformEscapeHtml((item.requiredPrimitives || []).join(" / "))}</p>
      <small>${platformEscapeHtml((item.blockers || []).join("；") || "等待现场设备与证书验证")}</small>
      <div class="action-row">
        <button class="inline-action" type="button" data-commercial-crypto-action="run-runtime-probe" data-id="${platformEscapeHtml(item.id)}">运行时自检</button>
        <button class="inline-action" type="button" data-commercial-crypto-action="record-evidence" data-id="${platformEscapeHtml(item.id)}">登记证据</button>
        <button class="inline-action" type="button" data-commercial-crypto-action="request-onsite" data-id="${platformEscapeHtml(item.id)}">申请现场验证</button>
      </div>
    </div>
    <div class="capability-side">
      <span class="badge ${commercialCryptoBadgeClass(item.status)}">${platformEscapeHtml(commercialCryptoStatusLabel(item.status))}</span>
      <small>生产：否</small>
    </div>
  </article>`).join("");
  evidenceTarget.innerHTML = `<table>
    <thead><tr><th>能力</th><th>类型</th><th>证据引用</th><th>状态</th><th>生产证据</th></tr></thead>
    <tbody>${evidencePackets.slice(0, 12).map((item) => `<tr>
      <td>${platformEscapeHtml(item.capabilityId || "all")}</td>
      <td>${platformEscapeHtml(item.type)}</td>
      <td><strong>${platformEscapeHtml(item.reference)}</strong><br><small>${platformEscapeHtml(item.note || "")}</small></td>
      <td>${platformEscapeHtml(item.status)}</td>
      <td>否</td>
    </tr>`).join("") || `<tr><td colspan="5">暂无证据包。</td></tr>`}</tbody>
  </table>`;
  const statusTarget = document.querySelector("#commercial-crypto-status");
  if (statusTarget) {
    statusTarget.textContent = "适配中心已就绪，采购与密评受阻";
    statusTarget.className = "badge warn";
  }
  const boundaryTarget = document.querySelector("#commercial-crypto-boundary");
  if (boundaryTarget) boundaryTarget.textContent = "本页只证明适配合同、运行时兼容性探测和证据流程可执行。正式启用仍需通过检测的商用密码产品、生产证书与密钥管理、现场验证、第三方密评报告和整改签字。";
}

function renderResearchGovernance(platform, sandboxSummary = researchSandboxSummary) {
  const datasets = Array.isArray(platform?.researchDatasets) ? platform.researchDatasets : [];
  const models = Array.isArray(platform?.diseaseRegistryModels) ? platform.diseaseRegistryModels : [];
  const summary = sandboxSummary?.summary || {};
  const compliantExports = Array.isArray(sandboxSummary?.recentExports) ? sandboxSummary.recentExports : [];
  const activeSandboxCount = summary.activeDatasets ?? datasets.filter((item) => item.sandbox?.status === "active").length;
  const pendingApplications = summary.pendingApplications ?? datasets.filter((item) => item.status === "requested" || item.authorizationStatus === "pending").length;
  const exportCount = summary.compliantExports ?? compliantExports.length;
  const usageAuditCount = summary.usageAudits ?? datasets.reduce((total, item) => total + (item.usageAudit || []).length, 0);
  const outcomeCount = summary.outcomes ?? datasets.reduce((total, item) => total + (item.outcomes || []).length, 0);
  const boundaries = Array.isArray(sandboxSummary?.boundaries) ? sandboxSummary.boundaries : ["research dataset", "disease registry", "ethics approval", "de-identification release", "policy controls", "sandbox access", "compliant data export", "usage audit", "outcome return"];
  const reusableCollections = Array.isArray(sandboxSummary?.reusableCollections) ? sandboxSummary.reusableCollections : ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"];
  const statusState = sandboxSummary?.ok ? "ok" : "warn";
  const statusText = sandboxSummary ? (sandboxSummary.ok ? "Research governance evidence is ready." : "Research governance evidence needs review.") : "Loading research governance evidence.";
  const datasetRows = datasets.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${item.diseaseType}</td>
      <td>${item.version}</td>
      <td>${item.ethicsApproval || "待登记"}</td>
      <td>${item.anonymization || "待登记"} / ${item.deidentificationStatus || "pending"}</td>
      <td>${researchEvidenceSummary(item)}</td>
      <td>${statusBadge(item.authorizationStatus || item.status)} ${statusBadge(item.sandbox?.status || "pending")}</td>
      <td>${item.records || 0}</td>
      <td>${(item.usageAudit || []).length} / ${(item.outcomes || []).length}</td>
      <td>
        <button class="inline-action" type="button" data-research-action="sandbox-access" data-id="${item.id}">沙箱访问</button>
        <button class="inline-action" type="button" data-research-action="compliant-export" data-id="${item.id}">合规出口</button>
        <button class="inline-action" type="button" data-research-action="outcome-return" data-id="${item.id}">成果回流</button>
        <button class="inline-action" type="button" data-research-action="approve" data-id="${item.id}">审批发布</button>
        <button class="inline-action" type="button" data-research-evidence="${item.id}">登记材料</button>
      </td>
    </tr>
  `).join("");
  const modelRows = models.map((item) => `
    <tr>
      <td><strong>${item.id}</strong></td>
      <td>${item.diseaseType}</td>
      <td>${item.version}</td>
      <td>${item.population}</td>
      <td>${item.threshold}</td>
      <td>${statusBadge(item.reviewStatus)}</td>
      <td>${(item.outputs || []).join("、")}</td>
      <td>${item.reviewedBy || item.reviewer || "待复核"}</td>
    </tr>
  `).join("");
  const pendingRows = researchPendingRows(sandboxSummary?.pendingApplications, datasets);
  const auditRows = researchAuditRows(sandboxSummary?.recentAudits, datasets);
  const outcomeRows = researchOutcomeRows(sandboxSummary?.recentOutcomes, datasets);
  const exportRows = researchCompliantExportRows(compliantExports);
  document.querySelector("#research-governance").innerHTML = `
    <div class="research-sandbox-summary">
      <div><strong>${datasets.length}</strong><span>数据集</span></div>
      <div><strong>${activeSandboxCount}</strong><span>已开放沙箱</span></div>
      <div><strong>${pendingApplications}</strong><span>待审批申请</span></div>
      <div><strong>${models.length}</strong><span>专病模型</span></div>
      <div><strong>${exportCount}</strong><span>合规出口</span></div>
      <div><strong>${usageAuditCount} / ${outcomeCount}</strong><span>审计 / 成果</span></div>
    </div>
    <form class="research-application-form" id="research-application-form">
      <label>
        病种
        <input name="diseaseType" value="copd" required />
      </label>
      <label>
        数据集名称
        <input name="name" value="COPD pulmonary rehabilitation cohort" required />
      </label>
      <label>
        研究目的
        <input name="purpose" value="sandbox feasibility assessment" required />
      </label>
      <label>
        数据使用协议
        <input name="dataUseAgreement" value="DUA-DEMO-COPD-2026" required />
      </label>
      <label>
        审计留存天数
        <input name="retentionDays" type="number" min="1" max="3650" value="180" required />
      </label>
      <label class="checkbox-label">
        <input name="minimumNecessary" type="checkbox" checked />
        最小必要字段
      </label>
      <label class="checkbox-label">
        <input name="reidentificationProhibited" type="checkbox" checked />
        禁止再识别
      </label>
      <label>
        来源集合
        <select name="sourceProfile">
          <option value="clinical">personalRecords + diagnosticReports</option>
          <option value="chronic">personalRecords + diagnosticReports + chronicManagementPlans</option>
          <option value="followup">personalRecords + diagnosticReports + followups</option>
        </select>
      </label>
      <button class="inline-action" type="submit">提交申请</button>
    </form>
    <p class="research-status" id="research-status" role="status" data-state="${statusState}">${statusText}</p>
    <div class="research-governance-board">
      <article>
        <h3>边界与复用集合</h3>
        <div class="research-pill-list research-boundary-list">
          ${boundaries.map((item) => `<span class="badge info">${researchBoundaryLabel(item)}</span>`).join("")}
        </div>
        <div class="research-pill-list research-reuse-list">
          ${reusableCollections.map((item) => `<span>${item}</span>`).join("")}
        </div>
      </article>
      <article>
        <h3>审批队列</h3>
        <ul class="research-queue">${pendingRows}</ul>
      </article>
      <article>
        <h3>合规数据出口</h3>
        <ul class="research-audit-feed">${exportRows}</ul>
      </article>
      <article>
        <h3>审计与成果回流</h3>
        <ul class="research-audit-feed">${auditRows}${outcomeRows}</ul>
      </article>
    </div>
    <table>
      <thead><tr><th>数据集</th><th>病种</th><th>版本</th><th>伦理审批</th><th>脱敏</th><th>协议/留存/材料</th><th>授权/沙箱</th><th>记录数</th><th>审计/成果</th><th>Action</th></tr></thead>
      <tbody>${datasetRows || `<tr><td colspan="10">暂无科研数据集。</td></tr>`}</tbody>
    </table>
    <table>
      <thead><tr><th>模型</th><th>病种</th><th>版本</th><th>适用人群</th><th>触发阈值</th><th>复核状态</th><th>输出</th><th>复核人</th></tr></thead>
      <tbody>${modelRows || `<tr><td colspan="8">暂无专病库模型。</td></tr>`}</tbody>
    </table>
  `;
}

function researchEvidenceSummary(dataset) {
  const documents = Array.isArray(dataset.evidenceDocuments) ? dataset.evidenceDocuments : [];
  const required = ["ethics-approval", "data-use-agreement"];
  const ready = required.every((type) => documents.some((item) => item.type === type && item.status !== "rejected"));
  const latest = documents[0];
  const latestText = latest ? `${latest.type}:${latest.referenceNo || latest.title || "registered"}` : "no evidence";
  return [
    `<span>${dataset.governance?.dataUseAgreement || "pending"} / ${dataset.governance?.retentionDays || 0}d</span>`,
    `<span class="badge ${ready ? "info" : "warn"}">${ready ? "evidence-ready" : "evidence-pending"} / ${documents.length} docs</span>`,
    `<small>${latestText}</small>`
  ].join(" ");
}

function researchBoundaryLabel(value) {
  if (value === "policy controls") return "协议与最小必要";
  return {
    "research dataset": "科研数据集",
    "disease registry": "专病库",
    "ethics approval": "伦理审批",
    "de-identification release": "脱敏发布",
    "sandbox access": "沙箱访问",
    "compliant data export": "合规数据出口",
    "usage audit": "使用审计",
    "outcome return": "成果回流"
  }[value] || value;
}

function researchPendingRows(pendingApplications, datasets) {
  const rows = Array.isArray(pendingApplications) && pendingApplications.length
    ? pendingApplications
    : datasets
      .filter((item) => item.status === "requested" || item.authorizationStatus === "pending")
      .map((item) => ({
        id: item.id,
        diseaseType: item.diseaseType,
        name: item.name,
        requestedBy: item.createdBy || item.accessRequests?.[0]?.by || "",
        requestedAt: item.createdAt || item.accessRequests?.[0]?.at || "",
        purpose: item.accessRequests?.[0]?.purpose || "",
        ethicsStatus: item.ethicsStatus || "pending",
        deidentificationStatus: item.deidentificationStatus || "pending"
      }));
  if (!rows.length) return `<li><strong>暂无待审批申请</strong><span>当前数据集均已完成伦理、脱敏和授权闭环。</span></li>`;
  return rows.slice(0, 4).map((item) => `
    <li>
      <strong>${item.name || item.id}</strong>
      <span>${item.diseaseType || "未标注病种"} / ${item.ethicsStatus || "pending"} / ${item.deidentificationStatus || "pending"}</span>
      <small>${item.requestedBy || "申请方待确认"} ${formatResearchTime(item.requestedAt)} ${item.purpose || ""}</small>
    </li>
  `).join("");
}

function researchAuditRows(recentAudits, datasets) {
  const rows = Array.isArray(recentAudits) && recentAudits.length
    ? recentAudits
    : datasets.flatMap((item) => (Array.isArray(item.usageAudit) ? item.usageAudit : []).map((audit) => ({
      at: audit.at,
      actor: audit.by,
      role: audit.role,
      action: audit.action || "usage-audit",
      target: `${item.id}:${audit.purpose || ""}`,
      result: audit.result || "allowed"
    })));
  if (!rows.length) return `<li><strong>暂无实时审计</strong><span>沙箱申请、拒绝、访问和成果回流会写入审计。</span></li>`;
  return rows.slice(0, 4).map((item) => `
    <li>
      <strong>${item.action || "research-sandbox"} / ${item.result || "allowed"}</strong>
      <span>${item.actor || "system"} ${item.role ? `(${item.role})` : ""}</span>
      <small>${formatResearchTime(item.at)} ${item.target || ""}</small>
    </li>
  `).join("");
}

function researchOutcomeRows(recentOutcomes, datasets) {
  const rows = Array.isArray(recentOutcomes) && recentOutcomes.length
    ? recentOutcomes
    : datasets.flatMap((item) => (Array.isArray(item.outcomes) ? item.outcomes : []).map((outcome) => ({
      datasetId: item.id,
      datasetName: item.name,
      at: outcome.at,
      by: outcome.by,
      title: outcome.title,
      registryImpact: outcome.registryImpact
    })));
  return rows.slice(0, 2).map((item) => `
    <li>
      <strong>成果回流 / ${item.datasetName || item.datasetId || "dataset"}</strong>
      <span>${item.title || "research outcome"}</span>
      <small>${formatResearchTime(item.at)} ${item.registryImpact || ""}</small>
    </li>
  `).join("");
}

function researchCompliantExportRows(recentExports) {
  const rows = Array.isArray(recentExports) ? recentExports : [];
  if (!rows.length) return `<li><strong>暂无合规出口</strong><span>合规出口需先完成伦理、脱敏、授权、最小必要和审计留痕。</span></li>`;
  return rows.slice(0, 4).map((item) => `
    <li>
      <strong>${item.datasetName || item.datasetId || "dataset"} / ${item.exportStatus || "pending"}</strong>
      <span>${item.purpose || "approved export"} -> ${item.destination || "destination pending"}</span>
      <small>${formatResearchTime(item.requestedAt)} ${(item.requestedFields || []).join(", ")} ${item.watermark || ""}</small>
    </li>
  `).join("");
}

function formatResearchTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN", { hour12: false });
}

function renderMobileAccessibilityGovernance(platform) {
  const settings = platform.mobileExperienceSettings || {};
  const checklist = platform.accessibilityChecklist || [];
  const passed = checklist.filter((item) => item.status === "passed").length;
  document.querySelector("#mobile-accessibility-governance").innerHTML = [
    ["弱网策略", settings.weakNetworkMode || "待配置"],
    ["读屏地标", (settings.screenReaderLandmarks || []).join("、") || "待配置"],
    ["线下帮办渠道", (settings.offlineHelpChannels || []).join("、") || "待配置"],
    ["消息触达", (settings.messageTouchpoints || []).join("、") || "待配置"],
    ["验收通过", `${passed}/${checklist.length} 项`]
  ].map(([label, detail]) => `<div><strong>${label}</strong><span>${detail}</span></div>`).join("") + checklist.map((item) => `
    <div>
      <strong>${item.item}</strong>
      <span>${item.category} · ${statusBadge(item.status)}</span>
      <span>${item.evidence || "待补证据"}</span>
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
      <div class="evidence-records">
        ${renderEvidenceRecords(item.records)}
      </div>
      <footer>
        <strong>${item.owner}</strong>
        <small>${item.next}</small>
        <button class="inline-action" type="button" data-edit-evidence="${item.id}">登记证据</button>
      </footer>
    </article>
  `).join("") || `<div class="muted">暂无验收证据。</div>`;
}

function renderEvidenceRecords(records) {
  const latest = (Array.isArray(records) ? records : []).slice(0, 2);
  if (!latest.length) return `<p class="muted">暂无文件、截图或测试记录。</p>`;
  return latest.map((record) => `
    <p>
      <strong>${record.fileName || "未命名材料"}</strong>
      <span>${record.at || ""} · ${record.status || "待确认"}</span>
      <small>${record.testRecord || record.link || ""}</small>
    </p>
  `).join("");
}

function statusBadge(status) {
  const value = status || "待确认";
  const cls = value.includes("待") ? "warn" : value.includes("完成") || value.includes("已") ? "info" : "";
  return `<span class="badge ${cls}">${platformEscapeHtml(value)}</span>`;
}

function listText(value) {
  return Array.isArray(value)
    ? value.map((item) => platformEscapeHtml(item)).join("、")
    : platformEscapeHtml(value || "");
}

function bindPlatformEditor() {
  document.addEventListener("submit", async (event) => {
    if (event.target?.id === "research-application-form") {
      event.preventDefault();
      await submitResearchDatasetApplication(event.target);
    }
  });

  document.addEventListener("click", (event) => {
    const financialReconciliationOpen = event.target.closest("[data-financial-reconciliation-open]");
    if (financialReconciliationOpen) {
      const dialog = document.querySelector("#financial-reconciliation-dialog");
      const dateInput = dialog?.querySelector('[name="businessDate"]');
      if (dateInput && !dateInput.value) dateInput.value = new Date().toISOString().slice(0, 10);
      dialog?.showModal();
      return;
    }
    const platformBlockerButton = event.target.closest("[data-platform-blocker-action]");
    if (platformBlockerButton) {
      runPlatformProductionBlockerAction(platformBlockerButton.dataset.platformBlockerAction, platformBlockerButton.dataset.id, platformBlockerButton);
      return;
    }
    const platformCapabilityButton = event.target.closest("[data-platform-capability-action]");
    if (platformCapabilityButton) {
      runPlatformCapabilityReviewAction(platformCapabilityButton.dataset.platformCapabilityAction, platformCapabilityButton.dataset.id, platformCapabilityButton);
      return;
    }
    const postgresReconciliationButton = event.target.closest("[data-postgres-reconciliation-action]");
    if (postgresReconciliationButton) {
      runPostgresReconciliationCaseAction(postgresReconciliationButton.dataset.postgresReconciliationAction, postgresReconciliationButton.dataset.id, postgresReconciliationButton);
      return;
    }
    const identityDirectoryButton = event.target.closest("[data-identity-directory-action]");
    if (identityDirectoryButton) {
      runIdentityDirectoryAction(identityDirectoryButton.dataset.identityDirectoryAction, identityDirectoryButton);
      return;
    }
    const sessionCleanupButton = event.target.closest("[data-session-cleanup-action]");
    if (sessionCleanupButton) {
      runSessionCleanupAction(sessionCleanupButton);
      return;
    }
    const identityBindingButton = event.target.closest("[data-identity-binding-action]");
    if (identityBindingButton) {
      runIdentityBindingAction(identityBindingButton);
      return;
    }
    const postgresPrimaryReadButton = event.target.closest("[data-postgres-primary-read-action]");
    if (postgresPrimaryReadButton) {
      runPostgresPrimaryReadRehearsal(postgresPrimaryReadButton);
      return;
    }
    const commercialCryptoButton = event.target.closest("[data-commercial-crypto-action]");
    if (commercialCryptoButton) {
      runCommercialCryptoAction(commercialCryptoButton.dataset.commercialCryptoAction, commercialCryptoButton.dataset.id, commercialCryptoButton);
      return;
    }
    const citizenOperationsButton = event.target.closest("[data-citizen-operations-action]");
    if (citizenOperationsButton) {
      runCitizenOperationsAction(
        citizenOperationsButton.dataset.resource,
        citizenOperationsButton.dataset.citizenOperationsAction,
        citizenOperationsButton.dataset.id,
        citizenOperationsButton
      );
      return;
    }
    const productionDatabaseButton = event.target.closest("[data-production-db-action]");
    if (productionDatabaseButton) {
      runProductionDatabaseCutoverAction(productionDatabaseButton.dataset.productionDbAction, productionDatabaseButton.dataset.id, productionDatabaseButton);
      return;
    }
    const editButton = event.target.closest("[data-edit-platform]");
    if (editButton) {
      openPlatformEditor(editButton.dataset.editPlatform, editButton.dataset.id);
      return;
    }
    const evidenceButton = event.target.closest("[data-edit-evidence]");
    if (evidenceButton) {
      openEvidenceEditor(evidenceButton.dataset.editEvidence);
      return;
    }
    const researchEvidenceButton = event.target.closest("[data-research-evidence]");
    if (researchEvidenceButton) {
      openResearchEvidenceEditor(researchEvidenceButton.dataset.researchEvidence);
      return;
    }
    const researchButton = event.target.closest("[data-research-action]");
    if (researchButton) {
      runResearchDatasetAction(researchButton.dataset.researchAction, researchButton.dataset.id);
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
    else if ("nextAction" in item) item.nextAction = data.next.trim();
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

  document.querySelector("#evidence-edit-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    const item = findEvidenceItem(data.id);
    if (!item) return;
    const before = summarizeEvidenceItem(item);
    item.status = data.status.trim();
    item.owner = data.owner.trim();
    item.next = data.next.trim();
    item.records = [
      {
        id: crypto.randomUUID ? crypto.randomUUID() : `evr-${Date.now()}`,
        at: new Date().toLocaleString("zh-CN", { hour12: false }),
        fileName: data.fileName.trim(),
        link: data.link.trim(),
        testRecord: data.testRecord.trim(),
        status: item.status,
        owner: item.owner
      },
      ...(Array.isArray(item.records) ? item.records : [])
    ].filter((record) => record.fileName || record.link || record.testRecord).slice(0, 20);
    const after = summarizeEvidenceItem(item);
    if (before !== after) appendPlatformChangeLog("platformEvidence", item, before, after);
    await savePlatformState();
    form.closest("dialog").close();
    renderPlatform();
  });

  document.querySelector("#financial-reconciliation-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form));
    const statusTarget = document.querySelector("#financial-gateway-operations-status");
    const submitButton = form.querySelector('[value="save"]');
    if (submitButton) submitButton.disabled = true;
    if (statusTarget) {
      statusTarget.textContent = "正在核对";
      statusTarget.className = "badge warn";
    }
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${PLATFORM_API_BASE}/financial-gateways/reconciliation-runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gatewayType: values.gatewayType,
          businessDate: values.businessDate,
          providerSummary: {
            total: Number(values.total),
            succeeded: Number(values.succeeded),
            exceptions: Number(values.exceptions),
            grossAmountFen: Number(values.grossAmountFen),
            statementDigest: values.statementDigest.trim()
          }
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
      await loadFinancialGatewayOperationsCenter();
      renderFinancialGatewayOperationsCenter();
      form.closest("dialog")?.close();
      form.reset();
    } catch (error) {
      if (statusTarget) {
        statusTarget.textContent = error.message || "对账登记失败";
        statusTarget.className = "badge danger";
      }
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });

  document.querySelector("#export-platform-report")?.addEventListener("click", exportPlatformReport);
  document.querySelector("#export-platform-capability-map")?.addEventListener("click", exportPlatformCapabilityMap);
  document.querySelector("#export-platform-go-live-slices")?.addEventListener("click", exportPlatformGoLiveSlices);
  document.querySelector("#export-platform-standards-ledgers")?.addEventListener("click", exportPlatformStandardsLedgers);
  document.querySelector("#platform-standards-ledger-filters")?.addEventListener("submit", (event) => {
    event.preventDefault();
    loadPlatformStandardsLedgerDetail();
  });
  document.querySelector("#platform-standards-ledger-select")?.addEventListener("change", () => {
    const status = document.querySelector("#platform-standards-ledger-row-status");
    const collection = document.querySelector("#platform-standards-ledger-collection");
    if (status) status.value = "";
    if (collection) collection.value = "";
    loadPlatformStandardsLedgerDetail();
  });
  document.querySelector("#export-platform-standards-ledger-detail")?.addEventListener("click", exportPlatformStandardsLedgerDetail);
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

async function loadPlatformCapabilityMap() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/capability-map`);
    if (!response.ok) return;
    platformCapabilityMap = await response.json();
  } catch (error) {
    platformCapabilityMap = null;
  }
}

async function loadPlatformGoLiveSlices() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/go-live-slices`);
    if (!response.ok) return;
    platformGoLiveSlices = await response.json();
  } catch (error) {
    platformGoLiveSlices = null;
  }
}

async function loadPlatformStandardsLedgers() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/standards-ledgers`);
    if (!response.ok) return;
    platformStandardsLedgers = await response.json();
    populatePlatformStandardsLedgerSelect();
    await loadPlatformStandardsLedgerDetail();
  } catch (error) {
    platformStandardsLedgers = null;
  }
}

async function loadPlatformCapabilityOperationsCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/capability-operations`);
    if (!response.ok) return;
    const payload = await response.json();
    platformCapabilityOperationsCenter = payload.center || platformCapabilityOperationsCenter;
    platformState.platformCapabilityReviews = (payload.center?.capabilities || []).map((item) => item.review).filter(Boolean);
    platformState.platformProductionBlockerReviews = (payload.center?.productionBlockers || []).map((item) => item.review).filter(Boolean);
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function runPlatformCapabilityReviewAction(action, id, button) {
  if (!PLATFORM_API_BASE || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#platform-capability-operations-status");
  const capability = (platformCapabilityOperationsCenter.capabilities || []).find((item) => item.id === id);
  if (!capability) return;
  const payload = { action, note: "" };
  if (action === "assign") {
    payload.owner = await window.HealthStructuredDialog.prompt({ title: "分派能力域责任人", label: "责任人或责任组", defaultValue: capability.review?.owner || "", minLength: 2 });
    payload.owner ||= "";
    if (!payload.owner.trim()) return;
    payload.note = `能力域责任已分派给 ${payload.owner.trim()}。`;
  } else if (action === "record-evidence") {
    payload.evidenceRef = await window.HealthStructuredDialog.prompt({ title: "补录能力域证据", label: "证据文件、工单或验收记录引用", defaultValue: capability.sourceEvidence?.[0] || "", minLength: 3 });
    payload.evidenceRef ||= "";
    if (!payload.evidenceRef.trim()) return;
    payload.note = `补录能力域复核证据：${payload.evidenceRef.trim()}`;
  } else if (action === "review") {
    payload.evidenceRefs = capability.review?.evidenceRefs?.length ? [] : (capability.sourceEvidence || []).slice(0, 3);
    payload.note = "仓库实现、自动化检查和当前生产边界已完成生产前复核。";
  } else if (action === "request-improvement") {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "登记整改要求", label: "整改要求", defaultValue: "请补齐验收证据并完成责任人复核。", minLength: 4 });
    payload.note ||= "";
    if (!payload.note.trim()) return;
  } else {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "能力域复核", label: "复核备注", minLength: 4 });
    payload.note ||= "";
    if (!payload.note.trim()) return;
  }
  if (button) button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = "正在更新能力复核台账";
    statusTarget.className = "badge warn";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/capability-operations/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    platformCapabilityOperationsCenter = body.center || platformCapabilityOperationsCenter;
    platformState.platformCapabilityReviews = (body.center?.capabilities || []).map((item) => item.review).filter(Boolean);
    platformState.platformProductionBlockerReviews = (body.center?.productionBlockers || []).map((item) => item.review).filter(Boolean);
    renderPlatformCapabilityOperationsCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "能力复核操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runPlatformProductionBlockerAction(action, id, button) {
  if (!PLATFORM_API_BASE || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#platform-capability-operations-status");
  const blocker = (platformCapabilityOperationsCenter.productionBlockers || []).find((item) => item.id === id);
  if (!blocker) return;
  const payload = { action, note: "" };
  if (action === "assign") {
    payload.owner = await window.HealthStructuredDialog.prompt({ title: "分派生产阻断责任人", label: "责任人或责任组", defaultValue: blocker.review?.owner || blocker.owner || "", minLength: 2 });
    payload.owner ||= "";
    if (!payload.owner.trim()) return;
    payload.note = `生产阻断 ${id} 已分派给 ${payload.owner.trim()}。`;
  } else if (action === "record-evidence") {
    payload.evidenceRef = await window.HealthStructuredDialog.prompt({ title: "补录生产阻断证据", label: "证据文件、工单或验收记录引用", defaultValue: `ticket:${id}`, minLength: 3 });
    payload.evidenceRef ||= "";
    if (!payload.evidenceRef.trim()) return;
    payload.note = `补录生产阻断证据：${payload.evidenceRef.trim()}`;
  } else if (action === "start-remediation") {
    payload.note = `已启动 ${id} 整改并保留现场验收要求。`;
  } else if (action === "submit-evidence") {
    payload.note = `已提交 ${id} 当前证据，申请生产前证据复核。`;
  } else if (action === "review-evidence") {
    payload.note = `已复核 ${id} 当前证据；正式放行仍等待现场验收与签字。`;
  } else if (action === "record-site-acceptance") {
    payload.acceptanceId = await window.HealthStructuredDialog.prompt({ title: "登记现场验收", label: "已签字的现场验收编号", defaultValue: `site-signoff-${id}`, minLength: 4 });
    payload.acceptanceId ||= "";
    if (!payload.acceptanceId.trim()) return;
    const signerInput = await window.HealthStructuredDialog.prompt({ title: "登记四方签字人", label: "业务、信息、运维、安全签字人（逗号分隔）", helperText: "必须依次填写四名独立签字人。", minLength: 7 });
    const signerNames = (signerInput || "")
      .split(",").map((item) => item.trim()).filter(Boolean);
    if (signerNames.length !== 4) return;
    payload.signers = ["business", "information", "operations", "security"].map((role, index) => ({ role, name: signerNames[index] }));
    payload.note = `现场验收 ${payload.acceptanceId.trim()} 已登记到 ${id}。`;
  } else if (action === "revoke-site-acceptance") {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "撤销现场验收", label: "撤销原因", defaultValue: "现场证据发生变化，需要重新整改。", minLength: 4 });
    payload.note ||= "";
    if (!payload.note.trim()) return;
  } else if (action === "reopen") {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "重新启动整改", label: "重新整改原因", defaultValue: "现场条件或证据发生变化，需要重新整改。", minLength: 4 });
    payload.note ||= "";
    if (!payload.note.trim()) return;
  } else {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "生产阻断处置", label: "处置备注", minLength: 4 });
    payload.note ||= "";
    if (!payload.note.trim()) return;
  }
  if (button) button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = `正在更新 ${id} 处置台账`;
    statusTarget.className = "badge warn";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/capability-operations/blockers/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    platformCapabilityOperationsCenter = body.center || platformCapabilityOperationsCenter;
    platformState.platformProductionBlockerReviews = (body.center?.productionBlockers || []).map((item) => item.review).filter(Boolean);
    renderPlatformCapabilityOperationsCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "生产阻断处置失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function loadCommercialCryptoCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/commercial-crypto/center`);
    if (!response.ok) return;
    const payload = await response.json();
    const center = payload.center || {};
    platformState.commercialCryptoCapabilities = center.capabilities || platformState.commercialCryptoCapabilities || [];
    platformState.commercialCryptoProbeRuns = center.probeRuns || platformState.commercialCryptoProbeRuns || [];
    platformState.commercialCryptoEvidencePackets = center.evidencePackets || platformState.commercialCryptoEvidencePackets || [];
    platformState.commercialCryptoRuntimeProbe = center.runtimeProbe || null;
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function loadPostgresReconciliationCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const [casesResponse, historyResponse] = await Promise.all([
      request(`${PLATFORM_API_BASE}/production-database/reconciliation-cases?limit=20`),
      request(`${PLATFORM_API_BASE}/production-database/shadow-reconciliations?limit=10`)
    ]);
    if (!casesResponse.ok || !historyResponse.ok) return;
    const [casesPayload, historyPayload] = await Promise.all([casesResponse.json(), historyResponse.json()]);
    postgresReconciliationCenter = {
      configured: Boolean(casesPayload.configured || historyPayload.configured),
      productionPrimary: false,
      summary: casesPayload.summary || postgresReconciliationCenter.summary,
      cases: casesPayload.cases || [],
      historySummary: historyPayload.summary || postgresReconciliationCenter.historySummary,
      runs: historyPayload.runs || []
    };
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function loadPostgresProductionAdapterCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const [adapterResponse, primaryReadResponse] = await Promise.all([
      request(`${PLATFORM_API_BASE}/production-database/adapter`),
      request(`${PLATFORM_API_BASE}/production-database/primary-read-rehearsal`)
    ]);
    if (!adapterResponse.ok || !primaryReadResponse.ok) return;
    const [adapter, primaryRead] = await Promise.all([adapterResponse.json(), primaryReadResponse.json()]);
    postgresProductionAdapterCenter = {
      ...postgresProductionAdapterCenter,
      configured: Boolean(adapter.configured),
      adapterMode: adapter.adapterMode || "disabled",
      writeMode: adapter.writeMode || "disabled",
      writeEnabled: Boolean(adapter.writeEnabled),
      evidenceReady: Boolean(adapter.evidenceReady),
      requirements: adapter.requirements || {},
      capabilities: adapter.capabilities || {},
      productionPrimary: false,
      runtimeCutoverEnabled: false,
      primaryReadConfigured: Boolean(primaryRead.configured)
    };
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function loadIdentityLifecycleCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/auth/identity-lifecycle`);
    if (!response.ok) return;
    const payload = await response.json();
    identityLifecycleCenter = { ...identityLifecycleCenter, ...payload, plan: identityLifecycleCenter.plan, result: identityLifecycleCenter.result };
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function loadFinancialGatewayOperationsCenter() {
  if (!PLATFORM_API_BASE) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/financial-gateways/operations`);
    if (!response.ok) return;
    financialGatewayOperationsCenter = { ...financialGatewayOperationsCenter, ...(await response.json()) };
  } catch (error) {
    // Static and offline fallback remains usable without the commission API.
  }
}

async function runIdentityDirectoryAction(action, button) {
  if (!PLATFORM_API_BASE || !["preview", "apply"].includes(action)) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#identity-lifecycle-status");
  const payload = {};
  if (action === "apply") {
    payload.note = await window.HealthStructuredDialog.prompt({ title: "执行身份目录停用同步", label: "停用同步审计说明", defaultValue: "统一身份目录停用同步经责任人复核", minLength: 8 });
    payload.note ||= "";
    if (payload.note.trim().length < 8) return;
    payload.confirmation = await window.HealthStructuredDialog.prompt({ title: "确认停用同步", label: "确认短语", helperText: "请输入 APPLY IDENTITY DIRECTORY DEACTIVATIONS 以继续。", minLength: 38, multiline: false });
    payload.confirmation ||= "";
    if (payload.confirmation !== "APPLY IDENTITY DIRECTORY DEACTIVATIONS") return;
  }
  if (button) button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = action === "preview" ? "预检中" : "同步中";
    statusTarget.className = "badge info";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/auth/identity-directory/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    identityLifecycleCenter.plan = body.plan || identityLifecycleCenter.plan;
    identityLifecycleCenter.result = body.result || null;
    renderIdentityLifecycleCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = action === "preview" ? "预检受阻" : "同步受阻";
      statusTarget.title = error.message || "身份目录操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runSessionCleanupAction(button) {
  if (!PLATFORM_API_BASE || !button) return;
  const confirmation = await window.HealthStructuredDialog.prompt({ title: "清理保留会话", label: "确认短语", helperText: "请输入 PURGE RETAINED SESSIONS 以继续。", minLength: 23, multiline: false }) || "";
  if (confirmation !== "PURGE RETAINED SESSIONS") return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#identity-lifecycle-status");
  button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = "清理中";
    statusTarget.className = "badge info";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/auth/sessions/cleanup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    identityLifecycleCenter.capabilities = {
      ...(identityLifecycleCenter.capabilities || {}),
      sessionStore: body.sessionStore || identityLifecycleCenter.capabilities?.sessionStore
    };
    renderIdentityLifecycleCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = "清理受阻";
      statusTarget.title = error.message || "会话保留清理失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    button.disabled = false;
  }
}

async function runIdentityBindingAction(button) {
  if (!PLATFORM_API_BASE || !button) return;
  const note = await window.HealthStructuredDialog.prompt({ title: "外部身份受控绑定", label: "绑定说明", defaultValue: "统一身份目录账号与本地账号经责任人核对", minLength: 8 }) || "";
  if (note.trim().length < 8) return;
  const confirmation = await window.HealthStructuredDialog.prompt({ title: "确认身份绑定", label: "确认短语", helperText: "请输入 BIND EXTERNAL IDENTITY 以继续。", minLength: 22, multiline: false }) || "";
  if (confirmation !== "BIND EXTERNAL IDENTITY") return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#identity-lifecycle-status");
  button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = "绑定中";
    statusTarget.className = "badge info";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/auth/identity-directory/bind`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        localUserId: button.dataset.localUserId,
        externalSubject: button.dataset.externalSubject,
        note,
        confirmation
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || `HTTP ${response.status}`);
    identityLifecycleCenter.plan = body.plan || identityLifecycleCenter.plan;
    identityLifecycleCenter.result = body.result || null;
    renderIdentityLifecycleCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = "绑定受阻";
      statusTarget.title = error.message || "外部身份绑定失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    button.disabled = false;
  }
}

async function runPostgresPrimaryReadRehearsal(button) {
  if (!PLATFORM_API_BASE) return;
  const note = await window.HealthStructuredDialog.prompt({ title: "PostgreSQL 主读取演练", label: "演练说明", defaultValue: "平台割接前 PostgreSQL 主读取完整性复核", minLength: 8 }) || "";
  if (note.trim().length < 8) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#postgres-primary-read-status");
  if (button) button.disabled = true;
  if (statusTarget) {
    statusTarget.textContent = "演练中";
    statusTarget.className = "badge info";
  }
  try {
    const response = await request(`${PLATFORM_API_BASE}/production-database/primary-read-rehearsal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note: note.trim() })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    postgresProductionAdapterCenter.primaryReadReport = payload.report || null;
    renderPostgresProductionAdapterCenter();
  } catch (error) {
    if (statusTarget) {
      const message = error.message || "演练失败";
      statusTarget.textContent = message.includes("configuration is incomplete") ? "配置不完整" : "演练失败";
      statusTarget.title = message;
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runPostgresReconciliationCaseAction(action, id, button) {
  if (!PLATFORM_API_BASE || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#postgres-reconciliation-status");
  const item = (postgresReconciliationCenter.cases || []).find((candidate) => candidate.caseId === id);
  let owner = item?.owner || "database-operations";
  let note = "";
  let evidenceRefs = [];
  if (action === "assign") {
    owner = await window.HealthStructuredDialog.prompt({ title: "分派差异工单", label: "责任组", defaultValue: owner, minLength: 2 }) || "";
    if (!owner.trim()) return;
    note = `平台割接中心已将差异工单分派给 ${owner.trim()}。`;
  } else if (action === "acknowledge") {
    note = "数据库运维已接收平台割接中心下发的差异工单。";
  } else if (action === "resolve") {
    note = "影子核对结果已经复核一致，平台割接中心关闭差异工单。";
    evidenceRefs = [`reconciliation:${item?.clearedRunId || "matched-run"}`, `case:${id}`];
  } else {
    note = await window.HealthStructuredDialog.prompt({ title: action === "reopen" ? "重新打开差异工单" : "处置差异工单", label: action === "reopen" ? "重新打开原因" : "处置备注", minLength: 4 }) || "";
    if (!note.trim()) return;
  }
  if (button) button.disabled = true;
  if (statusTarget) statusTarget.textContent = "处理中";
  try {
    const response = await request(`${PLATFORM_API_BASE}/production-database/reconciliation-cases/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, owner, note, evidenceRefs })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    await loadPostgresReconciliationCenter();
    renderPostgresReconciliationCenter();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runCommercialCryptoAction(action, id, button) {
  if (!PLATFORM_API_BASE || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#commercial-crypto-status");
  const notes = {
    "run-runtime-probe": "Commission security operator ran the local OpenSSL compatibility probe; this is not a certification result.",
    "record-evidence": "Commission security operator registered an adapter evidence reference for onsite validation.",
    "request-onsite": "Commission security operator requested onsite device, certificate, key-management and assessment verification."
  };
  const body = {
    action,
    note: notes[action] || "Commercial crypto adapter action recorded.",
    evidenceRef: action === "record-evidence" ? `platform-console/${id}/${Date.now()}` : ""
  };
  if (button) button.disabled = true;
  if (statusTarget) statusTarget.textContent = "处理中";
  try {
    const response = await request(`${PLATFORM_API_BASE}/commercial-crypto/capabilities/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    const center = payload.center || {};
    platformState.commercialCryptoCapabilities = center.capabilities || platformState.commercialCryptoCapabilities || [];
    platformState.commercialCryptoProbeRuns = center.probeRuns || platformState.commercialCryptoProbeRuns || [];
    platformState.commercialCryptoEvidencePackets = center.evidencePackets || platformState.commercialCryptoEvidencePackets || [];
    platformState.commercialCryptoRuntimeProbe = center.runtimeProbe || platformState.commercialCryptoRuntimeProbe || null;
    renderPlatform();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runProductionDatabaseCutoverAction(action, id, button) {
  if (!PLATFORM_API_BASE || !action) return;
  const statusTarget = document.querySelector("#production-database-cutover-status");
  const request = window.HealthCityAuth?.authFetch || fetch;
  const isRehearsal = action === "rehearse";
  const path = isRehearsal
    ? "/production-database/cutover-runs"
    : `/production-database/cutover-runs/${encodeURIComponent(id || "")}/actions`;
  const body = isRehearsal
    ? { note: "Platform cutover center four-domain sample rehearsal" }
    : {
        action,
        note: action === "review" ? "Commission reviewer checked the dry-run evidence." : action === "record-rollback" ? "Rollback checkpoint rehearsal evidence recorded." : "Migration sample requires another rehearsal.",
        evidence: action === "record-rollback" ? `rollback-checkpoint-${Date.now()}` : ""
      };
  if (button) button.disabled = true;
  if (statusTarget) statusTarget.textContent = "处理中";
  try {
    const response = await request(`${PLATFORM_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    platformState.productionDatabaseMigrationBatches = payload.center?.migrationBatches || platformState.productionDatabaseMigrationBatches || [];
    platformState.productionDatabaseCutoverRuns = payload.center?.cutoverRuns || platformState.productionDatabaseCutoverRuns || [];
    renderPlatform();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runCitizenOperationsAction(resource, action, id, button) {
  if (!PLATFORM_API_BASE || !resource || !action || !id) return;
  const request = window.HealthCityAuth?.authFetch || fetch;
  const statusTarget = document.querySelector("#citizen-operations-status");
  const notes = {
    publish: "Commission operator published this demo content after content review.",
    withdraw: "Commission operator withdrew this demo content for revision.",
    approve: "Commission operator completed the demo identity review; authoritative government verification remains required.",
    reject: "Commission operator rejected the demo identity review after manual inspection.",
    "request-material": "Commission operator requested additional identity or guardian evidence.",
    activate: "Commission operator activated the demo blacklist rule after risk review.",
    lift: "Commission operator lifted the demo blacklist rule after review.",
    review: "Commission operator moved this blacklist record to manual review.",
    "enable-demo": "Commission operator enabled this hospital for white-list demonstration only.",
    "disable-demo": "Commission operator disabled this hospital demo service configuration.",
    "request-onsite": "Commission operator requested signed hospital service enablement evidence."
  };
  if (button) button.disabled = true;
  if (statusTarget) statusTarget.textContent = "处理中";
  try {
    const response = await request(`${PLATFORM_API_BASE}/citizen-operations/${encodeURIComponent(resource)}/${encodeURIComponent(id)}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: notes[action] || "Citizen operations action recorded." })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || `HTTP ${response.status}`);
    platformState.citizenOperationContents = payload.center?.contents || platformState.citizenOperationContents || [];
    platformState.citizenAgreementVersions = payload.center?.agreements || platformState.citizenAgreementVersions || [];
    platformState.citizenIdentityReviewCases = payload.center?.identityReviews || platformState.citizenIdentityReviewCases || [];
    platformState.citizenServiceBlacklist = payload.center?.blacklist || platformState.citizenServiceBlacklist || [];
    platformState.citizenHospitalServiceConfigs = payload.center?.hospitalServices || platformState.citizenHospitalServiceConfigs || [];
    renderPlatform();
  } catch (error) {
    if (statusTarget) {
      statusTarget.textContent = error.message || "操作失败";
      statusTarget.className = "badge danger";
    }
  } finally {
    if (button) button.disabled = false;
  }
}

async function runResearchDatasetAction(action, id) {
  if (!PLATFORM_API_BASE || !id) return;
  const dataset = (platformState.researchDatasets || []).find((item) => item.id === id);
  const request = window.HealthCityAuth?.authFetch || fetch;
  const body = action === "approve"
    ? { ethicsApproval: dataset?.ethicsApproval || `IRB-DEMO-${todayStamp()}`, anonymization: dataset?.anonymization || "k-anonymity-demo", deidentificationStatus: "released" }
    : action === "compliant-export"
      ? { purpose: `${dataset?.name || id} minimum-necessary de-identified export`, destination: "research-governance-reviewed-share", requestedFields: ["ageBand", "gender", "riskLevel", "followupCount"], exportFormat: "csv" }
    : action === "outcome-return"
      ? { title: `${dataset?.name || id} sandbox finding`, summary: "Returned from platform research sandbox.", registryImpact: "Review disease registry model thresholds." }
      : { purpose: `${dataset?.name || id} de-identified sandbox review` };
  const path = action === "approve"
    ? `/research/datasets/${encodeURIComponent(id)}/approval`
    : action === "compliant-export"
      ? `/research/datasets/${encodeURIComponent(id)}/compliant-exports`
    : action === "outcome-return"
      ? `/research/datasets/${encodeURIComponent(id)}/outcomes`
      : `/research/datasets/${encodeURIComponent(id)}/sandbox-access`;
  try {
    setResearchStatus("正在提交操作...");
    const response = await request(`${PLATFORM_API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      setResearchStatus(error.message || "操作未通过，请检查审批、脱敏和授权状态。", true);
      return;
    }
    await refreshPlatformState();
    setResearchStatus(action === "sandbox-access" ? "沙箱访问已审计留痕。" : action === "compliant-export" ? "合规数据出口已审查并留痕。" : action === "outcome-return" ? "成果已回流登记。" : "数据集已审批发布。");
  } catch (error) {
    setResearchStatus("当前为静态预览或服务不可用，操作未提交。", true);
  }
}

function openResearchEvidenceEditor(id) {
  const dataset = findResearchDataset(id);
  if (!dataset) return;
  const form = document.querySelector("#research-evidence-form");
  const dialog = document.querySelector("#research-evidence-dialog");
  const type = dataset.ethicsApproval ? "data-use-agreement" : "ethics-approval";
  form.reset();
  form.elements.namedItem("datasetId").value = dataset.id;
  form.elements.namedItem("datasetName").value = dataset.name || dataset.id;
  form.elements.namedItem("type").value = type;
  form.elements.namedItem("title").value = type === "data-use-agreement"
    ? `${dataset.name || dataset.id} data use agreement`
    : `${dataset.name || dataset.id} ethics approval`;
  form.elements.namedItem("referenceNo").value = type === "data-use-agreement"
    ? (dataset.governance?.dataUseAgreement || `DUA-${dataset.id}`)
    : (dataset.ethicsApproval || `IRB-${dataset.id}`);
  form.elements.namedItem("issuedBy").value = type === "data-use-agreement" ? "research-governance" : "demo-irb";
  form.elements.namedItem("issuedAt").value = new Date().toISOString().slice(0, 10);
  document.querySelector("#research-evidence-title").textContent = `科研材料登记：${dataset.name || dataset.id}`;
  dialog.showModal();
}

async function submitResearchEvidenceDocument(form) {
  if (!PLATFORM_API_BASE) {
    setResearchStatus("当前为静态预览，科研材料未提交。", true);
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  const payload = {
    type: String(data.type || "").trim(),
    title: String(data.title || "").trim(),
    referenceNo: String(data.referenceNo || "").trim(),
    issuedBy: String(data.issuedBy || "").trim(),
    issuedAt: String(data.issuedAt || "").trim(),
    expiresAt: String(data.expiresAt || "").trim(),
    fileName: String(data.fileName || "").trim(),
    fileHash: String(data.fileHash || "").trim(),
    note: String(data.note || "").trim()
  };
  if (!payload.type || !payload.title || !payload.referenceNo) {
    setResearchStatus("请补齐科研材料类型、标题和编号。", true);
    return;
  }
  try {
    setResearchStatus("正在登记科研材料...");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${PLATFORM_API_BASE}/research/datasets/${encodeURIComponent(data.datasetId)}/evidence`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      setResearchStatus(error.message || "科研材料登记失败。", true);
      return;
    }
    form.closest("dialog")?.close();
    await refreshPlatformState();
    setResearchStatus(`科研材料已登记：${payload.referenceNo}`);
  } catch (error) {
    setResearchStatus("服务不可用，科研材料未提交。", true);
  }
}

function findResearchDataset(id) {
  return (platformState.researchDatasets || []).find((item) => item.id === id)
    || (platformData?.researchDatasets || []).find((item) => item.id === id);
}

async function submitResearchDatasetApplication(form) {
  if (!PLATFORM_API_BASE) {
    setResearchStatus("当前为静态预览，申请未提交。", true);
    return;
  }
  const data = Object.fromEntries(new FormData(form));
  const sourceProfiles = {
    clinical: ["personalRecords", "diagnosticReports"],
    chronic: ["personalRecords", "diagnosticReports", "chronicManagementPlans"],
    followup: ["personalRecords", "diagnosticReports", "followups"]
  };
  const payload = {
    diseaseType: String(data.diseaseType || "").trim(),
    name: String(data.name || "").trim(),
    purpose: String(data.purpose || "").trim(),
    sourceCollections: sourceProfiles[data.sourceProfile] || sourceProfiles.clinical,
    governance: {
      dataUseAgreement: String(data.dataUseAgreement || "").trim(),
      minimumNecessary: data.minimumNecessary === "on",
      reidentificationProhibited: data.reidentificationProhibited === "on",
      exportReviewRequired: true,
      retentionDays: Number(data.retentionDays || 180),
      steward: "research-governance"
    }
  };
  if (!payload.diseaseType || !payload.name || !payload.purpose || !payload.governance.dataUseAgreement || !payload.governance.minimumNecessary || !payload.governance.reidentificationProhibited) {
    setResearchStatus("请补齐病种、数据集名称、研究目的、数据使用协议、最小必要和禁止再识别声明。", true);
    return;
  }
  try {
    setResearchStatus("正在提交科研数据集申请...");
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${PLATFORM_API_BASE}/research/datasets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      setResearchStatus(error.message || "申请提交失败。", true);
      return;
    }
    const created = await response.json();
    await refreshPlatformState();
    setResearchStatus(`申请已提交：${created.name}，等待伦理审批和脱敏发布。`);
  } catch (error) {
    setResearchStatus("服务不可用，申请未提交。", true);
  }
}

function setResearchStatus(message, isError = false) {
  const status = document.querySelector("#research-status");
  if (!status) return;
  status.textContent = message || "";
  status.dataset.state = isError ? "error" : "ok";
}

async function refreshPlatformState() {
  platformState = await loadPlatformState(fallbackPlatformState);
  ensureEditablePlatformData(platformState);
  platformData = platformModel(platformState);
  renderResearchGovernance(platformData, researchSandboxSummary);
  renderMetrics(platformState, platformData);
  renderReportSummary(platformData, platformState.platformChangeLogs || []);
  refreshResearchSandboxSummary();
}

async function refreshResearchSandboxSummary() {
  if (!PLATFORM_API_BASE) return;
  try {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${PLATFORM_API_BASE}/research/sandbox`);
    if (!response.ok) return;
    researchSandboxSummary = await response.json();
    renderResearchGovernance(platformData || platformModel(platformState), researchSandboxSummary);
  } catch (error) {
    // Static fallback keeps the page usable without the API.
  }
}

function openEvidenceEditor(id) {
  const item = findEvidenceItem(id);
  if (!item) return;
  const dialog = document.querySelector("#evidence-edit-dialog");
  const form = document.querySelector("#evidence-edit-form");
  const latest = Array.isArray(item.records) ? item.records[0] : null;
  form.elements.namedItem("id").value = item.id;
  form.elements.namedItem("name").value = item.name;
  form.elements.namedItem("status").value = item.status || "待补齐";
  form.elements.namedItem("owner").value = item.owner || "";
  form.elements.namedItem("fileName").value = "";
  form.elements.namedItem("link").value = "";
  form.elements.namedItem("testRecord").value = latest?.testRecord || "";
  form.elements.namedItem("next").value = item.next || "";
  document.querySelector("#evidence-edit-title").textContent = `登记证据：${item.name}`;
  dialog.showModal();
}

function findEvidenceItem(id) {
  return (platformState.platformEvidence || []).find((item) => item.id === id);
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
  if ("nextAction" in item) return item.nextAction || "";
  if ("target" in item) return item.target || "";
  if (Array.isArray(item.items)) return item.items.join("、");
  return "";
}

function findEditableItem(collection, id) {
  const key = {
    capabilities: "platformCapabilities",
    integrations: "platformIntegrations",
    interfaces: "platformInterfaces",
    deliveryBatches: "platformDeliveryBatches",
    applicationCatalog: "applicationCatalog",
    creditEvaluations: "institutionCreditEvaluations",
    securityLedger: "securityAcceptanceLedger",
    productionDeploymentPlan: "productionDeploymentPlan"
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
  else if ("nextAction" in item) parts.push(`下一步=${item.nextAction || "未填"}`);
  else if ("target" in item) parts.push(`目标=${item.target || "未填"}`);
  else if (Array.isArray(item.items)) parts.push(`任务=${item.items.join("、") || "未填"}`);
  return parts.join("；");
}

function summarizeEvidenceItem(item) {
  const recordCount = Array.isArray(item.records) ? item.records.length : 0;
  const latest = recordCount ? item.records[0] : null;
  return [
    `状态=${item.status || "未填"}`,
    `责任人=${item.owner || "未填"}`,
    `材料=${recordCount}份`,
    `最新=${latest?.fileName || latest?.link || "无"}`,
    `整改=${item.next || "未填"}`
  ].join("；");
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
    deliveryBatches: "platformDeliveryBatches",
    platformEvidence: "platformEvidence",
    applicationCatalog: "applicationCatalog",
    creditEvaluations: "institutionCreditEvaluations",
    securityLedger: "securityAcceptanceLedger",
    productionDeploymentPlan: "productionDeploymentPlan"
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
  const evidence = Array.isArray(platform.evidence) ? platform.evidence : [];
  const byStatus = countBy(allItems.map((item) => item.status || "未填"));
  const byOwner = countBy(allItems.map((item) => item.owner || "未填"));
  const pending = allItems.filter((item) => isPendingPlatformStatus(item.status)).slice(0, 8);
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
      <h3>证据归档</h3>
      ${evidence.map((item) => `<p><strong>${item.category}</strong><span>${item.status} · ${item.owner || "未填"} · ${Array.isArray(item.records) ? item.records.length : 0} 份材料</span></p>`).join("") || `<p class="muted">暂无证据项。</p>`}
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
    ...platform.deliveryBatches.map((item) => ({ type: "开发批次", name: item.phase, status: item.status, owner: item.owner, next: Array.isArray(item.items) ? item.items.join("、") : "" })),
    ...platform.hospitalManagementFunctions.map((item) => ({ type: "管理职能", name: item.functionName, status: item.status, owner: item.owner, next: item.nextAction })),
    ...platform.applicationCatalog.map((item) => ({ type: "应用目录", name: item.name, status: item.status, owner: item.owner, next: item.next })),
    ...platform.creditEvaluations.map((item) => ({ type: "信用评价", name: item.name, status: item.status, owner: item.owner, next: item.next })),
    ...platform.securityLedger.map((item) => ({ type: "安全信创", name: item.name, status: item.status, owner: item.owner, next: item.next })),
    ...platform.productionDeploymentPlan.map((item) => ({ type: "生产部署", name: item.name, status: item.status, owner: item.owner, next: item.nextAction }))
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

function isPendingPlatformStatus(status) {
  const text = String(status || "");
  if (!text) return true;
  if (/已|完成|闭环|建档|衔接|纳管|运行|通过|ready|passed/i.test(text)) return false;
  return /待|开发中|启动|设计|测评|测试|整改/i.test(text);
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
    platformDeliveryBatches: "开发批次",
    applicationCatalog: "应用目录",
    institutionCreditEvaluations: "信用评价",
    securityAcceptanceLedger: "安全信创",
    productionDeploymentPlan: "生产部署"
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
  const evidence = Array.isArray(platform.evidence) ? platform.evidence : [];
  const byStatus = countBy(allItems.map((item) => item.status || "未填"));
  const byOwner = countBy(allItems.map((item) => item.owner || "未填"));
  const logs = filteredReportLogs(platformState.platformChangeLogs || [], filters).slice(0, 10);
  const pending = allItems.filter((item) => isPendingPlatformStatus(item.status));
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
    "",
    "## 六、验收证据归档",
    "",
    ...(evidence.length ? evidence.map((item) => `- 【${item.category}】${item.name}：${item.status}；责任人：${item.owner || "未填"}；已登记材料：${Array.isArray(item.records) ? item.records.length : 0} 份；下一步：${item.next || "待补充"}`) : ["- 暂无证据项。"]),
    ""
  ];
  downloadText(`全民健康信息平台建设周报素材-${todayStamp()}.md`, lines.join("\n"));
}

async function exportPlatformCapabilityMap() {
  if (!PLATFORM_API_BASE) {
    downloadText(`平台功能总览-${todayStamp()}.md`, [
      "# 平台功能总览",
      "",
      "当前为静态预览模式，无法读取 `/api/platform/capability-map`。",
      "",
      "请启动 Node 后端后重新导出，以汇总 release manifest、package scripts、readiness 报告和数据集合。"
    ].join("\n"));
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/capability-map?format=markdown`);
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    downloadText(`平台功能总览-${todayStamp()}.md`, text);
  } catch (error) {
    downloadText(`平台功能总览导出失败-${todayStamp()}.md`, [
      "# 平台功能总览导出失败",
      "",
      `错误：${error.message || "未知错误"}`,
      "",
      "请确认登录角色为卫生健康委管理端，并检查动态后端是否可访问。"
    ].join("\n"));
  }
}

async function exportPlatformGoLiveSlices() {
  if (!PLATFORM_API_BASE) {
    downloadText(`上线三切片收口-${todayStamp()}.md`, [
      "# 上线三切片收口",
      "",
      "当前为静态预览模式，无法读取 `/api/platform/go-live-slices`。",
      "",
      "请启动 Node 后端后重新导出，以汇总阻塞项、服务订单和主数据目录。"
    ].join("\n"));
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/go-live-slices?format=markdown`);
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    downloadText(`上线三切片收口-${todayStamp()}.md`, text);
  } catch (error) {
    downloadText(`上线三切片收口导出失败-${todayStamp()}.md`, [
      "# 上线三切片收口导出失败",
      "",
      `错误：${error.message || "未知错误"}`,
      "",
      "请确认已使用卫生健康委管理端账号登录，并检查动态后端是否可访问。"
    ].join("\n"));
  }
}

async function exportPlatformStandardsLedgers() {
  if (!PLATFORM_API_BASE) {
    downloadText(`卫生健康信息平台六类台账-${todayStamp()}.md`, [
      "# 卫生健康信息平台六类可验收台账",
      "",
      "当前为静态预览模式，无法读取 `/api/platform/standards-ledgers`。",
      "",
      "请启动 Node 后端后重新导出，以保留实时数据、自动检查和正式上线边界。"
    ].join("\n"));
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const response = await request(`${PLATFORM_API_BASE}/platform/standards-ledgers?format=markdown`);
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    downloadText(`卫生健康信息平台六类台账-${todayStamp()}.md`, text);
  } catch (error) {
    downloadText(`卫生健康信息平台六类台账导出失败-${todayStamp()}.md`, `# 导出失败\n\n${error.message || "未知错误"}\n`);
  }
}

async function exportPlatformStandardsLedgerDetail() {
  const ledgerId = document.querySelector("#platform-standards-ledger-select")?.value;
  const title = platformStandardsLedgerDetail?.ledger?.title || "平台台账明细";
  if (!PLATFORM_API_BASE || !ledgerId) {
    downloadText(`${title}-导出失败-${todayStamp()}.md`, "# 导出失败\n\n请连接动态后端并选择台账。\n");
    return;
  }
  const request = window.HealthCityAuth?.authFetch || fetch;
  try {
    const params = platformStandardsLedgerFilterParams(true);
    const response = await request(`${PLATFORM_API_BASE}/platform/standards-ledgers/${encodeURIComponent(ledgerId)}?${params}`);
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    downloadText(`${title}-${todayStamp()}.md`, text);
  } catch (error) {
    downloadText(`${title}-导出失败-${todayStamp()}.md`, `# 导出失败\n\n${error.message || "未知错误"}\n`);
  }
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
  window.HealthBrowserSafeUrl.setElementUrl(link, "href", url, {
    capability: "blob-download",
    baseUrl: location.href
  });
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
