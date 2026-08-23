#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { DOMAIN_OWNERS, buildMatrix, readRouteSources, validateMatrix } = require("./api-authorization-matrix");
const { AUTHENTICATION_REGISTRY, authenticationEvidenceByKey, authenticationEvidenceContracts, validateAuthenticationEvidence } = require("./api-authentication-evidence");
const {
  DEFAULT_REGISTRY,
  actionSliceEvidenceContracts,
  endpointEvidenceContracts,
  evidenceByKey,
  validateEvidenceRegistry
} = require("./api-idempotency-evidence");

const ROOT = path.resolve(__dirname, "..");
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const IDEMPOTENCY_MARKERS = Object.freeze([
  Object.freeze({ id: "idempotency-header", pattern: /Idempotency-Key/i }),
  Object.freeze({ id: "idempotency-key", pattern: /idempotencyKey|idempotent/i }),
  Object.freeze({ id: "command-identity", pattern: /commandId|commandKey/i }),
  Object.freeze({ id: "request-identity", pattern: /clientRequestId|requestId/i }),
  Object.freeze({ id: "replay-or-deduplication", pattern: /replay|dedup/i }),
  Object.freeze({ id: "nonce", pattern: /nonce/i })
]);
const LITERAL_ROUTE_PATTERNS = Object.freeze([
  Object.freeze({
    expression: /req\.method\s*(?:===|!==)\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["'][^}]{0,240}?url\.pathname\s*(?:===|!==)\s*["'](\/api\/[^"']+)["']/g,
    methodGroup: 1,
    pathGroup: 2
  }),
  Object.freeze({
    expression: /url\.pathname\s*(?:===|!==)\s*["'](\/api\/[^"']+)["'][^}]{0,240}?req\.method\s*(?:===|!==)\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/g,
    methodGroup: 2,
    pathGroup: 1
  })
]);

