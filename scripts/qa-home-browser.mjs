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
const scenario = process.argv[4] || "all";
const widths = [390, 430];
const approvedHomeViewports = [
  { width: 390, height: 844 },
  { width: 393, height: 852 },
  { width: 402, height: 874 },
  { width: 430, height: 932 },
];
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
    this.socket.addEventListener("close", () => {
      for (const pending of this.pending.values()) pending.reject(new Error("Chrome DevTools connection closed."));
      this.pending.clear();
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
  const state = await evaluate(client, sessionId, `(() => { const text = document.body?.innerText || ''; return {
    url: location.href,
    readyState: document.readyState,
    text: text.slice(0, 900),
    textTail: text.slice(-900),
    dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map((node) => node.textContent?.slice(0, 300)),
    equipmentStorage: Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))]).filter(([key]) => key?.includes('equipment-profile')).map(([key, value]) => [key, value?.slice(0, 500)]),
  }; })()`);
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

async function clickContaining(client, sessionId, text, selector = "button, a") {
  const clicked = await evaluate(client, sessionId, `(() => {
    const normalize = (value) => value?.replace(/\\s+/g, ' ').trim() || '';
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})].find((element) => normalize(element.textContent).includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing action containing: ${text}`);
}

async function clickAriaLabel(client, sessionId, label) {
  const clicked = await evaluate(client, sessionId, `(() => {
    const target = [...document.querySelectorAll('[aria-label]')].find((element) => element.getAttribute('aria-label') === ${JSON.stringify(label)});
    if (!target) return false;
    target.click();
    return true;
  })()`);
  assert.equal(clicked, true, `Missing aria-label action: ${label}`);
}

async function fillLabel(client, sessionId, label, value) {
  const filled = await evaluate(client, sessionId, `(() => {
    const normalize = (value) => value?.replace(/\\s+/g, ' ').trim() || '';
    const direct = [...document.querySelectorAll('input,textarea')].find((element) => element.getAttribute('aria-label') === ${JSON.stringify(label)});
    const labelled = [...document.querySelectorAll('label')].find((element) => normalize(element.textContent) === ${JSON.stringify(label)} || normalize(element.textContent).startsWith(${JSON.stringify(label)}));
    const linked = labelled?.htmlFor ? document.getElementById(labelled.htmlFor) : null;
    const target = direct || linked || labelled?.querySelector('input,textarea');
    if (!target) return false;
    const prototype = target instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(target, ${JSON.stringify(value)});
    target.dispatchEvent(new Event('input', { bubbles: true }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
    target.focus();
    return true;
  })()`);
  assert.equal(filled, true, `Missing input labelled: ${label}`);
}

async function scrollTextIntoView(client, sessionId, text) {
  const scrolled = await evaluate(client, sessionId, `(() => {
    const normalize = (value) => value?.replace(/\\s+/g, ' ').trim() || '';
    const target = [...document.querySelectorAll('h1,h2,h3,button,label')].find((element) => normalize(element.textContent).includes(${JSON.stringify(text)}));
    if (!target) return false;
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    return true;
  })()`);
  assert.equal(scrolled, true, `Missing element to scroll: ${text}`);
  await delay(150);
}

async function screenshot(client, sessionId, destination, fullPage = false) {
  if (!fullPage) {
    const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
    await writeFile(destination, Buffer.from(result.data, "base64"));
    return;
  }

  // Verify at an iPhone-height viewport first, then expand only for the evidence
  // frame so the fixed bottom navigation is rendered once at the true bottom.
  const viewport = await evaluate(client, sessionId, "({ width: innerWidth, height: innerHeight, contentHeight: Math.ceil(document.documentElement.scrollHeight), dpr: devicePixelRatio })");
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.contentHeight,
    deviceScaleFactor: viewport.dpr,
    mobile: true,
    screenWidth: viewport.width,
    screenHeight: viewport.contentHeight,
  }, sessionId);
  await delay(100);
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, sessionId);
  await writeFile(destination, Buffer.from(result.data, "base64"));
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: viewport.width,
    height: viewport.height,
    deviceScaleFactor: viewport.dpr,
    mobile: true,
    screenWidth: viewport.width,
    screenHeight: viewport.height,
  }, sessionId);
}

async function assertNoHorizontalOverflow(client, sessionId, width, state) {
  const metrics = await evaluate(client, sessionId, `(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    verticalOverflow: document.documentElement.scrollHeight > document.documentElement.clientHeight + 1,
    homeDashboard: Boolean(document.querySelector('[data-home-version="approved-golf-home-v2"]')),
    homeScrollHeight: document.querySelector('[data-home-version="approved-golf-home-v2"]')?.scrollHeight || 0,
    homeClientHeight: document.querySelector('[data-home-version="approved-golf-home-v2"]')?.clientHeight || 0,
    navigation: (() => {
      const node = document.querySelector('.homeBottomNav');
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { position: getComputedStyle(node).position, top: rect.top, bottom: rect.bottom };
    })(),
    groupsCard: (() => {
      const node = [...document.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Grupos') && !candidate.closest('.homeBottomNav'));
      if (!node) return null;
      const rect = node.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    })(),
    headings: [...document.querySelectorAll('h1,h2')].map((node) => node.textContent?.trim()).filter(Boolean),
    primaryLabels: [...document.querySelectorAll('button,a')].map((node) => node.textContent?.replace(/\\s+/g, ' ').trim()).filter(Boolean).slice(0, 40),
  }))()`);
  assert.equal(metrics.innerWidth, width, `Viewport override failed at ${width}px (${state}).`);
  assert.equal(metrics.horizontalOverflow, false, `Horizontal overflow found at ${width}px (${state}).`);
  assert.equal(metrics.homeDashboard, true, `Home dashboard marker missing at ${width}px (${state}).`);
  assert.equal(metrics.verticalOverflow, false, `Vertical overflow found at ${width}x${metrics.innerHeight} (${state}).`);
  assert.ok(metrics.homeScrollHeight <= metrics.homeClientHeight + 1, `Home content overflows at ${width}x${metrics.innerHeight} (${state}).`);
  assert.equal(metrics.navigation?.position, "fixed", `Bottom navigation is not fixed at ${width}px (${state}).`);
  assert.ok(Math.abs((metrics.navigation?.bottom || 0) - metrics.innerHeight) < 2, `Bottom navigation is not attached to the viewport at ${width}px (${state}).`);
  assert.ok((metrics.groupsCard?.bottom || 0) <= (metrics.navigation?.top || 0) + 1, `Balances/Groups are covered by navigation at ${width}px (${state}): ${JSON.stringify({ groupsCard: metrics.groupsCard, navigation: metrics.navigation })}.`);
  return metrics;
}

