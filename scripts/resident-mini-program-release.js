"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Delivery = require("../resident-mini-program-delivery-policy");
const { assessChineseCopy } = require("./resident-mini-program-chinese-scan");

const root = path.resolve(__dirname, "..");
const defaultOutput = path.join(os.tmpdir(), "t04-mp-release-candidate");
const testCredentialPattern = /(?:123456|888888|DEMO-MOBILE)/;
const sha256Pattern = /^[a-f0-9]{64}$/i;
const nonSemanticArtifactFields = new Set(["sha256", "deterministicSourceDigest"]);
const sourceAssets = [
  "resident-mini-program.html",
  "resident-mini-program.css",
  "resident-mini-program.js",
  "resident-mini-program-core.js",
  "resident-mini-program-policy.js",
  "resident-mini-program-runtime-policy.js",
  "resident-mini-program-delivery-policy.js",
  "resident-mini-program-adapter.js"
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function semanticValueHasTestCredentials(value, field = "") {
  if (nonSemanticArtifactFields.has(field) && typeof value === "string" && sha256Pattern.test(value)) return false;
  if (typeof value === "string") return testCredentialPattern.test(value);
  if (Array.isArray(value)) return value.some((item) => semanticValueHasTestCredentials(item));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, item]) => semanticValueHasTestCredentials(item, key));
  }
  return false;
}

function artifactHasTestCredentials(content) {
  try {
    return semanticValueHasTestCredentials(JSON.parse(content));
  } catch {
    return testCredentialPattern.test(content);
  }
}

function booleanEnvironment(name) {
  return String(process.env[name] || "").toLowerCase() === "true";
}

function outputPathFromArguments(argumentsList = process.argv.slice(2)) {
  const index = argumentsList.indexOf("--output");
  const candidate = index >= 0 ? path.resolve(argumentsList[index + 1] || "") : defaultOutput;
  const temporaryRoot = path.resolve(os.tmpdir());
  if (!candidate || candidate === temporaryRoot || !candidate.startsWith(`${temporaryRoot}${path.sep}`)) {
    throw new Error("发布候选输出目录必须位于系统临时目录下的明确子目录");
  }
  return candidate;
}

function configuredShell(relativePath, environment) {
  const template = readJson(relativePath);
  const pages = readJson("resident-mini-program-platform/page-manifest.json").pages;
  const appId = template.platform === "wechat" ? environment.wechatAppId : environment.alipayAppId;
  return {
    ...template,
    appId,
    configurationVerified: environment.platformConfigVerified,
    configurationEvidenceId: environment.platformConfigEvidenceId,
    apiOrigin: environment.apiOrigin,
    businessOrigin: environment.businessOrigin,
    pages,
    grayReleaseEnabled: environment.grayReleaseEnabled,
    grayReleaseRuleId: environment.grayReleaseEnabled ? environment.grayReleaseRuleId : ""
  };
}

function environmentContract() {
  return {
    wechatAppId: process.env.T04_MP_WECHAT_APP_ID || "__WECHAT_APP_ID__",
    alipayAppId: process.env.T04_MP_ALIPAY_APP_ID || "__ALIPAY_APP_ID__",
    apiOrigin: process.env.T04_MP_API_ORIGIN || "https://__API_DOMAIN__",
    businessOrigin: process.env.T04_MP_BUSINESS_ORIGIN || "https://__BUSINESS_DOMAIN__",
    buildNumber: process.env.T04_MP_BUILD_NUMBER || "__BUILD_NUMBER__",
    platformConfigVerified: booleanEnvironment("T04_MP_PLATFORM_CONFIG_VERIFIED"),
    platformConfigEvidenceId: process.env.T04_MP_PLATFORM_CONFIG_EVIDENCE_ID || "__PLATFORM_CONFIG_EVIDENCE_ID__",
    grayReleaseEnabled: booleanEnvironment("T04_MP_GRAY_RELEASE_ENABLED"),
    grayReleaseRuleId: process.env.T04_MP_GRAY_RELEASE_RULE_ID || "",
    emergencyStop: booleanEnvironment("T04_MP_EMERGENCY_STOP"),
    services: {
      identity: booleanEnvironment("T04_MP_IDENTITY_READY"),
      residentScope: booleanEnvironment("T04_MP_RESIDENT_SCOPE_READY"),
      messageReceipt: booleanEnvironment("T04_MP_MESSAGE_RECEIPT_READY"),
      deepLinkSignature: booleanEnvironment("T04_MP_DEEP_LINK_SIGNATURE_READY"),
      notification: booleanEnvironment("T04_MP_NOTIFICATION_READY")
    }
  };
}

