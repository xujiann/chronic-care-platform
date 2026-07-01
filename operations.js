const OPERATIONS_API_BASE = location.protocol === "file:" ? "" : "/api";
let operationsDashboard = null;
let selectedSnapshotId = "";
const operationFilters = {
  status: "all",
  domain: "all",
  search: "",
  sort: "pressure"
};
const performanceFilters = {
  tier: "secondary",
  domain: "all",
  source: "all"
};
let selectedPerformanceIndicatorNo = "";

const OPERATIONS_INTERFACE_MAPPINGS = [
  ["ops-his-beds", "HIS/住院管理", "病案首页", "hospitalOperationSnapshots", "beds", "开放床位、占用床位、重症床位、急诊留观", "医务部、病案室、信息中心", "日内15分钟", "已接入", "现场核对床位开放、占用和重症床位口径。"],
  ["ops-hr-staff", "人力资源/排班系统", "医院填报", "hospitalOperationSnapshots", "staff", "在岗医生、在岗护士、急诊医生、人员缺口", "人事科、护理部、医务部", "日内排班变更", "待联调", "补齐排班接口、请假调班规则和临时支援人员归属。"],
  ["ops-equipment-ed", "设备管理/急诊系统", "医院填报", "hospitalOperationSnapshots", "equipment,outpatient", "CT可用台数、呼吸机可用数、救护车可用数、急诊人次、候诊超30分钟", "设备科、急诊科、门诊部", "日内30分钟", "已接入", "确认设备停机、急诊分诊和候诊统计时间戳。"],
  ["ops-stat-direct", "卫生健康统计直报", "财务年报表", "statisticsReconciliationReviews", "varianceRate,fields,platformValue,directReportValue", "直报批次、差异字段、平台采集值、直报暂存值、复核状态", "统计办公室、规划发展与信息化处", "日报/周报/月报", "已接入", "建立退回、阻断、补正中、通过状态与直报系统回执编码映射。"],
  ["ops-satisfaction", "满意度调查平台", "满意度调查平台", "performanceMonitoring", "readinessMatrix", "门诊满意度、住院满意度、医务人员满意度、调查周期、有效样本量", "行风办、门诊部、护理部", "月度", "待联调", "确认国家满意度平台数据权限、导出周期、样本量字段和异常说明模板。"]
];

const PERFORMANCE_MANUALS = {
  secondary: {
    title: "二级公立医院绩效监测",
    year: "2025版",
    total: 28,
    quantitative: 28,
    qualitative: 0,
    national: 21,
    note: "手册要求延续指标顺序和口径，补充创新药剔除、最新规范性文件、指标内涵和数据质控要求。",
    indicators: [
      ["1", "出院患者手术占比", "医疗质量", "病案首页", "逐步提高", true],
      ["2", "出院患者微创手术占比", "医疗质量", "病案首页", "逐步提高", true],
      ["3", "出院患者三级手术占比", "医疗质量", "病案首页", "逐步提高", true],
      ["4", "手术患者并发症发生率", "医疗质量", "病案首页", "逐步降低", true],
      ["5", "低风险组病例死亡率", "医疗质量", "病案首页", "逐步降低", true],
      ["6", "抗菌药物使用强度", "医疗质量", "医院填报", "逐步降低", true],
      ["7", "基本药物采购金额占比", "医疗质量", "国家或省级平台", "逐步提高", false],
      ["8", "国家组织药品集中采购中标药品金额占比", "医疗质量", "医院填报", "逐步提高", false],
      ["9", "重点监控药品收入占比", "医疗质量", "医院填报", "监测比较", false],
      ["10", "重点监控高值医用耗材收入占比", "医疗质量", "医院填报", "监测比较", false],
      ["11", "电子病历应用功能水平分级", "医疗质量", "国家或省级平台", "逐步提高", true],
      ["12", "省级室间质量评价临床检验项目参加率与合格率", "医疗质量", "国家或省级平台", "逐步提高", false],
      ["13", "平均住院日", "医疗质量", "病案首页", "监测比较", true],
      ["14", "医疗盈余率", "运营效率", "财务年报表", "监测比较", true],
      ["15", "资产负债率", "运营效率", "财务年报表", "监测比较", true],
      ["16", "人员经费占比", "运营效率", "财务年报表", "逐步提高", true],
      ["17", "万元收入能耗占比", "运营效率", "财务年报表", "逐步降低", true],
      ["18", "医疗收入中来自医保基金的比例", "运营效率", "财务年报表", "监测比较", false],
      ["19", "医疗服务收入占医疗收入比例", "运营效率", "财务年报表", "逐步提高", true],
      ["20", "医疗收入增幅", "运营效率", "财务年报表", "监测比较", true],
      ["21", "次均费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["22", "次均药品费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["23", "医护比", "持续发展", "国家或省级平台", "监测比较", true],
      ["24", "麻醉、儿科、重症、病理、中医医师占比", "持续发展", "国家或省级平台", "逐步提高", true],
      ["25", "人才培养经费投入占比", "持续发展", "医院填报", "逐步提高", false],
      ["26", "专科能力建设", "持续发展", "病案首页", "监测比较", true],
      ["27", "患者满意度", "满意度评价", "满意度调查平台", "逐步提高", true],
      ["28", "医务人员满意度", "满意度评价", "满意度调查平台", "逐步提高", true]
    ]
  },
  tertiary: {
    title: "三级公立医院绩效监测",
    year: "2025版",
    total: 56,
    quantitative: 51,
    qualitative: 5,
    national: 26,
    note: "手册包含55个基础指标和1个新增指标，强化功能定位、质量安全、运营效率、持续发展和满意度评价。",
    indicators: [
      ["1", "门诊人次数与出院人次数比", "功能定位", "病案首页", "监测比较", false],
      ["2", "下转患者人次数", "功能定位", "医院填报", "逐步提高", false],
      ["3", "日间手术占择期手术比例", "功能定位", "病案首页", "监测比较", false],
      ["4", "出院患者手术占比", "功能定位", "病案首页", "逐步提高", true],
      ["5", "出院患者微创手术占比", "功能定位", "病案首页", "逐步提高", true],
      ["6", "出院患者四级手术比例", "功能定位", "病案首页", "逐步提高", true],
      ["7", "特需医疗服务占比", "功能定位", "医院填报", "监测比较", false],
      ["8", "手术患者并发症发生率", "医疗质量", "病案首页", "逐步降低", true],
      ["9", "一类切口手术部位感染率", "医疗质量", "病案首页", "逐步降低", true],
      ["10", "单病种质量控制", "医疗质量", "病案首页", "监测比较", true],
      ["11", "大型医用设备检查阳性率", "医疗质量", "医院填报", "监测比较", false],
      ["12", "大型医用设备维修保养及质量控制管理", "医疗质量", "医院填报", "监测比较", false],
      ["13", "通过国家室间质量评价的临床检验项目数", "医疗质量", "国家或省级平台", "逐步提高", true],
      ["14", "低风险组病例死亡率", "医疗质量", "病案首页", "逐步降低", true],
      ["15", "优质护理服务病房覆盖率", "医疗质量", "医院填报", "逐步提高", false],
      ["16", "点评处方占处方总数的比例", "医疗质量", "医院填报", "逐步提高", false],
      ["17", "抗菌药物使用强度", "医疗质量", "医院填报", "逐步降低", true],
      ["18", "门诊患者基本药物处方占比", "医疗质量", "医院填报", "逐步提高", false],
      ["19", "住院患者基本药物使用率", "医疗质量", "医院填报", "逐步提高", false],
      ["20", "基本药物采购品种数占比", "医疗质量", "医院填报", "逐步提高", false],
      ["21", "国家组织药品集中采购中标药品使用比例", "医疗质量", "医院填报", "逐步提高", false],
      ["22", "门诊患者平均预约诊疗率", "医疗质量", "医院填报", "逐步提高", false],
      ["23", "门诊患者预约后平均等待时间", "医疗质量", "医院填报", "逐步降低", false],
      ["24", "电子病历应用功能水平分级", "医疗质量", "国家或省级平台", "逐步提高", true],
      ["25", "每名执业医师日均住院工作负担", "医疗质量", "病案首页", "监测比较", false],
      ["26", "每百张病床药师人数", "医疗质量", "国家或省级平台", "监测比较", false],
      ["27", "门诊收入占医疗收入比例", "运营效率", "财务年报表", "监测比较", false],
      ["28", "门诊收入中来自医保基金的比例", "运营效率", "财务年报表", "监测比较", false],
      ["29", "住院收入占医疗收入比例", "运营效率", "财务年报表", "监测比较", false],
      ["30", "住院收入中来自医保基金的比例", "运营效率", "财务年报表", "监测比较", false],
      ["31", "医疗服务收入占医疗收入比例", "运营效率", "财务年报表", "逐步提高", true],
      ["32", "辅助用药收入占比", "运营效率", "财务年报表", "监测比较", false],
      ["33", "人员支出占业务支出比重", "运营效率", "财务年报表", "逐步提高", true],
      ["34", "万元收入能耗支出", "运营效率", "财务年报表", "逐步降低", true],
      ["35", "收支结余", "运营效率", "财务年报表", "监测比较", true],
      ["36", "资产负债率", "运营效率", "财务年报表", "监测比较", true],
      ["37", "医疗收入增幅", "运营效率", "财务年报表", "监测比较", false],
      ["38", "门诊次均费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["39", "门诊次均药品费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["40", "住院次均费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["41", "住院次均药品费用增幅", "运营效率", "财务年报表", "逐步降低", true],
      ["42", "全面预算管理", "运营效率", "医院填报", "逐步完善", false],
      ["43", "规范设立总会计师", "运营效率", "医院填报", "逐步完善", false],
      ["44", "卫生技术人员职称结构", "持续发展", "国家或省级平台", "监测比较", false],
      ["45", "麻醉、儿科、重症、病理、中医医师占比", "持续发展", "国家或省级平台", "逐步提高", true],
      ["46", "医护比", "持续发展", "国家或省级平台", "监测比较", true],
      ["47", "进修并返回原医院独立工作人数占比", "持续发展", "医院填报", "逐步提高", false],
      ["48", "住院医师首次参加医师资格考试通过率", "持续发展", "医院填报", "逐步提高", true],
      ["49", "承担培养医学人才的工作成效", "持续发展", "医院填报", "逐步提高", false],
      ["50", "每百名卫生技术人员科研项目经费", "持续发展", "医院填报", "逐步提高", true],
      ["51", "每百名卫生技术人员科研成果转化金额", "持续发展", "医院填报", "逐步提高", false],
      ["52", "公共信用综合评价等级", "持续发展", "国家或省级平台", "监测比较", false],
      ["53", "门诊患者满意度", "满意度评价", "满意度调查平台", "逐步提高", true],
      ["54", "住院患者满意度", "满意度评价", "满意度调查平台", "逐步提高", true],
      ["55", "医务人员满意度", "满意度评价", "满意度调查平台", "逐步提高", true],
      ["增1", "重点监控高值医用耗材收入占比", "运营效率", "财务年报表", "监测比较", false]
    ]
  }
};

function zh(value) {
  return window.HealthCityLocale?.text ? window.HealthCityLocale.text(value) : String(value || "");
}

function zhInline(value) {
  const text = zh(value);
  const terms = window.HealthCityLocale?.terms || {};
  return Object.entries(terms)
    .sort(([left], [right]) => right.length - left.length)
    .reduce((output, [source, target]) => output.split(source).join(target), text);
}

function zhList(values, separator = "、") {
  return window.HealthCityLocale?.list ? window.HealthCityLocale.list(values, separator) : (Array.isArray(values) ? values : []).join(separator);
}

const OPERATIONS_EVIDENCE_LABELS = {
  "/api/operations/dashboard": "运行监测总览接口",
  "/api/operations/command-chains": "处置指挥链接口",
  "/api/operations/interface-mapping": "现场联调字段映射",
  "/api/operations/dispatch": "资源调度接口",
  "/api/operations/reconciliation/:id/review": "统计复核接口",
  "/api/operations/playbooks": "预警处置预案接口",
  "/api/operations/handover": "交接班清单接口",
  "/api/operations/handover/owners": "交接责任矩阵接口",
  "/api/operations/site-joint-tests": "现场联调闭环接口",
  "/api/operations/site-joint-patrol": "现场联调巡检接口",
  "/api/operations/production-hardening": "生产加固清单接口",
  "/api/operations/cutover-command": "生产割接签收接口",
  "/api/operations/post-cutover-observation": "上线后观察接口",
  "/api/operations/intelligence": "智能调度建议接口",
  "/api/operations/resource-pool": "跨院资源池接口",
  "/api/operations/mobile-duty": "移动值守接口",
  "/api/operations/governance-report": "治理报表接口",
  "/api/operations/governance-export-package": "治理导出包接口",
  "/api/operations/next-development-research": "下一步功能研究接口"
};

function htmlAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function evidenceLabel(value) {
  return OPERATIONS_EVIDENCE_LABELS[value] || zh(value);
}

function evidenceList(values) {
  const items = Array.isArray(values) ? values : [];
  if (!items.length) return "待归档";
  return items.map((item) => `<span title="${htmlAttribute(item)}">${evidenceLabel(item)}</span>`).join(" / ");
}

document.addEventListener("DOMContentLoaded", async () => {
  bindPerformanceControls();
  bindMonitorControls();
  bindDispatchForm();
  await loadOperationsDashboard();
});

async function loadOperationsDashboard() {
  operationsDashboard = await fetchOperationsDashboard();
  if (!selectedSnapshotId) selectedSnapshotId = operationsDashboard.snapshots?.[0]?.id || "";
  renderOperationsDashboard();
}

async function fetchOperationsDashboard() {
  if (OPERATIONS_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    const response = await request(`${OPERATIONS_API_BASE}/operations/dashboard`);
    if (response.ok) return response.json();
  }
  const response = await fetch("./data/db.json");
  const state = response.ok ? await response.json() : {};
  return buildStaticOperationsDashboard(state);
}

function buildStaticOperationsDashboard(state) {
  const alertRules = Array.isArray(state.operationAlertRules) ? state.operationAlertRules : [];
  const snapshots = (Array.isArray(state.hospitalOperationSnapshots) ? state.hospitalOperationSnapshots : []).map((snapshot) => enrichSnapshot(snapshot, alertRules));
  const dispatchRequests = Array.isArray(state.resourceDispatchRequests) ? state.resourceDispatchRequests : [];
  const reconciliationReviews = Array.isArray(state.statisticsReconciliationReviews) ? state.statisticsReconciliationReviews : [];
  const medicalResources = Array.isArray(state.medicalResources) ? state.medicalResources : [];
  const openStatuses = new Set(["pending", "assigned", "in-progress"]);
  const occupiedBeds = snapshots.reduce((sum, item) => sum + Number(item.beds?.occupied || 0), 0);
  const totalOpenBeds = snapshots.reduce((sum, item) => sum + Number(item.beds?.open || 0), 0);
  const commandChains = buildStaticCommandChains(snapshots, dispatchRequests, reconciliationReviews);
  const interfaceMapping = buildStaticInterfaceMapping();
  const playbooks = buildStaticOperationsPlaybooks(snapshots, alertRules, commandChains, interfaceMapping);
  const handover = buildStaticOperationsHandover(snapshots, dispatchRequests, reconciliationReviews, commandChains, playbooks, state.operationHandoverSignoffs || []);
  const siteJointTests = buildStaticSiteJointTests(interfaceMapping);
  const siteJointPatrol = buildStaticSiteJointPatrol(siteJointTests, dispatchRequests, reconciliationReviews);
  const productionHardening = buildStaticProductionHardening(state);
  const intelligence = buildStaticOperationsIntelligence(snapshots, dispatchRequests, reconciliationReviews);
  const performanceMonitoring = buildStaticPerformanceMonitoringEvidence(state, snapshots);
  const resourcePool = buildStaticResourcePool(snapshots, medicalResources, dispatchRequests);
  const mobileDuty = buildStaticMobileDuty(snapshots, dispatchRequests, reconciliationReviews, handover, state.taskMessages || []);
  const cutoverCommand = buildStaticCutoverCommand(productionHardening, siteJointPatrol, mobileDuty, state.platformProcessAudit || [], state.securityEvents || []);
  const postCutoverObservation = buildStaticPostCutoverObservation(snapshots, dispatchRequests, reconciliationReviews, siteJointPatrol, cutoverCommand, mobileDuty, state.platformProcessAudit || [], state.securityEvents || []);
  const governanceReport = buildStaticGovernanceReport(snapshots, dispatchRequests, reconciliationReviews, performanceMonitoring, handover);
  const governanceExportPackage = buildStaticGovernanceExportPackage(
    snapshots,
    dispatchRequests,
    reconciliationReviews,
    performanceMonitoring,
    governanceReport,
    intelligence,
    handover
  );
  const nextDevelopmentResearch = buildStaticNextDevelopmentResearch(
    snapshots,
    dispatchRequests,
    reconciliationReviews,
    performanceMonitoring,
    siteJointTests,
    productionHardening,
    intelligence,
    governanceReport,
    handover
  );
  return {
    ok: true,
    boundaries: ["hospital-operation-monitoring", "resource-dispatch", "statistics-reconciliation"],
    reusedCollections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit"],
    summary: {
      institutions: snapshots.length,
      critical: snapshots.filter((item) => item.normalizedStatus === "critical").length,
      warning: snapshots.filter((item) => item.normalizedStatus === "warning").length,
      alerts: snapshots.reduce((sum, item) => sum + item.activeAlerts.length, 0),
      openDispatchRequests: dispatchRequests.filter((item) => openStatuses.has(item.status)).length,
      pendingReconciliation: reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status)).length,
      occupiedBeds,
      totalOpenBeds,
      outpatientVisitsToday: snapshots.reduce((sum, item) => sum + Number(item.outpatient?.visitsToday || 0), 0),
      emergencyVisitsToday: snapshots.reduce((sum, item) => sum + Number(item.outpatient?.emergencyVisits || 0), 0),
      bedOccupancyRate: ratio(occupiedBeds, totalOpenBeds)
    },
    snapshots,
    dispatchRequests,
    reconciliationReviews,
    medicalResources,
    alertRules,
    commandChains,
    interfaceMapping,
    siteJointTests,
    siteJointPatrol,
    productionHardening,
    intelligence,
    playbooks,
    handover,
    handoverOwnerMatrix: buildStaticHandoverOwnerMatrix(handover),
    performanceMonitoring,
    resourcePool,
    mobileDuty,
    cutoverCommand,
    postCutoverObservation,
    governanceReport,
    governanceExportPackage,
    nextDevelopmentResearch
  };
}

function buildStaticInterfaceMapping() {
  const mappings = OPERATIONS_INTERFACE_MAPPINGS.map(([id, sourceSystem, source, targetCollection, targetField, fields, owner, updateCycle, status, nextAction]) => ({
    id,
    sourceSystem,
    source,
    targetCollection,
    targetField,
    fields: fields.split("、"),
    owner,
    updateCycle,
    status,
    nextAction,
    collectionReady: true,
    fieldCoverage: fields.split("、").map((field) => ({
      field,
      mapped: true,
      reviewPoint: `${field}需在现场联调中确认字段编码、单位、时间范围和责任科室。`
    }))
  }));
  return {
    ok: true,
    summary: {
      systems: new Set(mappings.map((item) => item.sourceSystem)).size,
      total: mappings.length,
      ready: mappings.filter((item) => item.status === "已接入").length,
      pending: mappings.filter((item) => item.status !== "已接入").length
    },
    mappings
  };
}

function buildStaticSiteJointTests(interfaceMapping) {
  const rows = (interfaceMapping.mappings || []).map((mapping) => {
    const completed = mapping.status === "已接入";
    return {
      id: `joint-${mapping.id}`,
      sourceSystem: mapping.sourceSystem,
      targetCollection: mapping.targetCollection,
      targetField: mapping.targetField,
      owner: mapping.owner,
      updateCycle: mapping.updateCycle,
      status: completed ? "已完成" : "待联调",
      samplePacket: `${mapping.sourceSystem}样例报文`,
      replayResult: completed ? "快照上报、调度回执或统计对账回放通过" : "等待现场样例报文和接收端确认截图",
      validationPoints: ["字段编码", "单位口径", "时间戳", "机构编码", "回执编码"],
      attachments: completed ? ["字段映射表", "验签日志", "回放记录"] : ["待补充样例报文", "待补充失败重试记录"],
      exitCriteria: completed ? "已具备演示联调证据，生产仍需现场签字。" : mapping.nextAction,
      evidence: ["/api/operations/interface-mapping", "/api/operations/site-joint-tests"]
    };
  });
  return {
    ok: rows.length > 0,
    summary: {
      systems: new Set(rows.map((item) => item.sourceSystem)).size,
      total: rows.length,
      completed: rows.filter((item) => item.status === "已完成").length,
      pending: rows.filter((item) => item.status !== "已完成").length
    },
    rows
  };
}

function buildStaticSiteJointPatrol(siteJointTests, dispatchRequests = [], reconciliationReviews = []) {
  const rows = (Array.isArray(siteJointTests?.rows) ? siteJointTests.rows : []).map((row) => {
    const completed = row.status === "已完成";
    const openDispatches = dispatchRequests.filter((item) => String(item.sourceInstitution || item.targetInstitution || "").includes(row.sourceSystem));
    const relatedRecon = reconciliationReviews.filter((item) => (item.evidence || []).includes(row.targetCollection) || String(item.reviewNote || "").includes(row.targetCollection));
    const replayStatus = completed ? "已回放" : openDispatches.length || relatedRecon.length ? "需复测" : "待回放";
    return {
      id: `patrol-${row.id}`,
      sourceSystem: row.sourceSystem,
      targetCollection: row.targetCollection,
      owner: row.owner,
      priority: !completed && (openDispatches.length || relatedRecon.length) ? "高" : completed ? "常规" : "中",
      status: completed ? "待签收" : "待巡检",
      checkpoints: [
        { id: "sample-packet", name: "样例报文", status: completed ? "已通过" : "待补传", evidence: row.samplePacket },
        { id: "signature-log", name: "验签日志", status: completed ? "已验签" : "待验签", evidence: "operationIntegrationAudit" },
        { id: "replay-record", name: "回放记录", status: replayStatus, evidence: row.replayResult },
        { id: "retry-queue", name: "失败重试", status: replayStatus === "需复测" ? "需重试" : "无失败", evidence: `${openDispatches.length + relatedRecon.length}项需关注` },
        { id: "receiver-confirmation", name: "接收确认", status: completed ? "已确认" : "待确认", evidence: row.exitCriteria }
      ],
      nextAction: completed ? "补齐接收端签收截图并归档。" : "补传样例报文、执行验签回放并记录失败重试结果。",
      evidence: ["/api/operations/site-joint-tests", "/api/operations/site-joint-patrol", "/api/operations/integration/snapshots"]
    };
  });
  return {
    ok: rows.length > 0,
    summary: {
      systems: new Set(rows.map((item) => item.sourceSystem)).size,
      rows: rows.length,
      highPriority: rows.filter((item) => item.priority === "高").length,
      pending: rows.filter((item) => item.status !== "已归档").length,
      checkpoints: rows.reduce((sum, item) => sum + item.checkpoints.length, 0)
    },
    rows,
    dailyChecklist: ["样例报文", "验签日志", "回放记录", "失败重试", "接收端确认"],
    evidence: ["/api/operations/site-joint-patrol", "platformProcessAudit", "operationIntegrationAudit"]
  };
}

function buildStaticProductionHardening(state) {
  const hasAudit = Array.isArray(state.platformProcessAudit);
  const checks = [
    { id: "session-secrets", name: "会话密钥质量", passed: false, detail: "静态预览不读取生产密钥", nextAction: "上线前配置非占位 SESSION_SECRETS。" },
    { id: "gateway-secret", name: "接口网关密钥质量", passed: false, detail: "静态预览不读取生产密钥", nextAction: "上线前配置 INTEGRATION_GATEWAY_SECRET 并确认轮换方案。" },
    { id: "audit-retention", name: "审计保全目标", passed: hasAudit, detail: hasAudit ? "已具备本地审计台账" : "缺少审计台账", nextAction: "生产需配置 AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT。" },
    { id: "monitoring-signoff", name: "监控值守签字", passed: false, detail: "待现场签字", nextAction: "绑定 /api/health、/api/metrics 和值守升级链。" },
    { id: "dr-rehearsal-signoff", name: "灾备演练签字", passed: false, detail: "待现场演练", nextAction: "完成备份、恢复、RTO/RPO 和回退演练。" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    status: checks.every((item) => item.passed) ? "生产可割接" : "待生产签字",
    summary: {
      total: checks.length,
      passed: checks.filter((item) => item.passed).length,
      blocked: checks.filter((item) => !item.passed).length
    },
    tracks: [
      { id: "secret-rotation", name: "生产密钥轮换", owner: "平台运维/安全管理岗", evidence: "SESSION_SECRETS, INTEGRATION_GATEWAY_SECRET", status: "待配置" },
      { id: "audit-retention", name: "审计保全", owner: "安全管理岗", evidence: "AUDIT_EXPORT_PATH 或 SIEM_ENDPOINT", status: hasAudit ? "演示已建档" : "待配置" },
      { id: "monitoring-oncall", name: "监控告警与值守", owner: "平台运维", evidence: "CUTOVER_MONITORING_SIGNOFF", status: "待签字" },
      { id: "dr-rehearsal", name: "灾备演练", owner: "基础设施组", evidence: "CUTOVER_DR_REHEARSAL_SIGNOFF", status: "待签字" }
    ],
    checks
  };
}

function staticCutoverOwner(id) {
  return {
    "session-secrets": "平台运维/安全管理员",
    "gateway-secret": "接口网关负责人",
    "audit-retention": "安全管理员",
    "monitoring-signoff": "监控值守长",
    "dr-rehearsal-signoff": "基础设施组",
    "operations-audit-trace": "运行监测岗"
  }[id] || "运行监测岗";
}

function buildStaticCutoverCommand(productionHardening, siteJointPatrol, mobileDuty, processAudit = [], securityEvents = []) {
  const checks = Array.isArray(productionHardening?.checks) ? productionHardening.checks : [];
  const patrolPending = Number(siteJointPatrol?.summary?.pending || 0);
  const dutyReminders = Number(mobileDuty?.summary?.reminders || 0);
  const items = checks.map((check, index) => {
    const auditHit = processAudit.find((item) =>
      String(item.process || "").includes("生产割接") &&
      (String(item.evidence || "").includes(check.id) || String(item.auditPoint || "").includes(check.name))
    );
    const signed = Boolean(check.passed || auditHit);
    const blocking = !signed && ["session-secrets", "gateway-secret", "audit-retention", "monitoring-signoff", "dr-rehearsal-signoff"].includes(check.id);
    return {
      id: `cutover-${check.id}`,
      checkId: check.id,
      name: check.name,
      owner: staticCutoverOwner(check.id),
      phase: index <= 2 ? "T-1生产准备" : index <= 4 ? "T-0割接确认" : "上线后观察",
      status: signed ? "已签收" : blocking ? "阻断待签收" : "待复核",
      priority: blocking ? "高" : signed ? "常规" : "中",
      detail: check.detail,
      nextAction: signed ? "保持证据归档，并纳入上线后观察。" : check.nextAction,
      blockers: [
        !check.passed ? check.name : "",
        patrolPending > 0 && check.id === "site-interface-signoff" ? `${patrolPending}项现场巡检待归档` : "",
        dutyReminders === 0 && check.id === "monitoring-signoff" ? "尚未形成移动值守提醒证据" : ""
      ].filter(Boolean),
      evidence: ["/api/operations/production-hardening", "/api/operations/cutover-command", "platformProcessAudit"]
    };
  });
  return {
    ok: items.length > 0 && items.every((item) => item.status === "已签收"),
    summary: {
      total: items.length,
      signed: items.filter((item) => item.status === "已签收").length,
      blocking: items.filter((item) => item.status === "阻断待签收").length,
      pending: items.filter((item) => item.status !== "已签收").length,
      auditEvents: processAudit.filter((item) => String(item.process || "").includes("生产割接")).length,
      securityEvents: securityEvents.filter((item) => String(item.action || "").includes("cutover")).length
    },
    watchWindow: "T-1 18:00 至 T+1 08:00",
    rollbackPolicy: "任一高优先级割接项未签收时，维持演示环境，暂不进入生产切换。",
    items,
    evidence: ["/api/operations/cutover-command", "/api/operations/cutover-command/actions", "platformProcessAudit", "securityEvents"]
  };
}

function staticPostCutoverItem(id, title, owner, priority, metric, detail, nextAction, evidence, processAudit) {
  const auditHit = processAudit.find((item) =>
    String(item.process || "").includes("上线后观察") &&
    (String(item.evidence || "").includes(id) || String(item.auditPoint || "").includes(title))
  );
  return {
    id,
    title,
    owner,
    priority,
    status: auditHit ? "已观察" : priority === "高" ? "异常待处置" : priority === "中" ? "观察中" : "稳定",
    metric,
    detail,
    nextAction: auditHit ? "保持观察记录归档，并进入下一观察窗口。" : nextAction,
    evidence
  };
}

function buildStaticPostCutoverObservation(snapshots, dispatchRequests, reconciliationReviews, siteJointPatrol, cutoverCommand, mobileDuty, processAudit = [], securityEvents = []) {
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const pendingRecon = reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status));
  const critical = snapshots.filter((item) => item.normalizedStatus === "critical");
  const warning = snapshots.filter((item) => item.normalizedStatus === "warning");
  const cutoverBlocking = Number(cutoverCommand?.summary?.blocking || 0);
  const cutoverPending = Number(cutoverCommand?.summary?.pending || 0);
  const patrolPending = Number(siteJointPatrol?.summary?.pending || 0);
  const reminders = Number(mobileDuty?.summary?.reminders || 0);
  const items = [
    staticPostCutoverItem("observation-runtime-health", "运行健康与接口可用性", "平台运维", cutoverBlocking ? "高" : warning.length ? "中" : "常规", `${critical.length}家严重，${warning.length}家预警`, "联合健康检查、指标接口与运行快照观察上线后基础可用性。", "持续观察健康检查、接口耗时、错误率和关键告警。", ["/api/health", "/api/metrics", "/api/operations/post-cutover-observation"], processAudit),
    staticPostCutoverItem("observation-resource-pressure", "床位人员设备压力", "运行调度席", critical.length ? "高" : warning.length ? "中" : "常规", `${critical.length + warning.length}家机构需关注`, "观察床位、ICU、人员缺口、设备占用和门急诊积压。", "高压机构需进入调度席人工复核，并准备跨院资源支援。", ["/api/operations/dashboard", "/api/operations/resource-pool"], processAudit),
    staticPostCutoverItem("observation-dispatch-backlog", "资源调度积压", "医政医管处", openDispatches.length >= 3 ? "高" : openDispatches.length ? "中" : "常规", `${openDispatches.length}张未关闭调度单`, "观察调度单创建、分派、执行、关闭是否形成闭环。", "未关闭调度单需明确责任医院、资源类型和预计关闭时间。", ["/api/operations/dispatch", "/api/operations/resource-pool"], processAudit),
    staticPostCutoverItem("observation-reconciliation", "统计直报复核", "统计办公室", pendingRecon.length >= 2 ? "高" : pendingRecon.length ? "中" : "常规", `${pendingRecon.length}批次待复核`, "观察统计直报、绩效指标异常说明和补正回执是否稳定。", "待复核批次需完成退回、补正、通过或关闭状态处理。", ["/api/operations/reconciliation/:id/review", "/api/operations/governance-report"], processAudit),
    staticPostCutoverItem("observation-site-joint-patrol", "现场联调巡检归档", "接口联调组", patrolPending >= 3 ? "高" : patrolPending ? "中" : "常规", `${patrolPending}项巡检待归档`, "观察真实样例报文、验签日志、回放记录、失败重试和接收端确认是否归档。", "待归档项需补齐现场截图、回放日志和接收端签字。", ["/api/operations/site-joint-patrol", "/api/operations/site-joint-patrol/actions"], processAudit),
    staticPostCutoverItem("observation-cutover-signoff", "割接签收与回退准备", "值班长", cutoverBlocking ? "高" : cutoverPending ? "中" : "常规", `${cutoverPending}项割接签收待完成`, "观察割接签收、回退策略、观察窗口和生产阻断项是否关闭。", "任一高优先级阻断项未签收时保持回退准备。", ["/api/operations/cutover-command", "/api/operations/cutover-command/actions"], processAudit),
    staticPostCutoverItem("observation-mobile-duty", "移动值守提醒", "运行监测岗", reminders ? "常规" : "中", `${reminders}条值守提醒`, "观察移动端提醒、弱网补传和消息回执是否形成留痕。", "尚无提醒时需向值班长发送一次上线后观察提醒。", ["/api/operations/mobile-duty", "/api/operations/mobile-duty/actions", "/api/messages"], processAudit)
  ];
  return {
    ok: items.length > 0 && items.every((item) => item.status === "已观察" || item.priority !== "高"),
    watchWindow: "T+0 2小时、T+0 8小时、T+1 24小时",
    windows: [
      { id: "t0-2h", name: "T+0 2小时", focus: "接口可用性、错误率、关键告警", owner: "平台运维", requiredEvidence: ["健康检查截图", "接口耗时截图", "关键告警记录"] },
      { id: "t0-8h", name: "T+0 8小时", focus: "床位压力、调度积压、直报复核", owner: "运行调度席", requiredEvidence: ["床位压力截图", "调度单关闭凭证", "直报复核清单"] },
      { id: "t1-24h", name: "T+1 24小时", focus: "巡检归档、回退准备、治理报告", owner: "值班长", requiredEvidence: ["巡检归档截图", "回退准备确认", "治理报告草稿"] }
    ],
    summary: {
      total: items.length,
      abnormal: items.filter((item) => item.priority === "高").length,
      watching: items.filter((item) => item.status === "观察中" || item.status === "异常待处置").length,
      observed: items.filter((item) => item.status === "已观察").length,
      auditEvents: processAudit.filter((item) => String(item.process || "").includes("上线后观察")).length,
      securityEvents: securityEvents.filter((item) => String(item.action || "").includes("post-cutover")).length
    },
    items,
    evidence: ["/api/operations/post-cutover-observation", "/api/operations/post-cutover-observation/actions", "platformProcessAudit", "securityEvents"]
  };
}

