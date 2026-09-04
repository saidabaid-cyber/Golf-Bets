import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const migration = read("supabase/migrations/202609020001_cloud_sync_polla_hardening.sql");
const syncRoute = read("app/api/cloud/sync/route.ts") + read("lib/cloud-sync-service.ts");
const scoreRoute = read("app/api/polla/scores/route.ts");
const adminRoute = read("app/api/polla/admin/[tournamentId]/route.ts");
const leaderboardRoute = read("app/api/polla/leaderboard/[publicId]/route.ts");
const privateLink = read("lib/polla-private-link.ts");
const pollaPanel = read("app/components/polla-live-panel.tsx");
const appPage = read("app/page.tsx");
const accountProvider = read("app/components/account-provider.tsx");
const envExample = read(".env.example");

test("migración cloud agrega snapshots normalizados, tombstones y RLS por dueño", () => {
  for (const table of ["frequent_groups_cloud", "personal_rivals_cloud", "user_cloud_state", "cloud_deletions", "round_bet_configs", "round_bet_results", "personal_bets_cloud", "manual_bets_cloud", "expenses_cloud", "round_course_snapshots", "round_local_rules_snapshots"]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(syncRoute, /owner_id: userId/);
  assert.match(syncRoute, /applyTombstones/);
  assert.match(syncRoute, /writeVersionedRow/);
  assert.doesNotMatch(syncRoute, /service.role|SUPABASE_SERVICE_ROLE_KEY/);
});

test("Storage es privado y limita cada carpeta al auth.uid", () => {
  assert.match(migration, /'scorecard-photos', 'scorecard-photos', false/);
  assert.ok((migration.match(/storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/g) || []).length >= 4);
  assert.match(migration, /allowed_mime_types/);
});

test("join usa bcrypt, rate limit y revoca el RPC inseguro a anon", () => {
  assert.match(migration, /crypt\(p_pin, gen_salt\('bf'\)\)/);
  assert.match(migration, /v_recent_failures >= 10/);
  assert.match(migration, /revoke all on function public\.join_polla\(uuid, uuid, text\) from anon, authenticated/);
  assert.doesNotMatch(migration, /pin_plain|plain_pin/);
});

test("Oyes conserva atómicamente la distancia más cercana", () => {
  assert.match(migration, /record_tournament_oyes/);
  assert.match(migration, /excluded\.distance_meters < public\.tournament_oyes\.distance_meters/);
  assert.match(migration, /group_members_one_scorer_uidx/);
});

test("API valida grupo, rol, tarjeta y versión antes de escribir score", () => {
  assert.match(scoreRoute, /group_members/);
  assert.match(scoreRoute, /canEditPollaScore/);
  assert.match(scoreRoute, /hasPollaScoreConflict/);
  assert.match(scoreRoute, /status: 409/);
  assert.match(scoreRoute, /Number\.isInteger\(hole\)/);
  assert.match(scoreRoute, /Number\.isInteger\(score\)/);
});

test("cambiar scorer o PIN revoca sesiones anteriores y admin delegado respeta expiración", () => {
  assert.ok((adminRoute.match(/from\("tournament_access"\)\.update\(\{ revoked_at:/g) || []).length >= 2);
  assert.match(adminRoute, /delegatedActive/);
  assert.match(adminRoute, /Date\.parse\(delegated\.expires_at\) > Date\.now\(\)/);
});

test("Realtime público solo expone señal y leaderboard sanitizado", () => {
  assert.match(migration, /tournament_leaderboard_events/);
  assert.match(migration, /create policy leaderboard_events_public/);
  assert.match(migration, /alter publication supabase_realtime add table public\.tournament_leaderboard_events/);
  assert.doesNotMatch(leaderboardRoute, /email|pin_hash|token_hash|personal_bets|manual_bets/);
  assert.match(leaderboardRoute, /buildPollaLeaderboard/);
});

test("link de ronda privada proyecta exclusivamente scores", () => {
  assert.match(privateLink, /PendingPollaScore/);
  assert.doesNotMatch(privateLink, /rabbits|skins|foursome|personalBets|expenses|balances/);
});

test("enlace corto abre Polla Live, carga la invitación y conserva QR compartible", () => {
  assert.match(read("app/polla/[code]/page.tsx"), /redirect\(`\/\?polla=/);
  assert.match(appPage, /entry\.has\("polla"\).*setTab\("pollaLive"\)/);
  assert.match(pollaPanel, /requestPollaInvite\(invitedId\)/);
  assert.match(pollaPanel, /\/polla\/\$\{created\.short_code\}/);
  assert.match(pollaPanel, /leaderboard\.tournament\?\.publicId/);
});

test("feature flags de servidor gobiernan nube, Polla y login social", () => {
  const flags = read("lib/feature-flags.ts");
  const route = read("app/api/features/route.ts");
  assert.match(flags, /process\.env\.CLOUD_ENABLED/);
  assert.match(flags, /process\.env\.POLLA_LIVE_ENABLED/);
  assert.match(flags, /process\.env\.AUTH_SOCIAL_ENABLED/);
  assert.match(route, /authSocialEnabled/);
  assert.match(pollaPanel, /pollaLiveEnabled/);
});

test("consentimientos cloud reintentan de forma idempotente sin bloquear la copia local", () => {
  assert.match(accountProvider, /currentConsent/);
  assert.match(accountProvider, /legal_acceptances"\)\.upsert/);
  assert.match(accountProvider, /ignoreDuplicates: true/);
  assert.match(accountProvider, /queueLegalSync/);
  assert.match(accountProvider, /clearPendingLegalSync/);
  assert.match(accountProvider, /flushLegalAcceptances/);
});

test("env example contiene nombres requeridos pero ningún secreto real", () => {
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CLOUD_ENABLED", "POLLA_LIVE_ENABLED", "AUTH_SOCIAL_ENABLED", "OPENAI_API_KEY", "OPENAI_RULES_VECTOR_STORE_ID", "OPENAI_RULES_MODEL", "RULES_AI_ENABLED"]) assert.match(envExample, new RegExp(`^${name}=$`, "m"));
  assert.doesNotMatch(envExample, /eyJ[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{16,}|service_role\.[A-Za-z0-9]/);
});

test("documentación dedicada existe para Supabase, Email OTP, Google, Apple y Polla", () => {
  for (const path of ["docs/SETUP_SUPABASE.md", "docs/SETUP_EMAIL_OTP.md", "docs/SETUP_GOOGLE_AUTH.md", "docs/SETUP_APPLE_AUTH.md", "docs/POLLA_LIVE.md"]) assert.ok(read(path).length > 300);
});
