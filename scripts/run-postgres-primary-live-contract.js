"use strict";

const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { readLiveConfig } = require("../test/helpers/postgres-primary-live-fixture");

const ROOT = path.resolve(__dirname, "..");
const TESTS = Object.freeze([
  "test/postgres-primary-live-contract.test.js",
  "test/postgres-primary-live-concurrency.test.js",
  "test/postgres-primary-identity-live.test.js"
]);

function successfulLiveRun(result) {
  if (result.error || result.status !== 0 || result.signal) return false;
  const output = String(result.stdout || "");
  const passes = output.match(/^# pass (\d+)\s*$/gm) || [];
  const failures = output.match(/^# fail (\d+)\s*$/gm) || [];
  const skips = output.match(/^# skipped (\d+)\s*$/gm) || [];
  const cancelled = output.match(/^# cancelled (\d+)\s*$/gm) || [];
  return passes.length === 1 && Number(passes[0].split(" ")[2]) > 0
    && failures.length === 1 && failures[0].trim() === "# fail 0"
    && skips.length === 1 && skips[0].trim() === "# skipped 0"
    && cancelled.length === 1 && cancelled[0].trim() === "# cancelled 0";
}

function run(options = {}) {
  const env = options.env || process.env;
  // The dedicated entry point never treats an absent opt-in as a successful skip.
  if (env.POSTGRES_PRIMARY_LIVE_TEST !== "1") {
    throw new Error("PRIMARY_LIVE_EXPLICIT_OPT_IN_REQUIRED");
  }
  readLiveConfig(env);
  const result = (options.spawn || spawnSync)(process.execPath, [
    "--test", "--test-concurrency=1", "--test-reporter=tap", ...TESTS
  ], {
    cwd: ROOT, env, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true
  });
  return { ok: successfulLiveRun(result), stdout: result.stdout || "", stderr: result.stderr || "" };
}

if (require.main === module) {
  try {
    const result = run();
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    if (!result.ok) {
      process.stderr.write("PRIMARY_LIVE_EXECUTION_INCOMPLETE\n");
      process.exitCode = 1;
    }
  } catch {
    process.stderr.write("PRIMARY_LIVE_CONFIGURATION_REJECTED\n");
    process.exitCode = 1;
  }
}

module.exports = { TESTS, successfulLiveRun, run };
