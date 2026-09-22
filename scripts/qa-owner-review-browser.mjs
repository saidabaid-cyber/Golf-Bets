// Final Owner-review browser evidence for an immutable Preview URL.
//
// Usage:
//   node scripts/qa-owner-review-browser.mjs https://immutable-preview.vercel.app .qa-artifacts/22-sept/screenshots
//   node --env-file=.qa-artifacts/.env.phase2-preview.local scripts/qa-owner-review-browser.mjs <url> <dir> --real-auth
//
// The default run uses only isolated browser storage. --real-auth additionally
// signs in two pre-existing QA fixtures so user search can be evidenced without
// creating accounts, sending invitations, saving a group, or writing app data.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const QA_PROJECT_REF = "bymeopxkxapfizeeqeyb";
const FORBIDDEN_HOSTS = new Set(["app.thebackyard.com.mx", "beta.thebackyard.com.mx"]);
const IMMUTABLE_PREVIEW_HOST = /^golf-bets-[a-z0-9]{9}-saha8\.vercel\.app$/;
const previewArgument = process.argv[2] || "";
const outputDirectory = path.resolve(process.argv[3] || path.join(process.cwd(), ".qa-artifacts", "22-sept", "screenshots"));
const useRealAuth = process.argv.includes("--real-auth") || process.env.OWNER_QA_USE_REAL_AUTH === "1";
const expectedSha = String(process.env.OWNER_QA_EXPECTED_SHA || "").trim().toLowerCase();
const fixturePath = path.resolve(process.env.OWNER_QA_FIXTURE_PATH || path.join(process.cwd(), ".qa-artifacts", "social-play-fixtures.private.json"));
const sourceFixturePath = path.resolve(process.env.OWNER_QA_SOURCE_FIXTURE_PATH || fixturePath);
const targetFixturePath = path.resolve(process.env.OWNER_QA_TARGET_FIXTURE_PATH || fixturePath);
const sourceFixtureLabel = String(process.env.OWNER_QA_SOURCE_FIXTURE_LABEL || "").trim();
const targetFixtureLabel = String(process.env.OWNER_QA_TARGET_FIXTURE_LABEL || "").trim();
const preview = new URL(previewArgument || "http://127.0.0.1:3000");
const origin = preview.origin;

assert.ok(["http:", "https:"].includes(preview.protocol), "Preview URL must use http or https.");
assert.equal(FORBIDDEN_HOSTS.has(preview.hostname), false, `Refusing browser QA against protected host ${preview.hostname}.`);
const localPreview = preview.hostname === "127.0.0.1" || preview.hostname === "localhost";
if (!localPreview) {
  assert.equal(preview.protocol, "https:", "Remote browser QA requires an HTTPS Preview URL.");
  assert.match(preview.hostname, IMMUTABLE_PREVIEW_HOST, "Remote browser QA requires this project's immutable Vercel deployment hostname.");
  assert.equal(preview.port, "", "Remote browser QA does not allow a custom port.");
  assert.equal(useRealAuth, true, "Remote final evidence requires --real-auth with the isolated QA fixtures.");
  assert.match(expectedSha, /^[0-9a-f]{40}$/, "Remote final evidence requires OWNER_QA_EXPECTED_SHA.");
}
if (useRealAuth) assert.equal(localPreview, false, "Real QA sessions may run only against an immutable remote Preview.");
const strict = !localPreview || process.argv.includes("--strict");

const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
].filter(Boolean);

const viewports = {
  mobile390: { width: 390, height: 844, mobile: true },
  mobile430: { width: 430, height: 932, mobile: true },
  desktop: { width: 1280, height: 900, mobile: false },
};

const expectedEvidence = [
  "home",
  "home-club-no-tee",
  "permissions",
  "bets-group",
  "bets-personal",
  "play",
  "active-round",
  "my-bag",
  "equipment-category",
  "driver-generation-year",
  "shaft-options",
  "wedge-degrees",
  "profile",
  "preferences",
  "notifications",
  "privacy",
  "feedback",
  "qr",
  "rules",
  "add-user-qr",
  "user-found",
];

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

async function waitForJson(url, attempts = 300) {
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
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timed out running CDP ${method}`));
      }, 30_000);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); },
      });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  once(method, sessionId, timeout = 30_000) {
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

function safeFilePart(value) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").toLocaleLowerCase("en-US");
}

async function authenticateExistingQaAccounts() {
  if (!useRealAuth) return null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const confirmedRef = process.env.QA_CONFIRM_ISOLATED_PREVIEW || process.env.PREVIEW_DB_REF || "";
  assert.equal(new URL(supabaseUrl).hostname, `${QA_PROJECT_REF}.supabase.co`, "Real-auth evidence is restricted to the isolated QA Supabase project.");
  assert.equal(confirmedRef, QA_PROJECT_REF, "Set QA_CONFIRM_ISOLATED_PREVIEW to the isolated QA project ref.");
  assert.ok(publicKey && !publicKey.includes("SENSITIVE"), "A matching Preview publishable/anon key is required for real-auth evidence.");
  const sourceFixtures = JSON.parse(await readFile(sourceFixturePath, "utf8"));
  const targetFixtures = sourceFixturePath === targetFixturePath
    ? sourceFixtures
    : JSON.parse(await readFile(targetFixturePath, "utf8"));
  assert.ok(Array.isArray(sourceFixtures) && sourceFixtures.length >= 1, "An existing source QA fixture account is required.");
  assert.ok(Array.isArray(targetFixtures) && targetFixtures.length >= 1, "An existing target QA fixture account is required.");
  const source = sourceFixtureLabel
    ? sourceFixtures.find((fixture) => fixture.label === sourceFixtureLabel)
    : sourceFixtures[0];
  const target = targetFixtureLabel
    ? targetFixtures.find((fixture) => fixture.label === targetFixtureLabel)
    : targetFixtures[sourceFixturePath === targetFixturePath ? 1 : 0];
  assert.ok(source && target && source.id !== target.id, "Two distinct existing QA fixture accounts are required.");
  for (const fixture of [source, target]) {
    assert.equal(fixture.ref, QA_PROJECT_REF, "Fixture project ref does not match isolated QA.");
    assert.ok(typeof fixture.email === "string" && typeof fixture.password === "string" && typeof fixture.username === "string", "QA fixture is missing required private fields.");
  }
  const response = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: publicKey, Authorization: `Bearer ${publicKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email: source.email, password: source.password }),
    signal: AbortSignal.timeout(30_000),
  });
  const session = await response.json();
  assert.equal(response.ok, true, "Existing QA account sign-in failed.");
  assert.ok(session?.access_token && session?.refresh_token && session?.user?.id, "QA sign-in did not return a reusable session.");
  assert.equal(session.user.id, source.id, "QA sign-in returned a different account than fixture A.");
  return {
    session,
    source: { id: source.id, username: source.username, label: source.label || "A" },
    target: { id: target.id, username: target.username, label: target.label || "B" },
    authStorageKey: `sb-${QA_PROJECT_REF}-auth-token`,
  };
}

