import type { SupabaseClient } from "@supabase/supabase-js";
import { findAmbiguousCloudConflicts, mergeLocalAndCloud, stableValue, timestamp, type CloudDataBundle, type CloudEntityType, type CloudTombstone } from "./cloud-sync";

function safeArray<T>(value: unknown, limit: number): T[] {
  if (Array.isArray(value) && value.length > limit) throw new Error("La colección excede el límite; no se sincronizó parcialmente.");
  return Array.isArray(value) ? value as T[] : [];
}

function localId(item: unknown) {
  if (!item || typeof item !== "object") return "";
  const id = (item as { id?: unknown }).id;
  return typeof id === "string" ? id.slice(0, 200) : "";
}

async function upsertRows(client: SupabaseClient, table: string, rows: Record<string, unknown>[]) {
  for (const row of rows) await writeVersionedRow(client, table, { owner_id: row.owner_id, local_id: row.local_id }, row);
}

// Only an absent additive column means "legacy but usable". A missing core
// table (42P01/PGRST205) is a real installation error and must remain visible.
const LEGACY_SCHEMA_CODES = new Set(["42703", "PGRST204"]);

/** The September 4 migration adds conflict/audit metadata, but the core cloud
 * schema predates it. Probe one additive column so an existing installation
 * keeps syncing complete snapshots while that non-destructive migration is
 * awaiting administrative application. Permission/network errors remain hard
 * failures and can never be mistaken for a legacy schema. */
export async function supportsExtendedCloudSchema(client: SupabaseClient) {
  const result = await client.from("round_scores_cloud").select("version").range(0, 0);
  if (!result.error) return true;
  const code = typeof result.error.code === "string" ? result.error.code : "";
  if (LEGACY_SCHEMA_CODES.has(code)) return false;
  throw result.error;
}

function withDevice(row: Record<string, unknown>, deviceId: string | null, extendedSchema: boolean) {
  return extendedSchema ? { ...row, updated_by_device: deviceId } : row;
}

/** Compare-and-swap protects the read→write window across Vercel instances.
 * A concurrent change or RLS's zero-row update is a recoverable error, NOT ack. */