function guestFixtureSource(stateSource = "") {
  const acceptedAt = "2026-09-11T00:00:00.000Z";
  const acceptances = [
    { userId: "guest", type: "terms", documentVersion: "2026-09-08-v2", acceptedAt, locale: "es-MX" },
    { userId: "guest", type: "privacy", documentVersion: "2026-09-08-v6+sha256-c441091d44899e8b", acceptedAt, locale: "es-MX" },
    { userId: "guest", type: "rules_referee", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId: "guest", type: "age_confirmation", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId: "guest", type: "betting_financial", documentVersion: "2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data", acceptedAt, locale: "es-MX" },
  ];
  return `
    localStorage.setItem('backyard-account-mode-v1', 'guest');
    localStorage.setItem('backyard-local-workspace-owner-v1', 'guest');
    localStorage.setItem('backyard-legal-acceptances-v1', ${JSON.stringify(JSON.stringify(acceptances))});
    localStorage.setItem('backyard-betting-consent-prompt-v1:guest:2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data', 'seen');
    localStorage.setItem('golfbets-draft-v1', 'null');
    localStorage.setItem('golfbets-history', '[]');
    ${stateSource}
  `;
}

const activeRoundFixture = guestFixtureSource(`(() => {
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  localStorage.setItem('golfbets-draft-v1', JSON.stringify({
    version: 11,
    roundId: 'qa-active-round',
    roundDate: '2026-09-11',
    startedAt: '2026-09-11T15:00:00.000Z',
    players: [{ id: 'qa-owner', name: 'Golfista', handicap: 8 }],
    ownerId: 'qa-owner',
    startHole: 1,
    roundHoles: 18,
    course: { id: 'qa-course', name: 'La Vista', teeName: 'Blancas', rating: 72, slope: 113, holes },
    courseSelected: true,
    scores: { 1: { 'qa-owner': 4 }, 2: { 'qa-owner': 5 } },
    scoreEdits: { 1: { 'qa-owner': 4 }, 2: { 'qa-owner': 5 } },
    currentIndex: 2,
  }));
})();`);

function animalRoundFixture(enabledAnimals) {
  const enabled = new Set(enabledAnimals);
  return guestFixtureSource(`(() => {
    const players = [{ id: 'qa-owner', name: 'Golfista', handicap: 8 }, { id: 'qa-bruno', name: 'Bruno', handicap: 12 }];
    const ids = players.map((player) => player.id);
    const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: index === 1 ? 3 : 4, strokeIndex: index + 1, yards: index === 0 ? 421 : 165 }));
    const counter = (enabled) => ({ enabled, value: 100, secondNinePressed: false, secondNineMultiplier: 2, settlementMode: 'halves', participantIds: ids });
    localStorage.setItem('golfbets-draft-v1', JSON.stringify({
      version: 11,
      roundId: 'qa-game-${[...enabled].join("-") || "none"}',
      roundDate: '2026-09-11',
      startedAt: '2026-09-11T15:00:00.000Z',
      players,
      ownerId: 'qa-owner',
      startHole: 1,
      roundHoles: 18,
      course: { id: 'qa-course', name: 'La Vista', teeName: 'Blancas', rating: 72, slope: 113, holes },
      courseSelected: true,
      scores: {}, scoreEdits: {}, putts: {}, advancedStats: {}, currentIndex: 0,
      bets: {
        vipers: counter(${enabled.has("vipers")}),
        camels: counter(${enabled.has("camels")}),
        fish: counter(${enabled.has("fish")})
      }
    }));
  })();`);
}

const historyFixture = guestFixtureSource(`(() => {
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  const order = Array.from({ length: 9 }, (_, index) => index + 1);
  const scores = Object.fromEntries(order.map((hole) => [hole, { 'qa-owner': 4 }]));
  localStorage.setItem('golfbets-history', JSON.stringify([{
    id: 'qa-history-round', date: '2026-09-10', courseName: 'La Vista', teeName: 'Blancas',
    ownerName: 'Golfista', ownerId: 'qa-owner', roundHoles: 9, startHole: 1,
    lifecycleState: 'completed', betResult: 0, expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, netResult: 0, categoryResults: {},
    players: [{ id: 'qa-owner', name: 'Golfista', handicap: 8 }],
    courseSnapshot: { id: 'qa-course', name: 'La Vista', teeName: 'Blancas', holes },
    order, scores, completedAt: '2026-09-10T18:00:00.000Z', updatedAt: '2026-09-10T18:00:00.000Z',
  }]));
})();`);

