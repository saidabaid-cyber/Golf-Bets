import { socialBody } from '../../../../lib/social-http.server';
import { authenticatedRequest } from '../../../../lib/server-auth';
import { isCrossSiteRequest } from '../../../../lib/backyard-ai/server/http-security';
import type { NextRequest } from 'next/server';
import { ONBOARDING_CHECKPOINT_KEY, onboardingCheckpoint } from '../../../../lib/onboarding-checkpoint';

function sameCheckpoint(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function PUT(request: NextRequest) {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'private, no-store' } });
  if (isCrossSiteRequest(request)) return json({ error: 'Solicitud no permitida.' }, 403);
  if (new URL(request.url).search) return json({ error: 'Solicitud no válida.' }, 400);
  try {
    const ctx = await authenticatedRequest(request);
    if (!ctx.ok) return json({ error: ctx.error }, ctx.status);
    const body = await socialBody(request);
    const progress = onboardingCheckpoint(body, ctx.userId);
    if (!progress) return json({ error: 'Avance no válido.' }, 400);

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !publishableKey) return json({ error: 'No pudimos guardar el avance. Reintenta.' }, 503);

    // Auth derives the target user exclusively from this already-validated JWT.
    // `data` is a one-key metadata patch, so unrelated user metadata remains intact.
    const write = await fetch(new URL('/auth/v1/user', supabaseUrl), {
      method: 'PUT',
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${ctx.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { [ONBOARDING_CHECKPOINT_KEY]: progress } }),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!write.ok) throw new Error('onboarding_checkpoint_write_failed');

    const { data, error } = await ctx.client.auth.getUser(ctx.token);
    const saved = onboardingCheckpoint(data.user?.user_metadata?.[ONBOARDING_CHECKPOINT_KEY], ctx.userId);
    if (error || !saved || !sameCheckpoint(saved, progress)) throw new Error('onboarding_checkpoint_readback_failed');
    return json({ progress: saved });
  } catch { return json({ error: 'No pudimos guardar el avance. Reintenta.' }, 503); }
}
