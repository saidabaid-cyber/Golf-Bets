/** Synthetic data only; remote access still requires verified server identity. */
export function scorecardQaEnvironment(env:Readonly<Record<string,string|undefined>>) {
  if(env.VERCEL_ENV==='production')return false;
  if(env.NODE_ENV==='development'&&!env.VERCEL)return true;
  return env.VERCEL==='1'&&env.VERCEL_ENV==='preview'
    &&['integration/backyard-current','ux/scorecard-premium-v1'].includes(env.VERCEL_GIT_COMMIT_REF||'')
    &&env.PREVIEW_DB_REF==='bymeopxkxapfizeeqeyb'
    &&env.NEXT_PUBLIC_SUPABASE_URL==='https://bymeopxkxapfizeeqeyb.supabase.co';
}
export function scorecardQaAccount(userId:string) {
  // Explicitly authorized DEV QA identities; never mutable user_metadata/email.
  return ['b182e0a1-d3f5-4e32-a005-29c6d55b6cdf','5640dd66-e772-4f5e-bbd8-8fab47fb6b40'].includes(userId);
}
