"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const CitizenRecordsV1 = require("../citizen-records-v1");
const CitizenRecordsV2 = require("../citizen-records-v2");
const { createResidentAuthorizationDecisionAdapter } = require("../src/platform/governance/resident-authorization-decision-adapter");
const {
  COMMAND_ID,
  createRegionalSharingAccessCommand,
  projectRegionalSharingAccessResponse,
  projectRegionalSharingReadResponse,
  sha256
} = require("../src/platform/governance/regional-sharing-access-command");

const NOW = "2026-08-21T04:00:00.000Z";
const USER = Object.freeze({
  id: "user-institution-1",
  username: "hospital",
  name: "不应进入审计的姓名",
  role: "institution",
  orgCode: "MR1",
  orgName: "不应作为授权依据的机构名称",
  regionCode: "210200"
});

function authorization(overrides = {}) {
  return {
    id: "authorization-1",
    residentId: "resident-1",
    category: "authorizations",
    date: "2027-08-21",
    name: "区域中心医院",
    result: "active authorization",
    source: "resident",
    status: "active",
    meta: {
      status: "active",
      granteeId: "MR1",
      purpose: "care.continuity",
      scopes: ["labs"],
      expiresAt: "2027-08-21",
      version: 2
    },
    ...overrides
  };
}

function state(overrides = {}) {
  return {
    residents: [{ id: "resident-1", idCard: "sensitive-card", phone: "sensitive-phone" }],
    personalRecords: [authorization()],
    regionalSharingPackages: [{
      id: "package-1",
      residentId: "resident-1",
      sourceOrgCode: "MR2",
      targetOrgCodes: ["MR1"],
      regionCode: "210200",
      requiredAuthorizationScopes: ["labs"],
      status: "ready",
      qualityStatus: "passed",
      consentStatus: "revoked",
      version: 3
    }],
    regionalSharingAccessReviews: [{ id: "historical-receipt", immutable: true }],
    dataAccessLogs: [],
    securityEvents: [],
    ...overrides
  };
}

function dependencies(overrides = {}) {
  let id = 0;
  const authorizationDecision = createResidentAuthorizationDecisionAdapter({
    authorizationState: CitizenRecordsV1.authorizationState,
    buildAuthorizationLifecycle: CitizenRecordsV2.buildAuthorizationLifecycle
  });
  return {
    appendDataAccessLog(data, user, residentId, scope, purpose, result, options = {}) {
      const resident = (data.residents || []).find((item) => item.id === residentId);
      data.dataAccessLogs = [{
        id: `access-${++id}`,
        actor: options.actor || user.name,
        residentId,
        personIndex: Object.hasOwn(options, "personIndex")
          ? options.personIndex
          : resident ? `${resident.idCard}#${resident.phone}` : "",
        scope,
        purpose,
        result
      }, ...(data.dataAccessLogs || [])];
    },
    canAccessResident: () => true,
    createId: () => `id-${++id}`,
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    readAuthorizationDecision: authorizationDecision.decide,
    ...overrides
  };
}

function command(environment = { NODE_ENV: "production" }, dependencyOverrides = {}, optionOverrides = {}) {
  return createRegionalSharingAccessCommand(dependencies(dependencyOverrides), {
    activeRegionCode: "210200",
    atomicRepository: true,
    capabilityEnabled: true,
    environment,
    productionCutoverAuthorized: true,
    storageEngine: "postgresql",
    ...optionOverrides
  });
}

function strictPayload(overrides = {}) {
  return {
    packageId: "package-1",
    authorizationId: "authorization-1",
    authorizationVersion: 2,
    expectedVersion: 3,
    purposeCode: "care.continuity",
    scopes: ["labs"],
    decision: "denied",
    consentStatus: "revoked",
    note: "不应保存的敏感备注",
    ...overrides
  };
}

function request(overrides = {}) {
  return {
    correlationId: "correlation-regional-1",
    idempotencyKey: "regional-command-key-0001",
    now: NOW,
    ...overrides
  };
}

