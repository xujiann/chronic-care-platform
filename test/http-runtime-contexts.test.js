"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { CONTEXT_DEFINITIONS, createPlatformRuntimeContexts } = require("../src/http/runtime-contexts");

const ROOT = path.resolve(__dirname, "..");

function dependencyDeclaration(source, label) {
  const match = source.match(/const \{ ([^}]+) \} = runtime;/);
  assert.ok(match, `route dependency declaration missing for ${label}`);
  return match[1].split(",").map((value) => value.trim());
}

function runtimeDependencies(domain) {
  const routeRoot = path.join(ROOT, "src", "http", "routes");
  const facade = fs.readFileSync(path.join(routeRoot, `${domain}.js`), "utf8");
  if (facade.includes("const { ")) {
    return { aggregate: dependencyDeclaration(facade, domain), subdomains: {} };
  }
  const subdomains = Object.fromEntries(
    fs.readdirSync(path.join(routeRoot, domain))
      .filter((file) => file.endsWith(".js"))
      .sort()
      .map((file) => [
        path.basename(file, ".js"),
        dependencyDeclaration(fs.readFileSync(path.join(routeRoot, domain, file), "utf8"), `${domain}/${file}`)
      ])
  );
  const aggregate = [...new Set(Object.values(subdomains).flat())].sort();
  return { aggregate, subdomains };
}

test("all route domain contexts match their dependencies exactly", () => {
  assert.deepEqual(Object.keys(CONTEXT_DEFINITIONS).sort(), [
    "care-coordination", "citizen-chronic", "clinical-specialties", "identity-security", "insurance-payment",
    "integration", "platform-governance", "public-health", "research", "runtime", "shared", "state-data"
  ]);
  for (const [domain, definition] of Object.entries(CONTEXT_DEFINITIONS)) {
    const declared = runtimeDependencies(domain);
    if (Object.keys(definition.subdomains).length > 0) {
      assert.deepEqual(definition.subdomains, declared.subdomains);
      assert.deepEqual([...definition.dependencies].sort(), declared.aggregate);
    } else if (Object.keys(declared.subdomains).length > 0) {
      const declarations = Object.values(declared.subdomains);
      declarations.slice(1).forEach((dependencies) => assert.deepEqual(dependencies, declarations[0]));
      assert.deepEqual(definition.dependencies, declarations[0]);
    } else {
      assert.deepEqual(definition.dependencies, declared.aggregate);
    }
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

test("subdomain contexts are independent frozen projections", () => {
  const definition = require("../src/http/runtime-contexts/context-factory").defineRuntimeContext({
    domain: "example",
    process: "T00",
    dependencies: ["alpha", "beta", "shared"],
    subdomains: {
      first: ["alpha", "shared"],
      second: ["beta", "shared"]
    }
  });
  const source = { alpha: 1, beta: 2, shared: 3, globalSecret: 4 };
  const first = definition.createSubcontext("first", definition.create(source));
  const second = definition.createSubcontext("second", definition.create(source));

  assert.deepEqual(first, { alpha: 1, shared: 3 });
  assert.deepEqual(second, { beta: 2, shared: 3 });
  assert.equal(Object.isFrozen(first), true);
  assert.equal("beta" in first, false);
  assert.equal("globalSecret" in second, false);
  assert.throws(() => definition.createSubcontext("unknown", source), /unknown runtime subcontext/);
});

test("subdomain definitions cannot escape or leave aggregate dependencies unused", () => {
  const { defineRuntimeContext } = require("../src/http/runtime-contexts/context-factory");
  assert.throws(
    () => defineRuntimeContext({
      domain: "escape",
      process: "T00",
      dependencies: ["owned"],
      subdomains: { invalid: ["external"] }
    }),
    /outside its domain context/
  );
  assert.throws(
    () => defineRuntimeContext({
      domain: "unused",
      process: "T00",
      dependencies: ["owned", "forgotten"],
      subdomains: { valid: ["owned"] }
    }),
    /unused by subcontexts/
  );
});

test("context construction fails fast when an owned dependency is absent", () => {
  assert.throws(
    () => CONTEXT_DEFINITIONS["citizen-chronic"].create({}),
    /runtime context citizen-chronic is missing/
  );
});
