const { expect, test } = require("@playwright/test");

async function loginCitizen(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/citizen\.html$/);
}

test("resident UI keeps a failed draft, recovers an ambiguous submission, and scopes family complaints", async ({ page }) => {
  const payloads = [];
  let attempts = 0;
  let committedOrder = null;
  await page.route("**/api/tasks/**/actions", async (route) => {
    attempts += 1;
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    if (attempts === 1) {
      committedOrder = {
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
        qualityReview: "citizen-feedback",
        taskAction: "quality-feedback",
        satisfaction: payload.satisfaction,
        complaintStatus: payload.complaintStatus,
        residentFeedback: payload.comment
      };
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "synthetic failure" }) });
      return;
    }
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ message: "该服务已提交评价，请勿重复提交" }) });
  });
  await page.route("**/api/state", async (route) => {
    if (!committedOrder) return route.continue();
    const upstream = await route.fetch();
    const payload = await upstream.json();
    payload.escortServiceOrders = [committedOrder, ...(payload.escortServiceOrders || []).filter((item) => item.id !== committedOrder.id)];
    await route.fulfill({ response: upstream, body: JSON.stringify(payload) });
  });
  await page.route("**/api/escort-services/dashboard", async (route) => {
    if (!committedOrder) return route.continue();
    const upstream = await route.fetch();
    const payload = await upstream.json();
    payload.orders = [committedOrder, ...(payload.orders || []).filter((item) => item.id !== committedOrder.id)];
    await route.fulfill({ response: upstream, body: JSON.stringify(payload) });
  });
  await page.route("**/api/service-orders**", async (route) => {
    if (!committedOrder) return route.continue();
    const upstream = await route.fetch();
    const payload = await upstream.json();
    const indexed = {
      id: `escortServiceOrders:${committedOrder.id}`,
      serviceOrderId: `escortServiceOrders:${committedOrder.id}`,
      sourceCollection: "escortServiceOrders",
      sourceId: committedOrder.id,
      serviceType: "escort",
      residentId: "r1",
      title: "评价回归医院 / 全科",
      status: "completed",
      lifecycle: "completed",
      providerName: "测试陪诊机构",
      entryPage: "escort",
      scheduledAt: "2026-09-07"
    };
    payload.orders = [indexed, ...(payload.orders || []).filter((item) => item.sourceId !== committedOrder.id)];
    await route.fulfill({ response: upstream, body: JSON.stringify(payload) });
  });
  await page.route("**/api/messages", async (route) => {
    if (!committedOrder) return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ messages: [{
        id: "msg-complaint-e2e",
        residentId: "r1",
        collection: "escortServiceOrders",
        sourceId: committedOrder.id,
        targetRole: "institution",
        channel: "in_app",
        title: "助医陪诊：服务投诉待跟进",
        body: "居民申请服务机构联系处理。",
        status: "sent",
        createdAt: "2026-09-07T09:00:00.000Z"
      }] })
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
  await expect(dialog.locator("#service-quality-feedback-error")).toContainText("synthetic failure");
  await expect(dialog.locator("select[name='satisfaction']")).toHaveValue("不满意");
  await expect(dialog.locator("textarea[name='comment']")).toHaveValue("服务迟到，希望机构联系说明");
  await expect(dialog.locator("input[name='complaintRequested']")).toBeChecked();

  await dialog.getByRole("button", { name: "提交评价" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator("#toast")).toContainText("评价与投诉已登记，已同步最新状态");
  await expect(task).toHaveCount(0);
  const order = page.locator("#service-order-cards .service-order-card").filter({ hasText: "评价回归医院" });
  await expect(order.getByRole("status", { name: "投诉跟进状态" })).toContainText("投诉已登记");
  await expect(order.getByRole("status", { name: "投诉跟进状态" })).toContainText("机构消息已读不代表投诉结案");
  await expect(page.locator("#citizen-notification-cards .citizen-notification-card").filter({ hasText: "服务投诉待跟进" })).toHaveCount(0);
  expect(payloads).toEqual([
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" },
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" }
  ]);

  await page.evaluate(() => {
    const account = state.accounts.find((item) => item.id === currentAccountId);
    if (!account.members.some((item) => item.residentId === "r2")) account.members.push({ residentId: "r2", relation: "家属" });
    if (!state.residents.some((item) => item.id === "r2")) state.residents.push({ id: "r2", name: "家庭成员", gender: "女", birthDate: "1970-01-01", organization: "基层医疗机构", familyDoctor: "家庭医生", metrics: { systolic: 120, diastolic: 75, glucose: 5.5, bmi: 22 } });
    state.escortServiceOrders.push({
      id: "eso-feedback-e2e", residentId: "r2", hospital: "家庭成员订单", department: "全科",
      providerName: "基层医疗机构", serviceItems: ["exam escort"], appointmentAt: "2026-09-08",
      status: "completed", qualityReview: "pending", complaintStatus: "none"
    });
    serviceOrderCenter.orders.push({
      serviceOrderId: "escortServiceOrders:eso-feedback-e2e", sourceCollection: "escortServiceOrders",
      sourceId: "eso-feedback-e2e", serviceType: "escort", residentId: "r2", title: "家庭成员订单",
      status: "completed", lifecycle: "completed", providerName: "基层医疗机构", scheduledAt: "2026-09-08"
    });
    renderCitizen("r1");
    document.body.classList.remove("service-paged-mode");
  });
  await page.locator("[data-member='r2']").click();
  await expect.poll(() => page.evaluate(() => currentResidentId)).toBe("r2");
  const familyOrder = page.locator("#service-order-cards .service-order-card").filter({ hasText: "家庭成员订单" });
  await expect(familyOrder).toBeVisible();
  await expect(familyOrder.getByRole("status", { name: "投诉跟进状态" })).toHaveCount(0);
  await expect(page.locator("#service-order-cards .service-order-card").filter({ hasText: "评价回归医院" })).toHaveCount(0);
});
