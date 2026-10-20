import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {signWithLocalEngine} from '../../../src/v2/local-session';
import type {SigningFlags} from '../../../src/v2/policy';
import {FunctionalApp} from './FunctionalApp';
import {FunctionalV2Client} from './functional-client';
import {parseAppRoute} from './model';
import {createSupabaseAuthPort} from './supabase-auth';
import './functional.css';

type PublicConfig={origin:string;supabaseUrl:string;publishableKey:string;flags:SigningFlags};
const root=createRoot(document.getElementById('root')!);
const failed=()=>root.render(<main className="boot-error"><span aria-hidden="true">🐸</span><h1>LeapSign no está disponible</h1><p>No se pudo cargar la configuración segura de v2. Inténtalo de nuevo más tarde.</p></main>);

async function start(){
 try{
  const response=await fetch('/api/v2/config',{credentials:'same-origin',cache:'no-store',redirect:'error',headers:{Accept:'application/json','X-LeapSign-Client':'v2'},signal:AbortSignal.timeout(8_000)});
  if(!response.ok||response.redirected||response.headers.get('Content-Type')?.split(';')[0]!=='application/json')throw Error();
  const value:unknown=await response.json();
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!=='flags,origin,publishableKey,supabaseUrl')throw Error();
  const config=value as PublicConfig;
  if(config.origin!==location.origin||config.supabaseUrl!=='https://lbreydchhskrrmpzniem.supabase.co'||typeof config.publishableKey!=='string'||!config.publishableKey||!config.flags||typeof config.flags!=='object')throw Error();
  const dependencies={origin:config.origin,client:new FunctionalV2Client({origin:config.origin}),auth:createSupabaseAuthPort({url:config.supabaseUrl,publishableKey:config.publishableKey}),localSigner:signWithLocalEngine,signingFlags:config.flags};
  root.render(<StrictMode><FunctionalApp dependencies={dependencies} route={parseAppRoute(location.pathname)}/></StrictMode>);
 }catch{failed();}
}
void start();
