"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("structured dialog uses safe DOM construction and is loaded by platform", () => {
  const source = fs.readFileSync(path.join(ROOT, "structured-dialog.js"), "utf8");
  const pages = ["platform.html", "disease-payment.html", "imaging-cloud.html", "citizen.html", "operations.html", "public-health.html"];
  assert.match(source, /createElement/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|window\.prompt/);
  pages.forEach((page) => assert.match(fs.readFileSync(path.join(ROOT, page), "utf8"), /structured-dialog\.js/, page));
});

test("interactive frontends no longer call the native browser prompt", () => {
  const files = ["pilot-acceptance-ui.js", "disease-payment.js", "imaging-cloud.js", "citizen.js", "operations.js", "production-security.js", "production-go-no-go-ui.js", "public-health.js"];
  files.forEach((file) => assert.doesNotMatch(fs.readFileSync(path.join(ROOT, file), "utf8"), /window\.prompt/, file));
});
