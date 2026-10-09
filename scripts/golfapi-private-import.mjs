import { createHash } from 'node:crypto';
import { documentedRequest, GOLFAPI_STAGE_ID } from '../lib/golfapi/controlled-store.mjs';

// Offline preparation only: no transport, Supabase client or credentials.
const hash = value => createHash('sha256').update(value).digest('hex');
const reviewed = new Map([
  ['01213326512553886', ['course-la-vista', 'club-la-vista', 18]],
  ['0121254756996467', ['course-campestre-puebla', 'club-campestre-puebla', 18]],
  ['0121235348037759', ['review-course-24458', 'review-club-75f6ac3a0e37a69eabd3', 9]],
  ['0121165709980130', ['course-el-cristo', 'club-el-cristo', 18]],
]);
export function validatePrivateImport(plan) {
  if (plan?.schemaVersion !== 1 || plan.stageId !== GOLFAPI_STAGE_ID || plan.actualRemoteWrites !== 0 || !Array.isArray(plan.operations)) throw Error('IMPORT_PLAN_INVALID');
  const responses = [], snapshots = [], keys = new Set(), ids = new Set(); let snapshotsStarted = false;
  for (const operation of plan.operations) {
    if (operation.rpc === 'save_golfapi_response_v1' && !snapshotsStarted) {
      const envelope = operation.arguments?.p_envelope;
      if (envelope?.schemaVersion !== 1 || envelope.provider !== 'GOLFAPI' || envelope.httpStatus !== 200 || typeof envelope.bodyText !== 'string'
        || hash(envelope.bodyText) !== envelope.bodySha256 || documentedRequest(envelope.endpoint, envelope.parameters).requestKey !== envelope.requestKey || keys.has(envelope.requestKey)) throw Error('IMPORT_RESPONSE_INTEGRITY');
      JSON.parse(envelope.bodyText);
      keys.add(envelope.requestKey); responses.push(envelope);
    } else if (operation.rpc === 'save_golfapi_snapshot_v1') {
      snapshotsStarted = true;
      const snapshot = operation.arguments?.p_snapshot, version = operation.arguments?.p_source_version;
      const mapping = reviewed.get(snapshot?.externalCourseId);
      const original = structuredClone(snapshot); if (original?.source) delete original.source.sourceVersion;
      if (snapshot?.schemaVersion !== 1 || snapshot.provider !== 'GOLFAPI' || !mapping || ids.has(snapshot.externalCourseId)
        || snapshot.mapping?.courseId !== mapping[0] || snapshot.mapping?.clubId !== mapping[1]
        || snapshot.physicalHoles?.length !== mapping[2] || snapshot.positions?.length !== 18
        || snapshot.source?.sourceVersion !== version || hash(JSON.stringify(original)) !== version
        || !responses.some(r => r.requestKey === snapshot.source.coordinatesRequestKey && r.endpoint === `coordinates/${snapshot.externalCourseId}`)) throw Error('IMPORT_SNAPSHOT_INTEGRITY');
      const numbers = new Set();
      for (const p of snapshot.positions) {
        if (!Number.isInteger(p.number) || p.number < 1 || p.number > 18 || numbers.has(p.number)) throw Error('IMPORT_CARD_POSITION_INVALID');
        numbers.add(p.number);
        if (!snapshot.physicalHoles.some(h => h.id === p.physicalHoleId && h.cardPositions.includes(p.number)) || p.lap !== Math.floor((p.number - 1) / mapping[2]) + 1) throw Error('IMPORT_PHYSICAL_MAPPING_INVALID');
        for (const point of [...Object.values(p.green), ...p.points].filter(Boolean)) {
          const c = point.coordinate;
          if (point.position !== p.number || !Array.isArray(c) || c.length !== 2 || !c.every(Number.isFinite) || c[0] < -180 || c[0] > 180 || c[1] < -90 || c[1] > 90 || point.isFlag !== false) throw Error('IMPORT_COORDINATE_INVALID');
        }
      }
      ids.add(snapshot.externalCourseId); snapshots.push({ snapshot, version });
    } else throw Error('IMPORT_OPERATION_NOT_ALLOWED');
  }
  if (responses.length !== 10 || snapshots.length !== 4) throw Error('IMPORT_EXPECTED_SAVED_STAGE');
  return { responses, snapshots };
}

/** Whole batch in one transaction; verify conflicts BEFORE any insert. The
 * caller supplies a local DB double. Remote application remains a separate
 * controlled handoff and is deliberately absent from this module. */
