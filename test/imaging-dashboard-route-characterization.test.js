"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  createRouteSegment: createClinicalBloodRouteSegment
} = require("../src/http/routes/clinical-specialties/clinical-blood");
const {
  createRouteSegment: createImagingRouteSegment
} = require("../src/http/routes/clinical-specialties/imaging-cloud");

function createRuntime({ authorized = true, residentAllowed = true } = {}) {
  const calls = {
    accessLogs: [],
    authorization: [],
    builds: [],
    reads: 0,
    redactions: [],
    responses: [],
    securityEvents: [],
    writes: []
  };
  const user = { id: "imaging-user-001", name: "影像调阅员", role: "institution", orgCode: "ORG-A" };
  const data = { marker: "imaging-dashboard-characterization" };
  const runtime = {
    BloodTransactionService: new Proxy({}, { get: () => () => undefined }),
    appendDataAccessLog(input, actor, residentId, category, detail) {
      calls.accessLogs.push({ input, actor, residentId, category, detail });
    },
    appendSecurityEvent(event) {
      calls.securityEvents.push(event);
    },
    buildImageCloudDashboard(input, actor, filters) {
      calls.builds.push({ input, actor, filters });
      return {
        summary: { studies: 1 },
        studies: [{ id: "study-001", objectPath: "oss://private/study-001", viewerUrl: "https://viewer.test/?token=secret" }],
        shares: [{ id: "share-001", token: "IMG-SECRET" }]
      };
    },
    canAccessResident(actor, residentId, input) {
      assert.equal(actor, user);
      assert.equal(residentId, "resident-001");
      assert.equal(input, data);
      return residentAllowed;
    },
    collectJson() {
      throw new Error("imaging dashboard must not collect a request body");
    },
    readDatabase() {
      calls.reads += 1;
      return data;
    },
    redactSensitiveResponse(payload, actor) {
      calls.redactions.push({ payload, actor });
      return { ...payload, redactionMarker: true };
    },
    requireApiRole(_req, _res, roles, route) {
      calls.authorization.push({ roles, route });
      return authorized ? user : null;
    },
    sendJson(_res, status, body) {
      calls.responses.push({ status, body });
    },
    writeDatabase(input) {
      calls.writes.push(input);
    }
  };
  return { calls, data, runtime, user };
}

test("imaging dashboard preserves resident scope, audit persistence and public projection", async () => {
  const { calls, data, runtime, user } = createRuntime();
  const segment = createClinicalBloodRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001&institutionCode=ORG-A")
  );

  assert.equal(handled, true);
  assert.deepEqual(calls.authorization, [{
    roles: ["commission", "institution", "county", "citizen"],
    route: "/api/imaging-cloud"
  }]);
  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, [{
    input: data,
    actor: user,
    residentId: "resident-001",
    category: "医学影像云",
    detail: "查询影像检查、报告和电子病历索引"
  }]);
  assert.deepEqual(calls.writes, [data]);
  assert.deepEqual(calls.builds, [{
    input: data,
    actor: user,
    filters: { residentId: "resident-001", institutionCode: "ORG-A" }
  }]);
  assert.equal(calls.redactions.length, 1);
  assert.equal(calls.redactions[0].actor, user);
  assert.deepEqual(calls.responses, [{
    status: 200,
    body: {
      summary: { studies: 1 },
      studies: [{ id: "study-001" }],
      shares: [{ id: "share-001" }],
      redactionMarker: true,
      mutualRecognition: []
    }
  }]);
});

test("imaging dashboard without resident filter does not append an access audit", async () => {
  const { calls, runtime } = createRuntime();
  const segment = createClinicalBloodRouteSegment(runtime);

  await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?institutionCode=ORG-A")
  );

  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.builds[0].filters, { residentId: "", institutionCode: "ORG-A" });
  assert.equal(calls.responses[0].status, 200);
});

test("imaging dashboard denies resident scope before audit, build and persistence", async () => {
  const { calls, runtime } = createRuntime({ residentAllowed: false });
  const segment = createClinicalBloodRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001")
  );

  assert.equal(handled, true);
  assert.equal(calls.reads, 1);
  assert.deepEqual(calls.accessLogs, []);
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.builds, []);
  assert.deepEqual(calls.redactions, []);
  assert.deepEqual(calls.securityEvents, [{
    actor: "影像调阅员",
    role: "institution",
    action: "access imaging cloud",
    target: "resident-001",
    result: "denied",
    detail: "resident scope denied"
  }]);
  assert.deepEqual(calls.responses, [{
    status: 403,
    body: { error: "Forbidden", code: undefined, message: "无权调阅该居民影像云资料", productionReady: undefined }
  }]);
});

test("imaging dashboard stops before data access when authorization is denied", async () => {
  const { calls, runtime } = createRuntime({ authorized: false });
  const segment = createClinicalBloodRouteSegment(runtime);

  const handled = await segment.handle(
    { method: "GET" },
    {},
    new URL("http://platform.test/api/imaging-cloud?residentId=resident-001")
  );

  assert.equal(handled, true);
  assert.equal(calls.authorization.length, 1);
  assert.equal(calls.reads, 0);
  assert.deepEqual(calls.securityEvents, []);
  assert.deepEqual(calls.responses, []);
});

test("clinical blood route construction remains lazy for imaging manifest probes", () => {
  const placeholder = () => "placeholder";
  const segment = createClinicalBloodRouteSegment(new Proxy({}, { get: () => placeholder }));

  assert.equal(segment.id, "clinical-specialties-06");
});

