"use strict";

function createRouteSegments(runtime) {
  const { PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_CLIENT_FIELDS, PUBLIC_HEALTH_SITE_EVIDENCE_LINKS, RESPIRATORY_PANEL, activatePublicHealthSurveillanceRuleChangeToState, appendPublicHealthEndpointProbeCampaignAudit, appendSecurityEvent, applyPublicHealthCoordinationActionToState, applyPublicHealthMedicalPreventionTaskActionToState, applyPublicHealthSurveillanceAlertActionToState, assertPublicHealthOfficialExchangeCallbackPayload, assertPublicHealthRespiratoryNetworkEvidencePayload, assertPublicHealthRespiratoryPayload, assertPublicHealthRuleChangePayload, assertPublicHealthSurveillanceModelPayload, buildPublicHealthCoordinationRuntime, buildPublicHealthCutoverReadiness, buildPublicHealthDataFoundation, buildPublicHealthEndpointProbeCampaignSummary, buildPublicHealthEndpointVerificationSummary, buildPublicHealthExternalContractCutoverBoard, buildPublicHealthExternalOperationsBoard, buildPublicHealthHighlights, buildPublicHealthKeySafetyBoard, buildPublicHealthMedicalPreventionBoard, buildPublicHealthSiteEvidenceBridge, buildPublicHealthSystem, canAccessResident, claimPublicHealthExternalDispatchToState, collectJson, contractAttestationUniqueKey, createHash, enqueuePublicHealthExternalDispatchToState, evaluatePublicHealthSurveillanceSignalToState, ingestPublicHealthRespiratoryPathogenBatchToState, ingestPublicHealthSurveillanceSignalToState, issueTrustedRespiratoryNetworkEvidenceReceipt, listDuePublicHealthExternalDispatches, loadAvailablePublicHealthCredentialMap, loadPublicHealthLaneCredentials, mergeByKey, normalizeBirthCertificate, normalizeDeathCertificate, normalizePublicHealthAiReviewAction, normalizePublicHealthCommandTaskAction, normalizePublicHealthCutoverBlockerAction, normalizePublicHealthCutoverDrillAction, normalizePublicHealthCutoverEvidencePacketAction, normalizePublicHealthEventAction, normalizePublicHealthEvidenceAction, normalizePublicHealthExchangeExceptionAction, normalizePublicHealthExchangeRun, normalizePublicHealthGoLiveObservationAction, normalizePublicHealthHighlightAlertAction, normalizePublicHealthInstitutionTaskAction, normalizePublicHealthLaunchCommandBriefAction, normalizePublicHealthLaunchDutyShiftAction, normalizePublicHealthLaunchGateAction, normalizePublicHealthLaunchIncidentAction, normalizePublicHealthOnsiteAcceptanceAction, normalizePublicHealthProductionHandoffAction, normalizePublicHealthSignal, normalizePublicHealthSiteEvidenceVerificationTaskAction, normalizePublicHealthStandardImplementationAction, normalizeState, prependAuditTrailEntry, proposePublicHealthSurveillanceRuleChangeToState, publicHealthContractAttestationRequestDigest, publicHealthContractGovernanceAuditEvent, publicHealthContractGovernanceContext, publicHealthCredentialsForDispatch, publicHealthEndpointProbeCampaignAuditEntry, publicHealthEndpointProbeCampaignHttpStatus, publicHealthEndpointProbeCampaignSafeCode, publicHealthEndpointProbeHttpStatus, publicHealthEndpointProbeSafeCode, publicHealthEndpointVerificationContext, publicHealthExternalAttemptOptions, publicHealthExternalHttpStatus, publicHealthExternalLaneVersion, publicHealthExternalPublicView, publicHealthExternalResult, publicHealthExternalWorkerId, publicHealthModernizationCommand, publicHealthModernizationConflict, publicHealthModernizationError, publicHealthOfficialExchangeCallbackError, publicHealthOfficialExchangeReceiptOptions, publicHealthRespiratoryNetworkEvidenceActor, publicHealthRespiratoryNetworkEvidenceAuditDigest, publicHealthRespiratoryNetworkEvidenceOptions, publicHealthRespiratoryNetworkEvidenceRequestFingerprint, publicHealthRespiratoryPathogenActor, publicHealthSafeAlert, publicHealthSafeDataSourceOperations, publicHealthSafeMedicalPreventionTask, publicHealthSafeOfficialExchangeReceipt, publicHealthSafeRespiratoryNetworkReadiness, publicHealthSafeRespiratoryPathogenBatch, publicHealthSafeRespiratoryPathogenSurveillance, publicHealthSafeRuleGovernance, publicHealthSafeSignal, publicHealthSafeSurveillanceCenter, publicHealthSafeSurveillanceModelGovernance, publicHealthSurveillanceModelActor, publicHealthSurveillanceRuleActivationOptions, publishPublicHealthRespiratoryPathogenSignalsToState, randomUUID, readDatabase, recordClaimedPublicHealthExternalAttemptToState, recordPublicHealthExternalAttemptToState, recordPublicHealthOfficialExchangeCallback, redactSensitiveResponse, refreshBirthStatistics, refreshDeathStatistics, requestPublicHealthRespiratoryNetworkLifecycle, requeuePublicHealthExternalDeadLetterToState, requireApiRole, requirePublicHealthOfficialExchangeCallback, reviewPublicHealthRespiratoryNetworkLifecycle, reviewPublicHealthSurveillanceModelValidationToState, reviewPublicHealthSurveillanceRuleChangeToState, runControlledPublicHealthEndpointProbe, runControlledPublicHealthEndpointProbeCampaign, runPublicHealthSurveillanceModelToState, sealAuditTrail, seedPublicHealthAiReviews, seedPublicHealthAlerts, seedPublicHealthCommandTasks, seedPublicHealthCutoverBlockers, seedPublicHealthCutoverDrills, seedPublicHealthCutoverEvidencePackets, seedPublicHealthEvents, seedPublicHealthEvidenceRecords, seedPublicHealthExchangeRuns, seedPublicHealthExchangeTasks, seedPublicHealthGoLiveObservations, seedPublicHealthInstitutionTasks, seedPublicHealthLaunchApprovals, seedPublicHealthLaunchCommandBriefs, seedPublicHealthLaunchDutyShifts, seedPublicHealthLaunchIncidents, seedPublicHealthOnsiteAcceptances, seedPublicHealthProductionHandoffs, seedPublicHealthReadinessEvidence, seedPublicHealthSignals, seedPublicHealthSiteEvidenceVerificationTasks, seedPublicHealthStandardImplementationLedger, sendJson, signTrustedPublicHealthContractAttestation, submitPublicHealthSurveillanceModelValidationToState, upsertSiteLaunchEvidence, verifyPublicHealthExternalEndpointProbeReceipt, verifyPublicHealthRespiratoryPathogenBatchToState, verifyPublicHealthSurveillanceSignalToState, verifyTrustedRespiratoryNetworkEvidence, writeDatabase } = runtime;
  return [
    {
      id: "public-health-01",
      domain: "public-health",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/public-health/data-foundation") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, buildPublicHealthDataFoundation({ data: readDatabase() }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/data-source-operations") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health data source operations query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN";
            throw error;
          }
          sendJson(res, 200, publicHealthSafeDataSourceOperations(readDatabase()));
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/surveillance-rule-governance") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health rule governance query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN";
            throw error;
          }
          sendJson(res, 200, publicHealthSafeRuleGovernance(readDatabase()));
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/surveillance-model-governance") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health surveillance model governance query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN";
            throw error;
          }
          sendJson(res, 200, publicHealthSafeSurveillanceModelGovernance(readDatabase()));
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/respiratory-network-readiness") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health respiratory network readiness query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN";
            throw error;
          }
          sendJson(res, 200, publicHealthSafeRespiratoryNetworkReadiness(readDatabase(), user));
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthRespiratoryNetworkEvidenceActionMatch = url.pathname
        .match(/^\/api\/public-health\/respiratory-network-evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthRespiratoryNetworkEvidenceActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/respiratory-network-evidence/:id/actions"
        );
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health respiratory network evidence query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN";
            throw error;
          }
          const evidenceId = decodeURIComponent(publicHealthRespiratoryNetworkEvidenceActionMatch[1]);
          if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,159}$/.test(evidenceId)) {
            const error = new Error("public health respiratory network evidence id is invalid");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN";
            throw error;
          }
          const clientBody = await collectJson(req);
          if (!clientBody
            || typeof clientBody !== "object"
            || Array.isArray(clientBody)
            || Object.keys(clientBody).some((key) =>
              !PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_CLIENT_FIELDS.has(key))) {
            const error = new Error("public health respiratory network evidence client override is forbidden");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_PAYLOAD_FORBIDDEN";
            throw error;
          }
          const rawCommand = publicHealthModernizationCommand(
            req,
            url,
            clientBody,
            { insert: clientBody.action === "issue-trusted-evidence" }
          );
          const command = {
            ...rawCommand,
            ...(rawCommand.receivedAt ? { at: rawCommand.receivedAt } : {})
          };
          delete command.receivedAt;
          assertPublicHealthRespiratoryNetworkEvidencePayload(command);
          const actor = publicHealthRespiratoryNetworkEvidenceActor(user);
          const data = readDatabase();
          if (String(command.action || "").startsWith("request-")) {
            const result = requestPublicHealthRespiratoryNetworkLifecycle({
              data,
              evidenceId,
              command,
              actor,
              user
            });
            sendJson(res, result.statusCode, result.body);
            return true;
          }
          if (["approve-lifecycle", "reject-lifecycle"].includes(command.action)) {
            const result = reviewPublicHealthRespiratoryNetworkLifecycle({
              data,
              evidenceId,
              command,
              actor,
              user
            });
            sendJson(res, result.statusCode, result.body);
            return true;
          }
          const signing = publicHealthRespiratoryNetworkEvidenceOptions({ required: true });
          const idempotencyKeyHash = createHash("sha256")
            .update(command.idempotencyKey)
            .digest("hex");
          const requestFingerprint = publicHealthRespiratoryNetworkEvidenceRequestFingerprint(
            evidenceId,
            command
          );
          const existing = (data.publicHealthRespiratoryNetworkEvidence || [])
            .find((item) => String(item?.id || "").trim() === evidenceId);
          const existingAudit = (data.publicHealthRespiratoryNetworkEvidenceAudit || [])
            .find((item) => String(item?.evidenceId || "").trim() === evidenceId);
          if (existing) {
            const verified = verifyTrustedRespiratoryNetworkEvidence(
              existing,
              signing.keyring,
              signing.at
            );
            if (!verified.ok) {
              const error = new Error("respiratory network evidence signature or integrity is untrusted");
              error.code = "PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_INTEGRITY_INVALID";
              throw error;
            }
            if (existingAudit?.idempotencyKeyHash !== idempotencyKeyHash
              || existingAudit?.requestFingerprint !== requestFingerprint) {
              throw publicHealthModernizationConflict(
                "public health respiratory network evidence idempotency conflict"
              );
            }
            const board = publicHealthSafeRespiratoryNetworkReadiness(data, user);
            sendJson(res, 200, {
              ok: true,
              idempotent: true,
              evidence: {
                id: existing.id,
                version: existing.version,
                institutionId: existing.institutionId,
                evidenceType: existing.evidenceType,
                status: existing.status,
                productionReady: false
              },
              institution: board.institutions.find((item) =>
                item.institutionId === existing.institutionId) || null,
              summary: board.summary,
              technicalLaunchReady: board.technicalLaunchReady,
              productionReady: false
            });
            return true;
          }
          const receiptId = `ph-respiratory-network-receipt-${randomUUID()}`;
          const issued = issueTrustedRespiratoryNetworkEvidenceReceipt({
            id: evidenceId,
            institutionId: String(command.institutionId || "").trim(),
            evidenceType: String(command.evidenceType || "").trim(),
            panelId: RESPIRATORY_PANEL.id,
            panelVersion: RESPIRATORY_PANEL.version,
            status: "verified",
            artifactName: String(command.artifactName || "").trim(),
            artifactDigest: String(command.artifactDigest || "").trim(),
            validFrom: String(command.validFrom || "").trim(),
            expiresAt: String(command.expiresAt || "").trim(),
            productionReady: false
          }, {
            signedBy: signing.signerId,
            verifiedBy: actor.id,
            verifiedAt: signing.at,
            signatureVerified: true,
            receiptId
          }, signing.keyring);
          const evidence = {
            ...issued,
            version: 1
          };
          const auditBase = {
            id: `ph-respiratory-network-audit-${randomUUID()}`,
            evidenceId,
            receiptId,
            action: "issue-trusted-evidence",
            version: 1,
            actorId: actor.id,
            actorRole: actor.role,
            organizationScope: actor.organizationScope,
            at: signing.at,
            idempotencyKeyHash,
            requestFingerprint
          };
          const audit = {
            ...auditBase,
            integrityDigest: publicHealthRespiratoryNetworkEvidenceAuditDigest(auditBase)
          };
          const nextData = {
            ...data,
            publicHealthRespiratoryNetworkEvidence: [
              ...(data.publicHealthRespiratoryNetworkEvidence || []),
              evidence
            ],
            publicHealthRespiratoryNetworkEvidenceAudit: [
              ...(data.publicHealthRespiratoryNetworkEvidenceAudit || []),
              audit
            ]
          };
          writeDatabase(nextData, {
            event: "public-health-respiratory-network-evidence-issued",
            publicHealthModernizationWrite: {
              collection: "publicHealthRespiratoryNetworkEvidence",
              entityId: evidenceId,
              expectedVersion: 0,
              operation: "issue-respiratory-network-evidence",
              requiredCollections: [
                "publicHealthRespiratoryNetworkEvidence",
                "publicHealthRespiratoryNetworkEvidenceAudit"
              ]
            }
          });
          const board = publicHealthSafeRespiratoryNetworkReadiness(nextData, user);
          sendJson(res, 201, {
            ok: true,
            idempotent: false,
            evidence: {
              id: evidence.id,
              version: evidence.version,
              institutionId: evidence.institutionId,
              evidenceType: evidence.evidenceType,
              status: evidence.status,
              productionReady: false
            },
            institution: board.institutions.find((item) =>
              item.institutionId === evidence.institutionId) || null,
            summary: board.summary,
            technicalLaunchReady: board.technicalLaunchReady,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/respiratory-pathogen-surveillance") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          if ([...url.searchParams.keys()].length) {
            const error = new Error("public health respiratory pathogen query overrides are forbidden");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN";
            throw error;
          }
          sendJson(res, 200, publicHealthSafeRespiratoryPathogenSurveillance(readDatabase()));
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/respiratory-pathogen-batches") {
        const user = requireApiRole(
          req,
          res,
          ["commission", "institution"],
          "/api/public-health/respiratory-pathogen-batches"
        );
        if (!user) return true;
        try {
          const clientBody = await collectJson(req);
          if (["sourceId", "panelId", "panelVersion"].some((key) =>
            Object.prototype.hasOwnProperty.call(clientBody || {}, key))) {
            const error = new Error("public health respiratory panel configuration is server-owned");
            error.code = "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_PAYLOAD_FORBIDDEN";
            throw error;
          }
          const command = publicHealthModernizationCommand(req, url, clientBody, { insert: true });
          const payload = {
            ...command,
            sourceId: "ph-source-laboratory-pathogen",
            panelId: RESPIRATORY_PANEL.id,
            panelVersion: RESPIRATORY_PANEL.version
          };
          assertPublicHealthRespiratoryPayload(payload, "intake");
          if (user.role === "institution"
            && String(payload.institutionId || "").trim() !== String(user.orgCode || "").trim()) {
            const error = new Error("respiratory pathogen institution scope mismatch");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_FORBIDDEN";
            throw error;
          }
          const data = readDatabase();
          const result = ingestPublicHealthRespiratoryPathogenBatchToState(
            data,
            payload,
            publicHealthRespiratoryPathogenActor(user, "intake"),
            { at: command.receivedAt }
          );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-respiratory-pathogen-batch-ingested",
              publicHealthModernizationWrite: {
                collection: "publicHealthRespiratoryPathogenBatches",
                entityId: result.batch.id,
                expectedVersion: 0,
                operation: "insert-respiratory-pathogen-batch",
                requiredCollections: [
                  "publicHealthRespiratoryPathogenBatches",
                  "publicHealthRespiratoryPathogenAudit"
                ]
              }
            });
          }
          const board = publicHealthSafeRespiratoryPathogenSurveillance(result.nextData);
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            batch: board.batches.find((item) => item.id === result.batch.id)
              || publicHealthSafeRespiratoryPathogenBatch(result.batch),
            summary: board.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthRespiratoryPathogenActionMatch = url.pathname
        .match(/^\/api\/public-health\/respiratory-pathogen-batches\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthRespiratoryPathogenActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/respiratory-pathogen-batches/:id/actions"
        );
        if (!user) return true;
        try {
          const batchId = decodeURIComponent(publicHealthRespiratoryPathogenActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          const action = String(payload.action || "").trim();
          const data = readDatabase();
          let result;
          let operation;
          if (action === "verify-respiratory-pathogen-batch") {
            assertPublicHealthRespiratoryPayload(payload, "verify");
            result = verifyPublicHealthRespiratoryPathogenBatchToState(
              data,
              batchId,
              payload,
              publicHealthRespiratoryPathogenActor(user, "verify")
            );
            operation = "verify-respiratory-pathogen-batch";
          } else if (action === "publish-respiratory-pathogen-signals") {
            assertPublicHealthRespiratoryPayload(payload, "publish");
            const alertsBefore = JSON.stringify(data.publicHealthSurveillanceAlerts || []);
            result = publishPublicHealthRespiratoryPathogenSignalsToState(
              data,
              batchId,
              payload,
              publicHealthRespiratoryPathogenActor(user, "publish")
            );
            if (JSON.stringify(result.nextData.publicHealthSurveillanceAlerts || []) !== alertsBefore
              || (result.signalIds || []).some((signalId) => {
                const signal = (result.nextData.publicHealthSurveillanceSignals || [])
                  .find((item) => item.id === signalId);
                return !signal || signal.workflowState !== "received" || signal.verification !== null;
              })) {
              const error = new Error("respiratory publication bypassed the signal-level human decision boundary");
              error.code = "PUBLIC_HEALTH_RESPIRATORY_PATHOGEN_INTEGRITY_INVALID";
              throw error;
            }
            operation = "publish-respiratory-pathogen-signals";
          } else {
            const error = new Error("unsupported public health respiratory pathogen action");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_COMMAND_INVALID";
            throw error;
          }
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: operation,
              publicHealthModernizationWrite: {
                collection: "publicHealthRespiratoryPathogenBatches",
                entityId: batchId,
                expectedVersion: payload.expectedVersion,
                operation,
                requiredCollections: operation === "publish-respiratory-pathogen-signals"
                  ? [
                      "publicHealthRespiratoryPathogenBatches",
                      "publicHealthRespiratoryPathogenAudit",
                      "publicHealthSurveillanceSignals",
                      "publicHealthDataLineageAudit"
                    ]
                  : [
                      "publicHealthRespiratoryPathogenBatches",
                      "publicHealthRespiratoryPathogenAudit"
                    ]
              }
            });
          }
          const board = publicHealthSafeRespiratoryPathogenSurveillance(result.nextData);
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            batch: board.batches.find((item) => item.id === batchId)
              || publicHealthSafeRespiratoryPathogenBatch(result.batch),
            summary: board.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthSurveillanceModelRunMatch = url.pathname
        .match(/^\/api\/public-health\/surveillance-models\/([^/]+)\/shadow-runs$/);
      if (req.method === "POST" && publicHealthSurveillanceModelRunMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/surveillance-models/:id/shadow-runs"
        );
        if (!user) return true;
        try {
          const modelId = decodeURIComponent(publicHealthSurveillanceModelRunMatch[1]);
          const command = publicHealthModernizationCommand(
            req,
            url,
            await collectJson(req),
            { insert: true }
          );
          const payload = { ...command, at: command.receivedAt };
          assertPublicHealthSurveillanceModelPayload(payload, "run");
          const data = readDatabase();
          const signalsBefore = JSON.stringify(data.publicHealthSurveillanceSignals || []);
          const alertsBefore = JSON.stringify(data.publicHealthSurveillanceAlerts || []);
          const result = runPublicHealthSurveillanceModelToState(
            data,
            modelId,
            payload,
            publicHealthSurveillanceModelActor(user, "run")
          );
          if (JSON.stringify(result.nextData.publicHealthSurveillanceSignals || []) !== signalsBefore
            || JSON.stringify(result.nextData.publicHealthSurveillanceAlerts || []) !== alertsBefore) {
            const error = new Error("shadow model run changed public health signal or alert state");
            error.code = "PUBLIC_HEALTH_SURVEILLANCE_MODEL_INTEGRITY_INVALID";
            throw error;
          }
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-surveillance-model-shadow-run",
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceModelRuns",
                entityId: result.run.id,
                expectedVersion: 0
              }
            });
          }
          const governance = publicHealthSafeSurveillanceModelGovernance(result.nextData);
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            run: governance.runs.find((item) => item.id === result.run.id) || null,
            summary: governance.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthSurveillanceModelValidationMatch = url.pathname
        .match(/^\/api\/public-health\/surveillance-models\/([^/]+)\/validations$/);
      if (req.method === "POST" && publicHealthSurveillanceModelValidationMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/surveillance-models/:id/validations"
        );
        if (!user) return true;
        try {
          const modelId = decodeURIComponent(publicHealthSurveillanceModelValidationMatch[1]);
          const command = publicHealthModernizationCommand(
            req,
            url,
            await collectJson(req),
            { insert: true }
          );
          const payload = { ...command, at: command.receivedAt };
          assertPublicHealthSurveillanceModelPayload(payload, "validate");
          const data = readDatabase();
          const result = submitPublicHealthSurveillanceModelValidationToState(
            data,
            modelId,
            payload,
            publicHealthSurveillanceModelActor(user, "submit-validation")
          );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-surveillance-model-validation-submitted",
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceModelValidations",
                entityId: result.validation.id,
                expectedVersion: 0
              }
            });
          }
          const governance = publicHealthSafeSurveillanceModelGovernance(result.nextData);
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            validation: governance.validations
              .find((item) => item.id === result.validation.id) || null,
            summary: governance.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthSurveillanceModelValidationActionMatch = url.pathname
        .match(/^\/api\/public-health\/surveillance-model-validations\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthSurveillanceModelValidationActionMatch) {
        const user = requireApiRole(
          req,
          res,
          ["commission"],
          "/api/public-health/surveillance-model-validations/:id/actions"
        );
        if (!user) return true;
        try {
          const validationId = decodeURIComponent(publicHealthSurveillanceModelValidationActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          if (String(payload.action || "").trim() !== "review-model-validation") {
            const error = new Error("unsupported public health model validation action");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_COMMAND_INVALID";
            throw error;
          }
          assertPublicHealthSurveillanceModelPayload(payload, "review");
          const data = readDatabase();
          const result = reviewPublicHealthSurveillanceModelValidationToState(
            data,
            validationId,
            payload,
            publicHealthSurveillanceModelActor(user, "review-validation")
          );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-surveillance-model-validation-reviewed",
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceModelValidations",
                entityId: validationId,
                expectedVersion: payload.expectedVersion
              }
            });
          }
          const governance = publicHealthSafeSurveillanceModelGovernance(result.nextData);
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            validation: governance.validations
              .find((item) => item.id === validationId) || null,
            summary: governance.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/surveillance-rule-changes") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          assertPublicHealthRuleChangePayload(payload, "submit");
          const activation = publicHealthSurveillanceRuleActivationOptions();
          const data = readDatabase();
          const result = proposePublicHealthSurveillanceRuleChangeToState(data, {
            ...payload,
            expectedCurrentVersion: payload.expectedVersion
          }, user, {
            activationKeyring: activation.activationKeyring
          });
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-surveillance-rule-change-submitted",
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceRuleChanges",
                entityId: result.change.id,
                expectedVersion: 0
              }
            });
          }
          const governance = publicHealthSafeRuleGovernance(result.nextData);
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            change: governance.changes.find((item) => item.id === result.change.id) || null,
            summary: governance.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthRuleChangeActionMatch = url.pathname.match(/^\/api\/public-health\/surveillance-rule-changes\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthRuleChangeActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/surveillance-rule-changes/:id/actions");
        if (!user) return true;
        try {
          const changeId = decodeURIComponent(publicHealthRuleChangeActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          const action = String(payload.action || "").trim();
          if (!["review-rule-change", "activate-rule-change"].includes(action)) {
            const error = new Error("unsupported public health rule change action");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_COMMAND_INVALID";
            throw error;
          }
          assertPublicHealthRuleChangePayload(payload, action === "review-rule-change" ? "review" : "activate");
          const data = readDatabase();
          const result = action === "review-rule-change"
            ? reviewPublicHealthSurveillanceRuleChangeToState(data, changeId, payload, user)
            : activatePublicHealthSurveillanceRuleChangeToState(
                data,
                changeId,
                payload,
                user,
                publicHealthSurveillanceRuleActivationOptions({ required: true })
              );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: `public-health-surveillance-${action}`,
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceRuleChanges",
                entityId: changeId,
                expectedVersion: payload.expectedVersion
              }
            });
          }
          const governance = publicHealthSafeRuleGovernance(result.nextData);
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            change: governance.changes.find((item) => item.id === changeId) || null,
            summary: governance.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/surveillance-signals") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req), { insert: true });
          const data = readDatabase();
          const result = ingestPublicHealthSurveillanceSignalToState(data, payload, user);
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: "public-health-surveillance-signal-ingested",
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceSignals",
                entityId: result.signal.id,
                expectedVersion: 0,
                operation: "insert-signal",
                sourceRecordHash: result.signal.externalSignalKeyHash,
                idempotencyKeyHash: result.signal.idempotencyKeyHash
              }
            });
          }
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            signal: publicHealthSafeSignal(result.nextData, result.signal.id),
            summary: result.dataFoundation.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthSignalActionMatch = url.pathname.match(/^\/api\/public-health\/surveillance-signals\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthSignalActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/surveillance-signals/:id/actions");
        if (!user) return true;
        try {
          const signalId = decodeURIComponent(publicHealthSignalActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          const data = readDatabase();
          const action = String(payload.action || "").trim();
          const result = action === "verify-signal"
            ? verifyPublicHealthSurveillanceSignalToState(data, signalId, payload, user)
            : action === "evaluate-signal"
              ? evaluatePublicHealthSurveillanceSignalToState(
                  data,
                  signalId,
                  payload,
                  user,
                  publicHealthSurveillanceRuleActivationOptions()
                )
              : (() => {
                  const error = new Error("unsupported public health signal action");
                  error.code = "PUBLIC_HEALTH_MODERNIZATION_COMMAND_INVALID";
                  throw error;
                })();
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: `public-health-surveillance-${action}`,
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceSignals",
                entityId: signalId,
                expectedVersion: payload.expectedVersion
              }
            });
          }
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            matched: action === "evaluate-signal" ? Boolean(result.matched) : undefined,
            signal: publicHealthSafeSignal(result.nextData, signalId),
            alert: result.alert ? publicHealthSafeAlert(result.nextData, result.alert.id) : undefined,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      const publicHealthOfficialExchangeCallbackRoutes = {
        "/api/public-health/official-exchange/official-report-receipts": "official-report",
        "/api/public-health/official-exchange/feedback-receipts": "feedback"
      };
      const publicHealthOfficialExchangeStage = publicHealthOfficialExchangeCallbackRoutes[url.pathname];
      if (req.method === "POST" && publicHealthOfficialExchangeStage) {
        if (!requirePublicHealthOfficialExchangeCallback(req, res, url.pathname)) return true;
        try {
          const payload = await collectJson(req);
          assertPublicHealthOfficialExchangeCallbackPayload(
            url,
            payload,
            publicHealthOfficialExchangeStage
          );
          const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
          if (!idempotencyKey) {
            const error = new Error("official exchange callback Idempotency-Key is required");
            error.code = "PUBLIC_HEALTH_MODERNIZATION_IDEMPOTENCY_REQUIRED";
            throw error;
          }
          const data = readDatabase();
          const result = recordPublicHealthOfficialExchangeCallback(
            data,
            payload,
            publicHealthOfficialExchangeStage,
            idempotencyKey
          );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: `public-health-official-exchange-${publicHealthOfficialExchangeStage}`,
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceAlerts",
                entityId: String(payload.alertId || "").trim(),
                receiptRecordId: result.receipt.id,
                alertId: String(payload.alertId || "").trim(),
                expectedVersion: Number(payload.expectedVersion),
                operation: "issue-official-exchange-receipt",
                requiredCollections: [
                  "publicHealthOfficialExchangeReceipts",
                  "publicHealthOfficialExchangeReceiptAudit",
                  "publicHealthSurveillanceAlerts",
                  "publicHealthSurveillanceAudit"
                ],
                officialExchangeReceiptKeyring: result.options.keyring,
                officialExchangeReceiptAt: result.options.at
              }
            });
          }
          sendJson(res, result.idempotent ? 200 : 201, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            receipt: publicHealthSafeOfficialExchangeReceipt(result.receipt),
            alert: publicHealthSafeAlert(result.nextData, String(payload.alertId || "").trim()),
            productionReady: false,
            blockers: [
              "Production endpoint acceptance and continuous official receipt delivery evidence are required.",
              "Trusted site evidence, P0/P1 closure, production handoff and formal launch approval remain blocking."
            ]
          });
        } catch (error) {
          publicHealthOfficialExchangeCallbackError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/surveillance-center") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, publicHealthSafeSurveillanceCenter(readDatabase()));
        return true;
      }

      const publicHealthAlertActionMatch = url.pathname.match(/^\/api\/public-health\/surveillance-alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthAlertActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/surveillance-alerts/:id/actions");
        if (!user) return true;
        try {
          const alertId = decodeURIComponent(publicHealthAlertActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          const data = readDatabase();
          const action = String(payload.action || "").trim();
          if (["record-official-report", "record-feedback"].includes(action)) {
            const allowed = new Set(["action", "expectedVersion", "trustedReceiptId", "idempotencyKey", "at"]);
            if (Object.keys(payload).some((key) => !allowed.has(key))
              || !String(payload.trustedReceiptId || "").trim()) {
              const error = new Error("official exchange alert actions accept only trustedReceiptId");
              error.code = "PUBLIC_HEALTH_MODERNIZATION_SERVER_CONTEXT_FORBIDDEN";
              throw error;
            }
          }
          const officialExchange = publicHealthOfficialExchangeReceiptOptions({
            required: ["record-official-report", "record-feedback", "close-alert", "reopen-alert"]
              .includes(action)
              || Boolean((data.publicHealthOfficialExchangeReceipts || []).length)
          });
          const result = applyPublicHealthSurveillanceAlertActionToState(
            data,
            alertId,
            payload,
            user,
            {
              ...publicHealthSurveillanceRuleActivationOptions(),
              officialExchangeReceiptKeyring: officialExchange.keyring,
              officialExchangeReceiptAt: officialExchange.at
            }
          );
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: `public-health-surveillance-alert-${String(payload.action || "action")}`,
              publicHealthModernizationWrite: {
                collection: "publicHealthSurveillanceAlerts",
                entityId: alertId,
                expectedVersion: payload.expectedVersion
              }
            });
          }
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            alert: publicHealthSafeAlert(result.nextData, alertId),
            createdCollaborationTasks: (result.createdCollaborationTasks || [])
              .map((task) => publicHealthSafeMedicalPreventionTask(result.nextData, task.id))
              .filter(Boolean),
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/medical-prevention-tasks") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const data = readDatabase();
        sendJson(res, 200, buildPublicHealthMedicalPreventionBoard({
          data,
          alerts: data.publicHealthSurveillanceAlerts
        }));
        return true;
      }

      const publicHealthMedicalPreventionActionMatch = url.pathname.match(/^\/api\/public-health\/medical-prevention-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthMedicalPreventionActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/medical-prevention-tasks/:id/actions");
        if (!user) return true;
        try {
          const taskId = decodeURIComponent(publicHealthMedicalPreventionActionMatch[1]);
          const payload = publicHealthModernizationCommand(req, url, await collectJson(req));
          const data = readDatabase();
          const result = applyPublicHealthMedicalPreventionTaskActionToState(data, taskId, payload, user);
          if (!result.idempotent) {
            writeDatabase(result.nextData, {
              event: `public-health-medical-prevention-${String(payload.action || "action")}`,
              publicHealthModernizationWrite: {
                collection: "publicHealthMedicalPreventionTasks",
                entityId: taskId,
                expectedVersion: payload.expectedVersion
              }
            });
          }
          sendJson(res, 200, {
            ok: true,
            idempotent: Boolean(result.idempotent),
            task: publicHealthSafeMedicalPreventionTask(result.nextData, taskId),
            summary: result.collaboration.summary,
            productionReady: false
          });
        } catch (error) {
          publicHealthModernizationError(res, error);
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/coordination-runtime") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        sendJson(res, 200, publicHealthExternalPublicView(buildPublicHealthCoordinationRuntime({ data: readDatabase() })));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/contracts/governance") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const at = new Date().toISOString();
          const data = readDatabase();
          const context = await publicHealthContractGovernanceContext(data, at);
          sendJson(res, 200, publicHealthExternalPublicView({
            ...context.governance,
            contractCutover: buildPublicHealthExternalContractCutoverBoard({
              data,
              contractGovernance: context.governance,
              now: at
            }),
            keyProvider: context.summary,
            productionReady: false
          }));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), {
            error: "Public health external contract governance unavailable",
            message: error.message,
            productionReady: false
          });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/external/contracts/attestations") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const at = new Date().toISOString();
        const idempotencyKey = String(req.headers["idempotency-key"] || "").trim();
        let payload = {};
        let requestDigest = "";
        let signedAttestation = null;
        try {
          payload = await collectJson(req);
          if (!idempotencyKey) throw new Error("public health contract attestation idempotency key is required");
          if (Number(payload.expectedVersion) !== 0) {
            throw new Error(`public health contract attestation version conflict: expected ${payload.expectedVersion ?? "missing"}, current 0`);
          }
          const data = readDatabase();
          const context = await publicHealthContractGovernanceContext(data, at);
          const signed = signTrustedPublicHealthContractAttestation({
            payload,
            evidenceConfig: process.env.PUBLIC_HEALTH_EXTERNAL_CONTRACT_RELEASE_EVIDENCE,
            signingMaterial: context.signingMaterial,
            user,
            at
          });
          signedAttestation = signed.attestation;
          requestDigest = publicHealthContractAttestationRequestDigest(signed.attestation, payload.evidenceId);
          const key = contractAttestationUniqueKey(signed.attestation);
          const replayAudit = (data.publicHealthExternalContractGovernanceAudit || [])
            .find((item) => item.idempotencyKey === idempotencyKey && item.result === "accepted");
          if (replayAudit) {
            const existing = (data.publicHealthExternalContractAttestations || [])
              .find((item) => contractAttestationUniqueKey(item) === key);
            if (!existing
              || replayAudit.laneId !== existing.laneId
              || replayAudit.fromContract !== existing.fromContract
              || replayAudit.requestDigest !== requestDigest) {
              throw new Error("public health contract attestation idempotency conflict");
            }
            sendJson(res, 200, publicHealthExternalPublicView({
              ok: true,
              idempotent: true,
              attestation: existing,
              productionReady: false
            }));
            return true;
          }
          if ((data.publicHealthExternalContractGovernanceAudit || [])
            .some((item) => item.idempotencyKey === idempotencyKey)) {
            throw new Error("public health contract attestation idempotency conflict");
          }
          const nextData = {
            ...data,
            publicHealthExternalContractAttestations: [
              ...(data.publicHealthExternalContractAttestations || []),
              signed.attestation
            ],
            publicHealthExternalContractGovernanceAudit: [
              ...(data.publicHealthExternalContractGovernanceAudit || []),
              publicHealthContractGovernanceAuditEvent(user, {
                at,
                action: "contract-attestation-sign",
                result: "accepted",
                idempotencyKey,
                requestDigest,
                evidenceId: payload.evidenceId,
                laneId: signed.attestation.laneId,
                fromContract: signed.attestation.fromContract,
                detail: `${signed.attestation.toContract} / ${signed.attestation.runtimeReleaseDigest}`
              })
            ]
          };
          writeDatabase(nextData, {
            event: "public-health-external-contract-attestation",
            publicHealthExternalContractInsert: {
              laneId: signed.attestation.laneId,
              fromContract: signed.attestation.fromContract,
              attestation: signed.attestation,
              signingMaterial: context.signingMaterial,
              at
            }
          });
          sendJson(res, 201, publicHealthExternalPublicView({
            ok: true,
            idempotent: false,
            attestation: signed.attestation,
            releaseEvidence: signed.releaseEvidence,
            productionReady: false
          }));
        } catch (error) {
          try {
            const rejectedData = readDatabase();
            rejectedData.publicHealthExternalContractGovernanceAudit = [
              ...(rejectedData.publicHealthExternalContractGovernanceAudit || []),
              publicHealthContractGovernanceAuditEvent(user, {
                at,
                action: "contract-attestation-sign",
                result: "rejected",
                idempotencyKey,
                requestDigest,
                evidenceId: payload.evidenceId,
                laneId: signedAttestation?.laneId || payload.laneId,
                fromContract: signedAttestation?.fromContract || payload.fromContract,
                detail: error.message
              })
            ];
            writeDatabase(rejectedData, { event: "public-health-external-contract-attestation-rejected" });
          } catch {
            // The rejection response must not expose a secondary persistence failure.
          }
          sendJson(res, publicHealthExternalHttpStatus(error), {
            error: "Public health external contract attestation rejected",
            message: error.message,
            productionReady: false
          });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/endpoints/summary") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const at = new Date().toISOString();
          const summary = await buildPublicHealthEndpointVerificationSummary(readDatabase(), at);
          sendJson(res, 200, summary);
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), {
            error: "Public health endpoint verification summary unavailable",
            message: error.message,
            productionReady: false
          });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/endpoints/campaigns/summary") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const at = new Date().toISOString();
        const data = readDatabase();
        const continuity = await buildPublicHealthEndpointProbeCampaignSummary(data, at);
        const endpointVerification = await buildPublicHealthEndpointVerificationSummary(data, at);
        sendJson(res, 200, {
          ...continuity,
          endpointConnectivityReady: endpointVerification.endpointConnectivityReady,
          continuousConnectivityReady: continuity.continuousConnectivityReady,
          productionReady: false
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/external/endpoints/campaigns") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const input = await collectJson(req);
          const query = Object.fromEntries(url.searchParams.entries());
          const command = { ...input, ...query };
          const continuity = await runControlledPublicHealthEndpointProbeCampaign(command, user);
          const endpointVerification = await buildPublicHealthEndpointVerificationSummary(
            readDatabase(),
            new Date().toISOString()
          );
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-endpoint-probe-campaign",
            target: "eight-lane-campaign",
            result: "allowed",
            detail: "server-controlled endpoint probe campaign completed"
          });
          sendJson(res, 201, {
            ...continuity,
            endpointConnectivityReady: endpointVerification.endpointConnectivityReady,
            continuousConnectivityReady: continuity.continuousConnectivityReady,
            productionReady: false
          });
        } catch (error) {
          const code = error.publicCode || publicHealthEndpointProbeCampaignSafeCode(error);
          if (!error.campaignAuditPersisted) {
            const latest = readDatabase();
            writeDatabase(appendPublicHealthEndpointProbeCampaignAudit(
              latest,
              publicHealthEndpointProbeCampaignAuditEntry(
                user,
                "rejected",
                code,
                new Date().toISOString()
              )
            ), { event: "public-health-endpoint-probe-campaign-rejected" });
          }
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-endpoint-probe-campaign",
            target: "eight-lane-campaign",
            result: "denied",
            detail: code
          });
          sendJson(res, publicHealthEndpointProbeCampaignHttpStatus(code), {
            ok: false,
            code,
            message: "Endpoint probe campaign failed closed; inspect restricted server diagnostics.",
            endpointConnectivityReady: false,
            continuousConnectivityReady: false,
            productionReady: false
          });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/external/endpoints/probes") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        let laneId = "";
        try {
          const input = await collectJson(req);
          const query = Object.fromEntries(url.searchParams.entries());
          laneId = String(input?.laneId || query.laneId || "").trim();
          const command = { ...input, ...query, laneId };
          if (input?.laneId && query.laneId && String(input.laneId).trim() !== String(query.laneId).trim()) {
            command.laneConflict = true;
          }
          const result = await runControlledPublicHealthEndpointProbe(command, user);
          const summary = result.summary;
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-active-endpoint-probe",
            target: laneId,
            result: "allowed",
            detail: "server-controlled endpoint probe completed"
          });
          sendJson(res, 201, {
            ok: true,
            lane: summary.entries.find((item) => item.laneId === laneId) || null,
            worker: summary.worker,
            endpointConnectivityReady: summary.endpointConnectivityReady,
            productionReady: false
          });
        } catch (error) {
          const code = error.publicCode || publicHealthEndpointProbeSafeCode(error);
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-active-endpoint-probe",
            target: laneId || "unknown-lane",
            result: "denied",
            detail: code
          });
          sendJson(res, publicHealthEndpointProbeHttpStatus(code), {
            ok: false,
            code,
            message: "Endpoint probe failed closed; inspect restricted server diagnostics.",
            productionReady: false
          });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/external/endpoints/receipts") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        let laneId = "";
        try {
          const input = await collectJson(req);
          const receipt = input?.receipt && typeof input.receipt === "object" && !Array.isArray(input.receipt)
            ? input.receipt
            : input;
          laneId = String(receipt?.laneId || "").trim();
          const at = new Date().toISOString();
          const data = readDatabase();
          const context = await publicHealthEndpointVerificationContext(data, laneId, at);
          const persistedReceipts = Array.isArray(data.publicHealthExternalEndpointProbeReceipts)
            ? data.publicHealthExternalEndpointProbeReceipts
            : [];
          const verification = verifyPublicHealthExternalEndpointProbeReceipt(receipt, {
            expectedEndpoint: context.endpoint,
            expectedContract: context.contract,
            keyring: context.keyring,
            at,
            maxLatencyMs: context.policy.maxLatencyMs,
            certificatePins: context.policy.certificatePins,
            requireMutualTls: context.policy.requireMutualTls,
            seenReceiptIds: new Set(persistedReceipts.map((item) => String(item?.receiptId || "").trim())),
            seenNonces: new Set(persistedReceipts.map((item) => String(item?.nonce || "").trim()))
          });
          if (!verification.ok) throw new Error(verification.reason);
          const storedReceipt = {
            ...verification.payload,
            signature: String(receipt.signature || "").trim(),
            acceptedAt: at,
            productionReady: false
          };
          const nextData = {
            ...data,
            publicHealthExternalEndpointProbeReceipts: [
              ...persistedReceipts,
              storedReceipt
            ]
          };
          writeDatabase(nextData, {
            event: "public-health-external-endpoint-probe-accepted",
            publicHealthEndpointProbeInsert: { receipt: storedReceipt }
          });
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-external-endpoint-probe-accept",
            target: laneId,
            result: "allowed",
            detail: "server-config-bound signed endpoint probe accepted"
          });
          const summary = await buildPublicHealthEndpointVerificationSummary(nextData, at);
          sendJson(res, 201, {
            ok: true,
            accepted: true,
            lane: summary.entries.find((item) => item.laneId === laneId) || null,
            endpointConnectivityReady: summary.endpointConnectivityReady,
            productionReady: false
          });
        } catch (error) {
          appendSecurityEvent({
            actor: user.name,
            role: user.role,
            action: "public-health-external-endpoint-probe-accept",
            target: laneId || "unknown-lane",
            result: "denied",
            detail: String(error.message || "endpoint probe rejected").slice(0, 200)
          });
          sendJson(res, publicHealthExternalHttpStatus(error), {
            error: "Public health endpoint probe rejected",
            message: error.message,
            productionReady: false
          });
        }
        return true;
      }

      const publicHealthCoordinationActionMatch = url.pathname.match(/^\/api\/public-health\/coordination\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCoordinationActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/coordination/:id/actions");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const result = applyPublicHealthCoordinationActionToState(
            data,
            decodeURIComponent(publicHealthCoordinationActionMatch[1]),
            {
              ...payload,
              idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
              at: new Date().toISOString()
            },
            user
          );
          writeDatabase(result.nextData);
          sendJson(res, 200, publicHealthExternalPublicView({
            ok: true,
            idempotent: result.idempotent,
            handoff: result.handoff,
            action: result.action,
            productionReady: false
          }));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health coordination rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      const publicHealthExternalEnqueueMatch = url.pathname.match(/^\/api\/public-health\/external\/handoffs\/([^/]+)\/enqueue$/);
      if (req.method === "POST" && publicHealthExternalEnqueueMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/external/handoffs/:id/enqueue");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const handoffId = decodeURIComponent(publicHealthExternalEnqueueMatch[1]);
          const runtime = buildPublicHealthCoordinationRuntime({ data });
          const handoff = runtime.handoffs.find((item) => item.id === handoffId);
          if (!handoff) throw new Error(`unknown public health coordination handoff: ${handoffId || "missing"}`);
          const at = new Date().toISOString();
          const credentials = await loadPublicHealthLaneCredentials(handoff.laneId, { at, data });
          const result = enqueuePublicHealthExternalDispatchToState(data, handoffId, {
            ...payload,
            idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
            at
          }, credentials);
          writeDatabase(result.nextData);
          sendJson(res, 200, publicHealthExternalPublicView(publicHealthExternalResult(result)));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external enqueue rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/outbox/due") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        try {
          const at = new Date().toISOString();
          const due = listDuePublicHealthExternalDispatches(readDatabase(), {
            now: at,
            limit: Number(url.searchParams.get("limit") || 20)
          });
          sendJson(res, 200, { generatedAt: at, candidateOnly: true, due, productionReady: false });
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external due queue rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      const publicHealthExternalClaimMatch = url.pathname.match(/^\/api\/public-health\/external\/dispatches\/([^/]+)\/claim$/);
      if (req.method === "POST" && publicHealthExternalClaimMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/external/dispatches/:id/claim");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const dispatchId = decodeURIComponent(publicHealthExternalClaimMatch[1]);
          const at = new Date().toISOString();
          const credentials = await publicHealthCredentialsForDispatch(data, dispatchId, at);
          const dispatch = data.publicHealthExternalDispatches.find((item) => item.id === dispatchId);
          const expectedLaneControlVersion = publicHealthExternalLaneVersion(data, dispatch.laneId);
          const result = claimPublicHealthExternalDispatchToState(data, dispatchId, {
            workerId: publicHealthExternalWorkerId(user),
            idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
            expectedVersion: payload.expectedVersion,
            expectedLaneControlVersion,
            leaseSeconds: payload.leaseSeconds,
            now: at
          }, credentials);
          writeDatabase(result.nextData, {
            event: "public-health-external-claim",
            publicHealthExternalCas: {
              dispatchId,
              expectedOutboxVersion: Number(payload.expectedVersion),
              laneId: dispatch.laneId,
              expectedLaneControlVersion
            }
          });
          sendJson(res, 200, publicHealthExternalPublicView({
            ...publicHealthExternalResult(result),
            leaseToken: result.leaseToken
          }));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external claim rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      const publicHealthExternalAttemptMatch = url.pathname.match(/^\/api\/public-health\/external\/dispatches\/([^/]+)\/attempt$/);
      if (req.method === "POST" && publicHealthExternalAttemptMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/external/dispatches/:id/attempt");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const dispatchId = decodeURIComponent(publicHealthExternalAttemptMatch[1]);
          const at = new Date().toISOString();
          const credentials = await publicHealthCredentialsForDispatch(data, dispatchId, at);
          const result = recordClaimedPublicHealthExternalAttemptToState(
            data,
            dispatchId,
            {
              transportStatus: payload.transportStatus,
              receipt: payload.receipt,
              networkError: payload.networkError
            },
            publicHealthExternalAttemptOptions(credentials, {
              ...payload,
              idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
              leaseToken: String(req.headers["x-public-health-lease-token"] || "").trim()
            }, user, at)
          );
          writeDatabase(result.nextData, {
            event: "public-health-external-attempt",
            publicHealthExternalCas: {
              dispatchId,
              expectedOutboxVersion: Number(payload.expectedVersion),
              laneId: result.dispatch.laneId,
              expectedLaneControlVersion: Number(payload.expectedLaneControlVersion)
            }
          });
          sendJson(res, 200, publicHealthExternalPublicView(publicHealthExternalResult(result)));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external attempt rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      const publicHealthExternalCallbackMatch = url.pathname.match(/^\/api\/public-health\/external\/callbacks\/([^/]+)$/);
      if (req.method === "POST" && publicHealthExternalCallbackMatch) {
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const dispatchId = decodeURIComponent(publicHealthExternalCallbackMatch[1]);
          const at = new Date().toISOString();
          const credentials = await publicHealthCredentialsForDispatch(data, dispatchId, at);
          const result = recordPublicHealthExternalAttemptToState(
            data,
            dispatchId,
            { transportStatus: 200, receipt: payload.receipt },
            {
              requestKeyring: credentials.requestKeyring,
              receiptKeyring: credentials.receiptKeyring,
              attemptIdempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
              expectedVersion: payload.expectedVersion,
              at
            }
          );
          writeDatabase(result.nextData);
          sendJson(res, 200, {
            ok: result.ok,
            idempotent: Boolean(result.idempotent),
            dispatchId: result.dispatch.id,
            deliveryState: result.dispatch.deliveryState,
            productionReady: false
          });
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external callback rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      const publicHealthExternalRecoveryMatch = url.pathname.match(/^\/api\/public-health\/external\/dispatches\/([^/]+)\/recover$/);
      if (req.method === "POST" && publicHealthExternalRecoveryMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/external/dispatches/:id/recover");
        if (!user) return true;
        try {
          const payload = await collectJson(req);
          const data = readDatabase();
          const dispatchId = decodeURIComponent(publicHealthExternalRecoveryMatch[1]);
          const at = new Date().toISOString();
          const dispatch = (data.publicHealthExternalDispatches || []).find((item) => item.id === dispatchId);
          if (!dispatch) throw new Error(`unknown public health external dispatch: ${dispatchId || "missing"}`);
          const expectedLaneControlVersion = publicHealthExternalLaneVersion(data, dispatch.laneId);
          const credentials = await publicHealthCredentialsForDispatch(data, dispatchId, at);
          const result = requeuePublicHealthExternalDeadLetterToState(data, dispatchId, {
            ...payload,
            idempotencyKey: String(req.headers["idempotency-key"] || "").trim(),
            at
          }, credentials, user);
          writeDatabase(result.nextData, {
            event: "public-health-external-recovery",
            publicHealthExternalCas: {
              dispatchId,
              expectedOutboxVersion: Number(payload.expectedVersion),
              laneId: dispatch.laneId,
              expectedLaneControlVersion
            }
          });
          sendJson(res, 200, publicHealthExternalPublicView(publicHealthExternalResult(result)));
        } catch (error) {
          sendJson(res, publicHealthExternalHttpStatus(error), { error: "Public health external recovery rejected", message: error.message, productionReady: false });
        }
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/operations-board") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const at = new Date().toISOString();
        const data = readDatabase();
        const contractContext = await publicHealthContractGovernanceContext(data, at);
        const loaded = await loadAvailablePublicHealthCredentialMap(data, at, contractContext.governance);
        const coordinationCenter = buildPublicHealthCoordinationRuntime({ data });
        const keySafety = buildPublicHealthKeySafetyBoard(data, loaded.credentials);
        const endpointVerification = await buildPublicHealthEndpointVerificationSummary(data, at);
        const endpointProbeContinuitySummary = await buildPublicHealthEndpointProbeCampaignSummary(data, at);
        const endpointProbeContinuity = {
          ...endpointProbeContinuitySummary,
          endpointConnectivityReady: endpointVerification.endpointConnectivityReady,
          continuousConnectivityReady: endpointProbeContinuitySummary.continuousConnectivityReady,
          productionReady: false
        };
        const operations = buildPublicHealthExternalOperationsBoard({
          data,
          coordinationCenter,
          secretResolver: (laneId) => loaded.credentials[laneId]?.requestKeyring,
          contractGovernance: contractContext.governance,
          endpointProbeContinuity,
          now: at
        });
        sendJson(res, 200, publicHealthExternalPublicView({
          ...operations,
          contractGovernance: contractContext.governance,
          endpointVerification,
          endpointProbeContinuity,
          keySafety,
          productionReady: false
        }));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/external/key-rotation") {
        const user = requireApiRole(req, res, ["commission"], url.pathname);
        if (!user) return true;
        const at = new Date().toISOString();
        const data = readDatabase();
        const contractContext = await publicHealthContractGovernanceContext(data, at);
        const loaded = await loadAvailablePublicHealthCredentialMap(data, at, contractContext.governance);
        sendJson(res, 200, publicHealthExternalPublicView({
          generatedAt: at,
          lanes: loaded.summaries,
          contractGovernance: contractContext.summary,
          keySafety: buildPublicHealthKeySafetyBoard(data, loaded.credentials),
          productionReady: false
        }));
        return true;
      }
        return false;
      }
    },
    {
      id: "public-health-02",
      domain: "public-health",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/public-health/system") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/system");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        const highlights = buildPublicHealthHighlights({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-system",
          target: "/api/public-health/system",
          result: "allowed",
          detail: "Public health standard matrix, institution scopes, events, and exchange tasks read."
        });
        sendJson(res, 200, {
          ...system,
          highlights,
          summary: {
            ...system.summary,
            highlightCapabilities: highlights.summary.capabilities,
            highlightActiveAlerts: highlights.summary.activeAlerts,
            highlightOpenTasks: highlights.summary.openTasks,
            highlightEvidenceScore: highlights.summary.evidenceScore
          }
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/highlights") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights");
        if (!user) return true;
        const data = readDatabase();
        const highlights = buildPublicHealthHighlights({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-read",
          target: "/api/public-health/highlights",
          result: "allowed",
          detail: `${highlights.summary.capabilities} capabilities / ${highlights.summary.activeAlerts} active alerts / ${highlights.summary.openTasks} open tasks`
        });
        sendJson(res, 200, highlights);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/highlights/signals") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/signals");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        let signal;
        try {
          signal = normalizePublicHealthSignal(payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        data.publicHealthSignals = [signal, ...mergeByKey(seedPublicHealthSignals(), data.publicHealthSignals, "id")].slice(0, 200);
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-signal",
            target: signal.id,
            result: "allowed",
            detail: `${signal.sourceType} / ${signal.metric} / ${signal.value}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 201, {
          ok: true,
          signal,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightAlertActionMatchDuplicate = url.pathname.match(/^\/api\/public-health\/highlights\/alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightAlertActionMatchDuplicate) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/alerts/:id/actions");
        if (!user) return true;
        const alertId = decodeURIComponent(publicHealthHighlightAlertActionMatchDuplicate[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const alerts = mergeByKey(seedPublicHealthAlerts(), data.publicHealthAlerts, "id");
        const index = alerts.findIndex((item) => item.id === alertId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight alert not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthHighlightAlertAction(alerts[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        alerts[index] = normalized.item;
        data.publicHealthAlerts = alerts;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-alert-action",
            target: alertId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          alert: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightTaskActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/command-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/command-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthHighlightTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = mergeByKey(seedPublicHealthCommandTasks(), data.publicHealthCommandTasks, "id");
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight command task not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCommandTaskAction(tasks[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        tasks[index] = normalized.item;
        data.publicHealthCommandTasks = tasks;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-command-task-action",
            target: taskId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightAiActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/ai-reviews\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightAiActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/ai-reviews/:id/actions");
        if (!user) return true;
        const reviewId = decodeURIComponent(publicHealthHighlightAiActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const reviews = mergeByKey(seedPublicHealthAiReviews(), data.publicHealthAiReviews, "id");
        const index = reviews.findIndex((item) => item.id === reviewId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight AI review not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthAiReviewAction(reviews[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        reviews[index] = normalized.item;
        data.publicHealthAiReviews = reviews;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-ai-review-action",
            target: reviewId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          review: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthHighlightEvidenceActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/evidence/:id/actions");
        if (!user) return true;
        const evidenceId = decodeURIComponent(publicHealthHighlightEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const records = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id");
        const index = records.findIndex((item) => item.id === evidenceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health highlight evidence record not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthEvidenceAction(records[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        records[index] = normalized.item;
        data.publicHealthEvidenceRecords = records;
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-highlight-evidence-action",
            target: evidenceId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.item.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          evidence: normalized.item,
          action: normalized.history,
          highlights: buildPublicHealthHighlights({ data: readDatabase() })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/highlights") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights");
        if (!user) return true;
        const data = readDatabase();
        const highlights = buildPublicHealthHighlights({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-read",
          target: "/api/public-health/highlights",
          result: "allowed",
          detail: `${highlights.summary.activeAlerts} active alerts / ${highlights.summary.openTasks} open tasks / evidence ${highlights.summary.evidenceScore}%`
        });
        sendJson(res, 200, highlights);
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/highlights/signals") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/signals");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        let signal;
        try {
          signal = normalizePublicHealthSignal(payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const signals = [signal, ...(Array.isArray(data.publicHealthSignals) ? data.publicHealthSignals : [])].slice(0, 500);
        data.publicHealthSignals = signals;
        data.publicHealthEvidenceRecords = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id").map((item) => (
          item.id === "phec-source-lineage"
            ? { ...item, observed: Math.max(Number(item.observed || 0), signals.length), status: "recorded" }
            : item
        ));
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-signal-intake",
          target: signal.id,
          result: "allowed",
          detail: `${signal.sourceType}/${signal.region}/${signal.metric}/${signal.value}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 201, { ok: true, signal, highlights: buildPublicHealthHighlights({ data: readDatabase() }) });
        return true;
      }

      const publicHealthHighlightAlertActionMatchV2 = url.pathname.match(/^\/api\/public-health\/highlights\/alerts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthHighlightAlertActionMatchV2) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/alerts/:id/actions");
        if (!user) return true;
        const alertId = decodeURIComponent(publicHealthHighlightAlertActionMatchV2[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const alerts = mergeByKey(seedPublicHealthAlerts(), data.publicHealthAlerts, "id");
        const index = alerts.findIndex((item) => item.id === alertId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到监测预警" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthHighlightAlertAction(alerts[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        alerts[index] = normalized.item;
        data.publicHealthAlerts = alerts;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-alert-action",
          target: alertId,
          result: "allowed",
          detail: `${normalized.history.action}/${normalized.item.status}/${normalized.history.note}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, alert: normalized.item, action: normalized.history, highlights: buildPublicHealthHighlights({ data: readDatabase() }) });
        return true;
      }

      const publicHealthCommandTaskActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/command-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCommandTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/command-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthCommandTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = mergeByKey(seedPublicHealthCommandTasks(), data.publicHealthCommandTasks, "id");
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到应急处置任务" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCommandTaskAction(tasks[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        tasks[index] = normalized.item;
        data.publicHealthCommandTasks = tasks;
        data.publicHealthEvidenceRecords = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id").map((item) => (
          item.id === "phec-command-dispatch"
            ? { ...item, status: "recorded", observed: Math.max(Number(item.observed || 0), tasks.filter((task) => task.owner && task.dueAt).length) }
            : item
        ));
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-command-task-action",
          target: taskId,
          result: "allowed",
          detail: `${normalized.history.action}/${normalized.item.status}/${normalized.history.note}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, task: normalized.item, action: normalized.history, highlights: buildPublicHealthHighlights({ data: readDatabase() }) });
        return true;
      }

      const publicHealthAiReviewActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/ai-reviews\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthAiReviewActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/ai-reviews/:id/actions");
        if (!user) return true;
        const reviewId = decodeURIComponent(publicHealthAiReviewActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const reviews = mergeByKey(seedPublicHealthAiReviews(), data.publicHealthAiReviews, "id");
        const index = reviews.findIndex((item) => item.id === reviewId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到AI研判建议" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthAiReviewAction(reviews[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        reviews[index] = normalized.item;
        data.publicHealthAiReviews = reviews;
        data.publicHealthEvidenceRecords = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id").map((item) => (
          item.id === "phec-ai-human-review"
            ? { ...item, status: "verified", observed: Math.max(Number(item.observed || 0), reviews.filter((review) => review.humanApprovalRequired).length) }
            : item
        ));
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-ai-review-action",
          target: reviewId,
          result: "allowed",
          detail: `${normalized.history.action}/${normalized.item.status}/${normalized.history.note}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, review: normalized.item, action: normalized.history, highlights: buildPublicHealthHighlights({ data: readDatabase() }) });
        return true;
      }

      const publicHealthEvidenceActionMatch = url.pathname.match(/^\/api\/public-health\/highlights\/evidence\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthEvidenceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/highlights/evidence/:id/actions");
        if (!user) return true;
        const evidenceId = decodeURIComponent(publicHealthEvidenceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const records = mergeByKey(seedPublicHealthEvidenceRecords(), data.publicHealthEvidenceRecords, "id");
        const index = records.findIndex((item) => item.id === evidenceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到证据链记录" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthEvidenceAction(records[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        records[index] = normalized.item;
        data.publicHealthEvidenceRecords = records;
        data.securityEvents = sealAuditTrail([{
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "public-health-highlight-evidence-action",
          target: evidenceId,
          result: "allowed",
          detail: `${normalized.history.action}/${normalized.item.status}/${normalized.history.artifactName || normalized.history.note}`
        }, ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])].slice(0, 120), { recompute: true });
        writeDatabase(normalizeState(data));
        sendJson(res, 200, { ok: true, evidence: normalized.item, action: normalized.history, highlights: buildPublicHealthHighlights({ data: readDatabase() }) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/standard-implementation-ledger") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/standard-implementation-ledger");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-standard-implementation-ledger",
          target: "/api/public-health/standard-implementation-ledger",
          result: "allowed",
          detail: `${system.standardImplementationBoard?.summary?.mappingComplete || 0}/${system.standardImplementationBoard?.summary?.domains || 0} standard mappings complete`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.standardImplementationBoard?.summary || {},
          board: system.standardImplementationBoard,
          entries: system.standardImplementationLedger || [],
          standardImplementationEvidenceCandidates: system.standardImplementationEvidenceCandidates || []
        });
        return true;
      }

      const publicHealthStandardImplementationActionMatch = url.pathname.match(/^\/api\/public-health\/standard-implementation-ledger\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthStandardImplementationActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/standard-implementation-ledger/:id/actions");
        if (!user) return true;
        const entryId = decodeURIComponent(publicHealthStandardImplementationActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const ledger = mergeByKey(seedPublicHealthStandardImplementationLedger(), data.publicHealthStandardImplementationLedger, "id");
        const index = ledger.findIndex((item) => item.id === entryId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health standard implementation entry not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthStandardImplementationAction(ledger[index], payload, data, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        ledger[index] = normalized.entry;
        data.publicHealthStandardImplementationLedger = ledger;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((row) => (
          row.id === "phev-standard-implementation-ledger"
            ? { ...row, status: "standard implementation action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthStandardImplementationLedger"])) }
            : row
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-standard-implementation-action",
            target: entryId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.gapStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, 200, {
          ok: true,
          entry: normalized.entry,
          action: normalized.history,
          board: system.standardImplementationBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-readiness") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-readiness");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        const readiness = system.cutoverReadiness || buildPublicHealthCutoverReadiness(system.cutoverBlockers || []);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-readiness",
          target: "/api/public-health/cutover-readiness",
          result: "allowed",
          detail: `${readiness.readinessLevel} / ${readiness.releaseGate} / ${readiness.summary?.p0Open || 0} P0 open`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          productionReady: readiness.releaseGate === "production-ready",
          summary: readiness.summary,
          readiness,
          blockers: system.cutoverBlockers || []
        });
        return true;
      }

      const publicHealthEventActionMatch = url.pathname.match(/^\/api\/public-health\/events\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthEventActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/events/:id/actions");
        if (!user) return true;
        const eventId = decodeURIComponent(publicHealthEventActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const events = Array.isArray(data.publicHealthEvents) ? data.publicHealthEvents : seedPublicHealthEvents();
        const index = events.findIndex((item) => item.id === eventId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生事件" });
          return true;
        }
        const { event, history } = normalizePublicHealthEventAction(events[index], payload, user);
        events[index] = event;
        data.publicHealthEvents = events;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-event-command"
            ? { ...item, status: "动作闭环已验证", nextAction: "继续接入正式事件分级、处置时限、信息发布审批和现场签字材料。" }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-event-action",
            target: eventId,
            result: "allowed",
            detail: `${history.label} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          event,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthExchangeExceptionActionMatch = url.pathname.match(/^\/api\/public-health\/exchange-runs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthExchangeExceptionActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/exchange-runs/:id/actions");
        if (!user) return true;
        const runId = decodeURIComponent(publicHealthExchangeExceptionActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const runs = mergeByKey(seedPublicHealthExchangeRuns(), data.publicHealthExchangeRuns, "id");
        const index = runs.findIndex((item) => item.id === runId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health exchange run not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthExchangeExceptionAction(runs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        runs[index] = normalized.run;
        data.publicHealthExchangeRuns = runs;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((item) => (
          item.id === "phev-exchange-security"
            ? { ...item, status: "exchange exception compensation recorded", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthExchangeRuns"])) }
            : item
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-exchange-exception-action",
            target: runId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.compensationReceiptId || "pending"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          run: normalized.run,
          action: normalized.history,
          system: buildPublicHealthSystem({ data: readDatabase() })
        });
        return true;
      }

      const publicHealthExchangeRunMatch = url.pathname.match(/^\/api\/public-health\/exchange-tasks\/([^/]+)\/runs$/);
      if (req.method === "POST" && publicHealthExchangeRunMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/exchange-tasks/:id/runs");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthExchangeRunMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = Array.isArray(data.publicHealthExchangeTasks) ? data.publicHealthExchangeTasks : seedPublicHealthExchangeTasks();
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生交换任务" });
          return true;
        }
        const { run, task } = normalizePublicHealthExchangeRun(tasks[index], payload, user);
        tasks[index] = task;
        data.publicHealthExchangeTasks = tasks;
        data.publicHealthExchangeRuns = [run, ...(Array.isArray(data.publicHealthExchangeRuns) ? data.publicHealthExchangeRuns : [])].slice(0, 120);
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-exchange-security"
            ? { ...item, status: "运行回执已验证", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthExchangeRuns"])) }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-exchange-run",
            target: taskId,
            result: "allowed",
            detail: `${run.status} / ${run.receiptStatus} / ${run.compensationStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task,
          run,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthInstitutionTaskActionMatch = url.pathname.match(/^\/api\/public-health\/institution-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthInstitutionTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/institution-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthInstitutionTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = Array.isArray(data.publicHealthInstitutionTasks) ? data.publicHealthInstitutionTasks : seedPublicHealthInstitutionTasks();
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生机构协同任务" });
          return true;
        }
        const { task, history } = normalizePublicHealthInstitutionTaskAction(tasks[index], payload, user);
        tasks[index] = task;
        data.publicHealthInstitutionTasks = tasks;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((item) => (
          item.id === "phev-institution-collaboration"
            ? { ...item, status: "机构协同已验证", evidence: Array.from(new Set([...(item.evidence || []), "publicHealthInstitutionTasks"])) }
            : item
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-institution-task-action",
            target: taskId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          task,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthOnsiteAcceptanceActionMatch = url.pathname.match(/^\/api\/public-health\/onsite-acceptances\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthOnsiteAcceptanceActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/onsite-acceptances/:id/actions");
        if (!user) return true;
        const acceptanceId = decodeURIComponent(publicHealthOnsiteAcceptanceActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const acceptances = Array.isArray(data.publicHealthOnsiteAcceptances) ? data.publicHealthOnsiteAcceptances : seedPublicHealthOnsiteAcceptances();
        const index = acceptances.findIndex((item) => item.id === acceptanceId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生现场验收项" });
          return true;
        }
        const { item, history } = normalizePublicHealthOnsiteAcceptanceAction(acceptances[index], payload, user);
        acceptances[index] = item;
        data.publicHealthOnsiteAcceptances = acceptances;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-onsite-acceptance"
            ? { ...row, status: "现场验收动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthOnsiteAcceptances"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-onsite-acceptance",
            target: acceptanceId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          acceptance: item,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      const publicHealthCutoverBlockerActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-blockers\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverBlockerActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-blockers/:id/actions");
        if (!user) return true;
        const blockerId = decodeURIComponent(publicHealthCutoverBlockerActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const blockers = Array.isArray(data.publicHealthCutoverBlockers) ? data.publicHealthCutoverBlockers : seedPublicHealthCutoverBlockers();
        const index = blockers.findIndex((item) => item.id === blockerId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生上线阻塞项" });
          return true;
        }
        const { item, history } = normalizePublicHealthCutoverBlockerAction(blockers[index], payload, user);
        blockers[index] = item;
        data.publicHealthCutoverBlockers = blockers;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-blockers"
            ? { ...row, status: "上线阻塞动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverBlockers"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-blocker-action",
            target: blockerId,
            result: "allowed",
            detail: `${history.action} / ${history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          blocker: item,
          action: history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-evidence-packets") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-evidence-packets");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-evidence-packets",
          target: "/api/public-health/cutover-evidence-packets",
          result: "allowed",
          detail: `${system.cutoverEvidenceBoard?.summary?.packets || 0} packets / ${system.cutoverEvidenceBoard?.summary?.verifiedItems || 0} verified items`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.cutoverEvidenceBoard?.summary || {},
          board: system.cutoverEvidenceBoard,
          packets: system.cutoverEvidencePackets || []
        });
        return true;
      }

      const publicHealthCutoverEvidencePacketActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-evidence-packets\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverEvidencePacketActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-evidence-packets/:id/actions");
        if (!user) return true;
        const packetId = decodeURIComponent(publicHealthCutoverEvidencePacketActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const blockers = Array.isArray(data.publicHealthCutoverBlockers) ? data.publicHealthCutoverBlockers : seedPublicHealthCutoverBlockers();
        const packets = Array.isArray(data.publicHealthCutoverEvidencePackets) ? data.publicHealthCutoverEvidencePackets : seedPublicHealthCutoverEvidencePackets(blockers);
        const index = packets.findIndex((item) => item.id === packetId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到公共卫生上线证据包" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCutoverEvidencePacketAction(packets[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        packets[index] = normalized.packet;
        data.publicHealthCutoverEvidencePackets = packets;
        data.publicHealthCutoverBlockers = blockers.map((row) => row.id === normalized.packet.blockerId
          ? {
              ...row,
              evidenceStatus: normalized.packet.signoffStatus === "signed" ? "packet-signed" : "packet-recorded",
              evidence: Array.from(new Set([...(row.evidence || []), normalized.history.artifactName].filter(Boolean)))
            }
          : row);
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-evidence-packets"
            ? { ...row, status: "证据包动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverEvidencePackets"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-evidence-packet-action",
            target: packetId,
            result: "allowed",
            detail: `${normalized.history.itemId} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        sendJson(res, 200, {
          ok: true,
          packet: normalized.packet,
          action: normalized.history,
          system: buildPublicHealthSystem({ data })
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/site-evidence-bridge") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-bridge");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-site-evidence-bridge",
          target: "/api/public-health/site-evidence-bridge",
          result: "allowed",
          detail: `${system.siteEvidenceBridge?.summary?.verifiedLinks || 0}/${system.siteEvidenceBridge?.summary?.links || 0} verified links`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          bridge: system.siteEvidenceBridge,
          summary: system.siteEvidenceBridge?.summary || {},
          links: system.siteEvidenceBridge?.links || []
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/cutover-drills") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-drills");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-cutover-drills",
          target: "/api/public-health/cutover-drills",
          result: "allowed",
          detail: `${system.cutoverDrillBoard?.summary?.blockedDrills || 0}/${system.cutoverDrillBoard?.summary?.drills || 0} drills blocked`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.cutoverDrillBoard?.summary || {},
          board: system.cutoverDrillBoard,
          drills: system.cutoverDrills || []
        });
        return true;
      }

      const publicHealthCutoverDrillActionMatch = url.pathname.match(/^\/api\/public-health\/cutover-drills\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthCutoverDrillActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/cutover-drills/:id/actions");
        if (!user) return true;
        const drillId = decodeURIComponent(publicHealthCutoverDrillActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const drills = Array.isArray(data.publicHealthCutoverDrills) ? data.publicHealthCutoverDrills : seedPublicHealthCutoverDrills();
        const index = drills.findIndex((item) => item.id === drillId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health cutover drill not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthCutoverDrillAction(drills[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        drills[index] = normalized.drill;
        data.publicHealthCutoverDrills = drills;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-cutover-drills"
            ? { ...row, status: "上线演练动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthCutoverDrills"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-cutover-drill-action",
            target: drillId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.goNoGo}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          drill: normalized.drill,
          action: normalized.history,
          board: system.cutoverDrillBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/production-handoffs") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/production-handoffs");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-production-handoffs",
          target: "/api/public-health/production-handoffs",
          result: "allowed",
          detail: `${system.productionHandoffBoard?.summary?.acceptedHandoffs || 0}/${system.productionHandoffBoard?.summary?.handoffs || 0} handoffs accepted`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.productionHandoffBoard?.summary || {},
          board: system.productionHandoffBoard,
          handoffs: system.productionHandoffs || []
        });
        return true;
      }

      const publicHealthProductionHandoffActionMatch = url.pathname.match(/^\/api\/public-health\/production-handoffs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthProductionHandoffActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/production-handoffs/:id/actions");
        if (!user) return true;
        const handoffId = decodeURIComponent(publicHealthProductionHandoffActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const handoffs = Array.isArray(data.publicHealthProductionHandoffs) ? data.publicHealthProductionHandoffs : seedPublicHealthProductionHandoffs();
        const index = handoffs.findIndex((item) => item.id === handoffId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health production handoff not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthProductionHandoffAction(handoffs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        handoffs[index] = normalized.handoff;
        data.publicHealthProductionHandoffs = handoffs;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-production-handoffs"
            ? { ...row, status: "production handoff action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthProductionHandoffs"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-production-handoff-action",
            target: handoffId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          handoff: normalized.handoff,
          action: normalized.history,
          board: system.productionHandoffBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/go-live-observations") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/go-live-observations");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-go-live-observations",
          target: "/api/public-health/go-live-observations",
          result: "allowed",
          detail: `${system.goLiveObservationBoard?.summary?.planReady || 0}/${system.goLiveObservationBoard?.summary?.observations || 0} observation plans ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.goLiveObservationBoard?.summary || {},
          board: system.goLiveObservationBoard,
          observations: system.goLiveObservations || []
        });
        return true;
      }

      const publicHealthGoLiveObservationActionMatch = url.pathname.match(/^\/api\/public-health\/go-live-observations\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthGoLiveObservationActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/go-live-observations/:id/actions");
        if (!user) return true;
        const observationId = decodeURIComponent(publicHealthGoLiveObservationActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const observations = Array.isArray(data.publicHealthGoLiveObservations) ? data.publicHealthGoLiveObservations : seedPublicHealthGoLiveObservations();
        const index = observations.findIndex((item) => item.id === observationId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health go-live observation not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthGoLiveObservationAction(observations[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        observations[index] = normalized.observation;
        data.publicHealthGoLiveObservations = observations;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-go-live-observation"
            ? { ...row, status: "go-live observation action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthGoLiveObservations"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-go-live-observation-action",
            target: observationId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          observation: normalized.observation,
          action: normalized.history,
          board: system.goLiveObservationBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-incidents") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-incidents");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-incidents",
          target: "/api/public-health/launch-incidents",
          result: "allowed",
          detail: `${system.launchIncidentBoard?.summary?.deskReady || 0}/${system.launchIncidentBoard?.summary?.lanes || 0} incident lanes ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchIncidentBoard?.summary || {},
          board: system.launchIncidentBoard,
          incidents: system.launchIncidents || []
        });
        return true;
      }

      const publicHealthLaunchIncidentActionMatch = url.pathname.match(/^\/api\/public-health\/launch-incidents\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchIncidentActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-incidents/:id/actions");
        if (!user) return true;
        const incidentId = decodeURIComponent(publicHealthLaunchIncidentActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const incidents = mergeByKey(seedPublicHealthLaunchIncidents(), data.publicHealthLaunchIncidents, "id");
        const index = incidents.findIndex((item) => item.id === incidentId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch incident not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchIncidentAction(incidents[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        incidents[index] = normalized.incident;
        data.publicHealthLaunchIncidents = incidents;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-incident-desk"
            ? { ...row, status: "launch incident action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchIncidents"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-incident-action",
            target: incidentId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          incident: normalized.incident,
          action: normalized.history,
          board: system.launchIncidentBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-duty-shifts") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-duty-shifts");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-duty-shifts",
          target: "/api/public-health/launch-duty-shifts",
          result: "allowed",
          detail: `${system.launchDutyBoard?.summary?.readyShifts || 0}/${system.launchDutyBoard?.summary?.shifts || 0} duty shifts ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchDutyBoard?.summary || {},
          board: system.launchDutyBoard,
          shifts: system.launchDutyShifts || []
        });
        return true;
      }

      const publicHealthLaunchDutyShiftActionMatch = url.pathname.match(/^\/api\/public-health\/launch-duty-shifts\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchDutyShiftActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-duty-shifts/:id/actions");
        if (!user) return true;
        const shiftId = decodeURIComponent(publicHealthLaunchDutyShiftActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const shifts = mergeByKey(seedPublicHealthLaunchDutyShifts(), data.publicHealthLaunchDutyShifts, "id");
        const index = shifts.findIndex((item) => item.id === shiftId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch duty shift not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchDutyShiftAction(shifts[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        shifts[index] = normalized.shift;
        data.publicHealthLaunchDutyShifts = shifts;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-duty-shifts"
            ? { ...row, status: "launch duty handoff action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchDutyShifts"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-duty-shift-action",
            target: shiftId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.signalStatus}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          shift: normalized.shift,
          action: normalized.history,
          board: system.launchDutyBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-command-briefs") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-command-briefs");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-command-briefs",
          target: "/api/public-health/launch-command-briefs",
          result: "allowed",
          detail: `${system.launchCommandBriefBoard?.summary?.readyBriefs || 0}/${system.launchCommandBriefBoard?.summary?.briefs || 0} launch command briefs ready`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.launchCommandBriefBoard?.summary || {},
          board: system.launchCommandBriefBoard,
          briefs: system.launchCommandBriefs || []
        });
        return true;
      }

      const publicHealthLaunchCommandBriefActionMatch = url.pathname.match(/^\/api\/public-health\/launch-command-briefs\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthLaunchCommandBriefActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-command-briefs/:id/actions");
        if (!user) return true;
        const briefId = decodeURIComponent(publicHealthLaunchCommandBriefActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const briefs = mergeByKey(seedPublicHealthLaunchCommandBriefs(), data.publicHealthLaunchCommandBriefs, "id");
        const index = briefs.findIndex((item) => item.id === briefId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch command brief not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchCommandBriefAction(briefs[index], payload, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        briefs[index] = normalized.brief;
        data.publicHealthLaunchCommandBriefs = briefs;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-command-briefs"
            ? { ...row, status: "launch command brief action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchCommandBriefs"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-command-brief-action",
            target: briefId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.decision}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          brief: normalized.brief,
          action: normalized.history,
          board: system.launchCommandBriefBoard,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/site-evidence-verification-tasks") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-verification-tasks");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-site-evidence-verification-tasks",
          target: "/api/public-health/site-evidence-verification-tasks",
          result: "allowed",
          detail: `${system.siteEvidenceVerificationBoard?.summary?.verifiedTasks || 0}/${system.siteEvidenceVerificationBoard?.summary?.tasks || 0} site evidence verification tasks verified`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          summary: system.siteEvidenceVerificationBoard?.summary || {},
          board: system.siteEvidenceVerificationBoard,
          tasks: system.siteEvidenceVerificationTasks || []
        });
        return true;
      }

      const publicHealthSiteEvidenceVerificationTaskActionMatch = url.pathname.match(/^\/api\/public-health\/site-evidence-verification-tasks\/([^/]+)\/actions$/);
      if (req.method === "POST" && publicHealthSiteEvidenceVerificationTaskActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-verification-tasks/:id/actions");
        if (!user) return true;
        const taskId = decodeURIComponent(publicHealthSiteEvidenceVerificationTaskActionMatch[1]);
        const payload = await collectJson(req);
        const data = readDatabase();
        const tasks = mergeByKey(seedPublicHealthSiteEvidenceVerificationTasks(), data.publicHealthSiteEvidenceVerificationTasks, "id");
        const index = tasks.findIndex((item) => item.id === taskId);
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health site evidence verification task not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthSiteEvidenceVerificationTaskAction(tasks[index], payload, data, user);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        tasks[index] = normalized.task;
        data.publicHealthSiteEvidenceVerificationTasks = tasks;
        data.publicHealthReadinessEvidence = mergeByKey(seedPublicHealthReadinessEvidence(), data.publicHealthReadinessEvidence, "id").map((row) => (
          row.id === "phev-site-evidence-verification-desk"
            ? { ...row, status: "site evidence verification action recorded", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthSiteEvidenceVerificationTasks", "siteLaunchEvidence"])) }
            : row
        ));
        data.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-site-evidence-verification-action",
            target: taskId,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status} / ${normalized.history.evidenceId || "no-evidence"}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, 200, {
          ok: true,
          task: normalized.task,
          action: normalized.history,
          board: system.siteEvidenceVerificationBoard,
          system
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/site-evidence-bridge/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/site-evidence-bridge/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const data = readDatabase();
        const linkId = String(payload.linkId || payload.bridgeId || payload.id || "").trim();
        const templateId = String(payload.templateId || "").trim();
        const bridge = buildPublicHealthSiteEvidenceBridge(data.siteLaunchEvidence);
        const link = bridge.links.find((item) => (linkId && item.id === linkId) || (templateId && item.templateId === templateId))
          || PUBLIC_HEALTH_SITE_EVIDENCE_LINKS.find((item) => (linkId && item.id === linkId) || (templateId && item.templateId === templateId));
        if (!link) {
          sendJson(res, 404, { error: "Not Found", message: "public health site evidence bridge link not found" });
          return true;
        }
        let upsertResult;
        try {
          upsertResult = upsertSiteLaunchEvidence(data, user, {
            ...payload,
            templateId: link.templateId,
            status: payload.status || "verified",
            artifactName: payload.artifactName || payload.artifact || link.requirement || "public health site evidence",
            jointTestNo: payload.jointTestNo || payload.receiptNo || `PH-SITE-${Date.now()}`,
            attachmentNames: payload.attachmentNames || payload.attachments || [`${link.id}.pdf`],
            note: payload.note || `Mapped to public health evidence packet ${link.packetId}.`
          });
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        const latestData = readDatabase();
        latestData.publicHealthReadinessEvidence = (Array.isArray(latestData.publicHealthReadinessEvidence) ? latestData.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-site-evidence-bridge"
            ? { ...row, status: "现场材料桥接已记录", evidence: Array.from(new Set([...(row.evidence || []), "siteLaunchEvidence", "publicHealthSiteEvidenceBridge"])) }
            : row
        ));
        latestData.securityEvents = sealAuditTrail([
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-site-evidence-bridge-action",
            target: link.id,
            result: "allowed",
            detail: `${link.templateId} -> ${link.packetId}`
          },
          ...(Array.isArray(latestData.securityEvents) ? latestData.securityEvents : [])
        ].slice(0, 120), { recompute: true });
        writeDatabase(latestData);
        const system = buildPublicHealthSystem({ data: readDatabase() });
        sendJson(res, upsertResult.status || 200, {
          ok: true,
          evidence: upsertResult.body?.evidence,
          link: system.siteEvidenceBridge?.links?.find((item) => item.id === link.id) || link,
          bridge: system.siteEvidenceBridge,
          system
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/public-health/launch-gate") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-gate");
        if (!user) return true;
        const data = readDatabase();
        const system = buildPublicHealthSystem({ data });
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "public-health-launch-gate",
          target: "/api/public-health/launch-gate",
          result: "allowed",
          detail: `${system.launchGate?.status || "unknown"} / ${system.launchGate?.summary?.blockedRequirements || 0} blocked requirements`
        });
        sendJson(res, 200, {
          ok: true,
          generatedAt: system.generatedAt,
          gate: system.launchGate,
          summary: system.launchGate?.summary || {},
          approvals: system.launchApprovals || [],
          requirements: system.launchGate?.requirements || [],
          approvalPreflight: system.launchGate?.approvalPreflight || {}
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/public-health/launch-gate/actions") {
        const user = requireApiRole(req, res, ["commission"], "/api/public-health/launch-gate/actions");
        if (!user) return true;
        const payload = await collectJson(req);
        const approvalId = String(payload.approvalId || payload.id || "").trim();
        const data = readDatabase();
        const approvals = Array.isArray(data.publicHealthLaunchApprovals) ? data.publicHealthLaunchApprovals : seedPublicHealthLaunchApprovals();
        const currentSystem = buildPublicHealthSystem({ data });
        const index = approvalId
          ? approvals.findIndex((item) => item.id === approvalId)
          : approvals.findIndex((item) => !/approved|signed|accepted|complete|已批准|已签署|已完成/i.test(`${item.status || ""} ${item.decision || ""}`));
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "public health launch approval not found" });
          return true;
        }
        let normalized;
        try {
          normalized = normalizePublicHealthLaunchGateAction(approvals[index], payload, user, currentSystem.launchGate?.approvalPreflight || {});
        } catch (error) {
          const statusCode = /launch approval is blocked until all prerequisite launch requirements pass/.test(String(error.message || "")) ? 409 : 400;
          sendJson(res, statusCode, { error: statusCode === 409 ? "Conflict" : "Bad Request", message: error.message });
          return true;
        }
        approvals[index] = normalized.approval;
        data.publicHealthLaunchApprovals = approvals;
        data.publicHealthReadinessEvidence = (Array.isArray(data.publicHealthReadinessEvidence) ? data.publicHealthReadinessEvidence : seedPublicHealthReadinessEvidence()).map((row) => (
          row.id === "phev-launch-gate"
            ? { ...row, status: "上线审批动作已记录", evidence: Array.from(new Set([...(row.evidence || []), "publicHealthLaunchApprovals"])) }
            : row
        ));
        data.securityEvents = [
          {
            id: randomUUID(),
            at: new Date().toLocaleString("zh-CN", { hour12: false }),
            actor: user.name,
            role: user.role,
            action: "public-health-launch-gate-action",
            target: normalized.approval.id,
            result: "allowed",
            detail: `${normalized.history.action} / ${normalized.history.status}`
          },
          ...(Array.isArray(data.securityEvents) ? data.securityEvents : [])
        ].slice(0, 120);
        writeDatabase(data);
        const system = buildPublicHealthSystem({ data });
        sendJson(res, 200, {
          ok: true,
          approval: normalized.approval,
          action: normalized.history,
          gate: system.launchGate,
          system
        });
        return true;
      }
        return false;
      }
    },
    {
      id: "public-health-03",
      domain: "public-health",
      async handle(req, res, url) {
    if (req.method === "GET" && url.pathname === "/api/birth-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission", "citizen"], "/api/birth-certificates");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId");
        if (!canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问出生医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民出生医学证明" });
          return true;
        }
        const certificates = (data.birthCertificates || []).filter((item) => !residentId || item.maternalResidentId === residentId || item.residentId === residentId);
        sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.birthStatistics, forms: data.birthCertificateForms }, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/birth-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/birth-certificates");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let certificate;
        try {
          certificate = normalizeBirthCertificate(payload, user, data);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!canAccessResident(user, certificate.maternalResidentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "登记出生医学证明", target: certificate.maternalResidentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民出生医学证明" });
          return true;
        }
        data.birthCertificates = [certificate, ...(Array.isArray(data.birthCertificates) ? data.birthCertificates : [])].slice(0, 200);
        refreshBirthStatistics(data);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "登记出生医学证明",
          target: certificate.certificateNo,
          result: "允许",
          detail: `${certificate.newbornName} · ${certificate.issueType} · ${certificate.issuingInstitution}`
        });
        const normalized = normalizeState(data);
        if (Object.hasOwn(payload, "expectedVersion")) {
          normalized.storageMeta = {
            collectionVersions: { birthCertificates: Number(payload.expectedVersion) }
          };
        }
        writeDatabase(normalized);
        sendJson(res, 201, certificate);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/death-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
        if (!user) return true;
        const data = readDatabase();
        const residentId = url.searchParams.get("residentId");
        if (!canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "访问死亡医学证明", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权访问该居民死亡证明" });
          return true;
        }
        const certificates = (data.deathCertificates || []).filter((item) => !residentId || item.residentId === residentId);
        sendJson(res, 200, redactSensitiveResponse({ certificates, statistics: data.deathStatistics, forms: data.deathCertificateForms }, user));
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/death-certificates") {
        const user = requireApiRole(req, res, ["institution", "commission"], "/api/death-certificates");
        if (!user) return true;
        const data = readDatabase();
        const payload = await collectJson(req);
        let certificate;
        try {
          certificate = normalizeDeathCertificate(payload, user, data);
        } catch (error) {
          sendJson(res, 400, { error: "Bad Request", message: error.message });
          return true;
        }
        if (!canAccessResident(user, certificate.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "登记死亡医学证明", target: certificate.residentId, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权登记该居民死亡证明" });
          return true;
        }
        data.deathCertificates = [certificate, ...(Array.isArray(data.deathCertificates) ? data.deathCertificates : [])].slice(0, 200);
        refreshDeathStatistics(data);
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "登记死亡医学证明",
          target: certificate.certificateNo,
          result: "允许",
          detail: `${certificate.deceasedName} · ${certificate.deathReasonType} · ${certificate.reportChannel}`
        });
        const normalized = normalizeState(data);
        if (Object.hasOwn(payload, "expectedVersion")) {
          normalized.storageMeta = {
            collectionVersions: { deathCertificates: Number(payload.expectedVersion) }
          };
        }
        writeDatabase(normalized);
        sendJson(res, 201, certificate);
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
