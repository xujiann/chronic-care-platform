"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function uiContext() {
  const nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector)) {
      nodes.set(selector, {
        className: "",
        innerHTML: "",
        textContent: ""
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    console,
    location: { protocol: "http:" },
    window: {},
    fetch: async () => {
      throw new Error("network-disabled");
    },
    document: {
      addEventListener() {},
      querySelector: node
    }
  });
  vm.runInContext(read("public-health.js"), context, { filename: "public-health.js" });
  return { context, node };
}

test("public health portal exposes a read-only infectious reporting timeline", () => {
  const html = read("public-health.html");
  const source = read("public-health.js");

  assert.match(html, /id="public-health-infectious-reporting-title"/);
  assert.match(html, /id="public-health-infectious-reporting-status"/);
  assert.match(html, /id="public-health-infectious-reporting-metrics"/);
  assert.match(html, /id="public-health-infectious-reporting-timeline"/);
  assert.ok(
    source.includes("`${PUBLIC_HEALTH_API_BASE}/public-health/infectious-reporting-cases`")
  );
  assert.match(source, /function renderPublicHealthInfectiousReportingCases/);
  assert.match(source, /function loadPublicHealthInfectiousReportingCases/);
  assert.doesNotMatch(html, /data-public-health-infectious-reporting-action/);
  assert.doesNotMatch(source, /data-public-health-infectious-reporting-action/);
});

test("timeline renderer keeps callback credentials and resident identity out of the portal", () => {
  const { context, node } = uiContext();
  context.reportingFixture = {
    summary: { total: 1, open: 1, trustedReceipts: 1, closed: 0 },
    cases: [{
      id: "ph-case-001",
      version: 5,
      state: "receipt-confirmed",
      externalEventId: "external-event-001",
      publicHealthEventId: "public-health-event-001",
      reportId: "report-001",
      reportCardNo: "card-001",
      residentId: "resident-secret-001",
      signingSecret: "callback-secret-material",
      signature: "raw-callback-signature",
      nonceDigest: "hidden-nonce-digest",
      receipt: {
        id: "receipt-001",
        status: "accepted",
        code: "CDC-001",
        receivedAt: "2026-08-05T08:00:00.000Z",
        trusted: true,
        contractId: "public-health-direct-report-v1",
        providerStatus: "accepted"
      },
      timeline: [{
        sequence: 1,
        action: "detect-event",
        from: "",
        to: "detected",
        at: "2026-08-05T07:55:00.000Z",
        actor: "EMR/LIS trigger adapter",
        role: "system",
        note: "source signal linked"
      }, {
        sequence: 5,
        action: "record-receipt",
        from: "submitted",
        to: "receipt-confirmed",
        at: "2026-08-05T08:00:00.000Z",
        actor: "public-health-direct-report-adapter",
        role: "system",
        note: "direct-report platform confirmed receipt"
      }],
      productionReady: false
    }]
  };
  vm.runInContext(
    "renderPublicHealthInfectiousReportingCases(reportingFixture)",
    context
  );

  const rendered = [
    node("#public-health-infectious-reporting-status").textContent,
    node("#public-health-infectious-reporting-metrics").innerHTML,
    node("#public-health-infectious-reporting-timeline").innerHTML
  ].join("\n");
  assert.match(rendered, /card-001/);
  assert.match(rendered, /CDC-001/);
  assert.match(rendered, /external-event-001/);
  assert.match(rendered, /public-health-direct-report-adapter/);
  assert.doesNotMatch(
    rendered,
    /resident-secret|callback-secret-material|raw-callback-signature|hidden-nonce-digest|signingSecret/i
  );
});
