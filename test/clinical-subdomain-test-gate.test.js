"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  analyzeTestSource,
  detectCiWiring,
  parseArgs,
  runClinicalTestGate,
  testFilesFor,
  validateClinicalTestGates
} = require("../scripts/clinical-subdomain-test-gate");
const {
  loadClinicalSubdomainRegistry
} = require("../src/clinical-specialties/subdomain-governance");

const ROOT = path.resolve(__dirname, "..");

test("all five clinical subdomains expose deterministic local test gates", () => {
  const registry = loadClinicalSubdomainRegistry(ROOT);
  const report = validateClinicalTestGates(ROOT, registry);

  assert.deepEqual(report, {
    ok: true,
    errors: [],
    subdomainCount: 5,
    subdomainTestFileCount: 15,
    sharedTestFileCount: 1,
    ci: {
      scriptName: "clinical-subdomains:test",
      scriptWired: true,
      structureValid: true,
      jobFound: true,
      jobUnconditional: true,
      stepFound: true,
      stepUnconditional: true,
      stepBlocking: true,
      workflowWired: true,
      wired: true
    },
    productionReady: false,
    independentDeploymentAuthorized: false
  });
  assert.deepEqual(
    registry.subdomains.map((item) => [item.id, item.testGate.status, item.testGate.productionReady]),
    [
      ["emergency", "local-independent-test-ready", false],
      ["blood", "local-independent-test-ready", false],
      ["imaging", "local-independent-test-ready", false],
      ["physical-examination", "local-independent-test-ready", false],
      ["quality-safety", "local-independent-test-ready", false]
    ]
  );
  assert.equal(
    registry.independentDevelopmentExitCriteria.find((item) => item.id === "independent-domain-tests").status,
    "met"
  );
  assert.equal(
    registry.independentDevelopmentExitCriteria.find((item) => item.id === "independent-ci-gates").status,
    "met"
  );
});

test("test gate inventory has one owner and all-mode includes shared governance once", () => {
  const registry = loadClinicalSubdomainRegistry(ROOT);
  const allFiles = testFilesFor(registry, "all");
  const sharedFile = "test/clinical-subdomain-governance.test.js";

  assert.equal(allFiles.length, 16);
  assert.equal(allFiles.filter((file) => file === sharedFile).length, 1);
  assert.equal(new Set(allFiles).size, allFiles.length);
  registry.subdomains.forEach((subdomain) => {
    const files = testFilesFor(registry, subdomain.id);
    assert.equal(files[0], sharedFile);
    assert.deepEqual(files.slice(1), subdomain.testGate.testFiles);
  });
});

test("test gate governance fails closed on authority path and production drift", () => {
  const registry = structuredClone(loadClinicalSubdomainRegistry(ROOT));
  registry.testGovernance.productionReady = true;
  registry.testGovernance.allEntrypoint = "node scripts/other.js";
  registry.subdomains[0].testGate.entrypoint = "node scripts/other.js";
  registry.subdomains[0].testGate.productionReady = true;
  registry.subdomains[0].testGate.testFiles.push("test/blood-dashboard-query.test.js");
  registry.subdomains[1].testGate.testFiles[0] = "../server.js";
  registry.subdomains[2].testGate.testFiles[0] = "test/missing-imaging.test.js";
  registry.subdomains[3].testGate.testFiles.push(registry.subdomains[3].testGate.testFiles[0]);
  registry.independentDevelopmentExitCriteria.find((item) => item.id === "independent-domain-tests").status = "partial";

  const report = validateClinicalTestGates(ROOT, registry);
  const errors = report.errors.join("\n");

  assert.equal(report.ok, false);
  assert.match(errors, /production fail closed/);
  assert.match(errors, /all-test entrypoint/);
  assert.match(errors, /emergency test entrypoint/);
  assert.match(errors, /emergency test gate must remain production fail closed/);
  assert.match(errors, /emergency test gate includes a foreign test/);
  assert.match(errors, /blood test path must stay under test/);
  assert.match(errors, /imaging test file does not exist/);
  assert.match(errors, /physical-examination test gate contains duplicates/);
  assert.match(errors, /independent-domain-tests must be met/);
});

test("CI exit status must match the package and workflow wiring", () => {
  const registry = structuredClone(loadClinicalSubdomainRegistry(ROOT));
  registry.independentDevelopmentExitCriteria.find((item) => item.id === "independent-ci-gates").status = "partial";

  const report = validateClinicalTestGates(ROOT, registry);
  assert.equal(report.ok, false);
  assert.match(report.errors.join("\n"), /independent-ci-gates must be met/);
});

