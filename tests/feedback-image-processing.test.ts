import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import test from 'node:test';
import { createCanvas,loadImage } from '@napi-rs/canvas';
import { FEEDBACK_ATTACHMENT_MAX_BYTES,FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES } from '../lib/feedback';
import { feedbackAttachmentType } from '../lib/feedback-attachment';
import { feedbackJpegOrientation,prepareFeedbackImage,type FeedbackDecodedImage,type FeedbackImageOptions } from '../lib/feedback-image.client';

function fileFrom(bytes:Uint8Array,name:string,type:string) {
  return Object.assign(new Blob([bytes],{type}),{name,lastModified:Date.now()}) as File;
}

const imageOptions:FeedbackImageOptions={
  decode:async(file)=>{
    const image=await loadImage(Buffer.from(await file.arrayBuffer()));
    return {source:image as unknown as FeedbackDecodedImage['source'],width:image.width,height:image.height,release:()=>{}};
  },
  createCanvas:()=>{
    const canvas=createCanvas(1,1);
    return Object.assign(canvas,{toBlob(callback:(blob:Blob|null)=>void,type?:string,quality?:number){
      if(type!=='image/jpeg'){callback(null);return;}
      callback(new Blob([canvas.toBuffer('image/jpeg',Math.round((quality??.82)*100))],{type:'image/jpeg'}));
    }}) as unknown as HTMLCanvasElement;
  },
};

function noisyImage(width:number,height:number,type:'image/jpeg'|'image/png') {
  const canvas=createCanvas(width,height),context=canvas.getContext('2d'),pixels=context.createImageData(width,height);
  randomFillSync(pixels.data);
  for(let index=0;index<pixels.data.length;index+=4) {
    pixels.data[index+3]=255;
  }
  context.putImageData(pixels,0,0);
  context.fillStyle='#ffffff';context.font='bold 96px sans-serif';context.fillText('BACKYARD QA',80,130);
  return type==='image/png'?canvas.toBuffer('image/png'):canvas.toBuffer('image/jpeg',100);
}

function jpegWithExifOrientation6(jpeg:Buffer) {
  const app1=Buffer.from([0xff,0xe1,0x00,0x22,0x45,0x78,0x69,0x66,0,0,0x49,0x49,0x2a,0,8,0,0,0,1,0,0x12,0x01,3,0,1,0,0,0,6,0,0,0,0,0,0,0]);
  return Buffer.concat([jpeg.subarray(0,2),app1,jpeg.subarray(2)]);
}

test('a normal phone-size JPEG above 2 MB is optimized below the final target and remains valid',async()=>{
  const source=noisyImage(2_800,2_100,'image/jpeg');
  assert.ok(source.length>2*1024*1024,`fixture must exercise the former 2 MB rejection (${source.length})`);
  assert.ok(source.length<=FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES);
  const result=await prepareFeedbackImage(fileFrom(source,'iphone-large.jpg','image/jpeg'),imageOptions);
  assert.equal(result.optimized,true);
  assert.ok(result.optimizedBytes<=FEEDBACK_ATTACHMENT_MAX_BYTES);
  assert.ok(Math.max(result.width,result.height)<=1_920);
  assert.equal(feedbackAttachmentType(result.mime,Buffer.from(result.data,'base64')),'jpeg');
});

test('a large PNG is converted and compressed through the same bounded pipeline',async()=>{
  const source=noisyImage(2_000,1_500,'image/png');
  assert.ok(source.length>FEEDBACK_ATTACHMENT_MAX_BYTES);
  const result=await prepareFeedbackImage(fileFrom(source,'captura-grande.png','image/png'),imageOptions);
  assert.equal(result.mime,'image/jpeg');
  assert.match(result.name,/\.jpeg$/);
  assert.ok(result.optimizedBytes<=FEEDBACK_ATTACHMENT_MAX_BYTES);
});

