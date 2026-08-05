"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createRegionalExtensionRegistry } = require("../src/platform/regional/extension-registry");

function contribution(overrides = {}) {
  return {
    kind: "policy",
    id: "example-policy",
    version: "1.0.0",
    ownedDomain: "platform-governance",
    permissions: ["governance:regional-read"],
    dataCollections: ["policy-rules"],
    provide: () => ({ decision: "NO-GO" }),
    ...overrides
  };
}

test("extension registry activates only exactly declared and owned contributions", () => {
  const registry = createRegionalExtensionRegistry();
  registry.register(contribution());
  const active = registry.activate([
    {
      kind: "policy",
      id: "example-policy",
      version: "1.0.0",
      ownedDomain: "platform-governance",
      permissions: ["governance:regional-read"],
      dataCollections: ["policy-rules"],
      enabled: true
    }
  ], Object.freeze({ regionCode: "template" }));
  assert.equal(active.length, 1);
  assert.equal(active[0].value.decision, "NO-GO");
  assert.equal(Object.isFrozen(active[0].value), true);
  assert.throws(() => registry.register(contribution({ id: "late-policy" })), /sealed/);
});

test("extension registry rejects unknown, duplicate, mismatched and over-broad contributions", () => {
  const duplicate = createRegionalExtensionRegistry();
  duplicate.register(contribution());
  assert.throws(() => duplicate.register(contribution()), /duplicate/);

  const unknown = createRegionalExtensionRegistry();
  assert.throws(
    () => unknown.activate([{
      kind: "policy",
      id: "missing-policy",
      version: "1.0.0",
      ownedDomain: "platform-governance",
      permissions: ["governance:regional-read"],
      dataCollections: ["policy-rules"],
      enabled: true
    }], {}),
    /not registered/
  );

  const mismatch = createRegionalExtensionRegistry();
  mismatch.register(contribution());
  assert.throws(
    () => mismatch.activate([{
      kind: "policy",
      id: "example-policy",
      version: "2.0.0",
      ownedDomain: "platform-governance",
      permissions: ["governance:regional-read"],
      dataCollections: ["policy-rules"],
      enabled: true
    }], {}),
    /declaration mismatch/
  );

  const invalid = createRegionalExtensionRegistry();
  assert.throws(
    () => invalid.register(contribution({ ownedDomain: "global", dataCollections: ["patient-records"] })),
    /ownedDomain/
  );
});

test("extension registry rejects undeclared executable registrations", () => {
  const registry = createRegionalExtensionRegistry();
  registry.register(contribution());
  assert.throws(() => registry.activate([], {}), /not declared/);
});

test("extension registry rejects code permissions beyond the reviewed manifest", () => {
  const registry = createRegionalExtensionRegistry();
  registry.register(contribution());
  assert.throws(
    () => registry.activate([{
      kind: "policy",
      id: "example-policy",
      version: "1.0.0",
      ownedDomain: "platform-governance",
      permissions: [],
      dataCollections: ["policy-rules"],
      enabled: true
    }], {}),
    /permission declaration mismatch/
  );
});
