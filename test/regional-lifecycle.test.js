"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyTestActivation,
  planTestActivation,
  regionalPortfolio
} = require("../src/platform/regional/region-lifecycle");
const {
  applyRegionScaffold,
  buildRegionScaffoldPlan
} = require("../src/platform/regional/region-scaffold");
const { loadRegionManifest } = require("../src/platform/regional/region-manifest");
const { parseArgs, runCli } = require("../scripts/regional-lifecycle");

const ROOT = path.resolve(__dirname, "..");

function copyDirectory(source, target) {
  fs.mkdirSync(target);
  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  });
}

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "regional-lifecycle-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "regions"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "config", "regions.json"), path.join(root, "config", "regions.json"));
  ["template", "210200", "990001"].forEach((regionCode) => {
    copyDirectory(path.join(ROOT, "regions", regionCode), path.join(root, "regions", regionCode));
  });
  return root;
}

function scaffoldDraft(root, regionCode = "320100") {
  return applyRegionScaffold(buildRegionScaffoldPlan({
    root,
    regionCode,
    name: `${regionCode}测试地区`,
    parentCode: `${regionCode.slice(0, 2)}0000`
  }));
}

function readRegistry(root) {
  return JSON.parse(fs.readFileSync(path.join(root, "config", "regions.json"), "utf8"));
}

test("regional portfolio reports every registered lifecycle state", () => {
  const portfolio = regionalPortfolio({ root: ROOT });
  assert.equal(portfolio.ok, true);
  assert.equal(portfolio.productionReady, false);
  assert.deepEqual(portfolio.counts, {
    total: 3,
    template: 1,
    draft: 0,
    validation: 1,
    production: 1,
    invalid: 0
  });
  assert.deepEqual(
    portfolio.entries.map((entry) => [entry.code, entry.lifecycleState]),
    [["template", "template"], ["210200", "production"], ["990001", "validation"]]
  );
});

test("draft region activates only into the test validation lifecycle", (t) => {
  const root = createFixture(t);
  scaffoldDraft(root);
  const before = regionalPortfolio({ root });
  assert.equal(before.counts.draft, 1);

  const plan = planTestActivation({ root, regionCode: "320100" });
  assert.equal(plan.from, "draft");
  assert.equal(plan.to, "validation");
  assert.equal(plan.writes, false);
  assert.match(plan.registryDigest, /^sha256:[a-f0-9]{64}$/);
  assert.match(plan.nextContentDigest, /^[a-f0-9]{64}$/);

  const result = applyTestActivation(plan);
  assert.equal(result.writes, true);
  assert.equal(result.enabled, true);
  assert.equal(result.activation.REGION_DEPLOYMENT_CLASS, "test");
  assert.equal(result.activation.REGION_CONTENT_DIGEST, `sha256:${plan.nextContentDigest}`);
  const registration = readRegistry(root).regions.find((entry) => entry.code === "320100");
  assert.equal(registration.enabled, true);
  assert.equal(registration.deploymentClass, "test");
  assert.equal(loadRegionManifest({ root, regionCode: "320100" }).contentDigest, plan.nextContentDigest);
  assert.throws(
    () => loadRegionManifest({
      root,
      regionCode: "320100",
      env: { NODE_ENV: "production" }
    }),
    /cannot run in production/
  );
});

test("test activation rejects production regions and stale registry plans", (t) => {
  const root = createFixture(t);
  assert.throws(
    () => planTestActivation({ root, regionCode: "210200" }),
    /not a test deployment/
  );
  scaffoldDraft(root, "330100");
  const plan = planTestActivation({ root, regionCode: "330100" });
  const registryPath = path.join(root, "config", "regions.json");
  const registry = readRegistry(root);
  registry.regions.find((entry) => entry.code === "330100").purpose = "并发修改";
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
  assert.throws(() => applyTestActivation(plan), /registry changed/);
  assert.equal(readRegistry(root).regions.find((entry) => entry.code === "330100").enabled, false);
  assert.equal(fs.existsSync(path.join(root, "regions", ".region-scaffold.lock")), false);

  fs.writeFileSync(registryPath, "{invalid-json\n", "utf8");
  assert.throws(() => applyTestActivation(plan), /JSON/);
  assert.equal(fs.existsSync(path.join(root, "regions", ".region-scaffold.lock")), false);
});

test("test activation respects the shared regional lifecycle lock", (t) => {
  const root = createFixture(t);
  scaffoldDraft(root, "340100");
  const plan = planTestActivation({ root, regionCode: "340100" });
  const lockPath = path.join(root, "regions", ".region-scaffold.lock");
  fs.writeFileSync(lockPath, "owned-by-another-operation\n", "utf8");
  assert.throws(() => applyTestActivation(plan), /operation is in progress/);
  assert.equal(fs.readFileSync(lockPath, "utf8"), "owned-by-another-operation\n");
  fs.rmSync(lockPath, { force: true });
});

test("regional lifecycle CLI previews writes and exposes no production promotion command", (t) => {
  const root = createFixture(t);
  scaffoldDraft(root, "350100");
  let output = "";
  const plan = runCli(
    ["enable-test", "--region=350100"],
    { root, stdout: { write(value) { output += value; } } }
  );
  assert.equal(plan.writes, false);
  assert.equal(JSON.parse(output).to, "validation");
  assert.equal(readRegistry(root).regions.find((entry) => entry.code === "350100").enabled, false);
  assert.deepEqual(parseArgs(["inventory"]), { command: "inventory", flags: {} });
  assert.throws(() => parseArgs(["promote-production", "--region=350100"]), /unsupported/);
  assert.throws(() => parseArgs(["enable-test", "--region=350100", "--write=true"]), /does not accept/);
});
