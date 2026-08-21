"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ACTIONS,
  CONTRACT,
  DECISION_STATUSES,
  DrugConsumableSupervisionError,
  applyDrugConsumableSupervisionCommand
} = require("../src/insurance-payment/drug-consumable/supervision-use-case");

const ACTORS = Object.freeze({
  doctor: Object.freeze({
    id: "doctor-001",
    role: "doctor",
    orgCode: "HOSP-A",
    regionCode: "REGION-A"
  }),
  pharmacist: Object.freeze({
    id: "pharmacist-001",
    role: "pharmacist",
    orgCode: "HOSP-A",
    regionCode: "REGION-A"
  }),
  committee: Object.freeze({
    id: "committee-001",
    role: "pharmacy-committee",
    orgCode: "HOSP-A",
    regionCode: "REGION-A"
  })
});

function record(overrides = {}) {
  return {
    id: "drug-supervision-001",
    orgCode: "HOSP-A",
    regionCode: "REGION-A",
    decisionStatus: DECISION_STATUSES.DRAFT,
    domainVersion: 0,
    decisionHistory: [],
    boundary: "rational-medication",
    ...overrides
  };
}

function command(commandId, action, expectedDomainVersion, actor, payload = {}) {
  return {
    commandId,
    recordId: "drug-supervision-001",
    action,
    expectedDomainVersion,
    actor,
    payload,
    occurredAt: `2026-08-21T08:0${expectedDomainVersion}:00.000Z`
  };
}

function assertCode(fn, code, statusCode) {
  assert.throws(fn, (error) => {
    assert.equal(error instanceof DrugConsumableSupervisionError, true);
    assert.equal(error.code, code);
    if (statusCode !== undefined) assert.equal(error.statusCode, statusCode);
    return true;
  });
}

test("drug supervision decision use case publishes a stable v1 contract", () => {
  assert.deepEqual(CONTRACT, {
    id: "drug-consumable-supervision-decision.v1",
    version: "1.0.0",
    owner: "insurance-payment",
    processOwner: "T07"
  });
  assert.deepEqual(ACTIONS, {
    SUBMIT_REVIEW: "submit-review",
    PHARMACIST_REVIEW: "pharmacist-review",
    COMMITTEE_CONFIRM: "committee-confirm",
    COMMITTEE_RETURN: "committee-return"
  });
});

test("legacy records without a domain version start at zero and enter review", () => {
  const legacy = record();
  delete legacy.domainVersion;
  delete legacy.decisionStatus;
  delete legacy.decisionHistory;
  const before = structuredClone(legacy);

  const result = applyDrugConsumableSupervisionCommand(
    legacy,
    command("drug-submit-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor, {
      note: "处方审方材料提交",
      evidenceRef: "object://drug/review-001"
    })
  );

  assert.equal(result.replayed, false);
  assert.equal(result.record.domainVersion, 1);
  assert.equal(result.record.decisionStatus, DECISION_STATUSES.REVIEW_SUBMITTED);
  assert.equal(result.record.decisionHistory.length, 1);
  assert.equal(result.decision.resultingDomainVersion, 1);
  assert.equal(result.decision.fromStatus, DECISION_STATUSES.DRAFT);
  assert.equal(result.decision.toStatus, DECISION_STATUSES.REVIEW_SUBMITTED);
  assert.deepEqual(legacy, before);
});

