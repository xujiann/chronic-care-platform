"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const api = require("../citizen-records-v2");

const source = fs.readFileSync(path.join(__dirname, "../citizen.js"), "utf8");
const between = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const commands = ["correction-submit", "share-create", "access-dispute", "access-acknowledge", "share-revoke", "care-task-complete"];
const formIds = { "correction-submit": "#citizen-correction-form", "share-create": "#citizen-share-package-form", "access-dispute": "#citizen-access-dispute-form" };

// Execute the real handlers, request/receipt pipeline, cache functions and render entry.
// Successful responses for the three not-yet-integrated POST contracts are synthetic;
// this matrix proves client isolation, never backend authorization or implementation.
function harness({ online = true } = {}) {
  const effects = [], forms = {}, handlers = {}, storage = [];
  const session = new Map();
  const expiresAt = new Date(Date.now() + 86400000).toISOString();
  const values = { recordId: "record-1", field: "summary", requestedValue: "synthetic", reason: "original draft", granteeId: "demo-institution", purpose: "synthetic audit", expiresAt, accessLogId: "access-1", category: "other", contactPreference: "in-app" };
  for (const id of Object.values(formIds)) {
    forms[id] = {
      elements: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { value }])),
      addEventListener: (type, fn) => { handlers[id] = fn; },
      querySelectorAll: () => [{ value: "emr-summary" }],
      reset() { effects.push("reset"); this.elements.reason.value = ""; }
    };
  }
  const section = { addEventListener: (type, fn) => { handlers.section = fn; } };
  const posts = [], gets = [];
  const context = vm.createContext({
    API_BASE: online ? "https://example.test/api" : "",
    state: { residents: [{ id: "r1" }, { id: "r2" }], diseases: [], followups: [] },
    citizenCareSession: session, citizenCareSyncStatus: new Map(), citizenExtra: {}, CITIZEN_EXTRA_KEY: "synthetic-care",
    window: { CitizenRecordsV2: api, confirm: () => true, HealthCityAuth: {
      authFetch: (url, options) => new Promise((resolve, reject) => {
        if (options.method === "POST") posts.push({ url, body: JSON.parse(options.body), resolve, reject });
        else gets.push({ url, resolve, reject });
      })
    } },
    document: { querySelector: (selector) => selector === "#citizen-care-workspace" ? section : forms[selector] || (selector.startsWith("#profile-") ? {} : null), querySelectorAll: () => [] },
    localStorage: { setItem: (key, value) => storage.push({ key, value }) },
    applyCitizenRecordAccessibility() {}, getCurrentAccount() {}, assessRisk: () => ({}), getPersonalRecords: () => [], ageOf: () => 0,
    showToast: (text) => effects.push(`toast:${text}`)
  });
  const render = between("function renderCitizen(residentId)", "\nfunction bindLargeMode()");
  for (const name of [...render.matchAll(/^  (render\w+)\(/gm)].map((match) => match[1])) context[name] = () => {};
  context.renderCitizenCareWorkspace = () => effects.push("render");
  const helpersStart = source.includes("function captureCitizenCareContext()") ? "function captureCitizenCareContext()" : "function bindCitizenCareWorkspace()";
  vm.runInContext([
    between("let currentResidentId;", "\ndocument.addEventListener(\"DOMContentLoaded\""),
    between("function clearCitizenCareLocalPreview(", "\nfunction renderCitizenCareSyncStatus("),
    between("function renderCitizenCareSyncStatus(", "\nfunction scheduleCitizenCareWorkspaceSync("),
    between("function markCitizenCareActionSynced(", "\nfunction citizenCareEmpty("),
    between("function citizenCareRequestNonce()", "\nfunction currentRecordAccessibility()"),
    between(helpersStart, "\nfunction cleanTextForSpeech("), render,
    "bindCitizenCareWorkspace(); renderCitizen('r1');"
  ].join("\n"), context, { filename: "citizen.js" });
  for (const id of ["r1", "r2"]) {
    const cache = context.ensureCitizenCareCollections(id);
    if (!online) cache.careWorkspaceMeta = api.buildCarePreviewMetadata();
    cache.recordSharePackages.push(api.buildSharePackage({ residentId: id, granteeId: "demo-institution", purpose: "synthetic audit", scopes: ["emr-summary"], expiresAt }));
  }
  effects.length = 0;
  return {
    effects, posts, gets, forms, storage, context,
    cache: (id) => context.ensureCitizenCareCollections(id),
    switchTo(id) { context.renderCitizen(id); effects.length = 0; },
    start(command) {
      if (formIds[command]) return handlers[formIds[command]]({ preventDefault() {}, currentTarget: forms[formIds[command]] });
      const selector = { "access-acknowledge": "[data-acknowledge-access]", "share-revoke": "[data-revoke-share-package]", "care-task-complete": "[data-care-task-complete]" }[command];
      const button = { dataset: { acknowledgeAccess: "access-1", revokeSharePackage: context.ensureCitizenCareCollections("r1").recordSharePackages[0].id, careTaskComplete: "task-1" } };
      return handlers.section({ target: { closest: (value) => value === selector ? button : null } });
    },
    reply(overrides = {}) { posts[0].resolve({ ok: true, json: async () => ({ ...posts[0].body, receiptId: "synthetic-receipt", auditRef: "synthetic-audit", ...overrides }) }); }
  };
}

