import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { distinctNearbyClubCards } from "../lib/course-nearby-clubs";
import { DEFAULT_LA_VISTA_COURSE, DEFAULT_LA_VISTA_TEMPORAL_COURSE } from "../lib/golf-course-directory";
import { reviewedCoursePublicationShape } from "../lib/puebla-course-publication";
import {
  nearestReviewedClubs,
  reviewedTeeToCourse,
  searchReviewedCourses,
  type ReviewedCatalogCourse,
  type ReviewedTeeSource,
} from "../lib/review-course-catalog";
import { curatedPueblaCourseProvider } from "../lib/curated-puebla-course-data";
import { preferredTeeForCourse } from "../lib/round-course-selection";

const source = JSON.parse(readFileSync("data/qa/course-audit-source.json", "utf8")) as {
  clubs: Array<{ id: string; name: string; latitude: number | null; longitude: number | null; locationEvidence: { sourceUrl: string; verifiedAt: string } | null }>;
  courses: Array<{ id: string; clubId: string; name: string; sourceUrl: string; dataVersion: string }>;
  tees: Array<{ id: string; courseId: string; name: string; holeCount: number; ratingCategory: null; qaStatus: string; qaErrors: string[]; hasRating: boolean; hasSlope: boolean }>;
};
const gaps = JSON.parse(readFileSync("data/qa/course-gaps.json", "utf8")) as { summary: Record<string, number> };

const pueblaIdentity = [
  { id: "course-la-vista", clubId: "club-la-vista", name: "LA VISTA COUNTRY CLUB", clubName: "LA VISTA COUNTRY CLUB", city: "San Andrés Cholula", aliases: ["La Vista", "Vista Country Club"], latitude: 19.008297, longitude: -98.254634 },
  { id: "course-campestre-puebla", clubId: "club-campestre-puebla", name: "PUEBLA", clubName: "CLUB CAMPESTRE DE PUEBLA", city: "Puebla", aliases: ["Campestre Puebla", "Club de Golf Campestre de Puebla"], latitude: 19.0131, longitude: -98.2345 },
  { id: "review-course-23231", clubId: "review-club-9c0700f229794a278011", name: "CLUB DE GOLF LA HUERTA", clubName: "CLUB DE GOLF LA HUERTA", city: "San Pedro Cholula", aliases: ["La Huerta", "Huerta"], latitude: 19.05946, longitude: -98.3307 },
  { id: "course-el-cristo", clubId: "club-el-cristo", name: "CLUB CAMPESTRE EL CRISTO", clubName: "CLUB CAMPESTRE EL CRISTO", city: "Atlixco", aliases: ["El Cristo"], latitude: 18.882, longitude: -98.426 },
  { id: "review-course-24458", clubId: "review-club-75f6ac3a0e37a69eabd3", name: "LAS FUENTES", clubName: "CLUB DE GOLF LAS FUENTES", city: "Puebla", aliases: ["Las Fuentes"], latitude: 19.08806, longitude: -98.23316 },
  { id: "course-cola-de-lagarto", clubId: "club-cola-de-lagarto", name: "COLA DE LAGARTO", clubName: "COLA DE LAGARTO CAMPO MÍTICO", city: "Atlixco", aliases: ["Cola de Lagarto"] },
  { id: "review-course-23167", clubId: "review-club-d146fe8e70001cc350c2", name: "VISTA VERDE", clubName: "VISTA VERDE COUNTRY CLUB", city: "Tehuacán", aliases: ["Vista Verde Country Club"], latitude: 18.487452, longitude: -97.403514 },
].map((row) => ({
  ...row,
  stateRegion: "Puebla",
  holes: 18 as const,
  sourceUrl: "https://example.invalid/source",
  observedAt: "2026-09-24",
  dataVersion: "p02-audit",
  locationEvidence: row.latitude === undefined ? undefined : { sourceUrl: "https://example.invalid/location", verifiedAt: "2026-09-24" },
}));

function holes(count: 9 | 18) {
  return Array.from({ length: count }, (_, index) => ({ hole_number: index + 1, par: index % 3 === 0 ? 3 : 4, stroke_index: index + 1, yards: 150 + index }));
}

function tee(id: string, count: 9 | 18): ReviewedTeeSource {
  return { id, name: "Blancas", course_rating: null, slope_rating: null, yards: null, par: null, rating_category: null, qa_status: "PASS", source_limitation: null, holes: holes(count), nineRatings: [], qa: { status: "PASS", errors: [] } };
}

test("P02 identity snapshot keeps one stable identity per audited Puebla club", () => {
  assert.equal(gaps.summary.clubs, 153);
  assert.equal(gaps.summary.courses, 176);
  assert.equal(gaps.summary.tees, 769);
  assert.equal(gaps.summary.complete, 758);
  assert.equal(gaps.summary.incomplete, 11);
  const targetIds = new Set(pueblaIdentity.map((row) => row.clubId));
  assert.equal(targetIds.size, 7);
  for (const identity of pueblaIdentity) {
    assert.equal(source.clubs.filter((club) => club.id === identity.clubId).length, 1);
    assert.equal(source.courses.filter((course) => course.id === identity.id && course.clubId === identity.clubId).length, 1);
  }
});

