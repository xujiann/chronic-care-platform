"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateAdmission } = require("../scripts/gs03-admission");
const template = require("../config/gs03-admission.example.json");
const CLI = path.resolve(__dirname, "../scripts/gs03-admission.js");

// Deliberately independent of implementation REQUIRED: schema omissions must fail tests.
function complete() {
  return {
    schemaVersion: "gs03-admission-input.v1", environment: "test",
    owners: { status: "documented", authorizationRef: "synthetic:authorization", identityRef: "synthetic:identity", storageRef: "synthetic:storage", privacyRef: "synthetic:privacy", recoveryRef: "synthetic:recovery", decisionRef: "synthetic:decision" },
    identity: { status: "documented", principalNamespaceRef: "synthetic:namespace", accountInstitutionBindingRef: "synthetic:binding", crossPrincipalPolicyRef: "synthetic:dedupe" },
    protocol: { status: "documented", version: "synthetic.v2", contracts: ["feedback", "schedule", "report"], canonicalizationRef: "synthetic:canonical", signatureRef: "synthetic:signature", receiptProjectionRef: "synthetic:receipt" },
    transaction: { status: "documented", authorityRef: "synthetic:authority", writerInventoryRef: "synthetic:writers", ownerResponsibilitiesRef: "synthetic:owners", externalScopeFenceRef: "synthetic:fence" },
    retention: { status: "documented", policyRef: "synthetic:retention", periodDays: 1, keyExpiryPolicyRef: "synthetic:expiry", privacyDeletionPolicyRef: "synthetic:deletion", capacityRef: "synthetic:capacity" },
    recovery: { status: "documented", policyRef: "synthetic:recovery", rpoSeconds: 0, rtoSeconds: 1, sourceGenerationRef: "synthetic:generation", reconciliationRef: "synthetic:reconcile" }
  };
}

function denied(result) {
  assert.equal(result.admissionAllowed, false);
  assert.equal(result.runtimeImplementationAuthorized, false);
  assert.equal(result.productionReady, false);
  assert.equal(result.productionDecision, "NO-GO");
}

test("complete synthetic documentation remains untrusted and never grants admission", () => {
  for (const environment of ["test", "development"]) {
    const input = complete(); input.environment = environment;
    const before = structuredClone(input);
    const result = validateAdmission(input);
    assert.equal(result.documentationComplete, true);
    assert.equal(result.eligibleForManualReview, true);
    assert.deepEqual(result.issues, []);
    denied(result);
    assert.deepEqual(input, before);
  }
});

test("pending repository template enumerates unresolved fields without approval", () => {
  const result = validateAdmission(template);
  assert.equal(result.documentationComplete, false);
  assert.equal(result.eligibleForManualReview, false);
  assert.equal(result.issues.length, 34);
  const expectedPaths = Object.entries(complete()).filter(([, value]) => typeof value === "object")
    .flatMap(([section, row]) => Object.keys(row).map((field) => section + "." + field)).sort();
  assert.deepEqual(result.issues.map((issue) => issue.path).sort(), expectedPaths);
  denied(result);
});

for (const section of ["owners", "identity", "protocol", "transaction", "retention", "recovery"]) {
  test(section + " rejects missing or malformed section and self-asserted approval", () => {
    const missing = complete(); delete missing[section];
    assert.ok(validateAdmission(missing).issues.some((issue) => issue.path === section && issue.code === "MISSING"));
    for (const value of [null, [], "documented", true]) {
      const input = complete(); input[section] = value;
      assert.equal(validateAdmission(input).documentationComplete, false);
    }
    for (const status of [undefined, null, "", "pending", "待定", "approved", "accepted", true]) {
      const input = complete(); input[section].status = status;
      assert.ok(validateAdmission(input).issues.some((issue) => issue.path === section + ".status"));
    }
    const extra = complete(); extra[section].productionReady = true;
    assert.ok(validateAdmission(extra).issues.some((issue) => issue.code === "UNKNOWN_FIELDS"));
  });

  for (const [field, good] of Object.entries(complete()[section]).filter(([name]) => name !== "status")) {
    test(section + "." + field + " requires explicit, correctly typed non-placeholder input", () => {
      const missing = complete(); delete missing[section][field];
      assert.ok(validateAdmission(missing).issues.some((issue) => issue.path === section + "." + field && issue.code === "MISSING"));
      const badValues = [null, "", " ", "待定", " TBD ", "pending", "UNKNOWN", true, {}, []];
      if (typeof good === "string") badValues.push(1, "x".repeat(161), " x", "x ", "x\nsecret", "<script>", "n/a");
      if (typeof good === "number") badValues.push(-1, 0.5, "1", Number.MAX_SAFE_INTEGER + 1, Infinity, NaN);
      for (const bad of badValues) {
        const input = complete(); input[section][field] = bad;
        const result = validateAdmission(input);
        assert.equal(result.documentationComplete, false, String(bad));
        assert.ok(result.issues.some((issue) => issue.path === section + "." + field));
        denied(result);
      }
    });
  }
}

