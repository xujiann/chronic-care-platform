"use strict";

const { createHash } = require("node:crypto");

const DIRECT_REPORT_COLLECTIONS = Object.freeze([
  "publicHealthInfectiousReportingCases",
  "publicHealthInfectiousReportingDeliveries"
]);

class PublicHealthDirectReportRepositoryError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "PublicHealthDirectReportRepositoryError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function selectedCollectionVersions(state = {}) {
  const versions = state.storageMeta?.collectionVersions || {};
  return Object.fromEntries(DIRECT_REPORT_COLLECTIONS.map((collection) => [
    collection,
    Number(versions[collection] || 0)
  ]));
}

function versionFor(state = {}) {
  const collectionVersions = selectedCollectionVersions(state);
  const missingVersionMetadata = Object.values(collectionVersions).every((value) => value === 0);
  const value = missingVersionMetadata
    ? {
        collectionVersions,
        cases: state.publicHealthInfectiousReportingCases || [],
        deliveries: state.publicHealthInfectiousReportingDeliveries || []
      }
    : { collectionVersions };
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function assertDurableState(state = {}, options = {}) {
  if (options.requireSqlite === false) return;
  const storage = String(state.storageMeta?.engine || "").trim().toLowerCase();
  if (storage !== "sqlite") {
    throw new PublicHealthDirectReportRepositoryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_SQLITE_REQUIRED",
      "direct-report worker requires the SQLite transactional runtime",
      503
    );
  }
}

function stateForWrite(next, snapshot) {
  const committed = structuredClone(next);
  committed.storageMeta = {
    ...(snapshot.storageMeta || {}),
    collectionVersions: selectedCollectionVersions(snapshot)
  };
  return committed;
}

function createPublicHealthDirectReportStateRepository(dependencies = {}, options = {}) {
  if (typeof dependencies.readState !== "function" || typeof dependencies.writeState !== "function") {
    throw new PublicHealthDirectReportRepositoryError(
      "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_DEPENDENCIES_INVALID",
      "direct-report repository requires state read and write functions",
      503
    );
  }
  let queue = Promise.resolve();
  return {
    transaction(callback) {
      if (typeof callback !== "function") {
        throw new PublicHealthDirectReportRepositoryError(
          "PUBLIC_HEALTH_DIRECT_REPORT_TRANSACTION_CALLBACK_REQUIRED",
          "direct-report repository transaction callback is required",
          400
        );
      }
      const run = queue.then(async () => {
        let snapshot = dependencies.readState();
        assertDurableState(snapshot, options);
        let version = versionFor(snapshot);
        let written = false;
        return callback({
          async readState() {
            return { state: structuredClone(snapshot), version };
          },
          async writeState(next, metadata = {}) {
            if (written) {
              throw new PublicHealthDirectReportRepositoryError(
                "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_MULTIPLE_WRITES",
                "direct-report transaction permits one atomic state write"
              );
            }
            if (metadata.expectedVersion !== version) {
              throw new PublicHealthDirectReportRepositoryError(
                "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_VERSION_CONFLICT",
                "direct-report transaction version changed"
              );
            }
            const current = dependencies.readState();
            assertDurableState(current, options);
            if (versionFor(current) !== version) {
              throw new PublicHealthDirectReportRepositoryError(
                "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_VERSION_CONFLICT",
                "direct-report state changed before commit"
              );
            }
            dependencies.writeState(stateForWrite(next, snapshot), {
              event: `public-health-direct-report:${String(metadata.event || "worker-write").slice(0, 120)}`,
              collections: [...DIRECT_REPORT_COLLECTIONS]
            });
            snapshot = dependencies.readState();
            assertDurableState(snapshot, options);
            version = versionFor(snapshot);
            written = true;
            return { version };
          }
        });
      });
      queue = run.catch(() => undefined);
      return run;
    }
  };
}

module.exports = {
  DIRECT_REPORT_COLLECTIONS,
  PublicHealthDirectReportRepositoryError,
  assertDurableState,
  createPublicHealthDirectReportStateRepository,
  selectedCollectionVersions,
  versionFor
};
