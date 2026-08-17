"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  evaluateStaticPageAccess,
  isProtectedStaticRequest,
  loginRedirect
} = require("../src/identity-security/static-page-guard");

const request = (url, method = "GET") => ({ url, method, headers: { host: "localhost" } });

test("static guard explicitly allows login/about pages and leaves assets outside session lookup", () => {
  assert.equal(isProtectedStaticRequest(request("/login.html")), false);
  assert.equal(isProtectedStaticRequest(request("/about.html")), false);
  assert.equal(isProtectedStaticRequest(request("/app.js")), false);
  assert.equal(evaluateStaticPageAccess(request("/login.html"), null).allowed, true);
});

test("unknown and known business pages fail closed without a browser session", () => {
  for (const page of ["/doctor.html", "/future-admin.html", "/"]) {
    const decision = evaluateStaticPageAccess(request(page), null, () => ({ allowed: true }));
    assert.equal(decision.status, 401);
    assert.match(loginRedirect(decision), /^\/login\.html\?redirect=/);
  }
});

test("static page authorization rejects denied and missing policies", () => {
  const session = { user: { role: "institution" } };
  const denied = evaluateStaticPageAccess(request("/platform.html"), session, () => ({ allowed: false, code: "ROLE_DENIED" }));
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "ROLE_DENIED");
  assert.match(loginRedirect(denied), /^\/login\.html\?denied=/);
  assert.equal(evaluateStaticPageAccess(request("/future.html"), session).code, "PAGE_NOT_REGISTERED");
});

test("static page authorization accepts only explicit positive policy decisions", () => {
  const session = { user: { role: "institution", accountType: "doctor" } };
  const allowed = evaluateStaticPageAccess(request("/doctor.html"), session, (page, user) => ({
    allowed: page === "doctor.html" && user.accountType === "doctor"
  }));
  assert.equal(allowed.allowed, true);
});
