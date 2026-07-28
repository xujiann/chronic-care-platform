#!/usr/bin/env node
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const data = require("../data/db.json");
const {
  applyPublicHealthCoordinationAction
} = require("../public-health-coordination-service");
const {
  applyPublicHealthCoordinationActionToState,
  buildPublicHealthCoordinationRuntime
} = require("../public-health-coordination-runtime");
const {
  EXTERNAL_ADAPTER_PROFILES,
  buildPublicHealthExternalAdapterRegistry,
  createPublicHealthExternalDispatch,
  recordPublicHealthExternalDeliveryAttempt,
  signPublicHealthExternalReceipt
} = require("../public-health-external-adapter-service");
const {
  claimPublicHealthExternalDispatchToState,
  enqueuePublicHealthExternalDispatchToState,
  listDuePublicHealthExternalDispatches,
  recordClaimedPublicHealthExternalAttemptToState,
  recordPublicHealthExternalAttemptToState,
  requeuePublicHealthExternalDeadLetterToState,
  verifyPublicHealthExternalAuditChain,
  verifyRuntimeStateSignature
} = require("../public-health-external-adapter-runtime");
const {
  buildPublicHealthExternalOperationsBoard
} = require("../public-health-external-operations-service");
const {
  buildPublicHealthExternalEndpointProbeRegistry,
  signPublicHealthExternalEndpointProbeReceipt
} = require("../public-health-external-endpoint-verification-service");
const {
  buildPublicHealthExternalEndpointProbeCampaignRegistry,
  createPublicHealthExternalEndpointProbeCampaign
} = require("../public-health-external-endpoint-probe-campaign-service");
const { summarizeKeyring } = require("../public-health-external-keyring-service");
const {
  recordPublicHealthExternalLaneOutcomeToState,
  reservePublicHealthExternalLaneCapacityToState,
  verifyPublicHealthExternalLaneControlAuditChain
} = require("../public-health-external-resilience-service");
const {
  authorizePublicHealthExternalContract,
  buildPublicHealthExternalContractGovernance,
  signPublicHealthExternalContractAttestation
} = require("../public-health-external-contract-governance-service");
const {
  buildPublicHealthExternalContractCutoverBoard
} = require("../public-health-external-contract-cutover-service");
const { buildPublicHealthSystem } = require("./public-health-readiness");
const {
  buildPublicHealthModernizationReadiness
} = require("./public-health-modernization-readiness");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "public-health-final-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "public-health-final-readiness-report.md");
const ACCEPTANCE_REQUEST_SECRET = "t08-acceptance-request-secret-1234567890";
const ACCEPTANCE_RECEIPT_SECRET = "t08-acceptance-receipt-secret-1234567890";
const ACCEPTANCE_ENDPOINT_PROBE_SECRET = "t08-acceptance-endpoint-probe-secret-1234567890";
const ACCEPTANCE_ENDPOINT_CAMPAIGN_SECRET = "t08-acceptance-endpoint-campaign-secret-123456";

function check(id, passed, detail, category) {
  return { id, passed: Boolean(passed), detail, category };
}

function buildConfiguredAcceptanceEnvironment() {
  return Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.flatMap((profile) => [
    [profile.endpointEnv, `https://${profile.laneId}.acceptance.invalid/dispatch`],
    [profile.requestSecretEnv, ACCEPTANCE_REQUEST_SECRET],
    [profile.receiptSecretEnv, ACCEPTANCE_RECEIPT_SECRET]
  ]));
}

