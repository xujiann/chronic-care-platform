"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  browserSecurityReadiness,
  createBrowserSecurityHeaders,
  loadBrowserSecurityPolicy
} = require("../src/http/browser-security-policy");
const {
  riskBaselineFromInventory,
  scanBrowserSecurityInventory,
  verifyBrowserSecurityInventory
} = require("../src/http/browser-security-inventory");
const { collectPublicAssets, loadStaticPublicationContract } = require("../src/http/static-asset-policy");

const ROOT = path.resolve(__dirname, "..");

test("central browser header port keeps the target CSP report-only and production NO-GO", () => {
  const policy = loadBrowserSecurityPolicy();
  const development = createBrowserSecurityHeaders({ policy, production: false });
  const production = createBrowserSecurityHeaders({ policy, production: true });
  const compatibilityCsp = production["Content-Security-Policy"];
  const csp = production["Content-Security-Policy-Report-Only"];

  assert.equal(development["Strict-Transport-Security"], undefined);
  assert.equal(production["Strict-Transport-Security"], "max-age=31536000; includeSubDomains");
  assert.match(compatibilityCsp, /script-src 'self' 'unsafe-inline'/);
  assert.match(compatibilityCsp, /script-src-attr 'none'/);
  assert.doesNotMatch(compatibilityCsp, /unsafe-eval/);
  assert.match(csp, /frame-ancestors 'self'/);
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /script-src-attr 'none'/);
  assert.match(csp, /style-src-attr 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(production["X-Frame-Options"], "SAMEORIGIN");
  assert.equal(production["X-Content-Type-Options"], "nosniff");
  assert.equal(production["Referrer-Policy"], "no-referrer");
  assert.match(production["Permissions-Policy"], /camera=\(\)/);

  const readiness = browserSecurityReadiness({ policy });
  assert.equal(readiness.cspMode, "report-only");
  assert.equal(readiness.compatibilityBaselineEnforced, true);
  assert.equal(readiness.productionReady, false);
  assert.equal(readiness.staticHostingReady, false);
  assert.deepEqual(readiness.blockers, [
    "CSP_REPORT_ONLY",
    "DYNAMIC_BROWSER_STYLE_VALIDATION_REQUIRED",
    "STATIC_HOST_RESPONSE_HEADERS_REQUIRE_EXTERNAL_ENFORCEMENT",
    "INDEPENDENT_BROWSER_SECURITY_ASSESSMENT_REQUIRED"
  ]);
});

test("published browser assets match the exact Inventory v2 fail-closed baseline", () => {
  const policy = loadBrowserSecurityPolicy();
  const assets = collectPublicAssets(ROOT, loadStaticPublicationContract());
  const inventory = scanBrowserSecurityInventory({ root: ROOT, assets });
  const verification = verifyBrowserSecurityInventory(inventory, policy.riskBaseline);

  assert.equal(verification.ok, true);
  assert.equal(inventory.schemaVersion, 2);
  assert.equal(inventory.contractId, "browser-security-risk-inventory.v2");
  assert.equal(inventory.assetsScanned, 145);
  assert.equal(inventory.summary.total, 889);
  assert.equal(inventory.summary.byPriority.P0, 844);
  assert.equal(inventory.summary.byPriority.P1, 45);
  assert.equal(inventory.summary.byPriority.P2, 0);
  assert.equal(inventory.findings.length, 58);
  assert.equal(inventory.summary.byType["inline-script"], 0);
  assert.equal(inventory.summary.byType["inline-style-block"], 0);
  assert.equal(inventory.summary.byType["style-attribute"], 0);
  assert.equal(inventory.summary.byType["event-handler"], 0);
  assert.equal(inventory.summary.byType["eval-call"], 0);
  assert.equal(inventory.summary.byType["dom-inner-html"], 834);
  assert.equal(inventory.summary.byType["dom-insert-adjacent-html"], 4);
  assert.equal(inventory.summary.byType["dynamic-html-url-attribute"], 0);
  assert.equal(inventory.summary.byType["dom-url-property"], 0);
  assert.equal(inventory.summary.byType["dom-url-attribute"], 2);
  assert.equal(inventory.summary.byType["navigation-call"], 4);
  assert.equal(inventory.summary.byType["dynamic-html-style-attribute"], 30);
  assert.equal(inventory.summary.byType["cssom-property-mutation"], 12);
  assert.equal(inventory.summary.byType["cssom-set-property"], 2);
  assert.equal(inventory.summary.byType["runtime-style-element"], 1);
  assert.equal(new Set(inventory.findings.filter((item) => ["dom-inner-html", "dom-insert-adjacent-html"].includes(item.type)).map((item) => item.asset)).size, 35);
  assert.equal(new Set(inventory.findings.filter((item) => ["dynamic-html-style-attribute", "cssom-property-mutation", "cssom-set-property", "runtime-style-element"].includes(item.type)).map((item) => item.asset)).size, 14);
  assert.equal(new Set(inventory.findings.filter((item) => ["dynamic-html-url-attribute", "dom-url-property", "dom-url-attribute", "navigation-call"].includes(item.type)).map((item) => item.asset)).size, 2);
  assert.equal(policy.riskBaseline.schemaVersion, 2);
  assert.equal(policy.riskBaseline.findings.reduce((sum, item) => sum + item.count, 0), 889);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "blood.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "emergency-lifechain-ui.js" && item.type === "dom-inner-html"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "doctor.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "blood-go-live.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "escort.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "product-operations-ui.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "product-regional-operations-ui.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "quality-safety.js"), false);
  assert.equal(policy.riskBaseline.findings.some((item) => item.asset === "regional-cutover-workbench-ui.js"), false);
  assert.equal(policy.safeUrl.contractId, "browser-safe-url-policy.v1");
  assert.equal(policy.safeUrl.controlledSinkOccurrences, 4);
  assert.equal(policy.safeUrl.internallyClosedTemplateOccurrences, 28);
  assert.equal(policy.safeUrl.inventoryFalsePositiveCorrections, 1);
  assert.equal(policy.safeUrl.reviewRequiredOccurrences, 2);
  assert.equal(policy.safeUrl.reviewRequired.reduce((sum, item) => sum + item.count, 0), 2);
  assert.equal(policy.safeUrl.reviewRequired.length, 1);
  assert.equal(policy.safeUrl.reviewRequired.find((item) => item.asset === "imaging-cloud.js").reason, "ohif-exact-origin-allowlist-not-proven");
  assert.equal(inventory.riskTypes["event-handler"].priority, "P0");
  assert.equal(inventory.riskTypes["eval-call"].priority, "P0");
  assert.equal(policy.productionReady, false);
});

