import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
const pickerCss = readFileSync("app/components/profile-image-picker.module.css", "utf8");
const css = readFileSync("app/profile-account.css", "utf8");
const more = readFileSync("app/components/more-hub.tsx", "utf8");
const page = readFileSync("app/page.tsx", "utf8");
const statisticsRoute = readFileSync("app/api/account/statistics/route.ts", "utf8");
const deletionRoute = readFileSync("app/api/account/delete/route.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260913205122_user_statistics_reset.sql", "utf8");

test("Perfil presenta resumen compacto y mueve los inputs a Editar perfil", () => {
  assert.match(profile, /profileOverviewCard/);
  assert.match(profile, /Editar perfil/);
  assert.match(profile, /editing[\s\S]*Datos personales/);
  assert.match(profile, /Nombre visible/);
  assert.match(profile, /Nombre\(s\)/);
  assert.match(profile, /Apellidos/);
  assert.match(profile, /Username/);
  assert.match(profile, /HCP \/ Index/);
  assert.match(css, /\.profileMobileStack\{display:grid/);
});

test("Foto, Emoji, Crear avatar y Sin imagen son cuatro opciones 2×2 responsive sin solaparse", () => {
  for (const [mode, label] of [["photo", "FOTO"], ["emoji", "EMOJI"], ["create", "CREAR AVATAR"], ["none", "SIN IMAGEN"]]) {
    assert.match(picker, new RegExp(`\\["${mode}", "${label}"\\]`));
  }
  assert.match(picker, /aria-pressed=\{mode === option\}/);
  assert.match(pickerCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(pickerCss, /@media \(max-width: 430px\)/);
  assert.match(picker, /kind === "profile" \? styles\.profilePreview : ""/);
  assert.match(pickerCss, /\.profilePreview \{ border-radius: 50%; \}/);
});

test("Perfil enlaza Mi equipo, Preferencias y Notificaciones a controles existentes", () => {
  assert.match(profile, /aria-label="Secciones de Mi Perfil"/);
  for (const section of ["Mi equipo", "Preferencias", "Cuenta y privacidad", "Notificaciones"]) assert.match(profile, new RegExp(`<b>${section}</b>`));
  assert.match(profile, /onClick=\{onOpenEquipment\}[\s\S]*?<b>Mi equipo<\/b>/);
  assert.match(profile, /onBackToProfile/);
  assert.match(page, /onOpenEquipment=\{\(\) => setProfileFocus\("equipment"\)\}/);
  assert.match(page, /onBackToProfile=\{\(\) => setProfileFocus\("profile"\)\}/);
  assert.match(css, /\.profileNavigationList\{display:grid;min-width:0/);
});

test("Más ofrece Reglas de golf como acceso explícito sin duplicar Perfil", () => {
  assert.match(more, /title: "Reglas de golf"/);
  assert.match(more, /action: onOpenRules/);
  assert.match(page, /onOpenRules=\{openRulesForRound\}/);
  assert.doesNotMatch(more, /title: "Perfil"/);
});

test("Cuenta y privacidad separa ambos controles destructivos", () => {
  assert.match(profile, /Cuenta y privacidad/);
  assert.match(profile, /Eliminar estadísticas/);
  assert.match(profile, /Eliminar cuenta/);
  assert.match(profile, /id="delete-stats-title"/);
  assert.match(profile, /id="delete-account-title"/);
  assert.match(profile, /Tu cuenta seguirá existiendo/);
  assert.match(profile, /deleteStatsText/);
  assert.match(profile, /deleteAccountText/);
});

test("reset de estadísticas deriva ownership de sesión, usa RLS y deja auditoría", () => {
  assert.match(statisticsRoute, /authenticatedRequest\(request\)/);
  assert.doesNotMatch(statisticsRoute, /body\?\.userId|body\.userId/);
  assert.match(statisticsRoute, /rpc\("reset_my_statistics"/);
  assert.match(migration, /alter table public\.user_statistics_resets enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /'stats_deleted'/);
  assert.match(migration, /'RESET_FROM_DATE'/);
});

test("solicitud de eliminar cuenta tiene auditoría propia y separada", () => {
  assert.match(deletionRoute, /event_name: "account_delete_requested"/);
  assert.match(deletionRoute, /deleteAccountGraph/);
  assert.doesNotMatch(deletionRoute, /stats_deleted/);
  assert.match(migration, /'account_delete_requested'/);
});