test("strict command makes the allow decision server-side and appends an immutable receipt", () => {
  const source = state();
  const historical = structuredClone(source.regionalSharingAccessReviews[0]);
  const result = command().execute(source, strictPayload(), USER, request());

  assert.equal(result.status, 201);
  assert.equal(result.body.review.decision, "allowed");
  assert.equal(result.body.package.version, 4);
  assert.equal(result.body.legacyCompatibility, false);
  assert.equal(result.body.productionReady, false);
  assert.deepEqual(result.nextData.regionalSharingAccessReviews[1], historical);
  assert.equal(source.regionalSharingPackages[0].version, 3);
  assert.equal(result.body.review.idempotencyKeyHash, sha256("regional-command-key-0001"));
  assert.equal(JSON.stringify(result.body.review).includes("不应保存的敏感备注"), false);
  assert.equal(JSON.stringify(result.nextData.securityEvents).includes("不应进入审计的姓名"), false);
  assert.equal(result.nextData.securityEvents[0].action, COMMAND_ID);
  assert.equal(result.nextData.securityEvents[0].detail, "REGIONAL_SHARING_ACCESS_ALLOWED");
  assert.match(result.nextData.dataAccessLogs[0].purpose, /^purpose:[a-f0-9]{16}$/);
  assert.match(result.nextData.dataAccessLogs[0].personIndex, /^resident:[a-f0-9]{24}$/);
  assert.equal(JSON.stringify(result.nextData.dataAccessLogs).includes("sensitive-card"), false);
  assert.equal(JSON.stringify(result.nextData.dataAccessLogs).includes("sensitive-phone"), false);
});

test("same idempotency key replays exactly once and conflicting reuse is rejected", () => {
  const first = command().execute(state(), strictPayload(), USER, request());
  const replay = command().execute(first.nextData, strictPayload({ expectedVersion: 3 }), USER, request());
  assert.equal(replay.status, 200);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.body.review, first.body.review);
  assert.equal(replay.nextData, undefined);
  assert.equal(first.nextData.regionalSharingAccessReviews.length, 2);

  const conflict = command().execute(first.nextData, strictPayload({ purposeCode: "care.referral" }), USER, request());
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "REGIONAL_SHARING_IDEMPOTENCY_CONFLICT");
});

test("public response projection allowlists compatibility fields and removes resident authorization and digest internals", () => {
  const result = command().execute(state(), strictPayload(), USER, request());
  const projected = projectRegionalSharingAccessResponse(result.body);

  assert.deepEqual(Object.keys(projected.review).sort(), [
    "at",
    "command",
    "decision",
    "id",
    "legacyCompatibility",
    "packageId",
    "packageVersionAfter",
    "packageVersionBefore",
    "productionReady",
    "reasonCode",
    "schemaVersion",
    "status",
    "version"
  ]);
  assert.deepEqual(Object.keys(projected.package).sort(), [
    "id",
    "lastAccessReviewId",
    "lastSharedAt",
    "qualityStatus",
    "status",
    "version"
  ]);
  for (const field of [
    "residentId",
    "personIndex",
    "authorizationId",
    "authorizationVersion",
    "purposeCode",
    "purposeDigest",
    "scopes",
    "idempotencyKeyHash",
    "requestDigest",
    "correlationId",
    "actorRef",
    "actorOrgCode",
    "actorRegionCode",
    "meta",
    "note"
  ]) {
    assert.equal(JSON.stringify(projected).includes(`\"${field}\"`), false, field);
  }
});

test("regional GET review projection removes receipt internals and keeps safe legacy display fields", () => {
  const result = command().execute(state(), strictPayload(), USER, request());
  const projected = projectRegionalSharingReadResponse({
    summary: { accessReviews: 1 },
    packages: [{ id: "package-1" }],
    accessReviews: [result.body.review]
  });
  assert.equal(projected.accessReviews[0].actor, "服务端授权命令");
  assert.equal(projected.accessReviews[0].purpose, "已按结构化授权用途核验");
  for (const field of [
    "residentId", "authorizationId", "authorizationVersion", "purposeCode", "purposeDigest",
    "scopes", "idempotencyKeyHash", "requestDigest", "correlationId", "actorRef",
    "actorOrgCode", "actorRegionCode", "compatibilityBlockers"
  ]) {
    assert.equal(Object.hasOwn(projected.accessReviews[0], field), false, field);
  }
});