export async function importIntoLocalDatabase(db, plan) {
  const { responses, snapshots } = validatePrivateImport(plan);
  return db.transaction(async tx => {
    const receipt = { schemaVersion: 1, stageId: GOLFAPI_STAGE_ID, insertedResponses: [], insertedSnapshots: [], reusedResponses: 0, reusedSnapshots: 0 };
    for (const envelope of responses) {
      const previous = (await tx.query('select envelope from private.golfapi_saved_responses where request_key=$1', [envelope.requestKey])).rows[0];
      if (previous && canonical(previous.envelope) !== canonical(envelope)) throw Error('IMPORT_EXISTING_RESPONSE_CONFLICT');
      if (previous) receipt.reusedResponses++; else receipt.insertedResponses.push({ key: envelope.requestKey, bodySha256: envelope.bodySha256 });
    }
    for (const { snapshot, version } of snapshots) {
      const previous = (await tx.query('select snapshot from private.golfapi_source_versions where external_course_id=$1 and source_version=$2', [snapshot.externalCourseId, version])).rows[0];
      if (previous && canonical(previous.snapshot) !== canonical(snapshot)) throw Error('IMPORT_EXISTING_SNAPSHOT_CONFLICT');
      if (previous) receipt.reusedSnapshots++; else receipt.insertedSnapshots.push({ id: snapshot.externalCourseId, version });
    }
    for (const envelope of responses) await tx.query('select public.save_golfapi_response_v1($1::jsonb)', [JSON.stringify(envelope)]);
    for (const { snapshot, version } of snapshots) await tx.query('select public.save_golfapi_snapshot_v1($1::jsonb,$2)', [JSON.stringify(snapshot), version]);
    return receipt;
  });
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export function preparedPreflightSql(plan) {
  const { responses, snapshots } = validatePrivateImport(plan);
  return ['-- READ ONLY, after verified DEV binding and pending cache schema. Save result PRIVATELY.',
    `select jsonb_build_object('schemaVersion',1,'stageId',${literal(GOLFAPI_STAGE_ID)},'responses',coalesce((select jsonb_agg(envelope) from private.golfapi_saved_responses where request_key in (${responses.map(r => literal(r.requestKey)).join(',')})),'[]'::jsonb),'snapshots',coalesce((select jsonb_agg(jsonb_build_object('snapshot',snapshot,'version',source_version)) from private.golfapi_source_versions where (external_course_id,source_version) in (${snapshots.map(r => '(' + literal(r.snapshot.externalCourseId) + ',' + literal(r.version) + ')').join(',')})),'[]'::jsonb)) as private_preimport_backup;`, ''].join('\n');
}
/** Build the DEV receipt ONLY from a fresh private baseline, never from the
 * synthetic/local verification receipt. Reject unexpected or conflicting rows. */
export function receiptFromPreflight(baseline, plan) {
  const { responses, snapshots } = validatePrivateImport(plan);
  if (baseline?.schemaVersion !== 1 || baseline.stageId !== GOLFAPI_STAGE_ID || !Array.isArray(baseline.responses) || !Array.isArray(baseline.snapshots)) throw Error('IMPORT_BASELINE_INVALID');
  for (const r of baseline.responses) if (!responses.some(expected => canonical(expected) === canonical(r))) throw Error('IMPORT_BASELINE_RESPONSE_CONFLICT');
  for (const s of baseline.snapshots) if (!snapshots.some(expected => expected.version === s.version && canonical(expected.snapshot) === canonical(s.snapshot))) throw Error('IMPORT_BASELINE_SNAPSHOT_CONFLICT');
  return { schemaVersion: 1, stageId: GOLFAPI_STAGE_ID,
    insertedResponses: responses.filter(r => !baseline.responses.some(old => old.requestKey === r.requestKey)).map(r => ({ key: r.requestKey, bodySha256: r.bodySha256 })),
    insertedSnapshots: snapshots.filter(s => !baseline.snapshots.some(old => old.version === s.version && old.snapshot.externalCourseId === s.snapshot.externalCourseId)).map(s => ({ id: s.snapshot.externalCourseId, version: s.version })),
    reusedResponses: baseline.responses.length, reusedSnapshots: baseline.snapshots.length };
}
export function preparedImportSql(plan) {
  const { responses, snapshots } = validatePrivateImport(plan);
  return ['-- PRIVATE saved provider data. Never commit/upload to public assets.', '-- PENDING_CONTROLLED_DB_APPLY: verify DEV binding, backup, schema and receipt first.', 'begin;',
    ...responses.map(r => `select public.save_golfapi_response_v1(${literal(JSON.stringify(r))}::jsonb);`),
    ...snapshots.map(r => `select public.save_golfapi_snapshot_v1(${literal(JSON.stringify(r.snapshot))}::jsonb,${literal(r.version)});`), 'commit;', ''].join('\n');
}
/** Privileged operator only. EXACT new keys from the pre-import receipt; no
 * tables/RPCs/catalog/history deleted, no pre-existing snapshots touched. */
export function preparedRollbackSql(receipt, plan) {
  const { responses, snapshots } = validatePrivateImport(plan);
  if (receipt?.schemaVersion !== 1 || receipt.stageId !== GOLFAPI_STAGE_ID || !Array.isArray(receipt.insertedResponses) || !Array.isArray(receipt.insertedSnapshots)) throw Error('IMPORT_RECEIPT_INVALID');
  const statements = [];
  for (const row of receipt.insertedSnapshots) {
    const original = snapshots.find(s => s.snapshot.externalCourseId === row.id && s.version === row.version);
    if (!original) throw Error('ROLLBACK_OUTSIDE_BATCH');
    statements.push(`delete from private.golfapi_source_versions where external_course_id=${literal(row.id)} and source_version=${literal(row.version)} and snapshot=${literal(JSON.stringify(original.snapshot))}::jsonb;`);
  }
  for (const row of receipt.insertedResponses) {
    if (!responses.some(r => r.requestKey === row.key && r.bodySha256 === row.bodySha256)) throw Error('ROLLBACK_OUTSIDE_BATCH');
    // Preserve a raw response if ANY surviving snapshot still depends on it.
    statements.push(`delete from private.golfapi_saved_responses r where request_key=${literal(row.key)} and stage_id=${literal(GOLFAPI_STAGE_ID)} and envelope->>'bodySha256'=${literal(row.bodySha256)} and not exists(select 1 from private.golfapi_source_versions s where s.snapshot::text like '%' || r.request_key || '%');`);
  }
  return ['-- PENDING_CONTROLLED_DB_APPLY: review receipt against PRE-import backup first.', '-- Disable GPS flags first. Retain private backup/receipts. No Course Master rollback.', 'begin;', ...statements, 'commit;', ''].join('\n');
}
