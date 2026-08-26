#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const {
  buildProductionReleaseScopeReport,
  loadDefaultAuthorities: loadProductionReleaseScopeAuthorities
} = require("../src/platform/governance/production-release-scope");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-deployment-package.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-deployment-package.md");
const ALLOWED_RUNTIME_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".svg", ".webmanifest"]);
const AUDIT_DELIVERY_RUNTIME_FILES = [
  "scripts/audit-delivery-worker.js",
  "scripts/audit-delivery-preflight.js",
  "src/platform/operations/audit-delivery.js",
  "src/identity-security/audit-chain.js",
  "src/identity-security/audit-delivery-source.js",
  "src/platform/cutover/pilot-cutover-alert-lifecycle.js",
  "src/platform/governance/technical-evidence.js",
  "deploy/audit-delivery-worker.service.template",
  "deploy/audit-delivery-worker.timer.template",
  "deploy/platform-production-adapters.env.template"
];
const CHRONIC_FOLLOWUP_DISPATCH_RUNTIME_FILES = [
  "scripts/chronic-followup-dispatch-worker.js",
  "src/citizen-chronic/followup-dispatch-outbox.js",
  "src/citizen-chronic/followup-dispatch-worker.js",
  "src/citizen-chronic/followup-dispatch-activation-provider.js",
  "src/citizen-chronic/followup-event-publisher.js",
  "deploy/chronic-followup-dispatch-worker.service.template",
  "deploy/chronic-followup-dispatch-worker.timer.template",
  "deploy/chronic-followup-dispatch-worker.env.template"
];
const PRODUCTION_EVIDENCE_TRUST_RUNTIME_FILES = [
  "scripts/production-preflight.js",
  "scripts/production-cutover-action-register.js",
  "scripts/production-release-evidence-readiness.js",
  "src/platform/governance/production-evidence-trust-provider.js"
];
const WORKER_OBSERVABILITY_RUNTIME_FILES = [
  "config/worker-observability-contract.json",
  "src/platform/operations/worker-observability-contract.js"
];
const PRODUCTION_RELEASE_SCOPE_RUNTIME_FILES = [
  "config/production-release-scope.json"
];
const POSTGRES_TRANSITION_RUNTIME_FILES = [
  "postgres-runtime-sync.js",
  "postgres-production-adapter.js",
  "src/platform/storage/postgres-primary-storage-contract.js",
  "src/platform/storage/postgres-primary-driver.js",
  "scripts/postgres-primary-transition-readiness.js",
  "scripts/postgres-migration-package.js",
  "scripts/postgres-primary-read-rehearsal.js",
  "scripts/postgres-production-adapter.js",
  "scripts/storage-admin.js",
  "src/platform/data/public-demo-snapshot.js",
  "scripts/postgres-sync-worker.js",
  "scripts/postgres-shadow-reconcile.js",
  "deploy/postgres-primary-storage-schema.sql",
  "deploy/postgres-sync-worker.service.template",
  "deploy/postgres-sync-worker.timer.template",
  "deploy/postgres-shadow-reconcile.service.template",
  "deploy/postgres-shadow-reconcile.timer.template",
  "deploy/platform-production-adapters.env.template"
];
const POSTGRES_TRANSITION_CONFIGURATION_VARIABLES = Object.freeze([
  "POSTGRES_PRIMARY_TRANSITION_INPUT_FILE",
  "POSTGRES_PRIMARY_TRANSITION_INPUT_SHA256",
  "POSTGRES_PRIMARY_STORAGE_MODE",
  "POSTGRES_SYNC_MODE",
  "POSTGRES_PRIMARY_READ_MODE",
  "POSTGRES_ADAPTER_MODE",
  "POSTGRES_PRODUCTION_WRITE_MODE",
  "POSTGRES_SSL_MODE",
  "POSTGRES_CA_FILE",
  "POSTGRES_SCHEMA",
  "POSTGRES_POOL_MAX",
  "POSTGRES_SYNC_BACKLOG_SLO_MAX",
  "POSTGRES_SYNC_PENDING_AGE_SLO_SECONDS",
  "POSTGRES_RECONCILIATION_AGE_SLO_SECONDS",
  "POSTGRES_RECONCILIATION_OPEN_CASES_SLO_MAX",
  "POSTGRES_PRIMARY_READ_MAX_COLLECTIONS",
  "POSTGRES_PRIMARY_READ_MAX_BYTES",
  "POSTGRES_PRIMARY_POOL_MAX",
  "POSTGRES_PRIMARY_CONNECT_TIMEOUT_MS",
  "POSTGRES_PRIMARY_IDLE_TIMEOUT_MS",
  "POSTGRES_PRIMARY_APPLICATION_NAME",
  "POSTGRES_SCHEMA_EVIDENCE_ID",
  "POSTGRES_MIGRATION_EVIDENCE_ID",
  "POSTGRES_RECONCILIATION_EVIDENCE_ID",
  "POSTGRES_BACKUP_EVIDENCE_ID",
  "POSTGRES_RTO_RPO_EVIDENCE_ID",
  "POSTGRES_ROLLBACK_EVIDENCE_ID",
  "POSTGRES_CUTOVER_APPROVAL_ID"
]);
const POSTGRES_SYNC_JOB_VARIABLES = Object.freeze([
  "POSTGRES_SYNC_MODE",
  "POSTGRES_SSL_MODE",
  "POSTGRES_CA_FILE",
  "POSTGRES_SCHEMA",
  "POSTGRES_POOL_MAX"
]);
const POSTGRES_RECONCILIATION_JOB_VARIABLES = Object.freeze([
  ...POSTGRES_SYNC_JOB_VARIABLES,
  "POSTGRES_RECONCILIATION_AGE_SLO_SECONDS",
  "POSTGRES_RECONCILIATION_OPEN_CASES_SLO_MAX"
]);
const PREPRODUCTION_CONTROL_RUNTIME_FILES = Object.freeze([
  "scripts/platform-preproduction-control.js",
  "src/platform/cutover/pilot-cutover-package.js",
  "src/platform/cutover/preproduction-environment-readiness.js",
  "src/platform/cutover/pilot-cutover-rehearsal-session.js",
  "src/platform/cutover/pilot-cutover-candidate-review.js",
  "src/platform/cutover/pilot-cutover-command-plan.js",
  "src/platform/cutover/pilot-cutover-rehearsal.js",
  "src/platform/cutover/pilot-cutover-orchestrator.js",
  "src/platform/cutover/pilot-cutover-alert-lifecycle.js",
  "src/platform/cutover/pilot-cutover-monitoring-acceptance.js",
  "src/platform/cutover/pilot-cutover-trust-verifier.js",
  "src/platform/governance/production-evidence-trust-provider.js",
  "src/platform/integration/external-joint-test-campaign.js",
  "src/platform/governance/technical-evidence.js",
  "observability-alerting.js",
  "config/external-joint-test-campaign.json",
  "config/platform-iteration-program.json",
  "deploy/platform-production-adapters.env.template"
]);
const PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES = Object.freeze([
  "DEPLOYMENT_RELEASE_ID",
  "DEPLOYMENT_ARTIFACT_DIGEST",
  "PLATFORM_PREPRODUCTION_ENVIRONMENT_EVIDENCE_FILE",
  "PLATFORM_EXTERNAL_JOINT_TEST_CAMPAIGN_FILE",
  "PLATFORM_EXTERNAL_JOINT_TEST_TRUST_REGISTRY_FILE",
  "PLATFORM_EXTERNAL_JOINT_TEST_EVIDENCE_FILE",
  "PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE",
  "PLATFORM_PILOT_CUTOVER_MONITORING_ACCEPTANCE_FILE",
  "PLATFORM_PILOT_CUTOVER_REHEARSAL_SESSION_FILE",
  "PLATFORM_PILOT_CUTOVER_AUTHORIZATION_REPORT_FILE",
  "PLATFORM_PILOT_CUTOVER_PREPRODUCTION_REPORT_FILE",
  "PLATFORM_PILOT_CUTOVER_JOINT_TEST_REPORT_FILE",
  "PLATFORM_PILOT_CUTOVER_MONITORING_REPORT_FILE",
  "PLATFORM_PILOT_CUTOVER_REHEARSAL_REPORT_FILE",
  "PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE",
  "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256"
]);
const PREPRODUCTION_CONTROL_DEFINITIONS = Object.freeze([{
  id: "environment",
  command: "npm run platform:preproduction:environment -- --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready",
  configurationVariables: [
    "DEPLOYMENT_RELEASE_ID",
    "DEPLOYMENT_ARTIFACT_DIGEST",
    "PLATFORM_PREPRODUCTION_ENVIRONMENT_EVIDENCE_FILE"
  ]
}, {
  id: "joint-test",
  command: "npm run platform:preproduction:joint-test -- --campaign=<absolute-file> --trust-registry=<absolute-file> --evidence=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready",
  configurationVariables: [
    "DEPLOYMENT_RELEASE_ID",
    "DEPLOYMENT_ARTIFACT_DIGEST",
    "PLATFORM_EXTERNAL_JOINT_TEST_CAMPAIGN_FILE",
    "PLATFORM_EXTERNAL_JOINT_TEST_TRUST_REGISTRY_FILE",
    "PLATFORM_EXTERNAL_JOINT_TEST_EVIDENCE_FILE"
  ]
}, {
  id: "monitoring",
  command: "npm run platform:preproduction:monitoring -- --journal=<absolute-file> --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready",
  configurationVariables: [
    "DEPLOYMENT_RELEASE_ID",
    "DEPLOYMENT_ARTIFACT_DIGEST",
    "PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE",
    "PLATFORM_PILOT_CUTOVER_MONITORING_ACCEPTANCE_FILE"
  ]
}, {
  id: "rehearsal",
  command: "npm run platform:preproduction:rehearsal -- --input=<absolute-file> --release-id=<release-id> --package-fingerprint=<sha256> --require-ready",
  configurationVariables: [
    "DEPLOYMENT_RELEASE_ID",
    "DEPLOYMENT_ARTIFACT_DIGEST",
    "PLATFORM_PILOT_CUTOVER_REHEARSAL_SESSION_FILE"
  ]
}, {
  id: "candidate",
  command: "npm run platform:preproduction:candidate -- --authorization=<signed-envelope> --preproduction=<signed-envelope> --joint-tests=<signed-envelope> --monitoring=<signed-envelope> --rehearsal=<signed-envelope> --release-id=<release-id> --package-fingerprint=<sha256> --require-go-candidate",
  configurationVariables: [
    "DEPLOYMENT_RELEASE_ID",
    "DEPLOYMENT_ARTIFACT_DIGEST",
    "PLATFORM_PILOT_CUTOVER_AUTHORIZATION_REPORT_FILE",
    "PLATFORM_PILOT_CUTOVER_PREPRODUCTION_REPORT_FILE",
    "PLATFORM_PILOT_CUTOVER_JOINT_TEST_REPORT_FILE",
    "PLATFORM_PILOT_CUTOVER_MONITORING_REPORT_FILE",
    "PLATFORM_PILOT_CUTOVER_REHEARSAL_REPORT_FILE",
    "PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE",
    "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256"
  ]
}]);
const REQUIRED_RUNTIME_FILES = [
  "server.js",
  "browser-security-policy.json",
  "src/http/api-router.js",
  "src/http/routes/index.js",
  "session-store.js",
  "package.json",
  "package-lock.json",
  "service-worker.js",
  "manifest.webmanifest",
  ...POSTGRES_TRANSITION_RUNTIME_FILES,
  ...AUDIT_DELIVERY_RUNTIME_FILES,
  ...CHRONIC_FOLLOWUP_DISPATCH_RUNTIME_FILES,
  ...PRODUCTION_EVIDENCE_TRUST_RUNTIME_FILES,
  ...WORKER_OBSERVABILITY_RUNTIME_FILES,
  ...PRODUCTION_RELEASE_SCOPE_RUNTIME_FILES,
  ...PREPRODUCTION_CONTROL_RUNTIME_FILES
];
const ADDITIONAL_RUNTIME_FILES = [
  "browser-security-policy.json",
  "config/regions.json",
  ...POSTGRES_TRANSITION_RUNTIME_FILES,
  ...AUDIT_DELIVERY_RUNTIME_FILES,
  ...CHRONIC_FOLLOWUP_DISPATCH_RUNTIME_FILES,
  ...PRODUCTION_EVIDENCE_TRUST_RUNTIME_FILES,
  ...WORKER_OBSERVABILITY_RUNTIME_FILES,
  ...PRODUCTION_RELEASE_SCOPE_RUNTIME_FILES,
  ...PREPRODUCTION_CONTROL_RUNTIME_FILES
];
const RUNTIME_DIRECTORIES = ["src/http", "src/platform/regional", "src/platform/storage", "regions"];
const EXCLUDED_RUNTIME_FILES = new Set(["playwright.config.js"]);

