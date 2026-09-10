const { expect, test } = require("@playwright/test");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const HOSTILE_TEXT = '<img data-physical-exam-text-xss src="x" onerror="window.__physicalExamXss=true">';
const HOSTILE_CLASS = '"><img data-physical-exam-class-xss src="x" onerror="window.__physicalExamXss=true">';
const PHYSICAL_EXAM_OVERVIEW_URL = /\/api\/physical-exams(?:\?.*)?$/;

async function loginUser(page, username) {
  if (page.url() !== "about:blank") {
    await page.waitForLoadState("domcontentloaded");
    await page.evaluate(() => localStorage.removeItem("health-city-auth-session"));
  }
  await page.context().clearCookies();
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption(username);
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(username === "hospital" ? /institution\.html$/ : /index\.html$/);
}

async function loginCommission(page) {
  await loginUser(page, "health");
}

async function fulfillPhysicalExamOverview(route, resident) {
  const response = await route.fetch();
  const overview = await response.json();
  overview.residents = [resident];
  overview.reports = [];
  overview.years = [];
  overview.summary = { ...overview.summary, reports: 0, residents: 1 };
  await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(overview) });
}

async function verifyJointSignoffRoleControls(page) {
  const jointTest = {
    id: "joint-role-controls",
    institutionName: "示范医院",
    sourceType: "HIS",
    signoffStatus: "submitted-awaiting-independent-verification",
    siteSignoffVerified: false,
    checks: [{ id: "network", name: "网络连通", status: "pending" }],
    signoffSubmission: {
      externalSigner: "现场负责人",
      signerOrganization: "示范医院",
      evidenceDigest: "a".repeat(64)
    }
  };
  let jointActionRequests = 0;

  await page.route("**/api/physical-exams/joint-tests/**/actions", async (route) => {
    jointActionRequests += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "unexpected role-control request" }) });
  });
  await page.route("**/api/physical-exams", async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    overview.jointTests = [jointTest];
    await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await loginUser(page, "hospital");
  await page.goto("/physical-examination.html");
  const institutionCard = page.locator("[data-joint-test='joint-role-controls']");
  await expect(institutionCard.locator("[data-joint-check='network']")).toBeVisible();
  await expect(institutionCard.locator("[data-joint-submit]")).toBeVisible();
  await expect(institutionCard.locator("[data-joint-verify]")).toHaveCount(0);
  await expect(institutionCard.locator("[data-joint-reject]")).toHaveCount(0);
  expect(jointActionRequests).toBe(0);

  await loginCommission(page);
  await page.goto("/physical-examination.html");
  const commissionCard = page.locator("[data-joint-test='joint-role-controls']");
  await expect(commissionCard.locator("[data-joint-verify]")).toBeVisible();
  await expect(commissionCard.locator("[data-joint-reject]")).toBeVisible();
  expect(jointActionRequests).toBe(0);
  await page.unrouteAll({ behavior: "wait" });
}

async function verifyInitialLoadFailureAndRecovery(page) {
  let requestCount = 0;
  const malformedOverviews = [null, {}, [], "secret-internal-detail"];
  await loginCommission(page);
  await page.route("**/api/physical-exams", async (route) => {
    requestCount += 1;
    if (requestCount <= malformedOverviews.length) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(malformedOverviews[requestCount - 1])
      });
      return;
    }
    await fulfillPhysicalExamOverview(route, { id: "resident-recovered", name: "恢复后的居民" });
  });

  for (const _malformedOverview of malformedOverviews) {
    await page.goto("/physical-examination.html");
    await expect(page.locator("#physical-exam-report-summary")).toHaveText("体检数据暂不可用，请重试。");
    await expect(page.locator("#physical-exam-report-list")).toContainText("体检数据暂不可用，请重试。");
    await expect(page.locator("body")).not.toContainText("演示居民");
    await expect(page.locator("body")).not.toContainText("secret-internal-detail");
  }

  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("恢复后的居民");
  await page.unrouteAll({ behavior: "wait" });
}