function authenticatedFixtureSource(displayName = "Said") {
  const userId = "qa-visible-user";
  const acceptedAt = "2026-09-11T00:00:00.000Z";
  const acceptances = [
    { userId, type: "terms", documentVersion: "2026-09-08-v2", acceptedAt, locale: "es-MX" },
    { userId, type: "privacy", documentVersion: "2026-09-08-v6+sha256-c441091d44899e8b", acceptedAt, locale: "es-MX" },
    { userId, type: "rules_referee", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId, type: "age_confirmation", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId, type: "betting_financial", documentVersion: "2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data", acceptedAt, locale: "es-MX" },
  ];
  const profile = {
    userId,
    displayName,
    email: "said.qa@example.test",
    avatarUrl: "😎",
    defaultHandicap: 8.4,
    givenName: displayName.split(/\s+/)[0] || "Golfista",
    familyName: "QA",
    username: "said_qa",
    city: "San Andrés Cholula",
    state: "Puebla",
    country: "México",
    homeClub: "La Vista Country Club",
    homeClubId: "club-la-vista",
    preferredTee: "Blancas",
    handedness: "right",
    typicalScore: 86,
    driverDistanceYards: 245,
    improvementGoals: [],
    primaryGoals: [],
    primaryGoal: "",
    targetHandicap: null,
    planId: "BETA_PRO",
    ghinLinkStatus: "COMING_SOON",
    golfProfileUpdatedAt: acceptedAt,
    bio: "",
    profileVisibility: "private",
  };
  return `
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    localStorage.setItem('backyard-account-mode-v1', 'authenticated');
    localStorage.setItem('backyard-local-workspace-owner-v1', ${JSON.stringify(userId)});
    localStorage.setItem('backyard-profile-cache-v1:${userId}', ${JSON.stringify(JSON.stringify(profile))});
    localStorage.setItem('backyard-profile-ready-v1:${userId}', 'true');
    localStorage.setItem('the-backyard:equipment-onboarding-ready:v1:${userId}', 'true');
    localStorage.setItem('backyard-local-migration-decision-v1:${userId}', 'linked');
    localStorage.setItem('backyard-legal-acceptances-v1', ${JSON.stringify(JSON.stringify(acceptances))});
    localStorage.setItem('backyard-betting-consent-prompt-v1:${userId}:2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data', 'seen');
    localStorage.setItem('golfbets-draft-v1', 'null');
    localStorage.setItem('golfbets-history', '[]');
  `;
}

function authenticatedActiveRoundFixtureSource() {
  const userId = "qa-visible-user";
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 }));
  const round = {
    version: 11,
    roundId: "qa-approved-home-active-round",
    roundDate: "2026-09-11",
    startedAt: "2026-09-11T15:00:00.000Z",
    players: [{ id: userId, accountUserId: userId, name: "Said", handicap: 8 }],
    ownerId: userId,
    startHole: 1,
    roundHoles: 18,
    course: { id: "qa-course", name: "La Vista", teeName: "Blancas", rating: 72, slope: 113, holes },
    courseSelected: true,
    scores: { 1: { [userId]: 4 }, 2: { [userId]: 5 } },
    scoreEdits: { 1: { [userId]: 4 }, 2: { [userId]: 5 } },
    currentIndex: 2,
  };
  return `${authenticatedFixtureSource()}
    localStorage.setItem('golfbets-draft-v1', ${JSON.stringify(JSON.stringify(round))});
  `;
}

async function qaState(client, width, state, options) {
  const viewportHeight = options.viewportHeight ?? (width >= 430 ? 932 : 844);
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Log.enable", {}, sessionId);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: viewportHeight,
  }, sessionId);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
  const errors = [];
  const exceptionKey = `${sessionId}:Runtime.exceptionThrown`;
  client.events.set(exceptionKey, [(event) => errors.push(event.exceptionDetails?.text || "runtime exception")]);
  const logKey = `${sessionId}:Log.entryAdded`;
  client.events.set(logKey, [(event) => {
    if (["error", "warning"].includes(event.entry?.level)) errors.push(`${event.entry.level}: ${event.entry.text}`);
  }]);

  if (options.fixture) {
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `try { ${options.fixture} } catch { /* QA fixture storage unavailable. */ }`,
    }, sessionId);
  }

  const loaded = client.once("Page.loadEventFired", sessionId);
  await client.send("Page.navigate", { url: origin }, sessionId);
  await loaded;
  if (!options.fixture) {
    await waitFor(client, sessionId, "document.readyState === 'complete' && document.body?.innerText.includes('Continuar como invitado')", "hydrated access screen");
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
  await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "approved Home dashboard");
  if (options.afterReady) {
    await evaluate(client, sessionId, options.afterReady);
    await delay(250);
  }
  await waitFor(client, sessionId, options.assertion, state);
  await delay(500);
  const metrics = await assertNoHorizontalOverflow(client, sessionId, width, state);
  const destination = path.join(outputDirectory, options.filename(width));
  await screenshot(client, sessionId, destination, Boolean(options.fullPage));
  if (options.afterCapture) {
    await evaluate(client, sessionId, options.afterCapture);
    await waitFor(client, sessionId, options.afterCaptureAssertion, `${state} after capture`);
  }
  assert.deepEqual(errors, [], `Browser console errors at ${width}px: ${errors.join(" | ")}`);
  await client.send("Target.closeTarget", { targetId });
  await client.send("Target.disposeBrowserContext", { browserContextId });
  return { screenshot: destination, metrics, consoleErrors: errors };
}

