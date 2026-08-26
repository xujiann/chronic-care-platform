"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { sha256 } = require("./technical-evidence");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const DEFAULT_SCOPE_PATH = path.join(ROOT, "config", "production-release-scope.json");
const REQUIRED_COMMANDS = Object.freeze({
  verify: "npm run production:release-scope:verify",
  apiCatalog: "npm run api:production-catalog",
  deploymentPackage: "npm run deployment:package",
  smoke: "npm run test:smoke",
  goNoGo: "npm run production:preflight:strict"
});

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function inventory(values) {
  const items = uniqueSorted(values);
  return Object.freeze({ count: items.length, sha256: sha256(items), items });
}

function check(id, passed, detail) {
  return Object.freeze({ id, passed: passed === true, detail: String(detail || "") });
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadDefaultAuthorities(root = ROOT) {
  const { buildMatrix } = require(path.join(root, "scripts", "api-authorization-matrix"));
  const { buildProductionApiCatalog } = require(path.join(root, "scripts", "production-api-catalog"));
  const { run: buildCollectionGovernance } = require(path.join(root, "scripts", "data-collection-governance"));
  return Object.freeze({
    scope: loadJson(path.join(root, "config", "production-release-scope.json")),
    applications: require(path.join(root, "health-dashboard-applications")),
    apiCatalog: buildProductionApiCatalog(buildMatrix()),
    staticPublication: loadJson(path.join(root, "config", "static-publication.json")),
    collectionGovernance: buildCollectionGovernance(),
    domainOwnership: loadJson(path.join(root, "config", "domain-data-ownership.json")),
    processWorkstreams: loadJson(path.join(root, "config", "process-workstreams.json")),
    workerRegistry: loadJson(path.join(root, "config", "worker-observability-contract.json")),
    externalCampaign: loadJson(path.join(root, "config", "external-joint-test-campaign.json")),
    cutoverActions: loadJson(path.join(root, "config", "production-cutover-actions.json")),
    packageJson: loadJson(path.join(root, "package.json")),
    root
  });
}

function buildProductionReleaseScopeReport(options = {}) {
  const root = options.root || ROOT;
  const scope = options.scope || loadJson(options.scopePath || DEFAULT_SCOPE_PATH);
  const applications = options.applications || [];
  const applicationById = new Map(applications.map((item) => [item.id, item]));
  const selectedApplications = (scope.applicationIds || []).map((id) => applicationById.get(id)).filter(Boolean);
  const platformPages = scope.platformEntrypoints?.pages || [];
  const platformApis = scope.platformEntrypoints?.apis || [];
  const applicationIds = inventory(selectedApplications.map((item) => item.id));
  const pages = inventory([...platformPages, ...selectedApplications.map((item) => item.entry)]);
  const apis = inventory([...platformApis, ...selectedApplications.flatMap((item) => item.apiRoutes || [])]);
  const collections = inventory(selectedApplications.flatMap((item) => item.collections || []));
  const workers = inventory(scope.workerProfileIds || []);
  const externalDependencies = inventory((scope.externalDependencies || []).map((item) => item.id));
  const applicationEvidence = inventory(selectedApplications.flatMap((item) => item.acceptanceEvidence || []));
  const actionDefinitions = [
    ...(options.cutoverActions?.cutoverActions || []),
    ...(options.cutoverActions?.evidenceActions || [])
  ];
  const cutoverActions = inventory(actionDefinitions.map((item) => item.id));
  const inventories = Object.freeze({
    applications: applicationIds,
    pages,
    apis,
    collections,
    workers,
    externalDependencies,
    applicationEvidence,
    cutoverActions
  });
  const scopeFingerprint = sha256(Object.fromEntries(Object.entries(inventories).map(([key, value]) => [key, {
    count: value.count,
    sha256: value.sha256
  }])));

  const catalogByKey = new Map((options.apiCatalog?.entries || []).map((item) => [item.key, item]));
  const publicationEntries = new Set(options.staticPublication?.entrypoints || []);
  const collectionByName = new Map((options.collectionGovernance?.collections || []).map((item) => [item.name, item]));
  const workerById = new Map((options.workerRegistry?.profiles || []).map((item) => [item.id, item]));
  const campaignIds = new Set((options.externalCampaign?.interfaces || []).map((item) => item.id));
  const packageScripts = options.packageJson?.scripts || {};
  const collectionBindings = scope.collectionSourceBindings || {};
  const resolveJsonPath = (value, segments) => (segments || []).reduce((current, segment) =>
    current && Object.hasOwn(current, segment) ? current[segment] : undefined, value);
  const bindingIsValid = (name) => {
    const binding = collectionBindings[name];
    const process = options.processWorkstreams?.processes?.[binding?.ownerProcess];
    if (binding?.kind === "owned-contract") {
      const ownerContract = resolveJsonPath(options.domainOwnership, binding.jsonPath);
      return binding.source === "config/domain-data-ownership.json"
        && JSON.stringify(binding.jsonPath) === JSON.stringify(["collections", name])
        && ownerContract?.owner === binding.owner
        && process?.slug === binding.owner;
    }
    if (binding?.kind === "derived-read-model") {
      if (name !== "operationsReadiness"
        || binding.source !== "scripts/operations-readiness.js"
        || binding.export !== "buildOperationsReadinessReport") return false;
      const protectedOwner = options.processWorkstreams?.protectedPaths?.find((item) =>
        item.pattern === binding.source)?.owner;
      if (protectedOwner !== binding.ownerProcess || typeof binding.export !== "string") return false;
      try {
        return typeof require(path.join(root, binding.source))[binding.export] === "function";
      } catch {
        return false;
      }
    }
    return false;
  };
  const collectionIsBound = (name) => {
    if (collectionByName.has(name)) return true;
    return bindingIsValid(name);
  };
  const missingCollectionNames = collections.items.filter((name) => !collectionByName.has(name));
  const collectionBindingKeys = uniqueSorted(Object.keys(collectionBindings));
  const inventoryChecks = Object.entries(inventories).map(([key, value]) => {
    const frozen = scope.frozenInventory?.[key];
    return check(`scope:inventory:${key}`, frozen?.count === value.count && frozen?.sha256 === value.sha256,
      `${value.count} / ${value.sha256}`);
  });
  const externalSourcesValid = (scope.externalDependencies || []).every((item) =>
    item.source === "external-joint-test-campaign"
      ? campaignIds.has(item.id)
      : typeof item.source === "string" && fs.existsSync(path.join(root, item.source)));
  const commandsValid = Boolean(Object.entries(REQUIRED_COMMANDS).every(([key, value]) => scope.commands?.[key] === value)
    && packageScripts["production:release-scope:verify"] === "node scripts/production-release-scope.js --check"
    && packageScripts["api:production-catalog"]
    && packageScripts["deployment:package"]
    && packageScripts["test:smoke"]
    && packageScripts["production:preflight:strict"]);
  const checks = [
    check("scope:schema", scope.schemaVersion === "production-release-scope.v1" && scope.scopeId === "priority-eight-applications-v1" && scope.status === "frozen" && scope.owner === "T00", scope.schemaVersion),
    check("scope:applications", scope.applicationIds?.length === 8 && selectedApplications.length === 8 && applicationIds.count === 8, `${selectedApplications.length}/8 applications resolved`),
    check("scope:pages", pages.items.every((item) => publicationEntries.has(item)), `${pages.items.filter((item) => publicationEntries.has(item)).length}/${pages.count} pages published`),
    check("scope:apis", apis.items.every((item) => catalogByKey.has(item)) && apis.items.every((item) => catalogByKey.get(item)?.production?.productionReady === false), `${apis.items.filter((item) => catalogByKey.has(item)).length}/${apis.count} APIs catalogued and NO-GO`),
    check("scope:collections", collections.items.every(collectionIsBound), `${collections.items.filter(collectionIsBound).length}/${collections.count} collection references bound to governance or explicit source evidence`),
    check("scope:collection-source-bindings", JSON.stringify(collectionBindingKeys) === JSON.stringify(uniqueSorted(missingCollectionNames)) && missingCollectionNames.every(bindingIsValid), `${missingCollectionNames.length} non-top-level/derived references have explicit validated semantics`),
    check("scope:workers", options.workerRegistry?.productionAuthorization === "never" && workers.items.every((item) => workerById.has(item)), `${workers.items.filter((item) => workerById.has(item)).length}/${workers.count} worker profiles governed; productionAuthorization=${options.workerRegistry?.productionAuthorization || "missing"}`),
    check("scope:external-dependencies", externalDependencies.count === 14 && externalSourcesValid, `${externalDependencies.count} external dependencies bound to controlled sources`),
    check("scope:cutover-actions", cutoverActions.count === 14 && options.cutoverActions?.policy?.definitionStatusIsAuthoritative === false, `${cutoverActions.count} definitions-only cutover actions`),
    check("scope:commands", commandsValid, "catalog, deployment package, smoke and strict preflight commands are bound"),
    ...inventoryChecks,
    check("scope:fingerprint", scope.scopeFingerprint === scopeFingerprint, scopeFingerprint),
    check("scope:production-boundary", scope.externalEvidenceRequired === true && scope.productionReady === false, "external evidence required; productionReady=false")
  ];
  const apiReviewRequired = apis.items.filter((item) => catalogByKey.get(item)?.production?.repositoryReview === "review-required");
  const collectionReviewRequired = collections.items.filter((item) =>
    !["owned-contract", "owner-reviewed-legacy", "governed-system"].includes(collectionByName.get(item)?.governanceStatus)
    && !bindingIsValid(item));
  const collectionProductionWriteBlocked = collections.items.filter((item) => {
    const governed = collectionByName.get(item);
    return governed
      ? governed.productionWriteAllowed !== true
      : true;
  });
  const deploymentScope = options.deploymentPackage?.processContract?.productionReleaseScope;
  const deploymentBound = !options.deploymentPackage || (
    deploymentScope?.contract === scope.schemaVersion
    && deploymentScope?.scopeId === scope.scopeId
    && deploymentScope?.scopeFingerprint === scopeFingerprint
    && deploymentScope?.productionReady === false
  );
  if (options.deploymentPackage) {
    checks.push(check("scope:deployment-package-binding", deploymentBound, deploymentScope?.scopeFingerprint || "missing"));
  }
  return Object.freeze({
    schemaVersion: "production-release-scope-report.v1",
    scopeId: scope.scopeId,
    ok: checks.every((item) => item.passed),
    status: "FROZEN-NO-GO",
    scopeFingerprint,
    productionReady: false,
    externalEvidenceRequired: true,
    deploymentBound,
    summary: Object.freeze(Object.fromEntries(Object.entries(inventories).map(([key, value]) => [key, value.count]))),
    inventories,
    repositoryReview: Object.freeze({
      apiReviewRequired: Object.freeze(apiReviewRequired),
      collectionReviewRequired: Object.freeze(collectionReviewRequired),
      collectionProductionWriteBlocked: Object.freeze(collectionProductionWriteBlocked)
    }),
    checks: Object.freeze(checks),
    blockers: Object.freeze([
      ...(apiReviewRequired.length ? [`${apiReviewRequired.length} scoped APIs require repository behavior review`] : []),
      ...(collectionReviewRequired.length ? [`${collectionReviewRequired.length} scoped collections require data-owner review`] : []),
      ...(collectionProductionWriteBlocked.length ? [`${collectionProductionWriteBlocked.length} scoped collection references remain blocked from production writes pending versioned contracts, migrations and external evidence`] : []),
      "all scoped APIs remain production NO-GO",
      "all scoped collections remain production-promotion NO-GO",
      "all scoped workers require explicit external activation and site evidence",
      "fourteen cutover actions require externally verified release-bound evidence"
    ]),
    boundary: scope.boundary
  });
}

module.exports = {
  DEFAULT_SCOPE_PATH,
  REQUIRED_COMMANDS,
  buildProductionReleaseScopeReport,
  inventory,
  loadDefaultAuthorities,
  uniqueSorted
};
