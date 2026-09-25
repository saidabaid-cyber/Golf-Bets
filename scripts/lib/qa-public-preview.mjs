import assert from 'node:assert/strict';
export const CANONICAL_QA_ORIGIN='https://dev.thebackyard.com.mx';
export const CANONICAL_QA_PROJECT_REF='bymeopxkxapfizeeqeyb';
export function exactQaBrowserTarget(value,{allowLocal=false}={}){
 const raw=typeof value==='string'?value:'';let parsed;
 try{parsed=new URL(raw);}catch{throw new Error('QA URL must be an explicit authorized origin.');}
 const localHost=parsed.hostname==='127.0.0.1'||parsed.hostname==='localhost';
 const local=allowLocal&&localHost;
 const exactRemote=raw===CANONICAL_QA_ORIGIN||raw===CANONICAL_QA_ORIGIN+'/';
 const localOrigin=`${parsed.protocol}//${parsed.hostname}${parsed.port?`:${parsed.port}`:''}`;
 const exactLocal=local&&(raw===localOrigin||raw===`${localOrigin}/`);
 const clean= !parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/' &&
   ((exactLocal&&(parsed.protocol==='http:'||parsed.protocol==='https:'))||(!localHost&&exactRemote));
 if(!clean)throw new Error('QA URL must be an explicit authorized origin.');
 return parsed;
}
export function exactQaSupabaseOrigin(value,projectRef=CANONICAL_QA_PROJECT_REF){
 const expected=`https://${projectRef}.supabase.co`;let parsed;
 try{parsed=new URL(value);}catch{throw new Error('NEXT_PUBLIC_SUPABASE_URL must be the exact isolated QA HTTPS origin.');}
 if(value!==expected||parsed.origin!==expected||parsed.href!==expected+'/'||
   parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.port||
   parsed.pathname!=='/'||parsed.search||parsed.hash){
  throw new Error('NEXT_PUBLIC_SUPABASE_URL must be the exact isolated QA HTTPS origin.');
 }
 return expected;
}
/** Credentials and fixture passwords may be sent only to one exact origin and
 * redirects are never followed, including same-origin redirects. */
export function qaCredentialBoundFetch(origin,fetcher=fetch){
 return async(input,init={})=>{let snapshot;let raw;
  try{snapshot=input instanceof Request?new Request(input):null;raw=snapshot?snapshot.url:String(input);}catch{throw new Error('QA request could not be snapshotted safely.');}
  let target;
  try{target=new URL(raw);}catch{throw new Error('QA request target is invalid.');}
  if(!['http:','https:'].includes(target.protocol)||target.origin!==origin||target.username||target.password)throw new Error('QA credential destination mismatch.');
  snapshot ||= target.href;
  const response=await fetcher(snapshot,{...init,redirect:'error'});
  if(response.status>=300&&response.status<400)throw new Error('QA refused an HTTP redirect.');
  return response;
 };
}
export function qaPublicKey(value,projectRef=CANONICAL_QA_PROJECT_REF){
 if(!value||typeof value!=='string'||value.includes('SENSITIVE')||value.startsWith('sb_secret_'))throw new Error('Preview public key is missing or has an unauthorized key type.');
 if(value.startsWith('sb_publishable_')){
  if(!/^sb_publishable_[A-Za-z0-9_-]{15,}$/.test(value))throw new Error('Preview publishable key format is invalid.');
  return value;
 }
 try{
  const parts=value.split('.');
  if(parts.length!==3)throw new Error();
  const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8'));
  if(claims.ref!==projectRef||claims.role!=='anon')throw new Error();
  return value;
 }catch{throw new Error('Preview public key is not an authorized publishable/anon key.');}
}
/** User-authenticated QA does not need or retrieve a service-role secret. */
export function publicPreviewConfig(env=process.env){
 const projectRef=CANONICAL_QA_PROJECT_REF;
 assert.equal(env.PREVIEW_DB_REF,projectRef);assert.equal(env.QA_CONFIRM_ISOLATED_PREVIEW,projectRef);
 const supabaseOrigin=exactQaSupabaseOrigin(env.NEXT_PUBLIC_SUPABASE_URL,projectRef);
 const preview=exactQaBrowserTarget(env.PREVIEW_QA_URL);
 assert.ok(!env.VERCEL_ENV||env.VERCEL_ENV==='preview');
 const expectedSha=String(env.PREVIEW_QA_EXPECTED_SHA||'').trim().toLowerCase();assert.match(expectedSha,/^[0-9a-f]{40}$/);
 const publicKey=qaPublicKey(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY,projectRef);
 return {projectRef,previewOrigin:preview.origin,supabaseOrigin,expectedSha,publicKey,bypass:env.VERCEL_AUTOMATION_BYPASS_SECRET||''};
}
