const test = require("node:test");
const assert = require("node:assert/strict");

const Domain = require("../nursing-escort-domain");
const Service = require("../internet-nursing-service");

const NOW = "2026-07-23T09:00:00+08:00";
const HASH = `sha256:${"c".repeat(64)}`;

function state(overrides = {}) {
  return {
    internetNursingPolicy: {
      serviceObjects: [
        "elderly or disabled people",
        "rehabilitation patients",
        "mobility-limited chronic disease patients"
      ],
      serviceCatalog: ["wound and ostomy care", "blood glucose measurement"]
    },
    internetNursingInstitutions: [{
      id: "inh-mr1",
      institutionCode: "MR1",
      published: true,
      admissionReview: { status: "approved" },
      dailyCapacity: 18,
      serviceArea: ["Zhongshan", "Xigang"],
      serviceItems: ["wound and ostomy care", "blood glucose measurement"]
    }],
    internetNursingOrders: [],
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    id: "client-forged-id",
    residentId: "r1",
    institutionId: "inh-mr1",
    serviceItem: "wound and ostomy care",
    serviceObject: "mobility-limited chronic disease patient",
    preferredAt: "2026-07-25T09:30:00+08:00",
    durationMinutes: 90,
    district: "Zhongshan",
    address: "Zhongshan service address",
    location: { lat: 38.915, lng: 121.616, source: "resident-map" },
    riskLevel: "medium",
    note: "Home wound care",
    status: "completed",
    nurseId: "forged-nurse",
    identityVerified: true,
    firstVisitAssessment: "passed",
    informedConsent: "signed",
    ...overrides
  };
}

function citizen(overrides = {}) {
  return {
    role: "citizen",
    residentId: "r1",
    accountId: "account-r1",
    ...overrides
  };
}

