const fs = require("node:fs");
const path = require("node:path");
const { solutionAConfiguration } = require("../solution-a-connectors");
const ROOT = path.resolve(__dirname, "..");

function buildSolutionAReadiness(env = process.env) {
  const required = ["deploy/solution-a/docker-compose.yml", "deploy/solution-a/ohif-app-config.js", "deploy/solution-a/.env.example", "solution-a-connectors.js", "docs/solution-a-deployment.md", "server.js", "imaging-cloud.html", "imaging-cloud.js", "scripts/solution-a-acceptance.js"];
  const files = required.map((file) => ({ file, exists: fs.existsSync(path.join(ROOT, file)) }));
  const config = solutionAConfiguration(env);
  const checks = [
    { id: "solution-a:container-stack", ok: files.slice(0, 3).every((item) => item.exists) },
    { id: "solution-a:runtime-connectors", ok: files[3].exists },
    { id: "solution-a:operations-guide", ok: files[4].exists },
    { id: "solution-a:platform-api", ok: files.slice(5).every((item) => item.exists) },
    { id: "solution-a:data-exchange-acceptance", ok: files[8].exists },
    { id: "solution-a:production-secrets", ok: Boolean(env.HAPI_DB_PASSWORD && env.ORTHANC_PASSWORD), siteBlocker: true }
  ];
  return { generatedAt: new Date().toISOString(), ok: checks.filter((item) => !item.siteBlocker).every((item) => item.ok), productionReady: checks.every((item) => item.ok), checks, files, endpoints: { hapiFhir: config.hapiFhir.baseUrl, orthanc: config.orthanc.baseUrl, ohif: config.ohif.baseUrl } };
}

if (require.main === module) {
  const report = buildSolutionAReadiness();
  fs.mkdirSync(path.join(ROOT, "release"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "release/solution-a-readiness-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}
module.exports = { buildSolutionAReadiness };
