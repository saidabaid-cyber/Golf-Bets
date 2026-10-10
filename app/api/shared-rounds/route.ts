import { socialBody, socialHttp, socialId } from "../../../lib/social-http.server";
import { liveRowResponse, saveSharedLive, sharedLiveRow } from "../../../lib/shared-round-live.server";
import type { SharedScorePatch } from "../../../lib/shared-round-live";

export async function GET(request: Request) {
  return socialHttp(request, async ctx => {
    const id = new URL(request.url).searchParams.get("roundId");
    if (id) return { data: liveRowResponse(await sharedLiveRow(ctx, socialId(id)), ctx.userId) };
    const result = await ctx.client.from("rounds_cloud").select("id,owner_id,version,snapshot").order("updated_at", { ascending: false }).limit(75);
    if (result.error) throw result.error;
    return { rounds: (result.data || []).filter(row => row.snapshot?.scorekeeping?.version === 1 && row.snapshot?.lifecycleState === "live" && (row.snapshot.scorekeeping.mode === "self" || row.snapshot.sharedLive)
      && (row.owner_id === ctx.userId || row.snapshot.players?.some((p: { accountUserId?: string }) => p.accountUserId === ctx.userId)))
      .map(row => ({ id: row.id, name: row.snapshot.courseName, date: row.snapshot.date, mode: row.snapshot.scorekeeping.mode, players: row.snapshot.players?.length })) };
  });
}
export async function PATCH(request: Request) {
  return socialHttp(request, async ctx => {
    const body = await socialBody(request);
    return saveSharedLive(ctx, socialId(body.roundId), { patches: body.patches as SharedScorePatch[], action: body.action as string | undefined, expectedVersion: body.expectedVersion as number | undefined });
  });
}
