"use strict";

function createRouteSegments(runtime) {
  const { appendResearchAudit, buildResearchSandboxSummary, collectJson, normalizeCompliantDataExport, normalizeResearchApproval, normalizeResearchDatasetApplication, normalizeResearchEvidenceDocument, readDatabase, requireApiRole, requireDatasetSandboxAccess, sendJson, writeDatabase } = runtime;
  return [
    {
      id: "research-01",
      domain: "research",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/research/datasets") {
        const user = requireApiRole(req, res, ["commission"], "/api/research/datasets");
        if (!user) return true;
        sendJson(res, 200, { datasets: readDatabase().researchDatasets || [] });
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
        sendJson(res, 200, { exports: Array.isArray(data.compliantDataExports) ? data.compliantDataExports : [] });
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
        const data = readDatabase();
        const id = decodeURIComponent(researchDatasetApprovalMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Research dataset not found" });
          return true;
        }
        const payload = await collectJson(req);
        data.researchDatasets[index] = normalizeResearchApproval(data.researchDatasets[index], payload, user);
        appendResearchAudit(data, user, data.researchDatasets[index], "ethics-approval", data.researchDatasets[index].approval?.decision || "approved");
        writeDatabase(data);
        sendJson(res, 200, data.researchDatasets[index]);
        return true;
      }

      const researchDatasetEvidenceMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/evidence$/);
      if (req.method === "POST" && researchDatasetEvidenceMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/evidence");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchDatasetEvidenceMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Research dataset not found" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          const document = normalizeResearchEvidenceDocument(payload, user, data.researchDatasets[index]);
          data.researchDatasets[index].evidenceDocuments = [
            document,
            ...(Array.isArray(data.researchDatasets[index].evidenceDocuments) ? data.researchDatasets[index].evidenceDocuments : [])
          ].slice(0, 50);
          appendResearchAudit(data, user, data.researchDatasets[index], "evidence-document", `${document.type}:${document.referenceNo}`);
          writeDatabase(data);
          sendJson(res, 200, data.researchDatasets[index]);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      const researchSandboxAccessMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/sandbox-access$/);
      if (req.method === "POST" && researchSandboxAccessMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/sandbox-access");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchSandboxAccessMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Research dataset not found" });
          return true;
        }
        if (!requireDatasetSandboxAccess(data.researchDatasets[index])) {
          appendResearchAudit(data, user, data.researchDatasets[index], "sandbox-access", "blocked by ethics/de-identification/authorization/governance/evidence status", "denied");
          writeDatabase(data);
          sendJson(res, 403, { error: "Forbidden", message: "Dataset is not approved, de-identified, governance-ready, evidence-ready, and active for sandbox access" });
          return true;
        }
        const payload = await collectJson(req);
        const purpose = String(payload.purpose || "approved sandbox analysis").trim();
        data.researchDatasets[index].sandbox = {
          ...(data.researchDatasets[index].sandbox || {}),
          status: "active",
          lastAccessAt: new Date().toISOString(),
          lastAccessBy: user.username || user.role
        };
        appendResearchAudit(data, user, data.researchDatasets[index], "sandbox-access", purpose);
        writeDatabase(data);
        sendJson(res, 200, {
          datasetId: id,
          sandboxToken: `sandbox-${id}-${Date.now()}`,
          deidentified: true,
          governance: data.researchDatasets[index].governance || {},
          records: data.researchDatasets[index].records || 0,
          sourceCollections: data.researchDatasets[index].sourceCollections || [],
          expiresInMinutes: 120
        });
        return true;
      }

      const researchCompliantExportMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/compliant-exports$/);
      if (req.method === "POST" && researchCompliantExportMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/compliant-exports");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchCompliantExportMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Research dataset not found" });
          return true;
        }
        if (!requireDatasetSandboxAccess(data.researchDatasets[index])) {
          appendResearchAudit(data, user, data.researchDatasets[index], "compliant-data-export", "blocked by ethics/de-identification/authorization/governance/evidence status", "denied");
          writeDatabase(data);
          sendJson(res, 403, { error: "Forbidden", message: "Dataset is not approved, de-identified, governance-ready, evidence-ready, and active for compliant export" });
          return true;
        }
        try {
          const payload = await collectJson(req);
          const exportRequest = normalizeCompliantDataExport(payload, user, data.researchDatasets[index]);
          data.compliantDataExports = [
            exportRequest,
            ...(Array.isArray(data.compliantDataExports) ? data.compliantDataExports : [])
          ].slice(0, 120);
          appendResearchAudit(data, user, data.researchDatasets[index], "compliant-data-export", `${exportRequest.id}:${exportRequest.destination}`);
          writeDatabase(data);
          sendJson(res, 201, exportRequest);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
        }
        return true;
      }

      const researchOutcomeMatch = url.pathname.match(/^\/api\/research\/datasets\/([^/]+)\/outcomes$/);
      if (req.method === "POST" && researchOutcomeMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/research/datasets/:id/outcomes");
        if (!user) return true;
        const data = readDatabase();
        const id = decodeURIComponent(researchOutcomeMatch[1]);
        const index = (data.researchDatasets || []).findIndex((item) => item.id === id);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "Research dataset not found" });
          return true;
        }
        const payload = await collectJson(req);
        const now = new Date().toISOString();
        const outcome = {
          at: now,
          by: user.username || user.role,
          title: String(payload.title || "research outcome").trim(),
          summary: String(payload.summary || "").trim(),
          registryImpact: String(payload.registryImpact || "").trim(),
          returnedTo: Array.isArray(payload.returnedTo) ? payload.returnedTo.map((item) => String(item).trim()).filter(Boolean) : ["diseaseRegistryModels"]
        };
        data.researchDatasets[index].outcomes = [outcome, ...(Array.isArray(data.researchDatasets[index].outcomes) ? data.researchDatasets[index].outcomes : [])].slice(0, 50);
        appendResearchAudit(data, user, data.researchDatasets[index], "outcome-return", outcome.title);
        writeDatabase(data);
        sendJson(res, 200, data.researchDatasets[index]);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
