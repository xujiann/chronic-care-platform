const { expect, test } = require("@playwright/test");

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("commission navigation exposes the new governed work centers and pages remain mobile safe", async ({ page }) => {
  test.setTimeout(120_000);
  await loginCommission(page);

  const pages = [
    ["unified-work-center.html", "统一待办与消息中心"],
    ["account-lifecycle.html", "账号全生命周期工作台"],
    ["maternal-child.html", "出生证明与妇幼接续任务工作台"],
    ["referral-teleconsultation.html", "转诊与远程会诊任务工作台"],
    ["drug-consumable.html", "药耗监管与整改协同工作台"],
    ["medical-payment.html", "医疗付费一件事"],
    ["regional-clinical-documents.html", "区域医疗文书中心"],
    ["clinical-ai-cdss.html", "临床决策支持安全治理中心"],
    ["research-sandbox.html", "科研数据集与安全沙箱工作台"],
    ["public-health-supervision-cases.html", "卫生监督案件协同工作台"]
  ];

  for (const [target] of pages) {
    await expect(page.locator(`.navigation-sidebar a[data-navigation-page='${target}']`)).toHaveCount(1);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  for (const [target, title] of pages) {
    await page.goto(`/${target}`);
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-auth-resolved", "allowed");
    if (target === "unified-work-center.html") {
      await expect(page.locator("#work-source-title")).toHaveText("实时业务数据已连接");
    }
    if (target === "account-lifecycle.html") {
      await expect(page.locator("#account-source-title")).toHaveText("账号治理数据已连接");
    }
    if (target === "medical-payment.html") {
      await expect(page.locator("#payment-source-title")).toHaveText("医疗付费业务服务已连接");
    }
    if (target === "regional-clinical-documents.html") {
      await expect(page.locator("#document-source-title")).toHaveText("区域医疗文书业务服务已连接");
    }
    if (target === "clinical-ai-cdss.html") {
      await expect(page.locator("#clinical-ai-source-title")).toHaveText("临床决策支持治理服务已连接");
      await expect(page.locator("#clinical-ai-decision")).toHaveText("NO-GO");
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${target} must stay inside the mobile viewport`).toBe(false);
  }
});

test("medical payment center renders hostile provider text as inert content", async ({ page }) => {
  const hostile = '<img src=x onerror="globalThis.paymentCompromised=true">';
  await loginCommission(page);
  await page.route("**/api/medical-payments/center", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: "medical-payment-one-stop-view-v1",
      productionReady: false,
      scope: { role: "commission", organizationCode: "cross-organization", gatewayTypes: ["PAYMENT"] },
      actions: { dispatchPayment: false, requestRefund: false, reviewRefund: false, runReconciliation: false },
      summary: { orders: 1, transactions: 1, pending: 0, succeeded: 1, exceptions: 0, grossAmountFen: 100, personalAmountFen: 100, insuranceAmountFen: 0, refundRequests: 0, refundPendingReview: 0, refundExceptions: 0, reconciliationRuns: 0, reconciliationDifferences: 0 },
      queue: [{ id: "hostile-payment", gatewayType: "PAYMENT", operation: "create-payment", orderReference: hostile, institutionCode: hostile, receiptId: hostile, status: "succeeded", reconciliationStatus: hostile, businessDate: "2026-09-04", amountFen: 100, personalAmountFen: 100, insuranceAmountFen: 0, reservedRefundFen: 0, availableRefundFen: 0, actions: { requestRefund: false } }],
      refunds: [], refundExceptions: [], reconciliationRuns: [], gateways: [], blockers: [hostile]
    })
  }));
  await page.goto("/medical-payment.html");
  await expect(page.locator("#payment-queue")).toContainText(hostile);
  await expect(page.locator("#payment-blockers")).toContainText(hostile);
  await expect(page.locator("#payment-queue img, #payment-blockers img")).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.paymentCompromised)).toBeUndefined();
});

test("regional clinical document center renders hostile provider text as inert content", async ({ page }) => {
  const hostile = '<img src=x onerror="globalThis.documentCenterCompromised=true">';
  await loginCommission(page);
  await page.route("**/api/integration/clinical-documents/center", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: "regional-clinical-document-center-v1",
      sourceRequirement: "D-INT-DOC",
      productionReady: false,
      scope: { role: "commission", organizationCode: "cross-organization", crossInstitutionVisible: true, clinicalDetailVisible: false },
      actions: { queryDocuments: true, queryClinicalDetail: false, requestPdfIntent: false, retryExceptions: true },
      summary: { documents: 1, institutions: 1, collectedToday: 1, medicalRecordCards: 0, dischargeSummaries: 1, pendingReport: 0, reported: 0, exceptions: 1, pdfReady: 0 },
      documents: [{ id: "hostile-document", documentType: "discharge-summary", documentLabel: hostile, sourceRecordReference: hostile, residentReference: hostile, institutionCode: hostile, documentDate: "2026-09-04", receivedAt: "2026-09-04T10:00:00.000Z", status: "exception", reportingStatus: "exception", clinicalSummary: "", validation: { status: "exception", passed: false, failedChecks: [hostile] }, pdf: { available: false, attachmentId: "", filename: "", integrityStatus: "not-ready" }, retryCount: 0, actions: { queryDetail: false, viewPdf: false, retryException: true } }],
      exceptions: [{ id: "hostile-document", documentLabel: hostile, institutionCode: hostile, residentReference: hostile, issueCodes: [hostile], retryCount: 0, actions: { retryException: true }, nextAction: hostile }],
      uploadLogs: [{ id: "hostile-document", sourceRecordReference: hostile, documentLabel: hostile, institutionCode: hostile, receivedAt: "2026-09-04T10:00:00.000Z", validationStatus: "exception", reportingStatus: "exception", retryCount: 0 }],
      workstationReminders: [],
      capabilities: [{ id: "hostile", label: hostile, status: "external-evidence-required", interface: hostile }],
      blockers: [hostile]
    })
  }));
  await page.goto("/regional-clinical-documents.html");
  await expect(page.locator("#document-list")).toContainText(hostile);
  await expect(page.locator("#document-exceptions")).toContainText(hostile);
  await expect(page.locator("#document-blockers")).toContainText(hostile);
  await expect(page.locator("#document-list img, #document-exceptions img, #document-blockers img")).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.documentCenterCompromised)).toBeUndefined();
});

test("clinical AI CDSS center renders hostile governance text as inert content", async ({ page }) => {
  const hostile = '<img src=x onerror="globalThis.cdssCenterCompromised=true">';
  await loginCommission(page);
  await page.route("**/api/quality-safety/ai-cdss/center", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      schemaVersion: "clinical-ai-cdss-governance-center-v1",
      sourceRequirement: "J-CLIN-CDSS",
      upstreamGovernanceRequirement: { id: "L-GOV-AI", status: "declared-only", note: hostile },
      productionReady: false,
      decision: "NO-GO",
      scope: { role: "commission", organizationCode: "cross-organization", clinicalDetailVisible: false },
      summary: { rules: 1, restrictedRules: 1, suggestions: 1, evidenceBound: 1, pendingHumanReview: 1, reviewed: 0, reviewReceipts: 0, openGovernanceSignals: 1, integrationContracts: 1 },
      ruleCards: [{ id: hostile, name: hostile, categoryLabel: hostile, algorithmClass: hostile, sourceSystem: hostile, version: hostile, lifecycleStatus: "restricted-pilot", configurationStatus: "active", riskLevel: "high", intendedUse: hostile, recommendedReview: hostile, humanReviewRequired: true, governanceFindings: [hostile] }],
      suggestions: [{ id: hostile, ruleId: hostile, title: hostile, categoryLabel: hostile, riskLevel: "high", institutionReference: hostile, residentReference: "", practitionerReference: "", evidenceBound: true, evidenceReference: "", reviewStatus: "pending-human-review", doctorActionLabel: hostile }],
      reviewLedger: [],
      monitoring: { humanReviewCoverage: 0, signals: [{ id: hostile, type: "model-governance-gap", severity: "high", subjectReference: hostile, detail: hostile }] },
      integrationContracts: [{ id: hostile, name: hostile, endpoint: hostile, surface: hostile, repositoryStatus: "mvp-ready", productionStatus: "external-evidence-required", blocker: hostile }],
      safetyBoundaries: [hostile],
      blockers: [hostile]
    })
  }));
  await page.goto("/clinical-ai-cdss.html");
  await expect(page.locator("#clinical-ai-rules")).toContainText(hostile);
  await expect(page.locator("#clinical-ai-signals")).toContainText(hostile);
  await expect(page.locator("#clinical-ai-blockers")).toContainText(hostile);
  await expect(page.locator("#clinical-ai-rules img, #clinical-ai-signals img, #clinical-ai-blockers img")).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.cdssCenterCompromised)).toBeUndefined();
});

test("account lifecycle remains commission-manager only", async ({ page }) => {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("hospital");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/institution\.html$/);
  await page.goto("/account-lifecycle.html");
  await expect(page).toHaveURL(/institution\.html\?denied=account-lifecycle\.html$/);
});
