import "server-only";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { calculateAdminMetrics, rowsToCsv } from "./admin-core";

type ProfileRow = { id: string; display_name?: string | null; name?: string | null; avatar_url?: string | null; default_handicap?: number | null; role?: string; created_at?: string; last_seen_at?: string | null; last_login_at?: string | null; onboarding_completed_at?: string | null };
type RoundRow = { local_id?: string; owner_id?: string; updated_at?: string; snapshot?: Record<string, unknown> };
type EventRow = { user_id?: string | null; session_id: string; event_name: string; event_category: string; created_at: string; round_id?: string | null; metadata?: Record<string, unknown>; app_version?: string; environment?: string };
type ErrorRow = { id: string; user_id?: string | null; created_at: string; environment?: string; route?: string; error_type: string; error_code?: string | null; message_sanitized: string; app_version?: string };

async function allAuthUsers(admin: SupabaseClient) {
  const users: User[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const result = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (result.error) throw result.error;
    users.push(...result.data.users);
    if (result.data.users.length < 1000) break;
  }
  return users;
}

function complete(snapshot: Record<string, unknown>) {
  return Boolean(snapshot.completedAt || snapshot.roundClosed || snapshot.closed || snapshot.status === "completed");
}
function course(snapshot: Record<string, unknown>) { return String(snapshot.courseName || (snapshot.course as { name?: string } | undefined)?.name || "Sin campo"); }
function players(snapshot: Record<string, unknown>) { return Array.isArray(snapshot.players) ? snapshot.players.length : 0; }
function bets(snapshot: Record<string, unknown>) {
  const config = snapshot.bets && typeof snapshot.bets === "object" ? snapshot.bets as Record<string, unknown> : {};
  return Object.entries(config).filter(([, value]) => Boolean(value && typeof value === "object" && (value as { enabled?: boolean }).enabled)).map(([key]) => key);
}

