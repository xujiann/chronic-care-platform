const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("role pages keep explicit page guards", () => {
  const guards = {
    "citizen.html": "citizen",
    "mobile-preview.html": "citizen",
    "institution.html": "institution",
    "insurance.html": "insurance",
    "county.html": "county",
    "index.html": "commission",
    "platform.html": "commission",
    "workbench.html": "commission"
  };
  Object.entries(guards).forEach(([file, role]) => {
    assert.match(read(file), new RegExp(`requireRole\\(\\[\\"${role}\\"\\]\\)`), `${file} 缺少 ${role} 页面守卫`);
  });
});

test("citizen pages do not expose cross-role module links or management collections", () => {
  const citizenHtml = `${read("citizen.html")}\n${read("mobile-preview.html")}`;
  ["institution.html", "insurance.html", "county.html", "index.html", "platform.html", "workbench.html"].forEach((target) => {
    assert.doesNotMatch(citizenHtml, new RegExp(`href=[\\"']\\./${target}`), `居民页面不应链接到 ${target}`);
  });

  const citizenAssets = `${citizenHtml}\n${read("citizen.js")}`;
  ["authUsers", "securityEvents", "applicationCatalog", "institutionCreditEvaluations", "securityAcceptanceLedger"].forEach((key) => {
    assert.doesNotMatch(citizenAssets, new RegExp(`\\b${key}\\b`), `居民端资产不应依赖管理集合 ${key}`);
  });
});

test("application pages avoid placeholder navigation", () => {
  const pages = ["citizen.html", "mobile-preview.html", "institution.html", "insurance.html", "county.html", "index.html", "platform.html", "workbench.html"];
  pages.forEach((file) => assert.doesNotMatch(read(file), /href=["']#["']/, `${file} 存在空链接占位`));
});
