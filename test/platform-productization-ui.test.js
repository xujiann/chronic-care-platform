"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

test("platform exposes one complete generic procurement governance center", () => {
  const html = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");
  const productizationSource = fs.readFileSync(path.join(ROOT, "platform-productization-ui.js"), "utf8");
  const source = fs.readFileSync(path.join(ROOT, "platform-procurement-governance-ui.js"), "utf8");
  for (const id of ["platform-procurement-governance-center", "platform-procurement-requirement-workbench", "platform-procurement-revision-comparisons", "platform-procurement-product-planning", "platform-procurement-delivery-evidence", "platform-procurement-import-trigger", "platform-procurement-import-artifact", "export-platform-procurement-governance"]) assert.match(html, new RegExp(`id="${id}"`));
  assert.doesNotMatch(html, /id="platform-productization-regional-requirements"/);
  assert.match(html, /id="platform-procurement-import-artifact"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"/);
  assert.match(html, /id="platform-procurement-import-trigger"[^>]*aria-controls="platform-procurement-import-artifact"/);
  assert.match(html, /不在浏览器上传 PDF、路径或招标原文/);
  assert.match(source, /PAGE_SIZE = 20/);
  assert.match(source, /当前筛选/);
  assert.match(source, /lifecycle-actions/);
  for (const action of ["request-acceptance", "accept-delivery", "return-delivery", "resubmit-delivery"]) assert.match(source, new RegExp(action));
  assert.match(source, /source-stale/);
  assert.match(source, /acceptanceStatus/);
  assert.match(source, /requirement-batches/);
  assert.match(source, /procurement-requirement-governance-export-v1/);
  assert.match(source, /Idempotency-Key/);
  assert.match(source, /productionReady/);
  assert.doesNotMatch(source, /innerHTML\s*=\s*[^;]*(?:error|message)\.message/);
  assert.equal((source.match(/DOMContentLoaded/g) || []).length, 0);
  assert.equal((productizationSource.match(/DOMContentLoaded/g) || []).length, 1);
  assert.match(productizationSource, /HealthPlatformProcurementGovernanceUi\?\.render/);
  assert.ok(html.indexOf("platform-procurement-governance-ui.js") < html.indexOf("platform-productization-ui.js"));
  assert.ok(Buffer.byteLength(source) < 30000);
  assert.ok(Buffer.byteLength(productizationSource) < 30000);
});

function renderHarness(sandboxOverrides = {}) {
  const ids = ["#platform-productization-status", "#platform-productization-metrics", "#platform-productization-work-items", "#platform-productization-integrations", "#platform-productization-boundary", "#platform-procurement-requirement-version", "#platform-procurement-governance-metrics", "#platform-procurement-governance-filters", "#platform-procurement-requirement-workbench", "#platform-procurement-revision-comparisons", "#platform-procurement-product-planning", "#platform-procurement-delivery-evidence", "#platform-procurement-governance-boundary", "#platform-procurement-governance-announcement", "#platform-procurement-import-trigger", "#platform-procurement-import-artifact", "#export-platform-procurement-governance"];
  const elements = {};
  const document = {
    addEventListener() {},
    createElement(tagName) {
      return { tagName, className: "", dataset: {}, innerHTML: "", textContent: "", children: [], value: "", disabled: false, addEventListener(type, listener) { this.listeners = this.listeners || {}; this.listeners[type] = listener; }, setAttribute() {}, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; }, click() { return this.listeners?.click?.(); } };
    },
    querySelector(selector) { return elements[selector] || null; }
  };
  for (const id of ids) { elements[id] = document.createElement("div"); elements[id].ownerDocument = document; }
  const sandbox = { document, Date, Math, console, ...sandboxOverrides };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "platform-procurement-governance-ui.js"), "utf8"), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "platform-productization-ui.js"), "utf8"), sandbox);
  return { elements, api: sandbox.HealthPlatformProductization, procurementApi: sandbox.HealthPlatformProcurementGovernanceUi };
}

