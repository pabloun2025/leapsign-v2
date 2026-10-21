-- Structured validator report: acceptance remains an atomic database decision.
begin;

create or replace function signing_v2.validation_report_is_accepted(
  p_report jsonb,
  p_base_sha256 text,
  p_candidate_sha256 text,
  p_previous_signature_count integer
)
returns boolean
language plpgsql
immutable
strict
set search_path = pg_catalog, pg_temp
as $$
begin
  if jsonb_typeof(p_report) is distinct from 'object'
     or jsonb_typeof(p_report->'checks') is distinct from 'object'
     or jsonb_typeof(p_report->'certificate') is distinct from 'object'
     or exists(select 1 from jsonb_object_keys(p_report) key where key not in
       ('accepted','valid','policy','baseSha256','signedSha256','previousSignatureCount','signatureCount','certificate','revocation','checks','legalOutcome'))
     or exists(select 1 from jsonb_object_keys(p_report->'checks') key where key not in
       ('cryptographicIntegrity','cmsSignature','documentMatch','oneNewSignature','previousSignatures','chainBuilt','trusted','certificateValidity','revocation'))
     or exists(select 1 from jsonb_object_keys(p_report->'certificate') key where key not in
       ('subject','issuer','serial','fingerprint','notBefore','notAfter')) then
    return false;
  end if;
  if (p_report->>'accepted') is distinct from 'true'
     or (p_report->>'valid') is distinct from 'true'
     or p_report->>'policy' is distinct from 'leapsign-v2-ecuador-strict-1'
     or p_report->>'baseSha256' is distinct from p_base_sha256
     or p_report->>'signedSha256' is distinct from p_candidate_sha256
     or p_report->>'revocation' is distinct from 'good'
     or p_report->>'legalOutcome' is distinct from 'not_determined_by_software'
     or p_report->'checks'->>'cryptographicIntegrity' is distinct from 'passed'
     or p_report->'checks'->>'cmsSignature' is distinct from 'passed'
     or p_report->'checks'->>'documentMatch' is distinct from 'passed'
     or p_report->'checks'->>'oneNewSignature' is distinct from 'passed'
     or p_report->'checks'->>'previousSignatures' is distinct from 'passed'
     or p_report->'checks'->>'chainBuilt' is distinct from 'passed'
     or p_report->'checks'->>'trusted' is distinct from 'passed'
     or p_report->'checks'->>'certificateValidity' is distinct from 'passed'
     or p_report->'checks'->>'revocation' is distinct from 'good'
     or jsonb_typeof(p_report->'previousSignatureCount') is distinct from 'number'
     or jsonb_typeof(p_report->'signatureCount') is distinct from 'number' then
    return false;
  end if;
  return (p_report->>'previousSignatureCount')::integer = p_previous_signature_count
     and (p_report->>'signatureCount')::integer = p_previous_signature_count + 1;
exception when others then
  return false;
end
$$;

create or replace function signing_v2.commit_validated(
  p_id uuid,
  p_candidate text,
  p_version_id uuid,
  p_byte_size integer,
  p_report jsonb
)
returns uuid
language plpgsql
security definer
set search_path = signing_v2, pg_temp
as $$
declare
  i signing_v2.intents;
  d signing_v2.documents;
  prior signing_v2.versions;
  next_stage uuid;
begin
  if not exists(select 1 from settings where (external_enabled or direct_enabled) and profile_enabled) then raise exception 'V2_DISABLED'; end if;
  select * into i from intents where id=p_id;
  select * into d from documents where id=i.document_id for update;
  select * into i from intents where id=p_id for update;
  if i.id is null then raise exception 'INTENT_UNAVAILABLE'; end if;
  if i.state='validated' and i.candidate_sha256=p_candidate then return i.accepted_version_id; end if;
  if i.state<>'signed_pending_validation' or i.candidate_sha256 is distinct from p_candidate or i.expires_at<=now() then raise exception 'INTENT_UNAVAILABLE'; end if;
  if d.id is null or d.status is distinct from 'ready_for_signer' or d.current_version_id is distinct from i.version_id or d.active_stage_id is distinct from i.stage_id
     or not exists(select 1 from stages where id=i.stage_id and document_id=d.id and signer_id=i.signer_id and role=i.role and expected_fingerprint is not distinct from i.expected_fingerprint and status='ready_for_signer') then raise exception 'CANONICAL_VERSION_CHANGED'; end if;
  select * into prior from versions where id=i.version_id and document_id=d.id;
  if prior.id is null or not signing_v2.validation_report_is_accepted(p_report,i.base_sha256,p_candidate,prior.signature_count) then raise exception 'SIGNATURE_REJECTED'; end if;
  if i.expected_fingerprint is not null and p_report->'certificate'->>'fingerprint' is distinct from i.expected_fingerprint then raise exception 'SIGNER_IDENTITY_MISMATCH'; end if;
  insert into versions(id,document_id,sha256,storage_path,byte_size,parent_id,signature_count,page_count,last_page_width,last_page_height)
  values(p_version_id,d.id,p_candidate,d.id::text||'/versions/'||p_version_id::text||'.pdf',p_byte_size,prior.id,prior.signature_count+1,prior.page_count,prior.last_page_width,prior.last_page_height);
  update intents set state='validated',report=p_report,accepted_version_id=p_version_id where id=i.id;
  update stages set status='validated' where id=i.stage_id;
  select id into next_stage from stages where document_id=d.id and status='ready_for_signer' order by ordinal limit 1;
  update documents set current_version_id=p_version_id,active_stage_id=next_stage,status=case when next_stage is null then 'final_review' else 'ready_for_signer' end where id=d.id;
  insert into audit(intent_id,correlation_id,outcome) values(i.id,i.correlation_id,'validated');
  return p_version_id;
end
$$;

alter function signing_v2.validation_report_is_accepted(jsonb,text,text,integer) owner to postgres;
alter function signing_v2.commit_validated(uuid,text,uuid,integer,jsonb) owner to postgres;
revoke all on function signing_v2.validation_report_is_accepted(jsonb,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function signing_v2.commit_validated(uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;

commit;
