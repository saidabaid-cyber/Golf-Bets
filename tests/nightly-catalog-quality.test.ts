import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildCourseAudit, buildEquipmentAudit, type CourseAuditSource, type EquipmentInput } from "../scripts/catalog-quality";
import { golfBallCatalog, golfClubCatalog, golfShaftCatalog } from "../lib/golf-equipment-catalog";

const catalog: EquipmentInput = { clubs: golfClubCatalog, balls: golfBallCatalog, shafts: golfShaftCatalog };
const source = JSON.parse(readFileSync("data/qa/course-audit-source.json", "utf8")) as CourseAuditSource;

test("nightly audit artifacts reproduce from canonical runtime catalogs and captured QA metadata", () => {
  const result = spawnSync(process.execPath, ["scripts/qa-catalog-data.mjs", "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).dbWrites, 0);
});

test("nightly equipment inventory partitions every runtime ID including historical references", () => {
  const audit = buildEquipmentAudit(catalog);
  for (const kind of Object.keys(catalog) as (keyof EquipmentInput)[]) {
    assert.equal(audit.summary[kind].total, catalog[kind].length);
    assert.equal(audit.summary[kind].active + audit.summary[kind].historical, catalog[kind].length);
    assert.equal(audit.summary[kind].fitEligible, catalog[kind].filter(row => row.fitEligible).length);
    assert.equal(audit.summary[kind].bagEligible, catalog[kind].filter(row => row.bagEligible).length);
    const ids = new Set(catalog[kind].map(row => row.id));
    assert.ok(audit.records.filter(row => row.kind === kind).every(row => ids.has(row.id)));
  }
});

test("nightly audits are deterministic across ordering, do not mutate their sources and reject duplicates", () => {
  const before = JSON.stringify(catalog);
  const audit = buildEquipmentAudit(catalog);
  assert.deepEqual(buildEquipmentAudit({ clubs: [...catalog.clubs].reverse(), balls: [...catalog.balls].reverse(), shafts: [...catalog.shafts].reverse() }), audit);
  assert.equal(JSON.stringify(catalog), before);
  assert.throws(() => buildEquipmentAudit({ ...catalog, clubs: [...catalog.clubs, catalog.clubs[0]] }), /DUPLICATE_ID/);
  const courseBefore = JSON.stringify(source);
  assert.deepEqual(buildCourseAudit({ ...source, clubs: [...source.clubs].reverse(), courses: [...source.courses].reverse(), tees: [...source.tees].reverse() }), buildCourseAudit(source));
  assert.equal(JSON.stringify(source), courseBefore);
});

test("a catalog data license cannot establish image rights", () => {
  const item = { ...catalog.clubs[0], id: "synthetic-image-rights", imageUrl: "https://example.invalid/photo.jpg", imageSourceUrl: null, imageLicense: null, license: "Data licensed" };
  const audit = buildEquipmentAudit({ clubs: [item], balls: [], shafts: [] });
  assert.ok(audit.records[0].gaps.includes("IMAGE_LICENSE_UNVERIFIED"));
  assert.equal(audit.summary.clubs.withoutLicensedImage, 1);
});

test("dated catalog identity without technical facts remains unknown rather than verified specs", () => {
  const item = { ...catalog.clubs[0], id: "synthetic-unknown-specs", lofts: [], variants: [], standardLength: null, lie: null, headVolume: null, setMakeup: null, stockShafts: [], stockFlexes: [] };
  const audit = buildEquipmentAudit({ clubs: [item], balls: [], shafts: [] });
  assert.equal(audit.records[0].datedCatalogProvenance, true);
  assert.ok(audit.records[0].gaps.includes("SPECS_UNKNOWN"));
  const withUnverifiedFact = buildEquipmentAudit({ clubs: [{ ...item, standardLength: 45, provenance: [] }], balls: [], shafts: [] });
  assert.ok(withUnverifiedFact.records[0].gaps.includes("SPECS_UNVERIFIED"));
  assert.ok(!withUnverifiedFact.records[0].gaps.includes("SPECS_UNKNOWN"));
});

test("shaft scalar weight and legacy flex are not falsely counted as absent", () => {
  const shaft = { ...catalog.shafts[0], id: "synthetic-legacy-shaft", weight: 60, weightOptions: [], flexOptions: [], flex: ["STIFF" as const] };
  const audit = buildEquipmentAudit({ clubs: [], balls: [], shafts: [shaft] });
  assert.equal(audit.summary.shafts.shaftsWithoutWeight, 0);
  assert.equal(audit.summary.shafts.shaftsWithoutFlex, 0);
  const absent = buildEquipmentAudit({ clubs: [], balls: [], shafts: [{ ...shaft, weight: null, flex: [] }] });
  assert.equal(absent.summary.shafts.shaftsWithoutWeight, 1);
  assert.equal(absent.summary.shafts.shaftsWithoutFlex, 1);
});

test("wedge absence is distinct from source-unverified loft values; neither is filled", () => {
  const wedge = { ...catalog.clubs[0], id: "synthetic-wedge", category: "WEDGE" as const, lofts: [], variants: [] };
  assert.ok(buildEquipmentAudit({ clubs: [wedge], balls: [], shafts: [] }).records[0].gaps.includes("WEDGE_LOFTS_UNKNOWN"));
  assert.ok(buildEquipmentAudit({ clubs: [{ ...wedge, lofts: [54], provenance: [] }], balls: [], shafts: [] }).records[0].gaps.includes("WEDGE_LOFTS_UNVERIFIED"));
  assert.deepEqual(wedge.lofts, []);
});

test("course source cannot point to another project/provider, duplicate IDs or orphan records", () => {
  assert.throws(() => buildCourseAudit({ ...source, projectRef: "production" }), /NOT_QA_OWNER_CATALOG/);
  assert.throws(() => buildCourseAudit({ ...source, provider: "LEGACY_SEED" }), /NOT_QA_OWNER_CATALOG/);
  assert.throws(() => buildCourseAudit({ ...source, tees: [...source.tees, source.tees[0]] }), /DUPLICATE_ID/);
  assert.throws(() => buildCourseAudit({ ...source, courses: [] }), /ORPHAN_CATALOG_REFERENCE/);
  assert.throws(() => buildCourseAudit({ ...source, tees: [{ ...source.tees[0], holeCount: -1 }] }), /INVALID_HOLE_COUNT/);
  assert.throws(() => buildCourseAudit({ ...source, tees: [{ ...source.tees[0], ratingCategory: "UNKNOWN" }] }), /CATEGORY_CONTRACT_REVIEW/);
});

test("course completeness is derived from holes, not a PASS string", () => {
  const tee = { ...source.tees[0], qaStatus: "PASS", holeCount: 17 };
  const audit = buildCourseAudit({ ...source, tees: [tee] });
  assert.equal(audit.summary.complete, 0);
  assert.equal(audit.incompleteCards[0].holeCount, 17);
  assert.equal(audit.summary.complete + audit.summary.incomplete, audit.summary.tees);
});

test("coordinates without site evidence and municipal centroids do not establish geolocation", () => {
  const clubs = source.clubs.map(club => ({ ...club, latitude: 19, longitude: -99, locationEvidence: null }));
  assert.equal(buildCourseAudit({ ...source, clubs }).summary.geolocated, 0);
  const centroids = clubs.map(club => ({ ...club, locationEvidence: { sourceUrl: "https://example.invalid", verifiedAt: "2026-09-22", pointKind: "municipal_centroid" } }));
  assert.equal(buildCourseAudit({ ...source, clubs: centroids }).summary.geolocated, 0);
});

test("supplemental category evidence never silently enables runtime rating/slope", () => {
  const tee = { ...source.tees[0], hasRating: true, hasSlope: true, ratingCategory: null, supplementRatingCategory: "CABALLEROS" };
  const audit = buildCourseAudit({ ...source, tees: [tee] });
  assert.equal(audit.summary.ratingsWithoutEnabledCategory, 1);
  assert.equal(audit.summary.supplementalCategoryEvidenceNotEnabled, 1);
  assert.equal(tee.ratingCategory, null);
});
