const { expect, test } = require("@playwright/test");

test("resident creates a scoped consent and revokes it through the dedicated audit route", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/citizen\.html$/);
  await page.goto("/citizen.html?client=mini-program&page=health-record");

  await expect(page.locator("#resident-records-v1")).toBeVisible();
  await expect(page.locator("#resident-records-v1")).toContainText("只读健康记录");
  await expect(page.locator("#upload-form select[name='category'] option[value='emr']")).toHaveCount(0);

  await page.locator('[data-vault="imaging"]').click();
  const imageCloudReport = page.locator(".vault-item").filter({ hasText: "双肺纹理增多" });
  await expect(imageCloudReport).toContainText("胸部 CT 影像报告");
  await expect(imageCloudReport).toContainText("质控通过");
  await expect(imageCloudReport.getByRole("button", { name: /受控调阅胸部 CT 影像报告/ })).toHaveText("进入受控影像调阅");
  await expect(page.locator("#vault-content")).not.toContainText("oss://");
  await expect(page.locator("#vault-content")).not.toContainText("objectPath");
  const imagingTouchHeight = await imageCloudReport.getByRole("button", { name: /受控调阅胸部 CT 影像报告/ }).evaluate((element) => element.getBoundingClientRect().height);
  expect(imagingTouchHeight).toBeGreaterThanOrEqual(44);

  await page.locator('[data-vault="labs"]').click();
  const diagnosticReport = page.locator(".vault-item").filter({ hasText: "ECG-DEMO-001" });
  await expect(diagnosticReport).toContainText("ECG检查报告");
  await expect(diagnosticReport).toContainText("已互认");
  await expect(diagnosticReport).toContainText("报告原文仍按授权和访问审计规则调阅");

  await page.locator('[data-vault="medications"]').click();
  const medicationService = page.locator(".vault-item").filter({ hasText: "下次取药 2026-07-05" }).first();
  await expect(medicationService).toContainText("苯磺酸氨氯地平片");
  await expect(medicationService).toContainText("机构审核已确认");
  await expect(medicationService).toContainText("取药服务状态不替代医嘱");

  await page.locator("#grant-auth").click();
  const form = page.locator("#auth-form");
  await form.locator("input[name='granteeName']").fill("专项复诊团队");
  await form.locator("input[name='granteeId']").fill("team-special-review");
  await form.locator("select[name='granteeType']").selectOption("care-team");
  await form.locator("input[name='purpose']").fill("高血压复诊资料核对");
  await form.locator("input[value='health-record-summary']").check();
  await form.locator("input[value='emr-summary']").check();
  await form.locator("input[name='consentConfirmed']").check();
  await form.getByRole("button", { name: "保存" }).click();

  const authorization = page.locator(".vault-item").filter({ hasText: "专项复诊团队" });
  await expect(authorization).toContainText("高血压复诊资料核对");
  await expect(authorization).toContainText("有效期至");
  await expect(authorization).toContainText("resident-record-consent-v1");

  page.once("dialog", (dialog) => dialog.accept());
  await authorization.getByRole("button", { name: "撤销对专项复诊团队的授权" }).click();
  await expect(authorization).toContainText("已撤销");
  await expect(authorization.getByRole("button", { name: "撤销对专项复诊团队的授权" })).toHaveCount(0);

  await page.locator('[data-highlight-command="toggle-large-mode"]').click();
  await expect(page.locator("body")).toHaveClass(/large-mode/);
  const minimumTouchHeight = await page.locator("#vault-tabs button").first().evaluate((element) => element.getBoundingClientRect().height);
  expect(minimumTouchHeight).toBeGreaterThanOrEqual(44);

  await page.goto("/citizen.html?client=mini-program&page=emr");
  await page.locator("#refresh-access-review").click();
  await expect(page.locator("#access-review-summary")).toContainText("条记录");
  await expect(page.locator("#access-log-cards .mini-card").first()).toBeVisible();
  await expect(page.locator("#access-log-cards")).not.toContainText("auditHash");
  await expect(page.locator("#access-log-cards")).not.toContainText("personIndex");
});
