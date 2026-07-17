const assert = require("node:assert/strict");
const { createHmac, pbkdf2Sync } = require("node:crypto");
const { once } = require("node:events");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const { signHospitalRequest, stableStringify: stableHospitalStringify } = require("../hospital-connectors");
const { signFinancialCallback, signFinancialRequest, stableStringify: stableFinancialStringify } = require("../financial-gateways");
const { signAlertRequest, stableStringify: stableAlertStringify } = require("../observability-alerting");

async function waitForHealth(baseUrl) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return response.json();
    } catch {
      // Service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("测试服务启动超时");
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

async function login(baseUrl, username, password = "123456") {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password })
  });
}

async function phoneLogin(baseUrl, phone, code = "888888") {
  return api(baseUrl, "/api/auth/phone-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, code })
  });
}

async function phoneCode(baseUrl, phone) {
  return api(baseUrl, "/api/auth/phone-code", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

function passwordHash(password, salt = "test-salt", iterations = 120_000) {
  return `pbkdf2-sha256$${iterations}$${salt}$${pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url")}`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function integrationSignature(payload) {
  return createHmac("sha256", "health-platform-demo-integration-secret").update(stableStringify(payload)).digest("hex");
}

test("API authentication, scoping and governance regression suite", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-test-"));
  const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  fixture.accounts[0].name = "Needs normalization?";
  fixture.authUsers.push({
    id: "u-hashed-test",
    username: "hashed_commission",
    name: "哈希账号",
    role: "commission",
    roleName: "哈希认证测试账号",
    orgCode: "ORG-HEALTH-DL",
    orgName: "大连市卫生健康委",
    orgType: "health_admin",
    dataScope: "测试",
    home: "index.html",
    status: "启用",
    passwordHash: passwordHash("hashed-pass")
  });
  fixture.authUsers.push({
    id: "u-citizen-r2-test",
    username: "citizen_r2",
    name: "\u6f14\u793a\u5c45\u6c11B",
    role: "citizen",
    roleName: "\u4e2a\u4eba\u7aef",
    orgCode: "PERSON-R2",
    orgName: "\u6f14\u793a\u5c45\u6c11B\u5bb6\u5ead",
    orgType: "citizen",
    orgLevel: "\u4e2a\u4eba",
    dataScope: "\u672c\u4eba",
    home: "citizen.html",
    residentId: "r2",
    accountId: "a2",
    status: "\u542f\u7528"
  });
  fixture.smsDeliveryReceipts = [{
    id: "sms-delivery-api-fixture",
    providerMessageId: "provider-sms-api-001",
    clientRequestId: "phone-code-api-001",
    purpose: "resident-phone-code",
    maskedPhone: "138****0000",
    status: "accepted",
    acceptedAt: "2026-07-15T06:00:00.000Z",
    latestEventAt: "2026-07-15T06:00:00.000Z",
    providerCode: "ACCEPTED",
    failureReason: "",
    events: [],
    createdAt: "2026-07-15T06:00:00.000Z",
    updatedAt: "2026-07-15T06:00:00.000Z",
    productionEvidence: false
  }];
  fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(fixture, null, 2), "utf8");

  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  process.env.SMS_DELIVERY_CALLBACK_SECRET = "sms-callback-secret-with-at-least-32-characters";
  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const health = await waitForHealth(baseUrl);
  assert.equal(health.ok, true);
  assert.equal(health.storage.engine, "json");

  await t.test("keeps health, authentication and error response contracts stable", async () => {
    const liveResponse = await fetch(`${baseUrl}/api/live`);
    assert.equal(liveResponse.status, 200);
    const liveBody = await liveResponse.json();
    assert.deepEqual(Object.keys(liveBody).sort(), ["ok", "service"]);
    assert.equal(liveBody.ok, true);
    assert.equal(liveBody.service.name, "chronic-care-platform");

    const healthResponse = await fetch(`${baseUrl}/api/health`);
    assert.match(healthResponse.headers.get("content-type") || "", /^application\/json/);
    const healthBody = await healthResponse.json();
    assert.deepEqual(Object.keys(healthBody).sort(), ["ok", "service", "sessionStore", "storage"]);
    assert.equal(healthBody.service.name, "chronic-care-platform");
    assert.equal(typeof healthBody.service.version, "string");
    assert.equal(typeof healthBody.service.uptimeSeconds, "number");
    assert.equal(typeof healthBody.storage.mode, "string");
    assert.equal(typeof healthBody.storage.jsonFile, "string");
    assert.equal(healthBody.sessionStore.mode, "memory");
    assert.equal(healthBody.sessionStore.topology, "single-host");
    assert.equal(healthBody.sessionStore.durable, false);
    assert.deepEqual(Object.keys(healthBody.sessionStore).sort(), ["available", "centralized", "checkedAt", "crossHost", "crossProcess", "durable", "errorCode", "mode", "topology"]);

    const doctorPage = await fetch(`${baseUrl}/doctor.html`);
    assert.equal(doctorPage.status, 200);
    assert.match(doctorPage.headers.get("content-type") || "", /^text\/html/);
    assert.match(await doctorPage.text(), /doctor-multi-practice-form/);

    const missingStaticPage = await fetch(`${baseUrl}/missing-static-page.html`);
    assert.equal(missingStaticPage.status, 404);
    assert.equal(await missingStaticPage.text(), "Not found");

    const accountLogin = await login(baseUrl, "health");
    assert.equal(typeof accountLogin.body.token, "string");
    assert.equal(accountLogin.body.token.split(".").length, 4);
    assert.equal(typeof accountLogin.body.expiresAt, "string");
    assert.equal(accountLogin.body.user.username, "health");
    assert.equal(accountLogin.body.user.password, undefined);
    assert.equal(accountLogin.body.user.passwordHash, undefined);

    const adapterCenter = await api(baseUrl, "/api/auth/adapters", authorized(accountLogin.body.token));
    assert.equal(adapterCenter.response.status, 200);
    assert.equal(adapterCenter.body.production, false);
    assert.equal(adapterCenter.body.ready, false);
    assert.equal(adapterCenter.body.identity.configured, false);
    assert.equal(adapterCenter.body.sms.configured, false);
    assert.equal(adapterCenter.body.sms.callbackConfigured, true);

    const smsDeliveries = await api(baseUrl, "/api/auth/sms-deliveries", authorized(accountLogin.body.token));
    assert.equal(smsDeliveries.response.status, 200);
    assert.equal(smsDeliveries.body.summary.receipts, 1);
    assert.equal(smsDeliveries.body.receipts[0].providerMessageId, "provider-sms-api-001");
    assert.equal(JSON.stringify(smsDeliveries.body).includes("nonceDigest"), false);

    const callbackPayload = {
      eventId: "sms-event-api-delivered",
      providerMessageId: "provider-sms-api-001",
      status: "delivered",
      occurredAt: new Date().toISOString(),
      providerCode: "DELIVRD"
    };
    const callbackTimestamp = String(Math.floor(Date.now() / 1000));
    const callbackNonce = "sms-api-nonce-001";
    const callbackSignature = createHmac("sha256", process.env.SMS_DELIVERY_CALLBACK_SECRET)
      .update(`${callbackTimestamp}.${callbackNonce}.${stableStringify(callbackPayload)}`)
      .digest("hex");
    const callback = await api(baseUrl, "/api/auth/sms-delivery-callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SMS-Timestamp": callbackTimestamp,
        "X-SMS-Nonce": callbackNonce,
        "X-SMS-Signature": `sha256=${callbackSignature}`
      },
      body: JSON.stringify(callbackPayload)
    });
    assert.equal(callback.response.status, 200);
    assert.equal(callback.body.delivery.status, "delivered");
    assert.equal(callback.body.event.stateApplied, true);
    assert.equal(callback.body.delivery.productionEvidence, false);

    const callbackReplay = await api(baseUrl, "/api/auth/sms-delivery-callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SMS-Timestamp": callbackTimestamp,
        "X-SMS-Nonce": callbackNonce,
        "X-SMS-Signature": callbackSignature
      },
      body: JSON.stringify(callbackPayload)
    });
    assert.equal(callbackReplay.response.status, 200);
    assert.equal(callbackReplay.body.idempotentReplay, true);

    const tamperedCallback = await api(baseUrl, "/api/auth/sms-delivery-callback", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-SMS-Timestamp": callbackTimestamp,
        "X-SMS-Nonce": "sms-api-nonce-002",
        "X-SMS-Signature": callbackSignature
      },
      body: JSON.stringify({ ...callbackPayload, eventId: "sms-event-api-tampered", status: "failed" })
    });
    assert.equal(tamperedCallback.response.status, 401);
    assert.equal(tamperedCallback.body.code, "SMS_CALLBACK_SIGNATURE_MISMATCH");

    const unavailableOidc = await api(baseUrl, "/api/auth/oidc/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "not-a-real-upstream-token" })
    });
    assert.equal(unavailableOidc.response.status, 502);
    assert.equal(unavailableOidc.body.message, "identity provider verification failed");

    const residentPhoneLogin = await phoneLogin(baseUrl, "DEMO-MOBILE-R1");
    assert.equal(residentPhoneLogin.response.status, 200);
    assert.equal(residentPhoneLogin.body.user.role, "citizen");
    assert.equal(residentPhoneLogin.body.user.home, "citizen.html");
    assert.equal(residentPhoneLogin.body.user.residentId, "r1");
    assert.equal(residentPhoneLogin.body.user.password, undefined);

    const deniedAdapterCenter = await api(baseUrl, "/api/auth/adapters", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedAdapterCenter.response.status, 403);
    const deniedSmsDeliveries = await api(baseUrl, "/api/auth/sms-deliveries", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedSmsDeliveries.response.status, 403);

    const sentPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-R1");
    assert.equal(sentPhoneCode.response.status, 200);
    assert.equal(sentPhoneCode.body.ok, true);
    assert.equal(sentPhoneCode.body.channel, "demo-sms");
    assert.equal(sentPhoneCode.body.phone, "DEM****E-R1");
    assert.equal(sentPhoneCode.body.demoCode, "888888");
    assert.equal(sentPhoneCode.body.retryAfterSeconds >= 1, true);
    assert.equal(typeof sentPhoneCode.body.expiresAt, "string");

    const throttledPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-R1");
    assert.equal(throttledPhoneCode.response.status, 429);
    assert.equal(throttledPhoneCode.body.ok, false);
    assert.equal(throttledPhoneCode.body.retryAfterSeconds >= 1, true);

    const issuedCodeLogin = await phoneLogin(baseUrl, "DEMO-MOBILE-R1", sentPhoneCode.body.demoCode);
    assert.equal(issuedCodeLogin.response.status, 200);
    assert.equal(issuedCodeLogin.body.user.role, "citizen");

    const missing = await api(baseUrl, "/api/not-found", authorized(accountLogin.body.token));
    assert.equal(missing.response.status, 404);
    assert.equal(typeof missing.body.error, "string");

    const deniedId = await api(baseUrl, "/api/id", { method: "POST" });
    assert.equal(deniedId.response.status, 401);
    assert.equal(typeof deniedId.body.error, "string");

    const generatedId = await api(baseUrl, "/api/id", authorized(accountLogin.body.token, { method: "POST" }));
    assert.equal(generatedId.response.status, 200);
    assert.equal(typeof generatedId.body.id, "string");
    assert.equal(generatedId.body.id.length > 20, true);

    const metrics = await api(baseUrl, "/api/metrics", authorized(accountLogin.body.token));
    assert.equal(metrics.response.status, 200);
    assert.equal(metrics.body.service.name, "chronic-care-platform");
    assert.equal(metrics.body.http.apiRequests >= 1, true);
    assert.equal(typeof metrics.body.workload.unifiedTasks, "number");
    assert.equal(typeof metrics.body.workload.dataQualityIssues, "number");
    assert.equal(metrics.body.messaging.smsDelivery.receipts, 1);
    assert.equal(metrics.body.messaging.smsDelivery.delivered, 1);
    assert.equal(metrics.body.messaging.smsDelivery.productionReady, false);

    const prometheusResponse = await fetch(`${baseUrl}/api/metrics/prometheus`, authorized(accountLogin.body.token));
    assert.equal(prometheusResponse.status, 200);
    const prometheusBody = await prometheusResponse.text();
    assert.match(prometheusBody, /health_platform_sms_delivery_pending 0/);
    assert.match(prometheusBody, /health_platform_sms_delivery_failed 0/);
    assert.match(prometheusBody, /health_platform_sms_delivery_ignored_events 0/);
    assert.match(prometheusBody, /health_platform_financial_callback_pending 0/);
    assert.match(prometheusBody, /health_platform_financial_callback_exceptions 0/);
    assert.match(prometheusBody, /health_platform_financial_reconciliation_differences 0/);

    const readiness = await api(baseUrl, "/api/system/readiness", authorized(accountLogin.body.token));
    assert.equal(readiness.response.status, 200);
    assert.equal(readiness.body.passed, true);
    assert.equal(readiness.body.p2Collections.researchDatasets >= 2, true);
    assert.equal(readiness.body.checks.some((item) => item.id === "acceptance-evidence" && item.passed), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "security-acceptance" && item.passed), true);
    assert.equal(readiness.body.securityAcceptanceLedger.length >= 4, true);
    assert.equal(readiness.body.checks.some((item) => item.id === "production-deployment-plan" && item.passed), true);
    assert.equal(readiness.body.productionDeploymentPlan.some((item) => item.id === "prod-identity-adapter"), true);
    assert.equal(Array.isArray(readiness.body.productionEnvironment.checks), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "identity-adapter"), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "site-interface-signoff"), true);
    assert.equal(readiness.body.productionEnvironment.checks.some((item) => item.id === "dr-rehearsal-signoff"), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "interface-readiness" && item.passed), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "release-artifact-manifest" && item.passed), true);
    assert.equal(readiness.body.releaseArtifactManifest.summary.artifacts >= 16, true);
    assert.equal(readiness.body.interfaceReadiness.p0Total >= 4, true);
    assert.equal(readiness.body.interfaceReadiness.rows.some((item) => item.id === "if-medical" && item.status === "演示对接完成" && item.externalBlocked), true);
    assert.equal(readiness.body.checks.some((item) => item.id === "audit-chain" && item.passed), true);
    assert.equal(readiness.body.externalDependencies.some((item) => item.id === "identity-source" && item.severity === "high"), true);
    assert.equal(readiness.body.externalDependencies.some((item) => item.id === "institution-systems" && item.nextAction), true);
    assert.equal(readiness.body.externalDependencySummary.total, readiness.body.externalDependencies.length);
    assert.equal(readiness.body.externalDependencySummary.high >= 3, true);

    const healthDashboard = await api(baseUrl, "/api/health-dashboard/summary", authorized(accountLogin.body.token));
    assert.equal(healthDashboard.response.status, 200);
    assert.equal(healthDashboard.body.ok, true);
    assert.equal(healthDashboard.body.applications.length, 8);
    assert.equal(healthDashboard.body.totals.sourceApplications, 7);
    assert.equal(healthDashboard.body.scope.role, "priority-eight-application-portfolio");
    assert.equal(healthDashboard.body.applications.some((item) => item.entry === "health-dashboard.html"), true);
    assert.equal(healthDashboard.body.applications.every((item) => item.functionalBoundary && item.apiRoutes?.length && item.frontendEntry && item.testEvidence?.length && item.acceptanceEvidence?.length), true);
    assert.equal(healthDashboard.body.checks.some((item) => item.id === "dashboard:development-template" && item.passed), true);
    assert.equal(healthDashboard.body.checks.some((item) => item.id === "dashboard:source-boundary" && item.passed), true);
    assert.equal(healthDashboard.body.indicatorCenter.indicators.length, 8);
    assert.equal(healthDashboard.body.indicatorCenter.periodViews.length, 2);
    assert.equal(healthDashboard.body.checks.some((item) => item.id === "dashboard:industry-governance-indicators" && item.passed), true);

    const industryGovernanceIndicators = await api(baseUrl, "/api/health-dashboard/industry-governance-indicators", authorized(accountLogin.body.token));
    assert.equal(industryGovernanceIndicators.response.status, 200);
    assert.equal(industryGovernanceIndicators.body.ok, true);
    assert.equal(industryGovernanceIndicators.body.summary.indicators, 8);
    assert.equal(industryGovernanceIndicators.body.periodViews.length, 2);
    assert.equal(industryGovernanceIndicators.body.indicators.some((item) => item.id === "industry-disease-reporting" && item.sourceSystems.includes("HIS/EMR")), true);
    assert.equal(industryGovernanceIndicators.body.indicators.every((item) => item.reports.length === 2 && item.drilldown.href), true);

    const deniedIndustryGovernanceIndicators = await api(baseUrl, "/api/health-dashboard/industry-governance-indicators", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedIndustryGovernanceIndicators.response.status, 403);

    const publicHealth = await api(baseUrl, "/api/public-health/system", authorized(accountLogin.body.token));
    assert.equal(publicHealth.response.status, 200);
    assert.equal(publicHealth.body.ok, true);
    assert.equal(publicHealth.body.summary.domains, 21);
    assert.equal(publicHealth.body.summary.secondaryIndicators, 125);
    assert.equal(publicHealth.body.summary.tertiaryIndicators, 421);
    assert.equal(publicHealth.body.standardImplementationLedger.length, 21);
    assert.equal(publicHealth.body.standardImplementationBoard.traceabilityReady, true);
    assert.equal(publicHealth.body.standardImplementationBoard.summary.mappingComplete, 21);
    assert.equal(publicHealth.body.institutionScopes.length >= 7, true);
    assert.equal(publicHealth.body.riskQueue.some((item) => item.domain === "突发公共卫生事件管理" && item.commandAction), true);
    assert.equal(publicHealth.body.exchangeTasks.some((item) => item.category === "direct-report"), true);
    assert.equal(publicHealth.body.summary.cutoverDrills >= 4, true);
    assert.equal(publicHealth.body.cutoverDrillBoard.status, "blocked");
    assert.equal(publicHealth.body.summary.productionHandoffs >= 6, true);
    assert.equal(publicHealth.body.productionHandoffBoard.status, "blocked");
    assert.equal(publicHealth.body.productionHandoffBoard.summary.releaseArtifacts >= 8, true);
    assert.equal(publicHealth.body.highlights.summary.capabilities, 5);
    assert.equal(publicHealth.body.summary.highlightCapabilities, 5);

    const publicHealthHighlights = await api(baseUrl, "/api/public-health/highlights", authorized(accountLogin.body.token));
    assert.equal(publicHealthHighlights.response.status, 200);
    assert.equal(publicHealthHighlights.body.ok, true);
    assert.equal(publicHealthHighlights.body.summary.capabilities, 5);
    assert.equal(publicHealthHighlights.body.triggerCenter.rules.length >= 5, true);
    assert.equal(publicHealthHighlights.body.commandCenter.openTasks.length >= 1, true);
    assert.equal(publicHealthHighlights.body.aiCenter.modelCard.humanApprovalRequired, true);

    const publicHealthHighlightSignal = await api(baseUrl, "/api/public-health/highlights/signals", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        id: "phsig-api-regression",
        ruleId: publicHealthHighlights.body.triggerCenter.rules[0].id,
        sourceType: publicHealthHighlights.body.triggerCenter.rules[0].sourceType,
        sourceSystem: "API regression signal source",
        metric: publicHealthHighlights.body.triggerCenter.rules[0].metric,
        value: 9,
        baseline: 2,
        unit: "cases",
        region: "API regression region",
        institution: "API regression institution",
        evidenceRefs: ["PH-HIGHLIGHT-API-001"]
      })
    }));
    assert.equal(publicHealthHighlightSignal.response.status, 201);
    assert.equal(publicHealthHighlightSignal.body.ok, true);
    assert.equal(publicHealthHighlightSignal.body.signal.id, "phsig-api-regression");
    assert.equal(publicHealthHighlightSignal.body.highlights.summary.signals >= publicHealthHighlights.body.summary.signals, true);

    const publicHealthHighlightAlertAction = await api(baseUrl, "/api/public-health/highlights/alerts/phalert-fever-zhongshan/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "dispatch",
        note: "API regression dispatches the public health highlight alert",
        evidenceRefs: ["PH-HIGHLIGHT-API-002"]
      })
    }));
    assert.equal(publicHealthHighlightAlertAction.response.status, 200);
    assert.equal(publicHealthHighlightAlertAction.body.alert.status, "dispatched");
    assert.equal(publicHealthHighlightAlertAction.body.action.action, "dispatch");

    const publicHealthHighlightTaskAction = await api(baseUrl, "/api/public-health/highlights/command-tasks/phcmd-task-fever-investigation/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "accept",
        note: "API regression accepts command task",
        evidenceRefs: ["PH-HIGHLIGHT-API-003"]
      })
    }));
    assert.equal(publicHealthHighlightTaskAction.response.status, 200);
    assert.equal(publicHealthHighlightTaskAction.body.task.status, "in-progress");
    assert.equal(publicHealthHighlightTaskAction.body.action.action, "accept");

    const publicHealthHighlightAiReviewAction = await api(baseUrl, "/api/public-health/highlights/ai-reviews/phai-review-fever-zhongshan/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "approve",
        note: "API regression keeps AI suggestion behind human approval",
        evidenceRefs: ["PH-HIGHLIGHT-API-004"]
      })
    }));
    assert.equal(publicHealthHighlightAiReviewAction.response.status, 200);
    assert.equal(publicHealthHighlightAiReviewAction.body.review.status, "approved");
    assert.equal(publicHealthHighlightAiReviewAction.body.review.approvedBy, accountLogin.body.user.name);

    const publicHealthHighlightEvidenceAction = await api(baseUrl, "/api/public-health/highlights/evidence/phec-audit-chain/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify",
        artifactName: "API regression audit-chain evidence",
        note: "API regression verifies the highlight audit chain"
      })
    }));
    assert.equal(publicHealthHighlightEvidenceAction.response.status, 200);
    assert.equal(publicHealthHighlightEvidenceAction.body.evidence.status, "verified");
    assert.equal(publicHealthHighlightEvidenceAction.body.highlights.evidenceCenter.summary.recorded >= 1, true);

    const publicHealthAction = await api(baseUrl, "/api/public-health/events/phe-infectious-001/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "dispatch",
        note: "API regression dispatch",
        assignedTo: "市疾控流调专班"
      })
    }));
    assert.equal(publicHealthAction.response.status, 200);
    assert.equal(publicHealthAction.body.ok, true);
    assert.equal(publicHealthAction.body.event.status, "已派发");
    assert.equal(publicHealthAction.body.event.assignedTo, "市疾控流调专班");
    assert.equal(publicHealthAction.body.event.actionHistory[0].action, "dispatch");
    assert.equal(publicHealthAction.body.system.summary.eventActions >= 1, true);

    const publicHealthExchangeRun = await api(baseUrl, "/api/public-health/exchange-tasks/phx-lab-surveillance/runs", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        status: "compensated",
        receiptStatus: "accepted-after-retry",
        compensationStatus: "replayed",
        payloadRecords: 4,
        failedRecords: 1,
        nextAction: "API regression exchange receipt"
      })
    }));
    assert.equal(publicHealthExchangeRun.response.status, 200);
    assert.equal(publicHealthExchangeRun.body.ok, true);
    assert.equal(publicHealthExchangeRun.body.run.taskId, "phx-lab-surveillance");
    assert.equal(publicHealthExchangeRun.body.run.compensationStatus, "replayed");
    assert.equal(publicHealthExchangeRun.body.system.summary.exchangeRuns >= 6, true);
    assert.equal(publicHealthExchangeRun.body.system.summary.compensatedExchangeRuns >= 1, true);

    const publicHealthExchangeExceptionAssignment = await api(baseUrl, "/api/public-health/exchange-runs/phxr-maternal-child-001/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-exchange-exception",
        exceptionOwner: "妇幼接口负责人",
        exceptionDueAt: "2026-07-15",
        note: "API regression exchange exception assignment"
      })
    }));
    assert.equal(publicHealthExchangeExceptionAssignment.response.status, 200);
    assert.equal(publicHealthExchangeExceptionAssignment.body.run.exceptionStatus, "assigned");
    assert.equal(publicHealthExchangeExceptionAssignment.body.run.exceptionOwner, "妇幼接口负责人");

    const publicHealthExchangeExceptionEscalation = await api(baseUrl, "/api/public-health/exchange-runs/phxr-maternal-child-001/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "escalate-exchange-exception",
        note: "API regression exchange exception escalation"
      })
    }));
    assert.equal(publicHealthExchangeExceptionEscalation.response.status, 200);
    assert.equal(publicHealthExchangeExceptionEscalation.body.run.exceptionStatus, "escalated");

    const publicHealthExchangeExceptionRejectedResolution = await api(baseUrl, "/api/public-health/exchange-runs/phxr-maternal-child-001/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "resolve-exchange-exception",
        note: "API regression exchange exception resolution without receipt"
      })
    }));
    assert.equal(publicHealthExchangeExceptionRejectedResolution.response.status, 400);
    assert.match(publicHealthExchangeExceptionRejectedResolution.body.message, /compensationReceiptId is required/);

    const publicHealthExchangeExceptionResolution = await api(baseUrl, "/api/public-health/exchange-runs/phxr-maternal-child-001/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "resolve-exchange-exception",
        compensationReceiptId: "PH-MCH-API-RESOLVED-001",
        note: "API regression exchange exception resolution"
      })
    }));
    assert.equal(publicHealthExchangeExceptionResolution.response.status, 200);
    assert.equal(publicHealthExchangeExceptionResolution.body.run.exceptionStatus, "resolved");
    assert.equal(publicHealthExchangeExceptionResolution.body.run.compensationReceiptId, "PH-MCH-API-RESOLVED-001");
    assert.equal(publicHealthExchangeExceptionResolution.body.system.summary.openExchangeExceptions, 0);

    const publicHealthInstitutionTask = await api(baseUrl, "/api/public-health/institution-tasks/phit-hospital/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "site-handoff",
        status: "site-handoff-ready",
        handoffStatus: "handoff-confirmed",
        accountStatus: "account-confirmed",
        openItems: 0,
        note: "API regression institution handoff"
      })
    }));
    assert.equal(publicHealthInstitutionTask.response.status, 200);
    assert.equal(publicHealthInstitutionTask.body.ok, true);
    assert.equal(publicHealthInstitutionTask.body.task.id, "phit-hospital");
    assert.equal(publicHealthInstitutionTask.body.task.actionHistory[0].action, "site-handoff");
    assert.equal(publicHealthInstitutionTask.body.system.summary.institutionTasks >= 7, true);

    const publicHealthOnsiteAcceptance = await api(baseUrl, "/api/public-health/onsite-acceptances/phoa-interface-joint-test/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-signoff",
        status: "signed",
        signoffStatus: "signed",
        note: "API regression onsite signoff"
      })
    }));
    assert.equal(publicHealthOnsiteAcceptance.response.status, 200);
    assert.equal(publicHealthOnsiteAcceptance.body.ok, true);
    assert.equal(publicHealthOnsiteAcceptance.body.acceptance.id, "phoa-interface-joint-test");
    assert.equal(publicHealthOnsiteAcceptance.body.acceptance.signoffStatus, "signed");
    assert.equal(publicHealthOnsiteAcceptance.body.system.summary.onsiteAcceptances >= 6, true);

    const publicHealthCutoverBlocker = await api(baseUrl, "/api/public-health/cutover-blockers/phcb-direct-report-endpoint/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence",
        status: "evidence-recorded",
        evidence: ["直报接口确认单", "回执样例"],
        note: "现场已收集直报接口证据"
      })
    }));
    assert.equal(publicHealthCutoverBlocker.response.status, 200);
    assert.equal(publicHealthCutoverBlocker.body.ok, true);
    assert.equal(publicHealthCutoverBlocker.body.blocker.id, "phcb-direct-report-endpoint");
    assert.equal(publicHealthCutoverBlocker.body.blocker.resolutionStatus, "evidence-recorded");
    assert.equal(publicHealthCutoverBlocker.body.system.summary.cutoverBlockers >= 6, true);
    assert.equal(publicHealthCutoverBlocker.body.system.summary.p0OpenCutoverBlockers >= 1, true);
    assert.equal(publicHealthCutoverBlocker.body.system.cutoverReadiness.releaseGate, "site-evidence-required");

    const publicHealthCutoverReadiness = await api(baseUrl, "/api/public-health/cutover-readiness", authorized(accountLogin.body.token));
    assert.equal(publicHealthCutoverReadiness.response.status, 200);
    assert.equal(publicHealthCutoverReadiness.body.ok, true);
    assert.equal(publicHealthCutoverReadiness.body.summary.total >= 6, true);
    assert.equal(publicHealthCutoverReadiness.body.summary.p0Open >= 1, true);
    assert.equal(publicHealthCutoverReadiness.body.readiness.releaseGate, "site-evidence-required");
    assert.equal(publicHealthCutoverReadiness.body.readiness.nextActions.some((item) => item.assignee && item.siteWindow && item.reminderChannel), true);

    const publicHealthCutoverEvidencePackets = await api(baseUrl, "/api/public-health/cutover-evidence-packets", authorized(accountLogin.body.token));
    assert.equal(publicHealthCutoverEvidencePackets.response.status, 200);
    assert.equal(publicHealthCutoverEvidencePackets.body.ok, true);
    assert.equal(publicHealthCutoverEvidencePackets.body.summary.packets >= 6, true);
    assert.equal(publicHealthCutoverEvidencePackets.body.summary.requiredItems >= 20, true);
    assert.equal(publicHealthCutoverEvidencePackets.body.packets.some((item) => item.id === "phcep-direct-report-endpoint" && item.requiredItems.length >= 3), true);

    const publicHealthCutoverEvidencePacketAction = await api(baseUrl, "/api/public-health/cutover-evidence-packets/phcep-direct-report-endpoint/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence-packet",
        itemId: "phcb-direct-report-endpoint-e1",
        status: "verified",
        artifactName: "API regression evidence receipt",
        attachmentNames: ["receipt.pdf"],
        note: "API regression packet evidence"
      })
    }));
    assert.equal(publicHealthCutoverEvidencePacketAction.response.status, 200);
    assert.equal(publicHealthCutoverEvidencePacketAction.body.ok, true);
    assert.equal(publicHealthCutoverEvidencePacketAction.body.packet.id, "phcep-direct-report-endpoint");
    assert.equal(publicHealthCutoverEvidencePacketAction.body.packet.status, "evidence-recorded");
    assert.equal(publicHealthCutoverEvidencePacketAction.body.packet.requiredItems.some((item) => item.id === "phcb-direct-report-endpoint-e1" && item.status === "verified"), true);
    assert.equal(publicHealthCutoverEvidencePacketAction.body.system.summary.cutoverEvidenceVerifiedItems >= 1, true);

    const publicHealthCutoverEvidencePacketDefaultAction = await api(baseUrl, "/api/public-health/cutover-evidence-packets/phcep-direct-report-endpoint/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthCutoverEvidencePacketDefaultAction.response.status, 200);
    assert.equal(publicHealthCutoverEvidencePacketDefaultAction.body.packet.status, "evidence-recorded");

    const publicHealthCutoverDrills = await api(baseUrl, "/api/public-health/cutover-drills", authorized(accountLogin.body.token));
    assert.equal(publicHealthCutoverDrills.response.status, 200);
    assert.equal(publicHealthCutoverDrills.body.ok, true);
    assert.equal(publicHealthCutoverDrills.body.summary.drills >= 4, true);
    assert.equal(publicHealthCutoverDrills.body.summary.openFindings >= 4, true);
    assert.equal(publicHealthCutoverDrills.body.drills.some((item) => item.id === "phdr-backup-rollback"), true);

    const publicHealthCutoverDrillAction = await api(baseUrl, "/api/public-health/cutover-drills/phdr-backup-rollback/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-drill-finding",
        status: "retest-required",
        severity: "P1",
        goNoGo: "no-go",
        retestStatus: "pending",
        finding: "API regression backup rollback retest finding",
        attachmentNames: ["rollback-retest.pdf"],
        nextAction: "API regression rollback drill retest still blocks launch."
      })
    }));
    assert.equal(publicHealthCutoverDrillAction.response.status, 200);
    assert.equal(publicHealthCutoverDrillAction.body.ok, true);
    assert.equal(publicHealthCutoverDrillAction.body.drill.id, "phdr-backup-rollback");
    assert.equal(publicHealthCutoverDrillAction.body.drill.status, "retest-required");
    assert.equal(publicHealthCutoverDrillAction.body.board.status, "blocked");
    assert.equal(publicHealthCutoverDrillAction.body.system.summary.cutoverDrillOpenFindings >= 5, true);
    assert.equal(publicHealthCutoverDrillAction.body.system.launchGate.productionReady, false);

    const publicHealthCutoverDrillDefaultAction = await api(baseUrl, "/api/public-health/cutover-drills/phdr-backup-rollback/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthCutoverDrillDefaultAction.response.status, 200);
    assert.equal(publicHealthCutoverDrillDefaultAction.body.drill.status, "retest-required");

    const publicHealthProductionHandoffs = await api(baseUrl, "/api/public-health/production-handoffs", authorized(accountLogin.body.token));
    assert.equal(publicHealthProductionHandoffs.response.status, 200);
    assert.equal(publicHealthProductionHandoffs.body.ok, true);
    assert.equal(publicHealthProductionHandoffs.body.summary.handoffs >= 6, true);
    assert.equal(publicHealthProductionHandoffs.body.summary.blockedHandoffs >= 6, true);
    assert.equal(publicHealthProductionHandoffs.body.handoffs.some((item) => item.id === "phhandoff-release"), true);

    const publicHealthProductionHandoffAction = await api(baseUrl, "/api/public-health/production-handoffs/phhandoff-release/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "accept-production-handoff",
        status: "accepted",
        artifactName: "API regression production release pack",
        attachmentNames: ["production-release-pack.pdf"],
        releaseArtifacts: ["public-health-readiness-report.md", "public-health-launch-gate.json"],
        note: "API regression production handoff acceptance"
      })
    }));
    assert.equal(publicHealthProductionHandoffAction.response.status, 200);
    assert.equal(publicHealthProductionHandoffAction.body.ok, true);
    assert.equal(publicHealthProductionHandoffAction.body.handoff.id, "phhandoff-release");
    assert.equal(publicHealthProductionHandoffAction.body.handoff.status, "accepted");
    assert.equal(publicHealthProductionHandoffAction.body.handoff.signoffStatus, "signed");
    assert.equal(publicHealthProductionHandoffAction.body.board.summary.acceptedHandoffs >= 1, true);
    assert.equal(publicHealthProductionHandoffAction.body.board.status, "blocked");
    assert.equal(publicHealthProductionHandoffAction.body.system.summary.productionHandoffAccepted >= 1, true);
    assert.equal(publicHealthProductionHandoffAction.body.system.launchGate.productionReady, false);

    const publicHealthProductionHandoffDefaultAction = await api(baseUrl, "/api/public-health/production-handoffs/phhandoff-release/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthProductionHandoffDefaultAction.response.status, 200);
    assert.equal(publicHealthProductionHandoffDefaultAction.body.handoff.status, "accepted");

    const publicHealthGoLiveObservations = await api(baseUrl, "/api/public-health/go-live-observations", authorized(accountLogin.body.token));
    assert.equal(publicHealthGoLiveObservations.response.status, 200);
    assert.equal(publicHealthGoLiveObservations.body.ok, true);
    assert.equal(publicHealthGoLiveObservations.body.summary.observations >= 6, true);
    assert.equal(publicHealthGoLiveObservations.body.summary.planReady >= 6, true);
    assert.equal(publicHealthGoLiveObservations.body.summary.openCriticalSignals, 0);
    assert.equal(publicHealthGoLiveObservations.body.board.status, "watch-ready");
    assert.equal(publicHealthGoLiveObservations.body.observations.some((item) => item.id === "phgl-live-smoke"), true);

    const publicHealthGoLiveObservationAction = await api(baseUrl, "/api/public-health/go-live-observations/phgl-live-smoke/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-go-live-observation",
        status: "passed",
        signalStatus: "green",
        decision: "continue",
        artifactName: "API regression go-live smoke watch",
        attachmentNames: ["go-live-smoke-watch.png"],
        note: "API regression go-live observation"
      })
    }));
    assert.equal(publicHealthGoLiveObservationAction.response.status, 200);
    assert.equal(publicHealthGoLiveObservationAction.body.ok, true);
    assert.equal(publicHealthGoLiveObservationAction.body.observation.id, "phgl-live-smoke");
    assert.equal(publicHealthGoLiveObservationAction.body.observation.status, "passed");
    assert.equal(publicHealthGoLiveObservationAction.body.observation.signalStatus, "green");
    assert.equal(publicHealthGoLiveObservationAction.body.board.summary.passedObservations >= 1, true);
    assert.equal(publicHealthGoLiveObservationAction.body.board.status, "watch-ready");
    assert.equal(publicHealthGoLiveObservationAction.body.system.summary.goLiveObservationPassed >= 1, true);
    assert.equal(publicHealthGoLiveObservationAction.body.system.launchGate.productionReady, false);

    const publicHealthGoLiveObservationDefaultAction = await api(baseUrl, "/api/public-health/go-live-observations/phgl-live-smoke/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthGoLiveObservationDefaultAction.response.status, 200);
    assert.equal(publicHealthGoLiveObservationDefaultAction.body.observation.status, "monitoring");

    const publicHealthLaunchIncidents = await api(baseUrl, "/api/public-health/launch-incidents", authorized(accountLogin.body.token));
    assert.equal(publicHealthLaunchIncidents.response.status, 200);
    assert.equal(publicHealthLaunchIncidents.body.ok, true);
    assert.equal(publicHealthLaunchIncidents.body.summary.lanes >= 6, true);
    assert.equal(publicHealthLaunchIncidents.body.summary.deskReady >= 6, true);
    assert.equal(publicHealthLaunchIncidents.body.summary.criticalOpenTickets, 0);
    assert.equal(publicHealthLaunchIncidents.body.board.status, "desk-ready");
    assert.equal(publicHealthLaunchIncidents.body.incidents.some((item) => item.id === "phli-api-smoke"), true);

    const publicHealthLaunchIncidentAction = await api(baseUrl, "/api/public-health/launch-incidents/phli-api-smoke/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-launch-incident",
        status: "triaged",
        signalStatus: "amber",
        decision: "observe",
        artifactName: "API regression launch incident desk",
        attachmentNames: ["launch-incident-triage.png"],
        note: "API regression launch incident triage"
      })
    }));
    assert.equal(publicHealthLaunchIncidentAction.response.status, 200);
    assert.equal(publicHealthLaunchIncidentAction.body.ok, true);
    assert.equal(publicHealthLaunchIncidentAction.body.incident.id, "phli-api-smoke");
    assert.equal(publicHealthLaunchIncidentAction.body.incident.status, "triaged");
    assert.equal(publicHealthLaunchIncidentAction.body.incident.signalStatus, "amber");
    assert.equal(publicHealthLaunchIncidentAction.body.board.summary.openTickets >= 1, true);
    assert.equal(publicHealthLaunchIncidentAction.body.board.summary.criticalOpenTickets, 0);
    assert.equal(publicHealthLaunchIncidentAction.body.board.status, "desk-ready");
    assert.equal(publicHealthLaunchIncidentAction.body.system.summary.launchIncidentOpenTickets >= 1, true);
    assert.equal(publicHealthLaunchIncidentAction.body.system.launchGate.productionReady, false);

    const publicHealthLaunchIncidentDefaultAction = await api(baseUrl, "/api/public-health/launch-incidents/phli-api-smoke/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthLaunchIncidentDefaultAction.response.status, 200);
    assert.equal(publicHealthLaunchIncidentDefaultAction.body.incident.status, "triaged");

    const publicHealthLaunchDutyShifts = await api(baseUrl, "/api/public-health/launch-duty-shifts", authorized(accountLogin.body.token));
    assert.equal(publicHealthLaunchDutyShifts.response.status, 200);
    assert.equal(publicHealthLaunchDutyShifts.body.ok, true);
    assert.equal(publicHealthLaunchDutyShifts.body.summary.shifts >= 6, true);
    assert.equal(publicHealthLaunchDutyShifts.body.summary.readyShifts >= 6, true);
    assert.equal(publicHealthLaunchDutyShifts.body.summary.missedHandoffs, 0);
    assert.equal(publicHealthLaunchDutyShifts.body.board.status, "roster-ready");
    assert.equal(publicHealthLaunchDutyShifts.body.shifts.some((item) => item.id === "phlds-release-room"), true);

    const publicHealthLaunchDutyShiftAction = await api(baseUrl, "/api/public-health/launch-duty-shifts/phlds-release-room/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-launch-duty-handoff",
        status: "confirmed",
        signalStatus: "confirmed",
        handoffStatus: "confirmed",
        artifactName: "API regression launch duty handoff",
        attachmentNames: ["launch-duty-handoff.png"],
        note: "API regression launch duty handoff"
      })
    }));
    assert.equal(publicHealthLaunchDutyShiftAction.response.status, 200);
    assert.equal(publicHealthLaunchDutyShiftAction.body.ok, true);
    assert.equal(publicHealthLaunchDutyShiftAction.body.shift.status, "confirmed");
    assert.equal(publicHealthLaunchDutyShiftAction.body.action.status, "confirmed");
    assert.equal(publicHealthLaunchDutyShiftAction.body.board.status, "roster-ready");
    assert.equal(publicHealthLaunchDutyShiftAction.body.system.summary.launchDutyReadyShifts >= 6, true);
    assert.equal(publicHealthLaunchDutyShiftAction.body.system.launchGate.productionReady, false);

    const publicHealthLaunchDutyShiftDefaultAction = await api(baseUrl, "/api/public-health/launch-duty-shifts/phlds-release-room/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthLaunchDutyShiftDefaultAction.response.status, 200);
    assert.equal(publicHealthLaunchDutyShiftDefaultAction.body.shift.status, "confirmed");

    const publicHealthLaunchCommandBriefs = await api(baseUrl, "/api/public-health/launch-command-briefs", authorized(accountLogin.body.token));
    assert.equal(publicHealthLaunchCommandBriefs.response.status, 200);
    assert.equal(publicHealthLaunchCommandBriefs.body.ok, true);
    assert.equal(publicHealthLaunchCommandBriefs.body.summary.briefs >= 5, true);
    assert.equal(publicHealthLaunchCommandBriefs.body.summary.readyBriefs >= 5, true);
    assert.equal(publicHealthLaunchCommandBriefs.body.summary.blockedBriefs, 0);
    assert.equal(publicHealthLaunchCommandBriefs.body.board.status, "briefing-ready");
    assert.equal(publicHealthLaunchCommandBriefs.body.briefs.some((item) => item.id === "phlcb-prelaunch-go-no-go"), true);

    const publicHealthLaunchCommandBriefReceiptBeforePublish = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-t0-launch-start/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "acknowledge-launch-command-brief",
        acknowledgementTarget: "release room",
        note: "Attempting to record a receipt before broadcast."
      })
    }));
    assert.equal(publicHealthLaunchCommandBriefReceiptBeforePublish.response.status, 400);
    assert.match(publicHealthLaunchCommandBriefReceiptBeforePublish.body.message, /must be published before recording a delivery receipt/);

    const publicHealthLaunchCommandBriefAction = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-launch-command-brief",
        status: "published",
        publishStatus: "published",
        decision: "broadcast",
        artifactName: "API regression launch command brief",
        attachmentNames: ["launch-command-brief.pdf"],
        note: "API regression launch command brief"
      })
    }));
    assert.equal(publicHealthLaunchCommandBriefAction.response.status, 200);
    assert.equal(publicHealthLaunchCommandBriefAction.body.ok, true);
    assert.equal(publicHealthLaunchCommandBriefAction.body.brief.status, "published");
    assert.equal(publicHealthLaunchCommandBriefAction.body.action.status, "published");
    assert.equal(publicHealthLaunchCommandBriefAction.body.board.status, "briefing-ready");
    assert.equal(publicHealthLaunchCommandBriefAction.body.system.summary.launchCommandReadyBriefs >= 5, true);
    assert.equal(publicHealthLaunchCommandBriefAction.body.system.launchGate.productionReady, false);

    const publicHealthLaunchCommandBriefUnknownReceipt = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "acknowledge-launch-command-brief",
        acknowledgementTarget: "unknown launch observer",
        note: "Unknown audience must not be accepted."
      })
    }));
    assert.equal(publicHealthLaunchCommandBriefUnknownReceipt.response.status, 400);
    assert.match(publicHealthLaunchCommandBriefUnknownReceipt.body.message, /must be one of the configured brief audiences/);

    const publicHealthLaunchCommandBriefReceipt = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "acknowledge-launch-command-brief",
        acknowledgementTarget: "health commission launch board",
        note: "Launch board receipt confirmed by the command recorder."
      })
    }));
    assert.equal(publicHealthLaunchCommandBriefReceipt.response.status, 200);
    assert.equal(publicHealthLaunchCommandBriefReceipt.body.brief.acknowledgements.some((item) => item.target === "health commission launch board" && item.status === "acknowledged"), true);
    assert.equal(publicHealthLaunchCommandBriefReceipt.body.board.summary.expectedAcknowledgements, 3);
    assert.equal(publicHealthLaunchCommandBriefReceipt.body.board.summary.acknowledgedRecipients, 1);
    assert.equal(publicHealthLaunchCommandBriefReceipt.body.board.summary.pendingAcknowledgements, 2);

    const publicHealthLaunchCommandBriefEscalation = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "escalate-launch-command-brief-receipt",
        acknowledgementTarget: "CDC command owner",
        note: "CDC command owner has not returned the required delivery receipt."
      })
    }));
    assert.equal(publicHealthLaunchCommandBriefEscalation.response.status, 200);
    assert.equal(publicHealthLaunchCommandBriefEscalation.body.brief.acknowledgements.some((item) => item.target === "CDC command owner" && item.status === "escalated"), true);
    assert.equal(publicHealthLaunchCommandBriefEscalation.body.board.summary.escalatedAcknowledgements, 1);

    const publicHealthLaunchCommandBriefDefaultAction = await api(baseUrl, "/api/public-health/launch-command-briefs/phlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(publicHealthLaunchCommandBriefDefaultAction.response.status, 200);
    assert.equal(publicHealthLaunchCommandBriefDefaultAction.body.brief.status, "published");

    const publicHealthSiteEvidenceBridge = await api(baseUrl, "/api/public-health/site-evidence-bridge", authorized(accountLogin.body.token));
    assert.equal(publicHealthSiteEvidenceBridge.response.status, 200);
    assert.equal(publicHealthSiteEvidenceBridge.body.ok, true);
    assert.equal(publicHealthSiteEvidenceBridge.body.summary.links >= 8, true);
    assert.equal(publicHealthSiteEvidenceBridge.body.summary.missingLinks >= 1, true);
    assert.equal(publicHealthSiteEvidenceBridge.body.links.some((item) => item.id === "ph-sle-his-account"), true);

    const publicHealthSiteEvidenceBridgeAction = await api(baseUrl, "/api/public-health/site-evidence-bridge/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        linkId: "ph-sle-his-account",
        status: "verified",
        artifactName: "API regression public health site evidence",
        attachmentNames: ["public-health-site-evidence.pdf"],
        jointTestNo: "PH-SITE-API-001",
        note: "API regression site evidence bridge"
      })
    }));
    assert.equal([200, 201].includes(publicHealthSiteEvidenceBridgeAction.response.status), true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.ok, true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.evidence.templateId, "interface-his-patient-v1");
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.link.id, "ph-sle-his-account");
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.link.verified, true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.bridge.summary.verifiedLinks >= 1, true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.system.summary.siteEvidenceBridgeVerifiedLinks >= 1, true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.system.summary.cutoverEvidenceVerifiedItems >= 2, true);
    assert.equal(publicHealthSiteEvidenceBridgeAction.body.system.launchGate.productionReady, false);

    const publicHealthSiteEvidenceVerificationTasks = await api(baseUrl, "/api/public-health/site-evidence-verification-tasks", authorized(accountLogin.body.token));
    assert.equal(publicHealthSiteEvidenceVerificationTasks.response.status, 200);
    assert.equal(publicHealthSiteEvidenceVerificationTasks.body.ok, true);
    assert.equal(publicHealthSiteEvidenceVerificationTasks.body.summary.tasks >= 9, true);
    assert.equal(publicHealthSiteEvidenceVerificationTasks.body.summary.verifiedTasks, 0);
    assert.equal(publicHealthSiteEvidenceVerificationTasks.body.board.status, "verification-pending");
    assert.equal(publicHealthSiteEvidenceVerificationTasks.body.tasks.some((item) => item.id === "phsevt-his-account"), true);

    const invalidPublicHealthSiteEvidenceVerification = await api(baseUrl, "/api/public-health/site-evidence-verification-tasks/phsevt-direct-report/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-site-evidence",
        status: "verified",
        evidenceId: publicHealthSiteEvidenceBridgeAction.body.evidence.id
      })
    }));
    assert.equal(invalidPublicHealthSiteEvidenceVerification.response.status, 400);
    assert.match(invalidPublicHealthSiteEvidenceVerification.body.message, /template does not match/);

    const publicHealthSiteEvidenceVerificationAction = await api(baseUrl, "/api/public-health/site-evidence-verification-tasks/phsevt-his-account/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-site-evidence",
        status: "verified",
        evidenceId: publicHealthSiteEvidenceBridgeAction.body.evidence.id,
        artifactName: "API regression public health site evidence verification",
        note: "API regression evidence verification task"
      })
    }));
    assert.equal(publicHealthSiteEvidenceVerificationAction.response.status, 200);
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.ok, true);
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.task.status, "verified");
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.task.evidenceId, publicHealthSiteEvidenceBridgeAction.body.evidence.id);
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.board.summary.verifiedTasks >= 1, true);
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.system.summary.siteEvidenceVerificationVerifiedTasks >= 1, true);
    assert.equal(publicHealthSiteEvidenceVerificationAction.body.system.launchGate.productionReady, false);

    const publicHealthStandardImplementationLedger = await api(baseUrl, "/api/public-health/standard-implementation-ledger", authorized(accountLogin.body.token));
    assert.equal(publicHealthStandardImplementationLedger.response.status, 200);
    assert.equal(publicHealthStandardImplementationLedger.body.entries.length, 21);
    assert.equal(publicHealthStandardImplementationLedger.body.board.summary.mappingComplete, 21);
    assert.equal(publicHealthStandardImplementationLedger.body.board.status, "mapping-review-pending");
    assert.equal(publicHealthStandardImplementationLedger.body.standardImplementationEvidenceCandidates.some((item) => item.id === publicHealthSiteEvidenceBridgeAction.body.evidence.id), true);

    const invalidPublicHealthStandardGap = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-standard-gap", status: "gap-recorded", artifactName: "API regression standard gap" })
    }));
    assert.equal(invalidPublicHealthStandardGap.response.status, 400);
    assert.match(invalidPublicHealthStandardGap.body.message, /note is required/);

    const publicHealthStandardImplementationAction = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "review-standard-mapping",
        status: "reviewed",
        artifactName: "API regression standard implementation review",
        note: "API regression review of owner, data collection and interface mapping"
      })
    }));
    assert.equal(publicHealthStandardImplementationAction.response.status, 200);
    assert.equal(publicHealthStandardImplementationAction.body.ok, true);
    assert.equal(publicHealthStandardImplementationAction.body.entry.status, "reviewed");
    assert.equal(publicHealthStandardImplementationAction.body.board.summary.reviewed >= 1, true);
    assert.equal(publicHealthStandardImplementationAction.body.system.launchGate.productionReady, false);

    const publicHealthStandardGap = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-standard-gap",
        status: "gap-recorded",
        gapStatus: "open",
        artifactName: "API regression standard gap",
        note: "API regression records an interface mapping gap for follow-up."
      })
    }));
    assert.equal(publicHealthStandardGap.response.status, 200);
    assert.equal(publicHealthStandardGap.body.entry.status, "gap-recorded");
    assert.equal(publicHealthStandardGap.body.entry.gapStatus, "open");
    assert.equal(publicHealthStandardGap.body.board.summary.gaps >= 1, true);
    assert.equal(publicHealthStandardGap.body.system.launchGate.productionReady, false);

    const invalidPublicHealthStandardRemediation = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-standard-gap-remediation",
        note: "API regression attempts to assign a remediation without accountable delivery fields."
      })
    }));
    assert.equal(invalidPublicHealthStandardRemediation.response.status, 400);
    assert.match(invalidPublicHealthStandardRemediation.body.message, /remediationOwner and remediationDueAt/);

    const publicHealthStandardEscalation = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "escalate-standard-gap",
        status: "escalated",
        gapStatus: "escalated",
        artifactName: "API regression standard gap escalation",
        note: "API regression escalates the unresolved mapping gap to the standards owner."
      })
    }));
    assert.equal(publicHealthStandardEscalation.response.status, 200);
    assert.equal(publicHealthStandardEscalation.body.entry.status, "escalated");
    assert.equal(publicHealthStandardEscalation.body.entry.gapStatus, "escalated");
    assert.equal(publicHealthStandardEscalation.body.system.launchGate.productionReady, false);

    const publicHealthStandardRemediationAssignment = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-standard-gap-remediation",
        remediationOwner: "API regression standards owner",
        remediationDueAt: "2026-07-24",
        artifactName: "API regression standard remediation assignment",
        note: "API regression assigns the escalated mapping gap for remediation."
      })
    }));
    assert.equal(publicHealthStandardRemediationAssignment.response.status, 200);
    assert.equal(publicHealthStandardRemediationAssignment.body.entry.remediationStatus, "assigned");
    assert.equal(publicHealthStandardRemediationAssignment.body.entry.remediationOwner, "API regression standards owner");
    assert.equal(publicHealthStandardRemediationAssignment.body.entry.remediationDueAt, "2026-07-24");
    assert.equal(publicHealthStandardRemediationAssignment.body.board.summary.assignedRemediations >= 1, true);
    assert.equal(publicHealthStandardRemediationAssignment.body.system.launchGate.productionReady, false);

    const publicHealthStandardEvidenceLink = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "link-standard-site-evidence",
        status: "evidence-linked",
        siteEvidenceId: publicHealthSiteEvidenceBridgeAction.body.evidence.id,
        artifactName: "API regression standard evidence link",
        note: "API regression links verified site evidence to the standard implementation row."
      })
    }));
    assert.equal(publicHealthStandardEvidenceLink.response.status, 200);
    assert.equal(publicHealthStandardEvidenceLink.body.entry.status, "evidence-linked");
    assert.equal(publicHealthStandardEvidenceLink.body.entry.siteEvidenceId, publicHealthSiteEvidenceBridgeAction.body.evidence.id);
    assert.equal(publicHealthStandardEvidenceLink.body.system.standardImplementationEvidenceCandidates.some((item) => item.id === publicHealthSiteEvidenceBridgeAction.body.evidence.id), true);
    assert.equal(publicHealthStandardEvidenceLink.body.system.launchGate.productionReady, false);

    const publicHealthStandardRemediationVerification = await api(baseUrl, "/api/public-health/standard-implementation-ledger/phsil-infectious/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-standard-gap-remediation",
        siteEvidenceId: publicHealthSiteEvidenceBridgeAction.body.evidence.id,
        artifactName: "API regression standard remediation verification",
        note: "API regression verifies the remediation against the already verified site evidence."
      })
    }));
    assert.equal(publicHealthStandardRemediationVerification.response.status, 200);
    assert.equal(publicHealthStandardRemediationVerification.body.entry.gapStatus, "verified");
    assert.equal(publicHealthStandardRemediationVerification.body.entry.remediationStatus, "verified");
    assert.equal(publicHealthStandardRemediationVerification.body.board.summary.gaps, 0);
    assert.equal(publicHealthStandardRemediationVerification.body.board.summary.verifiedRemediations >= 1, true);
    assert.equal(publicHealthStandardRemediationVerification.body.system.launchGate.productionReady, false);

    const publicHealthLaunchGate = await api(baseUrl, "/api/public-health/launch-gate", authorized(accountLogin.body.token));
    assert.equal(publicHealthLaunchGate.response.status, 200);
    assert.equal(publicHealthLaunchGate.body.ok, true);
    assert.equal(publicHealthLaunchGate.body.summary.requirements >= 8, true);
    assert.equal(publicHealthLaunchGate.body.summary.blockedRequirements >= 1, true);
    assert.equal(publicHealthLaunchGate.body.summary.approvals >= 6, true);
    assert.equal(publicHealthLaunchGate.body.gate.releaseGate, "site-evidence-required");
    assert.equal(publicHealthLaunchGate.body.gate.productionReady, false);
    assert.equal(publicHealthLaunchGate.body.approvalPreflight.status, "blocked");
    assert.equal(publicHealthLaunchGate.body.approvalPreflight.blockedPrerequisites >= 1, true);

    const publicHealthLaunchGateAction = await api(baseUrl, "/api/public-health/launch-gate/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        approvalId: "phla-health-admin",
        action: "submit-launch-approval",
        status: "submitted",
        artifactName: "API regression launch approval",
        attachmentNames: ["launch-approval.pdf"],
        note: "API regression launch gate approval submitted"
      })
    }));
    assert.equal(publicHealthLaunchGateAction.response.status, 200);
    assert.equal(publicHealthLaunchGateAction.body.ok, true);
    assert.equal(publicHealthLaunchGateAction.body.approval.id, "phla-health-admin");
    assert.equal(publicHealthLaunchGateAction.body.approval.status, "submitted");
    assert.equal(publicHealthLaunchGateAction.body.approval.lastAction.preflightStatus, "blocked");
    assert.equal(publicHealthLaunchGateAction.body.gate.summary.signedApprovals, 0);
    assert.equal(publicHealthLaunchGateAction.body.gate.productionReady, false);

    const publicHealthLaunchGateBlockedApproval = await api(baseUrl, "/api/public-health/launch-gate/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        approvalId: "phla-health-admin",
        action: "approve-launch-approval",
        status: "approved",
        confirmation: "APPROVE PUBLIC HEALTH LAUNCH",
        artifactName: "API regression launch approval",
        attachmentNames: ["launch-approval.pdf"],
        note: "API regression launch gate approval"
      })
    }));
    assert.equal(publicHealthLaunchGateBlockedApproval.response.status, 409);
    assert.match(publicHealthLaunchGateBlockedApproval.body.message, /blocked until all prerequisite launch requirements pass/);

    const publicHealthLaunchGateDefaultAction = await api(baseUrl, "/api/public-health/launch-gate/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ approvalId: "phla-health-admin" })
    }));
    assert.equal(publicHealthLaunchGateDefaultAction.response.status, 200);
    assert.equal(publicHealthLaunchGateDefaultAction.body.approval.status, "submitted");

    const publicHealthAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(accountLogin.body.token));
    assert.equal(publicHealthAudit.response.status, 200);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-event-action" && item.target === "phe-infectious-001"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-exchange-run" && item.target === "phx-lab-surveillance"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-exchange-exception-action" && item.target === "phxr-maternal-child-001"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-institution-task-action" && item.target === "phit-hospital"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-onsite-acceptance" && item.target === "phoa-interface-joint-test"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-blocker-action" && item.target === "phcb-direct-report-endpoint"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-readiness" && item.target === "/api/public-health/cutover-readiness"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-evidence-packets" && item.target === "/api/public-health/cutover-evidence-packets"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-evidence-packet-action" && item.target === "phcep-direct-report-endpoint"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-read" && item.target === "/api/public-health/highlights"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-signal" && item.target === "phsig-api-regression"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-alert-action" && item.target === "phalert-fever-zhongshan"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-command-task-action" && item.target === "phcmd-task-fever-investigation"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-ai-review-action" && item.target === "phai-review-fever-zhongshan"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-highlight-evidence-action" && item.target === "phec-audit-chain"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-drills" && item.target === "/api/public-health/cutover-drills"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-cutover-drill-action" && item.target === "phdr-backup-rollback"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-production-handoffs" && item.target === "/api/public-health/production-handoffs"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-production-handoff-action" && item.target === "phhandoff-release"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-go-live-observations" && item.target === "/api/public-health/go-live-observations"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-go-live-observation-action" && item.target === "phgl-live-smoke"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-incidents" && item.target === "/api/public-health/launch-incidents"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-incident-action" && item.target === "phli-api-smoke"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-duty-shifts" && item.target === "/api/public-health/launch-duty-shifts"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-duty-shift-action" && item.target === "phlds-release-room"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-command-briefs" && item.target === "/api/public-health/launch-command-briefs"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-command-brief-action" && item.target === "phlcb-prelaunch-go-no-go"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-site-evidence-bridge" && item.target === "/api/public-health/site-evidence-bridge"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-site-evidence-bridge-action" && item.target === "ph-sle-his-account"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-site-evidence-verification-tasks" && item.target === "/api/public-health/site-evidence-verification-tasks"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-site-evidence-verification-action" && item.target === "phsevt-his-account"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-standard-implementation-ledger" && item.target === "/api/public-health/standard-implementation-ledger"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-standard-implementation-action" && item.target === "phsil-infectious"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-gate" && item.target === "/api/public-health/launch-gate"), true);
    assert.equal(publicHealthAudit.body.securityEvents.some((item) => item.action === "public-health-launch-gate-action" && item.target === "phla-health-admin"), true);

    const priorityTemplates = await api(baseUrl, "/api/priority-applications/templates", authorized(accountLogin.body.token));
    assert.equal(priorityTemplates.response.status, 200);
    assert.equal(priorityTemplates.body.ok, true);
    assert.equal(priorityTemplates.body.scope.role, "priority-application-development-templates");
    assert.equal(priorityTemplates.body.summary.applications, 8);
    assert.equal(priorityTemplates.body.summary.sourceApplications, 7);
    assert.equal(priorityTemplates.body.templates.some((item) => item.conversationTitle === "医联体转诊与远程会诊平台" && item.apiRoutes.length >= 3), true);
    assert.equal(priorityTemplates.body.templates.some((item) => item.conversationTitle === "卫生健康综合驾驶舱" && item.aggregateApplication), true);
    assert.equal(priorityTemplates.body.checks.every((item) => item.passed), true);

    const processAudit = await api(baseUrl, "/api/process-audit", authorized(accountLogin.body.token));
    assert.equal(processAudit.response.status, 200);
    assert.equal(processAudit.body.ok, true);
    assert.equal(processAudit.body.evidenceDomains.some((item) => item.id === "chronic-care" && item.passed), true);
    assert.equal(processAudit.body.evidenceDomains.some((item) => item.id === "county-consortium" && item.passed), true);

    const serviceAcceptance = await api(baseUrl, "/api/service-acceptance-summary", authorized(accountLogin.body.token));
    assert.equal(serviceAcceptance.response.status, 200);
    assert.equal(serviceAcceptance.body.ok, true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.chronic.openActions.some((item) => item.id === "cst-001"), true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.county.openActions.some((item) => item.id === "cco-001"), true);
    assert.equal(serviceAcceptance.body.serviceAcceptance.chronic.openActions.find((item) => item.id === "cst-001").priority, "high");

    const sitePack = await api(baseUrl, "/api/site-readiness-pack", authorized(accountLogin.body.token));
    assert.equal(sitePack.response.status, 200);
    assert.equal(sitePack.body.ok, true);
    assert.equal(sitePack.body.templates.identity.some((item) => item.field === "sub"), true);
    assert.equal(sitePack.body.templates.signoff.some((item) => item.id === "signoff-cutover-monitoring"), true);

    const siteLaunchEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token));
    assert.equal(siteLaunchEvidence.response.status, 200);
    assert.equal(siteLaunchEvidence.body.ok, true);
    assert.equal(siteLaunchEvidence.body.templates.length > 0, true);
    assert.equal(siteLaunchEvidence.body.summary.missingVerifiedTemplates >= 1, true);
    const evidenceTemplate = siteLaunchEvidence.body.templates[0];
    const invalidVerifiedSiteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        templateId: evidenceTemplate.id,
        status: "verified",
        artifactName: "site evidence without receipt"
      })
    }));
    assert.equal(invalidVerifiedSiteEvidence.response.status, 400);
    assert.match(invalidVerifiedSiteEvidence.body.message, /verified evidence requires/);
    const recordedSiteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        templateId: evidenceTemplate.id,
        status: "verified",
        artifactName: "site joint-test receipt",
        externalSystem: "HIS",
        jointTestNo: "JT-20260702-001",
        attachmentNames: ["sample-request.json", "signed-form.pdf"],
        note: "site owner accepted joint-test evidence"
      })
    }));
    assert.equal(recordedSiteEvidence.response.status, 201);
    assert.equal(recordedSiteEvidence.body.evidence.templateId, evidenceTemplate.id);
    assert.equal(recordedSiteEvidence.body.evidence.status, "verified");
    assert.equal(recordedSiteEvidence.body.siteLaunchEvidence.summary.evidence >= 1, true);
    assert.equal(recordedSiteEvidence.body.siteLaunchEvidence.summary.verifiedTemplates >= 1, true);
    assert.equal(recordedSiteEvidence.body.siteLaunchEvidence.summary.missingVerifiedTemplates < recordedSiteEvidence.body.siteLaunchEvidence.summary.templates, true);

    const templateReadmes = await api(baseUrl, "/api/site-template-readmes", authorized(accountLogin.body.token));
    assert.equal(templateReadmes.response.status, 200);
    assert.equal(templateReadmes.body.ok, true);
    assert.equal(templateReadmes.body.summary.readmes, 4);
    assert.equal(templateReadmes.body.readmes.some((item) => item.file === "release/templates/identity-source-mapping/README.md"), true);
    assert.equal(templateReadmes.body.readmes.every((item) => item.content.includes("Current implementation coverage")), true);

    const siteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token));
    assert.equal(siteEvidence.response.status, 200);
    assert.equal(siteEvidence.body.ok, true);
    assert.equal(siteEvidence.body.templates.some((item) => item.id === "signoff-cutover-institution-interfaces"), true);
    assert.equal(siteEvidence.body.summary.templates >= 20, true);

    const createdSiteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        templateId: "signoff-cutover-institution-interfaces",
        artifactName: "HIS EMR LIS PACS joint-test receipt",
        externalSystem: "Dalian Central Hospital HIS",
        jointTestNo: "JT-API-20260702-001",
        attachmentNames: ["request.json", "response.json", "signed-receipt.pdf"],
        status: "verified",
        note: "API regression site evidence"
      })
    }));
    assert.equal(createdSiteEvidence.response.status, 201);
    assert.equal(createdSiteEvidence.body.evidence.status, "verified");
    assert.equal(createdSiteEvidence.body.evidence.attachmentNames.length, 3);
    assert.equal(createdSiteEvidence.body.siteLaunchEvidence.summary.verified >= 1, true);
    assert.equal(createdSiteEvidence.body.siteLaunchEvidence.state, "evidence-verification-in-progress");

    const refreshedSiteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(accountLogin.body.token));
    assert.equal(refreshedSiteEvidence.body.evidence.some((item) => item.jointTestNo === "JT-API-20260702-001"), true);
    const hospitalForSiteEvidence = await login(baseUrl, "hospital");
    const deniedSiteEvidence = await api(baseUrl, "/api/site-launch-evidence", authorized(hospitalForSiteEvidence.body.token, {
      method: "POST",
      body: JSON.stringify({ templateId: "signoff-cutover-monitoring", artifactName: "forbidden" })
    }));
    assert.equal(deniedSiteEvidence.response.status, 403);

    const releaseReport = await api(baseUrl, "/api/release-report", authorized(accountLogin.body.token));
    assert.equal(releaseReport.response.status, 200);
    assert.equal(releaseReport.body.ok, true, JSON.stringify(releaseReport.body.checks.filter((item) => !item.passed && item.severity !== "warn")));
    assert.equal(releaseReport.body.checks.some((item) => item.name === "sitePack:readiness" && item.passed), true);
    assert.equal(releaseReport.body.checks.some((item) => item.name === "phase2Catalog:readiness" && item.passed), true);
    assert.equal(releaseReport.body.siteReadinessPack.templates.signoff.some((item) => item.id === "signoff-cutover-monitoring"), true);

    const cutoverChecklist = await api(baseUrl, "/api/production-cutover-checklist", authorized(accountLogin.body.token));
    assert.equal(cutoverChecklist.response.status, 200);
    assert.equal(cutoverChecklist.body.ok, false);
    assert.equal(cutoverChecklist.body.summary.blocked >= 1, true);
    assert.equal(cutoverChecklist.body.checklist.some((item) => item.id === "cutover-monitoring"), true);

    const releaseManifest = await api(baseUrl, "/api/release-artifact-manifest", authorized(accountLogin.body.token));
    assert.equal(releaseManifest.response.status, 200);
    assert.equal(releaseManifest.body.ok, true);
    assert.equal(releaseManifest.body.artifacts.some((item) => item.id === "release-artifact-manifest"), true);
    assert.equal(releaseManifest.body.templateReadmes.some((item) => item.file === "release/templates/production-signoff/README.md"), true);

    const capabilityMap = await api(baseUrl, "/api/platform/capability-map", authorized(accountLogin.body.token));
    assert.equal(capabilityMap.response.status, 200);
    assert.equal(capabilityMap.body.ok, true);
    assert.equal(capabilityMap.body.summary.releaseArtifacts >= 68, true);
    assert.equal(capabilityMap.body.summary.packageScripts >= 90, true);
    assert.equal(capabilityMap.body.summary.dataCollections >= 200, true);
    assert.equal(capabilityMap.body.summary.openRisks >= 1, true);
    assert.equal(Array.isArray(capabilityMap.body.riskRegister.items), true);
    assert.equal(capabilityMap.body.domains.some((item) => item.id === "emergency"), true);
    assert.equal(capabilityMap.body.artifacts.some((item) => item.id === "release-artifact-manifest"), true);

    const capabilityMapMarkdown = await fetch(`${baseUrl}/api/platform/capability-map?format=markdown`, authorized(accountLogin.body.token));
    assert.equal(capabilityMapMarkdown.status, 200);
    const capabilityMapMarkdownText = await capabilityMapMarkdown.text();
    assert.match(capabilityMapMarkdownText, /Platform capability map/);
    assert.match(capabilityMapMarkdownText, /Release artifacts/);
    assert.match(capabilityMapMarkdownText, /Risk Register/);

    const goLiveSlices = await api(baseUrl, "/api/platform/go-live-slices", authorized(accountLogin.body.token));
    assert.equal(goLiveSlices.response.status, 200);
    assert.equal(goLiveSlices.body.ok, true);
    assert.equal(goLiveSlices.body.summary.openBlockers >= 1, true);
    assert.equal(goLiveSlices.body.summary.serviceOrders >= 8, true);
    assert.equal(goLiveSlices.body.summary.masterDataDomains >= 6, true);
    assert.equal(goLiveSlices.body.blockerRegister.blockers.some((item) => item.severity === "P0"), true);

    const goLiveMarkdown = await fetch(`${baseUrl}/api/platform/go-live-slices?format=markdown`, authorized(accountLogin.body.token));
    assert.equal(goLiveMarkdown.status, 200);
    const goLiveMarkdownText = await goLiveMarkdown.text();
    assert.match(goLiveMarkdownText, /Platform go-live slices readiness/);
    assert.match(goLiveMarkdownText, /Unified Blocker Register/);

    const standardsLedgers = await api(baseUrl, "/api/platform/standards-ledgers", authorized(accountLogin.body.token));
    assert.equal(standardsLedgers.response.status, 200);
    assert.equal(standardsLedgers.body.ok, true);
    assert.equal(standardsLedgers.body.summary.ledgers, 6);
    assert.equal(standardsLedgers.body.summary.acceptanceCriteria >= 24, true);
    assert.equal(standardsLedgers.body.summary.formalGoLiveReady, 0);
    assert.equal(standardsLedgers.body.ledgers.some((item) => item.id === "interface-exchange-register"), true);

    const standardsLedgersMarkdown = await fetch(`${baseUrl}/api/platform/standards-ledgers?format=markdown`, authorized(accountLogin.body.token));
    assert.equal(standardsLedgersMarkdown.status, 200);
    assert.match(await standardsLedgersMarkdown.text(), /六类可验收台账/);

    const standardsLedgerDetail = await api(baseUrl, "/api/platform/standards-ledgers/interface-exchange-register?collection=integrationContracts", authorized(accountLogin.body.token));
    assert.equal(standardsLedgerDetail.response.status, 200);
    assert.equal(standardsLedgerDetail.body.acceptanceItems.length, 4);
    assert.equal(standardsLedgerDetail.body.summary.filteredRows >= 1, true);
    assert.equal(standardsLedgerDetail.body.rows.every((item) => item.collection === "integrationContracts"), true);
    assert.equal(standardsLedgerDetail.body.ledger.formalGoLiveState, "blocked-until-onsite-evidence");

    const standardsLedgerDetailMarkdown = await fetch(`${baseUrl}/api/platform/standards-ledgers/interface-exchange-register?collection=integrationContracts&format=markdown`, authorized(accountLogin.body.token));
    assert.equal(standardsLedgerDetailMarkdown.status, 200);
    assert.match(await standardsLedgerDetailMarkdown.text(), /接口与交换服务台账/);

    const unknownStandardsLedger = await api(baseUrl, "/api/platform/standards-ledgers/unknown-register", authorized(accountLogin.body.token));
    assert.equal(unknownStandardsLedger.response.status, 404);

    const blockerRegister = await api(baseUrl, "/api/platform/blocker-register", authorized(accountLogin.body.token));
    assert.equal(blockerRegister.response.status, 200);
    assert.equal(blockerRegister.body.summary.open >= 1, true);

    const serviceOrderCenter = await api(baseUrl, "/api/platform/service-order-center", authorized(accountLogin.body.token));
    assert.equal(serviceOrderCenter.response.status, 200);
    assert.equal(serviceOrderCenter.body.summary.serviceTypes >= 4, true);

    const masterDataDirectory = await api(baseUrl, "/api/data-governance/master-data", authorized(accountLogin.body.token));
    assert.equal(masterDataDirectory.response.status, 200);
    assert.equal(masterDataDirectory.body.summary.domains >= 6, true);

    const managementFunctions = await api(baseUrl, "/api/interoperability/management-functions", authorized(accountLogin.body.token));
    assert.equal(managementFunctions.response.status, 200);
    assert.equal(managementFunctions.body.ok, true);
    assert.equal(managementFunctions.body.summary.total >= 6, true);
    assert.equal(managementFunctions.body.functions.some((item) => item.id === "mgmt-medical-quality" && item.ready), true);
    assert.equal(managementFunctions.body.functions.some((item) => item.id === "mgmt-public-health" && item.sourceSystems.length >= 4), true);

    const phase2Catalog = await api(baseUrl, "/api/phase2/catalog", authorized(accountLogin.body.token));
    assert.equal(phase2Catalog.response.status, 200);
    assert.equal(phase2Catalog.body.ok, true);
    assert.equal(phase2Catalog.body.summary.tablesMapped, 216);
    assert.equal(phase2Catalog.body.summary.serviceCatalogs >= 12, true);
    assert.equal(phase2Catalog.body.dataCatalogs.some((item) => item.id === "p2dc-lab-imaging-recognition"), true);
    assert.equal(phase2Catalog.body.serviceCatalogs.some((item) => item.id === "p2svc-family-doctor-contract"), true);
    assert.equal(phase2Catalog.body.checks.some((item) => item.id === "phase2Catalog:216TableMapping" && item.passed), true);

    const productionDatabaseCutoverCenter = await api(baseUrl, "/api/production-database/cutover-center", authorized(accountLogin.body.token));
    assert.equal(productionDatabaseCutoverCenter.response.status, 200);
    assert.equal(productionDatabaseCutoverCenter.body.ok, true);
    assert.equal(productionDatabaseCutoverCenter.body.center.summary.migrationBatches, 4);
    assert.equal(productionDatabaseCutoverCenter.body.center.summary.productionReadyRuns, 0);
    assert.equal(productionDatabaseCutoverCenter.body.center.migrationBatches.some((item) => item.domain === "lab-report"), true);

    const deniedProductionDatabaseCutoverCenter = await api(baseUrl, "/api/production-database/cutover-center", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedProductionDatabaseCutoverCenter.response.status, 403);

    const shadowReconciliation = await api(baseUrl, "/api/production-database/shadow-reconciliation", authorized(accountLogin.body.token));
    assert.equal(shadowReconciliation.response.status, 200);
    assert.equal(shadowReconciliation.body.productionPrimary, false);
    assert.equal(shadowReconciliation.body.configured, false);
    assert.equal(shadowReconciliation.body.report, null);
    assert.equal(shadowReconciliation.body.cases, null);
    const deniedShadowReconciliation = await api(baseUrl, "/api/production-database/shadow-reconciliation", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedShadowReconciliation.response.status, 403);

    const reconciliationHistory = await api(baseUrl, "/api/production-database/shadow-reconciliations?limit=10", authorized(accountLogin.body.token));
    assert.equal(reconciliationHistory.response.status, 200);
    assert.equal(reconciliationHistory.body.productionPrimary, false);
    assert.deepEqual(reconciliationHistory.body.runs, []);
    const reconciliationCases = await api(baseUrl, "/api/production-database/reconciliation-cases", authorized(accountLogin.body.token));
    assert.equal(reconciliationCases.response.status, 200);
    assert.equal(reconciliationCases.body.summary.total, 0);
    assert.deepEqual(reconciliationCases.body.cases, []);
    const unavailableReconciliationAction = await api(baseUrl, "/api/production-database/reconciliation-cases/pgrc-missing/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "acknowledge", owner: "database-operations", note: "Review started" })
    }));
    assert.equal(unavailableReconciliationAction.response.status, 409);
    assert.equal(unavailableReconciliationAction.body.code, "RECONCILIATION_CASE_LEDGER_UNAVAILABLE");
    const deniedReconciliationCases = await api(baseUrl, "/api/production-database/reconciliation-cases", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedReconciliationCases.response.status, 403);

    const citizenOperationsCenter = await api(baseUrl, "/api/citizen-operations/center", authorized(accountLogin.body.token));
    assert.equal(citizenOperationsCenter.response.status, 200);
    assert.equal(citizenOperationsCenter.body.ok, true);
    assert.equal(citizenOperationsCenter.body.center.summary.publishedContents >= 3, true);
    assert.equal(citizenOperationsCenter.body.center.summary.activeAgreements >= 3, true);
    assert.equal(citizenOperationsCenter.body.center.summary.orders >= 7, true);
    assert.equal(citizenOperationsCenter.body.center.summary.productionReadyHospitals, 0);

    const deniedCitizenOperationsCenter = await api(baseUrl, "/api/citizen-operations/center", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedCitizenOperationsCenter.response.status, 403);

    const citizenOperationsPublic = await api(baseUrl, "/api/citizen-operations/public", authorized(residentPhoneLogin.body.token));
    assert.equal(citizenOperationsPublic.response.status, 200);
    assert.equal(citizenOperationsPublic.body.contents.every((item) => item.status === "published-demo"), true);
    assert.equal(citizenOperationsPublic.body.agreements.every((item) => item.status === "active-demo"), true);
    assert.equal("identityReviews" in citizenOperationsPublic.body, false);
    assert.equal("blacklist" in citizenOperationsPublic.body, false);
    assert.equal(citizenOperationsPublic.body.hospitalServices.every((item) => !("onsiteBlocker" in item)), true);

    const citizenIdentityReview = await api(baseUrl, "/api/citizen-operations/identity-reviews/cop-identity-r3/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "approve", note: "API demo identity review completed" })
    }));
    assert.equal(citizenIdentityReview.response.status, 200);
    assert.equal(citizenIdentityReview.body.item.status, "approved-demo");
    assert.equal(citizenIdentityReview.body.item.productionReady, false);
    assert.equal(citizenIdentityReview.body.center.summary.pendingIdentityReviews >= 1, true);

    const invalidCitizenBlacklistAction = await api(baseUrl, "/api/citizen-operations/blacklist/cop-block-account-review/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "activate" })
    }));
    assert.equal(invalidCitizenBlacklistAction.response.status, 400);

    const citizenBlacklistAction = await api(baseUrl, "/api/citizen-operations/blacklist/cop-block-account-review/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "activate", note: "API risk review completed for demo activation" })
    }));
    assert.equal(citizenBlacklistAction.response.status, 200);
    assert.equal(citizenBlacklistAction.body.item.status, "active-demo");
    assert.equal(citizenBlacklistAction.body.item.productionReady, false);

    const citizenHospitalEnablement = await api(baseUrl, "/api/citizen-operations/hospitals/cop-hospital-mr5/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "enable-demo", note: "API white-list demonstration only" })
    }));
    assert.equal(citizenHospitalEnablement.response.status, 200);
    assert.equal(citizenHospitalEnablement.body.item.status, "active-demo");
    assert.equal(citizenHospitalEnablement.body.item.productionReady, false);
    assert.equal(citizenHospitalEnablement.body.center.summary.productionReadyHospitals, 0);

    const deniedCitizenOperationsAction = await api(baseUrl, "/api/citizen-operations/contents/cop-content-family-doctor/actions", authorized(residentPhoneLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "withdraw", note: "forbidden resident mutation" })
    }));
    assert.equal(deniedCitizenOperationsAction.response.status, 403);

    const commercialCryptoCenter = await api(baseUrl, "/api/commercial-crypto/center", authorized(accountLogin.body.token));
    assert.equal(commercialCryptoCenter.response.status, 200);
    assert.equal(commercialCryptoCenter.body.ok, true);
    assert.equal(commercialCryptoCenter.body.center.summary.capabilities, 6);
    assert.equal(commercialCryptoCenter.body.center.runtimeProbe.primitives.length, 3);
    assert.equal(commercialCryptoCenter.body.center.summary.productionReady, 0);
    assert.equal(commercialCryptoCenter.body.center.capabilities.every((item) => item.productionReady === false), true);

    const deniedCommercialCryptoCenter = await api(baseUrl, "/api/commercial-crypto/center", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedCommercialCryptoCenter.response.status, 403);

    const invalidCommercialCryptoEvidence = await api(baseUrl, "/api/commercial-crypto/capabilities/cc-gm-tls/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-evidence", note: "reference omitted" })
    }));
    assert.equal(invalidCommercialCryptoEvidence.response.status, 400);

    const commercialCryptoProbe = await api(baseUrl, "/api/commercial-crypto/capabilities/cc-audit-integrity/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "run-runtime-probe", note: "API local OpenSSL compatibility probe" })
    }));
    assert.equal(commercialCryptoProbe.response.status, 200);
    assert.equal(commercialCryptoProbe.body.capability.status, "runtime-probe-recorded");
    assert.equal(commercialCryptoProbe.body.capability.productionReady, false);
    assert.equal(commercialCryptoProbe.body.probeRun.productionEvidence, false);
    assert.equal(commercialCryptoProbe.body.center.summary.probeRuns >= 1, true);
    assert.equal(commercialCryptoProbe.body.center.summary.productionReady, 0);

    const commercialCryptoEvidence = await api(baseUrl, "/api/commercial-crypto/capabilities/cc-signature-service/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-evidence", note: "API supplier evidence queued for onsite validation", evidenceRef: "supplier/signing-server-qualification-demo.pdf" })
    }));
    assert.equal(commercialCryptoEvidence.response.status, 200);
    assert.equal(commercialCryptoEvidence.body.capability.status, "evidence-recorded");
    assert.equal(commercialCryptoEvidence.body.evidencePacket.productionEvidence, false);
    assert.equal(commercialCryptoEvidence.body.center.summary.productionReady, 0);

    const commercialCryptoOnsite = await api(baseUrl, "/api/commercial-crypto/capabilities/cc-ca-usbkey/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "request-onsite", note: "API onsite CA and USBKey verification requested" })
    }));
    assert.equal(commercialCryptoOnsite.response.status, 200);
    assert.equal(commercialCryptoOnsite.body.capability.onsiteVerification, "requested");
    assert.equal(commercialCryptoOnsite.body.capability.productionReady, false);

    const deniedCommercialCryptoAction = await api(baseUrl, "/api/commercial-crypto/capabilities/cc-gm-tls/actions", authorized(residentPhoneLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "run-runtime-probe", note: "forbidden resident mutation" })
    }));
    assert.equal(deniedCommercialCryptoAction.response.status, 403);

    const productionDatabaseCutoverRun = await api(baseUrl, "/api/production-database/cutover-runs", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ note: "API four-domain migration sample rehearsal" })
    }));
    assert.equal(productionDatabaseCutoverRun.response.status, 201);
    assert.equal(productionDatabaseCutoverRun.body.run.status, "validated-demo");
    assert.equal(productionDatabaseCutoverRun.body.run.sampleValidations.length, 4);
    assert.equal(productionDatabaseCutoverRun.body.run.sampleValidations.every((item) => item.passed && item.checksum.length === 64), true);
    assert.equal(productionDatabaseCutoverRun.body.run.productionReady, false);

    const productionDatabaseCutoverReview = await api(baseUrl, `/api/production-database/cutover-runs/${encodeURIComponent(productionDatabaseCutoverRun.body.run.id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "review", note: "Commission API review completed" })
    }));
    assert.equal(productionDatabaseCutoverReview.response.status, 200);
    assert.equal(productionDatabaseCutoverReview.body.run.reviewStatus, "reviewed-demo");
    assert.equal(productionDatabaseCutoverReview.body.run.productionReady, false);

    const invalidProductionDatabaseRollback = await api(baseUrl, `/api/production-database/cutover-runs/${encodeURIComponent(productionDatabaseCutoverRun.body.run.id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-rollback", note: "evidence omitted" })
    }));
    assert.equal(invalidProductionDatabaseRollback.response.status, 400);

    const productionDatabaseRollback = await api(baseUrl, `/api/production-database/cutover-runs/${encodeURIComponent(productionDatabaseCutoverRun.body.run.id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-rollback", note: "Rollback evidence checked", evidence: "rollback-checkpoint-manifest.json" })
    }));
    assert.equal(productionDatabaseRollback.response.status, 200);
    assert.equal(productionDatabaseRollback.body.run.rollbackCheckpoint.status, "evidence-recorded-demo");
    assert.equal(productionDatabaseRollback.body.run.productionReady, false);

    const deniedProductionDatabaseCutoverRun = await api(baseUrl, "/api/production-database/cutover-runs", authorized(residentPhoneLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ note: "denied resident rehearsal" })
    }));
    assert.equal(deniedProductionDatabaseCutoverRun.response.status, 403);

    const digitalHospitalStandards = await api(baseUrl, "/api/digital-hospital/standards", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalStandards.response.status, 200);
    assert.equal(digitalHospitalStandards.body.ok, true);
    assert.equal(digitalHospitalStandards.body.summary.domains, 6);
    assert.equal(digitalHospitalStandards.body.summary.p0Standards >= 4, true);
    assert.equal(digitalHospitalStandards.body.summary.noPatientPii, true);
    assert.equal(digitalHospitalStandards.body.standards.some((item) => item.id === "dhs-interoperability" && item.sourceCollections.includes("integrationContracts")), true);
    assert.equal(digitalHospitalStandards.body.evidencePackets.every((item) => item.noPatientPii === true), true);
    assert.equal(digitalHospitalStandards.body.riskItems.some((item) => item.severity === "P0" && item.status === "open"), true);
    assert.equal(digitalHospitalStandards.body.checks.some((item) => item.id === "digitalHospitalApi:evidenceBoundary" && item.passed), true);
    assert.equal(digitalHospitalStandards.body.summary.policies >= 18, true);
    assert.equal(digitalHospitalStandards.body.summary.policyControls >= 12, true);
    assert.equal(digitalHospitalStandards.body.policyRegister.some((item) => item.id === "dhp-health-information-plan-14fyp" && item.lifecycleStatus === "historical-plan"), true);
    assert.equal(digitalHospitalStandards.body.controlMatrix.some((item) => item.domain === "安全合规" && item.goLiveCritical), true);

    const digitalHospitalEvaluationCatalog = await api(baseUrl, "/api/digital-hospital/evaluation-catalog", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalEvaluationCatalog.response.status, 200);
    assert.equal(digitalHospitalEvaluationCatalog.body.summary.packs, 4);
    assert.equal(digitalHospitalEvaluationCatalog.body.summary.projects, 70);
    assert.equal(digitalHospitalEvaluationCatalog.body.packs.find((item) => item.id === "emr").projects, 39);

    const digitalHospitalPilotReadiness = await api(baseUrl, "/api/digital-hospital/pilot-readiness", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalPilotReadiness.response.status, 200);
    assert.equal(digitalHospitalPilotReadiness.body.functionalState, "pilot-launch-ready");
    assert.equal(digitalHospitalPilotReadiness.body.formalGoLiveState, "blocked-until-site-evidence-signed");
    assert.equal(digitalHospitalPilotReadiness.body.summary.collectionJobs, 6);

    const digitalHospitalPreAssessment = await api(baseUrl, "/api/digital-hospital/pre-assessments/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "run-preassessment", institutionId: "MR1", institutionName: "大连市中心医院", cycle: "2026-api-pilot", profileId: "profile-tertiary-general-pilot" })
    }));
    assert.equal(digitalHospitalPreAssessment.response.status, 201);
    assert.equal(digitalHospitalPreAssessment.body.assessment.results.length, 4);
    assert.equal(digitalHospitalPreAssessment.body.assessment.formalResult, false);

    const digitalHospitalCollectionValidation = await api(baseUrl, "/api/digital-hospital/collection-jobs/dhcj-his/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "run-validation", sampleSize: 100, validRows: 99, receiptRef: "API-PILOT-HIS-001", note: "运行API受控采集校验", noPatientPii: true })
    }));
    assert.equal(digitalHospitalCollectionValidation.response.status, 200);
    assert.equal(digitalHospitalCollectionValidation.body.job.dataQualityIndex, 0.99);

    const digitalHospitalPolicyRegister = await api(baseUrl, "/api/digital-hospital/policy-register?domain=%E5%AE%89%E5%85%A8%E5%90%88%E8%A7%84&bindingLevel=mandatory", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalPolicyRegister.response.status, 200);
    assert.equal(digitalHospitalPolicyRegister.body.ok, true);
    assert.equal(digitalHospitalPolicyRegister.body.policies.length >= 4, true);
    assert.equal(digitalHospitalPolicyRegister.body.policies.every((item) => item.domains.includes("安全合规") && item.bindingLevel === "mandatory"), true);

    const deniedDigitalHospitalPolicyRegister = await api(baseUrl, "/api/digital-hospital/policy-register", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalPolicyRegister.response.status, 403);

    const invalidDigitalHospitalPolicyReview = await api(baseUrl, "/api/digital-hospital/policy-register/dhp-wst-846-847-2024/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ reviewStatus: "verified-current", reviewNote: "ok", nextReviewAt: "2027-01-31" })
    }));
    assert.equal(invalidDigitalHospitalPolicyReview.response.status, 400);

    const digitalHospitalPolicyReview = await api(baseUrl, "/api/digital-hospital/policy-register/dhp-wst-846-847-2024/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "review-policy",
        reviewStatus: "local-supplement-required",
        reviewNote: "国家标准已核验，等待属地接口补充要求",
        nextReviewAt: "2026-10-31"
      })
    }));
    assert.equal(digitalHospitalPolicyReview.response.status, 200);
    assert.equal(digitalHospitalPolicyReview.body.policy.reviewStatus, "local-supplement-required");
    assert.equal(digitalHospitalPolicyReview.body.policy.nextReviewAt, "2026-10-31");
    assert.equal(digitalHospitalPolicyReview.body.standards.ok, true);

    const digitalHospitalControlMatrix = await api(baseUrl, "/api/digital-hospital/control-matrix?domain=%E4%BA%92%E8%81%94%E4%BA%92%E9%80%9A&blockingOnly=true", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalControlMatrix.response.status, 200);
    assert.equal(digitalHospitalControlMatrix.body.ok, true);
    assert.equal(digitalHospitalControlMatrix.body.summary.controls, 13);
    assert.equal(digitalHospitalControlMatrix.body.controls.length >= 1, true);
    assert.equal(digitalHospitalControlMatrix.body.controls.every((item) => item.domain === "互联互通" && item.blocking), true);
    assert.equal(digitalHospitalControlMatrix.body.checks.every((item) => item.passed), true);

    const deniedDigitalHospitalControlMatrix = await api(baseUrl, "/api/digital-hospital/control-matrix", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalControlMatrix.response.status, 403);

    const invalidDigitalHospitalControlEvidence = await api(baseUrl, "/api/digital-hospital/control-matrix/dhc-interoperability-contract/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence",
        artifactName: "生产接口联调报告",
        evidenceRef: "DH-INT-API-001",
        evidenceLevel: "site",
        noPatientPii: false,
        note: "拒绝包含患者明细的证据"
      })
    }));
    assert.equal(invalidDigitalHospitalControlEvidence.response.status, 400);

    const digitalHospitalControlAssignment = await api(baseUrl, "/api/digital-hospital/control-matrix/dhc-interoperability-contract/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-control",
        assignedTo: "接口联调专班",
        dueAt: "2026-08-15",
        note: "分派生产接口联合验证"
      })
    }));
    assert.equal(digitalHospitalControlAssignment.response.status, 200);
    assert.equal(digitalHospitalControlAssignment.body.control.controlStatus, "in-progress");
    assert.equal(digitalHospitalControlAssignment.body.control.assignedTo, "接口联调专班");

    const digitalHospitalControlEvidence = await api(baseUrl, "/api/digital-hospital/control-matrix/dhc-interoperability-contract/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence",
        artifactName: "生产接口联调报告",
        evidenceRef: "DH-INT-API-001",
        evidenceLevel: "site",
        noPatientPii: true,
        note: "登记现场接口最小化证据"
      })
    }));
    assert.equal(digitalHospitalControlEvidence.response.status, 200);
    assert.equal(digitalHospitalControlEvidence.body.control.controlStatus, "evidence-recorded");
    assert.equal(digitalHospitalControlEvidence.body.control.evidenceCount, 1);

    const duplicateDigitalHospitalControlReviewer = await api(baseUrl, "/api/digital-hospital/control-matrix/dhc-interoperability-contract/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-control",
        decision: "accepted",
        note: "提交人不能复核自己的证据"
      })
    }));
    assert.equal(duplicateDigitalHospitalControlReviewer.response.status, 409);

    const digitalHospitalControlReviewerLogin = await login(baseUrl, "city");
    assert.equal(digitalHospitalControlReviewerLogin.response.status, 200);
    const digitalHospitalControlVerification = await api(baseUrl, "/api/digital-hospital/control-matrix/dhc-interoperability-contract/actions", authorized(digitalHospitalControlReviewerLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-control",
        decision: "accepted",
        note: "市级独立复核现场接口证据通过"
      })
    }));
    assert.equal(digitalHospitalControlVerification.response.status, 200);
    assert.equal(digitalHospitalControlVerification.body.control.controlStatus, "verified");
    assert.equal(digitalHospitalControlVerification.body.control.blocking, false);
    assert.equal(digitalHospitalControlVerification.body.control.verifiedEvidenceCount, 1);
    assert.equal(digitalHospitalControlVerification.body.standards.summary.policyControlsWithEvidence >= 1, true);

    const digitalHospitalSelfAssessmentBoard = await api(baseUrl, "/api/digital-hospital/self-assessments", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalSelfAssessmentBoard.response.status, 200);
    assert.equal(digitalHospitalSelfAssessmentBoard.body.ok, true);
    assert.equal(digitalHospitalSelfAssessmentBoard.body.indicators.length, 12);
    assert.equal(digitalHospitalSelfAssessmentBoard.body.summary.assessments >= 2, true);
    assert.equal(digitalHospitalSelfAssessmentBoard.body.checks.every((item) => item.passed), true);

    const deniedDigitalHospitalSelfAssessment = await api(baseUrl, "/api/digital-hospital/self-assessments", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalSelfAssessment.response.status, 403);

    const digitalHospitalSelfAssessmentHospitalLogin = await login(baseUrl, "hospital");
    assert.equal(digitalHospitalSelfAssessmentHospitalLogin.response.status, 200);
    const digitalHospitalSelfAssessmentHospitalBoard = await api(baseUrl, "/api/digital-hospital/self-assessments", authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token));
    assert.equal(digitalHospitalSelfAssessmentHospitalBoard.response.status, 200);
    assert.equal(digitalHospitalSelfAssessmentHospitalBoard.body.summary.assessments, 1);
    assert.equal(digitalHospitalSelfAssessmentHospitalBoard.body.assessments[0].institutionId, "MR1");

    const digitalHospitalSelfAssessmentCommunityLogin = await login(baseUrl, "community");
    assert.equal(digitalHospitalSelfAssessmentCommunityLogin.response.status, 200);
    const deniedCrossInstitutionSelfAssessment = await api(baseUrl, "/api/digital-hospital/self-assessments/dhsa-mr1-2026-pilot/actions", authorized(digitalHospitalSelfAssessmentCommunityLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "save-draft",
        indicatorId: "dhsi-standard-version",
        answer: "compliant",
        evidenceRefs: ["CROSS-ORG-EVIDENCE"],
        note: "不得跨机构填报。",
        noPatientPii: true
      })
    }));
    assert.equal(deniedCrossInstitutionSelfAssessment.response.status, 403);

    const invalidSelfAssessmentEvidence = await api(baseUrl, "/api/digital-hospital/self-assessments/dhsa-mr1-2026-pilot/actions", authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "save-draft",
        indicatorId: "dhsi-standard-version",
        answer: "compliant",
        evidenceRefs: ["SITE-MR1-11"],
        note: "拒绝未确认最小化边界的证据。",
        noPatientPii: false
      })
    }));
    assert.equal(invalidSelfAssessmentEvidence.response.status, 400);

    let hospitalSelfAssessment = digitalHospitalSelfAssessmentHospitalBoard.body.assessments[0];
    const answeredSelfAssessmentIndicators = new Set((hospitalSelfAssessment.responses || []).map((item) => item.indicatorId));
    for (const indicator of digitalHospitalSelfAssessmentHospitalBoard.body.indicators.filter((item) => !answeredSelfAssessmentIndicators.has(item.id))) {
      const saved = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
        method: "POST",
        body: JSON.stringify({
          action: "save-draft",
          indicatorId: indicator.id,
          answer: "compliant",
          evidenceRefs: [`SITE-MR1-${indicator.id}`],
          note: "登记 API 回归受控证据引用。",
          noPatientPii: true
        })
      }));
      assert.equal(saved.response.status, 200);
      hospitalSelfAssessment = saved.body.assessment;
    }

    const submittedSelfAssessment = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "submit-assessment",
        declarationAccepted: true,
        noPatientPii: true,
        note: "医院确认十二项指标和最小化证据后提交。"
      })
    }));
    assert.equal(submittedSelfAssessment.response.status, 200);
    assert.equal(submittedSelfAssessment.body.assessment.status, "submitted");
    assert.equal(submittedSelfAssessment.body.assessment.declaration.noPatientPii, true);

    const correctionSelfAssessment = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "request-correction",
        indicatorIds: ["dhsi-resilience"],
        dueAt: "2026-08-20",
        note: "补充备份恢复演练回执。"
      })
    }));
    assert.equal(correctionSelfAssessment.response.status, 200);
    assert.equal(correctionSelfAssessment.body.assessment.status, "correction-required");

    const correctedSelfAssessment = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "save-draft",
        indicatorId: "dhsi-resilience",
        answer: "compliant",
        evidenceRefs: ["DR-REHEARSAL-MR1-2026-API"],
        note: "已补充恢复演练受控回执。",
        noPatientPii: true
      })
    }));
    assert.equal(correctedSelfAssessment.response.status, 200);
    assert.equal(correctedSelfAssessment.body.assessment.status, "correction-in-progress");

    const resubmittedSelfAssessment = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "submit-assessment",
        declarationAccepted: true,
        noPatientPii: true,
        note: "补正完成后重新提交。"
      })
    }));
    assert.equal(resubmittedSelfAssessment.response.status, 200);
    assert.equal(resubmittedSelfAssessment.body.assessment.status, "resubmitted");

    const acceptedSelfAssessment = await api(baseUrl, `/api/digital-hospital/self-assessments/${encodeURIComponent(hospitalSelfAssessment.id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "accept-assessment",
        note: "省级初审确认补正证据完整，接受本轮自评。"
      })
    }));
    assert.equal(acceptedSelfAssessment.response.status, 200);
    assert.equal(acceptedSelfAssessment.body.assessment.status, "accepted");
    assert.equal(acceptedSelfAssessment.body.assessment.review.decision, "accepted");

    const assignedSelfAssessment = await api(baseUrl, "/api/digital-hospital/self-assessments/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "assign-assessment",
        institutionId: "MR5",
        institutionName: "庄河市基层机构",
        cycle: "2027-pilot",
        targetLevel: "基层医疗机构轻量试点",
        assignedTo: "机构信息管理员",
        dueAt: "2027-03-31",
        note: "分派下一评价周期自评任务。"
      })
    }));
    assert.equal(assignedSelfAssessment.response.status, 201);
    assert.equal(assignedSelfAssessment.body.assessment.status, "assigned");

    const deniedInstitutionAssignment = await api(baseUrl, "/api/digital-hospital/self-assessments/actions", authorized(digitalHospitalSelfAssessmentHospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "assign-assessment" })
    }));
    assert.equal(deniedInstitutionAssignment.response.status, 403);

    const deniedDigitalHospitalStandards = await api(baseUrl, "/api/digital-hospital/standards", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalStandards.response.status, 403);

    const digitalHospitalLaunch = await api(baseUrl, "/api/digital-hospital/launch-readiness", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalLaunch.response.status, 200);
    assert.equal(digitalHospitalLaunch.body.ok, true);
    assert.equal(digitalHospitalLaunch.body.launchGate.pilotLaunchReady, true);
    assert.equal(digitalHospitalLaunch.body.launchGate.formalProductionReady, false);
    assert.equal(digitalHospitalLaunch.body.summary.p0Blocking, 0);
    assert.equal(digitalHospitalLaunch.body.summary.formalBlockers >= 3, true);
    assert.equal(digitalHospitalLaunch.body.summary.productionEvidencePackets >= 4, true);
    assert.equal(digitalHospitalLaunch.body.summary.productionEvidenceItems >= 12, true);
    assert.equal(digitalHospitalLaunch.body.summary.productionEvidenceMissing >= 12, true);
    assert.equal(digitalHospitalLaunch.body.summary.launchCommandBriefs >= 5, true);
    assert.equal(digitalHospitalLaunch.body.summary.launchCommandBriefsReady, digitalHospitalLaunch.body.summary.launchCommandBriefs);
    assert.equal(digitalHospitalLaunch.body.summary.formalCutoverApprovals, 4);
    assert.equal(digitalHospitalLaunch.body.summary.formalCutoverApprovalsReady, 0);
    assert.equal(digitalHospitalLaunch.body.requirements.some((item) => item.id === "dhlr-site-interface-signoff" && item.siteRequired), true);
    assert.equal(digitalHospitalLaunch.body.checks.some((item) => item.id === "digitalHospitalLaunch:p0Ready" && item.passed), true);
    assert.equal(digitalHospitalLaunch.body.checks.some((item) => item.id === "digitalHospitalLaunch:productionEvidence" && item.passed), true);
    assert.equal(digitalHospitalLaunch.body.checks.some((item) => item.id === "digitalHospitalLaunch:commandBriefs" && item.passed), true);
    assert.equal(digitalHospitalLaunch.body.checks.some((item) => item.id === "digitalHospitalLaunch:formalApprovals" && !item.passed), true);

    const deniedDigitalHospitalLaunch = await api(baseUrl, "/api/digital-hospital/launch-readiness", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalLaunch.response.status, 403);

    const digitalHospitalProductionEvidence = await api(baseUrl, "/api/digital-hospital/production-evidence-packets", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalProductionEvidence.response.status, 200);
    assert.equal(digitalHospitalProductionEvidence.body.ok, true);
    assert.equal(digitalHospitalProductionEvidence.body.summary.packets >= 4, true);
    assert.equal(digitalHospitalProductionEvidence.body.summary.requiredItems >= 12, true);
    assert.equal(digitalHospitalProductionEvidence.body.packets.some((item) => item.id === "dhpep-specialty-casebook" && item.requiredItems.length >= 2), true);

    const deniedDigitalHospitalProductionEvidence = await api(baseUrl, "/api/digital-hospital/production-evidence-packets", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalProductionEvidence.response.status, 403);

    const digitalHospitalLaunchCommandBriefs = await api(baseUrl, "/api/digital-hospital/launch-command-briefs", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalLaunchCommandBriefs.response.status, 200);
    assert.equal(digitalHospitalLaunchCommandBriefs.body.ok, true);
    assert.equal(digitalHospitalLaunchCommandBriefs.body.summary.briefs >= 5, true);
    assert.equal(digitalHospitalLaunchCommandBriefs.body.summary.readyBriefs, digitalHospitalLaunchCommandBriefs.body.summary.briefs);
    assert.equal(digitalHospitalLaunchCommandBriefs.body.briefs.some((item) => item.id === "dhlcb-prelaunch-go-no-go"), true);

    const deniedDigitalHospitalLaunchCommandBriefs = await api(baseUrl, "/api/digital-hospital/launch-command-briefs", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalLaunchCommandBriefs.response.status, 403);

    const digitalHospitalFormalCutoverApprovals = await api(baseUrl, "/api/digital-hospital/formal-cutover-approvals", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalFormalCutoverApprovals.response.status, 200);
    assert.equal(digitalHospitalFormalCutoverApprovals.body.ok, true);
    assert.equal(digitalHospitalFormalCutoverApprovals.body.summary.approvals, 4);
    assert.equal(digitalHospitalFormalCutoverApprovals.body.board.eligible, false);
    assert.equal(digitalHospitalFormalCutoverApprovals.body.approvals.some((item) => item.id === "dhfca-health-command"), true);

    const deniedDigitalHospitalFormalCutoverApprovals = await api(baseUrl, "/api/digital-hospital/formal-cutover-approvals", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedDigitalHospitalFormalCutoverApprovals.response.status, 403);

    const blockedDigitalHospitalFormalCutoverApproval = await api(baseUrl, "/api/digital-hospital/formal-cutover-approvals/dhfca-health-command/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        status: "approved",
        signedBy: "API early signer",
        changeTicket: "CHG-DH-EARLY",
        cutoverWindow: "2026-07-31T22:00",
        confirmation: "APPROVE FORMAL CUTOVER"
      })
    }));
    assert.equal(blockedDigitalHospitalFormalCutoverApproval.response.status, 409);
    assert.match(blockedDigitalHospitalFormalCutoverApproval.body.message, /blocked until all site evidence/);

    const digitalHospitalLaunchAction = await api(baseUrl, "/api/digital-hospital/launch-readiness/dhlr-site-interface-signoff/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-site-signoff",
        status: "signed",
        siteSigned: true,
        evidence: ["API regression joint-test signoff"],
        note: "API regression digital hospital site signoff"
      })
    }));
    assert.equal(digitalHospitalLaunchAction.response.status, 200);
    assert.equal(digitalHospitalLaunchAction.body.ok, true);
    assert.equal(digitalHospitalLaunchAction.body.requirement.siteSigned, true);
    assert.equal(digitalHospitalLaunchAction.body.launchReadiness.summary.siteSigned >= 1, true);
    assert.equal(digitalHospitalLaunchAction.body.launchReadiness.launchGate.pilotLaunchReady, true);

    const digitalHospitalProductionEvidenceAction = await api(baseUrl, "/api/digital-hospital/production-evidence-packets/dhpep-specialty-casebook/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-production-evidence",
        status: "verified",
        itemId: "dhpep-specialty-e1",
        artifactName: "API regression expert comment",
        attachmentNames: ["expert-comment.pdf"],
        note: "API regression digital hospital production evidence"
      })
    }));
    assert.equal(digitalHospitalProductionEvidenceAction.response.status, 200);
    assert.equal(digitalHospitalProductionEvidenceAction.body.ok, true);
    assert.equal(digitalHospitalProductionEvidenceAction.body.packet.status, "evidence-recorded");
    assert.equal(digitalHospitalProductionEvidenceAction.body.board.summary.verifiedItems >= 1, true);
    assert.equal(digitalHospitalProductionEvidenceAction.body.launchReadiness.launchGate.formalProductionReady, false);

    const digitalHospitalProductionEvidenceComplete = await api(baseUrl, "/api/digital-hospital/production-evidence-packets/dhpep-specialty-casebook/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "verify-production-evidence",
        status: "verified",
        itemId: "dhpep-specialty-e2",
        artifactName: "API regression appeal decision",
        attachmentNames: ["appeal-decision.pdf"],
        note: "API regression digital hospital production evidence complete"
      })
    }));
    assert.equal(digitalHospitalProductionEvidenceComplete.response.status, 200);
    assert.equal(digitalHospitalProductionEvidenceComplete.body.packet.signoffStatus, "signed");
    assert.equal(digitalHospitalProductionEvidenceComplete.body.launchReadiness.requirements.some((item) => item.id === "dhlr-specialty-casebook" && item.siteSigned === true), true);

    const digitalHospitalLaunchCommandBriefAction = await api(baseUrl, "/api/digital-hospital/launch-command-briefs/dhlcb-prelaunch-go-no-go/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "record-launch-command-brief",
        status: "published",
        artifactName: "API regression launch command brief",
        attachmentNames: ["digital-hospital-command-brief.pdf"],
        note: "API regression digital hospital launch command brief"
      })
    }));
    assert.equal(digitalHospitalLaunchCommandBriefAction.response.status, 200);
    assert.equal(digitalHospitalLaunchCommandBriefAction.body.ok, true);
    assert.equal(digitalHospitalLaunchCommandBriefAction.body.brief.status, "published");
    assert.equal(digitalHospitalLaunchCommandBriefAction.body.board.summary.publishedBriefs >= 1, true);
    assert.equal(digitalHospitalLaunchCommandBriefAction.body.launchReadiness.requirements.some((item) => item.id === "dhlr-command-approval" && item.evidence.includes("digitalHospitalLaunchCommandBriefs")), true);

    const digitalHospitalRemainingEvidence = await api(baseUrl, "/api/digital-hospital/production-evidence-packets", authorized(accountLogin.body.token));
    for (const packet of digitalHospitalRemainingEvidence.body.packets) {
      for (const item of packet.requiredItems.filter((entry) => !/verified|signed|accepted|complete|ready/i.test(String(entry.status || "")))) {
        const verified = await api(baseUrl, `/api/digital-hospital/production-evidence-packets/${encodeURIComponent(packet.id)}/actions`, authorized(accountLogin.body.token, {
          method: "POST",
          body: JSON.stringify({
            action: "verify-production-evidence",
            status: "verified",
            itemId: item.id,
            artifactName: `API formal cutover ${item.id}`,
            attachmentNames: [`${item.id}.pdf`],
            note: "API regression completes formal cutover evidence."
          })
        }));
        assert.equal(verified.response.status, 200);
      }
    }

    const digitalHospitalReadyForApproval = await api(baseUrl, "/api/digital-hospital/launch-readiness", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalReadyForApproval.body.summary.formalBlockers, 0);
    assert.equal(digitalHospitalReadyForApproval.body.summary.productionEvidenceMissing, 0);
    assert.equal(digitalHospitalReadyForApproval.body.formalCutoverApprovalBoard.eligible, true);
    assert.equal(digitalHospitalReadyForApproval.body.launchGate.formalGoLiveState, "awaiting-formal-cutover-approvals");

    const formalApprovals = digitalHospitalReadyForApproval.body.formalCutoverApprovals;
    const firstFormalApproval = await api(baseUrl, `/api/digital-hospital/formal-cutover-approvals/${encodeURIComponent(formalApprovals[0].id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        status: "approved",
        signedBy: "Formal signer 1",
        changeTicket: "CHG-DH-FORMAL-001",
        cutoverWindow: "2026-07-31T22:00",
        confirmation: "APPROVE FORMAL CUTOVER",
        note: "API regression formal cutover approval 1."
      })
    }));
    assert.equal(firstFormalApproval.response.status, 200);

    const duplicateFormalSigner = await api(baseUrl, `/api/digital-hospital/formal-cutover-approvals/${encodeURIComponent(formalApprovals[1].id)}/actions`, authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        status: "approved",
        signedBy: "Formal signer 1",
        changeTicket: "CHG-DH-FORMAL-001",
        cutoverWindow: "2026-07-31T22:00",
        confirmation: "APPROVE FORMAL CUTOVER"
      })
    }));
    assert.equal(duplicateFormalSigner.response.status, 400);
    assert.match(duplicateFormalSigner.body.message, /unique signer/);

    let finalFormalApproval = firstFormalApproval;
    for (let index = 1; index < formalApprovals.length; index += 1) {
      finalFormalApproval = await api(baseUrl, `/api/digital-hospital/formal-cutover-approvals/${encodeURIComponent(formalApprovals[index].id)}/actions`, authorized(accountLogin.body.token, {
        method: "POST",
        body: JSON.stringify({
          status: "approved",
          signedBy: `Formal signer ${index + 1}`,
          changeTicket: "CHG-DH-FORMAL-001",
          cutoverWindow: "2026-07-31T22:00",
          confirmation: "APPROVE FORMAL CUTOVER",
          note: `API regression formal cutover approval ${index + 1}.`
        })
      }));
      assert.equal(finalFormalApproval.response.status, 200);
    }
    assert.equal(finalFormalApproval.body.board.allApproved, true);
    assert.equal(finalFormalApproval.body.board.summary.distinctSigners, 4);
    assert.equal(finalFormalApproval.body.launchReadiness.launchGate.formalProductionReady, true);
    assert.equal(finalFormalApproval.body.launchReadiness.launchGate.formalGoLiveState, "formal-production-ready");

    const digitalHospitalAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(accountLogin.body.token));
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-launch-readiness" && item.target === "/api/digital-hospital/launch-readiness"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-policy-register" && item.target === "/api/digital-hospital/policy-register"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-policy-review" && item.target === "dhp-wst-846-847-2024"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-control-matrix" && item.target === "/api/digital-hospital/control-matrix"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-control-action" && item.target === "dhc-interoperability-contract"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-self-assessment-read" && item.target === "/api/digital-hospital/self-assessments"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-self-assessment-action" && item.target === "dhsa-mr1-2026-pilot"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-launch-requirement-action" && item.target === "dhlr-site-interface-signoff"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-production-evidence-packets" && item.target === "/api/digital-hospital/production-evidence-packets"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-production-evidence-packet-action" && item.target === "dhpep-specialty-casebook"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-launch-command-briefs" && item.target === "/api/digital-hospital/launch-command-briefs"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-launch-command-brief-action" && item.target === "dhlcb-prelaunch-go-no-go"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-formal-cutover-approvals" && item.target === "/api/digital-hospital/formal-cutover-approvals"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-formal-cutover-approval-action" && item.result === "blocked"), true);
    assert.equal(digitalHospitalAudit.body.securityEvents.some((item) => item.action === "digital-hospital-formal-cutover-approval-action" && item.result === "allowed"), true);

    const phase2JointTest = await api(baseUrl, "/api/phase2/joint-test-pilot", authorized(accountLogin.body.token));
    assert.equal(phase2JointTest.response.status, 200);
    assert.equal(phase2JointTest.body.ok, true);
    assert.equal(phase2JointTest.body.summary.institutions >= 3, true);
    assert.equal(phase2JointTest.body.summary.landedTraces >= 6, true);
    assert.equal(phase2JointTest.body.institutions.some((item) => item.role === "tertiary-hospital"), true);
    assert.equal(phase2JointTest.body.samplePayloads.some((item) => item.category === "lab-report" && item.idempotencyKey), true);
    assert.equal(phase2JointTest.body.gatewayTraces.some((item) => item.targetCollection === "healthStatisticsIngestion" && item.signatureVerified), true);
    assert.equal(phase2JointTest.body.checks.some((item) => item.id === "phase2JointTest:gatewayLanding" && item.passed), true);

    const phase2DiseaseReporting = await api(baseUrl, "/api/phase2/disease-reporting", authorized(accountLogin.body.token));
    assert.equal(phase2DiseaseReporting.response.status, 200);
    assert.equal(phase2DiseaseReporting.body.ok, true);
    assert.equal(phase2DiseaseReporting.body.summary.rules >= 4, true);
    assert.equal(phase2DiseaseReporting.body.summary.reportCards >= 4, true);
    assert.equal(phase2DiseaseReporting.body.queue.some((item) => item.diseaseCategory === "infectious" && item.patientCenterStatus), true);
    assert.equal(phase2DiseaseReporting.body.checks.some((item) => item.id === "phase2DiseaseReporting:countyReceipts" && item.passed), true);

    const phase2DiseaseReceipt = await api(baseUrl, "/api/phase2/disease-reporting/reports/p2drq-inf-r3/receipt", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ receiptStatus: "accepted", receiptCode: "API-DR-INF-001", detail: "API test county receipt accepted." })
    }));
    assert.equal(phase2DiseaseReceipt.response.status, 200);
    assert.equal(phase2DiseaseReceipt.body.report.status, "receipt-confirmed");
    assert.equal(phase2DiseaseReceipt.body.receipt.reportId, "p2drq-inf-r3");
    assert.equal(phase2DiseaseReceipt.body.overview.checks.some((item) => item.id === "phase2DiseaseReporting:countyReceipts" && item.passed), true);

    const phase2ClinicalAssist = await api(baseUrl, "/api/phase2/clinical-assist", authorized(accountLogin.body.token));
    assert.equal(phase2ClinicalAssist.response.status, 200);
    assert.equal(phase2ClinicalAssist.body.ok, true);
    assert.equal(phase2ClinicalAssist.body.summary.rules >= 4, true);
    assert.equal(phase2ClinicalAssist.body.summary.alerts >= 4, true);
    assert.equal(phase2ClinicalAssist.body.pluginContracts.some((item) => item.endpoint.includes("/api/phase2/clinical-assist")), true);
    assert.equal(phase2ClinicalAssist.body.checks.some((item) => item.id === "phase2ClinicalAssist:messageReceipts" && item.passed), true);

    const doctorLogin = await login(baseUrl, "doctor");
    const doctorClinicalAssist = await api(baseUrl, "/api/phase2/clinical-assist", authorized(doctorLogin.body.token));
    assert.equal(doctorClinicalAssist.response.status, 200);
    assert.equal(doctorClinicalAssist.body.ok, true);
    assert.equal(doctorClinicalAssist.body.alerts.every((item) => item.doctorId === "doc-liu"), true);
    assert.equal(doctorClinicalAssist.body.alerts.some((item) => item.id === "p2caa-lab-r1"), true);

    const phase2ClinicalReceipt = await api(baseUrl, "/api/phase2/clinical-assist/alerts/p2caa-lab-r1/receipt", authorized(doctorLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ receiptStatus: "received", doctorAction: "accepted-recommendation", actionDetail: "API test doctor accepted duplicate lab reminder.", messageChannel: "doctor-workstation" })
    }));
    assert.equal(phase2ClinicalReceipt.response.status, 200);
    assert.equal(phase2ClinicalReceipt.body.alert.status, "acknowledged");
    assert.equal(phase2ClinicalReceipt.body.receipt.alertId, "p2caa-lab-r1");
    assert.equal(phase2ClinicalReceipt.body.overview.alerts.every((item) => item.doctorId === "doc-liu"), true);

    const phase2ClinicalRuleConfig = await api(baseUrl, "/api/phase2/clinical-assist/rules/p2ca-rule-duplicate-lab/config", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ configStatus: "active", severity: "high", defaultAction: "API test keeps mutual-recognition citation first." })
    }));
    assert.equal(phase2ClinicalRuleConfig.response.status, 200);
    assert.equal(phase2ClinicalRuleConfig.body.rule.id, "p2ca-rule-duplicate-lab");
    assert.equal(phase2ClinicalRuleConfig.body.overview.checks.some((item) => item.id === "phase2ClinicalAssist:ruleConfig" && item.passed), true);

    const phase2FamilyDoctor = await api(baseUrl, "/api/phase2/family-doctor-contracts", authorized(accountLogin.body.token));
    assert.equal(phase2FamilyDoctor.response.status, 200);
    assert.equal(phase2FamilyDoctor.body.ok, true);
    assert.equal(phase2FamilyDoctor.body.summary.templates >= 3, true);
    assert.equal(phase2FamilyDoctor.body.summary.packages >= 4, true);
    assert.equal(phase2FamilyDoctor.body.summary.activeContracts >= 3, true);
    assert.equal(phase2FamilyDoctor.body.checks.some((item) => item.id === "phase2FamilyDoctor:fulfillmentRecords" && item.passed), true);

    const citizenLogin = await login(baseUrl, "citizen");
    const citizenFamilyDoctor = await api(baseUrl, "/api/phase2/family-doctor-contracts", authorized(citizenLogin.body.token));
    assert.equal(citizenFamilyDoctor.response.status, 200);
    assert.equal(citizenFamilyDoctor.body.contracts.every((item) => ["r1", "r4"].includes(item.residentId)), true);

    const familyDoctorApplication = await api(baseUrl, "/api/phase2/family-doctor-contracts/applications", authorized(citizenLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", packageId: "p2fdp-hypertension", teamId: "p2fdtm-qnw", applicationType: "new-contract", note: "API test family doctor application" })
    }));
    assert.equal(familyDoctorApplication.response.status, 201);
    assert.equal(familyDoctorApplication.body.application.reviewStatus, "pending");
    assert.equal(familyDoctorApplication.body.application.reviewInstitutionCode, "MR3");
    const familyDoctorServiceOrders = await api(baseUrl, "/api/service-orders?residentId=r1&serviceType=family-doctor", authorized(citizenLogin.body.token));
    assert.equal(familyDoctorServiceOrders.response.status, 200);
    assert.equal(familyDoctorServiceOrders.body.collection, "serviceOrders");
    assert.equal(familyDoctorServiceOrders.body.schema.sourceCollections.includes("phase2FamilyDoctorApplications"), true);
    assert.equal(familyDoctorServiceOrders.body.orders.some((item) => item.sourceCollection === "phase2FamilyDoctorApplications" && item.sourceId === familyDoctorApplication.body.application.id), true);

    const communityLogin = await login(baseUrl, "community");
    const familyDoctorReview = await api(baseUrl, `/api/phase2/family-doctor-contracts/applications/${familyDoctorApplication.body.application.id}/review`, authorized(communityLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ decision: "approved", comment: "API test institution approved family doctor contract." })
    }));
    assert.equal(familyDoctorReview.response.status, 200);
    assert.equal(familyDoctorReview.body.application.reviewStatus, "approved");
    assert.equal(familyDoctorReview.body.contract.residentId, "r1");
    assert.equal(familyDoctorReview.body.overview.checks.some((item) => item.id === "phase2FamilyDoctor:institutionReview" && item.passed), true);

    const familyDoctorFulfillment = await api(baseUrl, `/api/phase2/family-doctor-contracts/contracts/${familyDoctorReview.body.contract.id}/fulfillments`, authorized(communityLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ serviceType: "api-followup", serviceItem: "API test family doctor fulfillment", fulfillmentValue: 12, status: "completed" })
    }));
    assert.equal(familyDoctorFulfillment.response.status, 201);
    assert.equal(familyDoctorFulfillment.body.fulfillment.contractId, familyDoctorReview.body.contract.id);
    assert.equal(familyDoctorFulfillment.body.contract.fulfillmentPercent >= 12, true);
    assert.equal(familyDoctorFulfillment.body.overview.checks.some((item) => item.id === "phase2FamilyDoctor:fulfillmentRecords" && item.passed), true);

    const operationsDashboard = await api(baseUrl, "/api/operations/dashboard", authorized(accountLogin.body.token));
    assert.equal(operationsDashboard.response.status, 200);
    assert.equal(operationsDashboard.body.ok, true);
    assert.equal(operationsDashboard.body.summary.institutions >= 3, true);
    assert.equal(operationsDashboard.body.summary.openDispatchRequests >= 2, true);
    assert.equal(operationsDashboard.body.snapshots.some((item) => item.normalizedStatus === "critical"), true);
    assert.equal(operationsDashboard.body.reusedCollections.includes("healthStatisticsIngestion"), true);
    assert.equal(operationsDashboard.body.runCenter.summary.serviceLevels, 4);
    assert.equal(operationsDashboard.body.runCenter.summary.productionReady, 0);

    const productionOperationsCenter = await api(baseUrl, "/api/production-operations/center", authorized(accountLogin.body.token));
    assert.equal(productionOperationsCenter.response.status, 200);
    assert.equal(productionOperationsCenter.body.ok, true);
    assert.equal(productionOperationsCenter.body.center.summary.dutyShifts, 3);
    assert.equal(productionOperationsCenter.body.center.summary.drills, 3);
    assert.equal(productionOperationsCenter.body.center.summary.productionReady, 0);

    const deniedProductionOperationsCenter = await api(baseUrl, "/api/production-operations/center", authorized(residentPhoneLogin.body.token));
    assert.equal(deniedProductionOperationsCenter.response.status, 403);

    const productionDutyHandoff = await api(baseUrl, "/api/production-operations/duty-shifts/ops-duty-day/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-handoff", note: "API demo duty handoff checklist reviewed" })
    }));
    assert.equal(productionDutyHandoff.response.status, 200);
    assert.equal(productionDutyHandoff.body.item.handoffStatus, "recorded-demo");
    assert.equal(productionDutyHandoff.body.item.productionReady, false);
    assert.equal(productionDutyHandoff.body.center.summary.handoffsRecorded >= 1, true);

    const productionIncidentAction = await api(baseUrl, "/api/production-operations/incidents/ops-incident-api-latency/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "acknowledge", note: "API demo incident acknowledged" })
    }));
    assert.equal(productionIncidentAction.response.status, 200);
    assert.equal(productionIncidentAction.body.item.status, "acknowledged-demo");
    assert.equal(productionIncidentAction.body.item.productionReady, false);

    const invalidProductionOperationsEvidence = await api(baseUrl, "/api/production-operations/drills/ops-drill-backup-restore/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "record-evidence", note: "evidence reference omitted" })
    }));
    assert.equal(invalidProductionOperationsEvidence.response.status, 400);

    const productionRecoveryDrill = await api(baseUrl, "/api/production-operations/drills/ops-drill-backup-restore/actions", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "rehearse-demo", note: "API isolated recovery sample rehearsal" })
    }));
    assert.equal(productionRecoveryDrill.response.status, 200);
    assert.equal(productionRecoveryDrill.body.item.status, "validated-demo");
    assert.equal(productionRecoveryDrill.body.item.rehearsalDigest.length, 64);
    assert.equal(productionRecoveryDrill.body.evidencePacket.productionEvidence, false);
    assert.equal(productionRecoveryDrill.body.center.summary.productionReady, 0);
    assert.equal(productionRecoveryDrill.body.center.summary.evidencePackets >= 3, true);

    const deniedProductionOperationsAction = await api(baseUrl, "/api/production-operations/incidents/ops-incident-callback/actions", authorized(residentPhoneLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "acknowledge", note: "forbidden resident action" })
    }));
    assert.equal(deniedProductionOperationsAction.response.status, 403);

    const productionOperationsAudit = await api(baseUrl, "/api/state", authorized(accountLogin.body.token));
    assert.equal(productionOperationsAudit.body.securityEvents.some((item) => item.action === "production-operations-action" && item.result === "allowed"), true);

    const dispatchAction = await api(baseUrl, "/api/operations/dispatch", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        id: "dispatch-api-test",
        category: "equipment",
        priority: "high",
        status: "assigned",
        sourceInstitution: "Qingniwaqiao Community Health Service Center",
        targetInstitution: "Dalian Central Hospital",
        resourceType: "ct-slot",
        quantity: 2,
        reason: "API regression dispatch"
      })
    }));
    assert.equal(dispatchAction.response.status, 201);
    assert.equal(dispatchAction.body.id, "dispatch-api-test");
    assert.equal(dispatchAction.body.auditTrail.some((item) => item.action === "upsert"), true);

    const reconReview = await api(baseUrl, "/api/operations/reconciliation/recon-mr1-20260622-am/review", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "approved", reviewNote: "API regression approved" })
    }));
    assert.equal(reconReview.response.status, 200);
    assert.equal(reconReview.body.status, "approved");
    assert.equal(reconReview.body.reviewedBy, "health");

    const identityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          sub: "oidc-doctor-001",
          preferred_username: "external_doctor",
          name: "外部医生",
          org_code: "MR1",
          roles: ["doctor"]
        }
      })
    }));
    assert.equal(identityPreview.response.status, 200);
    assert.equal(identityPreview.body.mapping.user.role, "institution");
    assert.equal(identityPreview.body.mapping.user.orgCode, "MR1");
    assert.equal(identityPreview.body.mapping.user.home, "doctor.html");

    const institutionIdentityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          sub: "oidc-institution-001",
          preferred_username: "external_institution",
          name: "External Institution Operator",
          org_code: "MR1",
          roles: ["institution"]
        }
      })
    }));
    assert.equal(institutionIdentityPreview.response.status, 200);
    assert.equal(institutionIdentityPreview.body.mapping.user.role, "institution");
    assert.equal(institutionIdentityPreview.body.mapping.user.orgCode, "MR1");
    assert.equal(institutionIdentityPreview.body.mapping.user.home, "institution.html");

    const usernameIdentityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          openid: "oidc-county-001",
          username: "external_county",
          displayName: "External County Operator",
          orgCode: "ORG-COUNTY",
          roles: ["county"]
        }
      })
    }));
    assert.equal(usernameIdentityPreview.response.status, 200);
    assert.equal(usernameIdentityPreview.body.mapping.user.role, "county");
    assert.equal(usernameIdentityPreview.body.mapping.user.orgCode, "ORG-COUNTY");

    const loginNameIdentityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          uid: "oidc-insurance-001",
          loginName: "external_insurance",
          organizationCode: "ORG-INSURANCE",
          orgName: "External Insurance Center",
          orgType: "insurance",
          roles: ["insurance"]
        }
      })
    }));
    assert.equal(loginNameIdentityPreview.response.status, 200);
    assert.equal(loginNameIdentityPreview.body.mapping.user.role, "insurance");
    assert.equal(loginNameIdentityPreview.body.mapping.user.orgCode, "ORG-INSURANCE");

    const fallbackIdentityPreview = await api(baseUrl, "/api/auth/identity/preview", authorized(accountLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        claims: {
          uid: "oidc-department-001",
          departmentCode: "UNKNOWN-DEPT",
          organizationName: "Unknown External Department",
          orgType: "institution",
          roleName: "external hospital operator"
        }
      })
    }));
    assert.equal(fallbackIdentityPreview.response.status, 200);
    assert.equal(fallbackIdentityPreview.body.mapping.status, "mapped-with-warnings");
    assert.equal(fallbackIdentityPreview.body.mapping.user.username, "oidc-department-001");
    assert.equal(fallbackIdentityPreview.body.mapping.user.orgName, "Unknown External Department");
  });

  await t.test("rejects invalid credentials and unauthenticated state reads", async () => {
    const badLogin = await login(baseUrl, "health", "wrong-password");
    assert.equal(badLogin.response.status, 401);
    const badPhoneLogin = await phoneLogin(baseUrl, "DEMO-MOBILE-R1", "000000");
    assert.equal(badPhoneLogin.response.status, 401);
    for (let index = 0; index < 4; index += 1) {
      const failed = await phoneLogin(baseUrl, "DEMO-MOBILE-R2", "000000");
      assert.equal(failed.response.status, 401);
    }
    const lockedPhoneLogin = await phoneLogin(baseUrl, "DEMO-MOBILE-R2", "000000");
    assert.equal(lockedPhoneLogin.response.status, 423);
    assert.equal(lockedPhoneLogin.body.failedAttempts, 5);
    assert.equal(lockedPhoneLogin.body.retryAfterSeconds > 0, true);
    const lockedCorrectCode = await phoneLogin(baseUrl, "DEMO-MOBILE-R2", "888888");
    assert.equal(lockedCorrectCode.response.status, 423);
    const resetPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-R2");
    assert.equal(resetPhoneCode.response.status, 200);
    const resetPhoneLogin = await phoneLogin(baseUrl, "DEMO-MOBILE-R2", resetPhoneCode.body.demoCode);
    assert.equal(resetPhoneLogin.response.status, 200);
    assert.equal(resetPhoneLogin.body.user.residentId, "r2");

    const hashedLogin = await login(baseUrl, "hashed_commission", "hashed-pass");
    assert.equal(hashedLogin.response.status, 200);
    assert.equal(hashedLogin.body.user.passwordHash, undefined);

    const baselineSecurityAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(hashedLogin.body.token));
    assert.equal(baselineSecurityAudit.response.status, 200);
    const anonymousStateDenialsBefore = baselineSecurityAudit.body.securityEvents.filter((item) => item.actor === "anonymous" && item.target === "/api/state" && item.detail === "未登录或会话已过期").length;
    const authDenialsBefore = baselineSecurityAudit.body.securityEvents.filter((item) => item.target === "统一认证" && item.result === "拒绝").length;

    const state = await api(baseUrl, "/api/state");
    assert.equal(state.response.status, 401);

    const badHashedLogin = await login(baseUrl, "hashed_commission", "123456");
    assert.equal(badHashedLogin.response.status, 401);
    const missingPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-MISSING");
    assert.equal(missingPhoneCode.response.status, 404);
    const firstPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-R1");
    assert.equal(firstPhoneCode.response.status, 200);
    const repeatedPhoneCode = await phoneCode(baseUrl, "DEMO-MOBILE-R1");
    assert.equal(repeatedPhoneCode.response.status, 429);
    assert.equal(repeatedPhoneCode.body.ok, false);
    assert.equal(repeatedPhoneCode.body.retryAfterSeconds >= 1, true);

    const securityAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(hashedLogin.body.token));
    assert.equal(securityAudit.response.status, 200);
    const anonymousStateDenialsAfter = securityAudit.body.securityEvents.filter((item) => item.actor === "anonymous" && item.target === "/api/state" && item.detail === "未登录或会话已过期").length;
    const authDenialsAfter = securityAudit.body.securityEvents.filter((item) => item.target === "统一认证" && item.result === "拒绝").length;
    // Security events are capped; older anonymous state denials can age out while auth denials are appended.
    assert.equal(anonymousStateDenialsAfter <= anonymousStateDenialsBefore, true);
    assert.equal(authDenialsAfter > authDenialsBefore, true);

    const tamperedToken = `${hashedLogin.body.token.slice(0, -1)}x`;
    const tamperedState = await api(baseUrl, "/api/state", authorized(tamperedToken));
    assert.equal(tamperedState.response.status, 401);
  });

  await t.test("authenticates every documented role and scopes management collections", async () => {
    const accounts = [
      ["city", "commission"], ["district", "commission"], ["health", "commission"], ["whjw", "commission"],
      ["hospital", "institution"], ["community", "institution"], ["doctor", "institution"], ["doctor_wang", "institution"],
      ["mi", "insurance"], ["insurance", "insurance"], ["district_mi", "insurance"],
      ["citizen", "citizen"], ["county", "county"]
    ];
    for (const [username, role] of accounts) {
      const accountLogin = await login(baseUrl, username);
      assert.equal(accountLogin.response.status, 200, `${username} 应可登录`);
      assert.equal(accountLogin.body.user.role, role);
      const scopedState = await api(baseUrl, "/api/state", authorized(accountLogin.body.token));
      assert.equal(scopedState.response.status, 200);
      if (role !== "commission") {
        assert.equal(scopedState.body.applicationCatalog, undefined, `${username} 不应读取平台建设目录`);
        assert.equal(scopedState.body.securityAcceptanceLedger, undefined, `${username} 不应读取安全验收台账`);
        assert.equal(scopedState.body.platformCapabilityReviews, undefined, `${username} should not read platform capability review ledger`);
        assert.equal(scopedState.body.platformProductionBlockerReviews, undefined, `${username} should not read production blocker review ledger`);
        assert.equal(scopedState.body.productionDeploymentPlan, undefined, `${username} should not read production deployment plan`);
        assert.equal(scopedState.body.hospitalInteroperabilityFunctions, undefined, `${username} should not read hospital interoperability management functions`);
      }
    }
  });

  await t.test("enforces institution and business resident data boundaries", async () => {
    const hospitalLogin = await login(baseUrl, "hospital");
    const hospitalState = await api(baseUrl, "/api/state", authorized(hospitalLogin.body.token));
    assert.equal(hospitalState.body.accounts, undefined);
    assert.equal(hospitalState.body.followups.length, 0, "hospital must not receive unowned follow-up rows without institution scope");
    assert.equal(hospitalState.body.internetNursingOrders.every((item) => item.institutionCode === "MR1"), true);

    const crossInstitutionPatch = await api(baseUrl, "/api/residents/r2", authorized(hospitalLogin.body.token, {
      method: "PATCH",
      body: JSON.stringify({ address: "cross-institution-write-must-fail" })
    }));
    assert.equal(crossInstitutionPatch.response.status, 403);

    const communityLogin = await login(baseUrl, "community");
    const communityState = await api(baseUrl, "/api/state", authorized(communityLogin.body.token));
    assert.deepEqual(new Set(communityState.body.followups.map((item) => item.residentId)), new Set(["r1", "r4"]));
    assert.equal(communityState.body.residents.some((item) => item.id === "r3"), false);

    const insuranceLogin = await login(baseUrl, "mi");
    const insuranceState = await api(baseUrl, "/api/state", authorized(insuranceLogin.body.token));
    assert.equal(insuranceState.body.followups.length, 0);
    assert.equal(insuranceState.body.insuranceClaims.every((item) => ["r1", "r2", "r4"].includes(item.residentId)), true);

    const countyLogin = await login(baseUrl, "county");
    const countyState = await api(baseUrl, "/api/state", authorized(countyLogin.body.token));
    assert.equal(countyState.body.followups.length, 0);
    assert.equal(countyState.body.countyCollaborationOrders.every((item) => ["r1", "r2", "r4"].includes(item.residentId)), true);
  });

  const commissionLogin = await login(baseUrl, "health");
  assert.equal(commissionLogin.response.status, 200);
  const commissionToken = commissionLogin.body.token;

  await t.test("returns governance modules to the commission role and repairs seeded text", async () => {
    const { response, body } = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(response.status, 200);
    assert.equal(body.accounts[0].name, "演示居民A账户");
    assert.equal(body.residents[0].idCard, "DEMO-ID-R1");
    assert.equal(body.residents[0].phone, "DEMO-MOBILE-R1");
    assert.equal(body.applicationCatalog.length, 6);
    assert.equal(body.hospitalInteroperabilityFunctions.length, 6);
    assert.equal(body.institutionCreditEvaluations.length, 3);
    assert.equal(body.securityAcceptanceLedger.length, 4);
    assert.equal(body.productionDeploymentPlan.length, 4);
    assert.equal(body.healthDashboardSnapshots.length, 1);
    ["residents", "personalRecords", "platformEvidence", "platformCapabilityReviews", "platformProductionBlockerReviews", "productionDeploymentPlan", "applicationCatalog", "hospitalInteroperabilityFunctions", "institutionCreditEvaluations", "securityAcceptanceLedger", "healthDashboardSnapshots"].forEach((key) => {
      assert.ok(Array.isArray(body[key]), `${key} should keep array contract`);
    });
  });

  await t.test("operates the evidence-backed platform capability review ledger", async () => {
    const denied = await api(baseUrl, "/api/platform/capability-operations");
    assert.equal(denied.response.status, 401);

    const initial = await api(baseUrl, "/api/platform/capability-operations", authorized(commissionToken));
    assert.equal(initial.response.status, 200);
    assert.equal(initial.body.center.summary.capabilityDomains, 10);
    assert.equal(initial.body.center.summary.productionReady, 0);
    assert.equal(initial.body.center.capabilities.every((item) => item.review && item.productionReady === false), true);

    const evidence = await api(baseUrl, "/api/platform/capability-operations/data-governance/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        action: "record-evidence",
        evidenceRef: "release:data-governance-readiness",
        note: "Registered the data governance readiness evidence."
      })
    }));
    assert.equal(evidence.response.status, 200);
    assert.equal(evidence.body.capability.reviewStatus, "in-review");
    assert.equal(evidence.body.capability.productionReady, false);

    const reviewed = await api(baseUrl, "/api/platform/capability-operations/data-governance/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        action: "review",
        note: "Repository implementation and current production boundary were reviewed."
      })
    }));
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.capability.reviewStatus, "reviewed-preproduction");
    assert.equal(reviewed.body.center.summary.reviewedPreproduction, 1);
    assert.equal(reviewed.body.center.productionReady, false);

    const prematureBlockerSubmission = await api(baseUrl, "/api/platform/capability-operations/blockers/P0-02/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ action: "submit-evidence", note: "Submission attempted before remediation started." })
    }));
    assert.equal(prematureBlockerSubmission.response.status, 409);
    assert.equal(prematureBlockerSubmission.body.code, "PLATFORM_PRODUCTION_BLOCKER_REMEDIATION_REQUIRED");

    const blockerActions = [
      { action: "start-remediation", note: "Database cutover remediation started." },
      { action: "record-evidence", evidenceRef: "ticket:DB-CUTOVER-API-02", note: "Recorded the database rehearsal ticket." },
      { action: "submit-evidence", note: "Submitted current database cutover evidence." },
      { action: "review-evidence", note: "Reviewed current evidence; site acceptance remains required." }
    ];
    let blockerResult;
    for (const action of blockerActions) {
      blockerResult = await api(baseUrl, "/api/platform/capability-operations/blockers/P0-02/actions", authorized(commissionToken, {
        method: "POST",
        body: JSON.stringify(action)
      }));
      assert.equal(blockerResult.response.status, 200);
    }
    assert.equal(blockerResult.body.blocker.workflowStatus, "evidence-reviewed-site-pending");
    assert.equal(blockerResult.body.blocker.siteAcceptanceRequired, true);
    assert.equal(blockerResult.body.blocker.productionReady, false);
    assert.equal(blockerResult.body.center.summary.blockerEvidenceReviewed, 1);

    const state = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(state.body.securityEvents.some((item) => item.action === "platform-capability-review-action"), true);
    assert.equal(state.body.securityEvents.some((item) => item.action === "platform-production-blocker-action"), true);
    assert.equal(state.body.platformCapabilityReviews.find((item) => item.capabilityId === "data-governance").productionReady, false);
    assert.equal(state.body.platformProductionBlockerReviews.find((item) => item.blockerId === "P0-02").siteAcceptanceRequired, true);
  });

  await t.test("exposes scoped multi-practice registry for supervision and public ledger", async () => {
    const registry = await api(baseUrl, "/api/multi-practice-registry", authorized(commissionToken));
    assert.equal(registry.response.status, 200);
    assert.equal(registry.body.ok, true);
    assert.equal(registry.body.summary.total >= 2, true);
    assert.equal(registry.body.summary.publicVisible, registry.body.publicLedger.length);
    assert.equal(registry.body.publicLedger.every((item) => item.doctorName && item.primaryInstitution && item.targetInstitution), true);
    assert.equal(registry.body.applications.every((item) => Array.isArray(item.riskFlags) && item.documentChecks), true);
    assert.equal(registry.body.reviewQueue.every((item) => item.risk || String(item.status || "").includes("待")), true);

    const doctorLogin = await login(baseUrl, "doctor");
    assert.equal(doctorLogin.body.user.home, "doctor.html");
    const doctorMe = await api(baseUrl, "/api/doctors/me", authorized(doctorLogin.body.token));
    assert.equal(doctorMe.response.status, 200);
    assert.equal(doctorMe.body.doctor.id, doctorLogin.body.user.doctorId);
    assert.equal(doctorMe.body.doctor.electronicRegistrationVerification.verificationStatus, "已核验");
    assert.equal(doctorMe.body.doctor.electronicRegistrationVerification.licenseMatched, true);
    assert.equal(doctorMe.body.multiPracticeSummary.total, doctorMe.body.multiPracticeApplications.length);
    assert.equal(doctorMe.body.multiPracticeApplications.every((item) => Array.isArray(item.riskFlags) && item.documentChecks), true);

    const createdPractice = await api(baseUrl, "/api/multi-practice-applications", authorized(doctorLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        targetInstitutionId: "MR1",
        targetInstitution: "大连市中心医院",
        targetDepartment: "心内科联合门诊",
        practiceScope: "全科医学专业",
        period: "2026-08-01 至 2027-07-31",
        schedule: "每周一上午",
        tasks: "慢病联合门诊和用药方案复核",
        responsibility: "由当事医疗机构和医师按协议依法承担医疗责任",
        compensation: "按工作量协商结算",
        insurance: "已购买医师个人医疗执业保险"
      })
    }));
    assert.equal(createdPractice.response.status, 201);
    assert.equal(createdPractice.body.externalSync.electronicRegistration.status, "已核验");
    assert.equal(createdPractice.body.externalSync.hisHr.status, "mapped");
    const publicLedger = await api(baseUrl, "/api/public/multi-practice-ledger?q=中心医院");
    assert.equal(publicLedger.response.status, 200);
    assert.equal(publicLedger.body.ok, true);
    assert.equal(Array.isArray(publicLedger.body.publicLedger), true);
    assert.equal(publicLedger.body.publicLedger.every((item) => item.doctorName && item.targetInstitution && !item.licenseNo), true);
    const conflictPractice = await api(baseUrl, "/api/multi-practice-applications", authorized(doctorLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        targetInstitutionId: "MR1",
        targetInstitution: "大连市中心医院",
        targetDepartment: "慢病联合门诊",
        practiceScope: "全科医学专业",
        period: "2026-09-01 至 2027-08-31",
        schedule: "每周一上午",
        tasks: "慢病联合门诊和用药方案复核",
        responsibility: "由当事医疗机构和医师按协议依法承担医疗责任",
        compensation: "按工作量协商结算",
        insurance: "已购买医师个人医疗执业保险"
      })
    }));
    assert.equal(conflictPractice.response.status, 201);
    assert.equal(conflictPractice.body.documentChecks.scheduleConflict, true);
    assert.equal(conflictPractice.body.riskFlags.includes("schedule-conflict"), true);
    assert.equal(conflictPractice.body.scheduleConflictEvidence.some((item) => item.id === createdPractice.body.id), true);
    const hospitalLogin = await login(baseUrl, "hospital");
    const hospitalMessages = await api(baseUrl, "/api/messages", authorized(hospitalLogin.body.token));
    assert.equal(hospitalMessages.response.status, 200);
    assert.equal(hospitalMessages.body.messages.some((item) => item.sourceId === createdPractice.body.id && /待医院端处理/.test(item.title)), true);
    const hospitalConfirmed = await api(baseUrl, "/api/workflow-actions", authorized(hospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "multiPracticeApplications",
        id: createdPractice.body.id,
        status: "待卫健审核",
        updates: { primaryConsent: "已同意", hospitalReviewOpinion: "医院端材料核验通过" },
        note: "医院端确认接收多点执业申请"
      })
    }));
    assert.equal(hospitalConfirmed.response.status, 200);
    assert.equal(hospitalConfirmed.body.primaryPracticeConfirmation.status, "已电子确认");
    assert.equal(hospitalConfirmed.body.externalSync.eSignature.status, "signed");
    const multiPracticeAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(commissionToken));
    assert.equal(multiPracticeAudit.response.status, 200);
    assert.equal(multiPracticeAudit.body.securityEvents.some((item) => item.role === "institution" && item.target === `multiPracticeApplications/${createdPractice.body.id}`), true);
    const doctorLoop = await api(baseUrl, "/api/doctors/me", authorized(doctorLogin.body.token));
    assert.equal(doctorLoop.body.multiPracticeMessages.some((item) => item.sourceId === createdPractice.body.id && item.targetRole === "doctor" && /医院端已处理/.test(item.title)), true);
    const otherDoctorLogin = await login(baseUrl, "doctor_wang");
    const forbiddenDoctorPractice = await api(baseUrl, "/api/workflow-actions", authorized(otherDoctorLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "multiPracticeApplications",
        id: createdPractice.body.id,
        status: "已备案",
        note: "医生不能处理他人多点执业申请"
      })
    }));
    assert.equal(forbiddenDoctorPractice.response.status, 403);

    const returnedPractice = await api(baseUrl, "/api/workflow-actions", authorized(hospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "multiPracticeApplications",
        id: conflictPractice.body.id,
        action: "return-correction",
        note: "请补齐排班避让说明和责任保险凭证"
      })
    }));
    assert.equal(returnedPractice.response.status, 200);
    assert.equal(returnedPractice.body.status, "退回补正");
    assert.equal(returnedPractice.body.correctionRequired.includes("排班"), true);
    const terminatedPractice = await api(baseUrl, "/api/workflow-actions", authorized(hospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "multiPracticeApplications",
        id: conflictPractice.body.id,
        action: "terminate",
        note: "测试终止备案"
      })
    }));
    assert.equal(terminatedPractice.response.status, 200);
    assert.equal(terminatedPractice.body.status, "已终止");
    assert.equal(terminatedPractice.body.publicVisible, false);

    const doctorRegistry = await api(baseUrl, "/api/multi-practice-registry", authorized(doctorLogin.body.token));
    assert.equal(doctorRegistry.response.status, 200);
    assert.equal(doctorRegistry.body.applications.length >= 1, true);
    assert.equal(doctorRegistry.body.applications.every((item) => item.doctorId === doctorLogin.body.user.doctorId), true);
    const patchedPractice = await api(baseUrl, `/api/multi-practice-applications/${doctorRegistry.body.applications[0].id}`, authorized(doctorLogin.body.token, {
      method: "PATCH",
      body: JSON.stringify({ scheduleConflict: true, note: "测试排班冲突补正" })
    }));
    assert.equal(patchedPractice.response.status, 200);
    assert.equal(patchedPractice.body.documentChecks.scheduleConflict, true);
    assert.equal(patchedPractice.body.riskFlags.includes("schedule-conflict"), true);
    assert.equal(patchedPractice.body.lifecycle[0].note, "测试排班冲突补正");
    const confirmedPractice = await api(baseUrl, "/api/workflow-actions", authorized(doctorLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "multiPracticeApplications",
        id: doctorRegistry.body.applications[0].id,
        status: "待卫健审核",
        updates: { primaryConsent: "已同意" },
        note: "第一执业地点电子签章确认"
      })
    }));
    assert.equal(confirmedPractice.response.status, 200);
    assert.equal(confirmedPractice.body.primaryPracticeConfirmation.status, "已电子确认");
    assert.match(confirmedPractice.body.primaryPracticeConfirmation.signatureNo, /DL-MP-CONSENT/);
    assert.equal(confirmedPractice.body.documentChecks.firstPracticeConsent, true);

    const insuranceLogin = await login(baseUrl, "insurance");
    const deniedRegistry = await api(baseUrl, "/api/multi-practice-registry", authorized(insuranceLogin.body.token));
    assert.equal(deniedRegistry.response.status, 403);
  });

  const citizenLogin = await login(baseUrl, "citizen");
  assert.equal(citizenLogin.response.status, 200);
  const citizenToken = citizenLogin.body.token;

  await t.test("scopes citizen state to household members and hides management data", async () => {
    const { response, body } = await api(baseUrl, "/api/state", authorized(citizenToken));
    assert.equal(response.status, 200);
    assert.deepEqual(body.residents.map((item) => item.id).sort(), ["r1", "r4"]);
    assert.match(body.residents[0].idCard, /^已脱敏-/);
    assert.match(body.residents[0].phone, /^已脱敏-/);
    assert.match(body.residents[0].address, /^已脱敏-/);
    assert.match(body.residents[0].personIndex, /^已脱敏-/);
    assert.notEqual(body.digitalCredentials[0].credentialNo, "MI-DEMO-MOBILE-R1");
    [
      "authUsers",
      "authOrganizations",
      "securityEvents",
      "smsDeliveryReceipts",
      "platformAudit",
      "platformProcessAudit",
      "productionDeploymentPlan",
      "healthDashboardSnapshots",
      "applicationCatalog",
      "hospitalInteroperabilityFunctions",
      "institutionCreditEvaluations",
      "securityAcceptanceLedger"
    ].forEach((key) => assert.equal(body[key], undefined, `${key} 不应返回给居民端`));
    assert.ok(Array.isArray(body.citizenLifecycleActions));
    assert.equal(body.citizenLifecycleActions.length > 0, true);
    assert.equal(body.citizenLifecycleActions.every((item) => ["r1", "r4"].includes(item.residentId)), true);
  });

  await t.test("returns citizen lifecycle actions inside account scope", async () => {
    const lifecycle = await api(baseUrl, "/api/citizen/lifecycle-actions", authorized(citizenToken));
    assert.equal(lifecycle.response.status, 200);
    assert.equal(lifecycle.body.ok, true);
    assert.equal(lifecycle.body.actions.length > 0, true);
    assert.equal(lifecycle.body.actions.every((item) => ["r1", "r4"].includes(item.residentId)), true);
    assert.equal(lifecycle.body.actions.some((item) => ["birthCertificates", "followups", "medicationPickups"].includes(item.sourceCollection)), true);
    assert.equal(lifecycle.body.actions.some((item) => ["authUsers", "platformAudit"].includes(item.sourceCollection)), false);

    const scoped = await api(baseUrl, "/api/citizen/lifecycle-actions?residentId=r1", authorized(citizenToken));
    assert.equal(scoped.response.status, 200);
    assert.equal(scoped.body.actions.every((item) => item.residentId === "r1"), true);

    const forbidden = await api(baseUrl, "/api/citizen/lifecycle-actions?residentId=r2", authorized(citizenToken));
    assert.equal(forbidden.response.status, 403);
  });

  await t.test("lets institution close citizen lifecycle actions through unified tasks", async () => {
    const hospitalLogin = await login(baseUrl, "hospital");
    assert.equal(hospitalLogin.response.status, 200);
    const taskList = await api(baseUrl, "/api/tasks", authorized(hospitalLogin.body.token));
    assert.equal(taskList.response.status, 200);
    const lifecycleTask = taskList.body.tasks.find((item) => item.collection === "citizenLifecycleActions");
    assert.equal(Boolean(lifecycleTask), true);
    assert.equal(lifecycleTask.serviceDomain, "citizenLifecycle");
    assert.equal(["birthCertificates", "followups", "medicationPickups", "seniorServices", "personalRecords", "deathCertificates"].includes(lifecycleTask.sourceCollection), true);

    const handled = await api(baseUrl, `/api/tasks/${encodeURIComponent(lifecycleTask.id)}/actions`, authorized(hospitalLogin.body.token, {
      method: "POST",
      body: JSON.stringify({
        status: "handled",
        action: "lifecycle-followup-closed",
        comment: "机构端已完成生命周期健康管理事项处理并通知居民。"
      })
    }));
    assert.equal(handled.response.status, 200);
    assert.equal(handled.body.collection, "citizenLifecycleActions");
    assert.equal(handled.body.status, "handled");
    assert.equal(handled.body.message.collection, "citizenLifecycleActions");
    assert.equal(handled.body.message.targetRole, "citizen");
    assert.equal(handled.body.message.meta.lifecycleActionClosed, true);

    const refreshedTasks = await api(baseUrl, "/api/tasks", authorized(hospitalLogin.body.token));
    assert.equal(refreshedTasks.body.tasks.some((item) => item.id === lifecycleTask.id), false);

    const citizenMessages = await api(baseUrl, "/api/messages", authorized(citizenToken));
    assert.equal(citizenMessages.response.status, 200);
    assert.equal(citizenMessages.body.messages.some((item) => item.id === handled.body.message.id), true);
  });

  await t.test("lets citizen acknowledge lifecycle actions and creates task message", async () => {
    const lifecycle = await api(baseUrl, "/api/citizen/lifecycle-actions", authorized(citizenToken));
    assert.equal(lifecycle.response.status, 200);
    const action = lifecycle.body.actions.find((item) =>
      item.sourceId && ["birthCertificates", "followups", "medicationPickups", "deathCertificates"].includes(item.sourceCollection)
    );
    assert.ok(action, "expected a lifecycle action backed by a workflow source");

    const acknowledged = await api(baseUrl, `/api/citizen/lifecycle-actions/${encodeURIComponent(action.id)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "acknowledge", comment: "居民已知晓生命周期待办" })
    }));
    assert.equal(acknowledged.response.status, 200);
    assert.equal(acknowledged.body.ok, true);
    assert.equal(acknowledged.body.sourceUpdated, true);
    assert.equal(acknowledged.body.message.collection, "citizenLifecycleActions");
    assert.equal(acknowledged.body.message.residentId, action.residentId);

    const refreshed = await api(baseUrl, `/api/citizen/lifecycle-actions?residentId=${action.residentId}`, authorized(citizenToken));
    assert.equal(refreshed.response.status, 200);
    assert.equal(refreshed.body.actions.some((item) => item.id === action.id), false);

    const messages = await api(baseUrl, "/api/messages", authorized(citizenToken));
    assert.equal(messages.response.status, 200);
    assert.equal(messages.body.messages.some((item) => item.collection === "citizenLifecycleActions" && item.sourceId === action.sourceId), true);

    const remindable = lifecycle.body.actions.find((item) => item.id !== action.id);
    assert.ok(remindable, "expected another lifecycle action for resident reminder coverage");
    const reminded = await api(baseUrl, `/api/citizen/lifecycle-actions/${encodeURIComponent(remindable.id)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "resident-remind" })
    }));
    assert.equal(reminded.response.status, 200);
    assert.equal(reminded.body.message.collection, "citizenLifecycleActions");
    assert.equal(reminded.body.message.residentId, remindable.residentId);
  });

  await t.test("allows citizen medical escort appointment within household scope", async () => {
    const dashboard = await api(baseUrl, "/api/escort-services/dashboard", authorized(citizenToken));
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.ok, true);
    assert.equal(dashboard.body.providers.every((item) => item.published !== false), true);

    const providerId = dashboard.body.providers[0].id;
    const futureEscortDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const registrationDashboard = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    assert.equal(registrationDashboard.response.status, 200);
    const linkedSchedule = registrationDashboard.body.schedules.find((item) => item.hospitalCode === "MR1" && item.remaining > 0);
    assert.ok(linkedSchedule);
    const linkedRegistration = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        scheduleId: linkedSchedule.id,
        visitType: "onsite",
        reason: "escort linked registration regression"
      })
    }));
    assert.equal(linkedRegistration.response.status, 201);
    assert.equal(linkedRegistration.body.hospitalCode, "MR1");

    const created = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        registrationOrderId: linkedRegistration.body.id,
        appointmentAt: futureEscortDate,
        serviceItems: ["registration", "exam escort"],
        subsidyType: "80plus-living-alone",
        priority: "high",
        riskLevel: "high",
        sourceChannel: "citizen.html",
        note: "resident portal appointment regression"
      })
    }));
    assert.equal(created.response.status, 201);
    assert.equal(created.body.residentId, "r1");
    assert.equal(created.body.createdBy, "citizen");
    assert.equal(created.body.sourceChannel, "citizen.html");
    assert.equal(created.body.serviceItems.includes("registration"), true);
    assert.equal(created.body.registrationOrderId, linkedRegistration.body.id);
    assert.equal(created.body.hospitalCode, "MR1");
    assert.equal(created.body.hospital, linkedRegistration.body.hospital);
    assert.equal(created.body.department, linkedRegistration.body.department);
    assert.equal(created.body.appointmentAt, futureEscortDate);
    assert.equal(created.body.hisVisitId, linkedRegistration.body.hisVisitId);
    assert.equal(created.body.outpatientQueueNo, linkedRegistration.body.queueNo);
    assert.equal(created.body.appointmentSource, "registration-order");

    const duplicateEscort = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        registrationOrderId: linkedRegistration.body.id,
        appointmentAt: futureEscortDate,
        serviceItems: ["registration", "exam escort"],
        priority: "medium",
        sourceChannel: "citizen.html"
      })
    }));
    assert.equal(duplicateEscort.response.status, 409);
    assert.equal(duplicateEscort.body.message, "duplicate active escort appointment");

    const missingHospital = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        appointmentAt: futureEscortDate,
        serviceItems: ["registration", "exam escort"]
      })
    }));
    assert.equal(missingHospital.response.status, 400);
    assert.equal(missingHospital.body.message, "hospital is required");

    const missingDepartment = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        appointmentAt: futureEscortDate,
        serviceItems: ["registration", "exam escort"]
      })
    }));
    assert.equal(missingDepartment.response.status, 400);
    assert.equal(missingDepartment.body.message, "department is required");

    const missingAppointmentAt = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        department: "Cardiology",
        serviceItems: ["registration", "exam escort"]
      })
    }));
    assert.equal(missingAppointmentAt.response.status, 400);
    assert.equal(missingAppointmentAt.body.message, "appointmentAt is required");

    const missingServiceItems = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        department: "Cardiology",
        appointmentAt: futureEscortDate,
        serviceItems: []
      })
    }));
    assert.equal(missingServiceItems.response.status, 400);
    assert.equal(missingServiceItems.body.message, "serviceItems is required");

    const pastAppointmentAt = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        department: "Cardiology",
        appointmentAt: "2000-01-01",
        serviceItems: ["registration", "exam escort"]
      })
    }));
    assert.equal(pastAppointmentAt.response.status, 400);
    assert.equal(pastAppointmentAt.body.message, "appointmentAt cannot be in the past");

    const hospitalLogin = await login(baseUrl, "hospital");
    assert.equal(hospitalLogin.response.status, 200);
    const hospitalToken = hospitalLogin.body.token;
    const handoff = await api(baseUrl, `/api/escort-services/orders/${created.body.id}/hospital-handoff`, authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        decision: "confirm",
        hospitalCode: "MR1",
        hospitalCheckInStatus: "confirmed",
        hospitalCheckInNo: "OP-MR1-20260627-008",
        hisVisitId: "HIS-MR1-20260627-0008",
        appointmentSource: "hospital-outpatient-guidance",
        departmentCode: "CARD",
        doctorCode: "DOC-CARD-01",
        outpatientQueueNo: "C08",
        hospitalDepartmentContact: "Cardiology outpatient guidance desk",
        appointmentAt: "2026-06-27T09:30:00+08:00",
        hospitalNotice: "Arrive 20 minutes early and bring ID card.",
        note: "hospital outpatient handoff regression"
      })
    }));
    assert.equal(handoff.response.status, 200);
    assert.equal(handoff.body.status, "hospital-confirmed");
    assert.equal(handoff.body.hospitalInterfaceStatus, "confirmed");
    assert.equal(handoff.body.hospitalCheckInNo, "OP-MR1-20260627-008");
    assert.equal(handoff.body.hisVisitId, "HIS-MR1-20260627-0008");
    assert.equal(handoff.body.outpatientQueueNo, "C08");
    assert.equal(handoff.body.departmentCode, "CARD");
    assert.equal(handoff.body.auditTrail[0].action, "hospital-confirmed");
    const escortServiceOrders = await api(baseUrl, "/api/service-orders?residentId=r1&serviceType=escort", authorized(citizenToken));
    assert.equal(escortServiceOrders.response.status, 200);
    assert.equal(escortServiceOrders.body.orders.some((item) => item.sourceCollection === "escortServiceOrders" && item.sourceId === created.body.id && item.serviceType === "escort"), true);

    const returnEscortDate = new Date(Date.now() + 4 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const returnCandidate = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r4",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        hospitalCode: "MR1",
        department: "Neurology",
        appointmentAt: returnEscortDate,
        serviceItems: "registration,exam escort",
        sourceChannel: "citizen.html"
      })
    }));
    assert.equal(returnCandidate.response.status, 201);

    const returnedHandoff = await api(baseUrl, `/api/escort-services/orders/${returnCandidate.body.id}/hospital-handoff`, authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        decision: "reject",
        note: "hospital capacity changed"
      })
    }));
    assert.equal(returnedHandoff.response.status, 200);
    assert.equal(returnedHandoff.body.status, "hospital-returned");
    assert.equal(returnedHandoff.body.hospitalInterfaceStatus, "returned");
    assert.equal(returnedHandoff.body.hospitalCheckInStatus, "pending");
    assert.equal(returnedHandoff.body.auditTrail[0].action, "hospital-returned");

    const hospitalDashboard = await api(baseUrl, "/api/escort-services/dashboard", authorized(hospitalToken));
    assert.equal(hospitalDashboard.response.status, 200);
    assert.equal(hospitalDashboard.body.orders.some((item) => item.id === created.body.id && item.hospitalInterfaceStatus === "confirmed"), true);
    assert.equal(hospitalDashboard.body.summary.hospitalConfirmed >= 1, true);

    const refreshed = await api(baseUrl, "/api/escort-services/dashboard", authorized(citizenToken));
    assert.equal(refreshed.body.orders.some((item) => item.id === created.body.id && item.residentId === "r1"), true);
    assert.equal(refreshed.body.orders.every((item) => ["r1", "r4"].includes(item.residentId)), true);

    const confirmed = await api(baseUrl, `/api/tasks/${encodeURIComponent(`escortServiceOrders:${created.body.id}`)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "resident-confirm", comment: "居民确认陪诊安排" })
    }));
    assert.equal(confirmed.response.status, 200);
    assert.equal(confirmed.body.familyContactStatus, "confirmed");
    assert.equal(confirmed.body.taskAction, "resident-confirm");

    const reviewed = await api(baseUrl, `/api/tasks/${encodeURIComponent(`escortServiceOrders:${created.body.id}`)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "quality-feedback", comment: "陪诊服务满意", satisfaction: "满意", complaintStatus: "none" })
    }));
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.qualityReview, "citizen-feedback");
    assert.equal(reviewed.body.satisfaction, "满意");

    const cancelled = await api(baseUrl, `/api/tasks/${encodeURIComponent(`escortServiceOrders:${created.body.id}`)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "cancel-request", comment: "居民临时取消陪诊预约" })
    }));
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancel-requested");
    assert.equal(cancelled.body.cancellationReason, "居民临时取消陪诊预约");
    assert.equal(cancelled.body.familyContactStatus, "cancel-requested");
    assert.equal(cancelled.body.auditTrail[0].action, "cancel-request");

    const messages = await api(baseUrl, "/api/messages", authorized(citizenToken));
    assert.equal(messages.response.status, 200);
    assert.equal(messages.body.messages.some((item) => item.sourceId === created.body.id && /hospital handoff/i.test(item.title)), true);
    assert.equal(messages.body.messages.some((item) => item.sourceId === created.body.id && /居民服务|助医陪诊/.test(item.title)), true);

    const missingRegistration = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        registrationOrderId: "reg-missing-for-escort",
        serviceItems: ["registration", "exam escort"],
        subsidyType: "self-pay",
        priority: "medium"
      })
    }));
    assert.equal(missingRegistration.response.status, 400);
    assert.equal(missingRegistration.body.message, "registration order not found");

    const missingProvider = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId: "esp-provider-not-in-registry",
        hospital: "Dalian Central Hospital outpatient clinic demo",
        department: "Cardiology",
        appointmentAt: "2026-06-27",
        serviceItems: ["registration", "exam escort"]
      })
    }));
    assert.equal(missingProvider.response.status, 400);
    assert.equal(missingProvider.body.message, "provider not found");

    const communitySchedule = registrationDashboard.body.schedules.find((item) => item.hospitalCode === "MR3" && item.remaining > 0);
    assert.ok(communitySchedule);
    const communityRegistration = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        scheduleId: communitySchedule.id,
        visitType: "onsite",
        reason: "escort registration scope regression"
      })
    }));
    assert.equal(communityRegistration.response.status, 201);
    const registrationScopeDenied = await api(baseUrl, "/api/escort-services/orders", authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        providerId,
        registrationOrderId: communityRegistration.body.id,
        serviceItems: ["registration", "exam escort"],
        priority: "medium"
      })
    }));
    assert.equal(registrationScopeDenied.response.status, 403);
    assert.equal(registrationScopeDenied.body.message, "registration scope denied");

    const otherOrderAction = await api(baseUrl, `/api/tasks/${encodeURIComponent("escortServiceOrders:eso-r2-20260621")}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "resident-confirm", comment: "越权确认" })
    }));
    assert.equal(otherOrderAction.response.status, 403);

    const denied = await api(baseUrl, "/api/escort-services/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r2",
        providerId,
        hospital: "Dalian Central Hospital outpatient clinic demo",
        department: "Endocrinology",
        appointmentAt: "2026-06-27"
      })
    }));
    assert.equal(denied.response.status, 403);
  });

  await t.test("supports citizen registration HIS payment insurance and SMS workflow", async () => {
    const dashboard = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.ok, true);
    assert.equal(dashboard.body.integration.endpoints.includes("/api/registrations/orders"), true);
    assert.equal(dashboard.body.schedules.some((item) => item.hisScheduleId && item.sourceSystem), true);
    assert.equal(dashboard.body.orders.every((item) => ["r1", "r4"].includes(item.residentId)), true);

    const schedule = dashboard.body.schedules.find((item) => item.hospitalCode === "MR1" && item.remaining > 1 && item.insuranceSupported && item.paymentRequired !== false);
    assert.ok(schedule);
    const created = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        scheduleId: schedule.id,
        visitType: schedule.sourceType === "internet-hospital" ? "internet" : "onsite",
        reason: "registration API regression"
      })
    }));
    assert.equal(created.response.status, 201);
    assert.equal(created.body.residentId, "r1");
    assert.equal(created.body.scheduleId, schedule.id);
    assert.equal(created.body.hisScheduleId, schedule.hisScheduleId);
    assert.match(created.body.hisVisitId, /^HIS-/);
    assert.match(created.body.paymentTradeNo || "PAY-REG-WAIVED", /^PAY-REG-|^$/);
    assert.equal(["pending", "waived"].includes(created.body.paymentStatus), true);
    assert.equal(created.body.insuranceStatus, "prechecked");
    assert.match(created.body.insurancePrecheckNo, /^MI-PRE-/);
    assert.equal(created.body.notificationDeliveries.some((item) => item.channel === "sms" && item.status === "queued"), true);

    const refreshed = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    assert.equal(refreshed.response.status, 200);
    assert.equal(refreshed.body.orders.some((item) => item.id === created.body.id), true);
    assert.equal(refreshed.body.summary.hisConfirmed >= 1, true);
    assert.equal(refreshed.body.summary.insurancePrechecked >= 1, true);
    assert.equal(refreshed.body.orders.find((item) => item.id === created.body.id).allowedActions.includes("pay-demo"), true);
    const registrationServiceOrders = await api(baseUrl, "/api/service-orders?residentId=r1&serviceType=registration", authorized(citizenToken));
    assert.equal(registrationServiceOrders.response.status, 200);
    assert.equal(registrationServiceOrders.body.orders.some((item) => item.sourceCollection === "registrationOrders" && item.sourceId === created.body.id && item.serviceType === "registration"), true);

    const paid = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "pay-demo", note: "citizen API regression demo payment" })
    }));
    assert.equal(paid.response.status, 200);
    assert.equal(paid.body.order.paymentStatus, "paid-demo");
    assert.equal(paid.body.order.productionReady, false);

    const deniedHospitalConfirmation = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "confirm-his-demo", note: "citizen cannot confirm HIS" })
    }));
    assert.equal(deniedHospitalConfirmation.response.status, 409);

    const hospitalRegistrationLogin = await login(baseUrl, "hospital");
    const hospitalRegistrationToken = hospitalRegistrationLogin.body.token;
    const hisConfirmed = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "confirm-his-demo", note: "hospital API regression HIS confirmation" })
    }));
    assert.equal(hisConfirmed.response.status, 200);
    assert.equal(hisConfirmed.body.order.hisConfirmationStatus, "confirmed-demo");

    const insuranceRegistrationLogin = await login(baseUrl, "insurance");
    const insuranceConfirmed = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(insuranceRegistrationLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "confirm-insurance-demo", note: "insurance API regression precheck confirmation" })
    }));
    assert.equal(insuranceConfirmed.response.status, 200);
    assert.equal(insuranceConfirmed.body.order.insuranceStatus, "confirmed-demo");

    const checkedIn = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "check-in-demo", note: "citizen API regression arrival" })
    }));
    assert.equal(checkedIn.response.status, 200);
    assert.equal(checkedIn.body.order.checkInStatus, "checked-in-demo");

    const completed = await api(baseUrl, `/api/registrations/orders/${created.body.id}/actions`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "complete-demo", note: "hospital API regression consultation complete" })
    }));
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.order.status, "completed");
    assert.equal(completed.body.order.journeyStage, "completed-demo");

    const completedCancel = await api(baseUrl, `/api/registrations/orders/${created.body.id}/cancel`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "completed order must stay closed" })
    }));
    assert.equal(completedCancel.response.status, 409);

    const registrationMessages = await api(baseUrl, "/api/messages", authorized(citizenToken));
    assert.equal(registrationMessages.response.status, 200);
    assert.equal(registrationMessages.body.messages.some((item) => item.collection === "registrationOrders" && item.sourceId === created.body.id), true);

    const cancelCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "refund journey regression" })
    }));
    assert.equal(cancelCandidate.response.status, 201);
    const cancelCandidatePaid = await api(baseUrl, `/api/registrations/orders/${cancelCandidate.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "pay-demo", note: "refund candidate paid in demo" })
    }));
    assert.equal(cancelCandidatePaid.response.status, 200);

    const cancelled = await api(baseUrl, `/api/registrations/orders/${cancelCandidate.body.id}/cancel`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "API regression cancellation" })
    }));
    assert.equal(cancelled.response.status, 200);
    assert.equal(cancelled.body.status, "cancelled");
    assert.equal(cancelled.body.scheduleLockStatus, "released");
    assert.equal(["closed", "refund-pending"].includes(cancelled.body.paymentStatus), true);
    assert.equal(cancelled.body.notificationDeliveries.some((item) => item.event === "registration-cancelled" && item.channel === "sms"), true);

    const refunded = await api(baseUrl, `/api/registrations/orders/${cancelCandidate.body.id}/actions`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "refund-demo", note: "hospital API regression refund evidence" })
    }));
    assert.equal(refunded.response.status, 200);
    assert.equal(refunded.body.order.refundStatus, "refunded-demo");
    assert.equal(refunded.body.order.productionReady, false);

    const replacementSchedule = dashboard.body.schedules.find((item) =>
      item.id !== schedule.id && item.hospitalCode === schedule.hospitalCode && item.departmentCode === schedule.departmentCode && item.remaining > 1
    );
    assert.ok(replacementSchedule);
    const disruptionCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "schedule disruption regression" })
    }));
    assert.equal(disruptionCandidate.response.status, 201);
    const disruptionOtherInstitutionLogin = await login(baseUrl, "community");
    const crossInstitutionDisruption = await api(baseUrl, `/api/registrations/orders/${disruptionCandidate.body.id}/disruption`, authorized(disruptionOtherInstitutionLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "notify", type: "doctor-unavailable", replacementScheduleId: replacementSchedule.id, acknowledgementDueAt: "2099-07-20T18:00:00.000Z", reason: "wrong institution notice" })
    }));
    assert.equal(crossInstitutionDisruption.response.status, 403);
    const invalidReplacement = await api(baseUrl, `/api/registrations/orders/${disruptionCandidate.body.id}/disruption`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "notify", type: "doctor-unavailable", replacementScheduleId: schedule.id, acknowledgementDueAt: "2099-07-20T18:00:00.000Z", reason: "same slot is invalid" })
    }));
    assert.equal(invalidReplacement.response.status, 400);
    const disruptionNotified = await api(baseUrl, `/api/registrations/orders/${disruptionCandidate.body.id}/disruption`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "notify", type: "doctor-unavailable", replacementScheduleId: replacementSchedule.id, acknowledgementDueAt: "2099-07-20T18:00:00.000Z", reason: "doctor clinic suspended" })
    }));
    assert.equal(disruptionNotified.response.status, 200);
    assert.equal(disruptionNotified.body.order.disruption.status, "pending-resident");
    assert.equal(disruptionNotified.body.order.disruption.originalSchedule.scheduleId, schedule.id);
    assert.equal(disruptionNotified.body.order.disruption.proposedSchedule.scheduleId, replacementSchedule.id);
    assert.equal(disruptionNotified.body.dashboard.summary.disruptionPending >= 1, true);
    const inventoryAtNotice = disruptionNotified.body.dashboard.schedules;
    const oldRemainingAtNotice = inventoryAtNotice.find((item) => item.id === schedule.id).remaining;
    const replacementRemainingAtNotice = inventoryAtNotice.find((item) => item.id === replacementSchedule.id).remaining;
    const blockedJourneyDuringDisruption = await api(baseUrl, `/api/registrations/orders/${disruptionCandidate.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "pay-demo", note: "must respond to disruption first" })
    }));
    assert.equal(blockedJourneyDuringDisruption.response.status, 409);
    const acceptedDisruption = await api(baseUrl, `/api/registrations/orders/${disruptionCandidate.body.id}/disruption`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "accept", note: "resident accepts replacement slot" })
    }));
    assert.equal(acceptedDisruption.response.status, 200);
    assert.equal(acceptedDisruption.body.order.scheduleId, replacementSchedule.id);
    assert.equal(acceptedDisruption.body.order.disruption.status, "accepted");
    assert.equal(acceptedDisruption.body.order.hisConfirmationStatus, "pending-demo");
    assert.equal(acceptedDisruption.body.order.productionReady, false);
    assert.equal(acceptedDisruption.body.dashboard.schedules.find((item) => item.id === schedule.id).remaining, oldRemainingAtNotice + 1);
    assert.equal(acceptedDisruption.body.dashboard.schedules.find((item) => item.id === replacementSchedule.id).remaining, replacementRemainingAtNotice - 1);
    assert.equal(acceptedDisruption.body.dashboard.summary.rescheduled >= 1, true);

    const disruptionCancelCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "disruption cancellation regression" })
    }));
    assert.equal(disruptionCancelCandidate.response.status, 201);
    assert.equal((await api(baseUrl, `/api/registrations/orders/${disruptionCancelCandidate.body.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "pay-demo", note: "paid before hospital disruption" })
    }))).response.status, 200);
    assert.equal((await api(baseUrl, `/api/registrations/orders/${disruptionCancelCandidate.body.id}/disruption`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "notify", type: "schedule-adjustment", replacementScheduleId: replacementSchedule.id, acknowledgementDueAt: "2099-07-20T18:00:00.000Z", reason: "outpatient schedule adjusted" })
    }))).response.status, 200);
    const cancelledDisruption = await api(baseUrl, `/api/registrations/orders/${disruptionCancelCandidate.body.id}/disruption`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "cancel", note: "resident declines replacement and requests refund" })
    }));
    assert.equal(cancelledDisruption.response.status, 200);
    assert.equal(cancelledDisruption.body.order.status, "cancelled");
    assert.equal(cancelledDisruption.body.order.disruption.status, "cancelled");
    assert.equal(cancelledDisruption.body.order.refundStatus, "refund-pending");
    assert.equal(cancelledDisruption.body.order.notificationDeliveries.some((item) => item.event === "registration-disruption-cancel"), true);

    const waitlistDashboard = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    const fullSchedule = waitlistDashboard.body.schedules.find((item) => item.id === "reg-sch-cardio-waitlist-am");
    assert.ok(fullSchedule);
    assert.equal(fullSchedule.remaining, 0);
    assert.equal(waitlistDashboard.body.integration.exchangeObjects.includes("registrationWaitlistEntries"), true);
    const joinedWaitlist = await api(baseUrl, "/api/registrations/waitlist", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: fullSchedule.id, preferredChannel: "sms", visitType: "onsite", note: "API regression full schedule waitlist" })
    }));
    assert.equal(joinedWaitlist.response.status, 201);
    assert.equal(joinedWaitlist.body.entry.status, "waiting");
    assert.equal(joinedWaitlist.body.entry.position, 1);
    assert.deepEqual(joinedWaitlist.body.entry.allowedActions, ["withdraw"]);
    const duplicateWaitlist = await api(baseUrl, "/api/registrations/waitlist", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: fullSchedule.id, preferredChannel: "sms", note: "duplicate waitlist must fail" })
    }));
    assert.equal(duplicateWaitlist.response.status, 409);
    const crossInstitutionWaitlist = await api(baseUrl, `/api/registrations/waitlist/${joinedWaitlist.body.entry.id}/actions`, authorized(disruptionOtherInstitutionLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "promote", note: "other institution cannot promote" })
    }));
    assert.equal(crossInstitutionWaitlist.response.status, 403);
    const promoteWithoutCapacity = await api(baseUrl, `/api/registrations/waitlist/${joinedWaitlist.body.entry.id}/actions`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "promote", note: "capacity is still full", offerMinutes: 30 })
    }));
    assert.equal(promoteWithoutCapacity.response.status, 409);
    const releasedWaitlistSlot = await api(baseUrl, "/api/registrations/orders/reg-r4-waitlist-capacity/cancel", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "release slot for automatic waitlist promotion" })
    }));
    assert.equal(releasedWaitlistSlot.response.status, 200);
    const promotedWaitlistDashboard = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    const promotedWaitlist = promotedWaitlistDashboard.body.waitlist.entries.find((item) => item.id === joinedWaitlist.body.entry.id);
    assert.equal(promotedWaitlist.status, "offer-pending");
    assert.equal(promotedWaitlist.position, null);
    assert.deepEqual(promotedWaitlist.allowedActions, ["accept", "decline"]);
    assert.equal(promotedWaitlist.notificationDeliveries.some((item) => item.event === "registration-waitlist-offer" && item.channel === "sms"), true);
    assert.equal(promotedWaitlistDashboard.body.schedules.find((item) => item.id === fullSchedule.id).remaining, 0);
    assert.equal(promotedWaitlistDashboard.body.schedules.find((item) => item.id === fullSchedule.id).waitlistHeld, 1);
    const acceptedWaitlist = await api(baseUrl, `/api/registrations/waitlist/${joinedWaitlist.body.entry.id}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "accept", note: "resident accepts automatically promoted slot" })
    }));
    assert.equal(acceptedWaitlist.response.status, 200);
    assert.equal(acceptedWaitlist.body.entry.status, "accepted");
    assert.equal(acceptedWaitlist.body.order.waitlistEntryId, joinedWaitlist.body.entry.id);
    assert.equal(acceptedWaitlist.body.order.scheduleId, fullSchedule.id);
    assert.equal(acceptedWaitlist.body.order.productionReady, false);
    assert.equal(acceptedWaitlist.body.dashboard.summary.waitlistAccepted >= 1, true);
    assert.equal(acceptedWaitlist.body.dashboard.schedules.find((item) => item.id === fullSchedule.id).waitlistHeld, 0);

    const registrationJourneyAudit = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(registrationJourneyAudit.body.securityEvents.some((item) => item.action === "registration-journey-action" && item.result === "allowed"), true);
    assert.equal(registrationJourneyAudit.body.securityEvents.some((item) => item.action === "registration-disruption-action" && item.result === "allowed"), true);
    assert.equal(registrationJourneyAudit.body.securityEvents.some((item) => item.action === "registration-waitlist-join" && item.result === "allowed"), true);
    assert.equal(registrationJourneyAudit.body.securityEvents.some((item) => item.action === "registration-waitlist-auto-promote" && item.result === "allowed"), true);
    assert.equal(registrationJourneyAudit.body.securityEvents.some((item) => item.action === "registration-waitlist-action" && item.detail === "accept:accepted"), true);

    const callbackCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "signed callback journey regression" })
    }));
    assert.equal(callbackCandidate.response.status, 201);
    const callbackPayload = (eventType, sequence, updates = {}) => ({
      contractId: "appointment-order-v1",
      idempotencyKey: `appointment-order-${callbackCandidate.body.id}-${sequence}`,
      externalId: `APPT-CALLBACK-${sequence}-${callbackCandidate.body.id}`,
      residentId: callbackCandidate.body.residentId,
      orderNo: callbackCandidate.body.registrationNo,
      slotId: callbackCandidate.body.scheduleId,
      eventType,
      orderStatus: eventType,
      occurredAt: `2026-07-10T12:0${sequence}:00.000Z`,
      ...updates
    });
    const postCallback = (token, payload) => api(baseUrl, "/api/integration/events", authorized(token, {
      method: "POST",
      headers: { "x-integration-signature": integrationSignature(payload) },
      body: JSON.stringify(payload)
    }));

    const paymentCallbackPayload = callbackPayload("payment-succeeded", 1, { receiptNo: "PAY-LIVE-REGRESSION-001" });
    const paymentCallback = await postCallback(hospitalRegistrationToken, paymentCallbackPayload);
    assert.equal(paymentCallback.response.status, 202);
    assert.equal(paymentCallback.body.contractId, "appointment-order-v1");
    assert.equal(paymentCallback.body.signatureVerified, true);
    assert.equal(paymentCallback.body.reconciliationStatus, "matched");
    assert.equal(paymentCallback.body.orderId, callbackCandidate.body.id);

    const paymentReplay = await postCallback(hospitalRegistrationToken, paymentCallbackPayload);
    assert.equal(paymentReplay.response.status, 200);
    assert.equal(paymentReplay.body.id, paymentCallback.body.id);
    assert.equal(paymentReplay.body.idempotentReplay, true);

    const hisCallback = await postCallback(hospitalRegistrationToken, callbackPayload("his-confirmed", 2));
    assert.equal(hisCallback.response.status, 202);
    assert.equal(hisCallback.body.reconciliationStatus, "matched");
    const insuranceCallback = await postCallback(insuranceRegistrationLogin.body.token, callbackPayload("insurance-confirmed", 3, { settlementNo: "MI-LIVE-001", coverage: 12 }));
    assert.equal(insuranceCallback.response.status, 202);
    assert.equal(insuranceCallback.body.reconciliationStatus, "matched");
    const checkInCallback = await postCallback(hospitalRegistrationToken, callbackPayload("checked-in", 4, { checkInNo: "CHECKIN-LIVE-001" }));
    assert.equal(checkInCallback.response.status, 202);
    const completionCallback = await postCallback(hospitalRegistrationToken, callbackPayload("completed", 5, { completionNo: "COMPLETE-LIVE-001" }));
    assert.equal(completionCallback.response.status, 202);

    const callbackDashboard = await api(baseUrl, "/api/registrations/dashboard", authorized(citizenToken));
    const callbackOrder = callbackDashboard.body.orders.find((item) => item.id === callbackCandidate.body.id);
    assert.equal(callbackOrder.status, "completed");
    assert.equal(callbackOrder.paymentStatus, "paid");
    assert.equal(callbackOrder.hisConfirmationStatus, "confirmed");
    assert.equal(callbackOrder.insuranceStatus, "confirmed");
    assert.equal(callbackOrder.checkInStatus, "checked-in");
    assert.equal(callbackOrder.journeyStage, "completed-callback");
    assert.equal(callbackOrder.productionReady, false);
    assert.equal(callbackDashboard.body.integrationCenter, null);

    const callbackCenter = await api(baseUrl, "/api/registrations/integration-center", authorized(hospitalRegistrationToken));
    assert.equal(callbackCenter.response.status, 200);
    assert.equal(callbackCenter.body.contract.id, "appointment-order-v1");
    assert.equal(callbackCenter.body.summary.callbacks >= 5, true);
    assert.equal(callbackCenter.body.summary.matched >= 5, true);
    assert.equal(callbackCenter.body.summary.productionReady, 0);
    assert.equal(callbackCenter.body.events.every((item) => item.hospitalCode === "MR1"), true);

    const retryCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "dead-letter retry regression" })
    }));
    assert.equal(retryCandidate.response.status, 201);
    const retryPayload = (eventType, sequence) => ({
      contractId: "appointment-order-v1",
      idempotencyKey: `appointment-retry-${retryCandidate.body.id}-${sequence}`,
      externalId: `APPT-RETRY-${sequence}-${retryCandidate.body.id}`,
      residentId: retryCandidate.body.residentId,
      orderNo: retryCandidate.body.registrationNo,
      slotId: retryCandidate.body.scheduleId,
      eventType,
      orderStatus: eventType,
      occurredAt: `2026-07-10T13:0${sequence}:00.000Z`
    });
    const earlyCheckInPayload = retryPayload("checked-in", 1);
    const earlyCheckIn = await postCallback(hospitalRegistrationToken, earlyCheckInPayload);
    assert.equal(earlyCheckIn.response.status, 202);
    assert.equal(earlyCheckIn.body.deadLetter, true);
    assert.match(earlyCheckIn.body.deadLetterReason, /requires an open order with payment and HIS confirmation/);
    const retryWithoutNote = await api(baseUrl, `/api/registrations/integration-events/${earlyCheckIn.body.id}/retry`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ note: "" })
    }));
    assert.equal(retryWithoutNote.response.status, 400);
    const otherInstitutionLogin = await login(baseUrl, "community");
    const crossInstitutionRetry = await api(baseUrl, `/api/registrations/integration-events/${earlyCheckIn.body.id}/retry`, authorized(otherInstitutionLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ note: "other institution must not retry" })
    }));
    assert.equal(crossInstitutionRetry.response.status, 403);
    const failedInstitutionRetry = await api(baseUrl, `/api/registrations/integration-events/${earlyCheckIn.body.id}/retry`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ note: "first retry before prerequisites" })
    }));
    assert.equal(failedInstitutionRetry.response.status, 200);
    assert.equal(failedInstitutionRetry.body.ok, false);
    assert.equal(failedInstitutionRetry.body.event.deadLetter, true);
    assert.equal(failedInstitutionRetry.body.event.retryCount, 1);
    assert.equal(failedInstitutionRetry.body.event.lastRetryResult, "failed");
    assert.equal((await postCallback(hospitalRegistrationToken, retryPayload("payment-succeeded", 2))).response.status, 202);
    assert.equal((await postCallback(hospitalRegistrationToken, retryPayload("his-confirmed", 3))).response.status, 202);
    const retriedCheckIn = await api(baseUrl, `/api/registrations/integration-events/${earlyCheckIn.body.id}/retry`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ note: "payment and HIS prerequisites landed" })
    }));
    assert.equal(retriedCheckIn.response.status, 200);
    assert.equal(retriedCheckIn.body.ok, true);
    assert.equal(retriedCheckIn.body.event.deadLetter, false);
    assert.equal(retriedCheckIn.body.event.reconciliationStatus, "matched");
    assert.equal(retriedCheckIn.body.event.retryCount, 2);
    assert.equal(retriedCheckIn.body.event.lastRetryNote, "payment and HIS prerequisites landed");
    assert.equal(retriedCheckIn.body.dashboard.integrationCenter.summary.deadLetters, 0);

    const registrationIntegrationAudit = await api(baseUrl, "/api/state", authorized(commissionToken));
    const retriedOrder = registrationIntegrationAudit.body.registrationOrders.find((item) => item.id === retryCandidate.body.id);
    assert.equal(retriedOrder.checkInStatus, "checked-in");
    assert.equal(retriedOrder.auditTrail.some((item) => item.action === "integration-checked-in" && item.idempotencyKey === earlyCheckInPayload.idempotencyKey), true);
    assert.equal(registrationIntegrationAudit.body.integrationGatewayEvents.some((item) => item.id === earlyCheckIn.body.id && item.reconciliationStatus === "matched"), true);
    assert.equal(registrationIntegrationAudit.body.securityEvents.some((item) => item.action === "重试预约回调死信" && item.target === earlyCheckIn.body.id && item.result === "允许"), true);

    const manualCandidate = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", scheduleId: schedule.id, visitType: "onsite", reason: "manual reconciliation regression" })
    }));
    assert.equal(manualCandidate.response.status, 201);
    const manualPayload = {
      contractId: "appointment-order-v1",
      idempotencyKey: `appointment-manual-${manualCandidate.body.id}`,
      externalId: `APPT-MANUAL-${manualCandidate.body.id}`,
      residentId: manualCandidate.body.residentId,
      orderNo: manualCandidate.body.registrationNo,
      slotId: manualCandidate.body.scheduleId,
      eventType: "checked-in",
      orderStatus: "checked-in",
      occurredAt: "2026-07-10T13:30:00.000Z"
    };
    const manualDeadLetter = await postCallback(hospitalRegistrationToken, manualPayload);
    assert.equal(manualDeadLetter.response.status, 202);
    assert.equal(manualDeadLetter.body.deadLetter, true);
    const prematureAssignment = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "assign", owner: "hospital integration owner", dueAt: "2026-07-20", priority: "P0", note: "premature manual assignment" })
    }));
    assert.equal(prematureAssignment.response.status, 409);
    let exhaustedRetry;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      exhaustedRetry = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/retry`, authorized(hospitalRegistrationToken, {
        method: "POST",
        body: JSON.stringify({ note: `manual case retry ${attempt}` })
      }));
      assert.equal(exhaustedRetry.response.status, 200);
      assert.equal(exhaustedRetry.body.event.deadLetter, true);
      assert.equal(exhaustedRetry.body.event.retryCount, attempt);
    }
    const retryAfterLimit = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/retry`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ note: "retry after limit" })
    }));
    assert.equal(retryAfterLimit.response.status, 409);
    const crossInstitutionAssignment = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(otherInstitutionLogin.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "assign", owner: "wrong institution", dueAt: "2026-07-20", priority: "P1", note: "cross institution assignment" })
    }));
    assert.equal(crossInstitutionAssignment.response.status, 403);
    const missingOwnerAssignment = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "assign", owner: "", dueAt: "2026-07-20", priority: "P1", note: "owner is required" })
    }));
    assert.equal(missingOwnerAssignment.response.status, 400);
    const assignedManualCase = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "assign", owner: "hospital integration owner", dueAt: "2026-07-20", priority: "P0", note: "automatic retries exhausted" })
    }));
    assert.equal(assignedManualCase.response.status, 200);
    assert.equal(assignedManualCase.body.event.reconciliationStatus, "manual-review");
    assert.equal(assignedManualCase.body.event.manualReconciliation.status, "assigned");
    assert.equal(assignedManualCase.body.dashboard.integrationCenter.summary.openManualCases, 1);
    const resolveWithoutEvidence = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "resolve", resolution: "manual-compensation", evidenceRef: "", note: "evidence is required" })
    }));
    assert.equal(resolveWithoutEvidence.response.status, 400);
    const resolvedManualCase = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "resolve", resolution: "manual-compensation", evidenceRef: "PAYMENT-RECON-RECEIPT-001", note: "manual compensation receipt verified" })
    }));
    assert.equal(resolvedManualCase.response.status, 200);
    assert.equal(resolvedManualCase.body.event.deadLetter, false);
    assert.equal(resolvedManualCase.body.event.reconciliationStatus, "manual-resolved");
    assert.equal(resolvedManualCase.body.event.manualReconciliation.status, "resolved");
    assert.equal(resolvedManualCase.body.event.manualReconciliation.productionEvidence, false);
    assert.equal(resolvedManualCase.body.dashboard.integrationCenter.summary.resolvedManualCases, 1);
    const reopenedManualCase = await api(baseUrl, `/api/registrations/integration-events/${manualDeadLetter.body.id}/reconciliation`, authorized(hospitalRegistrationToken, {
      method: "POST",
      body: JSON.stringify({ action: "reopen", note: "receipt requires a second review" })
    }));
    assert.equal(reopenedManualCase.response.status, 200);
    assert.equal(reopenedManualCase.body.event.deadLetter, true);
    assert.equal(reopenedManualCase.body.event.manualReconciliation.status, "assigned");
    const manualCaseState = await api(baseUrl, "/api/state", authorized(commissionToken));
    const unchangedManualOrder = manualCaseState.body.registrationOrders.find((item) => item.id === manualCandidate.body.id);
    assert.equal(unchangedManualOrder.checkInStatus, "not-checked-in");
    assert.equal(manualCaseState.body.securityEvents.some((item) => item.action === "预约回调人工对账-assign" && item.target === manualDeadLetter.body.id), true);
    assert.equal(manualCaseState.body.securityEvents.some((item) => item.action === "预约回调人工对账-resolve" && item.target === manualDeadLetter.body.id), true);
    assert.equal(manualCaseState.body.securityEvents.some((item) => item.action === "预约回调人工对账-reopen" && item.target === manualDeadLetter.body.id), true);

    const denied = await api(baseUrl, "/api/registrations/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", scheduleId: schedule.id, reason: "scope violation" })
    }));
    assert.equal(denied.response.status, 403);
  });

  await t.test("guards mobile internet nursing appointments for launch", async () => {
    const dashboard = await api(baseUrl, "/api/internet-nursing/dashboard", authorized(citizenToken));
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.siteCutoverPack.status, "ready-for-site-signoff");
    assert.equal(dashboard.body.siteCutoverPack.productionReadiness, "production-blocked");
    assert.equal(dashboard.body.siteCutoverPack.tracks.length, 5);
    assert.equal(dashboard.body.siteCutoverPack.tracks.some((item) => item.id === "nursing-cutover-payment-reconciliation"), true);
    assert.equal(dashboard.body.siteCutoverPack.productionBlockers.some((item) => item.source === "audit-retention" && /AUDIT_EXPORT_PATH/.test(item.requiredAction)), true);

    const institution = dashboard.body.institutions.find((item) => item.id === "inh-mr1");
    assert.ok(institution);

    const created = await api(baseUrl, "/api/internet-nursing/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        institutionId: institution.id,
        serviceItem: "wound care",
        serviceObject: "mobility-limited chronic disease patient",
        preferredAt: "2026-06-27",
        address: "中山区手机端预约测试地址",
        riskLevel: "high",
        status: "completed",
        nurseId: "inn-001",
        firstVisitAssessment: "passed",
        informedConsent: "signed",
        sourceChannel: "internet-nursing-mobile"
      })
    }));
    assert.equal(created.response.status, 201);
    assert.equal(created.body.sourceChannel, "internet-nursing-mobile");
    assert.equal(created.body.status, "requested");
    assert.equal(created.body.nurseId, "");
    assert.equal(created.body.firstVisitAssessment, "pending");
    assert.equal(created.body.informedConsent, "pending");
    assert.equal(created.body.consentAttachment.status, "pending");
    assert.equal(Array.isArray(created.body.locationTracePoints), true);
    assert.equal(created.body.locationTracePoints.length, 0);
    assert.equal(created.body.notificationDeliveries.some((item) => item.event === "appointment-submitted" && item.channel === "sms" && item.status === "queued"), true);
    assert.equal(created.body.notificationDeliveries.some((item) => item.event === "appointment-submitted" && item.channel === "hospital_message"), true);
    const nursingServiceOrders = await api(baseUrl, "/api/service-orders?residentId=r1&serviceType=nursing", authorized(citizenToken));
    assert.equal(nursingServiceOrders.response.status, 200);
    assert.equal(nursingServiceOrders.body.orders.some((item) => item.sourceCollection === "internetNursingOrders" && item.sourceId === created.body.id && item.serviceType === "nursing"), true);

    const hospitalLogin = await login(baseUrl, "hospital");
    const hospitalToken = hospitalLogin.body.token;
    const assessed = await api(baseUrl, `/api/internet-nursing/orders/${created.body.id}/actions`, authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        action: "first-visit-assessment",
        status: "assessed",
        firstVisitAssessment: "passed",
        informedConsent: "signed",
        consentAttachment: {
          status: "signed",
          type: "electronic-informed-consent",
          version: "internet-nursing-consent-v1",
          signerName: "演示居民A",
          attachmentName: "internet-nursing-informed-consent.pdf"
        }
      })
    }));
    assert.equal(assessed.response.status, 200);
    assert.equal(assessed.body.firstVisitAssessment, "passed");
    assert.equal(assessed.body.consentAttachment.status, "signed");

    const reassessedWithExternalConsent = await api(baseUrl, `/api/internet-nursing/orders/${created.body.id}/actions`, authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        action: "first-visit-assessment",
        status: "assessed",
        firstVisitAssessment: "passed",
        informedConsent: "signed",
        consentSignerName: "External Consent Signer",
        consentVersion: "internet-nursing-consent-v2",
        consentAttachmentName: "external-consent.pdf",
        consentSignedAt: "2026-06-27T08:30:00+08:00"
      })
    }));
    assert.equal(reassessedWithExternalConsent.response.status, 200);
    assert.equal(reassessedWithExternalConsent.body.consentAttachment.signerName, "External Consent Signer");
    assert.equal(reassessedWithExternalConsent.body.consentAttachment.version, "internet-nursing-consent-v2");
    assert.equal(reassessedWithExternalConsent.body.consentAttachment.attachmentName, "external-consent.pdf");

    const dispatched = await api(baseUrl, `/api/internet-nursing/orders/${created.body.id}/actions`, authorized(hospitalToken, {
      method: "POST",
      body: JSON.stringify({
        action: "dispatch-qualified-nurse",
        status: "dispatched",
        nurseId: "inn-001"
      })
    }));
    assert.equal(dispatched.response.status, 200);
    assert.equal(dispatched.body.status, "dispatched");
    assert.equal(dispatched.body.nurseId, "inn-001");

    const nurseLoginForClosedLoop = await login(baseUrl, "nurse");
    const nurseAccepted = await api(baseUrl, `/api/internet-nursing/orders/${created.body.id}/actions`, authorized(nurseLoginForClosedLoop.body.token, {
      method: "POST",
      body: JSON.stringify({
        action: "nurse-accept",
        status: "accepted",
        nurseId: "inn-001",
        tracePoint: { stage: "nurse-accept", lat: 38.914, lng: 121.614, source: "nurse-mobile" }
      })
    }));
    assert.equal(nurseAccepted.response.status, 200);
    assert.equal(nurseAccepted.body.status, "accepted");
    assert.equal(nurseAccepted.body.locationTrace, "tracking");
    assert.equal(nurseAccepted.body.locationTracePoints.some((item) => item.stage === "nurse-accept" && item.verified === true), true);
    assert.equal(nurseAccepted.body.notificationDeliveries.some((item) => item.event === "nurse-accept" && item.channel === "sms"), true);

    const closedLoopDashboard = await api(baseUrl, "/api/internet-nursing/dashboard", authorized(citizenToken));
    const closedLoopOrder = closedLoopDashboard.body.orders.find((item) => item.id === created.body.id);
    assert.equal(closedLoopOrder.status, "accepted");
    assert.equal(closedLoopOrder.nurseId, "inn-001");
    assert.equal(closedLoopOrder.locationTrace, "tracking");

    const residentConfirmation = await api(baseUrl, `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "resident-confirm", comment: "居民确认护理预约" })
    }));
    assert.equal(residentConfirmation.response.status, 200);
    assert.equal(residentConfirmation.body.residentServiceConfirmation, "confirmed");

    const nursingQuality = await api(baseUrl, `/api/tasks/${encodeURIComponent(`internetNursingOrders:${created.body.id}`)}/actions`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ action: "quality-feedback", comment: "护理服务已评价", satisfaction: "满意" })
    }));
    assert.equal(nursingQuality.response.status, 200);
    assert.equal(nursingQuality.body.qualityCallback, "citizen-feedback");
    assert.equal(nursingQuality.body.satisfaction, "满意");

    const unsupportedService = await api(baseUrl, "/api/internet-nursing/orders", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        institutionId: institution.id,
        serviceItem: "vital signs measurement",
        serviceObject: "elderly or disabled people",
        preferredAt: "2026-06-28",
        address: "中山区手机端预约测试地址"
      })
    }));
    assert.equal(unsupportedService.response.status, 400);
    assert.match(unsupportedService.body.message, /does not publish/);
  });

  await t.test("scopes internet nursing nurse actions to own workstation orders", async () => {
    const nurseLogin = await login(baseUrl, "nurse");
    assert.equal(nurseLogin.response.status, 200);
    assert.equal(nurseLogin.body.user.accountType, "nurse");
    const nurseToken = nurseLogin.body.token;

    const dashboard = await api(baseUrl, "/api/internet-nursing/dashboard", authorized(nurseToken));
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.body.ok, true);
    assert.equal(dashboard.body.orders.every((item) => item.nurseId !== "inn-002"), true);
    assert.equal(dashboard.body.nurseQueue.some((item) => item.id === "ino-001"), true);

    const otherNurseOrder = await api(baseUrl, "/api/internet-nursing/orders/ino-002/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "nurse-accept",
        status: "accepted",
        nurseId: "inn-001"
      })
    }));
    assert.equal(otherNurseOrder.response.status, 403);

    const spoofedNurse = await api(baseUrl, "/api/internet-nursing/orders/ino-001/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "nurse-accept",
        status: "accepted",
        nurseId: "inn-002"
      })
    }));
    assert.equal(spoofedNurse.response.status, 400);
    assert.match(spoofedNurse.body.message, /own workstation orders/);

    const prematureComplete = await api(baseUrl, "/api/internet-nursing/orders/ino-001/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "service-complete",
        status: "completed",
        nurseId: "inn-001",
        serviceRecordStatus: "completed"
      })
    }));
    assert.equal(prematureComplete.response.status, 400);
    assert.match(prematureComplete.body.message, /in service before completion/);

    const accepted = await api(baseUrl, "/api/internet-nursing/orders/ino-001/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "nurse-accept",
        status: "accepted",
        nurseId: "inn-001"
      })
    }));
    assert.equal(accepted.response.status, 200);
    assert.equal(accepted.body.status, "accepted");
    assert.equal(accepted.body.nurseId, "inn-001");
    assert.equal(accepted.body.locationTrace, "tracking");
    assert.equal(accepted.body.locationTracePoints.some((item) => item.stage === "nurse-accept"), true);
    assert.equal(accepted.body.notificationDeliveries.some((item) => item.event === "nurse-accept" && item.channel === "sms"), true);
    assert.equal(accepted.body.auditTrail.some((item) => item.action === "nurse-accept"), true);

    const started = await api(baseUrl, "/api/internet-nursing/orders/ino-001/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "service-start",
        status: "in-service",
        nurseId: "inn-001",
        serviceRecordStatus: "in-progress",
        tracePoint: { stage: "service-start", lat: 38.915, lng: 121.616, source: "nurse-mobile" }
      })
    }));
    assert.equal(started.response.status, 200);
    assert.equal(started.body.status, "in-service");
    assert.equal(started.body.locationTracePoints.some((item) => item.stage === "service-start" && item.verified === true), true);
    assert.equal(started.body.notificationDeliveries.some((item) => item.event === "service-start" && item.channel === "hospital_message"), true);

    const completed = await api(baseUrl, "/api/internet-nursing/orders/ino-001/actions", authorized(nurseToken, {
      method: "POST",
      body: JSON.stringify({
        action: "service-complete",
        status: "completed",
        nurseId: "inn-001",
        serviceRecordStatus: "completed",
        tracePoint: { stage: "service-complete", lat: 38.916, lng: 121.617, source: "nurse-mobile" },
        serviceRecord: {
          status: "completed",
          vitalSigns: { temperature: "36.6", pulse: "78", bloodPressure: "126/78" },
          careActions: ["核对身份与医嘱", "完成伤口护理", "居民状态复核"],
          materialsUsed: ["一次性护理包", "消毒用品"],
          residentCondition: "服务后状态平稳",
          followupAdvice: "如出现红肿渗液及时联系机构",
          exceptionReport: { status: "none", level: "", description: "" }
        },
        serviceAttachments: [
          { type: "nursing-record-photo", name: "wound-care-photo.jpg", source: "nurse-mobile" },
          { type: "resident-signature", name: "resident-confirmation.png", source: "nurse-mobile" }
        ],
        notificationReceipts: [{ by: "nurse", role: "institution", status: "read" }]
      })
    }));
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.serviceRecordStatus, "completed");
    assert.equal(completed.body.serviceRecord.status, "completed");
    assert.equal(completed.body.serviceRecord.careActions.includes("完成伤口护理"), true);
    assert.equal(completed.body.serviceRecord.attachmentCount, 2);
    assert.equal(completed.body.serviceAttachments.length, 2);
    assert.equal(completed.body.adverseEvent.status, "none");
    assert.equal(completed.body.notificationReceiptSummary.read >= 1, true);
    assert.equal(completed.body.locationTracePoints.some((item) => item.stage === "service-complete"), true);
    assert.equal(completed.body.notificationDeliveries.some((item) => item.event === "service-complete" && item.channel === "sms"), true);
  });

  await t.test("enforces personal record ownership and protects record identity", async () => {
    const ownRecords = await api(baseUrl, "/api/personal-records?residentId=r1", authorized(citizenToken));
    assert.equal(ownRecords.response.status, 200);
    assert.ok(Array.isArray(ownRecords.body));
    assert.match(ownRecords.body[0].personIndex, /^已脱敏-/);

    const otherRecords = await api(baseUrl, "/api/personal-records?residentId=r2", authorized(citizenToken));
    assert.equal(otherRecords.response.status, 403);

    const created = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ id: "client-controlled-id", residentId: "r1", category: "self-upload", name: "居民自测记录", result: "正常", expectedVersion: 20260701 })
    }));
    assert.equal(created.response.status, 201);
    assert.notEqual(created.body.id, "client-controlled-id");
    assert.equal(created.body.residentId, "r1");

    const patched = await api(baseUrl, `/api/personal-records/${created.body.id}`, authorized(citizenToken, {
      method: "PATCH",
      body: JSON.stringify({ id: "tampered", residentId: "r2", result: "已复核", expectedVersion: 20260703, meta: { sourceTrust: "居民确认" } })
    }));
    assert.equal(patched.response.status, 200);
    assert.equal(patched.body.id, created.body.id);
    assert.equal(patched.body.residentId, "r1");
    assert.equal(patched.body.result, "已复核");
    assert.equal(patched.body.meta.sourceTrust, "居民确认");

    const missingPatch = await api(baseUrl, "/api/personal-records/not-found-record", authorized(citizenToken, {
      method: "PATCH",
      body: JSON.stringify({ result: "not found regression" })
    }));
    assert.equal(missingPatch.response.status, 404);

    const commissionR2Records = await api(baseUrl, "/api/personal-records?residentId=r2", authorized(commissionToken));
    assert.equal(commissionR2Records.response.status, 200);
    assert.equal(commissionR2Records.body.length > 0, true);
    const forbiddenPatch = await api(baseUrl, `/api/personal-records/${commissionR2Records.body[0].id}`, authorized(citizenToken, {
      method: "PATCH",
      body: JSON.stringify({ result: "forbidden regression" })
    }));
    assert.equal(forbiddenPatch.response.status, 403);

    const versionedCreate = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", category: "self-upload", name: "versioned record", result: "ok", expectedVersion: 43 })
    }));
    assert.equal(versionedCreate.response.status, 201);
    assert.equal(versionedCreate.body.residentId, "r1");

    const forbiddenCreate = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", category: "self-upload", name: "越权记录" })
    }));
    assert.equal(forbiddenCreate.response.status, 403);
  });

  await t.test("supports authorization revocation and access history review", async () => {
    const authorizations = await api(baseUrl, "/api/personal-records?residentId=r1&category=authorizations", authorized(citizenToken));
    assert.equal(authorizations.response.status, 200);
    assert.ok(authorizations.body.length > 0);
    const authorizationId = authorizations.body[0].id;

    const missingRevoke = await api(baseUrl, "/api/authorizations/missing-authorization/revoke", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "missing authorization regression" })
    }));
    assert.equal(missingRevoke.response.status, 404);

    const otherAuthorizations = await api(baseUrl, "/api/personal-records?residentId=r2&category=authorizations", authorized(commissionToken));
    assert.equal(otherAuthorizations.response.status, 200);
    assert.equal(otherAuthorizations.body.length > 0, true);
    const forbiddenRevoke = await api(baseUrl, `/api/authorizations/${otherAuthorizations.body[0].id}/revoke`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "forbidden authorization regression" })
    }));
    assert.equal(forbiddenRevoke.response.status, 403);

    const revoked = await api(baseUrl, `/api/authorizations/${authorizationId}/revoke`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "居民主动撤销测试授权", expectedVersion: 20260702 })
    }));
    assert.equal(revoked.response.status, 200);
    assert.equal(revoked.body.status, "已撤销");
    assert.equal(revoked.body.revokeReason, "居民主动撤销测试授权");

    const review = await api(baseUrl, "/api/access-reviews?residentId=r1", authorized(citizenToken));
    assert.equal(review.response.status, 200);
    assert.equal(review.body.authorizations.some((item) => item.id === authorizationId && item.status === "已撤销"), true);
    assert.equal(review.body.accessLogs.some((item) => item.scope === "授权撤销"), true);
    assert.match(review.body.accessLogs[0].personIndex, /^已脱敏-/);

    const institution = await login(baseUrl, "hospital");
    const blockedTeleconsultation = await api(baseUrl, "/api/referral-teleconsultations", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        residentAuthorizationId: authorizationId,
        type: "teleconsultation",
        diseaseType: "hypertension",
        targetInstitution: "County teleconsultation center",
        targetInstitutionCode: "ORG-COUNTY-CENTER",
        department: "Cardiology",
        clinicalQuestion: "Should medication be adjusted after abnormal home blood pressure?"
      })
    }));
    assert.equal(blockedTeleconsultation.response.status, 400);
    assert.equal(blockedTeleconsultation.body.message, "resident authorization is required before referral teleconsultation");

    const securityAudit = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(commissionToken));
    assert.equal(securityAudit.response.status, 200);
    assert.equal(securityAudit.body.securityEvents.some((item) =>
      item.action === "create referral teleconsultation" &&
      item.target === "r1" &&
      item.result === "denied" &&
      /resident authorization is required/.test(item.detail)
    ), true);

    const versionedAuthorization = await api(baseUrl, "/api/personal-records", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", category: "authorizations", name: "versioned authorization", result: "active" })
    }));
    assert.equal(versionedAuthorization.response.status, 201);
    const versionedRevoked = await api(baseUrl, `/api/authorizations/${versionedAuthorization.body.id}/revoke`, authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ reason: "versioned revoke", expectedVersion: 44 })
    }));
    assert.equal(versionedRevoked.response.status, 200);
    assert.equal(versionedRevoked.body.revokeReason, "versioned revoke");

    const forbiddenReview = await api(baseUrl, "/api/access-reviews?residentId=r2", authorized(citizenToken));
    assert.equal(forbiddenReview.response.status, 403);
  });

  await t.test("enforces certificate roles and resident scope", async () => {
    const ownBirth = await api(baseUrl, "/api/birth-certificates?residentId=r1", authorized(citizenToken));
    assert.equal(ownBirth.response.status, 200);
    assert.ok(ownBirth.body.certificates.every((item) => item.maternalResidentId === "r1" || item.residentId === "r1"));
    assert.match(ownBirth.body.certificates[0].certificateNo, /^已脱敏-/);
    assert.match(ownBirth.body.certificates[0].motherDocumentNo, /^已脱敏-/);

    const otherBirth = await api(baseUrl, "/api/birth-certificates?residentId=r2", authorized(citizenToken));
    assert.equal(otherBirth.response.status, 403);

    const citizenBirthWrite = await api(baseUrl, "/api/birth-certificates", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ maternalResidentId: "r1", newbornName: "测试新生儿" })
    }));
    assert.equal(citizenBirthWrite.response.status, 403);

    const citizenDeathRead = await api(baseUrl, "/api/death-certificates?residentId=r1", authorized(citizenToken));
    assert.equal(citizenDeathRead.response.status, 403);

    const institution = await login(baseUrl, "hospital");
    const birthCreated = await api(baseUrl, "/api/birth-certificates", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ maternalResidentId: "r1", certificateNo: "BC-TEST-001", newbornName: "测试新生儿", newbornGender: "女" })
    }));
    assert.equal(birthCreated.response.status, 201);
    assert.equal(birthCreated.body.maternalResidentId, "r1");
    assert.equal(birthCreated.body.createdBy, "hospital");

    const birthStatsAfterCreate = await api(baseUrl, "/api/birth-certificates", authorized(institution.body.token));
    assert.equal(birthStatsAfterCreate.response.status, 200);
    assert.equal(
      birthStatsAfterCreate.body.statistics.metrics.total,
      birthStatsAfterCreate.body.certificates.length
    );

    const birthReported = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "birthCertificates",
        id: birthCreated.body.id,
        status: "已上报",
        updates: {
          publicSecuritySync: "已共享",
          maternalChildSync: "已入册",
          healthManagementStatus: "已建档"
        },
        note: "出生医学证明上报入册"
      })
    }));
    assert.equal(birthReported.response.status, 200);
    assert.equal(birthReported.body.publicSecuritySync, "已共享");
    assert.equal(birthReported.body.maternalChildSync, "已入册");
    const birthStatsAfterWorkflow = await api(baseUrl, "/api/birth-certificates", authorized(institution.body.token));
    assert.equal(birthStatsAfterWorkflow.response.status, 200);
    assert.equal(
      birthStatsAfterWorkflow.body.statistics.metrics.pendingPublicSecuritySync,
      birthStatsAfterWorkflow.body.certificates.filter((item) => !String(item.publicSecuritySync || "").includes("已共享")).length
    );
    assert.equal(
      birthStatsAfterWorkflow.body.statistics.metrics.pendingMaternalChildSync,
      birthStatsAfterWorkflow.body.certificates.filter((item) => !String(item.maternalChildSync || "").includes("已入册")).length
    );

    const deathCreated = await api(baseUrl, "/api/death-certificates", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", certificateNo: "DC-TEST-001", immediateCause: "测试原因", underlyingCause: "测试基础疾病" })
    }));
    assert.equal(deathCreated.response.status, 201);
    assert.equal(deathCreated.body.residentId, "r1");
    assert.equal(deathCreated.body.createdBy, "hospital");
  });

  await t.test("rejects citizen writes to commission state and statistics APIs", async () => {
    const stateWrite = await api(baseUrl, "/api/state", authorized(citizenToken, {
      method: "PUT",
      body: JSON.stringify({ residents: [] })
    }));
    assert.equal(stateWrite.response.status, 403);

    const statisticsWrite = await api(baseUrl, "/api/health-statistics/import-jobs", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ name: "越权任务" })
    }));
    assert.equal(statisticsWrite.response.status, 403);

    const workflowWrite = await api(baseUrl, "/api/workflow-actions", authorized(citizenToken, {
      method: "POST",
      body: JSON.stringify({ collection: "insuranceClaims", id: "ic1", status: "已通过" })
    }));
    assert.equal(workflowWrite.response.status, 403);

    const hospital = await login(baseUrl, "hospital");
    const outOfScopeTeleconsultationWrite = await api(baseUrl, "/api/workflow-actions", authorized(hospital.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "referralTeleconsultations", id: "rtc-002", status: "已接收" })
    }));
    assert.equal(outOfScopeTeleconsultationWrite.response.status, 403);

    const referralTeleconsultations = await api(baseUrl, "/api/referral-teleconsultations", authorized(citizenToken));
    assert.equal(referralTeleconsultations.response.status, 403);
  });

  await t.test("accepts signed idempotent integration gateway events", async (t) => {
    const institution = await login(baseUrl, "hospital");
    const contracts = await api(baseUrl, "/api/integration/contracts", authorized(institution.body.token));
    assert.equal(contracts.response.status, 200);
    assert.equal(contracts.body.contracts.some((item) => item.id === "his-patient-v1"), true);

    const samples = await api(baseUrl, "/api/integration/samples?contractId=his-patient-v1", authorized(institution.body.token));
    assert.equal(samples.response.status, 200);
    assert.equal(samples.body.samples.length, 1);
    assert.equal(samples.body.samples[0].payload.contractId, "his-patient-v1");
    assert.equal(samples.body.samples[0].signature, integrationSignature(samples.body.samples[0].payload));

    const eventPayload = {
      contractId: "his-patient-v1",
      idempotencyKey: "his-r1-visit-001",
      externalId: "HIS-VISIT-001",
      residentId: "r1",
      institution: "大连市中心医院",
      visitedAt: "2026-06-21T10:00:00.000Z",
      payload: { diagnosis: "高血压复诊" }
    };
    const unsigned = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(unsigned.response.status, 401);

    const accepted = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      headers: { "x-integration-signature": integrationSignature(eventPayload) },
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(accepted.response.status, 202);
    assert.equal(accepted.body.contractId, "his-patient-v1");
    assert.equal(accepted.body.idempotencyKey, "his-r1-visit-001");
    assert.equal(accepted.body.reconciliationStatus, "待对账");

    const replay = await api(baseUrl, "/api/integration/events", authorized(institution.body.token, {
      method: "POST",
      headers: { "x-integration-signature": integrationSignature(eventPayload) },
      body: JSON.stringify(eventPayload)
    }));
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.id, accepted.body.id);
    assert.equal(replay.body.idempotentReplay, true);

    const commission = await login(baseUrl, "health");

    const hospitalRequests = [];
    const hospitalMock = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString("utf8");
      hospitalRequests.push({ headers: request.headers, bodyText, body: JSON.parse(bodyText) });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ receiptId: `his-provider-${hospitalRequests.length}`, status: "accepted" }));
    });
    hospitalMock.listen(0, "127.0.0.1");
    await once(hospitalMock, "listening");
    const hospitalPort = hospitalMock.address().port;
    process.env.HIS_ADAPTER_URL = `http://127.0.0.1:${hospitalPort}/his/events`;
    process.env.HIS_ADAPTER_SECRET = "api-test-his-adapter-secret";
    process.env.HOSPITAL_ADAPTER_MAX_ATTEMPTS = "1";
    t.after(async () => {
      delete process.env.HIS_ADAPTER_URL;
      delete process.env.HIS_ADAPTER_SECRET;
      delete process.env.HOSPITAL_ADAPTER_MAX_ATTEMPTS;
      await new Promise((resolve) => hospitalMock.close(resolve));
    });

    const adapters = await api(baseUrl, "/api/integration/adapters", authorized(institution.body.token));
    assert.equal(adapters.response.status, 200);
    assert.equal(adapters.body.summary.total, 5);
    assert.equal(adapters.body.summary.configured, 1);
    assert.equal(adapters.body.connectors.find((item) => item.domain === "HIS").configured, true);
    assert.equal(JSON.stringify(adapters.body).includes(String(hospitalPort)), false);
    assert.equal(JSON.stringify(adapters.body).includes("api-test-his-adapter-secret"), false);

    const residentForAdapter = await login(baseUrl, "citizen");
    const deniedAdapters = await api(baseUrl, "/api/integration/adapters", authorized(residentForAdapter.body.token));
    assert.equal(deniedAdapters.response.status, 403);

    const outboundPayload = {
      contractId: "his-patient-v1",
      idempotencyKey: "outbound-his-visit-001",
      payload: {
        externalId: "OUT-HIS-VISIT-001",
        residentId: "r1",
        institution: "大连市中心医院",
        visitedAt: "2026-07-11T03:00:00.000Z"
      }
    };
    const dispatched = await api(baseUrl, "/api/integration/dispatch", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(outboundPayload)
    }));
    assert.equal(dispatched.response.status, 202);
    assert.equal(dispatched.body.direction, "outbound");
    assert.equal(dispatched.body.adapterReceipt.receiptId, "his-provider-1");
    assert.equal(dispatched.body.reconciliationStatus, "provider-accepted");
    assert.equal(hospitalRequests.length, 1);
    assert.equal(hospitalRequests[0].headers["x-platform-contract"], "his-patient-v1");
    assert.equal(hospitalRequests[0].headers["x-idempotency-key"], "outbound-his-visit-001");
    assert.equal(hospitalRequests[0].headers["x-signature"], signHospitalRequest(
      stableHospitalStringify(hospitalRequests[0].body),
      process.env.HIS_ADAPTER_SECRET,
      hospitalRequests[0].headers["x-timestamp"],
      hospitalRequests[0].headers["x-request-id"]
    ));

    const outboundReplay = await api(baseUrl, "/api/integration/dispatch", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(outboundPayload)
    }));
    assert.equal(outboundReplay.response.status, 200);
    assert.equal(outboundReplay.body.id, dispatched.body.id);
    assert.equal(outboundReplay.body.idempotentReplay, true);
    assert.equal(hospitalRequests.length, 1);

    const outboundDeadLetter = await api(baseUrl, `/api/integration/events/${dispatched.body.id}/dead-letter`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "provider-reconciliation-retest" })
    }));
    assert.equal(outboundDeadLetter.response.status, 200);
    assert.equal(outboundDeadLetter.body.deadLetter, true);

    const outboundRetry = await api(baseUrl, `/api/integration/events/${dispatched.body.id}/retry`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "provider-recovered" })
    }));
    assert.equal(outboundRetry.response.status, 200);
    assert.equal(outboundRetry.body.deadLetter, false);
    assert.equal(outboundRetry.body.lastRetryResult, "provider-accepted");
    assert.equal(outboundRetry.body.retryCount, 1);
    assert.equal(outboundRetry.body.adapterReceipt.receiptId, "his-provider-2");
    assert.equal(hospitalRequests.length, 2);

    const retry = await api(baseUrl, `/api/integration/events/${accepted.body.id}/retry`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "upstream-timeout" })
    }));
    assert.equal(retry.response.status, 200);
    assert.equal(retry.body.status, "retrying");
    assert.equal(retry.body.retryCount, 1);
    assert.equal(retry.body.deadLetter, false);

    const deadLetter = await api(baseUrl, `/api/integration/events/${accepted.body.id}/dead-letter`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "schema-mapping-failed" })
    }));
    assert.equal(deadLetter.response.status, 200);
    assert.equal(deadLetter.body.status, "failed");
    assert.equal(deadLetter.body.deadLetter, true);
    assert.equal(deadLetter.body.deadLetterReason, "schema-mapping-failed");

    const monitor = await api(baseUrl, "/api/integration/monitor", authorized(commission.body.token));
    assert.equal(monitor.response.status, 200);
    assert.equal(monitor.body.summary.total >= 1, true);
    assert.equal(monitor.body.summary.deadLetters >= 1, true);
    assert.equal(monitor.body.summary.byStatus.failed >= 1, true);

    const simulated = await api(baseUrl, "/api/integration/simulate", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ contractId: "insurance-settlement-v1", sequence: 7 })
    }));
    assert.equal(simulated.response.status, 202);
    assert.equal(simulated.body.event.contractId, "insurance-settlement-v1");
    assert.equal(simulated.body.event.simulated, true);
    assert.equal(simulated.body.sample.signature, integrationSignature(simulated.body.sample.payload));

    const simulatedReplay = await api(baseUrl, "/api/integration/simulate", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ contractId: "insurance-settlement-v1", sequence: 7 })
    }));
    assert.equal(simulatedReplay.response.status, 200);
    assert.equal(simulatedReplay.body.event.id, simulated.body.event.id);
    assert.equal(simulatedReplay.body.event.idempotentReplay, true);
  });

  await t.test("dispatches payment insurance and certificate requests through audited production gateways", async (t) => {
    const financialRequests = [];
    const financialMock = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText);
      financialRequests.push({ headers: request.headers, bodyText, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      const receiptId = body.type === "PAYMENT"
        ? `payment-provider-${financialRequests.length}`
        : body.type === "INSURANCE"
          ? `insurance-provider-${financialRequests.length}`
          : `certificate-provider-${financialRequests.length}`;
      response.end(JSON.stringify({ receiptId, status: "accepted" }));
    });
    financialMock.listen(0, "127.0.0.1");
    await once(financialMock, "listening");
    const financialPort = financialMock.address().port;
    process.env.PAYMENT_GATEWAY_URL = `http://127.0.0.1:${financialPort}/payment`;
    process.env.INSURANCE_GATEWAY_URL = `http://127.0.0.1:${financialPort}/insurance`;
    process.env.CERTIFICATE_GATEWAY_URL = `http://127.0.0.1:${financialPort}/certificate`;
    process.env.FINANCIAL_GATEWAY_SECRET = "api-test-financial-gateway-secret";
    process.env.FINANCIAL_CALLBACK_SECRET = "api-test-financial-callback-secret";
    process.env.FINANCIAL_GATEWAY_MAX_ATTEMPTS = "1";
    t.after(async () => {
      delete process.env.PAYMENT_GATEWAY_URL;
      delete process.env.INSURANCE_GATEWAY_URL;
      delete process.env.CERTIFICATE_GATEWAY_URL;
      delete process.env.FINANCIAL_GATEWAY_SECRET;
      delete process.env.FINANCIAL_CALLBACK_SECRET;
      delete process.env.FINANCIAL_GATEWAY_MAX_ATTEMPTS;
      financialMock.closeAllConnections?.();
      await new Promise((resolve) => financialMock.close(resolve));
    });

    const institution = await login(baseUrl, "hospital");
    const commission = await login(baseUrl, "health");
    const insurance = await login(baseUrl, "insurance");
    const citizen = await login(baseUrl, "citizen");

    const center = await api(baseUrl, "/api/financial-gateways", authorized(insurance.body.token));
    assert.equal(center.response.status, 200);
    assert.equal(center.body.summary.total, 3);
    assert.equal(center.body.summary.configured, 3);
    assert.equal(center.body.summary.operations, 14);
    assert.equal(center.body.productionReady, false);
    assert.equal(JSON.stringify(center.body).includes(String(financialPort)), false);
    assert.equal(JSON.stringify(center.body).includes("api-test-financial-gateway-secret"), false);
    assert.equal((await api(baseUrl, "/api/financial-gateways", authorized(citizen.body.token))).response.status, 403);

    const paymentPayload = {
      type: "PAYMENT",
      operation: "create-payment",
      idempotencyKey: "financial-payment-001",
      payload: { externalId: "pay-ext-001", orderNo: "REG-001", amountFen: 12600, currency: "CNY" }
    };
    const dispatched = await api(baseUrl, "/api/financial-gateways/dispatch", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(paymentPayload)
    }));
    assert.equal(dispatched.response.status, 202);
    assert.equal(dispatched.body.adapterType, "financial");
    assert.equal(dispatched.body.gatewayType, "PAYMENT");
    assert.equal(dispatched.body.contractId, "payment-transaction-v1");
    assert.equal(dispatched.body.adapterReceipt.receiptId, "payment-provider-1");
    assert.equal(dispatched.body.providerStatus, "accepted");
    assert.deepEqual(dispatched.body.adapterReceiptHistory, []);
    assert.deepEqual(dispatched.body.callbackEvents, []);
    assert.match(dispatched.body.businessDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(financialRequests.length, 1);
    assert.equal(financialRequests[0].headers["x-idempotency-key"], "financial-payment-001");
    assert.equal(financialRequests[0].headers["x-signature"], signFinancialRequest(
      stableFinancialStringify(financialRequests[0].body),
      process.env.FINANCIAL_GATEWAY_SECRET,
      financialRequests[0].headers["x-timestamp"],
      financialRequests[0].headers["x-request-id"]
    ));

    const callbackPayload = {
      gatewayType: "PAYMENT",
      eventId: "payment-callback-api-001",
      receiptId: "payment-provider-1",
      status: "paid",
      occurredAt: new Date().toISOString(),
      businessDate: new Date().toISOString().slice(0, 10),
      amountFen: 12600,
      providerCode: "SUCCESS"
    };
    const callbackTimestamp = String(Math.floor(Date.now() / 1000));
    const callbackNonce = "financial-api-nonce-001";
    const callbackSignature = signFinancialCallback(callbackPayload, {
      secret: process.env.FINANCIAL_CALLBACK_SECRET,
      timestamp: callbackTimestamp,
      nonce: callbackNonce
    });
    const callback = await api(baseUrl, "/api/financial-gateways/callbacks/PAYMENT", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Financial-Timestamp": callbackTimestamp,
        "X-Financial-Nonce": callbackNonce,
        "X-Financial-Signature": `sha256=${callbackSignature}`
      },
      body: JSON.stringify(callbackPayload)
    });
    assert.equal(callback.response.status, 200);
    assert.equal(callback.body.gateway.status, "succeeded");
    assert.equal(callback.body.callback.stateApplied, true);
    assert.equal(callback.body.gateway.productionEvidence, false);

    const callbackReplay = await api(baseUrl, "/api/financial-gateways/callbacks/PAYMENT", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Financial-Timestamp": callbackTimestamp,
        "X-Financial-Nonce": callbackNonce,
        "X-Financial-Signature": callbackSignature
      },
      body: JSON.stringify(callbackPayload)
    });
    assert.equal(callbackReplay.response.status, 200);
    assert.equal(callbackReplay.body.idempotentReplay, true);

    const tamperedCallback = await api(baseUrl, "/api/financial-gateways/callbacks/PAYMENT", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Financial-Timestamp": callbackTimestamp,
        "X-Financial-Nonce": "financial-api-nonce-tampered",
        "X-Financial-Signature": callbackSignature
      },
      body: JSON.stringify({ ...callbackPayload, eventId: "payment-callback-api-tampered", amountFen: 12599 })
    });
    assert.equal(tamperedCallback.response.status, 401);
    assert.equal(tamperedCallback.body.code, "FINANCIAL_CALLBACK_SIGNATURE_MISMATCH");

    const operations = await api(baseUrl, "/api/financial-gateways/operations", authorized(commission.body.token));
    assert.equal(operations.response.status, 200);
    assert.equal(operations.body.summary.dispatched >= 1, true);
    assert.equal(operations.body.summary.succeeded >= 1, true);
    assert.equal(operations.body.events.some((item) => item.receiptId === "payment-provider-1" && item.status === "succeeded"), true);
    assert.doesNotMatch(JSON.stringify(operations.body), /financial-api-nonce|api-test-financial-callback-secret/);
    const insuranceOperations = await api(baseUrl, "/api/financial-gateways/operations", authorized(insurance.body.token));
    assert.equal(insuranceOperations.response.status, 200);
    assert.equal(insuranceOperations.body.gateways.every((item) => item.type === "INSURANCE"), true);
    assert.equal(insuranceOperations.body.events.every((item) => item.gatewayType === "INSURANCE"), true);
    assert.equal((await api(baseUrl, "/api/financial-gateways/operations", authorized(citizen.body.token))).response.status, 403);

    const reconciliation = await api(baseUrl, "/api/financial-gateways/reconciliation-runs", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({
        gatewayType: "PAYMENT",
        businessDate: callbackPayload.businessDate,
        providerSummary: {
          total: 1,
          succeeded: 1,
          exceptions: 0,
          grossAmountFen: 12600,
          statementDigest: "a".repeat(64)
        }
      })
    }));
    assert.equal(reconciliation.response.status, 201);
    assert.equal(reconciliation.body.run.status, "matched");
    assert.equal(reconciliation.body.productionEvidence, false);
    const insurancePaymentReconciliation = await api(baseUrl, "/api/financial-gateways/reconciliation-runs", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({
        gatewayType: "PAYMENT",
        businessDate: callbackPayload.businessDate,
        providerSummary: { total: 0, succeeded: 0, exceptions: 0, grossAmountFen: 0, statementDigest: "b".repeat(64) }
      })
    }));
    assert.equal(insurancePaymentReconciliation.response.status, 403);

    const replay = await api(baseUrl, "/api/financial-gateways/dispatch", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify(paymentPayload)
    }));
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.id, dispatched.body.id);
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(financialRequests.length, 1);

    assert.equal((await api(baseUrl, "/api/financial-gateways/dispatch", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ ...paymentPayload, idempotencyKey: "insurance-out-of-scope" })
    }))).response.status, 403);
    const sensitive = await api(baseUrl, "/api/financial-gateways/dispatch", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({
        type: "INSURANCE",
        operation: "credential-verify",
        idempotencyKey: "insurance-sensitive-001",
        payload: { credentialReference: "vault-ref-1", institutionCode: "MR1", credentialToken: "raw-token" }
      })
    }));
    assert.equal(sensitive.response.status, 400);
    assert.match(sensitive.body.message, /sensitive field/);
    assert.equal(financialRequests.length, 1);

    const marked = await api(baseUrl, `/api/integration/events/${dispatched.body.id}/dead-letter`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "provider-reconciliation-retest" })
    }));
    assert.equal(marked.response.status, 200);
    assert.equal(marked.body.deadLetter, true);
    const retried = await api(baseUrl, `/api/integration/events/${dispatched.body.id}/retry`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "provider-recovered" })
    }));
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.deadLetter, false);
    assert.equal(retried.body.lastRetryResult, "provider-accepted");
    assert.equal(retried.body.adapterReceipt.receiptId, "payment-provider-2");
    assert.equal(financialRequests.length, 2);

    const certificate = await api(baseUrl, "/api/financial-gateways/dispatch", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({
        type: "CERTIFICATE",
        operation: "issue",
        idempotencyKey: "certificate-issue-001",
        payload: {
          externalId: "birth-cert-001",
          certificateType: "birth",
          subjectReference: "resident-vault-ref-r1",
          documentDigest: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
        }
      })
    }));
    assert.equal(certificate.response.status, 202);
    assert.equal(certificate.body.gatewayType, "CERTIFICATE");
    assert.equal(certificate.body.contractId, "certificate-sync-v1");
    assert.equal(financialRequests.length, 3);
  });

  await t.test("routes minimized alerts to SIEM and closes delivery incidents after retry", async (t) => {
    const alertRequests = [];
    let failDelivery = false;
    const alertMock = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText);
      alertRequests.push({ headers: request.headers, bodyText, body });
      response.writeHead(failDelivery ? 503 : 200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(failDelivery
        ? { message: "receiver temporarily unavailable" }
        : { eventId: `siem-event-${alertRequests.length}`, status: "accepted" }));
    });
    alertMock.listen(0, "127.0.0.1");
    await once(alertMock, "listening");
    const alertPort = alertMock.address().port;
    process.env.SIEM_ENDPOINT = `http://127.0.0.1:${alertPort}/events`;
    process.env.SIEM_SIGNING_SECRET = "api-test-siem-signing-secret";
    process.env.ALERTING_MAX_ATTEMPTS = "1";
    t.after(async () => {
      delete process.env.SIEM_ENDPOINT;
      delete process.env.SIEM_SIGNING_SECRET;
      delete process.env.ALERTING_MAX_ATTEMPTS;
      alertMock.closeAllConnections?.();
      await new Promise((resolve) => alertMock.close(resolve));
    });

    const commission = await login(baseUrl, "health");
    const citizen = await login(baseUrl, "citizen");
    const center = await api(baseUrl, "/api/observability/alerts", authorized(commission.body.token));
    assert.equal(center.response.status, 200);
    assert.equal(center.body.routing.summary.total, 2);
    assert.equal(center.body.routing.summary.configured, 1);
    assert.equal(center.body.productionReady, false);
    assert.equal(center.body.activeSignals.length > 0, true);
    assert.equal(JSON.stringify(center.body).includes(String(alertPort)), false);
    assert.equal(JSON.stringify(center.body).includes("api-test-siem-signing-secret"), false);
    assert.equal((await api(baseUrl, "/api/observability/alerts", authorized(citizen.body.token))).response.status, 403);

    const alert = {
      fingerprint: "api-test-alert-001",
      source: "api-regression",
      severity: "critical",
      title: "API regression alert",
      summary: "A minimized operational alert used to verify the SIEM delivery contract.",
      occurredAt: "2026-07-11T06:00:00.000Z",
      labels: { environment: "test", owner: "platform-operations" },
      metrics: { failures: "1" },
      evidenceRefs: ["/api/metrics"]
    };
    const dispatched = await api(baseUrl, "/api/observability/alerts/dispatch", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ route: "SIEM", idempotencyKey: "api-alert-delivery-001", alert })
    }));
    assert.equal(dispatched.response.status, 202);
    assert.equal(dispatched.body.delivery.adapterReceipt.receiptId, "siem-event-1");
    assert.equal(alertRequests.length, 1);
    assert.equal(alertRequests[0].headers["x-idempotency-key"], "api-alert-delivery-001");
    assert.equal(alertRequests[0].headers["x-signature"], signAlertRequest(
      stableAlertStringify(alertRequests[0].body),
      process.env.SIEM_SIGNING_SECRET,
      alertRequests[0].headers["x-timestamp"],
      alertRequests[0].headers["x-request-id"]
    ));

    const replay = await api(baseUrl, "/api/observability/alerts/dispatch", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ route: "SIEM", idempotencyKey: "api-alert-delivery-001", alert })
    }));
    assert.equal(replay.response.status, 200);
    assert.equal(replay.body.id, dispatched.body.delivery.id);
    assert.equal(replay.body.idempotentReplay, true);
    assert.equal(alertRequests.length, 1);

    const sensitive = await api(baseUrl, "/api/observability/alerts/dispatch", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ route: "SIEM", alert: { ...alert, fingerprint: "sensitive-alert", residentId: "r1" } })
    }));
    assert.equal(sensitive.response.status, 400);
    assert.match(sensitive.body.message, /sensitive field/);
    assert.equal(alertRequests.length, 1);

    failDelivery = true;
    const failed = await api(baseUrl, "/api/observability/alerts/dispatch", authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ route: "SIEM", idempotencyKey: "api-alert-delivery-002", alert: { ...alert, fingerprint: "api-test-alert-002", title: "Receiver failure alert" } })
    }));
    assert.equal(failed.response.status, 502);
    assert.equal(failed.body.delivery.deadLetter, true);
    assert.equal(failed.body.incident.status, "open-delivery-failure");
    const failedDeliveryId = failed.body.delivery.id;

    const operationsAfterFailure = await api(baseUrl, "/api/operations/dashboard", authorized(commission.body.token));
    assert.equal(operationsAfterFailure.response.status, 200);
    assert.equal(operationsAfterFailure.body.observability.summary.failed >= 1, true);
    assert.equal(operationsAfterFailure.body.runCenter.incidents.some((item) => item.id === `ops-alert-delivery-${failedDeliveryId}` && item.status === "open-delivery-failure"), true);

    failDelivery = false;
    const retried = await api(baseUrl, `/api/observability/alert-deliveries/${failedDeliveryId}/retry`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ reason: "receiver recovered" })
    }));
    assert.equal(retried.response.status, 200);
    assert.equal(retried.body.ok, true);
    assert.equal(retried.body.delivery.deadLetter, false);
    assert.equal(retried.body.delivery.lastRetryResult, "receiver-accepted");
    assert.equal(retried.body.incident.status, "resolved-after-delivery");
    assert.equal(retried.body.center.summary.failed, 0);
  });

  await t.test("secures attachment upload completion download and lifecycle through object storage", async (t) => {
    const storageRequests = [];
    let scanStatus = "clean";
    const storageMock = http.createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bodyText = Buffer.concat(chunks).toString("utf8");
      const body = JSON.parse(bodyText);
      storageRequests.push({ path: request.url, headers: request.headers, body });
      response.writeHead(200, { "Content-Type": "application/json" });
      if (request.url === "/storage/upload-intents") {
        response.end(JSON.stringify({ uploadId: `upload-${body.attachmentId}`, uploadUrl: `http://127.0.0.1:${storageMock.address().port}/direct-upload/${body.attachmentId}`, expiresAt: "2026-07-11T05:00:00.000Z" }));
        return;
      }
      if (request.url === "/storage/objects/complete") {
        response.end(JSON.stringify({ sizeBytes: body.expectedSizeBytes, checksumSha256: body.expectedChecksumSha256, scanStatus, scannedAt: "2026-07-11T04:10:00.000Z", objectVersion: `version-${body.attachmentId}` }));
        return;
      }
      if (request.url === "/storage/download-intents") {
        response.end(JSON.stringify({ downloadUrl: `http://127.0.0.1:${storageMock.address().port}/short-download/${body.attachmentId}`, expiresAt: "2026-07-11T04:15:00.000Z" }));
        return;
      }
      response.end(JSON.stringify({ accepted: true, status: "accepted", effectiveAt: "2026-07-11T04:12:00.000Z" }));
    });
    storageMock.listen(0, "127.0.0.1");
    await once(storageMock, "listening");
    const storagePort = storageMock.address().port;
    process.env.OBJECT_STORAGE_GATEWAY_URL = `http://127.0.0.1:${storagePort}/storage/`;
    process.env.OBJECT_STORAGE_BUCKET = "api-test-attachments";
    process.env.OBJECT_STORAGE_SIGNING_SECRET = "api-test-object-storage-signing-secret";
    process.env.OBJECT_STORAGE_TOKEN = "api-test-object-storage-token";
    t.after(async () => {
      delete process.env.OBJECT_STORAGE_GATEWAY_URL;
      delete process.env.OBJECT_STORAGE_BUCKET;
      delete process.env.OBJECT_STORAGE_SIGNING_SECRET;
      delete process.env.OBJECT_STORAGE_TOKEN;
      storageMock.closeAllConnections?.();
      await new Promise((resolve) => storageMock.close(resolve));
    });

    const commission = await login(baseUrl, "health");
    const citizen = await login(baseUrl, "citizen");
    const institution = await login(baseUrl, "hospital");
    const storageCenter = await api(baseUrl, "/api/attachments/storage", authorized(commission.body.token));
    assert.equal(storageCenter.response.status, 200);
    assert.equal(storageCenter.body.adapterReady, true);
    assert.equal(storageCenter.body.productionReady, false);
    assert.equal(JSON.stringify(storageCenter.body).includes(String(storagePort)), false);
    assert.equal(JSON.stringify(storageCenter.body).includes("api-test-attachments"), false);

    const deniedStorageCenter = await api(baseUrl, "/api/attachments/storage", authorized(citizen.body.token));
    assert.equal(deniedStorageCenter.response.status, 403);

    const invalidUpload = await api(baseUrl, "/api/attachments/upload-intents", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", filename: "malware.exe", contentType: "application/octet-stream", sizeBytes: 100, checksumSha256: "a".repeat(64) })
    }));
    assert.equal(invalidUpload.response.status, 400);
    assert.match(invalidUpload.body.message, /content type is not allowed/);

    const uploadPayload = {
      residentId: "r1",
      purpose: "resident-lab-report",
      sourceCollection: "personalRecords",
      sourceId: "record-api-storage-001",
      filename: "lab-report.pdf",
      contentType: "application/pdf",
      sizeBytes: 4096,
      checksumSha256: "c".repeat(64),
      classification: "clinical",
      retentionPolicy: "clinical-record"
    };
    const uploadIntent = await api(baseUrl, "/api/attachments/upload-intents", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify(uploadPayload)
    }));
    assert.equal(uploadIntent.response.status, 201);
    assert.equal(uploadIntent.body.attachment.status, "upload-authorized");
    assert.equal(uploadIntent.body.attachment.uploadId, undefined);
    assert.equal(uploadIntent.body.uploadIntent.uploadUrl.includes("direct-upload"), true);
    assert.equal(storageRequests[0].headers["x-signature-algorithm"], "HMAC-SHA256");

    const attachmentId = uploadIntent.body.attachment.id;
    const deniedInstitutionList = await api(baseUrl, "/api/attachments?residentId=r1", authorized(institution.body.token));
    assert.equal(deniedInstitutionList.response.status, 200);
    assert.equal(deniedInstitutionList.body.attachments.some((item) => item.id === attachmentId), false);

    const completed = await api(baseUrl, `/api/attachments/${attachmentId}/complete`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(completed.response.status, 200);
    assert.equal(completed.body.attachment.status, "active");
    assert.equal(completed.body.attachment.scanStatus, "clean");
    assert.equal(completed.body.attachment.checksumSha256, "c".repeat(64));

    const download = await api(baseUrl, `/api/attachments/${attachmentId}/download-intent`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(download.response.status, 200);
    assert.equal(download.body.downloadIntent.downloadUrl.includes("short-download"), true);
    assert.equal(typeof download.body.downloadIntent.expiresAt, "string");

    const legalHold = await api(baseUrl, `/api/attachments/${attachmentId}/actions`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "legal-hold", reason: "API audit evidence preservation" })
    }));
    assert.equal(legalHold.response.status, 200);
    assert.equal(legalHold.body.attachment.legalHold, true);

    const immutableDelete = await api(baseUrl, `/api/attachments/${attachmentId}/actions`, authorized(commission.body.token, {
      method: "POST",
      body: JSON.stringify({ action: "delete", reason: "should remain blocked" })
    }));
    assert.equal(immutableDelete.response.status, 409);

    scanStatus = "infected";
    const infectedIntent = await api(baseUrl, "/api/attachments/upload-intents", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ ...uploadPayload, filename: "suspicious-report.pdf", checksumSha256: "d".repeat(64) })
    }));
    assert.equal(infectedIntent.response.status, 201);
    const infectedCompletion = await api(baseUrl, `/api/attachments/${infectedIntent.body.attachment.id}/complete`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(infectedCompletion.response.status, 422);
    assert.equal(infectedCompletion.body.attachment.status, "quarantined");
    assert.equal(infectedCompletion.body.attachment.scanStatus, "blocked");
    assert.equal(infectedCompletion.body.attachment.storageQuarantineStatus, "accepted");

    const blockedDownload = await api(baseUrl, `/api/attachments/${infectedIntent.body.attachment.id}/download-intent`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(blockedDownload.response.status, 409);
  });

  await t.test("closes mutual recognition report callback into resident records", async () => {
    const county = await login(baseUrl, "county");
    const rules = await api(baseUrl, "/api/mutual-recognition/rules", authorized(county.body.token));
    assert.equal(rules.response.status, 200);
    assert.equal(rules.body.rules.some((item) => item.id === "mrr-hba1c-001"), true);

    const report = await api(baseUrl, "/api/mutual-recognition/reports", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        externalId: "LIS-CALLBACK-001",
        residentId: "r2",
        item: "HbA1c",
        category: "lab",
        sourceInstitution: "Wafangdian Central Hospital",
        targetInstitution: "Dalian Medical University Hospital",
        result: "6.7%",
        conclusion: "HbA1c follow-up result returned from county lab center.",
        qualityStatus: "passed",
        reportedAt: "2026-06-21T12:00:00.000Z"
      })
    }));
    assert.equal(report.response.status, 201);
    assert.equal(report.body.report.status, "recognized");
    assert.equal(report.body.report.ruleId, "mrr-hba1c-001");
    assert.equal(report.body.recognition.status, "recognized");
    assert.equal(report.body.personalRecord.reportId, report.body.report.id);

    const state = await api(baseUrl, "/api/state", authorized(county.body.token));
    assert.equal(state.body.diagnosticReports.some((item) => item.id === report.body.report.id), true);
    assert.equal(state.body.countyMutualRecognitionRecords.some((item) => item.id === report.body.recognition.id), true);
    assert.equal(state.body.personalRecords.some((item) => item.reportId === report.body.report.id), true);

    const critical = await api(baseUrl, "/api/mutual-recognition/reports", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        externalId: "PACS-CRITICAL-001",
        residentId: "r1",
        item: "Chest CT",
        category: "imaging",
        sourceInstitution: "Pulandian Township Hospital",
        targetInstitution: "Pulandian Central Hospital",
        result: "urgent imaging finding",
        conclusion: "Critical value: suspected acute chest condition.",
        qualityStatus: "passed",
        critical: true,
        criticalLevel: "high",
        criticalAction: "Call receiving physician within 15 minutes.",
        reportedAt: "2026-06-21T13:00:00.000Z"
      })
    }));
    assert.equal(critical.response.status, 201);
    assert.equal(critical.body.criticalSignal.status, "pending_acknowledgement");
    assert.equal(critical.body.criticalSignal.sourceReportId, critical.body.report.id);

    const handled = await api(baseUrl, `/api/emergency-signals/${critical.body.criticalSignal.id}`, authorized(county.body.token, {
      method: "PATCH",
      body: JSON.stringify({ status: "acknowledged", action: "Receiving physician notified and disposition recorded." })
    }));
    assert.equal(handled.response.status, 200);
    assert.equal(handled.body.status, "acknowledged");

    const countyTasks = await api(baseUrl, "/api/tasks", authorized(county.body.token));
    assert.equal(countyTasks.response.status, 200);
    assert.equal(countyTasks.body.tasks.some((item) => item.id === `emergencySignals:${critical.body.criticalSignal.id}`), true);
    assert.equal(countyTasks.body.tasks.some((item) => item.collection === "insuranceClaims"), false);
    const countyServiceTask = countyTasks.body.tasks.find((item) => item.collection === "countyCollaborationOrders");
    assert.equal(countyServiceTask.serviceDomain, "collaboration");
    assert.equal(countyServiceTask.priorityLevel, "high");
    const countyTeleconsultationTask = countyTasks.body.tasks.find((item) => item.collection === "referralTeleconsultations");
    assert.equal(countyTeleconsultationTask.serviceDomain, "referralTeleconsultation");

    const teleconsultations = await api(baseUrl, "/api/referral-teleconsultations", authorized(county.body.token));
    assert.equal(teleconsultations.response.status, 200);
    assert.equal(teleconsultations.body.summary.total >= 2, true);
    assert.equal(teleconsultations.body.summary.reportReturned >= 1, true);
    const teleconsultationAction = await api(baseUrl, "/api/referral-teleconsultations/rtc-001/actions", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "feedback-returned", feedback: "County office confirmed receiving feedback.", note: "county follow-up" })
    }));
    assert.equal(teleconsultationAction.response.status, 200);
    assert.equal(teleconsultationAction.body.status, "feedback-returned");

    const taskHandled = await api(baseUrl, `/api/tasks/${encodeURIComponent(`emergencySignals:${critical.body.criticalSignal.id}`)}/actions`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "resolved", action: "close-critical-alert", comment: "Disposition completed." })
    }));
    assert.equal(taskHandled.response.status, 200);
    assert.equal(taskHandled.body.status, "resolved");

    const taskMessage = await api(baseUrl, `/api/tasks/${encodeURIComponent(`emergencySignals:${critical.body.criticalSignal.id}`)}/messages`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        targetRole: "citizen",
        channel: "in_app",
        title: "Critical result handled",
        body: "Your critical diagnostic result has been handled by the regional center."
      })
    }));
    assert.equal(taskMessage.response.status, 201);
    assert.equal(taskMessage.body.residentId, "r1");
    assert.equal(taskMessage.body.status, "sent");

    const rejectedReview = await api(baseUrl, `/api/mutual-recognition/records/${critical.body.recognition.id}/review`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ decision: "reject", reasonCode: "poor-quality", comment: "DICOM package is incomplete." })
    }));
    assert.equal(rejectedReview.response.status, 200);
    assert.equal(rejectedReview.body.status, "rejected");
    assert.equal(rejectedReview.body.nonRecognitionReason, "poor-quality");

    const reviewedState = await api(baseUrl, "/api/state", authorized(county.body.token));
    const reviewedReport = reviewedState.body.diagnosticReports.find((item) => item.id === critical.body.report.id);
    assert.equal(reviewedReport.status, "not_recognized");
    assert.equal(reviewedReport.reviewReasonCode, "poor-quality");
    assert.equal(Array.isArray(reviewedState.body.countyAcceptanceLedger), true);

    const phase2Recognition = await api(baseUrl, "/api/phase2/mutual-recognition", authorized(county.body.token));
    assert.equal(phase2Recognition.response.status, 200);
    assert.equal(phase2Recognition.body.ok, true);
    assert.equal(phase2Recognition.body.summary.catalogItems >= 78, true);
    assert.equal(phase2Recognition.body.reportBrowser.some((item) => item.reportId === report.body.report.id && item.catalogCode), true);
    assert.equal(phase2Recognition.body.citations.some((item) => item.evidenceHash && item.chainNode), true);

    const phase2Decision = await api(baseUrl, `/api/phase2/mutual-recognition/records/${report.body.recognition.id}/decision`, authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ decision: "recognize", reasonCode: "qc-passed", comment: "Phase 2 citation confirmation." })
    }));
    assert.equal(phase2Decision.response.status, 200);
    assert.equal(phase2Decision.body.record.reviewStatus, "approved");
    assert.equal(phase2Decision.body.citation.recognitionRecordId, report.body.recognition.id);
    assert.equal(phase2Decision.body.citation.verificationStatus, "verified");
    assert.equal(phase2Decision.body.overview.checks.some((item) => item.id === "phase2MutualRecognition:citationChain" && item.passed), true);

    const acceptance = await api(baseUrl, "/api/county/acceptance-ledger", authorized(county.body.token));
    assert.equal(acceptance.response.status, 200);
    assert.equal(acceptance.body.ok, true);
    assert.equal(acceptance.body.ledger.some((item) => item.id === "county-accept-report-return"), true);
    assert.equal(acceptance.body.ledger.some((item) => item.metricKey === "criticalAlert" && item.metric.denominator >= 1), true);
    assert.equal(acceptance.body.serviceSummary.summary.domains, 5);
    assert.equal(acceptance.body.serviceSummary.domains.some((item) => item.id === "performance"), true);

    const insurance = await login(baseUrl, "insurance");
    const insuranceAcceptance = await api(baseUrl, "/api/county/acceptance-ledger", authorized(insurance.body.token));
    assert.equal(insuranceAcceptance.response.status, 403);
    const insuranceTasks = await api(baseUrl, "/api/tasks", authorized(insurance.body.token));
    assert.equal(insuranceTasks.response.status, 200);
    assert.equal(insuranceTasks.body.tasks.some((item) => item.collection === "insuranceClaims"), true);
    assert.equal(insuranceTasks.body.tasks.some((item) => item.collection === "chronicScreeningTasks"), false);

    const citizen = await login(baseUrl, "citizen");
    const citizenMessages = await api(baseUrl, "/api/messages", authorized(citizen.body.token));
    assert.equal(citizenMessages.response.status, 200);
    assert.equal(citizenMessages.body.messages.some((item) => item.id === taskMessage.body.id), true);

    const receipt = await api(baseUrl, `/api/messages/${taskMessage.body.id}/receipt`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ status: "read" })
    }));
    assert.equal(receipt.response.status, 200);
    assert.equal(receipt.body.status, "read");
    assert.equal(receipt.body.receipts[0].by, citizen.body.user.username);

    const escalations = await api(baseUrl, "/api/tasks/escalations", authorized(commissionToken));
    assert.equal(escalations.response.status, 200);
    assert.equal(escalations.body.overdue.some((item) => item.overdue === true), true);
    const commissionTasks = await api(baseUrl, "/api/tasks", authorized(commissionToken));
    const chronicServiceTask = commissionTasks.body.tasks.find((item) => item.collection === "chronicScreeningTasks" && item.sourceId === "cst-001");
    assert.equal(chronicServiceTask.serviceDomain, "screening");
    assert.equal(chronicServiceTask.priorityLevel, "high");

    const escalationRun = await api(baseUrl, "/api/tasks/escalations/run", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(escalationRun.response.status, 201);
    assert.equal(escalationRun.body.summary.created > 0, true);

    const escalationReplay = await api(baseUrl, "/api/tasks/escalations/run", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({})
    }));
    assert.equal(escalationReplay.response.status, 201);
    assert.equal(escalationReplay.body.summary.created, 0);

    const qualityIssues = await api(baseUrl, "/api/data-quality/issues", authorized(commissionToken));
    assert.equal(qualityIssues.response.status, 200);
    assert.equal(qualityIssues.body.issues.some((item) => item.type === "integration_dead_letter"), true);
    assert.equal(qualityIssues.body.issues.some((item) => item.type === "institution_credit_rectification"), true);
    const issue = qualityIssues.body.issues.find((item) => item.type === "institution_credit_rectification");
    const issueAction = await api(baseUrl, `/api/data-quality/issues/${issue.id}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "closed", action: "rectified", comment: "Institution uploaded missing quality evidence." })
    }));
    assert.equal(issueAction.response.status, 200);
    assert.equal(issueAction.body.status, "closed");

    const scorecard = await api(baseUrl, "/api/data-quality/scorecard", authorized(commissionToken));
    assert.equal(scorecard.response.status, 200);
    assert.equal(scorecard.body.residentIndexCompleteness, 100);
    assert.equal(scorecard.body.trustedSources.some((item) => item.collection === "diagnosticReports"), true);
    assert.equal(Number.isFinite(scorecard.body.score), true);

    const credit = await api(baseUrl, "/api/credit-evaluations/calculate", authorized(commissionToken));
    assert.equal(credit.response.status, 200);
    assert.equal(credit.body.rules.version, "credit-rules-2026.1");
    assert.equal(credit.body.evaluations.length, 3);
    assert.equal(credit.body.evaluations.every((item) => Array.isArray(item.deductions)), true);
    const creditAction = await api(baseUrl, `/api/credit-evaluations/${credit.body.evaluations[0].id}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ appealStatus: "submitted", publicationStatus: "pending_appeal", appealComment: "Institution submitted supporting evidence." })
    }));
    assert.equal(creditAction.response.status, 200);
    assert.equal(creditAction.body.appealStatus, "submitted");

    const performance = await api(baseUrl, "/api/performance/consortium-report", authorized(commissionToken));
    assert.equal(performance.response.status, 200);
    assert.equal(performance.body.medicalConsortium.totalOrders >= 1, true);
    assert.equal(performance.body.pharmacyAndConsumables.medicationPlans >= 1, true);
    assert.equal(performance.body.peopleFinanceMaterials.doctors >= 1, true);
    assert.equal(Number.isFinite(performance.body.primaryCareFulfillment.completionRate), true);

    const chronicAcceptance = await api(baseUrl, "/api/chronic/acceptance-ledger", authorized(commissionToken));
    assert.equal(chronicAcceptance.response.status, 200);
    assert.equal(chronicAcceptance.body.ok, true);
    assert.equal(chronicAcceptance.body.ledger.some((item) => item.id === "chronic-accept-screening"), true);
    assert.equal(chronicAcceptance.body.ledger.some((item) => item.metricKey === "quality" && item.rate >= 80), true);
    assert.equal(chronicAcceptance.body.policyCollections.servicePathways >= 5, true);
    assert.equal(chronicAcceptance.body.serviceSummary.summary.domains, 8);
    assert.equal(chronicAcceptance.body.serviceSummary.domains.some((item) => item.id === "medicationSupport"), true);

    const chronicRisk = await api(baseUrl, "/api/chronic/risk-stratification", authorized(commissionToken));
    assert.equal(chronicRisk.response.status, 200);
    assert.equal(chronicRisk.body.ok, true);
    assert.equal(chronicRisk.body.summary.highPriority >= 1, true);
    assert.equal(chronicRisk.body.summary.openScreeningTasks >= 1, true);
    assert.equal(chronicRisk.body.queue.some((item) => item.residentId === "r1" && item.priority === "high"), true);
    assert.equal(chronicRisk.body.queue.every((item) => item.nextAction && item.serviceLevel && item.openCounts), true);

    const chronicFollowupSummary = await api(baseUrl, "/api/chronic/followup-summary", authorized(commissionToken));
    assert.equal(chronicFollowupSummary.response.status, 200);
    assert.equal(chronicFollowupSummary.body.ok, true);
    assert.equal(chronicFollowupSummary.body.summary.feedbackRecords >= 1, true);
    assert.equal(chronicFollowupSummary.body.summary.alerts >= 1, true);
    assert.equal(chronicFollowupSummary.body.summary.escalationAlerts >= 1, true);
    assert.equal(chronicFollowupSummary.body.summary.policyAligned, chronicFollowupSummary.body.summary.policyItems);
    assert.equal(chronicFollowupSummary.body.alertQueue.some((item) => item.id === "followups:f1" && item.dueBucket === "overdue"), true);
    assert.equal(chronicFollowupSummary.body.alertQueue.every((item) => item.recommendedAction), true);
    assert.equal(chronicFollowupSummary.body.policyAlignment.some((item) => item.id === "policy-feedback-dispatch" && item.covered), true);
    assert.equal(chronicFollowupSummary.body.residents.some((item) => item.residentId === "r1" && item.medicationAdherence.total >= 1), true);

    const chronicArchiveStandard = await api(baseUrl, "/api/chronic/archive-standard", authorized(commissionToken));
    assert.equal(chronicArchiveStandard.response.status, 200);
    assert.equal(chronicArchiveStandard.body.ok, true);
    assert.equal(chronicArchiveStandard.body.standardVersion, "WS/T 363/364-2023");
    assert.equal(chronicArchiveStandard.body.summary.dimensions, 8);
    assert.equal(chronicArchiveStandard.body.dimensions.some((item) => item.id === "risk-factors" && item.standard.includes("WS/T 363.5-2023")), true);

    const residentArchiveStandard = await api(baseUrl, "/api/chronic/archive-standard?residentId=r1", authorized(citizen.body.token));
    assert.equal(residentArchiveStandard.response.status, 200);
    assert.equal(residentArchiveStandard.body.summary.residents, 1);

    const deniedResidentArchiveStandard = await api(baseUrl, "/api/chronic/archive-standard?residentId=r2", authorized(citizen.body.token));
    assert.equal(deniedResidentArchiveStandard.response.status, 403);

    const chronicPathwayQuality = await api(baseUrl, "/api/chronic/pathway-quality", authorized(commissionToken));
    assert.equal(chronicPathwayQuality.response.status, 200);
    assert.equal(chronicPathwayQuality.body.diseasePathways.length >= 2, true);
    assert.equal(chronicPathwayQuality.body.indicators.length, 5);
    assert.equal(chronicPathwayQuality.body.diseasePathways.some((item) => item.diseaseType === "hypertension" && item.manualReview), true);
    const residentPathwayQuality = await api(baseUrl, "/api/chronic/pathway-quality?residentId=r1", authorized(citizen.body.token));
    const deniedResidentPathwayQuality = await api(baseUrl, "/api/chronic/pathway-quality?residentId=r2", authorized(citizen.body.token));
    assert.equal(residentPathwayQuality.response.status, 200);
    assert.equal(residentPathwayQuality.body.summary.residents, 1);
    assert.equal(deniedResidentPathwayQuality.response.status, 403);

    const chronicPharmacyClosure = await api(baseUrl, "/api/chronic/pharmacy-insurance-closure", authorized(commissionToken));
    assert.equal(chronicPharmacyClosure.response.status, 200);
    assert.equal(chronicPharmacyClosure.body.summary.pickups >= 4, true);
    assert.equal(chronicPharmacyClosure.body.rows.some((item) => item.medicationPickupId === "mp1" && item.pharmacyCallback), true);
    const residentPharmacyClosure = await api(baseUrl, "/api/chronic/pharmacy-insurance-closure?residentId=r1", authorized(citizen.body.token));
    const deniedResidentPharmacyClosure = await api(baseUrl, "/api/chronic/pharmacy-insurance-closure?residentId=r2", authorized(citizen.body.token));
    assert.equal(residentPharmacyClosure.response.status, 200);
    assert.equal(residentPharmacyClosure.body.rows.every((item) => item.residentId === "r1"), true);
    assert.equal(deniedResidentPharmacyClosure.response.status, 403);

    const chronicProductionSafety = await api(baseUrl, "/api/chronic/production-safety", authorized(commissionToken));
    assert.equal(chronicProductionSafety.response.status, 200);
    assert.equal(chronicProductionSafety.body.functionalState, "ready-for-site-safety-evidence");
    assert.equal(chronicProductionSafety.body.formalGoLiveState, "site-evidence-pending");
    assert.equal(chronicProductionSafety.body.checks.some((item) => item.id === "environment:audit-retention"), true);
    const chronicProductionSafetyEvidence = await api(baseUrl, "/api/chronic/production-safety-evidence", authorized(commissionToken));
    assert.equal(chronicProductionSafetyEvidence.response.status, 200);
    assert.equal(chronicProductionSafetyEvidence.body.summary.requirements, 6);
    assert.equal(chronicProductionSafetyEvidence.body.rows.some((item) => item.controlId === "chronic:launch-core-signoff" && item.templateId === "signoff-cutover-chronic-launch-core"), true);
    const citizenProductionSafety = await api(baseUrl, "/api/chronic/production-safety", authorized(citizen.body.token));
    assert.equal(citizenProductionSafety.response.status, 403);
    const citizenProductionSafetyEvidence = await api(baseUrl, "/api/chronic/production-safety-evidence", authorized(citizen.body.token));
    assert.equal(citizenProductionSafetyEvidence.response.status, 403);

    const chronicInteroperabilityProfiles = await api(baseUrl, "/api/chronic/interoperability-profiles", authorized(commissionToken));
    assert.equal(chronicInteroperabilityProfiles.response.status, 200);
    assert.equal(chronicInteroperabilityProfiles.body.summary.profiles, 3);
    assert.equal(chronicInteroperabilityProfiles.body.profiles.some((item) => item.id === "chronic-referral-return-v1" && item.standards.includes("WS/T 847-2024")), true);
    const interoperableReferral = await api(baseUrl, "/api/chronic/interoperability-validation", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        profileId: "chronic-referral-return-v1",
        message: {
          externalId: "referral-return-r1-20260717",
          residentId: "r1",
          personIndex: "person-index-r1",
          referralId: "ref-001",
          sourceSystem: "leading-hospital-emr",
          occurredAt: "2026-07-17T08:00:00.000Z",
          returnStatus: "returned-to-primary-care",
          diagnosis: "hypertension",
          nextFollowupAt: "2026-07-24T08:00:00.000Z"
        }
      })
    }));
    assert.equal(interoperableReferral.response.status, 200);
    assert.equal(interoperableReferral.body.ok, true);
    const invalidInteroperabilityMessage = await api(baseUrl, "/api/chronic/interoperability-validation", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ profileId: "chronic-device-observation-v1", message: { residentId: "r1", reportedAt: "not-a-date" } })
    }));
    assert.equal(invalidInteroperabilityMessage.response.status, 422);
    assert.equal(invalidInteroperabilityMessage.body.missingFields.includes("externalId"), true);
    assert.equal(invalidInteroperabilityMessage.body.invalidDateFields.includes("reportedAt"), true);
    const citizenInteroperabilityProfiles = await api(baseUrl, "/api/chronic/interoperability-profiles", authorized(citizen.body.token));
    assert.equal(citizenInteroperabilityProfiles.response.status, 403);

    const publicHealthLoop = await api(baseUrl, "/api/chronic/public-health-loop", authorized(commissionToken));
    assert.equal(publicHealthLoop.response.status, 200);
    assert.equal(publicHealthLoop.body.ok, true);
    assert.equal(publicHealthLoop.body.summary.readyStages, 6);
    assert.deepEqual(publicHealthLoop.body.stages.map((item) => item.id), ["monitor", "alert", "dispatch", "intervention", "followup", "summary"]);
    assert.equal(publicHealthLoop.body.queue.some((item) => item.residentId === "r1" && item.dispatchTarget), true);
    assert.equal(publicHealthLoop.body.immunizationPlanning.summary.dueReminders >= 1, true);
    assert.equal(publicHealthLoop.body.infectiousDiseaseReporting.summary.signals >= 1, true);
    assert.equal(publicHealthLoop.body.cdcSummary.summary.commandRows >= 1, true);
    assert.equal(publicHealthLoop.body.cdcSummary.commandRows.some((item) => item.chronicQueue >= 1 || item.infectiousSignals >= 1), true);
    assert.equal(publicHealthLoop.body.nextIntegrations.includes("regional public health system"), true);

    const chronicEscalation = await api(baseUrl, "/api/chronic/followup-escalations", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        collection: "followups",
        id: "f1",
        escalationLevel: "priority",
        reason: "API regression escalates overdue follow-up into institution queue"
      })
    }));
    assert.equal(chronicEscalation.response.status, 201);
    assert.equal(chronicEscalation.body.item.escalationStatus, "escalated");
    assert.equal(chronicEscalation.body.message.chronicFollowup, true);
    assert.equal(chronicEscalation.body.message.meta.escalation, true);

    const chronicEscalationReplay = await api(baseUrl, "/api/chronic/followup-escalations", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        collection: "followups",
        id: "f1",
        reason: "API regression replay should stay idempotent"
      })
    }));
    assert.equal(chronicEscalationReplay.response.status, 200);
    assert.equal(chronicEscalationReplay.body.idempotent, true);
    assert.equal(chronicEscalationReplay.body.message.id, chronicEscalation.body.message.id);

    const chronicInstitutionInterfaces = await api(baseUrl, "/api/chronic/institution-interfaces", authorized(commissionToken));
    assert.equal(chronicInstitutionInterfaces.response.status, 200);
    assert.equal(chronicInstitutionInterfaces.body.ok, true);
    assert.equal(chronicInstitutionInterfaces.body.summary.readyContracts, 17);
    assert.equal(chronicInstitutionInterfaces.body.contracts.some((item) => item.path === "/api/chronic/pharmacy-callbacks" && item.ready), true);

    const chronicLaunchCore = await api(baseUrl, "/api/chronic/launch-core", authorized(commissionToken));
    assert.equal(chronicLaunchCore.response.status, 200);
    assert.equal(chronicLaunchCore.body.ok, true);
    assert.equal(chronicLaunchCore.body.summary.readyItems, 5);
    assert.equal(chronicLaunchCore.body.summary.signedSignoffs, chronicLaunchCore.body.summary.signoffs);
    assert.equal(chronicLaunchCore.body.checks.some((item) => item.id === "launch-core:actionClosure" && item.passed), true);

    const launchCoreAction = await api(baseUrl, "/api/chronic/launch-core/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        itemId: "institution-systems",
        rowId: "cei-his-emr",
        action: "joint-test-receipt-archived",
        receiptId: "api-test-receipt-001"
      })
    }));
    assert.equal(launchCoreAction.response.status, 200);
    assert.equal(launchCoreAction.body.row.latestReceiptId, "api-test-receipt-001");

    const citizenFollowupSummary = await api(baseUrl, "/api/chronic/followup-summary?residentId=r1", authorized(citizen.body.token));
    assert.equal(citizenFollowupSummary.response.status, 200);
    assert.equal(citizenFollowupSummary.body.residents.every((item) => ["r1"].includes(item.residentId)), true);

    const feedback = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        followupId: "f1",
        medicationTaken: true,
        symptoms: "home blood pressure remains high",
        nextRequest: "family doctor phone review"
      })
    }));
    assert.equal(feedback.response.status, 201);
    assert.equal(feedback.body.category, "chronic-feedback");
    assert.equal(feedback.body.meta.followupId, "f1");
    assert.equal(Boolean(feedback.body.messageId), true);

    const residentCheckin = await api(baseUrl, "/api/chronic/resident-checkins", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        measurementType: "blood pressure",
        measurementValue: "158/92 high",
        medicationPickupId: "mp1",
        medicationTaken: false,
        symptoms: "dizzy",
        seniorReminder: true
      })
    }));
    assert.equal(residentCheckin.response.status, 201);
    assert.equal(residentCheckin.body.record.category, "chronic-self-checkin");
    assert.equal(Boolean(residentCheckin.body.messageId), true);

    const residentCheckinDenied = await api(baseUrl, "/api/chronic/resident-checkins", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", measurementValue: "tampered" })
    }));
    assert.equal(residentCheckinDenied.response.status, 403);

    const deviceMeasurement = await api(baseUrl, "/api/chronic/device-measurements", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        externalId: "device-api-test-001",
        deviceId: "bp-api-test",
        deviceType: "blood pressure monitor",
        measurementValue: "151/91 high"
      })
    }));
    assert.equal(deviceMeasurement.response.status, 201);
    assert.equal(deviceMeasurement.body.record.meta.deviceExternalId, "device-api-test-001");

    const deviceMeasurementReplay = await api(baseUrl, "/api/chronic/device-measurements", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", externalId: "device-api-test-001", measurementValue: "151/91 high" })
    }));
    assert.equal(deviceMeasurementReplay.response.status, 200);
    assert.equal(deviceMeasurementReplay.body.idempotent, true);

    const pharmacyCallback = await api(baseUrl, "/api/chronic/pharmacy-callbacks", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        medicationPickupId: "mp1",
        externalId: "pharmacy-api-test-001",
        status: "picked_up",
        inventoryStatus: "dispensed",
        medicationTaken: true
      })
    }));
    assert.equal(pharmacyCallback.response.status, 200);
    assert.equal(pharmacyCallback.body.medicationPickup.callbackExternalId, "pharmacy-api-test-001");

    const familyDoctorClosure = await api(baseUrl, "/api/chronic/family-doctor-actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        taskId: `chronicSelfManagement:${residentCheckin.body.selfManagement.id}`,
        action: "family doctor phone review",
        result: "reviewed resident self-monitoring and updated plan"
      })
    }));
    assert.equal(familyDoctorClosure.response.status, 200);
    assert.equal(familyDoctorClosure.body.note.category, "chronic-family-doctor-note");

    const reminderOutreach = await api(baseUrl, "/api/chronic/reminder-outreach", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ residentId: "r1", channel: "sms", reminderType: "chronic follow-up reminder" })
    }));
    assert.equal(reminderOutreach.response.status, 201);
    assert.equal(reminderOutreach.body.seniorService.outreachEvidence, true);

    const referralContinuity = await api(baseUrl, "/api/chronic/referral-continuity", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        referralId: "rf3",
        externalId: "referral-api-test-rf3",
        standardsProfile: "chronic-referral-return-v1",
        personIndex: "person-index-r4",
        sourceSystem: "leading-hospital-emr",
        occurredAt: "2026-06-21T09:00:00.000Z",
        returnStatus: "returned-to-primary-care",
        diagnosis: "hypertension",
        primaryCareAccepted: true,
        archiveUpdated: true,
        familyRiskPrompted: true,
        nextFollowupAt: "2026-06-28",
        receivingFeedback: "primary care received the specialist return plan"
      })
    }));
    assert.equal(referralContinuity.response.status, 201);
    assert.equal(referralContinuity.body.record.category, "chronic-referral-continuity");
    assert.equal(referralContinuity.body.referral.continuity.archiveUpdated, true);
    assert.equal(referralContinuity.body.interoperability.profileId, "chronic-referral-return-v1");
    assert.equal(referralContinuity.body.record.meta.interoperability.validated, true);

    const invalidStandardReferral = await api(baseUrl, "/api/chronic/referral-continuity", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ referralId: "rf1", standardsProfile: "chronic-referral-return-v1", externalId: "referral-invalid-standard-rf1" })
    }));
    assert.equal(invalidStandardReferral.response.status, 422);
    assert.equal(invalidStandardReferral.body.missingFields.includes("personIndex"), true);

    const referralContinuityReplay = await api(baseUrl, "/api/chronic/referral-continuity", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ referralId: "rf3", externalId: "referral-api-test-rf3" })
    }));
    assert.equal(referralContinuityReplay.response.status, 200);
    assert.equal(referralContinuityReplay.body.idempotent, true);

    const referralContinuitySummary = await api(baseUrl, "/api/chronic/referral-continuity?residentId=r4", authorized(commissionToken));
    assert.equal(referralContinuitySummary.response.status, 200);
    assert.equal(referralContinuitySummary.body.rows.some((item) => item.referralId === "rf3" && item.ready), true);
    const rf3Continuity = referralContinuitySummary.body.rows.find((item) => item.referralId === "rf3");
    assert.equal(rf3Continuity.archiveMapping.standardVersion, "WS/T 363/364-2023");
    assert.equal(rf3Continuity.archiveMapping.totalDimensions, 8);

    const pharmacyCallbackDenied = await api(baseUrl, "/api/chronic/pharmacy-callbacks", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ medicationPickupId: "mp1", status: "picked_up" })
    }));
    assert.equal(pharmacyCallbackDenied.response.status, 403);

    const followupEscalationDenied = await api(baseUrl, "/api/chronic/followup-escalations", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "followups", id: "f1" })
    }));
    assert.equal(followupEscalationDenied.response.status, 403);

    const feedbackDenied = await api(baseUrl, "/api/chronic/followup-feedback", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", followupId: "f2", feedback: "tampered resident" })
    }));
    assert.equal(feedbackDenied.response.status, 403);

    const dispatched = await api(baseUrl, "/api/chronic/followup-dispatch", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        collection: "followups",
        id: "f1",
        status: "已完成",
        updates: { result: "completed after resident feedback" },
        note: "closed by commission regression test"
      })
    }));
    assert.equal(dispatched.response.status, 200);
    assert.equal(dispatched.body.status, "已完成");
    assert.equal(dispatched.body.disposition, "handled");
    assert.equal(dispatched.body.escalationStatus, "resolved");
    assert.equal(dispatched.body.closedEscalationMessages, 1);

    const manualEscalation = await api(baseUrl, "/api/chronic/followup-escalations", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ collection: "followups", id: "f3", reason: "site team keeps manual review open" })
    }));
    assert.equal(manualEscalation.response.status, 201);
    assert.equal(manualEscalation.body.item.escalationStatus, "escalated");

    const manualDispatch = await api(baseUrl, "/api/chronic/followup-dispatch", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({
        collection: "followups",
        id: "f3",
        status: "复核中",
        note: "site team recorded progress but keeps escalation open",
        resolveEscalation: false
      })
    }));
    assert.equal(manualDispatch.response.status, 200);
    assert.equal(manualDispatch.body.escalationStatus, "escalated");
    assert.equal(manualDispatch.body.closedEscalationMessages, 0);

    const dispatchDenied = await api(baseUrl, "/api/chronic/followup-dispatch", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "followups", id: "f2", status: "已完成" })
    }));
    assert.equal(dispatchDenied.response.status, 403);

    const chronicDenied = await api(baseUrl, "/api/chronic/acceptance-ledger", authorized(insurance.body.token));
    assert.equal(chronicDenied.response.status, 403);
    const chronicRiskDenied = await api(baseUrl, "/api/chronic/risk-stratification", authorized(insurance.body.token));
    assert.equal(chronicRiskDenied.response.status, 403);
    const serviceAcceptanceDenied = await api(baseUrl, "/api/service-acceptance-summary", authorized(insurance.body.token));
    assert.equal(serviceAcceptanceDenied.response.status, 403);

    const datasets = await api(baseUrl, "/api/research/datasets", authorized(commissionToken));
    assert.equal(datasets.response.status, 200);
    assert.equal(datasets.body.datasets.some((item) => item.diseaseType === "hypertension"), true);
    const sandboxSummary = await api(baseUrl, "/api/research/sandbox", authorized(commissionToken));
    assert.equal(sandboxSummary.response.status, 200);
    assert.equal(sandboxSummary.body.reusableCollections.includes("personalRecords"), true);
    assert.equal(sandboxSummary.body.boundaries.includes("sandbox access"), true);
    const researchInstitution = await login(baseUrl, "hospital");
    const application = await api(baseUrl, "/api/research/datasets", authorized(researchInstitution.body.token, {
      method: "POST",
      body: JSON.stringify({
        diseaseType: "copd",
        name: "COPD pulmonary rehabilitation cohort",
        purpose: "sandbox feasibility assessment",
        sourceCollections: ["personalRecords", "diagnosticReports"]
      })
    }));
    assert.equal(application.response.status, 201);
    assert.equal(application.body.authorizationStatus, "pending");
    assert.equal(application.body.sourceCollections.includes("diagnosticReports"), true);
    const blockedSandbox = await api(baseUrl, `/api/research/datasets/${application.body.id}/sandbox-access`, authorized(researchInstitution.body.token, {
      method: "POST",
      body: JSON.stringify({ purpose: "try before approval" })
    }));
    assert.equal(blockedSandbox.response.status, 403);
    const approval = await api(baseUrl, `/api/research/datasets/${application.body.id}/approval`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ ethicsApproval: "IRB-DEMO-COPD-2026", anonymization: "k-anonymity-demo", deidentificationStatus: "released" })
    }));
    assert.equal(approval.response.status, 200);
    assert.equal(approval.body.ethicsStatus, "approved");
    assert.equal(approval.body.sandbox.status, "active");
    const sandboxAccess = await api(baseUrl, `/api/research/datasets/${application.body.id}/sandbox-access`, authorized(researchInstitution.body.token, {
      method: "POST",
      body: JSON.stringify({ purpose: "approved de-identified sandbox analysis" })
    }));
    assert.equal(sandboxAccess.response.status, 200);
    assert.equal(sandboxAccess.body.deidentified, true);
    assert.equal(sandboxAccess.body.sourceCollections.includes("personalRecords"), true);
    const returnedOutcome = await api(baseUrl, `/api/research/datasets/${application.body.id}/outcomes`, authorized(researchInstitution.body.token, {
      method: "POST",
      body: JSON.stringify({ title: "COPD rehab feature set", summary: "Returned candidate model variables.", registryImpact: "Add pulmonary rehabilitation flags." })
    }));
    assert.equal(returnedOutcome.response.status, 200);
    assert.equal(returnedOutcome.body.outcomes[0].registryImpact, "Add pulmonary rehabilitation flags.");
    const usage = await api(baseUrl, "/api/research/datasets/rd-hypertension-001/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ action: "usage-audit", purpose: "risk stratification model validation", result: "allowed" })
    }));
    assert.equal(usage.response.status, 200);
    assert.equal(usage.body.usageAudit[0].purpose, "risk stratification model validation");
    const outcome = await api(baseUrl, "/api/research/datasets/rd-hypertension-001/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ action: "outcome-return", title: "Hypertension model calibration", summary: "Returned model threshold evidence." })
    }));
    assert.equal(outcome.response.status, 200);
    assert.equal(outcome.body.outcomes[0].title, "Hypertension model calibration");

    const models = await api(baseUrl, "/api/research/disease-models", authorized(commissionToken));
    assert.equal(models.response.status, 200);
    assert.equal(models.body.models.some((item) => item.id === "dm-hypertension-risk-v1"), true);
    const modelReview = await api(baseUrl, "/api/research/disease-models/dm-hypertension-risk-v1/review", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ version: "1.1.0", threshold: "systolic>=145 or riskLevel=high", reviewStatus: "reviewed", reviewComment: "Threshold reviewed by chronic disease expert group." })
    }));
    assert.equal(modelReview.response.status, 200);
    assert.equal(modelReview.body.version, "1.1.0");
    assert.equal(modelReview.body.reviewStatus, "reviewed");

    const accessibility = await api(baseUrl, "/api/mobile/accessibility-checklist", authorized(commissionToken));
    assert.equal(accessibility.response.status, 200);
    assert.equal(accessibility.body.checklist.some((item) => item.id === "a11y-large-font"), true);
    const accessibilityAction = await api(baseUrl, "/api/mobile/accessibility-checklist/a11y-screen-reader/actions", authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "passed", evidence: "Landmark and aria-label review passed.", tester: "accessibility-reviewer" })
    }));
    assert.equal(accessibilityAction.response.status, 200);
    assert.equal(accessibilityAction.body.status, "passed");
    assert.equal(accessibilityAction.body.tester, "accessibility-reviewer");

    const mobileExperience = await api(baseUrl, "/api/mobile/experience", authorized(citizen.body.token));
    assert.equal(mobileExperience.response.status, 200);
    assert.equal(mobileExperience.body.settings.weakNetworkMode, "cache-last-state");
    assert.equal(mobileExperience.body.seniorServices.every((item) => ["r1", "r4"].includes(item.residentId)), true);
    assert.equal(mobileExperience.body.accessibilityChecklist.some((item) => item.category === "family_proxy"), true);
    const mobilePreference = await api(baseUrl, "/api/mobile/experience", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ largeMode: true, weakNetworkMode: "cache-last-state", proxyContact: "family", offlineHelpPreferred: true, messageTouchpoint: "family_proxy" })
    }));
    assert.equal(mobilePreference.response.status, 200);
    assert.equal(mobilePreference.body.preferences.largeMode, true);
    assert.equal(mobilePreference.body.experience.preferences.proxyContact, "family");

    const denied = await api(baseUrl, "/api/mutual-recognition/reports", authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ residentId: "r2", item: "HbA1c" })
    }));
    assert.equal(denied.response.status, 403);
  });

  await t.test("supports imaging cloud ingest, EMR index sync and resident sharing scope", async () => {
    const hospital = await login(baseUrl, "hospital");
    const initialDashboard = await api(baseUrl, "/api/imaging-cloud", authorized(hospital.body.token));
    assert.equal(initialDashboard.response.status, 200);
    assert.equal(initialDashboard.body.summary.studies >= 2, true);
    assert.equal(initialDashboard.body.emrCompatibility.mappedCollections.includes("diagnosticReports"), true);
    assert.equal(initialDashboard.body.emrCompatibility.mappedCollections.includes("personalRecords"), true);
    assert.equal(initialDashboard.body.implementedFeatures.some((item) => item.id === "imaging-feature-hospital-ingest" && item.status), true);
    assert.equal(initialDashboard.body.developmentPlan.some((item) => item.id === "imaging-plan-p0-joint-test" && item.priority === "P0"), true);
    assert.equal(initialDashboard.body.developmentPlan.some((item) => item.id === "imaging-plan-p0-security" && item.evidence.includes("dataAccessLogs")), true);

    const ingest = await api(baseUrl, "/api/imaging-cloud/ingest", authorized(hospital.body.token, {
      method: "POST",
      body: JSON.stringify({
        residentId: "r1",
        institutionCode: "MR1",
        accessionNumber: "CT-API-0707",
        studyInstanceUID: "1.2.156.112605.api.0707",
        modality: "CT",
        bodyPart: "胸部",
        reportConclusion: "API 测试影像已入云，并同步电子病历索引。",
        finding: "DICOM TAG、RIS 检查信息和审核报告已归集。",
        seriesCount: 3,
        imageCount: 96,
        shareEnabled: true
      })
    }));
    assert.equal(ingest.response.status, 201);
    assert.equal(ingest.body.study.mainIndex, "MR1#DEMO-ID-R1#CT-API-0707");
    assert.equal(ingest.body.study.emrSyncStatus, "已写入电子病历索引");
    assert.equal(ingest.body.report.category, "imaging");
    assert.equal(ingest.body.report.imageCloudStudyId, ingest.body.study.id);
    assert.equal(ingest.body.personalRecord.category, "imaging");
    assert.equal(ingest.body.personalRecord.meta.imageCloudStudyId, ingest.body.study.id);
    assert.equal(ingest.body.personalRecord.meta.emrCompatible, true);

    const state = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(state.body.imageCloudStudies.some((item) => item.id === ingest.body.study.id), true);
    assert.equal(state.body.diagnosticReports.some((item) => item.id === ingest.body.report.id && item.imageCloudStudyId === ingest.body.study.id), true);
    assert.equal(state.body.personalRecords.some((item) => item.id === ingest.body.personalRecord.id && item.meta?.imageCloudStudyId === ingest.body.study.id), true);

    const imagingRecords = await api(baseUrl, "/api/personal-records?residentId=r1&category=imaging", authorized(hospital.body.token));
    assert.equal(imagingRecords.response.status, 200);
    assert.equal(imagingRecords.body.some((item) => item.id === ingest.body.personalRecord.id), true);

    const citizen = await login(baseUrl, "citizen");
    const citizenDashboard = await api(baseUrl, "/api/imaging-cloud", authorized(citizen.body.token));
    assert.equal(citizenDashboard.response.status, 200);
    assert.equal(citizenDashboard.body.studies.some((item) => item.id === ingest.body.study.id), true);
    assert.equal(citizenDashboard.body.studies.every((item) => item.residentId === "r1"), true);

    const share = await api(baseUrl, `/api/imaging-cloud/studies/${encodeURIComponent(ingest.body.study.id)}/share`, authorized(citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ validDays: 5, channel: "二维码/短信链接" })
    }));
    assert.equal(share.response.status, 201);
    assert.equal(share.body.studyId, ingest.body.study.id);
    assert.equal(share.body.status, "active");
    assert.match(share.body.token, /^IMG-/);

    const r2Citizen = await login(baseUrl, "citizen_r2");
    const forbiddenDashboard = await api(baseUrl, "/api/imaging-cloud?residentId=r1", authorized(r2Citizen.body.token));
    assert.equal(forbiddenDashboard.response.status, 403);

    const r2Dashboard = await api(baseUrl, "/api/imaging-cloud", authorized(r2Citizen.body.token));
    assert.equal(r2Dashboard.response.status, 200);
    assert.equal(r2Dashboard.body.studies.every((item) => item.residentId === "r2"), true);

    const forbiddenShare = await api(baseUrl, `/api/imaging-cloud/studies/${encodeURIComponent(ingest.body.study.id)}/share`, authorized(r2Citizen.body.token, {
      method: "POST",
      body: JSON.stringify({ validDays: 3 })
    }));
    assert.equal(forbiddenShare.response.status, 403);
  });

  await t.test("supports regional diagnosis data sharing with role scoping and access audit", async () => {
    const commission = await api(baseUrl, "/api/regional-data-sharing", authorized(commissionToken));
    assert.equal(commission.response.status, 200);
    assert.equal(commission.body.scope.name, "区域诊疗数据共享平台");
    assert.equal(commission.body.summary.totalPackages >= 3, true);
    assert.equal(commission.body.packages.some((item) => item.id === "rsp-r3-imaging"), true);
    assert.equal(commission.body.scope.exclusions.some((item) => item.includes("HIS")), true);

    const hospital = await login(baseUrl, "hospital");
    const institutionView = await api(baseUrl, "/api/regional-data-sharing", authorized(hospital.body.token));
    assert.equal(institutionView.response.status, 200);
    assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r1-hypertension"), true);
    assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r2-diabetes"), true);
    assert.equal(institutionView.body.packages.some((item) => item.id === "rsp-r3-imaging"), false);
    assert.equal(institutionView.body.packages.every((item) => !String(item.resident?.idCard || "").startsWith("DEMO-ID-")), true);

    const accessReview = await api(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(hospital.body.token, {
      method: "POST",
      body: JSON.stringify({
        packageId: "rsp-r2-diabetes",
        decision: "approved",
        purpose: "接续糖尿病复查前调阅区域检验报告",
        note: "机构端确认本次调阅范围。"
      })
    }));
    assert.equal(accessReview.response.status, 201);
    assert.equal(accessReview.body.review.packageId, "rsp-r2-diabetes");
    assert.equal(accessReview.body.package.lastAccessReviewId, accessReview.body.review.id);

    const refreshed = await api(baseUrl, "/api/regional-data-sharing", authorized(hospital.body.token));
    assert.equal(refreshed.body.accessReviews.some((item) => item.id === accessReview.body.review.id), true);
    const commissionState = await api(baseUrl, "/api/state", authorized(commissionToken));
    assert.equal(commissionState.body.dataAccessLogs.some((item) => item.scope === "regionalDataSharing" && item.residentId === "r2"), true);

    const community = await login(baseUrl, "community");
    const deniedPackage = await api(baseUrl, "/api/regional-data-sharing/access-reviews", authorized(community.body.token, {
      method: "POST",
      body: JSON.stringify({ packageId: "rsp-r3-imaging", decision: "approved", purpose: "越权调阅测试" })
    }));
    assert.equal(deniedPackage.response.status, 403);

    const insurance = await login(baseUrl, "insurance");
    const insuranceView = await api(baseUrl, "/api/regional-data-sharing", authorized(insurance.body.token));
    assert.equal(insuranceView.response.status, 403);
  });

  await t.test("enforces workflow collection ownership and protects structural fields", async () => {
    const institution = await login(baseUrl, "hospital");
    const insurance = await login(baseUrl, "insurance");
    const county = await login(baseUrl, "county");

    const institutionInsuranceWrite = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "insuranceClaims", id: "ic1", status: "已通过" })
    }));
    assert.equal(institutionInsuranceWrite.response.status, 403);

    const insuranceCareWrite = await api(baseUrl, "/api/workflow-actions", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "careOrders", id: "co1", status: "已完成" })
    }));
    assert.equal(insuranceCareWrite.response.status, 403);

    const countyMedicationWrite = await api(baseUrl, "/api/workflow-actions", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "medicationPickups", id: "mp1", status: "已完成" })
    }));
    assert.equal(countyMedicationWrite.response.status, 403);

    const insuranceChronicWrite = await api(baseUrl, "/api/workflow-actions", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "chronicComorbidityPlans", id: "ccp-001", status: "已复核" })
    }));
    assert.equal(insuranceChronicWrite.response.status, 403);

    const missingWorkflowRecord = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ collection: "careOrders", id: "missing-care-order", status: "missing" })
    }));
    assert.equal(missingWorkflowRecord.response.status, 404);

    const allowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "careOrders",
        id: "co1",
        status: "已接诊",
        expectedVersion: 20260704,
        updates: { id: "tampered", residentId: "r3", institutionReview: "已接诊" }
      })
    }));
    assert.equal(allowed.response.status, 200);
    assert.equal(allowed.body.id, "co1");
    assert.notEqual(allowed.body.residentId, "r3");
    assert.equal(allowed.body.institutionReview, "已接诊");

    const chronicAllowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "chronicComorbidityPlans",
        id: "ccp-001",
        status: "已复核",
        updates: { residentId: "r3", assessment: "已完成多病共管复核" }
      })
    }));
    assert.equal(chronicAllowed.response.status, 200);
    assert.equal(chronicAllowed.body.id, "ccp-001");
    assert.notEqual(chronicAllowed.body.residentId, "r3");
    assert.equal(chronicAllowed.body.assessment, "已完成多病共管复核");

    const medicationSupportAllowed = await api(baseUrl, "/api/workflow-actions", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "chronicMedicationSupport",
        id: "cms-001",
        status: "运行中",
        updates: { stockStatus: "已完成库存复核" }
      })
    }));
    assert.equal(medicationSupportAllowed.response.status, 200);
    const referralWorkflowAction = await api(baseUrl, "/api/workflow-actions", authorized(county.body.token, {
      method: "POST",
      body: JSON.stringify({
        collection: "referralTeleconsultations",
        id: "rtc-001",
        status: "feedback-returned",
        feedback: "Unified workflow feedback",
        note: "workflow action regression"
      })
    }));
    assert.equal(referralWorkflowAction.response.status, 200);
    assert.equal(referralWorkflowAction.body.status, "feedback-returned");
    assert.equal(medicationSupportAllowed.body.stockStatus, "已完成库存复核");
  });

  await t.test("supports drug consumable supervision roles, review, remediation and insurance sync", async () => {
    const insurance = await login(baseUrl, "insurance");
    const institution = await login(baseUrl, "hospital");
    const citizen = await login(baseUrl, "citizen");

    const denied = await api(baseUrl, "/api/drug-consumable-supervision", authorized(citizen.body.token));
    assert.equal(denied.response.status, 403);

    const supervision = await api(baseUrl, "/api/drug-consumable-supervision", authorized(insurance.body.token));
    assert.equal(supervision.response.status, 200);
    assert.equal(supervision.body.summary.total >= 3, true);
    assert.equal(supervision.body.boundaries.some((item) => item.id === "rational-medication"), true);
    assert.equal(supervision.body.insuranceCoordination.contractId, "insurance-settlement-v1");

    const review = await api(baseUrl, "/api/drug-consumable-supervision/dcs-rational-r1/review", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ reviewStatus: "review-passed", insuranceStatus: "coordinating", status: "in-review" })
    }));
    assert.equal(review.response.status, 200);
    assert.equal(review.body.reviewStatus, "review-passed");
    assert.equal(review.body.auditTrail[0].action, "drug-consumable-review");

    const syncDenied = await api(baseUrl, "/api/drug-consumable-supervision/dcs-rational-r1/insurance-sync", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ insuranceStatus: "synced" })
    }));
    assert.equal(syncDenied.response.status, 403);

    const remediation = await api(baseUrl, "/api/drug-consumable-supervision/dcs-consumable-mr1/remediation", authorized(institution.body.token, {
      method: "POST",
      body: JSON.stringify({ remediationStatus: "submitted", evidence: "institution-uploaded-catalog-version" })
    }));
    assert.equal(remediation.response.status, 200);
    assert.equal(remediation.body.remediationStatus, "submitted");

    const sync = await api(baseUrl, "/api/drug-consumable-supervision/dcs-rational-r1/insurance-sync", authorized(insurance.body.token, {
      method: "POST",
      body: JSON.stringify({ insuranceStatus: "synced", settlementBatch: "batch-202606" })
    }));
    assert.equal(sync.response.status, 200);
    assert.equal(sync.body.settlementBatch, "batch-202606");
  });

  await t.test("allows commission state persistence without losing governance collections", async () => {
    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    const saved = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(saved.response.status, 200);
    assert.equal(saved.body.applicationCatalog.length, 6);
    assert.equal(saved.body.hospitalInteroperabilityFunctions.length, 6);
    assert.equal(saved.body.institutionCreditEvaluations.length, 3);
    assert.equal(saved.body.securityAcceptanceLedger.length, 4);
    assert.equal(saved.body.productionDeploymentPlan.length, 4);
  });

  await t.test("reports blocked internet nursing site cutover tracks when policy evidence is incomplete", async () => {
    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    const blockedState = JSON.parse(JSON.stringify(current.body));
    blockedState.internetNursingPolicy = {
      ...(blockedState.internetNursingPolicy || {}),
      productionIntegration: {
        ...(blockedState.internetNursingPolicy?.productionIntegration || {}),
        messageGateway: { status: "blocked" },
        signatureStorage: { status: "blocked" },
        hospitalConnectors: [
          { system: "nursing management system", route: "/integration/internet-nursing/orders", status: "mapped" },
          { system: "EMR", route: "/integration/internet-nursing/service-records", status: "pending" }
        ]
      },
      paymentIntegration: {
        ...(blockedState.internetNursingPolicy?.paymentIntegration || {}),
        status: "blocked",
        modes: ["mobile self-pay"]
      },
      deviceVerification: {
        ...(blockedState.internetNursingPolicy?.deviceVerification || {}),
        status: "blocked",
        requiredSignals: ["mobile GPS"]
      },
      regulatorySubmission: {
        ...(blockedState.internetNursingPolicy?.regulatorySubmission || {}),
        pressureTest: { status: "failed", p95Ms: 1200 },
        signoffs: []
      }
    };
    const savedBlocked = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(blockedState)
    }));
    assert.equal(savedBlocked.response.status, 200);

    const blockedDashboard = await api(baseUrl, "/api/internet-nursing/dashboard", authorized(commissionToken));
    assert.equal(blockedDashboard.response.status, 200);
    assert.equal(blockedDashboard.body.siteCutoverPack.status, "blocked");
    assert.equal(blockedDashboard.body.siteCutoverPack.productionReadiness, "production-blocked");
    assert.equal(blockedDashboard.body.siteCutoverPack.tracks.every((item) => item.status === "blocked"), true);
    assert.equal(blockedDashboard.body.siteCutoverPack.productionBlockers.length >= 1, true);

    const restored = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(restored.response.status, 200);
    const restoredDashboard = await api(baseUrl, "/api/internet-nursing/dashboard", authorized(commissionToken));
    assert.equal(restoredDashboard.body.siteCutoverPack.status, "ready-for-site-signoff");
  });

  await t.test("verifies audit hash chains and detects tampering", async () => {
    const verified = await api(baseUrl, "/api/audit/verify", authorized(commissionToken));
    assert.equal(verified.response.status, 200);
    assert.equal(verified.body.passed, true);
    assert.equal(verified.body.trails.securityEvents.passed, true);
    assert.equal(verified.body.trails.dataAccessLogs.passed, true);

    const auditExport = await api(baseUrl, "/api/audit/export?trail=securityEvents", authorized(commissionToken));
    assert.equal(auditExport.response.status, 200);
    assert.equal(auditExport.body.securityEvents.length > 0, true);
    assert.equal(auditExport.body.dataAccessLogs.length, 0);

    const compliance = await api(baseUrl, "/api/security/compliance-report", authorized(commissionToken));
    assert.equal(compliance.response.status, 200);
    assert.equal(compliance.body.summary.auditPassed, true);
    assert.equal(compliance.body.ledger.length, 4);

    const highRisk = await api(baseUrl, "/api/security/high-risk-events", authorized(commissionToken));
    assert.equal(highRisk.response.status, 200);
    assert.equal(highRisk.body.events.length > 0, true);

    const controlId = compliance.body.ledger[0].id;
    const controlAction = await api(baseUrl, `/api/security/controls/${controlId}/actions`, authorized(commissionToken, {
      method: "POST",
      body: JSON.stringify({ status: "证据已归档", evidence: "audit-export-and-compliance-report", action: "archive-evidence" })
    }));
    assert.equal(controlAction.response.status, 200);
    assert.equal(controlAction.body.evidence, "audit-export-and-compliance-report");

    const current = await api(baseUrl, "/api/state", authorized(commissionToken));
    current.body.securityEvents[0].detail = "tampered audit detail";
    const tamperedSave = await api(baseUrl, "/api/state", authorized(commissionToken, {
      method: "PUT",
      body: JSON.stringify(current.body)
    }));
    assert.equal(tamperedSave.response.status, 200);

    const tamperedVerify = await api(baseUrl, "/api/audit/verify", authorized(commissionToken));
    assert.equal(tamperedVerify.response.status, 200);
    assert.equal(tamperedVerify.body.passed, false);
    assert.equal(tamperedVerify.body.trails.securityEvents.passed, false);
    assert.ok(tamperedVerify.body.trails.securityEvents.broken.length > 0);
  });

  await t.test("invalidates a session after logout", async () => {
    const session = await login(baseUrl, "county");
    const logout = await api(baseUrl, "/api/auth/logout", authorized(session.body.token, { method: "POST" }));
    assert.equal(logout.response.status, 200);
    const me = await api(baseUrl, "/api/auth/me", authorized(session.body.token));
    assert.equal(me.response.status, 401);
  });

  await t.test("guards and executes commission data reset", async () => {
    const denied = await api(baseUrl, "/api/reset", authorized(citizenToken, { method: "POST" }));
    assert.equal(denied.response.status, 403);

    const reset = await api(baseUrl, "/api/reset", authorized(commissionToken, { method: "POST" }));
    assert.equal(reset.response.status, 200);
    assert.equal(reset.body.residents.length >= 4, true);
    assert.equal(reset.body.securityEvents[0].target, "/api/reset");
    assert.match(reset.body.securityEvents[0].actor, /大连市(卫生健康委|卫健委)管理员/);
  });
});
