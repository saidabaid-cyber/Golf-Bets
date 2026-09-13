import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const profile = readFileSync("app/components/profile-account-panel.tsx", "utf8");
const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
const pickerCss = readFileSync("app/components/profile-image-picker.module.css", "utf8");
const css = readFileSync("app/profile-account.css", "utf8");
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

test("Foto, Emoji y Sin imagen son tres opciones responsive sin solaparse", () => {
  for (const option of ["FOTO", "EMOJI", "SIN IMAGEN"]) assert.match(picker, new RegExp(option));
  assert.match(pickerCss, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(pickerCss, /@media \(max-width: 430px\)/);
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
