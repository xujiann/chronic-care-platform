#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_REGISTER = path.join(ROOT, "config", "object-storage-architecture-decision.json");
const DEFAULT_OWNERSHIP = path.join(ROOT, "config", "domain-data-ownership.json");
const EXPECTED_ADR = path.join(ROOT, "docs", "adr", "2026-08-23-object-storage-durable-command-and-metadata-v2.md");
const OBJECT_STORAGE_READINESS = path.join(ROOT, "scripts", "object-storage-readiness.js");
const REQUIRED_ACTION_IDS = Object.freeze([
  "human-confirm-data-owner",
  "human-confirm-api-compatibility",
  "accept-architecture-decision",
  "sqlite-v17-structured-storage",
  "legacy-backfill-and-freeze",
  "versioned-async-api-v2",
  "durable-object-storage-worker",
  "lossless-keyset-pagination",
  "persistent-provider-reconciliation",
  "readiness-deployment-and-operations"
]);
const REQUIRED_HUMAN_DECISION_IDS = Object.freeze([
  "confirm-secure-attachment-data-owner",
  "confirm-v1-v2-api-compatibility"
]);
const REQUIRED_ADR_SECTIONS = Object.freeze([
  "Problem",
  "Options",
  "Advantages",
  "Disadvantages",
  "Migration cost",
  "Risk",
  "Recommendation"
]);
const AUTHORIZATION_FLAGS = Object.freeze([
  "v17MigrationAuthorized",
  "runtimeImplementationAuthorized",
  "apiImplementationAuthorized",
  "productionPromotionAllowed"
]);

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail: String(detail || "") };
}