test("doctor, pharmacist and committee complete the confirmation state machine", () => {
  const initial = record();
  const submitted = applyDrugConsumableSupervisionCommand(
    initial,
    command("drug-submit-002", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor, { note: "提交审方" })
  );
  const reviewed = applyDrugConsumableSupervisionCommand(
    submitted.record,
    command("drug-pharmacist-001", ACTIONS.PHARMACIST_REVIEW, 1, ACTORS.pharmacist, {
      note: "药师完成复核",
      conclusion: "appropriate"
    })
  );
  const confirmed = applyDrugConsumableSupervisionCommand(
    reviewed.record,
    command("drug-committee-001", ACTIONS.COMMITTEE_CONFIRM, 2, ACTORS.committee, {
      note: "药事会确认通过"
    })
  );

  assert.equal(initial.domainVersion, 0);
  assert.equal(submitted.record.decisionStatus, DECISION_STATUSES.REVIEW_SUBMITTED);
  assert.equal(reviewed.record.decisionStatus, DECISION_STATUSES.PHARMACIST_REVIEWED);
  assert.equal(confirmed.record.decisionStatus, DECISION_STATUSES.COMMITTEE_CONFIRMED);
  assert.equal(confirmed.record.domainVersion, 3);
  assert.deepEqual(
    confirmed.record.decisionHistory.map((item) => item.action),
    [ACTIONS.SUBMIT_REVIEW, ACTIONS.PHARMACIST_REVIEW, ACTIONS.COMMITTEE_CONFIRM]
  );
  assert.deepEqual(
    confirmed.record.decisionHistory.map((item) => item.actor.role),
    ["doctor", "pharmacist", "pharmacy-committee"]
  );
});

test("committee return is recorded and the corrected review can be resubmitted", () => {
  const submitted = applyDrugConsumableSupervisionCommand(
    record(),
    command("drug-submit-return-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
  );
  const reviewed = applyDrugConsumableSupervisionCommand(
    submitted.record,
    command("drug-review-return-001", ACTIONS.PHARMACIST_REVIEW, 1, ACTORS.pharmacist)
  );
  const returned = applyDrugConsumableSupervisionCommand(
    reviewed.record,
    command("drug-return-001", ACTIONS.COMMITTEE_RETURN, 2, ACTORS.committee, {
      reason: "剂量依据不足"
    })
  );
  const resubmitted = applyDrugConsumableSupervisionCommand(
    returned.record,
    command("drug-resubmit-001", ACTIONS.SUBMIT_REVIEW, 3, ACTORS.doctor, {
      note: "补充剂量依据后重新提交"
    })
  );

  assert.equal(returned.record.decisionStatus, DECISION_STATUSES.COMMITTEE_RETURNED);
  assert.equal(resubmitted.record.decisionStatus, DECISION_STATUSES.REVIEW_SUBMITTED);
  assert.equal(resubmitted.record.domainVersion, 4);
  assert.equal(resubmitted.record.decisionHistory.length, 4);
});

test("same command payload replays without advancing version or history", () => {
  const firstCommand = command(
    "drug-idempotent-001",
    ACTIONS.SUBMIT_REVIEW,
    0,
    ACTORS.doctor,
    { evidenceRef: "object://drug/review-001", note: "提交审方" }
  );
  const first = applyDrugConsumableSupervisionCommand(record(), firstCommand);
  const replay = applyDrugConsumableSupervisionCommand(first.record, {
    ...firstCommand,
    occurredAt: "2026-08-21T10:00:00.000Z",
    payload: { note: "提交审方", evidenceRef: "object://drug/review-001" }
  });

  assert.equal(replay.replayed, true);
  assert.equal(replay.record.domainVersion, 1);
  assert.equal(replay.record.decisionHistory.length, 1);
  assert.deepEqual(replay.record, first.record);
  assert.deepEqual(replay.decision, first.decision);
});

test("command id reuse with different intent fails before CAS", () => {
  const first = applyDrugConsumableSupervisionCommand(
    record(),
    command("drug-idempotent-conflict-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor, {
      note: "首次提交"
    })
  );

  assertCode(
    () => applyDrugConsumableSupervisionCommand(first.record, {
      ...command("drug-idempotent-conflict-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor),
      payload: { note: "相同 commandId 的不同载荷" }
    }),
    "DRUG_SUPERVISION_IDEMPOTENCY_CONFLICT",
    409
  );
  assert.equal(first.record.domainVersion, 1);
  assert.equal(first.record.decisionHistory.length, 1);
});

test("domain version CAS rejects stale writes without mutating the aggregate", () => {
  const current = record({
    domainVersion: 2,
    decisionStatus: DECISION_STATUSES.PHARMACIST_REVIEWED,
    decisionHistory: [
      { action: ACTIONS.SUBMIT_REVIEW, actor: ACTORS.doctor },
      { action: ACTIONS.PHARMACIST_REVIEW, actor: ACTORS.pharmacist }
    ]
  });
  const before = structuredClone(current);

  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      current,
      command("drug-stale-001", ACTIONS.COMMITTEE_CONFIRM, 1, ACTORS.committee)
    ),
    "DRUG_SUPERVISION_VERSION_CONFLICT",
    409
  );
  assert.deepEqual(current, before);
});

