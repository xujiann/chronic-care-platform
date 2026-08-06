"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  assertNoSensitiveKeys,
  collectRegionFiles,
  loadRegionManifest,
  loadRegionalConfigs,
  validateManifest,
  validateRegistry
} = require("../src/platform/regional/region-manifest");
const { validateRegionalConfigs } = require("../src/platform/regional/regional-config-contract");

const ROOT = path.resolve(__dirname, "..");

test("regional registry selects a generic default and separates production from test regions", () => {
  const generic = loadRegionManifest({ root: ROOT });
  const dalian = loadRegionManifest({ root: ROOT, regionCode: "210200" });
  const second = loadRegionManifest({ root: ROOT, regionCode: "990001" });
  assert.equal(generic.manifest.regionCode, "template");
  assert.equal(dalian.manifest.regionCode, "210200");
  assert.equal(generic.registration.deploymentClass, "template");
  assert.equal(dalian.registration.deploymentClass, "production");
  assert.equal(second.registration.deploymentClass, "test");
  assert.throws(
    () => loadRegionManifest({ root: ROOT, regionCode: "990001", env: { NODE_ENV: "production" } }),
    /cannot run in production/
  );
  assert.equal(dalian.manifest.administrativeDivision.parentCode, "210000");
  assert.match(dalian.digest, /^[a-f0-9]{64}$/);
  assert.match(dalian.contentDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(dalian), true);
  assert.equal(
    loadRegionManifest({
      root: ROOT,
      regionCode: "210200",
      expectedDeploymentClass: "production",
      expectedContentDigest: `sha256:${dalian.contentDigest}`
    }).contentDigest,
    dalian.contentDigest
  );
  assert.throws(
    () => loadRegionManifest({
      root: ROOT,
      regionCode: "210200",
      expectedContentDigest: `sha256:${"0".repeat(64)}`
    }),
    /content digest mismatch/
  );
  assert.throws(
    () => loadRegionManifest({
      root: ROOT,
      regionCode: "210200",
      expectedDeploymentClass: "test"
    }),
    /deployment class mismatch/
  );
  const configs = loadRegionalConfigs(dalian);
  assert.equal(configs.organization.administrativeCode, "210200");
  assert.equal(configs["adapter-profiles"].profiles[0].productionEnabled, false);
  assert.equal(configs["migration-inventory"].legacyCompatibility.enabled, true);
});

test("regional manifest validation rejects unregistered, mismatched and unsafe declarations", () => {
  const valid = structuredClone(loadRegionManifest({ root: ROOT, regionCode: "210200" }).manifest);
  assert.throws(() => loadRegionManifest({ root: ROOT, regionCode: "../../escape" }), /invalid REGION_CODE/);
  assert.throws(() => validateManifest({ ...valid, regionCode: "110000" }, "210200"), /does not match/);
  assert.throws(
    () => validateManifest({ ...valid, configRefs: ["../outside.json"] }),
    /invalid regional config reference/
  );
  assert.throws(
    () => validateManifest({ ...valid, extensions: [...valid.extensions, valid.extensions[0]] }),
    /duplicate regional extension/
  );
  assert.throws(() => assertNoSensitiveKeys({ integrationToken: "should-never-be-here" }), /prohibited sensitive field/);
});

test("regional registry requires unique enabled region declarations", () => {
  assert.throws(
    () => validateRegistry({
      schemaVersion: "regional-registry-v1",
      defaultRegion: "template",
      regions: [
        { code: "template", name: "模板", purpose: "测试", enabled: true, deploymentClass: "template" },
        { code: "template", name: "模板", purpose: "测试", enabled: true, deploymentClass: "template" }
      ]
    }),
    /duplicate region codes/
  );
  assert.throws(
    () => validateRegistry({
      schemaVersion: "regional-registry-v1",
      defaultRegion: "template",
      regions: [
        { code: "template", name: "模板", purpose: "测试", enabled: false, deploymentClass: "template" }
      ]
    }),
    /defaultRegion must be an enabled template/
  );
  assert.throws(
    () => validateRegistry({
      schemaVersion: "regional-registry-v1",
      defaultRegion: "template",
      regions: [
        { code: "template", name: "模板", purpose: "测试", enabled: true, deploymentClass: "template" },
        { code: "990001", name: "测试地区", purpose: "测试", enabled: true, deploymentClass: "template" }
      ]
    }),
    /reserved for defaultRegion/
  );
});

test("regional config contract rejects incomplete or structurally invalid common config", () => {
  const loaded = loadRegionManifest({ root: ROOT, regionCode: "210200" });
  const validConfigs = structuredClone(loadRegionalConfigs(loaded));
  assert.equal(validateRegionalConfigs(validConfigs, loaded.manifest), validConfigs);

  const missing = structuredClone(validConfigs);
  delete missing.geography;
  assert.throws(() => validateRegionalConfigs(missing, loaded.manifest), /geography is required/);

  const invalidEntity = structuredClone(validConfigs);
  delete invalidEntity.organization.organizations.centralHospital.shortName;
  assert.throws(
    () => validateRegionalConfigs(invalidEntity, loaded.manifest),
    /centralHospital.shortName must be a non-empty string/
  );

  const wrongSchema = structuredClone(validConfigs);
  wrongSchema.localization.schemaVersion = "regional-localization-v2";
  assert.throws(
    () => validateRegionalConfigs(wrongSchema, loaded.manifest),
    /localization schemaVersion/
  );
});

test("regional package inventory rejects files that would bypass its digest", (t) => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "regional-package-"));
  t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
  const regionRoot = path.join(projectRoot, "regions", "template");
  fs.mkdirSync(regionRoot, { recursive: true });
  fs.writeFileSync(path.join(regionRoot, "manifest.json"), "{}\n", "utf8");
  fs.writeFileSync(path.join(regionRoot, "untracked.txt"), "must not be ignored\n", "utf8");
  assert.throws(
    () => collectRegionFiles({ projectRoot, regionRoot }),
    /unsupported file: untracked.txt/
  );
});
