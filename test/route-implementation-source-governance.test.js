"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { buildMatrix, readRouteSources } = require("../scripts/api-authorization-matrix");
const { buildProductionApiCatalog } = require("../scripts/production-api-catalog");
const {
  readRuntimeSource,
  routeImplementationSourceRecords,
  routeSourceDomain,
  routeSourceFiles,
  routeSourceRecords,
  validateRegisteredRouteSource
} = require("../src/http/runtime-source");

const ROOT = path.resolve(__dirname, "..");
const IMPLEMENTATION_SOURCE = "src/clinical-specialties/blood/http-handler.js";
const ROUTE_FACADE = "src/http/routes/index.js";

function registration(overrides = {}) {
  return {
    subdomain: "blood",
    source: IMPLEMENTATION_SOURCE,
    mountedBy: [ROUTE_FACADE],
    ...overrides
  };
}

function writeFile(root, relative, value) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
  return file;
}

function fixtureRegistry(registrations = [registration()]) {
  return {
    domain: "clinical-specialties",
    processOwner: "T06",
    routeSourceRoot: "src/http/routes",
    routeImplementationSources: registrations,
    subdomains: [{
      id: "blood",
      targetSourceRoot: "src/clinical-specialties/blood",
      routePrefixes: ["/api/blood-system"]
    }]
  };
}

function createFixture(t, registrations) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-city-route-sources-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  writeFile(root, "server.js", "// fixture composition root\n");
  writeFile(root, ROUTE_FACADE, "require(\"./missing-local-module\"); module.exports = require(\"../../clinical-specialties/blood/http-handler\");\n");
  writeFile(root, IMPLEMENTATION_SOURCE, `
    // REGISTERED_IMPLEMENTATION_FIXTURE
    if (req.method === "POST" && url.pathname === "/api/blood-system/route-source-fixture") {
      const user = requireApiRole(req, res, ["commission"], "/api/blood-system/route-source-fixture");
      if (!user) return true;
      return true;
    }
  `);
  writeFile(root, "config/clinical-subdomains.json", `${JSON.stringify(fixtureRegistry(registrations), null, 2)}\n`);
  return root;
}

function replaceRegistry(root, registrations) {
  fs.writeFileSync(
    path.join(root, "config", "clinical-subdomains.json"),
    `${JSON.stringify(fixtureRegistry(registrations), null, 2)}\n`
  );
}

function writeRegistry(root, registry) {
  fs.writeFileSync(path.join(root, "config", "clinical-subdomains.json"), `${JSON.stringify(registry, null, 2)}\n`);
}

test("main registry preserves the current route source inventory", () => {
  const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "clinical-subdomains.json"), "utf8"));
  const registeredSources = routeImplementationSourceRecords(ROOT);
  assert.deepEqual(registry.routeImplementationSources, registeredSources);
  assert.equal(
    routeSourceFiles(ROOT).every((file) =>
      file.includes(`${path.sep}src${path.sep}http${path.sep}routes${path.sep}`) ||
      registeredSources.some((entry) => path.join(ROOT, entry.source) === file)
    ),
    true
  );

  const matrix = buildMatrix();
  const catalog = buildProductionApiCatalog(matrix);
  assert.equal(matrix.generatedFrom, registeredSources.length
    ? "src/http/routes/**/*.js + config/clinical-subdomains.json#routeImplementationSources"
    : "src/http/routes/**/*.js");
  assert.equal(matrix.summary.declarations, matrix.routes.length);
  assert.equal(matrix.summary.declarations >= 606, true);
  assert.equal(catalog.summary.literalRouteInventory >= 373, true);
  assert.equal(catalog.summary.entries >= 598, true);
  assert.equal(catalog.summary.declarations, matrix.routes.length);
});

test("legacy route source entries retain their path-derived owner fallback", () => {
  const legacySources = readRouteSources(ROOT).map((entry) => ({
    file: entry.file,
    source: entry.source
  }));
  const matrix = buildMatrix(legacySources);
  const catalog = buildProductionApiCatalog(matrix, legacySources);
  assert.equal(matrix.generatedFrom, "src/http/routes/**/*.js");
  assert.equal(matrix.summary.declarations, matrix.routes.length);
  assert.equal(matrix.summary.declarations >= 606, true);
  assert.equal(matrix.routes.find((route) => route.key === "GET /api/public-health/highlights").owner, "T03");
  assert.equal(catalog.summary.entries >= 598, true);
  assert.equal(catalog.summary.declarations, matrix.routes.length);
});

