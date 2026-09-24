import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveRoundAchievements, roundAchievementLabels, roundMaterialFingerprint } from "./round-achievements";
import type { RoundSnapshot } from "./types";
import { safeSocialRoundCard } from "./social-round-card";
import { socialActivityAuthor } from "./social-author-profile";
import { captureCompletedRoundIndex } from "./backyard-index-auto-capture";
import { BACKYARD_INDEX_METADATA_KEY, parseIndexPreference } from "./backyard-index-preferences";
import { newCoursePlayedEvent } from "./new-course-activity";
import { INTERNAL_GOLF_COURSE_CATALOG } from "./golf-course-directory";
import type {
  SocialActivityAuthor, SocialActivityCard, SocialActivityDetail, SocialActivityPage,
  SocialAttestRequest, SocialComment, SocialCommentRequest, SocialMutationErrorCode,
  SocialNotificationPage, SocialParticipantConfirmRequest, SocialPreferencesResult,
  SocialActivityPreferences,
} from "./social-activity-contract";

export type SocialContext = { client: SupabaseClient; admin: SupabaseClient; userId: string };
type ActivityRow = {
  id: string; author_id: string; event_kind: SocialActivityCard["type"];
  source_round_id: string | null; source_equipment_user_id: string | null;
  local_round_id: string | null; source_version: number; material_hash: string;
  audience: SocialActivityCard["audience"]; created_at: string; active: boolean;
};
type RoundRow = { id: string; owner_id: string; local_round_id: string; version: number; snapshot: RoundSnapshot };
type RequestCache = {
  rounds: Map<string, Promise<{ rows: RoundRow[]; complete: boolean }>>;
  reset: Map<string, Promise<number | null | undefined>>;
  prefs: Map<string, Promise<SocialActivityPreferences>>;
  authors: Map<string, Promise<SocialActivityAuthor>>;
  homeClubs: Map<string, Promise<string | null>>;
};
const requestCaches = new WeakMap<SocialContext, RequestCache>();
function requestCache(ctx: SocialContext): RequestCache {
  const existing = requestCaches.get(ctx);
  if (existing) return existing;
  const created = { rounds: new Map(), reset: new Map(), prefs: new Map(), authors: new Map(), homeClubs: new Map() } as RequestCache;
  requestCaches.set(ctx, created);
  return created;
}
function cachedRounds(ctx: SocialContext, userId: string) {
  const cache = requestCache(ctx).rounds;
  if (!cache.has(userId)) cache.set(userId, accountRounds(ctx.admin, userId));
  return cache.get(userId)!;
}
function cachedReset(ctx: SocialContext, userId: string) {
  const cache = requestCache(ctx).reset;
  if (!cache.has(userId)) cache.set(userId, statsResetAt(ctx.admin, userId));
  return cache.get(userId)!;
}
function cachedPrefs(ctx: SocialContext, userId: string) {
  const cache = requestCache(ctx).prefs;
  if (!cache.has(userId)) cache.set(userId, socialPrefs(ctx.admin, userId));
  return cache.get(userId)!;
}
function cachedAuthor(ctx: SocialContext, userId: string) {
  const cache = requestCache(ctx).authors;
  if (!cache.has(userId)) cache.set(userId, authorProfile(ctx.admin, userId));
  return cache.get(userId)!;
}

const EMPTY_PREFS: SocialActivityPreferences = {
  shareRounds: false, shareAchievements: false, shareEquipment: false, shareCourses: false,
  notifyLike: true, notifyComment: true, notifyAttest: true,
  notifyFriendAchievement: false, notifyEquipment: false, updatedAt: null,
};
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;

export class SocialServiceError extends Error {
  constructor(public code: SocialMutationErrorCode, public status: number, message: string) { super(message); }
}

type SocialRecoveryStage = "friendships" | "legacy_candidates" | "round_reconcile" | "equipment_reconcile" | "bounded_batch";
class SocialRecoveryError extends SocialServiceError {
  constructor(public stage: SocialRecoveryStage, error: unknown) {
    const safe = error && typeof error === "object"
      ? error as { code?: unknown; status?: unknown; message?: unknown }
      : {};
    const code = typeof safe.code === "string" ? safe.code as SocialMutationErrorCode : "MUTATION_FAILED";
    const status = typeof safe.status === "number" ? safe.status : 503;
    const message = typeof safe.message === "string" ? safe.message : "No se pudo recuperar la actividad Social.";
    super(code, status, message);
  }
}

async function recoveryStep<T>(stage: SocialRecoveryStage, operation: () => PromiseLike<T>) {
  try { return await operation(); }
  catch (error) { throw new SocialRecoveryError(stage, error); }
}

