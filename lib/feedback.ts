export const FEEDBACK_CATEGORIES={COURSE:'Solicitar un campo',TEE:'Solicitar un tee',CLUB:'Solicitar un bastón',BALL:'Solicitar una bola',SHAFT:'Solicitar una varilla',BET:'Proponer una apuesta o modalidad',BUG:'Reportar un error',GENERAL:'Sugerencia general'} as const;
export type FeedbackCategory=keyof typeof FEEDBACK_CATEGORIES;
export type FeedbackInput={category:FeedbackCategory;name:string;description:string;replyEmail:string;city:string;state:string;brand:string;model:string;rules:string;clubType?:string;flex?:string;players?:string;example?:string;occurred?:string;expected?:string;module?:string};
export const FEEDBACK_ATTACHMENT_MAX_BYTES=2*1024*1024;
export const FEEDBACK_ATTACHMENT_TYPES=['image/jpeg','image/png','image/webp'] as const;
export const FEEDBACK_SHORT_LABELS:Record<FeedbackCategory,string>={COURSE:'Campo',TEE:'Tee',CLUB:'Bastón',BALL:'Bola',SHAFT:'Varilla',BET:'Apuesta',BUG:'Bug',GENERAL:'Sugerencia'};
export const FEEDBACK_OPTIONAL_FIELDS=['clubType','flex','players','example','occurred','expected','module'] as const;
export const FEEDBACK_TO='soporte@thebackyard.com.mx';
export const FEEDBACK_DEV_CC='contacto@thebackyard.com.mx';
export const COURSE_SCORECARD_REQUIRED_MESSAGE='Adjunta una foto de la tarjeta del club para que podamos dar de alta el campo correctamente.';
export function feedbackAttachmentRequired(category:FeedbackCategory){return category==='COURSE';}
export function validateFeedback(value:unknown):{ok:true;data:FeedbackInput}|{ok:false;error:string} {
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,error:'Revisa los datos.'};
  const v=value as Record<string,unknown>;
  if(typeof v.category!=='string'||!Object.hasOwn(FEEDBACK_CATEGORIES,v.category))return{ok:false,error:'Selecciona una categoría.'};
  const fields=['name','description','replyEmail','city','state','brand','model','rules'] as const;
  const data={category:v.category} as FeedbackInput;
  for(const field of fields) {if(typeof v[field]!=='string')return{ok:false,error:'Completa los campos del formulario.'};data[field]=(v[field] as string).trim();
    if(data[field].length>(field==='description'||field==='rules'?2000:200))return{ok:false,error:'El texto excede el límite permitido.'};}
  for(const field of FEEDBACK_OPTIONAL_FIELDS){if(v[field]!==undefined&&typeof v[field]!=='string')return{ok:false,error:'Revisa los campos adicionales.'};const text=String(v[field]??'').trim();if(text.length>2000)return{ok:false,error:'El texto excede el límite permitido.'};data[field]=text;}
  if(data.players&&!/^(?:[1-9]|[1-9]\d|100)$/.test(data.players))return{ok:false,error:'Indica entre 1 y 100 jugadores.'};
  if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(data.replyEmail))return{ok:false,error:'Escribe un correo de respuesta válido.'};
  if(data.description.length<10)return{ok:false,error:'Describe tu solicitud con al menos 10 caracteres.'};
  if(!['BUG','GENERAL','CLUB','BALL','SHAFT'].includes(data.category)&&!data.name)return{ok:false,error:'Escribe el nombre del campo, tee o propuesta.'};
  if(data.category==='COURSE'&&(!data.city||!data.state))return{ok:false,error:'Indica ciudad y estado del campo.'};
  if(['CLUB','BALL','SHAFT'].includes(data.category)&&(!data.brand||!data.model))return{ok:false,error:'Indica marca y modelo; escribe «No lo sé» si lo desconoces.'};
  if(['CLUB','BALL','SHAFT'].includes(data.category))data.name=[data.brand,data.model].join(' ');
  return{ok:true,data};
}
export function feedbackTopicKey(v:FeedbackInput){return [v.category,v.name||v.module||v.description.slice(0,100),v.category==='COURSE'?v.city:'',v.category==='COURSE'?v.state:''].join('|').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,600);}
/** The current QA schema stores tee requests in the existing COURSE request
 * queue. The explicit title/details keep them distinct for Admin without a
 * destructive enum migration. */
