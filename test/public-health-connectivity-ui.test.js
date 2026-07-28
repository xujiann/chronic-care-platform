const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
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
        closest() {
          return null;
        }
      });
    }
    return nodes.get(selector);
  };
  const context = vm.createContext({
    console,
    location: { protocol: "http:" },
    window: {},
    fetch: async () => {
      throw new Error("network-disabled-in-ui-test");
    },
    document: {
      addEventListener() {},
      querySelector: node
    }
  });
  vm.runInContext(read("public-health.js"), context, { filename: "public-health.js" });
  return { context, node };
}

test("external endpoint panel is accessible and wired only to commission summary routes", () => {
  const html = read("public-health.html");
  const source = read("public-health.js");
  const css = read("portal.css");

  assert.match(html, /外部端点与连续探测/);
  assert.match(html, /aria-labelledby="public-health-connectivity-title"/);
  assert.match(html, /id="public-health-connectivity-status"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /public-health-connectivity-metrics/);
  assert.match(html, /public-health-connectivity-break/);
  assert.match(html, /public-health-connectivity-worker/);
  assert.match(html, /public-health-connectivity-blockers/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/summary/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/campaigns\/summary/);
  assert.match(source, /endpointConnectivityReady/);
  assert.match(source, /continuousConnectivityReady/);
  assert.match(source, /productionReady 仅由服务端和现场门禁决定/);
  assert.match(css, /\.connectivity-metric-grid/);
  assert.match(css, /@media \(max-width: 720px\)/);
});

test("external endpoint panel renders only allowlisted summary fields", () => {
  const { context, node } = loadUiContext();
  context.endpointFixture = {
    summary: {
      lanes: 8,
      endpointsConfigured: 8,
      endpointProbesVerified: 7
    },
    endpointConnectivityReady: false,
    productionReady: false,
    worker: { succeeded: 11, rejected: 2 },
    entries: [{
      endpointDigest: "secret-endpoint-digest",
      resolvedAddressDigest: "secret-address-digest",
      tlsProtocol: "secret-tls"
    }],
    blockers: ["https://private.example/diagnostic?signature=secret"]
  };
  context.campaignFixture = {
    summary: {
      campaignsVerified: 2,
      consecutiveCampaigns: 1,
      requiredConsecutiveCampaigns: 3
    },
    continuityBreak: {
      campaignId: "campaign-safe-001",
      code: "ENDPOINT_PROBE_CAMPAIGN_VERIFICATION_FAILED",
      reason: "raw-signature-reason"
    },
    endpointConnectivityReady: false,
    continuousConnectivityReady: false,
    productionReady: false,
    worker: { succeeded: 2, rejected: 1 },
    blockers: ["certificateFingerprintSha256=secret-certificate"]
  };
  vm.runInContext(
    "renderPublicHealthConnectivitySummaries({ endpoint: endpointFixture, campaign: campaignFixture })",
    context
  );

  const rendered = [
    node("#public-health-connectivity-metrics").innerHTML,
    node("#public-health-connectivity-status").textContent,
    node("#public-health-connectivity-break").innerHTML,
    node("#public-health-connectivity-worker").innerHTML,
    node("#public-health-connectivity-blockers").innerHTML
  ].join("\n");
  assert.match(rendered, /8\/8/);
  assert.match(rendered, /7\/8/);
  assert.match(rendered, /campaign-safe-001/);
  assert.match(rendered, /ENDPOINT_PROBE_CAMPAIGN_VERIFICATION_FAILED/);
  assert.match(rendered, /单通道探测：成功 <strong>11<\/strong>，拒绝 <strong>2<\/strong>/);
  assert.match(rendered, /生产上线/);
  assert.match(rendered, /未授权/);
  assert.doesNotMatch(rendered, /private\.example|secret-|raw-signature-reason|certificateFingerprint/i);
});

test("external endpoint panel fails closed on forbidden, missing and network summaries", () => {
  const { context, node } = loadUiContext();
  context.forbidden = Object.assign(new Error("forbidden"), { status: 403 });
  vm.runInContext(
    "renderPublicHealthConnectivitySummaries({ endpoint: null, campaign: null, endpointError: forbidden, campaignError: new Error('network') })",
    context
  );
  assert.match(node("#public-health-connectivity-status").textContent, /无权查看 commission 摘要/);
  assert.match(node("#public-health-connectivity-metrics").innerHTML, /端点门禁[\s\S]*未就绪/);
  assert.match(node("#public-health-connectivity-metrics").innerHTML, /连续门禁[\s\S]*未就绪/);
  assert.match(node("#public-health-connectivity-metrics").innerHTML, /生产上线[\s\S]*状态不可确认/);
  assert.match(node("#public-health-connectivity-blockers").innerHTML, /现场证据/);
});
