import { FEEDBACK_ATTACHMENT_MAX_BYTES,FEEDBACK_ATTACHMENT_TYPES } from './feedback';
import { profileImageFormatFromBytes } from './profile-image';

export type FeedbackAttachment={mime:string;data:string};
export function feedbackAttachmentType(mime:string,bytes:Uint8Array) {
  if(!bytes.length||bytes.length>FEEDBACK_ATTACHMENT_MAX_BYTES)throw Error('La imagen debe pesar como máximo 2 MB.');
  if(!(FEEDBACK_ATTACHMENT_TYPES as readonly string[]).includes(mime))throw Error('Elige una imagen JPEG, PNG o WEBP.');
  const format=profileImageFormatFromBytes(bytes);
  if(!format||`image/${format}`!==mime)throw Error('El contenido de la imagen no coincide con su formato.');
  return format;
}
