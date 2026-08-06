"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  applyRegionScaffold,
  buildRegionScaffoldPlan,
  normalizeScaffoldInput,
  validateRegisteredRegionPackage
} = require("../src/platform/regional/region-scaffold");
const { parseArgs, runCli } = require("../scripts/regional-scaffold");

const ROOT = path.resolve(__dirname, "..");

function createFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "regional-scaffold-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.mkdirSync(path.join(root, "regions"), { recursive: true });
  fs.copyFileSync(path.join(ROOT, "config", "regions.json"), path.join(root, "config", "regions.json"));
  copyDirectory(path.join(ROOT, "regions", "template"), path.join(root, "regions", "template"));
  return root;
}

function copyDirectory(source, target) {
  fs.mkdirSync(target);
  fs.readdirSync(source, { withFileTypes: true }).forEach((entry) => {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) copyDirectory(sourcePath, targetPath);
    else fs.copyFileSync(sourcePath, targetPath);
  });
}

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

test("regional scaffold preview is deterministic and makes no changes", (t) => {
  const root = createFixture(t);
  const plan = buildRegionScaffoldPlan({
    root,
    regionCode: "320100",
    name: "示例市",
    level: "prefecture-city",
    parentCode: "320000"
  });
  assert.equal(plan.mode, "preview");
  assert.equal(plan.writes, false);
  assert.equal(plan.registryEntry.enabled, false);
  assert.equal(plan.registryEntry.deploymentClass, "test");
  assert.equal(plan.target, "regions/320100");
  assert.ok(plan.files.includes("regions/320100/manifest.json"));
  assert.equal(fs.existsSync(path.join(root, "regions", "320100")), false);
  assert.equal(
    readJson(path.join(root, "config", "regions.json")).regions.some((item) => item.code === "320100"),
    false
  );
});

test("regional scaffold writes one validated disabled test region", (t) => {
  const root = createFixture(t);
  const plan = buildRegionScaffoldPlan({
    root,
    regionCode: "320100",
    name: "示例市",
    level: "prefecture-city",
    parentCode: "320000"
  });
  const result = applyRegionScaffold(plan);
  assert.equal(result.mode, "write");
  assert.equal(result.writes, true);
  assert.deepEqual(result.validation, {
    manifest: true,
    configs: true,
    packageInventory: true,
    registry: true
  });

  const manifest = readJson(path.join(root, "regions", "320100", "manifest.json"));
  assert.equal(manifest.regionCode, "320100");
  assert.equal(manifest.name, "示例市");
  assert.deepEqual(manifest.administrativeDivision, {
    code: "320100",
    level: "prefecture-city",
    parentCode: "320000"
  });
  const organization = readJson(path.join(root, "regions", "320100", "config", "organization.json"));
  assert.equal(organization.administrativeCode, "320100");
  assert.equal(organization.platformDisplayName, "示例市卫生健康信息平台");
  const localization = readJson(path.join(root, "regions", "320100", "config", "localization.json"));
  assert.equal(localization.legacyReplacements["区域卫生健康信息平台"], "示例市卫生健康信息平台");
  const registration = readJson(path.join(root, "config", "regions.json"))
    .regions.find((item) => item.code === "320100");
  assert.equal(registration.enabled, false);
  assert.equal(registration.deploymentClass, "test");
  const validation = validateRegisteredRegionPackage({ root, regionCode: "320100" });
  assert.match(validation.contentDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(validation, {
    schemaVersion: "regional-package-validation-v1",
    regionCode: "320100",
    name: "示例市",
    enabled: false,
    deploymentClass: "test",
    contentDigest: validation.contentDigest,
    ok: true,
    files: 6,
    extensions: 0
  });
  assert.throws(
    () => buildRegionScaffoldPlan({ root, regionCode: "320100", name: "重复地区" }),
    /already registered/
  );
});

test("regional scaffold rolls back invalid template output without partial registration", (t) => {
  const root = createFixture(t);
  const plan = buildRegionScaffoldPlan({
    root,
    regionCode: "330100",
    name: "回滚验证市",
    parentCode: "330000"
  });
  const organizationPath = path.join(root, "regions", "template", "config", "organization.json");
  const organization = readJson(organizationPath);
  delete organization.organizations.centralHospital.shortName;
  fs.writeFileSync(organizationPath, `${JSON.stringify(organization, null, 2)}\n`, "utf8");

  assert.throws(() => applyRegionScaffold(plan), /centralHospital.shortName/);
  assert.equal(fs.existsSync(path.join(root, "regions", "330100")), false);
  assert.equal(fs.existsSync(path.join(root, "regions", ".region-scaffold.lock")), false);
  assert.equal(
    readJson(path.join(root, "config", "regions.json")).regions.some((item) => item.code === "330100"),
    false
  );
});

test("regional scaffold CLI remains preview-only without --write", (t) => {
  const root = createFixture(t);
  let output = "";
  const result = runCli(
    ["--region=340100", "--name=命令行示例市", "--parent=340000"],
    { root, stdout: { write(value) { output += value; } } }
  );
  assert.equal(result.writes, false);
  assert.equal(JSON.parse(output).target, "regions/340100");
  assert.equal(fs.existsSync(path.join(root, "regions", "340100")), false);
  assert.deepEqual(parseArgs(["--region=340100", "--write"]), {
    region: "340100",
    write: true
  });
  assert.throws(() => parseArgs(["--region=340100", "--writ"]), /unsupported/);
  assert.throws(() => parseArgs(["--region=340100", "--region=340200"]), /duplicate/);
  assert.throws(() => parseArgs(["--region=340100", "--write=true"]), /does not accept/);
  assert.throws(() => normalizeScaffoldInput({ regionCode: "template", name: "错误" }), /six-digit/);
  assert.throws(() => normalizeScaffoldInput({ regionCode: "340100", name: true }), /printable/);
});

test("regional scaffold CLI validates a disabled package after editing", (t) => {
  const root = createFixture(t);
  applyRegionScaffold(buildRegionScaffoldPlan({
    root,
    regionCode: "360100",
    name: "待评审市",
    parentCode: "360000"
  }));
  let output = "";
  const result = runCli(
    ["--region=360100", "--validate"],
    { root, stdout: { write(value) { output += value; } } }
  );
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(output).enabled, false);
  assert.throws(
    () => runCli(["--region=360100", "--validate", "--write"], { root }),
    /cannot be combined/
  );
});
