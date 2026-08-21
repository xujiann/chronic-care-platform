"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ownership = require("../config/domain-data-ownership.json");
const contracts = require("../config/cross-domain-contracts.json");
const dataContract = require("../config/regional-sharing-access-data-contract.json");
const processWorkstreams = require("../config/process-workstreams.json");
const { assertReadAccess, assertWriteAccess } = require("../src/platform/data/domain-repository");
const { PLATFORM_WRITE_CONTRACTS } = require("../src/http/routes/t02-state-ownership-contract");

const ROOT = path.resolve(__dirname, "..");

test("regional sharing collections have one T02 owner and authorization is consumed through an explicit contract", () => {
  for (const collection of [
    "regionalDataSharingScope",
    "regionalSharingPackages",
    "regionalSharingSnapshots",
    "regionalSharingAccessReviews"
  ]) {
    assert.equal(ownership.collections[collection].owner, "platform-governance", collection);
  }
  assert.equal(assertReadAccess("platform-governance", "personalRecords").owner, "citizen-chronic");
  assert.equal(assertWriteAccess("platform-governance", "regionalSharingPackages").classification, "restricted");
  assert.equal(assertWriteAccess("platform-governance", "regionalSharingAccessReviews").classification, "restricted");
  assert.deepEqual(PLATFORM_WRITE_CONTRACTS["regional-sharing-access-command"].collections, {
    dataAccessLogs: "platform-governance",
    regionalSharingAccessReviews: "platform-governance",
    regionalSharingPackages: "platform-governance",
    securityEvents: "platform-governance"
  });

  const authorizationContract = contracts.contracts.find((item) => item.id === "resident-authorization-decision.v1");
  const receiptContract = contracts.contracts.find((item) => item.id === "regional-sharing-access-receipt.v1");
  assert.equal(authorizationContract.owner, "citizen-chronic");
  assert.deepEqual(authorizationContract.consumers, ["platform-governance"]);
  assert.equal(receiptContract.owner, "platform-governance");
});

test("promotion evidence keeps frozen SQLite DDL unchanged and production cutover closed", () => {
  assert.equal(dataContract.owner, "platform-governance");
  assert.equal(dataContract.process, "T02");
  assert.equal(dataContract.integrationOwner, "T00");
  assert.equal(dataContract.migration.physicalSchemaChange, false);
  assert.equal(dataContract.migration.sqliteMigrationRequired, false);
  assert.equal(dataContract.migration.productionCutoverAuthorized, false);
  assert.equal(dataContract.migration.atomicRepositoryReady, false);
  assert.equal(dataContract.writeContract.appendOnlyHistory, true);
  assert.equal(dataContract.writeContract.legacyFullStateWrite, "omit-or-deep-equal");
  assert.equal(dataContract.writeContract.legacyCollectionWriteAllowed, false);
  assert.equal(dataContract.writeContract.productionResetAllowed, false);
  assert.equal(dataContract.productionReady, false);
});

test("legacy route remains in shared-05 while command logic has no composition-root dependency or client decision input", () => {
  const commandSource = fs.readFileSync(path.join(ROOT, "src/platform/governance/regional-sharing-access-command.js"), "utf8");
  const authorizationAdapterSource = fs.readFileSync(path.join(ROOT, "src/platform/governance/resident-authorization-decision-adapter.js"), "utf8");
  const routeSource = fs.readFileSync(path.join(ROOT, "src/http/routes/shared.js"), "utf8");
  const routeIndexSource = fs.readFileSync(path.join(ROOT, "src/http/routes/index.js"), "utf8");
  const stateDataSource = fs.readFileSync(path.join(ROOT, "src/http/routes/state-data.js"), "utf8");
  const runtimeSource = fs.readFileSync(path.join(ROOT, "src/http/runtime-contexts/shared.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  const readinessSource = fs.readFileSync(path.join(ROOT, "scripts/regional-data-sharing.js"), "utf8");

  assert.doesNotMatch(commandSource, /require\s*\(\s*["'][^"']*server(?:\.js)?["']\s*\)/);
  assert.doesNotMatch(commandSource, /payload\.(?:decision|consentStatus|note)/);
  assert.doesNotMatch(commandSource, /source\.personalRecords|record\?\.meta/);
  assert.match(authorizationAdapterSource, /data\?\.personalRecords/);
  assert.match(commandSource, /productionCutoverAuthorized === true/);
  assert.match(commandSource, /atomicRepository === true/);
  assert.match(commandSource, /READY_PACKAGE_STATUSES/);
  assert.match(commandSource, /function projectRegionalSharingAccessResponse/);
  assert.match(commandSource, /function projectRegionalSharingReadResponse/);
  assert.match(routeSource, /projectRegionalSharingAccessResponse\(result\.body\)/);
  assert.match(routeSource, /projectRegionalSharingReadResponse\(buildRegionalDataSharingView/);
  assert.match(routeSource, /withRegionalSharingPackageWriteLock/);
  assert.match(routeIndexSource, /atomicRepositoryReady:\s*false/);
  assert.match(routeIndexSource, /productionCutoverAuthorized:\s*regionalSharingAccessDataContract\.migration\.productionCutoverAuthorized === true/);
  assert.match(stateDataSource, /REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_CONFLICT/);
  assert.match(stateDataSource, /REGIONAL_SHARING_SERVER_MANAGED_COLLECTION_WRITE_DENIED/);
  assert.match(stateDataSource, /\.\.\.serverManagedRegionalState\(currentData\)/);
  assert.match(stateDataSource, /DEMO_RESET_DISABLED_IN_PRODUCTION/);
  assert.match(routeSource, /id: "shared-05"[\s\S]*POST" && url\.pathname === "\/api\/regional-data-sharing\/access-reviews"/);
  assert.match(routeSource, /target: "regional-sharing-access"[\s\S]*detail: result\.body\.code/);
  assert.doesNotMatch(runtimeSource, /createRegionalSharingAccessReview/);
  assert.doesNotMatch(serverSource, /function createRegionalSharingAccessReview/);
  assert.match(readinessSource, /productionReady: false/);
  assert.match(readinessSource, /postgresql-atomic-command-repository/);

  const protectedOwner = (file) => processWorkstreams.protectedPaths.find((item) => item.pattern === file)?.owner;
  assert.equal(protectedOwner("src/platform/governance/regional-sharing-access-command.js"), "T00");
  assert.equal(protectedOwner("src/platform/governance/resident-authorization-decision-adapter.js"), "T00");
});
