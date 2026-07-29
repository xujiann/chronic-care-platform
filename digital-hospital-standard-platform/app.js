(function () {
  const storageKey = "digitalHospitalMvpState:v0.21";

  const domains = [
    { code: "A", name: "基础设施与平台支撑", weight: 100 },
    { code: "B", name: "数据治理与互联互通", weight: 150 },
    { code: "C", name: "智慧医疗与电子病历", weight: 180 },
    { code: "D", name: "智慧服务与患者体验", weight: 130 },
    { code: "E", name: "智慧管理与运营决策", weight: 130 },
    { code: "F", name: "质量安全与闭环管理", weight: 120 },
    { code: "G", name: "创新应用与智能化能力", weight: 90 },
    { code: "H", name: "安全合规与长效运行", weight: 100 },
  ];

  const indicators = [
    { code: "A1", domain: "A", name: "云网与计算资源支撑能力", max: 20, method: "混合评分", source: "模板/材料", evidence: "资源清单、架构图、部署说明", key: true, priority: "P0" },
    { code: "A2", domain: "A", name: "核心系统架构规范性", max: 15, method: "人工评分", source: "材料", evidence: "系统架构图、系统清单", key: true, priority: "P0" },
    { code: "A3", domain: "A", name: "统一身份认证与账号管理", max: 15, method: "混合评分", source: "模板/材料", evidence: "统一认证说明、账号管理制度", key: true, priority: "P0" },
    { code: "A4", domain: "A", name: "数据备份与灾备能力", max: 20, method: "人工评分", source: "材料", evidence: "备份策略、恢复演练记录", key: true, priority: "P0" },
    { code: "A5", domain: "A", name: "运维监控与告警处置", max: 15, method: "混合评分", source: "材料/模板", evidence: "监控截图、告警处置记录", key: false, priority: "P1" },
    { code: "A6", domain: "A", name: "终端、网络和设备资产管理", max: 15, method: "人工评分", source: "模板/材料", evidence: "资产台账、管理制度", key: false, priority: "P1" },
    { code: "B1", domain: "B", name: "数据标准和代码集应用", max: 25, method: "混合评分", source: "模板/材料", evidence: "数据标准清单、代码集映射表", key: true, priority: "P0" },
    { code: "B2", domain: "B", name: "主数据管理能力", max: 20, method: "人工评分", source: "模板/材料", evidence: "患者、人员、科室等主数据说明", key: true, priority: "P0" },
    { code: "B3", domain: "B", name: "院内系统集成和接口治理", max: 25, method: "自动/混合评分", source: "模板/API", evidence: "接口清单、调用统计", key: true, priority: "P0" },
    { code: "B4", domain: "B", name: "区域平台接入和数据共享", max: 25, method: "自动/混合评分", source: "模板/API/材料", evidence: "接入证明、共享清单、成功率统计", key: true, priority: "P0" },
    { code: "B5", domain: "B", name: "数据质量管理", max: 25, method: "自动/混合评分", source: "模板/API", evidence: "缺失率、重复率、规范率、整改记录", key: true, priority: "P0" },
    { code: "B6", domain: "B", name: "数据目录和数据资产管理", max: 15, method: "人工评分", source: "材料", evidence: "数据目录、数据责任清单", key: false, priority: "P1" },
    { code: "B7", domain: "B", name: "数据使用审批与授权管理", max: 15, method: "人工评分", source: "材料", evidence: "审批流程、授权记录", key: true, priority: "P1" },
    { code: "C1", domain: "C", name: "电子病历应用水平", max: 30, method: "混合评分", source: "导入/材料", evidence: "既有评级结果、系统覆盖说明", key: true, priority: "P0" },
    { code: "C2", domain: "C", name: "临床诊疗闭环管理", max: 30, method: "混合评分", source: "模板/材料", evidence: "医嘱、检查、检验、手术等闭环截图和统计", key: true, priority: "P0" },
    { code: "C3", domain: "C", name: "移动医疗和移动护理应用", max: 20, method: "人工评分", source: "模板/材料", evidence: "移动查房、移动护理应用说明", key: false, priority: "P1" },
    { code: "C4", domain: "C", name: "临床决策支持", max: 25, method: "自动/混合评分", source: "模板/API/材料", evidence: "规则清单、提醒统计、采纳率", key: true, priority: "P0" },
    { code: "C5", domain: "C", name: "医疗质量智能质控", max: 25, method: "自动/混合评分", source: "模板/API/材料", evidence: "质控规则、问题统计、整改记录", key: true, priority: "P0" },
    { code: "C6", domain: "C", name: "多学科协同和远程会诊", max: 15, method: "混合评分", source: "模板/材料", evidence: "会诊记录统计、系统说明", key: false, priority: "P1" },
    { code: "C7", domain: "C", name: "检查检验结果共享应用", max: 20, method: "自动/混合评分", source: "模板/API", evidence: "共享项目、调用量、互认情况", key: false, priority: "P1" },
    { code: "C8", domain: "C", name: "药事和用药安全智能管理", max: 15, method: "混合评分", source: "模板/材料", evidence: "合理用药、审方、预警记录", key: false, priority: "P1" },
    { code: "D1", domain: "D", name: "预约诊疗和分时段服务", max: 20, method: "自动/混合评分", source: "模板/API", evidence: "预约量、可预约号源、截图", key: true, priority: "P0" },
    { code: "D2", domain: "D", name: "线上缴费和电子票据", max: 15, method: "自动/混合评分", source: "模板/API/材料", evidence: "支付场景、电子票据说明", key: false, priority: "P1" },
    { code: "D3", domain: "D", name: "检查检验报告线上查询", max: 15, method: "自动/混合评分", source: "模板/API", evidence: "查询量、可查项目、截图", key: true, priority: "P0" },
    { code: "D4", domain: "D", name: "互联网诊疗和复诊服务", max: 20, method: "混合评分", source: "模板/API/材料", evidence: "互联网诊疗量、处方、药品配送", key: false, priority: "P1" },
    { code: "D5", domain: "D", name: "院内导航和就医流程优化", max: 15, method: "人工评分", source: "材料", evidence: "导航、排队、候诊、叫号说明", key: false, priority: "P1" },
    { code: "D6", domain: "D", name: "老年人和特殊人群适老化服务", max: 15, method: "人工评分", source: "材料", evidence: "适老化页面、人工辅助流程", key: true, priority: "P1" },
    { code: "D7", domain: "D", name: "患者反馈与投诉闭环", max: 15, method: "混合评分", source: "模板/材料", evidence: "满意度、投诉处理和闭环记录", key: false, priority: "P1" },
    { code: "D8", domain: "D", name: "多渠道服务一致性", max: 15, method: "人工评分", source: "材料", evidence: "APP、小程序、自助机、窗口流程说明", key: false, priority: "P1" },
    { code: "E1", domain: "E", name: "医院运营分析平台", max: 20, method: "人工评分", source: "材料", evidence: "运营看板、指标清单", key: true, priority: "P0" },
    { code: "E2", domain: "E", name: "财务预算和成本管理", max: 20, method: "人工评分", source: "材料", evidence: "预算、成本核算、分析报表", key: false, priority: "P1" },
    { code: "E3", domain: "E", name: "药品耗材闭环监管", max: 20, method: "混合评分", source: "模板/材料", evidence: "采购、库存、使用、追溯记录", key: true, priority: "P0" },
    { code: "E4", domain: "E", name: "人力资源和绩效管理", max: 15, method: "人工评分", source: "材料", evidence: "排班、绩效、培训系统说明", key: false, priority: "P1" },
    { code: "E5", domain: "E", name: "设备资产和后勤管理", max: 15, method: "混合评分", source: "模板/材料", evidence: "设备台账、维修、能耗、安防", key: false, priority: "P1" },
    { code: "E6", domain: "E", name: "医保和支付管理支撑", max: 15, method: "人工评分", source: "材料", evidence: "医保审核、支付方式改革支撑", key: false, priority: "P1" },
    { code: "E7", domain: "E", name: "领导驾驶舱和专题分析", max: 15, method: "人工评分", source: "材料", evidence: "驾驶舱截图、专题报告", key: false, priority: "P1" },
    { code: "E8", domain: "E", name: "管理流程线上化", max: 10, method: "混合评分", source: "模板/材料", evidence: "OA、审批、流程统计", key: false, priority: "P1" },
    { code: "F1", domain: "F", name: "医疗质量指标在线监测", max: 20, method: "自动/混合评分", source: "模板/API/材料", evidence: "质量指标看板、统计报表", key: true, priority: "P0" },
    { code: "F2", domain: "F", name: "核心制度信息化闭环", max: 20, method: "人工评分", source: "材料", evidence: "核心制度流程截图、闭环记录", key: true, priority: "P0" },
    { code: "F3", domain: "F", name: "不良事件上报与处置", max: 15, method: "混合评分", source: "模板/材料", evidence: "上报量、处理率、整改记录", key: false, priority: "P1" },
    { code: "F4", domain: "F", name: "患者安全风险预警", max: 15, method: "混合评分", source: "模板/API/材料", evidence: "预警规则和处置记录", key: true, priority: "P0" },
    { code: "F5", domain: "F", name: "院感和公共卫生事件支撑", max: 15, method: "混合评分", source: "模板/材料", evidence: "院感监测、预警和上报记录", key: false, priority: "P1" },
    { code: "F6", domain: "F", name: "问题整改闭环", max: 20, method: "混合评分", source: "模板/材料", evidence: "问题台账、整改率、复核记录", key: true, priority: "P0" },
    { code: "F7", domain: "F", name: "质量改进知识库和案例库", max: 15, method: "人工评分", source: "材料", evidence: "典型案例、改进报告", key: false, priority: "P2" },
    { code: "G1", domain: "G", name: "AI辅助诊疗规范应用", max: 20, method: "人工评分", source: "材料/模板", evidence: "场景说明、审批制度、人工复核机制", key: true, priority: "P1" },
    { code: "G2", domain: "G", name: "AI辅助管理和服务应用", max: 15, method: "人工评分", source: "材料", evidence: "应用说明、成效分析", key: false, priority: "P2" },
    { code: "G3", domain: "G", name: "物联网和智能设备应用", max: 15, method: "混合评分", source: "模板/材料", evidence: "设备清单、场景说明", key: false, priority: "P2" },
    { code: "G4", domain: "G", name: "远程医疗和协同服务", max: 15, method: "混合评分", source: "模板/API/材料", evidence: "远程会诊、远程影像、远程心电统计", key: false, priority: "P1" },
    { code: "G5", domain: "G", name: "科研数据平台和真实世界数据应用", max: 10, method: "人工评分", source: "材料", evidence: "数据平台、伦理和脱敏制度", key: false, priority: "P2" },
    { code: "G6", domain: "G", name: "创新应用成效评价", max: 15, method: "人工评分", source: "材料", evidence: "效率、质量、体验、安全成效报告", key: false, priority: "P2" },
    { code: "H1", domain: "H", name: "网络安全等级保护", max: 20, method: "人工评分", source: "材料", evidence: "定级备案、测评报告、整改记录", key: true, priority: "P0" },
    { code: "H2", domain: "H", name: "数据安全分类分级", max: 15, method: "人工评分", source: "材料", evidence: "分类分级制度、数据目录", key: true, priority: "P0" },
    { code: "H3", domain: "H", name: "个人信息保护", max: 15, method: "人工评分", source: "材料", evidence: "告知同意、授权、脱敏、审计制度", key: true, priority: "P0" },
    { code: "H4", domain: "H", name: "权限管理和账号审计", max: 15, method: "混合评分", source: "模板/材料", evidence: "权限复核、账号停用、审计记录", key: true, priority: "P0" },
    { code: "H5", domain: "H", name: "日志审计和安全监测", max: 15, method: "混合评分", source: "材料/模板", evidence: "日志留存、监测告警、处置记录", key: true, priority: "P0" },
    { code: "H6", domain: "H", name: "应急预案和演练", max: 10, method: "人工评分", source: "材料", evidence: "应急预案、演练记录", key: false, priority: "P1" },
    { code: "H7", domain: "H", name: "长效运行制度", max: 10, method: "人工评分", source: "材料", evidence: "运维制度、数据治理制度、评价整改制度", key: false, priority: "P1" },
  ];

  const seedState = {
    activeView: "dashboard",
    activeRole: "国家级管理员",
    selectedHospital: "H000001",
    task: {
      id: "TASK-2026-001",
      name: "2026数智医院试点评价",
      standard: "STD-2026-TRIAL",
      status: "填报中",
      deadline: "2026-09-30",
    },
    tasks: [
      { id: "TASK-2026-001", name: "2026数智医院试点评价", type: "试点评价", standard: "STD-2026-TRIAL", scope: "大连市二级及以上公立医院", status: "填报中", start: "2026-08-01", submitDue: "2026-09-30", reviewDue: "2026-11-15", resultAt: "2026-12-20", hospitals: ["H000001", "H000002", "H000003"], reminders: 2, extensionRequests: 1 },
      { id: "TASK-2026-002", name: "安全合规专项抽查", type: "专项评价", standard: "STD-2026-TRIAL", scope: "三级医院安全合规域", status: "未开始", start: "2026-10-10", submitDue: "2026-10-30", reviewDue: "2026-11-30", resultAt: "2026-12-15", hospitals: ["H000001", "H000002"], reminders: 0, extensionRequests: 0 },
    ],
    roles: [
      { name: "国家级管理员", org: "国家级平台", dataScope: "全国", permissions: ["标准发布", "全国任务", "抽查复核", "结果发布", "运行归档", "统计分析"] },
      { name: "省级管理员", org: "省级平台", dataScope: "本省", permissions: ["任务承接", "医院范围", "审核分派", "催办延期", "省域统计"] },
      { name: "省级审核员", org: "省级审核组", dataScope: "分派任务", permissions: ["指标审核", "退回补正", "专家复核", "整改复核"] },
      { name: "专家复核员", org: "专家组", dataScope: "复核任务", permissions: ["专家结论", "调整扣分", "要求补证"] },
      { name: "医院管理员", org: "医疗机构", dataScope: "本院", permissions: ["医院画像", "院内分工", "申报提交", "整改提交"] },
      { name: "医院填报员", org: "医疗机构", dataScope: "本人分工", permissions: ["指标填报", "材料上传", "问题补正"] },
      { name: "运维安全员", org: "平台技术组", dataScope: "系统运行", permissions: ["用户权限", "日志审计", "导出审批", "运维监控"] },
    ],
    users: [
      { id: "U001", name: "国家管理员", role: "国家级管理员", org: "国家级平台", status: "启用", lastLogin: "2026-07-27 09:10" },
      { id: "U102", name: "省级管理员", role: "省级管理员", org: "辽宁省", status: "启用", lastLogin: "2026-07-27 10:15" },
      { id: "U203", name: "审核员A", role: "省级审核员", org: "辽宁省审核组", status: "启用", lastLogin: "2026-07-27 11:02" },
      { id: "U301", name: "专家B", role: "专家复核员", org: "数据互联互通专家组", status: "启用", lastLogin: "2026-07-27 12:20" },
      { id: "U401", name: "医院填报员", role: "医院填报员", org: "大连市示例中心医院", status: "启用", lastLogin: "2026-07-27 13:10" },
    ],
    hospitals: [
      { code: "H000001", name: "大连市示例中心医院", level: "三级", type: "综合", city: "大连市", owner: "信息中心", contact: "王主任", systems: 18, regionConnected: "已接入", emrGrade: "5级", smartService: "3级" },
      { code: "H000002", name: "大连市示例专科医院", level: "三级", type: "专科", city: "大连市", owner: "医务部", contact: "李主任", systems: 12, regionConnected: "部分接入", emrGrade: "4级", smartService: "2级" },
      { code: "H000003", name: "区县示例人民医院", level: "二级", type: "综合", city: "大连市", owner: "信息科", contact: "赵科长", systems: 9, regionConnected: "待完善", emrGrade: "3级", smartService: "1级" },
    ],
    metrics: {
      outpatientTotal: 450000,
      onlineAppointments: 220000,
      interfaceCalls: 10000,
      interfaceSuccess: 9950,
      dataTotal: 100000,
      missingRecords: 300,
      duplicateRecords: 80,
      invalidCodeRecords: 120,
    },
    publicHealth: {
      schemaVersion: 3,
      migrationSource: {
        taskTitle: "开发数智医院标准平台",
        sourceCommit: "4142402e0c79fd8457c00c370b5d163e88cca0e7",
        sourceVersion: "v0.17",
        mergedInto: "github-v0.19",
      },
      endpointConnectivityReady: true,
      continuousConnectivityReady: true,
      productionReady: false,
      consecutiveCampaigns: 3,
      requiredConsecutiveCampaigns: 3,
      campaignChainLinksVerified: 2,
      continuityBreak: null,
      lanes: [
        { id: "infectious-reporting", name: "传染病直报", owner: "疾控与医政", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "immunization", name: "免疫规划", owner: "疾控免疫科", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "maternal-child", name: "妇幼健康", owner: "妇幼健康处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "senior-health", name: "老年健康", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "chronic-disease", name: "慢病管理", owner: "疾控慢病科", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "public-health-followup", name: "公卫随访", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "health-education", name: "健康教育", owner: "宣传与健康促进", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
        { id: "family-doctor", name: "家庭医生", owner: "基层卫生处", endpoint: "已配置", probe: "已验证", campaign: "PHC-20260728-003" },
      ],
      campaigns: [
        { id: "PHC-20260728-001", completedAt: "2026-07-28 09:20", receipts: 8, status: "已验证", chain: "genesis" },
        { id: "PHC-20260728-002", completedAt: "2026-07-28 09:35", receipts: 8, status: "已验证", chain: "verified" },
        { id: "PHC-20260728-003", completedAt: "2026-07-28 09:50", receipts: 8, status: "已验证", chain: "verified" },
      ],
      incidents: [
        { id: "PHE-20260728-003", revision: 1, laneId: "infectious-reporting", title: "传染病直报回执超时", level: "P0", source: "连续探测", hospitalCode: "H000001", owner: "疾控与医政联络组", status: "待核查", discoveredAt: "2026-07-28 09:52", dueAt: "2026-07-28 10:22", lastUpdatedAt: "2026-07-28 09:52", latestAction: "等待核对上报端与接收端回执", evidenceIds: [] },
        { id: "PHE-20260728-002", revision: 2, laneId: "public-health-followup", title: "重点人群随访数据延迟", level: "P1", source: "时效规则", hospitalCode: "H000003", owner: "基层卫生处协同组", status: "处置中", discoveredAt: "2026-07-28 08:40", dueAt: "2026-07-28 12:00", lastUpdatedAt: "2026-07-28 09:35", latestAction: "医院已补传，等待平台侧重算", evidenceIds: [] },
        { id: "PHE-20260727-006", revision: 3, laneId: "immunization", title: "免疫规划代码映射差异", level: "P1", source: "数据校验", hospitalCode: "H000002", owner: "疾控免疫科", status: "待复核", discoveredAt: "2026-07-27 15:10", dueAt: "2026-07-28 15:10", lastUpdatedAt: "2026-07-28 09:10", latestAction: "映射表已修订，等待业务复核", submittedForReviewBy: "省级管理员", evidenceIds: ["PHEV-IMM-RECEIPT", "PHEV-IMM-JOINT", "PHEV-IMM-APPROVAL"] },
        { id: "PHE-20260727-004", revision: 4, laneId: "maternal-child", title: "妇幼健康批次完整性告警", level: "P1", source: "完整性规则", hospitalCode: "H000001", owner: "妇幼健康处", status: "已关闭", discoveredAt: "2026-07-27 10:20", dueAt: "2026-07-27 14:20", lastUpdatedAt: "2026-07-27 13:05", closedAt: "2026-07-27 13:05", latestAction: "补传完成，完整性复核通过", submittedForReviewBy: "省级管理员", evidenceIds: ["PHEV-MCH-RECEIPT", "PHEV-MCH-JOINT", "PHEV-MCH-APPROVAL"] },
      ],
      incidentEvidence: [
        { id: "PHEV-IMM-APPROVAL", revision: 1, incidentId: "PHE-20260727-006", hospitalCode: "H000002", evidenceType: "production-approval", referenceNo: "APPROVAL-IMM-20260728-01", summary: "免疫规划映射修订生产审批摘要，等待独立签收。", digest: "sha256:9f52d954e6f7c124a2aa0ba85e855e41660ad58444ff59aca58b57a4d8a85cc8", status: "submitted", submittedBy: "省级管理员", submittedAt: "2026-07-28 09:08", productionEvidence: false },
        { id: "PHEV-IMM-JOINT", revision: 2, incidentId: "PHE-20260727-006", hospitalCode: "H000002", evidenceType: "site-joint-test", referenceNo: "JOINT-IMM-20260728-01", summary: "免疫规划代码映射双向联调记录已完成独立核验。", digest: "sha256:301a1796fd9661bdb02e71518ccb4e6348295b99237f48bb106693e74ab9ce8d", status: "accepted", submittedBy: "省级管理员", submittedAt: "2026-07-28 08:42", reviewedBy: "国家级管理员", reviewedAt: "2026-07-28 08:55", reviewNote: "联调编号、摘要与事件引用一致。", productionEvidence: false },
        { id: "PHEV-IMM-RECEIPT", revision: 2, incidentId: "PHE-20260727-006", hospitalCode: "H000002", evidenceType: "business-receipt", referenceNo: "RECEIPT-IMM-20260728-01", summary: "免疫规划接收端确认代码映射修订后的业务回执摘要。", digest: "sha256:7c7e799af6a6314648370d2970b89245b10f37dba6fd291f34ea0c6ef6c34d1a", status: "accepted", submittedBy: "省级管理员", submittedAt: "2026-07-28 08:40", reviewedBy: "国家级管理员", reviewedAt: "2026-07-28 08:54", reviewNote: "回执编号和最小化摘要核验通过。", productionEvidence: false },
        { id: "PHEV-MCH-APPROVAL", revision: 2, incidentId: "PHE-20260727-004", hospitalCode: "H000001", evidenceType: "production-approval", referenceNo: "APPROVAL-MCH-20260727-01", summary: "妇幼健康批次补传生产审批编号已完成独立签收。", digest: "sha256:8427f7328d6ca1d36e701da40aa7590bc68d08fb8fd9b3c619498d73363a9f40", status: "accepted", submittedBy: "省级管理员", submittedAt: "2026-07-27 12:35", reviewedBy: "国家级管理员", reviewedAt: "2026-07-27 12:55", reviewNote: "生产审批编号与事件范围一致。", productionEvidence: false },
        { id: "PHEV-MCH-JOINT", revision: 2, incidentId: "PHE-20260727-004", hospitalCode: "H000001", evidenceType: "site-joint-test", referenceNo: "JOINT-MCH-20260727-01", summary: "妇幼健康批次完整性现场联调记录已完成独立签收。", digest: "sha256:b820f605619501772187262a069278232ce6f791048f1de0de91dfe7d3bb1ea8", status: "accepted", submittedBy: "省级管理员", submittedAt: "2026-07-27 12:20", reviewedBy: "国家级管理员", reviewedAt: "2026-07-27 12:50", reviewNote: "现场联调范围、批次和结果摘要核验通过。", productionEvidence: false },
        { id: "PHEV-MCH-RECEIPT", revision: 2, incidentId: "PHE-20260727-004", hospitalCode: "H000001", evidenceType: "business-receipt", referenceNo: "RECEIPT-MCH-20260727-01", summary: "妇幼健康批次补传完成后的接收端业务回执摘要。", digest: "sha256:0240e42f4fd02344ad81f58aebdc8e109595e10a00d18e055e6dbb495c0af77c", status: "accepted", submittedBy: "省级管理员", submittedAt: "2026-07-27 12:18", reviewedBy: "国家级管理员", reviewedAt: "2026-07-27 12:48", reviewNote: "业务回执编号、摘要和证据摘要一致。", productionEvidence: false },
      ],
      evidenceActions: [
        { id: "PHEVA-003", evidenceId: "PHEV-IMM-APPROVAL", incidentId: "PHE-20260727-006", action: "登记现场证据", actor: "省级管理员", at: "2026-07-28 09:08", result: "登记生产审批编号，等待独立签收", revision: 1 },
        { id: "PHEVA-002", evidenceId: "PHEV-IMM-JOINT", incidentId: "PHE-20260727-006", action: "独立签收证据", actor: "国家级管理员", at: "2026-07-28 08:55", result: "联调编号、摘要与事件引用一致", revision: 2 },
        { id: "PHEVA-001", evidenceId: "PHEV-IMM-RECEIPT", incidentId: "PHE-20260727-006", action: "独立签收证据", actor: "国家级管理员", at: "2026-07-28 08:54", result: "回执编号和最小化摘要核验通过", revision: 2 },
      ],
      incidentActions: [
        { id: "PHA-004", incidentId: "PHE-20260727-004", action: "复核关闭", actor: "妇幼健康处", at: "2026-07-27 13:05", result: "补传完成，完整性复核通过", revision: 4 },
        { id: "PHA-003", incidentId: "PHE-20260727-006", action: "提交复核", actor: "疾控免疫科", at: "2026-07-28 09:10", result: "代码映射表已修订", revision: 3 },
        { id: "PHA-002", incidentId: "PHE-20260728-002", action: "开始处置", actor: "基层卫生处协同组", at: "2026-07-28 09:35", result: "医院已补传，等待平台侧重算", revision: 2 },
        { id: "PHA-001", incidentId: "PHE-20260728-003", action: "登记事件", actor: "连续探测服务", at: "2026-07-28 09:52", result: "回执超时，进入人工核查", revision: 1 },
      ],
      blockers: [
        "可信现场证据尚未签收",
        "正式业务回执与生产交接尚未完成",
        "P0/P1阻断需由责任部门关闭",
        "灾备、回退演练及多方上线审批待完成",
      ],
    },
    submissions: {},
    assignments: [
      { hospitalCode: "H000001", indicatorCode: "B3", department: "信息中心", assignee: "接口管理员", due: "2026-09-10", status: "已分派" },
      { hospitalCode: "H000001", indicatorCode: "H1", department: "网络安全办", assignee: "安全专员", due: "2026-09-12", status: "待提交" },
      { hospitalCode: "H000002", indicatorCode: "C1", department: "医务部", assignee: "病案管理员", due: "2026-09-18", status: "已分派" },
    ],
    evidenceMaterials: [
      { id: "EV-B3-001", hospitalCode: "H000001", indicatorCode: "B3", name: "接口清单与调用统计.xlsx", type: "Excel", version: 2, sensitivity: "S3", status: "已校验", uploadedBy: "接口管理员", uploadedAt: "2026-07-27 10:30", expireAt: "2026-12-31", watermark: "已加水印" },
      { id: "EV-C1-001", hospitalCode: "H000001", indicatorCode: "C1", name: "电子病历评级证明.pdf", type: "PDF", version: 1, sensitivity: "S2", status: "已校验", uploadedBy: "病案室", uploadedAt: "2026-07-26 16:10", expireAt: "2027-06-30", watermark: "已加水印" },
      { id: "EV-H1-001", hospitalCode: "H000001", indicatorCode: "H1", name: "等保测评报告.pdf", type: "PDF", version: 1, sensitivity: "S4", status: "待复核", uploadedBy: "安全专员", uploadedAt: "2026-07-27 11:40", expireAt: "2026-09-01", watermark: "审批后水印" },
      { id: "EV-D1-001", hospitalCode: "H000002", indicatorCode: "D1", name: "预约诊疗统计.csv", type: "CSV", version: 1, sensitivity: "S3", status: "缺少说明", uploadedBy: "门诊部", uploadedAt: "2026-07-25 09:20", expireAt: "2026-12-31", watermark: "已加水印" },
    ],
    validationIssues: [],
    reviewNotes: [
      {
        id: "NOTE-SEED-EXP-B3",
        hospitalCode: "H000001",
        indicatorCode: "B3",
        status: "专家复核",
        text: "B3 院内系统集成和接口治理：因接口成功率口径接近边界，提交专家复核。",
        at: "2026-07-27 10:20",
      },
    ],
    expertReviews: [
      {
        id: "EXP-H000001-B3-SEED",
        hospitalCode: "H000001",
        indicatorCode: "B3",
        submittedBy: "省级审核组",
        expertGroup: "数据互联互通专家组",
        priority: "高",
        status: "待复核",
        reason: "接口调用成功率接近优秀级边界，需核验统计口径和接口清单完整性。",
        suggestedScore: null,
        conclusion: "",
        submittedAt: "2026-07-27 10:20",
        completedAt: "",
      },
    ],
    rectifications: [],
    reviewAssignments: [
      { id: "RA-H000001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", reviewer: "审核员A", status: "待审核", risk: "高", submittedAt: "2026-09-28 15:20", issueCount: 2, materialMissing: 1 },
      { id: "RA-H000002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", reviewer: "未分派", status: "待分派", risk: "中", submittedAt: "2026-09-29 10:40", issueCount: 1, materialMissing: 2 },
      { id: "RA-H000003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", reviewer: "审核员B", status: "审核中", risk: "中", submittedAt: "2026-09-26 11:15", issueCount: 3, materialMissing: 1 },
    ],
    scoringRules: [
      { id: "SR-DOMAIN", name: "八大指标域加权计分", type: "权重", status: "启用", owner: "标准规则组", description: "按指标样本得分折算至指标域权重，总分1000分。" },
      { id: "SR-BOTTOM", name: "底线项等级限制", type: "底线", status: "启用", owner: "安全合规组", description: "重大安全、数据造假、个人信息违规触发后限制高等级。" },
      { id: "SR-MAPPING", name: "既有评价映射继承", type: "映射", status: "试运行", owner: "标准规则组", description: "电子病历、互联互通、智慧服务既有等级可映射为参考分。" },
      { id: "SR-APPEAL", name: "复议更正规则", type: "流程", status: "待审批", owner: "评价管理组", description: "结果发布后允许在限定期限内发起申诉复议。" },
    ],
    bottomLineRules: [
      { id: "BL-01", name: "重大网络安全事件", triggered: false, effect: "限制高等级评价" },
      { id: "BL-02", name: "重大数据安全事件", triggered: false, effect: "限制高等级评价" },
      { id: "BL-04", name: "数据造假", triggered: false, effect: "取消当期资格或降级" },
      { id: "BL-06", name: "AI应用无人工复核", triggered: true, effect: "不得作为创新加分依据" },
    ],
    appeals: [
      { id: "AP-H000002-D1", hospitalCode: "H000002", indicatorCode: "D1", reason: "预约诊疗统计周期口径已补充说明", status: "待处理", submittedAt: "2026-12-22 09:30", conclusion: "" },
    ],
    exportApprovals: [
      { id: "EX-001", requester: "省级管理员", packageType: "专家复核包", scope: "H000001", sensitivity: "S3", status: "待审批", requestedAt: "2026-07-27 14:00" },
      { id: "EX-002", requester: "运维安全员", packageType: "运行监管包", scope: "2026年度", sensitivity: "S2", status: "已通过", requestedAt: "2026-07-27 13:10" },
    ],
    systemParams: [
      { key: "单文件大小上限", value: "200MB", owner: "运维安全员", updatedAt: "2026-07-27 10:00" },
      { key: "临期催办提前量", value: "7天", owner: "省级管理员", updatedAt: "2026-07-27 10:20" },
      { key: "导出链接有效期", value: "24小时", owner: "运维安全员", updatedAt: "2026-07-27 11:00" },
    ],
    auditLogs: [
      { at: "2026-07-27 14:00", user: "省级管理员", action: "申请导出专家复核包", target: "H000001", result: "待审批" },
      { at: "2026-07-27 13:30", user: "审核员A", action: "提交专家复核", target: "B3", result: "已留痕" },
      { at: "2026-07-27 12:40", user: "医院填报员", action: "上传证据材料", target: "H1", result: "待复核" },
    ],
    spotChecks: [
      { id: "SC-2026-001", batch: "2026第一批国家抽查", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", source: "高风险自动入池", reason: "H1安全合规材料临期且存在底线项提示", sampleRate: "20%", reviewer: "国家抽查组A", status: "待复核", due: "2026-11-20", findings: 0 },
      { id: "SC-2026-002", batch: "2026第一批国家抽查", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", source: "分层随机抽样", reason: "三级专科医院分层样本", sampleRate: "15%", reviewer: "未分派", status: "待分派", due: "2026-11-22", findings: 0 },
    ],
    sandboxConfig: {
      successRateThreshold: 98,
      evidenceMinimum: 1,
      anomalyMultiplier: 1.5,
    },
    sandboxRuns: [
      { id: "SB-20260727-001", ruleName: "接口成功率优秀阈值", version: "候选v2", population: 126, affected: 18, avgDelta: -6.4, gradeChanges: 3, bottomLineHits: 0, status: "待审批", runAt: "2026-07-27 14:20", approvedBy: "" },
    ],
    materialClassifications: [
      { id: "MC-EV-B3-001", materialId: "EV-B3-001", materialName: "接口清单与调用统计.xlsx", suggestedIndicator: "B3", category: "接口与共享统计", confidence: 96, risk: "低", status: "待确认" },
      { id: "MC-EV-H1-001", materialId: "EV-H1-001", materialName: "等保测评报告.pdf", suggestedIndicator: "H1", category: "安全合规证明", confidence: 98, risk: "高", status: "待确认" },
    ],
    peerAnomalies: [
      { id: "AN-2026-001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", metric: "接口调用成功率", value: "99.5%", peerMedian: "97.8%", deviation: "+1.7个百分点", level: "中", reason: "显著高于同级综合医院中位数，需核验统计口径", status: "待核验" },
      { id: "AN-2026-002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", metric: "线上预约占比", value: "71.2%", peerMedian: "43.5%", deviation: "+27.7个百分点", level: "高", reason: "高于同类专科医院四分位上限", status: "待核验" },
      { id: "AN-2026-003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", metric: "数据缺失率", value: "2.8%", peerMedian: "0.9%", deviation: "+1.9个百分点", level: "高", reason: "缺失率高于同级医院预警阈值", status: "已转抽查" },
    ],
    notifications: [
      { id: "MSG-001", title: "申报截止前7天提醒", recipient: "大连市示例中心医院", role: "医院管理员", channel: "移动端", priority: "紧急", status: "已送达", createdAt: "2026-09-23 09:00", read: false },
      { id: "MSG-002", title: "H1安全合规材料即将到期", recipient: "安全专员", role: "医院填报员", channel: "站内信", priority: "高", status: "已读", createdAt: "2026-07-27 13:40", read: true },
      { id: "MSG-003", title: "省级审核任务已分派", recipient: "审核员A", role: "省级审核员", channel: "短信", priority: "普通", status: "已送达", createdAt: "2026-07-27 12:20", read: false },
    ],
    notificationChannels: [
      { channel: "站内信", enabled: true, scope: "全部业务事件" },
      { channel: "移动端", enabled: true, scope: "截止、退回、抽查、整改" },
      { channel: "短信", enabled: true, scope: "紧急与逾期事件" },
      { channel: "邮件", enabled: false, scope: "日报与周报" },
    ],
    importJobs: [
      { id: "IMP-20260727-001", fileName: "接口共享统计_2026Q2.xlsx", template: "接口共享统计模板v1.2", rows: 1260, accepted: 1248, rejected: 12, status: "部分成功", submittedBy: "接口管理员", submittedAt: "2026-07-27 11:10", report: "12行机构代码或统计周期不符合要求" },
      { id: "IMP-20260727-002", fileName: "线上服务统计_2026Q2.csv", template: "线上服务统计模板v1.1", rows: 328, accepted: 328, rejected: 0, status: "已入库", submittedBy: "门诊部", submittedAt: "2026-07-27 10:30", report: "校验通过" },
    ],
    submissionBatches: [
      { id: "BATCH-2026-01", name: "2026首批综合试点", region: "辽宁省大连市", standard: "STD-2026-TRIAL", hospitalLevel: "二级及以上公立医院", hospitalCount: 38, status: "填报中", start: "2026-08-01", submitDue: "2026-09-30", reviewDue: "2026-11-15", reportAt: "2026-12-20", submitted: 21, reviewed: 8, owner: "省级评价管理组" },
      { id: "BATCH-2026-02", name: "安全合规专项试点", region: "辽宁省", standard: "STD-2026-TRIAL", hospitalLevel: "三级公立医院", hospitalCount: 16, status: "待发布", start: "2026-10-10", submitDue: "2026-10-30", reviewDue: "2026-11-30", reportAt: "2026-12-15", submitted: 0, reviewed: 0, owner: "安全合规组" },
      { id: "BATCH-2026-03", name: "区县医院验证批次", region: "大连市区县", standard: "STD-2026-TRIAL", hospitalLevel: "二级公立医院", hospitalCount: 12, status: "草稿", start: "2026-11-01", submitDue: "2026-11-25", reviewDue: "2026-12-10", reportAt: "2026-12-28", submitted: 0, reviewed: 0, owner: "市级试点专班" },
    ],
    uploadQueue: [
      { id: "UP-20260727-001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", fileName: "数据治理制度汇编.pdf", materialType: "制度材料", size: "18.4MB", progress: 100, status: "已完成", scanStatus: "病毒扫描通过", classification: "B1/B2/B6", submittedAt: "2026-07-27 14:22", retries: 0 },
      { id: "UP-20260727-002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", fileName: "线上服务统计附件.zip", materialType: "统计附件", size: "86.2MB", progress: 80, status: "扫描中", scanStatus: "敏感内容识别中", classification: "待识别", submittedAt: "2026-07-27 14:28", retries: 0 },
      { id: "UP-20260727-003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", fileName: "电子病历评级证明.pdf", materialType: "评级证明", size: "6.8MB", progress: 35, status: "上传中", scanStatus: "等待扫描", classification: "C1", submittedAt: "2026-07-27 14:31", retries: 0 },
      { id: "UP-20260727-004", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", fileName: "脱敏日志样本.7z", materialType: "日志样本", size: "142.6MB", progress: 42, status: "失败", scanStatus: "分片校验失败", classification: "H3", submittedAt: "2026-07-27 14:35", retries: 1 },
    ],
    reviewerWorkloads: [
      { id: "WL-001", reviewer: "审核员A", group: "省级综合审核组", capacity: 18, assigned: 16, inProgress: 7, overdue: 2, highRisk: 4, avgHours: 5.6, status: "高负荷" },
      { id: "WL-002", reviewer: "审核员B", group: "省级综合审核组", capacity: 18, assigned: 11, inProgress: 5, overdue: 0, highRisk: 2, avgHours: 4.2, status: "正常" },
      { id: "WL-003", reviewer: "专家B", group: "数据互联互通专家组", capacity: 10, assigned: 6, inProgress: 3, overdue: 0, highRisk: 3, avgHours: 7.1, status: "正常" },
      { id: "WL-004", reviewer: "专家C", group: "安全合规专家组", capacity: 10, assigned: 9, inProgress: 6, overdue: 1, highRisk: 5, avgHours: 8.4, status: "高负荷" },
    ],
    dailyReports: [
      { id: "DR-20260727", date: "2026-07-27", batchId: "BATCH-2026-01", coverage: 38, submitted: 21, submissionRate: 55.3, materials: 1842, uploadPending: 3, validationBlockers: 17, pendingReviews: 30, spotChecks: 2, rectifications: 6, incidents: 1, status: "草稿", generatedAt: "2026-07-27 17:00", publishedAt: "", summary: "申报进度总体正常，材料上传队列存在1项失败，省级综合审核组负荷偏高。" },
      { id: "DR-20260726", date: "2026-07-26", batchId: "BATCH-2026-01", coverage: 38, submitted: 19, submissionRate: 50.0, materials: 1766, uploadPending: 5, validationBlockers: 22, pendingReviews: 27, spotChecks: 2, rectifications: 4, incidents: 0, status: "已发布", generatedAt: "2026-07-26 17:00", publishedAt: "2026-07-26 17:15", summary: "试点运行平稳，阻断问题较前一日下降，需持续跟踪材料补正。" },
    ],
    serviceHealth: [
      { id: "SVC-GATEWAY", name: "统一业务网关", component: "接入层", availability: 99.98, latency: 86, status: "正常", lastCheck: "2026-07-27 15:20", incidents: 0, sla: 99.9 },
      { id: "SVC-SUBMISSION", name: "医院申报服务", component: "业务层", availability: 99.96, latency: 128, status: "正常", lastCheck: "2026-07-27 15:20", incidents: 0, sla: 99.9 },
      { id: "SVC-VALIDATION", name: "规则校验引擎", component: "能力层", availability: 99.72, latency: 642, status: "降级", lastCheck: "2026-07-27 15:19", incidents: 2, sla: 99.9 },
      { id: "SVC-EVIDENCE", name: "证据材料服务", component: "业务层", availability: 99.91, latency: 214, status: "正常", lastCheck: "2026-07-27 15:20", incidents: 1, sla: 99.9 },
      { id: "SVC-NOTIFY", name: "消息通知服务", component: "支撑层", availability: 99.84, latency: 356, status: "预警", lastCheck: "2026-07-27 15:18", incidents: 1, sla: 99.8 },
    ],
    interfaceHealth: [
      { id: "API-INSTITUTION", name: "机构基础信息同步", path: "/api/v1/hospitals", consumer: "省级平台", successRate: 99.9, p95: 142, throughput: 126, status: "正常", lastError: "", lastCheck: "2026-07-27 15:20" },
      { id: "API-SUBMISSION", name: "医院申报数据上报", path: "/api/v1/submissions", consumer: "医疗机构", successRate: 99.4, p95: 486, throughput: 84, status: "预警", lastError: "2项请求因版本号不一致被拒绝", lastCheck: "2026-07-27 15:19" },
      { id: "API-EVIDENCE", name: "证据材料元数据登记", path: "/api/v1/evidence-materials", consumer: "医疗机构", successRate: 98.8, p95: 920, throughput: 38, status: "异常", lastError: "对象存储签名超时", lastCheck: "2026-07-27 15:18" },
      { id: "API-RESULT", name: "评价结果下发", path: "/api/v1/evaluation-results", consumer: "省级平台", successRate: 100, p95: 118, throughput: 22, status: "正常", lastError: "", lastCheck: "2026-07-27 15:20" },
    ],
    jobQueues: [
      { id: "QUEUE-UPLOAD", name: "材料上传处理", pending: 18, running: 6, failed: 1, oldestWait: 7, workers: 6, capacity: 120, status: "正常" },
      { id: "QUEUE-VALIDATION", name: "规则校验任务", pending: 286, running: 12, failed: 4, oldestWait: 34, workers: 12, capacity: 240, status: "拥堵" },
      { id: "QUEUE-REPORT", name: "日报生成任务", pending: 3, running: 1, failed: 0, oldestWait: 2, workers: 2, capacity: 30, status: "正常" },
      { id: "QUEUE-NOTIFY", name: "消息发送任务", pending: 96, running: 8, failed: 3, oldestWait: 16, workers: 8, capacity: 180, status: "预警" },
    ],
    storagePools: [
      { id: "STORE-EVIDENCE", name: "证据材料对象存储", purpose: "原始材料与版本", used: 7.6, total: 10, unit: "TB", usage: 76, status: "预警", retention: "评价结束后10年", growthDaily: 86 },
      { id: "STORE-DATA", name: "业务数据存储", purpose: "申报、审核与结果", used: 3.2, total: 8, unit: "TB", usage: 40, status: "正常", retention: "长期", growthDaily: 24 },
      { id: "STORE-LOG", name: "审计日志存储", purpose: "操作与安全审计", used: 1.82, total: 2, unit: "TB", usage: 91, status: "高风险", retention: "不少于6个月", growthDaily: 38 },
      { id: "STORE-BACKUP", name: "备份与容灾存储", purpose: "数据库与配置备份", used: 4.1, total: 12, unit: "TB", usage: 34, status: "正常", retention: "日备30天/月备1年", growthDaily: 18 },
    ],
    monitoringAlerts: [
      { id: "ALT-20260727-001", source: "SVC-VALIDATION", level: "高", title: "规则校验引擎响应时间持续升高", status: "待确认", createdAt: "2026-07-27 15:05", owner: "平台技术组", handledAt: "" },
      { id: "ALT-20260727-002", source: "QUEUE-VALIDATION", level: "高", title: "规则校验队列积压超过容量阈值", status: "处理中", createdAt: "2026-07-27 15:08", owner: "运维值班组", handledAt: "" },
      { id: "ALT-20260727-003", source: "STORE-LOG", level: "紧急", title: "审计日志存储使用率超过90%", status: "待确认", createdAt: "2026-07-27 15:12", owner: "安全管理组", handledAt: "" },
    ],
    hospitalReadiness: [
      { id: "READY-H000001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", coordinator: "王主任", organization: 100, accounts: 100, network: 95, dataMapping: 88, training: 92, readiness: 95, blockers: 0, status: "已就绪", lastUpdated: "2026-07-27 16:20" },
      { id: "READY-H000002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", coordinator: "李主任", organization: 100, accounts: 85, network: 82, dataMapping: 68, training: 75, readiness: 82, blockers: 2, status: "推进中", lastUpdated: "2026-07-27 16:10" },
      { id: "READY-H000003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", coordinator: "赵科长", organization: 80, accounts: 72, network: 55, dataMapping: 48, training: 60, readiness: 63, blockers: 4, status: "有阻塞", lastUpdated: "2026-07-27 15:55" },
    ],
    pilotAccessApplications: [
      { id: "ACC-H000001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", coordinator: "王主任", sourceMode: "接口+模板", networkZone: "政务外网/VPN", targetWindow: "2026-08-05", materials: 6, requiredMaterials: 6, status: "联调中", lastUpdated: "2026-07-28 09:10" },
      { id: "ACC-H000002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", coordinator: "李主任", sourceMode: "接口", networkZone: "专线", targetWindow: "2026-08-12", materials: 5, requiredMaterials: 6, status: "资料待补", lastUpdated: "2026-07-28 09:00" },
      { id: "ACC-H000003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", coordinator: "赵科长", sourceMode: "模板+接口", networkZone: "政务外网", targetWindow: "2026-08-18", materials: 6, requiredMaterials: 6, status: "已受理", lastUpdated: "2026-07-28 08:50" },
    ],
    pilotConnectors: [
      { id: "CONN-H000001-EMR", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", sourceSystem: "电子病历EMR", profile: "患者、就诊、病历摘要", transport: "HTTPS/JSON", endpointAlias: "emr-gateway", authMode: "mTLS+签名", credentialStatus: "有效", credentialExpireAt: "2027-07-31", connectivityStatus: "在线", contractStatus: "契约通过", latencyMs: 168, lastProbeAt: "2026-07-28 09:12", owner: "接口管理组" },
      { id: "CONN-H000001-LIS", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", sourceSystem: "检验系统LIS", profile: "检验申请、检验结果", transport: "HTTPS/JSON", endpointAlias: "lis-gateway", authMode: "mTLS+签名", credentialStatus: "有效", credentialExpireAt: "2027-07-31", connectivityStatus: "待探测", contractStatus: "待认证", latencyMs: 0, lastProbeAt: "-", owner: "检验接口组" },
      { id: "CONN-H000002-HIS", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", sourceSystem: "医院信息系统HIS", profile: "患者、挂号、费用", transport: "HTTPS/JSON", endpointAlias: "his-adapter", authMode: "OAuth2+签名", credentialStatus: "临期", credentialExpireAt: "2026-08-05", connectivityStatus: "待探测", contractStatus: "待认证", latencyMs: 0, lastProbeAt: "-", owner: "医院信息中心" },
      { id: "CONN-H000003-EMR", hospitalCode: "H000003", hospitalName: "区县示例人民医院", sourceSystem: "电子病历EMR", profile: "患者、就诊、病历摘要", transport: "SFTP/CSV", endpointAlias: "county-emr", authMode: "密钥+白名单", credentialStatus: "失效", credentialExpireAt: "2026-07-20", connectivityStatus: "阻断", contractStatus: "待认证", latencyMs: 0, lastProbeAt: "2026-07-28 08:40", owner: "信息科" },
    ],
    pilotDataMappings: [
      { id: "MAP-H000001-EMR", hospitalCode: "H000001", connectorId: "CONN-H000001-EMR", dataset: "住院病案首页", sourceFields: 126, mappedFields: 126, requiredFields: 118, transformRules: 18, coverage: 100, privacyCheck: "脱敏通过", status: "映射就绪", owner: "数据治理组", updatedAt: "2026-07-28 09:18" },
      { id: "MAP-H000001-LIS", hospitalCode: "H000001", connectorId: "CONN-H000001-LIS", dataset: "检验结果", sourceFields: 64, mappedFields: 58, requiredFields: 60, transformRules: 12, coverage: 91, privacyCheck: "待抽样", status: "待完善", owner: "检验接口组", updatedAt: "2026-07-28 09:05" },
      { id: "MAP-H000002-HIS", hospitalCode: "H000002", connectorId: "CONN-H000002-HIS", dataset: "门诊服务统计", sourceFields: 82, mappedFields: 72, requiredFields: 78, transformRules: 9, coverage: 88, privacyCheck: "待抽样", status: "待完善", owner: "医院信息中心", updatedAt: "2026-07-28 08:55" },
      { id: "MAP-H000003-EMR", hospitalCode: "H000003", connectorId: "CONN-H000003-EMR", dataset: "电子病历应用统计", sourceFields: 74, mappedFields: 51, requiredFields: 68, transformRules: 6, coverage: 69, privacyCheck: "发现风险", status: "阻断", owner: "信息科", updatedAt: "2026-07-28 08:42" },
    ],
    pilotIntegrationTests: [
      { id: "TEST-CONN-H000001-EMR-001", hospitalCode: "H000001", connectorId: "CONN-H000001-EMR", suite: "OpenAPI契约认证", cases: 24, passed: 24, failed: 0, privacyFindings: 0, evidenceId: "EV-B3-001", status: "通过", runAt: "2026-07-28 09:15" },
      { id: "TEST-MAP-H000001-EMR-001", hospitalCode: "H000001", connectorId: "CONN-H000001-EMR", suite: "字段映射与脱敏抽样", cases: 30, passed: 30, failed: 0, privacyFindings: 0, evidenceId: "EV-B3-001", status: "通过", runAt: "2026-07-28 09:20" },
    ],
    pilotIntegrationIssues: [
      { id: "INT-ISSUE-001", hospitalCode: "H000002", connectorId: "CONN-H000002-HIS", category: "凭据安全", severity: "高", summary: "接入凭据将在8日内到期，需轮换后重新探测。", owner: "医院信息中心", status: "待处理", dueAt: "2026-08-02", resolution: "", updatedAt: "2026-07-28 09:00" },
      { id: "INT-ISSUE-002", hospitalCode: "H000003", connectorId: "CONN-H000003-EMR", category: "连通性", severity: "阻断", summary: "接入密钥已失效，白名单探测失败。", owner: "平台接入组", status: "处理中", dueAt: "2026-07-30", resolution: "", updatedAt: "2026-07-28 08:45" },
      { id: "INT-ISSUE-003", hospitalCode: "H000003", connectorId: "CONN-H000003-EMR", category: "隐私保护", severity: "阻断", summary: "抽样数据中发现未脱敏的患者联系方式。", owner: "数据安全组", status: "待处理", dueAt: "2026-07-30", resolution: "", updatedAt: "2026-07-28 08:43" },
    ],
    pilotIntegrationGates: [
      { hospitalCode: "H000001", hospitalName: "大连市示例中心医院", requiredConnectors: 2, readyConnectors: 1, requiredMappings: 2, readyMappings: 1, openCriticalIssues: 0, securityReview: "待复核", businessReview: "待复核", status: "待评估", evaluatedAt: "", approvedBy: "", approvedAt: "" },
      { hospitalCode: "H000002", hospitalName: "大连市示例专科医院", requiredConnectors: 1, readyConnectors: 0, requiredMappings: 1, readyMappings: 0, openCriticalIssues: 1, securityReview: "待复核", businessReview: "待复核", status: "待整改", evaluatedAt: "2026-07-28 09:05", approvedBy: "", approvedAt: "" },
      { hospitalCode: "H000003", hospitalName: "区县示例人民医院", requiredConnectors: 1, readyConnectors: 0, requiredMappings: 1, readyMappings: 0, openCriticalIssues: 2, securityReview: "不通过", businessReview: "不通过", status: "阻断", evaluatedAt: "2026-07-28 08:48", approvedBy: "", approvedAt: "" },
    ],
    integrationEnvironments: [
      { id: "ENV-UAT", name: "统一接入验证环境", type: "UAT", networkZone: "政务外网验证区", endpointAlias: "uat-integration-gateway", tlsMode: "TLS1.3+mTLS", configVersion: "cfg-uat-16.2", status: "健康", lastVerifiedAt: "2026-07-28 09:25", owner: "平台接入组" },
      { id: "ENV-PROD", name: "统一接入生产环境", type: "PROD", networkZone: "政务外网生产区", endpointAlias: "prod-integration-gateway", tlsMode: "TLS1.3+mTLS", configVersion: "cfg-prod-16.1", status: "待核验", lastVerifiedAt: "-", owner: "运维安全组" },
    ],
    credentialVaultEntries: [
      { id: "VAULT-H000001-EMR-PROD", connectorId: "CONN-H000001-EMR", environmentId: "ENV-PROD", provider: "国密凭据保险库", vaultRefFingerprint: "sha256:4f7d…a32b", keyVersion: "kv-2026-07", rotationDueAt: "2027-01-28", lastRotatedAt: "2026-07-28 09:30", accessPolicy: "execution-runtime-only", status: "有效", owner: "运维安全组" },
      { id: "VAULT-H000001-LIS-PROD", connectorId: "CONN-H000001-LIS", environmentId: "ENV-PROD", provider: "国密凭据保险库", vaultRefFingerprint: "sha256:782c…d911", keyVersion: "kv-2026-07", rotationDueAt: "2027-01-28", lastRotatedAt: "2026-07-28 09:32", accessPolicy: "execution-runtime-only", status: "有效", owner: "运维安全组" },
      { id: "VAULT-H000002-HIS-UAT", connectorId: "CONN-H000002-HIS", environmentId: "ENV-UAT", provider: "国密凭据保险库", vaultRefFingerprint: "sha256:9a16…0c55", keyVersion: "kv-2026-05", rotationDueAt: "2026-08-05", lastRotatedAt: "2026-05-05 10:10", accessPolicy: "execution-runtime-only", status: "临期", owner: "医院信息中心" },
    ],
    integrationExecutionJobs: [
      { id: "EXEC-20260728-001", connectorId: "CONN-H000001-EMR", environmentId: "ENV-PROD", jobType: "全量基线校验", idempotencyKeyHash: "sha256:05ba…cc12", idempotencyHits: 0, payloadDigest: "sha256:19b2…f810", status: "成功", attempts: 1, maxAttempts: 3, retryBaseSeconds: 30, retryMaxSeconds: 900, nextAttemptAt: "", progress: 100, queuedAt: "2026-07-28 09:35", startedAt: "2026-07-28 09:36", completedAt: "2026-07-28 09:38", receiptId: "RCPT-20260728-001", errorCode: "", leaseOwner: "", leaseExpiresAt: "", lastHeartbeatAt: "", deadLetterId: "", generation: 1 },
      { id: "EXEC-20260728-002", connectorId: "CONN-H000001-LIS", environmentId: "ENV-PROD", jobType: "增量连通校验", idempotencyKeyHash: "sha256:d791…2fe0", idempotencyHits: 0, payloadDigest: "sha256:89ad…00c4", status: "等待回执", attempts: 1, maxAttempts: 3, retryBaseSeconds: 30, retryMaxSeconds: 900, nextAttemptAt: "", progress: 85, queuedAt: "2026-07-28 09:40", startedAt: "2026-07-28 09:41", completedAt: "", receiptId: "", errorCode: "", leaseOwner: "", leaseExpiresAt: "", lastHeartbeatAt: "", deadLetterId: "", generation: 1 },
      { id: "EXEC-20260728-003", connectorId: "CONN-H000002-HIS", environmentId: "ENV-UAT", jobType: "接入认证执行", idempotencyKeyHash: "sha256:b928…7f10", idempotencyHits: 0, payloadDigest: "sha256:f830…66d1", status: "等待重试", attempts: 1, maxAttempts: 3, retryBaseSeconds: 30, retryMaxSeconds: 900, nextAttemptAt: "2026-07-28 22:00", progress: 0, queuedAt: "2026-07-28 21:55", startedAt: "2026-07-28 21:56", completedAt: "", receiptId: "", errorCode: "GATEWAY_TIMEOUT", leaseOwner: "", leaseExpiresAt: "", lastHeartbeatAt: "", deadLetterId: "", generation: 1 },
      { id: "EXEC-20260728-004", connectorId: "CONN-H000003-EMR", environmentId: "ENV-UAT", jobType: "字段映射抽样", idempotencyKeyHash: "sha256:8fd0…9c23", idempotencyHits: 0, payloadDigest: "sha256:1a20…ef41", status: "死信", attempts: 3, maxAttempts: 3, retryBaseSeconds: 30, retryMaxSeconds: 900, nextAttemptAt: "", progress: 0, queuedAt: "2026-07-28 21:10", startedAt: "2026-07-28 21:26", completedAt: "", receiptId: "", errorCode: "PRIVACY_POLICY_REJECTED", leaseOwner: "", leaseExpiresAt: "", lastHeartbeatAt: "", deadLetterId: "DLQ-20260728-001", generation: 1 },
    ],
    integrationExecutionWorkers: [
      { id: "WORKER-CERT-01", node: "worker-cert-a", pool: "接入认证池", capabilities: ["接入认证执行", "全量基线校验", "增量连通校验"], status: "就绪", activeJobId: "", registeredAt: "2026-07-28 21:30", lastHeartbeatAt: "2026-07-28 21:58", completedJobs: 18, failedJobs: 1 },
      { id: "WORKER-MAP-01", node: "worker-map-a", pool: "数据校验池", capabilities: ["字段映射抽样", "脱敏抽样"], status: "失联", activeJobId: "", registeredAt: "2026-07-28 20:30", lastHeartbeatAt: "2026-07-28 21:20", completedJobs: 11, failedJobs: 2 },
    ],
    integrationDeadLetters: [
      { id: "DLQ-20260728-001", jobId: "EXEC-20260728-004", connectorId: "CONN-H000003-EMR", environmentId: "ENV-UAT", jobType: "字段映射抽样", payloadDigest: "sha256:1a20…ef41", errorCode: "PRIVACY_POLICY_REJECTED", attempts: 3, generation: 1, status: "待复核", createdAt: "2026-07-28 21:28", reviewedBy: "", reviewNote: "", redrivenAt: "" },
    ],
    integrationExecutionEvents: [
      { id: "EVENT-20260728-006", jobId: "EXEC-20260728-004", workerId: "WORKER-MAP-01", type: "进入死信", status: "死信", detail: "PRIVACY_POLICY_REJECTED · 第3次失败", occurredAt: "2026-07-28 21:28" },
      { id: "EVENT-20260728-005", jobId: "EXEC-20260728-003", workerId: "WORKER-CERT-01", type: "安排重试", status: "等待重试", detail: "GATEWAY_TIMEOUT · 30秒后重试", occurredAt: "2026-07-28 21:56" },
      { id: "EVENT-20260728-004", jobId: "EXEC-20260728-002", workerId: "WORKER-CERT-01", type: "执行完成", status: "等待回执", detail: "已释放租约，等待签名回执", occurredAt: "2026-07-28 09:42" },
    ],
    integrationCallbackReceipts: [
      { id: "RCPT-20260728-001", jobId: "EXEC-20260728-001", connectorId: "CONN-H000001-EMR", source: "emr-gateway", eventType: "EXECUTION_COMPLETED", signatureStatus: "已验证", timestampStatus: "已验证", nonceStatus: "已验证", nonceHash: "sha256:8b19…05ce", payloadDigest: "sha256:19b2…f810", digestStatus: "已验证", status: "已验证", decision: "接收", receivedAt: "2026-07-28 09:38" },
    ],
    integrationReplayEvents: [
      { id: "REPLAY-20260728-001", source: "county-emr", connectorId: "CONN-H000003-EMR", nonceHash: "sha256:replay…0161", firstSeenAt: "2026-07-28 08:42", lastSeenAt: "2026-07-28 08:43", hits: 2, action: "拒绝并隔离连接器", status: "待处置" },
    ],
    integrationQuarantines: [
      { id: "QUAR-20260728-001", connectorId: "CONN-H000003-EMR", reason: "检测到回调nonce重放", trigger: "REPLAY-20260728-001", hits: 2, status: "隔离中", owner: "运维安全组", openedAt: "2026-07-28 08:43", updatedAt: "2026-07-28 08:43", releasedAt: "", reviewNote: "" },
    ],
    integrationCutoverWindows: [
      { id: "CUT-H000001-001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", environmentId: "ENV-PROD", connectorIds: ["CONN-H000001-EMR", "CONN-H000001-LIS"], plannedAt: "2026-08-05 21:00", windowMinutes: 90, integrationApproved: false, rollbackPlan: "切回模板上传通道并恢复上一配置版本", checks: { environment: false, vault: true, jobs: false, quarantine: true, gate: false, rollback: true }, status: "待评估", evaluatedAt: "", approvedBy: "", startedAt: "", completedAt: "", rollbackAt: "" },
    ],
    productionRuntimeControls: [
      { id: "RUNTIME-SQLITE-WAL", name: "持久化任务仓库", control: "SQLite WAL + BEGIN IMMEDIATE原子事务", owner: "平台技术组", evidence: "digital-hospital-execution-service.js", status: "已实现", verifiedAt: "2026-07-29 10:10" },
      { id: "RUNTIME-LEASE-BOUNDARY", name: "租约与秘密边界", control: "原始租约、幂等键、载荷、凭据不落库", owner: "平台安全组", evidence: "24项生产运行聚焦测试", status: "已实现", verifiedAt: "2026-07-29 10:12" },
      { id: "RUNTIME-MANAGED-KEY", name: "托管回调密钥", control: "外部保险库引用与临时取钥Loader", owner: "平台安全组", evidence: "待登记生产Key Ref与取钥回执", status: "待配置", verifiedAt: "" },
      { id: "RUNTIME-CALLBACK-MTLS", name: "回调网关mTLS", control: "受信客户端证书指纹、HMAC、时间窗与nonce", owner: "网关运维组", evidence: "待登记生产证书指纹", status: "待配置", verifiedAt: "" },
      { id: "RUNTIME-WORKER-MTLS", name: "Worker服务身份", control: "生产Worker仅通过受信mTLS身份领取任务", owner: "平台技术组", evidence: "待登记Worker证书指纹", status: "待配置", verifiedAt: "" },
    ],
    cutoverEvidenceRequirements: [
      { id: "EVD-MANAGED-VAULT", requirementId: "managed-vault-attestation", name: "托管保险库取钥证明", ownerRole: "安全责任人", siteRequired: false, artifactName: "managed-vault-attestation.json", artifactDigest: "sha256:8fe1…a019", submittedBy: "运维安全员", verifiedBy: "国家级管理员", status: "已核验", updatedAt: "2026-07-29 10:30" },
      { id: "EVD-SIGNED-CALLBACK", requirementId: "signed-callback-receipt", name: "签名回调与mTLS回执", ownerRole: "安全责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-JOINT-SUCCESS", requirementId: "joint-test-success", name: "联调成功场景", ownerRole: "接口责任人", siteRequired: true, artifactName: "joint-test-success.json", artifactDigest: "sha256:029a…8c10", submittedBy: "医院填报员", verifiedBy: "省级管理员", status: "已核验", updatedAt: "2026-07-29 10:35" },
      { id: "EVD-JOINT-FAILURE", requirementId: "joint-test-failure", name: "联调失败场景", ownerRole: "接口责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-JOINT-RETRY", requirementId: "joint-test-retry", name: "重试与幂等场景", ownerRole: "接口责任人", siteRequired: true, artifactName: "joint-test-retry.json", artifactDigest: "sha256:c930…7d22", submittedBy: "运维安全员", verifiedBy: "", status: "待复核", updatedAt: "2026-07-29 10:38" },
      { id: "EVD-JOINT-RECONCILE", requirementId: "joint-test-reconciliation", name: "对账补偿场景", ownerRole: "接口责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-DUTY-ROSTER", requirementId: "duty-roster", name: "切换值守表", ownerRole: "运行责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-ROLLBACK", requirementId: "rollback-rehearsal", name: "回滚演练记录", ownerRole: "运行责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-CHANGE", requirementId: "change-ticket", name: "生产变更单", ownerRole: "运行责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
      { id: "EVD-HOSPITAL-SIGNOFF", requirementId: "hospital-signoff", name: "试点医院现场签字", ownerRole: "医院责任人", siteRequired: true, artifactName: "", artifactDigest: "", submittedBy: "", verifiedBy: "", status: "待上传", updatedAt: "" },
    ],
    productionCutoverApprovals: [
      { id: "APP-INTEGRATION", role: "接口责任人", approver: "", decision: "待签批", note: "", approvalDigest: "", approvedAt: "" },
      { id: "APP-SECURITY", role: "安全责任人", approver: "", decision: "待签批", note: "", approvalDigest: "", approvedAt: "" },
      { id: "APP-OPERATIONS", role: "运行责任人", approver: "", decision: "待签批", note: "", approvalDigest: "", approvedAt: "" },
      { id: "APP-HOSPITAL", role: "医院责任人", approver: "", decision: "待签批", note: "", approvalDigest: "", approvedAt: "" },
    ],
    productionGoNoGo: {
      decision: "NO-GO",
      status: "外部激活待完成",
      checks: { runtime: false, evidence: false, approvals: false, queue: false, quarantine: false, cutoverWindow: false },
      blockers: ["3项外部运行配置待登记", "7项切换证据待核验", "4方责任人待签批"],
      evaluatedAt: "2026-07-29 10:40",
      evaluatedBy: "系统门禁",
    },
    pilotTickets: [
      { id: "TKT-20260727-001", title: "接口统计模板机构代码校验失败", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", category: "数据口径", priority: "高", status: "处理中", owner: "数据治理组", createdAt: "2026-07-27 10:20", dueAt: "2026-07-27 18:20", slaHours: 8, elapsedHours: 6.5, channel: "试点群", description: "导入模板中的机构代码与平台主数据不一致。" },
      { id: "TKT-20260727-002", title: "材料分片上传在弱网环境中断", hospitalCode: "H000003", hospitalName: "区县示例人民医院", category: "材料上传", priority: "紧急", status: "待分派", owner: "未分派", createdAt: "2026-07-27 13:05", dueAt: "2026-07-27 17:05", slaHours: 4, elapsedHours: 3.2, channel: "服务热线", description: "大文件上传至42%后中断，需核验断点续传。" },
      { id: "TKT-20260727-003", title: "H1材料有效期口径需要确认", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", category: "指标口径", priority: "中", status: "待回复", owner: "标准规则组", createdAt: "2026-07-27 14:10", dueAt: "2026-07-28 14:10", slaHours: 24, elapsedHours: 2.1, channel: "在线答疑", description: "等保测评报告跨评价年度时的有效期计算口径待确认。" },
      { id: "TKT-20260726-004", title: "医院管理员账号权限范围异常", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", category: "账号权限", priority: "高", status: "已解决", owner: "平台技术组", createdAt: "2026-07-26 09:30", dueAt: "2026-07-26 17:30", slaHours: 8, elapsedHours: 3.8, channel: "工单中心", description: "已重建医院管理员数据权限并完成复核。" },
    ],
    trainingSessions: [
      { id: "TRN-20260728-01", title: "医院申报与证据材料实操培训", audience: "医院管理员、填报员", startAt: "2026-07-28 14:00", mode: "线上直播", capacity: 120, enrolled: 96, attended: 0, questions: 8, status: "已发布", owner: "试点培训组", materials: 4 },
      { id: "TRN-20260730-02", title: "数据模板与接口联调专场", audience: "信息中心、接口管理员", startAt: "2026-07-30 09:30", mode: "线上会议", capacity: 80, enrolled: 52, attended: 0, questions: 5, status: "报名中", owner: "数据治理组", materials: 3 },
      { id: "TRN-20260725-03", title: "省级审核与问题退回规则培训", audience: "省级管理员、审核员", startAt: "2026-07-25 14:00", mode: "现场+线上", capacity: 60, enrolled: 48, attended: 46, questions: 12, status: "已完成", owner: "评价审核组", materials: 5 },
    ],
    pilotReleases: [
      { id: "REL-0.7.0", version: "v0.7.0", title: "运营监控与告警闭环", scope: "全体试点机构", status: "已发布", plannedAt: "2026-07-27 21:30", publishedAt: "2026-07-27 22:12", owner: "平台技术组", changes: 18, feedbackCount: 3, openFeedback: 2 },
      { id: "REL-0.8.0-RC1", version: "v0.8.0-rc1", title: "试点协同工作台", scope: "首批3家验证医院", status: "候选", plannedAt: "2026-07-28 18:00", publishedAt: "", owner: "产品与试点组", changes: 15, feedbackCount: 0, openFeedback: 0 },
    ],
    pilotFeedback: [
      { id: "FB-20260727-001", releaseId: "REL-0.7.0", hospitalCode: "H000003", hospitalName: "区县示例人民医院", title: "移动端监控标签希望一屏展示", type: "体验建议", priority: "中", status: "已解决", owner: "产品组", createdAt: "2026-07-27 21:50", resolution: "已调整为移动端四栏等分布局。" },
      { id: "FB-20260727-002", releaseId: "REL-0.7.0", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", title: "接口告警希望直接关联责任人", type: "功能建议", priority: "高", status: "处理中", owner: "平台技术组", createdAt: "2026-07-27 22:05", resolution: "" },
      { id: "FB-20260727-003", releaseId: "REL-0.7.0", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", title: "建议增加巡检结果导出", type: "功能建议", priority: "中", status: "待评估", owner: "产品组", createdAt: "2026-07-27 22:08", resolution: "" },
    ],
    pilotOutcomeMetrics: [
      { id: "OUTCOME-PROCESS", name: "试点流程完成率", baseline: 0, current: 85, target: 90, unit: "%", weight: 20, status: "关注", source: "医院申报与审核流程" },
      { id: "OUTCOME-DATA", name: "数据质量通过率", baseline: 72, current: 91, target: 90, unit: "%", weight: 25, status: "达标", source: "数据校验与补正结果" },
      { id: "OUTCOME-REVIEW", name: "审核一次通过率", baseline: 0, current: 84, target: 88, unit: "%", weight: 20, status: "关注", source: "省级审核与专家复核" },
      { id: "OUTCOME-UPTIME", name: "平台运行可用率", baseline: 99, current: 99.92, target: 99.9, unit: "%", weight: 20, status: "达标", source: "运营监控服务健康" },
      { id: "OUTCOME-SAT", name: "试点用户满意度", baseline: 0, current: 89, target: 90, unit: "%", weight: 15, status: "关注", source: "培训答疑与版本反馈" },
    ],
    pilotHospitalOutcomes: [
      { id: "PHO-H000001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", processCompletion: 96, dataQuality: 94, auditPassRate: 92, satisfaction: 95, score: 94, status: "可推广", majorIssues: 0, evaluatedAt: "2026-07-27 22:30" },
      { id: "PHO-H000002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", processCompletion: 86, dataQuality: 82, auditPassRate: 84, satisfaction: 88, score: 85, status: "条件通过", majorIssues: 2, evaluatedAt: "2026-07-27 22:30" },
      { id: "PHO-H000003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", processCompletion: 72, dataQuality: 68, auditPassRate: 75, satisfaction: 81, score: 74, status: "需优化", majorIssues: 4, evaluatedAt: "2026-07-27 22:30" },
    ],
    pilotIssueThemes: [
      { id: "THEME-DATA-MAP", category: "数据映射", title: "历史代码与新标准映射不一致", count: 8, impact: "高", rootCause: "医院历史代码体系差异较大，缺少统一映射模板。", owner: "标准与数据组", status: "分析完成", sourceCount: 11, reviewedAt: "2026-07-27 22:35" },
      { id: "THEME-UPLOAD", category: "材料上传", title: "弱网环境下大文件上传不稳定", count: 5, impact: "高", rootCause: "部分医院出口带宽受限，断点续传参数需优化。", owner: "平台技术组", status: "改进中", sourceCount: 7, reviewedAt: "2026-07-27 22:35" },
      { id: "THEME-STANDARD", category: "指标口径", title: "复杂指标缺少边界案例说明", count: 7, impact: "中", rootCause: "新标准释义以原则性描述为主，典型案例不足。", owner: "标准规则组", status: "待确认", sourceCount: 9, reviewedAt: "2026-07-27 22:35" },
      { id: "THEME-ACCESS", category: "账号权限", title: "医院初始角色权限配置偏差", count: 3, impact: "中", rootCause: "初始化角色模板未充分区分医院组织层级。", owner: "系统管理组", status: "已闭环", sourceCount: 4, reviewedAt: "2026-07-27 22:35" },
    ],
    pilotImprovementPlans: [
      { id: "PLAN-DATA-MAP", sourceId: "THEME-DATA-MAP", title: "发布医院代码映射模板与校验工具", source: "数据映射问题复盘", priority: "高", owner: "标准与数据组", targetVersion: "v0.9.1", dueAt: "2026-08-05", status: "进行中", progress: 65, acceptance: "三类医院样例映射通过率达到95%" },
      { id: "PLAN-UPLOAD", sourceId: "THEME-UPLOAD", title: "优化弱网分片上传与失败重试策略", source: "材料上传问题复盘", priority: "紧急", owner: "平台技术组", targetVersion: "v0.9.1", dueAt: "2026-08-02", status: "待验收", progress: 88, acceptance: "2Mbps网络下500MB文件可稳定续传" },
      { id: "PLAN-STANDARD", sourceId: "THEME-STANDARD", title: "建设新标准口径案例库", source: "指标口径问题复盘", priority: "高", owner: "标准规则组", targetVersion: "v0.10.0", dueAt: "2026-08-15", status: "待开始", progress: 20, acceptance: "首批30个高频问题形成可检索案例" },
      { id: "PLAN-ACCESS", sourceId: "THEME-ACCESS", title: "固化医院角色权限初始化模板", source: "账号权限问题复盘", priority: "中", owner: "系统管理组", targetVersion: "v0.9.0", dueAt: "2026-07-28", status: "已完成", progress: 100, acceptance: "三类试点医院权限回归测试通过" },
    ],
    rolloutRegions: [
      { id: "REGION-LN", province: "辽宁省示范区", coordinator: "省级试点办公室", hospitalCount: 12, organization: 92, platform: 90, security: 88, training: 82, dataMigration: 75, readiness: 85, status: "准备中", plannedAt: "2026-08-20", startedAt: "" },
      { id: "REGION-EAST", province: "华东示范省", coordinator: "省级卫生信息中心", hospitalCount: 20, organization: 85, platform: 88, security: 90, training: 72, dataMigration: 68, readiness: 81, status: "准备中", plannedAt: "2026-09-01", startedAt: "" },
      { id: "REGION-WEST", province: "西部示范省", coordinator: "省级项目专班", hospitalCount: 18, organization: 78, platform: 70, security: 82, training: 65, dataMigration: 60, readiness: 71, status: "有风险", plannedAt: "2026-09-15", startedAt: "" },
    ],
    pilotAssessmentReports: [
      { id: "ASSESS-2026-PILOT-01", period: "2026年首批试点", version: "v0.8.0", coverage: 3, score: 84, conclusion: "核心评价闭环运行稳定，基本具备扩大试点条件。", recommendation: "优先完成数据映射、弱网传输和指标案例库三项优化后分区域推广。", status: "草稿", generatedAt: "2026-07-27 22:40", publishedAt: "" },
    ],
    assistantKnowledgeSources: [
      { id: "KS-STANDARD", name: "数智医院新标准试点评价规则", version: "STD-2026-TRIAL", type: "标准规则", status: "已启用", chunks: 186, owner: "标准规则组", lastSyncedAt: "2026-07-28 08:30", scope: "57项指标及评分边界" },
      { id: "KS-EVIDENCE", name: "证据材料目录与有效期规则", version: "EVD-2026-01", type: "材料目录", status: "已启用", chunks: 92, owner: "评价审核组", lastSyncedAt: "2026-07-28 08:30", scope: "材料类型、数量、格式与有效期" },
      { id: "KS-DATA", name: "数据采集目录与字段口径", version: "DATA-2026-01", type: "数据目录", status: "已启用", chunks: 134, owner: "标准与数据组", lastSyncedAt: "2026-07-28 08:30", scope: "统计模板、代码集与校验规则" },
      { id: "KS-FAQ", name: "首批试点高频问题案例库", version: "FAQ-2026-07", type: "试点案例", status: "待复核", chunks: 30, owner: "试点培训组", lastSyncedAt: "2026-07-28 08:20", scope: "培训答疑、工单和版本反馈" },
    ],
    assistantKnowledgeVersions: [
      { id: "KV-STANDARD-20260728-01", sourceId: "KS-STANDARD", sourceName: "数智医院新标准试点评价规则", version: "STD-2026-TRIAL", previousVersion: "STD-2025-BASE", changeSummary: "完成新标准57项指标、评分边界和底线项映射。", addedChunks: 186, removedChunks: 0, checksum: "fnv32-74c8e5a1", status: "已发布", owner: "标准规则组", reviewer: "国家级标准管理员", createdAt: "2026-07-27 17:30", effectiveAt: "2026-07-28 08:30" },
      { id: "KV-STANDARD-20260728-02", sourceId: "KS-STANDARD", sourceName: "数智医院新标准试点评价规则", version: "STD-2026-TRIAL.2", previousVersion: "STD-2026-TRIAL", changeSummary: "补充B3重试去重、H1有效期和D6持续运行判定案例。", addedChunks: 12, removedChunks: 3, checksum: "fnv32-0f4bc912", status: "待审批", owner: "标准规则组", reviewer: "国家级标准管理员", createdAt: "2026-07-28 09:35", effectiveAt: "" },
      { id: "KV-FAQ-20260728-01", sourceId: "KS-FAQ", sourceName: "首批试点高频问题案例库", version: "FAQ-2026-07.1", previousVersion: "FAQ-2026-07", changeSummary: "归并首批试点工单中的8个高频口径问题。", addedChunks: 8, removedChunks: 1, checksum: "fnv32-c62ad534", status: "草稿", owner: "试点培训组", reviewer: "评价审核组", createdAt: "2026-07-28 09:50", effectiveAt: "" },
    ],
    standardQaRecords: [
      { id: "QA-20260728-001", hospitalCode: "H000001", question: "H1等保测评报告跨评价年度时如何认定有效期？", answer: "以评价任务提交截止日为基准，报告应处于有效期内；临近失效时需同时提交整改计划或复测安排，最终由审核员确认。", citations: ["H1评价细则第3.2条", "证据材料目录EVD-H1-01"], confidence: 96, askedBy: "医院填报员", askedAt: "2026-07-28 08:42", status: "已确认", scope: "H1 网络安全等级保护", retrievalTraceId: "RTR-QA-20260728-001", modelCallId: "MC-QA-20260728-001" },
      { id: "QA-20260728-002", hospitalCode: "H000001", question: "B3接口成功率统计是否包含计划内停机？", answer: "接口成功率应按评价期内实际调用统计，计划内停机可在数据质量说明中单列，但不得直接从分母剔除，除非任务规则另有明确配置。", citations: ["B3指标口径第2.4条", "数据采集目录API-STAT-03"], confidence: 91, askedBy: "接口管理员", askedAt: "2026-07-28 09:05", status: "待确认", scope: "B3 院内系统集成和接口治理", retrievalTraceId: "RTR-QA-20260728-002", modelCallId: "MC-QA-20260728-002" },
      { id: "QA-20260728-003", hospitalCode: "H000002", question: "D6适老化服务需要提供哪些证据？", answer: "建议至少提供适老化页面或终端截图、人工辅助流程、无障碍服务说明及实际服务记录；材料应能证明服务已上线并持续运行。", citations: ["D6指标证据要求", "证据材料目录EVD-D6-01至03"], confidence: 94, askedBy: "医院管理员", askedAt: "2026-07-28 09:20", status: "已回答", scope: "D6 老年人和特殊人群适老化服务", retrievalTraceId: "RTR-QA-20260728-003", modelCallId: "MC-QA-20260728-003" },
    ],
    assistantRetrievalTraces: [
      { id: "RTR-QA-20260728-001", questionId: "QA-20260728-001", hospitalCode: "H000001", query: "H1等保测评报告跨评价年度时如何认定有效期？", topMatches: [{ sourceId: "KS-STANDARD", chunkId: "H1-3.2", citation: "H1评价细则第3.2条", score: 0.97 }, { sourceId: "KS-EVIDENCE", chunkId: "EVD-H1-01", citation: "证据材料目录EVD-H1-01", score: 0.94 }], hitCount: 2, threshold: 0.8, status: "命中充分", durationMs: 86, createdAt: "2026-07-28 08:42" },
      { id: "RTR-QA-20260728-002", questionId: "QA-20260728-002", hospitalCode: "H000001", query: "B3接口成功率统计是否包含计划内停机？", topMatches: [{ sourceId: "KS-STANDARD", chunkId: "B3-2.4", citation: "B3指标口径第2.4条", score: 0.93 }, { sourceId: "KS-DATA", chunkId: "API-STAT-03", citation: "数据采集目录API-STAT-03", score: 0.89 }], hitCount: 2, threshold: 0.8, status: "命中充分", durationMs: 102, createdAt: "2026-07-28 09:05" },
      { id: "RTR-QA-20260728-003", questionId: "QA-20260728-003", hospitalCode: "H000002", query: "D6适老化服务需要提供哪些证据？", topMatches: [{ sourceId: "KS-STANDARD", chunkId: "D6-EVIDENCE", citation: "D6指标证据要求", score: 0.95 }, { sourceId: "KS-EVIDENCE", chunkId: "EVD-D6-01-03", citation: "证据材料目录EVD-D6-01至03", score: 0.92 }], hitCount: 2, threshold: 0.8, status: "命中充分", durationMs: 91, createdAt: "2026-07-28 09:20" },
    ],
    assistantModelCalls: [
      { id: "MC-QA-20260728-001", businessId: "QA-20260728-001", scene: "标准问答", modelRoute: "规则检索+摘要模型", promptVersion: "QA-PROMPT-v2.1", requestDigest: "fnv32-b8647931", responseDigest: "fnv32-490b3f28", inputTokens: 618, outputTokens: 126, latencyMs: 428, fallback: false, risk: "低", callStatus: "成功", reviewStatus: "已复核", operator: "医院填报员", calledAt: "2026-07-28 08:42", reviewedBy: "评价审核组", reviewedAt: "2026-07-28 08:55" },
      { id: "MC-QA-20260728-002", businessId: "QA-20260728-002", scene: "标准问答", modelRoute: "规则检索+摘要模型", promptVersion: "QA-PROMPT-v2.1", requestDigest: "fnv32-3b7ca094", responseDigest: "fnv32-1d9528c6", inputTokens: 574, outputTokens: 142, latencyMs: 466, fallback: false, risk: "中", callStatus: "成功", reviewStatus: "待复核", operator: "接口管理员", calledAt: "2026-07-28 09:05", reviewedBy: "", reviewedAt: "" },
      { id: "MC-QA-20260728-003", businessId: "QA-20260728-003", scene: "标准问答", modelRoute: "规则检索+摘要模型", promptVersion: "QA-PROMPT-v2.1", requestDigest: "fnv32-d3124b80", responseDigest: "fnv32-8a02519c", inputTokens: 536, outputTokens: 118, latencyMs: 401, fallback: false, risk: "低", callStatus: "成功", reviewStatus: "待复核", operator: "医院管理员", calledAt: "2026-07-28 09:20", reviewedBy: "", reviewedAt: "" },
      { id: "MC-AEX-20260728-001", businessId: "AEX-20260728-001", scene: "异常解释", modelRoute: "规则解释模型", promptVersion: "AEX-PROMPT-v1.3", requestDigest: "fnv32-9e2c7154", responseDigest: "fnv32-f6423ba1", inputTokens: 412, outputTokens: 164, latencyMs: 512, fallback: false, risk: "中", callStatus: "成功", reviewStatus: "已复核", operator: "省级审核组", calledAt: "2026-07-28 09:30", reviewedBy: "数据治理组", reviewedAt: "2026-07-28 09:45" },
    ],
    assistantQualityGate: {
      citationCoverage: 100,
      answerAccuracy: 90,
      retrievalRecall: 85,
      safetyCompliance: 100,
      maxLatencyMs: 800,
      maxRegressionPoints: 2,
      owner: "评价助手治理组",
      updatedAt: "2026-07-28 10:35",
    },
    assistantEvaluationSuites: [
      { id: "EVALSET-CORE-2026-01", name: "标准口径核心回归集", version: "v1.2", type: "业务准确性", domains: ["B3", "D6", "H1"], caseCount: 40, source: "标准规则与专家确认问答", owner: "标准规则组", status: "已发布", updatedAt: "2026-07-28 10:20" },
      { id: "EVALSET-SAFETY-2026-01", name: "越权结论与安全拒答集", version: "v1.0", type: "安全边界", domains: ["评分结论", "敏感数据", "越权操作"], caseCount: 18, source: "安全策略与审核红线", owner: "安全合规组", status: "已发布", updatedAt: "2026-07-28 10:22" },
      { id: "EVALSET-PILOT-2026-01", name: "首批试点长尾问题集", version: "v0.3", type: "试点泛化", domains: ["高频工单", "边界口径"], caseCount: 26, source: "试点工单和培训答疑", owner: "试点培训组", status: "草稿", updatedAt: "2026-07-28 10:24" },
    ],
    assistantEvaluationRuns: [
      { id: "EVALRUN-20260728-001", candidateVersion: "ASSIST-2026.07.11", suiteVersion: "CORE-v1.2+SAFETY-v1.0", knowledgeVersion: "STD-2026-TRIAL", promptVersion: "QA-PROMPT-v2.1", citationCoverage: 100, answerAccuracy: 94, retrievalRecall: 91, safetyCompliance: 100, averageLatencyMs: 486, baselineDelta: 1.8, score: 96, gateStatus: "通过", status: "已完成", startedAt: "2026-07-28 10:25", finishedAt: "2026-07-28 10:29" },
      { id: "EVALRUN-20260728-002", candidateVersion: "ASSIST-2026.07.12", suiteVersion: "CORE-v1.2+SAFETY-v1.0", knowledgeVersion: "STD-2026-TRIAL.2", promptVersion: "QA-PROMPT-v2.2", citationCoverage: 100, answerAccuracy: 88, retrievalRecall: 82, safetyCompliance: 100, averageLatencyMs: 612, baselineDelta: -3.4, score: 89, gateStatus: "阻断", status: "已完成", startedAt: "2026-07-28 10:30", finishedAt: "2026-07-28 10:34" },
    ],
    assistantReleaseCandidates: [
      { id: "REL-ASSIST-20260711", version: "ASSIST-2026.07.11", modelRoute: "规则检索+摘要模型", promptVersion: "QA-PROMPT-v2.1", knowledgeVersion: "STD-2026-TRIAL", evaluationRunId: "EVALRUN-20260728-001", gateStatus: "通过", status: "已发布", owner: "评价助手治理组", reviewer: "国家级标准管理员", createdAt: "2026-07-28 10:30", publishedAt: "2026-07-28 10:35", rollbackTarget: "ASSIST-2026.07.10" },
      { id: "REL-ASSIST-20260712", version: "ASSIST-2026.07.12", modelRoute: "规则检索+摘要模型", promptVersion: "QA-PROMPT-v2.2", knowledgeVersion: "STD-2026-TRIAL.2", evaluationRunId: "EVALRUN-20260728-002", gateStatus: "阻断", status: "候选", owner: "评价助手治理组", reviewer: "国家级标准管理员", createdAt: "2026-07-28 10:36", publishedAt: "", rollbackTarget: "ASSIST-2026.07.11" },
    ],
    assistantOnlineGuardrail: {
      citationCoverage: 99,
      answerAcceptance: 90,
      maxNoAnswerRate: 8,
      maxEscalationRate: 12,
      maxP95LatencyMs: 900,
      maxSafetyEvents: 0,
      maxDriftScore: 5,
      owner: "评价助手运行保障组",
      updatedAt: "2026-07-28 11:10",
    },
    assistantDeployments: [
      { id: "DEP-ASSIST-20260711", releaseId: "REL-ASSIST-20260711", version: "ASSIST-2026.07.11", strategy: "全量", trafficPercent: 100, cohorts: ["全部试点医院"], stableVersion: "ASSIST-2026.07.11", status: "稳定", owner: "评价助手运行保障组", startedAt: "2026-07-28 10:35", updatedAt: "2026-07-28 11:05", rollbackAt: "" },
    ],
    assistantOnlineQualityWindows: [
      { id: "QWIN-ASSIST-20260711-01", deploymentId: "DEP-ASSIST-20260711", version: "ASSIST-2026.07.11", period: "最近30分钟", sampleCount: 1268, citationCoverage: 100, answerAcceptance: 94, noAnswerRate: 3.2, escalationRate: 6.8, p95LatencyMs: 642, safetyEvents: 0, driftScore: 1.8, status: "健康", collectedAt: "2026-07-28 11:05" },
    ],
    assistantQualityIncidents: [],
    assistantFeedbackRecords: [
      { id: "AFB-20260728-001", deploymentId: "DEP-ASSIST-20260711", version: "ASSIST-2026.07.11", questionId: "QA-20260728-002", channel: "回答评价", rating: 2, sentiment: "负向", reason: "引用不足", comment: "回答说明了统计口径，但没有引用失败重试去重的具体规则条款。", citationUseful: false, userRole: "医院填报员", status: "待研判", createdAt: "2026-07-28 11:18", reviewedBy: "", reviewedAt: "" },
      { id: "AFB-20260728-002", deploymentId: "DEP-ASSIST-20260711", version: "ASSIST-2026.07.11", questionId: "QA-20260728-001", channel: "回答评价", rating: 5, sentiment: "正向", reason: "口径清晰", comment: "有效期基准、补充材料和人工确认边界都很明确。", citationUseful: true, userRole: "医院管理员", status: "已关闭", createdAt: "2026-07-28 11:20", reviewedBy: "评价助手治理组", reviewedAt: "2026-07-28 11:24" },
      { id: "AFB-20260728-003", deploymentId: "DEP-ASSIST-20260711", version: "ASSIST-2026.07.11", questionId: "QA-20260728-003", channel: "试点工单", rating: 2, sentiment: "负向", reason: "答案不完整", comment: "适老化证据还需要明确持续运行记录的时间范围。", citationUseful: true, userRole: "试点协调员", status: "已转样本", createdAt: "2026-07-28 11:25", reviewedBy: "标准规则组", reviewedAt: "2026-07-28 11:30" },
    ],
    assistantImprovementSamples: [
      { id: "AIS-20260728-001", feedbackId: "AFB-20260728-003", sourceVersion: "ASSIST-2026.07.11", domain: "D6", question: "适老化服务持续运行记录应覆盖多长时间？", expectedAnswer: "", sourceEvidence: ["D6指标证据要求", "证据材料目录EVD-D6-03"], riskLevel: "中", targetSuiteId: "EVALSET-CORE-2026-01", status: "待标注", owner: "试点培训组", createdAt: "2026-07-28 11:30", updatedAt: "2026-07-28 11:30" },
    ],
    assistantImprovementCycles: [
      { id: "AIC-20260728-001", name: "首批试点引用完整性改进", sourceFeedbackIds: ["AFB-20260720-006"], sampleIds: ["AIS-20260720-006"], targetSuiteId: "EVALSET-CORE-2026-01", targetVersion: "ASSIST-2026.07.11", evaluationRunId: "EVALRUN-20260728-001", status: "已完成", owner: "评价助手治理组", startedAt: "2026-07-20 14:00", completedAt: "2026-07-28 10:29" },
    ],
    anomalyExplanations: [
      { id: "AEX-20260728-001", sourceId: "VAL-H000001-B3-RATE", hospitalCode: "H000001", indicatorCode: "B3", title: "接口成功率接近等级边界", summary: "当前接口成功率99.5%，接近优秀级规则阈值，微小口径差异可能影响等级判断。", possibleCause: "失败调用是否重试计数、计划停机是否纳入分母等统计口径尚未完全确认。", impact: "可能影响B3得分及专家复核结论。", recommendation: "核对接口调用日志、失败重试去重规则和统计周期，并补充数据质量说明。", status: "待确认", generatedAt: "2026-07-28 09:30", editable: true },
      { id: "AEX-20260728-002", sourceId: "VAL-H000002-D1-VOL", hospitalCode: "H000002", indicatorCode: "D1", title: "预约诊疗量较历史同期波动较大", summary: "本期线上预约量较历史同期上升42%，超过历史波动阈值。", possibleCause: "统计渠道扩展、口径调整或业务量真实增长均可能导致波动。", impact: "不会自动扣分，但需要医院说明并由审核员确认。", recommendation: "补充渠道范围、统计口径变更和同期业务量对比。", status: "已编辑", generatedAt: "2026-07-28 09:32", editable: true },
      { id: "AEX-20260728-003", sourceId: "VAL-H000003-H1-MISSING", hospitalCode: "H000003", indicatorCode: "H1", title: "安全合规证据材料缺失", summary: "H1自评已填写，但未找到有效等保测评报告或复测材料。", possibleCause: "材料尚未上传、材料关联指标错误或报告已过有效期。", impact: "属于提交前阻断项，未处理时无法完成正式申报。", recommendation: "上传有效报告并关联H1；如处于复测期，补充备案证明、整改计划和复测安排。", status: "已采纳", generatedAt: "2026-07-28 09:34", editable: true },
    ],
    rectificationSuggestions: [
      { id: "RSG-20260728-001", sourceId: "AEX-20260728-003", hospitalCode: "H000003", indicatorCode: "H1", problem: "安全合规证据材料缺失", suggestion: "建立等保材料专项补正任务，明确安全管理部门责任人并在提交截止前完成材料复核。", steps: ["核验等保报告有效期", "上传并正确关联H1", "补充整改或复测安排", "提交院内安全负责人复核"], priority: "紧急", owner: "网络安全办", dueDays: 5, disclaimer: "智能建议仅供参考，采纳后仍需医院和审核人员确认。", status: "待采纳", createdAt: "2026-07-28 09:40" },
      { id: "RSG-20260728-002", sourceId: "AEX-20260728-001", hospitalCode: "H000001", indicatorCode: "B3", problem: "接口成功率统计口径存在边界风险", suggestion: "形成接口统计口径说明，固化失败重试去重规则，并附原始调用汇总供审核复核。", steps: ["导出评价期接口调用汇总", "核验失败重试去重逻辑", "说明计划停机统计方式", "提交专家复核材料"], priority: "高", owner: "信息中心", dueDays: 7, disclaimer: "智能建议仅供参考，不直接改变评分或审核结论。", status: "已采纳", createdAt: "2026-07-28 09:42" },
      { id: "RSG-20260728-003", sourceId: "AEX-20260728-002", hospitalCode: "H000002", indicatorCode: "D1", problem: "预约诊疗量历史波动异常", suggestion: "补充统计渠道变化和同期业务量对比，区分真实业务增长与口径扩展影响。", steps: ["核对历史统计渠道", "拆分新增渠道预约量", "补充同期业务量趋势", "提交异常波动说明"], priority: "中", owner: "门诊部", dueDays: 10, disclaimer: "智能建议仅供参考，异常说明可由医院编辑。", status: "待采纳", createdAt: "2026-07-28 09:44" },
    ],
    reviewRiskSignals: [
      { id: "RSK-20260728-001", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", indicatorCode: "B3", level: "高", signal: "得分接近规则边界且统计口径待确认", basis: "接口成功率99.5%，距候选优秀阈值不足0.5个百分点。", recommendation: "核验原始调用汇总并提交专家复核。", source: "规则边界与异常解释", status: "已转复核", owner: "数据互联互通专家组", createdAt: "2026-07-28 09:50" },
      { id: "RSK-20260728-002", hospitalCode: "H000002", hospitalName: "大连市示例专科医院", indicatorCode: "D1", level: "中", signal: "本期数据较历史同期异常增长", basis: "线上预约量同比上升42%，超过历史波动规则阈值。", recommendation: "要求医院补充统计口径和渠道变化说明。", source: "历史波动校验", status: "待确认", owner: "省级审核组", createdAt: "2026-07-28 09:52" },
      { id: "RSK-20260728-003", hospitalCode: "H000003", hospitalName: "区县示例人民医院", indicatorCode: "H1", level: "高", signal: "关键安全材料缺失", basis: "H1已自评但未检索到有效等保测评报告。", recommendation: "阻断提交并要求补充有效材料。", source: "证据完整性校验", status: "已确认", owner: "安全合规审核组", createdAt: "2026-07-28 09:54" },
      { id: "RSK-20260728-004", hospitalCode: "H000001", hospitalName: "大连市示例中心医院", indicatorCode: "C1", level: "中", signal: "同一材料可能重复关联多个指标", basis: "材料摘要指纹与另一指标附件高度相似。", recommendation: "人工核验材料是否能够分别支撑对应指标。", source: "材料相似性辅助识别", status: "待确认", owner: "省级审核组", createdAt: "2026-07-28 09:56" },
    ],
    confirmed: false,
    lastValidatedAt: null,
    operations: {
      cycle: {
        year: 2026,
        name: "2026数智医院新标准试点运行",
        currentStage: "hospital",
        archiveStatus: "未归档",
        publishedAt: "",
        securityCheckedAt: "",
      },
      stages: [
        { id: "standard", name: "标准发布", owner: "国家级平台", due: "2026-08-10", status: "已完成", description: "发布评价任务、指标版本、评分规则和材料目录。" },
        { id: "province", name: "省级配置", owner: "省级平台", due: "2026-08-25", status: "已完成", description: "完成地方扩展规则、试点机构范围和审核专家组配置。" },
        { id: "hospital", name: "医院自评", owner: "医疗机构", due: "2026-09-30", status: "进行中", description: "医院填报指标、上传证据、提交数据质量说明。" },
        { id: "review", name: "分级审核", owner: "省级/国家级", due: "2026-11-15", status: "待开始", description: "开展数据核验、省级审核、专家复核和国家抽查。" },
        { id: "feedback", name: "结果反馈", owner: "省级平台", due: "2026-12-20", status: "待开始", description: "发布评价结果、问题清单、整改期限和结果应用建议。" },
        { id: "archive", name: "年度归档", owner: "国家级平台", due: "2027-01-15", status: "待开始", description: "固化版本、归档证据链、沉淀规则变更和试点报告。" },
      ],
      standardVersions: [
        { id: "STD-2026-TRIAL", name: "数智医院新标准试点评价规则", status: "试运行", effectiveDate: "2026-08-01", owner: "国家级平台", changeCount: 12 },
        { id: "STD-2025-BASE", name: "既有智慧医院评价映射基线", status: "历史参照", effectiveDate: "2025-01-01", owner: "标准管理组", changeCount: 0 },
      ],
      ruleSets: [
        { id: "RULE-DATA", name: "数据完整性与口径一致性", owner: "数据治理组", enabled: true, violations: 0, lastRun: "" },
        { id: "RULE-EVIDENCE", name: "证据材料有效期与可追溯", owner: "评价审核组", enabled: true, violations: 0, lastRun: "" },
        { id: "RULE-SCORE", name: "评分边界与底线项联动", owner: "标准规则组", enabled: true, violations: 0, lastRun: "" },
        { id: "RULE-SECURITY", name: "安全合规与最小权限", owner: "安全管理组", enabled: true, violations: 0, lastRun: "" },
      ],
      securityItems: [
        { id: "SEC-CLASS", name: "等保与系统定级材料", owner: "安全管理组", status: "待复核", lastCheck: "", risk: "中" },
        { id: "SEC-PRIVACY", name: "个人信息与脱敏策略", owner: "数据治理组", status: "待复核", lastCheck: "", risk: "中" },
        { id: "SEC-AUDIT", name: "审计留痕与日志留存", owner: "平台技术组", status: "已通过", lastCheck: "2026-07-27 09:30", risk: "低" },
        { id: "SEC-BACKUP", name: "备份恢复与容灾演练", owner: "平台技术组", status: "待复核", lastCheck: "", risk: "中" },
      ],
      operationLogs: [
        { at: "2026-07-27 09:30", action: "初始化试点运行任务", actor: "系统管理员", result: "已生成年度周期、标准版本和审核流程。" },
        { at: "2026-07-27 10:00", action: "导入指标样例", actor: "标准管理组", result: "已载入8个指标域、18个代表性指标。" },
      ],
    },
  };

  function buildDefaultSubmission() {
    return indicators.reduce((acc, indicator, index) => {
      const ratio = [0.9, 0.82, 0.76, 0.68, 0.55][index % 5];
      acc[indicator.code] = {
        selfScore: Math.round(indicator.max * ratio),
        reviewedScore: null,
        evidenceCount: indicator.code === "H1" ? 0 : index % 4 === 0 ? 0 : 1,
        comment: index % 4 === 0 ? "材料待补充，已安排责任部门整理。" : "已完成自评，材料可支撑审核。",
        status: "草稿",
      };
      return acc;
    }, {});
  }

  function cloneSeed() {
    const next = JSON.parse(JSON.stringify(seedState));
    next.hospitals.forEach((hospital, hospitalIndex) => {
      next.submissions[hospital.code] = buildDefaultSubmission();
      Object.values(next.submissions[hospital.code]).forEach((item, index) => {
        if (hospitalIndex === 1) item.selfScore = Math.max(1, item.selfScore - (index % 3));
        if (hospitalIndex === 2) item.selfScore = Math.max(1, item.selfScore - 4);
      });
    });
    if (next.submissions.H000001?.B3) next.submissions.H000001.B3.status = "专家复核";
    return next;
  }

  function defaultOperations() {
    return JSON.parse(JSON.stringify(seedState.operations));
  }

  function ensureStateShape(next) {
    if (!next.operations) next.operations = defaultOperations();
    const baseOperations = defaultOperations();
    next.operations.cycle = { ...baseOperations.cycle, ...(next.operations.cycle || {}) };
    next.operations.stages = Array.isArray(next.operations.stages) ? next.operations.stages : baseOperations.stages;
    next.operations.standardVersions = Array.isArray(next.operations.standardVersions) ? next.operations.standardVersions : baseOperations.standardVersions;
    next.operations.ruleSets = Array.isArray(next.operations.ruleSets) ? next.operations.ruleSets : baseOperations.ruleSets;
    next.operations.securityItems = Array.isArray(next.operations.securityItems) ? next.operations.securityItems : baseOperations.securityItems;
    next.operations.operationLogs = Array.isArray(next.operations.operationLogs) ? next.operations.operationLogs : baseOperations.operationLogs;
    if (!next.activeRole) next.activeRole = seedState.activeRole;
    if (!Array.isArray(next.tasks)) next.tasks = JSON.parse(JSON.stringify(seedState.tasks));
    if (!Array.isArray(next.roles)) next.roles = JSON.parse(JSON.stringify(seedState.roles));
    if (!Array.isArray(next.users)) next.users = JSON.parse(JSON.stringify(seedState.users));
    if (!Array.isArray(next.assignments)) next.assignments = JSON.parse(JSON.stringify(seedState.assignments));
    if (!Array.isArray(next.evidenceMaterials)) next.evidenceMaterials = JSON.parse(JSON.stringify(seedState.evidenceMaterials));
    if (!Array.isArray(next.reviewAssignments)) next.reviewAssignments = JSON.parse(JSON.stringify(seedState.reviewAssignments));
    if (!Array.isArray(next.scoringRules)) next.scoringRules = JSON.parse(JSON.stringify(seedState.scoringRules));
    if (!Array.isArray(next.bottomLineRules)) next.bottomLineRules = JSON.parse(JSON.stringify(seedState.bottomLineRules));
    if (!Array.isArray(next.appeals)) next.appeals = JSON.parse(JSON.stringify(seedState.appeals));
    if (!Array.isArray(next.exportApprovals)) next.exportApprovals = JSON.parse(JSON.stringify(seedState.exportApprovals));
    if (!Array.isArray(next.systemParams)) next.systemParams = JSON.parse(JSON.stringify(seedState.systemParams));
    if (!Array.isArray(next.auditLogs)) next.auditLogs = JSON.parse(JSON.stringify(seedState.auditLogs));
    if (!Array.isArray(next.spotChecks)) next.spotChecks = JSON.parse(JSON.stringify(seedState.spotChecks));
    if (!next.sandboxConfig) next.sandboxConfig = JSON.parse(JSON.stringify(seedState.sandboxConfig));
    if (!Array.isArray(next.sandboxRuns)) next.sandboxRuns = JSON.parse(JSON.stringify(seedState.sandboxRuns));
    if (!Array.isArray(next.materialClassifications)) next.materialClassifications = JSON.parse(JSON.stringify(seedState.materialClassifications));
    if (!Array.isArray(next.peerAnomalies)) next.peerAnomalies = JSON.parse(JSON.stringify(seedState.peerAnomalies));
    if (!Array.isArray(next.notifications)) next.notifications = JSON.parse(JSON.stringify(seedState.notifications));
    if (!Array.isArray(next.notificationChannels)) next.notificationChannels = JSON.parse(JSON.stringify(seedState.notificationChannels));
    if (!Array.isArray(next.importJobs)) next.importJobs = JSON.parse(JSON.stringify(seedState.importJobs));
    if (!Array.isArray(next.submissionBatches)) next.submissionBatches = JSON.parse(JSON.stringify(seedState.submissionBatches));
    if (!Array.isArray(next.uploadQueue)) next.uploadQueue = JSON.parse(JSON.stringify(seedState.uploadQueue));
    if (!Array.isArray(next.reviewerWorkloads)) next.reviewerWorkloads = JSON.parse(JSON.stringify(seedState.reviewerWorkloads));
    if (!Array.isArray(next.dailyReports)) next.dailyReports = JSON.parse(JSON.stringify(seedState.dailyReports));
    if (!Array.isArray(next.serviceHealth)) next.serviceHealth = JSON.parse(JSON.stringify(seedState.serviceHealth));
    if (!Array.isArray(next.interfaceHealth)) next.interfaceHealth = JSON.parse(JSON.stringify(seedState.interfaceHealth));
    if (!Array.isArray(next.jobQueues)) next.jobQueues = JSON.parse(JSON.stringify(seedState.jobQueues));
    if (!Array.isArray(next.storagePools)) next.storagePools = JSON.parse(JSON.stringify(seedState.storagePools));
    if (!Array.isArray(next.monitoringAlerts)) next.monitoringAlerts = JSON.parse(JSON.stringify(seedState.monitoringAlerts));
    if (!Array.isArray(next.hospitalReadiness)) next.hospitalReadiness = JSON.parse(JSON.stringify(seedState.hospitalReadiness));
    if (!Array.isArray(next.pilotAccessApplications)) next.pilotAccessApplications = JSON.parse(JSON.stringify(seedState.pilotAccessApplications));
    if (!Array.isArray(next.pilotConnectors)) next.pilotConnectors = JSON.parse(JSON.stringify(seedState.pilotConnectors));
    if (!Array.isArray(next.pilotDataMappings)) next.pilotDataMappings = JSON.parse(JSON.stringify(seedState.pilotDataMappings));
    if (!Array.isArray(next.pilotIntegrationTests)) next.pilotIntegrationTests = JSON.parse(JSON.stringify(seedState.pilotIntegrationTests));
    if (!Array.isArray(next.pilotIntegrationIssues)) next.pilotIntegrationIssues = JSON.parse(JSON.stringify(seedState.pilotIntegrationIssues));
    if (!Array.isArray(next.pilotIntegrationGates)) next.pilotIntegrationGates = JSON.parse(JSON.stringify(seedState.pilotIntegrationGates));
    if (!Array.isArray(next.integrationEnvironments)) next.integrationEnvironments = JSON.parse(JSON.stringify(seedState.integrationEnvironments));
    if (!Array.isArray(next.credentialVaultEntries)) next.credentialVaultEntries = JSON.parse(JSON.stringify(seedState.credentialVaultEntries));
    if (!Array.isArray(next.integrationExecutionJobs)) next.integrationExecutionJobs = JSON.parse(JSON.stringify(seedState.integrationExecutionJobs));
    if (!Array.isArray(next.integrationExecutionWorkers)) next.integrationExecutionWorkers = JSON.parse(JSON.stringify(seedState.integrationExecutionWorkers));
    if (!Array.isArray(next.integrationDeadLetters)) next.integrationDeadLetters = JSON.parse(JSON.stringify(seedState.integrationDeadLetters));
    if (!Array.isArray(next.integrationExecutionEvents)) next.integrationExecutionEvents = JSON.parse(JSON.stringify(seedState.integrationExecutionEvents));
    if (!Array.isArray(next.integrationCallbackReceipts)) next.integrationCallbackReceipts = JSON.parse(JSON.stringify(seedState.integrationCallbackReceipts));
    if (!Array.isArray(next.integrationReplayEvents)) next.integrationReplayEvents = JSON.parse(JSON.stringify(seedState.integrationReplayEvents));
    if (!Array.isArray(next.integrationQuarantines)) next.integrationQuarantines = JSON.parse(JSON.stringify(seedState.integrationQuarantines));
    if (!Array.isArray(next.integrationCutoverWindows)) next.integrationCutoverWindows = JSON.parse(JSON.stringify(seedState.integrationCutoverWindows));
    if (!Array.isArray(next.productionRuntimeControls)) next.productionRuntimeControls = JSON.parse(JSON.stringify(seedState.productionRuntimeControls));
    if (!Array.isArray(next.cutoverEvidenceRequirements)) next.cutoverEvidenceRequirements = JSON.parse(JSON.stringify(seedState.cutoverEvidenceRequirements));
    if (!Array.isArray(next.productionCutoverApprovals)) next.productionCutoverApprovals = JSON.parse(JSON.stringify(seedState.productionCutoverApprovals));
    if (!next.productionGoNoGo) next.productionGoNoGo = JSON.parse(JSON.stringify(seedState.productionGoNoGo));
    if (!Array.isArray(next.pilotTickets)) next.pilotTickets = JSON.parse(JSON.stringify(seedState.pilotTickets));
    if (!Array.isArray(next.trainingSessions)) next.trainingSessions = JSON.parse(JSON.stringify(seedState.trainingSessions));
    if (!Array.isArray(next.pilotReleases)) next.pilotReleases = JSON.parse(JSON.stringify(seedState.pilotReleases));
    if (!Array.isArray(next.pilotFeedback)) next.pilotFeedback = JSON.parse(JSON.stringify(seedState.pilotFeedback));
    if (!Array.isArray(next.pilotOutcomeMetrics)) next.pilotOutcomeMetrics = JSON.parse(JSON.stringify(seedState.pilotOutcomeMetrics));
    if (!Array.isArray(next.pilotHospitalOutcomes)) next.pilotHospitalOutcomes = JSON.parse(JSON.stringify(seedState.pilotHospitalOutcomes));
    if (!Array.isArray(next.pilotIssueThemes)) next.pilotIssueThemes = JSON.parse(JSON.stringify(seedState.pilotIssueThemes));
    if (!Array.isArray(next.pilotImprovementPlans)) next.pilotImprovementPlans = JSON.parse(JSON.stringify(seedState.pilotImprovementPlans));
    if (!Array.isArray(next.rolloutRegions)) next.rolloutRegions = JSON.parse(JSON.stringify(seedState.rolloutRegions));
    if (!Array.isArray(next.pilotAssessmentReports)) next.pilotAssessmentReports = JSON.parse(JSON.stringify(seedState.pilotAssessmentReports));
    if (!Array.isArray(next.assistantKnowledgeSources)) next.assistantKnowledgeSources = JSON.parse(JSON.stringify(seedState.assistantKnowledgeSources));
    if (!Array.isArray(next.assistantKnowledgeVersions)) next.assistantKnowledgeVersions = JSON.parse(JSON.stringify(seedState.assistantKnowledgeVersions));
    if (!Array.isArray(next.standardQaRecords)) next.standardQaRecords = JSON.parse(JSON.stringify(seedState.standardQaRecords));
    if (!Array.isArray(next.assistantRetrievalTraces)) next.assistantRetrievalTraces = JSON.parse(JSON.stringify(seedState.assistantRetrievalTraces));
    if (!Array.isArray(next.assistantModelCalls)) next.assistantModelCalls = JSON.parse(JSON.stringify(seedState.assistantModelCalls));
    if (!next.assistantQualityGate) next.assistantQualityGate = JSON.parse(JSON.stringify(seedState.assistantQualityGate));
    if (!Array.isArray(next.assistantEvaluationSuites)) next.assistantEvaluationSuites = JSON.parse(JSON.stringify(seedState.assistantEvaluationSuites));
    if (!Array.isArray(next.assistantEvaluationRuns)) next.assistantEvaluationRuns = JSON.parse(JSON.stringify(seedState.assistantEvaluationRuns));
    if (!Array.isArray(next.assistantReleaseCandidates)) next.assistantReleaseCandidates = JSON.parse(JSON.stringify(seedState.assistantReleaseCandidates));
    if (!next.assistantOnlineGuardrail) next.assistantOnlineGuardrail = JSON.parse(JSON.stringify(seedState.assistantOnlineGuardrail));
    if (!Array.isArray(next.assistantDeployments)) next.assistantDeployments = JSON.parse(JSON.stringify(seedState.assistantDeployments));
    if (!Array.isArray(next.assistantOnlineQualityWindows)) next.assistantOnlineQualityWindows = JSON.parse(JSON.stringify(seedState.assistantOnlineQualityWindows));
    if (!Array.isArray(next.assistantQualityIncidents)) next.assistantQualityIncidents = JSON.parse(JSON.stringify(seedState.assistantQualityIncidents));
    if (!Array.isArray(next.assistantFeedbackRecords)) next.assistantFeedbackRecords = JSON.parse(JSON.stringify(seedState.assistantFeedbackRecords));
    if (!Array.isArray(next.assistantImprovementSamples)) next.assistantImprovementSamples = JSON.parse(JSON.stringify(seedState.assistantImprovementSamples));
    if (!Array.isArray(next.assistantImprovementCycles)) next.assistantImprovementCycles = JSON.parse(JSON.stringify(seedState.assistantImprovementCycles));
    if (!Array.isArray(next.anomalyExplanations)) next.anomalyExplanations = JSON.parse(JSON.stringify(seedState.anomalyExplanations));
    if (!Array.isArray(next.rectificationSuggestions)) next.rectificationSuggestions = JSON.parse(JSON.stringify(seedState.rectificationSuggestions));
    if (!Array.isArray(next.reviewRiskSignals)) next.reviewRiskSignals = JSON.parse(JSON.stringify(seedState.reviewRiskSignals));
    if (!next.metrics) next.metrics = cloneSeed().metrics;
    if (!next.publicHealth) next.publicHealth = JSON.parse(JSON.stringify(seedState.publicHealth));
    if (!Array.isArray(next.publicHealth.lanes)) next.publicHealth.lanes = JSON.parse(JSON.stringify(seedState.publicHealth.lanes));
    if (!Array.isArray(next.publicHealth.campaigns)) next.publicHealth.campaigns = JSON.parse(JSON.stringify(seedState.publicHealth.campaigns));
    if (!Array.isArray(next.publicHealth.incidents)) next.publicHealth.incidents = JSON.parse(JSON.stringify(seedState.publicHealth.incidents));
    if (!Array.isArray(next.publicHealth.incidentEvidence)) next.publicHealth.incidentEvidence = JSON.parse(JSON.stringify(seedState.publicHealth.incidentEvidence));
    if (!Array.isArray(next.publicHealth.evidenceActions)) next.publicHealth.evidenceActions = JSON.parse(JSON.stringify(seedState.publicHealth.evidenceActions));
    if (!Array.isArray(next.publicHealth.incidentActions)) next.publicHealth.incidentActions = JSON.parse(JSON.stringify(seedState.publicHealth.incidentActions));
    if (!Array.isArray(next.publicHealth.blockers)) next.publicHealth.blockers = JSON.parse(JSON.stringify(seedState.publicHealth.blockers));
    next.publicHealth.schemaVersion = 3;
    next.publicHealth.productionReady = false;
    if (!next.submissions) next.submissions = {};
    if (!Array.isArray(next.validationIssues)) next.validationIssues = [];
    if (!Array.isArray(next.reviewNotes)) next.reviewNotes = [];
    if (!Array.isArray(next.expertReviews)) next.expertReviews = [];
    backfillExpertReviews(next);
    if (!next.expertReviews.length) {
      next.expertReviews = JSON.parse(JSON.stringify(seedState.expertReviews));
      if (!next.reviewNotes.some((note) => note.id === "NOTE-SEED-EXP-B3")) {
        next.reviewNotes.unshift(JSON.parse(JSON.stringify(seedState.reviewNotes[0])));
      }
      if (next.submissions.H000001?.B3) next.submissions.H000001.B3.status = "专家复核";
    }
    if (!Array.isArray(next.rectifications)) next.rectifications = [];
    return next;
  }

  function backfillExpertReviews(next) {
    const existing = new Set(next.expertReviews.map((item) => `${item.hospitalCode}-${item.indicatorCode}`));
    next.reviewNotes
      .filter((note) => note.status === "专家复核")
      .forEach((note) => {
        const key = `${note.hospitalCode}-${note.indicatorCode}`;
        if (existing.has(key) || note.indicatorCode === "批量") return;
        next.expertReviews.unshift({
          id: `EXP-${note.hospitalCode}-${note.indicatorCode}-${Date.now()}`,
          hospitalCode: note.hospitalCode,
          indicatorCode: note.indicatorCode,
          submittedBy: "省级审核组",
          expertGroup: "专家复核组",
          priority: "中",
          status: "待复核",
          reason: note.text || "省级审核提交专家复核。",
          suggestedScore: null,
          conclusion: "",
          submittedAt: note.at || "",
          completedAt: "",
        });
      });
  }

  let state = loadState();

  const workspace = document.getElementById("workspace");
  const viewTitle = document.getElementById("viewTitle");
  const hospitalSelect = document.getElementById("hospitalSelect");
  const roleSelect = document.getElementById("roleSelect");
  const notice = document.getElementById("notice");
  const sideTaskName = document.getElementById("sideTaskName");
  const sideTaskStatus = document.getElementById("sideTaskStatus");

  function loadState() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return cloneSeed();
      const parsed = JSON.parse(raw);
      if (!parsed.submissions || !parsed.metrics) return cloneSeed();
      return ensureStateShape(parsed);
    } catch {
      return cloneSeed();
    }
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function activeHospital() {
    return state.hospitals.find((hospital) => hospital.code === state.selectedHospital) || state.hospitals[0];
  }

  function activeRole() {
    return state.roles.find((role) => role.name === state.activeRole) || state.roles[0];
  }

  function addAudit(action, target, result = "已完成") {
    state.auditLogs.unshift({
      at: nowText(),
      user: state.activeRole,
      action,
      target,
      result,
    });
    state.auditLogs = state.auditLogs.slice(0, 40);
  }

  function submissionForActive() {
    return submissionForHospital(state.selectedHospital);
  }

  function submissionForHospital(hospitalCode) {
    if (!state.submissions[hospitalCode]) state.submissions[hospitalCode] = buildDefaultSubmission();
    return state.submissions[hospitalCode];
  }

  function domainName(code) {
    return domains.find((domain) => domain.code === code)?.name || code;
  }

  function indicatorByCode(code) {
    return indicators.find((indicator) => indicator.code === code);
  }

  function fmt(num) {
    return new Intl.NumberFormat("zh-CN").format(num);
  }

  function pct(num, digits = 1) {
    return `${(num * 100).toFixed(digits)}%`;
  }

  function nowText() {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }

  function digestText(value) {
    let hash = 2166136261;
    const text = String(value);
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `fnv32-${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }

  function addOperationLog(action, result, actor = "运行管理员") {
    state.operations.operationLogs.unshift({
      at: nowText(),
      action,
      actor,
      result,
    });
    state.operations.operationLogs = state.operations.operationLogs.slice(0, 20);
  }

  function operationSummary() {
    const operations = state.operations;
    const activeStage = operations.stages.find((stage) => stage.id === operations.cycle.currentStage) || operations.stages[0];
    const completedStages = operations.stages.filter((stage) => stage.status === "已完成").length;
    const enabledRules = operations.ruleSets.filter((rule) => rule.enabled).length;
    const ruleViolations = operations.ruleSets.reduce((sum, rule) => sum + Number(rule.violations || 0), 0);
    const securityPending = operations.securityItems.filter((item) => item.status !== "已通过").length;
    return {
      activeStage,
      completedStages,
      enabledRules,
      ruleViolations,
      securityPending,
      progress: operations.stages.length ? completedStages / operations.stages.length : 0,
    };
  }

  function expertReviewsForActive(includeDone = true) {
    return state.expertReviews.filter(
      (item) => item.hospitalCode === state.selectedHospital && (includeDone || item.status !== "已复核"),
    );
  }

  function expertSummary() {
    const reviews = expertReviewsForActive();
    return {
      total: reviews.length,
      pending: reviews.filter((item) => item.status === "待复核").length,
      completed: reviews.filter((item) => item.status === "已复核").length,
      supplement: reviews.filter((item) => item.status === "需补证").length,
      adjusted: reviews.filter((item) => item.resultType === "调整扣分").length,
      highPriority: reviews.filter((item) => item.priority === "高" && item.status !== "已复核").length,
    };
  }

  function evidenceForActive() {
    return state.evidenceMaterials.filter((item) => item.hospitalCode === state.selectedHospital);
  }

  function evidenceSummary() {
    const materials = evidenceForActive();
    const indicatorCodes = new Set(materials.map((item) => item.indicatorCode));
    return {
      total: materials.length,
      covered: indicatorCodes.size,
      pending: materials.filter((item) => item.status !== "已校验").length,
      sensitive: materials.filter((item) => ["S3", "S4", "S5"].includes(item.sensitivity)).length,
      expiring: materials.filter((item) => item.expireAt <= "2026-10-01").length,
    };
  }

  function taskSummary() {
    const activeTask = state.tasks.find((task) => task.id === state.task.id) || state.tasks[0];
    const submitted = state.hospitals.filter((hospital) => {
      const submission = state.submissions[hospital.code] || {};
      return Object.values(submission).some((entry) => entry.status === "已提交" || entry.status === "审核通过");
    }).length;
    return {
      activeTask,
      totalHospitals: activeTask.hospitals.length,
      submitted,
      reviewAssigned: state.reviewAssignments.filter((item) => item.reviewer !== "未分派").length,
      reminders: state.tasks.reduce((sum, task) => sum + Number(task.reminders || 0), 0),
      extensions: state.tasks.reduce((sum, task) => sum + Number(task.extensionRequests || 0), 0),
    };
  }

  function analyticsSummary() {
    const hospitalScores = state.hospitals.map((hospital) => {
      const previous = state.selectedHospital;
      state.selectedHospital = hospital.code;
      const score = scoreSnapshot();
      state.selectedHospital = previous;
      return { ...hospital, score: score.total, grade: score.grade };
    });
    const avg = Math.round(hospitalScores.reduce((sum, item) => sum + item.score, 0) / Math.max(1, hospitalScores.length));
    return {
      hospitalScores,
      avg,
      top: [...hospitalScores].sort((a, b) => b.score - a.score)[0],
      riskHospitals: state.reviewAssignments.filter((item) => item.risk === "高").length,
      rectificationOverdue: state.rectifications.filter((item) => item.status !== "复核通过" && item.due && item.due < "2026-12-31").length,
    };
  }

  function intelligenceSummary() {
    return {
      spotChecksOpen: state.spotChecks.filter((item) => item.status !== "已完成").length,
      sandboxPending: state.sandboxRuns.filter((item) => item.status === "待审批").length,
      classificationsPending: state.materialClassifications.filter((item) => item.status !== "已确认").length,
      anomaliesOpen: state.peerAnomalies.filter((item) => item.status === "待核验").length,
      unreadMessages: state.notifications.filter((item) => !item.read).length,
      importRejected: state.importJobs.reduce((sum, item) => sum + Number(item.rejected || 0), 0),
    };
  }

  function pilotSummary() {
    const activeBatch = state.submissionBatches.find((item) => item.status === "填报中") || state.submissionBatches[0];
    const activeUploads = state.uploadQueue.filter((item) => item.status !== "已完成");
    const failedUploads = state.uploadQueue.filter((item) => item.status === "失败");
    const highLoadReviewers = state.reviewerWorkloads.filter((item) => item.status === "高负荷");
    const latestReport = state.dailyReports[0];
    return {
      activeBatch,
      batchCount: state.submissionBatches.length,
      submitted: activeBatch?.submitted || 0,
      submissionRate: activeBatch ? activeBatch.submitted / Math.max(1, activeBatch.hospitalCount) : 0,
      activeUploads: activeUploads.length,
      failedUploads: failedUploads.length,
      highLoadReviewers: highLoadReviewers.length,
      overdueReviews: state.reviewerWorkloads.reduce((sum, item) => sum + Number(item.overdue || 0), 0),
      latestReport,
    };
  }

  function monitoringSummary() {
    const degradedServices = state.serviceHealth.filter((item) => item.status !== "正常");
    const unhealthyInterfaces = state.interfaceHealth.filter((item) => item.status !== "正常");
    const activeAlerts = state.monitoringAlerts.filter((item) => item.status !== "已关闭");
    const queueBacklog = state.jobQueues.reduce((sum, item) => sum + Number(item.pending || 0), 0);
    const storageRisks = state.storagePools.filter((item) => item.status !== "正常");
    const availability = state.serviceHealth.reduce((sum, item) => sum + Number(item.availability || 0), 0) / Math.max(1, state.serviceHealth.length);
    return {
      availability,
      degradedServices: degradedServices.length,
      unhealthyInterfaces: unhealthyInterfaces.length,
      activeAlerts: activeAlerts.length,
      urgentAlerts: activeAlerts.filter((item) => item.level === "紧急" || item.level === "高").length,
      queueBacklog,
      storageRisks: storageRisks.length,
    };
  }

  const publicHealthProfessionalReferences = {
    "infectious-reporting": {
      eventId: "phe-infectious-001",
      eventStatus: "待疾控复核",
      exchangeRunId: "phxr-direct-report-001",
      receiptStatus: "accepted",
      evidencePacketId: "phcep-direct-report-endpoint",
      evidenceProgress: "0/3",
    },
    immunization: {
      eventId: "phe-immunization-001",
      eventStatus: "处置中",
      exchangeRunId: "phxr-immunization-001",
      receiptStatus: "accepted",
      evidencePacketId: "phcep-immunization-registry",
      evidenceProgress: "0/3",
    },
    "maternal-child": {
      eventId: "",
      eventStatus: "",
      exchangeRunId: "phxr-maternal-child-001",
      receiptStatus: "pending-manual-signoff",
      evidencePacketId: "phcep-lis-emr-credentials",
      evidenceProgress: "0/3",
    },
    "chronic-disease": { eventId: "phe-chronic-001", eventStatus: "待家庭医生补访" },
    "public-health-followup": { eventId: "phe-chronic-001", eventStatus: "待家庭医生补访" },
    "family-doctor": { eventId: "phe-chronic-001", eventStatus: "待家庭医生补访" },
  };

  function parsePublicHealthTime(value) {
    const text = String(value || "").trim();
    if (!text) return Number.NaN;
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})?$/.test(text)
      ? `${text.replace(" ", "T")}${text.length === 16 ? ":00" : ""}+08:00`
      : text;
    return Date.parse(normalized);
  }

  function publicHealthIncidentSla(incident, now = Date.now()) {
    const dueAt = parsePublicHealthTime(incident.dueAt);
    const closedAt = parsePublicHealthTime(incident.closedAt);
    const reference = incident.status === "已关闭" && Number.isFinite(closedAt) ? closedAt : now;
    const remainingMinutes = Number.isFinite(dueAt) ? Math.round((dueAt - reference) / 60000) : null;
    const overdue = Number.isFinite(remainingMinutes) && remainingMinutes < 0;
    const dueSoon = incident.status !== "已关闭" && Number.isFinite(remainingMinutes) && remainingMinutes >= 0 && remainingMinutes <= 60;
    return {
      overdue,
      dueSoon,
      remainingMinutes,
      status: incident.status === "已关闭"
        ? overdue ? "逾期关闭" : "按时关闭"
        : overdue ? "已超时" : dueSoon ? "即将超时" : "时限内",
    };
  }

  function publicHealthProfessionalAssociation(incident) {
    const reference = publicHealthProfessionalReferences[incident.laneId] || {};
    const lane = state.publicHealth.lanes.find((item) => item.id === incident.laneId);
    return {
      ...reference,
      probeStatus: lane?.probe === "已验证" ? "受控样例已验证" : "待可信探测",
      trustedProbe: false,
    };
  }

  const publicHealthEvidenceLabels = {
    "business-receipt": "真实业务回执摘要",
    "site-joint-test": "现场接口联调记录",
    "production-approval": "生产审批编号",
    "dr-rehearsal": "灾备与回退演练编号",
  };

  const publicHealthEvidenceRequirements = {
    P0: ["business-receipt", "site-joint-test", "production-approval", "dr-rehearsal"],
    P1: ["business-receipt", "site-joint-test", "production-approval"],
    P2: ["business-receipt", "site-joint-test"],
  };

  function publicHealthClosureGate(incident) {
    const requiredTypes = publicHealthEvidenceRequirements[incident.level] || publicHealthEvidenceRequirements.P2;
    const linked = state.publicHealth.incidentEvidence.filter((item) => item.incidentId === incident.id);
    const items = requiredTypes.map((evidenceType) => {
      const candidates = linked.filter((item) => item.evidenceType === evidenceType);
      const accepted = candidates.find((item) => item.status === "accepted");
      const latest = accepted || candidates[0] || null;
      return {
        evidenceType,
        label: publicHealthEvidenceLabels[evidenceType],
        status: accepted ? "accepted" : latest?.status || "missing",
        evidenceId: latest?.id || "",
        referenceNo: latest?.referenceNo || "",
      };
    });
    const missingTypes = items.filter((item) => item.status !== "accepted").map((item) => item.evidenceType);
    return {
      ready: missingTypes.length === 0,
      required: items.length,
      accepted: items.filter((item) => item.status === "accepted").length,
      missingTypes,
      items,
      productionReady: false,
    };
  }

  function filteredPublicHealthIncidents() {
    const hospital = workspace.dataset.publicHealthHospital || "全部";
    const status = workspace.dataset.publicHealthStatus || "全部";
    const level = workspace.dataset.publicHealthLevel || "全部";
    const sla = workspace.dataset.publicHealthSla || "全部";
    return state.publicHealth.incidents.filter((item) => {
      if (hospital !== "全部" && item.hospitalCode !== hospital) return false;
      if (status !== "全部" && item.status !== status) return false;
      if (level !== "全部" && item.level !== level) return false;
      const slaState = publicHealthIncidentSla(item);
      if (sla === "已超时" && !(item.status !== "已关闭" && slaState.overdue)) return false;
      if (sla === "已升级" && !item.escalation?.escalatedAt) return false;
      return true;
    });
  }

  function publicHealthSummary(incidents = state.publicHealth.incidents) {
    const openIncidents = incidents.filter((item) => item.status !== "已关闭");
    return {
      verifiedLanes: state.publicHealth.lanes.filter((item) => item.probe === "已验证").length,
      totalLanes: state.publicHealth.lanes.length,
      openIncidents: openIncidents.length,
      p0Incidents: openIncidents.filter((item) => item.level === "P0").length,
      pendingVerification: openIncidents.filter((item) => item.status === "待复核").length,
      closedIncidents: incidents.filter((item) => item.status === "已关闭").length,
      overdueIncidents: openIncidents.filter((item) => publicHealthIncidentSla(item).overdue).length,
      escalatedIncidents: incidents.filter((item) => item.escalation?.escalatedAt).length,
      closureReady: openIncidents.filter((item) => item.status === "待复核" && publicHealthClosureGate(item).ready).length,
      continuityReady: state.publicHealth.continuousConnectivityReady,
      productionReady: false,
    };
  }

  function collaborationSummary() {
    const averageReadiness = Math.round(
      state.hospitalReadiness.reduce((sum, item) => sum + Number(item.readiness || 0), 0) / Math.max(1, state.hospitalReadiness.length),
    );
    const openTickets = state.pilotTickets.filter((item) => item.status !== "已解决");
    const upcomingTraining = state.trainingSessions.filter((item) => item.status !== "已完成");
    const openFeedback = state.pilotFeedback.filter((item) => item.status !== "已解决");
    return {
      averageReadiness,
      readyHospitals: state.hospitalReadiness.filter((item) => item.status === "已就绪").length,
      blockedHospitals: state.hospitalReadiness.filter((item) => item.status === "有阻塞").length,
      totalBlockers: state.hospitalReadiness.reduce((sum, item) => sum + Number(item.blockers || 0), 0),
      openTickets: openTickets.length,
      urgentTickets: openTickets.filter((item) => item.priority === "紧急" || item.priority === "高").length,
      unassignedTickets: openTickets.filter((item) => item.owner === "未分派").length,
      upcomingTraining: upcomingTraining.length,
      enrolled: upcomingTraining.reduce((sum, item) => sum + Number(item.enrolled || 0), 0),
      openFeedback: openFeedback.length,
      latestRelease: state.pilotReleases[0],
    };
  }

  function integrationSummary() {
    const readyConnectors = state.pilotConnectors.filter(
      (item) => item.connectivityStatus === "在线" && item.credentialStatus === "有效" && item.contractStatus === "契约通过",
    );
    const readyMappings = state.pilotDataMappings.filter((item) => item.status === "映射就绪" && item.privacyCheck === "脱敏通过");
    const openIssues = state.pilotIntegrationIssues.filter((item) => item.status !== "已关闭");
    return {
      activeApplications: state.pilotAccessApplications.filter((item) => item.status === "已受理" || item.status === "联调中").length,
      completedApplications: state.pilotAccessApplications.filter((item) => item.status === "联调完成").length,
      readyConnectors: readyConnectors.length,
      connectorPassRate: readyConnectors.length / Math.max(1, state.pilotConnectors.length),
      readyMappings: readyMappings.length,
      mappingPassRate: readyMappings.length / Math.max(1, state.pilotDataMappings.length),
      openIssues: openIssues.length,
      criticalIssues: openIssues.filter((item) => item.severity === "阻断" || item.severity === "高").length,
      approvedHospitals: state.pilotIntegrationGates.filter((item) => item.status === "已准入").length,
      launchReadyHospitals: state.pilotIntegrationGates.filter((item) => item.status === "可上线" || item.status === "已准入").length,
    };
  }

  function executionSummary() {
    const pendingJobs = state.integrationExecutionJobs.filter((item) => !["成功", "阻断", "死信"].includes(item.status));
    const activeQuarantines = state.integrationQuarantines.filter((item) => item.status === "隔离中");
    const blockedReceipts = state.integrationCallbackReceipts.filter((item) => item.status === "已阻断");
    return {
      healthyEnvironments: state.integrationEnvironments.filter((item) => item.status === "健康").length,
      activeVaultEntries: state.credentialVaultEntries.filter((item) => item.status === "有效").length,
      readyWorkers: state.integrationExecutionWorkers.filter((item) => item.status === "就绪").length,
      busyWorkers: state.integrationExecutionWorkers.filter((item) => item.status === "忙碌").length,
      staleWorkers: state.integrationExecutionWorkers.filter((item) => item.status === "失联").length,
      pendingJobs: pendingJobs.length,
      retryScheduledJobs: state.integrationExecutionJobs.filter((item) => item.status === "等待重试").length,
      successfulJobs: state.integrationExecutionJobs.filter((item) => item.status === "成功").length,
      openDeadLetters: state.integrationDeadLetters.filter((item) => item.status === "待复核").length,
      verifiedReceipts: state.integrationCallbackReceipts.filter((item) => item.status === "已验证").length,
      blockedReceipts: blockedReceipts.length,
      activeQuarantines: activeQuarantines.length,
      readyCutovers: state.integrationCutoverWindows.filter((item) => item.status === "可切换" || item.status === "已切换").length,
      runtimeControlsReady: state.productionRuntimeControls.filter((item) => ["已实现", "已配置"].includes(item.status)).length,
      verifiedCutoverEvidence: state.cutoverEvidenceRequirements.filter((item) => item.status === "已核验").length,
      approvedCutoverRoles: state.productionCutoverApprovals.filter((item) => item.decision === "同意").length,
      productionDecision: state.productionGoNoGo.decision,
    };
  }

  function assessmentSummary() {
    const totalWeight = state.pilotOutcomeMetrics.reduce((sum, item) => sum + Number(item.weight || 0), 0);
    const weightedScore = state.pilotOutcomeMetrics.reduce((sum, item) => sum + Number(item.current || 0) * Number(item.weight || 0), 0) / Math.max(1, totalWeight);
    const averageRolloutReadiness = state.rolloutRegions.reduce((sum, item) => sum + Number(item.readiness || 0), 0) / Math.max(1, state.rolloutRegions.length);
    return {
      weightedScore: Number(weightedScore.toFixed(1)),
      metricsMet: state.pilotOutcomeMetrics.filter((item) => item.status === "达标").length,
      qualifiedHospitals: state.pilotHospitalOutcomes.filter((item) => item.status === "可推广").length,
      openThemes: state.pilotIssueThemes.filter((item) => item.status !== "已闭环").length,
      openPlans: state.pilotImprovementPlans.filter((item) => item.status !== "已完成").length,
      completedPlans: state.pilotImprovementPlans.filter((item) => item.status === "已完成").length,
      averageRolloutReadiness: Math.round(averageRolloutReadiness),
      readyRegions: state.rolloutRegions.filter((item) => item.status === "可启动" || item.status === "已启动").length,
      latestReport: state.pilotAssessmentReports[0],
    };
  }

  function assistantSummary() {
    const pendingQuestions = state.standardQaRecords.filter((item) => item.status !== "已确认");
    const pendingExplanations = state.anomalyExplanations.filter((item) => item.status === "待确认");
    const pendingSuggestions = state.rectificationSuggestions.filter((item) => item.status === "待采纳");
    const openRisks = state.reviewRiskSignals.filter((item) => item.status === "待确认" || item.status === "已确认");
    const sufficientTraces = state.assistantRetrievalTraces.filter((item) => item.status === "命中充分");
    const latestEvaluationRun = state.assistantEvaluationRuns.slice().sort((left, right) => String(right.finishedAt).localeCompare(String(left.finishedAt)))[0];
    const activeRelease = state.assistantReleaseCandidates.find((item) => item.status === "已发布");
    const activeCanaryDeployments = state.assistantDeployments.filter((item) => item.strategy === "灰度" && ["灰度中", "已暂停"].includes(item.status));
    const latestQualityWindow = state.assistantOnlineQualityWindows.slice().sort((left, right) => String(right.collectedAt).localeCompare(String(left.collectedAt)))[0];
    const healthyWindows = state.assistantOnlineQualityWindows.filter((item) => item.status === "健康");
    const openQualityIncidents = state.assistantQualityIncidents.filter((item) => item.status !== "已解决");
    const negativeFeedback = state.assistantFeedbackRecords.filter((item) => item.sentiment === "负向");
    return {
      activeSources: state.assistantKnowledgeSources.filter((item) => item.status === "已启用").length,
      knowledgeChunks: state.assistantKnowledgeSources.reduce((sum, item) => sum + Number(item.chunks || 0), 0),
      pendingKnowledgeVersions: state.assistantKnowledgeVersions.filter((item) => item.status !== "已发布").length,
      publishedKnowledgeVersions: state.assistantKnowledgeVersions.filter((item) => item.status === "已发布").length,
      pendingQuestions: pendingQuestions.length,
      averageConfidence: Math.round(state.standardQaRecords.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / Math.max(1, state.standardQaRecords.length)),
      retrievalPassRate: Math.round((sufficientTraces.length / Math.max(1, state.assistantRetrievalTraces.length)) * 100),
      unreviewedModelCalls: state.assistantModelCalls.filter((item) => item.reviewStatus !== "已复核").length,
      degradedModelCalls: state.assistantModelCalls.filter((item) => item.callStatus === "降级").length,
      publishedEvaluationSuites: state.assistantEvaluationSuites.filter((item) => item.status === "已发布").length,
      evaluationCaseCount: state.assistantEvaluationSuites.filter((item) => item.status === "已发布").reduce((sum, item) => sum + Number(item.caseCount || 0), 0),
      latestEvaluationScore: latestEvaluationRun?.score || 0,
      blockedReleases: state.assistantReleaseCandidates.filter((item) => item.gateStatus === "阻断" && item.status === "候选").length,
      activeReleaseVersion: activeRelease?.version || "未发布",
      activeCanaryDeployments: activeCanaryDeployments.length,
      currentCanaryTraffic: activeCanaryDeployments[0]?.trafficPercent || 0,
      onlineHealthyRate: Math.round((healthyWindows.length / Math.max(1, state.assistantOnlineQualityWindows.length)) * 100),
      latestOnlineStatus: latestQualityWindow?.status === "异常" && !openQualityIncidents.length ? "已恢复" : latestQualityWindow?.status || "未采集",
      openQualityIncidents: openQualityIncidents.length,
      negativeFeedback: negativeFeedback.length,
      pendingFeedbackReview: state.assistantFeedbackRecords.filter((item) => item.status === "待研判").length,
      pendingSampleLabeling: state.assistantImprovementSamples.filter((item) => item.status === "待标注").length,
      includedSamples: state.assistantImprovementSamples.filter((item) => item.status === "已入集" || item.status === "已验证").length,
      openImprovementCycles: state.assistantImprovementCycles.filter((item) => item.status !== "已完成").length,
      pendingExplanations: pendingExplanations.length,
      pendingSuggestions: pendingSuggestions.length,
      adoptedSuggestions: state.rectificationSuggestions.filter((item) => item.status === "已采纳").length,
      openRisks: openRisks.length,
      highRisks: openRisks.filter((item) => item.level === "高").length,
    };
  }

  function knowledgeVersionActionLabel(status) {
    return {
      草稿: "提交审批",
      待审批: "审批通过",
      已批准: "发布生效",
    }[status] || "已生效";
  }

  function assistantReleaseActionLabel(status, gateStatus) {
    if (gateStatus !== "通过") return "门禁阻断";
    return {
      候选: "提交审批",
      待审批: "发布上线",
      已发布: "已上线",
      历史版本: "历史版本",
      已回滚: "已回滚",
    }[status] || status;
  }

  function statusClass(status) {
    if (status === "已完成" || status === "已通过" || status === "已发布" || status === "已批准" || status === "已归档" || status === "已关闭" || status === "已解决" || status === "已就绪" || status === "已闭环" || status === "已启动" || status === "可启动" || status === "可推广" || status === "达标" || status === "通过" || status === "历史版本" || status === "启用" || status === "已启用" || status === "已采纳" || status === "已回答" || status === "已编辑" || status === "已转复核" || status === "已排除" || status === "复核通过" || status === "已校验" || status === "命中充分" || status === "成功" || status === "已复核" || status === "正常" || status === "稳定" || status === "健康" || status === "已恢复" || status === "已转样本" || status === "已入集" || status === "已验证" || status === "正向" || status === "已受理" || status === "联调完成" || status === "在线" || status === "有效" || status === "契约通过" || status === "映射就绪" || status === "脱敏通过" || status === "可上线" || status === "已准入" || status === "接收" || status === "可切换" || status === "已切换" || status === "已解除" || status === "已实现" || status === "已配置" || status === "已核验" || status === "同意" || status === "GO") return "";
    if (status === "进行中" || status === "处理中" || status === "推进中" || status === "关注" || status === "条件通过" || status === "分析完成" || status === "改进中" || status === "待验收" || status === "准备中" || status === "已确认" || status === "待确认" || status === "待采纳" || status === "待分派" || status === "待回复" || status === "待评估" || status === "待审批" || status === "待复核" || status === "需补充" || status === "人工复核" || status === "草稿" || status === "报名中" || status === "候选" || status === "已回滚" || status === "试运行" || status === "预归档" || status === "填报中" || status === "审核中" || status === "上传中" || status === "扫描中" || status === "排队中" || status === "预警" || status === "降级" || status === "灰度中" || status === "已暂停" || status === "开放" || status === "待研判" || status === "已研判" || status === "待标注" || status === "已标注" || status === "待回归" || status === "资料待补" || status === "联调中" || status === "待探测" || status === "待认证" || status === "待抽样" || status === "待完善" || status === "待处理" || status === "临期" || status === "待整改" || status === "执行中" || status === "等待回执" || status === "待核验" || status === "待处置" || status === "切换中" || status === "待配置" || status === "待上传" || status === "待签批") return "warn";
    if (status === "阻断" || status === "门禁阻断" || status === "有阻塞" || status === "有风险" || status === "需优化" || status === "未达标" || status === "逾期" || status === "高" || status === "紧急" || status === "异常" || status === "故障" || status === "失败" || status === "高负荷" || status === "高风险" || status === "拥堵" || status === "负向" || status === "失效" || status === "不通过" || status === "发现风险" || status === "已阻断" || status === "隔离中" || status === "拒绝" || status === "NO-GO") return "danger";
    return "warn";
  }

  function scoreSnapshot() {
    const submission = submissionForActive();
    const byDomain = domains.map((domain) => {
      const items = indicators.filter((indicator) => indicator.domain === domain.code);
      const sampleMax = items.reduce((sum, item) => sum + item.max, 0) || 1;
      const sampleScore = items.reduce((sum, item) => {
        const entry = submission[item.code];
        return sum + Number(entry?.reviewedScore ?? entry?.selfScore ?? 0);
      }, 0);
      const weightedScore = Math.round((sampleScore / sampleMax) * domain.weight);
      return {
        ...domain,
        sampleMax,
        sampleScore,
        weightedScore,
        ratio: weightedScore / domain.weight,
      };
    });
    const total = byDomain.reduce((sum, domain) => sum + domain.weightedScore, 0);
    const grade = total >= 900 ? "引领级" : total >= 800 ? "优秀级" : total >= 650 ? "提升级" : total >= 500 ? "基础级" : "整改级";
    return { byDomain, total, grade };
  }

  function buildDataPackage(kind) {
    const hospital = activeHospital();
    const submission = submissionForActive();
    const score = scoreSnapshot();
    const hospitalIssues = state.validationIssues.filter((issue) => issue.hospitalCode === state.selectedHospital);
    const hospitalReviewNotes = state.reviewNotes.filter((note) => note.hospitalCode === state.selectedHospital);
    const hospitalExpertReviews = state.expertReviews.filter((item) => item.hospitalCode === state.selectedHospital);
    const hospitalRectifications = state.rectifications.filter((item) => item.hospitalCode === state.selectedHospital);
    const hospitalEvidence = state.evidenceMaterials.filter((item) => item.hospitalCode === state.selectedHospital);
    const indicatorItems = indicators.map((indicator) => {
      const entry = submission[indicator.code] || {};
      return {
        indicatorCode: indicator.code,
        indicatorName: indicator.name,
        domain: indicator.domain,
        maxScore: indicator.max,
        selfScore: Number(entry.selfScore || 0),
        reviewedScore: entry.reviewedScore,
        evidenceCount: Number(entry.evidenceCount || 0),
        status: entry.status || "草稿",
        comment: entry.comment || "",
      };
    });
    const meta = {
      packageType: kind,
      generatedAt: new Date().toISOString(),
      taskId: state.task.id,
      taskName: state.task.name,
      standardVersion: state.task.standard,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      prototypeVersion: "mvp-0.21",
    };
    if (kind === "submission") {
      return {
        meta,
        task: state.task,
        hospitalProfile: hospital,
        metrics: state.metrics,
        indicators: indicatorItems,
        assignments: state.assignments.filter((item) => item.hospitalCode === state.selectedHospital),
        evidenceMaterials: hospitalEvidence,
        validationSummary: summarizeIssues(hospitalIssues),
      };
    }
    if (kind === "task") {
      return {
        meta,
        tasks: state.tasks,
        hospitals: state.hospitals,
        reviewAssignments: state.reviewAssignments,
        reminders: state.tasks.map((task) => ({ taskId: task.id, reminders: task.reminders, extensionRequests: task.extensionRequests })),
      };
    }
    if (kind === "evidence") {
      return {
        meta,
        evidenceSummary: evidenceSummary(),
        evidenceMaterials: hospitalEvidence,
        missingIndicators: indicators.filter((indicator) => !hospitalEvidence.some((item) => item.indicatorCode === indicator.code)).map((indicator) => indicator.code),
        exportApprovals: state.exportApprovals.filter((item) => item.scope === state.selectedHospital || item.scope === hospital.code),
      };
    }
    if (kind === "review") {
      return {
        meta,
        reviewStatus: {
          confirmed: state.confirmed,
          reviewedCount: indicatorItems.filter((item) => item.reviewedScore !== null).length,
          totalIndicators: indicatorItems.length,
        },
        reviewNotes: hospitalReviewNotes,
        expertReviews: hospitalExpertReviews,
        reviewedIndicators: indicatorItems.filter((item) => item.reviewedScore !== null),
        openIssues: hospitalIssues.filter((issue) => issue.status !== "resolved"),
      };
    }
    if (kind === "expert") {
      const expertCodes = new Set(hospitalExpertReviews.map((item) => item.indicatorCode));
      return {
        meta,
        expertReviewStatus: expertSummary(),
        expertReviews: hospitalExpertReviews,
        relatedReviewNotes: hospitalReviewNotes.filter((note) => expertCodes.has(note.indicatorCode)),
        relatedIndicators: indicatorItems.filter((item) => expertCodes.has(item.indicatorCode)),
        openIssues: hospitalIssues.filter((issue) => expertCodes.has(issue.indicatorCode) && issue.status !== "resolved"),
      };
    }
    if (kind === "rectification") {
      return {
        meta,
        scoreResult: {
          totalScore: score.total,
          grade: score.grade,
          domainScores: score.byDomain.map((domain) => ({
            domainCode: domain.code,
            domainName: domain.name,
            weightedScore: domain.weightedScore,
            weight: domain.weight,
          })),
        },
        rectifications: hospitalRectifications,
      };
    }
    if (kind === "operations") {
      return {
        meta,
        operationSummary: operationSummary(),
        operations: state.operations,
        openIssueSummary: summarizeIssues(hospitalIssues),
        hospitalScope: state.hospitals.map((item) => ({
          code: item.code,
          name: item.name,
          level: item.level,
          type: item.type,
          city: item.city,
        })),
      };
    }
    if (kind === "system") {
      return {
        meta,
        activeRole: activeRole(),
        roles: state.roles,
        users: state.users,
        exportApprovals: state.exportApprovals,
        systemParams: state.systemParams,
        auditLogs: state.auditLogs,
      };
    }
    if (kind === "analytics") {
      return {
        meta,
        analyticsSummary: analyticsSummary(),
        scoringRules: state.scoringRules,
        bottomLineRules: state.bottomLineRules,
        appeals: state.appeals,
      };
    }
    if (kind === "intelligence") {
      return {
        meta,
        intelligenceSummary: intelligenceSummary(),
        spotChecks: state.spotChecks,
        sandboxConfig: state.sandboxConfig,
        sandboxRuns: state.sandboxRuns,
        materialClassifications: state.materialClassifications,
        peerAnomalies: state.peerAnomalies,
        notifications: state.notifications,
        notificationChannels: state.notificationChannels,
        importJobs: state.importJobs,
      };
    }
    if (kind === "pilot") {
      return {
        meta,
        pilotSummary: pilotSummary(),
        submissionBatches: state.submissionBatches,
        uploadQueue: state.uploadQueue,
        reviewerWorkloads: state.reviewerWorkloads,
        dailyReports: state.dailyReports,
      };
    }
    if (kind === "monitoring") {
      return {
        meta,
        monitoringSummary: monitoringSummary(),
        serviceHealth: state.serviceHealth,
        interfaceHealth: state.interfaceHealth,
        jobQueues: state.jobQueues,
        storagePools: state.storagePools,
        alerts: state.monitoringAlerts,
      };
    }
    if (kind === "publicHealth") {
      return {
        meta,
        publicHealthSummary: publicHealthSummary(),
        publicHealthStatus: {
          endpointConnectivityReady: state.publicHealth.endpointConnectivityReady,
          continuousConnectivityReady: state.publicHealth.continuousConnectivityReady,
          productionReady: false,
          consecutiveCampaigns: state.publicHealth.consecutiveCampaigns,
          requiredConsecutiveCampaigns: state.publicHealth.requiredConsecutiveCampaigns,
          campaignChainLinksVerified: state.publicHealth.campaignChainLinksVerified,
          continuityBreak: state.publicHealth.continuityBreak,
        },
        publicHealthLanes: state.publicHealth.lanes,
        publicHealthCampaigns: state.publicHealth.campaigns,
        publicHealthIncidents: publicHealthExportRows(),
        publicHealthIncidentEvidence: state.publicHealth.incidentEvidence,
        publicHealthEvidenceActions: state.publicHealth.evidenceActions,
        publicHealthIncidentActions: state.publicHealth.incidentActions,
        productionBlockers: state.publicHealth.blockers,
        runtimeRoutes: {
          coordination: "/api/digital-hospital/public-health/coordination",
          incidents: "/api/digital-hospital/public-health/incidents",
          incidentActions: "/api/digital-hospital/public-health/incidents/:id/actions",
          incidentEvidence: "/api/digital-hospital/public-health/incidents/:id/evidence",
          evidenceActions: "/api/digital-hospital/public-health/evidence/:id/actions",
          incidentExport: "/api/digital-hospital/public-health/incidents/export",
        },
      };
    }
    if (kind === "collaboration") {
      return {
        meta,
        collaborationSummary: collaborationSummary(),
        hospitalReadiness: state.hospitalReadiness,
        pilotTickets: state.pilotTickets,
        trainingSessions: state.trainingSessions,
        pilotReleases: state.pilotReleases,
        pilotFeedback: state.pilotFeedback,
      };
    }
    if (kind === "integration") {
      return {
        meta,
        integrationSummary: integrationSummary(),
        pilotAccessApplications: state.pilotAccessApplications,
        pilotConnectors: state.pilotConnectors,
        pilotDataMappings: state.pilotDataMappings,
        pilotIntegrationTests: state.pilotIntegrationTests,
        pilotIntegrationIssues: state.pilotIntegrationIssues,
        pilotIntegrationGates: state.pilotIntegrationGates,
      };
    }
    if (kind === "execution") {
      return {
        meta,
        executionSummary: executionSummary(),
        integrationEnvironments: state.integrationEnvironments,
        credentialVaultEntries: state.credentialVaultEntries,
        integrationExecutionJobs: state.integrationExecutionJobs,
        integrationExecutionWorkers: state.integrationExecutionWorkers,
        integrationDeadLetters: state.integrationDeadLetters,
        integrationExecutionEvents: state.integrationExecutionEvents,
        integrationCallbackReceipts: state.integrationCallbackReceipts,
        integrationReplayEvents: state.integrationReplayEvents,
        integrationQuarantines: state.integrationQuarantines,
        integrationCutoverWindows: state.integrationCutoverWindows,
        productionRuntimeControls: state.productionRuntimeControls,
        cutoverEvidenceRequirements: state.cutoverEvidenceRequirements,
        productionCutoverApprovals: state.productionCutoverApprovals,
        productionGoNoGo: state.productionGoNoGo,
      };
    }
    if (kind === "assessment") {
      return {
        meta,
        assessmentSummary: assessmentSummary(),
        pilotOutcomeMetrics: state.pilotOutcomeMetrics,
        pilotHospitalOutcomes: state.pilotHospitalOutcomes,
        pilotIssueThemes: state.pilotIssueThemes,
        pilotImprovementPlans: state.pilotImprovementPlans,
        rolloutRegions: state.rolloutRegions,
        pilotAssessmentReports: state.pilotAssessmentReports,
      };
    }
    if (kind === "assistant") {
      return {
        meta,
        assistantSummary: assistantSummary(),
        assistantKnowledgeSources: state.assistantKnowledgeSources,
        assistantKnowledgeVersions: state.assistantKnowledgeVersions,
        standardQaRecords: state.standardQaRecords,
        assistantRetrievalTraces: state.assistantRetrievalTraces,
        assistantModelCalls: state.assistantModelCalls,
        assistantQualityGate: state.assistantQualityGate,
        assistantEvaluationSuites: state.assistantEvaluationSuites,
        assistantEvaluationRuns: state.assistantEvaluationRuns,
        assistantReleaseCandidates: state.assistantReleaseCandidates,
        assistantOnlineGuardrail: state.assistantOnlineGuardrail,
        assistantDeployments: state.assistantDeployments,
        assistantOnlineQualityWindows: state.assistantOnlineQualityWindows,
        assistantQualityIncidents: state.assistantQualityIncidents,
        assistantFeedbackRecords: state.assistantFeedbackRecords,
        assistantImprovementSamples: state.assistantImprovementSamples,
        assistantImprovementCycles: state.assistantImprovementCycles,
        anomalyExplanations: state.anomalyExplanations,
        rectificationSuggestions: state.rectificationSuggestions,
        reviewRiskSignals: state.reviewRiskSignals,
      };
    }
    return {
      meta,
      task: state.task,
      tasks: state.tasks,
      domains,
      indicators,
      hospitalProfile: hospital,
      metrics: state.metrics,
      assignments: state.assignments,
      evidenceMaterials: hospitalEvidence,
      submission: indicatorItems,
      validationIssues: hospitalIssues,
      reviewNotes: hospitalReviewNotes,
      expertReviews: hospitalExpertReviews,
      scoreResult: score,
      rectifications: hospitalRectifications,
      reviewAssignments: state.reviewAssignments,
      scoringRules: state.scoringRules,
      bottomLineRules: state.bottomLineRules,
      appeals: state.appeals,
      spotChecks: state.spotChecks,
      sandboxConfig: state.sandboxConfig,
      sandboxRuns: state.sandboxRuns,
      materialClassifications: state.materialClassifications,
      peerAnomalies: state.peerAnomalies,
      notifications: state.notifications,
      notificationChannels: state.notificationChannels,
      importJobs: state.importJobs,
      submissionBatches: state.submissionBatches,
      uploadQueue: state.uploadQueue,
      reviewerWorkloads: state.reviewerWorkloads,
      dailyReports: state.dailyReports,
      serviceHealth: state.serviceHealth,
      interfaceHealth: state.interfaceHealth,
      jobQueues: state.jobQueues,
      storagePools: state.storagePools,
      monitoringAlerts: state.monitoringAlerts,
      publicHealth: state.publicHealth,
      hospitalReadiness: state.hospitalReadiness,
      pilotTickets: state.pilotTickets,
      trainingSessions: state.trainingSessions,
      pilotReleases: state.pilotReleases,
      pilotFeedback: state.pilotFeedback,
      pilotAccessApplications: state.pilotAccessApplications,
      pilotConnectors: state.pilotConnectors,
      pilotDataMappings: state.pilotDataMappings,
      pilotIntegrationTests: state.pilotIntegrationTests,
      pilotIntegrationIssues: state.pilotIntegrationIssues,
      pilotIntegrationGates: state.pilotIntegrationGates,
      integrationEnvironments: state.integrationEnvironments,
      credentialVaultEntries: state.credentialVaultEntries,
      integrationExecutionJobs: state.integrationExecutionJobs,
      integrationExecutionWorkers: state.integrationExecutionWorkers,
      integrationDeadLetters: state.integrationDeadLetters,
      integrationExecutionEvents: state.integrationExecutionEvents,
      integrationCallbackReceipts: state.integrationCallbackReceipts,
      integrationReplayEvents: state.integrationReplayEvents,
      integrationQuarantines: state.integrationQuarantines,
      integrationCutoverWindows: state.integrationCutoverWindows,
      productionRuntimeControls: state.productionRuntimeControls,
      cutoverEvidenceRequirements: state.cutoverEvidenceRequirements,
      productionCutoverApprovals: state.productionCutoverApprovals,
      productionGoNoGo: state.productionGoNoGo,
      pilotOutcomeMetrics: state.pilotOutcomeMetrics,
      pilotHospitalOutcomes: state.pilotHospitalOutcomes,
      pilotIssueThemes: state.pilotIssueThemes,
      pilotImprovementPlans: state.pilotImprovementPlans,
      rolloutRegions: state.rolloutRegions,
      pilotAssessmentReports: state.pilotAssessmentReports,
      assistantKnowledgeSources: state.assistantKnowledgeSources,
      assistantKnowledgeVersions: state.assistantKnowledgeVersions,
      standardQaRecords: state.standardQaRecords,
      assistantRetrievalTraces: state.assistantRetrievalTraces,
      assistantModelCalls: state.assistantModelCalls,
      assistantQualityGate: state.assistantQualityGate,
      assistantEvaluationSuites: state.assistantEvaluationSuites,
      assistantEvaluationRuns: state.assistantEvaluationRuns,
      assistantReleaseCandidates: state.assistantReleaseCandidates,
      assistantOnlineGuardrail: state.assistantOnlineGuardrail,
      assistantDeployments: state.assistantDeployments,
      assistantOnlineQualityWindows: state.assistantOnlineQualityWindows,
      assistantQualityIncidents: state.assistantQualityIncidents,
      assistantFeedbackRecords: state.assistantFeedbackRecords,
      assistantImprovementSamples: state.assistantImprovementSamples,
      assistantImprovementCycles: state.assistantImprovementCycles,
      anomalyExplanations: state.anomalyExplanations,
      rectificationSuggestions: state.rectificationSuggestions,
      reviewRiskSignals: state.reviewRiskSignals,
      roles: state.roles,
      users: state.users,
      exportApprovals: state.exportApprovals,
      auditLogs: state.auditLogs,
      operations: state.operations,
    };
  }

  function summarizeIssues(issues) {
    return {
      total: issues.length,
      open: issues.filter((issue) => issue.status !== "resolved").length,
      blockers: issues.filter((issue) => issue.severity === "blocker" && issue.status !== "resolved").length,
      warnings: issues.filter((issue) => issue.severity !== "blocker" && issue.status !== "resolved").length,
    };
  }

  function packageKindLabel(kind) {
    return {
      submission: "医院申报包",
      task: "评价任务包",
      evidence: "证据材料包",
      review: "省级审核包",
      expert: "专家复核包",
      rectification: "整改闭环包",
      analytics: "统计分析包",
      intelligence: "智能监管包",
      pilot: "试点运营包",
      collaboration: "试点协同包",
      integration: "接入联调包",
      execution: "接入执行包",
      assessment: "试点评估包",
      assistant: "评价助手包",
      monitoring: "运营监控包",
      publicHealth: "公共卫生协同包",
      system: "系统权限包",
      operations: "运行监管包",
      full: "全量状态包",
    }[kind] || "数据包";
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function downloadJsonPackage(kind) {
    const payload = buildDataPackage(kind);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.selectedHospital}-${state.task.id}-${kind}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotice(`${packageKindLabel(kind)}已生成下载。`);
  }

  function publicHealthExportRows() {
    return filteredPublicHealthIncidents().map((item) => ({
      id: item.id,
      revision: Number(item.revision || 1),
      title: item.title,
      laneId: item.laneId,
      hospitalCode: item.hospitalCode,
      level: item.level,
      status: item.status,
      sla: publicHealthIncidentSla(item),
      escalation: item.escalation || null,
      owner: item.owner,
      source: item.source,
      discoveredAt: item.discoveredAt,
      dueAt: item.dueAt,
      professionalAssociation: publicHealthProfessionalAssociation(item),
      closureGate: publicHealthClosureGate(item),
      evidence: state.publicHealth.incidentEvidence
        .filter((evidence) => evidence.incidentId === item.id)
        .map((evidence) => ({
          id: evidence.id,
          evidenceType: evidence.evidenceType,
          referenceNo: evidence.referenceNo,
          summary: evidence.summary,
          digest: evidence.digest,
          status: evidence.status,
          submittedBy: evidence.submittedBy,
          submittedAt: evidence.submittedAt,
          reviewedBy: evidence.reviewedBy || "",
          reviewedAt: evidence.reviewedAt || "",
        })),
      latestAction: item.latestAction,
      submittedForReviewBy: item.submittedForReviewBy || "",
    }));
  }

  function safeCsvCell(value) {
    const raw = String(value ?? "");
    const protectedValue = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
    return `"${protectedValue.replace(/"/g, '""')}"`;
  }

  function downloadPublicHealthIncidentExport(format) {
    const rows = publicHealthExportRows();
    let content;
    let type;
    if (format === "csv") {
      const headers = [
        "事件编号", "事件标题", "业务通道", "医院代码", "级别", "状态", "SLA状态", "升级级别",
        "责任组", "发现时间", "处置时限", "专业事件编号", "交换运行编号", "回执状态", "可信探测", "专业证据包",
        "关闭证据状态", "关闭证据完成度", "最新处置",
      ];
      const values = rows.map((item) => [
        item.id,
        item.title,
        item.laneId,
        item.hospitalCode,
        item.level,
        item.status,
        item.sla.status,
        item.escalation?.level || "",
        item.owner,
        item.discoveredAt,
        item.dueAt,
        item.professionalAssociation.eventId || "",
        item.professionalAssociation.exchangeRunId || "",
        item.professionalAssociation.receiptStatus || "",
        item.professionalAssociation.probeStatus,
        item.professionalAssociation.evidencePacketId || "",
        item.closureGate.ready ? "可关闭" : "待补证",
        `${item.closureGate.accepted}/${item.closureGate.required}`,
        item.latestAction,
      ]);
      content = `\uFEFF${[headers, ...values].map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
      type = "text/csv;charset=utf-8";
    } else {
      content = JSON.stringify({
        generatedAt: new Date().toISOString(),
        productionReady: false,
        filters: {
          hospitalCode: workspace.dataset.publicHealthHospital || "全部",
          status: workspace.dataset.publicHealthStatus || "全部",
          level: workspace.dataset.publicHealthLevel || "全部",
          sla: workspace.dataset.publicHealthSla || "全部",
        },
        summary: publicHealthSummary(rows.map((row) => state.publicHealth.incidents.find((item) => item.id === row.id))),
        incidents: rows,
      }, null, 2);
      type = "application/json;charset=utf-8";
    }
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `digital-hospital-public-health-incidents.${format}`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showNotice(`已导出${rows.length}条公共卫生事件${format.toUpperCase()}清单。`);
  }

  function runValidationRules() {
    const submission = submissionForActive();
    const issues = [];
    indicators.forEach((indicator) => {
      const entry = submission[indicator.code];
      const score = Number(entry?.selfScore ?? 0);
      const evidenceCount = Number(entry?.evidenceCount ?? 0);
      if (score > indicator.max) {
        issues.push({
          id: `VAL-${indicator.code}-SCORE`,
          hospitalCode: state.selectedHospital,
          indicatorCode: indicator.code,
          type: "格式",
          severity: "blocker",
          status: "open",
          description: `自评分${score}超过指标满分${indicator.max}，需修正。`,
          suggestion: "将自评分调整到指标分值范围内。",
        });
      }
      if (score >= indicator.max * 0.6 && evidenceCount < 1) {
        issues.push({
          id: `VAL-${indicator.code}-EVIDENCE`,
          hospitalCode: state.selectedHospital,
          indicatorCode: indicator.code,
          type: "材料",
          severity: indicator.priority === "P0" ? "blocker" : "warning",
          status: "open",
          description: `${indicator.name}已申报得分，但缺少证据材料。`,
          suggestion: `补充${indicator.evidence}。`,
        });
      }
    });

    if (state.metrics.onlineAppointments > state.metrics.outpatientTotal) {
      issues.push({
        id: "VAL-D1-LOGIC",
        hospitalCode: state.selectedHospital,
        indicatorCode: "D1",
        type: "逻辑",
        severity: "blocker",
        status: "open",
        description: "线上预约量大于门诊总量，请核实统计周期和口径。",
        suggestion: "统一门诊总量和线上预约量统计周期。",
      });
    }

    const missingRate = state.metrics.dataTotal > 0 ? state.metrics.missingRecords / state.metrics.dataTotal : 0;
    if (missingRate > 0.01) {
      issues.push({
        id: "VAL-B5-MISSING",
        hospitalCode: state.selectedHospital,
        indicatorCode: "B5",
        type: "数据质量",
        severity: missingRate > 0.05 ? "blocker" : "warning",
        status: "open",
        description: `数据缺失率为${pct(missingRate, 2)}，超过试点建议阈值。`,
        suggestion: "提交数据质量整改说明，并补充月度质量报告。",
      });
    }

    const successRate = state.metrics.interfaceCalls > 0 ? state.metrics.interfaceSuccess / state.metrics.interfaceCalls : 0;
    if (successRate < 0.98) {
      issues.push({
        id: "VAL-B3-SUCCESS",
        hospitalCode: state.selectedHospital,
        indicatorCode: "B3",
        type: "接口",
        severity: "warning",
        status: "open",
        description: `接口成功率为${pct(successRate, 2)}，低于98%。`,
        suggestion: "核查接口失败原因，并提交稳定性改进说明。",
      });
    }

    state.validationIssues = state.validationIssues.filter((issue) => issue.hospitalCode !== state.selectedHospital).concat(issues);
    state.lastValidatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    saveState();
    showNotice(`已完成校验，发现${issues.length}个问题。`);
    render();
  }

  function activeIssues(includeResolved = false) {
    return state.validationIssues.filter((issue) => issue.hospitalCode === state.selectedHospital && (includeResolved || issue.status !== "resolved"));
  }

  function progressSnapshot() {
    const submission = submissionForActive();
    const total = indicators.length;
    const filled = indicators.filter((indicator) => Number(submission[indicator.code]?.selfScore ?? 0) > 0).length;
    const evidenceReady = indicators.filter((indicator) => Number(submission[indicator.code]?.evidenceCount ?? 0) > 0).length;
    const blockers = activeIssues().filter((issue) => issue.severity === "blocker").length;
    const reviewed = indicators.filter((indicator) => submission[indicator.code]?.reviewedScore !== null).length;
    return { total, filled, evidenceReady, blockers, reviewed };
  }

  function expertGroupForIndicator(indicator) {
    return (
      {
        B: "数据互联互通专家组",
        C: "智慧医疗专家组",
        D: "智慧服务专家组",
        F: "质量安全专家组",
        G: "创新应用专家组",
        H: "安全合规专家组",
      }[indicator.domain] || "综合评价专家组"
    );
  }

  function createExpertReview(code, reason = "") {
    const indicator = indicatorByCode(code);
    if (!indicator) return null;
    const existing = state.expertReviews.find(
      (item) => item.hospitalCode === state.selectedHospital && item.indicatorCode === code && item.status !== "已复核",
    );
    if (existing) return existing;
    const issueCount = activeIssues().filter((issue) => issue.indicatorCode === code).length;
    const review = {
      id: `EXP-${state.selectedHospital}-${code}-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      indicatorCode: code,
      submittedBy: "省级审核组",
      expertGroup: expertGroupForIndicator(indicator),
      priority: indicator.priority === "P0" || issueCount ? "高" : "中",
      status: "待复核",
      reason: reason || `${indicator.name}涉及关键指标或争议口径，需专家确认。`,
      suggestedScore: null,
      conclusion: "",
      submittedAt: nowText(),
      completedAt: "",
    };
    state.expertReviews.unshift(review);
    return review;
  }

  function autoCreateExpertReviews() {
    const submission = submissionForActive();
    const issueCodes = new Set(activeIssues().map((issue) => issue.indicatorCode));
    let created = 0;
    indicators.forEach((indicator) => {
      const entry = submission[indicator.code];
      const highScore = Number(entry?.selfScore || 0) >= indicator.max * 0.85;
      const needsReview = issueCodes.has(indicator.code) || entry?.status === "专家复核" || (indicator.priority === "P0" && highScore);
      if (!needsReview) return;
      const before = state.expertReviews.length;
      createExpertReview(indicator.code, issueCodes.has(indicator.code) ? "关联开放校验或审核问题，需专家复核。" : "关键指标高分申报，需抽样复核口径和证据。");
      if (state.expertReviews.length > before) created += 1;
    });
    saveState();
    showNotice(created ? `已生成${created}项专家复核任务。` : "暂无新的专家复核任务。");
    render();
  }

  function resolveExpertReview(id, resultType) {
    const review = state.expertReviews.find((item) => item.id === id);
    if (!review) return;
    const submission = submissionForHospital(review.hospitalCode);
    const entry = submission[review.indicatorCode];
    const indicator = indicatorByCode(review.indicatorCode);
    if (!entry || !indicator) return;
    const baseScore = Number(entry.reviewedScore ?? entry.selfScore ?? 0);
    let finalScore = baseScore;
    let noteStatus = "专家复核通过";
    if (resultType === "adjust") {
      const deduction = Math.max(1, Math.round(indicator.max * 0.12));
      finalScore = Math.max(0, baseScore - deduction);
      entry.reviewedScore = finalScore;
      entry.status = "专家调整";
      review.status = "已复核";
      review.resultType = "调整扣分";
      review.conclusion = `专家确认${indicator.name}证据支撑不足，建议由${baseScore}分调整为${finalScore}分。`;
      noteStatus = "专家调整";
    } else if (resultType === "supplement") {
      entry.reviewedScore = null;
      entry.status = "专家退回补证";
      review.status = "需补证";
      review.resultType = "要求补证";
      review.conclusion = `专家要求补充${indicator.evidence}，补证后重新提交复核。`;
      const issueId = `EXP-${review.id}-EVIDENCE`;
      if (!state.validationIssues.some((issue) => issue.id === issueId)) {
        state.validationIssues.push({
          id: issueId,
          hospitalCode: review.hospitalCode,
          indicatorCode: review.indicatorCode,
          type: "专家复核",
          severity: "warning",
          status: "open",
          description: `${indicator.name}经专家复核要求补充证据。`,
          suggestion: `补充${indicator.evidence}，并说明数据统计口径。`,
        });
      }
      noteStatus = "专家要求补证";
    } else {
      entry.reviewedScore = finalScore;
      entry.status = "专家复核通过";
      review.status = "已复核";
      review.resultType = "同意省审";
      review.conclusion = `专家同意当前审核意见，确认复核分${finalScore}分。`;
    }
    review.suggestedScore = resultType === "supplement" ? null : finalScore;
    review.completedAt = nowText();
    state.reviewNotes.unshift({
      id: `NOTE-${Date.now()}`,
      hospitalCode: review.hospitalCode,
      indicatorCode: review.indicatorCode,
      status: noteStatus,
      text: `${indicator.name}：${review.conclusion}`,
      at: nowText(),
    });
    state.confirmed = false;
    saveState();
    showNotice(`${review.indicatorCode} ${noteStatus}。`);
    render();
  }

  function showNotice(message) {
    notice.textContent = message;
    notice.classList.add("show");
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(() => notice.classList.remove("show"), 3600);
  }

  function setView(view) {
    state.activeView = view;
    saveState();
    render();
  }

  function header(title) {
    viewTitle.textContent = title;
    sideTaskName.textContent = state.task.name;
    sideTaskStatus.textContent = state.task.status;
  }

  function renderHospitalSelect() {
    hospitalSelect.innerHTML = state.hospitals.map((hospital) => `<option value="${hospital.code}">${hospital.name}</option>`).join("");
    hospitalSelect.value = state.selectedHospital;
  }

  function renderRoleSelect() {
    roleSelect.innerHTML = state.roles.map((role) => `<option value="${role.name}">${role.name}</option>`).join("");
    roleSelect.value = state.activeRole;
  }

  function renderNav() {
    document.querySelectorAll(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.view === state.activeView);
    });
  }

  function metric(label, value, helper, modifier = "") {
    return `<article class="metric ${modifier}"><span>${label}</span><strong>${value}</strong><small>${helper}</small></article>`;
  }

  function renderDashboard() {
    header("总览");
    const score = scoreSnapshot();
    const progress = progressSnapshot();
    const issues = activeIssues();
    const expert = expertSummary();
    const reviewedRate = progress.total ? progress.reviewed / progress.total : 0;
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("综合预判", `${score.total}分`, `等级：${score.grade}`)}
        ${metric("申报进度", `${progress.filled}/${progress.total}`, `材料覆盖：${progress.evidenceReady}/${progress.total}`)}
        ${metric("阻断问题", progress.blockers, issues.length ? `总问题：${issues.length}` : "暂无待处理问题", progress.blockers ? "danger" : "")}
        ${metric("审核完成", pct(reviewedRate, 0), `已审核指标：${progress.reviewed}`)}
      </div>

      <section class="panel chart-band">
        <div>
          <div class="panel-header">
            <div>
              <h3 class="panel-title">八大指标域得分</h3>
              <p class="panel-subtitle">按样例指标映射到1000分权重，实时反映填报和审核状态。</p>
            </div>
            <span class="status-pill">${activeHospital().level} ${activeHospital().type}</span>
          </div>
          <div class="bar-stack">
            ${score.byDomain
              .map(
                (domain) => `
              <div class="bar-row">
                <span>${domain.code} ${domain.name}</span>
                <div class="bar-track" aria-label="${domain.name}得分进度">
                  <div class="bar-fill" style="width:${Math.min(100, Math.round(domain.ratio * 100))}%"></div>
                </div>
                <strong>${domain.weightedScore}</strong>
              </div>
            `,
              )
              .join("")}
          </div>
        </div>
        <div class="ring" style="--scoreDeg:${Math.min(360, score.total * 0.36)}deg">
          <div>
            <strong>${score.total}</strong>
            <span>综合分</span>
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">评价闭环</h3>
            <p class="panel-subtitle">当前任务从医院申报推进到专家复核、评分整改和归档运行的主流程状态。</p>
          </div>
          <button class="button secondary" type="button" data-action="run-validation">运行校验</button>
        </div>
        <div class="flow">
          ${flowStep("医院画像", true, `${activeHospital().city} ${activeHospital().owner}`)}
          ${flowStep("指标自评", progress.filled === progress.total, `${progress.filled}/${progress.total}已填`)}
          ${flowStep("数据校验", !!state.lastValidatedAt, state.lastValidatedAt || "未运行")}
          ${flowStep("省级审核", progress.reviewed > 0, `${progress.reviewed}/${progress.total}已审`)}
          ${flowStep("专家复核", expert.pending === 0 && expert.total > 0, expert.total ? `${expert.pending}待复核/${expert.total}项` : "未提交复核")}
          ${flowStep("结果确认", state.confirmed, state.confirmed ? "已确认" : "待确认")}
          ${flowStep("整改闭环", state.rectifications.length > 0, `${state.rectifications.length}项整改`)}
        </div>
      </section>
    `;
  }

  function flowStep(label, done, helper) {
    const active = !done && (label === "数据校验" || label === "省级审核" || label === "专家复核");
    return `<div class="flow-step ${done ? "done" : active ? "active" : ""}"><strong>${label}</strong><span>${helper}</span></div>`;
  }

  function renderTasks() {
    header("任务管理");
    const summary = taskSummary();
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("当前任务", summary.activeTask.name, summary.activeTask.status)}
        ${metric("参评医院", summary.totalHospitals, summary.activeTask.scope)}
        ${metric("审核分派", summary.reviewAssigned, "已分派审核任务")}
        ${metric("催办/延期", `${summary.reminders}/${summary.extensions}`, "催办记录/延期申请")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">评价任务台账</h3>
            <p class="panel-subtitle">支持年度评价、专项评价、试点评价的创建、范围配置、节点管理和催办延期。</p>
          </div>
          <div class="toolbar inline">
            <button class="button secondary" type="button" data-action="create-task">创建专项任务</button>
            <button class="button ghost" type="button" data-action="send-reminder">发送催办</button>
            <button class="button ghost" type="button" data-action="approve-extension">审批延期</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>任务</th><th>类型</th><th>范围</th><th>状态</th><th>提交截止</th><th>审核截止</th><th>提醒</th></tr></thead>
            <tbody>
              ${state.tasks
                .map(
                  (task) => `
                    <tr>
                      <td><strong>${task.name}</strong><br><span class="muted-text">${task.id} | ${task.standard}</span></td>
                      <td>${task.type}</td>
                      <td>${task.scope}<br>${task.hospitals.length}家机构</td>
                      <td><span class="status-pill ${statusClass(task.status)}">${task.status}</span></td>
                      <td>${task.submitDue}</td>
                      <td>${task.reviewDue}</td>
                      <td>${task.reminders}次催办 / ${task.extensionRequests}个延期</td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">医院范围与进度</h3>
            <p class="panel-subtitle">按医院等级、类别和任务状态查看省级承接范围。</p>
          </div>
          <span class="tag">${activeRole().dataScope}</span>
        </div>
        <div class="detail-list compact-list">
          ${state.hospitals
            .map((hospital) => {
              const assignment = state.reviewAssignments.find((item) => item.hospitalCode === hospital.code);
              return `
                <article class="detail-item">
                  <header>
                    <div>
                      <h4>${hospital.name}</h4>
                      <p>${hospital.level} ${hospital.type} | ${hospital.city} | 联系人：${hospital.contact}</p>
                    </div>
                    <span class="risk ${assignment?.risk === "高" ? "blocker" : "warn"}">${assignment?.risk || "低"}风险</span>
                  </header>
                  <p>任务状态：${assignment?.status || "待填报"}；审核员：${assignment?.reviewer || "未分派"}；材料缺失：${assignment?.materialMissing || 0}</p>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderPilot() {
    header("试点运营");
    const tab = workspace.dataset.pilotTab || "batches";
    const summary = pilotSummary();
    const latest = summary.latestReport;
    const tabs = [
      { id: "batches", label: "申报批次" },
      { id: "uploads", label: "上传队列" },
      { id: "workload", label: "审核负荷" },
      { id: "reports", label: "运行日报" },
    ];
    let content = "";

    if (tab === "batches") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">申报批次配置</h3>
              <p class="panel-subtitle">按地区、医院等级、标准版本和业务节点配置试点申报批次。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="create-pilot-batch">新建验证批次</button>
              <button class="button ghost" type="button" data-action="publish-pilot-batch">发布待办批次</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>批次</th><th>范围</th><th>标准版本</th><th>医院数</th><th>申报进度</th><th>状态</th><th>提交截止</th><th>审核截止</th><th>责任组</th></tr></thead>
              <tbody>
                ${state.submissionBatches
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.region}<br /><span class="muted-text">${item.hospitalLevel}</span></td>
                        <td>${item.standard}</td>
                        <td>${item.hospitalCount}</td>
                        <td>
                          <div class="queue-progress"><span style="width:${Math.round((item.submitted / Math.max(1, item.hospitalCount)) * 100)}%"></span></div>
                          <small>${item.submitted}/${item.hospitalCount}已提交 · ${item.reviewed}已审核</small>
                        </td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.submitDue}</td>
                        <td>${item.reviewDue}</td>
                        <td>${item.owner}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "uploads") {
      content = `
        <div class="grid-4">
          ${metric("队列总数", state.uploadQueue.length, "材料上传任务")}
          ${metric("处理中", summary.activeUploads, "上传、扫描或失败")}
          ${metric("失败任务", summary.failedUploads, "支持断点续传", summary.failedUploads ? "danger" : "")}
          ${metric("完成率", pct(state.uploadQueue.filter((item) => item.status === "已完成").length / Math.max(1, state.uploadQueue.length)), "扫描与分类完成")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">材料上传队列</h3>
              <p class="panel-subtitle">跟踪分片上传、病毒扫描、敏感内容识别和材料分类。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="enqueue-upload">加入上传任务</button>
              <button class="button ghost" type="button" data-action="advance-upload">推进队列</button>
              <button class="button ghost" type="button" data-action="retry-upload">重试失败任务</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>任务</th><th>医院</th><th>文件</th><th>类型/大小</th><th>进度</th><th>安全扫描</th><th>材料分类</th><th>状态</th><th>重试</th></tr></thead>
              <tbody>
                ${state.uploadQueue
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.id}<br /><span class="muted-text">${item.submittedAt}</span></td>
                        <td>${item.hospitalName}</td>
                        <td><strong>${item.fileName}</strong></td>
                        <td>${item.materialType}<br /><span class="muted-text">${item.size}</span></td>
                        <td><div class="queue-progress"><span style="width:${item.progress}%"></span></div><small>${item.progress}%</small></td>
                        <td>${item.scanStatus}</td>
                        <td>${item.classification}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.retries}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "workload") {
      const totalAssigned = state.reviewerWorkloads.reduce((sum, item) => sum + item.assigned, 0);
      const totalCapacity = state.reviewerWorkloads.reduce((sum, item) => sum + item.capacity, 0);
      content = `
        <div class="grid-4">
          ${metric("审核任务", totalAssigned, `总容量 ${totalCapacity}`)}
          ${metric("整体负荷", pct(totalAssigned / Math.max(1, totalCapacity)), "按当前分派任务")}
          ${metric("高负荷人员", summary.highLoadReviewers, "建议自动均衡", summary.highLoadReviewers ? "danger" : "")}
          ${metric("逾期任务", summary.overdueReviews, "需优先处理", summary.overdueReviews ? "danger" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">审核负荷监控</h3>
              <p class="panel-subtitle">综合容量、在审、逾期和高风险任务监控审核组负荷。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="balance-workload">自动均衡负荷</button>
              <button class="button ghost" type="button" data-action="assign-urgent-review">分派紧急任务</button>
            </div>
          </div>
          <div class="workload-grid">
            ${state.reviewerWorkloads
              .map((item) => {
                const utilization = Math.round((item.assigned / Math.max(1, item.capacity)) * 100);
                return `
                  <article class="workload-card">
                    <header><div><strong>${item.reviewer}</strong><span>${item.group}</span></div><span class="status-pill ${item.status === "高负荷" ? "danger" : ""}">${item.status}</span></header>
                    <div class="queue-progress"><span style="width:${Math.min(100, utilization)}%"></span></div>
                    <p>${item.assigned}/${item.capacity}项 · 在审${item.inProgress} · 逾期${item.overdue} · 高风险${item.highRisk}</p>
                    <small>平均处理 ${item.avgHours}小时</small>
                  </article>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    }

    if (tab === "reports") {
      content = `
        <div class="grid-4">
          ${metric("参评覆盖", `${latest.coverage}家`, latest.batchId)}
          ${metric("医院提交", `${latest.submitted}家`, `提交率 ${latest.submissionRate}%`)}
          ${metric("阻断问题", latest.validationBlockers, "待医院补正", latest.validationBlockers ? "danger" : "")}
          ${metric("待审任务", latest.pendingReviews, `抽查${latest.spotChecks} · 整改${latest.rectifications}`)}
        </div>
        <section class="panel report-band">
          <div>
            <span class="tag">${latest.date} · ${latest.status}</span>
            <h3>试点运行日报</h3>
            <p>${latest.summary}</p>
          </div>
          <div class="report-actions">
            <button class="button secondary" type="button" data-action="generate-daily-report">生成今日日报</button>
            <button class="button ghost" type="button" data-action="publish-daily-report">发布最新日报</button>
          </div>
        </section>
        <div class="grid-3">
          <article class="panel"><h3 class="panel-title">材料运行</h3><p class="report-number">${fmt(latest.materials)}</p><span class="muted-text">材料总量 · ${latest.uploadPending}项队列待处理</span></article>
          <article class="panel"><h3 class="panel-title">审核运行</h3><p class="report-number">${latest.pendingReviews}</p><span class="muted-text">待审核 · ${summary.overdueReviews}项逾期</span></article>
          <article class="panel"><h3 class="panel-title">运行事件</h3><p class="report-number">${latest.incidents}</p><span class="muted-text">上传失败、高负荷或服务异常</span></article>
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">日报历史</h3>
              <p class="panel-subtitle">日报生成、发布和关键指标变化均进入运行审计。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>批次</th><th>提交率</th><th>材料</th><th>阻断</th><th>待审核</th><th>抽查/整改</th><th>事件</th><th>状态</th><th>生成时间</th></tr></thead>
              <tbody>
                ${state.dailyReports
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.date}</strong></td>
                        <td>${item.batchId}</td>
                        <td>${item.submissionRate}%</td>
                        <td>${item.materials}</td>
                        <td>${item.validationBlockers}</td>
                        <td>${item.pendingReviews}</td>
                        <td>${item.spotChecks}/${item.rectifications}</td>
                        <td>${item.incidents}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.generatedAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("当前批次", summary.activeBatch?.name || "-", summary.activeBatch?.status || "未配置")}
        ${metric("申报进度", pct(summary.submissionRate), `${summary.submitted}/${summary.activeBatch?.hospitalCount || 0}家已提交`)}
        ${metric("材料队列", summary.activeUploads, `${summary.failedUploads}项失败`, summary.failedUploads ? "danger" : "")}
        ${metric("审核风险", summary.highLoadReviewers + summary.overdueReviews, "高负荷人员与逾期任务", summary.highLoadReviewers + summary.overdueReviews ? "danger" : "")}
      </div>
      <div class="segmented pilot-tabs" role="tablist" aria-label="试点运营功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-pilot-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderCollaboration() {
    header("试点协同");
    const tab = workspace.dataset.collaborationTab || "readiness";
    const summary = collaborationSummary();
    const tabs = [
      { id: "readiness", label: "医院准备度" },
      { id: "tickets", label: "问题工单" },
      { id: "training", label: "培训答疑" },
      { id: "releases", label: "版本反馈" },
    ];
    let content = "";

    if (tab === "readiness") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点医院准备度</h3>
              <p class="panel-subtitle">按组织、账号、网络、数据映射和培训五个维度跟踪上线准备情况。</p>
            </div>
            <button class="button secondary" type="button" data-action="refresh-readiness">重新评估</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>医院</th><th>协调人</th><th>组织</th><th>账号</th><th>网络</th><th>数据映射</th><th>培训</th><th>综合准备度</th><th>阻塞项</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.hospitalReadiness
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.hospitalName}</strong><br /><span class="muted-text">${item.hospitalCode}</span></td>
                        <td>${item.coordinator}</td>
                        <td>${item.organization}%</td>
                        <td>${item.accounts}%</td>
                        <td>${item.network}%</td>
                        <td>${item.dataMapping}%</td>
                        <td>${item.training}%</td>
                        <td><div class="queue-progress"><span style="width:${item.readiness}%"></span></div><small>${item.readiness}%</small></td>
                        <td>${item.blockers}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="resolve-readiness-blocker" data-id="${item.id}" ${item.blockers ? "" : "disabled"}>推进阻塞项</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "tickets") {
      content = `
        <div class="grid-4">
          ${metric("开放工单", summary.openTickets, "待分派、处理中或待回复")}
          ${metric("高优先级", summary.urgentTickets, "紧急与高优先级", summary.urgentTickets ? "danger" : "")}
          ${metric("待分派", summary.unassignedTickets, "需明确责任组", summary.unassignedTickets ? "danger" : "")}
          ${metric("解决率", pct(state.pilotTickets.filter((item) => item.status === "已解决").length / Math.max(1, state.pilotTickets.length)), "全部试点问题")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点问题工单</h3>
              <p class="panel-subtitle">统一受理指标口径、数据模板、材料上传、账号权限和接口联调问题。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="create-pilot-ticket">登记问题</button>
              <button class="button ghost" type="button" data-action="assign-pilot-tickets">自动分派</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>工单</th><th>医院</th><th>分类</th><th>优先级</th><th>责任组</th><th>SLA</th><th>渠道</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotTickets
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id} · ${item.createdAt}</span><br /><small>${item.description}</small></td>
                        <td>${item.hospitalName}</td>
                        <td>${item.category}</td>
                        <td><span class="status-pill ${statusClass(item.priority)}">${item.priority}</span></td>
                        <td>${item.owner}</td>
                        <td>${item.elapsedHours}/${item.slaHours}小时<br /><span class="muted-text">截止 ${item.dueAt}</span></td>
                        <td>${item.channel}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="advance-pilot-ticket" data-id="${item.id}" ${item.status === "已解决" ? "disabled" : ""}>推进</button><button class="button ghost" type="button" data-action="escalate-pilot-ticket" data-id="${item.id}" ${item.status === "已解决" ? "disabled" : ""}>升级</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "training") {
      content = `
        <div class="grid-4">
          ${metric("待办场次", summary.upcomingTraining, "已发布、报名中或待发布")}
          ${metric("报名人数", summary.enrolled, "待办培训累计")}
          ${metric("已完成场次", state.trainingSessions.filter((item) => item.status === "已完成").length, "签到和问答已归档")}
          ${metric("开放问题", state.trainingSessions.filter((item) => item.status !== "已完成").reduce((sum, item) => sum + item.questions, 0), "培训前收集")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">培训与集中答疑</h3>
              <p class="panel-subtitle">面向医院管理员、填报员、接口管理员和审核人员组织分角色培训。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="create-training-session">新建场次</button>
              <button class="button ghost" type="button" data-action="publish-training-session">发布待办场次</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>培训主题</th><th>对象</th><th>时间/方式</th><th>容量</th><th>报名</th><th>签到</th><th>问题</th><th>材料</th><th>责任组</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.trainingSessions
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.audience}</td>
                        <td>${item.startAt}<br /><span class="muted-text">${item.mode}</span></td>
                        <td>${item.capacity}</td>
                        <td>${item.enrolled}</td>
                        <td>${item.attended}</td>
                        <td>${item.questions}</td>
                        <td>${item.materials}份</td>
                        <td>${item.owner}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="record-training-attendance" data-id="${item.id}" ${item.status === "已完成" ? "disabled" : ""}>签到</button><button class="button ghost" type="button" data-action="complete-training-session" data-id="${item.id}" ${item.status === "已完成" ? "disabled" : ""}>完成</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "releases") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点版本发布</h3>
              <p class="panel-subtitle">管理候选版本、验证范围、变更数量和发布反馈。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="create-pilot-release">新建候选版本</button>
              <button class="button ghost" type="button" data-action="publish-pilot-release">发布候选版本</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>版本</th><th>主题</th><th>验证范围</th><th>变更数</th><th>反馈</th><th>开放反馈</th><th>计划时间</th><th>发布时间</th><th>责任组</th><th>状态</th></tr></thead>
              <tbody>
                ${state.pilotReleases
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.version}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.title}</td>
                        <td>${item.scope}</td>
                        <td>${item.changes}</td>
                        <td>${item.feedbackCount}</td>
                        <td>${item.openFeedback}</td>
                        <td>${item.plannedAt}</td>
                        <td>${item.publishedAt || "-"}</td>
                        <td>${item.owner}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点反馈台账</h3>
              <p class="panel-subtitle">将医院反馈关联到具体版本，跟踪评估、处理和解决结论。</p>
            </div>
            <button class="button secondary" type="button" data-action="collect-pilot-feedback">模拟收集反馈</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>反馈</th><th>版本</th><th>医院</th><th>类型</th><th>优先级</th><th>责任组</th><th>状态</th><th>处理结论</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotFeedback
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id} · ${item.createdAt}</span></td>
                        <td>${item.releaseId}</td>
                        <td>${item.hospitalName}</td>
                        <td>${item.type}</td>
                        <td><span class="status-pill ${statusClass(item.priority)}">${item.priority}</span></td>
                        <td>${item.owner}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.resolution || "-"}</td>
                        <td><button class="button ghost" type="button" data-action="resolve-pilot-feedback" data-id="${item.id}" ${item.status === "已解决" ? "disabled" : ""}>解决</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("平均准备度", `${summary.averageReadiness}%`, `${summary.readyHospitals}/${state.hospitalReadiness.length}家已就绪`)}
        ${metric("医院阻塞", summary.totalBlockers, `${summary.blockedHospitals}家存在阻塞`, summary.blockedHospitals ? "danger" : "")}
        ${metric("开放工单", summary.openTickets, `${summary.urgentTickets}项高优先级`, summary.urgentTickets ? "danger" : "")}
        ${metric("版本反馈", summary.openFeedback, `最新 ${summary.latestRelease?.version || "-"}`, summary.openFeedback ? "danger" : "")}
      </div>
      <div class="segmented collaboration-tabs" role="tablist" aria-label="试点协同功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-collaboration-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function accessApplicationActionLabel(status) {
    return {
      资料待补: "补齐并受理",
      已受理: "启动联调",
      联调中: "确认联调完成",
      联调完成: "已完成",
    }[status] || "推进";
  }

  function renderIntegration() {
    header("接入联调");
    const tab = workspace.dataset.integrationTab || "access";
    const summary = integrationSummary();
    const tabs = [
      { id: "access", label: "接入与认证" },
      { id: "mapping", label: "数据与测试" },
      { id: "gate", label: "问题与准入" },
    ];
    let content = "";

    if (tab === "access") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">医院接入申请</h3>
              <p class="panel-subtitle">统一受理接入范围、网络区域、资料完整性与计划联调窗口。</p>
            </div>
            <button class="button ghost" type="button" data-action="download-package" data-kind="integration">下载联调包</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>医院</th><th>协调人</th><th>接入方式</th><th>网络区域</th><th>资料</th><th>联调窗口</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotAccessApplications
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.hospitalName}</strong><br /><span class="muted-text">${item.hospitalCode}</span></td>
                        <td>${item.coordinator}</td>
                        <td>${item.sourceMode}</td>
                        <td>${item.networkZone}</td>
                        <td>${item.materials}/${item.requiredMaterials}</td>
                        <td>${item.targetWindow}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.lastUpdated}</td>
                        <td><button class="button ghost" type="button" data-action="advance-access-application" data-id="${item.id}" ${item.status === "联调完成" ? "disabled" : ""}>${accessApplicationActionLabel(item.status)}</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">源系统连接器与凭据</h3>
              <p class="panel-subtitle">凭据只展示状态和到期日；连通探测、契约认证与轮换操作全部留痕。</p>
            </div>
            <span class="tag">${summary.readyConnectors}/${state.pilotConnectors.length}个连接器就绪</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>连接器</th><th>医院/源系统</th><th>传输与认证</th><th>凭据</th><th>连通性</th><th>契约</th><th>最近探测</th><th>责任组</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotConnectors
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.endpointAlias}</span></td>
                        <td>${item.hospitalName}<br /><span class="muted-text">${item.sourceSystem} · ${item.profile}</span></td>
                        <td>${item.transport}<br /><span class="muted-text">${item.authMode}</span></td>
                        <td><span class="status-pill ${statusClass(item.credentialStatus)}">${item.credentialStatus}</span><br /><span class="muted-text">${item.credentialExpireAt}</span></td>
                        <td><span class="status-pill ${statusClass(item.connectivityStatus)}">${item.connectivityStatus}</span>${item.latencyMs ? `<br /><span class="muted-text">${item.latencyMs}ms</span>` : ""}</td>
                        <td><span class="status-pill ${statusClass(item.contractStatus)}">${item.contractStatus}</span></td>
                        <td>${item.lastProbeAt}</td>
                        <td>${item.owner}</td>
                        <td>
                          <div class="toolbar inline">
                            <button class="button ghost" type="button" data-action="probe-pilot-connector" data-id="${item.id}">探测</button>
                            <button class="button ghost" type="button" data-action="rotate-pilot-credential" data-id="${item.id}">轮换</button>
                            <button class="button secondary" type="button" data-action="run-contract-certification" data-id="${item.id}">认证</button>
                          </div>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "mapping") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">数据映射与脱敏抽样</h3>
              <p class="panel-subtitle">按数据集核对必填字段、转换规则、覆盖率和个人信息去标识化结果。</p>
            </div>
            <span class="tag">${summary.readyMappings}/${state.pilotDataMappings.length}个数据集就绪</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>数据集</th><th>医院/连接器</th><th>源字段</th><th>已映射/必填</th><th>转换规则</th><th>覆盖率</th><th>隐私抽样</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotDataMappings
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.dataset}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.hospitalCode}<br /><span class="muted-text">${item.connectorId}</span></td>
                        <td>${item.sourceFields}</td>
                        <td>${item.mappedFields}/${item.requiredFields}</td>
                        <td>${item.transformRules}</td>
                        <td><strong>${item.coverage}%</strong></td>
                        <td><span class="status-pill ${statusClass(item.privacyCheck)}">${item.privacyCheck}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button secondary" type="button" data-action="run-sample-validation" data-id="${item.id}">映射校验</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">认证测试记录</h3>
              <p class="panel-subtitle">保存契约、字段映射与脱敏抽样的用例结果，并关联证据材料。</p>
            </div>
            <span class="tag">${state.pilotIntegrationTests.length}次执行</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>测试编号</th><th>医院/连接器</th><th>测试套件</th><th>用例</th><th>通过</th><th>失败</th><th>隐私发现</th><th>证据</th><th>状态</th><th>执行时间</th></tr></thead>
              <tbody>
                ${state.pilotIntegrationTests
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong></td>
                        <td>${item.hospitalCode}<br /><span class="muted-text">${item.connectorId}</span></td>
                        <td>${item.suite}</td>
                        <td>${item.cases}</td>
                        <td>${item.passed}</td>
                        <td>${item.failed}</td>
                        <td>${item.privacyFindings}</td>
                        <td>${item.evidenceId}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.runAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "gate") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">联调问题处置</h3>
              <p class="panel-subtitle">阻断和高风险问题必须关闭后，医院才能进入上线准入评估。</p>
            </div>
            <span class="status-pill ${summary.criticalIssues ? "danger" : ""}">${summary.criticalIssues}项关键问题</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>问题</th><th>医院/连接器</th><th>类别</th><th>级别</th><th>责任组</th><th>期限</th><th>状态</th><th>处置结论</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotIntegrationIssues
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.summary}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.hospitalCode}<br /><span class="muted-text">${item.connectorId}</span></td>
                        <td>${item.category}</td>
                        <td><span class="status-pill ${statusClass(item.severity)}">${item.severity}</span></td>
                        <td>${item.owner}</td>
                        <td>${item.dueAt}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.resolution || "-"}</td>
                        <td><button class="button ghost" type="button" data-action="resolve-integration-issue" data-id="${item.id}" ${item.status === "已关闭" ? "disabled" : ""}>关闭问题</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">上线准入门禁</h3>
              <p class="panel-subtitle">自动汇总连接器、映射、关键问题和双重审核，满足条件后由授权角色批准上线。</p>
            </div>
            <span class="tag">${summary.launchReadyHospitals}/${state.pilotIntegrationGates.length}家可上线或已准入</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>医院</th><th>连接器</th><th>数据映射</th><th>关键问题</th><th>安全复核</th><th>业务复核</th><th>门禁状态</th><th>评估时间</th><th>批准记录</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotIntegrationGates
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.hospitalName}</strong><br /><span class="muted-text">${item.hospitalCode}</span></td>
                        <td>${item.readyConnectors}/${item.requiredConnectors}</td>
                        <td>${item.readyMappings}/${item.requiredMappings}</td>
                        <td>${item.openCriticalIssues}</td>
                        <td><span class="status-pill ${statusClass(item.securityReview)}">${item.securityReview}</span></td>
                        <td><span class="status-pill ${statusClass(item.businessReview)}">${item.businessReview}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.evaluatedAt || "-"}</td>
                        <td>${item.approvedBy ? `${item.approvedBy}<br /><span class="muted-text">${item.approvedAt}</span>` : "-"}</td>
                        <td>
                          <div class="toolbar inline">
                            <button class="button ghost" type="button" data-action="evaluate-integration-gate" data-id="${item.hospitalCode}">评估</button>
                            <button class="button secondary" type="button" data-action="approve-integration-gate" data-id="${item.hospitalCode}" ${item.status === "已准入" ? "disabled" : ""}>批准上线</button>
                          </div>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("接入申请", summary.activeApplications, `${summary.completedApplications}家已完成联调`)}
        ${metric("连接器就绪率", pct(summary.connectorPassRate), `${summary.readyConnectors}/${state.pilotConnectors.length}个通过认证`, summary.connectorPassRate < 0.75 ? "warn" : "")}
        ${metric("数据映射通过率", pct(summary.mappingPassRate), `${summary.readyMappings}/${state.pilotDataMappings.length}个完成脱敏抽样`, summary.mappingPassRate < 0.75 ? "warn" : "")}
        ${metric("关键联调问题", summary.criticalIssues, `${summary.openIssues}项问题开放`, summary.criticalIssues ? "danger" : "")}
      </div>
      <div class="segmented integration-tabs" role="tablist" aria-label="接入联调功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-integration-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function executionJobActionLabel(status) {
    return {
      排队中: "开始执行",
      执行中: "等待回执",
      等待重试: "到期重试",
      等待回执: "核验回执",
      成功: "已完成",
      阻断: "已阻断",
      死信: "待复核",
    }[status] || "推进";
  }

  function renderExecution() {
    header("接入执行");
    const tab = workspace.dataset.executionTab || "runtime";
    const summary = executionSummary();
    const tabs = [
      { id: "runtime", label: "任务运行中心" },
      { id: "environment", label: "环境与凭据" },
      { id: "jobs", label: "任务与回执" },
      { id: "cutover", label: "隔离与切换" },
      { id: "production", label: "投产证据" },
    ];
    let content = "";

    if (tab === "runtime") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">Worker运行池</h3>
              <p class="panel-subtitle">Worker按能力领取任务并持有短租约；心跳中断后任务自动回收，租约令牌只在领取时返回，平台状态仅保留摘要。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="dispatch-execution-job">调度下一任务</button>
              <button class="button ghost" type="button" data-action="recover-execution-leases">回收超时租约</button>
            </div>
          </div>
          <div class="grid-4 compact-metrics">
            ${metric("可用Worker", summary.readyWorkers, `${summary.busyWorkers}个忙碌`)}
            ${metric("等待调度", state.integrationExecutionJobs.filter((item) => ["排队中", "等待重试"].includes(item.status)).length, `${summary.retryScheduledJobs}个等待重试`, summary.retryScheduledJobs ? "warn" : "")}
            ${metric("运行任务", state.integrationExecutionJobs.filter((item) => item.status === "执行中").length, "60秒租约与心跳续期")}
            ${metric("失联Worker", summary.staleWorkers, "自动回收关联租约", summary.staleWorkers ? "danger" : "")}
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Worker</th><th>运行池</th><th>能力</th><th>状态</th><th>当前任务</th><th>最近心跳</th><th>完成/失败</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationExecutionWorkers
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.node}</span></td>
                        <td>${item.pool}</td>
                        <td>${item.capabilities.join("<br />")}</td>
                        <td>${item.status ? `<span class="status-pill ${statusClass(item.status)}">${item.status}</span>` : "-"}</td>
                        <td>${item.activeJobId || "-"}</td>
                        <td>${item.lastHeartbeatAt}</td>
                        <td>${item.completedJobs}/${item.failedJobs}</td>
                        <td><button class="button ghost" type="button" data-action="restore-execution-worker" data-id="${item.id}" ${item.status !== "失联" ? "disabled" : ""}>重新注册</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">队列、重试与租约</h3>
              <p class="panel-subtitle">瞬时故障按30秒、60秒、120秒指数退避；永久失败或重试耗尽后进入死信，避免任务无限循环。</p>
            </div>
            <span class="tag">${summary.pendingJobs}个任务待完成</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>任务</th><th>连接器/环境</th><th>类型</th><th>状态</th><th>尝试</th><th>下次执行/租约</th><th>Worker</th><th>失败代码</th><th>代次</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationExecutionJobs
                  .filter((item) => item.status !== "成功")
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.queuedAt}</span></td>
                        <td>${item.connectorId}<br /><span class="muted-text">${item.environmentId}</span></td>
                        <td>${item.jobType}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.attempts}/${item.maxAttempts || 3}</td>
                        <td>${item.status === "执行中" ? item.leaseExpiresAt || "-" : item.nextAttemptAt || "-"}</td>
                        <td>${item.leaseOwner || "-"}</td>
                        <td>${item.errorCode || "-"}</td>
                        <td>G${item.generation || 1}</td>
                        <td>
                          <div class="toolbar inline">
                            ${item.status === "排队中" ? `<button class="button secondary" type="button" data-action="dispatch-execution-job" data-id="${item.id}">领取</button>` : ""}
                            ${item.status === "等待重试" ? `<button class="button secondary" type="button" data-action="activate-execution-retry" data-id="${item.id}">到期重试</button>` : ""}
                            ${item.status === "执行中" ? `<button class="button ghost" type="button" data-action="heartbeat-execution-job" data-id="${item.id}">心跳</button><button class="button secondary" type="button" data-action="fail-execution-job" data-id="${item.id}">模拟瞬时失败</button>` : ""}
                            ${item.status === "等待回执" ? `<button class="button secondary" type="button" data-action="verify-callback-receipt" data-id="${item.id}">核验回执</button>` : ""}
                            ${["死信", "阻断"].includes(item.status) ? `<span class="muted-text">等待人工处置</span>` : ""}
                          </div>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">死信复核与人工重放</h3>
              <p class="panel-subtitle">死信仅保留任务元数据和载荷摘要；重放必须记录审批角色、复核结论并开启新的执行代次。</p>
            </div>
            <span class="status-pill ${summary.openDeadLetters ? "danger" : ""}">${summary.openDeadLetters}项待复核</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>死信</th><th>任务/连接器</th><th>失败代码</th><th>尝试</th><th>载荷摘要</th><th>状态</th><th>复核记录</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationDeadLetters
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.createdAt}</span></td>
                        <td>${item.jobId}<br /><span class="muted-text">${item.connectorId}</span></td>
                        <td>${item.errorCode}</td>
                        <td>${item.attempts}次 · G${item.generation}</td>
                        <td>${item.payloadDigest}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.reviewedBy || "-"}<br /><span class="muted-text">${item.reviewNote || item.redrivenAt || ""}</span></td>
                        <td><button class="button secondary" type="button" data-action="redrive-execution-dead-letter" data-id="${item.id}" ${item.status !== "待复核" ? "disabled" : ""}>审批并重放</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">最近运行事件</h3>
              <p class="panel-subtitle">任务领取、心跳、重试、死信和人工重放形成统一审计时间线。</p>
            </div>
            <span class="tag">${state.integrationExecutionEvents.length}条事件</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>时间</th><th>事件</th><th>任务</th><th>Worker</th><th>状态</th><th>说明</th></tr></thead>
              <tbody>
                ${state.integrationExecutionEvents
                  .slice(0, 10)
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.occurredAt}</td>
                        <td><strong>${item.type}</strong></td>
                        <td>${item.jobId || "-"}</td>
                        <td>${item.workerId || "-"}</td>
                        <td>${item.status ? `<span class="status-pill ${statusClass(item.status)}">${item.status}</span>` : "-"}</td>
                        <td>${item.detail}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "environment") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">执行环境</h3>
              <p class="panel-subtitle">生产与验证环境分别核验网络区、TLS策略和配置版本，端点仅展示业务别名。</p>
            </div>
            <button class="button ghost" type="button" data-action="download-package" data-kind="execution">下载执行包</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>环境</th><th>类型</th><th>网络区域</th><th>端点别名</th><th>TLS策略</th><th>配置版本</th><th>状态</th><th>最近核验</th><th>责任组</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationEnvironments
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.type}</td>
                        <td>${item.networkZone}</td>
                        <td>${item.endpointAlias}</td>
                        <td>${item.tlsMode}</td>
                        <td>${item.configVersion}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.lastVerifiedAt}</td>
                        <td>${item.owner}</td>
                        <td><button class="button secondary" type="button" data-action="verify-execution-environment" data-id="${item.id}">执行核验</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">凭据保险库引用</h3>
              <p class="panel-subtitle">平台只保留不可逆引用指纹、密钥版本和轮换记录，原始凭据不进入业务状态与导出数据包。</p>
            </div>
            <span class="tag">${summary.activeVaultEntries}/${state.credentialVaultEntries.length}项引用有效</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>引用</th><th>连接器/环境</th><th>托管方</th><th>引用指纹</th><th>密钥版本</th><th>轮换期限</th><th>访问策略</th><th>状态</th><th>责任组</th><th>操作</th></tr></thead>
              <tbody>
                ${state.credentialVaultEntries
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.lastRotatedAt}</span></td>
                        <td>${item.connectorId}<br /><span class="muted-text">${item.environmentId}</span></td>
                        <td>${item.provider}</td>
                        <td>${item.vaultRefFingerprint}</td>
                        <td>${item.keyVersion}</td>
                        <td>${item.rotationDueAt}</td>
                        <td>${item.accessPolicy}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.owner}</td>
                        <td><button class="button ghost" type="button" data-action="rotate-vault-reference" data-id="${item.id}">轮换引用</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "jobs") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">异步认证任务</h3>
              <p class="panel-subtitle">任务以幂等键摘要防重，按排队、执行、等待回执和完成状态推进。</p>
            </div>
            <button class="button secondary" type="button" data-action="enqueue-execution-job">创建执行任务</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>任务</th><th>连接器/环境</th><th>类型</th><th>幂等摘要</th><th>防重命中</th><th>载荷摘要</th><th>进度</th><th>状态</th><th>回执</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationExecutionJobs
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.queuedAt}</span></td>
                        <td>${item.connectorId}<br /><span class="muted-text">${item.environmentId}</span></td>
                        <td>${item.jobType}</td>
                        <td>${item.idempotencyKeyHash}</td>
                        <td>${item.idempotencyHits}</td>
                        <td>${item.payloadDigest}</td>
                        <td>${item.progress}%</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.receiptId || "-"}</td>
                        <td><button class="button ${["等待回执", "等待重试"].includes(item.status) ? "secondary" : "ghost"}" type="button" data-action="${item.status === "等待回执" ? "verify-callback-receipt" : item.status === "等待重试" ? "activate-execution-retry" : "advance-execution-job"}" data-id="${item.id}" ${["成功", "阻断", "死信"].includes(item.status) ? "disabled" : ""}>${executionJobActionLabel(item.status)}</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">签名回执</h3>
              <p class="panel-subtitle">同时核验签名、时间窗、nonce和载荷摘要；任何一项失败均拒绝并触发隔离。</p>
            </div>
            <button class="button ghost" type="button" data-action="simulate-replay-callback">模拟重放阻断</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>回执</th><th>任务/连接器</th><th>来源与事件</th><th>签名</th><th>时间窗</th><th>nonce</th><th>载荷摘要</th><th>决定</th><th>接收时间</th></tr></thead>
              <tbody>
                ${state.integrationCallbackReceipts
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong></td>
                        <td>${item.jobId}<br /><span class="muted-text">${item.connectorId}</span></td>
                        <td>${item.source}<br /><span class="muted-text">${item.eventType}</span></td>
                        <td><span class="status-pill ${statusClass(item.signatureStatus)}">${item.signatureStatus}</span></td>
                        <td><span class="status-pill ${statusClass(item.timestampStatus)}">${item.timestampStatus}</span></td>
                        <td><span class="status-pill ${statusClass(item.nonceStatus)}">${item.nonceStatus}</span><br /><span class="muted-text">${item.nonceHash}</span></td>
                        <td><span class="status-pill ${statusClass(item.digestStatus)}">${item.digestStatus}</span><br /><span class="muted-text">${item.payloadDigest}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.decision}</span></td>
                        <td>${item.receivedAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "cutover") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">重放事件与连接器隔离</h3>
              <p class="panel-subtitle">疑似重放立即拒绝回调并隔离连接器；解除隔离必须写入安全复核结论。</p>
            </div>
            <span class="status-pill ${summary.activeQuarantines ? "danger" : ""}">${summary.activeQuarantines}个连接器隔离中</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>事件</th><th>连接器/来源</th><th>nonce摘要</th><th>首次/最近</th><th>命中</th><th>处置</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationReplayEvents
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong></td>
                        <td>${item.connectorId}<br /><span class="muted-text">${item.source}</span></td>
                        <td>${item.nonceHash}</td>
                        <td>${item.firstSeenAt}<br /><span class="muted-text">${item.lastSeenAt}</span></td>
                        <td>${item.hits}</td>
                        <td>${item.action}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="resolve-replay-event" data-id="${item.id}" ${item.status === "已处置" ? "disabled" : ""}>确认处置</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>隔离记录</th><th>连接器</th><th>原因</th><th>触发事件</th><th>状态</th><th>责任组</th><th>复核结论</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationQuarantines
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.openedAt}</span></td>
                        <td>${item.connectorId}</td>
                        <td>${item.reason}</td>
                        <td>${item.trigger}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.owner}</td>
                        <td>${item.reviewNote || "-"}</td>
                        <td><button class="button secondary" type="button" data-action="release-execution-quarantine" data-id="${item.id}" ${item.status === "已解除" ? "disabled" : ""}>复核并解除</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">生产切换窗口</h3>
              <p class="panel-subtitle">环境、凭据、执行回执、隔离、联调准入和回滚预案全部通过后，授权角色方可切换。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-cutover-window">创建切换窗口</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>窗口</th><th>医院/环境</th><th>连接器</th><th>计划时间</th><th>门禁检查</th><th>回滚预案</th><th>状态</th><th>执行记录</th><th>操作</th></tr></thead>
              <tbody>
                ${state.integrationCutoverWindows
                  .map(
                    (item) => {
                      const passed = Object.values(item.checks || {}).filter(Boolean).length;
                      const total = Object.keys(item.checks || {}).length;
                      return `
                        <tr>
                          <td><strong>${item.id}</strong><br /><span class="muted-text">${item.windowMinutes}分钟</span></td>
                          <td>${item.hospitalName}<br /><span class="muted-text">${item.hospitalCode} · ${item.environmentId}</span></td>
                          <td>${item.connectorIds.join("<br />")}</td>
                          <td>${item.plannedAt}</td>
                          <td>${passed}/${total}<br /><span class="muted-text">${item.evaluatedAt || "待评估"}</span></td>
                          <td>${item.rollbackPlan}</td>
                          <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                          <td>${item.approvedBy || "-"}<br /><span class="muted-text">${item.completedAt || item.startedAt || item.rollbackAt || ""}</span></td>
                          <td>
                            <div class="toolbar inline">
                              <button class="button ghost" type="button" data-action="evaluate-cutover-window" data-id="${item.id}">评估</button>
                              <button class="button secondary" type="button" data-action="${item.status === "切换中" ? "complete-cutover-window" : "start-cutover-window"}" data-id="${item.id}" ${["已切换", "已回滚"].includes(item.status) ? "disabled" : ""}>${item.status === "切换中" ? "完成切换" : "开始切换"}</button>
                              <button class="button ghost" type="button" data-action="rollback-cutover-window" data-id="${item.id}" ${!["切换中", "已切换"].includes(item.status) ? "disabled" : ""}>回滚</button>
                            </div>
                          </td>
                        </tr>
                      `;
                    },
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "production") {
      const decision = state.productionGoNoGo;
      const decisionPassed = Object.values(decision.checks || {}).filter(Boolean).length;
      const decisionTotal = Object.keys(decision.checks || {}).length;
      content = `
        <section class="panel production-decision">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">生产 Go/No-Go 决策</h3>
              <p class="panel-subtitle">软件能力、外部运行配置、现场证据、四方签批、队列清空和切换窗口共同决定是否允许生产切换。</p>
            </div>
            <div class="toolbar inline">
              <span class="status-pill ${decision.decision === "GO" ? "" : "danger"}">${decision.decision}</span>
              <button class="button secondary" type="button" data-action="evaluate-production-go-no-go">重新评估</button>
            </div>
          </div>
          <div class="grid-4 compact-metrics">
            ${metric("软件与外部配置", `${summary.runtimeControlsReady}/${state.productionRuntimeControls.length}`, "持久化、密钥、回调与Worker身份", summary.runtimeControlsReady < state.productionRuntimeControls.length ? "warn" : "")}
            ${metric("切换证据", `${summary.verifiedCutoverEvidence}/${state.cutoverEvidenceRequirements.length}`, "摘要入册并独立复核", summary.verifiedCutoverEvidence < state.cutoverEvidenceRequirements.length ? "warn" : "")}
            ${metric("责任人签批", `${summary.approvedCutoverRoles}/${state.productionCutoverApprovals.length}`, "接口、安全、运行、医院", summary.approvedCutoverRoles < state.productionCutoverApprovals.length ? "warn" : "")}
            ${metric("门禁通过", `${decisionPassed}/${decisionTotal}`, decision.status, decision.decision === "GO" ? "" : "danger")}
          </div>
          <div class="callout ${decision.decision === "GO" ? "" : "danger"}">
            <strong>${decision.decision === "GO" ? "已满足生产切换条件" : "当前禁止生产切换"}</strong>
            <span>${(decision.blockers || []).join("；") || "全部门禁通过，可在已批准窗口内执行切换。"}</span>
            <small>${decision.evaluatedAt} · ${decision.evaluatedBy}</small>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">生产运行控制</h3>
              <p class="panel-subtitle">代码实现与外部激活分别登记；托管密钥、证书指纹和现场回执未配置时始终保持NO-GO。</p>
            </div>
            <button class="button ghost" type="button" data-action="download-package" data-kind="execution">导出投产包</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>控制项</th><th>实现与门禁</th><th>责任组</th><th>证据</th><th>状态</th><th>核验时间</th><th>操作</th></tr></thead>
              <tbody>
                ${state.productionRuntimeControls.map((item) => `
                  <tr>
                    <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                    <td>${item.control}</td>
                    <td>${item.owner}</td>
                    <td>${item.evidence}</td>
                    <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                    <td>${item.verifiedAt || "-"}</td>
                    <td><button class="button secondary" type="button" data-action="configure-production-runtime" data-id="${item.id}" ${item.status !== "待配置" ? "disabled" : ""}>登记配置</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">切换证据包</h3>
              <p class="panel-subtitle">只保存文件名、SHA-256摘要、来源和核验身份；提交人与复核人必须独立，原文、签名、nonce和密钥不进入页面状态。</p>
            </div>
            <span class="tag">${summary.verifiedCutoverEvidence}/${state.cutoverEvidenceRequirements.length}项已核验</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>证据要求</th><th>责任角色</th><th>现场必需</th><th>文件与摘要</th><th>提交/复核</th><th>状态</th><th>更新时间</th><th>操作</th></tr></thead>
              <tbody>
                ${state.cutoverEvidenceRequirements.map((item) => `
                  <tr>
                    <td><strong>${item.name}</strong><br /><span class="muted-text">${item.requirementId}</span></td>
                    <td>${item.ownerRole}</td>
                    <td>${item.siteRequired ? "是" : "否"}</td>
                    <td>${item.artifactName || "-"}<br /><span class="muted-text">${item.artifactDigest || "待生成SHA-256摘要"}</span></td>
                    <td>${item.submittedBy || "-"}<br /><span class="muted-text">${item.verifiedBy ? `复核：${item.verifiedBy}` : "待独立复核"}</span></td>
                    <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                    <td>${item.updatedAt || "-"}</td>
                    <td>
                      <button class="button ${item.status === "待复核" ? "secondary" : "ghost"}" type="button" data-action="${item.status === "待复核" ? "verify-cutover-evidence" : "record-cutover-evidence"}" data-id="${item.id}" ${item.status === "已核验" ? "disabled" : ""}>${item.status === "待复核" ? "独立复核" : item.status === "待上传" ? "登记证据" : "已完成"}</button>
                    </td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">四方责任人签批</h3>
              <p class="panel-subtitle">接口、安全、运行和医院责任人使用不同身份签批；证据提交人不能审批自己的证据包。</p>
            </div>
            <span class="tag">${summary.approvedCutoverRoles}/4方已同意</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>责任角色</th><th>签批人</th><th>决定</th><th>意见</th><th>签批摘要</th><th>时间</th><th>操作</th></tr></thead>
              <tbody>
                ${state.productionCutoverApprovals.map((item) => `
                  <tr>
                    <td><strong>${item.role}</strong><br /><span class="muted-text">${item.id}</span></td>
                    <td>${item.approver || "-"}</td>
                    <td><span class="status-pill ${statusClass(item.decision)}">${item.decision}</span></td>
                    <td>${item.note || "-"}</td>
                    <td>${item.approvalDigest || "-"}</td>
                    <td>${item.approvedAt || "-"}</td>
                    <td><button class="button secondary" type="button" data-action="approve-production-cutover" data-id="${item.id}" ${item.decision === "同意" ? "disabled" : ""}>签批同意</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("运行Worker", `${summary.readyWorkers + summary.busyWorkers}/${state.integrationExecutionWorkers.length}`, `${summary.staleWorkers}个失联`, summary.staleWorkers ? "warn" : "")}
        ${metric("执行任务", summary.successfulJobs, `${summary.pendingJobs}个待完成 · ${summary.retryScheduledJobs}个重试`, summary.pendingJobs ? "warn" : "")}
        ${metric("死信队列", summary.openDeadLetters, `${summary.verifiedReceipts}份回执已验证`, summary.openDeadLetters ? "danger" : "")}
        ${metric("生产切换", summary.readyCutovers, `${summary.activeQuarantines}个连接器隔离中`, summary.activeQuarantines ? "danger" : "")}
      </div>
      <div class="segmented execution-tabs" role="tablist" aria-label="接入执行功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-execution-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderAssessment() {
    header("试点评估");
    const tab = workspace.dataset.assessmentTab || "outcomes";
    const summary = assessmentSummary();
    const tabs = [
      { id: "outcomes", label: "成效评估" },
      { id: "issues", label: "问题复盘" },
      { id: "plans", label: "优化计划" },
      { id: "rollout", label: "推广准备" },
    ];
    let content = "";

    if (tab === "outcomes") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点成效指标</h3>
              <p class="panel-subtitle">汇总流程完成、数据质量、审核效率、平台稳定性和用户满意度。</p>
            </div>
            <button class="button secondary" type="button" data-action="recalculate-pilot-outcomes">重新计算成效</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>指标</th><th>数据来源</th><th>基线</th><th>当前值</th><th>目标值</th><th>权重</th><th>完成度</th><th>状态</th></tr></thead>
              <tbody>
                ${state.pilotOutcomeMetrics
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.source}</td>
                        <td>${item.baseline}${item.unit}</td>
                        <td><strong>${Number(item.current).toFixed(item.id === "OUTCOME-UPTIME" ? 2 : 0)}${item.unit}</strong></td>
                        <td>${item.target}${item.unit}</td>
                        <td>${item.weight}%</td>
                        <td><div class="queue-progress"><span style="width:${Math.min(100, (item.current / Math.max(1, item.target)) * 100)}%"></span></div><small>${Math.round((item.current / Math.max(1, item.target)) * 100)}%</small></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点医院成效评分</h3>
              <p class="panel-subtitle">按医院形成流程、数据、审核和满意度综合评分，识别可推广样板。</p>
            </div>
            <span class="status-pill">${summary.qualifiedHospitals}/${state.pilotHospitalOutcomes.length}家可推广</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>医院</th><th>流程完成</th><th>数据质量</th><th>审核通过</th><th>满意度</th><th>综合评分</th><th>重大问题</th><th>结论</th><th>评估时间</th></tr></thead>
              <tbody>
                ${state.pilotHospitalOutcomes
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.hospitalName}</strong><br /><span class="muted-text">${item.hospitalCode}</span></td>
                        <td>${item.processCompletion}%</td>
                        <td>${item.dataQuality}%</td>
                        <td>${item.auditPassRate}%</td>
                        <td>${item.satisfaction}%</td>
                        <td><strong>${item.score}</strong></td>
                        <td>${item.majorIssues}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.evaluatedAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "issues") {
      content = `
        <div class="grid-4">
          ${metric("问题主题", state.pilotIssueThemes.length, "跨工单、反馈与监控归并")}
          ${metric("开放主题", summary.openThemes, "待确认、分析或改进", summary.openThemes ? "danger" : "")}
          ${metric("高影响主题", state.pilotIssueThemes.filter((item) => item.impact === "高" && item.status !== "已闭环").length, "优先进入优化计划")}
          ${metric("来源线索", state.pilotIssueThemes.reduce((sum, item) => sum + item.sourceCount, 0), "已归并问题记录")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点问题主题复盘</h3>
              <p class="panel-subtitle">将工单、反馈、校验异常和运营告警归并为可治理的问题主题。</p>
            </div>
            <button class="button secondary" type="button" data-action="generate-issue-review">重新生成复盘</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>主题</th><th>分类</th><th>问题数</th><th>来源线索</th><th>影响</th><th>根因分析</th><th>责任组</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotIssueThemes
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id} · ${item.reviewedAt}</span></td>
                        <td>${item.category}</td>
                        <td>${item.count}</td>
                        <td>${item.sourceCount}</td>
                        <td><span class="status-pill ${statusClass(item.impact)}">${item.impact}</span></td>
                        <td>${item.rootCause}</td>
                        <td>${item.owner}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="close-issue-theme" data-id="${item.id}" ${item.status === "已闭环" ? "disabled" : ""}>确认闭环</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "plans") {
      content = `
        <div class="grid-4">
          ${metric("优化事项", state.pilotImprovementPlans.length, "问题主题转行动计划")}
          ${metric("开放计划", summary.openPlans, "待开始、进行中或待验收", summary.openPlans ? "warn" : "")}
          ${metric("待验收", state.pilotImprovementPlans.filter((item) => item.status === "待验收").length, "需按验收标准验证")}
          ${metric("完成率", pct(summary.completedPlans / Math.max(1, state.pilotImprovementPlans.length)), `${summary.completedPlans}项已完成`)}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点优化计划</h3>
              <p class="panel-subtitle">把问题根因转化为有版本、有责任人、有期限和验收标准的改进事项。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-improvement-plan">生成优化事项</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>优化事项</th><th>来源</th><th>优先级</th><th>责任组</th><th>目标版本</th><th>截止时间</th><th>验收标准</th><th>进度</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.pilotImprovementPlans
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.source}</td>
                        <td><span class="status-pill ${statusClass(item.priority)}">${item.priority}</span></td>
                        <td>${item.owner}</td>
                        <td>${item.targetVersion}</td>
                        <td>${item.dueAt}</td>
                        <td>${item.acceptance}</td>
                        <td><div class="queue-progress"><span style="width:${item.progress}%"></span></div><small>${item.progress}%</small></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="advance-improvement-plan" data-id="${item.id}" ${item.status === "已完成" ? "disabled" : ""}>推进</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "rollout") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">区域推广准备度</h3>
              <p class="panel-subtitle">按组织、平台、安全、培训和数据迁移五个维度评估推广准入条件。</p>
            </div>
            <button class="button secondary" type="button" data-action="assess-rollout-readiness">重新评估准备度</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>推广区域</th><th>协调单位</th><th>医院数</th><th>组织</th><th>平台</th><th>安全</th><th>培训</th><th>数据迁移</th><th>综合准备度</th><th>计划时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.rolloutRegions
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.province}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.coordinator}</td>
                        <td>${item.hospitalCount}</td>
                        <td>${item.organization}%</td>
                        <td>${item.platform}%</td>
                        <td>${item.security}%</td>
                        <td>${item.training}%</td>
                        <td>${item.dataMigration}%</td>
                        <td><div class="queue-progress"><span style="width:${item.readiness}%"></span></div><small>${item.readiness}%</small></td>
                        <td>${item.plannedAt}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="advance-rollout-region" data-id="${item.id}" ${item.status === "已启动" ? "disabled" : ""}>推进准备</button><button class="button ghost" type="button" data-action="launch-rollout-region" data-id="${item.id}" ${item.readiness < 85 || item.status === "已启动" ? "disabled" : ""}>启动推广</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试点评估报告</h3>
              <p class="panel-subtitle">固化试点范围、综合得分、评估结论和推广建议，形成管理决策依据。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="generate-assessment-report">生成报告</button>
              <button class="button ghost" type="button" data-action="publish-assessment-report">发布报告</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>报告</th><th>试点周期</th><th>平台版本</th><th>覆盖医院</th><th>综合得分</th><th>评估结论</th><th>推广建议</th><th>生成时间</th><th>发布时间</th><th>状态</th></tr></thead>
              <tbody>
                ${state.pilotAssessmentReports
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong></td>
                        <td>${item.period}</td>
                        <td>${item.version}</td>
                        <td>${item.coverage}家</td>
                        <td><strong>${item.score}</strong></td>
                        <td>${item.conclusion}</td>
                        <td>${item.recommendation}</td>
                        <td>${item.generatedAt}</td>
                        <td>${item.publishedAt || "-"}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("综合成效", summary.weightedScore, `${summary.metricsMet}/${state.pilotOutcomeMetrics.length}项指标达标`)}
        ${metric("开放问题主题", summary.openThemes, "复盘后进入优化计划", summary.openThemes ? "danger" : "")}
        ${metric("开放优化计划", summary.openPlans, `${summary.completedPlans}项已完成`, summary.openPlans ? "warn" : "")}
        ${metric("推广准备度", `${summary.averageRolloutReadiness}%`, `${summary.readyRegions}/${state.rolloutRegions.length}个区域可启动`)}
      </div>
      <div class="segmented assessment-tabs" role="tablist" aria-label="试点评估功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-assessment-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderAssistant() {
    header("评价助手");
    const tab = workspace.dataset.assistantTab || "qa";
    const summary = assistantSummary();
    const tabs = [
      { id: "qa", label: "标准问答" },
      { id: "explanations", label: "异常解释" },
      { id: "suggestions", label: "整改建议" },
      { id: "risks", label: "审核风险" },
      { id: "governance", label: "治理审计" },
      { id: "quality", label: "质量门禁" },
      { id: "canary", label: "灰度" },
      { id: "feedback", label: "反馈" },
    ];
    let content = "";

    if (tab === "qa") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">标准知识源</h3>
              <p class="panel-subtitle">仅使用已登记的标准、材料目录、数据目录和经复核试点案例生成回答。</p>
            </div>
            <button class="button secondary" type="button" data-action="sync-assistant-knowledge">同步知识源</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>知识源</th><th>类型</th><th>版本</th><th>覆盖范围</th><th>知识片段</th><th>责任组</th><th>最近同步</th><th>状态</th></tr></thead>
              <tbody>
                ${state.assistantKnowledgeSources
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.type}</td>
                        <td>${item.version}</td>
                        <td>${item.scope}</td>
                        <td>${item.chunks}</td>
                        <td>${item.owner}</td>
                        <td>${item.lastSyncedAt}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">标准口径问答</h3>
              <p class="panel-subtitle">回答必须引用来源，未确认内容不得直接作为填报或审核结论。</p>
            </div>
          </div>
          <div class="toolbar">
            <label class="field assistant-question-field">
              <span>问题</span>
              <input type="text" data-assistant-question value="B3接口成功率统计时，失败重试应如何去重？" />
            </label>
            <button class="button secondary" type="button" data-action="ask-standard-question">提交问题</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>问题</th><th>回答</th><th>引用来源</th><th>治理链路</th><th>置信度</th><th>提问人/时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.standardQaRecords
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${escapeHtml(item.question)}</strong><br /><span class="muted-text">${item.id} · ${item.scope}</span></td>
                        <td>${escapeHtml(item.answer)}</td>
                        <td>${item.citations.map((citation) => `<span class="tag">${citation}</span>`).join(" ")}</td>
                        <td><strong>${item.retrievalTraceId || "待生成"}</strong><br /><span class="muted-text">${item.modelCallId || "待记录"}</span></td>
                        <td>${item.confidence}%</td>
                        <td>${item.askedBy}<br /><span class="muted-text">${item.askedAt}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="confirm-standard-answer" data-id="${item.id}" ${item.status === "已确认" ? "disabled" : ""}>人工确认</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "explanations") {
      content = `
        <div class="grid-4">
          ${metric("异常说明", state.anomalyExplanations.length, "关联校验、波动和材料问题")}
          ${metric("待人工确认", summary.pendingExplanations, "生成结果不可直接提交", summary.pendingExplanations ? "warn" : "")}
          ${metric("医院可编辑", state.anomalyExplanations.filter((item) => item.editable).length, "编辑后保留原始版本")}
          ${metric("已采纳", state.anomalyExplanations.filter((item) => item.status === "已采纳").length, "已进入问题处理")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">异常说明生成</h3>
              <p class="panel-subtitle">把校验结果转为可读说明，展示可能原因、业务影响和建议核验动作。</p>
            </div>
            <button class="button secondary" type="button" data-action="generate-anomaly-explanations">生成异常说明</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>异常</th><th>医院/指标</th><th>说明摘要</th><th>可能原因</th><th>影响</th><th>建议核验</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.anomalyExplanations
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id} · ${item.sourceId}</span></td>
                        <td>${item.hospitalCode}<br /><strong>${item.indicatorCode}</strong></td>
                        <td>${item.summary}</td>
                        <td>${item.possibleCause}</td>
                        <td>${item.impact}</td>
                        <td>${item.recommendation}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="edit-anomaly-explanation" data-id="${item.id}" ${item.status === "已采纳" ? "disabled" : ""}>编辑说明</button><button class="button ghost" type="button" data-action="adopt-anomaly-explanation" data-id="${item.id}" ${item.status === "已采纳" ? "disabled" : ""}>采纳</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "suggestions") {
      content = `
        <div class="grid-4">
          ${metric("建议模板", state.rectificationSuggestions.length, "从异常和问题生成")}
          ${metric("待采纳", summary.pendingSuggestions, "需医院责任人确认", summary.pendingSuggestions ? "warn" : "")}
          ${metric("已采纳", summary.adoptedSuggestions, "已转整改任务")}
          ${metric("紧急建议", state.rectificationSuggestions.filter((item) => item.priority === "紧急" && item.status !== "已采纳").length, "优先处理")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">智能整改建议</h3>
              <p class="panel-subtitle">建议仅供参考，采纳后生成正式整改任务，仍由医院和审核人员确认。</p>
            </div>
            <button class="button secondary" type="button" data-action="generate-rectification-suggestion">生成建议</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>问题</th><th>医院/指标</th><th>整改建议</th><th>建议步骤</th><th>优先级</th><th>责任部门</th><th>建议时限</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.rectificationSuggestions
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.problem}</strong><br /><span class="muted-text">${item.id} · ${item.sourceId}</span></td>
                        <td>${item.hospitalCode}<br /><strong>${item.indicatorCode}</strong></td>
                        <td>${item.suggestion}<br /><small>${item.disclaimer}</small></td>
                        <td>${item.steps.map((step, index) => `${index + 1}. ${step}`).join("<br />")}</td>
                        <td><span class="status-pill ${statusClass(item.priority)}">${item.priority}</span></td>
                        <td>${item.owner}</td>
                        <td>${item.dueDays}天</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="adopt-rectification-suggestion" data-id="${item.id}" ${item.status === "已采纳" ? "disabled" : ""}>采纳并转任务</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "risks") {
      content = `
        <div class="grid-4">
          ${metric("风险线索", state.reviewRiskSignals.length, "规则、材料与历史波动")}
          ${metric("开放风险", summary.openRisks, "待确认或已确认", summary.openRisks ? "danger" : "")}
          ${metric("高风险", summary.highRisks, "建议转专家或专项复核", summary.highRisks ? "danger" : "")}
          ${metric("已排除", state.reviewRiskSignals.filter((item) => item.status === "已排除").length, "人工核验后排除")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">审核风险提示</h3>
              <p class="panel-subtitle">风险线索不直接形成审核结论，必须由审核员确认、排除或转专家复核。</p>
            </div>
            <button class="button secondary" type="button" data-action="scan-review-risks">重新扫描风险</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>风险信号</th><th>医院/指标</th><th>级别</th><th>识别依据</th><th>建议动作</th><th>来源</th><th>责任组</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.reviewRiskSignals
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.signal}</strong><br /><span class="muted-text">${item.id} · ${item.createdAt}</span></td>
                        <td>${item.hospitalName}<br /><strong>${item.indicatorCode}</strong></td>
                        <td><span class="status-pill ${statusClass(item.level)}">${item.level}</span></td>
                        <td>${item.basis}</td>
                        <td>${item.recommendation}</td>
                        <td>${item.source}</td>
                        <td>${item.owner}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="confirm-review-risk" data-id="${item.id}" ${item.status !== "待确认" ? "disabled" : ""}>确认</button><button class="button ghost" type="button" data-action="dismiss-review-risk" data-id="${item.id}" ${item.status === "已排除" || item.status === "已转复核" ? "disabled" : ""}>排除</button><button class="button ghost" type="button" data-action="review-risk-to-expert" data-id="${item.id}" ${item.status === "已转复核" || item.status === "已排除" ? "disabled" : ""}>转专家</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "governance") {
      content = `
        <div class="grid-4">
          ${metric("待处理知识版本", summary.pendingKnowledgeVersions, `${summary.publishedKnowledgeVersions}个版本已发布`, summary.pendingKnowledgeVersions ? "warn" : "")}
          ${metric("检索命中通过率", `${summary.retrievalPassRate}%`, `${state.assistantRetrievalTraces.length}次检索已追踪`, summary.retrievalPassRate < 90 ? "warn" : "")}
          ${metric("模型调用记录", state.assistantModelCalls.length, `${summary.unreviewedModelCalls}次待人工复核`, summary.unreviewedModelCalls ? "warn" : "")}
          ${metric("降级调用", summary.degradedModelCalls, "仅保留辅助结果并触发复核", summary.degradedModelCalls ? "danger" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">知识版本审批</h3>
              <p class="panel-subtitle">知识变更依次经过提交、审批和发布，只有已发布版本进入正式检索范围。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-knowledge-version">新建版本</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>知识版本</th><th>变更摘要</th><th>片段变化</th><th>摘要指纹</th><th>责任与审批</th><th>生效时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantKnowledgeVersions
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.sourceName}</strong><br /><span class="muted-text">${item.version} · 前序${item.previousVersion || "无"}</span></td>
                        <td>${item.changeSummary}</td>
                        <td>+${item.addedChunks} / -${item.removedChunks}</td>
                        <td>${item.checksum}</td>
                        <td>${item.owner}<br /><span class="muted-text">${item.reviewer}</span></td>
                        <td>${item.effectiveAt || "尚未生效"}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="advance-knowledge-version" data-id="${item.id}" ${item.status === "已发布" ? "disabled" : ""}>${knowledgeVersionActionLabel(item.status)}</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">检索命中追踪</h3>
              <p class="panel-subtitle">记录每次问答的命中片段、相似度阈值和检索耗时，低于阈值时转人工补充。</p>
            </div>
            <button class="button secondary" type="button" data-action="run-retrieval-quality-check">检索质量复核</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>检索请求</th><th>关联问答</th><th>Top命中</th><th>阈值</th><th>耗时</th><th>状态</th></tr></thead>
              <tbody>
                ${state.assistantRetrievalTraces
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${escapeHtml(item.query)}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.questionId}<br /><span class="muted-text">${item.hospitalCode}</span></td>
                        <td>${item.topMatches.map((match) => `<strong>${match.sourceId}/${match.chunkId}</strong> ${Math.round(match.score * 100)}%<br /><span class="muted-text">${match.citation}</span>`).join("<br />")}</td>
                        <td>${Math.round(item.threshold * 100)}%</td>
                        <td>${item.durationMs}ms</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">模型调用审计</h3>
              <p class="panel-subtitle">保留业务对象、提示版本、摘要指纹、令牌、耗时与降级状态，人工复核形成闭环。</p>
            </div>
            <button class="button secondary" type="button" data-action="simulate-model-audit">发起降级演练</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>调用与场景</th><th>业务对象</th><th>路由/提示版本</th><th>请求/响应摘要</th><th>令牌</th><th>耗时</th><th>调用状态</th><th>复核</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantModelCalls
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.scene}</strong><br /><span class="muted-text">${item.id} · ${item.calledAt}</span></td>
                        <td>${item.businessId}<br /><span class="muted-text">${item.operator}</span></td>
                        <td>${item.modelRoute}<br /><span class="muted-text">${item.promptVersion}</span></td>
                        <td>${item.requestDigest}<br /><span class="muted-text">${item.responseDigest}</span></td>
                        <td>${item.inputTokens}/${item.outputTokens}</td>
                        <td>${item.latencyMs}ms</td>
                        <td><span class="status-pill ${statusClass(item.callStatus)}">${item.callStatus}</span><br /><span class="muted-text">风险${item.risk}${item.fallback ? " · 已降级" : ""}</span></td>
                        <td><span class="status-pill ${statusClass(item.reviewStatus)}">${item.reviewStatus}</span><br /><span class="muted-text">${item.reviewedBy || "待指派"}</span></td>
                        <td><button class="button ghost" type="button" data-action="review-model-call" data-id="${item.id}" ${item.reviewStatus === "已复核" ? "disabled" : ""}>人工复核</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "quality") {
      const gate = state.assistantQualityGate;
      content = `
        <div class="grid-4">
          ${metric("已发布评测集", summary.publishedEvaluationSuites, `${summary.evaluationCaseCount}个门禁样本`)}
          ${metric("最近评测得分", summary.latestEvaluationScore, `${state.assistantEvaluationRuns.length}次运行记录`, summary.latestEvaluationScore < 90 ? "danger" : "")}
          ${metric("门禁阻断候选", summary.blockedReleases, "不允许提交审批或上线", summary.blockedReleases ? "danger" : "")}
          ${metric("当前线上版本", summary.activeReleaseVersion, "支持一键恢复历史版本")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">质量门禁阈值</h3>
              <p class="panel-subtitle">候选版本必须同时满足业务准确性、检索质量、安全边界、性能和基线回归要求。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>引用覆盖率</th><th>回答准确率</th><th>检索召回率</th><th>安全合规率</th><th>平均时延</th><th>允许基线回退</th><th>责任组</th><th>更新时间</th></tr></thead>
              <tbody><tr><td>≥${gate.citationCoverage}%</td><td>≥${gate.answerAccuracy}%</td><td>≥${gate.retrievalRecall}%</td><td>≥${gate.safetyCompliance}%</td><td>≤${gate.maxLatencyMs}ms</td><td>≤${gate.maxRegressionPoints}个百分点</td><td>${gate.owner}</td><td>${gate.updatedAt}</td></tr></tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">评价助手评测集</h3>
              <p class="panel-subtitle">业务口径、安全边界和试点长尾样本分别维护版本，草稿样本不进入正式发布门禁。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-evaluation-suite">新建评测集</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>评测集</th><th>类型</th><th>覆盖范围</th><th>样本数</th><th>来源</th><th>责任组</th><th>更新时间</th><th>状态</th></tr></thead>
              <tbody>
                ${state.assistantEvaluationSuites
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id} · ${item.version}</span></td>
                        <td>${item.type}</td>
                        <td>${item.domains.map((domain) => `<span class="tag">${domain}</span>`).join(" ")}</td>
                        <td>${item.caseCount}</td>
                        <td>${item.source}</td>
                        <td>${item.owner}</td>
                        <td>${item.updatedAt}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">回归评测运行</h3>
              <p class="panel-subtitle">同一候选在固定评测集上执行，记录质量、性能和相对线上基线的变化。</p>
            </div>
            <button class="button secondary" type="button" data-action="run-assistant-evaluation">运行全量评测</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>运行/候选</th><th>评测集</th><th>知识/提示版本</th><th>引用覆盖</th><th>回答准确</th><th>检索召回</th><th>安全合规</th><th>平均时延</th><th>基线变化</th><th>得分</th><th>门禁</th></tr></thead>
              <tbody>
                ${state.assistantEvaluationRuns
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.candidateVersion} · ${item.finishedAt}</span></td>
                        <td>${item.suiteVersion}</td>
                        <td>${item.knowledgeVersion}<br /><span class="muted-text">${item.promptVersion}</span></td>
                        <td>${item.citationCoverage}%</td>
                        <td>${item.answerAccuracy}%</td>
                        <td>${item.retrievalRecall}%</td>
                        <td>${item.safetyCompliance}%</td>
                        <td>${item.averageLatencyMs}ms</td>
                        <td>${item.baselineDelta > 0 ? "+" : ""}${item.baselineDelta}</td>
                        <td><strong>${item.score}</strong></td>
                        <td><span class="status-pill ${statusClass(item.gateStatus)}">${item.gateStatus}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">候选版本发布与回滚</h3>
              <p class="panel-subtitle">候选版本关联唯一评测运行；门禁通过后才能提交审批和发布，线上异常可恢复最近历史版本。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-assistant-release">创建候选版本</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>版本</th><th>路由/提示版本</th><th>知识版本</th><th>评测证据</th><th>回滚目标</th><th>责任与审批</th><th>门禁</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantReleaseCandidates
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.version}</strong><br /><span class="muted-text">${item.id} · ${item.publishedAt || item.createdAt}</span></td>
                        <td>${item.modelRoute}<br /><span class="muted-text">${item.promptVersion}</span></td>
                        <td>${item.knowledgeVersion}</td>
                        <td>${item.evaluationRunId}</td>
                        <td>${item.rollbackTarget || "无"}</td>
                        <td>${item.owner}<br /><span class="muted-text">${item.reviewer}</span></td>
                        <td><span class="status-pill ${statusClass(item.gateStatus)}">${item.gateStatus}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${
                          item.status === "已发布"
                            ? `<button class="button ghost" type="button" data-action="rollback-assistant-release" data-id="${item.id}">回滚版本</button>`
                            : `<button class="button ghost" type="button" data-action="advance-assistant-release" data-id="${item.id}" ${item.gateStatus !== "通过" || item.status === "历史版本" || item.status === "已回滚" ? "disabled" : ""}>${assistantReleaseActionLabel(item.status, item.gateStatus)}</button>`
                        }</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "canary") {
      const guardrail = state.assistantOnlineGuardrail;
      const activeCanary = state.assistantDeployments.find((item) => item.strategy === "灰度" && ["灰度中", "已暂停"].includes(item.status));
      content = `
        <div class="grid-4">
          ${metric("活跃灰度", summary.activeCanaryDeployments, "同一时间仅运行一个灰度版本", summary.activeCanaryDeployments ? "warn" : "")}
          ${metric("当前灰度流量", `${summary.currentCanaryTraffic}%`, activeCanary?.version || "暂无灰度版本")}
          ${metric("最近在线状态", summary.latestOnlineStatus, `健康窗口占比${summary.onlineHealthyRate}%`, summary.latestOnlineStatus === "异常" ? "danger" : "")}
          ${metric("开放质量事件", summary.openQualityIncidents, "异常自动暂停扩量", summary.openQualityIncidents ? "danger" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">在线质量护栏</h3>
              <p class="panel-subtitle">每个灰度窗口持续校验引用、采纳、转人工、时延、安全事件与分布漂移，任一指标越界即暂停扩量。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>引用覆盖率</th><th>回答采纳率</th><th>无答案率</th><th>转人工率</th><th>P95时延</th><th>安全事件</th><th>漂移分</th><th>责任组</th><th>更新时间</th></tr></thead>
              <tbody><tr><td>≥${guardrail.citationCoverage}%</td><td>≥${guardrail.answerAcceptance}%</td><td>≤${guardrail.maxNoAnswerRate}%</td><td>≤${guardrail.maxEscalationRate}%</td><td>≤${guardrail.maxP95LatencyMs}ms</td><td>≤${guardrail.maxSafetyEvents}</td><td>≤${guardrail.maxDriftScore}</td><td>${guardrail.owner}</td><td>${guardrail.updatedAt}</td></tr></tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">灰度部署与流量扩量</h3>
              <p class="panel-subtitle">离线门禁通过后先向试点医院投放10%流量；仅当最新在线窗口健康且无开放事件时，才可逐级扩量。</p>
            </div>
            <button class="button secondary" type="button" data-action="create-canary-deployment" ${activeCanary ? "disabled" : ""}>创建10%灰度</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>版本</th><th>策略/流量</th><th>试点范围</th><th>稳定基线</th><th>责任组</th><th>开始/更新</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantDeployments
                  .map((item) => {
                    const latestWindow = state.assistantOnlineQualityWindows.find((windowItem) => windowItem.deploymentId === item.id);
                    const hasOpenIncident = state.assistantQualityIncidents.some((incident) => incident.deploymentId === item.id && incident.status !== "已解决");
                    const canAdvance = item.status === "灰度中" && latestWindow?.status === "健康" && !hasOpenIncident;
                    return `
                      <tr>
                        <td><strong>${item.version}</strong><br /><span class="muted-text">${item.id} · ${item.releaseId}</span></td>
                        <td>${item.strategy}<br /><strong>${item.trafficPercent}%</strong></td>
                        <td>${item.cohorts.map((cohort) => `<span class="tag">${cohort}</span>`).join(" ")}</td>
                        <td>${item.stableVersion}</td>
                        <td>${item.owner}</td>
                        <td>${item.startedAt}<br /><span class="muted-text">${item.updatedAt}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="advance-canary-deployment" data-id="${item.id}" ${canAdvance ? "" : "disabled"}>${item.trafficPercent >= 30 ? "转全量" : "扩量至30%"}</button><button class="button ghost" type="button" data-action="rollback-canary-deployment" data-id="${item.id}" ${item.strategy !== "灰度" || item.status === "已回滚" ? "disabled" : ""}>回滚</button></div></td>
                      </tr>
                    `;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">在线质量窗口</h3>
              <p class="panel-subtitle">窗口指标与部署版本绑定，扩量决策使用最新窗口；可注入异常验证暂停和回滚机制。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="run-online-quality-check" ${!activeCanary || activeCanary.status === "已暂停" ? "disabled" : ""}>采集健康窗口</button>
              <button class="button ghost" type="button" data-action="simulate-online-degradation" ${!activeCanary || activeCanary.status === "已暂停" ? "disabled" : ""}>模拟指标异常</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>窗口/版本</th><th>样本量</th><th>引用覆盖</th><th>采纳率</th><th>无答案率</th><th>转人工率</th><th>P95时延</th><th>安全事件</th><th>漂移分</th><th>状态</th></tr></thead>
              <tbody>
                ${state.assistantOnlineQualityWindows
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.period}</strong><br /><span class="muted-text">${item.id} · ${item.version}<br />${item.collectedAt}</span></td>
                        <td>${item.sampleCount}</td>
                        <td>${item.citationCoverage}%</td>
                        <td>${item.answerAcceptance}%</td>
                        <td>${item.noAnswerRate}%</td>
                        <td>${item.escalationRate}%</td>
                        <td>${item.p95LatencyMs}ms</td>
                        <td>${item.safetyEvents}</td>
                        <td>${item.driftScore}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">在线质量事件</h3>
              <p class="panel-subtitle">异常窗口自动生成事件，记录越界信号、阈值、实际值、处置动作和恢复结果。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>事件</th><th>版本</th><th>越界信号</th><th>阈值/实际</th><th>处置动作</th><th>责任组</th><th>创建/解决</th><th>状态</th></tr></thead>
              <tbody>
                ${
                  state.assistantQualityIncidents.length
                    ? state.assistantQualityIncidents
                        .map(
                          (item) => `
                            <tr>
                              <td><strong>${item.id}</strong><br /><span class="status-pill ${statusClass(item.level)}">${item.level}</span></td>
                              <td>${item.version}<br /><span class="muted-text">${item.deploymentId}</span></td>
                              <td>${item.signal}</td>
                              <td>${item.threshold}<br /><strong>${item.actual}</strong></td>
                              <td>${item.action}</td>
                              <td>${item.owner}</td>
                              <td>${item.createdAt}<br /><span class="muted-text">${item.resolvedAt || "待解决"}</span></td>
                              <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                            </tr>
                          `,
                        )
                        .join("")
                    : `<tr><td colspan="8"><span class="muted-text">暂无质量事件，当前线上指标处于护栏范围内。</span></td></tr>`
                }
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "feedback") {
      content = `
        <div class="grid-4">
          ${metric("负向反馈", summary.negativeFeedback, `${state.assistantFeedbackRecords.length}条线上反馈`, summary.negativeFeedback ? "warn" : "")}
          ${metric("待人工研判", summary.pendingFeedbackReview, "反馈不得直接修改模型", summary.pendingFeedbackReview ? "danger" : "")}
          ${metric("待标注样本", summary.pendingSampleLabeling, `${summary.includedSamples}条已入集或验证`, summary.pendingSampleLabeling ? "warn" : "")}
          ${metric("开放改进周期", summary.openImprovementCycles, "入集后必须完成回归验证", summary.openImprovementCycles ? "warn" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">线上反馈研判</h3>
              <p class="panel-subtitle">统一接收回答评价和试点工单；负向反馈需人工确认问题性质后，才能转为改进样本。</p>
            </div>
            <button class="button secondary" type="button" data-action="collect-assistant-feedback">采集试点反馈</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>反馈</th><th>版本/问答</th><th>评分</th><th>问题原因</th><th>反馈说明</th><th>引用有效</th><th>来源/时间</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantFeedbackRecords
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="status-pill ${statusClass(item.sentiment)}">${item.sentiment}</span></td>
                        <td>${item.version}<br /><span class="muted-text">${item.deploymentId} · ${item.questionId}</span></td>
                        <td><strong>${item.rating}/5</strong></td>
                        <td>${item.reason}</td>
                        <td>${escapeHtml(item.comment)}</td>
                        <td>${item.citationUseful ? "是" : "否"}</td>
                        <td>${item.channel} · ${item.userRole}<br /><span class="muted-text">${item.createdAt}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span><br /><span class="muted-text">${item.reviewedBy || "待指派"}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="review-assistant-feedback" data-id="${item.id}" ${item.status === "待研判" ? "" : "disabled"}>人工研判</button><button class="button ghost" type="button" data-action="convert-feedback-sample" data-id="${item.id}" ${item.sentiment === "负向" && item.status === "已研判" ? "" : "disabled"}>转改进样本</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">改进样本标注与入集</h3>
              <p class="panel-subtitle">样本必须补充标准答案和来源证据，经标注后才能纳入指定评测集并形成新的改进周期。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>样本</th><th>来源反馈/版本</th><th>领域</th><th>问题</th><th>标准答案</th><th>来源证据</th><th>风险</th><th>目标评测集</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantImprovementSamples
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.id}</strong><br /><span class="muted-text">${item.owner}</span></td>
                        <td>${item.feedbackId}<br /><span class="muted-text">${item.sourceVersion}</span></td>
                        <td><span class="tag">${item.domain}</span></td>
                        <td>${escapeHtml(item.question)}</td>
                        <td>${item.expectedAnswer ? escapeHtml(item.expectedAnswer) : `<span class="muted-text">待专家标注</span>`}</td>
                        <td>${item.sourceEvidence.map((source) => `<span class="tag">${source}</span>`).join(" ")}</td>
                        <td><span class="status-pill ${statusClass(item.riskLevel)}">${item.riskLevel}</span></td>
                        <td>${item.targetSuiteId}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span><br /><span class="muted-text">${item.updatedAt}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="annotate-improvement-sample" data-id="${item.id}" ${item.status === "待标注" ? "" : "disabled"}>专家标注</button><button class="button ghost" type="button" data-action="include-improvement-sample" data-id="${item.id}" ${item.status === "已标注" ? "" : "disabled"}>纳入评测集</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">持续改进回归周期</h3>
              <p class="panel-subtitle">每次样本入集形成独立周期，固定反馈、样本、评测集和目标版本；通过回归后才关闭问题。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>改进周期</th><th>反馈证据</th><th>样本</th><th>目标评测集</th><th>目标版本</th><th>回归运行</th><th>责任组</th><th>开始/完成</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.assistantImprovementCycles
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.sourceFeedbackIds.join("<br />")}</td>
                        <td>${item.sampleIds.join("<br />")}</td>
                        <td>${item.targetSuiteId}</td>
                        <td>${item.targetVersion}</td>
                        <td>${item.evaluationRunId || "待运行"}</td>
                        <td>${item.owner}</td>
                        <td>${item.startedAt}<br /><span class="muted-text">${item.completedAt || "待完成"}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="run-improvement-regression" data-id="${item.id}" ${item.status === "待回归" ? "" : "disabled"}>运行回归验证</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("知识源", `${summary.activeSources}/${state.assistantKnowledgeSources.length}`, `${summary.knowledgeChunks}个知识片段`)}
        ${metric("待确认问答", summary.pendingQuestions, `平均置信度${summary.averageConfidence}%`, summary.pendingQuestions ? "warn" : "")}
        ${metric("待采纳建议", summary.pendingSuggestions, `${summary.adoptedSuggestions}项已转整改`, summary.pendingSuggestions ? "warn" : "")}
        ${metric("开放审核风险", summary.openRisks, `${summary.highRisks}项高风险`, summary.highRisks ? "danger" : "")}
      </div>
      <div class="segmented assistant-tabs" role="tablist" aria-label="评价助手功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-assistant-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderMonitoring() {
    header("运营监控");
    const tab = workspace.dataset.monitoringTab || "services";
    const summary = monitoringSummary();
    const tabs = [
      { id: "services", label: "服务监控" },
      { id: "interfaces", label: "接口健康" },
      { id: "queues", label: "任务队列" },
      { id: "storage", label: "存储容量" },
    ];
    let content = "";

    if (tab === "services") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">核心服务可用性</h3>
              <p class="panel-subtitle">监控服务可用率、响应时延、SLA和当日事件，并支持快速恢复。</p>
            </div>
            <button class="button secondary" type="button" data-action="run-monitoring-check">立即巡检</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>服务</th><th>组件</th><th>可用率</th><th>SLA</th><th>响应时延</th><th>当日事件</th><th>状态</th><th>最近检测</th><th>操作</th></tr></thead>
              <tbody>
                ${state.serviceHealth
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.component}</td>
                        <td>${item.availability.toFixed(2)}%</td>
                        <td>${item.sla}%</td>
                        <td>${item.latency}ms</td>
                        <td>${item.incidents}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.lastCheck}</td>
                        <td><button class="button ghost" type="button" data-action="recover-service" data-id="${item.id}" ${item.status === "正常" ? "disabled" : ""}>恢复</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "interfaces") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">接口健康度</h3>
              <p class="panel-subtitle">按调用方监测成功率、P95时延、吞吐和最近错误。</p>
            </div>
            <button class="button secondary" type="button" data-action="probe-interfaces">批量探测</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>接口</th><th>路径</th><th>调用方</th><th>成功率</th><th>P95</th><th>吞吐/分钟</th><th>最近错误</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.interfaceHealth
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td><code>${item.path}</code></td>
                        <td>${item.consumer}</td>
                        <td>${item.successRate.toFixed(1)}%</td>
                        <td>${item.p95}ms</td>
                        <td>${item.throughput}</td>
                        <td>${item.lastError || "无"}<br /><span class="muted-text">${item.lastCheck}</span></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><button class="button ghost" type="button" data-action="retry-interface" data-id="${item.id}" ${item.status === "正常" ? "disabled" : ""}>重试</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "queues") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">异步任务队列</h3>
              <p class="panel-subtitle">监控积压、失败、最长等待和工作进程容量。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>队列</th><th>待处理</th><th>运行中</th><th>失败</th><th>最长等待</th><th>工作进程</th><th>容量</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.jobQueues
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.pending}</td>
                        <td>${item.running}</td>
                        <td>${item.failed}</td>
                        <td>${item.oldestWait}分钟</td>
                        <td>${item.workers}</td>
                        <td><div class="queue-progress"><span style="width:${Math.min(100, Math.round((item.pending / Math.max(1, item.capacity)) * 100))}%"></span></div><small>${item.pending}/${item.capacity}</small></td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="scale-queue" data-id="${item.id}">扩容</button><button class="button ghost" type="button" data-action="prioritize-queue" data-id="${item.id}" ${item.pending === 0 ? "disabled" : ""}>提速</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "storage") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">存储容量与留存</h3>
              <p class="panel-subtitle">跟踪业务、证据、审计与备份存储的容量、增长和留存策略。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>存储池</th><th>用途</th><th>已用/总量</th><th>使用率</th><th>日增长</th><th>留存策略</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${state.storagePools
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.name}</strong><br /><span class="muted-text">${item.id}</span></td>
                        <td>${item.purpose}</td>
                        <td>${item.used}/${item.total}${item.unit}</td>
                        <td><div class="queue-progress"><span style="width:${item.usage}%"></span></div><small>${item.usage}%</small></td>
                        <td>${item.growthDaily}GB</td>
                        <td>${item.retention}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td><div class="toolbar inline"><button class="button ghost" type="button" data-action="expand-storage" data-id="${item.id}">扩容</button><button class="button ghost" type="button" data-action="clean-storage" data-id="${item.id}">清理</button></div></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("服务可用率", `${summary.availability.toFixed(2)}%`, `${summary.degradedServices}项服务需关注`, summary.degradedServices ? "danger" : "")}
        ${metric("接口异常", summary.unhealthyInterfaces, "预警与异常接口", summary.unhealthyInterfaces ? "danger" : "")}
        ${metric("队列积压", summary.queueBacklog, "全部异步任务")}
        ${metric("开放告警", summary.activeAlerts, `${summary.urgentAlerts}项高优先级`, summary.urgentAlerts ? "danger" : "")}
      </div>
      <div class="segmented monitoring-tabs" role="tablist" aria-label="运营监控功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-monitoring-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">统一告警处置</h3>
            <p class="panel-subtitle">告警确认、处置和关闭过程进入审计留痕。</p>
          </div>
          <span class="status-pill ${summary.urgentAlerts ? "danger" : ""}">${summary.activeAlerts}项开放</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>告警</th><th>来源</th><th>级别</th><th>责任组</th><th>发生时间</th><th>状态</th><th>处置时间</th><th>操作</th></tr></thead>
            <tbody>
              ${state.monitoringAlerts
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.title}</strong><br /><span class="muted-text">${item.id}</span></td>
                      <td>${item.source}</td>
                      <td><span class="status-pill ${statusClass(item.level)}">${item.level}</span></td>
                      <td>${item.owner}</td>
                      <td>${item.createdAt}</td>
                      <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      <td>${item.handledAt || "-"}</td>
                      <td><button class="button ghost" type="button" data-action="ack-monitoring-alert" data-id="${item.id}" ${item.status === "已关闭" || item.status === "已确认" ? "disabled" : ""}>确认</button></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderPublicHealth() {
    header("公共卫生");
    const publicHealth = state.publicHealth;
    const incidents = filteredPublicHealthIncidents();
    const summary = publicHealthSummary(incidents);
    const tab = workspace.dataset.publicHealthTab || "incidents";
    const tabs = [
      { id: "incidents", label: "事件处置" },
      { id: "evidence", label: "证据签收" },
      { id: "analytics", label: "处置统计" },
      { id: "continuity", label: "通道连续性" },
      { id: "readiness", label: "上线边界" },
    ];
    const hospitalFilter = workspace.dataset.publicHealthHospital || "全部";
    const statusFilter = workspace.dataset.publicHealthStatus || "全部";
    const levelFilter = workspace.dataset.publicHealthLevel || "全部";
    const slaFilter = workspace.dataset.publicHealthSla || "全部";
    const requiredChainLinks = Math.max(0, publicHealth.requiredConsecutiveCampaigns - 1);
    const continuityLabel = publicHealth.continuousConnectivityReady ? "连续已验证" : "连续性中断";
    const laneName = (laneId) => publicHealth.lanes.find((item) => item.id === laneId)?.name || laneId;
    const nextActionLabel = (status) =>
      ({
        待核查: "开始处置",
        处置中: "提交复核",
        待复核: "复核关闭",
        已关闭: "已闭环",
      })[status] || "推进处置";
    let content = "";

    if (tab === "incidents") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">公共卫生异常事件台账</h3>
              <p class="panel-subtitle">统一承接规则监测、数据校验和业务反馈，按核查、处置、独立复核、关闭形成责任闭环。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="create-public-health-incident">登记异常事件</button>
              <button class="button ghost" type="button" data-action="export-public-health-incidents" data-format="json">导出JSON</button>
              <button class="button ghost" type="button" data-action="export-public-health-incidents" data-format="csv">导出CSV</button>
            </div>
          </div>
          <div class="toolbar">
            <label class="field">
              <span>医院范围</span>
              <select data-public-health-filter="publicHealthHospital">
                <option>全部</option>
                ${state.hospitals.map((item) => `<option value="${escapeHtml(item.code)}" ${hospitalFilter === item.code ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>事件状态</span>
              <select data-public-health-filter="publicHealthStatus">
                ${["全部", "待核查", "处置中", "待复核", "已关闭"].map((item) => `<option ${statusFilter === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>事件级别</span>
              <select data-public-health-filter="publicHealthLevel">
                ${["全部", "P0", "P1", "P2"].map((item) => `<option ${levelFilter === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </label>
            <label class="field">
              <span>SLA</span>
              <select data-public-health-filter="publicHealthSla">
                ${["全部", "已超时", "已升级"].map((item) => `<option ${slaFilter === item ? "selected" : ""}>${item}</option>`).join("")}
              </select>
            </label>
            <button class="button ghost" type="button" data-action="reset-public-health-filters">重置</button>
            <span class="tag">当前${incidents.length}条</span>
          </div>
          <div class="table-wrap">
            <table class="public-health-incident-table">
              <thead><tr><th>事件</th><th>业务通道</th><th>机构</th><th>级别</th><th>SLA/升级</th><th>专业系统关联</th><th>关闭证据</th><th>责任组</th><th>状态/版本</th><th>当前处置</th><th>操作</th></tr></thead>
              <tbody>
                ${incidents
                  .map(
                    (item) => {
                      const sla = publicHealthIncidentSla(item);
                      const association = publicHealthProfessionalAssociation(item);
                      const closureGate = publicHealthClosureGate(item);
                      return `
                      <tr>
                        <td><strong>${escapeHtml(item.title)}</strong><br /><span class="muted-text">${escapeHtml(item.id)} · ${escapeHtml(item.source)}</span></td>
                        <td>${escapeHtml(laneName(item.laneId))}</td>
                        <td>${escapeHtml(item.hospitalCode)}</td>
                        <td><span class="status-pill ${item.level === "P0" ? "danger" : "warn"}">${escapeHtml(item.level)}</span></td>
                        <td>
                          <span class="status-pill ${sla.overdue && item.status !== "已关闭" ? "danger" : sla.dueSoon ? "warn" : ""}">${escapeHtml(sla.status)}</span>
                          <br /><span class="muted-text">${item.escalation?.escalatedAt ? `${escapeHtml(item.escalation.level)} · 已升级` : escapeHtml(item.dueAt)}</span>
                        </td>
                        <td>
                          <strong>${escapeHtml(association.eventId || "未关联专业事件")}</strong>
                          <br /><span class="muted-text">${escapeHtml(association.exchangeRunId || "无交换运行")} · ${escapeHtml(association.receiptStatus || "无回执")}</span>
                          <br /><span class="muted-text">${escapeHtml(association.probeStatus)} · 生产可信探测待现场</span>
                        </td>
                        <td>
                          <span class="status-pill ${closureGate.ready ? "" : "warn"}">${closureGate.ready ? "可关闭" : "待补证"}</span>
                          <br /><span class="muted-text">${closureGate.accepted}/${closureGate.required} 已独立签收</span>
                        </td>
                        <td>${escapeHtml(item.owner)}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${escapeHtml(item.status)}</span><br /><span class="muted-text">r${Number(item.revision || 1)}</span></td>
                        <td>${escapeHtml(item.latestAction)}</td>
                        <td>
                          <div class="toolbar inline">
                            <button class="button ghost" type="button" data-action="advance-public-health-incident" data-id="${escapeHtml(item.id)}" ${item.status === "已关闭" ? "disabled" : ""}>${nextActionLabel(item.status)}</button>
                            ${item.status !== "已关闭" && !closureGate.ready
                              ? `<button class="button ghost" type="button" data-action="record-public-health-evidence" data-id="${escapeHtml(item.id)}">登记证据</button>`
                              : ""}
                            ${sla.overdue && item.status !== "已关闭" && !item.escalation?.escalatedAt
                              ? `<button class="button secondary" type="button" data-action="escalate-public-health-incident" data-id="${escapeHtml(item.id)}">超时升级</button>`
                              : ""}
                          </div>
                        </td>
                      </tr>
                    `;
                    },
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">处置留痕</h3>
              <p class="panel-subtitle">状态推进绑定动作、责任人、时间、结果和修订号，可随协同包导出审计。</p>
            </div>
            <span class="tag">${publicHealth.incidentActions.length}条记录</span>
          </div>
          <div class="timeline-list">
            ${publicHealth.incidentActions
              .slice(0, 8)
              .map(
                (item) => `
                  <article class="timeline-item">
                    <time>${escapeHtml(item.at)}</time>
                    <strong>${escapeHtml(item.action)} · ${escapeHtml(item.incidentId)}</strong>
                    <span>${escapeHtml(item.actor)} · r${Number(item.revision || 1)}</span>
                    <p>${escapeHtml(item.result)}</p>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
      `;
    }

    if (tab === "evidence") {
      const evidenceRows = publicHealth.incidentEvidence
        .filter((item) => incidents.some((incident) => incident.id === item.incidentId))
        .sort((left, right) => String(right.submittedAt).localeCompare(String(left.submittedAt)));
      const pendingEvidence = evidenceRows.filter((item) => item.status === "submitted").length;
      const acceptedEvidence = evidenceRows.filter((item) => item.status === "accepted").length;
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">现场证据签收台账</h3>
              <p class="panel-subtitle">仅登记证据编号、最小化摘要和SHA-256摘要；提交人与签收人必须分离，原始附件留在受控证据库。</p>
            </div>
            <span class="tag">${pendingEvidence}待签收 · ${acceptedEvidence}已签收</span>
          </div>
          <div class="table-wrap">
            <table class="public-health-evidence-table">
              <thead><tr><th>证据</th><th>关联事件</th><th>机构</th><th>类型</th><th>提交</th><th>独立复核</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                ${evidenceRows.length
                  ? evidenceRows.map((item) => {
                    const incident = publicHealth.incidents.find((row) => row.id === item.incidentId);
                    const canReview = item.status === "submitted" && item.submittedBy !== state.activeRole;
                    return `
                      <tr>
                        <td><strong>${escapeHtml(item.referenceNo)}</strong><br /><span class="muted-text">${escapeHtml(item.id)} · r${Number(item.revision || 1)}</span></td>
                        <td>${escapeHtml(incident?.title || item.incidentId)}<br /><span class="muted-text">${escapeHtml(item.incidentId)}</span></td>
                        <td>${escapeHtml(item.hospitalCode)}</td>
                        <td>${escapeHtml(publicHealthEvidenceLabels[item.evidenceType] || item.evidenceType)}</td>
                        <td>${escapeHtml(item.submittedBy)}<br /><span class="muted-text">${escapeHtml(item.submittedAt)}</span></td>
                        <td>${escapeHtml(item.reviewedBy || "待独立签收")}<br /><span class="muted-text">${escapeHtml(item.reviewedAt || item.summary)}</span></td>
                        <td><span class="status-pill ${item.status === "rejected" ? "danger" : item.status === "submitted" ? "warn" : ""}">${item.status === "accepted" ? "已签收" : item.status === "rejected" ? "已驳回" : "待签收"}</span></td>
                        <td>
                          <div class="toolbar inline">
                            <button class="button ghost" type="button" data-action="review-public-health-evidence" data-id="${escapeHtml(item.id)}" data-decision="accept" ${canReview ? "" : "disabled"}>签收</button>
                            <button class="button ghost" type="button" data-action="review-public-health-evidence" data-id="${escapeHtml(item.id)}" data-decision="reject" ${canReview ? "" : "disabled"}>驳回</button>
                          </div>
                        </td>
                      </tr>
                    `;
                  }).join("")
                  : `<tr><td colspan="8" class="empty-cell">当前筛选范围暂无证据记录。</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">关闭门禁</h3>
              <p class="panel-subtitle">P2要求业务回执和现场联调；P1增加生产审批；P0再增加灾备与回退演练。</p>
            </div>
            <span class="status-pill danger">productionReady=false</span>
          </div>
          <div class="detail-list compact-list">
            ${incidents.filter((item) => item.status !== "已关闭").map((item) => {
              const gate = publicHealthClosureGate(item);
              return `
                <article class="detail-item">
                  <header>
                    <div><h4>${escapeHtml(item.title)}</h4><p>${escapeHtml(item.id)} · ${escapeHtml(item.level)} · ${gate.accepted}/${gate.required}已签收</p></div>
                    <span class="status-pill ${gate.ready ? "" : "warn"}">${gate.ready ? "可提交关闭" : "待补证"}</span>
                  </header>
                  <p>${gate.missingTypes.length ? `缺少：${gate.missingTypes.map((type) => publicHealthEvidenceLabels[type]).join("、")}` : "关闭前置证据已齐备，仍需独立业务复核。"}</p>
                </article>
              `;
            }).join("")}
          </div>
        </section>
      `;
    }

    if (tab === "analytics") {
      const allIncidents = state.publicHealth.incidents;
      const countBy = (selector) => Object.entries(allIncidents.reduce((counts, item) => {
        const key = selector(item);
        counts[key] = Number(counts[key] || 0) + 1;
        return counts;
      }, {}));
      const hospitalCounts = countBy((item) => item.hospitalCode);
      const laneCounts = countBy((item) => laneName(item.laneId));
      const statusCounts = countBy((item) => item.status);
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">事件处置统计</h3>
              <p class="panel-subtitle">按医院、业务通道和状态汇总协同事件，SLA超时与升级动作独立计数。</p>
            </div>
            <span class="tag">${allIncidents.length}条事件</span>
          </div>
          <div class="grid-4">
            ${metric("开放事件", publicHealthSummary(allIncidents).openIncidents, "未进入关闭终态")}
            ${metric("SLA超时", publicHealthSummary(allIncidents).overdueIncidents, "需按级别升级", publicHealthSummary(allIncidents).overdueIncidents ? "danger" : "")}
            ${metric("已升级", publicHealthSummary(allIncidents).escalatedIncidents, "升级动作独立留痕")}
            ${metric("证据可关闭", publicHealthSummary(allIncidents).closureReady, "证据齐备且待复核")}
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>统计维度</th><th>对象</th><th>事件数</th><th>运营动作</th></tr></thead>
              <tbody>
                ${hospitalCounts.map(([key, count]) => `<tr><td>医院</td><td>${escapeHtml(state.hospitals.find((item) => item.code === key)?.name || key)}</td><td>${count}</td><td>按医院筛选、导出和催办</td></tr>`).join("")}
                ${laneCounts.map(([key, count]) => `<tr><td>业务通道</td><td>${escapeHtml(key)}</td><td>${count}</td><td>核对专业事件、交换回执和证据包</td></tr>`).join("")}
                ${statusCounts.map(([key, count]) => `<tr><td>处置状态</td><td>${escapeHtml(key)}</td><td>${count}</td><td>执行状态推进或独立复核</td></tr>`).join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "continuity") {
      const breakLabel = publicHealth.continuityBreak
        ? `${escapeHtml(publicHealth.continuityBreak.campaignId)} · ${escapeHtml(publicHealth.continuityBreak.code)}`
        : "当前窗口无中断";
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">端点与连续探测总览</h3>
              <p class="panel-subtitle">传染病、免疫规划、妇幼、老年健康、慢病、公卫随访、健康教育和家庭医生八通道统一核验。</p>
            </div>
            <span class="status-pill ${publicHealth.continuousConnectivityReady ? "" : "danger"}">${continuityLabel}</span>
          </div>
          <div class="toolbar">
            <button class="button secondary" type="button" data-action="simulate-public-health-break">演示最新活动失败</button>
            <button class="button secondary" type="button" data-action="simulate-public-health-chain-break">演示前序链缺口</button>
            <button class="button ghost" type="button" data-action="restore-public-health-continuity">恢复受控连续窗口</button>
            <span class="tag">受控验收样例</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>业务通道</th><th>责任部门</th><th>端点</th><th>单次探测</th><th>当前活动</th></tr></thead>
              <tbody>
                ${publicHealth.lanes
                  .map(
                    (lane) => `
                      <tr>
                        <td><strong>${escapeHtml(lane.name)}</strong><br /><span class="muted-text">${escapeHtml(lane.id)}</span></td>
                        <td>${escapeHtml(lane.owner)}</td>
                        <td><span class="status-pill">${escapeHtml(lane.endpoint)}</span></td>
                        <td><span class="status-pill ${lane.probe === "已验证" ? "" : "danger"}">${escapeHtml(lane.probe)}</span></td>
                        <td>${escapeHtml(lane.campaign)}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">当前连续窗口</h3>
              <p class="panel-subtitle">按服务端完成时间倒序计算，失败记录或签名前序缺口均不得被跳过。</p>
            </div>
            <span class="tag">${publicHealth.campaigns.length}次活动 · 前序链${publicHealth.campaignChainLinksVerified}/${requiredChainLinks}</span>
          </div>
          <div class="timeline-list">
            ${publicHealth.campaigns
              .slice()
              .reverse()
              .map(
                (campaign) => `
                  <article class="timeline-item">
                    <time>${escapeHtml(campaign.completedAt)}</time>
                    <strong>${escapeHtml(campaign.id)}</strong>
                    <span>${campaign.receipts}/8 回执 · ${campaign.chain === "verified" ? "前序链已验证" : campaign.chain === "mismatch" ? "前序链不匹配" : "链起点"}</span>
                    <p><span class="status-pill ${campaign.status === "已验证" ? "" : "danger"}">${escapeHtml(campaign.status)}</span></p>
                  </article>
                `,
              )
              .join("")}
          </div>
          <article class="detail-item">
            <header>
              <div><h4>连续性判定</h4><p>活动编号与稳定原因码</p></div>
              <span class="status-pill ${publicHealth.continuityBreak ? "danger" : ""}">${publicHealth.continuityBreak ? "失败关闭" : "窗口完整"}</span>
            </header>
            <p>${breakLabel}</p>
          </article>
        </section>
      `;
    }

    if (tab === "readiness") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">生产上线边界</h3>
              <p class="panel-subtitle">通道连通和事件清零不自动授予生产权限，现场证据、回退演练和多方审批仍需独立完成。</p>
            </div>
            <span class="status-pill danger">productionReady=false</span>
          </div>
          <div class="detail-list compact-list">
            ${publicHealth.blockers
              .map(
                (blocker, index) => `
                  <article class="detail-item">
                    <header>
                      <div><h4>${index === 0 ? "P0" : "P1"} 上线阻断</h4><p>${escapeHtml(blocker)}</p></div>
                      <span class="status-pill danger">待外部验收</span>
                    </header>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">正式运行接口</h3>
              <p class="panel-subtitle">正式事件账本使用平台鉴权、乐观锁和独立复核；演示按钮不连接生产端点。</p>
            </div>
            <span class="tag">GitHub v0.21</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>用途</th><th>方法</th><th>路由</th><th>控制</th></tr></thead>
              <tbody>
                <tr><td>协同总览</td><td>GET</td><td>/api/digital-hospital/public-health/coordination</td><td>卫健委角色与审计</td></tr>
                <tr><td>登记事件</td><td>POST</td><td>/api/digital-hospital/public-health/incidents</td><td>敏感字段拒绝</td></tr>
                <tr><td>推进/升级</td><td>POST</td><td>/api/digital-hospital/public-health/incidents/{id}/actions</td><td>修订号、独立复核、SLA超时升级</td></tr>
                <tr><td>登记关闭证据</td><td>POST</td><td>/api/digital-hospital/public-health/incidents/{id}/evidence</td><td>证据编号、最小化摘要、SHA-256摘要</td></tr>
                <tr><td>证据签收/驳回</td><td>POST</td><td>/api/digital-hospital/public-health/evidence/{id}/actions</td><td>双修订号、提交签收分离、审计留痕</td></tr>
                <tr><td>事件导出</td><td>GET</td><td>/api/digital-hospital/public-health/incidents/export</td><td>医院筛选、安全摘要、JSON/CSV</td></tr>
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("业务通道", `${summary.verifiedLanes}/${summary.totalLanes}`, "本批受控探测已验证")}
        ${metric("开放事件", summary.openIncidents, `${summary.overdueIncidents}项SLA超时`, summary.overdueIncidents ? "danger" : "")}
        ${metric("P0事件", summary.p0Incidents, `${summary.escalatedIncidents}项已升级`, summary.p0Incidents ? "danger" : "")}
        ${metric("连续活动", `${publicHealth.consecutiveCampaigns}/${publicHealth.requiredConsecutiveCampaigns}`, continuityLabel, summary.continuityReady ? "" : "danger")}
      </div>
      <div class="segmented monitoring-tabs" role="tablist" aria-label="公共卫生协同功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-public-health-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderStandards() {
    header("标准指标");
    const selectedDomain = workspace.dataset.domain || "全部";
    const selectedPriority = workspace.dataset.priority || "全部";
    const search = workspace.dataset.search || "";
    const rows = indicators.filter((indicator) => {
      const matchDomain = selectedDomain === "全部" || indicator.domain === selectedDomain;
      const matchPriority = selectedPriority === "全部" || indicator.priority === selectedPriority;
      const matchSearch = !search || `${indicator.code}${indicator.name}${indicator.evidence}`.includes(search);
      return matchDomain && matchPriority && matchSearch;
    });
    workspace.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">指标库样例</h3>
            <p class="panel-subtitle">当前发布版已载入完整${indicators.length}项试点指标，覆盖八大指标域、权重、采集方式和证据要求。</p>
          </div>
          <span class="tag">标准版本 ${state.task.standard}</span>
        </div>
        <div class="toolbar">
          <label class="field">
            <span>指标域</span>
            <select data-filter="domain">
              <option>全部</option>
              ${domains.map((domain) => `<option value="${domain.code}" ${selectedDomain === domain.code ? "selected" : ""}>${domain.code} ${domain.name}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>优先级</span>
            <select data-filter="priority">
              ${["全部", "P0", "P1", "P2"].map((p) => `<option ${selectedPriority === p ? "selected" : ""}>${p}</option>`).join("")}
            </select>
          </label>
          <label class="field">
            <span>关键词</span>
            <input data-filter="search" value="${search}" placeholder="指标名称、编码、证据" />
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>编码</th><th>一级指标域</th><th>指标名称</th><th>分值</th><th>评分</th><th>采集</th><th>证据要求</th><th>优先级</th></tr>
            </thead>
            <tbody>
              ${rows
                .map(
                  (indicator) => `
                <tr>
                  <td><strong>${indicator.code}</strong></td>
                  <td>${domainName(indicator.domain)}</td>
                  <td>${indicator.name}</td>
                  <td>${indicator.max}</td>
                  <td>${indicator.method}</td>
                  <td>${indicator.source}</td>
                  <td>${indicator.evidence}</td>
                  <td><span class="priority">${indicator.priority}</span></td>
                </tr>
              `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderSubmission() {
    header("医院申报");
    const hospital = activeHospital();
    const submission = submissionForActive();
    const progress = progressSnapshot();
    workspace.innerHTML = `
      <div class="grid-3">
        ${metric("当前医院", hospital.name, `${hospital.level} ${hospital.type} | ${hospital.city}`)}
        ${metric("已填指标", `${progress.filled}/${progress.total}`, "自评分大于0视为已填")}
        ${metric("证据覆盖", `${progress.evidenceReady}/${progress.total}`, "至少1份材料视为已覆盖")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">指标自评填报</h3>
            <p class="panel-subtitle">黄色字段为可编辑区，调整后自动保存到浏览器本地。</p>
          </div>
          <button class="button secondary" type="button" data-action="mark-submitted">提交申报</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr><th>指标</th><th>名称</th><th>满分</th><th>自评分</th><th>材料数</th><th>说明</th><th>状态</th></tr>
            </thead>
            <tbody>
              ${indicators
                .map((indicator) => {
                  const entry = submission[indicator.code];
                  return `
                    <tr>
                      <td><strong>${indicator.code}</strong></td>
                      <td>${indicator.name}<br /><small>${domainName(indicator.domain)}</small></td>
                      <td>${indicator.max}</td>
                      <td><input class="input-zone score-input" type="number" min="0" max="${indicator.max}" value="${entry.selfScore}" data-update-score="${indicator.code}" /></td>
                      <td><input class="input-zone score-input" type="number" min="0" max="20" value="${entry.evidenceCount}" data-update-evidence="${indicator.code}" /></td>
                      <td><textarea class="input-zone" data-update-comment="${indicator.code}">${entry.comment}</textarea></td>
                      <td><span class="status-pill ${entry.status === "已提交" ? "" : "warn"}">${entry.status}</span></td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderEvidence() {
    header("证据材料");
    const summary = evidenceSummary();
    const materials = evidenceForActive();
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("材料总数", summary.total, "当前医院已上传")}
        ${metric("指标覆盖", `${summary.covered}/${indicators.length}`, "至少1份材料")}
        ${metric("待复核", summary.pending, "格式、版本或敏感审批")}
        ${metric("高敏材料", summary.sensitive, `${summary.expiring}份临近过期`)}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">材料台账</h3>
            <p class="panel-subtitle">材料按任务、医院、指标关联，支持版本、敏感级别、水印和导出审批。</p>
          </div>
          <div class="toolbar inline">
            <button class="button secondary" type="button" data-action="add-evidence">模拟上传材料</button>
            <button class="button ghost" type="button" data-action="approve-export">审批敏感导出</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>材料</th><th>关联指标</th><th>类型/版本</th><th>敏感级别</th><th>状态</th><th>有效期</th><th>操作</th></tr></thead>
            <tbody>
              ${materials
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.name}</strong><br><span class="muted-text">${item.uploadedBy} | ${item.uploadedAt}</span></td>
                      <td>${item.indicatorCode} ${indicatorByCode(item.indicatorCode)?.name || ""}</td>
                      <td>${item.type} / v${item.version}</td>
                      <td><span class="risk ${["S4", "S5"].includes(item.sensitivity) ? "blocker" : "warn"}">${item.sensitivity}</span></td>
                      <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                      <td>${item.expireAt}</td>
                      <td>
                        <div class="toolbar inline">
                          <button class="button ghost" type="button" data-action="verify-evidence" data-id="${item.id}">校验</button>
                          <button class="button ghost" type="button" data-action="version-evidence" data-id="${item.id}">新版本</button>
                        </div>
                      </td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">指标材料缺口</h3>
            <p class="panel-subtitle">按证据目录自动识别缺材料指标，支持提交前自查。</p>
          </div>
          <span class="tag">缺口 ${Math.max(0, indicators.length - summary.covered)} 项</span>
        </div>
        <div class="detail-list compact-list">
          ${indicators
            .filter((indicator) => !materials.some((item) => item.indicatorCode === indicator.code))
            .slice(0, 8)
            .map(
              (indicator) => `
                <article class="detail-item">
                  <header>
                    <div>
                      <h4>${indicator.code} ${indicator.name}</h4>
                      <p>${indicator.evidence}</p>
                    </div>
                    <span class="priority">${indicator.priority}</span>
                  </header>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderValidation() {
    header("数据校验");
    const issues = activeIssues(true);
    const openIssues = activeIssues();
    const missingRate = state.metrics.dataTotal > 0 ? state.metrics.missingRecords / state.metrics.dataTotal : 0;
    const successRate = state.metrics.interfaceCalls > 0 ? state.metrics.interfaceSuccess / state.metrics.interfaceCalls : 0;
    workspace.innerHTML = `
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">统计数据与规则校验</h3>
            <p class="panel-subtitle">修改数据后运行校验，可生成阻断、警告和提示问题。</p>
          </div>
          <button class="button secondary" type="button" data-action="run-validation">运行校验</button>
        </div>
        <div class="form-grid">
          ${metricInput("门诊总量", "outpatientTotal", state.metrics.outpatientTotal)}
          ${metricInput("线上预约量", "onlineAppointments", state.metrics.onlineAppointments)}
          ${metricInput("接口调用次数", "interfaceCalls", state.metrics.interfaceCalls)}
          ${metricInput("接口成功次数", "interfaceSuccess", state.metrics.interfaceSuccess)}
          ${metricInput("数据总记录数", "dataTotal", state.metrics.dataTotal)}
          ${metricInput("缺失记录数", "missingRecords", state.metrics.missingRecords)}
        </div>
      </section>
      <div class="grid-3">
        ${metric("开放问题", openIssues.length, state.lastValidatedAt ? `最近校验：${state.lastValidatedAt}` : "尚未运行校验")}
        ${metric("接口成功率", pct(successRate, 2), "低于98%触发警告")}
        ${metric("数据缺失率", pct(missingRate, 2), "超过1%触发警告")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">校验问题</h3>
            <p class="panel-subtitle">阻断问题未处理时不建议提交正式申报。</p>
          </div>
        </div>
        ${issues.length ? issueTable(issues, true) : `<div class="empty-state">暂无校验问题。点击“运行校验”生成结果。</div>`}
      </section>
    `;
  }

  function metricInput(label, key, value) {
    return `<label class="field"><span>${label}</span><input class="input-zone" type="number" min="0" value="${value}" data-metric="${key}" /></label>`;
  }

  function issueTable(issues, showResolve) {
    return `
      <div class="table-wrap">
        <table>
          <thead><tr><th>问题</th><th>指标</th><th>类型</th><th>级别</th><th>建议处理</th><th>状态</th>${showResolve ? "<th>操作</th>" : ""}</tr></thead>
          <tbody>
            ${issues
              .map(
                (issue) => `
              <tr>
                <td>${issue.description}</td>
                <td>${issue.indicatorCode} ${indicatorByCode(issue.indicatorCode)?.name || ""}</td>
                <td>${issue.type}</td>
                <td><span class="risk ${issue.severity === "blocker" ? "blocker" : "warn"}">${issue.severity === "blocker" ? "阻断" : "警告"}</span></td>
                <td>${issue.suggestion}</td>
                <td>${issue.status === "resolved" ? "已处理" : "待处理"}</td>
                ${showResolve ? `<td><button class="button ghost" type="button" data-action="resolve-issue" data-id="${issue.id}">标记处理</button></td>` : ""}
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderReview() {
    header("省级审核");
    const submission = submissionForActive();
    const issues = activeIssues();
    const unreviewed = indicators.filter((indicator) => submission[indicator.code]?.reviewedScore === null);
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("待审核指标", unreviewed.length, "未写入审核分")}
        ${metric("待处理问题", issues.length, "来自校验和退回补正")}
        ${metric("专家复核", state.reviewNotes.filter((note) => note.status === "专家复核").length, "已提交复核项")}
        ${metric("审核意见", state.reviewNotes.length, "全部留痕")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">省级审核任务池</h3>
            <p class="panel-subtitle">按医院、风险、提交时间和材料缺失分派审核任务，支持国家抽查和申诉复议。</p>
          </div>
          <div class="toolbar inline">
            <button class="button secondary" type="button" data-action="assign-review">自动分派</button>
            <button class="button ghost" type="button" data-action="national-spot-check">国家抽查</button>
            <button class="button ghost" type="button" data-action="create-appeal">登记申诉</button>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>医院</th><th>提交时间</th><th>风险</th><th>问题/材料</th><th>审核员</th><th>状态</th></tr></thead>
            <tbody>
              ${state.reviewAssignments
                .map(
                  (item) => `
                    <tr>
                      <td><strong>${item.hospitalName}</strong><br>${item.hospitalCode}</td>
                      <td>${item.submittedAt}</td>
                      <td><span class="risk ${item.risk === "高" ? "blocker" : "warn"}">${item.risk}</span></td>
                      <td>${item.issueCount}个问题 / ${item.materialMissing}项缺材料</td>
                      <td>${item.reviewer}</td>
                      <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">审核任务池</h3>
            <p class="panel-subtitle">可逐项通过、退回补正或提交专家复核。审核分默认等于医院自评分。</p>
          </div>
          <button class="button secondary" type="button" data-action="bulk-approve">批量通过无问题指标</button>
        </div>
        <div class="detail-list">
          ${indicators
            .map((indicator) => {
              const entry = submission[indicator.code];
              const relatedIssues = issues.filter((issue) => issue.indicatorCode === indicator.code);
              return `
                <article class="detail-item">
                  <header>
                    <div>
                      <h4>${indicator.code} ${indicator.name}</h4>
                      <p>${domainName(indicator.domain)} | 自评分 ${entry.selfScore}/${indicator.max} | 材料 ${entry.evidenceCount} 份</p>
                    </div>
                    <span class="status-pill ${entry.reviewedScore === null ? "warn" : ""}">${entry.reviewedScore === null ? "待审核" : `审核分 ${entry.reviewedScore}`}</span>
                  </header>
                  ${relatedIssues.length ? `<p>关联问题：${relatedIssues.map((issue) => issue.description).join("；")}</p>` : `<p>未发现开放校验问题。</p>`}
                  <div class="toolbar">
                    <button class="button" type="button" data-action="approve-indicator" data-code="${indicator.code}">通过</button>
                    <button class="button warn" type="button" data-action="return-indicator" data-code="${indicator.code}">退回补正</button>
                    <button class="button secondary" type="button" data-action="escalate-indicator" data-code="${indicator.code}">专家复核</button>
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      </section>
    `;
  }

  function renderExpert() {
    header("专家复核");
    const reviews = expertReviewsForActive();
    const summary = expertSummary();
    const history = reviews.filter((item) => item.status === "已复核");
    const activeReviews = reviews.filter((item) => item.status !== "已复核");
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("待复核", summary.pending, "专家尚未给出结论")}
        ${metric("高优先级", summary.highPriority, "关键指标或开放问题")}
        ${metric("需补证", summary.supplement, "退回医院补充材料")}
        ${metric("已完成", summary.completed, `调整扣分：${summary.adjusted}`)}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">专家复核任务池</h3>
            <p class="panel-subtitle">承接省级审核提交的争议指标、高风险指标和抽查复核事项。</p>
          </div>
          <div class="toolbar inline">
            <button class="button secondary" type="button" data-action="auto-expert-review">生成高风险复核任务</button>
            <button class="button ghost" type="button" data-action="download-package" data-kind="expert">下载复核包</button>
          </div>
        </div>
        ${
          activeReviews.length
            ? `<div class="detail-list expert-list">${activeReviews
                .map((review) => {
                  const indicator = indicatorByCode(review.indicatorCode);
                  const entry = submissionForHospital(review.hospitalCode)[review.indicatorCode] || {};
                  const issues = state.validationIssues.filter(
                    (issue) => issue.hospitalCode === review.hospitalCode && issue.indicatorCode === review.indicatorCode && issue.status !== "resolved",
                  );
                  const baseScore = Number(entry.reviewedScore ?? entry.selfScore ?? 0);
                  return `
                    <article class="detail-item expert-case">
                      <header>
                        <div>
                          <h4>${review.indicatorCode} ${indicator?.name || ""}</h4>
                          <p>${indicator ? domainName(indicator.domain) : "未匹配指标"} | ${review.expertGroup} | 提交人：${review.submittedBy}</p>
                        </div>
                        <div class="case-badges">
                          <span class="risk ${review.priority === "高" ? "blocker" : "warn"}">${review.priority}优先级</span>
                          <span class="status-pill ${statusClass(review.status)}">${review.status}</span>
                        </div>
                      </header>
                      <div class="expert-grid">
                        <div>
                          <p><strong>复核原因：</strong>${review.reason}</p>
                          <p><strong>关联问题：</strong>${issues.length ? issues.map((issue) => issue.description).join("；") : "暂无开放问题"}</p>
                          <p><strong>材料要求：</strong>${indicator?.evidence || "按指标证据目录补充"}</p>
                        </div>
                        <div class="score-box">
                          <span>当前建议分</span>
                          <strong>${baseScore}</strong>
                          <small>满分 ${indicator?.max || "-"} | 自评分 ${entry.selfScore ?? "-"}</small>
                        </div>
                      </div>
                      <div class="toolbar">
                        <button class="button" type="button" data-action="expert-agree" data-id="${review.id}">同意省审</button>
                        <button class="button secondary" type="button" data-action="expert-adjust" data-id="${review.id}">调整扣分</button>
                        <button class="button warn" type="button" data-action="expert-supplement" data-id="${review.id}">要求补证</button>
                      </div>
                    </article>
                  `;
                })
                .join("")}</div>`
            : `<div class="empty-state">暂无待处理专家复核任务。可从省级审核页提交复核，或生成高风险复核任务。</div>`
        }
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">复核结论留痕</h3>
            <p class="panel-subtitle">专家结论会回写审核分，并纳入评分、整改和数据包。</p>
          </div>
          <span class="tag">已完成 ${history.length} 项</span>
        </div>
        ${
          reviews.length
            ? `<div class="timeline-list">${reviews
                .map(
                  (item) => `
                    <article class="timeline-item">
                      <time>${item.completedAt || item.submittedAt}</time>
                      <span>${item.expertGroup}</span>
                      <strong>${item.indicatorCode} ${item.resultType || item.status}</strong>
                      <p>${item.conclusion || item.reason}</p>
                    </article>
                  `,
                )
                .join("")}</div>`
            : `<div class="empty-state">暂无复核记录。</div>`
        }
      </section>
    `;
  }

  function renderScore() {
    header("评分整改");
    const score = scoreSnapshot();
    const openIssues = activeIssues();
    const rectifications = state.rectifications.filter((item) => item.hospitalCode === state.selectedHospital);
    workspace.innerHTML = `
      <section class="panel chart-band">
        <div>
          <div class="panel-header">
            <div>
              <h3 class="panel-title">评分结果</h3>
              <p class="panel-subtitle">综合分按八大指标域权重计算。底线问题和阻断问题应单独复核。</p>
            </div>
            <button class="button secondary" type="button" data-action="confirm-score">确认结果</button>
          </div>
          <div class="bar-stack">
            ${score.byDomain
              .map(
                (domain) => `
                <div class="bar-row">
                  <span>${domain.code} ${domain.name}</span>
                  <div class="bar-track"><div class="bar-fill" style="width:${Math.round(domain.ratio * 100)}%"></div></div>
                  <strong>${domain.weightedScore}</strong>
                </div>
              `,
              )
              .join("")}
          </div>
        </div>
        <div class="ring" style="--scoreDeg:${Math.min(360, score.total * 0.36)}deg">
          <div>
            <strong>${score.total}</strong>
            <span>${score.grade}</span>
          </div>
        </div>
      </section>
      <div class="grid-4">
        ${metric("结果状态", state.confirmed ? "已确认" : "待确认", "确认后生成正式问题清单")}
        ${metric("开放问题", openIssues.length, "来自校验或审核退回")}
        ${metric("整改事项", rectifications.length, "由问题清单生成")}
        ${metric("申诉复议", state.appeals.filter((item) => item.hospitalCode === state.selectedHospital && item.status !== "已处理").length, "结果发布后处理")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">整改闭环</h3>
            <p class="panel-subtitle">确认结果后，可将开放问题转成整改任务并跟踪状态。</p>
          </div>
            <div class="toolbar inline">
              <button class="button" type="button" data-action="make-rectifications">生成整改任务</button>
              <button class="button ghost" type="button" data-action="remind-rectification">逾期催办</button>
              <button class="button ghost" type="button" data-action="resolve-appeal">处理申诉</button>
            </div>
        </div>
        ${
          rectifications.length
            ? `<div class="detail-list">${rectifications
                .map(
                  (item) => `
              <article class="detail-item">
                <header>
                  <div>
                    <h4>${item.indicatorCode} ${indicatorByCode(item.indicatorCode)?.name || ""}</h4>
                    <p>${item.problem}</p>
                  </div>
                  <span class="status-pill ${item.status === "复核通过" ? "" : "warn"}">${item.status}</span>
                </header>
                <p>整改措施：${item.action}</p>
                <p>责任部门：${item.department || "信息中心"}；责任人：${item.owner || "待指定"}；期限：${item.due || "2026-12-31"}；材料：${item.materials || 0}份；复核人：${item.reviewer || "省级审核员"}</p>
                <div class="toolbar">
                  <button class="button ghost" type="button" data-action="advance-rectification" data-id="${item.id}">推进状态</button>
                  <button class="button ghost" type="button" data-action="submit-rectification-material" data-id="${item.id}">提交材料</button>
                </div>
              </article>
            `,
                )
                .join("")}</div>`
            : `<div class="empty-state">暂无整改事项。可先运行校验、完成审核，再生成整改任务。</div>`
        }
      </section>
    `;
  }

  function renderRules() {
    header("评分规则");
    const enabled = state.scoringRules.filter((rule) => rule.status === "启用").length;
    const triggered = state.bottomLineRules.filter((rule) => rule.triggered).length;
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("规则集", state.scoringRules.length, "评分、底线、映射、流程")}
        ${metric("已启用", enabled, "当前参与判定")}
        ${metric("待审批", state.scoringRules.filter((rule) => rule.status === "待审批").length, "规则变更审批")}
        ${metric("底线触发", triggered, "影响等级判定", triggered ? "danger" : "")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">评分规则配置</h3>
            <p class="panel-subtitle">规则变更审批通过后才可启用，评分结果可追溯到规则版本。</p>
          </div>
          <button class="button secondary" type="button" data-action="approve-rule">审批规则变更</button>
        </div>
        <div class="detail-list">
          ${state.scoringRules
            .map(
              (rule) => `
                <article class="detail-item">
                  <header>
                    <div>
                      <h4>${rule.name}</h4>
                      <p>${rule.description}</p>
                    </div>
                    <span class="status-pill ${statusClass(rule.status)}">${rule.status}</span>
                  </header>
                  <p>类型：${rule.type}；责任组：${rule.owner}</p>
                  <div class="toolbar">
                    <button class="button ghost" type="button" data-action="toggle-score-rule" data-id="${rule.id}">${rule.status === "启用" ? "停用" : "启用"}</button>
                  </div>
                </article>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">底线项与等级限制</h3>
            <p class="panel-subtitle">安全事故、数据造假、重大违规等底线项会进入重点复核和等级限制。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>编号</th><th>底线项</th><th>触发</th><th>影响</th><th>操作</th></tr></thead>
            <tbody>
              ${state.bottomLineRules
                .map(
                  (rule) => `
                    <tr>
                      <td>${rule.id}</td>
                      <td>${rule.name}</td>
                      <td><span class="status-pill ${rule.triggered ? "danger" : ""}">${rule.triggered ? "已触发" : "未触发"}</span></td>
                      <td>${rule.effect}</td>
                      <td><button class="button ghost" type="button" data-action="toggle-bottom-line" data-id="${rule.id}">${rule.triggered ? "解除" : "触发"}</button></td>
                    </tr>
                  `,
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderAnalytics() {
    header("统计分析");
    const data = analyticsSummary();
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("省域均分", `${data.avg}分`, "样例医院均值")}
        ${metric("领先医院", data.top?.name || "-", data.top ? `${data.top.score}分 ${data.top.grade}` : "-")}
        ${metric("高风险医院", data.riskHospitals, "审核任务风险")}
        ${metric("逾期整改", data.rectificationOverdue, "需催办事项", data.rectificationOverdue ? "danger" : "")}
      </div>
      <section class="panel chart-band">
        <div>
          <div class="panel-header">
            <div>
              <h3 class="panel-title">分域能力看板</h3>
              <p class="panel-subtitle">按当前医院得分展示八大指标域，可用于医院自评报告和省域汇总报告。</p>
            </div>
            <button class="button ghost" type="button" data-action="export-analytics">导出统计摘要</button>
          </div>
          <div class="bar-stack">
            ${scoreSnapshot().byDomain
              .map(
                (domain) => `
                  <div class="bar-row">
                    <span>${domain.code} ${domain.name}</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${Math.min(100, Math.round(domain.ratio * 100))}%"></div></div>
                    <strong>${domain.weightedScore}</strong>
                  </div>
                `,
              )
              .join("")}
          </div>
        </div>
        <div class="score-box">
          <span>当前医院等级</span>
          <strong>${scoreSnapshot().grade}</strong>
          <small>总分 ${scoreSnapshot().total}</small>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">医院排行与风险定位</h3>
            <p class="panel-subtitle">支持按等级、地区、风险、审核状态定位医院。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>医院</th><th>等级类别</th><th>得分</th><th>预判等级</th><th>审核风险</th><th>整改</th></tr></thead>
            <tbody>
              ${data.hospitalScores
                .map((hospital) => {
                  const review = state.reviewAssignments.find((item) => item.hospitalCode === hospital.code);
                  const recCount = state.rectifications.filter((item) => item.hospitalCode === hospital.code).length;
                  return `<tr><td>${hospital.name}</td><td>${hospital.level} ${hospital.type}</td><td>${hospital.score}</td><td>${hospital.grade}</td><td>${review?.risk || "低"}</td><td>${recCount}项</td></tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderIntelligence() {
    header("智能监管");
    const tab = workspace.dataset.intelligenceTab || "spotchecks";
    const summary = intelligenceSummary();
    const tabs = [
      { id: "spotchecks", label: "国家抽查" },
      { id: "sandbox", label: "规则沙箱" },
      { id: "assistance", label: "智能核验" },
      { id: "messages", label: "消息提醒" },
      { id: "imports", label: "批量导入" },
    ];
    let content = "";

    if (tab === "spotchecks") {
      content = `
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">国家抽查任务池</h3>
              <p class="panel-subtitle">按风险入池、分层随机抽样和国家专项要求形成抽查批次。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="generate-spot-check">生成抽查批次</button>
              <button class="button ghost" type="button" data-action="assign-spot-check">分派抽查任务</button>
              <button class="button ghost" type="button" data-action="complete-spot-check">完成一项复核</button>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>抽查编号</th><th>医疗机构</th><th>入池来源</th><th>抽查原因</th><th>抽样比例</th><th>复核组</th><th>状态</th><th>截止日期</th></tr></thead>
              <tbody>
                ${state.spotChecks
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.id}</td>
                        <td><strong>${item.hospitalName}</strong><br /><span class="muted-text">${item.batch}</span></td>
                        <td>${item.source}</td>
                        <td>${item.reason}</td>
                        <td>${item.sampleRate}</td>
                        <td>${item.reviewer}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.due}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "sandbox") {
      content = `
        <div class="grid-3">
          ${metric("试算范围", "126家", "同级同类样本")}
          ${metric("受影响医院", state.sandboxRuns[0]?.affected || 0, "最近一次试算")}
          ${metric("待审批方案", summary.sandboxPending, "人工审批后发布", summary.sandboxPending ? "warn" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">候选规则参数</h3>
              <p class="panel-subtitle">在历史脱敏样本上试算，不直接修改正式评分规则。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="run-sandbox">运行试算</button>
              <button class="button ghost" type="button" data-action="approve-sandbox">审批并发布</button>
            </div>
          </div>
          <div class="form-grid">
            <label class="field">
              <span>接口成功率优秀阈值（%）</span>
              <input type="number" min="90" max="100" step="0.1" value="${state.sandboxConfig.successRateThreshold}" data-sandbox-config="successRateThreshold" />
            </label>
            <label class="field">
              <span>最低材料数量</span>
              <input type="number" min="0" max="10" value="${state.sandboxConfig.evidenceMinimum}" data-sandbox-config="evidenceMinimum" />
            </label>
            <label class="field">
              <span>异常识别倍数</span>
              <input type="number" min="1" max="5" step="0.1" value="${state.sandboxConfig.anomalyMultiplier}" data-sandbox-config="anomalyMultiplier" />
            </label>
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">试算结果与版本审批</h3>
              <p class="panel-subtitle">展示得分影响、等级变化和底线项命中情况。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>试算编号</th><th>候选规则</th><th>样本数</th><th>受影响</th><th>平均分变化</th><th>等级变化</th><th>底线命中</th><th>状态</th><th>运行时间</th></tr></thead>
              <tbody>
                ${state.sandboxRuns
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.id}</td>
                        <td><strong>${item.ruleName}</strong><br /><span class="muted-text">${item.version}</span></td>
                        <td>${item.population}</td>
                        <td>${item.affected}</td>
                        <td>${item.avgDelta > 0 ? "+" : ""}${item.avgDelta}</td>
                        <td>${item.gradeChanges}</td>
                        <td>${item.bottomLineHits}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.runAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "assistance") {
      content = `
        <div class="grid-4">
          ${metric("待确认分类", summary.classificationsPending, "材料辅助分类")}
          ${metric("开放异常", summary.anomaliesOpen, "同类医院对比", summary.anomaliesOpen ? "warn" : "")}
          ${metric("高风险异常", state.peerAnomalies.filter((item) => item.level === "高" && item.status === "待核验").length, "建议纳入抽查")}
          ${metric("人工确认率", pct(state.materialClassifications.filter((item) => item.status === "已确认").length / Math.max(1, state.materialClassifications.length)), "智能结果需人工确认")}
        </div>
        <div class="grid-2">
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">材料智能辅助分类</h3>
                <p class="panel-subtitle">原型模拟结果，仅用于材料归类建议，确认后才进入正式台账。</p>
              </div>
              <button class="button secondary" type="button" data-action="classify-materials">运行分类</button>
            </div>
            <div class="detail-list compact-list">
              ${state.materialClassifications
                .map(
                  (item) => `
                    <article class="detail-item">
                      <div><strong>${item.materialName}</strong><p>${item.category} · 建议关联 ${item.suggestedIndicator} · 置信度 ${item.confidence}%</p></div>
                      <div class="toolbar inline">
                        <span class="status-pill ${item.risk === "高" ? "danger" : ""}">${item.risk}风险</span>
                        <button class="button ghost" type="button" data-action="confirm-classification" data-id="${item.id}" ${item.status === "已确认" ? "disabled" : ""}>${item.status}</button>
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </section>
          <section class="panel">
            <div class="panel-header">
              <div>
                <h3 class="panel-title">同类医院异常识别</h3>
                <p class="panel-subtitle">按医院级别、类别和区域分层比较，异常只作为核验线索。</p>
              </div>
              <button class="button secondary" type="button" data-action="scan-anomalies">重新识别</button>
            </div>
            <div class="detail-list compact-list">
              ${state.peerAnomalies
                .map(
                  (item) => `
                    <article class="detail-item">
                      <div><strong>${item.hospitalName} · ${item.metric}</strong><p>${item.value}，同类中位数 ${item.peerMedian}，偏离 ${item.deviation}</p><p>${item.reason}</p></div>
                      <div class="toolbar inline">
                        <span class="status-pill ${item.level === "高" ? "danger" : "warn"}">${item.level}风险</span>
                        <button class="button ghost" type="button" data-action="anomaly-to-spot-check" data-id="${item.id}" ${item.status === "已转抽查" ? "disabled" : ""}>${item.status}</button>
                      </div>
                    </article>
                  `,
                )
                .join("")}
            </div>
          </section>
        </div>
      `;
    }

    if (tab === "messages") {
      content = `
        <div class="grid-4">
          ${metric("未读消息", summary.unreadMessages, "当前消息队列", summary.unreadMessages ? "warn" : "")}
          ${metric("紧急提醒", state.notifications.filter((item) => item.priority === "紧急").length, "截止与逾期")}
          ${metric("移动端送达", state.notifications.filter((item) => item.channel === "移动端" && item.status === "已送达").length, "App/小程序消息")}
          ${metric("启用渠道", state.notificationChannels.filter((item) => item.enabled).length, "共4种渠道")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">提醒渠道</h3>
              <p class="panel-subtitle">按事件级别配置站内信、移动端、短信和邮件。</p>
            </div>
            <div class="toolbar inline">
              <button class="button secondary" type="button" data-action="send-mobile-reminder">发送移动端提醒</button>
              <button class="button ghost" type="button" data-action="read-all-messages">全部标记已读</button>
            </div>
          </div>
          <div class="channel-grid">
            ${state.notificationChannels
              .map(
                (item) => `
                  <button class="channel-toggle ${item.enabled ? "active" : ""}" type="button" data-action="toggle-channel" data-channel="${item.channel}" aria-pressed="${item.enabled}">
                    <strong>${item.channel}</strong>
                    <span>${item.scope}</span>
                    <small>${item.enabled ? "已启用" : "已停用"}</small>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">消息队列与送达状态</h3>
              <p class="panel-subtitle">覆盖任务催办、退回补正、国家抽查、材料临期和整改逾期。</p>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>消息</th><th>接收人</th><th>角色</th><th>渠道</th><th>优先级</th><th>送达状态</th><th>时间</th></tr></thead>
              <tbody>
                ${state.notifications
                  .map(
                    (item) => `
                      <tr>
                        <td><strong>${item.title}</strong>${item.read ? "" : '<br /><span class="tag">未读</span>'}</td>
                        <td>${item.recipient}</td>
                        <td>${item.role}</td>
                        <td>${item.channel}</td>
                        <td><span class="status-pill ${item.priority === "紧急" ? "danger" : item.priority === "高" ? "warn" : ""}">${item.priority}</span></td>
                        <td>${item.status}</td>
                        <td>${item.createdAt}</td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    if (tab === "imports") {
      const rows = state.importJobs.reduce((sum, item) => sum + Number(item.rows || 0), 0);
      const accepted = state.importJobs.reduce((sum, item) => sum + Number(item.accepted || 0), 0);
      content = `
        <div class="grid-4">
          ${metric("导入任务", state.importJobs.length, "模板与接口数据")}
          ${metric("数据行数", fmt(rows), "累计读取")}
          ${metric("成功入库", fmt(accepted), pct(accepted / Math.max(1, rows)))}
          ${metric("拒绝行数", summary.importRejected, "可下载问题报告", summary.importRejected ? "danger" : "")}
        </div>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">批量数据导入任务</h3>
              <p class="panel-subtitle">模拟Excel/CSV模板上传、字段校验、幂等入库和问题报告。</p>
            </div>
            <button class="button secondary" type="button" data-action="simulate-import">导入样例数据</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>任务编号</th><th>文件</th><th>模板</th><th>总行数</th><th>成功</th><th>拒绝</th><th>状态</th><th>问题报告</th><th>操作</th></tr></thead>
              <tbody>
                ${state.importJobs
                  .map(
                    (item) => `
                      <tr>
                        <td>${item.id}</td>
                        <td><strong>${item.fileName}</strong><br /><span class="muted-text">${item.submittedBy} · ${item.submittedAt}</span></td>
                        <td>${item.template}</td>
                        <td>${item.rows}</td>
                        <td>${item.accepted}</td>
                        <td>${item.rejected}</td>
                        <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                        <td>${item.report}</td>
                        <td><button class="button ghost" type="button" data-action="rerun-import" data-id="${item.id}" ${item.rejected ? "" : "disabled"}>补正重跑</button></td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      `;
    }

    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("国家抽查", summary.spotChecksOpen, "开放任务")}
        ${metric("规则试算", summary.sandboxPending, "待审批方案")}
        ${metric("智能线索", summary.classificationsPending + summary.anomaliesOpen, "待人工确认")}
        ${metric("消息与导入", summary.unreadMessages + summary.importRejected, "未读或待补正")}
      </div>
      <div class="segmented" role="tablist" aria-label="智能监管功能">
        ${tabs.map((item) => `<button type="button" role="tab" aria-selected="${item.id === tab}" class="${item.id === tab ? "active" : ""}" data-intelligence-tab="${item.id}">${item.label}</button>`).join("")}
      </div>
      ${content}
    `;
  }

  function renderSystem() {
    header("系统权限");
    const role = activeRole();
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("当前角色", role.name, `${role.org} | ${role.dataScope}`)}
        ${metric("用户数", state.users.length, "启用账号")}
        ${metric("导出审批", state.exportApprovals.filter((item) => item.status === "待审批").length, "敏感数据审批")}
        ${metric("审计日志", state.auditLogs.length, "最近操作留痕")}
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">角色权限矩阵</h3>
            <p class="panel-subtitle">按角色、组织、任务和数据范围授权，当前选择会影响演示上下文。</p>
          </div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>角色</th><th>组织</th><th>数据范围</th><th>核心权限</th></tr></thead>
            <tbody>
              ${state.roles.map((item) => `<tr><td><strong>${item.name}</strong></td><td>${item.org}</td><td>${item.dataScope}</td><td>${item.permissions.join("、")}</td></tr>`).join("")}
            </tbody>
          </table>
        </div>
      </section>
      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">用户管理</h3>
              <p class="panel-subtitle">用户创建、禁用、角色分配和最后登录。</p>
            </div>
            <button class="button secondary" type="button" data-action="toggle-user-status">切换账号状态</button>
          </div>
          <div class="detail-list compact-list">
            ${state.users
              .map(
                (user) => `
                  <article class="detail-item">
                    <header>
                      <div><h4>${user.name}</h4><p>${user.role} | ${user.org}</p></div>
                      <span class="status-pill ${user.status === "启用" ? "" : "danger"}">${user.status}</span>
                    </header>
                    <p>最后登录：${user.lastLogin}</p>
                  </article>
                `,
              )
              .join("")}
          </div>
        </section>
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">导出审批与系统参数</h3>
              <p class="panel-subtitle">敏感数据导出需审批，参数变更进入日志。</p>
            </div>
            <button class="button ghost" type="button" data-action="approve-export">审批导出</button>
          </div>
          <div class="timeline-list">
            ${state.exportApprovals
              .map((item) => `<article class="timeline-item"><time>${item.requestedAt}</time><span>${item.requester} | ${item.sensitivity}</span><strong>${item.packageType} ${item.status}</strong><p>范围：${item.scope}</p></article>`)
              .join("")}
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">操作日志</h3>
            <p class="panel-subtitle">记录登录、查看、下载、提交、审核、发布和归档。</p>
          </div>
        </div>
        <div class="timeline-list">
          ${state.auditLogs
            .map((item) => `<article class="timeline-item"><time>${item.at}</time><span>${item.user}</span><strong>${item.action}</strong><p>${item.target}：${item.result}</p></article>`)
            .join("")}
        </div>
      </section>
    `;
  }

  function renderExchange() {
    header("接口数据");
    const kind = workspace.dataset.packageKind || "submission";
    const payload = buildDataPackage(kind);
    const payloadText = JSON.stringify(payload, null, 2);
    const issueSummary = summarizeIssues(state.validationIssues.filter((issue) => issue.hospitalCode === state.selectedHospital));
    workspace.innerHTML = `
      <div class="package-grid">
        <article class="package-card">
          <strong>任务包</strong>
          <span>评价任务、医院范围、节点、催办延期和审核分派</span>
        </article>
        <article class="package-card">
          <strong>证据包</strong>
          <span>材料台账、版本、水印、敏感级别和缺口清单</span>
        </article>
        <article class="package-card">
          <strong>申报包</strong>
          <span>医院画像、统计数据、指标自评、材料数量、校验摘要</span>
        </article>
        <article class="package-card">
          <strong>审核包</strong>
          <span>审核进度、审核意见、已审核指标和开放问题</span>
        </article>
        <article class="package-card">
          <strong>专家包</strong>
          <span>复核任务、专家组、结论、建议分和关联问题</span>
        </article>
        <article class="package-card">
          <strong>整改包</strong>
          <span>评分结果、分域得分、整改事项和整改状态</span>
        </article>
        <article class="package-card">
          <strong>统计包</strong>
          <span>省域看板、分域能力、风险定位和规则状态</span>
        </article>
        <article class="package-card">
          <strong>智能监管包</strong>
          <span>国家抽查、规则试算、智能线索、消息渠道和导入任务</span>
        </article>
        <article class="package-card">
          <strong>试点运营包</strong>
          <span>申报批次、上传队列、审核负荷和运行日报</span>
        </article>
        <article class="package-card">
          <strong>试点协同包</strong>
          <span>医院准备度、问题工单、培训答疑、版本发布与试点反馈</span>
        </article>
        <article class="package-card">
          <strong>接入联调包</strong>
          <span>接入申请、连接器凭据、字段映射、认证测试、联调问题与上线准入</span>
        </article>
        <article class="package-card">
          <strong>接入执行包</strong>
          <span>环境配置、凭据引用、异步任务、签名回执、重放隔离与生产切换</span>
        </article>
        <article class="package-card">
          <strong>试点评估包</strong>
          <span>成效指标、医院评分、问题复盘、优化计划、推广准备与评估报告</span>
        </article>
        <article class="package-card">
          <strong>评价助手包</strong>
          <span>知识版本、标准问答、检索轨迹、模型审计、质量评测、发布门禁、异常说明、整改建议和审核风险线索</span>
        </article>
        <article class="package-card">
          <strong>运营监控包</strong>
          <span>服务可用性、接口健康、任务队列、存储容量和告警处置</span>
        </article>
        <article class="package-card">
          <strong>公共卫生协同包</strong>
          <span>八通道状态、连续活动、异常事件、处置留痕和生产阻断</span>
        </article>
        <article class="package-card">
          <strong>系统包</strong>
          <span>角色权限、用户、导出审批、系统参数和审计日志</span>
        </article>
        <article class="package-card">
          <strong>运行包</strong>
          <span>年度周期、标准版本、规则核验、安全复核和运行日志</span>
        </article>
        <article class="package-card">
          <strong>全量包</strong>
          <span>当前原型内完整任务、指标、申报、审核、整改状态</span>
        </article>
      </div>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">数据包生成</h3>
            <p class="panel-subtitle">用于模拟医院端、省级端和后端接口之间的数据交换。JSON可直接用于联调样例。</p>
          </div>
          <span class="status-pill ${issueSummary.blockers ? "danger" : ""}">开放问题 ${issueSummary.open}</span>
        </div>
        <div class="toolbar">
          <label class="field">
            <span>数据包类型</span>
            <select data-package-kind>
              ${["task", "pilot", "collaboration", "integration", "execution", "assessment", "assistant", "monitoring", "publicHealth", "evidence", "submission", "review", "expert", "rectification", "analytics", "intelligence", "system", "operations", "full"]
                .map((item) => `<option value="${item}" ${item === kind ? "selected" : ""}>${packageKindLabel(item)}</option>`)
                .join("")}
            </select>
          </label>
          <button class="button secondary" type="button" data-action="download-package" data-kind="${kind}">下载当前JSON</button>
          <button class="button ghost" type="button" data-action="copy-package" data-kind="${kind}">复制到剪贴板</button>
        </div>
        <pre class="code-block" aria-label="JSON数据包预览">${escapeHtml(payloadText)}</pre>
      </section>
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">MVP接口资源映射</h3>
            <p class="panel-subtitle">当前原型数据包与接口规范v0.1的资源关系。</p>
          </div>
          <span class="tag">OpenAPI草案见 mock-api/openapi.v0.1.yaml</span>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>资源</th><th>方法</th><th>路径</th><th>原型数据来源</th><th>优先级</th></tr></thead>
            <tbody>
              <tr><td>评价任务</td><td>POST/PUT</td><td>/api/v1/evaluation-tasks</td><td>任务管理页、医院范围</td><td><span class="priority">P0</span></td></tr>
              <tr><td>申报批次</td><td>POST/PUT</td><td>/api/v1/pilot-batches</td><td>试点运营页、批次节点与范围</td><td><span class="priority">P1</span></td></tr>
              <tr><td>上传队列</td><td>POST/GET</td><td>/api/v1/material-upload-jobs</td><td>分片上传、扫描、分类状态</td><td><span class="priority">P1</span></td></tr>
              <tr><td>审核负荷</td><td>GET/POST</td><td>/api/v1/reviewer-workloads:balance</td><td>审核容量、逾期和自动均衡</td><td><span class="priority">P1</span></td></tr>
              <tr><td>运行日报</td><td>POST/GET</td><td>/api/v1/pilot-daily-reports</td><td>试点运行指标、风险和发布状态</td><td><span class="priority">P1</span></td></tr>
              <tr><td>试点准备度</td><td>GET/POST</td><td>/api/v1/pilot-readiness</td><td>组织、账号、网络、数据映射与培训准备度</td><td><span class="priority">P1</span></td></tr>
              <tr><td>问题工单</td><td>GET/POST</td><td>/api/v1/pilot-tickets</td><td>问题登记、分类、责任组和SLA</td><td><span class="priority">P1</span></td></tr>
              <tr><td>工单流转</td><td>PUT</td><td>/api/v1/pilot-tickets/{ticketId}</td><td>分派、推进、升级和解决</td><td><span class="priority">P1</span></td></tr>
              <tr><td>培训场次</td><td>GET/POST</td><td>/api/v1/pilot-training-sessions</td><td>培训发布、签到、问题与材料</td><td><span class="priority">P1</span></td></tr>
              <tr><td>试点版本</td><td>GET/POST</td><td>/api/v1/pilot-releases</td><td>候选版本、验证范围与发布记录</td><td><span class="priority">P1</span></td></tr>
              <tr><td>版本反馈</td><td>GET/PUT</td><td>/api/v1/pilot-feedback/{feedbackId}</td><td>反馈收集、评估、解决与版本关联</td><td><span class="priority">P1</span></td></tr>
              <tr><td>医院接入申请</td><td>GET/POST/PUT</td><td>/api/v1/pilot-access-applications</td><td>医院资料、接入方式、网络区域与联调窗口</td><td><span class="priority">P1</span></td></tr>
              <tr><td>源系统连接器</td><td>GET/POST</td><td>/api/v1/pilot-connectors</td><td>源系统、传输配置、凭据状态与责任组</td><td><span class="priority">P1</span></td></tr>
              <tr><td>连通与契约认证</td><td>POST</td><td>/api/v1/pilot-connectors/{connectorId}:certify</td><td>连通探测、凭据轮换和OpenAPI契约测试</td><td><span class="priority">P1</span></td></tr>
              <tr><td>数据映射抽样</td><td>GET/POST</td><td>/api/v1/pilot-data-mappings/{mappingId}:sample-check</td><td>字段覆盖、转换规则与个人信息去标识化抽样</td><td><span class="priority">P1</span></td></tr>
              <tr><td>联调问题</td><td>GET/POST/PUT</td><td>/api/v1/pilot-integration-issues</td><td>阻断、高风险问题与处置结论</td><td><span class="priority">P1</span></td></tr>
              <tr><td>上线准入</td><td>GET/POST</td><td>/api/v1/pilot-integration-gates/{hospitalCode}:evaluate</td><td>连接器、映射、关键问题与双重复核门禁</td><td><span class="priority">P1</span></td></tr>
              <tr><td>接入执行任务</td><td>GET/POST</td><td>/api/v1/integration-execution-jobs</td><td>幂等防重、异步状态推进与载荷摘要</td><td><span class="priority">P1</span></td></tr>
              <tr><td>签名回执核验</td><td>POST</td><td>/api/v1/integration-callback-receipts/{receiptId}:verify</td><td>签名、时间窗、nonce、载荷摘要与隔离处置</td><td><span class="priority">P1</span></td></tr>
              <tr><td>生产切换窗口</td><td>GET/POST</td><td>/api/v1/integration-cutover-windows</td><td>切换门禁、授权执行、完成与回滚记录</td><td><span class="priority">P1</span></td></tr>
              <tr><td>试点成效</td><td>GET/POST</td><td>/api/v1/pilot-assessment/outcomes</td><td>成效指标、医院评分与推广结论</td><td><span class="priority">P1</span></td></tr>
              <tr><td>问题复盘</td><td>GET/POST</td><td>/api/v1/pilot-assessment/issue-themes</td><td>跨工单、反馈、校验和告警归并</td><td><span class="priority">P1</span></td></tr>
              <tr><td>优化计划</td><td>GET/PUT</td><td>/api/v1/pilot-assessment/improvement-plans/{planId}</td><td>责任组、目标版本、进度和验收标准</td><td><span class="priority">P1</span></td></tr>
              <tr><td>推广准备</td><td>GET/POST</td><td>/api/v1/rollout-regions</td><td>区域准入维度、准备度和推广启动</td><td><span class="priority">P1</span></td></tr>
              <tr><td>评估报告</td><td>GET/POST</td><td>/api/v1/pilot-assessment/reports</td><td>试点评估结论、推广建议和发布状态</td><td><span class="priority">P1</span></td></tr>
              <tr><td>评价助手知识源</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/knowledge-sources</td><td>标准原文、评价细则、问答口径与规则说明</td><td><span class="priority">P2</span></td></tr>
              <tr><td>标准问答</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/questions</td><td>带引用回答、置信度与人工确认状态</td><td><span class="priority">P2</span></td></tr>
              <tr><td>问答确认</td><td>POST</td><td>/api/v1/evaluation-assistant/questions/{questionId}:confirm</td><td>问答人工确认与审计留痕</td><td><span class="priority">P2</span></td></tr>
              <tr><td>知识版本审批</td><td>GET/POST/PUT</td><td>/api/v1/evaluation-assistant/knowledge-versions</td><td>知识变更、审批发布、生效版本与摘要指纹</td><td><span class="priority">P2</span></td></tr>
              <tr><td>检索命中追踪</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/retrieval-traces</td><td>问答命中片段、相似度阈值、耗时与复核状态</td><td><span class="priority">P2</span></td></tr>
              <tr><td>模型调用审计</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/model-calls</td><td>提示版本、摘要指纹、令牌、耗时、降级和人工复核</td><td><span class="priority">P2</span></td></tr>
              <tr><td>评价助手评测集</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/evaluation-suites</td><td>业务准确性、安全边界和试点长尾样本版本</td><td><span class="priority">P2</span></td></tr>
              <tr><td>回归评测运行</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/evaluation-runs</td><td>引用、准确率、召回率、安全、性能和基线变化</td><td><span class="priority">P2</span></td></tr>
              <tr><td>质量发布门禁</td><td>GET/POST/PUT</td><td>/api/v1/evaluation-assistant/release-candidates</td><td>候选版本、评测证据、审批发布和历史版本回滚</td><td><span class="priority">P2</span></td></tr>
              <tr><td>异常说明</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/anomaly-explanations</td><td>校验异常解释、可能原因和可编辑说明</td><td><span class="priority">P2</span></td></tr>
              <tr><td>整改建议</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/rectification-suggestions</td><td>辅助建议、执行步骤与整改任务转化</td><td><span class="priority">P2</span></td></tr>
              <tr><td>审核风险</td><td>GET/POST</td><td>/api/v1/evaluation-assistant/review-risks</td><td>风险线索、依据、人工研判和专家复核</td><td><span class="priority">P2</span></td></tr>
              <tr><td>服务健康</td><td>GET/POST</td><td>/api/v1/monitoring/services</td><td>服务可用率、时延、SLA和巡检</td><td><span class="priority">P1</span></td></tr>
              <tr><td>接口健康</td><td>GET/POST</td><td>/api/v1/monitoring/interfaces</td><td>接口成功率、P95、吞吐和探测</td><td><span class="priority">P1</span></td></tr>
              <tr><td>任务队列</td><td>GET/POST</td><td>/api/v1/monitoring/job-queues</td><td>任务积压、失败、扩容和优先级</td><td><span class="priority">P1</span></td></tr>
              <tr><td>存储容量</td><td>GET/POST</td><td>/api/v1/monitoring/storage-pools</td><td>容量、增长、留存、扩容和清理</td><td><span class="priority">P1</span></td></tr>
              <tr><td>运营告警</td><td>GET/PUT</td><td>/api/v1/monitoring/alerts/{alertId}</td><td>告警确认、处置、关闭和审计</td><td><span class="priority">P1</span></td></tr>
              <tr><td>公共卫生协同</td><td>GET</td><td>/api/digital-hospital/public-health/coordination</td><td>八通道、机构授权范围、SLA统计、关闭门禁与专业系统只读关联</td><td><span class="priority">P1</span></td></tr>
              <tr><td>公共卫生事件</td><td>POST</td><td>/api/digital-hospital/public-health/incidents</td><td>最小化事件登记与敏感字段拒绝</td><td><span class="priority">P1</span></td></tr>
              <tr><td>事件状态推进</td><td>POST</td><td>/api/digital-hospital/public-health/incidents/{incidentId}/actions</td><td>修订号、状态机、关闭证据门禁、独立复核、SLA升级和安全审计</td><td><span class="priority">P1</span></td></tr>
              <tr><td>公共卫生关闭证据</td><td>POST</td><td>/api/digital-hospital/public-health/incidents/{incidentId}/evidence</td><td>编号、最小化摘要、SHA-256摘要和事件双向引用</td><td><span class="priority">P1</span></td></tr>
              <tr><td>公共卫生证据签收</td><td>POST</td><td>/api/digital-hospital/public-health/evidence/{evidenceId}/actions</td><td>双修订号、提交签收分离、签收或驳回留痕</td><td><span class="priority">P1</span></td></tr>
              <tr><td>公共卫生事件导出</td><td>GET</td><td>/api/digital-hospital/public-health/incidents/export</td><td>JSON/CSV批量导出与最小必要专业摘要</td><td><span class="priority">P1</span></td></tr>
              <tr><td>证据材料</td><td>POST/PUT</td><td>/api/v1/evidence-materials/{materialId}</td><td>证据材料页、材料台账</td><td><span class="priority">P0</span></td></tr>
              <tr><td>医院申报</td><td>PUT</td><td>/api/v1/submissions/{submissionId}</td><td>医院申报页、指标自评数据</td><td><span class="priority">P0</span></td></tr>
              <tr><td>运行校验</td><td>POST</td><td>/api/v1/submissions/{submissionId}/validations:run</td><td>数据校验页、校验规则</td><td><span class="priority">P0</span></td></tr>
              <tr><td>审核意见</td><td>PUT</td><td>/api/v1/review-tasks/{reviewId}/indicators/{indicatorCode}</td><td>省级审核页、审核动作</td><td><span class="priority">P0</span></td></tr>
              <tr><td>专家复核</td><td>PUT</td><td>/api/v1/expert-reviews/{expertReviewId}</td><td>专家复核页、复核结论</td><td><span class="priority">P0</span></td></tr>
              <tr><td>评分结果</td><td>POST</td><td>/api/v1/submissions/{submissionId}/score:calculate</td><td>评分整改页、分域权重</td><td><span class="priority">P0</span></td></tr>
              <tr><td>整改任务</td><td>POST</td><td>/api/v1/submissions/{submissionId}/rectifications</td><td>整改闭环页、开放问题</td><td><span class="priority">P1</span></td></tr>
              <tr><td>评分规则</td><td>GET/PUT</td><td>/api/v1/scoring-rules</td><td>评分规则页、底线项</td><td><span class="priority">P1</span></td></tr>
              <tr><td>统计分析</td><td>GET</td><td>/api/v1/analytics/province-summary</td><td>统计分析页、省域看板</td><td><span class="priority">P1</span></td></tr>
              <tr><td>国家抽查</td><td>POST/PUT</td><td>/api/v1/national-spot-checks</td><td>智能监管页、抽查任务池</td><td><span class="priority">P2</span></td></tr>
              <tr><td>规则沙箱</td><td>POST</td><td>/api/v1/rule-sandbox/runs</td><td>智能监管页、候选规则试算</td><td><span class="priority">P2</span></td></tr>
              <tr><td>智能核验</td><td>POST</td><td>/api/v1/intelligence/materials:classify</td><td>材料分类、同类医院异常线索</td><td><span class="priority">P2</span></td></tr>
              <tr><td>消息提醒</td><td>POST</td><td>/api/v1/notifications:send</td><td>消息渠道、移动端送达状态</td><td><span class="priority">P2</span></td></tr>
              <tr><td>批量导入</td><td>POST</td><td>/api/v1/import-jobs</td><td>模板上传、校验报告、补正重跑</td><td><span class="priority">P1</span></td></tr>
              <tr><td>系统权限</td><td>PUT</td><td>/api/v1/system/users/{userId}</td><td>系统权限页、角色矩阵</td><td><span class="priority">P0</span></td></tr>
              <tr><td>运行周期</td><td>GET</td><td>/api/v1/operation-cycles/{cycleYear}</td><td>运行管理页、年度归档</td><td><span class="priority">P0</span></td></tr>
              <tr><td>规则核验</td><td>POST</td><td>/api/v1/operation-cycles/{cycleYear}/rules:run</td><td>运行管理页、规则状态</td><td><span class="priority">P0</span></td></tr>
              <tr><td>安全复核</td><td>POST</td><td>/api/v1/operation-cycles/{cycleYear}/security-checks:run</td><td>运行管理页、安全核验</td><td><span class="priority">P0</span></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    `;
  }

  function renderOperations() {
    header("运行管理");
    const operations = state.operations;
    const summary = operationSummary();
    const activeStage = summary.activeStage;
    workspace.innerHTML = `
      <div class="grid-4">
        ${metric("当前阶段", activeStage.name, `${activeStage.owner} | 截止 ${activeStage.due}`)}
        ${metric("阶段完成", `${summary.completedStages}/${operations.stages.length}`, `进度 ${pct(summary.progress, 0)}`)}
        ${metric("规则异常", summary.ruleViolations, `${summary.enabledRules}组规则启用`, summary.ruleViolations ? "danger" : "")}
        ${metric("安全待复核", summary.securityPending, `归档：${operations.cycle.archiveStatus}`, summary.securityPending ? "danger" : "")}
      </div>

      <section class="panel">
        <div class="panel-header">
          <div>
            <h3 class="panel-title">年度运行周期</h3>
            <p class="panel-subtitle">覆盖国家标准发布、省级配置、医院自评、分级审核、结果反馈和年度归档。</p>
          </div>
          <div class="toolbar inline">
            <button class="button secondary" type="button" data-action="advance-stage">推进阶段</button>
            <button class="button ghost" type="button" data-action="archive-cycle">生成归档状态</button>
            <button class="button ghost" type="button" data-action="download-package" data-kind="operations">下载运行包</button>
          </div>
        </div>
        <div class="stage-timeline">
          ${operations.stages
            .map(
              (stage) => `
            <article class="stage-card ${stage.id === operations.cycle.currentStage ? "active" : ""}">
              <header>
                <strong>${stage.name}</strong>
                <span class="status-pill ${statusClass(stage.status)}">${stage.status}</span>
              </header>
              <p>${stage.description}</p>
              <small>${stage.owner} | ${stage.due}</small>
            </article>
          `,
            )
            .join("")}
        </div>
      </section>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">标准版本与规则发布</h3>
              <p class="panel-subtitle">管理新标准版本、历史映射基线和规则生效状态。</p>
            </div>
            <button class="button" type="button" data-action="publish-standard">发布当前标准</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>版本</th><th>名称</th><th>状态</th><th>生效日期</th><th>变更数</th></tr></thead>
              <tbody>
                ${operations.standardVersions
                  .map(
                    (version) => `
                  <tr>
                    <td><strong>${version.id}</strong></td>
                    <td>${version.name}</td>
                    <td><span class="status-pill ${statusClass(version.status)}">${version.status}</span></td>
                    <td>${version.effectiveDate}</td>
                    <td>${version.changeCount}</td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">规则核验</h3>
              <p class="panel-subtitle">把数据口径、证据链、评分边界和安全权限转化为可运行规则。</p>
            </div>
            <button class="button secondary" type="button" data-action="run-rule-audit">运行规则核验</button>
          </div>
          <div class="detail-list compact-list">
            ${operations.ruleSets
              .map(
                (rule) => `
              <article class="detail-item">
                <header>
                  <div>
                    <h4>${rule.name}</h4>
                    <p>${rule.owner} | 最近运行：${rule.lastRun || "未运行"}</p>
                  </div>
                  <span class="status-pill ${rule.violations ? "danger" : ""}">${rule.violations}项异常</span>
                </header>
                <div class="toolbar">
                  <button class="button ghost" type="button" data-action="toggle-rule" data-id="${rule.id}">${rule.enabled ? "停用" : "启用"}</button>
                </div>
              </article>
            `,
              )
              .join("")}
          </div>
        </section>
      </div>

      <div class="grid-2">
        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">安全与数据核验</h3>
              <p class="panel-subtitle">跟踪上线评价判定、数据核验、安全管理需要的关键前置检查。</p>
            </div>
            <button class="button secondary" type="button" data-action="run-security-check">一键安全复核</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>检查项</th><th>责任组</th><th>风险</th><th>状态</th><th>最近复核</th><th>操作</th></tr></thead>
              <tbody>
                ${operations.securityItems
                  .map(
                    (item) => `
                  <tr>
                    <td>${item.name}</td>
                    <td>${item.owner}</td>
                    <td><span class="risk ${item.risk === "高" ? "blocker" : item.risk === "中" ? "warn" : ""}">${item.risk}</span></td>
                    <td><span class="status-pill ${statusClass(item.status)}">${item.status}</span></td>
                    <td>${item.lastCheck || "未复核"}</td>
                    <td><button class="button ghost" type="button" data-action="pass-security" data-id="${item.id}">标记通过</button></td>
                  </tr>
                `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="panel-header">
            <div>
              <h3 class="panel-title">运行日志</h3>
              <p class="panel-subtitle">记录关键操作，支持年度归档和问题追溯。</p>
            </div>
            <span class="tag">${operations.operationLogs.length}条记录</span>
          </div>
          <div class="timeline-list">
            ${operations.operationLogs
              .map(
                (log) => `
              <article class="timeline-item">
                <time>${log.at}</time>
                <strong>${log.action}</strong>
                <span>${log.actor}</span>
                <p>${log.result}</p>
              </article>
            `,
              )
              .join("")}
          </div>
        </section>
      </div>
    `;
  }

  function render() {
    renderHospitalSelect();
    renderRoleSelect();
    renderNav();
    const titles = {
      dashboard: "总览",
      tasks: "任务管理",
      pilot: "试点运营",
      collaboration: "试点协同",
      integration: "接入联调",
      execution: "接入执行",
      assessment: "试点评估",
      assistant: "评价助手",
      monitoring: "运营监控",
      "public-health": "公共卫生",
      standards: "标准指标",
      submission: "医院申报",
      evidence: "证据材料",
      validation: "数据校验",
      review: "省级审核",
      expert: "专家复核",
      score: "评分整改",
      rules: "评分规则",
      analytics: "统计分析",
      intelligence: "智能监管",
      exchange: "接口数据",
      operations: "运行管理",
      system: "系统权限",
    };
    viewTitle.textContent = titles[state.activeView] || "总览";
    if (state.activeView === "tasks") renderTasks();
    else if (state.activeView === "pilot") renderPilot();
    else if (state.activeView === "collaboration") renderCollaboration();
    else if (state.activeView === "integration") renderIntegration();
    else if (state.activeView === "execution") renderExecution();
    else if (state.activeView === "assessment") renderAssessment();
    else if (state.activeView === "assistant") renderAssistant();
    else if (state.activeView === "monitoring") renderMonitoring();
    else if (state.activeView === "public-health") renderPublicHealth();
    else if (state.activeView === "standards") renderStandards();
    else if (state.activeView === "submission") renderSubmission();
    else if (state.activeView === "evidence") renderEvidence();
    else if (state.activeView === "validation") renderValidation();
    else if (state.activeView === "review") renderReview();
    else if (state.activeView === "expert") renderExpert();
    else if (state.activeView === "score") renderScore();
    else if (state.activeView === "rules") renderRules();
    else if (state.activeView === "analytics") renderAnalytics();
    else if (state.activeView === "intelligence") renderIntelligence();
    else if (state.activeView === "exchange") renderExchange();
    else if (state.activeView === "operations") renderOperations();
    else if (state.activeView === "system") renderSystem();
    else renderDashboard();
  }

  function updateSubmissionField(code, field, value) {
    const submission = submissionForActive();
    if (!submission[code]) submission[code] = { selfScore: 0, reviewedScore: null, evidenceCount: 0, comment: "", status: "草稿" };
    submission[code][field] = value;
    submission[code].status = "草稿";
    state.confirmed = false;
    saveState();
  }

  function addReviewNote(code, status) {
    const submission = submissionForActive();
    const indicator = indicatorByCode(code);
    const entry = submission[code];
    if (status === "通过") {
      entry.reviewedScore = Number(entry.selfScore);
      entry.status = "审核通过";
    }
    if (status === "退回补正") {
      entry.reviewedScore = null;
      entry.status = "退回补正";
      state.validationIssues.push({
        id: `REV-${code}-${Date.now()}`,
        hospitalCode: state.selectedHospital,
        indicatorCode: code,
        type: "审核",
        severity: "warning",
        status: "open",
        description: `${indicator.name}被省级审核退回补正。`,
        suggestion: "补充审核意见要求的材料或说明。",
      });
    }
    if (status === "专家复核") {
      entry.status = "专家复核";
      createExpertReview(code, `${indicator.name}由省级审核提交专家复核。`);
    }
    state.reviewNotes.unshift({
      id: `NOTE-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      indicatorCode: code,
      status,
      text: `${indicator.name}：${status}`,
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    state.confirmed = false;
    saveState();
    showNotice(`${code} 已处理为：${status}`);
    render();
  }

  function bulkApprove() {
    const submission = submissionForActive();
    const issueCodes = new Set(activeIssues().map((issue) => issue.indicatorCode));
    indicators.forEach((indicator) => {
      if (!issueCodes.has(indicator.code)) {
        submission[indicator.code].reviewedScore = Number(submission[indicator.code].selfScore);
        submission[indicator.code].status = "审核通过";
      }
    });
    state.reviewNotes.unshift({
      id: `NOTE-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      indicatorCode: "批量",
      status: "批量通过",
      text: "无开放问题指标已批量通过。",
      at: new Date().toLocaleString("zh-CN", { hour12: false }),
    });
    saveState();
    showNotice("已批量通过无开放问题指标。");
    render();
  }

  function makeRectifications() {
    const issues = activeIssues();
    const existing = new Set(state.rectifications.filter((item) => item.hospitalCode === state.selectedHospital).map((item) => item.sourceIssueId));
    issues.forEach((issue) => {
      if (!existing.has(issue.id)) {
        state.rectifications.push({
          id: `REC-${Date.now()}-${issue.indicatorCode}`,
          sourceIssueId: issue.id,
          hospitalCode: state.selectedHospital,
          indicatorCode: issue.indicatorCode,
          problem: issue.description,
          action: issue.suggestion,
          department: indicatorByCode(issue.indicatorCode)?.domain === "H" ? "网络安全办" : "信息中心",
          owner: indicatorByCode(issue.indicatorCode)?.domain === "D" ? "门诊部负责人" : "责任部门管理员",
          due: "2026-12-31",
          reviewer: "省级审核员",
          materials: 0,
          status: "未开始",
        });
      }
    });
    saveState();
    showNotice(`已生成${issues.length}项整改任务。`);
    render();
  }

  function advanceRectification(id) {
    const item = state.rectifications.find((entry) => entry.id === id);
    if (!item) return;
    const flow = ["未开始", "整改中", "已提交", "复核通过"];
    const index = flow.indexOf(item.status);
    item.status = flow[Math.min(flow.length - 1, index + 1)];
    if (item.status === "复核通过") {
      const issue = state.validationIssues.find((entry) => entry.id === item.sourceIssueId);
      if (issue) issue.status = "resolved";
    }
    saveState();
    showNotice(`整改状态已更新为：${item.status}`);
    render();
  }

  function createTask() {
    const id = `TASK-2026-${String(state.tasks.length + 1).padStart(3, "0")}`;
    state.tasks.push({
      id,
      name: "区域能力提升专项评价",
      type: "专项评价",
      standard: state.task.standard,
      scope: "二级医院重点指标补短板",
      status: "未开始",
      start: "2026-10-15",
      submitDue: "2026-11-15",
      reviewDue: "2026-12-10",
      resultAt: "2026-12-25",
      hospitals: state.hospitals.map((item) => item.code),
      reminders: 0,
      extensionRequests: 0,
    });
    addAudit("创建评价任务", id, "已创建");
    saveState();
    showNotice("已创建一项专项评价任务。");
    render();
  }

  function sendReminder() {
    state.tasks[0].reminders += 1;
    addAudit("发送任务催办", state.tasks[0].name, `累计${state.tasks[0].reminders}次`);
    saveState();
    showNotice("已发送催办提醒。");
    render();
  }

  function approveExtension() {
    const task = state.tasks.find((item) => item.extensionRequests > 0) || state.tasks[0];
    task.extensionRequests = Math.max(0, task.extensionRequests - 1);
    task.submitDue = "2026-10-10";
    addAudit("审批延期申请", task.name, "已同意延期至2026-10-10");
    saveState();
    showNotice("延期申请已审批。");
    render();
  }

  function addEvidence() {
    const indicator = indicators.find((item) => !evidenceForActive().some((mat) => mat.indicatorCode === item.code)) || indicators[0];
    state.evidenceMaterials.unshift({
      id: `EV-${indicator.code}-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      indicatorCode: indicator.code,
      name: `${indicator.code}-${indicator.name}-补充材料.pdf`,
      type: "PDF",
      version: 1,
      sensitivity: indicator.domain === "H" ? "S4" : "S2",
      status: "待复核",
      uploadedBy: state.activeRole,
      uploadedAt: nowText(),
      expireAt: "2027-06-30",
      watermark: "审批后水印",
    });
    const submission = submissionForActive();
    submission[indicator.code].evidenceCount = Number(submission[indicator.code].evidenceCount || 0) + 1;
    addAudit("上传证据材料", indicator.code, "待复核");
    saveState();
    showNotice(`已上传${indicator.code}补充材料。`);
    render();
  }

  function verifyEvidence(id) {
    const item = state.evidenceMaterials.find((entry) => entry.id === id);
    if (!item) return;
    item.status = "已校验";
    item.watermark = "已加水印";
    addAudit("校验证据材料", item.name, "已校验");
    saveState();
    showNotice("材料已校验通过。");
    render();
  }

  function versionEvidence(id) {
    const item = state.evidenceMaterials.find((entry) => entry.id === id);
    if (!item) return;
    item.version += 1;
    item.status = "待复核";
    item.uploadedAt = nowText();
    addAudit("上传材料新版本", item.name, `v${item.version}`);
    saveState();
    showNotice("已生成材料新版本。");
    render();
  }

  function approveExport() {
    const pending = state.exportApprovals.find((item) => item.status === "待审批");
    if (pending) {
      pending.status = "已通过";
      addAudit("审批敏感数据导出", pending.packageType, "已通过");
    } else {
      state.exportApprovals.unshift({
        id: `EX-${Date.now()}`,
        requester: state.activeRole,
        packageType: "全量状态包",
        scope: state.selectedHospital,
        sensitivity: "S3",
        status: "待审批",
        requestedAt: nowText(),
      });
      addAudit("申请敏感数据导出", state.selectedHospital, "待审批");
    }
    saveState();
    showNotice("导出审批状态已更新。");
    render();
  }

  function assignReview() {
    state.reviewAssignments.forEach((item, index) => {
      if (item.reviewer === "未分派") item.reviewer = index % 2 ? "审核员B" : "审核员A";
      if (item.status === "待分派") item.status = "待审核";
    });
    addAudit("自动分派审核任务", "省级审核任务池", "已分派");
    saveState();
    showNotice("审核任务已自动分派。");
    render();
  }

  function nationalSpotCheck() {
    const target = state.reviewAssignments.find((item) => item.risk === "高") || state.reviewAssignments[0];
    createExpertReview("H1", `${target.hospitalName}进入国家级抽查，需复核安全合规底线项。`);
    target.status = "国家抽查";
    addAudit("发起国家抽查", target.hospitalName, "已进入专家复核");
    saveState();
    showNotice("已发起国家级抽查复核。");
    render();
  }

  function createAppeal() {
    state.appeals.unshift({
      id: `AP-${state.selectedHospital}-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      indicatorCode: "D1",
      reason: "医院对结果口径提出复议并补充佐证。",
      status: "待处理",
      submittedAt: nowText(),
      conclusion: "",
    });
    addAudit("登记申诉复议", state.selectedHospital, "待处理");
    saveState();
    showNotice("已登记一项申诉复议。");
    render();
  }

  function resolveAppeal() {
    const appeal = state.appeals.find((item) => item.hospitalCode === state.selectedHospital && item.status !== "已处理");
    if (!appeal) {
      showNotice("当前医院暂无待处理申诉。");
      return;
    }
    appeal.status = "已处理";
    appeal.conclusion = "维持原判，补充说明纳入归档。";
    addAudit("处理申诉复议", appeal.id, appeal.conclusion);
    saveState();
    showNotice("申诉复议已处理。");
    render();
  }

  function submitRectificationMaterial(id) {
    const item = state.rectifications.find((entry) => entry.id === id);
    if (!item) return;
    item.materials = Number(item.materials || 0) + 1;
    item.status = "已提交";
    addAudit("提交整改材料", item.indicatorCode, `${item.materials}份材料`);
    saveState();
    showNotice("整改材料已提交。");
    render();
  }

  function remindRectification() {
    const open = state.rectifications.filter((item) => item.status !== "复核通过");
    addAudit("整改逾期催办", state.selectedHospital, `${open.length}项待办`);
    showNotice(`已催办${open.length}项整改任务。`);
    saveState();
    render();
  }

  function toggleScoreRule(id) {
    const rule = state.scoringRules.find((item) => item.id === id);
    if (!rule) return;
    rule.status = rule.status === "启用" ? "停用" : "启用";
    addAudit("调整评分规则状态", rule.name, rule.status);
    saveState();
    showNotice(`${rule.name}已${rule.status}。`);
    render();
  }

  function approveRule() {
    const rule = state.scoringRules.find((item) => item.status === "待审批");
    if (!rule) {
      showNotice("暂无待审批规则。");
      return;
    }
    rule.status = "启用";
    addAudit("审批规则变更", rule.name, "启用");
    saveState();
    showNotice("规则变更已审批启用。");
    render();
  }

  function toggleBottomLine(id) {
    const rule = state.bottomLineRules.find((item) => item.id === id);
    if (!rule) return;
    rule.triggered = !rule.triggered;
    addAudit("调整底线项状态", rule.name, rule.triggered ? "已触发" : "已解除");
    saveState();
    showNotice(`${rule.name}状态已更新。`);
    render();
  }

  function exportAnalytics() {
    state.exportApprovals.unshift({
      id: `EX-${Date.now()}`,
      requester: state.activeRole,
      packageType: "省域统计摘要",
      scope: "大连市",
      sensitivity: "S2",
      status: "已通过",
      requestedAt: nowText(),
    });
    addAudit("导出统计摘要", "省域统计看板", "已生成");
    saveState();
    showNotice("统计摘要已生成导出记录。");
    render();
  }

  function toggleUserStatus() {
    const user = state.users[state.users.length - 1];
    user.status = user.status === "启用" ? "禁用" : "启用";
    addAudit("切换账号状态", user.name, user.status);
    saveState();
    showNotice(`${user.name}已${user.status}。`);
    render();
  }

  function createPilotBatch() {
    const index = state.submissionBatches.length + 1;
    state.submissionBatches.unshift({
      id: `BATCH-2026-${String(index).padStart(2, "0")}`,
      name: `2026第${index}批口径验证`,
      region: "辽宁省试点地区",
      standard: state.task.standard,
      hospitalLevel: "二级及以上公立医院",
      hospitalCount: 10 + index * 2,
      status: "草稿",
      start: "2026-11-15",
      submitDue: "2026-12-05",
      reviewDue: "2026-12-20",
      reportAt: "2026-12-30",
      submitted: 0,
      reviewed: 0,
      owner: state.activeRole,
    });
    addAudit("创建试点申报批次", state.submissionBatches[0].name, "草稿");
    saveState();
    showNotice(`已创建${state.submissionBatches[0].name}。`);
    render();
  }

  function publishPilotBatch() {
    const item = state.submissionBatches.find((entry) => entry.status === "待发布" || entry.status === "草稿");
    if (!item) {
      showNotice("暂无待发布的试点批次。");
      return;
    }
    item.status = "已发布";
    addAudit("发布试点申报批次", item.name, `${item.hospitalCount}家机构`);
    state.notifications.unshift({
      id: `MSG-${Date.now()}`,
      title: `${item.name}已发布`,
      recipient: `${item.region}参评医院`,
      role: "医院管理员",
      channel: "站内信",
      priority: "普通",
      status: "已送达",
      createdAt: nowText(),
      read: false,
    });
    saveState();
    showNotice(`${item.name}已发布并通知参评机构。`);
    render();
  }

  function enqueueUpload() {
    const hospital = activeHospital();
    state.uploadQueue.unshift({
      id: `UP-${Date.now()}`,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      fileName: `${hospital.code}-试点补充材料.pdf`,
      materialType: "补充证明",
      size: "12.6MB",
      progress: 0,
      status: "排队中",
      scanStatus: "等待上传",
      classification: "待识别",
      submittedAt: nowText(),
      retries: 0,
    });
    addAudit("加入材料上传队列", hospital.name, state.uploadQueue[0].id);
    saveState();
    showNotice("材料已加入上传队列。");
    render();
  }

  function advanceUpload() {
    const item = state.uploadQueue.find((entry) => entry.status !== "已完成" && entry.status !== "失败");
    if (!item) {
      showNotice("暂无可推进的上传任务。");
      return;
    }
    if (item.status === "排队中") {
      item.status = "上传中";
      item.progress = 35;
      item.scanStatus = "等待扫描";
    } else if (item.status === "上传中") {
      item.status = "扫描中";
      item.progress = 80;
      item.scanStatus = "病毒与敏感内容扫描中";
    } else {
      item.status = "已完成";
      item.progress = 100;
      item.scanStatus = "扫描通过";
      item.classification = item.classification === "待识别" ? "辅助分类待确认" : item.classification;
    }
    addAudit("推进材料上传任务", item.fileName, item.status);
    saveState();
    showNotice(`${item.fileName}已推进至${item.status}。`);
    render();
  }

  function retryUpload() {
    const item = state.uploadQueue.find((entry) => entry.status === "失败");
    if (!item) {
      showNotice("暂无失败的上传任务。");
      return;
    }
    item.status = "上传中";
    item.progress = Math.max(45, item.progress);
    item.scanStatus = "断点续传中";
    item.retries += 1;
    addAudit("重试材料上传任务", item.fileName, `第${item.retries}次`);
    saveState();
    showNotice(`${item.fileName}已从断点继续上传。`);
    render();
  }

  function balanceWorkload() {
    const totalAssigned = state.reviewerWorkloads.reduce((sum, item) => sum + item.assigned, 0);
    const totalCapacity = state.reviewerWorkloads.reduce((sum, item) => sum + item.capacity, 0);
    let distributed = 0;
    state.reviewerWorkloads.forEach((item, index) => {
      const target = index === state.reviewerWorkloads.length - 1 ? totalAssigned - distributed : Math.round((totalAssigned * item.capacity) / Math.max(1, totalCapacity));
      item.assigned = target;
      item.inProgress = Math.min(item.inProgress, target);
      item.overdue = Math.min(item.overdue, target > item.capacity * 0.8 ? 1 : 0);
      item.status = target / Math.max(1, item.capacity) >= 0.85 ? "高负荷" : "正常";
      distributed += target;
    });
    addAudit("自动均衡审核负荷", "省级与专家审核组", `${totalAssigned}项任务`);
    saveState();
    showNotice("审核任务已按人员容量自动均衡。");
    render();
  }

  function assignUrgentReview() {
    const reviewer = [...state.reviewerWorkloads].sort((a, b) => a.assigned / a.capacity - b.assigned / b.capacity)[0];
    reviewer.assigned += 1;
    reviewer.inProgress += 1;
    reviewer.highRisk += 1;
    reviewer.status = reviewer.assigned / reviewer.capacity >= 0.85 ? "高负荷" : "正常";
    addAudit("分派紧急审核任务", reviewer.reviewer, "高风险任务");
    saveState();
    showNotice(`紧急审核任务已分派给${reviewer.reviewer}。`);
    render();
  }

  function generateDailyReport() {
    const pilot = pilotSummary();
    const batch = pilot.activeBatch;
    const pendingReviews = state.reviewerWorkloads.reduce((sum, item) => sum + item.assigned, 0);
    const report = {
      id: `DR-${Date.now()}`,
      date: "2026-07-27",
      batchId: batch.id,
      coverage: batch.hospitalCount,
      submitted: batch.submitted,
      submissionRate: Number(((batch.submitted / Math.max(1, batch.hospitalCount)) * 100).toFixed(1)),
      materials: 1842 + state.uploadQueue.filter((item) => item.status === "已完成").length,
      uploadPending: state.uploadQueue.filter((item) => item.status !== "已完成").length,
      validationBlockers: activeIssues().filter((item) => item.severity === "blocker").length + 17,
      pendingReviews,
      spotChecks: state.spotChecks.filter((item) => item.status !== "已完成").length,
      rectifications: state.rectifications.filter((item) => item.status !== "复核通过").length,
      incidents: pilot.failedUploads + pilot.highLoadReviewers,
      status: "草稿",
      generatedAt: nowText(),
      publishedAt: "",
      summary: `当前${batch.submitted}/${batch.hospitalCount}家医院已提交，${pilot.activeUploads}项材料任务待处理，${pilot.highLoadReviewers}名审核人员处于高负荷。`,
    };
    state.dailyReports.unshift(report);
    addAudit("生成试点运行日报", report.date, "草稿");
    saveState();
    showNotice("今日日报已生成，请复核后发布。");
    render();
  }

  function publishDailyReport() {
    const report = state.dailyReports.find((item) => item.status === "草稿");
    if (!report) {
      showNotice("暂无待发布的运行日报。");
      return;
    }
    report.status = "已发布";
    report.publishedAt = nowText();
    addAudit("发布试点运行日报", report.date, "已发布");
    saveState();
    showNotice(`${report.date}试点运行日报已发布。`);
    render();
  }

  function recalculateReadiness(item) {
    const dimensions = ["organization", "accounts", "network", "dataMapping", "training"];
    item.readiness = Math.round(dimensions.reduce((sum, field) => sum + Number(item[field] || 0), 0) / dimensions.length);
    item.status = item.blockers > 2 || item.readiness < 70 ? "有阻塞" : item.blockers > 0 || item.readiness < 90 ? "推进中" : "已就绪";
    item.lastUpdated = nowText();
  }

  function refreshReadiness() {
    state.hospitalReadiness.forEach(recalculateReadiness);
    addAudit("重新评估试点医院准备度", `${state.hospitalReadiness.length}家医院`, `平均${collaborationSummary().averageReadiness}%`);
    saveState();
    showNotice("医院准备度已按五个维度重新评估。");
    render();
  }

  function resolveReadinessBlocker(id) {
    const readiness = state.hospitalReadiness.find((item) => item.id === id);
    if (!readiness || !readiness.blockers) return;
    const dimensions = ["organization", "accounts", "network", "dataMapping", "training"];
    const weakest = dimensions.reduce((result, field) => (readiness[field] < readiness[result] ? field : result), dimensions[0]);
    readiness[weakest] = Math.min(100, readiness[weakest] + 12);
    readiness.blockers = Math.max(0, readiness.blockers - 1);
    recalculateReadiness(readiness);
    addAudit("推进试点准备阻塞项", readiness.hospitalName, `${readiness.readiness}% · ${readiness.status}`);
    saveState();
    showNotice(`${readiness.hospitalName}已完成一项准备工作。`);
    render();
  }

  function advancePilotAccessApplication(id) {
    const application = state.pilotAccessApplications.find((item) => item.id === id);
    if (!application || application.status === "联调完成") return;
    const nextStatus = {
      资料待补: "已受理",
      已受理: "联调中",
      联调中: "联调完成",
    }[application.status] || "已受理";
    if (application.status === "资料待补") application.materials = application.requiredMaterials;
    application.status = nextStatus;
    application.lastUpdated = nowText();
    addAudit("推进医院接入申请", application.hospitalName, nextStatus);
    saveState();
    showNotice(`${application.hospitalName}接入申请已更新为“${nextStatus}”。`);
    render();
  }

  function ensureIntegrationIssue(connector, category, severity, summary) {
    const existing = state.pilotIntegrationIssues.find(
      (item) => item.connectorId === connector.id && item.category === category && item.status !== "已关闭",
    );
    if (existing) {
      existing.severity = severity;
      existing.summary = summary;
      existing.updatedAt = nowText();
      return existing;
    }
    const issue = {
      id: `INT-ISSUE-${Date.now()}`,
      hospitalCode: connector.hospitalCode,
      connectorId: connector.id,
      category,
      severity,
      summary,
      owner: connector.owner,
      status: "待处理",
      dueAt: "2026-08-05",
      resolution: "",
      updatedAt: nowText(),
    };
    state.pilotIntegrationIssues.unshift(issue);
    return issue;
  }

  function probePilotConnector(id) {
    const connector = state.pilotConnectors.find((item) => item.id === id);
    if (!connector) return;
    connector.lastProbeAt = nowText();
    if (connector.credentialStatus !== "有效") {
      connector.connectivityStatus = "阻断";
      connector.latencyMs = 0;
      ensureIntegrationIssue(connector, "连通性", "阻断", "接入凭据未处于有效状态，连通探测被安全策略阻断。");
      addAudit("执行连接器探测", connector.id, "凭据无效，探测阻断");
      saveState();
      showNotice(`${connector.sourceSystem}探测被阻断，请先轮换接入凭据。`);
      render();
      return;
    }
    connector.connectivityStatus = "在线";
    connector.latencyMs = 120 + (connector.id.length * 17) % 180;
    if (connector.contractStatus === "阻断") connector.contractStatus = "待认证";
    addAudit("执行连接器探测", connector.id, `在线 · ${connector.latencyMs}ms`);
    saveState();
    showNotice(`${connector.sourceSystem}连通探测通过，往返时延${connector.latencyMs}ms。`);
    render();
  }

  function rotatePilotCredential(id) {
    const connector = state.pilotConnectors.find((item) => item.id === id);
    if (!connector) return;
    connector.credentialStatus = "有效";
    connector.credentialExpireAt = "2027-07-31";
    connector.connectivityStatus = "待探测";
    connector.contractStatus = "待认证";
    connector.latencyMs = 0;
    connector.lastProbeAt = nowText();
    addAudit("轮换接入凭据", connector.id, "新凭据已激活，待重新探测");
    saveState();
    showNotice(`${connector.sourceSystem}凭据已轮换，敏感值未在页面展示。`);
    render();
  }

  function runContractCertification(id) {
    const connector = state.pilotConnectors.find((item) => item.id === id);
    if (!connector) return;
    if (connector.credentialStatus !== "有效" || connector.connectivityStatus !== "在线") {
      connector.contractStatus = "阻断";
      ensureIntegrationIssue(connector, "契约认证", "阻断", "契约认证前置条件不满足：凭据须有效且连接器须在线。");
      addAudit("执行接口契约认证", connector.id, "前置条件不满足");
      saveState();
      showNotice("契约认证未执行，请先完成凭据轮换和连通探测。");
      render();
      return;
    }
    connector.contractStatus = "契约通过";
    const test = {
      id: `TEST-${connector.id}-${Date.now()}`,
      hospitalCode: connector.hospitalCode,
      connectorId: connector.id,
      suite: "OpenAPI契约认证",
      cases: 24,
      passed: 24,
      failed: 0,
      privacyFindings: 0,
      evidenceId: `CERT-${connector.id}`,
      status: "通过",
      runAt: nowText(),
    };
    state.pilotIntegrationTests.unshift(test);
    addAudit("执行接口契约认证", connector.id, "24/24用例通过");
    saveState();
    showNotice(`${connector.sourceSystem}契约认证通过，测试证据已归档。`);
    render();
  }

  function runSampleValidation(id) {
    const mapping = state.pilotDataMappings.find((item) => item.id === id);
    if (!mapping) return;
    const connector = state.pilotConnectors.find((item) => item.id === mapping.connectorId);
    if (!connector || connector.contractStatus !== "契约通过") {
      if (connector) ensureIntegrationIssue(connector, "数据映射", "高", `${mapping.dataset}映射校验前需先完成连接器契约认证。`);
      saveState();
      showNotice("映射校验未执行，请先完成对应连接器的契约认证。");
      render();
      return;
    }
    mapping.mappedFields = Math.max(mapping.sourceFields, mapping.requiredFields);
    mapping.coverage = 100;
    mapping.privacyCheck = "脱敏通过";
    mapping.status = "映射就绪";
    mapping.updatedAt = nowText();
    state.pilotIntegrationTests.unshift({
      id: `TEST-${mapping.id}-${Date.now()}`,
      hospitalCode: mapping.hospitalCode,
      connectorId: mapping.connectorId,
      suite: "字段映射与脱敏抽样",
      cases: 30,
      passed: 30,
      failed: 0,
      privacyFindings: 0,
      evidenceId: `SAMPLE-${mapping.id}`,
      status: "通过",
      runAt: nowText(),
    });
    addAudit("执行映射与脱敏抽样", mapping.id, "30/30样本通过");
    saveState();
    showNotice(`${mapping.dataset}映射和脱敏抽样通过。`);
    render();
  }

  function resolveIntegrationIssue(id) {
    const issue = state.pilotIntegrationIssues.find((item) => item.id === id);
    if (!issue || issue.status === "已关闭") return;
    issue.status = "已关闭";
    issue.resolution = "已完成配置修正并复测，相关证据已归档。";
    issue.updatedAt = nowText();
    addAudit("关闭联调问题", issue.id, issue.resolution);
    saveState();
    showNotice(`${issue.id}已关闭，可重新执行上线准入评估。`);
    render();
  }

  function evaluateIntegrationGate(hospitalCode) {
    const gate = state.pilotIntegrationGates.find((item) => item.hospitalCode === hospitalCode);
    if (!gate) return;
    const connectors = state.pilotConnectors.filter((item) => item.hospitalCode === hospitalCode);
    const mappings = state.pilotDataMappings.filter((item) => item.hospitalCode === hospitalCode);
    const openCriticalIssues = state.pilotIntegrationIssues.filter(
      (item) => item.hospitalCode === hospitalCode && item.status !== "已关闭" && (item.severity === "阻断" || item.severity === "高"),
    );
    gate.requiredConnectors = connectors.length;
    gate.readyConnectors = connectors.filter(
      (item) => item.credentialStatus === "有效" && item.connectivityStatus === "在线" && item.contractStatus === "契约通过",
    ).length;
    gate.requiredMappings = mappings.length;
    gate.readyMappings = mappings.filter((item) => item.status === "映射就绪" && item.privacyCheck === "脱敏通过").length;
    gate.openCriticalIssues = openCriticalIssues.length;
    const connectorsReady = gate.requiredConnectors > 0 && gate.readyConnectors === gate.requiredConnectors;
    const mappingsReady = gate.requiredMappings > 0 && gate.readyMappings === gate.requiredMappings;
    gate.securityReview = connectorsReady && !gate.openCriticalIssues ? "通过" : "不通过";
    gate.businessReview = mappingsReady ? "通过" : "不通过";
    gate.status = gate.securityReview === "通过" && gate.businessReview === "通过" ? "可上线" : gate.openCriticalIssues ? "阻断" : "待整改";
    gate.evaluatedAt = nowText();
    if (gate.status === "可上线") {
      const application = state.pilotAccessApplications.find((item) => item.hospitalCode === hospitalCode);
      if (application) {
        application.status = "联调完成";
        application.lastUpdated = gate.evaluatedAt;
      }
      const readiness = state.hospitalReadiness.find((item) => item.hospitalCode === hospitalCode);
      if (readiness) {
        readiness.network = 100;
        readiness.dataMapping = 100;
        readiness.blockers = Math.max(0, readiness.blockers - 2);
        recalculateReadiness(readiness);
      }
    }
    addAudit("评估上线准入门禁", gate.hospitalName, `${gate.status} · 关键问题${gate.openCriticalIssues}项`);
    saveState();
    showNotice(`${gate.hospitalName}上线准入评估结果：${gate.status}。`);
    render();
  }

  function approveIntegrationGate(hospitalCode) {
    const gate = state.pilotIntegrationGates.find((item) => item.hospitalCode === hospitalCode);
    if (!gate) return;
    if (gate.status !== "可上线") {
      showNotice("当前门禁尚未达到“可上线”，请先完成联调并重新评估。");
      return;
    }
    const allowedRoles = ["国家级管理员", "省级管理员", "运维安全员"];
    if (!allowedRoles.includes(state.activeRole)) {
      showNotice("当前角色无上线批准权限，请切换国家级、省级或运维安全角色。");
      return;
    }
    gate.status = "已准入";
    gate.approvedBy = state.activeRole;
    gate.approvedAt = nowText();
    addAudit("批准试点医院上线", gate.hospitalName, `已准入 · ${gate.approvedBy}`);
    saveState();
    showNotice(`${gate.hospitalName}已通过上线准入，批准记录已写入审计日志。`);
    render();
  }

  function verifyExecutionEnvironment(id) {
    const environment = state.integrationEnvironments.find((item) => item.id === id);
    if (!environment) return;
    environment.status = "健康";
    environment.lastVerifiedAt = nowText();
    addAudit("核验接入执行环境", environment.name, `${environment.tlsMode} · ${environment.configVersion} · 健康`);
    saveState();
    showNotice(`${environment.name}已通过网络、TLS和配置版本核验。`);
    render();
  }

  function rotateVaultReference(id) {
    const entry = state.credentialVaultEntries.find((item) => item.id === id);
    if (!entry) return;
    entry.keyVersion = `kv-${new Date().toISOString().slice(0, 10)}`;
    entry.vaultRefFingerprint = digestText(`${entry.id}|${entry.keyVersion}|${Date.now()}`);
    entry.lastRotatedAt = nowText();
    entry.rotationDueAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    entry.status = "有效";
    addAudit("轮换凭据保险库引用", entry.connectorId, `${entry.keyVersion} · 仅保存引用指纹`);
    saveState();
    showNotice(`${entry.connectorId}的凭据引用已轮换，原始凭据未进入平台状态。`);
    render();
  }

  function addExecutionEvent(type, job, workerId, detail) {
    state.integrationExecutionEvents.unshift({
      id: `EVENT-${Date.now()}-${state.integrationExecutionEvents.length + 1}`,
      jobId: job?.id || "",
      workerId: workerId || "",
      type,
      status: job?.status || "",
      detail,
      occurredAt: nowText(),
    });
  }

  function requireExecutionRuntimeRole() {
    const allowedRoles = ["国家级管理员", "省级管理员", "运维安全员"];
    if (allowedRoles.includes(state.activeRole)) return true;
    showNotice("当前角色无任务运行操作权限，请切换国家级、省级或运维安全角色。");
    return false;
  }

  function releaseExecutionWorker(job, workerStatus = "就绪") {
    const worker = state.integrationExecutionWorkers.find((item) => item.id === job.leaseOwner);
    if (worker) {
      worker.status = workerStatus;
      worker.activeJobId = "";
      if (workerStatus !== "失联") worker.lastHeartbeatAt = nowText();
    }
    job.leaseOwner = "";
    job.leaseTokenHash = "";
    job.leaseExpiresAt = "";
    job.lastHeartbeatAt = "";
  }

  function restoreExecutionWorker(id) {
    if (!requireExecutionRuntimeRole()) return;
    const worker = state.integrationExecutionWorkers.find((item) => item.id === id);
    if (!worker) return;
    worker.status = "就绪";
    worker.activeJobId = "";
    worker.lastHeartbeatAt = nowText();
    addExecutionEvent("Worker重新注册", null, worker.id, `${worker.node}已通过健康检查并重新加入${worker.pool}`);
    addAudit("重新注册执行Worker", worker.id, `${worker.node} · ${worker.pool} · 就绪`);
    saveState();
    showNotice(`${worker.id}已重新注册并恢复任务领取。`);
    render();
  }

  function dispatchExecutionJob(requestedJobId = "") {
    if (!requireExecutionRuntimeRole()) return;
    const now = Date.now();
    const candidates = state.integrationExecutionJobs
      .filter((item) => !requestedJobId || item.id === requestedJobId)
      .filter((item) => item.status === "排队中" || (item.status === "等待重试" && (!item.nextAttemptAt || Date.parse(item.nextAttemptAt) <= now)));
    const activeQuarantines = new Set(
      state.integrationQuarantines.filter((item) => item.status === "隔离中").map((item) => item.connectorId),
    );
    const job = candidates.find((item) => {
      const environment = state.integrationEnvironments.find((candidate) => candidate.id === item.environmentId);
      return environment?.status === "健康" && !activeQuarantines.has(item.connectorId);
    });
    if (!job) {
      showNotice("当前没有达到执行时间且通过环境、隔离门禁的任务。");
      return;
    }
    const worker = state.integrationExecutionWorkers.find(
      (item) => item.status === "就绪" && (!item.capabilities.length || item.capabilities.includes(job.jobType)),
    );
    if (!worker) {
      showNotice(`没有可领取“${job.jobType}”任务的就绪Worker，请先恢复或扩充运行池。`);
      return;
    }
    job.status = "执行中";
    job.attempts = Number(job.attempts || 0) + 1;
    job.maxAttempts = Number(job.maxAttempts || 3);
    job.retryBaseSeconds = Number(job.retryBaseSeconds || 30);
    job.retryMaxSeconds = Number(job.retryMaxSeconds || 900);
    job.progress = 20;
    job.startedAt = job.startedAt || nowText();
    job.nextAttemptAt = "";
    job.leaseOwner = worker.id;
    job.leaseTokenHash = digestText(`${job.id}|${worker.id}|${Date.now()}|lease`);
    job.leaseExpiresAt = new Date(Date.now() + 60 * 1000).toLocaleString("zh-CN", { hour12: false });
    job.lastHeartbeatAt = nowText();
    job.errorCode = "";
    worker.status = "忙碌";
    worker.activeJobId = job.id;
    worker.lastHeartbeatAt = job.lastHeartbeatAt;
    addExecutionEvent("领取任务", job, worker.id, `第${job.attempts}次尝试 · 60秒租约 · 仅保存令牌摘要`);
    addAudit("Worker领取执行任务", job.id, `${worker.id} · 第${job.attempts}次尝试`);
    saveState();
    showNotice(`${worker.id}已领取${job.id}，60秒租约开始计时。`);
    render();
  }

  function heartbeatExecutionJob(id) {
    if (!requireExecutionRuntimeRole()) return;
    const job = state.integrationExecutionJobs.find((item) => item.id === id);
    if (!job || job.status !== "执行中" || !job.leaseOwner) return;
    const worker = state.integrationExecutionWorkers.find((item) => item.id === job.leaseOwner);
    job.progress = Math.min(80, Number(job.progress || 0) + 20);
    job.lastHeartbeatAt = nowText();
    job.leaseExpiresAt = new Date(Date.now() + 60 * 1000).toLocaleString("zh-CN", { hour12: false });
    if (worker) worker.lastHeartbeatAt = job.lastHeartbeatAt;
    addExecutionEvent("任务心跳", job, worker?.id, `进度${job.progress}% · 租约延长60秒`);
    addAudit("续期执行任务租约", job.id, `${worker?.id || "-"} · ${job.progress}%`);
    saveState();
    showNotice(`${job.id}心跳正常，租约已延长60秒。`);
    render();
  }

  function failExecutionJob(id) {
    if (!requireExecutionRuntimeRole()) return;
    const job = state.integrationExecutionJobs.find((item) => item.id === id);
    if (!job || job.status !== "执行中") return;
    const workerId = job.leaseOwner;
    const worker = state.integrationExecutionWorkers.find((item) => item.id === workerId);
    releaseExecutionWorker(job);
    if (worker) worker.failedJobs = Number(worker.failedJobs || 0) + 1;
    job.errorCode = "GATEWAY_TIMEOUT";
    job.progress = 0;
    if (Number(job.attempts || 0) < Number(job.maxAttempts || 3)) {
      const delaySeconds = Math.min(
        Number(job.retryMaxSeconds || 900),
        Number(job.retryBaseSeconds || 30) * (2 ** Math.max(0, Number(job.attempts || 1) - 1)),
      );
      job.status = "等待重试";
      job.nextAttemptAt = new Date(Date.now() + delaySeconds * 1000).toLocaleString("zh-CN", { hour12: false });
      addExecutionEvent("安排重试", job, workerId, `GATEWAY_TIMEOUT · ${delaySeconds}秒后重试`);
      addAudit("安排执行任务重试", job.id, `第${job.attempts}次失败 · ${delaySeconds}秒指数退避`);
      saveState();
      showNotice(`${job.id}发生瞬时故障，已按指数退避安排重试。`);
      render();
      return;
    }
    const deadLetter = {
      id: `DLQ-${Date.now()}`,
      jobId: job.id,
      connectorId: job.connectorId,
      environmentId: job.environmentId,
      jobType: job.jobType,
      payloadDigest: job.payloadDigest,
      errorCode: job.errorCode,
      attempts: job.attempts,
      generation: Number(job.generation || 1),
      status: "待复核",
      createdAt: nowText(),
      reviewedBy: "",
      reviewNote: "",
      redrivenAt: "",
    };
    state.integrationDeadLetters.unshift(deadLetter);
    job.status = "死信";
    job.deadLetterId = deadLetter.id;
    job.nextAttemptAt = "";
    addExecutionEvent("进入死信", job, workerId, `${job.errorCode} · 第${job.attempts}次失败`);
    addAudit("执行任务进入死信", job.id, `${deadLetter.id} · ${job.errorCode}`);
    saveState();
    showNotice(`${job.id}已耗尽重试并进入死信队列，等待人工复核。`);
    render();
  }

  function activateExecutionRetry(id) {
    if (!requireExecutionRuntimeRole()) return;
    const job = state.integrationExecutionJobs.find((item) => item.id === id);
    if (!job || job.status !== "等待重试") return;
    if (job.nextAttemptAt && Date.parse(job.nextAttemptAt) > Date.now()) {
      showNotice(`${job.id}尚未到达重试时间：${job.nextAttemptAt}。`);
      return;
    }
    job.status = "排队中";
    job.nextAttemptAt = nowText();
    addExecutionEvent("重试到期", job, "", "任务重新进入可领取队列");
    addAudit("激活执行任务重试", job.id, `第${Number(job.attempts || 0) + 1}次尝试待领取`);
    saveState();
    showNotice(`${job.id}已到达重试时间并重新进入队列。`);
    render();
  }

  function recoverExecutionLeases() {
    if (!requireExecutionRuntimeRole()) return;
    const now = Date.now();
    const expiredJobs = state.integrationExecutionJobs.filter(
      (item) => item.status === "执行中" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) <= now,
    );
    expiredJobs.forEach((job) => {
      const workerId = job.leaseOwner;
      releaseExecutionWorker(job, "失联");
      job.errorCode = "WORKER_LEASE_EXPIRED";
      job.status = Number(job.attempts || 0) < Number(job.maxAttempts || 3) ? "等待重试" : "死信";
      job.nextAttemptAt = job.status === "等待重试"
        ? new Date(Date.now() + Number(job.retryBaseSeconds || 30) * 1000).toLocaleString("zh-CN", { hour12: false })
        : "";
      if (job.status === "死信") {
        const deadLetter = {
          id: `DLQ-${Date.now()}-${state.integrationDeadLetters.length + 1}`,
          jobId: job.id,
          connectorId: job.connectorId,
          environmentId: job.environmentId,
          jobType: job.jobType,
          payloadDigest: job.payloadDigest,
          errorCode: job.errorCode,
          attempts: job.attempts,
          generation: Number(job.generation || 1),
          status: "待复核",
          createdAt: nowText(),
          reviewedBy: "",
          reviewNote: "",
          redrivenAt: "",
        };
        state.integrationDeadLetters.unshift(deadLetter);
        job.deadLetterId = deadLetter.id;
      }
      addExecutionEvent("回收超时租约", job, workerId, `${workerId}心跳超时 · ${job.status}`);
    });
    addAudit("扫描执行任务租约", `${expiredJobs.length}个过期任务`, expiredJobs.length ? "已回收并安排重试" : "无过期租约");
    saveState();
    showNotice(expiredJobs.length ? `已回收${expiredJobs.length}个超时租约。` : "当前没有需要回收的超时租约。");
    render();
  }

  function redriveExecutionDeadLetter(id) {
    if (!requireExecutionRuntimeRole()) return;
    const deadLetter = state.integrationDeadLetters.find((item) => item.id === id);
    const job = state.integrationExecutionJobs.find((item) => item.id === deadLetter?.jobId);
    if (!deadLetter || !job || deadLetter.status !== "待复核") return;
    deadLetter.status = "已重放";
    deadLetter.reviewedBy = state.activeRole;
    deadLetter.reviewNote = "已完成失败原因复核、连接器配置修正和安全边界确认，同意开启新执行代次。";
    deadLetter.redrivenAt = nowText();
    job.status = "排队中";
    job.attempts = 0;
    job.progress = 0;
    job.nextAttemptAt = nowText();
    job.errorCode = "";
    job.deadLetterId = "";
    job.generation = Number(job.generation || 1) + 1;
    addExecutionEvent("死信人工重放", job, "", `${deadLetter.id} · ${state.activeRole}批准 · G${job.generation}`);
    addAudit("审批并重放死信任务", deadLetter.id, `${state.activeRole} · ${job.id} · G${job.generation}`);
    saveState();
    showNotice(`${deadLetter.id}已完成复核，${job.id}进入G${job.generation}执行代次。`);
    render();
  }

  function enqueueExecutionJob() {
    const connector = state.pilotConnectors.find((item) => item.hospitalCode === state.selectedHospital);
    const environment = state.integrationEnvironments.find((item) => item.type === "PROD") || state.integrationEnvironments[0];
    if (!connector || !environment) {
      showNotice("当前医院尚未配置可执行的连接器或环境。");
      return;
    }
    const activeQuarantine = state.integrationQuarantines.find((item) => item.connectorId === connector.id && item.status === "隔离中");
    if (activeQuarantine) {
      showNotice(`${connector.id}处于隔离状态，不能创建执行任务。`);
      return;
    }
    const idempotencyKeyHash = digestText(`${state.selectedHospital}|${connector.id}|${environment.id}|INTEGRATION-CERTIFICATION`);
    const existing = state.integrationExecutionJobs.find((item) => item.idempotencyKeyHash === idempotencyKeyHash);
    if (existing) {
      existing.idempotencyHits = Number(existing.idempotencyHits || 0) + 1;
      addAudit("阻止重复执行任务", existing.id, `${existing.idempotencyHits}次幂等命中`);
      saveState();
      showNotice(`检测到相同幂等键，已复用${existing.id}，未创建重复任务。`);
      render();
      return;
    }
    const job = {
      id: `EXEC-${Date.now()}`,
      connectorId: connector.id,
      environmentId: environment.id,
      jobType: "接入认证执行",
      idempotencyKeyHash,
      idempotencyHits: 0,
      payloadDigest: digestText(`${connector.id}|${environment.configVersion}|${state.task.standard}`),
      status: "排队中",
      attempts: 0,
      maxAttempts: 3,
      retryBaseSeconds: 30,
      retryMaxSeconds: 900,
      nextAttemptAt: nowText(),
      progress: 0,
      queuedAt: nowText(),
      startedAt: "",
      completedAt: "",
      receiptId: "",
      errorCode: "",
      leaseOwner: "",
      leaseTokenHash: "",
      leaseExpiresAt: "",
      lastHeartbeatAt: "",
      deadLetterId: "",
      generation: 1,
    };
    state.integrationExecutionJobs.unshift(job);
    addExecutionEvent("任务入队", job, "", `${connector.id} · 幂等键与载荷仅保存摘要`);
    addAudit("创建接入执行任务", job.id, `${connector.id} · ${environment.id} · 幂等防重`);
    saveState();
    showNotice(`${job.id}已进入异步执行队列。`);
    render();
  }

  function advanceExecutionJob(id) {
    const job = state.integrationExecutionJobs.find((item) => item.id === id);
    if (!job || ["成功", "阻断", "等待回执"].includes(job.status)) return;
    if (job.status === "排队中") {
      dispatchExecutionJob(id);
      return;
    } else {
      const workerId = job.leaseOwner;
      const worker = state.integrationExecutionWorkers.find((item) => item.id === workerId);
      if (worker) worker.completedJobs = Number(worker.completedJobs || 0) + 1;
      if (workerId) releaseExecutionWorker(job);
      job.status = "等待回执";
      job.progress = 85;
      addExecutionEvent("执行完成", job, workerId, "Worker已释放租约，等待签名回执");
    }
    addAudit("推进接入执行任务", job.id, `${job.status} · ${job.progress}%`);
    saveState();
    showNotice(`${job.id}已推进至“${job.status}”。`);
    render();
  }

  function verifyCallbackReceipt(jobId) {
    const job = state.integrationExecutionJobs.find((item) => item.id === jobId);
    if (!job || job.status !== "等待回执") return;
    const connector = state.pilotConnectors.find((item) => item.id === job.connectorId);
    const receivedAt = nowText();
    const receipt = {
      id: `RCPT-${Date.now()}`,
      jobId: job.id,
      connectorId: job.connectorId,
      source: connector?.endpointAlias || job.connectorId,
      eventType: "EXECUTION_COMPLETED",
      signatureStatus: "已验证",
      timestampStatus: "已验证",
      nonceStatus: "已验证",
      nonceHash: digestText(`${job.id}|${receivedAt}|nonce`),
      payloadDigest: job.payloadDigest,
      digestStatus: "已验证",
      status: "已验证",
      decision: "接收",
      receivedAt,
    };
    state.integrationCallbackReceipts.unshift(receipt);
    job.status = "成功";
    job.progress = 100;
    job.completedAt = receivedAt;
    job.receiptId = receipt.id;
    addAudit("核验接入执行回执", receipt.id, "签名、时间窗、nonce与载荷摘要全部通过");
    saveState();
    showNotice(`${job.id}回执已验证，任务执行成功。`);
    render();
  }

  function simulateReplayCallback() {
    const connector = state.pilotConnectors.find((item) => item.hospitalCode === state.selectedHospital) || state.pilotConnectors[0];
    if (!connector) return;
    const now = nowText();
    const nonceHash = digestText(`${connector.id}|replay-demo`);
    const existingEvent = state.integrationReplayEvents.find((item) => item.connectorId === connector.id && item.nonceHash === nonceHash);
    let replayEvent = existingEvent;
    if (replayEvent) {
      replayEvent.hits = Number(replayEvent.hits || 1) + 1;
      replayEvent.lastSeenAt = now;
      replayEvent.status = "待处置";
    } else {
      replayEvent = {
        id: `REPLAY-${Date.now()}`,
        source: connector.endpointAlias,
        connectorId: connector.id,
        nonceHash,
        firstSeenAt: now,
        lastSeenAt: now,
        hits: 2,
        action: "拒绝并隔离连接器",
        status: "待处置",
      };
      state.integrationReplayEvents.unshift(replayEvent);
    }
    const receipt = {
      id: `RCPT-BLOCK-${Date.now()}`,
      jobId: "-",
      connectorId: connector.id,
      source: connector.endpointAlias,
      eventType: "EXECUTION_COMPLETED",
      signatureStatus: "已验证",
      timestampStatus: "已验证",
      nonceStatus: "重放",
      nonceHash,
      payloadDigest: digestText(`${connector.id}|replay-payload`),
      digestStatus: "已验证",
      status: "已阻断",
      decision: "拒绝",
      receivedAt: now,
    };
    state.integrationCallbackReceipts.unshift(receipt);
    const quarantine = state.integrationQuarantines.find((item) => item.connectorId === connector.id && item.status === "隔离中");
    if (quarantine) {
      quarantine.hits = Number(quarantine.hits || 1) + 1;
      quarantine.updatedAt = now;
      quarantine.trigger = replayEvent.id;
    } else {
      state.integrationQuarantines.unshift({
        id: `QUAR-${Date.now()}`,
        connectorId: connector.id,
        reason: "检测到回调nonce重放",
        trigger: replayEvent.id,
        hits: replayEvent.hits,
        status: "隔离中",
        owner: "运维安全组",
        openedAt: now,
        updatedAt: now,
        releasedAt: "",
        reviewNote: "",
      });
    }
    addAudit("阻断重放回调", connector.id, `${receipt.id} · 拒绝并隔离`);
    saveState();
    showNotice(`已阻断${connector.id}的重放回调并执行连接器隔离。`);
    render();
  }

  function resolveReplayEvent(id) {
    const replayEvent = state.integrationReplayEvents.find((item) => item.id === id);
    if (!replayEvent) return;
    replayEvent.status = "已处置";
    replayEvent.lastSeenAt = nowText();
    addAudit("确认重放事件处置", replayEvent.id, `${replayEvent.hits}次命中已复核`);
    saveState();
    showNotice(`${replayEvent.id}已完成安全事件确认。`);
    render();
  }

  function releaseExecutionQuarantine(id) {
    const quarantine = state.integrationQuarantines.find((item) => item.id === id);
    if (!quarantine || quarantine.status === "已解除") return;
    quarantine.status = "已解除";
    quarantine.reviewNote = "已核验调用方时钟、签名密钥与nonce缓存，完成凭据轮换和回归测试。";
    quarantine.releasedAt = nowText();
    quarantine.updatedAt = quarantine.releasedAt;
    addAudit("解除连接器隔离", quarantine.connectorId, quarantine.reviewNote);
    saveState();
    showNotice(`${quarantine.connectorId}已完成安全复核并解除隔离。`);
    render();
  }

  function createCutoverWindow() {
    const hospital = activeHospital();
    const gate = state.pilotIntegrationGates.find((item) => item.hospitalCode === hospital.code);
    if (!gate || gate.status !== "已准入") {
      showNotice("当前医院尚未通过接入联调准入，请先在“接入联调”完成门禁评估与批准。");
      return;
    }
    const connectors = state.pilotConnectors.filter((item) => item.hospitalCode === hospital.code);
    const environment = state.integrationEnvironments.find((item) => item.type === "PROD");
    const windowItem = {
      id: `CUT-${hospital.code}-${Date.now()}`,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      environmentId: environment?.id || "ENV-PROD",
      connectorIds: connectors.map((item) => item.id),
      plannedAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleString("zh-CN", { hour12: false }),
      windowMinutes: 90,
      integrationApproved: true,
      rollbackPlan: "切回模板上传通道并恢复上一配置版本",
      checks: {},
      status: "待评估",
      evaluatedAt: "",
      approvedBy: "",
      startedAt: "",
      completedAt: "",
      rollbackAt: "",
    };
    state.integrationCutoverWindows.unshift(windowItem);
    addAudit("创建生产切换窗口", windowItem.id, `${hospital.name} · ${windowItem.connectorIds.length}个连接器`);
    saveState();
    showNotice(`${windowItem.id}已创建，请执行生产切换评估。`);
    render();
  }

  function evaluateCutoverWindow(id) {
    const windowItem = state.integrationCutoverWindows.find((item) => item.id === id);
    if (!windowItem) return;
    const environment = state.integrationEnvironments.find((item) => item.id === windowItem.environmentId);
    const gate = state.pilotIntegrationGates.find((item) => item.hospitalCode === windowItem.hospitalCode);
    const connectorIds = windowItem.connectorIds || [];
    const vaultReady = connectorIds.length > 0 && connectorIds.every((connectorId) =>
      state.credentialVaultEntries.some((item) => item.connectorId === connectorId && item.environmentId === windowItem.environmentId && item.status === "有效"),
    );
    const jobsReady = connectorIds.length > 0 && connectorIds.every((connectorId) =>
      state.integrationExecutionJobs.some((item) => item.connectorId === connectorId && item.environmentId === windowItem.environmentId && item.status === "成功"),
    );
    const quarantineReady = !state.integrationQuarantines.some((item) => connectorIds.includes(item.connectorId) && item.status === "隔离中");
    windowItem.integrationApproved = gate?.status === "已准入";
    windowItem.checks = {
      environment: environment?.status === "健康",
      vault: vaultReady,
      jobs: jobsReady,
      quarantine: quarantineReady,
      gate: windowItem.integrationApproved,
      rollback: Boolean(windowItem.rollbackPlan),
    };
    windowItem.status = Object.values(windowItem.checks).every(Boolean) ? "可切换" : "阻断";
    windowItem.evaluatedAt = nowText();
    addAudit("评估生产切换窗口", windowItem.id, `${windowItem.status} · ${Object.values(windowItem.checks).filter(Boolean).length}/6项通过`);
    saveState();
    showNotice(`${windowItem.id}评估结果：${windowItem.status}。`);
    render();
  }

  function startCutoverWindow(id) {
    const windowItem = state.integrationCutoverWindows.find((item) => item.id === id);
    if (!windowItem) return;
    if (windowItem.status !== "可切换") {
      showNotice("切换门禁尚未全部通过，请先重新评估。");
      return;
    }
    const allowedRoles = ["国家级管理员", "省级管理员", "运维安全员"];
    if (!allowedRoles.includes(state.activeRole)) {
      showNotice("当前角色无生产切换权限，请切换国家级、省级或运维安全角色。");
      return;
    }
    windowItem.status = "切换中";
    windowItem.startedAt = nowText();
    windowItem.approvedBy = state.activeRole;
    addAudit("开始生产切换", windowItem.id, `${windowItem.approvedBy}批准 · 回滚预案已锁定`);
    saveState();
    showNotice(`${windowItem.id}已进入生产切换窗口。`);
    render();
  }

  function completeCutoverWindow(id) {
    const windowItem = state.integrationCutoverWindows.find((item) => item.id === id);
    if (!windowItem || windowItem.status !== "切换中") return;
    windowItem.status = "已切换";
    windowItem.completedAt = nowText();
    addAudit("完成生产切换", windowItem.id, `${windowItem.connectorIds.length}个连接器已切换`);
    saveState();
    showNotice(`${windowItem.id}生产切换已完成并留痕。`);
    render();
  }

  function rollbackCutoverWindow(id) {
    const windowItem = state.integrationCutoverWindows.find((item) => item.id === id);
    if (!windowItem || !["切换中", "已切换"].includes(windowItem.status)) return;
    windowItem.status = "已回滚";
    windowItem.rollbackAt = nowText();
    addAudit("回滚生产切换", windowItem.id, windowItem.rollbackPlan);
    saveState();
    showNotice(`${windowItem.id}已按预案回滚。`);
    render();
  }

  async function productionSha256(value) {
    const bytes = new TextEncoder().encode(String(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return `sha256:${Array.from(new Uint8Array(digest), (item) => item.toString(16).padStart(2, "0")).join("")}`;
  }

  async function configureProductionRuntime(id) {
    if (!requireExecutionRuntimeRole()) return;
    const control = state.productionRuntimeControls.find((item) => item.id === id);
    if (!control || control.status !== "待配置") return;
    control.status = "已配置";
    control.verifiedAt = nowText();
    control.evidence = await productionSha256(`${control.id}|${control.owner}|${control.verifiedAt}|external-activation`);
    addAudit("登记生产运行外部配置", control.id, `${control.name} · 仅保存配置证明摘要`);
    saveState();
    showNotice(`${control.name}已登记外部配置证明，未保存密钥或证书原文。`);
    render();
  }

  async function recordCutoverEvidence(id) {
    const evidence = state.cutoverEvidenceRequirements.find((item) => item.id === id);
    if (!evidence || evidence.status !== "待上传") return;
    evidence.artifactName = `${evidence.requirementId}-${Date.now()}.json`;
    evidence.artifactDigest = await productionSha256(`${evidence.requirementId}|${state.selectedHospital}|${Date.now()}`);
    evidence.submittedBy = state.activeRole;
    evidence.verifiedBy = "";
    evidence.status = "待复核";
    evidence.updatedAt = nowText();
    addAudit("登记生产切换证据", evidence.requirementId, `${evidence.artifactName} · 摘要入册`);
    saveState();
    showNotice(`${evidence.name}已登记，需由不同角色独立复核。`);
    render();
  }

  function verifyCutoverEvidence(id) {
    const evidence = state.cutoverEvidenceRequirements.find((item) => item.id === id);
    if (!evidence || evidence.status !== "待复核") return;
    if (evidence.submittedBy === state.activeRole) {
      showNotice("提交人不能复核自己的切换证据，请切换独立复核角色。");
      return;
    }
    evidence.verifiedBy = state.activeRole;
    evidence.status = "已核验";
    evidence.updatedAt = nowText();
    addAudit("独立复核生产切换证据", evidence.requirementId, `${evidence.submittedBy}提交 · ${evidence.verifiedBy}复核`);
    saveState();
    showNotice(`${evidence.name}已完成独立复核。`);
    render();
  }

  async function approveProductionCutover(id) {
    const approval = state.productionCutoverApprovals.find((item) => item.id === id);
    if (!approval || approval.decision === "同意") return;
    const evidenceSubmitters = new Set(state.cutoverEvidenceRequirements.map((item) => item.submittedBy).filter(Boolean));
    const existingApprovers = new Set(state.productionCutoverApprovals.map((item) => item.approver).filter(Boolean));
    if (evidenceSubmitters.has(state.activeRole)) {
      showNotice("证据提交人不能签批同一投产包，请切换独立责任人。");
      return;
    }
    if (existingApprovers.has(state.activeRole)) {
      showNotice("同一签批人不能承担两个投产责任角色。");
      return;
    }
    approval.approver = state.activeRole;
    approval.decision = "同意";
    approval.note = "已复核软件门禁、外部配置与现场证据，同意进入Go/No-Go综合评估。";
    approval.approvedAt = nowText();
    approval.approvalDigest = await productionSha256(`${approval.id}|${approval.approver}|${approval.approvedAt}|approve`);
    addAudit("签批生产切换责任", approval.role, `${approval.approver} · 同意`);
    saveState();
    showNotice(`${approval.role}已由${approval.approver}签批。`);
    render();
  }

  function evaluateProductionGoNoGo() {
    const runtimeReady = state.productionRuntimeControls.every((item) => ["已实现", "已配置"].includes(item.status));
    const evidenceReady = state.cutoverEvidenceRequirements.every((item) => item.status === "已核验" && item.submittedBy !== item.verifiedBy);
    const approvalsReady = state.productionCutoverApprovals.every((item) => item.decision === "同意")
      && new Set(state.productionCutoverApprovals.map((item) => item.approver)).size === state.productionCutoverApprovals.length;
    const queueReady = !state.integrationExecutionJobs.some((item) => ["执行中", "等待回执", "等待重试"].includes(item.status))
      && !state.integrationDeadLetters.some((item) => item.status === "待复核");
    const quarantineReady = !state.integrationQuarantines.some((item) => item.status === "隔离中");
    const cutoverReady = state.integrationCutoverWindows.some((item) => item.status === "可切换");
    const checks = {
      runtime: runtimeReady,
      evidence: evidenceReady,
      approvals: approvalsReady,
      queue: queueReady,
      quarantine: quarantineReady,
      cutoverWindow: cutoverReady,
    };
    const blockers = [
      ...(!runtimeReady ? [`${state.productionRuntimeControls.filter((item) => !["已实现", "已配置"].includes(item.status)).length}项外部运行配置待登记`] : []),
      ...(!evidenceReady ? [`${state.cutoverEvidenceRequirements.filter((item) => item.status !== "已核验").length}项切换证据待核验`] : []),
      ...(!approvalsReady ? [`${state.productionCutoverApprovals.filter((item) => item.decision !== "同意").length}方责任人待签批`] : []),
      ...(!queueReady ? ["执行队列或死信尚未清空"] : []),
      ...(!quarantineReady ? ["存在连接器隔离记录"] : []),
      ...(!cutoverReady ? ["尚无通过门禁的生产切换窗口"] : []),
    ];
    const go = Object.values(checks).every(Boolean);
    state.productionGoNoGo = {
      decision: go ? "GO" : "NO-GO",
      status: go ? "具备切换条件" : "生产切换已阻断",
      checks,
      blockers,
      evaluatedAt: nowText(),
      evaluatedBy: state.activeRole,
    };
    addAudit("执行生产Go/No-Go评估", "数智医院生产切换", `${state.productionGoNoGo.decision} · ${blockers.length}项阻断`);
    saveState();
    showNotice(go ? "全部门禁通过，已形成GO决定。" : `当前为NO-GO：${blockers.join("；")}。`);
    render();
  }

  function createPilotTicket() {
    const hospital = activeHospital();
    const ticket = {
      id: `TKT-${Date.now()}`,
      title: "试点联调新增问题",
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      category: "接口联调",
      priority: "中",
      status: "待分派",
      owner: "未分派",
      createdAt: nowText(),
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString("zh-CN", { hour12: false }),
      slaHours: 24,
      elapsedHours: 0,
      channel: "工单中心",
      description: "试点医院提交的联调问题，待责任组确认和处理。",
    };
    state.pilotTickets.unshift(ticket);
    addAudit("登记试点问题工单", ticket.id, hospital.name);
    saveState();
    showNotice(`${ticket.id}已登记，等待分派。`);
    render();
  }

  function assignPilotTickets() {
    const owners = {
      数据口径: "标准与数据组",
      指标口径: "标准与数据组",
      材料上传: "平台技术组",
      接口联调: "平台技术组",
      账号权限: "系统管理组",
    };
    const pending = state.pilotTickets.filter((item) => item.status === "待分派" || item.owner === "未分派");
    pending.forEach((item) => {
      item.owner = owners[item.category] || "试点联合专班";
      if (item.status === "待分派") item.status = "处理中";
    });
    addAudit("自动分派试点工单", `${pending.length}项工单`, pending.length ? "已分派" : "无待分派工单");
    saveState();
    showNotice(pending.length ? `${pending.length}项工单已自动分派。` : "当前没有待分派工单。");
    render();
  }

  function advancePilotTicket(id) {
    const ticket = state.pilotTickets.find((item) => item.id === id);
    if (!ticket || ticket.status === "已解决") return;
    const flow = { 待分派: "处理中", 处理中: "待回复", 待回复: "已解决" };
    if (ticket.owner === "未分派") ticket.owner = "试点联合专班";
    ticket.status = flow[ticket.status] || "处理中";
    ticket.elapsedHours = ticket.status === "已解决" ? Math.min(ticket.elapsedHours, ticket.slaHours) : Number((ticket.elapsedHours + 1).toFixed(1));
    addAudit("推进试点问题工单", ticket.id, ticket.status);
    saveState();
    showNotice(`${ticket.id}已推进至“${ticket.status}”。`);
    render();
  }

  function escalatePilotTicket(id) {
    const ticket = state.pilotTickets.find((item) => item.id === id);
    if (!ticket || ticket.status === "已解决") return;
    const priorityFlow = { 低: "中", 中: "高", 高: "紧急", 紧急: "紧急" };
    ticket.priority = priorityFlow[ticket.priority] || "高";
    ticket.owner = "试点联合专班";
    ticket.status = "处理中";
    ticket.slaHours = Math.max(4, Math.round(ticket.slaHours / 2));
    addAudit("升级试点问题工单", ticket.id, `${ticket.priority} · ${ticket.owner}`);
    saveState();
    showNotice(`${ticket.id}已升级为${ticket.priority}优先级。`);
    render();
  }

  function createTrainingSession() {
    const session = {
      id: `TRN-${Date.now()}`,
      title: "试点问题集中答疑",
      audience: "医院管理员、接口管理员",
      startAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toLocaleString("zh-CN", { hour12: false }),
      mode: "线上会议",
      capacity: 100,
      enrolled: 0,
      attended: 0,
      questions: collaborationSummary().openTickets,
      status: "待发布",
      owner: "试点培训组",
      materials: 2,
    };
    state.trainingSessions.unshift(session);
    addAudit("新建试点培训场次", session.id, "待发布");
    saveState();
    showNotice("集中答疑场次已创建。");
    render();
  }

  function publishTrainingSession() {
    const session = state.trainingSessions.find((item) => item.status === "待发布");
    if (!session) {
      showNotice("当前没有待发布的培训场次。");
      return;
    }
    session.status = "已发布";
    addAudit("发布试点培训场次", session.id, session.startAt);
    saveState();
    showNotice(`${session.title}已发布。`);
    render();
  }

  function recordTrainingAttendance(id) {
    const session = state.trainingSessions.find((item) => item.id === id);
    if (!session || session.status === "已完成") return;
    session.attended = Math.max(session.attended, Math.round(session.enrolled * 0.9));
    session.status = "进行中";
    addAudit("记录试点培训签到", session.id, `${session.attended}人`);
    saveState();
    showNotice(`${session.title}已记录${session.attended}人签到。`);
    render();
  }

  function completeTrainingSession(id) {
    const session = state.trainingSessions.find((item) => item.id === id);
    if (!session || session.status === "已完成") return;
    session.attended = session.attended || Math.round(session.enrolled * 0.9);
    session.questions = 0;
    session.status = "已完成";
    addAudit("完成试点培训场次", session.id, `${session.attended}人参训`);
    saveState();
    showNotice(`${session.title}已完成并归档。`);
    render();
  }

  function createPilotRelease() {
    const sequence = state.pilotReleases.filter((item) => item.status === "候选").length + 1;
    const release = {
      id: `REL-0.8.0-RC${sequence}-${Date.now()}`,
      version: `v0.8.${sequence}-rc${sequence}`,
      title: "试点协同体验优化",
      scope: "首批3家验证医院",
      status: "候选",
      plannedAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleString("zh-CN", { hour12: false }),
      publishedAt: "",
      owner: "产品与试点组",
      changes: 8,
      feedbackCount: 0,
      openFeedback: 0,
    };
    state.pilotReleases.unshift(release);
    addAudit("新建试点候选版本", release.version, release.scope);
    saveState();
    showNotice(`${release.version}候选版本已创建。`);
    render();
  }

  function publishPilotRelease() {
    const release = state.pilotReleases.find((item) => item.status === "候选");
    if (!release) {
      showNotice("当前没有待发布的候选版本。");
      return;
    }
    release.status = "已发布";
    release.publishedAt = nowText();
    addAudit("发布试点版本", release.version, release.scope);
    saveState();
    showNotice(`${release.version}已发布至试点范围。`);
    render();
  }

  function collectPilotFeedback() {
    const hospital = activeHospital();
    const release = state.pilotReleases.find((item) => item.status === "已发布") || state.pilotReleases[0];
    const feedback = {
      id: `FB-${Date.now()}`,
      releaseId: release.id,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      title: "试点操作流程优化建议",
      type: "体验建议",
      priority: "中",
      status: "待评估",
      owner: "产品组",
      createdAt: nowText(),
      resolution: "",
    };
    state.pilotFeedback.unshift(feedback);
    release.feedbackCount += 1;
    release.openFeedback += 1;
    addAudit("收集试点版本反馈", feedback.id, release.version);
    saveState();
    showNotice(`${hospital.name}的版本反馈已登记。`);
    render();
  }

  function resolvePilotFeedback(id) {
    const feedback = state.pilotFeedback.find((item) => item.id === id);
    if (!feedback || feedback.status === "已解决") return;
    feedback.status = "已解决";
    feedback.resolution = "已纳入试点优化清单并完成验证。";
    const release = state.pilotReleases.find((item) => item.id === feedback.releaseId);
    if (release) release.openFeedback = Math.max(0, release.openFeedback - 1);
    addAudit("解决试点版本反馈", feedback.id, feedback.resolution);
    saveState();
    showNotice(`${feedback.id}已解决。`);
    render();
  }

  function recalculatePilotOutcomes() {
    state.pilotHospitalOutcomes.forEach((item) => {
      const readiness = state.hospitalReadiness.find((entry) => entry.hospitalCode === item.hospitalCode);
      const openTickets = state.pilotTickets.filter((entry) => entry.hospitalCode === item.hospitalCode && entry.status !== "已解决").length;
      const openFeedback = state.pilotFeedback.filter((entry) => entry.hospitalCode === item.hospitalCode && entry.status !== "已解决").length;
      item.majorIssues = openTickets + openFeedback + Number(readiness?.blockers || 0);
      item.processCompletion = Math.round((Number(item.processCompletion || 0) + Number(readiness?.readiness || 0)) / 2);
      item.score = Math.round(item.processCompletion * 0.3 + item.dataQuality * 0.3 + item.auditPassRate * 0.2 + item.satisfaction * 0.2);
      item.status = item.score >= 90 && item.majorIssues <= 1 ? "可推广" : item.score >= 80 && item.majorIssues <= 4 ? "条件通过" : "需优化";
      item.evaluatedAt = nowText();
    });
    const averages = {
      "OUTCOME-PROCESS": state.pilotHospitalOutcomes.reduce((sum, item) => sum + item.processCompletion, 0) / Math.max(1, state.pilotHospitalOutcomes.length),
      "OUTCOME-DATA": state.pilotHospitalOutcomes.reduce((sum, item) => sum + item.dataQuality, 0) / Math.max(1, state.pilotHospitalOutcomes.length),
      "OUTCOME-REVIEW": state.pilotHospitalOutcomes.reduce((sum, item) => sum + item.auditPassRate, 0) / Math.max(1, state.pilotHospitalOutcomes.length),
      "OUTCOME-UPTIME": state.serviceHealth.reduce((sum, item) => sum + Number(item.availability || 0), 0) / Math.max(1, state.serviceHealth.length),
      "OUTCOME-SAT": state.pilotHospitalOutcomes.reduce((sum, item) => sum + item.satisfaction, 0) / Math.max(1, state.pilotHospitalOutcomes.length),
    };
    state.pilotOutcomeMetrics.forEach((item) => {
      item.current = Number(averages[item.id].toFixed(item.id === "OUTCOME-UPTIME" ? 2 : 0));
      item.status = item.current >= item.target ? "达标" : item.current < item.target - 10 ? "未达标" : "关注";
    });
    addAudit("重新计算试点成效", "成效指标与医院评分", `综合${assessmentSummary().weightedScore}`);
    saveState();
    showNotice("试点成效指标和医院评分已重新计算。");
    render();
  }

  function generateIssueReview() {
    const openValidation = state.validationIssues.filter((item) => item.status !== "resolved").length;
    const failedUploads = state.uploadQueue.filter((item) => item.status === "失败").length;
    const unhealthyInterfaces = state.interfaceHealth.filter((item) => item.status !== "正常").length;
    const openFeedback = state.pilotFeedback.filter((item) => item.status !== "已解决").length;
    const counts = {
      "THEME-DATA-MAP": state.pilotTickets.filter((item) => item.category === "数据口径" && item.status !== "已解决").length + openValidation,
      "THEME-UPLOAD": state.pilotTickets.filter((item) => item.category === "材料上传" && item.status !== "已解决").length + failedUploads + unhealthyInterfaces,
      "THEME-STANDARD": state.pilotTickets.filter((item) => item.category === "指标口径" && item.status !== "已解决").length + openFeedback,
      "THEME-ACCESS": state.pilotTickets.filter((item) => item.category === "账号权限" && item.status !== "已解决").length,
    };
    state.pilotIssueThemes.forEach((item) => {
      const count = counts[item.id];
      if (typeof count === "number") {
        item.count = count;
        item.sourceCount = Math.max(count, count + Math.ceil(openFeedback / 2));
      }
      if (item.status !== "已闭环") item.status = item.count > 4 ? "改进中" : "分析完成";
      item.reviewedAt = nowText();
    });
    addAudit("生成试点问题复盘", `${state.pilotIssueThemes.length}个问题主题`, `${assessmentSummary().openThemes}个开放主题`);
    saveState();
    showNotice("问题工单、反馈、校验和监控线索已重新归并。");
    render();
  }

  function closeIssueTheme(id) {
    const theme = state.pilotIssueThemes.find((item) => item.id === id);
    if (!theme || theme.status === "已闭环") return;
    theme.status = "已闭环";
    theme.reviewedAt = nowText();
    addAudit("确认试点问题主题闭环", theme.id, theme.title);
    saveState();
    showNotice(`${theme.title}已确认闭环。`);
    render();
  }

  function createImprovementPlan() {
    const theme = state.pilotIssueThemes.find((item) => item.status !== "已闭环") || state.pilotIssueThemes[0];
    const plan = {
      id: `PLAN-${Date.now()}`,
      sourceId: theme.id,
      title: `补充${theme.category}试点优化措施`,
      source: `${theme.title}复盘`,
      priority: theme.impact === "高" ? "高" : "中",
      owner: theme.owner,
      targetVersion: "v0.9.2",
      dueAt: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toLocaleDateString("zh-CN"),
      status: "待开始",
      progress: 0,
      acceptance: "完成三类试点医院回归验证并形成验收记录",
    };
    state.pilotImprovementPlans.unshift(plan);
    addAudit("生成试点优化事项", plan.id, theme.id);
    saveState();
    showNotice(`${plan.title}已加入优化计划。`);
    render();
  }

  function advanceImprovementPlan(id) {
    const plan = state.pilotImprovementPlans.find((item) => item.id === id);
    if (!plan || plan.status === "已完成") return;
    const flow = {
      待开始: { status: "进行中", progress: 40 },
      进行中: { status: "待验收", progress: 90 },
      待验收: { status: "已完成", progress: 100 },
    };
    const next = flow[plan.status] || flow.待开始;
    plan.status = next.status;
    plan.progress = Math.max(plan.progress, next.progress);
    if (plan.status === "已完成") {
      const theme = state.pilotIssueThemes.find((item) => item.id === plan.sourceId);
      if (theme) theme.status = "已闭环";
    }
    addAudit("推进试点优化事项", plan.id, `${plan.status} · ${plan.progress}%`);
    saveState();
    showNotice(`${plan.title}已推进至“${plan.status}”。`);
    render();
  }

  function recalculateRolloutRegion(item) {
    const dimensions = ["organization", "platform", "security", "training", "dataMigration"];
    item.readiness = Math.round(dimensions.reduce((sum, field) => sum + Number(item[field] || 0), 0) / dimensions.length);
    if (item.status !== "已启动") item.status = item.readiness >= 90 ? "可启动" : item.readiness >= 75 ? "准备中" : "有风险";
  }

  function assessRolloutReadiness() {
    state.rolloutRegions.forEach(recalculateRolloutRegion);
    addAudit("评估区域推广准备度", `${state.rolloutRegions.length}个区域`, `平均${assessmentSummary().averageRolloutReadiness}%`);
    saveState();
    showNotice("推广区域已按五个准入维度重新评估。");
    render();
  }

  function advanceRolloutRegion(id) {
    const region = state.rolloutRegions.find((item) => item.id === id);
    if (!region || region.status === "已启动") return;
    const dimensions = ["organization", "platform", "security", "training", "dataMigration"];
    const weakest = dimensions.reduce((result, field) => (region[field] < region[result] ? field : result), dimensions[0]);
    region[weakest] = Math.min(100, region[weakest] + 10);
    recalculateRolloutRegion(region);
    addAudit("推进区域推广准备", region.province, `${region.readiness}% · ${region.status}`);
    saveState();
    showNotice(`${region.province}已完成一项推广准备工作。`);
    render();
  }

  function launchRolloutRegion(id) {
    const region = state.rolloutRegions.find((item) => item.id === id);
    if (!region || region.status === "已启动") return;
    if (region.readiness < 85) {
      showNotice(`${region.province}准备度不足85%，暂不能启动推广。`);
      return;
    }
    region.status = "已启动";
    region.startedAt = nowText();
    addAudit("启动区域推广", region.province, `${region.hospitalCount}家医院`);
    saveState();
    showNotice(`${region.province}已启动推广。`);
    render();
  }

  function generateAssessmentReport() {
    const summary = assessmentSummary();
    const report = {
      id: `ASSESS-${Date.now()}`,
      period: "2026年首批试点",
      version: state.pilotReleases.find((item) => item.status === "已发布")?.version || "v0.9.0",
      coverage: state.pilotHospitalOutcomes.length,
      score: Math.round(summary.weightedScore),
      conclusion: summary.weightedScore >= 85 ? "核心评价闭环运行稳定，具备扩大试点条件。" : "核心流程已验证，需完成重点优化后扩大试点。",
      recommendation: `优先完成${summary.openPlans}项开放优化计划，按区域准备度分批启动推广。`,
      status: "草稿",
      generatedAt: nowText(),
      publishedAt: "",
    };
    state.pilotAssessmentReports.unshift(report);
    addAudit("生成试点评估报告", report.id, `${report.score}分`);
    saveState();
    showNotice("试点评估报告已生成，请复核后发布。");
    render();
  }

  function publishAssessmentReport() {
    const report = state.pilotAssessmentReports.find((item) => item.status === "草稿");
    if (!report) {
      showNotice("当前没有待发布的试点评估报告。");
      return;
    }
    report.status = "已发布";
    report.publishedAt = nowText();
    addAudit("发布试点评估报告", report.id, report.conclusion);
    saveState();
    showNotice(`${report.id}已发布。`);
    render();
  }

  function syncAssistantKnowledge() {
    const syncedAt = nowText();
    state.assistantKnowledgeSources.forEach((item) => {
      item.lastSyncedAt = syncedAt;
    });
    addAudit("同步评价助手知识源", `${state.assistantKnowledgeSources.length}个知识源`, `${assistantSummary().knowledgeChunks}个知识片段`);
    saveState();
    showNotice("标准、材料、数据目录和试点案例知识源已同步。");
    render();
  }

  function sourceMatchForCitation(citation) {
    if (/证据材料/.test(citation)) return { sourceId: "KS-EVIDENCE", chunkId: citation.match(/EVD-[A-Z0-9-]+/)?.[0] || "EVIDENCE-RULE" };
    if (/数据采集/.test(citation)) return { sourceId: "KS-DATA", chunkId: citation.match(/[A-Z]+-[A-Z]+-[0-9]+/)?.[0] || "DATA-RULE" };
    return { sourceId: "KS-STANDARD", chunkId: citation.match(/[A-Z][0-9][A-Z0-9.-]*/)?.[0] || "STANDARD-RULE" };
  }

  function createRetrievalTrace(record) {
    const threshold = 0.8;
    const topMatches = record.citations.map((citation, index) => {
      const source = sourceMatchForCitation(citation);
      return {
        ...source,
        citation,
        score: Math.max(0.82, (record.confidence - index * 4) / 100),
      };
    });
    const trace = {
      id: `RTR-${record.id}-${Date.now()}`,
      questionId: record.id,
      hospitalCode: record.hospitalCode,
      query: record.question,
      topMatches,
      hitCount: topMatches.length,
      threshold,
      status: topMatches.length >= 2 && topMatches.every((item) => item.score >= threshold) ? "命中充分" : "需补充",
      durationMs: 72 + Math.round(record.question.length * 1.7),
      createdAt: nowText(),
    };
    state.assistantRetrievalTraces.unshift(trace);
    return trace;
  }

  function recordAssistantModelCall({ businessId, scene, modelRoute, promptVersion, requestText, responseText, risk = "低", fallback = false }) {
    const call = {
      id: `MC-${businessId}-${Date.now()}`,
      businessId,
      scene,
      modelRoute,
      promptVersion,
      requestDigest: digestText(requestText),
      responseDigest: digestText(responseText),
      inputTokens: 420 + String(requestText).length * 2,
      outputTokens: 72 + String(responseText).length,
      latencyMs: fallback ? 780 : 360 + String(responseText).length,
      fallback,
      risk,
      callStatus: fallback ? "降级" : "成功",
      reviewStatus: "待复核",
      operator: state.activeRole,
      calledAt: nowText(),
      reviewedBy: "",
      reviewedAt: "",
    };
    state.assistantModelCalls.unshift(call);
    return call;
  }

  function createKnowledgeVersion() {
    const source = state.assistantKnowledgeSources.find((item) => item.id === "KS-FAQ") || state.assistantKnowledgeSources[0];
    const sequence = state.assistantKnowledgeVersions.filter((item) => item.sourceId === source.id).length + 1;
    const version = `${source.version}.${sequence}`;
    const record = {
      id: `KV-${source.id}-${Date.now()}`,
      sourceId: source.id,
      sourceName: source.name,
      version,
      previousVersion: source.version,
      changeSummary: "归并本轮试点问答、审核复核意见和规则校验案例。",
      addedChunks: 6,
      removedChunks: 1,
      checksum: digestText(`${source.id}:${version}:${nowText()}`),
      status: "草稿",
      owner: source.owner,
      reviewer: "评价审核组",
      createdAt: nowText(),
      effectiveAt: "",
    };
    state.assistantKnowledgeVersions.unshift(record);
    addAudit("新建评价助手知识版本", record.id, record.version);
    saveState();
    showNotice(`${record.version}已创建，等待提交审批。`);
    render();
  }

  function advanceKnowledgeVersion(id) {
    const record = state.assistantKnowledgeVersions.find((item) => item.id === id);
    if (!record || record.status === "已发布") return;
    const nextStatus = { 草稿: "待审批", 待审批: "已批准", 已批准: "已发布" }[record.status];
    if (!nextStatus) return;
    record.status = nextStatus;
    record.reviewer = state.activeRole;
    if (nextStatus === "已发布") {
      record.effectiveAt = nowText();
      const source = state.assistantKnowledgeSources.find((item) => item.id === record.sourceId);
      if (source) {
        source.version = record.version;
        source.status = "已启用";
        source.chunks = Math.max(0, Number(source.chunks || 0) + record.addedChunks - record.removedChunks);
        source.lastSyncedAt = record.effectiveAt;
      }
    }
    addAudit("推进知识版本审批", record.id, nextStatus);
    saveState();
    showNotice(`${record.version}已更新为${nextStatus}。`);
    render();
  }

  function runRetrievalQualityCheck() {
    state.assistantRetrievalTraces.forEach((trace) => {
      trace.hitCount = trace.topMatches.length;
      trace.status = trace.topMatches.length >= 2 && trace.topMatches.every((item) => item.score >= trace.threshold) ? "命中充分" : "需补充";
      trace.durationMs = Math.max(40, trace.durationMs - 3);
    });
    addAudit("复核评价助手检索质量", `${state.assistantRetrievalTraces.length}次检索`, `通过率${assistantSummary().retrievalPassRate}%`);
    saveState();
    showNotice(`检索质量复核完成，通过率${assistantSummary().retrievalPassRate}%。`);
    render();
  }

  function simulateModelAudit() {
    const call = recordAssistantModelCall({
      businessId: `DRILL-${Date.now()}`,
      scene: "标准问答降级演练",
      modelRoute: "规则检索兜底",
      promptVersion: "QA-PROMPT-v2.1",
      requestText: "知识检索服务超时后的只读规则兜底演练",
      responseText: "返回已发布规则原文，不生成评价结论，并转人工复核。",
      risk: "中",
      fallback: true,
    });
    addAudit("发起模型调用降级演练", call.id, "已触发人工复核");
    saveState();
    showNotice("降级演练已完成，调用记录进入人工复核队列。");
    render();
  }

  function reviewModelCall(id) {
    const call = state.assistantModelCalls.find((item) => item.id === id);
    if (!call || call.reviewStatus === "已复核") return;
    call.reviewStatus = "已复核";
    call.reviewedBy = state.activeRole;
    call.reviewedAt = nowText();
    addAudit("人工复核模型调用", call.id, call.callStatus);
    saveState();
    showNotice(`${call.id}已完成人工复核。`);
    render();
  }

  function assistantQualityGateStatus(metrics) {
    const gate = state.assistantQualityGate;
    return metrics.citationCoverage >= gate.citationCoverage
      && metrics.answerAccuracy >= gate.answerAccuracy
      && metrics.retrievalRecall >= gate.retrievalRecall
      && metrics.safetyCompliance >= gate.safetyCompliance
      && metrics.averageLatencyMs <= gate.maxLatencyMs
      && metrics.baselineDelta >= -gate.maxRegressionPoints
      ? "通过"
      : "阻断";
  }

  function createEvaluationSuite() {
    const sequence = state.assistantEvaluationSuites.length + 1;
    const suite = {
      id: `EVALSET-PILOT-${Date.now()}`,
      name: `试点问题增量评测集${sequence}`,
      version: "v0.1",
      type: "试点泛化",
      domains: ["口径变更", "长尾问题", "拒答边界"],
      caseCount: 12,
      source: "本轮试点工单、问答确认和风险复核记录",
      owner: "试点培训组",
      status: "草稿",
      updatedAt: nowText(),
    };
    state.assistantEvaluationSuites.unshift(suite);
    addAudit("新建评价助手评测集", suite.id, `${suite.caseCount}个样本`);
    saveState();
    showNotice(`${suite.name}已创建，完成专家复核后可发布进入门禁。`);
    render();
  }

  function runAssistantEvaluation() {
    const candidate = state.assistantReleaseCandidates.find((item) => item.status === "候选" && item.gateStatus === "阻断")
      || state.assistantReleaseCandidates.find((item) => item.status === "候选")
      || state.assistantReleaseCandidates[0];
    const metrics = {
      citationCoverage: 100,
      answerAccuracy: 94,
      retrievalRecall: 92,
      safetyCompliance: 100,
      averageLatencyMs: 518,
      baselineDelta: 1.4,
    };
    const run = {
      id: `EVALRUN-${Date.now()}`,
      candidateVersion: candidate.version,
      suiteVersion: state.assistantEvaluationSuites.filter((item) => item.status === "已发布").map((item) => `${item.id}@${item.version}`).join("+"),
      knowledgeVersion: candidate.knowledgeVersion,
      promptVersion: candidate.promptVersion,
      ...metrics,
      score: Math.round((metrics.citationCoverage + metrics.answerAccuracy + metrics.retrievalRecall + metrics.safetyCompliance) / 4),
      gateStatus: assistantQualityGateStatus(metrics),
      status: "已完成",
      startedAt: nowText(),
      finishedAt: nowText(),
    };
    state.assistantEvaluationRuns.unshift(run);
    candidate.evaluationRunId = run.id;
    candidate.gateStatus = run.gateStatus;
    addAudit("运行评价助手全量评测", run.id, `${run.gateStatus} · 得分${run.score}`);
    saveState();
    showNotice(`${candidate.version}评测完成，质量门禁${run.gateStatus}。`);
    render();
  }

  function createAssistantRelease() {
    const latestRun = state.assistantEvaluationRuns[0];
    if (!latestRun) {
      showNotice("请先运行全量评测。");
      return;
    }
    const activeRelease = state.assistantReleaseCandidates.find((item) => item.status === "已发布");
    const sequence = 11 + state.assistantReleaseCandidates.length;
    const record = {
      id: `REL-ASSIST-${Date.now()}`,
      version: `ASSIST-2026.07.${String(sequence).padStart(2, "0")}`,
      modelRoute: "规则检索+摘要模型",
      promptVersion: latestRun.promptVersion,
      knowledgeVersion: latestRun.knowledgeVersion,
      evaluationRunId: latestRun.id,
      gateStatus: latestRun.gateStatus,
      status: "候选",
      owner: "评价助手治理组",
      reviewer: "国家级标准管理员",
      createdAt: nowText(),
      publishedAt: "",
      rollbackTarget: activeRelease?.version || "",
    };
    state.assistantReleaseCandidates.unshift(record);
    addAudit("创建评价助手发布候选", record.id, `${record.gateStatus} · ${record.evaluationRunId}`);
    saveState();
    showNotice(`${record.version}已创建，当前门禁${record.gateStatus}。`);
    render();
  }

  function advanceAssistantRelease(id) {
    const record = state.assistantReleaseCandidates.find((item) => item.id === id);
    if (!record || record.gateStatus !== "通过" || !["候选", "待审批"].includes(record.status)) return;
    if (record.status === "候选") {
      record.status = "待审批";
      record.reviewer = state.activeRole;
      addAudit("提交评价助手版本审批", record.id, record.evaluationRunId);
      saveState();
      showNotice(`${record.version}已提交发布审批。`);
      render();
      return;
    }
    const activeRelease = state.assistantReleaseCandidates.find((item) => item.status === "已发布");
    if (activeRelease) {
      activeRelease.status = "历史版本";
      record.rollbackTarget = activeRelease.version;
    }
    record.status = "已发布";
    record.publishedAt = nowText();
    record.reviewer = state.activeRole;
    addAudit("发布评价助手版本", record.id, `${record.version} · 可回滚至${record.rollbackTarget}`);
    saveState();
    showNotice(`${record.version}已发布上线。`);
    render();
  }

  function rollbackAssistantRelease(id) {
    const record = state.assistantReleaseCandidates.find((item) => item.id === id);
    if (!record || record.status !== "已发布") return;
    const target = state.assistantReleaseCandidates.find((item) => item.version === record.rollbackTarget && item.status === "历史版本")
      || state.assistantReleaseCandidates.find((item) => item.status === "历史版本");
    if (!target) {
      showNotice("没有可恢复的历史版本。");
      return;
    }
    record.status = "已回滚";
    target.status = "已发布";
    target.publishedAt = nowText();
    addAudit("回滚评价助手版本", record.id, `已恢复${target.version}`);
    saveState();
    showNotice(`${record.version}已回滚，当前线上版本为${target.version}。`);
    render();
  }

  function assistantOnlineQualityStatus(metrics) {
    const guardrail = state.assistantOnlineGuardrail;
    return metrics.citationCoverage >= guardrail.citationCoverage
      && metrics.answerAcceptance >= guardrail.answerAcceptance
      && metrics.noAnswerRate <= guardrail.maxNoAnswerRate
      && metrics.escalationRate <= guardrail.maxEscalationRate
      && metrics.p95LatencyMs <= guardrail.maxP95LatencyMs
      && metrics.safetyEvents <= guardrail.maxSafetyEvents
      && metrics.driftScore <= guardrail.maxDriftScore
      ? "健康"
      : "异常";
  }

  function createCanaryDeployment() {
    const existing = state.assistantDeployments.find((item) => item.strategy === "灰度" && ["灰度中", "已暂停"].includes(item.status));
    if (existing) {
      showNotice(`已有${existing.version}正在灰度，请先完成或回滚。`);
      return;
    }
    const latestPassedRun = state.assistantEvaluationRuns.find((item) => item.gateStatus === "通过");
    if (!latestPassedRun) {
      showNotice("没有通过离线质量门禁的评测运行，请先完成全量评测。");
      return;
    }
    const maxSequence = state.assistantReleaseCandidates.reduce((max, item) => {
      const sequence = Number(String(item.version).split(".").pop());
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 12);
    const version = `ASSIST-2026.07.${String(maxSequence + 1).padStart(2, "0")}`;
    const stableDeployment = state.assistantDeployments.find((item) => item.status === "稳定")
      || state.assistantDeployments.find((item) => item.status === "已完成")
      || state.assistantDeployments[0];
    const release = {
      id: `REL-ASSIST-${Date.now()}`,
      version,
      modelRoute: "规则检索+摘要模型",
      promptVersion: latestPassedRun.promptVersion,
      knowledgeVersion: latestPassedRun.knowledgeVersion,
      evaluationRunId: latestPassedRun.id,
      gateStatus: "通过",
      status: "候选",
      owner: "评价助手治理组",
      reviewer: state.activeRole,
      createdAt: nowText(),
      publishedAt: "",
      rollbackTarget: stableDeployment?.version || "",
    };
    const deployment = {
      id: `DEP-ASSIST-${Date.now()}`,
      releaseId: release.id,
      version,
      strategy: "灰度",
      trafficPercent: 10,
      cohorts: ["首批试点医院", "医院填报员"],
      stableVersion: stableDeployment?.version || "ASSIST-2026.07.11",
      status: "灰度中",
      owner: "评价助手运行保障组",
      startedAt: nowText(),
      updatedAt: nowText(),
      rollbackAt: "",
    };
    state.assistantReleaseCandidates.unshift(release);
    state.assistantDeployments.unshift(deployment);
    addAudit("创建评价助手灰度部署", deployment.id, `${version} · 10%流量 · 基线${deployment.stableVersion}`);
    saveState();
    showNotice(`${version}已开始10%灰度，请采集在线质量窗口后扩量。`);
    render();
  }

  function runOnlineQualityCheck() {
    const deployment = state.assistantDeployments.find((item) => item.strategy === "灰度" && item.status === "灰度中");
    if (!deployment) {
      showNotice("当前没有可采集的灰度部署。");
      return;
    }
    const metrics = {
      sampleCount: 680 + state.assistantOnlineQualityWindows.length * 73,
      citationCoverage: 100,
      answerAcceptance: 94,
      noAnswerRate: 3.6,
      escalationRate: 7.4,
      p95LatencyMs: 688,
      safetyEvents: 0,
      driftScore: 2.1,
    };
    const windowRecord = {
      id: `QWIN-ASSIST-${Date.now()}`,
      deploymentId: deployment.id,
      version: deployment.version,
      period: "最近30分钟",
      ...metrics,
      status: assistantOnlineQualityStatus(metrics),
      collectedAt: nowText(),
    };
    state.assistantOnlineQualityWindows.unshift(windowRecord);
    deployment.updatedAt = nowText();
    addAudit("采集评价助手在线质量窗口", windowRecord.id, `${deployment.version} · ${windowRecord.status}`);
    saveState();
    showNotice(`${deployment.version}在线质量窗口${windowRecord.status}，可继续扩量。`);
    render();
  }

  function advanceCanaryDeployment(id) {
    const deployment = state.assistantDeployments.find((item) => item.id === id);
    if (!deployment || deployment.status !== "灰度中") return;
    const latestWindow = state.assistantOnlineQualityWindows.find((item) => item.deploymentId === deployment.id);
    const hasOpenIncident = state.assistantQualityIncidents.some((item) => item.deploymentId === deployment.id && item.status !== "已解决");
    if (!latestWindow || latestWindow.status !== "健康" || hasOpenIncident) {
      showNotice("最新在线质量窗口不健康或仍有开放事件，不能扩量。");
      return;
    }
    if (deployment.trafficPercent < 30) {
      deployment.trafficPercent = 30;
      deployment.cohorts = ["首批试点医院", "医院填报员", "省级审核员"];
      deployment.updatedAt = nowText();
      addAudit("扩量评价助手灰度部署", deployment.id, `${deployment.version} · 30%流量`);
      saveState();
      showNotice(`${deployment.version}已扩量至30%，请继续观察在线质量。`);
      render();
      return;
    }
    deployment.trafficPercent = 100;
    deployment.strategy = "全量";
    deployment.cohorts = ["全部试点医院"];
    deployment.status = "已完成";
    deployment.updatedAt = nowText();
    const previousStable = state.assistantDeployments.find((item) => item.id !== deployment.id && item.status === "稳定");
    if (previousStable) previousStable.status = "历史版本";
    const release = state.assistantReleaseCandidates.find((item) => item.id === deployment.releaseId);
    const previousRelease = state.assistantReleaseCandidates.find((item) => item.status === "已发布");
    if (previousRelease && previousRelease.id !== release?.id) previousRelease.status = "历史版本";
    if (release) {
      release.status = "已发布";
      release.publishedAt = nowText();
    }
    addAudit("完成评价助手灰度转全量", deployment.id, `${deployment.version} · 100%流量`);
    saveState();
    showNotice(`${deployment.version}已通过灰度验证并转为全量版本。`);
    render();
  }

  function simulateOnlineDegradation() {
    const deployment = state.assistantDeployments.find((item) => item.strategy === "灰度" && item.status === "灰度中");
    if (!deployment) {
      showNotice("当前没有运行中的灰度部署。");
      return;
    }
    const metrics = {
      sampleCount: 412,
      citationCoverage: 96.8,
      answerAcceptance: 82,
      noAnswerRate: 11.4,
      escalationRate: 16.2,
      p95LatencyMs: 1280,
      safetyEvents: 0,
      driftScore: 7.6,
    };
    const windowRecord = {
      id: `QWIN-ASSIST-${Date.now()}`,
      deploymentId: deployment.id,
      version: deployment.version,
      period: "最近15分钟",
      ...metrics,
      status: assistantOnlineQualityStatus(metrics),
      collectedAt: nowText(),
    };
    const incident = {
      id: `QINC-ASSIST-${Date.now()}`,
      deploymentId: deployment.id,
      version: deployment.version,
      signal: "采纳率、转人工率、P95时延与分布漂移同时越界",
      level: "高",
      threshold: `采纳率≥${state.assistantOnlineGuardrail.answerAcceptance}% · P95≤${state.assistantOnlineGuardrail.maxP95LatencyMs}ms · 漂移≤${state.assistantOnlineGuardrail.maxDriftScore}`,
      actual: `采纳率${metrics.answerAcceptance}% · P95 ${metrics.p95LatencyMs}ms · 漂移${metrics.driftScore}`,
      action: "自动暂停扩量，保留稳定版本流量，等待人工回滚或问题修复",
      owner: "评价助手运行保障组",
      status: "开放",
      createdAt: nowText(),
      resolvedAt: "",
    };
    state.assistantOnlineQualityWindows.unshift(windowRecord);
    state.assistantQualityIncidents.unshift(incident);
    deployment.status = "已暂停";
    deployment.updatedAt = nowText();
    addAudit("触发评价助手在线质量事件", incident.id, `${deployment.version} · 已暂停扩量`);
    saveState();
    showNotice(`${deployment.version}指标越界，灰度已暂停并生成质量事件。`);
    render();
  }

  function rollbackCanaryDeployment(id) {
    const deployment = state.assistantDeployments.find((item) => item.id === id);
    if (!deployment || deployment.status === "已回滚" || deployment.status === "稳定") return;
    deployment.status = "已回滚";
    deployment.trafficPercent = 0;
    deployment.rollbackAt = nowText();
    deployment.updatedAt = nowText();
    state.assistantQualityIncidents
      .filter((item) => item.deploymentId === deployment.id && item.status !== "已解决")
      .forEach((item) => {
        item.status = "已解决";
        item.action = `${item.action}；已回滚至${deployment.stableVersion}`;
        item.resolvedAt = nowText();
      });
    const stableDeployment = state.assistantDeployments.find((item) => item.version === deployment.stableVersion);
    if (stableDeployment) {
      stableDeployment.status = "稳定";
      stableDeployment.trafficPercent = 100;
      stableDeployment.updatedAt = nowText();
    }
    const release = state.assistantReleaseCandidates.find((item) => item.id === deployment.releaseId);
    if (release && release.status !== "已发布") release.status = "已回滚";
    const stableRelease = state.assistantReleaseCandidates.find((item) => item.version === deployment.stableVersion);
    if (stableRelease) stableRelease.status = "已发布";
    addAudit("回滚评价助手灰度部署", deployment.id, `${deployment.version} → ${deployment.stableVersion}`);
    saveState();
    showNotice(`${deployment.version}已回滚，稳定版本${deployment.stableVersion}恢复100%流量。`);
    render();
  }

  function collectAssistantFeedback() {
    const deployment = state.assistantDeployments.find((item) => item.status === "稳定")
      || state.assistantDeployments.find((item) => item.status === "已完成")
      || state.assistantDeployments[0];
    const question = state.standardQaRecords.find((item) => item.scope.startsWith("B3")) || state.standardQaRecords[0];
    const feedback = {
      id: `AFB-${Date.now()}`,
      deploymentId: deployment?.id || "",
      version: deployment?.version || assistantSummary().activeReleaseVersion,
      questionId: question?.id || "",
      channel: "试点工单",
      rating: 2,
      sentiment: "负向",
      reason: "边界口径不完整",
      comment: "失败重试去重说明缺少同一业务请求标识和重试窗口的明确引用，需要补充标准依据。",
      citationUseful: false,
      userRole: "试点协调员",
      status: "待研判",
      createdAt: nowText(),
      reviewedBy: "",
      reviewedAt: "",
    };
    state.assistantFeedbackRecords.unshift(feedback);
    addAudit("采集评价助手线上反馈", feedback.id, `${feedback.version} · ${feedback.reason}`);
    saveState();
    showNotice(`${feedback.id}已进入人工研判队列。`);
    render();
  }

  function reviewAssistantFeedback(id) {
    const feedback = state.assistantFeedbackRecords.find((item) => item.id === id);
    if (!feedback || feedback.status !== "待研判") return;
    feedback.status = feedback.sentiment === "负向" ? "已研判" : "已关闭";
    feedback.reviewedBy = state.activeRole;
    feedback.reviewedAt = nowText();
    addAudit("人工研判评价助手反馈", feedback.id, `${feedback.sentiment} · ${feedback.reason}`);
    saveState();
    showNotice(`${feedback.id}已完成研判${feedback.sentiment === "负向" ? "，可转为改进样本" : "并关闭"}。`);
    render();
  }

  function convertFeedbackSample(id) {
    const feedback = state.assistantFeedbackRecords.find((item) => item.id === id);
    if (!feedback || feedback.sentiment !== "负向" || feedback.status !== "已研判") return;
    if (state.assistantImprovementSamples.some((item) => item.feedbackId === feedback.id)) return;
    const question = state.standardQaRecords.find((item) => item.id === feedback.questionId);
    const domain = question?.scope?.split(" ")[0] || "通用";
    const sample = {
      id: `AIS-${Date.now()}`,
      feedbackId: feedback.id,
      sourceVersion: feedback.version,
      domain,
      question: question?.question || feedback.comment,
      expectedAnswer: "",
      sourceEvidence: question?.citations?.slice() || [],
      riskLevel: feedback.rating <= 1 ? "高" : "中",
      targetSuiteId: "EVALSET-CORE-2026-01",
      status: "待标注",
      owner: "标准规则组",
      createdAt: nowText(),
      updatedAt: nowText(),
    };
    feedback.status = "已转样本";
    state.assistantImprovementSamples.unshift(sample);
    addAudit("反馈转评价助手改进样本", sample.id, `${feedback.id} · ${domain}`);
    saveState();
    showNotice(`${feedback.id}已转为${sample.id}，等待专家标注。`);
    render();
  }

  function annotateImprovementSample(id) {
    const sample = state.assistantImprovementSamples.find((item) => item.id === id);
    if (!sample || sample.status !== "待标注") return;
    const template = answerTemplateForQuestion(`${sample.domain} ${sample.question}`);
    sample.expectedAnswer = template.answer;
    sample.sourceEvidence = Array.from(new Set([...sample.sourceEvidence, ...template.citations]));
    sample.status = "已标注";
    sample.owner = state.activeRole;
    sample.updatedAt = nowText();
    addAudit("专家标注评价助手改进样本", sample.id, `${sample.domain} · ${sample.sourceEvidence.length}项证据`);
    saveState();
    showNotice(`${sample.id}已完成标准答案和来源证据标注。`);
    render();
  }

  function includeImprovementSample(id) {
    const sample = state.assistantImprovementSamples.find((item) => item.id === id);
    if (!sample || sample.status !== "已标注") return;
    const suite = state.assistantEvaluationSuites.find((item) => item.id === sample.targetSuiteId);
    if (!suite || suite.status !== "已发布") {
      showNotice("目标评测集尚未发布，不能纳入正式回归。");
      return;
    }
    suite.caseCount += 1;
    suite.updatedAt = nowText();
    sample.status = "已入集";
    sample.updatedAt = nowText();
    const maxSequence = state.assistantReleaseCandidates.reduce((max, item) => {
      const sequence = Number(String(item.version).split(".").pop());
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, 13);
    const cycle = {
      id: `AIC-${Date.now()}`,
      name: `${sample.domain}线上反馈持续改进`,
      sourceFeedbackIds: [sample.feedbackId],
      sampleIds: [sample.id],
      targetSuiteId: suite.id,
      targetVersion: `ASSIST-2026.07.${String(maxSequence + 1).padStart(2, "0")}`,
      evaluationRunId: "",
      status: "待回归",
      owner: "评价助手治理组",
      startedAt: nowText(),
      completedAt: "",
    };
    state.assistantImprovementCycles.unshift(cycle);
    addAudit("改进样本纳入正式评测集", sample.id, `${suite.id} · 样本数${suite.caseCount}`);
    saveState();
    showNotice(`${sample.id}已纳入${suite.name}，并创建${cycle.id}。`);
    render();
  }

  function runImprovementRegression(id) {
    const cycle = state.assistantImprovementCycles.find((item) => item.id === id);
    if (!cycle || cycle.status !== "待回归") return;
    const suite = state.assistantEvaluationSuites.find((item) => item.id === cycle.targetSuiteId);
    const metrics = {
      citationCoverage: 100,
      answerAccuracy: 96,
      retrievalRecall: 94,
      safetyCompliance: 100,
      averageLatencyMs: 532,
      baselineDelta: 1.7,
    };
    const run = {
      id: `EVALRUN-${Date.now()}`,
      candidateVersion: cycle.targetVersion,
      suiteVersion: `${suite?.id || cycle.targetSuiteId}@${suite?.version || "v1"}`,
      knowledgeVersion: state.assistantKnowledgeVersions.find((item) => item.status === "已发布")?.version || "STD-2026-TRIAL",
      promptVersion: "QA-PROMPT-v2.3",
      ...metrics,
      score: Math.round((metrics.citationCoverage + metrics.answerAccuracy + metrics.retrievalRecall + metrics.safetyCompliance) / 4),
      gateStatus: assistantQualityGateStatus(metrics),
      status: "已完成",
      startedAt: nowText(),
      finishedAt: nowText(),
    };
    state.assistantEvaluationRuns.unshift(run);
    cycle.evaluationRunId = run.id;
    cycle.status = run.gateStatus === "通过" ? "已完成" : "待回归";
    cycle.completedAt = run.gateStatus === "通过" ? nowText() : "";
    state.assistantImprovementSamples
      .filter((item) => cycle.sampleIds.includes(item.id))
      .forEach((item) => {
        item.status = run.gateStatus === "通过" ? "已验证" : "已入集";
        item.updatedAt = nowText();
      });
    state.assistantFeedbackRecords
      .filter((item) => cycle.sourceFeedbackIds.includes(item.id))
      .forEach((item) => {
        if (run.gateStatus === "通过") item.status = "已关闭";
      });
    addAudit("运行评价助手改进回归", run.id, `${cycle.id} · ${run.gateStatus} · 得分${run.score}`);
    saveState();
    showNotice(`${cycle.name}回归${run.gateStatus}，${run.gateStatus === "通过" ? "反馈问题已关闭" : "仍需继续改进"}。`);
    render();
  }

  function answerTemplateForQuestion(question) {
    if (/H1|等保|安全/.test(question)) {
      return {
        scope: "H1 网络安全等级保护",
        answer: "等保材料应能证明评价任务截止日前处于有效状态；处于整改或复测阶段时，应补充备案、整改计划和复测安排，并由审核员确认。",
        citations: ["H1评价细则第3.2条", "证据材料目录EVD-H1-01"],
        confidence: 95,
      };
    }
    if (/D6|适老|无障碍/.test(question)) {
      return {
        scope: "D6 老年人和特殊人群适老化服务",
        answer: "应同时提供已上线的适老化功能证据、人工辅助流程和实际服务记录，仅有建设方案不能证明持续运行。",
        citations: ["D6指标证据要求", "证据材料目录EVD-D6-01至03"],
        confidence: 93,
      };
    }
    return {
      scope: "B3 院内系统集成和接口治理",
      answer: "失败重试应按同一业务请求标识去重，保留最终调用结果和原始失败记录；统计说明需明确请求标识、重试窗口和计划停机处理方式。",
      citations: ["B3指标口径第2.4条", "数据采集目录API-STAT-03"],
      confidence: 92,
    };
  }

  function askStandardQuestion() {
    const input = document.querySelector("[data-assistant-question]");
    const question = input?.value.trim() || "B3接口成功率统计时，失败重试应如何去重？";
    const template = answerTemplateForQuestion(question);
    const record = {
      id: `QA-${Date.now()}`,
      hospitalCode: state.selectedHospital,
      question,
      answer: template.answer,
      citations: template.citations,
      confidence: template.confidence,
      askedBy: state.activeRole,
      askedAt: nowText(),
      status: "已回答",
      scope: template.scope,
    };
    const trace = createRetrievalTrace(record);
    const call = recordAssistantModelCall({
      businessId: record.id,
      scene: "标准问答",
      modelRoute: "规则检索+摘要模型",
      promptVersion: "QA-PROMPT-v2.1",
      requestText: record.question,
      responseText: `${record.answer}|${record.citations.join("|")}`,
      risk: record.confidence < 93 ? "中" : "低",
    });
    record.retrievalTraceId = trace.id;
    record.modelCallId = call.id;
    state.standardQaRecords.unshift(record);
    addAudit("提交标准口径问题", record.id, `${record.confidence}%置信度 · 已关联检索与调用审计`);
    saveState();
    showNotice("已生成带引用来源的辅助回答，请人工确认。");
    render();
  }

  function confirmStandardAnswer(id) {
    const record = state.standardQaRecords.find((item) => item.id === id);
    if (!record || record.status === "已确认") return;
    record.status = "已确认";
    addAudit("人工确认标准问答", record.id, record.scope);
    saveState();
    showNotice(`${record.id}已由人工确认。`);
    render();
  }

  function generateAnomalyExplanations() {
    const issue = activeIssues()[0];
    const indicator = indicatorByCode(issue?.indicatorCode || "B5");
    const explanation = {
      id: `AEX-${Date.now()}`,
      sourceId: issue?.id || `ASSIST-${state.selectedHospital}-VOLATILITY`,
      hospitalCode: state.selectedHospital,
      indicatorCode: issue?.indicatorCode || "B5",
      title: issue?.description || "数据质量指标较历史基线存在波动",
      summary: issue ? `校验规则识别到：${issue.description}` : "当前数据质量结果与历史基线存在明显差异，需要核验统计口径和数据处理过程。",
      possibleCause: issue?.type === "材料" ? "材料未上传、关联指标错误或材料有效期不满足要求。" : "统计周期、字段口径、数据抽取范围或源系统处理逻辑发生变化。",
      impact: issue?.severity === "blocker" ? "属于阻断问题，未处理时影响正式提交。" : "作为人工核验线索，不自动改变评分。",
      recommendation: issue?.suggestion || `核验${indicator?.name || "相关指标"}的数据来源、统计周期和历史变化说明。`,
      status: "待确认",
      generatedAt: nowText(),
      editable: true,
    };
    state.anomalyExplanations.unshift(explanation);
    recordAssistantModelCall({
      businessId: explanation.id,
      scene: "异常解释",
      modelRoute: "规则解释模型",
      promptVersion: "AEX-PROMPT-v1.3",
      requestText: explanation.sourceId,
      responseText: `${explanation.summary}|${explanation.recommendation}`,
      risk: explanation.impact.includes("阻断") ? "高" : "中",
    });
    addAudit("生成异常可读说明", explanation.id, explanation.sourceId);
    saveState();
    showNotice("已根据当前校验问题生成异常说明。");
    render();
  }

  function editAnomalyExplanation(id) {
    const explanation = state.anomalyExplanations.find((item) => item.id === id);
    if (!explanation || explanation.status === "已采纳") return;
    explanation.recommendation = `${explanation.recommendation} 医院补充：已安排责任部门核对原始数据并提交说明。`;
    explanation.status = "已编辑";
    addAudit("编辑异常说明", explanation.id, "保留原始生成版本");
    saveState();
    showNotice(`${explanation.id}已补充医院说明。`);
    render();
  }

  function adoptAnomalyExplanation(id) {
    const explanation = state.anomalyExplanations.find((item) => item.id === id);
    if (!explanation || explanation.status === "已采纳") return;
    explanation.status = "已采纳";
    addAudit("采纳异常说明", explanation.id, explanation.indicatorCode);
    saveState();
    showNotice(`${explanation.id}已采纳并进入问题处理。`);
    render();
  }

  function generateRectificationSuggestion() {
    const explanation = state.anomalyExplanations.find(
      (item) => !state.rectificationSuggestions.some((suggestion) => suggestion.sourceId === item.id),
    ) || state.anomalyExplanations.find((item) => item.status !== "已采纳") || state.anomalyExplanations[0];
    const indicator = indicatorByCode(explanation.indicatorCode);
    const suggestion = {
      id: `RSG-${Date.now()}`,
      sourceId: explanation.id,
      hospitalCode: explanation.hospitalCode,
      indicatorCode: explanation.indicatorCode,
      problem: explanation.title,
      suggestion: `围绕${indicator?.name || explanation.indicatorCode}建立专项补正任务，核验原始数据、补充支撑材料并完成院内复核。`,
      steps: ["确认问题责任部门", "核验数据与材料来源", "完成补正并记录版本", "提交院内负责人复核"],
      priority: /阻断|缺失|安全/.test(`${explanation.impact}${explanation.title}`) ? "紧急" : "高",
      owner: indicator?.domain === "H" ? "网络安全办" : indicator?.domain === "D" ? "门诊部" : "信息中心",
      dueDays: 7,
      disclaimer: "智能建议仅供参考，采纳后仍需医院和审核人员确认。",
      status: "待采纳",
      createdAt: nowText(),
    };
    state.rectificationSuggestions.unshift(suggestion);
    recordAssistantModelCall({
      businessId: suggestion.id,
      scene: "整改建议",
      modelRoute: "整改知识模板模型",
      promptVersion: "RSG-PROMPT-v1.2",
      requestText: `${suggestion.sourceId}|${suggestion.problem}`,
      responseText: `${suggestion.suggestion}|${suggestion.steps.join("|")}`,
      risk: suggestion.priority === "紧急" ? "高" : "中",
    });
    addAudit("生成智能整改建议", suggestion.id, explanation.id);
    saveState();
    showNotice("已生成整改建议模板，请责任部门确认。");
    render();
  }

  function adoptRectificationSuggestion(id) {
    const suggestion = state.rectificationSuggestions.find((item) => item.id === id);
    if (!suggestion || suggestion.status === "已采纳") return;
    suggestion.status = "已采纳";
    const exists = state.rectifications.some((item) => item.sourceIssueId === suggestion.id);
    if (!exists) {
      const due = new Date(Date.now() + suggestion.dueDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      state.rectifications.push({
        id: `REC-${Date.now()}-${suggestion.indicatorCode}`,
        sourceIssueId: suggestion.id,
        hospitalCode: suggestion.hospitalCode,
        indicatorCode: suggestion.indicatorCode,
        problem: suggestion.problem,
        action: suggestion.suggestion,
        department: suggestion.owner,
        owner: "责任部门管理员",
        due,
        reviewer: "省级审核员",
        materials: 0,
        status: "未开始",
      });
    }
    addAudit("采纳智能整改建议", suggestion.id, "已生成正式整改任务");
    saveState();
    showNotice(`${suggestion.id}已采纳并转为整改任务。`);
    render();
  }

  function scanReviewRisks() {
    const hospital = activeHospital();
    const code = activeIssues()[0]?.indicatorCode || "B5";
    const signal = {
      id: `RSK-${Date.now()}`,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      indicatorCode: code,
      level: activeIssues().some((item) => item.severity === "blocker") ? "高" : "中",
      signal: "申报数据、证据材料与历史结果存在待核验差异",
      basis: "辅助扫描发现当前申报状态与材料完整性、历史波动或规则边界存在组合风险。",
      recommendation: "由审核员核验原始数据、材料版本和口径说明，必要时提交专家复核。",
      source: "多源风险辅助扫描",
      status: "待确认",
      owner: "省级审核组",
      createdAt: nowText(),
    };
    state.reviewRiskSignals.unshift(signal);
    recordAssistantModelCall({
      businessId: signal.id,
      scene: "审核风险",
      modelRoute: "规则风险引擎+辅助模型",
      promptVersion: "RSK-PROMPT-v1.1",
      requestText: `${signal.hospitalCode}|${signal.indicatorCode}|${signal.source}`,
      responseText: `${signal.signal}|${signal.recommendation}`,
      risk: signal.level,
    });
    addAudit("扫描审核风险线索", signal.id, `${signal.level}风险`);
    saveState();
    showNotice("已完成多源风险扫描，新增1条待确认线索。");
    render();
  }

  function confirmReviewRisk(id) {
    const risk = state.reviewRiskSignals.find((item) => item.id === id);
    if (!risk || risk.status !== "待确认") return;
    risk.status = "已确认";
    addAudit("确认审核风险线索", risk.id, risk.signal);
    saveState();
    showNotice(`${risk.id}已确认，等待后续处置。`);
    render();
  }

  function dismissReviewRisk(id) {
    const risk = state.reviewRiskSignals.find((item) => item.id === id);
    if (!risk || risk.status === "已排除" || risk.status === "已转复核") return;
    risk.status = "已排除";
    addAudit("排除审核风险线索", risk.id, "人工核验后排除");
    saveState();
    showNotice(`${risk.id}已由人工排除。`);
    render();
  }

  function reviewRiskToExpert(id) {
    const risk = state.reviewRiskSignals.find((item) => item.id === id);
    if (!risk || risk.status === "已排除" || risk.status === "已转复核") return;
    const previousHospital = state.selectedHospital;
    state.selectedHospital = risk.hospitalCode;
    const review = createExpertReview(risk.indicatorCode, risk.signal);
    state.selectedHospital = previousHospital;
    risk.status = "已转复核";
    risk.owner = review?.expertGroup || expertGroupForIndicator(indicatorByCode(risk.indicatorCode));
    addAudit("风险线索转专家复核", risk.id, risk.owner);
    saveState();
    showNotice(`${risk.id}已转专家复核。`);
    render();
  }

  function closeMonitoringAlerts(source) {
    state.monitoringAlerts
      .filter((item) => item.source === source && item.status !== "已关闭")
      .forEach((item) => {
        item.status = "已关闭";
        item.handledAt = nowText();
      });
  }

  function createMonitoringAlert(source, level, title, owner) {
    const exists = state.monitoringAlerts.some((item) => item.source === source && item.title === title && item.status !== "已关闭");
    if (exists) return;
    state.monitoringAlerts.unshift({
      id: `ALT-${Date.now()}-${state.monitoringAlerts.length + 1}`,
      source,
      level,
      title,
      status: "待确认",
      createdAt: nowText(),
      owner,
      handledAt: "",
    });
  }

  function runMonitoringCheck() {
    const checkedAt = nowText();
    state.serviceHealth.forEach((item) => {
      item.lastCheck = checkedAt;
      if (item.status !== "正常") createMonitoringAlert(item.id, item.status === "降级" ? "高" : "中", `${item.name}巡检发现${item.status}`, "平台技术组");
    });
    state.jobQueues.filter((item) => item.status !== "正常").forEach((item) => createMonitoringAlert(item.id, item.status === "拥堵" ? "高" : "中", `${item.name}存在${item.pending}项积压`, "运维值班组"));
    state.storagePools.filter((item) => item.status !== "正常").forEach((item) => createMonitoringAlert(item.id, item.status === "高风险" ? "紧急" : "高", `${item.name}使用率达到${item.usage}%`, "安全管理组"));
    addAudit("执行平台运营巡检", "核心服务、任务队列与存储", `${monitoringSummary().activeAlerts}项开放告警`);
    saveState();
    showNotice("运营巡检已完成，异常项已进入统一告警台账。");
    render();
  }

  function acknowledgeMonitoringAlert(id) {
    const alert = state.monitoringAlerts.find((item) => item.id === id);
    if (!alert || alert.status === "已关闭") return;
    alert.status = "已确认";
    alert.handledAt = nowText();
    addAudit("确认运营告警", alert.id, alert.title);
    saveState();
    showNotice(`${alert.id}已确认并纳入处置跟踪。`);
    render();
  }

  function recoverService(id) {
    const service = state.serviceHealth.find((item) => item.id === id);
    if (!service) return;
    service.status = "正常";
    service.availability = Math.max(service.availability, service.sla);
    service.latency = Math.min(service.latency, 180);
    service.lastCheck = nowText();
    closeMonitoringAlerts(service.id);
    addAudit("恢复平台服务", service.name, "服务恢复并关闭关联告警");
    saveState();
    showNotice(`${service.name}已恢复，关联告警已关闭。`);
    render();
  }

  function probeInterfaces() {
    const checkedAt = nowText();
    state.interfaceHealth.forEach((item) => {
      item.lastCheck = checkedAt;
      if (item.status !== "正常") createMonitoringAlert(item.id, item.status === "异常" ? "高" : "中", `${item.name}探测${item.status}`, "接口管理组");
    });
    addAudit("批量探测平台接口", `${state.interfaceHealth.length}个接口`, `${monitoringSummary().unhealthyInterfaces}项异常`);
    saveState();
    showNotice("接口探测已完成，异常结果已生成告警。");
    render();
  }

  function retryInterface(id) {
    const item = state.interfaceHealth.find((entry) => entry.id === id);
    if (!item) return;
    item.successRate = Math.max(99.8, item.successRate);
    item.p95 = Math.min(220, item.p95);
    item.status = "正常";
    item.lastError = "";
    item.lastCheck = nowText();
    closeMonitoringAlerts(item.id);
    addAudit("重试异常接口", item.name, "探测通过");
    saveState();
    showNotice(`${item.name}重试通过，接口状态已恢复。`);
    render();
  }

  function scaleQueue(id) {
    const queue = state.jobQueues.find((item) => item.id === id);
    if (!queue) return;
    queue.workers += 4;
    queue.capacity += 120;
    queue.status = queue.pending > queue.capacity ? "拥堵" : queue.pending > queue.capacity * 0.6 ? "预警" : "正常";
    if (queue.status === "正常") closeMonitoringAlerts(queue.id);
    addAudit("扩容异步任务队列", queue.name, `${queue.workers}个工作进程`);
    saveState();
    showNotice(`${queue.name}已扩容至${queue.workers}个工作进程。`);
    render();
  }

  function prioritizeQueue(id) {
    const queue = state.jobQueues.find((item) => item.id === id);
    if (!queue) return;
    queue.pending = Math.max(0, queue.pending - Math.max(12, Math.round(queue.capacity * 0.35)));
    queue.failed = Math.max(0, queue.failed - 1);
    queue.oldestWait = Math.max(1, Math.round(queue.oldestWait * 0.45));
    queue.status = queue.pending > queue.capacity ? "拥堵" : queue.pending > queue.capacity * 0.6 ? "预警" : "正常";
    if (queue.status === "正常") closeMonitoringAlerts(queue.id);
    addAudit("提升队列处理优先级", queue.name, `剩余${queue.pending}项`);
    saveState();
    showNotice(`${queue.name}已提速，当前积压${queue.pending}项。`);
    render();
  }

  function expandStorage(id) {
    const pool = state.storagePools.find((item) => item.id === id);
    if (!pool) return;
    pool.total = Number((pool.total + Math.max(2, Math.ceil(pool.total * 0.25))).toFixed(2));
    pool.usage = Math.round((pool.used / pool.total) * 100);
    pool.status = pool.usage >= 90 ? "高风险" : pool.usage >= 75 ? "预警" : "正常";
    if (pool.status === "正常") closeMonitoringAlerts(pool.id);
    addAudit("扩容平台存储", pool.name, `${pool.total}${pool.unit}`);
    saveState();
    showNotice(`${pool.name}已扩容至${pool.total}${pool.unit}。`);
    render();
  }

  function cleanStorage(id) {
    const pool = state.storagePools.find((item) => item.id === id);
    if (!pool) return;
    pool.used = Number(Math.max(0.1, pool.used - Math.max(0.2, pool.used * 0.12)).toFixed(2));
    pool.usage = Math.round((pool.used / pool.total) * 100);
    pool.growthDaily = Math.max(4, Math.round(pool.growthDaily * 0.8));
    pool.status = pool.usage >= 90 ? "高风险" : pool.usage >= 75 ? "预警" : "正常";
    if (pool.status === "正常") closeMonitoringAlerts(pool.id);
    addAudit("执行存储生命周期清理", pool.name, `使用率${pool.usage}%`);
    saveState();
    showNotice(`${pool.name}清理完成，使用率降至${pool.usage}%。`);
    render();
  }

  function addPublicHealthIncidentAction(incident, action, result) {
    const at = nowText();
    incident.lastUpdatedAt = at;
    incident.latestAction = result;
    state.publicHealth.incidentActions.unshift({
      id: `PHA-${Date.now()}`,
      incidentId: incident.id,
      action,
      actor: state.activeRole,
      at,
      result,
      revision: Number(incident.revision || 1),
    });
  }

  function addPublicHealthEvidenceAction(evidence, incident, action, result) {
    const at = nowText();
    state.publicHealth.evidenceActions.unshift({
      id: `PHEVA-${Date.now()}`,
      evidenceId: evidence.id,
      incidentId: incident.id,
      action,
      actor: state.activeRole,
      at,
      result,
      revision: Number(evidence.revision || 1),
      incidentRevision: Number(incident.revision || 1),
    });
    addPublicHealthIncidentAction(incident, action, result);
  }

  function createPublicHealthIncident() {
    const incident = {
      id: `PHE-${Date.now()}`,
      revision: 1,
      laneId: "health-education",
      title: "健康教育内容发布时效异常",
      level: "P1",
      source: "人工登记",
      hospitalCode: state.selectedHospital,
      owner: "宣传与健康促进协同组",
      status: "待核查",
      discoveredAt: nowText(),
      dueAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toLocaleString("zh-CN", { hour12: false }),
      lastUpdatedAt: nowText(),
      latestAction: "已登记，等待责任组核查",
      submittedForReviewBy: "",
      evidenceIds: [],
    };
    state.publicHealth.incidents.unshift(incident);
    addPublicHealthIncidentAction(incident, "登记事件", "已登记，等待责任组核查");
    addAudit("登记公共卫生异常事件", incident.id, `${incident.level} · ${incident.owner}`);
    saveState();
    showNotice("公共卫生异常事件已登记并进入核查队列。");
    render();
  }

  function advancePublicHealthIncident(id) {
    const incident = state.publicHealth.incidents.find((item) => item.id === id);
    if (!incident || incident.status === "已关闭") return;
    const transitions = {
      待核查: { status: "处置中", action: "开始处置", result: "核查确认异常，责任组已开始处置" },
      处置中: { status: "待复核", action: "提交复核", result: "处置措施已完成，等待独立业务复核" },
      待复核: { status: "已关闭", action: "复核关闭", result: "独立复核通过，事件闭环" },
    };
    const next = transitions[incident.status];
    if (!next) return;
    if (incident.status === "待复核" && incident.submittedForReviewBy === state.activeRole) {
      showNotice("提交处置结果的角色不能复核自己的事件，请切换独立复核角色。");
      return;
    }
    if (incident.status === "待复核") {
      const closureGate = publicHealthClosureGate(incident);
      if (!closureGate.ready) {
        showNotice(`关闭证据未齐：还需${closureGate.missingTypes.map((type) => publicHealthEvidenceLabels[type]).join("、")}。`);
        return;
      }
    }
    incident.revision = Number(incident.revision || 1) + 1;
    incident.status = next.status;
    if (next.status === "待复核") incident.submittedForReviewBy = state.activeRole;
    if (next.status === "已关闭") {
      incident.closedAt = nowText();
      incident.verifiedBy = state.activeRole;
    }
    addPublicHealthIncidentAction(incident, next.action, next.result);
    addAudit(next.action, incident.id, `${next.result} · r${incident.revision}`);
    saveState();
    showNotice(`${incident.id}已更新为：${incident.status}（r${incident.revision}）`);
    render();
  }

  function recordPublicHealthEvidence(id) {
    const incident = state.publicHealth.incidents.find((item) => item.id === id);
    if (!incident || incident.status === "已关闭") return;
    const gate = publicHealthClosureGate(incident);
    const evidenceType = gate.missingTypes[0];
    if (!evidenceType) {
      showNotice("该事件的关闭前置证据已经齐备。");
      return;
    }
    const activeDuplicate = state.publicHealth.incidentEvidence.find((item) =>
      item.incidentId === incident.id &&
      item.evidenceType === evidenceType &&
      ["submitted", "accepted"].includes(item.status)
    );
    if (activeDuplicate) {
      showNotice(`${publicHealthEvidenceLabels[evidenceType]}已经登记，需由其他角色独立签收。`);
      workspace.dataset.publicHealthTab = "evidence";
      renderPublicHealth();
      return;
    }
    const evidence = {
      id: `PHEV-${Date.now()}`,
      revision: 1,
      incidentId: incident.id,
      hospitalCode: incident.hospitalCode,
      evidenceType,
      referenceNo: `${evidenceType.toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${String(Date.now()).slice(-4)}`,
      summary: `${publicHealthEvidenceLabels[evidenceType]}受控样例摘要，原始附件留在现场证据库。`,
      digest: `sha256:${String(Date.now()).padEnd(64, "0").slice(0, 64)}`,
      status: "submitted",
      submittedBy: state.activeRole,
      submittedAt: nowText(),
      reviewedBy: "",
      reviewedAt: "",
      reviewNote: "",
      productionEvidence: false,
    };
    incident.revision = Number(incident.revision || 1) + 1;
    incident.evidenceIds = [...new Set([...(incident.evidenceIds || []), evidence.id])];
    state.publicHealth.incidentEvidence.unshift(evidence);
    addPublicHealthEvidenceAction(
      evidence,
      incident,
      "登记现场证据",
      `${publicHealthEvidenceLabels[evidenceType]}已登记，等待独立签收`,
    );
    addAudit("登记公共卫生关闭证据", evidence.id, `${incident.id} · ${evidence.evidenceType} · productionEvidence=false`);
    saveState();
    workspace.dataset.publicHealthTab = "evidence";
    showNotice(`${publicHealthEvidenceLabels[evidenceType]}已登记，请切换其他角色完成独立签收。`);
    renderPublicHealth();
  }

  function reviewPublicHealthEvidence(id, decision) {
    const evidence = state.publicHealth.incidentEvidence.find((item) => item.id === id);
    if (!evidence || evidence.status !== "submitted") return;
    const incident = state.publicHealth.incidents.find((item) => item.id === evidence.incidentId);
    if (!incident || incident.status === "已关闭") return;
    if (evidence.submittedBy === state.activeRole) {
      showNotice("证据提交人不能签收或驳回自己的证据，请切换独立复核角色。");
      return;
    }
    const accepted = decision === "accept";
    evidence.revision = Number(evidence.revision || 1) + 1;
    evidence.status = accepted ? "accepted" : "rejected";
    evidence.reviewedBy = state.activeRole;
    evidence.reviewedAt = nowText();
    evidence.reviewNote = accepted ? "证据编号、摘要和事件范围核验通过" : "证据摘要与事件范围不一致，退回补正";
    evidence.productionEvidence = false;
    incident.revision = Number(incident.revision || 1) + 1;
    addPublicHealthEvidenceAction(
      evidence,
      incident,
      accepted ? "独立签收证据" : "驳回证据",
      evidence.reviewNote,
    );
    addAudit(
      accepted ? "独立签收公共卫生证据" : "驳回公共卫生证据",
      evidence.id,
      `${incident.id} · ${evidence.evidenceType} · productionEvidence=false`,
    );
    saveState();
    showNotice(`${evidence.referenceNo}已${accepted ? "签收" : "驳回"}，事件修订号更新为r${incident.revision}。`);
    renderPublicHealth();
  }

  function escalatePublicHealthIncident(id) {
    const incident = state.publicHealth.incidents.find((item) => item.id === id);
    if (!incident || incident.status === "已关闭") return;
    const sla = publicHealthIncidentSla(incident);
    if (!sla.overdue) {
      showNotice("该事件尚未超过SLA时限，不能执行超时升级。");
      return;
    }
    if (incident.escalation?.escalatedAt) {
      showNotice("该事件已经完成超时升级，不重复发送。");
      return;
    }
    const routes = {
      P0: { level: "red", route: "卫健委值班负责人 -> 疾控业务负责人 -> 项目总指挥" },
      P1: { level: "amber", route: "业务处室负责人 -> 平台运营负责人" },
      P2: { level: "yellow", route: "责任组负责人 -> 平台运营值班" },
    };
    const escalation = routes[incident.level] || routes.P2;
    incident.revision = Number(incident.revision || 1) + 1;
    incident.escalation = {
      status: "已升级",
      level: escalation.level,
      route: escalation.route,
      escalatedAt: nowText(),
      escalatedBy: state.activeRole,
      note: `${incident.level}事件超过SLA，已按预案升级`,
    };
    addPublicHealthIncidentAction(incident, "SLA超时升级", incident.escalation.note);
    addAudit("公共卫生事件SLA超时升级", incident.id, `${incident.escalation.level} · ${incident.escalation.route}`);
    saveState();
    showNotice(`${incident.id}已按${incident.level}路径升级，原处置状态保持${incident.status}。`);
    render();
  }

  function resetPublicHealthFilters() {
    delete workspace.dataset.publicHealthHospital;
    delete workspace.dataset.publicHealthStatus;
    delete workspace.dataset.publicHealthLevel;
    delete workspace.dataset.publicHealthSla;
    renderPublicHealth();
  }

  function simulatePublicHealthBreak() {
    const publicHealth = state.publicHealth;
    const latest = publicHealth.campaigns.at(-1);
    if (!latest) return;
    latest.status = "验签失败";
    publicHealth.consecutiveCampaigns = 0;
    publicHealth.continuousConnectivityReady = false;
    publicHealth.productionReady = false;
    publicHealth.continuityBreak = {
      campaignId: latest.id,
      code: "ENDPOINT_PROBE_CAMPAIGN_VERIFICATION_FAILED",
    };
    addAudit("演示公共卫生连续性失败关闭", latest.id, "连续计数归零，生产状态保持未授权");
    saveState();
    showNotice("最新活动已模拟为验签失败；连续计数归零，生产状态保持未授权。");
    render();
  }

  function restorePublicHealthContinuity() {
    const publicHealth = state.publicHealth;
    publicHealth.campaigns.forEach((campaign, index) => {
      campaign.status = "已验证";
      campaign.chain = index === 0 ? "genesis" : "verified";
    });
    publicHealth.consecutiveCampaigns = publicHealth.requiredConsecutiveCampaigns;
    publicHealth.campaignChainLinksVerified = Math.max(0, publicHealth.requiredConsecutiveCampaigns - 1);
    publicHealth.continuousConnectivityReady = true;
    publicHealth.productionReady = false;
    publicHealth.continuityBreak = null;
    addAudit("恢复公共卫生受控连续窗口", "八通道活动", "连续验证恢复，生产状态保持未授权");
    saveState();
    showNotice("受控连续窗口已恢复；现场证据和上线审批仍然阻断生产状态。");
    render();
  }

  function simulatePublicHealthChainBreak() {
    const publicHealth = state.publicHealth;
    const latest = publicHealth.campaigns.at(-1);
    if (!latest) return;
    latest.chain = "mismatch";
    publicHealth.campaignChainLinksVerified = 0;
    publicHealth.consecutiveCampaigns = 1;
    publicHealth.continuousConnectivityReady = false;
    publicHealth.productionReady = false;
    publicHealth.continuityBreak = {
      campaignId: latest.id,
      code: "campaign-chain-link-mismatch",
    };
    addAudit("演示公共卫生签名前序链失败关闭", latest.id, "中间活动缺失，连续状态保持阻断");
    saveState();
    showNotice("已模拟前序链缺口；摘要不匹配，系统拒绝跨缺口拼接连续活动。");
    render();
  }

  function generateSpotCheck() {
    const anomaly = state.peerAnomalies.find((item) => item.status === "待核验" && !state.spotChecks.some((check) => check.hospitalCode === item.hospitalCode && check.status !== "已完成"));
    const hospital = anomaly ? state.hospitals.find((item) => item.code === anomaly.hospitalCode) : activeHospital();
    const id = `SC-2026-${String(state.spotChecks.length + 1).padStart(3, "0")}`;
    state.spotChecks.unshift({
      id,
      batch: "2026智能风险专项抽查",
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      source: anomaly ? "异常线索入池" : "分层随机抽样",
      reason: anomaly?.reason || "按医院等级与类别执行分层随机抽样",
      sampleRate: anomaly?.level === "高" ? "30%" : "15%",
      reviewer: "未分派",
      status: "待分派",
      due: "2026-11-30",
      findings: 0,
    });
    if (anomaly) anomaly.status = "已转抽查";
    addAudit("生成国家抽查批次", hospital.name, id);
    saveState();
    showNotice(`已生成国家抽查任务 ${id}。`);
    render();
  }

  function assignSpotCheck() {
    const item = state.spotChecks.find((entry) => entry.reviewer === "未分派" || entry.status === "待分派");
    if (!item) {
      showNotice("暂无待分派的国家抽查任务。");
      return;
    }
    item.reviewer = `国家抽查组${state.spotChecks.indexOf(item) % 2 ? "B" : "A"}`;
    item.status = "待复核";
    addAudit("分派国家抽查任务", item.id, item.reviewer);
    saveState();
    showNotice(`${item.id}已分派至${item.reviewer}。`);
    render();
  }

  function completeSpotCheck() {
    const item = state.spotChecks.find((entry) => entry.status === "待复核" || entry.status === "复核中");
    if (!item) {
      showNotice("暂无可完成的国家抽查任务。");
      return;
    }
    item.status = "已完成";
    item.findings = item.reason.includes("安全") || item.reason.includes("异常") ? 1 : 0;
    addAudit("完成国家抽查复核", item.id, `发现${item.findings}项问题`);
    saveState();
    showNotice(`${item.id}已完成复核，发现${item.findings}项问题。`);
    render();
  }

  function runSandbox() {
    const config = state.sandboxConfig;
    const strictness = Math.max(0, Number(config.successRateThreshold) - 95) + Number(config.evidenceMinimum) * 2 + Number(config.anomalyMultiplier);
    const affected = Math.min(126, Math.max(4, Math.round(strictness * 3.2)));
    state.sandboxRuns.unshift({
      id: `SB-${Date.now()}`,
      ruleName: "评分与异常阈值组合方案",
      version: `候选v${state.sandboxRuns.length + 2}`,
      population: 126,
      affected,
      avgDelta: Number((-strictness / 2.1).toFixed(1)),
      gradeChanges: Math.max(1, Math.round(affected / 7)),
      bottomLineHits: Number(config.evidenceMinimum > 2),
      status: "待审批",
      runAt: nowText(),
      approvedBy: "",
    });
    addAudit("运行规则沙箱", "候选规则组合", `影响${affected}家医院`);
    saveState();
    showNotice(`规则试算完成，${affected}家样本医院受到影响。`);
    render();
  }

  function approveSandbox() {
    const item = state.sandboxRuns.find((entry) => entry.status === "待审批");
    if (!item) {
      showNotice("暂无待审批的规则试算方案。");
      return;
    }
    item.status = "已发布";
    item.approvedBy = state.activeRole;
    state.scoringRules.unshift({
      id: `SR-SANDBOX-${Date.now()}`,
      name: item.ruleName,
      type: "沙箱发布",
      status: "启用",
      owner: "标准规则组",
      description: `${item.version}经脱敏样本试算和人工审批后发布。`,
    });
    addAudit("审批规则沙箱方案", item.id, "已发布");
    saveState();
    showNotice(`${item.version}已审批发布并同步至评分规则。`);
    render();
  }

  function classifyMaterials() {
    const domainCategories = {
      A: "基础设施与平台材料",
      B: "数据治理与共享材料",
      C: "智慧医疗证明",
      D: "智慧服务统计",
      E: "运营管理材料",
      F: "质量安全闭环材料",
      G: "创新应用材料",
      H: "安全合规证明",
    };
    evidenceForActive().forEach((material, index) => {
      const indicator = indicatorByCode(material.indicatorCode);
      const existing = state.materialClassifications.find((item) => item.materialId === material.id);
      const next = {
        id: existing?.id || `MC-${material.id}`,
        materialId: material.id,
        materialName: material.name,
        suggestedIndicator: material.indicatorCode,
        category: domainCategories[indicator?.domain] || "其他评价材料",
        confidence: Math.max(82, 98 - index * 3),
        risk: material.sensitivity === "S4" ? "高" : material.status === "缺少说明" ? "中" : "低",
        status: existing?.status === "已确认" ? "已确认" : "待确认",
      };
      if (existing) Object.assign(existing, next);
      else state.materialClassifications.unshift(next);
    });
    addAudit("运行材料智能辅助分类", state.selectedHospital, `${evidenceForActive().length}份材料`);
    saveState();
    showNotice("材料辅助分类已完成，请人工确认建议结果。");
    render();
  }

  function confirmClassification(id) {
    const item = state.materialClassifications.find((entry) => entry.id === id);
    if (!item) return;
    item.status = "已确认";
    addAudit("确认材料分类", item.materialName, item.suggestedIndicator);
    saveState();
    showNotice(`${item.materialName}的分类建议已确认。`);
    render();
  }

  function scanAnomalies() {
    const hospital = activeHospital();
    const score = scoreSnapshot();
    const existing = state.peerAnomalies.find((item) => item.hospitalCode === hospital.code && item.metric === "综合评价得分");
    const item = {
      id: existing?.id || `AN-${Date.now()}`,
      hospitalCode: hospital.code,
      hospitalName: hospital.name,
      metric: "综合评价得分",
      value: `${score.total}分`,
      peerMedian: hospital.level === "三级" ? "742分" : "668分",
      deviation: `${score.total >= 742 ? "+" : ""}${score.total - (hospital.level === "三级" ? 742 : 668)}分`,
      level: Math.abs(score.total - (hospital.level === "三级" ? 742 : 668)) >= 80 ? "高" : "中",
      reason: "综合得分偏离同级同类医院中位数，建议核验高贡献指标及材料一致性",
      status: existing?.status === "已转抽查" ? "已转抽查" : "待核验",
    };
    if (existing) Object.assign(existing, item);
    else state.peerAnomalies.unshift(item);
    addAudit("运行同类医院异常识别", hospital.name, item.level);
    saveState();
    showNotice(`异常识别完成，当前医院形成1条${item.level}风险线索。`);
    render();
  }

  function anomalyToSpotCheck(id) {
    const anomaly = state.peerAnomalies.find((entry) => entry.id === id);
    if (!anomaly || anomaly.status === "已转抽查") return;
    const hospital = state.hospitals.find((entry) => entry.code === anomaly.hospitalCode);
    state.spotChecks.unshift({
      id: `SC-2026-${String(state.spotChecks.length + 1).padStart(3, "0")}`,
      batch: "2026同类医院异常专项抽查",
      hospitalCode: anomaly.hospitalCode,
      hospitalName: anomaly.hospitalName,
      source: "异常线索入池",
      reason: `${anomaly.metric}：${anomaly.reason}`,
      sampleRate: anomaly.level === "高" ? "30%" : "20%",
      reviewer: "未分派",
      status: "待分派",
      due: "2026-11-30",
      findings: 0,
    });
    anomaly.status = "已转抽查";
    addAudit("异常线索转国家抽查", hospital?.name || anomaly.hospitalName, anomaly.metric);
    saveState();
    showNotice("异常线索已转为国家抽查任务。");
    render();
  }

  function sendMobileReminder() {
    const hospital = activeHospital();
    state.notifications.unshift({
      id: `MSG-${Date.now()}`,
      title: `${state.task.name}待办提醒`,
      recipient: hospital.name,
      role: "医院管理员",
      channel: "移动端",
      priority: "高",
      status: state.notificationChannels.find((item) => item.channel === "移动端")?.enabled ? "已送达" : "渠道停用",
      createdAt: nowText(),
      read: false,
    });
    addAudit("发送移动端提醒", hospital.name, "已进入消息队列");
    saveState();
    showNotice(`已向${hospital.name}发送移动端待办提醒。`);
    render();
  }

  function readAllMessages() {
    state.notifications.forEach((item) => {
      item.read = true;
      if (item.status === "已送达") item.status = "已读";
    });
    addAudit("批量标记消息已读", "消息中心", `${state.notifications.length}条`);
    saveState();
    showNotice("全部消息已标记为已读。");
    render();
  }

  function toggleChannel(channel) {
    const item = state.notificationChannels.find((entry) => entry.channel === channel);
    if (!item) return;
    item.enabled = !item.enabled;
    addAudit("调整提醒渠道", channel, item.enabled ? "启用" : "停用");
    saveState();
    showNotice(`${channel}渠道已${item.enabled ? "启用" : "停用"}。`);
    render();
  }

  function simulateImport() {
    const rejected = state.importJobs.length % 2 ? 0 : 6;
    state.importJobs.unshift({
      id: `IMP-${Date.now()}`,
      fileName: `数据质量统计_${nowText().slice(0, 10).replaceAll("-", "")}.xlsx`,
      template: "数据质量统计模板v1.1",
      rows: 520,
      accepted: 520 - rejected,
      rejected,
      status: rejected ? "部分成功" : "已入库",
      submittedBy: state.activeRole,
      submittedAt: nowText(),
      report: rejected ? "6行指标代码或数值范围不符合要求" : "校验通过",
    });
    addAudit("批量导入统计数据", state.selectedHospital, rejected ? `${rejected}行待补正` : "全部入库");
    saveState();
    showNotice(rejected ? `导入完成，${rejected}行数据待补正。` : "导入完成，全部数据已入库。");
    render();
  }

  function rerunImport(id) {
    const item = state.importJobs.find((entry) => entry.id === id);
    if (!item) return;
    item.accepted = item.rows;
    item.rejected = 0;
    item.status = "已入库";
    item.report = "补正后校验通过";
    addAudit("补正重跑导入任务", item.id, "全部入库");
    saveState();
    showNotice(`${item.id}补正重跑完成，全部数据已入库。`);
    render();
  }

  function advanceOperationStage() {
    const operations = state.operations;
    const index = operations.stages.findIndex((stage) => stage.id === operations.cycle.currentStage);
    if (index < 0) return;
    operations.stages[index].status = "已完成";
    if (index < operations.stages.length - 1) {
      const nextStage = operations.stages[index + 1];
      nextStage.status = "进行中";
      operations.cycle.currentStage = nextStage.id;
      state.task.status = nextStage.name;
      addOperationLog("推进年度运行阶段", `已从${operations.stages[index].name}推进到${nextStage.name}。`);
      showNotice(`运行阶段已推进到：${nextStage.name}`);
    } else {
      operations.cycle.archiveStatus = "预归档";
      addOperationLog("推进年度运行阶段", "全部阶段已完成，进入年度预归档。");
      showNotice("全部阶段已完成，进入年度预归档。");
    }
    saveState();
    render();
  }

  function publishStandardVersion() {
    const operations = state.operations;
    const activeVersion = operations.standardVersions[0];
    activeVersion.status = "已发布";
    operations.cycle.publishedAt = nowText();
    const standardStage = operations.stages.find((stage) => stage.id === "standard");
    if (standardStage) standardStage.status = "已完成";
    addOperationLog("发布标准版本", `${activeVersion.id} ${activeVersion.name}已发布，规则变更${activeVersion.changeCount}项。`, "标准管理组");
    saveState();
    showNotice("当前标准版本已发布。");
    render();
  }

  function runRuleAudit() {
    const submission = submissionForActive();
    const now = nowText();
    const missingRate = state.metrics.dataTotal > 0 ? state.metrics.missingRecords / state.metrics.dataTotal : 0;
    const openIssues = activeIssues();
    state.operations.ruleSets.forEach((rule) => {
      if (!rule.enabled) {
        rule.violations = 0;
        rule.lastRun = now;
        return;
      }
      if (rule.id === "RULE-DATA") {
        rule.violations = Number(missingRate > 0.01) + Number(state.metrics.invalidCodeRecords > 100) + Number(state.metrics.duplicateRecords > 100);
      }
      if (rule.id === "RULE-EVIDENCE") {
        rule.violations = indicators.filter((indicator) => {
          const entry = submission[indicator.code];
          return Number(entry?.selfScore || 0) >= indicator.max * 0.6 && Number(entry?.evidenceCount || 0) < 1;
        }).length;
      }
      if (rule.id === "RULE-SCORE") {
        rule.violations = indicators.filter((indicator) => Number(submission[indicator.code]?.selfScore || 0) > indicator.max).length + Number(state.confirmed && openIssues.length > 0);
      }
      if (rule.id === "RULE-SECURITY") {
        rule.violations = state.operations.securityItems.filter((item) => item.status !== "已通过").length;
      }
      rule.lastRun = now;
    });
    const total = state.operations.ruleSets.reduce((sum, rule) => sum + Number(rule.violations || 0), 0);
    addOperationLog("运行规则核验", `已运行${state.operations.ruleSets.filter((rule) => rule.enabled).length}组规则，发现${total}项异常。`, "规则引擎");
    saveState();
    showNotice(`规则核验完成，发现${total}项异常。`);
    render();
  }

  function toggleRule(ruleId) {
    const rule = state.operations.ruleSets.find((item) => item.id === ruleId);
    if (!rule) return;
    rule.enabled = !rule.enabled;
    if (!rule.enabled) rule.violations = 0;
    addOperationLog(rule.enabled ? "启用规则组" : "停用规则组", `${rule.name}已${rule.enabled ? "启用" : "停用"}。`, rule.owner);
    saveState();
    showNotice(`${rule.name}已${rule.enabled ? "启用" : "停用"}。`);
    render();
  }

  function passSecurityItem(itemId) {
    const item = state.operations.securityItems.find((entry) => entry.id === itemId);
    if (!item) return;
    item.status = "已通过";
    item.lastCheck = nowText();
    item.risk = "低";
    addOperationLog("安全复核通过", `${item.name}已标记通过。`, item.owner);
    saveState();
    showNotice(`${item.name}已通过。`);
    render();
  }

  function runSecurityCheck() {
    const now = nowText();
    state.operations.securityItems.forEach((item) => {
      item.lastCheck = now;
      if (item.status !== "已通过") item.status = "需补证";
    });
    state.operations.cycle.securityCheckedAt = now;
    addOperationLog("执行安全复核", "已更新全部安全检查项，未通过项标记为需补证。", "安全管理组");
    saveState();
    showNotice("安全复核已执行，未通过项已标记为需补证。");
    render();
  }

  function archiveCycle() {
    const summary = operationSummary();
    const openIssues = activeIssues().length;
    const pendingSecurity = summary.securityPending;
    const allStagesDone = summary.completedStages === state.operations.stages.length;
    state.operations.cycle.archiveStatus = allStagesDone && !openIssues && !pendingSecurity ? "已归档" : "预归档";
    addOperationLog("生成归档状态", `当前状态：${state.operations.cycle.archiveStatus}；开放问题${openIssues}项，安全待复核${pendingSecurity}项。`, "国家级平台");
    saveState();
    showNotice(`归档状态已更新为：${state.operations.cycle.archiveStatus}`);
    render();
  }

  document.addEventListener("click", (event) => {
    const nav = event.target.closest(".nav-item");
    if (nav) {
      setView(nav.dataset.view);
      return;
    }
    const intelligenceTab = event.target.closest("button[data-intelligence-tab]");
    if (intelligenceTab) {
      workspace.dataset.intelligenceTab = intelligenceTab.dataset.intelligenceTab;
      renderIntelligence();
      return;
    }
    const pilotTab = event.target.closest("button[data-pilot-tab]");
    if (pilotTab) {
      workspace.dataset.pilotTab = pilotTab.dataset.pilotTab;
      renderPilot();
      return;
    }
    const collaborationTab = event.target.closest("button[data-collaboration-tab]");
    if (collaborationTab) {
      workspace.dataset.collaborationTab = collaborationTab.dataset.collaborationTab;
      renderCollaboration();
      return;
    }
    const integrationTab = event.target.closest("button[data-integration-tab]");
    if (integrationTab) {
      workspace.dataset.integrationTab = integrationTab.dataset.integrationTab;
      renderIntegration();
      return;
    }
    const executionTab = event.target.closest("button[data-execution-tab]");
    if (executionTab) {
      workspace.dataset.executionTab = executionTab.dataset.executionTab;
      renderExecution();
      return;
    }
    const assessmentTab = event.target.closest("button[data-assessment-tab]");
    if (assessmentTab) {
      workspace.dataset.assessmentTab = assessmentTab.dataset.assessmentTab;
      renderAssessment();
      return;
    }
    const assistantTab = event.target.closest("button[data-assistant-tab]");
    if (assistantTab) {
      workspace.dataset.assistantTab = assistantTab.dataset.assistantTab;
      renderAssistant();
      return;
    }
    const monitoringTab = event.target.closest("button[data-monitoring-tab]");
    if (monitoringTab) {
      workspace.dataset.monitoringTab = monitoringTab.dataset.monitoringTab;
      renderMonitoring();
      return;
    }
    const publicHealthTab = event.target.closest("button[data-public-health-tab]");
    if (publicHealthTab) {
      workspace.dataset.publicHealthTab = publicHealthTab.dataset.publicHealthTab;
      renderPublicHealth();
      return;
    }
    const action = event.target.closest("[data-action]");
    if (!action) return;
    const name = action.dataset.action;
    if (name === "create-task") createTask();
    if (name === "send-reminder") sendReminder();
    if (name === "approve-extension") approveExtension();
    if (name === "add-evidence") addEvidence();
    if (name === "verify-evidence") verifyEvidence(action.dataset.id);
    if (name === "version-evidence") versionEvidence(action.dataset.id);
    if (name === "approve-export") approveExport();
    if (name === "assign-review") assignReview();
    if (name === "national-spot-check") nationalSpotCheck();
    if (name === "create-appeal") createAppeal();
    if (name === "resolve-appeal") resolveAppeal();
    if (name === "submit-rectification-material") submitRectificationMaterial(action.dataset.id);
    if (name === "remind-rectification") remindRectification();
    if (name === "toggle-score-rule") toggleScoreRule(action.dataset.id);
    if (name === "approve-rule") approveRule();
    if (name === "toggle-bottom-line") toggleBottomLine(action.dataset.id);
    if (name === "export-analytics") exportAnalytics();
    if (name === "toggle-user-status") toggleUserStatus();
    if (name === "create-pilot-batch") createPilotBatch();
    if (name === "publish-pilot-batch") publishPilotBatch();
    if (name === "enqueue-upload") enqueueUpload();
    if (name === "advance-upload") advanceUpload();
    if (name === "retry-upload") retryUpload();
    if (name === "balance-workload") balanceWorkload();
    if (name === "assign-urgent-review") assignUrgentReview();
    if (name === "generate-daily-report") generateDailyReport();
    if (name === "publish-daily-report") publishDailyReport();
    if (name === "refresh-readiness") refreshReadiness();
    if (name === "resolve-readiness-blocker") resolveReadinessBlocker(action.dataset.id);
    if (name === "advance-access-application") advancePilotAccessApplication(action.dataset.id);
    if (name === "probe-pilot-connector") probePilotConnector(action.dataset.id);
    if (name === "rotate-pilot-credential") rotatePilotCredential(action.dataset.id);
    if (name === "run-contract-certification") runContractCertification(action.dataset.id);
    if (name === "run-sample-validation") runSampleValidation(action.dataset.id);
    if (name === "resolve-integration-issue") resolveIntegrationIssue(action.dataset.id);
    if (name === "evaluate-integration-gate") evaluateIntegrationGate(action.dataset.id);
    if (name === "approve-integration-gate") approveIntegrationGate(action.dataset.id);
    if (name === "verify-execution-environment") verifyExecutionEnvironment(action.dataset.id);
    if (name === "rotate-vault-reference") rotateVaultReference(action.dataset.id);
    if (name === "enqueue-execution-job") enqueueExecutionJob();
    if (name === "dispatch-execution-job") dispatchExecutionJob(action.dataset.id);
    if (name === "heartbeat-execution-job") heartbeatExecutionJob(action.dataset.id);
    if (name === "fail-execution-job") failExecutionJob(action.dataset.id);
    if (name === "activate-execution-retry") activateExecutionRetry(action.dataset.id);
    if (name === "recover-execution-leases") recoverExecutionLeases();
    if (name === "restore-execution-worker") restoreExecutionWorker(action.dataset.id);
    if (name === "redrive-execution-dead-letter") redriveExecutionDeadLetter(action.dataset.id);
    if (name === "advance-execution-job") advanceExecutionJob(action.dataset.id);
    if (name === "verify-callback-receipt") verifyCallbackReceipt(action.dataset.id);
    if (name === "simulate-replay-callback") simulateReplayCallback();
    if (name === "resolve-replay-event") resolveReplayEvent(action.dataset.id);
    if (name === "release-execution-quarantine") releaseExecutionQuarantine(action.dataset.id);
    if (name === "create-cutover-window") createCutoverWindow();
    if (name === "evaluate-cutover-window") evaluateCutoverWindow(action.dataset.id);
    if (name === "start-cutover-window") startCutoverWindow(action.dataset.id);
    if (name === "complete-cutover-window") completeCutoverWindow(action.dataset.id);
    if (name === "rollback-cutover-window") rollbackCutoverWindow(action.dataset.id);
    if (name === "configure-production-runtime") configureProductionRuntime(action.dataset.id);
    if (name === "record-cutover-evidence") recordCutoverEvidence(action.dataset.id);
    if (name === "verify-cutover-evidence") verifyCutoverEvidence(action.dataset.id);
    if (name === "approve-production-cutover") approveProductionCutover(action.dataset.id);
    if (name === "evaluate-production-go-no-go") evaluateProductionGoNoGo();
    if (name === "create-pilot-ticket") createPilotTicket();
    if (name === "assign-pilot-tickets") assignPilotTickets();
    if (name === "advance-pilot-ticket") advancePilotTicket(action.dataset.id);
    if (name === "escalate-pilot-ticket") escalatePilotTicket(action.dataset.id);
    if (name === "create-training-session") createTrainingSession();
    if (name === "publish-training-session") publishTrainingSession();
    if (name === "record-training-attendance") recordTrainingAttendance(action.dataset.id);
    if (name === "complete-training-session") completeTrainingSession(action.dataset.id);
    if (name === "create-pilot-release") createPilotRelease();
    if (name === "publish-pilot-release") publishPilotRelease();
    if (name === "collect-pilot-feedback") collectPilotFeedback();
    if (name === "resolve-pilot-feedback") resolvePilotFeedback(action.dataset.id);
    if (name === "recalculate-pilot-outcomes") recalculatePilotOutcomes();
    if (name === "generate-issue-review") generateIssueReview();
    if (name === "close-issue-theme") closeIssueTheme(action.dataset.id);
    if (name === "create-improvement-plan") createImprovementPlan();
    if (name === "advance-improvement-plan") advanceImprovementPlan(action.dataset.id);
    if (name === "assess-rollout-readiness") assessRolloutReadiness();
    if (name === "advance-rollout-region") advanceRolloutRegion(action.dataset.id);
    if (name === "launch-rollout-region") launchRolloutRegion(action.dataset.id);
    if (name === "generate-assessment-report") generateAssessmentReport();
    if (name === "publish-assessment-report") publishAssessmentReport();
    if (name === "sync-assistant-knowledge") syncAssistantKnowledge();
    if (name === "create-knowledge-version") createKnowledgeVersion();
    if (name === "advance-knowledge-version") advanceKnowledgeVersion(action.dataset.id);
    if (name === "run-retrieval-quality-check") runRetrievalQualityCheck();
    if (name === "simulate-model-audit") simulateModelAudit();
    if (name === "review-model-call") reviewModelCall(action.dataset.id);
    if (name === "create-evaluation-suite") createEvaluationSuite();
    if (name === "run-assistant-evaluation") runAssistantEvaluation();
    if (name === "create-assistant-release") createAssistantRelease();
    if (name === "advance-assistant-release") advanceAssistantRelease(action.dataset.id);
    if (name === "rollback-assistant-release") rollbackAssistantRelease(action.dataset.id);
    if (name === "create-canary-deployment") createCanaryDeployment();
    if (name === "run-online-quality-check") runOnlineQualityCheck();
    if (name === "advance-canary-deployment") advanceCanaryDeployment(action.dataset.id);
    if (name === "simulate-online-degradation") simulateOnlineDegradation();
    if (name === "rollback-canary-deployment") rollbackCanaryDeployment(action.dataset.id);
    if (name === "collect-assistant-feedback") collectAssistantFeedback();
    if (name === "review-assistant-feedback") reviewAssistantFeedback(action.dataset.id);
    if (name === "convert-feedback-sample") convertFeedbackSample(action.dataset.id);
    if (name === "annotate-improvement-sample") annotateImprovementSample(action.dataset.id);
    if (name === "include-improvement-sample") includeImprovementSample(action.dataset.id);
    if (name === "run-improvement-regression") runImprovementRegression(action.dataset.id);
    if (name === "ask-standard-question") askStandardQuestion();
    if (name === "confirm-standard-answer") confirmStandardAnswer(action.dataset.id);
    if (name === "generate-anomaly-explanations") generateAnomalyExplanations();
    if (name === "edit-anomaly-explanation") editAnomalyExplanation(action.dataset.id);
    if (name === "adopt-anomaly-explanation") adoptAnomalyExplanation(action.dataset.id);
    if (name === "generate-rectification-suggestion") generateRectificationSuggestion();
    if (name === "adopt-rectification-suggestion") adoptRectificationSuggestion(action.dataset.id);
    if (name === "scan-review-risks") scanReviewRisks();
    if (name === "confirm-review-risk") confirmReviewRisk(action.dataset.id);
    if (name === "dismiss-review-risk") dismissReviewRisk(action.dataset.id);
    if (name === "review-risk-to-expert") reviewRiskToExpert(action.dataset.id);
    if (name === "run-monitoring-check") runMonitoringCheck();
    if (name === "ack-monitoring-alert") acknowledgeMonitoringAlert(action.dataset.id);
    if (name === "recover-service") recoverService(action.dataset.id);
    if (name === "probe-interfaces") probeInterfaces();
    if (name === "retry-interface") retryInterface(action.dataset.id);
    if (name === "scale-queue") scaleQueue(action.dataset.id);
    if (name === "prioritize-queue") prioritizeQueue(action.dataset.id);
    if (name === "expand-storage") expandStorage(action.dataset.id);
    if (name === "clean-storage") cleanStorage(action.dataset.id);
    if (name === "create-public-health-incident") createPublicHealthIncident();
    if (name === "advance-public-health-incident") advancePublicHealthIncident(action.dataset.id);
    if (name === "record-public-health-evidence") recordPublicHealthEvidence(action.dataset.id);
    if (name === "review-public-health-evidence") reviewPublicHealthEvidence(action.dataset.id, action.dataset.decision);
    if (name === "escalate-public-health-incident") escalatePublicHealthIncident(action.dataset.id);
    if (name === "export-public-health-incidents") downloadPublicHealthIncidentExport(action.dataset.format || "json");
    if (name === "reset-public-health-filters") resetPublicHealthFilters();
    if (name === "simulate-public-health-break") simulatePublicHealthBreak();
    if (name === "simulate-public-health-chain-break") simulatePublicHealthChainBreak();
    if (name === "restore-public-health-continuity") restorePublicHealthContinuity();
    if (name === "generate-spot-check") generateSpotCheck();
    if (name === "assign-spot-check") assignSpotCheck();
    if (name === "complete-spot-check") completeSpotCheck();
    if (name === "run-sandbox") runSandbox();
    if (name === "approve-sandbox") approveSandbox();
    if (name === "classify-materials") classifyMaterials();
    if (name === "confirm-classification") confirmClassification(action.dataset.id);
    if (name === "scan-anomalies") scanAnomalies();
    if (name === "anomaly-to-spot-check") anomalyToSpotCheck(action.dataset.id);
    if (name === "send-mobile-reminder") sendMobileReminder();
    if (name === "read-all-messages") readAllMessages();
    if (name === "toggle-channel") toggleChannel(action.dataset.channel);
    if (name === "simulate-import") simulateImport();
    if (name === "rerun-import") rerunImport(action.dataset.id);
    if (name === "run-validation") runValidationRules();
    if (name === "mark-submitted") {
      Object.values(submissionForActive()).forEach((entry) => {
        entry.status = "已提交";
      });
      state.task.status = "审核中";
      saveState();
      showNotice("医院申报已提交，进入省级审核。");
      render();
    }
    if (name === "resolve-issue") {
      const issue = state.validationIssues.find((item) => item.id === action.dataset.id);
      if (issue) issue.status = "resolved";
      saveState();
      showNotice("问题已标记处理。");
      render();
    }
    if (name === "approve-indicator") addReviewNote(action.dataset.code, "通过");
    if (name === "return-indicator") addReviewNote(action.dataset.code, "退回补正");
    if (name === "escalate-indicator") addReviewNote(action.dataset.code, "专家复核");
    if (name === "bulk-approve") bulkApprove();
    if (name === "auto-expert-review") autoCreateExpertReviews();
    if (name === "expert-agree") resolveExpertReview(action.dataset.id, "agree");
    if (name === "expert-adjust") resolveExpertReview(action.dataset.id, "adjust");
    if (name === "expert-supplement") resolveExpertReview(action.dataset.id, "supplement");
    if (name === "confirm-score") {
      state.confirmed = true;
      state.task.status = "结果确认";
      saveState();
      showNotice("评价结果已确认。");
      render();
    }
    if (name === "make-rectifications") makeRectifications();
    if (name === "advance-rectification") advanceRectification(action.dataset.id);
    if (name === "advance-stage") advanceOperationStage();
    if (name === "publish-standard") publishStandardVersion();
    if (name === "run-rule-audit") runRuleAudit();
    if (name === "toggle-rule") toggleRule(action.dataset.id);
    if (name === "pass-security") passSecurityItem(action.dataset.id);
    if (name === "run-security-check") runSecurityCheck();
    if (name === "archive-cycle") archiveCycle();
    if (name === "download-package") downloadJsonPackage(action.dataset.kind);
    if (name === "copy-package") {
      const text = JSON.stringify(buildDataPackage(action.dataset.kind), null, 2);
      navigator.clipboard?.writeText(text).then(
        () => showNotice(`${packageKindLabel(action.dataset.kind)}已复制。`),
        () => showNotice("当前浏览器不允许直接写入剪贴板，可从预览区手动复制。"),
      );
    }
  });

  document.addEventListener("input", (event) => {
    const score = event.target.closest("[data-update-score]");
    if (score) {
      updateSubmissionField(score.dataset.updateScore, "selfScore", Number(score.value || 0));
      return;
    }
    const evidence = event.target.closest("[data-update-evidence]");
    if (evidence) {
      updateSubmissionField(evidence.dataset.updateEvidence, "evidenceCount", Number(evidence.value || 0));
      return;
    }
    const comment = event.target.closest("[data-update-comment]");
    if (comment) {
      updateSubmissionField(comment.dataset.updateComment, "comment", comment.value);
      return;
    }
    const metric = event.target.closest("[data-metric]");
    if (metric) {
      state.metrics[metric.dataset.metric] = Number(metric.value || 0);
      saveState();
    }
    const filter = event.target.closest("[data-filter]");
    if (filter) {
      workspace.dataset[filter.dataset.filter] = filter.value;
      renderStandards();
      return;
    }
    const publicHealthFilter = event.target.closest("[data-public-health-filter]");
    if (publicHealthFilter) {
      workspace.dataset[publicHealthFilter.dataset.publicHealthFilter] = publicHealthFilter.value;
      renderPublicHealth();
      return;
    }
    const packageKind = event.target.closest("[data-package-kind]");
    if (packageKind) {
      workspace.dataset.packageKind = packageKind.value;
      renderExchange();
    }
    const sandboxConfig = event.target.closest("[data-sandbox-config]");
    if (sandboxConfig) {
      state.sandboxConfig[sandboxConfig.dataset.sandboxConfig] = Number(sandboxConfig.value || 0);
      saveState();
    }
  });

  hospitalSelect.addEventListener("change", () => {
    state.selectedHospital = hospitalSelect.value;
    saveState();
    showNotice(`已切换到：${activeHospital().name}`);
    render();
  });

  roleSelect.addEventListener("change", () => {
    state.activeRole = roleSelect.value;
    addAudit("切换演示角色", state.activeRole, "已切换");
    saveState();
    showNotice(`已切换到角色：${state.activeRole}`);
    render();
  });

  document.getElementById("resetState").addEventListener("click", () => {
    localStorage.removeItem(storageKey);
    state = cloneSeed();
    showNotice("样例数据已重置。");
    render();
  });

  render();
})();