function legalAcceptances(userId) {
  const acceptedAt = "2026-09-21T12:00:00.000Z";
  return [
    { userId, type: "terms", documentVersion: "2026-09-08-v2", acceptedAt, locale: "es-MX" },
    { userId, type: "privacy", documentVersion: "2026-09-08-v6+sha256-c441091d44899e8b", acceptedAt, locale: "es-MX" },
    { userId, type: "rules_referee", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId, type: "age_confirmation", documentVersion: "2026-09-01-v1", acceptedAt, locale: "es-MX" },
    { userId, type: "betting_financial", documentVersion: "2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data", acceptedAt, locale: "es-MX" },
  ];
}

function syntheticEquipmentEnvelope(userId, timestamp) {
  const baseClub = (id, category, brand, model, overrides = {}) => ({
    id, userId, category, catalogClubId: null, customBrand: brand, customModel: model,
    generation: null, year: 2026, loft: null, handedness: "RH", shaftId: null,
    customShaftBrand: null, customShaftModel: null, customShaft: null, flex: null,
    shaftWeightGrams: null, lengthInches: null, lieDegrees: null, grip: null, notes: null,
    setComposition: [], isCurrent: true, startedUsingAt: timestamp, stoppedUsingAt: null,
    createdAt: timestamp, updatedAt: timestamp, ...overrides,
  });
  const profile = {
    schemaVersion: 2, userId, equipmentOnboarding: "COMPLETED", ballOnboarding: "COMPLETED", ballPreference: "FIXED",
    clubs: [
      baseClub("qa-driver", "DRIVER", "Callaway", "Big Bertha Alpha", { generation: "2014", year: 2014, loft: 10.5 }),
      baseClub("qa-wood", "FAIRWAY_WOOD", "TaylorMade", "Qi10", { loft: 15 }),
      baseClub("qa-hybrid", "HYBRID", "PING", "G430", { loft: 19 }),
      baseClub("qa-irons", "IRON_SET", "Titleist", "T150", { setComposition: ["5", "6", "7", "8", "9", "P"] }),
      baseClub("qa-wedge-50", "WEDGE", "Titleist", "Vokey SM10", { loft: 50 }),
      baseClub("qa-wedge-56", "WEDGE", "Titleist", "Vokey SM10", { loft: 56 }),
      baseClub("qa-wedge-60", "WEDGE", "Titleist", "Vokey SM10", { loft: 60 }),
      baseClub("qa-putter", "PUTTER", "Odyssey", "Ai-ONE"),
    ],
    balls: [{ id: "qa-ball", userId, catalogBallId: null, ballBrand: "Titleist", ballModel: "Pro V1", generation: "2025", year: 2025, color: "Blanco", notes: null, isCurrent: true, startedUsingAt: timestamp, stoppedUsingAt: null, createdAt: timestamp, updatedAt: timestamp }],
    distances: [], lastBallFit: null, createdAt: timestamp, updatedAt: timestamp,
  };
  return JSON.stringify({ schema: "the-backyard-equipment-profile", version: 1, userId, savedAt: timestamp, profile });
}

