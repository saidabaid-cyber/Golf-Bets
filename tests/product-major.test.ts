import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");
const auth = read("app/components/account-provider.tsx");
const account = read("app/components/account-panel.tsx");
const page = read("app/page.tsx");
const privacy = read("app/legal/privacy/page.tsx");
const terms = read("app/legal/terms/page.tsx");
const callback = read("app/auth/callback/page.tsx");
const migration = read("supabase/migrations/202609010002_backyard_accounts_legal.sql");

test("login muestra identidad, Apple, Google, correo e invitado", () => {
  const accessSource = auth + read("app/components/brand-lockup.tsx");
  for (const text of ["THE BACKYARD", "Continuar con Apple", "Continuar con Google", "Continuar con correo", "Continuar como invitado"]) assert.match(accessSource, new RegExp(text));
});

test("correo implementa OTP de seis dígitos, reenviar y cambiar correo", () => {
  assert.match(auth, /signInWithOtp/);
  assert.match(auth, /verifyOtp/);
  assert.match(auth, /otp\.length !== 6/);
  assert.match(auth, /Reenviar código/);
  assert.match(auth, /Cambiar correo/);
});

test("Google y Apple usan OAuth real sin credenciales inventadas", () => {
  assert.match(auth, /signInWithOAuth/);
  assert.match(auth, /provider,/);
  assert.doesNotMatch(auth, /client[_-]?secret/i);
});

