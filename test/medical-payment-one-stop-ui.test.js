"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

const settle = () => new Promise((resolve) => setImmediate(resolve));

async function paymentHarness() {
  const nodes = new Map();
  function node() {
    return {
      dataset: {}, children: [], options: [{ value: "all" }], value: "all", hidden: true,
      disabled: false, textContent: "", open: false, listeners: {}, elements: {},
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = items; },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      showModal() { this.open = true; },
      close() { this.open = false; this.listeners.close?.({ target: this }); },
      reset() { Object.values(this.elements).forEach((field) => { field.value = ""; }); },
      querySelector(selector) { return this.fields[selector]; },
      querySelectorAll() { return this.errors || []; },
      closest() { return this.dialog; }
    };
  }
  const get = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, node());
    return nodes.get(selector);
  };
  for (const name of ["payment", "refund", "review", "reconciliation"]) {
    const form = get(`#${name}-form`);
    form.dialog = get(`#${name}-dialog`);
    form.fields = { "button[value='submit']": node(), "[data-form-error]": node() };
    form.dialog.errors = [form.fields["[data-form-error]"]];
    for (const key of ["orderNo", "amountFen", "currency", "institutionCode", "gatewayType"]) form.elements[key] = { value: "" };
  }
  const center = {
    scope: { role: "institution" }, summary: {}, queue: [], refunds: [],
    reconciliationRuns: [], gateways: [], blockers: [], actions: { dispatchPayment: true }
  };
  const posts = [];
  let reads = 0;
  let serial = 0;
  const request = async (url, options = {}) => {
    if (options.method !== "POST") { reads += 1; return { ok: true, json: async () => center }; }
    return new Promise((resolve, reject) => posts.push({ url, body: JSON.parse(options.body), resolve, reject }));
  };
  vm.runInNewContext(read("medical-payment.js"), {
    window: { HealthCityAuth: { getUser: () => ({ role: "institution", orgCode: "ORG-DEMO-01" }), authFetch: request } },
    location: { protocol: "https:", hostname: "example.test" },
    document: { querySelector: get, querySelectorAll: () => [], createElement: node },
    crypto: { randomUUID: () => `test-key-${++serial}` }, fetch: request,
    FormData: class { constructor(form) { this.items = Object.entries(form.elements).map(([key, field]) => [key, field.value]); } [Symbol.iterator]() { return this.items[Symbol.iterator](); } }
  }, { filename: "medical-payment.js" });
  await settle();
  const form = get("#payment-form");
  const open = () => {
    get("#payment-create-open").listeners.click();
    form.elements.orderNo.value = "DEMO-ORDER-01";
    form.elements.amountFen.value = "100";
  };
  open();
  return {
    get, form, posts, open, reads: () => reads,
    submit: () => form.listeners.submit({ preventDefault() {}, currentTarget: form }),
    error: form.fields["[data-form-error]"], button: form.fields["button[value='submit']"],
    dialog: form.dialog,
    respond(index, payload, status = 202) {
      posts[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => payload });
    },
    receipt(index, status = "accepted") {
      const body = posts[index].body;
      return { id: `igw-test-${index}`, adapterType: "financial", gatewayType: "PAYMENT", operation: "create-payment", idempotencyKey: body.idempotencyKey, externalId: body.payload.orderNo, status, payload: body.payload };
    }
  };
}

test("payment create blocks concurrent submits and reuses the bound key after an unknown outcome", async () => {
  const ui = await paymentHarness();
  ui.submit();
  ui.submit();
  assert.equal(ui.posts.length, 1);
  assert.equal(ui.button.disabled, true);
  ui.posts[0].reject(new Error("network timeout"));
  await settle();
  assert.equal(ui.dialog.open, true);
  assert.equal(ui.button.disabled, false);
  ui.submit();
  assert.deepEqual(ui.posts[1].body, ui.posts[0].body);
  ui.respond(1, ui.receipt(1));
  await settle();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.reads(), 2);
});

test("payment payload changes and explicit new operations never inherit an old bound key", async () => {
  const ui = await paymentHarness();
  ui.submit();
  ui.posts[0].reject(new Error("timeout"));
  await settle();
  ui.form.elements.amountFen.value = "200";
  ui.submit();
  assert.notEqual(ui.posts[1].body.idempotencyKey, ui.posts[0].body.idempotencyKey);
  ui.posts[1].reject(new Error("timeout"));
  await settle();
  ui.submit();
  assert.equal(ui.posts[2].body.idempotencyKey, ui.posts[1].body.idempotencyKey);
  ui.posts[2].reject(new Error("timeout"));
  await settle();
  ui.form.elements.amountFen.value = "100";
  ui.submit();
  assert.equal(ui.posts[3].body.idempotencyKey, ui.posts[0].body.idempotencyKey);
  ui.posts[3].reject(new Error("timeout"));
  await settle();
  ui.dialog.close();
  ui.open();
  ui.submit();
  assert.notEqual(ui.posts[4].body.idempotencyKey, ui.posts[0].body.idempotencyKey);
  ui.respond(4, ui.receipt(4));
  await settle();
});

test("payment malformed successful responses retain the draft and retry key without success", async () => {
  for (const malformed of [null, {}, [], { ok: true }, { id: "unrelated", status: "accepted" }]) {
    const ui = await paymentHarness();
    ui.submit();
    ui.respond(0, malformed);
    await settle();
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.error.hidden, false);
    assert.equal(ui.reads(), 1);
    ui.submit();
    assert.equal(ui.posts[1].body.idempotencyKey, ui.posts[0].body.idempotencyKey);
    ui.respond(1, ui.receipt(1));
    await settle();
  }
});