function syntheticFixtureSource({ onboardingStep = null, activeRound = false, iphonePermissions = false, equipment = false } = {}) {
  const userId = "00000000-0000-4000-8000-000000000022";
  const acceptedAt = "2026-09-21T12:00:00.000Z";
  const profile = {
    userId,
    displayName: "Owner QA",
    email: "owner.qa@example.test",
    avatarUrl: "⛳",
    defaultHandicap: 8.4,
    givenName: "Owner",
    familyName: "QA",
    username: "owner_qa",
    city: "San Andrés Cholula",
    state: "Puebla",
    country: "México",
    homeClub: "La Vista Country Club",
    homeClubId: "club-la-vista",
    homeCourse: "La Vista Country Club",
    homeCourseId: "course-la-vista",
    preferredTee: "Blancas",
    handedness: "right",
    typicalScore: 86,
    driverDistanceYards: 245,
    improvementGoals: [],
    primaryGoals: [],
    primaryGoal: "",
    targetHandicap: null,
    planId: "BETA_PRO",
    ghinLinkStatus: "SKIPPED",
    golfProfileUpdatedAt: acceptedAt,
    bio: "",
    profileVisibility: "private",
  };
  const progress = onboardingStep ? {
    version: 1,
    userId,
    status: "in_progress",
    step: onboardingStep,
    completedSteps: onboardingStep === "course" ? ["welcome"] : ["welcome", "course", "ghin"],
    skippedSteps: [],
    startedAt: acceptedAt,
    updatedAt: acceptedAt,
    mode: "complete",
  } : null;
  const holes = Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1, yards: 410 - index * 3 }));
  const round = activeRound ? {
    version: 11,
    roundId: "qa-owner-active-round",
    roundDate: "2026-09-21",
    startedAt: "2026-09-21T15:00:00.000Z",
    players: [{ id: userId, accountUserId: userId, name: "Owner QA", handicap: 8 }],
    ownerId: userId,
    startHole: 1,
    roundHoles: 18,
    course: { id: "qa-course", name: "La Vista", teeName: "Blancas", rating: 72, slope: 113, holes },
    courseSelected: true,
    scores: { 1: { [userId]: 4 }, 2: { [userId]: 5 } },
    scoreEdits: { 1: { [userId]: 4 }, 2: { [userId]: 5 } },
    putts: { 1: { [userId]: 2 }, 2: { [userId]: 2 } },
    currentIndex: 2,
  } : null;
  return `
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { window.__ownerQaClipboard = String(value); } } });
    ${iphonePermissions ? `
      Object.defineProperty(window, 'Notification', { configurable: true, value: undefined });
      Object.defineProperty(navigator, 'standalone', { configurable: true, value: false });
      if (navigator.permissions) Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'prompt', addEventListener() {}, removeEventListener() {} }) });
    ` : ""}
    localStorage.setItem('backyard-account-mode-v1', 'authenticated');
    localStorage.setItem('backyard-local-workspace-owner-v1', ${JSON.stringify(userId)});
    localStorage.setItem('backyard-profile-cache-v1:${userId}', ${JSON.stringify(JSON.stringify(profile))});
    localStorage.setItem('backyard-profile-ready-v1:${userId}', 'true');
    localStorage.setItem('the-backyard:equipment-onboarding-ready:v1:${userId}', 'true');
    ${equipment ? `localStorage.setItem('the-backyard:equipment-profile:v1:${encodeURIComponent(userId)}', ${JSON.stringify(syntheticEquipmentEnvelope(userId, acceptedAt))});` : ""}
    localStorage.setItem('backyard-local-migration-decision-v1:${userId}', 'linked');
    localStorage.setItem('backyard-legal-acceptances-v1', ${JSON.stringify(JSON.stringify(legalAcceptances(userId)))});
    localStorage.setItem('backyard-betting-consent-prompt-v1:${userId}:2026-09-08-v3+sha256-5376b615664b10d9:express-betting-data', 'seen');
    localStorage.setItem('golfbets-draft-v1', ${JSON.stringify(round ? JSON.stringify(round) : "null")});
    localStorage.setItem('golfbets-history', '[]');
    ${progress ? `localStorage.setItem('the-backyard:beta-onboarding:v1:${userId}', ${JSON.stringify(JSON.stringify(progress))});` : ""}
  `;
}

function realAuthFixtureSource(realAuth) {
  return `
    Object.defineProperty(Navigator.prototype, 'onLine', { configurable: true, get: () => false });
    localStorage.setItem(${JSON.stringify(realAuth.authStorageKey)}, ${JSON.stringify(JSON.stringify(realAuth.session))});
    localStorage.setItem('backyard-account-mode-v1', 'authenticated');
    localStorage.setItem('backyard-local-workspace-owner-v1', ${JSON.stringify(realAuth.source.id)});
    localStorage.setItem('backyard-local-migration-decision-v1:${realAuth.source.id}', 'linked');
  `;
}

class BrowserSession {
  constructor(client, options) {
    this.client = client;
    this.options = options;
    this.errors = [];
    this.errorCursor = 0;
    this.blockedWrites = [];
  }

