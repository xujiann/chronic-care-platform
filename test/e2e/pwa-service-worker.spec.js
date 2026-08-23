"use strict";

const { expect, test } = require("@playwright/test");

const CURRENT_CACHE = "chronic-care-citizen-v61-public-demo-boundary";
const LEGACY_CACHE = "chronic-care-citizen-v60-public-demo-boundary";

async function clearPwaState(page) {
  if (!/^https?:\/\/127\.0\.0\.1:\d+\//.test(page.url())) await page.goto("/login.html");
  return page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const cacheNames = await caches.keys();
    await Promise.all(cacheNames.map((cacheName) => caches.delete(cacheName)));
    return {
      registrations: (await navigator.serviceWorker.getRegistrations()).length,
      caches: await caches.keys()
    };
  });
}

async function installCurrentServiceWorker(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/citizen\.html$/);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true }));
    }
    if (!registration.active || !navigator.serviceWorker.controller) throw new Error("Service Worker did not activate and claim the test page");
  });
}

test.beforeEach(async ({ page }) => {
  expect(await clearPwaState(page)).toEqual({ registrations: 0, caches: [] });
});

test.afterEach(async ({ context, page }) => {
  await context.setOffline(false);
  expect(await clearPwaState(page)).toEqual({ registrations: 0, caches: [] });
});

test("PWA installs the current worker and activation removes the legacy cache", async ({ page }) => {
  await page.evaluate(async (legacyCache) => {
    const cache = await caches.open(legacyCache);
    await cache.put("/legacy-shell.txt", new Response("legacy"));
  }, LEGACY_CACHE);

  await installCurrentServiceWorker(page);

  const state = await page.evaluate(async () => {
    const [registration] = await navigator.serviceWorker.getRegistrations();
    await registration.update();
    const cache = await caches.open("chronic-care-citizen-v61-public-demo-boundary");
    return {
      scriptURL: registration.active?.scriptURL || "",
      installing: Boolean(registration.installing),
      waiting: Boolean(registration.waiting),
      caches: await caches.keys(),
      shell: (await cache.keys()).map((request) => new URL(request.url).pathname).sort()
    };
  });

  expect(state.scriptURL).toMatch(/\/service-worker\.js$/);
  expect(state.installing).toBe(false);
  expect(state.waiting).toBe(false);
  expect(state.caches).toEqual([CURRENT_CACHE]);
  expect(state.shell).toEqual(expect.arrayContaining([
    "/citizen.html",
    "/data/public-demo.json",
    "/manifest.webmanifest",
    "/mobile-preview.html"
  ]));
});

test("PWA serves only the controlled navigation fallback while offline", async ({ context, page }) => {
  await installCurrentServiceWorker(page);
  expect(await page.evaluate(async () => {
    const response = await caches.match("/mobile-preview.html");
    return response ? { status: response.status, url: new URL(response.url).pathname } : null;
  })).toEqual({ status: 200, url: "/mobile-preview.html" });
  await context.setOffline(true);

  await page.goto("/mobile-preview.html?offline=pwa", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("手机预览 · 居民端");

  await page.goto("/offline-unlisted-path", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveTitle("居民端 · 健康档案与电子病历");
});

test("PWA cache excludes API and source data and can be fully cleared", async ({ page }) => {
  await installCurrentServiceWorker(page);

  const result = await page.evaluate(async () => {
    const api = await fetch("/api/health");
    const publicDemo = await fetch("/data/public-demo.json");
    const sourceData = await fetch("/data/db.json");
    const requests = [];
    for (const cacheName of await caches.keys()) {
      const cache = await caches.open(cacheName);
      requests.push(...(await cache.keys()).map((request) => new URL(request.url).pathname));
    }
    return {
      apiStatus: api.status,
      publicDemoStatus: publicDemo.status,
      sourceDataStatus: sourceData.status,
      requests
    };
  });

  expect(result.apiStatus).toBe(200);
  expect(result.publicDemoStatus).toBe(200);
  expect(result.sourceDataStatus).toBe(404);
  expect(result.requests).toContain("/data/public-demo.json");
  expect(result.requests.some((pathname) => pathname.startsWith("/api/"))).toBe(false);
  expect(result.requests).not.toContain("/data/db.json");

  expect(await clearPwaState(page)).toEqual({ registrations: 0, caches: [] });
});
