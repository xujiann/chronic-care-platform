"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts } = require("../src/http/runtime-contexts");

const ROOT = path.resolve(__dirname, "..");

function runtimeDependencies(domain) {
  const routeRoot = path.join(ROOT, "src", "http", "routes");
  const facade = fs.readFileSync(path.join(routeRoot, `${domain}.js`), "utf8");
  const sources = facade.includes("const { ")
    ? [facade]
    : fs.readdirSync(path.join(routeRoot, domain)).sort().map((file) => fs.readFileSync(path.join(routeRoot, domain, file), "utf8"));
  const declarations = sources.map((source) => {
    const match = source.match(/const \{ ([^}]+) \} = runtime;/);
    assert.ok(match, `route dependency declaration missing for ${domain}`);
    return match[1].split(",").map((value) => value.trim());
  });
  declarations.slice(1).forEach((dependencies) => assert.deepEqual(dependencies, declarations[0]));
  return declarations[0];
}

test("all route domain contexts match their dependencies exactly", () => {
  assert.deepEqual(Object.keys(CONTEXT_DEFINITIONS).sort(), [
    "care-coordination", "citizen-chronic", "clinical-specialties", "identity-security", "insurance-payment",
    "integration", "platform-governance", "public-health", "research", "runtime", "shared", "state-data"
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
  assert.throws(() => platform.forDomain("unknown"), /unknown runtime context domain/);
});

test("context construction fails fast when an owned dependency is absent", () => {
  assert.throws(
    () => CONTEXT_DEFINITIONS["citizen-chronic"].create({}),
    /runtime context citizen-chronic is missing/
  );
});
