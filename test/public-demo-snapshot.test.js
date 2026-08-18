"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPublicDemoSnapshot, sanitizeSnapshot } = require("../src/platform/data/public-demo-snapshot");

test("public demo snapshot masks identity fields and removes credentials recursively", () => {
  const source = {
    authUsers: [{ id: "u1", phone: "13900001111", password: "plain", passwordHash: "hash", accessToken: "token" }],
    residents: [{ id: "r1", name: "真实姓名", idCard: "210200199001010011", address: "真实地址", nested: { clientSecret: "secret" } }]
  };
  const original = structuredClone(source);
  const result = buildPublicDemoSnapshot(source, { generatedAt: "2026-08-18T00:00:00.000Z" });

  assert.deepEqual(source, original, "sanitization must not mutate the runtime snapshot");
  assert.match(result.snapshot.authUsers[0].phone, /^DEMO-MOBILE-/);
  assert.match(result.snapshot.residents[0].idCard, /^DEMO-ID-/);
  assert.match(result.snapshot.residents[0].name, /^演示姓名-/);
  assert.match(result.snapshot.residents[0].address, /^演示地址-/);
  assert.equal("password" in result.snapshot.authUsers[0], false);
  assert.equal("passwordHash" in result.snapshot.authUsers[0], false);
  assert.equal("accessToken" in result.snapshot.authUsers[0], false);
  assert.equal("clientSecret" in result.snapshot.residents[0].nested, false);
  assert.equal(result.report.totalMasked, 4);
  assert.equal(result.report.totalRemoved, 4);
  assert.equal(result.snapshot.storageMeta.publicDemoSnapshot.classification, "PUBLIC_DEMO");
});

test("public demo masking is stable for repeatable static previews", () => {
  const first = sanitizeSnapshot({ resident: { phone: "13900001111" } }, { maskSecret: "fixed-test-mask-secret" });
  const second = sanitizeSnapshot({ resident: { phone: "13900001111" } }, { maskSecret: "fixed-test-mask-secret" });
  assert.equal(first.snapshot.resident.phone, second.snapshot.resident.phone);
});
