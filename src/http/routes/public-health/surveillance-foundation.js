"use strict";

function createRouteSegment(runtime) {
  const { PUBLIC_HEALTH_RESPIRATORY_NETWORK_EVIDENCE_CLIENT_FIELDS, PUBLIC_HEALTH_SITE_EVIDENCE_LINKS, RESPIRATORY_PANEL, activatePublicHealthSurveillanceRuleChangeToState, appendPublicHealthEndpointProbeCampaignAudit, appendSecurityEvent, applyPublicHealthCoordinationActionToState, applyPublicHealthMedicalPreventionTaskActionToState, applyPublicHealthSurveillanceAlertActionToState, assertPublicHealthOfficialExchangeCallbackPayload, assertPublicHealthRespiratoryNetworkEvidencePayload, assertPublicHealthRespiratoryPayload, assertPublicHealthRuleChangePayload, assertPublicHealthSurveillanceModelPayload, buildPublicHealthCoordinationRuntime, buildPublicHealthCutoverReadiness, buildPublicHealthDataFoundation, buildPublicHealthEndpointProbeCampaignSummary, buildPublicHealthEndpointVerificationSummary, buildPublicHealthExternalContractCutoverBoard, buildPublicHealthExternalOperationsBoard, buildPublicHealthHighlights, buildPublicHealthKeySafetyBoard, buildPublicHealthMedicalPreventionBoard, buildPublicHealthSiteEvidenceBridge, buildPublicHealthSystem, canAccessResident, claimPublicHealthExternalDispatchToState, collectJson, contractAttestationUniqueKey, createHash, enqueuePublicHealthExternalDispatchToState, evaluatePublicHealthSurveillanceSignalToState, ingestPublicHealthRespiratoryPathogenBatchToState, ingestPublicHealthSurveillanceSignalToState, issueTrustedRespiratoryNetworkEvidenceReceipt, listDuePublicHealthExternalDispatches, loadAvailablePublicHealthCredentialMap, loadPublicHealthLaneCredentials, mergeByKey, normalizeBirthCertificate, normalizeDeathCertificate, normalizePublicHealthAiReviewAction, normalizePublicHealthCommandTaskAction, normalizePublicHealthCutoverBlockerAction, normalizePublicHealthCutoverDrillAction, normalizePublicHealthCutoverEvidencePacketAction, normalizePublicHealthEventAction, normalizePublicHealthEvidenceAction, normalizePublicHealthExchangeExceptionAction, normalizePublicHealthExchangeRun, normalizePublicHealthGoLiveObservationAction, normalizePublicHealthHighlightAlertAction, normalizePublicHealthInstitutionTaskAction, normalizePublicHealthLaunchCommandBriefAction, normalizePublicHealthLaunchDutyShiftAction, normalizePublicHealthLaunchGateAction, normalizePublicHealthLaunchIncidentAction, normalizePublicHealthOnsiteAcceptanceAction, normalizePublicHealthProductionHandoffAction, normalizePublicHealthSignal, normalizePublicHealthSiteEvidenceVerificationTaskAction, normalizePublicHealthStandardImplementationAction, normalizeState, prependAuditTrailEntry, proposePublicHealthSurveillanceRuleChangeToState, publicHealthContractAttestationRequestDigest, publicHealthContractGovernanceAuditEvent, publicHealthContractGovernanceContext, publicHealthCredentialsForDispatch, publicHealthEndpointProbeCampaignAuditEntry, publicHealthEndpointProbeCampaignHttpStatus, publicHealthEndpointProbeCampaignSafeCode, publicHealthEndpointProbeHttpStatus, publicHealthEndpointProbeSafeCode, publicHealthEndpointVerificationContext, publicHealthExternalAttemptOptions, publicHealthExternalHttpStatus, publicHealthExternalLaneVersion, publicHealthExternalPublicView, publicHealthExternalResult, publicHealthExternalWorkerId, publicHealthModernizationCommand, publicHealthModernizationConflict, publicHealthModernizationError, publicHealthOfficialExchangeCallbackError, publicHealthOfficialExchangeReceiptOptions, publicHealthRespiratoryNetworkEvidenceActor, publicHealthRespiratoryNetworkEvidenceAuditDigest, publicHealthRespiratoryNetworkEvidenceOptions, publicHealthRespiratoryNetworkEvidenceRequestFingerprint, publicHealthRespiratoryPathogenActor, publicHealthSafeAlert, publicHealthSafeDataSourceOperations, publicHealthSafeMedicalPreventionTask, publicHealthSafeOfficialExchangeReceipt, publicHealthSafeRespiratoryNetworkReadiness, publicHealthSafeRespiratoryPathogenBatch, publicHealthSafeRespiratoryPathogenSurveillance, publicHealthSafeRuleGovernance, publicHealthSafeSignal, publicHealthSafeSurveillanceCenter, publicHealthSafeSurveillanceModelGovernance, publicHealthSurveillanceModelActor, publicHealthSurveillanceRuleActivationOptions, publishPublicHealthRespiratoryPathogenSignalsToState, randomUUID, readDatabase, recordClaimedPublicHealthExternalAttemptToState, recordPublicHealthExternalAttemptToState, recordPublicHealthOfficialExchangeCallback, redactSensitiveResponse, refreshBirthStatistics, refreshDeathStatistics, requestPublicHealthRespiratoryNetworkLifecycle, requeuePublicHealthExternalDeadLetterToState, requireApiRole, requirePublicHealthOfficialExchangeCallback, reviewPublicHealthRespiratoryNetworkLifecycle, reviewPublicHealthSurveillanceModelValidationToState, reviewPublicHealthSurveillanceRuleChangeToState, runControlledPublicHealthEndpointProbe, runControlledPublicHealthEndpointProbeCampaign, runPublicHealthSurveillanceModelToState, sealAuditTrail, seedPublicHealthAiReviews, seedPublicHealthAlerts, seedPublicHealthCommandTasks, seedPublicHealthCutoverBlockers, seedPublicHealthCutoverDrills, seedPublicHealthCutoverEvidencePackets, seedPublicHealthEvents, seedPublicHealthEvidenceRecords, seedPublicHealthExchangeRuns, seedPublicHealthExchangeTasks, seedPublicHealthGoLiveObservations, seedPublicHealthInstitutionTasks, seedPublicHealthLaunchApprovals, seedPublicHealthLaunchCommandBriefs, seedPublicHealthLaunchDutyShifts, seedPublicHealthLaunchIncidents, seedPublicHealthOnsiteAcceptances, seedPublicHealthProductionHandoffs, seedPublicHealthReadinessEvidence, seedPublicHealthSignals, seedPublicHealthSiteEvidenceVerificationTasks, seedPublicHealthStandardImplementationLedger, sendJson, signTrustedPublicHealthContractAttestation, submitPublicHealthSurveillanceModelValidationToState, upsertSiteLaunchEvidence, verifyPublicHealthExternalEndpointProbeReceipt, verifyPublicHealthRespiratoryPathogenBatchToState, verifyPublicHealthSurveillanceSignalToState, verifyTrustedRespiratoryNetworkEvidence, writeDatabase } = runtime;
  return {
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
    };
}

module.exports = { createRouteSegment, ROUTE_SEGMENT_ID: "public-health-01", SUBDOMAIN: "surveillance-foundation" };
