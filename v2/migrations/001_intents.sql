-- PREPARATION ONLY. Not in supabase/migrations: v1 must never apply this file.
-- Provision in the dedicated v2 backend, then grant only the private service
-- role access. No browser role or PostgREST exposed schema receives privileges.
begin;
create schema signing_v2;
revoke all on schema signing_v2 from public;
create table signing_v2.settings (
  singleton boolean primary key default true check(singleton),
  external_enabled boolean not null default false,
  direct_enabled boolean not null default false,
  profile_enabled boolean not null default false
);
insert into signing_v2.settings default values;
create table signing_v2.documents (
  id uuid primary key, owner_id uuid not null, current_version_id uuid,
  active_stage_id uuid, status text not null check(status in ('draft','ready_for_signer','final_review','completed','failed'))
);
create table signing_v2.versions (
  id uuid primary key, document_id uuid not null references signing_v2.documents(id),
  sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),
  storage_path text not null unique, byte_size integer not null check(byte_size between 1 and 10485760),
  parent_id uuid references signing_v2.versions(id), signature_count integer not null check(signature_count between 0 and 20),
  page_count integer not null check(page_count between 1 and 500),
  last_page_width real not null check(last_page_width > 0 and last_page_width < 'Infinity'::real), last_page_height real not null check(last_page_height > 0 and last_page_height < 'Infinity'::real),
  created_at timestamptz not null default now()
);
create table signing_v2.stages (
  id uuid primary key, document_id uuid not null references signing_v2.documents(id),
  ordinal integer not null check(ordinal between 1 and 20), signer_id uuid not null,
  role text not null check(char_length(role) between 1 and 80),
  expected_fingerprint text check(expected_fingerprint ~ '^[a-f0-9]{64}$'),
  status text not null default 'ready_for_signer' check(status in ('ready_for_signer','validated')),
  unique(document_id,ordinal)
);
alter table signing_v2.documents add foreign key(current_version_id) references signing_v2.versions(id);
alter table signing_v2.documents add foreign key(active_stage_id) references signing_v2.stages(id);
create table signing_v2.intents (
  id uuid primary key, document_id uuid not null references signing_v2.documents(id),
  version_id uuid not null references signing_v2.versions(id), base_sha256 text not null check(base_sha256 ~ '^[a-f0-9]{64}$'),
  stage_id uuid not null references signing_v2.stages(id), signer_id uuid not null, role text not null,
  profile text not null check(profile='firmaec-qr-compatible'),
  position jsonb not null check(jsonb_typeof(position)='object'),
  nonce_hash text not null check(nonce_hash ~ '^[a-f0-9]{64}$'),
  correlation_id uuid not null unique,
  expected_fingerprint text check(expected_fingerprint ~ '^[a-f0-9]{64}$'),
  issued_at timestamptz not null default now(), expires_at timestamptz not null,
  state text not null default 'signature_intent_issued' check(state in ('signature_intent_issued','signed_pending_validation','validated','rejected','expired','failed')),
  candidate_sha256 text check(candidate_sha256 ~ '^[a-f0-9]{64}$'), report jsonb,
  accepted_version_id uuid references signing_v2.versions(id),
  check(expires_at > issued_at and expires_at <= issued_at + interval '5 minutes')
);
create unique index one_pending_intent_per_stage on signing_v2.intents(stage_id)
  where state in ('signature_intent_issued','signed_pending_validation');
create table signing_v2.audit (
  id bigint generated always as identity primary key, intent_id uuid not null references signing_v2.intents(id),
  correlation_id uuid not null, outcome text not null check(outcome in ('issued','validated','rejected')),
  created_at timestamptz not null default now(), unique(intent_id,outcome)
);

