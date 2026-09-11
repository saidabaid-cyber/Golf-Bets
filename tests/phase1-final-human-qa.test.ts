import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { captureClubLabels } from "../lib/bag-capture";
import { createGolfApiCourseCatalogProvider, internalCourseCatalogProvider, normalizeGolfApiCatalog } from "../lib/course-catalog-provider";
import { golfCatalogDiagnostics, golfClubCatalog } from "../lib/golf-equipment-catalog";
import type { PlayerClub } from "../lib/golf-equipment";
import { MEMBERSHIP_CAPABILITIES, membershipEntitlement, normalizeMembershipPlanId } from "../lib/membership-entitlements";
import { PROFILE_EMOJI_AVATARS, isProfileEmojiAvatar } from "../lib/profile-avatar";
import { reconcilePlayerTeeAssignments } from "../lib/player-tee-assignments";

test("emoji libre usa el teclado nativo, conserva presets existentes y no acepta una URL", () => {
  assert.ok(PROFILE_EMOJI_AVATARS.length >= 12);
  for (const emoji of PROFILE_EMOJI_AVATARS) assert.equal(isProfileEmojiAvatar(emoji), true);
  assert.equal(isProfileEmojiAvatar("https://example.test/avatar.png"), false);
  const picker = readFileSync("app/components/profile-image-picker.tsx", "utf8");
  assert.match(picker, />FOTO<\/button>/);
  assert.match(picker, />EMOJI<\/button>/);
  assert.doesNotMatch(picker, />Elegir avatar<\/button>/);
  assert.match(picker, /normalizeProfileEmojiAvatar/);
  assert.match(picker, /Emoji de avatar/);
  assert.match(picker, /teclado normal de tu teléfono/);
});

test("club del perfil consume CourseCatalogProvider y conserva captura manual", async () => {
  const found = await internalCourseCatalogProvider.searchClubs("La Vista", 10);
  assert.equal(found.ok, true);
  if (!found.ok) return;
  const club = found.data.clubs.find((candidate) => candidate.name === "La Vista Country Club");
  assert.ok(club);
  const courses = await internalCourseCatalogProvider.getCourses(club.id);
  assert.equal(courses.ok, true);
  if (courses.ok) assert.ok(courses.data.some((course) => course.name === "La Vista"));
  const picker = readFileSync("app/components/profile-club-picker.tsx", "utf8");
  assert.match(picker, /\/api\/courses\/search\?scope=clubs/);
  assert.match(picker, /window\.setTimeout/);
  assert.match(picker, /Nombre manual/);
});

test("adapter GolfAPI normaliza club, campo, tees, hoyos y falla cerrado sin key", async () => {
  const catalog = normalizeGolfApiCatalog([{
    id: "club-1", name: "Club Fixture", country: "MX", state: "Puebla", city: "Puebla", latitude: 19, longitude: -98,
    courses: [{
      id: "course-1", name: "Campo Uno", holes: 9,
      pars: [4, 4, 3, 5, 4, 3, 4, 4, 5], strokeIndexes: [1, 3, 7, 5, 9, 8, 2, 6, 4],
      tees: [{ id: "tee-1", name: "Blancas", rating: 35.4, slope: 121, yardages: [390, 380, 155, 510, 360, 145, 400, 370, 520] }],
    }],
  }], "2026-09-10T12:00:00.000Z");
  assert.equal(catalog.clubs[0].provider, "GOLFAPI");
  assert.equal(catalog.courses.length, 1);
  assert.equal(catalog.tees[0].rating, 35.4);
  assert.equal(catalog.holes.length, 9);
  assert.equal(catalog.teeHoleYardages.length, 9);

  let called = false;
  const unavailable = createGolfApiCourseCatalogProvider({ load: async () => { called = true; return []; } });
  const result = await unavailable.searchClubs("fixture");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "not_configured");
  assert.equal(called, false);
});

