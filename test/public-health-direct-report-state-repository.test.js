"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DIRECT_REPORT_COLLECTIONS,
  createPublicHealthDirectReportStateRepository,
  versionFor
} = require("../public-health-direct-report-state-repository");

function durableStorage() {
  let state = {
    accounts: [],
    publicHealthInfectiousReportingCases: [{ id: "case-1", version: 1 }],
    publicHealthInfectiousReportingDeliveries: [],
    storageMeta: {
      engine: "sqlite",
      collectionVersions: {
        accounts: 9,
        publicHealthInfectiousReportingCases: 3,
        publicHealthInfectiousReportingDeliveries: 2
      }
    }
  };
  const writes = [];
  return {
    read() {
      return structuredClone(state);
    },
    write(next, metadata) {
      writes.push({ next: structuredClone(next), metadata: structuredClone(metadata) });
      const currentVersions = state.storageMeta.collectionVersions;
      state = structuredClone(next);
      state.storageMeta = {
        engine: "sqlite",
        collectionVersions: {
          ...currentVersions,
          publicHealthInfectiousReportingCases:
            Number(currentVersions.publicHealthInfectiousReportingCases) + 1,
          publicHealthInfectiousReportingDeliveries:
            Number(currentVersions.publicHealthInfectiousReportingDeliveries) + 1
        }
      };
    },
    mutateRelevant() {
      state.storageMeta.collectionVersions.publicHealthInfectiousReportingDeliveries += 1;
    },
    mutateUnrelated() {
      state.storageMeta.collectionVersions.accounts += 1;
    },
    current() {
      return structuredClone(state);
    },
    writes
  };
}

test("direct-report repository commits only against the two owned collection versions", async () => {
  const storage = durableStorage();
  const repository = createPublicHealthDirectReportStateRepository({
    readState: storage.read,
    writeState: storage.write
  });
  await repository.transaction(async (transaction) => {
    const snapshot = await transaction.readState();
    storage.mutateUnrelated();
    snapshot.state.publicHealthInfectiousReportingDeliveries.push({ id: "delivery-1" });
    await transaction.writeState(snapshot.state, {
      expectedVersion: snapshot.version,
      event: "claim"
    });
  });
  assert.equal(storage.current().publicHealthInfectiousReportingDeliveries.length, 1);
  assert.deepEqual(
    Object.keys(storage.writes[0].next.storageMeta.collectionVersions).sort(),
    [...DIRECT_REPORT_COLLECTIONS].sort()
  );
  assert.deepEqual(storage.writes[0].metadata.collections, [...DIRECT_REPORT_COLLECTIONS]);
  assert.equal(storage.writes[0].metadata.event, "public-health-direct-report:claim");
});

test("direct-report repository fails closed on relevant optimistic version drift", async () => {
  const storage = durableStorage();
  const repository = createPublicHealthDirectReportStateRepository({
    readState: storage.read,
    writeState: storage.write
  });
  await assert.rejects(
    repository.transaction(async (transaction) => {
      const snapshot = await transaction.readState();
      storage.mutateRelevant();
      await transaction.writeState(snapshot.state, {
        expectedVersion: snapshot.version,
        event: "stale-claim"
      });
    }),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_REPOSITORY_VERSION_CONFLICT"
  );
  assert.equal(storage.writes.length, 0);
});

test("direct-report repository requires durable SQLite and releases its queue after failure", async () => {
  const storage = durableStorage();
  const invalidRepository = createPublicHealthDirectReportStateRepository({
    readState: () => ({
      publicHealthInfectiousReportingCases: [],
      publicHealthInfectiousReportingDeliveries: [],
      storageMeta: { engine: "json", collectionVersions: {} }
    }),
    writeState: () => {}
  });
  await assert.rejects(
    invalidRepository.transaction(async () => {}),
    (error) => error.code === "PUBLIC_HEALTH_DIRECT_REPORT_SQLITE_REQUIRED"
  );

  const repository = createPublicHealthDirectReportStateRepository({
    readState: storage.read,
    writeState: storage.write
  });
  await assert.rejects(repository.transaction(async () => {
    throw new Error("expected transaction failure");
  }), /expected transaction failure/);
  const result = await repository.transaction((transaction) => transaction.readState());
  assert.equal(result.state.publicHealthInfectiousReportingCases.length, 1);
  assert.match(versionFor(result.state), /^[a-f0-9]{64}$/);
});
