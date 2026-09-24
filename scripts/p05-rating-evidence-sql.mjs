import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const source = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "course-rating-authority-evidence.json"), "utf8"));
const mode = process.argv[2] ?? "dry-run";

if (!["dry-run", "apply", "readback", "rollback"].includes(mode)) {
  throw new Error("Expected dry-run, apply, readback, or rollback");
}

const version = String(source.evidenceVersion);
const observedAt = String(source.observedAt);
const escapedRecords = JSON.stringify(source.records.map((record) => ({
  ...record,
  evidenceId: `authority:${record.courseId}:${record.teeId}:${record.ratingCategory ?? "UNKNOWN"}:${record.evidenceStatus}:${version}`,
  observedAt,
  evidenceVersion: version,
  automaticUse: false,
}))).replaceAll("$p05$", "");

const desiredCtes = `
with nine as (
  select tee_id,
    max(rating) filter (where segment = 'FRONT') as front_rating,
    max(slope) filter (where segment = 'FRONT') as front_slope,
    max(par) filter (where segment = 'FRONT') as front_par,
    max(rating) filter (where segment = 'BACK') as back_rating,
    max(slope) filter (where segment = 'BACK') as back_slope,
    max(par) filter (where segment = 'BACK') as back_par
  from public.golf_tee_nine_ratings
  group by tee_id
),
authority_source as (
  select value as record
  from jsonb_array_elements($p05$${escapedRecords}$p05$::jsonb)
),
authority_by_tee as (
  select record->>'teeId' as tee_id,
    jsonb_agg(record order by record->>'evidenceId') as records
  from authority_source
  group by record->>'teeId'
),
desired as (
  select t.id as tee_id,
    jsonb_build_object(
      'schemaVersion', 1,
      'courseId', t.course_id,
      'teeId', t.id,
      'teeName', t.name,
      'records',
        jsonb_build_array(jsonb_build_object(
          'evidenceId', 'captured:' || t.course_id || ':' || t.id || ':UNKNOWN:${version}',
          'courseId', t.course_id,
          'teeId', t.id,
          'teeName', t.name,
          'ratingCategory', null,
          'courseRating', t.rating,
          'slopeRating', t.slope,
          'par', t.par,
          'totalYards', t.total_yards,
          'front', case when n.front_rating is null or n.front_slope is null or n.front_par is null then null else jsonb_build_object(
            'courseRating', n.front_rating,
            'slopeRating', n.front_slope,
            'par', n.front_par
          ) end,
          'back', case when n.back_rating is null or n.back_slope is null or n.back_par is null then null else jsonb_build_object(
            'courseRating', n.back_rating,
            'slopeRating', n.back_slope,
            'par', n.back_par
          ) end,
          'sourceAuthority', 'Historical GHIN capture (no live integration)',
          'sourceUrl', t.source_url,
          'observedAt', to_char(t.verified_at at time zone 'UTC', 'YYYY-MM-DD'),
          'evidenceStatus', 'CAPTURED_UNCLASSIFIED',
          'evidenceVersion', '${version}',
          'automaticUse', false
        )) || coalesce(a.records, '[]'::jsonb)
    ) as bundle
  from public.golf_course_tees t
  left join nine n on n.tee_id = t.id
  left join authority_by_tee a on a.tee_id = t.id
  where t.active = true
),
expanded as (
  select d.tee_id, d.bundle, record
  from desired d
  cross join lateral jsonb_array_elements(d.bundle->'records') record
)`;

const summarySql = `
select jsonb_build_object(
  'physicalTees', (select count(*) from desired),
  'evidenceRecords', (select count(*) from expanded),
  'categoryVerified', (select count(*) from expanded where nullif(record->>'ratingCategory', '') is not null),
  'categoryUnknown', (select count(*) from expanded where record->'ratingCategory' = 'null'::jsonb),
  'automaticallyApplicable', (select count(*) from expanded where coalesce((record->>'automaticUse')::boolean, false)),
  'byStatus', (select jsonb_object_agg(status, rows) from (
    select record->>'evidenceStatus' as status, count(*) as rows
    from expanded group by record->>'evidenceStatus' order by record->>'evidenceStatus'
  ) statuses),
  'unmatchedAuthorityRecords', (
    select count(*) from authority_source a
    where not exists (select 1 from public.golf_course_tees t where t.active = true and t.id = a.record->>'teeId' and t.course_id = a.record->>'courseId')
  ),
  'wouldChange', (
    select count(*) from desired d join public.golf_course_tees t on t.id = d.tee_id
    where t.catalog_metadata->'ratingEvidenceV1' is distinct from d.bundle
  )
) as p05_summary;`;

const readbackSql = `
with bundles as (
  select id as tee_id, course_id, catalog_metadata->'ratingEvidenceV1' as bundle
  from public.golf_course_tees where active = true
), expanded as (
  select b.tee_id, b.course_id, b.bundle, record
  from bundles b
  left join lateral jsonb_array_elements(coalesce(b.bundle->'records', '[]'::jsonb)) record on true
)
select jsonb_build_object(
  'activeTees', (select count(*) from bundles),
  'bundlesPresent', (select count(*) from bundles where bundle is not null),
  'bindingMismatches', (select count(*) from bundles where bundle is not null and (bundle->>'teeId' <> tee_id or bundle->>'courseId' <> course_id)),
  'evidenceRecords', (select count(record) from expanded),
  'categoryVerified', (select count(*) from expanded where nullif(record->>'ratingCategory', '') is not null),
  'categoryUnknown', (select count(*) from expanded where record->'ratingCategory' = 'null'::jsonb),
  'automaticallyApplicable', (select count(*) from expanded where coalesce((record->>'automaticUse')::boolean, false)),
  'byStatus', (select jsonb_object_agg(status, rows) from (
    select record->>'evidenceStatus' as status, count(*) as rows
    from expanded where record is not null group by record->>'evidenceStatus' order by record->>'evidenceStatus'
  ) statuses),
  'versionRows', (select count(*) from expanded where record->>'evidenceVersion' = '${version}')
) as p05_readback;`;

if (mode === "dry-run") {
  process.stdout.write(`${desiredCtes}\n${summarySql}`);
} else if (mode === "apply") {
  process.stdout.write(`begin;\nset local statement_timeout = '45s';\n${desiredCtes}, updated as (\n  update public.golf_course_tees t\n  set catalog_metadata = jsonb_set(coalesce(t.catalog_metadata, '{}'::jsonb), '{ratingEvidenceV1}', d.bundle, true)\n  from desired d\n  where t.id = d.tee_id\n    and t.catalog_metadata->'ratingEvidenceV1' is distinct from d.bundle\n  returning t.id\n)\nselect count(*) as updated_rows from updated;\ncommit;`);
} else if (mode === "readback") {
  process.stdout.write(readbackSql);
} else {
  process.stdout.write(`begin;\nset local statement_timeout = '45s';\nupdate public.golf_course_tees\nset catalog_metadata = catalog_metadata - 'ratingEvidenceV1'\nwhere active = true\n  and catalog_metadata->'ratingEvidenceV1' is not null\n  and not exists (\n    select 1 from jsonb_array_elements(catalog_metadata->'ratingEvidenceV1'->'records') r\n    where r->>'evidenceVersion' <> '${version}'\n  );\ncommit;`);
}