function baseReport(overrides = {}) {
  return {
    ok: true,
    dataPromotion: { summary: { promotedP0: 1, authoritative: 2, legacyBlocked: 3 } },
    workItems: { summary: { total: 4, open: 2 }, items: [] },
    institutionIntegration: { summary: { profiles: 1 }, adapters: [] },
    boundary: "local only",
    requirementGovernance: { schemaVersion: "procurement-requirement-governance-view-v2", catalogRegistrationVersion: 0, summary: {}, items: [], revisionComparisons: [] },
    requirementDelivery: { schemaVersion: "procurement-requirement-delivery-view-v1", summary: {}, items: [], exportBundle: { schemaVersion: "procurement-requirement-governance-export-v1", productionReady: false } },
    ...overrides
  };
}

test("procurement requirement rendering is paginated, minimized and DOM safe", () => {
  const fixture = renderHarness();
  const hostile = '<svg onload="globalThis.compromised=true">';
  const items = Array.from({ length: 21 }, (_, index) => ({ id: `PR-SAFE-${String(index).padStart(4, "0")}`, logicalRequirementId: index === 0 ? hostile : `REQ-${String(index).padStart(12, "0")}`, seriesId: index === 0 ? hostile : "SRC-000000000001", sourceRevision: 1, change: index ? "baseline" : "changed", sourceAnchor: { pageStart: 1, pageEnd: 2, section: hostile }, targetCapabilityIds: [index ? "C-DATA-PLATFORM" : hostile], decision: "BUILD", priority: "P0", reviewStatus: "pending-review", version: 0, title: hostile, sourceAlias: hostile }));
  fixture.api.render(baseReport({ requirementGovernance: { schemaVersion: "procurement-requirement-governance-view-v2", catalogRegistrationVersion: 0, summary: { candidates: 21, pendingReview: 21 }, items, revisionComparisons: [] } }));
  const target = fixture.elements["#platform-procurement-requirement-workbench"];
  assert.match(target.children[0].children[1].textContent, /第 1 \/ 2 页，本页 20 条/);
  assert.equal(target.children.length, 21);
  assert.equal(target.children[1].children[0].textContent, "需求候选 未登记");
  assert.doesNotMatch(target.children[1].children.map((item) => item.textContent).join(" "), /svg|onload|不应展示/);
  assert.equal(fixture.elements["#platform-procurement-requirement-version"].textContent, "完整治理闭环已就绪 · 生产未授权");
  assert.equal(fixture.elements["#platform-procurement-requirement-version"].dataset.productionReady, "false");
});

test("revision, planning and evidence views use only controlled neutral fields", () => {
  const fixture = renderHarness();
  fixture.api.render(baseReport({
    requirementGovernance: { schemaVersion: "procurement-requirement-governance-view-v2", catalogRegistrationVersion: 0, summary: { accepted: 1 }, items: [], revisionComparisons: [{ seriesId: "SRC-000000000001", fromRevision: 1, toRevision: 2, summary: { added: 1, changed: 1, withdrawn: 1, unchanged: 2 }, added: [{ logicalRequirementId: "REQ-000000000001", title: "地域名称" }], changed: [], withdrawn: [] }] },
    requirementDelivery: { schemaVersion: "procurement-requirement-delivery-view-v1", summary: { awaitingPlan: 1, evidenceMissing: 3 }, items: [{ requirementId: "PR-SAFE-0001", logicalRequirementId: "REQ-000000000001", status: "awaiting-plan", version: 0, verifiedEvidence: 0, requiredEvidence: 3, recommendation: { strategyCode: "BUILD_MINIMUM_CAPABILITY_SLICE", priority: "P0", ownerProcess: "T02", targetCapabilityIds: ["C-DATA-PLATFORM"] }, evidence: [{ type: "implementation", status: "missing" }, { type: "test", status: "missing" }, { type: "review", status: "missing" }] }], exportBundle: { schemaVersion: "procurement-requirement-governance-export-v1", productionReady: false } }
  }));
  assert.match(fixture.elements["#platform-procurement-revision-comparisons"].children[0].children[1].textContent, /新增 1 · 变更 1 · 撤回 1 · 未变化 2/);
  assert.doesNotMatch(fixture.elements["#platform-procurement-revision-comparisons"].children[0].children.map((item) => item.textContent).join(" "), /地域名称/);
  assert.match(fixture.elements["#platform-procurement-product-planning"].children[1].children[1].textContent, /建设最小能力切片/);
  assert.match(fixture.elements["#platform-procurement-delivery-evidence"].children[1].children[1].textContent, /已核验 0 \/ 3/);
});