const SECRET_CONTRACT = [
  ["SESSION_SECRETS", "session signing and rotation"],
  ["INTEGRATION_GATEWAY_SECRET", "integration callback signing"],
  ["OIDC_CLIENT_SECRET", "identity provider client authentication"],
  ["SMS_GATEWAY_TOKEN", "resident SMS provider authentication"],
  ["SMS_DELIVERY_CALLBACK_SECRET", "resident SMS delivery callback verification"],
  ["HOSPITAL_ADAPTER_SECRET", "hospital connector signing"],
  ["OBJECT_STORAGE_SIGNING_SECRET", "object storage request signing"],
  ["OBJECT_STORAGE_RECEIPT_SIGNING_SECRET", "object storage gateway response verification"],
  ["FINANCIAL_GATEWAY_SECRET", "payment insurance and certificate signing"],
  ["FINANCIAL_CALLBACK_SECRET", "payment insurance and certificate callback verification"],
  ["SIEM_SIGNING_SECRET", "SIEM alert signing"],
  ["SIEM_AUDIT_SIGNING_SECRET", "continuous audit request signing"],
  ["CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET", "chronic followup external dispatch and receipt verification"],
  ["ALERT_WEBHOOK_SECRET", "operations webhook signing"],
  ["DATABASE_URL", "PostgreSQL connection secret"],
  ["DEPLOYMENT_ARTIFACT_DIGEST", "immutable artifact registry digest"]
].map(([name, purpose]) => ({
  name,
  purpose,
  requiredInProduction: true,
  injection: "vault-kms-or-orchestrator-environment",
  persistedInArtifact: false
}));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizePath(value) {
  return String(value || "").replaceAll("\\", "/");
}

