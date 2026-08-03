"use strict";

function createRouteSegments(runtime) {
  const { APPOINTMENT_CONTRACT_ID, PHYSICAL_EXAM_CONTRACT_ID, appendDataAccessLog, appendSecurityEvent, applyObjectLifecycle, buildIntegrationSample, canAccessResident, canAccessSecureAttachment, collectJson, createObjectDownloadIntent, createObjectUploadIntent, dispatchFinancialRequest, dispatchHospitalRequest, finalizeObjectUpload, hospitalConnectorCenter, landAppointmentIntegrationEvent, landPhysicalExamIntegrationEvent, normalizeHospitalConnectorDomain, normalizeIntegrationEvent, objectStorageCenter, prependAuditTrailEntry, randomUUID, readDatabase, requireApiRole, sendJson, summarizeIntegrationGateway, updateIntegrationEvent, validateAttachmentMetadata, verifyIntegrationSignature, writeDatabase } = runtime;
  return [
    {
      id: "integration-01",
      domain: "integration",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/attachments/storage") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/attachments/storage");
        if (!user) return true;
        sendJson(res, 200, objectStorageCenter(process.env));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/attachments") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments");
        if (!user) return true;
        const data = readDatabase();
        const residentId = String(url.searchParams.get("residentId") || "").trim();
        if (residentId && !canAccessResident(user, residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权查看该居民附件" });
          return true;
        }
        const attachments = (data.secureAttachments || [])
          .filter((item) => (!residentId || item.residentId === residentId) && canAccessSecureAttachment(user, item, data))
          .map(({ uploadId, ...item }) => item);
        sendJson(res, 200, {
          attachments,
          summary: {
            total: attachments.length,
            active: attachments.filter((item) => item.status === "active").length,
            quarantined: attachments.filter((item) => item.status === "quarantined").length,
            legalHold: attachments.filter((item) => item.legalHold === true).length
          }
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/attachments/upload-intents") {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/upload-intents");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const residentId = String(payload.residentId || user.residentId || "").trim();
        if (residentId && !(data.residents || []).some((item) => item.id === residentId)) {
          sendJson(res, 404, { error: "Not Found", message: "未找到附件关联居民" });
          return true;
        }
        if (residentId && !canAccessResident(user, residentId, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权为该居民创建附件" });
          return true;
        }
        if (user.role === "citizen" && !residentId) {
          sendJson(res, 400, { error: "Bad Request", message: "居民附件必须关联 residentId" });
          return true;
        }
        try {
          validateAttachmentMetadata(payload);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const attachmentId = `att-${randomUUID()}`;
        try {
          const intent = await createObjectUploadIntent({
            ...payload,
            attachmentId,
            namespace: String(payload.namespace || (residentId ? "clinical-records" : "platform-evidence"))
          });
          const now = new Date().toISOString();
          const attachment = {
            id: attachmentId,
            residentId,
            purpose: String(payload.purpose || "supporting-document").trim().slice(0, 100),
            sourceCollection: String(payload.sourceCollection || "").trim().slice(0, 80),
            sourceId: String(payload.sourceId || "").trim().slice(0, 120),
            filename: intent.metadata.filename,
            contentType: intent.metadata.contentType,
            expectedSizeBytes: intent.metadata.sizeBytes,
            expectedChecksumSha256: intent.metadata.checksumSha256,
            classification: intent.metadata.classification,
            retentionPolicy: intent.metadata.retentionPolicy,
            retentionYears: intent.metadata.retentionYears,
            immutable: intent.metadata.immutable,
            objectKey: intent.objectKey,
            uploadId: intent.uploadId,
            uploadIntentExpiresAt: intent.expiresAt,
            status: "upload-authorized",
            scanStatus: "pending",
            legalHold: false,
            createdAt: now,
            createdBy: user.username || user.name || user.role,
            createdByRole: user.role,
            createdByOrgCode: user.orgCode || ""
          };
          data.secureAttachments = [attachment, ...(Array.isArray(data.secureAttachments) ? data.secureAttachments : [])].slice(0, 500);
          data.securityEvents = [{
            id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "创建安全附件上传授权", target: attachmentId, result: "允许", detail: `${attachment.classification} · ${attachment.retentionPolicy} · ${attachment.expectedSizeBytes} bytes`
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 201, {
            attachment: { ...attachment, uploadId: undefined },
            uploadIntent: {
              uploadId: intent.uploadId,
              uploadUrl: intent.uploadUrl,
              expiresAt: intent.expiresAt,
              requiredChecksumSha256: attachment.expectedChecksumSha256,
              requiredContentType: attachment.contentType
            }
          });
        } catch (error) {
          sendJson(res, 502, { ok: false, message: "对象存储上传授权创建失败" });
        }
        return true;
      }

      const attachmentCompleteMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/complete$/);
      if (req.method === "POST" && attachmentCompleteMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/:id/complete");
        if (!user) return true;
        const data = readDatabase();
        const attachmentId = decodeURIComponent(attachmentCompleteMatch[1]);
        const index = (data.secureAttachments || []).findIndex((item) => item.id === attachmentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到安全附件" });
          return true;
        }
        const attachment = data.secureAttachments[index];
        if (!canAccessSecureAttachment(user, attachment, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权完成该附件上传" });
          return true;
        }
        if (attachment.status !== "upload-authorized") {
          sendJson(res, 409, { error: "Conflict", message: "附件当前状态不能完成上传" });
          return true;
        }
        try {
          const receipt = await finalizeObjectUpload({
            attachmentId,
            uploadId: attachment.uploadId,
            objectKey: attachment.objectKey,
            expectedSizeBytes: attachment.expectedSizeBytes,
            expectedChecksumSha256: attachment.expectedChecksumSha256
          });
          data.secureAttachments[index] = {
            ...attachment,
            status: "active",
            scanStatus: receipt.scanStatus,
            scannedAt: receipt.scannedAt,
            checksumSha256: receipt.checksumSha256,
            sizeBytes: receipt.sizeBytes,
            objectVersion: receipt.objectVersion,
            activatedAt: new Date().toISOString(),
            uploadId: ""
          };
          appendDataAccessLog(data, user, attachment.residentId, "secureAttachments", "complete upload and verify malware scan");
          data.securityEvents = [{
            id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "完成安全附件上传", target: attachmentId, result: "允许", detail: `checksum verified · scan=${receipt.scanStatus} · ${receipt.sizeBytes} bytes`
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 200, { attachment: data.secureAttachments[index], receipt });
        } catch (error) {
          let quarantineReceipt = null;
          try {
            quarantineReceipt = await applyObjectLifecycle({
              attachmentId,
              objectKey: attachment.objectKey,
              objectVersion: attachment.objectVersion || "",
              action: "quarantine",
              reason: String(error.message || "attachment verification failed").slice(0, 200)
            });
          } catch {
            quarantineReceipt = null;
          }
          data.secureAttachments[index] = {
            ...attachment,
            status: "quarantined",
            scanStatus: /malware scan/.test(error.message) ? "blocked" : "integrity-failed",
            quarantineReason: String(error.message).slice(0, 200),
            quarantinedAt: new Date().toISOString(),
            storageQuarantineStatus: quarantineReceipt ? "accepted" : "pending-reconciliation",
            storageQuarantineReceipt: quarantineReceipt ? { requestId: quarantineReceipt.requestId, effectiveAt: quarantineReceipt.effectiveAt, status: quarantineReceipt.status } : null
          };
          data.securityEvents = [{
            id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: "隔离安全附件", target: attachmentId, result: "拒绝", detail: data.secureAttachments[index].scanStatus
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 422, { ok: false, message: "附件完整性或恶意文件扫描未通过", attachment: data.secureAttachments[index] });
        }
        return true;
      }

      const attachmentDownloadMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/download-intent$/);
      if (req.method === "POST" && attachmentDownloadMatch) {
        const user = requireApiRole(req, res, ["commission", "institution", "citizen"], "/api/attachments/:id/download-intent");
        if (!user) return true;
        const data = readDatabase();
        const attachment = (data.secureAttachments || []).find((item) => item.id === decodeURIComponent(attachmentDownloadMatch[1]));
        if (!attachment) {
          sendJson(res, 404, { error: "Not Found", message: "未找到安全附件" });
          return true;
        }
        if (!canAccessSecureAttachment(user, attachment, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权下载该附件" });
          return true;
        }
        if (attachment.status !== "active" || attachment.scanStatus !== "clean") {
          sendJson(res, 409, { error: "Conflict", message: "附件未通过完整性与恶意文件扫描，不能下载" });
          return true;
        }
        try {
          const intent = await createObjectDownloadIntent({ attachmentId: attachment.id, objectKey: attachment.objectKey, objectVersion: attachment.objectVersion });
          appendDataAccessLog(data, user, attachment.residentId, "secureAttachments", "issue short-lived attachment download intent");
          writeDatabase(data);
          sendJson(res, 200, { attachmentId: attachment.id, filename: attachment.filename, downloadIntent: intent });
        } catch (error) {
          sendJson(res, 502, { ok: false, message: "对象存储下载授权创建失败" });
        }
        return true;
      }

      const attachmentActionMatch = url.pathname.match(/^\/api\/attachments\/([^/]+)\/actions$/);
      if (req.method === "POST" && attachmentActionMatch) {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/attachments/:id/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const attachmentId = decodeURIComponent(attachmentActionMatch[1]);
        const index = (data.secureAttachments || []).findIndex((item) => item.id === attachmentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到安全附件" });
          return true;
        }
        const attachment = data.secureAttachments[index];
        if (!canAccessSecureAttachment(user, attachment, data)) {
          sendJson(res, 403, { error: "Forbidden", message: "无权管理该附件" });
          return true;
        }
        const action = String(payload.action || "").trim().toLowerCase();
        const reason = String(payload.reason || "").trim();
        if (reason.length < 2) {
          sendJson(res, 400, { error: "Bad Request", message: "附件生命周期操作必须填写处理原因" });
          return true;
        }
        if (["legal-hold", "release-hold", "delete"].includes(action) && user.role !== "commission") {
          sendJson(res, 403, { error: "Forbidden", message: "法律保全和删除仅限监管角色" });
          return true;
        }
        if (action === "delete" && (attachment.immutable || attachment.legalHold)) {
          sendJson(res, 409, { error: "Conflict", message: "不可变留存或法律保全附件不能删除" });
          return true;
        }
        try {
          const receipt = await applyObjectLifecycle({ attachmentId, objectKey: attachment.objectKey, objectVersion: attachment.objectVersion, action, reason });
          const nextStatus = action === "quarantine" ? "quarantined" : action === "delete" ? "deleted" : attachment.status;
          data.secureAttachments[index] = {
            ...attachment,
            status: nextStatus,
            legalHold: action === "legal-hold" ? true : action === "release-hold" ? false : attachment.legalHold,
            lastLifecycleAction: action,
            lastLifecycleReason: reason.slice(0, 200),
            lastLifecycleAt: receipt.effectiveAt,
            lastLifecycleBy: user.username || user.name || user.role,
            ...(action === "delete" ? { deletedAt: receipt.effectiveAt } : {})
          };
          data.securityEvents = [{
            id: randomUUID(), at: new Date().toLocaleString("zh-CN", { hour12: false }), actor: user.name, role: user.role,
            action: `安全附件生命周期-${action}`, target: attachmentId, result: "允许", detail: reason.slice(0, 200)
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 200, { attachment: data.secureAttachments[index], receipt });
        } catch (error) {
          sendJson(res, 502, { ok: false, message: "对象存储生命周期操作失败" });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/integration/contracts") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/contracts");
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, { contracts: data.integrationContracts });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/integration/adapters") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/integration/adapters");
        if (!user) return true;
        sendJson(res, 200, hospitalConnectorCenter(process.env));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/integration/dispatch") {
        const user = requireApiRole(req, res, ["commission", "institution"], "/api/integration/dispatch");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const contract = (data.integrationContracts || []).find((item) => item.id === String(payload.contractId || "").trim());
        if (!contract) {
          sendJson(res, 404, { error: "Not Found", message: "未找到接口契约" });
          return true;
        }
        let domain;
        try {
          domain = normalizeHospitalConnectorDomain(contract.domain);
        } catch {
          sendJson(res, 400, { error: "Bad Request", message: "该契约不属于医院核心系统连接器" });
          return true;
        }
        const idempotencyKey = String(payload.idempotencyKey || payload.payload?.[contract.idempotencyKey] || "").trim();
        const businessPayload = payload.payload && typeof payload.payload === "object" && !Array.isArray(payload.payload) ? payload.payload : {};
        if (!idempotencyKey) {
          sendJson(res, 400, { error: "Bad Request", message: "医院连接器调用必须提供 idempotencyKey" });
          return true;
        }
        const missingFields = (contract.requiredFields || []).filter((field) => businessPayload[field] === undefined);
        if (missingFields.length) {
          sendJson(res, 400, { error: "Bad Request", message: "医院连接器载荷缺少必填字段", missingFields });
          return true;
        }
        const duplicate = (data.integrationGatewayEvents || []).find((item) => item.direction === "outbound" && item.contractId === contract.id && item.idempotencyKey === idempotencyKey);
        if (duplicate) {
          sendJson(res, 200, { ...duplicate, idempotentReplay: true });
          return true;
        }
        const requestPayload = { contractId: contract.id, domain, idempotencyKey, payload: businessPayload };
        const baseEvent = {
          id: `igw-${randomUUID()}`,
          direction: "outbound",
          adapterType: "hospital",
          contractId: contract.id,
          domain,
          resource: contract.resource,
          idempotencyKey,
          externalId: String(businessPayload.externalId || "").trim(),
          residentId: String(businessPayload.residentId || "").trim(),
          status: "dispatching",
          signatureVerified: false,
          outboundSigned: true,
          receivedBy: user.username || user.role,
          requestPayload,
          payload: businessPayload,
          retryCount: 0,
          deadLetter: false,
          reconciliationStatus: "dispatching",
          receivedAt: new Date().toISOString()
        };
        try {
          const receipt = await dispatchHospitalRequest(requestPayload);
          const event = {
            ...baseEvent,
            status: receipt.status,
            adapterReceipt: receipt,
            dispatchedAt: receipt.acceptedAt,
            reconciliationStatus: "provider-accepted"
          };
          data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
          data.securityEvents = [{
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "调用医院核心系统连接器",
            target: `${domain}/${contract.id}`,
            result: "允许",
            detail: `${receipt.receiptId} · ${idempotencyKey} · attempts=${receipt.attempts}`
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 202, event);
        } catch (error) {
          const event = {
            ...baseEvent,
            status: "failed",
            deadLetter: true,
            deadLetterReason: String(error.message || "hospital connector dispatch failed").slice(0, 200),
            failedAt: new Date().toISOString(),
            reconciliationStatus: "dead-letter"
          };
          data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
          data.securityEvents = [{
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "调用医院核心系统连接器",
            target: `${domain}/${contract.id}`,
            result: "失败",
            detail: `${event.id} · ${idempotencyKey} · 已进入死信对账`
          }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120);
          writeDatabase(data);
          sendJson(res, 502, { ok: false, message: "医院核心系统连接器调用失败", event });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "integration-02",
      domain: "integration",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/integration/samples") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/samples");
        if (!user) return true;
        const data = readDatabase();
        const contractId = url.searchParams.get("contractId");
        const contracts = contractId ? data.integrationContracts.filter((item) => item.id === contractId) : data.integrationContracts;
        if (contractId && contracts.length === 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到接口契约" });
          return true;
        }
        sendJson(res, 200, { samples: contracts.map((contract, index) => buildIntegrationSample(contract, index + 1)) });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/integration/events") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance", "county"], "/api/integration/events");
        if (!user) return true;
        const payload = await collectJson(req);
        if (!payload.idempotencyKey) {
          sendJson(res, 400, { error: "Bad Request", message: "集成事件必须提供 idempotencyKey" });
          return true;
        }
        if (!verifyIntegrationSignature(payload, req.headers["x-integration-signature"])) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "集成网关验签", target: payload.contractId || "", result: "拒绝", detail: "签名不匹配" });
          sendJson(res, 401, { error: "Unauthorized", message: "集成事件签名校验失败" });
          return true;
        }
        const data = readDatabase();
        const contract = data.integrationContracts.find((item) => item.id === payload.contractId);
        if (!contract) {
          sendJson(res, 400, { error: "Bad Request", message: "未找到接口契约" });
          return true;
        }
        const missingFields = (contract.requiredFields || []).filter((field) => payload[field] === undefined && payload.payload?.[field] === undefined);
        if (missingFields.length) {
          sendJson(res, 400, { error: "Bad Request", message: "集成事件缺少必填字段", missingFields });
          return true;
        }
        const duplicate = (data.integrationGatewayEvents || []).find((item) => item.idempotencyKey === payload.idempotencyKey);
        if (duplicate) {
          sendJson(res, 200, { ...duplicate, idempotentReplay: true });
          return true;
        }
        const event = normalizeIntegrationEvent(payload, user, contract);
        landAppointmentIntegrationEvent(data, payload, event, user);
        landPhysicalExamIntegrationEvent(data, payload, event, user);
        data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "接收集成事件",
          target: `${contract.domain}/${payload.externalId}`,
          result: "允许",
          detail: `${contract.id} · ${event.idempotencyKey}`
        });
        writeDatabase(data);
        sendJson(res, 202, event);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/integration/simulate") {
        const user = requireApiRole(req, res, ["commission"], "/api/integration/simulate");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const contract = data.integrationContracts.find((item) => item.id === payload.contractId);
        if (!contract) {
          sendJson(res, 404, { error: "Not Found", message: "未找到接口契约" });
          return true;
        }
        const sample = buildIntegrationSample(contract, Number(payload.sequence || 1));
        const duplicate = (data.integrationGatewayEvents || []).find((item) => item.idempotencyKey === sample.payload.idempotencyKey);
        if (duplicate) {
          sendJson(res, 200, { sample, event: { ...duplicate, idempotentReplay: true } });
          return true;
        }
        const event = {
          ...normalizeIntegrationEvent(sample.payload, user, contract),
          simulated: true,
          simulatorSignature: sample.signature
        };
        landAppointmentIntegrationEvent(data, sample.payload, event, user);
        landPhysicalExamIntegrationEvent(data, sample.payload, event, user);
        data.integrationGatewayEvents = [event, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "模拟集成网关联调",
          target: `${contract.domain}/${sample.payload.externalId}`,
          result: "允许",
          detail: `${contract.id} · ${sample.payload.idempotencyKey}`
        });
        writeDatabase(data);
        sendJson(res, 202, { sample, event });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/integration/monitor") {
        const user = requireApiRole(req, res, ["commission"], "/api/integration/monitor");
        if (!user) return true;
        const data = readDatabase();
        const events = Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [];
        sendJson(res, 200, {
          summary: summarizeIntegrationGateway(events),
          recentEvents: events.slice(0, 30)
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "integration-03",
      domain: "integration",
      async handle(req, res, url) {
    const integrationRetryMatch = url.pathname.match(/^\/api\/integration\/events\/([^/]+)\/retry$/);
      if (req.method === "POST" && integrationRetryMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/integration/events/:id/retry");
        if (!user) return true;
        const data = readDatabase();
        const sourceEvent = (Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : []).find((item) => item.id === integrationRetryMatch[1]);
        if (sourceEvent?.direction === "outbound" && Number(sourceEvent.retryCount || 0) >= 3) {
          sendJson(res, 409, { error: "Conflict", message: "outbound adapter event reached the manual retry limit and requires reconciliation" });
          return true;
        }
        const event = updateIntegrationEvent(data, integrationRetryMatch[1], (current) => ({
          status: "retrying",
          retryCount: Number(current.retryCount || 0) + 1,
          deadLetter: false,
          deadLetterReason: "",
          lastRetriedAt: new Date().toISOString(),
          reconciliationStatus: "retrying"
        }));
        if (!event) {
          sendJson(res, 404, { error: "Not Found", message: "未找到集成网关事件" });
          return true;
        }
        if (event.contractId === APPOINTMENT_CONTRACT_ID && event.requestPayload) {
          landAppointmentIntegrationEvent(data, event.requestPayload, event, user);
        }
        if (event.contractId === PHYSICAL_EXAM_CONTRACT_ID && event.requestPayload) {
          landPhysicalExamIntegrationEvent(data, event.requestPayload, event, user);
        }
        if (event.adapterType === "hospital" && event.requestPayload) {
          try {
            const receipt = await dispatchHospitalRequest(event.requestPayload);
            Object.assign(event, {
              status: receipt.status,
              adapterReceipt: receipt,
              dispatchedAt: receipt.acceptedAt,
              deadLetter: false,
              deadLetterReason: "",
              reconciliationStatus: "provider-accepted",
              lastRetryResult: "provider-accepted"
            });
          } catch (error) {
            Object.assign(event, {
              status: "failed",
              deadLetter: true,
              deadLetterReason: String(error.message || "hospital connector retry failed").slice(0, 200),
              failedAt: new Date().toISOString(),
              reconciliationStatus: "dead-letter",
              lastRetryResult: "failed"
            });
          }
        }
        if (event.adapterType === "financial" && event.requestPayload) {
          try {
            const previousReceipt = event.adapterReceipt;
            const receipt = await dispatchFinancialRequest(event.requestPayload);
            const adapterReceiptHistory = [previousReceipt, ...(Array.isArray(event.adapterReceiptHistory) ? event.adapterReceiptHistory : [])]
              .filter((item, index, list) => item?.receiptId && list.findIndex((candidate) => candidate?.receiptId === item.receiptId) === index)
              .slice(0, 10);
            Object.assign(event, {
              status: receipt.status,
              adapterReceipt: receipt,
              adapterReceiptHistory,
              providerStatus: receipt.status,
              latestCallbackAt: "",
              businessDate: String(receipt.acceptedAt || "").slice(0, 10),
              dispatchedAt: receipt.acceptedAt,
              deadLetter: false,
              deadLetterReason: "",
              reconciliationStatus: "provider-accepted",
              lastRetryResult: "provider-accepted"
            });
          } catch (error) {
            Object.assign(event, {
              status: "failed",
              deadLetter: true,
              deadLetterReason: String(error.message || "financial gateway retry failed").slice(0, 200),
              failedAt: new Date().toISOString(),
              reconciliationStatus: "dead-letter",
              lastRetryResult: "failed"
            });
          }
        }
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "重试集成网关事件",
            target: event.id,
            result: event.deadLetter ? "失败" : "允许",
            detail: `${event.contractId} · ${event.idempotencyKey} · retry=${event.retryCount}${event.direction === "outbound" ? ` · ${event.lastRetryResult}` : ""}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, event);
        return true;
      }

      const integrationDeadLetterMatch = url.pathname.match(/^\/api\/integration\/events\/([^/]+)\/dead-letter$/);
      if (req.method === "POST" && integrationDeadLetterMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/integration/events/:id/dead-letter");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const event = updateIntegrationEvent(data, integrationDeadLetterMatch[1], () => ({
          status: "failed",
          deadLetter: true,
          deadLetterReason: String(payload.reason || "manual-compensation-required").slice(0, 200),
          failedAt: new Date().toISOString(),
          reconciliationStatus: "dead-letter"
        }));
        if (!event) {
          sendJson(res, 404, { error: "Not Found", message: "未找到集成网关事件" });
          return true;
        }
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "标记集成网关死信",
          target: event.id,
          result: "允许",
          detail: `${event.contractId} · ${event.idempotencyKey} · ${event.deadLetterReason}`
        });
        writeDatabase(data);
        sendJson(res, 200, event);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
