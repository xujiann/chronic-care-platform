"use strict";

const { EXTENSION_KINDS, VERSION_PATTERN, deepFreeze } = require("./region-manifest");

const ALLOWED_DOMAINS = new Set([
  "runtime",
  "identity-security",
  "platform-governance",
  "state-data",
  "public-health",
  "citizen-chronic",
  "care-coordination",
  "clinical-specialties",
  "insurance-payment",
  "integration",
  "research",
  "shared"
]);
const ALLOWED_DATA_COLLECTIONS = new Set([
  "none",
  "configuration",
  "administrative-divisions",
  "organizations",
  "dictionaries",
  "policy-rules",
  "ui-presentation",
  "integration-metadata",
  "workflow-definitions"
]);

function validateContribution(contribution) {
  if (!contribution || typeof contribution !== "object" || Array.isArray(contribution)) {
    throw new TypeError("regional extension contribution must be an object");
  }
  if (!EXTENSION_KINDS.includes(contribution.kind)) {
    throw new TypeError(`unsupported regional extension kind: ${contribution.kind}`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(String(contribution.id || ""))) {
    throw new TypeError(`invalid regional extension id: ${contribution.id}`);
  }
  if (!VERSION_PATTERN.test(String(contribution.version || ""))) {
    throw new TypeError(`invalid regional extension version: ${contribution.id}`);
  }
  if (!ALLOWED_DOMAINS.has(contribution.ownedDomain)) {
    throw new TypeError(`invalid regional extension ownedDomain: ${contribution.ownedDomain}`);
  }
  if (!Array.isArray(contribution.permissions) || contribution.permissions.some((item) => !/^[a-z][a-z0-9:.-]*$/.test(item))) {
    throw new TypeError(`regional extension ${contribution.id} permissions must be explicit identifiers`);
  }
  if (!Array.isArray(contribution.dataCollections) || contribution.dataCollections.some((item) => !ALLOWED_DATA_COLLECTIONS.has(item))) {
    throw new TypeError(`regional extension ${contribution.id} dataCollections are invalid`);
  }
  if (typeof contribution.provide !== "function") {
    throw new TypeError(`regional extension ${contribution.id} must provide a factory`);
  }
  return contribution;
}

function createRegionalExtensionRegistry() {
  const contributions = new Map();
  let sealed = false;
  return Object.freeze({
    register(contribution) {
      if (sealed) throw new TypeError("regional extension registry is sealed");
      validateContribution(contribution);
      if (contributions.has(contribution.id)) throw new TypeError(`duplicate regional extension registration: ${contribution.id}`);
      contributions.set(contribution.id, Object.freeze({ ...contribution }));
      return this;
    },
    activate(manifestExtensions, context) {
      sealed = true;
      const enabledDeclarations = manifestExtensions.filter((item) => item.enabled);
      const active = enabledDeclarations.map((declaration) => {
        const contribution = contributions.get(declaration.id);
        if (!contribution) throw new TypeError(`enabled regional extension is not registered: ${declaration.id}`);
        if (contribution.kind !== declaration.kind || contribution.version !== declaration.version || contribution.ownedDomain !== declaration.ownedDomain) {
          throw new TypeError(`regional extension declaration mismatch: ${declaration.id}`);
        }
        const declaredPermissions = [...declaration.permissions].sort();
        const registeredPermissions = [...contribution.permissions].sort();
        const declaredCollections = [...declaration.dataCollections].sort();
        const registeredCollections = [...contribution.dataCollections].sort();
        if (JSON.stringify(declaredPermissions) !== JSON.stringify(registeredPermissions)
          || JSON.stringify(declaredCollections) !== JSON.stringify(registeredCollections)) {
          throw new TypeError(`regional extension permission declaration mismatch: ${declaration.id}`);
        }
        const value = contribution.provide(context);
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          throw new TypeError(`regional extension ${declaration.id} factory must return an object`);
        }
        return deepFreeze({
          id: contribution.id,
          kind: contribution.kind,
          version: contribution.version,
          ownedDomain: contribution.ownedDomain,
          permissions: [...contribution.permissions],
          dataCollections: [...contribution.dataCollections],
          value
        });
      });
      const declaredIds = new Set(manifestExtensions.map((item) => item.id));
      const undeclared = [...contributions.keys()].filter((id) => !declaredIds.has(id));
      if (undeclared.length > 0) throw new TypeError(`registered regional extensions are not declared: ${undeclared.join(", ")}`);
      return deepFreeze(active);
    },
    snapshot() {
      return deepFreeze([...contributions.values()].map(({ provide, ...metadata }) => metadata));
    }
  });
}

module.exports = {
  ALLOWED_DATA_COLLECTIONS,
  ALLOWED_DOMAINS,
  createRegionalExtensionRegistry,
  validateContribution
};
