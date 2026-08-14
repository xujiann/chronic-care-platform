"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyEvidenceLifecycleTransitionPlan,
  applyEvidenceLifecycleTransitionPlanToRegistry,
  buildEvidenceLifecycleTransitionPlan,
  createEmptyEvidenceLifecycleRegistry,
  getLifecycleChain,
  lifecycleEnvironmentKeys,
  readEvidenceLifecycleRegistryFile,
  summarizeEvidenceLifecycle,
  verifyEvidenceLifecycleRegistry
} = require("../src/platform/regional/regional-site-evidence-lifecycle");
const { sha256 } = require("../src/platform/regional/region-manifest");
const {
  parseArgs,
  runCli
} = require("../scripts/regional-site-evidence-lifecycle");

const SHA = Object.freeze({
  composite: `sha256:${"a".repeat(64)}`,
  regional: `sha256:${"b".repeat(64)}`,
  evidence1: `sha256:${"c".repeat(64)}`,
  evidence2: `sha256:${"d".repeat(64)}`,
  evidence3: `sha256:${"e".repeat(64)}`,
  custodian: `sha256:${"1".repeat(64)}`,
  reviewer: `sha256:${"2".repeat(64)}`,
  authority: `sha256:${"3".repeat(64)}`,
  otherReviewer: `sha256:${"4".repeat(64)}`
});
const BINDING = Object.freeze({
  regionCode: "210200",
  releaseId: "regional-release-1",
  compositeDigest: SHA.composite,
  regionalContentDigest: SHA.regional
});

function apply(registry, action, actorDigest, minute, extra = {}) {
  const plan = buildEvidenceLifecycleTransitionPlan(registry, {
    binding: BINDING,
    action,
    actorDigest,
    reasonCode: `${action}-evidence-test`,
    recordedAt: `2026-08-14T08:${String(minute).padStart(2, "0")}:00.000Z`,
    ...extra
  });
  return applyEvidenceLifecycleTransitionPlanToRegistry(registry, plan).registry;
}

function acceptedRegistry(evidenceSourceDigest = SHA.evidence1) {
  let registry = createEmptyEvidenceLifecycleRegistry();
  registry = apply(registry, "submit", SHA.custodian, 1, { evidenceSourceDigest });
  registry = apply(registry, "review", SHA.reviewer, 2);
  registry = apply(registry, "accept", SHA.authority, 3);
  return registry;
}

test("submit, independent review and authority acceptance form an append-only accepted chain", () => {
  const registry = acceptedRegistry();
  const verification = verifyEvidenceLifecycleRegistry(registry);
  const status = summarizeEvidenceLifecycle(registry, {
    ...BINDING,
    evidenceSourceDigest: SHA.evidence1
  });
  assert.equal(verification.ok, true);
  assert.equal(verification.eventCount, 3);
  assert.equal(status.accepted, true);
  assert.equal(status.state, "accepted");
  assert.equal(status.revision, 1);
  assert.equal(status.productionReady, false);
  assert.equal(status.containsActorIdentities, false);
  assert.deepEqual(status.blockers, []);
  const serialized = JSON.stringify(status);
  assert.doesNotMatch(serialized, /11111111|22222222|33333333/);
  assert.ok(registry.events.every((row, index) => index === 0 || row.previousEventDigest === registry.events[index - 1].eventDigest));
  const future = summarizeEvidenceLifecycle(registry, {
    ...BINDING,
    evidenceSourceDigest: SHA.evidence1,
    generatedAt: "2026-08-14T08:02:30.000Z"
  });
  assert.equal(future.accepted, false);
  assert.ok(future.blockers.includes("regional-site-evidence-lifecycle-event-in-future"));
});

