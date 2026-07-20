(function (global) {
  const applications = [
    {
      id: "regional-data-sharing",
      name: "Regional diagnosis data sharing",
      conversationTitle: "区域诊疗数据共享平台",
      entry: "regional-data-sharing.html",
      owner: "commission",
      collections: ["residents", "personalRecords", "diagnosticReports", "integrationContracts", "dataAccessLogs", "platformInterfaces"],
      functionalBoundary: "Share regional diagnosis and treatment data, authorization evidence, report lookup, and access review without becoming the clinical source system.",
      reusePoints: ["resident master index", "personal health records", "diagnostic reports", "integration contracts", "audit logs"],
      apiRoutes: ["GET /api/regional-data-sharing", "POST /api/regional-data-sharing/access-reviews"],
      testEvidence: ["test/static.test.js regional-data-sharing checks", "regional-data-sharing:report"],
      acceptanceEvidence: ["regional-data-sharing-report.json", "regional-data-sharing-report.md"]
    },
    {
      id: "referral-teleconsultation",
      name: "Referral and teleconsultation",
      conversationTitle: "医联体转诊与远程会诊平台",
      entry: "county.html",
      owner: "medical-services",
      collections: ["referralSystem", "referrals", "referralTeleconsultations", "careOrders", "countyCollaborationOrders", "countyAcceptanceLedger"],
      functionalBoundary: "Coordinate referral, remote consultation, receiving feedback, report return, resident authorization, and consortium performance evidence.",
      reusePoints: ["county consortium workflows", "care orders", "collaboration orders", "resident authorization", "acceptance ledger"],
      apiRoutes: ["GET /api/referral-teleconsultations", "POST /api/referral-teleconsultations", "POST /api/referral-teleconsultations/:id/actions"],
      testEvidence: ["test/referral-teleconsultation-readiness.test.js", "referral:readiness"],
      acceptanceEvidence: ["referral-teleconsultation-readiness-report.json", "referral-teleconsultation-readiness-report.md"]
    },
    {
      id: "quality-safety",
      name: "Medical quality and safety supervision",
      conversationTitle: "医疗质量与安全监管平台",
      entry: "quality-safety.html",
      owner: "quality-office",
      collections: ["diagnosticReports", "countyMutualRecognitionRecords", "dataQualityIssues", "institutionCreditEvaluations", "securityEvents", "hospitalInteroperabilityFunctions"],
      functionalBoundary: "Supervise quality events, critical values, clinical pathway evidence, mutual-recognition quality control, dispatch, feedback, and review.",
      reusePoints: ["diagnostic reports", "mutual-recognition records", "data-quality issues", "institution credit evaluation", "security audit events"],
      apiRoutes: ["GET /api/quality-safety/dashboard", "POST /api/quality-safety/issues/:id/dispatch", "POST /api/quality-safety/rectifications/:id/feedback", "POST /api/quality-safety/rectifications/:id/review"],
      testEvidence: ["test/quality-safety-report.test.js", "quality-safety:report"],
      acceptanceEvidence: ["quality-safety-report.json", "quality-safety-report.md"]
    },
    {
      id: "operations-dispatch",
      name: "Hospital operations and resource dispatch",
      conversationTitle: "医院运行监测与资源调度平台",
      entry: "operations.html",
      owner: "operations",
      collections: ["healthStatistics", "healthStatisticsIngestion", "medicalResources", "platformProcessAudit", "operationsReadiness"],
      functionalBoundary: "Monitor hospital operation indicators and coordinate resource dispatch, alert handling, and statistics reconciliation.",
      reusePoints: ["health statistics", "statistics ingestion", "medical resources", "platform process audit", "runtime metrics"],
      apiRoutes: ["GET /api/operations/dashboard", "POST /api/operations/dispatch", "POST /api/operations/reconciliation/:id/review"],
      testEvidence: ["test/hospital-operations-readiness.test.js", "operations:readiness"],
      acceptanceEvidence: ["hospital-operations-readiness-report.json", "hospital-operations-readiness-report.md"]
    },
    {
      id: "drug-consumable-supervision",
      name: "Drug, consumable, and rational medication supervision",
      conversationTitle: "药品耗材与合理用药监管平台",
      entry: "insurance.html",
      owner: "insurance-and-institution",
      collections: ["drugConsumableSupervisions", "medicationPickups", "insuranceClaims", "institutionSupervisions", "integrationContracts"],
      functionalBoundary: "Regulate rational medication, prescription review, fixed pickup, high-value consumable clues, insurance settlement, and remediation loops.",
      reusePoints: ["drug and consumable supervision records", "medication pickup records", "insurance claims", "institution supervision", "integration contracts"],
      apiRoutes: ["GET /api/drug-consumable-supervision", "POST /api/drug-consumable-supervision/:id/review", "POST /api/drug-consumable-supervision/:id/remediation", "POST /api/drug-consumable-supervision/:id/insurance-sync"],
      testEvidence: ["test/drug-consumable-readiness.test.js", "drug-consumable:readiness"],
      acceptanceEvidence: ["drug-consumable-readiness-report.json", "drug-consumable-readiness-report.md"]
    },
    {
      id: "chronic-followup",
      name: "Chronic disease management and post-discharge follow-up",
      conversationTitle: "慢病管理与院后随访平台",
      entry: "index.html",
      owner: "primary-care",
      collections: ["chronicScreeningTasks", "chronicManagementPlans", "followups", "personalRecords", "medicationPickups", "chronicAcceptanceLedger"],
      functionalBoundary: "Manage screening, tiered intervention, post-discharge follow-up, medication adherence, family doctor collaboration, and resident feedback.",
      reusePoints: ["chronic screening tasks", "management plans", "followups", "personal records", "medication pickup evidence", "chronic acceptance ledger"],
      apiRoutes: ["GET /api/service-acceptance-summary", "POST /api/chronic/followup-feedback", "PATCH /api/chronic-management-plans/:id"],
      testEvidence: ["test/chronic-followup-readiness.test.js", "chronic:followup-readiness"],
      acceptanceEvidence: ["chronic-followup-readiness-report.json", "chronic-followup-readiness-report.md"]
    },
    {
      id: "research-sandbox",
      name: "Research datasets and data sandbox",
      conversationTitle: "科研数据集与数据沙箱平台",
      entry: "platform.html",
      owner: "research-governance",
      collections: ["researchDatasets", "diseaseRegistryModels", "compliantDataExports", "dataAccessLogs", "securityAcceptanceLedger", "personalRecords", "diagnosticReports"],
      functionalBoundary: "Govern research dataset application, ethics approval, de-identification release, sandbox access, usage audit, evidence submission, compliant export, and outcome return.",
      reusePoints: ["research datasets", "disease registry models", "compliant exports", "data access logs", "security acceptance ledger", "clinical source records"],
      apiRoutes: ["GET /api/research/sandbox", "GET /api/research/datasets", "POST /api/research/datasets/:id/approval", "POST /api/research/datasets/:id/evidence", "POST /api/research/datasets/:id/sandbox-access", "POST /api/research/datasets/:id/compliant-exports", "POST /api/research/datasets/:id/outcomes"],
      testEvidence: ["test/research-sandbox-readiness.test.js", "research:sandbox"],
      acceptanceEvidence: ["research-sandbox-readiness-report.json", "research-sandbox-readiness-report.md"]
    },
    {
      id: "health-dashboard",
      name: "Health commission aggregate dashboard",
      conversationTitle: "卫生健康综合驾驶舱",
      entry: "health-dashboard.html",
      owner: "commission",
      aggregate: true,
      collections: ["healthDashboardSnapshots", "platformEvidence", "platformInterfaces", "productionDeploymentPlan", "platformRoadmap"],
      functionalBoundary: "Aggregate indicators, risks, open actions, interfaces, acceptance evidence, and site dependencies from the first seven source applications.",
      reusePoints: ["health dashboard snapshots", "platform evidence", "platform interfaces", "production deployment plan", "platform roadmap"],
      apiRoutes: ["GET /api/health-dashboard/summary", "GET /api/health-dashboard/industry-governance-indicators"],
      testEvidence: ["test/health-dashboard-summary.test.js", "test/api.test.js health-dashboard summary assertions", "health-dashboard:summary"],
      acceptanceEvidence: ["health-dashboard-summary.json", "health-dashboard-summary.md"]
    }
  ];

  if (typeof module !== "undefined" && module.exports) {
    module.exports = applications;
  }
  if (global) {
    global.HealthDashboardApplications = applications;
  }
})(typeof window !== "undefined" ? window : globalThis);
