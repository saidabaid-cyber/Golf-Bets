import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createInternalEquipmentCatalogProvider } from "../lib/equipment-catalog-provider";
import {
  canonicalBallIdentity,
  canonicalClubIdentity,
  dedupeGolfClubCatalog,
  golfBallCatalog,
  golfCatalogDiagnostics,
  golfClubCatalog,
  golfShaftCatalog,
} from "../lib/golf-equipment-catalog";
import { isProfileEmojiAvatar, normalizeProfileEmojiAvatar } from "../lib/profile-avatar";

const provider = createInternalEquipmentCatalogProvider({ balls: golfBallCatalog, clubs: golfClubCatalog, shafts: golfShaftCatalog });

test("master 2010–2026 is merged, sourced and available to Bag without inflating Ball Fit", async () => {
  assert.equal(golfCatalogDiagnostics.clubs.masterSourceModels, 1_202);
  assert.equal(golfCatalogDiagnostics.balls.masterSourceModels, 285);
  assert.ok(golfClubCatalog.length >= 1_200);
  assert.ok(golfBallCatalog.length >= 285);
  assert.ok(golfClubCatalog.every((club) => club.bagEligible && club.provenance.length > 0));
  assert.ok(golfBallCatalog.every((ball) => ball.bagEligible && ball.provenance.length > 0));
  const fitScope = await provider.loadBallFitCatalog({ maximumCandidates: 2_000 });
  assert.equal(fitScope.complete, true);
  assert.ok(fitScope.items.every((ball) => !ball.active || ball.fitEligible));
  assert.ok(golfBallCatalog.some((ball) => ball.bagEligible && !ball.fitEligible));
});

test("club identity preserves plus variants and model generations", () => {
  const groups = [
    ["TSR2", "TSR2+"], ["Bio Cell", "Bio Cell+"], ["F6", "F6+"], ["0811 X", "0811 X+"],
  ];
  for (const [plain, plus] of groups) {
    const first = golfClubCatalog.find((club) => club.model.toLocaleLowerCase().includes(plain.toLocaleLowerCase()) && !club.model.includes("+"));
    const second = golfClubCatalog.find((club) => club.model.toLocaleLowerCase().includes(plus.toLocaleLowerCase()));
    assert.ok(first, `${plain} missing`);
    assert.ok(second, `${plus} missing`);
    assert.notEqual(canonicalClubIdentity(first!), canonicalClubIdentity(second!));
  }
  assert.equal(new Set(golfClubCatalog.map(canonicalClubIdentity)).size, golfClubCatalog.length);
  assert.notEqual(
    canonicalBallIdentity(golfBallCatalog.find((ball) => ball.brand === "Titleist" && ball.model === "Pro V1" && ball.year === 2017)!),
    canonicalBallIdentity(golfBallCatalog.find((ball) => ball.brand === "Titleist" && ball.model === "Pro V1" && ball.year === 2025)!),
  );
});

test("field merge preserves stronger existing evidence and retains every provenance source", () => {
  const base = golfClubCatalog.find((club) => club.brand === "Titleist" && club.model.includes("TSR2") && !club.model.includes("+"));
  assert.ok(base);
  const internal = { ...base!, id: "internal-tsr2", lofts: [8], sourceName: null, sourceType: null };
  const fallback = {
    ...base!,
    id: "master-tsr2",
    lofts: [9],
    sourceName: "secondary archive",
    sourceType: "SECONDARY_ARCHIVE",
    provenance: [...base!.provenance, {
      sourceName: "secondary archive",
      sourceType: "SECONDARY_ARCHIVE",
      sourceUrl: "https://example.invalid/archive",
      verifiedAt: "2026-09-10T00:00:00.000Z",
      importedAt: "2026-09-10T00:00:00.000Z",
      license: null,
      confidence: null,
      externalId: "master-tsr2",
    }],
  };
  const merged = dedupeGolfClubCatalog([fallback, internal]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].lofts, [8]);
  assert.ok(merged[0].provenance.some((source) => source.sourceName === "secondary archive"));
});

test("brand aliases collapse without changing model identity", () => {
  assert.equal(golfClubCatalog.some((club) => club.brand === "COBRA" || club.brand === "LAB Golf"), false);
  assert.ok(golfClubCatalog.some((club) => club.brand === "Cobra"));
  assert.ok(golfClubCatalog.some((club) => club.brand === "L.A.B. Golf"));
});

