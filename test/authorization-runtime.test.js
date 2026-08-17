"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { authorize, safeAuthorizationContext } = require("../src/identity-security/authorization-runtime");
const { initializeRuntimeJson, resolveRuntimeDataBoundary } = require("../src/identity-security/runtime-data-boundary");

test("authorization runtime fails closed for missing policies and unknown roles", () => {
  assert.equal(authorize({ role: "commission" }, null).code, "UNKNOWN_POLICY");
  assert.equal(authorize({ role: "future-super-admin" }, { roles: ["commission"] }).code, "UNKNOWN_ROLE");
  assert.equal(authorize({ role: "commission" }, { roles: ["*"] }).code, "UNKNOWN_POLICY");
  assert.equal(authorize({ role: "commission" }, { roles: ["commission"], futureRule: true }).code, "UNKNOWN_POLICY");
});

test("authorization runtime evaluates account, permission, organization and region boundaries", () => {
  const doctor = {
    role: "institution",
    accountType: "doctor",
    orgType: "medical_institution",
    orgCode: "H001",
    regionCode: "210200",
    permissions: ["referral.accept", "resident.read"]
  };
  const policy = {
    roles: ["institution"],
    accountTypes: ["doctor"],
    orgTypes: ["medical_institution"],
    permissions: ["referral.accept"],
    organizationScope: "self",
    regionScope: "self"
  };
  assert.equal(authorize(doctor, policy, { orgCode: "H001", regionCode: "210200" }).allowed, true);
  assert.equal(authorize({ ...doctor, accountType: "nurse" }, policy, { orgCode: "H001", regionCode: "210200" }).code, "ACCOUNT_TYPE_DENIED");
  assert.equal(authorize({ ...doctor, permissions: [] }, policy, { orgCode: "H001", regionCode: "210200" }).code, "PERMISSION_DENIED");
  assert.equal(authorize(doctor, policy, { orgCode: "H002", regionCode: "210200" }).code, "ORGANIZATION_SCOPE_DENIED");
  assert.equal(authorize(doctor, policy, { orgCode: "H001", regionCode: "990001" }).code, "REGION_SCOPE_DENIED");
});

test("authorization context exposes whitelist metadata only", () => {
  const context = safeAuthorizationContext({
    id: "u1", username: "doctor", name: "Doctor", role: "institution",
    roleName: "Doctor", accountType: "doctor", orgCode: "H001", orgName: "Hospital",
    orgType: "medical_institution", passwordHash: "secret", phone: "13800000000"
  }, {
    pages: ["doctor.html"], permissions: ["referral.accept"],
    menus: [{ id: "doctor", label: "Doctor", href: "doctor.html", secret: "discard" }],
    regionCode: "210200"
  });
  assert.equal(context.user.passwordHash, undefined);
  assert.equal(context.user.phone, undefined);
  assert.deepEqual(context.menus, [{ id: "doctor", label: "Doctor", href: "doctor.html" }]);
  assert.equal(context.productionReady, false);
});

test("default runtime storage copies tracked seed without mutating it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-boundary-"));
  fs.mkdirSync(path.join(root, "data"), { recursive: true });
  const seedFile = path.join(root, "data", "db.json");
  fs.writeFileSync(seedFile, JSON.stringify({ seed: true }), "utf8");
  const before = fs.readFileSync(seedFile, "utf8");
  const boundary = resolveRuntimeDataBoundary({ root, env: {} });
  assert.equal(boundary.runtimeDirectory, path.join(root, "var", "runtime"));
  assert.deepEqual(initializeRuntimeJson(boundary, () => ({ generated: true })), { created: true, source: "tracked-seed" });
  fs.writeFileSync(boundary.runtimeFile, JSON.stringify({ runtime: true }), "utf8");
  assert.equal(fs.readFileSync(seedFile, "utf8"), before);
  fs.rmSync(root, { recursive: true, force: true });
});

test("tracked seed directory cannot be selected as runtime storage", () => {
  const root = path.join(os.tmpdir(), "runtime-boundary-deny");
  assert.throws(
    () => resolveRuntimeDataBoundary({ root, env: { DATA_DIR: path.join(root, "data") } }),
    (error) => error.code === "TRACKED_SEED_RUNTIME_FORBIDDEN"
  );
});
