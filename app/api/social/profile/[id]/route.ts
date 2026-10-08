import {socialHttp,socialId} from '../../../../../lib/social-http.server';
import {SocialServiceError} from '../../../../../lib/social-activity.server';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id:raw}=await params;
  return socialHttp(request,async ctx=>{
    const id=socialId(raw);
    const identity=await ctx.client.rpc('social_profile_card_v1',{target:id});
    if(identity.error)throw identity.error;
    const person=identity.data?.[0];if(!person)throw new SocialServiceError('NOT_FOUND',404,'Este perfil no está disponible.');
    // Club is public only; handicap/contact/location are not part of the social contract.
    const club=await ctx.admin.from('social_profiles').select('club_name').eq('user_id',id).eq('privacy','PUBLIC').maybeSingle();
    if(club.error)throw club.error;
    const edges=await ctx.client.from('friendships').select('user_a_id,user_b_id').or(`user_a_id.eq.${id},user_b_id.eq.${id}`).limit(101);
    if(edges.error)throw edges.error;
    const ids=[...new Set((edges.data||[]).slice(0,100).map(e=>e.user_a_id===id?e.user_b_id:e.user_a_id))];
    const visible=await Promise.all(ids.map(async target=>{const p=await ctx.client.rpc('social_profile_card_v1',{target});if(p.error)throw p.error;return p.data?.[0]??null;}));
    return {person:{...person,club_name:club.data?.club_name??null},friends:visible.filter(Boolean),friendsComplete:(edges.data?.length??0)<=100,connectionsScope:id===ctx.userId?'OWN':'VISIBLE'};
  });
}
