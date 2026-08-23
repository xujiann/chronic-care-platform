"use strict";

const InsurancePaymentRefundTransaction = require("../../../insurance-payment-refund-transaction");

function createRouteSegments(runtime) {
  const { DiseasePaymentGrouperContract, DiseasePaymentIntake, DiseasePaymentService, FinancialCallbackError, OnlinePaymentRefunds, appendSecurityEvent, applyFinancialCallback, authorizeInsurancePaymentAction, collectJson, createFinancialReconciliationRun, diseasePaymentPackageSignatureOptions, dispatchFinancialRequest, financialDispatchRequestDigest, financialGatewayCenter, financialGatewayOperationsCenter, normalizeState, patchBusinessCollectionItem, prependAuditTrailEntry, randomUUID, readDatabase, requireApiRole, requireInsuranceSystemCommand, sendInsurancePaymentError, sendJson, validateFinancialRequest, verifyFinancialCallback, withFinancialDispatchLock, withFinancialDispatchStateLock, withFinancialReconciliationLock, writeDatabase } = runtime;
  return [
    {
      id: "insurance-payment-01",
      domain: "insurance-payment",
      async handle(req, res, url) {
    const financialCallbackMatch = url.pathname.match(/^\/api\/financial-gateways\/callbacks\/([^/]+)$/);
      if (req.method === "POST" && financialCallbackMatch) {
        const callbackType = decodeURIComponent(financialCallbackMatch[1]);
        try {
          const payload = await collectJson(req);
          const verified = verifyFinancialCallback(payload, {
            type: callbackType,
            timestamp: req.headers["x-financial-timestamp"],
            nonce: req.headers["x-financial-nonce"],
            signature: req.headers["x-financial-signature"]
          });
          const { result, domainResult } = await withFinancialDispatchStateLock(() => {
            const data = readDatabase();
            const result = applyFinancialCallback(data, verified);
            let domainResult = null;
            if (result.gatewayEvent.gatewayType === "PAYMENT" && result.gatewayEvent.operation === "refund") {
              domainResult = OnlinePaymentRefunds.syncRefundFromFinancialCallback(
                data,
                result,
                "financial-callback-adapter",
                { trustedFinancialCallback: true }
              );
            }
            if (result.gatewayEvent.gatewayType === "INSURANCE"
              && result.gatewayEvent.operation === "settlement"
              && ["core-accepted", "core-returned", "payment-failed", "confirm-payment"].includes(String(payload.action || ""))) {
              const callbackPayload = {
                action: String(payload.action),
                receiptId: verified.receiptId,
                idempotencyKey: verified.eventId,
                paidAmountFen: verified.amountFen,
                returnCycleId: payload.returnCycleId,
                failureCycleId: payload.failureCycleId,
                reasonCode: verified.providerCode || payload.reasonCode,
                reason: verified.failureReason || payload.reason,
                requirementDigest: payload.requirementDigest,
                failureEvidenceDigest: payload.failureEvidenceDigest,
                correctionWorkingDays: payload.correctionWorkingDays,
                resolutionWorkingDays: payload.resolutionWorkingDays,
                at: verified.receivedAt
              };
              const settlementResult = DiseasePaymentService.applyInsuranceCoreSettlementCallback(
                data.diseasePayment,
                result.gatewayEvent.externalId,
                callbackPayload,
                "insurance-core-adapter"
              );
              data.diseasePayment = settlementResult.state;
              domainResult = settlementResult;
            }
            data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: `${verified.gatewayType.toLowerCase()}-provider`,
              role: "external-adapter",
              action: "financial gateway callback",
              target: verified.receiptId,
              result: result.idempotentReplay ? "幂等" : result.callbackEvent.stateApplied ? "允许" : "仅记录",
              detail: `${verified.eventId}:${verified.status}${result.callbackEvent.ignoredReason ? `:${result.callbackEvent.ignoredReason}` : ""}`
            });
            const modernFinancialEvent = Boolean(
              result.gatewayEvent.idempotencyKey
              && result.gatewayEvent.requestPayload
              && typeof result.gatewayEvent.requestPayload === "object"
              && !Array.isArray(result.gatewayEvent.requestPayload)
              && result.gatewayEvent.requestPayload.type
              && result.gatewayEvent.requestPayload.operation
              && result.gatewayEvent.requestPayload.contractId
            );
            writeDatabase(
              { ...normalizeState(data), storageMeta: data.storageMeta },
              {
                financialGatewayWrite: {
                  kind: modernFinancialEvent ? "callback" : "legacy-callback",
                  eventId: result.gatewayEvent.id,
                  idempotencyKey: modernFinancialEvent ? result.gatewayEvent.idempotencyKey : "",
                  requestDigest: modernFinancialEvent
                    ? financialDispatchRequestDigest(result.gatewayEvent.requestPayload)
                    : "",
                  callbackEventId: result.callbackEvent.eventId,
                  callbackAttestation: result.verificationAttestation
                }
              }
            );
            return { result, domainResult };
          });
          sendJson(res, 200, {
            ok: true,
            idempotentReplay: result.idempotentReplay,
            gateway: {
              eventId: result.gatewayEvent.id,
              gatewayType: result.gatewayEvent.gatewayType,
              receiptId: verified.receiptId,
              status: result.gatewayEvent.providerStatus,
              reconciliationStatus: result.gatewayEvent.reconciliationStatus,
              productionEvidence: false
            },
            callback: {
              eventId: result.callbackEvent.eventId,
              status: result.callbackEvent.status,
              stateApplied: result.callbackEvent.stateApplied,
              ignoredReason: result.callbackEvent.ignoredReason
            },
            domainSynchronized: Boolean(domainResult)
          });
        } catch (error) {
          const unsupportedType = /unsupported financial gateway type/i.test(String(error.message || ""));
          const known = error instanceof FinancialCallbackError;
          const status = known ? error.statusCode : unsupportedType || error instanceof SyntaxError ? 400 : 500;
          const code = known ? error.code : unsupportedType ? "FINANCIAL_CALLBACK_GATEWAY_INVALID" : error instanceof SyntaxError ? "FINANCIAL_CALLBACK_BODY_INVALID" : "FINANCIAL_CALLBACK_FAILED";
          try {
            appendSecurityEvent({
              actor: "financial-provider",
              role: "external-adapter",
              action: "financial gateway callback",
              target: `/api/financial-gateways/callbacks/${String(callbackType || "").replace(/[\r\n]/g, " ").slice(0, 32)}`,
              result: "denied",
              detail: code
            });
          } catch {}
          sendJson(res, status, { ok: false, code, message: known ? error.message : unsupportedType ? "financial callback gateway is invalid" : "financial callback failed" });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/financial-gateways/operations") {
        const user = requireApiRole(req, res, ["commission", "insurance"], "/api/financial-gateways/operations");
        if (!user) return true;
        const scopeType = user.role === "insurance" ? "INSURANCE" : "";
        const center = financialGatewayOperationsCenter(readDatabase(), process.env, scopeType);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "financial gateway operations read",
          target: scopeType || "ALL",
          result: "allowed",
          detail: `${center.summary.callbackEvents} callbacks / ${center.summary.reconciliationDifferences} reconciliation differences`
        });
        sendJson(res, 200, center);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/financial-gateways/reconciliation-runs") {
        const user = requireApiRole(req, res, ["commission", "insurance"], "/api/financial-gateways/reconciliation-runs");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          if (user.role === "insurance" && String(payload.gatewayType || payload.type || "").toUpperCase() !== "INSURANCE") {
            sendJson(res, 403, {
              error: "Forbidden",
              code: "FINANCIAL_RECONCILIATION_GATEWAY_SCOPE_DENIED",
              message: "insurance role is limited to insurance reconciliation"
            });
            return true;
          }
          const result = await withFinancialReconciliationLock(payload, async () => {
            const data = readDatabase();
            const reconciliation = createFinancialReconciliationRun(data, payload, user);
            data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
              id: randomUUID(),
              at: new Date().toLocaleString("zh-CN", { hour12: false }),
              actor: user.name,
              role: user.role,
              action: "financial daily reconciliation",
              target: `${reconciliation.run.gatewayType}/${reconciliation.run.businessDate}`,
              result: reconciliation.run.status === "matched" ? "allowed" : "review-required",
              detail: `${reconciliation.run.id}:${reconciliation.run.status}:${reconciliation.run.providerSummary.statementDigest}`
            });
            writeDatabase({ ...normalizeState(data), storageMeta: data.storageMeta });
            return reconciliation;
          });
          sendJson(res, result.idempotentReplay ? 200 : 201, { ok: true, idempotentReplay: result.idempotentReplay, run: result.run, productionEvidence: false });
        } catch (error) {
          const known = error instanceof FinancialCallbackError;
          const versionConflict = String(error?.message || "").includes("SQLite optimistic lock conflict");
          sendJson(res, versionConflict ? 409 : known ? error.statusCode : error instanceof SyntaxError ? 400 : 500, {
            ok: false,
            code: versionConflict ? "FINANCIAL_RECONCILIATION_VERSION_CONFLICT" : known ? error.code : error instanceof SyntaxError ? "FINANCIAL_RECONCILIATION_BODY_INVALID" : "FINANCIAL_RECONCILIATION_FAILED",
            message: versionConflict ? "financial reconciliation state changed; retry with a fresh snapshot" : known ? error.message : "financial reconciliation failed"
          });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/financial-gateways") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/financial-gateways");
        if (!user) return true;
        sendJson(res, 200, financialGatewayCenter(process.env));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/financial-gateways/dispatch") {
        const user = requireApiRole(req, res, ["commission", "institution", "insurance"], "/api/financial-gateways/dispatch");
        if (!user) return true;
        let payload;
        try {
          payload = await collectJson(req);
        } catch {
          sendJson(res, 400, { ok: false, code: "FINANCIAL_DISPATCH_BODY_INVALID", message: "financial dispatch body is invalid" });
          return true;
        }
        let validated;
        try {
          validated = validateFinancialRequest(payload);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message, missingFields: error.missingFields || [] });
          return true;
        }
        if (validated.type !== "INSURANCE" && user.role === "insurance") {
          sendJson(res, 403, {
            ok: false,
            error: "Forbidden",
            code: "FINANCIAL_DISPATCH_GATEWAY_SCOPE_DENIED",
            message: "insurance role is limited to the insurance gateway"
          });
          return true;
        }
        const contractByType = {
          PAYMENT: "payment-transaction-v1",
          INSURANCE: "insurance-settlement-v1",
          CERTIFICATE: "certificate-sync-v1"
        };
        const contractId = contractByType[validated.type];
        const idempotencyKey = String(payload.idempotencyKey || "").trim();
        if (!idempotencyKey) {
          sendJson(res, 400, { error: "Bad Request", message: "financial gateway idempotencyKey is required" });
          return true;
        }
        if (user.role === "institution") {
          const actorInstitutionCode = String(user.orgCode || "").trim();
          const requestedInstitutionCode = String(validated.payload.institutionCode || "").trim();
          if (!actorInstitutionCode || (requestedInstitutionCode && requestedInstitutionCode !== actorInstitutionCode)) {
            sendJson(res, 403, {
              ok: false,
              error: "Forbidden",
              code: "FINANCIAL_DISPATCH_INSTITUTION_SCOPE_DENIED",
              message: "financial dispatch institution scope denied"
            });
            return true;
          }
          validated = {
            ...validated,
            payload: { ...validated.payload, institutionCode: actorInstitutionCode }
          };
        }
        const requestPayload = {
          type: validated.type,
          operation: validated.operation,
          contractId,
          idempotencyKey,
          payload: validated.payload
        };
        const requestDigest = financialDispatchRequestDigest(requestPayload);
        try {
          const result = await withFinancialDispatchLock(idempotencyKey, async () => {
            const reservation = await withFinancialDispatchStateLock(() => {
              const data = readDatabase();
              const duplicate = (data.integrationGatewayEvents || []).find((item) =>
                item.adapterType === "financial" && item.idempotencyKey === idempotencyKey
              );
              if (duplicate) {
                const duplicateDigest = financialDispatchRequestDigest(duplicate.requestPayload || {
                  type: duplicate.gatewayType,
                  operation: duplicate.operation,
                  contractId: duplicate.contractId,
                  payload: duplicate.payload
                });
                if (duplicateDigest !== requestDigest) {
                  throw new FinancialCallbackError(
                    "financial dispatch idempotency key is bound to a different request",
                    "FINANCIAL_DISPATCH_IDEMPOTENCY_CONFLICT",
                    409
                  );
                }
                if (duplicate.status === "failed") {
                  return {
                    status: 502,
                    body: {
                      ok: false,
                      code: "FINANCIAL_DISPATCH_PROVIDER_REJECTED",
                      message: "financial gateway dispatch failed",
                      event: { ...duplicate, idempotentReplay: true }
                    }
                  };
                }
                if (["dispatching", "retrying"].includes(duplicate.status)) {
                  return { status: 202, body: { ...duplicate, idempotentReplay: true } };
                }
                return { status: 200, body: { ...duplicate, idempotentReplay: true } };
              }
              const baseEvent = {
                id: `igw-${randomUUID()}`,
                direction: "outbound",
                adapterType: "financial",
                gatewayType: validated.type,
                operation: validated.operation,
                contractId,
                domain: validated.type,
                resource: "FinancialGatewayRequest",
                idempotencyKey,
                externalId: String(validated.payload.externalId || validated.payload.orderNo || validated.payload.claimNo || "").trim(),
                residentId: String(validated.payload.residentId || "").trim(),
                status: "dispatching",
                signatureVerified: false,
                outboundSigned: true,
                receivedBy: user.username || user.role,
                capacityScope: user.orgCode
                  ? `institution:${String(user.orgCode).trim()}`
                  : `principal:${String(user.username || user.role).trim()}`,
                requestPayload,
                payload: validated.payload,
                retryCount: 0,
                deadLetter: false,
                reconciliationStatus: "dispatching",
                receivedAt: new Date().toISOString()
              };
              data.integrationGatewayEvents = [baseEvent, ...(Array.isArray(data.integrationGatewayEvents) ? data.integrationGatewayEvents : [])].slice(0, 200);
              writeDatabase(data, {
                financialGatewayWrite: {
                  kind: "reserve",
                  eventId: baseEvent.id,
                  idempotencyKey,
                  requestDigest
                }
              });
              return { baseEvent };
            });
            if (Object.hasOwn(reservation, "status")) return reservation;
            const { baseEvent } = reservation;
            let event;
            let status;
            let body;
            let auditResult;
            let auditDetail;
            try {
              const receipt = await dispatchFinancialRequest(requestPayload);
              event = {
                ...baseEvent,
                status: receipt.status,
                adapterReceipt: receipt,
                adapterReceiptHistory: [],
                providerStatus: receipt.status,
                callbackEvents: [],
                businessDate: String(receipt.acceptedAt || "").slice(0, 10),
                dispatchedAt: receipt.acceptedAt,
                reconciliationStatus: "provider-accepted"
              };
              status = 202;
              body = event;
              auditResult = "allowed";
              auditDetail = `${receipt.receiptId} | ${idempotencyKey} | attempts=${receipt.attempts}`;
            } catch (error) {
              event = {
                ...baseEvent,
                status: "failed",
                deadLetter: true,
                deadLetterReason: "financial gateway provider dispatch failed",
                failureCode: "FINANCIAL_DISPATCH_PROVIDER_REJECTED",
                failedAt: new Date().toISOString(),
                reconciliationStatus: "dead-letter"
              };
              status = 502;
              body = { ok: false, code: "FINANCIAL_DISPATCH_PROVIDER_REJECTED", message: "financial gateway dispatch failed", event };
              auditResult = "failed";
              auditDetail = `${event.id} | ${idempotencyKey} | moved to reconciliation`;
            }
            await withFinancialDispatchStateLock(() => {
              const committedData = readDatabase();
              const reservedIndex = (committedData.integrationGatewayEvents || []).findIndex((item) => item.id === baseEvent.id);
              if (reservedIndex < 0 || committedData.integrationGatewayEvents[reservedIndex].status !== "dispatching") {
                throw new FinancialCallbackError(
                  "financial dispatch reservation is unavailable",
                  "FINANCIAL_DISPATCH_RESERVATION_UNAVAILABLE",
                  409
                );
              }
              committedData.integrationGatewayEvents[reservedIndex] = event;
              committedData.securityEvents = [{
                id: randomUUID(),
                at: new Date().toLocaleString("zh-CN", { hour12: false }),
                actor: user.name,
                role: user.role,
                action: "dispatch financial gateway request",
                target: `${validated.type}/${validated.operation}`,
                result: auditResult,
                detail: auditDetail
              }, ...(Array.isArray(committedData.securityEvents) ? committedData.securityEvents : [])].slice(0, 120);
              writeDatabase(committedData, {
                financialGatewayWrite: {
                  kind: "finalize",
                  eventId: event.id,
                  idempotencyKey,
                  requestDigest
                }
              });
            });
            return { status, body };
          });
          sendJson(res, result.status, result.body);
        } catch (error) {
          const known = error instanceof FinancialCallbackError;
          const versionConflict = String(error?.message || "").includes("SQLite optimistic lock conflict");
          sendJson(res, versionConflict ? 409 : known ? error.statusCode : 500, {
            ok: false,
            code: versionConflict ? "FINANCIAL_DISPATCH_VERSION_CONFLICT" : known ? error.code : "FINANCIAL_DISPATCH_FAILED",
            message: versionConflict
              ? "financial dispatch state changed; retry with a fresh snapshot"
              : known ? error.message : "financial dispatch failed"
          });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "insurance-payment-02",
      domain: "insurance-payment",
      async handle(req, res, url) {
    if (url.pathname === "/api/disease-payment" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const overview = DiseasePaymentService.buildOverview(data.diseasePayment);
        if (user.role === "institution") {
          overview.supervision = DiseasePaymentService.buildDiseaseSupervisionProfiles(data.diseasePayment, { institution: user.orgName });
          overview.summary.supervision = overview.supervision.summary;
        }
        sendJson(res, 200, overview);
        return true;
      }

      if (url.pathname === "/api/disease-payment/supervision/profiles" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, DiseasePaymentService.buildDiseaseSupervisionProfiles(data.diseasePayment, {
          institution: user.role === "institution" ? user.orgName : url.searchParams.get("institution"),
          residentId: url.searchParams.get("residentId"),
          diseaseCode: url.searchParams.get("diseaseCode"),
          riskCode: url.searchParams.get("riskCode"),
          repeatWindowDays: url.searchParams.get("repeatWindowDays"),
          limit: url.searchParams.get("limit")
        }));
        return true;
      }

      if (url.pathname === "/api/disease-payment/drg/catalog" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, DiseasePaymentService.buildDrgCatalogView(data.diseasePayment));
        return true;
      }

      if (url.pathname === "/api/disease-payment/drg/analytics" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, DiseasePaymentService.buildDrgAnalytics(data.diseasePayment));
        return true;
      }

      if (url.pathname === "/api/disease-payment/drg/simulate" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.simulateDrgCase(data.diseasePayment, await collectJson(req));
        sendJson(res, 200, result);
        return true;
      }

      if (url.pathname === "/api/disease-payment/parameters" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, DiseasePaymentService.buildParameterGovernanceView(readDatabase().diseasePayment));
        return true;
      }

      if (url.pathname === "/api/disease-payment/parameters" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.createPaymentParameter(data.diseasePayment, await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 201, result.row);
        return true;
      }

      if (url.pathname === "/api/disease-payment/local-packages" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, DiseasePaymentService.buildLocalPaymentPackageView(readDatabase().diseasePayment));
        return true;
      }

      if (url.pathname === "/api/disease-payment/local-packages/simulation-jobs" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, DiseasePaymentService.buildLocalPaymentPackageView(readDatabase().diseasePayment).simulationJobs);
        return true;
      }

      const diseasePaymentLocalSimulationCreateMatch = url.pathname.match(/^\/api\/disease-payment\/local-packages\/([^/]+)\/simulation-jobs$/);
      if (diseasePaymentLocalSimulationCreateMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        try {
          const result = DiseasePaymentService.createLocalPaymentPackageSimulationJob(data.diseasePayment, decodeURIComponent(diseasePaymentLocalSimulationCreateMatch[1]), await collectJson(req), user.name);
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, result.idempotent ? 200 : 201, { job: result.job, diffReport: result.diffReport, idempotent: result.idempotent });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      const diseasePaymentLocalSimulationActionMatch = url.pathname.match(/^\/api\/disease-payment\/local-packages\/simulation-jobs\/([^/]+)\/(process|retry|cancel)$/);
      if (diseasePaymentLocalSimulationActionMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const [, encodedJobId, action] = diseasePaymentLocalSimulationActionMatch;
        const jobId = decodeURIComponent(encodedJobId);
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          const handlers = {
            process: () => DiseasePaymentService.processLocalPaymentPackageSimulationJob(data.diseasePayment, jobId, payload, user.name),
            retry: () => DiseasePaymentService.retryLocalPaymentPackageSimulationJob(data.diseasePayment, jobId, user.name),
            cancel: () => DiseasePaymentService.cancelLocalPaymentPackageSimulationJob(data.diseasePayment, jobId, payload, user.name)
          };
          const result = handlers[action]();
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, 200, { job: result.job, impactReport: result.report, package: result.row });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      const diseasePaymentLocalPackageReadMatch = url.pathname.match(/^\/api\/disease-payment\/local-packages\/([^/]+)\/(catalog|diff-report|impact-report)$/);
      if (diseasePaymentLocalPackageReadMatch && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const [, encodedId, resource] = diseasePaymentLocalPackageReadMatch;
        const id = decodeURIComponent(encodedId);
        try {
          const state = readDatabase().diseasePayment;
          const result = resource === "catalog"
            ? DiseasePaymentService.getLocalPaymentPackageCatalogPage(state, id, { page: url.searchParams.get("page"), pageSize: url.searchParams.get("pageSize"), query: url.searchParams.get("query") })
            : DiseasePaymentService.getLocalPaymentPackageReport(state, id, resource === "diff-report" ? "diff" : "impact");
          sendJson(res, 200, result);
        } catch (error) {
          sendJson(res, 404, { error: "Not Found", message: error.message });
        }
        return true;
      }

      if (url.pathname === "/api/disease-payment/local-packages" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        try {
          const result = DiseasePaymentService.importLocalPaymentPackage(data.diseasePayment, await collectJson(req, 30_000_000), user.name, diseasePaymentPackageSignatureOptions());
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, result.replaced ? 200 : 201, { package: result.row, validation: result.validation, replaced: result.replaced });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      if (url.pathname === "/api/disease-payment/local-packages/activate-due" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          const result = DiseasePaymentService.activateDueLocalPaymentPackages(data.diseasePayment, user.name, diseasePaymentPackageSignatureOptions(payload));
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, 200, { activated: result.activated, at: result.at, governance: DiseasePaymentService.buildLocalPaymentPackageView(result.state) });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      const diseasePaymentLocalPackageActionMatch = url.pathname.match(/^\/api\/disease-payment\/local-packages\/([^/]+)\/(compare|simulate|submit|review|publish|activate|rollback)$/);
      if (diseasePaymentLocalPackageActionMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const [, encodedId, action] = diseasePaymentLocalPackageActionMatch;
        const id = decodeURIComponent(encodedId);
        const payload = await collectJson(req);
        const data = readDatabase();
        try {
          const handlers = {
            compare: () => DiseasePaymentService.compareLocalPaymentPackage(data.diseasePayment, id, user.name, payload.baselineId),
            simulate: () => DiseasePaymentService.simulateLocalPaymentPackage(data.diseasePayment, id, user.name),
            submit: () => DiseasePaymentService.submitLocalPaymentPackage(data.diseasePayment, id, user.name),
            review: () => DiseasePaymentService.reviewLocalPaymentPackage(data.diseasePayment, id, payload, user.name),
            publish: () => DiseasePaymentService.publishLocalPaymentPackage(data.diseasePayment, id, user.name, diseasePaymentPackageSignatureOptions(payload)),
            activate: () => DiseasePaymentService.activateLocalPaymentPackage(data.diseasePayment, id, user.name, diseasePaymentPackageSignatureOptions(payload)),
            rollback: () => DiseasePaymentService.rollbackLocalPaymentPackage(data.diseasePayment, id, payload, user.name)
          };
          const result = handlers[action]();
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, 200, { package: result.row, validation: result.validation, impactReport: action === "simulate" ? result.report : undefined, diffReport: result.diffReport || (action === "compare" ? result.report : undefined), approval: result.approval, scheme: result.scheme, parameter: result.parameter, snapshot: result.snapshot, scheduled: result.scheduled });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      const diseasePaymentParameterActionMatch = url.pathname.match(/^\/api\/disease-payment\/parameters\/([^/]+)\/(simulate|submit|review|publish)$/);
      if (diseasePaymentParameterActionMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const [, encodedId, action] = diseasePaymentParameterActionMatch;
        const id = decodeURIComponent(encodedId);
        const payload = await collectJson(req);
        const data = readDatabase();
        const handlers = {
          simulate: () => DiseasePaymentService.simulatePaymentParameter(data.diseasePayment, id, user.name),
          submit: () => DiseasePaymentService.submitPaymentParameter(data.diseasePayment, id, user.name),
          review: () => DiseasePaymentService.reviewPaymentParameter(data.diseasePayment, id, payload, user.name),
          publish: () => DiseasePaymentService.publishPaymentParameter(data.diseasePayment, id, user.name)
        };
        const result = handlers[action]();
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 200, { parameter: result.row, impactReport: result.report, approval: result.approval });
        return true;
      }

      if (url.pathname === "/api/online-payments/refunds" && req.method === "POST") {
        const user = requireApiRole(req, res, ["institution", "commission"], url.pathname);
        if (!user) return true;
        if (!authorizeInsurancePaymentAction("refund.request", user, res, url.pathname)) return true;
        try {
          const payload = await collectJson(req);
          payload.idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
          const result = await InsurancePaymentRefundTransaction.withRefundRequestLock(payload, async () => {
            const currentData = readDatabase();
            const transaction = await InsurancePaymentRefundTransaction.createRefundRequestTransaction(
              currentData,
              payload,
              user,
              { correlationId: req.correlationId }
            );
            writeDatabase(normalizeState(transaction.data));
            return transaction;
          });
          sendJson(res, result.idempotent ? 200 : 201, {
            refund: result.row,
            idempotent: result.idempotent,
            eventContract: {
              id: result.contract.id,
              version: result.contract.version,
              outboxEventId: result.outboxEventId
            },
            productionReady: false
          });
        } catch (error) {
          sendInsurancePaymentError(res, error);
        }
        return true;
      }

      const onlinePaymentRefundActionMatch = url.pathname.match(/^\/api\/online-payments\/refunds\/([^/]+)\/(resubmit|reviews|dispatch|retry|cancel|reconcile|close)$/);
      if (onlinePaymentRefundActionMatch && req.method === "POST") {
        const [, encodedId, action] = onlinePaymentRefundActionMatch;
        const id = decodeURIComponent(encodedId);
        const routeRoles = ["resubmit", "reviews", "cancel"].includes(action)
          ? ["institution", "commission"]
          : ["commission"];
        const user = requireApiRole(req, res, routeRoles, url.pathname);
        if (!user) return true;
        const modelActions = {
          resubmit: "refund.resubmit",
          reviews: "refund.review",
          reconcile: "refund.reconcile-close",
          close: "refund.reconcile-close"
        };
        if (modelActions[action] && !authorizeInsurancePaymentAction(modelActions[action], user, res, url.pathname)) return true;
        const data = readDatabase();
        try {
          const scopedRefund = (Array.isArray(data.onlinePaymentRefunds) ? data.onlinePaymentRefunds : []).find((item) => item.id === id);
          if (user.role === "institution"
            && (!scopedRefund?.organizationId || scopedRefund.organizationId !== user.orgCode)) {
            sendJson(res, 403, {
              error: "Forbidden",
              code: "REFUND_ORGANIZATION_SCOPE_DENIED",
              message: "refund belongs to another organization or lacks a trusted organization binding"
            });
            return true;
          }
          const payload = await collectJson(req);
          const headerIdempotencyKey = String(req.headers["idempotency-key"] || "").trim();
          if (headerIdempotencyKey) payload.idempotencyKey = headerIdempotencyKey;
          if (action === "reviews") payload.role = user.role;
          let result;
          let persistedInFinancialCommand = false;
          if (action === "resubmit") {
            result = OnlinePaymentRefunds.resubmitRejectedRefund(data, id, payload, user);
          } else if (action === "reviews") {
            result = OnlinePaymentRefunds.reviewRefundRequest(data, id, payload, user);
          } else if (action === "retry") {
            result = OnlinePaymentRefunds.retryRefund(data, id, payload, user);
          } else if (action === "cancel") {
            result = OnlinePaymentRefunds.cancelRefund(data, id, payload, user);
          } else if (action === "reconcile") {
            result = OnlinePaymentRefunds.reconcileRefund(data, id, payload, user);
          } else if (action === "close") {
            result = OnlinePaymentRefunds.closeRefund(data, id, payload, user);
          } else {
            const priorGatewayEvent = (data.integrationGatewayEvents || []).find((item) =>
              item.adapterType === "financial"
              && item.gatewayType === "PAYMENT"
              && item.operation === "refund"
              && item.externalId === id
              && item.requestPayload
            );
            const requestPayload = priorGatewayEvent?.requestPayload || OnlinePaymentRefunds.prepareRefundDispatch(data, id);
            const idempotencyKey = String(requestPayload.idempotencyKey || "").trim();
            const requestDigest = financialDispatchRequestDigest(requestPayload);
            result = await withFinancialDispatchLock(idempotencyKey, async () => {
              const reserved = await withFinancialDispatchStateLock(() => {
                const reservationData = readDatabase();
                const duplicate = (reservationData.integrationGatewayEvents || []).find((item) =>
                  item.adapterType === "financial"
                  && item.gatewayType === "PAYMENT"
                  && item.operation === "refund"
                  && item.idempotencyKey === idempotencyKey
                );
                if (duplicate) {
                  if (financialDispatchRequestDigest(duplicate.requestPayload) !== requestDigest) {
                    throw new FinancialCallbackError(
                      "refund dispatch idempotency key is bound to another request",
                      "REFUND_DISPATCH_IDEMPOTENCY_CONFLICT",
                      409
                    );
                  }
                  if (["dispatching", "retrying"].includes(duplicate.status)) {
                    return {
                      complete: {
                        row: reservationData.onlinePaymentRefunds.find((item) => item.id === id),
                        gatewayEventId: duplicate.id,
                        idempotent: true,
                        pending: true
                      }
                    };
                  }
                  if (duplicate.deadLetter || duplicate.status === "failed" || !duplicate.adapterReceipt) {
                    throw new FinancialCallbackError(
                      "refund gateway dispatch requires reconciliation",
                      "REFUND_DISPATCH_RECONCILIATION_REQUIRED",
                      409
                    );
                  }
                  const refund = reservationData.onlinePaymentRefunds.find((item) => item.id === id);
                  if (!refund) {
                    throw new FinancialCallbackError("refund not found", "REFUND_NOT_FOUND", 404);
                  }
                  if (refund.state === "APPROVED") {
                    const replay = OnlinePaymentRefunds.recordRefundDispatch(
                      reservationData,
                      id,
                      duplicate.adapterReceipt,
                      duplicate.id,
                      user
                    );
                    writeDatabase(reservationData);
                    return { complete: { ...replay, gatewayEventId: duplicate.id, idempotent: true } };
                  }
                  return { complete: { row: refund, gatewayEventId: duplicate.id, idempotent: true } };
                }
                const currentRequest = OnlinePaymentRefunds.prepareRefundDispatch(reservationData, id);
                if (financialDispatchRequestDigest(currentRequest) !== requestDigest) {
                  throw new FinancialCallbackError(
                    "refund dispatch state changed before reservation",
                    "REFUND_DISPATCH_STATE_CONFLICT",
                    409
                  );
                }
                const baseEvent = {
                  id: `igw-${randomUUID()}`,
                  direction: "outbound",
                  adapterType: "financial",
                  gatewayType: "PAYMENT",
                  operation: "refund",
                  contractId: requestPayload.contractId,
                  domain: "PAYMENT",
                  resource: "FinancialGatewayRequest",
                  idempotencyKey,
                  externalId: id,
                  residentId: "",
                  status: "dispatching",
                  signatureVerified: false,
                  outboundSigned: true,
                  receivedBy: user.username || user.role,
                  capacityScope: user.orgCode
                    ? `institution:${String(user.orgCode).trim()}`
                    : `principal:${String(user.username || user.role).trim()}`,
                  requestPayload,
                  payload: requestPayload.payload,
                  retryCount: 0,
                  deadLetter: false,
                  reconciliationStatus: "dispatching",
                  receivedAt: new Date().toISOString()
                };
                reservationData.integrationGatewayEvents = [baseEvent, ...(reservationData.integrationGatewayEvents || [])].slice(0, 200);
                writeDatabase(reservationData, {
                  financialGatewayWrite: { kind: "reserve", eventId: baseEvent.id, idempotencyKey, requestDigest }
                });
                return { baseEvent };
              });
              if (reserved.complete) return reserved.complete;

              let receipt;
              try {
                receipt = await dispatchFinancialRequest(requestPayload);
              } catch {
                await withFinancialDispatchStateLock(() => {
                  const failedData = readDatabase();
                  const failedIndex = (failedData.integrationGatewayEvents || []).findIndex((item) => item.id === reserved.baseEvent.id);
                  if (failedIndex < 0 || failedData.integrationGatewayEvents[failedIndex].status !== "dispatching") return;
                  failedData.integrationGatewayEvents[failedIndex] = {
                    ...reserved.baseEvent,
                    status: "failed",
                    deadLetter: true,
                    deadLetterReason: "financial gateway refund dispatch failed",
                    failureCode: "REFUND_DISPATCH_PROVIDER_REJECTED",
                    reconciliationStatus: "dead-letter",
                    failedAt: new Date().toISOString()
                  };
                  failedData.securityEvents = prependAuditTrailEntry(failedData.securityEvents, {
                    id: randomUUID(),
                    at: new Date().toLocaleString("zh-CN", { hour12: false }),
                    actor: user.name,
                    role: user.role,
                    action: "dispatch online payment refund",
                    target: id,
                    result: "failed",
                    detail: `${reserved.baseEvent.id} · ${idempotencyKey} · moved-to-reconciliation`
                  });
                  writeDatabase(failedData, {
                    financialGatewayWrite: { kind: "finalize", eventId: reserved.baseEvent.id, idempotencyKey, requestDigest }
                  });
                });
                throw new FinancialCallbackError(
                  "refund gateway dispatch failed",
                  "REFUND_DISPATCH_PROVIDER_REJECTED",
                  502
                );
              }
              return withFinancialDispatchStateLock(() => {
                const finalData = readDatabase();
                const finalIndex = (finalData.integrationGatewayEvents || []).findIndex((item) => item.id === reserved.baseEvent.id);
                if (finalIndex < 0 || finalData.integrationGatewayEvents[finalIndex].status !== "dispatching") {
                  throw new FinancialCallbackError(
                    "refund dispatch reservation is unavailable",
                    "REFUND_DISPATCH_RESERVATION_UNAVAILABLE",
                    409
                  );
                }
                const event = {
                  ...reserved.baseEvent,
                  status: receipt.status,
                  reconciliationStatus: "provider-accepted",
                  adapterReceipt: receipt,
                  adapterReceiptHistory: [],
                  providerStatus: receipt.status,
                  callbackEvents: [],
                  businessDate: String(receipt.acceptedAt || "").slice(0, 10),
                  dispatchedAt: receipt.acceptedAt
                };
                finalData.integrationGatewayEvents[finalIndex] = event;
                const recorded = OnlinePaymentRefunds.recordRefundDispatch(finalData, id, receipt, event.id, user);
                writeDatabase(finalData, {
                  financialGatewayWrite: { kind: "finalize", eventId: event.id, idempotencyKey, requestDigest }
                });
                return { ...recorded, gatewayEventId: event.id, idempotent: false };
              });
            });
            persistedInFinancialCommand = true;
          }
          if (!persistedInFinancialCommand) writeDatabase({ ...normalizeState(data), storageMeta: data.storageMeta });
          sendJson(res, action === "dispatch" ? 202 : 200, {
            refund: InsurancePaymentRefundTransaction.publicRefund(result.row),
            review: result.review,
            resubmission: result.resubmission,
            gatewayEventId: result.gatewayEventId,
            idempotent: result.idempotent === true,
            productionReady: false
          });
        } catch (error) {
          if (action === "dispatch" && !(error instanceof FinancialCallbackError)) {
            const versionConflict = String(error?.message || "").includes("SQLite optimistic lock conflict");
            sendJson(res, versionConflict ? 409 : 500, {
              error: versionConflict ? "Conflict" : "Service Unavailable",
              code: versionConflict ? "REFUND_DISPATCH_VERSION_CONFLICT" : "REFUND_DISPATCH_STORAGE_FAILED",
              message: versionConflict
                ? "refund dispatch state changed; retry with a fresh snapshot"
                : "refund dispatch storage failed"
            });
          } else {
            sendInsurancePaymentError(res, error);
          }
        }
        return true;
      }

      if (url.pathname === "/api/disease-payment/formal-grouping/operations" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        if (!authorizeInsurancePaymentAction("formal-grouping.operations.read", user, res, url.pathname)) return true;
        const state = DiseasePaymentService.normalizeState(readDatabase().diseasePayment);
        sendJson(res, 200, DiseasePaymentIntake.buildFormalGroupingOperations(state));
        return true;
      }

      if (url.pathname === "/api/disease-payment/formal-grouping/jobs" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        if (!authorizeInsurancePaymentAction("formal-grouping.create", user, res, url.pathname)) return true;
        const data = readDatabase();
        try {
          const result = DiseasePaymentIntake.createFormalGroupingJob(DiseasePaymentService.normalizeState(data.diseasePayment), await collectJson(req), user.name);
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, result.idempotent ? 200 : 201, { job: result.job, envelope: result.envelope, idempotent: result.idempotent });
        } catch (error) {
          sendJson(res, 409, { error: "Conflict", message: error.message });
        }
        return true;
      }

      const diseasePaymentFormalGroupingActionMatch = url.pathname.match(/^\/api\/disease-payment\/formal-grouping\/jobs\/([^/]+)\/(dispatch|receipts|fail|retry|reconcile)$/);
      if (diseasePaymentFormalGroupingActionMatch && req.method === "POST") {
        const [, encodedId, action] = diseasePaymentFormalGroupingActionMatch;
        const id = decodeURIComponent(encodedId);
        const payload = await collectJson(req);
        const data = readDatabase();
        const state = DiseasePaymentService.normalizeState(data.diseasePayment);
        try {
          let result;
          if (action === "receipts") {
            const grouperConfiguration = DiseasePaymentGrouperContract.buildGrouperProductionConfiguration(process.env);
            if (String(process.env.NODE_ENV || "").toLowerCase() === "production" && !grouperConfiguration.configured) {
              sendJson(res, 503, {
                error: "Service Unavailable",
                code: "GROUPER_PRODUCTION_CONFIGURATION_INVALID",
                message: "official grouper callback verification is not fully configured"
              });
              return true;
            }
            const trustedActor = {
              name: "official-grouper-adapter",
              username: "official-grouper-adapter",
              role: "system",
              orgType: "official_grouper_adapter",
              orgCode: "official_grouper_adapter"
            };
            if (!authorizeInsurancePaymentAction("formal-grouping.receipt", trustedActor, res, url.pathname)) return true;
            // receiveTrustedFormalGroupingReceipt invokes
            // DiseasePaymentGrouperContract.verifyTrustedGrouperCallback before any state write.
            result = DiseasePaymentIntake.receiveTrustedFormalGroupingReceipt(
              state,
              id,
              payload,
              {
                env: process.env,
                timestamp: req.headers["x-grouper-timestamp"],
                nonce: req.headers["x-grouper-nonce"],
                sourceId: req.headers["x-grouper-source"],
                signature: req.headers["x-grouper-signature"],
                nowMs: Date.now()
              },
              DiseasePaymentService.calculateCase
            );
          } else if (action === "dispatch" || action === "fail") {
            const modelAction = action === "dispatch" ? "formal-grouping.dispatch" : "formal-grouping.fail";
            const systemActor = requireInsuranceSystemCommand(
              req,
              res,
              payload,
              modelAction,
              action === "fail" ? "platform" : "official_grouper_adapter",
              `${url.pathname}:${id}`
            );
            if (!systemActor) return true;
            if (action === "dispatch") {
              if (!authorizeInsurancePaymentAction("formal-grouping.dispatch", systemActor, res, url.pathname)) return true;
              result = DiseasePaymentIntake.dispatchFormalGroupingJob(state, id, payload, systemActor.username);
            } else {
              if (!authorizeInsurancePaymentAction("formal-grouping.fail", systemActor, res, url.pathname)) return true;
              result = DiseasePaymentIntake.failFormalGroupingJob(state, id, payload, systemActor.username);
            }
          } else {
            const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
            if (!user) return true;
            if (action === "retry") {
              if (!authorizeInsurancePaymentAction("formal-grouping.retry", user, res, url.pathname)) return true;
              result = DiseasePaymentIntake.retryFormalGroupingJob(state, id, user.name);
            } else {
              if (!authorizeInsurancePaymentAction("formal-grouping.reconcile", user, res, url.pathname)) return true;
              result = DiseasePaymentIntake.reconcileFormalGroupingDeadLetter(state, id, payload, user.name);
            }
          }
          data.diseasePayment = result.state;
          writeDatabase(data);
          sendJson(res, 200, { job: result.job, envelope: result.envelope, groupingRun: result.run, deadLetter: result.deadLetter, receiptErrors: result.receiptErrors || [], idempotent: result.idempotent || false, operations: DiseasePaymentIntake.buildFormalGroupingOperations(result.state) });
        } catch (error) {
          sendInsurancePaymentError(res, error);
        }
        return true;
      }

      if (url.pathname === "/api/disease-payment/calculate" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const current = DiseasePaymentService.normalizeState(data.diseasePayment);
        if (["DRG", "DIP"].includes(payload.mode)) current.mode = payload.mode;
        data.diseasePayment = DiseasePaymentService.calculateAll(current, user.name);
        writeDatabase(data);
        const overview = DiseasePaymentService.buildOverview(data.diseasePayment);
        if (user.role === "institution") {
          overview.supervision = DiseasePaymentService.buildDiseaseSupervisionProfiles(data.diseasePayment, { institution: user.orgName });
          overview.summary.supervision = overview.supervision.summary;
        }
        sendJson(res, 200, overview);
        return true;
      }

      if (url.pathname === "/api/disease-payment/special-cases" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.createSpecialCase(data.diseasePayment, await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 201, result.row);
        return true;
      }

      if (url.pathname === "/api/disease-payment/special-cases/disclosure" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, {
          ...DiseasePaymentService.buildSpecialCaseDisclosure(readDatabase().diseasePayment),
          productionReady: false
        });
        return true;
      }

      const diseasePaymentSpecialCaseCommandMatch = url.pathname.match(/^\/api\/disease-payment\/special-cases\/([^/]+)\/(expert-reselection|appeals|appeals\/review)$/);
      if (diseasePaymentSpecialCaseCommandMatch && req.method === "POST") {
        const [, encodedId, action] = diseasePaymentSpecialCaseCommandMatch;
        const id = decodeURIComponent(encodedId);
        const requiredRoles = action === "appeals" ? ["institution"] : ["insurance"];
        const user = requireApiRole(req, res, requiredRoles, url.pathname);
        if (!user) return true;
        const modelAction = action === "appeals"
          ? "special-case.appeal"
          : action === "appeals/review"
            ? "special-case.review-appeal"
            : "special-case.review-medical";
        if (!authorizeInsurancePaymentAction(modelAction, user, res, url.pathname)) return true;
        const data = readDatabase();
        try {
          const payload = await collectJson(req);
          payload.idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
          const result = action === "appeals"
            ? DiseasePaymentService.createSpecialCaseAppeal(data.diseasePayment, id, payload, user.name)
            : action === "appeals/review"
              ? DiseasePaymentService.reviewSpecialCaseAppeal(data.diseasePayment, id, payload, user.name)
              : DiseasePaymentService.reselectSpecialCaseExpert(data.diseasePayment, id, payload, user.name);
          data.diseasePayment = result.state;
          writeDatabase(normalizeState(data));
          sendJson(res, action === "appeals" ? 201 : 200, {
            specialCase: result.row,
            appeal: result.appeal,
            panel: result.panel,
            review: result.review,
            productionReady: false
          });
        } catch (error) {
          sendInsurancePaymentError(res, error);
        }
        return true;
      }

      const diseasePaymentSpecialReviewMatch = url.pathname.match(/^\/api\/disease-payment\/special-cases\/([^/]+)\/review$/);
      if (diseasePaymentSpecialReviewMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.reviewSpecialCase(data.diseasePayment, decodeURIComponent(diseasePaymentSpecialReviewMatch[1]), await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 200, result.row);
        return true;
      }

      if (url.pathname === "/api/disease-payment/settlements" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.createSettlementBatch(data.diseasePayment, await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 201, result.batch);
        return true;
      }

      if (url.pathname === "/api/disease-payment/annual-clearances" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        try {
          const payload = await collectJson(req);
          const result = DiseasePaymentService.createAnnualClearance(data.diseasePayment, payload, user.name);
          data.diseasePayment = result.state;
          writeDatabase(normalizeState(data));
          sendJson(res, 201, { clearance: result.row, productionReady: false });
        } catch (error) {
          sendInsurancePaymentError(res, error);
        }
        return true;
      }

      const diseasePaymentAnnualClearanceActionMatch = url.pathname.match(/^\/api\/disease-payment\/annual-clearances\/([^/]+)\/actions$/);
      if (diseasePaymentAnnualClearanceActionMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "institution", "commission"], url.pathname);
        if (!user) return true;
        const id = decodeURIComponent(diseasePaymentAnnualClearanceActionMatch[1]);
        const payload = await collectJson(req);
        const action = String(payload.action || "").trim();
        const institutionActions = new Set(["confirm-institution", "record-dispute"]);
        const insuranceActions = new Set(["start-confirmation", "resolve-dispute", "confirm-institutions", "approve"]);
        if (institutionActions.has(action) && user.role !== "institution") {
          sendJson(res, 403, { error: "Forbidden", code: "ANNUAL_CLEARANCE_INSTITUTION_ROLE_REQUIRED", message: "institution action requires an institution actor" });
          return true;
        }
        if (insuranceActions.has(action) && user.role !== "insurance") {
          sendJson(res, 403, { error: "Forbidden", code: "ANNUAL_CLEARANCE_INSURANCE_ROLE_REQUIRED", message: "insurance action requires an insurance actor" });
          return true;
        }
        if (["post", "lock"].includes(action)) {
          sendJson(res, 403, {
            error: "Forbidden",
            code: "ANNUAL_CLEARANCE_TRUSTED_FINANCE_ACTOR_REQUIRED",
            message: "posting and locking require a trusted fund-finance identity that is not available in the shared directory"
          });
          return true;
        }
        if (![...institutionActions, ...insuranceActions].includes(action)) {
          sendJson(res, 400, { error: "Bad Request", code: "ANNUAL_CLEARANCE_ACTION_INVALID", message: "annual clearance action is not supported" });
          return true;
        }
        if (institutionActions.has(action)) payload.institutionId = user.orgCode;
        payload.idempotencyKey = String(req.headers["idempotency-key"] || payload.idempotencyKey || "").trim();
        const data = readDatabase();
        try {
          const result = DiseasePaymentService.applyAnnualClearanceAction(data.diseasePayment, id, payload, user.name);
          data.diseasePayment = result.state;
          writeDatabase(normalizeState(data));
          sendJson(res, 200, {
            clearance: result.row,
            idempotent: result.idempotent === true,
            productionReady: false
          });
        } catch (error) {
          sendInsurancePaymentError(res, error);
        }
        return true;
      }

      const diseasePaymentReconcileMatch = url.pathname.match(/^\/api\/disease-payment\/settlements\/([^/]+)\/reconcile$/);
      if (diseasePaymentReconcileMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.reconcileBatch(data.diseasePayment, decodeURIComponent(diseasePaymentReconcileMatch[1]), await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 200, result.batch);
        return true;
      }

      if (url.pathname === "/api/disease-payment/feedbacks" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const state = DiseasePaymentService.normalizeState(data.diseasePayment);
        const row = { id: `feedback-${Date.now()}`, category: String(payload.category || "分组方案"), content: String(payload.content || "").trim(), institution: user.orgName, status: "待反馈", submittedBy: user.name, submittedAt: new Date().toISOString() };
        if (!row.content) { sendJson(res, 400, { error: "反馈内容不能为空" }); return true; }
        state.feedbacks.unshift(row);
        data.diseasePayment = state;
        writeDatabase(data);
        sendJson(res, 201, row);
        return true;
      }

      if (url.pathname === "/api/disease-payment/intake/imports" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const state = DiseasePaymentService.normalizeState(data.diseasePayment);
        const result = DiseasePaymentIntake.importBatch(state, payload, user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 201, result.report);
        return true;
      }

      const diseasePaymentImportRetryMatch = url.pathname.match(/^\/api\/disease-payment\/intake\/retries\/([^/]+)$/);
      if (diseasePaymentImportRetryMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentIntake.retryImport(DiseasePaymentService.normalizeState(data.diseasePayment), decodeURIComponent(diseasePaymentImportRetryMatch[1]), await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 200, { retry: result.retry, report: result.report, idempotent: result.idempotent || false });
        return true;
      }

      if (url.pathname === "/api/disease-payment/grouping-runs" && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentIntake.runGrouping(DiseasePaymentService.normalizeState(data.diseasePayment), await collectJson(req), user.name, DiseasePaymentService.calculateCase);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 201, result.run);
        return true;
      }

      if (url.pathname === "/api/disease-payment/intake/errors" && req.method === "GET") {
        const user = requireApiRole(req, res, ["insurance", "commission", "institution"], url.pathname);
        if (!user) return true;
        const state = DiseasePaymentIntake.ensureIntakeState(DiseasePaymentService.normalizeState(readDatabase().diseasePayment));
        sendJson(res, 200, { rows: state.importRetryQueue, summary: DiseasePaymentIntake.buildIntakeSummary(state) });
        return true;
      }

      const diseasePaymentGovernanceMatch = url.pathname.match(/^\/api\/disease-payment\/governance\/(prepayments|unpaid|negotiations|trainings)\/([^/]+)$/);
      if (diseasePaymentGovernanceMatch && req.method === "POST") {
        const user = requireApiRole(req, res, ["insurance", "commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        const result = DiseasePaymentService.applyGovernanceAction(data.diseasePayment, diseasePaymentGovernanceMatch[1], decodeURIComponent(diseasePaymentGovernanceMatch[2]), await collectJson(req), user.name);
        data.diseasePayment = result.state;
        writeDatabase(data);
        sendJson(res, 200, result.row);
        return true;
      }
        return false;
      }
    },
    {
      id: "insurance-payment-03",
      domain: "insurance-payment",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/insurance-claims/")) {
        const user = requireApiRole(req, res, ["insurance", "commission"], "/api/insurance-claims/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "insuranceClaims",
          id: decodeURIComponent(url.pathname.replace("/api/insurance-claims/", "")),
          patch: await collectJson(req),
          user,
          action: "更新医保理赔"
        });
        sendJson(res, result.status, result.body);
        return true;
      }

      if (req.method === "PATCH" && url.pathname.startsWith("/api/medication-pickups/")) {
        const user = requireApiRole(req, res, ["institution", "insurance", "commission"], "/api/medication-pickups/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "medicationPickups",
          id: decodeURIComponent(url.pathname.replace("/api/medication-pickups/", "")),
          patch: await collectJson(req),
          user,
          action: "更新固定取药"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
    {
      id: "insurance-payment-04",
      domain: "insurance-payment",
      async handle(req, res, url) {
    if (req.method === "PATCH" && url.pathname.startsWith("/api/digital-credentials/")) {
        const user = requireApiRole(req, res, ["insurance", "commission"], "/api/digital-credentials/:id");
        if (!user) return true;
        const result = patchBusinessCollectionItem({
          data: readDatabase(),
          collection: "digitalCredentials",
          id: decodeURIComponent(url.pathname.replace("/api/digital-credentials/", "")),
          patch: await collectJson(req),
          user,
          action: "更新数字健康凭证"
        });
        sendJson(res, result.status, result.body);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
