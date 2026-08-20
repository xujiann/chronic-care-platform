"use strict";

const {
  SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT,
  SessionSecurityAuditError,
  appendSessionSecurityAudit,
  createSessionSecurityAuditRepository,
  executeSecurityControlAction,
  normalizeSessionSecurityAuditQuery,
  querySessionSecurityAudits,
  summarizeSessionSecurityAudits
} = require("../../identity-security/session-security-audit");
const {
  IdentityPolicyError,
  bindExternalIdentity,
  clearSessionCookies,
  csrfToken,
  identityClaims,
  issueSessionCookies,
  publicIdentity,
  requireCsrf,
  requireStepUp,
  resolveExternalIdentity,
  securityReadiness,
  sessionFromRequest,
  sessionResponse,
  sessionTransport,
  stepUpStatus,
  validateLiveSession,
  validateLocalAccount
} = require("../../identity-security/runtime-identity-policy");

function createRouteSegments(runtime) {
  const { SmsDeliveryCallbackError, appendDataAccessLog, appendSecurityEvent, applyIdentityDirectoryBinding, applyIdentityDirectoryDeactivations, applySmsDeliveryCallback, buildComplianceReport, buildIdentityDirectorySyncPlan, buildSmsDeliveryCenter, canAccessResident, cleanupRuntimeSessions, collectJson, createSession, currentSession, fetchIdentityDirectory, fetchOidcUserInfo, findAuthUser, findCitizenAuthUserByPhone, highRiskSecurityEvents, isProductionRuntime, issuePhoneVerificationCode, mapExternalIdentityClaims, maskPhone, normalizePhone, normalizeState, phoneLoginLockStatus, prependAuditTrailEntry, productionAdapterCenter, randomUUID, readDatabase, recordPhoneLoginFailure, redactSensitiveResponse, refreshOidcAccessToken, refreshSessionStoreStatus, requireApiRole, revokeOidcToken, revokeSession, sendJson, sessionStoreStatus, verifyAuditTrail, verifyPassword, verifyPhoneCode, verifySmsDeliveryCallback, writeDatabase } = runtime;
  let auditRepository;
  const sessionSecurityAuditRepository = () => {
    auditRepository ||= createSessionSecurityAuditRepository({
      readDatabase,
      writeDatabase,
      prependAuditTrailEntry,
      randomUUID
    });
    return auditRepository;
  };
  const recordSessionAudit = (req, event, session, legacyEvent) => appendSessionSecurityAudit({
    req,
    session,
    event,
    legacyEvent,
    randomUUID,
    repository: sessionSecurityAuditRepository()
  });
  const passwordFailures = new Map();
  const passwordLockStatus = (username) => {
    const key = String(username || "").trim().toLowerCase();
    const entry = passwordFailures.get(key);
    if (!entry) return { locked: false, failedAttempts: 0, retryAfterSeconds: 0 };
    if (entry.lockedUntil > Date.now()) {
      return { locked: true, failedAttempts: entry.failedAttempts, retryAfterSeconds: Math.ceil((entry.lockedUntil - Date.now()) / 1000) };
    }
    if (entry.lockedUntil) passwordFailures.delete(key);
    return { locked: false, failedAttempts: entry.lockedUntil ? 0 : entry.failedAttempts, retryAfterSeconds: 0 };
  };
  const recordPasswordFailure = (username) => {
    const key = String(username || "").trim().toLowerCase();
    const previous = passwordFailures.get(key) || { failedAttempts: 0, lockedUntil: 0 };
    const failedAttempts = previous.failedAttempts + 1;
    const lockedUntil = failedAttempts >= 5 ? Date.now() + 15 * 60 * 1000 : 0;
    const next = { failedAttempts, lockedUntil };
    passwordFailures.set(key, next);
    return passwordLockStatus(key).locked ? passwordLockStatus(key) : { ...next, locked: false, retryAfterSeconds: 0 };
  };
  const clearPasswordFailures = (username) => passwordFailures.delete(String(username || "").trim().toLowerCase());
  const validateRuntimeAccount = (user) => {
    const data = readDatabase();
    return Array.isArray(data?.authUsers) ? validateLocalAccount(user, data).user : user;
  };
  const resolveSession = (req) => sessionFromRequest(req, currentSession, process.env);
  const rejectPolicy = (res, error) => {
    const known = error instanceof IdentityPolicyError;
    sendJson(res, known ? error.statusCode : 500, {
      ok: false,
      code: known ? error.code : "IDENTITY_POLICY_FAILED",
      message: known ? error.message : "identity policy evaluation failed"
    });
  };
  const enforceMutationSecurity = (req, res, options = {}) => {
    try {
      if (typeof isProductionRuntime !== "function" || !isProductionRuntime()) {
        const session = typeof currentSession === "function" ? currentSession(req) : null;
        const data = readDatabase();
        if (session && Array.isArray(data?.authUsers)) validateLiveSession(session, data);
        return { session, source: "development", transport: sessionTransport(process.env) };
      }
      const resolved = resolveSession(req);
      if (!resolved.session) throw new IdentityPolicyError("AUTHENTICATION_REQUIRED", "authenticated session is required", 401);
      validateLiveSession(resolved.session, readDatabase());
      requireCsrf(req, resolved, process.env);
      if (options.stepUp) requireStepUp(resolved.session, process.env);
      return resolved;
    } catch (error) {
      rejectPolicy(res, error);
      return null;
    }
  };
  return [
    {
      id: "identity-security-01",
      domain: "identity-security",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname === "/api/auth/identity/preview") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/identity/preview");
        if (!user) return true;
        const payload = await collectJson(req);
        const claims = payload.claims && typeof payload.claims === "object" ? payload.claims : payload;
        sendJson(res, 200, {
          ok: true,
          mappedAt: new Date().toISOString(),
          mapping: mapExternalIdentityClaims(claims, readDatabase())
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/audit/verify") {
        const user = requireApiRole(req, res, ["commission"], "/api/audit/verify");
        if (!user) return true;
        const data = normalizeState(readDatabase());
        const trails = {
          securityEvents: verifyAuditTrail(data.securityEvents),
          dataAccessLogs: verifyAuditTrail(data.dataAccessLogs)
        };
        sendJson(res, 200, {
          passed: Object.values(trails).every((item) => item.passed),
          verifiedAt: new Date().toISOString(),
          trails
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/audit/export") {
        const user = requireApiRole(req, res, ["commission"], "/api/audit/export");
        if (!user) return true;
        const data = readDatabase();
        const trail = url.searchParams.get("trail") || "all";
        sendJson(res, 200, {
          exportedAt: new Date().toISOString(),
          trail,
          securityEvents: trail === "all" || trail === "securityEvents" ? data.securityEvents || [] : [],
          dataAccessLogs: trail === "all" || trail === "dataAccessLogs" ? data.dataAccessLogs || [] : []
        });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/security/compliance-report") {
        const user = requireApiRole(req, res, ["commission"], "/api/security/compliance-report");
        if (!user) return true;
        sendJson(res, 200, buildComplianceReport(normalizeState(readDatabase())));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/security/high-risk-events") {
        const user = requireApiRole(req, res, ["commission"], "/api/security/high-risk-events");
        if (!user) return true;
        const events = highRiskSecurityEvents(readDatabase());
        sendJson(res, 200, { events, summary: { total: events.length } });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/security/session-audit") {
        const user = requireApiRole(req, res, ["commission"], "/api/security/session-audit");
        if (!user) return true;
        const query = normalizeSessionSecurityAuditQuery({
          correlationId: url.searchParams.get("correlationId"),
          action: url.searchParams.get("action"),
          result: url.searchParams.get("result"),
          limit: url.searchParams.get("limit")
        });
        const items = querySessionSecurityAudits(readDatabase().securityEvents, query);
        await recordSessionAudit(req, {
          actor: user.name,
          role: user.role,
          action: "session-security-audit-read",
          target: "/api/security/session-audit",
          result: "allowed",
          detail: `${items.length} events; correlation ${req.correlationId}`
        });
        sendJson(res, 200, {
          ok: true,
          correlationId: req.correlationId,
          filterApplied: {
            correlationId: Boolean(query.correlationId),
            action: Boolean(query.action),
            result: Boolean(query.result),
            limit: query.limit
          },
          summary: summarizeSessionSecurityAudits(items),
          events: items,
          persistence: SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/sms-delivery-callback") {
        try {
          const payload = await collectJson(req);
          const verified = verifySmsDeliveryCallback(payload, {
            timestamp: req.headers["x-sms-timestamp"],
            nonce: req.headers["x-sms-nonce"],
            signature: req.headers["x-sms-signature"]
          });
          const data = readDatabase();
          const result = applySmsDeliveryCallback(data, verified);
          writeDatabase(normalizeState(data));
          appendSecurityEvent({
            actor: "sms-provider",
            role: "external-adapter",
            action: "sms delivery callback",
            target: verified.providerMessageId,
            result: result.idempotentReplay ? "idempotent" : result.event.stateApplied ? "allowed" : "recorded-not-applied",
            detail: `${verified.eventId}:${verified.status}${result.event.ignoredReason ? `:${result.event.ignoredReason}` : ""}`
          });
          sendJson(res, 200, {
            ok: true,
            idempotentReplay: result.idempotentReplay,
            delivery: {
              providerMessageId: result.receipt.providerMessageId,
              status: result.receipt.status,
              latestEventAt: result.receipt.latestEventAt,
              productionEvidence: false
            },
            event: {
              eventId: result.event.eventId,
              status: result.event.status,
              stateApplied: result.event.stateApplied,
              ignoredReason: result.event.ignoredReason
            }
          });
        } catch (error) {
          const known = error instanceof SmsDeliveryCallbackError;
          const status = known ? error.statusCode : error instanceof SyntaxError ? 400 : 500;
          const code = known ? error.code : error instanceof SyntaxError ? "SMS_CALLBACK_BODY_INVALID" : "SMS_CALLBACK_FAILED";
          appendSecurityEvent({
            actor: "sms-provider",
            role: "external-adapter",
            action: "sms delivery callback",
            target: "/api/auth/sms-delivery-callback",
            result: "denied",
            detail: code
          });
          sendJson(res, status, { ok: false, code, message: known ? error.message : "SMS delivery callback failed" });
        }
        return true;
      }
        return false;
      }
    },
    {
      id: "identity-security-02",
      domain: "identity-security",
      async handle(req, res, url) {
    const securityControlActionMatch = url.pathname.match(/^\/api\/security\/controls\/([^/]+)\/actions$/);
      if (req.method === "POST" && securityControlActionMatch) {
        const user = requireApiRole(req, res, ["commission"], "/api/security/controls/:id/actions");
        if (!user) return true;
        if (!enforceMutationSecurity(req, res, { stepUp: true })) return true;
        const id = decodeURIComponent(securityControlActionMatch[1]);
        const payload = await collectJson(req);
        try {
          const outcome = await executeSecurityControlAction({
            repository: sessionSecurityAuditRepository(),
            commandId: req.headers?.["idempotency-key"],
            req,
            user,
            controlId: id,
            payload
          });
          sendJson(res, 200, {
            ...outcome.result,
            idempotentReplay: outcome.idempotentReplay,
            auditCorrelationId: outcome.entry.correlationId,
            productionReady: SESSION_SECURITY_AUDIT_PERSISTENCE_CONTRACT.productionReady
          });
        } catch (error) {
          const known = error instanceof SessionSecurityAuditError;
          sendJson(res, known ? error.statusCode : 500, {
            ok: false,
            code: known ? error.code : "SECURITY_CONTROL_ACTION_FAILED",
            message: known ? error.message : "security control action failed"
          });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/login") {
        if (isProductionRuntime()) {
          await recordSessionAudit(req,
            { actor: "anonymous", role: "anonymous", action: "local-password-login", target: "production", result: "denied", detail: "local password login is disabled in production" },
            undefined,
            { actor: "anonymous", role: "anonymous", action: "local-password-login", target: "production", result: "denied", detail: "local password login is disabled in production" }
          );
          sendJson(res, 403, { ok: false, code: "LOCAL_PASSWORD_LOGIN_DISABLED", message: "local password login is disabled in production" });
          return true;
        }
        const credentials = await collectJson(req);
        const username = String(credentials.username || "").trim();
        const lock = passwordLockStatus(username);
        if (lock.locked) {
          await recordSessionAudit(req,
            { actor: username || "unknown", role: "unknown", action: "local-password-login", target: "unified-auth", result: "denied", detail: "account login is temporarily locked" }
          );
          sendJson(res, 423, { ok: false, code: "PASSWORD_LOGIN_LOCKED", message: "账号登录已临时锁定", ...lock });
          return true;
        }
        const user = findAuthUser(username);
        if (!user || !verifyPassword(user, credentials.password)) {
          const failure = recordPasswordFailure(username);
          await recordSessionAudit(req,
            { actor: credentials.username || "unknown", role: "unknown", action: "local-password-login", target: "unified-auth", result: "denied", detail: "invalid account credentials" },
            undefined,
            { actor: credentials.username || "unknown", role: "unknown", action: "登录", target: "统一认证", result: "拒绝", detail: "账号或密码错误" }
          );
          sendJson(res, failure.locked ? 423 : 401, {
            ok: false,
            code: failure.locked ? "PASSWORD_LOGIN_LOCKED" : "INVALID_CREDENTIALS",
            message: failure.locked ? "账号登录已临时锁定" : "账号或密码不正确",
            failedAttempts: failure.failedAttempts,
            retryAfterSeconds: failure.retryAfterSeconds
          });
          return true;
        }
        let validatedUser;
        try {
          validatedUser = validateRuntimeAccount(user);
        } catch (error) {
          await recordSessionAudit(req,
            { actor: user.name || username, role: user.role || "unknown", action: "local-password-login", target: "unified-auth", result: "denied", detail: error.code || "identity policy denied" }
          );
          rejectPolicy(res, error);
          return true;
        }
        clearPasswordFailures(username);
        const session = await createSession(validatedUser);
        issueSessionCookies(res, session, process.env);
        await recordSessionAudit(req,
          { actor: validatedUser.name, role: validatedUser.role, action: "local-password-login", target: validatedUser.home, result: "allowed", detail: `signed local session issued via ${sessionTransport(process.env).mode}` },
          session,
          { actor: validatedUser.name, role: validatedUser.role, action: "登录", target: validatedUser.home, result: "允许", detail: "签名会话已签发，支持密钥轮换校验" }
        );
        sendJson(res, 200, { ok: true, ...sessionResponse(session, process.env) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/adapters") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/adapters");
        if (!user) return true;
        sendJson(res, 200, productionAdapterCenter(process.env));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/sms-deliveries") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/sms-deliveries");
        if (!user) return true;
        const center = buildSmsDeliveryCenter(readDatabase(), process.env);
        appendSecurityEvent({
          actor: user.name,
          role: user.role,
          action: "sms delivery ledger read",
          target: "/api/auth/sms-deliveries",
          result: "allowed",
          detail: `${center.summary.receipts} receipts / ${center.summary.delivered} delivered / production ready false`
        });
        sendJson(res, 200, center);
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/identity-lifecycle") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/identity-lifecycle");
        if (!user) return true;
        const center = productionAdapterCenter(process.env);
        const runtimeSecurity = securityReadiness(process.env);
        sendJson(res, 200, {
          ok: true,
          identity: center.identity,
          sms: center.sms,
          smsDelivery: buildSmsDeliveryCenter(readDatabase(), process.env),
          capabilities: {
            login: "oidc-userinfo-controlled-binding",
            refresh: "upstream-refresh-to-local-session",
            logout: "upstream-revocation-and-local-session-delete",
            directory: "controlled-binding-preview-and-deactivation",
            externalSubject: "issuer-plus-subject-unique-binding",
            browserSession: "http-only-cookie-with-signed-double-submit-csrf",
            stepUp: "provider-verified-strong-authentication",
            saml: "strict-contract-no-go-until-runtime-and-site-evidence",
            smsDelivery: "signed-callback-idempotency-and-ordered-ledger",
            sessionStore: await refreshSessionStoreStatus()
          },
          runtimeSecurity,
          blockers: [...new Set([
            ...center.blockers.filter((item) => /OIDC|identity|provider|site/i.test(item)),
            ...runtimeSecurity.blockers
          ])],
          productionReady: false,
          boundary: "Provider configuration and lifecycle code do not replace directory ownership, provider receipts, privilege review or site signoff."
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/sessions/cleanup") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/sessions/cleanup");
        if (!user) return true;
        if (!enforceMutationSecurity(req, res, { stepUp: true })) return true;
        const payload = await collectJson(req);
        if (String(payload.confirmation || "").trim() !== "PURGE RETAINED SESSIONS") {
          sendJson(res, 400, {
            ok: false,
            code: "SESSION_CLEANUP_CONFIRMATION_REQUIRED",
            message: "session cleanup confirmation is required"
          });
          return true;
        }
        let result;
        try {
          result = await cleanupRuntimeSessions({
            trigger: "manual",
            actor: user.username || user.id
          });
        } catch (error) {
          console.error(`manual session cleanup failed: ${error.message}`);
          sendJson(res, 503, {
            ok: false,
            code: "SESSION_CLEANUP_FAILED",
            message: "session cleanup failed; inspect server operations logs"
          });
          return true;
        }
        await recordSessionAudit(req, {
          actor: user.name,
          role: user.role,
          action: "session-retention-cleanup",
          target: "unified-auth",
          result: "allowed",
          detail: `${result.deletedTotal} retained sessions removed`
        }, undefined, {
          actor: user.name,
          role: user.role,
          action: "session retention cleanup",
          target: "unified-auth",
          result: "allowed",
          detail: `${result.deletedTotal} retained sessions removed (${result.deletedExpired} expired, ${result.deletedRevoked} revoked)`
        });
        sendJson(res, 200, { ok: true, result, sessionStore: sessionStoreStatus() });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/oidc/exchange") {
        const payload = await collectJson(req);
        try {
          const upstream = await fetchOidcUserInfo(payload.accessToken);
          const data = readDatabase();
          const mapping = resolveExternalIdentity(upstream.claims, data, { expectedIssuer: process.env.OIDC_ISSUER_URL });
          if (mapping.status !== "matched-existing-user") {
            await recordSessionAudit(req,
              { actor: upstream.claims.sub || "external", role: "external", action: "oidc-login", target: "unified-auth", result: "denied", detail: "external identity requires controlled account binding" },
              undefined,
              { actor: upstream.claims.sub || "external", role: "external", action: "OIDC login", target: "unified-auth", result: "denied", detail: "external identity requires controlled account binding" }
            );
            sendJson(res, 403, { ok: false, message: "external identity requires account binding", mapping: { status: mapping.status, warnings: mapping.warnings } });
            return true;
          }
          const user = {
            ...mapping.user,
            externalIssuer: mapping.issuer,
            externalSubject: mapping.subject,
            assuranceLevel: upstream.claims.acr || (Array.isArray(upstream.claims.amr) && upstream.claims.amr.includes("mfa") ? "mfa" : ""),
            authTime: upstream.claims.auth_time || upstream.fetchedAt
          };
          const session = await createSession(user);
          issueSessionCookies(res, session, process.env);
          await recordSessionAudit(req,
            { actor: user.name, role: user.role, action: "oidc-login", target: user.home, result: "allowed", detail: `verified by ${upstream.adapter}` },
            session,
            { actor: user.name, role: user.role, action: "OIDC login", target: user.home, result: "allowed", detail: `verified by ${upstream.adapter}` }
          );
          sendJson(res, 200, {
            ok: true,
            ...sessionResponse(session, process.env),
            adapter: upstream.adapter,
            mappedAt: upstream.fetchedAt
          });
        } catch (error) {
          await recordSessionAudit(req,
            { actor: "external", role: "external", action: "oidc-login", target: "unified-auth", result: "denied", detail: "identity provider verification failed" },
            undefined,
            { actor: "external", role: "external", action: "OIDC login", target: "unified-auth", result: "denied", detail: "identity provider verification failed" }
          );
          if (error instanceof IdentityPolicyError) rejectPolicy(res, error);
          else sendJson(res, 502, { ok: false, message: "identity provider verification failed" });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/oidc/refresh") {
        const payload = await collectJson(req);
        try {
          const refreshed = await refreshOidcAccessToken(payload.refreshToken);
          const upstream = await fetchOidcUserInfo(refreshed.accessToken);
          const data = readDatabase();
          const mapping = resolveExternalIdentity(upstream.claims, data, { expectedIssuer: process.env.OIDC_ISSUER_URL });
          const user = mapping.status === "matched-existing-user" ? {
            ...mapping.user,
            externalIssuer: mapping.issuer,
            externalSubject: mapping.subject,
            assuranceLevel: upstream.claims.acr || (Array.isArray(upstream.claims.amr) && upstream.claims.amr.includes("mfa") ? "mfa" : ""),
            authTime: upstream.claims.auth_time || upstream.fetchedAt
          } : null;
          if (!user) {
            await recordSessionAudit(req,
              { actor: upstream.claims.sub || "external", role: "external", action: "oidc-refresh", target: "unified-auth", result: "denied", detail: "refreshed identity is unbound, disabled or missing" },
              undefined,
              { actor: upstream.claims.sub || "external", role: "external", action: "OIDC refresh", target: "unified-auth", result: "denied", detail: "refreshed identity is unbound, disabled or missing" }
            );
            sendJson(res, 403, { ok: false, message: "refreshed identity is unbound, disabled or missing" });
            return true;
          }
          const session = await createSession(user);
          issueSessionCookies(res, session, process.env);
          await recordSessionAudit(req,
            { actor: user.name, role: user.role, action: "oidc-refresh", target: user.home, result: "allowed", detail: "upstream refresh verified and signed local session issued" },
            session,
            { actor: user.name, role: user.role, action: "OIDC refresh", target: user.home, result: "allowed", detail: "upstream refresh verified and a new signed local session was issued" }
          );
          sendJson(res, 200, {
            ok: true,
            ...sessionResponse(session, process.env),
            adapter: refreshed.adapter,
            upstreamRefreshRotated: refreshed.refreshRotated,
            ...(refreshed.refreshRotated ? { upstreamRefreshToken: refreshed.refreshToken } : {})
          });
        } catch (error) {
          await recordSessionAudit(req,
            { actor: "external", role: "external", action: "oidc-refresh", target: "unified-auth", result: "denied", detail: "upstream refresh or identity verification failed" },
            undefined,
            { actor: "external", role: "external", action: "OIDC refresh", target: "unified-auth", result: "denied", detail: "upstream refresh or identity verification failed" }
          );
          if (error instanceof IdentityPolicyError) rejectPolicy(res, error);
          else sendJson(res, 502, { ok: false, message: "identity provider refresh failed" });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/oidc/revoke") {
        let resolved;
        try {
          resolved = resolveSession(req);
          if (!resolved.session) throw new IdentityPolicyError("AUTHENTICATION_REQUIRED", "未登录或会话已过期", 401);
          requireCsrf(req, resolved, process.env);
          validateLiveSession(resolved.session, readDatabase());
        } catch (error) {
          rejectPolicy(res, error);
          return true;
        }
        const session = resolved.session;
        const payload = await collectJson(req);
        try {
          const receipt = await revokeOidcToken(payload.upstreamToken, { tokenTypeHint: payload.tokenTypeHint });
          await revokeSession(session, { reason: "oidc-revoke", actor: session.user.username || session.user.id });
          clearSessionCookies(res, process.env);
          await recordSessionAudit(req,
            { actor: session.user.name, role: session.user.role, action: "oidc-revoke-logout", target: "unified-auth", result: "allowed", detail: "upstream and local sessions revoked" },
            session,
            { actor: session.user.name, role: session.user.role, action: "OIDC revoke logout", target: "unified-auth", result: "allowed", detail: "upstream token revoked and local session retained as revoked audit evidence" }
          );
          sendJson(res, 200, { ok: true, receipt, localSessionRevoked: true, productionReady: false });
        } catch (error) {
          await revokeSession(session, { reason: "oidc-revoke-upstream-failed", actor: session.user.username || session.user.id });
          clearSessionCookies(res, process.env);
          await recordSessionAudit(req,
            { actor: session.user.name, role: session.user.role, action: "oidc-revoke-logout", target: "unified-auth", result: "partial", detail: "local session revoked; upstream reconciliation required" },
            session,
            { actor: session.user.name, role: session.user.role, action: "OIDC revoke logout", target: "unified-auth", result: "partial", detail: "local session revoked; upstream revocation requires reconciliation" }
          );
          sendJson(res, 502, { ok: false, message: "upstream token revocation failed", localSessionRevoked: true, upstreamRevoked: false });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/identity-directory/preview") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/identity-directory/preview");
        if (!user) return true;
        try {
          const directory = await fetchIdentityDirectory();
          const plan = buildIdentityDirectorySyncPlan(directory.records, readDatabase());
          appendSecurityEvent({ actor: user.name, role: user.role, action: "identity directory preview", target: "unified-auth", result: "allowed", detail: `${plan.summary.remoteRecords} records; ${plan.summary.deactivations} deactivations; production ready false` });
          sendJson(res, 200, { ok: true, directory: { totalResults: directory.totalResults, fetchedAt: directory.fetchedAt, adapter: directory.adapter }, plan });
        } catch (error) {
          sendJson(res, 409, { ok: false, code: "IDENTITY_DIRECTORY_PREVIEW_BLOCKED", message: "identity directory preview is unavailable" });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/identity-directory/bind") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/identity-directory/bind");
        if (!user) return true;
        if (!enforceMutationSecurity(req, res, { stepUp: true })) return true;
        const payload = await collectJson(req);
        const note = String(payload.note || "").trim();
        if (note.length < 8 || payload.confirmation !== "BIND EXTERNAL IDENTITY") {
          sendJson(res, 400, { ok: false, code: "IDENTITY_BINDING_CONFIRMATION_REQUIRED", message: "external identity binding requires a note and exact confirmation" });
          return true;
        }
        try {
          const directory = await fetchIdentityDirectory();
          const data = readDatabase();
          const result = applyIdentityDirectoryBinding(data, directory.records, payload, user);
          const hardenedBinding = bindExternalIdentity(data, result.localUserId, {
            issuer: payload.externalIssuer || process.env.IDENTITY_DIRECTORY_ISSUER || process.env.OIDC_ISSUER_URL,
            subject: result.externalSubject,
            protocol: payload.protocol || "oidc"
          });
          writeDatabase(normalizeState(data));
          const plan = buildIdentityDirectorySyncPlan(directory.records, data);
          appendSecurityEvent({ actor: user.name, role: user.role, action: "external identity binding", target: result.localUserId, result: "allowed", detail: `${result.username} bound to a verified issuer and subject; no role or organization changes` });
          sendJson(res, 200, {
            ok: true,
            result: { ...result, externalIssuer: hardenedBinding.issuer, identityKey: hardenedBinding.identityKey },
            plan,
            productionReady: false
          });
        } catch (error) {
          sendJson(res, error.statusCode || 409, { ok: false, code: error.code || "IDENTITY_BINDING_FAILED", message: error.code ? error.message : "external identity binding failed" });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/identity-directory/apply") {
        const user = requireApiRole(req, res, ["commission"], "/api/auth/identity-directory/apply");
        if (!user) return true;
        if (!enforceMutationSecurity(req, res, { stepUp: true })) return true;
        const payload = await collectJson(req);
        const note = String(payload.note || "").trim();
        if (note.length < 8 || payload.confirmation !== "APPLY IDENTITY DIRECTORY DEACTIVATIONS") {
          sendJson(res, 400, { ok: false, code: "IDENTITY_DIRECTORY_CONFIRMATION_REQUIRED", message: "directory deactivation sync requires a note and exact confirmation" });
          return true;
        }
        try {
          const directory = await fetchIdentityDirectory();
          const data = readDatabase();
          const plan = buildIdentityDirectorySyncPlan(directory.records, data);
          const result = await applyIdentityDirectoryDeactivations(data, plan, user, note);
          writeDatabase(normalizeState(data));
          appendSecurityEvent({ actor: user.name, role: user.role, action: "identity directory deactivation sync", target: "unified-auth", result: "allowed", detail: `${result.applied.length} accounts deactivated; ${result.revokedSessions} sessions revoked; no role changes` });
          sendJson(res, 200, { ok: true, plan, result, productionReady: false });
        } catch (error) {
          const status = error.code === "SESSION_STORE_UNAVAILABLE"
            ? 503
            : ["IDENTITY_DIRECTORY_SELF_DEACTIVATION_BLOCKED", "IDENTITY_DIRECTORY_LAST_COMMISSION_BLOCKED"].includes(error.code) ? 409 : 502;
          sendJson(res, status, { ok: false, code: error.code || "IDENTITY_DIRECTORY_APPLY_FAILED", message: error.code ? error.message : "identity directory sync failed" });
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/phone-code") {
        const payload = await collectJson(req);
        const phone = normalizePhone(payload.phone);
        const user = findCitizenAuthUserByPhone(phone);
        if (!user) {
          appendSecurityEvent({ actor: phone || "unknown", role: "citizen", action: "发送手机号验证码", target: "统一认证", result: "拒绝", detail: "手机号未绑定居民账号" });
          sendJson(res, 404, { ok: false, message: "手机号未绑定居民账号" });
          return true;
        }
        let issued;
        try {
          issued = await issuePhoneVerificationCode(phone, user);
        } catch (error) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "发送手机号验证码", target: "统一认证", result: "拒绝", detail: `短信网关发送失败：${error.message}` });
          sendJson(res, 502, { ok: false, message: "短信网关发送失败" });
          return true;
        }
        if (!issued.ok) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "发送手机号验证码", target: "统一认证", result: "拒绝", detail: `验证码发送过于频繁，${issued.retryAfterSeconds} 秒后可重试` });
          sendJson(res, 429, { ok: false, message: "验证码发送过于频繁", retryAfterSeconds: issued.retryAfterSeconds, expiresAt: issued.expiresAt });
          return true;
        }
        appendSecurityEvent({ actor: user.name, role: user.role, action: "发送手机号验证码", target: "统一认证", result: "允许", detail: issued.demo ? "居民端演示短信验证码已签发" : `短信网关已受理：${issued.receipt.providerMessageId}` });
        sendJson(res, 200, {
          ok: true,
          channel: issued.channel,
          phone: maskPhone(phone),
          expiresAt: issued.expiresAt,
          retryAfterSeconds: issued.retryAfterSeconds,
          ...(issued.demo ? { demoCode: issued.code } : { receipt: issued.receipt })
        });
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/phone-login") {
        const credentials = await collectJson(req);
        const phone = normalizePhone(credentials.phone);
        const code = String(credentials.code || "").trim();
        const user = findCitizenAuthUserByPhone(phone);
        const lock = phoneLoginLockStatus(phone);
        if (lock.locked) {
          await recordSessionAudit(req,
            { actor: maskPhone(phone) || "unknown", role: "citizen", action: "phone-code-login", target: "unified-auth", result: "denied", detail: `login locked; retry after ${lock.retryAfterSeconds} seconds` },
            undefined,
            { actor: maskPhone(phone) || "unknown", role: "citizen", action: "phone-code login", target: "unified-auth", result: "denied", detail: `phone-code login locked, retry after ${lock.retryAfterSeconds} seconds` }
          );
          sendJson(res, 423, { ok: false, message: "phone-code login locked after repeated failures", retryAfterSeconds: lock.retryAfterSeconds, failedAttempts: lock.failedAttempts });
          return true;
        }
        if (!user || !verifyPhoneCode(phone, code, user)) {
          const failure = recordPhoneLoginFailure(phone);
          await recordSessionAudit(req,
            { actor: maskPhone(phone) || "unknown", role: "citizen", action: "phone-code-login", target: "unified-auth", result: "denied", detail: failure.locked ? "login locked after repeated failures" : "invalid phone or verification code" },
            undefined,
            { actor: maskPhone(phone) || "unknown", role: "citizen", action: "phone-code login", target: "unified-auth", result: "denied", detail: failure.locked ? "login locked after repeated failures" : "invalid phone or verification code" }
          );
          if (failure.locked) {
            sendJson(res, 423, { ok: false, message: "phone-code login locked after repeated failures", retryAfterSeconds: failure.retryAfterSeconds, failedAttempts: failure.failedAttempts });
            return true;
          }
          sendJson(res, 401, { ok: false, message: "invalid phone or verification code" });
          return true;
        }
        let validatedUser;
        try {
          validatedUser = validateRuntimeAccount({ ...user, phone });
        } catch (error) {
          await recordSessionAudit(req,
            { actor: user.name || maskPhone(phone), role: user.role || "unknown", action: "phone-code-login", target: "unified-auth", result: "denied", detail: error.code || "identity policy denied" }
          );
          rejectPolicy(res, error);
          return true;
        }
        const session = await createSession(validatedUser);
        issueSessionCookies(res, session, process.env);
        await recordSessionAudit(req,
          { actor: user.name, role: user.role, action: "phone-code-login", target: user.home, result: "allowed", detail: "resident signed session issued" },
          session,
          { actor: user.name, role: user.role, action: "phone-code login", target: user.home, result: "allowed", detail: "resident phone-code session issued" }
        );
        sendJson(res, 200, { ok: true, ...sessionResponse(session, process.env) });
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/auth/me") {
        let resolved;
        try {
          resolved = resolveSession(req);
          if (!resolved.session) throw new IdentityPolicyError("AUTHENTICATION_REQUIRED", "未登录或会话已过期", 401);
          const live = validateLiveSession(resolved.session, readDatabase());
          const csrf = resolved.source === "cookie" ? csrfToken(resolved.session, process.env) : "";
          sendJson(res, 200, {
            ok: true,
            user: publicIdentity(live.user),
            claims: identityClaims(live.user),
            expiresAt: resolved.session.expiresAt,
            session: {
              transport: resolved.source,
              stepUp: stepUpStatus(resolved.session, process.env),
              csrfRequired: resolved.source === "cookie"
            },
            ...(csrf ? { csrfToken: csrf } : {})
          });
        } catch (error) {
          if (resolved?.session) {
            await revokeSession(resolved.session, { reason: "live-identity-validation-failed", actor: resolved.session.user?.username || resolved.session.user?.id || "system" });
            clearSessionCookies(res, process.env);
            await recordSessionAudit(req, {
              actor: resolved.session.user?.name || "unknown",
              role: resolved.session.user?.role || "unknown",
              action: "session-live-identity-validation",
              target: "unified-auth",
              result: "denied",
              detail: error.code || "live identity validation failed"
            }, resolved.session);
          }
          rejectPolicy(res, error);
          return true;
        }
        return true;
      }

      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        let resolved;
        try {
          resolved = resolveSession(req);
          if (resolved.session) requireCsrf(req, resolved, process.env);
        } catch (error) {
          rejectPolicy(res, error);
          return true;
        }
        const session = resolved.session;
        if (session) {
          await revokeSession(session, { reason: "logout", actor: session.user.username || session.user.id });
          await recordSessionAudit(req,
            { actor: session.user.name, role: session.user.role, action: "logout", target: "unified-auth", result: "allowed", detail: "local session revoked" },
            session,
            { actor: session.user.name, role: session.user.role, action: "退出登录", target: "统一认证", result: "允许", detail: "后端会话已注销" }
          );
        }
        clearSessionCookies(res, process.env);
        sendJson(res, 200, { ok: true });
        return true;
      }
        return false;
      }
    },
    {
      id: "identity-security-03",
      domain: "identity-security",
      async handle(req, res, url) {
    if (req.method === "POST" && url.pathname.startsWith("/api/authorizations/") && url.pathname.endsWith("/revoke")) {
        const user = requireApiRole(req, res, ["citizen", "commission"], "/api/authorizations/:id/revoke");
        if (!user) return true;
        const id = decodeURIComponent(url.pathname.replace("/api/authorizations/", "").replace("/revoke", ""));
        const payload = await collectJson(req);
        const data = readDatabase();
        const index = data.personalRecords.findIndex((item) => item.id === id && item.category === "authorizations");
        if (index < 0) {
          sendJson(res, 404, { error: "Not Found", message: "未找到授权记录" });
          return true;
        }
        const authorization = data.personalRecords[index];
        if (!canAccessResident(user, authorization.residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "撤销居民授权", target: id, result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权撤销该居民授权" });
          return true;
        }
        data.personalRecords[index] = {
          ...authorization,
          result: `已撤销：${authorization.result}`,
          status: "已撤销",
          revokedAt: new Date().toISOString(),
          revokedBy: user.username || user.role,
          revokedByName: user.name,
          revokeReason: String(payload.reason || "居民撤销授权").trim(),
          updatedAt: new Date().toISOString()
        };
        data.securityEvents = prependAuditTrailEntry(data.securityEvents, {
          id: randomUUID(),
          at: new Date().toLocaleString("zh-CN", { hour12: false }),
          actor: user.name,
          role: user.role,
          action: "撤销居民授权",
          target: id,
          result: "允许",
          detail: data.personalRecords[index].revokeReason
        });
        if (Object.hasOwn(payload, "expectedVersion")) {
          data.storageMeta = {
            ...(data.storageMeta || {}),
            collectionVersions: { personalRecords: Number(payload.expectedVersion) }
          };
        }
        appendDataAccessLog(data, user, authorization.residentId, "授权撤销", data.personalRecords[index].revokeReason, "允许");
        writeDatabase(data);
        sendJson(res, 200, redactSensitiveResponse(data.personalRecords[index], user));
        return true;
      }

      if (req.method === "GET" && url.pathname === "/api/access-reviews") {
        const user = requireApiRole(req, res, ["citizen", "commission"], "/api/access-reviews");
        if (!user) return true;
        const residentId = url.searchParams.get("residentId");
        const data = readDatabase();
        if (!canAccessResident(user, residentId, data)) {
          appendSecurityEvent({ actor: user.name, role: user.role, action: "复核居民访问历史", target: residentId || "all", result: "拒绝", detail: "超出居民授权范围" });
          sendJson(res, 403, { error: "Forbidden", message: "无权复核该居民访问历史" });
          return true;
        }
        const authorizations = (data.personalRecords || []).filter((item) => item.residentId === residentId && item.category === "authorizations");
        const accessLogs = (data.dataAccessLogs || []).filter((item) => item.residentId === residentId);
        appendDataAccessLog(data, user, residentId, "授权与访问历史", "复核居民授权与访问记录");
        writeDatabase(data);
        sendJson(res, 200, redactSensitiveResponse({ residentId, authorizations, accessLogs }, user));
        return true;
      }
        return false;
      }
    },
  ];
}

module.exports = { createRouteSegments };
