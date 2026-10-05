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
      assert.match(dialog, /<Dialog account titleId="delete-account-title" busy=\{props\.busy\} onClose=\{props\.onClose\}/);
      assert.match(dialog, /<ModalCloseButton onClose=\{onClose\} disabled=\{busy\}/);
      assert.match(dialog, /disabled=\{props\.busy\} onClick=\{props\.onClose\}>Cancelar<\/button>/);
    } else if (file.endsWith("/equipment-profile-panel.tsx")) {
      // Equipment is now full-page throughout: verify real exits instead of
      // requiring a modal close icon on a screen which no longer is a modal.
      assert.doesNotMatch(source, /role="dialog"|styles\.editorBackdrop/);
      assert.match(source, /data-equipment-screen="ball-fit"[^\n]*onCancel=\{\(\) => \{[^\n]*setFitOpen\(false\);[^\n]*\}\}/);
      assert.match(source, /function closeSavedFit\(\) \{\s*setSavedFitOpen\(false\);\s*\}/);
      assert.match(source, /data-equipment-screen="saved-ball-fit"[^\n]*onClick=\{closeSavedFit\}>← Volver a Mi Bolsa/);
      for (const editor of ["club", "ball", "distance"]) {
        if (editor === "club") assert.match(source, /onCancel=\{\(\) => \{ setClubEditor\(null\); setNewClubCategory\(null\); \}\}/);
        else assert.match(source, new RegExp(`onCancel=\\{\\(\\) => set${editor[0].toUpperCase() + editor.slice(1)}Editor\\(null\\)\\}`));
      }
      assert.match(source, /function cancelDeleteIntent\(\) \{\s*setDeleteIntent\(null\);\s*\}/);
      assert.match(source, /onClick=\{cancelDeleteIntent\}/, "destructive confirmation retains cancel");
    } else {
      assert.match(source, /ModalCloseButton|ModalShell|modalClose|helpClose|holeSummaryClose/, `${file} no expone cierre`);
    }
  }
  const globalStyles = read("app/globals.css");
  assert.match(globalStyles, /\.modalBackdrop button\.modalCloseButton\{[^}]*width:44px[^}]*height:44px/);
  assert.match(globalStyles, /\.modalBackdrop\{[^}]*safe-area-inset-top/);
});

test("los wizards reinician su propio scroll y conservan el contexto detrás", () => {
  const modalHook = read("app/components/use-modal-dialog.ts");
  const equipment = read("app/components/equipment-editors.tsx");
  const onboarding = read("app/components/beta-onboarding-flow.tsx");
  assert.match(modalHook, /dialogRef\.current\.scrollTop = 0/);
  assert.match(modalHook, /focus\(\{ preventScroll: true \}\)/);
  assert.match(modalHook, /priorFocus\.focus\(\{ preventScroll: true \}\)/);
  assert.equal((equipment.match(/useWizardStepNavigation\(dialogRef, step(?:, presentation === "sheet")?\)/g) || []).length, 2);
  assert.match(equipment, /useWizardStepNavigation\(dialogRef, step, presentation === "sheet"\)/);
  assert.match(equipment, /presentation === "embedded"\) dialogRef\.current\?\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(onboarding, /window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
  assert.match(onboarding, /titleRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
});

test("Inicio is the existing social feed and round creation remains in Play", () => {
  const home = read("app/components/home-dashboard.tsx");
  assert.match(home, /data-home-version="community-feed-v3"/);
  assert.match(home, /CloudSocialActivity/);
  assert.match(home, /onOpenFriends/);
  assert.match(home, /onOpenRounds/);
  assert.doesNotMatch(home, /onOpenStats|onOpenRules|onNewRound/);
  const play = read("app/components/play-hub.tsx");
  assert.match(play, /onNewRound/);
  assert.match(play, /onAiRound/);
  assert.match(play, /onContinueRound/);
});
test("onboarding y editor de ronda conservan configuración avanzada de apuestas", () => {
  const onboarding = read("app/components/beta-onboarding-flow.tsx");
  const templateEditor = read("app/components/group-bet-template-editor.tsx");
  const round = read("app/page.tsx");
  assert.doesNotMatch(onboarding, /GroupBetTemplateEditor|Configura tu primer grupo/);
  for (const contract of ["Mantener decimales", "Fijo + Patada", "Presión · segunda vuelta", "3 hoyos", "18 hoyos", "Golpes de ventaja"]) {
    assert.match(templateEditor, new RegExp(contract.replace(/[+]/g, "\\+")));
  }
  assert.match(templateEditor, /Principal<select[\s\S]*Rival<select/);
  assert.match(templateEditor, /memberAssignment/);
  assert.match(templateEditor, /Los jugadores y parejas se eligen al iniciar/);
  assert.match(templateEditor, /assignmentMode="template"/);
  assert.doesNotMatch(templateEditor, /rivalPlayerId:\s*nextRival/);
  assert.doesNotMatch(templateEditor, /Ventaja desde índices|Ventaja firmada/);
  assert.match(round, /SupplementalBetsEditor/);
  assert.match(round, /Foursome/);
  assert.match(round, /Personales/);
});