function buildStaticOperationsIntelligence(snapshots, dispatchRequests, reconciliationReviews) {
  const targets = [...snapshots].sort((a, b) => Number(a.bedOccupancyRate || 0) - Number(b.bedOccupancyRate || 0));
  const recommendations = snapshots.map((snapshot) => {
    const pendingRecon = reconciliationReviews.filter((item) => operationEntityMatched(snapshot, item) && !["approved", "closed"].includes(item.status));
    const openDispatches = dispatchRequests.filter((item) => operationEntityMatched(snapshot, item) && ["pending", "assigned", "in-progress"].includes(item.status));
    const target = targets.find((item) => item.institutionId !== snapshot.institutionId && Number(item.bedOccupancyRate || 0) <= 0.9);
    const riskScore = Math.min(100, Math.round(Number(snapshot.resourcePressure || 0) + Number(snapshot.outpatient?.waitingOver30Min || 0) * 0.2 + pendingRecon.length * 8));
    return {
      id: `intel-${snapshot.institutionId}`,
      institutionId: snapshot.institutionId,
      institution: snapshot.institution,
      riskLevel: riskScore >= 85 ? "高" : riskScore >= 65 ? "中" : "低",
      riskScore,
      prediction: {
        bedGapTomorrow: Math.max(0, Math.round(Number(snapshot.beds?.occupied || 0) * 1.03 - Number(snapshot.beds?.open || 0))),
        staffGapTonight: Math.max(Number(snapshot.staff?.shortage || 0), Math.ceil(Number(snapshot.outpatient?.waitingOver30Min || 0) / 45)),
        emergencyCongestion: Number(snapshot.outpatient?.waitingOver30Min || 0) >= 50 ? "可能拥堵" : "可控",
        reportingRisk: Number(snapshot.reporting?.varianceRate || 0) >= 0.05 ? "直报阻断风险" : "常规复核"
      },
      recommendation: target ? `建议优先向${zh(target.institution)}协调过渡床位或检查时段。` : "建议先启动院内备用资源和分诊分流。",
      reviewQueue: [
        ...openDispatches.map((item) => `调度单：${zh(item.resourceType)} ${item.quantity}`),
        ...pendingRecon.map((item) => `直报复核：${item.sourceBatch}`)
      ].slice(0, 4),
      confidence: riskScore >= 85 ? "高" : "中",
      evidence: ["/api/operations/dashboard", "/api/operations/intelligence"]
    };
  }).sort((a, b) => b.riskScore - a.riskScore);
  return {
    ok: recommendations.length > 0,
    summary: {
      recommendations: recommendations.length,
      highRisk: recommendations.filter((item) => item.riskLevel === "高").length,
      reviewItems: recommendations.reduce((sum, item) => sum + item.reviewQueue.length, 0)
    },
    recommendations
  };
}

function buildStaticGovernanceReport(snapshots, dispatchRequests, reconciliationReviews, performanceMonitoring, handover) {
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const pendingRecon = reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status));
  const exceptionSources = [...new Set(Object.values(performanceMonitoring?.manuals || {}).flatMap((manual) => manual.coverage?.pendingSources || []))];
  const maxVariance = Math.round(Math.max(...reconciliationReviews.map((item) => Number(item.varianceRate || 0)), 0) * 1000) / 10;
  const sections = [
    { id: "monthly-operations", title: "月度运行态势", owner: "规划发展与信息化处", metric: `${snapshots.length}家机构，${snapshots.filter((item) => item.normalizedStatus === "critical").length}家严重预警`, conclusion: "用于委端月度运行治理报告首屏。" },
    { id: "dispatch-review", title: "调度复盘", owner: "医政医管处/运行调度席", metric: `${openDispatches.length}个开放工单`, conclusion: "按资源类型和目标机构复盘响应时效。" },
    { id: "reconciliation-diff", title: "统计直报差异", owner: "统计办公室", metric: `${pendingRecon.length}项待复核，最高差异${maxVariance}%`, conclusion: "形成直报差异清单和退回/补正/阻断归档。" },
    { id: "performance-exception", title: "绩效异常说明", owner: "医务部/运营管理部门", metric: exceptionSources.length ? `待补接：${exceptionSources.join("、")}` : "绩效来源已纳入运行联动", conclusion: "将运行压力、直报差异和手册指标异常说明合并归档。" },
    { id: "handover-quality", title: "交接班质量", owner: "运行监测岗", metric: `${handover?.summary?.items || 0}项交接事项，${handover?.summary?.signoffs || 0}次签收`, conclusion: "跟踪交接事项、责任组和下一班关注点。" }
  ];
  return {
    ok: true,
    period: "2026-06",
    exportName: "医院运行治理月报-2026-06",
    summary: {
      sections: sections.length,
      openDispatches: openDispatches.length,
      pendingReconciliation: pendingRecon.length,
      performanceExceptions: exceptionSources.length
    },
    sections,
    nextActions: ["导出委端月度运行治理报告", "归档直报差异清单和调度复盘清单", "将绩效异常说明与现场联调记录合并复核"],
    evidence: ["/api/operations/dashboard", "/api/operations/governance-report"]
  };
}