test("returned evidence must be resubmitted as a new digest and incremented revision", () => {
  let registry = createEmptyEvidenceLifecycleRegistry();
  registry = apply(registry, "submit", SHA.custodian, 1, { evidenceSourceDigest: SHA.evidence1 });
  assert.throws(
    () => apply(registry, "review", SHA.custodian, 2),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REVIEW_NOT_INDEPENDENT"
  );
  registry = apply(registry, "review", SHA.reviewer, 2);
  assert.throws(
    () => apply(registry, "return", SHA.otherReviewer, 3),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REVIEWER_DRIFT"
  );
  registry = apply(registry, "return", SHA.reviewer, 3);
  assert.throws(
    () => apply(registry, "submit", SHA.custodian, 4, { evidenceSourceDigest: SHA.evidence1 }),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_VERSION_CHAIN_INVALID"
  );
  registry = apply(registry, "submit", SHA.custodian, 4, { evidenceSourceDigest: SHA.evidence2 });
  const chain = getLifecycleChain(registry, BINDING.regionCode, BINDING.releaseId);
  assert.equal(chain.state, "submitted");
  assert.equal(chain.revision, 2);
  assert.equal(chain.predecessorEvidenceSourceDigest, SHA.evidence1);
  assert.equal(chain.evidenceSourceDigest, SHA.evidence2);
});

test("acceptance is three-party, while revoke and supersede keep replacement history explicit", () => {
  let registry = createEmptyEvidenceLifecycleRegistry();
  registry = apply(registry, "submit", SHA.custodian, 1, { evidenceSourceDigest: SHA.evidence1 });
  registry = apply(registry, "review", SHA.reviewer, 2);
  assert.throws(
    () => apply(registry, "accept", SHA.reviewer, 3),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_ACCEPTANCE_NOT_INDEPENDENT"
  );
  registry = apply(registry, "accept", SHA.authority, 3);
  registry = apply(registry, "supersede", SHA.authority, 4, { replacementEvidenceSourceDigest: SHA.evidence2 });
  assert.equal(getLifecycleChain(registry, BINDING.regionCode, BINDING.releaseId).state, "superseded");
  assert.throws(
    () => apply(registry, "submit", SHA.custodian, 5, { evidenceSourceDigest: SHA.evidence3 }),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_VERSION_CHAIN_INVALID"
  );
  registry = apply(registry, "submit", SHA.custodian, 5, { evidenceSourceDigest: SHA.evidence2 });
  registry = apply(registry, "review", SHA.reviewer, 6);
  registry = apply(registry, "accept", SHA.authority, 7);
  registry = apply(registry, "revoke", SHA.authority, 8);
  const status = summarizeEvidenceLifecycle(registry, { ...BINDING, evidenceSourceDigest: SHA.evidence2 });
  assert.equal(status.accepted, false);
  assert.equal(status.state, "revoked");
  assert.ok(status.blockers.includes("regional-site-evidence-lifecycle-revoked"));
});

test("release changes make previous accepted evidence stale instead of reusable", () => {
  const registry = acceptedRegistry();
  const status = summarizeEvidenceLifecycle(registry, {
    ...BINDING,
    releaseId: "regional-release-2",
    compositeDigest: `sha256:${"f".repeat(64)}`,
    evidenceSourceDigest: SHA.evidence1
  });
  assert.equal(status.accepted, false);
  assert.equal(status.state, "stale-release");
  assert.deepEqual(status.blockers, ["regional-site-evidence-lifecycle-release-stale"]);
});

