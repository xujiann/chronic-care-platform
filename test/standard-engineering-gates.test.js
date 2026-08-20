const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const STANDARD_SCRIPTS = [
  "build",
  "lint",
  "typecheck",
  "test:unit",
  "test:integration",
  "test:smoke"
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("package exposes the six approved standard engineering gates", () => {
  const pkg = JSON.parse(read("package.json"));

  for (const script of STANDARD_SCRIPTS) {
    assert.equal(typeof pkg.scripts?.[script], "string", `missing npm script: ${script}`);
    assert.notEqual(pkg.scripts[script].trim(), "", `empty npm script: ${script}`);
  }

  assert.equal(pkg.devDependencies?.eslint, "9.39.5");
  assert.equal(pkg.devDependencies?.typescript, "7.0.2");
  assert.equal(pkg.devDependencies?.["@types/node"], "22.20.1");
  assert.equal(fs.existsSync(path.join(ROOT, "eslint.config.js")), true);
  assert.equal(fs.existsSync(path.join(ROOT, "jsconfig.typecheck.json")), true);
});

test("unit and integration suites partition every root Node test while smoke stays curated", () => {
  const { listTests } = require("../scripts/test-all");
  const {
    listStandardSuite,
    validateStandardTestSuites
  } = require("../scripts/run-standard-test-suite");

  const all = listTests().map((file) => file.replaceAll("\\", "/"));
  const validation = validateStandardTestSuites();
  const unit = listStandardSuite("unit");
  const integration = listStandardSuite("integration");
  const smoke = listStandardSuite("smoke");
  const legacyIntegration = pkgTestFiles(JSON.parse(read("package.json")).scripts.test);

  assert.equal(validation.ok, true);
  assert.deepEqual([...new Set([...unit, ...integration])].sort(), all.sort());
  assert.equal(unit.some((file) => integration.includes(file)), false);
  assert.deepEqual(integration.filter((file) => file !== "test/standard-smoke.test.js"), legacyIntegration);
  assert.equal(smoke.includes("test/standard-smoke.test.js"), true);
  assert.equal(smoke.includes("test/launch-smoke.test.js"), true);
  assert.equal(smoke.every((file) => all.includes(file)), true);
});

function pkgTestFiles(command) {
  return String(command || "").match(/test\/[\w.-]+\.test\.js/g) || [];
}

test("build defaults outside the repository and preserves an explicit external output", () => {
  const { resolveStandardBuildOutput } = require("../scripts/standard-build");
  const automatic = resolveStandardBuildOutput([]);
  const explicit = path.join(os.tmpdir(), `health-platform-build-contract-${process.pid}`);

  assert.equal(path.relative(ROOT, automatic).startsWith(".."), true);
  assert.equal(resolveStandardBuildOutput([`--output=${explicit}`]), path.resolve(explicit));
});

test("CI maps standard gates without renaming required checks or weakening test:all", () => {
  const workflow = read(".github/workflows/ci.yml");
  const pages = read(".github/workflows/pages.yml");
  const pkg = JSON.parse(read("package.json"));

  assert.match(workflow, /\n  complete-unit-test:\r?\n/);
  assert.match(workflow, /npm run test:unit && npm run test:integration/);
  assert.match(workflow, /npm run lint/);
  assert.match(workflow, /npm run typecheck/);
  assert.match(workflow, /npm run test:smoke/);
  assert.match(workflow, /npm run build/);
  assert.match(pages, /npm run build -- --output="\$RUNNER_TEMP\/pages-site"/);
  assert.equal(pkg.scripts["test:all"], "node scripts/test-all.js");
});

test("type checking is explicitly incremental and lint ignores generated artifacts", () => {
  const typecheck = JSON.parse(read("jsconfig.typecheck.json"));
  const eslintSource = read("eslint.config.js");

  assert.equal(typecheck.compilerOptions.allowJs, true);
  assert.equal(typecheck.compilerOptions.checkJs, true);
  assert.equal(typecheck.compilerOptions.noEmit, true);
  assert.equal(typecheck.compilerOptions.strict, false);
  assert.equal(Array.isArray(typecheck.include), true);
  assert.equal(typecheck.include.length > 0, true);
  assert.equal(typecheck.include.includes("**/*.js"), false);
  assert.match(eslintSource, /coverage\/\*\*/);
  assert.match(eslintSource, /test-results\/\*\*/);
  assert.match(eslintSource, /no-dupe-keys/);
  assert.match(eslintSource, /no-unreachable/);
});
