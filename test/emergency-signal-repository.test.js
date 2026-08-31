"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  COLLECTION,
  DOMAIN,
  EVENT_TYPE,
  INBOX_COLLECTION,
  OUTBOX_COLLECTION,
  safePatch,
  updateEmergencySignal
} = require("../src/http/routes/t06-emergency-signal-write");
const emergencySignalRoute = require("../src/http/routes/clinical-specialties/emergency-signals");

function runtimeState() {
  return {
    emergencySignals: [{
      id: "signal-1",
      residentId: "resident-1",
      sourceInstitutionCode: "MR3",
      sourceInstitution: "青泥洼桥社区卫生服务中心",
      targetInstitution: "regional-sharing-center",
      region: "中山区",
      level: "high",
      status: "pending_acknowledgement",
      action: "notify physician"
    }],
    authOrganizations: [
      { orgCode: "ORG-DIST-ZS", name: "中山区健康城市平台", orgType: "district", parentCode: "ORG-CITY-DL", dataScope: "本区市县" },
      { orgCode: "ORG-CONSORTIUM-ZS", name: "中山区县域医共体", orgType: "county_consortium", parentCode: "ORG-DIST-ZS", dataScope: "医共体成员机构" },
      { orgCode: "MR3", name: "青泥洼桥社区卫生服务中心", parentCode: "ORG-DIST-ZS", dataScope: "本机构" },
      { orgCode: "MR1", name: "大连市中心医院", parentCode: "ORG-HEALTH-DL", dataScope: "本机构" },
      { orgCode: "ORG-HEALTH-DL", name: "大连市卫生健康委", parentCode: "ORG-CITY-DL", dataScope: "全市医疗卫生" }
    ],
    authUsers: [
      { username: "county-duty", role: "county", orgCode: "ORG-CONSORTIUM-ZS" },
      { username: "community", role: "institution", orgCode: "MR3" }
    ],
    emergencyAuditEvents: [],
    securityEvents: [],
    storageMeta: { collectionVersions: { emergencySignals: 7 } }
  };
}

const COUNTY_USER = Object.freeze({
  username: "county-duty",
  name: "County Duty",
  role: "county",
  orgCode: "ORG-CONSORTIUM-ZS",
  orgName: "中山区县域医共体",
  dataScope: "医共体成员机构"
});

function rowMatchesOrganizationScope(_state, user, signal) {
  return [
    signal.orgCode,
    signal.institutionCode,
    signal.sourceInstitutionCode,
    signal.sourceOrgCode,
    signal.targetInstitutionCode,
    signal.targetOrgCode
  ].includes(user.orgCode)
    || [signal.sourceInstitution, signal.targetInstitution].includes(user.orgName);
}