async function verifyRefreshSnapshotAndRecovery(page) {
  let requestCount = 0;
  await page.route("**/api/physical-exams", async (route) => {
    requestCount += 1;
    if (requestCount === 2) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ summary: {}, residents: [], reports: "invalid", years: [] })
      });
      return;
    }
    if (requestCount === 3) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "upstream credential secret-internal-detail" })
      });
      return;
    }
    const resident = requestCount === 1
      ? { id: "resident-snapshot", name: "最后成功快照居民" }
      : { id: "resident-current", name: "重试恢复居民" };
    await fulfillPhysicalExamOverview(route, resident);
  });

  await page.goto("/physical-examination.html");
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("最后成功快照居民");

  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检数据刷新失败，请重试。");
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("最后成功快照居民");
  await expect(page.locator("#physical-exam-resident-filter")).not.toContainText("重试恢复居民");
  await expect(page.locator("body")).not.toContainText("演示居民");
  await expect(page.locator("body")).not.toContainText("secret-internal-detail");

  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检数据刷新失败，请重试。");
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("最后成功快照居民");
  await expect(page.locator("body")).not.toContainText("secret-internal-detail");

  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("重试恢复居民");
  await expect(page.locator("#physical-exam-resident-filter")).not.toContainText("最后成功快照居民");
  await page.unrouteAll({ behavior: "wait" });
}

async function verifyAbnormalActionRefreshRecovery(page) {
  let overviewRequests = 0;
  let delayedOverviewResponses = 0;
  let actionRequests = 0;
  let actionMode = "pending-success";
  let releaseAction;
  let releaseDelayedOverview;
  let releaseGenerationOverview;
  const actionRelease = new Promise((resolve) => {
    releaseAction = resolve;
  });
  const delayedOverviewRelease = new Promise((resolve) => {
    releaseDelayedOverview = resolve;
  });
  const generationOverviewRelease = new Promise((resolve) => {
    releaseGenerationOverview = resolve;
  });
  await page.route("**/api/physical-exams/abnormal-cases/**/actions", async (route) => {
    actionRequests += 1;
    if (actionMode === "pending-success") await actionRelease;
    if (actionMode === "failure") {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "proxy credential secret-abnormal-action" })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true })
    });
  });
  await page.route("**/api/physical-exams", async (route) => {
    const requestNumber = ++overviewRequests;
    if ([3, 6, 9].includes(requestNumber)) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "upstream credential secret-abnormal-refresh" })
      });
      return;
    }
    const response = await route.fetch();
    const overview = await response.json();
    Object.assign(overview, {
      residents: [{ id: "resident-abnormal", name: "异常处置居民" }],
      reports: [],
      years: [],
      summary: { ...overview.summary, reports: 0, residents: 1 },
      abnormalCases: [{
        id: "case-stale-refresh",
        residentId: "resident-abnormal",
        findingCodes: ["BP"],
        status: "pending-contact",
        classification: "high-risk",
        latestAction: "等待机构确认",
        owner: "示范医院",
        dueAt: "2026-09-10"
      }]
    });
    if (requestNumber === 2) await delayedOverviewRelease;
    if (requestNumber === 7) await generationOverviewRelease;
    await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(overview) });
    if (requestNumber === 2) delayedOverviewResponses += 1;
  });

  await page.goto("/physical-examination.html");
  const card = page.locator("#physical-exam-abnormal-cases .workflow-card", {
    has: page.locator("[data-case-id='case-stale-refresh']")
  });
  await card.locator("[data-case-action='notify']").click();
  await expect.poll(() => actionRequests).toBe(1);
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => card.locator("[data-case-action]").evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);
  await card.locator("[data-case-action='confirm']").evaluate((button) => button.click());
  await expect.poll(() => actionRequests).toBe(1);

  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(2);
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => card.locator("[data-case-action]").evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);

  releaseAction();
  await expect.poll(() => overviewRequests).toBe(3);
  await expect(page.locator("#physical-exam-toast")).toHaveText("操作已完成，但体检数据刷新失败，请重试。");
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => card.locator("[data-case-action]").evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);

  releaseDelayedOverview();
  await expect.poll(() => delayedOverviewResponses).toBe(1);
  await expect(page.locator("#physical-exam-toast")).toHaveText("操作已完成，但体检数据刷新失败，请重试。");
  await expect(card).toHaveAttribute("aria-busy", "true");
  await expect.poll(() => card.locator("[data-case-action]").evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);
  await card.locator("[data-case-action='notify']").evaluate((button) => button.click());
  await expect.poll(() => actionRequests).toBe(1);
  await expect(page.locator("body")).not.toContainText("secret-abnormal-refresh");

  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(page.locator("[data-case-id='case-stale-refresh'][data-case-action='notify']")).toBeEnabled();

  actionMode = "failure";
  await card.locator("[data-case-action='notify']").click();
  await expect.poll(() => actionRequests).toBe(2);
  await expect(page.locator("#physical-exam-toast")).toHaveText("异常处置失败，请稍后重试。");
  await expect(page.locator("body")).not.toContainText("secret-abnormal-action");
  await expect.poll(() => card.locator("[data-case-action]").evaluateAll((buttons) => buttons.every((button) => !button.disabled))).toBe(true);

  actionMode = "success";
  await card.locator("[data-case-action='notify']").click();
  await expect.poll(() => actionRequests).toBe(3);
  await expect(page.locator("#physical-exam-toast")).toHaveText("异常处置状态已更新");
  await expect(page.locator("[data-case-id='case-stale-refresh'][data-case-action='notify']")).toBeEnabled();

  await card.locator("[data-case-action='notify']").click();
  await expect.poll(() => actionRequests).toBe(4);
  await expect(page.locator("#physical-exam-toast")).toHaveText("操作已完成，但体检数据刷新失败，请重试。");
  await expect(card).toHaveAttribute("aria-busy", "true");

  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(7);
  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(8);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(card.locator("[data-case-action='notify']")).toBeEnabled();

  await card.locator("[data-case-action='notify']").click();
  await expect.poll(() => actionRequests).toBe(5);
  await expect.poll(() => overviewRequests).toBe(9);
  await expect(page.locator("#physical-exam-toast")).toHaveText("操作已完成，但体检数据刷新失败，请重试。");
  await expect(card).toHaveAttribute("aria-busy", "true");

  releaseGenerationOverview();
  await expect(card).toHaveAttribute("aria-busy", "true");
  await card.locator("[data-case-action='confirm']").evaluate((button) => button.click());
  await expect.poll(() => actionRequests).toBe(5);

  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(10);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(card.locator("[data-case-action='notify']")).toBeEnabled();
  await page.unrouteAll({ behavior: "wait" });
}

