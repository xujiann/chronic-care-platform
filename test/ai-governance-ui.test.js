"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const policy = require("../access-control-policy");
const publication = require("../config/static-publication.json");
const root = path.resolve(__dirname, "..");

test("AI governance navigation is commission-only and respects server page restrictions", () => {
  const page = "ai-governance.html";
  const commission = { role: "commission", accountType: "manager" };
  assert.equal(policy.canAccessPage(page, commission), true);
  for (const role of ["institution", "insurance", "county", "citizen", "unknown"]) {
    const user = { role, accountType: "manager" };
    assert.equal(policy.canAccessPage(page, user), false);
    assert.equal(policy.pagesForUser(user).some((item) => item.page === page), false);
  }
  assert.equal(policy.canAccessPage(page, null), false);
  assert.equal(policy.canAccessPage(page, { ...commission, authorizedPages: ["index.html"] }), false);
  const group = policy.menuTreeForUser(commission).find((item) => item.id === "governance");
  assert.ok(group.items.find((item) => item.page === "platform.html").children.some((item) => item.page === page));
  assert.ok(publication.entrypoints.includes(page));
});

test("AI governance surface uses safe DOM, existing authenticated requests and no clinical write endpoints", () => {
  const html = fs.readFileSync(path.join(root, "ai-governance.html"), "utf8");
  const client = fs.readFileSync(path.join(root, "ai-governance-ui.js"), "utf8");
  assert.match(html, /data-roles="commission"/);
  assert.match(html, /productionReady: false/);
  assert.match(html, /doctor\.html#doctor-clinical-assist/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|\beval\s*\(|localStorage|sessionStorage/);
  assert.match(client, /textContent/);
  assert.match(client, /authFetch/);
  assert.match(client, /credentials: "same-origin"/);
  assert.match(client, /expectedVersion: selected\.governance\.version/);
  assert.match(client, /"Idempotency-Key": body\.idempotencyKey/);
  assert.doesNotMatch(client, /\/api\/(residents|prescriptions|phase2\/clinical-assist)/);
});