  async open() {
    const { browserContextId } = await this.client.send("Target.createBrowserContext");
    const { targetId } = await this.client.send("Target.createTarget", { url: "about:blank", browserContextId });
    const { sessionId } = await this.client.send("Target.attachToTarget", { targetId, flatten: true });
    this.browserContextId = browserContextId;
    this.targetId = targetId;
    this.sessionId = sessionId;
    await this.client.send("Page.enable", {}, sessionId);
    await this.client.send("Runtime.enable", {}, sessionId);
    await this.client.send("Log.enable", {}, sessionId);
    await this.client.send("Network.enable", {}, sessionId);
    await this.client.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] }, sessionId);
    await this.client.send("Emulation.setDeviceMetricsOverride", {
      width: this.options.viewport.width,
      height: this.options.viewport.height,
      deviceScaleFactor: 1,
      mobile: this.options.viewport.mobile,
      screenWidth: this.options.viewport.width,
      screenHeight: this.options.viewport.height,
    }, sessionId);
    if (this.options.viewport.mobile) {
      await this.client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }, sessionId);
    }
    if (this.options.iphone) {
      await this.client.send("Emulation.setUserAgentOverride", {
        userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
        platform: "iPhone",
      }, sessionId);
    }
    if (this.options.fixture) {
      await this.client.send("Page.addScriptToEvaluateOnNewDocument", {
        source: `try { if (location.origin === ${JSON.stringify(origin)} && window.top === window) { ${this.options.fixture} } } catch (error) { console.error('owner-qa-fixture', error?.message || error); }`,
      }, sessionId);
    }
    this.client.events.set(`${sessionId}:Runtime.exceptionThrown`, [(event) => {
      this.errors.push({ type: "exception", message: event.exceptionDetails?.exception?.description || event.exceptionDetails?.text || "Runtime exception" });
    }]);
    this.client.events.set(`${sessionId}:Runtime.consoleAPICalled`, [(event) => {
      if (event.type !== "error") return;
      const message = event.args?.map((arg) => arg.value ?? arg.description ?? "").join(" ") || "console.error";
      this.errors.push({ type: "console", message });
    }]);
    this.client.events.set(`${sessionId}:Log.entryAdded`, [(event) => {
      if (event.entry?.level === "error") this.errors.push({ type: "log", message: event.entry.text || "Browser log error", url: event.entry.url || undefined });
    }]);
    this.client.events.set(`${sessionId}:Fetch.requestPaused`, [(event) => {
      const method = String(event.request?.method || "GET").toUpperCase();
      const url = String(event.request?.url || "");
      const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(method);
      const qaAuthSessionRequest = method === "POST" && url.startsWith(`https://${QA_PROJECT_REF}.supabase.co/auth/v1/token`);
      if (mutating && !qaAuthSessionRequest) {
        this.blockedWrites.push({ method, url: url.split("?")[0] });
        void this.client.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "BlockedByClient" }, sessionId).catch(() => undefined);
        return;
      }
      void this.client.send("Fetch.continueRequest", { requestId: event.requestId }, sessionId).catch(() => undefined);
    }]);
    const loaded = this.client.once("Page.loadEventFired", sessionId, 45_000);
    await this.client.send("Page.navigate", { url: origin }, sessionId);
    await loaded;
    assert.equal(await this.evaluate("location.origin"), origin, "Browser navigation left the approved Preview origin.");
    return this;
  }

  async close() {
    if (this.targetId) await this.client.send("Target.closeTarget", { targetId: this.targetId }).catch(() => undefined);
    if (this.browserContextId) await this.client.send("Target.disposeBrowserContext", { browserContextId: this.browserContextId }).catch(() => undefined);
  }

  async evaluate(expression) {
    const result = await this.client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    }, this.sessionId);
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed.");
    return result.result?.value;
  }

  async wait(expression, label, timeout = 30_000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await this.evaluate(expression)) return;
      await delay(100);
    }
    const state = await this.evaluate(`(() => ({ url: location.href, ready: document.readyState, text: (document.body?.innerText || '').slice(0, 1800), dialogs: [...document.querySelectorAll('[role="dialog"],[role="alertdialog"]')].map(node => (node.textContent || '').slice(0, 500)) }))()`);
    throw new Error(`Timed out waiting for ${label}: ${JSON.stringify(state)}`);
  }

  async waitHome(timeout = 45_000) {
    await this.wait("document.querySelector('[data-home-version=\"approved-golf-home-v2\"]') !== null", "Home dashboard", timeout);
  }

  async click(text, { exact = false, selector = "button,a,[role=option]" } = {}) {
    const point = await this.evaluate(`(() => {
      const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
      const wanted = ${JSON.stringify(text)};
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(element => {
        const label = clean(element.textContent);
        const comparableLabel = label.toLocaleLowerCase('es-MX');
        const comparableWanted = wanted.toLocaleLowerCase('es-MX');
        const visible = Boolean(element.getClientRects().length);
        const enabled = !element.disabled && element.getAttribute('aria-disabled') !== 'true';
        return visible && enabled && (${exact ? "comparableLabel === comparableWanted" : "comparableLabel.includes(comparableWanted)"});
      });
       if (!node) return null;
       node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
       const rect = node.getBoundingClientRect();
       const x = rect.left + rect.width / 2;
       const y = rect.top + rect.height / 2;
       const top = document.elementFromPoint(x, y);
       return top && (top === node || node.contains(top)) ? { x, y } : null;
     })()`);
    assert.ok(point, `Missing, covered, or disabled action ${exact ? "equal to" : "containing"}: ${text}`);
    await this.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await this.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
  }

  async clickAria(label) {
    const point = await this.evaluate(`(() => {
      const node = [...document.querySelectorAll('[aria-label]')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)} && element.getClientRects().length && !element.disabled);
      if (!node) return null;
      node.scrollIntoView({ block: 'center', inline: 'center', behavior: 'auto' });
      const rect = node.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const top = document.elementFromPoint(x, y);
      return top && (top === node || node.contains(top)) ? { x, y } : null;
    })()`);
    assert.ok(point, `Missing, covered, or disabled aria-label action: ${label}`);
    await this.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
    await this.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 }, this.sessionId);
  }

  async fill(label, value) {
    const filled = await this.evaluate(`(() => {
      const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
      const labels = [...document.querySelectorAll('label')];
      const direct = [...document.querySelectorAll('input,textarea')].find(element => element.getAttribute('aria-label') === ${JSON.stringify(label)});
      const wrapper = labels.find(element => clean(element.textContent).startsWith(${JSON.stringify(label)}));
      const linked = wrapper?.htmlFor ? document.getElementById(wrapper.htmlFor) : null;
      const node = direct || linked || wrapper?.querySelector('input,textarea');
      if (!node) return false;
      const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(node, ${JSON.stringify(value)});
      node.dispatchEvent(new Event('input', { bubbles: true }));
      node.dispatchEvent(new Event('change', { bubbles: true }));
      node.focus();
      return true;
    })()`);
    assert.equal(filled, true, `Missing input labelled: ${label}`);
  }

  async scrollToText(text) {
    const found = await this.evaluate(`(() => {
      const clean = value => (value || '').replace(/\\s+/g, ' ').trim();
      const node = [...document.querySelectorAll('h1,h2,h3,legend,label,button,p')].find(element => clean(element.textContent).includes(${JSON.stringify(text)}));
      if (!node) return false;
      node.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'auto' });
      return true;
    })()`);
    assert.equal(found, true, `Could not scroll to: ${text}`);
    await delay(200);
  }

  async screenshot(destination) {
    const result = await this.client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, this.sessionId);
    const bytes = Buffer.from(result.data, "base64");
    await writeFile(destination, bytes);
    return createHash("sha256").update(bytes).digest("hex");
  }

  async capture(name, options = {}) {
    assert.equal(await this.evaluate("location.origin"), origin, `${name}: browser left the approved Preview origin.`);
    const expected = options.expected || [];
    const absent = options.absent || [];
    const inspection = await this.evaluate(`(() => {
      const bodyText = (document.body?.innerText || '').replace(/\\s+/g, ' ').trim();
      const dialog = document.querySelector('[role="dialog"],[role="alertdialog"]');
      const dialogButtons = dialog ? [...dialog.querySelectorAll('button,a')].map(node => ({ text: (node.textContent || '').replace(/\\s+/g, ' ').trim(), aria: node.getAttribute('aria-label') || '', disabled: Boolean(node.disabled) || node.getAttribute('aria-disabled') === 'true' })) : [];
      const disabledButtons = [...document.querySelectorAll('button:disabled,[role="button"][aria-disabled="true"]')].filter(node => node.getClientRects().length).map(node => ({ text: (node.textContent || '').replace(/\\s+/g, ' ').trim(), title: node.getAttribute('title') || '', aria: node.getAttribute('aria-label') || '' })).slice(0, 30);
      return {
        bodyText,
        url: location.href,
        title: document.title,
        width: innerWidth,
        height: innerHeight,
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        hasDialog: Boolean(dialog),
        dialogButtons,
        disabledButtons,
        vercelVisible: /(?:https?:\\/\\/)?[a-z0-9-]+\\.vercel\\.app/i.test(bodyText),
      };
    })()`);
    assert.equal(inspection.width, this.options.viewport.width, `${name}: viewport width mismatch.`);
    assert.equal(inspection.horizontalOverflow, false, `${name}: horizontal overflow (${inspection.scrollWidth} > ${inspection.clientWidth}).`);
    assert.equal(inspection.vercelVisible, false, `${name}: a vercel.app URL is visible in the product UI.`);
    for (const text of expected) assert.equal(inspection.bodyText.includes(text), true, `${name}: missing expected text “${text}”.`);
    for (const text of absent) assert.equal(inspection.bodyText.includes(text), false, `${name}: forbidden text “${text}” is visible.`);
    if (options.assertion) assert.equal(await this.evaluate(options.assertion), true, `${name}: custom assertion failed.`);
    if (inspection.hasDialog || options.exitRequired) {
      const canExit = inspection.dialogButtons.some((button) => !button.disabled && (/cerrar|cancelar|volver|anterior|×|^x$/i.test(`${button.text} ${button.aria}`)));
      assert.equal(canExit, true, `${name}: dialog has no visible enabled exit.`);
    }
    const filename = `${String(report.captures.length + 1).padStart(2, "0")}-${safeFilePart(name)}-${inspection.width}x${inspection.height}.png`;
    const destination = path.join(outputDirectory, filename);
    const sha256 = await this.screenshot(destination);
    const newErrors = this.errors.slice(this.errorCursor);
    this.errorCursor = this.errors.length;
    const item = {
      name,
      file: destination,
      sha256,
      dataMode: this.options.dataMode || "controlled-local-fixture",
      viewport: { width: inspection.width, height: inspection.height },
      scrollHeight: inspection.scrollHeight,
      horizontalOverflow: inspection.horizontalOverflow,
      modalExitVerified: inspection.hasDialog || options.exitRequired ? true : null,
      disabledButtons: inspection.disabledButtons,
      consoleErrors: newErrors,
    };
    report.captures.push(item);
    return item;
  }
}

