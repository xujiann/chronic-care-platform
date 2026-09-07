const { expect, test } = require("@playwright/test");

async function loginCitizen(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/citizen\.html$/);
}

test("resident submits a real completed-service rating and keeps the draft after failure", async ({ page }) => {
  const payloads = [];
  let attempts = 0;
  await page.route("**/api/tasks/**/actions", async (route) => {
    attempts += 1;
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    if (attempts === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "synthetic failure" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "eso-feedback-e2e",
        residentId: "r1",
        hospital: "评价回归医院",
        department: "全科",
        providerName: "测试陪诊机构",
        status: "completed",
        qualityReview: "citizen-feedback",
        taskAction: "quality-feedback",
        satisfaction: payload.satisfaction,
        complaintStatus: payload.complaintStatus,
        residentFeedback: payload.comment
      })
    });
  });

  await loginCitizen(page);
  await page.waitForFunction(() => typeof currentAccountId === "string" && currentAccountId.length > 0);
  await page.evaluate(() => {
    const completedOrder = {
      id: "eso-feedback-e2e",
      residentId: "r1",
      hospital: "评价回归医院",
      department: "全科",
      providerName: "测试陪诊机构",
      serviceItems: ["exam escort"],
      appointmentAt: "2026-09-07",
      status: "completed",
      contractStatus: "signed",
      insuranceStatus: "covered",
      qualityReview: "pending",
      complaintStatus: "none"
    };
    state.escortServiceOrders = [completedOrder];
    escortDashboard = { ...(escortDashboard || {}), orders: [{ ...completedOrder }] };
    renderCitizen(currentResidentId);
  });

  const task = page.locator("#reminder-cards .service-task-card").filter({ hasText: "评价回归医院" });
  await expect(task.getByRole("button", { name: "评价" })).toBeVisible();
  await expect(task.getByRole("button", { name: "确认" })).toHaveCount(0);
  await expect(task.getByRole("button", { name: "取消" })).toHaveCount(0);
  await task.getByRole("button", { name: "评价" }).click();

  const dialog = page.locator("#service-quality-feedback-dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("select[name='satisfaction']").selectOption("不满意");
  await dialog.locator("textarea[name='comment']").fill("服务迟到，希望机构联系说明");
  await dialog.locator("input[name='complaintRequested']").check();
  await dialog.getByRole("button", { name: "提交评价" }).click();

  await expect(dialog).toBeVisible();
  await expect(dialog.locator("#service-quality-feedback-error")).toContainText("服务待办更新失败：500");
  await expect(dialog.locator("select[name='satisfaction']")).toHaveValue("不满意");
  await expect(dialog.locator("textarea[name='comment']")).toHaveValue("服务迟到，希望机构联系说明");
  await expect(dialog.locator("input[name='complaintRequested']")).toBeChecked();

  await dialog.getByRole("button", { name: "提交评价" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#toast")).toContainText("评价已提交，服务机构将跟进处理");
  await expect(task).toHaveCount(0);
  expect(payloads).toEqual([
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" },
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" }
  ]);
});
