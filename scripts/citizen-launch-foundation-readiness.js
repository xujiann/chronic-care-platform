#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "citizen-launch-foundation-readiness.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "citizen-launch-foundation-readiness.md");

function readText(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(readText(relativePath));
}

function hasAll(text, patterns) {
  return patterns.every((pattern) => pattern.test(text));
}

function buildCitizenLaunchFoundationReadiness(options = {}) {
  const pkg = options.pkg ?? readJson("package.json");
  const manifest = options.manifest ?? readJson("manifest.webmanifest");
  const auth = options.auth ?? readText("auth.js");
  const login = options.login ?? readText("login.html");
  const citizenHtml = options.citizenHtml ?? readText("citizen.html");
  const citizenJs = options.citizenJs ?? readText("citizen.js");
  const mobilePreview = options.mobilePreview ?? readText("mobile-preview.html");
  const serviceWorker = options.serviceWorker ?? readText("service-worker.js");
  const auditDoc = options.auditDoc ?? readText("docs/C端全流程审计与优化清单.md");
  const phaseDoc = options.phaseDoc ?? "";
  const manifestUrls = new Set((manifest.shortcuts || []).map((item) => item.url));
  const checks = [
    {
      id: "citizen-foundation:phone-login",
      passed: hasAll(auth + login, [/loginByPhone/, /sendPhoneCode/, /phone-login-form/, /data-send-phone-code/, /phone-code-hint/, /DEMO-MOBILE-R1/, /888888/]) &&
        hasAll(readText("server.js"), [/\/api\/auth\/phone-code/, /PHONE_CODE_TTL_MS/, /PHONE_CODE_COOLDOWN_MS/, /PHONE_LOGIN_MAX_FAILED_ATTEMPTS/, /PHONE_LOGIN_LOCK_MS/, /maskPhone/, /\/api\/auth\/phone-login/]),
      detail: "phone verification code issuing, cooldown, expiry, failed-attempt lockout, masked response, and login are wired to resident auth"
    },
    {
      id: "citizen-foundation:phone-code-delivery",
      passed: hasAll(auth + login, [/sendPhoneCode/, /\/auth\/phone-code/, /data-send-phone-code/, /phone-code-hint/, /retryAfterSeconds/, /expiresAt/]),
      detail: "resident phone-code delivery exposes send action, cooldown, expiry, and demo gateway evidence"
    },
    {
      id: "citizen-foundation:mobile-install-shell",
      passed: hasAll(citizenHtml, [/rel="manifest"/, /mobile-web-app-capable/, /apple-mobile-web-app-capable/, /apple-touch-icon/]) &&
        manifest.id === "./citizen.html?client=app" &&
        manifest.display === "standalone" &&
        Array.isArray(manifest.display_override) &&
        manifest.display_override.includes("minimal-ui") &&
        manifest.prefer_related_applications === false,
      detail: "Android/iOS add-to-home-screen and PWA identity settings are present"
    },
    {
      id: "citizen-foundation:app-shortcuts",
      passed: manifestUrls.has("./citizen.html?client=app&page=health-record#service-health-record") &&
        manifestUrls.has("./citizen.html?client=app&page=emr#service-emr") &&
        manifestUrls.has("./citizen.html?client=app&page=escort#service-escort") &&
        manifestUrls.has("./mobile-preview.html?client=app"),
      detail: "manifest exposes health archive, EMR, escort, and app preview shortcuts"
    },
    {
      id: "citizen-foundation:mini-app-app-routing",
      passed: hasAll(citizenJs + mobilePreview, [/citizenClientChannels/, /mini-program/, /clientChannelEntry/, /copyClientEntry/, /launchChecklist/, /previewParams\.get\("client"\)/]),
      detail: "mini-program and app channel routing, copyable entry links, and preview query handling are present"
    },
    {
      id: "citizen-foundation:launch-gates",
      passed: hasAll(citizenJs, [/HTTPS/, /隐私协议/, /资质/, /消息模板/, /应用签名/, /推送证书/, /崩溃监控/]) &&
        hasAll(auditDoc, [/小程序与 APP 运行形态/, /APP\/PWA 手机安装配置/, /多系统真实接入/]),
      detail: "external launch blockers are surfaced instead of hidden"
    },
    {
      id: "citizen-foundation:offline-cache",
      passed: /CACHE_NAME = "chronic-care-citizen-v\d+"/.test(serviceWorker) &&
        /manifest\.webmanifest/.test(serviceWorker) &&
        /pwa-icon\.svg/.test(serviceWorker) &&
        /citizen\.html/.test(serviceWorker) &&
        /cache: "no-store"/.test(serviceWorker),
      detail: "offline shell caches resident app and refreshes HTML/JS/CSS from network first"
    },
    {
      id: "citizen-foundation:script-wiring",
      passed: Boolean(pkg.scripts?.["citizen:launch-foundation"]) &&
        /citizen-launch-foundation-readiness\.js/.test(pkg.scripts["citizen:launch-foundation"]) &&
        /citizen-launch-foundation-readiness\.js/.test(pkg.scripts.check || "") &&
        /citizen-launch-foundation-readiness\.test\.js/.test(pkg.scripts.test || ""),
      detail: "phase-one readiness script is available in check and test flows"
    },
    {
      id: "citizen-foundation:phase-document",
      passed: /Phase 1/.test(phaseDoc) &&
        /identity/.test(phaseDoc) &&
        /SMS/.test(phaseDoc) &&
        /real-name/.test(phaseDoc) &&
        /guardian/.test(phaseDoc),
      detail: "phase-one scope and external integration boundaries are documented"
    }
  ];
  const externalDependencies = [
    { id: "sms-gateway", label: "production SMS gateway", status: "required-before-production" },
    { id: "real-name-identity", label: "real-name identity verification", status: "required-before-production" },
    { id: "guardian-relation", label: "guardian and household relationship verification", status: "required-before-production" },
    { id: "https-domain", label: "HTTPS domain, filing, and privacy agreement", status: "required-before-production" },
    { id: "app-signing-monitoring", label: "app signing, push certificates, crash monitoring, and upgrade channel", status: "required-before-production" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    phase: "Phase 1 - launch foundation",
    launchState: "controlled-pilot-ready",
    summary: {
      checks: checks.length,
      passed: checks.filter((item) => item.passed).length,
      externalDependencies: externalDependencies.length,
      channels: ["mini-program", "app", "pwa"]
    },
    externalDependencies,
    checks
  };
}

function renderMarkdown(report) {
  return [
    "# Citizen launch foundation readiness",
    "",
    `Generated at: ${report.generatedAt}`,
    `Phase: ${report.phase}`,
    `Result: ${report.ok ? "PASS" : "FAIL"}`,
    `Launch state: ${report.launchState}`,
    "",
    "## External Dependencies",
    "",
    "| Dependency | Status |",
    "| --- | --- |",
    ...report.externalDependencies.map((item) => `| ${item.label} | ${item.status} |`),
    "",
    "## Checks",
    "",
    "| Status | Check | Detail |",
    "| --- | --- | --- |",
    ...report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`)
  ].join("\n");
}

function writeReport(report, output = DEFAULT_OUTPUT, markdown = DEFAULT_MARKDOWN) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ok: report.ok, citizenLaunchFoundationReadiness: report }, null, 2), "utf8");
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function main() {
  const phaseDocPath = "docs/citizen-launch-foundation-plan.md";
  const report = buildCitizenLaunchFoundationReadiness({
    phaseDoc: fs.existsSync(path.join(ROOT, phaseDocPath)) ? readText(phaseDocPath) : ""
  });
  writeReport(report);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  buildCitizenLaunchFoundationReadiness,
  renderMarkdown,
  writeReport
};
