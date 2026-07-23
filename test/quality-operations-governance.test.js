const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  CANONICAL_STATUSES,
  DOMAINS,
  METRIC_DEFINITIONS,
  SOURCE_STATUS_MAPS,
  STATUS_MACHINES,
  createGovernanceState,
  evaluateMetricThreshold,
  executeGovernanceCommand,
  normalizeSourceStatus,
  validateMetricCatalog
} = require("../quality-operations-governance");

const COMMISSION = { id: "city-quality", role: "commission" };
const HOSPITAL_A = { id: "hospital-a-user", role: "institution", institutionId: "HOSP-A" };
const HOSPITAL_B = { id: "hospital-b-user", role: "institution", institutionId: "HOSP-B" };
const INSURANCE = { id: "insurance-reviewer", role: "insurance" };
const ROOT = path.resolve(__dirname, "..");

function command(idempotencyKey, record, action, actor, extra = {}) {
  return {
    idempotencyKey,
    domain: record.domain,
    recordId: record.id,
    action,
    actor,
    occurredAt: extra.occurredAt || "2026-07-23T09:00:00.000Z",
    expectedVersion: extra.expectedVersion ?? record.version ?? 0,
    payload: extra.payload || {}
  };
}

function qualityRecord(overrides = {}) {
  return {
    id: "quality-1",
    domain: DOMAINS.QUALITY_RECTIFICATION,
    institutionId: "HOSP-A",
    status: "detected",
    ...overrides
  };
}

function dispatchRecord(overrides = {}) {
  return {
    id: "dispatch-1",
    domain: DOMAINS.RESOURCE_DISPATCH,
    sourceInstitutionId: "HOSP-A",
    targetInstitutionId: "HOSP-B",
    status: "assigned",
    ...overrides
  };
}

function drugRecord(overrides = {}) {
  return {
    id: "drug-1",
    domain: DOMAINS.DRUG_CONSUMABLE,
    institutionId: "HOSP-A",
    status: "in_progress",
    ...overrides
  };
}

test("three domain status machines share canonical statuses and keep terminal states closed", () => {
  assert.deepEqual(Object.keys(STATUS_MACHINES).sort(), Object.values(DOMAINS).sort());
  for (const machine of Object.values(STATUS_MACHINES)) {
    assert.deepEqual(Object.keys(machine).sort(), [...CANONICAL_STATUSES].sort());
    assert.deepEqual(machine.closed, {});
    assert.deepEqual(machine.cancelled, {});
  }
});

test("source status maps cover current quality operations and drug vocabulary without guessing unknown status", () => {
  assert.equal(normalizeSourceStatus(DOMAINS.QUALITY_RECTIFICATION, "feedback_submitted"), "evidence_submitted");
  assert.equal(normalizeSourceStatus(DOMAINS.QUALITY_RECTIFICATION, "disposed"), "closed");
  assert.equal(normalizeSourceStatus(DOMAINS.RESOURCE_DISPATCH, "in-progress"), "in_progress");
  assert.equal(normalizeSourceStatus(DOMAINS.RESOURCE_DISPATCH, "blocked"), "escalated");
  assert.equal(normalizeSourceStatus(DOMAINS.DRUG_CONSUMABLE, "insurance-synced"), "under_review");
  assert.equal(normalizeSourceStatus(DOMAINS.DRUG_CONSUMABLE, "traceability-evidence-partial"), "returned");
  assert.equal(normalizeSourceStatus(DOMAINS.DRUG_CONSUMABLE, "not-a-real-status"), "unknown");
  assert.equal(Object.values(SOURCE_STATUS_MAPS).every((map) => Object.values(map).every((status) => CANONICAL_STATUSES.includes(status))), true);
});

test("current source collections contain no unmapped governance status", () => {
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  const sources = [
    {
      domain: DOMAINS.QUALITY_RECTIFICATION,
      collections: ["qualityRectificationOrders", "criticalValueAlerts", "clinicalPathwayCases", "mutualRecognitionQualityReviews"],
      fields: ["status"]
    },
    {
      domain: DOMAINS.RESOURCE_DISPATCH,
      collections: ["resourceDispatchRequests", "statisticsReconciliationReviews", "emergencyDispatchLoops"],
      fields: ["status"]
    },
    {
      domain: DOMAINS.DRUG_CONSUMABLE,
      collections: ["drugConsumableSupervisions"],
      fields: ["status", "reviewStatus", "insuranceStatus", "remediationStatus", "traceabilityEvidenceStatus"]
    }
  ];
  const unknown = [];
  for (const source of sources) {
    for (const collection of source.collections) {
      for (const row of data[collection] || []) {
        for (const field of source.fields) {
          if (row[field] && normalizeSourceStatus(source.domain, row[field]) === "unknown") {
            unknown.push(`${collection}.${field}:${row[field]}`);
          }
        }
      }
    }
  }
  assert.deepEqual(unknown, []);
});

