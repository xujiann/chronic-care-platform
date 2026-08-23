"use strict";

const { once } = require("node:events");
const http = require("node:http");

async function startFinancialGatewayMock() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(bodyText);
    requests.push({ headers: request.headers, bodyText, body });
    response.writeHead(200, { "Content-Type": "application/json" });
    const receiptId = body.type === "PAYMENT"
      ? `payment-provider-${requests.length}`
      : body.type === "INSURANCE"
        ? `insurance-provider-${requests.length}`
        : `certificate-provider-${requests.length}`;
    response.end(JSON.stringify({ receiptId, status: "accepted" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  process.env.PAYMENT_GATEWAY_URL = `http://127.0.0.1:${port}/payment`;
  process.env.INSURANCE_GATEWAY_URL = `http://127.0.0.1:${port}/insurance`;
  process.env.CERTIFICATE_GATEWAY_URL = `http://127.0.0.1:${port}/certificate`;
  process.env.FINANCIAL_GATEWAY_SECRET = "api-test-financial-gateway-secret";
  process.env.FINANCIAL_CALLBACK_SECRET = "api-test-financial-callback-secret";
  process.env.FINANCIAL_GATEWAY_MAX_ATTEMPTS = "1";

  async function stop() {
    delete process.env.PAYMENT_GATEWAY_URL;
    delete process.env.INSURANCE_GATEWAY_URL;
    delete process.env.CERTIFICATE_GATEWAY_URL;
    delete process.env.FINANCIAL_GATEWAY_SECRET;
    delete process.env.FINANCIAL_CALLBACK_SECRET;
    delete process.env.FINANCIAL_GATEWAY_MAX_ATTEMPTS;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  return { port, requests, stop };
}

module.exports = {
  startFinancialGatewayMock
};