test("planning and evidence views paginate independently", () => {
  const fixture = renderHarness();
  const items = Array.from({ length: 21 }, (_, index) => ({
    requirementId: `PR-SAFE-${String(index).padStart(4, "0")}`,
    logicalRequirementId: `REQ-${String(index).padStart(12, "0")}`,
    status: "awaiting-plan",
    version: 0,
    verifiedEvidence: 0,
    requiredEvidence: 3,
    recommendation: { strategyCode: "BUILD_MINIMUM_CAPABILITY_SLICE", priority: "P0", ownerProcess: "T02", targetCapabilityIds: ["C-DATA-PLATFORM"] },
    evidence: [{ type: "implementation", status: "missing" }, { type: "test", status: "missing" }, { type: "review", status: "missing" }]
  }));
  fixture.api.render(baseReport({ requirementDelivery: { schemaVersion: "procurement-requirement-delivery-view-v1", summary: {}, items, exportBundle: { schemaVersion: "procurement-requirement-governance-export-v1", productionReady: false } } }));
  const planning = fixture.elements["#platform-procurement-product-planning"];
  const evidence = fixture.elements["#platform-procurement-delivery-evidence"];
  assert.equal(planning.children.length, 21);
  assert.equal(evidence.children.length, 21);
  assert.match(planning.children[0].children[1].textContent, /产品规划第 1 \/ 2 页，本页 20 条/);
  assert.match(evidence.children[0].children[1].textContent, /交付证据第 1 \/ 2 页，本页 20 条/);
});

test("acceptance workflow exposes controlled actions and blocks stale plans", () => {
  const fixture = renderHarness();
  const plan = (suffix, status, acceptanceStatus, evidenceStatus = "verified", actionAllowed = true) => ({
    requirementId: `PR-SAFE-${suffix}`,
    logicalRequirementId: `REQ-${suffix.padStart(12, "0")}`,
    status,
    acceptanceStatus,
    actionAllowed,
    version: 9,
    verifiedEvidence: evidenceStatus === "verified" ? 3 : 2,
    requiredEvidence: 3,
    recommendation: { strategyCode: "BUILD_MINIMUM_CAPABILITY_SLICE", priority: "P0", ownerProcess: "T02", targetCapabilityIds: ["C-DATA-PLATFORM"] },
    evidence: [{ type: "implementation", status: evidenceStatus }, { type: "test", status: "verified" }, { type: "review", status: "verified" }]
  });
  fixture.api.render(baseReport({
    requirementDelivery: {
      schemaVersion: "procurement-requirement-delivery-view-v1",
      summary: { acceptanceReview: 1, acceptanceReturned: 1, deliveryAccepted: 1, stalePlans: 1 },
      items: [
        plan("1", "repository-verified", "not-requested"),
        plan("2", "acceptance-review", "pending"),
        plan("3", "acceptance-returned", "returned"),
        plan("4", "delivery-accepted", "accepted"),
        plan("5", "source-stale", "pending", "submitted", false)
      ],
      exportBundle: { schemaVersion: "procurement-requirement-governance-export-v1", productionReady: false },
      boundary: "已采纳需求可进入独立仓库验收；生产授权继续保持关闭。"
    }
  }));
  const planning = fixture.elements["#platform-procurement-product-planning"].children;
  assert.equal(planning[1].children.at(-1).children[0].textContent, "申请交付验收");
  assert.match(planning[2].children[1].textContent, /待独立交付验收 · 等待独立验收/);
  assert.match(planning[2].children[3].textContent, /不同于申请人的授权账号/);
  assert.deepEqual(planning[2].children.at(-1).children.map((button) => button.textContent), ["确认验收通过", "退回补充交付证据"]);
  assert.equal(planning[3].children.at(-1).children[0].textContent, "整改后重新提交");
  assert.equal(planning[4].children.length, 3);
  assert.match(planning[5].children.at(-1).textContent, /当前计划不可操作/);
  assert.equal(planning[5].children.some((child) => child.className === "action-row"), false);
  const staleEvidence = fixture.elements["#platform-procurement-delivery-evidence"].children[5];
  assert.equal(staleEvidence.children.some((child) => child.tagName === "button" || child.tagName === "div"), false);
  assert.match(fixture.elements["#platform-procurement-governance-boundary"].textContent, /生产授权继续保持关闭/);
});