for (const command of ["share-revoke", "care-task-complete"]) {
  for (const missing of [false, true]) {
    test(`${command}: real refresh replacement ${missing ? "missing target is not recreated" : "receives the pending receipt"}`, async () => {
      const ui = harness();
      const original = ui.cache("r1");
      const originalPackage = original.recordSharePackages[0];
      const pending = ui.start(command);
      ui.switchTo("r2");
      ui.switchTo("r1");
      // A user-cleared cache plus a fresh empty snapshot must not resurrect old rows.
      if (missing) ui.context.citizenCareSession.delete("r1");
      const refresh = ui.context.refreshCitizenCareWorkspace("r1", { silent: true });
      ui.gets[0].resolve({ ok: true, json: async () => ({
        sharePackages: missing ? [] : [{ ...originalPackage, purpose: "new authoritative metadata" }],
        taskUpdates: [
          ...(!missing ? [{ id: "task-1", residentId: "r1", status: "in-progress" }] : []),
          { id: "untouched-task", residentId: "r1", status: "pending-resident" }
        ],
        syncedAt: new Date().toISOString()
      }) });
      await refresh;
      const replacement = ui.cache("r1");
      assert.notEqual(replacement, original);
      ui.effects.length = 0;
      ui.reply();
      await pending;
      assert.equal(receipts(original).length, 0, "detached cache must not receive the receipt");
      assert.equal(receipts(replacement).length, missing ? 0 : 1);
      assert.equal(replacement.careTaskUpdates["untouched-task"].status, "pending-resident");
      assert.equal(ui.context.citizenCareSyncStatus.get("r1").label.startsWith("在线已确认"), !missing);
      assert.deepEqual(ui.effects, [], "a refresh must not restore the old view generation");
      if (!missing && command === "share-revoke") {
        assert.equal(replacement.recordSharePackages[0].status, "revoked");
        assert.equal(replacement.recordSharePackages[0].purpose, "new authoritative metadata");
      }
      if (missing) {
        assert.equal(replacement.recordSharePackages.length, 0);
        assert.equal(Object.hasOwn(replacement.careTaskUpdates, "task-1"), false);
      }
    });
  }
}

function receipts(cache) {
  return Object.entries(cache).flatMap(([key, value]) => key === "sync" ? [] : Array.isArray(value) ? value : Object.values(value || {})).filter((item) => item.receiptId);
}

for (const command of commands) {
  for (const route of ["r1-r2", "ABA"]) {
    for (const outcome of ["success", "failure"]) {
      test(`${command}: ${route} late ${outcome} remains bound to its initiating view`, async () => {
        const ui = harness();
        const pending = ui.start(command);
        assert.equal(ui.posts.length, 1);
        assert.equal(ui.posts[0].body.residentId, "r1");
        ui.switchTo("r2");
        if (route === "ABA") ui.switchTo("r1");
        const form = ui.forms[formIds[command]];
        if (form) form.elements.reason.value = "new-view-draft";
        if (outcome === "success") ui.reply();
        else ui.posts[0].reject(new Error("synthetic late error"));
        await pending;
        assert.deepEqual(ui.effects, []);
        assert.equal(form?.elements.reason.value, form ? "new-view-draft" : undefined);
        assert.equal(receipts(ui.cache("r2")).length, 0);
        assert.equal(receipts(ui.cache("r1")).length, outcome === "success" ? 1 : 0);
        assert.equal(ui.context.citizenCareSyncStatus.has("r2"), false);
        assert.equal(ui.context.citizenCareSyncStatus.has("r1"), outcome === "success");
        assert.equal(ui.storage.length, 0);
      });
    }
  }
  test(`${command}: current-view success/failure, mismatched receipt and file preview stay bounded`, async () => {
    for (const outcome of ["success", "failure", "wrong-resident", "wrong-resource", "file"]) {
      const ui = harness({ online: outcome !== "file" });
      const pending = ui.start(command);
      if (outcome === "failure") ui.posts[0].reject(new Error("synthetic current error"));
      else if (outcome !== "file") ui.reply(outcome === "wrong-resident" ? { residentId: "r2" } : outcome === "wrong-resource" ? { resourceId: "other-resource" } : {});
      await pending;
      const success = ["success", "file"].includes(outcome);
      assert.equal(receipts(ui.cache("r1")).length, success ? 1 : 0, outcome);
      assert.equal(receipts(ui.cache("r2")).length, 0, outcome);
      assert.equal(ui.effects.includes("render"), success, outcome);
      assert.equal(ui.effects.filter((item) => item.startsWith("toast:")).length, 1, outcome);
      assert.equal(ui.effects.includes("reset"), success && Boolean(formIds[command]), outcome);
      assert.equal(ui.storage.length > 0, outcome === "file", outcome);
    }
  });
}
