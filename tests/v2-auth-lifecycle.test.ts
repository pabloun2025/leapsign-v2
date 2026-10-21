import {describe,expect,it,vi} from 'vitest';
import {createSupabaseAuthPort,type SupabaseAuthClient} from '../v2/preview/ui/supabase-auth';

const origin='https://pruebas.leapsign.app';
const user={id:'11111111-1111-4111-8111-111111111111',email:'owner@example.test'};
const session={access_token:'a'.repeat(40)};

function fixture(){
 let callback:(event:string,session:unknown)=>void=()=>{};
 const unsubscribe=vi.fn();
 const client={auth:{
  signInWithPassword:vi.fn(),signUp:vi.fn(async()=>({data:{},error:null})),
  resetPasswordForEmail:vi.fn(),getSession:vi.fn(async()=>({data:{session:{...session,user}},error:null})),
  updateUser:vi.fn(),signOut:vi.fn(async()=>({error:null})),
  onAuthStateChange:vi.fn((next:(event:string,session:unknown)=>void)=>{callback=next;return{data:{subscription:{unsubscribe}}};}),
 }} as unknown as SupabaseAuthClient;
 const factory=vi.fn(()=>client);
 const auth=createSupabaseAuthPort({url:'https://project.supabase.co',publishableKey:'public'},factory);
 return{auth,client,factory,unsubscribe,emit:(event:string,value:unknown)=>callback(event,value)};
}

describe('v2 owner account lifecycle',()=>{
 it('registers with the exact confirmation origin and approved profile fields',async()=>{
  const f=fixture();
  await f.auth.signUp({email:' OWNER@example.test ',password:'Correct-Horse-123!',firstName:'Ana',lastName:'Pérez'},origin+'/confirmar');
  expect(f.client.auth.signUp).toHaveBeenCalledWith({email:'owner@example.test',password:'Correct-Horse-123!',options:{emailRedirectTo:origin+'/confirmar',data:{first_name:'Ana',last_name:'Pérez',full_name:'Ana Pérez'}}});
 });
 it('keeps refresh in memory, restores a valid session and closes it at both boundaries',async()=>{
  const f=fixture();
  await expect(f.auth.restore()).resolves.toEqual({...user,accessToken:session.access_token});
  const listener=vi.fn();const stop=f.auth.subscribe(listener);
  f.emit('TOKEN_REFRESHED',{...session,user});
  expect(listener).toHaveBeenCalledWith({...user,accessToken:session.access_token},'TOKEN_REFRESHED');
  await f.auth.signOut();stop();
  expect(f.client.auth.signOut).toHaveBeenCalledOnce();expect(f.unsubscribe).toHaveBeenCalledOnce();
  expect(f.factory).toHaveBeenCalledWith('https://project.supabase.co','public',{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:true}});
 });
 it('normalizes confirmation/recovery failures and rejects unsafe redirects',async()=>{
  const f=fixture();
  await expect(f.auth.signUp({email:'owner@example.test',password:'short',firstName:'Ana',lastName:'Pérez'},origin+'/confirmar')).rejects.toMatchObject({code:'REGISTRATION'});
  await expect(f.auth.signUp({email:'owner@example.test',password:'Correct-Horse-123!',firstName:'Ana',lastName:'Pérez'},'https://attacker.invalid/confirmar')).rejects.toMatchObject({code:'REGISTRATION'});
  expect(f.client.auth.signUp).not.toHaveBeenCalled();
 });
});