function dbError(error: { code?: string; message?: string } | null, fallback = "MUTATION_FAILED"): never {
  const code = error?.code;
  if (code === "42P01" || code === "PGRST204" || code === "PGRST205")
    throw new SocialServiceError("SOCIAL_SCHEMA_PENDING", 503, "El esquema SocialActivity sigue pendiente de aplicación controlada.");
  if (code === "40001") throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; actualiza antes de continuar.");
  if (code === "23505") throw new SocialServiceError("ALREADY_ATTESTED", 409, "Esta acción ya se registró.");
  if (code === "42501") throw new SocialServiceError("FORBIDDEN", 403, "No tienes acceso a esta acción.");
  throw new SocialServiceError(fallback as SocialMutationErrorCode, 503, error?.message || "No se pudo completar la acción.");
}
function validId(id: unknown) {
  if (typeof id !== "string" || !UUID.test(id)) throw new SocialServiceError("INVALID_REQUEST", 400, "Identificador inválido.");
  return id;
}
function validHash(hash: unknown) {
  if (typeof hash !== "string" || !SHA256.test(hash)) throw new SocialServiceError("INVALID_REQUEST", 400, "Revisión inválida.");
  return hash;
}
function prefsFromRow(row: Record<string, unknown> | null): SocialActivityPreferences {
  if (!row) return EMPTY_PREFS;
  return {
    shareRounds: row.share_rounds === true, shareAchievements: row.share_achievements === true,
    shareEquipment: row.share_equipment === true, shareCourses: row.share_courses === true,
    notifyLike: row.notify_like !== false, notifyComment: row.notify_comment !== false,
    notifyAttest: row.notify_attest !== false, notifyFriendAchievement: row.notify_friend_achievement === true,
    notifyEquipment: row.notify_equipment === true,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
  };
}
function prefsToRow(userId: string, pref: SocialActivityPreferences) {
  return {
    user_id: userId, share_rounds: pref.shareRounds, share_achievements: pref.shareAchievements,
    share_equipment: pref.shareEquipment, share_courses: pref.shareCourses,
    notify_like: pref.notifyLike, notify_comment: pref.notifyComment, notify_attest: pref.notifyAttest,
    notify_friend_achievement: pref.notifyFriendAchievement, notify_equipment: pref.notifyEquipment,
    updated_at: new Date().toISOString(),
  };
}
function completedSnapshot(row: RoundRow): RoundSnapshot | null {
  const round = row.snapshot;
  return round && typeof round === "object" && round.lifecycleState === "completed"
    && typeof round.completedAt === "string" && round.id === row.local_round_id ? round : null;
}
async function ownerRounds(admin: SupabaseClient, userId: string): Promise<{ rows: RoundRow[]; complete: boolean }> {
  const rows: RoundRow[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await admin.from("rounds_cloud")
      .select("id,owner_id,local_round_id,version,snapshot")
      .eq("owner_id", userId).order("created_at", { ascending: true }).range(offset, offset + 499);
    if (error) dbError(error);
    rows.push(...(data as RoundRow[] || []));
    if (!data || data.length < 500) return { rows, complete: true };
  }
  return { rows, complete: false };
}
async function accountRounds(admin: SupabaseClient, userId: string): Promise<{ rows: RoundRow[]; complete: boolean }> {
  const own = await ownerRounds(admin, userId);
  const links: string[] = [];
  for (let offset = 0; offset < 10000; offset += 500) {
    const { data, error } = await admin.from("social_round_account_links_v3")
      .select("round_id").eq("user_id", userId).range(offset, offset + 499);
    if (error) dbError(error);
    links.push(...(data || []).map(link => link.round_id));
    if (!data || data.length < 500) break;
    if (offset === 9500) own.complete = false;
  }
  const extraIds = [...new Set(links)].filter(id => !own.rows.some(row => row.id === id));
  for (let offset = 0; offset < extraIds.length; offset += 100) {
    const { data, error } = await admin.from("rounds_cloud")
      .select("id,owner_id,local_round_id,version,snapshot").in("id", extraIds.slice(offset, offset + 100));
    if (error) dbError(error);
    own.rows.push(...(data as RoundRow[] || []));
  }
  return own;
}
async function socialPrefs(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("social_activity_preferences_v3")
    .select("*").eq("user_id", userId).maybeSingle();
  if (error) dbError(error);
  return prefsFromRow(data);
}
async function socialPrivacy(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.from("profiles").select("social_privacy").eq("id", userId).maybeSingle();
  if (error) dbError(error);
  return data?.social_privacy === "FRIENDS";
}
async function statsResetAt(admin: SupabaseClient, userId: string): Promise<number | null | undefined> {
  const { data, error } = await admin.from("user_statistics_resets")
    .select("reset_at").eq("user_id", userId).maybeSingle();
  // Legacy environments can have this independent feature pending. It does not
  // authorize fabricated PB: skip the achievement event until the reset basis is known.
  if (error && (error.code === "42P01" || error.code === "PGRST205")) return undefined;
  if (error) dbError(error);
  const value = typeof data?.reset_at === "string" ? Date.parse(data.reset_at) : Number.NaN;
  return Number.isFinite(value) ? value : null;
}