function buildEndpointProbeAcceptanceKeyring() {
  return {
    purpose: "t08-acceptance-endpoint-probe",
    activeKeyId: "endpoint-probe-2026-07",
    keys: [{
      keyId: "endpoint-probe-2026-07",
      secret: ACCEPTANCE_ENDPOINT_PROBE_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function endpointProbeAcceptanceEndpoint(laneId) {
  return `https://${laneId}.public-health.dalian.gov.cn/dispatch`;
}

function runExternalEndpointProbeAcceptance() {
  const keyring = buildEndpointProbeAcceptanceKeyring();
  const env = Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => [
    profile.endpointEnv,
    endpointProbeAcceptanceEndpoint(profile.laneId)
  ]));
  const receipts = EXTERNAL_ADAPTER_PROFILES.map((profile, index) => signPublicHealthExternalEndpointProbeReceipt({
    receiptId: `ph-endpoint-probe-${profile.laneId}-acceptance`,
    laneId: profile.laneId,
    adapterId: profile.adapterId,
    contract: profile.contract,
    endpoint: endpointProbeAcceptanceEndpoint(profile.laneId),
    status: "healthy",
    httpStatus: 204,
    latencyMs: 100 + index,
    network: {
      resolvedAddress: `8.8.8.${index + 1}`,
      sniHostname: new URL(endpointProbeAcceptanceEndpoint(profile.laneId)).hostname
    },
    tls: {
      authorized: true,
      protocol: "TLSv1.3",
      certificateFingerprintSha256: crypto.createHash("sha256")
        .update(`t08-endpoint-certificate:${profile.laneId}`)
        .digest("hex"),
      mutualTlsVerified: true
    },
    verification: {
      attestationOrigin: "server-generated",
      verificationSource: "platform-observability",
      signatureVerified: true
    },
    issuedAt: `2026-07-25T08:00:${String(index).padStart(2, "0")}.000Z`,
    expiresAt: `2026-07-25T08:10:${String(index).padStart(2, "0")}.000Z`,
    nonce: `endpoint-probe-nonce-${profile.laneId}-acceptance`
  }, keyring));
  return buildPublicHealthExternalEndpointProbeRegistry({
    env,
    receipts,
    keyringResolver: () => keyring,
    at: "2026-07-25T08:05:00.000Z"
  });
}

function buildEndpointCampaignAcceptanceKeyring() {
  return {
    purpose: "public-health-endpoint-probe-campaign",
    activeKeyId: "endpoint-campaign-2026-07",
    keys: [{
      keyId: "endpoint-campaign-2026-07",
      secret: ACCEPTANCE_ENDPOINT_CAMPAIGN_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  };
}

function endpointCampaignAcceptancePolicy(laneId) {
  return {
    maxLatencyMs: 1200,
    timeoutMs: 2000,
    ttlSeconds: 600,
    method: "HEAD",
    requireMutualTls: true,
    certificatePins: [crypto.createHash("sha256")
      .update(`t08-endpoint-certificate:${laneId}`)
      .digest("hex")]
  };
}

function acceptanceTime(base, seconds) {
  return new Date(new Date(base).getTime() + seconds * 1000).toISOString();
}

function runExternalEndpointProbeCampaignAcceptance({ rejectLatest = false } = {}) {
  const receiptKeyring = buildEndpointProbeAcceptanceKeyring();
  const campaignSigningKeyring = buildEndpointCampaignAcceptanceKeyring();
  const env = Object.fromEntries(EXTERNAL_ADAPTER_PROFILES.map((profile) => [
    profile.endpointEnv,
    endpointProbeAcceptanceEndpoint(profile.laneId)
  ]));
  const starts = [
    "2026-07-25T08:00:00.000Z",
    "2026-07-25T08:10:00.000Z",
    "2026-07-25T08:20:00.000Z"
  ];
  let previousCampaign = null;
  const campaigns = starts.map((startedAt, campaignIndex) => {
    const receipts = EXTERNAL_ADAPTER_PROFILES.map((profile, index) => {
      const issuedAt = acceptanceTime(startedAt, index);
      return signPublicHealthExternalEndpointProbeReceipt({
        receiptId: `ph-endpoint-campaign-${campaignIndex + 1}-${profile.laneId}-receipt`,
        laneId: profile.laneId,
        adapterId: profile.adapterId,
        contract: profile.contract,
        endpoint: endpointProbeAcceptanceEndpoint(profile.laneId),
        status: "healthy",
        httpStatus: 204,
        latencyMs: 100 + index,
        network: {
          resolvedAddress: `8.8.4.${index + 1}`,
          sniHostname: new URL(endpointProbeAcceptanceEndpoint(profile.laneId)).hostname
        },
        tls: {
          authorized: true,
          protocol: "TLSv1.3",
          certificateFingerprintSha256: endpointCampaignAcceptancePolicy(profile.laneId).certificatePins[0],
          mutualTlsVerified: true
        },
        verification: {
          attestationOrigin: "server-generated",
          verificationSource: "platform-observability",
          signatureVerified: true
        },
        issuedAt,
        expiresAt: acceptanceTime(issuedAt, 600),
        nonce: `ph-endpoint-campaign-${campaignIndex + 1}-${profile.laneId}-nonce`
      }, receiptKeyring);
    });
    let sequence = 0;
    const campaign = createPublicHealthExternalEndpointProbeCampaign(receipts, {
      env,
      at: acceptanceTime(startedAt, 60),
      ttlSeconds: 3600,
      randomUUID: () => `acceptance-campaign-${campaignIndex + 1}-${++sequence}`,
      keyringResolver: () => receiptKeyring,
      campaignKeyring: campaignSigningKeyring,
      policyResolver: (laneId) => endpointCampaignAcceptancePolicy(laneId),
      ...(previousCampaign ? { previousCampaign } : {})
    });
    previousCampaign = campaign;
    return campaign;
  });
  if (rejectLatest) {
    campaigns[campaigns.length - 1].attestation.signature = "f".repeat(64);
  }
  return buildPublicHealthExternalEndpointProbeCampaignRegistry({
    campaigns,
    env,
    at: "2026-07-25T08:21:30.000Z",
    keyringResolver: () => receiptKeyring,
    campaignKeyring: campaignSigningKeyring,
    policyResolver: (laneId) => endpointCampaignAcceptancePolicy(laneId)
  });
}

function runExternalAdapterAcceptance(center) {
  return center.handoffs.map((initial, index) => {
    const owner = { name: `${initial.laneId}-acceptance-owner`, role: initial.ownerRole };
    let handoff = applyPublicHealthCoordinationAction(initial, {
      action: "assign-coordination",
      idempotencyKey: `${initial.id}:final:assign`,
      expectedVersion: 1,
      assignedTo: initial.owner,
      dueAt: "2026-07-31",
      note: "final readiness assignment"
    }, owner).handoff;
    handoff = applyPublicHealthCoordinationAction(handoff, {
      action: "start-coordination",
      idempotencyKey: `${initial.id}:final:start`,
      expectedVersion: 2,
      note: "final readiness dispatch"
    }, owner).handoff;
    const dispatch = createPublicHealthExternalDispatch(handoff, {
      idempotencyKey: `${initial.id}:final:dispatch`,
      operation: "coordination-handoff",
      evidenceRefs: [initial.requiredEvidence[0]]
    }, {
      endpoint: `https://${initial.laneId}.acceptance.invalid/dispatch`,
      requestSecret: ACCEPTANCE_REQUEST_SECRET,
      receiptSecret: ACCEPTANCE_RECEIPT_SECRET
    });
    const receipt = signPublicHealthExternalReceipt({
      dispatchId: dispatch.id,
      requestDigest: dispatch.requestDigest,
      laneId: dispatch.laneId,
      handoffId: dispatch.handoffId,
      status: "accepted",
      receiptCode: `T08-ACCEPT-${String(index + 1).padStart(2, "0")}`,
      evidenceRefs: [`${dispatch.laneId}-signed-receipt`],
      receivedAt: `2026-07-22T08:${String(index).padStart(2, "0")}:00.000Z`
    }, ACCEPTANCE_RECEIPT_SECRET);
    return recordPublicHealthExternalDeliveryAttempt(dispatch, { transportStatus: 200, receipt }, {
      receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
      at: `2026-07-22T08:${String(index).padStart(2, "0")}:30.000Z`
    });
  });
}

function runRuntimeAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "public-health-followup");
  const payload = {
    action: "assign-coordination",
    idempotencyKey: "final:runtime:followup:assign",
    expectedVersion: 1,
    assignedTo: "基层公卫专班",
    dueAt: "2026-07-31",
    note: "final readiness persistence check"
  };
  const first = applyPublicHealthCoordinationActionToState(
    sourceData,
    initial.id,
    payload,
    { name: "基层公卫管理员", role: "primary-care" },
    dependencies
  );
  const replay = applyPublicHealthCoordinationActionToState(
    first.nextData,
    initial.id,
    payload,
    { name: "基层公卫管理员", role: "primary-care" },
    dependencies
  );
  return { first, replay };
}

function runExternalOutboxAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "family-doctor");
  const owner = { name: "family-doctor-outbox-owner", role: initial.ownerRole };
  const assigned = applyPublicHealthCoordinationActionToState(sourceData, initial.id, {
    action: "assign-coordination",
    idempotencyKey: "final:outbox:family-doctor:assign",
    expectedVersion: 1,
    assignedTo: initial.owner,
    dueAt: "2026-07-31",
    note: "final outbox readiness assignment"
  }, owner, dependencies);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, initial.id, {
    action: "start-coordination",
    idempotencyKey: "final:outbox:family-doctor:start",
    expectedVersion: 2,
    note: "final outbox readiness dispatch"
  }, owner, dependencies);
  const credentials = {
    endpoint: "https://family-doctor.acceptance.invalid/dispatch",
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET
  };
  const enqueued = enqueuePublicHealthExternalDispatchToState(started.nextData, initial.id, {
    idempotencyKey: "final:outbox:family-doctor:enqueue",
    operation: "coordination-handoff",
    evidenceRefs: ["family-doctor-request-evidence"],
    exceptionOwner: "family-doctor-interface-team",
    exceptionDueAt: "2026-07-31",
    at: "2026-07-23T08:00:00.000Z"
  }, credentials, dependencies);
  const dueBeforeClaim = listDuePublicHealthExternalDispatches(enqueued.nextData, {
    now: "2026-07-23T08:00:30.000Z"
  });
  const claimed = claimPublicHealthExternalDispatchToState(enqueued.nextData, enqueued.dispatch.id, {
    workerId: "final-readiness-family-doctor-worker",
    idempotencyKey: "final:outbox:family-doctor:claim",
    expectedVersion: 1,
    now: "2026-07-23T08:00:30.000Z",
    leaseSeconds: 60
  }, credentials);
  const receipt = signPublicHealthExternalReceipt({
    dispatchId: enqueued.dispatch.id,
    requestDigest: enqueued.dispatch.requestDigest,
    laneId: enqueued.dispatch.laneId,
    handoffId: enqueued.dispatch.handoffId,
    status: "accepted",
    receiptCode: "T08-OUTBOX-ACCEPT-01",
    evidenceRefs: ["family-doctor-signed-receipt"],
    receivedAt: "2026-07-23T08:01:00.000Z"
  }, ACCEPTANCE_RECEIPT_SECRET);
  const delivered = recordClaimedPublicHealthExternalAttemptToState(claimed.nextData, enqueued.dispatch.id, {
    transportStatus: 200,
    receipt
  }, {
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
    attemptIdempotencyKey: "final:outbox:family-doctor:attempt",
    expectedVersion: 2,
    at: "2026-07-23T08:01:00.000Z",
    workerId: "final-readiness-family-doctor-worker",
    leaseToken: claimed.leaseToken
  }, dependencies);
  const handoff = buildPublicHealthCoordinationRuntime({ data: delivered.nextData, ...dependencies })
    .handoffs.find((item) => item.id === initial.id);
  return { enqueued, dueBeforeClaim, claimed, delivered, handoff };
}

