"use strict";

const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { buildPublicDemoSnapshot } = require("../src/platform/data/public-demo-snapshot");
const { collectPublicAssets, loadStaticPublicationContract } = require("../src/http/static-asset-policy");
const { browserSecurityReadiness, loadBrowserSecurityPolicy } = require("../src/http/browser-security-policy");
const { scanBrowserSecurityInventory, verifyBrowserSecurityInventory } = require("../src/http/browser-security-inventory");

const ROOT = path.resolve(__dirname, "..");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function resolveOutput(value) {
  if (!value) throw new Error("Static publication build requires --output=<directory>");
  const output = path.resolve(value);
  const relative = path.relative(ROOT, output);
  const insideRepository = !relative
    || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
  if (insideRepository) {
    throw new Error("Static publication output must be outside the repository");
  }
  if (fs.existsSync(output) && fs.readdirSync(output).length) {
    throw new Error(`Static publication output must be empty: ${output}`);
  }
  return output;
}

function generatedAsset(relativePath, definition, generatedAt) {
  if (definition.generator !== "public-demo-snapshot") {
    throw new Error(`Unknown static asset generator: ${definition.generator}`);
  }
  if (definition.source !== "data/db.json") throw new Error(`Public demo source is not approved: ${definition.source}`);
  const source = path.resolve(ROOT, ...definition.source.split("/"));
  const raw = JSON.parse(fs.readFileSync(source, "utf8"));
  const result = buildPublicDemoSnapshot(raw, { generatedAt });
  return `${JSON.stringify(result.snapshot, null, 2)}\n`;
}

function buildStaticPublication(options = {}) {
  const output = resolveOutput(options.output);
  const contract = options.contract || loadStaticPublicationContract();
  const assets = collectPublicAssets(ROOT, contract);
  const browserSecurityPolicy = loadBrowserSecurityPolicy();
  const browserSecurityInventory = scanBrowserSecurityInventory({ root: ROOT, assets });
  const browserSecurityVerification = verifyBrowserSecurityInventory(browserSecurityInventory, browserSecurityPolicy.riskBaseline);
  if (!browserSecurityVerification.ok) {
    throw new Error(`Browser security inventory rejected: ${browserSecurityVerification.code}`);
  }
  const generatedAt = options.generatedAt || new Date().toISOString();
  fs.mkdirSync(output, { recursive: true });

  const files = assets.map((relativePath) => {
    const destination = path.resolve(output, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    let content;
    const generated = contract.generatedAssets && contract.generatedAssets[relativePath];
    if (generated) {
      content = Buffer.from(generatedAsset(relativePath, generated, generatedAt));
      fs.writeFileSync(destination, content);
    } else {
      content = fs.readFileSync(path.resolve(ROOT, ...relativePath.split("/")));
      fs.writeFileSync(destination, content);
    }
    return { path: relativePath, bytes: content.length, sha256: sha256(content), generated: Boolean(generated) };
  });

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    profile: "public-static",
    browserSecurity: {
      ...browserSecurityReadiness({ policy: browserSecurityPolicy }),
      inventory: browserSecurityInventory.summary,
      baselineRevision: browserSecurityPolicy.riskBaseline.sourceRevision,
      externalHeaderApplicationRequired: browserSecurityPolicy.staticHosting.headerApplicationRequired === true
    },
    files
  };
  return { output, manifest };
}

function inventoryStaticPublication() {
  const contract = loadStaticPublicationContract();
  const assets = collectPublicAssets(ROOT, contract);
  return {
    schemaVersion: contract.schemaVersion,
    entrypoints: contract.entrypoints.length,
    generatedAssets: Object.keys(contract.generatedAssets || {}),
    assets
  };
}

function argument(name) {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return match ? match.slice(prefix.length) : "";
}

/* c8 ignore next 12 */
if (require.main === module) {
  try {
    const command = process.argv[2] || "inventory";
    const result = command === "build"
      ? buildStaticPublication({ output: argument("output") })
      : inventoryStaticPublication();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`static publication failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { buildStaticPublication, inventoryStaticPublication, resolveOutput };
