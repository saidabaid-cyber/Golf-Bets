export const FEEDBACK_CATEGORIES={COURSE:'Solicitar un campo',CLUB:'Solicitar un bastón',BALL:'Solicitar una bola',SHAFT:'Solicitar una varilla',BET:'Proponer una apuesta o modalidad',BUG:'Reportar un error',GENERAL:'Sugerencia general'} as const;
export type FeedbackCategory=keyof typeof FEEDBACK_CATEGORIES;
export type FeedbackInput={category:FeedbackCategory;name:string;description:string;replyEmail:string;city:string;state:string;brand:string;model:string;rules:string};
export const FEEDBACK_TO='contacto@thebackyard.com.mx';
export function validateFeedback(value:unknown):{ok:true;data:FeedbackInput}|{ok:false;error:string} {
  if(!value||typeof value!=='object'||Array.isArray(value))return{ok:false,error:'Revisa los datos.'};
  const v=value as Record<string,unknown>;
  if(typeof v.category!=='string'||!Object.hasOwn(FEEDBACK_CATEGORIES,v.category))return{ok:false,error:'Selecciona una categoría.'};
  const fields=['name','description','replyEmail','city','state','brand','model','rules'] as const;
  const data={category:v.category} as FeedbackInput;
  for(const field of fields) {if(typeof v[field]!=='string')return{ok:false,error:'Completa los campos del formulario.'};data[field]=(v[field] as string).trim();
    if(data[field].length>(field==='description'||field==='rules'?2000:200))return{ok:false,error:'El texto excede el límite permitido.'};}
  if(!/^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/.test(data.replyEmail))return{ok:false,error:'Escribe un correo de respuesta válido.'};
  if(data.description.length<10)return{ok:false,error:'Describe tu solicitud con al menos 10 caracteres.'};
  if(!['BUG','GENERAL'].includes(data.category)&&!data.name)return{ok:false,error:'Escribe el nombre del campo, equipo o propuesta.'};
  if(data.category==='COURSE'&&(!data.city||!data.state))return{ok:false,error:'Indica ciudad y estado del campo.'};
  if(['CLUB','BALL','SHAFT'].includes(data.category)&&(!data.brand||!data.model))return{ok:false,error:'Indica marca y modelo; escribe «No lo sé» si lo desconoces.'};
  return{ok:true,data};
}
export function feedbackMessage(v:FeedbackInput) {return {subject:`The Backyard · ${FEEDBACK_CATEGORIES[v.category]}${v.name?`: ${v.name.replace(/[\r\n]/g,' ')}`:''}`,
  text:[`Categoría: ${FEEDBACK_CATEGORIES[v.category]}`,v.name&&`Nombre: ${v.name}`,`Responder a: ${v.replyEmail}`,
    v.category==='COURSE'&&`Ubicación: ${v.city}, ${v.state}`,['CLUB','BALL','SHAFT'].includes(v.category)&&`Equipo: ${v.brand} ${v.model}`,
    v.description,v.category==='BET'&&v.rules&&`Reglas / participantes / ejemplo: ${v.rules}`].filter(Boolean).join('\n\n')};}
export function feedbackMailto(v:FeedbackInput) {const m=feedbackMessage(v);return `mailto:${FEEDBACK_TO}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.text)}`;}