for (const [query, expectedClubId] of [
  ["La Vista", "club-la-vista"], ["Vista", "club-la-vista"],
  ["Campestre Puebla", "club-campestre-puebla"], ["Campestre de Puebla", "club-campestre-puebla"],
  ["La Huerta", "review-club-9c0700f229794a278011"], ["Huerta", "review-club-9c0700f229794a278011"],
  ["El Cristo", "club-el-cristo"], ["Las Fuentes", "review-club-75f6ac3a0e37a69eabd3"],
] as const) {
  test(`P02 search is accent/case/alias tolerant: ${query}`, () => {
    const matches = searchReviewedCourses(pueblaIdentity, query);
    assert.ok(matches.some((row) => row.clubId === expectedClubId));
    assert.equal(new Set(matches.map((row) => row.clubId)).size, matches.length);
  });
}

test("P02 Puebla nearby is distance ordered and never spends slots on layouts of one club", () => {
  const withDuplicateLayout = [pueblaIdentity[0], { ...pueblaIdentity[0], id: "la-vista-second-layout", name: "La Vista II" }, ...pueblaIdentity.slice(1)];
  const result = nearestReviewedClubs(withDuplicateLayout, { latitude: 19.008297, longitude: -98.254634 });
  assert.deepEqual(result.map((row) => row.clubId), ["club-la-vista", "club-campestre-puebla", "review-club-75f6ac3a0e37a69eabd3"]);
  assert.ok(result[0].distanceKm <= result[1].distanceKm && result[1].distanceKm <= result[2].distanceKm);

  const routeShape = distinctNearbyClubCards(withDuplicateLayout.map((row) => ({ card: { id: row.id, courseId: row.id, clubId: row.clubId }, distanceKm: result.find((item) => item.clubId === row.clubId)?.distanceKm ?? null })));
  assert.equal(routeShape.total, 3);
  assert.equal(new Set(routeShape.matches.map((item) => item.card.clubId)).size, 3);
});

test("P02 source-confirmed nine-hole layout blocks the conflicting captured 18-hole card", () => {
  const captured: ReviewedCatalogCourse = { ...pueblaIdentity[2], holes: 18, tees: [tee("la-huerta-round-layout", 18)] };
  const publication = reviewedCoursePublicationShape(captured);
  assert.equal(publication.holes, 9);
  assert.equal(publication.capturedLayoutConflict, true);
  assert.deepEqual(publication.tees, []);
  assert.match(publication.sourceUrl, /lahuertagolfhotel\.com\/club/);
});

test("P02 ordinary 18-hole layouts remain intact and unknown facts remain unknown", () => {
  const captured: ReviewedCatalogCourse = { ...pueblaIdentity[0], holes: 18, tees: [tee("la-vista-white", 18)] };
  const publication = reviewedCoursePublicationShape(captured);
  assert.equal(publication.holes, 18);
  assert.equal(publication.tees.length, 1);
  const card = reviewedTeeToCourse(captured, captured.tees[0]);
  assert.equal(card.rating, undefined);
  assert.equal(card.slope, undefined);
  assert.equal(card.totalYards, undefined);
  assert.equal(card.holes.length, 18);
});

test("P02 El Cristo keeps blue/white evidence and blocks conflicting Doradas/Rojas promotion", () => {
  assert.deepEqual(curatedPueblaCourseProvider.listPlayableSelections().map((card) => card.catalogTeeId), ["tee-el-cristo-blancas", "tee-el-cristo-azules"]);
  for (const id of ["tee-el-cristo-doradas", "tee-el-cristo-rojas"]) {
    const lookup = curatedPueblaCourseProvider.getTeeById(id);
    assert.equal(lookup?.eligibleForLocalIndex, false);
    assert.ok(lookup?.issues.includes("SOURCE_TOTAL_CONFLICT"));
    assert.equal(curatedPueblaCourseProvider.getPlayableSelectionByTeeId(id), null);
  }
});

test("P02 La Vista normal and temporary cards stay separate and snapshots stay frozen", () => {
  assert.equal(DEFAULT_LA_VISTA_COURSE.holes.reduce((sum, hole) => sum + hole.par, 0), 72);
  assert.equal(DEFAULT_LA_VISTA_TEMPORAL_COURSE.holes.reduce((sum, hole) => sum + hole.par, 0), 69);
  assert.notEqual(DEFAULT_LA_VISTA_COURSE.id, DEFAULT_LA_VISTA_TEMPORAL_COURSE.id);
  const historical = structuredClone({ courseSnapshot: DEFAULT_LA_VISTA_COURSE });
  const currentCatalog = structuredClone(DEFAULT_LA_VISTA_COURSE);
  currentCatalog.holes[0].par = 6;
  currentCatalog.holes[0].yards = 999;
  assert.notEqual(historical.courseSnapshot.holes[0].par, currentCatalog.holes[0].par);
  assert.notEqual(historical.courseSnapshot.holes[0].yards, currentCatalog.holes[0].yards);
});

test("P02 preferred tee is scoped by stable course and tee ids", () => {
  const vistaWhite = { ...DEFAULT_LA_VISTA_COURSE, catalogTeeId: "vista-white", catalogCourseId: "vista" };
  const otherWhite = { ...DEFAULT_LA_VISTA_COURSE, id: "other-white", catalogTeeId: "other-white", catalogCourseId: "other", name: "Otro campo" };
  assert.equal(preferredTeeForCourse([otherWhite, vistaWhite], { homeCourseId: "vista", preferredTee: "Blancas" })?.catalogTeeId, "vista-white");
  assert.equal(preferredTeeForCourse([otherWhite], { homeCourseId: "vista", preferredTee: "Blancas" }), undefined);
  assert.equal(preferredTeeForCourse([vistaWhite], { homeCourseId: "vista", preferredTee: "Azules", preferredTeeId: "vista-white" })?.catalogTeeId, "vista-white");
});
