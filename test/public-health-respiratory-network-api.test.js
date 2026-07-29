"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  RESPIRATORY_NETWORK_EVIDENCE_PURPOSE
} = require("../public-health-respiratory-network-readiness-service");

const ROOT = path.resolve(__dirname, "..");
const ACTIVE_SECRET = "public-health-respiratory-network-api-active-secret-2026";
const NEXT_SECRET = "public-health-respiratory-network-api-next-secret-2026";
const VALID_FROM = new Date(Date.now() - 60_000).toISOString();
const EXPIRES_AT = new Date(Date.now() + 3_600_000).toISOString();

function managedKeyring() {
  return {
    purpose: RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
    activeKeyId: "respiratory-network-api-key-a",
    keys: [{
      keyId: "respiratory-network-api-key-a",
      secret: ACTIVE_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2027-07-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

async function request(baseUrl, pathname, token = "", options = {}) {
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

async function login(baseUrl, username) {
  const result = await request(baseUrl, "/api/auth/login", "", {
    method: "POST",
    body: JSON.stringify({ username, password: "123456" })
  });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return result.body.token;
}

async function issue(baseUrl, token, evidenceId, idempotencyKey, overrides = {}) {
  return request(
    baseUrl,
    `/api/public-health/respiratory-network-evidence/${encodeURIComponent(evidenceId)}/actions`,
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        action: "issue-trusted-evidence",
        expectedVersion: 0,
        institutionId: "sentinel-respiratory-laboratory-001",
        evidenceType: "panel-standard-mapping",
        artifactName: "panel-standard-mapping.pdf",
        artifactDigest: createHash("sha256")
          .update("panel-standard-mapping-api-evidence")
          .digest("hex"),
        validFrom: VALID_FROM,
        expiresAt: EXPIRES_AT,
        ...overrides
      })
    }
  );
}

test("respiratory network API signs only server-controlled evidence and exposes a redacted readiness view", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "public-health-respiratory-network-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  const envKeys = [
    "NODE_ENV",
    "DATA_DIR",
    "STORAGE_ENGINE",
    "SESSION_SECRETS",
    "SESSION_STORE",
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON",
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_SIGNER_ID"
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  Object.assign(process.env, {
    NODE_ENV: "test",
    DATA_DIR: dataDir,
    STORAGE_ENGINE: "sqlite",
    SESSION_SECRETS: "public-health-respiratory-network-api-session-secret-2026",
    SESSION_STORE: "memory",
    PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON: JSON.stringify(managedKeyring()),
    PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_SIGNER_ID: "managed-respiratory-evidence-service"
  });

  const {
    readDatabase,
    server,
    startServer,
    stopServer,
    writeDatabase
  } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await stopServer();
    Object.entries(previousEnv).forEach(([key, value]) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    });
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const healthToken = await login(baseUrl, "health");
  const hospitalToken = await login(baseUrl, "hospital");
  const anonymous = await request(baseUrl, "/api/public-health/respiratory-network-readiness");
  assert.equal(anonymous.response.status, 401);
  const forbiddenRead = await request(
    baseUrl,
    "/api/public-health/respiratory-network-readiness",
    hospitalToken
  );
  assert.equal(forbiddenRead.response.status, 403);
  const queryOverride = await request(
    baseUrl,
    "/api/public-health/respiratory-network-readiness?keyId=client-key",
    healthToken
  );
  assert.equal(queryOverride.response.status, 400);
  assert.equal(
    queryOverride.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN"
  );

  const forbiddenWrite = await issue(
    baseUrl,
    hospitalToken,
    "respiratory-network-api-forbidden",
    "respiratory-network-api-forbidden"
  );
  assert.equal(forbiddenWrite.response.status, 403);

  for (const [suffix, injection] of [
    ["trust", { trustedVerification: { signatureVerified: true } }],
    ["keyring", { keyring: managedKeyring() }],
    ["secret", { secret: "client-secret" }],
    ["receipt", { receiptId: "client-receipt", receiptSignature: "a".repeat(64) }],
    ["signer", { signedBy: "client-signer", verifiedBy: "client-verifier" }],
    ["panel", { panelId: "client-panel", panelVersion: 99 }],
    ["time", { verifiedAt: "2030-01-01T00:00:00.000Z" }]
  ]) {
    const forged = await issue(
      baseUrl,
      healthToken,
      `respiratory-network-api-forged-${suffix}`,
      `respiratory-network-api-forged-${suffix}`,
      injection
    );
    assert.equal(forged.response.status, 400, `${suffix}: ${JSON.stringify(forged.body)}`);
    assert.equal(
      forged.body.code,
      "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN"
    );
  }

  const evidenceId = "respiratory-network-api-evidence-001";
  const issued = await issue(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-api-evidence-001"
  );
  assert.equal(issued.response.status, 201, JSON.stringify(issued.body));
  assert.equal(issued.body.evidence.id, evidenceId);
  assert.equal(issued.body.evidence.status, "verified");
  assert.equal(issued.body.evidence.productionReady, false);
  assert.equal(issued.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(issued.body),
    /artifact(?:Name|Digest)|receipt(?:Id|Signature)|signedBy|verifiedBy|verificationSource|attestationOrigin|keyId|secret/i
  );

  const persisted = readDatabase();
  const record = persisted.publicHealthRespiratoryNetworkEvidence
    .find((item) => item.id === evidenceId);
  const audit = persisted.publicHealthRespiratoryNetworkEvidenceAudit
    .find((item) => item.evidenceId === evidenceId);
  assert.ok(record?.trustedVerification?.receiptSignature);
  assert.equal(record.trustedVerification.verificationSource, "server-evidence-store");
  assert.equal(record.trustedVerification.signedBy, "managed-respiratory-evidence-service");
  assert.ok(audit?.integrityDigest);
  assert.equal(audit.receiptId, record.trustedVerification.receiptId);
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(ACTIVE_SECRET));

  const replay = await issue(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-api-evidence-001"
  );
  assert.equal(replay.response.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.idempotent, true);
  assert.equal(
    readDatabase().publicHealthRespiratoryNetworkEvidence.filter((item) => item.id === evidenceId).length,
    1
  );

  const conflictingReplay = await issue(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-api-evidence-conflict"
  );
  assert.equal(conflictingReplay.response.status, 409);

  const summary = await request(
    baseUrl,
    "/api/public-health/respiratory-network-readiness",
    healthToken
  );
  assert.equal(summary.response.status, 200, JSON.stringify(summary.body));
  assert.equal(summary.body.summary.requiredEvidenceTypes, 6);
  assert.equal(summary.body.summary.trustedEvidence, 1);
  assert.equal(summary.body.summary.keyring.active, 1);
  assert.equal(summary.body.technicalLaunchReady, false);
  assert.equal(summary.body.productionReady, false);
  assert.deepEqual(summary.body.productionBoundary, {
    technicalLaunchReady: false,
    productionReady: false,
    centralSiteEvidenceRequired: true,
    p0P1ClosureRequired: true,
    productionHandoffRequired: true,
    formalLaunchApprovalRequired: true
  });
  assert.doesNotMatch(
    JSON.stringify(summary.body),
    /artifact(?:Name|Digest)|receipt(?:Id|Signature)|signedBy|verifiedBy|verificationSource|attestationOrigin|keyId|secret|reasons/i
  );

  const scopedState = await request(baseUrl, "/api/state", healthToken);
  assert.equal(scopedState.response.status, 200);
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      scopedState.body,
      "publicHealthRespiratoryNetworkEvidence"
    ),
    false
  );
  assert.equal(
    Object.prototype.hasOwnProperty.call(
      scopedState.body,
      "publicHealthRespiratoryNetworkEvidenceAudit"
    ),
    false
  );

  const duplicateReceiptState = readDatabase();
  duplicateReceiptState.publicHealthRespiratoryNetworkEvidence.push({
    ...record,
    id: "respiratory-network-api-evidence-duplicate-receipt"
  });
  assert.throws(
    () => writeDatabase(duplicateReceiptState),
    /receipt id unique conflict/
  );

  process.env.PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON = JSON.stringify({
    purpose: RESPIRATORY_NETWORK_EVIDENCE_PURPOSE,
    activeKeyId: "respiratory-network-api-key-b",
    keys: [
      {
        ...managedKeyring().keys[0],
        status: "revoked",
        revokedAt: new Date(Date.now() - 1_000).toISOString()
      },
      {
        ...managedKeyring().keys[0],
        keyId: "respiratory-network-api-key-b",
        secret: NEXT_SECRET,
        status: "active",
        notBefore: new Date(Date.now() - 1_000).toISOString()
      }
    ]
  });
  const revokedSummary = await request(
    baseUrl,
    "/api/public-health/respiratory-network-readiness",
    healthToken
  );
  assert.equal(revokedSummary.response.status, 200);
  assert.equal(revokedSummary.body.summary.rejectedEvidence, 1);
  assert.equal(revokedSummary.body.technicalLaunchReady, false);
  assert.equal(revokedSummary.body.productionReady, false);
  assert.equal(revokedSummary.body.summary.keyring.revoked, 1);
  assert.doesNotMatch(JSON.stringify(revokedSummary.body), /key-revoked|receipt signature/i);

  process.env.PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_JSON = JSON.stringify({
    ...managedKeyring(),
    purpose: "client-purpose"
  });
  const invalidKeyring = await issue(
    baseUrl,
    healthToken,
    "respiratory-network-api-invalid-keyring",
    "respiratory-network-api-invalid-keyring"
  );
  assert.equal(invalidKeyring.response.status, 503);
  assert.equal(
    invalidKeyring.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_KEYRING_INVALID"
  );
  assert.equal(invalidKeyring.body.productionReady, false);
});