const report = {
  title: "THE BACKYARD — OWNER REVIEW CATCH-UP FINAL — Browser Evidence",
  origin,
  finalSha: expectedSha || null,
  generatedAt: new Date().toISOString(),
  status: "RUNNING",
  realAuthRequested: useRealAuth,
  realAuthUsed: false,
  expectedEvidence,
  captures: [],
  failures: [],
  pending: [],
  consoleErrors: [],
  blockedWrites: [],
};

async function withSession(client, label, options, task) {
  const session = new BrowserSession(client, options);
  try {
    await session.open();
    await task(session);
  } catch (error) {
    report.failures.push({ suite: label, message: error instanceof Error ? error.message : String(error) });
  } finally {
    report.consoleErrors.push(...session.errors.map((error) => ({ suite: label, ...error })));
    report.blockedWrites.push(...session.blockedWrites.map((request) => ({ suite: label, ...request })));
    await session.close();
  }
}

async function onboardingEvidence(client) {
  await withSession(client, "onboarding-home-club", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource({ onboardingStep: "course" }),
  }, async (session) => {
    await session.wait("document.body?.innerText.includes('Elige tu Home Club')", "Home Club onboarding");
    await session.capture("home-club-no-tee", {
      expected: ["Elige tu Home Club", "Campos cercanos", "Buscar otro campo", "Continuar: Handicap / Índice"],
      absent: ["Salida / tee inicial", "Ratings y tees por jugador"],
    });
  });

  await withSession(client, "onboarding-permissions", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource({ onboardingStep: "permissions", iphonePermissions: true }),
    iphone: true,
  }, async (session) => {
    await session.wait("document.body?.innerText.includes('Permisos de este dispositivo')", "permissions onboarding");
    await session.capture("permissions", {
      expected: ["Permisos de este dispositivo", "Permitir ubicación", "Cómo instalar The Backyard"],
      absent: ["Administrar ubicación", "Administrar notificaciones"],
      assertion: `(() => {
        const text = document.body?.innerText || '';
        const disabledPermission = [...document.querySelectorAll('button:disabled')].some(button => /ubicaci[oó]n|notificaciones/i.test(button.textContent || ''));
        return !disabledPermission && text.includes('pantalla de inicio');
      })()`,
    });
  });

  await withSession(client, "onboarding-bets", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource({ onboardingStep: "bets" }),
  }, async (session) => {
    await session.wait("document.body?.innerText.includes('Elegir apuestas habituales')", "betting preferences onboarding");
    await session.capture("bets-group", {
      expected: ["Selecciona tus apuestas habituales", "Apuestas de grupo / generales", "Unidades positivas y negativas"],
      absent: ["contra quién", "Participan"],
    });
    await session.scrollToText("Individuales / Personales");
    await session.capture("bets-personal", {
      expected: ["Individuales / Personales", "Nassau", "Dollar a Stroke"],
      absent: ["Unidades / Copas"],
    });
  });
}

