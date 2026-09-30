import {
  FEEDBACK_ATTACHMENT_MAX_BYTES,
  FEEDBACK_ATTACHMENT_MAX_DIMENSION,
  FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES,
  FEEDBACK_ATTACHMENT_SOFT_TARGET_BYTES,
} from './feedback';
import { feedbackAttachmentType,feedbackOriginalAttachmentType,type FeedbackAttachment } from './feedback-attachment';

const DECODE_TIMEOUT_MS=15_000;
const ENCODE_TIMEOUT_MS=15_000;
const HEADER_BYTES=256*1024;
const MAX_IMAGE_PIXELS=80_000_000;

type DrawableImage=CanvasImageSource&{width:number;height:number;close?:()=>void};
export type FeedbackDecodedImage={source:DrawableImage;width:number;height:number;release:()=>void};
export type FeedbackImageOptions={
  decode?:(file:File)=>Promise<FeedbackDecodedImage>;
  createCanvas?:()=>HTMLCanvasElement;
};
export type PreparedFeedbackImage=FeedbackAttachment&{
  preview:string;
  name:string;
  originalBytes:number;
  optimizedBytes:number;
  originalWidth:number;
  originalHeight:number;
  width:number;
  height:number;
  optimized:boolean;
};

const attempts=[
  {maxDimension:1_920,quality:.86},
  {maxDimension:1_920,quality:.82},
  {maxDimension:1_760,quality:.80},
  {maxDimension:1_600,quality:.78},
  {maxDimension:1_600,quality:.74},
  {maxDimension:1_440,quality:.70},
  {maxDimension:1_280,quality:.66},
  {maxDimension:1_120,quality:.62},
  {maxDimension:960,quality:.58},
] as const;

function decodedDimensions(value:FeedbackDecodedImage) {
  return Number.isFinite(value.width)&&Number.isFinite(value.height)&&value.width>=1&&value.height>=1&&value.width*value.height<=MAX_IMAGE_PIXELS;
}

async function browserDecode(file:File):Promise<FeedbackDecodedImage> {
  if(typeof createImageBitmap==='function') {
    try {
      const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
      return {source:bitmap as DrawableImage,width:bitmap.width,height:bitmap.height,release:()=>bitmap.close()};
    } catch {
      // Safari can reject createImageBitmap while HTMLImageElement can decode
      // the same camera image and apply its EXIF orientation correctly.
    }
  }
  if(typeof Image!=='function'||!globalThis.URL?.createObjectURL)throw Error('image_open');
  const objectUrl=URL.createObjectURL(file),image=new Image();
  image.decoding='async';
  try {
    await new Promise<void>((resolve,reject)=>{
      let settled=false;
      const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);image.onload=null;image.onerror=null;action();};
      const timer=setTimeout(()=>finish(()=>reject(Error('image_open'))),DECODE_TIMEOUT_MS);
      image.onload=()=>finish(resolve);
      image.onerror=()=>finish(()=>reject(Error('image_open')));
      image.src=objectUrl;
    });
    return {source:image as DrawableImage,width:image.naturalWidth,height:image.naturalHeight,release:()=>{image.src='';URL.revokeObjectURL(objectUrl);}};
  } catch(error) {
    image.src='';URL.revokeObjectURL(objectUrl);throw error;
  }
}

function canvasBlob(canvas:HTMLCanvasElement,quality:number) {
  return new Promise<Blob>((resolve,reject)=>{
    let settled=false;
    const finish=(action:()=>void)=>{if(settled)return;settled=true;clearTimeout(timer);action();};
    const timer=setTimeout(()=>finish(()=>reject(Error('image_encode'))),ENCODE_TIMEOUT_MS);
    try {
      canvas.toBlob(blob=>finish(()=>blob?.size?resolve(blob):reject(Error('image_encode'))),'image/jpeg',quality);
    } catch {finish(()=>reject(Error('image_encode')));}
  });
}

/** Returns the EXIF orientation when a JPEG contains one. Missing or malformed
 * metadata is treated as the normal orientation; image bytes are still decoded
 * by the browser before any optimized derivative is created. */