function collectRuntimeDirectoryFiles(root, relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  if (!fs.existsSync(absoluteDirectory)) return [];
  return fs.readdirSync(absoluteDirectory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return collectRuntimeDirectoryFiles(root, relativePath);
    if (!entry.isFile() || !ALLOWED_RUNTIME_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) return [];
    return [normalizePath(relativePath)];
  });
}

function collectRuntimeFiles(root = ROOT) {
  const rootFiles = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .filter((name) => {
      if (EXCLUDED_RUNTIME_FILES.has(name)) return false;
      if (["package.json", "package-lock.json"].includes(name)) return true;
      if (path.extname(name).toLowerCase() === ".json") return false;
      return ALLOWED_RUNTIME_EXTENSIONS.has(path.extname(name).toLowerCase());
    })
  const directoryFiles = RUNTIME_DIRECTORIES.flatMap((directory) => collectRuntimeDirectoryFiles(root, directory));
  return [...new Set([
    ...rootFiles,
    ...directoryFiles,
    ...ADDITIONAL_RUNTIME_FILES.filter((name) => fs.existsSync(path.join(root, name)))
  ])].sort();
}

function fileEvidence(root, relativePath) {
  const absolutePath = path.join(root, relativePath);
  const bytes = fs.readFileSync(absolutePath);
  return {
    path: normalizePath(relativePath),
    size: bytes.length,
    sha256: sha256(bytes)
  };
}

function gitMetadata(root = ROOT, runtimeFiles = collectRuntimeFiles(root)) {
  const run = (args) => spawnSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  const commitResult = run(["rev-parse", "HEAD"]);
  const statusResult = run(["status", "--porcelain", "--untracked-files=all", "--", ...runtimeFiles]);
  return {
    commit: commitResult.status === 0 ? commitResult.stdout.trim() : "unavailable",
    dirty: statusResult.status !== 0 || Boolean(statusResult.stdout.trim())
  };
}

function artifactDigest(files) {
  return sha256(files.map((item) => `${item.path}\t${item.size}\t${item.sha256}`).join("\n"));
}

function check(id, passed, detail) {
  return { id, passed: Boolean(passed), detail };
}

function templateHasVariables(root, relativePath, variables) {
  try {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const names = new Set(source.split(/\r?\n/).map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1]).filter(Boolean));
    return variables.every((name) => names.has(name));
  } catch {
    return false;
  }
}

function templateHasExactValues(root, relativePath, expectedValues) {
  try {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const values = new Map();
    for (const line of source.split(/\r?\n/)) {
      const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!match) continue;
      if (values.has(match[1])) return false;
      values.set(match[1], match[2]);
    }
    return Object.entries(expectedValues).every(([name, value]) => values.get(name) === value);
  } catch {
    return false;
  }
}

function systemdTemplateMatches(root, relativePath, expectedSections) {
  try {
    const source = fs.readFileSync(path.join(root, relativePath), "utf8");
    const sections = new Map();
    let currentSection;
    for (const rawLine of source.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#") || line.startsWith(";")) continue;
      const sectionMatch = /^\[([A-Za-z][A-Za-z0-9]*)\]$/.exec(line);
      if (sectionMatch) {
        currentSection = sectionMatch[1];
        if (sections.has(currentSection)) return false;
        sections.set(currentSection, new Map());
        continue;
      }
      const directiveMatch = /^([A-Za-z][A-Za-z0-9]*)=(.*)$/.exec(line);
      if (!currentSection || !directiveMatch) return false;
      const directives = sections.get(currentSection);
      const values = directives.get(directiveMatch[1]) || [];
      values.push(directiveMatch[2]);
      directives.set(directiveMatch[1], values);
    }
    const expectedNames = Object.keys(expectedSections);
    if (sections.size !== expectedNames.length || expectedNames.some((name) => !sections.has(name))) return false;
    return expectedNames.every((sectionName) => {
      const actual = sections.get(sectionName);
      const expected = expectedSections[sectionName];
      const expectedKeys = Object.keys(expected);
      if (actual.size !== expectedKeys.length) return false;
      return expectedKeys.every((key) => {
        const actualValues = actual.get(key);
        const expectedValues = Array.isArray(expected[key]) ? expected[key] : [expected[key]];
        return Array.isArray(actualValues)
          && actualValues.length === expectedValues.length
          && actualValues.every((value, index) => value === expectedValues[index]);
      });
    });
  } catch {
    return false;
  }
}