async function qaViewport(client, width) {
  return {
    width,
    states: {
      newAccount: await qaState(client, width, "new account", {
        assertion: "document.body?.innerText.includes('Buen golf') && Boolean(document.querySelector('[aria-label=\"Elegir cómo armar tu ronda\"]')) && !document.body?.innerText.includes('PLAY WITH IT') && document.body?.innerText.includes('Reglas de golf') && !document.body?.innerText.includes('Tu última ronda')",
        filename: (value) => `home-preview-${value}.png`,
        fullPage: true,
      }),
      activeRound: await qaState(client, width, "active round", {
        fixture: activeRoundFixture,
        assertion: "document.body?.innerText.includes('CONTINUAR RONDA') && document.body?.innerText.includes('La Vista') && document.body?.innerText.includes('H3')",
        filename: (value) => `home-preview-active-${value}.png`,
        fullPage: true,
      }),
      history: await qaState(client, width, "history", {
        fixture: historyFixture,
        assertion: "document.body?.innerText.includes('Buen golf') && document.body?.innerText.includes('Promedio') && document.body?.innerText.includes('Sigue') && document.body?.innerText.includes('mejorando')",
        filename: (value) => `home-preview-history-${value}.png`,
        fullPage: true,
      }),
    },
  };
}

async function qaApprovedHome(client, viewport) {
  const { width, height } = viewport;
  return qaState(client, width, "approved Home", {
    fixture: authenticatedFixtureSource(),
    viewportHeight: height,
    assertion: "document.body?.innerText.includes('Buen golf') && document.body?.innerText.includes('hoy, Said') && !document.body?.innerText.includes('PLAY WITH IT') && !document.body?.innerText.includes('THE BACKYARD CLUB') && Boolean(document.querySelector('[aria-label=\"Elegir cómo armar tu ronda\"]')) && document.body?.innerText.includes('Accesos rápidos') && document.body?.innerText.includes('Más de The Backyard') && (() => { const nav = document.querySelector('.homeBottomNav'); const logo = document.querySelector('[data-home-logo]'); const play = document.querySelector('[data-home-play]'); if (!nav || !logo || !play) return false; const navRect = nav.getBoundingClientRect(); const logoRect = logo.getBoundingClientRect(); const playRect = play.getBoundingClientRect(); return getComputedStyle(nav).position === 'fixed' && Math.abs(navRect.bottom - window.innerHeight) < 2 && Math.abs((logoRect.left + logoRect.width / 2) - (playRect.left + playRect.width / 2)) < 1 && getComputedStyle(logo.querySelector('img')).objectFit === 'contain'; })()",
    afterReady: "(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); return true; })()",
    filename: () => `home-final-${width}x${height}.png`,
    fullPage: false,
  });
}

async function qaResponsiveHomeName(client, viewport, displayName) {
  const { width, height } = viewport;
  const fileName = displayName.toLocaleLowerCase("es-MX").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return qaState(client, width, `Home responsive name ${displayName}`, {
    fixture: authenticatedFixtureSource(displayName),
    viewportHeight: height,
    assertion: `(() => {
      const headline = document.querySelector('[data-home-headline]');
      const logo = document.querySelector('[data-home-logo]');
      const play = document.querySelector('[data-home-play]');
      const ball = document.querySelector('[aria-label="Elegir cómo armar tu ronda"]');
      if (!headline || !logo || !play || !ball) return false;
      const headlineRect = headline.getBoundingClientRect();
      const logoRect = logo.getBoundingClientRect();
      const playRect = play.getBoundingClientRect();
      const ballRect = ball.getBoundingClientRect();
      const style = getComputedStyle(headline);
      const lineCount = Math.round(headlineRect.height / Number.parseFloat(style.lineHeight));
      return document.body?.innerText.includes(${JSON.stringify(displayName)})
        && headlineRect.left >= 0
        && headlineRect.right <= innerWidth
        && headlineRect.bottom <= ballRect.top + 1
        && lineCount <= 3
        && Math.abs((logoRect.left + logoRect.width / 2) - (playRect.left + playRect.width / 2)) < 1
        && logoRect.left >= ballRect.left
        && logoRect.right <= ballRect.right
        && playRect.top > logoRect.top + logoRect.height * .42
        && playRect.bottom < logoRect.top + logoRect.height * .75;
    })()`,
    afterReady: "(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); return true; })()",
    filename: () => `home-name-${fileName}-${width}x${height}.png`,
    fullPage: false,
  });
}

async function qaRoundChoiceDialog(client, width) {
  return qaState(client, width, "round setup choice dialog", {
    fixture: authenticatedFixtureSource(),
    assertion: "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('¿CÓMO QUIERES ARMAR TU RONDA?') && document.body?.innerText.includes('CONFIGURAR MANUALMENTE') && document.body?.innerText.includes('ARMAR CON BACKYARD AI') && document.body?.innerText.includes('PLAY WITH IT') && Boolean(document.querySelector('[role=\"dialog\"] [aria-label=\"Cerrar\"]'))",
    afterReady: "(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); document.querySelector('[aria-label=\"Elegir cómo armar tu ronda\"]')?.click(); return true; })()",
    afterCapture: "(() => { document.querySelector('[role=\"dialog\"] [aria-label=\"Cerrar\"]')?.click(); return true; })()",
    afterCaptureAssertion: "!document.querySelector('[role=\"dialog\"]')",
    filename: (value) => `home-round-choice-${value}.png`,
    fullPage: false,
  });
}

async function qaApprovedActiveHome(client, width) {
  return qaState(client, width, "approved Home with active round", {
    fixture: authenticatedActiveRoundFixtureSource(),
    assertion: "document.body?.innerText.includes('RONDA ACTIVA') && document.body?.innerText.includes('La Vista') && document.body?.innerText.includes('H3') && document.body?.innerText.includes('CONTINUAR RONDA')",
    afterReady: "(() => { Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => true }); window.dispatchEvent(new Event('online')); return true; })()",
    filename: (value) => `home-approved-active-${value}.png`,
    fullPage: false,
  });
}

