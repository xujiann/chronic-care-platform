const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../data/db.json");
const {
  PRIORITY_STANDARD_REVIEW_TRACKS,
  applyPriorityStandardReviewAction,
  buildPriorityStandardReviewPack,
  runPriorityStandardReviewAcceptanceScenario,
  summarizePack
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

test("trusted server evidence registry is required for formal track acceptance", () => {
  const reviewed = confirmAndReview(buildPack().tracks[0]);
  assert.throws(
    () => applyPriorityStandardReviewAction(reviewed, {
      action: "link-site-evidence",
      idempotencyKey: "site-invalid",
      siteEvidence: { id: "site-1", status: "recorded", artifactName: "联调记录.pdf" }
    }, { name: "疾控复核员", role: "cdc" }),
    /site evidence material/
  );

  const claimed = applyPriorityStandardReviewAction(reviewed, {
    action: "link-site-evidence",
    idempotencyKey: "site-claimed",
    siteEvidence: {
      id: "site-1",
      status: "verified",
      artifactName: "传染病直报联调签字记录.pdf",
      signedBy: "疾控中心/医院信息科",
      signatureVerified: true,
      verificationSource: "server-evidence-store",
      artifactDigest: "f".repeat(64)
    },
    note: "客户端声明现场材料已核验"
  }, { name: "疾控复核员", role: "cdc" }).track;
  assert.equal(claimed.state, "site-evidence-linked");
  assert.equal(claimed.siteEvidence.claimedStatus, "verified");
  assert.equal(claimed.siteEvidence.trustStatus, "pending-server-verification");
  assert.equal(claimed.formallyAccepted, false);

  const accepted = applyPriorityStandardReviewAction(claimed, {
    action: "link-site-evidence",
    idempotencyKey: "site-server-verified",
    siteEvidence: { id: "site-1", status: "verified", artifactName: "传染病直报联调签字记录.pdf", signedBy: "疾控中心/医院信息科" },
    note: "使用服务端可信证据仓结果复核"
  }, { name: "疾控复核员", role: "cdc" }, {
    trustedSiteEvidenceRegistry: [{
      id: "site-1",
      status: "verified",
      artifactName: "传染病直报联调签字记录.pdf",
      signedBy: "疾控中心/医院信息科",
      signatureVerified: true,
      verificationSource: "server-evidence-store",
      artifactDigest: "a".repeat(64),
      verifiedBy: "现场证据服务",
      verifiedAt: "2026-07-22T08:00:00.000Z"
    }]
  }).track;
  assert.equal(accepted.formallyAccepted, true);
  assert.equal(accepted.siteEvidence.trustStatus, "trusted-verified");
  assert.equal(accepted.siteEvidence.verification.artifactDigest, "a".repeat(64));
});

test("forged verified and signedBy evidence cannot make the review pack production ready", () => {
  const reviewed = runPriorityStandardReviewAcceptanceScenario(buildPack());
  const forgedTracks = reviewed.tracks.map((track) => applyPriorityStandardReviewAction(track, {
    action: "link-site-evidence",
    idempotencyKey: `${track.id}:forged-site-evidence`,
    siteEvidence: {
      id: `${track.id}-site-evidence`,
      status: "verified",
      artifactName: `${track.name}签字记录.pdf`,
      signedBy: "客户端自报签字人",
      signatureVerified: true,
      verificationSource: "server-evidence-store",
      artifactDigest: "b".repeat(64),
      verifiedBy: "伪造核验服务"
    },
    note: "伪造 verified 和 signedBy 字段"
  }, { name: "客户端复核员", role: "cdc" }).track);
  const forgedPack = summarizePack(forgedTracks.map((track) => ({ ...track, formallyAccepted: true })));

  assert.equal(forgedPack.summary.siteEvidenceRegistered, 8);
  assert.equal(forgedPack.summary.trustedEvidenceVerified, 0);
  assert.equal(forgedPack.summary.formallyAccepted, 0);
  assert.equal(forgedPack.summary.productionBlockers, 8);
  assert.equal(forgedPack.status, "site-evidence-registered-trust-pending");
  assert.equal(forgedPack.productionReady, false);
  assert.equal(forgedPack.productionBlockers.every((item) => item.status === "evidence-registered-trust-pending"), true);
});

test("all eight server-verified evidence records are required to clear the scoped production gate", () => {
  const reviewed = runPriorityStandardReviewAcceptanceScenario(buildPack());
  const trustedSiteEvidenceRegistry = reviewed.tracks.map((track, index) => ({
    id: `${track.id}-trusted-evidence`,
    status: "verified",
    artifactName: `${track.name}现场签字记录.pdf`,
    signedBy: track.leadOwner,
    signatureVerified: true,
    verificationSource: index % 2 ? "trusted-signature-service" : "server-evidence-store",
    artifactDigest: String(index + 1).repeat(64),
    verifiedBy: "公共卫生现场证据核验服务",
    verifiedAt: "2026-07-22T09:00:00.000Z"
  }));
  const acceptedTracks = reviewed.tracks.map((track) => applyPriorityStandardReviewAction(track, {
    action: "link-site-evidence",
    idempotencyKey: `${track.id}:trusted-site-evidence`,
    siteEvidence: {
      id: `${track.id}-trusted-evidence`,
      status: "verified",
      artifactName: `${track.name}现场签字记录.pdf`,
      signedBy: track.leadOwner
    },
    note: "关联服务端可信现场证据"
  }, { name: "标准复核员", role: "commission" }, { trustedSiteEvidenceRegistry }).track);
  const persistedOnlyPack = summarizePack(acceptedTracks);
  assert.equal(persistedOnlyPack.productionReady, false);
  assert.equal(persistedOnlyPack.summary.trustedEvidenceVerified, 0);

  const trustedPack = summarizePack(acceptedTracks, { trustedSiteEvidenceRegistry });

  assert.equal(trustedPack.summary.trustedEvidenceVerified, 8);
  assert.equal(trustedPack.summary.productionBlockers, 0);
  assert.deepEqual(trustedPack.productionBlockers, []);
  assert.equal(trustedPack.status, "trusted-site-evidence-verified");
  assert.equal(trustedPack.productionReady, true);
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
