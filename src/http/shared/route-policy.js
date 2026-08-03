"use strict";

function exact(pathname) {
  return new RegExp(`^${pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);
}

const SHARED_ROUTE_POLICY = Object.freeze([
  { methods: ["GET"], pattern: exact("/api/t10-specialty/cutover-pack") },
  { methods: ["GET"], pattern: exact("/api/t10-specialty-cutover") },
  { methods: ["GET"], pattern: exact("/api/t10-specialty/modules") },
  { methods: ["POST"], pattern: /^\/api\/t10-specialty\/modules\/[^/]+\/actions$/ },
  { methods: ["GET"], pattern: exact("/api/t10-specialty/modules/clinical-blood/readiness") },
  { methods: ["GET"], pattern: exact("/api/t10-specialty/modules/emergency-life-chain/readiness") },
  { methods: ["GET"], pattern: exact("/api/priority-applications/templates") },
  { methods: ["GET"], pattern: exact("/api/pilot-acceptance/center") },
  { methods: ["POST"], pattern: /^\/api\/pilot-acceptance\/interfaces\/[^/]+\/actions$/ },
  { methods: ["GET"], pattern: exact("/api/observability/alerts") },
  { methods: ["POST"], pattern: exact("/api/observability/alerts/dispatch") },
  { methods: ["POST"], pattern: /^\/api\/observability\/alert-deliveries\/[^/]+\/retry$/ },
  { methods: ["GET"], pattern: exact("/api/drug-consumable-supervision") },
  { methods: ["POST"], pattern: /^\/api\/drug-consumable-supervision\/[^/]+\/(?:review|remediation|insurance-sync|traceability-evidence)$/ },
  { methods: ["GET"], pattern: exact("/api/service-acceptance-summary") },
  { methods: ["GET"], pattern: exact("/api/regional-data-sharing") },
  { methods: ["GET"], pattern: exact("/api/regional-data-sharing/handoff-report") },
  { methods: ["POST"], pattern: exact("/api/regional-data-sharing/access-reviews") },
  { methods: ["GET"], pattern: exact("/api/service-orders") },
  { methods: ["GET"], pattern: exact("/api/data-quality/issues") },
  { methods: ["GET"], pattern: exact("/api/data-quality/scorecard") },
  { methods: ["POST"], pattern: /^\/api\/data-quality\/issues\/[^/]+\/actions$/ },
  { methods: ["GET"], pattern: exact("/api/credit-evaluations/calculate") },
  { methods: ["POST"], pattern: /^\/api\/credit-evaluations\/[^/]+\/actions$/ },
  { methods: ["GET"], pattern: exact("/api/performance/consortium-report") },
  { methods: ["GET"], pattern: exact("/api/mobile/accessibility-checklist") },
  { methods: ["POST"], pattern: /^\/api\/mobile\/accessibility-checklist\/[^/]+\/actions$/ },
  { methods: ["GET", "POST"], pattern: exact("/api/mobile/experience") },
  { methods: ["GET"], pattern: exact("/api/interoperability/management-functions") },
  { methods: ["GET"], pattern: exact("/api/data-governance") },
  { methods: ["GET"], pattern: exact("/api/data-governance/master-data") },
  { methods: ["GET"], pattern: exact("/api/public/multi-practice-ledger") }
].map((entry) => Object.freeze({
  methods: Object.freeze([...entry.methods]),
  pattern: entry.pattern
})));

function isSharedRouteAllowed(method, pathname) {
  const normalizedMethod = String(method || "").trim().toUpperCase();
  const normalizedPathname = String(pathname || "").trim();
  return SHARED_ROUTE_POLICY.some((entry) => (
    entry.methods.includes(normalizedMethod) && entry.pattern.test(normalizedPathname)
  ));
}

function protectSharedRouteSegments(segments) {
  return segments.map((segment) => Object.freeze({
    ...segment,
    async handle(req, res, url) {
      if (!isSharedRouteAllowed(req?.method, url?.pathname)) return false;
      return segment.handle(req, res, url);
    }
  }));
}

module.exports = {
  SHARED_ROUTE_POLICY,
  isSharedRouteAllowed,
  protectSharedRouteSegments
};
