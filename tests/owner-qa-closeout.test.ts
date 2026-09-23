import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

test("todos los archivos con diálogos interactivos exponen una salida visible", () => {
  const files = [
    "app/components/account-panel.tsx",
    "app/components/profile-account-panel.tsx",
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
    if (file.endsWith("/account-panel.tsx") || file.endsWith("/profile-account-panel.tsx")) {
      // Account screens delegate their interactive modal to the canonical
      // dialog: follow the handler through that component, not a name-only opt-out.
      assert.match(source, /<AccountDataDialog[^\n]*onClose=\{\(\) => \{ setDelete(?:Account)?Open\(false\)/, `${file} no conecta cierre`);
      const dialog = read("app/components/profile-data-dialogs.tsx");
      assert.match(dialog, /<Dialog titleId="delete-account-title" busy=\{props\.busy\} onClose=\{props\.onClose\}/);
      assert.match(dialog, /<ModalCloseButton onClose=\{onClose\} disabled=\{busy\}/);
      assert.match(dialog, /disabled=\{props\.busy\} onClick=\{props\.onClose\}>Cancelar<\/button>/);
    } else if (file.endsWith("/equipment-profile-panel.tsx")) {
      // Equipment is now full-page throughout: verify real exits instead of
      // requiring a modal close icon on a screen which no longer is a modal.
      assert.doesNotMatch(source, /role="dialog"|styles\.editorBackdrop/);
      assert.match(source, /data-equipment-screen="ball-fit"[^\n]*onCancel=\{\(\) => setFitOpen\(false\)\}/);
      assert.match(source, /data-equipment-screen="saved-ball-fit"[^\n]*onClick=\{\(\) => setSavedFitOpen\(false\)\}>← Volver a Mi Bolsa/);
      for (const editor of ["club", "ball", "distance"]) {
        assert.match(source, new RegExp(`onCancel=\\{\\(\\) => set${editor[0].toUpperCase() + editor.slice(1)}Editor\\(null\\)\\}`));
      }
      assert.match(source, /onClick=\{\(\) => setDeleteIntent\(null\)\}/, "destructive confirmation retains cancel");
    } else {
      assert.match(source, /ModalCloseButton|modalClose|helpClose|holeSummaryClose/, `${file} no expone cierre`);
    }
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

test("Home aprobada concentra manual y AI en un selector sin romper sus contratos reales", () => {
  const home = read("app/components/home-dashboard.tsx");
  assert.match(home, /data-home-version="approved-golf-home-v2"/);
  assert.match(home, /const playAction = activeRound \? onContinueRound : onPlayOptions \|\| \(\(\) => setRoundChoiceOpen\(true\)\)/);
  assert.match(home, /<ModalShell open=\{roundChoiceOpen\}/);
  assert.match(home, /CONFIGURAR MANUALMENTE/);
  assert.match(home, /ARMAR CON BACKYARD AI/);
  assert.match(home, /onOpenGroups/);
  assert.match(home, /onOpenHistory/);
  assert.match(home, /onOpenStats/);
  assert.doesNotMatch(home, /onOpenSettings/);
  assert.match(home, /onOpenNotifications/);
  assert.equal((home.match(/onAiRound/g) || []).length, 3, "prop, destructuring y una única acción AI dentro del selector esperadas");
  assert.doesNotMatch(home, /estadísticas vacías|primera ronda/i);
});

test("onboarding y editor de ronda conservan configuración avanzada de apuestas", () => {
  const onboarding = read("app/components/beta-onboarding-flow.tsx");
  const templateEditor = read("app/components/group-bet-template-editor.tsx");
  const round = read("app/page.tsx");
  assert.doesNotMatch(onboarding, /GroupBetTemplateEditor|Configura tu primer grupo/);
  for (const contract of ["Mantener decimales", "Fijo + Patada", "Presión · segunda vuelta", "3 hoyos", "18 hoyos", "Golpes de ventaja"]) {
    assert.match(templateEditor, new RegExp(contract.replace(/[+]/g, "\\+")));
  }
  assert.ok(templateEditor.includes("Jugador {String.fromCharCode(65 + index)} / Rival"));
  assert.match(templateEditor, /Los jugadores y parejas se eligen al iniciar/);
  assert.match(templateEditor, /assignmentMode="template"/);
  assert.doesNotMatch(templateEditor, /rivalPlayerId:\s*nextRival/);
  assert.doesNotMatch(templateEditor, /Ventaja desde índices|Ventaja firmada/);
  assert.match(round, /SupplementalBetsEditor/);
  assert.match(round, /Foursome/);
  assert.match(round, /Personales/);
});
