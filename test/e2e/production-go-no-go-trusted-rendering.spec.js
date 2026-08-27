const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-production-go-no-go-xss src="x" onerror="window.__productionGoNoGoXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

function hostileCenterFixture() {
  return {
    status: HOSTILE_TEXT,
    evidenceFingerprint: "current-evidence-fingerprint",
    gate: { productionGoRecorded: false, formalDecisionEligible: false },
    summary: {
      prerequisitesPassed: HOSTILE_TEXT,
      prerequisites: HOSTILE_TEXT,
      prerequisiteReady: true,
      siteAcceptances: HOSTILE_TEXT,
      approvalsRecorded: HOSTILE_TEXT,
      approvals: HOSTILE_TEXT,
      uniqueSigners: HOSTILE_TEXT,
      staleApprovals: HOSTILE_TEXT
    },
    checks: [{ id: HOSTILE_TEXT, passed: false, detail: HOSTILE_TEXT }],
    approvals: [{
      id: HOSTILE_TEXT,
      role: HOSTILE_TEXT,
      status: "approved",
      approvedBy: HOSTILE_TEXT,
      evidenceRef: HOSTILE_TEXT,
      evidenceFingerprint: "stale-evidence-fingerprint"
    }],
    decision: {
      decision: HOSTILE_TEXT,
      changeTicket: HOSTILE_TEXT,
      decidedBy: HOSTILE_TEXT
    },
    boundary: HOSTILE_TEXT
  };
}

test("production Go/No-Go center keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__productionGoNoGoXss = false;
  });
  await loginCommission(page);
  await page.route("**/api/production-go-no-go/center", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(hostileCenterFixture())
  }));

  await page.goto("/platform.html");

  await expect(page.locator("#production-go-no-go-status")).toHaveText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-metrics")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-checks")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-approvals")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-decision")).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-boundary")).toHaveText(HOSTILE_TEXT);
  await expect(page.locator("#production-go-no-go-approvals tr").last()).toHaveAttribute("data-go-no-go-drift", "stale");
  await expect(page.locator("#production-go-no-go-approvals [data-go-no-go-approval]")).toHaveAttribute("data-id", HOSTILE_TEXT);
  await expect(page.locator("[data-production-go-no-go-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__productionGoNoGoXss)).toBe(false);
  expect(pageErrors).toEqual([]);
});