test("imaging study share preserves authorization, scope, body, audit and response order", async () => {
  const sequence = [];
  const responses = [];
  const user = { name: "影像调阅员", role: "institution", username: "imaging-user" };
  const study = {
    id: "study/001",
    residentId: "resident-001",
    accessionNumber: "ACCESS-001"
  };
  const data = { imageCloudStudies: [study], imageCloudShares: [] };
  const runtime = {
    appendDataAccessLog(input, actor, residentId, category, detail) {
      sequence.push("audit");
      assert.equal(input, data);
      assert.equal(actor, user);
      assert.equal(residentId, "resident-001");
      assert.equal(category, "医学影像云");
      assert.equal(detail, "分享影像 ACCESS-001 至 安全通道");
    },
    canAccessResident(actor, residentId, input) {
      sequence.push("scope");
      assert.equal(actor, user);
      assert.equal(residentId, "resident-001");
      assert.equal(input, data);
      return true;
    },
    async collectJson() {
      sequence.push("body");
      return { validDays: 120, channel: " 安全通道 ", scope: " 报告 " };
    },
    randomUUID() {
      const value = sequence.includes("share-id") ? "tokenvalue-002" : "sharevalue-001";
      sequence.push(sequence.includes("share-id") ? "share-token" : "share-id");
      return value;
    },
    readDatabase() {
      sequence.push("read");
      return data;
    },
    requireApiRole(_req, _res, roles, route) {
      sequence.push("authorization");
      assert.deepEqual(roles, ["citizen", "institution", "commission"]);
      assert.equal(route, "/api/imaging-cloud/studies/:id/share");
      return user;
    },
    sendJson(_res, status, body) {
      sequence.push("response");
      responses.push({ status, body });
    },
    writeDatabase(input) {
      sequence.push("write");
      assert.equal(input, data);
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/study%2F001/share")
  );

  assert.equal(handled, true);
  assert.deepEqual(sequence, [
    "authorization",
    "read",
    "scope",
    "body",
    "share-id",
    "share-token",
    "audit",
    "write",
    "response"
  ]);
  assert.equal(data.imageCloudShares.length, 1);
  assert.equal(data.imageCloudShares[0].id, "ics-share-sharevalue-001");
  assert.equal(data.imageCloudShares[0].token, "IMG-TOKENVAL");
  assert.equal(data.imageCloudShares[0].channel, "安全通道");
  assert.equal(data.imageCloudShares[0].scope, "报告");
  assert.equal(data.imageCloudShares[0].createdBy, "imaging-user");
  assert.equal(data.imageCloudShares[0].status, "active");
  const lifetimeMs = new Date(data.imageCloudShares[0].expiresAt).getTime()
    - new Date(data.imageCloudShares[0].createdAt).getTime();
  assert.equal(lifetimeMs <= 90 * 24 * 60 * 60 * 1000, true);
  assert.equal(lifetimeMs >= 90 * 24 * 60 * 60 * 1000 - 1000, true);
  assert.deepEqual(responses, [{
    status: 201,
    body: {
      id: "ics-share-sharevalue-001",
      studyId: "study/001",
      residentId: "resident-001",
      channel: "安全通道",
      expiresAt: data.imageCloudShares[0].expiresAt,
      scope: "报告",
      createdBy: "imaging-user",
      createdAt: data.imageCloudShares[0].createdAt,
      status: "active"
    }
  }]);
});

test("imaging quality control preserves authorization, lookup, FHIR publish and one local write", async () => {
  const sequence = [];
  const responses = [];
  let persistedData;
  const user = { name: "影像质控员", role: "institution" };
  const study = {
    id: "study/quality-001",
    residentId: "resident-001",
    qcStatus: "待质控",
    emrSyncStatus: "待报告审核后写入"
  };
  const data = { imageCloudStudies: [study], imageCloudQualityReviews: [] };
  const runtime = {
    appendSecurityEvent() {
      sequence.push("unexpected-security-audit");
    },
    async collectJson() {
      sequence.push("body");
      return { result: " 合格 ", group: " 专项抽样 " };
    },
    async publishDiagnosticReportToFhir(updatedStudy, review) {
      sequence.push("fhir-publish");
      assert.equal(updatedStudy.id, "study/quality-001");
      assert.equal(updatedStudy.qcStatus, "合格");
      assert.equal(updatedStudy.emrSyncStatus, "已写入电子病历索引");
      assert.equal(review.group, "专项抽样");
      assert.equal(data.imageCloudStudies[0], study);
      return {
        diagnosticReport: { id: "diagnostic-report-quality-001" },
        endpoint: "https://fhir.internal.test/DiagnosticReport/diagnostic-report-quality-001"
      };
    },
    randomUUID() {
      sequence.push("review-id");
      return "quality-review-001";
    },
    readDatabase() {
      sequence.push("read");
      return data;
    },
    requireApiRole(_req, _res, roles, route) {
      sequence.push("authorization");
      assert.deepEqual(roles, ["commission", "institution"]);
      assert.equal(route, "/api/imaging-cloud/studies/:id/qc");
      return user;
    },
    sendJson(_res, status, body) {
      sequence.push("response");
      responses.push({ status, body });
    },
    writeDatabase(input) {
      sequence.push("write");
      assert.notEqual(input, data);
      persistedData = input;
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/study%2Fquality-001/qc")
  );

  assert.equal(handled, true);
  assert.deepEqual(sequence, [
    "authorization",
    "read",
    "body",
    "review-id",
    "fhir-publish",
    "write",
    "response"
  ]);
  assert.equal(data.imageCloudQualityReviews.length, 0);
  assert.equal(data.imageCloudStudies[0], study);
  assert.equal(persistedData.imageCloudQualityReviews.length, 1);
  assert.equal(persistedData.imageCloudQualityReviews[0].id, "icq-quality-review-001");
  assert.equal(persistedData.imageCloudStudies[0].fhirDiagnosticReportId, "diagnostic-report-quality-001");
  assert.equal(responses[0].status, 200);
  assert.equal(responses[0].body.review.id, "icq-quality-review-001");
  assert.equal(responses[0].body.fhirReportSync.endpoint, undefined);
});

test("imaging quality control reports reconciliation required after FHIR succeeds and local persistence fails", async () => {
  const responses = [];
  const securityEvents = [];
  const data = {
    imageCloudStudies: [{ id: "study-001", qcStatus: "待质控", emrSyncStatus: "待写入" }],
    imageCloudQualityReviews: []
  };
  const runtime = {
    appendSecurityEvent(event) {
      securityEvents.push(event);
    },
    async collectJson() {
      return {};
    },
    async publishDiagnosticReportToFhir() {
      return { diagnosticReport: { id: "diagnostic-report-001" } };
    },
    randomUUID() {
      return "review-001";
    },
    readDatabase() {
      return data;
    },
    requireApiRole() {
      return { name: "影像质控员", role: "institution" };
    },
    sendJson(_res, status, body) {
      responses.push({ status, body });
    },
    writeDatabase() {
      throw new Error("local persistence failed");
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/study-001/qc")
  );
  assert.equal(handled, true);
  assert.equal(data.imageCloudStudies[0].qcStatus, "待质控");
  assert.deepEqual(data.imageCloudQualityReviews, []);
  assert.deepEqual(securityEvents, []);
  assert.deepEqual(responses, [{
    status: 503,
    body: {
      error: "Imaging QC Local Commit Failed",
      code: "IMAGING_QC_RECONCILIATION_REQUIRED",
      message: "FHIR 已确认接收质控报告，但本地保存未完成；请勿重复提交，需先完成跨系统对账。",
      retryable: false,
      reconciliationRequired: true,
      reconciliation: {
        studyId: "study-001",
        externalOutcome: "confirmed",
        localOutcome: "not-committed",
        resourceType: "DiagnosticReport",
        resourceId: "diagnostic-report-001"
      },
      productionReady: undefined
    }
  }]);
});

test("imaging quality control keeps preparation failures outside the provider failure mapping", async () => {
  const sequence = [];
  const runtime = {
    async collectJson() { return {}; },
    async publishDiagnosticReportToFhir() { sequence.push("unexpected-provider"); },
    randomUUID() { throw new Error("uuid failed"); },
    readDatabase() { return { imageCloudStudies: [{ id: "study-001" }], imageCloudQualityReviews: [] }; },
    requireApiRole() { return { name: "影像质控员", role: "institution" }; },
    sendJson() { sequence.push("unexpected-response"); },
    writeDatabase() { sequence.push("unexpected-write"); }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));
  await assert.rejects(
    segment.handle({ method: "POST" }, {}, new URL("http://platform.test/api/imaging-cloud/studies/study-001/qc")),
    /uuid failed/
  );
  assert.deepEqual(sequence, []);
});

test("imaging quality control maps a malformed successful provider receipt to an unknown outcome", async () => {
  const responses = [];
  const securityEvents = [];
  const data = { imageCloudStudies: [{ id: "study-001" }], imageCloudQualityReviews: [] };
  const runtime = {
    appendSecurityEvent(event) { securityEvents.push(event); },
    async collectJson() { return {}; },
    async publishDiagnosticReportToFhir() { return {}; },
    randomUUID() { return "review-001"; },
    readDatabase() { return data; },
    requireApiRole() { return { name: "影像质控员", role: "institution" }; },
    sendJson(_res, status, body) { responses.push({ status, body }); },
    writeDatabase() { throw new Error("write must not run"); }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));
  const handled = await segment.handle({ method: "POST" }, {}, new URL("http://platform.test/api/imaging-cloud/studies/study-001/qc"));
  assert.equal(handled, true);
  assert.deepEqual(data.imageCloudQualityReviews, []);
  assert.equal(securityEvents[0].detail, "IMAGING_QC_FHIR_RECEIPT_INVALID");
  assert.deepEqual(responses, [{
    status: 502,
    body: {
      error: "FHIR DiagnosticReport Sync Failed",
      code: "IMAGING_QC_FHIR_RECEIPT_INVALID",
      message: "FHIR 回写结果无法确认，本地质控记录未保存；请先核对外部结果，不要直接重复提交。",
      retryable: false,
      reconciliationRequired: true,
      reconciliation: {
        studyId: "study-001",
        externalOutcome: "unknown",
        localOutcome: "not-committed"
      },
      productionReady: undefined
    }
  }]);
});

test("imaging quality control returns not found before body, provider and local write", async () => {
  const sequence = [];
  const responses = [];
  const runtime = {
    collectJson() {
      sequence.push("unexpected-body");
    },
    publishDiagnosticReportToFhir() {
      sequence.push("unexpected-provider");
    },
    readDatabase() {
      sequence.push("read");
      return { imageCloudStudies: [] };
    },
    requireApiRole() {
      sequence.push("authorization");
      return { name: "影像质控员", role: "institution" };
    },
    sendJson(_res, status, body) {
      sequence.push("response");
      responses.push({ status, body });
    },
    writeDatabase() {
      sequence.push("unexpected-write");
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/missing/qc")
  );

  assert.equal(handled, true);
  assert.deepEqual(sequence, ["authorization", "read", "response"]);
  assert.deepEqual(responses, [{
    status: 404,
    body: { error: "Not Found", code: undefined, message: "未找到影像云检查", productionReady: undefined }
  }]);
});

test("imaging quality control stops before reading when authorization is denied", async () => {
  const sequence = [];
  const runtime = {
    readDatabase() {
      sequence.push("unexpected-read");
    },
    requireApiRole() {
      sequence.push("authorization");
      return null;
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/study-001/qc")
  );

  assert.equal(handled, true);
  assert.deepEqual(sequence, ["authorization"]);
});

test("imaging quality control audits one provider failure and performs no local business write", async () => {
  const sequence = [];
  const securityEvents = [];
  const responses = [];
  const study = { id: "study-001", qcStatus: "待质控", emrSyncStatus: "待写入" };
  const data = { imageCloudStudies: [study], imageCloudQualityReviews: [] };
  const runtime = {
    appendSecurityEvent(event) {
      sequence.push("security-audit");
      securityEvents.push(event);
    },
    async collectJson() {
      sequence.push("body");
      return {};
    },
    async publishDiagnosticReportToFhir() {
      sequence.push("fhir-publish");
      throw new Error("FHIR provider unavailable");
    },
    randomUUID() {
      sequence.push("review-id");
      return "failed-review";
    },
    readDatabase() {
      sequence.push("read");
      return data;
    },
    requireApiRole() {
      sequence.push("authorization");
      return { name: "影像质控员", role: "institution" };
    },
    sendJson(_res, status, body) {
      sequence.push("response");
      responses.push({ status, body });
    },
    writeDatabase() {
      sequence.push("unexpected-write");
    }
  };
  const segment = createImagingRouteSegment(new Proxy(runtime, { get: (target, key) => target[key] || (() => undefined) }));

  const handled = await segment.handle(
    { method: "POST" },
    {},
    new URL("http://platform.test/api/imaging-cloud/studies/study-001/qc")
  );

  assert.equal(handled, true);
  assert.deepEqual(sequence, [
    "authorization",
    "read",
    "body",
    "review-id",
    "fhir-publish",
    "security-audit",
    "response"
  ]);
  assert.equal(data.imageCloudStudies[0], study);
  assert.deepEqual(data.imageCloudQualityReviews, []);
  assert.deepEqual(securityEvents, [{
    actor: "影像质控员",
    role: "institution",
    action: "sync DiagnosticReport to FHIR",
    target: "study-001",
    result: "failed",
    detail: "IMAGING_QC_FHIR_OUTCOME_UNKNOWN"
  }]);
  assert.deepEqual(responses, [{
    status: 502,
    body: {
      error: "FHIR DiagnosticReport Sync Failed",
      code: "IMAGING_QC_FHIR_OUTCOME_UNKNOWN",
      message: "FHIR 回写结果无法确认，本地质控记录未保存；请先核对外部结果，不要直接重复提交。",
      retryable: false,
      reconciliationRequired: true,
      reconciliation: {
        studyId: "study-001",
        externalOutcome: "unknown",
        localOutcome: "not-committed"
      },
      productionReady: undefined
    }
  }]);
});

test("imaging workbench exposes role-scoped QC and explicit non-blind retry guidance", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  assert.match(source, /function canManageQualityControl\(\)[\s\S]*\["commission", "institution"\]/);
  assert.match(source, /data-qc-study=/);
  assert.match(source, /\/imaging-cloud\/studies\/\$\{encodeURIComponent\(studyId\)\}\/qc/);
  assert.match(source, /payload\.reconciliationRequired/);
  assert.match(source, /请先刷新列表核对后再决定是否重试/);
  assert.match(source, /本页已阻止重复提交/);
  assert.match(source, /data-qc-status=/);
  assert.match(source, /function inspectQualityControlStatus/);
});

function assertQcRecoveryGuidance(message) {
  for (const text of ["暂停重复提交", "刷新页面不能证明对账完成", "点击查看状态", "机构受控工单", "影像管理员", "明确核验结论前保留需对账状态"]) {
    assert.ok(message.includes(text), `missing QC recovery guidance: ${text}`);
  }
  assert.doesNotMatch(message, /对账后重新加载页面/);
}

test("imaging browser accepts only the existing committed QC success projection", async (t) => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  const studyId = "study/response-001";
  const resourceId = "diagnostic-report-response-001";
  let successResponse;
  let writes = 0;
  const data = { imageCloudStudies: [{ id: studyId, qcStatus: "待质控" }], imageCloudQualityReviews: [] };
  const segment = createImagingRouteSegment({
    requireApiRole() { return { role: "institution", name: "影像质控员" }; },
    readDatabase() { return data; },
    async collectJson() { return { result: "质控通过", scanScore: 90, reportScore: 91 }; },
    randomUUID() { return "response-review-001"; },
    async publishDiagnosticReportToFhir() { return { diagnosticReport: { id: resourceId } }; },
    writeDatabase() { writes += 1; },
    sendJson(_res, status, body) { successResponse = { status, body }; }
  });
  await segment.handle({ method: "POST" }, {}, new URL(`http://platform.test/api/imaging-cloud/studies/${encodeURIComponent(studyId)}/qc`));
  assert.equal(writes, 1);
  assert.equal(successResponse.status, 200);
  // Use the actual public route projection; the server does not require FHIR version/type/status here.
  assert.deepEqual(successResponse.body.fhirReportSync, { diagnosticReport: { id: resourceId } });
  const scenarios = [
    { name: "valid committed response", valid: true },
    ...["a", `A.${"x".repeat(61)}-`].map((id) => ({
      name: `valid resource ID length ${id.length}`, valid: true,
      body: (body) => ({ ...body, study: { ...body.study, fhirDiagnosticReportId: id }, fhirReportSync: { diagnosticReport: { id } } })
    })),
    { name: "additional fields and existing review values remain compatible", valid: true, body: (body) => ({
      ...body, extension: { contractHint: "synthetic-compatible-field" },
      review: { ...body.review, result: "需复核", scanScore: 0, reportScore: 0 }
    }) },
    { name: "malformed JSON", invalidJson: true },
    { name: "null response", body: () => null },
    { name: "array response", body: () => [] },
    { name: "empty response", body: () => ({}) },
    { name: "string response", body: () => "success" },
    { name: "missing study", body: (body) => ({ ...body, study: undefined }) },
    { name: "wrong study", body: (body) => ({ ...body, study: { ...body.study, id: "other-study" } }) },
    { name: "missing review", body: (body) => ({ ...body, review: null }) },
    { name: "wrong review study", body: (body) => ({ ...body, review: { ...body.review, studyId: "other-study" } }) },
    { name: "unconfirmed local sync", body: (body) => ({ ...body, study: { ...body.study, fhirReportSyncStatus: "pending" } }) },
    { name: "missing local resource ID", body: (body) => ({ ...body, study: { ...body.study, fhirDiagnosticReportId: undefined } }) },
    { name: "mismatched resource IDs", body: (body) => ({ ...body, study: { ...body.study, fhirDiagnosticReportId: "other-report" } }) },
    { name: "missing FHIR receipt", body: (body) => ({ ...body, fhirReportSync: null }) },
    { name: "missing DiagnosticReport", body: (body) => ({ ...body, fhirReportSync: {} }) },
    ...[undefined, 123, "", " ", "invalid/report", "x".repeat(65)].map((id, index) => ({
      name: `invalid resource ID ${index}`,
      body: (body) => ({ ...body, study: { ...body.study, fhirDiagnosticReportId: id }, fhirReportSync: { diagnosticReport: { id } } })
    })),
    { name: "202 is not committed 200", status: 202 },
    { name: "204 is not committed 200", status: 204 }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const calls = [];
    const alerts = [];
    const table = { innerHTML: "" };
    const attributes = new Map();
    let promptCount = 0;
    const prompts = ["质控通过", "90", "91", "影像与报告质控通过"];
    const originalPayload = { studies: [{ id: studyId, qcStatus: "待质控" }] };
    const refreshedPayload = { studies: [], qualityReviews: [] };
    const body = scenario.body ? scenario.body(successResponse.body) : successResponse.body;
    const window = {
      alert(message) { alerts.push(message); },
      HealthStructuredDialog: { async prompt() { return prompts[promptCount++ % prompts.length]; } },
      HealthCityAuth: {
        getUser() { return { role: "institution" }; },
        async authFetch(url, options = {}) {
          const method = options.method || "GET";
          calls.push({ method, url });
          if (method === "GET") return { ok: true, status: 200, async json() { return refreshedPayload; } };
          return { ok: true, status: scenario.status || 200, async json() {
            if (scenario.invalidJson) throw new SyntaxError("synthetic-private-response-marker");
            return body;
          } };
        }
      }
    };
    const context = {
      console, window, URL, URLSearchParams,
      location: { origin: "http://platform.test", protocol: "http:" },
      document: { addEventListener() {}, querySelector(selector) { return selector === "#study-table" ? table : null; } },
      fetch() { throw new Error("unexpected unauthenticated fetch"); }
    };
    vm.runInNewContext(`${source}\n;globalThis.qcTest = { imagingState, imagingQualityControlActionState, imagingQualityControlRecovery, qualityControlStudy, inspectQualityControlStatus };`, context);
    const qc = context.qcTest;
    qc.imagingState.payload = originalPayload;
    const button = {
      dataset: {}, disabled: false, textContent: "质控回写",
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); }
    };
    await qc.qualityControlStudy(studyId, button);
    assert.equal(promptCount, 4);
    assert.equal(calls[0].url, "http://platform.test/api/imaging-cloud/studies/study%2Fresponse-001/qc");
    if (scenario.valid) {
      assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
      assert.equal(qc.imagingState.payload, refreshedPayload);
      assert.equal(qc.imagingQualityControlActionState.has(studyId), false);
      assert.equal(qc.imagingQualityControlRecovery.has(studyId), false);
      assert.equal(button.disabled, false);
      assert.match(alerts[0], /FHIR 回执确认并保存到本地/);
      return;
    }
    assert.equal(qc.imagingQualityControlActionState.get(studyId), "reconciliation-required");
    const recovery = qc.imagingQualityControlRecovery.get(studyId);
    assert.equal(recovery.externalOutcome, "unknown");
    assert.equal(recovery.resourceId, undefined);
    assert.equal(qc.imagingState.payload, originalPayload);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "需对账");
    assert.equal(attributes.has("aria-busy"), false);
    assertQcRecoveryGuidance(alerts[0]);
    assert.doesNotMatch(alerts[0], /FHIR 回执确认并保存|synthetic-private-response-marker/);
    await qc.qualityControlStudy(studyId, button);
    assert.equal(promptCount, 4);
    assert.deepEqual(calls.map((call) => call.method), ["POST"]);
    assert.equal(qc.imagingQualityControlRecovery.get(studyId), recovery);
    assert.match(table.innerHTML, /data-qc-status=/);
    await qc.inspectQualityControlStatus(studyId);
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
    assert.equal(qc.imagingQualityControlActionState.get(studyId), "reconciliation-required");
    assert.equal(qc.imagingQualityControlRecovery.get(studyId), recovery);
    assertQcRecoveryGuidance(alerts.at(-1));
  });
});