test("cambiar de campo descarta tees antiguos y conserva tees del mismo campo", () => {
  const player = { id: "said", name: "Said", handicap: 8 };
  const first = { id: "tee-a", name: "Campo A", teeName: "Azules", catalogCourseId: "layout-a", catalogTeeId: "tee-a", holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
  const second = { id: "tee-b", name: "Campo B", teeName: "Blancas", catalogCourseId: "layout-b", catalogTeeId: "tee-b", holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
  const saved = [{ playerId: "said", courseId: "layout-a", layoutId: "layout-a", teeId: "tee-a", teeName: "Azules", source: "catalog" as const, capturedAt: "2026-09-10T10:00:00.000Z" }];
  assert.equal(reconcilePlayerTeeAssignments(saved, [player], first, "later")[0].teeName, "Azules");
  const changed = reconcilePlayerTeeAssignments(saved, [player], second, "later");
  assert.equal(changed[0].teeId, "tee-b");
  assert.equal(changed[0].teeName, "Blancas");
});

test("snapshot forgiving.golf es útil, trazable, licenciado y se deduplica", () => {
  const snapshot = JSON.parse(readFileSync("data/forgiving-golf-equipment.snapshot.json", "utf8")) as { license: string; sourceUrl: string; importedAt: string; models: Array<{ externalId: string; sourceUrl: string; sourceCheckedAt: string; license: string }> };
  assert.equal(snapshot.license, "CC BY 4.0");
  assert.match(snapshot.sourceUrl, /^https:\/\/forgiving\.golf\//);
  assert.ok(Number.isFinite(Date.parse(snapshot.importedAt)));
  assert.ok(snapshot.models.length >= 60);
  assert.ok(snapshot.models.every((model) => model.externalId && model.sourceUrl.startsWith("https://") && model.sourceCheckedAt && model.license === "CC BY 4.0"));
  assert.equal(golfCatalogDiagnostics.clubs.importedModels, snapshot.models.length);
  const identities = golfClubCatalog.map((club) => `${club.category}:${club.brand.toLowerCase()}:${club.model.toLowerCase()}:${club.year ?? club.generation ?? "unknown"}`);
  assert.equal(new Set(identities).size, identities.length);
  assert.ok(golfClubCatalog.filter((club) => club.provenance.some((source) => source.sourceName.startsWith("forgiving.golf"))).length >= 50);
});

test("set de fierros libre alimenta la lista táctil y el snapshot histórico", () => {
  const base: PlayerClub = {
    id: "bag-1", userId: "said", category: "IRON_SET", catalogClubId: "tm-qi",
    customBrand: "TaylorMade", customModel: "Qi", generation: null, year: null, loft: null,
    handedness: "RH", shaftId: null, customShaftBrand: null, customShaftModel: null, customShaft: null,
    flex: null, shaftWeightGrams: null, lengthInches: null, lieDegrees: null, grip: null, notes: null,
    setComposition: ["5", "6", "7", "8", "9", "P", "48°", "52°", "56°"], isCurrent: true,
    startedUsingAt: null, stoppedUsingAt: null, createdAt: "2026-09-10T10:00:00.000Z", updatedAt: "2026-09-10T10:00:00.000Z",
  };
  const snapshot = captureClubLabels(base);
  assert.deepEqual(snapshot, ["5i", "6i", "7i", "8i", "9i", "P", "48°", "52°", "56°"]);
  const later = captureClubLabels({ ...base, setComposition: ["7", "8", "9", "P"] });
  assert.notDeepEqual(later, snapshot);
  assert.deepEqual(snapshot, ["5i", "6i", "7i", "8i", "9i", "P", "48°", "52°", "56°"]);
  const editor = readFileSync("app/components/equipment-editors.tsx", "utf8");
  assert.match(editor, /CUSTOM_IRON_COMPOSITION/);
  assert.match(editor, /Personalizar set/);
});

test("BETA_PRO explícito habilita Beta y una asignación ausente falla cerrado a FREE", () => {
  assert.equal(normalizeMembershipPlanId(undefined), "FREE");
  assert.equal(normalizeMembershipPlanId("tampered-plan"), "FREE");
  assert.equal(normalizeMembershipPlanId("BETA_PRO"), "BETA_PRO");
  for (const capability of MEMBERSHIP_CAPABILITIES) assert.equal(membershipEntitlement("BETA_PRO", capability), "AVAILABLE");
  assert.match(readFileSync("docs/MEMBERSHIP_PHASE2.md", "utf8"), /no activa pagos, límites, paywalls ni precios/i);
});

test("scorecard ordena Tarjeta completa antes de Captura y usa situaciones naturales sin duplicar animales", () => {
  const capture = readFileSync("app/components/round-capture-v2.tsx", "utf8");
  const globalCss = readFileSync("app/globals.css", "utf8");
  assert.ok(capture.indexOf("props.fullCardVisible") < capture.indexOf("styles.captureCard"));
  assert.match(capture, /<SituationCounter label="Green Side Bunker"/);
  assert.match(capture, /<SituationCounter label="Fairway Bunker"/);
  assert.match(capture, /Penalty \/ Hazard/);
  assert.match(capture, /<SituationCounter label="OB"/);
  assert.doesNotMatch(capture, /Resultado de la bola/);
  assert.doesNotMatch(capture, /label="Camello"|label="Víbora"|label="Pez"/);
  assert.match(globalCss, /\.fullScorecard\{[^}]*min-width:0[^}]*max-width:100%[^}]*overflow:hidden/);
  assert.match(globalCss, /\.scorecardTable\{[^}]*width:100%[^}]*max-width:100%[^}]*overflow:auto/);
});
