"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");

const { collectJson } = require("../server");

class ControlledRequest extends EventEmitter {
  constructor() {
    super();
    this.destroyed = false;
    this.destroyCalls = 0;
  }

  destroy() {
    this.destroyed = true;
    this.destroyCalls += 1;
    this.emit("aborted");
    this.emit("error", new Error("socket closed after request body limit"));
    this.emit("end");
  }
}

test("collectJson decodes UTF-8 once after a multibyte character is split across chunks", async () => {
  const request = new ControlledRequest();
  const expected = { name: "区域诊疗数据共享平台", purpose: "跨机构调阅" };
  const encoded = Buffer.from(JSON.stringify(expected), "utf8");
  const markerOffset = encoded.indexOf(Buffer.from("区", "utf8"));
  assert.notEqual(markerOffset, -1);

  const parsed = collectJson(request);
  request.emit("data", encoded.subarray(0, markerOffset + 1));
  request.emit("data", encoded.subarray(markerOffset + 1));
  request.emit("end");

  assert.deepEqual(await parsed, expected);
  assert.equal(JSON.stringify(await parsed).includes("�"), false);
});

test("collectJson enforces maxLength in bytes and settles once after destroying an oversized request", async () => {
  const request = new ControlledRequest();
  const encoded = Buffer.from(JSON.stringify({ name: "区域" }), "utf8");
  const parsed = collectJson(request, encoded.length - 1);

  request.emit("data", encoded);

  await assert.rejects(parsed, { message: "请求体过大" });
  assert.equal(request.destroyCalls, 1);
  assert.equal(request.destroyed, true);
});
