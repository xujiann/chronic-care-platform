#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT, "release", "release-artifact-manifest.json");
const DEFAULT_MARKDOWN = path.join(ROOT, "release", "release-artifact-manifest.md");

const ARTIFACTS = [
  ["release-report", "release", "Release readiness aggregate", "release/release-report.json", "release/release-report.md", "release:report", "/api/release-report"],
  ["launch-smoke", "release", "Launch runtime smoke report", "release/launch-smoke-report.json", "release/launch-smoke-report.md", "launch:smoke", "/api/health"],
  ["release-artifact-manifest", "release", "Release artifact manifest", "release/release-artifact-manifest.json", "release/release-artifact-manifest.md", "release:manifest", "release/release-artifact-manifest.md"],
  ["platform-capability-map", "governance", "Platform capability map across release artifacts scripts readiness reports and data collections", "release/platform-capability-map.json", "release/platform-capability-map.md", "platform:capability-map", "/api/platform/capability-map"],
  ["platform-go-live-slices", "governance", "Unified blocker register service order center and master-data directory go-live slices", "release/platform-go-live-slices.json", "release/platform-go-live-slices.md", "platform:go-live-slices", "/api/platform/go-live-slices"],
  ["platform-standards-ledgers", "governance", "Six auditable ledgers for project documents standards data interfaces security and operations", "release/platform-standards-ledgers.json", "release/platform-standards-ledgers.md", "platform:standards-ledgers", "/api/platform/standards-ledgers"],
  ["health-platform-system-atlas", "governance", "Health information platform top-level system atlas and development rules", "docs/全系统图谱集.md", "docs/全系统图谱集.md", "release:manifest", "docs/全系统图谱集.md"],
  ["platform-production-audit", "governance", "Platform full-process pre-production audit and roadmap", "release/platform-production-audit.json", "docs/数智医院标准平台全程审计与生产前开发规划.md", "platform:production-audit", "release/production-cutover-checklist.md"],
  ["platform-development-report-20260713", "governance", "Digital hospital standards platform development report and next plan", "docs/数智医院标准平台开发报告与下一步计划-2026-07-13.md", "docs/数智医院标准平台开发报告与下一步计划-2026-07-13.md", "release:report", "release/release-report.md"],
  ["platform-rd-report", "governance", "Health information platform R&D report", "docs/卫生健康信息平台研发报告.md", "docs/卫生健康信息平台研发报告.md", "release:report", "docs/卫生健康信息平台研发报告.md"],
  ["production-go-live-requirements", "cutover", "Real production go-live requirements", "docs/production-go-live-requirements.md", "docs/production-go-live-requirements.md", "release:report", "release/production-cutover-checklist.md"],
  ["onsite-launch-requirements", "cutover", "On-site launch requirements", "release/onsite-launch-requirements.json", "release/onsite-launch-requirements.md", "onsite:launch-requirements", "docs/on-site-launch-materials.md"],
  ["production-cutover", "cutover", "Production cutover checklist", "release/production-cutover-checklist.json", "release/production-cutover-checklist.md", "release:report", "/api/system/readiness"],
  ["storage-model", "data", "Storage model inspection", "release/storage-model-inspection.json", "release/storage-model-inspection.md", "release:report", "npm.cmd run storage:inspect"],
  ["object-storage-readiness", "data", "Object storage and attachment security readiness", "release/object-storage-readiness-report.json", "release/object-storage-readiness-report.md", "object-storage:readiness", "/api/attachments/storage"],
  ["financial-gateway-readiness", "integration", "Payment insurance and certificate gateway readiness", "release/financial-gateway-readiness-report.json", "release/financial-gateway-readiness-report.md", "financial-gateway:readiness", "/api/financial-gateways"],
  ["identity-contract", "identity", "Identity integration and lifecycle contract", "release/identity-contract.json", "release/identity-contract.md", "identity:contract", "/api/auth/identity-lifecycle"],
  ["audit-retention", "security", "Audit retention report", "release/audit-retention-report.json", "release/audit-retention-report.md", "audit:retention", "/api/audit/verify"],
  ["chronic-followup", "process", "Chronic follow-up readiness report", "release/chronic-followup-readiness-report.json", "release/chronic-followup-readiness-report.md", "chronic:followup-readiness", "/api/chronic/followup-summary"],
  ["physical-examination", "citizen", "Physical examination standards and innovation highlights readiness", "release/physical-examination-readiness-report.json", "release/physical-examination-readiness-report.md", "physical-examination:readiness", "/api/physical-exams"],
  ["chronic-informatization-sources", "process", "Chronic informatization source inventory and capability traceability", "release/chronic-informatization-sources.json", "release/chronic-informatization-sources.md", "chronic:informatization-sources", "docs/chronic-informatization-source-inventory.md"],
  ["chronic-institution-interfaces", "integration", "Chronic institution interface specification", "release/chronic-institution-interfaces.json", "release/chronic-institution-interfaces.md", "chronic:institution-interfaces", "/api/chronic/institution-interfaces"],
  ["chronic-launch-core", "integration", "Chronic launch core readiness", "release/chronic-launch-core.json", "release/chronic-launch-core.md", "chronic:launch-core", "/api/chronic/launch-core"],
  ["data-quality", "data", "Data quality report", "release/data-quality-report.json", "release/data-quality-report.md", "data-quality:report", "/api/data-quality/scorecard"],
  ["data-governance", "data", "Data governance foundation readiness report", "release/data-governance-readiness-report.json", "release/data-governance-readiness-report.md", "data-governance:readiness", "/api/data-governance"],
  ["digital-hospital-standards", "evaluation", "Digital hospital standards readiness report", "release/digital-hospital-standards-readiness-report.json", "release/digital-hospital-standards-readiness-report.md", "digital-hospital:standards-readiness", "digital-hospital-standards.html"],
  ["digital-hospital-pilot", "evaluation", "Digital hospital pilot readiness report", "release/digital-hospital-pilot-readiness-report.json", "release/digital-hospital-pilot-readiness-report.md", "digital-hospital:pilot-readiness", "digital-hospital-evaluation.html"],
  ["phase2-proposal", "planning", "Phase 2 proposal gap ledger readiness report", "release/phase2-proposal-readiness-report.json", "release/phase2-proposal-readiness-report.md", "phase2:proposal-readiness", "docs/二期可研对标差距与下一步开发计划.md"],
  ["phase2-catalog", "data", "Phase 2 data and service catalog readiness report", "release/phase2-catalog-readiness-report.json", "release/phase2-catalog-readiness-report.md", "phase2:catalog-readiness", "/api/phase2/catalog"],
  ["phase2-joint-test", "integration", "Phase 2 minimum joint-test pilot readiness report", "release/phase2-joint-test-readiness-report.json", "release/phase2-joint-test-readiness-report.md", "phase2:joint-test-readiness", "/api/phase2/joint-test-pilot"],
  ["phase2-mutual-recognition", "integration", "Phase 2 mutual recognition MVP readiness report", "release/phase2-mutual-recognition-readiness-report.json", "release/phase2-mutual-recognition-readiness-report.md", "phase2:mutual-recognition-readiness", "/api/phase2/mutual-recognition"],
  ["phase2-disease-reporting", "integration", "Phase 2 disease reporting MVP readiness report", "release/phase2-disease-reporting-readiness-report.json", "release/phase2-disease-reporting-readiness-report.md", "phase2:disease-reporting-readiness", "/api/phase2/disease-reporting"],
  ["phase2-clinical-assist", "integration", "Phase 2 clinical treatment assist readiness report", "release/phase2-clinical-assist-readiness-report.json", "release/phase2-clinical-assist-readiness-report.md", "phase2:clinical-assist-readiness", "/api/phase2/clinical-assist"],
  ["phase2-family-doctor", "citizen", "Phase 2 family doctor contract readiness report", "release/phase2-family-doctor-readiness-report.json", "release/phase2-family-doctor-readiness-report.md", "phase2:family-doctor-readiness", "/api/phase2/family-doctor-contracts"],
  ["registration-journey", "citizen", "Appointment registration cross-role journey readiness report", "release/registration-journey-readiness-report.json", "release/registration-journey-readiness-report.md", "registration:journey-readiness", "/api/registrations/dashboard"],
  ["registration-integration", "integration", "Appointment callback integration and reconciliation readiness report", "release/registration-integration-readiness-report.json", "release/registration-integration-readiness-report.md", "registration:integration-readiness", "/api/registrations/integration-center"],
  ["citizen-operations", "citizen", "Citizen service operations readiness report", "release/citizen-operations-readiness-report.json", "release/citizen-operations-readiness-report.md", "phase2:citizen-operations-readiness", "/api/citizen-operations/center"],
  ["commercial-crypto", "security", "Commercial crypto adapter center readiness report", "release/commercial-crypto-readiness-report.json", "release/commercial-crypto-readiness-report.md", "security:commercial-crypto-readiness", "/api/commercial-crypto/center"],
  ["production-security", "security", "P0-07 production security remediation and release-opinion readiness", "release/production-security-readiness-report.json", "release/production-security-readiness-report.md", "security:production-readiness", "/api/production-security/center"],
  ["production-go-no-go", "cutover", "P0-10 global production Go/No-Go command readiness", "release/production-go-no-go-readiness-report.json", "release/production-go-no-go-readiness-report.md", "production:go-no-go-readiness", "/api/production-go-no-go/center"],
  ["production-release-evidence", "cutover", "T11 controlled production security evidence readiness", "release/production-release-evidence-readiness.json", "release/production-release-evidence-readiness.md", "production-release:evidence:readiness", "/api/production-release/evidence-readiness"],
  ["pilot-acceptance-readiness", "cutover", "Eight-application pilot acceptance regression, alerting preflight, onsite task pack, joint-test samples and trial-run ledger", "release/pilot-acceptance-readiness-report.json", "release/pilot-acceptance-readiness-report.md", "pilot:acceptance-readiness", "/api/pilot-acceptance/center"],
  ["quality-safety", "quality", "Medical quality and safety supervision report", "release/quality-safety-report.json", "release/quality-safety-report.md", "quality-safety:report", "/api/quality-safety/dashboard"],
  ["quality-operations-governance", "quality", "Unified quality operations and drug-consumable governance readiness", "release/quality-operations-governance-readiness-report.json", "release/quality-operations-governance-readiness-report.md", "quality-operations:governance-readiness", "/api/quality-operations-governance/catalog"],
  ["drug-consumable-readiness", "quality", "Drug consumable supervision readiness report", "release/drug-consumable-readiness-report.json", "release/drug-consumable-readiness-report.md", "drug-consumable:readiness", "/api/drug-consumable-supervision"],
  ["quality-safety-interface-standard", "quality", "Quality-safety institution interface standard", "release/quality-safety-interface-standard.json", "release/quality-safety-interface-standard.md", "quality-safety:interface-standard", "/api/quality-safety/interface-standard"],
  ["quality-safety-joint-test", "quality", "Quality-safety institution joint-test pack", "release/quality-safety-interface-joint-test-pack.json", "release/quality-safety-interface-joint-test-pack.md", "quality-safety:joint-test", "/api/quality-safety/interface-joint-test-pack"],
  ["environment-matrix", "environment", "Environment matrix report", "release/environment-matrix-report.json", "release/environment-matrix-report.md", "environment:matrix", "env:check:production"],
  ["hybrid-deployment", "deployment", "Hybrid static preview and dynamic backend readiness", "release/hybrid-deployment-readiness-report.json", "release/hybrid-deployment-readiness-report.md", "hybrid:deployment-readiness", "server.js + GitHub Pages"],
  ["production-deployment-package", "deployment", "Immutable production deployment package and verification", "release/production-deployment-package.json", "release/production-deployment-package.md", "deployment:package", "npm run deployment:verify"],
  ["integration-readiness", "integration", "Integration readiness report", "release/integration-readiness-report.json", "release/integration-readiness-report.md", "integration:readiness", "/api/integration/contracts"],
  ["integration-control-ledger", "integration", "T00 baseline branch worktree conflict and serial intake control ledger", "release/integration-control-ledger.json", "release/integration-control-ledger.md", "integration:control", "npm run integration:control:gate"],
  ["regional-data-sharing-readiness", "integration", "Regional diagnosis data sharing readiness report", "release/regional-data-sharing-report.json", "release/regional-data-sharing-report.md", "regional-data-sharing:report", "/api/regional-data-sharing"],
  ["interface-mapping", "integration", "Interface mapping report", "release/interface-mapping-report.json", "release/interface-mapping-report.md", "interface:mapping", "/api/integrations/gateway"],
  ["regional-referral-overlap", "integration", "Regional data sharing and referral overlap boundary report", "release/regional-referral-overlap-report.json", "release/regional-referral-overlap-report.md", "regional-referral:overlap", "/api/regional-data-sharing"],
  ["hospital-operations-readiness", "operations", "Hospital operations readiness report", "release/hospital-operations-readiness-report.json", "release/hospital-operations-readiness-report.md", "hospital-operations:readiness", "/api/operations/dashboard"],
  ["hospital-operations-release", "operations", "Hospital operations release report", "release/hospital-operations-release-report.json", "release/hospital-operations-release-report.md", "hospital-operations:release", "/api/operations/interface-mapping /api/operations/integration/snapshots /api/operations/integration/dispatch-feedback /api/operations/integration/reconciliation /api/operations/handover /api/operations/handover/owners /api/operations/handover/signoff /api/operations/cutover-command /api/operations/post-cutover-observation"],
  ["hospital-operations-module-report", "operations", "Hospital operations module function report", "release/hospital-operations-module-report.json", "release/hospital-operations-module-report.md", "hospital-operations:module-report", "release/hospital-operations-module-report.md"],
  ["hospital-operations-brief-pdf", "operations", "Hospital operations brief PDF report", "release/hospital-operations-brief-pdf-report.json", "release/hospital-operations-brief-pdf-report.md", "hospital-operations:brief-pdf", "output/pdf/hospital-operations-module-brief-report.pdf"],
  ["hospital-operations-flow", "operations", "Hospital operations end-to-end flow diagram", "docs/hospital-operations-flow.md", "docs/hospital-operations-flow.md", "hospital-operations:module-report", "docs/hospital-operations-flow.md"],
  ["hospital-operations-development-report", "operations", "Hospital operations development report", "docs/hospital-operations-development-report.md", "docs/hospital-operations-development-report.md", "hospital-operations:module-report", "docs/hospital-operations-development-report.md"],
  ["hospital-operations-integration-requirements", "operations", "Hospital operations integration requirements", "docs/hospital-operations-integration-requirements.md", "docs/hospital-operations-integration-requirements.md", "hospital-operations:module-report", "docs/hospital-operations-integration-requirements.md"],
  ["research-sandbox", "research", "Research sandbox readiness report", "release/research-sandbox-readiness-report.json", "release/research-sandbox-readiness-report.md", "research:sandbox", "/api/research/sandbox"],
  ["monitoring-readiness", "operations", "Monitoring readiness report", "release/monitoring-readiness-report.json", "release/monitoring-readiness-report.md", "monitoring:readiness", "/api/metrics"],
  ["referral-teleconsultation", "referral", "Referral teleconsultation readiness report", "release/referral-teleconsultation-readiness-report.json", "release/referral-teleconsultation-readiness-report.md", "referral:readiness", "/api/referral-teleconsultations"],
  ["escort-service", "elder-care", "Medical escort service readiness report", "release/escort-service-readiness-report.json", "release/escort-service-readiness-report.md", "escort:readiness", "/api/escort-services/dashboard"],
  ["internet-nursing", "nursing", "Internet nursing readiness report", "release/internet-nursing-readiness-report.json", "release/internet-nursing-readiness-report.md", "internet-nursing:readiness", "/api/internet-nursing/dashboard"],
  ["internet-nursing-highlight-center", "nursing", "Internet+ Nursing ten-highlight function center", "docs/internet-nursing-highlight-center.md", "docs/internet-nursing-highlight-center.md", "internet-nursing:readiness", "internet-nursing.html#nursing-highlight-section"],
  ["emergency-readiness", "emergency", "Prehospital emergency collaboration readiness report", "release/emergency-readiness-report.json", "release/emergency-readiness-report.md", "emergency:readiness", "/api/emergency/production-center"],
  ["t10-specialty-cutover", "cutover", "T10 emergency blood imaging and physical-exam specialty cutover control pack", "release/t10-specialty-cutover-pack.json", "release/t10-specialty-cutover-pack.md", "t10:specialty-cutover", "/api/t10-specialty/cutover-pack"],
  ["t10-clinical-blood-independent-gate", "cutover", "T10 clinical blood standalone production gate", "docs/clinical-blood-production-readiness.md", "docs/clinical-blood-production-readiness.md", "t10:clinical-blood:readiness", "/api/t10-specialty/modules/clinical-blood/readiness"],
  ["t10-emergency-independent-gate", "cutover", "T10 emergency life-chain independent module gate", "docs/emergency-independent-module-acceptance.md", "docs/emergency-independent-module-acceptance.md", "t10:emergency-module:smoke", "/api/t10-specialty/modules/emergency-life-chain/readiness"],
  ["t10-imaging-production-gate", "cutover", "T10 imaging site receipt and platform launch gate", "docs/医学影像云功能说明.md", "docs/医学影像云功能说明.md", "imaging-cloud:readiness", "/api/imaging-cloud/production-center"],
  ["t10-physical-examination-independent-gate", "cutover", "T10 physical examination standalone production gate", "release/physical-examination-standalone-readiness-report.json", "release/physical-examination-standalone-readiness-report.md", "t10:physical-examination:readiness", "physical-examination-standalone.html"],
  ["emergency-evidence-package-api", "emergency", "Prehospital emergency per-event evidence package API", "docs/院前急救事件证据包接口说明.md", "docs/院前急救事件证据包接口说明.md", "emergency:readiness", "/api/emergency/events/:id/evidence-package"],
  ["emergency-evidence-export-api", "emergency", "Prehospital emergency SHA-256 evidence export API", "docs/emergency-evidence-export.md", "docs/emergency-evidence-export.md", "emergency:readiness", "/api/emergency/events/:id/evidence-package/export?format=json"],
  ["emergency-sos-aed-api", "emergency", "Confirmed SOS and nearest AED guidance APIs", "docs/emergency-sos-aed.md", "docs/emergency-sos-aed.md", "emergency:readiness", "/api/emergency/sos /api/emergency/aed-map"],
  ["emergency-life-chain", "emergency", "Golden four-minute emergency life chain", "docs/emergency-life-chain.md", "docs/emergency-life-chain.md", "emergency:readiness", "/api/emergency/life-chain/device-sos /api/emergency/life-chain/command-center /api/emergency/life-chain/quality"],
  ["emergency-life-chain-release-review", "emergency", "Emergency life-chain safety review and release decision", "docs/emergency-life-chain-release-review.md", "docs/emergency-life-chain-release-review.md", "emergency:readiness", "/api/emergency/life-chain/authorizations/:id/revoke /api/emergency/events/:id/automatic-sos-cancellation-request /api/emergency/events/:id/automatic-sos-cancellation-resolve"],
  ["citizen-launch-foundation", "citizen", "Citizen launch foundation readiness report", "release/citizen-launch-foundation-readiness.json", "release/citizen-launch-foundation-readiness.md", "citizen:launch-foundation", "citizen.html?client=app&page=health-record&launch=1#citizen-pipeline-panel"],
  ["citizen-records-readiness", "citizen", "Citizen health record readiness report", "release/citizen-records-readiness-report.json", "release/citizen-records-readiness-report.md", "citizen-records:readiness", "citizen.html?page=health-record#citizen-care-workspace"],
  ["registration-referral-acceptance", "institution", "Registration and referral acceptance report", "release/registration-referral-acceptance-report.json", "release/registration-referral-acceptance-report.md", "registration-referral:acceptance", "/api/registration-referral/operations"],
  ["multi-practice", "doctor-governance", "Doctor multi-practice readiness report", "release/multi-practice-readiness-report.json", "release/multi-practice-readiness-report.md", "multi-practice:readiness", "/api/multi-practice-registry"],
  ["operations-readiness", "operations", "Operations readiness and disaster-recovery run-center report", "release/operations-readiness-report.json", "release/operations-readiness-report.md", "operations:readiness", "/api/production-operations/center"],
  ["process-audit", "process", "Full process audit report", "release/process-audit-report.json", "release/process-audit-report.md", "process:audit", "/api/process-audit"],
  ["service-acceptance", "process", "Service acceptance summary", "release/service-acceptance-summary.json", "release/service-acceptance-summary.md", "release:report", "/api/service-acceptance-summary"],
  ["health-dashboard", "dashboard", "Health dashboard and eight-application template summary", "release/health-dashboard-summary.json", "release/health-dashboard-summary.md", "health-dashboard:summary", "/api/health-dashboard/summary"],
  ["health-dashboard-indicator-center", "dashboard", "Phase-2 industry governance indicator center report", "docs/health-dashboard-indicator-center-report.md", "docs/health-dashboard-indicator-center-report.md", "health-dashboard:summary", "/api/health-dashboard/industry-governance-indicators"],
  ["priority-application-templates", "dashboard", "Priority application template handoff", "release/priority-application-templates.json", "release/priority-application-templates.md", "priority-apps:templates", "/api/priority-applications/templates"],
  ["maternal-child-readiness", "maternal-child", "Maternal-child main function and readiness report", "release/maternal-child-readiness-report.json", "release/maternal-child-readiness-report.md", "maternal-child:readiness", "maternal-child-about.html"],
  ["public-health-readiness", "public-health", "Public health informatization standard readiness report", "release/public-health-readiness-report.json", "release/public-health-readiness-report.md", "public-health:readiness", "/api/public-health/system"],
  ["public-health-highlights-readiness", "public-health", "Public health five-suite readiness report", "release/public-health-highlights-readiness-report.json", "release/public-health-highlights-readiness-report.md", "public-health:highlights:readiness", "/api/public-health/highlights"],
  ["public-health-coordination-readiness", "public-health", "Eight-lane public health coordination runtime readiness", "release/public-health-coordination-readiness-report.json", "release/public-health-coordination-readiness-report.md", "public-health:coordination-readiness", "/api/public-health/coordination-runtime"],
  ["public-health-event-reporting-readiness", "public-health", "Infectious event reporting closure readiness", "release/public-health-event-reporting-readiness-report.json", "release/public-health-event-reporting-readiness-report.md", "public-health:event-reporting-readiness", "/api/public-health/coordination-runtime"],
  ["public-health-priority-standard-review-readiness", "public-health", "Priority public health standard review readiness", "release/public-health-priority-standard-review-readiness-report.json", "release/public-health-priority-standard-review-readiness-report.md", "public-health:priority-standard-review-readiness", "/api/public-health/coordination-runtime"],
  ["public-health-modernization-readiness", "public-health", "Public health data, surveillance and medical-prevention modernization readiness", "release/public-health-modernization-readiness-report.json", "release/public-health-modernization-readiness-report.md", "public-health:modernization-readiness", "/api/public-health/surveillance-center"],
  ["public-health-final-readiness", "public-health", "T08 external outbox, signed callback, rotation and operations readiness", "release/public-health-final-readiness-report.json", "release/public-health-final-readiness-report.md", "public-health:final-readiness", "/api/public-health/external/operations-board"],
  ["blood-system-readiness", "blood-system", "Blood information system readiness report", "release/blood-system-readiness-report.json", "release/blood-system-readiness-report.md", "blood-system:readiness", "/api/blood-system"],
  ["disease-payment-readiness", "insurance", "Disease payment DRG/DIP readiness report", "release/disease-payment-readiness-report.json", "release/disease-payment-readiness-report.md", "disease-payment:readiness", "/api/disease-payment"],
  ["insurance-payment-acceptance", "insurance", "T07 insurance payment unified acceptance", "release/insurance-payment-acceptance-report.json", "release/insurance-payment-acceptance-report.md", "insurance-payment:acceptance", "/api/disease-payment/formal-grouping/operations"],
  ["insurance-payment-evidence", "insurance", "T07 digest-bound acceptance evidence packet", "release/insurance-payment-evidence-packet.json", "release/insurance-payment-evidence-packet.md", "insurance-payment:evidence", "/api/financial-gateways/operations"],
  ["immunization-readiness", "maternal-child", "National immunization program readiness report", "release/immunization-readiness-report.json", "release/immunization-readiness-report.md", "immunization:readiness", "immunization.html"],
  ["policy-coverage", "policy", "Policy coverage report", "release/policy-coverage-report.json", "release/policy-coverage-report.md", "policy:coverage", "release/policy-coverage-report.md"],
  ["site-readiness", "site", "Site readiness pack", "release/site-readiness-pack.json", "release/site-readiness-pack.md", "site:pack", "/api/site-readiness-pack"],
  ["site-launch-evidence", "site", "Runtime site launch evidence ledger", "release/site-readiness-pack.json", "release/site-readiness-pack.md", "site:pack", "/api/site-launch-evidence"],
  ["production-db", "data", "Production database readiness and cutover rehearsal report", "release/production-db-readiness-report.json", "release/production-db-readiness-report.md", "production-db:readiness", "/api/production-database/cutover-center"],
  ["postgres-migration-package", "data", "PostgreSQL migration schema count and integrity package", "release/postgres-migration-package/manifest.json", "release/postgres-migration-package/README.md", "postgres:migration-package", "npm run postgres:migration-verify"],
  ["postgres-mpi-foundation", "data", "PostgreSQL MPI foundation schema, matching rules and migration package", "release/postgres-mpi-foundation/manifest.json", "release/postgres-mpi-foundation/README.md", "postgres:mpi-foundation", "npm run postgres:mpi-verify"],
  ["postgres-primary-read", "data", "PostgreSQL verified primary-read rehearsal", "release/postgres-primary-read-rehearsal.json", "release/postgres-primary-read-rehearsal.md", "postgres:primary-read-rehearsal", "/api/production-database/primary-read-rehearsal"],
  ["postgres-production-adapter", "data", "PostgreSQL evidence-gated production adapter", "release/production-db-readiness-report.json", "docs/postgresql-runtime-sync.md", "postgres:adapter-status", "/api/production-database/adapter"],
  ["evaluation-evidence", "evaluation", "Interoperability evaluation evidence report", "release/evaluation-evidence-report.json", "release/evaluation-evidence-report.md", "evaluation:evidence", "release/evaluation-evidence-report.md"]
];

