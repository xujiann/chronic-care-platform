"use strict";

const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const test = require("node:test");

const {
  SCENARIOS,
  buildExternalJointTestCampaign,
  createExternalJointTestReceiptSubject,
  evaluateExternalJointTestCampaign,
  loadExternalJointTestCampaign
} = require("../src/platform/integration/external-joint-test-campaign");
const {
  createTechnicalEvidenceFingerprint,
  sha256,
  stableStringify
} = require("../src/platform/governance/technical-evidence");
const {
  createRouteSegments
} = require("../src/http/routes/integration/external-joint-test");

const EXECUTED_AT = "2026-08-04T10:00:00.000Z";
const EVALUATED_AT = "2026-08-04T12:00:00.000Z";
const EXPIRES_AT = "2026-08-06T10:00:00.000Z";

function signingContext(campaign) {
  const platform = generateKeyPairSync("ed25519");
  const external = generateKeyPairSync("ed25519");
  const allowedInterfaceIds = campaign.interfaces.map((item) => item.id);
  return {
    platform,
    external,
    trustRegistry: {
      schemaVersion: "external-joint-test-trust-registry-v1",
      generatedAt: "2026-08-04T08:00:00.000Z",
      keys: [
        {
          keyId: "platform-joint-test-key-v1",
          account: "platform-joint-test-owner",
          party: "platform",
          algorithm: "Ed25519",
          status: "active",
          allowedInterfaceIds,
          validFrom: "2026-08-01T00:00:00.000Z",
          validUntil: "2026-09-01T00:00:00.000Z",
          publicKeyPem: platform.publicKey.export({ type: "spki", format: "pem" })
        },
        {
          keyId: "external-joint-test-key-v1",
          account: "external-joint-test-owner",
          party: "external",
          algorithm: "Ed25519",
          status: "active",
          allowedInterfaceIds,
          validFrom: "2026-08-01T00:00:00.000Z",
          validUntil: "2026-09-01T00:00:00.000Z",
          publicKeyPem: external.publicKey.export({ type: "spki", format: "pem" })
        }
      ]
    }
  };
}

function attestation(subject, party, keyId, account, privateKey, index) {
  const subjectDigest = sha256(subject);
  return {
    schemaVersion: "external-joint-test-attestation-v1",
    party,
    keyId,
    account,
    algorithm: "Ed25519",
    issuedAt: "2026-08-04T10:30:00.000Z",
    nonce: `${party}-nonce-${String(index).padStart(5, "0")}`,
    subjectDigest,
    signature: sign(
      null,
      Buffer.from(stableStringify(subject)),
      privateKey
    ).toString("base64url")
  };
}

function evidenceFixture() {
  const campaign = loadExternalJointTestCampaign();
  const context = signingContext(campaign);
  let sequence = 0;
  const receipts = campaign.interfaces.flatMap((item) =>
    SCENARIOS.map((scenario) => {
      sequence += 1;
      const receipt = {
        schemaVersion: "external-joint-test-scenario-receipt-v1",
        campaignId: campaign.campaignId,
        campaignDigest: campaign.campaignDigest,
        interfaceId: item.id,
        scenarioId: scenario.id,
        runId: `joint-test-run-${String(sequence).padStart(3, "0")}`,
        executedAt: EXECUTED_AT,
        expiresAt: EXPIRES_AT,
        result: "passed",
        traceRef: `evidence://external-joint-test/${item.id}/${scenario.id}/trace`,
        receiptRef: `artifact://external-joint-test/${item.id}/${scenario.id}/receipt`,
        requestDigest: sha256(`request-${item.id}-${scenario.id}`),
        responseDigest: sha256(`response-${item.id}-${scenario.id}`),
        assertions: {
          ...structuredClone(scenario.assertions),
          ...(scenario.id === "timeout-retry" ? { attemptCount: 2 } : {})
        }
      };
      const subject = createExternalJointTestReceiptSubject(receipt);
      receipt.attestations = [
        attestation(
          subject,
          "platform",
          "platform-joint-test-key-v1",
          "platform-joint-test-owner",
          context.platform.privateKey,
          sequence
        ),
        attestation(
          subject,
          "external",
          "external-joint-test-key-v1",
          "external-joint-test-owner",
          context.external.privateKey,
          sequence
        )
      ];
      return receipt;
    })
  );
  return {
    campaign,
    trustRegistry: context.trustRegistry,
    evidenceBundle: {
      schemaVersion: "external-joint-test-evidence-bundle-v1",
      campaignId: campaign.campaignId,
      campaignDigest: campaign.campaignDigest,
      receipts,
      revocations: []
    }
  };
}