test("tampering and stale or modified plans fail without mutating the registry", () => {
  const empty = createEmptyEvidenceLifecycleRegistry();
  const firstPlan = buildEvidenceLifecycleTransitionPlan(empty, {
    binding: BINDING,
    action: "submit",
    actorDigest: SHA.custodian,
    reasonCode: "submit-evidence-test",
    recordedAt: "2026-08-14T08:01:00.000Z",
    evidenceSourceDigest: SHA.evidence1
  });
  const first = applyEvidenceLifecycleTransitionPlanToRegistry(empty, firstPlan).registry;
  const competingPlan = buildEvidenceLifecycleTransitionPlan(first, {
    binding: BINDING,
    action: "review",
    actorDigest: SHA.reviewer,
    reasonCode: "review-evidence-test",
    recordedAt: "2026-08-14T08:02:00.000Z"
  });
  assert.throws(
    () => applyEvidenceLifecycleTransitionPlanToRegistry(first, firstPlan),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_PLAN_STALE"
  );
  const modified = structuredClone(competingPlan);
  modified.event.reasonCode = "modified-reason";
  assert.throws(
    () => applyEvidenceLifecycleTransitionPlanToRegistry(first, modified),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_PLAN_MODIFIED"
  );
  const tampered = structuredClone(first);
  tampered.events[0].evidenceSourceDigest = SHA.evidence2;
  assert.equal(verifyEvidenceLifecycleRegistry(tampered).ok, false);
  assert.equal(first.events.length, 1);
});

test("runtime file loading is absolute, bounded and SHA-pinned while writer uses CAS and a lock", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-evidence-lifecycle-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "registry.json");
  const empty = createEmptyEvidenceLifecycleRegistry();
  fs.writeFileSync(file, `${JSON.stringify(empty, null, 2)}\n`, "utf8");
  const bytes = fs.readFileSync(file);
  const digest = `sha256:${sha256(bytes)}`;
  assert.equal(readEvidenceLifecycleRegistryFile(file, digest).registry.events.length, 0);
  assert.throws(
    () => readEvidenceLifecycleRegistryFile("relative/registry.json", digest),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_PATH_INVALID"
  );
  assert.throws(
    () => readEvidenceLifecycleRegistryFile(file, SHA.evidence1),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_DIGEST_MISMATCH"
  );
  const plan = buildEvidenceLifecycleTransitionPlan(empty, {
    binding: BINDING,
    action: "submit",
    actorDigest: SHA.custodian,
    reasonCode: "submit-evidence-test",
    recordedAt: "2026-08-14T08:01:00.000Z",
    evidenceSourceDigest: SHA.evidence1
  });
  fs.writeFileSync(`${file}.lock`, "held", "utf8");
  assert.throws(
    () => applyEvidenceLifecycleTransitionPlan(file, plan),
    (error) => error.code === "REGIONAL_SITE_EVIDENCE_LIFECYCLE_LOCKED"
  );
  fs.rmSync(`${file}.lock`);
  const written = applyEvidenceLifecycleTransitionPlan(file, plan);
  assert.equal(written.writes, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).events.length, 1);
  assert.deepEqual(lifecycleEnvironmentKeys(), {
    file: "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_FILE",
    digest: "REGIONAL_SITE_EVIDENCE_LIFECYCLE_REGISTRY_SHA256"
  });
});

test("CLI is strict, preview-only by default and writes only with an explicit flag", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "regional-evidence-lifecycle-cli-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "registry.json");
  const args = [
    "transition",
    `--registry=${file}`,
    "--action=submit",
    `--region=${BINDING.regionCode}`,
    `--release=${BINDING.releaseId}`,
    `--composite-digest=${BINDING.compositeDigest}`,
    `--regional-content-digest=${BINDING.regionalContentDigest}`,
    `--evidence-digest=${SHA.evidence1}`,
    `--actor-digest=${SHA.custodian}`,
    "--reason-code=submit-evidence-test",
    "--recorded-at=2026-08-14T08:01:00.000Z"
  ];
  let output = "";
  const preview = runCli(args, { stdout: { write: (value) => { output += value; } } });
  assert.equal(preview.writes, false);
  assert.equal(fs.existsSync(file), false);
  assert.match(output, /regional-site-evidence-lifecycle-plan-v1/);
  const written = runCli([...args, "--write"], { stdout: { write() {} } });
  assert.equal(written.writes, true);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).events.length, 1);
  assert.deepEqual(parseArgs(["verify", `--registry=${file}`]), {
    command: "verify",
    flags: { registry: file }
  });
  assert.throws(() => parseArgs(["transition", "--unknown=value"]), /unsupported transition flag/);
});
