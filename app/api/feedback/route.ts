import { NextRequest,NextResponse } from 'next/server';
import { authenticatedRequest } from '../../../lib/server-auth';
import { getSupabaseAdmin } from '../../../lib/supabase/server';
import { reviewCatalogQaEnabled } from '../../../lib/review-course-catalog.server';
import { feedbackMailerConfig,sendFeedbackEmail } from '../../../lib/feedback-email.server';
import { validateFeedback } from '../../../lib/feedback';
import { isCrossSiteRequest,readJsonBodyWithLimit } from '../../../lib/backyard-ai/server/http-security';
export const dynamic='force-dynamic';
const headers={'cache-control':'private, no-store'};
export function GET(){return NextResponse.json({serverEmailAvailable:reviewCatalogQaEnabled()&&Boolean(feedbackMailerConfig()),mailtoAvailable:true},{headers});}
export async function POST(request:NextRequest) {
  if(isCrossSiteRequest(request))return NextResponse.json({error:'Solicitud no permitida.'},{status:403,headers});
  try {
    if(!reviewCatalogQaEnabled())return NextResponse.json({error:'Usa Abrir correo para enviar tu solicitud.',mailtoAvailable:true},{status:503,headers});
    const auth=await authenticatedRequest(request);if(!auth.ok)return NextResponse.json({error:auth.error,mailtoAvailable:true},{status:auth.status,headers});
    const body=await readJsonBodyWithLimit(request,18000);
    if(!body.ok)return NextResponse.json({error:'Formulario inválido.'},{status:400,headers});
    const value=body.value as {id?:unknown;input?:unknown;mailtoOnly?:unknown};
    if(!value||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/i.test(value.id))return NextResponse.json({error:'Solicitud inválida.'},{status:400,headers});
    const validated=validateFeedback(value.input);if(!validated.ok)return NextResponse.json({error:validated.error},{status:400,headers});
    const db=getSupabaseAdmin();if(!db)throw Error('BACKEND_UNAVAILABLE');
    const claim=await db.rpc('claim_feedback_v1',{request_id:value.id,actor_id:auth.userId,request_payload:validated.data,mail_available:value.mailtoOnly!==true&&Boolean(feedbackMailerConfig())}).abortSignal(AbortSignal.timeout(10000));
    if(claim.error)return NextResponse.json({error:/LIMIT/.test(claim.error.message)?'Alcanzaste el límite de solicitudes. Intenta mañana.':'No pudimos registrar la solicitud. Conservamos tu texto.',mailtoAvailable:true},{status:/LIMIT/.test(claim.error.message)?429:409,headers});
    if(value.mailtoOnly===true||!claim.data.send)return NextResponse.json({...claim.data,mailtoAvailable:true},{headers});
    const result=await sendFeedbackEmail(value.id,validated.data);
    const status=result.messageId?'ACCEPTED_BY_PROVIDER':'FAILED';
    const save=await db.from('feedback_requests').update({status,provider_message_id:result.messageId??null,error_code:result.error??null,updated_at:new Date().toISOString()}).eq('id',value.id).eq('user_id',auth.userId).abortSignal(AbortSignal.timeout(10000));
    if(save.error)throw Error('DELIVERY_RECORD_UNAVAILABLE');
    return NextResponse.json({id:value.id,status,mailtoAvailable:true,...(result.error?{error:'El proveedor no confirmó el envío. Tu texto sigue aquí; puedes reintentar o abrir tu correo.'}:{})},{status:result.error?502:200,headers});
  }catch{return NextResponse.json({error:'No pudimos confirmar el envío. Tu texto se conserva; puedes reintentar o abrir tu correo.',mailtoAvailable:true},{status:503,headers});}
}