function exactIds(rows, required) {
  const ids = Array.isArray(rows) ? rows.map((item) => item?.id) : [];
  return ids.length === required.length
    && new Set(ids).size === ids.length
    && required.every((id) => ids.includes(id));
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function readRepositoryState(options = {}) {
  const register = options.register || loadJson(options.registerFile || DEFAULT_REGISTER);
  const ownership = options.ownership || loadJson(options.ownershipFile || DEFAULT_OWNERSHIP);
  const adrPath = path.resolve(ROOT, register?.decision?.adrPath || "missing-adr");
  const adrSource = options.adrSource ?? (adrPath === EXPECTED_ADR ? fs.readFileSync(adrPath, "utf8") : "");
  const readinessSource = options.readinessSource ?? fs.readFileSync(OBJECT_STORAGE_READINESS, "utf8");
  let sqliteHead = options.sqliteHead;
  if (!Number.isSafeInteger(sqliteHead)) {
    ({ SQLITE_SCHEMA_HEAD: sqliteHead } = require("../src/platform/storage/sqlite-migrations"));
  }
  return { register, ownership, adrPath, adrSource, readinessSource, sqliteHead };
}

function buildGovernanceReport(input) {
  const { register, ownership, adrPath, adrSource, readinessSource, sqliteHead } = input;
  const decision = register?.decision || {};
  const actions = Array.isArray(register?.actions) ? register.actions : [];
  const humanDecisions = Array.isArray(decision.requiredHumanDecisions)
    ? decision.requiredHumanDecisions
    : [];
  const authorization = decision.authorization || {};
  const proposalMode = decision.status === "proposed";
  const acceptedMode = decision.status === "accepted";
  const adrStatusMatch = String(adrSource || "").match(/^- 状态：([^\r\n]+)$/m);
  const adrStatus = String(adrStatusMatch?.[1] || "missing").trim().toLowerCase();
  const unresolved = humanDecisions.filter((item) => item?.status !== "resolved");
  const enabledAuthorizations = AUTHORIZATION_FLAGS.filter((flag) => authorization[flag] === true);
  const implementationFlagsEnabled = [
    "v17MigrationAuthorized",
    "runtimeImplementationAuthorized",
    "apiImplementationAuthorized"
  ].every((flag) => authorization[flag] === true);
  const acceptedActionStatesValid = actions.every((item) => {
    if (["persistent-provider-reconciliation", "readiness-deployment-and-operations"].includes(item?.id)) {
      return /^repository-complete-.*-blocked$/.test(String(item?.status || ""));
    }
    return item?.status === "completed";
  });
  const sectionChecks = REQUIRED_ADR_SECTIONS.map((section) => (
    new RegExp(`^## ${section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m").test(String(adrSource || ""))
  ));

  const checks = [
    check("objectStorageDecision:schema", register?.schemaVersion === "object-storage-architecture-decision-v1", register?.schemaVersion || "missing schema"),
    check("objectStorageDecision:id", decision.id === "OBJ-ADR-002", decision.id || "missing decision id"),
    check("objectStorageDecision:adrPath", adrPath === EXPECTED_ADR, decision.adrPath || "missing ADR path"),
    check("objectStorageDecision:adrStatus", adrStatus === decision.status, `ADR=${adrStatus}; register=${decision.status || "missing"}`),
    check("objectStorageDecision:adrSections", sectionChecks.every(Boolean), `${sectionChecks.filter(Boolean).length}/${REQUIRED_ADR_SECTIONS.length} required sections`),
    check("objectStorageDecision:knownStatus", proposalMode || acceptedMode, decision.status || "missing status"),
    check("objectStorageDecision:defaultNoGo", decision.defaultDecision === "NO-GO", decision.defaultDecision || "missing default decision"),
    check("objectStorageDecision:confirmedOwner", decision.recommendedOwnership?.dataOwner?.process === "T08"
      && decision.recommendedOwnership?.dataOwner?.domain === "integration"
      && decision.recommendedOwnership?.dataOwner?.status === "confirmed"
      && decision.recommendedOwnership?.technicalOwner?.process === "T00"
      && decision.recommendedOwnership?.technicalOwner?.status === "confirmed", "T08 data owner and T00 technical owner must remain confirmed"),
    check("objectStorageDecision:approvedCompatibility", decision.recommendedCompatibility?.strategy === "parallel-versioned-v2-async-api"
      && decision.recommendedCompatibility?.status === "approved", "parallel versioned v2 async compatibility must remain approved"),
    check("objectStorageDecision:humanDecisionCoverage", exactIds(humanDecisions, REQUIRED_HUMAN_DECISION_IDS), `${humanDecisions.length}/${REQUIRED_HUMAN_DECISION_IDS.length} human decisions tracked`),
    check("objectStorageDecision:actionCoverage", exactIds(actions, REQUIRED_ACTION_IDS), `${actions.length}/${REQUIRED_ACTION_IDS.length} actions tracked`),
    check("objectStorageDecision:actionShape", actions.every((item) => typeof item?.owner === "string"
      && item.owner.trim()
      && typeof item?.deliverable === "string"
      && item.deliverable.trim()
      && Array.isArray(item?.dependsOn)), "each action requires owner, dependencies and deliverable"),
    check("objectStorageDecision:actionDependencies", actions.every((item) => item.dependsOn?.every((dependency) => REQUIRED_ACTION_IDS.includes(dependency) && dependency !== item.id)), "all action dependencies must reference another registered action"),
    check("objectStorageDecision:authorizationShape", AUTHORIZATION_FLAGS.every((flag) => typeof authorization[flag] === "boolean"), "all authorization flags must be explicit booleans"),
    check("objectStorageDecision:v17Applied", decision.reservedSqliteMigrationVersion === 17 && sqliteHead === 17, `reserved=${decision.reservedSqliteMigrationVersion}; currentHead=${sqliteHead}`),
    check("objectStorageDecision:confirmedDataOwnership", ownership?.collections?.secureAttachments?.owner === "integration"
      && ownership?.collections?.secureAttachments?.classification === "restricted"
      && ownership?.collections?.secureAttachments?.writeContract === "object-storage-durable-command-and-metadata.v2"
      && ownership?.collections?.secureAttachments?.productionWriteAllowed === false, "secureAttachments ownership and production write gate must match the Accepted decision"),
    check("objectStorageDecision:readinessNoGo", /status:\s*"durable-v2-repository-ready-external-evidence-pending",\s*\r?\n\s*productionReady:\s*false/.test(String(readinessSource || "")), "object storage readiness must remain explicitly NO-GO without external evidence"),
    check("objectStorageDecision:acceptedActions", !acceptedMode || acceptedActionStatesValid, acceptedMode ? "repository actions complete; external evidence actions remain blocked" : "not in accepted mode"),
    check("objectStorageDecision:acceptedAuthorization", !acceptedMode || (implementationFlagsEnabled && authorization.productionPromotionAllowed === false), enabledAuthorizations.join(", ")),
    check("objectStorageDecision:acceptanceRequiresHumans", !acceptedMode || unresolved.length === 0, unresolved.length ? unresolved.map((item) => item.id).join(", ") : "human decisions resolved"),
    check("objectStorageDecision:promotionRequiresImplementation", authorization.productionPromotionAllowed !== true
      || (acceptedMode && unresolved.length === 0 && implementationFlagsEnabled && actions.every((item) => item.status === "completed")), "production promotion requires Accepted status, resolved human decisions, implementation authorizations and all external-evidence actions complete")
  ];

  const structurallyValid = checks.every((item) => item.passed);
  const implementationAuthorized = structurallyValid
    && acceptedMode
    && unresolved.length === 0
    && authorization.v17MigrationAuthorized === true
    && authorization.runtimeImplementationAuthorized === true
    && authorization.apiImplementationAuthorized === true;
  const productionReady = implementationAuthorized && authorization.productionPromotionAllowed === true;

  return {
    ok: structurallyValid,
    status: proposalMode ? "proposal-blocked-no-go" : productionReady ? "promotion-authorized" : "accepted-not-production-ready",
    implementationAuthorized,
    productionReady,
    summary: {
      decisionStatus: decision.status || "missing",
      actions: actions.length,
      blockedActions: actions.filter((item) => /^blocked-/.test(String(item?.status || ""))).length,
      unresolvedHumanDecisions: unresolved.length,
      sqliteHead,
      reservedSqliteMigrationVersion: decision.reservedSqliteMigrationVersion || null
    },
    checks
  };
}

function verifyRepository(options = {}) {
  return buildGovernanceReport(readRepositoryState(options));
}

if (require.main === module) {
  try {
    const report = verifyRepository();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (_error) {
    process.stderr.write("object storage architecture governance verification failed\n");
    process.exitCode = 1;
  }
}

module.exports = {
  AUTHORIZATION_FLAGS,
  REQUIRED_ACTION_IDS,
  REQUIRED_ADR_SECTIONS,
  REQUIRED_HUMAN_DECISION_IDS,
  buildGovernanceReport,
  readRepositoryState,
  verifyRepository
};
