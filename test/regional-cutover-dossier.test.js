"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { buildCompositeRegionalRelease } = require("../src/platform/regional/composite-release");
const {
  buildExpectedSites,
  buildFleetStatus,
  environmentVariableForRegion
} = require("../src/platform/regional/multi-region-operations");
const {
  buildRegionalCutoverDossier,
  buildRegionalCutoverPortfolio
} = require("../src/platform/regional/regional-cutover-dossier");
const {
  applyTransitionPlanToRegistry,
  buildReleaseBindingFromComposite,
  buildTransitionPlan,
  createEmptyRegistry,
  normalizeReleaseBinding
} = require("../src/platform/regional/regional-release-governance");
const {
  buildReport,
  parseArgs,
  renderMarkdown
} = require("../scripts/regional-cutover-dossier");

const ROOT = path.resolve(__dirname, "..");
const NOW = "2026-08-07T00:00:00.000Z";
const CERTIFICATE = "2026-10-07T00:00:00.000Z";
const PLATFORM_DIGEST = `sha256:${"a".repeat(64)}`;

function advance(registry, release, toState, minute) {
  const options = {
    release,
    toState,
    actor: "cutover-dossier-test",
    reason: `advance current regional release to ${toState}`,
    recordedAt: `2026-08-07T00:0${minute}:00.000Z`
  };
  if (toState === "approved-candidate") {
    options.externalEvidence = {
      ref: "controlled://regional/evidence/candidate-package",
      digest: `sha256:${"b".repeat(64)}`,
      recordedAt: "2026-08-07T00:02:00.000Z",
      recordedBy: "site-evidence-custodian"
    };
    options.review = {
      reviewerId: "independent-site-reviewer",
      reviewedAt: "2026-08-07T00:02:30.000Z"
    };
  }
  const plan = buildTransitionPlan(registry, options);
  return applyTransitionPlanToRegistry(registry, plan).registry;
}

function candidateRegistry(composite) {
  const release = buildReleaseBindingFromComposite(composite, {
    root: ROOT,
    platformDigest: PLATFORM_DIGEST,
    dataImpact: "none"
  });
  let registry = createEmptyRegistry();
  registry = advance(registry, release, "draft", 1);
  registry = advance(registry, release, "validation", 2);
  registry = advance(registry, release, "approved-candidate", 3);
  return registry;
}

function healthyFleet() {
  const expected = buildExpectedSites({ root: ROOT, generatedAt: NOW })
    .find((site) => site.regionCode === "210200");
  return buildFleetStatus({
    root: ROOT,
    now: NOW,
    env: {
      [environmentVariableForRegion("210200")]: "https://regional.example.gov.cn"
    },
    receipts: [{
      schemaVersion: "regional-operations-probe-receipt-v1",
      regionCode: "210200",
      checkedAt: NOW,
      live: true,
      ready: true,
      observedRegionCode: "210200",
      observedDeploymentClass: "production",
      observedContentDigest: expected.expectedContentDigest,
      certificateNotAfter: CERTIFICATE,
      backupCheckedAt: NOW,
      transportSafe: true,
      containsBusinessData: false,
      productionReady: false
    }]
  });
}

test("default dossier proves local controls while keeping missing site gates explicit", () => {
  const dossier = buildRegionalCutoverDossier({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW,
    env: {},
    receipts: []
  });
  assert.equal(dossier.ok, true);
  assert.equal(dossier.candidateReady, false);
  assert.equal(dossier.productionReady, false);
  assert.equal(dossier.containsBusinessData, false);
  assert.equal(dossier.containsEndpoints, false);
  assert.equal(dossier.containsEvidenceBodies, false);
  assert.equal(dossier.release.governanceState, "unregistered");
  assert.ok(dossier.blockers.includes("regional-release-not-registered"));
  assert.ok(dossier.blockers.includes("backup-evidence-not-fresh"));
  assert.ok(dossier.blockers.includes("certificate-evidence-not-current"));
  assert.match(dossier.dossierDigest, /^sha256:[a-f0-9]{64}$/);
});

test("approved candidate plus healthy minimized operations can open only candidate readiness", () => {
  const composite = buildCompositeRegionalRelease({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW
  });
  const dossier = buildRegionalCutoverDossier({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW,
    composite,
    registry: candidateRegistry(composite),
    fleet: healthyFleet(),
    env: {}
  });
  assert.equal(dossier.ok, true);
  assert.equal(dossier.candidateReady, true);
  assert.equal(dossier.productionReady, false);
  assert.equal(dossier.release.governanceState, "approved-candidate");
  assert.equal(dossier.gates.every((item) => item.passed), true);
  assert.deepEqual(dossier.blockers, []);
  assert.equal(JSON.stringify(dossier).includes("regional.example.gov.cn"), false);
  assert.equal(dossier.externalBlockers.length, 4);
});

test("test regions and immutable release drift fail closed", () => {
  const fixture = buildRegionalCutoverDossier({
    root: ROOT,
    regionCode: "990001",
    generatedAt: NOW
  });
  assert.equal(fixture.ok, true);
  assert.equal(fixture.candidateReady, false);
  assert.ok(fixture.blockers.includes("region-not-production-class"));

  const composite = buildCompositeRegionalRelease({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW
  });
  const original = buildReleaseBindingFromComposite(composite, {
    root: ROOT,
    platformDigest: PLATFORM_DIGEST,
    dataImpact: "none"
  });
  const drifted = normalizeReleaseBinding({
    ...original,
    compositeDigest: `sha256:${"c".repeat(64)}`
  });
  const registry = advance(createEmptyRegistry(), drifted, "draft", 1);
  const dossier = buildRegionalCutoverDossier({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW,
    composite,
    registry,
    fleet: healthyFleet()
  });
  assert.equal(dossier.ok, false);
  assert.equal(dossier.release.bindingMatches, false);
  assert.ok(dossier.blockers.includes("regional-release-binding-drift"));
});

test("portfolio and CLI projection aggregate every site without changing production state", () => {
  const portfolio = buildRegionalCutoverPortfolio({
    root: ROOT,
    generatedAt: NOW
  });
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.productionReady, false);
  assert.equal(portfolio.summary.regions, 2);
  assert.equal(portfolio.summary.candidateReady, 0);
  const single = buildReport({
    root: ROOT,
    regionCode: "210200",
    generatedAt: NOW,
    env: {},
    receipts: []
  });
  assert.equal(single.summary.regions, 1);
  assert.equal(single.productionReady, false);
  assert.match(renderMarkdown(single), /地区投产档案汇总/);
  assert.deepEqual(parseArgs(["--region=210200", "--markdown=release/custom.md"]), {
    region: "210200",
    markdown: "release/custom.md"
  });
});