/** Called after canonical cloud commit and by GET as a durable trigger recovery path. */
export async function reconcileSocialRoundActivities(admin: SupabaseClient, userId: string): Promise<void> {
  const [{ rows, complete }, preferences, friendsPrivacy, resetAt] = await Promise.all([
    accountRounds(admin, userId), socialPrefs(admin, userId), socialPrivacy(admin, userId), statsResetAt(admin, userId),
  ]);
  const { data: events, error: eventError } = await admin.from("social_activities_v3")
    .select("id,source_round_id,event_kind,source_version,material_hash,active")
    .eq("author_id", userId).in("event_kind", ["ROUND_COMPLETED", "ACHIEVEMENT"]);
  if (eventError) dbError(eventError);
  const eventMap = new Map((events || []).map(event => [`${event.source_round_id}:${event.event_kind}`, event]));
  const allSnapshots = rows.map(row => row.snapshot);
  const afterResetSnapshots = resetAt !== null && resetAt !== undefined
    ? rows.filter(row => Date.parse(row.snapshot?.completedAt || "") >= resetAt).map(row => row.snapshot)
    : allSnapshots;
  for (const row of rows) {
    const round = completedSnapshot(row);
    const hash = round ? await roundMaterialFingerprint(round, userId) : null;
    const base = eventMap.get(`${row.id}:ROUND_COMPLETED`);
    if (!base) continue; // A migration/trigger has not yet published this source.
    if (!hash) {
      const { error } = await admin.from("social_activities_v3").update({ active: false })
        .eq("source_round_id", row.id).eq("author_id", userId)
        .eq("source_version", row.version);
      if (error) dbError(error);
      continue;
    }
    if (base.source_version === row.version && base.material_hash !== hash) {
      const { error } = await admin.from("social_activities_v3")
        .update({ material_hash: hash, active: true })
        .eq("id", base.id).eq("source_version", row.version).eq("material_hash", base.material_hash);
      if (error) dbError(error);
    }
    // Historical achievement cards remain historical. A post-reset round does
    // not use pre-reset performance to invent a new personal-best baseline.
    const currentInstant = round ? Date.parse(round.completedAt || "") : Number.NaN;
    const baselines = resetAt !== null && resetAt !== undefined && Number.isFinite(currentInstant) && currentInstant >= resetAt
      ? afterResetSnapshots : allSnapshots;
    const summary = round && complete && resetAt !== undefined ? deriveRoundAchievements(round,
      baselines, userId) : null;
    if (!summary?.achievements.length) {
      const { error } = await admin.from("social_activities_v3").update({ active: false })
        .eq("source_round_id", row.id).eq("author_id", userId)
        .eq("event_kind", "ACHIEVEMENT").lte("source_version", row.version);
      if (error) dbError(error);
      continue;
    }
    const audience = preferences.shareAchievements && friendsPrivacy ? "FRIENDS" : "OWNER";
    const achievementRow = {
      author_id: userId, event_kind: "ACHIEVEMENT", source_round_id: row.id,
      local_round_id: row.local_round_id, source_version: row.version,
      material_hash: hash, audience, active: true,
    };
    const existing = eventMap.get(`${row.id}:ACHIEVEMENT`);
    if (existing) {
      const { error } = await admin.from("social_activities_v3").update(achievementRow)
        .eq("id", existing.id).lte("source_version", row.version);
      if (error) dbError(error);
    } else {
      const { error } = await admin.from("social_activities_v3").insert(achievementRow);
      if (error && error.code !== "23505") dbError(error);
    }
  }
}

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
}
export async function reconcileSocialEquipmentActivity(admin: SupabaseClient, userId: string): Promise<void> {
  const { data: source, error: sourceError } = await admin.from("player_equipment_profiles")
    .select("version,snapshot").eq("user_id", userId).maybeSingle();
  if (sourceError) dbError(sourceError);
  if (!source) return;
  const { data: event, error } = await admin.from("social_activities_v3")
    .select("id,source_version,material_hash").eq("source_equipment_user_id", userId)
    .eq("event_kind", "EQUIPMENT_UPDATED").maybeSingle();
  if (error) dbError(error);
  if (!event || event.source_version !== source.version) return;
  const hash = await sha256({ schema: "equipment-social-v1", version: source.version, snapshot: source.snapshot });
  if (hash === event.material_hash) return;
  const { error: updateError } = await admin.from("social_activities_v3")
    .update({ material_hash: hash }).eq("id", event.id).eq("source_version", source.version)
    .eq("material_hash", event.material_hash);
  if (updateError) dbError(updateError);
}

export async function getPreferences(ctx: SocialContext): Promise<SocialPreferencesResult> {
  const { data, error } = await ctx.client.from("social_activity_preferences_v3")
    .select("*").eq("user_id", ctx.userId).maybeSingle();
  if (error) dbError(error);
  return { data: { ...prefsFromRow(data), enabledForFriends: await socialPrivacy(ctx.client, ctx.userId) } };
}
export async function updatePreferences(ctx: SocialContext, preferences: unknown): Promise<SocialPreferencesResult> {
  const keys: Array<keyof SocialActivityPreferences> = [
    "shareRounds", "shareAchievements", "shareEquipment", "shareCourses", "notifyLike",
    "notifyComment", "notifyAttest", "notifyFriendAchievement", "notifyEquipment",
  ];
  const candidate = preferences && typeof preferences === "object" ? preferences as Record<string, unknown> : null;
  if (!candidate || keys.some(key => typeof candidate[key] !== "boolean") || (Object.hasOwn(candidate, "enabledForFriends") && typeof candidate.enabledForFriends !== "boolean"))
    throw new SocialServiceError("INVALID_REQUEST", 400, "Preferencias inválidas.");
  const verified = candidate as SocialActivityPreferences;
  const { data, error } = await ctx.client.from("social_activity_preferences_v3")
    .upsert(prefsToRow(ctx.userId, verified), { onConflict: "user_id" }).select("*").single();
  if (error) dbError(error);
  // Never infer publication consent from a public directory card. Only an
  // explicit master choice changes the existing DB-enforced audience gate.
  if (typeof candidate.enabledForFriends === "boolean") {
    const audience = candidate.enabledForFriends ? "FRIENDS" : "PRIVATE";
    const result = await ctx.client.from("profiles").update({ social_privacy: audience }).eq("id", ctx.userId).select("social_privacy").single();
    if (result.error) dbError(result.error);
    if (result.data.social_privacy !== audience) throw new SocialServiceError("MUTATION_FAILED", 503, "No se confirmó la audiencia.");
  }
  return { data: { ...prefsFromRow(data), enabledForFriends: await socialPrivacy(ctx.client, ctx.userId) } };
}

