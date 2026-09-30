import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const viewer = readFileSync("app/components/internal-pdf-viewer.tsx", "utf8");
const groups = readFileSync("app/components/group-builder.tsx", "utf8");
const socialFeed = readFileSync("app/components/social-feed.tsx", "utf8");
const socialQr = readFileSync("app/components/social-qr.tsx", "utf8");
const membership = readFileSync("app/membership/page.tsx", "utf8");
const competitionRules = readFileSync("app/competitions/[competitionId]/competition-rules.tsx", "utf8");
const equipmentOnboarding = readFileSync("app/components/equipment-onboarding.tsx", "utf8");

test("long PDF and group surfaces repeat their top destination at the bottom", () => {
  assert.match(viewer, /onClick=\{onBack\}>\u2190 Regresar a Reglas<\/button>/);
  assert.match(viewer, /<BottomBackAction label="\u2190 Regresar a Reglas" onBack=\{onBack\} \/>/);
  assert.match(groups, /onClick=\{onBack\}>\u2190 Inicio<\/button>/);
  assert.match(groups, /<BottomBackAction label="\u2190 Inicio" onBack=\{onBack\} \/>/);
});

test("group save dialog shares one close handler", () => {
  assert.match(groups, /function closeSaveAll\(\) \{[\s\S]*setSaveAllOpen\(false\);[\s\S]*setSaveAllNames\(\[\]\);[\s\S]*\}/);
  assert.match(groups, /<ModalCloseButton onClose=\{closeSaveAll\} \/>/);
  assert.match(groups, /onClick=\{closeSaveAll\}>Cancelar<\/button>/);
});

test("secondary social-feed views share their top and bottom activity handler", () => {
  assert.match(socialFeed, /function backToActivity\(\) \{ open\("activity"\); \}/);
  assert.match(socialFeed, /view !== "activity" && view !== "qr" && view !== "scan" && <button[^>]*onClick=\{backToActivity\}>\u2190 Feed de amigos<\/button>/);
  assert.match(socialFeed, /view !== "activity" && view !== "qr" && view !== "scan" && <BottomBackAction label="\u2190 Feed de amigos" onBack=\{backToActivity\} \/>/);
});

test("personal QR uses the same close callback for top and bottom actions", () => {
  const personal = socialQr.slice(socialQr.indexOf("export function PersonalQr"), socialQr.indexOf("export function SocialQrScanner"));

  assert.match(personal, /onClick=\{onClose\}>\u2190 Social<\/button>/);
  assert.match(personal, /<BottomBackAction label="\u2190 Social" onBack=\{onClose\} \/>/);
});

test("QR scanner shares its stop-and-close handler between top and bottom actions", () => {
  const scanner = socialQr.slice(socialQr.indexOf("export function SocialQrScanner"));

  assert.match(scanner, /function close\(\)\{stop\(\);onClose\(\);\}/);
  assert.match(scanner, /onClick=\{close\}>\u2190 \{backLabel\}<\/button>/);
  assert.match(scanner, /<BottomBackAction label=\{`\u2190 \$\{backLabel\}`\} onBack=\{close\} \/>/);
  assert.doesNotMatch(scanner, /onClick=\{\(\)=>\{stop\(\);onClose\(\);\}\}/);
});

test("standalone long membership and competition pages repeat their return destination", () => {
  assert.equal((membership.match(/href="\/\?view=account"/g) || []).length, 2);
  assert.match(membership, /membershipBottomBack/);
  assert.equal((competitionRules.match(/<Link href="\/">← The Backyard<\/Link>/g) || []).length, 2);
  assert.match(competitionRules, /styles\.bottomBack/);
});

test("equipment onboarding repeats its top exits after long content", () => {
  assert.match(equipmentOnboarding, /className="textButton" onClick=\{onSaveAndExit\}>Guardar y continuar después<\/button>/);
  assert.match(equipmentOnboarding, /<BottomBackAction label="Guardar y continuar después" onBack=\{onSaveAndExit\} \/>/);
  assert.match(equipmentOnboarding, /className=\{styles\.bagBack\} aria-label="Volver" onClick=\{previous\}/);
  assert.match(equipmentOnboarding, /<BottomBackAction label="← Volver" onBack=\{previous\} \/>/);
});