function buildStaticGovernanceExportPackage(
  snapshots,
  dispatchRequests,
  reconciliationReviews,
  performanceMonitoring,
  governanceReport,
  intelligence,
  handover
) {
  const pendingRecon = reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status));
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const exceptionSources = [...new Set(Object.values(performanceMonitoring?.manuals || {}).flatMap((manual) => manual.coverage?.pendingSources || []))];
  const files = [
    { id: "monthly-governance-report", name: "月度运行治理报告.md", type: "markdown", owner: "规划发展与信息化处", rows: Array.isArray(governanceReport?.sections) ? governanceReport.sections.length : 0, description: "汇总运行态势、调度复盘、直报差异、绩效异常和交接班质量。" },
    { id: "reconciliation-diff-list", name: "统计直报差异清单.csv", type: "csv", owner: "统计办公室", rows: pendingRecon.length, description: "列出待复核、退回、补正中和阻断的直报差异批次。" },
    { id: "dispatch-review-list", name: "资源调度复盘清单.csv", type: "csv", owner: "运行调度席", rows: dispatchRequests.length, description: "沉淀资源类型、数量、目标机构、状态、要求到位时间和审计轨迹。" },
    { id: "performance-exception-note", name: "绩效异常说明模板.md", type: "markdown", owner: "医务部/运营管理部门", rows: exceptionSources.length, description: "按绩效监测手册口径补充异常说明、数据来源和责任科室。" },
    { id: "attachment-index", name: "附件目录.json", type: "json", owner: "运行监测岗", rows: 5, description: "关联现场联调记录、交接签收、智能调度建议、审计记录和发布报告。" }
  ];
  const markdown = [
    `# ${governanceReport?.exportName || "医院运行治理月报"}`,
    "",
    `- 生成时间：${new Date().toISOString()}`,
    `- 机构数：${snapshots.length}`,
    `- 开放调度工单：${openDispatches.length}`,
    `- 待复核直报差异：${pendingRecon.length}`,
    `- 智能调度建议：${Array.isArray(intelligence?.recommendations) ? intelligence.recommendations.length : 0}`,
    `- 交接事项：${handover?.summary?.items || 0}`,
    "",
    "## 治理章节",
    "",
    ...(Array.isArray(governanceReport?.sections) ? governanceReport.sections : []).map((item) => `- ${item.title}：${item.metric}；${item.conclusion}`),
    "",
    "## 导出文件",
    "",
    ...files.map((item) => `- ${item.name}：${item.description}`),
    "",
    "## 复核要求",
    "",
    "- 导出前确认数据版本、复核人、附件编号和统计直报差异状态。",
    "- 导出后将文件包编号写入审计记录，并与现场联调证据、发布报告一并归档。"
  ].join("\n");
  return {
    ok: true,
    packageName: `${governanceReport?.exportName || "医院运行治理月报"}-导出包`,
    version: `static-${files.length}-${pendingRecon.length}-${dispatchRequests.length}`,
    summary: {
      files: files.length,
      sections: Array.isArray(governanceReport?.sections) ? governanceReport.sections.length : 0,
      pendingReconciliation: pendingRecon.length,
      dispatchReviews: dispatchRequests.length,
      performanceExceptions: exceptionSources.length
    },
    files,
    markdown,
    checklist: ["确认月报模板、直报差异清单和附件编号规则。", "由统计办公室复核差异状态，由运行调度席复核工单闭环。", "导出包编号写入平台过程审计，现场正式版需完成签收归档。"],
    evidence: ["/api/operations/governance-report", "/api/operations/governance-export-package", "/api/process-audit"]
  };
}

function buildStaticResourcePool(snapshots, medicalResources, dispatchRequests) {
  const byInstitutionId = new Map(snapshots.map((item) => [String(item.institutionId || "").toLowerCase(), item]));
  const openStatuses = new Set(["pending", "assigned", "in-progress"]);
  const openDispatches = dispatchRequests.filter((item) => openStatuses.has(item.status));
  const rows = medicalResources.map((resource) => {
    const snapshot = byInstitutionId.get(String(resource.id || resource.institutionId || "").toLowerCase()) || {};
    const availableBeds = snapshot.beds ? Math.max(0, Number(snapshot.beds.open || 0) - Number(snapshot.beds.occupied || 0)) : Math.max(0, Math.round(Number(resource.beds || 0) * 0.08));
    const availableIcuBeds = snapshot.beds ? Math.max(0, Number(snapshot.beds.icuTotal || 0) - Number(snapshot.beds.icuOccupied || 0)) : Math.max(0, Math.round(Number(resource.beds || 0) * 0.01));
    const availableVentilators = Number(snapshot.equipment?.ventilatorsAvailable ?? Math.max(0, Math.round(Number(resource.devices || 0) * 0.25)));
    const availableAmbulances = Number(snapshot.equipment?.ambulancesAvailable ?? Math.max(1, Math.round(Number(resource.devices || 0) * 0.08)));
    const reserveDoctors = Math.max(0, Math.round(Number(resource.doctors || 0) * 0.03) - Number(snapshot.staff?.shortage || 0));
    const pressure = Number(snapshot.resourcePressure || 0);
    const status = snapshot.normalizedStatus === "critical" || pressure >= 85 ? "需保障本院" : availableBeds >= 20 || availableVentilators >= 8 || reserveDoctors >= 3 ? "可调拨" : "有限支援";
    return {
      id: `pool-${String(resource.id || resource.institution || "").toLowerCase()}`,
      institutionId: String(resource.id || resource.institutionId || "").toUpperCase(),
      institution: snapshot.institution || resource.institution,
      region: resource.region || snapshot.district || "待确认",
      institutionType: resource.type || "医疗机构",
      status,
      pressure,
      activeDispatches: openDispatches.filter((item) => operationEntityMatched(snapshot, item) || String(item.targetInstitutionId || "").toLowerCase() === String(resource.id || "").toLowerCase()).length,
      resourceSlots: [
        { type: "普通床位", available: availableBeds, unit: "张", boundary: "优先用于急诊留观、下转过渡和择期手术错峰。" },
        { type: "ICU床位", available: availableIcuBeds, unit: "张", boundary: "需医政医管处确认重症收治边界和转运风险。" },
        { type: "呼吸机", available: availableVentilators, unit: "台", boundary: "调拨前确认设备编号、消毒状态和随设备耗材。" },
        { type: "救护车", available: availableAmbulances, unit: "辆", boundary: "用于跨院转运或急诊分流，需同步调度指令。" },
        { type: "值班医生", available: reserveDoctors, unit: "人", boundary: "只作为短时支援能力，需目标科室确认执业和排班边界。" }
      ],
      protocol: {
        approval: status === "可调拨" ? "运行调度席初审，医政医管处确认" : "先保障本院运行，再评估支援",
        responseSla: status === "可调拨" ? "2小时确认，4小时到位" : "4小时内复核可支援边界",
        audit: "形成申请、审批、执行、关闭、复盘和审计留痕。"
      },
      evidence: ["/api/operations/resource-pool", "/api/operations/dashboard", "medicalResources"]
    };
  }).sort((a, b) => (a.status === "可调拨" ? -1 : 1) - (b.status === "可调拨" ? -1 : 1) || b.resourceSlots[0].available - a.resourceSlots[0].available);
  const highPressure = snapshots.filter((item) => item.normalizedStatus === "critical" || Number(item.resourcePressure || 0) >= 85);
  const donors = rows.filter((item) => item.status === "可调拨");
  const recommendations = highPressure.map((source, index) => {
    const target = donors.find((item) => String(item.institutionId).toLowerCase() !== String(source.institutionId || "").toLowerCase()) || donors[index % Math.max(1, donors.length)];
    return {
      id: `resource-match-${source.institutionId || index}`,
      sourceInstitutionId: source.institutionId,
      sourceInstitution: source.institution,
      targetInstitutionId: target?.institutionId || "",
      targetInstitution: target?.institution || "待人工指定",
      resourceType: Number(source.beds?.icuOccupied || 0) / Math.max(1, Number(source.beds?.icuTotal || 0)) >= 0.9 ? "ICU床位/呼吸机" : "过渡床位/急诊分流",
      priority: source.normalizedStatus === "critical" ? "高" : "中",
      reason: `资源压力 ${source.resourcePressure || 0}，开放调度工单 ${openDispatches.filter((item) => operationEntityMatched(source, item)).length} 条。`,
      suggestedAction: target ? `建议向${zh(target.institution)}申请${target.resourceSlots[0].available}张以内过渡床位或设备支援。` : "建议先由运行调度席人工指定支援机构。",
      evidence: ["/api/operations/resource-pool", "/api/operations/dispatch"]
    };
  });
  return {
    ok: rows.length > 0,
    summary: {
      institutions: rows.length,
      transferableInstitutions: rows.filter((item) => item.status === "可调拨").length,
      transferableBeds: rows.reduce((sum, item) => sum + Number(item.resourceSlots.find((slot) => slot.type === "普通床位")?.available || 0), 0),
      icuBeds: rows.reduce((sum, item) => sum + Number(item.resourceSlots.find((slot) => slot.type === "ICU床位")?.available || 0), 0),
      ventilators: rows.reduce((sum, item) => sum + Number(item.resourceSlots.find((slot) => slot.type === "呼吸机")?.available || 0), 0),
      openDispatches: openDispatches.length,
      recommendations: recommendations.length
    },
    rows,
    recommendations,
    evidence: ["/api/operations/resource-pool", "medicalResources", "resourceDispatchRequests"]
  };
}

function buildStaticMobileDuty(snapshots, dispatchRequests, reconciliationReviews, handover, taskMessages = []) {
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const pendingRecon = reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status));
  const handoverItems = Array.isArray(handover?.items) ? handover.items : [];
  const highPressure = snapshots.filter((item) => item.normalizedStatus === "critical" || Number(item.resourcePressure || 0) >= 85 || (item.activeAlerts || []).some((alert) => alert.severity === "critical"));
  const recentMessages = (Array.isArray(taskMessages) ? taskMessages : [])
    .filter((message) => message.collection === "hospitalOperationsMobileDuty" || String(message.taskId || "").startsWith("operations-mobile-duty:"))
    .slice(0, 8);
  const cards = [
    {
      id: "mobile-duty-alert-confirm",
      type: "alert-confirm",
      title: "预警确认",
      priority: highPressure.length ? "高" : "常规",
      count: highPressure.length,
      owner: "运行监测岗",
      status: highPressure.length ? "待确认" : "已关注",
      summary: highPressure.length ? `${highPressure.length}家机构处于高压或严重预警状态` : "当前无严重预警机构",
      nextAction: highPressure.length ? "移动端确认预警、记录电话核实结果并同步值班长。" : "保持弱网缓存和定时巡检。",
      evidence: ["/api/operations/dashboard", "/api/operations/mobile-duty"]
    },
    {
      id: "mobile-duty-handover-signoff",
      type: "handover-signoff",
      title: "交接签收",
      priority: handoverItems.some((item) => item.severity === "critical") ? "高" : "中",
      count: handoverItems.length,
      owner: "值班长",
      status: handoverItems.length ? "待签收" : "无交接事项",
      summary: `${handoverItems.length}项交接事项需要移动端复核`,
      nextAction: "移动端完成交接签收、补充下一班关注点并写入审计。",
      evidence: ["/api/operations/handover", "/api/operations/handover/signoff"]
    },
    {
      id: "mobile-duty-dispatch-note",
      type: "dispatch-note",
      title: "调度备注",
      priority: openDispatches.some((item) => item.priority === "high") ? "高" : "中",
      count: openDispatches.length,
      owner: "调度席",
      status: openDispatches.length ? "待跟进" : "无开放工单",
      summary: `${openDispatches.length}条开放调度单需要移动端更新处置进展`,
      nextAction: "补充资源到位、转运、执行人和预计关闭时间。",
      evidence: ["/api/operations/dispatch", "/api/operations/dispatch/:id/status"]
    },
    {
      id: "mobile-duty-reconciliation-reminder",
      type: "reconciliation-reminder",
      title: "直报复核提醒",
      priority: pendingRecon.some((item) => item.status === "blocked") ? "高" : "中",
      count: pendingRecon.length,
      owner: "统计办公室",
      status: pendingRecon.length ? "待复核" : "已清零",
      summary: `${pendingRecon.length}条统计直报差异等待复核`,
      nextAction: "提醒责任科室确认差异口径、补正说明和提交时限。",
      evidence: ["/api/operations/reconciliation/:id/review", "healthStatisticsIngestion"]
    }
  ];
  return {
    ok: true,
    summary: {
      cards: cards.length,
      highPriority: cards.filter((item) => item.priority === "高").length,
      pendingActions: cards.reduce((sum, item) => sum + Number(item.count || 0), 0),
      reminders: recentMessages.length
    },
    weakNetwork: {
      mode: "cache-last-state",
      offlineDrafts: true,
      retryPolicy: "网络恢复后按审计时间顺序补传签收、备注和提醒。"
    },
    cards,
    recentMessages,
    evidence: ["/api/operations/mobile-duty", "operationHandoverSignoffs", "taskMessages", "securityEvents"]
  };
}

function buildStaticNextDevelopmentResearch(
  snapshots,
  dispatchRequests,
  reconciliationReviews,
  performanceMonitoring,
  siteJointTests,
  productionHardening,
  intelligence,
  governanceReport,
  handover
) {
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const pendingRecon = reconciliationReviews.filter((item) => !["approved", "closed"].includes(item.status));
  const highPressure = snapshots.filter((item) => item.normalizedStatus === "critical" || Number(item.resourcePressure || 0) >= 85);
  const completedJointTests = Number(siteJointTests?.summary?.completed || 0);
  const totalJointTests = Number(siteJointTests?.summary?.total || 0);
  const blockedHardening = Number(productionHardening?.summary?.blocked || 0);
  const intelligenceRows = Array.isArray(intelligence?.recommendations) ? intelligence.recommendations : [];
  const governanceSections = Number(governanceReport?.summary?.sections || 0);
  const handoverItems = Number(handover?.summary?.items || 0);
  const tracks = [
    {
      id: "field-integration-command-center",
      priority: "P0",
      phase: "现场联调深化",
      name: "多源真实报文联调驾驶舱",
      owner: "接口联调组/信息中心",
      problem: `当前已沉淀${totalJointTests}类现场联调项，仍需把样例报文、回放日志和失败重试转成日常可追踪闭环。`,
      deliverable: "已上线现场联调巡检台，按HIS、EMR、LIS、PACS、HRP、120急救和统计直报来源展示报文状态、字段映射、验签日志、回放记录、失败重试和接收端确认。",
      prerequisites: ["接入真实样例报文", "统一机构编码", "补齐失败重试回执", "现场联调签字归档"],
      dataSources: ["operationIntegrationAudit", "healthStatisticsIngestion", "hospitalOperationSnapshots"],
      acceptance: completedJointTests >= totalJointTests && totalJointTests > 0 ? "联调项已具备演示闭环，下一步进入真实报文日常巡检。" : "至少完成全部来源的样例报文、验签日志、回放记录和失败重试截图。",
      evidence: ["/api/operations/site-joint-tests", "/api/operations/site-joint-patrol", "/api/operations/interface-mapping"]
    },
    {
      id: "production-cutover-ops",
      priority: "P0",
      phase: "生产割接运营",
      name: "割接值守与回退演练台",
      owner: "平台运维/安全管理岗",
      problem: `生产加固仍有${blockedHardening}项需要现场签字或环境变量确认。`,
      deliverable: "形成割接窗口、值守人、监控阈值、回退路径、审计保全和灾备演练的一屏确认台。",
      prerequisites: ["生产密钥轮换", "监控值守签字", "灾备演练记录", "回退责任人确认"],
      dataSources: ["platformProcessAudit", "securityEvents", "/api/health", "/api/metrics"],
      acceptance: "生产前发布报告无阻断项，割接、监控、审计、回退均完成签字归档。",
      evidence: ["/api/operations/production-hardening", "/api/system/readiness"]
    },
    {
      id: "predictive-capacity-model",
      priority: "P1",
      phase: "智能调度增强",
      name: "床位/人员/设备预测模型与采纳率闭环",
      owner: "医务运行调度岗/数据分析岗",
      problem: `当前有${intelligenceRows.length}条智能调度建议，仍需记录人工采纳、驳回原因和次日实际压力。`,
      deliverable: "把预测缺口、调度建议、人工决策、实际床位压力和工单关闭结果串成模型评估面板。",
      prerequisites: ["调度工单状态闭环", "采纳/驳回原因字典", "次日运行快照", "模型版本号"],
      dataSources: ["resourceDispatchRequests", "hospitalOperationSnapshots", "medicalResources"],
      acceptance: "展示建议采纳率、调度后压力变化、误报漏报案例和模型版本回溯。",
      evidence: ["/api/operations/intelligence", "/api/operations/dispatch"]
    },
    {
      id: "cross-hospital-resource-market",
      priority: "P1",
      phase: "跨院资源协同",
      name: "跨院资源池与调拨协议",
      owner: "医政医管处/医联体办公室",
      problem: `当前开放调度工单${openDispatches.length}条，需要把院内请求升级为跨院资源池和协议化调拨。`,
      deliverable: "按床位、ICU、检查设备、值班人员和转运能力形成可申请、可审批、可追踪的跨院资源池。",
      prerequisites: ["资源口径统一", "调拨审批规则", "目标医院确认机制", "转运责任边界"],
      dataSources: ["medicalResources", "resourceDispatchRequests", "hospitalOperationSnapshots"],
      acceptance: "跨院调拨工单可完成申请、受理、执行、关闭、复盘和审计追踪。",
      evidence: ["/api/operations/dashboard", "/api/operations/dispatch"]
    },
    {
      id: "governance-export-center",
      priority: "P1",
      phase: "治理报表导出",
      name: "委端月报、绩效异常和直报差异导出中心",
      owner: "统计办公室/规划发展与信息化处",
      problem: `治理报表已有${governanceSections}个章节，待复核直报差异${pendingRecon.length}项，需要可下载、可留痕的报表包。`,
      deliverable: "导出月度运行治理报告、绩效异常说明、直报差异清单、调度复盘和附件目录。",
      prerequisites: ["报表模板定稿", "异常说明字段", "附件编号规则", "复核签收流程"],
      dataSources: ["healthStatistics", "statisticsReconciliationReviews", "platformProcessAudit"],
      acceptance: "导出的报告包可追溯生成时间、数据版本、复核人、差异状态和附件证据。",
      evidence: ["/api/operations/governance-report", "/api/operations/reconciliation/:id/review"]
    },
    {
      id: "mobile-command",
      priority: "P2",
      phase: "移动值守",
      name: "移动端值守与消息闭环",
      owner: "运行监测岗/值班长",
      problem: `交接事项${handoverItems}项，高压机构${highPressure.length}家，夜间值守需要更轻量的确认和提醒入口。`,
      deliverable: "已上线移动值守台，集中查看预警、工单、交接事项和待复核直报差异，并支持提醒生成、弱网补传说明和审计留痕。",
      prerequisites: ["移动端角色权限", "消息模板", "签收审计字段", "弱网重试策略"],
      dataSources: ["operationHandoverSignoffs", "taskMessages", "securityEvents"],
      acceptance: "移动值守可完成预警确认、交接签收、调度备注和审计留痕。",
      evidence: ["/api/operations/mobile-duty", "/api/operations/mobile-duty/actions", "/api/messages", "/api/process-audit"]
    }
  ];
  return {
    ok: true,
    horizon: "2026-Q3 至 2026-Q4",
    summary: {
      tracks: tracks.length,
      p0: tracks.filter((item) => item.priority === "P0").length,
      p1: tracks.filter((item) => item.priority === "P1").length,
      p2: tracks.filter((item) => item.priority === "P2").length,
      readyForFieldResearch: completedJointTests,
      blockedForCutover: blockedHardening,
      pendingReconciliation: pendingRecon.length
    },
    tracks,
    risks: [
      "真实报文、生产密钥、移动端消息和跨院调拨均需现场制度与安全边界共同确认。",
      "预测模型上线前必须保留人工复核、采纳原因、驳回原因和审计留痕。",
      "委端导出件应锁定数据版本，避免月报、直报和绩效说明口径漂移。"
    ],
    nextSprint: [
      "把现场联调闭环升级为真实报文巡检和失败重试看板。",
      "把生产加固清单接入割接值守、回退演练和监控签字。",
      "为智能调度建议增加采纳率、驳回原因和次日压力校验。",
      "沉淀委端月报导出模板和直报差异附件包。"
    ],
    evidence: ["/api/operations/dashboard", "/api/operations/next-development-research", "hospital-operations-module-report.md"]
  };
}

function operationEntityMatched(left = {}, right = {}) {
  const leftId = String(left.institutionId || left.sourceInstitutionId || "").toLowerCase();
  const rightId = String(right.institutionId || right.sourceInstitutionId || "").toLowerCase();
  if (leftId && rightId && leftId === rightId) return true;
  const leftName = String(left.institution || left.sourceInstitution || "").trim().toLowerCase();
  const rightName = String(right.institution || right.sourceInstitution || "").trim().toLowerCase();
  return Boolean(leftName && rightName && leftName === rightName);
}

