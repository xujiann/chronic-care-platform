#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "identity-contract.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "identity-contract.md");

const ROLE_PORTALS = {
  commission: ["index.html", "workbench.html"],
  institution: ["institution.html", "internet-nursing.html", "doctor.html"],
  insurance: ["insurance.html"],
  citizen: ["citizen.html"],
  county: ["county.html"]
};

const REQUIRED_CLAIMS = [
  { claim: "sub", required: true, purpose: "stable external subject identifier" },
  { claim: "preferred_username", required: true, purpose: "platform username lookup and audit actor" },
  { claim: "name", required: true, purpose: "display name and audit trail actor label" },
  { claim: "orgCode", required: true, purpose: "authOrganizations.orgCode lookup" },
  { claim: "roles", required: true, purpose: "maps to commission/institution/insurance/citizen/county" },
  { claim: "orgName", required: false, purpose: "fallback organization display name" },
  { claim: "orgType", required: false, purpose: "fallback role inference when roles are absent" },
  { claim: "dataScope", required: false, purpose: "site-specific access scope description" }
];

const SAMPLE_CLAIMS = [
  { id: "identity-commission", orgCode: "ORG-HEALTH-DL", roles: ["health_admin", "commission"], expectedRole: "commission", expectedHome: "index.html" },
  { id: "identity-institution", orgCode: "MR3", roles: ["doctor"], expectedRole: "institution", expectedHome: "doctor.html" },
  { id: "identity-insurance", orgCode: "ORG-MI-CENTER-DL", roles: ["insurance"], expectedRole: "insurance", expectedHome: "insurance.html" },
  { id: "identity-county", orgCode: "ORG-CONSORTIUM-ZS", roles: ["county"], expectedRole: "county", expectedHome: "county.html" },
  { id: "identity-citizen", orgCode: "PERSON-R1", roles: ["citizen"], expectedRole: "citizen", expectedHome: "citizen.html" }
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function roleFromClaims(roles, organization) {
  const rawRoles = [roles].flat().filter(Boolean).map((item) => String(item).toLowerCase());
  if (rawRoles.some((item) => /citizen|resident/.test(item))) return "citizen";
  if (rawRoles.some((item) => /insurance/.test(item))) return "insurance";
  if (rawRoles.some((item) => /county|consortium/.test(item))) return "county";
  if (rawRoles.some((item) => /hospital|doctor|institution|medical/.test(item))) return "institution";
  if (rawRoles.some((item) => /commission|admin|health/.test(item))) return "commission";
  const orgType = String(organization?.orgType || "").toLowerCase();
  if (orgType.includes("insurance")) return "insurance";
  if (orgType.includes("medical")) return "institution";
  if (orgType.includes("county")) return "county";
  if (orgType.includes("citizen")) return "citizen";
  return "commission";
}

function homeForRole(role, organization, roles = []) {
  const rawRoles = [roles].flat().filter(Boolean).map((item) => String(item).toLowerCase());
  if (role === "institution" && rawRoles.some((item) => /doctor|physician/.test(item))) return "doctor.html";
  if (organization?.portal) return organization.portal;
  return ROLE_PORTALS[role]?.[0] || "health-city.html";
}

function buildIdentityContract(options = {}) {
  const data = options.data || readJson("data/db.json");
  const users = Array.isArray(data.authUsers) ? data.authUsers : [];
  const organizations = Array.isArray(data.authOrganizations) ? data.authOrganizations : [];
  const orgByCode = new Map(organizations.map((item) => [item.orgCode, item]));
  const p0IdentityRequirements = (Array.isArray(data.interfaceRequirements) ? data.interfaceRequirements : [])
    .filter((item) => item.priority === "P0" && /认证|机构|居民主索引/.test(`${item.domain}${item.need}${item.keepExisting}`));

  const roleCoverage = Object.fromEntries(Object.keys(ROLE_PORTALS).map((role) => {
    const roleUsers = users.filter((item) => item.role === role);
    return [role, {
      users: roleUsers.length,
      homes: [...new Set(roleUsers.map((item) => item.home).filter(Boolean))],
      orgCodes: [...new Set(roleUsers.map((item) => item.orgCode).filter(Boolean))]
    }];
  }));

  const sampleMappings = SAMPLE_CLAIMS.map((sample) => {
    const organization = orgByCode.get(sample.orgCode);
    const role = roleFromClaims(sample.roles, organization);
    const home = homeForRole(role, organization, sample.roles);
    return {
      ...sample,
      mappedRole: role,
      mappedHome: home,
      organizationFound: Boolean(organization),
      passed: role === sample.expectedRole && home === sample.expectedHome && (Boolean(organization) || role === "citizen")
    };
  });

  const checks = [
    { id: "identity:p0Requirements", passed: p0IdentityRequirements.length >= 3, detail: `${p0IdentityRequirements.length} P0 identity/org requirements` },
    { id: "identity:requiredClaims", passed: REQUIRED_CLAIMS.filter((item) => item.required).length >= 5, detail: `${REQUIRED_CLAIMS.length} claims documented` },
    { id: "identity:roleCoverage", passed: Object.values(roleCoverage).every((item) => item.users >= 1), detail: Object.entries(roleCoverage).map(([role, item]) => `${role}:${item.users}`).join(";") },
    { id: "identity:organizationCoverage", passed: users.every((item) => item.role === "citizen" || orgByCode.has(item.orgCode)), detail: `${organizations.length} organizations, ${users.length} users` },
    { id: "identity:portalMapping", passed: users.every((item) => ROLE_PORTALS[item.role]?.includes(item.home)), detail: "role home pages match allowed portals" },
    { id: "identity:sampleMappings", passed: sampleMappings.every((item) => item.passed), detail: sampleMappings.map((item) => `${item.id}:${item.mappedRole}/${item.mappedHome}`).join(";") }
  ];

  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    requiredClaims: REQUIRED_CLAIMS,
    rolePortals: ROLE_PORTALS,
    roleCoverage,
    organizationCount: organizations.length,
    userCount: users.length,
    p0IdentityRequirements,
    sampleMappings,
    checks
  };
}

