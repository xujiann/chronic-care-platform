"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const SOURCE = fs.readFileSync(path.join(ROOT, "blood.js"), "utf8");

function response({ ok = true, body, jsonError } = {}) {
  return {
    ok,
    async json() {
      if (jsonError) throw jsonError;
      return body;
    }
  };
}

function createHarness({ protocol = "https:", fetchImpl } = {}) {
  const toast = {
    textContent: "",
    classList: { add() {}, remove() {} }
  };
  const traceCode = { value: "TRACE-001" };
  const traceTitle = { textContent: "" };
  const nodes = {
    "#toast": toast,
    "#trace-code": traceCode,
    "#trace-title": traceTitle
  };
  const exchangeMessages = [];
  const fetchCalls = [];
  const authFetch = async (...args) => {
    fetchCalls.push(args);
    return fetchImpl(...args);
  };
  const window = {
    HealthCityAuth: { authFetch },
    setTimeout: () => 1,
    clearTimeout() {}
  };
  const context = vm.createContext({
    window,
    location: { protocol, origin: "https://health.example.test" },
    document: {
      addEventListener() {},
      querySelector: (selector) => nodes[selector] || null,
      querySelectorAll: () => []
    },
    Node: class Node {},
    FormData: class FormData {
      constructor(target) { this.values = target.values || {}; }
      get(name) { return this.values[name] ?? null; }
    },
    BloodDomain: {
      buildExchangeMessage(type, payload) {
        exchangeMessages.push({ type, payload });
        return { messageId: "LOCAL-DEMO-001" };
      }
    },
    fetch: authFetch,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    console
  });
  vm.runInContext(`${SOURCE}\n;globalThis.__bloodFailureTest = { queryTrace, submitBloodRequest };`, context, { filename: "blood.js" });
  context.loadBloodSystem = async () => {};
  context.render = () => {};
  return {
    api: context.__bloodFailureTest,
    toast,
    traceCode,
    traceTitle,
    fetchCalls,
    exchangeMessages,
    form(values = {}) { return { values }; }
  };
}

test("online trace reports verified server events only after a valid success response", async () => {
  const harness = createHarness({
    fetchImpl: async () => response({ body: { events: [{ id: "a" }, { id: "b" }] } })
  });

  await harness.api.queryTrace();

  assert.equal(harness.toast.textContent, "追溯链已核验：2条服务端事件");
  assert.equal(harness.fetchCalls.length, 1);
});

test("online trace failures never fall through to the local verification success", async (t) => {
  const cases = [
    {
      name: "HTTP rejection",
      fetchImpl: async () => response({ ok: false, body: { message: "未找到追溯记录" } }),
      expected: "未找到追溯记录"
    },
    {
      name: "invalid JSON",
      fetchImpl: async () => response({ jsonError: new SyntaxError("private upstream body") }),
      expected: "追溯服务响应异常，请稍后重试"
    },
    {
      name: "invalid success shape",
      fetchImpl: async () => response({ body: { events: "not-an-array" } }),
      expected: "追溯服务响应异常，请稍后重试"
    },
    {
      name: "network failure",
      fetchImpl: async () => { throw new Error("private proxy address"); },
      expected: "追溯服务暂不可用，请稍后重试"
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const harness = createHarness({ fetchImpl: scenario.fetchImpl });
      await harness.api.queryTrace();
      assert.equal(harness.toast.textContent, scenario.expected);
      assert.notEqual(harness.toast.textContent, "追溯链已通过本地规则核验");
      assert.doesNotMatch(harness.toast.textContent, /private/);
    });
  }
});

test("online trace requires a code instead of claiming a local success", async () => {
  const harness = createHarness({ fetchImpl: async () => { throw new Error("must not fetch"); } });
  harness.traceCode.value = "";

  await harness.api.queryTrace();

  assert.equal(harness.toast.textContent, "请输入追溯编码");
  assert.equal(harness.fetchCalls.length, 0);
});

test("online request failures never create a LOCAL-DEMO success", async (t) => {
  const cases = [
    {
      name: "HTTP rejection",
      fetchImpl: async () => response({ ok: false, body: { message: "用血申请校验未通过" } }),
      expected: "用血申请校验未通过"
    },
    {
      name: "invalid JSON leaves the write result unknown",
      fetchImpl: async () => response({ jsonError: new SyntaxError("private upstream body") }),
      expected: "申请结果暂未确认，请核对服务端记录后再操作"
    },
    {
      name: "missing request identity leaves the write result unknown",
      fetchImpl: async () => response({ body: { request: {} } }),
      expected: "申请结果暂未确认，请核对服务端记录后再操作"
    },
    ...[
      { id: {}, label: "object" },
      { id: true, label: "boolean" },
      { id: ["BR-FORGED-001"], label: "array" },
      { id: "   ", label: "blank string" }
    ].map(({ id, label }) => ({
      name: `${label} request identity leaves the write result unknown`,
      fetchImpl: async () => response({ body: { request: { id } } }),
      expected: "申请结果暂未确认，请核对服务端记录后再操作"
    })),
    {
      name: "network failure leaves the write result unknown",
      fetchImpl: async () => { throw new Error("private proxy address"); },
      expected: "申请结果暂未确认，请核对服务端记录后再操作"
    }
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, async () => {
      const harness = createHarness({ fetchImpl: scenario.fetchImpl });
      await harness.api.submitBloodRequest({
        preventDefault() {},
        currentTarget: harness.form({ patientId: "ZY-001", bloodType: "A Rh+" })
      });
      assert.equal(harness.toast.textContent, scenario.expected);
      assert.equal(harness.exchangeMessages.length, 0);
      assert.doesNotMatch(harness.toast.textContent, /静态演示申请|LOCAL-DEMO|private|安全重试/);
    });
  }
});

test("valid online requests and explicit file previews retain their intended success modes", async (t) => {
  await t.test("online success", async () => {
    const harness = createHarness({
      fetchImpl: async () => response({ body: { request: { id: "BR-ONLINE-001" } } })
    });
    await harness.api.submitBloodRequest({
      preventDefault() {},
      currentTarget: harness.form({ patientId: "ZY-002" })
    });
    assert.equal(harness.toast.textContent, "申请已持久化：BR-ONLINE-001");
    assert.equal(harness.exchangeMessages.length, 0);
  });

  await t.test("file preview", async () => {
    const harness = createHarness({ protocol: "file:", fetchImpl: async () => { throw new Error("must not fetch"); } });
    await harness.api.queryTrace();
    assert.equal(harness.toast.textContent, "追溯链已通过本地规则核验");
    assert.equal(harness.fetchCalls.length, 0);

    await harness.api.submitBloodRequest({
      preventDefault() {},
      currentTarget: harness.form({ patientId: "DEMO-001" })
    });
    assert.equal(harness.toast.textContent, "静态演示申请：LOCAL-DEMO-001");
    assert.equal(harness.exchangeMessages.length, 1);
  });
});
