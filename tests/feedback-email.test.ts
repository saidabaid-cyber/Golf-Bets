import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as feedback from '../lib/feedback';
import { normalizedInvitationEmail } from '../lib/group-invitations';

type Attachment={content:string;filename:string;contentType:'image/jpeg'|'image/png'|'image/webp'};
type Send=(id:string,input:feedback.FeedbackInput,context:feedback.FeedbackDeliveryContext,attachment:Attachment|undefined,options:{env:Record<string,string>;fetcher:typeof fetch})=>Promise<{messageId?:string;error?:string}>;

function emailModule() {
  const exports:{sendFeedbackEmail?:Send}={};
  runInNewContext(ts.transpileModule(readFileSync('lib/feedback-email.server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,AbortSignal,process:{env:{}},require:(name:string)=>name==='server-only'?{}:name.endsWith('/group-invitations')?{normalizedInvitationEmail}:feedback,
  });
  return exports.sendFeedbackEmail!;
}

const input:feedback.FeedbackInput={category:'BUG',name:'',description:'La pantalla no responde durante la prueba.',replyEmail:'qa-reply@example.test',city:'',state:'',brand:'',model:'',rules:'',occurred:'No abrió',expected:'Debía abrir',module:'Soporte'};
const env={FEEDBACK_RESEND_API_KEY:'synthetic-feedback-key',FEEDBACK_FROM_EMAIL:'support@example.test',VERCEL_ENV:'preview'};

test('READY attachment is included in Resend with filename, base64 content and content type',async()=>{
  const attachment:Attachment={content:Buffer.from('valid-image-bytes').toString('base64'),filename:'backyard-feedback-ABC12345.jpg',contentType:'image/jpeg'};
  let requestBody:Record<string,unknown>|undefined;
  const result=await emailModule()('11111111-1111-4111-8111-111111111111',input,{attachmentAvailable:true,environment:'QA'},attachment,{env,fetcher:(async(_url,init)=>{requestBody=JSON.parse(String(init?.body));return Response.json({id:'resend-message-with-attachment'});}) as typeof fetch});
  assert.equal(result.messageId,'resend-message-with-attachment');
  assert.deepEqual(requestBody?.attachments,[{filename:attachment.filename,content:attachment.content,content_type:'image/jpeg'}]);
  assert.deepEqual(requestBody?.to,[feedback.FEEDBACK_TO]);
  assert.deepEqual(requestBody?.cc,[feedback.FEEDBACK_DEV_CC]);
  assert.equal(requestBody?.reply_to,input.replyEmail);
  assert.match(String(requestBody?.text),/La imagen está incluida en este correo/);
});

test('request without attachment sends normally and does not invent an attachment',async()=>{
  let requestBody:Record<string,unknown>|undefined;
  const result=await emailModule()('22222222-2222-4222-8222-222222222222',input,{attachmentAvailable:false},undefined,{env,fetcher:(async(_url,init)=>{requestBody=JSON.parse(String(init?.body));return Response.json({id:'resend-message-without-attachment'});}) as typeof fetch});
  assert.equal(result.messageId,'resend-message-without-attachment');
  assert.equal('attachments' in (requestBody??{}),false);
  assert.match(String(requestBody?.text),/Adjunto: No\./);
});

test('READY record without retrievable bytes fails closed before contacting Resend',async()=>{
  let calls=0;
  const result=await emailModule()('33333333-3333-4333-8333-333333333333',input,{attachmentAvailable:true},undefined,{env,fetcher:(async()=>{calls++;return Response.json({id:'must-not-send'});}) as typeof fetch});
  assert.equal(result.error,'ATTACHMENT_UNAVAILABLE');
  assert.equal(result.messageId,undefined);
  assert.equal(calls,0);
});
