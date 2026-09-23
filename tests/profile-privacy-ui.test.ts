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
  assert.match(profile, /HandicapSourceChoices/);
  assert.doesNotMatch(profile, /value=\{handicap\}/);
  assert.match(css, /\.profileMobileStack\{display:grid/);
});

test("Foto, Emoji, Crear avatar y Sin imagen son cuatro opciones 2×2 responsive sin solaparse", () => {
  for (const [mode, label] of [["photo", "FOTO"], ["emoji", "EMOJI"], ["create", "CREAR AVATAR"], ["none", "SIN IMAGEN"]]) {
    assert.match(picker, new RegExp(`\\["${mode}", "${label}"\\]`));
  }
  assert.match(picker, /aria-pressed=\{mode === option \|\| \(mode === "custom" && option === "create"\)\}/);
  assert.match(pickerCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(pickerCss, /@media \(max-width: 430px\)/);
  assert.match(picker, /kind === "profile" \? styles\.profilePreview : ""/);
  assert.match(pickerCss, /\.profilePreview \{ border-radius: 50%; \}/);
});

test("Perfil enlaza Mi Bolsa y un único acceso principal a Configuración", () => {
  assert.match(profile, /aria-label="Secciones de Mi Perfil"/);
  for (const section of ["Mi Bolsa", "Configuración"]) assert.match(profile, new RegExp(`<b>${section}</b>`));
  assert.doesNotMatch(profile, /profileNavigationCard"[^>]*><span><b>Preferencias<\/b>/);
  assert.doesNotMatch(profile, /profileNavigationCard"[^>]*><span><b>Notificaciones<\/b>/);
  assert.match(profile, /onClick=\{onOpenEquipment\}[\s\S]*?<b>Mi Bolsa<\/b>/);
  assert.doesNotMatch(profile, /<b>Mi equipo<\/b>/);
  assert.match(profile, /onBackToProfile/);
  assert.match(page, /onOpenEquipment=\{\(\) => setProfileFocus\("equipment"\)\}/);
  assert.match(page, /onBackToProfile=\{openProfileRoot\}/);
  assert.match(page, /setProfileRootRevision\(\(value\) => value \+ 1\)/);
  assert.match(profile, /setEditing\(false\); setManagingConsents\(false\)/);
  assert.match(css, /\.profileNavigationList\{display:grid;min-width:0/);
});

test("Perfil carga y guarda la mano dominante desde la fuente canónica", () => {
  assert.match(profile, /handedness: identity\.handedness \|\| ""/);
  assert.match(profile, /select value=\{draft\.handedness\}/);
  assert.match(profile, /option value="right">Derecha/);
  assert.match(profile, /option value="left">Izquierda/);
  assert.match(profile, /updateProfile\(\{ displayName:[\s\S]*\.\.\.draft \}\)/);
});

test("Perfil refresca el borrador con la identidad canónica cada vez que abre el editor", () => {
  assert.match(profile, /function openProfileEditor\(target: string \| null = null\)/);
  assert.match(profile, /setDraft\(draftFromIdentity\(identity\)\)/);
  assert.match(profile, /setCompletionEditTarget\(target\);\s*setEditing\(true\)/);
  assert.match(profile, /onClick=\{\(\) => openProfileEditor\(\)\}>Editar perfil/);
  assert.doesNotMatch(profile, /onClick=\{\(\) => setEditing\(true\)\}/);
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
  const dialogs = readFileSync("app/components/profile-data-dialogs.tsx", "utf8");
  assert.match(dialogs, /id="delete-stats-title"/);
  assert.match(dialogs, /id="delete-account-title"/);
  assert.match(dialogs, /Tu cuenta seguirá existiendo/);
  assert.match(profile, /<StatisticsResetDialog[^\n]*onConfirm=\{\(\) => void deleteStatistics\(\)\}/);
  assert.match(profile, /<AccountDataDialog[^\n]*onConfirm=\{\(\) => void deleteAccount\(\)\}/);
  assert.match(profile, /deleteStatsText/);
  assert.match(profile, /deleteAccountText/);
});

test("destructive dialog headings reserve the complete 44px close target plus gap", () => {
  const dialogCss = readFileSync("app/components/profile-data-dialogs.module.css", "utf8");
  const heading = dialogCss.match(/\.dialog h2\s*\{([^}]+)\}/)?.[1] || "";
  const reserved = Number(heading.match(/padding-right:\s*(\d+)px/)?.[1]);
  assert.ok(reserved >= 44 + 8, "at 390px the title must wrap before the close button, not underneath it");
  assert.match(dialogCss, /max-height:calc\(100dvh/);
  assert.match(dialogCss, /overflow-y:auto/);
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

test("elección de borrar o archivar cuenta pasa por saga aislada y Auth verificado", () => {
  assert.match(deletionRoute, /authenticatedRequest\(request, \{ allowLifecycleRecovery: true \}\)/);
  assert.match(deletionRoute, /parseAccountDeletionChoice\(read\.value\)/);
  assert.match(deletionRoute, /code: "CONTROLLED_DB_ACTION_REQUIRED"/);
  assert.match(deletionRoute, /legalReview: "LEGAL_REVIEW_REQUIRED"/);
  assert.doesNotMatch(deletionRoute, /event_name: "account_delete_requested"|deleteAccountGraph\(/);
  assert.doesNotMatch(deletionRoute, /stats_deleted/);
  assert.match(migration, /'account_delete_requested'/);
});