test("authorization lifecycle, grantee, purpose, scopes and version are recalculated before inbox replay", () => {
  const first = command().execute(state(), strictPayload(), USER, request());
  const cases = [
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_REVOKED",
      mutate(record) {
        record.status = "revoked";
        record.revokedAt = NOW;
        record.meta.status = "revoked";
        record.meta.revokedAt = NOW;
      },
      status: 403
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_INACTIVE",
      mutate(record) { record.meta.expiresAt = "2026-08-20"; },
      status: 403
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_GRANTEE_DENIED",
      mutate(record) { record.meta.granteeId = "MR9"; },
      status: 403
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_PURPOSE_DENIED",
      mutate(record) { record.meta.purpose = "care.other"; },
      status: 403
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_SCOPE_DENIED",
      mutate(record) { record.meta.scopes = ["imaging-report"]; },
      status: 403
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_VERSION_CONFLICT",
      mutate(record) { record.meta.version = 3; },
      status: 409
    }
  ];

  for (const item of cases) {
    const changed = structuredClone(first.nextData);
    item.mutate(changed.personalRecords[0]);
    const result = command().execute(changed, strictPayload(), USER, request());
    assert.equal(result.status, item.status, item.code);
    assert.equal(result.body.code, item.code);
    assert.notEqual(result.replayed, true);
    assert.equal(result.nextData, undefined);
    assert.equal(changed.regionalSharingAccessReviews.length, 2);
  }
});

test("package and authorization versions provide application-level compare-and-swap", () => {
  const stalePackage = command().execute(state(), strictPayload({ expectedVersion: 2 }), USER, request());
  assert.equal(stalePackage.status, 409);
  assert.equal(stalePackage.body.code, "REGIONAL_SHARING_PACKAGE_VERSION_CONFLICT");

  const staleAuthorization = command().execute(state(), strictPayload({ authorizationVersion: 1 }), USER, request({ idempotencyKey: "regional-command-key-0002" }));
  assert.equal(staleAuthorization.status, 409);
  assert.equal(staleAuthorization.body.code, "REGIONAL_SHARING_AUTHORIZATION_VERSION_CONFLICT");
});

test("a freshly revoked personalRecords authorization is denied immediately and audited", () => {
  const revokedState = state({
    personalRecords: [authorization({ status: "revoked", revokedAt: NOW, meta: { ...authorization().meta, status: "revoked", revokedAt: NOW } })]
  });
  const result = command().execute(revokedState, strictPayload(), USER, request({ idempotencyKey: "regional-command-key-0003" }));

  assert.equal(result.status, 403);
  assert.equal(result.body.code, "REGIONAL_SHARING_AUTHORIZATION_REVOKED");
  assert.equal(result.body.review.decision, "denied");
  assert.equal(result.nextData.regionalSharingPackages[0].version, 3);
  assert.equal(result.nextData.regionalSharingAccessReviews[0].reasonCode, "REGIONAL_SHARING_AUTHORIZATION_REVOKED");
  assert.equal(result.nextData.securityEvents[0].result, "denied");
});

test("explicit organization, region, purpose and scope conflicts never enter compatibility mode", () => {
  const orgDenied = command({ NODE_ENV: "test" }).execute(state(), strictPayload(), { ...USER, orgCode: "MR9" }, request());
  assert.equal(orgDenied.body.code, "REGIONAL_SHARING_ORGANIZATION_SCOPE_DENIED");

  const regionDenied = command({ NODE_ENV: "test" }).execute(state(), strictPayload(), { ...USER, regionCode: "990001" }, request());
  assert.equal(regionDenied.body.code, "REGIONAL_SHARING_ACTOR_REGION_DENIED");

  const purposeDenied = command({ NODE_ENV: "test" }).execute(
    state({ personalRecords: [authorization({ meta: { ...authorization().meta, purpose: "care.other" } })] }),
    strictPayload(), USER, request()
  );
  assert.equal(purposeDenied.body.code, "REGIONAL_SHARING_AUTHORIZATION_PURPOSE_DENIED");

  const scopeDenied = command({ NODE_ENV: "test" }).execute(
    state({ personalRecords: [authorization({ meta: { ...authorization().meta, scopes: ["imaging-report"] } })] }),
    strictPayload(), USER, request()
  );
  assert.equal(scopeDenied.body.code, "REGIONAL_SHARING_AUTHORIZATION_SCOPE_DENIED");
});