export function feedbackJpegOrientation(bytes:Uint8Array) {
  if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)return 1;
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let offset=2;
  while(offset+4<=bytes.length) {
    if(bytes[offset]!==0xff)break;
    const marker=bytes[offset+1];
    if(marker===0xda||marker===0xd9)break;
    const length=view.getUint16(offset+2,false);
    if(length<2||offset+2+length>bytes.length)break;
    if(marker===0xe1&&length>=16) {
      const exif=offset+4;
      if(bytes[exif]===0x45&&bytes[exif+1]===0x78&&bytes[exif+2]===0x69&&bytes[exif+3]===0x66&&bytes[exif+4]===0&&bytes[exif+5]===0) {
        const tiff=exif+6;
        if(tiff+8>bytes.length)return 1;
        const little=bytes[tiff]===0x49&&bytes[tiff+1]===0x49;
        if(!little&&!(bytes[tiff]===0x4d&&bytes[tiff+1]===0x4d))return 1;
        if(view.getUint16(tiff+2,little)!==42)return 1;
        const ifd=tiff+view.getUint32(tiff+4,little);
        if(ifd+2>bytes.length)return 1;
        const count=view.getUint16(ifd,little);
        for(let index=0;index<count;index++) {
          const entry=ifd+2+index*12;
          if(entry+12>bytes.length)break;
          if(view.getUint16(entry,little)===0x0112&&view.getUint16(entry+2,little)===3&&view.getUint32(entry+4,little)>=1) {
            const orientation=view.getUint16(entry+8,little);
            return orientation>=1&&orientation<=8?orientation:1;
          }
        }
      }
    }
    offset+=2+length;
  }
  return 1;
}

function safeBaseName(name:string) {
  const stem=name.replace(/\.[^.]+$/,'').normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80);
  return stem||'backyard-feedback';
}

function bytesToBase64(bytes:Uint8Array) {
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=0x8000)binary+=String.fromCharCode(...bytes.subarray(offset,offset+0x8000));
  return btoa(binary);
}

/** The source file never leaves the device. Only the validated result returned
 * here is serialized into the support request. */
export async function prepareFeedbackImage(file:File,options:FeedbackImageOptions={}):Promise<PreparedFeedbackImage> {
  if(!file.size||file.size>FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES)throw Error('image_size');
  const header=new Uint8Array(await file.slice(0,HEADER_BYTES).arrayBuffer());
  const sourceType=feedbackOriginalAttachmentType(file.type,header,file.size);
  const decode=options.decode??browserDecode;
  const decoded=await decode(file);
  if(!decodedDimensions(decoded)){decoded.release();throw Error('image_dimensions');}
  const originalWidth=decoded.width,originalHeight=decoded.height;
  const orientation=sourceType.format==='jpeg'?feedbackJpegOrientation(header):1;
  const canKeepOriginal=file.size<=FEEDBACK_ATTACHMENT_SOFT_TARGET_BYTES&&Math.max(decoded.width,decoded.height)<=FEEDBACK_ATTACHMENT_MAX_DIMENSION&&orientation===1;
  let output:Blob=file,width=decoded.width,height=decoded.height,optimized=false;
  try {
    if(!canKeepOriginal) {
      optimized=true;
      const createCanvas=options.createCanvas??(()=>document.createElement('canvas'));
      let candidate:Blob|null=null;
      for(const attempt of attempts) {
        const scale=Math.min(1,attempt.maxDimension/Math.max(decoded.width,decoded.height));
        const canvas=createCanvas();
        canvas.width=Math.max(1,Math.round(decoded.width*scale));
        canvas.height=Math.max(1,Math.round(decoded.height*scale));
        const context=canvas.getContext('2d');
        if(!context)throw Error('image_canvas');
        context.fillStyle='#ffffff';
        context.fillRect(0,0,canvas.width,canvas.height);
        context.drawImage(decoded.source,0,0,canvas.width,canvas.height);
        candidate=await canvasBlob(canvas,attempt.quality);
        if(candidate.size<=FEEDBACK_ATTACHMENT_MAX_BYTES){output=candidate;width=canvas.width;height=canvas.height;break;}
      }
      if(!candidate||output===file)throw Error('image_encoded_size');
    }
  } finally {decoded.release();}
  const bytes=new Uint8Array(await output.arrayBuffer());
  const mime=optimized?'image/jpeg':sourceType.mime;
  const extension=feedbackAttachmentType(mime,bytes);
  const data=bytesToBase64(bytes);
  return {
    mime,data,preview:`data:${mime};base64,${data}`,name:`${safeBaseName(file.name)}.${extension}`,
    originalBytes:file.size,optimizedBytes:bytes.length,originalWidth,originalHeight,width,height,optimized,
  };
}

export function feedbackImageErrorMessage(error:unknown) {
  const message=error instanceof Error?error.message:'';
  if(message==='image_size')return 'Esta imagen es demasiado grande. Elige una imagen de hasta 20 MB.';
  if(message==='image_dimensions')return 'La imagen tiene dimensiones inválidas o demasiado grandes.';
  if(message==='image_open')return 'No pudimos abrir la imagen. Elige otra foto.';
  if(message==='image_canvas'||message==='image_encode'||message==='image_encoded_size')return 'No pudimos optimizar la imagen sin perder legibilidad. Elige otra foto.';
  return message||'No pudimos preparar la imagen. Elige otra foto.';
}