function staticCommandStage(snapshot, dispatches, reconciliations) {
  if (reconciliations.some((item) => item.status === "blocked")) {
    return { stage: "直报阻断", severity: "critical", owner: "统计直报专班", dueHours: 2, nextAction: "先关闭统计直报差异复核，再恢复上报提交。" };
  }
  const openDispatch = dispatches.find((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  if (openDispatch) {
    return {
      stage: openDispatch.status === "pending" ? "待分派调度" : "调度执行中",
      severity: openDispatch.priority === "high" ? "critical" : "warning",
      owner: "运行调度席",
      dueHours: openDispatch.priority === "high" ? 4 : 8,
      nextAction: "跟踪目标机构确认、资源到位和工单关闭留痕。"
    };
  }
  if (reconciliations.some((item) => !["approved", "closed"].includes(item.status))) {
    return { stage: "直报复核", severity: "warning", owner: "统计质控岗", dueHours: 12, nextAction: "核对平台采集值、直报暂存值和字段口径后提交复核结论。" };
  }
  if ((snapshot.activeAlerts || []).length) {
    return {
      stage: "预警复盘",
      severity: snapshot.normalizedStatus === "critical" ? "critical" : "warning",
      owner: "运行监测岗",
      dueHours: snapshot.normalizedStatus === "critical" ? 4 : 24,
      nextAction: "确认预警是否需要生成调度单或纳入绩效异常说明。"
    };
  }
  return { stage: "常态监测", severity: "normal", owner: "运行监测岗", dueHours: 24, nextAction: "维持日内监测，关注床位、门急诊、人员和直报趋势。" };
}

function buildStaticCommandChains(snapshots, dispatchRequests, reconciliationReviews) {
  return snapshots.map((snapshot) => {
    const dispatches = dispatchRequests.filter((item) => operationEntityMatched(snapshot, item));
    const reconciliations = reconciliationReviews.filter((item) => operationEntityMatched(snapshot, item));
    const stage = staticCommandStage(snapshot, dispatches, reconciliations);
    const openDispatches = dispatches.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
    const pendingReconciliations = reconciliations.filter((item) => !["approved", "closed"].includes(item.status));
    return {
      id: `chain-${snapshot.id}`,
      institutionId: snapshot.institutionId,
      institution: snapshot.institution,
      status: snapshot.normalizedStatus,
      resourcePressure: snapshot.resourcePressure,
      alertCount: (snapshot.activeAlerts || []).length,
      openDispatchCount: openDispatches.length,
      pendingReconciliationCount: pendingReconciliations.length,
      stage: stage.stage,
      severity: stage.severity,
      owner: stage.owner,
      dueHours: stage.dueHours,
      sla: buildStaticCommandSla(snapshot, dispatches, reconciliations, stage),
      nextAction: stage.nextAction,
      steps: [
        { name: "运行监测", status: (snapshot.activeAlerts || []).length ? "触发预警" : "正常", count: (snapshot.activeAlerts || []).length },
        { name: "资源调度", status: openDispatches.length ? "进行中" : "无待办", count: openDispatches.length },
        { name: "直报复核", status: pendingReconciliations.length ? "待关闭" : "已闭环", count: pendingReconciliations.length },
        { name: "绩效说明", status: snapshot.resourcePressure >= 80 || pendingReconciliations.length ? "需说明" : "常规归档", count: snapshot.resourcePressure >= 80 || pendingReconciliations.length ? 1 : 0 }
      ]
    };
  }).sort((a, b) => statusSeverity(b.severity) - statusSeverity(a.severity) || Number(b.resourcePressure || 0) - Number(a.resourcePressure || 0));
}

function playbookOwnerForDomain(domain) {
  return {
    beds: "医务部/运行调度席",
    staff: "人事科/护理部/医务部",
    outpatient: "门诊部/急诊科/设备科",
    equipment: "设备科/急诊科",
    statistics: "统计直报专班"
  }[domain] || "运行监测岗";
}

function playbookActionsForDomain(domain) {
  return {
    beds: ["确认开放床位和占用口径", "启动院内备用床位", "评估跨院转运或下转", "同步绩效异常说明"],
    staff: ["核对排班和请假变更", "启用备用班次或跨科支援", "记录人员缺口原因", "追踪到岗确认"],
    outpatient: ["调整门急诊分诊队列", "释放检查检验优先时段", "同步候诊超时说明", "必要时启动区域分流"],
    equipment: ["核对设备停机和可用台数", "协调共享设备或外院检查", "记录维修预计恢复时间", "更新调度工单"],
    statistics: ["冻结直报提交", "核对平台采集值和直报暂存值", "形成退回/补正/阻断结论", "归档复核证据"]
  }[domain] || ["确认告警来源", "指定责任科室", "记录处置过程", "关闭复盘证据"];
}

function buildStaticOperationsPlaybooks(snapshots, alertRules, commandChains, interfaceMapping) {
  const chainsByInstitution = new Map((commandChains || []).map((item) => [item.institutionId, item]));
  return (alertRules || []).map((rule) => {
    const relatedSnapshots = (snapshots || []).filter((snapshot) => (snapshot.activeAlerts || []).some((alert) => alert.id === rule.id));
    const chainOwners = [...new Set(relatedSnapshots.map((snapshot) => chainsByInstitution.get(snapshot.institutionId)?.owner).filter(Boolean))];
    const fields = (interfaceMapping?.mappings || [])
      .filter((mapping) => (mapping.targetField || "").includes(rule.domain) || (mapping.targetCollection === "statisticsReconciliationReviews" && rule.domain === "statistics"))
      .flatMap((mapping) => mapping.fields || [])
      .slice(0, 8);
    const severity = relatedSnapshots.some((snapshot) => snapshot.normalizedStatus === "critical") || rule.severity === "critical" ? "critical" : relatedSnapshots.length ? "warning" : "normal";
    return {
      id: `playbook-${rule.id}`,
      ruleId: rule.id,
      domain: rule.domain,
      severity,
      owner: chainOwners[0] || playbookOwnerForDomain(rule.domain),
      trigger: rule.threshold,
      dispatchBoundary: rule.dispatchBoundary,
      activeInstitutions: relatedSnapshots.length,
      activeInstitutionNames: relatedSnapshots.map((snapshot) => snapshot.institution),
      slaHours: rule.severity === "critical" ? 4 : rule.domain === "statistics" ? 12 : 24,
      requiredFields: fields,
      actions: playbookActionsForDomain(rule.domain),
      evidence: ["/api/operations/dashboard", "/api/operations/command-chains", "/api/operations/interface-mapping"]
    };
  }).sort((a, b) => statusSeverity(b.severity) - statusSeverity(a.severity) || b.activeInstitutions - a.activeInstitutions);
}

function buildStaticOperationsHandover(snapshots, dispatchRequests, reconciliationReviews, commandChains, playbooks, handoverSignoffs = []) {
  const openStatuses = new Set(["pending", "assigned", "in-progress"]);
  const items = (commandChains || [])
    .filter((chain) => chain.severity !== "normal" || chain.openDispatchCount || chain.pendingReconciliationCount || chain.sla?.overdue)
    .map((chain) => {
      const snapshot = (snapshots || []).find((item) => item.institutionId === chain.institutionId || item.institution === chain.institution) || {};
      const dispatches = (dispatchRequests || []).filter((item) => operationEntityMatched(snapshot, item) && openStatuses.has(item.status));
      const reconciliations = (reconciliationReviews || []).filter((item) => operationEntityMatched(snapshot, item) && !["approved", "closed"].includes(item.status));
      const matchedPlaybooks = (playbooks || []).filter((item) => (item.activeInstitutionNames || []).includes(chain.institution));
      const remainingMinutes = Number(chain.sla?.remainingMinutes);
      const dueSoon = !chain.sla?.overdue && Number.isFinite(remainingMinutes) && remainingMinutes <= 240;
      const riskSignals = [
        chain.alertCount ? `活动预警 ${chain.alertCount} 项` : "",
        dispatches.length ? `开放调度 ${dispatches.length} 单` : "",
        reconciliations.length ? `待复核 ${reconciliations.length} 项` : "",
        matchedPlaybooks.length ? `命中预案 ${matchedPlaybooks.length} 条` : "",
        chain.sla?.overdue ? "SLA 已超时" : dueSoon ? "SLA 临期" : ""
      ].filter(Boolean);
      return {
        id: `handover-${chain.institutionId || chain.institution}`,
        institutionId: chain.institutionId,
        institution: chain.institution,
        severity: chain.sla?.overdue ? "critical" : dueSoon && chain.severity === "normal" ? "warning" : chain.severity,
        stage: chain.stage,
        owner: chain.owner,
        dueAt: chain.sla?.dueAt || "",
        dueStatus: chain.sla?.status || "",
        remainingMinutes: Number.isFinite(remainingMinutes) ? remainingMinutes : null,
        riskSignals,
        checkpoints: [
          "确认最新床位、人员、设备、门急诊和住院运行快照",
          "核对调度单责任人、到位时间和审计留痕",
          "复核统计直报差异结论与退回/阻断状态",
          "记录绩效异常说明和下一班跟进边界"
        ],
        nextActions: [chain.nextAction, ...matchedPlaybooks.flatMap((item) => item.actions || []).slice(0, 3)].filter(Boolean).slice(0, 4),
        evidence: ["/api/operations/dashboard", "/api/operations/command-chains", "/api/operations/playbooks", "/api/operations/handover"]
      };
    })
    .sort((a, b) => statusSeverity(b.severity) - statusSeverity(a.severity) || Number(a.remainingMinutes ?? 99999) - Number(b.remainingMinutes ?? 99999));
  const recentSignoffs = [...(Array.isArray(handoverSignoffs) ? handoverSignoffs : [])]
    .sort((a, b) => new Date(b.signedAt || 0) - new Date(a.signedAt || 0))
    .slice(0, 8);
  return {
    ok: true,
    summary: {
      items: items.length,
      critical: items.filter((item) => item.severity === "critical").length,
      dueSoon: items.filter((item) => item.remainingMinutes !== null && item.remainingMinutes <= 240 && item.remainingMinutes >= 0).length,
      overdue: items.filter((item) => item.riskSignals.includes("SLA 已超时")).length,
      owners: new Set(items.map((item) => item.owner).filter(Boolean)).size,
      signoffs: recentSignoffs.length
    },
    shiftNote: "交班清单用于院级运行调度值班、统计直报复核和绩效异常说明的同屏交接。",
    items,
    recentSignoffs
  };
}

function buildStaticHandoverOwnerMatrix(handover) {
  const items = Array.isArray(handover?.items) ? handover.items : [];
  const owners = new Map();
  items.forEach((item) => {
    const owner = item.owner || "运行监测岗";
    const current = owners.get(owner) || {
      id: `handover-owner-${owners.size + 1}`,
      owner,
      itemCount: 0,
      criticalCount: 0,
      dueSoonCount: 0,
      overdueCount: 0,
      institutions: [],
      stages: [],
      nextActions: [],
      evidence: ["/api/operations/handover", "/api/operations/handover/owners"]
    };
    current.itemCount += 1;
    current.criticalCount += item.severity === "critical" ? 1 : 0;
    current.dueSoonCount += item.remainingMinutes !== null && item.remainingMinutes <= 240 && item.remainingMinutes >= 0 ? 1 : 0;
    current.overdueCount += (item.riskSignals || []).includes("SLA 已超时") ? 1 : 0;
    current.institutions = [...new Set([...current.institutions, item.institution].filter(Boolean))];
    current.stages = [...new Set([...current.stages, item.stage].filter(Boolean))];
    current.nextActions = [...new Set([...current.nextActions, ...(item.nextActions || [])].filter(Boolean))].slice(0, 5);
    owners.set(owner, current);
  });
  const matrix = [...owners.values()].sort((a, b) => b.criticalCount - a.criticalCount || b.dueSoonCount - a.dueSoonCount || b.itemCount - a.itemCount);
  return {
    ok: true,
    summary: {
      owners: matrix.length,
      items: matrix.reduce((sum, item) => sum + item.itemCount, 0),
      critical: matrix.reduce((sum, item) => sum + item.criticalCount, 0),
      dueSoon: matrix.reduce((sum, item) => sum + item.dueSoonCount, 0),
      overdue: matrix.reduce((sum, item) => sum + item.overdueCount, 0)
    },
    matrix
  };
}

function addHours(value, hours) {
  const base = new Date(value || Date.now());
  if (Number.isNaN(base.getTime())) return "";
  base.setHours(base.getHours() + Number(hours || 0));
  return base.toISOString();
}

function buildStaticCommandSla(snapshot, dispatches, reconciliations, stage) {
  const openDispatch = dispatches.find((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const pendingReconciliation = reconciliations.find((item) => !["approved", "closed"].includes(item.status));
  const dueAt = openDispatch?.requiredBy || addHours(snapshot.snapshotAt, stage.dueHours);
  const dueTime = new Date(dueAt);
  const now = new Date();
  const closed = !openDispatch && !pendingReconciliation && !(snapshot.activeAlerts || []).length;
  const overdue = !closed && !Number.isNaN(dueTime.getTime()) && dueTime.getTime() < now.getTime();
  return {
    dueAt,
    status: closed ? "已闭环" : overdue ? "已超时" : "进行中",
    overdue,
    remainingMinutes: Number.isNaN(dueTime.getTime()) ? null : Math.round((dueTime.getTime() - now.getTime()) / 60000),
    owner: stage.owner,
    escalation: overdue ? `${stage.owner}需补充超时原因、资源到位情况和下一步闭环时间。` : "按处置链继续跟踪。"
  };
}

function renderOperationsDashboard() {
  const dashboard = operationsDashboard || {};
  const filteredSnapshots = filterSnapshots(dashboard.snapshots || []);
  if (!filteredSnapshots.some((item) => item.id === selectedSnapshotId)) selectedSnapshotId = filteredSnapshots[0]?.id || dashboard.snapshots?.[0]?.id || "";
  const selected = (dashboard.snapshots || []).find((item) => item.id === selectedSnapshotId) || filteredSnapshots[0] || null;
  renderOperationsMetrics(dashboard.summary || {}, filteredSnapshots);
  renderOperationsSituation(dashboard, filteredSnapshots, selected);
  renderPerformanceManual(dashboard, filteredSnapshots);
  renderInterfaceMapping(dashboard.interfaceMapping || buildStaticInterfaceMapping());
  renderSiteJointTests(dashboard.siteJointTests || buildStaticSiteJointTests(dashboard.interfaceMapping || buildStaticInterfaceMapping()));
  renderSiteJointPatrol(dashboard.siteJointPatrol || buildStaticSiteJointPatrol(dashboard.siteJointTests || {}, dashboard.dispatchRequests || [], dashboard.reconciliationReviews || []));
  renderProductionHardening(dashboard.productionHardening || buildStaticProductionHardening({}));
  renderCutoverCommand(dashboard.cutoverCommand || buildStaticCutoverCommand(dashboard.productionHardening || {}, dashboard.siteJointPatrol || {}, dashboard.mobileDuty || {}, [], []));
  renderPostCutoverObservation(dashboard.postCutoverObservation || buildStaticPostCutoverObservation(filteredSnapshots, dashboard.dispatchRequests || [], dashboard.reconciliationReviews || [], dashboard.siteJointPatrol || {}, dashboard.cutoverCommand || {}, dashboard.mobileDuty || {}, [], []));
  renderOperationsIntelligence(dashboard.intelligence || buildStaticOperationsIntelligence(filteredSnapshots, dashboard.dispatchRequests || [], dashboard.reconciliationReviews || []));
  renderResourcePool(dashboard.resourcePool || buildStaticResourcePool(filteredSnapshots, dashboard.medicalResources || [], dashboard.dispatchRequests || []));
  renderMobileDuty(dashboard.mobileDuty || buildStaticMobileDuty(filteredSnapshots, dashboard.dispatchRequests || [], dashboard.reconciliationReviews || [], dashboard.handover || {}, []));
  renderGovernanceReport(
    dashboard.governanceReport || buildStaticGovernanceReport(filteredSnapshots, dashboard.dispatchRequests || [], dashboard.reconciliationReviews || [], dashboard.performanceMonitoring || {}, dashboard.handover || {}),
    dashboard.governanceExportPackage
  );
  renderNextDevelopmentResearch(dashboard.nextDevelopmentResearch || buildStaticNextDevelopmentResearch(
    filteredSnapshots,
    dashboard.dispatchRequests || [],
    dashboard.reconciliationReviews || [],
    dashboard.performanceMonitoring || {},
    dashboard.siteJointTests || {},
    dashboard.productionHardening || {},
    dashboard.intelligence || {},
    dashboard.governanceReport || {},
    dashboard.handover || {}
  ));
  renderCommandChains(dashboard.commandChains || [], filteredSnapshots);
  renderOperationsPlaybooks(dashboard.playbooks || [], filteredSnapshots);
  renderHandoverOwnerMatrix(dashboard.handoverOwnerMatrix || buildStaticHandoverOwnerMatrix(dashboard.handover || {}), filteredSnapshots);
  renderOperationsHandover(dashboard.handover || {}, filteredSnapshots);
  renderOperationsSnapshots(filteredSnapshots);
  renderOperationDetail(selected);
  renderAlertQueue(filteredSnapshots);
  renderAlertRules(dashboard.alertRules || []);
  renderDispatchRequests(dashboard.dispatchRequests || []);
  renderReconciliationReviews(dashboard.reconciliationReviews || []);
  const boundary = document.querySelector("#operations-boundary");
  if (boundary) boundary.textContent = `${zhList(dashboard.boundaries || [], " / ")} | 复用：${zhList(dashboard.reusedCollections || [])}`;
}

function renderOperationsSituation(dashboard, filteredSnapshots, selected) {
  const strip = document.querySelector("#operations-situation-strip");
  const links = document.querySelector("#operations-focus-links");
  if (!strip || !links) return;
  const snapshots = Array.isArray(dashboard.snapshots) ? dashboard.snapshots : [];
  const dispatchRequests = Array.isArray(dashboard.dispatchRequests) ? dashboard.dispatchRequests : [];
  const reconciliationReviews = Array.isArray(dashboard.reconciliationReviews) ? dashboard.reconciliationReviews : [];
  const urgent = [...filteredSnapshots].sort((a, b) => Number(b.resourcePressure || 0) - Number(a.resourcePressure || 0))[0] || selected;
  const openDispatches = dispatchRequests.filter((item) => ["pending", "assigned", "in-progress"].includes(item.status));
  const blockedReviews = reconciliationReviews.filter((item) => ["blocked", "pending-review", "returned", "correcting"].includes(item.status));
  const criticalCount = filteredSnapshots.filter((item) => item.normalizedStatus === "critical").length;
  const warningCount = filteredSnapshots.filter((item) => item.normalizedStatus === "warning").length;
  const selectedAlerts = selected?.activeAlerts?.length || 0;
  const selectedPressure = Number(selected?.resourcePressure || 0);
  strip.innerHTML = `
    <article class="operations-situation-main ${urgent?.normalizedStatus || "normal"}">
      <div>
        <strong>${urgent ? zh(urgent.institution) : "暂无机构"}</strong>
        <span>当前优先关注机构 / 资源压力 ${urgent?.resourcePressure || 0} / 预警 ${urgent?.activeAlerts?.length || 0}</span>
      </div>
      <button class="inline-action compact" type="button" data-situation-select="${urgent?.id || ""}" ${urgent ? "" : "disabled"}>查看详情</button>
    </article>
    <article>
      <span>当前筛选</span>
      <strong>${filteredSnapshots.length}/${snapshots.length}</strong>
      <small>严重 ${criticalCount} / 一般 ${warningCount}</small>
    </article>
    <article>
      <span>开放调度</span>
      <strong>${openDispatches.length}</strong>
      <small>${openDispatches.length ? "需跟踪分派与到位" : "暂无开放工单"}</small>
    </article>
    <article>
      <span>直报复核</span>
      <strong>${blockedReviews.length}</strong>
      <small>${blockedReviews.length ? "需完成补正或阻断说明" : "暂无阻断复核"}</small>
    </article>
    <article>
      <span>已选机构</span>
      <strong>${selected ? zh(selected.institution) : "未选择"}</strong>
      <small>压力 ${selectedPressure} / 预警 ${selectedAlerts}</small>
    </article>
  `;
  links.innerHTML = [
    ["all", "全部机构", "恢复全量监测"],
    ["critical", "严重预警", "只看严重风险"],
    ["warning", "一般预警", "只看一般预警"],
    ["dispatch", "开放调度", "定位调度工单"],
    ["reconciliation", "直报复核", "定位对账复核"]
  ].map(([mode, title, hint]) => `
    <button class="operations-focus-button" type="button" data-situation-filter="${mode}">
      <strong>${title}</strong>
      <span>${hint}</span>
    </button>
  `).join("");
  strip.querySelector("[data-situation-select]")?.addEventListener("click", (event) => {
    selectSnapshotById(event.currentTarget.dataset.situationSelect, "#operation-detail");
  });
  links.querySelectorAll("[data-situation-filter]").forEach((button) => {
    button.addEventListener("click", () => applySituationFilter(button.dataset.situationFilter));
  });
}

function applySituationFilter(mode) {
  if (mode === "critical" || mode === "warning") {
    operationFilters.status = mode;
    operationFilters.domain = "all";
    operationFilters.search = "";
    operationFilters.sort = "pressure";
    syncOperationFilterControls();
    renderOperationsDashboard();
    document.querySelector("#operations-snapshots")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  operationFilters.status = "all";
  operationFilters.domain = "all";
  operationFilters.search = "";
  operationFilters.sort = mode === "reconciliation" ? "variance" : "pressure";
  syncOperationFilterControls();
  renderOperationsDashboard();
  const target = mode === "dispatch" ? "#dispatch-requests" : mode === "reconciliation" ? "#reconciliation-reviews" : "#operations-snapshots";
  document.querySelector(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function syncOperationFilterControls() {
  const values = {
    "#operation-status-filter": operationFilters.status,
    "#operation-domain-filter": operationFilters.domain,
    "#operation-search": operationFilters.search,
    "#operation-sort": operationFilters.sort
  };
  Object.entries(values).forEach(([selector, value]) => {
    const control = document.querySelector(selector);
    if (control) control.value = value;
  });
}

function selectSnapshotById(id, scrollTarget = "#operation-detail") {
  if (!id) return;
  const snapshot = (operationsDashboard?.snapshots || []).find((item) => item.id === id || item.institutionId === id || item.institution === id);
  if (!snapshot) return;
  selectedSnapshotId = snapshot.id;
  renderOperationsDashboard();
  document.querySelector(scrollTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderOperationsMetrics(summary, filteredSnapshots) {
  const maxPressure = Math.max(...filteredSnapshots.map((item) => Number(item.resourcePressure || 0)), 0);
  const emergencyVisits = filteredSnapshots.reduce((sum, item) => sum + Number(item.outpatient?.emergencyVisits || 0), 0);
  const metrics = [
    ["机构数", summary.institutions || 0, "纳入运行监测的机构"],
    ["严重预警", summary.critical || 0, "严重运行预警"],
    ["一般预警", summary.warning || 0, "一般运行预警"],
    ["告警项", summary.alerts || 0, "规则触发总数"],
    ["待调度", summary.openDispatchRequests || 0, "待处理、已分派、处理中"],
    ["待对账", summary.pendingReconciliation || 0, "未关闭的直报复核"],
    ["床位使用率", percent(summary.bedOccupancyRate), "占用床位/开放床位"],
    ["筛选机构", filteredSnapshots.length, `最高资源压力 ${maxPressure}`],
    ["急诊量", emergencyVisits, "当前筛选机构合计"]
  ];
  document.querySelector("#operations-metrics").innerHTML = metrics.map(([label, value, hint]) => `
    <article class="metric-card">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${hint}</small>
    </article>
  `).join("");
}

function renderCommandChains(chains, filteredSnapshots) {
  const target = document.querySelector("#operation-command-chains");
  if (!target) return;
  const allowedIds = new Set(filteredSnapshots.map((item) => item.institutionId));
  const allowedNames = new Set(filteredSnapshots.map((item) => item.institution));
  const rows = chains.filter((item) => allowedIds.has(item.institutionId) || allowedNames.has(item.institution));
  target.innerHTML = rows.length ? rows.map((item) => `
    <article class="command-chain-card ${item.severity} ${item.id === `chain-${selectedSnapshotId}` ? "selected" : ""}">
      <div class="command-chain-head">
        <div>
          <strong>${zh(item.institution)}</strong>
          <span>${item.stage} / ${item.owner} / ${item.dueHours}小时内</span>
        </div>
        ${statusBadge(item.severity)}
      </div>
      <div class="command-chain-metrics">
        <div><span>资源压力</span><strong>${item.resourcePressure || 0}</strong></div>
        <div><span>活动预警</span><strong>${item.alertCount || 0}</strong></div>
        <div><span>开放调度</span><strong>${item.openDispatchCount || 0}</strong></div>
        <div><span>待复核</span><strong>${item.pendingReconciliationCount || 0}</strong></div>
      </div>
      <div class="command-chain-sla ${item.sla?.overdue ? "overdue" : ""}">
        <span>SLA：${item.sla?.status || "待确认"} / ${formatDateTime(item.sla?.dueAt)}</span>
        <small>${item.sla?.escalation || "按处置链继续跟踪。"}</small>
      </div>
      <div class="command-chain-steps">
        ${(item.steps || []).map((step) => `
          <span class="${step.count ? "active" : ""}">${step.name}：${step.status}</span>
        `).join("")}
      </div>
      <p>${item.nextAction}</p>
      <button class="inline-action" type="button" data-command-chain="${item.institutionId}">查看机构</button>
    </article>
  `).join("") : "<p class=\"muted\">当前筛选条件下暂无处置链。</p>";
  document.querySelectorAll("[data-command-chain]").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshot = (operationsDashboard?.snapshots || []).find((item) => item.institutionId === button.dataset.commandChain);
      if (snapshot) {
        selectedSnapshotId = snapshot.id;
        renderOperationsDashboard();
      }
    });
  });
}

function renderOperationsPlaybooks(playbooks, filteredSnapshots) {
  const target = document.querySelector("#operation-playbooks");
  if (!target) return;
  const visibleInstitutionNames = new Set(filteredSnapshots.map((item) => item.institution));
  const rows = (playbooks || []).filter((item) => !item.activeInstitutionNames?.length || item.activeInstitutionNames.some((name) => visibleInstitutionNames.has(name)));
  target.innerHTML = rows.length ? rows.map((item) => `
    <article class="operation-playbook-card ${item.severity}">
      <div class="operation-playbook-head">
        <div>
          <strong>${alertRuleName(item.ruleId)}</strong>
          <span>${zh(item.domain)} / ${item.owner} / SLA ${item.slaHours}小时</span>
        </div>
        ${statusBadge(item.severity)}
      </div>
      <div class="operation-playbook-meta">
        <span>触发：${zh(item.trigger)}</span>
        <span>活跃机构：${item.activeInstitutions || 0}</span>
        <span>边界：${zh(item.dispatchBoundary)}</span>
      </div>
      <div class="operation-playbook-actions">
        ${(item.actions || []).map((action) => `<span>${action}</span>`).join("")}
      </div>
      <div class="operation-playbook-fields">
        ${(item.requiredFields || []).length ? item.requiredFields.map((field) => `<span>${field}</span>`).join("") : "<span>现场确认字段</span>"}
      </div>
      <footer>
        <small>证据：${evidenceList(item.evidence)}</small>
        ${(item.activeInstitutionNames || []).length ? `<button class="inline-action compact" type="button" data-playbook-institution="${item.activeInstitutionNames[0]}">查看触发机构</button>` : ""}
      </footer>
    </article>
  `).join("") : "<p class=\"muted\">当前筛选条件下暂无预案命中。</p>";
  document.querySelectorAll("[data-playbook-institution]").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshot = (operationsDashboard?.snapshots || []).find((item) => item.institution === button.dataset.playbookInstitution);
      if (snapshot) {
        selectedSnapshotId = snapshot.id;
        renderOperationsDashboard();
      }
    });
  });
}

function renderOperationsHandover(handover, filteredSnapshots) {
  const target = document.querySelector("#operation-handover");
  const summaryTarget = document.querySelector("#operation-handover-summary");
  const signoffsTarget = document.querySelector("#operation-handover-signoffs");
  if (!target) return;
  const allowedIds = new Set(filteredSnapshots.map((item) => item.institutionId));
  const allowedNames = new Set(filteredSnapshots.map((item) => item.institution));
  const rows = (handover.items || []).filter((item) => allowedIds.has(item.institutionId) || allowedNames.has(item.institution));
  if (summaryTarget) {
    const filteredCritical = rows.filter((item) => item.severity === "critical").length;
    const filteredDueSoon = rows.filter((item) => item.remainingMinutes !== null && item.remainingMinutes <= 240 && item.remainingMinutes >= 0).length;
    summaryTarget.innerHTML = `
      <span>交接事项 <strong>${rows.length}</strong></span>
      <span>严重 <strong>${filteredCritical}</strong></span>
      <span>临期 <strong>${filteredDueSoon}</strong></span>
      <span>责任组 <strong>${new Set(rows.map((item) => item.owner).filter(Boolean)).size}</strong></span>
      <small>${handover.shiftNote || "交班清单按当前筛选机构实时刷新。"}</small>
      <button class="inline-action compact" type="button" data-handover-signoff ${rows.length ? "" : "disabled"}>确认交接</button>
    `;
  }
  if (signoffsTarget) {
    const signoffs = handover.recentSignoffs || [];
    signoffsTarget.innerHTML = signoffs.length ? signoffs.map((item) => `
      <article>
        <strong>${item.shift || "交接班次"} / ${item.signer || "签收人"}</strong>
        <span>${formatDateTime(item.signedAt)} / 事项 ${item.itemCount || 0} / 严重 ${item.criticalCount || 0}</span>
        <small>${item.nextShiftFocus || item.note || "已签收。"}</small>
      </article>
    `).join("") : "<p class=\"muted\">暂无交接签收记录。</p>";
  }
  target.innerHTML = rows.length ? rows.map((item) => `
    <article class="operation-handover-card ${item.severity}">
      <div class="operation-handover-head">
        <div>
          <strong>${zh(item.institution)}</strong>
          <span>${item.stage} / ${item.owner}</span>
        </div>
        ${statusBadge(item.severity)}
      </div>
      <div class="operation-handover-due ${item.riskSignals?.includes("SLA 已超时") ? "overdue" : ""}">
        <span>${item.dueStatus || "待确认"} / ${formatDateTime(item.dueAt)}</span>
        <small>${item.remainingMinutes === null ? "未设置剩余时间" : item.remainingMinutes < 0 ? `已超时 ${Math.abs(item.remainingMinutes)} 分钟` : `剩余 ${item.remainingMinutes} 分钟`}</small>
      </div>
      <div class="operation-handover-signals">
        ${(item.riskSignals || []).map((signal) => `<span>${signal}</span>`).join("")}
      </div>
      <ol>
        ${(item.nextActions || []).map((action) => `<li>${action}</li>`).join("")}
      </ol>
      <div class="operation-handover-checkpoints">
        ${(item.checkpoints || []).slice(0, 4).map((checkpoint) => `<span>${checkpoint}</span>`).join("")}
      </div>
      <footer>
        <small>证据：${evidenceList(item.evidence)}</small>
        <button class="inline-action compact" type="button" data-handover-institution="${item.institutionId}">查看机构</button>
      </footer>
    </article>
  `).join("") : "<p class=\"muted\">当前筛选条件下暂无需要交接的运行事项。</p>";
  document.querySelectorAll("[data-handover-institution]").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshot = (operationsDashboard?.snapshots || []).find((item) => item.institutionId === button.dataset.handoverInstitution);
      if (snapshot) {
        selectedSnapshotId = snapshot.id;
        renderOperationsDashboard();
      }
    });
  });
  document.querySelectorAll("[data-handover-signoff]").forEach((button) => {
    button.addEventListener("click", () => signoffOperationsHandover(rows));
  });
}

