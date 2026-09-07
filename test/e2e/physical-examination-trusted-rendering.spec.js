const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-physical-exam-text-xss src="x" onerror="window.__physicalExamXss=true">';
const HOSTILE_CLASS = '"><img data-physical-exam-class-xss src="x" onerror="window.__physicalExamXss=true">';

async function loginCommission(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("health");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/index\.html$/);
}

test("physical examination workbench keeps hostile API fields inert across all legacy render regions", async ({ page }) => {
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
  await loginCommission(page);

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