test("imaging QC recovery guidance preserves locks across transport and strict-read failures", async (t) => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  const scenarios = [
    { name: "unknown receipt and HTTP read failure", external: "unknown", read: "http" },
    { name: "lost POST response and offline GET", external: "network", read: "network" },
    { name: "confirmed receipt and malformed JSON", external: "confirmed", read: "json" },
    { name: "unknown receipt and missing study list", external: "unknown", read: "shape" },
    { name: "unknown receipt and study outside current view", external: "unknown", read: "missing" },
    { name: "confirmed receipt and same local resource ID", external: "confirmed", read: "matching" },
    { name: "unknown receipt cannot be confirmed by matching local fields", external: "unknown", read: "matching" }
  ];
  for (const scenario of scenarios) await t.test(scenario.name, async () => {
    const calls = [];
    const alerts = [];
    const attributes = new Map();
    const table = { innerHTML: "" };
    const prompts = ["质控通过", "90", "91", "影像与报告质控通过"];
    let promptCount = 0;
    let fallbackCount = 0;
    const currentPayload = {
      studies: scenario.read === "missing" ? [] : [{
        id: "study-001", qcStatus: "质控通过", fhirReportSyncStatus: "synced",
        fhirDiagnosticReportId: "diagnostic-report-001"
      }],
      qualityReviews: []
    };
    const window = {
      alert(message) { alerts.push(message); },
      HealthStructuredDialog: { async prompt() { promptCount += 1; return prompts.shift(); } },
      HealthCityAuth: {
        getUser() { return { role: "institution" }; },
        async authFetch(url, options = {}) {
          const method = options.method || "GET";
          calls.push({ method, url });
          if (method === "POST") {
            if (scenario.external === "network") throw new Error("connection lost");
            return { ok: false, status: scenario.external === "confirmed" ? 503 : 502, async json() {
              return {
                message: "质控结果需核对", retryable: false, reconciliationRequired: true,
                reconciliation: {
                  studyId: "study-001", externalOutcome: scenario.external, localOutcome: "not-committed",
                  ...(scenario.external === "confirmed" ? { resourceType: "DiagnosticReport", resourceId: "diagnostic-report-001" } : {})
                }
              };
            } };
          }
          if (scenario.read === "network") throw new Error("offline");
          return { ok: scenario.read !== "http", status: scenario.read === "http" ? 503 : 200, async json() {
            if (scenario.read === "json") throw new SyntaxError("invalid JSON");
            if (scenario.read === "shape") return { summary: {} };
            if (scenario.read === "http") return { message: "dashboard unavailable" };
            return currentPayload;
          } };
        }
      }
    };
    const context = {
      console, window, URL, URLSearchParams,
      location: { origin: "http://platform.test", protocol: "http:" },
      document: { addEventListener() {}, querySelector(selector) { return selector === "#study-table" ? table : null; } },
      fetch() { fallbackCount += 1; throw new Error("unexpected unauthenticated fetch"); },
      fallbackProbe() { fallbackCount += 1; throw new Error("unexpected demo fallback"); }
    };
    vm.runInNewContext(`${source}\n;buildFallbackImagingCloud = fallbackProbe; globalThis.qcTest = { imagingState, imagingQualityControlActionState, imagingQualityControlRecovery, qualityControlStudy, inspectQualityControlStatus };`, context);
    const qc = context.qcTest;
    const originalPayload = { studies: [{ id: "study-001", qcStatus: "待质控" }] };
    qc.imagingState.payload = originalPayload;
    qc.imagingState.selectedResidentId = "resident-fixture";
    qc.imagingState.selectedInstitutionCode = "institution-fixture";
    const button = {
      dataset: {}, textContent: "质控回写", disabled: false,
      setAttribute(name, value) { attributes.set(name, value); },
      removeAttribute(name) { attributes.delete(name); }
    };
    await qc.qualityControlStudy("study-001", button);
    assertQcRecoveryGuidance(alerts.at(-1));
    assert.equal(qc.imagingState.payload, originalPayload);
    assert.equal(button.disabled, true);
    assert.equal(button.textContent, "需对账");
    assert.equal(attributes.get("aria-disabled"), "true");
    assert.match(attributes.get("title"), /刷新页面不能证明对账完成.*机构受控工单.*影像管理员/);
    assert.doesNotMatch(attributes.get("title"), /对账后重新加载页面/);
    const recovery = qc.imagingQualityControlRecovery.get("study-001");
    assert.equal(recovery.externalOutcome, scenario.external === "confirmed" ? "confirmed" : "unknown");

    await qc.inspectQualityControlStatus("study-001");
    assertQcRecoveryGuidance(alerts.at(-1));
    assert.equal(qc.imagingQualityControlRecovery.get("study-001"), recovery);
    assert.equal(qc.imagingQualityControlActionState.get("study-001"), "reconciliation-required");
    assert.equal(fallbackCount, 0);
    assert.equal(calls[1].url, "http://platform.test/api/imaging-cloud?residentId=resident-fixture&institutionCode=institution-fixture");
    if (["http", "network", "json", "shape"].includes(scenario.read)) {
      assert.equal(qc.imagingState.payload, originalPayload);
      assert.match(alerts.at(-1), /未能读取当前本地状态.*未使用演示数据替代/);
    } else {
      assert.equal(qc.imagingState.payload, currentPayload);
      if (scenario.read === "missing") assert.match(alerts.at(-1), /当前授权与筛选范围内未找到.*不等于外部报告不存在/);
      if (scenario.read === "matching" && scenario.external === "confirmed") assert.match(alerts.at(-1), /相同资源标识.*不能替代.*对账完成证明/);
      if (scenario.external === "unknown") assert.match(alerts.at(-1), /外部结果仍未知/);
    }
    await qc.qualityControlStudy("study-001", button);
    assertQcRecoveryGuidance(alerts.at(-1));
    assert.deepEqual(calls.map((call) => call.method), ["POST", "GET"]);
    assert.equal(promptCount, 4);
    assert.equal(qc.imagingQualityControlRecovery.get("study-001"), recovery);
    assert.equal(qc.imagingQualityControlActionState.get("study-001"), "reconciliation-required");
    assert.equal(button.disabled, true);
  });
});

