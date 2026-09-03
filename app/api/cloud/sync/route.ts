import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseForUser } from "../../../../lib/supabase/server";
import { cloudServerEnabled } from "../../../../lib/feature-flags";
import type { CloudDataBundle, CloudEntityType, CloudTombstone } from "../../../../lib/cloud-sync";

const MAX_BODY_BYTES = 5_000_000;

function bearer(request: NextRequest) {
  return (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

async function accountClient(request: NextRequest) {
  if (!cloudServerEnabled) return { error: "La sincronización de nube está desactivada.", status: 503 } as const;
  const token = bearer(request);
  if (!token) return { error: "Inicia sesión para sincronizar con Supabase.", status: 401 } as const;
  const client = token ? getSupabaseForUser(token) : null;
  if (!client) return { error: "Nube no configurada.", status: 503 } as const;
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return { error: "Sesión inválida.", status: 401 } as const;
  return { client, userId: data.user.id } as const;
}

function safeArray<T>(value: unknown, limit: number): T[] {
  return Array.isArray(value) ? value.slice(0, limit) as T[] : [];
}

function localId(item: unknown) {
  if (!item || typeof item !== "object") return "";
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" ? id.slice(0, 200) : "";
}

async function upsertRows(client: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  for (let index = 0; index < rows.length; index += 100) {
    const { error } = await client.from(table).upsert(rows.slice(index, index + 100), { onConflict: "owner_id,local_id" });
    if (error) throw error;
  }
}

function itemTimestamp(value: unknown) {
  const parsed = Date.parse(typeof value === "string" ? value : "");
  return Number.isFinite(parsed) ? parsed : 0;
}

async function onlyNewerRows(
  client: SupabaseClient,
  table: string,
  userId: string,
  incoming: Record<string, unknown>[],
  updatedAtOf: (item: Record<string, unknown>) => unknown,
) {
  if (!incoming.length) return incoming;
  const { data, error } = await client.from(table).select("local_id,updated_at").eq("owner_id", userId).not("local_id", "is", null);
  if (error) throw error;
  const remote = new Map((data || []).map((item) => [String(item.local_id), itemTimestamp(item.updated_at)]));
  return incoming.filter((item) => !remote.has(localId(item)) || itemTimestamp(updatedAtOf(item)) > (remote.get(localId(item)) || 0));
}

const CLOUD_TABLES: Record<CloudEntityType, string> = {
  round: "rounds_cloud",
  frequent_player: "players",
  frequent_group: "frequent_groups_cloud",
  rival: "personal_rivals_cloud",
  course: "courses_cloud",
};

function validTombstones(value: unknown) {
  const validTypes = new Set(Object.keys(CLOUD_TABLES));
  return safeArray<CloudTombstone>(value, 5_000).filter((item) => item && validTypes.has(item.entityType) && typeof item.localId === "string" && item.localId.length > 0 && item.localId.length <= 200 && Number.isFinite(Date.parse(item.deletedAt)));
}

async function applyTombstones(client: SupabaseClient, userId: string, tombstones: CloudTombstone[]) {
  if (tombstones.length) {
    const { error } = await client.from("cloud_deletions").upsert(tombstones.map((item) => ({ owner_id: userId, entity_type: item.entityType, local_id: item.localId, deleted_at: item.deletedAt })), { onConflict: "owner_id,entity_type,local_id" });
    if (error) throw error;
  }
  const { data, error } = await client.from("cloud_deletions").select("entity_type,local_id,deleted_at").eq("owner_id", userId);
  if (error) throw error;
  const all = (data || []).map((item) => ({ entityType: item.entity_type as CloudEntityType, localId: String(item.local_id), deletedAt: String(item.deleted_at) }));
  for (const [entityType, table] of Object.entries(CLOUD_TABLES) as Array<[CloudEntityType, string]>) {
    const ids = all.filter((item) => item.entityType === entityType).map((item) => item.localId);
    for (let index = 0; index < ids.length; index += 100) {
      const { error: deleteError } = await client.from(table).delete().eq("owner_id", userId).in("local_id", ids.slice(index, index + 100));
      if (deleteError) throw deleteError;
    }
  }
  return all;
}

async function projectRoundSnapshots(client: SupabaseClient, userId: string, history: Record<string, unknown>[]) {
  if (!history.length) return;
  const ids = history.map(localId);
  const { data: cloudRounds, error } = await client.from("rounds_cloud").select("id,local_id").eq("owner_id", userId).in("local_id", ids);
  if (error) throw error;
  const cloudIdByLocal = new Map((cloudRounds || []).map((row) => [String(row.local_id), String(row.id)]));
  for (const round of history) {
    const roundId = cloudIdByLocal.get(localId(round));
    if (!roundId) continue;
    const players = safeArray<Record<string, unknown>>(round.players, 200).filter(localId);
    const { error: clearPlayersError } = await client.from("round_players_cloud").delete().eq("round_id", roundId);
    if (clearPlayersError) throw clearPlayersError;
    if (players.length) {
      const { data: insertedPlayers, error: playersError } = await client.from("round_players_cloud").insert(players.map((player) => ({
        round_id: roundId,
        local_player_id: localId(player),
        name: String(player.name || "Jugador").slice(0, 120),
        handicap: player.handicap ?? null,
      }))).select("id,local_player_id");
      if (playersError) throw playersError;
      const cloudPlayerByLocal = new Map((insertedPlayers || []).map((player) => [String(player.local_player_id), String(player.id)]));
      const scores = round.scores && typeof round.scores === "object" ? round.scores as Record<string, Record<string, unknown>> : {};
      const scoreRows: Record<string, unknown>[] = [];
      for (const [holeText, playerScores] of Object.entries(scores)) {
        const hole = Number(holeText);
        if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !playerScores || typeof playerScores !== "object") continue;
        for (const [playerLocalId, scoreValue] of Object.entries(playerScores)) {
          const score = Number(scoreValue);
          const cloudPlayerId = cloudPlayerByLocal.get(playerLocalId);
          if (cloudPlayerId && Number.isInteger(score) && score >= 1 && score <= 20) scoreRows.push({ round_player_id: cloudPlayerId, hole, score });
        }
      }
      if (scoreRows.length) {
        const { error: scoresError } = await client.from("round_scores_cloud").insert(scoreRows);
        if (scoresError) throw scoresError;
      }
    }
    const projections = [
      ["round_bet_configs", "config", round.betConfig || {}],
      ["round_bet_results", "results", round.categoryResults || {}],
      ["personal_bets_cloud", "bets", round.personalBets || round.personalResults || []],
      ["manual_bets_cloud", "bets", round.manualBets || []],
      ["expenses_cloud", "expenses", round.expenses || {}],
      ["round_course_snapshots", "course", round.courseSnapshot || {}],
      ["round_local_rules_snapshots", "local_rules", (round.courseSnapshot as { localRules?: unknown } | undefined)?.localRules || []],
    ] as const;
    for (const [table, column, value] of projections) {
      const { error: projectionError } = await client.from(table).upsert({ round_id: roundId, [column]: value });
      if (projectionError) throw projectionError;
    }
  }
}

export async function GET(request: NextRequest) {
  const account = await accountClient(request);
  if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
  const { client, userId } = account;
  const [rounds, players, groups, rivals, courses, preferences, state, deletions] = await Promise.all([
    client.from("rounds_cloud").select("snapshot").eq("owner_id", userId),
    client.from("players").select("snapshot").eq("owner_id", userId).not("local_id", "is", null),
    client.from("frequent_groups_cloud").select("snapshot").eq("owner_id", userId),
    client.from("personal_rivals_cloud").select("snapshot").eq("owner_id", userId),
    client.from("courses_cloud").select("snapshot").eq("owner_id", userId).not("local_id", "is", null),
    client.from("user_preferences").select("high_contrast,locale,notifications_enabled,default_handicap").eq("user_id", userId).maybeSingle(),
    client.from("user_cloud_state").select("active_draft").eq("user_id", userId).maybeSingle(),
    client.from("cloud_deletions").select("entity_type,local_id,deleted_at").eq("owner_id", userId),
  ]);
  const firstError = [rounds, players, groups, rivals, courses, preferences, state, deletions].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 400 });
  const data: CloudDataBundle = {
    version: 1,
    history: (rounds.data || []).map((row) => row.snapshot).filter(Boolean),
    frequentPlayers: (players.data || []).map((row) => row.snapshot).filter(Boolean),
    frequentGroups: (groups.data || []).map((row) => row.snapshot).filter(Boolean),
    rivals: (rivals.data || []).map((row) => row.snapshot).filter(Boolean),
    courses: (courses.data || []).map((row) => row.snapshot).filter(Boolean),
    preferences: {
      highContrast: Boolean(preferences.data?.high_contrast),
      language: preferences.data?.locale || "es-MX",
      notificationsEnabled: Boolean(preferences.data?.notifications_enabled),
      defaultHandicap: preferences.data?.default_handicap === null || preferences.data?.default_handicap === undefined ? null : Number(preferences.data.default_handicap),
      hasLocalState: true,
    },
    activeDraft: state.data?.active_draft ?? null,
    tombstones: (deletions.data || []).map((item) => ({ entityType: item.entity_type, localId: item.local_id, deletedAt: item.deleted_at })),
  } as CloudDataBundle;
  return NextResponse.json({ data }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: NextRequest) {
  const account = await accountClient(request);
  if ("error" in account) return NextResponse.json({ error: account.error }, { status: account.status });
  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Los datos exceden el tamaño permitido." }, { status: 413 });
  const body = await request.json().catch(() => null) as { data?: Partial<CloudDataBundle>; fingerprint?: string } | null;
  if (!body?.data || body.data.version !== 1 || typeof body.fingerprint !== "string") return NextResponse.json({ error: "Paquete de sincronización inválido." }, { status: 400 });
  const serializedLength = JSON.stringify(body).length;
  if (serializedLength > MAX_BODY_BYTES) return NextResponse.json({ error: "Los datos exceden el tamaño permitido." }, { status: 413 });

  const { client, userId } = account;
  let history = safeArray<Record<string, unknown>>(body.data.history, 1000).filter(localId);
  let players = safeArray<Record<string, unknown>>(body.data.frequentPlayers, 500).filter(localId);
  let groups = safeArray<Record<string, unknown>>(body.data.frequentGroups, 250).filter(localId);
  let rivals = safeArray<Record<string, unknown>>(body.data.rivals, 500).filter(localId);
  let courses = safeArray<Record<string, unknown>>(body.data.courses, 200).filter(localId);
  const now = new Date().toISOString();

  try {
    await client.from("account_data_migrations").upsert({ user_id: userId, local_fingerprint: body.fingerprint.slice(0, 160), status: "requested", updated_at: now }, { onConflict: "user_id,local_fingerprint" });
    const allTombstones = await applyTombstones(client, userId, validTombstones(body.data.tombstones));
    const deleted = new Set(allTombstones.map((item) => `${item.entityType}:${item.localId}`));
    history = history.filter((item) => !deleted.has(`round:${localId(item)}`));
    players = players.filter((item) => !deleted.has(`frequent_player:${localId(item)}`));
    groups = groups.filter((item) => !deleted.has(`frequent_group:${localId(item)}`));
    rivals = rivals.filter((item) => !deleted.has(`rival:${localId(item)}`));
    courses = courses.filter((item) => !deleted.has(`course:${localId(item)}`));
    [history, players, groups, rivals, courses] = await Promise.all([
      onlyNewerRows(client, "rounds_cloud", userId, history, (round) => round.updatedAt || round.completedAt || round.date),
      onlyNewerRows(client, "players", userId, players, (player) => player.updatedAt),
      onlyNewerRows(client, "frequent_groups_cloud", userId, groups, (group) => group.updatedAt),
      onlyNewerRows(client, "personal_rivals_cloud", userId, rivals, (rival) => rival.updatedAt),
      onlyNewerRows(client, "courses_cloud", userId, courses, (course) => course.updatedAt),
    ]);
    await Promise.all([
      upsertRows(client, "rounds_cloud", history.map((round) => ({ owner_id: userId, local_round_id: localId(round), local_id: localId(round), snapshot: round, updated_at: String(round.updatedAt || round.completedAt || round.date || now) }))),
      upsertRows(client, "players", players.map((player) => ({ owner_id: userId, local_id: localId(player), name: String(player.name || "Jugador").slice(0, 120), handicap: player.handicap ?? 0, usage_count: Number(player.uses) || 0, snapshot: player, updated_at: String(player.updatedAt || now) }))),
      upsertRows(client, "frequent_groups_cloud", groups.map((group) => ({ owner_id: userId, local_id: localId(group), name: String(group.name || "Grupo").slice(0, 160), snapshot: group, updated_at: String(group.updatedAt || now) }))),
      upsertRows(client, "personal_rivals_cloud", rivals.map((rival) => ({ owner_id: userId, local_id: localId(rival), name: String(rival.name || "Rival").slice(0, 120), snapshot: rival, updated_at: String(rival.updatedAt || now) }))),
      upsertRows(client, "courses_cloud", courses.map((course) => ({ owner_id: userId, local_id: localId(course), name: String(course.name || "Campo").slice(0, 160), snapshot: course, updated_at: String(course.updatedAt || now) }))),
    ]);
    await projectRoundSnapshots(client, userId, history);
    const preferences = body.data.preferences;
    const { error: preferencesError } = await client.from("user_preferences").upsert({
      user_id: userId,
      high_contrast: Boolean(preferences?.highContrast),
      locale: typeof preferences?.language === "string" ? preferences.language.slice(0, 12) : "es-MX",
      notifications_enabled: Boolean(preferences?.notificationsEnabled),
      default_handicap: preferences?.defaultHandicap ?? null,
      updated_at: now,
    });
    if (preferencesError) throw preferencesError;
    const { error: stateError } = await client.from("user_cloud_state").upsert({ user_id: userId, active_draft: body.data.activeDraft ?? null, updated_at: now });
    if (stateError) throw stateError;
    const { error: migrationError } = await client.from("account_data_migrations").upsert({
      user_id: userId,
      local_fingerprint: body.fingerprint.slice(0, 160),
      status: "completed",
      imported_round_ids: history.map(localId),
      updated_at: now,
    }, { onConflict: "user_id,local_fingerprint" });
    if (migrationError) throw migrationError;
    return NextResponse.json({ ok: true, fingerprint: body.fingerprint, counts: { rounds: history.length, players: players.length, groups: groups.length, rivals: rivals.length, courses: courses.length } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No fue posible sincronizar los datos.";
    await client.from("account_data_migrations").upsert({ user_id: userId, local_fingerprint: body.fingerprint.slice(0, 160), status: "failed", updated_at: now }, { onConflict: "user_id,local_fingerprint" });
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