function renderMarkdown(contract) {
  const checkRows = contract.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${String(item.detail || "").replace(/\|/g, "/")} |`);
  const claimRows = contract.requiredClaims.map((item) => `| ${item.required ? "required" : "optional"} | ${item.claim} | ${item.purpose} |`);
  const roleRows = Object.entries(contract.roleCoverage).map(([role, item]) => `| ${role} | ${item.users} | ${item.homes.join(", ")} | ${item.orgCodes.join(", ")} |`);
  const sampleRows = contract.sampleMappings.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.orgCode} | ${item.roles.join(", ")} | ${item.mappedRole} | ${item.mappedHome} |`);
  return [
    "# Identity integration contract",
    "",
    `- Generated at: ${contract.generatedAt}`,
    `- Result: ${contract.ok ? "PASS" : "FAIL"}`,
    `- Users: ${contract.userCount}`,
    `- Organizations: ${contract.organizationCount}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Required external claims",
    "",
    "| Level | Claim | Purpose |",
    "|---|---|---|",
    ...claimRows,
    "",
    "## Role and portal coverage",
    "",
    "| Role | Users | Homes | Org codes |",
    "|---|---:|---|---|",
    ...roleRows,
    "",
    "## Sample mappings",
    "",
    "| Result | Sample | Org code | Roles | Mapped role | Mapped home |",
    "|---|---|---|---|---|---|",
    ...sampleRows,
    ""
  ].join("\n");
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return flags;
}

function writeOutput(contract, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(contract, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(contract), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const contract = buildIdentityContract();
  if (flags.write !== false) writeOutput(contract, flags);
  console.log(JSON.stringify(contract, null, 2));
  if (!contract.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { buildIdentityContract, parseArgs, renderMarkdown, writeOutput };
