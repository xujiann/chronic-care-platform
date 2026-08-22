#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "object-storage-readiness-report.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "object-storage-readiness-report.md");

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

function buildObjectStorageReadiness(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const adapterSource = options.adapterSource ?? read("secure-object-storage.js");
  const serverSource = options.serverSource ?? readRuntimeSource(ROOT);
  const documentation = options.documentation ?? read("docs/production-object-storage.md");
  const environment = options.environment ?? read(".env.example");
  const releaseSource = options.releaseSource ?? read("scripts/release-report.js");
  const deploySource = options.deploySource ?? read("scripts/deploy-check.js");
  const manifestSource = options.manifestSource ?? read("scripts/release-artifact-manifest.js");
  const controls = [
    { id: "metadata", markers: ["validateAttachmentMetadata", "checksumSha256", "classification", "retentionPolicy"] },
    { id: "upload-intent", markers: ["createObjectUploadIntent", "upload-intents", "buildObjectKey"] },
    { id: "integrity-scan", markers: ["finalizeObjectUpload", "checksum verification failed", "malware scan did not pass"] },
    { id: "download-intent", markers: ["createObjectDownloadIntent", "downloadTtlSeconds", "download-intents"] },
    { id: "lifecycle", markers: ["applyObjectLifecycle", "legal-hold", "release-hold", "immutable"] },
    { id: "gateway-security", markers: ["HMAC-SHA256", "X-Signature", "OBJECT_STORAGE_SIGNING_SECRET", "must use HTTPS in production"] },
    { id: "gateway-response-trust", markers: ["signGatewayResponse", "verifyGatewayResponse", "parseRfc3339Instant", "OBJECT_STORAGE_RECEIPT_SIGNING_SECRET", "object-storage-response-v1"] },
    { id: "signed-url-boundary", markers: ["OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS", "OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS", "validateSignedIntentUrl", "OBJECT_STORAGE_INTENT_EXPIRY_INVALID"] },
    { id: "explicit-receipts", markers: ["scanReceiptId", "receiptId", "OBJECT_STORAGE_COMPLETION_RECEIPT_INVALID", "OBJECT_STORAGE_LIFECYCLE_RECEIPT_INVALID", "OBJECT_STORAGE_OBJECT_VERSION_REQUIRED", "OBJECT_STORAGE_MALWARE_SCAN_NOT_CLEAN"] }
  ].map((item) => ({ ...item, passed: item.markers.every((marker) => adapterSource.includes(marker)) }));
  const apiRoutes = [
    "/api/attachments/storage",
    "/api/attachments/upload-intents",
    "/api/attachments/:id/complete",
    "/api/attachments/:id/download-intent",
    "/api/attachments/:id/actions"
  ].map((route) => ({ route, passed: serverSource.includes(route.replace(":id", "${id}")) || serverSource.includes(route) || serverSource.includes(route.replace(":id", "([^/]+)")) }));
  apiRoutes[2].passed = serverSource.includes("attachmentCompleteMatch") && serverSource.includes("finalizeObjectUpload");
  apiRoutes[3].passed = serverSource.includes("attachmentDownloadMatch") && serverSource.includes("createObjectDownloadIntent");
  apiRoutes[4].passed = serverSource.includes("attachmentActionMatch") && serverSource.includes("applyObjectLifecycle");
  const envVariables = [
    "OBJECT_STORAGE_GATEWAY_URL",
    "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_SIGNING_SECRET",
    "OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION",
    "OBJECT_STORAGE_RECEIPT_SIGNING_SECRET",
    "OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS",
    "OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS",
    "OBJECT_STORAGE_UPLOAD_TTL_SECONDS",
    "OBJECT_STORAGE_RESPONSE_MAX_SKEW_SECONDS",
    "OBJECT_STORAGE_TIMEOUT_MS",
    "OBJECT_STORAGE_MAX_BYTES",
    "OBJECT_STORAGE_DOWNLOAD_TTL_SECONDS"
  ];
  const attachmentRecords = Array.isArray(data.secureAttachments) ? data.secureAttachments : [];
  const checks = [
    { id: "objectStorage:controls", passed: controls.every((item) => item.passed), detail: `${controls.filter((item) => item.passed).length}/${controls.length} security controls` },
    { id: "objectStorage:api", passed: apiRoutes.every((item) => item.passed), detail: `${apiRoutes.filter((item) => item.passed).length}/${apiRoutes.length} runtime API groups` },
    { id: "objectStorage:dataModel", passed: serverSource.includes("secureAttachments") && serverSource.includes("canAccessSecureAttachment"), detail: `${attachmentRecords.length} persisted attachment metadata rows in snapshot` },
    { id: "objectStorage:environment", passed: envVariables.every((marker) => environment.includes(marker)), detail: `${envVariables.filter((marker) => environment.includes(marker)).length}/${envVariables.length} environment variables documented` },
    { id: "objectStorage:boundary", passed: ["适配器基础", "不等于真实附件存储已经正式验收", "不允许回退到旧响应契约", "WORM/对象锁", "病毒库更新", "备份恢复"].every((marker) => documentation.includes(marker)), detail: "gateway trust migration, real bucket, malware, immutable retention and acceptance boundaries documented" },
    { id: "objectStorage:releaseWiring", passed: Boolean(pkg.scripts?.["object-storage:readiness"]) && releaseSource.includes("buildObjectStorageReadiness") && deploySource.includes("objectStorageReadiness") && manifestSource.includes("object-storage-readiness-report"), detail: "package, release report, deploy check and manifest wiring" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    status: "adapter-foundation-ready-site-acceptance-pending",
    productionReady: false,
    summary: {
      controls: controls.length,
      controlsReady: controls.filter((item) => item.passed).length,
      apiGroups: apiRoutes.length,
      apiGroupsReady: apiRoutes.filter((item) => item.passed).length,
      attachmentRecords: attachmentRecords.length,
      productionBlockers: 8
    },
    controls,
    apiRoutes,
    envVariables,
    blockers: [
      "real S3/OBS/OSS or private-cloud gateway adapter",
      "bucket least-privilege policy and KMS encryption",
      "malware engine and virus-definition update evidence",
      "DICOM and Office document specialized scanning",
      "WORM/object-lock retention verification",
      "backup restore and lifecycle task rehearsal",
      "capacity, concurrency and signed URL security tests",
      "privacy assessment and site acceptance signoff"
    ],
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Object storage and attachment security readiness",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Status: ${report.status}`,
    `- Production ready: ${report.productionReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail).replace(/\|/g, "/")} |`),
    "",
    "## Security controls",
    "",
    "| Result | Control | Required markers |",
    "|---|---|---|",
    ...report.controls.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.markers.join(", ")} |`),
    "",
    "## Runtime APIs",
    "",
    "| Result | Route |",
    "|---|---|",
    ...report.apiRoutes.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.route} |`),
    "",
    "## Production blockers",
    "",
    ...report.blockers.map((item) => `- ${item}`),
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
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildObjectStorageReadiness();
  if (flags.write !== "false" && flags.write !== false) writeOutput(report, flags);
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

module.exports = { buildObjectStorageReadiness, parseArgs, renderMarkdown, writeOutput };
