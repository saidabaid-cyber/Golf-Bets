import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("todos los archivos con diálogos interactivos exponen una salida visible", () => {
  const files = [
    "app/components/account-panel.tsx",
    "app/components/account-provider.tsx",
    "app/components/backyard-ai/ai-processing-consent.tsx",
    "app/components/betting-consent-dialog.tsx",
    "app/components/equipment-editors.tsx",
    "app/components/equipment-profile-panel.tsx",
    "app/components/group-builder.tsx",
    "app/components/internal-pdf-viewer.tsx",
    "app/components/modal-shell.tsx",
    "app/components/supplemental-bets-editor.tsx",
    "app/page.tsx",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(source, /ModalCloseButton|modalClose|helpClose|holeSummaryClose/, `${file} no expone cierre`);
  }
  const globalStyles = read("app/globals.css");
  assert.match(globalStyles, /\.modalCloseButton\{[^}]*width:44px[^}]*height:44px/);
  assert.match(globalStyles, /\.modalCloseButton\{[^}]*safe-area-inset-top/);
});

test("los wizards reinician su propio scroll y conservan el contexto detrás", () => {
  const modalHook = read("app/components/use-modal-dialog.ts");
  const equipment = read("app/components/equipment-editors.tsx");
  const onboarding = read("app/components/beta-onboarding-flow.tsx");
  assert.match(modalHook, /dialogRef\.current\.scrollTop = 0/);
  assert.match(modalHook, /focus\(\{ preventScroll: true \}\)/);
  assert.match(modalHook, /priorFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.equal((equipment.match(/useWizardStepNavigation\(dialogRef, step\)/g) || []).length, 2);
  assert.match(onboarding, /window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
  assert.match(onboarding, /titleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("Home aprobada mantiene acciones manual y AI separadas y sus contratos reales", () => {
  const home = read("app/components/home-dashboard.tsx");
  assert.match(home, /data-home-version="approved-golf-home-v2"/);
  assert.match(home, /const playAction = activeRound \? onContinueRound : onNewRound/);
  assert.match(home, /onOpenGroups/);
  assert.match(home, /onOpenHistory/);
  assert.match(home, /onOpenStats/);
  assert.match(home, /onOpenSettings/);
  assert.match(home, /onOpenNotifications/);
  assert.equal((home.match(/onAiRound/g) || []).length, 3, "prop, destructuring y una única acción AI esperadas");
  assert.doesNotMatch(home, /estadísticas vacías|primera ronda/i);
});

test("onboarding y editor de ronda conservan configuración avanzada de apuestas", () => {
  const onboarding = read("app/components/beta-onboarding-flow.tsx");
  const templateEditor = read("app/components/group-bet-template-editor.tsx");
  const round = read("app/page.tsx");
  assert.match(onboarding, /GroupBetTemplateEditor/);
  for (const contract of ["Mantener decimales", "Fijo + Patada", "Presión · segunda vuelta", "3 hoyos", "18 hoyos", "Índice actual", "Sliding"]) {
    assert.match(templateEditor, new RegExp(contract.replace(/[+]/g, "\\+")));
  }
  assert.match(round, /SupplementalBetsEditor/);
  assert.match(round, /Foursome/);
  assert.match(round, /Personales/);
});
