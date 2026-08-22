#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "production-deployment-package.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "production-deployment-package.md");
const ALLOWED_RUNTIME_EXTENSIONS = new Set([".js", ".json", ".html", ".css", ".svg", ".webmanifest"]);
const AUDIT_DELIVERY_RUNTIME_FILES = [
  "scripts/audit-delivery-worker.js",
  "scripts/audit-delivery-preflight.js",
  "src/platform/operations/audit-delivery.js",
  "src/identity-security/audit-chain.js",
  "src/platform/cutover/pilot-cutover-alert-lifecycle.js",
  "src/platform/governance/technical-evidence.js",
  "deploy/audit-delivery-worker.service.template",
  "deploy/audit-delivery-worker.timer.template",
  "deploy/platform-production-adapters.env.template"
];
const REQUIRED_RUNTIME_FILES = [
  "server.js",
  "src/http/api-router.js",
  "src/http/routes/index.js",
  "session-store.js",
  "package.json",
  "package-lock.json",
  "service-worker.js",
  "manifest.webmanifest",
  "deploy/postgres-primary-storage-schema.sql",
  "scripts/postgres-sync-worker.js",
  "scripts/postgres-shadow-reconcile.js",
  ...AUDIT_DELIVERY_RUNTIME_FILES
];
const ADDITIONAL_RUNTIME_FILES = [
  "config/regions.json",
  "deploy/postgres-primary-storage-schema.sql",
  "scripts/postgres-sync-worker.js",
  "scripts/postgres-shadow-reconcile.js",
  ...AUDIT_DELIVERY_RUNTIME_FILES
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
  ["ALERT_WEBHOOK_SECRET", "operations webhook signing"],
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
  return [...rootFiles, ...directoryFiles, ...ADDITIONAL_RUNTIME_FILES.filter((name) => fs.existsSync(path.join(root, name)))].sort();
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

function buildProductionDeploymentPackage(options = {}) {
  const root = options.root || ROOT;
  const strict = options.strict === true;
  const runtimeFiles = options.runtimeFiles || collectRuntimeFiles(root);
  const source = options.source || gitMetadata(root, runtimeFiles);
  const files = runtimeFiles.map((relativePath) => fileEvidence(root, relativePath));
  const digest = artifactDigest(files);
  const releaseId = String(options.releaseId || `${String(source.commit || "working-tree").slice(0, 12)}-${digest.slice(0, 12)}`);
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
      sourceContract: "append-only-outbox-v2-required",
      productionReady: false
    }],
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
    check("deploymentPackage:processContract", processContract.healthChecks.length === 4 && processContract.healthChecks.some((item) => item.route === "/api/live" && item.purpose === "process-liveness" && item.authentication === "none") && processContract.healthChecks.some((item) => item.route === "/api/health" && item.purpose === "dependency-readiness" && item.authentication === "none") && processContract.restartPolicy === "on-failure" && processContract.gracefulShutdownSeconds >= 30 && processContract.backgroundJobs.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false), `${processContract.supervisor} / ${processContract.healthChecks.length} health checks / ${processContract.backgroundJobs.length} background jobs`),
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
  const checks = [
    check("deploymentVerify:schema", manifest?.schemaVersion === "production-deployment-package-v1", manifest?.schemaVersion || "missing"),
    check("deploymentVerify:files", expectedFiles.length >= 30 && missing.length === 0 && mismatched.length === 0, `${expectedFiles.length} expected / ${missing.length} missing / ${mismatched.length} mismatched`),
    check("deploymentVerify:digest", expectedDigest === currentDigest, `expected sha256:${expectedDigest} / current sha256:${currentDigest}`),
    check("deploymentVerify:secretBoundary", secretValuesAbsent && prohibitedPaths.length === 0, prohibitedPaths.join(",") || "secret values and prohibited files absent"),
    check("deploymentVerify:auditWorker", AUDIT_DELIVERY_RUNTIME_FILES.every((required) => expectedFiles.some((item) => item.path === required)) && manifest?.processContract?.backgroundJobs?.some((item) => item.id === "continuous-audit-delivery" && item.productionReady === false && item.preflight === "npm run audit:delivery:preflight" && item.configurationTemplate === "deploy/platform-production-adapters.env.template" && item.configurationVariables?.includes("AUDIT_DELIVERY_SOURCE_CONTRACT") && item.configurationVariables?.includes("PLATFORM_PILOT_CUTOVER_ALERT_JOURNAL_FILE")) && manifest?.secretContract?.variables?.some((item) => item.name === "SIEM_AUDIT_SIGNING_SECRET" && !("value" in item)), "continuous audit dependency closure, process, configuration and secret references are mandatory"),
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
  SECRET_CONTRACT,
  artifactDigest,
  buildProductionDeploymentPackage,
  collectRuntimeFiles,
  parseArgs,
  renderMarkdown,
  verifyProductionDeploymentPackage,
  writeOutput
};
