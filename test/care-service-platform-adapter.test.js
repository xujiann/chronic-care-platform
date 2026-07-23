const test = require("node:test");
const assert = require("node:assert/strict");

const Service = require("../care-service-platform-adapter");
const EscortService = require("../escort-service");

const NOW = "2026-07-23T01:00:00.000Z";

function sourceState() {
  return {
    internetNursingPolicy: {
      serviceObjects: ["mobility-limited chronic disease patients"],
      serviceCatalog: ["wound and ostomy care"]
    },
    internetNursingInstitutions: [{
      id: "inh-001",
      published: true,
      admissionReview: { status: "approved" },
      dailyCapacity: 10,
      serviceArea: ["Pudong"],
      serviceItems: ["wound and ostomy care"]
    }],
    internetNursingOrders: [],
    internetNursingOutbox: [],
    escortServicePolicy: {
      serviceItems: ["registration", "exam escort"]
    },
    escortServiceProviders: [{
      id: "esp-001",
      district: "Pudong",
      serviceCapacity: "regular",
      trainedWorkers: 10,
      published: true,
      status: "published",
      serviceItems: ["registration", "exam escort"],
      admissionReview: {
        status: "approved",
        policyVersion: EscortService.PROVIDER_ADMISSION_POLICY_VERSION,
        validUntil: "2027-01-31T23:59:59+08:00"
      },
      insurance: "covered",
      emergencyPlan: "escort-plan-v1"
    }],
    escortServiceOrders: [],
    escortServiceOutbox: []
  };
}

function memoryRepository(initialState) {
  let committed = structuredClone(initialState);
  let version = 1;
  return {
    current() {
      return { state: structuredClone(committed), version };
    },
    async transaction(callback) {
      let staged = structuredClone(committed);
      let stagedVersion = version;
      const result = await callback({
        async readState() {
          return { state: structuredClone(staged), version: stagedVersion };
        },
        async writeState(next, options = {}) {
          if (options.expectedVersion !== stagedVersion) throw new Error("optimistic version conflict");
          staged = structuredClone(next);
          stagedVersion += 1;
          return { version: stagedVersion };
        }
      });
      committed = staged;
      version = stagedVersion;
      return result;
    }
  };
}

function buildAdapter(repository, overrides = {}) {
  let sequence = 0;
  return Service.createCareServicePlatformAdapter({
    repository,
    now: () => NOW,
    idFactory: () => `care-platform-${++sequence}`,
    access: {
      canAccessResident: (residentId, actor) => actor.role === "institution" && residentId === "r1",
      allowedResidentIdsFor: (actor) => actor.role === "citizen" ? ["r1", "r2"] : [],
      authorizationReceiptFor: (residentId) => residentId === "r2" ? "authorization-r2" : "",
      canAccessOrder: (domain, order, actor) => actor.role === "institution"
        && order.residentId === "r1"
        && ["nursing", "escort"].includes(domain)
    },
    deliveryAdapters: {
      nursing: async (event) => ({ status: "accepted", providerMessageId: `nursing:${event.id}` }),
      escort: async (event) => ({ status: "accepted", providerMessageId: `escort:${event.id}` })
    },
    ...overrides
  });
}

function escortPayload(overrides = {}) {
  return {
    residentId: "r1",
    providerId: "esp-001",
    district: "Pudong",
    hospital: "Pilot Hospital",
    hospitalCode: "MR1",
    department: "Cardiology",
    departmentCode: "CARD",
    appointmentAt: "2026-07-25T09:30:00+08:00",
    serviceItems: ["registration", "exam escort"],
    riskLevel: "low",
    status: "completed",
    workerId: "forged-worker",
    ...overrides
  };
}

function nursingPayload(overrides = {}) {
  return {
    residentId: "r1",
    institutionId: "inh-001",
    serviceItem: "wound and ostomy care",
    serviceObject: "mobility-limited chronic disease patients",
    preferredAt: "2026-07-25T09:30:00+08:00",
    durationMinutes: 90,
    district: "Pudong",
    address: "Authorized service address",
    location: { lat: 31.23, lng: 121.47, source: "resident-map" },
    riskLevel: "medium",
    status: "completed",
    nurseId: "forged-nurse",
    ...overrides
  };
}

