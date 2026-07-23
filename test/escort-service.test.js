const test = require("node:test");
const assert = require("node:assert/strict");

const Domain = require("../nursing-escort-domain");
const Service = require("../escort-service");

const NOW = "2026-07-23T09:00:00+08:00";

function state(overrides = {}) {
  return {
    escortServicePolicy: {
      serviceItems: [
        "mobility assistance",
        "registration",
        "exam escort",
        "payment and medication pickup",
        "family communication",
        "psychological comfort"
      ]
    },
    escortServiceProviders: [{
      id: "esp-001",
      name: "Pilot Escort Provider",
      district: "Pudong",
      serviceCapacity: "regular",
      trainedWorkers: 120,
      published: true,
      status: "published",
      serviceItems: ["mobility assistance", "registration", "exam escort", "family communication"],
      admissionReview: {
        status: "approved",
        policyVersion: Service.PROVIDER_ADMISSION_POLICY_VERSION,
        validUntil: "2027-01-31T23:59:59+08:00",
        reviewReceiptId: "provider-admission-receipt-001"
      },
      insurance: "liability-insurance-active",
      emergencyPlan: "escort-emergency-plan-v1"
    }],
    escortWorkers: [{
      id: "ew-001",
      providerId: "esp-001",
      trainingHours: 40,
      examStatus: "passed",
      insuranceStatus: "covered",
      status: "available",
      skills: ["registration", "exam escort"],
      dailyCapacity: 6,
      assignedToday: 1
    }],
    escortServiceOrders: [],
    ...overrides
  };
}