test("historical equipment is searchable through bounded paginated provider", async () => {
  for (const query of ["910D3", "910 D3", "Vapor Fly", "G425", "Stealth 2 Plus", "SM7", "Black Ops", "Qi10", "Qi4D", "GTS2"]) {
    const page = await provider.search({ kind: "CLUB", query, includeArchived: true, limit: 5 });
    assert.ok(page.items.length > 0, `${query} should be searchable`);
    assert.ok(page.items.length <= 5);
  }
  for (const query of ["Pro V1 2015", "Pro V1 2025", "TP5 2024", "TP5 2026", "Chrome Soft 2024", "Chrome Soft 2026"]) {
    const page = await provider.search({ kind: "BALL", query, includeArchived: true, limit: 5 });
    assert.ok(page.items.length > 0, `${query} should be searchable`);
  }
  const first = await provider.search({ kind: "CLUB", query: "Titleist", includeArchived: true, limit: 3 });
  assert.equal(first.items.length, 3);
  assert.equal(first.hasMore, true);
  const second = await provider.search({ kind: "CLUB", query: "Titleist", includeArchived: true, limit: 3, cursor: first.nextCursor });
  assert.equal(second.items.some((item) => first.items.some((prior) => prior.id === item.id)), false);
});

test("profile accepts one native Unicode emoji grapheme and keeps legacy avatar paths valid", () => {
  for (const emoji of ["🦅", "🏌️‍♀️", "👍🏽", "🇲🇽", "1️⃣"]) assert.equal(normalizeProfileEmojiAvatar(emoji), emoji);
  assert.equal(isProfileEmojiAvatar("texto"), false);
  assert.equal(isProfileEmojiAvatar("🦅🐟"), false);
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.match(picker, /Foto<\/button>/);
  assert.match(picker, /Emoji<\/button>/);
  assert.match(picker, /Crear avatar<\/button>/);
  assert.match(picker, /\/avatars\/golfer-green\.svg/);
});

test("club search, onboarding, capture and modal safety expose the hard-closeout contracts", () => {
  const picker = readFileSync("app/components/profile-club-picker.tsx", "utf8");
  const courseRoute = readFileSync("app/api/courses/search/route.ts", "utf8");
  const onboarding = readFileSync("app/components/beta-onboarding-flow.tsx", "utf8");
  const capture = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const controls = readFileSync("app/components/bet-fields/capture-controls.tsx", "utf8");
  const equipmentPanel = readFileSync("app/components/equipment-profile-panel.tsx", "utf8");
  const modalShell = readFileSync("app/components/modal-shell.tsx", "utf8");
  assert.match(picker, /setTimeout/);
  assert.match(picker, /scope=clubs/);
  assert.doesNotMatch(picker, /INTERNAL_GOLF_COURSE_CATALOG|internalCourseCatalogProvider/);
  assert.match(courseRoute, /searchClubs\(query, limit, cursor\)/);
  assert.match(onboarding, /aria-pressed=\{entryMode === "quick"\}/);
  assert.match(onboarding, /aria-pressed=\{entryMode === "complete"\}/);
  assert.equal((onboarding.match(/CONFIGURACIÓN RÁPIDA/g) || []).length, 0);
  assert.equal((onboarding.match(/CONFIGURACIÓN COMPLETA/g) || []).length, 0);
  assert.doesNotMatch(capture, />PAR<\/button>/);
  assert.match(capture, /value=\{scores\[owner\.id\]\} fallback=\{hole\.par\}/);
  assert.match(controls, /data-pending=\{!confirmed\}/);
  assert.match(controls, /onClick=\{\(\) => onChange\(current\)\}/);
  assert.match(equipmentPanel, /ModalCloseButton onClose=\{\(\) => setFitOpen\(false\)\}/);
  assert.match(modalShell, /aria-label=\{label\}/);
  assert.match(modalShell, /event\.key !== "Escape"/);
});

test("GHIN is an explicit disabled external provider foundation", () => {
  const flags = readFileSync("features/feature-flags/registry.ts", "utf8");
  const placeholder = readFileSync("app/components/ghin-placeholder.tsx", "utf8");
  assert.match(flags, /ghin_integration/);
  assert.match(placeholder, /VINCULAR GHIN/);
  assert.match(placeholder, /PRÓXIMAMENTE/);
  assert.match(placeholder, /sin scraping/);
  assert.match(placeholder, /ModalShell/);
});
