"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  BLOOD_DOMAIN_BOUNDARY,
  CORE_COLLECTIONS,
  OPERATIONS_COLLECTIONS,
  OWNED_COLLECTIONS
} = require("../src/clinical-specialties/blood/boundary");
const {
  CONTRACTS,
  projectBloodObservation
} = require("../src/clinical-specialties/blood/cross-domain-contracts");
const {
  createLegacyBloodStateRepository
} = require("../src/clinical-specialties/blood/state-repository");
const {
  createBloodCoreHttpHandler
} = require("../src/clinical-specialties/blood/http-handler");

const ROOT = path.resolve(__dirname, "..");

test("blood boundary is immutable, unique and not independently deployable yet", () => {
  assert.equal(Object.isFrozen(BLOOD_DOMAIN_BOUNDARY), true);
  assert.equal(Object.isFrozen(OWNED_COLLECTIONS), true);
  assert.equal(new Set(OWNED_COLLECTIONS).size, OWNED_COLLECTIONS.length);
  assert.equal(OWNED_COLLECTIONS.length, CORE_COLLECTIONS.length + OPERATIONS_COLLECTIONS.length);
  assert.deepEqual(BLOOD_DOMAIN_BOUNDARY.apiPrefixes, ["/api/blood-system"]);
  assert.equal(BLOOD_DOMAIN_BOUNDARY.deployment.independentDeploymentAuthorized, false);
});

test("blood subdomain exposes one frozen canonical development entry point", () => {
  const blood = require("../src/clinical-specialties/blood");
  assert.equal(Object.isFrozen(blood), true);
  assert.strictEqual(blood.boundary, BLOOD_DOMAIN_BOUNDARY);
  assert.strictEqual(blood.services.eventHub, require("../src/clinical-specialties/blood/event-hub"));
  assert.equal(typeof blood.http.createCoreHandler, "function");
  assert.equal(typeof blood.http.createOperationsHandler, "function");
});

test("legacy root modules are compatibility exports of the canonical blood source", () => {
  const modules = [
    ["blood-master-data", "master-data"],
    ["blood-service", "service"],
    ["blood-transaction-service", "transaction-service"],
    ["blood-integration-gateway", "integration-gateway"],
    ["blood-business-service", "business-service"],
    ["blood-innovation-service", "innovation-service"],
    ["blood-event-hub", "event-hub"],
    ["blood-go-live-service", "go-live-service"],
    ["blood-clinical-production", "clinical-production"]
  ];
  modules.forEach(([legacy, canonical]) => {
    assert.strictEqual(
      require(path.join(ROOT, legacy)),
      require(path.join(ROOT, "src", "clinical-specialties", "blood", canonical)),
      legacy
    );
  });
});

test("blood state repository blocks undeclared reads, foreign writes and collection deletion", () => {
  const source = {
    bloodUnits: [],
    securityEvents: [{ id: "security-1", detail: { result: "allowed" } }],
    residents: [{ id: "r-1" }]
  };
  let persisted;
  const repository = createLegacyBloodStateRepository({
    readDatabase: () => source,
    writeDatabase: (data) => { persisted = data; }
  });
  const state = repository.read();
  assert.strictEqual(state.bloodUnits, source.bloodUnits);
  assert.notStrictEqual(state.securityEvents, source.securityEvents);
  assert.deepEqual(state.securityEvents, source.securityEvents);
  assert.equal(Object.isFrozen(state.securityEvents), true);
  assert.equal(Object.isFrozen(state.securityEvents[0].detail), true);
  assert.throws(() => state.residents, /read outside boundary: residents/);
  assert.throws(() => { state.residents = []; }, /write outside boundary: residents/);
  assert.throws(() => { state.securityEvents.push({ id: "injected" }); }, TypeError);
  assert.throws(() => { state.securityEvents[0].detail.result = "tampered"; }, TypeError);
  assert.throws(
    () => Object.defineProperty(state, "securityEvents", { value: [] }),
    /property definition is forbidden/
  );
  assert.throws(() => Object.setPrototypeOf(state, null), /prototype mutation is forbidden/);
  assert.throws(() => Object.preventExtensions(state), /preventing extensions is forbidden/);
  assert.throws(() => { delete state.bloodUnits; }, /collection deletion is forbidden/);
  assert.deepEqual(Object.keys(state).sort(), ["bloodUnits", "securityEvents"]);
  assert.equal("residents" in state, false);
  state.bloodUnits = [{ id: "bu-1" }];
  repository.commit(state);
  assert.strictEqual(persisted, source);
  assert.deepEqual(persisted.securityEvents, [{ id: "security-1", detail: { result: "allowed" } }]);
  assert.deepEqual(persisted.residents, [{ id: "r-1" }]);
  assert.throws(() => repository.commit(source), /only commit a state returned by read/);
});

