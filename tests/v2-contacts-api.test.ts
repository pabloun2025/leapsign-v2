import {describe,expect,it,vi} from 'vitest';
import {createContactsHandler,type ContactsDependencies} from '../server/v2/contacts-api';
import {normalizeContactEmail,validateContactDrafts} from '../server/v2/contacts-domain';

const origin='https://pruebas.leapsign.app';
const owner='11111111-1111-4111-8111-111111111111';
const contactId='22222222-2222-4222-8222-222222222222';

function fixture(){
 const deps:ContactsDependencies={authenticate:vi.fn(async()=>owner),reserve:vi.fn(async()=>{}),list:vi.fn(async()=>[{id:contactId,email:'ana@example.test',displayName:'Ana',usageCount:2,lastUsedAt:null}]),upsert:vi.fn(async input=>({id:contactId,email:input.email,displayName:input.displayName,usageCount:0,lastUsedAt:null})),remove:vi.fn(async()=>{})};
 return{deps,handle:createContactsHandler(deps,origin)};
}

describe('v2 contact domain',()=>{
 it('normalizes case and surrounding whitespace',()=>{expect(normalizeContactEmail('  PERSON@Example.TEST ')).toBe('person@example.test');});
 it('rejects duplicate Unicode/case variants and remaining-capacity overflow',()=>{expect(validateContactDrafts([{email:'Á@example.test'},{email:'A\u0301@EXAMPLE.test'}],20)).toEqual({ok:false,code:'DUPLICATE_CONTACT'});expect(validateContactDrafts([{email:'a@example.test'},{email:'b@example.test'}],1)).toEqual({ok:false,code:'CAPACITY_EXCEEDED'});});
});

describe('v2 contacts API',()=>{
 it('lists only through an authenticated same-origin client',async()=>{const f=fixture();const response=await f.handle(new Request(origin+'/api/v2/contacts',{headers:{'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(await response.json()).toEqual({contacts:[{id:contactId,email:'ana@example.test',displayName:'Ana',usageCount:2,lastUsedAt:null}]});expect(f.deps.list).toHaveBeenCalledWith(owner);});
 it('creates a normalized contact with an economic reservation',async()=>{const f=fixture();const response=await f.handle(new Request(origin+'/api/v2/contacts',{method:'POST',headers:{Origin:origin,'Sec-Fetch-Site':'same-origin','X-LeapSign-Client':'v2','Content-Type':'application/json'},body:JSON.stringify({email:' ANA@EXAMPLE.TEST ',displayName:'Ana'})}));expect(response.status).toBe(201);expect(f.deps.upsert).toHaveBeenCalledWith({ownerId:owner,id:null,email:'ana@example.test',displayName:'Ana'});expect(f.deps.reserve).toHaveBeenCalledWith(owner,'contacts');});
 it('rejects cross-origin mutation before repository work',async()=>{const f=fixture();const response=await f.handle(new Request(origin+'/api/v2/contacts',{method:'POST',headers:{Origin:'https://evil.invalid','X-LeapSign-Client':'v2','Content-Type':'application/json'},body:'{}'}));expect(response.status).toBe(403);expect(f.deps.upsert).not.toHaveBeenCalled();});
 it('deletes only a validated contact id owned by the session',async()=>{const f=fixture();const response=await f.handle(new Request(`${origin}/api/v2/contacts/${contactId}`,{method:'DELETE',headers:{Origin:origin,'X-LeapSign-Client':'v2'}}));expect(response.status).toBe(200);expect(f.deps.remove).toHaveBeenCalledWith(owner,contactId);});
});