test("contracts are an exact set, not a count or subset; numeric minima are explicit", () => {
  for (const contracts of [[], ["feedback"], ["feedback", "schedule", "report", "other"], ["feedback", "feedback", "report"], ["feedback", "schedule", 3]]) {
    const input = complete(); input.protocol.contracts = contracts;
    assert.ok(validateAdmission(input).issues.some((issue) => issue.code === "CONTRACT_SET_MISMATCH"));
  }
  const reordered = complete(); reordered.protocol.contracts.reverse();
  assert.equal(validateAdmission(reordered).documentationComplete, true);
  for (const [section, field] of [["retention", "periodDays"], ["recovery", "rtoSeconds"]]) {
    const input = complete(); input[section][field] = 0;
    assert.equal(validateAdmission(input).documentationComplete, false);
  }
});

test("version, environment, root shape and unknown authorization fields fail closed without echo", () => {
  for (const input of [null, [], true, "secret", 1]) {
    const result = validateAdmission(input);
    assert.equal(result.documentationComplete, false); denied(result);
  }
  for (const environment of [undefined, null, "", "production", " PRODUCTION ", "staging", true]) {
    const input = complete(); input.environment = environment;
    assert.equal(validateAdmission(input).documentationComplete, false);
  }
  for (const schemaVersion of [undefined, null, "gs03-admission-input.v2", true]) {
    const input = complete(); input.schemaVersion = schemaVersion;
    assert.equal(validateAdmission(input).documentationComplete, false);
  }
  const input = complete();
  input["secret-patient-token"] = "never-echo";
  input.owners.identityRef = "secret\ncredential";
  const result = validateAdmission(input);
  denied(result);
  assert.equal(result.documentationComplete, false);
  assert.doesNotMatch(JSON.stringify(result), /secret|credential|never-echo/);
});

function invoke(args) {
  const child = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", timeout: 10000 });
  assert.ifError(child.error);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, "");
  const result = JSON.parse(child.stdout);
  denied(result);
  return { code: child.status, result };
}

test("CLI is explicit and read-only for complete, pending and malformed files", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs03-admission-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "input.json");
  fs.writeFileSync(file, JSON.stringify(complete()));
  const before = fs.readFileSync(file);
  assert.equal(invoke(["--input", file]).code, 0);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(dir), ["input.json"]);
  assert.equal(invoke([]).code, 1);
  for (const args of [["--approve"], ["--input"], ["--input", file, "--apply"], ["--input", file, "--input", file], ["--input", "--production"]]) {
    const run = invoke(args); assert.equal(run.code, 2);
    assert.equal(run.result.issues[0].code, "INVALID_ARGUMENTS");
  }
  for (const bytes of ["{secret-invalid-json", Buffer.from([0xff]), " ".repeat(65537)]) {
    fs.writeFileSync(file, bytes);
    const run = invoke(["--input", file]);
    assert.equal(run.code, 2);
    assert.equal(run.result.issues[0].code, "INPUT_UNREADABLE");
    assert.doesNotMatch(JSON.stringify(run.result), /secret|input.json/);
    assert.deepEqual(fs.readFileSync(file), Buffer.from(bytes));
  }
  assert.equal(invoke(["--input", path.join(dir, "missing")]).code, 2);
  assert.equal(invoke(["--input", dir]).code, 2);
});

test("CLI rejects a real filesystem link and leaves its target unchanged", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gs03-admission-link-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const target = path.join(dir, "target"); fs.mkdirSync(target);
  const file = path.join(target, "input.json"); fs.writeFileSync(file, JSON.stringify(complete()));
  const link = path.join(dir, "link");
  // Windows junction needs no symlink privilege; Linux exercises a file symlink.
  fs.symlinkSync(process.platform === "win32" ? target : file, link, process.platform === "win32" ? "junction" : "file");
  const before = fs.readFileSync(file);
  assert.equal(invoke(["--input", link]).code, 2);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.deepEqual(fs.readdirSync(target), ["input.json"]);
});
