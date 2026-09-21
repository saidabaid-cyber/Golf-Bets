import { socialBody } from '../../../../lib/social-http.server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { getSupabaseAdmin } from '../../../../lib/supabase/server';
import { isCrossSiteRequest } from '../../../../lib/backyard-ai/server/http-security';
import type { NextRequest } from 'next/server';
import { ONBOARDING_CHECKPOINT_KEY, onboardingCheckpoint } from '../../../../lib/onboarding-checkpoint';
export async function PUT(request: NextRequest) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  if (isCrossSiteRequest(request)) return json({ error: 'Solicitud no permitida.' }, 403);
  try {
    const ctx = await authenticatedRequest(request);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    const admin = getSupabaseAdmin();
    if (!admin) return json({ error: 'No pudimos guardar el avance. Reintenta.' }, 503);
    const body = await socialBody(request);
    const progress = onboardingCheckpoint(body, ctx.userId);
    if (!progress) return json({ error: 'Avance no válido.' }, 400);
    const { error } = await admin.auth.admin.updateUserById(ctx.userId, { user_metadata: { [ONBOARDING_CHECKPOINT_KEY]: progress } });
    if (error) throw error;
    return json({ progress });
  } catch { return json({ error: 'No pudimos guardar el avance. Reintenta.' }, 503); }
}