function renderHandoverOwnerMatrix(ownerMatrix, filteredSnapshots) {
  const target = document.querySelector("#operation-handover-owner-matrix");
  if (!target) return;
  const allowedNames = new Set(filteredSnapshots.map((item) => item.institution));
  const rows = (ownerMatrix.matrix || []).map((item) => ({
    ...item,
    institutions: (item.institutions || []).filter((name) => allowedNames.has(name))
  })).filter((item) => item.institutions.length || operationFilters.status === "all" && operationFilters.domain === "all" && !operationFilters.search);
  target.innerHTML = rows.length ? rows.map((item) => `
    <article class="operation-handover-owner-card ${item.criticalCount ? "critical" : item.dueSoonCount ? "warning" : ""}">
      <div>
        <strong>${item.owner}</strong>
        <span>事项 ${item.itemCount || 0} / 严重 ${item.criticalCount || 0} / 临期 ${item.dueSoonCount || 0} / 超时 ${item.overdueCount || 0}</span>
      </div>
      <div class="operation-handover-owner-tags">
        ${(item.institutions || []).slice(0, 4).map((name) => `<span>${zh(name)}</span>`).join("")}
        ${(item.stages || []).slice(0, 3).map((stage) => `<span>${stage}</span>`).join("")}
      </div>
      <p>${(item.nextActions || [])[0] || "保持常态监测。"}</p>
      <small>证据：${evidenceList(item.evidence)}</small>
    </article>
  `).join("") : "<p class=\"muted\">当前筛选条件下暂无责任组交接事项。</p>";
}

