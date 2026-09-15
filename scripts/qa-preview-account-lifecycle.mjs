import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { previewStatisticsConfig, credentialBoundFetch, verifyPreviewBundleBinding } from "./qa-preview-statistics.mjs";

/** Same exact-origin, immutable deployment and non-shared DB safety boundary as
 * statistics QA. No existing user IDs or emails can be supplied to this runner. */
export const previewAccountConfig = previewStatisticsConfig;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function checked(result, label) {
  if (result.error) throw new Error(`${label} failed${result.error.status ? ` (HTTP ${result.error.status})` : ""}.`);
  return result.data;
}
function step(condition, label) { if (!condition) throw new Error(`QA assertion failed: ${label}.`); }
async function jsonResponse(response) {
  if (!response.body) throw new Error("Preview API returned an empty response.");
  const reader = response.body.getReader(); const chunks = []; let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      bytes += value.length;
      if (bytes > 2_000_000) throw new Error("Preview API exceeded the bounded QA response limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new Error("Preview API response was not JSON."); }
}

/** Synthetic, explicitly labelled fixtures: these are never claims about a real
 * course, tee, score, player or achievement. They belong only to this run. */
function fixtureRound(owner, other, id) {
  const at = new Date().toISOString();
  const players = [owner, ...(other ? [other] : [])].map(account => ({ id: `qa-player-${account.id}`,
    accountUserId: account.id, name: account.displayName, handicap: 0, avatarUrl: null }));
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  return { id, lifecycleState: "completed", date: at.slice(0, 10), completedAt: at, startedAt: at,
    ownerId: players[0].id, ownerName: owner.displayName, accountUserId: owner.id,
    courseName: "QA synthetic course — not a real course", teeName: "QA unverified tee", roundHoles: 18,
    courseSnapshot: { id: `qa-course-${id}`, name: "QA synthetic course — not a real course", teeName: "QA unverified tee", holes },
    players, order: holes.map(h => h.number),
    scores: Object.fromEntries(holes.map(h => [h.number, Object.fromEntries(players.map(p => [p.id, 4]))])),
    putts: Object.fromEntries(holes.map(h => [h.number, Object.fromEntries(players.map(p => [p.id, 2]))])),
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, betResult: 0, netResult: 0, categoryResults: {} };
}

/** Executes real API/Auth/RLS checks only when called explicitly. The retained
 * archive fixture is intentional: deleting it would defeat the retain-history
 * choice under test. Its exact fresh QA ID is reported, never a broad cleanup. */
export async function runPreviewAccountQA(env = process.env, { fetcher = fetch, clientFactory = createClient, log = console.log } = {}) {
  const config = previewAccountConfig(env);
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher);
  await verifyPreviewBundleBinding(config, appFetch);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: credentialBoundFetch(config.supabaseOrigin, fetcher) } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options);
  const runId = randomUUID(), attempts = [], passed = [], retainedIds = [], archivedFixtures = [];
  let stage = "EMPTY_ACCOUNT", diagnostic = null, failed = false;

  async function app(path, account, method = "GET", body, expected = [200], token = account?.token) {
    const response = await appFetch(`${config.previewOrigin}${path}`, { method, cache: "no-store",
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const data = await jsonResponse(response);
    if (!expected.includes(response.status)) {
      diagnostic = { path, status: response.status,
        code: typeof data?.code === "string" && /^[A-Z0-9_]{1,64}$/.test(data.code) ? data.code : "UNEXPECTED_RESPONSE" };
      throw new Error("Preview returned an unexpected API status.");
    }
    return data;
  }
  async function ownedAccount(account) {
    const result = await admin.auth.admin.getUserById(account.id);
    if (result.error?.status === 404 || result.error?.code === "user_not_found") return null;
    const user = checked(result, "Read QA Auth identity").user;
    if (!user) return null;
    step(user.id === account.id && user.email === account.email && user.app_metadata?.qa_run_id === runId,
      "exact fresh QA identity and run marker");
    return user;
  }
  async function newAccount(label) {
    const account = { id: randomUUID(), email: `backyard-qa-account-${label}-${runId}@example.invalid`,
      displayName: `Lifecycle QA ${label}`, password: `Qa!${randomBytes(32).toString("base64url")}`,
      client: null, token: null, operation: null, touched: false, archived: false };
    attempts.push(account); // Also covers an ambiguous Auth-create timeout.
    const created = checked(await admin.auth.admin.createUser({ id: account.id, email: account.email, password: account.password,
      email_confirm: true, app_metadata: { qa_run_id: runId }, user_metadata: { display_name: account.displayName } }), "Create disposable QA Auth user");
    step(created.user?.id === account.id, "new Auth identity");
    account.client = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const login = checked(await account.client.auth.signInWithPassword({ email: account.email, password: account.password }), "QA login");
    step(login.user?.id === account.id && login.session?.access_token, "QA session identity");
    account.token = login.session.access_token;
    return account;
  }
  function operation(account, policy) {
    if (account.operation) { step(account.operation.dataPolicy === policy, "never change a lifecycle request policy"); return account.operation; }
    account.operation = { confirmation: "ELIMINAR", dataPolicy: policy, requestId: randomUUID(), recoveryToken: randomBytes(32).toString("hex") };
    return account.operation;
  }
  async function close(account, policy) {
    const body = operation(account, policy);
    const result = await app("/api/account/delete", account, "DELETE", body);
    step(result.ok === true && result.deleted === (policy === "delete_golf_data") && result.archived === (policy === "retain_history"), "confirmed lifecycle result");
    return result;
  }
  async function noLogin(account) {
    const fresh = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const login = await fresh.auth.signInWithPassword({ email: account.email, password: account.password });
    step(Boolean(login.error) && !login.data?.session, "closed account cannot login normally");
  }
  async function saveRound(account, round) {
    account.touched = true;
    const result = await app("/api/cloud/rounds", account, "POST", { round }, [201]);
    step(typeof result.roundId === "string" && UUID.test(result.roundId), "server-generated round ID");
    return result.roundId;
  }
  async function readRound(client, id) {
    return checked(await client.from("rounds_cloud").select("id,owner_id,snapshot").eq("id", id).single(), "Read exact QA round");
  }
  try {
    const empty = await newAccount("empty");
    await app("/api/account/delete", empty, "DELETE", { confirmation: "eliminar", dataPolicy: "delete_golf_data", requestId: randomUUID() }, [400]);
    step(await ownedAccount(empty), "invalid confirmation leaves account intact");
    await app("/api/account/delete", empty, "DELETE", { confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: randomUUID(), userId: randomUUID() }, [400]);
    await close(empty, "delete_golf_data");
    step((await ownedAccount(empty)) === null, "Auth user really deleted");
    await noLogin(empty);
    passed.push("ACCOUNT_DELETE_EMPTY", "ACCOUNT_DELETE_AUTH", "NO_ARBITRARY_USER_ID");
    // Same proof/request succeeds after Auth removal; it does not start a new job.
    const retry = await app("/api/account/delete", empty, "DELETE", empty.operation, [200], null);
    step(retry.deleted === true, "tokenless durable replay completes idempotently");
    await app("/api/account/delete", empty, "DELETE", { ...empty.operation, recoveryToken: randomBytes(32).toString("hex") }, [401], null);
    passed.push("ACCOUNT_DELETE_IDEMPOTENT", "RECOVERY_PROOF_REQUIRED");

    stage = "SHARED_ROUND";
    const owner = await newAccount("organizer"), peer = await newAccount("participant");
    const shared = fixtureRound(owner, peer, `qa-shared-${runId}`);
    const sharedId = await saveRound(owner, shared);
    // Real authenticated owner insert, checked by the existing participant RLS.
    checked(await owner.client.from("round_participants_v2").insert({ round_id: sharedId, user_id: peer.id,
      player_key: `qa-player-${peer.id}`, role: "PLAYER" }), "Link exact QA participant");
    const personal = fixtureRound(peer, owner, `qa-peer-copy-${runId}`);
    const personalId = await saveRound(peer, personal);
    assert.deepEqual((await readRound(peer.client, sharedId)).snapshot.scores, shared.scores);
    await close(owner, "delete_golf_data");
    step((await ownedAccount(owner)) === null, "organizer Auth deleted");
    const preserved = await readRound(peer.client, sharedId);
    step(preserved.owner_id === null && preserved.snapshot.ownerName === "Jugador eliminado", "shared organizer anonymized");
    assert.deepEqual(preserved.snapshot.scores, shared.scores);
    const deletedPlayer = preserved.snapshot.players.find(p => p.id === `qa-player-${owner.id}`);
    step(deletedPlayer?.name === "Jugador eliminado" && !deletedPlayer.accountUserId && !deletedPlayer.avatarUrl, "deleted participant identity scrubbed");
    const peerPlayer = preserved.snapshot.players.find(p => p.accountUserId === peer.id);
    step(peerPlayer?.name === peer.displayName, "other participant identity preserved");
    passed.push("ACCOUNT_DELETE_SHARED_ROUND_INTEGRITY", "SHARED_ROUND_PARTICIPANT_RLS");
    // An old browser tab must not resurrect deleted PII through its own copy.
    checked(await peer.client.from("rounds_cloud").update({ snapshot: personal }).eq("id", personalId).eq("owner_id", peer.id), "Resend own stale QA snapshot");
    const restored = await readRound(peer.client, personalId);
    step(restored.snapshot.players.find(p => p.id === `qa-player-${owner.id}`)?.name === "Jugador eliminado", "stale sync cannot resurrect identity");
    assert.deepEqual(restored.snapshot.scores, personal.scores);
    passed.push("DELETED_IDENTITY_STAYS_ANONYMIZED");

    stage = "ARCHIVE_ACCOUNT";
    const beforeArchive = [await readRound(admin, sharedId), await readRound(admin, personalId)];
    await close(peer, "retain_history");
    peer.archived = true;
    const archivedUser = await ownedAccount(peer);
    step(archivedUser && Date.parse(archivedUser.banned_until || "") > Date.now(), "Auth account retained and banned");
    await noLogin(peer);
    await app("/api/equipment", peer, "GET", undefined, [401, 403]);
    const blocked = await peer.client.from("rounds_cloud").select("id").eq("id", personalId);
    step(Boolean(blocked.error) && ["42501", "PGRST301", "PGRST303"].includes(blocked.error.code), "stale JWT cannot access archived data");
    assert.deepEqual([await readRound(admin, sharedId), await readRound(admin, personalId)], beforeArchive);
    const replay = await app("/api/account/delete", peer, "DELETE", peer.operation, [200], null);
    step(replay.archived === true && replay.deleted === false, "archive replay cannot become deletion");
    archivedFixtures.push({ userId: peer.id, roundIds: [sharedId, personalId] });
    passed.push("ACCOUNT_ARCHIVE_KEEP_HISTORY", "ACCOUNT_ARCHIVE_AUTH_BLOCKED", "ACCOUNT_ARCHIVE_STALE_JWT_BLOCKED");
  } catch { failed = true; }
  finally {
    for (const account of attempts) {
      try {
        const user = await ownedAccount(account); if (!user) continue;
        // Retain archives deliberately. Never bypass the chosen policy with
        // Auth Admin deletion, unban, private-schema mutation or broad deletes.
        if (account.operation?.dataPolicy === "retain_history") {
          if (!archivedFixtures.some(item => item.userId === account.id)) retainedIds.push(account.id);
          continue;
        }
        if (account.token) {
          await close(account, "delete_golf_data");
          step((await ownedAccount(account)) === null, "cleanup Auth absence");
        } else {
          step(!account.touched, "no application writes before direct fresh Auth cleanup");
          checked(await admin.auth.admin.deleteUser(account.id), "Remove unused fresh QA Auth user");
          step((await ownedAccount(account)) === null, "unused QA Auth cleanup verified");
        }
      } catch { retainedIds.push(account.id); }
    }
  }
  log(JSON.stringify({ preview: config.previewOrigin, projectRef: config.projectRef, runId, passed,
    ...(failed ? { failedAt: stage, diagnostic } : {}),
    cleanup: retainedIds.length ? "QA_CLEANUP_PENDING" : archivedFixtures.length ? "ONLY_INTENTIONAL_ARCHIVE_FIXTURE_RETAINED" : "COMPLETE",
    retainedQaUserIds: retainedIds, archivedQaFixtures: archivedFixtures, legalReview: "LEGAL_REVIEW_REQUIRED",
    coverageExcludes: ["Social API likes/comments/attest", "Storage uploads", "Group ownership", "Browser visual QA"] }));
  if (failed) throw new Error(`Remote account QA failed at ${stage}. Run ID: ${runId}. Provider bodies, credentials and recovery proofs were not logged.`);
  if (retainedIds.length) throw new Error("Account checks completed but exact reported disposable QA accounts still require cleanup.");
  return { passed, retainedQaUserIds: retainedIds, archivedQaFixtures: archivedFixtures };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log([
        "Isolated Preview account lifecycle QA. Creates three disposable accounts; intentionally retains one archived QA fixture.",
        "Uses the same environment/safety checks as qa-preview-statistics.mjs:",
        "PREVIEW_QA_URL: exact immutable golf-bets-<9-char-id>-<scope>.vercel.app deployment.",
        "PREVIEW_DB_REF + QA_CONFIRM_ISOLATED_PREVIEW: same verified isolated project, never shared/Production.",
        "NEXT_PUBLIC_SUPABASE_URL + matching Preview publishable/anon and secret/service-role keys.",
        "Optional VERCEL_AUTOMATION_BYPASS_SECRET; sent only to the exact Preview origin.",
        "Offline validation: node scripts/qa-preview-account-lifecycle.mjs --check-config",
        "Explicit execution: node scripts/qa-preview-account-lifecycle.mjs --run",
        "Coverage: real Auth delete, shared history/RLS/anonymization, retry/proof, archive/Auth ban/stale JWT.",
        "Does not claim Social API or browser coverage. Do not broad-delete the reported QA fixtures.",
      ].join("\n"));
    } else if (args.length === 1 && args[0] === "--check-config") {
      const config = previewAccountConfig();
      console.log(JSON.stringify({ configuration: "VALID", network: "NOT_RUN", preview: config.previewOrigin, projectRef: config.projectRef }));
    } else if (args.length === 1 && args[0] === "--run") await runPreviewAccountQA();
    else throw new Error("Use --help, --check-config or --run; no network request was made.");
  } catch (error) { console.error(error instanceof Error ? error.message : "Account Preview QA failed."); process.exitCode = 1; }
}