function postgresDeploymentTemplatesValid(root) {
  const serviceBoundary = {
    Type: "oneshot",
    User: "__SERVICE_USER__",
    Group: "__SERVICE_GROUP__",
    WorkingDirectory: "__APP_DIR__",
    EnvironmentFile: "__SECRET_ENV_FILE__",
    NoNewPrivileges: "true",
    PrivateTmp: "true",
    ProtectHome: "true",
    ProtectSystem: "strict",
    ReadWritePaths: "__DATA_DIR__ __LOG_DIR__",
    UMask: "0077",
    TimeoutStartSec: "120"
  };
  return templateHasExactValues(root, "deploy/platform-production-adapters.env.template", {
    POSTGRES_SYNC_MODE: "disabled",
    POSTGRES_PRIMARY_READ_MODE: "disabled",
    POSTGRES_ADAPTER_MODE: "disabled",
    POSTGRES_PRODUCTION_WRITE_MODE: "disabled",
    POSTGRES_PRIMARY_STORAGE_MODE: "disabled"
  })
    && systemdTemplateMatches(root, "deploy/postgres-sync-worker.service.template", {
      Unit: {
        Description: "Chronic Care Platform PostgreSQL Outbox Worker",
        After: "network-online.target chronic-care-platform.service",
        Wants: "network-online.target"
      },
      Service: {
        ...serviceBoundary,
        Environment: ["NODE_ENV=production", "POSTGRES_SYNC_MODE=outbox"],
        ExecStart: "__NODE_BINARY__ scripts/postgres-sync-worker.js --sqlite-file=__DATA_DIR__/health-city.sqlite --limit=50 --max-attempts=5"
      },
      Install: { WantedBy: "multi-user.target" }
    })
    && systemdTemplateMatches(root, "deploy/postgres-shadow-reconcile.service.template", {
      Unit: {
        Description: "Health platform PostgreSQL shadow reconciliation",
        After: "network-online.target chronic-care-platform.service postgres-sync-worker.service",
        Wants: "network-online.target"
      },
      Service: {
        ...serviceBoundary,
        Environment: "POSTGRES_SYNC_MODE=outbox",
        ExecStart: "__NODE_BINARY__ scripts/postgres-shadow-reconcile.js reconcile --sqlite-file=__DATA_DIR__/health-city.sqlite --output=__LOG_DIR__/postgres-shadow-reconciliation.json --markdown=__LOG_DIR__/postgres-shadow-reconciliation.md"
      }
    })
    && systemdTemplateMatches(root, "deploy/postgres-sync-worker.timer.template", {
      Unit: { Description: "Run Chronic Care Platform PostgreSQL Outbox Worker" },
      Timer: {
        OnBootSec: "30s",
        OnUnitActiveSec: "15s",
        AccuracySec: "2s",
        Persistent: "true",
        Unit: "postgres-sync-worker.service"
      },
      Install: { WantedBy: "timers.target" }
    })
    && systemdTemplateMatches(root, "deploy/postgres-shadow-reconcile.timer.template", {
      Unit: { Description: "Run PostgreSQL shadow reconciliation every five minutes" },
      Timer: {
        OnBootSec: "2min",
        OnUnitActiveSec: "5min",
        Persistent: "true",
        Unit: "postgres-shadow-reconcile.service"
      },
      Install: { WantedBy: "timers.target" }
    });
}

