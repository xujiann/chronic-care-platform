"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { FOUNDATION_CONTRACTS, validateFoundationContracts } = require("../src/http/contracts/foundation-contracts");
const { ROUTE_SUBDOMAINS } = require("../src/http/route-subdomains");
const { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts } = require("../src/http/runtime-contexts");
const { createPlatformApiRouter } = require("../src/http/routes");
const { loadRegionalRuntime } = require("../src/platform/regional/regional-runtime");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

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

test("runtime composition reaches the router manifest with governance, public-health and clinical subdomains", () => {
  const router = createPlatformApiRouter(createPlatformRuntimeContexts(completeRuntimeSource(), {
    regionalRuntime: loadRegionalRuntime({ root: ROOT })
  }));
  const splitSegments = router.manifest.filter(({ subdomain }) => subdomain);

  assert.equal(splitSegments.length, 27);
  assert.deepEqual(
    Object.fromEntries(splitSegments.map(({ id, subdomain }) => [id, subdomain])),
    ROUTE_SUBDOMAINS
  );
  assert.equal(router.manifest.length, 80);
  assert.equal(router.manifest.some((item) => item.id === "regional-01" && item.domain === "regional"), true);
  assert.equal(router.manifest.some((item) => item.id === "regional-02" && item.domain === "regional"), true);
});

test("router entry rejects the flat global runtime source", () => {
  assert.throws(
    () => createPlatformApiRouter(completeRuntimeSource()),
    /requires projected runtime contexts/
  );
});

test("contract validation fails when a participant loses a required capability", () => {
  const contexts = { ...createPlatformRuntimeContexts(completeRuntimeSource()).contexts };
  contexts.integration = {};
  assert.throws(() => validateFoundationContracts(contexts), /foundation contract violation/);
});
