import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { feedbackPersistenceInput, type FeedbackInput } from "../lib/feedback";

const source = (file: string) => readFileSync(file, "utf8");

test("initial consent separates required documents from the explicit optional bundle", () => {
  const consent = source("app/components/account-consent-checkpoint.tsx");
  assert.match(consent, /resolveOnboardingOptionalBundle/);
  assert.match(consent, /AUTORIZAR TODO Y CONTINUAR/);
  assert.match(consent, /CONSENTIMIENTOS REQUERIDOS/);
  assert.match(consent, /marketing y cada autorización de IA conservan evidencia separada/);
  assert.doesNotMatch(consent, /type="checkbox"/);
  assert.doesNotMatch(consent, /FUNCIONES DE APUESTAS|ACTIVAR APUESTAS/);
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

test("bag, universal wedge lofts and ball comparison remain guided", () => {
  const panel = source("app/components/equipment-profile-panel.tsx");
  const bagManagement = source("lib/equipment-bag-management.ts");
  const editors = source("app/components/equipment-editors.tsx");
  const fit = source("app/components/ball-fit-wizard.tsx");
  for (const label of ["Mini Driver", "Utility / Driving Iron", "Wedges"]) assert.match(bagManagement, new RegExp(label.replace("/", "\\/")));
  assert.match(panel, /MI BOLA/);
  assert.match(panel, /EquipmentProfileSummary/);
  assert.match(editors, /UNIVERSAL_WEDGE_LOFTS\.map/);
  assert.doesNotMatch(editors, /Agregar loft manualmente|manualLoft/);
  assert.match(fit, /AnchoredSearch label="Bola actual para comparar/);
  assert.match(fit, /¿No encuentras tu bola\? Solicítala/);
});

test("launch monitor is featured and camera plus gallery auto-apply clear readings", () => {
  const capture = source("app/components/launch-monitor-capture.tsx");
  const camera = source("app/components/launch-monitor-camera.tsx");
  assert.match(capture, /Capturar datos manualmente/);
  assert.match(capture, /Guardar mediciones/);
  assert.match(capture, /Continuar con Ball Fit/);
  assert.doesNotMatch(capture, /Guardar y continuar|nextProtocolClub/);
  assert.match(capture, /const \[manualOpen, setManualOpen\] = useState\(false\)/);
  assert.match(capture, /visitedClubs\.map/);
  assert.match(capture, /EQUIPMENT_CATEGORY_ASSETS/);
  assert.doesNotMatch(capture, /<details[\s\S]*Fitting con launch monitor/);
  assert.match(camera, /Tomar fotos/);
  assert.match(camera, /Elegir de galería/);
  assert.match(camera, /pendingPhotos\.length < 1/);
  assert.doesNotMatch(camera, /clearPhotos/);
  assert.match(camera, /Corrige sólo lo necesario/);
  assert.match(camera, /onConfirm\(assigned\.source, detected\)/);
  assert.doesNotMatch(camera, /Confirmar y guardar sesión/);
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

test("habitual bets use named member identities, money affordance and five-percent HCP steps", () => {
  const onboarding = source("app/components/beta-onboarding-flow.tsx");
  const round = source("app/page.tsx");
  const editor = source("app/components/group-bet-template-editor.tsx");
  const hcp = source("app/components/hcp-percentage-input.tsx");
  assert.doesNotMatch(onboarding, /GroupBetTemplateEditor|Configura tu primer grupo/);
  assert.match(round, /<GroupBetTemplateEditor/);
  assert.match(round, /mode="complete"/);
  assert.match(editor, /Principal<select[\s\S]*Rival<select/);
  assert.match(editor, /memberAssignment/);
  assert.match(editor, /Match Primera/);
  assert.match(editor, /Medal Total/);
  assert.match(editor, /Carry/);
  assert.match(editor, /<BetMoneyInput/);
  assert.match(source("app/components/bet-money-input.tsx"), /<span aria-hidden="true">\$<\/span>/);
  assert.match(editor, /Unidades positivas y negativas/);
  assert.match(hcp, /min=\{5\}/);
  assert.match(hcp, /max=\{100\}/);
  assert.match(hcp, /step=\{5\}/);
});