test("emergency signal update commits owned aggregate and versioned event in one unit of work", async () => {
  let state = runtimeState();
  let writes = 0;
  let writeOptions = null;
  const result = await updateEmergencySignal({
    id: "signal-1",
    payload: {
      expectedVersion: 7,
      id: "tampered-id",
      residentId: "tampered-resident",
      aggregateVersion: 999,
      status: "acknowledged",
      action: "physician notified"
    },
    user: COUNTY_USER,
    correlationId: "correlation-emergency-001",
    causationId: "command-emergency-001",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data, options) {
      writes += 1;
      state = structuredClone(data);
      writeOptions = structuredClone(options);
    }
  });

  assert.equal(result.status, 200);
  assert.equal(writes, 1);
  assert.equal(result.body.id, "signal-1");
  assert.equal(result.body.residentId, "resident-1");
  assert.equal(result.body.status, "acknowledged");
  assert.equal(result.body.aggregateVersion, 1);
  assert.equal(result.event.type, EVENT_TYPE);
  assert.equal(result.event.domain, DOMAIN);
  assert.equal(result.event.correlationId, "correlation-emergency-001");
  assert.equal(result.event.causationId, "command-emergency-001");
  assert.deepEqual(result.event.payload, {
    signalId: "signal-1",
    previousStatus: "pending_acknowledgement",
    status: "acknowledged",
    action: "physician notified",
    level: "high",
    ownerRole: "county"
  });

  assert.equal(state[COLLECTION][0].aggregateVersion, 1);
  assert.equal(state.storageMeta.collectionVersions.emergencySignals, 7);
  assert.equal(state[OUTBOX_COLLECTION][0].id, result.event.id);
  assert.equal(state[OUTBOX_COLLECTION][0].outboxStatus, "pending");
  assert.equal(state[OUTBOX_COLLECTION][0].owner, DOMAIN);
  assert.equal(state[OUTBOX_COLLECTION][0].relaySequence, 1);
  assert.equal(state[OUTBOX_COLLECTION][0].delivery.schema, "emergency-signal-delivery.v1");
  assert.equal(state[OUTBOX_COLLECTION][0].delivery.status, "pending");
  assert.equal(state[OUTBOX_COLLECTION][0].relaySequence, 1);
  assert.equal(state[OUTBOX_COLLECTION][0].delivery.productionReady, false);
  assert.equal(state[INBOX_COLLECTION].length, 1);
  assert.equal(state[INBOX_COLLECTION][0].commandId, "command-emergency-001");
  assert.equal(state[INBOX_COLLECTION][0].eventId, result.event.id);
  assert.equal(state[INBOX_COLLECTION][0].status, "completed");
  assert.equal(state[INBOX_COLLECTION][0].productionEvidence, false);
  assert.equal(state.securityEvents[0].ownershipContract.owner, DOMAIN);
  assert.equal(state.securityEvents[0].ownershipContract.unitOfWork, true);
  assert.equal(state.securityEvents[0].domainEvent.type, EVENT_TYPE);
  assert.deepEqual(writeOptions, {
    event: EVENT_TYPE,
    ownershipContract: {
      collection: COLLECTION,
      owner: DOMAIN,
      repository: "DomainRepository",
      unitOfWork: true
    }
  });
});

test("emergency signal outbox retains existing delivery evidence without a count-based eviction", async () => {
  const existingEvents = Array.from({ length: 1005 }, (_, index) => ({
    id: `existing-event-${index}`,
    outboxStatus: "published"
  }));
  let state = {
    ...runtimeState(),
    emergencyAuditEvents: existingEvents
  };

  await updateEmergencySignal({
    id: "signal-1",
    payload: { expectedVersion: 7, status: "acknowledged" },
    user: COUNTY_USER,
    correlationId: "correlation-retention",
    causationId: "command-retention",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...(rows || [])],
    writeDatabase(data) {
      state = structuredClone(data);
    }
  });

  assert.equal(state[OUTBOX_COLLECTION].length, 1006);
  assert.equal(state[OUTBOX_COLLECTION][0].delivery.status, "pending");
  assert.equal(state[OUTBOX_COLLECTION].at(-1).id, "existing-event-1004");
});

test("emergency signal command replays once and rejects idempotency payload drift", async () => {
  let state = runtimeState();
  let writes = 0;
  const options = {
    id: "signal-1",
    payload: {
      expectedVersion: 7,
      status: "acknowledged",
      action: "physician notified"
    },
    user: COUNTY_USER,
    correlationId: "correlation-emergency-replay-001",
    causationId: "command-emergency-replay-001",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data) {
      writes += 1;
      state = structuredClone(data);
    }
  };
  const first = await updateEmergencySignal(options);
  const replay = await updateEmergencySignal({
    ...options,
    correlationId: "correlation-emergency-replay-002"
  });
  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.deepEqual(replay.event, first.event);
  assert.deepEqual(replay.body, first.body);
  assert.equal(writes, 1);
  assert.equal(state[COLLECTION][0].aggregateVersion, 1);
  assert.equal(state[OUTBOX_COLLECTION].length, 1);
  assert.equal(state[INBOX_COLLECTION].length, 1);

  await assert.rejects(
    updateEmergencySignal({
      ...options,
      payload: {
        ...options.payload,
        status: "dispatched"
      }
    }),
    (error) => {
      assert.equal(error.code, "EMERGENCY_SIGNAL_IDEMPOTENCY_CONFLICT");
      assert.equal(error.statusCode, 409);
      return true;
    }
  );
  assert.equal(writes, 1);
  assert.equal(state[OUTBOX_COLLECTION].length, 1);
});

