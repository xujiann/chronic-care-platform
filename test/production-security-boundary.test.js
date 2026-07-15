const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-production-security-"));
process.env.DATA_DIR = dataDir;
process.env.STORAGE_ENGINE = "sqlite";
process.env.NODE_ENV = "production";
process.env.SESSION_SECRETS = "prod-session-signing-key-2026-07-15-rotation-a";

const {
  assertProductionRuntimeSecurity,
  server,
  startServer,
  stopServer
} = require("../server");

test.after(async () => {
  await stopServer();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("production startup rejects missing, weak and placeholder session secrets", () => {
  for (const environment of [
    { NODE_ENV: "production" },
    { NODE_ENV: "production", SESSION_SECRET: "short" },
    { NODE_ENV: "production", SESSION_SECRET: "replace-with-a-production-session-secret-now" }
  ]) {
    assert.throws(
      () => assertProductionRuntimeSecurity(environment),
      (error) => error.code === "PRODUCTION_SESSION_SECRET_INVALID"
    );
  }
});

test("production runtime disables local passwords and emits browser security headers", async () => {
  startServer(0);
  if (!server.listening) await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const page = await fetch(`${baseUrl}/login.html`);
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
  assert.equal(page.headers.get("x-frame-options"), "SAMEORIGIN");
  assert.match(page.headers.get("content-security-policy"), /script-src-attr 'none'/);
  assert.match(page.headers.get("strict-transport-security"), /max-age=31536000/);

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "city", password: "123456" })
  });
  const body = await login.json();
  assert.equal(login.status, 403);
  assert.equal(body.code, "LOCAL_PASSWORD_LOGIN_DISABLED");
});

test("browser clients fail closed and persistent blood-system fields are encoded", () => {
  const root = path.resolve(__dirname, "..");
  const authSource = fs.readFileSync(path.join(root, "auth.js"), "utf8");
  const businessSource = fs.readFileSync(path.join(root, "blood-business.js"), "utf8");
  const recallSource = fs.readFileSync(path.join(root, "blood-recall.js"), "utf8");

  assert.match(authSource, /return \{ ok: false, message: "认证服务暂不可用，请稍后重试" \}/);
  assert.match(businessSource, /escapeHtml\(target\)/);
  assert.match(recallSource, /escapeHtml\(item\.reason\)/);
  assert.match(recallSource, /data-recall-action="\$\{escapeHtml\(item\.id\)\}"/);
});
