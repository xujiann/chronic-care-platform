const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");

const LEGACY_SHADOW_MAP = {
  "internet-nursing.js": {
    entries: [
      ["nursing management system", "院内护理管理系统", "院内护理管理系统"],
      ["EMR", "电子病历", "电子病历"],
      ["medical insurance settlement", "医保结算", "医保结算"],
      ["health supervision platform", "卫健监管平台", "监管平台"],
      ["one-click alert", "一键报警", "一键报警"],
      ["service recorder", "服务记录仪", "服务记录仪"]
    ]
  },
  "quality-safety.js": {
    entries: [
      ["qualitySafetyEvents", "质量安全事件", "质量安全事件"],
      ["criticalValueAlerts", "危急值提醒", "危急值提醒"],
      ["clinicalPathwayCases", "临床路径病例", "临床路径病例"],
      ["medicalRecordQualityReviews", "病历质控复核", "病历质控复核"],
      ["mutualRecognitionQualityReviews", "互认质控复核", "互认质控复核"],
      ["qualityRectificationOrders", "整改工单", "整改工单"],
      ["qualitySafetySiteSignoffs", "现场联调签收", "现场联调签收"],
      ["diagnosticReports", "检查检验报告", "检查检验报告"],
      ["countyMutualRecognitionRecords", "县域互认记录", "县域互认记录"],
      ["hospitalInteroperabilityFunctions", "院内系统管理能力", "医院互联互通功能"]
    ]
  }
};

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

function extractBalanced(source, start, open = "{", close = "}") {
  const openAt = source.indexOf(open, start);
  assert.notEqual(openAt, -1, `missing ${open}`);
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = openAt; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) depth += 1;
    if (character === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unclosed ${open}`);
}

function loadInternetNursingTranslator() {
  const source = read("internet-nursing.js");
  const start = source.indexOf("function displayText(value)");
  const declaration = extractBalanced(source, start);
  const sandbox = { window: {} };
  vm.runInNewContext(`${declaration}\nglobalThis.translate = displayText;`, sandbox);
  return sandbox.translate;
}

function loadQualitySafetyTranslators() {
  const source = read("quality-safety.js");
  const declarations = [
    "const QUALITY_TEXT =",
    "function zh(value)",
    "function text(value)",
    "function zhText(value)",
    "function statusLabel(value)"
  ].map((marker) => {
    const start = source.indexOf(marker);
    assert.notEqual(start, -1, marker);
    return extractBalanced(source, start);
  });
  const sandbox = { location: { protocol: "file:" }, window: {} };
  vm.runInNewContext(`${declarations.join("\n")}\nglobalThis.translators = { zh, zhText, statusLabel };`, sandbox);
  return sandbox.translators;
}

function countPropertyDeclarations(objectSource, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = objectSource.match(new RegExp(`^\\s*(?:"${escaped}"|${escaped})\\s*:`, "gm"));
  return matches?.length || 0;
}

test("the 16 legacy duplicate keys have an explicit shadow map and stable final values", () => {
  const entries = Object.values(LEGACY_SHADOW_MAP).flatMap((item) => item.entries);
  assert.equal(entries.length, 16);
  for (const [key, shadowedValue, effectiveValue] of entries) {
    const legacyRuntimeObject = Object.fromEntries([
      [key, shadowedValue],
      [key, effectiveValue]
    ]);
    assert.equal(legacyRuntimeObject[key], effectiveValue, key);
  }
});

test("internet nursing and quality safety callers retain every effective translation", () => {
  const displayText = loadInternetNursingTranslator();
  for (const [key, , effectiveValue] of LEGACY_SHADOW_MAP["internet-nursing.js"].entries) {
    assert.equal(displayText(key), effectiveValue, key);
  }

  const { zh, zhText, statusLabel } = loadQualitySafetyTranslators();
  for (const [key, , effectiveValue] of LEGACY_SHADOW_MAP["quality-safety.js"].entries) {
    assert.equal(zh(key), effectiveValue, `zh:${key}`);
    assert.equal(zhText(key), effectiveValue, `zhText:${key}`);
    assert.equal(statusLabel(key), effectiveValue, `statusLabel:${key}`);
    assert.equal(zh(`source ${key}`), `source ${effectiveValue}`, `embedded:${key}`);
  }
});

test("each former shadowed key has one declaration and no lint exception", () => {
  const internetSource = read("internet-nursing.js");
  const labelsStart = internetSource.indexOf("const labels = {");
  const internetLabels = extractBalanced(internetSource, labelsStart);
  for (const [key] of LEGACY_SHADOW_MAP["internet-nursing.js"].entries) {
    assert.equal(countPropertyDeclarations(internetLabels, key), 1, key);
  }

  const qualitySource = read("quality-safety.js");
  const qualityStart = qualitySource.indexOf("const QUALITY_TEXT = {");
  const qualityLabels = extractBalanced(qualitySource, qualityStart);
  for (const [key] of LEGACY_SHADOW_MAP["quality-safety.js"].entries) {
    assert.equal(countPropertyDeclarations(qualityLabels, key), 1, key);
  }

  const eslintSource = read("eslint.config.js");
  assert.doesNotMatch(eslintSource, /no-dupe-keys["']?\s*:\s*["']off["']/);
  assert.doesNotMatch(eslintSource, /files:\s*\["internet-nursing\.js",\s*"quality-safety\.js"\]/);
});
