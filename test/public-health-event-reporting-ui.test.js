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
  assert.match(html, /id="public-health-infectious-reporting-control"/);
  assert.match(html, /id="public-health-infectious-reporting-timeline"/);
  assert.ok(
    source.includes("`${PUBLIC_HEALTH_API_BASE}/public-health/infectious-reporting-cases`")
  );
  assert.match(source, /function renderPublicHealthInfectiousReportingCases/);
  assert.match(source, /function loadPublicHealthInfectiousReportingCases/);
  assert.match(source, /function renderPublicHealthDirectReportControl/);
  assert.match(html, /事务型投递箱/);
  assert.match(html, /独立 Worker/);
  assert.match(source, /INFECTIOUS_REPORTING_DELIVERY_LABELS/);
  assert.match(source, /投递箱不保存原始报文、居民身份或凭据/);
  assert.doesNotMatch(html, /data-public-health-infectious-reporting-action/);
  assert.doesNotMatch(source, /data-public-health-infectious-reporting-action/);
  assert.doesNotMatch(html, /data-public-health-direct-report-control-action/);
});

test("timeline renderer keeps callback credentials and resident identity out of the portal", () => {
  const { context, node } = uiContext();
  context.reportingFixture = {
    controlPackage: {
      activationReady: true,
      dictionaryId: "official-dictionary",
      dictionaryVersion: "2026.08",
      scenariosPassed: 8,
      scenariosRequired: 8,
      signerRoles: ["disease-control-office", "hospital-information-center"],
      publicKeyPem: "must-not-render",
      signature: "must-not-render-signature"
    },
    summary: {
      total: 1,
      open: 1,
      trustedReceipts: 1,
      closed: 0,
      deliveryQueued: 0,
      deliveryDeadLetter: 0
    },
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
      delivery: {
        id: "delivery-001",
        state: "callback-accepted",
        version: 4,
        attemptCount: 1,
        maxAttempts: 3,
        providerReceipt: {
          receiptId: "receipt-001"
        },
        lease: {
          tokenDigest: "hidden-lease-token-digest"
        },
        bindingDigest: "hidden-binding-digest",
        payload: {
          residentId: "resident-secret-inside-delivery"
        }
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
    node("#public-health-infectious-reporting-control").innerHTML,
    node("#public-health-infectious-reporting-metrics").innerHTML,
    node("#public-health-infectious-reporting-timeline").innerHTML
  ].join("\n");
  assert.match(rendered, /card-001/);
  assert.match(rendered, /official-dictionary/);
  assert.match(rendered, /8\/8/);
  assert.match(rendered, /CDC-001/);
  assert.match(rendered, /external-event-001/);
  assert.match(rendered, /public-health-direct-report-adapter/);
  assert.match(rendered, /可信回调已接收/);
  assert.match(rendered, /尝试 1\/3/);
  assert.doesNotMatch(
    rendered,
    /resident-secret|callback-secret-material|raw-callback-signature|hidden-nonce-digest|hidden-lease-token-digest|hidden-binding-digest|signingSecret|must-not-render/i
  );
});