test("concurrent emergency signal retries commit one aggregate version and one outbox event", async () => {
  let state = runtimeState();
  let writes = 0;
  const options = {
    id: "signal-1",
    payload: { expectedVersion: 7, status: "acknowledged" },
    user: COUNTY_USER,
    correlationId: "correlation-emergency-concurrent",
    causationId: "command-emergency-concurrent",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data) {
      writes += 1;
      state = structuredClone(data);
    }
  };
  const [left, right] = await Promise.all([
    updateEmergencySignal(options),
    updateEmergencySignal(options)
  ]);
  assert.deepEqual([left.replayed, right.replayed].sort(), [false, true]);
  assert.deepEqual(left.event, right.event);
  assert.equal(writes, 1);
  assert.equal(state[COLLECTION][0].aggregateVersion, 1);
  assert.equal(state[OUTBOX_COLLECTION].length, 1);
  assert.equal(state[INBOX_COLLECTION].length, 1);
});

test("emergency signal repository does not write or emit an event for missing aggregates", async () => {
  let writes = 0;
  const state = runtimeState();
  const result = await updateEmergencySignal({
    id: "missing",
    payload: { status: "acknowledged" },
    user: COUNTY_USER,
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase: () => { writes += 1; }
  });
  assert.equal(result.status, 404);
  assert.equal(result.event, null);
  assert.equal(writes, 0);
});

test("emergency signal patch protects aggregate identity and repository fields", () => {
  assert.deepEqual(safePatch({
    id: "tampered",
    residentId: "tampered",
    aggregateVersion: 99,
    expectedVersion: 4,
    updatedBy: "tampered",
    sourceInstitutionCode: "MR1",
    region: "市级",
    status: "dispatched",
    metadata: { channel: "county-command" }
  }), {
    status: "dispatched",
    metadata: { channel: "county-command" }
  });
});

test("emergency signal route exposes ownership and versioned event headers", async () => {
  let state = runtimeState();
  let responseStatus = null;
  let responseBody = null;
  const headers = {};
  const segment = emergencySignalRoute.createRouteSegment({
    appendSecurityEvent: () => {},
    collectJson: async () => ({ status: "dispatched" }),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ username: "hospital-duty", name: "Hospital Duty", role: "institution", orgCode: "MR3" }),
    rowMatchesOrganizationScope,
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: (data) => { state = structuredClone(data); }
  });
  const handled = await segment.handle(
    {
      method: "PATCH",
      headers: { "idempotency-key": "emergency-command-002" },
      correlationId: "emergency-correlation-002"
    },
    {
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = String(value);
      }
    },
    new URL("http://local/api/emergency-signals/signal-1")
  );
  assert.equal(handled, true);
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.status, "dispatched");
  assert.equal(responseBody.idempotentReplay, false);
  assert.equal(headers["x-data-owner"], DOMAIN);
  assert.equal(headers["x-domain-event-type"], EVENT_TYPE);
  assert.equal(headers["x-domain-event-id"], state[OUTBOX_COLLECTION][0].id);
  assert.equal(headers["x-idempotent-replay"], "false");

  await segment.handle(
    {
      method: "PATCH",
      headers: { "idempotency-key": "emergency-command-002" },
      correlationId: "emergency-correlation-replay"
    },
    {
      setHeader(name, value) {
        headers[String(name).toLowerCase()] = String(value);
      }
    },
    new URL("http://local/api/emergency-signals/signal-1")
  );
  assert.equal(responseStatus, 200);
  assert.equal(responseBody.idempotentReplay, true);
  assert.equal(headers["x-idempotent-replay"], "true");
  assert.equal(state[OUTBOX_COLLECTION].length, 1);

  const driftSegment = emergencySignalRoute.createRouteSegment({
    appendSecurityEvent: () => {},
    collectJson: async () => ({ status: "acknowledged" }),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ username: "hospital-duty", name: "Hospital Duty", role: "institution", orgCode: "MR3" }),
    rowMatchesOrganizationScope,
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: (data) => { state = structuredClone(data); }
  });
  await driftSegment.handle(
    {
      method: "PATCH",
      headers: { "idempotency-key": "emergency-command-002" },
      correlationId: "emergency-correlation-drift"
    },
    { setHeader() {} },
    new URL("http://local/api/emergency-signals/signal-1")
  );
  assert.equal(responseStatus, 409);
  assert.equal(responseBody.code, "EMERGENCY_SIGNAL_IDEMPOTENCY_CONFLICT");
  assert.equal(state[OUTBOX_COLLECTION].length, 1);
});

