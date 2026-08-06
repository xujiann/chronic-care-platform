"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const {
  buildCompositeRegionalRelease,
  compareVersion,
  verifyCompositeRegionalRelease
} = require("../src/platform/regional/composite-release");
const { regionalMatrix } = require("../scripts/regional-foundation");

const ROOT = path.resolve(__dirname, "..");

test("composite release binds platform version, region version and every region file", () => {
  const release = buildCompositeRegionalRelease({
    root: ROOT,
    regionCode: "210200",
    generatedAt: "2026-08-05T00:00:00.000Z"
  });
  assert.equal(release.technicalReady, true);
  assert.equal(release.productionReady, false);
  assert.match(release.releaseId, /^core-0\.1\.0-region-210200-0\.1\.0-[a-f0-9]{12}$/);
  assert.ok(release.artifact.files.some((item) => item.path === "regions/210200/manifest.json"));
  assert.ok(release.artifact.files.some((item) => item.path === "regions/210200/extensions/index.js"));
  assert.equal(verifyCompositeRegionalRelease(release, { root: ROOT }).ok, true);
});

test("composite release detects tampering and incompatible platform versions", () => {
  const release = buildCompositeRegionalRelease({ root: ROOT, regionCode: "template" });
  const tampered = structuredClone(release);
  tampered.artifact.digest = `sha256:${"0".repeat(64)}`;
  assert.deepEqual(verifyCompositeRegionalRelease(tampered, { root: ROOT }).errors, ["artifact.digest"]);
  const metadataTampered = structuredClone(release);
  metadataTampered.region.name = "替换地区";
  metadataTampered.productionReady = true;
  assert.deepEqual(
    verifyCompositeRegionalRelease(metadataTampered, { root: ROOT }).errors,
    ["region", "productionReady"]
  );
  const incompatible = buildCompositeRegionalRelease({
    root: ROOT,
    regionCode: "template",
    platformVersion: "1.0.0"
  });
  assert.equal(incompatible.technicalReady, false);
  assert.equal(compareVersion("0.2.0", "0.1.9"), 1);
});

test("regional CI matrix validates generic core and Dalian independently", () => {
  const matrix = regionalMatrix({
    root: ROOT,
    generatedAt: "2026-08-05T00:00:00.000Z"
  });
  assert.equal(matrix.ok, true);
  assert.equal(matrix.productionReady, false);
  assert.deepEqual(matrix.entries.map((item) => item.regionCode), ["template", "210200", "990001"]);
  assert.ok(matrix.entries.every((item) => item.technicalReady && item.verification.ok));
});