async function signoffOperationsHandover(items) {
  const rows = Array.isArray(items) ? items : [];
  if (!rows.length) return;
  const note = window.prompt("请输入本班交接备注", "已确认交接事项、责任组、SLA和下一班关注点。") || "已确认交接事项、责任组、SLA和下一班关注点。";
  const payload = {
    shift: new Date().toLocaleString("zh-CN", { hour12: false }),
    itemIds: rows.map((item) => item.id),
    note,
    nextShiftFocus: rows.slice(0, 3).map((item) => `${zh(item.institution)}：${item.stage}`).join("；")
  };
  if (OPERATIONS_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    await request(`${OPERATIONS_API_BASE}/operations/handover/signoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    await loadOperationsDashboard();
    return;
  }
  const signoff = {
    id: `static-handover-signoff-${Date.now()}`,
    signedAt: new Date().toISOString(),
    shift: payload.shift,
    signer: "静态预览",
    itemIds: payload.itemIds,
    itemCount: rows.length,
    criticalCount: rows.filter((item) => item.severity === "critical").length,
    dueSoonCount: rows.filter((item) => item.remainingMinutes !== null && item.remainingMinutes <= 240 && item.remainingMinutes >= 0).length,
    note,
    nextShiftFocus: payload.nextShiftFocus,
    evidence: ["/api/operations/handover"]
  };
  operationsDashboard.handover = {
    ...(operationsDashboard.handover || {}),
    recentSignoffs: [signoff, ...((operationsDashboard.handover || {}).recentSignoffs || [])].slice(0, 8)
  };
  operationsDashboard.handover.summary = {
    ...((operationsDashboard.handover || {}).summary || {}),
    signoffs: operationsDashboard.handover.recentSignoffs.length
  };
  operationsDashboard.handoverOwnerMatrix = buildStaticHandoverOwnerMatrix(operationsDashboard.handover || {});
  renderOperationsDashboard();
}

function renderInterfaceMapping(evidence) {
  const target = document.querySelector("#operations-interface-mapping");
  if (!target) return;
  const mappings = Array.isArray(evidence.mappings) ? evidence.mappings : [];
  target.innerHTML = `
    <article class="interface-mapping-summary">
      <strong>联调概况</strong>
      <span>${evidence.summary?.systems || 0} 个来源系统，${evidence.summary?.ready || 0} 项已接入，${evidence.summary?.pending || 0} 项待联调</span>
    </article>
    ${mappings.map((item) => `
      <article class="interface-mapping-card ${item.status === "已接入" ? "ready" : "pending"}">
        <div>
          <strong>${item.sourceSystem}</strong>
          <span>${item.source} → ${item.targetCollection}.${item.targetField}</span>
        </div>
        <span class="badge ${item.status === "已接入" ? "success" : "warn"}">${item.status}</span>
        <small>责任：${item.owner} / 周期：${item.updateCycle}</small>
        <p>${item.nextAction}</p>
        <div class="interface-field-list">${(item.fields || []).map((field) => `<span>${field}</span>`).join("")}</div>
      </article>
    `).join("")}
  `;
}

function renderSiteJointTests(siteJointTests) {
  const target = document.querySelector("#operations-site-joint-tests");
  if (!target) return;
  const rows = Array.isArray(siteJointTests.rows) ? siteJointTests.rows : [];
  target.innerHTML = `
    <article class="interface-mapping-summary">
      <strong>联调闭环</strong>
      <span>${siteJointTests.summary?.completed || 0}/${siteJointTests.summary?.total || 0} 项完成，${siteJointTests.summary?.pending || 0} 项待联调</span>
    </article>
    ${rows.map((item) => `
      <article class="interface-mapping-card ${item.status === "已完成" ? "ready" : "pending"}">
        <div>
          <strong>${zhInline(item.sourceSystem)}</strong>
          <span>${zhInline(item.samplePacket)} / ${zhInline(item.replayResult)}</span>
        </div>
        <span class="badge ${item.status === "已完成" ? "success" : "warn"}">${item.status}</span>
        <small>责任：${zhInline(item.owner)} / 周期：${zhInline(item.updateCycle)}</small>
        <p>${zhInline(item.exitCriteria)}</p>
        <div class="interface-field-list">
          ${(item.validationPoints || []).map((point) => `<span>${zhInline(point)}</span>`).join("")}
          ${(item.attachments || []).map((attachment) => `<span>${zhInline(attachment)}</span>`).join("")}
        </div>
      </article>
    `).join("")}
  `;
}

function renderSiteJointPatrol(siteJointPatrol) {
  const target = document.querySelector("#operations-site-joint-patrol");
  if (!target) return;
  const rows = Array.isArray(siteJointPatrol.rows) ? siteJointPatrol.rows : [];
  target.innerHTML = `
    <article class="site-joint-patrol-summary">
      <strong>现场联调巡检</strong>
      <span>${siteJointPatrol.summary?.rows || 0} 项来源 / ${siteJointPatrol.summary?.pending || 0} 项待归档 / ${siteJointPatrol.summary?.highPriority || 0} 项高优先级</span>
      <small>每日检查：${zhList(siteJointPatrol.dailyChecklist || [])}</small>
    </article>
    ${rows.map((item) => `
      <article class="site-joint-patrol-card ${item.priority === "高" ? "critical" : item.priority === "中" ? "warning" : "normal"}">
        <div class="operation-playbook-head">
          <div>
            <strong>${zhInline(item.sourceSystem)}</strong>
            <span>${zhInline(item.targetCollection)} / ${zhInline(item.owner)} / ${zhInline(item.status)}</span>
          </div>
          <span class="badge ${item.priority === "高" ? "danger" : item.priority === "中" ? "warn" : "info"}">${zhInline(item.priority)}</span>
        </div>
        <div class="site-joint-patrol-checks">
          ${(item.checkpoints || []).map((checkpoint) => `<span title="${htmlAttribute(checkpoint.evidence)}">${zhInline(checkpoint.name)}：${zhInline(checkpoint.status)}</span>`).join("")}
        </div>
        <p>${zhInline(item.nextAction)}</p>
        <button class="inline-action compact" type="button" data-site-patrol="${htmlAttribute(item.id)}">提交巡检</button>
      </article>
    `).join("")}
  `;
  target.querySelectorAll("[data-site-patrol]").forEach((button) => {
    button.addEventListener("click", () => submitSiteJointPatrol(button.dataset.sitePatrol));
  });
}

async function submitSiteJointPatrol(patrolId) {
  const row = (operationsDashboard?.siteJointPatrol?.rows || []).find((item) => item.id === patrolId);
  if (!row) return;
  const payload = {
    patrolId,
    status: "已巡检",
    note: row.nextAction
  };
  try {
    const response = await request(`${OPERATIONS_API_BASE}/operations/site-joint-patrol/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("site joint patrol failed");
    const result = await response.json();
    operationsDashboard.siteJointPatrol = result.siteJointPatrol || operationsDashboard.siteJointPatrol;
  } catch (error) {
    operationsDashboard.siteJointPatrol = {
      ...(operationsDashboard.siteJointPatrol || {}),
      rows: (operationsDashboard.siteJointPatrol?.rows || []).map((item) => item.id === patrolId ? { ...item, status: "已巡检" } : item)
    };
  }
  renderSiteJointPatrol(operationsDashboard.siteJointPatrol || {});
}

function renderProductionHardening(productionHardening) {
  const target = document.querySelector("#operation-production-hardening");
  if (!target) return;
  const checks = Array.isArray(productionHardening.checks) ? productionHardening.checks : [];
  const tracks = Array.isArray(productionHardening.tracks) ? productionHardening.tracks : [];
  target.innerHTML = `
    <article class="performance-readiness-card ${productionHardening.ok ? "ready" : "pending"}">
      <strong>${productionHardening.status || "待生产签字"}</strong>
      <span>${productionHardening.summary?.passed || 0}/${productionHardening.summary?.total || 0} 项通过，${productionHardening.summary?.blocked || 0} 项阻断</span>
      <small>生产割接仍以真实环境变量、现场签字和演练记录为准。</small>
    </article>
    ${tracks.map((item) => `
      <article class="performance-readiness-card ${/已|具备/.test(item.status) ? "ready" : "pending"}">
        <strong>${item.name}</strong>
        <span>${item.owner}</span>
        <small>${item.status} / ${item.evidence}</small>
      </article>
    `).join("")}
    ${checks.filter((item) => !item.passed).slice(0, 6).map((item) => `
      <article class="performance-readiness-card pending">
        <strong>${item.name}</strong>
        <span>${item.detail}</span>
        <small>${item.nextAction}</small>
      </article>
    `).join("")}
  `;
}

function renderCutoverCommand(cutoverCommand) {
  const target = document.querySelector("#operation-cutover-command");
  if (!target) return;
  const items = Array.isArray(cutoverCommand.items) ? cutoverCommand.items : [];
  target.innerHTML = `
    <article class="operation-cutover-summary ${cutoverCommand.ok ? "ready" : "blocked"}">
      <strong>生产割接签收台</strong>
      <span>${cutoverCommand.summary?.signed || 0}/${cutoverCommand.summary?.total || 0} 项已签收，${cutoverCommand.summary?.blocking || 0} 项阻断</span>
      <small>观察窗口：${zhInline(cutoverCommand.watchWindow)}；回退策略：${zhInline(cutoverCommand.rollbackPolicy)}</small>
    </article>
    ${items.map((item) => `
      <article class="operation-cutover-card ${item.priority === "高" ? "critical" : item.status === "已签收" ? "ready" : "warning"}">
        <div class="operation-playbook-head">
          <div>
            <strong>${zhInline(item.name)}</strong>
            <span>${zhInline(item.phase)} / ${zhInline(item.owner)} / ${zhInline(item.status)}</span>
          </div>
          <span class="badge ${item.priority === "高" ? "danger" : item.status === "已签收" ? "info" : "warn"}">${zhInline(item.priority)}</span>
        </div>
        <p>${zhInline(item.detail)}</p>
        <div class="operation-cutover-blockers">
          ${(item.blockers?.length ? item.blockers : ["无新增阻断"]).map((row) => `<span>${zhInline(row)}</span>`).join("")}
        </div>
        <footer>
          <small>证据：${evidenceList(item.evidence)}</small>
          <button class="inline-action compact" type="button" data-cutover-signoff="${htmlAttribute(item.id)}">提交签收</button>
        </footer>
      </article>
    `).join("")}
  `;
  target.querySelectorAll("[data-cutover-signoff]").forEach((button) => {
    button.addEventListener("click", () => signoffCutoverCommand(button.dataset.cutoverSignoff));
  });
}

async function signoffCutoverCommand(itemId) {
  const item = (operationsDashboard?.cutoverCommand?.items || []).find((row) => row.id === itemId);
  if (!item) return;
  const payload = {
    itemId,
    status: "已签收",
    note: item.nextAction
  };
  try {
    const response = await request(`${OPERATIONS_API_BASE}/operations/cutover-command/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("cutover signoff failed");
    const result = await response.json();
    operationsDashboard.cutoverCommand = result.cutoverCommand || operationsDashboard.cutoverCommand;
  } catch (error) {
    operationsDashboard.cutoverCommand = {
      ...(operationsDashboard.cutoverCommand || {}),
      items: (operationsDashboard.cutoverCommand?.items || []).map((row) => row.id === itemId ? { ...row, status: "已签收", priority: "常规", blockers: [] } : row)
    };
    const rows = operationsDashboard.cutoverCommand.items || [];
    operationsDashboard.cutoverCommand.summary = {
      ...(operationsDashboard.cutoverCommand.summary || {}),
      signed: rows.filter((row) => row.status === "已签收").length,
      blocking: rows.filter((row) => row.status === "阻断待签收").length,
      pending: rows.filter((row) => row.status !== "已签收").length,
      total: rows.length
    };
  }
  renderCutoverCommand(operationsDashboard.cutoverCommand || {});
}

function renderPostCutoverObservation(postCutoverObservation) {
  const target = document.querySelector("#operation-post-cutover-observation");
  if (!target) return;
  const items = Array.isArray(postCutoverObservation.items) ? postCutoverObservation.items : [];
  target.innerHTML = `
    <article class="operation-observation-summary ${postCutoverObservation.ok ? "ready" : "watching"}">
      <strong>上线后观察台</strong>
      <span>${postCutoverObservation.summary?.observed || 0}/${postCutoverObservation.summary?.total || 0} 项已观察，${postCutoverObservation.summary?.abnormal || 0} 项异常</span>
      <small>观察窗口：${zhInline(postCutoverObservation.watchWindow)}；证据：${evidenceList(postCutoverObservation.evidence)}</small>
      <div class="operation-observation-windows">
        ${(postCutoverObservation.windows || []).map((windowItem) => `<span title="${htmlAttribute(`${windowItem.focus}；证据：${zhList(windowItem.requiredEvidence || [])}`)}">${zhInline(windowItem.name)} / ${zhInline(windowItem.owner)} / ${(windowItem.requiredEvidence || []).length}项证据</span>`).join("")}
      </div>
    </article>
    ${items.map((item) => `
      <article class="operation-observation-card ${item.priority === "高" ? "critical" : item.priority === "中" ? "warning" : "ready"}">
        <div class="operation-playbook-head">
          <div>
            <strong>${zhInline(item.title)}</strong>
            <span>${zhInline(item.owner)} / ${zhInline(item.status)} / ${zhInline(item.metric)}</span>
          </div>
          <span class="badge ${item.priority === "高" ? "danger" : item.priority === "中" ? "warn" : "info"}">${zhInline(item.priority)}</span>
        </div>
        <p>${zhInline(item.detail)}</p>
        <div class="operation-observation-actions">
          <span>${zhInline(item.nextAction)}</span>
        </div>
        <footer>
          <small>证据：${evidenceList(item.evidence)}</small>
          <button class="inline-action compact" type="button" data-post-cutover-observation="${htmlAttribute(item.id)}">记录观察</button>
        </footer>
      </article>
    `).join("")}
  `;
  target.querySelectorAll("[data-post-cutover-observation]").forEach((button) => {
    button.addEventListener("click", () => submitPostCutoverObservation(button.dataset.postCutoverObservation));
  });
}

async function submitPostCutoverObservation(itemId) {
  const item = (operationsDashboard?.postCutoverObservation?.items || []).find((row) => row.id === itemId);
  if (!item) return;
  const payload = {
    itemId,
    status: "已观察",
    note: item.nextAction
  };
  try {
    const response = await request(`${OPERATIONS_API_BASE}/operations/post-cutover-observation/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("post cutover observation failed");
    const result = await response.json();
    operationsDashboard.postCutoverObservation = result.postCutoverObservation || operationsDashboard.postCutoverObservation;
  } catch (error) {
    operationsDashboard.postCutoverObservation = {
      ...(operationsDashboard.postCutoverObservation || {}),
      items: (operationsDashboard.postCutoverObservation?.items || []).map((row) => row.id === itemId ? { ...row, status: "已观察", priority: "常规" } : row)
    };
    const rows = operationsDashboard.postCutoverObservation.items || [];
    operationsDashboard.postCutoverObservation.summary = {
      ...(operationsDashboard.postCutoverObservation.summary || {}),
      observed: rows.filter((row) => row.status === "已观察").length,
      abnormal: rows.filter((row) => row.priority === "高").length,
      watching: rows.filter((row) => row.status === "观察中" || row.status === "异常待处置").length,
      total: rows.length
    };
  }
  renderPostCutoverObservation(operationsDashboard.postCutoverObservation || {});
}

function renderOperationsIntelligence(intelligence) {
  const target = document.querySelector("#operation-intelligence");
  if (!target) return;
  const rows = Array.isArray(intelligence.recommendations) ? intelligence.recommendations : [];
  target.innerHTML = rows.map((item) => `
    <article class="operation-playbook-card ${item.riskLevel === "高" ? "critical" : item.riskLevel === "中" ? "warning" : "normal"}">
      <div class="operation-playbook-head">
        <div>
          <strong>${zh(item.institution)}</strong>
          <span>风险 ${item.riskScore} / 置信度 ${item.confidence}</span>
        </div>
        <span class="badge ${item.riskLevel === "高" ? "danger" : item.riskLevel === "中" ? "warn" : "info"}">${item.riskLevel}风险</span>
      </div>
      <div class="operation-playbook-meta">
        <span>床位缺口：${item.prediction?.bedGapTomorrow || 0}</span>
        <span>人员缺口：${item.prediction?.staffGapTonight || 0}</span>
        <span>${item.prediction?.emergencyCongestion || "可控"}</span>
        <span>${item.prediction?.reportingRisk || "常规复核"}</span>
      </div>
      <p>${zhInline(item.recommendation)}</p>
      <div class="operation-playbook-actions">
        ${(item.reviewQueue || ["人工复核后采纳"]).map((row) => `<span>${zhInline(row)}</span>`).join("")}
      </div>
      <footer>
        <small>证据：${evidenceList(item.evidence)}</small>
        <button class="inline-action compact" type="button" data-intelligence-institution="${item.institutionId}">查看机构</button>
      </footer>
    </article>
  `).join("") || "<p class=\"muted\">暂无智能调度建议。</p>";
  target.querySelectorAll("[data-intelligence-institution]").forEach((button) => {
    button.addEventListener("click", () => selectSnapshotById(button.dataset.intelligenceInstitution, "#operation-detail"));
  });
}

function renderResourcePool(resourcePool) {
  const target = document.querySelector("#operation-resource-pool");
  if (!target) return;
  const rows = Array.isArray(resourcePool.rows) ? resourcePool.rows : [];
  const recommendations = Array.isArray(resourcePool.recommendations) ? resourcePool.recommendations : [];
  target.innerHTML = `
    <article class="operation-resource-pool-summary">
      <strong>跨院资源池</strong>
      <span>${resourcePool.summary?.institutions || rows.length} 家机构 / 可调拨 ${resourcePool.summary?.transferableInstitutions || 0} 家 / 普通床位 ${resourcePool.summary?.transferableBeds || 0} 张 / ICU ${resourcePool.summary?.icuBeds || 0} 张 / 呼吸机 ${resourcePool.summary?.ventilators || 0} 台</span>
      <small>证据：${evidenceList(resourcePool.evidence)}</small>
    </article>
    <div class="operation-resource-pool-recommendations">
      ${(recommendations.length ? recommendations : [{ sourceInstitution: "暂无高压机构", targetInstitution: "待运行监测触发", resourceType: "常规储备", priority: "低", reason: "当前未形成跨院调拨建议。", suggestedAction: "持续监测床位、ICU、设备和调度工单。" }]).map((item) => `
        <article class="operation-resource-pool-recommendation ${item.priority === "高" ? "critical" : "warning"}">
          <strong>${zhInline(item.sourceInstitution)} → ${zhInline(item.targetInstitution)}</strong>
          <span>${zhInline(item.resourceType)} / 优先级 ${zhInline(item.priority)}</span>
          <p>${zhInline(item.reason)}</p>
          <small>${zhInline(item.suggestedAction)}</small>
          ${item.targetInstitution && item.sourceInstitution ? `<button class="inline-action compact" type="button" data-resource-dispatch="${htmlAttribute(item.id)}">生成调度草稿</button>` : ""}
        </article>
      `).join("")}
    </div>
    <div class="operation-resource-pool-list">
      ${rows.map((item) => `
        <article class="operation-resource-pool-card ${item.status === "可调拨" ? "ready" : item.status === "需保障本院" ? "critical" : "limited"}">
          <div class="operation-playbook-head">
            <div>
              <strong>${zhInline(item.institution)}</strong>
              <span>${zhInline(item.region)} / ${zhInline(item.institutionType)} / 压力 ${item.pressure || 0}</span>
            </div>
            <span class="badge ${item.status === "可调拨" ? "info" : item.status === "需保障本院" ? "danger" : "warn"}">${zhInline(item.status)}</span>
          </div>
          <div class="operation-resource-pool-slots">
            ${(item.resourceSlots || []).map((slot) => `<span title="${htmlAttribute(slot.boundary)}">${zhInline(slot.type)} ${slot.available || 0}${zhInline(slot.unit)}</span>`).join("")}
          </div>
          <p>${zhInline(item.protocol?.approval || "")} / ${zhInline(item.protocol?.responseSla || "")}</p>
          <small>${zhInline(item.protocol?.audit || "")}</small>
        </article>
      `).join("")}
    </div>
  `;
  target.querySelectorAll("[data-resource-dispatch]").forEach((button) => {
    button.addEventListener("click", () => applyResourceDispatchDraft(recommendations.find((item) => item.id === button.dataset.resourceDispatch)));
  });
}

function applyResourceDispatchDraft(recommendation) {
  if (!recommendation) return;
  const form = document.querySelector("#dispatch-form");
  if (!form) return;
  form.elements.sourceInstitution.value = recommendation.sourceInstitution || "";
  form.elements.targetInstitution.value = recommendation.targetInstitution || "";
  form.elements.resourceType.value = recommendation.resourceType || "跨院资源支援";
  form.elements.quantity.value = recommendation.priority === "高" ? 6 : 3;
  form.elements.priority.value = recommendation.priority === "高" ? "high" : "medium";
  form.elements.status.value = "pending";
  form.elements.reason.value = `${recommendation.reason || ""}\n${recommendation.suggestedAction || ""}`.trim();
  document.querySelector("#dispatch-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMobileDuty(mobileDuty) {
  const target = document.querySelector("#operation-mobile-duty");
  if (!target) return;
  const cards = Array.isArray(mobileDuty.cards) ? mobileDuty.cards : [];
  const messages = Array.isArray(mobileDuty.recentMessages) ? mobileDuty.recentMessages : [];
  target.innerHTML = `
    <article class="operation-mobile-duty-summary">
      <strong>移动值守台</strong>
      <span>${mobileDuty.summary?.pendingActions || 0} 项待处理 / ${mobileDuty.summary?.highPriority || 0} 项高优先级 / ${mobileDuty.summary?.reminders || 0} 条提醒</span>
      <small>${mobileDuty.weakNetwork?.retryPolicy || "支持弱网缓存和恢复后补传。"}</small>
    </article>
    <div class="operation-mobile-duty-card-list">
      ${cards.map((item) => `
        <article class="operation-mobile-duty-card ${item.priority === "高" ? "critical" : item.priority === "中" ? "warning" : "normal"}">
          <div class="operation-playbook-head">
            <div>
              <strong>${zhInline(item.title)}</strong>
              <span>${zhInline(item.owner)} / ${zhInline(item.status)} / ${item.count || 0} 项</span>
            </div>
            <span class="badge ${item.priority === "高" ? "danger" : item.priority === "中" ? "warn" : "info"}">${zhInline(item.priority)}</span>
          </div>
          <p>${zhInline(item.summary)}</p>
          <small>${zhInline(item.nextAction)}</small>
          <button class="inline-action compact" type="button" data-mobile-duty-card="${htmlAttribute(item.id)}">发送值守提醒</button>
        </article>
      `).join("")}
    </div>
    <div class="operation-mobile-duty-messages">
      ${(messages.length ? messages : [{ title: "暂无移动值守提醒", body: "发送提醒后将在这里形成消息和审计证据。", createdAt: "" }]).map((item) => `
        <article>
          <strong>${zhInline(item.title)}</strong>
          <span>${zhInline(item.body)}</span>
          <small>${zhInline(item.createdAt || "待生成")}</small>
        </article>
      `).join("")}
    </div>
  `;
  target.querySelectorAll("[data-mobile-duty-card]").forEach((button) => {
    button.addEventListener("click", () => sendMobileDutyReminder(button.dataset.mobileDutyCard));
  });
}

async function sendMobileDutyReminder(cardId) {
  const card = (operationsDashboard?.mobileDuty?.cards || []).find((item) => item.id === cardId);
  if (!card) return;
  const payload = {
    cardId,
    note: card.nextAction,
    targetRole: "commission",
    channel: "in_app"
  };
  try {
    const response = await request(`${OPERATIONS_API_BASE}/operations/mobile-duty/actions`, {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error("mobile duty reminder failed");
    const result = await response.json();
    operationsDashboard.mobileDuty = result.mobileDuty || operationsDashboard.mobileDuty;
  } catch (error) {
    const message = {
      id: `static-mobile-duty-${Date.now()}`,
      taskId: `operations-mobile-duty:${card.id}`,
      collection: "hospitalOperationsMobileDuty",
      sourceId: card.id,
      targetRole: "commission",
      channel: "in_app",
      title: `移动值守提醒：${card.title}`,
      body: card.nextAction,
      status: "sent",
      receipts: [],
      createdAt: new Date().toISOString(),
      createdBy: "static-preview",
      createdByName: "静态预览"
    };
    operationsDashboard.mobileDuty = {
      ...(operationsDashboard.mobileDuty || {}),
      recentMessages: [message, ...((operationsDashboard.mobileDuty || {}).recentMessages || [])].slice(0, 8)
    };
    operationsDashboard.mobileDuty.summary = {
      ...((operationsDashboard.mobileDuty || {}).summary || {}),
      reminders: operationsDashboard.mobileDuty.recentMessages.length
    };
  }
  renderMobileDuty(operationsDashboard.mobileDuty || {});
}

function renderGovernanceReport(report, exportPackage) {
  const target = document.querySelector("#operation-governance-report");
  if (!target) return;
  const sections = Array.isArray(report.sections) ? report.sections : [];
  const pack = exportPackage || buildStaticGovernanceExportPackage(
    operationsDashboard?.snapshots || [],
    operationsDashboard?.dispatchRequests || [],
    operationsDashboard?.reconciliationReviews || [],
    operationsDashboard?.performanceMonitoring || {},
    report,
    operationsDashboard?.intelligence || {},
    operationsDashboard?.handover || {}
  );
  target.innerHTML = `
    <article class="performance-action-head">
      <div>
        <strong>${report.exportName || "医院运行治理月报"}</strong>
        <span>${report.period || "本期"} / ${report.summary?.sections || sections.length} 个治理章节 / ${report.summary?.pendingReconciliation || 0} 项直报待复核</span>
      </div>
      <button class="inline-action compact" type="button" data-governance-export>下载导出包</button>
    </article>
    <article class="performance-action-card export">
      <strong>${pack.packageName || "治理导出包"}</strong>
      <span>${pack.summary?.files || 0} 个文件 / 版本 ${pack.version || "待生成"} / 直报差异 ${pack.summary?.pendingReconciliation || 0} 项</span>
      <small>证据：${evidenceList(pack.evidence)}</small>
    </article>
    ${(pack.files || []).map((item) => `
      <article class="performance-action-card export">
        <strong>${zhInline(item.name)}</strong>
        <span>${zhInline(item.owner)} / ${zhInline(item.type)} / ${item.rows || 0} 行</span>
        <small>${zhInline(item.description)}</small>
      </article>
    `).join("")}
    ${sections.map((item) => `
      <article class="performance-action-card info">
        <strong>${item.title}</strong>
        <span>${zhInline(item.metric)}</span>
        <small>${zhInline(item.owner)}：${zhInline(item.conclusion)}</small>
      </article>
    `).join("")}
    ${(report.nextActions || []).map((item) => `
      <article class="performance-action-card">
        <strong>下一步归档</strong>
        <span>${item}</span>
      </article>
    `).join("")}
  `;
  target.querySelector("[data-governance-export]")?.addEventListener("click", downloadGovernanceExportPackage);
}

function renderNextDevelopmentResearch(research) {
  const target = document.querySelector("#operation-next-development");
  if (!target) return;
  const tracks = Array.isArray(research.tracks) ? research.tracks : [];
  const risks = Array.isArray(research.risks) ? research.risks : [];
  const nextSprint = Array.isArray(research.nextSprint) ? research.nextSprint : [];
  target.innerHTML = `
    <article class="operation-next-development-summary">
      <div>
        <strong>研究周期 ${research.horizon || "待定"}</strong>
        <span>${research.summary?.tracks || tracks.length} 个方向 / P0 ${research.summary?.p0 || 0} 项 / P1 ${research.summary?.p1 || 0} 项 / P2 ${research.summary?.p2 || 0} 项</span>
      </div>
      <div class="operation-next-development-metrics">
        <span>联调闭环 ${research.summary?.readyForFieldResearch || 0}</span>
        <span>割接阻断 ${research.summary?.blockedForCutover || 0}</span>
        <span>直报待复核 ${research.summary?.pendingReconciliation || 0}</span>
      </div>
      <small>证据：${evidenceList(research.evidence)}</small>
    </article>
    <div class="operation-next-development-track-list">
      ${tracks.map((item) => `
        <article class="operation-next-development-card ${item.priority === "P0" ? "urgent" : item.priority === "P1" ? "important" : "later"}">
          <div class="operation-playbook-head">
            <div>
              <strong>${zhInline(item.name)}</strong>
              <span>${zhInline(item.phase)} / ${zhInline(item.owner)}</span>
            </div>
            <span class="badge ${item.priority === "P0" ? "danger" : item.priority === "P1" ? "warn" : "info"}">${item.priority}</span>
          </div>
          <p>${zhInline(item.problem)}</p>
          <p>${zhInline(item.deliverable)}</p>
          <div class="operation-next-development-tags">
            ${(item.prerequisites || []).map((row) => `<span>${zhInline(row)}</span>`).join("")}
          </div>
          <div class="operation-next-development-tags subtle">
            ${(item.dataSources || []).map((row) => `<span>${zhInline(row)}</span>`).join("")}
          </div>
          <footer>
            <small>${zhInline(item.acceptance)}</small>
            <small>证据：${evidenceList(item.evidence)}</small>
          </footer>
        </article>
      `).join("")}
    </div>
    <div class="operation-next-development-risks">
      <article>
        <strong>研发风险边界</strong>
        ${(risks.length ? risks : ["待现场确认风险边界。"]).map((item) => `<span>${zhInline(item)}</span>`).join("")}
      </article>
      <article>
        <strong>下一迭代建议</strong>
        ${(nextSprint.length ? nextSprint : ["待补充下一迭代任务。"]).map((item) => `<span>${zhInline(item)}</span>`).join("")}
      </article>
    </div>
  `;
}

async function downloadGovernanceExportPackage() {
  let pack = operationsDashboard?.governanceExportPackage || null;
  if (OPERATIONS_API_BASE) {
    try {
      const request = window.HealthCityAuth?.authFetch || fetch;
      const response = await request(`${OPERATIONS_API_BASE}/operations/governance-export-package`);
      if (response.ok) pack = await response.json();
    } catch (error) {
      console.warn("governance export package fallback", error);
    }
  }
  if (!pack) {
    pack = buildStaticGovernanceExportPackage(
      operationsDashboard?.snapshots || [],
      operationsDashboard?.dispatchRequests || [],
      operationsDashboard?.reconciliationReviews || [],
      operationsDashboard?.performanceMonitoring || {},
      operationsDashboard?.governanceReport || {},
      operationsDashboard?.intelligence || {},
      operationsDashboard?.handover || {}
    );
  }
  const filename = `${String(pack.packageName || "医院运行治理导出包").replace(/[\\/:*?"<>|]/g, "-")}-${pack.version || "static"}.md`;
  downloadText(filename, pack.markdown || governanceExportMarkdown(pack));
}

function governanceExportMarkdown(pack) {
  return [
    `# ${pack.packageName || "医院运行治理导出包"}`,
    "",
    `- 版本：${pack.version || "待生成"}`,
    `- 文件数：${pack.summary?.files || 0}`,
    `- 待复核直报差异：${pack.summary?.pendingReconciliation || 0}`,
    "",
    "## 文件清单",
    "",
    ...(pack.files || []).map((item) => `- ${item.name}：${item.description || item.owner || ""}`),
    "",
    "## 复核清单",
    "",
    ...(pack.checklist || ["导出后完成复核和审计归档。"]).map((item) => `- ${item}`)
  ].join("\n");
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

function renderPerformanceManual(dashboard, filteredSnapshots) {
  const manual = PERFORMANCE_MANUALS[performanceFilters.tier] || PERFORMANCE_MANUALS.secondary;
  const apiManual = dashboard.performanceMonitoring?.manuals?.[performanceFilters.tier] || null;
  const indicators = normalizePerformanceIndicators(manual.indicators);
  const filtered = filterPerformanceIndicators(indicators);
  if (!filtered.some((item) => item.no === selectedPerformanceIndicatorNo)) selectedPerformanceIndicatorNo = filtered[0]?.no || "";
  const sourceCoverage = performanceSourceCoverage(filtered, dashboard, filteredSnapshots);
  const summary = document.querySelector("#performance-summary");
  if (summary) {
    summary.innerHTML = [
      ["指标总数", manual.total, `${manual.quantitative}个定量，${manual.qualitative}个定性`],
      ["国家监测", manual.national, "手册标注为国家监测指标"],
      ["当前筛选", filtered.length, `${performanceFilters.domain === "all" ? "全部指标域" : performanceFilters.domain}`],
      ["运行联动", sourceCoverage.linked, `覆盖 ${sourceCoverage.coveredSources.length} 类数据来源`],
      ["需现场补接", sourceCoverage.pending, sourceCoverage.pendingSources.join("、") || "无"],
      ["后端口径", apiManual ? "已校验" : "本地口径", apiManual ? `全量覆盖 ${apiManual.coverage.linked}/${apiManual.total}` : "静态预览兜底"]
    ].map(([label, value, hint]) => `
      <article class="metric-card">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${hint}</small>
      </article>
    `).join("");
  }
  renderPerformanceDomains(indicators);
  renderPerformanceIndicators(filtered, manual, sourceCoverage);
  renderPerformanceActions(filtered, sourceCoverage, dashboard, filteredSnapshots);
  renderPerformanceReadiness(filtered, apiManual?.readinessMatrix || [], sourceCoverage);
  renderPerformanceIndicatorDetail(filtered, apiManual?.indicatorDetails || [], sourceCoverage);
}

function renderPerformanceDomains(indicators) {
  const domains = ["功能定位", "医疗质量", "运营效率", "持续发展", "满意度评价"].map((domain) => {
    const rows = indicators.filter((item) => item.domain === domain);
    const national = rows.filter((item) => item.national).length;
    return { domain, rows, national };
  }).filter((item) => item.rows.length);
  const target = document.querySelector("#performance-domains");
  if (!target) return;
  target.innerHTML = domains.map((item) => `
    <article class="performance-domain-card ${performanceFilters.domain === item.domain ? "selected" : ""}" data-performance-domain="${item.domain}">
      <strong>${item.domain}</strong>
      <span>${item.rows.length}项指标，${item.national}项国家监测</span>
      ${miniBar(item.rows.length / Math.max(indicators.length, 1) * 100)}
    </article>
  `).join("");
  document.querySelectorAll("[data-performance-domain]").forEach((card) => {
    card.addEventListener("click", () => {
      performanceFilters.domain = card.dataset.performanceDomain;
      const control = document.querySelector("#performance-domain-filter");
      if (control) control.value = performanceFilters.domain;
      renderOperationsDashboard();
    });
  });
}

function renderPerformanceIndicators(indicators, manual, sourceCoverage) {
  const target = document.querySelector("#performance-indicators");
  if (!target) return;
  const shown = indicators.slice(0, 14);
  target.innerHTML = `
    <div class="performance-manual-note">
      <strong>${manual.title} ${manual.year}</strong>
      <span>${manual.note}</span>
    </div>
    ${shown.map((item) => `
      <article class="performance-indicator-card ${item.no === selectedPerformanceIndicatorNo ? "selected" : ""}" data-performance-indicator="${item.no}">
        <div>
          <strong>${item.no}. ${item.name}</strong>
          <span>${item.domain} / ${item.source} / ${item.direction}</span>
          <small>${performanceFormula(item)}</small>
          <small>${performanceDataHook(item, sourceCoverage)}</small>
        </div>
        ${item.national ? "<span class=\"badge info\">国家监测</span>" : "<span class=\"badge\">地方监测</span>"}
      </article>
    `).join("")}
    ${indicators.length > shown.length ? `<p class="muted">已按当前条件展示前 ${shown.length} 项，共 ${indicators.length} 项。</p>` : ""}
  `;
  document.querySelectorAll("[data-performance-indicator]").forEach((card) => {
    card.addEventListener("click", () => {
      selectedPerformanceIndicatorNo = card.dataset.performanceIndicator;
      renderOperationsDashboard();
    });
  });
}

function renderPerformanceActions(indicators, sourceCoverage, dashboard, filteredSnapshots) {
  const target = document.querySelector("#performance-actions");
  if (!target) return;
  const apiActions = Array.isArray(dashboard.performanceMonitoring?.actions) ? dashboard.performanceMonitoring.actions : [];
  const pendingSources = sourceCoverage.pendingSources.map((source) => ({
    title: `补接${source}`,
    detail: `${source}仍有${indicators.filter((item) => item.source === source).length}项指标未形成实时联动，需在现场接口联调中补齐字段、口径和责任科室。`,
    level: "warn"
  }));
  const qualityActions = indicators
    .filter((item) => item.national || item.direction.includes("降低"))
    .slice(0, 4)
    .map((item) => ({
      title: `${item.name}复核`,
      detail: `${item.source}口径，导向为${item.direction}；建议与${performanceOwner(item)}建立月度复核和异常说明。`,
      level: item.national ? "info" : "normal"
    }));
  const pressureAction = filteredSnapshots.length ? [{
    title: "运行压力联动",
    detail: `当前筛选机构${filteredSnapshots.length}家，最高资源压力${Math.max(...filteredSnapshots.map((item) => Number(item.resourcePressure || 0)), 0)}；可作为绩效指标异常说明和当日调度依据。`,
    level: "danger"
  }] : [];
  const localCoverageActions = apiActions.length ? [] : [...pressureAction, ...pendingSources];
  const actions = [...localCoverageActions, ...qualityActions].slice(0, 8);
  target.innerHTML = `
    <article class="performance-action-head">
      <strong>口径行动清单</strong>
      <span>把手册指标转为数据补接、月度复核和异常说明任务</span>
    </article>
    ${apiActions.slice(0, 3).map((item) => `
      <article class="performance-action-card ${item.status === "warning" ? "danger" : item.status === "pending" ? "warn" : "info"}">
        <strong>${item.title}</strong>
        <span>${item.detail}</span>
      </article>
    `).join("")}
    ${actions.map((item) => `
      <article class="performance-action-card ${item.level}">
        <strong>${item.title}</strong>
        <span>${item.detail}</span>
      </article>
    `).join("")}
  `;
}

function renderPerformanceReadiness(indicators, apiMatrix, sourceCoverage) {
  const target = document.querySelector("#performance-readiness");
  if (!target) return;
  const indicatorCounts = indicators.reduce((acc, item) => {
    acc[item.source] = (acc[item.source] || 0) + 1;
    return acc;
  }, {});
  const fallbackRows = [...new Set(indicators.map((item) => item.source))].map((source) => {
    const ready = sourceCoverage.coveredSources.includes(source);
    return {
      source,
      indicators: indicatorCounts[source] || 0,
      status: ready ? "ready" : "pending",
      linked: ready,
      owner: performanceSourceOwner(source),
      nextAction: ready ? "已纳入运行监测和月度复核，需保持字段、口径、责任科室一致。" : "需现场补齐接口字段、统计口径、责任科室、上报周期和历史基线。"
    };
  });
  const rows = (apiMatrix.length ? apiMatrix : fallbackRows)
    .filter((item) => performanceFilters.source === "all" || item.source === performanceFilters.source)
    .map((item) => ({
      ...item,
      indicators: performanceFilters.domain === "all" ? item.indicators : indicatorCounts[item.source] || 0
    }))
    .filter((item) => item.indicators > 0);
  target.innerHTML = `
    <article class="performance-readiness-head">
      <strong>上报准备度矩阵</strong>
      <span>按数据来源核对接口联动、责任科室和下一步现场联调动作</span>
    </article>
    ${rows.map((item) => `
      <article class="performance-readiness-card ${item.status === "ready" ? "ready" : "pending"}">
        <div>
          <strong>${item.source}</strong>
          <span>${item.indicators} 项指标 / ${item.owner || performanceSourceOwner(item.source)}</span>
        </div>
        <span class="badge ${item.status === "ready" ? "success" : "warn"}">${item.status === "ready" ? "已接入" : "待联调"}</span>
        <small>${item.nextAction || (item.status === "ready" ? "保持月度复核闭环。" : "补齐现场接口和口径。")}</small>
      </article>
    `).join("") || "<p class=\"muted\">当前筛选条件下暂无需复核的数据来源。</p>"}
  `;
}

function renderPerformanceIndicatorDetail(indicators, apiDetails, sourceCoverage) {
  const target = document.querySelector("#performance-indicator-detail");
  if (!target) return;
  const selected = indicators.find((item) => item.no === selectedPerformanceIndicatorNo) || indicators[0];
  if (!selected) {
    target.innerHTML = "<p class=\"muted\">当前筛选条件下暂无绩效指标。</p>";
    return;
  }
  const apiDetail = apiDetails.find((item) => item.name === selected.name) || {};
  const sourceFields = apiDetail.sourceFields?.length ? apiDetail.sourceFields : performanceSourceFields(selected.source);
  target.innerHTML = `
    <article class="performance-detail-card">
      <div class="performance-detail-head">
        <div>
          <strong>${selected.no}. ${selected.name}</strong>
          <span>${selected.domain} / ${selected.source} / ${selected.direction}</span>
        </div>
        ${selected.national ? "<span class=\"badge info\">国家监测</span>" : "<span class=\"badge\">地方监测</span>"}
      </div>
      <div class="performance-detail-grid">
        <div><span>分子口径</span><p>${apiDetail.numerator || performanceFormula(selected)}</p></div>
        <div><span>分母口径</span><p>${apiDetail.denominator || "按同周期机构运行、财务或统计直报口径确认。"}</p></div>
        <div><span>责任科室</span><p>${performanceOwner(selected)}</p></div>
        <div><span>数据状态</span><p>${performanceDataHook(selected, sourceCoverage)}</p></div>
      </div>
      <div class="interface-field-list">${sourceFields.map((field) => `<span>${field}</span>`).join("")}</div>
      <p>${apiDetail.exceptionTemplate || `${selected.name}出现异常时，需补充数据来源、业务原因、整改动作和预计闭环时间。`}</p>
    </article>
  `;
}

function performanceSourceFields(source) {
  return OPERATIONS_INTERFACE_MAPPINGS
    .filter(([, , mappingSource]) => mappingSource === source)
    .flatMap(([, , , , , fields]) => fields.split("、"))
    .slice(0, 6);
}

function normalizePerformanceIndicators(rows) {
  return rows.map(([no, name, domain, source, direction, national]) => ({ no, name, domain, source, direction, national }));
}

function filterPerformanceIndicators(indicators) {
  return indicators.filter((item) => {
    const domainMatched = performanceFilters.domain === "all" || item.domain === performanceFilters.domain;
    const sourceMatched = performanceFilters.source === "all" || item.source === performanceFilters.source;
    return domainMatched && sourceMatched;
  });
}

function performanceSourceCoverage(indicators, dashboard, filteredSnapshots) {
  const sources = [...new Set(indicators.map((item) => item.source))];
  const linkedSources = new Set();
  if ((filteredSnapshots || []).length) {
    ["病案首页", "医院填报"].forEach((source) => linkedSources.add(source));
  }
  if (dashboard?.reconciliationReviews?.length) linkedSources.add("财务年报表");
  if (dashboard?.reusedCollections?.includes("healthStatisticsIngestion")) linkedSources.add("国家或省级平台");
  const coveredSources = sources.filter((source) => linkedSources.has(source));
  const pendingSources = sources.filter((source) => !linkedSources.has(source));
  return {
    linked: indicators.filter((item) => linkedSources.has(item.source)).length,
    pending: indicators.filter((item) => !linkedSources.has(item.source)).length,
    coveredSources,
    pendingSources
  };
}

function performanceFormula(item) {
  const name = item.name;
  if (/手术占比|手术比例/.test(name)) return "口径：相关手术人次或例数 / 同期出院或择期手术人次 × 100%。";
  if (/并发症|感染率|死亡率/.test(name)) return "口径：相关不良结局病例数 / 同期符合条件病例数 × 100%。";
  if (/平均住院日/.test(name)) return "口径：出院患者占用总床日数 / 同期出院人次数。";
  if (/费用|收入|支出|盈余|结余|负债|能耗|医保基金/.test(name)) return "口径：财务年报表对应分子 / 对应分母，按手册要求计算比例或增幅。";
  if (/医护比|医师占比|药师人数|人员|职称/.test(name)) return "口径：注册人员、在岗人员或卫生技术人员结构数据按手册分子分母计算。";
  if (/满意度/.test(name)) return "口径：国家公立医院满意度调查平台结果，按门诊、住院、医务人员分别归集。";
  if (/电子病历|预算管理|总会计师|信用/.test(name)) return "口径：国家或省级平台等级、制度建设和综合评价结果。";
  return `口径：按${item.source}采集，导向为${item.direction}。`;
}

function performanceDataHook(item, sourceCoverage) {
  const linked = sourceCoverage.coveredSources.includes(item.source);
  const state = linked ? "已接入运行监测联动" : "需现场补接";
  return `数据状态：${state}；责任建议：${performanceOwner(item)}。`;
}

function performanceSourceOwner(source) {
  if (source === "病案首页") return "病案室与医务部";
  if (source === "医院填报") return "医务部、药学部、运营管理部门";
  if (source === "财务年报表") return "财务科";
  if (source === "满意度调查平台") return "行风办、门诊部、护理部";
  if (source === "国家或省级平台") return "信息中心与业务主管科室";
  return "责任科室待确认";
}

function performanceOwner(item) {
  if (item.source === "病案首页") return "病案室与医务部";
  if (item.source === "财务年报表") return "财务科";
  if (item.source === "满意度调查平台") return "行风办与门诊部";
  if (item.source === "国家或省级平台") return "信息中心与业务主管科室";
  return item.domain === "医疗质量" ? "医务部与质控办" : "运营管理部门";
}

function renderOperationsSnapshots(items) {
  document.querySelector("#operations-snapshots").innerHTML = `
    <table>
      <thead><tr><th>机构</th><th>状态</th><th>资源压力</th><th>床位</th><th>人员</th><th>设备</th><th>门急诊</th><th>直报差异</th><th>调度建议</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr class="operation-row ${item.id === selectedSnapshotId ? "selected" : ""}" data-snapshot-id="${item.id}">
          <td><strong>${zh(item.institution)}</strong><br /><small>${formatDateTime(item.snapshotAt)}</small></td>
          <td>${statusBadge(item.normalizedStatus)}</td>
          <td>${pressureBar(item.resourcePressure)}</td>
          <td>${item.beds?.occupied || 0}/${item.beds?.open || 0}<br /><small>重症床位 ${item.beds?.icuOccupied || 0}/${item.beds?.icuTotal || 0}</small></td>
          <td>${item.staff?.doctorsOnDuty || 0} 医 / ${item.staff?.nursesOnDuty || 0} 护<br /><small>缺口 ${item.staff?.shortage || 0}</small></td>
          <td>影像设备 ${item.equipment?.ctAvailable || 0}/${item.equipment?.ctTotal || 0}<br /><small>呼吸机 ${item.equipment?.ventilatorsAvailable || 0}</small></td>
          <td>${item.outpatient?.visitsToday || 0}<br /><small>急诊 ${item.outpatient?.emergencyVisits || 0}，候诊 ${item.outpatient?.waitingOver30Min || 0}</small></td>
          <td>${percent(item.reporting?.varianceRate)}</td>
          <td>${zh(item.dispatchSuggestion)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-snapshot-id]").forEach((row) => {
    row.addEventListener("click", () => {
      selectedSnapshotId = row.dataset.snapshotId;
      renderOperationsDashboard();
    });
  });
}

function renderOperationDetail(item) {
  const detail = document.querySelector("#operation-detail");
  const hint = document.querySelector("#operation-selected-hint");
  if (!detail) return;
  if (!item) {
    if (hint) hint.textContent = "暂无匹配机构";
    detail.innerHTML = "<p class=\"muted\">当前筛选条件下暂无机构。</p>";
    return;
  }
  if (hint) hint.textContent = zh(item.institution);
  const alerts = item.activeAlerts?.length ? item.activeAlerts.map((alert) => `${statusBadge(alert.severity)} ${alertRuleName(alert.id)}`).join("") : "<span class=\"badge info\">无活动预警</span>";
  detail.innerHTML = `
    <div class="operation-detail-head">
      <strong>${zh(item.institution)}</strong>
      ${statusBadge(item.normalizedStatus)}
    </div>
    ${pressureBar(item.resourcePressure)}
    <div class="operation-detail-grid">
      <div><span>床位占用</span><strong>${percent(item.bedOccupancyRate)}</strong></div>
      <div><span>重症占用</span><strong>${percent(item.icuOccupancyRate)}</strong></div>
      <div><span>急诊人次</span><strong>${item.outpatient?.emergencyVisits || 0}</strong></div>
      <div><span>人员缺口</span><strong>${item.staff?.shortage || 0}</strong></div>
      <div><span>候诊超30分钟</span><strong>${item.outpatient?.waitingOver30Min || 0}</strong></div>
      <div><span>直报差异</span><strong>${percent(item.reporting?.varianceRate)}</strong></div>
    </div>
    <div class="operation-factor-list">
      ${operationLoadFactors(item).map((factor) => `
        <div class="operation-factor">
          <span>${factor.label}</span>
          <strong>${factor.value}</strong>
          ${miniBar(factor.score)}
        </div>
      `).join("")}
    </div>
    <div class="operation-alert-tags">${alerts}</div>
    <p>${zh(item.dispatchSuggestion)}</p>
  `;
}

function renderAlertQueue(items) {
  const alerts = items.flatMap((snapshot) => (snapshot.activeAlerts || []).map((alert) => ({
    snapshot,
    alert,
    priority: statusSeverity(alert.severity) * 100 + Number(snapshot.resourcePressure || 0)
  }))).sort((a, b) => b.priority - a.priority);
  document.querySelector("#operation-alert-queue").innerHTML = alerts.length ? alerts.map(({ snapshot, alert }) => `
    <article class="operation-alert-item">
      <div>
        <strong>${zh(snapshot.institution)} · ${alertRuleName(alert.id)}</strong>
        <span>${zh(alert.domain)} / ${zh(alert.threshold)} / 资源压力 ${snapshot.resourcePressure}</span>
      </div>
      <p>${zh(alert.dispatchBoundary)}</p>
      <div class="action-row">
        <button class="inline-action" type="button" data-alert-snapshot="${snapshot.id}">查看机构</button>
        <button class="inline-action" type="button" data-dispatch-draft="${snapshot.id}" data-alert-id="${alert.id}">生成调度</button>
      </div>
    </article>
  `).join("") : "<p class=\"muted\">当前筛选条件下暂无活动预警。</p>";
  document.querySelectorAll("[data-alert-snapshot]").forEach((button) => {
    button.addEventListener("click", () => {
      selectedSnapshotId = button.dataset.alertSnapshot;
      renderOperationsDashboard();
    });
  });
  document.querySelectorAll("[data-dispatch-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      const snapshot = (operationsDashboard?.snapshots || []).find((item) => item.id === button.dataset.dispatchDraft);
      const alert = snapshot?.activeAlerts?.find((item) => item.id === button.dataset.alertId);
      if (snapshot && alert) applyDispatchDraft(snapshot, alert);
    });
  });
}

function renderAlertRules(items) {
  document.querySelector("#operations-alert-rules").innerHTML = items.map((item) => `
    <div>
      <strong>${alertRuleName(item.id)}</strong>
      <span>${zh(item.domain)} / ${zh(item.threshold)}</span>
      <span>${statusBadge(item.severity)} ${zh(item.dispatchBoundary)}</span>
    </div>
  `).join("");
}

function renderDispatchRequests(items) {
  document.querySelector("#dispatch-requests").innerHTML = `
    <table>
      <thead><tr><th>工单</th><th>资源</th><th>来源</th><th>目标</th><th>优先级</th><th>状态</th><th>原因</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${dispatchRequestName(item)}</strong><br /><small>${formatDateTime(item.requiredBy)}</small></td>
          <td>${zh(item.resourceType)} × ${item.quantity}</td>
          <td>${zh(item.sourceInstitution)}</td>
          <td>${zh(item.targetInstitution)}</td>
          <td>${statusBadge(item.priority)}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${zh(item.reason)}</td>
          <td>${dispatchStatusButtons(item)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-dispatch-status]").forEach((button) => {
    button.addEventListener("click", () => updateDispatchStatus(button.dataset.dispatchStatus, button.dataset.nextStatus));
  });
}

function renderReconciliationReviews(items) {
  document.querySelector("#reconciliation-reviews").innerHTML = `
    <table>
      <thead><tr><th>复核单</th><th>机构</th><th>周期</th><th>差异</th><th>字段</th><th>状态</th><th>说明</th><th>操作</th></tr></thead>
      <tbody>${items.map((item) => `
        <tr>
          <td><strong>${reconciliationName(item)}</strong></td>
          <td>${zh(item.institution)}</td>
          <td>${formatPeriod(item.period)}</td>
          <td>${percent(item.varianceRate)}</td>
          <td>${zhList(item.fields || [])}</td>
          <td>${statusBadge(item.status)}</td>
          <td>${zh(item.reviewNote)}</td>
          <td>${reconciliationActionButtons(item)}</td>
        </tr>
      `).join("")}</tbody>
    </table>
  `;
  document.querySelectorAll("[data-review-recon]").forEach((button) => {
    button.addEventListener("click", () => reviewReconciliation(button.dataset.reviewRecon, button.dataset.reviewStatus));
  });
}

function bindPerformanceControls() {
  const controls = [
    ["#performance-tier-filter", "tier"],
    ["#performance-domain-filter", "domain"],
    ["#performance-source-filter", "source"]
  ];
  controls.forEach(([selector, key]) => {
    const control = document.querySelector(selector);
    if (!control) return;
    control.addEventListener("change", () => {
      performanceFilters[key] = control.value;
      renderOperationsDashboard();
    });
  });
  document.querySelector("#performance-filter-reset")?.addEventListener("click", () => {
    Object.assign(performanceFilters, { tier: "secondary", domain: "all", source: "all" });
    const values = {
      "#performance-tier-filter": "secondary",
      "#performance-domain-filter": "all",
      "#performance-source-filter": "all"
    };
    Object.entries(values).forEach(([selector, value]) => {
      const control = document.querySelector(selector);
      if (control) control.value = value;
    });
    renderOperationsDashboard();
  });
}

function bindMonitorControls() {
  const controls = [
    ["#operation-status-filter", "status", "change"],
    ["#operation-domain-filter", "domain", "change"],
    ["#operation-search", "search", "input"],
    ["#operation-sort", "sort", "change"]
  ];
  controls.forEach(([selector, key, eventName]) => {
    const control = document.querySelector(selector);
    if (!control) return;
    control.addEventListener(eventName, () => {
      operationFilters[key] = control.value.trim();
      renderOperationsDashboard();
    });
  });
  document.querySelector("#operation-filter-reset")?.addEventListener("click", () => {
    Object.assign(operationFilters, { status: "all", domain: "all", search: "", sort: "pressure" });
    const values = {
      "#operation-status-filter": "all",
      "#operation-domain-filter": "all",
      "#operation-search": "",
      "#operation-sort": "pressure"
    };
    Object.entries(values).forEach(([selector, value]) => {
      const control = document.querySelector(selector);
      if (control) control.value = value;
    });
    selectedSnapshotId = operationsDashboard?.snapshots?.[0]?.id || "";
    renderOperationsDashboard();
  });
}

function bindDispatchForm() {
  const form = document.querySelector("#dispatch-form");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(form).entries());
    values.quantity = Number(values.quantity || 1);
    if (OPERATIONS_API_BASE) {
      const request = window.HealthCityAuth?.authFetch || fetch;
      await request(`${OPERATIONS_API_BASE}/operations/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values)
      });
    }
    await loadOperationsDashboard();
  });
}

async function reviewReconciliation(id, status = "approved") {
  if (!OPERATIONS_API_BASE) return;
  const notes = {
    approved: "已由运行调度平台复核通过。",
    returned: "已退回责任科室补充字段口径和佐证材料。",
    blocked: "差异阻断直报提交，需先完成补正。",
    correcting: "已进入补正中，等待责任科室回填说明。"
  };
  const request = window.HealthCityAuth?.authFetch || fetch;
  await request(`${OPERATIONS_API_BASE}/operations/reconciliation/${encodeURIComponent(id)}/review`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status, reviewNote: notes[status] || "已更新复核状态。" })
  });
  await loadOperationsDashboard();
}

async function updateDispatchStatus(id, status) {
  if (!id || !status) return;
  const note = status === "assigned" ? "已由运行调度平台确认分派。" : status === "closed" ? "资源到位并关闭调度工单。" : `状态更新为${zh(status)}。`;
  if (OPERATIONS_API_BASE) {
    const request = window.HealthCityAuth?.authFetch || fetch;
    await request(`${OPERATIONS_API_BASE}/operations/dispatch/${encodeURIComponent(id)}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, note })
    });
  } else if (operationsDashboard?.dispatchRequests) {
    operationsDashboard.dispatchRequests = operationsDashboard.dispatchRequests.map((item) => item.id === id ? {
      ...item,
      status,
      updatedAt: new Date().toISOString(),
      auditTrail: [...(item.auditTrail || []), { at: new Date().toISOString(), actor: "static-preview", action: "status-change", note }]
    } : item);
    operationsDashboard.commandChains = buildStaticCommandChains(operationsDashboard.snapshots || [], operationsDashboard.dispatchRequests || [], operationsDashboard.reconciliationReviews || []);
    operationsDashboard.playbooks = buildStaticOperationsPlaybooks(operationsDashboard.snapshots || [], operationsDashboard.alertRules || [], operationsDashboard.commandChains || [], operationsDashboard.interfaceMapping || buildStaticInterfaceMapping());
    operationsDashboard.handover = buildStaticOperationsHandover(
      operationsDashboard.snapshots || [],
      operationsDashboard.dispatchRequests || [],
      operationsDashboard.reconciliationReviews || [],
      operationsDashboard.commandChains || [],
      operationsDashboard.playbooks || [],
      operationsDashboard.handover?.recentSignoffs || []
    );
    operationsDashboard.handoverOwnerMatrix = buildStaticHandoverOwnerMatrix(operationsDashboard.handover || {});
    renderOperationsDashboard();
    return;
  }
  await loadOperationsDashboard();
}

