"use strict";

const { once } = require("node:events");
const http = require("node:http");

async function startHospitalAdapterMock() {
  const requests = [];
  const server = http.createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const bodyText = Buffer.concat(chunks).toString("utf8");
    requests.push({ headers: request.headers, bodyText, body: JSON.parse(bodyText) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ receiptId: `his-provider-${requests.length}`, status: "accepted" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = server.address().port;
  process.env.HIS_ADAPTER_URL = `http://127.0.0.1:${port}/his/events`;
  process.env.HIS_ADAPTER_SECRET = "api-test-his-adapter-secret";
  process.env.HOSPITAL_ADAPTER_MAX_ATTEMPTS = "1";

  async function stop() {
    delete process.env.HIS_ADAPTER_URL;
    delete process.env.HIS_ADAPTER_SECRET;
    delete process.env.HOSPITAL_ADAPTER_MAX_ATTEMPTS;
    await new Promise((resolve) => server.close(resolve));
  }

  return { port, requests, stop };
}

module.exports = {
  startHospitalAdapterMock
};
