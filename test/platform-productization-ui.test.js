"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

test("platform productization UI is an independent bounded module", () => {
  const html = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "platform-productization-ui.js"), "utf8");
  assert.match(html, /id="platform-productization-panel"/);
  assert.match(html, /platform-productization-ui\.js/);
  assert.match(source, /\/platform\/productization\/center/);
  assert.match(source, /escapeHtml/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*(?:error|message)\.message/);
  assert.ok(Buffer.byteLength(source) < 30000);
});
