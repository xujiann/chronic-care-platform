const fs = require("node:fs");
const path = require("node:path");
const { buildOhifStudyUrl, createSyntheticDicom, queryDicomWebStudies, queryOrthancStudies, readFhirPatient, solutionAHealth, upsertFhirPatient } = require("../solution-a-connectors");
const ROOT = path.resolve(__dirname, "..");

function syntheticPatient() {
  return {
    resourceType: "Patient", id: "solution-a-smoke-patient", active: true,
    identifier: [{ system: "urn:chronic-care-platform:synthetic", value: "SYNTHETIC-SOLUTION-A-001" }],
    name: [{ use: "official", text: "Solution A Synthetic Patient" }],
    meta: { tag: [{ system: "urn:chronic-care-platform:data-class", code: "synthetic-test-data" }] }
  };
}

async function runSolutionAAcceptance(options = {}) {
  const startedAt = Date.now();
  const health = await solutionAHealth(options);
  if (!health.ok) return { ok: false, generatedAt: new Date().toISOString(), health, checks: [{ id: "services-online", ok: false }] };
  const expected = syntheticPatient();
  const write = await upsertFhirPatient(expected, options);
  const stored = await readFhirPatient(expected.id, options);
  const dicom = await createSyntheticDicom({ ...options, suffix: "202607130243" });
  const studies = await queryOrthancStudies(options);
  const dicomWebStudies = await queryDicomWebStudies(options);
  const viewerUrl = buildOhifStudyUrl(dicom.studyInstanceUID, options.env);
  const checks = [
    { id: "services-online", ok: health.ok, evidence: health.services.map((item) => `${item.name}:${item.status}`) },
    { id: "fhir-patient-write", ok: write.ok && [200, 201].includes(write.status), evidence: `Patient/${expected.id}` },
    { id: "fhir-patient-read", ok: stored.resourceType === "Patient" && stored.id === expected.id, evidence: stored.meta?.versionId || "version-present-after-write" },
    { id: "orthanc-study-query", ok: Array.isArray(studies), evidence: `${studies.length} study records` },
    { id: "synthetic-dicom-ingest", ok: Boolean(dicom.orthancId), evidence: dicom.studyInstanceUID },
    { id: "dicomweb-study-query", ok: dicomWebStudies.length > 0, evidence: `${dicomWebStudies.length} DICOMweb studies` },
    { id: "ohif-viewer-link", ok: viewerUrl.includes(encodeURIComponent(dicom.studyInstanceUID)), evidence: viewerUrl },
    { id: "synthetic-data-boundary", ok: stored.meta?.tag?.some((item) => item.code === "synthetic-test-data"), evidence: "no real patient data used" }
  ];
  return { ok: checks.every((item) => item.ok), generatedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, checks, summary: { fhirPatientId: stored.id, fhirVersion: stored.meta?.versionId || "", orthancStudies: studies.length, dicomWebStudies: dicomWebStudies.length, studyInstanceUID: dicom.studyInstanceUID, viewerUrl } };
}

if (require.main === module) runSolutionAAcceptance().then((report) => {
  fs.mkdirSync(path.join(ROOT, "release"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "release/solution-a-acceptance-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exitCode = 1;
}).catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

module.exports = { runSolutionAAcceptance, syntheticPatient };
