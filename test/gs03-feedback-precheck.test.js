"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { precheckSyntheticFeedback } = require("../src/care-coordination/gs03-feedback-precheck");

const REQUEST_FIELDS = [
  "protocol", "idempotencyKey", "caseId", "residentId", "authorizationId",
  "externalSystemId", "feedbackStatus", "occurredAt", "summary"
];
const TARGET_FIELDS = ["caseId", "residentId", "authorizationId", "externalSystemId"];
const GOLDEN_HEX = "2519ed204ca3b0d295a7abbee0fb650be180322fff4dde615b7f9f55f9eda0db";

function validInput(environment = "test") {
  return {
    environment,
    request: {
      protocol: "gs03-feedback-synthetic.v1",
      idempotencyKey: "key-001",
      caseId: "case-001",
      residentId: "resident-001",
      authorizationId: "auth-001",
      externalSystemId: "system-001",
      feedbackStatus: "accepted",
      occurredAt: 1700000000000,
      summary: "Synthetic feedback ✓"
    },
    target: {
      caseId: "case-001", residentId: "resident-001",
      authorizationId: "auth-001", externalSystemId: "system-001"
    }
  };
}

function independentDigest(request) {
  const values = REQUEST_FIELDS.map((field) => request[field]);
  return "synthetic:sha256:" + createHash("sha256").update(JSON.stringify(values), "utf8").digest("hex");
}

function accepted(input, digest = independentDigest(input.request)) {
  const output = precheckSyntheticFeedback(input);
  assert.deepEqual(output, {
    status: "accepted", code: "GS03_SYNTHETIC_PRECHECK_ACCEPTED",
    syntheticIntentDigest: digest, productionReady: false, productionPrimary: false
  });
  assert.equal(Object.isFrozen(output), true);
  assert.match(output.syntheticIntentDigest, /^synthetic:sha256:[0-9a-f]{64}$/);
  return output;
}

function rejected(input, kind) {
  const output = precheckSyntheticFeedback(input);
  assert.deepEqual(output, {
    status: "rejected", code: `GS03_SYNTHETIC_PRECHECK_${kind}`,
    productionReady: false, productionPrimary: false
  });
  assert.equal(Object.isFrozen(output), true);
  assert.equal(Object.hasOwn(output, "syntheticIntentDigest"), false);
  assert.equal(Object.hasOwn(output, "cause"), false);
  return output;
}

function changedRequest(field, value) {
  const input = validInput();
  input.request[field] = value;
  if (TARGET_FIELDS.includes(field)) input.target[field] = value;
  return input;
}

test("golden digest uses the nine ordered primitive fields and both nonproduction environments", () => {
  // This literal is independently calculated from JSON.stringify of the explicit
  // nine-element array with node:crypto, not imported from the implementation.
  const golden = "synthetic:sha256:" + GOLDEN_HEX;
  assert.equal(independentDigest(validInput().request), golden);
  for (const environment of ["test", "development"]) {
    const input = validInput(environment);
    const before = structuredClone(input);
    accepted(input, golden);
    assert.deepEqual(input, before);
    assert.deepEqual(precheckSyntheticFeedback(input), precheckSyntheticFeedback(input));
    assert.deepEqual(input, before);
  }
});

test("property insertion order and null-prototype data objects do not change the digest", () => {
  const input = validInput();
  input.request = Object.fromEntries(Object.entries(input.request).reverse());
  input.target = Object.fromEntries(Object.entries(input.target).reverse());
  accepted(input, "synthetic:sha256:" + GOLDEN_HEX);
  const nullRoot = Object.assign(Object.create(null), input);
  nullRoot.request = Object.assign(Object.create(null), input.request);
  nullRoot.target = Object.assign(Object.create(null), input.target);
  accepted(nullRoot, "synthetic:sha256:" + GOLDEN_HEX);
});

test("each mutable request field changes the digest; the fixed protocol rejects mutation", () => {
  const alternate = {
    idempotencyKey: "key-002", caseId: "case-002", residentId: "resident-002",
    authorizationId: "auth-002", externalSystemId: "system-002",
    feedbackStatus: "declined", occurredAt: 1700000000001,
    summary: "Synthetic feedback ✗"
  };
  for (const [field, value] of Object.entries(alternate)) {
    const input = changedRequest(field, value);
    const digest = accepted(input).syntheticIntentDigest;
    assert.notEqual(digest, "synthetic:sha256:" + GOLDEN_HEX, field);
    assert.equal(digest, independentDigest(input.request), field);
  }
  rejected(changedRequest("protocol", "gs03-feedback-synthetic.v2"), "INPUT");
});

test("each of four target mismatches is rejected without a digest or old value", () => {
  for (const field of TARGET_FIELDS) {
    const input = validInput();
    input.target[field] = "different-" + field;
    const before = structuredClone(input);
    rejected(input, "TARGET");
    assert.deepEqual(input, before);
  }
});

