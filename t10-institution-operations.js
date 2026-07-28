"use strict";

const crypto = require("node:crypto");

const CONFIGURATION_TRANSITIONS = {
  draft: { "submit-review": "under-review" },
  "under-review": { approve: "approved", "return-for-correction": "draft" },
  approved: { activate: "active", "return-for-correction": "draft" },
  active: { deactivate: "inactive", rollback: "rolled-back", supersede: "superseded" },
  inactive: { activate: "active", rollback: "rolled-back" }
};

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(typeof value === "string" ? value : stableSerialize(value)).digest("hex")}`;
}

function validateInstitutionId(value) {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(value || ""))) {
    throw new Error("invalid institution id");
  }
}

function validateVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(String(value || ""))) throw new Error("version must use semantic x.y.z format");
}

function appendAudit(audit, event) {
  const previousDigest = audit.length ? audit[audit.length - 1].digest : "sha256:genesis";
  const row = { ...event, previousDigest };
  row.digest = sha256(row);
  return [...audit, row];
}

function createConfigurationVersion(options = {}) {
  validateInstitutionId(options.institutionId);
  validateVersion(options.version);
  if (!Array.isArray(options.enabledTrackIds) || options.enabledTrackIds.length === 0) {
    throw new Error("enabledTrackIds must contain at least one specialty");
  }
  const enabledTrackIds = [...new Set(options.enabledTrackIds)];
  if (enabledTrackIds.length !== options.enabledTrackIds.length) throw new Error("duplicate specialty module id");
  const createdAt = options.createdAt || new Date().toISOString();
  const createdBy = String(options.createdBy || "").trim();
  if (!createdBy) throw new Error("createdBy is required");
  const base = {
    institutionId: options.institutionId,
    version: options.version,
    status: "draft",
    enabledTrackIds,
    supersedes: options.supersedes || null,
    createdAt,
    createdBy,
    currentOwner: createdBy,
    packageDigest: options.packageDigest || null,
    signatureEnvelope: null,
    audit: []
  };
  base.audit = appendAudit(base.audit, {
    event: "configuration.created",
    actor: createdBy,
    role: options.role || "institution-configurator",
    at: createdAt,
    from: null,
    to: "draft",
    version: base.version,
    reason: options.reason || "create institution specialty configuration"
  });
  base.digest = sha256({ ...base, digest: undefined });
  return base;
}

function transitionConfiguration(configuration, command = {}) {
  const target = CONFIGURATION_TRANSITIONS[configuration.status]?.[command.action];
  if (!target) throw new Error(`configuration transition not allowed: ${configuration.status} -> ${command.action}`);
  const actor = String(command.actor || "").trim();
  const role = String(command.role || "").trim();
  if (!actor || !role) throw new Error("actor and role are required");
  if (["approve", "activate"].includes(command.action) && actor === configuration.createdBy) {
    throw new Error("four-eyes separation requires a different actor");
  }
  if (command.action === "activate") {
    if (!command.packageVerification?.ok) throw new Error("verified signed package is required before activation");
    if (!command.signatureEnvelope?.signature) throw new Error("signed package envelope is required before activation");
    if (command.packageVerification.institutionId !== configuration.institutionId) {
      throw new Error("package institution does not match configuration");
    }
    if (command.packageVerification.payloadDigest !== configuration.packageDigest) {
      throw new Error("package digest does not match configuration");
    }
  }
  if (["deactivate", "rollback", "return-for-correction", "supersede"].includes(command.action) && !String(command.reason || "").trim()) {
    throw new Error("reason is required for corrective or terminal transition");
  }
  const at = command.at || new Date().toISOString();
  const next = {
    ...configuration,
    status: target,
    currentOwner: actor,
    signatureEnvelope: command.signatureEnvelope || configuration.signatureEnvelope,
    audit: appendAudit(configuration.audit || [], {
      event: `configuration.${command.action}`,
      actor,
      role,
      at,
      from: configuration.status,
      to: target,
      version: configuration.version,
      reason: command.reason || command.action
    })
  };
  next.digest = sha256({ ...next, digest: undefined });
  return next;
}

function createUpgradeConfiguration(activeConfiguration, options = {}) {
  if (activeConfiguration.status !== "active") throw new Error("only an active configuration can be upgraded");
  return createConfigurationVersion({
    ...options,
    institutionId: activeConfiguration.institutionId,
    supersedes: activeConfiguration.version
  });
}

function signDeploymentPackage(pkg, options = {}) {
  if (!options.privateKey) throw new Error("privateKey is required");
  const signerId = String(options.signerId || "").trim();
  const nonce = String(options.nonce || "").trim();
  if (!signerId || !nonce) throw new Error("signerId and nonce are required");
  const privateKey = typeof options.privateKey?.export === "function"
    ? options.privateKey
    : crypto.createPrivateKey(options.privateKey);
  const publicKey = crypto.createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const signedAt = options.signedAt || new Date().toISOString();
  const validUntil = options.validUntil || new Date(Date.parse(signedAt) + 24 * 60 * 60 * 1000).toISOString();
  if (!(Date.parse(validUntil) > Date.parse(signedAt))) throw new Error("validUntil must be after signedAt");
  const payloadDigest = sha256(pkg);
  const metadata = {
    institutionId: pkg.institutionId,
    selectedModuleIds: pkg.selectedModuleIds,
    packageIntegrity: pkg.integrity?.digest || null,
    signerId,
    signedAt,
    validUntil,
    nonce,
    algorithm: "Ed25519",
    certificateFingerprint: `sha256:${crypto.createHash("sha256").update(publicDer).digest("hex")}`
  };
  const message = stableSerialize({ payloadDigest, metadata });
  return {
    payloadDigest,
    metadata,
    signature: crypto.sign(null, Buffer.from(message), privateKey).toString("base64")
  };
}

function verifySignedDeploymentPackage(pkg, envelope, options = {}) {
  const checks = [];
  const now = Date.parse(options.now || new Date().toISOString());
  const payloadDigest = sha256(pkg);
  const trustedPublicKey = options.publicKey
    ? typeof options.publicKey.export === "function"
      ? options.publicKey
      : crypto.createPublicKey(options.publicKey)
    : null;
  const expectedFingerprint = trustedPublicKey
    ? `sha256:${crypto.createHash("sha256").update(trustedPublicKey.export({ type: "spki", format: "der" })).digest("hex")}`
    : null;
  const check = (id, passed, detail) => checks.push({ id, passed: Boolean(passed), detail });
  check("payload-digest", envelope?.payloadDigest === payloadDigest, envelope?.payloadDigest || "missing");
  check("institution-binding", envelope?.metadata?.institutionId === pkg.institutionId, envelope?.metadata?.institutionId || "missing");
  check("module-binding", stableSerialize(envelope?.metadata?.selectedModuleIds || []) === stableSerialize(pkg.selectedModuleIds || []), (envelope?.metadata?.selectedModuleIds || []).join(","));
  check("package-integrity-binding", envelope?.metadata?.packageIntegrity === pkg.integrity?.digest, envelope?.metadata?.packageIntegrity || "missing");
  check("algorithm", envelope?.metadata?.algorithm === "Ed25519", envelope?.metadata?.algorithm || "missing");
  check("authorized-signer", (options.allowedSignerIds || []).includes(envelope?.metadata?.signerId), envelope?.metadata?.signerId || "missing");
  check("validity-window", Number.isFinite(now) && now >= Date.parse(envelope?.metadata?.signedAt) && now <= Date.parse(envelope?.metadata?.validUntil), `${envelope?.metadata?.signedAt || "missing"}..${envelope?.metadata?.validUntil || "missing"}`);
  check("trusted-certificate-fingerprint", Boolean(trustedPublicKey) && envelope?.metadata?.certificateFingerprint === expectedFingerprint, envelope?.metadata?.certificateFingerprint || "missing");
  check("nonce-not-replayed", Boolean(envelope?.metadata?.nonce) && !(options.seenNonces || []).includes(envelope.metadata.nonce), envelope?.metadata?.nonce || "missing");
  let signatureValid = false;
  if (trustedPublicKey && envelope?.signature) {
    const message = stableSerialize({ payloadDigest: envelope.payloadDigest, metadata: envelope.metadata });
    signatureValid = crypto.verify(null, Buffer.from(message), trustedPublicKey, Buffer.from(envelope.signature, "base64"));
  }
  check("signature", signatureValid, envelope?.metadata?.algorithm || "missing");
  const failed = checks.filter((item) => !item.passed);
  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? "signed-package-verified" : "signed-package-rejected",
    institutionId: pkg.institutionId,
    payloadDigest,
    signerId: envelope?.metadata?.signerId || null,
    nonce: envelope?.metadata?.nonce || null,
    checks,
    hardStops: failed.map((item) => item.id),
    summary: { total: checks.length, passed: checks.length - failed.length, failed: failed.length }
  };
}

function importSiteEvidence(options = {}) {
  const cutoverPack = options.cutoverPack;
  const institutionPackage = options.institutionPackage;
  const packageVerification = options.packageVerification;
  if (!packageVerification?.ok) throw new Error("verified signed package is required for evidence import");
  if (packageVerification.institutionId !== institutionPackage.institutionId) throw new Error("package verification institution mismatch");
  const expected = new Map((cutoverPack.evidenceDossier?.entries || []).map((item) => [item.evidenceId, item]));
  const selected = new Set(institutionPackage.selectedModuleIds || []);
  const accepted = [];
  const rejected = [];
  const seenEvidenceIds = new Set();
  for (const entry of options.entries || []) {
    const contract = expected.get(entry.evidenceId);
    const reasons = [];
    if (!contract) reasons.push("unknown-evidence-id");
    if (seenEvidenceIds.has(entry.evidenceId)) reasons.push("duplicate-evidence-id");
    seenEvidenceIds.add(entry.evidenceId);
    if (contract && !selected.has(contract.trackId)) reasons.push("track-not-selected");
    if (entry.institutionId !== institutionPackage.institutionId) reasons.push("institution-mismatch");
    if (entry.packageDigest !== packageVerification.payloadDigest) reasons.push("package-digest-mismatch");
    if (entry.environment !== "production-site") reasons.push("non-production-evidence");
    if (!entry.submitterId || !entry.reviewerId || entry.submitterId === entry.reviewerId) reasons.push("four-eyes-separation");
    if (entry.status !== "accepted") reasons.push("evidence-not-accepted");
    const submittedAtMs = Date.parse(entry.submittedAt);
    const reviewedAtMs = Date.parse(entry.reviewedAt);
    if (!Number.isFinite(submittedAtMs) || !Number.isFinite(reviewedAtMs) || reviewedAtMs < submittedAtMs) {
      reasons.push("evidence-timestamp-invalid");
    }
    if (!entry.interfaceVersion) reasons.push("interface-version-missing");
    if (!Array.isArray(entry.artifacts) || entry.artifacts.length === 0) reasons.push("artifact-missing");
    if ((entry.artifacts || []).some((item) => !/^sha256:[a-f0-9]{64}$/.test(item.digest || "") || !item.originalReference)) {
      reasons.push("artifact-digest-or-original-missing");
    }
    const normalized = {
      ...entry,
      trackId: contract?.trackId || entry.trackId || null,
      severity: contract?.severity || null,
      requiredForFirstIncrement: Boolean(contract?.requiredForFirstIncrement),
      importedAt: options.importedAt || new Date().toISOString()
    };
    if (reasons.length) rejected.push({ ...normalized, reasons });
    else accepted.push({ ...normalized, evidenceDigest: sha256(normalized) });
  }
  const acceptedIds = new Set(accepted.map((item) => item.evidenceId));
  const requiredIds = [...expected.values()]
    .filter((item) => selected.has(item.trackId) && item.requiredForFirstIncrement)
    .map((item) => item.evidenceId);
  const missingRequired = requiredIds.filter((id) => !acceptedIds.has(id));
  return {
    status: rejected.length === 0 && missingRequired.length === 0 ? "site-evidence-import-accepted" : "site-evidence-import-blocked",
    ok: rejected.length === 0 && missingRequired.length === 0,
    institutionId: institutionPackage.institutionId,
    packageDigest: packageVerification.payloadDigest,
    accepted,
    rejected,
    missingRequired,
    auditDigest: sha256({ accepted: accepted.map((item) => item.evidenceDigest), rejected, missingRequired }),
    summary: {
      submitted: (options.entries || []).length,
      accepted: accepted.length,
      rejected: rejected.length,
      required: requiredIds.length,
      missingRequired: missingRequired.length
    }
  };
}

function runControlledRehearsal(options = {}) {
  const cutoverPack = options.cutoverPack;
  const evidenceImport = options.evidenceImport;
  if (!evidenceImport?.ok) throw new Error("accepted site evidence import is required before rehearsal");
  const acceptedEvidence = new Set(evidenceImport.accepted.map((item) => item.evidenceId));
  const results = new Map((options.scenarioResults || []).map((item) => [item.scenarioId, item]));
  const matrix = new Map((cutoverPack.scenarioEvidenceMatrix?.rows || []).map((item) => [item.scenarioId, item]));
  const scenarioRows = (cutoverPack.acceptanceScenarioSuite?.scenarios || []).map((scenario) => {
    const result = results.get(scenario.id);
    const matrixRow = matrix.get(scenario.id);
    const requiredEvidence = (matrixRow?.evidence || []).map((item) => item.evidenceId);
    const requiredAuditEvents = matrixRow?.requiredWorkflowEvents || [];
    const evidenceReady = requiredEvidence.every((id) => acceptedEvidence.has(id));
    const auditReady = requiredAuditEvents.every((event) => (result?.auditEvents || []).includes(event));
    const controlsReady = result?.duplicateMutations === 0
      && result?.patientSafetyIncidents === 0
      && result?.scopeViolations === 0
      && result?.digestMatch === true
      && (scenario.type !== "manual-downgrade" || result?.manualDowngradeReachable === true);
    const passed = result?.status === "passed" && evidenceReady && auditReady && controlsReady;
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      type: scenario.type,
      hardStopOnFail: Boolean(scenario.hardStopOnFail),
      passed,
      evidenceReady,
      auditReady,
      controlsReady,
      evidenceRefs: requiredEvidence,
      resultDigest: result ? sha256(result) : null
    };
  });
  const hardStopFailures = scenarioRows.filter((item) => item.hardStopOnFail && !item.passed);
  const otherFailures = scenarioRows.filter((item) => !item.passed && !item.hardStopOnFail);
  const audit = scenarioRows.reduce((rows, item) => appendAudit(rows, {
    event: "rehearsal.scenario-evaluated",
    actor: options.actor || "rehearsal-runner",
    role: "release-operations",
    at: options.executedAt || new Date().toISOString(),
    scenarioId: item.scenarioId,
    passed: item.passed,
    resultDigest: item.resultDigest
  }), []);
  return {
    status: hardStopFailures.length
      ? "rehearsal-hard-stop-failed"
      : otherFailures.length
        ? "rehearsal-repeat-required"
        : "rehearsal-passed-awaiting-t-plus-1",
    ok: hardStopFailures.length === 0 && otherFailures.length === 0,
    institutionId: evidenceImport.institutionId,
    primaryTrackId: cutoverPack.firstIncrement?.trackId,
    scenarioRows,
    hardStopFailures: hardStopFailures.map((item) => item.scenarioId),
    otherFailures: otherFailures.map((item) => item.scenarioId),
    audit,
    auditDigest: audit.length ? audit[audit.length - 1].digest : "sha256:genesis",
    nextDecision: hardStopFailures.length ? "stay-no-go" : otherFailures.length ? "repeat-batch-1" : "open-t-plus-1-observation"
  };
}

function evaluateObservationGate(options = {}) {
  const board = options.observationSignalBoard;
  const rehearsal = options.rehearsal;
  if (!rehearsal?.ok) throw new Error("passed controlled rehearsal is required before T+1 observation");
  const values = options.measurements || {};
  const artifactStates = options.artifactStates || {};
  const lanes = (board.lanes || []).map((lane) => {
    const signals = lane.signals.map((signal) => {
      const value = values[signal.id];
      const passed = signal.id === "manual-downgrade-reachable"
        ? value === true || value === "100%" || value === 100
        : typeof signal.threshold === "number" && typeof value === "number" && value <= signal.threshold;
      return { ...signal, value, passed };
    });
    return {
      id: lane.id,
      ownerSeat: lane.ownerSeat,
      evidenceArtifact: lane.evidenceArtifact,
      artifactAccepted: artifactStates[lane.evidenceArtifact] === "accepted",
      signals,
      passed: signals.every((item) => item.passed) && artifactStates[lane.evidenceArtifact] === "accepted"
    };
  });
  const failedSignals = lanes.flatMap((lane) => lane.signals.filter((signal) => !signal.passed));
  const p0Failures = failedSignals.filter((signal) => signal.severity === "P0");
  const p1Failures = failedSignals.filter((signal) => signal.severity === "P1");
  const missingArtifacts = lanes.filter((lane) => !lane.artifactAccepted).map((lane) => lane.evidenceArtifact);
  const memoAccepted = artifactStates["t-plus-1-observation-memo"] === "accepted";
  let decision = "open-watch-only-batch-2";
  if (p0Failures.length || missingArtifacts.length || !memoAccepted) decision = "stay-no-go";
  else if (p1Failures.length) decision = "repeat-batch-1";
  return {
    status: decision === "open-watch-only-batch-2" ? "observation-passed" : "observation-blocked",
    ok: decision === "open-watch-only-batch-2",
    institutionId: rehearsal.institutionId,
    decision,
    lanes,
    p0Failures: p0Failures.map((item) => item.id),
    p1Failures: p1Failures.map((item) => item.id),
    missingArtifacts,
    memoAccepted,
    observationDigest: sha256({ lanes, decision, missingArtifacts, memoAccepted })
  };
}

function buildPackageUpgradeDiff(currentPackage, nextPackage) {
  if (currentPackage.institutionId !== nextPackage.institutionId) throw new Error("institution package mismatch");
  const currentIds = new Set(currentPackage.selectedModuleIds || []);
  const nextIds = new Set(nextPackage.selectedModuleIds || []);
  const added = [...nextIds].filter((id) => !currentIds.has(id));
  const removed = [...currentIds].filter((id) => !nextIds.has(id));
  const unchanged = [...nextIds].filter((id) => currentIds.has(id));
  const currentModules = new Map((currentPackage.deploymentManifest?.enabledModules || []).map((item) => [item.id, item]));
  const nextModules = new Map((nextPackage.deploymentManifest?.enabledModules || []).map((item) => [item.id, item]));
  const boundaryChanges = unchanged.flatMap((id) => {
    const before = currentModules.get(id);
    const after = nextModules.get(id);
    const fields = ["page", "api", "dataNamespace", "rollbackUnit"];
    return fields.filter((field) => before?.[field] !== after?.[field]).map((field) => ({
      moduleId: id,
      field,
      before: before?.[field],
      after: after?.[field]
    }));
  });
  const hardStops = [];
  if (!nextPackage.deploymentGate?.ok) hardStops.push("next-deployment-gate-failed");
  if (nextPackage.compatibilityMatrix?.failedCombinations > 0) hardStops.push("next-combination-conflict");
  if (nextPackage.productionBoundary?.productionTrafficState !== "blocked-until-site-evidence-signed") hardStops.push("production-boundary-bypassed");
  if (boundaryChanges.length) hardStops.push("unchanged-module-boundary-drift");
  return {
    status: hardStops.length ? "upgrade-blocked" : "upgrade-ready-for-review",
    ok: hardStops.length === 0,
    institutionId: currentPackage.institutionId,
    fromDigest: currentPackage.integrity?.digest,
    toDigest: nextPackage.integrity?.digest,
    added,
    removed,
    unchanged,
    boundaryChanges,
    hardStops,
    requiredActions: [
      ...added.map((id) => `collect site evidence and rehearse newly added module ${id}`),
      ...removed.map((id) => `execute independent rollback and preserve evidence for removed module ${id}`),
      "sign and independently verify the next package",
      "keep production traffic blocked until the upgraded scope passes formal Go/No-Go"
    ],
    diffDigest: sha256({ added, removed, unchanged, boundaryChanges, hardStops })
  };
}

function verifyIndependentRollback(pkg, targetModuleId, observed = {}) {
  const target = (pkg.deploymentManifest?.enabledModules || []).find((item) => item.id === targetModuleId);
  if (!target) throw new Error("rollback target is not enabled");
  const peers = (pkg.deploymentManifest.enabledModules || []).filter((item) => item.id !== targetModuleId);
  const checks = [
    { id: "target-page-disabled", passed: !(observed.routeAllowlist || []).includes(target.page) },
    { id: "target-api-disabled", passed: !(observed.apiAllowlist || []).includes(target.api) },
    { id: "target-data-preserved", passed: (observed.preservedDataNamespaces || []).includes(target.dataNamespace) },
    { id: "target-evidence-preserved", passed: observed.evidencePreserved === true },
    {
      id: "peer-pages-unchanged",
      passed: peers.every((item) => (observed.routeAllowlist || []).includes(item.page))
    },
    {
      id: "peer-apis-unchanged",
      passed: peers.every((item) => (observed.apiAllowlist || []).includes(item.api))
    },
    {
      id: "peer-data-unchanged",
      passed: peers.every((item) => (observed.preservedDataNamespaces || []).includes(item.dataNamespace))
    },
    { id: "audit-and-business-approval", passed: observed.auditRecorded === true && observed.businessApproved === true }
  ];
  const failed = checks.filter((item) => !item.passed);
  return {
    status: failed.length ? "independent-rollback-blocked" : "independent-rollback-verified",
    ok: failed.length === 0,
    institutionId: pkg.institutionId,
    targetModuleId,
    checks,
    hardStops: failed.map((item) => item.id),
    rollbackDigest: sha256({ targetModuleId, checks })
  };
}

function buildT00IntegrationContract() {
  return {
    contractVersion: "1.0.0",
    producer: "T10",
    consumer: "T00",
    sharedFilesOwnedByT00: ["server.js", "portal.css", "package.json", "README.md", "public release summary"],
    t10Artifacts: [
      "release/t10-specialty-cutover-pack.json",
      "release/t10-runtime-smoke-report.json",
      "release/t10-institution-packages/<institutionId>/deployment-package.json",
      "release/t10-institution-packages/<institutionId>/artifact-index.json"
    ],
    requestedRoutes: [
      { method: "GET", path: "/api/t10-specialty/cutover-pack", roles: ["commission", "institution", "county"] },
      { method: "GET", path: "/api/t10-specialty/institution-packages/:institutionId", roles: ["commission", "institution"] },
      { method: "GET", path: "/api/t10-specialty/institution-packages/:institutionId/verification", roles: ["commission", "institution"] }
    ],
    releaseChecks: [
      "institution deployment gate is 9/9",
      "specialty compatibility matrix is 15/15",
      "institution package verification has zero failed checks",
      "production traffic remains blocked until site evidence is signed",
      "runtime smoke and release/deploy gates are green"
    ],
    integrationRule: "T00 exposes verified read-only artifacts and must not infer site acceptance or production Go-Live from code readiness"
  };
}

function buildInstitutionOperationsCapabilityPlan(options = {}) {
  const manifest = options.institutionDeploymentManifest || {};
  const deploymentGate = options.institutionDeploymentGate || {};
  const evidenceDossier = options.evidenceDossier || {};
  const acceptanceSuite = options.acceptanceScenarioSuite || {};
  const observationBoard = options.observationSignalBoard || {};
  const capabilities = [
    {
      id: "configuration-version-lifecycle",
      status: "implemented",
      acceptance: "immutable semantic versions, four-eyes approval, verified activation and append-only audit chain"
    },
    {
      id: "ed25519-signed-package",
      status: "implemented",
      acceptance: "Ed25519 algorithm, authorized signer, payload, institution, module, integrity, validity, certificate fingerprint, nonce and signature checks"
    },
    {
      id: "site-evidence-import",
      status: "implemented",
      acceptance: `${evidenceDossier.totalEntries || 0} contracted evidence IDs bind original SHA-256 receipts to a verified institution package`
    },
    {
      id: "controlled-rehearsal-runner",
      status: "implemented",
      acceptance: `${acceptanceSuite.summary?.scenarios || 0} scenarios evaluate evidence, audit events, idempotency, safety, scope and digest replay`
    },
    {
      id: "t-plus-1-observation-gate",
      status: "implemented",
      acceptance: `${observationBoard.summary?.lanes || 0} observation lanes decide stay No-Go, repeat batch-1 or open watch-only batch-2`
    },
    {
      id: "upgrade-and-independent-rollback",
      status: "implemented",
      acceptance: "package diffs block unchanged-module boundary drift and rollback preserves peer routes, APIs, data and evidence"
    }
  ];
  const implemented = capabilities.filter((item) => item.status === "implemented").length;
  return {
    status: deploymentGate.ok && implemented === capabilities.length ? "institution-operations-code-ready" : "institution-operations-blocked",
    institutionId: manifest.institutionId,
    productionTrafficState: manifest.productionTrafficState,
    enabledModuleIds: manifest.enabledModuleIds || [],
    capabilities,
    t00IntegrationContract: buildT00IntegrationContract(),
    generatedArtifacts: [
      "operations-plan.json",
      "operations-plan.md",
      "configuration-template.json",
      "evidence-import-template.json",
      "rehearsal-results-template.json",
      "observation-template.json",
      "upgrade-rollback-template.json",
      "specialty-plan-review.json",
      "external-action-board.json",
      "external-action-command-template.json",
      "external-action-audit-export.json",
      "t00-integration-contract.json",
      "artifact-index.json"
    ],
    summary: {
      capabilities: capabilities.length,
      implemented,
      blocked: capabilities.length - implemented
    },
    formalGoLiveBoundary: "code readiness does not replace real credentials, interface receipts, site rehearsal, T+1 observation or formal signoff"
  };
}

function buildInstitutionOperationsPlan(options = {}) {
  const cutoverPack = options.cutoverPack;
  const institutionPackage = options.institutionPackage;
  return {
    module: "t10-institution-operations",
    generatedAt: options.generatedAt || new Date().toISOString(),
    institutionId: institutionPackage.institutionId,
    selectedModuleIds: institutionPackage.selectedModuleIds,
    productionTrafficState: institutionPackage.productionBoundary.productionTrafficState,
    configurationLifecycle: {
      states: ["draft", "under-review", "approved", "active", "inactive", "rolled-back", "superseded"],
      transitions: CONFIGURATION_TRANSITIONS,
      fourEyesRequired: true
    },
    signedPackagePolicy: {
      algorithm: "Ed25519",
      checks: ["Ed25519 algorithm", "authorized signer", "payload digest", "institution and module binding", "package integrity", "validity window", "trusted certificate fingerprint", "nonce replay", "signature"]
    },
    evidenceImportTemplate: {
      evidenceIds: cutoverPack.evidenceDossier.entries.map((item) => item.evidenceId),
      requiredEnvironment: "production-site",
      submitterReviewerSeparation: true,
      packageDigestBinding: true
    },
    rehearsalScenarioIds: cutoverPack.acceptanceScenarioSuite.scenarios.map((item) => item.id),
    observationSignalIds: cutoverPack.observationSignalBoard.lanes.flatMap((lane) => lane.signals.map((signal) => signal.id)),
    t00IntegrationContract: buildT00IntegrationContract(),
    formalGoLiveBoundary: "operations plan is executable code readiness; real site evidence and formal approval remain external hard stops"
  };
}

module.exports = {
  CONFIGURATION_TRANSITIONS,
  stableSerialize,
  sha256,
  appendAudit,
  createConfigurationVersion,
  transitionConfiguration,
  createUpgradeConfiguration,
  signDeploymentPackage,
  verifySignedDeploymentPackage,
  importSiteEvidence,
  runControlledRehearsal,
  evaluateObservationGate,
  buildPackageUpgradeDiff,
  verifyIndependentRollback,
  buildT00IntegrationContract,
  buildInstitutionOperationsCapabilityPlan,
  buildInstitutionOperationsPlan
};
