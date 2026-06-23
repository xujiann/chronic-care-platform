(function (global) {
  const applications = [
    {
      id: "commission-supervision",
      name: "卫健委综合监管",
      entry: "index.html",
      owner: "commission",
      collections: ["residents", "diseases", "followups", "emergencySignals", "healthStatistics", "platformProcessAudit"]
    },
    {
      id: "institution-services",
      name: "医疗机构服务",
      entry: "institution.html",
      owner: "institution",
      collections: ["personalRecords", "careOrders", "medicationPickups", "birthCertificates", "deathCertificates", "multiPracticeApplications"]
    },
    {
      id: "insurance-governance",
      name: "医保治理协同",
      entry: "insurance.html",
      owner: "insurance",
      collections: ["insuranceClaims", "digitalCredentials", "medicationPickups"]
    },
    {
      id: "citizen-portal",
      name: "居民健康门户",
      entry: "citizen.html",
      owner: "citizen",
      collections: ["accounts", "residents", "personalRecords", "authorizations", "seniorServices", "digitalCredentials"]
    },
    {
      id: "county-consortium",
      name: "县域医共体协同",
      entry: "county.html",
      owner: "county",
      collections: ["countyCollaborationOrders", "countyMutualRecognitionRecords", "countyAiDiagnosisCases", "countyAcceptanceLedger"]
    },
    {
      id: "platform-governance",
      name: "平台治理与接口",
      entry: "platform.html",
      owner: "commission",
      collections: ["platformCapabilities", "platformInterfaces", "platformEvidence", "hospitalInteroperabilityFunctions", "applicationCatalog"]
    },
    {
      id: "operations-workbench",
      name: "运维验收工作台",
      entry: "workbench.html",
      owner: "commission",
      collections: ["platformRoadmap", "platformProcessAudit", "productionDeploymentPlan", "securityAcceptanceLedger"]
    }
  ];

  if (typeof module !== "undefined" && module.exports) {
    module.exports = applications;
  }
  if (global) {
    global.HealthDashboardApplications = applications;
  }
})(typeof window !== "undefined" ? window : globalThis);