async function openMobileSession(client, width, fixture) {
  const viewportHeight = width >= 430 ? 932 : 844;
  const { browserContextId } = await client.send("Target.createBrowserContext");
  const { targetId } = await client.send("Target.createTarget", { url: "about:blank", browserContextId });
  const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true });
  await client.send("Page.enable", {}, sessionId);
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("Log.enable", {}, sessionId);
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height: viewportHeight,
    deviceScaleFactor: 1,
    mobile: true,
    screenWidth: width,
    screenHeight: viewportHeight,
  }, sessionId);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `try { ${fixture} } catch { /* QA fixture storage unavailable. */ }`,
  }, sessionId);
  const errors = [];
  client.events.set(`${sessionId}:Runtime.exceptionThrown`, [(event) => errors.push(event.exceptionDetails?.text || "runtime exception")]);
  client.events.set(`${sessionId}:Log.entryAdded`, [(event) => {
    if (event.entry?.level === "error") errors.push(`error: ${event.entry.text}`);
  }]);
  const loaded = client.once("Page.loadEventFired", sessionId);
  await client.send("Page.navigate", { url: origin }, sessionId);
  await loaded;
  await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "authenticated Home dashboard");
  return { browserContextId, targetId, sessionId, errors };
}

async function closeMobileSession(client, session) {
  await client.send("Target.closeTarget", { targetId: session.targetId });
  await client.send("Target.disposeBrowserContext", { browserContextId: session.browserContextId });
}