test("payment invalid JSON and mismatched command receipts remain unknown", async () => {
  for (const kind of ["json", "key", "operation", "gateway", "order", "status", "amount", "institution"]) {
    const ui = await paymentHarness();
    ui.submit();
    const receipt = ui.receipt(0);
    if (kind === "json") ui.posts[0].resolve({ ok: true, status: 200, json: async () => { throw new SyntaxError("invalid JSON"); } });
    else {
      if (kind === "key") receipt.idempotencyKey = "unrelated";
      if (kind === "operation") receipt.operation = "refund";
      if (kind === "gateway") receipt.gatewayType = "INSURANCE";
      if (kind === "order") receipt.externalId = "OTHER";
      if (kind === "status") receipt.status = "unrecognized";
      if (kind === "amount") receipt.payload = { ...receipt.payload, amountFen: 999 };
      if (kind === "institution") receipt.payload = { ...receipt.payload, institutionCode: "OTHER" };
      ui.respond(0, receipt);
    }
    await settle();
    assert.equal(ui.dialog.open, true, kind);
    assert.equal(ui.error.hidden, false, kind);
    ui.submit();
    assert.equal(ui.posts[1].body.idempotencyKey, ui.posts[0].body.idempotencyKey, kind);
    ui.respond(1, ui.receipt(1));
    await settle();
  }
});

test("payment HTTP failures preserve identity and normalized institution payload", async () => {
  for (const status of [400, 403, 409, 502]) {
    const ui = await paymentHarness();
    ui.form.elements.institutionCode.value = " ORG-DEMO-01 ";
    ui.submit();
    assert.equal(ui.posts[0].body.payload.institutionCode, "ORG-DEMO-01");
    ui.respond(0, { ok: false, message: "request rejected" }, status);
    await settle();
    assert.equal(ui.dialog.open, true);
    assert.equal(ui.error.hidden, false);
    assert.equal(ui.reads(), 1);
    ui.submit();
    assert.deepEqual(ui.posts[1].body, ui.posts[0].body);
    ui.respond(1, ui.receipt(1));
    await settle();
  }
});

test("payment valid 200 replay and 202 reservation receipts are accepted without claiming funds success", async () => {
  for (const [httpStatus, status] of [[200, "succeeded"], [202, "accepted"], [202, "dispatching"], [202, "retrying"]]) {
    const ui = await paymentHarness();
    ui.submit();
    ui.respond(0, { ...ui.receipt(0, status), idempotentReplay: httpStatus === 200 }, httpStatus);
    await settle();
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.error.hidden, true);
    assert.equal(ui.reads(), 2);
    assert.doesNotMatch(ui.get("#payment-source-title").textContent, /支付成功|资金.*成功/);
  }
});

test("payment late completion cannot close, unlock or write into a reopened pending draft", async () => {
  for (const outcome of ["success", "failure"]) {
    const ui = await paymentHarness();
    ui.submit();
    ui.dialog.close();
    ui.open();
    ui.submit();
    assert.equal(ui.posts.length, 2);
    if (outcome === "success") ui.respond(0, ui.receipt(0));
    else ui.posts[0].reject(new Error("old failure"));
    await settle();
    assert.equal(ui.dialog.open, true, outcome);
    assert.equal(ui.button.disabled, true, outcome);
    assert.equal(ui.error.hidden, true, outcome);
    assert.equal(ui.reads(), 1, outcome);
    ui.respond(1, ui.receipt(1));
    await settle();
    assert.equal(ui.dialog.open, false);
    assert.equal(ui.button.disabled, false);
  }
});

test("medical payment one-stop page is registered and uses trusted DOM rendering", () => {
  const html = read("medical-payment.html");
  const client = read("medical-payment.js");
  const policy = require("../access-control-policy");
  const publication = require("../config/static-publication.json");

  assert.match(html, /医疗付费一件事/);
  assert.match(html, /page-auth-bootstrap\.js/);
  assert.match(html, /data-roles="commission,institution,insurance"/);
  assert.match(html, /name="institutionCode" required/);
  assert.match(client, /\/api\/medical-payments\/center/);
  assert.match(client, /\/api\/financial-gateways\/dispatch/);
  assert.match(client, /\/api\/online-payments\/refunds/);
  assert.match(client, /\/api\/financial-gateways\/reconciliation-runs/);
  assert.match(client, /scope\.role === "insurance" \? "INSURANCE" : values\.gatewayType/);
  assert.doesNotMatch(client, /innerHTML|insertAdjacentHTML|document\.write|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(client, /createElement/);
  assert.match(client, /textContent/);
  assert.equal(policy.pageCatalog["medical-payment.html"].group, "医保支付");
  assert.equal(policy.pageCatalog["medical-payment.html"].parent, "insurance.html");
  assert.equal(publication.entrypoints.includes("medical-payment.html"), true);
});

test("medical payment capabilities carry repository and procurement trace evidence", () => {
  const registry = require("../config/platform-capability-registry.json");
  const trace = require("../config/procurement-requirement-trace-catalog.json");
  for (const id of ["E-CIT-ORDER", "E-CIT-PAY", "E-CIT-REFUND"]) {
    const capability = registry.capabilities.find((item) => item.id === id);
    const mapping = trace.capabilities.find((item) => item.capabilityId === id);
    assert.equal(capability.coverage, "repository-verified");
    assert.equal(capability.evidence.length >= 4, true);
    assert.equal(capability.evidence.every((relative) => fs.existsSync(path.join(ROOT, relative))), true);
    assert.deepEqual(mapping.pages, ["medical-payment.html"]);
    assert.equal(mapping.interfaces.includes("GET /api/medical-payments/center"), true);
    assert.equal(mapping.tests.includes("test/medical-payment-one-stop-ui.test.js"), true);
  }
});
