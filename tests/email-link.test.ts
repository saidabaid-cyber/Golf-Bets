import assert from 'node:assert/strict';
import test from 'node:test';
import type {Session} from '@supabase/supabase-js';
import {emailLinkHash,verifyEmailLink,type EmailLinkAuth} from '../lib/email-link';
const hash='a'.repeat(64);
function fixture(){
  const calls:string[]=[];
  const session={access_token:'qa-token',refresh_token:'qa-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'qa-player',email:'player@example.invalid'}} as Session;
  const auth:EmailLinkAuth={signInWithOtp:async()=>({error:null}),signInWithOAuth:async()=>({error:null}),signOut:async()=>({error:null}),
    verifyOtp:async(input)=>{calls.push('verify');assert.deepEqual(input,{token_hash:hash,type:'magiclink'});return{data:{session},error:null};},
    getSession:async()=>{calls.push('session');return{data:{session},error:null};},
    getUser:async()=>{calls.push('user');return{data:{user:session.user},error:null};}};
  return{auth,calls,session};
}
test('mail fragments accept a single credential and never a redirect or duplicate parameter',()=>{
  assert.equal(emailLinkHash(`#token_hash=${hash}&type=magiclink`),hash);
  for(const fragment of['',`#token_hash=${hash}&type=recovery`,`#token_hash=${hash}&type=magiclink&redirect=https://evil.invalid`,`#token_hash=${hash}&token_hash=${hash}&type=magiclink`,`#token_hash=invalid&type=magiclink`])assert.equal(emailLinkHash(fragment),null);
});
test('mail-link verification restores and verifies the newly authenticated identity',async()=>{
  const {auth,calls,session}=fixture();assert.equal(await verifyEmailLink(auth,hash),session);assert.deepEqual(calls,['verify','session','user']);
});
test('malformed mail credentials never reach Auth',async()=>{
  const {auth,calls}=fixture();await assert.rejects(verifyEmailLink(auth,'not-a-hash'),/invalid_email_link/);assert.deepEqual(calls,[]);
});
test('expired mail links cannot reuse an existing browser session',async()=>{
  const {auth,calls}=fixture();auth.verifyOtp=async()=>{calls.push('verify');return{data:{session:null},error:new Error('otp_expired')};};
  await assert.rejects(verifyEmailLink(auth,hash),/otp_expired/);assert.deepEqual(calls,['verify']);
});
test('a different cached identity cannot replace the identity verified by the mail link',async()=>{
  const {auth,session}=fixture();const other={...session,user:{...session.user,id:'other-user'}} as Session;
  auth.getSession=async()=>({data:{session:other},error:null});auth.getUser=async()=>({data:{user:other.user},error:null});
  await assert.rejects(verifyEmailLink(auth,hash),/account_session_missing/);
});