async function appCoreEvidence(client) {
  await withSession(client, "home", {
    viewport: viewports.mobile390,
    fixture: syntheticFixtureSource(),
  }, async (session) => {
    await session.waitHome();
    await session.capture("home", { expected: ["Buen golf", "Owner QA", "Accesos rápidos", "Más de The Backyard"] });
  });

  await withSession(client, "play", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource(),
  }, async (session) => {
    await session.waitHome();
    await session.clickAria("Elegir cómo armar tu ronda");
    await session.wait("document.body?.innerText.includes('Configurar ronda completa')", "Play hub");
    await session.capture("play", { expected: ["Configurar ronda completa", "Ronda sin apuestas", "Subir score total"] });
  });

  await withSession(client, "active-round", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource({ activeRound: true }),
  }, async (session) => {
    await session.waitHome();
    await session.clickAria("Continuar ronda");
    await session.wait("document.querySelector('[data-game-screen=\"approved-compact-v1\"]') !== null", "active round game screen");
    await session.capture("active-round", { expected: ["Hoyo 3", "Score", "Putts", "Guardar y siguiente"] });
  });
}

async function profileSettingsEvidence(client) {
  await withSession(client, "profile-settings", {
    viewport: viewports.desktop,
    fixture: syntheticFixtureSource({ iphonePermissions: true }),
  }, async (session) => {
    await session.waitHome();
    await session.clickAria("Perfil");
    await session.wait("document.body?.innerText.includes('Mi Perfil')", "profile");
    await session.capture("profile", { expected: ["Mi Perfil", "Owner QA", "Home Club", "Mi equipo"] });

    await session.click("Preferencias");
    await session.wait("document.querySelector('[data-settings-section=\"preferences\"]') !== null", "preferences settings");
    await session.capture("preferences", {
      expected: ["Preferencias", "Alto contraste", "Yardas", "Metros", "Inglés — Próximamente"],
      assertion: "document.querySelector('[aria-label=\"Idioma\"] option[value=\"en\"]')?.disabled === true",
    });

    await session.click("Notificaciones", { exact: true });
    await session.wait("document.querySelector('[data-settings-section=\"notifications\"]') !== null", "notification settings");
    await session.capture("notifications", {
      expected: ["Notificaciones", "Social", "Push", "Email", "Rondas", "Recordatorios", "todavía no está activado"],
      absent: ["Administrar notificaciones"],
    });

    await session.click("Privacidad y permisos", { exact: true });
    await session.wait("document.querySelector('[data-settings-section=\"privacy\"]') !== null", "privacy settings");
    await session.capture("privacy", {
      expected: ["Privacidad y permisos", "Privacidad / IA", "Legal"],
      absent: ["Administrar ubicación"],
    });
  });
}

async function supportAndSocialEvidence(client) {
  await withSession(client, "support-social-rules", {
    viewport: viewports.desktop,
    fixture: syntheticFixtureSource(),
  }, async (session) => {
    await session.waitHome();
    await session.clickAria("Más");
    await session.wait("document.body?.innerText.includes('Tu equipo y herramientas de golf')", "More hub");
    await session.click("Ayuda y feedback");
    await session.wait("document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Ayuda y feedback')", "feedback dialog");
    await session.capture("feedback", {
      expected: ["Ayuda y feedback", "Campo", "Bastón", "Bola", "Varilla", "Apuesta", "Bug", "Sugerencia", "Enviar solicitud", "Cancelar"],
      exitRequired: true,
    });
    await session.click("Cancelar", { exact: true });
    await session.wait("!document.querySelector('[role=\"dialog\"]')", "feedback dialog closed");

    await session.click("Mi QR");
    await session.wait("document.body?.innerText.includes('Tu tarjeta. Tu comunidad.') && ![...document.querySelectorAll('button')].find(node => node.textContent?.includes('Copiar enlace'))?.disabled", "personal QR");
    await session.click("Copiar enlace de perfil", { exact: true });
    await session.wait("typeof window.__ownerQaClipboard === 'string'", "copied stable QR link");
    await session.capture("qr", {
      expected: ["Mi QR", "Tu tarjeta. Tu comunidad.", "Comparte tu perfil, no tus datos privados", "Enlace copiado"],
      assertion: `(() => {
        const copied = window.__ownerQaClipboard || '';
        return copied.includes('friend=00000000-0000-4000-8000-000000000022')
          && !copied.includes('owner_qa')
          && !copied.includes('.vercel.app');
      })()`,
    });

    await session.clickAria("Más");
    await session.wait("document.body?.innerText.includes('Tu equipo y herramientas de golf')", "More hub after QR");
    await session.click("Reglas de golf");
    await session.wait("document.body?.innerText.includes('Reglas de Golf')", "Rules");
    await session.capture("rules", { expected: ["Reglas de Golf"] });
  });
}

async function selectSearchResult(session, label, query, optionText) {
  await session.fill(label, query);
  await session.wait(`([...document.querySelectorAll('[role="option"]')].some(node => (node.textContent || '').toLocaleLowerCase('en-US').includes(${JSON.stringify(optionText.toLocaleLowerCase("en-US"))})))`, `${optionText} search result`, 30_000);
  await session.click(optionText, { selector: "[role=option]" });
}

