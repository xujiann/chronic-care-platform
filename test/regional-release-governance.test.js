"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildCompositeRegionalRelease } = require("../src/platform/regional/composite-release");
const {
  applyTransitionPlan,
  applyTransitionPlanToRegistry,
  buildReleaseBindingFromComposite,
  buildRollbackDecision,
  buildTransitionPlan,
  buildVersionDiff,
  createEmptyRegistry,
  findActiveRelease,
  findPreviousStableRelease,
  getReleaseState,
  normalizeReleaseBinding,
  registryDigest,
  summarizeRegistry,
  verifyRegistry
} = require("../src/platform/regional/regional-release-governance");
const {
  parseArgs,
  runCli
} = require("../scripts/regional-release-governance");

const ROOT = path.resolve(__dirname, "..");
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const SHA_E = `sha256:${"e".repeat(64)}`;
const SHA_F = `sha256:${"f".repeat(64)}`;

function release(overrides = {}) {
  return normalizeReleaseBinding({
    regionCode: "210200",
    releaseId: "release-1",
    regionVersion: "1.0.0",
    deploymentClass: "production",
    platform: {
      version: "1.0.0",
      digest: SHA_A
    },
    compositeDigest: SHA_B,
    regionalContentDigest: SHA_C,
    dataImpact: "none",
    rollbackSnapshot: null,
    ...overrides
  });
}

function evidence(overrides = {}) {
  return {
    ref: "controlled://regional/evidence/package-1",
    digest: SHA_D,
    recordedAt: "2026-08-06T01:00:00.000Z",
    recordedBy: "evidence-custodian",
    ...overrides
  };
}

function authorization(overrides = {}) {
  return {
    ref: "controlled://regional/authority/decision-1",
    digest: SHA_E,
    recordedAt: "2026-08-06T02:00:00.000Z",
    recordedBy: "site-authority",
    ...overrides
  };
}

function transitionOptions(targetRelease, toState, sequence, overrides = {}) {
  const minute = String(sequence).padStart(2, "0");
  const base = {
    release: targetRelease,
    toState,
    actor: "release-operator",
    reason: `${targetRelease.releaseId} to ${toState}`,
    recordedAt: `2026-08-06T00:${minute}:00.000Z`
  };
  if (toState === "approved-candidate") {
    base.externalEvidence = evidence();
    base.review = {
      reviewerId: "independent-reviewer",
      reviewedAt: "2026-08-06T01:30:00.000Z"
    };
  }
  if (toState === "deployed") base.externalAuthorization = authorization();
  return { ...base, ...overrides };
}

function advance(registry, targetRelease, toState, sequence, overrides = {}) {
  const plan = buildTransitionPlan(
    registry,
    transitionOptions(targetRelease, toState, sequence, overrides)
  );
  return applyTransitionPlanToRegistry(registry, plan).registry;
}

function advanceToVerified(registry, targetRelease, start = 1) {
  let next = advance(registry, targetRelease, "draft", start);
  next = advance(next, targetRelease, "validation", start + 1);
  next = advance(next, targetRelease, "approved-candidate", start + 2);
  next = advance(next, targetRelease, "deployed", start + 3);
  return advance(next, targetRelease, "verified", start + 4);
}