test("registered implementation sources feed runtime, matrix and catalog with one shared owner", (t) => {
  const root = createFixture(t, [
    registration(),
    registration()
  ]);
  const implementationFile = path.join(root, IMPLEMENTATION_SOURCE);
  const files = routeSourceFiles(root);
  assert.equal(files.filter((file) => file === implementationFile).length, 1);
  assert.equal(routeSourceDomain(implementationFile, root), "clinical-specialties");
  assert.match(readRuntimeSource(root), /REGISTERED_IMPLEMENTATION_FIXTURE/);

  const fixtureSources = readRouteSources(root);
  const implementation = fixtureSources.find((entry) => entry.file === implementationFile);
  assert.equal(implementation.domain, "clinical-specialties");
  assert.equal(implementation.owner, "T06");
  assert.equal(implementation.subdomain, "blood");
  assert.equal(implementation.sourceKind, "registered-implementation");

  const sourceFiles = [...readRouteSources(ROOT), implementation];
  const matrix = buildMatrix(sourceFiles);
  const key = "POST /api/blood-system/route-source-fixture";
  const declaration = matrix.routes.find((route) => route.key === key);
  assert.equal(matrix.generatedFrom, "src/http/routes/**/*.js + config/clinical-subdomains.json#routeImplementationSources");
  assert.equal(declaration.domain, "clinical-specialties");
  assert.equal(declaration.owner, "T06");
  assert.equal(declaration.subdomain, "blood");

  const catalog = buildProductionApiCatalog(matrix, sourceFiles);
  const entry = catalog.entries.find((candidate) => candidate.key === key);
  assert.equal(entry.domain, "clinical-specialties");
  assert.equal(entry.owner, "T06");
  assert.equal(entry.subdomain, "blood");
  assert.equal(entry.sourceCoverage, "authorization-matrix-and-route-inventory");

  const driftedSources = sourceFiles.map((source) => source === implementation ? {
    ...source,
    source: source.source.replaceAll("/api/blood-system/route-source-fixture", "/api/blood-system/route-source-drift")
  } : source);
  const driftedMatrix = buildMatrix(driftedSources);
  const driftedCatalog = buildProductionApiCatalog(driftedMatrix, driftedSources);
  assert.equal(driftedMatrix.routes.some((route) => route.key === key), false);
  assert.equal(driftedCatalog.entries.some((candidate) => candidate.key === key), false);
  assert.equal(driftedCatalog.entries.some((candidate) => candidate.key === "POST /api/blood-system/route-source-drift"), true);
});

test("inventory-only registered implementations retain the registry domain and owner", (t) => {
  const root = createFixture(t);
  const implementation = readRouteSources(root).find((entry) => entry.sourceKind === "registered-implementation");
  const sourceFiles = [{
    ...implementation,
    source: `if (req.method === "POST" && url.pathname === "/api/blood-system/inventory-only-fixture") return true;`
  }];
  const matrix = {
    schemaVersion: "api-authorization-matrix-v3",
    generatedFrom: "synthetic-registered-implementation",
    routes: []
  };
  const entry = buildProductionApiCatalog(matrix, sourceFiles).entries[0];
  assert.equal(entry.domain, "clinical-specialties");
  assert.equal(entry.owner, "T06");
  assert.equal(entry.subdomain, "blood");
  assert.equal(entry.sourceCoverage, "route-inventory-only");
});

test("registered implementation paths fail closed outside their declared source boundary", (t) => {
  const root = createFixture(t);
  writeFile(root, "src/outside-handler.js", "// outside\n");
  writeFile(root, "src/clinical-specialties/blood/not-javascript.txt", "// text\n");
  fs.mkdirSync(path.join(root, "src/clinical-specialties/blood/directory.js"));

  const cases = [
    [registration({ source: "src/clinical-specialties/blood/missing.js" }), /does not exist or is not a file/],
    [registration({ source: "src/outside-handler.js" }), /outside blood targetSourceRoot/],
    [registration({ source: "src/clinical-specialties/blood/not-javascript.txt" }), /must be a \.js file/],
    [registration({ source: "src/clinical-specialties/blood/directory.js" }), /does not exist or is not a file/],
    [registration({ source: "src/clinical-specialties/blood/..\/blood/http-handler.js" }), /normalized repository-relative path/],
    [registration({ subdomain: "unknown" }), /unknown subdomain/],
    [{ ...registration(), owner: "T00" }, /contain only mountedBy, source and subdomain/],
    [{ subdomain: "blood", source: IMPLEMENTATION_SOURCE }, /at least one mountedBy/],
    [registration({ mountedBy: ["src/http/routes/missing.js"] }), /existing route source file/]
  ];

  for (const [registration, error] of cases) {
    replaceRegistry(root, [registration]);
    assert.throws(() => routeSourceFiles(root), error);
  }

  fs.writeFileSync(
    path.join(root, "config", "clinical-subdomains.json"),
    `${JSON.stringify({ ...fixtureRegistry(), routeImplementationSources: {} }, null, 2)}\n`
  );
  assert.throws(() => routeSourceFiles(root), /must be an array/);
});

