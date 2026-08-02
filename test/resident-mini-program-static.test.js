const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");

test("resident mini program shell loads the strict policy and dedicated assets", () => {
  const html = read("resident-mini-program.html");
  for (const asset of [
    "resident-mini-program.css",
    "auth.js",
    "citizen-records-v1.js",
    "citizen-records-v2.js",
    "resident-mini-program-policy.js",
    "resident-mini-program-core.js",
    "resident-mini-program-adapter.js",
    "resident-mini-program.js"
  ]) assert.match(html, new RegExp(asset.replace(/\./g, "\\.")));
  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /消息与待办/);
  assert.match(html, /家庭健康管理/);
  assert.match(read("resident-mini-program.js"), /拨打急救电话一二零/);
});

test("resident-facing static copy is Chinese and internal statuses are mapped", () => {
  const html = read("resident-mini-program.html")
    .replace(/<!doctype[^>]*>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<style[\s\S]*?<\/style>/g, "")
    .replace(/<[^>]+>/g, " ");
  const visibleEnglish = html.match(/[A-Za-z]{2,}/g) || [];
  assert.deepEqual(visibleEnglish, []);

  const core = read("resident-mini-program-core.js");
  for (const status of ["active", "pending", "completed", "sent", "read", "delivered", "cancel-requested"]) {
    assert.match(core, new RegExp(`(?:${status}|${JSON.stringify(status)})\\s*:`));
  }
  assert.match(core, /if \(\/\[A-Za-z\]\{2,\}\//);
});

test("mobile layout has no fixed wide surface and primary targets are at least 44 pixels", () => {
  const css = read("resident-mini-program.css");
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /width:\s*min\(100%,\s*520px\)/);
  assert.match(css, /overflow-x:\s*(hidden|clip)/);
  assert.doesNotMatch(css, /\.mini-app\s*\{[^}]*width:\s*(?:[4-9]\d{2}|[1-9]\d{3,})px/s);
  assert.match(css, /body\.large-text/);
  assert.match(css, /body\.high-contrast/);
  assert.match(css, /prefers-reduced-motion/);
});

test("client writes wait for authenticated server responses and never create download links", () => {
  const app = read("resident-mini-program.js");
  assert.match(app, /\/api\/auth\/me/);
  assert.match(app, /\/api\/messages\/\$\{encodeURIComponent\(intent\.messageId\)\}\/receipt/);
  assert.match(app, /Core\.confirmMessageReceipt/);
  assert.match(app, /未收到有效回执，消息仍保持未读/);
  assert.doesNotMatch(app, /URL\.createObjectURL|download\s*=|auditHash|objectKey|permanentUrl/);
  assert.doesNotMatch(app, /localStorage\.setItem\([^)]*(?:resident|token|record|message)/i);
});