async function qaAuthenticatedFlows(client, width) {
  const session = await openMobileSession(client, width, authenticatedFixtureSource());
  const { sessionId, errors } = session;
  const evidence = {};
  const capture = async (name) => {
    const destination = path.join(outputDirectory, name);
    await screenshot(client, sessionId, destination);
    evidence[name] = destination;
  };

  try {
    await waitFor(client, sessionId, "document.body?.innerText.includes('Said') && Boolean(document.querySelector('[aria-label=\"Elegir cómo armar tu ronda\"]')) && !document.body?.innerText.includes('PLAY WITH IT')", "authenticated identity and approved action");
    const navLabels = await evaluate(client, sessionId, "[...document.querySelectorAll('.betaBottomNav .betaNavLabel')].map((node) => node.textContent?.trim())");
    assert.deepEqual(navLabels, ["Inicio", "Social", "Más", "Perfil"], "Bottom navigation does not match the approved four destinations.");
    const homeDestination = path.join(outputDirectory, `phase2-home-auth-${width}.png`);
    await screenshot(client, sessionId, homeDestination, true);
    evidence[`phase2-home-auth-${width}.png`] = homeDestination;

    const returnHome = async (label) => {
      await clickAriaLabel(client, sessionId, "Inicio");
      await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", `Home after ${label}`);
    };

    await clickAriaLabel(client, sessionId, "Abrir notificaciones");
    await waitFor(client, sessionId, "[...document.querySelectorAll('.socialViewTab.active')].some((node) => node.textContent?.includes('Avisos'))", "notification bell opens Social notices");
    await returnHome("notifications");

    await clickAriaLabel(client, sessionId, "Abrir Configuración");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Cuenta y privacidad') && document.body?.innerText.includes('Cerrar sesión')", "settings screen");
    await returnHome("settings");

    await clickAriaLabel(client, sessionId, "Elegir cómo armar tu ronda");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('ARMAR CON BACKYARD AI')", "round choice dialog");
    await clickContaining(client, sessionId, "ARMAR CON BACKYARD AI");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Dime cómo juegan.')", "Backyard AI round setup");
    await capture(`master-round-ai-${width}.png`);
    await clickText(client, sessionId, "Cancelar");
    await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "Home after AI setup");

    await clickContaining(client, sessionId, "Estadísticas");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Tu juego, con datos reales.')", "statistics shortcut");
    await returnHome("statistics");

    await clickContaining(client, sessionId, "Historial");
    await waitFor(client, sessionId, "document.body?.innerText.includes('HISTÓRICO')", "history shortcut");
    await returnHome("history");

    await clickContaining(client, sessionId, "Reglas de golf");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Reglas de Golf')", "rules shortcut");
    await returnHome("rules");

    await clickContaining(client, sessionId, "Balances");
    await waitFor(client, sessionId, "document.querySelector('h1')?.textContent?.includes('Balances')", "balances shortcut");
    await returnHome("balances");

    await clickContaining(client, sessionId, "Grupos");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Armar grupos')", "groups shortcut");
    await returnHome("groups");

    await clickAriaLabel(client, sessionId, "Social");
    await waitFor(client, sessionId, "document.querySelector('#beta-social-title')?.textContent?.includes('Social')", "Social bottom destination");
    await returnHome("Social tab");

    await clickAriaLabel(client, sessionId, "Más");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Tu equipo y herramientas de golf')", "More bottom destination");
    await returnHome("More tab");

    await clickAriaLabel(client, sessionId, "Perfil");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Said') && document.body?.innerText.includes('VINCULAR GHIN')", "profile with GHIN placeholder");
    await clickText(client, sessionId, "Editar perfil");
    await clickText(client, sessionId, "EMOJI");
    await fillLabel(client, sessionId, "Emoji de avatar", "🐶");
    await clickText(client, sessionId, "Usar emoji");
    await clickText(client, sessionId, "Guardar perfil");
    await waitFor(client, sessionId, "document.body?.innerText.includes('🐶') && ![...document.querySelectorAll('button')].some((node) => node.textContent?.trim() === 'Guardar perfil')", "local profile save confirmation");
    await scrollTextIntoView(client, sessionId, "VINCULAR GHIN");
    await capture(`phase2-profile-emoji-ghin-${width}.png`);

    await clickContaining(client, sessionId, "VINCULAR GHIN");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Integración GHIN')", "GHIN information dialog");
    await capture(`phase2-modal-ghin-close-${width}.png`);
    await clickAriaLabel(client, sessionId, "Cerrar");
    await waitFor(client, sessionId, "!document.querySelector('[role=\"dialog\"]')", "closed GHIN dialog");

    await clickAriaLabel(client, sessionId, "Inicio");
    await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null && document.body?.innerText.includes('Said')", "Home after avatar save");
    assert.equal(await evaluate(client, sessionId, "document.body?.innerText.includes('🐶')"), true, "Saved emoji did not render on Home.");

    await clickAriaLabel(client, sessionId, "Más");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Tu equipo y herramientas de golf')", "More tools hub");
    await clickContaining(client, sessionId, "Mi Bolsa");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Mi bolsa') && document.body?.innerText.includes('The Backyard Ball Fit')", "equipment profile");
    await scrollTextIntoView(client, sessionId, "Mi bolsa");
    await capture(`phase2-equipment-bag-${width}.png`);

    await clickContaining(client, sessionId, "Agregar mi primer bastón");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Selecciona categoría')", "club category step");
    await clickContaining(client, sessionId, "Driver");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Selecciona marca')", "club brand step");
    await fillLabel(client, sessionId, "Buscar marca", "Titleist");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('Titleist'))", "Titleist brand result");
    await clickContaining(client, sessionId, "Titleist", "[role=\"option\"]");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Selecciona modelo')", "club model step");
    await fillLabel(client, sessionId, "Buscar modelo", "910D3");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('910D3'))", "Titleist 910D3 result");
    await capture(`phase2-equipment-club-search-${width}.png`);
    await clickContaining(client, sessionId, "910D3", "[role=\"option\"]");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Tipo y especificación')", "club specifications step");
    await clickText(client, sessionId, "Elegir varilla");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Selecciona varilla')", "shaft brand step");
    await fillLabel(client, sessionId, "Buscar varilla por marca", "Fujikura");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('Fujikura'))", "Fujikura brand result");
    await clickContaining(client, sessionId, "Fujikura", "[role=\"option\"]");
    await fillLabel(client, sessionId, "Buscar modelo / peso / flex", "VENTUS Blue VeloCore+");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('VENTUS Blue VeloCore+'))", "VENTUS Blue VeloCore+ result");
    await capture(`phase2-equipment-shaft-search-${width}.png`);
    await clickContaining(client, sessionId, "VENTUS Blue VeloCore+", "[role=\"option\"]");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Revisa y agrega')", "club final review");
    await capture(`phase2-equipment-shaft-assigned-${width}.png`);
    await clickText(client, sessionId, "Guardar bastón");
    await waitFor(client, sessionId, "!document.querySelector('[role=\"dialog\"]') && document.body?.innerText.includes('Titleist 910D3')", "saved club in bag");

    await scrollTextIntoView(client, sessionId, "Mi bola");
    await clickText(client, sessionId, "Elegir bola");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Selecciona marca')", "ball brand step");
    await fillLabel(client, sessionId, "Buscar bola por marca", "Titleist");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('Titleist'))", "Titleist ball brand result");
    await clickContaining(client, sessionId, "Titleist", "[role=\"option\"]");
    await fillLabel(client, sessionId, "Buscar modelo", "Pro V1 2025");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('Pro V1') && node.textContent?.includes('2025'))", "Pro V1 2025 result");
    await capture(`phase2-equipment-ball-search-${width}.png`);
    await clickContaining(client, sessionId, "Pro V1", "[role=\"option\"]");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Variante final')", "ball details step");
    await clickText(client, sessionId, "Guardar como actual");
    await waitFor(client, sessionId, "!document.querySelector('[role=\"dialog\"]') && Array.from({ length: localStorage.length }, (_, index) => [localStorage.key(index), localStorage.getItem(localStorage.key(index))]).some(([key, value]) => key?.includes('equipment-profile') && value?.includes('Pro V1'))", "saved ball");

    await scrollTextIntoView(client, sessionId, "The Backyard Ball Fit");
    await clickText(client, sessionId, "Hacer Ball Fit");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"][aria-label=\"The Backyard Ball Fit\"]') !== null", "Ball Fit dialog");
    await capture(`phase2-ball-fit-close-${width}.png`);
    await clickAriaLabel(client, sessionId, "Cerrar");
    await waitFor(client, sessionId, "!document.querySelector('[role=\"dialog\"][aria-label=\"The Backyard Ball Fit\"]')", "closed Ball Fit");

    await client.send("Page.reload", {}, sessionId);
    await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "Home after reload");
    await clickAriaLabel(client, sessionId, "Más");
    await clickContaining(client, sessionId, "Mi Bolsa");
    await waitFor(client, sessionId, "document.body?.innerText.includes('Titleist 910D3') && document.body?.innerText.includes('Pro V1')", "equipment restored after reload");
    await capture(`phase2-equipment-restored-${width}.png`);

    await clickAriaLabel(client, sessionId, "Inicio");
    await waitFor(client, sessionId, "document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "Home before round setup");
    await clickAriaLabel(client, sessionId, "Elegir cómo armar tu ronda");
    await waitFor(client, sessionId, "document.querySelector('[role=\"dialog\"]')?.textContent?.includes('CONFIGURAR MANUALMENTE')", "round choice dialog before manual setup");
    await clickContaining(client, sessionId, "CONFIGURAR MANUALMENTE");
    await waitFor(client, sessionId, "document.body?.innerText.includes('1. Campo') && document.body?.innerText.includes('FALTA COMPLETAR')", "round setup");
    await capture(`master-round-field-nearby-${width}.png`);
    await scrollTextIntoView(client, sessionId, "FALTA COMPLETAR");
    await capture(`master-round-manual-preflight-${width}.png`);
    await scrollTextIntoView(client, sessionId, "1. Campo");
    await fillLabel(client, sessionId, "Campo", "La Vi");
    await waitFor(client, sessionId, "[...document.querySelectorAll('[role=\"option\"]')].some((node) => node.textContent?.includes('La Vista'))", "La Vista course result");
    await capture(`phase2-course-search-${width}.png`);
    assert.equal(await evaluate(client, sessionId, "Boolean(document.querySelector('[aria-label=\"Buscar campos cercanos con mi ubicación\"]'))"), true, "Nearby course action is missing.");

    const overflow = await evaluate(client, sessionId, "document.documentElement.scrollWidth > document.documentElement.clientWidth + 1");
    assert.equal(overflow, false, "Authenticated flow has horizontal overflow.");
    assert.deepEqual(errors, [], `Authenticated flow console errors: ${errors.join(" | ")}`);
    return { width, screenshots: evidence, consoleErrors: errors };
  } finally {
    await closeMobileSession(client, session);
  }
}