test("campaign covers twelve external systems and eight mandatory scenarios without runtime endpoints", () => {
  const plan = buildExternalJointTestCampaign();
  assert.equal(plan.interfaces.length, 12);
  assert.equal(plan.requiredScenarioCount, 96);
  assert.equal(plan.interfaces.every((item) => item.scenarios.length === 8), true);
  assert.deepEqual(
    plan.interfaces.map((item) => item.system),
    ["HIS", "EMR", "LIS", "PACS", "OIDC", "SMS", "INSURANCE", "PAYMENT", "CERTIFICATE", "PUBLIC_HEALTH", "SIEM", "DUTY_TICKETING"]
  );
  assert.equal(plan.decision, "NO-GO");
  assert.equal(plan.productionReady, false);
  assert.equal(plan.credentialsExposed, false);
  assert.equal(plan.patientDataExposed, false);
  assert.doesNotMatch(JSON.stringify(plan), /https?:\/\//i);
});

test("complete fresh receipts require two independent Ed25519 attestations and project to the cutover schema", () => {
  const fixture = evidenceFixture();
  const result = evaluateExternalJointTestCampaign({
    campaign: fixture.campaign,
    evidenceBundle: fixture.evidenceBundle,
    trustRegistry: fixture.trustRegistry,
    now: EVALUATED_AT
  });
  assert.equal(result.summary.required, 96);
  assert.equal(result.summary.verified, 96);
  assert.equal(result.externalEvidenceVerified, true);
  assert.equal(result.decision, "JOINT-TEST-PASSED");
  assert.equal(result.productionReady, false);
  assert.equal(result.evidenceInferred, false);
  assert.equal(result.regionalJointTestEvidence.externalEvidenceVerified, true);
  const projection = result.regionalJointTestEvidence;
  const expectedFingerprint = createTechnicalEvidenceFingerprint(
    projection.schema,
    {
      schema: projection.schema,
      registryDigest: projection.registryDigest,
      contracts: projection.contracts,
      externalEvidenceVerified: projection.externalEvidenceVerified,
      evidenceInferred: projection.evidenceInferred
    }
  );
  assert.equal(projection.technicalEvidenceFingerprint, expectedFingerprint);
});

test("missing, duplicate or tampered scenario evidence remains NO-GO", () => {
  const fixture = evidenceFixture();
  fixture.evidenceBundle.receipts.pop();
  let result = evaluateExternalJointTestCampaign({
    campaign: fixture.campaign,
    evidenceBundle: fixture.evidenceBundle,
    trustRegistry: fixture.trustRegistry,
    now: EVALUATED_AT
  });
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.summary.missing, 1);
  assert.equal(result.externalEvidenceVerified, false);

  const duplicate = structuredClone(fixture.evidenceBundle.receipts[0]);
  fixture.evidenceBundle.receipts.push(duplicate);
  fixture.evidenceBundle.receipts[0].assertions.accepted = false;
  result = evaluateExternalJointTestCampaign({
    campaign: fixture.campaign,
    evidenceBundle: fixture.evidenceBundle,
    trustRegistry: fixture.trustRegistry,
    now: EVALUATED_AT
  });
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.summary.invalid >= 1, true);
  assert.equal(result.interfaces[0].scenarios[0].checks.uniqueReceipt, false);
  assert.equal(result.interfaces[0].scenarios[0].attestations.platform.checks.signature, false);
});