function sourceChecks() {
  const sources = sourceAssets.map((relativePath) => ({
    path: relativePath,
    content: fs.readFileSync(path.join(root, relativePath), "utf8")
  }));
  const combined = sources.map((item) => item.content).join("\n");
  const chinese = assessChineseCopy();
  return {
    sources,
    checks: {
      sourceAssetsPresent: sources.length === sourceAssets.length,
      noDebugStatements: !/(?:\bdebugger\b|console\.(?:log|info|warn|error)|__RESIDENT_[A-Z_]*DEBUG)/.test(combined),
      noTestCredentials: !/(?:密码\s*123456|验证码\s*888888|DEMO-MOBILE)/.test(combined),
      noSensitiveLogging: !/(?:console|logger)\s*\.\s*(?:log|info|warn|error)[\s\S]{0,120}(?:token|code|resident|身份证|手机号|病历)/i.test(combined),
      chineseBusinessCopy: chinese.ready
    },
    chinese
  };
}

function buildCandidate(argumentsList = process.argv.slice(2)) {
  const outputDirectory = outputPathFromArguments(argumentsList);
  const environment = environmentContract();
  const wechat = configuredShell("resident-mini-program-platform/wechat.project.template.json", environment);
  const alipay = configuredShell("resident-mini-program-platform/alipay.project.template.json", environment);
  const checked = sourceChecks();
  const release = Delivery.releaseDecision({
    shells: [wechat, alipay],
    version: Delivery.RELEASE_VERSION,
    buildNumber: environment.buildNumber,
    grayReleaseEnabled: environment.grayReleaseEnabled,
    emergencyStop: environment.emergencyStop,
    services: environment.services
  });
  const sourceManifest = checked.sources.map((item) => ({
    path: item.path,
    sha256: sha256(item.content),
    bytes: Buffer.byteLength(item.content)
  }));
  const manifest = {
    module: "T04-MP",
    version: Delivery.RELEASE_VERSION,
    buildNumber: environment.buildNumber,
    deterministicSourceDigest: sha256(JSON.stringify(sourceManifest)),
    sourceAssets: sourceManifest,
    platformPages: readJson("resident-mini-program-platform/page-manifest.json"),
    rollback: {
      strategy: "按确定性源摘要回退到上一已验收构建",
      emergencyStopDefault: false,
      grayReleaseDefault: false
    }
  };
  const report = {
    module: "T04-MP 居民端小程序",
    softwareReady: Object.values(checked.checks).every(Boolean),
    productionReady: Object.values(checked.checks).every(Boolean) && release.productionReady,
    version: release.version,
    buildNumber: release.buildNumber,
    checks: checked.checks,
    platformShells: [Delivery.validatePlatformShell(wechat), Delivery.validatePlatformShell(alipay)],
    blockers: release.blockers,
    outputDirectory
  };

  fs.rmSync(outputDirectory, { recursive: true, force: true });
  fs.mkdirSync(path.join(outputDirectory, "platform"), { recursive: true });
  fs.writeFileSync(path.join(outputDirectory, "platform", "wechat.project.json"), `${JSON.stringify(wechat, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "platform", "alipay.project.json"), `${JSON.stringify(alipay, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "platform", "privacy-map.json"), `${JSON.stringify(readJson("resident-mini-program-platform/privacy-map.json"), null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "release-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDirectory, "release-report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const emittedArtifacts = fs.readdirSync(outputDirectory, { recursive: true })
    .filter((item) => fs.statSync(path.join(outputDirectory, item)).isFile())
    .map((item) => fs.readFileSync(path.join(outputDirectory, item), "utf8"));
  const emitted = emittedArtifacts.join("\n");
  report.checks.noLocalhostInArtifacts = !/(?:localhost|127\.0\.0\.1|\[?::1\]?)/i.test(emitted);
  report.checks.noTestCredentialsInArtifacts = !emittedArtifacts.some(artifactHasTestCredentials);
  report.softwareReady = Object.values(report.checks).every(Boolean);
  report.productionReady = report.softwareReady && release.productionReady;
  fs.writeFileSync(path.join(outputDirectory, "release-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  return report;
}

if (require.main === module) {
  try {
    const report = buildCandidate();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.softwareReady || (process.argv.includes("--production") && !report.productionReady)) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`居民端发布候选构建失败：${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  artifactHasTestCredentials,
  buildCandidate,
  defaultOutput,
  environmentContract,
  outputPathFromArguments,
  sourceAssets
};