test("production fails closed when command evidence or capability is absent", () => {
  const missingEvidence = command().execute(state(), { packageId: "package-1" }, USER, request());
  assert.equal(missingEvidence.status, 400);
  assert.equal(missingEvidence.body.productionReady, false);

  const disabled = createRegionalSharingAccessCommand(dependencies(), {
    activeRegionCode: "210200",
    capabilityEnabled: false,
    environment: { NODE_ENV: "production" }
  }).execute(state(), strictPayload(), USER, request());
  assert.equal(disabled.status, 403);
  assert.equal(disabled.body.code, "REGIONAL_SHARING_CAPABILITY_DISABLED");

  const genericRepository = createRegionalSharingAccessCommand(dependencies(), {
    activeRegionCode: "210200",
    capabilityEnabled: true,
    environment: { NODE_ENV: "production" },
    productionCutoverAuthorized: false,
    storageEngine: "json"
  }).execute(state(), strictPayload(), USER, request());
  assert.equal(genericRepository.status, 503);
  assert.equal(genericRepository.body.code, "REGIONAL_SHARING_PRODUCTION_REPOSITORY_UNAVAILABLE");

  const inferredScopes = command().execute(state({
    regionalSharingPackages: [{
      ...state().regionalSharingPackages[0],
      requiredAuthorizationScopes: undefined
    }]
  }), strictPayload(), USER, request({ idempotencyKey: "regional-command-key-0004" }));
  assert.equal(inferredScopes.status, 409);
  assert.equal(inferredScopes.body.code, "REGIONAL_SHARING_PACKAGE_SCOPES_REQUIRED");

  const invalidRegion = command(
    { NODE_ENV: "production" },
    {},
    { activeRegionCode: "template" }
  ).execute(state({
    regionalSharingPackages: [{ ...state().regionalSharingPackages[0], regionCode: "template" }]
  }), strictPayload(), { ...USER, regionCode: "template" }, request({ idempotencyKey: "regional-command-key-0005" }));
  assert.equal(invalidRegion.status, 400);
  assert.equal(invalidRegion.body.code, "REGIONAL_SHARING_REGION_EVIDENCE_REQUIRED");
});

test("external command fields reject overlength input instead of truncating before comparison or hashing", () => {
  const cases = [
    {
      code: "REGIONAL_SHARING_PACKAGE_ID_INVALID",
      payload: strictPayload({ packageId: "p".repeat(161) }),
      request: request()
    },
    {
      code: "REGIONAL_SHARING_AUTHORIZATION_ID_INVALID",
      payload: strictPayload({ authorizationId: "a".repeat(201) }),
      request: request()
    },
    {
      code: "REGIONAL_SHARING_PURPOSE_TOO_LONG",
      payload: strictPayload({ purposeCode: "p".repeat(301) }),
      request: request()
    },
    {
      code: "REGIONAL_SHARING_SCOPES_INVALID",
      payload: strictPayload({ scopes: ["s".repeat(101)] }),
      request: request()
    },
    {
      code: "REGIONAL_SHARING_IDEMPOTENCY_KEY_INVALID",
      payload: strictPayload(),
      request: request({ idempotencyKey: "i".repeat(201) })
    },
    {
      code: "REGIONAL_SHARING_CORRELATION_ID_INVALID",
      payload: strictPayload(),
      request: request({ correlationId: "c".repeat(201) })
    }
  ];
  for (const item of cases) {
    const result = command().execute(state(), item.payload, USER, item.request);
    assert.equal(result.status, 400, item.code);
    assert.equal(result.body.code, item.code);
  }
});