test("inventory verification fails closed on a newly introduced high-risk browser construct", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-security-risk-"));
  try {
    fs.writeFileSync(path.join(temporaryRoot, "index.html"), [
      "<!doctype html>",
      "<button onclick=\"runUnsafe()\" style=\"display:block\">open</button>",
      "<script>eval('runUnsafe()')</script>"
    ].join("\n"));
    fs.writeFileSync(path.join(temporaryRoot, "unsafe.js"), [
      "eval('x'); new Function('x'); setTimeout('x', 1);",
      "node.innerHTML = payload; node.insertAdjacentHTML('beforeend', payload); node.outerHTML = payload;",
      "document.write(payload); range.createContextualFragment(payload); frame.srcdoc = payload;",
      "node.setAttribute('onclick', payload);",
      "const markup = `<a href=\"${url}\" style=\"color:${color}\">open</a>`;",
      "item.action = `${item.action}; completed`;",
      "link.href = url; link.setAttribute('src', url); window.open(url);",
      "node.style.color = color; node.style.setProperty('--tone', color); document.createElement('style');"
    ].join("\n"));
    const inventory = scanBrowserSecurityInventory({ root: temporaryRoot, assets: ["index.html", "unsafe.js"] });
    const verification = verifyBrowserSecurityInventory(inventory, {
      schemaVersion: 2,
      sourceRevision: "synthetic-empty-baseline",
      failClosedPriorities: ["P0", "P1"],
      findings: []
    });

    assert.equal(verification.ok, false);
    assert.equal(verification.code, "BROWSER_SECURITY_HIGH_RISK_ADDITION");
    assert.equal(inventory.summary.byType["dynamic-html-url-attribute"], 1);
    assert.deepEqual(new Set(verification.violations.map((item) => item.type)), new Set([
      "inline-script",
      "event-handler",
      "style-attribute",
      "eval-call",
      "function-constructor",
      "string-timer",
      "dom-inner-html",
      "dom-insert-adjacent-html",
      "dom-outer-html",
      "dom-document-write",
      "dom-contextual-fragment",
      "dom-srcdoc",
      "dom-event-attribute",
      "dynamic-html-url-attribute",
      "dom-url-property",
      "dom-url-attribute",
      "navigation-call",
      "dynamic-html-style-attribute",
      "cssom-property-mutation",
      "cssom-set-property",
      "runtime-style-element"
    ]));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("Inventory v2 rejects same-count sink replacement and count growth", () => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "browser-security-drift-"));
  try {
    const asset = path.join(temporaryRoot, "app.js");
    fs.writeFileSync(asset, "panel.innerHTML = trustedMarkup;\n");
    const baselineInventory = scanBrowserSecurityInventory({ root: temporaryRoot, assets: ["app.js"] });
    const baseline = riskBaselineFromInventory(baselineInventory, "synthetic-v2");

    fs.writeFileSync(asset, "panel.innerHTML = unreviewedMarkup;\n");
    const replacement = verifyBrowserSecurityInventory(
      scanBrowserSecurityInventory({ root: temporaryRoot, assets: ["app.js"] }),
      baseline
    );
    assert.equal(replacement.ok, false);
    assert.equal(replacement.violations[0].count, 1);

    fs.writeFileSync(asset, "panel.innerHTML = trustedMarkup;\nother.innerHTML = payload;\n");
    const growth = verifyBrowserSecurityInventory(
      scanBrowserSecurityInventory({ root: temporaryRoot, assets: ["app.js"] }),
      baseline
    );
    assert.equal(growth.ok, false);
    assert.equal(growth.violations[0].count, 2);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("CI and static publication keep the browser security gate wired", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const publication = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "static-publication.json"), "utf8"));

  assert.equal(packageJson.scripts["security:browser:verify"], "node scripts/browser-security-inventory.js verify");
  assert.match(packageJson.scripts["static:check"], /node --check browser-safe-url\.js/);
  assert.match(packageJson.scripts["static:test"], /test\/browser-safe-url\.test\.js/);
  assert.match(ci, /Verify static publication, Safe URL template closure and Browser Inventory v2/);
  assert.match(ci, /npm run security:browser:verify/);
  assert.equal(publication.seedAssets.includes("browser-security-policy.json"), true);
  const publishedAssets = collectPublicAssets(ROOT, publication);
  assert.equal(publishedAssets.includes("browser-safe-url.js"), true);
  publication.entrypoints.forEach((entrypoint) => {
    const html = fs.readFileSync(path.join(ROOT, ...entrypoint.split("/")), "utf8");
    if (!/<script[^>]+auth\.js/.test(html)) return;
    assert.match(html, /<script[^>]+browser-safe-url\.js[^>]*><\/script>[\s\S]*<script[^>]+auth\.js/);
  });
});
