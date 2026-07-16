function arrayOf(data, key) {
  return Array.isArray(data?.[key]) ? data[key] : [];
}

function groupBy(items, key) {
  return items.reduce((acc, item) => {
    const value = item[key] || "unknown";
    acc[value] = (acc[value] || 0) + 1;
    return acc;
  }, {});
}

function isOpenStatus(value) {
  return /open|pending|scheduled|blocked|site|external|no-go|awaiting|review|unsigned|unapproved|\u5f85|\u672a|\u963b\u585e|\u73b0\u573a|\u7b7e\u5b57|\u5ba1\u6279/i.test(String(value || ""));
}

function normalizeBlocker(source, item, index = 0) {
  const status = item.status || item.workflowStatus || item.remediationStatus || item.signoffStatus || "open";
  return {
    id: item.id || item.blockerId || `${source}-${index + 1}`,
    source,
    title: item.title || item.name || item.blocker || item.blockerId || item.id || source,
    severity: item.severity || item.priority || "P2",
    owner: item.owner || item.assignee || "",
    status,
    domain: item.domain || item.category || item.blockerSource || source,
    siteWindow: item.siteWindow || item.verificationWindow || "",
    evidenceStatus: (item.evidenceRefs || item.evidence || item.evidenceRef || item.requiredEvidence) ? "evidence-required" : "missing-evidence",
    nextAction: item.nextAction || item.resolutionAction || item.blocker || item.next || "Record onsite evidence and assign an owner.",
    productionReady: item.productionReady === true || item.siteSigned === true || /closed|verified|signed|approved|ready/i.test(status)
  };
}

function buildPlatformBlockerRegister(data = {}, capabilityMap = {}) {
  const rows = [];
  (capabilityMap.riskRegister?.items || []).forEach((item, index) => rows.push(normalizeBlocker(item.source || "capability-map-risk", item, index)));
  [
    ["platform-production-blocker", arrayOf(data, "platformProductionBlockerReviews")],
    ["public-health-cutover", arrayOf(data, "publicHealthCutoverBlockers")],
    ["public-health-site-evidence", arrayOf(data, "publicHealthSiteEvidenceVerificationTasks")],
    ["digital-hospital-risk", arrayOf(data, "digitalHospitalRiskItems")],
    ["emergency-launch", arrayOf(data, "emergencyLaunchRequirements")],
    ["onsite-launch-evidence", arrayOf(data, "siteLaunchEvidence")]
  ].forEach(([source, items]) => {
    items.forEach((item, index) => {
      const open = item.productionReady === false || item.siteSigned === false || item.cutoverBlocker === true || isOpenStatus(item.status || item.workflowStatus || item.remediationStatus || item.signoffStatus);
      if (open) rows.push(normalizeBlocker(source, item, index));
    });
  });

  const unique = Array.from(new Map(rows.map((item) => [`${item.source}:${item.id}`, item])).values());
  const open = unique.filter((item) => !item.productionReady);
  const p0 = open.filter((item) => item.severity === "P0");
  const p1 = open.filter((item) => item.severity === "P1");
  return {
    ok: unique.length > 0 && p0.length > 0,
    generatedAt: new Date().toISOString(),
    summary: {
      total: unique.length,
      open: open.length,
      p0: p0.length,
      p1: p1.length,
      sources: Object.keys(groupBy(unique, "source")).length,
      owners: Object.keys(groupBy(unique.filter((item) => item.owner), "owner")).length,
      evidenceRequired: unique.filter((item) => item.evidenceStatus === "evidence-required").length,
      productionReady: unique.filter((item) => item.productionReady).length
    },
    bySource: groupBy(unique, "source"),
    bySeverity: groupBy(unique, "severity"),
    blockers: unique
  };
}

