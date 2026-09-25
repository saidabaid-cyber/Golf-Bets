import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { authIdentityChanged, requireCloudWrites, sendEmailOtpWhenReady, type AuthFlowClient } from "../lib/auth-flow";
import { readAuthProviderStatus } from "../lib/auth-provider-status";
import { CANONICAL_PREVIEW_SUPABASE_ORIGIN, CANONICAL_PRODUCTION_SUPABASE_ORIGIN, resolveBrowserSupabaseOrigin } from "../lib/supabase/client";

test("refrescar token o repetir SIGNED_IN de la misma cuenta no reinicia onboarding", () => {
  assert.equal(authIdentityChanged(null, "a"), true);
  assert.equal(authIdentityChanged("a", "a"), false);
  assert.equal(authIdentityChanged("a", "b"), true);
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /authIdentityChanged\(activeUserId\.current, session\.user\.id\)/);
  assert.ok(provider.indexOf("authIdentityChanged(activeUserId.current") < provider.indexOf("setProfileChecked(false)"));
  const sameIdentityStart = provider.indexOf("if (!authIdentityChanged(activeUserId.current, session.user.id))");
  const sameIdentityEnd = provider.indexOf("switchAccountWorkspace(localStorage, session.user.id)", sameIdentityStart);
  const sameIdentityBranch = provider.slice(sameIdentityStart, sameIdentityEnd);
  assert.match(sameIdentityBranch, /setCloudIssue\("auth", null\)/);
  assert.match(sameIdentityBranch, /setAccountReloadRevision/);
  assert.match(sameIdentityBranch, /setLegalRetryRevision/);
  assert.match(sameIdentityBranch, /backyard-sync-retry/);
});

test("Reintentar valida la sesión y un 401 fuerza una sola renovación antes de rehidratar nube", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.match(provider, /recoverAuthSession\(supabase\.auth, \{ forceRefresh \}\)/);
  assert.match(provider, /recoverCloudSession\(true\)/);
  assert.match(provider, /recoverCloudSession\(false\)/);
  assert.match(provider, /sessionRecovery\.current\?\.userId === expectedUserId/);
  assert.match(provider, /activeUserId\.current !== expectedUserId/);
  assert.match(provider, /activateSession\(session, \{ rehydrate: true \}\)/);
  assert.doesNotMatch(provider, /accountCloudError\s*\|\|\s*legalCloudError\s*\|\|\s*syncCloudError/);
});

test("un fallo de perfil no se interpreta como perfil inexistente ni menciona migraciones", () => {
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  const account = readFileSync("lib/cloud-account.ts", "utf8");
  const route = readFileSync("app/api/cloud/sync/route.ts", "utf8");
  assert.match(provider, /Trabajando sin conexión · estamos usando el perfil guardado/);
  assert.match(provider, /setProfileSetupRequired\(false\)/);
  assert.doesNotMatch(account, /revisa la conexión y las migraciones/i);
  assert.doesNotMatch(route, /Aplica las migraciones pendientes|Falta aplicar la migración/i);
});

test("errores PostgREST resueltos como data.error no se confunden con escritura correcta", async () => {
  await requireCloudWrites([Promise.resolve({ error: null })]);
  await assert.rejects(requireCloudWrites([Promise.resolve({ error: new Error("RLS denied") })]), /RLS denied/);
  await assert.rejects(requireCloudWrites([Promise.reject(new Error("network"))]), /network/);
});

test("el flag social no suplanta la configuración real de Google/Apple", async () => {
  const result = await readAuthProviderStatus("https://project.supabase.co", "public-test-key", async (url, options) => {
    assert.equal(url, "https://project.supabase.co/auth/v1/settings");
    assert.deepEqual(options?.headers, { apikey: "public-test-key" });
    return Response.json({ external: { email: true, google: false, apple: false } });
  });
  assert.deepEqual(result, { status: "ready", email: true, google: false, apple: false });
});

test("Auth distingue no configurado, red fallida y proveedor habilitado", async () => {
  assert.equal((await readAuthProviderStatus()).status, "unconfigured");
  assert.equal((await readAuthProviderStatus("https://example.test", "public", async () => { throw new Error("offline"); })).status, "unavailable");
  assert.equal((await readAuthProviderStatus("https://example.test", "public", async () => new Response(null, { status: 503 }))).status, "unavailable");
  assert.equal((await readAuthProviderStatus("https://example.test", "public", async () => Response.json({ external: { google: true, apple: true } }))).apple, true);
});

test("email OTP nunca llama Supabase mientras providers está cargando, no configurado o no disponible", async () => {
  let sends = 0;
  const auth = { signInWithOtp: async () => { sends++; return { error: null }; } } as unknown as AuthFlowClient;
  const unavailable = { status: "unavailable" as const, email: false, google: false, apple: false };
  const unconfigured = { ...unavailable, status: "unconfigured" as const };
  await assert.rejects(() => sendEmailOtpWhenReady(auth, null, "owner@example.test", "https://dev.thebackyard.com.mx/auth/callback"), /email_auth_provider_unavailable/);
  await assert.rejects(() => sendEmailOtpWhenReady(auth, unconfigured, "owner@example.test", "https://dev.thebackyard.com.mx/auth/callback"), /email_auth_provider_unavailable/);
  await assert.rejects(() => sendEmailOtpWhenReady(auth, unavailable, "owner@example.test", "https://dev.thebackyard.com.mx/auth/callback"), /email_auth_provider_unavailable/);
  assert.equal(sends, 0);
  await sendEmailOtpWhenReady(auth, { status: "ready", email: true, google: false, apple: false }, "owner@example.test", "https://dev.thebackyard.com.mx/auth/callback");
  assert.equal(sends, 1);
  const provider = readFileSync("app/components/account-provider.tsx", "utf8");
  assert.ok(provider.indexOf('providers?.status !== "ready"') < provider.indexOf("getSupabaseBrowser()", provider.indexOf("async function sendCode")));
});