async function verifySupersededResidentFilter(page) {
  let overviewRequests = 0;
  let releaseFirstFilter;
  let releaseFailedFilter;
  let releaseYearFilter;
  let firstDelayedResponses = 0;
  let failedDelayedResponses = 0;
  let yearDelayedResponses = 0;
  const firstFilterRelease = new Promise((resolve) => {
    releaseFirstFilter = resolve;
  });
  const failedFilterRelease = new Promise((resolve) => {
    releaseFailedFilter = resolve;
  });
  const yearFilterRelease = new Promise((resolve) => {
    releaseYearFilter = resolve;
  });
  await page.route(PHYSICAL_EXAM_OVERVIEW_URL, async (route) => {
    const requestNumber = ++overviewRequests;
    if ([6, 8].includes(requestNumber)) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "latest filter refresh failed" })
      });
      return;
    }
    const residentId = new URL(route.request().url()).searchParams.get("residentId") || "";
    const response = await route.fetch();
    const overview = await response.json();
    const residentNames = {
      "resident-filter-a": "筛选居民甲",
      "resident-filter-b": "筛选居民乙",
      "resident-filter-c": "筛选居民丙"
    };
    Object.assign(overview, {
      residents: [
        { id: "resident-filter-a", name: "筛选居民甲" },
        { id: "resident-filter-b", name: "筛选居民乙" },
        { id: "resident-filter-c", name: "筛选居民丙" }
      ],
      reports: residentId ? [{
        id: `report-${residentId}`,
        residentId,
        residentName: residentNames[residentId],
        date: "2026-09-09",
        source: "示范医院",
        name: `${residentNames[residentId]}体检报告`,
        result: "已完成",
        meta: { abnormalCount: 0, reportNo: `REPORT-${residentId}` }
      }] : [],
      years: ["2026"],
      summary: { ...overview.summary, reports: residentId ? 1 : 0, residents: 3 }
    });
    if (requestNumber === 2) await firstFilterRelease;
    if (requestNumber === 5) await failedFilterRelease;
    if (requestNumber === 7) await yearFilterRelease;
    await route.fulfill({ response, status: 200, contentType: "application/json", body: JSON.stringify(overview) });
    if (requestNumber === 2) firstDelayedResponses += 1;
    if (requestNumber === 5) failedDelayedResponses += 1;
    if (requestNumber === 7) yearDelayedResponses += 1;
  });

  await page.goto("/physical-examination.html");
  const residentFilter = page.locator("#physical-exam-resident-filter");
  await expect(residentFilter).toContainText("筛选居民乙");
  await residentFilter.selectOption("resident-filter-a");
  await expect.poll(() => overviewRequests).toBe(2);
  await residentFilter.selectOption("resident-filter-b");
  await expect.poll(() => overviewRequests).toBe(3);
  await expect(residentFilter).toHaveValue("resident-filter-b");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民乙体检报告");

  releaseFirstFilter();
  await expect.poll(() => firstDelayedResponses).toBe(1);
  await expect(residentFilter).toHaveValue("resident-filter-b");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民乙体检报告");
  await expect(page.locator("#physical-exam-report-list")).not.toContainText("筛选居民甲体检报告");

  await residentFilter.selectOption("resident-filter-c");
  await expect.poll(() => overviewRequests).toBe(4);
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民丙体检报告");
  await residentFilter.selectOption("resident-filter-a");
  await expect.poll(() => overviewRequests).toBe(5);
  await residentFilter.selectOption("resident-filter-b");
  await expect.poll(() => overviewRequests).toBe(6);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检数据刷新失败，请重试。");
  await expect(residentFilter).toHaveValue("resident-filter-c");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民丙体检报告");

  releaseFailedFilter();
  await expect.poll(() => failedDelayedResponses).toBe(1);
  await expect(residentFilter).toHaveValue("resident-filter-c");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民丙体检报告");
  await expect(page.locator("#physical-exam-report-list")).not.toContainText("筛选居民甲体检报告");

  await residentFilter.selectOption("resident-filter-a");
  await expect.poll(() => overviewRequests).toBe(7);
  await page.locator("#physical-exam-year-filter").selectOption("2026");
  releaseYearFilter();
  await expect.poll(() => yearDelayedResponses).toBe(1);
  await expect(residentFilter).toHaveValue("resident-filter-a");
  await expect(page.locator("#physical-exam-year-filter")).toHaveValue("2026");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民甲体检报告");

  await residentFilter.selectOption("resident-filter-b");
  await expect.poll(() => overviewRequests).toBe(8);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检数据刷新失败，请重试。");
  await expect(residentFilter).toHaveValue("resident-filter-a");
  await expect(page.locator("#physical-exam-year-filter")).toHaveValue("2026");
  await expect(page.locator("#physical-exam-report-list")).toContainText("筛选居民甲体检报告");
  await page.unrouteAll({ behavior: "wait" });
}

