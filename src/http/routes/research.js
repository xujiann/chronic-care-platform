"use strict";

const {
  CONTRACT_ID,
  CONTRACT_VERSION,
  buildResearchSandboxReadModel,
  canReadResearchDataset,
  normalizeResearchPurpose
} = require("../research/sandbox-read-model");
const {
  ResearchExportWorkflowError,
  applyCompliantExportAction,
  isExportVisibleToUser
} = require("../research/compliant-export-workflow");
const {
  ResearchDatasetCommandError,
  applyResearchDatasetCommand,
  projectResearchDataset,
  withResearchDatasetWriteLock
} = require("../research/dataset-write-command");

function sendResearchExportError(sendJson, res, error) {
  const knownError = error instanceof ResearchExportWorkflowError;
  const status = knownError ? error.status : 400;
  const errorName = status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : "Bad Request";
  sendJson(res, status, {
    error: errorName,
    code: knownError ? error.code : "RESEARCH_EXPORT_INVALID_REQUEST",
    message: error.message
  });
}

function idempotencyHeader(req) {
  const value = req.headers?.["idempotency-key"];
  return Array.isArray(value) ? value[0] : value;
}

function sendResearchCommandError(sendJson, res, error) {
  const versionConflict = String(error?.message || "").includes("SQLite optimistic lock conflict");
  const known = error instanceof ResearchDatasetCommandError || error instanceof ResearchExportWorkflowError;
  const status = versionConflict ? 409 : known ? (error.status || 400) : error instanceof SyntaxError ? 400 : 500;
  const code = versionConflict
    ? "RESEARCH_COMMAND_VERSION_CONFLICT"
    : known ? error.code
      : error instanceof SyntaxError ? "RESEARCH_COMMAND_BODY_INVALID" : "RESEARCH_COMMAND_STORAGE_FAILED";
  const errorName = status === 403 ? "Forbidden" : status === 404 ? "Not Found" : status === 409 ? "Conflict" : status >= 500 ? "Service Unavailable" : "Bad Request";
  sendJson(res, status, {
    error: errorName,
    code,
    message: known ? error.message : versionConflict ? "Research dataset version changed; retry with a fresh snapshot" : status >= 500 ? "Research command storage failed" : "Research command body is invalid"
  });
}