test("el cliente Auth del navegador exige la pareja canónica app-origin y Supabase ref", () => {
  const dev = { hostname: "dev.thebackyard.com.mx", protocol: "https:", origin: "https://dev.thebackyard.com.mx" };
  const production = { hostname: "app.thebackyard.com.mx", protocol: "https:", origin: "https://app.thebackyard.com.mx" };
  const local = { hostname: "localhost", protocol: "http:", origin: "http://localhost" };
  const branchAlias = {
    hostname: "golf-bets-git-integration-backyard-current-saha8.vercel.app",
    protocol: "https:",
    origin: "https://golf-bets-git-integration-backyard-current-saha8.vercel.app",
  };
  const insecureBranchAlias = { ...branchAlias, protocol: "http:", origin: "http://golf-bets-git-integration-backyard-current-saha8.vercel.app" };
  const randomPreview = { hostname: "golf-bets-random.vercel.app", protocol: "https:", origin: "https://golf-bets-random.vercel.app" };
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, dev), CANONICAL_PREVIEW_SUPABASE_ORIGIN);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PRODUCTION_SUPABASE_ORIGIN, dev), null);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PRODUCTION_SUPABASE_ORIGIN, production), CANONICAL_PRODUCTION_SUPABASE_ORIGIN);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, production), null);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, branchAlias), CANONICAL_PREVIEW_SUPABASE_ORIGIN);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PRODUCTION_SUPABASE_ORIGIN, branchAlias), null);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, insecureBranchAlias), null);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, local), CANONICAL_PREVIEW_SUPABASE_ORIGIN);
  assert.equal(resolveBrowserSupabaseOrigin("http://127.0.0.1:54321", local), "http://127.0.0.1:54321");
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, randomPreview), null);
  assert.equal(resolveBrowserSupabaseOrigin(`${CANONICAL_PREVIEW_SUPABASE_ORIGIN}/rest/v1`, dev), null);
  assert.equal(resolveBrowserSupabaseOrigin(CANONICAL_PREVIEW_SUPABASE_ORIGIN, undefined), null);
  const client = readFileSync("lib/supabase/client.ts", "utf8");
  assert.ok(client.indexOf("resolveBrowserSupabaseOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL") < client.indexOf("createClient(url, anonKey"));
});

test("pgcrypto se resuelve en extensions en instalaciones nuevas y funciones persistidas", () => {
  const initial = readFileSync("supabase/migrations/202609010001_golf_bets_v3.sql", "utf8");
  const cloud = readFileSync("supabase/migrations/202609020001_cloud_sync_polla_hardening.sql", "utf8");
  for (const sql of [initial, cloud]) assert.match(sql, /set search_path = public, extensions/);
  for (const name of ["join_polla", "add_tournament_player", "resolve_polla_access"]) {
    const body = initial.slice(initial.indexOf(`function public.${name}(`));
    assert.match(body.slice(0, body.indexOf("$$")), /search_path = public, extensions/);
  }
  const pin = cloud.slice(cloud.indexOf("function public.set_tournament_player_pin("));
  assert.match(pin.slice(0, pin.indexOf("$$")), /search_path = public, extensions/);
});

test("hardening quita concesiones directas y conserva solamente la función RLS necesaria", () => {
  const sql = readFileSync("supabase/migrations/202609030001_function_privileges.sql", "utf8");
  for (const fn of ["join_polla", "join_polla_secure", "resolve_polla_access", "add_tournament_player", "set_tournament_player_pin", "record_tournament_oyes"]) {
    assert.match(sql, new RegExp(`revoke all on function public\\.${fn}\\([^;]+from public, anon, authenticated;`));
  }
  assert.match(sql, /grant execute on function public\.is_polla_admin\(uuid\) to authenticated, service_role/);
  assert.match(sql, /revoke all on table public\.polla_join_attempts from public, anon, authenticated/);
  assert.doesNotMatch(sql, /delete from|truncate |drop table/i);
});

test("keys modernas son aliases opcionales y el módulo privilegiado es server-only", () => {
  const client = readFileSync("lib/supabase/client.ts", "utf8"), server = readFileSync("lib/supabase/server.ts", "utf8");
  assert.match(client, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY \|\| process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.doesNotMatch(client, /SUPABASE_SECRET_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(server, /import "server-only"/);
  assert.match(server, /SUPABASE_SECRET_KEY \|\| process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
});

test("cloud sin token devuelve 401, no un falso error de configuración 503", () => {
  for (const route of ["sync", "rounds"]) assert.match(readFileSync(`app/api/cloud/${route}/route.ts`, "utf8"), /if \(!token\).*status: 401/);
});

test("PDF con proxy fallido reintenta la fuente CORS dentro del visor sin navegar fuera", () => {
  const viewer = readFileSync("app/components/internal-pdf-viewer.tsx", "utf8");
  assert.match(viewer, /getDocument\(\{ url: document\.localUrl/);
  assert.match(viewer, /getDocument\(\{ url: document\.officialUrl \}\)/);
  assert.doesNotMatch(viewer, /window\.location|window\.open/);
});
