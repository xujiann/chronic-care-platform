#!/usr/bin/env node
"use strict";

const path = require("node:path");
const { assessAuditDeliveryConfig } = require("../src/platform/operations/audit-delivery");

const report = assessAuditDeliveryConfig(process.env, {
  root: path.resolve(__dirname, ".."),
  checkFilesystem: true,
  checkProcessIdentity: true,
  sourceContinuityImplemented: process.env.AUDIT_DELIVERY_SOURCE_CONTRACT === "append-only-audit-source-v2"
});
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ready) process.exitCode = 1;
