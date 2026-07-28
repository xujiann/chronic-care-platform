const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SPECIALTY_PLAN_CATALOG,
  buildSpecialtyPlanReview,
  renderSpecialtyPlanReviewMarkdown
} = require("../t10-specialty-plan-review");
const {
  writeSpecialtyPlanReview,
  verifySpecialtyPlanReview,
  parseArgs
} = require("../scripts/t10-specialty-plan-review");

const TRACKS = Object.keys(SPECIALTY_PLAN_CATALOG).map((id) => ({
  id,
  codeReady: true,
  productionReady: false,
  formalState: "blocked-until-site-evidence-signed",
  blockers: [{ id: `${id}-site` }]
}));

test("all four specialty plans have complete code evidence and classified remaining actions", () => {
  const review = buildSpecialtyPlanReview({ tracks: TRACKS, generatedAt: "2026-07-28T00:00:00.000Z" });
  assert.equal(review.ok, true);
  assert.equal(review.status, "all-planned-code-capabilities-reviewed");
  assert.equal(review.summary.tracks, 4);
  assert.equal(review.summary.plannedCapabilities, 32);
  assert.equal(review.summary.implementedCapabilities, 32);
  assert.equal(review.summary.missingCapabilities, 0);
  assert.equal(review.summary.externalActions, 12);
  assert.equal(review.summary.p0ExternalActions, 8);
  assert.equal(review.summary.coveragePercent, 100);
  assert.equal(review.trackReviews.every((item) => item.productionReady === false), true);
  assert.match(review.integrity.digest, /^sha256:[a-f0-9]{64}$/);
});

test("a single specialty review excludes peer specialty plans", () => {
  const review = buildSpecialtyPlanReview({
    selectedTrackIds: ["regional-imaging-cloud"],
    tracks: TRACKS
  });
  assert.equal(review.summary.tracks, 1);
  assert.equal(review.summary.plannedCapabilities, 8);
  assert.deepEqual(review.trackReviews.map((item) => item.trackId), ["regional-imaging-cloud"]);
  assert.equal(review.externalActions.every((item) => item.trackId === "regional-imaging-cloud"), true);
});

test("missing source or test evidence fails closed", () => {
  const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "t10-plan-missing-"));
  const review = buildSpecialtyPlanReview({
    rootDir: isolatedRoot,
    selectedTrackIds: ["emergency-life-chain"],
    catalog: SPECIALTY_PLAN_CATALOG
  });
  fs.rmSync(isolatedRoot, { recursive: true, force: true });
  assert.equal(review.ok, false);
  assert.equal(review.status, "specialty-plan-gaps-found");
  assert.equal(review.summary.missingCapabilities, 8);
  assert.equal(review.checks.find((item) => item.id === "implementation-evidence-complete").passed, false);
});

test("plan review markdown separates code coverage from external site actions", () => {
  const markdown = renderSpecialtyPlanReviewMarkdown(buildSpecialtyPlanReview({ tracks: TRACKS }));
  assert.match(markdown, /32\/32 \(100%\)/);
  assert.match(markdown, /Remaining external actions/);
  assert.match(markdown, /diagnostic-viewer-performance/);
  assert.match(markdown, /生产关系数据库/);
});

test("plan review artifacts are digest indexed and tamper evident", (t) => {
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "t10-plan-artifacts-"));
  t.after(() => fs.rmSync(outputDir, { recursive: true, force: true }));
  const review = buildSpecialtyPlanReview({ tracks: TRACKS });
  writeSpecialtyPlanReview(review, { outputDir });
  const verified = verifySpecialtyPlanReview(outputDir);
  assert.equal(verified.ok, true);
  assert.equal(verified.summary.total, 6);
  assert.ok(fs.existsSync(path.join(outputDir, "external-action-board.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "external-action-command-template.json")));
  assert.ok(fs.existsSync(path.join(outputDir, "external-action-audit-export.json")));
  fs.appendFileSync(path.join(outputDir, "specialty-plan-review.md"), "\ntampered\n", "utf8");
  assert.equal(verifySpecialtyPlanReview(outputDir).ok, false);
});

test("plan review CLI parser accepts track and output selection", () => {
  const parsed = parseArgs([
    "--tracks=emergency-life-chain,clinical-blood",
    "--output=release/custom-plan-review"
  ]);
  assert.deepEqual(parsed.selectedTrackIds, ["emergency-life-chain", "clinical-blood"]);
  assert.equal(parsed.outputDir, "release/custom-plan-review");
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});
