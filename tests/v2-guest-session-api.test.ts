import {describe,expect,it,vi} from 'vitest';
import {createGuestSessionHandler} from '../server/v2/guest-session-api';

const origin='https://pruebas.leapsign.app';
const invitation='invite_'+ 'a'.repeat(43);
const actor='11111111-1111-4111-8111-111111111111';
const documentId='22222222-2222-4222-8222-222222222222';

describe('v2 guest invitation exchange',()=>{
 it('consumes an opaque invitation once and returns only a strict guest cookie and destination',async()=>{
  const exchange=vi.fn(async()=>({actorId:actor,documentId,email:'signer@example.test',expiresAt:'2026-10-22T12:00:00.000Z'}));
  const handler=createGuestSessionHandler({exchange,randomBytes:()=>new Uint8Array(32).fill(7)},origin);
  const response=await handler(new Request(origin+'/api/v2/guest-session',{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({invitation})}));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({code:'GUEST_SIGNED_IN',actorId:actor,documentId,email:'signer@example.test'});
  expect(response.headers.get('Set-Cookie')).toMatch(/^__Host-leapsign-v2-guest=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Strict; Max-Age=/);
  expect(exchange).toHaveBeenCalledWith(expect.stringMatching(/^[a-f0-9]{64}$/),expect.stringMatching(/^[a-f0-9]{64}$/),expect.any(AbortSignal));
  expect(JSON.stringify(exchange.mock.calls)).not.toContain(invitation);
 });
 it('rejects malformed or cross-origin exchanges without touching storage',async()=>{
  const exchange=vi.fn();const handler=createGuestSessionHandler({exchange},origin);
  const malformed=new Request(origin+'/api/v2/guest-session',{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({invitation:'short'})});
  expect((await handler(malformed)).status).toBe(400);
  const cross=new Request(origin+'/api/v2/guest-session',{method:'POST',headers:{Origin:'https://evil.invalid','X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({invitation})});
  expect((await handler(cross)).status).toBe(403);expect(exchange).not.toHaveBeenCalled();
 });
 it('normalizes expired and reused invitations without disclosing which condition occurred',async()=>{
  const handler=createGuestSessionHandler({exchange:async()=>null},origin);
  const response=await handler(new Request(origin+'/api/v2/guest-session',{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({invitation})}));
  expect(response.status).toBe(410);expect(await response.json()).toEqual({code:'INVITATION_UNAVAILABLE'});expect(response.headers.get('Set-Cookie')).toBeNull();
 });
 it('stops reading an oversized streamed body without calling the exchange',async()=>{const exchange=vi.fn();const handler=createGuestSessionHandler({exchange},origin);const body=new ReadableStream({start(controller){controller.enqueue(new Uint8Array(513));controller.close();}});const response=await handler(new Request(origin+'/api/v2/guest-session',{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2','Content-Type':'application/json'},body,duplex:'half'} as RequestInit));expect(response.status).toBe(400);expect(exchange).not.toHaveBeenCalled();});
});
