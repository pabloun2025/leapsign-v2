-- Apply after 001/002 to the dedicated v2 backend only. These PostgREST RPC
-- entry points are private service boundaries: browser roles receive no
-- execute privilege and signing_v2 remains inaccessible.
begin;

create table if not exists signing_v2.operation_budgets(
  actor_id uuid not null,
  operation text not null check(operation in ('create','status','download','prepare','receipt','submit','validation')),
  window_start timestamptz not null,
  used integer not null check(used between 1 and 60),
  primary key(actor_id,operation,window_start)
);

create or replace function public.v2_reserve_operation(p_actor_id uuid,p_operation text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare v_window timestamptz:=date_trunc('minute',now());v_used integer;v_limit integer;
begin
 if p_operation not in ('create','status','download','prepare','receipt','submit','validation') then raise exception 'INVALID_OPERATION';end if;
 if not exists(select 1 from auth.users where id=p_actor_id) then raise exception 'ACTOR_NOT_FOUND';end if;
 v_limit:=case when p_operation in ('create','submit','validation') then 10 else 60 end;
 insert into signing_v2.operation_budgets(actor_id,operation,window_start,used) values(p_actor_id,p_operation,v_window,1)
 on conflict(actor_id,operation,window_start) do update set used=signing_v2.operation_budgets.used+1
 where signing_v2.operation_budgets.used<v_limit returning used into v_used;
 if v_used is null then raise exception 'RATE_LIMITED';end if;
 return jsonb_build_object('reserved',true);
end $$;

create or replace function public.v2_create_process(
  p_owner_id uuid,
  p_document_id uuid,
  p_version_id uuid,
  p_filename text,
  p_sha256 text,
  p_byte_size integer,
  p_page_count integer,
  p_last_page_width real,
  p_last_page_height real,
  p_existing_signature_count integer,
  p_signer_emails text[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_emails text[];
  v_email text;
  v_signer_id uuid;
  v_signer_count integer;
  v_ordinal integer := 0;
  v_stage_id uuid;
  v_first_stage_id uuid;
begin
  if not exists(
    select 1 from signing_v2.settings
    where (external_enabled or direct_enabled) and profile_enabled
  ) then
    raise exception 'V2_DISABLED';
  end if;

  perform 1 from auth.users where id = p_owner_id for key share;
  if not found then
    raise exception 'OWNER_NOT_FOUND';
  end if;

  if p_signer_emails is null or cardinality(p_signer_emails) not between 1 and 20 then
    raise exception 'INVALID_SIGNERS';
  end if;
  select array_agg(lower(btrim(item)) order by ordinality)
    into v_emails
    from unnest(p_signer_emails) with ordinality as requested(item, ordinality);
  v_signer_count := cardinality(v_emails);
  if p_existing_signature_count not between 0 and 19
     or p_existing_signature_count + v_signer_count > 20 then
    raise exception 'INVALID_SIGNATURE_COUNT';
  end if;
  if exists(
    select 1 from unnest(v_emails) as normalized(email)
    where email is null or char_length(email) > 254
      or email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
  ) then
    raise exception 'INVALID_SIGNERS';
  end if;
  if (select count(distinct email) from unnest(v_emails) as normalized(email)) <> v_signer_count then
    raise exception 'DUPLICATE_SIGNER';
  end if;
  if exists(
    select 1 from unnest(v_emails) as normalized(email)
    where (select count(*) from auth.users as candidate where lower(candidate.email) = normalized.email) <> 1
  ) then
    raise exception 'SIGNER_NOT_FOUND';
  end if;

  insert into signing_v2.documents(id, owner_id, current_version_id, active_stage_id, status, filename)
  values(p_document_id, p_owner_id, null, null, 'draft', p_filename);
  insert into signing_v2.versions(
    id, document_id, sha256, storage_path, byte_size, parent_id,
    signature_count, page_count, last_page_width, last_page_height
  ) values(
    p_version_id, p_document_id, p_sha256,
    p_document_id::text || '/versions/' || p_version_id::text || '.pdf',
    p_byte_size, null, p_existing_signature_count, p_page_count, p_last_page_width, p_last_page_height
  );

  foreach v_email in array v_emails loop
    v_ordinal := v_ordinal + 1;
    select id into v_signer_id
      from auth.users
      where lower(email) = v_email
      for key share;
    if v_signer_id is null then
      raise exception 'SIGNER_NOT_FOUND';
    end if;
    v_stage_id := gen_random_uuid();
    insert into signing_v2.stages(id, document_id, ordinal, signer_id, role)
    values(v_stage_id, p_document_id, v_ordinal, v_signer_id, 'signer');
    if v_ordinal = 1 then
      v_first_stage_id := v_stage_id;
    end if;
  end loop;

  update signing_v2.documents
    set current_version_id = p_version_id,
        active_stage_id = v_first_stage_id,
        status = 'ready_for_signer'
    where id = p_document_id;

  return jsonb_build_object(
    'id', p_document_id,
    'filename', p_filename,
    'status', 'ready_for_signer',
    'signerCount', v_signer_count
  );
end
$$;

create or replace function public.v2_get_process_status(
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_document signing_v2.documents%rowtype;
  v_signature_count integer;
  v_stages jsonb;
begin
  select * into v_document
    from signing_v2.documents
    where id = p_document_id and owner_id = p_actor_id;
  if v_document.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if not exists(select 1 from signing_v2.versions where id = v_document.current_version_id and document_id = v_document.id) then
    raise exception 'NOT_FOUND';
  end if;
  select count(*)::integer into v_signature_count from signing_v2.stages
    where document_id=v_document.id and status='validated';
  select coalesce(
      jsonb_agg(jsonb_build_object(
        'ordinal', ordinal,
        'status', status,
        'current', coalesce(id = v_document.active_stage_id,false)
      ) order by ordinal),
      '[]'::jsonb
    ) into v_stages
    from signing_v2.stages
    where document_id = v_document.id;
  return jsonb_build_object(
    'id', v_document.id,
    'filename', v_document.filename,
    'status', v_document.status,
    'signatureCount', v_signature_count,
    'stages', v_stages
  );
end
$$;

create or replace function public.v2_get_authorized_download(
  p_document_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
      'documentId', d.id,
      'versionId', v.id,
      'filename', d.filename,
      'storagePath', v.storage_path,
      'byteSize', v.byte_size,
      'sha256', v.sha256
    ) into v_result
    from signing_v2.documents as d
    join signing_v2.versions as v
      on v.id = d.current_version_id and v.document_id = d.id
    where d.id = p_document_id
      and (
        d.owner_id = p_actor_id
        or (
          d.status = 'ready_for_signer'
          and exists(
            select 1 from signing_v2.stages as s
            where s.id = d.active_stage_id and s.document_id = d.id
              and s.signer_id = p_actor_id and s.status = 'ready_for_signer'
          )
        )
      );
  if v_result is null then
    raise exception 'NOT_FOUND';
  end if;
  return v_result;
end
$$;

create or replace function public.v2_issue_intent(
  p_document_id uuid,
  p_actor_id uuid,
  p_intent_id uuid,
  p_nonce_hash text,
  p_position jsonb,
  p_correlation_id uuid,
  p_issued_at timestamptz,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_intent signing_v2.intents%rowtype;
  v_result jsonb;
begin
  select * into v_intent
    from signing_v2.issue_intent(
      p_document_id, p_actor_id, p_intent_id, p_nonce_hash,
      p_position, p_correlation_id
    );
  if p_issued_at not between now()-interval '30 seconds' and now()+interval '30 seconds'
     or p_expires_at <> p_issued_at+interval '5 minutes' or p_expires_at<=now() then
    raise exception 'INVALID_INTENT_TIME';
  end if;
  update signing_v2.intents set issued_at=p_issued_at,expires_at=p_expires_at
    where id=v_intent.id returning * into v_intent;
  v_result := jsonb_build_object(
    'id', v_intent.id,
    'documentId', v_intent.document_id,
    'versionId', v_intent.version_id,
    'baseSha256', v_intent.base_sha256,
    'stageId', v_intent.stage_id,
    'signerId', v_intent.signer_id,
    'role', v_intent.role,
    'profile', v_intent.profile,
    'position', v_intent.position,
    'issuedAt', v_intent.issued_at,
    'expiresAt', v_intent.expires_at,
    'state', v_intent.state,
    'correlationId', v_intent.correlation_id
  );
  if v_intent.expected_fingerprint is not null then
    v_result := v_result || jsonb_build_object('expectedFingerprint', v_intent.expected_fingerprint);
  end if;
  return v_result;
end
$$;

create or replace function public.v2_get_signing_stage(p_document_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare v jsonb;
begin
 select jsonb_build_object('documentId',d.id,'versionId',ver.id,'baseSha256',ver.sha256,
   'stageId',s.id,'signerId',s.signer_id,'role',s.role,'pageCount',ver.page_count,
   'pageWidth',ver.last_page_width,'pageHeight',ver.last_page_height,'filename',d.filename,
   'previousSignatureCount',ver.signature_count,'storagePath',ver.storage_path,'byteSize',ver.byte_size)
   || case when s.expected_fingerprint is null then '{}'::jsonb else jsonb_build_object('expectedFingerprint',s.expected_fingerprint) end into v
 from signing_v2.documents d join signing_v2.stages s on s.id=d.active_stage_id and s.document_id=d.id
 join signing_v2.versions ver on ver.id=d.current_version_id and ver.document_id=d.id
 where d.id=p_document_id and d.status='ready_for_signer' and s.status='ready_for_signer' and s.signer_id=p_actor_id;
 if v is null then raise exception 'NOT_FOUND'; end if; return v;
end $$;

create or replace function public.v2_get_intent_download(p_intent_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare i signing_v2.intents%rowtype; d signing_v2.documents%rowtype; s signing_v2.stages%rowtype; v signing_v2.versions%rowtype; result jsonb;
begin
 select * into i from signing_v2.intents where id=p_intent_id and signer_id=p_actor_id;
 select * into d from signing_v2.documents where id=i.document_id;
 select * into s from signing_v2.stages where id=i.stage_id and document_id=i.document_id;
 select * into v from signing_v2.versions where id=i.version_id and document_id=i.document_id;
 if i.id is null or i.state<>'signature_intent_issued' or i.expires_at<=now() or d.status<>'ready_for_signer'
   or d.current_version_id<>i.version_id or d.active_stage_id<>i.stage_id or s.status<>'ready_for_signer' then raise exception 'NOT_FOUND'; end if;
 result:=jsonb_build_object('intent',jsonb_build_object('id',i.id,'documentId',i.document_id,'versionId',i.version_id,
  'baseSha256',i.base_sha256,'stageId',i.stage_id,'signerId',i.signer_id,'role',i.role,'profile',i.profile,
  'position',i.position,'issuedAt',i.issued_at,'expiresAt',i.expires_at,'state',i.state,'correlationId',i.correlation_id),
  'current',jsonb_build_object('documentId',d.id,'versionId',v.id,'baseSha256',v.sha256,'stageId',s.id,
  'signerId',s.signer_id,'role',s.role,'pageCount',v.page_count,'pageWidth',v.last_page_width,'pageHeight',v.last_page_height),
  'filename',d.filename,'previousSignatureCount',v.signature_count,'storagePath',v.storage_path,'byteSize',v.byte_size);
 if i.expected_fingerprint is not null then result:=jsonb_set(result,'{intent,expectedFingerprint}',to_jsonb(i.expected_fingerprint),true);result:=jsonb_set(result,'{current,expectedFingerprint}',to_jsonb(i.expected_fingerprint),true);end if;
 return result;
end $$;

create or replace function public.v2_get_version_storage(p_version_id uuid,p_actor_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare result jsonb;
begin
 select jsonb_build_object('storagePath',v.storage_path,'byteSize',v.byte_size,'sha256',v.sha256) into result
 from signing_v2.versions v join signing_v2.documents d on d.id=v.document_id and d.current_version_id=v.id
 where v.id=p_version_id and (d.owner_id=p_actor_id or exists(select 1 from signing_v2.stages s where s.id=d.active_stage_id and s.document_id=d.id and s.signer_id=p_actor_id));
 if result is null then raise exception 'NOT_FOUND';end if;return result;
end $$;

create or replace function public.v2_claim_intent(
  p_intent_id uuid,
  p_actor_id uuid,
  p_nonce_hash text,
  p_candidate_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_document_id uuid;
  v_document signing_v2.documents%rowtype;
  v_intent signing_v2.intents%rowtype;
  v_stage signing_v2.stages%rowtype;
  v_version signing_v2.versions%rowtype;
  v_intent_json jsonb;
  v_current_json jsonb;
  v_result jsonb;
begin
  if not exists(
    select 1 from signing_v2.settings
    where (external_enabled or direct_enabled) and profile_enabled
  ) then
    raise exception 'V2_DISABLED';
  end if;
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_candidate_sha256 is null or p_candidate_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'UNAUTHORIZED';
  end if;

  select document_id into v_document_id
    from signing_v2.intents where id = p_intent_id;
  select * into v_document
    from signing_v2.documents where id = v_document_id for update;
  select * into v_intent
    from signing_v2.intents where id = p_intent_id for update;
  if v_intent.id is null
     or v_intent.signer_id is distinct from p_actor_id
     or v_intent.nonce_hash is distinct from p_nonce_hash then
    raise exception 'UNAUTHORIZED';
  end if;

  if v_intent.state = 'validated' then
    if v_intent.candidate_sha256 is distinct from p_candidate_sha256
       or v_intent.report is null or v_intent.accepted_version_id is null then
      raise exception 'INTENT_UNAVAILABLE';
    end if;
  elsif v_intent.state = 'signed_pending_validation' then
    if v_intent.candidate_sha256 is distinct from p_candidate_sha256 then
      raise exception 'INTENT_UNAVAILABLE';
    end if;
  elsif v_intent.state = 'signature_intent_issued' then
    if v_intent.expires_at <= now() then
      raise exception 'INTENT_EXPIRED';
    end if;
    if v_document.id is null
       or v_document.status is distinct from 'ready_for_signer'
       or v_document.current_version_id is distinct from v_intent.version_id
       or v_document.active_stage_id is distinct from v_intent.stage_id
       or not exists(
         select 1 from signing_v2.stages as current_stage
         where current_stage.id = v_intent.stage_id
           and current_stage.document_id = v_document.id
           and current_stage.signer_id = v_intent.signer_id
           and current_stage.role = v_intent.role
           and current_stage.expected_fingerprint is not distinct from v_intent.expected_fingerprint
           and current_stage.status = 'ready_for_signer'
       ) then
      raise exception 'CANONICAL_VERSION_CHANGED';
    end if;
    update signing_v2.intents
      set state = 'signed_pending_validation', candidate_sha256 = p_candidate_sha256
      where id = v_intent.id
      returning * into v_intent;
  else
    raise exception 'INTENT_UNAVAILABLE';
  end if;

  select * into v_stage from signing_v2.stages
    where id = v_intent.stage_id and document_id = v_intent.document_id;
  select * into v_version from signing_v2.versions
    where id = v_intent.version_id and document_id = v_intent.document_id;
  if v_stage.id is null or v_version.id is null then
    raise exception 'INTENT_UNAVAILABLE';
  end if;

  v_intent_json := jsonb_build_object(
    'id', v_intent.id,
    'documentId', v_intent.document_id,
    'versionId', v_intent.version_id,
    'baseSha256', v_intent.base_sha256,
    'stageId', v_intent.stage_id,
    'signerId', v_intent.signer_id,
    'role', v_intent.role,
    'profile', v_intent.profile,
    'position', v_intent.position,
    'issuedAt', v_intent.issued_at,
    'expiresAt', v_intent.expires_at,
    'state', v_intent.state,
    'correlationId', v_intent.correlation_id
  );
  v_current_json := jsonb_build_object(
    'documentId', v_intent.document_id,
    'versionId', v_version.id,
    'baseSha256', v_version.sha256,
    'stageId', v_stage.id,
    'signerId', v_stage.signer_id,
    'role', v_stage.role,
    'pageCount', v_version.page_count,
    'pageWidth', v_version.last_page_width,
    'pageHeight', v_version.last_page_height
  );
  if v_intent.expected_fingerprint is not null then
    v_intent_json := v_intent_json || jsonb_build_object('expectedFingerprint', v_intent.expected_fingerprint);
    v_current_json := v_current_json || jsonb_build_object('expectedFingerprint', v_intent.expected_fingerprint);
  end if;
  v_result := jsonb_build_object('intent', v_intent_json, 'current', v_current_json);
  if v_intent.state = 'validated' then
    v_result := v_result || jsonb_build_object('replay', v_intent.report);
  end if;
  return v_result;
end
$$;

create or replace function public.v2_commit_validated(
  p_intent_id uuid,
  p_actor_id uuid,
  p_nonce_hash text,
  p_candidate_sha256 text,
  p_version_id uuid,
  p_byte_size integer,
  p_report jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_document_id uuid;
  v_document signing_v2.documents%rowtype;
  v_intent signing_v2.intents%rowtype;
  v_accepted_version_id uuid;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_candidate_sha256 is null or p_candidate_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'UNAUTHORIZED';
  end if;
  select document_id into v_document_id
    from signing_v2.intents where id = p_intent_id;
  select * into v_document
    from signing_v2.documents where id = v_document_id for update;
  select * into v_intent
    from signing_v2.intents where id = p_intent_id for update;
  if v_intent.id is null
     or v_intent.signer_id is distinct from p_actor_id
     or v_intent.nonce_hash is distinct from p_nonce_hash then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_intent.candidate_sha256 is distinct from p_candidate_sha256
     or v_intent.state not in ('signed_pending_validation', 'validated') then
    raise exception 'INTENT_UNAVAILABLE';
  end if;
  select signing_v2.commit_validated(
      p_intent_id, p_candidate_sha256, p_version_id, p_byte_size, p_report
    ) into v_accepted_version_id;
  if v_accepted_version_id is null then
    raise exception 'INTENT_UNAVAILABLE';
  end if;
  return jsonb_build_object('acceptedVersionId', v_accepted_version_id);
end
$$;

create or replace function public.v2_get_intent_receipt(
  p_intent_id uuid,
  p_actor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_intent signing_v2.intents%rowtype;
  v_state text;
begin
  select * into v_intent from signing_v2.intents
    where id = p_intent_id and signer_id = p_actor_id;
  if v_intent.id is null then
    raise exception 'NOT_FOUND';
  end if;
  if v_intent.state = 'validated' then
    if v_intent.report is null or v_intent.accepted_version_id is null then
      raise exception 'NOT_FOUND';
    end if;
    return jsonb_build_object(
      'state', 'validated',
      'acceptedVersionId', v_intent.accepted_version_id,
      'report', v_intent.report
    );
  end if;
  v_state := v_intent.state;
  if v_state in ('signature_intent_issued', 'signed_pending_validation')
     and v_intent.expires_at <= now() then
    v_state := 'expired';
  end if;
  return jsonb_build_object('state', v_state);
end
$$;

create or replace function public.v2_reject_intent(
  p_intent_id uuid,
  p_actor_id uuid,
  p_nonce_hash text,
  p_candidate_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, signing_v2, auth, pg_temp
as $$
declare
  v_document_id uuid;
  v_document signing_v2.documents%rowtype;
  v_intent signing_v2.intents%rowtype;
begin
  if p_nonce_hash is null or p_nonce_hash !~ '^[a-f0-9]{64}$'
     or p_candidate_sha256 is null or p_candidate_sha256 !~ '^[a-f0-9]{64}$' then
    raise exception 'UNAUTHORIZED';
  end if;
  select document_id into v_document_id
    from signing_v2.intents where id = p_intent_id;
  select * into v_document
    from signing_v2.documents where id = v_document_id for update;
  select * into v_intent
    from signing_v2.intents where id = p_intent_id for update;
  if v_intent.id is null
     or v_intent.signer_id is distinct from p_actor_id
     or v_intent.nonce_hash is distinct from p_nonce_hash then
    raise exception 'UNAUTHORIZED';
  end if;
  if v_intent.candidate_sha256 is distinct from p_candidate_sha256 then
    raise exception 'INTENT_UNAVAILABLE';
  end if;
  if v_intent.state = 'validated' then
    return jsonb_build_object('state', 'validated');
  end if;
  if v_intent.state = 'rejected' then
    return jsonb_build_object('state', 'rejected');
  end if;
  if v_intent.state <> 'signed_pending_validation' then
    raise exception 'INTENT_UNAVAILABLE';
  end if;
  perform signing_v2.reject_intent(p_intent_id, p_candidate_sha256);
  return jsonb_build_object('state', 'rejected');
end
$$;

alter function public.v2_create_process(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text[]) owner to postgres;
alter function public.v2_reserve_operation(uuid,text) owner to postgres;
alter function public.v2_get_process_status(uuid,uuid) owner to postgres;
alter function public.v2_get_authorized_download(uuid,uuid) owner to postgres;
alter function public.v2_issue_intent(uuid,uuid,uuid,text,jsonb,uuid,timestamptz,timestamptz) owner to postgres;
alter function public.v2_get_signing_stage(uuid,uuid) owner to postgres;
alter function public.v2_get_intent_download(uuid,uuid) owner to postgres;
alter function public.v2_get_version_storage(uuid,uuid) owner to postgres;
alter function public.v2_claim_intent(uuid,uuid,text,text) owner to postgres;
alter function public.v2_commit_validated(uuid,uuid,text,text,uuid,integer,jsonb) owner to postgres;
alter function public.v2_get_intent_receipt(uuid,uuid) owner to postgres;
alter function public.v2_reject_intent(uuid,uuid,text,text) owner to postgres;

revoke all on schema signing_v2 from public,anon,authenticated,service_role;
revoke all on all tables in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on all sequences in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on all functions in schema signing_v2 from public,anon,authenticated,service_role;

revoke all on function public.v2_create_process(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text[]) from public,anon,authenticated,service_role;
revoke all on function public.v2_reserve_operation(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_process_status(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_authorized_download(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_issue_intent(uuid,uuid,uuid,text,jsonb,uuid,timestamptz,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_signing_stage(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_intent_download(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_version_storage(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_claim_intent(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_commit_validated(uuid,uuid,text,text,uuid,integer,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.v2_get_intent_receipt(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_reject_intent(uuid,uuid,text,text) from public,anon,authenticated,service_role;

grant execute on function public.v2_create_process(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text[]) to service_role;
grant execute on function public.v2_reserve_operation(uuid,text) to service_role;
grant execute on function public.v2_get_process_status(uuid,uuid) to service_role;
grant execute on function public.v2_get_authorized_download(uuid,uuid) to service_role;
grant execute on function public.v2_issue_intent(uuid,uuid,uuid,text,jsonb,uuid,timestamptz,timestamptz) to service_role;
grant execute on function public.v2_get_signing_stage(uuid,uuid) to service_role;
grant execute on function public.v2_get_intent_download(uuid,uuid) to service_role;
grant execute on function public.v2_get_version_storage(uuid,uuid) to service_role;
grant execute on function public.v2_claim_intent(uuid,uuid,text,text) to service_role;
grant execute on function public.v2_commit_validated(uuid,uuid,text,text,uuid,integer,jsonb) to service_role;
grant execute on function public.v2_get_intent_receipt(uuid,uuid) to service_role;
grant execute on function public.v2_reject_intent(uuid,uuid,text,text) to service_role;

commit;
