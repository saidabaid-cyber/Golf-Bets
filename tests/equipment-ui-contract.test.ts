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
const equipmentProfileHook = readFileSync("app/components/use-equipment-profile.ts", "utf8");
const catalogSearchHook = readFileSync("app/components/use-equipment-catalog-search.ts", "utf8");
const catalogRoute = readFileSync("app/api/catalog/equipment/route.ts", "utf8");
const ballFitRoute = readFileSync("app/api/ball-fitting/route.ts", "utf8");
const ballFitApi = readFileSync("lib/ball-fitting-api.ts", "utf8");
const catalogServerLoader = readFileSync("lib/equipment-catalog-provider.server.ts", "utf8");

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
  assert.match(editors, /Mi varilla no aparece/);
  for (const field of ["Marca", "Modelo", "Generación", "Loft", "Mano", "Varilla", "Flex", "Peso de varilla", "Longitud", "Lie", "Grip", "Notas"]) assert.match(editors, new RegExp(field));
  for (const set of ["4–P", "4–AW", "5–P", "5–AW"]) assert.match(editors, new RegExp(set));
  assert.match(editors, /Personalizar set/);
  assert.match(panel, /Mi bolsa/);
  assert.match(panel, /Editar/);
  assert.match(panel, /Mover a anterior/);
  assert.match(panel, /Equipo anterior/);
  assert.match(panel, /removePlayerClub/);
  for (const iron of ["1", "2", "UW"]) assert.match(editors, new RegExp(`"${iron}"`));
  assert.match(editors, /customShaftBrand/);
  assert.match(editors, /customShaftModel/);
});

test("Mi juego y las distancias manuales son opcionales y usan el mismo perfil", () => {
  assert.match(accountPanel, /MI JUEGO/);
  for (const field of ["typicalScore", "driverDistanceYards", "driverSwingSpeedBand", "usualTrajectory", "shotTendency", "greenSpeed", "gamePriority", "priceImportance"]) assert.match(accountPanel, new RegExp(field));
  assert.match(panel, /<h2>Distancias<\/h2>/);
  assert.match(panel, /upsertPlayerClubDistance/);
  assert.match(panel, /removePlayerClubDistance/);
  assert.match(panel, /item\.source === "MANUAL"/);
  assert.match(editors, /ClubDistanceEditor/);
  assert.match(editors, /source: "MANUAL"/);
});

test("bola y Ball Fit exponen el flujo completo sin presentar una verdad oficial", () => {
  assert.match(onboarding, /Encuentra bolas que se ajusten a tu juego/);
  assert.match(onboarding, /El fitting usa tu HCP, velocidad, vuelo, spin, control y sensación/);
  assert.match(onboarding, /Hacer Ball Fit/);
  assert.match(onboarding, /Registrar mi bola actual/);
  assert.match(panel, /The Backyard Ball Fit/);
  assert.match(panel, /Tu grupo recomendado/);
  assert.match(wizard, /Tu mejor grupo de bolas/);
  assert.match(wizard, /Match/);
  assert.match(wizard, /Sin dato verificado/);
  assert.match(wizard, /Comparar bolas recomendadas/);
  for (const row of ["Construcción", "Cubierta", "Compresión"]) assert.match(wizard, new RegExp(row));
  assert.match(wizard, /optionalHandicap/);
  assert.match(wizard, /BACKYARD_BALL_FIT_DISCLAIMER/);
  assert.match(fitting, /No es un fitting oficial/);
  assert.doesNotMatch(wizard, /fitting oficial de (Titleist|Callaway|Bridgestone)/i);
});

test("Ball Fit evalúa el catálogo completo en servidor y falla cerrado antes de rankear una página parcial", () => {
  assert.match(wizard, /fetch\("\/api\/ball-fitting"/);
  assert.match(wizard, /createBallFitTransportInput\(input\)/);
  assert.match(wizard, /JSON\.stringify\(\{ input: transportInput \}\)/);
  assert.doesNotMatch(wizard, /runBackyardBallFit\(catalog,/);
  assert.match(wizard, /normalizeBallFitApiSuccess/);
  assert.match(wizard, /no mostramos rankings parciales/);
  assert.match(ballFitRoute, /loadBallFitCatalog/);
  assert.match(ballFitRoute, /normalizeBallFitTransportInput/);
  assert.match(ballFitRoute, /BALL_FIT_CATALOG_MAX_CANDIDATES/);
  assert.match(ballFitRoute, /if \(!scope\.complete\)/);
  assert.match(ballFitRoute, /runBackyardBallFit\(scope\.items, input\)/);
  assert.match(ballFitRoute, /private, no-store/);
  assert.match(ballFitApi, /BALL_FIT_CATALOG_MAX_CANDIDATES = 2_000/);
  assert.match(ballFitApi, /returns only the current and recommended records/);
});

test("los selectores buscan catálogo en servidor con debounce, límite y fallback offline", () => {
  assert.match(editors, /useEquipmentCatalogSearch/);
  assert.match(editors, /Buscar bastón/);
  assert.match(editors, /Buscar bola/);
  assert.match(catalogSearchHook, /window\.setTimeout/);
  assert.match(catalogSearchHook, /250/);
  assert.match(editors, /Sin conexión/);
  assert.match(catalogRoute, /internalEquipmentCatalogProvider\.search/);
  assert.match(catalogRoute, /limit/);
  assert.match(catalogRoute, /cache-control/);
  assert.match(catalogRoute, /pinnedIds/);
  assert.match(catalogSearchHook, /loadMore/);
  assert.match(catalogSearchHook, /normalizeGolfBallCatalogEntries/);
  assert.match(catalogServerLoader, /import "server-only"/);
  assert.doesNotMatch(onboarding, /golf-equipment-catalog/);
  assert.doesNotMatch(panel, /golf-equipment-catalog/);
  assert.match(editors, /immutable display snapshot/);
});

test("una página de una búsqueda anterior nunca se anexa después de cambiar query o categoría", () => {
  assert.match(catalogSearchHook, /requestGenerationRef/);
  assert.match(catalogSearchHook, /loadMoreControllerRef\.current\?\.abort\(\)/);
  assert.match(catalogSearchHook, /requestGenerationRef\.current !== generation/);
  assert.match(catalogSearchHook, /signal: controller\.signal/);
});

test("cerrar el Ball Fit no afirma guardar cuando localStorage falla", () => {
  assert.match(wizard, /function saveAndClose\(\)/);
  assert.match(wizard, /if \(!saveBallFitDraft\(localStorage, input,/);
  assert.match(wizard, /setMessage\(DRAFT_SAVE_ERROR\);\s*return;/);
  assert.match(wizard, /onClick=\{saveAndClose\}>Guardar y regresar/);
  assert.match(wizard, /message === DRAFT_SAVE_ERROR/);
  assert.match(wizard, /onClick=\{exitWithoutSaving\}>Salir sin guardar/);
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
  assert.match(equipmentProfileHook, /equipmentProfileFingerprint/);
  assert.match(equipmentProfileHook, /lastQueuedFingerprintRef/);
  assert.match(equipmentProfileHook, /shouldQueueEquipmentFingerprint/);
});
