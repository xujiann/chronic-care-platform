"use strict";

const { once } = require("node:events");
const http = require("node:http");

const { signGatewayResponse } = require("../../secure-object-storage");

const RECEIPT_SECRET = "api-test-object-storage-receipt-secret-v1";

async function startObjectStorageGatewayMock() {
  const requests = [];
  let scanStatus = "clean";

  function sendStorageResponse(response, requestBody, fields) {
    const responseBody = {
      schemaVersion: "object-storage-gateway-response-v1",
      requestId: requestBody.requestId,
      operation: requestBody.operation,
      bucket: requestBody.bucket,
      attachmentId: requestBody.attachmentId,
      objectKey: requestBody.objectKey,
      ...fields
    };
    const responseText = JSON.stringify(responseBody);
    const timestamp = new Date().toISOString();
    response.writeHead(200, {
      "Content-Type": "application/json",
      "X-Object-Storage-Contract": "object-storage-gateway-trust-v1",
      "X-Request-Id": requestBody.requestId,
      "X-Timestamp": timestamp,
      "X-Signature-Algorithm": "HMAC-SHA256",
      "X-Signature": signGatewayResponse(responseText, RECEIPT_SECRET, {
        operation: requestBody.operation,
        status: 200,
        timestamp,
        requestId: requestBody.requestId
      })
    });
    response.end(responseText);
  }

  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(bodyText);
    requests.push({ path: request.url, headers: request.headers, body });
    if (request.url === "/storage/upload-intents") {
      sendStorageResponse(response, body, {
        uploadId: `upload-${body.attachmentId}`,
        uploadUrl: `http://127.0.0.1:${server.address().port}/direct-upload/${body.attachmentId}`,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
      });
      return;
    }
    if (request.url === "/storage/objects/complete") {
      sendStorageResponse(response, body, {
        uploadId: body.uploadId,
        sizeBytes: body.expectedSizeBytes,
        checksumSha256: body.expectedChecksumSha256,
        scanStatus,
        scannedAt: new Date().toISOString(),
        scanReceiptId: `scan-receipt-${body.attachmentId}`,
        objectVersion: `version-${body.attachmentId}`
      });
      return;
    }
    if (request.url === "/storage/download-intents") {
      sendStorageResponse(response, body, {
        objectVersion: body.objectVersion,
        downloadUrl: `http://127.0.0.1:${server.address().port}/short-download/${body.attachmentId}`,
        expiresAt: new Date(Date.now() + 4 * 60 * 1000).toISOString()
      });
      return;
    }
    sendStorageResponse(response, body, {
      objectVersion: body.objectVersion,
      action: body.action,
      accepted: true,
      status: "applied",
      receiptId: `lifecycle-receipt-${body.attachmentId}`,
      effectiveAt: new Date().toISOString()
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  process.env.OBJECT_STORAGE_GATEWAY_URL = `http://127.0.0.1:${port}/storage/`;
  process.env.OBJECT_STORAGE_BUCKET = "api-test-attachments";
  process.env.OBJECT_STORAGE_SIGNING_SECRET = "api-test-object-storage-signing-secret";
  process.env.OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION = "object-storage-gateway-trust-v1";
  process.env.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET = RECEIPT_SECRET;
  process.env.OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS = `http://127.0.0.1:${port}`;
  process.env.OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS = `http://127.0.0.1:${port}`;
  process.env.OBJECT_STORAGE_TOKEN = "api-test-object-storage-token";

  function setScanStatus(value) {
    scanStatus = value;
  }

  async function stop() {
    delete process.env.OBJECT_STORAGE_GATEWAY_URL;
    delete process.env.OBJECT_STORAGE_BUCKET;
    delete process.env.OBJECT_STORAGE_SIGNING_SECRET;
    delete process.env.OBJECT_STORAGE_GATEWAY_CONTRACT_VERSION;
    delete process.env.OBJECT_STORAGE_RECEIPT_SIGNING_SECRET;
    delete process.env.OBJECT_STORAGE_UPLOAD_URL_ALLOWED_ORIGINS;
    delete process.env.OBJECT_STORAGE_DOWNLOAD_URL_ALLOWED_ORIGINS;
    delete process.env.OBJECT_STORAGE_TOKEN;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  return { port, requests, setScanStatus, stop };
}

module.exports = {
  startObjectStorageGatewayMock
};