test("blood write routes persist through the scoped repository without changing the legacy snapshot shape", async () => {
  const source = { transfusionRequests: [], residents: [{ id: "r-1" }] };
  let persisted;
  let response;
  const noOp = () => ({ status: 500, body: {} });
  const handler = createBloodCoreHttpHandler({
    BloodBusinessService: {},
    BloodIntegrationGateway: {},
    BloodMasterData: {},
    BloodService: {
      createRequest(data) {
        data.transfusionRequests = [{ id: "bt-1" }];
        assert.throws(() => data.residents, /read outside boundary: residents/);
        return { status: 201, body: { ok: true } };
      },
      assessSpecimen: noOp,
      createRecall: noOp,
      reportReaction: noOp,
      createEmergencyAllocation: noOp,
      acknowledgeRecall: noOp,
      closeRecall: noOp,
      investigateReaction: noOp,
      actEmergencyAllocation: noOp,
      transitionBloodUnit: noOp,
      trace: noOp,
      buildDashboard: noOp
    },
    BloodTransactionService: {
      normalizeTransactionState: (data) => data,
      signTestReport: noOp,
      reviewRelease: noOp,
      createShipment: noOp,
      receiveShipment: noOp,
      reviewColdChainIncident: noOp,
      recordCompatibility: noOp,
      startTransfusion: noOp,
      completeTransfusion: noOp
    },
    collectJson: async () => ({}),
    readDatabase: () => source,
    requireApiRole: () => ({ role: "institution", orgCode: "ORG-A" }),
    sendJson: (_res, status, body) => { response = { status, body }; },
    writeDatabase: (data) => { persisted = data; }
  });

  const handled = await handler.handle(
    { method: "POST", headers: {} },
    {},
    new URL("http://localhost/api/blood-system/transfusion-requests")
  );
  assert.equal(handled, true);
  assert.deepEqual(response, { status: 201, body: { ok: true } });
  assert.strictEqual(persisted, source);
  assert.deepEqual(persisted.residents, [{ id: "r-1" }]);
});

test("versioned cross-domain projections satisfy every frozen required-field contract", () => {
  const event = {
    id: "evt-1",
    type: "blood.shortage.detected",
    subjectId: "O Rh+",
    severity: "high",
    occurredAt: "2026-08-28T00:00:00.000Z",
    payload: { bloodType: "O Rh+" }
  };
  assert.equal(Object.isFrozen(CONTRACTS), true);
  CONTRACTS.forEach((contract) => {
    const projection = projectBloodObservation(event, contract.consumer);
    contract.requiredFields.forEach((field) => assert.notEqual(projection[field], undefined, `${contract.id}.${field}`));
  });
});

test("legacy route facades retain only catalog declarations and delegate blood implementation", () => {
  const facades = ["clinical-blood.js", "blood-innovation.js"].map((file) =>
    fs.readFileSync(path.join(ROOT, "src", "http", "routes", "clinical-specialties", file), "utf8")
  );
  assert.match(facades[0], /BLOOD_CORE_API_GOVERNANCE_DECLARATIONS/);
  assert.match(facades[0], /bloodCoreHttpHandler\.handle/);
  assert.doesNotMatch(facades[0].slice(facades[0].indexOf("function createRouteSegment")), /BloodService\.createRequest/);
  assert.match(facades[1], /BLOOD_OPERATIONS_API_GOVERNANCE_DECLARATIONS/);
  assert.match(facades[1], /bloodOperationsHttpHandler\.handle/);
  assert.doesNotMatch(facades[1].slice(facades[1].indexOf("function createRouteSegment")), /BloodEventHub\.publish/);
  const handler = fs.readFileSync(path.join(ROOT, "src", "clinical-specialties", "blood", "http-handler.js"), "utf8");
  assert.match(handler, /\/api\/blood-system/);
  assert.doesNotMatch(handler, /\/api\/(?:imaging-cloud|physical-exams|emergency|quality-safety)/);
});
