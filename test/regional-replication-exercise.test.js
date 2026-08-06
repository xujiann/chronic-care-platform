"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  buildExercise,
  deploymentDescriptor,
  renderMarkdown
} = require("../scripts/regional-replication-exercise");

const GENERATED_AT = "2026-08-06T12:00:00.000Z";
const GIT_COMMIT = "b".repeat(40);

test("second-region exercise validates one core and two isolated regional deployments", () => {
  const report = buildExercise({ generatedAt: GENERATED_AT, gitCommit: GIT_COMMIT });
  assert.equal(report.ok, true);
  assert.equal(report.technicalReady, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.sites.length, 2);
  assert.equal(report.governance.releases.length, 2);
  assert.equal(report.governance.releases.every((release) => release.state === "validation"), true);
  assert.equal(report.checks.length, 10);
  assert.equal(report.checks.every((check) => check.passed), true);
  assert.equal(new Set(report.sites.map((site) => site.serviceUser)).size, 2);
  assert.notEqual(report.sites[0].regionalContentDigest, report.sites[1].regionalContentDigest);
  assert.equal(report.externalBlockers.length, 5);
});

test("replication descriptor has no cross-site resource reuse", () => {
  const descriptor = deploymentDescriptor();
  assert.equal(descriptor.sites.length, 2);
  for (const field of [
    (site) => `${site.hostId}:${site.port}`,
    (site) => site.serviceName,
    (site) => site.directories.data,
    (site) => site.objectStorage.bucket,
    (site) => site.identity.oidcClientId,
    (site) => site.runtime.serviceUser
  ]) {
    assert.equal(new Set(descriptor.sites.map(field)).size, descriptor.sites.length);
  }
  assert.equal(/secret|password|token/i.test(JSON.stringify(descriptor)), false);
});

test("replication report remains explicit about technical and production boundaries", () => {
  const report = buildExercise({ generatedAt: GENERATED_AT, gitCommit: GIT_COMMIT });
  const markdown = renderMarkdown(report);
  assert.match(markdown, /Technical ready: yes/);
  assert.match(markdown, /Production ready: no/);
  assert.match(markdown, /210200/);
  assert.match(markdown, /990001/);
  assert.match(markdown, /PostgreSQL/);
});
