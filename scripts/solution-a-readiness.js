const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { solutionAConfiguration } = require("../solution-a-connectors");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_DICOM_BIND_ADDRESS = "127.0.0.1";
const IMAGE_POLICY = Object.freeze({
  HAPI_FHIR_IMAGE: Object.freeze({
    reference: "hapiproject/hapi:v8.10.0-3@sha256:55213612779ab3eeec919226b7bad378f0061ade823393a61d7dd46dd5087a3d",
    releaseSource: "https://github.com/hapifhir/hapi-fhir-jpaserver-starter",
    registrySource: "https://hub.docker.com/r/hapiproject/hapi"
  }),
  POSTGRES_IMAGE: Object.freeze({
    reference: "postgres:16.4-alpine@sha256:5660c2cbfea50c7a9127d17dc4e48543eedd3d7a41a595a2dfa572471e37e64c",
    releaseSource: "https://hub.docker.com/_/postgres",
    registrySource: "https://hub.docker.com/_/postgres"
  }),
  ORTHANC_IMAGE: Object.freeze({
    reference: "orthancteam/orthanc:26.8.1@sha256:ffdfa1141b6b89a631c10d5ac612e18b934d601c3501e73b597bd700ecfd4004",
    releaseSource: "https://orthanc.uclouvain.be/book/users/docker-orthancteam.html",
    registrySource: "https://hub.docker.com/r/orthancteam/orthanc"
  }),
  OHIF_IMAGE: Object.freeze({
    reference: "ohif/app:v3.12.11@sha256:157e2b9d89b214950fc9e43ce6f714d0e5fab83cb3e82b84edb97cac892fac7a",
    releaseSource: "https://github.com/OHIF/Viewers/releases/tag/v3.12.11",
    registrySource: "https://hub.docker.com/r/ohif/app"
  })
});

function isImmutableImageReference(value) {
  return /^[a-z0-9][a-z0-9./_-]*:[A-Za-z0-9_][A-Za-z0-9_.-]*@sha256:[a-f0-9]{64}$/.test(String(value || ""))
    && !/:latest@/i.test(String(value));
}

function composeDefault(source, variable) {
  const match = String(source).match(new RegExp(`\\$\\{${variable}:-([^}]+)\\}`));
  return match ? match[1] : "";
}

function envTemplate(source) {
  return Object.fromEntries(String(source).split(/\r?\n/).map((line) => {
    const separator = line.indexOf("=");
    return separator > 0 ? [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] : null;
  }).filter(Boolean));
}

function booleanValue(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function isPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return !normalized || /replace|change[-_ ]?me|example|placeholder|demo|test|password/.test(normalized);
}

function hasStrongSecret(value) {
  return !isPlaceholder(value) && String(value).length >= 24;
}

function hasProductionUsername(value) {
  const normalized = String(value || "").trim();
  return /^[A-Za-z0-9._-]{4,64}$/.test(normalized)
    && !isPlaceholder(normalized)
    && !/^(admin|root|orthanc)$/i.test(normalized);
}

function isLoopbackBindAddress(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "localhost") return true;
  const address = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  if (net.isIP(address) === 6) return address === "::1";
  return net.isIP(address) === 4 && address.split(".")[0] === "127";
}

function isControlledBindAddress(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (isLoopbackBindAddress(normalized)) return true;
  const address = normalized.startsWith("[") && normalized.endsWith("]") ? normalized.slice(1, -1) : normalized;
  if (net.isIP(address) === 4) {
    const octets = address.split(".").map(Number);
    return octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  }
  return net.isIP(address) === 6 && /^(fc|fd)/i.test(address);
}

