import { FEEDBACK_ATTACHMENT_MAX_BYTES,FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES,FEEDBACK_ATTACHMENT_TYPES } from './feedback';
import { profileImageFormatFromBytes } from './profile-image';

export type FeedbackAttachment={mime:string;data:string};
const canonicalMime={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'} as const;

export function feedbackOriginalAttachmentType(mime:string,bytes:Uint8Array,totalBytes=bytes.length) {
  if(!totalBytes||totalBytes>FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES)throw Error('Esta imagen es demasiado grande. Elige una imagen de hasta 20 MB.');
  const format=profileImageFormatFromBytes(bytes);
  if(format==='heic'||format==='heif')throw Error('HEIC/HEIF no se puede procesar de forma fiable en este navegador. Elige JPEG, PNG o WebP.');
  if(!format||!Object.hasOwn(canonicalMime,format))throw Error('El archivo no contiene una imagen JPEG, PNG o WebP válida.');
  const expected=canonicalMime[format as keyof typeof canonicalMime];
  if(mime&&(!(FEEDBACK_ATTACHMENT_TYPES as readonly string[]).includes(mime.toLowerCase())||mime.toLowerCase()!==expected))throw Error('El contenido de la imagen no coincide con su formato.');
  return {format:format as keyof typeof canonicalMime,mime:expected};
}
export function feedbackAttachmentType(mime:string,bytes:Uint8Array) {
  if(!bytes.length||bytes.length>FEEDBACK_ATTACHMENT_MAX_BYTES)throw Error('No pudimos reducir la imagen al tamaño seguro. Intenta con otra foto.');
  if(!(FEEDBACK_ATTACHMENT_TYPES as readonly string[]).includes(mime))throw Error('Elige una imagen JPEG, PNG o WEBP.');
  const format=profileImageFormatFromBytes(bytes);
  if(!format||`image/${format}`!==mime)throw Error('El contenido de la imagen no coincide con su formato.');
  return format;
}

export function feedbackAttachmentMimeFromPath(path:string) {
  const extension=path.split('.').pop()?.toLowerCase();
  return extension&&Object.hasOwn(canonicalMime,extension)?canonicalMime[extension as keyof typeof canonicalMime]:null;
}
