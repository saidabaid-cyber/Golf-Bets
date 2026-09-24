import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { feedbackPersistenceInput, type FeedbackInput } from "../lib/feedback";

const source = (file: string) => readFileSync(file, "utf8");

test("initial consent offers select-all and includes betting/results/expenses at signup", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.match(consent, /function selectAllAvailable/);
  assert.match(consent, /Seleccionar todo/);
  assert.match(consent, /setBetting\(true\)/);
  assert.match(consent, /resultados y gastos/);
});

test("nearby courses use real browser location and a strict verified 50 km radius", () => {
  const picker = source("app/components/catalog-course-picker.tsx");
  const catalog = source("lib/review-course-catalog.ts");
  const route = source("app/api/courses/search/route.ts");
  assert.match(picker, /resolveAuthorizedNearbyLocation\(localStorage,permissionOwnerId/);
  assert.match(catalog, /REVIEWED_NEARBY_DISTANCE_KM = 50/);
  assert.match(catalog, /distance>REVIEWED_NEARBY_DISTANCE_KM/);
  assert.match(route, /radiusKm: 50/);
  assert.match(picker, /Buscar otro campo/);
});

test("tee requests enter the existing Admin request queue without a destructive enum migration", () => {
  const input: FeedbackInput = { category: "TEE", name: "Campo QA", description: "Falta la salida dorada en el recorrido", replyEmail: "qa@example.invalid", city: "", state: "", brand: "", model: "Doradas", rules: "" };
  const persisted = feedbackPersistenceInput(input);
  assert.equal(persisted.category, "COURSE");
  assert.equal(persisted.name, "Tee faltante · Campo QA");
  assert.match(persisted.description, /Tee solicitado: Doradas/);
  assert.match(source("app/components/round-tee-picker.tsx"), /¿Falta un tee\? Solicitar tee/);
});

test("bag, wedges and ball comparison are guided but preserve explicit manual options", () => {
  const panel = source("app/components/equipment-profile-panel.tsx");
  const editors = source("app/components/equipment-editors.tsx");
  const fit = source("app/components/ball-fit-wizard.tsx");
  for (const label of ["Mini Driver", "Utility / Driving Iron", "Wedges", "Bola"]) assert.match(panel, new RegExp(label.replace("/", "\\/")));
  assert.match(panel, /EquipmentProfileSummary/);
  assert.match(editors, /Agregar loft manualmente/);
  assert.match(editors, /manualLoft/);
  assert.match(fit, /AnchoredSearch label="Bola actual para comparar/);
  assert.match(fit, /¿No encuentras tu bola\? Solicítala/);
});

test("launch monitor is featured and camera plus gallery retain human confirmation", () => {
  const capture = source("app/components/launch-monitor-capture.tsx");
  const camera = source("app/components/launch-monitor-camera.tsx");
  assert.match(capture, /FIT CON LAUNCH MONITOR/);
  assert.match(capture, /USAR LAUNCH MONITOR/);
  assert.doesNotMatch(capture, /<details[\s\S]*Fitting con launch monitor/);
  assert.match(camera, /Tomar fotos ahora/);
  assert.match(camera, /Elegir de Fotos \/ Galería/);
  assert.match(camera, /photos\.length < 2/);
  assert.match(camera, /Confirmar y guardar sesión/);
});

test("social search and QR resolve stable identities before duplicate-safe friendship writes", () => {
  const connections = source("app/components/social-connections-panel.tsx");
  const qr = source("app/components/social-qr.tsx");
  const route = source("app/api/social/connections/route.ts");
  const search = source("app/api/groups/users/route.ts");
  assert.match(search, /normalizeSocialDirectoryQuery/);
  assert.match(search, /search_group_users_v1/);
  assert.match(connections, /Agregar amigo/);
  assert.match(connections, /Solicitud enviada/);
  assert.match(connections, /Amigos ✓/);
  assert.match(qr, /socialIdFromQr/);
  assert.match(qr, /Mostraremos el perfil antes de enviar/);
  assert.match(route, /before\.friends\.includes\(target\)/);
  assert.match(route, /before\.requests\.some/);
});

test("habitual bets edit inline with slots, money affordance and five-percent HCP steps", () => {
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const round = source("app/page.tsx");
  const editor = source("app/components/group-bet-template-editor.tsx");
  const hcp = source("app/components/hcp-percentage-input.tsx");
  assert.doesNotMatch(onboarding, /GroupBetTemplateEditor|Configura tu primer grupo/);
  assert.match(round, /<GroupBetTemplateEditor/);
  assert.match(round, /mode="complete"/);
  assert.match(editor, /Jugador \{String\.fromCharCode\(65 \+ index\)\} \/ Rival/);
  assert.match(editor, /Match Primera/);
  assert.match(editor, /Medal Total/);
  assert.match(editor, /Carry/);
  assert.match(editor, /<span>\$<\/span>/);
  assert.match(editor, /Unidades positivas y negativas/);
  assert.match(hcp, /min=\{5\}/);
  assert.match(hcp, /max=\{100\}/);
  assert.match(hcp, /step=\{5\}/);
});
