const test = require("node:test");
const assert = require("node:assert/strict");
const { generateSyntheticDicom } = require("../synthetic-dicom");
test("synthetic DICOM contains Part 10 preamble and 128x128 pixel payload", () => {
  const dicom = generateSyntheticDicom({ stamp: "test" });
  assert.equal(dicom.buffer.subarray(128, 132).toString("ascii"), "DICM");
  assert.equal(dicom.rows, 128); assert.equal(dicom.columns, 128);
  assert.ok(dicom.buffer.length > 128 * 128 * 2);
  assert.match(dicom.studyInstanceUID, /^2\.25\./);
});
