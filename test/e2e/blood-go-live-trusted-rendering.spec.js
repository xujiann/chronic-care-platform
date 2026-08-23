const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-blood-go-live-xss src="x" onerror="window.__bloodGoLiveXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("blood go-live board keeps hostile API evidence fields as inert text", async ({ page }) => {
  await page.addInitScript(() => {
    window.__bloodGoLiveXss = false;
  });
  await loginCommission(page);

  await page.route("**/api/blood-system/go-live", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        productionReady: false,
        summary: {
          endpointsReady: HOSTILE_TEXT,
          endpoints: HOSTILE_TEXT,
          requirementsSigned: HOSTILE_TEXT,
          requirements: HOSTILE_TEXT,
          drillsPassed: HOSTILE_TEXT,
          drills: HOSTILE_TEXT,
          migrationsReconciled: HOSTILE_TEXT,
          migrations: HOSTILE_TEXT
        },
        clinicalProduction: {
          gates: {
            receiptsValid: false,
            mastersValid: false,
            coldChainValid: false,
            scenariosValid: false,
            smokePassed: false,
            rollbackPassed: false
          }
        },
        endpoints: [{ name: HOSTILE_TEXT, owner: HOSTILE_TEXT, status: HOSTILE_TEXT }],
        requirements: [{ title: HOSTILE_TEXT, owner: HOSTILE_TEXT, status: HOSTILE_TEXT }],
        drills: [{ title: HOSTILE_TEXT, status: HOSTILE_TEXT, evidenceRef: HOSTILE_TEXT }],
        migrations: [{
          name: HOSTILE_TEXT,
          sourceCount: HOSTILE_TEXT,
          targetCount: HOSTILE_TEXT,
          status: HOSTILE_TEXT
        }],
        approvals: [{ title: HOSTILE_TEXT, status: HOSTILE_TEXT, signedBy: HOSTILE_TEXT }],
        rollback: {
          strategy: HOSTILE_TEXT,
          rpoMinutes: HOSTILE_TEXT,
          rtoMinutes: HOSTILE_TEXT,
          triggers: [HOSTILE_TEXT]
        }
      })
    });
  });

  await page.goto("/blood-go-live.html");

  for (const selector of [
    "#gl-summary",
    "#gl-endpoints",
    "#gl-requirements",
    "#gl-drills",
    "#gl-migrations",
    "#gl-approvals",
    "#gl-rollback"
  ]) {
    await expect(page.locator(selector)).toContainText(HOSTILE_TEXT);
  }
  await expect(page.locator("#gl-clinical-gates tbody tr")).toHaveCount(6);
  await expect(page.locator("#gl-standard-registry tbody tr")).toHaveCount(1);
  await expect(page.locator("[data-blood-go-live-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__bloodGoLiveXss)).toBe(false);
});
