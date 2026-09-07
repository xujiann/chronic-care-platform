const { expect, test } = require("@playwright/test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildStaticPublication } = require("../../scripts/static-publication");

const PAGES_ORIGIN = "https://health-platform-preview.github.io";
const PAGES_BASE_PATH = "/chronic-care-platform/";
const PAGES_BASE_URL = `${PAGES_ORIGIN}${PAGES_BASE_PATH}`;
const CONTENT_TYPES = Object.freeze({
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2"
});

let pagesTemporaryRoot = "";
let pagesArtifactRoot = "";
let publishedFiles = new Set();

const COMMISSION_ENTRYPOINTS = Object.freeze([
  Object.freeze({ page: "health-dashboard.html", heading: "卫生健康综合管理服务系统" }),
  Object.freeze({ page: "public-health.html", heading: "公共卫生信息化系统" }),
  Object.freeze({ page: "public-health-highlights.html", heading: "五件套指挥中心" }),
  Object.freeze({ page: "public-health-supervision.html", heading: "卫生监督闭环工作台" }),
  Object.freeze({ page: "immunization.html", heading: "国家免疫规划疫苗儿童接种计划" }),
  Object.freeze({ page: "digital-hospital-standards.html", heading: "数智医院标准平台" }),
  Object.freeze({ page: "imaging-cloud.html", heading: "区域医学影像云工作台" })
]);

test.beforeAll(() => {
  pagesTemporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "health-platform-pages-e2e-"));
  pagesArtifactRoot = path.join(pagesTemporaryRoot, "site");
  const result = buildStaticPublication({
    output: pagesArtifactRoot,
    generatedAt: "2026-09-07T00:00:00.000Z"
  });
  publishedFiles = new Set(result.manifest.files.map((file) => file.path));
});

test.afterAll(() => {
  if (pagesTemporaryRoot) fs.rmSync(pagesTemporaryRoot, { recursive: true, force: true });
});

function pagesUrl(relativePath = "") {
  return new URL(String(relativePath).replace(/^\/+/, ""), PAGES_BASE_URL).href;
}

function contentType(relativePath) {
  return CONTENT_TYPES[path.extname(relativePath).toLowerCase()] || "application/octet-stream";
}

async function fulfillPagesArtifact(route) {
  const requestUrl = new URL(route.request().url());
  let decodedPath = "";
  try {
    decodedPath = decodeURIComponent(requestUrl.pathname);
  } catch {
    decodedPath = "";
  }

  if (!decodedPath.startsWith(PAGES_BASE_PATH)) {
    await route.fulfill({ status: 404, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Not Found</title><h1>Not Found</h1>" });
    return;
  }

  let relativePath = decodedPath.slice(PAGES_BASE_PATH.length);
  if (!relativePath || relativePath.endsWith("/")) relativePath += "index.html";
  if (!publishedFiles.has(relativePath)) {
    await route.fulfill({ status: 404, contentType: "text/html; charset=utf-8", body: "<!doctype html><title>Not Found</title><h1>Not Found</h1>" });
    return;
  }

  const body = fs.readFileSync(path.join(pagesArtifactRoot, ...relativePath.split("/")));
  await route.fulfill({ status: 200, contentType: contentType(relativePath), body });
}

async function installPagesArtifactRoute(page) {
  await page.route(`${PAGES_ORIGIN}/**`, fulfillPagesArtifact);
}

async function login(page, username, expectedHome) {
  if (page.url() !== "about:blank") {
    await page.evaluate(() => localStorage.removeItem("health-city-auth-session"));
  }
  await page.context().clearCookies();
  await page.goto(pagesUrl("login.html"));
  await page.locator("#login-user").selectOption(username);
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(pagesUrl(expectedHome));
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("health-city-auth-session") || "null")?.authMode)).toBe("local");
}

test("published platform and public-health entrypoints enforce access and retain the left navigation shell", async ({ page }) => {
  test.setTimeout(150_000);
  const pageErrors = [];
  const authApiRequests = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/auth/")) authApiRequests.push(request.url());
  });

  await installPagesArtifactRoute(page);

  const escapedBaseResponse = await page.goto(`${PAGES_ORIGIN}/login.html`);
  expect(escapedBaseResponse.status()).toBe(404);
  const missingEntrypointResponse = await page.goto(pagesUrl("missing-entrypoint.html"));
  expect(missingEntrypointResponse.status()).toBe(404);

  const publicEntrypointResponse = await page.goto(pagesUrl("health-city.html"));
  expect(publicEntrypointResponse.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "健康城市协同总览", exact: true })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-auth-resolved", "allowed");

  const artifactBoundary = await page.evaluate(async () => {
    const publicSnapshot = await fetch("./data/public-demo.json");
    const privateSource = await fetch("./data/db.json");
    const snapshot = await publicSnapshot.json();
    return {
      publicStatus: publicSnapshot.status,
      classification: snapshot.storageMeta?.publicDemoSnapshot?.classification,
      privateStatus: privateSource.status
    };
  });
  expect(artifactBoundary).toEqual({ publicStatus: 200, classification: "PUBLIC_DEMO", privateStatus: 404 });

  await login(page, "health", "index.html");
  for (const entrypoint of COMMISSION_ENTRYPOINTS) {
    await expect(page.locator(`.navigation-sidebar a[data-navigation-page='${entrypoint.page}']`)).toHaveCount(1);
  }

  for (const entrypoint of COMMISSION_ENTRYPOINTS) {
    const response = await page.goto(pagesUrl(entrypoint.page));
    expect(response.status(), `${entrypoint.page} must exist in the Pages artifact`).toBe(200);
    expect(new URL(page.url()).pathname.startsWith(PAGES_BASE_PATH), `${entrypoint.page} must retain the Pages base path`).toBe(true);
    await expect(page.getByRole("heading", { name: entrypoint.heading, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-auth-resolved", "allowed");
    await expect(page.locator("html")).toHaveAttribute("data-navigation-shell", "ready");
    await expect(page.locator(".navigation-sidebar")).toHaveAttribute("aria-label", "分级功能导航");
    await expect(page.locator(`.navigation-sidebar a[data-navigation-page='${entrypoint.page}']`)).toHaveAttribute("aria-current", "page");
    const sidebarBox = await page.locator(".navigation-sidebar").boundingBox();
    expect(sidebarBox, `${entrypoint.page} must render the navigation sidebar`).not.toBeNull();
    expect(sidebarBox.x, `${entrypoint.page} navigation must remain on the left`).toBe(0);
  }

  await page.locator("#health-navigation-search").fill("健康驾驶舱");
  await expect(page.locator(".navigation-sidebar a[data-navigation-page='health-dashboard.html']")).toBeVisible();
  await page.locator(".navigation-sidebar a[data-navigation-page='health-dashboard.html']").click();
  await expect(page).toHaveURL(pagesUrl("health-dashboard.html"));
  await expect(page.locator(".navigation-sidebar a[data-navigation-page='health-dashboard.html']")).toHaveAttribute("aria-current", "page");

  await login(page, "insurance", "insurance.html");
  for (const entrypoint of COMMISSION_ENTRYPOINTS) {
    await page.goto(pagesUrl(entrypoint.page));
    await expect(page).toHaveURL(pagesUrl(`insurance.html?denied=${encodeURIComponent(entrypoint.page)}`));
    await expect(page.locator(`.navigation-sidebar a[data-navigation-page='${entrypoint.page}']`)).toHaveCount(0);
  }

  expect(authApiRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});
