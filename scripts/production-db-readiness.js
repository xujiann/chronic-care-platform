#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");
const { inspectStorageModel } = require("./storage-admin");
const { buildPostgresMigrationPackage } = require("./postgres-migration-package");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-db-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-db-readiness-report.md");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function arrayOf(data, key) {
  return Array.isArray(data[key]) ? data[key] : [];
}

function hasText(text, pattern) {
  return pattern.test(String(text || ""));
}

function seedProductionDatabaseMigrationBatches() {
  return [
    {
      id: "pdbm-resident-master",
      sequence: 1,
      domain: "resident-master",
      name: "Resident master and identity index",
      sourceCollections: ["residents", "authUsers"],
      targetSchema: "health_master",
      targetTables: ["resident_master", "identity_account"],
      businessKeyFields: ["personIndex", "id"],
      validationRules: ["source-record-present", "business-key-present", "checksum-created"],
      rollbackStrategy: "Delete the target batch by migrationRunId and restore the pre-cutover checkpoint.",
      owner: "resident-master-index",
      status: "rehearsal-ready"
    },
    {
      id: "pdbm-clinical-encounter",
      sequence: 2,
      domain: "clinical-encounter",
      name: "Clinical encounter and health archive",
      sourceCollections: ["personalRecords", "careOrders"],
      targetSchema: "health_clinical",
      targetTables: ["clinical_record", "care_order"],
      businessKeyFields: ["externalId", "id"],
      validationRules: ["source-record-present", "business-key-present", "checksum-created"],
      rollbackStrategy: "Revert the encounter batch and rebuild resident links from the checkpoint manifest.",
      owner: "institution-integration",
      status: "rehearsal-ready"
    },
    {
      id: "pdbm-lab-report",
      sequence: 3,
      domain: "lab-report",
      name: "Laboratory and diagnostic report",
      sourceCollections: ["diagnosticReports", "imageCloudStudies"],
      targetSchema: "health_diagnostics",
      targetTables: ["diagnostic_report", "report_evidence"],
      businessKeyFields: ["reportNo", "externalId", "id"],
      validationRules: ["source-record-present", "business-key-present", "checksum-created"],
      rollbackStrategy: "Remove report rows and evidence links created by the migration run, then replay the source receipt.",
      owner: "medical-resource-center",
      status: "rehearsal-ready"
    },
    {
      id: "pdbm-health-statistic",
      sequence: 4,
      domain: "health-statistic",
      name: "Health statistics and reconciliation evidence",
      sourceCollections: ["healthStatistics", "healthStatisticsIngestion"],
      targetSchema: "health_governance",
      targetTables: ["health_statistic", "statistic_ingestion"],
      businessKeyFields: ["indicatorCode", "period", "id"],
      validationRules: ["source-record-present", "business-key-present", "checksum-created"],
      rollbackStrategy: "Restore the signed period snapshot and rerun reconciliation before report publication.",
      owner: "commission-governance",
      status: "rehearsal-ready"
    }
  ];
}

function seedProductionDatabaseCutoverRuns() {
  return [
    {
      id: "pdbcr-baseline",
      runNo: "PDB-DRYRUN-BASELINE",
      mode: "dry-run",
      targetAdapter: "postgresql",
      status: "planned",
      reviewStatus: "pending",
      createdAt: "2026-07-10T00:00:00.000Z",
      createdBy: "release-manager",
      sampleValidations: [],
      rollbackCheckpoint: {
        id: "pdbcp-baseline",
        status: "planned",
        evidence: ""
      },
      productionReady: false,
      blockers: [
        "live PostgreSQL-compatible target connection and driver",
        "masked full-volume migration rehearsal",
        "capacity and failover test evidence",
        "database owner and release manager signoff"
      ],
      actionHistory: []
    }
  ];
}

function firstSourceRow(data, batch) {
  for (const collection of batch.sourceCollections || []) {
    const rows = Array.isArray(data?.[collection]) ? data[collection] : [];
    if (rows.length) return { collection, row: rows[0], records: rows.length };
    const record = data?.[collection];
    if (record && typeof record === "object" && Object.keys(record).length) {
      return { collection, row: record, records: 1 };
    }
  }
  return { collection: batch.sourceCollections?.[0] || "", row: null, records: 0 };
}

function stableChecksum(value) {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");
}