test("quality rectification applies scoped commands and appends a verifiable audit chain", () => {
  const record = qualityRecord();
  let result = executeGovernanceCommand(createGovernanceState([record]), command("q-dispatch-001", record, "dispatch", COMMISSION));
  assert.equal(result.ok, true);
  assert.equal(result.record.status, "assigned");
  assert.equal(result.record.version, 1);

  result = executeGovernanceCommand(result.state, command("q-start-001", result.record, "start", HOSPITAL_A, { expectedVersion: 1 }));
  result = executeGovernanceCommand(result.state, command("q-evidence-001", result.record, "submit_evidence", HOSPITAL_A, {
    expectedVersion: 2,
    payload: { evidenceRef: "object://quality/q-1/evidence-1", note: "department evidence submitted" }
  }));
  result = executeGovernanceCommand(result.state, command("q-review-001", result.record, "review", COMMISSION, { expectedVersion: 3 }));
  result = executeGovernanceCommand(result.state, command("q-approve-001", result.record, "approve", COMMISSION, { expectedVersion: 4 }));

  assert.equal(result.ok, true);
  assert.equal(result.record.status, "closed");
  assert.equal(result.record.version, 5);
  assert.equal(result.state.auditEvents.length, 5);
  assert.equal(result.record.auditEvents.length, 5);
  for (let index = 1; index < result.state.auditEvents.length; index += 1) {
    assert.equal(result.state.auditEvents[index].previousHash, result.state.auditEvents[index - 1].hash);
  }
});

test("cross-institution quality evidence is denied and an identical retry replays the denial", () => {
  const record = qualityRecord({ status: "assigned" });
  const state = createGovernanceState([record]);
  const denied = executeGovernanceCommand(state, command("q-cross-scope-001", record, "submit_evidence", HOSPITAL_B));

  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "INSTITUTION_SCOPE_DENIED");
  assert.equal(denied.record.status, "assigned");
  assert.equal(denied.record.version, 0);
  assert.equal(denied.auditEvent.outcome, "denied");
  assert.equal(denied.state.auditEvents.length, 1);

  const replay = executeGovernanceCommand(denied.state, command("q-cross-scope-001", record, "submit_evidence", HOSPITAL_B, {
    occurredAt: "2026-07-23T09:10:00.000Z"
  }));
  assert.equal(replay.ok, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.state.auditEvents.length, 1);
  assert.equal(replay.auditEvent.id, denied.auditEvent.id);
});

test("operations execution is limited to the target institution", () => {
  const record = dispatchRecord();
  const wrongInstitution = executeGovernanceCommand(
    createGovernanceState([record]),
    command("ops-wrong-target-001", record, "accept", HOSPITAL_A)
  );
  assert.equal(wrongInstitution.ok, false);
  assert.equal(wrongInstitution.error.code, "INSTITUTION_SCOPE_DENIED");

  const accepted = executeGovernanceCommand(
    wrongInstitution.state,
    command("ops-target-accept-001", record, "accept", HOSPITAL_B)
  );
  assert.equal(accepted.ok, true);
  assert.equal(accepted.record.status, "in_progress");
  assert.equal(accepted.auditEvent.institutionIds.includes("HOSP-A"), true);
  assert.equal(accepted.auditEvent.institutionIds.includes("HOSP-B"), true);
});

test("scoped commission actor cannot operate a dispatch spanning an institution outside its jurisdiction", () => {
  const record = dispatchRecord();
  const scopedCommission = { id: "district-commission", role: "commission", scopeInstitutionIds: ["HOSP-A"] };
  const result = executeGovernanceCommand(
    createGovernanceState([record]),
    command("ops-jurisdiction-001", record, "cancel", scopedCommission)
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "INSTITUTION_SCOPE_DENIED");
  assert.match(result.error.message, /exceed actor scope/);
});

test("drug consumable flow separates institution evidence from insurance review", () => {
  const record = drugRecord();
  let result = executeGovernanceCommand(
    createGovernanceState([record]),
    command("drug-evidence-001", record, "submit_evidence", HOSPITAL_A, {
      payload: { traceabilityEvidenceRef: "object://drug/d-1/trace-1" }
    })
  );
  assert.equal(result.record.status, "evidence_submitted");

  result = executeGovernanceCommand(result.state, command("drug-review-001", result.record, "review", INSURANCE));
  assert.equal(result.record.status, "under_review");
  result = executeGovernanceCommand(result.state, command("drug-approve-001", result.record, "approve", INSURANCE));
  assert.equal(result.record.status, "closed");
});

