"use strict";

const { once } = require("node:events");
const http = require("node:http");

async function startAlertDeliveryMock() {
  const requests = [];
  let failDelivery = false;
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    const body = JSON.parse(bodyText);
    requests.push({ headers: request.headers, bodyText, body });
    response.writeHead(failDelivery ? 503 : 200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(failDelivery
      ? { message: "receiver temporarily unavailable" }
      : { eventId: `siem-event-${requests.length}`, status: "accepted" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  process.env.SIEM_ENDPOINT = `http://127.0.0.1:${port}/events`;
  process.env.SIEM_SIGNING_SECRET = "api-test-siem-signing-secret";
  process.env.ALERTING_MAX_ATTEMPTS = "1";

  function setDeliveryFailure(value) {
    failDelivery = value;
  }

  async function stop() {
    delete process.env.SIEM_ENDPOINT;
    delete process.env.SIEM_SIGNING_SECRET;
    delete process.env.ALERTING_MAX_ATTEMPTS;
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }

  return { port, requests, setDeliveryFailure, stop };
}

module.exports = {
  startAlertDeliveryMock
};