test("outer shape, environment and environment-first precedence are strict", () => {
  for (const value of [undefined, null, false, 0, "test", [], {}]) rejected(value, "INPUT");
  for (const environment of [undefined, null, "", "production", "staging", "Test", 1, true]) {
    const input = validInput();
    input.environment = environment;
    rejected(input, "ENVIRONMENT");
  }
  const invalidEnvironment = validInput();
  invalidEnvironment.environment = "production";
  invalidEnvironment.request = new Proxy({}, { ownKeys() { throw Error("private request"); } });
  invalidEnvironment.target = new Proxy({}, { getPrototypeOf() { throw Error("private target"); } });
  rejected(invalidEnvironment, "ENVIRONMENT");
});

test("all three layers require exact own enumerable data fields", () => {
  const cases = [
    ["outer", (input) => { delete input.request; }],
    ["outer-extra", (input) => { input.path = "private-path"; }],
    ["request-missing", (input) => { delete input.request.summary; }],
    ["request-extra", (input) => { input.request.signature = "private-signature"; }],
    ["target-missing", (input) => { delete input.target.caseId; }],
    ["target-extra", (input) => { input.target.expiry = 1; }],
    ["request-array", (input) => { input.request = []; }],
    ["target-array", (input) => { input.target = []; }],
    ["request-inherited", (input) => { input.request = Object.assign(Object.create({ inherited: true }), input.request); }],
    ["target-inherited", (input) => { input.target = Object.assign(Object.create({ inherited: true }), input.target); }]
  ];
  for (const [label, mutate] of cases) {
    const input = validInput(); mutate(input);
    rejected(input, "INPUT");
    assert.ok(label);
  }
  for (const layer of ["outer", "request", "target"]) {
    for (const kind of ["symbol", "nonenumerable"]) {
      const input = validInput();
      const object = layer === "outer" ? input : input[layer];
      if (kind === "symbol") object[Symbol("secret")] = "private";
      else Object.defineProperty(object, "hidden", { value: "private", enumerable: false });
      rejected(input, "INPUT");
    }
  }
});

test("identifier character, type and length boundaries apply to request and target", () => {
  for (const field of ["idempotencyKey", ...TARGET_FIELDS]) {
    for (const value of [undefined, null, 1, true, {}, [], "", "_start", "-start", ".start",
      "a b", "a/b", "a\n", "é", "a\u0000b", "a\ud800", "a".repeat(129)]) {
      rejected(changedRequest(field, value), "INPUT");
    }
    for (const value of ["A", "a".repeat(128), "A._:-09"]) accepted(changedRequest(field, value));
  }
  for (const field of TARGET_FIELDS) {
    const input = validInput(); input.target[field] = "bad target value";
    rejected(input, "INPUT");
  }
});

test("status is a closed synthetic fixture enumeration", () => {
  for (const status of ["accepted", "declined", "completed"]) accepted(changedRequest("feedbackStatus", status));
  for (const status of [undefined, null, "", "ACCEPTED", "pending", " accepted", 1, {}, []]) {
    rejected(changedRequest("feedbackStatus", status), "INPUT");
  }
});

test("occurredAt enforces safe integral epoch range and rejects negative zero", () => {
  for (const time of [0, 1, 8640000000000000]) accepted(changedRequest("occurredAt", time));
  for (const time of [undefined, null, "0", false, -0, -1, 1.5, 8640000000000001,
    Number.MAX_SAFE_INTEGER, NaN, Infinity, -Infinity, 1n]) {
    rejected(changedRequest("occurredAt", time), "INPUT");
  }
});

test("summary is well-formed Unicode with exact UTF-8 limit and no C0/DEL", () => {
  for (const summary of ["", "é".repeat(512), "a".repeat(1024), "😀".repeat(256), "a\u0085b", "e\u0301"]) {
    accepted(changedRequest("summary", summary));
  }
  for (const summary of [undefined, null, 1, {}, [], "é".repeat(513), "a".repeat(1025),
    "😀".repeat(257), "a\u0000b", "a\n", "a\u001fb", "a\u007fb", "\ud800", "\udc00", "x\ud800y"]) {
    rejected(changedRequest("summary", summary), "INPUT");
  }
  const composed = accepted(changedRequest("summary", "é")).syntheticIntentDigest;
  const decomposed = accepted(changedRequest("summary", "e\u0301")).syntheticIntentDigest;
  assert.notEqual(composed, decomposed, "no implicit Unicode normalization");
});

test("accessors are rejected without executing getters or toJSON", () => {
  for (const [layer, field] of [["outer", "environment"], ["request", "summary"], ["target", "caseId"]]) {
    const input = validInput();
    const object = layer === "outer" ? input : input[layer];
    let reads = 0;
    Object.defineProperty(object, field, { enumerable: true, get() { reads += 1; throw Error("PRIVATE_GETTER"); } });
    rejected(input, "INPUT");
    assert.equal(reads, 0, layer);
  }
  for (const layer of ["outer", "request", "target"]) {
    const input = validInput();
    let reads = 0;
    const object = layer === "outer" ? input : input[layer];
    Object.defineProperty(object, "toJSON", { enumerable: true, get() { reads += 1; throw Error("PRIVATE_TOJSON"); } });
    rejected(input, "INPUT");
    assert.equal(reads, 0, layer);
  }
});

