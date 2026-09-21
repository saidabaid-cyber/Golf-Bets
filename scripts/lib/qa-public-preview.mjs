import assert from 'node:assert/strict';
/** User-authenticated QA does not need or retrieve a service-role secret. */
export function publicPreviewConfig(env=process.env){
 const projectRef='bymeopxkxapfizeeqeyb';
 assert.equal(env.PREVIEW_DB_REF,projectRef);assert.equal(env.QA_CONFIRM_ISOLATED_PREVIEW,projectRef);
 assert.equal(env.NEXT_PUBLIC_SUPABASE_URL,`https://${projectRef}.supabase.co`);
 const preview=new URL(env.PREVIEW_QA_URL);
 assert.match(preview.origin,/^https:\/\/golf-bets-[a-z0-9]{9}-saha8\.vercel\.app$/);assert.equal(preview.href,preview.origin+'/');
 assert.ok(!env.VERCEL_ENV||env.VERCEL_ENV==='preview');
 const publicKey=env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||env.NEXT_PUBLIC_SUPABASE_ANON_KEY;assert.ok(publicKey&&!publicKey.includes('SENSITIVE'));
 if(!publicKey.startsWith('sb_publishable_')){const claims=JSON.parse(Buffer.from(publicKey.split('.')[1],'base64url').toString());assert.equal(claims.ref,projectRef);assert.equal(claims.role,'anon');}
 return {projectRef,previewOrigin:preview.origin,supabaseOrigin:env.NEXT_PUBLIC_SUPABASE_URL,publicKey,bypass:env.VERCEL_AUTOMATION_BYPASS_SECRET||''};
}
