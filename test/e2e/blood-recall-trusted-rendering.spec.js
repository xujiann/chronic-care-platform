const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-blood-recall-xss src="x" onerror="window.__bloodRecallXss=true">';

async function loginInstitution(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("hospital");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/institution\.html$/);
}

test("blood recall actions keep hostile API fields inert and preserve acknowledgement interaction", async ({ page }) => {
  await page.addInitScript(() => {
    window.__bloodRecallXss = false;
  });
  await loginInstitution(page);

  let acknowledgementRequested = false;
  let recallAcknowledged = false;
  await page.route(/\/api\/blood-system$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        role: "institution",
        summary: { requests: 0, bloodUnits: 0, alerts: 0, traceEvents: 0 },
        donorSafetyCases: [],
        recalls: recallAcknowledged ? [] : [{
          id: HOSTILE_TEXT,
          reason: HOSTILE_TEXT,
          status: "active",
          bloodUnitIds: ["unit-1", "unit-2"],
          affectedInstitutions: ["MR1"],
          acknowledgementSummary: { pending: HOSTILE_TEXT }
        }],
        reactions: [],
        specimens: [],
        emergencyAllocations: [],
        bloodUnits: [],
        releaseReviews: [],
        shipments: [],
        compatibilityTests: [],
        transfusionEpisodes: [],
        transfusionRequests: []
      })
    });
  });
  await page.route(/\/api\/blood-system\/integration$/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: { contracts: 0, endpoints: 0, accepted: 0, deadLetters: 0 },
        contracts: [], endpoints: [], events: [], deadLetters: []
      })
    });
  });
  await page.route("**/api/blood-system/master-data", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ recallDispositions: ["inventory-frozen"] })
    });
  });
  await page.route("**/api/blood-system/recalls/*/acknowledge", async (route) => {
    acknowledgementRequested = true;
    recallAcknowledged = true;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });

  await page.goto("/blood.html");
  await page.locator("[data-view='safety']").click();

  const panel = page.locator("#recall-actions");
  await expect(panel).toContainText(HOSTILE_TEXT);
  await expect(panel.locator(".standard-item")).toHaveCount(1);
  const action = panel.locator("[data-recall-action]");
  await expect(action).toHaveAttribute("data-recall-action", HOSTILE_TEXT);
  await expect(page.locator("[data-blood-recall-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__bloodRecallXss)).toBe(false);

  await action.click();
  await expect.poll(() => acknowledgementRequested).toBe(true);
  await expect(page.locator("#toast")).toContainText("召回处置已确认");
  await expect(panel.locator(".standard-item")).toHaveCount(1);
  await expect(panel).toContainText("当前机构没有待确认的召回通知。");
  await expect(panel.locator(".signal.ok")).toHaveText("无待办");
  await expect(panel.locator("[data-recall-action]")).toHaveCount(0);
});
