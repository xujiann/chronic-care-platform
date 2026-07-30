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

async function lifecycleRequest(baseUrl, token, evidenceId, idempotencyKey, action, expectedVersion, overrides = {}) {
  return request(
    baseUrl,
    `/api/public-health/respiratory-network-evidence/${encodeURIComponent(evidenceId)}/actions`,
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        action,
        expectedVersion,
        reasonCode: "scheduled-evidence-governance",
        ...overrides
      })
    }
  );
}

async function lifecycleReview(baseUrl, token, evidenceId, idempotencyKey, lifecycleRequestId, action, overrides = {}) {
  return request(
    baseUrl,
    `/api/public-health/respiratory-network-evidence/${encodeURIComponent(evidenceId)}/actions`,
    token,
    {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        action,
        expectedVersion: 1,
        lifecycleRequestId,
        ...(action === "reject-lifecycle" ? { reviewReasonCode: "insufficient-evidence" } : {}),
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
  const reviewerToken = await login(baseUrl, "whjw");
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
  for (const collection of [
    "publicHealthRespiratoryNetworkLifecycleRequests",
    "publicHealthRespiratoryNetworkLifecycleEvents",
    "publicHealthRespiratoryNetworkLifecycleAudit"
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(scopedState.body, collection), false);
  }

  assert.equal(summary.body.lifecycle.summary.active, 1);
  assert.equal(summary.body.lifecycle.summary.renewalDue, 1);
  assert.equal(summary.body.evidence[0].state, "active");
  assert.equal(summary.body.evidence[0].lifecycleVersion, 1);
  const forgedLifecycle = await lifecycleRequest(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-lifecycle-forged",
    "request-suspend",
    1,
    { attestationOrigin: "client-generated", signatureVerified: true }
  );
  assert.equal(forgedLifecycle.response.status, 400);
  assert.equal(
    forgedLifecycle.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN"
  );
  const staleLifecycleRequest = await lifecycleRequest(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-lifecycle-stale-request",
    "request-suspend",
    2
  );
  assert.equal(staleLifecycleRequest.response.status, 409);
  assert.equal(
    staleLifecycleRequest.body.code,
    "PUBLIC_HEALTH_MODERNIZATION_CAS_CONFLICT"
  );

  const longExpiresAt = new Date(Date.now() + 120 * 86400000).toISOString();
  const crossTrackId = "respiratory-network-api-evidence-cross-track";
  const crossTrack = await issue(
    baseUrl,
    healthToken,
    crossTrackId,
    "respiratory-network-api-evidence-cross-track",
    {
      evidenceType: "privacy-security-review",
      artifactName: "privacy-security-review.pdf",
      artifactDigest: createHash("sha256").update("privacy-security-review-api").digest("hex"),
      expiresAt: longExpiresAt
    }
  );
  assert.equal(crossTrack.response.status, 201, JSON.stringify(crossTrack.body));
  const crossTrackSuccessor = await lifecycleRequest(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-lifecycle-cross-track",
    "request-supersede",
    1,
    { successorEvidenceId: crossTrackId }
  );
  assert.equal(crossTrackSuccessor.response.status, 400);
  assert.equal(
    crossTrackSuccessor.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_LIFECYCLE_SUCCESSOR_INVALID"
  );

  const successorId = "respiratory-network-api-evidence-successor";
  const successor = await issue(
    baseUrl,
    healthToken,
    successorId,
    "respiratory-network-api-evidence-successor",
    {
      artifactName: "panel-standard-mapping-renewal.pdf",
      artifactDigest: createHash("sha256").update("panel-standard-mapping-renewal-api").digest("hex"),
      expiresAt: longExpiresAt
    }
  );
  assert.equal(successor.response.status, 201, JSON.stringify(successor.body));
  const requested = await lifecycleRequest(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-lifecycle-supersede-request",
    "request-supersede",
    1,
    { successorEvidenceId: successorId }
  );
  assert.equal(requested.response.status, 201, JSON.stringify(requested.body));
  assert.equal(requested.body.lifecycleRequest.status, "pending");
  assert.equal(requested.body.lifecycleRequest.requestedBySelf, true);
  assert.equal(requested.body.lifecycleRequest.canReview, false);
  const lifecycleRequestId = requested.body.lifecycleRequest.id;

  const staleApproval = await lifecycleReview(
    baseUrl,
    reviewerToken,
    evidenceId,
    "respiratory-network-lifecycle-stale-approval",
    lifecycleRequestId,
    "approve-lifecycle",
    { expectedVersion: 2 }
  );
  assert.equal(staleApproval.response.status, 409);
  const selfApproval = await lifecycleReview(
    baseUrl,
    healthToken,
    evidenceId,
    "respiratory-network-lifecycle-self-approval",
    lifecycleRequestId,
    "approve-lifecycle"
  );
  assert.equal(selfApproval.response.status, 400);
  assert.equal(
    selfApproval.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_REVIEWER_NOT_INDEPENDENT"
  );
  const forgedApproval = await lifecycleReview(
    baseUrl,
    reviewerToken,
    evidenceId,
    "respiratory-network-lifecycle-forged-approval",
    lifecycleRequestId,
    "approve-lifecycle",
    { keyId: "client-key", receiptId: "client-receipt", approvedAt: new Date().toISOString() }
  );
  assert.equal(forgedApproval.response.status, 400);
  assert.equal(
    forgedApproval.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN"
  );
  const approved = await lifecycleReview(
    baseUrl,
    reviewerToken,
    evidenceId,
    "respiratory-network-lifecycle-approve",
    lifecycleRequestId,
    "approve-lifecycle"
  );
  assert.equal(approved.response.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.lifecycleRequest.status, "approved");
  assert.equal(approved.body.evidence.state, "superseded");
  assert.equal(approved.body.productionReady, false);
  assert.doesNotMatch(
    JSON.stringify(approved.body),
    /receipt(?:Id|Signature)|attestationOrigin|verificationSource|signatureVerified|keyId|secret|"requestedBy":|"approvedBy":/i
  );
  const approvalReplay = await lifecycleReview(
    baseUrl,
    reviewerToken,
    evidenceId,
    "respiratory-network-lifecycle-approve",
    lifecycleRequestId,
    "approve-lifecycle"
  );
  assert.equal(approvalReplay.response.status, 200, JSON.stringify(approvalReplay.body));
  assert.equal(approvalReplay.body.idempotent, true);

  const afterSupersede = await request(
    baseUrl,
    "/api/public-health/respiratory-network-readiness",
    healthToken
  );
  assert.equal(afterSupersede.response.status, 200);
  assert.equal(afterSupersede.body.lifecycle.summary.active, 2);
  assert.equal(afterSupersede.body.lifecycle.summary.superseded, 1);
  assert.equal(afterSupersede.body.lifecycle.summary.renewalDue, 0);
  assert.equal(afterSupersede.body.lifecycle.requestSummary.approved, 1);
  assert.equal(
    afterSupersede.body.evidence.find((item) => item.id === successorId).state,
    "active"
  );

  const revokeRequest = await lifecycleRequest(
    baseUrl,
    healthToken,
    crossTrackId,
    "respiratory-network-lifecycle-revoke-request",
    "request-revoke",
    1
  );
  assert.equal(revokeRequest.response.status, 201, JSON.stringify(revokeRequest.body));
  const revokeApproval = await lifecycleReview(
    baseUrl,
    reviewerToken,
    crossTrackId,
    "respiratory-network-lifecycle-revoke-approve",
    revokeRequest.body.lifecycleRequest.id,
    "approve-lifecycle"
  );
  assert.equal(revokeApproval.response.status, 200, JSON.stringify(revokeApproval.body));
  assert.equal(revokeApproval.body.evidence.state, "revoked");
  const terminalReinstate = await lifecycleRequest(
    baseUrl,
    healthToken,
    crossTrackId,
    "respiratory-network-lifecycle-terminal-reinstate",
    "request-reinstate",
    2
  );
  assert.equal(terminalReinstate.response.status, 409);
  assert.equal(
    terminalReinstate.body.code,
    "PUBLIC_HEALTH_RESPIRATORY_NETWORK_LIFECYCLE_STATE_CONFLICT"
  );

  const rejectRequest = await lifecycleRequest(
    baseUrl,
    healthToken,
    successorId,
    "respiratory-network-lifecycle-reject-request",
    "request-suspend",
    1
  );
  assert.equal(rejectRequest.response.status, 201);
  const rejected = await lifecycleReview(
    baseUrl,
    reviewerToken,
    successorId,
    "respiratory-network-lifecycle-reject",
    rejectRequest.body.lifecycleRequest.id,
    "reject-lifecycle"
  );
  assert.equal(rejected.response.status, 200, JSON.stringify(rejected.body));
  assert.equal(rejected.body.lifecycleRequest.status, "rejected");
  assert.equal(rejected.body.evidence.state, "active");

  const lifecyclePersisted = readDatabase();
  assert.equal(lifecyclePersisted.publicHealthRespiratoryNetworkLifecycleRequests.length, 3);
  assert.equal(lifecyclePersisted.publicHealthRespiratoryNetworkLifecycleEvents.length, 2);
  assert.equal(lifecyclePersisted.publicHealthRespiratoryNetworkLifecycleAudit.length, 6);
  assert.doesNotMatch(JSON.stringify(lifecyclePersisted), new RegExp(ACTIVE_SECRET));
  const duplicateLifecycleState = structuredClone(lifecyclePersisted);
  duplicateLifecycleState.publicHealthRespiratoryNetworkLifecycleEvents.push({
    ...duplicateLifecycleState.publicHealthRespiratoryNetworkLifecycleEvents[0],
    id: "respiratory-network-lifecycle-duplicate-receipt"
  });
  assert.throws(
    () => writeDatabase(duplicateLifecycleState),
    /lifecycle event receipt id unique conflict|lifecycle replay conflict/
  );
  assert.equal(readDatabase().publicHealthRespiratoryNetworkLifecycleEvents.length, 2);

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
  assert.equal(revokedSummary.body.summary.rejectedEvidence, 3);
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
