const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

function loadAuth() {
  const values = new Map();
  const sandbox = {
    URL,
    URLSearchParams,
    Date,
    Set,
    console,
    encodeURIComponent,
    fetch: async () => { throw new Error("unexpected fetch"); },
    location: {
      protocol: "https:",
      hostname: "identity.test",
      origin: "https://identity.test",
      pathname: "/login.html",
      search: ""
    },
    localStorage: {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, String(value)); },
      removeItem(key) { values.delete(key); }
    },
    document: {
      body: { dataset: { authPage: "login" } },
      addEventListener() {},
      querySelectorAll() { return []; }
    },
    window: { location: {} }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "auth.js"), "utf8"), sandbox, { filename: "auth.js" });
  return sandbox.window.HealthCityAuth;
}

function guardian(overrides = {}) {
  return {
    id: "guardian-user-1",
    accountId: "guardian-account-1",
    role: "citizen",
    accountType: "guardian",
    assuranceLevel: "aal2",
    stepUpAt: "2026-07-22T09:55:00.000Z",
    delegations: [{
      id: "delegation-1",
      actorAccountId: "guardian-account-1",
      subjectResidentId: "resident-minor-1",
      relationship: "legal-guardian",
      status: "active",
      validFrom: "2026-07-01T00:00:00.000Z",
      validUntil: "2026-08-01T00:00:00.000Z",
      permissions: ["resident.delegated.read", "resident.record.export"]
    }],
    ...overrides
  };
}

test("external identity keys require and namespace issuer plus subject", () => {
  const auth = loadAuth();
  assert.equal(auth.buildExternalIdentityKey({ sub: "subject-1" }), "");
  assert.equal(auth.buildExternalIdentityKey({ iss: "https://idp-a.example", sub: "subject-1" }), "https%3A%2F%2Fidp-a.example::subject-1");
  assert.notEqual(
    auth.buildExternalIdentityKey({ iss: "https://idp-a.example", sub: "subject-1" }),
    auth.buildExternalIdentityKey({ iss: "https://idp-b.example", sub: "subject-1" })
  );
});

test("account type normalization separates residents, guardians and practitioners", () => {
  const auth = loadAuth();
  assert.equal(auth.normalizeAccountType({ role: "citizen" }), "resident");
  assert.equal(auth.normalizeAccountType({ accountType: "family_proxy" }), "guardian");
  assert.equal(auth.normalizeAccountType({ role: "institution", doctorId: "doctor-1" }), "doctor");
  assert.equal(auth.normalizeAccountType({ role: "institution", nurseId: "nurse-1" }), "nurse");
  assert.equal(auth.normalizeAccountType({ role: "insurance" }), "manager");
});

test("active guardian delegation returns actor and subject context", () => {
  const auth = loadAuth();
  const result = auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.delegated.read", {
    user: guardian({ assuranceLevel: "", stepUpAt: "" }),
    now: "2026-07-22T10:00:00.000Z"
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "delegated");
  assert.equal(result.actorAccountId, "guardian-account-1");
  assert.equal(result.subjectResidentId, "resident-minor-1");
  assert.equal(result.clientHintOnly, true);
});

test("delegated access fails closed for wrong actors, invalid periods and broad permissions", () => {
  const auth = loadAuth();
  const now = "2026-07-22T10:00:00.000Z";
  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.delegated.read", {
    user: { role: "citizen", accountType: "resident" }, now
  }).reason, "GUARDIAN_ACCOUNT_REQUIRED");

  const expired = guardian({ delegations: [{
    ...guardian().delegations[0],
    validUntil: "2026-07-20T00:00:00.000Z"
  }] });
  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.delegated.read", { user: expired, now }).reason, "DELEGATION_EXPIRED");

  const wildcard = guardian({ delegations: [{
    ...guardian().delegations[0],
    permissions: ["*"]
  }] });
  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.delegated.read", { user: wildcard, now }).reason, "DELEGATION_WILDCARD_FORBIDDEN");

  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "payment.submit", { user: guardian(), now }).reason, "DELEGATION_PERMISSION_DENIED");
});

test("sensitive delegated actions require recent strong authentication", () => {
  const auth = loadAuth();
  const now = "2026-07-22T10:00:00.000Z";
  const weak = guardian({ assuranceLevel: "aal1" });
  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.record.export", { user: weak, now }).reason, "DELEGATION_STEP_UP_REQUIRED");

  const stale = guardian({ stepUpAt: "2026-07-22T09:30:00.000Z" });
  assert.equal(auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.record.export", { user: stale, now }).reason, "DELEGATION_STEP_UP_REQUIRED");

  const accepted = auth.authorizeDelegatedResidentAccess("resident-minor-1", "resident.record.export", { user: guardian(), now });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.permission, "resident.record.export");
});
