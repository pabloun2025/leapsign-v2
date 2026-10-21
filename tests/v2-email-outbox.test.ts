import {describe,expect,it,vi} from 'vitest';
import {processOutboxBatch,verifyResendWebhook,renderEmail} from '../server/v2/email-outbox';

describe('v2 transactional email outbox',()=>{
 it('escapes user content and emits LeapSign HTML plus plain text without attachments',()=>{
  const message=renderEmail({kind:'signer_turn',recipient:'signer@example.test',data:{documentName:'<img src=x onerror=alert(1)>',actionUrl:'https://pruebas.leapsign.app/firmar/opaque_token'}});
  expect(message.html).toContain('&lt;img src=x onerror=alert(1)&gt;');expect(message.html).not.toContain('<img src=x onerror');
  expect(message.text).toContain('https://pruebas.leapsign.app/firmar/opaque_token');expect(message).not.toHaveProperty('attachments');
  expect(message.from).toBe('LeapSign <no-reply@notificaciones.leapsign.app>');expect(message.replyTo).toBe('soporte@leapsign.app');
 });
 it('marks a unique job sent once and records only the provider id',async()=>{
  const job={id:'1',kind:'signer_turn' as const,recipient:'signer@example.test',data:{documentName:'Contrato.pdf',actionUrl:'https://pruebas.leapsign.app/firmar/opaque'},attempts:0};
  const claim=vi.fn(async()=>[job]);const sent=vi.fn();const failed=vi.fn();const deliver=vi.fn(async()=>({id:'re_123'}));
  await processOutboxBatch({claim,markSent:sent,markFailed:failed,deliver},'server-secret');
  expect(deliver).toHaveBeenCalledOnce();expect(sent).toHaveBeenCalledWith('1','re_123');expect(failed).not.toHaveBeenCalled();
  expect(JSON.stringify(sent.mock.calls)).not.toContain('opaque');
 });
 it('backs off temporary failures and never logs message bodies through persistence calls',async()=>{
  const job={id:'2',kind:'receipt' as const,recipient:'owner@example.test',data:{documentName:'Contrato.pdf',actionUrl:'https://pruebas.leapsign.app/procesos/opaque'},attempts:3};
  const markFailed=vi.fn();await processOutboxBatch({claim:async()=>[job],markSent:vi.fn(),markFailed,deliver:async()=>{throw Error('provider detail must not persist');}},'server-secret');
  expect(markFailed).toHaveBeenCalledWith('2',4,false,expect.any(String));expect(JSON.stringify(markFailed.mock.calls)).not.toContain('provider detail');expect(JSON.stringify(markFailed.mock.calls)).not.toContain('opaque');
 });
 it('rejects invalid webhook signatures before processing provider events',async()=>{
  await expect(verifyResendWebhook(new TextEncoder().encode('{"type":"email.bounced"}'),{id:'msg',timestamp:'1',signature:'v1,bad'},'whsec_'+Buffer.from('secret').toString('base64'))).resolves.toBe(false);
 });
 it('accepts a current Svix signature generated with the configured webhook secret',async()=>{const body=new TextEncoder().encode('{"type":"email.delivered"}');const id='msg_123',timestamp='1792587600',key=new TextEncoder().encode('webhook-secret');const signed=new Uint8Array(new TextEncoder().encode(`${id}.${timestamp}.`).length+body.length);const prefix=new TextEncoder().encode(`${id}.${timestamp}.`);signed.set(prefix);signed.set(body,prefix.length);const cryptoKey=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',cryptoKey,signed)).toString('base64');await expect(verifyResendWebhook(body,{id,timestamp,signature:`v1,${signature}`},'whsec_'+Buffer.from(key).toString('base64'),Number(timestamp)*1000)).resolves.toBe(true);});
});
