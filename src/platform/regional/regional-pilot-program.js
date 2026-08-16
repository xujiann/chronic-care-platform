"use strict";

const fs = require("node:fs");
const path = require("node:path");
const defaultProgram = require("../../../config/regional-pilot-program.json");
const { buildRegionalCutoverDossier } = require("./regional-cutover-dossier");

function validateProgram(program) {
  if (program?.schemaVersion !== "regional-pilot-program-v1") throw new TypeError("regional pilot program schema is invalid");
  if (!/^\d{6}$/.test(program.regionCode || "")) throw new TypeError("regional pilot program requires a six-digit region code");
  if (!Array.isArray(program.steps) || program.steps.length < 5 || new Set(program.steps).size !== program.steps.length) {
    throw new TypeError("regional pilot workflow requires unique end-to-end steps");
  }
  if (!Array.isArray(program.adapterContracts) || program.adapterContracts.length < 3) {
    throw new TypeError("regional pilot program requires external adapter contracts");
  }
  if (program.adapterContracts.some((item) => !item.id || !item.owner || !/^signed-/.test(item.receipt || ""))) {
    throw new TypeError("regional pilot adapter contracts require owners and signed receipts");
  }
  return true;
}

function buildRegionalPilotReadiness(options = {}) {
  const root = path.resolve(options.root || path.join(__dirname, "..", "..", ".."));
  const program = options.program || defaultProgram;
  validateProgram(program);
  const artifacts = program.localArtifacts.map((file) => Object.freeze({ file, present: fs.existsSync(path.join(root, file)) }));
  const dossier = options.dossier || buildRegionalCutoverDossier({
    env: options.env || process.env,
    receipts: options.receipts || [],
    regionCode: program.regionCode,
    now: options.now
  });
  const localFoundationReady = artifacts.every((item) => item.present);
  const adapterReceipts = program.adapterContracts.map((item) => Object.freeze({
    id: item.id,
    owner: item.owner,
    requiredReceipt: item.receipt,
    status: "pending-external"
  }));
  const siteReady = dossier.candidateReady === true && dossier.siteEvidence?.evidenceReady === true;
  const checks = Object.freeze([
    { id: "regionalPilot:workflow", passed: program.steps.length >= 5, detail: `${program.steps.length} end-to-end steps` },
    { id: "regionalPilot:localArtifacts", passed: localFoundationReady, detail: `${artifacts.filter((item) => item.present).length}/${artifacts.length}` },
    { id: "regionalPilot:adapterContracts", passed: adapterReceipts.length >= 3, detail: `${adapterReceipts.length} signed receipt contracts` },
    { id: "regionalPilot:siteEvidenceBoundary", passed: true, detail: siteReady ? "current site evidence is eligible" : "site evidence remains external and cannot be inferred" }
  ]);
  return Object.freeze({
    schemaVersion: "regional-pilot-readiness-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    localFoundationReady,
    siteReady,
    productionReady: false,
    containsPatientData: false,
    containsCredentials: false,
    program: Object.freeze({
      programId: program.programId,
      regionCode: program.regionCode,
      institutionSlot: program.institutionSlot,
      workflow: program.workflow,
      steps: Object.freeze([...program.steps])
    }),
    artifacts: Object.freeze(artifacts),
    adapterReceipts: Object.freeze(adapterReceipts),
    siteEvidence: Object.freeze({
      requiredScopes: Object.freeze([...program.requiredSiteEvidenceScopes]),
      readyScopes: dossier.siteEvidence?.summary?.ready || 0,
      lifecycleAccepted: dossier.siteEvidence?.lifecycle?.accepted === true,
      cryptographicTrustReady: dossier.siteEvidence?.trust?.cryptographicTrustReady === true,
      candidateReady: dossier.candidateReady === true
    }),
    checks,
    blockers: Object.freeze(siteReady ? [] : [
      "pilot-institution-not-bound",
      "signed-external-adapter-receipts-pending",
      "current-regional-site-evidence-pending",
      "independent-pilot-acceptance-pending"
    ]),
    boundary: "The repository supplies a runnable pilot contract only. Institution binding, real callbacks and acceptance receipts must come from the controlled site."
  });
}

module.exports = { buildRegionalPilotReadiness, validateProgram };
