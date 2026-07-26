const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

async function api(baseUrl, pathname, options = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, options);
  const body = await response.json();
  return { response, body };
}

function authorized(token, method = "GET", body) {
  return {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" })
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  };
}

async function login(baseUrl, username) {
  return api(baseUrl, "/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "123456" })
  });
}

test("pilot evidence API persists scoped batches and freezes a verified acceptance pack", async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pilot-evidence-api-"));
  const dataFile = path.join(dataDir, "db.json");
  const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "db.json"), "utf8"));
  data.pilotEvidenceBatches = [];
  data.secureAttachments = Array.from({ length: 20 }, (_, index) => ({
    id: `pilot-attachment-${index + 1}`,
    filename: `pilot-evidence-${index + 1}.pdf`,
    contentType: "application/pdf",
    expectedSizeBytes: 4096 + index,
    expectedChecksumSha256: digest(`pilot-evidence-${index + 1}`),
    sizeBytes: 4096 + index,
    checksumSha256: digest(`pilot-evidence-${index + 1}`),
    classification: "evidence",
    retentionPolicy: "audit-evidence",
    retentionYears: 10,
    immutable: true,
    objectKey: `pilot-evidence/test/pilot-attachment-${index + 1}.pdf`,
    objectVersion: `version-${index + 1}`,
    status: "active",
    scanStatus: "clean",
    scannedAt: "2026-07-26T08:00:00.000Z",
    createdAt: "2026-07-26T07:00:00.000Z",
    createdBy: "hospital",
    createdByRole: "institution",
    createdByOrgCode: "MR1"
  }));
  fs.writeFileSync(dataFile, JSON.stringify(data, null, 2), "utf8");
  process.env.DATA_DIR = dataDir;
  process.env.STORAGE_ENGINE = "json";

  const { server, startServer, stopServer } = require("../server");
  startServer(0);
  await once(server, "listening");
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    await stopServer();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const hospitalLogin = await login(baseUrl, "hospital");
  const communityLogin = await login(baseUrl, "community");
  const commissionLogin = await login(baseUrl, "health");
  assert.equal(hospitalLogin.response.status, 200);
  assert.equal(communityLogin.response.status, 200);
  assert.equal(commissionLogin.response.status, 200);
  const hospitalToken = hospitalLogin.body.token;
  const communityToken = communityLogin.body.token;
  const commissionToken = commissionLogin.body.token;

  const created = await api(baseUrl, "/api/pilot-evidence/batches", authorized(hospitalToken, "POST", {
    pilotId: "dmu-second-hospital-pilot",
    hospitalName: "Dalian Medical University Second Hospital",
    title: "Pilot acceptance batch"
  }));
  assert.equal(created.response.status, 201);
  assert.equal(created.body.batch.organizationCode, "MR1");
  assert.equal(created.body.batch.requirements.length, 20);
  const batchId = created.body.batch.id;

  const forbidden = await api(baseUrl, `/api/pilot-evidence/batches/${batchId}`, authorized(communityToken));
  assert.equal(forbidden.response.status, 403);
  assert.equal(forbidden.body.error, "PILOT_EVIDENCE_SCOPE_FORBIDDEN");

  let revision = created.body.batch.revision;
  for (let index = 0; index < created.body.batch.requirements.length; index += 1) {
    const requirement = created.body.batch.requirements[index];
    const attachmentId = `pilot-attachment-${index + 1}`;
    const registered = await api(
      baseUrl,
      `/api/pilot-evidence/batches/${batchId}/artifacts`,
      authorized(hospitalToken, "POST", {
        expectedRevision: revision,
        requirementId: requirement.id,
        attachmentId
      })
    );
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.artifact.attachmentId, attachmentId);
    assert.equal(registered.body.artifact.scanStatus, "clean");
    revision = registered.body.batch.revision;

    if (index === 0) {
      const institutionReview = await api(
        baseUrl,
        `/api/pilot-evidence/batches/${batchId}/artifacts/${registered.body.artifact.id}/review`,
        authorized(hospitalToken, "POST", {
          expectedRevision: revision,
          outcome: "verified",
          evidenceDigest: registered.body.artifact.checksumSha256,
          note: "Institution self review"
        })
      );
      assert.equal(institutionReview.response.status, 403);
      assert.equal(institutionReview.body.error, "PILOT_EVIDENCE_REVIEW_FORBIDDEN");

      const stale = await api(
        baseUrl,
        `/api/pilot-evidence/batches/${batchId}/artifacts`,
        authorized(hospitalToken, "POST", {
          expectedRevision: revision - 1,
          requirementId: "site-02",
          attachmentId: "pilot-attachment-2"
        })
      );
      assert.equal(stale.response.status, 409);
      assert.equal(stale.body.error, "PILOT_EVIDENCE_REVISION_CONFLICT");
    }

    const reviewed = await api(
      baseUrl,
      `/api/pilot-evidence/batches/${batchId}/artifacts/${registered.body.artifact.id}/review`,
      authorized(commissionToken, "POST", {
        expectedRevision: revision,
        outcome: "verified",
        evidenceDigest: registered.body.artifact.checksumSha256,
        note: "Commission independent review passed"
      })
    );
    assert.equal(reviewed.response.status, 200);
    assert.equal(reviewed.body.artifact.status, "verified");
    revision = reviewed.body.batch.revision;
  }

  const access = await api(
    baseUrl,
    `/api/pilot-evidence/batches/${batchId}/artifacts/${created.body.batch.requirements[0].activeArtifactId || ""}/access`,
    authorized(commissionToken, "POST", { purpose: "Acceptance sampling", expectedRevision: revision })
  );
  assert.equal(access.response.status, 404);

  const beforeFreeze = await api(baseUrl, `/api/pilot-evidence/batches/${batchId}`, authorized(commissionToken));
  const firstArtifact = beforeFreeze.body.batch.artifacts.find((item) => item.requirementId === "site-01");
  const recordedAccess = await api(
    baseUrl,
    `/api/pilot-evidence/batches/${batchId}/artifacts/${firstArtifact.id}/access`,
    authorized(commissionToken, "POST", { purpose: "Acceptance sampling", expectedRevision: revision })
  );
  assert.equal(recordedAccess.response.status, 200);
  assert.equal(recordedAccess.body.accessAudit.action, "artifact-accessed");
  revision = recordedAccess.body.batch.revision;

  const frozen = await api(
    baseUrl,
    `/api/pilot-evidence/batches/${batchId}/freeze`,
    authorized(commissionToken, "POST", { expectedRevision: revision })
  );
  assert.equal(frozen.response.status, 200);
  assert.equal(frozen.body.batch.status, "frozen");
  assert.equal(frozen.body.acceptancePack.summary.verified, 20);
  assert.equal(frozen.body.verification.ok, true);

  const acceptancePack = await api(
    baseUrl,
    `/api/pilot-evidence/batches/${batchId}/acceptance-pack`,
    authorized(commissionToken)
  );
  assert.equal(acceptancePack.response.status, 200);
  assert.equal(acceptancePack.body.verification.ok, true);
  assert.match(acceptancePack.body.acceptancePack.manifestSha256, /^[a-f0-9]{64}$/);

  const center = await api(baseUrl, "/api/pilot-evidence", authorized(hospitalToken));
  assert.equal(center.response.status, 200);
  assert.equal(center.body.summary.frozenBatches, 1);
  assert.equal(center.body.summary.verifiedRequirements, 20);
  assert.equal(center.body.productionReady, false);

  const persisted = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  const persistedBatch = persisted.pilotEvidenceBatches.find((item) => item.id === batchId);
  assert.equal(persistedBatch.status, "frozen");
  assert.equal(persistedBatch.acceptancePack.manifestSha256, frozen.body.acceptancePack.manifestSha256);
  assert.equal(persisted.secureAttachments.find((item) => item.id === "pilot-attachment-1").sourceCollection, "pilotEvidenceBatches");
});

test("pilot evidence operations page exposes batch, review and export workflows", () => {
  const html = fs.readFileSync(path.join(ROOT, "pilot-evidence.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "pilot-evidence.css"), "utf8");
  const js = fs.readFileSync(path.join(ROOT, "pilot-evidence.js"), "utf8");
  for (const marker of [
    "pilot-evidence-batch-form",
    "pilot-evidence-batches",
    "pilot-evidence-requirements",
    "pilot-evidence-artifact-dialog",
    "pilot-evidence-review-dialog",
    "pilot-evidence-freeze"
  ]) {
    assert.match(html, new RegExp(marker));
  }
  assert.match(js, /\/api\/pilot-evidence/);
  assert.match(js, /expectedRevision/);
  assert.match(js, /attachmentId/);
  assert.match(js, /acceptance-pack\?download=1/);
  assert.match(css, /\.evidence-workspace/);
  assert.match(css, /grid-template-columns/);
});
