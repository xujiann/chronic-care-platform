"use strict";

function createImagingStudyShare(data, user, study, studyId, payload, ports) {
  const { appendDataAccessLog, randomUUID } = ports;
  const days = Math.min(Math.max(Number(payload.validDays || 7), 1), 90);
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const share = {
    id: `ics-share-${randomUUID()}`,
    studyId,
    residentId: study.residentId,
    token: `IMG-${randomUUID().slice(0, 8).toUpperCase()}`,
    channel: String(payload.channel || "二维码/短信链接").trim(),
    expiresAt,
    scope: String(payload.scope || "影像报告 + 浏览级序列").trim(),
    createdBy: user.username || user.role,
    createdAt: new Date().toISOString(),
    status: "active"
  };
  data.imageCloudShares = [share, ...(Array.isArray(data.imageCloudShares) ? data.imageCloudShares : [])].slice(0, 300);
  appendDataAccessLog(data, user, study.residentId, "医学影像云", `分享影像 ${study.accessionNumber} 至 ${share.channel}`);
  return share;
}

module.exports = { createImagingStudyShare };