test("platform adapter atomically creates guarded nursing and escort orders", async () => {
  const repository = memoryRepository(sourceState());
  const adapter = buildAdapter(repository);
  const actor = { role: "citizen", residentId: "r1", accountId: "account-r1" };
  const nursing = await adapter.createOrder("nursing", nursingPayload(), actor, { commandId: "create-nursing-001" });
  const escort = await adapter.createOrder("escort", escortPayload(), actor, { commandId: "create-escort-001" });

  assert.equal(nursing.committed, true);
  assert.equal(nursing.order.status, "requested");
  assert.equal(nursing.order.nurseId, undefined);
  assert.equal(escort.committed, true);
  assert.equal(escort.order.status, "requested");
  assert.equal(escort.order.workerId, "");
  assert.equal(repository.current().state.internetNursingOrders.length, 1);
  assert.equal(repository.current().state.internetNursingOutbox.length, 1);
  assert.equal(repository.current().state.escortServiceOrders.length, 1);
  assert.equal(repository.current().state.escortServiceOutbox.length, 1);
  assert.equal(repository.current().version, 3);
});

test("platform adapter fails closed on missing command scope and evidence bypass", async () => {
  const repository = memoryRepository(sourceState());
  const adapter = buildAdapter(repository);
  await assert.rejects(
    () => adapter.createOrder(
      "escort",
      escortPayload({ residentId: "r2" }),
      { role: "citizen", residentId: "r1", accountId: "account-r1" },
      {}
    ),
    (error) => error.code === "CARE_PLATFORM_COMMAND_ID_REQUIRED"
  );
  await assert.rejects(
    () => adapter.createOrder(
      "escort",
      escortPayload({ residentId: "r2" }),
      { role: "institution", id: "institution-user" },
      { commandId: "create-denied" }
    ),
    (error) => error.code === "ESCORT_RESIDENT_SCOPE_DENIED"
  );
  assert.equal(repository.current().version, 1);

  const created = await adapter.createOrder(
    "escort",
    escortPayload(),
    { role: "citizen", residentId: "r1", accountId: "account-r1" },
    { commandId: "create-valid" }
  );
  await assert.rejects(
    () => adapter.transitionOrder(
      "escort",
      created.order.id,
      "eligibility-checked",
      { role: "institution", id: "institution-user" },
      { commandId: "transition-bypass", enforceEvidence: false, updates: {} }
    ),
    (error) => error.code === "CARE_PLATFORM_EVIDENCE_BYPASS_FORBIDDEN"
  );
  assert.equal(repository.current().state.escortServiceOrders[0].status, "requested");
});

test("platform adapter transitions with bound evidence and exposes outbox health", async () => {
  const repository = memoryRepository(sourceState());
  const adapter = buildAdapter(repository);
  const created = await adapter.createOrder(
    "escort",
    escortPayload(),
    { role: "citizen", residentId: "r1", accountId: "account-r1" },
    { commandId: "create-transition" }
  );
  const transitioned = await adapter.transitionOrder(
    "escort",
    created.order.id,
    "eligibility-checked",
    { role: "institution", id: "institution-user" },
    {
      commandId: "eligibility-transition-001",
      updates: {
        identityVerified: true,
        eligibilityResult: {
          status: "eligible",
          orderId: created.order.id,
          residentId: "r1",
          checkedAt: NOW,
          validUntil: "2026-07-25T23:59:59+08:00",
          policyVersion: EscortService.ELIGIBILITY_POLICY_VERSION
        }
      }
    }
  );
  assert.equal(transitioned.order.status, "eligibility-checked");
  const health = await adapter.readOutboxHealth({
    at: "2026-07-23T01:00:02.000Z",
    maxPendingAgeSeconds: 300
  });
  assert.equal(health.ok, true);
  assert.equal(health.summary.pending, 2);
  assert.equal(health.byDomain.escort.pending, 2);
});

test("platform adapter runs the transactional worker and returns safe HTTP errors", async () => {
  const repository = memoryRepository(sourceState());
  const adapter = buildAdapter(repository);
  await adapter.createOrder(
    "nursing",
    nursingPayload(),
    { role: "citizen", residentId: "r1", accountId: "account-r1" },
    { commandId: "create-worker-nursing" }
  );
  await adapter.createOrder(
    "escort",
    escortPayload(),
    { role: "citizen", residentId: "r1", accountId: "account-r1" },
    { commandId: "create-worker-escort" }
  );
  const result = await adapter.runOutboxWorker({
    workerId: "platform-worker-001",
    runId: "platform-run-001",
    at: "2026-07-23T01:00:02.000Z",
    batchSize: 10
  });
  assert.equal(result.delivered, 2);
  assert.equal(repository.current().state.internetNursingOutbox[0].status, "delivered");
  assert.equal(repository.current().state.escortServiceOutbox[0].status, "delivered");

  const response = Service.errorResponse(Object.assign(new Error("sensitive details must not leak"), {
    code: "TEST_REJECTED",
    statusCode: 409,
    details: {
      reasons: ["binding mismatch"],
      residentId: "r-sensitive",
      providerToken: "secret-value"
    }
  }));
  assert.equal(response.status, 409);
  assert.equal(response.body.code, "TEST_REJECTED");
  assert.deepEqual(response.body.details, { reasons: ["binding mismatch"] });
});
