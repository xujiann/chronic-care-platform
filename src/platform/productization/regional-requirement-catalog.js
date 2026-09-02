"use strict";

const defaultCatalog = require("../../../config/regional-requirement-catalog.json");
const defaultBundleCatalog = require("../../../config/regional-capability-bundles.json");
const defaultCapabilityRegistry = require("../../../config/platform-capability-registry.json");
const { validateCapabilityRegistry } = require("./procurement-requirement-contracts");

const PRODUCT_CLASSES = new Set(["CORE", "SHARED", "PACKAGE", "CONFIG", "DEPLOY"]);
const DECISIONS = new Set(["REUSE", "ENHANCE", "BUILD", "CONFIGURE", "DEPLOY"]);
const PRIORITIES = new Set(["P0", "P1", "P2"]);
const STATUSES = new Set(["normalized", "owner-review", "planned", "accepted", "deferred"]);
const EVIDENCE_STATUSES = new Set(["research-normalized", "provisional", "source-verified"]);
const SOURCE_KEYS = new Set(["id", "regionCode", "regionName", "projectName", "tenderNo", "procurementYear", "documentRef", "evidenceStatus"]);
const REQUIREMENT_KEYS = new Set([
  "id",
  "sourceId",
  "sourceLocations",
  "title",
  "targetCapabilityIds",
  "productClass",
  "secondaryClasses",
  "decision",
  "priority",
  "ownerProcess",
  "ownerDependencies",
  "bundleIds",
  "status",
  "evidenceStatus"
]);

