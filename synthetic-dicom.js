const { createHash } = require("node:crypto");

const LONG_VR = new Set(["OB", "OD", "OF", "OL", "OV", "OW", "SQ", "UC", "UR", "UT", "UN"]);
function uid(seed) {
  const digits = BigInt(`0x${createHash("sha256").update(String(seed)).digest("hex").slice(0, 30)}`).toString();
  return `2.25.${digits}`.slice(0, 64);
}
function textBytes(value, vr) {
  let buffer = Buffer.from(String(value), "ascii");
  if (buffer.length % 2) buffer = Buffer.concat([buffer, Buffer.from([vr === "UI" ? 0 : 32])]);
  return buffer;
}
function us(value) { const b = Buffer.alloc(2); b.writeUInt16LE(value); return b; }
function ul(value) { const b = Buffer.alloc(4); b.writeUInt32LE(value); return b; }
function element(group, elementId, vr, value) {
  const data = Buffer.isBuffer(value) ? value : textBytes(value, vr);
  const header = Buffer.alloc(LONG_VR.has(vr) ? 12 : 8);
  header.writeUInt16LE(group, 0); header.writeUInt16LE(elementId, 2); header.write(vr, 4, 2, "ascii");
  if (LONG_VR.has(vr)) header.writeUInt32LE(data.length, 8); else header.writeUInt16LE(data.length, 6);
  return Buffer.concat([header, data]);
}
function pixelData(rows, columns) {
  const b = Buffer.alloc(rows * columns * 2);
  for (let y = 0; y < rows; y += 1) for (let x = 0; x < columns; x += 1) {
    const dx = x - columns / 2, dy = y - rows / 2;
    const ring = Math.abs(Math.sqrt(dx * dx + dy * dy) - 34) < 4 ? 3000 : 0;
    const cross = Math.abs(dx) < 3 || Math.abs(dy) < 3 ? 2100 : 0;
    const gradient = Math.round((x / (columns - 1)) * 900);
    b.writeUInt16LE(Math.min(4095, 250 + gradient + ring + cross), (y * columns + x) * 2);
  }
  return b;
}
function generateSyntheticDicom(options = {}) {
  const stamp = String(options.stamp || Date.now());
  const sopClass = "1.2.840.10008.5.1.4.1.1.7";
  const sopInstance = uid(`sop-${stamp}`), study = uid(`study-${stamp}`), series = uid(`series-${stamp}`);
  const metaBody = Buffer.concat([
    element(0x0002, 0x0001, "OB", Buffer.from([0, 1])), element(0x0002, 0x0002, "UI", sopClass),
    element(0x0002, 0x0003, "UI", sopInstance), element(0x0002, 0x0010, "UI", "1.2.840.10008.1.2.1"),
    element(0x0002, 0x0012, "UI", "2.25.999999999999999999")
  ]);
  const rows = 128, columns = 128;
  const dataset = Buffer.concat([
    element(0x0008, 0x0016, "UI", sopClass), element(0x0008, 0x0018, "UI", sopInstance), element(0x0008, 0x0020, "DA", "20260713"),
    element(0x0008, 0x0030, "TM", "120000"), element(0x0008, 0x0060, "CS", "OT"), element(0x0008, 0x1030, "LO", "Solution A Pixel Preview"),
    element(0x0010, 0x0010, "PN", "SOLUTION^A^SYNTHETIC"), element(0x0010, 0x0020, "LO", "SYNTHETIC-SOLUTION-A-PIXEL"),
    element(0x0020, 0x000D, "UI", study), element(0x0020, 0x000E, "UI", series), element(0x0020, 0x0011, "IS", "1"), element(0x0020, 0x0013, "IS", "1"),
    element(0x0028, 0x0002, "US", us(1)), element(0x0028, 0x0004, "CS", "MONOCHROME2"), element(0x0028, 0x0010, "US", us(rows)), element(0x0028, 0x0011, "US", us(columns)),
    element(0x0028, 0x0100, "US", us(16)), element(0x0028, 0x0101, "US", us(12)), element(0x0028, 0x0102, "US", us(11)), element(0x0028, 0x0103, "US", us(0)),
    element(0x0028, 0x1050, "DS", "2048"), element(0x0028, 0x1051, "DS", "4096"), element(0x7FE0, 0x0010, "OW", pixelData(rows, columns))
  ]);
  return { buffer: Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), element(0x0002, 0x0000, "UL", ul(metaBody.length)), metaBody, dataset]), studyInstanceUID: study, seriesInstanceUID: series, sopInstanceUID: sopInstance, rows, columns };
}
module.exports = { generateSyntheticDicom };