test("imaging browser recovery view performs one strict GET and keeps the QC write locked", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  const alerts = [];
  const prompts = ["质控通过", "90", "91", "影像与报告质控通过"];
  const calls = [];
  const responses = [{
    ok: false,
    status: 503,
    async json() {
      return {
        message: "FHIR 已确认但本地保存失败",
        retryable: false,
        reconciliationRequired: true,
        reconciliation: {
          studyId: "study-001",
          externalOutcome: "confirmed",
          localOutcome: "not-committed",
          resourceType: "DiagnosticReport",
          resourceId: "diagnostic-report-001"
        }
      };
    }
  }, {
    ok: true,
    status: 200,
    async json() {
      return {
        summary: { studies: 1 },
        studies: [{
          id: "study-001",
          qcStatus: "待质控",
          emrSyncStatus: "待写入",
          fhirReportSyncStatus: "pending"
        }],
        qualityReviews: []
      };
    }
  }];
  const table = { innerHTML: "" };
  const document = {
    addEventListener() {},
    querySelector(selector) { return selector === "#study-table" ? table : null; }
  };
  const window = {
    alert(message) { alerts.push(message); },
    HealthCityAuth: {
      getUser() { return { role: "institution" }; },
      async authFetch(url, options = {}) {
        calls.push({ method: options.method || "GET", url });
        return responses.shift();
      }
    },
    HealthStructuredDialog: {
      async prompt() { return prompts.shift(); }
    }
  };
  const context = { console, document, fetch: window.HealthCityAuth.authFetch, location: { origin: "http://platform.test", protocol: "http:" }, URL, URLSearchParams, window };
  vm.runInNewContext(`${source}\n;globalThis.__imagingRecoveryTest = { imagingQualityControlActionState, imagingQualityControlRecovery, imagingState, inspectQualityControlStatus, qualityControlStudy, renderStudyTable };`, context);
  context.__imagingRecoveryTest.imagingState.payload = { studies: [{ id: "study-001", qcStatus: "待质控" }] };
  const button = {
    dataset: {},
    disabled: false,
    textContent: "质控回写",
    removeAttribute() {},
    setAttribute() {}
  };

  await context.__imagingRecoveryTest.qualityControlStudy("study-001", button);
  assertQcRecoveryGuidance(alerts.at(-1));
  await context.__imagingRecoveryTest.inspectQualityControlStatus("study-001");

  assert.deepEqual(calls.map((item) => item.method), ["POST", "GET"]);
  assert.equal(context.__imagingRecoveryTest.imagingQualityControlActionState.get("study-001"), "reconciliation-required");
  assert.equal(context.__imagingRecoveryTest.imagingState.payload.studies[0].qcStatus, "待质控");
  assert.match(alerts.at(-1), /diagnostic-report-001/);
  assert.match(alerts.at(-1), /本地当前状态：待质控/);
  assert.match(alerts.at(-1), /仍保持锁定/);
  assertQcRecoveryGuidance(alerts.at(-1));
  assert.match(table.innerHTML, /data-qc-status="study-001"/);
});

