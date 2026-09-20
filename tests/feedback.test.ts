import test from 'node:test';
import assert from 'node:assert/strict';
import {validateFeedback,feedbackMailto,feedbackMessage,type FeedbackInput} from '../lib/feedback';
const valid:FeedbackInput={category:'GENERAL',description:'Sugerencia sintética QA',name:'',replyEmail:'qa@example.invalid',city:'',state:'',brand:'',model:'',rules:''};
test('feedback validates category and complete content',()=>{assert.equal(validateFeedback(valid).ok,true);for(const patch of [{category:'other'},{description:''},{replyEmail:'bad'},{replyEmail:'qa@example.invalid\r\nBcc: bad@example.invalid'},{description:'x'.repeat(2001)}])assert.equal(validateFeedback({...valid,...patch}).ok,false);});
test('field requests require name city state',()=>{assert.equal(validateFeedback({...valid,category:'COURSE'}).ok,false);assert.equal(validateFeedback({...valid,category:'COURSE',name:'Campo QA',city:'Puebla',state:'Puebla'}).ok,true);});
for(const category of ['CLUB','BALL','SHAFT'] as const)test(`${category} requests require brand and model`,()=>{assert.equal(validateFeedback({...valid,category,name:'Equipo QA'}).ok,false);assert.equal(validateFeedback({...valid,category,name:'Equipo QA',brand:'Declarada',model:'Declarado'}).ok,true);});
test('mailto only opens an encoded draft to the intended recipient',()=>{const url=new URL(feedbackMailto({...valid,description:'Texto con & ? # y caracteres á'}));assert.equal(url.protocol,'mailto:');assert.equal(url.pathname,'contacto@thebackyard.com.mx');assert.ok(url.searchParams.get('body')?.includes('Texto con & ? # y caracteres á'));assert.equal(url.searchParams.get('bcc'),null);});
test('subject disallows injected mail headers',()=>assert.ok(!/[\r\n]/.test(feedbackMessage({...valid,name:'x\r\ny'}).subject)));
