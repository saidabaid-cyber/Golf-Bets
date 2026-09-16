import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { credentialBoundFetch, previewStatisticsConfig, verifyPreviewBundleBinding } from "./qa-preview-statistics.mjs";

const QA_REF = "bymeopxkxapfizeeqeyb";
const require = createRequire(import.meta.url);

export function profileCloudQaConfig(env = process.env) {
  const config = previewStatisticsConfig(env);
  assert.equal(config.projectRef, QA_REF, "This runner is authorized only for the existing Phase 2 QA branch.");
  return config;
}

function checked(result, label) {
  if (result.error) throw new Error(`${label} failed (${String(result.error.code || result.error.status || "unknown").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 40)}).`);
  return result.data;
}

function denied(result, label) {
  if (result.error) {
    assert.ok(["42501", "PGRST301"].includes(result.error.code), `${label}: unexpected database error, not an authorization proof`);
  } else assert.deepEqual(result.data, [], `${label}: no foreign row may be returned or changed`);
}

function privateRound(account, runId) {
  const holes = Array.from({ length: 18 }, (_, i) => ({ number: i + 1, par: 4, strokeIndex: i + 1 }));
  const playerId = `qa-${account.id}`;
  const now = new Date().toISOString();
  return { id: `qa-cloud-${account.id}-${runId}`, lifecycleState: "completed", date: now.slice(0, 10),
    completedAt: now, startedAt: now, accountUserId: account.id, ownerId: playerId, ownerName: account.name,
    courseName: "QA synthetic course — not a real course", teeName: "QA unverified tee", roundHoles: 18,
    courseSnapshot: { id: `qa-${runId}`, name: "QA synthetic course — not a real course", teeName: "QA unverified tee", holes },
    players: [{ id: playerId, accountUserId: account.id, name: account.name, handicap: 0 }],
    order: holes.map(hole => hole.number), scores: Object.fromEntries(holes.map(hole => [hole.number, { [playerId]: 4 }])),
    putts: Object.fromEntries(holes.map(hole => [hole.number, { [playerId]: 2 }])),
    expenses: { caddie: 0, food: 0, drinks: 0, greenFee: 0, cartRental: 0, other: 0 },
    expenseTotal: 0, betResult: 0, netResult: 0, categoryResults: {} };
}

/** Published Preview APIs + actual authenticated Supabase HTTP, never localStorage.
 * This is not a browser/UI or external Google/SMTP delivery test. */