function runDeadLetterRecoveryAcceptance(sourceData, system) {
  const dependencies = {
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  };
  const initial = system.coordinationCenter.handoffs.find((item) => item.laneId === "immunization");
  const owner = { name: "immunization-recovery-owner", role: initial.ownerRole };
  const assigned = applyPublicHealthCoordinationActionToState(sourceData, initial.id, {
    action: "assign-coordination",
    idempotencyKey: "final:recovery:immunization:assign",
    expectedVersion: 1,
    assignedTo: initial.owner,
    dueAt: "2026-07-31",
    note: "final recovery readiness assignment"
  }, owner, dependencies);
  const started = applyPublicHealthCoordinationActionToState(assigned.nextData, initial.id, {
    action: "start-coordination",
    idempotencyKey: "final:recovery:immunization:start",
    expectedVersion: 2,
    note: "final recovery readiness dispatch"
  }, owner, dependencies);
  const credentials = {
    endpoint: "https://immunization.acceptance.invalid/dispatch",
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET
  };
  const enqueued = enqueuePublicHealthExternalDispatchToState(started.nextData, initial.id, {
    idempotencyKey: "final:recovery:immunization:enqueue",
    operation: "coordination-handoff",
    evidenceRefs: ["immunization-request-evidence"],
    exceptionOwner: "immunization-original-team",
    exceptionDueAt: "2026-07-30",
    at: "2026-07-23T09:00:00.000Z"
  }, credentials, dependencies);
  const rejection = signPublicHealthExternalReceipt({
    dispatchId: enqueued.dispatch.id,
    requestDigest: enqueued.dispatch.requestDigest,
    laneId: enqueued.dispatch.laneId,
    handoffId: enqueued.dispatch.handoffId,
    status: "rejected",
    receiptCode: "T08-RECOVERY-REJECT-01",
    evidenceRefs: ["immunization-rejection-receipt"],
    receivedAt: "2026-07-23T09:01:00.000Z",
    reason: "acceptance field version mismatch",
    exceptionOwner: "immunization-original-team",
    dueAt: "2026-07-30"
  }, ACCEPTANCE_RECEIPT_SECRET);
  const rejected = recordPublicHealthExternalAttemptToState(enqueued.nextData, enqueued.dispatch.id, {
    transportStatus: 200,
    receipt: rejection
  }, {
    requestSecret: ACCEPTANCE_REQUEST_SECRET,
    receiptSecret: ACCEPTANCE_RECEIPT_SECRET,
    attemptIdempotencyKey: "final:recovery:immunization:rejection",
    expectedVersion: 1,
    at: "2026-07-23T09:01:30.000Z"
  }, dependencies);
  const recovered = requeuePublicHealthExternalDeadLetterToState(
    rejected.nextData,
    rejected.dispatch.id,
    {
      idempotencyKey: "final:recovery:immunization:requeue",
      expectedVersion: 2,
      coordinationExpectedVersion: 4,
      note: "field mapping remediated and reviewed",
      remediationEvidenceRefs: ["immunization-field-map-v2", "immunization-remediation-signoff"],
      exceptionOwner: "immunization-recovery-team",
      exceptionDueAt: "2026-08-02",
      at: "2026-07-23T09:30:00.000Z"
    },
    credentials,
    owner,
    dependencies
  );
  const handoff = buildPublicHealthCoordinationRuntime({ data: recovered.nextData, ...dependencies })
    .handoffs.find((item) => item.id === initial.id);
  return { enqueued, rejected, recovered, handoff };
}

