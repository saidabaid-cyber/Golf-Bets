import 'server-only';
import { getActivity, SocialServiceError, type SocialContext } from './social-activity.server';
import type { AttestRoster, AttestCompanion } from './attest-requests';
import type { SocialNotification } from './social-activity-contract';
function fail(error: {code?:string}|null) {
  if (!error) return;
  throw new SocialServiceError(error.code==='40001'?'STALE_REVISION':error.code==='42501'?'FORBIDDEN':error.code==='42883'||error.code==='PGRST202'?'SOCIAL_SCHEMA_PENDING':'MUTATION_FAILED', error.code==='42501'?403:error.code==='40001'?409:503, 'No se confirmó la solicitud.');
}
export async function attestRoster(ctx: SocialContext, id: string): Promise<AttestRoster> {
  const {data:card}=await getActivity(ctx,id);
  if (card.author.userId!==ctx.userId || !card.roundId) throw new SocialServiceError('FORBIDDEN',403,'Solo el autor puede solicitar Atest.');
  const result=await ctx.client.rpc('attest_request_roster_v1',{activity:id,expected_hash:card.currentHash}); fail(result.error);
  const data=await Promise.all((result.data as AttestCompanion[]).map(async p=>{
    if (!p.userId) return p;
    const identity=await ctx.client.rpc('social_profile_card_v1',{target:p.userId});
    const profile=identity.error?null:identity.data?.[0];
    return profile?{...p,name:profile.display_name,username:profile.username,avatarUrl:profile.avatar_url}:p;
  }));
  return {data,expectedHash:card.currentHash,sourceVersion:card.sourceVersion};
}
export async function sendAttestRequests(ctx: SocialContext,id:string,hash:unknown,recipients:unknown) {
  if (typeof hash!=='string'||!/^[a-f0-9]{64}$/.test(hash)||!Array.isArray(recipients)||!recipients.length||recipients.length>20||recipients.some(r=>typeof r!=='string'||!/^[a-f0-9-]{36}$/.test(r))) throw new SocialServiceError('INVALID_REQUEST',400,'Compañeros inválidos.');
  const roster=await attestRoster(ctx,id);
  if(roster.expectedHash!==hash)throw new SocialServiceError('STALE_REVISION',409,'La tarjeta cambió.');
  // RPC revalidates identity, roster, privacy, revision and the entire batch atomically.
  const result=await ctx.client.rpc('send_attest_requests_v1',{activity:id,expected_hash:hash,recipients});fail(result.error);
  return {data:result.data,roster:await attestRoster(ctx,id)};
}
/** A persistent action inbox, independent of notification preferences/read state. */
export async function incomingAttestRequests(ctx:SocialContext,offset=0):Promise<{data:SocialNotification[];nextCursor:string|null}> {
  const rows=await ctx.client.from('social_attest_requests_v1').select('id,activity_id,expected_hash,created_at').eq('recipient_id',ctx.userId).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+49);fail(rows.error);
  const events=rows.data?.length?await ctx.client.from('notification_events_v2').select('id,read_at').in('id',rows.data.map(r=>r.id)):{data:[],error:null};fail(events.error);
  const data:SocialNotification[]=[];
  for (const request of rows.data||[]) {
    // The request was already admitted by authenticated, current-card RLS;
    // do not repeat legacy source reconciliation for each inbox item.
    try {const {data:card}=await getActivity(ctx,request.activity_id,false);
      const state=card.currentHash!==request.expected_hash?'STALE':card.isAttestedByMe?'ATTESTED':'PENDING';
      if(state==='ATTESTED')continue;
      data.push({id:request.id,type:'attest_request',activityId:card.id,createdAt:request.created_at,readAt:events.data?.find(e=>e.id===request.id)?.read_at??null,person:card.author,courseName:card.round?.courseName,attestRequest:{expectedHash:request.expected_hash,state}});
    }catch(e){if(!(e instanceof SocialServiceError)||!['NOT_FOUND','FORBIDDEN','STALE_REVISION'].includes(e.code))throw e;}
  }
  // Keep the latest actionable request per card, while retaining all versions in storage.
  return {data:[...new Map(data.reverse().map(n=>[n.activityId,n])).values()].reverse(),nextCursor:rows.data?.length===50?String(offset+50):null};
}
