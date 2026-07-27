"use strict";

const { createHash } = require("node:crypto");

class CareServiceRepositoryError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message);
    this.name = "CareServiceRepositoryError";
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

function versionFor(state = {}) {
  const versions = state.storageMeta?.collectionVersions || {};
  return createHash("sha256").update(stableStringify(versions)).digest("hex");
}

function createCareServiceStateRepository(dependencies = {}) {
  if (typeof dependencies.readState !== "function" || typeof dependencies.writeState !== "function") {
    throw new CareServiceRepositoryError(
      "CARE_REPOSITORY_DEPENDENCIES_INVALID",
      "care-service repository requires state read and write functions",
      503
    );
  }
  let queue = Promise.resolve();
  return {
    transaction(callback) {
      const run = queue.then(async () => {
        let snapshot = dependencies.readState();
        let version = versionFor(snapshot);
        let written = false;
        return callback({
          async readState() {
            return { state: structuredClone(snapshot), version };
          },
          async writeState(next, options = {}) {
            if (written) {
              throw new CareServiceRepositoryError("CARE_REPOSITORY_MULTIPLE_WRITES", "care-service transaction permits one atomic state write");
            }
            if (options.expectedVersion !== version) {
              throw new CareServiceRepositoryError("CARE_REPOSITORY_VERSION_CONFLICT", "care-service transaction version changed");
            }
            const current = dependencies.readState();
            if (versionFor(current) !== version) {
              throw new CareServiceRepositoryError("CARE_REPOSITORY_VERSION_CONFLICT", "care-service state changed before commit");
            }
            const committed = structuredClone(next);
            committed.storageMeta = snapshot.storageMeta;
            dependencies.writeState(committed, {
              event: `care-service:${String(options.commandId || "command").slice(0, 160)}`,
              collections: Array.isArray(options.collections) ? options.collections : []
            });
            snapshot = dependencies.readState();
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
  CareServiceRepositoryError,
  createCareServiceStateRepository,
  versionFor
};