async function equipmentEvidence(client) {
  await withSession(client, "equipment", {
    viewport: viewports.mobile430,
    fixture: syntheticFixtureSource({ equipment: true }),
    dataMode: "controlled-local-fixture:real-catalog-navigation",
  }, async (session) => {
    await session.waitHome();
    await session.clickAria("Más");
    await session.wait("document.body?.innerText.includes('Tu equipo y herramientas de golf')", "More hub for equipment");
    await session.click("Mi Bolsa");
    await session.wait("document.body?.innerText.includes('Tu juego empieza') && document.body?.innerText.includes('Mi bolsa')", "My Bag");
    await session.capture("my-bag", {
      expected: ["Mi bolsa", "Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter", "Bola"],
    });

    await session.click("+ Agregar", { exact: true });
    await session.wait("document.body?.innerText.includes('Selecciona categoría')", "equipment category");
    await session.capture("equipment-category", {
      expected: ["Selecciona categoría", "Driver", "Maderas", "Híbridos", "Hierros", "Wedges", "Putter", "Bola"],
      assertion: `(() => {
        const text = document.body?.innerText || '';
        return text.includes('←') || [...document.querySelectorAll('button')].some(button => /cancelar|cerrar/i.test(button.textContent || ''));
      })()`,
    });

    await session.click("Driver");
    await session.wait("document.body?.innerText.includes('Selecciona marca')", "driver brand");
    await selectSearchResult(session, "Buscar marca", "Callaway", "Callaway");
    await session.wait("document.body?.innerText.includes('Selecciona modelo')", "driver model");
    await selectSearchResult(session, "Buscar modelo", "Big Bertha Alpha", "Big Bertha Alpha");
    await session.wait("document.body?.innerText.includes('Driver · especificaciones')", "driver generation and year");
    await session.capture("driver-generation-year", {
      expected: ["Generación", "Año", "Mano", "Precargada desde tu perfil"],
      assertion: `(() => {
        const facts = document.querySelector('[aria-label="Generación verificada del modelo"]');
        const hand = [...document.querySelectorAll('label')].find(label => (label.textContent || '').includes('Mano'))?.querySelector('select');
        return Boolean(facts) && !facts.querySelector('input') && hand?.value === 'RH';
      })()`,
    });

    await session.click("Elegir varilla", { exact: true });
    await session.wait("document.body?.innerText.includes('Selecciona varilla')", "shaft picker");
    await selectSearchResult(session, "Buscar varilla por marca", "Fujikura", "Fujikura");
    await selectSearchResult(session, "Buscar modelo / peso / flex", "VENTUS Blue", "VENTUS Blue");
    await session.wait("document.body?.innerText.includes('Revisa y agrega')", "structured shaft options");
    await session.capture("shaft-options", {
      expected: ["Revisa y agrega", "Flex", "Peso", "Uso", "Launch", "Spin", "Torque", "Tip", "Butt"],
      assertion: `(() => {
        const text = document.body?.innerText || '';
        const structured = [...document.querySelectorAll('label')].filter(label => /Flex|Peso de varilla/.test(label.textContent || '') && label.querySelector('select'));
        return structured.length >= 2 && text.includes('Agregar especificación manual') === false;
      })()`,
    });

    await session.click("Cancelar", { exact: true });
    await session.wait("document.body?.innerText.includes('Mi bolsa') && !document.body?.innerText.includes('Revisa y agrega')", "return to My Bag");
    await session.click("+ Agregar", { exact: true });
    await session.wait("document.body?.innerText.includes('Selecciona categoría')", "new wedge category");
    await session.click("Wedges");
    await session.wait("document.body?.innerText.includes('Selecciona marca')", "wedge brand");
    await selectSearchResult(session, "Buscar marca", "Titleist", "Titleist");
    await session.wait("document.body?.innerText.includes('Selecciona modelo')", "wedge model");
    await selectSearchResult(session, "Buscar modelo", "SM10", "SM10");
    await session.wait("document.body?.innerText.includes('Wedges · especificaciones')", "wedge lofts");
    await session.capture("wedge-degrees", {
      expected: ["Wedges · especificaciones", "Loft / grados", "Sólo grados disponibles"],
      assertion: `(() => {
        const label = [...document.querySelectorAll('label')].find(node => (node.textContent || '').includes('Loft / grados'));
        return Boolean(label?.querySelector('select')) && label.querySelectorAll('option').length > 1;
      })()`,
    });
  });
}

