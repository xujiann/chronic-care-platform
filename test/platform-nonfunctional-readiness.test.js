"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const budgets = require("../config/platform-nonfunctional-budgets.json");
const operationsProgram = require("../config/product-operations-program.json");
const regionalProgram = require("../config/product-regional-enhancement-program.json");
const { buildPlatformNonfunctionalReadiness, fileMetrics } = require("../src/platform/governance/platform-nonfunctional-readiness");

const ROOT = path.resolve(__dirname, "..");
const BUDGET_FILES = Object.freeze([
  "citizen.js", "public-health.js", "platform.js", "operations.js",
  "regional-cutover-workbench-ui.js", "platform-productization-ui.js",
  "platform-procurement-governance-ui.js", "product-operations-ui.js",
  "product-regional-operations-ui.js"
]);

function temporaryRoot(t) {
  const parent = fs.realpathSync(os.tmpdir());
  assert.notEqual(parent, path.parse(parent).root);
  assert.doesNotMatch(parent, /(?:^|[\\/])OneDrive(?:[^\\/]*)(?:[\\/]|$)/i);
  const directory = fs.mkdtempSync(path.join(parent, "health-budget-lf-"));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(directory)), parent);
    assert.match(path.basename(directory), /^health-budget-lf-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function gitFixture(t) {
  const root = temporaryRoot(t);
  const emptyConfig = path.join(root, "empty-config");
  const emptyAttributes = path.join(root, "empty-attributes");
  const emptyTemplate = path.join(root, "empty-template");
  fs.writeFileSync(emptyConfig, "");
  fs.writeFileSync(emptyAttributes, "");
  fs.mkdirSync(emptyTemplate);
  const env = {
    ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_ATTR_NOSYSTEM: "1"
  };
  function git(cwd, args, autocrlf = "false", eol = "lf") {
    return execFileSync("git", [
      "-c", `core.attributesFile=${emptyAttributes}`,
      "-c", `core.hooksPath=${emptyTemplate}`,
      "-c", `core.autocrlf=${autocrlf}`,
      "-c", `core.eol=${eol}`,
      "-c", "core.safecrlf=false",
      ...args
    ], { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  }
  function create(name, attributes) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    git(directory, ["init", "--quiet", `--template=${emptyTemplate}`]);
    if (attributes !== undefined) fs.writeFileSync(path.join(directory, ".gitattributes"), attributes);
    return directory;
  }
  return { git, create };
}

function writeFixtureFile(root, relative, content) {
  const target = path.resolve(root, relative);
  assert.ok(target.startsWith(`${path.resolve(root)}${path.sep}`));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function fixtureBudget(root, maximumBytes, maximumLines = 20) {
  return buildPlatformNonfunctionalReadiness({ root, budgets: {
    schemaVersion: budgets.schemaVersion,
    frontendAssets: [{ file: "asset.js", maximumBytes, maximumLines }],
    runtime: { serverFile: "server.js", maximumServerLines: 1, maximumServerRequires: 0, requiredCompositionModules: [] },
    quality: { minimumTestFiles: 0, minimumRouteFiles: 0, requiredPlatformMarkers: ["<main"] }
  } });
}

test("platform nonfunctional gate locks current frontend and composition budgets", () => {
  const report = buildPlatformNonfunctionalReadiness({ root: ROOT, now: "2026-08-16T05:00:00.000Z" });
  assert.equal(report.ok, true);
  assert.equal(report.summary.assetsWithinBudget, report.summary.assets);
  assert.equal(report.summary.serverRequires, 130);
  assert.ok(report.summary.testFiles >= 353);
  assert.ok(report.summary.routeFiles >= 43);
  assert.equal(report.productionReady, false);
  assert.ok(report.externalGates.includes("load-and-capacity-test"));
  const procurementAsset = report.assets.find((item) => item.file === "platform-procurement-governance-ui.js");
  assert.equal(procurementAsset?.withinBudget, true);
  assert.equal(budgets.frontendAssets.find((item) => item.file === "platform-productization-ui.js")?.maximumBytes, 30000);
  assert.equal(budgets.frontendAssets.find((item) => item.file === "platform-procurement-governance-ui.js")?.maximumBytes, 30000);
});

test("platform nonfunctional gate rejects asset growth beyond its budget", () => {
  const strict = structuredClone(budgets);
  strict.frontendAssets[0].maximumBytes = 1;
  const report = buildPlatformNonfunctionalReadiness({ root: ROOT, budgets: strict });
  assert.equal(report.ok, false);
  assert.equal(report.checks.find((item) => item.id === "nonfunctional:frontendBudgets").passed, false);
});

test("LF checkout attributes cover exactly the nine root budget resources", () => {
  const configured = [...budgets.frontendAssets.map((item) => item.file), operationsProgram.frontendAsset.file, regionalProgram.frontend.file];
  assert.deepEqual(configured.sort(), [...BUDGET_FILES].sort());
  const rules = fs.readFileSync(path.join(ROOT, ".gitattributes"), "utf8")
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  assert.deepEqual(rules.sort(), BUDGET_FILES.map((file) => `/${file} text eol=lf`).sort());
});

test("real Git checkout keeps budget bytes LF without changing unlisted resources", (t) => {
  const { git, create } = gitFixture(t);
  const attributes = fs.readFileSync(path.join(ROOT, ".gitattributes"));
  const governed = create("governed", attributes);
  const control = create("control");
  const source = Buffer.from("const label = '示例';\nconst count = 1;\n");
  const sentinels = ["unlisted.js", "nested/citizen.js", "binary.dat"];
  const contents = new Map([...BUDGET_FILES, ...sentinels].map((file) => [
    file, file === "binary.dat" ? Buffer.from([0, 65, 13, 10, 66, 10, 255]) : source
  ]));
  for (const directory of [governed, control]) {
    for (const [file, content] of contents) writeFixtureFile(directory, file, content);
    git(directory, ["add", "--", ...contents.keys()]);
  }
  for (const autocrlf of ["true", "false", "input"]) {
    for (const eol of ["lf", "crlf"]) {
      for (const directory of [governed, control]) {
        // Configuration alone does not re-checkout existing files. Materialize the LF index anew.
        for (const file of contents.keys()) fs.unlinkSync(path.join(directory, file));
        git(directory, ["checkout-index", "--force", "--", ...contents.keys()], autocrlf, eol);
      }
      for (const file of BUDGET_FILES) {
        const content = fs.readFileSync(path.join(governed, file));
        assert.deepEqual(content, source, `${file}: autocrlf=${autocrlf}, eol=${eol}`);
        assert.deepEqual(content, git(governed, ["show", `:${file}`], autocrlf, eol));
      }
      for (const file of sentinels) {
        assert.deepEqual(fs.readFileSync(path.join(governed, file)), fs.readFileSync(path.join(control, file)), `${file}: unlisted checkout policy changed`);
      }
      assert.deepEqual(fs.readFileSync(path.join(governed, "binary.dat")), contents.get("binary.dat"));
      // core.eol alone does not classify unlisted files as text; autocrlf=true does.
      if (autocrlf === "true") {
        assert.ok(fs.readFileSync(path.join(control, "unlisted.js")).includes(Buffer.from("\r\n")), "control must exercise real CRLF conversion");
      }
    }
  }
});

test("raw file metrics and budget boundaries retain every source byte", (t) => {
  const root = temporaryRoot(t);
  writeFixtureFile(root, "platform.html", "<main></main>");
  writeFixtureFile(root, "server.js", "");
  const cases = [
    { label: "empty", content: Buffer.alloc(0), bytes: 0, lines: 1 },
    { label: "no trailing newline", content: Buffer.from("a"), bytes: 1, lines: 1 },
    { label: "LF", content: Buffer.from("a\nb\n"), bytes: 4, lines: 3 },
    { label: "CRLF", content: Buffer.from("a\r\nb\r\n"), bytes: 6, lines: 3 },
    { label: "lone CR", content: Buffer.from("a\rb"), bytes: 3, lines: 1 },
    { label: "CRCRLF", content: Buffer.from("a\r\r\n"), bytes: 4, lines: 2 },
    { label: "BOM", content: Buffer.from([239, 187, 191, 97, 10]), bytes: 5, lines: 2 },
    { label: "multibyte", content: Buffer.from("中😀\n"), bytes: 8, lines: 2 },
    { label: "invalid UTF8", content: Buffer.from([255, 13, 10]), bytes: 3, lines: 2 }
  ];
  for (const item of cases) {
    writeFixtureFile(root, "asset.js", item.content);
    assert.deepEqual(fileMetrics(root, "asset.js"), { file: "asset.js", present: true, bytes: item.bytes, lines: item.lines }, item.label);
    assert.equal(fixtureBudget(root, item.bytes, item.lines).ok, true, `${item.label}: exact limits`);
    if (item.bytes > 0) assert.equal(fixtureBudget(root, item.bytes - 1, item.lines).assets[0].withinBudget, false, `${item.label}: one byte over`);
    assert.equal(fixtureBudget(root, item.bytes, item.lines - 1).assets[0].withinBudget, false, `${item.label}: one line over`);
  }
  assert.deepEqual(fileMetrics(root, "missing.js"), { file: "missing.js", present: false, bytes: 0, lines: 0 });
  fs.unlinkSync(path.join(root, "asset.js"));
  assert.equal(fixtureBudget(root, 100).ok, false, "a missing asset must not pass as zero bytes");
});

test("budgets read uncommitted ordinary and CR byte growth, never the Git index", (t) => {
  const { git, create } = gitFixture(t);
  const root = create("uncommitted");
  writeFixtureFile(root, "platform.html", "<main></main>");
  writeFixtureFile(root, "server.js", "");
  writeFixtureFile(root, "asset.js", "a\nb\n");
  git(root, ["add", "--", "asset.js"]);
  assert.equal(fixtureBudget(root, 4, 3).ok, true);
  for (const suffix of ["x", "\r"]) {
    writeFixtureFile(root, "asset.js", `a\nb\n${suffix}`);
    assert.equal(git(root, ["show", ":asset.js"]).length, 4);
    const report = fixtureBudget(root, 4, 3);
    assert.equal(report.assets[0].bytes, 5);
    assert.equal(report.assets[0].lines, 3);
    assert.equal(report.ok, false, `uncommitted ${JSON.stringify(suffix)} must exceed raw budget`);
  }
});
