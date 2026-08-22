"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const policy = require("../access-control-policy");
const modules = require("../platform-domain-modules");

const ROOT = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(ROOT, name), "utf8");

test("every shell-managed application HTML loads the shared policy before auth", () => {
  const independentlyPackaged = new Set(["physical-examination-standalone.html"]);
  const files = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".html"))
    .map((entry) => entry.name);
  for (const file of files) {
    const source = read(file);
    if (independentlyPackaged.has(file)) {
      assert.doesNotMatch(source, /auth\.js/, `${file} keeps its independent module boundary and is guarded by the server policy`);
      continue;
    }
    assert.match(source, /access-control-policy\.js/, `${file} must load the shared policy`);
    if (/auth\.js/.test(source)) {
      assert.ok(source.indexOf("access-control-policy.js") < source.indexOf("auth.js"), `${file} must load policy before auth`);
    }
  }
  const nested = read("digital-hospital-standard-platform/index.html");
  assert.ok(nested.indexOf("access-control-policy.js") < nested.indexOf("auth.js"));
});

test("legacy page role guards cannot grant roles outside the central policy", () => {
  for (const [page, entry] of Object.entries(policy.pageCatalog)) {
    if (page.includes("/")) continue;
    const source = read(page);
    const match = source.match(/<script[^>]+src="\.\/page-auth-bootstrap\.js"[^>]+data-roles="([^"]+)"/);
    if (!match) continue;
    const declared = match[1].split(",").map((role) => role.trim()).filter(Boolean);
    for (const role of declared) assert.ok(entry.roles.includes(role), `${page} declares ${role} outside central policy`);
  }
});

test("formal login markup contains no visible shared password or demo verification code", () => {
  const html = read("login.html");
  assert.doesNotMatch(html, /value=["']123456/);
  assert.doesNotMatch(html, /value=["']888888/);
  assert.match(html, /login-environment-banner/);
  assert.match(html, /identity-type-grid/);
  assert.match(html, /access-preview-functions/);
  assert.match(read("login.js"), /演示账号统一密码为 123456/);
});

test("role menus expose only pages authorized for the exact account type", () => {
  const manager = { role: "institution", accountType: "manager", orgType: "medical_institution" };
  const doctor = { role: "institution", accountType: "doctor", orgType: "medical_institution" };
  const managerPages = policy.pagesForUser(manager).map((item) => item.page);
  const doctorPages = policy.pagesForUser(doctor).map((item) => item.page);
  assert.ok(!managerPages.includes("doctor.html"));
  assert.ok(doctorPages.includes("doctor.html"));
  assert.ok(!doctorPages.includes("insurance.html"));
  assert.ok(modules.forUser(doctor).some((item) => item.id === "citizen-chronic"));
});

test("negative direct links fail closed and select a safe role home", () => {
  const insurer = { role: "insurance", accountType: "manager", orgType: "insurance_bureau", home: "insurance.html" };
  assert.equal(policy.accessDecision("doctor.html", insurer).reason, "ROLE_DENIED");
  assert.equal(policy.accessDecision("unregistered.html", insurer).reason, "PAGE_NOT_REGISTERED");
  assert.equal(policy.homeForUser(insurer), "insurance.html");
  assert.match(read("auth.js"), /deniedPage \? `\?denied=\$\{encodeURIComponent\(deniedPage\)\}`/);
});

test("auth client initializes the server authorization context before navigation", () => {
  const source = read("auth.js");
  assert.match(source, /await refreshAuthContext\(\)/);
  assert.match(source, /授权上下文初始化失败，已阻止进入系统/);
  assert.match(source, /credentials:\s*"same-origin"/);
  assert.match(source, /health_platform_csrf/);
  assert.match(source, /X-CSRF-Token/);
  assert.match(source, /const headers = new Headers\(extra\)/);
  assert.match(source, /headers\.set\("X-CSRF-Token", csrfToken\)/);
  assert.match(source, /HealthAccessPolicy/);
  assert.match(source, /pageName\.endsWith\("\.html"\) && !canAccessPage/);
  assert.doesNotMatch(source, /return !allowed \|\| allowed\.includes/);
  const contextBody = source.slice(source.indexOf("async function refreshAuthContext("), source.indexOf("async function logout()"));
  assert.match(contextBody, /if \(!useBearer\) \{[\s\S]*?clearStoredBrowserCredentials\(\)/);
  assert.match(contextBody, /: await fetch\(`\$\{API_BASE\}\/auth\/context`, \{ method: "GET", credentials: "same-origin" \}\)/);
});

test("cookie-only protected pages hydrate context before the fail-closed access decision", () => {
  const source = read("auth.js");
  const start = source.indexOf("async function initializePageAccess()");
  const end = source.indexOf("function filterRoleLinks()", start);
  const initializer = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(initializer.indexOf("await refreshAuthContext()") < initializer.indexOf("enforceCurrentPageAccess()"));
  assert.match(initializer, /if \(!contextResult\.ok\) \{[\s\S]*?clearBrowserSession\(\)/);
  assert.doesNotMatch(source.slice(source.indexOf("window.HealthCityAuth =")), /\n\s*enforceCurrentPageAccess\(\);/);
  assert.match(source, /every\(Array\.isArray\)/);
  assert.match(source, /reason: "INVALID_AUTH_CONTEXT"/);
});

test("all external page guards defer to pending cookie hydration and central policy", () => {
  const authSource = read("auth.js");
  assert.match(authSource, /authContextState = API_BASE \? "pending" : "ready"/);
  assert.match(authSource, /setAttribute\("data-auth-resolved", "pending"\)/);
  assert.match(authSource, /pendingStyle\.textContent = 'html:not\(\[data-auth-resolved="allowed"\]\)/);
  assert.match(authSource, /function requireRole\(roles\) \{[\s\S]*?authContextState === "pending"\) return true/);
  assert.match(authSource, /function requireAccountType\(types\) \{[\s\S]*?authContextState === "pending"\) return true/);
  assert.match(read("portal.css"), /html:not\(\[data-auth-resolved="allowed"\]\)/);

  const guardedPages = fs.readdirSync(ROOT)
    .filter((name) => name.endsWith(".html"))
    .filter((name) => /src="\.\/page-auth-bootstrap\.js"/.test(read(name)));
  assert.ok(guardedPages.length >= 30);
  for (const page of guardedPages) {
    const source = read(page);
    const policyIndex = source.indexOf("access-control-policy.js");
    const authIndex = source.indexOf("auth.js");
    const guardIndex = source.indexOf("page-auth-bootstrap.js");
    assert.ok(policyIndex >= 0 && policyIndex < authIndex && authIndex < guardIndex, `${page} must load policy and auth before its external guard`);
  }
});

test("cookie sessions always call server logout and discard script-readable bearer tokens", () => {
  const source = read("auth.js");
  const start = source.indexOf("async function logout()");
  const end = source.indexOf("function localHref", start);
  const logout = source.slice(start, end);
  assert.match(logout, /if \(API_BASE\)/);
  assert.match(logout, /await authFetch\(`\$\{API_BASE\}\/auth\/logout`/);
  assert.doesNotMatch(logout, /user\?\.token|user\.token/);
  assert.match(source, /SCRIPT_READABLE_CREDENTIAL_FIELDS\.forEach\(\(field\) => delete safe\[field\]\)/);
  assert.doesNotMatch(source, /token:\s*payload\.token/);
  assert.match(read("login.js"), /if \(auth\.getUser\(\)\) \{[\s\S]*?auth\.refreshAuthContext\(\)/);
});