async function realAuthEvidence(client, realAuth) {
  if (!realAuth) {
    report.pending.push({
      state: "PENDING_INTERACTIVE_QA",
      evidence: ["add-user-qr", "user-found"],
      reason: "Run with --real-auth plus isolated QA env and two existing social-play fixtures.",
    });
    return;
  }
  report.realAuthUsed = true;
  await withSession(client, "real-auth-user-search", {
    viewport: viewports.mobile430,
    fixture: realAuthFixtureSource(realAuth),
    dataMode: "existing-qa-read-only",
  }, async (session) => {
    await session.waitHome(60_000);
    await session.click("Grupos");
    await session.wait("document.body?.innerText.includes('Guarda jugadores y apuestas habituales')", "Groups library", 30_000);
    await session.click("Crear grupo", { exact: true });
    await session.wait("document.querySelector('[role=\"dialog\"]')?.textContent?.includes('Usuario Backyard')", "group editor with Backyard users", 30_000);
    await session.fill("Nombre del grupo", "Owner QA evidence");
    await session.capture("add-user-qr", {
      expected: ["Usuario Backyard", "Buscar usuarios", "Escanear QR"],
      absent: ["Revisar Información de golf"],
      exitRequired: true,
      assertion: `(() => {
        const input = [...document.querySelectorAll('input')].find(node => node.placeholder?.includes('Nombre, @usuario'));
        return input?.getAttribute('autocorrect') === 'off'
          && input?.getAttribute('autocapitalize') === 'none'
          && input?.spellcheck === false
          && input?.inputMode === 'search';
      })()`,
    });

    await session.click("Escanear QR", { exact: true });
    await session.wait("document.body?.innerText.includes('Elegir imagen de la galería')", "same-screen QR scanner entry");
    await session.capture("add-user-qr-scanner", {
      expected: ["Escanear QR", "Usar cámara", "Elegir imagen de la galería", "Mostraremos el perfil"],
      exitRequired: true,
    });
    await session.click("Usuarios Backyard");
    await session.wait("!document.body?.innerText.includes('Elegir imagen de la galería')", "close same-screen QR scanner");

    const targetQuery = `@${realAuth.target.username}`;
    await session.fill("Buscar usuarios", targetQuery);
    await session.wait(`([...document.querySelectorAll('li')].some(node => (node.textContent || '').toLocaleLowerCase('es-MX').includes(${JSON.stringify(`@${realAuth.target.username}`.toLocaleLowerCase("es-MX"))})))`, "A finds B by @username", 30_000);
    await session.capture("user-found", {
      expected: [`@${realAuth.target.username}`, "Invitar"],
      absent: ["Revisar Información de golf"],
      exitRequired: true,
      assertion: `([...document.querySelectorAll('li')].some(node => (node.textContent || '').toLocaleLowerCase('es-MX').includes(${JSON.stringify(realAuth.target.username.toLocaleLowerCase("es-MX"))})))`,
    });
    // Deliberately do not click Invitar or Guardar.
  });
}

let outputAlreadyExists = false;
try { await access(outputDirectory); outputAlreadyExists = true; } catch { /* A new evidence directory is required. */ }
assert.equal(outputAlreadyExists, false, `Evidence directory already exists; choose a new FINAL_SHA-specific path: ${outputDirectory}`);
await mkdir(outputDirectory, { recursive: true });
const userDataDirectory = await mkdtemp(path.join(os.tmpdir(), "backyard-owner-review-"));
const port = await unusedPort();
const keepAlive = setInterval(() => {}, 1_000);
let chrome;
try {
  let chromePath = null;
  for (const candidate of chromeCandidates) {
    try { await access(candidate); chromePath = candidate; break; } catch { /* Try the next installed browser. */ }
  }
  assert.ok(chromePath, "Set CHROME_PATH to a Chrome executable.");
  chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-breakpad",
    "--disable-crash-reporter",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-allow-origins=*",
    `--crash-dumps-dir=${userDataDirectory}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDirectory}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
  let chromeStderr = "";
  const chromeLaunch = new Promise((_, reject) => chrome.once("error", reject));
  chrome.stderr?.on("data", (chunk) => { chromeStderr += String(chunk); });
  chrome.once("exit", (code) => {
    if (code && chromeStderr.trim()) process.stderr.write(chromeStderr);
  });
  const version = await Promise.race([waitForJson(`http://127.0.0.1:${port}/json/version`), chromeLaunch]);
  const client = new CdpClient(version.webSocketDebuggerUrl);
  const realAuth = await authenticateExistingQaAccounts().catch((error) => {
    report.failures.push({ suite: "real-auth-setup", message: error instanceof Error ? error.message : String(error) });
    return null;
  });

  await onboardingEvidence(client);
  await appCoreEvidence(client);
  await profileSettingsEvidence(client);
  await supportAndSocialEvidence(client);
  await equipmentEvidence(client);
  await realAuthEvidence(client, realAuth);
  client.close();

  const capturedNames = new Set(report.captures.map((capture) => capture.name));
  const pendingNames = new Set(report.pending.flatMap((entry) => entry.evidence || []));
  const missing = expectedEvidence.filter((name) => !capturedNames.has(name) && !pendingNames.has(name));
  if (missing.length) report.failures.push({ suite: "evidence-completeness", message: `Missing evidence: ${missing.join(", ")}` });
  const viewportWidths = new Set(report.captures.map((capture) => capture.viewport.width));
  for (const width of [390, 430, 1280]) {
    if (!viewportWidths.has(width)) report.failures.push({ suite: "viewport-matrix", message: `No evidence captured at ${width}px.` });
  }
  if (report.consoleErrors.length) report.failures.push({ suite: "runtime-errors", message: `${report.consoleErrors.length} browser console/runtime error(s) collected.` });
  if (report.blockedWrites.length) report.failures.push({ suite: "read-only-guard", message: `${report.blockedWrites.length} unexpected browser write request(s) were blocked.` });

  report.status = report.failures.length ? "FAIL" : report.pending.length ? "PENDING_INTERACTIVE_QA" : "PASS";
  const manifestPath = path.join(outputDirectory, "owner-review-browser-evidence.json");
  await writeFile(manifestPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const output = {
    origin: report.origin,
    status: report.status,
    manifest: manifestPath,
    captures: report.captures.map(({ name, file, sha256, viewport, horizontalOverflow, modalExitVerified }) => ({ name, file, sha256, viewport, horizontalOverflow, modalExitVerified })),
    failures: report.failures,
    pending: report.pending,
    consoleErrorCount: report.consoleErrors.length,
    blockedWriteCount: report.blockedWrites.length,
    realAuthUsed: report.realAuthUsed,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  if (report.status === "FAIL" || (strict && report.status !== "PASS")) process.exitCode = 1;
} finally {
  if (chrome?.exitCode === null) {
    chrome.kill();
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), delay(5_000)]);
  }
  await rm(userDataDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  clearInterval(keepAlive);
}