test("Supabase sin configurar mantiene fallback e invitado", () => {
  assert.match(auth, /pendiente de configuración/);
  assert.match(auth, /setIdentity\(\{ \.\.\.profile, mode: "guest"/);
});

test("restauración y cierre de sesión no borran los datos locales de The Backyard", () => {
  assert.match(auth, /auth\.getSession/);
  assert.match(auth, /getSession\(\)\.then[\s\S]*\.catch/);
  assert.match(auth, /auth\.signOut/);
  assert.doesNotMatch(auth, /localStorage\.clear/);
});

test("callback intercambia código y siempre ofrece regreso seguro", () => {
  assert.match(callback, /exchangeCodeForSession/);
  assert.match(callback, /window\.location\.replace\("\/\?auth=complete"\)/);
  assert.match(callback, /Volver a The Backyard/);
});

test("consentimiento exige Árbitro y 18+ antes de continuar", () => {
  assert.match(auth, /checked=\{rules\}/);
  assert.match(auth, /checked=\{age\}/);
  assert.match(auth, /disabled=\{!rules \|\| !age \|\| busy\}/);
  assert.match(auth, /no es un árbitro oficial USGA/);
});

test("links legales existen tanto en acceso como en consentimiento", () => {
  assert.ok(auth.match(/href="\/legal\/terms"/g)!.length >= 2);
  assert.ok(auth.match(/href="\/legal\/privacy"/g)!.length >= 2);
});

test("Mi Cuenta muestra perfil, documentos, métodos, preferencias y cierre", () => {
  for (const text of ["Mi Cuenta", "Documentos y consentimiento", "Métodos de acceso", "Preferencias", "Cerrar sesión"]) assert.match(account, new RegExp(text));
});

test("perfil permite nombre y HCP predeterminado vacío", () => {
  assert.match(account, /displayName/);
  assert.match(account, /defaultHandicap/);
  assert.match(account, /emptyWhenZero=\{false\}/);
});

test("eliminar cuenta requiere confirmación fuerte y nunca usa secret en cliente", () => {
  assert.match(account, /deleteText !== "ELIMINAR"/);
  assert.match(account, /\/api\/account\/delete/);
  assert.doesNotMatch(account, /SERVICE_ROLE|SUPABASE_SECRET/);
});

test("Mi Cuenta no expone una exportación indiscriminada ni tokens de Polla Live", () => {
  assert.doesNotMatch(account, /Descargar mis datos/);
  assert.doesNotMatch(account, /Object\.keys\(localStorage\)|access_token/);
  assert.match(account, /Notificaciones/);
});

test("Aviso Integral contiene finalidades, IA, ARCO, menores y seguridad", () => {
  for (const text of ["Finalidades primarias", "Inteligencia artificial", "Derechos ARCO", "Menores de edad", "Seguridad", "localStorage"]) assert.match(privacy, new RegExp(text, "i"));
});

test("Términos aclaran que The Backyard no recibe ni procesa dinero", () => {
  assert.match(terms, /No recibe,[^;]*ni procesa dinero/i);
  assert.match(terms, /no actúa como casa de apuestas/i);
  assert.match(terms, /Comité o árbitro autorizado/i);
});

test("Home ofrece generador independiente y Mi Cuenta sin séptima pestaña", () => {
  assert.match(page, /Armar grupos/);
  assert.match(page, /setTab\("account"\)/);
  assert.match(read("app/globals.css"), /bottomNav\{grid-template-columns:repeat\(6,1fr\)/);
});

test("grupo generado puede compartirse, guardarse y cargarse a una ronda", () => {
  assert.match(page, /startRoundWithGeneratedGroup/);
  assert.match(page, /saveGeneratedFrequentGroup/);
  const builder = read("app/components/group-builder.tsx");
  assert.match(builder, /navigator\.share/);
  assert.match(builder, /Guardar como grupo frecuente/);
  assert.match(builder, /Copiar texto/);
  assert.doesNotMatch(builder, /window\.prompt/);
  assert.match(builder, /saveGroupsDialog/);
  assert.match(builder, /Jugar con este grupo/);
});

test("grupos guardados se cargan por nombre y se administran desde Armar grupos", () => {
  const builder = read("app/components/group-builder.tsx");
  assert.match(builder, /savedGroupLoad/);
  assert.match(builder, /Administrar \$\{group\.name\}/);
  assert.match(builder, /Editar grupo/);
  assert.match(builder, /Eliminar grupo/);
  assert.match(builder, /onEditFrequentGroup\(group\)/);
  assert.match(builder, /onDeleteFrequentGroup\(group\)/);
  assert.match(page, /onEditFrequentGroup=\{beginEditFrequentGroup\}/);
  assert.match(page, /onDeleteFrequentGroup=\{setFrequentGroupToDelete\}/);
  assert.match(page, /¿Eliminar grupo guardado\?/);
  assert.match(page, /Esto eliminará únicamente este grupo\. No afectará jugadores ni rondas anteriores\./);
});

test("resumen del hoyo usa diez segundos, X y gate contra doble avance", () => {
  assert.match(page, /HOLE_SUMMARY_DURATION_MS/);
  assert.match(page, /createSingleAdvance/);
  assert.match(page, /Cerrar resumen y avanzar/);
  assert.match(page, /clearTimeout/);
});

test("migración agrega tablas y RLS privado sin duplicar profiles", () => {
  for (const table of ["legal_documents", "legal_acceptances", "rules_referee_acceptances", "user_preferences", "account_data_migrations"]) assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
  assert.match(migration, /auth\.uid\(\) = user_id/g);
  assert.doesNotMatch(migration, /create table if not exists public\.profiles/);
  assert.match(migration, /on_auth_user_created_backyard_profile/);
  assert.match(migration, /from auth\.users as users/);
});

test("aceptaciones son insert-only para conservar auditoría", () => {
  assert.match(migration, /legal_acceptances_self_insert/);
  assert.doesNotMatch(migration, /legal_acceptances_self_update/);
  assert.doesNotMatch(migration, /legal_acceptances_self_delete/);
});

test("consentimiento local no se bloquea si las tablas de nube aún no responden", () => {
  assert.match(auth, /Promise\.all\(writes\)\.catch\(\(\) => undefined\)/);
  assert.match(auth, /rules_referee_acceptances/);
  assert.match(auth, /migrationDecisionStorageKey\(identity\.userId\)/);
});

test("configuración documenta redirects exactos local y producción", () => {
  const setup = read("docs/SETUP_AUTH.md");
  assert.match(setup, /http:\/\/localhost:3000\/auth\/callback/);
  assert.match(setup, /https:\/\/golf-bets-psi\.vercel\.app\/auth\/callback/);
  assert.match(setup, /SUPABASE_SECRET_KEY/);
});
