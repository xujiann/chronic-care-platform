#!/usr/bin/env node
const { readRuntimeSource } = require("../src/http/runtime-source");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "chronic-informatization-sources.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "chronic-informatization-sources.md");
const INVENTORY_DOC = "docs/chronic-informatization-source-inventory.md";
const LOCAL_PLANNING_ID = "da" + "lian-planning";

const CATEGORY_RULES = [
  {
    id: "policy-standards",
    name: "Policy and standards",
    pattern: /规范|指标|意见|建设指引|2012|2014|防控示范区/i,
    focus: "政策规范、监测指标、服务能力和质控口径"
  },
  {
    id: LOCAL_PLANNING_ID,
    name: "Regional planning and feasibility",
    pattern: /区域|宁波方案|可行性|规划方案|医防融合/i,
    focus: "本地平台定位、医防融合网络、项目建设范围和上线路径"
  },
  {
    id: "sanming-yuxi-case",
    name: "Sanming and Youxi references",
    pattern: /三明|三高共管|尤溪/i,
    focus: "三高共管、总医院一体化、基层协同和慢病中心运营经验"
  },
  {
    id: "monitoring-research",
    name: "Monitoring and research references",
    pattern: /浙江|监测|防制|研究/i,
    focus: "综合监测、专病库、风险模型和疾控统计分析"
  },
  {
    id: "system-design",
    name: "System design and architecture",
    pattern: /平台|体系|系统结构|流程|结构图|png/i,
    focus: "系统结构、业务流程、数据对象、页面入口和模块拆分"
  },
  {
    id: "repo-evidence",
    name: "Repository implementation evidence",
    pattern: /chronic-|政策依据|慢病平台系统结构图/i,
    focus: "仓库内已实现的慢病 API、readiness、上线核心和发布证据"
  }
];

const CAPABILITY_TRACKS = [
  {
    id: "screening-tiered-management",
    name: "Screening, stratification and tiered management",
    sourceCategories: ["policy-standards", LOCAL_PLANNING_ID, "system-design"],
    dataCollections: ["chronicScreeningTasks", "chronicManagementPlans", "chronicServicePathways"],
    apiMarkers: ["/api/chronic/risk-stratification", "/api/chronic/followup-summary"],
    docMarkers: ["docs/chronic-followup-readiness.md", "docs/政策依据说明.md"]
  },
  {
    id: "followup-resident-feedback",
    name: "Follow-up, resident feedback and outreach",
    sourceCategories: ["policy-standards", "sanming-yuxi-case", "system-design"],
    dataCollections: ["followups", "taskMessages", "personalRecords"],
    apiMarkers: ["/api/chronic/followup-feedback", "/api/chronic/followup-escalations", "/api/chronic/reminder-outreach"],
    docMarkers: ["docs/chronic-followup-readiness.md"]
  },
  {
    id: "comorbidity-tcm-self-management",
    name: "Comorbidity, TCM and self-management",
    sourceCategories: ["policy-standards", "sanming-yuxi-case"],
    dataCollections: ["chronicComorbidityPlans", "chronicTcmServices", "chronicSelfManagement"],
    apiMarkers: ["/api/chronic-comorbidity-plans", "/api/chronic-tcm-services", "/api/chronic-self-management"],
    docMarkers: ["docs/政策依据说明.md", "docs/慢病平台系统结构图与优化建议.md"]
  },
  {
    id: "medication-insurance-pharmacy",
    name: "Medication support, long prescription and insurance closure",
    sourceCategories: ["policy-standards", LOCAL_PLANNING_ID, "sanming-yuxi-case"],
    dataCollections: ["medicationPickups", "insuranceClaims", "chronicPharmacyInsuranceLinks"],
    apiMarkers: ["/api/chronic/pharmacy-callbacks", "/api/chronic-medication-support", "/api/chronic/pharmacy-insurance-closure"],
    docMarkers: ["docs/chronic-launch-core.md", "docs/chronic-followup-readiness.md", "docs/chronic-institution-interfaces.md"]
  },
  {
    id: "institution-integration-launch",
    name: "Institution integration and launch core",
    sourceCategories: [LOCAL_PLANNING_ID, "system-design", "repo-evidence"],
    dataCollections: ["chronicExternalIntegrations", "chronicLaunchCoreSignoffs", "chronicIdentityScopes", "personalRecords"],
    apiMarkers: ["/api/chronic/institution-interfaces", "/api/chronic/launch-core", "/api/chronic/production-safety", "/api/chronic/production-safety-evidence", "/api/chronic/interoperability-profiles", "/api/chronic/interoperability-validation", "/api/chronic/archive-standard", "/api/chronic/referral-continuity"],
    docMarkers: ["docs/chronic-institution-interfaces.md", "docs/chronic-launch-core.md"]
  },
  {
    id: "monitoring-quality-public-health",
    name: "Monitoring, quality control and public-health loop",
    sourceCategories: ["monitoring-research", "policy-standards", "repo-evidence"],
    dataCollections: ["chronicQualityMetrics", "diseaseRegistryModels", "publicHealthEvents"],
    apiMarkers: ["/api/chronic/public-health-loop", "/api/chronic/pathway-quality", "/api/process-audit"],
    docMarkers: ["docs/chronic-followup-readiness.md", "docs/政策依据说明.md"]
  }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function readText(relativePath, fallback = "") {
  const file = path.join(ROOT, relativePath);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : fallback;
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/");
}

function classifySource(name) {
  const matches = CATEGORY_RULES.filter((rule) => rule.pattern.test(name)).map((rule) => rule.id);
  return matches.length ? matches : ["system-design"];
}

function scanExternalSources(sourceDirs = [path.resolve(ROOT, "..", "慢病"), path.resolve(ROOT, "..")]) {
  const seen = new Set();
  const rows = [];
  for (const dir of sourceDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (![".doc", ".docx", ".pdf", ".pptx", ".png", ".md"].includes(ext)) continue;
      if (!/慢|慢性病|三高|高血压|糖尿病|基层|浙江|三明|尤溪|宁波|区域|监测|防控|体系|平台/i.test(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      const key = normalizePath(path.relative(ROOT, fullPath));
      if (seen.has(key)) continue;
      seen.add(key);
      const stat = fs.statSync(fullPath);
      rows.push({
        id: `external-${rows.length + 1}`,
        name: entry.name,
        path: key,
        extension: ext.slice(1),
        size: stat.size,
        categories: classifySource(entry.name),
        origin: "workspace-source"
      });
    }
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));
}

function parseInventoryDoc(markdown = readText(INVENTORY_DOC)) {
  return markdown
    .split(/\r?\n/)
    .filter((line) => /^\|\s*src-/.test(line))
    .map((line) => line.split("|").slice(1, -1).map((cell) => cell.trim()))
    .map(([id, name, categoryText, sourcePath, capabilityText]) => ({
      id,
      name,
      path: sourcePath,
      extension: path.extname(sourcePath).replace(/^\./, "") || "md",
      size: 0,
      categories: categoryText.split(",").map((item) => item.trim()).filter(Boolean),
      mappedCapabilities: capabilityText.split(",").map((item) => item.trim()).filter(Boolean),
      origin: "inventory-doc"
    }));
}

function mergeSources(externalSources, inventorySources) {
  const byName = new Map();
  [...inventorySources, ...externalSources].forEach((source) => {
    const key = source.name;
    const existing = byName.get(key);
    byName.set(key, {
      ...(existing || {}),
      ...source,
      categories: [...new Set([...(existing?.categories || []), ...(source.categories || [])])],
      mappedCapabilities: [...new Set([...(existing?.mappedCapabilities || []), ...(source.mappedCapabilities || [])])],
      origins: [...new Set([...(existing?.origins || (existing?.origin ? [existing.origin] : [])), source.origin].filter(Boolean))]
    });
  });
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, "zh-Hans-CN"));
}