test("empty governance registry is valid and can never claim production readiness", () => {
  const registry = createEmptyRegistry();
  const verification = verifyRegistry(registry);
  assert.equal(verification.ok, true);
  assert.equal(verification.productionReady, false);
  assert.equal(verification.eventCount, 0);
  assert.match(verification.registryDigest, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(summarizeRegistry(registry), {
    schemaVersion: "regional-release-governance-summary-v1",
    ok: true,
    productionReady: false,
    registryDigest: registryDigest(registry),
    eventCount: 0,
    releases: []
  });
});

test("draft registration immutably binds platform, composite and regional content digests", () => {
  const target = release();
  const plan = buildTransitionPlan(
    createEmptyRegistry(),
    transitionOptions(target, "draft", 1)
  );
  assert.equal(plan.writes, false);
  assert.equal(plan.productionReady, false);
  assert.equal(plan.event.fromState, null);
  assert.equal(plan.event.toState, "draft");
  assert.equal(plan.event.release.platform.digest, SHA_A);
  assert.equal(plan.event.release.compositeDigest, SHA_B);
  const applied = applyTransitionPlanToRegistry(createEmptyRegistry(), plan);
  assert.equal(applied.verification.ok, true);
  assert.equal(getReleaseState(applied.registry, "210200", "release-1"), "draft");

  assert.throws(
    () => buildTransitionPlan(applied.registry, transitionOptions(
      release({ platform: { version: "1.0.0", digest: SHA_F } }),
      "validation",
      2
    )),
    /immutable release identity collision/
  );
  assert.throws(
    () => buildTransitionPlan(applied.registry, transitionOptions(
      release({
        releaseId: "release-2",
        regionVersion: "1.1.0",
        platform: { version: "1.1.0", digest: SHA_D },
        compositeDigest: SHA_B
      }),
      "draft",
      2
    )),
    /composite digest is already bound/
  );
});

test("full release lifecycle records external decisions without authorizing production", () => {
  const target = release();
  let registry = createEmptyRegistry();
  registry = advance(registry, target, "draft", 1);
  registry = advance(registry, target, "validation", 2);
  registry = advance(registry, target, "approved-candidate", 3);
  registry = advance(registry, target, "deployed", 4);
  registry = advance(registry, target, "verified", 5);

  assert.equal(getReleaseState(registry, "210200", "release-1"), "verified");
  assert.equal(registry.productionReady, false);
  assert.equal(registry.events.every((event) => event.productionReady === false), true);
  assert.equal(registry.events[2].externalEvidence.ref, "controlled://regional/evidence/package-1");
  assert.equal(registry.events[2].review.reviewerId, "independent-reviewer");
  assert.equal(registry.events[3].externalAuthorization.ref, "controlled://regional/authority/decision-1");
  assert.equal(verifyRegistry(registry).ok, true);
});

test("illegal lifecycle shortcuts, repeats and terminal transitions are rejected", () => {
  const target = release();
  const empty = createEmptyRegistry();
  assert.throws(
    () => buildTransitionPlan(empty, transitionOptions(target, "validation", 1)),
    /invalid regional release state transition/
  );
  assert.throws(
    () => buildTransitionPlan(empty, transitionOptions(target, "draft", 1, {
      externalEvidence: evidence()
    })),
    /allowed only for approved-candidate/
  );
  let registry = advance(empty, target, "draft", 1);
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 2)),
    /illegal regional release state transition/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "draft", 2)),
    /illegal regional release state transition/
  );
  registry = advance(registry, target, "validation", 2);
  registry = advance(registry, target, "approved-candidate", 3);
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "verified", 4)),
    /illegal regional release state transition/
  );
});

test("approved candidate gate requires controlled evidence and an independent reviewer", () => {
  const target = release();
  let registry = advance(createEmptyRegistry(), target, "draft", 1);
  registry = advance(registry, target, "validation", 2);

  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 3, {
      externalEvidence: null
    })),
    /externalEvidence must be an object/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 3, {
      externalEvidence: evidence({ ref: "https://uncontrolled.example/evidence" })
    })),
    /controlled:\/\/ reference/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 3, {
      externalEvidence: { ...evidence(), rawPayload: "must-not-enter-the-registry" }
    })),
    /must contain only/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 3, {
      review: { reviewerId: "release-operator", reviewedAt: "2026-08-06T01:30:00.000Z" }
    })),
    /independent reviewer/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "approved-candidate", 3, {
      review: { reviewerId: "reviewer", reviewedAt: "not-a-date" }
    })),
    /ISO timestamp/
  );

  const testRelease = release({
    releaseId: "test-release",
    deploymentClass: "test",
    compositeDigest: SHA_D
  });
  let testRegistry = advance(createEmptyRegistry(), testRelease, "draft", 1);
  testRegistry = advance(testRegistry, testRelease, "validation", 2);
  assert.throws(
    () => buildTransitionPlan(
      testRegistry,
      transitionOptions(testRelease, "approved-candidate", 3)
    ),
    /only a production-class/
  );
});