export async function writeVersionedRow(client: SupabaseClient, table: string, keys: Record<string, unknown>, row: Record<string, unknown>) {
  let select = client.from(table).select("updated_at");
  for (const [key, value] of Object.entries(keys)) select = select.eq(key, value);
  const { data: old, error } = await select.maybeSingle();
  if (error) throw error;
  if (old && timestamp(String(row.updated_at)) <= timestamp(old.updated_at)) return false;
  if (!old) {
    const result = await client.from(table).insert(row).select();
    if (result.error || !result.data?.length) throw result.error || new Error("Escritura no confirmada");
  } else {
    let update = client.from(table).update(row).eq("updated_at", old.updated_at);
    for (const [key, value] of Object.entries(keys)) update = update.eq(key, value);
    const result = await update.select();
    if (result.error || !result.data?.length) throw result.error || Object.assign(new Error("Otro dispositivo actualizó este dato durante la escritura."), { code: "CLOUD_WRITE_RACE" });
  }
  return true;
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

/** PostgREST defaults to 1000 rows; paginate so old tombstones are never lost. */
async function readOwnedRows(client: SupabaseClient, table: string, userId: string, columns: string) {
  const query = () => {
    let request = client.from(table).select(columns).eq("owner_id", userId).order("local_id");
    if (table === "cloud_deletions") request = request.order("entity_type");
    else request = request.not("local_id", "is", null);
    return request;
  };
  const first = await query().range(0, 499);
  if (first.error) throw first.error;
  const rows = first.data || [];
  let page = first.data || [];
  for (let offset = 500; page.length === 500; offset += 500) {
    const result = await query().range(offset, offset + 499);
    if (result.error) throw result.error;
    page = result.data || []; rows.push(...page);
  }
  return { data: rows as unknown as Array<{ snapshot: unknown; entity_type: CloudEntityType; local_id: string; deleted_at: string }>, error: null };
}

async function applyTombstones(client: SupabaseClient, userId: string, tombstones: CloudTombstone[], deviceId: string | null = null, extendedSchema = true) {
  if (tombstones.length) {
    const rows = tombstones.map((item) => {
      const row = { owner_id: userId, entity_type: item.entityType, local_id: item.localId, deleted_at: item.deletedAt };
      return extendedSchema ? { ...row, deleted_by_device: deviceId } : row;
    });
    const { error } = await client.from("cloud_deletions").upsert(rows, { onConflict: "owner_id,entity_type,local_id" });
    if (error) throw error;
  }
  const { data, error } = await readOwnedRows(client, "cloud_deletions", userId, "entity_type,local_id,deleted_at");
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

async function projectRoundSnapshots(client: SupabaseClient, userId: string, history: Record<string, unknown>[], deviceId: string | null, extendedSchema: boolean) {
  if (!history.length) return;
  const ids = history.map(localId);
  const { data: cloudRounds, error } = await client.from("rounds_cloud").select("id,local_id").eq("owner_id", userId).in("local_id", ids);
  if (error) throw error;
  const cloudIdByLocal = new Map((cloudRounds || []).map((row) => [String(row.local_id), String(row.id)]));
  for (const round of history) {
    const roundId = cloudIdByLocal.get(localId(round));
    if (!roundId) continue;
    const players = safeArray<Record<string, unknown>>(round.players, 200).filter(localId);
    if (players.length) {
      const { data: existingPlayers, error: existingPlayersError } = await client.from("round_players_cloud").select("id,local_player_id").eq("round_id", roundId);
      if (existingPlayersError) throw existingPlayersError;
      const playerIds = new Set(players.map(localId));
      const removedIds = (existingPlayers || []).filter(player => !playerIds.has(String(player.local_player_id))).map(player => String(player.id));
      if (removedIds.length) {
        const removed = await client.from("round_players_cloud").delete().eq("round_id", roundId).in("id", removedIds);
        if (removed.error) throw removed.error;
      }
      const { data: insertedPlayers, error: playersError } = await client.from("round_players_cloud").upsert(players.map((player) => withDevice({
        round_id: roundId,
        local_player_id: localId(player),
        name: String(player.name || "Jugador").slice(0, 120),
        handicap: player.handicap ?? null,
        ...(extendedSchema ? { updated_at: String(round.updatedAt || round.completedAt || new Date().toISOString()) } : {}),
      }, deviceId, extendedSchema)), { onConflict: "round_id,local_player_id" }).select("id,local_player_id");
      if (playersError || insertedPlayers?.length !== players.length) throw playersError || new Error("Jugadores no confirmados");
      const cloudPlayerByLocal = new Map((insertedPlayers || []).map((player) => [String(player.local_player_id), String(player.id)]));
      const scores = round.scores && typeof round.scores === "object" ? round.scores as Record<string, Record<string, unknown>> : {};
      const scoreRows: Record<string, unknown>[] = [];
      for (const [holeText, playerScores] of Object.entries(scores)) {
        const hole = Number(holeText);
        if (!Number.isInteger(hole) || hole < 1 || hole > 18 || !playerScores || typeof playerScores !== "object") continue;
        for (const [playerLocalId, scoreValue] of Object.entries(playerScores)) {
          const score = Number(scoreValue);
          const cloudPlayerId = cloudPlayerByLocal.get(playerLocalId);
          if (cloudPlayerId && Number.isInteger(score) && score >= 1 && score <= 20) scoreRows.push(withDevice({ round_player_id: cloudPlayerId, hole, score, ...(extendedSchema ? { updated_at: String(round.updatedAt || round.completedAt || new Date().toISOString()) } : {}) }, deviceId, extendedSchema));
        }
      }
      if (scoreRows.length) {
        // round_scores_cloud deliberately has no surrogate `id`: its primary
        // key is (round_player_id, hole). Returning the real key both confirms
        // every write and keeps this projection aligned with the SQL schema.
        const { data: savedScores, error: scoresError } = await client
          .from("round_scores_cloud")
          .upsert(scoreRows, { onConflict: "round_player_id,hole" })
          .select("round_player_id,hole");
        if (scoresError || savedScores?.length !== scoreRows.length) throw scoresError || new Error("Scores no confirmados");
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
      const { data: projection, error: projectionError } = await client.from(table).upsert(withDevice({ round_id: roundId, [column]: value }, deviceId, extendedSchema)).select("round_id");
      if (projectionError || projection?.length !== 1) throw projectionError || new Error("Proyección no confirmada");
    }
  }
}


export async function readCloudBundle(client: SupabaseClient, userId: string, extendedSchema = false): Promise<CloudDataBundle> {
  const stateColumns = extendedSchema ? "active_draft,updated_at,updated_by_device" : "active_draft,updated_at";
  const [rounds, players, groups, rivals, courses, preferences, state, deletions] = await Promise.all([
    readOwnedRows(client, "rounds_cloud", userId, "snapshot"),
    readOwnedRows(client, "players", userId, "snapshot"),
    readOwnedRows(client, "frequent_groups_cloud", userId, "snapshot"),
    readOwnedRows(client, "personal_rivals_cloud", userId, "snapshot"),
    readOwnedRows(client, "courses_cloud", userId, "snapshot"),
    client.from("user_preferences").select("high_contrast,locale,notifications_enabled,default_handicap,updated_at").eq("user_id", userId).maybeSingle(),
    client.from("user_cloud_state").select(stateColumns).eq("user_id", userId).maybeSingle(),
    readOwnedRows(client, "cloud_deletions", userId, "entity_type,local_id,deleted_at"),
  ]);
  const firstError = [rounds, players, groups, rivals, courses, preferences, state, deletions].find((result) => result.error)?.error;
  if (firstError) throw firstError;
  const stateData = state.data as null | { active_draft?: unknown; updated_at?: string; updated_by_device?: string };
  const data: CloudDataBundle = {
    version: 1,
    history: (rounds.data || []).map((row) => row.snapshot).filter(Boolean),
    frequentPlayers: (players.data || []).map((row) => row.snapshot).filter(Boolean),
    frequentGroups: (groups.data || []).map((row) => row.snapshot).filter(Boolean),
    rivals: (rivals.data || []).map((row) => row.snapshot).filter(Boolean),
    courses: (courses.data || []).map((row) => row.snapshot).filter(Boolean),
    preferences: {
      // No cloud row means no preference yet: product default is high contrast.
      highContrast: preferences.data ? Boolean(preferences.data.high_contrast) : true,
      language: preferences.data?.locale || "es-MX",
      notificationsEnabled: Boolean(preferences.data?.notifications_enabled),
      defaultHandicap: preferences.data?.default_handicap === null || preferences.data?.default_handicap === undefined ? null : Number(preferences.data.default_handicap),
      hasLocalState: Boolean(preferences.data),
      updatedAt: preferences.data?.updated_at,
    },
    activeDraft: stateData?.active_draft ?? null,
    activeDraftUpdatedAt: stateData?.updated_at,
    deviceId: extendedSchema && typeof stateData?.updated_by_device === "string" ? stateData.updated_by_device : undefined,
    tombstones: (deletions.data || []).map((item) => ({ entityType: item.entity_type, localId: item.local_id, deletedAt: item.deleted_at })),
  } as CloudDataBundle;
  return mergeLocalAndCloud(data, data);
}


export async function writeCloudBundle(client: SupabaseClient, userId: string, body: { data: CloudDataBundle; fingerprint: string }) {
  // Re-read inside the write request. Two devices may both have downloaded the
  // same base; this server-side three-way merge closes that race without
  // overwriting compatible score edits from the other device.
  const now = new Date().toISOString();
  let history: Record<string, unknown>[] = [];
  let players: Record<string, unknown>[] = [];
  let groups: Record<string, unknown>[] = [];
  let rivals: Record<string, unknown>[] = [];
  let courses: Record<string, unknown>[] = [];

  const diagnosticCode = (error: unknown) => {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code.slice(0, 80);
    const message = error instanceof Error ? error.message : String(error || "");
    if (/permission|row-level|42501/i.test(message)) return "permission_or_rls";
    if (/schema|table|column|PGRST20|42P01|42703/i.test(message)) return "schema_mismatch";
    if (/fetch|network|timeout/i.test(message)) return "network";
    return "sync_failed";
  };

  let extendedSchema = false;
  try {
    extendedSchema = await supportsExtendedCloudSchema(client);
    const currentCloud = await readCloudBundle(client, userId, extendedSchema);
    const lateConflicts = findAmbiguousCloudConflicts(body.data, currentCloud);
    if (lateConflicts.length) throw Object.assign(new Error("Hay un cambio simultáneo en el mismo dato."), { code: "CLOUD_FIELD_CONFLICT", conflicts: lateConflicts });
    const incoming = mergeLocalAndCloud(body.data, currentCloud);
    history = safeArray<Record<string, unknown>>(incoming.history, 1000).filter(localId);
    players = safeArray<Record<string, unknown>>(incoming.frequentPlayers, 500).filter(localId);
    groups = safeArray<Record<string, unknown>>(incoming.frequentGroups, 250).filter(localId);
    rivals = safeArray<Record<string, unknown>>(incoming.rivals, 500).filter(localId);
    courses = safeArray<Record<string, unknown>>(incoming.courses, 200).filter(localId);
    const deviceId = typeof incoming.deviceId === "string" ? incoming.deviceId.slice(0, 120) : null;
    const requestRow: Record<string, unknown> = extendedSchema
      ? { user_id: userId, local_fingerprint: body.fingerprint.slice(0, 160), status: "requested", updated_at: now, last_attempt_at: now, last_error_code: null }
      : { user_id: userId, local_fingerprint: body.fingerprint.slice(0, 160), status: "requested", updated_at: now };
    const { error: requestError } = await client.from("account_data_migrations").upsert(requestRow, { onConflict: "user_id,local_fingerprint" });
    if (requestError) throw requestError;
    if (extendedSchema && deviceId) {
      const device = await client.from("user_devices").upsert({ user_id: userId, device_id: deviceId, last_seen_at: now, last_sync_at: now }, { onConflict: "user_id,device_id" }).select("device_id");
      if (device.error || device.data?.length !== 1) throw device.error || new Error("El dispositivo no fue confirmado por Supabase");
    }
    const allTombstones = await applyTombstones(client, userId, validTombstones(incoming.tombstones), deviceId, extendedSchema);
    const deleted = new Set(allTombstones.map((item) => `${item.entityType}:${item.localId}`));
    history = history.filter((item) => !deleted.has(`round:${localId(item)}`));
    players = players.filter((item) => !deleted.has(`frequent_player:${localId(item)}`));
    groups = groups.filter((item) => !deleted.has(`frequent_group:${localId(item)}`));
    rivals = rivals.filter((item) => !deleted.has(`rival:${localId(item)}`));
    courses = courses.filter((item) => !deleted.has(`course:${localId(item)}`));
    const writes = await Promise.allSettled([
      upsertRows(client, "rounds_cloud", history.map((round) => withDevice({ owner_id: userId, local_round_id: localId(round), local_id: localId(round), snapshot: round, updated_at: String(round.updatedAt || round.completedAt || round.date || new Date(0).toISOString()) }, deviceId, extendedSchema))),
      upsertRows(client, "players", players.map((player) => withDevice({ owner_id: userId, local_id: localId(player), name: String(player.name || "Jugador").slice(0, 120), handicap: player.handicap ?? 0, usage_count: Number(player.uses) || 0, snapshot: player, updated_at: String(player.updatedAt || new Date(0).toISOString()) }, deviceId, extendedSchema))),
      upsertRows(client, "frequent_groups_cloud", groups.map((group) => withDevice({ owner_id: userId, local_id: localId(group), name: String(group.name || "Grupo").slice(0, 160), snapshot: group, updated_at: String(group.updatedAt || new Date(0).toISOString()) }, deviceId, extendedSchema))),
      upsertRows(client, "personal_rivals_cloud", rivals.map((rival) => withDevice({ owner_id: userId, local_id: localId(rival), name: String(rival.name || "Rival").slice(0, 120), snapshot: rival, updated_at: String(rival.updatedAt || new Date(0).toISOString()) }, deviceId, extendedSchema))),
      upsertRows(client, "courses_cloud", courses.map((course) => withDevice({ owner_id: userId, local_id: localId(course), name: String(course.name || "Campo").slice(0, 160), snapshot: course, updated_at: String(course.updatedAt || new Date(0).toISOString()) }, deviceId, extendedSchema))),
    ]);
    const failed = writes.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
    // Retry projections even when the snapshot timestamp is unchanged. Always
    // project the stored winner, never an older device's rejected snapshot.
    const canonical = await readCloudBundle(client, userId, extendedSchema);
    const requestedIds = new Set(history.map(localId));
    const toProject = canonical.history.filter(round => requestedIds.has(round.id));
    await projectRoundSnapshots(client, userId, toProject as unknown as Record<string, unknown>[], deviceId, extendedSchema);
    const afterProjection = await readCloudBundle(client, userId, extendedSchema);
    if (toProject.some(round => JSON.stringify(afterProjection.history.find(other => other.id === round.id)) !== JSON.stringify(round))) throw new Error("La ronda cambió durante la proyección. Reintenta.");
    const preferences = incoming.preferences;
    await writeVersionedRow(client, "user_preferences", { user_id: userId }, withDevice({
      user_id: userId,
      high_contrast: Boolean(preferences?.highContrast),
      locale: typeof preferences?.language === "string" ? preferences.language.slice(0, 12) : "es-MX",
      notifications_enabled: Boolean(preferences?.notificationsEnabled),
      default_handicap: preferences?.defaultHandicap ?? null,
      updated_at: preferences?.updatedAt || new Date(0).toISOString(),
    }, deviceId, extendedSchema));
    await writeVersionedRow(client, "user_cloud_state", { user_id: userId }, withDevice({ user_id: userId, active_draft: incoming.activeDraft ?? null, updated_at: incoming.activeDraftUpdatedAt || new Date(0).toISOString() }, deviceId, extendedSchema));
    const confirmedState = await client.from("user_cloud_state").select("active_draft").eq("user_id", userId).maybeSingle();
    if (confirmedState.error || JSON.stringify(stableValue(confirmedState.data?.active_draft ?? null)) !== JSON.stringify(stableValue(incoming.activeDraft ?? null))) {
      if (confirmedState.error) throw confirmedState.error;
      const latest = await readCloudBundle(client, userId, extendedSchema);
      const conflicts = findAmbiguousCloudConflicts(body.data, latest);
      throw Object.assign(new Error("Otro dispositivo cambió la ronda durante la escritura."), { code: "CLOUD_FIELD_CONFLICT", conflicts });
    }
    // A deletion can arrive after the first read. Sweep again; GET also filters
    // permanent tombstones so a concurrent stale insert is never resurrected UI.
    await applyTombstones(client, userId, []);
    const completedRow: Record<string, unknown> = {
      user_id: userId,
      local_fingerprint: body.fingerprint.slice(0, 160),
      status: "completed",
      imported_round_ids: history.map(localId),
      updated_at: now,
      ...(extendedSchema ? { last_attempt_at: now, last_error_code: null } : {}),
    };
    const { error: migrationError } = await client.from("account_data_migrations").upsert(completedRow, { onConflict: "user_id,local_fingerprint" });
    if (migrationError) throw migrationError;
    return { ok: true, fingerprint: body.fingerprint };
  } catch (error) {
    const failedRow: Record<string, unknown> = {
      user_id: userId,
      local_fingerprint: body.fingerprint.slice(0, 160),
      status: "failed",
      updated_at: now,
      ...(extendedSchema ? { last_attempt_at: now, last_error_code: diagnosticCode(error) } : {}),
    };
    try { await client.from("account_data_migrations").upsert(failedRow, { onConflict: "user_id,local_fingerprint" }); } catch { /* Original failure remains visible even if its diagnostic write fails. */ }
    if (error && typeof error === "object" && "code" in error && error.code === "CLOUD_WRITE_RACE") {
      const latest = await readCloudBundle(client, userId, extendedSchema).catch(() => null);
      const conflicts = latest ? findAmbiguousCloudConflicts(body.data, latest) : [];
      throw Object.assign(new Error("Otro dispositivo cambió datos durante la escritura."), { code: "CLOUD_FIELD_CONFLICT", conflicts });
    }
    // Preserve PostgREST's safe code/status for server diagnostics. Wrapping
    // the object as a generic Error erased 42703/42501 from real Preview logs.
    throw error;
  }
}