async function qaHistoryScreen(client, width) {
  const session = await openMobileSession(client, width, historyFixture);
  const { sessionId, errors } = session;
  try {
    await clickContaining(client, sessionId, "Historial");
    await waitFor(client, sessionId, "document.body?.innerText.includes('La Vista') && document.body?.innerText.includes('Abrir ronda')", "completed-round history");
    const destination = path.join(outputDirectory, `phase2-history-completed-${width}.png`);
    await screenshot(client, sessionId, destination);
    assert.deepEqual(errors, [], `History flow console errors: ${errors.join(" | ")}`);
    return { width, screenshot: destination, consoleErrors: errors };
  } finally {
    await closeMobileSession(client, session);
  }
}

async function qaActiveRoundAction(client, width) {
  const session = await openMobileSession(client, width, activeRoundFixture);
  const { sessionId, errors } = session;
  try {
    await waitFor(client, sessionId, "document.querySelector('[aria-label=\"Continuar ronda\"]') !== null", "active-round action hydration");
    await clickAriaLabel(client, sessionId, "Continuar ronda");
    await waitFor(client, sessionId, "document.querySelector('[data-game-screen=\"approved-compact-v1\"]') !== null && document.body?.innerText.includes('Hoyo 3')", "active round continuation");
    assert.deepEqual(errors, [], `Active-round continuation console errors: ${errors.join(" | ")}`);
    return { width, destination: "round-hole-3", consoleErrors: errors };
  } finally {
    await closeMobileSession(client, session);
  }
}

async function qaAnimalGameScreen(client, width, label, enabledAnimals) {
  const session = await openMobileSession(client, width, animalRoundFixture(enabledAnimals));
  const { sessionId, errors } = session;
  try {
    await waitFor(client, sessionId, "document.querySelector('[aria-label=\"Continuar ronda\"]') !== null", `${label} active-round hydration`);
    await clickAriaLabel(client, sessionId, "Continuar ronda");
    await waitFor(client, sessionId, "document.querySelector('[data-game-screen=\"approved-compact-v1\"]') !== null", `${label} game screen`);
    const animalText = await evaluate(client, sessionId, "document.querySelector('[data-game-screen=\"approved-compact-v1\"]')?.innerText || ''");
    assert.equal(animalText.includes("🐍"), enabledAnimals.includes("vipers"), `${label}: snake visibility mismatch.`);
    assert.equal(animalText.includes("🐫"), enabledAnimals.includes("camels"), `${label}: camel visibility mismatch.`);
    assert.equal(animalText.includes("🐟"), enabledAnimals.includes("fish"), `${label}: fish visibility mismatch.`);
    assert.equal(animalText.includes("Penalty / Hazard"), true, `${label}: canonical penalty control missing.`);
    assert.equal(animalText.includes("Resultado de la bola"), false, `${label}: redundant ball-result section remains.`);
    assert.equal(await evaluate(client, sessionId, "[...document.querySelectorAll('button')].some((node) => ['Fairway', 'Rough'].includes(node.textContent?.trim() || ''))"), false, `${label}: redundant Fairway/Rough buttons remain.`);
    assert.equal(await evaluate(client, sessionId, "['Green Side Bunker','Fairway Bunker','Penalty / Hazard','OB'].every((name) => { const group = document.querySelector(`[role=\\\"group\\\"][aria-label=\\\"${name}\\\"]`); return group && group.querySelector('[aria-label^=\\\"Restar\\\"]') && group.querySelector('[aria-label^=\\\"Sumar\\\"]'); })"), true, `${label}: a situation is missing its plus/minus counter.`);
    assert.equal(await evaluate(client, sessionId, "document.querySelector('[data-situation=\"OB\"]')?.textContent?.includes('≋') === false"), true, `${label}: OB uses the hazard symbol.`);
    assert.equal(await evaluate(client, sessionId, "Math.abs((document.querySelector('[aria-label^=\"Score Golfista hoyo\"]')?.getBoundingClientRect().top || 0) - (document.querySelector('[aria-label^=\"Putts Golfista hoyo\"]')?.getBoundingClientRect().top || 100)) < 8"), true, `${label}: Score and Putts are not horizontal.`);
    assert.equal(await evaluate(client, sessionId, "document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1"), true, `${label}: horizontal overflow detected.`);
    const destination = path.join(outputDirectory, `master-game-${label}-${width}.png`);
    await screenshot(client, sessionId, destination, true);

    let gpsOpenScreenshot = null;
    if (label === "all-animals" && width === 390) {
      await clickContaining(client, sessionId, "VER VISTA GPS");
      await waitFor(client, sessionId, "document.querySelector('#round-hole-map') !== null && document.querySelector('[aria-controls=\"round-hole-map\"]')?.getAttribute('aria-expanded') === 'true'", "expanded GPS view");
      gpsOpenScreenshot = path.join(outputDirectory, `master-game-gps-open-${width}.png`);
      await screenshot(client, sessionId, gpsOpenScreenshot, true);
    }

    if (label === "all-animals" && width === 390) {
      await evaluate(client, sessionId, "document.querySelector('[role=\"group\"][aria-label=\"Green Side Bunker\"] [aria-label^=\"Sumar\"]')?.click()");
      await waitFor(client, sessionId, "document.querySelector('[role=\"group\"][aria-label=\"Green Side Bunker\"]')?.textContent?.includes('1')", "owner bunker persistence seed");
      await clickAriaLabel(client, sessionId, "Cambiar jugador");
      await clickAriaLabel(client, sessionId, "Cambiar jugador");
      assert.equal(await evaluate(client, sessionId, "document.querySelector('[role=\"group\"][aria-label=\"Green Side Bunker\"]')?.textContent?.includes('1')"), true, "Player switch lost captured bunker data.");
      await evaluate(client, sessionId, "[...document.querySelectorAll('nav[aria-label=\"Hoyos de la ronda\"] button')].find((button) => button.textContent?.trim() === '2')?.click()");
      await waitFor(client, sessionId, "document.body?.innerText.includes('Hoyo 2')", "navigate to hole 2");
      await evaluate(client, sessionId, "[...document.querySelectorAll('nav[aria-label=\"Hoyos de la ronda\"] button')].find((button) => button.textContent?.trim() === '1')?.click()");
      await waitFor(client, sessionId, "document.body?.innerText.includes('Hoyo 1') && document.querySelector('[role=\"group\"][aria-label=\"Green Side Bunker\"]')?.textContent?.includes('1')", "return to persisted hole 1");
    }
    assert.deepEqual(errors, [], `${label} game console errors: ${errors.join(" | ")}`);
    return { width, label, screenshot: destination, gpsOpenScreenshot, consoleErrors: errors };
  } finally {
    await closeMobileSession(client, session);
  }
}

