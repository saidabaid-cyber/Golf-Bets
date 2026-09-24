import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const sourcePath = path.join(root, "data/qa/course-audit-source.json");
const pendingPath = path.join(root, "data/course-locations-pending.json");
const evidencePath = path.join(root, "data/qa/mexico-course-location-evidence.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
const evidence = JSON.parse(readFileSync(evidencePath, "utf8"));
if (evidence.projectRef !== "bymeopxkxapfizeeqeyb" || evidence.provider !== "OWNER_CATALOG_REVIEW") throw new Error("REF_OR_PROVIDER_MISMATCH");

const locationEvidence = (record) => ({
  club: record.clubName,
  latitude: record.latitude,
  longitude: record.longitude,
  authority: record.sourceAuthority,
  sourceUrl: record.sourceUrl,
  ...(record.coordinateEvidenceUrl ? { coordinateEvidenceUrl: record.coordinateEvidenceUrl } : {}),
  verifiedAt: evidence.verifiedAt,
  pointKind: record.pointKind,
  confidence: record.confidence,
  operationalStatus: record.operationalStatus,
  evidenceVersion: evidence.version,
});
const records = evidence.verifiedLocations.map((record) => ({
  club_id: record.clubId,
  club_name: record.clubName,
  latitude: record.latitude,
  longitude: record.longitude,
  location_evidence: locationEvidence(record),
}));
const jsonSql = `$p03$${JSON.stringify(records)}$p03$::jsonb`;
const cte = `with evidence as (
  select * from jsonb_to_recordset(${jsonSql}) as e(
    club_id text, club_name text, latitude double precision, longitude double precision, location_evidence jsonb
  )
)`;

if (process.argv.includes("--sql-dry-run")) {
  console.log(`${cte}
select
  ${records.length}::int as expected_targets,
  count(*) as joined_targets,
  count(*) filter (where g.name = e.club_name and g.provider = 'OWNER_CATALOG_REVIEW' and g.active) as identity_matches,
  count(*) filter (where g.latitude is null and g.longitude is null and g.catalog_metadata->'locationEvidence' is null) as clean_new_locations,
  count(*) filter (where g.latitude is distinct from e.latitude or g.longitude is distinct from e.longitude or g.catalog_metadata->'locationEvidence' is distinct from e.location_evidence) as rows_that_would_change,
  coalesce(jsonb_agg(jsonb_build_object(
    'clubId',e.club_id,'clubName',e.club_name,
    'currentLatitude',g.latitude,'currentLongitude',g.longitude,
    'newLatitude',e.latitude,'newLongitude',e.longitude,
    'sourceUrl',e.location_evidence->>'sourceUrl',
    'status',case when g.id is null then 'MISSING_ID' when g.name <> e.club_name or g.provider <> 'OWNER_CATALOG_REVIEW' or not g.active then 'IDENTITY_MISMATCH' when g.latitude is null and g.longitude is null and g.catalog_metadata->'locationEvidence' is null then 'NEW' when g.latitude is not distinct from e.latitude and g.longitude is not distinct from e.longitude and g.catalog_metadata->'locationEvidence' is not distinct from e.location_evidence then 'NO_CHANGE' else 'CONFLICT' end
  ) order by e.club_name),'[]'::jsonb) as exact_diff
from evidence e left join public.golf_clubs g on g.id=e.club_id;`);
  process.exit(0);
}

if (process.argv.includes("--sql-apply")) {
  console.log(`begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $guard$
declare matched integer; conflict_ids text;
begin
  ${cte}
  select count(*) into matched from evidence e join public.golf_clubs g on g.id=e.club_id and g.name=e.club_name and g.provider='OWNER_CATALOG_REVIEW' and g.active;
  if matched <> ${records.length} then raise exception 'P03_IDENTITY_GUARD_FAILED:%', matched; end if;
  ${cte}
  select string_agg(g.id, ',') into conflict_ids
  from evidence e join public.golf_clubs g on g.id=e.club_id
  where (g.latitude is not null or g.longitude is not null or g.catalog_metadata->'locationEvidence' is not null)
    and (g.latitude is distinct from e.latitude or g.longitude is distinct from e.longitude or g.catalog_metadata->'locationEvidence' is distinct from e.location_evidence);
  if conflict_ids is not null then raise exception 'P03_LOCATION_CONFLICT:%', conflict_ids; end if;
end $guard$;
${cte}, updated as (
  update public.golf_clubs g
  set latitude=e.latitude,
      longitude=e.longitude,
      catalog_metadata=jsonb_set(coalesce(g.catalog_metadata,'{}'::jsonb),'{locationEvidence}',e.location_evidence,true)
  from evidence e
  where g.id=e.club_id and g.provider='OWNER_CATALOG_REVIEW' and g.active
    and (g.latitude is distinct from e.latitude or g.longitude is distinct from e.longitude or g.catalog_metadata->'locationEvidence' is distinct from e.location_evidence)
  returning g.id
)
select count(*) as updated_rows, coalesce(jsonb_agg(id order by id),'[]'::jsonb) as updated_ids from updated;
commit;`);
  process.exit(0);
}

if (process.argv.includes("--sql-verify")) {
  console.log(`${cte}
select
  (select count(*) from public.golf_clubs where provider='OWNER_CATALOG_REVIEW' and active) as clubs,
  (select count(*) from public.golf_clubs where provider='OWNER_CATALOG_REVIEW' and active and latitude is not null and longitude is not null and catalog_metadata->'locationEvidence' is not null) as geolocated,
  (select count(*) from public.golf_courses where provider='OWNER_CATALOG_REVIEW' and active) as courses,
  (select count(*) from public.golf_course_tees where provider='OWNER_CATALOG_REVIEW' and active) as tees,
  (select count(*) from public.golf_holes where provider='OWNER_CATALOG_REVIEW') as holes,
  (select count(*) from public.golf_tee_hole_yardages where provider='OWNER_CATALOG_REVIEW') as tee_hole_yardages,
  (select md5(string_agg(id||'|'||name||'|'||active::text||'|'||provider, E'\n' order by id)) from public.golf_clubs where provider='OWNER_CATALOG_REVIEW') as club_identity_hash,
  (select md5(string_agg(id||'|'||club_id||'|'||name||'|'||holes::text||'|'||active::text, E'\n' order by id)) from public.golf_courses where provider='OWNER_CATALOG_REVIEW') as course_hash,
  (select md5(string_agg(id||'|'||course_id||'|'||name||'|'||coalesce(rating::text,'')||'|'||coalesce(slope::text,'')||'|'||active::text, E'\n' order by id)) from public.golf_course_tees where provider='OWNER_CATALOG_REVIEW') as tee_hash,
  (select md5(string_agg(id||'|'||course_id||'|'||hole_number::text||'|'||par::text||'|'||stroke_index::text, E'\n' order by id)) from public.golf_holes where provider='OWNER_CATALOG_REVIEW') as hole_hash,
  (select count(*) from evidence e join public.golf_clubs g on g.id=e.club_id where g.latitude is not distinct from e.latitude and g.longitude is not distinct from e.longitude and g.catalog_metadata->'locationEvidence' is not distinct from e.location_evidence) as exact_p03_readback,
  (select count(*) from public.golf_clubs where provider='OWNER_CATALOG_REVIEW' and active and (latitude is null or longitude is null or catalog_metadata->'locationEvidence' is null)) as pending_locations;`);
  process.exit(0);
}

if (process.argv.includes("--write-rollback")) {
  const byId = new Map(source.clubs.map((club) => [club.id, club]));
  const before = records.map((record) => {
    const club = byId.get(record.club_id);
    if (!club || club.name !== record.club_name) throw new Error(`ROLLBACK_IDENTITY_MISMATCH:${record.club_id}`);
    if (club.latitude !== null || club.longitude !== null || club.locationEvidence !== null) throw new Error(`ROLLBACK_SOURCE_NOT_EMPTY:${record.club_id}`);
    return { clubId: club.id, clubName: club.name, latitude: club.latitude, longitude: club.longitude, locationEvidence: club.locationEvidence };
  });
  const artifact = { projectRef: evidence.projectRef, createdAt: new Date().toISOString(), baseSnapshot: source.queryId, evidenceVersion: evidence.version, recovery: "Restore only latitude, longitude and catalog_metadata.locationEvidence for these stable club IDs after verifying no later authorized geo revision exists.", rows: before };
  artifact.sha256 = createHash("sha256").update(JSON.stringify(artifact.rows)).digest("hex");
  const directory = path.join(root, ".qa-artifacts");
  mkdirSync(directory, { recursive: true });
  const file = path.join(directory, "p03-course-geo-before-apply.private.json");
  writeFileSync(file, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(JSON.stringify({ file, rows: before.length, sha256: artifact.sha256 }));
  process.exit(0);
}

if (process.argv.includes("--merge-snapshot")) {
  const byId = new Map(records.map((record) => [record.club_id, record]));
  const merged = {
    ...source,
    observedAt: evidence.verifiedAt,
    clubs: source.clubs.map((club) => {
      const record = byId.get(club.id);
      if (!record) return club;
      if (club.latitude !== null || club.longitude !== null || club.locationEvidence !== null) throw new Error(`SOURCE_LOCATION_CONFLICT:${club.id}`);
      return { ...club, latitude: record.latitude, longitude: record.longitude, locationEvidence: record.location_evidence };
    }),
  };
  writeFileSync(sourcePath, `${JSON.stringify(merged, null, 2)}\n`);
  writeFileSync(pendingPath, `${JSON.stringify({ status: "PENDING_LOCATION", asOf: evidence.verifiedAt, scope: `${evidence.pendingLocations.length} clubes sin punto operativo verificable; ${merged.clubs.filter((club) => club.locationEvidence).length} ubicaciones documentadas para QA. No se usan centroides municipales.`, clubs: evidence.pendingLocations.map((row) => ({ club: row.clubName, status: row.status, reason: row.reason, sourceUrl: row.sourceUrl })) }, null, 2)}\n`);
  console.log(JSON.stringify({ clubs: merged.clubs.length, geolocated: merged.clubs.filter((club) => club.locationEvidence).length, pending: evidence.pendingLocations.length, courses: merged.courses.length, tees: merged.tees.length }));
  process.exit(0);
}

throw new Error("Usage: node scripts/qa-p03-course-geo.mjs --sql-dry-run|--sql-apply|--sql-verify|--write-rollback|--merge-snapshot");