create function signing_v2.issue_intent(p_document uuid,p_actor uuid,p_id uuid,p_nonce_hash text,p_position jsonb,p_correlation uuid)
returns signing_v2.intents language plpgsql security definer set search_path=signing_v2,pg_temp as $$
declare d signing_v2.documents; s signing_v2.stages; v signing_v2.versions; result signing_v2.intents;
begin
  if not exists(select 1 from settings where (external_enabled or direct_enabled) and profile_enabled) then raise exception 'V2_DISABLED'; end if;
  select * into d from documents where id=p_document and status='ready_for_signer' for update;
  if d.id is null then raise exception 'DOCUMENT_UNAVAILABLE'; end if;
  select * into s from stages where id=d.active_stage_id and document_id=d.id and status='ready_for_signer';
  if s.signer_id is distinct from p_actor then raise exception 'NOT_YOUR_TURN'; end if;
  select * into v from versions where id=d.current_version_id and document_id=d.id;
  if v.id is null then raise exception 'DOCUMENT_UNAVAILABLE'; end if;
  -- Position must have been approved by a server policy/page-geometry check;
  -- generic JSON from the browser must not reach this private RPC unchecked.
  if (select count(*) from jsonb_object_keys(p_position)) <> 5 or not (p_position ?& array['page','x','y','width','height']) then raise exception 'INVALID_POSITION'; end if;
  if exists(select 1 from jsonb_each(p_position) where jsonb_typeof(value)<>'number')
     or (p_position->>'page')::numeric<>v.page_count or (p_position->>'x')::numeric<0 or (p_position->>'y')::numeric<0
     or (p_position->>'width')::numeric<100 or (p_position->>'height')::numeric<50
     or (p_position->>'x')::numeric+(p_position->>'width')::numeric>v.last_page_width
     or (p_position->>'y')::numeric+(p_position->>'height')::numeric>v.last_page_height then raise exception 'INVALID_POSITION'; end if;
  update intents set state='expired' where stage_id=s.id and state in ('signature_intent_issued','signed_pending_validation') and expires_at<=now();
  insert into intents(id,document_id,version_id,base_sha256,stage_id,signer_id,role,profile,position,nonce_hash,correlation_id,expires_at,expected_fingerprint)
  values(p_id,d.id,v.id,v.sha256,s.id,s.signer_id,s.role,'firmaec-qr-compatible',p_position,p_nonce_hash,p_correlation,now()+interval '5 minutes',s.expected_fingerprint) returning * into result;
  insert into audit(intent_id,correlation_id,outcome) values(result.id,result.correlation_id,'issued');
  return result;
end $$;

create function signing_v2.claim_intent(p_id uuid,p_actor uuid,p_nonce_hash text,p_candidate text)
returns signing_v2.intents language plpgsql security definer set search_path=signing_v2,pg_temp as $$
declare i signing_v2.intents; d signing_v2.documents;
begin
  if not exists(select 1 from settings where (external_enabled or direct_enabled) and profile_enabled) then raise exception 'V2_DISABLED'; end if;
  select * into i from intents where id=p_id;
  -- Consistent lock order: document first, then intent. Serializes acceptance
  -- and new intent issuance across requests, not just within one JS process.
  select * into d from documents where id=i.document_id for update;
  select * into i from intents where id=p_id for update;
  if i.id is null or i.signer_id is distinct from p_actor or i.nonce_hash is distinct from p_nonce_hash then raise exception 'UNAUTHORIZED'; end if;
  if i.state='validated' and i.candidate_sha256=p_candidate then return i; end if;
  if i.state <> 'signature_intent_issued' then raise exception 'INTENT_UNAVAILABLE'; end if;
  if i.expires_at<=now() then raise exception 'INTENT_EXPIRED'; end if;
  if d.id is null or d.status is distinct from 'ready_for_signer' or d.current_version_id is distinct from i.version_id or d.active_stage_id is distinct from i.stage_id
     or not exists(select 1 from stages where id=i.stage_id and document_id=d.id and signer_id=i.signer_id and role=i.role and expected_fingerprint is not distinct from i.expected_fingerprint and status='ready_for_signer') then raise exception 'CANONICAL_VERSION_CHANGED'; end if;
  update intents set state='signed_pending_validation',candidate_sha256=p_candidate where id=i.id returning * into i;
  return i;
