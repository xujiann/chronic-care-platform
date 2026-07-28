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
  assert.match(html, /public-health-connectivity-lane/);
  assert.match(html, /data-public-health-connectivity-action="probe-lane"/);
  assert.match(html, /data-public-health-connectivity-action="probe-campaign"/);
  assert.match(html, /public-health-connectivity-action-status/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/summary/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/campaigns\/summary/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/probes/);
  assert.match(source, /\/api\/public-health\/external\/endpoints\/campaigns/);
  assert.match(source, /endpointConnectivityReady/);
  assert.match(source, /continuousConnectivityReady/);
  assert.match(source, /productionReady 仅由服务端和现场门禁决定/);
  assert.match(css, /\.connectivity-metric-grid/);
  assert.match(css, /\.connectivity-action-controls/);
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

test("single-lane action submits only an allowlisted lane and refreshes summaries", async () => {
  const { context, node } = loadUiContext();
  const calls = [];
  node("#public-health-connectivity-lane").value = "immunization";
  context.window.HealthCityAuth = {
    authFetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (options.method === "POST") {
        return {
          ok: true,
          status: 201,
          json: async () => ({ ok: true, endpointConnectivityReady: false, productionReady: false })
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => url.endsWith("/campaigns/summary")
          ? {
              summary: { campaignsVerified: 0, consecutiveCampaigns: 0, requiredConsecutiveCampaigns: 3 },
              continuousConnectivityReady: false,
              productionReady: false,
              worker: {}
            }
          : {
              summary: { lanes: 8, endpointsConfigured: 1, endpointProbesVerified: 1 },
              endpointConnectivityReady: false,
              productionReady: false,
              worker: {}
            }
      };
    }
  };
  context.actionButton = {
    dataset: { publicHealthConnectivityAction: "probe-lane" },
    disabled: false,
    textContent: "运行单通道探测"
  };

  await vm.runInContext("handlePublicHealthConnectivityAction(actionButton)", context);

  const postCall = calls.find((item) => item.options.method === "POST");
  assert.equal(postCall.url, "/api/public-health/external/endpoints/probes");
  assert.deepEqual(JSON.parse(postCall.options.body), { laneId: "immunization" });
  assert.match(postCall.options.headers["Idempotency-Key"], /^public-health-connectivity:immunization:/);
  assert.deepEqual(Object.keys(JSON.parse(postCall.options.body)), ["laneId"]);
  assert.equal(calls.filter((item) => item.options.method !== "POST").length, 2);
  assert.match(node("#public-health-connectivity-action-status").textContent, /写入审计/);
  assert.equal(context.actionButton.disabled, false);
  assert.equal(context.actionButton.textContent, "运行单通道探测");
});

test("campaign action sends an empty command and maps rejection to a safe message", async () => {
  const { context, node } = loadUiContext();
  let captured;
  context.window.HealthCityAuth = {
    authFetch: async (url, options = {}) => {
      captured = { url, options };
      return {
        ok: false,
        status: 503,
        json: async () => ({
          code: "ENDPOINT_PROBE_CAMPAIGN_FAILED",
          message: "https://secret.example raw certificate and signing reason"
        })
      };
    }
  };
  context.actionButton = {
    dataset: { publicHealthConnectivityAction: "probe-campaign" },
    disabled: false,
    textContent: "运行八通道活动"
  };

  await vm.runInContext("handlePublicHealthConnectivityAction(actionButton)", context);

  assert.equal(captured.url, "/api/public-health/external/endpoints/campaigns");
  assert.deepEqual(JSON.parse(captured.options.body), {});
  assert.match(captured.options.headers["Idempotency-Key"], /^public-health-connectivity:campaign:/);
  assert.match(node("#public-health-connectivity-action-status").textContent, /配置不完整或可信探测失败/);
  assert.doesNotMatch(node("#public-health-connectivity-action-status").textContent, /secret|certificate|https:/i);
});