function buildSolutionAReadiness(env = process.env, sourceOverrides = {}) {
  const required = ["deploy/solution-a/docker-compose.yml", "deploy/solution-a/ohif-app-config.js", "deploy/solution-a/.env.example", "solution-a-connectors.js", "docs/solution-a-deployment.md", "docs/方案A医院系统对接方案.md", "server.js", "imaging-cloud.html", "imaging-cloud.js", "scripts/solution-a-acceptance.js"];
  const files = required.map((file) => ({ file, exists: fs.existsSync(path.join(ROOT, file)) }));
  const composeSource = sourceOverrides.composeSource === undefined ? fs.readFileSync(path.join(ROOT, required[0]), "utf8") : sourceOverrides.composeSource;
  const templateSource = sourceOverrides.templateSource === undefined ? fs.readFileSync(path.join(ROOT, required[2]), "utf8") : sourceOverrides.templateSource;
  const template = envTemplate(templateSource);
  const config = solutionAConfiguration(env);
  const imagePolicy = Object.entries(IMAGE_POLICY).map(([variable, policy]) => {
    const composeReference = composeDefault(composeSource, variable);
    const templateReference = template[variable] || "";
    const effectiveReference = env[variable] || composeReference;
    return {
      variable,
      reference: policy.reference,
      releaseSource: policy.releaseSource,
      registrySource: policy.registrySource,
      immutable: isImmutableImageReference(policy.reference),
      composeMatchesPolicy: composeReference === policy.reference,
      templateMatchesPolicy: templateReference === policy.reference,
      effectiveMatchesPolicy: effectiveReference === policy.reference
    };
  });
  const authenticationDefault = composeDefault(composeSource, "ORTHANC_AUTHENTICATION_ENABLED");
  const dicomBindDefault = composeDefault(composeSource, "ORTHANC_DICOM_BIND_ADDRESS");
  const effectiveBindAddress = env.ORTHANC_DICOM_BIND_ADDRESS || dicomBindDefault;
  const internalChecks = [
    { id: "solution-a:container-stack", ok: files.slice(0, 3).every((item) => item.exists) },
    { id: "solution-a:runtime-connectors", ok: files[3].exists },
    { id: "solution-a:operations-guide", ok: files[4].exists },
    { id: "solution-a:platform-api", ok: files.slice(5).every((item) => item.exists) },
    { id: "solution-a:data-exchange-acceptance", ok: files[9].exists },
    { id: "solution-a:container-image-contract", ok: imagePolicy.every((item) => item.immutable && item.composeMatchesPolicy && item.templateMatchesPolicy), detail: "Compose defaults and the environment template must match the reviewed tag-and-digest policy." },
    { id: "solution-a:orthanc-authentication-default", ok: booleanValue(authenticationDefault, false) && booleanValue(template.ORTHANC_AUTHENTICATION_ENABLED, false), detail: "Orthanc authentication must default to enabled." },
    { id: "solution-a:dicom-loopback-default", ok: dicomBindDefault === DEFAULT_DICOM_BIND_ADDRESS && template.ORTHANC_DICOM_BIND_ADDRESS === DEFAULT_DICOM_BIND_ADDRESS, detail: "The DICOM listener must default to loopback." }
  ];
  const configurationChecks = [
    { id: "solution-a:production-image-selection", ok: imagePolicy.every((item) => item.effectiveMatchesPolicy), siteBlocker: true, detail: "Production overrides must use the repository-reviewed image references." },
    { id: "solution-a:production-credentials", ok: hasStrongSecret(env.HAPI_DB_PASSWORD) && hasStrongSecret(env.ORTHANC_PASSWORD) && hasProductionUsername(env.ORTHANC_USERNAME), siteBlocker: true, detail: "Production credentials must be non-placeholder values; secrets require at least 24 characters." },
    { id: "solution-a:production-authentication", ok: booleanValue(env.ORTHANC_AUTHENTICATION_ENABLED, true), siteBlocker: true, detail: "Orthanc authentication cannot be disabled in production." },
    { id: "solution-a:dicom-bind-address", ok: isControlledBindAddress(effectiveBindAddress), siteBlocker: true, detail: isLoopbackBindAddress(effectiveBindAddress) ? "DICOM remains loopback-only." : "A private bind address is configured and still requires site network acceptance." }
  ];
  const externalChecks = [
    { id: "solution-a:external-image-verification", ok: false, siteBlocker: true, externalEvidenceRequired: true, detail: "Real image pulls, SBOM/vulnerability scans, signatures and registry availability require external evidence." },
    { id: "solution-a:site-network-acceptance", ok: false, siteBlocker: true, externalEvidenceRequired: true, detail: "TLS, firewall allowlists, DICOM device reachability and segmentation require on-site acceptance." }
  ];
  const checks = [...internalChecks, ...configurationChecks, ...externalChecks];
  return {
    generatedAt: new Date().toISOString(),
    ok: internalChecks.every((item) => item.ok),
    configurationReady: configurationChecks.every((item) => item.ok),
    productionReady: checks.every((item) => item.ok),
    checks,
    files,
    images: imagePolicy.map(({ variable, reference, releaseSource, registrySource }) => ({ variable, reference, releaseSource, registrySource })),
    dicomBindingMode: isLoopbackBindAddress(effectiveBindAddress) ? "loopback" : isControlledBindAddress(effectiveBindAddress) ? "controlled-private" : "unsafe",
    endpoints: { hapiFhir: config.hapiFhir.baseUrl, orthanc: config.orthanc.baseUrl, ohif: config.ohif.baseUrl }
  };
}

function readinessExitCode(report, options = {}) {
  return (options.production ? report.productionReady : report.ok) ? 0 : 1;
}

if (require.main === module) {
  const report = buildSolutionAReadiness();
  const production = process.argv.slice(2).includes("--production") || /^production$/i.test(String(process.env.SOLUTION_A_DEPLOYMENT_PROFILE || ""));
  fs.mkdirSync(path.join(ROOT, "release"), { recursive: true });
  const output = { ...report, requestedProfile: production ? "production" : "rehearsal" };
  fs.writeFileSync(path.join(ROOT, "release/solution-a-readiness-report.json"), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify(output, null, 2));
  process.exitCode = readinessExitCode(report, { production });
}

module.exports = { DEFAULT_DICOM_BIND_ADDRESS, IMAGE_POLICY, buildSolutionAReadiness, isControlledBindAddress, isImmutableImageReference, isLoopbackBindAddress, isPlaceholder, readinessExitCode };