export function feedbackPersistenceInput(value:FeedbackInput):FeedbackInput {
  if(value.category!=='TEE')return value;
  return {...value,category:'COURSE',name:`Tee faltante · ${value.name}`,description:`${value.description}\nTee solicitado: ${value.model||'No indicado'}`};
}
export function feedbackMessage(v:FeedbackInput) {return {subject:`The Backyard · ${FEEDBACK_CATEGORIES[v.category]}${v.name?`: ${v.name.replace(/[\r\n]/g,' ')}`:''}`,
  text:[`Categoría: ${FEEDBACK_CATEGORIES[v.category]}`,...feedbackSpecificDetails(v),`Responder a: ${v.replyEmail}`,`Descripción:\n${v.description}`].filter(Boolean).join('\n\n')};}
export function feedbackMailto(v:FeedbackInput) {const m=feedbackMessage(v);return `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;}

export type FeedbackDeliveryContext={submittedAt?:string|null;screen?:string|null;identity?:Record<string,unknown>|null;attachmentAvailable?:boolean;environment?:string|null};
const oneLine=(value:unknown)=>typeof value==='string'?value.replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim():'';
export function feedbackSpecificDetails(v:FeedbackInput) {
  const rows:[string,string][]=[
    ['Nombre / solicitud',v.name],['Ciudad',v.city],['Estado',v.state],['Marca',v.brand],['Modelo',v.model],
    ['Tipo de bastón',v.clubType??''],['Flex',v.flex??''],['Jugadores',v.players??''],['Módulo',v.module??''],
    ['Qué ocurrió',v.occurred??''],['Qué esperaba',v.expected??''],['Reglas',v.rules],['Ejemplo',v.example??''],
  ];
  return rows.flatMap(([label,value])=>{const normalized=oneLine(value);return normalized?[`${label}: ${normalized}`]:[];});
}
export function feedbackDeliveryText(id:string,input:FeedbackInput,context:FeedbackDeliveryContext={}) {
  const identity=context.identity??{};
  const user=oneLine(identity.display_name)||oneLine(identity.username)||oneLine(identity.email)||oneLine(identity.user_id)||'No disponible';
  const accountEmail=oneLine(identity.email);
  const submittedAt=context.submittedAt&&Number.isFinite(Date.parse(context.submittedAt))?new Date(context.submittedAt).toISOString():'No disponible';
  const details=feedbackSpecificDetails(input);
  return [
    `Referencia: ${id}`,
    `Categoría: ${FEEDBACK_CATEGORIES[input.category]}`,
    `Usuario / nombre: ${user}`,
    accountEmail&&`Correo de cuenta: ${accountEmail}`,
    `Correo de respuesta: ${input.replyEmail}`,
    `Fecha: ${submittedAt}`,
    `Pantalla / origen: ${oneLine(context.screen)||'No indicada'}`,
    `Entorno: ${oneLine(context.environment)||'No indicado'}`,
    `Datos específicos de la categoría:\n${details.length?details.join('\n'):'Sin datos adicionales.'}`,
    `Descripción:\n${input.description}`,
    context.attachmentAvailable
      ? 'Adjunto: Sí. Revísalo de forma segura en Admin → Solicitudes; el archivo privado no se incluye ni se publica en este correo.'
      : 'Adjunto: No.',
    'La base de datos es el registro oficial de esta solicitud.',
  ].filter(Boolean).join('\n\n');
}