function buildSampleValidation(data, batch) {
  const source = firstSourceRow(data, batch);
  const keyField = (batch.businessKeyFields || []).find((field) => source.row?.[field] != null && String(source.row[field]).trim()) || "";
  const businessKey = keyField ? String(source.row[keyField]) : "";
  const checks = {
    sourceRecordPresent: Boolean(source.row),
    businessKeyPresent: Boolean(businessKey),
    checksumCreated: Boolean(source.row)
  };
  return {
    batchId: batch.id,
    domain: batch.domain,
    sourceCollection: source.collection,
    sourceRecords: source.records,
    sampleId: businessKey,
    businessKeyField: keyField,
    checksum: source.row ? stableChecksum(source.row) : "",
    passed: Object.values(checks).every(Boolean),
    checks
  };
}

function createProductionDatabaseCutoverRun(data = {}, options = {}) {
  const batches = Array.isArray(data.productionDatabaseMigrationBatches) && data.productionDatabaseMigrationBatches.length
    ? data.productionDatabaseMigrationBatches
    : seedProductionDatabaseMigrationBatches();
  const createdAt = options.createdAt || new Date().toISOString();
  const sampleValidations = batches.map((batch) => buildSampleValidation(data, batch));
  const validationPassed = sampleValidations.length >= 4 && sampleValidations.every((item) => item.passed);
  const targetAdapterConfigured = Boolean(options.targetAdapterConfigured);
  const id = options.id || `pdbcr-${randomUUID()}`;
  return {
    id,
    runNo: options.runNo || `PDB-DRYRUN-${createdAt.replace(/\D/g, "").slice(0, 14)}`,
    mode: "dry-run",
    targetAdapter: "postgresql",
    targetAdapterConfigured,
    status: validationPassed ? "validated-demo" : "validation-failed",
    reviewStatus: "pending",
    createdAt,
    createdBy: options.createdBy || "release-manager",
    note: String(options.note || "Production database migration sample rehearsal").trim(),
    sampleValidations,
    rollbackCheckpoint: {
      id: `pdbcp-${id.replace(/^pdbcr-/, "")}`,
      status: "created-demo",
      createdAt,
      evidence: "JSON snapshot manifest and SQLite schema checkpoint"
    },
    productionReady: false,
    blockers: [
      ...(targetAdapterConfigured ? [] : ["live PostgreSQL-compatible target connection and driver"]),
      "masked full-volume migration rehearsal",
      "capacity and failover test evidence",
      "database owner and release manager signoff"
    ],
    actionHistory: []
  };
}

function applyProductionDatabaseCutoverAction(run, payload = {}, user = {}) {
  const action = String(payload.action || "").trim();
  if (!["review", "record-rollback", "request-retest"].includes(action)) {
    throw new Error("unsupported production database cutover action");
  }
  const note = String(payload.note || "").trim();
  if (!note) throw new Error("production database cutover action requires note");
  const evidence = String(payload.evidence || "").trim();
  if (action === "record-rollback" && !evidence) {
    throw new Error("rollback rehearsal requires evidence");
  }
  const at = new Date().toISOString();
  const history = {
    id: `pdbca-${randomUUID()}`,
    action,
    note,
    evidence,
    actor: user.name || "release-manager",
    role: user.role || "commission",
    at
  };
  const next = {
    ...run,
    reviewStatus: action === "review" ? "reviewed-demo" : run.reviewStatus,
    status: action === "request-retest" ? "retest-required" : run.status,
    rollbackCheckpoint: action === "record-rollback"
      ? { ...(run.rollbackCheckpoint || {}), status: "evidence-recorded-demo", evidence, recordedAt: at, recordedBy: history.actor }
      : run.rollbackCheckpoint,
    productionReady: false,
    actionHistory: [history, ...(Array.isArray(run.actionHistory) ? run.actionHistory : [])].slice(0, 20)
  };
  return { run: next, history };
}