test('a small, correctly oriented image is kept byte-for-byte instead of degraded',async()=>{
  const canvas=createCanvas(800,600),context=canvas.getContext('2d');
  context.fillStyle='#fafafa';context.fillRect(0,0,800,600);context.fillStyle='#111';context.font='bold 52px sans-serif';context.fillText('SCORECARD 72',90,290);
  const source=canvas.toBuffer('image/jpeg',88);
  const result=await prepareFeedbackImage(fileFrom(source,'small.jpg','image/jpeg'),imageOptions);
  assert.equal(result.optimized,false);
  assert.equal(result.width,800);assert.equal(result.height,600);
  assert.deepEqual(Buffer.from(result.data,'base64'),source);
});

test('EXIF orientation is normalized exactly once in the optimized derivative',async()=>{
  const canvas=createCanvas(160,80),context=canvas.getContext('2d');
  context.fillStyle='#f00';context.fillRect(0,0,80,80);context.fillStyle='#00f';context.fillRect(80,0,80,80);
  const source=jpegWithExifOrientation6(canvas.toBuffer('image/jpeg',92));
  assert.equal(feedbackJpegOrientation(source),6);
  const result=await prepareFeedbackImage(fileFrom(source,'rotated.jpg','image/jpeg'),imageOptions);
  assert.equal(result.optimized,true);
  assert.deepEqual([result.width,result.height],[80,160]);
  const output=await loadImage(Buffer.from(result.data,'base64'));
  const rendered=createCanvas(80,160),renderedContext=rendered.getContext('2d');renderedContext.drawImage(output,0,0);
  const top=renderedContext.getImageData(40,20,1,1).data,bottom=renderedContext.getImageData(40,140,1,1).data;
  assert.ok(top[0]>top[2]*2);assert.ok(bottom[2]>bottom[0]*2);
});

test('scorecard text and grid retain strong contrast after downscaling',async()=>{
  const canvas=createCanvas(2_400,1_600),context=canvas.getContext('2d');
  context.fillStyle='#fff';context.fillRect(0,0,2_400,1_600);
  context.strokeStyle='#111';context.lineWidth=10;
  for(let x=100;x<=2_300;x+=220){context.beginPath();context.moveTo(x,200);context.lineTo(x,1_400);context.stroke();}
  for(let y=200;y<=1_400;y+=200){context.beginPath();context.moveTo(100,y);context.lineTo(2_300,y);context.stroke();}
  context.fillStyle='#111';context.font='bold 100px sans-serif';context.fillText('HOLE 1 2 3 4  SCORE 72',120,150);
  const source=canvas.toBuffer('image/png');
  const result=await prepareFeedbackImage(fileFrom(source,'scorecard.png','image/png'),imageOptions);
  const output=await loadImage(Buffer.from(result.data,'base64'));
  const rendered=createCanvas(output.width,output.height),renderedContext=rendered.getContext('2d');renderedContext.drawImage(output,0,0);
  const pixels=renderedContext.getImageData(0,0,output.width,output.height).data;
  let dark=0,bright=0;
  for(let i=0;i<pixels.length;i+=4){const luminance=(pixels[i]+pixels[i+1]+pixels[i+2])/3;if(luminance<55)dark++;if(luminance>235)bright++;}
  assert.ok(dark>5_000,'grid and glyph strokes remain dark');
  assert.ok(bright>output.width*output.height*.7,'white scorecard background remains readable');
});

test('invalid and exaggerated files are rejected before upload with controlled errors',async()=>{
  await assert.rejects(()=>prepareFeedbackImage(fileFrom(new TextEncoder().encode('<svg/>'),'fake.png','image/png'),imageOptions),/imagen JPEG, PNG o WebP válida/);
  const huge={size:FEEDBACK_ATTACHMENT_MAX_ORIGINAL_BYTES+1,name:'huge.jpg',type:'image/jpeg'} as File;
  await assert.rejects(()=>prepareFeedbackImage(huge,imageOptions),/image_size/);
});

test('HEIC is explicitly blocked when no reliable decoder pipeline is configured',async()=>{
  const header=Buffer.alloc(32);header.writeUInt32BE(24,0);header.write('ftyp',4,'ascii');header.write('heic',8,'ascii');header.writeUInt32BE(0,12);header.write('heic',16,'ascii');
  await assert.rejects(()=>prepareFeedbackImage(fileFrom(header,'iphone.heic','image/heic'),imageOptions),/HEIC\/HEIF no se puede procesar de forma fiable/);
});
