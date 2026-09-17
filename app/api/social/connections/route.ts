import { socialBody, socialHttp, socialId } from "../../../../lib/social-http.server";
import type { SocialContext } from "../../../../lib/social-activity.server";
async function profile(ctx:SocialContext, id:string) {
 const result = await ctx.client.rpc("social_profile_card_v1", { target:id });
 if (result.error) throw result.error;
 return result.data?.[0] || null;
}
async function graph(ctx:SocialContext) {
 const [requests,friendships,blocked] = await Promise.all([
  ctx.client.from("friend_requests").select("id,requester_id,addressee_id,state,created_at").or(`requester_id.eq.${ctx.userId},addressee_id.eq.${ctx.userId}`).order("created_at",{ascending:false}).limit(200),
  ctx.client.from("friendships").select("user_a_id,user_b_id").or(`user_a_id.eq.${ctx.userId},user_b_id.eq.${ctx.userId}`).limit(500),
  ctx.client.from("blocked_connections").select("blocked_user_id").eq("owner_id",ctx.userId).limit(500),
 ]);
 if(requests.error || friendships.error || blocked.error) throw new Error("CONNECTION_READ_FAILED");
 const friends = (friendships.data||[]).map(f => f.user_a_id === ctx.userId ? f.user_b_id : f.user_a_id);
 const ids = [...new Set([ctx.userId,...friends,...(requests.data||[]).filter(r => r.state === "PENDING").flatMap(r => [r.requester_id,r.addressee_id])])];
 const people = (await Promise.all(ids.map(id => profile(ctx,id)))).filter(Boolean);
 return {people,requests:requests.data||[],friends,blocked:(blocked.data||[]).map(b => b.blocked_user_id)};
}
export async function GET(request:Request) { return socialHttp(request, async ctx => {
 const target = new URL(request.url).searchParams.get("target");
 if(target) { const person = await profile(ctx,socialId(target)); if(!person) throw Object.assign(new Error(),{code:"NOT_FOUND",status:404}); return {person}; }
 return graph(ctx);
}); }
export async function POST(request:Request) { return socialHttp(request,async ctx => {
 const body = await socialBody(request);
 if(body.action === "request") {
  const target = socialId(body.target);
  if(target === ctx.userId || !await profile(ctx,target)) throw Object.assign(new Error(),{code:"FORBIDDEN",status:403});
  const before = await graph(ctx);
  if(before.friends.includes(target) || before.requests.some(r=>r.state==="PENDING" && [r.requester_id,r.addressee_id].includes(target))) return before;
  const {error} = await ctx.client.from("friend_requests").insert({requester_id:ctx.userId,addressee_id:target,operation_id:socialId(body.operationId),state:"PENDING"});
  if(error && error.code!=="23505") {
   // A concurrent accepted/requested pair is already one logical operation.
   const after=await graph(ctx); if(!after.friends.includes(target) && !after.requests.some(r=>r.state==="PENDING" && [r.requester_id,r.addressee_id].includes(target))) throw error;
  }
 } else if(["ACCEPTED","REJECTED","CANCELLED"].includes(String(body.action))) {
  const id=socialId(body.id);
  const {error} = await ctx.client.from("friend_requests").update({state:body.action}).eq("id",id).eq(body.action==="CANCELLED"?"requester_id":"addressee_id",ctx.userId).eq("state","PENDING");
  if(error) throw error;
 } else if(body.action === "block") {
  const target=socialId(body.target); if(target===ctx.userId) throw Object.assign(new Error(),{code:"INVALID_REQUEST",status:400});
  const {error}=await ctx.client.from("blocked_connections").insert({owner_id:ctx.userId,blocked_user_id:target}); if(error && error.code !== "23505") throw error;
 } else throw Object.assign(new Error(),{code:"INVALID_REQUEST",status:400});
 return graph(ctx);
}); }