function runExternalResilienceAcceptance() {
  const policy = {
    failureThreshold: 1,
    openSeconds: 30,
    halfOpenMaxProbes: 1,
    rateLimitPerMinute: 10,
    maxPending: 10
  };
  const reserved = reservePublicHealthExternalLaneCapacityToState(
    {},
    "family-doctor",
    { at: "2026-07-23T10:00:00.000Z", expectedVersion: 0 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const failed = recordPublicHealthExternalLaneOutcomeToState(
    reserved.nextData,
    "family-doctor",
    { type: "failure", reason: "network-error" },
    { at: "2026-07-23T10:00:10.000Z", expectedVersion: 1 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const probe = reservePublicHealthExternalLaneCapacityToState(
    failed.nextData,
    "family-doctor",
    { at: "2026-07-23T10:00:40.000Z", expectedVersion: 2 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  const recovered = recordPublicHealthExternalLaneOutcomeToState(
    probe.nextData,
    "family-doctor",
    { type: "success", reason: "verified-signed-receipt" },
    { at: "2026-07-23T10:00:45.000Z", expectedVersion: 3 },
    ACCEPTANCE_REQUEST_SECRET,
    policy
  );
  return { policy, reserved, failed, probe, recovered };
}

function runExternalContractGovernanceAcceptance() {
  const digest = (value) => crypto.createHash("sha256").update(value).digest("hex");
  const attestation = signPublicHealthExternalContractAttestation({
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v1",
    toContract: "family-doctor-fulfillment-v2",
    requestSchemaVersion: "public-health-external-dispatch/v2",
    receiptSchemaVersion: "public-health-external-receipt/v2",
    changeType: "additive",
    fieldDictionaryDigest: digest("final-family-doctor-fields-v2"),
    sampleRequestDigest: digest("final-family-doctor-request-v2"),
    sampleReceiptDigest: digest("final-family-doctor-receipt-v2"),
    runtimeReleaseDigest: digest("final-family-doctor-runtime-v2"),
    producerApproval: {
      organizationId: "family-doctor-platform",
      role: "producer-contract-owner",
      approverIdHash: digest("final-family-doctor-producer"),
      approvedAt: "2026-07-22T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "district-health-platform",
      role: "consumer-contract-owner",
      approverIdHash: digest("final-family-doctor-consumer"),
      approvedAt: "2026-07-22T09:00:00.000Z"
    },
    evidenceRefs: ["field-dictionary-v2", "producer-approval", "consumer-approval"],
    effectiveAt: "2026-07-25T00:00:00.000Z",
    sunsetAt: "2026-08-15T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-07-23T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "final-family-doctor-contract-v2"
  }, ACCEPTANCE_REQUEST_SECRET);
  const scheduled = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: ACCEPTANCE_REQUEST_SECRET,
    at: "2026-07-24T00:00:00.000Z"
  });
  const active = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: ACCEPTANCE_REQUEST_SECRET,
    at: "2026-07-25T00:00:00.000Z"
  });
  const retired = buildPublicHealthExternalContractGovernance({
    attestations: [attestation],
    signingMaterial: ACCEPTANCE_REQUEST_SECRET,
    at: "2026-08-15T00:00:00.000Z"
  });
  const nextAttestation = signPublicHealthExternalContractAttestation({
    laneId: "family-doctor",
    fromContract: "family-doctor-fulfillment-v2",
    toContract: "family-doctor-fulfillment-v3",
    requestSchemaVersion: "public-health-external-dispatch/v3",
    receiptSchemaVersion: "public-health-external-receipt/v3",
    changeType: "additive",
    fieldDictionaryDigest: digest("final-family-doctor-fields-v3"),
    sampleRequestDigest: digest("final-family-doctor-request-v3"),
    sampleReceiptDigest: digest("final-family-doctor-receipt-v3"),
    runtimeReleaseDigest: digest("final-family-doctor-runtime-v3"),
    producerApproval: {
      organizationId: "family-doctor-platform",
      role: "producer-contract-owner",
      approverIdHash: digest("final-family-doctor-producer-v3"),
      approvedAt: "2026-08-16T08:00:00.000Z"
    },
    consumerApproval: {
      organizationId: "district-health-platform",
      role: "consumer-contract-owner",
      approverIdHash: digest("final-family-doctor-consumer-v3"),
      approvedAt: "2026-08-16T09:00:00.000Z"
    },
    evidenceRefs: ["field-dictionary-v3", "producer-approval-v3", "consumer-approval-v3"],
    effectiveAt: "2026-08-20T00:00:00.000Z",
    sunsetAt: "2026-08-30T00:00:00.000Z",
    status: "approved",
    issuedAt: "2026-08-17T08:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    nonce: "final-family-doctor-contract-v3"
  }, ACCEPTANCE_REQUEST_SECRET);
  const thirdActive = buildPublicHealthExternalContractGovernance({
    attestations: [attestation, nextAttestation],
    signingMaterial: ACCEPTANCE_REQUEST_SECRET,
    at: "2026-08-20T00:00:00.000Z"
  });
  return { attestation, nextAttestation, scheduled, active, retired, thirdActive };
}

function buildPublicHealthFinalReadiness(options = {}) {
  const sourceData = options.data || data;
  const system = options.system || buildPublicHealthSystem({ ...options, data: sourceData });
  const runtime = buildPublicHealthCoordinationRuntime({
    data: sourceData,
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  });
  const runtimeAcceptance = runRuntimeAcceptance(sourceData, system);
  const registry = buildPublicHealthExternalAdapterRegistry(buildConfiguredAcceptanceEnvironment());
  const endpointProbeAcceptance = runExternalEndpointProbeAcceptance();
  const endpointProbeCampaignAcceptance = runExternalEndpointProbeCampaignAcceptance();
  const endpointProbeCampaignFailureAcceptance = runExternalEndpointProbeCampaignAcceptance({
    rejectLatest: true
  });
  const modernizationReadiness = buildPublicHealthModernizationReadiness();
  const deliveries = runExternalAdapterAcceptance(system.coordinationCenter);
  const outboxAcceptance = runExternalOutboxAcceptance(sourceData, system);
  const recoveryAcceptance = runDeadLetterRecoveryAcceptance(sourceData, system);
  const resilienceAcceptance = runExternalResilienceAcceptance();
  const contractAcceptance = runExternalContractGovernanceAcceptance();
  const contractCutoverDraining = buildPublicHealthExternalContractCutoverBoard({
    data: outboxAcceptance.enqueued.nextData,
    contractGovernance: contractAcceptance.active,
    now: "2026-07-25T00:00:00.000Z"
  });
  const contractCutoverCompleted = buildPublicHealthExternalContractCutoverBoard({
    data: outboxAcceptance.delivered.nextData,
    contractGovernance: contractAcceptance.retired,
    now: "2026-08-15T00:00:00.000Z"
  });
  const recoveryCoordination = buildPublicHealthCoordinationRuntime({
    data: recoveryAcceptance.recovered.nextData,
    eventReporting: system.infectiousEventReporting,
    standardReview: system.priorityStandardReview,
    center: system.coordinationCenter
  });
  const operationsBoard = buildPublicHealthExternalOperationsBoard({
    data: recoveryAcceptance.recovered.nextData,
    coordinationCenter: recoveryCoordination,
    secretResolver: () => ACCEPTANCE_REQUEST_SECRET,
    now: "2026-07-23T09:31:00.000Z"
  });
  const tamperedAuditData = JSON.parse(JSON.stringify(recoveryAcceptance.recovered.nextData));
  tamperedAuditData.publicHealthExternalDispatchAudit[0].action = "forged-final-readiness-audit";
  const tamperedOperationsBoard = buildPublicHealthExternalOperationsBoard({
    data: tamperedAuditData,
    coordinationCenter: recoveryCoordination,
    secretResolver: () => ACCEPTANCE_REQUEST_SECRET,
    now: "2026-07-23T09:31:00.000Z"
  });
  const runtimeSource = options.runtimeSource ?? fs.readFileSync(path.join(ROOT, "public-health-coordination-runtime.js"), "utf8");
  const adapterSource = options.adapterSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-adapter-service.js"), "utf8");
  const adapterRuntimeSource = options.adapterRuntimeSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-adapter-runtime.js"), "utf8");
  const operationsSource = options.operationsSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-operations-service.js"), "utf8");
  const keyringSource = options.keyringSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-keyring-service.js"), "utf8");
  const resilienceSource = options.resilienceSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-resilience-service.js"), "utf8");
  const contractSource = options.contractSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-contract-governance-service.js"), "utf8");
  const contractCutoverSource = options.contractCutoverSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-contract-cutover-service.js"), "utf8");
  const endpointProbeSource = options.endpointProbeSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-verification-service.js"), "utf8");
  const activeProbeSource = options.activeProbeSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-probe-runner.js"), "utf8");
  const endpointCampaignSource = options.endpointCampaignSource ?? fs.readFileSync(path.join(ROOT, "public-health-external-endpoint-probe-campaign-service.js"), "utf8");
  const pageSource = options.pageSource ?? fs.readFileSync(path.join(ROOT, "public-health.js"), "utf8");
  const doc = options.doc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-eight-domain-coordination.md"), "utf8");
  const keyringDoc = options.keyringDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-key-rotation.md"), "utf8");
  const resilienceDoc = options.resilienceDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-resilience.md"), "utf8");
  const contractDoc = options.contractDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-contract-governance.md"), "utf8");
  const endpointProbeDoc = options.endpointProbeDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-endpoint-verification.md"), "utf8");
  const activeProbeDoc = options.activeProbeDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-active-probing.md"), "utf8");
  const endpointCampaignDoc = options.endpointCampaignDoc ?? fs.readFileSync(path.join(ROOT, "docs", "public-health-external-endpoint-probe-campaigns.md"), "utf8");
  const serializedDeliveries = JSON.stringify(deliveries);
  const managedKeyringSummary = summarizeKeyring({
    purpose: "t08-readiness-request",
    activeKeyId: "request-2026-07",
    keys: [{
      keyId: "request-2026-07",
      secret: ACCEPTANCE_REQUEST_SECRET,
      status: "active",
      notBefore: "2026-07-01T00:00:00.000Z",
      expiresAt: "2026-08-01T00:00:00.000Z",
      revokedAt: ""
    }]
  }, "2026-07-23T09:31:00.000Z");
  const checks = [
    check("scope:eight-domain-center", system.coordinationCenter?.summary?.lanes === 8 && system.coordinationCenter?.ok, "8/8 coordination lanes are structurally runnable", "scope"),
    check("modernization:data-foundation", modernizationReadiness.ok === true && modernizationReadiness.summary.sources === 8 && modernizationReadiness.summary.catalogEntries === 7, "8 registered sources and 7 catalog entities form the minimized data foundation", "modernization"),
    check("modernization:multi-source-surveillance", modernizationReadiness.summary.rules === 8 && modernizationReadiness.summary.closedAlerts === 1, "8 versioned rules and one human-verified alert closure prove the surveillance workflow", "modernization"),
    check("modernization:medical-prevention-collaboration", modernizationReadiness.summary.collaborationTasks === 2 && modernizationReadiness.summary.closedCollaborationTasks === 2 && modernizationReadiness.productionReady === false, "medical public-health and primary-care tasks close without asserting production readiness", "modernization"),
    check("runtime:eight-handoffs", runtime.handoffs.length === 8 && runtime.functionalState === "eight-lane-coordination-persistence-ready", `${runtime.handoffs.length}/8 runtime handoffs`, "runtime"),
    check("runtime:persisted-write-model", runtimeAcceptance.first.nextData.publicHealthCoordinationHandoffs.length === 8, "immutable state patch contains all handoffs", "runtime"),
    check("runtime:minimized-audit", runtimeAcceptance.first.nextData.publicHealthCoordinationAudit.length === 1 && !Object.hasOwn(runtimeAcceptance.first.nextData.publicHealthCoordinationAudit[0], "residentId"), "audit is append-only and excludes residentId", "runtime"),
    check("runtime:idempotent-replay", runtimeAcceptance.replay.idempotent && runtimeAcceptance.replay.nextData.publicHealthCoordinationAudit.length === 1, "replay does not advance version or duplicate audit", "runtime"),
    check("runtime:optimistic-version", runtimeSource.includes("expectedVersion") || fs.readFileSync(path.join(ROOT, "public-health-coordination-service.js"), "utf8").includes("version conflict"), "optimistic version contract remains enforced", "runtime"),
    check("adapter:eight-profiles", registry.summary.adapters === 8 && registry.summary.configured === 8, `${registry.summary.configured}/8 acceptance adapter profiles configured`, "adapter"),
    check("adapter:eight-signed-deliveries", deliveries.length === 8 && deliveries.every((item) => item.deliveryState === "delivered"), `${deliveries.filter((item) => item.deliveryState === "delivered").length}/8 signed receipts verified`, "adapter"),
    check("adapter:privacy-minimized", !serializedDeliveries.includes("residentId") && !serializedDeliveries.includes(ACCEPTANCE_REQUEST_SECRET) && !serializedDeliveries.includes(ACCEPTANCE_RECEIPT_SECRET), "dispatch artifacts exclude resident identifiers and secrets", "adapter"),
    check("adapter:retry-dead-letter", ["retry-scheduled", "dead-letter", "timingSafeEqual"].every((token) => adapterSource.includes(token)), "transient retry, terminal dead letter and timing-safe verification are implemented", "adapter"),
    check("adapter:managed-keyring", managedKeyringSummary.productionReady === true && !JSON.stringify(managedKeyringSummary).includes(ACCEPTANCE_REQUEST_SECRET) && ["activeKeyId", "grace", "revoked", "key-expired-or-not-yet-valid"].every((token) => keyringSource.includes(token)), "managed active/grace/revoked key lifecycle is valid and secret-free", "adapter"),
    check("adapter:callback-anti-replay", ["receipt-issued-in-future", "receipt-expired", "receiptReplayKeyHash", "receipt replay detected"].every((token) => `${adapterSource}\n${adapterRuntimeSource}`.includes(token)), "signed callbacks bind key, issue/expiry time and nonce; stale, future and replayed callbacks fail closed", "adapter"),
    check("endpoint-probe:eight-server-signed-receipts", endpointProbeAcceptance.endpointConnectivityReady === true && endpointProbeAcceptance.summary.endpointProbesVerified === 8, `${endpointProbeAcceptance.summary.endpointProbesVerified}/8 fresh endpoint probes verified`, "endpoint-probe"),
    check("endpoint-probe:trust-and-target-binding", ["endpointDigest", "resolvedAddress", "sniHostname", "attestationOrigin", "verificationSource", "signatureVerified", "endpoint probe signature is invalid", "nonce replay detected"].every((token) => endpointProbeSource.includes(token)), "server signature binds target, resolved address, SNI, lane, contract, TLS and trust metadata with replay protection", "endpoint-probe"),
    check("endpoint-probe:production-target-policy", ["must use HTTPS", "loopback, private or reserved", "public IP address", "TLSv1.2", "TLSv1.3", "certificateFingerprintSha256"].every((token) => endpointProbeSource.includes(token)), "non-HTTPS, private, reserved, DNS-rebound and unauthorized TLS targets fail closed", "endpoint-probe"),
    check("active-probe:server-config-only", ["ALLOWED_COMMAND_KEYS", "endpoint probe command may contain only laneId", "contractResolver", "keyringResolver", "policyResolver"].every((token) => activeProbeSource.includes(token)), "active probes accept only a lane command and resolve endpoint, contract, keyring and policy on the server", "active-probe"),
    check("active-probe:dns-pinning", ["DNS resolution included a loopback, private or reserved address", "lookup:", "resolvedAddress", "HTTPS peer address does not match the pinned DNS result"].every((token) => activeProbeSource.includes(token)), "all DNS answers must be public and the HTTPS peer must match the server-pinned result", "active-probe"),
    check("active-probe:tls-policy", ["certificatePins", "requireMutualTls", "TLSv1.2", "TLSv1.3", "ENDPOINT_PROBE_CERTIFICATE_PIN_MISMATCH", "ENDPOINT_PROBE_MTLS_REQUIRED"].every((token) => activeProbeSource.includes(token)), "HTTP, latency, TLS authorization, protocol, certificate pin and mTLS policy fail closed before signing", "active-probe"),
    check("active-probe:signed-self-verification", ["TRUSTED_ATTESTATION_ORIGIN", "TRUSTED_VERIFICATION_SOURCE", "signPublicHealthExternalEndpointProbeReceipt", "verifyPublicHealthExternalEndpointProbeReceipt", "productionReady: false"].every((token) => activeProbeSource.includes(token)), "the runner fixes trust metadata, signs, self-verifies and never asserts production readiness", "active-probe"),
    check("probe-campaign:three-consecutive-campaigns", endpointProbeCampaignAcceptance.continuousConnectivityReady === true && endpointProbeCampaignAcceptance.summary.campaignsVerified === 3 && endpointProbeCampaignAcceptance.summary.consecutiveCampaigns === 3, `${endpointProbeCampaignAcceptance.summary.consecutiveCampaigns}/3 fresh eight-lane campaigns verified`, "probe-campaign"),
    check("probe-campaign:signed-continuity-chain", endpointProbeCampaignAcceptance.summary.campaignChainLinksVerified === 2 && ["previousCampaignDigest", "endpointProbeCampaignAttestationDigest", "campaign-chain-link-missing", "campaign-chain-link-mismatch"].every((token) => endpointCampaignSource.includes(token)), `${endpointProbeCampaignAcceptance.summary.campaignChainLinksVerified}/2 signed predecessor links verified`, "probe-campaign"),
    check("probe-campaign:signed-receipt-policy-binding", ["receiptDigest", "policyDigest", "campaignSignaturePayload", "endpoint probe campaign signature is invalid", "campaign receipt binding", "campaign policy snapshot"].every((token) => endpointCampaignSource.includes(token)), "campaign signatures bind all eight receipts, contracts, endpoints, policy snapshots, trust metadata and time windows", "probe-campaign"),
    check("probe-campaign:continuity-and-replay", ["requiredConsecutiveCampaigns", "maxCampaignGapSeconds", "seenCampaignIds", "seenCampaignNonces", "seenReceiptIds", "seenNonces", "gap < 0"].every((token) => endpointCampaignSource.includes(token)), "campaign, receipt and nonce replay plus overlap, reverse time and excessive gaps fail closed", "probe-campaign"),
    check("probe-campaign:rejected-window-fails-closed", endpointProbeCampaignFailureAcceptance.continuousConnectivityReady === false && endpointProbeCampaignFailureAcceptance.summary.campaignsVerified === 2 && endpointProbeCampaignFailureAcceptance.summary.consecutiveCampaigns === 0 && endpointProbeCampaignFailureAcceptance.continuityBreak?.code === "campaign-verification-failed", "a rejected latest campaign cannot be skipped to join older successful campaigns", "probe-campaign"),
    check("resilience:signed-circuit-recovery", resilienceAcceptance.failed.control.circuitState === "open" && resilienceAcceptance.probe.control.circuitState === "half-open" && resilienceAcceptance.recovered.control.circuitState === "closed" && verifyPublicHealthExternalLaneControlAuditChain(resilienceAcceptance.recovered.nextData, "family-doctor", ACCEPTANCE_REQUEST_SECRET).entries === 4, "signed failure, open gate, half-open probe and recovery form a four-entry lane-control audit chain", "resilience"),
    check("resilience:runtime-enforcement", ["assertPublicHealthExternalBackpressure", "reservePublicHealthExternalLaneCapacityToState", "recordPublicHealthExternalLaneOutcomeToState", "expectedLaneControlVersion"].every((token) => adapterRuntimeSource.includes(token)) && ["rateLimitPerMinute", "maxPending", "halfOpenMaxProbes", "lane-control-signature-invalid"].every((token) => resilienceSource.includes(token)), "enqueue backpressure, claim rate/circuit admission and claimed-attempt outcomes use signed CAS controls", "resilience"),
    check("contract:signed-version-lifecycle", contractAcceptance.scheduled.summary.scheduled === 1 && contractAcceptance.active.summary.deprecated === 1 && contractAcceptance.retired.summary.retired === 1 && authorizePublicHealthExternalContract(contractAcceptance.retired, "family-doctor", "family-doctor-fulfillment-v1", "public-health-external-dispatch/v1", "public-health-external-receipt/v1").reason === "contract-version-retired", "signed dual approval advances scheduled, active/deprecated and retired contract states", "contract"),
    check("contract:trust-and-drift-boundary", ["producer-contract-owner", "consumer-contract-owner", "runtimeReleaseDigest", "contract-transition-conflict", "contract-attestation-signature-invalid"].every((token) => contractSource.includes(token)) && ["assertDispatchContractGovernance", "contractGovernance"].every((token) => adapterRuntimeSource.includes(token)) && ["contract-governance-mismatch", "contract-version-deprecated"].every((token) => operationsSource.includes(token)), "dual approvals, release/sample digests, conflicts, runtime admission, tampering and operations drift fail closed", "contract"),
    check("contract:versioned-cutover-runtime", contractCutoverDraining.summary.outstanding === 1 && contractCutoverDraining.issues.some((item) => item.code === "contract-cutover-backlog") && contractCutoverCompleted.ok === true && contractCutoverCompleted.summary.completed === 1 && ["resolveExternalContractBinding", "receiptSchemaForRequest"].every((token) => adapterSource.includes(token)) && ["contract-cutover-backlog-after-sunset", "contract-cutover-successor-stale"].every((token) => contractCutoverSource.includes(token)), "active contracts drive versioned request/receipt signing while only executable old-version backlog blocks sunset", "contract"),
    check("contract:sequential-version-chain", contractAcceptance.thirdActive.ok === true && contractAcceptance.thirdActive.summary.transitions === 2 && contractAcceptance.thirdActive.entries.find((item) => item.laneId === "family-doctor")?.currentContract === "family-doctor-fulfillment-v3" && ["contract-transition-disconnected", "contract-transition-approval-order-invalid", "contract-transition-window-overlap"].every((token) => contractSource.includes(token)), "signed non-overlapping transitions advance v1 to v2 to v3 while branch, gap, approval-order and overlap controls fail closed", "contract"),
    check("outbox:persisted-enqueue-attempt", outboxAcceptance.delivered.externalRuntime.summary.dispatches === 1 && outboxAcceptance.delivered.externalRuntime.summary.auditEntries === 3, "one signed dispatch and three append-only enqueue/claim/attempt audit entries", "outbox"),
    check("outbox:coordination-advance", outboxAcceptance.delivered.dispatch.deliveryState === "delivered" && outboxAcceptance.handoff.state === "receipt-confirmed", "verified callback advances the linked coordination handoff", "outbox"),
    check("outbox:runtime-state-signature", verifyRuntimeStateSignature(outboxAcceptance.delivered.dispatch, ACCEPTANCE_REQUEST_SECRET), "mutable outbox state retains a trusted runtime signature", "outbox"),
    check("outbox:dead-letter-exception-contract", ["open-coordination-exception", "runtime-state-signature-invalid", "attemptIdempotencyKey"].every((token) => adapterRuntimeSource.includes(token)), "dead letters open compensation exceptions and callback replays are idempotent", "outbox"),
    check("worker:due-claim-lease", outboxAcceptance.dueBeforeClaim.length === 1 && outboxAcceptance.claimed.dispatch.lease && outboxAcceptance.delivered.dispatch.lease === null, "due dispatch is leased once and released after the claimed attempt", "worker"),
    check("worker:lease-token-private", !JSON.stringify(outboxAcceptance.claimed.nextData).includes(outboxAcceptance.claimed.leaseToken) && ["expiredLeaseReclaimable", "lease token is invalid", "unclaimed external callback rejected"].every((token) => adapterRuntimeSource.includes(token)), "lease token is not persisted; stale workers and forged callbacks fail closed", "worker"),
    check("worker:optimistic-outbox-version", outboxAcceptance.dueBeforeClaim[0]?.outboxVersion === 1 && outboxAcceptance.claimed.dispatch.outboxVersion === 2 && outboxAcceptance.delivered.dispatch.outboxVersion === 3 && adapterRuntimeSource.includes("external dispatch version conflict"), "due, claim and attempt expose a CAS-ready signed outbox version", "worker"),
    check("recovery:sealed-predecessor", recoveryAcceptance.recovered.originalDispatch.deliveryState === "dead-letter" && recoveryAcceptance.recovered.originalDispatch.recovery?.state === "requeued", "original dead letter remains terminal with a signed recovery seal", "recovery"),
    check("recovery:single-successor", recoveryAcceptance.recovered.successorDispatch.deliveryState === "pending" && recoveryAcceptance.recovered.successorDispatch.predecessorDispatchId === recoveryAcceptance.rejected.dispatch.id && recoveryAcceptance.recovered.externalRuntime.summary.recoverySuccessors === 1, "one pending successor preserves the predecessor link", "recovery"),
    check("recovery:authorized-coordination-retry", recoveryAcceptance.handoff.state === "in-progress" && recoveryAcceptance.handoff.exception?.status === "retry-submitted" && ["requeuePublicHealthExternalDeadLetterToState", "remediationEvidenceRefs", "approvedByRole"].every((token) => adapterRuntimeSource.includes(token)), "lane-authorized remediation evidence reopens coordination for delivery", "recovery"),
    check("audit:signed-append-only-chain", verifyPublicHealthExternalAuditChain(outboxAcceptance.delivered.nextData, outboxAcceptance.delivered.dispatch.id, ACCEPTANCE_REQUEST_SECRET).entries === 3 && ["previousAuditHash", "auditSignature", "auditHead"].every((token) => adapterRuntimeSource.includes(token)), "enqueue, claim and attempt form a signed per-dispatch audit chain", "audit"),
    check("audit:tampering-fails-closed", tamperedOperationsBoard.ok === false && tamperedOperationsBoard.issues.some((item) => item.code === "audit-chain-invalid"), "modified audit entry blocks the operations integrity gate", "audit"),
    check("operations:healthy-reconciliation", operationsBoard.ok === true && operationsBoard.operationallyHealthy === true && operationsBoard.summary.signatureVerified === 2 && operationsBoard.summary.issues === 0, "recovered predecessor, successor, signatures, audit and coordination states reconcile", "operations"),
    check("operations:risk-queue-contract", ["audit-dispatch-missing", "coordination-handoff-missing", "coordination-state-mismatch", "worker-lease-expired", "retry-due-unclaimed", "pending-dispatch-overdue", "dead-letter-unrecovered", "lane-control-audit-orphan", "lane-control-integrity-invalid", "lane-circuit-open"].every((token) => operationsSource.includes(token)), "integrity, orphan audit/task/control, mismatch, lease, retry, SLA, dead-letter and lane resilience risks have explicit codes", "operations"),
    check("frontend:action-route-contract", pageSource.includes("/api/public-health/coordination/") && pageSource.includes("idempotencyKey") && pageSource.includes("expectedVersion"), "T00 route boundary has a stable client contract", "integration"),
    check("integration:documented-boundary", ["public-health-coordination-runtime.js", "public-health-external-adapter-service.js", "T00", "server.js", "productionReady"].every((token) => doc.includes(token)) && ["requestKeyring", "receiptKeyring", "receiptReplayKeyHash", "legacy-static"].every((token) => keyringDoc.includes(token)) && ["expectedLaneControlVersion", "maxPending", "lane-circuit-open"].every((token) => resilienceDoc.includes(token)) && ["runtimeReleaseDigest", "contract-transition-conflict", "contract-governance-mismatch"].every((token) => contractDoc.includes(token)) && ["server-generated", "platform-observability", "endpointConnectivityReady", "productionReady"].every((token) => endpointProbeDoc.includes(token)) && ["只接受 `laneId`", "DNS rebinding", "certificatePins", "requireMutualTls", "productionReady=false"].every((token) => activeProbeDoc.includes(token)) && ["continuousConnectivityReady", "receiptDigest", "policyDigest", "campaign nonce", "productionReady=false"].every((token) => endpointCampaignDoc.includes(token)), "runtime, adapter, key lifecycle, resilience, contract, endpoint verification, active probing, campaign continuity and T00 boundaries are documented", "integration"),
    check("safety:functional-not-production", runtime.productionReady === false && registry.productionReady === false && deliveries.every((item) => item.productionReady === false), "functional acceptance cannot self-assert production readiness", "safety"),
    check("safety:endpoint-connectivity-not-production", endpointProbeAcceptance.endpointConnectivityReady === true && endpointProbeAcceptance.productionReady === false && endpointProbeAcceptance.entries.every((item) => item.blockerCode === "trusted-site-evidence-still-required"), "verified connectivity never replaces trusted site evidence or launch approval", "safety"),
    check("safety:continuous-connectivity-not-production", endpointProbeCampaignAcceptance.continuousConnectivityReady === true && endpointProbeCampaignAcceptance.productionReady === false && endpointProbeCampaignAcceptance.blockers.every((item) => /site evidence|handoff|P0\/P1|approval/i.test(item)), "three consecutive campaigns still retain site evidence, blocker, handoff and approval boundaries", "safety"),
    check("safety:trusted-site-evidence-blocker", deliveries.every((item) => /site evidence/i.test(item.blocker)), "every accepted delivery retains the trusted site-evidence blocker", "safety")
  ];
  return {
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    functionalState: "t08-public-health-planned-functions-complete",
    formalGoLiveState: "blocked-until-t00-integration-production-endpoints-and-trusted-site-evidence-verified",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      lanes: runtime.summary.lanes,
      handoffs: runtime.summary.handoffs,
      adapterProfiles: registry.summary.adapters,
      verifiedEndpointProbes: endpointProbeAcceptance.summary.endpointProbesVerified,
      verifiedEndpointProbeCampaigns: endpointProbeCampaignAcceptance.summary.campaignsVerified,
      verifiedEndpointProbeCampaignLinks: endpointProbeCampaignAcceptance.summary.campaignChainLinksVerified,
      modernizationSources: modernizationReadiness.summary.sources,
      modernizationCatalogEntries: modernizationReadiness.summary.catalogEntries,
      modernizationRules: modernizationReadiness.summary.rules,
      modernizationClosedAlerts: modernizationReadiness.summary.closedAlerts,
      modernizationClosedCollaborationTasks: modernizationReadiness.summary.closedCollaborationTasks,
      verifiedAcceptanceDeliveries: deliveries.filter((item) => item.deliveryState === "delivered").length,
      persistedAuditEntries: runtimeAcceptance.first.nextData.publicHealthCoordinationAudit.length,
      persistedOutboxDispatches: outboxAcceptance.delivered.externalRuntime.summary.dispatches,
      persistedOutboxAuditEntries: outboxAcceptance.delivered.externalRuntime.summary.auditEntries,
      recoveredDeadLetters: recoveryAcceptance.recovered.externalRuntime.summary.recoveredDeadLetters,
      recoverySuccessors: recoveryAcceptance.recovered.externalRuntime.summary.recoverySuccessors,
      operationsIssues: operationsBoard.summary.issues,
      operationsSignatureVerified: operationsBoard.summary.signatureVerified,
      resilienceAuditEntries: resilienceAcceptance.recovered.nextData.publicHealthExternalLaneControlAudit.length,
      verifiedContractAttestations: contractAcceptance.active.summary.verifiedAttestations,
      contractCutoverBacklog: contractCutoverDraining.summary.outstanding,
      sequentialContractTransitions: contractAcceptance.thirdActive.summary.transitions
    },
    checks,
    runtime: {
      functionalState: runtime.functionalState,
      formalGoLiveState: runtime.formalGoLiveState,
      summary: runtime.summary,
      productionReady: false
    },
    adapterRegistry: registry,
    endpointProbeRegistry: endpointProbeAcceptance,
    endpointProbeCampaignRegistry: endpointProbeCampaignAcceptance,
    endpointProbeCampaignFailureRegistry: endpointProbeCampaignFailureAcceptance,
    modernizationReadiness,
    acceptanceDeliveries: deliveries,
    outboxAcceptance: {
      dispatch: outboxAcceptance.delivered.dispatch,
      coordinationState: outboxAcceptance.handoff.state,
      summary: outboxAcceptance.delivered.externalRuntime.summary,
      productionReady: false
    },
    deadLetterRecoveryAcceptance: {
      originalDispatch: recoveryAcceptance.recovered.originalDispatch,
      successorDispatch: recoveryAcceptance.recovered.successorDispatch,
      coordinationState: recoveryAcceptance.handoff.state,
      summary: recoveryAcceptance.recovered.externalRuntime.summary,
      productionReady: false
    },
    operationsBoard,
    resilienceAcceptance: {
      opened: resilienceAcceptance.failed.control,
      probe: resilienceAcceptance.probe.control,
      recovered: resilienceAcceptance.recovered.control,
      productionReady: false
    },
    contractGovernanceAcceptance: {
      scheduled: contractAcceptance.scheduled.summary,
      active: contractAcceptance.active.summary,
      retired: contractAcceptance.retired.summary,
      thirdActive: contractAcceptance.thirdActive.summary,
      productionReady: false
    },
    contractCutoverAcceptance: {
      draining: contractCutoverDraining.summary,
      completed: contractCutoverCompleted.summary,
      productionReady: false
    },
    productionReady: false,
    artifacts: {
      coordinationService: "public-health-coordination-service.js",
      coordinationRuntime: "public-health-coordination-runtime.js",
      externalAdapters: "public-health-external-adapter-service.js",
      externalAdapterRuntime: "public-health-external-adapter-runtime.js",
      externalKeyring: "public-health-external-keyring-service.js",
      externalResilience: "public-health-external-resilience-service.js",
      externalContractGovernance: "public-health-external-contract-governance-service.js",
      externalContractCutover: "public-health-external-contract-cutover-service.js",
      externalEndpointVerification: "public-health-external-endpoint-verification-service.js",
      externalActiveProbeRunner: "public-health-external-endpoint-probe-runner.js",
      externalEndpointProbeCampaigns: "public-health-external-endpoint-probe-campaign-service.js",
      publicHealthDataFoundation: "public-health-data-foundation-service.js",
      publicHealthSurveillanceWorkflow: "public-health-surveillance-workflow-service.js",
      publicHealthMedicalPreventionCollaboration: "public-health-medical-prevention-collaboration-service.js",
      externalOperations: "public-health-external-operations-service.js",
      documentation: "docs/public-health-eight-domain-coordination.md",
      keyRotationDocumentation: "docs/public-health-external-key-rotation.md",
      resilienceDocumentation: "docs/public-health-external-resilience.md",
      contractGovernanceDocumentation: "docs/public-health-external-contract-governance.md",
      endpointVerificationDocumentation: "docs/public-health-external-endpoint-verification.md",
      activeProbeDocumentation: "docs/public-health-external-active-probing.md",
      endpointProbeCampaignDocumentation: "docs/public-health-external-endpoint-probe-campaigns.md",
      modernizationDocumentation: "docs/public-health-fifteenth-plan-data-surveillance-medical-prevention.md"
    },
    remainingT00Integration: [
      "Wire data-foundation and surveillance signal routes to the T08 controllers without duplicating validation, authorization or state transitions.",
      "Persist source-record hashes, signals, alerts, assessments and medical-prevention tasks through SQLite transactions with unique and optimistic-version constraints.",
      "Add the minimized surveillance and medical-prevention workbench panels through T00-owned public files.",
      "Register package, README, release and deploy gates while preserving productionReady=false until production interfaces, sharing authorization and trusted site evidence are verified."
    ]
  };
}

function renderMarkdown(report) {
  return [
    "# T08 public health final readiness",
    "",
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Functional state: ${report.functionalState}`,
    `- Formal go-live state: ${report.formalGoLiveState}`,
    `- Checks: ${report.summary.passed}/${report.summary.checks}`,
    `- Signed acceptance deliveries: ${report.summary.verifiedAcceptanceDeliveries}/8`,
    `- Verified endpoint probes: ${report.summary.verifiedEndpointProbes}/8`,
    `- Verified endpoint probe campaigns: ${report.summary.verifiedEndpointProbeCampaigns}/3`,
    `- Verified endpoint probe campaign links: ${report.summary.verifiedEndpointProbeCampaignLinks}/2`,
    `- Modernization data sources: ${report.summary.modernizationSources}/8`,
    `- Modernization surveillance rules: ${report.summary.modernizationRules}/8`,
    `- Modernization closed alerts: ${report.summary.modernizationClosedAlerts}/1`,
    `- Modernization closed collaboration tasks: ${report.summary.modernizationClosedCollaborationTasks}/2`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Status | Category | Check | Detail |",
    "|---|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.category} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Remaining T00 and site integration",
    "",
    ...report.remainingT00Integration.map((item) => `- ${item}`),
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = Object.fromEntries(argv.filter((item) => item.startsWith("--")).map((item) => {
    const [key, ...value] = item.slice(2).split("=");
    return [key, value.length ? value.join("=") : true];
  }));
  return { output: flags.output || DEFAULT_OUTPUT, markdown: flags.markdown || DEFAULT_MARKDOWN };
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

if (require.main === module) {
  try {
    const report = buildPublicHealthFinalReadiness();
    writeOutput(report, parseArgs());
    console.log(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildPublicHealthFinalReadiness,
  parseArgs,
  renderMarkdown,
  runExternalAdapterAcceptance,
  runExternalEndpointProbeCampaignAcceptance,
  runExternalOutboxAcceptance,
  runExternalResilienceAcceptance,
  runExternalContractGovernanceAcceptance,
  runDeadLetterRecoveryAcceptance,
  runRuntimeAcceptance,
  writeOutput
};