function payload(overrides = {}) {
  return {
    id: "client-forged-id",
    residentId: "r1",
    providerId: "esp-001",
    workerId: "forged-worker",
    district: "Pudong",
    hospital: "Dalian Central Hospital outpatient clinic",
    hospitalCode: "MR1",
    department: "Cardiology",
    departmentCode: "CARD",
    appointmentAt: "2026-07-25T09:30:00+08:00",
    serviceItems: ["registration", "exam escort"],
    riskLevel: "low",
    priority: "medium",
    subsidyType: "self-pay",
    transportLink: "family-arranged",
    status: "completed",
    identityVerified: true,
    eligibilityResult: { status: "eligible" },
    providerAdmissionSnapshot: { status: "approved" },
    hospitalInterfaceStatus: "confirmed",
    note: "Escort appointment",
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

function create(options = {}, payloadOverrides = {}) {
  return Service.createEscortOrder(state(), payload(payloadOverrides), citizen(), {
    at: NOW,
    idFactory: () => "eso-write-001",
    ...options
  });
}

function eligibilityUpdates(order, overrides = {}) {
  return {
    identityVerified: true,
    eligibilityResult: {
      status: "eligible",
      orderId: order.id,
      residentId: order.residentId,
      checkedAt: NOW,
      validUntil: "2026-07-25T23:59:59+08:00",
      policyVersion: Service.ELIGIBILITY_POLICY_VERSION,
      ...overrides
    }
  };
}

test("escort write path creates a whitelisted order and strips privileged client fields", () => {
  const original = state();
  const result = Service.createEscortOrder(original, payload(), citizen(), {
    at: NOW,
    idFactory: () => "eso-write-001"
  });

  assert.equal(result.created, true);
  assert.equal(result.replayed, false);
  assert.equal(result.order.id, "eso-write-001");
  assert.equal(result.order.status, "requested");
  assert.equal(result.order.workerId, "");
  assert.equal(result.order.identityVerified, false);
  assert.equal(result.order.eligibilityResult.status, "pending");
  assert.equal(result.order.providerAdmissionSnapshot, null);
  assert.equal(result.order.hospitalInterfaceStatus, "pending");
  assert.equal(result.order.requesterAuthorization.requesterRole, "resident");
  assert.match(result.order.intakeFingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.outboxEvent.eventType, "escort-service-order-created");
  assert.equal(result.outboxEvent.aggregateId, result.order.id);
  assert.equal(result.outboxEvent.status, "pending");
  assert.equal(result.state.escortServiceOutbox.length, 1);
  assert.equal(JSON.stringify(result.outboxEvent).includes("Dalian Central Hospital outpatient clinic"), false);
  assert.equal(original.escortServiceOrders.length, 0);
  assert.equal(original.escortServiceOutbox, undefined);
});

test("escort write path replays identical intake and rejects conflicting key reuse or tampered outbox", () => {
  const created = create();
  const replay = Service.createEscortOrder(created.state, payload(), citizen(), { at: NOW });
  assert.equal(replay.created, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, "eso-write-001");
  assert.equal(replay.state.escortServiceOrders.length, 1);
  assert.equal(replay.state.escortServiceOutbox.length, 1);
  assert.equal(replay.outboxEvent.id, created.outboxEvent.id);

  assert.throws(
    () => Service.createEscortOrder(
      created.state,
      payload({ serviceItems: ["registration"] }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "ESCORT_IDEMPOTENCY_CONFLICT"
      && error.details.existingOrderId === "eso-write-001"
  );

  const tampered = structuredClone(created.state);
  tampered.escortServiceOutbox[0].payload.providerId = "forged-provider";
  assert.throws(
    () => Service.createEscortOrder(tampered, payload(), citizen(), { at: NOW }),
    (error) => error.code === "ESCORT_OUTBOX_INTEGRITY_INVALID"
      && error.details.reasons.includes("outbox-id-invalid")
      && error.details.reasons.includes("outbox-payload-digest-invalid")
  );
});

test("family escort booking fails closed without a registry receipt", () => {
  const familyPayload = payload({ residentId: "r2" });
  assert.throws(
    () => Service.createEscortOrder(
      state(),
      familyPayload,
      citizen(),
      { at: NOW, allowedResidentIds: ["r2"] }
    ),
    (error) => error.code === "ESCORT_DELEGATION_EVIDENCE_REQUIRED"
  );

  const authorized = Service.createEscortOrder(state(), familyPayload, citizen(), {
    at: NOW,
    allowedResidentIds: ["r2"],
    authorizationReceipts: { r2: "resident-scope-receipt-r2" },
    idFactory: () => "eso-family-001"
  });
  assert.equal(authorized.order.requesterAuthorization.requesterRole, "family");
  assert.equal(authorized.order.requesterAuthorization.registryReceiptId, "resident-scope-receipt-r2");
});

test("provider admission and service catalogs fail closed without mutating state", () => {
  const original = state({
    escortServiceProviders: [{
      ...state().escortServiceProviders[0],
      published: false,
      status: "training-gap",
      serviceItems: [],
      admissionReview: { status: "pending" }
    }]
  });
  assert.throws(
    () => Service.createEscortOrder(original, payload(), citizen(), { at: NOW }),
    (error) => error.code === "ESCORT_INTAKE_PROVIDER_INVALID"
      && error.details.reasons.includes("intake-provider-not-published")
      && error.details.reasons.includes("intake-provider-status-unavailable")
      && error.details.reasons.includes("intake-provider-admission-not-approved")
      && error.details.reasons.includes("intake-service-outside-provider-catalog:registration")
  );
  assert.equal(original.escortServiceOrders.length, 0);

  assert.throws(
    () => Service.createEscortOrder(
      state(),
      payload({ serviceItems: ["registration", "unknown service"] }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "ESCORT_INTAKE_PROVIDER_INVALID"
      && error.details.reasons.includes("intake-service-outside-policy-catalog:unknown service")
      && error.details.reasons.includes("intake-service-outside-provider-catalog:unknown service")
  );
});

test("escort intake rejects missing fields and past appointment values", () => {
  const original = state();
  assert.throws(
    () => Service.createEscortOrder(
      original,
      payload({ hospital: "", department: "", appointmentAt: "2026-07-22T08:00:00+08:00" }),
      citizen(),
      { at: NOW }
    ),
    (error) => error.code === "ESCORT_INTAKE_INVALID"
      && error.details.reasons.includes("intake-hospital-missing")
      && error.details.reasons.includes("intake-department-missing")
      && error.details.reasons.includes("intake-appointment-time-not-future")
  );
  assert.equal(original.escortServiceOrders.length, 0);
});

test("escort transition requires access, command id and bound current eligibility evidence", () => {
  const created = create();
  assert.throws(
    () => Service.transitionEscortOrder(
      created.state,
      created.order.id,
      "eligibility-checked",
      { role: "institution", id: "hospital-user" },
      { at: NOW, updates: eligibilityUpdates(created.order), commandId: "eligibility-001" }
    ),
    (error) => error.code === "ESCORT_ORDER_SCOPE_DENIED"
  );
  assert.throws(
    () => Service.transitionEscortOrder(
      created.state,
      created.order.id,
      "eligibility-checked",
      { role: "institution", id: "hospital-user" },
      { at: NOW, updates: eligibilityUpdates(created.order), canAccessOrder: () => true }
    ),
    (error) => error.code === "ESCORT_TRANSITION_IDEMPOTENCY_REQUIRED"
  );
  assert.throws(
    () => Service.transitionEscortOrder(
      created.state,
      created.order.id,
      "eligibility-checked",
      { role: "institution", id: "hospital-user" },
      {
        at: NOW,
        commandId: "eligibility-forged",
        canAccessOrder: () => true,
        updates: eligibilityUpdates(created.order, { status: "denied", orderId: "eso-other" })
      }
    ),
    (error) => error.code === "ESCORT_TRANSITION_EVIDENCE_INVALID"
      && error.details.reasons.includes("eligibility-status-not-approved")
      && error.details.reasons.includes("eligibility-order-mismatch")
  );
  assert.throws(
    () => Service.transitionEscortOrder(
      created.state,
      created.order.id,
      "eligibility-checked",
      { role: "institution", id: "hospital-user" },
      {
        at: NOW,
        updates: eligibilityUpdates(created.order),
        commandId: "eligibility-bypass",
        canAccessOrder: () => true,
        enforceEvidence: false
      }
    ),
    (error) => error.code === "ESCORT_EVIDENCE_BYPASS_FORBIDDEN"
  );

  const transitioned = Service.transitionEscortOrder(
    created.state,
    created.order.id,
    "eligibility-checked",
    { role: "institution", id: "hospital-user" },
    {
      at: NOW,
      updates: eligibilityUpdates(created.order),
      commandId: "eligibility-001",
      canAccessOrder: () => true
    }
  );
  assert.equal(transitioned.order.status, "eligibility-checked");
  assert.equal(transitioned.outboxEvent.eventType, "escort-service-order-transitioned");
  assert.equal(transitioned.outboxEvent.payload.timelineEvent.toStatus, "eligibility-checked");
  assert.equal(transitioned.outboxEvent.payload.notificationPlan.toStatus, "eligibility-checked");
  assert.equal(transitioned.state.escortServiceOutbox.length, 2);
  assert.equal(created.state.escortServiceOrders[0].status, "requested");

  const replay = Service.transitionEscortOrder(
    transitioned.state,
    transitioned.order.id,
    "eligibility-checked",
    { role: "institution", id: "hospital-user" },
    {
      at: NOW,
      updates: eligibilityUpdates(created.order),
      commandId: "eligibility-001",
      canAccessOrder: () => true
    }
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.outboxEvent.id, transitioned.outboxEvent.id);
});

test("provider matching requires an approved current snapshot bound to the order and provider", () => {
  const created = create();
  const eligible = Service.transitionEscortOrder(
    created.state,
    created.order.id,
    "eligibility-checked",
    { role: "institution", id: "hospital-user" },
    {
      at: NOW,
      updates: eligibilityUpdates(created.order),
      commandId: "eligibility-provider-001",
      canAccessOrder: () => true
    }
  );
  const snapshot = {
    status: "approved",
    published: true,
    orderId: eligible.order.id,
    providerId: eligible.order.providerId,
    verifiedAt: NOW,
    validUntil: "2026-07-25T23:59:59+08:00",
    policyVersion: Service.PROVIDER_ADMISSION_POLICY_VERSION
  };
  assert.throws(
    () => Service.transitionEscortOrder(
      eligible.state,
      eligible.order.id,
      "provider-matched",
      { role: "county", id: "county-user" },
      {
        at: NOW,
        commandId: "provider-forged",
        canAccessOrder: () => true,
        updates: { providerAdmissionSnapshot: { ...snapshot, providerId: "esp-forged", status: "denied" } }
      }
    ),
    (error) => error.code === "ESCORT_TRANSITION_EVIDENCE_INVALID"
      && error.details.reasons.includes("provider-admission-not-approved")
      && error.details.reasons.includes("provider-admission-subject-mismatch")
  );

  const matched = Service.transitionEscortOrder(
    eligible.state,
    eligible.order.id,
    "provider-matched",
    { role: "county", id: "county-user" },
    {
      at: NOW,
      commandId: "provider-match-001",
      canAccessOrder: () => true,
      updates: { providerAdmissionSnapshot: snapshot }
    }
  );
  assert.equal(matched.order.status, "provider-matched");
});

test("escort dispatch accepts evaluator output while forged evidence is rejected without mutation", () => {
  const order = {
    id: "eso-dispatch-write-001",
    residentId: "r1",
    providerId: "esp-001",
    status: "provider-matched",
    serviceItems: ["registration", "exam escort"],
    riskLevel: "low",
    identityVerified: true,
    eligibilityResult: { status: "eligible" },
    providerAdmissionSnapshot: { status: "approved" },
    contractStatus: "signed",
    insuranceStatus: "covered"
  };
  const sourceState = state({ escortServiceOrders: [order] });
  assert.throws(
    () => Service.transitionEscortOrder(
      sourceState,
      order.id,
      "worker-dispatched",
      { role: "institution", id: "provider-user" },
      {
        at: NOW,
        commandId: "dispatch-forged",
        canAccessOrder: () => true,
        updates: {
          workerId: "ew-forged",
          qualificationSnapshot: { status: "failed" },
          capacityReservation: { status: "reserved" },
          dispatchDecision: { status: "denied" }
        }
      }
    ),
    (error) => error.code === "ORDER_DISPATCH_INTEGRITY_INVALID"
  );
  assert.equal(sourceState.escortServiceOrders[0].status, "provider-matched");
  assert.equal(sourceState.escortServiceOutbox, undefined);

  const decision = Domain.evaluateDispatchCandidate("escort", order, state().escortWorkers[0], { now: NOW });
  assert.equal(decision.eligible, true);
  const dispatched = Service.transitionEscortOrder(
    sourceState,
    order.id,
    "worker-dispatched",
    { role: "institution", id: "provider-user" },
    {
      at: NOW,
      commandId: "dispatch-approved",
      canAccessOrder: () => true,
      updates: decision.updates
    }
  );
  assert.equal(dispatched.order.status, "worker-dispatched");
  assert.equal(dispatched.order.workerId, "ew-001");
  assert.equal(dispatched.state.escortServiceOutbox.length, 1);
});

test("escort notification receipt binds gateway evidence and replays atomically", () => {
  const created = create();
  const transitioned = Service.transitionEscortOrder(
    created.state,
    created.order.id,
    "eligibility-checked",
    { role: "institution", id: "hospital-user" },
    {
      at: NOW,
      updates: eligibilityUpdates(created.order),
      commandId: "eligibility-receipt-001",
      canAccessOrder: () => true
    }
  );
  const message = transitioned.order.notificationPlans[0].messages[0];
  const recorded = Service.recordEscortNotificationReceipt(
    transitioned.state,
    transitioned.order.id,
    message.id,
    { status: "sent", providerMessageId: "provider-message-escort-001" },
    { role: "gateway", id: "message-gateway" },
    { at: "2026-07-23T09:01:00+08:00", canAccessOrder: () => true }
  );
  assert.equal(recorded.replayed, false);
  assert.equal(recorded.receipt.messageId, message.id);
  assert.equal(recorded.order.notificationReceiptSummary.sent, 1);
  assert.equal(recorded.outboxEvent.eventType, "escort-notification-receipt-recorded");
  assert.equal(recorded.state.escortServiceOutbox.length, 3);

  const replay = Service.recordEscortNotificationReceipt(
    recorded.state,
    transitioned.order.id,
    message.id,
    { status: "sent", providerMessageId: "provider-message-escort-001" },
    { role: "gateway", id: "message-gateway" },
    { at: "2026-07-23T09:02:00+08:00", canAccessOrder: () => true }
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.outboxEvent.id, recorded.outboxEvent.id);
  assert.equal(replay.state.escortServiceOutbox.length, 3);

  assert.throws(
    () => Service.recordEscortNotificationReceipt(
      recorded.state,
      transitioned.order.id,
      message.id,
      { status: "sent", providerMessageId: "forged-provider-message" },
      { role: "gateway", id: "message-gateway" },
      { at: "2026-07-23T09:03:00+08:00", canAccessOrder: () => true }
    ),
    (error) => error.code === "NOTIFICATION_RECEIPT_INVALID"
      && error.details.reasons.includes("notification-idempotency-conflict")
  );
});