function assertExactKeys(label, value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length) throw new TypeError(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

function boundedText(label, value, maximum, minimum = 1) {
  const text = String(value || "").trim();
  if (text.length < minimum || text.length > maximum || /[\u0000-\u001f]/.test(text)) throw new TypeError(`${label} must be bounded text`);
  return text;
}

function opaqueId(label, value, maximum = 96) {
  const text = boundedText(label, value, maximum, 4);
  if (!/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(text)) throw new TypeError(`${label} must be an opaque identifier`);
  return text;
}

function uniqueArray(label, value, options = {}) {
  if (!Array.isArray(value) || value.length < (options.minimum ?? 0) || value.length > (options.maximum ?? 20)) {
    throw new TypeError(`${label} must be a bounded array`);
  }
  const normalized = value.map((item, index) => options.normalize(item, index));
  if (new Set(normalized).size !== normalized.length) throw new TypeError(`${label} must contain unique values`);
  return normalized;
}

function registeredBundleIds(bundleCatalog = defaultBundleCatalog) {
  if (bundleCatalog?.schemaVersion !== "regional-capability-bundles-v1") throw new TypeError("regional capability bundle catalog is invalid");
  const ids = [
    bundleCatalog.core?.id,
    ...(Array.isArray(bundleCatalog.regional) ? bundleCatalog.regional.map((item) => item?.id) : []),
    ...(Array.isArray(bundleCatalog.institution) ? bundleCatalog.institution.map((item) => item?.id) : [])
  ].filter(Boolean);
  if (ids.some((id) => !/^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/.test(id)) || new Set(ids).size !== ids.length) throw new TypeError("regional capability bundle ids are invalid");
  return new Set(ids);
}

function validateSource(source, index) {
  const label = `sources[${index}]`;
  assertExactKeys(label, source, SOURCE_KEYS);
  opaqueId(`${label}.id`, source.id);
  if (!/^\d{6}$/.test(String(source.regionCode || ""))) throw new TypeError(`${label}.regionCode must use six digits`);
  boundedText(`${label}.regionName`, source.regionName, 40);
  boundedText(`${label}.projectName`, source.projectName, 160);
  opaqueId(`${label}.tenderNo`, source.tenderNo, 64);
  if (!Number.isInteger(source.procurementYear) || source.procurementYear < 2000 || source.procurementYear > 2100) throw new TypeError(`${label}.procurementYear is invalid`);
  const documentRef = boundedText(`${label}.documentRef`, source.documentRef, 180);
  if (/[/\\]|^[A-Za-z]:/.test(documentRef)) throw new TypeError(`${label}.documentRef must be a logical reference, not a file path`);
  if (!EVIDENCE_STATUSES.has(source.evidenceStatus)) throw new TypeError(`${label}.evidenceStatus is invalid`);
}

function validateRequirement(requirement, index, sourceIds, bundleIds, capabilityIds) {
  const label = `requirements[${index}]`;
  assertExactKeys(label, requirement, REQUIREMENT_KEYS);
  opaqueId(`${label}.id`, requirement.id);
  const sourceId = opaqueId(`${label}.sourceId`, requirement.sourceId);
  if (!sourceIds.has(sourceId)) throw new TypeError(`${label}.sourceId is not registered`);
  uniqueArray(`${label}.sourceLocations`, requirement.sourceLocations, {
    minimum: 1,
    maximum: 8,
    normalize: (value, locationIndex) => {
      const location = boundedText(`${label}.sourceLocations[${locationIndex}]`, value, 120);
      if (/^[A-Za-z]:[\\/]|^\\\\|OneDrive/i.test(location)) throw new TypeError(`${label}.sourceLocations must not contain a local path`);
      return location;
    }
  });
  boundedText(`${label}.title`, requirement.title, 120);
  uniqueArray(`${label}.targetCapabilityIds`, requirement.targetCapabilityIds, {
    minimum: 1,
    maximum: 8,
    normalize: (value, capabilityIndex) => opaqueId(`${label}.targetCapabilityIds[${capabilityIndex}]`, value, 96)
  });
  if (requirement.targetCapabilityIds.some((capabilityId) => !capabilityIds.has(capabilityId))) throw new TypeError(`${label}.targetCapabilityIds contains an unregistered capability`);
  if (!PRODUCT_CLASSES.has(requirement.productClass)) throw new TypeError(`${label}.productClass is invalid`);
  uniqueArray(`${label}.secondaryClasses`, requirement.secondaryClasses, {
    maximum: 4,
    normalize: (value) => {
      if (!PRODUCT_CLASSES.has(value)) throw new TypeError(`${label}.secondaryClasses contains an invalid value`);
      return value;
    }
  });
  if (requirement.secondaryClasses.includes(requirement.productClass)) throw new TypeError(`${label}.secondaryClasses must not repeat productClass`);
  if (!DECISIONS.has(requirement.decision)) throw new TypeError(`${label}.decision is invalid`);
  if (!PRIORITIES.has(requirement.priority)) throw new TypeError(`${label}.priority is invalid`);
  if (!/^T(?:0\d)$/.test(String(requirement.ownerProcess || ""))) throw new TypeError(`${label}.ownerProcess is invalid`);
  uniqueArray(`${label}.ownerDependencies`, requirement.ownerDependencies, {
    maximum: 9,
    normalize: (value) => {
      const owner = String(value || "");
      if (!/^T(?:0\d)$/.test(owner)) throw new TypeError(`${label}.ownerDependencies contains an invalid owner`);
      return owner;
    }
  });
  if (requirement.ownerDependencies.includes(requirement.ownerProcess)) throw new TypeError(`${label}.ownerDependencies must not repeat ownerProcess`);
  uniqueArray(`${label}.bundleIds`, requirement.bundleIds, {
    maximum: 8,
    normalize: (value, bundleIndex) => opaqueId(`${label}.bundleIds[${bundleIndex}]`, value, 96)
  });
  if (requirement.bundleIds.some((bundleId) => !bundleIds.has(bundleId))) throw new TypeError(`${label}.bundleIds contains an unregistered bundle`);
  if (!STATUSES.has(requirement.status)) throw new TypeError(`${label}.status is invalid`);
  if (!EVIDENCE_STATUSES.has(requirement.evidenceStatus)) throw new TypeError(`${label}.evidenceStatus is invalid`);
}

function validateRegionalRequirementCatalog(catalog = defaultCatalog, options = {}) {
  assertExactKeys("catalog", catalog, new Set(["schemaVersion", "catalogId", "sources", "requirements"]));
  if (catalog.schemaVersion !== "regional-requirement-catalog-v1") throw new TypeError("regional requirement catalog is invalid");
  opaqueId("catalogId", catalog.catalogId);
  if (!Array.isArray(catalog.sources) || catalog.sources.length < 1 || catalog.sources.length > 100) throw new TypeError("regional requirement catalog sources are invalid");
  if (!Array.isArray(catalog.requirements) || catalog.requirements.length < 1 || catalog.requirements.length > 2000) throw new TypeError("regional requirement catalog requirements are invalid");
  catalog.sources.forEach(validateSource);
  const sourceIds = new Set(catalog.sources.map((source) => source.id));
  const bundleIds = registeredBundleIds(options.bundleCatalog);
  const capabilityRegistry = options.capabilityRegistry || defaultCapabilityRegistry;
  validateCapabilityRegistry(capabilityRegistry, options);
  const capabilityIds = new Set(capabilityRegistry.capabilities.map((item) => item.id));
  if (sourceIds.size !== catalog.sources.length) throw new TypeError("regional requirement source ids must be unique");
  catalog.requirements.forEach((requirement, index) => validateRequirement(requirement, index, sourceIds, bundleIds, capabilityIds));
  if (new Set(catalog.requirements.map((requirement) => requirement.id)).size !== catalog.requirements.length) throw new TypeError("regional requirement ids must be unique");
  return true;
}

function countBy(items, key) {
  return Object.freeze(items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {}));
}