test("institution emergency signal scope is checked before body parsing and denial is audited", async () => {
  const state = runtimeState();
  let bodyReads = 0;
  let writes = 0;
  const audits = [];
  let responseStatus = null;
  let responseBody = null;
  const segment = emergencySignalRoute.createRouteSegment({
    appendSecurityEvent: (event) => audits.push(event),
    collectJson: async () => {
      bodyReads += 1;
      return { status: "dispatched" };
    },
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({
      username: "other-hospital",
      name: "Other Hospital",
      role: "institution",
      orgCode: "MR1",
      orgName: "大连市中心医院"
    }),
    rowMatchesOrganizationScope,
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: () => { writes += 1; }
  });

  const handled = await segment.handle(
    { method: "PATCH", headers: { "idempotency-key": "denied-command" } },
    { setHeader() {} },
    new URL("http://local/api/emergency-signals/signal-1")
  );

  assert.equal(handled, true);
  assert.equal(responseStatus, 403);
  assert.equal(responseBody.code, "EMERGENCY_SIGNAL_SCOPE_DENIED");
  assert.equal(bodyReads, 0);
  assert.equal(writes, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].result, "拒绝");
  assert.equal(audits[0].target, "signal-1");
});

test("emergency signal route preserves the legacy missing response before body parsing", async () => {
  const state = runtimeState();
  let bodyReads = 0;
  let audits = 0;
  let responseStatus = null;
  let responseBody = null;
  const headers = {};
  const segment = emergencySignalRoute.createRouteSegment({
    appendSecurityEvent: () => { audits += 1; },
    collectJson: async () => {
      bodyReads += 1;
      return {};
    },
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    readDatabase: () => structuredClone(state),
    requireApiRole: () => ({ username: "health", name: "Health", role: "commission" }),
    rowMatchesOrganizationScope,
    sendJson: (_res, status, body) => {
      responseStatus = status;
      responseBody = body;
    },
    writeDatabase: () => assert.fail("missing signal must not write")
  });

  await segment.handle(
    { method: "PATCH", headers: {} },
    { setHeader: (name, value) => { headers[String(name).toLowerCase()] = String(value); } },
    new URL("http://local/api/emergency-signals/missing")
  );

  assert.equal(responseStatus, 404);
  assert.deepEqual(responseBody, {
    error: "Not Found",
    message: "未找到业务记录",
    idempotentReplay: false
  });
  assert.equal(headers["x-idempotent-replay"], "false");
  assert.equal(bodyReads, 0);
  assert.equal(audits, 0);
});

