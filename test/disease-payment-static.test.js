"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("DRG workbench exposes hierarchy, analytics and per-case preview controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "disease-payment.js"), "utf8");
  ["data-drg-section=\"workbench\"", "id=\"drg-profile\"", "id=\"drg-hierarchy\"", "id=\"drg-analytics\""].forEach((marker) => assert.ok(html.includes(marker), marker));
  ["renderDrgWorkbench", "preview-drg", "/drg/simulate", "g.mdcCode} → ${g.adrgCode} → ${g.groupCode"].forEach((marker) => assert.ok(script.includes(marker), marker));
});

test("payment parameter governance exposes simulation dual review and publish controls", () => {
  const html = fs.readFileSync(path.join(ROOT, "disease-payment.html"), "utf8");
  const script = fs.readFileSync(path.join(ROOT, "disease-payment.js"), "utf8");
  ["data-payment-section=\"parameter-governance\"", "parameter-version-list", "parameter-impact-list", "创建下一版参数草案"].forEach((marker) => assert.ok(html.includes(marker), marker));
  ["renderParameterGovernance", "parameter-simulate", "parameter-review", "parameter-publish", "/parameters/"].forEach((marker) => assert.ok(script.includes(marker), marker));
});