test("imaging browser recovery view never replaces a failed strict read with fallback data", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  const alerts = [];
  let requestCount = 0;
  const document = { addEventListener() {}, querySelector() { return null; } };
  const window = {
    alert(message) { alerts.push(message); },
    HealthCityAuth: {
      getUser() { return { role: "institution" }; },
      async authFetch() {
        requestCount += 1;
        return { ok: false, status: 503, async json() { return { message: "dashboard unavailable" }; } };
      }
    }
  };
  const context = { console, document, fetch: window.HealthCityAuth.authFetch, location: { origin: "http://platform.test", protocol: "http:" }, URL, URLSearchParams, window };
  vm.runInNewContext(`${source}\n;globalThis.__imagingRecoveryFailureTest = { imagingQualityControlActionState, imagingQualityControlRecovery, imagingState, inspectQualityControlStatus };`, context);
  const originalPayload = { studies: [{ id: "study-001", qcStatus: "待质控" }] };
  context.__imagingRecoveryFailureTest.imagingState.payload = originalPayload;
  context.__imagingRecoveryFailureTest.imagingQualityControlActionState.set("study-001", "reconciliation-required");
  context.__imagingRecoveryFailureTest.imagingQualityControlRecovery.set("study-001", {
    studyId: "study-001",
    externalOutcome: "unknown",
    localOutcome: "not-committed"
  });

  await context.__imagingRecoveryFailureTest.inspectQualityControlStatus("study-001");

  assert.equal(requestCount, 1);
  assert.equal(context.__imagingRecoveryFailureTest.imagingState.payload, originalPayload);
  assert.equal(context.__imagingRecoveryFailureTest.imagingQualityControlActionState.get("study-001"), "reconciliation-required");
  assert.match(alerts[0], /未能读取当前本地状态/);
  assertQcRecoveryGuidance(alerts[0]);
  assert.doesNotMatch(alerts[0], /已完成|已确认并保存/);
});