test("expired or revoked signed receipts fail closed", () => {
  const expiredFixture = evidenceFixture();
  expiredFixture.evidenceBundle.receipts[0].expiresAt = "2026-08-04T11:00:00.000Z";
  let result = evaluateExternalJointTestCampaign({
    campaign: expiredFixture.campaign,
    evidenceBundle: expiredFixture.evidenceBundle,
    trustRegistry: expiredFixture.trustRegistry,
    now: EVALUATED_AT
  });
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.summary.expired, 1);

  const revokedFixture = evidenceFixture();
  const subjectDigest = sha256(
    createExternalJointTestReceiptSubject(revokedFixture.evidenceBundle.receipts[0])
  );
  revokedFixture.evidenceBundle.revocations.push({
    subjectDigest,
    revokedAt: "2026-08-04T11:00:00.000Z",
    evidenceRef: "evidence://external-joint-test/revocations/001",
    evidenceDigest: sha256("revocation-001")
  });
  result = evaluateExternalJointTestCampaign({
    campaign: revokedFixture.campaign,
    evidenceBundle: revokedFixture.evidenceBundle,
    trustRegistry: revokedFixture.trustRegistry,
    now: EVALUATED_AT
  });
  assert.equal(result.decision, "NO-GO");
  assert.equal(result.summary.revoked, 1);
  assert.equal(result.interfaces[0].scenarios[0].checks.notRevoked, false);
});

test("sensitive fields and inactive trust keys are rejected instead of being treated as evidence", () => {
  const fixture = evidenceFixture();
  fixture.evidenceBundle.receipts[0].payload = { patient: "must-not-be-retained" };
  assert.throws(
    () => evaluateExternalJointTestCampaign({
      campaign: fixture.campaign,
      evidenceBundle: fixture.evidenceBundle,
      trustRegistry: fixture.trustRegistry,
      now: EVALUATED_AT
    }),
    (error) => error.code === "TECHNICAL_EVIDENCE_SENSITIVE_FIELD"
  );

  const keyFixture = evidenceFixture();
  keyFixture.trustRegistry.keys[1].status = "revoked";
  assert.throws(
    () => evaluateExternalJointTestCampaign({
      campaign: keyFixture.campaign,
      evidenceBundle: keyFixture.evidenceBundle,
      trustRegistry: keyFixture.trustRegistry,
      now: EVALUATED_AT
    }),
    (error) => error.code === "EXTERNAL_JOINT_TEST_TRUST_KEY_INVALID"
  );
});

test("T08 route exposes a role-gated plan and turns malformed evidence into a controlled rejection", async () => {
  const responses = [];
  const authorizations = [];
  const segments = createRouteSegments({
    async collectJson() {
      return { evidenceBundle: {}, trustRegistry: {} };
    },
    requireApiRole(_req, _res, roles, resource) {
      authorizations.push({ roles, resource });
      return { role: "commission" };
    },
    sendJson(_res, statusCode, body) {
      responses.push({ statusCode, body });
    }
  });
  assert.equal(segments.length, 1);
  assert.equal(
    await segments[0].handle(
      { method: "GET" },
      {},
      new URL("https://platform.invalid/api/integration/joint-test-campaign")
    ),
    true
  );
  assert.equal(responses[0].statusCode, 200);
  assert.equal(responses[0].body.requiredScenarioCount, 96);
  assert.deepEqual(authorizations[0].roles, ["commission", "institution"]);

  assert.equal(
    await segments[0].handle(
      { method: "POST" },
      {},
      new URL("https://platform.invalid/api/integration/joint-test-campaign/evaluate")
    ),
    true
  );
  assert.equal(responses[1].statusCode, 400);
  assert.equal(responses[1].body.code, "EXTERNAL_JOINT_TEST_TRUST_REGISTRY_INVALID");
  assert.deepEqual(authorizations[1].roles, ["commission"]);
});