async function verifySupersededImportRefresh(page) {
  let overviewRequests = 0;
  let importRequests = 0;
  let releaseImportRefresh;
  const importRefreshRelease = new Promise((resolve) => {
    releaseImportRefresh = resolve;
  });
  await page.route(PHYSICAL_EXAM_OVERVIEW_URL, async (route) => {
    const requestNumber = ++overviewRequests;
    const response = await route.fetch();
    const overview = await response.json();
    Object.assign(overview, {
      residents: [{ id: "resident-import", name: "导入验证居民" }],
      reports: [],
      years: [],
      summary: { ...overview.summary, reports: 0, residents: 1 }
    });
    if (requestNumber === 2) await importRefreshRelease;
    await route.fulfill({ response, status: 200, contentType: "application/json", body: JSON.stringify(overview) });
  });
  await page.route("**/api/physical-exams/import", async (route) => {
    importRequests += 1;
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, imported: 1, duplicates: 0, routed: 0, routedDuplicates: 0 })
    });
  });

  await page.goto("/physical-examination.html");
  const form = page.locator("#physical-exam-import-form");
  await expect(form.locator("[name='residentId']")).toHaveValue("resident-import");
  const externalId = form.locator("[name='externalId']");
  const reportNo = form.locator("[name='reportNo']");
  const initialExternalId = await externalId.inputValue();
  const initialReportNo = await reportNo.inputValue();
  await form.locator("button[type='submit']").click();
  await expect.poll(() => importRequests).toBe(1);
  await expect.poll(() => overviewRequests).toBe(2);

  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(3);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  releaseImportRefresh();
  await expect(page.locator("#physical-exam-import-result")).toContainText("已接入 1 份一般成人体检报告");
  await expect(externalId).toHaveValue(initialExternalId);
  await expect(reportNo).toHaveValue(initialReportNo);
  await page.unrouteAll({ behavior: "wait" });
}