await mkdir(outputDirectory, { recursive: true });
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "backyard-home-qa-"));
const port = await unusedPort();
const processKeepAlive = setInterval(() => {}, 1_000);
let chrome;
try {
  const chromePath = chromeCandidates[0];
  assert.ok(chromePath, "Set CHROME_PATH to a Chrome executable.");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-sandbox",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--crash-dumps-dir=${userDataDirectory}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let chromeStderr = "";
  chrome.stderr?.on("data", (chunk) => {
    chromeStderr += String(chunk);
  });
  chrome.once("exit", (code) => {
    if (code && chromeStderr.trim()) process.stderr.write(chromeStderr);
  });
  const version = await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const client = new CdpClient(version.webSocketDebuggerUrl);
  const results = [];
  if (scenario === "all") for (const width of widths) results.push(await qaViewport(client, width));
  if (scenario === "home") for (const viewport of approvedHomeViewports) results.push(await qaApprovedHome(client, viewport));
  if (scenario === "home-layout") {
    for (const displayName of ["Golfista", "Francisco Javier Martínez"]) {
      for (const viewport of approvedHomeViewports) results.push(await qaResponsiveHomeName(client, viewport, displayName));
    }
    for (const displayName of ["Said", "Alejandro Rodríguez"]) {
      for (const viewport of [approvedHomeViewports[0], approvedHomeViewports[3]]) results.push(await qaResponsiveHomeName(client, viewport, displayName));
    }
  }
  const roundChoice = scenario === "home" ? await qaRoundChoiceDialog(client, 390) : null;
  const approvedActiveRound = scenario === "home" ? await qaApprovedActiveHome(client, 390) : null;
  const authenticated = scenario === "all" || scenario === "authenticated" ? await qaAuthenticatedFlows(client, 390) : null;
  const history = scenario === "all" ? await qaHistoryScreen(client, 390) : null;
  const activeRound = scenario === "all" ? await qaActiveRoundAction(client, 390) : null;
  const gameScreens = scenario === "all" ? [
    await qaAnimalGameScreen(client, 390, "none", []),
    await qaAnimalGameScreen(client, 390, "vipers", ["vipers"]),
    await qaAnimalGameScreen(client, 390, "camels", ["camels"]),
    await qaAnimalGameScreen(client, 390, "fish", ["fish"]),
    await qaAnimalGameScreen(client, 390, "all-animals", ["vipers", "camels", "fish"]),
  ] : scenario === "game" ? [
    await qaAnimalGameScreen(client, 390, "none", []),
    await qaAnimalGameScreen(client, 430, "none", []),
    await qaAnimalGameScreen(client, 390, "vipers", ["vipers"]),
    await qaAnimalGameScreen(client, 390, "camels", ["camels"]),
    await qaAnimalGameScreen(client, 390, "fish", ["fish"]),
    await qaAnimalGameScreen(client, 390, "all-animals", ["vipers", "camels", "fish"]),
  ] : null;
  client.close();
  console.log(JSON.stringify({ origin, status: "PASS", results, roundChoice, approvedActiveRound, authenticated, history, activeRound, gameScreens }, null, 2));
} finally {
  if (chrome?.exitCode === null) {
    chrome.kill();
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      delay(2_000),
    ]);
  }
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  clearInterval(processKeepAlive);
}