export async function runPreviewProfileCloudQA(env = process.env, { fetcher = fetch, clientFactory = createClient, log = console.log } = {}) {
  const config = profileCloudQaConfig(env);
  let domain;
  try {
    domain = { ...require("../.test-dist/lib/cloud-account.js"), ...require("../.test-dist/lib/profile-location-sync.js"),
      ...require("../.test-dist/lib/profile-geography.js"), ...require("../.test-dist/lib/backyard-index-preferences.js"),
      ...require("../.test-dist/lib/golf-equipment.js"), ...require("../.test-dist/lib/backyard-ai/privacy.js") };
  } catch { throw new Error("Compile current app logic first: node node_modules/typescript/bin/tsc -p tsconfig.test.json"); }
  const databaseFetch = credentialBoundFetch(config.supabaseOrigin, fetcher);
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher);
  // No Auth user or mutable fixture exists before this proof.
  await verifyPreviewBundleBinding(config, appFetch);
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: databaseFetch } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options);
  const runId = randomUUID();
  const accounts = [];
  const passed = [];
  const retained = [];
  let stage = "CREATE_FRESH_QA_ACCOUNTS";
  let diagnostic = null;
  let failure = null;

  async function app(path, account, method = "GET", body, expected = 200) {
    const response = await appFetch(`${config.previewOrigin}${path}`, { method, cache: "no-store",
      headers: { ...(account?.token ? { authorization: `Bearer ${account.token}` } : {}), "content-type": "application/json",
        ...(config.bypass ? { "x-vercel-protection-bypass": config.bypass } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const raw = await response.text();
    assert.ok(raw.length < 2_000_000, "bounded API response");
    let data;
    try { data = JSON.parse(raw); } catch { throw new Error(`Non-JSON Preview response: ${path}`); }
    if (response.status !== expected) {
      diagnostic = { path, status: response.status, expected,
        code: typeof data?.code === "string" && /^[A-Za-z0-9_]{1,64}$/.test(data.code) ? data.code : "UNEXPECTED_RESPONSE" };
      throw new Error(`Unexpected Preview status for ${path}`);
    }
    return data;
  }

  async function login(account) {
    const client = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const data = checked(await client.auth.signInWithPassword({ email: account.email, password: account.password }), "Fresh password login");
    assert.equal(data.user?.id, account.id);
    assert.ok(data.session?.access_token, "verified session token");
    account.token = data.session.access_token;
    account.client = client;
    return client;
  }

  async function createAccount(label) {
    const account = { id: randomUUID(), email: `backyard-qa-cloud-${label}-${runId}@example.invalid`,
      password: `Qa!${randomBytes(32).toString("base64url")}`, name: `Cloud QA ${label}`, token: null, client: null,
      username: `qa_${label}_${runId.replaceAll("-", "").slice(0, 20)}` };
    accounts.push(account); // Retain ID for ambiguous create failures; cleanup still requires ownership proof.
    const created = checked(await admin.auth.admin.createUser({ id: account.id, email: account.email,
      password: account.password, email_confirm: true, app_metadata: { qa_run_id: runId },
      user_metadata: { display_name: account.name } }), "Create run-owned synthetic Auth account");
    assert.equal(created.user?.id, account.id);
    await login(account);
    return account;
  }

  async function verifyPersisted(account) {
    const profile = checked(await account.client.from("profiles").select("id,display_name,onboarding_completed_at").eq("id", account.id).single(), "Read own profile");
    assert.equal(profile.display_name, account.name);
    assert.ok(profile.onboarding_completed_at);
    const location = await domain.readProfileLocationMetadata(account.client, account.id);
    assert.equal(location?.countryCode, "MX");
    assert.equal(location?.country, "México");
    assert.equal(location?.stateCode, "MX-PUE");
    assert.equal(location?.state, "Puebla");
    assert.equal(domain.validateProfileLocation(location).valid, true);
    const index = await domain.readCloudIndexPreference(account.client, account.id);
    assert.equal(index?.enabled, true);
    assert.equal(index?.handicapSource, "BACKYARD");
    const equipment = await app("/api/equipment", account);
    assert.deepEqual(equipment.data?.profile, account.equipment);
    assert.equal((await app("/api/account/privacy", account)).visibility, account.visibility);
    const consent = await app("/api/backyard-ai/consent", account);
    assert.equal(consent.resolved, true);
    const instructions = consent.decisions.find(item => item.scope === domain.AI_PROVIDER_PROCESSING_CONSENT);
    const image = consent.decisions.find(item => item.scope === domain.AI_IMAGE_PROCESSING_CONSENT);
    assert.equal(instructions?.active, true);
    assert.equal(instructions?.source, "onboarding");
    assert.equal(image?.active, false);
    assert.equal(image?.status, "declined");
    assert.equal(consent.policyVersion, domain.BACKYARD_AI_PROVIDER_CONSENT_VERSION);
    const history = await app("/api/cloud/rounds", account);
    assert.equal(history.rounds?.some(item => item.id === account.round.id), true);
    assert.equal((await app("/api/account/entry", account)).existingAccount, true);
  }

  try {
    const a = await createAccount("a");
    const b = await createAccount("b");
    passed.push("EMAIL_PASSWORD_AUTH_TWO_SYNTHETIC_USERS");

    stage = "PROFILE_LOCATION_INDEX_EQUIPMENT_SETUP";
    for (const account of accounts) {
      const entry = await app("/api/account/entry", account);
      assert.equal(entry.userId, account.id);
      assert.equal(entry.existingAccount, false);
      const now = new Date().toISOString();
      const location = { countryCode: "MX", country: "México", stateCode: "MX-PUE", state: "Puebla" };
      assert.equal(domain.validateProfileLocation(location).valid, true);
      assert.equal(domain.searchProfileCountries("Mx").some(item => item.code === "MX"), true);
      assert.equal(domain.searchProfileSubdivisions("MX", "Pue").some(item => item.code === "MX-PUE"), true);
      await domain.saveCloudProfile(account.client, account.id,
        { displayName: account.name, defaultHandicap: null, avatarUrl: "", location, locationUpdatedAt: now }, now,
        { rebaseOnServerClock: true });
      await domain.saveCloudIndexPreference(account.client,
        { version: 1, userId: account.id, enabled: true, handicapSource: "BACKYARD", localPccZeroDeclaredAt: now, updatedAt: now });
      const empty = domain.createEmptyEquipmentProfile(account.id, now);
      account.equipment = domain.upsertPlayerClub(empty, { id: `qa-driver-${account.id}`, userId: account.id,
        category: "DRIVER", customBrand: "QA synthetic", customModel: "QA driver", handedness: "RH",
        isCurrent: true, createdAt: now, updatedAt: now }, now);
      assert.ok(account.equipment?.clubs.length === 1, "valid canonical equipment fixture");
      const savedEquipment = await app("/api/equipment", account, "PUT",
        { profile: account.equipment, expectedVersion: null, mutationId: randomUUID(), deviceId: `qa-${runId}` });
      assert.deepEqual(savedEquipment.data?.profile, account.equipment);
      account.equipmentVersion = savedEquipment.data.version;
      checked(await account.client.from("social_profiles").update({ username: account.username, display_name: account.name })
        .eq("user_id", account.id).select("user_id").single(), "Prepare own directory identity");
      account.visibility = account === a ? "public" : "friends";
      assert.equal((await app("/api/account/privacy", account, "PATCH", { visibility: account.visibility })).visibility, account.visibility);
      account.round = privateRound(account, runId);
      await app("/api/cloud/rounds", account, "POST", { round: account.round }, 201);
      account.roundDb = checked(await admin.from("rounds_cloud").select("id,snapshot").eq("owner_id", account.id)
        .eq("local_round_id", account.round.id).single(), "Read created private round identity");
      const consent = await app("/api/backyard-ai/consent", account, "POST", { source: "onboarding", decisions: [
        { scope: domain.AI_PROVIDER_PROCESSING_CONSENT, accepted: true },
        { scope: domain.AI_IMAGE_PROCESSING_CONSENT, accepted: false },
        { scope: domain.AI_LAUNCH_MONITOR_PROCESSING_CONSENT, accepted: false },
      ] });
      assert.equal(consent.resolved, true);
      await verifyPersisted(account);
    }
    passed.push("MEXICO_PUEBLA_VALID_CLOUD_READBACK", "BACKYARD_INDEX_ACTIVATION_READBACK", "EQUIPMENT_CLOUD_READBACK",
      "CONSENT_ONBOARDING_ACCEPT_DECLINE", "PRIVACY_PUBLIC_FRIENDS_READBACK");

    stage = "FRESH_AUTH_SESSION_AND_LOGOUT_LOGIN";
    for (const account of accounts) {
      // No session, token, localStorage or client cache is reused by the new client.
      await login(account);
      await verifyPersisted(account);
      checked(await account.client.auth.signOut({ scope: "local" }), "Sign out QA session");
      await login(account);
      await verifyPersisted(account);
    }
    passed.push("CLOUD_PERSISTENCE_FRESH_AUTH_CLIENT", "CLOUD_PERSISTENCE_LOGOUT_LOGIN");

    stage = "ACCOUNT_MAPPING_AND_DEDUPE";
    for (const account of accounts) {
      const original = checked(await account.client.from("profiles").select("display_name,avatar_url,default_handicap").eq("id", account.id).single(), "Read canonical profile before dedupe");
      await Promise.all([1, 2].map(() => domain.ensureCloudProfile(account.client, account.id,
        { displayName: "Must not overwrite QA account", defaultHandicap: null, avatarUrl: "" })));
      const rows = checked(await account.client.from("profiles").select("id,display_name,avatar_url,default_handicap").eq("id", account.id), "Read deduplicated profiles");
      assert.equal(rows.length, 1);
      assert.deepEqual({ display_name: rows[0].display_name, avatar_url: rows[0].avatar_url, default_handicap: rows[0].default_handicap }, original);
      const mapping = await app("/api/account/entry", account);
      assert.equal(mapping.userId, account.id);
      assert.equal(mapping.profileExists, true);
      assert.equal(mapping.existingAccount, true);
      await app(`/api/account/entry?email=${encodeURIComponent(account.email)}`, account, "GET", undefined, 400);
    }
    await app("/api/account/entry", null, "GET", undefined, 401);
    passed.push("AUTHENTICATED_ACCOUNT_MAPPING", "PROFILE_DEDUPE_CONCURRENT_NO_OVERWRITE", "NO_PUBLIC_EMAIL_ENUMERATION");

    stage = "BIDIRECTIONAL_AUTHENTICATED_HTTP_RLS";
    for (const [actor, target] of [[a, b], [b, a]]) {
      denied(await actor.client.from("profiles").select("*").eq("id", target.id), "Private profile read");
      denied(await actor.client.from("profiles").update({ display_name: "Forbidden QA mutation" }).eq("id", target.id).select("id"), "Private profile update");
      denied(await actor.client.from("user_preferences").select("*").eq("user_id", target.id), "Preferences read");
      denied(await actor.client.from("user_preferences").update({ default_handicap: 30 }).eq("user_id", target.id).select("user_id"), "Preferences update");
      denied(await actor.client.from("player_equipment_profiles").select("*").eq("user_id", target.id), "Equipment read");
      denied(await actor.client.from("player_equipment_profiles").update({ snapshot: target.equipment }).eq("user_id", target.id).select("user_id"), "Equipment update");
      denied(await actor.client.from("ai_processing_consents").select("*").eq("user_id", target.id), "Consent read");
      denied(await actor.client.from("ai_processing_consents").update({ revoked_at: new Date().toISOString() }).eq("user_id", target.id).select("id"), "Consent update");
      denied(await actor.client.from("rounds_cloud").select("*").eq("id", target.roundDb.id), "Private round read");
      denied(await actor.client.from("rounds_cloud").update({ snapshot: { tampered: true } }).eq("id", target.roundDb.id).select("id"), "Private round update");
      await app("/api/account/privacy", actor, "PATCH", { visibility: "public", userId: target.id }, 400);
      await app("/api/backyard-ai/consent", actor, "POST", { scope: domain.AI_IMAGE_PROCESSING_CONSENT, userId: target.id }, 400);
      await app("/api/account/statistics", actor, "DELETE", { confirmation: "ELIMINAR", requestId: randomUUID(), userId: target.id }, 400);
      await app("/api/account/delete", actor, "DELETE", { confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: randomUUID(), userId: target.id }, 400);
      await verifyPersisted(target);
    }
    passed.push("RLS_TWO_USERS_REAL_HTTP", "CROSS_ACCOUNT_MUTATIONS_REJECTED");

    stage = "CONSENT_REVOKE_RELOAD_AND_SETTINGS_REAUTHORIZE";
    const revoked = await app("/api/backyard-ai/consent", a, "PATCH", { scope: domain.AI_PROVIDER_PROCESSING_CONSENT });
    assert.equal(revoked.active, false);
    assert.equal(revoked.status, "revoked");
    await login(a);
    const decision = await app(`/api/backyard-ai/consent?scope=${domain.AI_PROVIDER_PROCESSING_CONSENT}`, a);
    assert.equal(decision.active, false);
    assert.equal(decision.status, "revoked");
    assert.equal((await app("/api/account/entry", a)).existingAccount, true, "revocation must not block general access");
    const stale = await app("/api/backyard-ai/consent", a, "POST", { source: "onboarding", decisions: [{ scope: domain.AI_PROVIDER_PROCESSING_CONSENT, accepted: true }] });
    assert.equal(stale.decisions.find(item => item.scope === domain.AI_PROVIDER_PROCESSING_CONSENT)?.active, false);
    const authorized = await app("/api/backyard-ai/consent", a, "POST", { scope: domain.AI_PROVIDER_PROCESSING_CONSENT });
    assert.equal(authorized.active, true);
    assert.equal(authorized.source, "settings");
    passed.push("CONSENT_REVOCATION_PERSISTENCE", "STALE_ONBOARDING_CANNOT_REAUTHORIZE", "CONSENT_SETTINGS_REAUTHORIZE", "REVOKED_AI_DOES_NOT_BLOCK_ACCOUNT_ACCESS");

    stage = "PRIVACY_DIRECTORY_FRIENDSHIP_AND_RECIPROCAL_BLOCK";
    async function directory(actor, target) {
      return checked(await actor.client.rpc("search_social_profiles_v2", { search_username: target.username, result_limit: 20 }), "Authenticated social directory");
    }
    for (const [actor, target] of [[a, b], [b, a]]) {
      const rows = await directory(actor, target);
      assert.equal(rows.some(row => row.user_id === target.id), true);
      assert.equal(rows.every(row => Object.keys(row).every(key => ["user_id", "username", "display_name", "avatar_url"].includes(key))), true, "directory excludes email, location and private account data");
      denied(await actor.client.from("social_profiles").select("*").eq("user_id", target.id), "Non-friend full social row");
    }
    const request = checked(await a.client.from("friend_requests").insert({ requester_id: a.id, addressee_id: b.id,
      operation_id: randomUUID(), state: "PENDING" }).select("id").single(), "Create QA friend request");
    checked(await b.client.from("friend_requests").update({ state: "ACCEPTED" }).eq("id", request.id).select("id").single(), "Accept QA friendship");
    assert.equal(checked(await a.client.from("social_profiles").select("user_id").eq("user_id", b.id), "Friend profile read").length, 1);
    checked(await a.client.from("blocked_connections").insert({ owner_id: a.id, blocked_user_id: b.id }), "Block QA peer");
    assert.deepEqual(await directory(a, b), []);
    assert.deepEqual(await directory(b, a), []);
    for (const [actor, target] of [[a, b], [b, a]]) {
      denied(await actor.client.from("social_profiles").select("*").eq("user_id", target.id), "Blocked full social row");
      denied(await actor.client.from("profiles").select("*").eq("id", target.id), "Account PII remains owner-only");
    }
    await app("/api/account/privacy", a, "PATCH", { visibility: "private" }, 400);
    passed.push("PUBLIC_FRIENDS_DIRECTORY_MINIMAL_IDENTITY", "FRIENDSHIP_PERMISSIONS", "RECIPROCAL_BLOCK", "ACCOUNT_PII_PRIVATE", "NO_NEW_PRIVATE_SELECTION");
  } catch (error) {
    // Never expose response bodies, password, tokens or raw assertion values.
    failure = error;
  } finally {
    for (const account of accounts) {
      try {
        assert.equal(profileCloudQaConfig(env).projectRef, QA_REF);
        const lookup = await admin.auth.admin.getUserById(account.id);
        if (lookup.error?.status === 404) continue;
        const user = checked(lookup, "Cleanup owner proof").user;
        assert.equal(user?.id, account.id);
        assert.equal(user?.email, account.email);
        assert.equal(user?.app_metadata?.qa_run_id, runId);
        if (account.token) {
          const deleted = await app("/api/account/delete", account, "DELETE", { confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: randomUUID() });
          assert.equal(deleted.deleted, true);
        } else checked(await admin.auth.admin.deleteUser(account.id), "Cleanup unused run-owned Auth account");
        const absence = await admin.auth.admin.getUserById(account.id);
        assert.equal(absence.error?.status === 404 || (!absence.error && !absence.data.user), true);
      } catch { retained.push(account.id); }
    }
  }
  const report = { preview: config.previewOrigin, projectRef: config.projectRef, runId, passed,
    ...(failure ? { failedAt: stage, diagnostic, failureType: failure?.name === "AssertionError" ? "ASSERTION" : "REQUEST_OR_HELPER" } : {}),
    cleanup: retained.length ? "QA_ACCOUNTS_RETAINED" : "COMPLETE", retainedQaUserIds: retained,
    notCovered: ["BROWSER_UI", "PHYSICAL_IPHONE_SAFARI", "GOOGLE_OAUTH", "SMTP_OTP_DELIVERY", "LEGAL_APPROVAL"] };
  log(JSON.stringify(report));
  if (failure) throw new Error(`Profile/cloud remote QA failed at ${stage}. Run ID: ${runId}. No credentials or raw provider bodies logged.`);
  if (retained.length) throw new Error("QA account cleanup pending. Use only the exact reported run-owned IDs; never broad-delete users.");
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && args[0] === "--run") await runPreviewProfileCloudQA();
    else if (args.length === 1 && args[0] === "--check-config") {
      const config = profileCloudQaConfig();
      console.log(JSON.stringify({ configuration: "VALID", network: "NOT_RUN", projectRef: config.projectRef, preview: config.previewOrigin }));
    } else if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log("Phase 2 isolated Preview profile/cloud HTTP QA. Uses the same explicit environment as qa-preview-statistics.mjs, but accepts only bymeopxkxapfizeeqeyb. Compile tsconfig.test.json, then use --check-config or --run. Creates two fresh example.invalid accounts and cleans up only identities proven to belong to this run. Never use Production keys.");
    } else throw new Error("Use --help, --check-config or --run. No request made.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Profile/cloud QA failed.");
    process.exitCode = 1;
  }
}