function buildProductionDeploymentPackage(options = {}) {
  const root = options.root || ROOT;
  const strict = options.strict === true;
  const runtimeFiles = options.runtimeFiles || collectRuntimeFiles(root);
  const source = options.source || gitMetadata(root, runtimeFiles);
  const files = runtimeFiles.map((relativePath) => fileEvidence(root, relativePath));
  const digest = artifactDigest(files);
  const releaseId = String(options.releaseId || `${String(source.commit || "working-tree").slice(0, 12)}-${digest.slice(0, 12)}`);
  const productionReleaseScope = buildProductionReleaseScopeReport(
    options.productionReleaseScopeAuthorities || loadProductionReleaseScopeAuthorities(root)
  );
  const processContract = {
    supervisor: "systemd-or-container-orchestrator",
    entrypoint: "node server.js",
    install: "npm ci --omit=dev --ignore-scripts",
    workingDirectory: "DEPLOYMENT_APP_DIR",
    secretEnvironmentFile: "DEPLOYMENT_SECRET_ENV_FILE",
    restartPolicy: "on-failure",
    gracefulShutdownSeconds: 30,
    healthChecks: [
      { route: "/api/live", expectedStatus: 200, purpose: "process-liveness", authentication: "none" },
      { route: "/api/health", expectedStatus: 200, purpose: "dependency-readiness", authentication: "none" },
      { route: "/api/system/readiness", expectedStatus: 200, purpose: "operations-readiness-evidence", authentication: "commission" },
      { route: "/api/metrics", expectedStatus: 200, purpose: "operations-metrics", authentication: "commission" }
    ],
    productionPreflight: {
      entrypoint: "node scripts/production-preflight.js --strict",
      trustContract: "platform-governance.production-evidence-trust-decision.v1",
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      configurationVariables: [
        "PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE",
        "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256",
        "PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE",
        "PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR"
      ],
      externalEvidenceRequired: true,
      productionReady: false
    },
    productionReleaseScope: {
      contract: "production-release-scope.v1",
      scopeId: productionReleaseScope.scopeId,
      scopeFingerprint: productionReleaseScope.scopeFingerprint,
      verificationBoundary: "build-time-source-derived",
      runtimeVerificationAvailable: false,
      summary: productionReleaseScope.summary,
      externalEvidenceRequired: true,
      productionReady: false
    },
    backgroundJobs: [{
      id: "continuous-audit-delivery",
      entrypoint: "node scripts/audit-delivery-worker.js",
      preflight: "npm run audit:delivery:preflight",
      serviceTemplate: "deploy/audit-delivery-worker.service.template",
      timerTemplate: "deploy/audit-delivery-worker.timer.template",
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      configurationVariables: [
        "SIEM_AUDIT_ENDPOINT",
        "SIEM_AUDIT_TLS_MODE",
        "SIEM_AUDIT_CA_FILE",
        "SIEM_AUDIT_CLIENT_CERT_FILE",
        "SIEM_AUDIT_CLIENT_KEY_FILE",
        "AUDIT_WORM_DIRECTORY",
        "AUDIT_DELIVERY_CHECKPOINT_PATH",
        "AUDIT_DELIVERY_SOURCE_CONTRACT",
        "AUDIT_DELIVERY_SERVICE_USER",
        "AUDIT_DELIVERY_SERVICE_GROUP",
        "AUDIT_DELIVERY_SERVICE_UID",
        "AUDIT_DELIVERY_SERVICE_GID",
        "PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE"
      ],
      sourceContract: "append-only-audit-source-v2",
      productionReady: false
    }, {
      id: "chronic-followup-durable-dispatch",
      entrypoint: "node scripts/chronic-followup-dispatch-worker.js",
      preflight: "npm run chronic:followup-dispatch-preflight",
      serviceTemplate: "deploy/chronic-followup-dispatch-worker.service.template",
      timerTemplate: "deploy/chronic-followup-dispatch-worker.timer.template",
      configurationTemplate: "deploy/chronic-followup-dispatch-worker.env.template",
      configurationVariables: [
        "DATA_DIR",
        "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE",
        "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_WORKER_ID",
        "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_LIMIT",
        "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_LEASE_SECONDS",
        "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_BASE_BACKOFF_SECONDS",
        "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_URL",
        "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET",
        "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE",
        "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE",
        "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256"
      ],
      sourceContract: "citizen-chronic.followup-dispatch-outbox.v1",
      productionReady: false
    }, {
      id: "postgres-shadow-sync",
      entrypoint: "node scripts/postgres-sync-worker.js",
      serviceTemplate: "deploy/postgres-sync-worker.service.template",
      timerTemplate: "deploy/postgres-sync-worker.timer.template",
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      configurationVariables: [...POSTGRES_SYNC_JOB_VARIABLES],
      sourceContract: "postgres-shadow-sync",
      productionPrimary: false,
      runtimeCutoverEnabled: false,
      productionReady: false
    }, {
      id: "postgres-shadow-reconciliation",
      entrypoint: "node scripts/postgres-shadow-reconcile.js reconcile",
      serviceTemplate: "deploy/postgres-shadow-reconcile.service.template",
      timerTemplate: "deploy/postgres-shadow-reconcile.timer.template",
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      configurationVariables: [...POSTGRES_RECONCILIATION_JOB_VARIABLES],
      sourceContract: "postgres-shadow-reconciliation",
      productionPrimary: false,
      runtimeCutoverEnabled: false,
      productionReady: false
    }],
    databaseTransition: {
      inputContract: "postgres-primary-transition-metadata-v1",
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      configurationVariables: [...POSTGRES_TRANSITION_CONFIGURATION_VARIABLES],
      commands: {
        readiness: "npm run postgres:transition-readiness",
        migrationPackage: "npm run postgres:migration-package",
        migrationVerify: "npm run postgres:migration-verify",
        primaryReadRehearsal: "npm run postgres:primary-read-rehearsal",
        adapterVerify: "npm run postgres:adapter-verify",
        storageBackup: "npm run storage:backup",
        storageInspect: "npm run storage:inspect",
        storageAssess: "npm run storage:assess -- <backup-dir>",
        shadowSync: "npm run postgres:sync-worker",
        shadowReconciliation: "npm run postgres:shadow-reconcile"
      },
      readyForControlledRehearsal: false,
      activationAuthorized: false,
      productionPrimary: false,
      runtimeCutoverEnabled: false,
      productionReady: false
    },
    preproductionControls: PREPRODUCTION_CONTROL_DEFINITIONS.map((control) => ({
      ...control,
      configurationVariables: [...control.configurationVariables],
      configurationTemplate: "deploy/platform-production-adapters.env.template",
      inputBoundary: "absolute-bounded-regular-file",
      readOnly: true,
      externalEvidenceRequired: true,
      cutoverExecutionAuthorized: false,
      executionAuthorized: false,
      runtimeCutoverEnabled: false,
      productionPrimary: false,
      productionReady: false
    })),
    template: "deploy/chronic-care-platform.service.template"
  };
  const rollbackContract = {
    requirePreviousArtifactDigest: true,
    requireStorageBackup: true,
    backupCommand: "npm run storage:backup",
    rollbackCommand: "npm run rollback:snapshot -- <backup-dir>",
    verifyCommand: "npm run deployment:verify",
    postRollbackHealth: "/api/health"
  };
  const secretContract = {
    providerEnv: "DEPLOYMENT_SECRET_PROVIDER",
    allowedProviders: ["vault", "kms", "orchestrator"],
    valuesPersisted: false,
    prohibitedArtifactPatterns: [".env", "*.pem", "*.key", "*.p12", "*.pfx", "secrets.*"],
    variables: SECRET_CONTRACT
  };
  const checks = [
    check("deploymentPackage:runtimeFiles", files.length >= 30 && REQUIRED_RUNTIME_FILES.every((name) => files.some((item) => item.path === name)), `${files.length} runtime files with required entrypoints`),
    check("deploymentPackage:digest", /^[a-f0-9]{64}$/.test(digest) && files.every((item) => /^[a-f0-9]{64}$/.test(item.sha256)), `sha256:${digest}`),
    check("deploymentPackage:secretBoundary", secretContract.valuesPersisted === false && secretContract.variables.length >= 10 && secretContract.variables.every((item) => item.name && item.persistedInArtifact === false && !("value" in item)), `${secretContract.variables.length} secret references; values persisted false`),
    check("deploymentPackage:processContract", processContract.healthChecks.length === 4 && processContract.healthChecks.some((item) => item.route === "/api/live" && item.purpose === "process-liveness" && item.authentication === "none") && processContract.healthChecks.some((item) => item.route === "/api/health" && item.purpose === "dependency-readiness" && item.authentication === "none") && processContract.restartPolicy === "on-failure" && processContract.gracefulShutdownSeconds >= 30 && processContract.productionPreflight.productionReady === false && processContract.backgroundJobs.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false) && processContract.backgroundJobs.some((item) => item.id === "chronic-followup-durable-dispatch" && item.productionReady === false) && processContract.backgroundJobs.some((item) => item.id === "postgres-shadow-sync" && item.productionReady === false) && processContract.backgroundJobs.some((item) => item.id === "postgres-shadow-reconciliation" && item.productionReady === false) && processContract.preproductionControls.length === 5 && processContract.preproductionControls.every((item) => item.readOnly === true && item.externalEvidenceRequired === true && item.cutoverExecutionAuthorized === false && item.executionAuthorized === false && item.runtimeCutoverEnabled === false && item.productionPrimary === false && item.productionReady === false), `${processContract.supervisor} / ${processContract.healthChecks.length} health checks / ${processContract.backgroundJobs.length} background jobs / ${processContract.preproductionControls.length} pre-production controls`),
    check("deploymentPackage:releaseScope", productionReleaseScope.ok === true && productionReleaseScope.productionReady === false && productionReleaseScope.externalEvidenceRequired === true && PRODUCTION_RELEASE_SCOPE_RUNTIME_FILES.every((name) => files.some((item) => item.path === name)) && processContract.productionReleaseScope.scopeFingerprint === productionReleaseScope.scopeFingerprint, `${productionReleaseScope.scopeId} / ${productionReleaseScope.scopeFingerprint} / FROZEN-NO-GO`),
    check("deploymentPackage:databaseTransition", POSTGRES_TRANSITION_RUNTIME_FILES.every((name) => files.some((item) => item.path === name)) && templateHasVariables(root, "deploy/platform-production-adapters.env.template", POSTGRES_TRANSITION_CONFIGURATION_VARIABLES) && postgresDeploymentTemplatesValid(root) && processContract.databaseTransition.productionReady === false && processContract.databaseTransition.productionPrimary === false && processContract.databaseTransition.runtimeCutoverEnabled === false && processContract.databaseTransition.activationAuthorized === false && !JSON.stringify(processContract).includes("DATABASE_URL") && secretContract.variables.some((item) => item.name === "DATABASE_URL" && !Object.hasOwn(item, "value")), "PostgreSQL transition commands, workers, hardened templates and secret boundary remain fail closed"),
    check("deploymentPackage:preproductionControls", PREPRODUCTION_CONTROL_RUNTIME_FILES.every((name) => files.some((item) => item.path === name)) && templateHasVariables(root, "deploy/platform-production-adapters.env.template", PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES) && processContract.preproductionControls.length === 5, "five read-only pre-production control entrypoints and their runtime/configuration closure are mandatory"),
    check("deploymentPackage:rollbackContract", rollbackContract.requirePreviousArtifactDigest && rollbackContract.requireStorageBackup && rollbackContract.rollbackCommand.includes("rollback:snapshot"), "previous digest, storage backup and post-rollback health are mandatory"),
    check("deploymentPackage:provenance", Boolean(source.commit) && (!strict || !source.dirty), `${source.commit} / ${source.dirty ? "working tree dirty" : "working tree clean"}${strict ? " / strict" : ""}`)
  ];
  return {
    schemaVersion: "production-deployment-package-v1",
    generatedAt: new Date().toISOString(),
    ok: checks.every((item) => item.passed),
    productionReady: false,
    releaseId,
    source,
    artifact: {
      algorithm: "sha256",
      digest: `sha256:${digest}`,
      immutable: true,
      files
    },
    processContract,
    secretContract,
    rollbackContract,
    externalAttestation: {
      requiredInProduction: true,
      digestEnv: "DEPLOYMENT_ARTIFACT_DIGEST",
      releaseIdEnv: "DEPLOYMENT_RELEASE_ID",
      registryOrSigningEvidenceRequired: true
    },
    blockers: [
      "production artifact registry or immutable release directory",
      "Vault, KMS or orchestrator secret provider",
      "target domain and TLS certificate chain",
      "service account, filesystem permissions and writable data directory",
      "previous artifact digest plus storage backup",
      "append-only audit outbox, trusted response receipt and external checkpoint anchor",
      "production preflight, smoke, rollback rehearsal and signed cutover approval"
    ],
    checks
  };
}