const TEMPLATE_READMES = [
  ["identity-source-mapping", "Identity source mapping template", "release/templates/identity-source-mapping/README.md", "site:pack", "/api/site-template-readmes"],
  ["interface-joint-test", "Interface joint-test template", "release/templates/interface-joint-test/README.md", "site:pack", "/api/site-template-readmes"],
  ["monitoring-on-call", "Monitoring and on-call template", "release/templates/monitoring-on-call/README.md", "site:pack", "/api/site-template-readmes"],
  ["production-signoff", "Production cutover signoff template", "release/templates/production-signoff/README.md", "site:pack", "/api/site-template-readmes"]
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function parseArgs(argv = process.argv.slice(2)) {
  const flags = {};
  argv.forEach((flag) => {
    if (!flag.startsWith("--")) return;
    const [key, ...rest] = flag.slice(2).split("=");
    flags[key] = rest.length ? rest.join("=") : true;
  });
  return {
    output: flags.output || DEFAULT_OUTPUT,
    markdown: flags.markdown || DEFAULT_MARKDOWN
  };
}

function buildReleaseArtifactManifest(options = {}) {
  const pkg = options.pkg || readJson("package.json");
  const releaseReportPath = path.join(ROOT, "release", "release-report.json");
  const releaseReport = options.releaseReport || (fs.existsSync(releaseReportPath) ? JSON.parse(fs.readFileSync(releaseReportPath, "utf8")) : null);
  const artifacts = ARTIFACTS.map(([id, category, title, json, markdown, command, evidence]) => ({
    id,
    category,
    title,
    json,
    markdown,
    command,
    commandAvailable: Boolean(pkg.scripts?.[command]),
    evidence,
    status: releaseReport?.checks?.some((item) => item.name === command || item.name?.startsWith(`${id}:`) || item.name?.startsWith(`${command}:`))
      ? "checked-in-release-report"
      : "declared"
  }));
  const templateReadmes = TEMPLATE_READMES.map(([id, title, file, command, evidence]) => ({
    id,
    category: "template-readme",
    title,
    file,
    command,
    commandAvailable: Boolean(pkg.scripts?.[command]),
    evidence,
    status: "generated-by-site-pack"
  }));
  const checks = [
    { id: "manifest:releaseReport", passed: artifacts.some((item) => item.id === "release-report" && item.commandAvailable), detail: "release:report script and aggregate artifact declared" },
    { id: "manifest:siteTemplates", passed: templateReadmes.length === 4 && templateReadmes.every((item) => item.commandAvailable), detail: `${templateReadmes.length} template readmes` },
    { id: "manifest:artifactCommands", passed: artifacts.every((item) => item.commandAvailable), detail: `${artifacts.filter((item) => item.commandAvailable).length}/${artifacts.length} artifact commands available` },
    { id: "manifest:apiEvidence", passed: artifacts.concat(templateReadmes).every((item) => item.evidence), detail: "every artifact has API or command evidence" }
  ];
  return {
    ok: checks.every((item) => item.passed),
    generatedAt: new Date().toISOString(),
    project: pkg.name,
    version: pkg.version,
    summary: {
      artifacts: artifacts.length,
      templateReadmes: templateReadmes.length,
      categories: new Set(artifacts.map((item) => item.category)).size,
      releaseChecks: releaseReport?.summary?.total || 0
    },
    artifacts,
    templateReadmes,
    checks
  };
}

function renderMarkdown(report) {
  const artifactRows = report.artifacts.map((item) => `| ${item.category} | ${item.title} | ${item.command} | ${item.markdown} | ${item.evidence} |`);
  const templateRows = report.templateReadmes.map((item) => `| ${item.title} | ${item.command} | ${item.file} | ${item.evidence} |`);
  const checkRows = report.checks.map((item) => `| ${item.passed ? "PASS" : "FAIL"} | ${item.id} | ${item.detail} |`);
  return [
    "# Release artifact manifest",
    "",
    `- Generated at: ${report.generatedAt}`,
    `- Result: ${report.ok ? "PASS" : "FAIL"}`,
    `- Artifacts: ${report.summary.artifacts}`,
    `- Template READMEs: ${report.summary.templateReadmes}`,
    `- Release checks: ${report.summary.releaseChecks}`,
    "",
    "## Checks",
    "",
    "| Result | Check | Detail |",
    "|---|---|---|",
    ...checkRows,
    "",
    "## Release artifacts",
    "",
    "| Category | Artifact | Command | Markdown | Evidence |",
    "|---|---|---|---|---|",
    ...artifactRows,
    "",
    "## Template READMEs",
    "",
    "| Template | Command | File | Evidence |",
    "|---|---|---|---|",
    ...templateRows,
    ""
  ].join("\n");
}

function writeOutput(report, flags = {}) {
  const output = path.resolve(ROOT, String(flags.output || DEFAULT_OUTPUT));
  const markdown = path.resolve(ROOT, String(flags.markdown || DEFAULT_MARKDOWN));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2), "utf8");
  fs.mkdirSync(path.dirname(markdown), { recursive: true });
  fs.writeFileSync(markdown, renderMarkdown(report), "utf8");
}

function runCli() {
  const flags = parseArgs();
  const report = buildReleaseArtifactManifest();
  writeOutput(report, flags);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}

if (require.main === module) {
  try {
    runCli();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  buildReleaseArtifactManifest,
  parseArgs,
  renderMarkdown,
  writeOutput
};
