const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

async function jsonRequest(baseUrl, pathname, token = "", options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json() };
}

async function downloadRequest(baseUrl, pathname, token) {
  const response = await fetch(`${baseUrl}${pathname}`, { headers: { Authorization: `Bearer ${token}` } });
  return { response, body: await response.text() };
}

async function login(baseUrl, username) {
  const result = await jsonRequest(baseUrl, "/api/auth/login", "", { method: "POST", body: JSON.stringify({ username, password: "123456" }) });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test("emergency HTTP API enforces citizen scope and produces verifiable exports", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "emergency-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const previousEnv = Object.fromEntries(["NODE_ENV", "DATA_DIR", "STORAGE_ENGINE", "SESSION_SECRETS", "SESSION_STORE"].map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "json",
    SESSION_SECRETS: "emergency-api-test-session-secret-2026",
    SESSION_STORE: "memory"
  });
  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
    Object.entries(previousEnv).forEach(([key, value]) => value === undefined ? delete process.env[key] : process.env[key] = value);
  });

  const citizenToken = await login(baseUrl, "citizen");
  const commissionToken = await login(baseUrl, "health");
  const institutionToken = await login(baseUrl, "hospital");

  const citizenBefore = await jsonRequest(baseUrl, "/api/emergency/dashboard", citizenToken);
  assert.equal(citizenBefore.response.status, 200);
  assert.equal(citizenBefore.body.events.length, 0, "unlinked dispatch seed data must not leak to citizens");

  const authorization = await jsonRequest(baseUrl, "/api/emergency/life-chain/authorizations", citizenToken, {
    method:"POST", body:JSON.stringify({ deviceId:"wearable-api-01", confirmed:true })
  });
  assert.equal(authorization.response.status, 201);
  const familyContact = await jsonRequest(baseUrl, "/api/emergency/life-chain/family-contacts", citizenToken, {
    method:"POST", body:JSON.stringify({ contactName:"API family", relation:"spouse", phoneMasked:"138****0000", confirmed:true })
  });
  assert.equal(familyContact.response.status, 201);

  const aedMap = await jsonRequest(baseUrl, "/api/emergency/aed-map?latitude=38.92&longitude=121.65", citizenToken);
  assert.equal(aedMap.response.status, 200);
  assert.equal(aedMap.body.nearestAvailable.status, "available");
  assert.ok(aedMap.body.sites.every((site, index, rows) => index === 0 || site.distanceMeters >= rows[index - 1].distanceMeters));

  const deviceSos = await jsonRequest(baseUrl, "/api/emergency/life-chain/device-sos", citizenToken, {
    method:"POST",
    body:JSON.stringify({ deviceId:"wearable-api-01", detectedSignal:"cardiac-risk", riskScore:86, address:"Device SOS test location", latitude:38.92, longitude:121.65, networkStatus:"weak", sourceSignalId:"wearable-api-01-signal-01" })
  });
  assert.equal(deviceSos.response.status, 201, JSON.stringify(deviceSos.body));
  assert.equal(deviceSos.body.event.sos.autoAuthorized, true);
  assert.equal(deviceSos.body.event.lifeChain.firstAidTaskIds.length > 0, true);
  const duplicateDeviceSos = await jsonRequest(baseUrl, "/api/emergency/life-chain/device-sos", citizenToken, {
    method:"POST",
    body:JSON.stringify({ deviceId:"wearable-api-01", detectedSignal:"cardiac-risk", riskScore:86, address:"Device SOS test location", sourceSignalId:"wearable-api-01-signal-01" })
  });
  assert.equal(duplicateDeviceSos.response.status, 200, JSON.stringify(duplicateDeviceSos.body));
  assert.equal(duplicateDeviceSos.body.submission.deduplicated, true);
  assert.equal(duplicateDeviceSos.body.event.id, deviceSos.body.event.id);
  const cancellationRequested = await jsonRequest(baseUrl, `/api/emergency/events/${encodeURIComponent(deviceSos.body.event.id)}/automatic-sos-cancellation-request`, citizenToken, { method:"POST", body:JSON.stringify({ confirmed:true, reason:"API false-positive review" }) });
  assert.equal(cancellationRequested.response.status, 200);
  assert.equal(cancellationRequested.body.sos.reviewStatus, "cancellation-requested");
  const cancellationResolved = await jsonRequest(baseUrl, `/api/emergency/events/${encodeURIComponent(deviceSos.body.event.id)}/automatic-sos-cancellation-resolve`, commissionToken, { method:"POST", body:JSON.stringify({ confirmed:true, decision:"keep-open", note:"API review retained queue" }) });
  assert.equal(cancellationResolved.response.status, 200);
  assert.equal(cancellationResolved.body.sos.reviewStatus, "kept-open");
  const lifeChain = await jsonRequest(baseUrl, `/api/emergency/life-chain/overview?eventId=${encodeURIComponent(deviceSos.body.event.id)}`, citizenToken);
  assert.equal(lifeChain.response.status, 200);
  assert.equal(lifeChain.body.familyNotifications.length, 1);
  assert.equal(lifeChain.body.fallbackDeliveries.length, 1);
  const commandCenter = await jsonRequest(baseUrl, "/api/emergency/life-chain/command-center", commissionToken);
  assert.equal(commandCenter.response.status, 200);
  assert.equal(commandCenter.body.coverage.availableAed >= 1, true);
  const greenConfirmed = await jsonRequest(baseUrl, `/api/emergency/events/${encodeURIComponent(deviceSos.body.event.id)}/green-channel/confirm`, institutionToken, { method:"POST", body:JSON.stringify({ note:"API hospital pre-alert confirmed" }) });
  assert.equal(greenConfirmed.response.status, 200);
  assert.equal(greenConfirmed.body.item.status, "hospital-confirmed");
  const lifeChainQuality = await jsonRequest(baseUrl, "/api/emergency/life-chain/quality", commissionToken);
  assert.equal(lifeChainQuality.response.status, 200);
  assert.equal(lifeChainQuality.body.summary.automaticSos, 1);
  assert.equal(lifeChainQuality.body.summary.suppressedDuplicateSignals, 1);
  const revokedAuthorization = await jsonRequest(baseUrl, `/api/emergency/life-chain/authorizations/${encodeURIComponent(authorization.body.item.id)}/revoke`, citizenToken, { method:"POST", body:JSON.stringify({ confirmed:true }) });
  assert.equal(revokedAuthorization.response.status, 200);
  assert.equal(revokedAuthorization.body.item.active, false);

  const rejectedSos = await jsonRequest(baseUrl, "/api/emergency/sos", citizenToken, {
    method:"POST",
    body:JSON.stringify({ address:"SOS test location", chiefComplaint:"Collapse" })
  });
  assert.equal(rejectedSos.response.status, 400);
  const sos = await jsonRequest(baseUrl, "/api/emergency/sos", citizenToken, {
    method:"POST",
    body:JSON.stringify({ confirmed:true, detectedSignal:"collapse", address:"SOS test location", chiefComplaint:"Collapse", latitude:38.92, longitude:121.65 })
  });
  assert.equal(sos.response.status, 201);
  assert.equal(sos.body.event.source, "device-sos");
  assert.equal(sos.body.event.sos.autoDialUri, "tel:120");
  assert.equal(sos.body.callInstruction.requiresDeviceConfirmation, true);

  const created = await jsonRequest(baseUrl, "/api/emergency/calls", citizenToken, {
    method: "POST",
    body: JSON.stringify({ address: "Emergency API test location", chiefComplaint: "Acute chest pain", triageLevel: "P1" })
  });
  assert.equal(created.response.status, 201);
  const eventId = created.body.event.id;

  const citizenAfter = await jsonRequest(baseUrl, "/api/emergency/dashboard", citizenToken);
  assert.deepEqual(citizenAfter.body.events.map((item) => item.id).sort(), [eventId, sos.body.event.id, deviceSos.body.event.id].sort());
  const deniedSeedPackage = await jsonRequest(baseUrl, "/api/emergency/events/emg-demo-001/evidence-package", citizenToken);
  assert.equal(deniedSeedPackage.response.status, 403);

  const dispatch = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, commissionToken, { method: "POST", body: JSON.stringify({ action: "dispatch", ambulanceId: "amb-120-02", etaMinutes: 6 }) });
  assert.equal(dispatch.response.status, 200);
  for (const status of ["departed", "arrived-scene", "patient-contact", "transporting"]) {
    const vehicle = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, institutionToken, { method: "POST", body: JSON.stringify({ action: "vehicle-update", status }) });
    assert.equal(vehicle.response.status, 200);
  }
  const clinical = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, institutionToken, { method: "POST", body: JSON.stringify({ action: "clinical-update", systolic: 156, diastolic: 95, heartRate: 106, spo2: 94, preliminaryDiagnosis: "Acute coronary syndrome suspected" }) });
  assert.equal(clinical.response.status, 200);
  const receiving = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, institutionToken, { method: "POST", body: JSON.stringify({ action: "hospital-confirm", hospitalId: "hosp-central", greenChannel: "chest-pain" }) });
  assert.equal(receiving.response.status, 200);
  const arrived = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, institutionToken, { method: "POST", body: JSON.stringify({ action: "vehicle-update", status: "arrived-hospital" }) });
  assert.equal(arrived.response.status, 200);
  const handover = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, institutionToken, { method: "POST", body: JSON.stringify({ action: "handover", hospitalVisitId: "ER-API-001", hospitalSigner: "Emergency receiver" }) });
  assert.equal(handover.response.status, 200);
  const closed = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/actions`, commissionToken, { method: "POST", body: JSON.stringify({ action: "close" }) });
  assert.equal(closed.response.status, 200);

  const evidence = await jsonRequest(baseUrl, `/api/emergency/events/${eventId}/evidence-package`, citizenToken);
  assert.equal(evidence.response.status, 200);
  assert.equal(evidence.body.completeness.ready, true);
  assert.equal(evidence.body.sections.find((item) => item.id === "handover").present, true);

  const jsonExport = await downloadRequest(baseUrl, `/api/emergency/events/${eventId}/evidence-package/export?format=json`, citizenToken);
  assert.equal(jsonExport.response.status, 200);
  assert.match(jsonExport.response.headers.get("content-type"), /application\/json/);
  assert.match(jsonExport.response.headers.get("content-disposition"), /attachment/);
  const exportedDocument = JSON.parse(jsonExport.body);
  assert.match(exportedDocument.integrity.digest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(exportedDocument.evidencePackage.eventId, eventId);

  const markdownExport = await downloadRequest(baseUrl, `/api/emergency/events/${eventId}/evidence-package/export?format=markdown`, commissionToken);
  assert.equal(markdownExport.response.status, 200);
  assert.match(markdownExport.response.headers.get("content-type"), /text\/markdown/);
  assert.match(markdownExport.body, /Prehospital emergency evidence package/);
  assert.match(markdownExport.body, /SHA-256/);
});
