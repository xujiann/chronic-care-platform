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

// TEST-030: finite synthetic examples, independent of validator internals.
// Each later group depends on earlier groups; its second material also depends
// on its first. This construction, not a second graph checker, supplies the oracle.
function graph(seed) {
  const input = complete();
  input.materials = [];
  for (let i = 0; i < 9; i++) {
    const group = input.groups[i], first = "s" + seed + "g" + i + "a", second = "s" + seed + "g" + i + "b";
    group.materialIds = [first, second];
    group.dependsOn = input.groups.slice(0, i).map((row) => row.id);
    for (const [id, dependencies] of [
      [first, input.materials.filter((_, index) => index % 2 === 1).map((row) => row.recordId)],
      [second, [first]]
    ]) {
      const row = complete().materials[0];
      row.recordId = id; row.groupId = group.id; row.dependencyIds = dependencies;
      input.materials.push(row);
    }
  }
  return input;
}
function dataSnapshot(input) {
  const seen = new Set(), snapshot = [];
  function visit(value) {
    if (value === null || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    snapshot.push({ value, prototype: Object.getPrototypeOf(value), descriptors });
    for (const descriptor of Object.values(descriptors)) if (Object.hasOwn(descriptor, "value")) visit(descriptor.value);
  }
  visit(input);
  return snapshot;
}
function checked(input, expectedCode) {
  // Only called for non-Proxy data; descriptors never execute getters.
  const snapshot = dataSnapshot(input), output = validateFeedbackMaterials(input);
  assert.equal(output.metadataComplete, expectedCode === undefined, expectedCode || "valid graph accepted");
  if (expectedCode !== undefined) assert.ok(output.issues.some((issue) => issue.code === expectedCode), expectedCode);
  else assert.deepEqual(output.issues, []);
  denied(output);
  for (const issue of output.issues) assert.deepEqual(Object.keys(issue).sort(), ["code", "path"]);
  assert.doesNotMatch(JSON.stringify(output), /synthetic:|s23g|s7g|s1g|private-test030/);
  for (const entry of snapshot) {
    assert.equal(Object.getPrototypeOf(entry.value), entry.prototype);
    assert.deepEqual(Object.getOwnPropertyDescriptors(entry.value), entry.descriptors);
  }
  return output;
}
function permute(input, seed) {
  const rotate = (rows) => {
    if (!rows.length) return rows;
    const offset = seed % rows.length;
    return rows.slice(offset).concat(rows.slice(0, offset)).reverse();
  };
  input.groups = rotate(input.groups); input.materials = rotate(input.materials);
  for (const row of input.groups) {
    row.materialIds = rotate(row.materialIds); row.dependsOn = rotate(row.dependsOn);
  }
  for (const row of input.materials) row.dependencyIds = rotate(row.dependencyIds);
}
for (const seed of [1, 7, 23]) {
  test("TEST030 DAG transformations seed " + seed, () => {
    const input = graph(seed); checked(input);
    permute(input, seed); checked(input);
    const renamed = new Map(input.materials.map((row, index) => [row.recordId, "renamed-" + seed + "-" + index]));
    for (const row of input.groups) row.materialIds = row.materialIds.map((id) => renamed.get(id));
    for (const row of input.materials) {
      row.recordId = renamed.get(row.recordId); row.dependencyIds = row.dependencyIds.map((id) => renamed.get(id));
    }
    checked(input);
    const ordinaryFrozen = structuredClone(input);
    for (const entry of dataSnapshot(ordinaryFrozen)) Object.freeze(entry.value);
    checked(ordinaryFrozen);
    for (const entry of dataSnapshot(input)) if (!Array.isArray(entry.value)) Object.setPrototypeOf(entry.value, null);
    checked(input);
    for (const entry of dataSnapshot(input)) {
      Object.freeze(entry.value);
    }
    checked(input);
  });
}
for (const [name, code, mutate] of [
  ["dangling", "DANGLING_REFERENCE", (x) => { x.materials[17].dependencyIds.push("missing-node"); }],
  ["ownership", "GROUP_MISMATCH", (x) => { x.groups[0].materialIds[0] = x.materials[2].recordId; }],
  ["duplicate", "DUPLICATE_REFERENCE", (x) => { x.materials[17].dependencyIds.push(x.materials[17].dependencyIds[0]); }],
  ["undeclared", "GROUP_DEPENDENCY_UNDECLARED", (x) => { x.groups[8].dependsOn.pop(); }]
]) {
  test("TEST030 edge corruption " + name, () => {
    for (const seed of [1, 7, 23]) {
      const input = graph(seed); checked(input); mutate(input);
      checked(input, code); permute(input, seed); checked(input, code);
    }
  });
}
test("TEST030 independent group cycle", () => {
  const input = complete(); checked(input);
  input.groups[0].dependsOn = ["S02"]; input.groups[1].dependsOn = ["S03"]; checked(input);
  input.groups[2].dependsOn = ["S01"];
  const output = checked(input, "DEPENDENCY_CYCLE");
  assert.deepEqual(output.issues, [{ path: "groups", code: "DEPENDENCY_CYCLE" }]);
});
test("TEST030 independent material cycle", () => {
  const input = complete();
  for (const id of ["second-node", "third-node"]) {
    const row = structuredClone(input.materials[0]); row.recordId = id;
    input.materials.push(row); input.groups[0].materialIds.push(id);
  }
  checked(input);
  input.materials[0].dependencyIds = ["second-node"];
  input.materials[9].dependencyIds = ["third-node"];
  checked(input); // Still a DAG before the single closing edge.
  input.materials[10].dependencyIds = ["material0"];
  const output = checked(input, "DEPENDENCY_CYCLE");
  assert.deepEqual(output.issues, [{ path: "materials", code: "DEPENDENCY_CYCLE" }]);
});
for (const section of ["root", "baseline", "group", "material"]) {
  const sample = complete();
  const select = (input) => section === "root" ? [input] : section === "baseline" ? [input.baseline]
    : section === "group" ? input.groups : input.materials;
  for (const key of Object.keys(select(sample)[0])) {
    test("TEST030 descriptor " + section + "." + key, () => {
      for (let index = 0; index < select(sample).length; index++) {
        for (const mode of ["getter", "hidden"]) {
          const input = complete(), target = select(input)[index]; let calls = 0;
          Object.defineProperty(target, key, mode === "getter"
            ? { configurable: true, enumerable: true, get() { calls++; throw Error("private-test030"); } }
            : { configurable: true, enumerable: false, value: target[key], writable: true });
          checked(input, "INVALID_DATA_PROPERTIES"); assert.equal(calls, 0, section + "." + key);
        }
      }
    });
  }
}
function arraySlots(input) {
  return [[input, "groups"], [input, "materials"],
    ...input.groups.flatMap((row) => [[row, "materialIds"], [row, "dependsOn"]]),
    ...input.materials.map((row) => [row, "dependencyIds"])];
}
test("TEST030 every array index rejects accessors and hidden data", () => {
  const sample = graph(23);
  for (let slot = 0; slot < arraySlots(sample).length; slot++) {
    const [owner, key] = arraySlots(sample)[slot];
    for (let index = 0; index < owner[key].length; index++) {
      for (const mode of ["getter", "hidden"]) {
        const input = graph(23), [targetOwner, targetKey] = arraySlots(input)[slot], array = targetOwner[targetKey]; let calls = 0;
        Object.defineProperty(array, index, mode === "getter"
          ? { enumerable: true, get() { calls++; throw Error("private-test030"); } }
          : { enumerable: false, value: array[index] });
        checked(input, "INVALID_ARRAY"); assert.equal(calls, 0);
      }
    }
  }
});
test("TEST030 every nested proxy is rejected without any trap", () => {
  const slots = (input) => [[{ root: input }, "root"], [input, "baseline"], ...arraySlots(input),
    ...input.groups.map((_, i) => [input.groups, i]), ...input.materials.map((_, i) => [input.materials, i])];
  for (let index = 0; index < slots(graph(23)).length; index++) {
    for (const revoked of [false, true]) {
      const input = graph(23), [owner, key] = slots(input)[index], target = owner[key]; let calls = 0;
      const handler = Object.fromEntries(["get", "set", "has", "ownKeys", "getOwnPropertyDescriptor", "getPrototypeOf",
        "setPrototypeOf", "defineProperty", "deleteProperty", "isExtensible", "preventExtensions"]
        .map((trap) => [trap, () => { calls++; throw Error("private-test030"); }]));
      const wrapped = Proxy.revocable(target, handler); owner[key] = wrapped.proxy;
      if (revoked) wrapped.revoke();
      const output = invalid(index === 0 ? owner[key] : input);
      assert.equal(calls, 0, "proxy slot " + index);
      assert.ok(output.issues.some((issue) => ["INVALID_OBJECT", "INVALID_ARRAY"].includes(issue.code)));
      assert.equal(owner[key], wrapped.proxy);
      assert.doesNotMatch(JSON.stringify(output), /private-test030|synthetic:/);
    }
  }
});
test("TEST030 all array prototypes remain restricted", () => {
  for (let slot = 0; slot < arraySlots(graph(23)).length; slot++) {
    for (const prototype of [null, {}]) {
      const input = graph(23), [owner, key] = arraySlots(input)[slot];
      Object.setPrototypeOf(owner[key], prototype); checked(input, "INVALID_ARRAY");
    }
  }
});
test("TEST030 exact reference and identifier lengths", () => {
  for (const section of ["baseline", "group", "material"]) {
    const input = complete(), target = section === "baseline" ? input.baseline : section === "group" ? input.groups[0] : input.materials[0];
    const fields = section === "baseline" ? ["contractRef"] : section === "group"
      ? ["decisionVersion", "ownerAuthorizationRef", "signoffRef"]
      : ["nameRef", "version", "ownerAuthorizationRef", "controlledRef", "digestObjectRef", "signoffRef", "accessRef", "scopeRef", "validityRef", "submissionRef"];
    for (const key of fields) {
      const original = target[key];
      for (const length of [1, 160]) { target[key] = "x".repeat(length); checked(input); }
      target[key] = "x".repeat(161); checked(input, "INVALID_REFERENCE");
      target[key] = original;
    }
  }
  for (const length of [1, 64, 65]) {
    const input = complete(), id = "x".repeat(length);
    input.materials[0].recordId = id; input.groups[0].materialIds = [id]; input.materials[1].dependencyIds = [id]; input.groups[1].dependsOn = ["S01"];
    checked(input, length === 65 ? "INVALID_IDENTIFIER" : undefined);
  }
});
function maximumGraph(count) {
  const input = complete();
  while (input.materials.length < count) {
    const row = structuredClone(input.materials[8]);
    row.recordId = "bounded-" + input.materials.length;
    input.materials.push(row); input.groups[8].materialIds.push(row.recordId);
  }
  input.groups[8].dependsOn = input.groups.slice(0, 8).map((row) => row.id);
  input.materials.at(-1).dependencyIds = input.materials.slice(0, -1).map((row) => row.recordId);
  return input;
}
test("TEST030 exact material row and reference list bounds", () => {
  const input = maximumGraph(128);
  assert.equal(input.materials.length, 128); assert.equal(input.materials.at(-1).dependencyIds.length, 127); checked(input);
  // 128 unique existing dependencies necessarily include self: semantic, not size, rejection.
  input.materials.at(-1).dependencyIds.push(input.materials.at(-1).recordId);
  checked(input, "SELF_DEPENDENCY");
  input.materials.at(-1).dependencyIds.push("missing-node");
  checked(input, "INVALID_ARRAY"); // 129 exceeds the independent list resource limit.
  checked(maximumGraph(129), "INVALID_ARRAY"); // All rows owned/referenced; only row cap is exceeded.
});
