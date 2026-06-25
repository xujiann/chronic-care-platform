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
  applicationCatalog: [],
  hospitalInteroperabilityFunctions: [],
  institutionCreditEvaluations: [],
  securityAcceptanceLedger: [],
  productionDeploymentPlan: [],
  platformChangeLogs: []
};

const PLATFORM_API_BASE = location.protocol === "file:" ? "" : "/api";
const PLATFORM_STORAGE_KEY = "chronic-care-platform-state";
let platformState = structuredClone(fallbackPlatformState);
let platformData = null;
let activeEditSnapshot = null;
let researchSandboxSummary = null;

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
  { phase: "第三批：惠民统一入口", owner: "基层卫生/居民端", items: ["健康大连统一入口", "互联网+药事服务", "居民健康画像", "授权共享", "固定取药提醒"], status: "衔接居民端和慢病模块" },
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
  { id: "ev-launch", category: "上线验收", name: "区级实施和应用上线材料", owner: "实施组", source: "中山、沙河口、甘井子、高新区实施批次和应用培训记录", artifacts: ["上线确认", "培训签到", "试运行问题", "用户反馈"], status: "演示验收建档", next: "按真实区县、机构、应用和批次补充上线签字、培训签到、试运行问题和用户反馈。", records: [
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
  { id: "app-citizen", name: "健康大连居民服务", sourceSystem: "居民端/健康码", interfaceMode: "统一入口", owner: "基层卫生处", reuseMode: "入口整合", batch: "第三批", evidence: "居民旅程/授权记录", status: "已纳管", next: "接入政务身份源和正式消息服务。" },
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

const defaultInstitutionCreditEvaluations = [
  { id: "credit-central", name: "大连市中心医院", institutionType: "三级医院", period: "2026上半年", score: 92, grade: "A", indicators: "依法执业98/质量安全90/数据报送88/服务信用92", owner: "医政医管处", status: "已评价", next: "保持月度数据质量复核并公示优秀项。" },
  { id: "credit-ganjingzi", name: "甘井子区人民医院", institutionType: "二级医院", period: "2026上半年", score: 84, grade: "B", indicators: "依法执业92/质量安全86/数据报送76/服务信用82", owner: "属地卫生行政部门", status: "整改中", next: "30日内完成统计迟报和接口数据缺项整改。" },
  { id: "credit-community", name: "青泥洼桥社区卫生服务中心", institutionType: "基层机构", period: "2026上半年", score: 88, grade: "B+", indicators: "依法执业95/质量安全87/数据报送85/服务信用86", owner: "中山区卫生健康局", status: "已评价", next: "补齐家庭医生签约数据质控证据。" }
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
    status: "planned",
    owner: "data platform",
    nextAction: "Provision PostgreSQL, set DATABASE_URL, run restore rehearsal, and freeze a migration window.",
    requiredConfig: ["STORAGE_ENGINE=postgres", "DATABASE_URL", "BACKUP_RETENTION_DAYS"],
    evidence: ["snapshot", "restore rehearsal", "migration checklist"]
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

document.addEventListener("DOMContentLoaded", async () => {
  platformState = await loadPlatformState(fallbackPlatformState);
  ensureEditablePlatformData(platformState);
  bindPlatformEditor();
  renderPlatform();
  refreshResearchSandboxSummary();
});

function renderPlatform() {
  platformData = platformModel(platformState);
  renderMetrics(platformState, platformData);
  renderCapabilities(platformState, platformData.capabilities);
  renderIntegrationRegistry(platformData.integrations);
  renderInterfacePlan(platformData.interfaces);
  renderDataFoundation(platformState);
  renderRoadmap(platformData.deliveryBatches);
  renderHospitalManagementFunctions(platformData.hospitalManagementFunctions);
  renderApplicationCatalog(platformData.applicationCatalog);
  renderInstitutionCreditEvaluations(platformData.creditEvaluations);
  renderSecurityAcceptanceLedger(platformData.securityLedger);
  renderProductionDeploymentPlan(platformData.productionDeploymentPlan);
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
    creditEvaluations: Array.isArray(state.institutionCreditEvaluations) && state.institutionCreditEvaluations.length ? state.institutionCreditEvaluations : defaultInstitutionCreditEvaluations,
    securityLedger: Array.isArray(state.securityAcceptanceLedger) && state.securityAcceptanceLedger.length ? state.securityAcceptanceLedger : defaultSecurityAcceptanceLedger,
    productionDeploymentPlan: Array.isArray(state.productionDeploymentPlan) && state.productionDeploymentPlan.length ? state.productionDeploymentPlan : defaultProductionDeploymentPlan,
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
          <small>${item.owner || "owner pending"} · ${item.track || "production"}</small>
          ${evidence}
          <button class="inline-action" type="button" data-edit-platform="productionDeploymentPlan" data-id="${item.id}">维护</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderResearchGovernance(platform, sandboxSummary = null) {
  const datasets = Array.isArray(platform.researchDatasets) ? platform.researchDatasets : [];
  const models = Array.isArray(platform.diseaseRegistryModels) ? platform.diseaseRegistryModels : [];
  const summary = sandboxSummary?.summary || {};
  const boundaries = Array.isArray(sandboxSummary?.boundaries) ? sandboxSummary.boundaries : ["research dataset", "disease registry", "ethics approval", "de-identification release", "sandbox access", "usage audit", "outcome return"];
  const reusableCollections = Array.isArray(sandboxSummary?.reusableCollections) ? sandboxSummary.reusableCollections : ["researchDatasets", "diseaseRegistryModels", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"];
  const activeSandboxCount = Number.isFinite(summary.activeDatasets) ? summary.activeDatasets : datasets.filter((item) => item.authorizationStatus === "approved" && (item.sandbox?.status === "active" || item.status === "published")).length;
  const pendingApplications = Number.isFinite(summary.pendingApplications) ? summary.pendingApplications : datasets.filter((item) => item.authorizationStatus === "pending" || item.status === "requested").length;
  const usageAuditCount = Number.isFinite(summary.usageAudits) ? summary.usageAudits : datasets.reduce((sum, item) => sum + (Array.isArray(item.usageAudit) ? item.usageAudit.length : 0), 0);
  const outcomeCount = Number.isFinite(summary.outcomes) ? summary.outcomes : datasets.reduce((sum, item) => sum + (Array.isArray(item.outcomes) ? item.outcomes.length : 0), 0);
  const previousStatus = document.querySelector("#research-status");
  const statusText = previousStatus?.textContent || "";
  const statusState = previousStatus?.dataset.state || "";
  const datasetRows = datasets.map((item) => `
    <tr>
      <td><strong>${item.name}</strong></td>
      <td>${item.diseaseType}</td>
      <td>${item.version}</td>
      <td>${item.ethicsApproval || "待登记"}</td>
      <td>${item.anonymization || "待登记"} / ${item.deidentificationStatus || "pending"}</td>
      <td>${statusBadge(item.authorizationStatus || item.status)} ${statusBadge(item.sandbox?.status || "pending")}</td>
      <td>${item.records || 0}</td>
      <td>${(item.usageAudit || []).length} / ${(item.outcomes || []).length}</td>
      <td>
        <button class="inline-action" type="button" data-research-action="sandbox-access" data-id="${item.id}">沙箱访问</button>
        <button class="inline-action" type="button" data-research-action="outcome-return" data-id="${item.id}">成果回流</button>
        <button class="inline-action" type="button" data-research-action="approve" data-id="${item.id}">审批发布</button>
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
  document.querySelector("#research-governance").innerHTML = `
    <div class="research-sandbox-summary">
      <div><strong>${datasets.length}</strong><span>数据集</span></div>
      <div><strong>${activeSandboxCount}</strong><span>已开放沙箱</span></div>
      <div><strong>${pendingApplications}</strong><span>待审批申请</span></div>
      <div><strong>${models.length}</strong><span>专病模型</span></div>
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
        <h3>审计与成果回流</h3>
        <ul class="research-audit-feed">${auditRows}${outcomeRows}</ul>
      </article>
    </div>
    <table>
      <thead><tr><th>数据集</th><th>病种</th><th>版本</th><th>伦理审批</th><th>脱敏</th><th>授权/沙箱</th><th>记录数</th><th>审计/成果</th><th>Action</th></tr></thead>
      <tbody>${datasetRows || `<tr><td colspan="9">暂无科研数据集。</td></tr>`}</tbody>
    </table>
    <table>
      <thead><tr><th>模型</th><th>病种</th><th>版本</th><th>适用人群</th><th>触发阈值</th><th>复核状态</th><th>输出</th><th>复核人</th></tr></thead>
      <tbody>${modelRows || `<tr><td colspan="8">暂无专病库模型。</td></tr>`}</tbody>
    </table>
  `;
}

function researchBoundaryLabel(value) {
  return {
    "research dataset": "科研数据集",
    "disease registry": "专病库",
    "ethics approval": "伦理审批",
    "de-identification release": "脱敏发布",
    "sandbox access": "沙箱访问",
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
  return `<span class="badge ${cls}">${value}</span>`;
}

function listText(value) {
  return Array.isArray(value) ? value.join("、") : (value || "");
}

function bindPlatformEditor() {
  document.addEventListener("submit", async (event) => {
    if (event.target?.id === "research-application-form") {
      event.preventDefault();
      await submitResearchDatasetApplication(event.target);
    }
  });

  document.addEventListener("click", (event) => {
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

async function runResearchDatasetAction(action, id) {
  if (!PLATFORM_API_BASE || !id) return;
  const dataset = (platformState.researchDatasets || []).find((item) => item.id === id);
  const request = window.HealthCityAuth?.authFetch || fetch;
  const body = action === "approve"
    ? { ethicsApproval: dataset?.ethicsApproval || `IRB-DEMO-${todayStamp()}`, anonymization: dataset?.anonymization || "k-anonymity-demo", deidentificationStatus: "released" }
    : action === "outcome-return"
      ? { title: `${dataset?.name || id} sandbox finding`, summary: "Returned from platform research sandbox.", registryImpact: "Review disease registry model thresholds." }
      : { purpose: `${dataset?.name || id} de-identified sandbox review` };
  const path = action === "approve"
    ? `/research/datasets/${encodeURIComponent(id)}/approval`
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
    setResearchStatus(action === "sandbox-access" ? "沙箱访问已审计留痕。" : action === "outcome-return" ? "成果已回流登记。" : "数据集已审批发布。");
  } catch (error) {
    setResearchStatus("当前为静态预览或服务不可用，操作未提交。", true);
  }
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
    sourceCollections: sourceProfiles[data.sourceProfile] || sourceProfiles.clinical
  };
  if (!payload.diseaseType || !payload.name || !payload.purpose) {
    setResearchStatus("请补齐病种、数据集名称和研究目的。", true);
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
