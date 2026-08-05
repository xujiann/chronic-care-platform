"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  applyDirectReportReconciliationActionToState,
  discoverDirectReportReconciliationCases,
  projectDirectReportReconciliationCase,
  scanDirectReportReconciliation,
  sha256,
  summarizeDirectReportReconciliations,
  verifyDirectReportReconciliationAudit
} = require("../public-health-direct-report-reconciliation-service");

const NOW = "2026-08-05T10:00:00.000Z";

function projections() {
  return {
    cases: [
      { id: "case-1", state: "submitted", version: 3 },
      { id: "case-2", state: "submitted", version: 4 },
      { id: "case-3", state: "receipt-confirmed", version: 5 },
      { id: "case-4", state: "submitted", version: 2 },
      { id: "case-5", state: "submitted", version: 2 }
    ],
    deliveries: [
      {
        id: "delivery-1",
        caseId: "case-1",
        state: "awaiting-callback",
        version: 3,
        updatedAt: "2026-08-05T09:00:00.000Z",
        providerReceipt: {
          receiptId: "provider-1",
          providerStatus: "accepted",
          acceptedAt: "2026-08-05T09:00:00.000Z"
        }
      },
      {
        id: "delivery-2",
        caseId: "case-2",
        state: "awaiting-callback",
        version: 3,
        updatedAt: "2026-08-05T09:50:00.000Z"
      },
      {
        id: "delivery-3",
        caseId: "case-3",
        state: "callback-accepted",
        version: 4,
        updatedAt: "2026-08-05T09:40:00.000Z"
      },
      {
        id: "delivery-4",
        caseId: "case-4",
        state: "retry-scheduled",
        version: 3,
        updatedAt: "2026-08-05T09:20:00.000Z",
        nextAttemptAt: "2026-08-05T09:30:00.000Z"
      },
      {
        id: "delivery-5",
        caseId: "case-5",
        state: "dead-letter",
        version: 5,
        updatedAt: "2026-08-05T09:20:00.000Z"
      }
    ],
    receipts: [
      {
        id: "receipt-2",
        deliveryId: "delivery-2",
        caseId: "case-2",
        status: "accepted",
        receivedAt: "2026-08-05T09:51:00.000Z",
        receiptDigest: sha256("receipt-2")
      },
      {
        id: "receipt-3-a",
        deliveryId: "delivery-3",
        caseId: "case-3",
        status: "accepted",
        receivedAt: "2026-08-05T09:41:00.000Z",
        receiptDigest: sha256("receipt-3-a")
      },
      {
        id: "receipt-3-b",
        deliveryId: "delivery-3",
        caseId: "case-3",
        status: "accepted",
        receivedAt: "2026-08-05T09:42:00.000Z",
        receiptDigest: sha256("receipt-3-b")
      },
      {
        id: "receipt-3-b",
        deliveryId: "delivery-3",
        caseId: "case-3",
        status: "accepted",
        receivedAt: "2026-08-05T09:42:00.000Z",
        receiptDigest: sha256("receipt-3-b")
      }
    ]
  };
}

function evidence(label) {
  return {
    evidenceRef: `evidence://direct-report-reconciliation/${label}`,
    evidenceDigest: sha256(label)
  };
}

function apply(data, id, input) {
  return applyDirectReportReconciliationActionToState(data, id, {
    at: NOW,
    ...input
  });
}

test("scan deterministically detects missing receipt, drift, duplicate, timeout and dead letter", () => {
  const first = scanDirectReportReconciliation(projections(), {
    now: NOW,
    receiptTimeoutMinutes: 30
  });
  const replay = scanDirectReportReconciliation(projections(), {
    now: NOW,
    receiptTimeoutMinutes: 30
  });
  assert.deepEqual(replay, first);
  assert.equal(first.summary.findings, 6);
  assert.deepEqual(first.summary.byType, {
    "missing-receipt": 1,
    "state-drift": 1,
    "duplicate-receipt": 1,
    timeout: 2,
    "dead-letter": 1
  });
  assert.equal(new Set(first.findings.map((item) => item.id)).size, 6);
  assert.equal(first.rawPayloadPersisted, false);
  assert.equal(first.subjectIdentityPersisted, false);
  assert.equal(first.credentialsPersisted, false);
  assert.equal(first.signaturesPersisted, false);
  assert.equal(first.productionReady, false);
});

