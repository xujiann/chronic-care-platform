const { test, expect } = require("@playwright/test");

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

async function openPublicHealth(page) {
  await loginCommission(page);
  await page.goto("/digital-hospital-standard-platform/index.html");
  await page.getByRole("button", { name: "公共卫生", exact: true }).click();
  await expect(page.getByRole("heading", { name: "公共卫生", exact: true })).toBeVisible();
}

test("digital hospital public health workbench accepts evidence, closes, filters and exports incidents", async ({ page }) => {
  await openPublicHealth(page);

  await expect(page.getByRole("heading", { name: "公共卫生异常事件台账" })).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "PHE-20260728-003" })).toBeVisible();
  await expect(page.getByText("phe-infectious-001", { exact: true })).toBeVisible();
  await expect(page.getByText("生产可信探测待现场").first()).toBeVisible();

  await page.getByRole("tab", { name: "证据签收" }).click();
  await expect(page.getByRole("heading", { name: "现场证据签收台账" })).toBeVisible();
  const approvalEvidence = page.locator("tbody tr").filter({ hasText: "APPROVAL-IMM-20260728-01" });
  await expect(approvalEvidence.getByText("待签收", { exact: true })).toBeVisible();
  await approvalEvidence.getByRole("button", { name: "签收", exact: true }).click();
  await expect(approvalEvidence.getByText("已签收", { exact: true })).toBeVisible();

  await page.getByRole("tab", { name: "事件处置" }).click();
  const reviewIncident = page.locator("tbody tr").filter({ hasText: "PHE-20260727-006" });
  await expect(reviewIncident.getByText("可关闭", { exact: true })).toBeVisible();
  await expect(reviewIncident.getByText("3/3 已独立签收", { exact: true })).toBeVisible();
  await reviewIncident.getByRole("button", { name: "复核关闭", exact: true }).click();
  await expect(reviewIncident.getByText("已关闭", { exact: true })).toBeVisible();

  await page.locator('[data-public-health-filter="publicHealthHospital"]').selectOption("H000003");
  await expect(page.getByText("当前1条", { exact: true })).toBeVisible();
  await expect(page.locator("tbody tr").filter({ hasText: "H000003" })).toHaveCount(1);

  await page.getByRole("button", { name: "重置", exact: true }).click();
  const incident = page.locator("tbody tr").filter({ hasText: "PHE-20260728-003" });
  await incident.getByRole("button", { name: "超时升级", exact: true }).click();
  await expect(incident.getByText("red · 已升级", { exact: true })).toBeVisible();
  await expect(incident.getByText("待核查", { exact: true })).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出CSV", exact: true }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("digital-hospital-public-health-incidents.csv");

  await page.getByRole("tab", { name: "处置统计" }).click();
  await expect(page.getByRole("heading", { name: "事件处置统计" })).toBeVisible();
  await expect(page.getByText("升级动作独立留痕", { exact: true })).toBeVisible();
});

test("digital hospital public health workbench stays within the mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openPublicHealth(page);
  await expect(page.getByRole("heading", { name: "公共卫生异常事件台账" })).toBeVisible();

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(pageOverflow).toBe(false);

  await page.getByRole("tab", { name: "通道连续性" }).click();
  await expect(page.getByRole("heading", { name: "端点与连续探测总览" })).toBeVisible();
  const continuityOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(continuityOverflow).toBe(false);

  await page.getByRole("tab", { name: "证据签收" }).click();
  await expect(page.getByRole("heading", { name: "现场证据签收台账" })).toBeVisible();
  const evidenceOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(evidenceOverflow).toBe(false);
  const evidenceTableScrollsInside = await page.locator(".public-health-evidence-table").evaluate((table) => {
    const wrapper = table.closest(".table-wrap");
    return table.scrollWidth > wrapper.clientWidth;
  });
  expect(evidenceTableScrollsInside).toBe(true);
});
