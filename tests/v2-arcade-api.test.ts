import {describe,expect,it,vi} from 'vitest';import {createArcadeHandler,type ArcadeDependencies} from '../server/v2/arcade-api';
const origin='https://pruebas.leapsign.app',token='A'.repeat(43);
function fixture(){const deps:ArcadeDependencies={clientKey:vi.fn(async()=> 'a'.repeat(64)),randomToken:()=>token,digest:vi.fn(async()=> 'b'.repeat(64)),start:vi.fn(async()=>({runId:'11111111-1111-4111-8111-111111111111',seed:7,expiresAt:'2026-10-22T12:00:00Z'})),finish:vi.fn(async()=>({alias:'Rana',score:200,createdAt:'2026-10-22T11:00:00Z'})),leaderboard:vi.fn(async()=>[])};return{deps,handle:createArcadeHandler(deps,origin)};}
describe('v2 arcade API',()=>{
 it('issues one opaque ticket',async()=>{const f=fixture();const r=await f.handle(new Request(`${origin}/api/v2/arcade/start`,{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2'}}));expect(r.status).toBe(201);expect(await r.json()).toMatchObject({ticket:token,seed:7});});
 it('submits replayable input timing rather than a client score',async()=>{const f=fixture();const r=await f.handle(new Request(`${origin}/api/v2/arcade/finish`,{method:'POST',headers:{Origin:origin,'X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({ticket:token,alias:'Rana',inputs:[0,80,160]})}));expect(r.status).toBe(201);expect(f.deps.finish).toHaveBeenCalledWith(expect.objectContaining({score:200}));});
});
