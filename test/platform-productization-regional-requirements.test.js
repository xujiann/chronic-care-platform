"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const catalog = require("../config/regional-requirement-catalog.json");
const {
  buildRegionalRequirementCatalog,
  validateRegionalRequirementCatalog
} = require("../src/platform/productization/regional-requirement-catalog");

test("regional requirement catalog projects nineteen Songjiang requirements without production claims", () => {
  const report = buildRegionalRequirementCatalog({ now: "2026-09-01T00:00:00.000Z" });
  assert.equal(validateRegionalRequirementCatalog(catalog), true);
  assert.equal(report.ok, true);
  assert.equal(report.productionReady, false);
  assert.equal(report.containsBusinessPayload, false);
  assert.equal(report.containsCredentials, false);
  assert.equal(report.summary.sources, 1);
  assert.equal(report.summary.requirements, 19);
  assert.equal(report.summary.ownerReview, 19);
  assert.equal(report.sources[0].regionCode, "310117");
  assert.equal(report.sources[0].requirements, 19);
  assert.equal(report.items.every((item) => item.status === "normalized" && item.productionReady === false), true);
  assert.equal(report.ownerBacklog.reduce((total, owner) => total + owner.requirements, 0), 19);
  assert.equal(Object.isFrozen(report), true);
  assert.equal(Object.isFrozen(report.items), true);
  assert.equal(Object.isFrozen(report.items[0].targetCapabilityIds), true);
  assert.doesNotMatch(JSON.stringify(report), /OneDrive|C:\\Users|credential|password|patientName/);
});

test("regional requirement catalog distinguishes source-verified and research-normalized evidence", () => {
  const report = buildRegionalRequirementCatalog({ now: "2026-09-01T00:00:00.000Z" });
  const supervision = report.items.find((item) => item.id.endsWith("R009"));
  assert.equal(supervision.evidenceStatus, "source-verified");
  assert.match(supervision.sourceLocations.join(" "), /73-79/);
  assert.equal(report.items.filter((item) => item.evidenceStatus === "source-verified").length, 1);
  assert.equal(report.items.filter((item) => item.evidenceStatus === "research-normalized").length, 18);
});

test("regional requirement catalog rejects unknown fields, duplicate ids and unregistered sources", () => {
  const unknown = structuredClone(catalog);
  unknown.requirements[0].patientName = "must-not-enter-catalog";
  assert.throws(() => validateRegionalRequirementCatalog(unknown), /unknown fields/);

  const duplicate = structuredClone(catalog);
  duplicate.requirements[1].id = duplicate.requirements[0].id;
  assert.throws(() => validateRegionalRequirementCatalog(duplicate), /ids must be unique/);

  const unregistered = structuredClone(catalog);
  unregistered.requirements[0].sourceId = "SRC-UNKNOWN-2026-01";
  assert.throws(() => validateRegionalRequirementCatalog(unregistered), /sourceId is not registered/);
});

test("regional requirement catalog rejects local paths and invalid governance enums", () => {
  const localPath = structuredClone(catalog);
  localPath.sources[0].documentRef = "C:\\Users\\operator\\procurement.pdf";
  assert.throws(() => validateRegionalRequirementCatalog(localPath), /logical reference/);

  const invalidClass = structuredClone(catalog);
  invalidClass.requirements[0].productClass = "CUSTOM";
  assert.throws(() => validateRegionalRequirementCatalog(invalidClass), /productClass is invalid/);

  const invalidOwner = structuredClone(catalog);
  invalidOwner.requirements[0].ownerProcess = "T10";
  assert.throws(() => validateRegionalRequirementCatalog(invalidOwner), /ownerProcess is invalid/);

  const locationPath = structuredClone(catalog);
  locationPath.requirements[0].sourceLocations = ["C:\\Users\\operator\\source.pdf"];
  assert.throws(() => validateRegionalRequirementCatalog(locationPath), /must not contain a local path/);

  const unregisteredBundle = structuredClone(catalog);
  unregisteredBundle.requirements[0].bundleIds = ["unregistered-bundle-v1"];
  assert.throws(() => validateRegionalRequirementCatalog(unregisteredBundle), /unregistered bundle/);
});