test("deployment records but does not manufacture an external production authorization", () => {
  const target = release();
  let registry = advance(createEmptyRegistry(), target, "draft", 1);
  registry = advance(registry, target, "validation", 2);
  registry = advance(registry, target, "approved-candidate", 3);
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "deployed", 4, {
      externalAuthorization: null
    })),
    /externalAuthorization must be an object/
  );
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(target, "deployed", 4, {
      externalAuthorization: authorization({ recordedBy: "release-operator" })
    })),
    /independent of the deploy actor/
  );
});

test("registry verification deterministically detects chain, payload and boundary tampering", () => {
  const target = release();
  const registry = advance(createEmptyRegistry(), target, "draft", 1);

  const boundaryTampered = structuredClone(registry);
  boundaryTampered.productionReady = true;
  assert.equal(verifyRegistry(boundaryTampered).ok, false);
  assert.equal(
    verifyRegistry(boundaryTampered).checks.find((item) => item.id.endsWith("production-boundary")).passed,
    false
  );

  const payloadTampered = structuredClone(registry);
  payloadTampered.events[0].release.platform.digest = SHA_F;
  const payloadVerification = verifyRegistry(payloadTampered);
  assert.equal(payloadVerification.ok, false);
  assert.match(
    payloadVerification.checks.find((item) => item.id.endsWith("event-1")).detail,
    /identity|digest|normalized/
  );

  const chainTampered = structuredClone(registry);
  chainTampered.events[0].previousEventDigest = SHA_A;
  assert.equal(verifyRegistry(chainTampered).ok, false);

  const shapeTampered = structuredClone(registry);
  delete shapeTampered.events;
  assert.equal(
    verifyRegistry(shapeTampered).checks.find((item) => item.id.endsWith("shape")).passed,
    false
  );
});

test("version diff reports core, regional content and data review changes", () => {
  const first = release();
  const second = release({
    releaseId: "release-2",
    regionVersion: "1.1.0",
    platform: { version: "1.1.0", digest: SHA_D },
    compositeDigest: SHA_E,
    regionalContentDigest: SHA_F,
    dataImpact: "backward-compatible",
    rollbackSnapshot: evidence({
      ref: "controlled://regional/backups/release-2",
      digest: SHA_A
    })
  });
  let registry = advance(createEmptyRegistry(), first, "draft", 1);
  registry = advance(registry, second, "draft", 2);
  const diff = buildVersionDiff(registry, {
    regionCode: "210200",
    fromReleaseId: first.releaseId,
    toReleaseId: second.releaseId
  });
  assert.equal(diff.productionReady, false);
  assert.equal(diff.changed, true);
  assert.equal(diff.applicationChanged, true);
  assert.equal(diff.regionalContentChanged, true);
  assert.equal(diff.dataReviewRequired, true);
  assert.deepEqual(
    diff.changes.map((change) => change.field),
    [
      "platform.version",
      "platform.digest",
      "regionVersion",
      "regionalContentDigest",
      "compositeDigest",
      "dataImpact"
    ]
  );
});

