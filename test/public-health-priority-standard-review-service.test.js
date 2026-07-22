const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../data/db.json");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  applyPriorityStandardReviewAction,
  buildPriorityStandardReviewPack,
  runPriorityStandardReviewAcceptanceScenario
} = require("../public-health-priority-standard-review-service");

const ROOT = path.resolve(__dirname, "..");

function artifactAvailability() {
  return Object.fromEntries(
    PRIORITY_STANDARD_REVIEW_TRACKS.flatMap((track) => track.artifactEvidence).map((file) => [file, fs.existsSync(path.join(ROOT, file))])
  );
}

function buildPack() {
  return buildPriorityStandardReviewPack({
    ledger: data.publicHealthStandardImplementationLedger,
    data,
    artifactAvailability: artifactAvailability()
  });
}

function confirmAndReview(initial) {
  let track = applyPriorityStandardReviewAction(initial, {
    action: "confirm-responsibility",
    idempotencyKey: `${initial.id}:test-owner`,
    responsibleOwner: initial.leadOwner,
    collaborators: initial.collaborators,
    note: "责任边界确认"
  }, { name: "业务负责人", role: initial.ownerRole }).track;
  track = applyPriorityStandardReviewAction(track, {
    action: "review-standard-mapping",
    idempotencyKey: `${initial.id}:test-review`,
    reviewedDomainIds: track.domainIds,
    reviewedDataCollections: track.dataCollections,
    reviewedInterfaces: track.interfaces,
    evidenceRefs: track.artifactEvidence,
    note: "标准、数据、接口和制品证据复核完成"
  }, { name: "卫健标准复核员", role: "commission" }).track;
  return track;
}

test("priority standard review pack maps eight business tracks to seven existing standard domains", () => {
  const pack = buildPack();

  assert.equal(pack.tracks.length, 8);
  assert.equal(pack.summary.standardDomains, 7);
  assert.equal(pack.summary.mappingReady, 8);
  assert.equal(pack.summary.mappingReviewed, 0);
  assert.equal(pack.status, "ready-for-owner-review");
  assert.equal(pack.productionReady, false);
  assert.equal(pack.tracks.every((track) => track.leadOwner && track.ownerRole && track.collaborators.length), true);
  assert.equal(pack.tracks.every((track) => track.mappingReady && !track.missingDomainIds.length && !track.missingDataCollections.length && !track.missingArtifacts.length), true);

  const followup = pack.tracks.find((track) => track.id === "phpsr-public-health-followup");
  const familyDoctor = pack.tracks.find((track) => track.id === "phpsr-family-doctor");
  assert.deepEqual(followup.domainIds, ["ph-chronic", "ph-archive"]);
  assert.deepEqual(familyDoctor.domainIds, ["ph-chronic", "ph-archive"]);
});

test("priority standard review acceptance reviews all mappings but keeps site evidence blocked", () => {
  const reviewed = runPriorityStandardReviewAcceptanceScenario(buildPack());

  assert.equal(reviewed.status, "mapping-reviewed-site-evidence-pending");
  assert.equal(reviewed.summary.mappingReviewed, 8);
  assert.equal(reviewed.summary.siteEvidencePending, 8);
  assert.equal(reviewed.summary.formallyAccepted, 0);
  assert.equal(reviewed.productionReady, false);
  assert.equal(reviewed.tracks.every((track) => track.state === "mapping-reviewed"), true);
  assert.equal(reviewed.tracks.every((track) => track.ownerConfirmation?.responsibleOwner && track.mappingReview?.evidenceRefs.length), true);
  assert.equal(reviewed.tracks.every((track) => track.timeline[0].role === track.ownerRole), true);
});

test("standard mapping review rejects incomplete domain, data, interface or evidence attestations", () => {
  const initial = buildPack().tracks[0];
  let track = applyPriorityStandardReviewAction(initial, {
    action: "confirm-responsibility",
    idempotencyKey: "incomplete-owner",
    responsibleOwner: initial.leadOwner,
    collaborators: initial.collaborators,
    note: "责任确认"
  }, { name: "业务负责人", role: initial.ownerRole }).track;

  assert.throws(
    () => applyPriorityStandardReviewAction(track, {
      action: "review-standard-mapping",
      idempotencyKey: "incomplete-review-domain",
      reviewedDomainIds: [],
      reviewedDataCollections: track.dataCollections,
      reviewedInterfaces: track.interfaces,
      evidenceRefs: track.artifactEvidence,
      note: "错误复核"
    }, { name: "标准复核员", role: "commission" }),
    /reviewedDomainIds must exactly match/
  );
  assert.throws(
    () => applyPriorityStandardReviewAction(track, {
      action: "review-standard-mapping",
      idempotencyKey: "incomplete-review-evidence",
      reviewedDomainIds: track.domainIds,
      reviewedDataCollections: track.dataCollections,
      reviewedInterfaces: track.interfaces,
      evidenceRefs: [],
      note: "错误复核"
    }, { name: "标准复核员", role: "commission" }),
    /evidenceRefs must exactly match/
  );
});

test("verified signed site evidence is required for formal track acceptance", () => {
  const reviewed = confirmAndReview(buildPack().tracks[0]);
  assert.throws(
    () => applyPriorityStandardReviewAction(reviewed, {
      action: "link-site-evidence",
      idempotencyKey: "site-invalid",
      siteEvidence: { id: "site-1", status: "recorded", artifactName: "联调记录.pdf" }
    }, { name: "疾控复核员", role: "cdc" }),
    /verified site evidence/
  );

  const accepted = applyPriorityStandardReviewAction(reviewed, {
    action: "link-site-evidence",
    idempotencyKey: "site-valid",
    siteEvidence: { id: "site-1", status: "verified", artifactName: "传染病直报联调签字记录.pdf", signedBy: "疾控中心/医院信息科" },
    note: "现场证据核验通过"
  }, { name: "疾控复核员", role: "cdc" }).track;
  assert.equal(accepted.state, "site-evidence-linked");
  assert.equal(accepted.formallyAccepted, true);
});

test("priority standard review enforces role, idempotency and version boundaries", () => {
  const initial = buildPack().tracks[0];
  const payload = {
    action: "confirm-responsibility",
    idempotencyKey: "guard-owner",
    responsibleOwner: initial.leadOwner,
    collaborators: initial.collaborators,
    note: "责任确认"
  };
  assert.throws(
    () => applyPriorityStandardReviewAction(initial, payload, { name: "居民", role: "citizen" }),
    /role citizen is not allowed/
  );
  assert.throws(
    () => applyPriorityStandardReviewAction(initial, payload, { name: "医院联系人", role: "institution" }),
    /cannot confirm responsibility for ownerRole cdc/
  );
  assert.throws(
    () => applyPriorityStandardReviewAction(initial, { ...payload, expectedVersion: 0 }, { name: "业务负责人", role: initial.ownerRole }),
    /version conflict/
  );

  const first = applyPriorityStandardReviewAction(initial, payload, { name: "业务负责人", role: initial.ownerRole });
  const duplicate = applyPriorityStandardReviewAction(first.track, payload, { name: "业务负责人", role: initial.ownerRole });
  assert.equal(duplicate.idempotent, true);
  assert.equal(duplicate.track.timeline.length, first.track.timeline.length);
  assert.throws(
    () => applyPriorityStandardReviewAction(first.track, payload, { name: "居民", role: "citizen" }),
    /role citizen is not allowed/
  );
});