function verifyProductionDeploymentPackage(manifest, options = {}) {
  const root = options.root || ROOT;
  let productionReleaseScopeContract = {};
  try {
    productionReleaseScopeContract = JSON.parse(fs.readFileSync(
      path.join(root, "config", "production-release-scope.json"),
      "utf8"
    ));
  } catch {
    productionReleaseScopeContract = {};
  }
  const expectedFiles = Array.isArray(manifest?.artifact?.files) ? manifest.artifact.files : [];
  const currentFiles = [];
  const missing = [];
  const mismatched = [];
  expectedFiles.forEach((expected) => {
    const absolutePath = path.join(root, expected.path);
    if (!fs.existsSync(absolutePath)) {
      missing.push(expected.path);
      return;
    }
    const current = fileEvidence(root, expected.path);
    currentFiles.push(current);
    if (current.size !== expected.size || current.sha256 !== expected.sha256) mismatched.push(expected.path);
  });
  const currentDigest = artifactDigest(currentFiles);
  const expectedDigest = String(manifest?.artifact?.digest || "").replace(/^sha256:/, "");
  const prohibitedPaths = expectedFiles.filter((item) => /(^|\/)(\.env|[^/]+\.(pem|key|p12|pfx)|secrets?\.[^/]+)$/i.test(item.path)).map((item) => item.path);
  const secretValuesAbsent = manifest?.secretContract?.valuesPersisted === false && (manifest?.secretContract?.variables || []).every((item) => !("value" in item));
  const postgresTransition = manifest?.processContract?.databaseTransition;
  const postgresJobs = manifest?.processContract?.backgroundJobs || [];
  const transitionFlagsClosed = postgresTransition?.readyForControlledRehearsal === false
    && postgresTransition?.activationAuthorized === false
    && postgresTransition?.productionPrimary === false
    && postgresTransition?.runtimeCutoverEnabled === false
    && postgresTransition?.productionReady === false;
  const postgresFilesPresent = POSTGRES_TRANSITION_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required));
  const postgresVariablesPresent = POSTGRES_TRANSITION_CONFIGURATION_VARIABLES.every((name) => postgresTransition?.configurationVariables?.includes(name));
  const postgresDatabaseUrlSecretOnly = manifest?.secretContract?.variables?.some((item) => item.name === "DATABASE_URL" && !("value" in item))
    && !JSON.stringify(manifest?.processContract || {}).includes("DATABASE_URL");
  const postgresSyncJobValid = postgresJobs.some((item) => item.id === "postgres-shadow-sync"
    && item.entrypoint === "node scripts/postgres-sync-worker.js"
    && item.serviceTemplate === "deploy/postgres-sync-worker.service.template"
    && item.timerTemplate === "deploy/postgres-sync-worker.timer.template"
    && item.configurationTemplate === "deploy/platform-production-adapters.env.template"
    && POSTGRES_SYNC_JOB_VARIABLES.every((name) => item.configurationVariables?.includes(name))
    && item.productionReady === false
    && item.productionPrimary === false
    && item.runtimeCutoverEnabled === false);
  const postgresReconciliationJobValid = postgresJobs.some((item) => item.id === "postgres-shadow-reconciliation"
    && item.entrypoint === "node scripts/postgres-shadow-reconcile.js reconcile"
    && item.serviceTemplate === "deploy/postgres-shadow-reconcile.service.template"
    && item.timerTemplate === "deploy/postgres-shadow-reconcile.timer.template"
    && item.configurationTemplate === "deploy/platform-production-adapters.env.template"
    && POSTGRES_RECONCILIATION_JOB_VARIABLES.every((name) => item.configurationVariables?.includes(name))
    && item.productionReady === false
    && item.productionPrimary === false
    && item.runtimeCutoverEnabled === false);
  const preproductionControls = manifest?.processContract?.preproductionControls || [];
  const packagedReleaseScope = manifest?.processContract?.productionReleaseScope;
  const frozenSummary = Object.fromEntries(Object.entries(productionReleaseScopeContract.frozenInventory || {})
    .map(([key, value]) => [key, value.count]));
  const releaseScopeValid = PRODUCTION_RELEASE_SCOPE_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required))
    && packagedReleaseScope?.contract === "production-release-scope.v1"
    && productionReleaseScopeContract.productionReady === false
    && productionReleaseScopeContract.externalEvidenceRequired === true
    && packagedReleaseScope?.scopeId === productionReleaseScopeContract.scopeId
    && packagedReleaseScope?.scopeFingerprint === productionReleaseScopeContract.scopeFingerprint
    && JSON.stringify(packagedReleaseScope?.summary) === JSON.stringify(frozenSummary)
    && packagedReleaseScope?.verificationBoundary === "build-time-source-derived"
    && packagedReleaseScope?.runtimeVerificationAvailable === false
    && packagedReleaseScope?.externalEvidenceRequired === true
    && packagedReleaseScope?.productionReady === false;
  const preproductionControlsValid = preproductionControls.length === PREPRODUCTION_CONTROL_DEFINITIONS.length
    && PREPRODUCTION_CONTROL_DEFINITIONS.every((expected) => {
      const actual = preproductionControls.find((item) => item.id === expected.id);
      return actual?.command === expected.command
        && JSON.stringify(actual.configurationVariables) === JSON.stringify(expected.configurationVariables);
    })
    && preproductionControls.every((item) => item.configurationTemplate === "deploy/platform-production-adapters.env.template"
      && item.inputBoundary === "absolute-bounded-regular-file"
      && item.readOnly === true
      && item.externalEvidenceRequired === true
      && item.cutoverExecutionAuthorized === false
      && item.executionAuthorized === false
      && item.runtimeCutoverEnabled === false
      && item.productionPrimary === false
      && item.productionReady === false)
    && PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES.every((name) =>
      preproductionControls.some((item) => item.configurationVariables?.includes(name)));
  const checks = [
    check("deploymentVerify:schema", manifest?.schemaVersion === "production-deployment-package-v1" && manifest?.productionReady === false, manifest?.schemaVersion || "missing"),
    check("deploymentVerify:files", expectedFiles.length >= 30 && missing.length === 0 && mismatched.length === 0, `${expectedFiles.length} expected / ${missing.length} missing / ${mismatched.length} mismatched`),
    check("deploymentVerify:digest", expectedDigest === currentDigest, `expected sha256:${expectedDigest} / current sha256:${currentDigest}`),
    check("deploymentVerify:secretBoundary", secretValuesAbsent && prohibitedPaths.length === 0, prohibitedPaths.join(",") || "secret values and prohibited files absent"),
    check("deploymentVerify:auditWorker", AUDIT_DELIVERY_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required)) && manifest?.processContract?.backgroundJobs?.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false && item.preflight === "npm run audit:delivery:preflight" && item.configurationTemplate === "deploy/platform-production-adapters.env.template" && item.configurationVariables?.includes("AUDIT_DELIVERY_SOURCE_CONTRACT") && item.configurationVariables?.includes("PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE")) && manifest?.secretContract?.variables?.some((item) => item.name === "SIEM_AUDIT_SIGNING_SECRET" && !("value" in item)), "continuous audit dependency closure, process, configuration and secret references are mandatory"),
    check("deploymentVerify:chronicFollowupWorker", CHRONIC_FOLLOWUP_DISPATCH_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required)) && manifest?.processContract?.backgroundJobs?.some((item) => item.id === "chronic-followup-durable-dispatch" && item.productionReady === false && item.preflight === "npm run chronic:followup-dispatch-preflight" && item.sourceContract === "citizen-chronic.followup-dispatch-outbox.v1" && ["DATA_DIR", "CITIZEN_CHRONIC_FOLLOWUP_DISPATCH_SQLITE_FILE", "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_REGISTRY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_FILE", "CITIZEN_CHRONIC_FOLLOWUP_ACTIVATION_PUBLIC_KEY_SHA256"].every((name) => item.configurationVariables?.includes(name))) && manifest?.secretContract?.variables?.some((item) => item.name === "CITIZEN_CHRONIC_FOLLOWUP_PUBLISHER_HMAC_SECRET" && !("value" in item)), "chronic followup durable worker, canonical SQLite source, activation trust and secret references are mandatory"),
    check("deploymentVerify:productionEvidenceTrust", PRODUCTION_EVIDENCE_TRUST_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required)) && manifest?.processContract?.productionPreflight?.entrypoint === "node scripts/production-preflight.js --strict" && manifest?.processContract?.productionPreflight?.trustContract === "platform-governance.production-evidence-trust-decision.v1" && manifest?.processContract?.productionPreflight?.productionReady === false && ["PRODUCTION_EVIDENCE_TRUST_ANCHORS_FILE", "PRODUCTION_EVIDENCE_TRUST_ANCHORS_SHA256", "PRODUCTION_EVIDENCE_TRUST_ENVELOPE_FILE", "PRODUCTION_CUTOVER_ACTION_EVIDENCE_DIR"].every((name) => manifest?.processContract?.productionPreflight?.configurationVariables?.includes(name)), "strict preflight includes the pinned Ed25519 production and cutover-action evidence providers and remains NO-GO by default"),
    check("deploymentVerify:releaseScope", releaseScopeValid, packagedReleaseScope?.scopeFingerprint || "missing"),
    check("deploymentVerify:postgresTransition", postgresFilesPresent && postgresVariablesPresent && templateHasVariables(root, "deploy/platform-production-adapters.env.template", POSTGRES_TRANSITION_CONFIGURATION_VARIABLES) && postgresDeploymentTemplatesValid(root) && transitionFlagsClosed && postgresDatabaseUrlSecretOnly && postgresTransition?.commands?.readiness === "npm run postgres:transition-readiness" && postgresTransition?.commands?.migrationPackage === "npm run postgres:migration-package" && postgresTransition?.commands?.migrationVerify === "npm run postgres:migration-verify" && postgresTransition?.commands?.primaryReadRehearsal === "npm run postgres:primary-read-rehearsal" && postgresTransition?.commands?.adapterVerify === "npm run postgres:adapter-verify" && postgresTransition?.commands?.storageBackup === "npm run storage:backup" && postgresTransition?.commands?.storageInspect === "npm run storage:inspect" && postgresTransition?.commands?.storageAssess === "npm run storage:assess -- <backup-dir>" && postgresTransition?.commands?.shadowSync === "npm run postgres:sync-worker" && postgresTransition?.commands?.shadowReconciliation === "npm run postgres:shadow-reconcile" && postgresSyncJobValid && postgresReconciliationJobValid, "PostgreSQL transition entrypoints, variables, hardened templates, secret reference and fixed NO-GO flags are mandatory"),
    check("deploymentVerify:preproductionControls", PREPRODUCTION_CONTROL_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required)) && templateHasVariables(root, "deploy/platform-production-adapters.env.template", PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES) && preproductionControlsValid, "five read-only pre-production controls require complete runtime files, configuration references and fixed non-authorization flags"),
    check("deploymentVerify:rollback", manifest?.rollbackContract?.requirePreviousArtifactDigest === true && manifest?.rollbackContract?.requireStorageBackup === true, "rollback prerequisites declared")
  ];
  return {
    ok: checks.every((item) => item.passed),
    verifiedAt: new Date().toISOString(),
    releaseId: manifest?.releaseId || "",
    missing,
    mismatched,
    prohibitedPaths,
    checks
  };
}