test("rollback selects the previous verified release and separates application and data decisions", () => {
  const first = release();
  const second = release({
    releaseId: "release-2",
    regionVersion: "1.1.0",
    compositeDigest: SHA_D
  });
  let registry = advanceToVerified(createEmptyRegistry(), first, 1);
  registry = advanceToVerified(registry, second, 6);

  assert.equal(findActiveRelease(registry, "210200").releaseId, "release-2");
  assert.equal(findPreviousStableRelease(registry, "210200", "release-2").releaseId, "release-1");
  assert.throws(
    () => buildRollbackDecision(registry, {
      regionCode: "210200",
      releaseId: "release-1"
    }),
    /not the active regional deployment/
  );
  const decision = buildRollbackDecision(registry, {
    regionCode: "210200",
    releaseId: "release-2"
  });
  assert.equal(decision.executable, true);
  assert.equal(decision.application.targetReleaseId, "release-1");
  assert.equal(decision.data.action, "not-required");
  const rollbackPlan = buildTransitionPlan(
    registry,
    transitionOptions(second, "rolled-back", 11)
  );
  registry = applyTransitionPlanToRegistry(registry, rollbackPlan).registry;
  assert.equal(getReleaseState(registry, "210200", "release-2"), "rolled-back");
  assert.equal(findActiveRelease(registry, "210200").releaseId, "release-1");
  assert.equal(registry.events.at(-1).rollback.previousStableReleaseId, "release-1");
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(second, "verified", 12)),
    /illegal regional release state transition/
  );
});

test("data-changing rollback is blocked without controlled snapshot and enabled with one", () => {
  const stable = release();
  const unsafe = release({
    releaseId: "release-unsafe",
    regionVersion: "2.0.0",
    compositeDigest: SHA_D,
    dataImpact: "breaking"
  });
  let registry = advanceToVerified(createEmptyRegistry(), stable, 1);
  registry = advanceToVerified(registry, unsafe, 6);
  const blocked = buildRollbackDecision(registry, {
    regionCode: "210200",
    releaseId: "release-unsafe"
  });
  assert.equal(blocked.application.allowed, true);
  assert.equal(blocked.data.allowed, false);
  assert.equal(blocked.executable, false);
  assert.throws(
    () => buildTransitionPlan(registry, transitionOptions(unsafe, "rolled-back", 11)),
    /rollback is blocked/
  );

  const safe = release({
    releaseId: "release-safe",
    regionVersion: "2.1.0",
    compositeDigest: SHA_E,
    regionalContentDigest: SHA_F,
    dataImpact: "backward-compatible",
    rollbackSnapshot: evidence({
      ref: "controlled://regional/backups/release-safe",
      digest: SHA_A
    })
  });
  registry = advanceToVerified(registry, safe, 11);
  const allowed = buildRollbackDecision(registry, {
    regionCode: "210200",
    releaseId: "release-safe"
  });
  assert.equal(allowed.executable, true);
  assert.equal(allowed.data.action, "restore-controlled-snapshot");
  assert.equal(allowed.data.evidence.ref, "controlled://regional/backups/release-safe");
});

test("rollback is blocked when no previous verified release exists", () => {
  const target = release();
  const registry = advanceToVerified(createEmptyRegistry(), target, 1);
  const decision = buildRollbackDecision(registry, {
    regionCode: "210200",
    releaseId: "release-1"
  });
  assert.equal(decision.application.allowed, false);
  assert.equal(decision.data.allowed, true);
  assert.equal(decision.executable, false);
});

test("CAS rejects stale and modified plans without mutating the registry file", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "regional-release-governance-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registryPath = path.join(directory, "registry.json");
  fs.writeFileSync(registryPath, `${JSON.stringify(createEmptyRegistry(), null, 2)}\n`, "utf8");
  const first = release();
  const second = release({
    releaseId: "release-2",
    compositeDigest: SHA_D
  });
  const stale = buildTransitionPlan(
    createEmptyRegistry(),
    transitionOptions(first, "draft", 1)
  );
  const winning = buildTransitionPlan(
    createEmptyRegistry(),
    transitionOptions(second, "draft", 1)
  );
  const applied = applyTransitionPlan(registryPath, winning);
  assert.equal(applied.writes, true);
  const afterWinning = fs.readFileSync(registryPath, "utf8");
  assert.throws(() => applyTransitionPlan(registryPath, stale), /plan is stale/);
  assert.equal(fs.readFileSync(registryPath, "utf8"), afterWinning);

  const registry = JSON.parse(afterWinning);
  const modified = structuredClone(buildTransitionPlan(
    registry,
    transitionOptions(second, "validation", 2)
  ));
  modified.event.reason = "modified after review";
  assert.throws(
    () => applyTransitionPlanToRegistry(registry, modified),
    /plan was modified/
  );
});

