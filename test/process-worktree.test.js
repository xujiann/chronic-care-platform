"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
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

function workflowJob(workflow, jobId) {
  const marker = new RegExp(`^  ${jobId}:\\r?$`, "m").exec(workflow);
  assert.ok(marker, `workflow job ${jobId} must exist`);
  const remainder = workflow.slice(marker.index + marker[0].length);
  const nextJob = /\r?\n  [a-z0-9-]+:\r?\n/m.exec(remainder);
  return nextJob ? remainder.slice(0, nextJob.index) : remainder;
}

test("process manifest pins the unique integration baseline and evidence policy", () => {
  assert.equal(manifest.integrationBranch, "main");
  assert.equal(manifest.baselineTag, "baseline/governance-20260817-enhancement-v1");
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
  assert.equal(resolveProtectedOwner("src/platform/governance/regional-sharing-access-command.js", manifest), "T00");
  assert.equal(resolveProtectedOwner("src/platform/governance/resident-authorization-decision-adapter.js", manifest), "T00");
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

test("CI verifies every process pull request against its target integration branch", () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");
  const pullRequestTemplate = fs.readFileSync(path.resolve(__dirname, "..", ".github", "PULL_REQUEST_TEMPLATE", "process-change.md"), "utf8");

  assert.match(workflow, /if \[\[ "\$branch" == process\/\* \]\]; then/);
  assert.match(workflow, /base_branch="\$\{GITHUB_BASE_REF:-main\}"/);
  assert.match(workflow, /git fetch origin "\$base_branch" --depth=1/);
  assert.match(workflow, /--base="origin\/\$base_branch"/);
  assert.doesNotMatch(workflow, /process\/t00-\*-baseline-\*/);
  assert.match(pullRequestTemplate, /基线 ref\/SHA：/);
  assert.doesNotMatch(pullRequestTemplate, /baseline\/governance-20260803-process-v1/);
});

test("CI isolates browser E2E and release readiness behind the required test aggregate", () => {
  const workflow = fs.readFileSync(path.resolve(__dirname, "..", ".github", "workflows", "ci.yml"), "utf8");

  const governanceJob = workflowJob(workflow, "governance-api");
  const browserJob = workflowJob(workflow, "browser-e2e");
  const releaseJob = workflowJob(workflow, "release-readiness");
  const requiredAggregate = workflowJob(workflow, "test");

  assert.match(workflow, /\n  regional-foundation:\r?\n    runs-on: ubuntu-latest\r?\n    timeout-minutes: 5\r?\n/);
  assert.match(workflow, /\n  complete-unit-test:\r?\n    runs-on: ubuntu-latest\r?\n    timeout-minutes: 10\r?\n/);

  assert.match(governanceJob, /timeout-minutes: 10/);
  assert.match(governanceJob, /Verify process ownership boundary/);
  assert.match(governanceJob, /Run API regression tests/);
  assert.doesNotMatch(governanceJob, /Install Chromium|Run deployment readiness gate/);

  assert.match(browserJob, /timeout-minutes: 15/);
  assert.match(browserJob, /npx playwright install --with-deps chromium/);
  assert.match(browserJob, /npm run test:e2e/);
  assert.doesNotMatch(browserJob, /Run API regression tests|Run deployment readiness gate/);

  assert.match(releaseJob, /timeout-minutes: 15/);
  assert.match(releaseJob, /Run deployment readiness gate/);
  assert.match(releaseJob, /Upload release readiness report/);
  assert.match(releaseJob, /npm audit --omit=dev/);
  assert.doesNotMatch(releaseJob, /Install Chromium|npm run test:e2e/);

  assert.match(requiredAggregate, /needs:\r?\n      - governance-api\r?\n      - browser-e2e\r?\n      - release-readiness/);
  assert.match(requiredAggregate, /if: \$\{\{ always\(\) \}\}/);
  assert.match(requiredAggregate, /timeout-minutes: 5/);
  assert.match(requiredAggregate, /GOVERNANCE_RESULT: \$\{\{ needs\.governance-api\.result \}\}/);
  assert.match(requiredAggregate, /BROWSER_RESULT: \$\{\{ needs\.browser-e2e\.result \}\}/);
  assert.match(requiredAggregate, /RELEASE_RESULT: \$\{\{ needs\.release-readiness\.result \}\}/);
  assert.match(requiredAggregate, /for result in "\$GOVERNANCE_RESULT" "\$BROWSER_RESULT" "\$RELEASE_RESULT"; do/);
  assert.match(requiredAggregate, /if \[\[ "\$result" != "success" \]\]; then/);
  assert.match(requiredAggregate, /exit 1/);
});