test("registered implementations enforce canonical ownership, route prefixes and static mounting", (t) => {
  const root = createFixture(t);
  const registryFile = path.join(root, "config", "clinical-subdomains.json");
  fs.writeFileSync(registryFile, `${JSON.stringify({ ...fixtureRegistry(), processOwner: "T00" }, null, 2)}\n`);
  assert.throws(() => routeSourceFiles(root), /canonical ownership/);

  fs.writeFileSync(registryFile, `${JSON.stringify(fixtureRegistry(), null, 2)}\n`);
  fs.writeFileSync(path.join(root, IMPLEMENTATION_SOURCE), `
    if (req.method === "POST" && url.pathname === "/api/imaging-cloud/drift") {
      return requireApiRole(req, res, ["commission"], "/api/imaging-cloud/drift");
    }
  `);
  assert.throws(() => routeSourceFiles(root), /outside its single subdomain prefix/);

  const nonCanonicalRoot = fixtureRegistry();
  nonCanonicalRoot.subdomains[0].targetSourceRoot = "src/clinical-specialties/./blood";
  fs.writeFileSync(registryFile, `${JSON.stringify(nonCanonicalRoot, null, 2)}\n`);
  assert.throws(() => routeSourceFiles(root), /targetSourceRoot must be a normalized repository-relative path/);

  fs.writeFileSync(path.join(root, IMPLEMENTATION_SOURCE), `
    if (req.method === "POST" && url.pathname === "/api/blood-system/valid") {
      return requireApiRole(req, res, ["commission"], "/api/blood-system/valid");
    }
  `);
  fs.writeFileSync(registryFile, `${JSON.stringify(fixtureRegistry(), null, 2)}\n`);
  fs.writeFileSync(path.join(root, ROUTE_FACADE), "module.exports = {};\n");
  assert.throws(() => routeSourceFiles(root), /does not statically require source/);
});

test("registered implementations reject comment-only and string-only mount evidence", (t) => {
  const root = createFixture(t);
  const targetRequire = "require(\"../../clinical-specialties/blood/http-handler\")";
  const facades = [
    `// ${targetRequire}\nmodule.exports = {};\n`,
    `/* ${targetRequire} */\nmodule.exports = {};\n`,
    `const note = '${targetRequire}';\nmodule.exports = {};\n`,
    `const note = \`${targetRequire}\`;\nmodule.exports = {};\n`,
    "require = null; require(dynamicPath); module.exports = {};\n",
    "/* unterminated comment",
    "const note = 'unterminated string",
    "const marker = /unterminated regex",
    "require(\"../../clinical-specialties/blood\\/http-handler\");",
    "require('unterminated literal"
  ];
  for (const facade of facades) {
    fs.writeFileSync(path.join(root, ROUTE_FACADE), facade);
    assert.throws(() => routeSourceFiles(root), /does not statically require source/);
  }
});

test("registered implementations reject regex-only mount evidence", (t) => {
  const root = createFixture(t);
  fs.writeFileSync(
    path.join(root, ROUTE_FACADE),
    "module.exports = {}; const marker = /require(\\\"..\\/..\\/clinical-specialties\\/blood\\/http-handler\\\")/g;\n"
  );
  assert.throws(() => routeSourceFiles(root), /does not statically require source/);
  fs.writeFileSync(
    path.join(root, ROUTE_FACADE),
    "const n = 4 / 2; /* require(\"../../clinical-specialties/blood/http-handler\") */ module.exports = {};\n"
  );
  assert.throws(() => routeSourceFiles(root), /does not statically require source/);
});

