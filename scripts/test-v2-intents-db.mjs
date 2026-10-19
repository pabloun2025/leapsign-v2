// Isolated PostgreSQL WASM checks. No remote database, credentials or users.
// PGlite serializes its connection: this is NOT a multi-process concurrency test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();let count=0;
const q=(sql,args=[])=>db.query(sql,args);
const rejects=async(action,pattern)=>{await assert.rejects(action,pattern);count++;};
try {
 await db.exec(readFileSync(new URL('../v2/migrations/001_intents.sql',import.meta.url),'utf8'));
 const doc=randomUUID(),v0=randomUUID(),s1=randomUUID(),s2=randomUUID(),owner=randomUUID(),a=randomUUID(),b=randomUUID();
 await q("insert into signing_v2.documents values($1,$2,null,null,'draft')",[doc,owner]);
 await q("insert into signing_v2.versions(id,document_id,sha256,storage_path,byte_size,signature_count,page_count,last_page_width,last_page_height) values($1,$2,$3,'synthetic.pdf',100,0,2,595,842)",[v0,doc,'a'.repeat(64)]);
 await q('insert into signing_v2.stages(id,document_id,ordinal,signer_id,role) values($1,$2,1,$3,\'approval\'),($4,$2,2,$5,\'approval\')',[s1,doc,a,s2,b]);
 await q("update signing_v2.documents set current_version_id=$1,active_stage_id=$2,status='ready_for_signer' where id=$3",[v0,s1,doc]);
 const position={page:2,x:320,y:20,width:250,height:80};
 const issue=(actor=a,id=randomUUID())=>q('select * from signing_v2.issue_intent($1,$2,$3,$4,$5,$6)',[doc,actor,id,'b'.repeat(64),position,randomUUID()]);
 await rejects(()=>issue(),/V2_DISABLED/);
 await q('update signing_v2.settings set external_enabled=true,profile_enabled=true');
 await rejects(()=>issue(b),/NOT_YOUR_TURN/);
 const i=(await issue()).rows[0];
 await rejects(()=>issue(),/one_pending_intent_per_stage/);
 const claim=(actor=a,hash='c'.repeat(64),nonce='b'.repeat(64))=>q('select * from signing_v2.claim_intent($1,$2,$3,$4)',[i.id,actor,nonce,hash]);
 await rejects(()=>claim(b),/UNAUTHORIZED/);
 await rejects(()=>claim(a,'c'.repeat(64),'d'.repeat(64)),/UNAUTHORIZED/);
 const contested=await Promise.allSettled([claim(),claim()]);
 assert.equal(contested.filter(x=>x.status==='fulfilled').length,1);count++;
 assert.equal(contested.filter(x=>x.status==='rejected').length,1);count++;
 const report={valid:true,policy:'leapsign-v2-strict-offline-1',baseSha256:'a'.repeat(64),signedSha256:'c'.repeat(64),previousSignatureCount:0,signatureCount:1,revocation:'good',certificate:{subject:'TEST',issuer:'TEST',serial:'1',fingerprint:'d'.repeat(64),notBefore:'2026-10-18',notAfter:'2026-10-20'}};
 const version=randomUUID();
 const commit=(r=report)=>q('select signing_v2.commit_validated($1,$2,$3,200,$4)',[i.id,'c'.repeat(64),version,r]);
 await rejects(()=>commit({...report,valid:false}),/SIGNATURE_REJECTED/);
 await rejects(()=>commit({...report,password:'must-not-be-stored'}),/INVALID_REPORT/);
 await q('update signing_v2.documents set current_version_id=null where id=$1',[doc]);
 await rejects(()=>commit(),/CANONICAL_VERSION_CHANGED|SIGNATURE_REJECTED/);
 await q('update signing_v2.documents set current_version_id=$1 where id=$2',[v0,doc]);
 await commit();
 const state=(await q('select * from signing_v2.documents where id=$1',[doc])).rows[0];
 assert.equal(state.current_version_id,version);assert.equal(state.active_stage_id,s2);count+=2;
 await commit(); // Idempotent receipt, not a second signature.
 assert.equal((await q('select count(*)::integer as n from signing_v2.versions')).rows[0].n,2);count++;
 await rejects(()=>claim(a,'e'.repeat(64)),/INTENT_UNAVAILABLE/);
 await rejects(()=>q("update signing_v2.versions set sha256=$1 where id=$2",['e'.repeat(64),v0]),/IMMUTABLE_VERSION/);
 const second=(await issue(b)).rows[0];
 await q('select signing_v2.claim_intent($1,$2,$3,$4)',[second.id,b,'b'.repeat(64),'e'.repeat(64)]);
 await q('select signing_v2.reject_intent($1,$2)',[second.id,'e'.repeat(64)]);
 assert.equal((await q('select active_stage_id from signing_v2.documents')).rows[0].active_stage_id,s2);count++;
 await q('update signing_v2.settings set external_enabled=false');
 await rejects(()=>issue(b),/V2_DISABLED/);
 console.log(JSON.stringify({assertions:count,remoteWrites:0,concurrencyScope:'single PostgreSQL WASM connection'}));
} finally {await db.close();}
