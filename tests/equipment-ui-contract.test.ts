import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync("app/components/account-provider.tsx", "utf8");
const onboarding = readFileSync("app/components/equipment-onboarding.tsx", "utf8");
const panel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
const editors = readFileSync("app/components/equipment-editors.tsx", "utf8");
const wizard = readFileSync("app/components/ball-fit-wizard.tsx", "utf8");
const fitting = readFileSync("lib/ball-fitting.ts", "utf8");
const launch = readFileSync("app/components/launch-monitor-capture.tsx", "utf8");
const accountPanel = readFileSync("app/components/account-panel.tsx", "utf8");
const workspace = readFileSync("lib/account-workspace.ts", "utf8");

test("el onboarding de equipo ocurre después del perfil básico y siempre se puede omitir", () => {
  assert.match(provider, /ProfileSetupScreen[\s\S]*onSave=\{saveInitialProfile\}/);
  assert.match(provider, /equipmentOnboardingRequired[\s\S]*<EquipmentOnboarding/);
  assert.match(onboarding, /¿Quieres agregar los bastones que juegas actualmente\?/);
  assert.match(onboarding, /Agregar mis bastones/);
  assert.match(onboarding, /Omitir por ahora/);
  assert.match(onboarding, /Saltar por ahora y entrar a The Backyard/);
  assert.match(onboarding, /Continuar sin agregar equipo/);
  assert.doesNotMatch(onboarding, /required=/, "ningún dato opcional de equipo debe bloquear el onboarding");
});

test("Mi bolsa permite catálogo, captura manual, múltiples categorías, edición e histórico", () => {
  for (const label of ["Driver", "Mini Driver", "Maderas", "Híbridos", "Utility / Driving Iron", "Hierros", "Wedges", "Putter"]) assert.match(editors, new RegExp(label.replace("/", "\\/")));
  assert.match(editors, /Mi bastón no aparece/);
  assert.match(editors, /Mi shaft no aparece/);
  for (const field of ["Marca", "Modelo", "Generación", "Loft", "Mano", "Shaft", "Flex", "Peso shaft", "Longitud", "Lie", "Grip", "Notas"]) assert.match(editors, new RegExp(field));
  assert.match(panel, /Mi bolsa/);
  assert.match(panel, /Editar/);
  assert.match(panel, /Mover a anterior/);
  assert.match(panel, /Equipo anterior/);
  assert.match(panel, /removePlayerClub/);
});

test("bola y Ball Fit exponen el flujo completo sin presentar una verdad oficial", () => {
  assert.match(onboarding, /¿Qué bola juegas normalmente\?/);
  assert.match(onboarding, /No tengo una bola fija/);
  assert.match(onboarding, /¿Quieres descubrir qué tipo de bola puede ajustarse mejor a tu juego\?/);
  assert.match(panel, /The Backyard Ball Fit/);
  assert.match(panel, /Tu grupo recomendado/);
  assert.match(wizard, /Tu mejor grupo de bolas/);
  assert.match(wizard, /Match/);
  assert.match(wizard, /Sin dato verificado/);
  assert.match(wizard, /Comparar bolas recomendadas/);
  assert.match(wizard, /BACKYARD_BALL_FIT_DISCLAIMER/);
  assert.match(fitting, /No es un fitting oficial/);
  assert.doesNotMatch(wizard, /fitting oficial de (Titleist|Callaway|Bridgestone)/i);
});

test("cerrar el Ball Fit no afirma guardar cuando localStorage falla", () => {
  assert.match(wizard, /function saveAndClose\(\)/);
  assert.match(wizard, /if \(!saveBallFitDraft\(localStorage, input,/);
  assert.match(wizard, /setMessage\(DRAFT_SAVE_ERROR\);\s*return;/);
  assert.match(wizard, /onClick=\{saveAndClose\}>Guardar y regresar/);
});

test("las doce señales rápidas y las prioridades ordenables están disponibles", () => {
  for (const copy of ["Bola actual", "HCP manual", "Score típico", "Cuánto pegas", "Velocidad de swing", "Cómo prefieres sentir", "Trayectoria preferida", "Tus greens", "tiros de aproximación", "más control / spin", "Qué tanto importa el precio", "Color preferido"]) assert.match(wizard, new RegExp(copy, "i"));
  for (const priority of ["Distancia con driver", "Menos spin con driver", "Mayor estabilidad / control", "Altura", "Control con hierros", "Poder detener la bola en green", "Spin de wedges", "Sensación alrededor del green", "Sensación con putter"]) assert.ok(wizard.includes(priority));
  assert.match(wizard, /movePriority/);
  assert.match(wizard, /Subir/);
  assert.match(wizard, /Bajar/);
});

test("launch monitor conserva golpes parciales, exclusiones y resumen robusto", () => {
  for (const label of ["Driver", "Hierro 7", "Pitching wedge", "Half wedge / approach", "Velocidad del palo", "Velocidad de bola", "Ángulo de lanzamiento", "Spin", "Carry", "Altura máxima", "Ángulo de caída"]) assert.ok(launch.includes(label));
  assert.match(launch, /Excluir/);
  assert.match(launch, /Reactivar/);
  assert.match(launch, /Med\./);
  assert.match(launch, /Res\./);
  assert.match(launch, /3 golpes válidos/);
  assert.match(launch, /Guardar captura parcial/);
});

test("Perfil carga el módulo con la misma identidad y la eliminación de cuenta limpia sus datos", () => {
  assert.match(accountPanel, /<EquipmentProfilePanel userId=\{identity\.userId\} accessToken=\{identity\.accessToken\}/);
  assert.match(workspace, /equipmentProfileStorageKey\(userId\)/);
  assert.match(workspace, /ballFitDraftStorageKey\(userId\)/);
  assert.match(workspace, /equipment-onboarding-ready/);
  assert.doesNotMatch(panel, /Math\.random\(\).*ballBrand|fake|mock/i);
});

test("el módulo incluye estados de carga, vacío, error, offline y sincronización", () => {
  assert.match(panel, /status === "loading"/);
  assert.match(panel, /emptyState/);
  assert.match(panel, /message/);
  assert.match(panel, /status === "offline"/);
  assert.match(panel, /status === "conflict"/);
});
