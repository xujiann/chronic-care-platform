"use strict";

const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const serverEntry = path.join(root, "test", "e2e", "resident-mini-program-test-server.js");
const playwrightEntry = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const playwrightConfig = path.join(root, "test", "e2e", "resident-mini-program.playwright.config.js");
const host = "127.0.0.1";
const port = 5210;

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function healthRequest() {
  return new Promise((resolve) => {
    const request = http.get({ host, port, path: "/api/health", timeout: 500 }, (response) => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on("timeout", () => {
      request.destroy();
      resolve(false);
    });
    request.on("error", () => resolve(false));
  });
}

async function waitForHealth(expected, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    if ((await healthRequest()) === expected) return true;
    await delay(100);
  } while (Date.now() < deadline);
  return false;
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("居民端测试子进程未在规定时间内退出"));
    }, timeoutMs);
    const onExit = (code, signal) => {
      cleanup();
      resolve({ code, signal });
    };
    const cleanup = () => {
      clearTimeout(timer);
      child.off("exit", onExit);
    };
    child.once("exit", onExit);
  });
}

function runPlaywright() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      playwrightEntry,
      "test",
      "--config",
      playwrightConfig
    ], {
      cwd: root,
      shell: false,
      stdio: "inherit",
      windowsHide: true
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
}

async function stopOwnedServer(server) {
  if (server.exitCode === null && server.connected) server.send({ type: "shutdown" });
  let result;
  try {
    result = await waitForExit(server, 5000);
  } catch (error) {
    if (server.exitCode === null) server.kill();
    await waitForExit(server, 3000).catch(() => {});
    throw error;
  }
  if (result.code !== 0) throw new Error(`居民端测试服务异常退出：${result.code ?? result.signal}`);
  if (!(await waitForHealth(false, 3000))) throw new Error("居民端测试服务退出后端口仍被占用");
}

async function main() {
  const server = spawn(process.execPath, [serverEntry], {
    cwd: root,
    shell: false,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
    windowsHide: true
  });
  let playwrightResult;
  try {
    server.once("error", (error) => {
      process.stderr.write(`居民端测试服务启动失败：${error.message}\n`);
    });
    if (!(await waitForHealth(true, 10_000))) throw new Error("居民端测试服务未能启动");
    playwrightResult = await runPlaywright();
  } finally {
    await stopOwnedServer(server);
  }
  if (playwrightResult.code !== 0) {
    throw new Error(`居民端移动端测试失败：${playwrightResult.code ?? playwrightResult.signal}`);
  }
  process.stdout.write("居民端移动端测试已完成，测试服务进程已退出且端口已释放。\n");
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
