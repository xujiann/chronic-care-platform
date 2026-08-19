"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createStaticAssetPolicy } = require("./static-asset-policy");
const { buildPublicDemoSnapshot } = require("../platform/data/public-demo-snapshot");

function createStaticContentRuntime(options = {}) {
  const root = fs.realpathSync(path.resolve(options.root));
  const databaseFile = path.resolve(options.databaseFile);
  const authorization = options.authorization;
  const securityResponseHeaders = options.securityResponseHeaders;
  const mimeTypes = options.mimeTypes || {};
  if (!authorization || typeof authorization.evaluateStaticRequest !== "function") throw new TypeError("static content runtime requires authorization");
  if (typeof securityResponseHeaders !== "function") throw new TypeError("static content runtime requires security response headers");
  const policy = createStaticAssetPolicy({ root });
  let publicDemoCache = { sourceKey: "", content: null };

  function requestPath(req) {
    try {
      return new URL(req.url, `http://${req.headers.host || "localhost"}`).pathname;
    } catch {
      return "";
    }
  }

  function deny(res) {
    res.writeHead(404, { ...securityResponseHeaders(), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
    res.end("Not found");
  }

  function publicDemoSnapshot() {
    const stat = fs.statSync(databaseFile);
    const sourceKey = `${stat.mtimeMs}:${stat.size}`;
    if (publicDemoCache.sourceKey === sourceKey && publicDemoCache.content) return publicDemoCache.content;
    const source = JSON.parse(fs.readFileSync(databaseFile, "utf8"));
    const result = buildPublicDemoSnapshot(source, { generatedAt: new Date(stat.mtimeMs).toISOString() });
    const content = Buffer.from(`${JSON.stringify(result.snapshot, null, 2)}\n`);
    publicDemoCache = { sourceKey, content };
    return content;
  }

  function isProtectedStaticRequest(req) {
    const publication = policy.evaluate(requestPath(req));
    return publication.allowed && authorization.isProtectedStaticRequest(req);
  }

  function serveStatic(req, res) {
    const rawPath = requestPath(req);
    if (!new Set(["GET", "HEAD"]).has(String(req.method || "GET").toUpperCase())) return deny(res);
    if (rawPath === "/favicon.ico") {
      res.writeHead(204, securityResponseHeaders());
      res.end();
      return;
    }
    const publication = policy.evaluate(rawPath);
    if (!publication.allowed) return deny(res);
    const decision = authorization.evaluateStaticRequest(req);
    if (!decision.allowed) {
      authorization.denyStaticRequest(res, decision, authorization.currentBrowserUser(req));
      return;
    }

    if (publication.generated && publication.relativePath === "data/public-demo.json") {
      try {
        const content = publicDemoSnapshot();
        res.writeHead(200, { ...securityResponseHeaders(), "Content-Type": mimeTypes[".json"], "Cache-Control": "public, max-age=300" });
        res.end(String(req.method || "GET").toUpperCase() === "HEAD" ? undefined : content);
      } catch {
        deny(res);
      }
      return;
    }

    let filePath;
    try {
      filePath = fs.realpathSync(path.resolve(root, ...publication.relativePath.split("/")));
      const relativeRealPath = path.relative(root, filePath);
      if (relativeRealPath.startsWith("..") || path.isAbsolute(relativeRealPath)) throw new Error("Static asset escapes publication root");
    } catch {
      deny(res);
      return;
    }
    fs.readFile(filePath, (error, content) => {
      if (error) return deny(res);
      const extension = path.extname(filePath).toLowerCase();
      res.writeHead(200, { ...securityResponseHeaders(), "Content-Type": mimeTypes[extension] || "application/octet-stream" });
      res.end(String(req.method || "GET").toUpperCase() === "HEAD" ? undefined : content);
    });
  }

  return Object.freeze({ isProtectedStaticRequest, policy, serveStatic });
}

module.exports = { createStaticContentRuntime };