function renderMarkdown(manifest, verification = verifyProductionDeploymentPackage(manifest)) {
  const checkRows = manifest.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`);
  const verifyRows = verification.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replaceAll("|", "/")} |`);
  const fileRows = manifest.artifact.files.map((item) => `| ${item.path} | ${item.size} | ${item.sha256} |`);
  return [
    "# Production deployment package",
    "",
    `- Generated at: ${manifest.generatedAt}`,
    `- Release ID: ${manifest.releaseId}`,
    `- Artifact digest: ${manifest.artifact.digest}`,
    `- Runtime files: ${manifest.artifact.files.length}`,
    `- Production ready: ${manifest.productionReady ? "yes" : "no"}`,
    "",
    "## Package checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Integrity verification",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...verifyRows,
    "",
    "## Runtime files",
    "",
    "| Path | Bytes | SHA-256 |",
    "|---|---:|---|",
    ...fileRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const [command = "build", ...rawFlags] = argv;
  const flags = {};
  rawFlags.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return { command, flags };
}

function writeOutput(manifest, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  const verification = verifyProductionDeploymentPackage(manifest);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...manifest, verification }, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(manifest, verification), "utf8");
  return { output, markdown, verification };
}

function runCli() {
  const { command, flags } = parseArgs();
  if (command === "build") {
    const manifest = buildProductionDeploymentPackage({ strict: flags.strict === true, releaseId: flags["release-id"] });
    const written = writeOutput(manifest, flags);
    console.log(JSON.stringify({ ...manifest, verification: written.verification }, null, 2));
    if (!manifest.ok || !written.verification.ok) process.exitCode = 1;
    return;
  }
  if (command === "verify") {
    const input = path.resolve(ROOT, String(flags.input || DEFAULT_OUTPUT));
    if (!fs.existsSync(input)) throw new Error(`deployment package not found: ${input}`);
    const manifest = JSON.parse(fs.readFileSync(input, "utf8"));
    const verification = verifyProductionDeploymentPackage(manifest);
    console.log(JSON.stringify(verification, null, 2));
    if (!verification.ok) process.exitCode = 1;
    return;
  }
  throw new Error(`unsupported deployment package command: ${command}`);
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
  PREPRODUCTION_CONTROL_CONFIGURATION_VARIABLES,
  PREPRODUCTION_CONTROL_DEFINITIONS,
  PREPRODUCTION_CONTROL_RUNTIME_FILES,
  POSTGRES_TRANSITION_CONFIGURATION_VARIABLES,
  POSTGRES_RECONCILIATION_JOB_VARIABLES,
  POSTGRES_SYNC_JOB_VARIABLES,
  POSTGRES_TRANSITION_RUNTIME_FILES,
  PRODUCTION_EVIDENCE_TRUST_RUNTIME_FILES,
  SECRET_CONTRACT,
  artifactDigest,
  buildProductionDeploymentPackage,
  collectRuntimeFiles,
  parseArgs,
  postgresDeploymentTemplatesValid,
  renderMarkdown,
  verifyProductionDeploymentPackage,
  writeOutput
};