function filterSnapshots(items) {
  return [...items].filter((item) => {
    const statusMatched = operationFilters.status === "all" || item.normalizedStatus === operationFilters.status;
    const domainMatched = operationFilters.domain === "all" || (item.activeAlerts || []).some((alert) => alert.domain === operationFilters.domain);
    const searchMatched = !operationFilters.search || zh(item.institution).includes(operationFilters.search) || String(item.institution || "").toLowerCase().includes(operationFilters.search.toLowerCase());
    return statusMatched && domainMatched && searchMatched;
  }).sort((a, b) => {
    const sorters = {
      pressure: Number(b.resourcePressure || 0) - Number(a.resourcePressure || 0),
      bed: Number(b.bedOccupancyRate || 0) - Number(a.bedOccupancyRate || 0),
      emergency: Number(b.outpatient?.emergencyVisits || 0) - Number(a.outpatient?.emergencyVisits || 0),
      variance: Number(b.reporting?.varianceRate || 0) - Number(a.reporting?.varianceRate || 0)
    };
    return sorters[operationFilters.sort] || sorters.pressure;
  });
}

function enrichSnapshot(snapshot, rules) {
  const normalizedStatus = snapshot.normalizedStatus || normalizeOperationStatus(snapshot);
  const bedOccupancyRate = ratio(snapshot.beds?.occupied, snapshot.beds?.open);
  const icuOccupancyRate = ratio(snapshot.beds?.icuOccupied, snapshot.beds?.icuTotal);
  const activeAlerts = (snapshot.alerts || []).map((id) => rules.find((rule) => rule.id === id) || { id, severity: "warning", domain: "unknown" });
  return {
    ...snapshot,
    normalizedStatus,
    bedOccupancyRate,
    icuOccupancyRate,
    activeAlerts,
    resourcePressure: snapshot.resourcePressure || Math.round((bedOccupancyRate * 55 + icuOccupancyRate * 25 + Math.min(Number(snapshot.staff?.shortage || 0), 10) * 2) * 10) / 10
  };
}