async function sourceRound(ctx: SocialContext, row: ActivityRow): Promise<RoundRow | null> {
  if (!row.source_round_id) return null;
  const { data, error } = await ctx.admin.from("rounds_cloud")
    .select("id,owner_id,local_round_id,version,snapshot")
    .eq("id", row.source_round_id).maybeSingle();
  if (error) dbError(error);
  const source = data as RoundRow | null;
  if (!source) return null;
  const round = completedSnapshot(source);
  const principal = round?.players?.filter(player => player.accountUserId === row.author_id) || [];
  if (principal.length !== 1 || !principal[0]?.id) return null;
  if (source.owner_id === row.author_id && round?.ownerId === principal[0].id) return source;
  const { data: link, error: linkError } = await ctx.admin.from("social_round_account_links_v3")
    .select("player_key,verified_by").eq("round_id", source.id).eq("user_id", row.author_id)
    .eq("player_key", principal[0].id).eq("verified_by", "SELF_CONFIRMED").maybeSingle();
  if (linkError) dbError(linkError);
  return link ? source : null;
}
async function authorProfile(admin: SupabaseClient, userId: string): Promise<SocialActivityAuthor> {
  const [{ data: social, error: socialError }, { data: profile, error: profileError }] = await Promise.all([
    admin.from("social_profiles").select("username,display_name,avatar_url").eq("user_id", userId).maybeSingle(),
    admin.from("profiles").select("name,display_name,username,avatar_url").eq("id", userId).maybeSingle(),
  ]);
  if (socialError && socialError.code !== "42P01") dbError(socialError);
  if (profileError) dbError(profileError);
  return socialActivityAuthor(userId, profile, social);
}
async function counts(ctx: SocialContext, row: ActivityRow) {
  const base = row.id;
  const hash = row.material_hash;
  const [likes, mine, comments, attestations, attested] = await Promise.all([
    ctx.client.from("social_likes_v3").select("activity_id", { count: "exact", head: true })
      .eq("activity_id", base).eq("expected_hash", hash),
    ctx.client.from("social_likes_v3").select("user_id").eq("activity_id", base)
      .eq("expected_hash", hash).eq("user_id", ctx.userId).maybeSingle(),
    ctx.client.from("social_comments_v3").select("id", { count: "exact", head: true })
      .eq("activity_id", base).eq("expected_hash", hash),
    ctx.client.from("social_round_attestations_v3").select("id", { count: "exact", head: true })
      .eq("activity_id", base).eq("expected_hash", hash),
    ctx.client.from("social_round_attestations_v3").select("id").eq("activity_id", base)
      .eq("expected_hash", hash).eq("attester_id", ctx.userId).maybeSingle(),
  ]);
  for (const result of [likes, mine, comments, attestations, attested]) if (result.error) dbError(result.error);
  return {
    likesCount: likes.count ?? 0, likedByMe: Boolean(mine.data), commentsCount: comments.count ?? 0,
    attestCount: attestations.count ?? 0, isAttestedByMe: Boolean(attested.data),
  };
}
async function participantStatus(ctx: SocialContext, row: ActivityRow, source: RoundRow | null, isAttestedByMe: boolean) {
  if (row.event_kind !== "ROUND_COMPLETED" || !source || row.author_id === ctx.userId)
    return { canAttest: false, requiresParticipantConfirmation: false, participantPlayerKey: null };
  const round = completedSnapshot(source);
  const matches = round?.players?.filter(player => player.accountUserId === ctx.userId) || [];
  if (matches.length !== 1 || !matches[0].id) return { canAttest: false, requiresParticipantConfirmation: false, participantPlayerKey: null };
  const playerKey = matches[0].id;
  // The organizer's account is already linked by the canonical round-write
  // trigger. It cannot self-confirm (nor should it need to) to attest a peer.
  const verifiedBy = source.owner_id === ctx.userId && round?.ownerId === playerKey
    ? "ROUND_OWNER" : "SELF_CONFIRMED";
  const confirmed = await ctx.admin.from("social_round_account_links_v3").select("player_key,verified_by")
    .eq("round_id", source.id).eq("user_id", ctx.userId).eq("player_key", playerKey)
    .eq("verified_by", verifiedBy).maybeSingle();
  if (confirmed.error) dbError(confirmed.error);
  return {
    canAttest: Boolean(confirmed.data) && !isAttestedByMe,
    requiresParticipantConfirmation: !confirmed.data,
    participantPlayerKey: playerKey,
  };
}
async function achievementLabelsFor(ctx: SocialContext, source: RoundRow | null, authorId: string) {
  if (!source || !completedSnapshot(source)) return [];
  const [{ rows, complete }, resetAt] = await Promise.all([
    cachedRounds(ctx, authorId), cachedReset(ctx, authorId),
  ]);
  if (!complete || resetAt === undefined) return [];
  const currentInstant = Date.parse(source.snapshot.completedAt || "");
  const baselines = resetAt !== null && Number.isFinite(currentInstant) && currentInstant >= resetAt
    ? rows.filter(row => Date.parse(row.snapshot?.completedAt || "") >= resetAt) : rows;
  const summary = deriveRoundAchievements(source.snapshot, baselines.map(row => row.snapshot), authorId);
  return summary ? roundAchievementLabels(summary) : [];
}
async function cardFromAuthorizedRow(ctx: SocialContext, row: ActivityRow, includeScorecard = false): Promise<SocialActivityCard | null> {
  const source = await sourceRound(ctx, row);
  if (row.source_round_id) {
    const round = source && completedSnapshot(source);
    if (!round || source.version !== row.source_version) return null;
    const currentHash = await roundMaterialFingerprint(round, row.author_id);
    if (!currentHash || currentHash !== row.material_hash) return null;
  } else if (!SHA256.test(row.material_hash)) return null;
  const preference = await cachedPrefs(ctx, row.author_id);
  const canShowAchievements = row.event_kind === "ACHIEVEMENT" || row.author_id === ctx.userId
    || preference.shareAchievements;
  const canShowCourse = row.author_id === ctx.userId || preference.shareCourses;
  const [author, engagement, achievements] = await Promise.all([
    cachedAuthor(ctx, row.author_id), counts(ctx, row),
    canShowAchievements && row.source_round_id
      ? achievementLabelsFor(ctx, source, row.author_id) : Promise.resolve([]),
  ]);
  const status = await participantStatus(ctx, row, source, engagement.isAttestedByMe);
  let courseEvent;
  if (source && row.event_kind === "ROUND_COMPLETED" && canShowCourse) {
    const cache = requestCache(ctx).homeClubs;
    if (!cache.has(row.author_id)) cache.set(row.author_id, (async () => {
      const result = await ctx.admin.auth.admin.getUserById(row.author_id);
      if (result.error) return null; // Missing evidence is not a new-course claim.
      const id = result.data.user?.user_metadata?.backyard_golf_profile_v1?.homeClubId;
      return typeof id === "string" ? id : null;
    })());
    const [homeClub, history] = await Promise.all([cache.get(row.author_id)!, cachedRounds(ctx, row.author_id)]);
    if (history.complete) courseEvent = newCoursePlayedEvent(source.snapshot,
      history.rows.map(r => r.snapshot), row.author_id, homeClub, INTERNAL_GOLF_COURSE_CATALOG) || undefined;
  }
  return {
    id: row.id, type: row.event_kind, audience: row.audience, author,
    createdAt: row.created_at, sourceVersion: Number(row.source_version), currentHash: row.material_hash,
    roundId: source?.id ?? null,
    round: source && row.event_kind === "ROUND_COMPLETED"
      ? safeSocialRoundCard(source, row.author_id, includeScorecard, canShowCourse) : null,
    achievements, ...(courseEvent ? { courseEvent } : {}), ...engagement, ...status,
    targetUserId: row.event_kind === "ROUND_COMPLETED" ? row.author_id : null,
  };
}
async function authorizedRow(ctx: SocialContext, id: string): Promise<ActivityRow> {
  const { data, error } = await ctx.client.from("social_activities_v3")
    .select("*").eq("id", validId(id)).eq("active", true).maybeSingle();
  if (error) dbError(error);
  if (!data) throw new SocialServiceError("NOT_FOUND", 404, "Actividad no disponible.");
  return data as ActivityRow;
}
async function refreshAuthorizedRow(ctx: SocialContext, row: ActivityRow) {
  if (row.source_round_id) {
    const source = await sourceRound(ctx, row);
    const round = source && completedSnapshot(source);
    const hash = round && source.version === row.source_version
      ? await roundMaterialFingerprint(round, row.author_id) : null;
    if (hash !== row.material_hash) await reconcileSocialRoundActivities(ctx.admin, row.author_id);
  } else if (row.source_equipment_user_id) {
    if (!SHA256.test(row.material_hash)) await reconcileSocialEquipmentActivity(ctx.admin, row.author_id);
  }
  return authorizedRow(ctx, row.id);
}
async function recoverVisibleSources(ctx: SocialContext) {
  const { data, error } = await recoveryStep("friendships", () => ctx.admin.from("friendships")
    .select("user_a_id,user_b_id")
    .or(`user_a_id.eq.${ctx.userId},user_b_id.eq.${ctx.userId}`).limit(201));
  if (error) dbError(error);
  if ((data || []).length > 200)
    throw new SocialRecoveryError("bounded_batch", new SocialServiceError("MUTATION_FAILED", 503, "El feed tiene demasiadas fuentes para recuperarse en una solicitud."));
  const authorIds = [...new Set([
    ctx.userId, ...(data || []).map(row => row.user_a_id === ctx.userId ? row.user_b_id : row.user_a_id),
  ])];
  const pending = new Map<string, Set<string>>();
  let truncated = false;
  const md5Pattern = "_".repeat(32); // SQL LIKE: exactly 32 chars, never a definitive SHA-256.
  for (let offset = 0; offset < authorIds.length; offset += 50) {
    const { data: provisional, count, error: candidateError } = await recoveryStep("legacy_candidates", () => ctx.admin.from("social_activities_v3")
      .select("author_id,event_kind", { count: "exact" }).in("author_id", authorIds.slice(offset, offset + 50))
      .eq("active", true).like("material_hash", md5Pattern)
      .order("updated_at", { ascending: false }).limit(201));
    if (candidateError) dbError(candidateError);
    if ((count ?? 0) > 201) truncated = true;
    for (const event of provisional || []) {
      if (!pending.has(event.author_id)) pending.set(event.author_id, new Set());
      pending.get(event.author_id)!.add(event.event_kind);
    }
  }
  const candidates = [...pending.entries()];
  await Promise.all(candidates.slice(0, 5).map(async ([authorId, kinds]) => {
    if (kinds.has("EQUIPMENT_UPDATED")) await recoveryStep("equipment_reconcile", () => reconcileSocialEquipmentActivity(ctx.admin, authorId));
    if (kinds.has("ROUND_COMPLETED") || kinds.has("ACHIEVEMENT"))
      await recoveryStep("round_reconcile", () => reconcileSocialRoundActivities(ctx.admin, authorId));
  }));
  if (candidates.length > 5 || truncated) {
    throw new SocialRecoveryError("bounded_batch", new SocialServiceError("MUTATION_FAILED", 503,
      "La actividad se está recuperando; vuelve a cargar para continuar."));
  }
}