function createImagingDashboardReadHarness({ protocol = "http:" } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");
  const requests = [];
  const alerts = [];
  const table = { innerHTML: "" };
  const mobileViewer = { innerHTML: "" };
  const phoneTitle = { textContent: "" };
  const phoneSubtitle = { textContent: "" };
  let fallbackCalls = 0;
  const window = {
    alert(message) { alerts.push(message); },
    HealthCityAuth: {
      getUser() { return { role: "commission" }; },
      authFetch(url) {
        return new Promise((resolve, reject) => requests.push({ url, resolve, reject }));
      }
    }
  };
  const context = {
    console,
    window,
    URL,
    URLSearchParams,
    location: { origin: "http://platform.test", protocol },
    document: {
      addEventListener() {},
      querySelector(selector) {
        return {
          "#study-table": table,
          "#mobile-viewer": mobileViewer,
          "#phone-title": phoneTitle,
          "#phone-subtitle": phoneSubtitle
        }[selector] || null;
      }
    },
    fetch() { throw new Error("unexpected unauthenticated fetch"); },
    fallbackProbe() {
      fallbackCalls += 1;
      return { studies: [{ id: "demo-fallback", modality: "DR", bodyPart: "胸部", institutionName: "示范医院", studyDate: "2026-09-10" }] };
    }
  };
  vm.runInNewContext(`${source}\n;buildFallbackImagingCloud = fallbackProbe; globalThis.dashboardReadTest = { imagingState, imagingQualityControlActionState, imagingQualityControlRecovery, loadImagingCloud, inspectQualityControlStatus, renderImagingCloud };`, context);
  return {
    alerts,
    context,
    requests,
    table,
    mobileViewer,
    phoneTitle,
    phoneSubtitle,
    getFallbackCalls: () => fallbackCalls,
    state: context.dashboardReadTest.imagingState,
    qcState: context.dashboardReadTest.imagingQualityControlActionState,
    qcRecovery: context.dashboardReadTest.imagingQualityControlRecovery,
    load: context.dashboardReadTest.loadImagingCloud,
    inspect: context.dashboardReadTest.inspectQualityControlStatus,
    render: context.dashboardReadTest.renderImagingCloud
  };
}

