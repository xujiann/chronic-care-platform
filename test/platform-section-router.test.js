"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(ROOT, "platform-section-router.js"), "utf8");
const html = fs.readFileSync(path.join(ROOT, "platform.html"), "utf8");

function classList() {
  const values = new Set();
  return { toggle(value, force) { if (force) values.add(value); else values.delete(value); }, contains(value) { return values.has(value); } };
}

function element(tagName, options = {}) {
  return {
    tagName,
    id: options.id || "",
    className: options.className || "",
    textContent: options.textContent || "",
    dataset: {},
    attributes: {},
    children: [],
    parentNode: options.parentNode || null,
    nextSibling: null,
    tabIndex: 0,
    classList: classList(),
    listeners: {},
    querySelector(selector) { return selector === "h2" && options.title ? { textContent: options.title } : null; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; },
    append(...children) { this.children.push(...children); },
    addEventListener(type, listener) { this.listeners[type] = listener; },
    focus() { this.focused = true; }
  };
}

function loadApi(overrides = {}) {
  const document = overrides.document || { readyState: "loading", addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const sandbox = { document, location: { hash: overrides.hash || "" }, history: { pushState(_state, _title, next) { sandbox.location.hash = next; } }, addEventListener() {} };
  vm.runInNewContext(source, sandbox);
  return { api: sandbox.HealthPlatformSectionRouter, sandbox };
}

test("platform loads the task view router without changing existing section ids", () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/platform-section-router\.css" \/>/);
  assert.match(html, /<script src="\.\/platform-section-router\.js"><\/script>/);
  assert.equal((html.match(/<section\b/g) || []).length, 33);
  for (const id of ["platform-metrics", "platform-procurement-governance-center", "identity-lifecycle-center", "production-go-no-go-center"]) assert.match(html, new RegExp(`id="${id}"`));
});

test("all 33 platform sections have one closed task category", () => {
  const { api } = loadApi();
  const blocks = html.match(/<section\b[\s\S]*?<\/section>/g) || [];
  const categories = new Set(api.CATEGORIES.map((item) => item.key));
  const classified = blocks.map((block) => {
    const id = block.match(/\bid="([^"]+)"/)?.[1] || "";
    const title = block.match(/<h2[^>]*>([^<]+)<\/h2>/)?.[1] || "";
    return api.classifySection(element("section", { id, title }));
  });
  assert.equal(blocks.length, 33);
  assert.equal(classified.every((category) => categories.has(category) && category !== "all"), true);
  for (const required of ["overview", "requirements", "identity", "operations", "release", "evidence"]) assert.ok(classified.includes(required), `${required} must classify at least one section`);
});

test("hash parsing is allowlisted and defaults fail closed to overview", () => {
  const { api } = loadApi();
  assert.equal(api.parseHash("#platform-view=requirements"), "requirements");
  assert.equal(api.parseHash("#platform-view=all"), "all");
  assert.equal(api.parseHash("#platform-view=unknown"), "overview");
  assert.equal(api.parseHash("#platform-view=%E0%A4%A"), "overview");
  assert.equal(api.parseHash("#identity-lifecycle-center"), "overview");
});

test("mount creates keyboard toolbar and hides only non-selected categories", () => {
  const parent = { inserted: null, insertBefore(node) { this.inserted = node; } };
  const header = element("header", { parentNode: parent });
  const sections = [
    element("section", { id: "platform-metrics" }),
    element("section", { id: "platform-procurement-governance-center" }),
    element("section", { id: "identity-lifecycle-center" }),
    element("section", { id: "production-go-no-go-center" }),
    element("section", { title: "验收证据库" })
  ];
  const document = {
    readyState: "loading",
    documentElement: element("html"),
    addEventListener() {},
    createElement: (tagName) => element(tagName),
    querySelector(selector) { return selector === "main.portal-shell > .portal-header" ? header : null; },
    querySelectorAll(selector) { return selector === "main.portal-shell > section" ? sections : []; }
  };
  const { api } = loadApi({ document, hash: "#platform-view=requirements" });
  assert.equal(api.mount(document), true);
  assert.equal(parent.inserted.id, "platform-section-router");
  assert.equal(parent.inserted.children[1].attributes.role, "toolbar");
  assert.equal(sections[0].attributes["data-platform-view-hidden"], "true");
  assert.equal(sections[1].attributes["data-platform-view-hidden"], undefined);
  api.activate("all", { updateHash: false });
  assert.equal(sections.every((section) => section.attributes["data-platform-view-hidden"] === undefined), true);
  const buttons = parent.inserted.children[1].children;
  const requirementsButton = buttons.find((button) => button.dataset.platformView === "requirements");
  requirementsButton.listeners.keydown({ key: "ArrowRight", preventDefault() {} });
  assert.equal(buttons.find((button) => button.dataset.platformView === "identity").focused, true);
});

test("router uses safe DOM and fixed CSS classes without growing browser sink inventory", () => {
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\.style\b|window\.prompt|\beval\s*\(/);
  assert.match(source, /createElement/);
  assert.match(source, /textContent/);
  assert.match(source, /setAttribute\("data-platform-view-hidden"/);
  const css = fs.readFileSync(path.join(ROOT, "platform-section-router.css"), "utf8");
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /data-platform-view-hidden="true"/);
  assert.match(css, /@media \(max-width: 720px\)/);
});
