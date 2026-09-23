import { createHash,createHmac } from 'node:crypto';
import { after,NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../lib/server-auth';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { reviewCatalogQaEnabled } from '../../../lib/review-course-catalog.server';
import { feedbackMailerConfig,sendFeedbackEmail } from '../../../lib/feedback-email.server';
import { FEEDBACK_ATTACHMENT_MAX_BYTES,feedbackPersistenceInput,feedbackTopicKey,validateFeedback } from '../../../lib/feedback';
import { feedbackAttachmentType } from '../../../lib/feedback-attachment';
import { receiveFeedback,notifyFeedbackSafely } from '../../../lib/feedback-workflow';
import { backyardAiClientAddress,isCrossSiteRequest,readJsonBodyWithLimit } from '../../../lib/backyard-ai/server/http-security';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export function GET(){return NextResponse.json({internalRequestsAvailable:reviewCatalogQaEnabled(),serverEmailAvailable:reviewCatalogQaEnabled()&&Boolean(feedbackMailerConfig()),maxAttachmentBytes:FEEDBACK_ATTACHMENT_MAX_BYTES},{headers});}
export async function POST(request:NextRequest) {
  if(isCrossSiteRequest(request))return NextResponse.json({error:'Solicitud no permitida.'},{status:403,headers});
  if(!reviewCatalogQaEnabled())return NextResponse.json({error:'El soporte no está disponible en este entorno. Tu texto se conserva.'},{status:503,headers});
  try {
    const db=getSupabaseAdmin();if(!db)throw Error('BACKEND_UNAVAILABLE');
    let userId:string|null=null,identity:Record<string,unknown>={};
    if(request.headers.has('authorization')) {
      const auth=await authenticatedRequest(request);if(!auth.ok)return NextResponse.json({error:auth.error},{status:auth.status,headers});
      userId=auth.userId;
      const [profile,user]=await Promise.all([db.from('profiles').select('username,display_name').eq('id',userId).abortSignal(AbortSignal.timeout(8000)).maybeSingle(),auth.client.auth.getUser(auth.token)]);
      if(profile.error||user.error)throw Error('IDENTITY_UNAVAILABLE');
      identity={user_id:userId,username:profile.data?.username??null,display_name:profile.data?.display_name??null,email:user.data.user?.email??null};
    }
    const body=await readJsonBodyWithLimit(request,3_000_000);
    if(!body.ok)return NextResponse.json({error:'El formulario o la imagen exceden el tamaño permitido.'},{status:400,headers});
    const value=body.value as {id?:unknown;input?:unknown;guestKey?:unknown;screen?:unknown;contextualCategory?:unknown;attachment?:{mime?:unknown;data?:unknown}};
    if(!value||typeof value.id!=='string'||!uuid.test(value.id)||(!userId&&(typeof value.guestKey!=='string'||!uuid.test(value.guestKey))))return NextResponse.json({error:'Solicitud inválida.'},{status:400,headers});
    const checked=validateFeedback(value.input);if(!checked.ok)return NextResponse.json({error:checked.error},{status:400,headers});
    let bytes:Buffer|null=null,mime='',extension='';
    if(value.attachment!=null) {
      const attachment=value.attachment;
      if(typeof attachment.data!=='string'||typeof attachment.mime!=='string'||!attachment.data.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(attachment.data))return NextResponse.json({error:'Imagen inválida.'},{status:400,headers});
      bytes=Buffer.from(attachment.data,'base64');mime=attachment.mime;
      try {extension=feedbackAttachmentType(mime,bytes);} catch(e) {return NextResponse.json({error:e instanceof Error?e.message:'Imagen inválida.'},{status:400,headers});}
    }
    const id=value.id,submittedInput=checked.data,input=feedbackPersistenceInput(submittedInput),imageHash=bytes?hash(bytes):null;
    const actorKey=hash(userId??`guest:${value.guestKey}`);
    // Anonymous anti-abuse key is HMAC, rotated daily; never store raw IP/location.
    const rateKey=userId?actorKey:createHmac('sha256',process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY!).update(`feedback:${new Date().toISOString().slice(0,10)}:${backyardAiClientAddress(request)}`).digest('hex');
    const path=bytes?`${userId??'guest'}/${id}/${imageHash}.${extension}`:null;
    const context={screen:typeof value.screen==='string'?value.screen.split(/[?#]/)[0].slice(0,160):'',identity,build:process.env.VERCEL_GIT_COMMIT_SHA??'local',category:typeof value.contextualCategory==='string'?value.contextualCategory.slice(0,20):submittedInput.category,topic:feedbackTopicKey(submittedInput)};
    const outcome=await receiveFeedback({
      persist:async()=>{
        const result=await db.rpc('submit_feedback_v2',{request_id:id,actor_id:userId,actor_key:actorKey,limiter_key:rateKey,request_hash:hash(JSON.stringify({input,imageHash})),request_payload:input,request_context:context,object_path:path}).abortSignal(AbortSignal.timeout(10000));
        if(result.error)throw Error(/RATE_LIMIT/.test(result.error.message)?'RATE_LIMIT':/REQUEST_CONFLICT/.test(result.error.message)?'REQUEST_CONFLICT':'PERSISTENCE_UNAVAILABLE');
        return result.data as {id:string;status:string;created:boolean;attachmentStatus:string};
      },
      attach:async(saved)=>{
        if(!path||!bytes||saved.attachmentStatus==='READY')return;
        const uploaded=await db.storage.from('feedback-private').upload(path,bytes,{contentType:mime,upsert:false});
        if(uploaded.error) {
          // Concurrent replay may have completed the exact same immutable object.
          const existing=await db.storage.from('feedback-private').download(path);
          if(existing.error||!existing.data||hash(new Uint8Array(await existing.data.arrayBuffer()))!==imageHash) {
            await db.from('feedback_requests').update({attachment_status:'FAILED'}).eq('id',id);throw Error('ATTACHMENT_PENDING');
          }
        }
        const savedAttachment=await db.from('feedback_requests').update({attachment_status:'READY',updated_at:new Date().toISOString()}).eq('id',id);
        if(savedAttachment.error)throw Error('ATTACHMENT_PENDING');
      },
      scheduleNotification:()=>after(async()=>{
        try {
          const configured=Boolean(feedbackMailerConfig());
          const claimed=await db.from('feedback_requests').update({notification_status:configured?'SENDING':'UNAVAILABLE'}).eq('id',id).eq('notification_status','PENDING').select('id');
          if(claimed.error||!claimed.data?.length||!configured)return;
          await notifyFeedbackSafely(()=>sendFeedbackEmail(id,input),async(result)=>{
            const recorded=await db.from('feedback_requests').update({notification_status:result.messageId?'ACCEPTED_BY_PROVIDER':'FAILED',provider_message_id:result.messageId??null,error_code:result.error??null,updated_at:new Date().toISOString()}).eq('id',id);
            if(recorded.error)throw Error('NOTIFICATION_RECORD_FAILED');
          });
        }catch{console.warn('feedback_notification_unavailable');}
      }),
    });
    return NextResponse.json({...outcome,...(outcome.attachmentPending?{error:'Tu solicitud está guardada, pero falta adjuntar la imagen. Reintenta sin cambiar el formulario.'}:{})},{status:outcome.attachmentPending?409:200,headers});
  }catch(e){
    const code=e instanceof Error?e.message:'';
    const status=code==='RATE_LIMIT'?429:code==='REQUEST_CONFLICT'?409:503;
    console.warn('feedback_request_failed',status);
    return NextResponse.json({error:status===429?'Alcanzaste el límite de solicitudes. Intenta mañana.':status===409?'Esta solicitud ya fue registrada con otros datos. Cierra y abre una nueva solicitud.':'No pudimos guardar tu solicitud. Tu texto se conserva; vuelve a intentarlo.'},{status,headers});
  }
}
