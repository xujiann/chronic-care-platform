"use strict";

const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "authorization-runtime-api-"));
const seedFile = path.join(ROOT, "data", "db.json");
const seedBefore = fs.readFileSync(seedFile, "utf8");
const fixture = JSON.parse(seedBefore);
fixture.authUsers.push({
  id: "u-unknown-role",
  username: "unknown_role",
  password: "123456",
  name: "Unknown Role",
  role: "future-root",
  orgCode: "UNKNOWN",
  orgType: "unknown",
  home: "platform.html",
  status: "启用"
});
fs.writeFileSync(path.join(dataDir, "db.json"), JSON.stringify(fixture), "utf8");

process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "json";
process.env.NODE_ENV = "test";
process.env.SESSION_STORE = "memory";

const { server, startServer, stopServer } = require("../server");

let baseUrl;

async function login(username) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
  return { response, body: await response.json() };
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

test.before(async () => {
  startServer(0);
  if (!server.listening) await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await stopServer();
  assert.equal(fs.readFileSync(seedFile, "utf8"), seedBefore, "tracked seed must remain byte-for-byte unchanged");
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("authorization context requires authentication and denies unknown roles", async () => {
  const anonymous = await fetch(`${baseUrl}/api/auth/context`);
  assert.equal(anonymous.status, 401);

  const forged = await fetch(`${baseUrl}/api/auth/context`, { headers: bearer("forged-session") });
  assert.equal(forged.status, 401);

  const unknown = await login("unknown_role");
  assert.equal(unknown.response.status, 403);
  assert.equal(unknown.body.code, "UNKNOWN_ROLE_DENIED");
});

test("browser cookie can read context while unsafe requests require signed CSRF", async () => {
  const doctor = await login("doctor");
  const setCookies = doctor.response.headers.getSetCookie();
  const cookieHeader = setCookies.map((value) => value.split(";")[0]).join("; ");
  assert.match(cookieHeader, /health_city_browser_session=/);
  assert.match(cookieHeader, /health_platform_csrf=/);

  const context = await fetch(`${baseUrl}/api/auth/context`, { headers: { Cookie: cookieHeader } });
  assert.equal(context.status, 200);
  assert.equal((await context.json()).user.accountType, "doctor");

  const rejected = await fetch(`${baseUrl}/api/auth/logout`, { method: "POST", headers: { Cookie: cookieHeader } });
  assert.equal(rejected.status, 403);
  assert.equal((await rejected.json()).code, "CSRF_VALIDATION_FAILED");

  const csrf = decodeURIComponent(cookieHeader.match(/(?:^|; )health_platform_csrf=([^;]+)/)[1]);
  const accepted = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: { Cookie: cookieHeader, "X-CSRF-Token": csrf }
  });
  assert.equal(accepted.status, 200);
});

test("authorization context returns whitelist metadata and role-specific pages", async () => {
  const doctor = await login("doctor");
  assert.equal(doctor.response.status, 200);
  const response = await fetch(`${baseUrl}/api/auth/context`, { headers: bearer(doctor.body.token) });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.ok, true);
  assert.equal(body.user.role, "institution");
  assert.equal(body.user.accountType, "doctor");
  assert.equal(body.user.password, undefined);
  assert.equal(body.user.passwordHash, undefined);
  assert.equal(body.user.phone, undefined);
  assert.equal(body.pages.includes("doctor.html"), true);
  assert.equal(body.pages.includes("platform.html"), false);
  assert.equal(body.pages.includes("referral-teleconsultation-about.html"), true);
  assert.equal(body.menus.some((item) => item.href === "./referral-teleconsultation-about.html"), false);
  assert.equal(body.menus.every((item) => Object.keys(item).every((key) => ["id", "label", "href"].includes(key))), true);
  assert.equal(body.productionReady, false);
});

test("protected static business pages require and enforce the browser session", async () => {
  const anonymous = await fetch(`${baseUrl}/doctor.html`, { redirect: "manual" });
  assert.equal(anonymous.status, 302);
  assert.match(anonymous.headers.get("location"), /^\/login\.html\?redirect=/);

  const doctor = await login("doctor");
  const cookie = `health_city_browser_session=${encodeURIComponent(doctor.body.token)}`;
  const allowed = await fetch(`${baseUrl}/doctor.html`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(allowed.status, 200);

  const roleDenied = await fetch(`${baseUrl}/platform.html`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(roleDenied.status, 302);
  assert.match(roleDenied.headers.get("location"), /^\/login\.html\?denied=/);

  const unknownPage = await fetch(`${baseUrl}/future-admin.html`, { headers: { Cookie: cookie }, redirect: "manual" });
  assert.equal(unknownPage.status, 404);
  assert.equal(unknownPage.headers.get("location"), null);
});

test("public whitelist remains available without a session", async () => {
  for (const page of ["login.html", "about.html", "health-city.html"]) {
    const response = await fetch(`${baseUrl}/${page}`, { redirect: "manual" });
    assert.equal(response.status, 200, page);
  }
});
