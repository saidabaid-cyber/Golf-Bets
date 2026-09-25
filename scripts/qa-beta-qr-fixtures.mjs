// Synthetic, non-PII gallery fixtures. No screenshots or local user files.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import QRCode from 'qrcode';
import {createCanvas} from '@napi-rs/canvas';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {publicPreviewConfig} from './lib/qa-public-preview.mjs';
import {credentialBoundFetch,verifyPreviewBundleBinding} from './qa-preview-statistics.mjs';
const config=publicPreviewConfig(process.env);assert.equal(config.projectRef,'bymeopxkxapfizeeqeyb');
const appFetch=credentialBoundFetch(config.previewOrigin),databaseFetch=credentialBoundFetch(config.supabaseOrigin);
await verifyPreviewBundleBinding(config,appFetch,databaseFetch);
const origin=config.previewOrigin,generatedAt=new Date().toISOString(),files=[];
mkdirSync('.qa-artifacts',{recursive:true});
for(const [name,id] of [['self','9eb8241b-a51a-4dab-af8b-42af461c0c93'],['friend','efc464f8-0728-4bfc-9e0f-5674c84cb984']]) {
  const file=`.qa-artifacts/beta-qr-${name}.png`;
  await QRCode.toFile(file,`${origin}/?friend=${id}`,{width:420,margin:4});files.push({kind:name,file,payloadOrigin:origin});
}
const c=createCanvas(420,420),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,420,420);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC QA - NOT A QR',20,200);
const invalidFile='.qa-artifacts/beta-qr-invalid.png';writeFileSync(invalidFile,c.toBuffer('image/png'));files.push({kind:'invalid',file:invalidFile,payloadOrigin:null});
const manifest={schema:'backyard-qr-qa-fixtures-v1',generatedAt,generatedDate:generatedAt.slice(0,10),previewOrigin:origin,projectRef:config.projectRef,buildSha:config.expectedSha,healthAndBundleBindingVerified:true,syntheticOnly:true,files:files.map(item=>({...item,sha256:createHash('sha256').update(readFileSync(item.file)).digest('hex')}))};
writeFileSync('.qa-artifacts/beta-qr-fixtures-manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({generated:files.length,manifest:'.qa-artifacts/beta-qr-fixtures-manifest.json',buildSha:config.expectedSha,generatedAt}));