async function verifySupersededSpecializedRecovery(page) {
  let overviewRequests = 0;
  const specializedCommands = [];
  let releaseConflictRefresh;
  let releaseUnknownRefresh;
  const conflictRefreshRelease = new Promise((resolve) => {
    releaseConflictRefresh = resolve;
  });
  const unknownRefreshRelease = new Promise((resolve) => {
    releaseUnknownRefresh = resolve;
  });
  await page.route("**/api/physical-exams/specialized-intakes/**/actions", async (route) => {
    const request = route.request();
    specializedCommands.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
    if (specializedCommands.length === 1) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT", message: "version changed" })
      });
      return;
    }
    if (specializedCommands.length === 2) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_STORAGE_FAILED", message: "temporarily unavailable" })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        idempotentReplay: true,
        intake: { id: "specialized-superseded", status: "routed-to-specialized-system", version: 4 }
      })
    });
  });
  await page.route(PHYSICAL_EXAM_OVERVIEW_URL, async (route) => {
    const requestNumber = ++overviewRequests;
    if ([3, 5].includes(requestNumber)) {
      await route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ message: "newer refresh failed" })
      });
      return;
    }
    const response = await route.fetch();
    const overview = await response.json();
    Object.assign(overview, {
      residents: [{ id: "resident-specialized", name: "专项分流居民" }],
      reports: [],
      years: [],
      summary: { ...overview.summary, reports: 0, residents: 1 },
      specializedIntakes: [{
        id: "specialized-superseded",
        version: 3,
        examProgramName: "专项体检",
        status: "pending",
        institutionName: "示范医院",
        examDate: "2026-09-09",
        externalId: "SPECIALIZED-SUPERSEDED-001",
        routingReason: "需进入专项系统",
        targetArchiveCategory: "专项档案",
        targetSystem: "specialized-system",
        profileId: "profile-demo"
      }]
    });
    if (requestNumber === 2) await conflictRefreshRelease;
    if (requestNumber === 4) await unknownRefreshRelease;
    await route.fulfill({ response, status: 200, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await page.goto("/physical-examination.html");
  const card = page.locator("[data-specialized-intake='specialized-superseded']");
  await card.locator("[data-specialized-evidence]").fill("evidence-conflict-superseded");
  await card.locator("[data-specialized-action='return-source']").click();
  await expect.poll(() => overviewRequests).toBe(2);
  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(3);
  releaseConflictRefresh();
  await expect(page.locator("#physical-exam-toast")).toHaveText("分流记录版本冲突；刷新正由较新请求处理，请核对后再操作");
  await expect(card.locator("[data-specialized-action='return-source']")).toBeEnabled();

  await card.locator("[data-specialized-evidence]").fill("evidence-unknown-superseded");
  await card.locator("[data-specialized-action='assign-profile']").click();
  await expect.poll(() => overviewRequests).toBe(4);
  await page.locator("#physical-exam-refresh").click();
  await expect.poll(() => overviewRequests).toBe(5);
  releaseUnknownRefresh();
  await expect(page.locator("#physical-exam-toast")).toHaveText("操作结果仍待确认；刷新正由较新请求处理，请稍后核对或使用原操作重试");
  await card.locator("[data-specialized-action='assign-profile']").click();
  await expect.poll(() => specializedCommands.length).toBe(3);
  expect(specializedCommands[0].key).toBeTruthy();
  expect(specializedCommands[1].key).toBeTruthy();
  expect(specializedCommands[1].key).not.toBe(specializedCommands[0].key);
  expect(specializedCommands[2].key).toBe(specializedCommands[1].key);
  expect(specializedCommands[2].body).toEqual(specializedCommands[1].body);
  await expect(page.locator("#physical-exam-toast")).toHaveText("已确认此前专项分流操作成功");
  await page.unrouteAll({ behavior: "wait" });
}

async function verifyFilePreviewFallback(page) {
  const loginUrl = new URL(pathToFileURL(path.resolve(__dirname, "../../login.html")).href);
  loginUrl.searchParams.set("redirect", "physical-examination.html");
  await page.goto(loginUrl.href);
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/physical-examination\.html$/);
  await expect(page.locator("#physical-exam-resident-filter")).toContainText("演示居民A");
  await expect(page.locator("#physical-exam-report-summary")).not.toHaveText("体检数据暂不可用，请重试。");
}