test("registered implementations reject Node hashbang and HTML-like comment mount evidence", (t) => {
  const root = createFixture(t);
  const targetRequire = "require(\"../../clinical-specialties/blood/http-handler\")";
  for (const facade of [
    `\uFEFF#! ${targetRequire}\nmodule.exports = {};\n`,
    `<!-- ${targetRequire}\nmodule.exports = {};\n`,
    `  --> ${targetRequire}\nmodule.exports = {};\n`
  ]) {
    fs.writeFileSync(path.join(root, ROUTE_FACADE), facade);
    assert.throws(() => routeSourceFiles(root), /does not statically require source/);
  }

  fs.writeFileSync(
    path.join(root, ROUTE_FACADE),
    `const a = 1; const b = 0; a --> b; module.exports = ${targetRequire};\n`
  );
  assert.equal(routeImplementationSourceRecords(root).length, 1);
});

test("matrix and catalog reject registered source-content prefix drift", (t) => {
  const root = createFixture(t);
  const implementation = readRouteSources(root).find((entry) => entry.sourceKind === "registered-implementation");
  const drifted = [{ ...implementation, source: implementation.source.replaceAll("/api/blood-system", "/api/imaging-cloud") }];
  assert.throws(() => buildMatrix(drifted), /outside its single subdomain prefix/);
  assert.throws(() => buildProductionApiCatalog({ schemaVersion: "api-authorization-matrix-v3", generatedFrom: "fixture", routes: [] }, drifted), /outside its single subdomain prefix/);
});

test("registered source validation fails closed for absent literals, prefixes and bound authorization paths", () => {
  assert.throws(() => validateRegisteredRouteSource({ subdomain: "blood", routePrefixes: [] }, "/api/blood-system"), /has no route prefixes/);
  assert.throws(() => validateRegisteredRouteSource({ subdomain: "blood", routePrefixes: ["/api/blood-system"] }, "module.exports = {};"), /has no API literal/);
  assert.throws(() => validateRegisteredRouteSource(
    { subdomain: "blood", routePrefixes: ["/api/blood-system"] },
    "const marker = '/api/blood-system'; requireApiRole(req, res, ['commission'], routePath);"
  ), /authorization declaration must bind one subdomain API path/);
});

test("registry and route-directory absence retain explicit empty behavior", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "health-city-route-sources-empty-"));
  t.after(() => fs.rmSync(root, { force: true, recursive: true }));
  assert.deepEqual(routeImplementationSourceRecords(root), []);
  assert.deepEqual(routeImplementationSourceRecords(root, { domain: "clinical-specialties", processOwner: "T06", subdomains: [] }), []);
  assert.deepEqual(routeSourceRecords(root), []);
});

test("registered implementation registry rejects malformed structural boundaries", (t) => {
  const root = createFixture(t);
  const duplicateSubdomains = fixtureRegistry();
  duplicateSubdomains.subdomains.push({ ...duplicateSubdomains.subdomains[0] });
  writeRegistry(root, duplicateSubdomains);
  assert.throws(() => routeSourceFiles(root), /subdomains must have unique ids/);

  writeRegistry(root, fixtureRegistry([null]));
  assert.throws(() => routeSourceFiles(root), /registration must be an object/);

  const missingTarget = fixtureRegistry([registration({ source: "src/clinical-specialties/missing/http-handler.js" })]);
  missingTarget.subdomains[0].targetSourceRoot = "src/clinical-specialties/missing";
  writeRegistry(root, missingTarget);
  assert.throws(() => routeSourceFiles(root), /targetSourceRoot does not exist/);

  const missingPrefixes = fixtureRegistry();
  missingPrefixes.subdomains[0].routePrefixes = [];
  writeRegistry(root, missingPrefixes);
  assert.throws(() => routeSourceFiles(root), /declare normalized API route prefixes/);

  writeRegistry(root, { ...fixtureRegistry(), routeSourceRoot: "src/http/./routes" });
  assert.throws(() => routeSourceFiles(root), /routeSourceRoot must be a normalized repository-relative path/);

  writeRegistry(root, { ...fixtureRegistry(), routeSourceRoot: "src/http/missing-routes" });
  assert.throws(() => routeSourceFiles(root), /routeSourceRoot must be a real repository directory/);

  writeRegistry(root, fixtureRegistry([registration({ mountedBy: ["src/http/routes/../routes/index.js"] })]));
  assert.throws(() => routeSourceFiles(root), /mountedBy must be a normalized repository-relative/);
});