export async function readAdminDataset(admin: SupabaseClient) {
  const [users, profileResult, roundResult, eventResult, errorResult, consentResult, groupResult, playerResult] = await Promise.all([
    allAuthUsers(admin),
    admin.from("profiles").select("id,name,display_name,avatar_url,default_handicap,role,created_at,last_seen_at,last_login_at,onboarding_completed_at"),
    admin.from("rounds_cloud").select("local_id,owner_id,updated_at,snapshot").order("updated_at", { ascending: false }).limit(5000),
    admin.from("analytics_events").select("user_id,session_id,event_name,event_category,created_at,round_id,metadata,app_version,environment").order("created_at", { ascending: false }).limit(10000),
    admin.from("app_errors").select("id,user_id,created_at,environment,route,error_type,error_code,message_sanitized,app_version").order("created_at", { ascending: false }).limit(5000),
    admin.from("legal_acceptances").select("user_id,type,version,accepted_at").limit(10000),
    admin.from("frequent_groups_cloud").select("owner_id,local_id").limit(10000),
    admin.from("players").select("owner_id,id").limit(10000),
  ]);
  for (const result of [profileResult, roundResult, eventResult, errorResult, consentResult, groupResult, playerResult]) if (result.error) throw result.error;
  const profiles = (profileResult.data || []) as ProfileRow[];
  const rounds = (roundResult.data || []) as RoundRow[];
  const events = (eventResult.data || []) as EventRow[];
  const errors = (errorResult.data || []) as ErrorRow[];
  const profileById = new Map(profiles.map(profile => [profile.id, profile]));
  const roundRows = rounds.map(row => {
    const snapshot = row.snapshot || {};
    return { roundId: String(row.local_id || snapshot.id || ""), userId: String(row.owner_id || ""), course: course(snapshot), date: String(snapshot.date || ""), players: players(snapshot), status: complete(snapshot) ? "completed" : "incomplete", completed: complete(snapshot), bets: bets(snapshot), lastSync: row.updated_at || null };
  });
  const userRows = users.map(user => {
    const profile = profileById.get(user.id);
    const ownedRounds = roundRows.filter(round => round.userId === user.id);
    const consents = (consentResult.data || []).filter(item => item.user_id === user.id).map(item => ({ type: item.type, version: item.version, acceptedAt: item.accepted_at }));
    return { id: user.id, email: user.email || "", displayName: profile?.display_name || profile?.name || "Sin nombre", avatarUrl: profile?.avatar_url || "", provider: user.app_metadata?.provider || "email", role: profile?.role || "user", createdAt: user.created_at, lastLoginAt: profile?.last_login_at || user.last_sign_in_at || null, lastSeenAt: profile?.last_seen_at || null, profileComplete: Boolean(profile?.onboarding_completed_at), handicap: profile?.default_handicap ?? null, rounds: ownedRounds.length, completedRounds: ownedRounds.filter(round => round.completed).length, groups: (groupResult.data || []).filter(item => item.owner_id === user.id).length, savedPlayers: (playerResult.data || []).filter(item => item.owner_id === user.id).length, consents };
  });
  const metrics = calculateAdminMetrics({
    users: userRows.map(user => ({ id: user.id, createdAt: user.createdAt, lastSeenAt: user.lastSeenAt })),
    rounds: roundRows.map(round => ({ id: round.roundId, ownerId: round.userId, createdAt: round.date || round.lastSync || "", completed: round.completed })),
    events: events.map(event => ({ eventName: event.event_name, createdAt: event.created_at, sessionId: event.session_id })),
    errors: errors.map(error => ({ errorType: error.error_type, createdAt: error.created_at })),
  });
  const betFrequency: Record<string, number> = {};
  for (const event of events.filter(event => event.event_name === "bet_enabled")) {
    const type = String(event.metadata?.bet_type || "unknown"); betFrequency[type] = (betFrequency[type] || 0) + 1;
  }
  const sessions = new Map<string, { first: number; last: number }>();
  for (const event of events) { const time = Date.parse(event.created_at); const current = sessions.get(event.session_id); sessions.set(event.session_id, current ? { first: Math.min(current.first, time), last: Math.max(current.last, time) } : { first: time, last: time }); }
  const durations = [...sessions.values()].map(item => Math.max(0, item.last - item.first) / 60000);
  return { metrics: { ...metrics, sessions: { count: sessions.size, averageMinutes: durations.length ? durations.reduce((sum, value) => sum + value, 0) / durations.length : 0 }, betFrequency }, users: userRows, rounds: roundRows, events, errors };
}

export function adminExport(dataset: Awaited<ReturnType<typeof readAdminDataset>>, name: string) {
  if (name === "users") return rowsToCsv(dataset.users.map(row => ({ id: row.id, email: row.email, displayName: row.displayName, provider: row.provider, role: row.role, createdAt: row.createdAt, lastLoginAt: row.lastLoginAt, lastSeenAt: row.lastSeenAt, profileComplete: row.profileComplete, handicap: row.handicap, rounds: row.rounds, completedRounds: row.completedRounds, groups: row.groups, savedPlayers: row.savedPlayers, consents: row.consents.map(item => `${item.type}:${item.version}`).join(" | ") })));
  if (name === "rounds") return rowsToCsv(dataset.rounds.map(row => ({ ...row, bets: row.bets.join(" | ") })));
  if (name === "analytics") return rowsToCsv(dataset.events.map(event => ({ created_at: event.created_at, user_id: event.user_id || "", session_id: event.session_id, event_name: event.event_name, category: event.event_category, round_id: event.round_id || "", app_version: event.app_version || "", environment: event.environment || "" })));
  if (name === "errors") return rowsToCsv(dataset.errors.map(error => ({ id: error.id, created_at: error.created_at, user_id: error.user_id || "", environment: error.environment || "", route: error.route || "", error_type: error.error_type, error_code: error.error_code || "", message: error.message_sanitized, app_version: error.app_version || "" })));
  throw new Error("DATASET_NOT_FOUND");
}