test("hidden procurement import input is activated by its accessible button", () => {
  const fixture = renderHarness();
  let opened = 0;
  fixture.elements["#platform-procurement-import-artifact"].click = () => { opened += 1; };
  fixture.api.render(baseReport());
  fixture.elements["#platform-procurement-import-trigger"].click();
  assert.equal(opened, 1);
});

test("governance export rebuilds a strict neutral allowlist", () => {
  let exported = "";
  class FakeBlob { constructor(parts) { exported = parts.join(""); } }
  const fixture = renderHarness({
    Blob: FakeBlob,
    URL: { createObjectURL: () => "blob:safe", revokeObjectURL() {} },
    HealthBrowserSafeUrl: { setElementUrl(element, property, value) { element[property] = value; } },
    location: { origin: "https://example.invalid" }
  });
  fixture.procurementApi.downloadExport({
    schemaVersion: "procurement-requirement-governance-export-v1",
    generatedAt: "2026-09-02T00:00:00.000Z",
    productionReady: false,
    path: "C:/Sensitive/某地区招标.pdf",
    title: "某机构原文",
    summary: { candidates: 1, regionName: "某地区" },
    requirements: [{
      logicalRequirementId: "REQ-000000000001",
      seriesId: "SRC-000000000001",
      sourceRevision: 1,
      status: "delivery-accepted",
      priorStatus: "acceptance-review",
      sourceCurrent: true,
      acceptanceStatus: "accepted",
      releaseWindow: "next-release",
      strategyCode: "BUILD_MINIMUM_CAPABILITY_SLICE",
      ownerProcess: "T02",
      priority: "P0",
      targetCapabilityIds: ["C-DATA-PLATFORM", "某机构"],
      evidence: [{ type: "test", status: "verified", digest: `sha256:${"a".repeat(64)}`, path: "C:/secret" }],
      raw: "招标原文"
    }]
  });
  const bundle = JSON.parse(exported);
  assert.deepEqual(Object.keys(bundle), ["schemaVersion", "generatedAt", "productionReady", "summary", "requirements", "boundary"]);
  assert.equal(bundle.summary.candidates, 1);
  assert.equal(Object.hasOwn(bundle.summary, "regionName"), false);
  assert.deepEqual(bundle.requirements[0].targetCapabilityIds, ["C-DATA-PLATFORM"]);
  assert.equal(bundle.requirements[0].status, "delivery-accepted");
  assert.equal(bundle.requirements[0].acceptanceStatus, "accepted");
  assert.equal(bundle.requirements[0].sourceCurrent, true);
  assert.equal(bundle.requirements[0].evidence[0].digest, `sha256:${"a".repeat(64)}`);
  assert.doesNotMatch(exported, /Sensitive|某地区|某机构原文|C:\//);
});