test("write path creates a whitelisted self-service order and strips privileged client fields", () => {
  const original = state();
  const result = Service.createInternetNursingOrder(original, payload(), citizen(), {
    at: NOW,
    idFactory: () => "ino-write-001"
  });

  assert.equal(result.created, true);
  assert.equal(result.replayed, false);
  assert.equal(result.order.id, "ino-write-001");
  assert.equal(result.order.status, "requested");
  assert.equal(result.order.nurseId, undefined);
  assert.equal(result.order.identityVerified, false);
  assert.equal(result.order.firstVisitAssessment, "pending");
  assert.equal(result.order.informedConsent, "pending");
  assert.equal(result.order.serviceObject, "mobility-limited chronic disease patients");
  assert.equal(result.order.requesterAuthorization.requesterRole, "resident");
  assert.match(result.order.intakeFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(original.internetNursingOrders.length, 0);
  assert.equal(result.state.internetNursingOrders.length, 1);
});

test("write path replays an identical idempotent intake and rejects conflicting payload reuse", () => {
  const created = Service.createInternetNursingOrder(state(), payload(), citizen(), {
    at: NOW,
    idFactory: () => "ino-write-002"
  });
  const replay = Service.createInternetNursingOrder(created.state, payload(), citizen(), { at: NOW });
  assert.equal(replay.created, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, "ino-write-002");
  assert.equal(replay.state.internetNursingOrders.length, 1);

  assert.throws(
    () => Service.createInternetNursingOrder(
      created.state,
      payload({ durationMinutes: 120 }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "NURSING_IDEMPOTENCY_CONFLICT"
      && error.details.existingOrderId === "ino-write-002"
  );
  assert.equal(created.state.internetNursingOrders.length, 1);
});

test("family booking fails closed without a registry receipt and records delegated scope when authorized", () => {
  const familyPayload = payload({ residentId: "r2" });
  assert.throws(
    () => Service.createInternetNursingOrder(
      state(),
      familyPayload,
      citizen(),
      { at: NOW, allowedResidentIds: ["r2"] }
    ),
    (error) => error.code === "NURSING_DELEGATION_EVIDENCE_REQUIRED"
  );

  const authorized = Service.createInternetNursingOrder(state(), familyPayload, citizen(), {
    at: NOW,
    allowedResidentIds: ["r2"],
    authorizationReceipts: { r2: "resident-scope-receipt-r2" },
    idFactory: () => "ino-family-001"
  });
  assert.equal(authorized.order.requesterAuthorization.requesterRole, "family");
  assert.equal(authorized.order.requesterAuthorization.residentId, "r2");
  assert.equal(authorized.order.requesterAuthorization.registryReceiptId, "resident-scope-receipt-r2");
});

test("write path rejects unpublished institutions and policy or institution catalog mismatches without mutation", () => {
  const original = state({
    internetNursingInstitutions: [{
      ...state().internetNursingInstitutions[0],
      published: false,
      admissionReview: { status: "pending" }
    }]
  });
  assert.throws(
    () => Service.createInternetNursingOrder(original, payload(), citizen(), { at: NOW }),
    (error) => error.code === "NURSING_INTAKE_CATALOG_INVALID"
      && error.details.reasons.includes("intake-institution-not-published")
      && error.details.reasons.includes("intake-institution-admission-not-approved")
  );
  assert.equal(original.internetNursingOrders.length, 0);

  assert.throws(
    () => Service.createInternetNursingOrder(
      state(),
      payload({ serviceItem: "intravenous catheter maintenance" }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "NURSING_INTAKE_CATALOG_INVALID"
      && error.details.reasons.includes("intake-service-outside-policy-catalog")
      && error.details.reasons.includes("intake-service-outside-institution-catalog")
  );
});

test("write path converts malformed intake values into a stable domain error without mutation", () => {
  const original = state();
  assert.throws(
    () => Service.createInternetNursingOrder(
      original,
      payload({ preferredAt: "not-a-date" }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "NURSING_INTAKE_INVALID"
      && error.statusCode === 400
      && /invalid date or field value/.test(error.message)
  );
  assert.equal(original.internetNursingOrders.length, 0);
});

test("transition adapter requires an access decision preserves evidence gates and forbids bypass switches", () => {
  const created = Service.createInternetNursingOrder(state(), payload(), citizen(), {
    at: NOW,
    idFactory: () => "ino-transition-001"
  });
  const order = created.order;
  const assessment = Domain.buildNursingAssessmentEvidence(order, {
    eligible: true,
    identityVerified: true,
    clinicianId: "doctor-home-001",
    sourceEncounterId: "encounter-write-001",
    conditions: ["chronic wound requiring home care"],
    contraindicationChecks: [{ code: "unstable-vital-signs", status: "cleared" }],
    consentSigned: true,
    signerId: "r1",
    signerName: "Resident A",
    objectKey: "consent/ino-transition-001.pdf",
    contentHash: HASH,
    storageReceiptId: "storage-receipt-transition-001",
    validUntil: "2026-07-26T09:00:00+08:00"
  }, { at: NOW });

  assert.throws(
    () => Service.transitionInternetNursingOrder(
      created.state,
      order.id,
      "assessed",
      { role: "institution", id: "hospital-user" },
      { at: NOW, updates: assessment }
    ),
    (error) => error.code === "NURSING_ORDER_SCOPE_DENIED"
  );
  assert.equal(created.state.internetNursingOrders[0].status, "requested");

  const transitioned = Service.transitionInternetNursingOrder(
    created.state,
    order.id,
    "assessed",
    { role: "institution", id: "hospital-user" },
    { at: NOW, updates: assessment, canAccessOrder: () => true }
  );
  assert.equal(transitioned.order.status, "assessed");
  assert.equal(created.state.internetNursingOrders[0].status, "requested");

  assert.throws(
    () => Service.transitionInternetNursingOrder(
      created.state,
      order.id,
      "assessed",
      { role: "institution", id: "hospital-user" },
      { at: NOW, updates: assessment, canAccessOrder: () => true, enforceEvidence: false }
    ),
    (error) => error.code === "NURSING_EVIDENCE_BYPASS_FORBIDDEN"
  );
});