function normalizeOperationStatus(snapshot) {
  const bedRatio = ratio(snapshot.beds?.occupied, snapshot.beds?.open);
  const variance = Number(snapshot.reporting?.varianceRate || 0);
  const staffShortage = Number(snapshot.staff?.shortage || 0);
  const waiting = Number(snapshot.outpatient?.waitingOver30Min || 0);
  if (bedRatio >= 0.95 || variance >= 0.05) return "critical";
  if (bedRatio >= 0.9 || staffShortage > 0 || waiting >= 50) return "warning";
  return "normal";
}

function pressureBar(value) {
  const pressure = Math.max(0, Math.min(100, Number(value || 0)));
  return `
    <div class="operation-pressure">
      <span style="width: ${pressure}%"></span>
      <strong>${pressure}</strong>
    </div>
  `;
}

function miniBar(value) {
  const score = Math.max(0, Math.min(100, Number(value || 0)));
  return `<div class="operation-mini-bar"><span style="width: ${score}%"></span></div>`;
}

function operationLoadFactors(item) {
  const bedScore = Number(item.bedOccupancyRate || 0) * 100;
  const emergencyScore = Math.min(100, Number(item.outpatient?.waitingOver30Min || 0) * 1.2);
  const staffScore = Math.min(100, Number(item.staff?.shortage || 0) * 12);
  const reportScore = Math.min(100, Number(item.reporting?.varianceRate || 0) * 1200);
  return [
    { label: "床位压力", value: percent(item.bedOccupancyRate), score: bedScore },
    { label: "候诊压力", value: `${item.outpatient?.waitingOver30Min || 0} 人`, score: emergencyScore },
    { label: "人员压力", value: `${item.staff?.shortage || 0} 人缺口`, score: staffScore },
    { label: "直报压力", value: percent(item.reporting?.varianceRate), score: reportScore }
  ];
}

function applyDispatchDraft(snapshot, alert) {
  const form = document.querySelector("#dispatch-form");
  if (!form) return;
  const draft = dispatchDraftForAlert(snapshot, alert);
  Object.entries(draft).forEach(([name, value]) => {
    const field = form.elements[name];
    if (field) field.value = value;
  });
  selectedSnapshotId = snapshot.id;
  renderOperationsDashboard();
  form.scrollIntoView({ behavior: "smooth", block: "center" });
  form.classList.add("is-highlighted");
  window.setTimeout(() => form.classList.remove("is-highlighted"), 1600);
}

function dispatchDraftForAlert(snapshot, alert) {
  const domain = alert.domain || "";
  const resourceType = domain === "staff" ? "护理支援" : domain === "outpatient" ? "影像检查时段" : "过渡病床";
  const quantity = domain === "staff" ? Math.max(1, Number(snapshot.staff?.shortage || 1)) : domain === "outpatient" ? 2 : Math.max(1, Math.ceil(Number(snapshot.beds?.occupied || 0) * 0.04));
  return {
    sourceInstitution: zh(snapshot.institution),
    targetInstitution: "大连市中心医院",
    resourceType,
    quantity,
    priority: alert.severity === "critical" ? "high" : "medium",
    status: "pending",
    reason: `${zh(snapshot.institution)}触发${alertRuleName(alert.id)}，${zh(alert.dispatchBoundary)}`
  };
}

function alertRuleName(id) {
  const names = {
    "bed-occupancy-high": "床位占用偏高",
    "bed-occupancy-critical": "床位占用严重",
    "staff-shortage": "人员缺口",
    "ed-waiting-high": "急诊候诊偏高",
    "reporting-variance-high": "直报差异偏高"
  };
  return names[id] || zh(id);
}

function dispatchRequestName(item) {
  const type = zh(item.resourceType || item.category);
  const suffix = String(item.id || "").match(/(\d+)$/)?.[1] || "";
  return `${type}调度单${suffix ? ` ${suffix}` : ""}`;
}

function dispatchStatusButtons(item) {
  const status = String(item.status || "");
  if (status === "pending") {
    return `<button class="inline-action compact" type="button" data-dispatch-status="${item.id}" data-next-status="assigned">分派</button>`;
  }
  if (["assigned", "in-progress"].includes(status)) {
    return `<button class="inline-action compact" type="button" data-dispatch-status="${item.id}" data-next-status="closed">关闭</button>`;
  }
  return "<span class=\"muted\">已闭环</span>";
}

function reconciliationActionButtons(item) {
  if (["approved", "closed"].includes(String(item.status || ""))) return "<span class=\"muted\">已闭环</span>";
  return `
    <div class="compact-action-row">
      <button class="inline-action compact" type="button" data-review-recon="${item.id}" data-review-status="approved">通过</button>
      <button class="inline-action compact" type="button" data-review-recon="${item.id}" data-review-status="returned">退回</button>
      <button class="inline-action compact" type="button" data-review-recon="${item.id}" data-review-status="correcting">补正中</button>
      <button class="inline-action compact" type="button" data-review-recon="${item.id}" data-review-status="blocked">阻断</button>
    </div>
  `;
}

function reconciliationName(item) {
  const suffix = String(item.id || "").match(/(\d{8})/)?.[1] || "";
  return `统计复核单${suffix ? ` ${formatDateCompact(suffix)}` : ""}`;
}

function ratio(numerator, denominator) {
  const total = Number(denominator || 0);
  return total > 0 ? Number(numerator || 0) / total : 0;
}

function percent(value) {
  return `${Math.round(Number(value || 0) * 1000) / 10}%`;
}

function statusSeverity(status) {
  return { normal: 0, warning: 1, critical: 2, high: 2, blocked: 2, medium: 1, pending: 1, assigned: 1, returned: 1, correcting: 1 }[status] ?? 0;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).replace("T", " ");
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}

function formatDateCompact(value) {
  const text = String(value || "");
  if (!/^\d{8}$/.test(text)) return text;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

function formatPeriod(period) {
  return String(period || "").replace(" AM", " 上午").replace(" PM", " 下午");
}

function statusBadge(status) {
  const text = String(status || "unknown");
  const danger = ["critical", "high", "blocked"].includes(text);
  const warn = ["warning", "medium", "pending", "assigned", "in-progress", "pending-review", "returned", "correcting"].includes(text);
  const type = danger ? "danger" : warn ? "warn" : "info";
  return `<span class="badge ${type}">${zh(text)}</span>`;
}
