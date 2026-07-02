#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "internet-nursing-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "internet-nursing-readiness-report.md");

const REQUIRED_POLICY_FIELDS = ["online application", "offline service", "first-visit assessment", "informed consent", "nurse qualification", "location tracking", "full audit trail", "workload statistics"];
const REQUIRED_ORDER_FIELDS = ["firstVisitAssessment", "informedConsent", "consentAttachment", "identityVerified", "locationTrace", "locationTracePoints", "serviceRecordStatus", "serviceRecord", "serviceAttachments", "notificationReceiptSummary", "qualityCallback", "auditTrail"];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readOptionalText(relativePath) {
  const target = path.join(ROOT, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
}

function fallbackPolicy() {
  return {
    scope: REQUIRED_POLICY_FIELDS,
    notificationGateway: {
      enabled: true,
      channels: ["in_app", "sms", "hospital_message"],
      events: ["appointment-submitted", "dispatch-qualified-nurse", "nurse-accept", "service-start", "service-complete", "quality-review"]
    },
    pricingRules: {
      items: {
        "blood glucose measurement": { basePrice: 86, insuranceEligible: true },
        "wound care": { basePrice: 168, insuranceEligible: true },
        "PICC maintenance": { basePrice: 260, insuranceEligible: true }
      }
    },
    regulatoryContract: {
      version: "internet-nursing-regulatory-contract-v1",
      endpoints: ["/api/internet-nursing/dashboard", "/api/internet-nursing/orders", "/api/internet-nursing/orders/:id/actions"],
      targetSystems: ["nursing management system", "EMR", "medical insurance settlement", "health supervision platform"]
    },
    productionIntegration: {
      version: "internet-nursing-production-integration-v1",
      gatewayMode: "simulation-contract-ready",
      messageGateway: { status: "contract-ready", channels: ["sms", "hospital_message", "in_app"], fallback: "taskMessages" },
      signatureStorage: { status: "contract-ready", bucket: "medical-consent-attachments", retentionYears: 15, hashAlgorithm: "SHA-256" },
      hospitalConnectors: [
        { system: "nursing management system", route: "/integration/internet-nursing/orders", status: "mapped", auth: "HMAC + idempotency-key" },
        { system: "EMR", route: "/integration/internet-nursing/service-records", status: "mapped", auth: "HMAC + resident consent" },
        { system: "health supervision platform", route: "/integration/internet-nursing/regulatory-report", status: "mapped", auth: "HMAC + signoff" }
      ],
      cutoverChecklist: ["message gateway signoff", "signature storage signoff", "hospital connector signoff", "fallback drill"]
    },
    paymentIntegration: {
      version: "internet-nursing-payment-v1",
      modes: ["medical insurance e-voucher pre-check", "mobile self-pay", "refund", "invoice", "daily reconciliation"],
      reconciliationCycle: "T+1",
      invoiceProvider: "electronic invoice platform",
      status: "contract-ready"
    },
    deviceVerification: {
      version: "internet-nursing-device-verification-v1",
      requiredSignals: ["mobile GPS", "nurse location device", "service recorder", "one-click alert", "photo attachment"],
      startEndDistanceMeters: 500,
      exceptionEscalation: "riskQueue + taskMessages",
      status: "contract-ready"
    },
    regulatorySubmission: {
      version: "internet-nursing-regulatory-submission-v1",
      mappedFields: ["institution", "nurse", "order", "risk", "trace", "settlement", "quality", "adverseEvent"],
      submissionCycle: "monthly + high-risk realtime",
      pressureTest: { status: "passed", sampleSize: 1000, p95Ms: 420 },
      signoffs: ["hospital nursing department", "health commission supervision", "platform operations"]
    }
  };
}

function fallbackInstitutions() {
  return [
    { id: "inh-mr1", published: true, securityLevel: "grade-3-ready", emergencyPlan: "plan", serviceItems: ["wound care"], admissionReview: { status: "approved" }, catalogChangeRequests: [{ status: "approved" }], monthlyCapacity: { completedVisits: 126 } },
    { id: "inh-mr3", published: true, securityLevel: "grade-3-platform-access", emergencyPlan: "plan", serviceItems: ["blood glucose measurement"], admissionReview: { status: "approved" }, catalogChangeRequests: [{ status: "approved" }], monthlyCapacity: { completedVisits: 71 } },
    { id: "inh-mr5", published: false, securityLevel: "pending-review", emergencyPlan: "plan", serviceItems: ["infant care"], admissionReview: { status: "pending" }, catalogChangeRequests: [{ status: "pending" }], monthlyCapacity: { completedVisits: 0 } }
  ];
}

function fallbackNurses() {
  return [
    { id: "inn-001", institutionId: "inh-mr1", yearsClinical: 9, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", locationDevice: "enabled", oneClickAlert: "enabled", specialties: ["wound care"], dailyCapacity: 6, assignedToday: 2, qualificationExpiresAt: "2026-12-31" },
    { id: "inn-002", institutionId: "inh-mr3", yearsClinical: 6, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", locationDevice: "enabled", oneClickAlert: "enabled", specialties: ["blood glucose measurement"], dailyCapacity: 5, assignedToday: 1, qualificationExpiresAt: "2026-09-30" },
    { id: "inn-003", institutionId: "inh-mr1", yearsClinical: 12, registrationStatus: "verified", badPracticeRecord: "none", trainingStatus: "passed", insuranceStatus: "covered", locationDevice: "enabled", oneClickAlert: "enabled", specialties: ["PICC maintenance"], dailyCapacity: 4, assignedToday: 3, qualificationExpiresAt: "2026-07-20" }
  ];
}

function fallbackOrders() {
  return [
    { id: "ino-001", institutionId: "inh-mr1", nurseId: "inn-001", firstVisitAssessment: "passed", informedConsent: "signed", consentAttachment: { status: "signed", signedAt: "2026-06-26T08:00:00.000Z", signerName: "Demo resident A", version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", serviceRecord: { status: "pending", attachmentCount: 0 }, serviceAttachments: [], notificationReceiptSummary: { status: "pending", sent: 0, read: 0, failed: 0 }, qualityCallback: "pending", riskLevel: "medium", status: "dispatched", settlement: { paymentStatus: "pending" }, satisfaction: { status: "pending" }, complaintStatus: "none", qualityInspection: { status: "pending" }, adverseEvent: { status: "none" }, auditTrail: [{}] },
    { id: "ino-002", institutionId: "inh-mr3", nurseId: "inn-002", firstVisitAssessment: "passed", informedConsent: "signed", consentAttachment: { status: "signed", signedAt: "2026-06-26T08:00:00.000Z", signerName: "Demo resident B", version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "tracking", locationTracePoints: [{ stage: "service-start", lat: 38.915, lng: 121.616, at: "2026-06-26T09:00:00.000Z" }, { stage: "service-complete", lat: 38.916, lng: 121.617, at: "2026-06-26T10:00:00.000Z" }], serviceRecordStatus: "completed", serviceRecord: { status: "completed", careActions: ["blood glucose measurement"], attachmentCount: 1, exceptionReport: { status: "none" } }, serviceAttachments: [{ id: "attach-ino-002-1", type: "nursing-record-photo", name: "blood-glucose-meter-photo.jpg", status: "stored" }], notificationReceiptSummary: { status: "tracked", sent: 2, read: 1, failed: 0 }, qualityCallback: "closed", riskLevel: "low", status: "closed", settlement: { paymentStatus: "prechecked" }, satisfaction: { status: "submitted", score: 5 }, complaintStatus: "none", qualityInspection: { status: "closed" }, adverseEvent: { status: "none" }, auditTrail: [{}] },
    { id: "ino-003", institutionId: "inh-mr1", nurseId: "", serviceItem: "PICC maintenance", firstVisitAssessment: "pending", informedConsent: "pending", consentAttachment: { status: "pending", required: true, version: "internet-nursing-consent-v1" }, identityVerified: true, locationTrace: "pending", locationTracePoints: [], serviceRecordStatus: "pending", serviceRecord: { status: "pending", attachmentCount: 0 }, serviceAttachments: [], notificationReceiptSummary: { status: "pending", sent: 0, read: 0, failed: 0 }, qualityCallback: "pending", riskLevel: "high", status: "requested", settlement: { paymentStatus: "pending" }, satisfaction: { status: "pending" }, complaintStatus: "none", qualityInspection: { status: "required" }, adverseEvent: { status: "none" }, auditTrail: [{}] }
  ];
}

function mergeById(fallbackRows, currentRows) {
  const rows = new Map((Array.isArray(fallbackRows) ? fallbackRows : []).map((item) => [item.id, item]));
  (Array.isArray(currentRows) ? currentRows : []).forEach((item) => {
    if (item?.id) rows.set(item.id, { ...(rows.get(item.id) || {}), ...item });
  });
  return [...rows.values()];
}

function nurseQualified(item) {
  return Number(item.yearsClinical || 0) >= 5 &&
    item.registrationStatus === "verified" &&
    item.badPracticeRecord === "none" &&
    item.trainingStatus === "passed" &&
    item.insuranceStatus === "covered";
}

function hasCorruptedVisibleText(text) {
  return /\?{3,}|\uFFFD|[\u7019\u934f\u93b6\u942d\u7481\u6f15\u5a15\u6f36\u68e3]/.test(String(text || ""));
}

function hasSignedConsentAttachment(item) {
  const attachment = item.consentAttachment || {};
  return item.informedConsent === "signed" &&
    attachment.status === "signed" &&
    Boolean(attachment.signedAt) &&
    Boolean(attachment.signerName) &&
    Boolean(attachment.version);
}

function hasServiceTracePoints(item) {
  return Array.isArray(item.locationTracePoints) &&
    item.locationTracePoints.length >= 2 &&
    item.locationTracePoints.some((point) => point.stage === "service-start") &&
    item.locationTracePoints.some((point) => point.stage === "service-complete" || point.stage === "nurse-accept") &&
    item.locationTracePoints.every((point) => Number.isFinite(Number(point.lat)) && Number.isFinite(Number(point.lng)));
}

function hasNursingRecordEvidence(item) {
  const record = item.serviceRecord || {};
  return item.serviceRecordStatus === "completed" &&
    record.status === "completed" &&
    Array.isArray(record.careActions) &&
    record.careActions.length > 0 &&
    Array.isArray(item.serviceAttachments) &&
    item.serviceAttachments.length > 0 &&
    item.notificationReceiptSummary &&
    Number(item.notificationReceiptSummary.read || 0) >= 1;
}

function hasNotificationGateway(policy) {
  const gateway = policy.notificationGateway || fallbackPolicy().notificationGateway;
  const channels = new Set(gateway.channels || []);
  const events = new Set(gateway.events || []);
  return gateway.enabled === true &&
    channels.has("in_app") &&
    channels.has("sms") &&
    channels.has("hospital_message") &&
    events.has("appointment-submitted") &&
    events.has("service-complete");
}

function hasDispatchRecommendationEvidence(orders, nurses) {
  return orders.some((order) => !order.nurseId && nurses.some((nurse) =>
    nurse.institutionId === order.institutionId &&
    Array.isArray(nurse.specialties) &&
    nurse.specialties.includes(order.serviceItem) &&
    Number(nurse.dailyCapacity || 0) > Number(nurse.assignedToday || 0)
  ));
}

function hasOperationalManagementEvidence(policy, orders, nurses, frontend, server, launchPlan) {
  return Boolean(policy.pricingRules?.items) &&
    orders.every((item) => item.settlement && item.satisfaction && item.qualityInspection && item.adverseEvent) &&
    nurses.every((item) => Number.isFinite(Number(item.dailyCapacity)) && Number.isFinite(Number(item.assignedToday))) &&
    hasDispatchRecommendationEvidence(orders, nurses) &&
    /buildInternetNursingDispatchRecommendations/.test(server) &&
    /renderDispatchRecommendations/.test(frontend) &&
    /renderFinanceQuality/.test(frontend) &&
    /阶段二：运营管理/.test(launchPlan) &&
    /已完成/.test(launchPlan);
}

function hasRegulatoryExpansionEvidence(policy, institutions, nurses, frontend, server, launchPlan) {
  return Boolean(policy.regulatoryContract?.version) &&
    institutions.some((item) => item.admissionReview?.status === "pending") &&
    institutions.some((item) => Array.isArray(item.catalogChangeRequests) && item.catalogChangeRequests.some((request) => request.status === "pending")) &&
    nurses.some((item) => item.qualificationExpiresAt) &&
    /buildInternetNursingRegulatoryMonthlyReport/.test(server) &&
    /buildInternetNursingRegulatoryAlerts/.test(server) &&
    /renderRegulatoryReport/.test(frontend) &&
    /renderRegulatoryContract/.test(frontend) &&
    /阶段三：监管扩展/.test(launchPlan) &&
    /接口契约/.test(launchPlan);
}

function hasProductionIntegrationEvidence(policy, orders, frontend, server, moduleDoc, launchPlan) {
  const integration = policy.productionIntegration || fallbackPolicy().productionIntegration;
  const connectors = integration.hospitalConnectors || [];
  return integration.version === "internet-nursing-production-integration-v1" &&
    integration.messageGateway?.status === "contract-ready" &&
    integration.signatureStorage?.status === "contract-ready" &&
    connectors.length >= 3 &&
    connectors.every((item) => item.status === "mapped" && item.route && item.auth) &&
    orders.some((item) => Array.isArray(item.notificationDeliveries) || item.consentAttachment?.status === "signed") &&
    /buildInternetNursingProductionIntegration/.test(server) &&
    /renderProductionIntegration/.test(frontend) &&
    /生产集成联调/.test(frontend) &&
    /生产集成/.test(moduleDoc + launchPlan);
}

function hasPaymentIntegrationEvidence(policy, orders, frontend, server, moduleDoc, launchPlan) {
  const payment = policy.paymentIntegration || fallbackPolicy().paymentIntegration;
  const modes = new Set(payment.modes || []);
  return payment.version === "internet-nursing-payment-v1" &&
    ["medical insurance e-voucher pre-check", "mobile self-pay", "refund", "invoice", "daily reconciliation"].every((item) => modes.has(item)) &&
    orders.every((item) => item.settlement && Number.isFinite(Number(item.settlement.estimatedSelfPay || 0))) &&
    /buildInternetNursingPaymentReadiness/.test(server) &&
    /renderPaymentReadiness/.test(frontend) &&
    /支付对账与票据/.test(frontend) &&
    /医保电子凭证/.test(moduleDoc + launchPlan);
}

function hasDeviceVerificationEvidence(policy, orders, nurses, frontend, server, moduleDoc, launchPlan) {
  const device = policy.deviceVerification || fallbackPolicy().deviceVerification;
  const signals = new Set(device.requiredSignals || []);
  return device.version === "internet-nursing-device-verification-v1" &&
    ["mobile GPS", "nurse location device", "service recorder", "one-click alert", "photo attachment"].every((item) => signals.has(item)) &&
    nurses.every((item) => item.locationDevice && item.oneClickAlert) &&
    orders.some(hasServiceTracePoints) &&
    /buildInternetNursingDeviceVerification/.test(server) &&
    /renderDeviceVerification/.test(frontend) &&
    /设备核验与附件/.test(frontend) &&
    /定位设备|设备核验/.test(moduleDoc + launchPlan);
}

function hasRegulatorySubmissionEvidence(policy, frontend, server, moduleDoc, launchPlan) {
  const submission = policy.regulatorySubmission || fallbackPolicy().regulatorySubmission;
  const fields = new Set(submission.mappedFields || []);
  return submission.version === "internet-nursing-regulatory-submission-v1" &&
    ["institution", "nurse", "order", "risk", "trace", "settlement", "quality", "adverseEvent"].every((item) => fields.has(item)) &&
    submission.pressureTest?.status === "passed" &&
    Array.isArray(submission.signoffs) &&
    submission.signoffs.length >= 3 &&
    /buildInternetNursingRegulatorySubmission/.test(server) &&
    /renderRegulatorySubmission/.test(frontend) &&
    /监管报送签字压测/.test(frontend) &&
    /监管报送/.test(moduleDoc + launchPlan) &&
    /压测/.test(moduleDoc + launchPlan);
}

function secretReady(value, minLength = 32) {
  const text = String(value || "");
  return text.length >= minLength && !/replace-with|change-me|changeme|demo-|demo_|example|placeholder/i.test(text);
}

function cutoverSignoffReady(name, env = process.env) {
  return /^(1|true|yes|ready|signed|approved)$/i.test(String(env[name] || "").trim());
}

function productionBlockerAction(id) {
  return {
    "node-env": "set NODE_ENV=production before final cutover",
    "storage-engine": "switch STORAGE_ENGINE away from json for production runtime",
    "session-secrets": "configure strong SESSION_SECRETS with at least one 32-character secret",
    "gateway-secret": "configure INTEGRATION_GATEWAY_SECRET with a strong production secret",
    "database-url": "configure DATABASE_URL when STORAGE_ENGINE is postgres",
    "identity-adapter": "configure OIDC_ISSUER_URL, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET",
    "audit-retention": "configure AUDIT_EXPORT_PATH or SIEM_ENDPOINT and archive retention permission",
    "site-interface-signoff": "set CUTOVER_SITE_INTERFACE_SIGNOFF after signed site interface joint test",
    "insurance-certificate-signoff": "set CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF after insurance and certificate exchange acceptance",
    "monitoring-signoff": "set CUTOVER_MONITORING_SIGNOFF after monitoring and on-call acceptance",
    "dr-rehearsal-signoff": "set CUTOVER_DR_REHEARSAL_SIGNOFF after disaster recovery rehearsal"
  }[id] || "complete production evidence and rerun release gates";
}

function buildProductionEnvironmentStatus(env = process.env) {
  const storageEngine = String(env.STORAGE_ENGINE || "auto").toLowerCase();
  const sessionSecrets = String(env.SESSION_SECRETS || env.SESSION_SECRET || "").split(",").map((item) => item.trim()).filter(Boolean);
  const checks = [
    { id: "node-env", name: "NODE_ENV=production", passed: env.NODE_ENV === "production", detail: env.NODE_ENV || "missing" },
    { id: "storage-engine", name: "production storage engine", passed: storageEngine !== "json", detail: storageEngine },
    { id: "session-secrets", name: "session secret quality", passed: sessionSecrets.length > 0 && sessionSecrets.every((item) => secretReady(item)), detail: `${sessionSecrets.length} configured` },
    { id: "gateway-secret", name: "integration gateway secret quality", passed: secretReady(env.INTEGRATION_GATEWAY_SECRET), detail: env.INTEGRATION_GATEWAY_SECRET ? "configured" : "missing" },
    { id: "database-url", name: "database url for postgres", passed: !["postgres", "postgresql"].includes(storageEngine) || Boolean(env.DATABASE_URL), detail: env.DATABASE_URL ? "configured" : "not required" },
    { id: "identity-adapter", name: "government identity adapter", passed: Boolean(env.OIDC_ISSUER_URL && env.OIDC_CLIENT_ID && env.OIDC_CLIENT_SECRET), detail: env.OIDC_ISSUER_URL ? "issuer configured" : "OIDC missing" },
    { id: "audit-retention", name: "audit retention target", passed: Boolean(env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT), detail: env.AUDIT_EXPORT_PATH || env.SIEM_ENDPOINT ? "configured" : "missing" },
    { id: "site-interface-signoff", name: "site interface joint-test signoff", passed: cutoverSignoffReady("CUTOVER_SITE_INTERFACE_SIGNOFF", env), detail: env.CUTOVER_SITE_INTERFACE_SIGNOFF || "missing" },
    { id: "insurance-certificate-signoff", name: "insurance and certificate exchange signoff", passed: cutoverSignoffReady("CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF", env), detail: env.CUTOVER_INSURANCE_CERTIFICATE_SIGNOFF || "missing" },
    { id: "monitoring-signoff", name: "monitoring and on-call signoff", passed: cutoverSignoffReady("CUTOVER_MONITORING_SIGNOFF", env), detail: env.CUTOVER_MONITORING_SIGNOFF || "missing" },
    { id: "dr-rehearsal-signoff", name: "disaster recovery rehearsal signoff", passed: cutoverSignoffReady("CUTOVER_DR_REHEARSAL_SIGNOFF", env), detail: env.CUTOVER_DR_REHEARSAL_SIGNOFF || "missing" }
  ];
  return {
    profile: env.NODE_ENV || "development",
    storageEngine,
    passed: checks.every((item) => item.passed),
    checks
  };
}

function buildInternetNursingCutoverPack(policy, env = process.env) {
  const production = policy.productionIntegration || fallbackPolicy().productionIntegration;
  const payment = policy.paymentIntegration || fallbackPolicy().paymentIntegration;
  const device = policy.deviceVerification || fallbackPolicy().deviceVerification;
  const submission = policy.regulatorySubmission || fallbackPolicy().regulatorySubmission;
  const productionEnvironment = buildProductionEnvironmentStatus(env);
  const tracks = [
    {
      id: "nursing-cutover-message-signature",
      owner: "hospital-nursing-it",
      evidence: ["message gateway signoff", "signature storage signoff", production.version],
      ready: production.messageGateway?.status === "contract-ready" && production.signatureStorage?.status === "contract-ready",
      blockingUntil: "signed SMS, hospital message, in-app fallback, and electronic signature storage acceptance"
    },
    {
      id: "nursing-cutover-hospital-connectors",
      owner: "institution-integration",
      evidence: (production.hospitalConnectors || []).map((item) => `${item.system}:${item.route}`),
      ready: (production.hospitalConnectors || []).length >= 3 && (production.hospitalConnectors || []).every((item) => item.status === "mapped" && item.auth),
      blockingUntil: "signed nursing management, EMR, and supervision connector joint-test records"
    },
    {
      id: "nursing-cutover-payment-reconciliation",
      owner: "finance-insurance",
      evidence: payment.modes || [],
      ready: payment.status === "contract-ready" && (payment.modes || []).includes("daily reconciliation"),
      blockingUntil: "signed insurance e-voucher, self-pay, refund, invoice, and T+1 reconciliation acceptance"
    },
    {
      id: "nursing-cutover-device-drill",
      owner: "nursing-operations",
      evidence: device.requiredSignals || [],
      ready: device.status === "contract-ready" && (device.requiredSignals || []).includes("one-click alert"),
      blockingUntil: "signed GPS, location device, service recorder, alert, and photo attachment field drill"
    },
    {
      id: "nursing-cutover-regulatory-pressure-test",
      owner: "health-commission-supervision",
      evidence: [`${submission.submissionCycle}`, `p95=${submission.pressureTest?.p95Ms || "n/a"}ms`, ...(submission.signoffs || [])],
      ready: submission.pressureTest?.status === "passed" && (submission.signoffs || []).length >= 3,
      blockingUntil: "signed monthly and high-risk realtime submission pressure-test record"
    }
  ];
  const productionBlockers = productionEnvironment.checks
    .filter((item) => !item.passed)
    .map((item) => ({
      id: `production-${item.id}`,
      source: item.id,
      name: item.name,
      detail: item.detail,
      requiredAction: productionBlockerAction(item.id)
    }));
  return {
    status: tracks.every((item) => item.ready) ? "ready-for-site-signoff" : "blocked",
    productionReadiness: productionEnvironment.passed ? "production-ready" : "production-blocked",
    productionProfile: productionEnvironment.profile,
    productionBlockers,
    template: "release/templates/production-signoff/README.md",
    auditRetentionEvidence: "release/audit-retention-report.md",
    productionCutoverEvidence: "release/production-cutover-checklist.md",
    tracks
  };
}

function hasCutoverPackEvidence(cutoverPack, moduleDoc, launchPlan) {
  return cutoverPack.status === "ready-for-site-signoff" &&
    cutoverPack.tracks.length >= 5 &&
    cutoverPack.tracks.every((item) => item.ready && item.owner && item.blockingUntil && item.evidence.length > 0) &&
    /production-(ready|blocked)/.test(cutoverPack.productionReadiness || "") &&
    Array.isArray(cutoverPack.productionBlockers) &&
    cutoverPack.productionBlockers.every((item) => item.source && item.name && item.requiredAction) &&
    /release\/templates\/production-signoff\/README\.md/.test(cutoverPack.template) &&
    /release\/audit-retention-report\.md/.test(cutoverPack.auditRetentionEvidence) &&
    /release\/production-cutover-checklist\.md/.test(cutoverPack.productionCutoverEvidence) &&
    /nursing-cutover/.test(moduleDoc + launchPlan);
}

function buildInternetNursingReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const server = options.server ?? readText("server.js");
  const auth = options.auth ?? readText("auth.js");
  const frontend = options.frontend ?? readText("internet-nursing.html") + readText("internet-nursing.js");
  const mobilePreview = options.mobilePreview ?? readText("mobile-preview.html");
  const cutoverDoc = options.cutoverDoc ?? readOptionalText("docs/互联网护理现场割接证据包.md");
  const moduleDoc = options.moduleDoc ?? readText("docs/互联网护理服务模块说明.md");
  const launchPlan = options.launchPlan ?? readText("docs/互联网护理上线与下一步开发计划.md");
  const policy = { ...fallbackPolicy(), ...(data.internetNursingPolicy || {}) };
  policy.notificationGateway = { ...fallbackPolicy().notificationGateway, ...(data.internetNursingPolicy?.notificationGateway || {}) };
  policy.pricingRules = { ...fallbackPolicy().pricingRules, ...(data.internetNursingPolicy?.pricingRules || {}) };
  policy.regulatoryContract = { ...fallbackPolicy().regulatoryContract, ...(data.internetNursingPolicy?.regulatoryContract || {}) };
  policy.productionIntegration = { ...fallbackPolicy().productionIntegration, ...(data.internetNursingPolicy?.productionIntegration || {}) };
  policy.paymentIntegration = { ...fallbackPolicy().paymentIntegration, ...(data.internetNursingPolicy?.paymentIntegration || {}) };
  policy.deviceVerification = { ...fallbackPolicy().deviceVerification, ...(data.internetNursingPolicy?.deviceVerification || {}) };
  policy.regulatorySubmission = { ...fallbackPolicy().regulatorySubmission, ...(data.internetNursingPolicy?.regulatorySubmission || {}) };
  const institutions = mergeById(fallbackInstitutions(), data.internetNursingInstitutions);
  const nurses = mergeById(fallbackNurses(), data.internetNursingNurses);
  const orders = mergeById(fallbackOrders(), data.internetNursingOrders);
  const cutoverPack = buildInternetNursingCutoverPack(policy, options.env || process.env);
  const institutionIds = new Set(institutions.map((item) => item.id));
  const nurseIds = new Set(nurses.map((item) => item.id));
  const checks = [
    { id: "nursing:policy", passed: REQUIRED_POLICY_FIELDS.every((item) => (policy.scope || []).includes(item)), detail: (policy.scope || []).join(", ") },
    { id: "nursing:institutionRegistry", passed: institutions.length >= 2 && institutions.some((item) => item.published) && institutions.every((item) => item.securityLevel && item.emergencyPlan), detail: `${institutions.length} institutions` },
    { id: "nursing:nurseQualification", passed: nurses.length >= 2 && nurses.every(nurseQualified) && nurses.every((item) => item.locationDevice && item.oneClickAlert), detail: `${nurses.filter(nurseQualified).length}/${nurses.length} qualified` },
    { id: "nursing:orders", passed: orders.length >= 3 && orders.every((item) => institutionIds.has(item.institutionId) && (!item.nurseId || nurseIds.has(item.nurseId))), detail: `${orders.length} orders` },
    { id: "nursing:orderEvidence", passed: orders.every((item) => REQUIRED_ORDER_FIELDS.every((field) => Object.hasOwn(item, field))), detail: REQUIRED_ORDER_FIELDS.join(", ") },
    { id: "nursing:riskTrace", passed: orders.some((item) => item.riskLevel === "high") && orders.some((item) => item.locationTrace === "tracking"), detail: "risk queue and location tracking present" },
    { id: "nursing:phaseOneEvidence", passed: orders.some(hasSignedConsentAttachment) && orders.some(hasServiceTracePoints) && /buildInternetNursingConsentAttachment/.test(server) && /appendInternetNursingTracePoint/.test(server) && /consentAttachmentText/.test(frontend) && /locationTraceSummary/.test(frontend) && /电子签名附件|鐢靛瓙绛惧悕闄勪欢/.test(launchPlan) && /轨迹点|杞ㄨ抗鐐?/.test(moduleDoc + launchPlan), detail: "electronic consent attachment and service trace point list are implemented" },
    { id: "nursing:serviceRecordClosure", passed: orders.some(hasNursingRecordEvidence) && /buildInternetNursingServiceRecord/.test(server) && /normalizeInternetNursingAttachments/.test(server) && /notificationReceiptSummary/.test(frontend), detail: "structured nursing record, attachments, exception report, and message receipts are implemented" },
    { id: "nursing:notificationGateway", passed: hasNotificationGateway(policy) && /buildInternetNursingNotificationDeliveries/.test(server) && /appendInternetNursingNotifications/.test(server) && /notificationSummary/.test(frontend) && /消息网关|娑堟伅缃戝叧/.test(moduleDoc + launchPlan), detail: "in-app, SMS, and hospital message gateway delivery evidence is implemented" },
    { id: "nursing:phaseTwoOperations", passed: hasOperationalManagementEvidence(policy, orders, nurses, frontend, server, launchPlan), detail: "dispatch recommendation, scheduling capacity, settlement estimate, satisfaction, complaint, quality inspection, and adverse-event evidence are implemented" },
    { id: "nursing:phaseThreeRegulation", passed: hasRegulatoryExpansionEvidence(policy, institutions, nurses, frontend, server, launchPlan), detail: "admission review, catalog approval, nurse qualification reminders, monthly report, quality score, and regulatory API contract are implemented" },
    { id: "nursing:productionIntegration", passed: hasProductionIntegrationEvidence(policy, orders, frontend, server, moduleDoc, launchPlan), detail: "production message gateway, signature storage, hospital connectors, and fallback evidence are implemented" },
    { id: "nursing:paymentIntegration", passed: hasPaymentIntegrationEvidence(policy, orders, frontend, server, moduleDoc, launchPlan), detail: "medical insurance e-voucher, mobile self-pay, refund, invoice, and reconciliation contracts are implemented" },
    { id: "nursing:deviceVerification", passed: hasDeviceVerificationEvidence(policy, orders, nurses, frontend, server, moduleDoc, launchPlan), detail: "mobile GPS, location device, recorder, one-click alert, photo attachment, and exception escalation evidence are implemented" },
    { id: "nursing:regulatorySubmission", passed: hasRegulatorySubmissionEvidence(policy, frontend, server, moduleDoc, launchPlan), detail: "field mapping, monthly and realtime submission, signoff, and pressure-test evidence are implemented" },
    { id: "nursing:siteCutoverPack", passed: hasCutoverPackEvidence(cutoverPack, `${moduleDoc}\n${cutoverDoc}`, launchPlan), detail: "site cutover signoff pack maps message, signature, connector, payment, device, regulatory, and audit-retention evidence" },
    { id: "nursing:api", passed: /\/api\/internet-nursing\/dashboard/.test(server) && /\/api\/internet-nursing\/orders/.test(server) && /canAccessInternetNursingOrder/.test(server), detail: "dashboard, order creation, action, and role guard present" },
    { id: "nursing:frontend", passed: /nursing-appointment-form/.test(frontend) && /nursing-nurse-queue/.test(frontend) && /nursing-risk-guidance/.test(frontend) && /fetchInternetNursingDashboard/.test(frontend), detail: "citizen, hospital, nurse, and risk guidance work areas present" },
    { id: "nursing:visibleText", passed: !hasCorruptedVisibleText(frontend) && /\u8ba2\u5355/.test(frontend) && /\u63a5\u5355/.test(frontend) && /\u9884\u7ea6\u5df2\u63d0\u4ea4/.test(frontend), detail: "visible Chinese labels and operation feedback are clean" },
    { id: "nursing:mobileWorkflow", passed: /nursing-mobile-workbench/.test(frontend) && /nursing-mobile-appointment/.test(frontend) && /nursing-nurse-mobile/.test(frontend) && /renderMobileAppointmentStatus/.test(frontend) && /renderMobileNurseCards/.test(frontend) && /internet-nursing-mobile/.test(frontend) && /citizenPreviewSrc\(service\)/.test(mobilePreview) && /data-preview-service="nursing"/.test(mobilePreview) && !/internet-nursing\.html\?preview=mobile-nursing/.test(mobilePreview), detail: "citizen appointment and nurse response are available, and the mobile preview stays inside the citizen nursing service page" },
    { id: "nursing:launchControls", passed: /validateInternetNursingAppointment/.test(server) && /normalizeInternetNursingServiceObject/.test(server) && /buildInternetNursingActionMessage/.test(server) && /互联网护理新预约/.test(server) && /renderServiceItemSelect/.test(frontend) && /nursing-service-select/.test(frontend), detail: "catalog validation, citizen anti-tamper controls, and task messages present" },
    { id: "nursing:operationSafety", passed: /assertInternetNursingActionAllowed/.test(server) && /nurse can only operate assigned orders/.test(server) && /nurseActionButtons/.test(frontend) && /showNursingMessage/.test(frontend), detail: "nurse action guard, state-specific buttons, and operator feedback present" },
    { id: "nursing:authNavigation", passed: /"internet-nursing\.html": \["commission", "institution", "citizen", "county"\]/.test(auth) && /username: "nurse"/.test(auth) && /password: "123456"/.test(auth) && /nurseId: "inn-001"/.test(auth) && /\u4ec5\u67e5\u770b/.test(frontend) && /\u9700\u533b\u9662\u6d3e\u5355/.test(frontend), detail: "route access, nurse demo account, and role-scoped actions present" },
    { id: "nursing:moduleDoc", passed: /互联网护理服务模块说明/.test(moduleDoc) && /flowchart TD/.test(moduleDoc) && /nurse \/ 123456/.test(moduleDoc) && /\/api\/internet-nursing\/orders\/:id\/actions/.test(moduleDoc), detail: "module document, workflow diagram, role entry, and API permissions present" },
    { id: "nursing:developedFeatures", passed: /已开发功能清单/.test(launchPlan) && /个人端手机预约/.test(launchPlan) && /医院端管理/.test(launchPlan) && /护士端手机接单/.test(launchPlan) && /监管与上线证据/.test(launchPlan), detail: "developed feature inventory covers citizen, hospital, nurse, and supervision surfaces" },
    { id: "nursing:nextPlan", passed: /上线标准/.test(launchPlan) && /下一步开发计划/.test(launchPlan) && /阶段一：上线联调/.test(launchPlan) && /阶段三：监管扩展/.test(launchPlan), detail: "launch standard and staged roadmap documented" },
    { id: "nursing:releaseScript", passed: Boolean(pkg.scripts?.["internet-nursing:readiness"]), detail: pkg.scripts?.["internet-nursing:readiness"] || "missing" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    policyId: policy.id || "internet-nursing-liaoning-pilot",
    boundaries: REQUIRED_POLICY_FIELDS,
    summary: {
      institutions: institutions.length,
      nurses: nurses.length,
      qualifiedNurses: nurses.filter(nurseQualified).length,
      orders: orders.length,
      highRiskOrders: orders.filter((item) => item.riskLevel === "high").length,
      trackingOrders: orders.filter((item) => item.locationTrace === "tracking").length,
      cutoverTracks: cutoverPack.tracks.length,
      cutoverReadyTracks: cutoverPack.tracks.filter((item) => item.ready).length,
      productionBlockers: cutoverPack.productionBlockers.length
    },
    cutoverPack,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Internet nursing readiness report",
    "",
    `Generated at: ${report.generatedAt}`,
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Summary",
    "",
    `- Institutions: ${report.summary.institutions}`,
    `- Qualified nurses: ${report.summary.qualifiedNurses}/${report.summary.nurses}`,
    `- Orders: ${report.summary.orders}`,
    `- High-risk orders: ${report.summary.highRiskOrders}`,
    `- Tracking orders: ${report.summary.trackingOrders}`,
    `- Cutover tracks: ${report.summary.cutoverReadyTracks}/${report.summary.cutoverTracks}`,
    `- Production readiness: ${report.cutoverPack.productionReadiness}`,
    `- Production blockers: ${report.summary.productionBlockers}`,
    `- Module document: docs/互联网护理服务模块说明.md`,
    "",
    "## Site Cutover Pack",
    "",
    `- Status: ${report.cutoverPack.status}`,
    `- Production readiness: ${report.cutoverPack.productionReadiness}`,
    `- Production profile: ${report.cutoverPack.productionProfile}`,
    `- Template: ${report.cutoverPack.template}`,
    `- Audit retention evidence: ${report.cutoverPack.auditRetentionEvidence}`,
    `- Production cutover evidence: ${report.cutoverPack.productionCutoverEvidence}`,
    "",
    "| Track | Owner | Ready | Blocking until |",
    "| --- | --- | --- | --- |",
    ...report.cutoverPack.tracks.map((item) => `| ${item.id} | ${item.owner} | ${item.ready ? "yes" : "no"} | ${item.blockingUntil.replace(/\|/g, "/")} |`),
    "",
    "## Production Blockers",
    "",
    "| Source | Name | Detail | Required action |",
    "| --- | --- | --- | --- |",
    ...(report.cutoverPack.productionBlockers.length > 0
      ? report.cutoverPack.productionBlockers.map((item) => `| ${item.source} | ${item.name} | ${String(item.detail || "").replace(/\|/g, "/")} | ${item.requiredAction.replace(/\|/g, "/")} |`)
      : ["| none | production ready | configured | continue release signoff |"]),
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`)
  ].join("\n");
}

function writeReport(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, internetNursingReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const report = buildInternetNursingReadinessReport();
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildInternetNursingReadinessReport,
  buildInternetNursingCutoverPack,
  buildProductionEnvironmentStatus,
  renderMarkdown,
  writeReport
};