function relativeSource(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function sourceIndex(sourceFiles) {
  return new Map(sourceFiles.map((entry) => [relativeSource(entry.file), String(entry.source || "").split(/\r?\n/)]));
}

function parseSourceReference(reference) {
  const match = String(reference || "").match(/^(.*):(\d+)$/);
  return match ? { file: match[1], line: Number(match[2]) } : null;
}

function domainForSource(reference) {
  const parsed = parseSourceReference(reference);
  const relative = parsed?.file || String(reference || "");
  const withinRoutes = relative.replace(/^.*src\/http\/routes\//, "");
  return withinRoutes.split("/")[0].replace(/\.js$/, "");
}

function buildLiteralRouteInventory(sourceFiles = readRouteSources()) {
  const inventory = new Map();
  for (const entry of sourceFiles) {
    const source = String(entry.source || "");
    const relative = relativeSource(entry.file);
    for (const pattern of LITERAL_ROUTE_PATTERNS) {
      pattern.expression.lastIndex = 0;
      for (const match of source.matchAll(pattern.expression)) {
        const method = match[pattern.methodGroup];
        const routePath = match[pattern.pathGroup];
        const key = `${method} ${routePath}`;
        const line = source.slice(0, match.index).split("\n").length;
        if (!inventory.has(key)) inventory.set(key, { key, method, path: routePath, sources: [] });
        inventory.get(key).sources.push(`${relative}:${line}`);
      }
    }
  }
  return [...inventory.values()].map((entry) => ({
    ...entry,
    sources: [...new Set(entry.sources)].sort()
  })).sort((left, right) => left.key.localeCompare(right.key));
}

function declarationWindow(route, indexedSources) {
  const reference = parseSourceReference(route.source);
  const lines = reference && indexedSources.get(reference.file);
  if (!reference || !lines) return "";
  const declarationIndex = Math.max(0, reference.line - 1);
  const start = Math.max(0, declarationIndex - 30);
  let end = lines.length;
  for (let index = declarationIndex + 1; index < lines.length; index += 1) {
    if (lines[index].includes("requireApiRole(")) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

function idempotencyFor(method, declarations, indexedSources, contract = null) {
  if (SAFE_METHODS.has(method)) {
    return Object.freeze({ required: false, status: "not-required-safe-method", mechanisms: [], behaviorEvidence: { status: "not-required-safe-method", contractId: null } });
  }
  const combined = declarations.map((route) => declarationWindow(route, indexedSources)).join("\n");
  const mechanisms = IDEMPOTENCY_MARKERS.filter((marker) => marker.pattern.test(combined)).map((marker) => marker.id);
  return Object.freeze({
    required: true,
    status: mechanisms.length ? "source-marker-observed" : "not-observed",
    mechanisms,
    behaviorEvidence: contract?.coverage?.level === "endpoint" ? {
      status: "behavior-verified",
      contractId: contract.contractId,
      owner: contract.owner,
      persistenceScope: contract.idempotency.persistenceScope,
      distributedExactlyOnceClaimed: false,
      verifiedActionContracts: []
    } : {
      status: "behavior-proof-required",
      contractId: null,
      verifiedActionContracts: contract?.coverage?.level === "action-slice" ? [contract.contractId] : []
    }
  });
}

function groupRoutes(routes) {
  const grouped = new Map();
  for (const route of routes) {
    if (!grouped.has(route.key)) grouped.set(route.key, []);
    grouped.get(route.key).push(route);
  }
  return grouped;
}

function buildCatalogEntry(declarations, indexedSources, contracts) {
  const first = declarations[0];
  const owners = [...new Set(declarations.map((route) => route.owner))].sort();
  const domains = [...new Set(declarations.map((route) => route.domain))].sort();
  const purposes = [...new Set(declarations.map((route) => route.purpose))].sort();
  const roles = [...new Set(declarations.flatMap((route) => route.roles))].sort();
  const dataScopes = [...new Set(declarations.map((route) => route.dataScope))].sort();
  const identityRequiredValues = [...new Set(declarations.map((route) => route.identity.required))];
  const authenticationModes = [...new Set(declarations.map((route) => route.identity.mode))].sort();
  const mechanisms = [...new Set(declarations.map((route) => route.identity.mechanism))].sort();
  const principalTypes = [...new Set(declarations.map((route) => route.identity.principalType).filter(Boolean))].sort();
  const authenticationContractIds = [...new Set(declarations.map((route) => route.authenticationEvidenceContractId).filter(Boolean))].sort();
  const authorizationModels = [...new Set(declarations.map((route) => route.authorizationModel).filter(Boolean))].sort();
  const idempotency = idempotencyFor(first.method, declarations, indexedSources, contracts.get(first.key));
  const routeResolution = first.path.startsWith("/api/") && first.method !== "ANY" ? "literal" : "runtime-policy";
  const internalBlockers = [];
  if (owners.length !== 1) internalBlockers.push("multiple-route-owners");
  if (domains.length !== 1) internalBlockers.push("multiple-route-domains");
  if (purposes.length !== 1) internalBlockers.push("multiple-route-purposes");
  if (identityRequiredValues.length !== 1) internalBlockers.push("conflicting-authentication-policy");
  if (authenticationModes.length !== 1) internalBlockers.push("conflicting-authentication-mode");
  if (routeResolution !== "literal") internalBlockers.push("runtime-route-policy-not-resolved");
  if (identityRequiredValues[0] && roles.some((role) => role.startsWith("runtime-policy:"))) {
    internalBlockers.push("runtime-role-policy-not-resolved");
  }
  if (idempotency.required && idempotency.status === "not-observed") {
    internalBlockers.push("idempotency-not-observed-in-route-source");
  }
  if (idempotency.required && idempotency.behaviorEvidence.status !== "behavior-verified") {
    internalBlockers.push("idempotency-behavior-proof-required");
  }
  const authorizationVariants = declarations.map((route) => ({
    roles: [...route.roles].sort(),
    dataScope: route.dataScope,
    authorizationModel: route.authorizationModel || "platform-rbac",
    source: route.source
  }));
  return {
    key: first.key,
    method: first.method,
    path: first.path,
    routeResolution,
    owner: owners.length === 1 ? owners[0] : "MULTIPLE",
    domain: domains.length === 1 ? domains[0] : "multiple",
    purpose: purposes.length === 1 ? purposes[0] : "multiple",
    authentication: {
      required: identityRequiredValues.length === 1 ? identityRequiredValues[0] : null,
      mode: authenticationModes.length === 1 ? authenticationModes[0] : "review-required",
      mechanisms,
      principalTypes,
      evidenceContractIds: authenticationContractIds
    },
    authorization: {
      roles,
      dataScopes,
      rolesOrScope: roles.length ? "roles-and-resource-scope" : authorizationModels.length === 1 ? authorizationModels[0] : "public-no-role",
      models: authorizationModels,
      variants: authorizationVariants
    },
    idempotency,
    highRisk: declarations.some((route) => route.highRisk),
    sourceCoverage: "authorization-matrix",
    production: {
      status: "NO-GO",
      productionReady: false,
      repositoryReview: internalBlockers.length ? "review-required" : "catalogued",
      externalEvidenceRequired: true,
      blockers: [...internalBlockers, "real-environment-and-site-evidence-required"]
    },
    sources: declarations.map((route) => route.source).sort(),
    routeInventorySources: []
  };
}

function buildInventoryOnlyEntry(route, indexedSources, contracts) {
  const declarations = route.sources.map((source) => ({ source }));
  const domain = domainForSource(route.sources[0]);
  const owner = DOMAIN_OWNERS[domain] || "T00-review-required";
  const idempotency = idempotencyFor(route.method, declarations, indexedSources, contracts.get(route.key));
  const blockers = [
    "missing-authorization-matrix-declaration",
    "authentication-policy-not-classified"
  ];
  if (idempotency.required && idempotency.status === "not-observed") {
    blockers.push("idempotency-not-observed-in-route-source");
  }
  if (idempotency.required && idempotency.behaviorEvidence.status !== "behavior-verified") blockers.push("idempotency-behavior-proof-required");
  return {
    key: route.key,
    method: route.method,
    path: route.path,
    routeResolution: "literal",
    owner,
    domain,
    purpose: "runtime-policy-review-required",
    authentication: {
      required: null,
      mode: "review-required",
      mechanisms: ["runtime-policy-review-required"],
      principalTypes: [],
      evidenceContractIds: []
    },
    authorization: {
      roles: [],
      dataScopes: ["runtime-policy"],
      rolesOrScope: "runtime-policy-review-required",
      variants: []
    },
    idempotency,
    highRisk: false,
    sourceCoverage: "route-inventory-only",
    production: {
      status: "NO-GO",
      productionReady: false,
      repositoryReview: "review-required",
      externalEvidenceRequired: true,
      blockers: [...blockers, "real-environment-and-site-evidence-required"]
    },
    sources: [],
    routeInventorySources: route.sources
  };
}

function buildProductionApiCatalog(matrix = buildMatrix(), sourceFiles = readRouteSources()) {
  const indexedSources = sourceIndex(sourceFiles);
  const contracts = evidenceByKey();
  const entriesByKey = new Map([...groupRoutes(matrix.routes).values()]
    .map((declarations) => buildCatalogEntry(declarations, indexedSources, contracts))
    .map((entry) => [entry.key, entry]));
  const routeInventory = buildLiteralRouteInventory(sourceFiles);
  for (const route of routeInventory) {
    const catalogEntry = entriesByKey.get(route.key);
    if (catalogEntry) {
      catalogEntry.routeInventorySources = route.sources;
      catalogEntry.sourceCoverage = "authorization-matrix-and-route-inventory";
    } else {
      entriesByKey.set(route.key, buildInventoryOnlyEntry(route, indexedSources, contracts));
    }
  }
  const entries = [...entriesByKey.values()].sort((left, right) => left.key.localeCompare(right.key));
  return {
    schemaVersion: "production-api-catalog-v3",
    generatedFrom: {
      authorizationMatrix: matrix.schemaVersion,
      routeSources: matrix.generatedFrom,
      idempotencyEvidence: DEFAULT_REGISTRY.schemaVersion,
      authenticationEvidence: AUTHENTICATION_REGISTRY.schemaVersion,
      ownership: "existing authorization matrix owner mapping and process workstream governance"
    },
    policy: {
      productionDefault: "NO-GO",
      safeMethods: [...SAFE_METHODS],
      sourceMarkersAreBehaviorProof: false,
      writeIdempotencyEvidence: "explicit-behavior-contract-and-executable-test-evidence",
      externalEvidenceCanBeGeneratedByRepository: false
    },
    summary: {
      declarations: matrix.routes.length,
      entries: entries.length,
      literalRouteInventory: routeInventory.length,
      literalRoutes: entries.filter((entry) => entry.routeResolution === "literal").length,
      runtimePolicyRoutes: entries.filter((entry) => entry.routeResolution !== "literal").length,
      protectedRoutes: entries.filter((entry) => entry.authentication.required).length,
      publicRoutes: entries.filter((entry) => entry.authentication.mode === "none").length,
      optionalAuthenticationRoutes: entries.filter((entry) => entry.authentication.mode === "optional").length,
      authenticationEvidenceVerified: entries.filter((entry) => entry.authentication.evidenceContractIds.length === 1).length,
      unclassifiedAuthentication: entries.filter((entry) => entry.authentication.required === null).length,
      routeInventoryOnly: entries.filter((entry) => entry.sourceCoverage === "route-inventory-only").length,
      writeRoutes: entries.filter((entry) => entry.idempotency.required).length,
      writeIdempotencyObserved: entries.filter((entry) => entry.idempotency.status === "source-marker-observed").length,
      writeIdempotencyNotObserved: entries.filter((entry) => entry.idempotency.status === "not-observed").length,
      writeIdempotencyBehaviorVerified: entries.filter((entry) => entry.idempotency.behaviorEvidence.status === "behavior-verified").length,
      writeIdempotencyActionSlicesVerified: entries.reduce((count, entry) => count + (entry.idempotency.behaviorEvidence.verifiedActionContracts || []).length, 0),
      writeIdempotencyBehaviorProofRequired: entries.filter((entry) => entry.idempotency.behaviorEvidence.status === "behavior-proof-required").length,
      reviewRequired: entries.filter((entry) => entry.production.repositoryReview === "review-required").length,
      productionNoGo: entries.filter((entry) => entry.production.status === "NO-GO").length
    },
    entries
  };
}

function validateProductionApiCatalog(catalog, matrix = buildMatrix(), sourceFiles = readRouteSources()) {
  const errors = validateMatrix(matrix).map((error) => `authorization matrix: ${error}`);
  errors.push(...validateAuthenticationEvidence().map((error) => `authentication evidence: ${error}`));
  errors.push(...validateEvidenceRegistry().map((error) => `idempotency evidence: ${error}`));
  if (catalog.schemaVersion !== "production-api-catalog-v3") errors.push("unsupported production API catalog schema");
  if (catalog.generatedFrom?.authorizationMatrix !== matrix.schemaVersion) errors.push("authorization matrix source version drift");
  if (catalog.generatedFrom?.authenticationEvidence !== AUTHENTICATION_REGISTRY.schemaVersion) errors.push("authentication evidence source version drift");
  const governedAuthentication = authenticationEvidenceByKey();
  const keys = new Set();
  for (const entry of catalog.entries || []) {
    if (keys.has(entry.key)) errors.push(`duplicate catalog key: ${entry.key}`);
    keys.add(entry.key);
    if (entry.key !== `${entry.method} ${entry.path}`) errors.push(`API method/path drift: ${entry.key}`);
    if (!entry.method || !entry.path || !/^T\d{2}$/.test(entry.owner) || !entry.domain || !entry.purpose) {
      errors.push(`incomplete API identity: ${entry.key || "unknown"}`);
    }
    if (!entry.authentication || !Object.hasOwn(entry.authentication, "required") || ![true, false, null].includes(entry.authentication.required)) {
      errors.push(`API has no authentication classification: ${entry.key}`);
    }
    if (!entry.authentication || !["required", "optional", "none", "review-required"].includes(entry.authentication.mode)) errors.push(`API has no authentication mode: ${entry.key}`);
    if (entry.authentication?.mode === "required" && entry.authentication.required !== true) errors.push(`required authentication mode drift: ${entry.key}`);
    if (["optional", "none"].includes(entry.authentication?.mode) && entry.authentication.required !== false) errors.push(`non-required authentication mode drift: ${entry.key}`);
    if (entry.authentication?.required === true && (!Array.isArray(entry.authorization?.roles) || entry.authorization.roles.length === 0) && entry.authorization?.models?.length !== 1) {
      errors.push(`protected API has no role or scope policy: ${entry.key}`);
    }
    if (entry.authentication?.required === null && (!entry.production?.blockers?.includes("authentication-policy-not-classified") || entry.production?.repositoryReview !== "review-required")) {
      errors.push(`unclassified authentication must remain review-required: ${entry.key}`);
    }
    if (entry.authentication?.required !== null && Array.isArray(entry.authentication?.evidenceContractIds) && entry.authentication.evidenceContractIds.length) {
      const contract = governedAuthentication.get(entry.key);
      if (entry.authentication.evidenceContractIds.length !== 1 || !contract || contract.contractId !== entry.authentication.evidenceContractIds[0]
        || contract.owner !== entry.owner || contract.authentication.required !== entry.authentication.required
        || contract.authentication.mode !== entry.authentication.mode || !entry.authentication.mechanisms.includes(contract.authentication.mechanism)) {
        errors.push(`authentication classification lacks matching governed evidence: ${entry.key}`);
      }
    }
    if (!Array.isArray(entry.authorization?.dataScopes) || entry.authorization.dataScopes.length === 0) {
      errors.push(`API has no data scope: ${entry.key}`);
    }
    if (!entry.idempotency || typeof entry.idempotency.required !== "boolean" || !entry.idempotency.status) {
      errors.push(`API has no idempotency classification: ${entry.key}`);
    }
    if (entry.idempotency?.required && !["behavior-verified", "behavior-proof-required"].includes(entry.idempotency.behaviorEvidence?.status)) errors.push(`write API has no behavior evidence status: ${entry.key}`);
    if (entry.idempotency?.required && entry.idempotency.behaviorEvidence?.status === "behavior-proof-required" && (!entry.production?.blockers?.includes("idempotency-behavior-proof-required") || entry.production?.repositoryReview !== "review-required")) errors.push(`unverified write API must remain review-required: ${entry.key}`);
    if (entry.idempotency?.behaviorEvidence?.status === "behavior-verified") {
      const contract = evidenceByKey().get(entry.key);
      if (!contract || contract.coverage?.level !== "endpoint" || entry.idempotency.behaviorEvidence.contractId !== contract.contractId || entry.owner !== contract.owner) errors.push(`behavior verification lacks a matching governed endpoint contract: ${entry.key}`);
      if (entry.idempotency.behaviorEvidence.distributedExactlyOnceClaimed !== false) errors.push(`behavior verification must not claim distributed exactly-once: ${entry.key}`);
    }
    const expectedActionContract = evidenceByKey().get(entry.key)?.coverage?.level === "action-slice"
      ? [evidenceByKey().get(entry.key).contractId]
      : [];
    if (JSON.stringify(entry.idempotency?.behaviorEvidence?.verifiedActionContracts || []) !== JSON.stringify(expectedActionContract)) {
      errors.push(`action-slice verification contract drift: ${entry.key}`);
    }
    for (const contractId of entry.idempotency?.behaviorEvidence?.verifiedActionContracts || []) {
      const contract = evidenceByKey().get(entry.key);
      if (!contract || contract.coverage?.level !== "action-slice" || contract.contractId !== contractId || entry.owner !== contract.owner) {
        errors.push(`action-slice verification lacks a matching governed contract: ${entry.key}`);
      }
      if (!entry.production?.blockers?.includes("idempotency-behavior-proof-required") || entry.production?.repositoryReview !== "review-required") {
        errors.push(`action-slice verification must not promote the full endpoint: ${entry.key}`);
      }
    }
    if (entry.production?.status !== "NO-GO" || entry.production?.productionReady !== false || entry.production?.externalEvidenceRequired !== true) {
      errors.push(`API production status must fail closed: ${entry.key}`);
    }
    if (!Array.isArray(entry.production?.blockers) || !entry.production.blockers.includes("real-environment-and-site-evidence-required")) {
      errors.push(`API lacks the external evidence blocker: ${entry.key}`);
    }
  }
  const matrixKeys = new Set(matrix.routes.map((route) => route.key));
  const inventoryKeys = new Set(buildLiteralRouteInventory(sourceFiles).map((route) => route.key));
  const expectedKeys = new Set([...matrixKeys, ...inventoryKeys]);
  for (const key of matrixKeys) if (!keys.has(key)) errors.push(`authorization declaration missing from catalog: ${key}`);
  for (const key of inventoryKeys) if (!keys.has(key)) errors.push(`literal route inventory missing from catalog: ${key}`);
  for (const key of keys) if (!expectedKeys.has(key)) errors.push(`catalog entry missing from source inventories: ${key}`);
  if (catalog.summary?.entries !== keys.size) errors.push("catalog entry summary drift");
  if (catalog.summary?.declarations !== matrix.routes.length) errors.push("catalog declaration summary drift");
  if (catalog.summary?.productionNoGo !== keys.size) errors.push("not every catalog entry is production NO-GO");
  if (catalog.summary?.writeIdempotencyBehaviorVerified !== endpointEvidenceContracts().length) errors.push("behavior-verified idempotency summary drift");
  if (catalog.summary?.writeIdempotencyActionSlicesVerified !== actionSliceEvidenceContracts().length) errors.push("action-slice idempotency summary drift");
  if ((catalog.summary?.writeIdempotencyBehaviorVerified || 0) + (catalog.summary?.writeIdempotencyBehaviorProofRequired || 0) !== catalog.summary?.writeRoutes) errors.push("write behavior evidence summary drift");
  if (catalog.summary?.writeIdempotencyObserved !== (catalog.entries || []).filter((entry) => entry.idempotency?.status === "source-marker-observed").length) errors.push("source-marker observed summary drift");
  if (catalog.summary?.writeIdempotencyNotObserved !== (catalog.entries || []).filter((entry) => entry.idempotency?.status === "not-observed").length) errors.push("source-marker not-observed summary drift");
  if (catalog.summary?.writeIdempotencyBehaviorProofRequired !== (catalog.entries || []).filter((entry) => entry.idempotency?.behaviorEvidence?.status === "behavior-proof-required").length) errors.push("behavior-proof-required summary drift");
  if (catalog.summary?.reviewRequired !== (catalog.entries || []).filter((entry) => entry.production?.repositoryReview === "review-required").length) errors.push("review-required summary drift");
  if (catalog.summary?.publicRoutes !== (catalog.entries || []).filter((entry) => entry.authentication?.mode === "none").length) errors.push("public API summary drift");
  if (catalog.summary?.optionalAuthenticationRoutes !== (catalog.entries || []).filter((entry) => entry.authentication?.mode === "optional").length) errors.push("optional authentication summary drift");
  if (catalog.summary?.authenticationEvidenceVerified !== authenticationEvidenceContracts().length) errors.push("authentication evidence summary drift");
  if (catalog.summary?.entries !== expectedKeys.size) errors.push("catalog source-union summary drift");
  if ((catalog.summary?.entries || 0) < 550) errors.push("production API catalog count unexpectedly low");
  return errors;
}

function runCli(argv = process.argv.slice(2)) {
  const matrix = buildMatrix();
  const catalog = buildProductionApiCatalog(matrix);
  const errors = validateProductionApiCatalog(catalog, matrix);
  const output = argv.includes("--check") ? { ok: errors.length === 0, errors, summary: catalog.summary } : catalog;
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (errors.length) process.exitCode = 1;
}

if (require.main === module) runCli();

module.exports = {
  IDEMPOTENCY_MARKERS,
  buildLiteralRouteInventory,
  buildProductionApiCatalog,
  declarationWindow,
  idempotencyFor,
  validateProductionApiCatalog
};
