import { devFixtureAccount, devFixtureEnvironment } from '../../../../lib/dev-fixture-access';
import { getSupabasePublic } from '../../../../lib/supabase/server';

const response = (body: unknown, status: number) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Pragma': 'no-cache' } });

/** DEV QA password form, never an impersonation/admin endpoint. No new users,
 * credentials or permissions; only Supabase-verified existing fixture sessions. */
export async function POST(request: Request) {
  if (!devFixtureEnvironment(process.env, request.headers.get('origin') || '', request.headers.get('host') || '')) return response({ error: 'No disponible.' }, 404);
  if (!request.headers.get('content-type')?.startsWith('application/json')) return response({ error: 'Solicitud inválida.' }, 400);
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 2048) return response({ error: 'Solicitud inválida.' }, 413);
  let body: { email?: unknown; password?: unknown };
  try { body = JSON.parse(text); } catch { return response({ error: 'Solicitud inválida.' }, 400); }
  if (!body || typeof body.email !== 'string' || typeof body.password !== 'string'
    || body.email.length > 254 || body.password.length < 8 || body.password.length > 200) return response({ error: 'Solicitud inválida.' }, 400);
  const client = getSupabasePublic();
  if (!client) return response({ error: 'Acceso QA no configurado.' }, 503);
  const { data, error } = await client.auth.signInWithPassword({ email: body.email.trim(), password: body.password });
  if (error || !data.session || !data.user) return response({ error: 'Credenciales QA no válidas.' }, 401);
  if (!devFixtureAccount(data.user)) {
    // Revoke only the newly created session, preserving other browser sessions.
    await client.auth.signOut({ scope: 'local' });
    return response({ error: 'Credenciales QA no válidas.' }, 403);
  }
  return response({ access_token: data.session.access_token, refresh_token: data.session.refresh_token }, 200);
}
