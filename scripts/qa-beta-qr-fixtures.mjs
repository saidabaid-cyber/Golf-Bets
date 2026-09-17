// Synthetic, non-PII gallery fixtures. No screenshots or local user files.
import QRCode from 'qrcode';
import {createCanvas} from '@napi-rs/canvas';
import {writeFileSync} from 'node:fs';
const origin='https://golf-bets-git-phase2-full-platform-saha8.vercel.app';
for(const [name,id] of [['self','9eb8241b-a51a-4dab-af8b-42af461c0c93'],['friend','efc464f8-0728-4bfc-9e0f-5674c84cb984']]) {
  await QRCode.toFile(`.qa-artifacts/beta-qr-${name}.png`,`${origin}/?friend=${id}`,{width:420,margin:4});
}
const c=createCanvas(420,420),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,420,420);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('SYNTHETIC QA - NOT A QR',20,200);
writeFileSync('.qa-artifacts/beta-qr-invalid.png',c.toBuffer('image/png'));
console.log('Three synthetic gallery fixtures generated; no personal data or secrets.');