test("test evidence requires parsed imports executable tests and structured route anchors", () => {
  const errors = [];
  const forgedSource = `
    const test = require("node:test");
    // require("../src/clinical-specialties/emergency/dashboard-query");
    // require("../src/http/routes/clinical-specialties/emergency-care");
    test("forged comment and string evidence", () => {
      "/api/emergency/dashboard";
    });
  `;
  const evidence = analyzeTestSource(forgedSource, "test/emergency-forged.test.js", errors, "emergency");

  assert.deepEqual(errors, []);
  assert.deepEqual(evidence.moduleSpecifiers, ["node:test"]);
  assert.deepEqual(evidence.routeAnchors, []);
  assert.deepEqual(evidence.executableTests, ["forged comment and string evidence"]);

  const moduleErrors = [];
  const moduleEvidence = analyzeTestSource(`
    import test from "node:test";
    import "../src/clinical-specialties/emergency/dashboard-query.js";
    test("ES module route assertion", () => {
      assert.equal(route, "/api/emergency/dashboard");
    });
  `, "test/emergency-module.test.js", moduleErrors, "emergency");
  assert.deepEqual(moduleErrors, []);
  assert.deepEqual(moduleEvidence.moduleSpecifiers, [
    "node:test",
    "../src/clinical-specialties/emergency/dashboard-query.js"
  ]);
  assert.deepEqual(moduleEvidence.routeAnchors, ["/api/emergency/dashboard"]);

  const registry = structuredClone(loadClinicalSubdomainRegistry(ROOT));
  const overrides = Object.fromEntries(
    registry.subdomains[0].testGate.testFiles.map((file) => [file, forgedSource])
  );
  const report = validateClinicalTestGates(ROOT, registry, { testSourceOverrides: overrides });
  const messages = report.errors.join("\n");

  assert.equal(report.ok, false);
  assert.match(messages, /emergency test gate does not exercise its target source root/);
  assert.match(messages, /emergency test gate does not exercise its HTTP facade/);
  assert.match(messages, /emergency test gate does not bind implemented route GET \/api\/emergency\/dashboard/);
});

test("CI wiring accepts only one unconditional active step in governance-api", () => {
  const governance = loadClinicalSubdomainRegistry(ROOT).testGovernance;
  const packageJson = { scripts: { [governance.ciScript]: governance.allEntrypoint } };
  const inspect = (workflowSource) => detectCiWiring(ROOT, governance, {
    packageJson,
    workflowSource: workflowSource.replace(/^ {4}/gm, "")
  });

  const commentOnly = inspect(`
    jobs:
      governance-api:
        steps:
          # - run: npm run clinical-subdomains:test
          - run: npm test
  `);
  assert.equal(commentOnly.jobFound, true);
  assert.equal(commentOnly.stepFound, false);
  assert.equal(commentOnly.wired, false);

  const wrongJob = inspect(`
    jobs:
      governance-api:
        steps:
          - run: npm test
      complete-unit-test:
        steps:
          - run: npm run clinical-subdomains:test
  `);
  assert.equal(wrongJob.jobUnconditional, true);
  assert.equal(wrongJob.stepFound, false);
  assert.equal(wrongJob.wired, false);

  const disabledStep = inspect(`
    jobs:
      governance-api:
        steps:
          - if: false
            run: npm run clinical-subdomains:test
  `);
  assert.equal(disabledStep.stepFound, true);
  assert.equal(disabledStep.stepUnconditional, false);
  assert.equal(disabledStep.wired, false);

  const disabledJob = inspect(`
    jobs:
      governance-api:
        if: false
        steps:
          - run: npm run clinical-subdomains:test
  `);
  assert.equal(disabledJob.jobUnconditional, false);
  assert.equal(disabledJob.stepUnconditional, true);
  assert.equal(disabledJob.wired, false);

  const duplicateSteps = inspect(`
    jobs:
      governance-api:
        steps:
          - run: npm run clinical-subdomains:test
          - run: npm run clinical-subdomains:test
  `);
  assert.equal(duplicateSteps.stepFound, false);
  assert.equal(duplicateSteps.wired, false);

  const ignoredFailure = inspect(`
    jobs:
      governance-api:
        steps:
          - continue-on-error: true
            run: npm run clinical-subdomains:test
  `);
  assert.equal(ignoredFailure.stepFound, true);
  assert.equal(ignoredFailure.stepBlocking, false);
  assert.equal(ignoredFailure.wired, false);

  const wrongIndent = detectCiWiring(ROOT, governance, {
    packageJson,
    workflowSource: "jobs:\n  governance-api:\n    steps:\n       - run: npm run clinical-subdomains:test\n"
  });
  assert.equal(wrongIndent.structureValid, false);
  assert.equal(wrongIndent.wired, false);

  const outsideJobs = inspect(`
    jobs:
      complete-unit-test:
        steps:
          - run: npm test
    unrelated:
      governance-api:
        steps:
          - run: npm run clinical-subdomains:test
  `);
  assert.equal(outsideJobs.jobFound, false);
  assert.equal(outsideJobs.wired, false);
});

test("runner propagates Node test failure and never treats a failed subdomain as ready", () => {
  let invocation;
  const result = runClinicalTestGate("quality-safety", {
    root: ROOT,
    spawnSync(command, args, options) {
      invocation = { command, args, options };
      return { status: 1 };
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 1);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args.slice(0, 2), ["--test", "--test-concurrency=1"]);
  assert.deepEqual(invocation.args.slice(2), [
    "test/clinical-subdomain-governance.test.js",
    "test/quality-safety-dashboard-query.test.js",
    "test/quality-safety-ai-cdss-governance-center.test.js",
    "test/quality-safety-ai-cdss-governance-route.test.js"
  ]);
  assert.equal(invocation.options.cwd, ROOT);
});

test("runner arguments reject unknown and ambiguous commands", () => {
  assert.deepEqual(parseArgs(["--check"]), { mode: "check" });
  assert.deepEqual(parseArgs(["--all"]), { mode: "run", subdomain: "all" });
  assert.deepEqual(parseArgs(["--subdomain", "blood"]), { mode: "run", subdomain: "blood" });
  assert.deepEqual(parseArgs(["--list", "all"]), { mode: "list", subdomain: "all" });
  assert.throws(() => parseArgs([]), /usage:/);
  assert.throws(() => parseArgs(["--subdomain"]), /usage:/);
  assert.throws(() => testFilesFor(loadClinicalSubdomainRegistry(ROOT), "unknown"), /unknown clinical subdomain/);
});