function normalizeServiceOrder(source, item, index = 0) {
  return {
    id: item.id || `${source}-${index + 1}`,
    sourceCollection: item.sourceCollection || source,
    sourceId: item.sourceId || item.id || "",
    serviceType: item.serviceType || item.serviceName || source,
    residentId: item.residentId || "",
    title: item.title || item.taskName || item.serviceName || item.orderType || item.packageName || item.id || source,
    status: item.status || item.lifecycle || "open",
    lifecycle: item.lifecycle || (/closed|completed|finished|\u5df2\u5b8c\u6210|\u5df2\u5173\u95ed/i.test(String(item.status || "")) ? "closed" : "active"),
    ownerRole: item.ownerRole || item.providerRole || "",
    providerName: item.providerName || item.institution || item.sourceInstitution || item.assignee || "",
    scheduledAt: item.scheduledAt || item.due || item.appointmentAt || item.createdAt || "",
    productionReady: item.productionReady === true,
    nextAction: item.nextAction || item.nextStep || ""
  };
}

function buildPlatformServiceOrderCenter(data = {}) {
  const explicit = arrayOf(data, "serviceOrders").map((item, index) => normalizeServiceOrder("serviceOrders", item, index));
  const derivedSources = [
    ["internetNursingOrders", "internet-nursing"],
    ["escortServiceOrders", "escort"],
    ["registrationOrders", "registration"],
    ["chronicScreeningTasks", "chronic-followup"],
    ["careOrders", "care"],
    ["countyCollaborationOrders", "referral"],
    ["emergencyEvents", "emergency"],
    ["physicalExamFollowupTasks", "physical-exam"]
  ];
  const derived = derivedSources.flatMap(([collection, serviceType]) =>
    arrayOf(data, collection).map((item, index) => normalizeServiceOrder(collection, { ...item, serviceType }, index))
  );
  const orders = Array.from(new Map([...explicit, ...derived].filter((item) => item.residentId || item.sourceCollection !== "serviceOrders").map((item) => [`${item.sourceCollection}:${item.id}`, item])).values());
  return {
    ok: orders.length >= 8,
    generatedAt: new Date().toISOString(),
    summary: {
      total: orders.length,
      serviceTypes: Object.keys(groupBy(orders, "serviceType")).length,
      active: orders.filter((item) => item.lifecycle !== "closed").length,
      closed: orders.filter((item) => item.lifecycle === "closed").length,
      residentLinked: orders.filter((item) => item.residentId).length,
      productionReady: orders.filter((item) => item.productionReady).length
    },
    byServiceType: groupBy(orders, "serviceType"),
    byLifecycle: groupBy(orders, "lifecycle"),
    orders: orders.slice(0, 200)
  };
}

function buildMasterDataDirectory(data = {}) {
  const dictionaries = arrayOf(data, "standardDataDictionaries");
  const domains = dictionaries.map((item) => {
    const collections = item.platformCollections || [];
    const missingCollections = collections.filter((key) => !Object.prototype.hasOwnProperty.call(data, key));
    return {
      id: item.id,
      name: item.name,
      domain: item.domain,
      owner: item.owner,
      version: item.version || `${item.id || "dictionary"}-2026.1`,
      status: item.status || "structured-summary",
      standardItems: item.standardItems || [],
      platformCollections: collections,
      missingCollections,
      blocker: item.blocker || "",
      onsiteBlocked: /blocked|pending/i.test(`${item.status || ""} ${item.blocker || ""}`) || missingCollections.length > 0,
      signoffStatus: item.signoffStatus || "pending-site-signoff",
      rollbackReady: Boolean(item.rollbackVersion || item.previousVersion || item.version)
    };
  });
  const onsiteBlocked = domains.filter((item) => item.onsiteBlocked);
  return {
    ok: domains.length >= 6 && domains.every((item) => item.version && item.owner && item.standardItems.length),
    generatedAt: new Date().toISOString(),
    summary: {
      domains: domains.length,
      onsiteBlocked: onsiteBlocked.length,
      signed: domains.filter((item) => /signed|approved/i.test(item.signoffStatus)).length,
      rollbackReady: domains.filter((item) => item.rollbackReady).length,
      collectionsReferenced: new Set(domains.flatMap((item) => item.platformCollections)).size
    },
    domains,
    onsiteBlocked
  };
}

