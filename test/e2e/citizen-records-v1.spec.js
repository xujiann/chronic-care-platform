const { expect, test } = require("@playwright/test");
const fs = require("node:fs");

test("resident creates a scoped consent and revokes it through the dedicated audit route", async ({ page }) => {
  const authorizationWrites = [];
  await page.route(/\/api\/(?:personal-records|authorizations\/.*\/revoke)$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const payload = await response.json();
    const operation = /\/revoke$/.test(route.request().url()) ? "revoke" : "create";
    await route.fulfill({
      response,
      contentType: "application/json",
      body: JSON.stringify({
        ...payload,
        receiptId: `e2e-authorization-${operation}-receipt`,
        auditRef: `e2e-authorization-${operation}-audit`
      })
    });
  });
  page.on("request", (request) => {
    if (request.method() === "POST" && (/\/api\/personal-records$/.test(request.url()) || /\/api\/authorizations\/.*\/revoke$/.test(request.url()))) {
      authorizationWrites.push({ url: request.url(), headers: request.headers(), body: JSON.parse(request.postData() || "{}") });
    }
  });
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
  const recordSearch = page.locator("#vault-search-keyword");
  await recordSearch.fill("ECG-DEMO-001");
  await expect(page.locator("#vault-search-status")).toContainText("显示 1 /");
  await expect(diagnosticReport).toBeVisible();
  await recordSearch.fill("不存在的报告");
  await expect(page.locator("#vault-content")).toContainText("没有符合当前筛选条件的记录");
  await page.locator("#vault-search-clear").click();
  await expect(page.locator("#vault-search-status")).toContainText("检查检验：共");
  await expect(diagnosticReport).toBeVisible();
  const searchTouchHeight = await recordSearch.evaluate((element) => element.getBoundingClientRect().height);
  expect(searchTouchHeight).toBeGreaterThanOrEqual(44);

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
  await expect(page.locator("#auth-scope-preview")).toContainText("已选择 2 项授权范围");
  await expect(page.locator("#auth-scope-preview")).toContainText("健康档案摘要");
  await expect(page.locator("#auth-scope-preview")).toContainText("电子病历摘要");
  await expect(page.locator("#auth-scope-preview")).toContainText("不包含");
  await form.locator("input[name='consentConfirmed']").check();
  await form.getByRole("button", { name: "保存" }).click();

  const authorization = page.locator(".vault-item").filter({ hasText: "专项复诊团队" });
  await expect(authorization).toContainText("高血压复诊资料核对");
  await expect(authorization).toContainText("有效期至");
  await expect(authorization).toContainText("resident-record-consent-v1");
  const createWrite = authorizationWrites.find((item) => /\/api\/personal-records$/.test(item.url));
  expect(createWrite.headers["idempotency-key"]).toBeTruthy();
  expect(createWrite.body.idempotencyKey).toBe(createWrite.headers["idempotency-key"]);
  expect(createWrite.body.requestedAt).toBeTruthy();

  page.once("dialog", (dialog) => dialog.accept());
  await authorization.getByRole("button", { name: "撤销对专项复诊团队的授权" }).click();
  await expect(authorization).toContainText("已撤销");
  await expect(authorization.getByRole("button", { name: "撤销对专项复诊团队的授权" })).toHaveCount(0);
  const revokeWrite = authorizationWrites.find((item) => /\/api\/authorizations\/.*\/revoke$/.test(item.url));
  expect(revokeWrite.headers["idempotency-key"]).toBeTruthy();
  expect(revokeWrite.body.idempotencyKey).toBe(revokeWrite.headers["idempotency-key"]);
  expect(revokeWrite.body.resourceId).toBeTruthy();

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

test("resident uses the V2 care workspace for correction, one-time sharing and accessibility", async ({ page }) => {
  await page.route("**/api/record-care-workspace**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        corrections: [],
        sharePackages: [],
        taskUpdates: {},
        syncedAt: new Date().toISOString(),
        cursor: "e2e-cursor-1"
      })
    });
  });
  await page.route("**/api/record-corrections", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, receiptId: "receipt-correction-1", auditRef: "audit-correction-1" }) });
  });
  await page.route("**/api/record-share-packages", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, receiptId: "receipt-share-1", auditRef: "audit-share-1" }) });
  });
  await page.route("**/api/record-share-packages/*/revoke", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "revoked", ...body, receiptId: "receipt-revoke-1", auditRef: "audit-revoke-1" }) });
  });
  await page.route(/\/api\/access-reviews\?residentId=/, async (route) => {
    const authorizationExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        authorizations: [{
          id: "auth-renew-e2e",
          residentId: "r1",
          category: "authorizations",
          date: authorizationExpiry.slice(0, 10),
          name: "家庭医生续约团队",
          status: "active",
          meta: {
            status: "active",
            granteeId: "team-renew-e2e",
            granteeType: "care-team",
            purpose: "慢病复诊资料核对",
            scopes: ["health-record-summary", "labs"],
            expiresAt: authorizationExpiry,
            grantedAt: new Date().toISOString()
          }
        }, ...["pending", "rejected", "suspended"].map((status) => ({
          id: `auth-${status}-e2e`,
          residentId: "r1",
          category: "authorizations",
          date: authorizationExpiry.slice(0, 10),
          name: `${status}未来授权`,
          status,
          meta: {
            status,
            granteeId: `team-${status}-e2e`,
            granteeType: "care-team",
            purpose: "不得计入有效授权",
            scopes: ["health-record-summary"],
            expiresAt: authorizationExpiry,
            grantedAt: new Date().toISOString()
          }
        }))],
        accessLogs: [
          { id: "access-review-1", residentId: "r1", at: new Date().toISOString(), actor: "陌生机构A", role: "医疗机构", scope: "检验检查", purpose: "复诊资料核对", result: "允许", auditHash: "must-not-export" },
          { id: "access-review-2", residentId: "r1", at: new Date(Date.now() - 60000).toISOString(), actor: "未知主体", role: "未知", scope: "电子病历摘要", purpose: "查询", result: "拒绝" }
        ]
      })
    });
  });
  await page.route("**/api/access-reviews/*/acknowledge", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, receiptId: "receipt-access-ack", auditRef: "audit-access-ack" }) });
  });
  await page.route("**/api/access-reviews/*/disputes", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ...body, receiptId: "receipt-access-dispute", auditRef: "audit-access-dispute" }) });
  });
  await page.route("**/api/imaging-cloud/studies/*/viewer*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        viewerUrl: "javascript:alert('blocked')",
        expiresAt: new Date(Date.now() + 60 * 1000).toISOString(),
        oneTime: true,
        auditRef: "audit-malicious-viewer"
      })
    });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("citizen");
  await page.locator("input[name='password']").fill("123456");
  await page.getByRole("button", { name: "进入系统" }).click();
  await expect(page).toHaveURL(/citizen\.html$/);
  await page.goto("/citizen.html?client=mini-program&page=health-record");

  const workspace = page.locator("#citizen-care-workspace");
  await expect(workspace).toBeVisible();
  await expect(workspace).toContainText("异常结果闭环");
  await expect(workspace).toContainText("结构化电子病历");
  await expect(workspace).toContainText("用药核对");
  await expect(workspace).toContainText("档案完整度与更新提醒");
  await expect(page.locator("#citizen-current-subject")).toContainText("当前查看");
  await expect(page.locator("#citizen-care-sync-status")).toContainText("已安全同步");
  await page.evaluate(() => document.querySelector("#refresh-access-review").click());
  await expect(page.locator("#citizen-access-review-v2-list")).toContainText("陌生机构A");
  await expect(page.locator("#citizen-access-review-v2-list")).toContainText("未匹配当前有效授权");
  await expect(page.locator("#citizen-access-review-v2-list")).toContainText("已拦截，未披露");
  await expect(page.locator("#citizen-authorization-lifecycle-list")).toContainText("家庭医生续约团队");
  await expect(page.locator("#citizen-authorization-lifecycle-list")).toContainText("即将到期");
  await expect(page.locator("#data-governance-grid")).toContainText("1/4 条有效授权");
  await expect(page.locator("#citizen-highlight-grid")).toContainText("1/4 有效授权");
  await page.locator("[data-renew-authorization='auth-renew-e2e']").click();
  const renewalForm = page.locator("#auth-form");
  await expect(page.locator("#auth-dialog-title")).toHaveText("续授权");
  await expect(renewalForm.locator("input[name='granteeId']")).toHaveValue("team-renew-e2e");
  await expect(renewalForm.locator("input[name='previousAuthorizationId']")).toHaveValue("auth-renew-e2e");
  await expect(renewalForm.locator("input[name='expiresAt']")).toHaveValue("");
  await expect(renewalForm.locator("input[name='consentConfirmed']")).not.toBeChecked();
  await expect(page.locator("#auth-scope-preview")).toContainText("已选择 2 项授权范围");
  await expect(page.locator("#auth-scope-preview")).toContainText("检验检查");
  await renewalForm.getByRole("button", { name: "取消" }).click();

  await page.locator("[data-acknowledge-access='access-review-1']").click();
  await expect(page.locator("#citizen-access-review-v2-list")).toContainText("居民已确认");
  await page.locator("[data-fill-access-dispute='access-review-1']").click();
  const accessDisputeForm = page.locator("#citizen-access-dispute-form");
  await accessDisputeForm.locator("select[name='category']").selectOption("unknown-actor");
  await accessDisputeForm.locator("textarea[name='reason']").fill("本人不认识该访问机构，请平台复核");
  await accessDisputeForm.getByRole("button", { name: "提交访问异议" }).click();
  await expect(page.locator("#citizen-access-dispute-list")).toContainText("audit-access-dispute");

  const [accessDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("[data-export-access-review]").click()
  ]);
  const accessExport = fs.readFileSync(await accessDownload.path(), "utf8");
  expect(accessExport).toContain("陌生机构A");
  expect(accessExport).not.toContain("auditHash");
  expect(accessExport).not.toContain("must-not-export");
  await page.locator('[data-vault="imaging"]').click();
  await page.getByRole("button", { name: /受控调阅胸部 CT 影像报告/ }).click();
  await expect(page.locator("#toast")).toContainText("HTTPS");
  await expect(page).toHaveURL(/citizen\.html/);

  const correctionForm = page.locator("#citizen-correction-form");
  await correctionForm.locator("select[name='field']").selectOption("summary");
  await correctionForm.locator("input[name='requestedValue']").fill("请机构核对摘要");
  await correctionForm.locator("textarea[name='reason']").fill("居民发现摘要与纸质报告不一致");
  await correctionForm.getByRole("button", { name: "提交纠错申请" }).click();
  await expect(page.locator("#citizen-correction-list")).toContainText("居民发现摘要与纸质报告不一致");
  await expect(page.locator("#citizen-correction-list")).toContainText("原始版本保留");
  await expect(page.locator("#citizen-correction-list")).toContainText("audit-correction-1");

  const shareForm = page.locator("#citizen-share-package-form");
  const expiresAt = await page.evaluate(() => {
    const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  });
  await shareForm.locator("input[name='granteeId']").fill("hospital-transfer-a");
  await shareForm.locator("input[name='purpose']").fill("跨院转诊复诊");
  await shareForm.locator("input[name='expiresAt']").fill(expiresAt);
  await shareForm.locator("input[value='emr-summary']").check();
  await shareForm.locator("input[value='labs']").check();
  await shareForm.getByRole("button", { name: "创建一次性资料包" }).click();
  const sharePackage = page.locator("#citizen-share-package-list .citizen-care-row").filter({ hasText: "跨院转诊复诊" });
  await expect(sharePackage).toContainText("单次访问码");
  await expect(sharePackage).toContainText("有效期至");
  await expect(sharePackage).toContainText("audit-share-1");
  page.once("dialog", (dialog) => dialog.accept());
  await sharePackage.getByRole("button", { name: "立即撤销" }).click();
  await expect(page.locator("#citizen-share-package-list")).toContainText("已撤销");
  const storedCareData = await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("chronic-care-citizen-extra") || "{}");
    return Object.values(saved).some((item) => item?.recordCorrections || item?.recordSharePackages || item?.careTaskUpdates || item?.accessAcknowledgements || item?.accessDisputes);
  });
  expect(storedCareData).toBe(false);

  await page.getByRole("button", { name: "简洁模式" }).click();
  await expect(page.locator("body")).toHaveClass(/record-simple-mode/);
  await page.getByRole("button", { name: "高对比度" }).click();
  await expect(page.locator("body")).toHaveClass(/record-high-contrast/);
  await page.getByRole("button", { name: "放大照护中心文字" }).click();
  await expect(page.locator("#citizen-record-text-scale")).toHaveText("110%");
  const minimumTouchHeight = await page.getByRole("button", { name: "简洁模式" }).evaluate((element) => element.getBoundingClientRect().height);
  expect(minimumTouchHeight).toBeGreaterThanOrEqual(44);

  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("[data-clear-care-workspace]").click();
  await expect(page.locator("#citizen-care-sync-status")).toContainText("会话缓存已清理");
  await expect(page.locator("#citizen-correction-list")).toContainText("尚未提交");
});
