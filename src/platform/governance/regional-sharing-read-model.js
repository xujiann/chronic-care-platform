"use strict";

const CONTRACT_ID = "regional-sharing-read-model.v1";

function requirePorts(ports) {
  const required = [
    "buildReferralHandoffEvidence",
    "canAccessPackage",
    "createId",
    "normalizePackages",
    "now",
    "seedPackages",
    "seedScope",
    "seedSnapshots"
  ];
  const missing = required.filter((name) => typeof ports?.[name] !== "function");
  if (missing.length) throw new TypeError(`regional sharing read model is missing: ${missing.join(", ")}`);
  return ports;
}

function renderRegionalHandoffMarkdown(report) {
  const rows = (report.packages || []).map((item) => [
    item.id,
    item.residentName,
    item.sourceInstitution,
    (item.targetInstitutions || []).join("、") || "未配置",
    `${item.readyCount}/${item.total}`,
    item.pendingEvidence.length ? item.pendingEvidence.join("、") : "无"
  ]);
  return [
    "# 区域共享-转诊会诊交接清单",
    "",
    `- 清单编号：${report.reportId}`,
    `- 生成时间：${report.generatedAt}`,
    `- 生成角色：${report.actor.organization || report.actor.role}`,
    `- 权限范围：${report.scope.packageScope}`,
    `- 交接就绪：${report.summary.handoffReady}/${report.summary.packages}`,
    `- 运行边界：${report.scope.runtimeBoundary}`,
    "",
    "| 共享包 | 居民 | 来源机构 | 接收机构 | 证据进度 | 待补证据 |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}

function createRegionalSharingReadModel(dependencies = {}) {
  const ports = requirePorts(dependencies);

  function buildRegionalDataSharingView(data, user) {
    const packages = ports.normalizePackages(data.regionalSharingPackages || ports.seedPackages())
      .filter((item) => ports.canAccessPackage(user, item));
    const reviews = (data.regionalSharingAccessReviews || []).filter((review) =>
      packages.some((item) => item.id === review.packageId)
    );
    const residentsById = new Map((data.residents || []).map((item) => [item.id, item]));
    const contractsById = new Map((data.integrationContracts || []).map((item) => [item.id, item]));
    const diagnosticReports = data.diagnosticReports || [];
    const personalRecords = data.personalRecords || [];
    const recognitionRecords = data.countyMutualRecognitionRecords || [];
    const enrichedPackages = packages.map((item) => {
      const relatedReports = diagnosticReports.filter((report) => report.residentId === item.residentId || item.recordRefs.includes(report.id));
      const relatedPersonalRecords = personalRecords.filter((record) => record.residentId === item.residentId && (item.recordRefs.includes(record.id) || item.sharedCollections.includes("personalRecords")));
      const relatedRecognition = recognitionRecords.filter((record) => record.residentId === item.residentId || item.recordRefs.includes(record.id));
      const contracts = item.contractRefs.map((id) => contractsById.get(id)).filter(Boolean);
      const packageView = {
        ...item,
        resident: residentsById.get(item.residentId) || null,
        contracts: contracts.map((contract) => ({
          id: contract.id,
          domain: contract.domain,
          resource: contract.resource,
          status: contract.status
        })),
        evidenceCounts: {
          diagnosticReports: relatedReports.length,
          personalRecords: relatedPersonalRecords.length,
          mutualRecognitionRecords: relatedRecognition.length,
          contracts: contracts.length
        },
        latestRecords: [
          ...relatedReports.slice(0, 3).map((record) => ({ type: "diagnosticReports", id: record.id, name: record.item, status: record.status, at: record.reportedAt })),
          ...relatedPersonalRecords.slice(0, 3).map((record) => ({ type: "personalRecords", id: record.id, name: record.name, status: record.status || record.category, at: record.recordDate || record.date })),
          ...relatedRecognition.slice(0, 3).map((record) => ({ type: "countyMutualRecognitionRecords", id: record.id, name: record.item, status: record.status, at: record.at }))
        ].sort((left, right) => String(right.at || "").localeCompare(String(left.at || ""))).slice(0, 5)
      };
      return {
        ...packageView,
        referralHandoff: ports.buildReferralHandoffEvidence(packageView, reviews)
      };
    });
    return {
      scope: data.regionalDataSharingScope || ports.seedScope(),
      snapshots: data.regionalSharingSnapshots || ports.seedSnapshots(),
      summary: {
        totalPackages: enrichedPackages.length,
        ready: enrichedPackages.filter((item) => item.status === "ready").length,
        pendingReview: enrichedPackages.filter((item) => item.status === "pending_review").length,
        blocked: enrichedPackages.filter((item) => item.status === "blocked").length,
        referralHandoffReady: enrichedPackages.filter((item) => item.referralHandoff?.ready).length,
        accessReviews: reviews.length,
        institutions: new Set(enrichedPackages.flatMap((item) => [item.sourceInstitution, ...(item.targetInstitutions || [])]).filter(Boolean)).size,
        contracts: new Set(enrichedPackages.flatMap((item) => item.contractRefs || [])).size
      },
      packages: enrichedPackages,
      accessReviews: reviews.slice(0, 50)
    };
  }

  function buildRegionalHandoffReport(data, user) {
    const view = buildRegionalDataSharingView(data, user);
    const packages = (view.packages || []).map((item) => {
      const handoff = item.referralHandoff || { ready: false, readyCount: 0, total: 0, evidence: [] };
      const evidence = handoff.evidence || [];
      return {
        id: item.id,
        title: item.title,
        residentId: item.residentId,
        residentName: item.resident?.name || item.residentId,
        sourceInstitution: item.sourceInstitution || item.sourceOrgCode,
        targetInstitutions: item.targetInstitutions || item.targetOrgCodes || [],
        status: item.status,
        handoffReady: Boolean(handoff.ready),
        readyCount: handoff.readyCount || evidence.filter((entry) => entry.ready).length,
        total: handoff.total || evidence.length,
        readyEvidence: evidence.filter((entry) => entry.ready).map((entry) => entry.label),
        pendingEvidence: evidence.filter((entry) => !entry.ready).map((entry) => entry.label),
        note: handoff.note
      };
    });
    const report = {
      reportId: `rshr-${ports.createId()}`,
      generatedAt: ports.now(),
      actor: {
        role: user.role,
        organization: user.orgName || "",
        name: user.name || ""
      },
      scope: {
        name: view.scope?.name || "区域诊疗数据共享平台",
        packageScope: user.role === "commission" ? "全域共享包" : "本机构来源或接收共享包",
        runtimeBoundary: "只生成调阅交接证据清单，不生成或改写转诊单、号源、床位、接诊反馈和绩效结算。"
      },
      summary: {
        packages: packages.length,
        handoffReady: packages.filter((item) => item.handoffReady).length,
        evidenceTotal: packages.reduce((sum, item) => sum + item.total, 0),
        evidenceReady: packages.reduce((sum, item) => sum + item.readyCount, 0),
        accessReviews: view.summary?.accessReviews || 0
      },
      packages
    };
    return {
      ...report,
      markdown: renderRegionalHandoffMarkdown(report)
    };
  }

  return Object.freeze({
    contractId: CONTRACT_ID,
    buildRegionalDataSharingView,
    buildRegionalHandoffReport
  });
}

module.exports = {
  CONTRACT_ID,
  createRegionalSharingReadModel
};