test("scan rejects raw payload, resident identity, credentials, signatures and invalid receipt digests", () => {
  for (const forbidden of [
    { payload: { diseaseCode: "synthetic" } },
    { residentId: "resident-raw-id" },
    { accessToken: "credential-value" },
    { signature: "raw-signature" }
  ]) {
    assert.throws(
      () => scanDirectReportReconciliation({
        cases: [{ id: "case-sensitive", state: "submitted", ...forbidden }],
        deliveries: [],
        receipts: []
      }, { now: NOW }),
      (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_SENSITIVE_PROJECTION"
    );
  }
  assert.throws(
    () => scanDirectReportReconciliation({
      cases: [{ id: "case-1", state: "submitted" }],
      deliveries: [{ id: "delivery-1", caseId: "case-1", state: "callback-accepted" }],
      receipts: [{
        id: "receipt-1",
        deliveryId: "delivery-1",
        status: "accepted",
        receivedAt: NOW,
        receiptDigest: "not-a-digest"
      }]
    }, { now: NOW }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_RECEIPT_DIGEST_INVALID"
  );
});

test("scan exposes broken receipt bindings as state drift without retaining receipt content", () => {
  const scan = scanDirectReportReconciliation({
    cases: [{ id: "case-binding-a", state: "receipt-confirmed" }],
    deliveries: [{
      id: "delivery-binding-a",
      caseId: "case-binding-a",
      state: "callback-accepted",
      updatedAt: NOW
    }],
    receipts: [
      {
        id: "receipt-wrong-case",
        deliveryId: "delivery-binding-a",
        caseId: "case-binding-b",
        status: "accepted",
        receivedAt: NOW,
        receiptDigest: sha256("receipt-wrong-case")
      },
      {
        id: "receipt-orphan",
        deliveryId: "delivery-missing",
        caseId: "case-binding-a",
        status: "accepted",
        receivedAt: NOW,
        receiptDigest: sha256("receipt-orphan")
      }
    ]
  }, { now: NOW });
  assert.deepEqual(
    scan.findings.map((item) => item.detail).sort(),
    ["receipt-case-binding-disagrees", "receipt-delivery-binding-not-found"]
  );
  assert.equal(scan.findings.every((item) => item.type === "state-drift"), true);
  assert.doesNotMatch(JSON.stringify(scan.findings), /receipt-wrong-case|receipt-orphan/);
});

test("finding discovery is digest-bound and idempotent without retaining source projections", () => {
  const scan = scanDirectReportReconciliation(projections(), {
    now: NOW,
    receiptTimeoutMinutes: 30
  });
  const first = discoverDirectReportReconciliationCases({}, scan);
  assert.equal(first.discovered.length, 6);
  assert.equal(first.discovered.every((item) => item.idempotent === false), true);
  const replay = discoverDirectReportReconciliationCases(first.nextData, scan);
  assert.equal(replay.discovered.every((item) => item.idempotent === true), true);
  assert.equal(replay.nextData.publicHealthDirectReportReconciliationCases.length, 6);
  const serialized = JSON.stringify(replay.nextData);
  assert.doesNotMatch(serialized, /provider-1|receipt-2|receipt-3/);
  replay.nextData.publicHealthDirectReportReconciliationCases.forEach((item) => {
    assert.equal(Object.hasOwn(item, "payload"), false);
    assert.equal(Object.hasOwn(item, "providerReceipt"), false);
    assert.equal(Object.hasOwn(item, "receipt"), false);
    assert.equal(Object.hasOwn(item, "residentId"), false);
    assert.equal(Object.hasOwn(item, "credentials"), false);
    assert.equal(Object.hasOwn(item, "signature"), false);
  });
  assert.equal(replay.productionReady, false);
});

test("CAS and idempotency protect assignment while only the assigned role can acknowledge", () => {
  const scan = scanDirectReportReconciliation(projections(), { now: NOW });
  const discovered = discoverDirectReportReconciliationCases({}, scan);
  const item = discovered.nextData.publicHealthDirectReportReconciliationCases[0];
  const assigned = apply(discovered.nextData, item.id, {
    action: "assign",
    expectedVersion: 1,
    idempotencyKey: "assign-1",
    actorRole: "commission-operations",
    actorId: "operator-a",
    assigneeRole: "interface-operations"
  });
  assert.equal(assigned.reconciliationCase.status, "assigned");
  const replay = apply(assigned.nextData, item.id, {
    action: "assign",
    expectedVersion: 1,
    idempotencyKey: "assign-1",
    actorRole: "commission-operations",
    actorId: "operator-a",
    assigneeRole: "interface-operations"
  });
  assert.equal(replay.idempotent, true);
  assert.equal(replay.reconciliationCase.version, 2);
  assert.throws(
    () => apply(assigned.nextData, item.id, {
      action: "assign",
      expectedVersion: 2,
      idempotencyKey: "assign-1",
      actorRole: "commission-operations",
      actorId: "operator-a",
      assigneeRole: "provider-operations"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_IDEMPOTENCY_CONFLICT"
  );
  assert.throws(
    () => apply(assigned.nextData, item.id, {
      action: "acknowledge",
      expectedVersion: 1,
      idempotencyKey: "ack-stale",
      actorRole: "interface-operations",
      actorId: "operator-b"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_VERSION_CONFLICT"
  );
  assert.throws(
    () => apply(assigned.nextData, item.id, {
      action: "acknowledge",
      expectedVersion: 2,
      idempotencyKey: "ack-wrong-role",
      actorRole: "commission-operations",
      actorId: "operator-a"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ASSIGNEE_MISMATCH"
  );
});

test("every action rejects unregistered actors and assignment rejects unregistered roles", () => {
  const scan = scanDirectReportReconciliation(projections(), { now: NOW });
  const state = discoverDirectReportReconciliationCases({}, scan).nextData;
  const item = state.publicHealthDirectReportReconciliationCases[0];
  ["assign", "acknowledge", "compensate", "review", "close"].forEach((action) => {
    assert.throws(
      () => apply(state, item.id, {
        action,
        expectedVersion: 1,
        idempotencyKey: `unregistered-${action}`,
        actorRole: "arbitrary-self-authorized-role",
        actorId: "actor-x",
        assigneeRole: "interface-operations"
      }),
      (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ACTOR_ROLE_INVALID"
    );
  });
  assert.throws(
    () => apply(state, item.id, {
      action: "assign",
      expectedVersion: 1,
      idempotencyKey: "unregistered-assignee",
      actorRole: "commission-operations",
      actorId: "operator-a",
      assigneeRole: "arbitrary-self-authorized-role"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_ASSIGNEE_ROLE_INVALID"
  );
});

test("audit summary forms a continuous hash chain and tampering blocks actions and projections", () => {
  const scan = scanDirectReportReconciliation(projections(), { now: NOW });
  let state = discoverDirectReportReconciliationCases({}, scan).nextData;
  const item = state.publicHealthDirectReportReconciliationCases[0];
  state = apply(state, item.id, {
    action: "assign",
    expectedVersion: 1,
    idempotencyKey: "audit-assign",
    actorRole: "commission-operations",
    actorId: "operator-a",
    assigneeRole: "interface-operations"
  }).nextData;
  const current = state.publicHealthDirectReportReconciliationCases[0];
  const verified = verifyDirectReportReconciliationAudit(current);
  assert.equal(verified.valid, true);
  assert.equal(verified.entries, 2);
  assert.equal(current.auditSummary[0].previousDigest, "0".repeat(64));
  assert.equal(current.auditSummary[1].previousDigest, current.auditSummary[0].eventDigest);
  assert.equal(verified.headDigest, current.auditSummary[1].eventDigest);

  const tampered = structuredClone(state);
  tampered.publicHealthDirectReportReconciliationCases[0].auditSummary[0].actorRole =
    "security-audit";
  assert.throws(
    () => apply(tampered, item.id, {
      action: "acknowledge",
      expectedVersion: 2,
      idempotencyKey: "audit-tampered-action",
      actorRole: "interface-operations",
      actorId: "operator-b"
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_AUDIT_INTEGRITY_INVALID"
  );
  assert.throws(
    () => projectDirectReportReconciliationCase(
      tampered.publicHealthDirectReportReconciliationCases[0]
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_AUDIT_INTEGRITY_INVALID"
  );

  const stateTampered = structuredClone(state);
  stateTampered.publicHealthDirectReportReconciliationCases[0].assignment.assigneeRole =
    "provider-operations";
  assert.throws(
    () => projectDirectReportReconciliationCase(
      stateTampered.publicHealthDirectReportReconciliationCases[0]
    ),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_AUDIT_INTEGRITY_INVALID"
  );
});

test("workflow closes only after evidence-backed compensation and independent review", () => {
  const scan = scanDirectReportReconciliation(projections(), { now: NOW });
  let state = discoverDirectReportReconciliationCases({}, scan).nextData;
  const item = state.publicHealthDirectReportReconciliationCases.find(
    (candidate) => candidate.findingType === "dead-letter"
  );
  let result = apply(state, item.id, {
    action: "assign",
    expectedVersion: 1,
    idempotencyKey: "lifecycle-assign",
    actorRole: "commission-operations",
    actorId: "lead-a",
    assigneeRole: "interface-operations"
  });
  state = result.nextData;
  result = apply(state, item.id, {
    action: "acknowledge",
    expectedVersion: 2,
    idempotencyKey: "lifecycle-ack",
    actorRole: "interface-operations",
    actorId: "operator-a"
  });
  state = result.nextData;
  assert.equal(result.reconciliationCase.status, "acknowledged");

  assert.throws(
    () => apply(state, item.id, {
      action: "compensate",
      expectedVersion: 3,
      idempotencyKey: "bad-strategy",
      actorRole: "interface-operations",
      actorId: "operator-a",
      strategy: "store-raw-provider-message",
      ...evidence("bad-strategy")
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_STRATEGY_INVALID"
  );
  assert.throws(
    () => apply(state, item.id, {
      action: "compensate",
      expectedVersion: 3,
      idempotencyKey: "uncontrolled-evidence",
      actorRole: "interface-operations",
      actorId: "operator-a",
      strategy: "replay-delivery",
      evidenceRef: "C:\\temp\\raw-provider-message.json",
      evidenceDigest: sha256("uncontrolled-evidence")
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_EVIDENCE_REQUIRED"
  );
  result = apply(state, item.id, {
    action: "compensate",
    expectedVersion: 3,
    idempotencyKey: "lifecycle-compensate",
    actorRole: "interface-operations",
    actorId: "operator-a",
    strategy: "replay-delivery",
    ...evidence("compensation")
  });
  state = result.nextData;
  assert.equal(result.reconciliationCase.status, "compensated");

  assert.throws(
    () => apply(state, item.id, {
      action: "review",
      expectedVersion: 4,
      idempotencyKey: "self-review",
      actorRole: "interface-operations",
      actorId: "operator-a",
      approved: true,
      ...evidence("self-review")
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_INDEPENDENT_REVIEW_REQUIRED"
  );
  result = apply(state, item.id, {
    action: "review",
    expectedVersion: 4,
    idempotencyKey: "lifecycle-review",
    actorRole: "disease-control-audit",
    actorId: "reviewer-a",
    approved: true,
    ...evidence("independent-review")
  });
  state = result.nextData;
  assert.equal(result.reconciliationCase.status, "independently-reviewed");

  assert.throws(
    () => apply(state, item.id, {
      action: "close",
      expectedVersion: 5,
      idempotencyKey: "close-without-command",
      actorRole: "disease-control-audit",
      actorId: "reviewer-a",
      ...evidence("closure")
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_RECONCILIATION_CLOSE_CONFIRMATION_REQUIRED"
  );
  result = apply(state, item.id, {
    action: "close",
    expectedVersion: 5,
    idempotencyKey: "lifecycle-close",
    actorRole: "disease-control-audit",
    actorId: "reviewer-a",
    command: "CLOSE DIRECT REPORT RECONCILIATION",
    ...evidence("closure")
  });
  assert.equal(result.reconciliationCase.status, "closed");
  assert.equal(result.reconciliationCase.version, 6);
  assert.equal(result.reconciliationCase.auditSummary.length, 6);
  assert.equal(result.reconciliationCase.productionReady, false);
  assert.doesNotMatch(JSON.stringify(result.reconciliationCase), /operator-a|reviewer-a|lead-a/);
});

test("public projection and summary expose workflow state without evidence or actor digests", () => {
  const scan = scanDirectReportReconciliation(projections(), { now: NOW });
  let state = discoverDirectReportReconciliationCases({}, scan).nextData;
  const item = state.publicHealthDirectReportReconciliationCases[0];
  state = apply(state, item.id, {
    action: "assign",
    expectedVersion: 1,
    idempotencyKey: "projection-assign",
    actorRole: "commission-operations",
    actorId: "operator-a",
    assigneeRole: "interface-operations"
  }).nextData;
  const projected = projectDirectReportReconciliationCase(
    state.publicHealthDirectReportReconciliationCases[0]
  );
  const summary = summarizeDirectReportReconciliations(state);
  assert.equal(projected.assigneeRole, "interface-operations");
  assert.equal(projected.productionReady, false);
  assert.equal(summary.total, 6);
  assert.equal(summary.open, 6);
  assert.equal(summary.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify({ projected, summary }),
    /findingDigest|sourceDigest|actorDigest|evidenceDigest|evidenceRef|idempotencyKeyDigest/
  );
});
