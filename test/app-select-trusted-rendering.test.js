"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const HOSTILE_TEXT = '<img data-app-select-xss src=x onerror="globalThis.appSelectCompromised=true">';

function createElement(tagName) {
  return {
    tagName: String(tagName).toUpperCase(),
    value: "",
    textContent: ""
  };
}

function createSelect() {
  return {
    children: [],
    innerHTMLWrites: 0,
    activeMarkupCount: 0,
    set innerHTML(value) {
      this.innerHTMLWrites += 1;
      this.activeMarkupCount = (String(value).match(/<img\b/gi) || []).length;
    },
    replaceChildren(...children) {
      this.children = children;
      this.activeMarkupCount = 0;
    }
  };
}

test("management resident and organization selects keep hostile state fields as inert option text", () => {
  const residentSelects = [createSelect(), createSelect()];
  const organizationSelect = createSelect();
  const organizationFilter = createSelect();
  const document = {
    addEventListener() {},
    createElement,
    querySelectorAll(selector) {
      assert.equal(selector, 'select[name="residentId"]');
      return residentSelects;
    },
    querySelector(selector) {
      if (selector === 'select[name="organization"]') return organizationSelect;
      if (selector === "#resident-org-filter") return organizationFilter;
      throw new Error(`unexpected selector: ${selector}`);
    }
  };
  const context = vm.createContext({
    console,
    crypto: globalThis.crypto,
    document,
    fetch: async () => { throw new Error("unexpected fetch"); },
    location: { protocol: "https:" },
    localStorage: { getItem() { return null; }, setItem() {} },
    structuredClone,
    window: {}
  });
  vm.runInContext(fs.readFileSync(path.join(ROOT, "app.js"), "utf8"), context, { filename: "app.js" });
  vm.runInContext(`state = { residents: [{ id: ${JSON.stringify(HOSTILE_TEXT)}, name: ${JSON.stringify(HOSTILE_TEXT)} }] }; organizations.splice(0, organizations.length, ${JSON.stringify(HOSTILE_TEXT)}); populateSelects();`, context);

  for (const select of [...residentSelects, organizationSelect, organizationFilter]) {
    assert.equal(select.innerHTMLWrites, 0);
    assert.equal(select.activeMarkupCount, 0);
  }
  for (const select of residentSelects) {
    assert.equal(select.children.length, 1);
    assert.equal(select.children[0].value, HOSTILE_TEXT);
    assert.equal(select.children[0].textContent, HOSTILE_TEXT);
  }
  assert.deepEqual(
    organizationSelect.children.map((option) => [option.value, option.textContent]),
    [[HOSTILE_TEXT, HOSTILE_TEXT]]
  );
  assert.deepEqual(
    organizationFilter.children.map((option) => [option.value, option.textContent]),
    [["", "全部机构"], [HOSTILE_TEXT, HOSTILE_TEXT]]
  );
  assert.equal(context.appSelectCompromised, undefined);
});
