#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const defaultCatalog = require("../config/procurement-requirement-governance.json");
const defaultRegistry = require("../config/platform-capability-registry.json");
const defaultOwnership = require("../config/domain-data-ownership.json");
const defaultAuthorization = require("../config/high-risk-api-authorization.json");
const { validateGovernanceCatalog } = require("../src/platform/productization/procurement-requirement-contracts");
const { buildProcurementRequirementGovernance } = require("../src/platform/productization/procurement-requirement-governance");

const ROOT = path.resolve(__dirname, "..");
const ADR_PATH = path.join(ROOT, "docs", "adr", "2026-09-02-procurement-requirement-governance-v2.md");
const ROUTE_PATH = path.join(ROOT, "src", "http", "routes", "platform-governance", "productization-center.js");
const UI_PATHS = Object.freeze([
  path.join(ROOT, "platform.html"),
  path.join(ROOT, "platform-productization-ui.js")
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
const SOURCE_LOCALITY_MARKERS = Object.freeze(["上海", "松江", "武汉", "Shanghai", "Songjiang", "Wuhan"]);
const FORBIDDEN_DATA_KEYS = /^(?:file(?:name|path)?|localPath|raw(?:Text|Document)?|excerpt|prompt|instruction|patient|resident|credential|password|secret|token)$/i;
const REVIEW_ROUTE = "POST /api/platform/productization/requirements/:id/actions";

function check(id, passed, detail) {
  return Object.freeze({ id, passed: Boolean(passed), detail: String(detail || "") });
}

function readText(file) {
  return fs.readFileSync(file, "utf8");
}

function findForbiddenKeys(value, location = "$") {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findForbiddenKeys(item, `${location}[${index}]`));
  return Object.entries(value).flatMap(([key, nested]) => [
    ...(FORBIDDEN_DATA_KEYS.test(key) ? [`${location}.${key}`] : []),
    ...findForbiddenKeys(nested, `${location}.${key}`)
  ]);
}

function localityFindings(texts, markers = SOURCE_LOCALITY_MARKERS) {
  return Object.entries(texts).flatMap(([label, text]) => markers
    .filter((marker) => String(text).toLowerCase().includes(marker.toLowerCase()))
    .map((marker) => `${label}:${marker}`));
}

function buildProcurementRequirementReadiness(options = {}) {
  const root = path.resolve(options.root || ROOT);
  const catalog = options.catalog || defaultCatalog;
  const registry = options.registry || defaultRegistry;
  const ownership = options.ownership || defaultOwnership;
  const authorization = options.authorization || defaultAuthorization;
  const adrText = options.adrText ?? readText(path.join(root, path.relative(ROOT, ADR_PATH)));
  const routeText = options.routeText ?? readText(path.join(root, path.relative(ROOT, ROUTE_PATH)));
  const uiTexts = options.uiTexts || Object.fromEntries(UI_PATHS.map((file) => [path.basename(file), readText(path.join(root, path.relative(ROOT, file)))]));
  const checks = [];

  try {
    validateGovernanceCatalog(catalog, { registry, rootDir: root });
    checks.push(check("requirements:contracts", true, `${catalog.documents.length} documents / ${registry.capabilities.length} registered capabilities`));
  } catch (error) {
    checks.push(check("requirements:contracts", false, error.message));
  }

  let view;
  try {
    view = buildProcurementRequirementGovernance({}, { catalog, registry, rootDir: root, now: "readiness-snapshot" });
    const failClosed = view.productionReady === false
      && view.documents.every((item) => item.productionReady === false)
      && view.items.every((item) => item.productionReady === false && item.gap.productionReady === false);
    checks.push(check("requirements:production-boundary", failClosed, failClosed ? "all governance and gap projections remain production NO-GO" : "a governance projection can claim production readiness"));
  } catch (error) {
    checks.push(check("requirements:production-boundary", false, error.message));
  }

  const forbiddenKeys = findForbiddenKeys(catalog);
  checks.push(check("requirements:minimized-source-data", forbiddenKeys.length === 0, forbiddenKeys.length ? forbiddenKeys.join(", ") : "no raw document, filename, local path, prompt, identity or credential fields"));

  const adrSections = REQUIRED_ADR_SECTIONS.filter((section) => new RegExp(`^## ${section}$`, "m").test(adrText));
  checks.push(check("requirements:adr", adrSections.length === REQUIRED_ADR_SECTIONS.length && /状态：Accepted/.test(adrText), `${adrSections.length}/${REQUIRED_ADR_SECTIONS.length} required sections; accepted=${/状态：Accepted/.test(adrText)}`));

  const locality = localityFindings({ ADR: adrText, ...uiTexts });
  checks.push(check("requirements:generic-language", locality.length === 0, locality.length ? locality.join(", ") : "new ADR and workbench UI contain no source-locality markers"));

  const owned = ownership.collections?.procurementRequirementGovernance;
  checks.push(check("requirements:state-ownership", owned?.owner === "platform-governance" && owned?.classification === "internal", owned ? `${owned.owner}/${owned.classification}` : "collection is not registered"));

  const auth = authorization.routes?.[REVIEW_ROUTE];
  checks.push(check("requirements:review-authorization", auth?.roles?.length === 1 && auth.roles[0] === "commission" && auth.owner === "T02", auth ? `${auth.owner}; roles=${auth.roles?.join(",")}` : "review route is not registered"));

  const noUploadSurface = !/procurement-document-import|multipart|formdata|upload/i.test(routeText);
  checks.push(check("requirements:offline-import-boundary", noUploadSurface, noUploadSurface ? "HTTP route does not expose PDF upload or importer execution" : "HTTP route appears to expose document import or upload"));

  const ok = checks.every((item) => item.passed);
  return Object.freeze({
    schemaVersion: "procurement-requirement-readiness-v1",
    ok,
    status: ok ? "local-governance-ready" : "governance-blocked",
    localGovernanceReady: ok,
    productionReady: false,
    summary: Object.freeze({
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      failed: checks.filter((item) => !item.passed).length,
      documents: view?.summary?.documents || 0,
      candidates: view?.summary?.candidates || 0
    }),
    checks: Object.freeze(checks),
    boundary: "该门禁只验证仓库内的最小化合同、通用性、授权登记和失败关闭边界；不扫描恶意文件，不证明提取质量、现场验收或生产就绪。"
  });
}

function runCli() {
  const report = buildProcurementRequirementReadiness();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: "PROCUREMENT_REQUIREMENT_READINESS_FAILED", message: error.message })}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  ADR_PATH,
  FORBIDDEN_DATA_KEYS,
  REQUIRED_ADR_SECTIONS,
  REVIEW_ROUTE,
  SOURCE_LOCALITY_MARKERS,
  buildProcurementRequirementReadiness,
  findForbiddenKeys,
  localityFindings
};
