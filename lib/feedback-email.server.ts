import 'server-only';
import { normalizedInvitationEmail } from './group-invitations';
import { FEEDBACK_CATEGORIES,FEEDBACK_DEV_CC,FEEDBACK_TO,feedbackDeliveryText,type FeedbackDeliveryContext,type FeedbackInput } from './feedback';
/** Reuses the transactional Resend integration, NEVER Auth SMTP credentials. */
export function feedbackMailerConfig(env:Record<string,string|undefined>=process.env) {
  const key=env.FEEDBACK_RESEND_API_KEY||env.GROUP_INVITES_RESEND_API_KEY;
  const from=normalizedInvitationEmail(env.FEEDBACK_FROM_EMAIL||env.GROUP_INVITES_FROM_EMAIL);
  return key&&from?{key,from}:null;
}
export async function sendFeedbackEmail(id:string,input:FeedbackInput,context:FeedbackDeliveryContext={},options:{env?:Record<string,string|undefined>;fetcher?:typeof fetch}={}) {
  const env=options.env??process.env;
  const config=feedbackMailerConfig(env);if(!config)return{error:'MAILER_NOT_CONFIGURED'};
  const cc=env.VERCEL_ENV==='preview'?[FEEDBACK_DEV_CC]:undefined;
  try {const r=await(options.fetcher??fetch)('https://api.resend.com/emails',{method:'POST',redirect:'error',signal:AbortSignal.timeout(12000),
    headers:{Authorization:`Bearer ${config.key}`,'Content-Type':'application/json','Idempotency-Key':`backyard-feedback-${id}`},
    body:JSON.stringify({from:`The Backyard <${config.from}>`,to:[FEEDBACK_TO],...(cc?{cc}:{}),reply_to:input.replyEmail,subject:`Nueva solicitud Backyard · ${FEEDBACK_CATEGORIES[input.category]}`,text:feedbackDeliveryText(id,input,context)})});
    if(!r.ok)return{error:r.status===429?'PROVIDER_RATE_LIMIT':'PROVIDER_REJECTED'};
    const data=await r.json();return typeof data.id==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(data.id)?{messageId:data.id}:{error:'PROVIDER_INVALID_RESPONSE'};
  }catch{return{error:'PROVIDER_UNAVAILABLE'};}
}