function imagingDashboardResponse(body, { ok = true, status = ok ? 200 : 503 } = {}) {
  return { ok, status, async json() { return body; } };
}

test("imaging dashboard commits only the latest filtered GET snapshot", async () => {
  const harness = createImagingDashboardReadHarness();
  harness.state.selectedResidentId = "resident-A";
  const loadA = harness.load();
  harness.state.selectedResidentId = "resident-B";
  const loadB = harness.load();

  assert.deepEqual(harness.requests.map((item) => item.url), [
    "http://platform.test/api/imaging-cloud?residentId=resident-A",
    "http://platform.test/api/imaging-cloud?residentId=resident-B"
  ]);
  harness.requests[1].resolve(imagingDashboardResponse({ studies: [{ id: "study-B", residentId: "resident-B" }] }));
  await loadB;
  harness.requests[0].resolve(imagingDashboardResponse({ studies: [{ id: "study-A", residentId: "resident-A" }] }));
  await loadA;

  assert.equal(harness.state.selectedResidentId, "resident-B");
  assert.equal(harness.state.payload.studies[0].id, "study-B");
  assert.equal(harness.state.dashboardStatus, "ready");
  assert.equal(harness.getFallbackCalls(), 0);
});

test("imaging dashboard invalidates an old snapshot while a new filter is pending", async () => {
  const harness = createImagingDashboardReadHarness();
  harness.state.payload = { studies: [{ id: "study-A", residentId: "resident-A" }] };
  harness.state.dashboardStatus = "ready";
  harness.table.innerHTML = '<button data-share-study="study-A">旧操作</button>';
  harness.phoneTitle.textContent = "CT 胸部";
  harness.phoneSubtitle.textContent = "旧机构 · 2026-09-09";
  harness.state.selectedResidentId = "resident-B";

  const loadB = harness.load();

  assert.equal(harness.state.payload, null);
  assert.equal(harness.state.dashboardStatus, "loading");
  assert.match(harness.table.innerHTML, /正在加载影像检查/);
  assert.doesNotMatch(harness.table.innerHTML, /data-(?:share|qc|view|open|start|decide|appeal)/);
  assert.equal(harness.phoneTitle.textContent, "影像调阅");
  assert.equal(harness.phoneSubtitle.textContent, "正在加载影像检查");
  assert.equal(harness.getFallbackCalls(), 0);

  harness.requests[0].resolve(imagingDashboardResponse({ studies: [{ id: "study-B", residentId: "resident-B", modality: "MR", bodyPart: "头颅", institutionName: "示范医院", studyDate: "2026-09-10" }] }));
  await loadB;
  assert.equal(harness.state.payload.studies[0].id, "study-B");
  assert.equal(harness.phoneTitle.textContent, "MR 头颅");
  assert.equal(harness.phoneSubtitle.textContent, "示范医院 · 2026-09-10");
});

test("imaging dashboard fails closed online and keeps file preview fallback", async (t) => {
  const onlineFailures = [
    {
      name: "HTTP failure",
      settle(request) { request.resolve(imagingDashboardResponse({ message: "unavailable" }, { ok: false, status: 503 })); }
    },
    {
      name: "network failure",
      settle(request) { request.reject(new Error("offline")); }
    },
    {
      name: "malformed JSON",
      settle(request) { request.resolve({ ok: true, status: 200, async json() { throw new SyntaxError("private marker"); } }); }
    },
    {
      name: "missing study list",
      settle(request) { request.resolve(imagingDashboardResponse({ summary: {} })); }
    }
  ];
  for (const scenario of onlineFailures) await t.test(scenario.name, async () => {
    const harness = createImagingDashboardReadHarness();
    harness.state.payload = { studies: [{ id: "old-study" }] };
    harness.state.dashboardStatus = "ready";
    harness.state.selectedInstitutionCode = "institution-B";
    harness.phoneTitle.textContent = "CT 胸部";
    harness.phoneSubtitle.textContent = "旧机构 · 2026-09-09";
    const loading = harness.load();
    scenario.settle(harness.requests[0]);
    await loading;
    assert.equal(harness.state.payload, null);
    assert.equal(harness.state.dashboardStatus, "error");
    assert.match(harness.table.innerHTML, /影像检查暂时不可用/);
    assert.doesNotMatch(harness.table.innerHTML, /data-(?:share|qc|view|open|start|decide|appeal)/);
    assert.equal(harness.phoneTitle.textContent, "影像调阅");
    assert.equal(harness.phoneSubtitle.textContent, "影像检查暂时不可用");
    assert.equal(harness.getFallbackCalls(), 0);
  });

  const emptySuccess = createImagingDashboardReadHarness();
  emptySuccess.state.payload = { studies: [{ id: "old-study" }] };
  emptySuccess.state.dashboardStatus = "ready";
  emptySuccess.phoneTitle.textContent = "CT 胸部";
  emptySuccess.phoneSubtitle.textContent = "旧机构 · 2026-09-09";
  const emptyLoading = emptySuccess.load();
  emptySuccess.requests[0].resolve(imagingDashboardResponse({ studies: [] }));
  await emptyLoading;
  assert.equal(emptySuccess.state.dashboardStatus, "ready");
  assert.equal(emptySuccess.phoneTitle.textContent, "影像调阅");
  assert.equal(emptySuccess.phoneSubtitle.textContent, "暂无可调阅影像");

  const filePreview = createImagingDashboardReadHarness({ protocol: "file:" });
  await filePreview.load();
  filePreview.render();
  assert.equal(filePreview.requests.length, 0);
  assert.equal(filePreview.state.payload.studies[0].id, "demo-fallback");
  assert.equal(filePreview.state.dashboardStatus, "ready");
  assert.equal(filePreview.getFallbackCalls(), 1);
  assert.equal(filePreview.phoneTitle.textContent, "DR 胸部");
  assert.equal(filePreview.phoneSubtitle.textContent, "示范医院 · 2026-09-10");
});

