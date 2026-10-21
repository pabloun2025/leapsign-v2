export type AdminUser={id:string;email:string;status:'active'|'suspended'|'unconfirmed';createdAt:string;lastSignInAt:string|null};
export interface AdminDependencies{
 authenticateAdministrator(request:Request):Promise<string|null>;
 listUsers(page:number,search:string):Promise<{users:AdminUser[];page:number;total:number}>;
 invite(email:string):Promise<string>;
 resend?(targetId:string):Promise<void>;
 recover(targetId:string):Promise<void>;
 suspend(targetId:string):Promise<void>;
 reactivate(targetId:string):Promise<void>;
 audit(page:number):Promise<unknown[]>;
 recordAudit(administratorId:string,action:'invite'|'resend_invitation'|'recovery'|'suspend'|'reactivate',targetId?:string,targetEmail?:string):Promise<void>;
}
const safeHeaders={'Cache-Control':'no-store','Content-Type':'application/json','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:safeHeaders});
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;const emailPattern=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
async function exactBody(request:Request,keys:string[]){if(request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')throw Error();const text=await request.text();if(text.length>1024)throw Error();const value:unknown=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join(',')!==[...keys].sort().join(','))throw Error();return value as Record<string,unknown>;}

export function createAdminHandler(deps:AdminDependencies,origin:string){return async(request:Request):Promise<Response>=>{
 const url=new URL(request.url);if(url.origin!==origin||request.headers.get('X-LeapSign-Client')!=='v2')return json({code:'NOT_FOUND'},404);
 const administrator=await deps.authenticateAdministrator(request);if(!administrator)return json({code:'FORBIDDEN'},403);
 const mutating=request.method==='POST';if(mutating&&(request.headers.get('Origin')!==origin||(request.headers.has('Sec-Fetch-Site')&&request.headers.get('Sec-Fetch-Site')!=='same-origin')))return json({code:'FORBIDDEN'},403);
 try{
  if(url.pathname==='/api/v2/admin/users'&&request.method==='GET'){
   if([...url.searchParams.keys()].some(key=>!['page','search'].includes(key)))throw Error();const page=Number(url.searchParams.get('page')??'1');const search=(url.searchParams.get('search')??'').trim().toLowerCase();if(!Number.isInteger(page)||page<1||page>10000||search.length>254)throw Error();return json(await deps.listUsers(page,search));
  }
  if(url.pathname==='/api/v2/admin/audit'&&request.method==='GET'){const page=Number(url.searchParams.get('page')??'1');if(!Number.isInteger(page)||page<1)return json({code:'INVALID_REQUEST'},400);return json({events:await deps.audit(page),page});}
  if(url.pathname==='/api/v2/admin/invitations'&&mutating){const body=await exactBody(request,['email']);const email=String(body.email??'').trim().toLowerCase();if(!emailPattern.test(email)||email.length>254)throw Error();const target=await deps.invite(email);if(!uuid.test(target))throw Error();await deps.recordAudit(administrator,'invite',target,email);return json({code:'ACCEPTED'},202);}
  const match=/^\/api\/v2\/admin\/users\/([a-f0-9-]{36})\/(resend|recover|suspend|reactivate)$/.exec(url.pathname);
  if(match&&mutating){await exactBody(request,[]);const target=match[1];if(!uuid.test(target)||target===administrator)throw Error();const action=match[2] as 'resend'|'recover'|'suspend'|'reactivate';if(action==='resend'){if(!deps.resend)throw Error();await deps.resend(target);}else await deps[action](target);const auditAction=action==='resend'?'resend_invitation':action==='recover'?'recovery':action;await deps.recordAudit(administrator,auditAction,target);return json({code:'ACCEPTED'},202);}
  return json({code:'NOT_FOUND'},404);
 }catch{return json({code:'INVALID_REQUEST'},400);}
};}
