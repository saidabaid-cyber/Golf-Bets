import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const account = readFileSync("app/components/account-panel.tsx", "utf8");
const social = readFileSync("app/components/social-feed.tsx", "utf8");

test("Resultados usa el encabezado seguro Gastos sin interpolar una identidad ausente", () => {
  assert.match(page, /ResultAccordion id="expenses" title="Gastos"/);
  assert.doesNotMatch(page, /Gastos de \$\{owner\?\.name\}/);
});

test("Nueva ronda pide confirmación exacta y conserva respaldo antes de reemplazar", () => {
  assert.match(page, /¿Iniciar una nueva ronda\?/);
  assert.match(page, /Ya tienes una ronda en curso\. Si comienzas una nueva, la ronda actual dejará de ser la ronda activa\./);
  assert.match(page, /Sí, iniciar nueva ronda/);
  assert.match(page, /backupActiveRoundForReplacement\(localStorage/);
  assert.match(page, /applyNewRoundIntent\(intent, "La ronda anterior quedó respaldada en este dispositivo\."\)/);
});

test("Jugar con un grupo usa el mismo respaldo seguro que Nueva ronda", () => {
  assert.match(page, /function startRoundWithGeneratedGroup\(groupPlayers: Player\[\]\) \{\s*requestNewRoundIntent\(\{ kind: "group", players: structuredClone\(groupPlayers\) \}\);\s*\}/);
  assert.doesNotMatch(page, /function startRoundWithGeneratedGroup[\s\S]{0,220}resetRound\(\)/);
  assert.match(page, /setPendingNewRoundIntent\(intent\);\s*setShowNewRoundConfirm\(true\)/);
  assert.match(page, /if \(!roundClosed && hasRoundProgress\(roundDraftPayload\(\)\)\)/);
  assert.doesNotMatch(page, /if \(draftAvailable && !roundClosed\) \{\s*setNewRoundBackupError/);
  assert.match(page, /setPendingNewRoundIntent\(null\)/);
  assert.match(page, />Cancelar<\/button>/);
});

test("el perfil invitado es local y Cuenta no inventa una identidad de nube", () => {
  assert.match(account, /Modo invitado · Los datos permanecen en este dispositivo/);
  assert.match(account, /view === "profile" && <section className="card profileCard">/);
  assert.match(account, /Perfil local en este dispositivo/);
  assert.doesNotMatch(account, /Sin correo · Invitado/);
});

test("Perfil separa el golf de la configuración sensible de Cuenta", () => {
  assert.match(page, /<AccountPanel view="profile"/);
  assert.match(page, /<AccountPanel view="account"/);
  assert.match(account, /view === "profile" && golfInsights/);
  assert.match(account, /view === "account" && <><section className="card"><h2>Documentos y consentimiento/);
  assert.match(account, /Abrir configuración de cuenta/);
  assert.match(account, /no emite ni certifica un handicap oficial/);
});

test("Configuración explica cómo agregar jugadores y grupos guardados", () => {
  assert.match(page, /Toca aquí para agregar un jugador/);
  assert.match(page, /Toca aquí para agregar un grupo/);
});

test("Perfil permite una foto HTTPS removible sin filtrar referrer", () => {
  assert.match(account, /validateProfileAvatarUrl\(avatarUrl\)/);
  assert.match(account, /type="url" inputMode="url" autoComplete="url" maxLength=\{2048\}/);
  assert.match(account, /Quitar foto/);
  assert.match(account, /no modifica tu foto de Google/);
  assert.match(account, /referrerPolicy="no-referrer"/);
});

test("Perfil muestra estadísticas reales y deja ausentes como guion", () => {
  for (const field of ["pars", "birdies", "bogeys", "doublesOrWorse", "last5Average", "last10Average", "averageVsPar"]) {
    assert.match(account, new RegExp(`golfInsights\\.${field}`));
  }
  assert.match(account, /golfInsights\.scoredRounds \? golfInsights\.pars : "—"/);
  assert.match(account, /Promedios con \{golfInsights\.scoreSampleRounds\}/);
});

test("Cuenta permite activar avisos internos sin prometer push del dispositivo", () => {
  assert.match(account, /Avisos dentro de la app/);
  assert.match(account, /type="checkbox" checked=\{notificationsEnabled\}/);
  assert.match(account, /onNotificationsEnabledChange\(event\.target\.checked\)/);
  assert.match(account, /no activa notificaciones push ni permisos del (teléfono|dispositivo)/i);
  assert.doesNotMatch(account, /<span>Notificaciones<\/span><select value="future" disabled>/);
  assert.doesNotMatch(`${page}\n${account}\n${social}`, /Notification\.requestPermission/);
});

test("Social separa actividad y avisos, con lectura explícita y estado desactivado", () => {
  assert.match(social, />Actividad<\/button>/);
  assert.match(social, />Avisos/);
  assert.match(social, /Marcar todo como leído/);
  assert.match(social, /Avisos internos desactivados/);
  assert.match(social, /onNotificationsEnabledChange\(true\)/);
});
