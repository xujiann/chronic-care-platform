"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const {
  buildWorktreePlan,
  isWithin,
  loadManifest,
  matchesPattern,
  normalizeProcessId,
  normalizeTopic,
  parseProcessBranch,
  resolveProtectedOwner,
  validateChanges
} = require("../scripts/process-worktree");

const manifest = loadManifest();

test("process manifest pins the unique integration baseline and evidence policy", () => {
  assert.equal(manifest.integrationBranch, "main");
  assert.equal(manifest.baselineTag, "baseline/governance-20260804-runtime-integration-v1");
  assert.equal(manifest.developmentPolicy.singleIntegrationBaseline, true);
  assert.equal(manifest.developmentPolicy.integrationOwner, "T00");
  assert.equal(manifest.developmentPolicy.externalEvidenceCannotBeInferred, true);
  assert.equal(manifest.developmentPolicy.productionDefaultDecision, "NO-GO");
});

test("process manifest assigns every domain route exactly once", () => {
  const routeOwners = new Map();
  Object.entries(manifest.processes).forEach(([processId, process]) => {
    process.ownedRoutes.forEach((route) => {
      assert.equal(routeOwners.has(route), false, `${route} has duplicate process owners`);
      routeOwners.set(route, processId);
      assert.equal(resolveProtectedOwner(route, manifest), processId);
    });
  });
  assert.equal(routeOwners.size, 12);
  assert.equal(resolveProtectedOwner("src/http/routes/index.js", manifest), "T00");
  assert.equal(resolveProtectedOwner(".github/workflows/ci.yml", manifest), "T00");
  assert.equal(resolveProtectedOwner("src/http/routes/platform-governance/phase2-operations.js", manifest), "T02");
});

test("process branch and topic formats are deterministic", () => {
  assert.equal(normalizeProcessId("t04"), "T04");
  assert.equal(normalizeTopic("citizen-chronic"), "citizen-chronic");
  assert.deepEqual(parseProcessBranch("process/t04-citizen-chronic-pilot-20260803", manifest), {
    integration: false,
    branch: "process/t04-citizen-chronic-pilot-20260803",
    processId: "T04",
    topic: "citizen-chronic-pilot",
    date: "20260803"
  });
  assert.equal(parseProcessBranch(manifest.integrationBranch, manifest).integration, true);
  assert.throws(() => normalizeTopic("Citizen Chronic"), /topic must contain/);
});

test("ownership verification blocks cross-process protected files", () => {
  const allowed = validateChanges("T04", [
    "src/http/routes/citizen-chronic.js",
    "citizen-records-v3.js",
    "test/citizen-records-v3.test.js"
  ], manifest);
  assert.equal(allowed.ok, true);

  const denied = validateChanges("T04", [
    "src/http/routes/citizen-chronic.js",
    "src/http/routes/care-coordination.js",
    "server.js"
  ], manifest);
  assert.equal(denied.ok, false);
  assert.deepEqual(denied.violations, [
    { file: "server.js", owner: "T00" },
    { file: "src/http/routes/care-coordination.js", owner: "T05" }
  ]);
  assert.equal(validateChanges("T00", denied.files, manifest).ok, true);
});

test("worktree plan stays inside its configured root", () => {
  const worktreeRoot = path.resolve("tmp", "process-worktree-test");
  const plan = buildWorktreePlan({
    process: "T05",
    topic: "care-coordination-pilot",
    date: "20260803",
    worktreeRoot
  }, manifest);
  assert.equal(plan.branch, "process/t05-care-coordination-pilot-20260803");
  assert.equal(plan.base, manifest.baselineTag);
  assert.equal(isWithin(worktreeRoot, plan.worktree), true);
  assert.throws(() => buildWorktreePlan({
    process: "T05",
    topic: "care-coordination-pilot",
    date: "20260803",
    worktreeRoot,
    path: path.resolve(worktreeRoot, "..", "outside")
  }, manifest), /must stay inside/);
});

test("protected path matcher supports exact paths and recursive directories", () => {
  assert.equal(matchesPattern("server.js", "server.js"), true);
  assert.equal(matchesPattern(".github/workflows/ci.yml", ".github/**"), true);
  assert.equal(matchesPattern("src/http/routes/runtime.js", ".github/**"), false);
});