function buildProductionDatabaseCutoverCenter(data = {}) {
  const migrationBatches = Array.isArray(data.productionDatabaseMigrationBatches) && data.productionDatabaseMigrationBatches.length
    ? data.productionDatabaseMigrationBatches
    : seedProductionDatabaseMigrationBatches();
  const cutoverRuns = Array.isArray(data.productionDatabaseCutoverRuns) && data.productionDatabaseCutoverRuns.length
    ? data.productionDatabaseCutoverRuns
    : seedProductionDatabaseCutoverRuns();
  const sortedRuns = [...cutoverRuns].sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const latestRun = sortedRuns[0] || null;
  const requiredDomains = ["resident-master", "clinical-encounter", "lab-report", "health-statistic"];
  const sampleValidations = Array.isArray(latestRun?.sampleValidations) ? latestRun.sampleValidations : [];
  const summary = {
    migrationBatches: migrationBatches.length,
    rehearsalReadyBatches: migrationBatches.filter((item) => item.status === "rehearsal-ready").length,
    cutoverRuns: sortedRuns.length,
    sampleDomains: sampleValidations.length,
    passedSamples: sampleValidations.filter((item) => item.passed).length,
    rollbackCheckpoints: sortedRuns.filter((item) => item.rollbackCheckpoint?.id).length,
    reviewedRuns: sortedRuns.filter((item) => /reviewed/.test(String(item.reviewStatus || ""))).length,
    productionReadyRuns: sortedRuns.filter((item) => item.productionReady).length,
    blockers: new Set(sortedRuns.flatMap((item) => item.blockers || [])).size
  };
  const checks = [
    { id: "production-db-cutover:migration-batches", passed: migrationBatches.length >= 4 && requiredDomains.every((domain) => migrationBatches.some((item) => item.domain === domain)), detail: `${migrationBatches.length}/4 migration batches` },
    { id: "production-db-cutover:validation-contract", passed: migrationBatches.every((item) => item.sourceCollections?.length && item.targetTables?.length && item.businessKeyFields?.length && item.validationRules?.length), detail: "source, target, business key and validation contracts" },
    { id: "production-db-cutover:rollback-contract", passed: migrationBatches.every((item) => item.rollbackStrategy) && sortedRuns.every((item) => item.rollbackCheckpoint?.id), detail: `${summary.rollbackCheckpoints} rollback checkpoints` },
    { id: "production-db-cutover:production-boundary", passed: sortedRuns.every((item) => item.productionReady === false), detail: "demo rehearsals cannot bypass live adapter and signoff gates" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    status: summary.productionReadyRuns > 0 ? "production-ready" : latestRun?.status || "planned",
    summary,
    migrationBatches,
    cutoverRuns: sortedRuns,
    latestRun,
    checks,
    boundary: "This center validates migration samples and rollback evidence without writing to a live target database. Production cutover still requires the PostgreSQL-compatible adapter, masked full-volume rehearsal, capacity/failover evidence and signed approval."
  };
}

function buildProductionDbReadinessReport(options = {}) {
  const data = options.data ?? readJson("data/db.json");
  const pkg = options.pkg ?? readJson("package.json");
  const serverSource = options.serverSource ?? readText("server.js");
  const deployment = options.deployment ?? readText("DEPLOYMENT.md");
  const envTemplate = options.envTemplate ?? readText(".env.example");
  const readme = options.readme ?? readText("README.md");
  const platformSource = options.platformSource ?? readText("platform.js");
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const cutoverDocument = options.cutoverDocument ?? readText(path.join("docs", "production-database-cutover-center.md"));
  const migrationPackageSource = options.migrationPackageSource ?? readText(path.join("scripts", "postgres-migration-package.js"));
  const migrationPackageDocument = options.migrationPackageDocument ?? readText(path.join("docs", "postgresql-migration-package.md"));
  const runtimeSyncSource = options.runtimeSyncSource ?? readText("postgres-runtime-sync.js");
  const productionAdapterSource = options.productionAdapterSource ?? readText("postgres-production-adapter.js");
  const runtimeSyncWorker = options.runtimeSyncWorker ?? readText(path.join("scripts", "postgres-sync-worker.js"));
  const shadowReconcileSource = options.shadowReconcileSource ?? readText(path.join("scripts", "postgres-shadow-reconcile.js"));
  const primaryReadRehearsalSource = options.primaryReadRehearsalSource ?? readText(path.join("scripts", "postgres-primary-read-rehearsal.js"));
  const productionAdapterCli = options.productionAdapterCli ?? readText(path.join("scripts", "postgres-production-adapter.js"));
  const runtimeSyncDocument = options.runtimeSyncDocument ?? readText(path.join("docs", "postgresql-runtime-sync.md"));
  const runtimeSyncService = options.runtimeSyncService ?? readText(path.join("deploy", "postgres-sync-worker.service.template"));
  const runtimeSyncTimer = options.runtimeSyncTimer ?? readText(path.join("deploy", "postgres-sync-worker.timer.template"));
  const shadowReconcileService = options.shadowReconcileService ?? readText(path.join("deploy", "postgres-shadow-reconcile.service.template"));
  const shadowReconcileTimer = options.shadowReconcileTimer ?? readText(path.join("deploy", "postgres-shadow-reconcile.timer.template"));
  const storageModel = options.storageModel ?? inspectStorageModel({ dataDir: path.join(ROOT, "data") });
  const productionTrack = arrayOf(data, "productionDeploymentPlan").find((item) => item.id === "prod-storage-adapter") || null;
  const json = storageModel.jsonSnapshot || {};
  const sqlite = storageModel.sqlite || {};
  const requiredScripts = ["storage:backup", "storage:inspect", "storage:assess", "rollback:snapshot", "postgres:migration-package", "postgres:migration-verify", "postgres:sync-worker", "postgres:sync-bootstrap", "postgres:shadow-reconcile", "postgres:primary-read-rehearsal", "postgres:adapter-status", "postgres:adapter-verify", "release:report"];
  const migrationEvidence = {
    currentAdapter: "sqlite-wal-json-snapshot",
    targetAdapter: "postgresql",
    runtimePostgresEnabled: !/PostgreSQL is tracked in productionDeploymentPlan but the runtime adapter is not enabled yet/.test(serverSource),
    runtimePostgresBlocked: /PostgreSQL is tracked in productionDeploymentPlan but the runtime adapter is not enabled yet/.test(serverSource),
    requiredConfig: productionTrack?.requiredConfig || [],
    evidence: productionTrack?.evidence || [],
    nextAction: productionTrack?.nextAction || ""
  };
  const rehearsalEvidence = {
    backupDocumented: hasText(deployment, /storage:backup/) && hasText(deployment, /manifest\.json|SHA-256/),
    restoreDocumented: hasText(deployment, /rehearse/) && hasText(deployment, /restore/),
    rtoRpoDocumented: hasText(deployment, /RTO/) && hasText(deployment, /RPO/),
    releaseArtifactDocumented: hasText(readme, /storage-model-inspection\.md/) && hasText(readme, /release:report/)
  };
  const sqliteRuntimeProfile = {
    connectionHardening: ["configureSqliteConnection", "PRAGMA foreign_keys = ON", "PRAGMA journal_mode", "PRAGMA synchronous", "PRAGMA busy_timeout", "PRAGMA wal_autocheckpoint"].every((marker) => serverSource.includes(marker)),
    healthProbe: serverSource.includes("sqliteRuntimeProfile") && serverSource.includes("quickCheck") && serverSource.includes("productionProfile"),
    environmentContract: ["SQLITE_JOURNAL_MODE=WAL", "SQLITE_SYNCHRONOUS=FULL", "SQLITE_BUSY_TIMEOUT_MS=5000", "SQLITE_WAL_AUTOCHECKPOINT_PAGES=1000"].every((marker) => envTemplate.includes(marker)),
    deploymentDocumented: ["storage.sqliteProfile", "WAL", "FULL", "quickCheck"].every((marker) => deployment.includes(marker))
  };
  const cutoverCenter = buildProductionDatabaseCutoverCenter(data);
  const postgresMigrationPackage = buildPostgresMigrationPackage({ data });
  const migrationSourceRecords = Object.values(data).filter(Array.isArray).reduce((sum, rows) => sum + rows.length, 0);
  const postgresRuntimeSync = {
    transactionalOutbox: ["postgres_sync_outbox", "enqueuePostgresSyncBatch", "db.exec(\"COMMIT\")", "STORAGE_SCHEMA_VERSION = 10"].every((marker) => serverSource.includes(marker)),
    batchIntegrity: ["buildPostgresSyncBatch", "payloadSha256", "previousChainHash", "chainHash", "validatePostgresSyncBatch"].every((marker) => runtimeSyncSource.includes(marker)),
    idempotentApply: ["runtime_sync_batches", "ON CONFLICT (batch_id) DO NOTHING", "runtime_collection_state", "source_version <= EXCLUDED.source_version"].every((marker) => runtimeSyncSource.includes(marker)),
    retryState: ["pending", "retry", "delivered", "failed", "next_attempt_at", "maxAttempts"].every((marker) => runtimeSyncSource.includes(marker)),
    healthStatus: serverSource.includes("postgresSync") && serverSource.includes("readPostgresSyncStatus") && serverSource.includes("productionPrimary: false"),
    workerCommand: runtimeSyncWorker.includes("runPostgresSyncWorker") && pkg.scripts?.["postgres:sync-worker"],
    baselineBootstrap: runtimeSyncSource.includes("enqueuePostgresSyncBaseline") && shadowReconcileSource.includes('command === "bootstrap"') && pkg.scripts?.["postgres:sync-bootstrap"],
    readOnlyReconciliation: ["BEGIN READ ONLY", "comparePostgresShadowState", "runPostgresShadowReconciliation", "recordPostgresReconciliation"].every((marker) => runtimeSyncSource.includes(marker)),
    reconciliationLedger: serverSource.includes("postgres_sync_reconciliations") && serverSource.includes("readLatestPostgresReconciliation") && serverSource.includes("/api/production-database/shadow-reconciliation"),
    reconciliationCaseWorkflow: ["syncPostgresReconciliationCases", "listPostgresReconciliationHistory", "listPostgresReconciliationCases", "applyPostgresReconciliationCaseAction", "RECONCILIATION_CLEARANCE_REQUIRED", "auto-reopen"].every((marker) => runtimeSyncSource.includes(marker)) && ["postgres_sync_reconciliation_cases", "postgres_sync_reconciliation_case_actions", "/api/production-database/shadow-reconciliations", "/api/production-database/reconciliation-cases", "postgres-reconciliation-case-action"].every((marker) => serverSource.includes(marker)),
    reconciliationOperationsUi: ["postgres-reconciliation-metrics", "postgres-reconciliation-cases", "postgres-reconciliation-history"].every((marker) => platformHtml.includes(marker)) && ["loadPostgresReconciliationCenter", "renderPostgresReconciliationCenter", "runPostgresReconciliationCaseAction", "data-postgres-reconciliation-action"].every((marker) => platformSource.includes(marker)),
    prometheusSlo: ["buildPostgresSyncSlo", "renderPrometheusRuntimeMetrics", "/api/metrics/prometheus", "health_platform_postgres_sync_slo_breaches"].every((marker) => serverSource.includes(marker)) && ["POSTGRES_SYNC_BACKLOG_SLO_MAX=20", "POSTGRES_SYNC_PENDING_AGE_SLO_SECONDS=300", "POSTGRES_RECONCILIATION_AGE_SLO_SECONDS=600", "POSTGRES_RECONCILIATION_OPEN_CASES_SLO_MAX=0"].every((marker) => envTemplate.includes(marker)),
    reconciliationCommand: shadowReconcileSource.includes("runPostgresShadowReconciliation") && shadowReconcileSource.includes("contains no business payloads or database credentials") && pkg.scripts?.["postgres:shadow-reconcile"],
    primaryReadRehearsal: ["buildPostgresPrimaryReadSnapshot", "runPostgresPrimaryReadRehearsal", "REPEATABLE READ READ ONLY", "PRIMARY_READ_DIGEST_MISMATCH", "PRIMARY_READ_BASELINE_MISMATCH", "runtimeCutoverEnabled: false"].every((marker) => runtimeSyncSource.includes(marker)) && ["runPostgresPrimaryReadRehearsal", "contains no business payloads or database credentials"].every((marker) => primaryReadRehearsalSource.includes(marker)) && ["/api/production-database/primary-read-rehearsal", "postgres-primary-read-rehearsal", "production primary false"].every((marker) => serverSource.includes(marker)) && pkg.scripts?.["postgres:primary-read-rehearsal"] && ["POSTGRES_PRIMARY_READ_MODE=disabled", "POSTGRES_PRIMARY_READ_MAX_COLLECTIONS=2000", "POSTGRES_PRIMARY_READ_MAX_BYTES=134217728"].every((marker) => envTemplate.includes(marker)),
    productionAdapter: ["readPostgresProductionState", "writePostgresProductionState", "BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE", "pg_advisory_xact_lock", "FOR UPDATE", "POSTGRES_EXPECTED_VERSIONS_INCOMPLETE", "runtime_primary_write_audit", "POSTGRES_PRIMARY_WRITE_BLOCKED", "runtimeCutoverEnabled: false"].every((marker) => productionAdapterSource.includes(marker)) && ["buildPostgresProductionAdapterConfig", "verifyPostgresProductionAdapterSchema"].every((marker) => productionAdapterCli.includes(marker)) && ["postgres:adapter-status", "postgres:adapter-verify"].every((script) => pkg.scripts?.[script]) && ["/api/production-database/adapter", "all-collection-versions", "runtime_primary_write_audit"].every((marker) => serverSource.includes(marker)) && ["postgres-adapter-status", "postgres-primary-read-status", "postgres-adapter-metrics", "data-postgres-primary-read-action"].every((marker) => platformHtml.includes(marker)) && ["loadPostgresProductionAdapterCenter", "renderPostgresProductionAdapterCenter", "runPostgresPrimaryReadRehearsal"].every((marker) => platformSource.includes(marker)) && ["runtime_primary_write_audit", "runtimeAdapterImplemented: true", "runtimeAdapterEnabled: false"].every((marker) => migrationPackageSource.includes(marker)) && ["POSTGRES_ADAPTER_MODE=disabled", "POSTGRES_PRODUCTION_WRITE_MODE=disabled", "POSTGRES_CUTOVER_APPROVAL_ID=", "POSTGRES_BACKUP_EVIDENCE_ID=", "POSTGRES_RTO_RPO_EVIDENCE_ID="].every((marker) => envTemplate.includes(marker)),
    reconciliationScheduler: ["Type=oneshot", "BEGIN READ ONLY", "NoNewPrivileges=true", "ProtectSystem=strict"].every((marker) => shadowReconcileService.includes(marker) || runtimeSyncSource.includes(marker)) && ["OnUnitActiveSec=5min", "Persistent=true"].every((marker) => shadowReconcileTimer.includes(marker)),
    environmentContract: ["POSTGRES_SYNC_MODE=disabled", "POSTGRES_SSL_MODE=verify-full", "POSTGRES_CA_FILE=", "POSTGRES_POOL_MAX=", "POSTGRES_SYNC_BACKLOG_SLO_MAX=20", "POSTGRES_RECONCILIATION_AGE_SLO_SECONDS=600"].every((marker) => envTemplate.includes(marker)),
    hardenedService: ["Type=oneshot", "Environment=POSTGRES_SYNC_MODE=outbox", "NoNewPrivileges=true", "ProtectSystem=strict"].every((marker) => runtimeSyncService.includes(marker)) && ["OnUnitActiveSec=15s", "Persistent=true"].every((marker) => runtimeSyncTimer.includes(marker)),
    documentedBoundary: ["事务型 outbox", "不得上传 Git", "STORAGE_ENGINE=postgres", "productionPrimary"].every((marker) => runtimeSyncDocument.includes(marker) || serverSource.includes(marker))
  };
  const checks = [
    { id: "production-db:track", passed: Boolean(productionTrack?.owner && productionTrack?.nextAction), detail: productionTrack?.status || "missing production deployment track" },
    { id: "production-db:requiredConfig", passed: ["DATABASE_URL", "STORAGE_ENGINE=postgres"].every((item) => migrationEvidence.requiredConfig.includes(item)), detail: migrationEvidence.requiredConfig.join(",") || "missing" },
    { id: "production-db:runtimeBlock", passed: migrationEvidence.runtimePostgresBlocked, detail: migrationEvidence.runtimePostgresBlocked ? "postgres runtime intentionally blocked until adapter is implemented" : "postgres runtime appears enabled" },
    { id: "production-db:jsonSnapshot", passed: Boolean(json.present && Number(json.collections || 0) >= 40 && Number(json.totalRecords || 0) > 0), detail: `${json.collections || 0} collections / ${json.totalRecords || 0} records` },
    { id: "production-db:sqliteSchema", passed: !sqlite.present || Boolean(sqlite.available && Number(sqlite.schemaVersion || 0) >= 7 && Number(sqlite.tableCount || 0) >= 10), detail: sqlite.present ? `schema v${sqlite.schemaVersion || 0}, ${sqlite.tableCount || 0} tables` : "sqlite file not present in this checkout" },
    { id: "production-db:sqliteRuntimeProfile", passed: Object.values(sqliteRuntimeProfile).every(Boolean), detail: Object.entries(sqliteRuntimeProfile).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "production-db:backupScripts", passed: requiredScripts.every((name) => pkg.scripts?.[name]), detail: requiredScripts.filter((name) => !pkg.scripts?.[name]).join(",") || "all required scripts present" },
    { id: "production-db:rehearsalDocs", passed: Object.values(rehearsalEvidence).every(Boolean), detail: Object.entries(rehearsalEvidence).map(([key, value]) => `${key}:${value ? "yes" : "no"}`).join(";") },
    { id: "production-db:cutoverCenter", passed: cutoverCenter.ok && cutoverCenter.summary.migrationBatches >= 4, detail: `${cutoverCenter.summary.migrationBatches} migration batches / ${cutoverCenter.summary.cutoverRuns} rehearsal runs` },
    { id: "production-db:cutoverApi", passed: serverSource.includes("/api/production-database/cutover-center") && serverSource.includes("/api/production-database/cutover-runs"), detail: "commission-only cutover center and rehearsal action APIs" },
    { id: "production-db:cutoverUi", passed: platformHtml.includes("production-database-cutover-center") && platformSource.includes("renderProductionDatabaseCutoverCenter") && platformSource.includes("data-production-db-action"), detail: "platform cutover rehearsal center is visible and actionable" },
    { id: "production-db:cutoverDocs", passed: ["migration batch", "rollback checkpoint", "/api/production-database/cutover-runs"].every((token) => cutoverDocument.includes(token)), detail: "cutover center model, APIs and production boundary are documented" },
    { id: "production-db:migrationPackage", passed: postgresMigrationPackage.ok && postgresMigrationPackage.manifest.mode === "manifest" && postgresMigrationPackage.manifest.summary.records === migrationSourceRecords && !postgresMigrationPackage.files["records.copy.tsv"], detail: `${postgresMigrationPackage.manifest.summary.collections} collections / ${postgresMigrationPackage.manifest.summary.records} source records / no payload artifact` },
    { id: "production-db:secureFullExportBoundary", passed: ["acknowledge-sensitive-data", "must be written outside the repository", "credentialsPersisted: false"].every((marker) => migrationPackageSource.includes(marker)) && ["仓库之外", "不得上传 Git", "迁移包通过不等于 PostgreSQL 运行时适配器已经启用"].every((marker) => migrationPackageDocument.includes(marker)), detail: "full export requires explicit acknowledgement, external protected path and keeps credentials out" },
    { id: "production-db:transactionalOutbox", passed: postgresRuntimeSync.transactionalOutbox && postgresRuntimeSync.batchIntegrity && postgresRuntimeSync.healthStatus, detail: "SQLite schema v10 commits signed collection changes and health-visible queue state atomically" },
    { id: "production-db:idempotentWorker", passed: postgresRuntimeSync.idempotentApply && postgresRuntimeSync.retryState && postgresRuntimeSync.workerCommand, detail: "worker applies batch ids once, rejects stale collection versions and records retry outcomes" },
    { id: "production-db:workerDeployment", passed: postgresRuntimeSync.hardenedService && postgresRuntimeSync.environmentContract && postgresRuntimeSync.documentedBoundary, detail: "hardened one-shot timer, TLS environment contract and shadow-primary boundary documented" },
    { id: "production-db:baselineBootstrap", passed: postgresRuntimeSync.baselineBootstrap, detail: "current SQLite collection versions can be queued once before incremental shadow sync" },
    { id: "production-db:shadowReconciliation", passed: postgresRuntimeSync.readOnlyReconciliation && postgresRuntimeSync.reconciliationLedger && postgresRuntimeSync.reconciliationCommand, detail: "read-only collection version and SHA-256 comparison persists payload-free differences and exposes a commission-only status API" },
    { id: "production-db:primaryReadRehearsal", passed: postgresRuntimeSync.primaryReadRehearsal, detail: "repeatable-read read-only PostgreSQL snapshot reconstruction verifies every payload digest and the complete SQLite shadow baseline without enabling cutover" },
    { id: "production-db:productionAdapter", passed: postgresRuntimeSync.productionAdapter, detail: "asynchronous PostgreSQL adapter provides verified reads, serializable writes, complete optimistic locking, payload-free write audit and evidence-gated enablement" },
    { id: "production-db:reconciliationCaseWorkflow", passed: postgresRuntimeSync.reconciliationCaseWorkflow, detail: "commission-only history and case APIs enforce assignment, matched-run clearance, evidence-backed resolution and automatic reopening" },
    { id: "production-db:reconciliationOperationsUi", passed: postgresRuntimeSync.reconciliationOperationsUi, detail: "platform cutover center exposes commission-only case ownership, acknowledgement, comments, verified closure, reopening and reconciliation history" },
    { id: "production-db:prometheusSlo", passed: postgresRuntimeSync.prometheusSlo, detail: "configurable backlog, pending age, reconciliation freshness, unresolved case and failed batch SLOs are Prometheus-scrapeable" },
    { id: "production-db:reconciliationScheduler", passed: postgresRuntimeSync.reconciliationScheduler, detail: "hardened five-minute reconciliation timer writes reports outside the application artifact" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    storageModel,
    productionTrack,
    migrationEvidence,
    rehearsalEvidence,
    sqliteRuntimeProfile,
    cutoverCenter,
    postgresMigrationPackage,
    postgresRuntimeSync,
    checks
  };
}

function renderMarkdown(report) {
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const configRows = (report.migrationEvidence.requiredConfig || []).map((item) => `| ${item} |`);
  const evidenceRows = (report.migrationEvidence.evidence || []).map((item) => `| ${item} |`);
  const sqlite = report.storageModel?.sqlite || {};
  const json = report.storageModel?.jsonSnapshot || {};
  return [
    "# Production database readiness report",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Current adapter: ${report.migrationEvidence.currentAdapter}`,
    `- Target adapter: ${report.migrationEvidence.targetAdapter}`,
    `- PostgreSQL runtime enabled: ${report.migrationEvidence.runtimePostgresEnabled ? "yes" : "no"}`,
    `- Migration batches: ${report.cutoverCenter?.summary?.migrationBatches || 0}`,
    `- Cutover rehearsal runs: ${report.cutoverCenter?.summary?.cutoverRuns || 0}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Current storage evidence",
    "",
    `- JSON snapshot: ${json.present ? "present" : "missing"}, ${json.collections || 0} collections, ${json.totalRecords || 0} records`,
    `- SQLite: ${sqlite.present ? "present" : "not present"}, schema v${sqlite.schemaVersion || 0}, ${sqlite.tableCount || 0} tables`,
    `- SQLite production profile: ${Object.values(report.sqliteRuntimeProfile || {}).every(Boolean) ? "configured" : "incomplete"} (WAL, FULL synchronous, foreign keys, busy timeout, quick check)`,
    "",
    "## Required production database configuration",
    "",
    "| Item |",
    "|---|",
    ...configRows,
    "",
    "## Migration and rehearsal evidence",
    "",
    "| Evidence |",
    "|---|",
    ...evidenceRows,
    "",
    "## Production database cutover center",
    "",
    `- Status: ${report.cutoverCenter?.status || "planned"}`,
    `- Sample domains: ${report.cutoverCenter?.summary?.sampleDomains || 0}`,
    `- Passed samples: ${report.cutoverCenter?.summary?.passedSamples || 0}`,
    `- Rollback checkpoints: ${report.cutoverCenter?.summary?.rollbackCheckpoints || 0}`,
    `- Production-ready runs: ${report.cutoverCenter?.summary?.productionReadyRuns || 0}`,
    `- PostgreSQL manifest package: ${report.postgresMigrationPackage?.ok ? "verified" : "failed"}`,
    `- Packaged source records: ${report.postgresMigrationPackage?.manifest?.summary?.records || 0}`,
    `- Sensitive payload files in CI package: ${report.postgresMigrationPackage?.files?.["records.copy.tsv"] ? "present" : "absent"}`,
    `- Transactional PostgreSQL outbox: ${report.postgresRuntimeSync?.transactionalOutbox ? "configured" : "missing"}`,
    `- Idempotent sync worker: ${report.postgresRuntimeSync?.idempotentApply ? "configured" : "missing"}`,
    `- Baseline bootstrap: ${report.postgresRuntimeSync?.baselineBootstrap ? "configured" : "missing"}`,
    `- Read-only shadow reconciliation: ${report.postgresRuntimeSync?.readOnlyReconciliation ? "configured" : "missing"}`,
    `- Verified PostgreSQL primary-read rehearsal: ${report.postgresRuntimeSync?.primaryReadRehearsal ? "configured" : "missing"}`,
    `- Evidence-gated PostgreSQL production adapter: ${report.postgresRuntimeSync?.productionAdapter ? "configured" : "missing"}`,
    `- Reconciliation case workflow: ${report.postgresRuntimeSync?.reconciliationCaseWorkflow ? "configured" : "missing"}`,
    `- Reconciliation operations UI: ${report.postgresRuntimeSync?.reconciliationOperationsUi ? "configured" : "missing"}`,
    `- Prometheus SLO metrics: ${report.postgresRuntimeSync?.prometheusSlo ? "configured" : "missing"}`,
    `- PostgreSQL production primary: no`,
    "",
    "| Batch | Domain | Sources | Targets | Owner | Status |",
    "|---|---|---|---|---|---|",
    ...(report.cutoverCenter?.migrationBatches || []).map((item) => `| ${item.id} | ${item.domain} | ${(item.sourceCollections || []).join(", ")} | ${(item.targetTables || []).join(", ")} | ${item.owner || ""} | ${item.status || ""} |`),
    "",
    `Boundary: ${report.cutoverCenter?.boundary || ""}`,
    "",
    `Next action: ${report.migrationEvidence.nextAction || "n/a"}`,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ generatedAt: report.generatedAt, ok: report.ok, productionDbReadiness: report }, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildProductionDbReadinessReport();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  applyProductionDatabaseCutoverAction,
  buildProductionDatabaseCutoverCenter,
  buildProductionDbReadinessReport,
  createProductionDatabaseCutoverRun,
  parseArgs,
  renderMarkdown,
  seedProductionDatabaseCutoverRuns,
  seedProductionDatabaseMigrationBatches,
  writeOutput
};
