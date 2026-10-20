// Isolated WASM PostgreSQL integration. No remote credentials or writes.
// One serialized connection: not proof of multi-connection concurrency.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID,createHash} from 'node:crypto';
import {postgresPreparation, type TransactionalSql} from '../server/v2/postgres-preparation';
import {createPreparationHandler} from '../server/v2/prepare-api';
import {issueIntent} from '../server/v2/intents';
const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite(); let count=0;
const actor=randomUUID(),other=randomUUID(),document=randomUUID(),version=randomUUID(),stage=randomUUID();
const bytes=new TextEncoder().encode('%PDF-synthetic database integration only');
const hash=createHash('sha256').update(bytes).digest('hex');
try {
 await db.exec(readFileSync('v2/migrations/001_intents.sql','utf8'));
 await db.exec(readFileSync('v2/migrations/002_document_filename.sql','utf8'));
 await db.query(`insert into signing_v2.documents(id,owner_id,status,filename) values($1,$2,'draft','Contrato.pdf')`,[document,other]);
 await db.query(`insert into signing_v2.versions(id,document_id,sha256,storage_path,byte_size,signature_count,page_count,last_page_width,last_page_height) values($1,$2,$3,$4,$5,0,1,595,842)`,[version,document,hash,`${document}/versions/${version}.pdf`,bytes.length]);
 await db.query(`insert into signing_v2.stages(id,document_id,ordinal,signer_id,role) values($1,$2,1,$3,'signer')`,[stage,document,actor]);
 await db.query(`update signing_v2.documents set current_version_id=$1,active_stage_id=$2,status='ready_for_signer' where id=$3`,[version,stage,document]);
 await db.query(`update signing_v2.settings set external_enabled=true,profile_enabled=true`);
 const deps=postgresPreparation({database:db as TransactionalSql, flags:{EXTERNAL_SIGNATURE_ENABLED:'true',FIRMAEC_COMPATIBILITY_PROFILE_ENABLED:'true'},authenticate:async()=>actor,reserve:async()=>{},readPrivateObject:async(path,limit)=>{assert.equal(path,`${document}/versions/${version}.pdf`);assert.equal(limit,bytes.length);return bytes;}});
 const current=await deps.loadStage(document,actor);
 assert.equal(current.filename,'Contrato.pdf'); count++;
 await assert.rejects(()=>deps.loadStage(document,other));count++;
 await assert.rejects(()=>deps.loadCanonical(version,other));count++;
 await assert.rejects(()=>deps.loadStage("' OR true --",actor));count++;
 const intent=issueIntent(current,actor,'firmaec-qr-compatible',{page:1,x:320,y:20,width:250,height:80});
 await deps.persistIntent(intent);
 const saved=(await db.query(`select * from signing_v2.intents where id=$1`,[intent.id])).rows[0];
 assert.equal(saved.nonce_hash,createHash('sha256').update(intent.nonce).digest('hex'));assert.notEqual(saved.nonce_hash,intent.nonce);count++;
 const handle=createPreparationHandler(deps);
 const r=await handle(new Request(`https://leapsign.app/api/v2/signing/intents/${intent.id}/pdf`,{headers:{'X-LeapSign-Client':'v2'}}));
 assert.equal(r.status,200);assert.deepEqual(new Uint8Array(await r.arrayBuffer()),bytes);count++;
 await db.query(`update signing_v2.intents set state='rejected' where id=$1`,[intent.id]);
 const stale=issueIntent(current,actor,'firmaec-qr-compatible',intent.position);
 stale.versionId=randomUUID();
 await assert.rejects(()=>deps.persistIntent(stale),/CANONICAL_VERSION_CHANGED/);count++;
 assert.equal((await db.query(`select count(*)::integer n from signing_v2.intents where id=$1`,[stale.id])).rows[0].n,0);count++;
 assert.equal((await db.query(`select count(*)::integer n from signing_v2.audit where intent_id=$1`,[stale.id])).rows[0].n,0);count++;
 const active=issueIntent(current,actor,'firmaec-qr-compatible',intent.position);
 await deps.persistIntent(active);
 assert.equal((await deps.loadIntent(active.id,actor)).nonce,'withheld-download-only');count++;
 await assert.rejects(()=>deps.loadIntent(active.id,other));count++;
 await db.query(`update signing_v2.documents set status='final_review' where id=$1`,[document]);
 assert.equal((await handle(new Request(`https://leapsign.app/api/v2/signing/intents/${active.id}/pdf`,{headers:{'X-LeapSign-Client':'v2'}}))).status,409);count++;
 console.log(JSON.stringify({passed:count,remoteWrites:0,realCertificates:0,multiConnectionConcurrencyTest:false}));
} finally {await db.close();}