function createRouteSegments(runtime) {
  const { appendResearchAudit, buildResearchSandboxSummary, collectJson, normalizeResearchApproval, normalizeResearchDatasetApplication, normalizeResearchEvidenceDocument, readDatabase, requireApiRole, requireDatasetSandboxAccess, sendJson, writeDatabase } = runtime;
  return [
    {
      id: "research-01",
      domain: "research",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/research/datasets") {
        const user = requireApiRole(req, res, ["commission"], "/api/research/datasets");
        if (!user) return true;
        sendJson(res, 200, { datasets: (readDatabase().researchDatasets || []).map(projectResearchDataset) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/research/sandbox") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/sandbox");
        if (!user) return true;
        sendJson(res, 200, buildResearchSandboxSummary(readDatabase()));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/research/compliant-exports") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/compliant-exports");
        if (!user) return true;
        const data = readDatabase();
        const exports = (Array.isArray(data.compliantDataExports) ? data.compliantDataExports : [])
          .filter((item) => isExportVisibleToUser(item, user));
        sendJson(res, 200, { exports });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/research/datasets") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets");
        if (!user) return true;
        const data = readDatabase();
        try {
          const payload = await collectJson(req);
          const dataset = normalizeResearchDatasetApplication(payload, user, data);
          data.researchDatasets = [dataset, ...(Array.isArray(data.researchDatasets) ? data.researchDatasets : [])].slice(0, 80);
          appendResearchAudit(data, user, dataset, "application-submit", dataset.accessRequests[0].purpose, "submitted");
          writeDatabase(data);
          sendJson(res, 201, dataset);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/research/disease-models") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/disease-models");
        if (!user) return true;
        sendJson(res, 200, { models: readDatabase().diseaseRegistryModels || [] });
        return true;
      }
        return false;
      }
    },
    {
      id: "research-02",
      domain: "research",
      async handle(req, res, url) {
    const diseaseModelReviewMatch = url.pathname.match(/^\/api\/research\/disease-models\/([^/]+)\/review$/);
      if (req.method === "POST" && diseaseModelReviewMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/research/disease-models/:id/review");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(diseaseModelReviewMatch[1]);
        const index = (data.diseaseRegistryModels || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到专病库模型" });
          return true;
        }
        const payload = await collectJson(req);
        data.diseaseRegistryModels[index] = {
          ...data.diseaseRegistryModels[index],
          version: String(payload.version || data.diseaseRegistryModels[index].version || "").trim(),
          population: String(payload.population || data.diseaseRegistryModels[index].population || "").trim(),
          threshold: String(payload.threshold || data.diseaseRegistryModels[index].threshold || "").trim(),
          reviewStatus: String(payload.reviewStatus || "reviewed").trim(),
          reviewComment: String(payload.reviewComment || "").trim(),
          reviewedAt: new Date().toISOString(),
          reviewedBy: user.username || user.role
        };
        writeDatabase(data);
        sendJson(res, 200, data.diseaseRegistryModels[index]);
        return true;
      }

      const researchDatasetActionMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/actions$/);
      if (req.method === "POST" && researchDatasetActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/research/datasets/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchDatasetActionMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到科研数据集" });
          return true;
        }
        const payload = await collectJson(req);
        const action = String(payload.action || "usage-audit").trim();
        const now = new Date().toISOString();
        data.researchDatasets[index] = {
          ...data.researchDatasets[index],
          version: String(payload.version || data.researchDatasets[index].version || "1.0.0").trim(),
          ethicsApproval: String(payload.ethicsApproval || data.researchDatasets[index].ethicsApproval || "").trim(),
          anonymization: String(payload.anonymization || data.researchDatasets[index].anonymization || "").trim(),
          authorizationStatus: String(payload.authorizationStatus || data.researchDatasets[index].authorizationStatus || "pending").trim(),
          status: String(payload.status || data.researchDatasets[index].status || "draft").trim(),
          usageAudit: action === "usage-audit" ? [
            { at: now, by: user.username || user.role, purpose: String(payload.purpose || "research analysis").trim(), result: String(payload.result || "allowed").trim() },
            ...(data.researchDatasets[index].usageAudit || [])
          ].slice(0, 50) : (data.researchDatasets[index].usageAudit || []),
          outcomes: action === "outcome-return" ? [
            { at: now, title: String(payload.title || "research outcome").trim(), summary: String(payload.summary || "").trim() },
            ...(data.researchDatasets[index].outcomes || [])
          ].slice(0, 50) : (data.researchDatasets[index].outcomes || []),
          updatedAt: now,
          updatedBy: user.username || user.role
        };
        writeDatabase(data);
        sendJson(res, 200, data.researchDatasets[index]);
        return true;
      }

      const researchDatasetApprovalMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/approval$/);
      if (req.method === "POST" && researchDatasetApprovalMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/research/datasets/:id/approval");
        if (!user) return true;
        const id = decodeURIComponent(researchDatasetApprovalMatch[1]);
        try {
          const payload = await collectJson(req);
          const result = await withResearchDatasetWriteLock(id, () => {
            const data = structuredClone(readDatabase());
            const executed = applyResearchDatasetCommand({
              state: data, datasetId: id, endpoint: "approval", payload, user,
              headerKey: idempotencyHeader(req), appendResearchAudit, normalizeResearchApproval,
              normalizeResearchEvidenceDocument, requireDatasetSandboxAccess
            });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, 200, { ...result.response, idempotentReplay: result.replayed });
        } catch (error) {
          sendResearchCommandError(sendJson, res, error);
        }
        return true;
      }

      const researchDatasetEvidenceMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/evidence$/);
      if (req.method === "POST" && researchDatasetEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/evidence");
        if (!user) return true;
        const id = decodeURIComponent(researchDatasetEvidenceMatch[1]);
        try {
          const payload = await collectJson(req);
          const result = await withResearchDatasetWriteLock(id, () => {
            const data = structuredClone(readDatabase());
            const executed = applyResearchDatasetCommand({
              state: data, datasetId: id, endpoint: "evidence", payload, user,
              headerKey: idempotencyHeader(req), appendResearchAudit, normalizeResearchApproval,
              normalizeResearchEvidenceDocument, requireDatasetSandboxAccess
            });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, 200, { ...result.response, idempotentReplay: result.replayed });
        } catch (error) {
          sendResearchCommandError(sendJson, res, error);
        }
        return true;
      }

      const researchSandboxAccessMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/sandbox-access$/);
      if (req.method === "POST" && researchSandboxAccessMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/sandbox-access");
        if (!user) return true;
        const id = decodeURIComponent(researchSandboxAccessMatch[1]);
        try {
          const payload = await collectJson(req);
          const result = await withResearchDatasetWriteLock(id, () => {
            const data = structuredClone(readDatabase());
            const executed = applyResearchDatasetCommand({
              state: data, datasetId: id, endpoint: "sandbox-access", payload, user,
              headerKey: idempotencyHeader(req), appendResearchAudit, normalizeResearchApproval,
              normalizeResearchEvidenceDocument, requireDatasetSandboxAccess
            });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, 200, { ...result.response, idempotentReplay: result.replayed });
        } catch (error) {
          sendResearchCommandError(sendJson, res, error);
        }
        return true;
      }

      const researchReadModelMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/read-model$/);
      if (req.method === "GET" && researchReadModelMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/read-model");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchReadModelMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", code: "RESEARCH_DATASET_NOT_FOUND", message: "Research dataset not found" });
          return true;
        }
        const dataset = data.researchDatasets[index];
        if (!canReadResearchDataset(user, dataset)) {
          appendResearchAudit(data, user, dataset, "read-model-query", "dataset scope denied", "denied");
          writeDatabase(data);
          sendJson(res, 403, { error: "Forbidden", code: "RESEARCH_DATASET_SCOPE_DENIED", message: "Dataset is outside the caller research scope" });
          return true;
        }
        if (!requireDatasetSandboxAccess(dataset)) {
          appendResearchAudit(data, user, dataset, "read-model-query", "dataset governance denied", "denied");
          writeDatabase(data);
          sendJson(res, 403, { error: "Forbidden", code: "RESEARCH_DATASET_NOT_RELEASED", message: "Dataset is not released for de-identified read-model access" });
          return true;
        }
        let purpose;
        try {
          purpose = normalizeResearchPurpose(url.searchParams.get("purpose"));
        } catch (error) {
          appendResearchAudit(data, user, dataset, "read-model-query", error.code || "invalid purpose", "denied");
          writeDatabase(data);
          sendJson(res, 400, { error: "Bad Request", code: error.code || "RESEARCH_PURPOSE_INVALID", message: error.message });
          return true;
        }
        const readModel = buildResearchSandboxReadModel(dataset);
        appendResearchAudit(data, user, dataset, "read-model-query", `${CONTRACT_ID}:${purpose}`);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          generatedAt: new Date().toISOString(),
          correlationId: String(req.correlationId || ""),
          readModel
        });
        return true;
      }

      const researchCompliantExportMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/compliant-exports$/);
      if (req.method === "POST" && researchCompliantExportMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/compliant-exports");
        if (!user) return true;
        const id = decodeURIComponent(researchCompliantExportMatch[1]);
        try {
          const payload = await collectJson(req);
          const result = await withResearchDatasetWriteLock(id, () => {
            const data = structuredClone(readDatabase());
            const executed = applyResearchDatasetCommand({
              state: data, datasetId: id, endpoint: "compliant-export", payload, user,
              headerKey: idempotencyHeader(req), appendResearchAudit, normalizeResearchApproval,
              normalizeResearchEvidenceDocument, requireDatasetSandboxAccess
            });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, result.replayed ? 200 : 201, { ...result.response, idempotentReplay: result.replayed });
        } catch (error) {
          sendResearchCommandError(sendJson, res, error);
        }
        return true;
      }

      const researchCompliantExportActionMatch = url.pathname.match(/^\/api\/research\/compliant-exports\/([^/]+)\/actions$/);
      if (req.method === "POST" && researchCompliantExportActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/research/compliant-exports/:id/actions");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchCompliantExportActionMatch[1]);
        const exportIndex = (data.compliantDataExports || []).findIndex((item) => item.id === id);
        if (exportIndex < 0) {
          sendJson(res, 404, { error: "Not Found", code: "RESEARCH_EXPORT_NOT_FOUND", message: "Compliant export not found" });
          return true;
        }
        const currentExport = data.compliantDataExports[exportIndex];
        const dataset = (data.researchDatasets || []).find((item) => item.id === currentExport.datasetId);
        if (!dataset) {
          sendJson(res, 409, { error: "Conflict", code: "RESEARCH_EXPORT_DATASET_MISSING", message: "Export dataset reference is missing" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          const result = applyCompliantExportAction(currentExport, payload, user, {
            commandId: req.headers["idempotency-key"] || payload.commandId
          });
          if (result.replayed) {
            sendJson(res, 200, { ...result.exportRecord, replayed: true });
            return true;
          }
          data.compliantDataExports[exportIndex] = result.exportRecord;
          const decision = result.exportRecord.decisionHistory.at(-1);
          appendResearchAudit(data, user, dataset, `compliant-export-${decision.action}`, `${id}:v${result.exportRecord.domainVersion}`, "allowed");
          writeDatabase(data);
          sendJson(res, 200, { ...result.exportRecord, replayed: false });
        } catch (error) {
          appendResearchAudit(data, user, dataset, "compliant-export-decision", `${id}:${error.code || error.message}`, "denied");
          writeDatabase(data);
          sendResearchExportError(sendJson, res, error);
        }
        return true;
      }

      const researchOutcomeMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/outcomes$/);
      if (req.method === "POST" && researchOutcomeMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/outcomes");
        if (!user) return true;
        const id = decodeURIComponent(researchOutcomeMatch[1]);
        try {
          const payload = await collectJson(req);
          const result = await withResearchDatasetWriteLock(id, () => {
            const data = structuredClone(readDatabase());
            const executed = applyResearchDatasetCommand({
              state: data, datasetId: id, endpoint: "outcomes", payload, user,
              headerKey: idempotencyHeader(req), appendResearchAudit, normalizeResearchApproval,
              normalizeResearchEvidenceDocument, requireDatasetSandboxAccess
            });
            if (!executed.replayed) writeDatabase(executed.state);
            return executed;
          });
          sendJson(res, 200, { ...result.response, idempotentReplay: result.replayed });
        } catch (error) {
          sendResearchCommandError(sendJson, res, error);
        }
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
