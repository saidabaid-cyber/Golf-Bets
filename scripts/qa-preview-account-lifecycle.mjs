import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { previewStatisticsConfig, credentialBoundFetch, verifyPreviewBundleBinding, verifyPreviewDeploymentIdentity } from "./qa-preview-statistics.mjs";

/** Same canonical-origin, exact-SHA and non-shared DB safety boundary as
 * statistics QA. No existing user IDs or emails can be supplied to this runner. */
export const previewAccountConfig = previewStatisticsConfig;
const require = createRequire(import.meta.url);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STORAGE_BUCKET = "scorecard-photos";
const ADMIN_DOCUMENT_BUCKET = "admin-documents-private";
function checked(result, label) {
  if (result.error) throw new Error(`${label} failed${result.error.status ? ` (HTTP ${result.error.status})` : ""}.`);
  return result.data;
}
function step(condition, label) { if (!condition) throw new Error(`QA assertion failed: ${label}.`); }
function rekeyHoleValues(values, oldKey, newKey) {
  return Object.fromEntries(Object.entries(values || {}).map(([hole, byPlayer]) => [hole,
    Object.fromEntries(Object.entries(byPlayer || {}).map(([playerKey, score]) =>
      [playerKey === oldKey ? newKey : playerKey, score]))]));
}
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

function equipmentFixture(domain, account, now) {
  const empty = domain.createEmptyEquipmentProfile(account.id, now);
  const clubs = empty && domain.upsertPlayerClub(empty, {
    id: `qa-driver-${account.id}`, userId: account.id, category: "DRIVER",
    customBrand: "QA synthetic", customModel: "Fresh-start driver", handedness: "RH",
    isCurrent: true, createdAt: now, updatedAt: now,
  }, now);
  const profile = clubs && domain.upsertPlayerBall(clubs, {
    id: `qa-ball-${account.id}`, userId: account.id, catalogBallId: null,
    ballBrand: "QA synthetic", ballModel: "Fresh-start ball", generation: "QA only",
    year: null, color: "White", notes: "Disposable synthetic lifecycle fixture",
    isCurrent: true, startedUsingAt: now, stoppedUsingAt: null, createdAt: now, updatedAt: now,
  }, now);
  step(profile?.clubs?.length === 1 && profile?.balls?.length === 1
    && profile.balls[0]?.isCurrent === true, "non-empty synthetic club and ball fixture");
  return profile;
}

/** Executes real API/Auth/RLS checks only when called explicitly. The retained
 * archive and ownerless shared-document fixtures are intentional evidence of
 * their preservation contracts. Exact fresh QA IDs are reported; cleanup is
 * never broad. */
