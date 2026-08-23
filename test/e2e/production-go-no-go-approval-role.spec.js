const { expect, test } = require("@playwright/test");

const RESPONSIBILITIES = ["business", "information", "operations", "security"];

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

function centerFixture() {
  return {
    status: "awaiting-four-party-approval",
    evidenceFingerprint: "evidence-fingerprint-1",
    gate: { productionGoRecorded: false, formalDecisionEligible: false },
    summary: {
      prerequisitesPassed: 6,
      prerequisites: 6,
      prerequisiteReady: true,
      siteAcceptances: 10,
      approvalsRecorded: 0,
      approvals: 4,
      uniqueSigners: 0,
      staleApprovals: 0
    },
    checks: [],
    approvals: RESPONSIBILITIES.map((role) => ({
      id: `pgng-approval-${role}`,
      role,
      status: "pending",
      approvedBy: "",
      evidenceRef: "",
      evidenceFingerprint: ""
    })),
    decision: null,
    boundary: "Repository tests do not replace production evidence or site approval."
  };
}

test("commission keeps all four business-responsibility approval actions after auth filtering", async ({ page }) => {
  const posts = [];
  await loginCommission(page);
  await page.route("**/api/production-go-no-go/center", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify(centerFixture())
  }));
  await page.route("**/api/production-go-no-go/approvals/**/actions", async (route) => {
    posts.push({ url: route.request().url(), body: route.request().postDataJSON() });
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ center: centerFixture() })
    });
  });

  await page.goto("/platform.html");
  await expect(page.locator("#production-go-no-go-status")).toHaveText("awaiting-four-party-approval");
  await page.evaluate(() => window.HealthCityAuth.filterRoleFeatures());

  const approvals = page.locator("#production-go-no-go-approvals [data-go-no-go-approval]");
  await expect(approvals).toHaveCount(4);
  expect(await approvals.evaluateAll((buttons) => buttons.map((button) => button.dataset.approvalRole))).toEqual(RESPONSIBILITIES);

  const prompts = ["审批意见满足最小长度", "audit://four-party-approval-proof"];
  page.on("dialog", async (dialog) => dialog.accept(prompts.shift()));
  await approvals.first().click();
  await expect.poll(() => posts.length).toBe(1);
  expect(new URL(posts[0].url).pathname).toBe("/api/production-go-no-go/approvals/pgng-approval-business/actions");
  expect(posts[0].body).toEqual({
    action: "approve",
    responsibility: "business",
    evidenceRef: "audit://four-party-approval-proof",
    note: "审批意见满足最小长度"
  });
});
