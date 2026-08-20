"use strict";

const assert = require("node:assert/strict");
const { randomBytes } = require("node:crypto");
const test = require("node:test");

const { AuthSecurityStateStore, PostgresAtomicDocumentRepository } = require("../auth-security-state-store");
const {
  applyPostgresSyncBatch,
  buildPostgresSyncBatch,
  probePostgresInfrastructure
} = require("../postgres-runtime-sync");
const { schemaSql } = require("../scripts/postgres-migration-package");

const POSTGRES_URL = String(process.env.POSTGRES_URL || "").trim();
const liveTest = POSTGRES_URL ? test : test.skip;

liveTest("real PostgreSQL contract enforces shared auth state, schema health and shadow CAS", async (t) => {
  const { Pool } = require("pg");
  const schema = `contract_${process.pid}_${randomBytes(4).toString("hex")}`;
  assert.match(schema, /^[a-z_][a-z0-9_]{0,62}$/);
  const pool = new Pool({
    connectionString: POSTGRES_URL,
    max: 6,
    ssl: String(process.env.POSTGRES_CONTRACT_SSL_MODE || "disable").toLowerCase() === "disable" ? false : { rejectUnauthorized: true }
  });
  t.after(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await pool.end();
  });
  await pool.query(schemaSql({ schema }));

  const probe = await probePostgresInfrastructure({ pool, schema });
  assert.equal(probe.ok, true, JSON.stringify(probe));
  assert.equal(probe.verifiedTables, 4);

  const authStore = new AuthSecurityStateStore({
    repository: new PostgresAtomicDocumentRepository({ pool, schema }),
    keySecret: "live-postgres-contract-key-secret-at-least-32-characters"
  });
  const rateResults = await Promise.all(Array.from({ length: 12 }, () => authStore.consumeRateLimit({
    subject: "contract-network-source",
    purpose: "phone-login",
    limit: 5,
    windowMs: 60000
  })));
  assert.equal(rateResults.filter((item) => item.allowed).length, 5);
  assert.equal(Math.max(...rateResults.map((item) => item.count)), 12);

  const digest = "a".repeat(64);
  await authStore.issueVerificationCode({ subject: "contract-subject", purpose: "otp", codeDigest: digest });
  const consumes = await Promise.all(Array.from({ length: 6 }, () => authStore.verifyAndConsumeCode({
    subject: "contract-subject",
    purpose: "otp",
    codeDigest: digest
  })));
  assert.equal(consumes.filter((item) => item.verified).length, 1);

  const first = buildPostgresSyncBatch([{ collection: "contract_settings", operation: "upsert", sourceVersion: 7, payload: { enabled: true } }]);
  const firstClient = await pool.connect();
  try {
    assert.equal((await applyPostgresSyncBatch(firstClient, first, { schema })).applied, true);
  } finally {
    firstClient.release();
  }
  const duplicateClient = await pool.connect();
  try {
    assert.equal((await applyPostgresSyncBatch(duplicateClient, first, { schema })).duplicate, true);
  } finally {
    duplicateClient.release();
  }

  const equalVersionDrift = buildPostgresSyncBatch([{ collection: "contract_settings", operation: "upsert", sourceVersion: 7, payload: { enabled: false } }]);
  const driftClient = await pool.connect();
  try {
    await assert.rejects(() => applyPostgresSyncBatch(driftClient, equalVersionDrift, { schema }), { code: "POSTGRES_SYNC_VERSION_CONFLICT" });
  } finally {
    driftClient.release();
  }
  const equalVersionDelete = buildPostgresSyncBatch([{ collection: "contract_settings", operation: "delete", sourceVersion: 7 }]);
  const deleteClient = await pool.connect();
  try {
    await assert.rejects(() => applyPostgresSyncBatch(deleteClient, equalVersionDelete, { schema }), { code: "POSTGRES_SYNC_VERSION_CONFLICT" });
  } finally {
    deleteClient.release();
  }
  const persisted = await pool.query(`SELECT payload, source_version FROM ${schema}.runtime_collection_state WHERE collection_name = $1`, ["contract_settings"]);
  assert.deepEqual(persisted.rows[0].payload, { enabled: true });
  assert.equal(Number(persisted.rows[0].source_version), 7);
});
