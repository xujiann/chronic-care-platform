const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const HOSTILE_TEXT = '<img data-quality-safety-xss src="x" onerror="window.__qualitySafetyXss=true">';

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `missing ${name}`);
  const signatureEnd = source.indexOf(") {", start);
  assert.notEqual(signatureEnd, -1, `missing body for ${name}`);
  const open = signatureEnd + 2;
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unclosed ${name}`);
}

function createFakeDocument() {
  const targets = new Map();
  const document = {
    createElement(tagName) {
      return {
        tagName,
        className: "",
        dataset: {},
        textContent: "",
        type: "",
        colSpan: 0,
        children: [],
        append(...children) {
          this.children.push(...children);
        },
        replaceChildren(...children) {
          this.children = children;
        }
      };
    },
    getElementById(id) {
      return targets.get(id) || null;
    }
  };
  document.mount = (id) => {
    const target = document.createElement("div");
    targets.set(id, target);
    return target;
  };
  return document;
}

function loadTrustedDom(document) {
  const source = fs.readFileSync(path.join(ROOT, "quality-safety.js"), "utf8");
  const names = [
    "createQualityElement",
    "qualityTextElement",
    "mountQualityContent",
    "qualityActionButton",
    "qualityLine",
    "qualityTable",
    "createQualityEmptyRow"
  ];
  const declarations = names.map((name) => extractFunction(source, name));
  const sandbox = { document };
  vm.runInNewContext(`${declarations.join("\n")}\nglobalThis.dom = { ${names.join(", ")} };`, sandbox);
  return sandbox.dom;
}

test("quality safety trusted DOM helpers preserve hostile text and dataset without parsing markup", () => {
  const document = createFakeDocument();
  const target = document.mount("quality-target");
  const dom = loadTrustedDom(document);
  const heading = dom.qualityTextElement("strong", HOSTILE_TEXT);
  const action = dom.qualityActionButton(HOSTILE_TEXT, { dispatch: HOSTILE_TEXT });

  assert.equal(dom.mountQualityContent("quality-target", [heading, action]), target);
  assert.equal(target.children[0].textContent, HOSTILE_TEXT);
  assert.equal(target.children[0].children.length, 0);
  assert.equal(target.children[1].textContent, HOSTILE_TEXT);
  assert.equal(target.children[1].dataset.dispatch, HOSTILE_TEXT);
  assert.equal(target.children[1].className, "inline-action");
  assert.equal(target.children[1].type, "button");
});

test("quality safety table helper preserves headers, populated rows and fixed empty state", () => {
  const document = createFakeDocument();
  const dom = loadTrustedDom(document);
  const populatedRow = dom.createQualityElement("tr", {}, dom.qualityTextElement("td", HOSTILE_TEXT));
  const populated = dom.qualityTable(["问题", "操作"], [populatedRow], "暂无记录");
  const empty = dom.qualityTable(["问题", "操作"], [], "暂无记录");

  assert.deepEqual(populated.children[0].children[0].children.map((item) => item.textContent), ["问题", "操作"]);
  assert.equal(populated.children[1].children[0].children[0].textContent, HOSTILE_TEXT);
  assert.equal(empty.children[1].children[0].children[0].textContent, "暂无记录");
  assert.equal(empty.children[1].children[0].children[0].className, "empty-cell");
  assert.equal(empty.children[1].children[0].children[0].colSpan, 2);
});

test("quality safety source has no generic HTML parsing fallback", () => {
  const source = fs.readFileSync(path.join(ROOT, "quality-safety.js"), "utf8");
  assert.doesNotMatch(source, /\binnerHTML\b|insertAdjacentHTML|DOMParser|createContextualFragment/);
  assert.match(source, /replaceChildren/);
});

function dashboardFixture(role = "commission", marker = "current-fixture") {
  return {
    role, generatedAt: "2026-09-09T00:00:00Z",
    issues: [{ id: "issue-fixture", title: marker, status: "open" }],
    rectifications: [{ id: "order-fixture", requirement: marker, status: "open" }],
    criticalValueAlerts: [{ id: "alert-fixture", title: marker }],
    clinicalPathwayCases: [{ id: "case-fixture", pathwayName: marker }],
    siteSignoffs: [{ id: "signoff-fixture", item: marker, ownerRole: role }],
    coreSystemMatrix: [{ id: "core-fixture", name: marker }]
  };
}

function packFixture(marker = "pack-fixture") {
  return {
    ok: true, summary: { sampleAccepted: 1, sampleRequests: 1 },
    securityFixture: { algorithm: marker },
    sampleRequests: [{ interfaceId: "interface-fixture", message: { eventType: marker } }]
  };
}

function controllerHarness(protocol = "http:") {
  const document = createFakeDocument();
  const lookup = document.getElementById;
  document.getElementById = (id) => lookup(id) || document.mount(id);
  document.querySelector = (selector) => document.getElementById(selector.slice(1));
  const listeners = new Map();
  document.addEventListener = (type, listener) => listeners.set(type, listener);
  for (const id of ["status-filter", "domain-filter", "search"]) document.getElementById(`quality-safety-${id}`).value = "";
  const requests = [];
  const alerts = [];
  let logouts = 0;
  const sandbox = {
    document, location: { protocol }, alert: (message) => alerts.push(message),
    window: { HealthCityAuth: { getToken: () => "", getUser: () => ({ role: "commission" }), logout: () => { logouts += 1; } } },
    fetch: (url, options) => new Promise((resolve, reject) => { requests.push({ url, options, resolve, reject }); })
  };
  const source = fs.readFileSync(path.join(ROOT, "quality-safety.js"), "utf8");
  const actions = ["dispatchIssue", "submitFeedback", "reviewOrder", "escalateOrder", "acknowledgeCritical", "disposeCritical", "reviewClinicalPathway", "reviewSiteSignoff", "submitSiteSignoffEvidence", "submitCoreSystemEvidence", "validateInterfaceSample"];
  vm.runInNewContext(`${source}\n;globalThis.controller = { loadQualitySafety, loadQualitySafetyInterfacePack, applyQualitySafetyFilters, resetQualitySafetyFilters, ${actions.join(", ")}, state: () => ({ dashboard: qualitySafetyState, pack: qualitySafetyInterfacePack, validation: qualitySafetyValidationResult }) };`, sandbox);
  function respond(index, body, status = 200) {
    requests[index].resolve({ status, ok: status >= 200 && status < 300, json: async () => body });
  }
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  return {
    api: sandbox.controller, document, requests, alerts, actions, respond, tick,
    get logouts() { return logouts; },
    async ready(role) { respond(0, dashboardFixture(role)); respond(1, packFixture()); await tick(); },
    all(id) { const walk = (node) => [node, ...node.children.flatMap(walk)]; return walk(document.getElementById(id)); },
    click(dataset) { listeners.get("click")({ target: { closest: (selector) => selector === "[data-dispatch]" ? { dataset } : null } }); }
  };
}

for (const kind of ["dashboard", "pack"]) {
  for (const failure of [401, 403, 500, "network", "json", "render"]) {
    test(`${kind} ${failure}: invalidates the snapshot and prevents stale actions`, async () => {
      const h = controllerHarness(); await h.ready();
      const load = kind === "dashboard" ? h.api.loadQualitySafety : h.api.loadQualitySafetyInterfacePack;
      const pending = load(); const index = h.requests.length - 1;
      if (failure === "network") h.requests[index].reject(new Error(HOSTILE_TEXT));
      else if (failure === "json") h.requests[index].resolve({ status: 200, ok: true, json: async () => { throw new SyntaxError(HOSTILE_TEXT); } });
      else h.respond(index, failure === "render" ? null : { message: HOSTILE_TEXT }, typeof failure === "number" ? failure : 200);
      await pending;
      assert.equal(h.api.state()[kind], null);
      if (failure === 401 || failure === 403) {
        assert.equal(h.api.state().dashboard, null);
        assert.equal(h.api.state().pack, null);
      }
      h.api.applyQualitySafetyFilters(); h.api.resetQualitySafetyFilters();
      if (kind === "dashboard" || failure === 401 || failure === 403) {
        const source = fs.readFileSync(path.join(ROOT, "quality-safety.js"), "utf8");
        const ids = new Set([...source.matchAll(/mountQualityContent\("(quality-safety-[^"]+)"/g)].map((match) => match[1]));
        ids.delete("quality-safety-interface-pack"); ids.add("quality-safety-blood-coordination");
        for (const id of ids) {
          const nodes = h.all(id);
          assert.equal(nodes.some((node) => node.tagName === "button"), false, id);
          assert.equal(nodes.some((node) => node.textContent === "current-fixture"), false, id);
          assert.match(nodes[1].textContent, /当前数据不可用/, id);
        }
        assert.equal(h.document.getElementById("quality-safety-updated").textContent, "");
        const before = h.requests.length;
        for (const name of h.actions.filter((name) => name !== "validateInterfaceSample")) await assert.rejects(h.api[name]("stale-fixture"));
        h.click({ dispatch: "issue-fixture" }); await h.tick();
        assert.equal(h.requests.length, before, "invalid dashboard must never POST");
      }
      if (kind === "pack" || failure === 401 || failure === 403) {
        assert.equal(h.api.state().validation, null);
        assert.equal(h.all("quality-safety-interface-pack").some((node) => node.tagName === "button"), false);
        await assert.rejects(h.api.validateInterfaceSample("interface-fixture"));
      }
      assert.equal(h.all(`quality-safety-${kind === "pack" ? "interface-pack" : "issues"}`).some((node) => node.tagName === "img"), false);
      assert.equal(h.logouts, failure === 401 ? 1 : 0);
    });
  }
}

for (const kind of ["dashboard", "pack"]) {
  for (const olderFails of [false, true]) {
    test(`${kind}: late ${olderFails ? "denial" : "success"} cannot replace newer result`, async () => {
      const h = controllerHarness(); await h.ready();
      const load = kind === "dashboard" ? h.api.loadQualitySafety : h.api.loadQualitySafetyInterfacePack;
      const older = load(); const oldIndex = h.requests.length - 1;
      const newer = load(); const newIndex = h.requests.length - 1;
      h.respond(newIndex, olderFails ? (kind === "dashboard" ? dashboardFixture("institution", "new-fixture") : packFixture("new-fixture")) : {}, olderFails ? 200 : 403);
      await newer;
      h.respond(oldIndex, olderFails ? {} : (kind === "dashboard" ? dashboardFixture() : packFixture()), olderFails ? 401 : 200);
      await older;
      if (olderFails) {
        assert.ok(h.api.state()[kind]);
        assert.equal(h.logouts, 0, "obsolete 401 must not log out a newer successful read");
        assert.equal(kind === "dashboard" ? h.api.state().dashboard.role : h.api.state().pack.securityFixture.algorithm, kind === "dashboard" ? "institution" : "new-fixture");
      } else assert.equal(h.api.state()[kind], null);
    });
  }
}

test("permission denial invalidates the other in-flight read", async () => {
  const h = controllerHarness(); await h.ready();
  const pack = h.api.loadQualitySafetyInterfacePack(); const packIndex = h.requests.length - 1;
  const dashboard = h.api.loadQualitySafety(); const dashIndex = h.requests.length - 1;
  h.respond(dashIndex, {}, 403); await dashboard;
  h.respond(packIndex, packFixture()); await pack;
  assert.equal(h.api.state().pack, null);
  assert.equal(h.api.state().dashboard, null);
});

for (const role of ["commission", "institution", "county"]) {
  test(`${role}: explicit successful reload recovers its current snapshot`, async () => {
    const h = controllerHarness(); await h.ready(role);
    const denial = h.api.loadQualitySafety(); h.respond(h.requests.length - 1, {}, 403); await denial;
    const retry = h.api.loadQualitySafety(); h.respond(h.requests.length - 1, dashboardFixture(role, HOSTILE_TEXT)); await retry;
    assert.equal(h.api.state().dashboard.role, role);
    assert.equal(h.api.state().pack, null, "dashboard success does not restore the old pack");
    assert.ok(h.all("quality-safety-issues").some((node) => node.textContent === HOSTILE_TEXT));
    assert.equal(h.all("quality-safety-issues").some((node) => node.tagName === "img"), false);
    const pack = h.api.loadQualitySafetyInterfacePack(); h.respond(h.requests.length - 1, packFixture()); await pack;
    assert.ok(h.api.state().pack);
  });
}

test("pending validation cannot resurrect a denied snapshot", async () => {
  const h = controllerHarness(); await h.ready();
  const validation = h.api.validateInterfaceSample("interface-fixture"); const validationIndex = h.requests.length - 1;
  const read = h.api.loadQualitySafety(); h.respond(h.requests.length - 1, {}, 403); await read;
  const count = h.requests.length;
  h.respond(validationIndex, { ok: true, status: "passed" }); await h.tick();
  assert.equal(h.requests.length, count, "stale write completion must not trigger recovery GET");
  await validation;
  assert.equal(h.api.state().validation, null);
  assert.equal(h.api.state().pack, null);
  assert.equal(h.requests.length, count, "stale write completion must not trigger recovery GET");
});

test("pending dashboard write cannot auto-recover after a permission denial", async () => {
  const h = controllerHarness(); await h.ready();
  const write = h.api.dispatchIssue("issue-fixture"); const writeIndex = h.requests.length - 1;
  const read = h.api.loadQualitySafety(); h.respond(h.requests.length - 1, {}, 403); await read;
  const count = h.requests.length;
  h.respond(writeIndex, { ok: true }); await h.tick();
  assert.equal(h.requests.length, count);
  await write;
  assert.equal(h.api.state().dashboard, null);
  assert.equal(h.requests.length, count);
});

test("file preview preserves existing request paths", async () => {
  const h = controllerHarness("file:"); await h.ready();
  assert.equal(h.requests[0].url, "/quality-safety/dashboard");
  assert.equal(h.requests[1].url, "/quality-safety/interface-joint-test-pack");
  assert.ok(h.api.state().dashboard);
});

const DASHBOARD_ACTIONS = [
  ["dispatchIssue", "issues/id-fixture/dispatch"],
  ["submitFeedback", "rectifications/id-fixture/feedback"],
  ["reviewOrder", "rectifications/id-fixture/review"],
  ["escalateOrder", "rectifications/id-fixture/escalate"],
  ["acknowledgeCritical", "critical-values/id-fixture/acknowledge"],
  ["disposeCritical", "critical-values/id-fixture/dispose"],
  ["reviewClinicalPathway", "clinical-pathways/id-fixture/review"],
  ["reviewSiteSignoff", "site-signoffs/id-fixture/review"],
  ["submitSiteSignoffEvidence", "site-signoffs/id-fixture/evidence"],
  ["submitCoreSystemEvidence", "core-systems/id-fixture/evidence"]
];
for (const [name, pathSuffix] of DASHBOARD_ACTIONS) {
  test(`${name}: valid snapshot preserves one POST and successful refresh`, async () => {
    const h = controllerHarness(); await h.ready();
    const pending = h.api[name]("id-fixture");
    assert.equal(h.requests[2].options.method, "POST");
    assert.equal(h.requests[2].url, `/api/quality-safety/${pathSuffix}`);
    h.respond(2, { ok: true }); await h.tick();
    assert.equal(h.requests.length, 4);
    assert.equal(h.requests[3].url, "/api/quality-safety/dashboard");
    h.respond(3, dashboardFixture()); await pending;
    assert.ok(h.api.state().dashboard);
  });
}

test("pack failure removes an already displayed validation result without erasing a valid dashboard", async () => {
  const h = controllerHarness(); await h.ready();
  const validation = h.api.validateInterfaceSample("interface-fixture");
  h.respond(2, { ok: true, status: "passed" }); await h.tick();
  h.respond(3, packFixture()); await validation;
  assert.equal(h.api.state().validation.ok, true);
  const failed = h.api.loadQualitySafetyInterfacePack(); h.respond(4, {}, 500); await failed;
  assert.equal(h.api.state().validation, null);
  assert.equal(h.api.state().pack, null);
  assert.ok(h.api.state().dashboard);
});

test("pack denial also prevents an in-flight dashboard from restoring data", async () => {
  const h = controllerHarness(); await h.ready();
  const dashboard = h.api.loadQualitySafety();
  const pack = h.api.loadQualitySafetyInterfacePack();
  h.respond(3, {}, 403); await pack;
  h.respond(2, dashboardFixture()); await dashboard;
  assert.equal(h.api.state().dashboard, null);
  assert.equal(h.api.state().pack, null);
});

for (const status of [401, 403]) {
  test(`invalid JSON HTTP ${status} still invalidates both snapshots`, async () => {
    const h = controllerHarness(); await h.ready();
    const read = h.api.loadQualitySafety();
    h.requests[2].resolve({ status, ok: false, json: async () => { throw new SyntaxError("raw provider text"); } });
    await read;
    assert.equal(h.api.state().dashboard, null);
    assert.equal(h.api.state().pack, null);
    assert.equal(h.logouts, status === 401 ? 1 : 0);
  });
}

test("partial dashboard render failure clears earlier mounted sections", async () => {
  const h = controllerHarness(); await h.ready();
  const read = h.api.loadQualitySafety();
  h.respond(2, { ...dashboardFixture(), coreSystemMatrix: {} }); await read;
  assert.equal(h.api.state().dashboard, null);
  assert.match(h.all("quality-safety-metrics")[1].textContent, /当前数据不可用/);
  assert.match(h.all("quality-safety-boundaries")[1].textContent, /当前数据不可用/);
});
