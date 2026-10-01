import { isAccountSession, restoreAuthSession, type AuthFlowClient } from './auth-flow';

export type EmailLinkAuth = Omit<AuthFlowClient, 'verifyOtp'> & {
  verifyOtp: (input: {token_hash:string;type:'magiclink'} | {email:string;token:string;type:'email'}) => ReturnType<AuthFlowClient['verifyOtp']>;
};
const validHash = (value:string) => /^[a-f0-9]{40,128}$/i.test(value);

/** A fragment keeps the one-time credential out of HTTP requests and referrers. */
export function emailLinkHash(fragment:string):string|null {
  if(fragment.length>250) return null;
  const values=new URLSearchParams(fragment.replace(/^#/,''));
  if([...values.keys()].some(key=>!['token_hash','type'].includes(key))
    ||values.getAll('token_hash').length!==1||values.getAll('type').length!==1
    ||values.get('type')!=='magiclink') return null;
  const hash=values.get('token_hash')||'';
  return validHash(hash)?hash:null;
}

/** Called only by the user's sign-in button, never while loading a mail link. */
export async function verifyEmailLink(auth:EmailLinkAuth,tokenHash:string) {
  if(!validHash(tokenHash)) throw new Error('invalid_email_link');
  const result=await auth.verifyOtp({token_hash:tokenHash,type:'magiclink'});
  if(result.error) throw result.error;
  if(!isAccountSession(result.data.session)) throw new Error('account_session_missing');
  const session=await restoreAuthSession(auth);
  if(!session||session.user.id!==result.data.session.user.id) throw new Error('account_session_missing');
  return session;
}
