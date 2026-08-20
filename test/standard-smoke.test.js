const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("isolated runtime serves liveness, health and public login while denying source data", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-smoke-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));

  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";
  process.env.PORT = "0";

  const {
    operationalControlPlaneReadiness,
    pilotCutoverAlertControlReadiness,
    pilotCutoverControlHealthReadiness,
    pilotCutoverControlPlaneReadiness,
    productionAdapterRuntimeReadiness,
    server,
    shadowRelayControlPlaneReadiness,
    startServer,
    stopServer
  } = require("../server");
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  startServer(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const live = await fetch(`${baseUrl}/api/live`);
  const health = await fetch(`${baseUrl}/api/health`);
  const login = await fetch(`${baseUrl}/login.html`);
  const sourceData = await fetch(`${baseUrl}/data/db.json`);
  const readiness = await Promise.all([
    productionAdapterRuntimeReadiness(),
    shadowRelayControlPlaneReadiness(),
    operationalControlPlaneReadiness(),
    pilotCutoverControlPlaneReadiness(),
    pilotCutoverControlHealthReadiness(),
    pilotCutoverAlertControlReadiness()
  ]);

  assert.equal(live.status, 200);
  const liveBody = await live.json();
  assert.equal(liveBody.ok, true);
  assert.equal(liveBody.service?.name, "chronic-care-platform");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).ok, true);
  assert.equal(login.status, 200);
  assert.match(await login.text(), /login-user/);
  assert.equal(sourceData.status, 404);
  assert.deepEqual(readiness.map((item) => item.productionReady), [false, false, false, false, false, false]);
  assert.deepEqual(readiness.map((item) => item.schema), [
    "platform-production-adapter-runtime-v1",
    "shadow-relay-control-plane-v1",
    "platform-operational-control-report-v1",
    "pilot-cutover-authorization-control-v1",
    "pilot-cutover-control-health-v1",
    "pilot-cutover-alert-control-status-v1"
  ]);
});
