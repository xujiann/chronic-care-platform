"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { readLiveConfig } = require("./helpers/postgres-primary-live-fixture");
const { TESTS, successfulLiveRun, run } = require("../scripts/run-postgres-primary-live-contract");

const valid = Object.freeze({
  POSTGRES_PRIMARY_LIVE_TEST: "1",
  POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL: "postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract"
});
const report = "# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n";

test("primary live configuration is opt-in and never falls back to generic database URLs", () => {
  assert.equal(readLiveConfig({}), null);
  assert.equal(readLiveConfig({ DATABASE_URL: valid.POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL, POSTGRES_URL: valid.POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL }), null);
  const config = readLiveConfig(valid);
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.user, "contract_runner");
  assert.equal(config.database, "health_platform_contract");
  assert.equal(config.ssl, false); // Controlled loopback SQL test; not production TLS proof.
});

test("unsafe primary live configurations fail before the dedicated runner spawns a connection process", () => {
  const invalid = [
    {}, { POSTGRES_PRIMARY_LIVE_TEST: "0" }, { POSTGRES_PRIMARY_LIVE_TEST: "true" },
    { POSTGRES_PRIMARY_LIVE_TEST: " 1" }, { POSTGRES_PRIMARY_LIVE_TEST: "1" },
    { POSTGRES_PRIMARY_LIVE_TEST: "1", POSTGRES_URL: valid.POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL },
    { ...valid, NODE_ENV: "production" }, { ...valid, NODE_ENV: " PRODUCTION " },
    ...[
      "postgres://contract_runner:synthetic-only@database.example.invalid:5432/health_platform_contract",
      "postgres://contract_runner:synthetic-only@127.0.0.2:5432/health_platform_contract",
      "postgres://other:synthetic-only@127.0.0.1:5432/health_platform_contract",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/production",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract?sslmode=disable",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract#fragment",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract?",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract#",
      " postgres://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract",
      "https://contract_runner:synthetic-only@127.0.0.1:5432/health_platform_contract",
      "postgres://contract_runner:synthetic-only@127.0.0.1:5432/%68ealth_platform_contract"
    ].map((url) => ({ ...valid, POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL: url }))
  ];
  for (const env of invalid) {
    let spawns = 0;
    assert.throws(() => run({ env, spawn() { spawns += 1; throw new Error("must not spawn"); } }));
    assert.equal(spawns, 0, "invalid configuration must not start database tests");
  }
});

test("dedicated live entry rejects empty, skipped, cancelled, failed or incomplete execution evidence", () => {
  assert.equal(successfulLiveRun({ status: 0, stdout: report }), true);
  for (const result of [
    { status: 1, stdout: report }, { status: null, signal: "SIGTERM", stdout: report },
    { status: 0, error: new Error("timeout"), stdout: report }, { status: 0, stdout: "" },
    { status: 0, stdout: report.replace("# pass 4", "# pass 0") },
    { status: 0, stdout: report.replace("# skipped 0", "# skipped 4") },
    { status: 0, stdout: report.replace("# fail 0", "# fail 1") },
    { status: 0, stdout: report.replace("# cancelled 0", "# cancelled 1") },
    { status: 0, stdout: report.replace("# skipped 0\n", "") },
    { status: 0, stdout: report + report }
  ]) assert.equal(successfulLiveRun(result), false);
});

test("primary entry invokes all three real files serially and preserves the inherited CI contract", () => {
  let invocation;
  const result = run({ env: valid, spawn(executable, args, options) {
    invocation = { executable, args, options };
    return { status: 0, stdout: report, stderr: "" };
  } });
  assert.equal(result.ok, true);
  assert.equal(invocation.executable, process.execPath);
  assert.deepEqual(TESTS, ["test/postgres-primary-live-contract.test.js", "test/postgres-primary-live-concurrency.test.js", "test/postgres-primary-identity-live.test.js"]);
  assert.deepEqual(invocation.args, ["--test", "--test-concurrency=1", "--test-reporter=tap", ...TESTS]);
  assert.equal(invocation.options.env, valid);
  assert.equal(invocation.options.windowsHide, true);
  const root = path.resolve(__dirname, "..");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts["postgres:production-contract"], "node --test test/postgres-production-contract.test.js");
  assert.equal(pkg.scripts["postgres:primary-live-contract"], "node scripts/run-postgres-primary-live-contract.js");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  const job = workflow.split("  postgres-production-contract:")[1].split("  governance-api:")[0];
  assert.ok(job.indexOf("npm run postgres:production-contract") < job.indexOf("npm run postgres:primary-live-contract"));
  assert.match(job, /POSTGRES_PRIMARY_LIVE_TEST: "1"/);
  assert.match(job, /POSTGRES_PRIMARY_LIVE_TEST_ADMIN_URL: postgres:\/\/contract_runner:/);
  assert.doesNotMatch(job, /continue-on-error/);
});