test("same successful command is idempotent while reuse with different payload is rejected", () => {
  const record = qualityRecord();
  const firstCommand = command("q-idempotent-001", record, "dispatch", COMMISSION, { payload: { note: "dispatch once" } });
  const first = executeGovernanceCommand(createGovernanceState([record]), firstCommand);
  const replay = executeGovernanceCommand(first.state, { ...firstCommand, occurredAt: "2026-07-23T10:00:00.000Z" });

  assert.equal(first.ok, true);
  assert.equal(replay.ok, true);
  assert.equal(replay.replayed, true);
  assert.equal(replay.record.version, 1);
  assert.equal(replay.state.auditEvents.length, 1);

  const conflict = executeGovernanceCommand(replay.state, {
    ...firstCommand,
    payload: { note: "changed payload under the same key" }
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
  assert.equal(conflict.state.records[record.id].version, 1);
  assert.equal(conflict.state.auditEvents.length, 2);
});

test("invalid and duplicate transitions are denied without changing business version", () => {
  const record = dispatchRecord({ status: "closed", version: 4 });
  const duplicateClose = executeGovernanceCommand(
    createGovernanceState([record]),
    command("ops-duplicate-close-001", record, "close", COMMISSION)
  );
  assert.equal(duplicateClose.ok, false);
  assert.equal(duplicateClose.error.code, "INVALID_TRANSITION");
  assert.match(duplicateClose.error.message, /terminal/);
  assert.equal(duplicateClose.record.version, 4);

  const invalid = executeGovernanceCommand(
    createGovernanceState([qualityRecord()]),
    command("q-invalid-approve-001", qualityRecord(), "approve", COMMISSION)
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, "INVALID_TRANSITION");
  assert.match(invalid.error.message, /not allowed from detected/);

  const assigned = dispatchRecord();
  const accepted = executeGovernanceCommand(
    createGovernanceState([assigned]),
    command("ops-accept-once-001", assigned, "accept", HOSPITAL_B)
  );
  const duplicateAccept = executeGovernanceCommand(
    accepted.state,
    command("ops-accept-twice-001", accepted.record, "accept", HOSPITAL_B)
  );
  assert.equal(duplicateAccept.ok, false);
  assert.equal(duplicateAccept.error.code, "INVALID_TRANSITION");
  assert.equal(duplicateAccept.record.status, "in_progress");
  assert.equal(duplicateAccept.record.version, 1);
});

test("optimistic version conflicts are audited and do not advance the record", () => {
  const record = qualityRecord({ status: "assigned", version: 2 });
  const result = executeGovernanceCommand(
    createGovernanceState([record]),
    command("q-version-001", record, "start", HOSPITAL_A, { expectedVersion: 1 })
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "VERSION_CONFLICT");
  assert.equal(result.record.version, 2);
  assert.equal(result.auditEvent.outcome, "denied");
});

test("write commands require an explicit non-negative expectedVersion", () => {
  const initial = createGovernanceState([qualityRecord()]);
  const missing = command("q-version-missing", qualityRecord(), "start", HOSPITAL_A);
  delete missing.expectedVersion;
  const denied = executeGovernanceCommand(initial, missing);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, "INVALID_COMMAND");
  assert.match(denied.error.message, /expectedVersion/);
  assert.equal(denied.state.records["quality-1"].version, 0);
  assert.equal(denied.auditEvent.outcome, "denied");
});

test("metric catalog has unique ownership source and threshold contracts", () => {
  const validation = validateMetricCatalog();
  assert.equal(validation.ok, true);
  assert.equal(validation.metrics, METRIC_DEFINITIONS.length);
  assert.equal(new Set(METRIC_DEFINITIONS.map((item) => item.id)).size, METRIC_DEFINITIONS.length);
  assert.equal(Object.values(DOMAINS).every((domain) => METRIC_DEFINITIONS.some((item) => item.domain === domain)), true);
  assert.equal(METRIC_DEFINITIONS.every((item) => item.owner.department && item.owner.stewardRole && item.sourceFields.length), true);

  const closure = METRIC_DEFINITIONS.find((item) => item.id === "quality.rectification-closure-rate");
  const overdue = METRIC_DEFINITIONS.find((item) => item.id === "quality.rectification-overdue-rate");
  assert.equal(evaluateMetricThreshold(closure, 96), "target");
  assert.equal(evaluateMetricThreshold(closure, 92), "warning");
  assert.equal(evaluateMetricThreshold(closure, 85), "critical");
  assert.equal(evaluateMetricThreshold(closure, 70), "breached");
  assert.equal(evaluateMetricThreshold(overdue, 3), "target");
  assert.equal(evaluateMetricThreshold(overdue, 8), "warning");
  assert.equal(evaluateMetricThreshold(overdue, 15), "critical");
  assert.equal(evaluateMetricThreshold(overdue, 21), "breached");
});

test("command execution does not mutate the caller state", () => {
  const record = qualityRecord();
  const state = createGovernanceState([record]);
  const before = JSON.stringify(state);
  const result = executeGovernanceCommand(state, command("q-immutable-001", record, "dispatch", COMMISSION));
  assert.equal(JSON.stringify(state), before);
  assert.equal(state.records[record.id].status, "detected");
  assert.equal(result.state.records[record.id].status, "assigned");
});
