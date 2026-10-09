import { NextRequest, NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { requireAdminMode } from '../../../../lib/admin-mode.server';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { isCrossSiteRequest } from '../../../../lib/backyard-ai/server/http-security';
import { pilotHostEnabled } from '../../../../lib/gps-pilot-la-vista-1/pilot.mjs';
import { isGpsPilotTester } from '../../../../lib/gps-pilot-la-vista-1/access';
import { devGolfApiSnapshotStore } from '../../../../lib/golfapi/source.server';
import { GPS_SAVED_COURSES, gpsCourseProjection } from '../../../../lib/golf-gps/projection';

export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'cache-control': 'private, no-store', 'x-robots-tag': 'noindex' } });

export async function GET(request: NextRequest) {
  if (!pilotHostEnabled({ enabled: process.env.GOLF_GPS_ENABLED, branch: process.env.VERCEL_GIT_COMMIT_REF, deploymentEnvironment: process.env.VERCEL_ENV, host: request.headers.get('host') })) return json({ error: 'GPS no disponible.' }, 404);
  if (isCrossSiteRequest(request)) return json({ error: 'Solicitud no permitida.' }, 403);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error, code: account.code }, account.status);
  // Same least-privilege real account entitlement as the existing pilot.
  if (!isGpsPilotTester(account.userId, process.env.GPS_LA_VISTA_1_PILOT_USER_IDS)) {
    const access = await requireAdminMode(request, 'courses');
    if (!access.ok) return json({ error: access.error, code: access.code }, access.status);
  }
  try {
    const database = getSupabaseAdmin(); if (!database) return json({ error: 'Almacenamiento privado no disponible.' }, 503);
    const store = devGolfApiSnapshotStore(database);
    const rows = await Promise.allSettled(GPS_SAVED_COURSES.map(async row => gpsCourseProjection(await store.readNormalized(row.externalId))));
    const courses = rows.flatMap(row => row.status === 'fulfilled' ? [row.value] : []);
    if (!courses.length) return json({ error: 'La importación privada de datos está pendiente.', code: 'PENDING_CONTROLLED_DB_APPLY' }, 503);
    return json({ schemaVersion: 1, courses, unavailable: rows.flatMap((row, index) => row.status === 'rejected' ? [GPS_SAVED_COURSES[index].id] : []), mapsEnabled: process.env.GOLF_GPS_MAPS_ENABLED === 'true' });
  } catch { return json({ error: 'No pudimos leer los datos guardados.', code: 'PENDING_CONTROLLED_DB_APPLY' }, 503); }
}
