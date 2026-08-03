#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
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
  const mobilePreviewCss = options.mobilePreviewCss ?? readText("mobile-preview.css");
  const serviceWorker = options.serviceWorker ?? readText("service-worker.js");
  const auditDoc = options.auditDoc ?? readText("docs/C端全流程审计与优化清单.md");
  const phaseDoc = options.phaseDoc ?? "";
  const productionRequirements = options.productionRequirements ?? readText("docs/citizen-production-launch-requirements.md");
  const productionAdapters = options.productionAdapters ?? readText("production-adapters.js");
  const server = options.server ?? readRuntimeSource(ROOT);
  const platformHtml = options.platformHtml ?? readText("platform.html");
  const platformJs = options.platformJs ?? readText("platform.js");
  const manifestUrls = new Set((manifest.shortcuts || []).map((item) => item.url));
  const checks = [
    {
      id: "citizen-foundation:phone-login",
      passed: hasAll(auth + login, [/loginByPhone/, /sendPhoneCode/, /phone-login-form/, /data-send-phone-code/, /phone-code-hint/, /DEMO-MOBILE-R1/, /888888/]) &&
        hasAll(readRuntimeSource(ROOT), [/\/api\/auth\/phone-code/, /PHONE_CODE_TTL_MS/, /PHONE_CODE_COOLDOWN_MS/, /PHONE_LOGIN_MAX_FAILED_ATTEMPTS/, /PHONE_LOGIN_LOCK_MS/, /maskPhone/, /\/api\/auth\/phone-login/]),
      detail: "phone verification code issuing, cooldown, expiry, failed-attempt lockout, masked response, and login are wired to resident auth"
    },
    {
      id: "citizen-foundation:phone-code-delivery",
      passed: hasAll(auth + login, [/sendPhoneCode/, /\/auth\/phone-code/, /data-send-phone-code/, /phone-code-hint/, /retryAfterSeconds/, /expiresAt/]),
      detail: "resident phone-code delivery exposes send action, cooldown, expiry, and demo gateway evidence"
    },
    {
      id: "citizen-foundation:sms-delivery-callback",
      passed: hasAll(productionAdapters, [/verifySmsDeliveryCallback/, /signSmsDeliveryCallback/, /applySmsDeliveryCallback/, /SMS_CALLBACK_REPLAY_DETECTED/, /terminal-conflict/, /buildSmsDeliveryCenter/]) &&
        hasAll(server, [/\/api\/auth\/sms-delivery-callback/, /\/api\/auth\/sms-deliveries/, /recordSmsDeliveryAcceptance/, /sms delivery callback/]) &&
        hasAll(platformHtml + platformJs, [/sms-delivery-status/, /sms-delivery-metrics/, /sms-delivery-receipts/, /renderIdentityLifecycleCenter/]),
      detail: "signed final-delivery callbacks enforce skew, replay, idempotency and ordered status persistence with commission operations visibility"
    },
    {
      id: "citizen-foundation:account-provisioning-boundary",
      passed: hasAll(login, [/data-account-provisioning/, /data-provisioning-step="resident"/, /data-provisioning-step="doctor"/, /data-provisioning-step="nurse"/, /data-provisioning-step="audit"/, /data-provisioning-owner/, /居民端暂不开放自助注册/, /实名建档/, /手机号绑定/, /第一执业机构确认/, /电子化注册核验/, /doctorId 绑定/, /账号审计留痕/, /居民主索引管理员/, /平台账号管理员/, /authUsers/]) &&
        !/id="register-form"|\/api\/auth\/register/.test(login + auth + readRuntimeSource(ROOT)),
      detail: "resident login states account provisioning workflow and does not expose public self-registration"
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
      passed: hasAll(citizenJs + mobilePreview, [/citizenClientChannels/, /mini-program/, /clientChannelEntry/, /copyClientEntry/, /copyLaunchMaterials/, /copyTextToClipboard/, /data-copy-launch-materials/, /isLaunchReviewMode/, /launch-review-mode/, /launch=1/, /launchChecklist/, /productionMaterials/, /productionMaterialSummary/, /client-material-summary/, /client-production-materials/, /owner/, /acceptance/, /SMS_GATEWAY_URL/, /OIDC/, /previewParams\.get\("client"\)/]),
      detail: "mini-program and app channel routing, copyable entry links, launch-review materials, copyable production-material owners, acceptance prompts, and preview query handling are present"
    },
    {
      id: "citizen-foundation:pipeline-acceptance-checklist",
      passed: hasAll(citizenHtml + citizenJs + auditDoc, [/citizen-pipeline-panel/, /citizen-pipeline-grid/, /copy-citizen-pipeline-audit/, /copyCitizenPipelineAcceptance/, /C端全管线现场验收清单/, /复制验收清单/, /onsiteAcceptance/, /现场动作/, /平台信息科\/身份集成组/, /互联网医院\/HIS 联调组/, /移动端发布组\/运营合规组/, /registration:integration-readiness/]),
      detail: "C-end pipeline audit exposes copyable onsite acceptance checklist with owners, blockers, actions, and evidence"
    },
    {
      id: "citizen-foundation:mobile-preview-service-switch",
      passed: hasAll(mobilePreview, [/preview-service-select/, /preview-service-stepper/, /preview-prev-service/, /preview-next-service/, /preview-service-position/, /previewServicePosition\.setAttribute\("aria-label"/, /previewPrevService\.title = previousService/, /previewNextService\.title = nextService/, /preview-focus-mode/, /进入手机验收模式/, /preview-swipe-hint/, /滑动切换服务/, /preview-readiness-summary/, /preview-readiness-method/, /preview-handoff-card/, /previewServiceMeta/, /renderPreviewHandoffCard/, /生产化提示/, /项已实现能力/, /preview-copy-summary/, /preview-acceptance-summary/, /previewAcceptanceSummaryText/, /previewAcceptanceSummary\.classList\.add\("is-visible"\)/, /居民端手机验收摘要/, /DEMO-MOBILE-R1 \/ 888888/, /摘要已复制/, /preview-priority/, /下一步优先级/, /P0/, /P1/, /P2/, /P3/, /验收摘要/, /验收方式：点击、方向键、滑动、复制入口/, /alignFocusPreview/, /window\.scrollTo\(\{ top: Math\.max\(0, targetTop\), left: 0, behavior: "auto" \}\)/, /handlePreviewSwipe/, /bindPreviewSwipeTarget/, /frame\.contentDocument/, /touchstart/, /touchend/, /data-preview-service="escort"/, /data-preview-service="registration"/, /citizenPreviewSrc\(service\)/]) &&
        hasAll(mobilePreviewCss, [/body\.preview-focus-mode \.preview-shell/, /body\.preview-focus-mode \.preview-copy/, /body\.preview-focus-mode \.preview-device/, /body\.preview-focus-mode \.phone-frame/, /preview-swipe-hint/, /#preview-readiness-summary/, /#preview-readiness-method/, /preview-handoff-card/, /body\.preview-focus-mode \.preview-handoff-card/, /preview-copy-summary/, /preview-acceptance-summary/, /preview-acceptance-summary\.is-visible/, /preview-priority/, /scroll-margin-top: 12px/, /touch-action: pan-y/]) &&
        hasAll(citizenJs, [/bindCitizenServiceSwipe/, /CITIZEN_SERVICE_SWIPE_THRESHOLD/, /CITIZEN_SERVICE_SWIPE_VERTICAL_LIMIT/, /touchstart/, /touchend/, /adjacentCitizenServiceTab\(dx < 0 \? 1 : -1\)/, /service-mobile-actionbar/, /data-mobile-primary-action/, /data-mobile-feature-list/]) &&
        !/internet-nursing\.html\?preview=mobile-nursing/.test(mobilePreview),
      detail: "mobile preview keeps service selector, previous/next controls, visible swipe hint, swipe gestures, resident in-page swipe navigation, acceptance summary, priority roadmap, focus-mode layout, auto-aligned viewport, accessible position text, and resident-page service routing"
    },
    {
      id: "citizen-foundation:launch-gates",
      passed: hasAll(citizenJs, [/HTTPS/, /隐私协议/, /资质/, /消息模板/, /应用签名/, /推送证书/, /崩溃监控/]) &&
        hasAll(auditDoc, [/小程序与 APP 运行形态/, /APP\/PWA 手机安装配置/, /多系统真实接入/]),
      detail: "external launch blockers are surfaced instead of hidden"
    },
    {
      id: "citizen-foundation:offline-cache",
      passed: /CACHE_NAME = "chronic-care-citizen-v\d+(?:-[\w-]+)?"/.test(serviceWorker) &&
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
    },
    {
      id: "citizen-foundation:production-requirements",
      passed: hasAll(productionRequirements, [/SMS_GATEWAY_URL/, /SMS_DELIVERY_CALLBACK_SECRET/, /OIDC_\*/, /HIS\/EMR\/LIS\/PACS/, /POST \/api\/auth\/phone-login/, /POST \/api\/auth\/sms-delivery-callback/, /GET \/api\/messages/, /npm\.cmd run citizen:launch-foundation/, /launch:smoke/, /T0/, /T3/]),
      detail: "production launch requirements cover identity, SMS, medical interfaces, messages, smoke tests, and pilot rollout"
    }
  ];
  const externalDependencies = [
    {
      id: "sms-gateway",
      label: "production SMS gateway",
      status: "required-before-production",
      owner: "platform-ops",
      cutoverBlocker: "phone-code login cannot open to production residents without delivery callback proof",
      evidence: "signed SMS gateway contract, delivery callback URL, throttling limits, and launch test receipt",
      onsiteAcceptance: "send code, verify callback, and archive a masked resident receipt during launch rehearsal"
    },
    {
      id: "real-name-identity",
      label: "real-name identity verification",
      status: "required-before-production",
      owner: "identity-integration",
      cutoverBlocker: "resident account binding and guardian authorization remain pilot-only until claims are verified",
      evidence: "OIDC issuer, client credentials, claim mapping, and real-name verification acceptance record",
      onsiteAcceptance: "run a real-name login sample and confirm residentId/personIndex binding in the audit log"
    },
    {
      id: "guardian-relation",
      label: "guardian and household relationship verification",
      status: "required-before-production",
      owner: "resident-master-index",
      cutoverBlocker: "family-member delegation must stay closed without relationship source and manual-review evidence",
      evidence: "guardian relationship source, manual review queue, and household binding audit sample",
      onsiteAcceptance: "complete one approved and one rejected guardian-binding sample with reviewer trace"
    },
    {
      id: "https-domain",
      label: "HTTPS domain, filing, and privacy agreement",
      status: "required-before-production",
      owner: "security-compliance",
      cutoverBlocker: "mobile containers and resident privacy notice cannot be published without a formal HTTPS origin",
      evidence: "domain filing, TLS certificate, privacy agreement URL, and penetration test acceptance",
      onsiteAcceptance: "open the HTTPS resident entry, privacy URL, and penetration-test acceptance record on site"
    },
    {
      id: "app-signing-monitoring",
      label: "app signing, push certificates, crash monitoring, and upgrade channel",
      status: "required-before-production",
      owner: "mobile-release",
      cutoverBlocker: "APP/mini-program release remains review-only until signed packages and monitoring are active",
      evidence: "app signing certificate, push certificate, crash monitor project, and staged upgrade plan",
      onsiteAcceptance: "install signed package, trigger a test push, and verify crash/upgrade monitoring dashboards"
    }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    phase: "Phase 1 - launch foundation",
    launchState: "controlled-pilot-ready",
    acceptancePanel: {
      entry: "citizen.html?client=app&page=health-record&launch=1#citizen-pipeline-panel",
      panelId: "citizen-pipeline-panel",
      copyActionId: "copy-citizen-pipeline-audit",
      checklistTitle: "C端全管线现场验收清单"
    },
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
    "## Resident Acceptance Panel",
    "",
    `- Entry: ${report.acceptancePanel.entry}`,
    `- Panel: ${report.acceptancePanel.panelId}`,
    `- Copy action: ${report.acceptancePanel.copyActionId}`,
    `- Checklist: ${report.acceptancePanel.checklistTitle}`,
    "",
    "## External Dependencies",
    "",
    "| Dependency | Status | Owner | Cutover blocker | Required evidence | Onsite acceptance |",
    "| --- | --- | --- | --- | --- | --- |",
    ...report.externalDependencies.map((item) => `| ${item.label} | ${item.status} | ${item.owner} | ${item.cutoverBlocker} | ${item.evidence} | ${item.onsiteAcceptance} |`),
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
