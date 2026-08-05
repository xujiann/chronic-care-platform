"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DictionaryLifecycleError,
  applyDictionaryLifecycleCommand,
  assertLedger,
  createDictionaryLifecycleLedger,
  projectDictionaryLifecycle
} = require("../public-health-direct-report-dictionary-lifecycle");
const {
  buildDictionary
} = require("./support/public-health-direct-report-control-fixture");
const {
  sha256
} = require("../public-health-direct-report-control-package");

const PROPOSER = { id: "dictionary-owner-01", role: "data-governance" };
const REVIEWER = { id: "cdc-reviewer-01", role: "disease-control-office" };
const OPERATOR = { id: "platform-operator-01", role: "platform-operations" };
const DIGEST = sha256("synthetic-evidence");

function candidateDictionary() {
  const dictionary = structuredClone(buildDictionary());
  dictionary.version = "2026.08.06-joint-test";
  dictionary.effectiveAt = "2026-08-06T00:00:00.000Z";
  dictionary.expiresAt = "2026-09-15T00:00:00.000Z";
  dictionary.sourceRef = "cmdb://public-health/direct-report/dictionary/2026.08.06";
  const disease = dictionary.codeSystems.find((item) => item.id === "disease");
  disease.version = "synthetic-2026.08.06";
  disease.digest = sha256("synthetic-code-system:disease:v2");
  disease.codes.push("A16");
  return dictionary;
}

function createLedger() {
  return createDictionaryLifecycleLedger(buildDictionary(), {
    ledgerId: "synthetic-direct-report-dictionary-ledger",
    actor: OPERATOR,
    now: "2026-08-05T08:00:00.000Z"
  });
}

function propose(state, overrides = {}) {
  return applyDictionaryLifecycleCommand(state, {
    action: "propose",
    expectedVersion: overrides.expectedVersion ?? state.version,
    idempotencyKey: overrides.idempotencyKey || "dictionary-proposal-01",
    actor: overrides.actor || PROPOSER,
    payload: {
      proposalId: overrides.proposalId || "dictionary-proposal-01",
      dictionary: overrides.dictionary || candidateDictionary(),
      reason: "synthetic dictionary lifecycle validation",
      evidenceRef: "evidence://public-health/direct-report/dictionary/proposal-01",
      evidenceDigest: DIGEST
    }
  }, {
    activeDictionary: buildDictionary(),
    now: overrides.now || "2026-08-05T08:05:00.000Z"
  });
}

function review(state, decision = "approve", actor = REVIEWER) {
  return applyDictionaryLifecycleCommand(state, {
    action: "review",
    expectedVersion: state.version,
    idempotencyKey: `dictionary-review-${decision}-${state.version}`,
    actor,
    payload: {
      decision,
      evidenceRef: `evidence://public-health/direct-report/dictionary/review-${decision}`,
      evidenceDigest: DIGEST
    }
  }, { now: "2026-08-05T08:10:00.000Z" });
}

function activate(state) {
  return applyDictionaryLifecycleCommand(state, {
    action: "activate",
    expectedVersion: state.version,
    idempotencyKey: "dictionary-activate-01",
    actor: OPERATOR,
    payload: {
      evidenceRef: "evidence://public-health/direct-report/dictionary/activation-01",
      evidenceDigest: DIGEST
    }
  }, { now: "2026-08-06T00:05:00.000Z" });
}

test("candidate proposal produces a code-value-free version and mapping diff", () => {
  const proposed = propose(createLedger());
  assert.equal(proposed.state.candidate.status, "pending-review");
  assert.equal(proposed.state.candidate.diff.mappingChanged, true);
  assert.deepEqual(proposed.state.candidate.diff.changedCodeSystems, ["disease"]);
  const projection = projectDictionaryLifecycle(proposed.state);
  assert.equal(projection.productionReady, false);
  assert.equal(projection.candidate.diff.codeValuesExposed, false);
  assert.doesNotMatch(JSON.stringify(projection), /A15|A16|publicKeyPem|signature|privateKey/i);
});