test("file writer respects the governance lock and removes owned locks after failures", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "regional-release-lock-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const registryPath = path.join(directory, "registry.json");
  fs.writeFileSync(registryPath, `${JSON.stringify(createEmptyRegistry(), null, 2)}\n`, "utf8");
  const plan = buildTransitionPlan(
    createEmptyRegistry(),
    transitionOptions(release(), "draft", 1)
  );
  fs.writeFileSync(`${registryPath}.lock`, "another-operation\n", "utf8");
  assert.throws(() => applyTransitionPlan(registryPath, plan), /operation is in progress/);
  assert.equal(fs.readFileSync(`${registryPath}.lock`, "utf8"), "another-operation\n");
  fs.rmSync(`${registryPath}.lock`);

  fs.writeFileSync(registryPath, "{invalid-json\n", "utf8");
  assert.throws(() => applyTransitionPlan(registryPath, plan), /JSON/);
  assert.equal(fs.existsSync(`${registryPath}.lock`), false);
});

test("composite release binding verifies source content and requires the platform digest", () => {
  const composite = buildCompositeRegionalRelease({
    root: ROOT,
    regionCode: "210200",
    generatedAt: "2026-08-06T00:00:00.000Z"
  });
  const binding = buildReleaseBindingFromComposite(composite, {
    root: ROOT,
    platformDigest: SHA_A,
    dataImpact: "none"
  });
  assert.equal(binding.releaseId, composite.releaseId);
  assert.equal(binding.platform.version, composite.platform.version);
  assert.equal(binding.platform.digest, SHA_A);
  assert.equal(binding.compositeDigest, composite.artifact.digest);
  assert.equal(binding.regionalContentDigest, `sha256:${composite.region.contentDigest}`);
  assert.throws(
    () => buildReleaseBindingFromComposite(composite, { root: ROOT }),
    /platform.digest/
  );
  const tampered = structuredClone(composite);
  tampered.region.version = "9.9.9";
  assert.throws(
    () => buildReleaseBindingFromComposite(tampered, {
      root: ROOT,
      platformDigest: SHA_A
    }),
    /integrity verification failed/
  );
});

test("CLI is strict, previews by default and exposes no production-ready command", (t) => {
  assert.deepEqual(parseArgs(["status"]), { command: "status", flags: {} });
  assert.deepEqual(
    parseArgs(["transition", "--region=210200", "--release=r1", "--to=validation", "--write"]),
    {
      command: "transition",
      flags: {
        region: "210200",
        release: "r1",
        to: "validation",
        write: true
      }
    }
  );
  assert.throws(() => parseArgs(["approve-production"]), /unsupported/);
  assert.throws(() => parseArgs(["status", "--write"]), /unsupported status flag/);
  assert.throws(() => parseArgs(["register", "--write=true"]), /does not accept/);
  assert.throws(() => parseArgs(["diff", "--region=210200", "--region=210201"]), /duplicate/);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "regional-release-cli-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, "config"), { recursive: true });
  const registryPath = path.join(directory, "config", "regional-release-registry.json");
  fs.writeFileSync(registryPath, `${JSON.stringify(createEmptyRegistry(), null, 2)}\n`, "utf8");
  let output = "";
  const status = runCli(["status"], {
    root: directory,
    stdout: { write(value) { output += value; } }
  });
  assert.equal(status.productionReady, false);
  assert.equal(JSON.parse(output).eventCount, 0);
  assert.equal(fs.readFileSync(registryPath, "utf8"), `${JSON.stringify(createEmptyRegistry(), null, 2)}\n`);
});
