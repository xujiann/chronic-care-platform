"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const policy = require("../access-control-policy");

const ROOT = path.resolve(__dirname, "..");
const user = (overrides = {}) => ({
  role: "institution",
  accountType: "manager",
  orgType: "medical_institution",
  home: "institution.html",
  ...overrides
});

test("all HTML browser entry points are explicitly registered", () => {
  const htmlPages = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.endsWith(".html"))
    .map((item) => item.name);
  for (const page of htmlPages) assert.ok(policy.pageCatalog[page], `${page} must be registered`);
  assert.ok(policy.pageCatalog["digital-hospital-standard-platform/index.html"]);
});

test("unknown pages and roles fail closed", () => {
  assert.deepEqual(policy.accessDecision("new-feature.html", user()), {
    allowed: false,
    reason: "PAGE_NOT_REGISTERED",
    page: "new-feature.html"
  });
  assert.equal(policy.accessDecision("health-city.html", user({ role: "superadmin" })).reason, "UNKNOWN_ROLE");
  assert.equal(policy.canAccessPage("quality-safety.html", null), false);
  assert.equal(policy.canAccessPage("about.html", null), true);
});

test("role, account type and organization type are evaluated together", () => {
  assert.equal(policy.canAccessPage("doctor.html", user({ accountType: "doctor" })), true);
  assert.equal(policy.accessDecision("doctor.html", user()).reason, "ACCOUNT_TYPE_DENIED");
  assert.equal(policy.accessDecision("doctor.html", user({ accountType: "doctor", orgType: "vendor" })).reason, "ORGANIZATION_TYPE_DENIED");
  assert.equal(policy.canAccessPage("insurance.html", user()), false);
});

test("regional capabilities restrict an otherwise authorized page", () => {
  assert.equal(policy.canAccessPage("imaging-cloud.html", user(), { regionalCapabilities: ["imagingCloud"] }), true);
  assert.equal(policy.accessDecision("imaging-cloud.html", user(), { regionalCapabilities: [] }).reason, "REGIONAL_CAPABILITY_DISABLED");
  assert.equal(policy.canAccessPage("imaging-cloud.html", user()), true, "absence of a capability context keeps legacy demo sessions usable");
});

test("quality safety and escort role drift is fixed", () => {
  assert.equal(policy.canAccessPage("quality-safety.html", user()), true);
  assert.equal(policy.canAccessPage("quality-safety.html", user({ role: "county", orgType: "county_consortium" })), true);
  assert.equal(policy.canAccessPage("escort.html", user()), true);
  assert.equal(policy.canAccessPage("escort.html", user({ role: "citizen", accountType: "resident", orgType: "citizen" })), false);
});

test("menus, homes and login candidates derive from the same policy", () => {
  const doctor = user({ accountType: "doctor", home: "doctor.html" });
  const menu = policy.pagesForUser(doctor);
  assert.equal(policy.homeForUser(doctor), "doctor.html");
  assert.ok(menu.some((item) => item.page === "doctor.html"));
  assert.ok(!menu.some((item) => item.page === "insurance.html"));
  const candidates = policy.eligibleUsersForPage("doctor.html", [doctor, user(), user({ role: "insurance" })]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].accountType, "doctor");
});

test("authorized navigation is grouped by function and nests related child pages", () => {
  const commission = user({
    role: "commission",
    accountType: "manager",
    orgType: "health_commission",
    home: "index.html"
  });
  const tree = policy.menuTreeForUser(commission);
  assert.ok(tree.length >= 5);
  assert.deepEqual(tree.slice(0, 3).map((group) => group.label), ["平台总览", "治理与监管", "公共卫生"]);

  const clinical = tree.find((group) => group.id === "institution");
  const blood = clinical.items.find((item) => item.page === "blood.html");
  assert.deepEqual(blood.children.map((item) => item.page), ["blood-business.html", "blood-go-live.html", "blood-innovation.html"]);

  const institutionOnly = user({ home: "institution.html" });
  const institutionTree = policy.menuTreeForUser(institutionOnly);
  const flattened = institutionTree.flatMap((group) => group.items.flatMap((item) => [item.page, ...item.children.map((child) => child.page)]));
  assert.ok(flattened.includes("institution.html"));
  assert.ok(!flattened.includes("insurance.html"));
});

test("explicit permission checks fail closed", () => {
  assert.equal(policy.canUsePermission("referral.accept", user({ permissions: ["referral.accept"] })), true);
  assert.equal(policy.canUsePermission("referral.accept", user()), false);
  assert.equal(policy.canUsePermission("", user({ permissions: [""] })), false);
});

test("server-authorized page lists further narrow local role policy", () => {
  const institution = user({ authorizedPages: ["institution.html"] });
  assert.equal(policy.canAccessPage("institution.html", institution), true);
  assert.equal(policy.accessDecision("imaging-cloud.html", institution).reason, "SERVER_PAGE_DENIED");
});