test("four-eyes review and effective time are mandatory before activation", () => {
  const proposed = propose(createLedger()).state;
  assert.throws(
    () => review(proposed, "approve", {
      id: PROPOSER.id,
      role: "disease-control-office"
    }),
    (error) => error instanceof DictionaryLifecycleError
      && error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_REVIEW_NOT_INDEPENDENT"
  );
  const approved = review(proposed).state;
  assert.equal(approved.candidate.status, "approved");
  assert.throws(
    () => applyDictionaryLifecycleCommand(approved, {
      action: "activate",
      expectedVersion: approved.version,
      idempotencyKey: "activate-too-early",
      actor: OPERATOR,
      payload: {
        evidenceRef: "evidence://public-health/direct-report/dictionary/activation-early",
        evidenceDigest: DIGEST
      }
    }, { now: "2026-08-05T23:59:59.000Z" }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ACTIVATION_TOO_EARLY"
  );
  const activated = activate(approved).state;
  assert.equal(activated.active.dictionaryVersion, "2026.08.06-joint-test");
  assert.equal(activated.previousActive.dictionaryVersion, "2026.08.05-joint-test");
  assert.equal(projectDictionaryLifecycle(activated).productionReady, false);
});

test("commands enforce optimistic version and exact idempotent replay", () => {
  const ledger = createLedger();
  const first = propose(ledger);
  const replay = propose(first.state, { expectedVersion: 1 });
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.receipt, first.receipt);
  assert.throws(
    () => propose(first.state, {
      idempotencyKey: "dictionary-proposal-01",
      proposalId: "different-proposal",
      expectedVersion: 1
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_IDEMPOTENCY_CONFLICT"
  );
  assert.throws(
    () => applyDictionaryLifecycleCommand(first.state, {
      action: "review",
      expectedVersion: 1,
      idempotencyKey: "stale-review",
      actor: REVIEWER,
      payload: {
        decision: "approve",
        evidenceRef: "evidence://public-health/direct-report/dictionary/stale-review",
        evidenceDigest: DIGEST
      }
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_VERSION_CONFLICT"
  );
});

test("action roles cannot bypass dictionary governance", () => {
  const ledger = createLedger();
  assert.throws(
    () => propose(ledger, {
      actor: { id: "unauthorized-actor", role: "platform-operations" }
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_ROLE_FORBIDDEN"
  );
  const proposed = propose(ledger).state;
  assert.throws(
    () => review(proposed, "approve", { id: "wrong-reviewer", role: "data-governance" }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_ROLE_FORBIDDEN"
  );
});

test("rejected candidates can be superseded without bypassing review", () => {
  const rejected = review(propose(createLedger()).state, "reject").state;
  assert.equal(rejected.candidate.status, "rejected");
  const replacement = propose(rejected, {
    idempotencyKey: "dictionary-proposal-02",
    proposalId: "dictionary-proposal-02"
  }).state;
  assert.equal(replacement.candidate.proposalId, "dictionary-proposal-02");
  assert.equal(replacement.candidate.status, "pending-review");
});

test("rollback requires an independent request review and explicit execution evidence", () => {
  const activated = activate(review(propose(createLedger()).state).state).state;
  const requested = applyDictionaryLifecycleCommand(activated, {
    action: "request-rollback",
    expectedVersion: activated.version,
    idempotencyKey: "rollback-request-01",
    actor: OPERATOR,
    payload: {
      requestId: "rollback-request-01",
      reason: "synthetic regression",
      evidenceRef: "evidence://public-health/direct-report/dictionary/rollback-request",
      evidenceDigest: DIGEST
    }
  }, { now: "2026-08-06T00:10:00.000Z" }).state;
  assert.throws(
    () => applyDictionaryLifecycleCommand(requested, {
      action: "review-rollback",
      expectedVersion: requested.version,
      idempotencyKey: "rollback-self-review",
      actor: { id: OPERATOR.id, role: "disease-control-office" },
      payload: {
        decision: "approve",
        evidenceRef: "evidence://public-health/direct-report/dictionary/rollback-self-review",
        evidenceDigest: DIGEST
      }
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_ROLLBACK_REVIEW_NOT_INDEPENDENT"
  );
  const approved = applyDictionaryLifecycleCommand(requested, {
    action: "review-rollback",
    expectedVersion: requested.version,
    idempotencyKey: "rollback-review-01",
    actor: REVIEWER,
    payload: {
      decision: "approve",
      evidenceRef: "evidence://public-health/direct-report/dictionary/rollback-review",
      evidenceDigest: DIGEST
    }
  }, { now: "2026-08-06T00:15:00.000Z" }).state;
  const rolledBack = applyDictionaryLifecycleCommand(approved, {
    action: "execute-rollback",
    expectedVersion: approved.version,
    idempotencyKey: "rollback-execute-01",
    actor: OPERATOR,
    payload: {
      evidenceRef: "evidence://public-health/direct-report/dictionary/rollback-execution",
      evidenceDigest: DIGEST
    }
  }, { now: "2026-08-06T00:20:00.000Z" }).state;
  assert.equal(rolledBack.active.dictionaryVersion, "2026.08.05-joint-test");
  assert.equal(rolledBack.previousActive.dictionaryVersion, "2026.08.06-joint-test");
  assert.equal(rolledBack.rollbackRequest, null);
});

test("audit-chain tampering fails closed", () => {
  const state = propose(createLedger()).state;
  const tampered = structuredClone(state);
  tampered.events[1].activeDictionaryDigest = "0".repeat(64);
  assert.throws(
    () => assertLedger(tampered),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_DICTIONARY_LIFECYCLE_CHAIN_INVALID"
  );
});

test("read model reports expiry and activation eligibility without granting production", () => {
  const approved = review(propose(createLedger()).state).state;
  const before = projectDictionaryLifecycle(approved, {
    now: "2026-08-05T12:00:00.000Z"
  });
  const after = projectDictionaryLifecycle(approved, {
    now: "2026-08-06T00:01:00.000Z"
  });
  const expired = projectDictionaryLifecycle(createLedger(), {
    now: "2026-09-02T00:00:00.000Z"
  });
  assert.equal(before.candidate.activationEligible, false);
  assert.equal(after.candidate.activationEligible, true);
  assert.equal(expired.activeValidity, "expired");
  assert.equal(expired.dictionaryLifecycleReady, false);
  assert.equal(after.productionReady, false);
});
