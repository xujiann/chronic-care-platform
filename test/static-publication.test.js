"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const budgets = require("../config/platform-nonfunctional-budgets.json");
const operationsProgram = require("../config/product-operations-program.json");
const regionalProgram = require("../config/product-regional-enhancement-program.json");
const { buildStaticPublication, resolveOutput } = require("../scripts/static-publication");
const { collectPublicAssets, createStaticAssetPolicy, loadStaticPublicationContract } = require("../src/http/static-asset-policy");

const ROOT = path.resolve(__dirname, "..");
const EXCLUDED_INVENTORY_DIRECTORIES = new Set([".git", "node_modules", "output", "playwright-report", "release", "reports", "test-results"]);

function temporaryRoot(prefix) {
  const base = fs.realpathSync(os.tmpdir());
  assert.notEqual(base, path.parse(base).root);
  assert.doesNotMatch(base, /(?:^|[\\/])OneDrive(?:[^\\/]*)(?:[\\/]|$)/i);
  return fs.mkdtempSync(path.join(base, prefix));
}

function removeTemporaryRoot(directory) {
  assert.equal(path.isAbsolute(directory), true);
  const base = fs.realpathSync(os.tmpdir());
  const resolved = fs.realpathSync(directory);
  const relative = path.relative(base, resolved);
  assert.notEqual(resolved, path.parse(resolved).root);
  assert.doesNotMatch(resolved, /(?:^|[\\/])OneDrive(?:[^\\/]*)(?:[\\/]|$)/i);
  assert.match(relative, /^health-platform-publication-[^\\/]+$/);
  fs.rmSync(resolved, { recursive: true, force: true });
}

function listFiles(directory, root = directory) {
  const files = [];
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    if (entry.isDirectory() && EXCLUDED_INVENTORY_DIRECTORIES.has(entry.name)) return;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(target, root));
    else if (entry.isFile()) files.push(path.relative(root, target).replace(/\\/g, "/"));
  });
  return files;
}

function secretKeys(value, found = []) {
  if (Array.isArray(value)) value.forEach((entry) => secretKeys(entry, found));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, entry]) => {
      if (/^(password|passwordHash|accessToken|refreshToken|token|secret|clientSecret|privateKey|apiKey|sessionId|csrfToken)$/i.test(key)) found.push(key);
      secretKeys(entry, found);
    });
  }
  return found;
}

test("static publication contract exposes only the explicit browser graph", () => {
  const contract = loadStaticPublicationContract();
  const assets = collectPublicAssets(ROOT, contract);
  const policy = createStaticAssetPolicy({ root: ROOT, contract, assets });
  const repositoryHtml = listFiles(ROOT).filter((file) => file.endsWith(".html")).sort();

  assert.equal(contract.entrypoints.length, 57);
  assert.deepEqual([...contract.entrypoints].sort(), repositoryHtml);
  assert.equal(assets.includes("index.html"), true);
  assert.equal(assets.includes("navigation-shell.css"), true);
  assert.equal(assets.includes("data/public-demo.json"), true);
  assert.equal(assets.includes("data/db.json"), false);
  assert.equal(assets.includes("server.js"), false);
  assert.equal(assets.includes("package.json"), false);
  assert.equal(assets.some((asset) => asset.startsWith("docs/")), false);
  assert.equal(policy.evaluate("/").relativePath, "index.html");
  assert.equal(policy.evaluate("/digital-hospital-standard-platform/").relativePath, "digital-hospital-standard-platform/index.html");

  [
    "/data/db.json",
    "/server.js",
    "/package.json",
    "/.env.example",
    "/config/static-publication.json",
    "/docs/CURRENT_ARCHITECTURE.md",
    "/.git/config",
    "/%2e%2e/server.js"
  ].forEach((requestPath) => assert.equal(policy.evaluate(requestPath).allowed, false, requestPath));
});

