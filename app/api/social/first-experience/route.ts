import type { NextRequest } from "next/server";
import { authenticatedRequest } from "../../../../lib/server-auth";
import { socialBody } from "../../../../lib/social-http.server";
import { isCrossSiteRequest } from "../../../../lib/backyard-ai/server/http-security";
import { isolatedPreviewDatabaseEnabled } from "../../../../lib/preview-database";
import { onboardingCheckpoint, ONBOARDING_CHECKPOINT_KEY } from "../../../../lib/onboarding-checkpoint";
import { FIRST_EXPERIENCE_METADATA_KEY, FIRST_EXPERIENCE_VALUES, firstExperienceState, resolveFirstExperience, type FirstExperienceField } from "../../../../lib/round-first-experience";

export const dynamic = "force-dynamic";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "private, no-store" } });
async function context(request: NextRequest) {
  if (isCrossSiteRequest(request) || new URL(request.url).search) return json({ error: "Solicitud no permitida." }, 403);
  if (!isolatedPreviewDatabaseEnabled()) return json({ error: "Experiencia no disponible." }, 503);
  const account = await authenticatedRequest(request);
  if (!account.ok) return json({ error: account.error }, account.status);
  const progress = onboardingCheckpoint(account.userMetadata?.[ONBOARDING_CHECKPOINT_KEY], account.userId);
  const [profile, friends, groups, sharedGroups, rounds] = await Promise.all([
    account.client.from("profiles").select("onboarding_completed_at").eq("id", account.userId).maybeSingle(),
    account.client.from("friendships").select("id").or(`user_a_id.eq.${account.userId},user_b_id.eq.${account.userId}`).limit(1),
    account.client.from("frequent_groups_cloud").select("snapshot").eq("owner_id", account.userId).limit(50),
    account.client.from("groups_v2").select("default_template").eq("owner_id", account.userId).limit(50),
    account.client.from("rounds_cloud").select("snapshot").eq("owner_id", account.userId).limit(100),
  ]);
  if (profile.error || friends.error || groups.error || sharedGroups.error || rounds.error) throw new Error("FIRST_EXPERIENCE_READ_FAILED");
  const eligible = progress ? progress.status === "complete" : Boolean(profile.data?.onboarding_completed_at);
  const hasFriends = Boolean(friends.data?.length);
  const validGroup = (snapshot: { players?: unknown; name?: string } | null) => Array.isArray(snapshot?.players) && snapshot.players.length > 0 && Boolean(snapshot.name?.trim());
  const hasGroup = (groups.data || []).some(row => validGroup(row.snapshot)) || (sharedGroups.data || []).some(row => validGroup(row.default_template));
  const hasRound = (rounds.data || []).some(row => row.snapshot?.lifecycleState === "completed" || Boolean(row.snapshot?.completedAt));
  let state = firstExperienceState(account.userMetadata?.[FIRST_EXPERIENCE_METADATA_KEY]);
  const now = new Date().toISOString();
  if (hasFriends && state.friendDiscovery === "pending") state = resolveFirstExperience(state, "friendDiscovery", "already_has_friends", now);
  if (hasGroup && state.firstGroup === "pending") state = resolveFirstExperience(state, "firstGroup", "already_has_group", now);
  if ((hasGroup || hasRound) && state.firstRoundGroup === "pending") state = resolveFirstExperience(state, "firstRoundGroup", "not_needed", now);
  return { account, eligible, hasGroup, state };
}

async function persist(ctx: Exclude<Awaited<ReturnType<typeof context>>, Response>, state: ReturnType<typeof firstExperienceState>) {
  const origin = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("FIRST_EXPERIENCE_NOT_CONFIGURED");
  // Verified session selects the account. A one-key patch preserves all other metadata.
  const write = await fetch(new URL("/auth/v1/user", origin), { method: "PUT", headers: { apikey: key, Authorization: `Bearer ${ctx.account.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ data: { [FIRST_EXPERIENCE_METADATA_KEY]: state } }), cache: "no-store", signal: AbortSignal.timeout(8_000) });
  if (!write.ok) throw new Error("FIRST_EXPERIENCE_WRITE_FAILED");
  const read = await ctx.account.client.auth.getUser(ctx.account.token);
  if (read.error || read.data.user?.id !== ctx.account.userId || JSON.stringify(firstExperienceState(read.data.user.user_metadata?.[FIRST_EXPERIENCE_METADATA_KEY])) !== JSON.stringify(state)) throw new Error("FIRST_EXPERIENCE_READBACK_FAILED");
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await context(request);
    if (ctx instanceof Response) return ctx;
    // Persist automatic resolutions too; fresh sessions use the same account state.
    if (ctx.eligible && JSON.stringify(ctx.state) !== JSON.stringify(firstExperienceState(ctx.account.userMetadata?.[FIRST_EXPERIENCE_METADATA_KEY]))) await persist(ctx, ctx.state);
    return json({ eligible: ctx.eligible, hasGroup: ctx.hasGroup, state: ctx.state });
  } catch { return json({ error: "No pudimos verificar esta experiencia. Reintenta." }, 503); }
}
export async function PUT(request: NextRequest) {
  try {
    const ctx = await context(request);
    if (ctx instanceof Response) return ctx;
    if (!ctx.eligible) return json({ error: "Termina tu registro antes de continuar." }, 409);
    const body = await socialBody(request);
    if (Object.keys(body).some(key => !["field", "value"].includes(key)) || typeof body.field !== "string" || !Object.hasOwn(FIRST_EXPERIENCE_VALUES, body.field) || typeof body.value !== "string") return json({ error: "Decisión no válida." }, 400);
    const field = body.field as FirstExperienceField;
    if (!(FIRST_EXPERIENCE_VALUES[field] as readonly string[]).includes(body.value) || body.value === "pending") return json({ error: "Decisión no válida." }, 400);
    if (body.value === "created" && !ctx.hasGroup) return json({ error: "Guarda el grupo antes de continuar." }, 409);
    const state = resolveFirstExperience(ctx.state, field, body.value, new Date().toISOString());
    await persist(ctx, state);
    return json({ eligible: true, hasGroup: ctx.hasGroup, state });
  } catch { return json({ error: "No pudimos guardar tu decisión. Reintenta." }, 503); }
}
