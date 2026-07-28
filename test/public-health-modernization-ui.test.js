"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function loadUiContext() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        className: "",
        innerHTML: "",
        textContent: "",
        disabled: false,
        closest() { return null; }
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    console,
    location: { protocol: "http:" },
    window: {},
    fetch: async () => { throw new Error("network-disabled"); },
    document: {
      addEventListener() {},
      querySelector: node,
      querySelectorAll() { return []; }
    }
  });
  vm.runInContext(read("public-health.js"), context, { filename: "public-health.js" });
  return { context, node };
}

test("modernization page exposes three accessible commission workbenches and controlled routes", () => {
  const html = read("public-health.html");
  const source = read("public-health.js");
  const css = read("portal.css");
  assert.match(html, /aria-label="公共卫生现代化工作台"/);
  assert.match(html, /数据底座/);
  assert.match(html, /监测预警/);
  assert.match(html, /医防协同/);
  assert.match(html, /id="public-health-signal-intake-form"/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /人工责任/);
  assert.match(html, /productionReady 始终为 false/);
  assert.match(source, /\/api\/public-health\/data-foundation/);
  assert.match(source, /\/api\/public-health\/surveillance-center/);
  assert.match(source, /\/api\/public-health\/medical-prevention-tasks/);
  assert.match(source, /\/api\/public-health\/surveillance-signals\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /\/api\/public-health\/surveillance-alerts\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /\/api\/public-health\/medical-prevention-tasks\/\$\{encodeURIComponent\(id\)\}\/actions/);
  assert.match(source, /"Idempotency-Key"/);
  assert.match(source, /expectedVersion/);
  assert.doesNotMatch(source, /productionReady\s*=\s*true/);
  assert.match(css, /\.public-health-modernization-grid/);
  assert.match(css, /\.modernization-form/);
  assert.match(css, /@media \(max-width: 1100px\)/);
});

test("modernization rendering uses only safe summary fields and fails closed when unavailable", () => {
  const { context, node } = loadUiContext();
  context.fixture = {
    foundation: {
      ok: true,
      summary: {
        catalogEntries: 7,
        sources: 8,
        registeredSources: 8,
        signals: 1,
        qualityFindings: 0
      },
      sources: [{ id: "safe-source", name: "临床症候群", owner: "疾控监测", status: "registered" }],
      signals: [{
        id: "safe-signal",
        version: 1,
        signalType: "clinical-syndrome",
        regionCode: "210202",
        institutionId: "medical-institution-001",
        workflowState: "received"
      }],
      productionReady: false
    },
    surveillance: {
      ok: true,
      summary: { rules: 8, activeRules: 8, humanVerifiedSignals: 0, openAlerts: 0, humanRiskAssessments: 0 },
      dataFoundation: { signals: [] },
      alerts: [],
      productionReady: false
    },
    collaboration: {
      ok: true,
      summary: { tasks: 0, openTasks: 0, exceptions: 0, closedTasks: 0 },
      tasks: [],
      productionReady: false
    }
  };
  vm.runInContext("renderPublicHealthModernizationWorkbenches(fixture)", context);
  const rendered = [
    node("#public-health-data-foundation-metrics").innerHTML,
    node("#public-health-data-foundation-sources").innerHTML,
    node("#public-health-surveillance-metrics").innerHTML,
    node("#public-health-surveillance-signals").innerHTML,
    node("#public-health-surveillance-alerts").innerHTML,
    node("#public-health-medical-prevention-metrics").innerHTML,
    node("#public-health-medical-prevention-tasks").innerHTML
  ].join("\n");
  assert.match(rendered, /8\/8/);
  assert.match(rendered, /临床症候群/);
  assert.match(rendered, /人工核实/);
  assert.match(rendered, /暂无预警/);
  assert.doesNotMatch(rendered, /externalSignalId|externalSignalKeyHash|idempotencyKeyHash|contentFingerprint|endpoint|secret|signature/i);

  vm.runInContext(
    "renderPublicHealthModernizationWorkbenches({ foundation: null, surveillance: null, collaboration: null })",
    context
  );
  assert.match(node("#public-health-data-foundation-status").textContent, /失败关闭/);
  assert.match(node("#public-health-surveillance-status").textContent, /失败关闭/);
  assert.match(node("#public-health-medical-prevention-status").textContent, /失败关闭/);
  assert.match(node("#public-health-data-foundation-sources").innerHTML, /按未就绪处理/);
});