test("role, organization and region scopes fail closed with stable codes", () => {
  const source = record();
  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      source,
      command("drug-role-denied-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.pharmacist)
    ),
    "DRUG_SUPERVISION_ROLE_DENIED",
    403
  );
  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      source,
      command("drug-org-denied-001", ACTIONS.SUBMIT_REVIEW, 99, {
        ...ACTORS.doctor,
        orgCode: "HOSP-B"
      })
    ),
    "DRUG_SUPERVISION_ORG_SCOPE_DENIED",
    403
  );
  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      source,
      command("drug-region-denied-001", ACTIONS.SUBMIT_REVIEW, 0, {
        ...ACTORS.doctor,
        regionCode: "REGION-B"
      })
    ),
    "DRUG_SUPERVISION_REGION_SCOPE_DENIED",
    403
  );
});

test("identity, idempotency and scope fields reject overlength values without truncation", () => {
  const cases = [
    {
      code: "DRUG_SUPERVISION_RECORD_ID_TOO_LONG",
      record: record({ id: "r".repeat(201) }),
      command: command("drug-overlength-record-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
    },
    {
      code: "DRUG_SUPERVISION_COMMAND_ID_TOO_LONG",
      record: record(),
      command: command("c".repeat(161), ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
    },
    {
      code: "DRUG_SUPERVISION_COMMAND_RECORD_ID_TOO_LONG",
      record: record(),
      command: {
        ...command("drug-overlength-command-record-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor),
        recordId: "r".repeat(201)
      }
    },
    {
      code: "DRUG_SUPERVISION_ACTOR_ID_TOO_LONG",
      record: record(),
      command: command("drug-overlength-actor-001", ACTIONS.SUBMIT_REVIEW, 0, {
        ...ACTORS.doctor,
        id: "a".repeat(161)
      })
    },
    {
      code: "DRUG_SUPERVISION_ACTOR_ORG_CODE_TOO_LONG",
      record: record(),
      command: command("drug-overlength-org-001", ACTIONS.SUBMIT_REVIEW, 0, {
        ...ACTORS.doctor,
        orgCode: "o".repeat(161)
      })
    },
    {
      code: "DRUG_SUPERVISION_ACTOR_REGION_CODE_TOO_LONG",
      record: record(),
      command: command("drug-overlength-region-001", ACTIONS.SUBMIT_REVIEW, 0, {
        ...ACTORS.doctor,
        regionCode: "g".repeat(161)
      })
    },
    {
      code: "DRUG_SUPERVISION_RECORD_ORG_CODE_TOO_LONG",
      record: record({ orgCode: "o".repeat(161) }),
      command: command("drug-overlength-resource-org-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
    },
    {
      code: "DRUG_SUPERVISION_RECORD_REGION_CODE_TOO_LONG",
      record: record({ regionCode: "g".repeat(161) }),
      command: command("drug-overlength-resource-region-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
    },
    {
      code: "DRUG_SUPERVISION_NOTE_TOO_LONG",
      record: record(),
      command: command("drug-overlength-note-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor, {
        note: "n".repeat(501)
      })
    }
  ];

  for (const item of cases) {
    assertCode(
      () => applyDrugConsumableSupervisionCommand(item.record, item.command),
      item.code,
      400
    );
  }
});

test("each decision round enforces actor separation of duties", () => {
  const sharedSubmitterId = {
    ...ACTORS.pharmacist,
    id: ACTORS.doctor.id
  };
  const submitted = applyDrugConsumableSupervisionCommand(
    record(),
    command("drug-sod-submit-001", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
  );
  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      submitted.record,
      command("drug-sod-pharmacist-denied-001", ACTIONS.PHARMACIST_REVIEW, 99, sharedSubmitterId)
    ),
    "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_DENIED",
    403
  );

  const reviewed = applyDrugConsumableSupervisionCommand(
    submitted.record,
    command("drug-sod-pharmacist-001", ACTIONS.PHARMACIST_REVIEW, 1, ACTORS.pharmacist)
  );
  for (const id of [ACTORS.doctor.id, ACTORS.pharmacist.id]) {
    assertCode(
      () => applyDrugConsumableSupervisionCommand(
        reviewed.record,
        command("drug-sod-committee-denied-001", ACTIONS.COMMITTEE_CONFIRM, 2, {
          ...ACTORS.committee,
          id
        })
      ),
      "DRUG_SUPERVISION_SEPARATION_OF_DUTIES_DENIED",
      403
    );
  }
});

test("separation of duties uses the most recent resubmission round", () => {
  const firstSubmitted = applyDrugConsumableSupervisionCommand(
    record(),
    command("drug-sod-round1-submit", ACTIONS.SUBMIT_REVIEW, 0, ACTORS.doctor)
  );
  const firstReviewed = applyDrugConsumableSupervisionCommand(
    firstSubmitted.record,
    command("drug-sod-round1-review", ACTIONS.PHARMACIST_REVIEW, 1, ACTORS.pharmacist)
  );
  const returned = applyDrugConsumableSupervisionCommand(
    firstReviewed.record,
    command("drug-sod-round1-return", ACTIONS.COMMITTEE_RETURN, 2, ACTORS.committee)
  );
  const secondDoctor = { ...ACTORS.doctor, id: "doctor-002" };
  const resubmitted = applyDrugConsumableSupervisionCommand(
    returned.record,
    command("drug-sod-round2-submit", ACTIONS.SUBMIT_REVIEW, 3, secondDoctor)
  );
  const priorRoundSubmitterAsPharmacist = {
    ...ACTORS.pharmacist,
    id: ACTORS.doctor.id
  };
  const secondReviewed = applyDrugConsumableSupervisionCommand(
    resubmitted.record,
    command("drug-sod-round2-review", ACTIONS.PHARMACIST_REVIEW, 4, priorRoundSubmitterAsPharmacist)
  );
  const confirmed = applyDrugConsumableSupervisionCommand(
    secondReviewed.record,
    command("drug-sod-round2-confirm", ACTIONS.COMMITTEE_CONFIRM, 5, ACTORS.committee)
  );

  assert.equal(confirmed.record.decisionStatus, DECISION_STATUSES.COMMITTEE_CONFIRMED);
  assert.equal(confirmed.record.domainVersion, 6);
});

test("invalid transitions expose a stable error and keep decision history append-only", () => {
  const existingDecision = Object.freeze({
    commandId: "legacy-decision-001",
    action: ACTIONS.COMMITTEE_RETURN,
    fromStatus: DECISION_STATUSES.PHARMACIST_REVIEWED,
    toStatus: DECISION_STATUSES.COMMITTEE_RETURNED,
    resultingDomainVersion: 3
  });
  const returned = record({
    domainVersion: 3,
    decisionStatus: DECISION_STATUSES.COMMITTEE_RETURNED,
    decisionHistory: [existingDecision]
  });
  const resubmitted = applyDrugConsumableSupervisionCommand(
    returned,
    command("drug-append-only-001", ACTIONS.SUBMIT_REVIEW, 3, ACTORS.doctor)
  );

  assert.deepEqual(resubmitted.record.decisionHistory[0], existingDecision);
  assert.equal(resubmitted.record.decisionHistory.length, 2);
  assert.equal(returned.decisionHistory.length, 1);
  assertCode(
    () => applyDrugConsumableSupervisionCommand(
      record(),
      command("drug-invalid-transition-001", ACTIONS.COMMITTEE_CONFIRM, 0, ACTORS.committee)
    ),
    "DRUG_SUPERVISION_INVALID_TRANSITION",
    409
  );
});
