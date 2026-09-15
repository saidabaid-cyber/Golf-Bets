import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
const editors = readFileSync("app/components/equipment-editors.tsx", "utf8");
const styles = readFileSync("app/components/equipment.module.css", "utf8");
const persistence = readFileSync("app/components/use-equipment-profile.ts", "utf8");

test("Mi Bolsa opens full-page club, ball and distance editors, not add/edit bottom sheets", () => {
  for (const screen of ["club-editor", "ball-editor", "distance-editor"]) {
    assert.match(panel, new RegExp(`data-equipment-screen="${screen}"`));
  }
  assert.equal((panel.match(/presentation="page"/g) || []).length, 3);
  assert.match(editors, /presentation === "page" \? styles\.editorPageShell : styles\.editorBackdrop/);
  assert.match(editors, /presentation === "sheet" \? "dialog" : undefined/);
  assert.match(editors, /useModalDialog\(presentation === "sheet", onCancel\)/);
  assert.match(styles, /\.editorPageShell \{[^}]*min-height: calc\(100dvh - 160px\)/);
  assert.match(styles, /\.editorPage,/);
});

test("category-to-form flow keeps distinct equipment inputs and a manual shaft fallback", () => {
  assert.match(editors, /step === "category"/);
  assert.match(editors, /chooseCategory\(value as ClubCategory\)/);
  assert.match(editors, /onSelectBall && <button type="button" onClick=\{onSelectBall\}><span>●<\/span><b>Bola<\/b>/);
  assert.match(panel, /onSelectBall=\{\(\) => \{ setClubEditor\(null\); setBallEditor\("new"\); \}\}/);
  assert.match(editors, /CLUB_CATEGORY_LABELS\[category\]\} · especificaciones/);
  assert.match(editors, /category === "IRON_SET"/);
  assert.match(editors, /category === "WEDGE"/);
  assert.match(editors, /category === "PUTTER"/);
  assert.match(editors, /Mi bastón no aparece/);
  assert.match(editors, /Mi varilla no aparece/);
  assert.match(editors, /customShaftBrand: savedShaftBrand \|\| null/);
  assert.match(editors, /customShaftModel: savedShaftModel \|\| null/);
  assert.match(editors, /Sin varilla \/ No sé/);
});

test("successful local save leads to add-another, bag and profile destinations; failed save stays editable", () => {
  assert.match(panel, /if \(saved\) \{\s*setClubEditor\(null\);\s*setFlowSuccess/);
  assert.match(panel, /if \(saved\) \{\s*setBallEditor\(null\);\s*setFlowSuccess/);
  assert.match(panel, /data-equipment-screen="success"/);
  assert.match(panel, /setFlowSuccess\(null\); setClubEditor\("new"\); \}\}>Agregar otro/);
  assert.match(panel, /Volver a Mi Bolsa/);
  assert.match(panel, /onBackToProfile && <button[^>]*onClick=\{onBackToProfile\}>Volver a Perfil/);
  assert.match(editors, /if \(saved === false\) setMessage\("No se confirmó el guardado en este dispositivo/);
  assert.match(persistence, /saveEquipmentProfile\(localStorage, normalized\)/);
  assert.match(persistence, /enqueueSync\(result\.profile, activeScopeRef\.current\)/);
  assert.match(panel, /className=\{styles\.itemTitleButton\} onClick=\{onEdit\}/);
});

test("club, ball and manual-distance removal require an in-app confirmation and preserve round snapshots", () => {
  assert.match(panel, /type EquipmentDeleteIntent/);
  assert.match(panel, /data-equipment-screen="delete-confirm"/);
  assert.match(panel, /removePlayerClub\(current, deleteIntent\.club\.id\)/);
  assert.match(panel, /removePlayerBall\(current, deleteIntent\.ball\.id\)/);
  assert.match(panel, /removePlayerClubDistance\(current, deleteIntent\.distance\.id\)/);
  assert.match(panel, /Las rondas históricas conservan sus propios snapshots y no cambian/);
  assert.match(panel, /onClick=\{confirmDelete\}>Eliminar de Mi Bolsa/);
  assert.doesNotMatch(panel, /window\.confirm\(`¿Eliminar \$\{clubName/);
});