/**
 * Legacy activity repair is maintenance, not the source of truth for the feed.
 * A transient repair failure must never hide already-authorized activity or
 * turn an otherwise readable feed into a 503.
 */
async function recoverVisibleSourcesBestEffort(ctx: SocialContext) {
  try {
    await recoverVisibleSources(ctx);
  } catch (error) {
    const safe = error && typeof error === "object"
      ? error as { code?: unknown; status?: unknown; stage?: unknown }
      : {};
    console.warn("backyard_social_recovery_deferred", {
      code: typeof safe.code === "string" ? safe.code : "UNKNOWN",
      status: typeof safe.status === "number" ? safe.status : undefined,
      stage: typeof safe.stage === "string" ? safe.stage : "unknown",
    });
  }
}

export async function listActivity(
  ctx: SocialContext, query: { localRoundId?: string; limit?: number; cursor?: string; friendsOnly?: boolean } = {},
): Promise<SocialActivityPage> {
  await recoverVisibleSourcesBestEffort(ctx);
  const limit = Math.min(30, Math.max(1, Math.floor(query.limit || 15)));
  let builder = ctx.client.from("social_activities_v3").select("*")
    .eq("active", true).order("created_at", { ascending: false }).order("id", { ascending: false });
  if (query.friendsOnly) {
    const friends = await ctx.client.from("friendships").select("user_a_id,user_b_id").or(`user_a_id.eq.${ctx.userId},user_b_id.eq.${ctx.userId}`);
    if (friends.error) dbError(friends.error);
    const ids = (friends.data || []).map(row => row.user_a_id === ctx.userId ? row.user_b_id : row.user_a_id);
    if (!ids.length) return { data: [], nextCursor: null };
    builder = builder.in("author_id", ids);
  }
  if (query.localRoundId) {
    if (query.localRoundId.length > 120) throw new SocialServiceError("INVALID_REQUEST", 400, "Ronda inválida.");
    builder = builder.eq("local_round_id", query.localRoundId);
  }
  if (query.cursor) {
    const [at, id, extra] = query.cursor.split("|");
    if (extra || !at || !id || !UTC_INSTANT.test(at) || !Number.isFinite(Date.parse(at)) || !UUID.test(id))
      throw new SocialServiceError("INVALID_REQUEST", 400, "Cursor inválido.");
    builder = builder.or(`created_at.lt."${at}",and(created_at.eq."${at}",id.lt.${id})`);
  }
  const { data, error } = await builder.limit(limit * 3 + 1);
  if (error) dbError(error);
  const rows = (data || []) as ActivityRow[];
  const grouped = new Map<string, ActivityRow>();
  for (const row of rows) {
    const key = row.source_round_id ? `${row.source_round_id}:${row.author_id}` : row.id;
    const previous = grouped.get(key);
    if (!previous || (previous.event_kind === "ACHIEVEMENT" && row.event_kind === "ROUND_COMPLETED"))
      grouped.set(key, row);
  }
  const page = [...grouped.values()]
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .slice(0, limit);
  // The SQL candidate pass bounded recovery; no N-friends full-history scan.
  // Viewer RLS and canonical source/hash are rechecked for each returned card.
  const result: SocialActivityCard[] = [];
  for (const row of page) {
    try {
      const refreshed = await authorizedRow(ctx, row.id);
      const card = await cardFromAuthorizedRow(ctx, refreshed);
      if (card) result.push(card);
    } catch (error) {
      if (!(error instanceof SocialServiceError) || error.code !== "NOT_FOUND") throw error;
    }
  }
  const last = page.at(-1);
  return { data: result, nextCursor: last && (grouped.size > limit || rows.length > limit * 3)
    ? `${last.created_at}|${last.id}` : null };
}

