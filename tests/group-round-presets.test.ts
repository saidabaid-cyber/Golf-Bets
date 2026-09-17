import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const page = readFileSync("app/page.tsx", "utf8");
const builder = readFileSync("app/components/group-builder.tsx", "utf8");
const selector = readFileSync("app/components/group-round-selector.tsx", "utf8");
const css = readFileSync("app/functional-ux.css", "utf8");
const migration = readFileSync("supabase/migrations/20260913175810_group_round_presets.sql", "utf8");

test("la tarjeta móvil separa nombre, HCP y acciones sin widths rígidos", () => {
  assert.match(css, /\.playerEdit\{[^}]*grid-template-columns:minmax\(0,1fr\) 44px 44px/);
  assert.match(css, /grid-template-areas:"name name name" "hcp owner remove"/);
  assert.match(css, /\.playerEdit>\.playerNameField\{grid-area:name[^}]*max-height:calc\(2\.6em \+ 24px\)/);
  assert.match(css, /\.playerEdit>\.ownerDot\{grid-area:owner/);
  assert.match(css, /\.playerEdit>\.remove\{grid-area:remove/);
  assert.match(css, /\.manualRoundHcp \.roundHcpLabel/);
  assert.match(page, /<textarea className="playerNameField" rows=\{1\}/);
  assert.match(page, /<span className="roundHcpLabel">HCP<\/span>/);
});

test("Index y HCP permanecen compactos; tee y Rating/Slope se consultan al expandir", () => {
  assert.match(page, /<details className=\{`roundHcpField roundPlayingHcp compactPlayingHcp/);
  assert.match(page, /<summary aria-label=\{`Ver tee y cálculo de HCP/);
  assert.match(page, /INDEX \{p\.handicapIndex \?\? "—"\} · HCP \{p\.handicap \?\? "—"\}/);
  assert.match(page, /<div className="roundPlayingHcpDetail">/);
  assert.match(css, /\.playerEdit \.compactPlayingHcp\{display:block;min-height:44px/);
  assert.match(css, /\.compactPlayingHcp summary\{display:flex;[^}]*min-height:44px/);
});

test("Grupos expone roster, apuestas y el inicio de ronda desde la misma tarjeta", () => {
  for (const copy of ["Mis grupos", "Invitaciones", "Crear grupo", "Apuestas del grupo", "Editar jugadores y apuestas", "Iniciar ronda"]) {
    assert.match(builder, new RegExp(copy));
  }
  assert.match(builder, /frequentGroupTemplateDetails/);
  assert.match(builder, /<GroupInvitationInbox accessToken=\{identity\.accessToken\} onAccepted=\{retryCloudSync\}/);
  assert.doesNotMatch(builder, /PENDING_CONTROLLED_DB_APPLY|Invitación local/, "live invitations replace obsolete pending/local placeholders");
  assert.match(page, /<GroupBetTemplateEditor/);
  assert.match(page, /createEmptyGroupGameTemplate/);
});

test("el selector muestra todos los miembros, contador 5 y bloqueo explícito del sexto", () => {
  assert.match(selector, /group\.players\.map/);
  assert.match(selector, /selectedMemberIds\.length/);
  assert.match(selector, /MAX_ROUND_GROUP_PLAYERS/);
  assert.match(selector, /MÁXIMO 5 JUGADORES POR GRUPO DE SALIDA/);
  assert.match(selector, /El grupo original y sus integrantes no cambian/);
});

test("editar una ronda basada en grupo distingue sólo esta ronda de actualizar plantilla", () => {
  assert.match(page, /Sólo esta ronda/);
  assert.match(page, /Guardar también en Grupo/);
  assert.match(page, /Agregar también al grupo/);
  assert.match(page, /saveRoundAsFrequentGroupTemplate/);
  assert.match(page, /addRoundOnlyPlayersToSourceGroup/);
});

test("el histórico persiste un snapshot del grupo en vez de releer la plantilla mutable", () => {
  assert.match(page, /createRoundGroupSnapshot\(roundTemplateOrigin, players\)/);
  assert.match(page, /\.\.\.\(groupOrigin \? \{ groupOrigin \} : \{\}\)/);
  const detail = readFileSync("app/components/historical-round-detail.tsx", "utf8");
  assert.match(detail, /Grupo \$\{round\.groupOrigin\.groupName\}/);
});

test("la migración separa plantillas relacionales del snapshot inmutable y cierra acceso anónimo", () => {
  for (const table of [
    "group_bet_templates_v2",
    "group_bet_template_participants_v2",
    "group_team_templates_v2",
    "group_team_template_members_v2",
    "round_group_snapshots_v2",
    "round_group_snapshot_players_v2",
  ]) {
    assert.match(migration, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
  }
  assert.match(migration, /selected_player_count smallint not null check \(selected_player_count between 1 and 5\)/);
  assert.match(migration, /revoke all on table[\s\S]*from anon/);
  assert.doesNotMatch(migration, /round_group_snapshots_v2[^;]*for (update|delete)/i);
});
