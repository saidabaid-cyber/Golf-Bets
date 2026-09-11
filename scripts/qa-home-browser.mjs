// Hydrated, read-only browser QA for the public Preview or a local server.
// Uses an isolated temporary Chrome profile and a synthetic guest workspace.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const origin = new URL(process.argv[2] || "http://127.0.0.1:3000").origin;
const outputDirectory = path.resolve(process.argv[3] || path.join(process.cwd(), ".qa-artifacts"));
const widths = [390, 430];
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter(Boolean);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", resolve).once("error", reject));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitForJson(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return response.json();
    } catch {
      // Chrome is still starting.
    }
    await delay(125);
  }
  throw new Error("Chrome DevTools did not become ready.");
}

class CdpClient {
  constructor(url) {
    this.socket = new WebSocket(url);
    this.nextId = 1;
    this.pending = new Map();
    this.events = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if (message.error) pending.reject(new Error(message.error.message));
        else pending.resolve(message.result);
        return;
      }
      const listeners = this.events.get(`${message.sessionId || "browser"}:${message.method}`) || [];
      for (const listener of listeners) listener(message.params || {});
    });
  }

  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  once(method, sessionId, timeout = 20_000) {
    const key = `${sessionId || "browser"}:${method}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const listener = (params) => {
        clearTimeout(timer);
        this.events.set(key, (this.events.get(key) || []).filter((candidate) => candidate !== listener));
        resolve(params);
      };
      this.events.set(key, [...(this.events.get(key) || []), listener]);
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, sessionId, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, sessionId);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed.");
  return result.result?.value;
}

async function waitFor(client, sessionId, expression, label) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (await evaluate(client, sessionId, expression)) return;
    await delay(100);
  }
  const state = await evaluate(client, sessionId, `({ url: location.href, readyState: document.readyState, text: document.body?.innerText?.slice(0, 500) })`);
  throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}.`);
}

async function clickText(client, sessionId, text) {
  const clicked = await evaluate(client, sessionId, `(() => {
    const target = [...document.querySelectorAll("button, a")].find((element) => element.textContent?.trim() === ${JSON.stringify(text)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing action: ${text}`);
}

async function screenshot(client, sessionId, destination) {
  const result = await client.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
    fromSurface: true,
  }, sessionId);
  await writeFile(destination, Buffer.from(result.data, "base64"));
}

async function qaViewport(client, width) {
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Log.enable", {}, sessionId);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: 844,
  }, sessionId);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
  const errors = [];
  const exceptionKey = `${sessionId}:Runtime.exceptionThrown`;
  client.events.set(exceptionKey, [(event) => errors.push(event.exceptionDetails?.text || "runtime exception")]);
  const logKey = `${sessionId}:Log.entryAdded`;
  client.events.set(logKey, [(event) => {
    if (["error", "warning"].includes(event.entry?.level)) errors.push(`${event.entry.level}: ${event.entry.text}`);
  }]);

  const loaded = client.once("Page.loadEventFired", sessionId);
  await client.send("Page.navigate", { url: origin }, sessionId);
  await loaded;
  await waitFor(client, sessionId, "document.readyState === 'complete' && (document.body?.innerText.includes('Continuar como invitado') || Boolean(document.querySelector('[data-home-version=\"calm-v1\"]'))) ", "hydrated access or Home screen");
  const alreadyHome = await evaluate(client, sessionId, "Boolean(document.querySelector('[data-home-version=\"calm-v1\"]'))");
  if (!alreadyHome) {
    await clickText(client, sessionId, "Continuar como invitado");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Antes de la primera controversia')", "guest consent screen");
    const requiredChecked = await evaluate(client, sessionId, `(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"]')];
      for (const box of boxes.slice(0, 4)) if (!box.checked) box.click();
      return boxes.slice(0, 4).every((box) => box.checked);
    })()`);
    assert.equal(requiredChecked, true, "Required local QA consents could not be selected.");
    await clickText(client, sessionId, "Continuar");
  }
  await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"calm-v1\"]') !== null", "guest Home dashboard");
  await delay(500);

  const metrics = await evaluate(client, sessionId, `(() => ({
    innerWidth: window.innerWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    homeDashboard: Boolean(document.querySelector('[data-home-version="calm-v1"]')),
    headings: [...document.querySelectorAll('h1,h2')].map((node) => node.textContent?.trim()).filter(Boolean),
    primaryLabels: [...document.querySelectorAll('button,a')].map((node) => node.textContent?.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
  }))()`);
  assert.equal(metrics.innerWidth, width, `Viewport override failed at ${width}px.`);
  assert.equal(metrics.horizontalOverflow, false, `Horizontal overflow found at ${width}px.`);
  assert.equal(metrics.homeDashboard, true, `Home dashboard marker missing at ${width}px.`);
  assert.deepEqual(errors, [], `Browser console errors at ${width}px: ${errors.join(" | ")}`);

  const destination = path.join(outputDirectory, `home-preview-${width}.png`);
  await screenshot(client, sessionId, destination);
  await client.send("Target.closeTarget", { targetId });
  return { width, screenshot: destination, metrics, consoleErrors: errors };
}

await mkdir(outputDirectory, { recursive: true });
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "backyard-home-qa-"));
const port = await unusedPort();
let chrome;
try {
  const chromePath = chromeCandidates[0];
  assert.ok(chromePath, "Set CHROME_PATH to a Chrome executable.");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const client = new CdpClient(version.webSocketDebuggerUrl);
  const results = [];
  for (const width of widths) results.push(await qaViewport(client, width));
  client.close();
  console.log(JSON.stringify({ origin, status: "PASS", results }, null, 2));
} finally {
  if (chrome?.exitCode === null) {
    chrome.kill();
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
