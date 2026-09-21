import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const account = readFileSync("app/components/profile-account-panel.tsx", "utf8");
const social = readFileSync("app/components/social-feed.tsx", "utf8");

test("Resultados usa el encabezado seguro Gastos sin interpolar una identidad ausente", () => {
  assert.match(page, /ResultAccordion id="expenses" title="Gastos"/);
  assert.doesNotMatch(page, /Gastos de \$\{owner\?\.name\}/);
});

test("Nueva ronda permite continuar o conservar la anterior en Histórico", () => {
  assert.match(page, /Tienes una ronda activa/);
  assert.match(page, /Continuar ronda actual/);
  assert.match(page, /Iniciar nueva ronda/);
  assert.match(page, /await parkActiveRound\('live'\)/);
  assert.doesNotMatch(page, /Descartar e iniciar nueva/);
});

test("Jugar con un grupo usa el mismo respaldo seguro que Nueva ronda", () => {
  assert.match(page, /function startRoundWithGeneratedGroup\(groupPlayers: Player\[\]\) \{\s*requestNewRoundIntent\(\{ kind: "players", players: structuredClone\(groupPlayers\) \}\);\s*\}/);
  assert.doesNotMatch(page, /function startRoundWithGeneratedGroup[\s\S]{0,220}resetRound\(\)/);
  assert.match(page, /setPendingNewRoundIntent\(intent\);\s*setShowNewRoundConfirm\(true\)/);
  assert.match(page, /if \(!roundClosed && hasRoundToPreserve\(roundDraftPayload\(\), identity.userId\)\)/);
  assert.doesNotMatch(page, /if \(draftAvailable && !roundClosed\) \{\s*setNewRoundBackupError/);
  assert.match(page, /setPendingNewRoundIntent\(null\)/);
  assert.match(page, />Cancelar<\/button>/);
});

test("el invitado conserva su golf local sin presentar un perfil falso como persistente", () => {
  assert.match(account, /view === "profile" && identity\.mode === "guest"/);
  assert.match(account, /Tu golf permanece en este dispositivo/);
  assert.match(account, /perfil persistente/);
  assert.match(account, /view === "profile" && identity\.mode === "authenticated" && <main className="profileMobileStack">/);
});

test("Perfil separa el golf de la configuración sensible de Cuenta", () => {
  const ghin = readFileSync("app/components/ghin-placeholder.tsx", "utf8");
  assert.match(page, /<ProfileAccountPanel key=\{identity.userId\} view="profile"/);
  assert.match(page, /<ProfileAccountPanel key=\{`\$\{identity.userId\}:account:\$\{accountSection\}`\} view="account"/);
  assert.match(account, /Cuenta y privacidad/);
  assert.match(account, /view === "account"/);
  assert.match(account, /Gestionar consentimientos/);
  assert.match(account, /managingConsents[\s\S]*LegalConsentManager/);
  assert.match(account, /HandicapSourceChoices/);
  assert.match(ghin, /VINCULAR GHIN/);
  assert.match(ghin, /PRÓXIMAMENTE/);
});

test("Configuración explica cómo agregar jugadores y grupos guardados", () => {
  assert.match(page, /Toca aquí para agregar un jugador/);
  assert.match(page, /Toca aquí para agregar un grupo/);
});

test("Perfil usa selector de foto o avatar sin pedir URLs manuales", () => {
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.match(account, /validateProfileAvatarUrl\(avatarUrl\)/);
  assert.match(account, /<ProfileImagePicker value=\{avatarUrl\} onChange=\{setAvatarUrl\} onSaveAvatar=\{async \(value\) =>/);
  assert.match(account, /await updateProfile\(\{ displayName: identity.displayName, defaultHandicap: identity.defaultHandicap, avatarUrl: value \}\)/);
  assert.match(account, /onBusyChange=\{setAvatarBusy\} accessToken=\{identity.accessToken\} userId=\{identity.userId\}/);
  assert.match(account, /if \(avatarBusy \|\| saving\) return/);
  assert.doesNotMatch(account, /type="url" inputMode="url"/);
  assert.match(picker, /type="file" aria-label=\{kind === "profile" \? "Seleccionar foto o imagen de avatar" : "Seleccionar imagen del grupo"\} accept="image\/jpeg,image\/png,image\/webp,image\/heic,image\/heif/);
  assert.match(picker, /SIN IMAGEN/);
  assert.match(account, /no modifica tu foto de Google/);
  assert.match(picker, /No necesitas pegar enlaces/);
});

test("Perfil y Cuenta anuncian errores como alertas sin disfrazarlos de éxito", () => {
  assert.match(account, /setMessageKind\("error"\)/);
  assert.match(account, /messageKind === "error" \? "notice bad" : "notice"/);
  assert.match(account, /role=\{messageKind === "error" \? "alert" : "status"\}/);
});

test("Perfil muestra estadísticas reales y deja ausentes como guion", () => {
  for (const field of ["rounds", "averageScore", "averagePutts"]) {
    assert.match(account, new RegExp(`golfInsights\\.${field}`));
  }
  assert.match(account, /decimal\(golfInsights\.averageScore\)/);
  assert.match(page, /roundsEligibleForStatistics\(history, statisticsResetAt\)/);
});

test("Cuenta permite activar avisos internos sin prometer push del dispositivo", () => {
  assert.match(account, /Avisos sociales dentro de la app/);
  assert.match(account, /type="checkbox" checked=\{notificationsEnabled\}/);
  assert.match(account, /onNotificationsEnabledChange\(event\.target\.checked\)/);
  assert.doesNotMatch(account, /<span>Notificaciones<\/span><select value="future" disabled>/);
  assert.doesNotMatch(`${page}\n${account}\n${social}`, /Notification\.requestPermission/);
});

test("Social separa feed de amigos y avisos; lectura persistida y preferencias explícitas", () => {
  assert.match(social, /friendsOnly/);
  assert.match(social, /Notificaciones/);
  assert.match(social, /SocialSharingPreferences/);
  assert.doesNotMatch(social, /localStorage/);
  const cloud = readFileSync("app/components/cloud-social-activity.tsx", "utf8");
  assert.match(cloud, /method: "PATCH", body: \{ id: item.id, read: true \}/);
  assert.match(cloud, /Sin leer/);
});