end $$;

create function signing_v2.commit_validated(p_id uuid,p_candidate text,p_version_id uuid,p_byte_size integer,p_report jsonb)
returns uuid language plpgsql security definer set search_path=signing_v2,pg_temp as $$
declare i signing_v2.intents; d signing_v2.documents; prior signing_v2.versions; next_stage uuid;
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
  -- Only the authenticated private validator may supply this report.
  if exists(select 1 from jsonb_object_keys(p_report) key where key not in ('valid','policy','baseSha256','signedSha256','previousSignatureCount','signatureCount','certificate','revocation'))
     or exists(select 1 from jsonb_object_keys(p_report->'certificate') key where key not in ('subject','issuer','serial','fingerprint','notBefore','notAfter')) then raise exception 'INVALID_REPORT'; end if;
  if (p_report->>'valid') is distinct from 'true' or p_report->>'policy' is distinct from 'leapsign-v2-strict-offline-1'
     or p_report->>'baseSha256' is distinct from i.base_sha256 or p_report->>'signedSha256' is distinct from p_candidate
     or p_report->>'revocation' is distinct from 'good' or jsonb_typeof(p_report->'certificate') is distinct from 'object'
     or (p_report->>'previousSignatureCount')::integer is distinct from prior.signature_count
     or (p_report->>'signatureCount')::integer is distinct from prior.signature_count+1 then raise exception 'SIGNATURE_REJECTED'; end if;
  if i.expected_fingerprint is not null and p_report->'certificate'->>'fingerprint' is distinct from i.expected_fingerprint then raise exception 'SIGNER_IDENTITY_MISMATCH'; end if;
  insert into versions(id,document_id,sha256,storage_path,byte_size,parent_id,signature_count,page_count,last_page_width,last_page_height)
  values(p_version_id,d.id,p_candidate,d.id::text||'/versions/'||p_version_id::text||'.pdf',p_byte_size,prior.id,prior.signature_count+1,prior.page_count,prior.last_page_width,prior.last_page_height);
  update intents set state='validated',report=p_report,accepted_version_id=p_version_id where id=i.id;
  update stages set status='validated' where id=i.stage_id;
  select id into next_stage from stages where document_id=d.id and status='ready_for_signer' order by ordinal limit 1;
  update documents set current_version_id=p_version_id,active_stage_id=next_stage,status=case when next_stage is null then 'final_review' else 'ready_for_signer' end where id=d.id;
  insert into audit(intent_id,correlation_id,outcome) values(i.id,i.correlation_id,'validated');
  return p_version_id;
end $$;

create function signing_v2.keep_versions_immutable() returns trigger language plpgsql as $$
begin raise exception 'IMMUTABLE_VERSION'; end $$;
create trigger immutable_versions before update on signing_v2.versions
for each row execute function signing_v2.keep_versions_immutable();

create function signing_v2.reject_intent(p_id uuid,p_candidate text)
returns void language plpgsql security definer set search_path=signing_v2,pg_temp as $$
begin
  update intents set state='rejected' where id=p_id and state='signed_pending_validation' and candidate_sha256=p_candidate;
  if found then insert into audit(intent_id,correlation_id,outcome) select id,correlation_id,'rejected' from intents where id=p_id on conflict do nothing; end if;
end $$;

-- No frontend reads/writes. Public certificate metadata is still personal data.
alter table signing_v2.settings enable row level security;
alter table signing_v2.documents enable row level security;
alter table signing_v2.versions enable row level security;
alter table signing_v2.stages enable row level security;
alter table signing_v2.intents enable row level security;
alter table signing_v2.audit enable row level security;
revoke all on all tables in schema signing_v2 from public;
revoke all on all sequences in schema signing_v2 from public;
revoke all on all functions in schema signing_v2 from public;
commit;
