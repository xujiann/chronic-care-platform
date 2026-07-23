"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createCareServiceStateRepository } = require("../care-service-state-repository");
const Runtime = require("../care-service-runtime");

function storage(initial = {}) {
  let state = structuredClone({
    internetNursingOrders: [],
    internetNursingOutbox: [],
    ...initial,
    storageMeta: { collectionVersions: { internetNursingOrders: 1, internetNursingOutbox: 1 } }
  });
  return {
    read() {
      return structuredClone(state);
    },
    write(next) {
      state = structuredClone(next);
      state.storageMeta = {
        collectionVersions: {
          internetNursingOrders: Number(state.storageMeta?.collectionVersions?.internetNursingOrders || 0) + 1,
          internetNursingOutbox: Number(state.storageMeta?.collectionVersions?.internetNursingOutbox || 0) + 1
        }
      };
    },
    mutate() {
      state.storageMeta.collectionVersions.internetNursingOrders += 1;
    }
  };
}

test("care-service repository commits one state and outbox transaction with a new version", async () => {
  const persisted = storage();
  const repository = createCareServiceStateRepository({
    readState: persisted.read,
    writeState: persisted.write
  });
  const result = await Runtime.executeTransactionalCommand(
    repository,
    (state) => {
      state.internetNursingOrders.push({ id: "order-1" });
      state.internetNursingOutbox.push({ id: "event-1" });
      return { state, orderId: "order-1" };
    },
    {
      commandId: "repository-test-1",
      collections: ["internetNursingOrders", "internetNursingOutbox"]
    }
  );
  assert.equal(result.committed, true);
  assert.equal(persisted.read().internetNursingOrders.length, 1);
  assert.equal(persisted.read().internetNursingOutbox.length, 1);
});

test("care-service repository fails closed when collection versions change before commit", async () => {
  const persisted = storage();
  const repository = createCareServiceStateRepository({
    readState: persisted.read,
    writeState: persisted.write
  });
  await assert.rejects(
    () => repository.transaction(async (transaction) => {
      const snapshot = await transaction.readState();
      persisted.mutate();
      await transaction.writeState(snapshot.state, {
        expectedVersion: snapshot.version,
        commandId: "repository-conflict"
      });
    }),
    (error) => error.code === "CARE_REPOSITORY_VERSION_CONFLICT"
  );
});

test("care-service repository releases its transaction queue after a rejected command", async () => {
  const persisted = storage();
  const repository = createCareServiceStateRepository({
    readState: persisted.read,
    writeState: persisted.write
  });
  await assert.rejects(() => repository.transaction(async () => {
    throw new Error("expected failure");
  }));
  const result = await repository.transaction(async (transaction) => transaction.readState());
  assert.equal(result.state.internetNursingOrders.length, 0);
});
