const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-product-regional-operations-xss src="x" onerror="window.__productRegionalOperationsXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("product regional operations cockpit keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  await page.addInitScript(() => {
    window.__productRegionalOperationsXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/platform/productization/enhancements/cockpit", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    report.cockpit = {
      schemaVersion: "product-regional-operations-view-model-v1",
      status: HOSTILE_TEXT,
      productionReady: false,
      cards: [{ id: "hostile-card", label: HOSTILE_TEXT, value: HOSTILE_TEXT, state: HOSTILE_TEXT }],
      workItems: [{
        id: HOSTILE_TEXT,
        category: HOSTILE_TEXT,
        domain: HOSTILE_TEXT,
        priority: HOSTILE_TEXT,
        status: HOSTILE_TEXT,
        slaState: HOSTILE_TEXT,
        assignedRole: HOSTILE_TEXT,
        unreadMessages: HOSTILE_TEXT,
        version: HOSTILE_TEXT,
        timeline: [{ at: HOSTILE_TEXT, actorRole: HOSTILE_TEXT, action: HOSTILE_TEXT, resultingStatus: HOSTILE_TEXT }]
      }],
      regions: [{
        regionCode: HOSTILE_TEXT,
        deploymentClass: HOSTILE_TEXT,
        enabledCapabilities: HOSTILE_TEXT,
        configurationReady: false,
        deploymentStatus: HOSTILE_TEXT,
        replicationStatus: HOSTILE_TEXT,
        acceptanceState: HOSTILE_TEXT,
        productionReady: false
      }],
      configurationDiffs: [{
        baselineRegionCode: HOSTILE_TEXT,
        targetRegionCode: HOSTILE_TEXT,
        featureDifferenceCount: HOSTILE_TEXT,
        configDifferenceCount: HOSTILE_TEXT,
        extensionDifferenceCount: HOSTILE_TEXT,
        containsConfigurationValues: false
      }],
      boundary: HOSTILE_TEXT
    };

    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify(report)
    });
  });

  await page.goto("/platform.html");

  const cockpit = page.locator("#platform-enhancement-operations");
  await expect(cockpit.locator(".metric")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator("[data-product-work-item-v2]")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator("[data-region-code]")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator("ul")).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator(".muted").last()).toContainText(HOSTILE_TEXT);
  await expect(cockpit.locator("section")).toHaveAttribute("data-product-regional-status", HOSTILE_TEXT);
  await expect(cockpit.locator("[data-product-work-item-v2]")).toHaveAttribute("data-product-work-item-v2", HOSTILE_TEXT);
  await expect(cockpit.locator("[data-region-code]")).toHaveAttribute("data-region-code", HOSTILE_TEXT);
  await expect(page.locator("[data-product-regional-operations-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__productRegionalOperationsXss)).toBe(false);
});