test("county emergency signal scope allows its district and rejects an external institution", async () => {
  let allowedState = runtimeState();
  let allowedWrites = 0;
  const allowed = await updateEmergencySignal({
    id: "signal-1",
    payload: { status: "acknowledged" },
    user: COUNTY_USER,
    readDatabase: () => structuredClone(allowedState),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data) {
      allowedWrites += 1;
      allowedState = structuredClone(data);
    }
  });
  assert.equal(allowed.status, 200);
  assert.equal(allowedWrites, 1);

  const deniedState = runtimeState();
  deniedState.authOrganizations.push({
    orgCode: "MR30",
    name: "External Prefix Clinic",
    parentCode: "ORG-DIST-OTHER",
    dataScope: "external district"
  });
  deniedState.emergencySignals[0] = {
    ...deniedState.emergencySignals[0],
    sourceInstitutionCode: "MR30",
    sourceInstitution: "External Prefix Clinic",
    region: "市级"
  };
  await assert.rejects(
    updateEmergencySignal({
      id: "signal-1",
      payload: { status: "acknowledged" },
      user: COUNTY_USER,
      readDatabase: () => structuredClone(deniedState),
      prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
      writeDatabase: () => assert.fail("county scope denial must not write")
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_SCOPE_DENIED" && error.statusCode === 403
  );

  const directDistrictState = runtimeState();
  directDistrictState.authOrganizations.push(
    { orgCode: "ORG-DIST-OTHER", name: "外区健康城市平台", orgType: "district", parentCode: "ORG-CITY-DL", dataScope: "外区" },
    { orgCode: "MR30", name: "外区医院", orgType: "medical_institution", parentCode: "ORG-DIST-OTHER", dataScope: "本机构" }
  );
  directDistrictState.emergencySignals[0] = {
    ...directDistrictState.emergencySignals[0],
    sourceInstitutionCode: "MR30",
    sourceInstitution: "外区医院"
  };
  await assert.rejects(
    updateEmergencySignal({
      id: "signal-1",
      payload: { status: "acknowledged" },
      user: { ...COUNTY_USER, orgCode: "ORG-DIST-ZS", orgName: "中山区健康城市平台" },
      readDatabase: () => structuredClone(directDistrictState),
      prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
      writeDatabase: () => assert.fail("a direct district account must not inherit city-wide sibling scope")
    }),
    (error) => error.code === "EMERGENCY_SIGNAL_SCOPE_DENIED" && error.statusCode === 403
  );

  let creatorState = runtimeState();
  creatorState.emergencySignals[0] = {
    ...creatorState.emergencySignals[0],
    sourceInstitutionCode: undefined,
    sourceInstitution: "Unregistered County Hospital",
    targetInstitution: "Unregistered Regional Center",
    region: "regional-sharing-center",
    createdBy: "county-duty"
  };
  const creatorOwned = await updateEmergencySignal({
    id: "signal-1",
    payload: { status: "acknowledged" },
    user: COUNTY_USER,
    readDatabase: () => structuredClone(creatorState),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data) { creatorState = structuredClone(data); }
  });
  assert.equal(creatorOwned.status, 200);
});

test("commission can update a signal and idempotent replay rechecks current institution scope", async () => {
  let commissionState = runtimeState();
  const commission = await updateEmergencySignal({
    id: "signal-1",
    payload: { status: "reviewed" },
    user: { username: "health", name: "Health Commission", role: "commission", orgCode: "ORG-HEALTH-DL" },
    readDatabase: () => structuredClone(commissionState),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    writeDatabase(data) { commissionState = structuredClone(data); }
  });
  assert.equal(commission.status, 200);

  let state = runtimeState();
  let writes = 0;
  const options = {
    id: "signal-1",
    payload: { status: "acknowledged" },
    user: { username: "community", name: "Community", role: "institution", orgCode: "MR3" },
    causationId: "scope-replay-command",
    readDatabase: () => structuredClone(state),
    prependAuditTrailEntry: (rows, entry) => [entry, ...rows],
    rowMatchesOrganizationScope,
    writeDatabase(data) {
      writes += 1;
      state = structuredClone(data);
    }
  };
  await updateEmergencySignal(options);
  state.emergencySignals[0].sourceInstitutionCode = "MR1";
  state.emergencySignals[0].sourceInstitution = "大连市中心医院";
  await assert.rejects(
    updateEmergencySignal(options),
    (error) => error.code === "EMERGENCY_SIGNAL_SCOPE_DENIED" && error.statusCode === 403
  );
  assert.equal(writes, 1);
  assert.equal(state[INBOX_COLLECTION].length, 1);
  assert.equal(state[OUTBOX_COLLECTION].length, 1);
});
