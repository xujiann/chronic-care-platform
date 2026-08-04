"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("deployment and iteration artifacts expose the immutable cutover package control plane", () => {
  const env = fs.readFileSync(
    path.join(ROOT, "deploy", "platform-production-adapters.env.template"),
    "utf8"
  );
  assert.match(env, /^PLATFORM_PILOT_CUTOVER_INPUT_FILE=$/m);
  assert.match(env, /^PLATFORM_PILOT_CUTOVER_AUTHORIZATION_LEDGER_FILE=$/m);
  const manifest = JSON.parse(fs.readFileSync(
    path.join(
      ROOT,
      "docs",
      "evidence-templates",
      "platform-iterations",
      "pilot-cutover-package-manifest.template.json"
    ),
    "utf8"
  ));
  assert.equal(manifest.schemaVersion, "pilot-cutover-package-manifest-v1");
  assert.deepEqual(Object.keys(manifest.reportFiles).sort(), [
    "adapterRuntime",
    "businessLoop",
    "externalReleaseEvidence",
    "jointTests",
    "operations",
    "reconciliation"
  ]);
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(
    packageJson.scripts["platform:cutover-package"],
    "node scripts/platform-cutover-package.js"
  );
  assert.equal(
    packageJson.scripts["platform:cutover-authorization"],
    "node scripts/platform-cutover-authorization.js"
  );
  for (const [file, schemaVersion] of [
    ["pilot-cutover-register-evidence.template.json", "pilot-cutover-register-evidence-v1"],
    ["pilot-cutover-record-approval.template.json", "pilot-cutover-record-approval-v1"],
    ["pilot-cutover-revoke.template.json", "pilot-cutover-revoke-v1"]
  ]) {
    const template = JSON.parse(fs.readFileSync(
      path.join(ROOT, "docs", "evidence-templates", "platform-iterations", file),
      "utf8"
    ));
    assert.equal(template.schemaVersion, schemaVersion);
  }
});
