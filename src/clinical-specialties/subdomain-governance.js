"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ROUTE_SUBDOMAINS } = require("../http/route-subdomains");
const { routeImplementationSourceRecords } = require("../http/runtime-source");

const EXPECTED_SUBDOMAINS = Object.freeze([
  "emergency",
  "blood",
  "imaging",
  "physical-examination",
  "quality-safety"
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function unique(values) {
  return [...new Set(values)];
}

function listJavaScriptFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  });
}

function extractApiPaths(source) {
  return unique(source.match(/\/api\/[A-Za-z0-9_./:-]+/g) || []).sort();
}

function matchesPrefix(apiPath, prefix) {
  return apiPath === prefix || apiPath.startsWith(`${prefix}/`);
}

function loadClinicalSubdomainRegistry(root = path.resolve(__dirname, "..", "..")) {
  return readJson(path.join(root, "config", "clinical-subdomains.json"));
}

function validateClinicalSubdomainRegistry(root, registry = loadClinicalSubdomainRegistry(root)) {
  const issues = [];
  let routeImplementationSourceCount = 0;
  try {
    routeImplementationSourceCount = routeImplementationSourceRecords(root, registry).length;
  } catch (error) {
    issues.push(error.message);
  }
  const subdomains = Array.isArray(registry.subdomains) ? registry.subdomains : [];
  const ids = subdomains.map((item) => item.id);
  const idSet = new Set(ids);
  const legacyAreas = Array.isArray(registry.legacyRouteAreas) ? registry.legacyRouteAreas : [];
  const legacyIds = new Set(legacyAreas.map((item) => item.id));
  const contractIds = new Set((registry.crossSubdomainContracts || []).map((contract) => contract.id));
  const implementedUseCases = [];

  if (registry.domain !== "clinical-specialties" || registry.processOwner !== "T06") {
    issues.push("registry must describe the T06 clinical-specialties domain");
  }
  if (registry.architecture !== "modular-monolith" || registry.independentDeploymentAuthorized !== false) {
    issues.push("registry must preserve the shared modular-monolith deployment boundary");
  }
  if (JSON.stringify(ids) !== JSON.stringify(EXPECTED_SUBDOMAINS)) {
    issues.push(`subdomain order must be ${EXPECTED_SUBDOMAINS.join(",")}`);
  }
  if (idSet.size !== EXPECTED_SUBDOMAINS.length) issues.push("subdomain ids must be unique");

  const owners = subdomains.map((item) => item.owner);
  if (new Set(owners).size !== owners.length || owners.some((owner) => !String(owner).startsWith("T06/"))) {
    issues.push("each subdomain must have one unique T06 owner");
  }

  const prefixOwners = [];
  const targetSourceRoots = [];
  subdomains.forEach((subdomain) => {
    (subdomain.routePrefixes || []).forEach((prefix) => prefixOwners.push({ id: subdomain.id, prefix }));
    targetSourceRoots.push(subdomain.targetSourceRoot);
    if (!String(subdomain.targetSourceRoot || "").startsWith("src/clinical-specialties/")) {
      issues.push(`${subdomain.id} target source root is outside clinical-specialties`);
    }
    (subdomain.implementedUseCases || []).forEach((useCase) => {
      implementedUseCases.push({ ...useCase, owner: subdomain.id });
      if (!/\.v\d+$/.test(useCase.id || "")) {
        issues.push(`${useCase.id || "use case"} must have a versioned id`);
      }
      if (!String(useCase.source || "").startsWith(`${subdomain.targetSourceRoot}/`)) {
        issues.push(`${useCase.id} source is outside ${subdomain.id}`);
      } else if (!fs.existsSync(path.join(root, useCase.source))) {
        issues.push(`${useCase.id} source does not exist`);
      }
      if (!/^[A-Z]+ \/api\//.test(useCase.route || "")) {
        issues.push(`${useCase.id} must declare an HTTP method and API path`);
      }
      if (!Array.isArray(useCase.ports) || useCase.ports.length === 0) {
        issues.push(`${useCase.id} must declare its ports`);
      }
      (useCase.contracts || []).forEach((contractId) => {
        if (!contractIds.has(contractId)) issues.push(`${useCase.id} references unknown contract ${contractId}`);
      });
      if (!Array.isArray(useCase.sideEffects)) {
        issues.push(`${useCase.id} must declare side effects explicitly`);
      }
    });
  });
  legacyAreas.forEach((area) => {
    (area.routePrefixes || []).forEach((prefix) => prefixOwners.push({ id: area.id, prefix }));
  });
  if (new Set(prefixOwners.map((entry) => entry.prefix)).size !== prefixOwners.length) {
    issues.push("route prefixes must be unique");
  }
  if (new Set(targetSourceRoots).size !== targetSourceRoots.length) {
    issues.push("target source roots must be unique");
  }
  if (new Set(implementedUseCases.map((item) => item.id)).size !== implementedUseCases.length) {
    issues.push("implemented use case ids must be unique");
  }
  prefixOwners.forEach((entry, index) => {
    prefixOwners.slice(index + 1).forEach((other) => {
      if (matchesPrefix(entry.prefix, other.prefix) || matchesPrefix(other.prefix, entry.prefix)) {
        issues.push(`route prefixes overlap: ${entry.prefix} and ${other.prefix}`);
      }
    });
  });

  const routeRoot = path.join(root, registry.routeSourceRoot || "");
  const routeInventory = [];
  listJavaScriptFiles(routeRoot).forEach((file) => {
    extractApiPaths(fs.readFileSync(file, "utf8")).forEach((apiPath) => {
      const matches = prefixOwners.filter((entry) => matchesPrefix(apiPath, entry.prefix));
      const routeFile = path.basename(file, ".js");
      if (matches.length !== 1) {
        issues.push(`${apiPath} in ${routeFile} has ${matches.length} governance owners`);
        return;
      }
      const assignment = registry.routeSubcontextAssignments?.[routeFile];
      if (!assignment || !(assignment.owners || []).includes(matches[0].id)) {
        issues.push(`${routeFile} does not declare ${matches[0].id} for ${apiPath}`);
      }
      routeInventory.push({ apiPath, owner: matches[0].id, routeFile });
    });
  });
  subdomains.forEach((subdomain) => {
    const sourceRoot = path.join(root, subdomain.targetSourceRoot || "");
    listJavaScriptFiles(sourceRoot)
      .filter((file) => /(?:^|[\\/])http-handler\.js$/.test(file))
      .forEach((file) => {
        extractApiPaths(fs.readFileSync(file, "utf8")).forEach((apiPath) => {
          const matches = prefixOwners.filter((entry) => matchesPrefix(apiPath, entry.prefix));
          if (matches.length !== 1 || matches[0].id !== subdomain.id) {
            issues.push(`${apiPath} in ${path.relative(root, file)} is outside ${subdomain.id} route ownership`);
            return;
          }
          routeInventory.push({
            apiPath,
            owner: subdomain.id,
            routeFile: path.relative(root, file).replace(/\\/g, "/")
          });
        });
      });
  });
  implementedUseCases.forEach((useCase) => {
    const apiPath = String(useCase.route || "").split(" ")[1];
    if (!routeInventory.some((route) => route.owner === useCase.owner && route.apiPath === apiPath)) {
      issues.push(`${useCase.id} route is not owned by ${useCase.owner}`);
    }
  });

  const registeredSubcontexts = Object.entries(ROUTE_SUBDOMAINS)
    .filter(([segmentId]) => segmentId.startsWith("clinical-specialties-"))
    .map(([, subcontext]) => subcontext)
    .sort();
  const assignedSubcontexts = Object.keys(registry.routeSubcontextAssignments || {}).sort();
  if (JSON.stringify(registeredSubcontexts) !== JSON.stringify(assignedSubcontexts)) {
    issues.push("route subcontext assignments must cover the current clinical route registry exactly");
  }
  Object.entries(registry.routeSubcontextAssignments || {}).forEach(([subcontext, assignment]) => {
    (assignment.owners || []).forEach((owner) => {
      if (!idSet.has(owner) && !legacyIds.has(owner)) issues.push(`${subcontext} has unknown owner ${owner}`);
    });
  });

  const ownership = readJson(path.join(root, "config", "domain-data-ownership.json"));
  const claimedCollections = new Map();
  subdomains.forEach((subdomain) => {
    [...(subdomain.registeredCollections || []), ...(subdomain.candidateCollections || [])].forEach((collection) => {
      if (claimedCollections.has(collection)) {
        issues.push(`${collection} is claimed by both ${claimedCollections.get(collection)} and ${subdomain.id}`);
      } else {
        claimedCollections.set(collection, subdomain.id);
      }
    });
    (subdomain.registeredCollections || []).forEach((collection) => {
      if (ownership.collections?.[collection]?.owner !== "clinical-specialties") {
        issues.push(`${collection} is not registered to clinical-specialties in the central ownership registry`);
      }
    });
  });
  const quality = subdomains.find((item) => item.id === "quality-safety");
  if (quality?.writeBoundary !== "quality-owned-only" || (quality?.externalReadCollections || []).length !== 0) {
    issues.push("quality-safety must keep a quality-owned write model and use contracts for other subdomains");
  }

  const allowedInteractions = new Set(registry.sourceRules?.crossSubdomainAccess || []);
  (registry.crossSubdomainContracts || []).forEach((contract) => {
    if (!/\.v\d+$/.test(contract.id || "") || !/^\d+\.\d+\.\d+$/.test(contract.version || "")) {
      issues.push(`${contract.id || "contract"} must be versioned`);
    }
    const providers = contract.providers || [];
    const consumers = contract.consumers || [];
    [...providers, ...consumers].forEach((participant) => {
      if (!idSet.has(participant)) issues.push(`${contract.id} has unknown participant ${participant}`);
    });
    if (providers.length === 0 || consumers.length === 0 || providers.some((provider) => consumers.includes(provider))) {
      issues.push(`${contract.id} must separate non-empty providers and consumers`);
    }
    if (!allowedInteractions.has(contract.interaction)) {
      issues.push(`${contract.id} uses disallowed interaction ${contract.interaction}`);
    }
    if (!Array.isArray(contract.requiredFields) || contract.requiredFields.length === 0) {
      issues.push(`${contract.id} must declare required fields`);
    }
  });

  const targetRoots = new Map(subdomains.map((item) => [item.id, path.join(root, item.targetSourceRoot)]));
  listJavaScriptFiles(path.join(root, "src", "clinical-specialties")).forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    if (registry.sourceRules?.forbidServerDependency && /require\(["'][^"']*server(?:\.js)?["']\)/.test(source)) {
      issues.push(`${path.relative(root, file)} depends on server.js`);
    }
    const sourceOwner = [...targetRoots].find(([, directory]) => file.startsWith(`${directory}${path.sep}`))?.[0];
    if (!sourceOwner || !registry.sourceRules?.forbidCrossSubdomainImplementationImports) return;
    [...targetRoots].forEach(([targetOwner, directory]) => {
      if (targetOwner === sourceOwner) return;
      const relativeTarget = path.relative(path.dirname(file), directory).replace(/\\/g, "/");
      if (source.includes(`require("${relativeTarget}`) || source.includes(`require('${relativeTarget}`)) {
        issues.push(`${path.relative(root, file)} imports ${targetOwner} implementation directly`);
      }
    });
  });

  const routeCounts = Object.fromEntries(
    [...idSet, ...legacyIds].map((id) => [id, routeInventory.filter((item) => item.owner === id).length])
  );
  return Object.freeze({
    ok: issues.length === 0,
    issues: Object.freeze(issues),
    routeCounts: Object.freeze(routeCounts),
    routeLiteralCount: routeInventory.length,
    registeredCollectionCount: subdomains.reduce((sum, item) => sum + (item.registeredCollections || []).length, 0),
    candidateCollectionCount: subdomains.reduce((sum, item) => sum + (item.candidateCollections || []).length, 0),
    contractCount: (registry.crossSubdomainContracts || []).length,
    routeImplementationSourceCount
  });
}

if (require.main === module) {
  const root = path.resolve(__dirname, "..", "..");
  const report = validateClinicalSubdomainRegistry(root);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

module.exports = {
  EXPECTED_SUBDOMAINS,
  extractApiPaths,
  loadClinicalSubdomainRegistry,
  matchesPrefix,
  validateClinicalSubdomainRegistry
};
