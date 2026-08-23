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