export async function getActivity(ctx: SocialContext, id: string): Promise<SocialActivityDetail> {
  await recoverVisibleSources(ctx);
  const row = await refreshAuthorizedRow(ctx, await authorizedRow(ctx, id));
  const card = await cardFromAuthorizedRow(ctx, row, true);
  if (!card) throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; actualiza para verla.");
  return { data: card };
}

async function currentMutationActivity(ctx: SocialContext, activityId: string, expectedHash: unknown) {
  const hash = validHash(expectedHash);
  const row = await refreshAuthorizedRow(ctx, await authorizedRow(ctx, activityId));
  const card = await cardFromAuthorizedRow(ctx, row);
  if (!card || row.material_hash !== hash)
    throw new SocialServiceError("STALE_REVISION", 409, "La actividad cambió; actualiza antes de continuar.");
  return { row, card, hash };
}

export async function mutateLike(
  ctx: SocialContext, activityId: string, request: { expectedHash: string }, liked: boolean,
): Promise<{ data: SocialActivityCard }> {
  const { row, hash } = await currentMutationActivity(ctx, activityId, request?.expectedHash);
  if (liked) {
    const { error } = await ctx.client.from("social_likes_v3")
      .insert({ activity_id: row.id, user_id: ctx.userId, expected_hash: hash });
    if (error && error.code !== "23505") dbError(error);
  } else {
    const { error } = await ctx.client.from("social_likes_v3").delete()
      .eq("activity_id", row.id).eq("user_id", ctx.userId).eq("expected_hash", hash);
    if (error) dbError(error);
  }
  return (await getActivity(ctx, row.id));
}

