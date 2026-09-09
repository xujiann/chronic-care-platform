const { expect, test } = require("@playwright/test");

async function loginCitizen(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/citizen\.html$/);
}

async function verifyDialogSessionIsolation(page, scenario) {
  const result = await page.evaluate(async ({ outcome, nextSubmitting, sameButton = false, nativeClose = false }) => {
    // A separate real DOM avoids adding another controller to the production dialog.
    const frame = document.createElement("iframe");
    frame.title = "评价弹窗会话隔离回归";
    document.body.append(frame);
    try {
      const doc = frame.contentDocument;
      doc.body.innerHTML = `<button id="source-a" data-task-id="escort:a" data-task-collection="escortServiceOrders">评价 A</button>
        <button id="source-b" data-task-id="escort:b" data-task-collection="escortServiceOrders">评价 B</button>
        <dialog id="service-quality-feedback-dialog">
          <h2 id="service-quality-feedback-title"></h2>
          <form id="service-quality-feedback-form" method="dialog">
            <select name="satisfaction"><option value=""></option><option value="满意">满意</option><option value="不满意">不满意</option></select>
            <textarea name="comment"></textarea>
            <input type="checkbox" name="complaintRequested" value="open">
            <output id="service-quality-feedback-error"></output>
            <button type="button" data-quality-feedback-cancel>取消</button>
            <button type="submit">提交评价</button>
          </form>
        </dialog>`;
      const dialog = doc.querySelector("dialog");
      const form = doc.querySelector("form");
      const error = doc.querySelector("output");
      const submit = form.querySelector("button[type='submit']");
      const a = doc.querySelector("#source-a");
      const b = doc.querySelector(sameButton ? "#source-a" : "#source-b");
      const requests = [];
      const toasts = [];
      let renders = 0;
      let commandNumber = 0;
      const controller = window.CitizenServiceFeedback.createDialogController(doc, (taskId, collection, payload, command) => {
        let resolve;
        let reject;
        const promise = new Promise((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
        requests.push({ taskId, collection, payload, command, promise, resolve, reject });
        return promise;
      }, (message) => toasts.push(message), () => { renders += 1; }, () => ({ idempotencyKey: `browser-command-${++commandNumber}` }));
      const fill = (comment) => {
        form.elements.satisfaction.value = "不满意";
        form.elements.comment.value = comment;
        form.elements.complaintRequested.checked = true;
      };
      const send = () => form.dispatchEvent(new frame.contentWindow.Event("submit", { bubbles: true, cancelable: true }));
      const closed = () => new Promise((resolve) => dialog.addEventListener("close", resolve, { once: true }));
      controller.open(a);
      fill("第一会话的评价");
      send();
      send();
      const firstRequestCount = requests.length;
      const firstClosed = closed();
      if (nativeClose) dialog.close();
      else form.querySelector("[data-quality-feedback-cancel]").click();
      // Open before the browser dispatches A's queued native close event.
      controller.open(b);
      fill("第二会话的独立评价");
      if (nextSubmitting) send();
      await firstClosed;
      if (outcome === "success") requests[0].resolve({});
      else requests[0].reject(new Error("private stale database failure"));
      // The controller registered its continuation first, so this observes it completed.
      await requests[0].promise.catch(() => {});
      const afterOldCompletion = {
        open: dialog.open,
        comment: form.elements.comment.value,
        satisfaction: form.elements.satisfaction.value,
        complaintRequested: form.elements.complaintRequested.checked,
        error: error.textContent,
        submitDisabled: submit.disabled,
        sourceDisabled: b.disabled,
        toasts: [...toasts],
        renders
      };
      if (!nextSubmitting) send();
      const finalClosed = closed();
      requests[1].resolve({});
      await requests[1].promise;
      await finalClosed;
      return {
        firstRequestCount,
        afterOldCompletion,
        requestCount: requests.length,
        commands: requests.map((request) => request.command.idempotencyKey),
        lastTaskId: requests[1].taskId,
        lastComment: requests[1].payload.comment,
        finalOpen: dialog.open,
        finalRenders: renders,
        finalToasts: toasts
      };
    } finally {
      frame.remove();
    }
  }, scenario);
  expect(result.firstRequestCount).toBe(1);
  expect(result.afterOldCompletion).toEqual({
    open: true,
    comment: "第二会话的独立评价",
    satisfaction: "不满意",
    complaintRequested: true,
    error: scenario.nextSubmitting ? "正在提交评价…" : "",
    submitDisabled: scenario.nextSubmitting,
    sourceDisabled: scenario.nextSubmitting,
    toasts: [],
    renders: 0
  });
  expect(result.requestCount).toBe(2);
  expect(result.commands).toEqual(["browser-command-1", "browser-command-2"]);
  expect(result.lastTaskId).toBe(scenario.sameButton ? "escort:a" : "escort:b");
  expect(result.lastComment).toBe("第二会话的独立评价");
  expect(result.finalOpen).toBe(false);
  expect(result.finalRenders).toBe(1);
  expect(result.finalToasts).toEqual(["评价已提交，服务机构将跟进处理"]);
}

test("resident UI keeps a failed draft, recovers an ambiguous submission, and scopes family complaints", async ({ page }) => {
  const payloads = [];
  const idempotencyHeaders = [];
  let attempts = 0;
  let committedOrder = null;
  await page.route("**/api/tasks/**/actions", async (route) => {
    attempts += 1;
    const payload = route.request().postDataJSON();
    payloads.push(payload);
    idempotencyHeaders.push(route.request().headers()["idempotency-key"]);
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
  await expect(dialog.locator("#service-quality-feedback-error")).toHaveText("服务评价提交失败，请稍后重试。");
  await expect(dialog).not.toContainText("synthetic failure");
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
  expect(payloads.map(({ idempotencyKey, ...payload }) => payload)).toEqual([
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" },
    { action: "quality-feedback", comment: "服务迟到，希望机构联系说明", satisfaction: "不满意", complaintStatus: "open" }
  ]);
  expect(payloads[0].idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(payloads[1].idempotencyKey).toBe(payloads[0].idempotencyKey);
  expect(idempotencyHeaders).toEqual([payloads[0].idempotencyKey, payloads[0].idempotencyKey]);

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

  for (const outcome of ["success", "failure"]) {
    for (const nextSubmitting of [false, true]) {
      await test.step(`native queued close and stale ${outcome} preserve the ${nextSubmitting ? "submitting" : "editing"} session`, async () => {
        await verifyDialogSessionIsolation(page, { outcome, nextSubmitting });
      });
    }
    await test.step(`native close and same-button reopen isolate stale ${outcome}`, async () => {
      await verifyDialogSessionIsolation(page, { outcome, nextSubmitting: true, sameButton: true, nativeClose: true });
    });
  }

  for (const source of ["official", "local-fallback"]) {
    await test.step(`${source} orders keep cancellation requests pending until cancellation is confirmed`, async () => {
      await page.evaluate((orderSource) => {
        const orders = [
          { id: "eso-cancellation-pending-e2e", hospital: "取消申请回归医院", status: "cancel-requested" },
          { id: "eso-cancellation-terminal-e2e", hospital: "取消终态回归医院", status: "cancelled" }
        ].map((order) => ({
          ...order, residentId: "r1", department: "全科", providerName: "示范陪诊机构",
          serviceItems: ["exam escort"], appointmentAt: "2099-01-01",
          contractStatus: "signed", insuranceStatus: "covered", complaintStatus: "none"
        }));
        state.escortServiceOrders = orders;
        escortDashboard = { ...(escortDashboard || {}), orders: orders.map((order) => ({ ...order })) };
        const otherOrders = (serviceOrderCenter?.orders || []).filter((order) => order.serviceType !== "escort");
        serviceOrderCenter = {
          ...(serviceOrderCenter || {}),
          orders: orderSource === "official" ? [
            ...otherOrders,
            ...orders.map((order) => ({
              serviceOrderId: `escortServiceOrders:${order.id}`, sourceCollection: "escortServiceOrders",
              sourceId: order.id, serviceType: "escort", residentId: order.residentId,
              title: order.hospital, status: order.status, providerName: order.providerName,
              entryPage: "escort", scheduledAt: order.appointmentAt
            }))
          ] : []
        };
        renderCitizen("r1");
        document.body.classList.remove("service-paged-mode");
      }, source);

      const pendingOrder = page.locator("#service-order-cards .service-order-card").filter({ hasText: "取消申请回归医院" });
      const terminalOrder = page.locator("#service-order-cards .service-order-card").filter({ hasText: "取消终态回归医院" });
      const escortMetric = page.locator("#service-order-metrics article").filter({ has: page.getByText("陪诊", { exact: true }) });
      await expect(pendingOrder).toBeVisible();
      await expect(pendingOrder.locator(".status")).toHaveText(source === "official" ? "待处理 · cancel-requested" : "待处理 · 取消待确认");
      await expect(pendingOrder.locator(".status")).toHaveClass(/\bwarn\b/);
      await expect(terminalOrder.locator(".status")).toHaveText(/^已终止 · /);
      await expect(terminalOrder.locator(".status")).toHaveClass(/\bdanger\b/);
      await expect(escortMetric.locator("strong")).toHaveText("2");
      await expect(escortMetric.locator("small")).toHaveText("1 个需关注");

      await page.evaluate(() => {
        for (const order of [...state.escortServiceOrders, ...escortDashboard.orders]) {
          if (order.id === "eso-cancellation-pending-e2e") order.status = "cancelled";
        }
        for (const order of serviceOrderCenter.orders) {
          if (order.sourceId === "eso-cancellation-pending-e2e") order.status = "cancelled";
        }
        renderCitizen("r1");
      });
      await expect(pendingOrder.locator(".status")).toHaveText(/^已终止 · /);
      await expect(pendingOrder.locator(".status")).toHaveClass(/\bdanger\b/);
      await expect(escortMetric.locator("strong")).toHaveText("2");
      await expect(escortMetric.locator("small")).toHaveText("0 个需关注");
    });
  }
});
