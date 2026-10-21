// Run only against an explicitly named disposable local PostgreSQL container.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';

const container=process.env.LEAPSIGN_V2_TEST_CONTAINER;
if(!container?.startsWith('codex-leapsign-v2-test-'))throw new Error('Set LEAPSIGN_V2_TEST_CONTAINER to a disposable local test container');
const database='leapsign_v2_email_budgets';
function sql(query){const result=spawnSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-XAt','-v','ON_ERROR_STOP=1'],{input:query,encoding:'utf8'});if(result.status)throw new Error(result.stderr);return result.stdout.trim();}
function concurrent(query){return new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-XAt','-v','ON_ERROR_STOP=1'],{stdio:['pipe','pipe','pipe']});let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('close',code=>code?reject(new Error(error)):resolve());child.stdin.end(query);});}

const created=spawnSync('docker',['exec',container,'createdb','-U','postgres',database],{encoding:'utf8'});
if(created.status)throw new Error('Use a fresh disposable container; no database reset is performed');
sql(`
 create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
 create schema auth;revoke all on schema auth from public,anon,authenticated,service_role;
 create table auth.users(id uuid primary key,email text,deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz,created_at timestamptz default now(),last_sign_in_at timestamptz);
 revoke all on auth.users from public,anon,authenticated,service_role;
 create schema extensions;create extension pgcrypto with schema extensions;
`);
for(const name of ['001_intents.sql','002_document_filename.sql','003_private_api.sql','004_structured_validation.sql','005_owner_finalization.sql','006_authenticated_verification.sql','007_accounts_guests_email.sql'])sql(readFileSync(new URL(`../v2/migrations/${name}`,import.meta.url),'utf8'));

const hashes={user:'1'.repeat(64),process:'2'.repeat(64),recipient:'3'.repeat(64),ip:'4'.repeat(64)};
const reserve=(scope,hash,amount,limit)=>sql(`select signing_v2.reserve_email_budget('${scope}','${hash}','epoch',${amount},${limit});`);
reserve('user',hashes.user,20,40);reserve('user',hashes.user,20,40);assert.throws(()=>reserve('user',hashes.user,1,40),/EMAIL_RATE_LIMITED/);
reserve('process',hashes.process,20,20);assert.throws(()=>reserve('process',hashes.process,1,20),/EMAIL_RATE_LIMITED/);
reserve('recipient',hashes.recipient,5,5);assert.throws(()=>reserve('recipient',hashes.recipient,1,5),/EMAIL_RATE_LIMITED/);
reserve('ip',hashes.ip,20,60);reserve('ip',hashes.ip,20,60);reserve('ip',hashes.ip,20,60);assert.throws(()=>reserve('ip',hashes.ip,1,60),/EMAIL_RATE_LIMITED/);
assert.equal(sql(`select string_agg(scope||':'||used,',' order by scope) from signing_v2.email_rate_budgets where scope_hash in ('${hashes.user}','${hashes.process}','${hashes.recipient}','${hashes.ip}');`),'ip:60,process:20,recipient:5,user:40');
console.log('PASS email quotas fail closed for user, process, recipient and anonymized IP');

const concurrentHash='5'.repeat(64);const statement=`select signing_v2.reserve_email_budget('ip','${concurrentHash}','epoch',20,30);`;
const results=await Promise.allSettled([concurrent(statement),concurrent(statement)]);
assert.equal(results.filter(result=>result.status==='fulfilled').length,1);assert.equal(results.filter(result=>result.status==='rejected').length,1);
assert.equal(sql(`select used from signing_v2.email_rate_budgets where scope='ip' and scope_hash='${concurrentHash}';`),'20');
console.log('PASS concurrent reservations cannot oversubscribe the atomic email quota');

assert.equal(sql("select has_function_privilege('service_role','signing_v2.reserve_email_budget(text,text,timestamptz,integer,integer)','execute');"),'f');
console.log('PASS the internal quota primitive is not callable by browser or service roles');