async function ensureCommentActivity(ctx: SocialContext, activityId: string, expectedHash: unknown) {
  const current = await currentMutationActivity(ctx, activityId, expectedHash);
  if (current.row.event_kind === "EQUIPMENT_UPDATED") return current;
  return current;
}
async function commentAuthor(ctx: SocialContext, userId: string) { return authorProfile(ctx.admin, userId); }
async function mapComment(ctx: SocialContext, row: Record<string, string>): Promise<SocialComment> {
  return {
    id: row.id, activityId: row.activity_id,
    author: await commentAuthor(ctx, row.author_id), text: row.body, createdAt: row.created_at,
  };
}
function commentText(text: unknown) {
  if (typeof text !== "string") throw new SocialServiceError("INVALID_REQUEST", 400, "Comentario inválido.");
  const trimmed = text.trim();
  if (!trimmed) throw new SocialServiceError("INVALID_REQUEST", 400, "Escribe un comentario.");
  if (trimmed.length > 500) throw new SocialServiceError("COMMENT_TOO_LONG", 400, "Máximo 500 caracteres.");
  return trimmed;
}
export async function listComments(ctx: SocialContext, activityId: string): Promise<{ data: SocialComment[] }> {
  const row = await refreshAuthorizedRow(ctx, await authorizedRow(ctx, activityId));
  if (!await cardFromAuthorizedRow(ctx, row))
    throw new SocialServiceError("STALE_REVISION", 409, "La actividad cambió.");
  const { data, error } = await ctx.client.from("social_comments_v3")
    .select("id,activity_id,author_id,body,created_at").eq("activity_id", row.id)
    .eq("expected_hash", row.material_hash).order("created_at", { ascending: true }).limit(100);
  if (error) dbError(error);
  return { data: await Promise.all((data || []).map(comment => mapComment(ctx, comment))) };
}
export async function createComment(
  ctx: SocialContext, activityId: string, request: SocialCommentRequest,
): Promise<{ data: SocialComment }> {
  const { row, hash } = await ensureCommentActivity(ctx, activityId, request?.expectedHash);
  const { data, error } = await ctx.client.from("social_comments_v3")
    .insert({ activity_id: row.id, author_id: ctx.userId,
      body: commentText(request?.text), expected_hash: hash })
    .select("id,activity_id,author_id,body,created_at").single();
  if (error) dbError(error);
  return { data: await mapComment(ctx, data) };
}
export async function updateComment(
  ctx: SocialContext, activityId: string, commentId: string, request: SocialCommentRequest,
): Promise<{ data: SocialComment }> {
  const { row, hash } = await ensureCommentActivity(ctx, activityId, request?.expectedHash);
  const { data, error } = await ctx.client.from("social_comments_v3")
    .update({ body: commentText(request?.text) })
    .eq("id", validId(commentId)).eq("activity_id", row.id)
    .eq("author_id", ctx.userId).eq("expected_hash", hash)
    .select("id,activity_id,author_id,body,created_at").maybeSingle();
  if (error) dbError(error);
  if (!data) throw new SocialServiceError("NOT_FOUND", 404, "Comentario no encontrado en esta revisión.");
  return { data: await mapComment(ctx, data) };
}
export async function deleteComment(
  ctx: SocialContext, activityId: string, commentId: string, request: { expectedHash: string },
): Promise<{ data: { deleted: boolean } }> {
  const { row, hash } = await ensureCommentActivity(ctx, activityId, request?.expectedHash);
  const { data, error } = await ctx.client.from("social_comments_v3").delete()
    .eq("id", validId(commentId)).eq("activity_id", row.id)
    .eq("author_id", ctx.userId).eq("expected_hash", hash).select("id").maybeSingle();
  if (error) dbError(error);
  return { data: { deleted: Boolean(data) } };
}

export async function confirmParticipant(
  ctx: SocialContext, roundId: string, request: SocialParticipantConfirmRequest,
): Promise<{ data: { confirmed: boolean; playerKey: string } }> {
  validId(roundId);
  validHash(request?.expectedHash);
  if (typeof request?.playerKey !== "string" || !request.playerKey.trim() || request.playerKey.length > 120
    || !Number.isInteger(request.expectedVersion) || request.expectedVersion < 1)
    throw new SocialServiceError("INVALID_REQUEST", 400, "Participante inválido.");
  const { data: source, error: sourceError } = await ctx.admin.from("rounds_cloud")
    .select("id,owner_id,local_round_id,version,snapshot").eq("id", roundId).maybeSingle();
  if (sourceError) dbError(sourceError);
  if (!source || !completedSnapshot(source as RoundRow))
    throw new SocialServiceError("NOT_FOUND", 404, "Ronda completada no disponible.");
  const canonical = source as RoundRow;
  await reconcileSocialRoundActivities(ctx.admin, canonical.owner_id);
  const { data: event, error: eventError } = await ctx.admin.from("social_activities_v3")
    .select("id,material_hash,source_version,active").eq("source_round_id", roundId)
    .eq("author_id", canonical.owner_id).eq("event_kind", "ROUND_COMPLETED").maybeSingle();
  if (eventError) dbError(eventError);
  if (!event || !event.active || event.source_version !== canonical.version || event.material_hash !== request.expectedHash)
    throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; actualiza antes de confirmar.");
  const actualHash = await roundMaterialFingerprint(canonical.snapshot, canonical.owner_id);
  if (!actualHash || actualHash !== event.material_hash)
    throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; actualiza antes de confirmar.");
  const matches = canonical.snapshot.players?.filter(player => player.id === request.playerKey && player.accountUserId === ctx.userId) || [];
  if (matches.length !== 1 || ctx.userId === canonical.owner_id)
    throw new SocialServiceError("PARTICIPANT_NOT_LINKED", 403, "Tu cuenta no está vinculada a este jugador de la ronda.");
  const { error } = await ctx.client.from("social_round_account_links_v3").insert({
    round_id: roundId, user_id: ctx.userId, player_key: request.playerKey,
    verified_by: "SELF_CONFIRMED",
  });
  if (error && error.code !== "23505") dbError(error);
  // Capture this participant's evidence once, using only the frozen tee/score
  // and their own verified Auth preference. Never rewrite the organizer view.
  const auth = await ctx.client.auth.getUser();
  if (auth.error || auth.data.user?.id !== ctx.userId)
    throw new SocialServiceError("AUTH_REQUIRED", 401, "Vuelve a iniciar sesión.");
  const preference = parseIndexPreference(auth.data.user.user_metadata?.[BACKYARD_INDEX_METADATA_KEY], ctx.userId);
  for (let attempt = 0; attempt < 3; attempt++) {
    const fresh = await ctx.admin.from("rounds_cloud").select("id,version,snapshot").eq("id", roundId).single();
    if (fresh.error) dbError(fresh.error);
    const snapshot = fresh.data.snapshot as RoundSnapshot;
    if (snapshot.backyardIndexSnapshots?.some(item => item.accountUserId === ctx.userId)) break;
    const participant = snapshot.players?.filter(p => p.accountUserId === ctx.userId);
    if (snapshot.lifecycleState !== "completed" || participant?.length !== 1 || participant[0].id !== request.playerKey)
      throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; actualiza antes de confirmar.");
    const enabledBeforeClose = preference && Date.parse(preference.updatedAt) <= Date.parse(snapshot.completedAt || "");
    const captured = captureCompletedRoundIndex(snapshot, ctx.userId, enabledBeforeClose ? preference : null);
    const saved = await ctx.admin.rpc("append_confirmed_round_index", {
      p_round_id: roundId, p_account_user_id: ctx.userId, p_expected_version: fresh.data.version,
      p_record: captured.backyardIndexSnapshots?.find(item => item.accountUserId === ctx.userId),
    });
    if (saved.error) dbError(saved.error);
    if (saved.data === true) break;
    if (attempt === 2) throw new SocialServiceError("STALE_REVISION", 409, "La ronda cambió; reintenta la confirmación.");
  }
  // The append advances the canonical row version. Restore the owner's strong
  // material hash before returning, so an immediate attest does not encounter
  // the trigger's provisional hash/RLS rejection. Index evidence is nonmaterial.
  await reconcileSocialRoundActivities(ctx.admin, canonical.owner_id);
  await reconcileSocialRoundActivities(ctx.admin, ctx.userId);
  return { data: { confirmed: true, playerKey: request.playerKey } };
}

