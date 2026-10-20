// Isolated PostgreSQL WASM checks. No remote database, credentials or users.
// PGlite serializes one connection: this exercises CAS/replay semantics but is
// not evidence of concurrency across independent PostgreSQL connections.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

const {PGlite}=await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db=new PGlite();let assertions=0;
const q=(sql,args=[])=>db.query(sql,args);
const value=async(sql,args=[])=>(await q(sql,args)).rows[0].value;
const rejects=async(action,pattern)=>{await assert.rejects(action,pattern);assertions++;};
const serviceValue=async(sql,args=[])=>{
  await q('set role service_role');
  try{return await value(sql,args);}
  finally{await q('reset role');}
};

const owner=randomUUID(),signerA=randomUUID(),signerB=randomUUID(),outsider=randomUUID();
const documentId=randomUUID(),baseVersionId=randomUUID();
const baseHash='a'.repeat(64),nonceHash='b'.repeat(64);
const candidateA='c'.repeat(64),candidateB='d'.repeat(64),candidateFinal='e'.repeat(64);
const position={page:2,x:320,y:20,width:250,height:80};

try{
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema auth;
    revoke all on schema auth from public,anon,authenticated,service_role;
    create table auth.users(id uuid primary key,email text);
    revoke all on auth.users from public,anon,authenticated,service_role;
  `);
  await q(`insert into auth.users(id,email) values
    ($1,'owner@example.test'),($2,'ana@example.test'),($3,'bea@example.test'),($4,'outsider@example.test')`,
    [owner,signerA,signerB,outsider]);
  await db.exec(readFileSync(new URL('../v2/migrations/001_intents.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../v2/migrations/002_document_filename.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../v2/migrations/003_private_api.sql',import.meta.url),'utf8'));
  await q(`update signing_v2.settings set external_enabled=true,profile_enabled=true`);

  const functions=(await q(`select p.proname,p.prosecdef,r.rolname owner,p.proconfig,
      has_function_privilege('service_role',p.oid,'execute') service_execute,
      has_function_privilege('anon',p.oid,'execute') anon_execute,
      has_function_privilege('authenticated',p.oid,'execute') authenticated_execute,
      p.prorettype='jsonb'::regtype json_result
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    join pg_roles r on r.oid=p.proowner
    where n.nspname='public' and p.proname in
      ('v2_create_process','v2_get_process_status','v2_get_authorized_download','v2_issue_intent',
       'v2_reserve_operation','v2_get_signing_stage','v2_get_intent_download','v2_get_version_storage',
       'v2_claim_intent','v2_commit_validated','v2_get_intent_receipt','v2_reject_intent')
    order by p.proname`)).rows;
  assert.equal(functions.length,12);assertions++;
  for(const fn of functions){
    assert.equal(fn.prosecdef,true,`${fn.proname} must be SECURITY DEFINER`);
    assert.equal(fn.owner,'postgres',`${fn.proname} must have an explicit trusted owner`);
    assert.equal(fn.service_execute,true,`${fn.proname} must allow service_role`);
    assert.equal(fn.anon_execute,false,`${fn.proname} must deny anon`);
    assert.equal(fn.authenticated_execute,false,`${fn.proname} must deny authenticated`);
    assert.equal(fn.json_result,true,`${fn.proname} must not return a signing_v2 row type`);
    assert.match(fn.proconfig?.join(',')??'',/search_path=pg_catalog, signing_v2, auth, pg_temp/);
    assertions+=7;
  }
  const privatePrivileges=(await q(`select
    has_schema_privilege('service_role','signing_v2','usage') schema_usage,
    has_table_privilege('service_role','signing_v2.documents','select') table_select,
    has_table_privilege('anon','signing_v2.documents','select') anon_select,
    has_table_privilege('authenticated','signing_v2.documents','select') authenticated_select`)).rows[0];
  assert.deepEqual(privatePrivileges,{schema_usage:false,table_select:false,anon_select:false,authenticated_select:false});assertions++;

  await q('set role anon');
  await rejects(()=>value(`select public.v2_get_process_status($1,$2) value`,[documentId,owner]),/permission denied/i);
  await q('reset role');

  const createSql=`select public.v2_create_process($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,array[$11,$12]) value`;
  const missingDocument=randomUUID(),missingVersion=randomUUID();
  await rejects(()=>serviceValue(createSql,[owner,missingDocument,missingVersion,'Missing.pdf',baseHash,100,2,595,842,0,'ana@example.test','missing@example.test']),/SIGNER_NOT_FOUND/);
  assert.equal((await q(`select count(*)::integer n from signing_v2.documents where id=$1`,[missingDocument])).rows[0].n,0);assertions++;
  await rejects(()=>serviceValue(createSql,[owner,randomUUID(),randomUUID(),'Duplicate.pdf',baseHash,100,2,595,842,0,'ana@example.test','ANA@example.test']),/DUPLICATE_SIGNER/);
  await rejects(()=>serviceValue(createSql,[randomUUID(),randomUUID(),randomUUID(),'Owner.pdf',baseHash,100,2,595,842,0,'ana@example.test','bea@example.test']),/OWNER_NOT_FOUND/);

  const created=await serviceValue(createSql,[owner,documentId,baseVersionId,'Contrato.pdf',baseHash,100,2,595,842,0,'ANA@example.test','bea@example.test']);
  assert.deepEqual(created,{id:documentId,filename:'Contrato.pdf',status:'ready_for_signer',signerCount:2});assertions++;
  const persisted=(await q(`select d.owner_id,d.current_version_id,d.status,v.storage_path,
      array_agg(s.signer_id order by s.ordinal) signer_ids,
      bool_and(s.expected_fingerprint is null) no_certificate_binding
    from signing_v2.documents d join signing_v2.versions v on v.id=d.current_version_id
    join signing_v2.stages s on s.document_id=d.id where d.id=$1
    group by d.owner_id,d.current_version_id,d.status,v.storage_path`,[documentId])).rows[0];
  assert.equal(persisted.owner_id,owner);assert.equal(persisted.current_version_id,baseVersionId);
  assert.equal(persisted.status,'ready_for_signer');
  assert.equal(persisted.storage_path,`${documentId}/versions/${baseVersionId}.pdf`);
  assert.deepEqual(persisted.signer_ids,[signerA,signerB]);assert.equal(persisted.no_certificate_binding,true);assertions+=6;

  const initialStatus=await serviceValue(`select public.v2_get_process_status($1,$2) value`,[documentId,owner]);
  assert.deepEqual(initialStatus,{id:documentId,filename:'Contrato.pdf',status:'ready_for_signer',signatureCount:0,
    stages:[{ordinal:1,status:'ready_for_signer',current:true},{ordinal:2,status:'ready_for_signer',current:false}]});assertions++;
  await rejects(()=>serviceValue(`select public.v2_get_process_status($1,$2) value`,[documentId,signerA]),/NOT_FOUND/);

  const expectedDownload={documentId,versionId:baseVersionId,filename:'Contrato.pdf',
    storagePath:`${documentId}/versions/${baseVersionId}.pdf`,byteSize:100,sha256:baseHash};
  assert.deepEqual(await serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,owner]),expectedDownload);assertions++;
  assert.deepEqual(await serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,signerA]),expectedDownload);assertions++;
  await rejects(()=>serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,signerB]),/NOT_FOUND/);
  await rejects(()=>serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,outsider]),/NOT_FOUND/);

  const firstIntentId=randomUUID(),firstCorrelationId=randomUUID();
  const firstIntent=await serviceValue(`select public.v2_issue_intent($1,$2,$3,$4,$5,$6,now(),now()+interval '5 minutes') value`,
    [documentId,signerA,firstIntentId,nonceHash,position,firstCorrelationId]);
  assert.deepEqual(Object.keys(firstIntent).sort(),['baseSha256','correlationId','documentId','expiresAt','id','issuedAt','position','profile','role','signerId','stageId','state','versionId'].sort());
  assert.equal(firstIntent.id,firstIntentId);assert.equal(firstIntent.signerId,signerA);assert.equal(firstIntent.state,'signature_intent_issued');
  assert.equal(JSON.stringify(firstIntent).includes(nonceHash),false);assertions+=5;

  await q('set role service_role');
  const contested=await Promise.allSettled([
    value(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,candidateA]),
    value(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,candidateB]),
  ]);
  await q('reset role');
  assert.equal(contested.filter(result=>result.status==='fulfilled').length,1);assertions++;
  assert.equal(contested.filter(result=>result.status==='rejected').length,1);assertions++;
  const winner=(await q(`select candidate_sha256 from signing_v2.intents where id=$1`,[firstIntentId])).rows[0].candidate_sha256;
  const loser=winner===candidateA?candidateB:candidateA;
  const claimed=await serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,winner]);
  assert.deepEqual(Object.keys(claimed).sort(),['current','intent']);
  assert.equal(claimed.intent.state,'signed_pending_validation');
  assert.deepEqual(claimed.current,{documentId,versionId:baseVersionId,baseSha256:baseHash,stageId:firstIntent.stageId,
    signerId:signerA,role:'signer',pageCount:2,pageWidth:595,pageHeight:842});assertions+=3;
  await rejects(()=>serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,loser]),/INTENT_UNAVAILABLE/);
  await rejects(()=>serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,'f'.repeat(64),winner]),/UNAUTHORIZED/);
  await rejects(()=>serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,outsider,nonceHash,winner]),/UNAUTHORIZED/);

  const firstAcceptedVersion=randomUUID();
  const firstReport={valid:true,policy:'leapsign-v2-strict-offline-1',baseSha256:baseHash,signedSha256:winner,
    previousSignatureCount:0,signatureCount:1,revocation:'good',certificate:{subject:'Synthetic A',issuer:'Synthetic CA',serial:'1',
      fingerprint:'1'.repeat(64),notBefore:'2026-01-01T00:00:00Z',notAfter:'2027-01-01T00:00:00Z'}};
  const committed=await serviceValue(`select public.v2_commit_validated($1,$2,$3,$4,$5,$6,$7) value`,
    [firstIntentId,signerA,nonceHash,winner,firstAcceptedVersion,200,firstReport]);
  assert.deepEqual(committed,{acceptedVersionId:firstAcceptedVersion});assertions++;
  await rejects(()=>serviceValue(`select public.v2_commit_validated($1,$2,$3,$4,$5,$6,$7) value`,
    [firstIntentId,signerA,'f'.repeat(64),winner,randomUUID(),200,firstReport]),/UNAUTHORIZED/);
  const replayCommit=await serviceValue(`select public.v2_commit_validated($1,$2,$3,$4,$5,$6,$7) value`,
    [firstIntentId,signerA,nonceHash,winner,randomUUID(),200,firstReport]);
  assert.deepEqual(replayCommit,{acceptedVersionId:firstAcceptedVersion});assertions++;
  assert.equal((await q(`select count(*)::integer n from signing_v2.versions where document_id=$1`,[documentId])).rows[0].n,2);assertions++;

  const replayClaim=await serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,winner]);
  assert.deepEqual(Object.keys(replayClaim).sort(),['current','intent','replay']);
  assert.deepEqual(replayClaim.replay,firstReport);assert.equal(replayClaim.intent.state,'validated');assertions+=3;
  const receipt=await serviceValue(`select public.v2_get_intent_receipt($1,$2) value`,[firstIntentId,signerA]);
  assert.deepEqual(receipt,{state:'validated',acceptedVersionId:firstAcceptedVersion,report:firstReport});assertions++;
  await rejects(()=>serviceValue(`select public.v2_get_intent_receipt($1,$2) value`,[firstIntentId,outsider]),/NOT_FOUND/);
  assert.deepEqual(await serviceValue(`select public.v2_reject_intent($1,$2,$3,$4) value`,[firstIntentId,signerA,nonceHash,winner]),{state:'validated'});assertions++;

  await rejects(()=>serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,signerA]),/NOT_FOUND/);
  const firstAcceptedDownload={documentId,versionId:firstAcceptedVersion,filename:'Contrato.pdf',
    storagePath:`${documentId}/versions/${firstAcceptedVersion}.pdf`,byteSize:200,sha256:winner};
  assert.deepEqual(await serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,signerB]),firstAcceptedDownload);assertions++;
  const midStatus=await serviceValue(`select public.v2_get_process_status($1,$2) value`,[documentId,owner]);
  assert.deepEqual(midStatus.stages,[{ordinal:1,status:'validated',current:false},{ordinal:2,status:'ready_for_signer',current:true}]);
  assert.equal(midStatus.signatureCount,1);assertions+=2;

  const rejectedIntentId=randomUUID();
  const rejectedIntent=await serviceValue(`select public.v2_issue_intent($1,$2,$3,$4,$5,$6,now(),now()+interval '5 minutes') value`,
    [documentId,signerB,rejectedIntentId,nonceHash,position,randomUUID()]);
  await serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[rejectedIntentId,signerB,nonceHash,candidateFinal]);
  await rejects(()=>serviceValue(`select public.v2_reject_intent($1,$2,$3,$4) value`,[rejectedIntentId,signerB,'f'.repeat(64),candidateFinal]),/UNAUTHORIZED/);
  assert.deepEqual(await serviceValue(`select public.v2_reject_intent($1,$2,$3,$4) value`,[rejectedIntentId,signerB,nonceHash,candidateFinal]),{state:'rejected'});assertions++;
  assert.deepEqual(await serviceValue(`select public.v2_reject_intent($1,$2,$3,$4) value`,[rejectedIntentId,signerB,nonceHash,candidateFinal]),{state:'rejected'});assertions++;
  assert.deepEqual(await serviceValue(`select public.v2_get_intent_receipt($1,$2) value`,[rejectedIntentId,signerB]),{state:'rejected'});assertions++;
  assert.equal((await q(`select active_stage_id from signing_v2.documents where id=$1`,[documentId])).rows[0].active_stage_id,rejectedIntent.stageId);assertions++;

  const finalIntentId=randomUUID();
  await serviceValue(`select public.v2_issue_intent($1,$2,$3,$4,$5,$6,now(),now()+interval '5 minutes') value`,
    [documentId,signerB,finalIntentId,nonceHash,position,randomUUID()]);
  await serviceValue(`select public.v2_claim_intent($1,$2,$3,$4) value`,[finalIntentId,signerB,nonceHash,candidateFinal]);
  const finalVersionId=randomUUID();
  const finalReport={...firstReport,baseSha256:winner,signedSha256:candidateFinal,previousSignatureCount:1,signatureCount:2,
    certificate:{...firstReport.certificate,subject:'Synthetic B',serial:'2',fingerprint:'2'.repeat(64)}};
  assert.deepEqual(await serviceValue(`select public.v2_commit_validated($1,$2,$3,$4,$5,$6,$7) value`,
    [finalIntentId,signerB,nonceHash,candidateFinal,finalVersionId,300,finalReport]),{acceptedVersionId:finalVersionId});assertions++;
  const finalStatus=await serviceValue(`select public.v2_get_process_status($1,$2) value`,[documentId,owner]);
  assert.deepEqual(finalStatus,{id:documentId,filename:'Contrato.pdf',status:'final_review',signatureCount:2,
    stages:[{ordinal:1,status:'validated',current:false},{ordinal:2,status:'validated',current:false}]});assertions++;
  await rejects(()=>serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,signerB]),/NOT_FOUND/);
  assert.deepEqual(await serviceValue(`select public.v2_get_authorized_download($1,$2) value`,[documentId,owner]),{
    documentId,versionId:finalVersionId,filename:'Contrato.pdf',storagePath:`${documentId}/versions/${finalVersionId}.pdf`,
    byteSize:300,sha256:candidateFinal});assertions++;

  console.log(JSON.stringify({assertions,remoteWrites:0,realUsers:0,realCertificates:0,
    concurrencyScope:'single serialized PostgreSQL WASM connection; multi-connection concurrency not proven'}));
}finally{await db.close();}
