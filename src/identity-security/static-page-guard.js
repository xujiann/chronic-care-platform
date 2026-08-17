"use strict";

const AccessPolicy = require("../../access-control-policy");

const PUBLIC_HTML_PAGES = new Set(Object.entries(AccessPolicy.pageCatalog)
  .filter(([, policy]) => policy.public === true)
  .map(([page]) => page));

function requestedPage(req) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname);
  } catch {
    return "";
  }
  const normalized = pathname === "/" ? "index.html" : AccessPolicy.normalizePageName(pathname.replace(/^\//, ""));
  return normalized.toLowerCase();
}

function isHtmlRequest(req) {
  if (!new Set(["GET", "HEAD"]).has(String(req.method || "GET").toUpperCase())) return false;
  const page = requestedPage(req);
  return page === "index.html" || page.endsWith(".html");
}

function isProtectedStaticRequest(req) {
  if (!isHtmlRequest(req)) return false;
  return !PUBLIC_HTML_PAGES.has(requestedPage(req));
}

function evaluateStaticPageAccess(req, session, policyForPage, policyContext = {}) {
  const page = requestedPage(req);
  if (!isHtmlRequest(req)) return { allowed: true, page, code: "ASSET" };
  if (PUBLIC_HTML_PAGES.has(page)) return { allowed: true, page, code: "PUBLIC_PAGE" };
  if (!session?.user) return { allowed: false, status: 401, page, code: "AUTHENTICATION_REQUIRED" };
  const decide = typeof policyForPage === "function" ? policyForPage : AccessPolicy.accessDecision;
  const decision = decide(page, session.user, policyContext);
  if (!decision || decision.allowed !== true) {
    return {
      allowed: false,
      status: 403,
      page,
      code: decision?.code || decision?.reason || "PAGE_ACCESS_DENIED"
    };
  }
  return { allowed: true, page, code: "ALLOWED" };
}

function loginRedirect(decision) {
  const key = decision.status === 401 ? "redirect" : "denied";
  return `/login.html?${key}=${encodeURIComponent(decision.page || "index.html")}`;
}

module.exports = {
  PUBLIC_HTML_PAGES,
  evaluateStaticPageAccess,
  isHtmlRequest,
  isProtectedStaticRequest,
  loginRedirect,
  requestedPage
};
