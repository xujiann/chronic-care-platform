"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateFeedbackMaterials } = require("../scripts/gs03-feedback-materials");
const template = require("../config/gs03-feedback-materials.example.json");
const CLI = path.resolve(__dirname, "../scripts/gs03-feedback-materials.js");

// Independent schema fixture: no real signatures, names, approved values or material files.
function complete() {
  return {
    schemaVersion: "gs03-feedback-materials-input.v1", environment: "test", scope: "feedback-only",
    baseline: { commit: "a".repeat(40), contractRef: "synthetic:contract", contractSha256: "b".repeat(64) },
    groups: Array.from({ length: 9 }, (_, index) => ({
      id: "S" + String(index + 1).padStart(2, "0"), decisionVersion: "synthetic.v1",
      ownerAuthorizationRef: "synthetic:authority", signoffRef: "synthetic:signoff",
      materialIds: ["material" + index], dependsOn: []
    })),
    materials: Array.from({ length: 9 }, (_, index) => ({
      recordId: "material" + index, groupId: "S" + String(index + 1).padStart(2, "0"),
      nameRef: "synthetic:material", version: "synthetic.v1", ownerAuthorizationRef: "synthetic:owner",
      controlledRef: "synthetic:controlled", digestObjectRef: "synthetic:object", sha256: "c".repeat(64),
      signoffRef: "synthetic:signoff", accessRef: "synthetic:access", scopeRef: "synthetic:scope",
      validityRef: "synthetic:validity", submissionRef: "synthetic:submission", dependencyIds: []
    }))
  };
}
function denied(result) {
  for (const key of ["professionalSignaturesVerified", "materialContentVerified", "admissionAllowed", "runtimeImplementationAuthorized", "productionReady"]) assert.equal(result[key], false, key);
  assert.equal(result.productionDecision, "NO-GO");
}
function invalid(input, code) {
  const output = validateFeedbackMaterials(input);
  assert.equal(output.metadataComplete, false);
  if (code) assert.ok(output.issues.some((i) => i.code === code), JSON.stringify(output));
  denied(output);
  return output;
}
test("complete synthetic metadata never verifies material contents, signatures or admission", () => {
  for (const environment of ["development", "test"]) {
    const input = complete(); input.environment = environment;
    const before = structuredClone(input), result = validateFeedbackMaterials(input);
    assert.equal(result.metadataComplete, true); assert.deepEqual(result.issues, []); denied(result);
    assert.deepEqual(input, before);
  }
});
test("empty template stays unresolved and does not fill any professional inputs", () => {
  const before = JSON.stringify(template);
  const result = invalid(template);
  for (let i = 0; i < 9; i++) assert.ok(result.issues.some((issue) => issue.path === "groups[" + i + "].materialIds"));
  assert.equal(JSON.stringify(template), before);
});
for (const key of ["schemaVersion", "environment", "scope", "baseline", "groups", "materials"]) {
  test("root field " + key + " is required", () => {
    const input = complete(); delete input[key]; invalid(input);
  });
}
for (const [section, fields] of [
  ["baseline", ["commit", "contractRef", "contractSha256"]],
  ["groups", ["id", "decisionVersion", "ownerAuthorizationRef", "signoffRef", "materialIds", "dependsOn"]],
  ["materials", ["recordId", "groupId", "nameRef", "version", "ownerAuthorizationRef", "controlledRef", "digestObjectRef", "sha256", "signoffRef", "accessRef", "scopeRef", "validityRef", "submissionRef", "dependencyIds"]]
]) {
  for (const key of fields) test(section + "." + key + " rejects missing, wrong-type and unresolved values", () => {
    for (const value of [undefined, null, "", " ", "TBD", "pending", "〔填写〕", true, 1, {}]) {
      const input = complete(), target = section === "baseline" ? input.baseline : input[section][0];
      if (value === undefined) delete target[key]; else target[key] = value;
      invalid(input);
    }
  });
}
test("baseline and material digest syntax is bounded, lowercase and nonzero only", () => {
  for (const [section, key, length] of [["baseline", "commit", 40], ["baseline", "contractSha256", 64], ["materials", "sha256", 64]]) {
    for (const value of ["0".repeat(length), "A".repeat(length), "g".repeat(length), "a".repeat(length - 1), "a".repeat(length + 1)]) {
      const input = complete(); (section === "baseline" ? input.baseline : input.materials[0])[key] = value;
      invalid(input);
    }
  }
});
test("unknown and self-asserted authorization fields fail without echo", () => {
  for (const section of ["root", "baseline", "groups", "materials"]) {
    const input = complete(), target = section === "root" ? input : section === "baseline" ? input.baseline : input[section][0];
    target.productionReady = "private-secret-value";
    assert.doesNotMatch(JSON.stringify(invalid(input, "UNKNOWN_FIELDS")), /private-secret-value|productionReady.*private/);
  }
});
test("all groups exactly once, duplicates, wrong scope and nonproduction are rejected", () => {
  for (const mutate of [
    (x) => { x.groups.pop(); }, (x) => { x.groups[8].id = "S01"; }, (x) => { x.groups[8].id = "S10"; },
    (x) => { x.groups.push(x.groups[0]); }, (x) => { x.environment = "production"; },
    (x) => { x.scope = "schedule"; }, (x) => { x.schemaVersion = "gs03-admission-input.v1"; }
  ]) { const input = complete(); mutate(input); invalid(input); }
  const input = complete(); input.groups.reverse(); input.materials.reverse();
  assert.equal(validateFeedbackMaterials(input).metadataComplete, true);
});
test("reference syntax rejects whitespace, secrets query strings, oversized strings and placeholders", () => {
  for (const value of [" x", "x ", "x\nsecret", "https://example.invalid/x?token=secret", "<script>", "x".repeat(161), "n/a", "unknown"]) {
    const input = complete(); input.materials[0].controlledRef = value;
    assert.doesNotMatch(JSON.stringify(invalid(input)), /secret|example.invalid|<script>/);
  }
});
test("material identity, group ownership and closed references are enforced", () => {
  for (const mutate of [
    (x) => { x.materials[1].recordId = x.materials[0].recordId; },
    (x) => { x.groups[0].materialIds = ["missing"]; },
    (x) => { x.groups[0].materialIds = ["material1"]; },
    (x) => { x.groups[0].materialIds.push("material0"); },
    (x) => { x.materials[0].groupId = "S02"; },
    (x) => { x.materials[0].groupId = "S10"; },
    (x) => { const row = structuredClone(x.materials[0]); row.recordId = "orphan"; x.materials.push(row); }
  ]) { const input = complete(); mutate(input); invalid(input); }
});
test("dependency references reject self, duplicates, unknowns and graph cycles", () => {
  for (const mutate of [
    (x) => { x.groups[0].dependsOn = ["S01"]; }, (x) => { x.groups[0].dependsOn = ["S10"]; },
    (x) => { x.groups[0].dependsOn = ["S02", "S02"]; },
    (x) => { x.groups[0].dependsOn = ["S02"]; x.groups[1].dependsOn = ["S01"]; },
    (x) => { x.materials[0].dependencyIds = ["material0"]; },
    (x) => { x.materials[0].dependencyIds = ["missing"]; },
    (x) => { x.materials[0].dependencyIds = ["material1", "material1"]; },
    (x) => { x.materials[0].dependencyIds = ["material1"]; },
    (x) => { x.materials[0].dependencyIds = ["material1"]; x.materials[1].dependencyIds = ["material0"]; x.groups[0].dependsOn = ["S02"]; x.groups[1].dependsOn = ["S01"]; }
  ]) { const input = complete(); mutate(input); invalid(input); }
  const input = complete(); input.groups[0].dependsOn = ["S02"]; input.materials[0].dependencyIds = ["material1"];
  assert.equal(validateFeedbackMaterials(input).metadataComplete, true);
});
test("plain null-prototype and frozen data work; accessors are rejected without invocation", () => {
  const input = complete(); Object.setPrototypeOf(input, null);
  for (const g of input.groups) Object.freeze(g);
  Object.freeze(input); assert.equal(validateFeedbackMaterials(input).metadataComplete, true);
  for (const section of ["root", "baseline", "groups", "materials", "array"]) {
    const x = complete(); let calls = 0;
    const target = section === "root" ? x : section === "baseline" ? x.baseline : section === "array" ? x.groups : x[section][0];
    const key = section === "array" ? "0" : Object.keys(target)[0];
    Object.defineProperty(target, key, { enumerable: true, get() { calls++; throw new Error("secret"); } });
    invalid(x); assert.equal(calls, 0);
  }
  for (const change of [
    (x) => Object.defineProperty(x, "hidden", { value: true }),
    (x) => { x[Symbol("secret")] = true; },
    (x) => { delete x.groups[0]; },
    (x) => { x.groups.extra = "secret"; },
    (x) => Object.setPrototypeOf(x.groups, { some() { throw new Error("secret"); } }),
    (x) => Object.setPrototypeOf(x.baseline, { inherited: true })
  ]) { const x = complete(); change(x); invalid(x); }
});
test("multiple materials in one group allow a DAG but reject a material-only cycle", () => {
  const x = complete(), extra = structuredClone(x.materials[0]);
  extra.recordId = "additional"; extra.dependencyIds = ["material0"];
  x.materials.push(extra); x.groups[0].materialIds.push("additional");
  assert.equal(validateFeedbackMaterials(x).metadataComplete, true);
  x.materials[0].dependencyIds = ["additional"];
  invalid(x, "DEPENDENCY_CYCLE");
});
test("array sizes and issue count are bounded", () => {
  for (const field of ["groups", "materials"]) {
    const x = complete(); x[field] = Array.from({ length: 129 }, () => ({})); invalid(x);
  }
  const x = complete(); x.materials[0].dependencyIds = Array(129).fill("missing"); invalid(x);
});
test("proxies and revoked proxies are rejected before traps or disguised accessors execute", () => {
  for (const section of ["root", "baseline", "groups", "materials", "groupRow", "materialRow", "references"]) {
    const x = complete(); let traps = 0;
    const target = section === "root" ? x : section === "groupRow" ? x.groups[0]
      : section === "materialRow" ? x.materials[0] : section === "references" ? x.groups[0].materialIds : x[section];
    const proxy = new Proxy(target, {
      get(object, key) { traps++; return Reflect.get(object, key); },
      getOwnPropertyDescriptor(object, key) { traps++; return Reflect.getOwnPropertyDescriptor(object, key); },
      getPrototypeOf(object) { traps++; return Reflect.getPrototypeOf(object); }
    });
    if (section === "root") invalid(proxy);
    else {
      if (section === "groupRow") x.groups[0] = proxy;
      else if (section === "materialRow") x.materials[0] = proxy;
      else if (section === "references") x.groups[0].materialIds = proxy;
      else x[section] = proxy;
      invalid(x);
    }
    assert.equal(traps, 0, section);
  }
  const revoked = Proxy.revocable({}, {}); revoked.revoke(); invalid(revoked.proxy);
});
test("missing own fields do not read inherited getters", () => {
  for (const [section, key] of [["root", "scope"], ["baseline", "contractRef"], ["groups", "decisionVersion"], ["materials", "nameRef"]]) {
    const x = complete(), target = section === "root" ? x : section === "baseline" ? x.baseline : x[section][0];
    delete target[key]; let calls = 0;
    Object.defineProperty(Object.prototype, key, { configurable: true, get() { calls++; return "synthetic:inherited"; } });
    try { invalid(x); assert.equal(calls, 0, section); }
    finally { delete Object.prototype[key]; }
  }
});
function invoke(args) {
  const output = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8", windowsHide: true });
  assert.equal(output.stderr, ""); assert.equal(output.signal, null);
  return { code: output.status, result: JSON.parse(output.stdout) };
}
test("CLI default, complete file and invalid flags remain nonauthorizing and do not write", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-materials-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "input.json"), bytes = JSON.stringify(complete());
  fs.writeFileSync(file, bytes);
  assert.equal(invoke([]).code, 1);
  const run = invoke(["--input", file]); assert.equal(run.code, 0); denied(run.result);
  for (const args of [["--approve"], ["--input"], ["--input", file, "--apply"], ["--input", "--enable"]]) {
    const result = invoke(args); assert.equal(result.code, 2); denied(result.result);
    assert.doesNotMatch(JSON.stringify(result.result), /input.json|--approve|--apply/);
  }
  assert.equal(fs.readFileSync(file, "utf8"), bytes); assert.deepEqual(fs.readdirSync(dir), ["input.json"]);
});
test("CLI rejects broken JSON, UTF8, size, directories and links without echo or mutation", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-materials-bad-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "secret-input.json");
  for (const bytes of [Buffer.from("{private-secret"), Buffer.from([0xff]), Buffer.alloc(65537, 32)]) {
    fs.writeFileSync(file, bytes); const run = invoke(["--input", file]);
    assert.equal(run.code, 2); denied(run.result);
    assert.doesNotMatch(JSON.stringify(run.result), /secret|input.json|Error|stack/);
    assert.deepEqual(fs.readFileSync(file), bytes);
  }
  assert.equal(invoke(["--input", dir]).code, 2);
  assert.equal(invoke(["--input", path.join(dir, "missing")]).code, 2);
  const link = path.join(dir, "link");
  fs.symlinkSync(process.platform === "win32" ? dir : file, link, process.platform === "win32" ? "junction" : "file");
  assert.equal(invoke(["--input", link]).code, 2);
});
test("CLI accepts the exact 64 KiB boundary and rejects one additional byte", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "feedback-materials-limit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, "input.json"), json = JSON.stringify(complete());
  const bytes = Buffer.from(json + " ".repeat(65536 - Buffer.byteLength(json)));
  fs.writeFileSync(file, bytes); assert.equal(invoke(["--input", file]).code, 0);
  const oversized = Buffer.concat([bytes, Buffer.from(" ")]);
  fs.writeFileSync(file, oversized); assert.equal(invoke(["--input", file]).code, 2);
  assert.deepEqual(fs.readFileSync(file), oversized);
});
