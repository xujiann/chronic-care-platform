"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FOUNDATION_CONTRACTS, validateFoundationContracts } = require("../src/http/contracts/foundation-contracts");
const { ROUTE_SUBDOMAINS } = require("../src/http/route-subdomains");
const { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts } = require("../src/http/runtime-contexts");
const { createPlatformApiRouter } = require("../src/http/routes");

function completeRuntimeSource() {
  const names = [...new Set(Object.values(CONTEXT_DEFINITIONS).flatMap(({ dependencies }) => dependencies))];
  return Object.fromEntries(names.map((name) => [name, () => name]));
}

test("identity, payment and external integration contracts close across bounded contexts", () => {
  const runtimeContexts = createPlatformRuntimeContexts(completeRuntimeSource());
  const results = validateFoundationContracts(runtimeContexts.contexts);

  assert.deepEqual(results.map(({ id }) => id), [
    "identity-authorization", "financial-external-dispatch", "signed-appointment-event"
  ]);
  assert.equal(results.every(({ version, missing }) => version === "1.0.0" && missing.length === 0), true);
  assert.equal(FOUNDATION_CONTRACTS.every(({ participants }) => Object.keys(participants).length >= 2), true);
});

test("runtime composition reaches the router manifest with public-health and clinical subdomains", () => {
  const router = createPlatformApiRouter(completeRuntimeSource());
  const splitSegments = router.manifest.filter(({ subdomain }) => subdomain);

  assert.equal(splitSegments.length, 13);
  assert.deepEqual(
    Object.fromEntries(splitSegments.map(({ id, subdomain }) => [id, subdomain])),
    ROUTE_SUBDOMAINS
  );
  assert.equal(router.manifest.length, 71);
});

test("contract validation fails when a participant loses a required capability", () => {
  const contexts = { ...createPlatformRuntimeContexts(completeRuntimeSource()).contexts };
  contexts.integration = {};
  assert.throws(() => validateFoundationContracts(contexts), /foundation contract violation/);
});