test("physical examination workbench keeps hostile API fields inert across all legacy render regions", async ({ page }) => {
  test.setTimeout(120_000);
  await test.step("joint signoff controls match the service role boundary", async () => {
    await verifyJointSignoffRoleControls(page);
  });
  await test.step("initial HTTP failure fails closed and a retry recovers", async () => {
    await verifyInitialLoadFailureAndRecovery(page);
  });
  await test.step("refresh failure preserves the last successful snapshot", async () => {
    await verifyRefreshSnapshotAndRecovery(page);
  });
  await test.step("completed abnormal action locks the stale card until refresh recovers", async () => {
    await verifyAbnormalActionRefreshRecovery(page);
  });
  await test.step("superseded resident filtering preserves the newest selection", async () => {
    await verifySupersededResidentFilter(page);
  });
  await test.step("superseded import refresh does not reseed the submitted identifiers", async () => {
    await verifySupersededImportRefresh(page);
  });
  await test.step("superseded specialized recovery stays neutral and preserves retry identity", async () => {
    await verifySupersededSpecializedRecovery(page);
  });
  await test.step("file preview retains the bounded demonstration fallback", async () => {
    await verifyFilePreviewFallback(page);
  });

  const pageErrors = [];
  const specializedCommands = [];
  let releaseFirstSpecializedAttempt;
  const firstSpecializedAttempt = new Promise((resolve) => {
    releaseFirstSpecializedAttempt = resolve;
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.addInitScript(() => {
    window.__physicalExamXss = false;
  });

  await page.route("**/api/physical-exams/specialized-intakes/**/actions", async (route) => {
    const request = route.request();
    specializedCommands.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
    if (specializedCommands.length === 1) {
      await firstSpecializedAttempt;
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_STORAGE_FAILED", message: "temporarily unavailable" })
      });
      return;
    }
    if (specializedCommands.length === 3) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          code: "PHYSICAL_EXAM_SPECIALIZED_INTAKE_VERSION_CONFLICT",
          message: "resource version changed; refresh and retry"
        })
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ok: true,
        idempotentReplay: true,
        intake: { id: "specialized-safe", status: "routed-to-specialized-system", version: 4 }
      })
    });
  });

  await page.route("**/api/physical-exams", async (route) => {
    const response = await route.fetch();
    const overview = await response.json();
    Object.assign(overview, {
      summary: Object.fromEntries([
        "reports", "residents", "institutions", "abnormalReports", "years", "synced", "signedReports",
        "mappingRate", "nationalMappingRate", "standardCompliantReports", "careLinkedReports",
        "familyDoctorSuggestions", "residentRiskTasks", "openAbnormalCases", "deadLetters"
      ].map((key) => [key, HOSTILE_TEXT])),
      residents: [{ id: "resident-hostile", name: HOSTILE_TEXT }],
      years: [HOSTILE_TEXT],
      sourceContracts: [{ name: HOSTILE_TEXT, systems: [HOSTILE_TEXT], transport: HOSTILE_TEXT, identity: HOSTILE_TEXT, required: [HOSTILE_TEXT] }],
      specializedIntakes: [{
        id: "specialized-safe",
        version: 3,
        examProgramName: HOSTILE_TEXT,
        status: HOSTILE_CLASS,
        institutionName: HOSTILE_TEXT,
        examDate: HOSTILE_TEXT,
        externalId: HOSTILE_TEXT,
        routingReason: HOSTILE_TEXT,
        targetArchiveCategory: HOSTILE_TEXT,
        targetSystem: HOSTILE_TEXT,
        profileId: HOSTILE_TEXT
      }],
      examPrograms: [],
      standards: [{ code: HOSTILE_TEXT, level: HOSTILE_TEXT, status: HOSTILE_TEXT, mandatory: true, name: HOSTILE_TEXT, source: "javascript:window.__physicalExamXss=true" }],
      qualityIndicators: [{ code: HOSTILE_TEXT, collectable: true, value: HOSTILE_TEXT, unit: HOSTILE_TEXT, name: HOSTILE_TEXT, numerator: HOSTILE_TEXT, denominator: HOSTILE_TEXT }],
      reports: [{
        id: "report-hostile",
        residentId: "resident-hostile",
        residentName: HOSTILE_TEXT,
        date: `2026-08-23${HOSTILE_TEXT}`,
        source: HOSTILE_TEXT,
        name: HOSTILE_TEXT,
        result: HOSTILE_TEXT,
        meta: {
          abnormalCount: 1,
          reportNo: HOSTILE_TEXT,
          externalId: HOSTILE_TEXT,
          standardVersion: HOSTILE_TEXT,
          qualityStatus: HOSTILE_TEXT,
          findings: [{ name: HOSTILE_TEXT, value: HOSTILE_TEXT, unit: HOSTILE_TEXT, reference: HOSTILE_TEXT, standard: HOSTILE_TEXT, abnormal: true }],
          recommendations: [HOSTILE_TEXT],
          signature: { status: HOSTILE_CLASS, algorithm: HOSTILE_TEXT, signatureNo: HOSTILE_TEXT },
          standardCompliance: { compliant: false, gaps: [HOSTILE_TEXT] },
          institutionQualification: { signerProfessionalTitle: HOSTILE_TEXT },
          sectionSignatures: [{ sectionId: HOSTILE_TEXT, physicianName: HOSTILE_TEXT }],
          healthQuestionnaire: {},
          radiationExaminations: [{ modality: HOSTILE_TEXT, dose: HOSTILE_TEXT, doseUnit: HOSTILE_TEXT }],
          careLinkage: { riskLevel: HOSTILE_TEXT, familyDoctorSuggestion: { suggestion: HOSTILE_TEXT }, dueAt: HOSTILE_TEXT }
        }
      }],
      readiness: {
        codeReady: false,
        gateway: { secretConfigured: false, signatureAlgorithm: HOSTILE_TEXT },
        storage: { adapterReady: false },
        quality: { standardsReady: false, nationalMappingRate: HOSTILE_TEXT, standardCompliantReports: HOSTILE_TEXT, reports: HOSTILE_TEXT },
        siteAcceptance: { ready: false, independentlyVerified: HOSTILE_TEXT, jointTests: HOSTILE_TEXT },
        blockers: [HOSTILE_TEXT],
        goLiveReady: false
      },
      abnormalCases: [{ id: HOSTILE_TEXT, findingCodes: [HOSTILE_TEXT], status: HOSTILE_CLASS, classification: HOSTILE_CLASS, latestAction: HOSTILE_TEXT, owner: HOSTILE_TEXT, dueAt: HOSTILE_TEXT }],
      jointTests: [{
        id: HOSTILE_TEXT,
        institutionName: HOSTILE_TEXT,
        siteSignoffVerified: false,
        signoffStatus: HOSTILE_TEXT,
        sourceType: HOSTILE_TEXT,
        checks: [{ id: HOSTILE_TEXT, name: HOSTILE_TEXT, status: HOSTILE_TEXT }],
        signoffSubmission: { externalSigner: HOSTILE_TEXT, signerOrganization: HOSTILE_TEXT, evidenceDigest: HOSTILE_TEXT }
      }],
      gatewayEvents: [{ externalId: HOSTILE_TEXT, status: HOSTILE_TEXT, receivedAt: HOSTILE_TEXT, retryCount: HOSTILE_TEXT, deadLetter: true, deadLetterReason: HOSTILE_TEXT }]
    });
    overview.highlights = {
      summary: Object.fromEntries(["trajectories", "translatedFindings", "openActions", "repeatCandidates", "radiationRecords", "qualityIssues", "activePassports"].map((key) => [key, HOSTILE_TEXT])),
      trajectories: [{ name: HOSTILE_TEXT, evidenceLevel: HOSTILE_TEXT, latest: { value: HOSTILE_TEXT, unit: HOSTILE_TEXT }, delta: HOSTILE_TEXT, points: [{ date: HOSTILE_TEXT, value: 1, unit: HOSTILE_TEXT, abnormal: true }] }],
      translations: [
        { status: HOSTILE_CLASS, title: HOSTILE_TEXT, value: HOSTILE_TEXT, plainMeaning: HOSTILE_TEXT, nextStep: HOSTILE_TEXT, department: HOSTILE_TEXT, boundary: HOSTILE_TEXT },
        { status: "high-risk", title: "高危解释", value: "1", plainMeaning: "需复核", nextStep: "复诊", department: "全科", boundary: "不替代诊断" }
      ],
      examPlans: [{ nextExamDate: HOSTILE_TEXT, reason: HOSTILE_TEXT, personalizedItems: [HOSTILE_TEXT], reduceOrReview: [HOSTILE_TEXT], ruleVersion: HOSTILE_TEXT }],
      repeatAvoidance: [{ name: HOSTILE_TEXT, previousDate: HOSTILE_TEXT, date: HOSTILE_TEXT, intervalDays: HOSTILE_TEXT, recommendation: HOSTILE_TEXT }],
      radiationLedger: [{ modality: HOSTILE_TEXT, date: HOSTILE_TEXT, purpose: HOSTILE_TEXT, dose: HOSTILE_TEXT, doseUnit: HOSTILE_TEXT, governanceStatus: HOSTILE_CLASS }],
      qualityReviews: [
        { status: HOSTILE_CLASS, institution: HOSTILE_TEXT, score: HOSTILE_TEXT, reportId: HOSTILE_TEXT, date: HOSTILE_TEXT, issues: [{ level: HOSTILE_CLASS, message: HOSTILE_TEXT }] },
        { status: "passed", institution: "安全机构", score: 100, reportId: "report-safe", date: "2026-08-23", issues: [{ level: "blocking", message: "阻断项" }] }
      ],
      institutionBenchmarks: [{ institutionName: HOSTILE_TEXT, reports: HOSTILE_TEXT, abnormalCases: HOSTILE_TEXT, notificationRate: HOSTILE_TEXT, followupRate: HOSTILE_TEXT, comparisonStatus: HOSTILE_CLASS }],
      cityRadar: [{ name: HOSTILE_TEXT, abnormalReports: HOSTILE_TEXT, institutionCount: HOSTILE_TEXT, message: HOSTILE_TEXT, privacyStatus: HOSTILE_TEXT }],
      standardsImpact: [{ code: HOSTILE_TEXT, affectedReports: HOSTILE_TEXT, affectedLayers: [HOSTILE_TEXT], nextAction: HOSTILE_TEXT }],
      criticalPaths: [{ classification: HOSTILE_CLASS, status: HOSTILE_TEXT, overdue: true, steps: [{ name: HOSTILE_TEXT, completed: false }], dueAt: HOSTILE_TEXT, escalation: HOSTILE_TEXT }]
    };
    await route.fulfill({ response, contentType: "application/json", body: JSON.stringify(overview) });
  });

  await page.goto("/physical-examination.html");
  const hostileTargets = [
    "#physical-exam-summary", "#physical-exam-highlight-summary", "#physical-exam-trajectories",
    "#physical-exam-plans", "#physical-exam-repeat-radiation", "#physical-exam-benchmarks",
    "#physical-exam-city-radar", "#physical-exam-standards-impact", "#physical-exam-critical-paths",
    "#physical-exam-readiness", "#physical-exam-blockers", "#physical-exam-abnormal-cases",
    "#physical-exam-joint-tests", "#physical-exam-gateway-events", "#physical-exam-contracts",
    "#physical-exam-specialized-intakes", "#physical-exam-standards", "#physical-exam-quality-indicators",
    "#physical-exam-report-list"
  ];
  for (const selector of hostileTargets) await expect(page.locator(selector)).toContainText(HOSTILE_TEXT);
  await expect(page.locator("#physical-exam-trajectories .mini-bars span")).toHaveClass(/height-[0-6]/);
  await expect(page.locator("#physical-exam-standards a")).not.toHaveAttribute("href", /.+/);
  const translations = page.locator("#physical-exam-translations");
  const qualityReviews = page.locator("#physical-exam-quality-reviews");
  const hostileTranslation = translations.locator(".translation-card").filter({ hasText: HOSTILE_TEXT });
  const hostileQualityReview = qualityReviews.locator(".quality-review-card").filter({ hasText: HOSTILE_TEXT });
  await expect(hostileTranslation).toHaveAttribute("class", "translation-card");
  await expect(hostileQualityReview).toHaveAttribute("class", "quality-review-card");
  await expect(hostileQualityReview.locator(".issue")).toHaveAttribute("class", "issue");
  await expect(translations.locator(".translation-card.high-risk")).toContainText("高危解释");
  await expect(qualityReviews.locator(".quality-review-card.passed .issue.blocking")).toHaveText("阻断项");
  const specializedCard = page.locator("[data-specialized-intake='specialized-safe']");
  await specializedCard.locator("[data-specialized-evidence]").fill("evidence-retry-001");
  await specializedCard.locator("[data-specialized-action='assign-profile']").click();
  await expect.poll(() => specializedCard.locator("[data-specialized-action]").evaluateAll((buttons) => buttons.every((button) => button.disabled))).toBe(true);
  releaseFirstSpecializedAttempt();
  await expect(page.locator("#physical-exam-toast")).toContainText("操作结果暂未确认");
  await page.locator("[data-specialized-intake='specialized-safe'] [data-specialized-action='assign-profile']").click();
  await expect.poll(() => specializedCommands.length).toBe(2);
  expect(specializedCommands[0].key).toBeTruthy();
  expect(specializedCommands[1].key).toBe(specializedCommands[0].key);
  expect(specializedCommands[0].body).toEqual(specializedCommands[1].body);
  expect(specializedCommands[0].body.expectedVersion).toBe(3);
  expect(specializedCommands[0].body.idempotencyKey).toBe(specializedCommands[0].key);
  await expect(page.locator("#physical-exam-toast")).toHaveText("已确认此前专项分流操作成功");
  const refreshedSpecializedCard = page.locator("[data-specialized-intake='specialized-safe']");
  await refreshedSpecializedCard.locator("[data-specialized-evidence]").fill("evidence-conflict-001");
  await refreshedSpecializedCard.locator("[data-specialized-action='return-source']").click();
  await expect.poll(() => specializedCommands.length).toBe(3);
  expect(specializedCommands[2].key).toBeTruthy();
  expect(specializedCommands[2].key).not.toBe(specializedCommands[0].key);
  expect(specializedCommands[2].body.expectedVersion).toBe(3);
  await expect(page.locator("#physical-exam-toast")).toHaveText("分流记录已被更新，请核对最新状态后重新提交");
  await page.locator("[data-report-id='report-hostile']").click();
  await expect(page.locator("#physical-exam-detail")).toContainText(HOSTILE_TEXT);
  await page.locator("#physical-exam-detail-dialog [data-close-report]").click();
  await page.locator("#physical-exam-refresh").click();
  await expect(page.locator("#physical-exam-toast")).toHaveClass(/visible/);
  await expect(page.locator("#physical-exam-toast")).toHaveText("体检报告已与健康档案重新同步");
  await expect(page.locator("[data-physical-exam-class-xss], [data-physical-exam-text-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__physicalExamXss)).toBe(false);
  expect(pageErrors).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
});
