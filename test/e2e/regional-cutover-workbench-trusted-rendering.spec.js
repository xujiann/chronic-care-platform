const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-regional-cutover-xss src="x" onerror="window.__regionalCutoverXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("regional cutover workbench keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__regionalCutoverXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/regional/cutover-workbench", async (route) => {
    const response = await route.fetch();
    const report = await response.json();
    const region = report.regions[0];
    report.summary.regions = HOSTILE_TEXT;
    report.regions = [{
      ...region,
      regionCode: HOSTILE_TEXT,
      regionName: HOSTILE_TEXT,
      release: { ...region.release, state: HOSTILE_TEXT },
      operations: { ...region.operations, status: HOSTILE_TEXT },
      storage: { ...region.storage, mode: HOSTILE_TEXT },
      evidence: {
        ...region.evidence,
        lifecycleState: HOSTILE_TEXT,
        readyScopes: HOSTILE_TEXT,
        requiredScopes: HOSTILE_TEXT
      },
      blockers: [HOSTILE_TEXT]
    }];
    report.boundary = HOSTILE_TEXT;
    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify(report)
    });
  });

  await page.goto("/platform.html");

  const workbench = page.locator("#regional-cutover-workbench-panel");
  await expect(workbench.locator(".metric").first()).toContainText(HOSTILE_TEXT);
  await expect(workbench.locator(".evidence-card")).toContainText(HOSTILE_TEXT);
  await expect(workbench.locator(".evidence-card")).toHaveAttribute("data-regional-cutover-region", HOSTILE_TEXT);
  await expect(workbench.locator("#regional-cutover-workbench-boundary")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("[data-regional-cutover-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__regionalCutoverXss)).toBe(false);
  expect(pageErrors).toEqual([]);
});
