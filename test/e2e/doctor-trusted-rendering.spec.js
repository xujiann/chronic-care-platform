const { expect, test } = require("@playwright/test");

const HOSTILE_TEXT = '<img data-doctor-xss src="x" onerror="window.__doctorXss=true">';

async function loginAsDoctor(page) {
  await page.goto("/login.html");
  await page.locator("#login-user").selectOption("doctor");
  await page.locator("input[name='password']").fill("123456");
  await page.locator("#login-form button[type='submit']").click();
  await expect(page).toHaveURL(/doctor\.html$/);
}

test("doctor workbench keeps hostile API fields as inert text and dataset values", async ({ page }) => {
  await page.addInitScript(() => {
    window.__doctorXss = false;
  });

  await page.route("**/api/doctors/me", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        doctor: {
          id: "doc-hostile",
          name: HOSTILE_TEXT,
          title: HOSTILE_TEXT,
          specialty: HOSTILE_TEXT,
          primaryInstitution: HOSTILE_TEXT,
          department: HOSTILE_TEXT,
          licenseNo: HOSTILE_TEXT,
          practiceScope: HOSTILE_TEXT,
          accountStatus: HOSTILE_TEXT,
          electronicRegistrationVerification: {
            registryId: HOSTILE_TEXT,
            verificationStatus: HOSTILE_TEXT,
            signatureNo: HOSTILE_TEXT
          }
        },
        multiPracticeApplications: [{
          id: "application-hostile",
          targetInstitution: HOSTILE_TEXT,
          targetDepartment: HOSTILE_TEXT,
          period: HOSTILE_TEXT,
          schedule: HOSTILE_TEXT,
          practiceScope: HOSTILE_TEXT,
          status: HOSTILE_TEXT,
          riskFlags: [HOSTILE_TEXT],
          primaryPracticeConfirmation: { status: HOSTILE_TEXT, signatureNo: HOSTILE_TEXT },
          externalSync: {
            electronicRegistration: { status: HOSTILE_TEXT },
            eSignature: { status: HOSTILE_TEXT },
            hisHr: { status: HOSTILE_TEXT }
          }
        }],
        multiPracticeMessages: [{
          sourceId: "application-hostile",
          title: HOSTILE_TEXT,
          body: HOSTILE_TEXT
        }],
        policy: {
          qualificationRules: [HOSTILE_TEXT],
          agreementFields: [HOSTILE_TEXT]
        }
      })
    });
  });

  await page.route("**/api/public/multi-practice-ledger", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        publicLedger: [{
          doctorId: "doc-hostile",
          doctorName: HOSTILE_TEXT,
          primaryInstitution: HOSTILE_TEXT,
          targetInstitution: HOSTILE_TEXT,
          practiceScope: HOSTILE_TEXT,
          status: HOSTILE_TEXT
        }]
      })
    });
  });

  await page.route("**/api/phase2/clinical-assist", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        alerts: [{
          id: HOSTILE_TEXT,
          alertTitle: HOSTILE_TEXT,
          residentName: HOSTILE_TEXT,
          alertDetail: HOSTILE_TEXT,
          recommendation: HOSTILE_TEXT,
          pluginSurface: HOSTILE_TEXT,
          messageReceiptStatus: "pending",
          lastAction: HOSTILE_TEXT,
          status: HOSTILE_TEXT,
          severity: HOSTILE_TEXT
        }]
      })
    });
  });

  await loginAsDoctor(page);

  for (const selector of [
    "#doctor-metrics",
    "#doctor-clinical-assist",
    "#doctor-profile",
    "#doctor-policy",
    "#doctor-applications",
    "#doctor-public-ledger"
  ]) {
    await expect(page.locator(selector)).toContainText(HOSTILE_TEXT);
  }

  const receiptButton = page.locator("[data-clinical-assist-receipt]").first();
  await expect(receiptButton).toBeVisible();
  await expect(receiptButton).toHaveAttribute("data-clinical-assist-receipt", HOSTILE_TEXT);
  await expect(page.locator("[data-doctor-xss]")).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__doctorXss)).toBe(false);
});