test("stale imaging GET failures and QC status reads cannot replace the current filter", async (t) => {
  const staleFailures = [
    {
      name: "HTTP failure",
      settle(request) { request.resolve(imagingDashboardResponse({ message: "forbidden" }, { ok: false, status: 403 })); }
    },
    {
      name: "network failure",
      settle(request) { request.reject(new Error("offline")); }
    },
    {
      name: "malformed JSON",
      settle(request) { request.resolve({ ok: true, status: 200, async json() { throw new SyntaxError("private marker"); } }); }
    }
  ];
  for (const scenario of staleFailures) await t.test(scenario.name, async () => {
    const staleFailure = createImagingDashboardReadHarness();
    staleFailure.state.selectedResidentId = "resident-A";
    staleFailure.state.selectedInstitutionCode = "institution-A";
    const loadA = staleFailure.load();
    staleFailure.state.selectedResidentId = "resident-B";
    staleFailure.state.selectedInstitutionCode = "institution-B";
    const loadB = staleFailure.load();
    assert.equal(staleFailure.requests[1].url, "http://platform.test/api/imaging-cloud?residentId=resident-B&institutionCode=institution-B");
    staleFailure.requests[1].resolve(imagingDashboardResponse({ studies: [{ id: "study-B" }] }));
    await loadB;
    scenario.settle(staleFailure.requests[0]);
    await loadA;
    assert.equal(staleFailure.state.payload.studies[0].id, "study-B");
    assert.equal(staleFailure.state.dashboardStatus, "ready");
    assert.equal(staleFailure.getFallbackCalls(), 0);
  });

  const qcRace = createImagingDashboardReadHarness();
  qcRace.state.payload = { studies: [{ id: "study-A" }] };
  qcRace.state.dashboardStatus = "ready";
  qcRace.state.selectedResidentId = "resident-A";
  qcRace.qcState.set("study-A", "reconciliation-required");
  qcRace.qcRecovery.set("study-A", { studyId: "study-A", externalOutcome: "unknown", localOutcome: "not-committed" });
  const inspectA = qcRace.inspect("study-A");
  qcRace.state.selectedResidentId = "resident-B";
  const currentB = qcRace.load();
  qcRace.requests[1].resolve(imagingDashboardResponse({ studies: [{ id: "study-B" }], qualityReviews: [] }));
  await currentB;
  qcRace.requests[0].resolve(imagingDashboardResponse({ studies: [{ id: "study-A" }], qualityReviews: [] }));
  await inspectA;

  assert.equal(qcRace.state.payload.studies[0].id, "study-B");
  assert.equal(qcRace.alerts.length, 0);
  assert.equal(qcRace.qcState.get("study-A"), "reconciliation-required");
  assert.deepEqual(qcRace.qcRecovery.get("study-A"), { studyId: "study-A", externalOutcome: "unknown", localOutcome: "not-committed" });
});

test("imaging browser flow locks an uncertain QC result and releases an explicitly retryable rejection", async () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "imaging-cloud.js"), "utf8");

  function createHarness(response) {
    const alerts = [];
    const prompts = ["质控通过", "90", "91", "影像与报告质控通过"];
    const table = { innerHTML: "" };
    let requestCount = 0;
    const document = {
      addEventListener() {},
      querySelector(selector) { return selector === "#study-table" ? table : null; }
    };
    const window = {
      alert(message) { alerts.push(message); },
      HealthCityAuth: {
        getUser() { return { role: "institution" }; },
        async authFetch() {
          requestCount += 1;
          return response;
        }
      },
      HealthStructuredDialog: {
        async prompt() { return prompts.shift(); }
      }
    };
    const context = { console, document, fetch: window.HealthCityAuth.authFetch, location: { origin: "http://platform.test", protocol: "http:" }, URL, URLSearchParams, window };
    vm.runInNewContext(`${source}\n;globalThis.__imagingTest = { imagingQualityControlActionState, imagingQualityControlRecovery, imagingState, qualityControlStudy, renderStudyTable };`, context);
    const attributes = new Map();
    const button = {
      dataset: {},
      disabled: false,
      textContent: "质控回写",
      removeAttribute(name) { attributes.delete(name); },
      setAttribute(name, value) { attributes.set(name, value); }
    };
    return { alerts, attributes, button, context, getRequestCount: () => requestCount, table };
  }

  const uncertain = createHarness({
    ok: false,
    status: 503,
    async json() { return { message: "FHIR 已确认但本地保存失败", retryable: false, reconciliationRequired: true }; }
  });
  uncertain.context.__imagingTest.imagingState.payload = { studies: [{ id: "study-001", qcStatus: "待质控" }] };
  await uncertain.context.__imagingTest.qualityControlStudy("study-001", uncertain.button);
  assert.equal(uncertain.getRequestCount(), 1);
  assert.equal(uncertain.context.__imagingTest.imagingQualityControlActionState.get("study-001"), "reconciliation-required");
  assert.equal(uncertain.button.disabled, true);
  assert.equal(uncertain.button.textContent, "需对账");
  assertQcRecoveryGuidance(uncertain.alerts[0]);
  await uncertain.context.__imagingTest.qualityControlStudy("study-001", uncertain.button);
  assert.equal(uncertain.getRequestCount(), 1);
  assert.match(uncertain.alerts[1], /已阻止重复提交/);
  assertQcRecoveryGuidance(uncertain.alerts[1]);
  assert.match(uncertain.attributes.get("title"), /刷新页面不能证明对账完成/);
  assert.match(uncertain.table.innerHTML, /刷新页面不能证明对账完成/);
  assert.doesNotMatch(uncertain.table.innerHTML, /对账后重新加载页面/);
  assert.match(uncertain.table.innerHTML, /data-qc-study="study-001" disabled aria-disabled="true"/);
  assert.match(uncertain.table.innerHTML, />需对账<\/button>/);

  const malformedConfirmed = createHarness({
    ok: false,
    status: 503,
    async json() {
      return {
        message: "malformed receipt",
        retryable: false,
        reconciliationRequired: true,
        reconciliation: {
          studyId: "study-003",
          externalOutcome: "confirmed",
          localOutcome: "not-committed",
          resourceType: "DiagnosticReport",
          resourceId: 123
        }
      };
    }
  });
  malformedConfirmed.context.__imagingTest.imagingState.payload = { studies: [{ id: "study-003", qcStatus: "待质控" }] };
  await malformedConfirmed.context.__imagingTest.qualityControlStudy("study-003", malformedConfirmed.button);
  assert.equal(malformedConfirmed.context.__imagingTest.imagingQualityControlRecovery.get("study-003").externalOutcome, "unknown");
  assert.equal(malformedConfirmed.context.__imagingTest.imagingQualityControlRecovery.get("study-003").resourceId, undefined);

  const retryable = createHarness({
    ok: false,
    status: 502,
    async json() { return { message: "FHIR 明确拒绝", retryable: true, reconciliationRequired: false }; }
  });
  retryable.context.__imagingTest.imagingState.payload = { studies: [{ id: "study-002", qcStatus: "待质控" }] };
  await retryable.context.__imagingTest.qualityControlStudy("study-002", retryable.button);
  assert.equal(retryable.getRequestCount(), 1);
  assert.equal(retryable.context.__imagingTest.imagingQualityControlActionState.has("study-002"), false);
  assert.equal(retryable.button.disabled, false);
  assert.equal(retryable.button.textContent, "质控回写");
  assert.match(retryable.alerts[0], /问题恢复后重试/);
  assert.match(retryable.table.innerHTML, /data-qc-study="study-002">质控回写<\/button>/);
  assert.doesNotMatch(retryable.table.innerHTML, /data-qc-study="study-002" disabled/);
});
