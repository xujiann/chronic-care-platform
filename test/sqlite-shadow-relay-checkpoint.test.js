"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  openSqliteCheckpointStore
} = require("../src/platform/operations/sqlite-shadow-relay-checkpoint");

const A = `sha256:${"a".repeat(64)}`;
const B = `sha256:${"b".repeat(64)}`;

test("SQLite checkpoint persists across processes and accepts only exact replay", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "shadow-checkpoint-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, "relay.sqlite");
  const first = openSqliteCheckpointStore({
    file,
    now: () => "2030-08-04T00:00:00.000Z"
  });
  const evidence = {
    relayId: "referral-shadow",
    sequence: 1,
    eventId: "event-1",
    payloadDigest: A,
    relayDigest: B
  };
  assert.equal((await first.save(evidence)).sequence, 1);
  assert.deepEqual(
    { ...(await first.save(evidence)), updatedAt: undefined },
    { ...evidence, updatedAt: undefined }
  );
  await assert.rejects(
    () => first.save({ ...evidence, sequence: 0 }),
    (error) => error.code === "SHADOW_RELAY_CHECKPOINT_REGRESSION"
  );
  await assert.rejects(
    () => first.save({ ...evidence, eventId: "different" }),
    (error) => error.code === "SHADOW_RELAY_CHECKPOINT_CONFLICT"
  );
  await first.close();

  const reopened = openSqliteCheckpointStore({ file });
  assert.equal((await reopened.load("referral-shadow")).eventId, "event-1");
  assert.equal(reopened.credentialsPersisted, false);
  await reopened.close();
});