test("registered source refuses nested target aliases and route-facade aliases", (t) => {
  const root = createFixture(t);
  const actualSourceRoot = path.join(root, "src/clinical-specialties/blood-actual");
  fs.mkdirSync(actualSourceRoot, { recursive: true });
  fs.writeFileSync(path.join(actualSourceRoot, "http-handler.js"), fs.readFileSync(path.join(root, IMPLEMENTATION_SOURCE)));
  const nestedAlias = path.join(root, "src/clinical-specialties/blood/alias");
  try {
    fs.symlinkSync(actualSourceRoot, nestedAlias, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symbolic directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  const aliasSource = "src/clinical-specialties/blood/alias/http-handler.js";
  writeRegistry(root, fixtureRegistry([registration({ source: aliasSource })]));
  fs.writeFileSync(path.join(root, ROUTE_FACADE), "module.exports = require(\"../../clinical-specialties/blood/alias/http-handler\");\n");
  assert.throws(() => routeSourceFiles(root), /source resolves outside blood targetSourceRoot/);

  fs.rmSync(nestedAlias, { force: true, recursive: true });
  writeRegistry(root, fixtureRegistry());
  const realFacadeDirectory = path.join(root, "src/http/routes/real-facade");
  fs.mkdirSync(realFacadeDirectory, { recursive: true });
  fs.writeFileSync(path.join(realFacadeDirectory, "index.js"), "module.exports = require(\"../../../clinical-specialties/blood/http-handler\");\n");
  const facadeAlias = path.join(root, "src/http/routes/facade-alias");
  fs.symlinkSync(realFacadeDirectory, facadeAlias, process.platform === "win32" ? "junction" : "dir");
  writeRegistry(root, fixtureRegistry([registration({ mountedBy: ["src/http/routes/facade-alias/index.js"] })]));
  assert.throws(() => routeSourceFiles(root), /mountedBy must not use a filesystem alias/);
});

test("registered source refuses an alias that resolves elsewhere inside its target root", (t) => {
  const root = createFixture(t);
  const actualDirectory = path.join(root, "src/clinical-specialties/blood/actual");
  fs.mkdirSync(actualDirectory, { recursive: true });
  fs.writeFileSync(path.join(actualDirectory, "http-handler.js"), fs.readFileSync(path.join(root, IMPLEMENTATION_SOURCE)));
  const aliasDirectory = path.join(root, "src/clinical-specialties/blood/alias");
  try {
    fs.symlinkSync(actualDirectory, aliasDirectory, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symbolic directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  writeRegistry(root, fixtureRegistry([registration({ source: "src/clinical-specialties/blood/alias/http-handler.js" })]));
  fs.writeFileSync(path.join(root, ROUTE_FACADE), "module.exports = require(\"../../clinical-specialties/blood/alias/http-handler\");\n");
  assert.throws(() => routeSourceFiles(root), /source must not use a filesystem alias/);
});

test("one registered handler cannot acquire two subdomain owners", (t) => {
  const root = createFixture(t);
  const registry = fixtureRegistry([registration(), registration({ subdomain: "blood-peer" })]);
  registry.subdomains.push({
    id: "blood-peer",
    targetSourceRoot: "src/clinical-specialties/blood",
    routePrefixes: ["/api/blood-system"]
  });
  writeRegistry(root, registry);
  assert.throws(() => routeSourceFiles(root), /multiple subdomain owners/);
});

test("registered implementation target roots cannot resolve outside the repository", (t) => {
  const root = createFixture(t);
  const targetSourceRoot = path.join(root, "src/clinical-specialties/blood");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "health-city-route-sources-outside-"));
  t.after(() => fs.rmSync(outside, { force: true, recursive: true }));
  fs.rmSync(targetSourceRoot, { force: true, recursive: true });
  fs.writeFileSync(path.join(outside, "http-handler.js"), "// outside repository\n");
  try {
    fs.symlinkSync(outside, targetSourceRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symbolic directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => routeSourceFiles(root), /targetSourceRoot resolves outside the repository/);
});

test("registered implementation target roots cannot alias another repository directory", (t) => {
  const root = createFixture(t);
  const targetSourceRoot = path.join(root, "src/clinical-specialties/blood");
  const actual = path.join(root, "src/clinical-specialties/blood-actual");
  fs.renameSync(targetSourceRoot, actual);
  try {
    fs.symlinkSync(actual, targetSourceRoot, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`symbolic directory links unavailable: ${error.code}`);
      return;
    }
    throw error;
  }
  assert.throws(() => routeSourceFiles(root), /must not be a filesystem alias/);
});
