const assert = require("node:assert/strict");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
let sqliteAvailable = true;
try {
  require("node:sqlite");
} catch {
  sqliteAvailable = false;
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

function authorized(token, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`
    }
  };
}

test("SQLite stale state writes return an API conflict contract", { skip: !sqliteAvailable }, async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-conflict-api-"));
  fs.copyFileSync(path.join(ROOT, "data", "db.json"), path.join(dataDir, "db.json"));
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "sqlite";

  const { server, startServer, stopServer } = require(path.join(ROOT, "server.js"));
  startServer(0);
  await once(server, "listening");
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const login = await api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "health", password: "123456" })
  });
  assert.equal(login.response.status, 200);
  const token = login.body.token;

  const firstRead = await api(baseUrl, "/api/state", authorized(token));
  const staleRead = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(firstRead.response.status, 200);
  assert.equal(staleRead.response.status, 200);
  assert.equal(typeof firstRead.body.storageMeta.collectionVersions.residents, "number");

  firstRead.body.residents[0].address = "first-api-writer";
  const firstWrite = await api(baseUrl, "/api/state", authorized(token, {
    method: "PUT",
    body: JSON.stringify(firstRead.body)
  }));
  assert.equal(firstWrite.response.status, 200);

  staleRead.body.residents[0].address = "stale-api-writer";
  const staleWrite = await api(baseUrl, "/api/state", authorized(token, {
    method: "PUT",
    body: JSON.stringify(staleRead.body)
  }));
  assert.equal(staleWrite.response.status, 409);
  assert.equal(staleWrite.body.error, "Conflict");
  assert.equal(staleWrite.body.code, "STORAGE_CONFLICT");
  assert.equal(staleWrite.body.collection, "residents");
  assert.equal(staleWrite.body.expectedVersion < staleWrite.body.currentVersion, true);

  const finalRead = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(finalRead.body.residents[0].address, "first-api-writer");

  const collectionRead = await api(baseUrl, "/api/state", authorized(token));
  const residentsVersion = collectionRead.body.storageMeta.collectionVersions.residents;
  const personalRecordsVersion = collectionRead.body.storageMeta.collectionVersions.personalRecords;
  collectionRead.body.personalRecords[0].result = "collection-level-save";
  const collectionWrite = await api(baseUrl, "/api/state-collections/personalRecords", authorized(token, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: personalRecordsVersion,
      value: collectionRead.body.personalRecords
    })
  }));
  assert.equal(collectionWrite.response.status, 200);
  assert.equal(collectionWrite.body.collection, "personalRecords");
  assert.equal(collectionWrite.body.version, personalRecordsVersion + 1);

  const afterCollectionWrite = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(afterCollectionWrite.body.storageMeta.collectionVersions.residents, residentsVersion);
  assert.equal(afterCollectionWrite.body.personalRecords[0].result, "collection-level-save");

  const staleCollectionWrite = await api(baseUrl, "/api/state-collections/personalRecords", authorized(token, {
    method: "PUT",
    body: JSON.stringify({
      expectedVersion: personalRecordsVersion,
      value: afterCollectionWrite.body.personalRecords
    })
  }));
  assert.equal(staleCollectionWrite.response.status, 409);
  assert.equal(staleCollectionWrite.body.code, "STORAGE_CONFLICT");
  assert.equal(staleCollectionWrite.body.collection, "personalRecords");

  const personalPatchRead = await api(baseUrl, "/api/state", authorized(token));
  const personalVersion = personalPatchRead.body.storageMeta.collectionVersions.personalRecords;
  const personalRecordId = personalPatchRead.body.personalRecords[0].id;
  const personalPatch = await api(baseUrl, `/api/personal-records/${personalRecordId}`, authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: personalVersion,
      result: "personal-record-versioned-patch"
    })
  }));
  assert.equal(personalPatch.response.status, 200);
  assert.equal(personalPatch.body.result, "personal-record-versioned-patch");
  assert.equal(personalPatch.body.expectedVersion, undefined);

  const stalePersonalPatch = await api(baseUrl, `/api/personal-records/${personalRecordId}`, authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: personalVersion,
      result: "stale-personal-record-patch"
    })
  }));
  assert.equal(stalePersonalPatch.response.status, 409);
  assert.equal(stalePersonalPatch.body.collection, "personalRecords");

  const residentPatchRead = await api(baseUrl, "/api/state", authorized(token));
  const residentPatchVersion = residentPatchRead.body.storageMeta.collectionVersions.residents;
  const residentPatch = await api(baseUrl, "/api/residents/r1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: residentPatchVersion,
      address: "resident-patch-address",
      idCard: "tampered-id-card",
      phone: "tampered-phone"
    })
  }));
  assert.equal(residentPatch.response.status, 200);
  assert.equal(residentPatch.body.address, "resident-patch-address");
  assert.notEqual(residentPatch.body.idCard, "tampered-id-card");
  assert.notEqual(residentPatch.body.phone, "tampered-phone");

  const afterResidentPatch = await api(baseUrl, "/api/state", authorized(token));
  assert.equal(afterResidentPatch.body.storageMeta.collectionVersions.residents, residentPatchVersion + 1);
  const staleResidentPatch = await api(baseUrl, "/api/residents/r1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: residentPatchVersion,
      address: "stale-resident-patch-address"
    })
  }));
  assert.equal(staleResidentPatch.response.status, 409);
  assert.equal(staleResidentPatch.body.collection, "residents");

  const workflowRead = await api(baseUrl, "/api/state", authorized(token));
  const careOrdersVersion = workflowRead.body.storageMeta.collectionVersions.careOrders;
  const workflowWrite = await api(baseUrl, "/api/workflow-actions", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      collection: "careOrders",
      id: "co1",
      expectedVersion: careOrdersVersion,
      status: "workflow-versioned-update",
      updates: { institutionReview: "versioned" }
    })
  }));
  assert.equal(workflowWrite.response.status, 200);
  assert.equal(workflowWrite.body.status, "workflow-versioned-update");

  const staleWorkflowWrite = await api(baseUrl, "/api/workflow-actions", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      collection: "careOrders",
      id: "co1",
      expectedVersion: careOrdersVersion,
      status: "stale-workflow-update"
    })
  }));
  assert.equal(staleWorkflowWrite.response.status, 409);
  assert.equal(staleWorkflowWrite.body.code, "STORAGE_CONFLICT");
  assert.equal(staleWorkflowWrite.body.collection, "careOrders");

  const certificateRead = await api(baseUrl, "/api/state", authorized(token));
  const deathVersion = certificateRead.body.storageMeta.collectionVersions.deathCertificates;
  const deathWrite = await api(baseUrl, "/api/death-certificates", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: deathVersion,
      residentId: "r1",
      certificateNo: "DC-VERSIONED-001",
      immediateCause: "versioned-cause",
      underlyingCause: "versioned-underlying-cause"
    })
  }));
  assert.equal(deathWrite.response.status, 201);
  assert.equal(deathWrite.body.certificateNo, "DC-VERSIONED-001");

  const staleDeathWrite = await api(baseUrl, "/api/death-certificates", authorized(token, {
    method: "POST",
    body: JSON.stringify({
      expectedVersion: deathVersion,
      residentId: "r1",
      certificateNo: "DC-VERSIONED-002",
      immediateCause: "stale-cause",
      underlyingCause: "stale-underlying-cause"
    })
  }));
  assert.equal(staleDeathWrite.response.status, 409);
  assert.equal(staleDeathWrite.body.collection, "deathCertificates");

  const insuranceRead = await api(baseUrl, "/api/state", authorized(token));
  const insuranceVersion = insuranceRead.body.storageMeta.collectionVersions.insuranceClaims;
  const insurancePatch = await api(baseUrl, "/api/insurance-claims/ic1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({
      expectedVersion: insuranceVersion,
      status: "claim-versioned-accepted",
      residentId: "r3"
    })
  }));
  assert.equal(insurancePatch.response.status, 200);
  assert.equal(insurancePatch.body.status, "claim-versioned-accepted");
  assert.notEqual(insurancePatch.body.residentId, "r3");

  const staleInsurancePatch = await api(baseUrl, "/api/insurance-claims/ic1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: insuranceVersion, status: "stale-claim-update" })
  }));
  assert.equal(staleInsurancePatch.response.status, 409);
  assert.equal(staleInsurancePatch.body.collection, "insuranceClaims");

  const medicationRead = await api(baseUrl, "/api/state", authorized(token));
  const medicationVersion = medicationRead.body.storageMeta.collectionVersions.medicationPickups;
  const medicationPatch = await api(baseUrl, "/api/medication-pickups/mp1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: medicationVersion, pharmacyStatus: "versioned-ready" })
  }));
  assert.equal(medicationPatch.response.status, 200);
  assert.equal(medicationPatch.body.pharmacyStatus, "versioned-ready");
  const staleMedicationPatch = await api(baseUrl, "/api/medication-pickups/mp1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: medicationVersion, pharmacyStatus: "stale-ready" })
  }));
  assert.equal(staleMedicationPatch.response.status, 409);
  assert.equal(staleMedicationPatch.body.collection, "medicationPickups");

  const chronicRead = await api(baseUrl, "/api/state", authorized(token));
  const chronicVersion = chronicRead.body.storageMeta.collectionVersions.chronicManagementPlans;
  const chronicPatch = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: chronicVersion, status: "versioned-followup", intervention: "versioned intervention" })
  }));
  assert.equal(chronicPatch.response.status, 200);
  assert.equal(chronicPatch.body.status, "versioned-followup");
  const staleChronicPatch = await api(baseUrl, "/api/chronic-management-plans/cmp-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: chronicVersion, status: "stale-followup" })
  }));
  assert.equal(staleChronicPatch.response.status, 409);
  assert.equal(staleChronicPatch.body.collection, "chronicManagementPlans");

  const careOrderRead = await api(baseUrl, "/api/state", authorized(token));
  const careOrderVersion = careOrderRead.body.storageMeta.collectionVersions.careOrders;
  const careOrderPatch = await api(baseUrl, "/api/care-orders/co1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: careOrderVersion, status: "versioned-triaged", priority: "加急", residentId: "r3" })
  }));
  assert.equal(careOrderPatch.response.status, 200);
  assert.equal(careOrderPatch.body.status, "versioned-triaged");
  assert.equal(careOrderPatch.body.priority, "加急");
  assert.notEqual(careOrderPatch.body.residentId, "r3");
  const staleCareOrderPatch = await api(baseUrl, "/api/care-orders/co1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: careOrderVersion, status: "stale-triaged" })
  }));
  assert.equal(staleCareOrderPatch.response.status, 409);
  assert.equal(staleCareOrderPatch.body.collection, "careOrders");

  const followupRead = await api(baseUrl, "/api/state", authorized(token));
  const followupVersion = followupRead.body.storageMeta.collectionVersions.followups;
  const followupPatch = await api(baseUrl, "/api/followups/f1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: followupVersion, status: "versioned-completed", result: "血压已复测" })
  }));
  assert.equal(followupPatch.response.status, 200);
  assert.equal(followupPatch.body.status, "versioned-completed");
  assert.equal(followupPatch.body.result, "血压已复测");
  const staleFollowupPatch = await api(baseUrl, "/api/followups/f1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: followupVersion, status: "stale-completed" })
  }));
  assert.equal(staleFollowupPatch.response.status, 409);
  assert.equal(staleFollowupPatch.body.collection, "followups");

  const screeningRead = await api(baseUrl, "/api/state", authorized(token));
  const screeningVersion = screeningRead.body.storageMeta.collectionVersions.chronicScreeningTasks;
  const screeningPatch = await api(baseUrl, "/api/chronic-screening-tasks/cst-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: screeningVersion, status: "versioned-screened", riskLevel: "高风险" })
  }));
  assert.equal(screeningPatch.response.status, 200);
  assert.equal(screeningPatch.body.status, "versioned-screened");
  assert.equal(screeningPatch.body.riskLevel, "高风险");
  const staleScreeningPatch = await api(baseUrl, "/api/chronic-screening-tasks/cst-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: screeningVersion, status: "stale-screened" })
  }));
  assert.equal(staleScreeningPatch.response.status, 409);
  assert.equal(staleScreeningPatch.body.collection, "chronicScreeningTasks");

  const educationRead = await api(baseUrl, "/api/state", authorized(token));
  const educationVersion = educationRead.body.storageMeta.collectionVersions.chronicEducationPushes;
  const educationPatch = await api(baseUrl, "/api/chronic-education-pushes/cep-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: educationVersion, status: "versioned-pushed", channel: "家庭医生App" })
  }));
  assert.equal(educationPatch.response.status, 200);
  assert.equal(educationPatch.body.status, "versioned-pushed");
  assert.equal(educationPatch.body.channel, "家庭医生App");
  const staleEducationPatch = await api(baseUrl, "/api/chronic-education-pushes/cep-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: educationVersion, status: "stale-pushed" })
  }));
  assert.equal(staleEducationPatch.response.status, 409);
  assert.equal(staleEducationPatch.body.collection, "chronicEducationPushes");

  const credentialRead = await api(baseUrl, "/api/state", authorized(token));
  const credentialVersion = credentialRead.body.storageMeta.collectionVersions.digitalCredentials;
  const credentialPatch = await api(baseUrl, "/api/digital-credentials/dc1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: credentialVersion, status: "versioned-verified", credentialNo: "tampered-credential" })
  }));
  assert.equal(credentialPatch.response.status, 200);
  assert.equal(credentialPatch.body.status, "versioned-verified");
  assert.notEqual(credentialPatch.body.credentialNo, "tampered-credential");
  const staleCredentialPatch = await api(baseUrl, "/api/digital-credentials/dc1", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: credentialVersion, status: "stale-verified" })
  }));
  assert.equal(staleCredentialPatch.response.status, 409);
  assert.equal(staleCredentialPatch.body.collection, "digitalCredentials");

  const countyRead = await api(baseUrl, "/api/state", authorized(token));
  const collaborationVersion = countyRead.body.storageMeta.collectionVersions.countyCollaborationOrders;
  const collaborationPatch = await api(baseUrl, "/api/county-collaboration-orders/cco-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: collaborationVersion, status: "versioned-county-diagnosis", residentId: "r3" })
  }));
  assert.equal(collaborationPatch.response.status, 200);
  assert.equal(collaborationPatch.body.status, "versioned-county-diagnosis");
  assert.notEqual(collaborationPatch.body.residentId, "r3");
  const staleCollaborationPatch = await api(baseUrl, "/api/county-collaboration-orders/cco-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: collaborationVersion, status: "stale-county-diagnosis" })
  }));
  assert.equal(staleCollaborationPatch.response.status, 409);
  assert.equal(staleCollaborationPatch.body.collection, "countyCollaborationOrders");

  const aiRead = await api(baseUrl, "/api/state", authorized(token));
  const aiVersion = aiRead.body.storageMeta.collectionVersions.countyAiDiagnosisCases;
  const aiPatch = await api(baseUrl, "/api/county-ai-diagnosis-cases/cad-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: aiVersion, status: "versioned-ai-review", doctorAction: "versioned-adopted" })
  }));
  assert.equal(aiPatch.response.status, 200);
  assert.equal(aiPatch.body.doctorAction, "versioned-adopted");
  const staleAiPatch = await api(baseUrl, "/api/county-ai-diagnosis-cases/cad-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: aiVersion, doctorAction: "stale-adopted" })
  }));
  assert.equal(staleAiPatch.response.status, 409);
  assert.equal(staleAiPatch.body.collection, "countyAiDiagnosisCases");

  const mutualRead = await api(baseUrl, "/api/state", authorized(token));
  const mutualVersion = mutualRead.body.storageMeta.collectionVersions.countyMutualRecognitionRecords;
  const mutualPatch = await api(baseUrl, "/api/county-mutual-recognition-records/cmr-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: mutualVersion, status: "versioned-recognized", savedCost: 99 })
  }));
  assert.equal(mutualPatch.response.status, 200);
  assert.equal(mutualPatch.body.savedCost, 99);
  const staleMutualPatch = await api(baseUrl, "/api/county-mutual-recognition-records/cmr-001", authorized(token, {
    method: "PATCH",
    body: JSON.stringify({ expectedVersion: mutualVersion, savedCost: 100 })
  }));
  assert.equal(staleMutualPatch.response.status, 409);
  assert.equal(staleMutualPatch.body.collection, "countyMutualRecognitionRecords");
});