function buildTrackEvidence(track, context) {
  const categoriesCovered = track.sourceCategories.filter((category) => context.categoryCounts[category] > 0);
  const dataCovered = track.dataCollections.filter((key) => Array.isArray(context.data[key]) && context.data[key].length > 0);
  const apiCovered = track.apiMarkers.filter((marker) => context.serverSource.includes(marker));
  const docsCovered = track.docMarkers.filter((marker) => {
    const relative = marker.replace(/^docs\//, "");
    return context.docIndex.has(marker) || context.docIndex.has(`docs/${relative}`);
  });
  return {
    ...track,
    categoriesCovered,
    dataCovered,
    apiCovered,
    docsCovered,
    ready: categoriesCovered.length === track.sourceCategories.length &&
      dataCovered.length === track.dataCollections.length &&
      apiCovered.length === track.apiMarkers.length &&
      docsCovered.length === track.docMarkers.length
  };
}

function buildChronicInformatizationSourceReport(options = {}) {
  const data = options.data || readJson("data/db.json");
  const pkg = options.pkg || readJson("package.json");
  const serverSource = options.serverSource || readRuntimeSource(ROOT);
  const externalSources = options.externalSources || scanExternalSources(options.sourceDirs);
  const inventorySources = options.inventorySources || parseInventoryDoc(options.inventoryMarkdown);
  const sources = mergeSources(externalSources, inventorySources);
  const docPaths = [
    INVENTORY_DOC,
    "docs/chronic-followup-readiness.md",
    "docs/chronic-launch-core.md",
    "docs/chronic-institution-interfaces.md",
    "docs/政策依据说明.md",
    "docs/慢病平台系统结构图与优化建议.md"
  ];
  const docIndex = new Set(docPaths.filter((relativePath) => fs.existsSync(path.join(ROOT, relativePath))));
  const categoryCounts = Object.fromEntries(CATEGORY_RULES.map((rule) => [
    rule.id,
    sources.filter((source) => (source.categories || []).includes(rule.id)).length
  ]));
  const context = { data, serverSource, docIndex, categoryCounts };
  const capabilityTracks = CAPABILITY_TRACKS.map((track) => buildTrackEvidence(track, context));
  const checks = [
    {
      id: "sources:inventory-doc",
      passed: docIndex.has(INVENTORY_DOC),
      detail: INVENTORY_DOC
    },
    {
      id: "sources:workspace-or-inventory",
      passed: sources.length >= 12,
      detail: `${sources.length} chronic informatization source rows`
    },
    {
      id: "sources:category-coverage",
      passed: CATEGORY_RULES.every((rule) => categoryCounts[rule.id] > 0),
      detail: CATEGORY_RULES.map((rule) => `${rule.id}:${categoryCounts[rule.id]}`).join(";")
    },
    {
      id: "sources:capability-tracks",
      passed: capabilityTracks.every((track) => track.ready),
      detail: `${capabilityTracks.filter((track) => track.ready).length}/${capabilityTracks.length} tracks ready`
    },
    {
      id: "sources:release-script",
      passed: Boolean(pkg.scripts?.["chronic:informatization-sources"]),
      detail: pkg.scripts?.["chronic:informatization-sources"] || "missing"
    }
  ];
  return {
    ok: checks.every((check) => check.passed),
    generatedAt: new Date().toISOString(),
    module: "chronic-informatization",
    summary: {
      sources: sources.length,
      externalSources: sources.filter((source) => (source.origins || []).includes("workspace-source") || source.origin === "workspace-source").length,
      categories: CATEGORY_RULES.length,
      categoriesCovered: Object.values(categoryCounts).filter((value) => value > 0).length,
      capabilityTracks: capabilityTracks.length,
      readyCapabilityTracks: capabilityTracks.filter((track) => track.ready).length
    },
    categories: CATEGORY_RULES.map((rule) => ({
      id: rule.id,
      name: rule.name,
      focus: rule.focus,
      count: categoryCounts[rule.id] || 0
    })),
    sources,
    capabilityTracks,
    checks,
    artifacts: {
      inventory: INVENTORY_DOC,
      json: "release/chronic-informatization-sources.json",
      markdown: "release/chronic-informatization-sources.md",
      followupReadiness: "release/chronic-followup-readiness-report.json"
    }
  };
}

function renderMarkdown(report) {
  const categoryRows = report.categories.map((item) => `| ${item.id} | ${item.name} | ${item.count} | ${item.focus} |`).join("\n");
  const sourceRows = report.sources.map((item) => `| ${item.id} | ${item.name} | ${(item.categories || []).join(", ")} | ${item.path} | ${(item.origins || [item.origin]).filter(Boolean).join(", ")} |`).join("\n");
  const trackRows = report.capabilityTracks.map((item) => `| ${item.ready ? "PASS" : "FAIL"} | ${item.id} | ${item.name} | ${item.dataCovered.length}/${item.dataCollections.length} | ${item.apiCovered.length}/${item.apiMarkers.length} | ${item.docsCovered.length}/${item.docMarkers.length} |`).join("\n");
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`).join("\n");
  return [
    "# Chronic informatization source inventory",
    "",
    `Generated: ${report.generatedAt}`,
    "",
    `Overall: ${report.ok ? "PASS" : "FAIL"}`,
    "",
    "## Summary",
    "",
    `- Sources: ${report.summary.sources}`,
    `- Categories covered: ${report.summary.categoriesCovered}/${report.summary.categories}`,
    `- Capability tracks ready: ${report.summary.readyCapabilityTracks}/${report.summary.capabilityTracks}`,
    "",
    "## Categories",
    "",
    "| Category | Name | Sources | Focus |",
    "| --- | --- | --- | --- |",
    categoryRows,
    "",
    "## Capability Tracks",
    "",
    "| Result | Track | Name | Data | API | Docs |",
    "| --- | --- | --- | --- | --- | --- |",
    trackRows,
    "",
    "## Source Files",
    "",
    "| ID | Name | Categories | Path | Origin |",
    "| --- | --- | --- | --- | --- |",
    sourceRows,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "| --- | --- | --- |",
    checkRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  return argv.reduce((flags, arg) => {
    if (!arg.startsWith("--")) return flags;
    const [key, ...value] = arg.slice(2).split("=");
    flags[key] = value.length ? value.join("=") : true;
    return flags;
  }, {});
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
  return { output, markdown };
}

function main() {
  const flags = parseArgs();
  const report = buildChronicInformatizationSourceReport();
  if (flags.write !== false) writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

if (require.main === module) main();

module.exports = {
  CATEGORY_RULES,
  CAPABILITY_TRACKS,
  buildChronicInformatizationSourceReport,
  parseArgs,
  renderMarkdown,
  writeOutput
};
