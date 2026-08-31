const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
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
  assert.equal(pkg.scripts?.["test:coverage:boundaries"], "node scripts/internal-boundary-coverage.js");
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

test("the API hotspot is isolated without changing integration membership or order", () => {
  const {
    buildStandardTestBatches,
    listStandardSuite,
    loadStandardTestSuites,
    validateStandardTestSuites
  } = require("../scripts/run-standard-test-suite");
  const config = loadStandardTestSuites();
  const integration = listStandardSuite("integration", config);
  const batches = buildStandardTestBatches("integration", integration, config, 40);

  assert.equal(validateStandardTestSuites(config).ok, true);
  assert.deepEqual(config.isolated.integration, ["test/api.test.js"]);
  assert.deepEqual(batches[0], { files: ["test/api.test.js"], isolated: true });
  assert.deepEqual(batches.flatMap((batch) => batch.files), integration);
  assert.equal(batches.slice(1).every((batch) => batch.files.length <= 40), true);
});

test("the API hotspot keeps extracted lifecycles and the exact subtest order", () => {
  const apiTest = read("test/api.test.js");
  const alertMockHelper = read("test/helpers/alert-delivery-mock-runtime.js");
  const financialMockHelper = read("test/helpers/financial-gateway-mock-runtime.js");
  const runtimeHelper = read("test/helpers/api-regression-runtime.js");
  const hospitalMockHelper = read("test/helpers/hospital-adapter-mock-runtime.js");
  const storageMockHelper = read("test/helpers/object-storage-gateway-mock-runtime.js");
  const lifecycleHelperImports = [...apiTest.matchAll(/require\("\.\/helpers\/([^"]+-runtime)"\)/g)]
    .map((match) => match[1]);
  const subtestNames = [...apiTest.matchAll(/await t\.test\("([^"]+)"/g)].map((match) => match[1]);
  const orderDigest = createHash("sha256").update(subtestNames.join("\n")).digest("hex");

  assert.equal(lifecycleHelperImports.length, 5);
  assert.equal(new Set(lifecycleHelperImports).size, 5);
  assert.deepEqual([...lifecycleHelperImports].sort(), [
    "alert-delivery-mock-runtime",
    "api-regression-runtime",
    "financial-gateway-mock-runtime",
    "hospital-adapter-mock-runtime",
    "object-storage-gateway-mock-runtime"
  ]);
  assert.equal((apiTest.match(/createApiRegressionRuntime\(\)/g) || []).length, 1);
  assert.match(apiTest, /start: startApiRegressionRuntime/);
  assert.match(apiTest, /stop: stopApiRegressionRuntime/);
  assert.doesNotMatch(apiTest, /mkdtempSync|startServer\(0\)|stopServer\(\)|health-platform-test-/);
  assert.match(runtimeHelper, /mkdtempSync/);
  assert.match(runtimeHelper, /startServer\(0\)/);
  assert.match(runtimeHelper, /await once\(server, "listening"\)/);
  assert.match(runtimeHelper, /await stopServer\(\)/);
  assert.match(runtimeHelper, /rmSync\(dataDir, \{ recursive: true, force: true \}\)/);
  assert.equal((apiTest.match(/startHospitalAdapterMock\(\)/g) || []).length, 1);
  assert.match(apiTest, /port: hospitalPort,\s+requests: hospitalRequests,\s+stop: stopHospitalAdapterMock/);
  assert.match(apiTest, /t\.after\(stopHospitalAdapterMock\)/);
  assert.doesNotMatch(apiTest, /const hospitalMock = http\.createServer/);
  assert.match(hospitalMockHelper, /http\.createServer/);
  assert.match(hospitalMockHelper, /server\.listen\(0, "127\.0\.0\.1"\)/);
  assert.match(hospitalMockHelper, /await once\(server, "listening"\)/);
  assert.match(hospitalMockHelper, /receiptId: `his-provider-\$\{requests\.length\}`/);
  assert.match(hospitalMockHelper, /HIS_ADAPTER_URL = `http:\/\/127\.0\.0\.1:\$\{port\}\/his\/events`/);
  assert.match(hospitalMockHelper, /await new Promise\(\(resolve\) => server\.close\(resolve\)\)/);
  assert.equal((apiTest.match(/startAlertDeliveryMock\(\)/g) || []).length, 1);
  assert.match(apiTest, /port: alertPort,\s+requests: alertRequests,\s+setDeliveryFailure,\s+stop: stopAlertDeliveryMock/);
  assert.match(apiTest, /t\.after\(stopAlertDeliveryMock\)/);
  assert.match(apiTest, /setDeliveryFailure\(true\)[\s\S]+setDeliveryFailure\(false\)/);
  assert.doesNotMatch(apiTest, /const alertMock = http\.createServer|let failDelivery = false/);
  assert.equal((alertMockHelper.match(/http\.createServer/g) || []).length, 1);
  assert.match(alertMockHelper, /server\.listen\(0, "127\.0\.0\.1"\)/);
  assert.match(alertMockHelper, /response\.writeHead\(failDelivery \? 503 : 200/);
  assert.match(alertMockHelper, /receiver temporarily unavailable/);
  assert.match(alertMockHelper, /eventId: `siem-event-\$\{requests\.length\}`/);
  assert.match(alertMockHelper, /SIEM_ENDPOINT = `http:\/\/127\.0\.0\.1:\$\{port\}\/events`/);
  assert.match(alertMockHelper, /server\.closeAllConnections\?\.\(\)/);
  assert.equal((apiTest.match(/startFinancialGatewayMock\(\)/g) || []).length, 1);
  assert.match(apiTest, /port: financialPort,\s+requests: financialRequests,\s+stop: stopFinancialGatewayMock/);
  assert.match(apiTest, /t\.after\(stopFinancialGatewayMock\)/);
  assert.doesNotMatch(apiTest, /const financialMock = http\.createServer/);
  assert.equal((financialMockHelper.match(/http\.createServer/g) || []).length, 1);
  assert.match(financialMockHelper, /server\.listen\(0, "127\.0\.0\.1"\)/);
  assert.match(financialMockHelper, /payment-provider-\$\{requests\.length\}/);
  assert.match(financialMockHelper, /insurance-provider-\$\{requests\.length\}/);
  assert.match(financialMockHelper, /certificate-provider-\$\{requests\.length\}/);
  assert.match(financialMockHelper, /PAYMENT_GATEWAY_URL = `http:\/\/127\.0\.0\.1:\$\{port\}\/payment`/);
  assert.match(financialMockHelper, /FINANCIAL_CALLBACK_SECRET = "api-test-financial-callback-secret"/);
  assert.match(financialMockHelper, /server\.closeAllConnections\?\.\(\)/);
  assert.equal((apiTest.match(/startObjectStorageGatewayMock\(\)/g) || []).length, 1);
  assert.match(apiTest, /port: storagePort,\s+requests: storageRequests,\s+setScanStatus,\s+stop: stopObjectStorageGatewayMock/);
  assert.match(apiTest, /t\.after\(stopObjectStorageGatewayMock\)/);
  assert.match(apiTest, /setScanStatus\(providerScanText\)/);
  assert.doesNotMatch(apiTest, /const storageMock = http\.createServer|const sendStorageResponse|let scanStatus = "clean"/);
  assert.equal((storageMockHelper.match(/http\.createServer/g) || []).length, 1);
  assert.match(storageMockHelper, /server\.listen\(0, "127\.0\.0\.1"\)/);
  assert.match(storageMockHelper, /function setScanStatus\(value\) \{\s+scanStatus = value;/);
  assert.match(storageMockHelper, /signGatewayResponse\(responseText, RECEIPT_SECRET/);
  assert.match(storageMockHelper, /"X-Object-Storage-Contract": "object-storage-gateway-trust-v1"/);
  assert.match(storageMockHelper, /request\.url === "\/storage\/upload-intents"/);
  assert.match(storageMockHelper, /request\.url === "\/storage\/objects\/complete"/);
  assert.match(storageMockHelper, /request\.url === "\/storage\/download-intents"/);
  assert.match(storageMockHelper, /receiptId: `lifecycle-receipt-\$\{body\.attachmentId\}`/);
  assert.match(storageMockHelper, /OBJECT_STORAGE_GATEWAY_URL = `http:\/\/127\.0\.0\.1:\$\{port\}\/storage\/`/);
  assert.match(storageMockHelper, /OBJECT_STORAGE_RECEIPT_SIGNING_SECRET = RECEIPT_SECRET/);
  assert.match(storageMockHelper, /server\.closeAllConnections\?\.\(\)/);
  assert.equal(subtestNames.length, 43);
  assert.equal(orderDigest, "67d6d0c4ffaad052e1b1a0380b961168d192be087752aa72828998b561c84c27");
});

test("standard suite metrics are emitted for success without a time threshold", () => {
  const { runStandardSuite } = require("../scripts/run-standard-test-suite");
  const originalWrite = process.stdout.write;
  const output = [];
  let currentTime = 100;

  process.stdout.write = (chunk) => {
    output.push(String(chunk));
    return true;
  };
  try {
    const result = runStandardSuite("smoke", {
      now: () => {
        currentTime += 5;
        return currentTime;
      },
      spawnSync: () => ({ status: 0 })
    });
    assert.equal(result.ok, true);
    assert.equal(result.durationMs >= 0, true);
    assert.deepEqual(result.batchDurationsMs, [5]);
  } finally {
    process.stdout.write = originalWrite;
  }

  const metricLine = output.find((line) => line.startsWith("[standard-test:metrics] "));
  assert.ok(metricLine);
  const metrics = JSON.parse(metricLine.slice("[standard-test:metrics] ".length));
  assert.equal(metrics.suite, "smoke");
  assert.equal(metrics.tests, 2);
  assert.equal(metrics.batches, 1);
  assert.deepEqual(metrics.batchDurationsMs, [5]);
  assert.equal("maxDurationMs" in metrics, false);
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
  assert.match(workflow, /npm run test:coverage:boundaries/);
  assert.match(workflow, /npm run object-storage:architecture-governance:verify/);
  assert.match(workflow, /npm run documentation-facts:verify/);
  assert.match(workflow, /npm run clinical-subdomains:test/);
  assert.match(pages, /npm run build -- --output="\$RUNNER_TEMP\/pages-site"/);
  assert.equal(pkg.scripts["object-storage:architecture-governance:verify"], "node scripts/object-storage-architecture-governance.js");
  assert.equal(pkg.scripts["documentation-facts:verify"], "node scripts/documentation-fact-drift.js");
  assert.equal(pkg.scripts["clinical-subdomains:test"], "node scripts/clinical-subdomain-test-gate.js --all");
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
  assert.equal(typecheck.include.length, 13);
  assert.equal(new Set(typecheck.include).size, typecheck.include.length);
  assert.equal(typecheck.include.includes("**/*.js"), false);
  for (const file of [
    "scripts/internal-boundary-coverage.js",
    "src/http/browser-security-inventory.js",
    "src/http/browser-security-policy.js",
    "src/identity-security/audit-chain.js"
  ]) {
    assert.equal(typecheck.include.includes(file), true, file);
  }
  assert.match(eslintSource, /coverage\/\*\*/);
  assert.match(eslintSource, /test-results\/\*\*/);
  assert.match(eslintSource, /no-dupe-keys/);
  assert.match(eslintSource, /no-unreachable/);
  assert.doesNotMatch(eslintSource, /no-dupe-keys["']?\s*:\s*["']off["']/);
  assert.doesNotMatch(eslintSource, /files:\s*\["internet-nursing\.js",\s*"quality-safety\.js"\]/);
  assert.doesNotMatch(eslintSource, /files:\s*\["test\/api\.test\.js"\]/);
});

test("the former API unreachable blocks execute with independent care owner protection", () => {
  const apiTest = read("test/api.test.js");
  const explicitDebts = apiTest.match(/previously unreachable; care owner behavior revalidation required/g) || [];

  assert.equal(explicitDebts.length, 0);
  for (const file of [
    "test/escort-owner-route-characterization.test.js",
    "test/internet-nursing-closed-loop-characterization.test.js",
    "test/internet-nursing-nurse-lifecycle-characterization.test.js"
  ]) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, file);
  }
  assert.doesNotMatch(apiTest, /\n\s+return;\r?\n\s*\r?\n\s+const missingHospital/);
  assert.doesNotMatch(apiTest, /\n\s+return;\r?\n\s*\r?\n\s+const closedLoopDashboard/);
  assert.doesNotMatch(apiTest, /\n\s+return;\r?\n\s*\r?\n\s+const prematureComplete/);
});
