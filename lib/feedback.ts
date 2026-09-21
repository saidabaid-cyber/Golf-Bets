export const FEEDBACK_CATEGORIES={COURSE:'Solicitar un campo',CLUB:'Solicitar un bastón',BALL:'Solicitar una bola',SHAFT:'Solicitar una varilla',BET:'Proponer una apuesta o modalidad',BUG:'Reportar un error',GENERAL:'Sugerencia general'} as const;
export type FeedbackCategory=keyof typeof FEEDBACK_CATEGORIES;
export type FeedbackInput={category:FeedbackCategory;name:string;description:string;replyEmail:string;city:string;state:string;brand:string;model:string;rules:string;clubType?:string;flex?:string;players?:string;example?:string;occurred?:string;expected?:string;module?:string};
export const FEEDBACK_ATTACHMENT_MAX_BYTES=2*1024*1024;
export const FEEDBACK_ATTACHMENT_TYPES=['image/jpeg','image/png','image/webp'] as const;
export const FEEDBACK_SHORT_LABELS:Record<FeedbackCategory,string>={COURSE:'Campo',CLUB:'Bastón',BALL:'Bola',SHAFT:'Varilla',BET:'Apuesta',BUG:'Bug',GENERAL:'Sugerencia'};
export const FEEDBACK_OPTIONAL_FIELDS=['clubType','flex','players','example','occurred','expected','module'] as const;
export const FEEDBACK_TO='contacto@thebackyard.com.mx';
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
  if(!['BUG','GENERAL','CLUB','BALL','SHAFT'].includes(data.category)&&!data.name)return{ok:false,error:'Escribe el nombre del campo o propuesta.'};
  if(data.category==='COURSE'&&(!data.city||!data.state))return{ok:false,error:'Indica ciudad y estado del campo.'};
  if(['CLUB','BALL','SHAFT'].includes(data.category)&&(!data.brand||!data.model))return{ok:false,error:'Indica marca y modelo; escribe «No lo sé» si lo desconoces.'};
  if(['CLUB','BALL','SHAFT'].includes(data.category))data.name=[data.brand,data.model].join(' ');
  return{ok:true,data};
}
export function feedbackTopicKey(v:FeedbackInput){return [v.category,v.name||v.module||v.description.slice(0,100),v.category==='COURSE'?v.city:'',v.category==='COURSE'?v.state:''].join('|').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim().slice(0,600);}
export function feedbackMessage(v:FeedbackInput) {return {subject:`The Backyard · ${FEEDBACK_CATEGORIES[v.category]}${v.name?`: ${v.name.replace(/[\r\n]/g,' ')}`:''}`,
  text:[`Categoría: ${FEEDBACK_CATEGORIES[v.category]}`,v.name&&`Nombre: ${v.name}`,`Responder a: ${v.replyEmail}`,
    v.category==='COURSE'&&`Ubicación: ${v.city}, ${v.state}`,['CLUB','BALL','SHAFT'].includes(v.category)&&`Equipo: ${v.brand} ${v.model}`,
    v.description,v.category==='BET'&&v.rules&&`Reglas / participantes / ejemplo: ${v.rules}`].filter(Boolean).join('\n\n')};}
export function feedbackMailto(v:FeedbackInput) {const m=feedbackMessage(v);return `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;}
