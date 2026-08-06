"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  assertNoSensitiveKeys,
  loadRegionManifest,
  loadRegionalConfigs,
  validateManifest,
  validateRegistry
} = require("../src/platform/regional/region-manifest");

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
  assert.equal(Object.isFrozen(dalian), true);
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
        { code: "template", enabled: true, deploymentClass: "template" },
        { code: "template", enabled: true, deploymentClass: "template" }
      ]
    }),
    /duplicate region codes/
  );
  assert.throws(
    () => validateRegistry({
      schemaVersion: "regional-registry-v1",
      defaultRegion: "template",
      regions: [
        { code: "template", enabled: false, deploymentClass: "template" }
      ]
    }),
    /defaultRegion must be an enabled template/
  );
  assert.throws(
    () => validateRegistry({
      schemaVersion: "regional-registry-v1",
      defaultRegion: "template",
      regions: [
        { code: "template", enabled: true, deploymentClass: "template" },
        { code: "990001", enabled: true, deploymentClass: "template" }
      ]
    }),
    /reserved for defaultRegion/
  );
});