test("throwing reflection traps and revoked proxies have stable redacted outcomes", () => {
  for (const layer of ["outer", "request", "target"]) {
    for (const trap of ["getPrototypeOf", "ownKeys", "getOwnPropertyDescriptor"]) {
      const input = validInput();
      const original = layer === "outer" ? input : input[layer];
      const hostile = new Proxy(original, { [trap]() { throw Error("PRIVATE_TRAP_" + trap); } });
      if (layer === "outer") rejected(hostile, "INPUT");
      else { input[layer] = hostile; rejected(input, "INPUT"); }
    }
    const input = validInput();
    const original = layer === "outer" ? input : input[layer];
    const revoked = Proxy.revocable(original, {});
    revoked.revoke();
    if (layer === "outer") rejected(revoked.proxy, "INPUT");
    else { input[layer] = revoked.proxy; rejected(input, "INPUT"); }
  }
});

test("no implicit get/coercion, cycles or raw private text in public reports", () => {
  let reads = 0;
  let conversions = 0;
  const object = { toString() { conversions += 1; throw Error("PRIVATE_COERCION"); } };
  rejected(changedRequest("idempotencyKey", object), "INPUT");
  assert.equal(conversions, 0);
  const input = validInput();
  input.request = new Proxy(input.request, { get() { reads += 1; throw Error("PRIVATE_GET"); } });
  accepted(input, "synthetic:sha256:" + GOLDEN_HEX);
  assert.equal(reads, 0);
  const cyclic = validInput();
  cyclic.request.summary = cyclic.request;
  rejected(cyclic, "INPUT");
  const marker = "PRIVATE_PATIENT_TOKEN";
  const withMarker = changedRequest("summary", marker);
  assert.doesNotMatch(JSON.stringify(accepted(withMarker)), /PRIVATE|PATIENT|TOKEN/);
  withMarker.request.summary = marker + "\n";
  assert.doesNotMatch(JSON.stringify(rejected(withMarker, "INPUT")), /PRIVATE|PATIENT|TOKEN|cause/);
});

function snapshotLayers(objects) {
  return objects.map((object) => ({
    prototype: Object.getPrototypeOf(object),
    keys: Reflect.ownKeys(object),
    descriptors: Object.getOwnPropertyDescriptors(object)
  }));
}

function assertLayersUnchanged(objects, before, label) {
  for (let index = 0; index < objects.length; index += 1) {
    assert.equal(Object.getPrototypeOf(objects[index]), before[index].prototype, `${label}: prototype ${index}`);
    assert.deepEqual(Reflect.ownKeys(objects[index]), before[index].keys, `${label}: keys ${index}`);
    assert.deepEqual(Object.getOwnPropertyDescriptors(objects[index]), before[index].descriptors,
      `${label}: descriptors and values ${index}`);
  }
}

test("all 16 existing fields reject nonenumerable, getter-only and setter-only descriptors without input mutation", () => {
  const layers = [
    ["outer", ["environment", "request", "target"]],
    ["request", REQUEST_FIELDS],
    ["target", TARGET_FIELDS]
  ];
  for (const [layer, fields] of layers) {
    for (const field of fields) {
      for (const kind of ["nonenumerable", "getter-only", "setter-only"]) {
        const input = validInput();
        const objects = [input, input.request, input.target];
        const object = layer === "outer" ? objects[0] : layer === "request" ? objects[1] : objects[2];
        const value = Object.getOwnPropertyDescriptor(object, field).value;
        let calls = 0;
        if (kind === "nonenumerable") {
          Object.defineProperty(object, field, { value, enumerable: false, configurable: true, writable: true });
        } else if (kind === "getter-only") {
          Object.defineProperty(object, field, {
            enumerable: true, configurable: true,
            get() { calls += 1; return value; }
          });
        } else {
          Object.defineProperty(object, field, {
            enumerable: true, configurable: true,
            set(received) { calls += 1; assert.equal(received, value); }
          });
        }
        const label = `${layer}.${field} ${kind}`;
        const before = snapshotLayers(objects);
        rejected(input, "INPUT");
        assert.equal(calls, 0, `${label}: accessor must not execute`);
        assertLayersUnchanged(objects, before, label);
      }
    }
  }
});

test("all eight ordinary/null prototype combinations keep frozen inputs and golden digest in both environments", () => {
  for (let mask = 0; mask < 8; mask += 1) {
    for (const environment of ["test", "development"]) {
      const original = validInput(environment);
      const input = Object.assign(Object.create(mask & 1 ? null : Object.prototype), original);
      input.request = Object.assign(Object.create(mask & 2 ? null : Object.prototype), original.request);
      input.target = Object.assign(Object.create(mask & 4 ? null : Object.prototype), original.target);
      const objects = [input, input.request, input.target];
      objects.forEach((object) => Object.freeze(object));
      const before = snapshotLayers(objects);
      const label = `prototype mask ${mask}, ${environment}`;
      accepted(input, "synthetic:sha256:" + GOLDEN_HEX);
      assertLayersUnchanged(objects, before, label);
      objects.forEach((object, index) => assert.equal(Object.isFrozen(object), true, `${label}: frozen ${index}`));
    }
  }
});
