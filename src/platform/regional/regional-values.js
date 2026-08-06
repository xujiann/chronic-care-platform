"use strict";

const { deepFreeze } = require("./region-manifest");

const ORGANIZATION_FIELDS = Object.freeze(["code", "name", "shortName", "type"]);
const AREA_FIELDS = Object.freeze(["code", "name", "shortName"]);
const MAX_LOCALIZATION_DEPTH = 24;

function assertRuntimeContext(context) {
  if (!context || context.schemaVersion !== "regional-runtime-context-v1" || !context.configs) {
    throw new TypeError("regional values require a regional runtime context");
  }
}

function clonePublicDirectory(source = {}, fields = []) {
  return Object.freeze(Object.fromEntries(Object.entries(source).map(([id, organization]) => [
    id,
    Object.freeze(Object.fromEntries(
      fields
        .filter((field) => typeof organization?.[field] === "string")
        .map((field) => [field, organization[field]])
    ))
  ])));
}

function createRegionalValues(context) {
  assertRuntimeContext(context);
  const organizationConfig = context.configs.organization || {};
  const localizationConfig = context.configs.localization || {};
  const organizations = clonePublicDirectory(organizationConfig.organizations, ORGANIZATION_FIELDS);
  const areas = clonePublicDirectory(context.configs.geography?.areas, AREA_FIELDS);
  const terms = Object.freeze({ ...(localizationConfig.terms || {}) });
  const replacements = Object.freeze({ ...(localizationConfig.legacyReplacements || {}) });
  const orderedReplacements = Object.entries(replacements)
    .filter(([source, target]) => source && typeof target === "string")
    .sort(([left], [right]) => right.length - left.length);

  function organization(id) {
    const value = organizations[id];
    if (!value) throw new TypeError(`unknown regional organization: ${id}`);
    return value;
  }

  function area(id) {
    const value = areas[id];
    if (!value) throw new TypeError(`unknown regional area: ${id}`);
    return value;
  }

  function term(id) {
    if (!Object.prototype.hasOwnProperty.call(terms, id)) {
      throw new TypeError(`unknown regional term: ${id}`);
    }
    return terms[id];
  }

  function localizeString(value) {
    return orderedReplacements.reduce(
      (result, [source, target]) => result.replaceAll(source, target),
      String(value)
    );
  }

  function localize(value, depth = 0) {
    if (depth > MAX_LOCALIZATION_DEPTH) throw new TypeError("regional localization payload is too deeply nested");
    if (typeof value === "string") return localizeString(value);
    if (Array.isArray(value)) return value.map((item) => localize(item, depth + 1));
    if (!value || typeof value !== "object") return value;
    if (value instanceof Date) return new Date(value.getTime());
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, localize(nested, depth + 1)])
    );
  }

  const publicContext = deepFreeze({
    schemaVersion: "regional-public-context-v1",
    regionCode: context.regionCode,
    regionName: context.regionName,
    deploymentClass: context.deploymentClass,
    locale: context.locale,
    timezone: context.timezone,
    administrativeDivision: context.administrativeDivision,
    features: context.features,
    manifestDigest: context.manifestDigest,
    organizations,
    areas,
    terms,
    localization: {
      legacyReplacements: replacements
    },
    productionReady: false
  });

  return Object.freeze({
    context,
    publicContext,
    area,
    organization,
    term,
    localize,
    localizeString
  });
}

module.exports = {
  AREA_FIELDS,
  MAX_LOCALIZATION_DEPTH,
  ORGANIZATION_FIELDS,
  createRegionalValues
};