export async function attestRound(
  ctx: SocialContext, roundId: string, request: SocialAttestRequest,
): Promise<{ data: { attested: boolean } }> {
  validId(roundId);
  validId(request?.targetUserId);
  validHash(request?.expectedHash);
  if (!Number.isInteger(request?.expectedVersion) || request.expectedVersion < 1)
    throw new SocialServiceError("INVALID_REQUEST", 400, "Versión inválida.");
  if (request.targetUserId === ctx.userId) throw new SocialServiceError("ATTEST_SELF", 400, "No puedes confirmar tu propia ronda.");
  const { data: event, error } = await ctx.client.from("social_activities_v3").select("*")
    .eq("source_round_id", roundId).eq("author_id", request.targetUserId)
    .eq("event_kind", "ROUND_COMPLETED").eq("active", true).maybeSingle();
  if (error) dbError(error);
  if (!event || event.author_id !== request.targetUserId)
    throw new SocialServiceError("NOT_FOUND", 404, "Ronda social no disponible.");
  const { row, card, hash } = await currentMutationActivity(ctx, event.id, request.expectedHash);
  if (!card.canAttest) {
    if (card.requiresParticipantConfirmation)
      throw new SocialServiceError("PARTICIPANT_CONFIRMATION_REQUIRED", 409, "Confirma tu participación antes de confirmar la ronda de otra persona.");
    if (card.isAttestedByMe) throw new SocialServiceError("ALREADY_ATTESTED", 409, "Ya confirmaste esta ronda.");
    throw new SocialServiceError("PARTICIPANT_NOT_LINKED", 403, "Tu cuenta no figura como participante confirmado.");
  }
  const { error: insertError } = await ctx.client.from("social_round_attestations_v3").insert({
    activity_id: row.id, round_id: roundId, attester_id: ctx.userId,
    target_user_id: request.targetUserId, expected_version: Number(row.source_version), expected_hash: hash,
  });
  if (insertError) dbError(insertError);
  return { data: { attested: true } };
}

export async function listNotifications(ctx: SocialContext): Promise<SocialNotificationPage> {
  const { data, error } = await ctx.client.from("notification_events_v2")
    .select("id,event_type,resource_id,created_at,read_at")
    .eq("recipient_id", ctx.userId).in("event_type", ["like", "comment", "attest", "friend_achievement", "equipment", "friend_request"])
    .order("created_at", { ascending: false }).limit(50);
  if (error) dbError(error);
  const visible = [] as SocialNotificationPage["data"];
  for (const event of data || []) {
    if (!UUID.test(event.resource_id)) continue;
    if (event.event_type === "friend_request") {
      const request = await ctx.client.from("friend_requests").select("id,state").eq("id", event.resource_id).eq("addressee_id", ctx.userId).maybeSingle();
      if (request.error) dbError(request.error);
      if (request.data?.state === "PENDING") visible.push({ id: event.id, type: "friend_request", activityId: event.resource_id, createdAt: event.created_at, readAt: event.read_at });
      continue;
    }
    try {
      const activity = await authorizedRow(ctx, event.resource_id);
      if (!SHA256.test(activity.material_hash)) continue;
      visible.push({
        id: event.id, type: event.event_type as SocialNotificationPage["data"][number]["type"],
        activityId: event.resource_id, createdAt: event.created_at, readAt: event.read_at,
      });
    } catch (failure) {
      if (!(failure instanceof SocialServiceError) || failure.code !== "NOT_FOUND") throw failure;
    }
  }
  return { data: visible, nextCursor: null };
}