test("persisted package and authorization evidence rejects truncated-prefix collisions and unknown status", () => {
  const storedPackagePrefix = "p".repeat(160);
  const overlengthPackage = state({
    regionalSharingPackages: [{ ...state().regionalSharingPackages[0], id: `${storedPackagePrefix}x` }]
  });
  const packagePrefixResult = command().execute(
    overlengthPackage,
    strictPayload({ packageId: storedPackagePrefix }),
    USER,
    request()
  );
  assert.equal(packagePrefixResult.status, 404);

  const overlengthOrg = command().execute(state({
    regionalSharingPackages: [{ ...state().regionalSharingPackages[0], sourceOrgCode: "o".repeat(161) }]
  }), strictPayload(), USER, request());
  assert.equal(overlengthOrg.status, 409);
  assert.equal(overlengthOrg.body.code, "REGIONAL_SHARING_PACKAGE_EVIDENCE_INVALID");

  const storedAuthorizationPrefix = "a".repeat(200);
  const overlengthAuthorization = command().execute(state({
    personalRecords: [authorization({ id: `${storedAuthorizationPrefix}x` })]
  }), strictPayload({ authorizationId: storedAuthorizationPrefix }), USER, request());
  assert.equal(overlengthAuthorization.status, 403);
  assert.equal(overlengthAuthorization.body.code, "REGIONAL_SHARING_AUTHORIZATION_NOT_FOUND");

  const overlengthPurpose = command().execute(state({
    personalRecords: [authorization({ meta: { ...authorization().meta, purpose: "p".repeat(301) } })]
  }), strictPayload(), USER, request());
  assert.equal(overlengthPurpose.status, 403);
  assert.equal(overlengthPurpose.body.code, "REGIONAL_SHARING_AUTHORIZATION_EVIDENCE_INVALID");

  const unknownStatus = command().execute(state({
    regionalSharingPackages: [{ ...state().regionalSharingPackages[0], status: "unexpected-ready-like-state" }]
  }), strictPayload(), USER, request());
  assert.equal(unknownStatus.status, 409);
  assert.equal(unknownStatus.body.code, "REGIONAL_SHARING_PACKAGE_NOT_SHAREABLE");
});

test("non-production commission keeps its legacy city-wide server scope without trusting client approval", () => {
  const result = command({ NODE_ENV: "test" }).execute(
    state(),
    strictPayload({ decision: "approved" }),
    { ...USER, role: "commission", orgCode: "CITY-COMMISSION" },
    request({ idempotencyKey: "regional-commission-key-0001" })
  );
  assert.equal(result.status, 201);
  assert.equal(result.body.review.decision, "allowed");
  assert.equal(result.body.compatibilityBlockers.includes("COMMISSION_LEGACY_SCOPE"), true);
});

test("non-production legacy input is explicitly downgraded without trusting client decision", () => {
  const legacyState = state({
    personalRecords: [{
      id: "legacy-authorization",
      residentId: "resident-1",
      category: "authorizations",
      date: "2026-01-01",
      name: "历史授权",
      result: "历史描述",
      source: "居民授权"
    }],
    regionalSharingPackages: [{
      id: "package-1",
      residentId: "resident-1",
      sourceOrgCode: "MR2",
      targetOrgCodes: ["MR1"],
      sharedCollections: ["personalRecords"],
      status: "ready",
      qualityStatus: "passed"
    }]
  });
  const result = command({ NODE_ENV: "test" }).execute(legacyState, {
    packageId: "package-1",
    decision: "denied",
    purpose: "历史中文用途"
  }, { ...USER, regionCode: "" }, request());

  assert.equal(result.status, 201);
  assert.equal(result.body.review.decision, "allowed");
  assert.equal(result.body.legacyCompatibility, true);
  assert.equal(result.body.productionReady, false);
  assert.ok(result.body.compatibilityBlockers.includes("AUTHORIZATION_LIFECYCLE_INCOMPLETE"));
  assert.ok(result.body.compatibilityBlockers.includes("PACKAGE_VERSION_MISSING"));
  assert.match(result.body.review.purposeCode, /^legacy-purpose\.[a-f0-9]{16}$/);
});

test("audit failure aborts the state transition", () => {
  const source = state();
  const failing = command({ NODE_ENV: "production" }, {
    prependAuditTrailEntry: () => { throw new Error("audit unavailable"); }
  });
  assert.throws(() => failing.execute(source, strictPayload(), USER, request()), /audit unavailable/);
  assert.equal(source.regionalSharingPackages[0].version, 3);
  assert.equal(source.regionalSharingAccessReviews.length, 1);
});