test("static publication build writes a sanitized standalone Pages artifact", () => {
  const directory = temporaryRoot("health-platform-publication-");
  const output = path.join(directory, "site");
  try {
    const result = buildStaticPublication({ output, generatedAt: "2026-08-18T00:00:00.000Z" });
    const published = JSON.parse(fs.readFileSync(path.join(output, "data", "public-demo.json"), "utf8"));
    assert.equal(result.manifest.profile, "public-static");
    assert.equal(result.manifest.browserSecurity.contractId, "browser-security-headers.v1");
    assert.equal(result.manifest.browserSecurity.cspMode, "report-only");
    assert.equal(result.manifest.browserSecurity.productionReady, false);
    assert.equal(result.manifest.browserSecurity.externalHeaderApplicationRequired, true);
    assert.equal(result.manifest.browserSecurity.safeUrlContractId, "browser-safe-url-policy.v1");
    assert.equal(result.manifest.browserSecurity.safeUrlReviewRequiredOccurrences, 2);
    assert.equal(result.manifest.browserSecurity.inventory.total, 831);
    assert.equal(result.manifest.browserSecurity.inventory.byPriority.P0, 789);
    assert.equal(result.manifest.browserSecurity.inventory.byPriority.P1, 42);
    assert.deepEqual(listFiles(output).sort(), result.manifest.files.map((file) => file.path).sort());
    assert.equal(fs.existsSync(path.join(output, "browser-security-policy.json")), true);
    assert.equal(fs.existsSync(path.join(output, "index.html")), true);
    assert.equal(fs.existsSync(path.join(output, "server.js")), false);
    assert.equal(fs.existsSync(path.join(output, "package.json")), false);
    assert.equal(fs.existsSync(path.join(output, "data", "db.json")), false);
    assert.equal(fs.existsSync(path.join(output, "static-publication-manifest.json")), false);
    assert.deepEqual(secretKeys(published), []);
    assert.equal(published.storageMeta.publicDemoSnapshot.classification, "PUBLIC_DEMO");

    const budgetAssets = [
      ...budgets.frontendAssets.map((asset) => asset.file),
      operationsProgram.frontendAsset.file,
      regionalProgram.frontend.file
    ];
    assert.deepEqual([...budgetAssets].sort(), [
      "citizen.js", "public-health.js", "platform.js", "operations.js",
      "regional-cutover-workbench-ui.js", "platform-productization-ui.js",
      "platform-procurement-governance-ui.js", "product-operations-ui.js",
      "product-regional-operations-ui.js"
    ].sort());
    budgetAssets.forEach((file) => {
      const source = fs.readFileSync(path.join(ROOT, file));
      const artifact = fs.readFileSync(path.join(output, file));
      const entries = result.manifest.files.filter((entry) => entry.path === file);
      assert.equal(entries.length, 1, file);
      assert.deepEqual(artifact, source, file);
      assert.equal(entries[0].generated, false, file);
      assert.equal(entries[0].bytes, source.length, file);
      assert.equal(entries[0].bytes, artifact.length, file);
      assert.equal(entries[0].sha256, createHash("sha256").update(source).digest("hex"), file);
      assert.equal(entries[0].sha256, createHash("sha256").update(artifact).digest("hex"), file);
    });

    // The build records raw bytes; this detects a later mismatch, not an active rejection API.
    const alteredFile = "citizen.js";
    const entry = result.manifest.files.find((file) => file.path === alteredFile);
    fs.appendFileSync(path.join(output, alteredFile), Buffer.from([0x0d]));
    const altered = fs.readFileSync(path.join(output, alteredFile));
    assert.equal(altered.length, entry.bytes + 1);
    assert.notEqual(altered.length, entry.bytes);
    assert.notEqual(createHash("sha256").update(altered).digest("hex"), entry.sha256);
    assert.notDeepEqual(altered, fs.readFileSync(path.join(ROOT, alteredFile)));
  } finally {
    removeTemporaryRoot(directory);
  }
});

test("static publication refuses repository outputs and unapproved snapshot sources", () => {
  assert.throws(() => resolveOutput(path.join(ROOT, "..unsafe-publication")), /outside the repository/);
  const directory = temporaryRoot("health-platform-publication-source-");
  try {
    const contract = structuredClone(loadStaticPublicationContract());
    contract.generatedAssets["data/public-demo.json"].source = "../data/db.json";
    assert.throws(() => buildStaticPublication({ output: path.join(directory, "site"), contract }), /not approved/);
  } finally {
    removeTemporaryRoot(directory);
  }
});

test("static consumers and Pages workflow use the sanitized publication boundary", () => {
  const consumers = ["app.js", "citizen.js", "escort.js", "immunization.js", "internet-nursing.js", "operations.js", "public-health-highlights.js", "public-health.js", "shared.js", "service-worker.js"];
  consumers.forEach((file) => {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.doesNotMatch(content, /(?:fetch\(["']\.\/data\/db\.json|["']\.\/data\/db\.json["'])/, file);
  });
  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const standardBuild = fs.readFileSync(path.join(ROOT, "scripts", "standard-build.js"), "utf8");
  assert.match(workflow, /npm run build -- --output="\$RUNNER_TEMP\/pages-site"/);
  assert.equal(packageJson.scripts.build, "node scripts/standard-build.js");
  assert.match(standardBuild, /buildStaticPublication/);
  assert.match(workflow, /path: \$\{\{ runner\.temp \}\}\/pages-site/);
  assert.doesNotMatch(workflow, /path:\s*\.\s*$/m);
});