export async function runPreviewAccountQA(env = process.env, { fetcher = fetch, clientFactory = createClient, log = console.log } = {}) {
  const config = previewAccountConfig(env);
  const includeAdminDocumentFixture = env.QA_ACCOUNT_ADMIN_DOCUMENT_FIXTURE === "true";
  const appFetch = credentialBoundFetch(config.previewOrigin, fetcher);
  const databaseFetch = credentialBoundFetch(config.supabaseOrigin, fetcher);
  await verifyPreviewBundleBinding(config, appFetch, databaseFetch);
  let domain;
  try {
    domain = { ...require("../.test-dist/lib/golf-equipment.js"), ...require("../.test-dist/lib/golf-insights.js"),
      ...require("../.test-dist/lib/backyard-ai/privacy.js") };
  } catch { throw new Error("Compile current app logic first: node node_modules/typescript/bin/tsc -p tsconfig.test.json"); }
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: databaseFetch } };
  const admin = clientFactory(config.supabaseOrigin, config.secretKey, options);
  const runId = randomUUID(), attempts = [], passed = [], retainedIds = [], archivedFixtures = [], preservedSharedFixtures = [];
  const cleanupModes = [];
  let freshStartEvidence = null, databaseVerification = null;
  let firstWriteAuthorized = false;
  let stage = "EMPTY_ACCOUNT", diagnostic = null, failed = false;

  async function revalidateCanonicalAlias() {
    await verifyPreviewDeploymentIdentity(config, appFetch);
  }
  async function authorizeFirstWrite() {
    if (firstWriteAuthorized) {
      await revalidateCanonicalAlias();
      return;
    }
    await revalidateCanonicalAlias();
    firstWriteAuthorized = true;
  }

  async function app(path, account, method = "GET", body, expected = [200], token = account?.token) {
    if (!["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase())) {
      await revalidateCanonicalAlias();
    }
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
  async function newAccount(label, exactEmail) {
    const account = { id: randomUUID(), email: exactEmail || `backyard-qa-account-${label}-${runId}@example.invalid`,
      displayName: `Lifecycle QA ${label}`, password: `Qa!${randomBytes(32).toString("base64url")}`,
      client: null, token: null, operation: null, touched: false, archived: false };
    await authorizeFirstWrite();
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
    const accountStatus = policy === "delete_golf_data" ? "deleted" : "archived";
    step(result.ok === true && result.deleted === (policy === "delete_golf_data")
      && result.archived === (policy === "retain_history") && result.accountStatus === accountStatus,
    "confirmed lifecycle result and terminal account status");
    return result;
  }
  async function noLogin(account, expectedCode) {
    const fresh = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const login = await fresh.auth.signInWithPassword({ email: account.email, password: account.password });
    step(Boolean(login.error) && login.error.code === expectedCode && !login.data?.session,
      "closed account login returns the exact expected Auth denial without a session");
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
  async function storageObjects(prefix, bucket = STORAGE_BUCKET) {
    const rows = checked(await admin.storage.from(bucket).list(prefix, { limit: 100, sortBy: { column: "name", order: "asc" } }),
      "List exact QA Storage namespace");
    step(Array.isArray(rows), "Storage namespace list shape");
    return rows;
  }
  async function exactRows(table, column, value, columns = "*", client = admin) {
    const rows = checked(await client.from(table).select(columns).eq(column, value), `Read ${table} lifecycle rows`);
    step(Array.isArray(rows), `${table} lifecycle row shape`);
    return rows;
  }
  try {
    const empty = await newAccount("empty");
    const emptyBeforeNegative = await ownedAccount(empty);
    assert.deepEqual(await app("/api/account/delete", empty, "DELETE", { confirmation: "eliminar", dataPolicy: "delete_golf_data", requestId: randomUUID() }, [400]), {
      code: "INVALID_ACCOUNT_DELETE_CHOICE",
      error: "Confirma escribiendo ELIMINAR y selecciona qué hacer con tus datos de golf.",
    });
    const afterInvalidConfirmation = await ownedAccount(empty);
    step(afterInvalidConfirmation?.id === emptyBeforeNegative?.id && afterInvalidConfirmation?.email === emptyBeforeNegative?.email,
      "invalid confirmation leaves exact account unchanged");
    assert.deepEqual(await app("/api/account/delete", empty, "DELETE", { confirmation: "ELIMINAR", dataPolicy: "delete_golf_data", requestId: randomUUID(), userId: randomUUID() }, [400]), {
      code: "INVALID_ACCOUNT_DELETE_CHOICE",
      error: "Confirma escribiendo ELIMINAR y selecciona qué hacer con tus datos de golf.",
    });
    const afterForeignSelector = await ownedAccount(empty);
    step(afterForeignSelector?.id === emptyBeforeNegative?.id && afterForeignSelector?.email === emptyBeforeNegative?.email,
      "arbitrary user selector leaves exact account unchanged");
    step((await storageObjects(empty.id)).length === 0, "empty Storage namespace before account deletion");
    await close(empty, "delete_golf_data");
    step((await ownedAccount(empty)) === null, "Auth user really deleted");
    step((await storageObjects(empty.id)).length === 0, "empty Storage namespace remains empty after account deletion");
    await noLogin(empty, "invalid_credentials");
    assert.deepEqual(await app("/api/cloud/rounds", empty, "GET", undefined, [401]), {
      error: "La sesión terminó. Vuelve a iniciar sesión para conectar la nube.", code: "AUTH_REQUIRED",
    });
    step((await ownedAccount(empty)) === null, "rejected stale session cannot recreate deleted account");
    passed.push("ACCOUNT_DELETE_EMPTY", "ACCOUNT_DELETE_EMPTY_STORAGE", "ACCOUNT_DELETE_AUTH", "NO_ARBITRARY_USER_ID");
    passed.push("DELETED_SESSION_REJECTED");
    // Same proof/request succeeds after Auth removal; it does not start a new job.
    const retry = await app("/api/account/delete", empty, "DELETE", empty.operation, [200], null);
    step(retry.deleted === true && retry.accountStatus === "deleted", "tokenless durable replay completes idempotently");
    assert.deepEqual(await app("/api/account/delete", empty, "DELETE", { ...empty.operation, recoveryToken: randomBytes(32).toString("hex") }, [401], null), {
      code: "AUTH_REQUIRED", error: "La sesión terminó. Vuelve a iniciar sesión.",
    });
    step((await ownedAccount(empty)) === null, "wrong recovery proof cannot change completed deletion");
    passed.push("ACCOUNT_DELETE_IDEMPOTENT", "RECOVERY_PROOF_REQUIRED");

    stage = "POPULATED_ACCOUNT_AND_STORAGE";
    const owner = await newAccount("organizer"), peer = await newAccount("participant");
    const now = new Date().toISOString();
    const oldUsername = `qa_deleted_${runId.replaceAll("-", "").slice(0, 20)}`;
    // Both identities participate in authenticated DB fixtures below. Mark
    // them before the first write so an alias change can never downgrade their
    // cleanup to direct Auth deletion.
    owner.touched = true;
    peer.touched = true;
    stage = "POPULATE_PROFILE_ONBOARDING";
    checked(await owner.client.from("profiles").update({
      name: owner.displayName, display_name: owner.displayName, username: oldUsername,
      avatar_url: `https://example.invalid/qa-avatar-${runId}.png`, default_handicap: 11.4,
      home_club: "QA synthetic home club", preferred_tee: "QA synthetic tee", handedness: "right",
      onboarding_completed_at: now, updated_at: now,
    }).eq("id", owner.id).select("id").single(), "Populate exact QA profile");
    checked(await owner.client.from("social_profiles").update({ username: oldUsername, display_name: owner.displayName })
      .eq("user_id", owner.id).select("user_id").single(), "Populate exact QA social identity");
    checked(await owner.client.from("user_preferences").upsert({ user_id: owner.id, high_contrast: true,
      locale: "es-MX", default_handicap: 11.4, notifications_enabled: true, updated_at: now })
      .select("user_id").single(), "Populate exact QA preferences");
    checked(await owner.client.from("profile_completion_choices").upsert({ user_id: owner.id,
      handicap_choice: "MANUAL", manual_hcp: 11.4, not_applicable: [], updated_at: now })
      .select("user_id").single(), "Populate exact QA completion choices");
    checked(await owner.client.from("legal_acceptances").insert([
      { user_id: owner.id, type: "terms", version: `qa-${runId}`, accepted_at: now, locale: "es-MX" },
      { user_id: owner.id, type: "privacy", version: `qa-${runId}`, accepted_at: now, locale: "es-MX" },
    ]), "Populate exact QA legal acceptances");
    stage = "POPULATE_EQUIPMENT";
    const equipment = equipmentFixture(domain, owner, now);
    const savedEquipment = await app("/api/equipment", owner, "PUT", {
      profile: equipment, expectedVersion: null, mutationId: randomUUID(), deviceId: `qa-fresh-start-${runId}`,
    });
    step(savedEquipment.data?.profile?.clubs?.length === 1
      && savedEquipment.data.profile.balls?.length === 1
      && savedEquipment.data.profile.balls[0]?.isCurrent === true,
    "non-empty clubs and current ball saved before deletion");
    // These relational mirrors are service-managed: authenticated has no
    // INSERT grant by design. Seed only the exact synthetic owner through the
    // already-bound QA Admin client, then prove lifecycle removal below.
    checked(await admin.from("player_clubs").insert({
      user_id: owner.id, local_id: `qa-driver-${runId}`, custom_brand: "QA synthetic",
      custom_model: "Fresh-start driver row", category: "DRIVER", handedness: "RH",
      is_current: true, updated_by_device: `qa-device-${runId}`,
    }), "Populate exact QA relational club");
    checked(await admin.from("player_balls").insert({
      user_id: owner.id, local_id: `qa-ball-${runId}`, custom_brand: "QA synthetic",
      custom_model: "Fresh-start ball row", generation: "QA only", color: "White",
      is_current: true, updated_by_device: `qa-device-${runId}`,
    }), "Populate exact QA relational ball");
    stage = "POPULATE_AI_CONSENT";
    const consent = await app("/api/backyard-ai/consent", owner, "POST", { source: "onboarding", decisions: [
      { scope: domain.AI_PROVIDER_PROCESSING_CONSENT, accepted: true },
      { scope: domain.AI_IMAGE_PROCESSING_CONSENT, accepted: false },
      { scope: domain.AI_LAUNCH_MONITOR_PROCESSING_CONSENT, accepted: false },
    ] });
    step(consent.resolved === true && consent.decisions?.some(item => item.active === true),
      "consent choices saved before deletion");

    stage = "POPULATE_SOCIAL_CONNECTION";
    const friendRequest = checked(await owner.client.from("friend_requests").insert({
      requester_id: owner.id, addressee_id: peer.id, operation_id: randomUUID(), state: "PENDING",
    }).select("id,requester_id,addressee_id,state").single(), "Create exact QA friend request");
    const acceptedRequest = checked(await peer.client.from("friend_requests").update({ state: "ACCEPTED" })
      .eq("id", friendRequest.id).eq("addressee_id", peer.id).eq("state", "PENDING")
      .select("id,state").single(), "Accept exact QA friend request");
    step(acceptedRequest.state === "ACCEPTED", "synthetic social connection accepted");
    const [friendA, friendB] = [owner.id, peer.id].sort();
    step((await exactRows("friendships", "user_a_id", friendA)).some(row => row.user_b_id === friendB),
      "friendship exists before deletion");

    stage = "POPULATE_SHARED_GROUP_ROW";
    const sharedGroup = checked(await owner.client.from("groups_v2").insert({
      owner_id: owner.id, name: `QA synthetic lifecycle group ${runId.slice(0, 8)}`, privacy: "PRIVATE",
      default_template: { qaSynthetic: true, accountUserId: owner.id },
    }).select("id,owner_id,name").single(), "Create exact QA group");
    stage = "POPULATE_SHARED_GROUP_MEMBERSHIPS";
    checked(await owner.client.from("group_memberships_v2").insert([
      { group_id: sharedGroup.id, user_id: owner.id, role: "ADMIN", display_name_snapshot: owner.displayName },
      { group_id: sharedGroup.id, user_id: peer.id, role: "ADMIN", display_name_snapshot: peer.displayName },
    ]), "Create exact QA group memberships");
    stage = "VERIFY_SHARED_GROUP_MEMBERSHIPS";
    const groupMembershipRead = await owner.client.from("group_memberships_v2").select("*").eq("group_id", sharedGroup.id);
    if (groupMembershipRead.error) diagnostic = {
      groupMembershipReadCode: typeof groupMembershipRead.error.code === "string" ? groupMembershipRead.error.code : "UNKNOWN",
      groupMembershipReadStatus: Number.isInteger(groupMembershipRead.status) ? groupMembershipRead.status : null,
    };
    const groupMembershipRows = checked(groupMembershipRead, "Read group_memberships_v2 lifecycle rows");
    if (groupMembershipRows.length !== 2) diagnostic = { groupMembershipCount: groupMembershipRows.length };
    step(groupMembershipRows.length === 2,
      "owner and survivor group memberships exist before deletion");

    stage = "POPULATE_PRIVATE_COURSES";
    const manualClubId = `qa-club-${runId}`, manualCourseId = `qa-course-${runId}`;
    const manualTeeId = `qa-tee-${runId}`;
    checked(await owner.client.from("golf_clubs").insert({
      id: manualClubId, name: "QA synthetic lifecycle club", provider: "USER_MANUAL",
      visibility: "PRIVATE", created_by: owner.id,
    }).select("id").single(), "Create exact QA manual club");
    checked(await owner.client.from("golf_courses").insert({
      id: manualCourseId, club_id: manualClubId, name: "QA synthetic lifecycle course", holes: 18,
      provider: "USER_MANUAL", visibility: "PRIVATE", created_by: owner.id,
    }).select("id").single(), "Create exact QA manual course");
    checked(await owner.client.from("golf_course_tees").insert({
      id: manualTeeId, course_id: manualCourseId, name: "QA synthetic lifecycle tee", gender: "UNISEX",
      rating: 72, slope: 113, par: 72, total_yards: 6500, provider: "USER_MANUAL",
    }).select("id").single(), "Create exact QA manual tee");
    const ratingIds = [`${manualTeeId}:front`, `${manualTeeId}:back`];
    checked(await admin.from("golf_tee_nine_ratings").insert([
      { id: ratingIds[0], course_id: manualCourseId, tee_id: manualTeeId, segment: "FRONT",
        rating: 36, slope: 113, par: 36, rating_category: null,
        source_url: "https://example.invalid/qa-lifecycle-rating", observed_at: now.slice(0, 10),
        source_payload: { qaSynthetic: true, segment: "FRONT", accountUserId: owner.id } },
      { id: ratingIds[1], course_id: manualCourseId, tee_id: manualTeeId, segment: "BACK",
        rating: 36, slope: 113, par: 36, rating_category: null,
        source_url: "https://example.invalid/qa-lifecycle-rating", observed_at: now.slice(0, 10),
        source_payload: { qaSynthetic: true, segment: "BACK", accountUserId: owner.id } },
    ]), "Create exact QA manual tee nine ratings");
    const cloudCourseId = randomUUID();
    checked(await owner.client.from("courses_cloud").insert({
      id: cloudCourseId, owner_id: owner.id, name: "QA synthetic private cloud course",
      is_public: false, catalog_course_id: manualCourseId,
    }).select("id").single(), "Create exact QA private cloud course");
    checked(await owner.client.from("course_versions").insert({
      course_id: cloudCourseId, version: 1,
      holes: Array.from({ length: 18 }, (_, index) => ({ number: index + 1, par: 4, strokeIndex: index + 1 })),
      created_by: owner.id,
    }).select("id").single(), "Create exact QA private course version");
    step((await exactRows("courses_cloud", "id", cloudCourseId, "*", owner.client)).length === 1
      && (await exactRows("golf_courses", "id", manualCourseId)).length === 1
      && (await exactRows("golf_course_tees", "id", manualTeeId)).length === 1
      && (await exactRows("golf_tee_nine_ratings", "course_id", manualCourseId)).length === 2,
    "private cloud course and complete manual course/tee/rating fixtures exist before deletion");

    stage = "POPULATE_ADMIN_DOCUMENT_STORAGE";
    const adminMembershipId = includeAdminDocumentFixture ? randomUUID() : null;
    const adminDocumentId = includeAdminDocumentFixture ? randomUUID() : null;
    const adminDocumentName = `qa-account-delete-${runId}.pdf`;
    const adminDocumentSourcePath = `${owner.id}/${adminDocumentName}`;
    const adminDocumentTargetPath = `account-lifecycle-shared/${adminDocumentId}.pdf`;
    if (includeAdminDocumentFixture) {
      checked(await admin.from("admin_memberships").insert({
        id: adminMembershipId, user_id: owner.id, role: "COURSE_ADMIN", scope_type: "GLOBAL",
        scope_id: null, active: true, created_by: null,
      }).select("id").single(), "Create service-authorized QA admin membership");
      const pdfBytes = new TextEncoder().encode("%PDF-1.4\n% QA synthetic account-lifecycle evidence\n%%EOF\n");
      const adminUpload = checked(await owner.client.storage.from(ADMIN_DOCUMENT_BUCKET).upload(adminDocumentSourcePath,
        pdfBytes, { contentType: "application/pdf", upsert: false }), "Upload exact owned QA admin document");
      step(adminUpload.path === adminDocumentSourcePath, "admin document source is bound to the synthetic owner");
      checked(await owner.client.from("admin_documents").insert({
        id: adminDocumentId, owner_entity_type: "COURSE", owner_entity_id: manualCourseId,
        scope_type: "GLOBAL", scope_id: null, storage_path: adminDocumentSourcePath,
        mime_type: "application/pdf", byte_size: pdfBytes.byteLength, original_name: adminDocumentName,
        rights_status: "PENDING_RIGHTS", visibility: "ADMIN", created_by: owner.id,
      }).select("id").single(), "Create exact QA admin document row");
      step((await exactRows("admin_memberships", "id", adminMembershipId, "*", owner.client)).length === 1
        && (await exactRows("admin_documents", "id", adminDocumentId, "*", owner.client)).length === 1
        && (await storageObjects(owner.id, ADMIN_DOCUMENT_BUCKET)).some(item => item.name === adminDocumentName),
      "owned admin membership, document and Storage source exist before deletion");
    }

    stage = "POPULATE_ROUNDS_STATISTICS_STORAGE";
    const privateRound = fixtureRound(owner, null, `qa-private-${runId}`);
    const privateRoundId = await saveRound(owner, privateRound);
    const shared = fixtureRound(owner, peer, `qa-shared-${runId}`);
    const sharedId = await saveRound(owner, shared);
    // Real authenticated owner insert, checked by the existing participant RLS.
    checked(await owner.client.from("round_participants_v2").insert({ round_id: sharedId, user_id: peer.id,
      player_key: `qa-player-${peer.id}`, role: "PLAYER" }), "Link exact QA participant");
    const personal = fixtureRound(peer, owner, `qa-peer-copy-${runId}`);
    const personalId = await saveRound(peer, personal);
    assert.deepEqual((await readRound(peer.client, sharedId)).snapshot.scores, shared.scores);
    const storageName = `fresh-start-${runId}.png`, storagePath = `${owner.id}/${storageName}`;
    const uploaded = checked(await owner.client.storage.from(STORAGE_BUCKET).upload(storagePath,
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { contentType: "image/png", upsert: false }),
    "Upload exact QA Storage object");
    step(uploaded.path === storagePath, "Storage upload path is bound to the exact synthetic owner");
    step((await storageObjects(owner.id)).some(item => item.name === storageName), "owned Storage object exists before deletion");
    const beforeHistory = await app("/api/cloud/rounds", owner);
    const beforeStats = domain.buildGolfInsights(beforeHistory.rounds || []);
    step(beforeStats.scoredRounds >= 2, "populated account has non-zero derived statistics");
    step((await app("/api/account/entry", owner)).existingAccount === true, "populated account completed onboarding");
    for (const [table, column] of [["user_preferences", "user_id"], ["profile_completion_choices", "user_id"],
      ["player_equipment_profiles", "user_id"], ["player_clubs", "user_id"], ["player_balls", "user_id"],
      ["ai_processing_consents", "user_id"], ["legal_acceptances", "user_id"]]) {
      step((await exactRows(table, column, owner.id, "*", owner.client)).length > 0, `${table} exists before deletion`);
    }
    passed.push("POPULATED_PROFILE_ONBOARDING", "POPULATED_EQUIPMENT_PREFERENCES_CONSENTS",
      "POPULATED_CLUB_AND_BALL_ROWS", "POPULATED_SOCIAL_CONNECTION_AND_GROUP",
      "POPULATED_PRIVATE_COURSES", "POPULATED_MANUAL_TEE_NINE_RATINGS",
      "POPULATED_ROUNDS_AND_STATISTICS", "STORAGE_OBJECT_PRESENT");
    if (includeAdminDocumentFixture) passed.push("POPULATED_ADMIN_DOCUMENT_STORAGE");

    stage = "DELETE_AND_DB_STORAGE_ABSENCE";
    await close(owner, "delete_golf_data");
    step((await ownedAccount(owner)) === null, "organizer Auth deleted");
    await noLogin(owner, "invalid_credentials");
    const ownerReplay = await app("/api/account/delete", owner, "DELETE", owner.operation, [200], null);
    step(ownerReplay.deleted === true && ownerReplay.accountStatus === "deleted", "populated deletion replay is terminal and idempotent");
    for (const [table, column] of [["profiles", "id"], ["social_profiles", "user_id"],
      ["player_equipment_profiles", "user_id"], ["player_clubs", "user_id"], ["player_balls", "user_id"],
      ["ai_processing_consents", "user_id"]]) {
      step((await exactRows(table, column, owner.id)).length === 0, `${table} removed for deleted identity`);
    }
    step((await exactRows("rounds_cloud", "id", privateRoundId)).length === 0, "private round removed");
    step((await exactRows("friend_requests", "requester_id", owner.id, "*", peer.client)).length === 0
      && (await exactRows("friend_requests", "addressee_id", owner.id, "*", peer.client)).length === 0
      && (await exactRows("friendships", "user_a_id", owner.id)).length === 0
      && (await exactRows("friendships", "user_b_id", owner.id)).length === 0,
    "deleted identity has no social connection rows");
    const deletedGroupMemberships = checked(await peer.client.from("group_memberships_v2").select("id")
      .eq("group_id", sharedGroup.id).eq("user_id", owner.id), "Read deleted group memberships as survivor");
    step(deletedGroupMemberships.length === 0,
      "deleted identity has no group membership");
    step((await exactRows("golf_tee_nine_ratings", "course_id", manualCourseId)).length === 0
      && (await exactRows("golf_course_tees", "id", manualTeeId)).length === 0
      && (await exactRows("golf_courses", "id", manualCourseId)).length === 0
      && (await exactRows("golf_clubs", "id", manualClubId)).length === 0,
    "complete manual course/tee/rating data removed");
    if (includeAdminDocumentFixture) {
      step(!(await storageObjects(owner.id, ADMIN_DOCUMENT_BUCKET)).some(item => item.name === adminDocumentName)
        && (await storageObjects("account-lifecycle-shared", ADMIN_DOCUMENT_BUCKET))
          .some(item => item.name === `${adminDocumentId}.pdf`),
      "admin document source removed and ownerless lifecycle target retained");
      preservedSharedFixtures.push({ documentId: adminDocumentId, storagePath: adminDocumentTargetPath });
      passed.push("ADMIN_DOCUMENT_STORAGE_REHOMED");
    }
    databaseVerification = { deletedUserId: owner.id, cloudCourseId, manualClubId, manualCourseId,
      manualTeeId, ...(includeAdminDocumentFixture
        ? { adminMembershipId, adminDocumentId, adminDocumentTargetPath } : {}) };
    step((await storageObjects(owner.id)).length === 0, "owned Storage namespace emptied");
    passed.push("PRIVATE_ACCOUNT_APP_DATA_REMOVED", "PRIVATE_CLUB_AND_BALL_DATA_REMOVED", "PRIVATE_ROUND_REMOVED",
      "PRIVATE_SOCIAL_ROWS_REMOVED", "PRIVATE_MANUAL_COURSES_REMOVED", "PRIVATE_TEE_NINE_RATINGS_REMOVED",
      "STORAGE_OBJECT_REMOVED", "POPULATED_DELETE_IDEMPOTENT");

    stage = "SHARED_ROUND_ANONYMIZATION";
    const preserved = await readRound(peer.client, sharedId);
    step(preserved.owner_id === null && preserved.snapshot.ownerName === "Jugador eliminado", "shared organizer anonymized");
    const deletedOriginalKey = `qa-player-${owner.id}`;
    const deletedPlayer = preserved.snapshot.players.find(p => p.identityDeleted === true);
    step(deletedPlayer?.name === "Jugador eliminado" && !deletedPlayer.accountUserId && !deletedPlayer.avatarUrl,
      "deleted participant identity scrubbed");
    step(deletedPlayer?.id && deletedPlayer.id !== deletedOriginalKey
      && !JSON.stringify(preserved.snapshot).includes(owner.id),
    "shared round contains no deleted Auth UUID");
    const expectedSharedScores = rekeyHoleValues(shared.scores, deletedOriginalKey, deletedPlayer.id);
    const expectedSharedPutts = rekeyHoleValues(shared.putts, deletedOriginalKey, deletedPlayer.id);
    assert.deepEqual(preserved.snapshot.scores, expectedSharedScores);
    assert.deepEqual(preserved.snapshot.putts, expectedSharedPutts);
    const peerPlayer = preserved.snapshot.players.find(p => p.accountUserId === peer.id);
    step(peerPlayer?.name === peer.displayName, "other participant identity preserved");
    const preservedGroup = checked(await peer.client.from("groups_v2").select("id,owner_id,name,default_template")
      .eq("id", sharedGroup.id).single(), "Read preserved QA group as surviving member");
    step(preservedGroup.owner_id === null && preservedGroup.name === sharedGroup.name
      && !JSON.stringify(preservedGroup.default_template).includes(owner.id),
      "shared group preserved without silently transferring ownership");
    const survivorMembership = checked(await peer.client.from("group_memberships_v2")
      .select("group_id,user_id,role,display_name_snapshot").eq("group_id", sharedGroup.id)
      .eq("user_id", peer.id).single(), "Read surviving QA group membership");
    step(survivorMembership.role === "ADMIN" && survivorMembership.display_name_snapshot === peer.displayName,
      "other member group identity preserved");
    passed.push("ACCOUNT_DELETE_SHARED_ROUND_INTEGRITY", "SHARED_ROUND_DIRECT_IDENTIFIERS_REMOVED", "SHARED_ROUND_PARTICIPANT_RLS",
      "ACCOUNT_DELETE_SHARED_GROUP_INTEGRITY");

    stage = "SAME_EMAIL_FRESH_START";
    const recreated = await newAccount("recreated", owner.email);
    step(recreated.id !== owner.id && recreated.email === owner.email, "same email recreated with a new Auth UUID");
    const stalePasswordClient = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const stalePassword = await stalePasswordClient.auth.signInWithPassword({ email: owner.email, password: owner.password });
    step(Boolean(stalePassword.error) && !stalePassword.data?.session, "deleted password cannot authenticate recreated identity");
    const entry = await app("/api/account/entry", recreated);
    step(entry.userId === recreated.id && entry.profileExists === true && entry.existingAccount === false
      && entry.onboardingProgress == null, "recreated identity starts at onboarding");
    const freshProfile = checked(await recreated.client.from("profiles")
      .select("id,display_name,username,avatar_url,default_handicap,home_club,preferred_tee,handedness,onboarding_completed_at")
      .eq("id", recreated.id).single(), "Read recreated initial profile");
    step(freshProfile.onboarding_completed_at === null && freshProfile.default_handicap === null
      && freshProfile.home_club === null && freshProfile.preferred_tee === null && freshProfile.handedness === null,
    "recreated profile has initial golf and onboarding state");
    step(freshProfile.username !== oldUsername && freshProfile.avatar_url !== `https://example.invalid/qa-avatar-${runId}.png`,
      "recreated profile does not inherit username or avatar");
    const freshHistory = await app("/api/cloud/rounds", recreated);
    step(Array.isArray(freshHistory.rounds) && freshHistory.rounds.length === 0, "recreated identity has no prior rounds");
    const freshStats = domain.buildGolfInsights(freshHistory.rounds);
    step(freshStats.rounds === 0 && freshStats.scoredRounds === 0 && freshStats.pars === 0
      && freshStats.birdies === 0 && freshStats.puttRounds === 0 && freshStats.advancedRounds === 0,
    "recreated identity statistics are zero");
    step((await app("/api/equipment", recreated)).data === null, "recreated identity has no prior equipment");
    const freshConsent = await app("/api/backyard-ai/consent", recreated);
    step(freshConsent.resolved === false && freshConsent.decisions?.every(item => item.status === "missing"),
      "recreated identity has no prior consent decisions");
    for (const [table, column] of [["user_preferences", "user_id"], ["profile_completion_choices", "user_id"],
      ["player_equipment_profiles", "user_id"], ["player_clubs", "user_id"], ["player_balls", "user_id"],
      ["ai_processing_consents", "user_id"], ["legal_acceptances", "user_id"]]) {
      step((await exactRows(table, column, recreated.id, "*", recreated.client)).length === 0,
        `${table} starts empty for recreated identity`);
    }
    const freshGroupMemberships = checked(await recreated.client.from("group_memberships_v2").select("id")
      .eq("user_id", recreated.id), "Read recreated group memberships");
    const freshOwnedGroups = checked(await recreated.client.from("groups_v2").select("id")
      .eq("owner_id", recreated.id), "Read recreated owned groups");
    step((await exactRows("friend_requests", "requester_id", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("friend_requests", "addressee_id", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("friendships", "user_a_id", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("friendships", "user_b_id", recreated.id, "*", recreated.client)).length === 0
      && freshGroupMemberships.length === 0 && freshOwnedGroups.length === 0,
    "recreated identity has no prior connections or groups");
    step((await exactRows("courses_cloud", "owner_id", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("course_versions", "created_by", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("golf_courses", "created_by", recreated.id, "*", recreated.client)).length === 0
      && (await exactRows("golf_clubs", "created_by", recreated.id, "*", recreated.client)).length === 0,
    "recreated identity has no prior private courses");
    step((await app("/api/admin/access", recreated)).hasAccess === false,
      "recreated identity does not inherit deleted Admin access");
    step((await storageObjects(recreated.id)).length === 0, "recreated identity Storage namespace starts empty");
    freshStartEvidence = { deletedUserId: owner.id, recreatedUserId: recreated.id,
      deleteRequestId: owner.operation.requestId, sameEmailRecreated: true, statisticsScoredRounds: freshStats.scoredRounds };
    passed.push("SAME_EMAIL_NEW_AUTH_UUID", "FRESH_START_ONBOARDING", "FRESH_START_PROFILE_INITIAL",
      "FRESH_START_ZERO_STATISTICS", "FRESH_START_NO_ROUNDS_EQUIPMENT_PREFERENCES_CONSENTS",
      "FRESH_START_NO_SOCIAL_OR_COURSES", "FRESH_START_EMPTY_STORAGE");
    // A preserved SQL row is not sufficient: the application must return it to
    // the surviving participant, including after a new server-authenticated login.
    async function sharedHistoryReadback(token) {
      const history = await app("/api/cloud/rounds", peer, "GET", undefined, [200], token);
      const round = history.rounds?.find(item => item.cloudRoundId === sharedId);
      step(round?.cloudReadOnly === true && round.ownerName === "Jugador eliminado", "shared app history is read-only and anonymized");
      assert.deepEqual(round.scores, expectedSharedScores);
      assert.deepEqual(round.putts, expectedSharedPutts);
      step(history.rounds.some(item => item.id === personal.id), "participant owned history also remains visible");
    }
    await sharedHistoryReadback(peer.token);
    const freshPeer = clientFactory(config.supabaseOrigin, config.publicKey, options);
    const freshLogin = checked(await freshPeer.auth.signInWithPassword({ email: peer.email, password: peer.password }), "Fresh participant login");
    step(freshLogin.user?.id === peer.id && freshLogin.session?.access_token, "fresh participant identity");
    await sharedHistoryReadback(freshLogin.session.access_token);
    passed.push("SHARED_HISTORY_APP_READBACK", "SHARED_HISTORY_FRESH_SESSION");
    // An old browser tab must not resurrect deleted PII through its own copy.
    checked(await peer.client.from("rounds_cloud").update({ snapshot: personal }).eq("id", personalId).eq("owner_id", peer.id), "Resend own stale QA snapshot");
    const restored = await readRound(peer.client, personalId);
    const restoredDeletedPlayer = restored.snapshot.players.find(p => p.identityDeleted === true);
    step(restoredDeletedPlayer?.name === "Jugador eliminado"
      && !JSON.stringify(restored.snapshot).includes(owner.id), "stale sync cannot resurrect identity");
    assert.deepEqual(restored.snapshot.scores,
      rekeyHoleValues(personal.scores, deletedOriginalKey, restoredDeletedPlayer.id));
    assert.deepEqual(restored.snapshot.putts,
      rekeyHoleValues(personal.putts, deletedOriginalKey, restoredDeletedPlayer.id));
    passed.push("DELETED_IDENTITY_STAYS_ANONYMIZED");

    stage = "ARCHIVE_ACCOUNT";
    checked(await peer.client.from("group_memberships_v2").insert({
      group_id: sharedGroup.id, user_id: recreated.id, role: "MEMBER",
      display_name_snapshot: recreated.displayName,
    }), "Add fresh identity as archive-preservation observer");
    recreated.touched = true;
    const beforeArchive = [await readRound(admin, sharedId), await readRound(admin, personalId)];
    const groupBeforeArchive = checked(await recreated.client.from("groups_v2").select("id,owner_id,name,default_template")
      .eq("id", sharedGroup.id), "Read group before archive as observer");
    const membershipBeforeArchive = checked(await recreated.client.from("group_memberships_v2")
      .select("group_id,user_id,role,display_name_snapshot").eq("group_id", sharedGroup.id).order("user_id"),
    "Read memberships before archive as observer");
    await close(peer, "retain_history");
    peer.archived = true;
    const archivedUser = await ownedAccount(peer);
    step(archivedUser && Date.parse(archivedUser.banned_until || "") > Date.now(), "Auth account retained and banned");
    await noLogin(peer, "user_banned");
    const archivedEquipment = await app("/api/equipment", peer, "GET", undefined, [401, 403]);
    step(archivedEquipment.code === "AUTH_REQUIRED" || archivedEquipment.code === "ACCOUNT_ACCESS_RESTRICTED",
      "archived account cannot access equipment after global session revocation");
    const blocked = await peer.client.from("rounds_cloud").select("id").eq("id", personalId);
    step(Boolean(blocked.error) && ["42501", "PGRST301", "PGRST303"].includes(blocked.error.code), "stale JWT cannot access archived data");
    assert.deepEqual([await readRound(admin, sharedId), await readRound(admin, personalId)], beforeArchive);
    assert.deepEqual(checked(await recreated.client.from("groups_v2").select("id,owner_id,name,default_template")
      .eq("id", sharedGroup.id), "Read group after archive as observer"), groupBeforeArchive);
    assert.deepEqual(checked(await recreated.client.from("group_memberships_v2")
      .select("group_id,user_id,role,display_name_snapshot").eq("group_id", sharedGroup.id).order("user_id"),
    "Read memberships after archive as observer"), membershipBeforeArchive);
    const replay = await app("/api/account/delete", peer, "DELETE", peer.operation, [200], null);
    step(replay.archived === true && replay.deleted === false && replay.accountStatus === "archived",
      "archive replay cannot become deletion");
    await close(recreated, "delete_golf_data");
    step((await ownedAccount(recreated)) === null, "recreated QA identity cleaned through lifecycle API");
    archivedFixtures.push({ userId: peer.id, roundIds: [sharedId, personalId], groupIds: [sharedGroup.id] });
    passed.push("ACCOUNT_ARCHIVE_KEEP_HISTORY", "ACCOUNT_ARCHIVE_KEEP_GROUP_HISTORY",
      "ACCOUNT_ARCHIVE_AUTH_BLOCKED", "ACCOUNT_ARCHIVE_STALE_JWT_BLOCKED");
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
        let aliasVerified = false;
        try { await revalidateCanonicalAlias(); aliasVerified = true; }
        catch { cleanupModes.push({ userId: account.id, mode: "ADMIN_DIRECT_AFTER_ALIAS_REVALIDATION_FAILURE" }); }
        if (account.token && aliasVerified) {
          await close(account, "delete_golf_data");
          step((await ownedAccount(account)) === null, "cleanup Auth absence");
        } else {
          step(!account.touched, "no application writes before direct fresh Auth cleanup");
          // If the stable alias changed after fixtures were created, never send
          // a bearer/recovery cleanup request to whichever deployment now owns
          // it. The exact ID + email + qa_run_id proof above authorizes only a
          // direct Admin removal of this run-owned Auth identity.
          step(Boolean(await ownedAccount(account)), "direct Admin cleanup marker revalidated immediately before delete");
          checked(await admin.auth.admin.deleteUser(account.id), "Remove unused fresh QA Auth user");
          step((await ownedAccount(account)) === null, "unused QA Auth cleanup verified");
          if (aliasVerified) cleanupModes.push({ userId: account.id, mode: "ADMIN_DIRECT_UNUSED_AUTH" });
        }
      } catch { retainedIds.push(account.id); }
    }
  }
  log(JSON.stringify({ preview: config.previewOrigin, projectRef: config.projectRef, runId, passed,
    ...(failed ? { failedAt: stage, diagnostic } : {}),
    cleanup: retainedIds.length ? "QA_CLEANUP_PENDING"
      : archivedFixtures.length || preservedSharedFixtures.length ? "ONLY_INTENTIONAL_SHARED_AND_ARCHIVE_FIXTURES_RETAINED" : "COMPLETE",
    retainedQaUserIds: retainedIds, archivedQaFixtures: archivedFixtures, preservedSharedFixtures, cleanupModes,
    ...(freshStartEvidence ? { freshStart: freshStartEvidence } : {}),
    ...(databaseVerification ? { databaseVerification } : {}), legalReview: "LEGAL_REVIEW_REQUIRED",
    coverageExcludes: ["Social activity likes/comments/attest", "Browser visual QA",
      ...(includeAdminDocumentFixture ? [] : ["Shared Admin document rehome (contract-tested; live service-role table grants remain closed)"])] }));
  if (failed) throw new Error(`Remote account QA failed at ${stage}. Run ID: ${runId}. Provider bodies, credentials and recovery proofs were not logged.`);
  if (retainedIds.length) throw new Error("Account checks completed but exact reported disposable QA accounts still require cleanup.");
  return { passed, retainedQaUserIds: retainedIds, archivedQaFixtures: archivedFixtures,
    preservedSharedFixtures, freshStart: freshStartEvidence, databaseVerification };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (!args.length || (args.length === 1 && args[0] === "--help")) {
      console.log([
        "Isolated Preview account lifecycle QA. Creates four disposable identities (including same-email recreation); intentionally retains one archived QA fixture.",
        "Uses the same environment/safety checks as qa-preview-statistics.mjs:",
        "PREVIEW_QA_URL: exactly https://dev.thebackyard.com.mx; Production, Beta and Vercel URLs are rejected.",
        "PREVIEW_QA_EXPECTED_SHA: exact 40-character commit verified through /api/health before fixtures.",
        "PREVIEW_DB_REF + QA_CONFIRM_ISOLATED_PREVIEW: same verified isolated project, never shared/Production.",
        "NEXT_PUBLIC_SUPABASE_URL + matching Preview publishable/anon and secret/service-role keys.",
        "Optional VERCEL_AUTOMATION_BYPASS_SECRET; sent only to the exact Preview origin.",
        "Offline validation: node scripts/qa-preview-account-lifecycle.mjs --check-config",
        "Explicit execution: node scripts/qa-preview-account-lifecycle.mjs --run",
        "Coverage: real Auth delete/retry, private Storage, profile/onboarding, clubs/ball, social connection/shared group, private courses with tees/ratings, rounds/statistics, same-email fresh start and separate archive.",
        "Does not claim Social activity likes/comments/attest or browser visual coverage. Do not broad-delete the reported QA fixtures.",
      ].join("\n"));
    } else if (args.length === 1 && args[0] === "--check-config") {
      const config = previewAccountConfig();
      console.log(JSON.stringify({ configuration: "VALID", network: "NOT_RUN", preview: config.previewOrigin, projectRef: config.projectRef }));
    } else if (args.length === 1 && args[0] === "--run") await runPreviewAccountQA();
    else throw new Error("Use --help, --check-config or --run; no network request was made.");
  } catch (error) { console.error(error instanceof Error ? error.message : "Account Preview QA failed."); process.exitCode = 1; }
}