function buildRegionalRequirementCatalog(options = {}) {
  const catalog = options.catalog || defaultCatalog;
  validateRegionalRequirementCatalog(catalog, options);
  const sourceCounts = catalog.requirements.reduce((counts, item) => {
    counts.set(item.sourceId, (counts.get(item.sourceId) || 0) + 1);
    return counts;
  }, new Map());
  const sources = catalog.sources.map((source) => Object.freeze({
    id: source.id,
    regionCode: source.regionCode,
    regionName: source.regionName,
    projectName: source.projectName,
    tenderNo: source.tenderNo,
    procurementYear: source.procurementYear,
    documentRef: source.documentRef,
    evidenceStatus: source.evidenceStatus,
    requirements: sourceCounts.get(source.id) || 0,
    productionReady: false
  }));
  const items = catalog.requirements.map((item) => Object.freeze({
    id: item.id,
    sourceId: item.sourceId,
    sourceLocations: Object.freeze([...item.sourceLocations]),
    title: item.title,
    targetCapabilityIds: Object.freeze([...item.targetCapabilityIds]),
    productClass: item.productClass,
    secondaryClasses: Object.freeze([...item.secondaryClasses]),
    decision: item.decision,
    priority: item.priority,
    ownerProcess: item.ownerProcess,
    ownerDependencies: Object.freeze([...item.ownerDependencies]),
    bundleIds: Object.freeze([...item.bundleIds]),
    status: item.status,
    evidenceStatus: item.evidenceStatus,
    productionReady: false
  }));
  const ownerBacklog = [...new Set(items.map((item) => item.ownerProcess))].sort().map((ownerProcess) => {
    const owned = items.filter((item) => item.ownerProcess === ownerProcess);
    return Object.freeze({
      ownerProcess,
      requirements: owned.length,
      p0: owned.filter((item) => item.priority === "P0").length,
      reviewRequired: owned.filter((item) => ["normalized", "owner-review"].includes(item.status)).length,
      requirementIds: Object.freeze(owned.map((item) => item.id)),
      productionReady: false
    });
  });
  return Object.freeze({
    schemaVersion: "regional-requirement-catalog-view-v1",
    generatedAt: options.now || new Date().toISOString(),
    ok: true,
    productionReady: false,
    containsBusinessPayload: false,
    containsCredentials: false,
    summary: Object.freeze({
      sources: sources.length,
      requirements: items.length,
      p0: items.filter((item) => item.priority === "P0").length,
      ownerReview: items.filter((item) => ["normalized", "owner-review"].includes(item.status)).length,
      mappedCapabilities: new Set(items.flatMap((item) => item.targetCapabilityIds)).size,
      ownerProcesses: ownerBacklog.length,
      productClasses: countBy(items, "productClass"),
      decisions: countBy(items, "decision")
    }),
    sources: Object.freeze(sources),
    items: Object.freeze(items),
    ownerBacklog: Object.freeze(ownerBacklog),
    boundary: "地区采购需求仅作为脱敏、只读的产品规划元数据；Owner评审、能力交付、现场证据与生产授权均保持失败关闭。"
  });
}

module.exports = {
  DECISIONS,
  EVIDENCE_STATUSES,
  PRIORITIES,
  PRODUCT_CLASSES,
  STATUSES,
  buildRegionalRequirementCatalog,
  registeredBundleIds,
  validateRegionalRequirementCatalog
};