function buildPlatformGoLiveSlices(data = {}, capabilityMap = {}) {
  const blockerRegister = buildPlatformBlockerRegister(data, capabilityMap);
  const serviceOrderCenter = buildPlatformServiceOrderCenter(data);
  const masterDataDirectory = buildMasterDataDirectory(data);
  const checks = [
    { id: "goLiveSlices:blockerRegister", passed: blockerRegister.ok && blockerRegister.summary.open >= 1, detail: `${blockerRegister.summary.open} open blockers` },
    { id: "goLiveSlices:serviceOrderCenter", passed: serviceOrderCenter.ok && serviceOrderCenter.summary.serviceTypes >= 4, detail: `${serviceOrderCenter.summary.total} service orders / ${serviceOrderCenter.summary.serviceTypes} service types` },
    { id: "goLiveSlices:masterDataDirectory", passed: masterDataDirectory.ok && masterDataDirectory.summary.domains >= 6, detail: `${masterDataDirectory.summary.domains} master data domains` },
    { id: "goLiveSlices:productionBoundary", passed: blockerRegister.summary.p0 >= 1 && masterDataDirectory.summary.onsiteBlocked >= 1, detail: "onsite blockers remain explicit" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    summary: {
      openBlockers: blockerRegister.summary.open,
      p0Blockers: blockerRegister.summary.p0,
      serviceOrders: serviceOrderCenter.summary.total,
      serviceTypes: serviceOrderCenter.summary.serviceTypes,
      masterDataDomains: masterDataDirectory.summary.domains,
      onsiteMasterDataGaps: masterDataDirectory.summary.onsiteBlocked
    },
    blockerRegister,
    serviceOrderCenter,
    masterDataDirectory,
    checks
  };
}

function cleanCell(value) {
  return String(value ?? "").replace(/\|/g, "/");
}

function renderPlatformGoLiveSlicesMarkdown(report) {
  const checkRows = (report.checks || []).map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${cleanCell(item.id)} | ${cleanCell(item.detail)} |`);
  const blockerRows = (report.blockerRegister?.blockers || []).slice(0, 40).map((item) => `| ${cleanCell(item.severity)} | ${cleanCell(item.source)} | ${cleanCell(item.title)} | ${cleanCell(item.owner)} | ${cleanCell(item.status)} | ${cleanCell(item.nextAction)} |`);
  const serviceRows = (report.serviceOrderCenter?.orders || []).slice(0, 40).map((item) => `| ${cleanCell(item.serviceType)} | ${cleanCell(item.title)} | ${cleanCell(item.residentId)} | ${cleanCell(item.status)} | ${cleanCell(item.providerName)} |`);
  const masterRows = (report.masterDataDirectory?.domains || []).map((item) => `| ${cleanCell(item.domain)} | ${cleanCell(item.name)} | ${cleanCell(item.version)} | ${cleanCell(item.owner)} | ${cleanCell(item.signoffStatus)} | ${item.onsiteBlocked ? "YES" : "NO"} |`);
  return [
    "# Platform go-live slices readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "ATTENTION"}`,
    `- Open blockers: ${report.summary?.openBlockers || 0}`,
    `- Service orders: ${report.summary?.serviceOrders || 0}`,
    `- Master data domains: ${report.summary?.masterDataDomains || 0}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Unified Blocker Register",
    "",
    "| Severity | Source | Blocker | Owner | Status | Next Action |",
    "|---|---|---|---|---|---|",
    ...blockerRows,
    "",
    "## Service Order Center",
    "",
    "| Type | Title | Resident | Status | Provider |",
    "|---|---|---|---|---|",
    ...serviceRows,
    "",
    "## Master Data Directory",
    "",
    "| Domain | Name | Version | Owner | Signoff | Onsite Blocked |",
    "|---|---|---|---|---|---|",
    ...masterRows,
    ""
  ].join("\n");
}

module.exports = {
  buildMasterDataDirectory,
  buildPlatformBlockerRegister,
  buildPlatformGoLiveSlices,
  buildPlatformServiceOrderCenter,
  renderPlatformGoLiveSlicesMarkdown
};
