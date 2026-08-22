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
    "INLINE_BROWSER_RISK_BASELINE_OPEN",
    "STATIC_HOST_RESPONSE_HEADERS_REQUIRE_EXTERNAL_ENFORCEMENT",
    "INDEPENDENT_BROWSER_SECURITY_ASSESSMENT_REQUIRED"
  ]);
});

test("published browser assets match the governed inline and eval risk baseline", () => {
  const policy = loadBrowserSecurityPolicy();
  const assets = collectPublicAssets(ROOT, loadStaticPublicationContract());
  const inventory = scanBrowserSecurityInventory({ root: ROOT, assets });
  const verification = verifyBrowserSecurityInventory(inventory, policy.riskBaseline);

  assert.equal(verification.ok, true);
  assert.equal(inventory.summary.total, 58);
  assert.equal(inventory.summary.byPriority.P0, 37);
  assert.equal(inventory.summary.byPriority.P1, 21);
  assert.equal(inventory.summary.byPriority.P2, 0);
  assert.equal(inventory.summary.byType["inline-script"], 37);
  assert.equal(inventory.summary.byType["inline-style-block"], 8);
  assert.equal(inventory.summary.byType["style-attribute"], 13);
  assert.equal(inventory.summary.byType["event-handler"], 0);
  assert.equal(inventory.summary.byType["eval-call"], 0);
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
    fs.writeFileSync(path.join(temporaryRoot, "unsafe.js"), "eval('x'); new Function('x'); setTimeout('x', 1);");
    const inventory = scanBrowserSecurityInventory({ root: temporaryRoot, assets: ["index.html", "unsafe.js"] });
    const verification = verifyBrowserSecurityInventory(inventory, {
      schemaVersion: 1,
      sourceRevision: "synthetic-empty-baseline",
      failClosedPriorities: ["P0", "P1"],
      findings: []
    });

    assert.equal(verification.ok, false);
    assert.equal(verification.code, "BROWSER_SECURITY_HIGH_RISK_ADDITION");
    assert.deepEqual(new Set(verification.violations.map((item) => item.type)), new Set([
      "inline-script",
      "event-handler",
      "style-attribute",
      "eval-call",
      "function-constructor",
      "string-timer"
    ]));
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test("CI and static publication keep the browser security gate wired", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const ci = fs.readFileSync(path.join(ROOT, ".github", "workflows", "ci.yml"), "utf8");
  const publication = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "static-publication.json"), "utf8"));

  assert.equal(packageJson.scripts["security:browser:verify"], "node scripts/browser-security-inventory.js verify");
  assert.match(ci, /npm run security:browser:verify/);
  assert.equal(publication.seedAssets.includes("browser-security-policy.json"), true);
});
