"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts } = require("../src/http/runtime-contexts");

const ROOT = path.resolve(__dirname, "..");

function runtimeDependencies(domain) {
  const source = fs.readFileSync(path.join(ROOT, "src", "http", "routes", `${domain}.js`), "utf8");
  const match = source.match(/const \{ ([^}]+) \} = runtime;/);
  assert.ok(match, `route dependency declaration missing for ${domain}`);
  return match[1].split(",").map((value) => value.trim());
}

test("iteration one and two contexts match their route dependencies exactly", () => {
  assert.deepEqual(Object.keys(CONTEXT_DEFINITIONS).sort(), [
    "care-coordination", "citizen-chronic", "identity-security", "insurance-payment", "integration", "runtime"
  ]);
  for (const [domain, definition] of Object.entries(CONTEXT_DEFINITIONS)) {
    assert.deepEqual(definition.dependencies, runtimeDependencies(domain));
  }
});

test("domain contexts are frozen projections and do not leak global dependencies", () => {
  const names = [...new Set(Object.values(CONTEXT_DEFINITIONS).flatMap(({ dependencies }) => dependencies))];
  const source = Object.fromEntries(names.map((name) => [name, Symbol(name)]));
  source.globalSecret = "must-not-leak";
  const platform = createPlatformRuntimeContexts(source);

  for (const [domain, context] of Object.entries(platform.contexts)) {
    assert.equal(Object.isFrozen(context), true);
    assert.equal("globalSecret" in context, false);
    assert.deepEqual(Object.keys(context), CONTEXT_DEFINITIONS[domain].dependencies);
  }
  assert.equal(platform.forDomain("research"), source);
});

test("context construction fails fast when an owned dependency is absent", () => {
  assert.throws(
    () => CONTEXT_DEFINITIONS["citizen-chronic"].create({}),
    /runtime context citizen-chronic is missing/
  );
});
