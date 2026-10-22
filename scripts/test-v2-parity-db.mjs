// Run only against an explicitly named disposable local PostgreSQL container.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';

const container=process.env.LEAPSIGN_V2_TEST_CONTAINER;
if(!container?.startsWith('codex-leapsign-v2-parity-'))throw new Error('Set LEAPSIGN_V2_TEST_CONTAINER to a disposable local test container');
const database='leapsign_v2_parity';
function sql(query){const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-XAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});if(result.status)throw new Error(result.stderr);return result.stdout.trim();}
function concurrent(query){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-XAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let output='';let error='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>error+=chunk);child.on('close',code=>code?reject(new Error(error)):resolve(output.trim()));child.stdin.end(query);});}

const created=spawnSync('docker',['exec',container,'createdb','-U','postgres',database],{encoding:'utf8'});
if(created.status)throw new Error('Use a fresh disposable container; no database reset is performed');
sql(`
 create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;revoke all on schema auth from public,anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
 revoke all on auth.users from public,anon,authenticated,service_role;
 create schema extensions;create extension pgcrypto with schema extensions;
`);
for(const name of ['001_intents.sql','002_document_filename.sql','003_private_api.sql','004_structured_validation.sql','005_owner_finalization.sql','006_authenticated_verification.sql','007_accounts_guests_email.sql','008_v1_parity.sql'])sql(readFileSync(new URL(`../v2/migrations/${name}`,import.meta.url),'utf8'));

assert.equal(sql("select has_table_privilege('anon','signing_v2.owner_contacts','select');"),'f');
assert.equal(sql("select has_table_privilege('authenticated','signing_v2.queue_entries','insert');"),'f');
assert.equal(sql("select has_function_privilege('service_role','public.v2_upsert_contact(uuid,uuid,text,text)','execute');"),'t');
console.log('PASS parity tables are private and service RPC is explicit');

const owner1='10000000-0000-4000-8000-000000000001';
const owner2='10000000-0000-4000-8000-000000000002';
sql(`insert into auth.users(id,email) values('${owner1}','one@example.test'),('${owner2}','two@example.test');`);
const contact=JSON.parse(sql(`select public.v2_upsert_contact('${owner1}',null,' PERSON@EXAMPLE.TEST ','Persona');`));
assert.equal(contact.email,'person@example.test');
assert.equal(sql(`select count(*) from signing_v2.owner_contacts where owner_id='${owner2}';`),'0');
assert.throws(()=>sql(`select public.v2_upsert_contact('${owner2}',null,'not-an-email','X');`),/INVALID_CONTACT/);
console.log('PASS contacts normalize and remain isolated by owner');

const document='20000000-0000-4000-8000-000000000001';
const version='30000000-0000-4000-8000-000000000001';
const actor1='40000000-0000-4000-8000-000000000001';
const actor2='40000000-0000-4000-8000-000000000002';
sql(`
 insert into signing_v2.documents(id,owner_id,status,filename) values('${document}','${owner1}','draft','queue.pdf');
 insert into signing_v2.versions(id,document_id,sha256,storage_path,byte_size,signature_count,page_count,last_page_width,last_page_height) values('${version}','${document}','${'a'.repeat(64)}','${document}/versions/${version}.pdf',1000,0,1,612,792);
 update signing_v2.documents set current_version_id='${version}',status='ready_for_signer' where id='${document}';
 insert into signing_v2.process_access(document_id,owner_id,mode,expected_signatures) values('${document}','${owner1}','open_queue',2);
 select public.v2_join_queue('${document}','${actor1}','${'1'.repeat(64)}','a@example.test','A');
 select public.v2_join_queue('${document}','${actor2}','${'2'.repeat(64)}','b@example.test','B');
`);
const claim1=`select public.v2_claim_turn('${document}','${actor1}','${'3'.repeat(64)}');`;
const claim2=`select public.v2_claim_turn('${document}','${actor2}','${'4'.repeat(64)}');`;
const results=await Promise.allSettled([concurrent(claim1),concurrent(claim2)]);
assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
assert.equal(results.filter(result=>result.status==='rejected').length,1);
assert.equal(sql(`select count(*) from signing_v2.turn_leases where document_id='${document}' and status='active';`),'1');
assert.equal(sql(`select actor_id from signing_v2.queue_entries where document_id='${document}' and status='active';`),actor1);
console.log('PASS concurrent queue claims yield exactly one lease for the first position');
assert.match(sql(`select public.v2_resolve_guest_session('${'1'.repeat(64)}');`),new RegExp(actor1));
assert.equal(JSON.parse(sql(`select public.v2_release_turn('${document}','${actor1}');`)).ok,true);
assert.equal(sql(`select count(*) from signing_v2.turn_leases where document_id='${document}' and status='released';`),'1');
assert.equal(sql(`select count(*) from signing_v2.guest_sessions where actor_id='${actor1}' and revoked_at is not null;`),'1');
console.log('PASS queue turn creates and revokes the existing v2 guest session');

const paused=JSON.parse(sql(`select public.v2_process_action('${document}','${owner1}','pause',null,'owner request');`));
assert.equal(paused.ok,true);
assert.equal(sql(`select paused from signing_v2.process_access where document_id='${document}';`),'t');
console.log('PASS owner lifecycle actions are audited and update only their process');
