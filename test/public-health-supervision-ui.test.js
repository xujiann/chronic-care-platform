"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const html = fs.readFileSync("public-health-supervision.html", "utf8");
const source = fs.readFileSync("public-health-supervision.js", "utf8");

test("health supervision page is manager-scoped and exposes the approved workflow controls", () => {
  assert.match(html, /data-roles="commission,institution"/);
  assert.match(html, /data-account-types="manager"/);
  for (const id of [
    "supervision-subject-form",
    "supervision-task-form",
    "supervision-action-form",
    "supervision-inspection-form",
    "supervision-tasks",
    "supervision-findings"
  ]) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /生产保持 NO-GO/);
});

test("health supervision UI uses the shared API client and trusted text DOM only", () => {
  assert.match(source, /HealthPlatformApi\.createClient/);
  assert.match(source, /replaceChildren/);
  assert.match(source, /textContent/);
  assert.doesNotMatch(source, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(source, /data\/db\.json|medicalResources|localStorage/);
  assert.match(source, /医疗机构（\$\{subject\.organizationCode\}）/);
  assert.doesNotMatch(source, /subject\.name|institutionName|patient|resident/i);
});

test("page declares empty, error and production boundary states", () => {
  assert.match(source, /暂无检查任务/);
  assert.match(source, /工作台加载失败/);
  assert.match(source, /案件、GIS、视频、附件上传和外部交换未包含/);
  assert.match(source, /productionReady === false/);
});
