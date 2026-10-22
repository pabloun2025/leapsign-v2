-- LeapSign v2 parity foundation. Dedicated v2 project only.
-- All browser roles remain outside signing_v2; the Worker is the service boundary.
begin;

alter table signing_v2.operation_budgets drop constraint operation_budgets_operation_check;
alter table signing_v2.operation_budgets add constraint operation_budgets_operation_check
 check(operation in ('create','status','download','prepare','receipt','submit','validation','finalize','contacts','queue','process_action','final_share','arcade','admin'));

create table signing_v2.process_access(
 document_id uuid primary key references signing_v2.documents(id) on delete cascade,
 owner_id uuid not null,
 mode text not null check(mode in ('directed','open_queue')),
 message text not null default '' check(char_length(message)<=2000),
 expected_signatures integer check(expected_signatures between 1 and 20),
 access_secret_hash text check(access_secret_hash is null or access_secret_hash ~ '^[a-f0-9]{64}$'),
 paused boolean not null default false,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index process_access_owner on signing_v2.process_access(owner_id,created_at desc);

create table signing_v2.queue_entries(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references signing_v2.documents(id) on delete cascade,
 actor_id uuid not null,email text check(email is null or char_length(email) between 3 and 254),
 display_name text check(display_name is null or char_length(display_name) between 1 and 120),
 session_hash text not null unique check(session_hash ~ '^[a-f0-9]{64}$'),
 sequence bigint generated always as identity,
 status text not null default 'waiting' check(status in ('waiting','active','completed','left')),
 joined_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(document_id,actor_id)
);
create index queue_entries_waiting on signing_v2.queue_entries(document_id,sequence) where status='waiting';

create table signing_v2.turn_leases(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references signing_v2.documents(id) on delete cascade,
 queue_entry_id uuid not null references signing_v2.queue_entries(id) on delete cascade,
 stage_id uuid not null unique references signing_v2.stages(id),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 status text not null default 'active' check(status in ('active','released','expired','completed')),
 expires_at timestamptz not null,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(expires_at>created_at)
);
create unique index one_active_turn_lease on signing_v2.turn_leases(document_id) where status='active';

create table signing_v2.owner_contacts(
 id uuid primary key default gen_random_uuid(),owner_id uuid not null,email text not null,
 display_name text check(display_name is null or char_length(display_name) between 1 and 120),
 usage_count integer not null default 0 check(usage_count between 0 and 1000000),
 last_used_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 check(char_length(email) between 3 and 254),unique(owner_id,email)
);
create index owner_contacts_recent on signing_v2.owner_contacts(owner_id,last_used_at desc nulls last,created_at desc);

create table signing_v2.process_incidents(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references signing_v2.documents(id) on delete cascade,
 actor_id uuid not null,stage_id uuid references signing_v2.stages(id),
 reason text not null check(reason in ('signature_position','wrong_document','unreadable_pdf','other')),
 note text not null default '' check(char_length(note)<=1000),status text not null default 'open' check(status in ('open','resolved')),
 created_at timestamptz not null default now(),resolved_at timestamptz
);
create table signing_v2.process_events(
 id bigint generated always as identity primary key,
 document_id uuid not null references signing_v2.documents(id) on delete cascade,
 actor_id uuid not null,event text not null check(event in ('pause','resume','release_turn','rollback','cancel','complete','purge')),
 reason text not null default '' check(char_length(reason)<=1000),created_at timestamptz not null default now()
);
create index process_events_document on signing_v2.process_events(document_id,created_at desc,id desc);

create table signing_v2.final_shares(
 id uuid primary key default gen_random_uuid(),document_id uuid not null references signing_v2.documents(id) on delete cascade,
 version_id uuid not null references signing_v2.versions(id),owner_id uuid not null,
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null,revoked_at timestamptz,created_at timestamptz not null default now(),
 check(expires_at>created_at)
);
create index final_shares_document_active on signing_v2.final_shares(document_id,expires_at) where revoked_at is null;

create table signing_v2.arcade_runs(
 id uuid primary key default gen_random_uuid(),ticket_hash text not null unique check(ticket_hash ~ '^[a-f0-9]{64}$'),
 seed integer not null,origin_hash text not null check(origin_hash ~ '^[a-f0-9]{64}$'),
 started_at timestamptz not null default now(),expires_at timestamptz not null,finished_at timestamptz,
 consumed boolean not null default false,check(expires_at>started_at and expires_at<=started_at+interval '10 minutes')
);
create index arcade_runs_active on signing_v2.arcade_runs(expires_at) where consumed=false;
create table signing_v2.arcade_records(
 id uuid primary key default gen_random_uuid(),run_id uuid not null unique references signing_v2.arcade_runs(id) on delete cascade,
 alias text not null check(alias ~ '^[[:alnum:] .-]{2,24}$'),score integer not null check(score between 0 and 1000000),
 created_at timestamptz not null default now()
);
create index arcade_records_podium on signing_v2.arcade_records(score desc,created_at,id);

create table signing_v2.email_templates(
 key text primary key check(key in ('signer_invitation','signer_turn','signer_reminder','signature_received','process_blocked','process_completed','final_review','receipt','final_download')),
 subject text not null check(char_length(subject) between 1 and 200),
 text_body text not null check(char_length(text_body) between 1 and 10000),
 html_body text not null check(char_length(html_body) between 1 and 30000),
 version integer not null default 1 check(version>0),updated_by uuid,updated_at timestamptz not null default now()
);

create table signing_v2.lifecycle_jobs(
 id uuid primary key default gen_random_uuid(),kind text not null check(kind in ('promote_queue','expire_turn','purge_process','delete_object')),
 document_id uuid references signing_v2.documents(id) on delete cascade,payload jsonb not null default '{}'::jsonb check(jsonb_typeof(payload)='object'),
 status text not null default 'pending' check(status in ('pending','processing','failed','completed','dead_letter')),
 attempts integer not null default 0 check(attempts between 0 and 8),available_at timestamptz not null default now(),
 locked_at timestamptz,error_code text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index lifecycle_jobs_ready on signing_v2.lifecycle_jobs(available_at,created_at) where status in ('pending','failed','processing');

create table signing_v2.admin_roles(
 user_id uuid primary key,role text not null check(role in ('operator','superadmin')),
 created_by uuid not null,created_at timestamptz not null default now()
);
create table signing_v2.admin_settings(
 singleton boolean primary key default true check(singleton),communications_enabled boolean not null default true,
 maintenance_enabled boolean not null default false,updated_by uuid,updated_at timestamptz not null default now()
);
insert into signing_v2.admin_settings default values;

alter table signing_v2.process_access enable row level security;
alter table signing_v2.queue_entries enable row level security;
alter table signing_v2.turn_leases enable row level security;
alter table signing_v2.owner_contacts enable row level security;
alter table signing_v2.process_incidents enable row level security;
alter table signing_v2.process_events enable row level security;
alter table signing_v2.final_shares enable row level security;
alter table signing_v2.arcade_runs enable row level security;
alter table signing_v2.arcade_records enable row level security;
alter table signing_v2.email_templates enable row level security;
alter table signing_v2.lifecycle_jobs enable row level security;
alter table signing_v2.admin_roles enable row level security;
alter table signing_v2.admin_settings enable row level security;
revoke all on all tables in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on all sequences in schema signing_v2 from public,anon,authenticated,service_role;

create function public.v2_upsert_contact(p_owner_id uuid,p_contact_id uuid,p_email text,p_display_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare result signing_v2.owner_contacts%rowtype;normalized text:=lower(btrim(p_email));
begin
 if not exists(select 1 from auth.users where id=p_owner_id and deleted_at is null) or normalized!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or char_length(coalesce(p_display_name,''))>120 then raise exception 'INVALID_CONTACT';end if;
 insert into signing_v2.owner_contacts(id,owner_id,email,display_name) values(coalesce(p_contact_id,gen_random_uuid()),p_owner_id,normalized,nullif(btrim(p_display_name),''))
 on conflict(owner_id,email) do update set display_name=excluded.display_name,updated_at=now()
 returning * into result;
 return jsonb_build_object('id',result.id,'email',result.email,'displayName',result.display_name,'usageCount',result.usage_count,'lastUsedAt',result.last_used_at);
end $$;

create function public.v2_join_queue(p_document_id uuid,p_actor_id uuid,p_session_hash text,p_email text,p_display_name text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare v_access signing_v2.process_access%rowtype;entry signing_v2.queue_entries%rowtype;position integer;
begin
 select pa.* into v_access from signing_v2.process_access pa where pa.document_id=p_document_id for update of pa;
 if v_access.document_id is null or v_access.mode<>'open_queue' or v_access.paused or p_session_hash!~'^[a-f0-9]{64}$' then raise exception 'ROUND_UNAVAILABLE';end if;
 insert into signing_v2.queue_entries(document_id,actor_id,email,display_name,session_hash) values(p_document_id,p_actor_id,nullif(lower(btrim(p_email)),''),nullif(btrim(p_display_name),''),p_session_hash)
 on conflict(document_id,actor_id) do update set updated_at=now() returning * into entry;
 select count(*)::integer into position from signing_v2.queue_entries where document_id=p_document_id and status='waiting' and sequence<=entry.sequence;
 return jsonb_build_object('entryId',entry.id,'actorId',entry.actor_id,'status',entry.status,'position',case when entry.status='waiting' then position else 0 end);
end $$;

create function public.v2_claim_turn(p_document_id uuid,p_actor_id uuid,p_token_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare v_access signing_v2.process_access%rowtype;entry signing_v2.queue_entries%rowtype;lease signing_v2.turn_leases%rowtype;stage_id uuid;next_ordinal integer;
begin
 select pa.* into v_access from signing_v2.process_access pa where pa.document_id=p_document_id for update of pa;
 if v_access.document_id is null or v_access.mode<>'open_queue' or v_access.paused or p_token_hash!~'^[a-f0-9]{64}$' then raise exception 'ROUND_UNAVAILABLE';end if;
 update signing_v2.turn_leases set status='expired',updated_at=now() where document_id=p_document_id and status='active' and expires_at<=now();
 update signing_v2.queue_entries q set status='waiting',updated_at=now() from signing_v2.turn_leases l where l.queue_entry_id=q.id and l.document_id=p_document_id and l.status='expired' and q.status='active';
 if exists(select 1 from signing_v2.turn_leases where document_id=p_document_id and status='active') then raise exception 'TURN_BUSY';end if;
 select * into entry from signing_v2.queue_entries where document_id=p_document_id and status='waiting' order by sequence for update skip locked limit 1;
 if entry.id is null or entry.actor_id is distinct from p_actor_id then raise exception 'NOT_YOUR_TURN';end if;
 select coalesce(max(ordinal),0)+1 into next_ordinal from signing_v2.stages where document_id=p_document_id;
 if next_ordinal>20 then raise exception 'SIGNATURE_CAPACITY_REACHED';end if;
 stage_id:=gen_random_uuid();
 insert into signing_v2.stages(id,document_id,ordinal,signer_id,role) values(stage_id,p_document_id,next_ordinal,p_actor_id,'signer');
 insert into signing_v2.turn_leases(document_id,queue_entry_id,stage_id,token_hash,expires_at) values(p_document_id,entry.id,stage_id,p_token_hash,now()+interval '10 minutes') returning * into lease;
 update signing_v2.queue_entries set status='active',updated_at=now() where id=entry.id;
 update signing_v2.documents set active_stage_id=stage_id,status='ready_for_signer' where id=p_document_id;
 return jsonb_build_object('leaseId',lease.id,'stageId',stage_id,'actorId',p_actor_id,'expiresAt',lease.expires_at);
end $$;

create function public.v2_process_action(p_document_id uuid,p_owner_id uuid,p_action text,p_version_id uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare d signing_v2.documents%rowtype;
begin
 select * into d from signing_v2.documents where id=p_document_id for update;
 if d.id is null or d.owner_id is distinct from p_owner_id then raise exception 'NOT_FOUND';end if;
 if p_action='pause' then update signing_v2.process_access set paused=true,updated_at=now() where document_id=d.id;
 elsif p_action='resume' then update signing_v2.process_access set paused=false,updated_at=now() where document_id=d.id;
 elsif p_action='rollback' then
  if not exists(select 1 from signing_v2.versions where id=p_version_id and document_id=d.id) then raise exception 'VERSION_NOT_FOUND';end if;
  update signing_v2.intents set state='expired' where document_id=d.id and state in ('signature_intent_issued','signed_pending_validation');
  update signing_v2.guest_sessions set revoked_at=now() where stage_id in(select id from signing_v2.stages where document_id=d.id) and revoked_at is null;
  update signing_v2.documents set current_version_id=p_version_id where id=d.id;
 elsif p_action='cancel' then update signing_v2.documents set status='failed',active_stage_id=null where id=d.id;
 elsif p_action not in ('release_turn','complete','purge') then raise exception 'INVALID_ACTION';end if;
 insert into signing_v2.process_events(document_id,actor_id,event,reason) values(d.id,p_owner_id,p_action,left(coalesce(p_reason,''),1000));
 return jsonb_build_object('id',d.id,'action',p_action,'ok',true);
end $$;

create function public.v2_create_final_share(p_document_id uuid,p_owner_id uuid,p_token_hash text,p_expires_at timestamptz)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare d signing_v2.documents%rowtype;share signing_v2.final_shares%rowtype;
begin
 select * into d from signing_v2.documents where id=p_document_id for update;
 if d.id is null or d.owner_id is distinct from p_owner_id or d.status<>'completed' or d.current_version_id is null or p_token_hash!~'^[a-f0-9]{64}$' or p_expires_at<=now() or p_expires_at>now()+interval '5 days' then raise exception 'FINAL_SHARE_UNAVAILABLE';end if;
 update signing_v2.final_shares set revoked_at=now() where document_id=d.id and revoked_at is null;
 insert into signing_v2.final_shares(document_id,version_id,owner_id,token_hash,expires_at) values(d.id,d.current_version_id,p_owner_id,p_token_hash,p_expires_at) returning * into share;
 return jsonb_build_object('id',share.id,'documentId',share.document_id,'expiresAt',share.expires_at);
end $$;

create function public.v2_start_arcade(p_ticket_hash text,p_origin_hash text,p_seed integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare run signing_v2.arcade_runs%rowtype;
begin
 if p_ticket_hash!~'^[a-f0-9]{64}$' or p_origin_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_ARCADE_REQUEST';end if;
 delete from signing_v2.arcade_runs where expires_at<=now() and consumed=false;
 if (select count(*) from signing_v2.arcade_runs where started_at>now()-interval '1 day')>=300 or (select count(*) from signing_v2.arcade_runs where origin_hash=p_origin_hash and started_at>now()-interval '1 hour')>=10 then raise exception 'ARCADE_RATE_LIMITED';end if;
 insert into signing_v2.arcade_runs(ticket_hash,origin_hash,seed,expires_at) values(p_ticket_hash,p_origin_hash,p_seed,now()+interval '10 minutes') returning * into run;
 return jsonb_build_object('runId',run.id,'seed',run.seed,'expiresAt',run.expires_at);
end $$;

create function public.v2_finish_arcade(p_ticket_hash text,p_alias text,p_score integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare run signing_v2.arcade_runs%rowtype;
begin
 perform pg_advisory_xact_lock(hashtext('leapsign-v2-arcade-podium'));
 select * into run from signing_v2.arcade_runs where ticket_hash=p_ticket_hash for update;
 if run.id is null or run.consumed or run.expires_at<=now() or p_alias!~'^[[:alnum:] .-]{2,24}$' or p_score not between 0 and 1000000 then raise exception 'INVALID_ARCADE_RESULT';end if;
 update signing_v2.arcade_runs set consumed=true,finished_at=now() where id=run.id;
 insert into signing_v2.arcade_records(run_id,alias,score) values(run.id,p_alias,p_score);
 delete from signing_v2.arcade_records where id in(select id from signing_v2.arcade_records order by score desc,created_at,id offset 3);
 return jsonb_build_object('accepted',true,'score',p_score);
end $$;

create function public.v2_claim_lifecycle_jobs(p_limit integer default 20)
returns setof signing_v2.lifecycle_jobs language sql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
 with candidates as(select id from signing_v2.lifecycle_jobs where ((status in ('pending','failed') and available_at<=now()) or (status='processing' and locked_at<now()-interval '10 minutes')) order by available_at,created_at for update skip locked limit least(greatest(p_limit,1),20))
 update signing_v2.lifecycle_jobs j set status='processing',locked_at=now(),updated_at=now() from candidates c where j.id=c.id returning j.*
$$;

create function public.v2_list_contacts(p_owner_id uuid)
returns jsonb language sql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email,'displayName',display_name,'usageCount',usage_count,'lastUsedAt',last_used_at) order by last_used_at desc nulls last,created_at desc),'[]'::jsonb)
 from signing_v2.owner_contacts where owner_id=p_owner_id
$$;

create function public.v2_delete_contact(p_owner_id uuid,p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin delete from signing_v2.owner_contacts where id=p_contact_id and owner_id=p_owner_id;if not found then raise exception 'NOT_FOUND';end if;return jsonb_build_object('ok',true);end $$;

create function public.v2_create_parity_process(
 p_owner_id uuid,p_client_ip_hash text,p_document_id uuid,p_version_id uuid,p_filename text,p_sha256 text,p_byte_size integer,
 p_page_count integer,p_last_page_width real,p_last_page_height real,p_existing_signature_count integer,
 p_signer_emails text[],p_invitation_tokens text[],p_mode text,p_message text,p_expected_signatures integer,p_access_secret_hash text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare result jsonb;normalized text;
begin
 if p_mode not in ('directed','open_queue') or char_length(coalesce(p_message,''))>2000 or (p_access_secret_hash is not null and p_access_secret_hash!~'^[a-f0-9]{64}$') or (p_expected_signatures is not null and p_expected_signatures not between 1 and 20) then raise exception 'INVALID_PROCESS_OPTIONS';end if;
 if p_mode='directed' then
  if p_expected_signatures is distinct from cardinality(p_signer_emails) or p_access_secret_hash is not null then raise exception 'INVALID_PROCESS_OPTIONS';end if;
  result:=public.v2_create_process(p_owner_id,p_client_ip_hash,p_document_id,p_version_id,p_filename,p_sha256,p_byte_size,p_page_count,p_last_page_width,p_last_page_height,p_existing_signature_count,p_signer_emails,p_invitation_tokens);
 else
  if cardinality(p_signer_emails)<>0 or cardinality(p_invitation_tokens)<>0 or not exists(select 1 from signing_v2.settings where (external_enabled or direct_enabled) and profile_enabled) or not exists(select 1 from auth.users where id=p_owner_id and deleted_at is null and (banned_until is null or banned_until<=now())) or p_client_ip_hash!~'^[a-f0-9]{64}$' or p_existing_signature_count not between 0 and 19 then raise exception 'INVALID_PROCESS_OPTIONS';end if;
  insert into signing_v2.documents(id,owner_id,current_version_id,active_stage_id,status,filename) values(p_document_id,p_owner_id,null,null,'draft',p_filename);
  insert into signing_v2.versions(id,document_id,sha256,storage_path,byte_size,parent_id,signature_count,page_count,last_page_width,last_page_height) values(p_version_id,p_document_id,p_sha256,p_document_id::text||'/versions/'||p_version_id::text||'.pdf',p_byte_size,null,p_existing_signature_count,p_page_count,p_last_page_width,p_last_page_height);
  update signing_v2.documents set current_version_id=p_version_id,status='ready_for_signer' where id=p_document_id;
  result:=jsonb_build_object('id',p_document_id,'filename',p_filename,'status','ready_for_signer','signerCount',0);
 end if;
 insert into signing_v2.process_access(document_id,owner_id,mode,message,expected_signatures,access_secret_hash) values(p_document_id,p_owner_id,p_mode,coalesce(p_message,''),p_expected_signatures,p_access_secret_hash);
 foreach normalized in array p_signer_emails loop update signing_v2.owner_contacts set usage_count=usage_count+1,last_used_at=now(),updated_at=now() where owner_id=p_owner_id and email=lower(btrim(normalized));end loop;
 return result;
end $$;

alter function public.v2_upsert_contact(uuid,uuid,text,text) owner to postgres;
alter function public.v2_join_queue(uuid,uuid,text,text,text) owner to postgres;
alter function public.v2_claim_turn(uuid,uuid,text) owner to postgres;
alter function public.v2_process_action(uuid,uuid,text,uuid,text) owner to postgres;
alter function public.v2_create_final_share(uuid,uuid,text,timestamptz) owner to postgres;
alter function public.v2_start_arcade(text,text,integer) owner to postgres;
alter function public.v2_finish_arcade(text,text,integer) owner to postgres;
alter function public.v2_claim_lifecycle_jobs(integer) owner to postgres;
alter function public.v2_list_contacts(uuid) owner to postgres;
alter function public.v2_delete_contact(uuid,uuid) owner to postgres;
alter function public.v2_create_parity_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[],text,text,integer,text) owner to postgres;

revoke all on all functions in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on function public.v2_upsert_contact(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_join_queue(uuid,uuid,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_claim_turn(uuid,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_process_action(uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_create_final_share(uuid,uuid,text,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.v2_start_arcade(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.v2_finish_arcade(text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.v2_claim_lifecycle_jobs(integer) from public,anon,authenticated,service_role;
revoke all on function public.v2_list_contacts(uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_delete_contact(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.v2_create_parity_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[],text,text,integer,text) from public,anon,authenticated,service_role;
grant execute on function public.v2_upsert_contact(uuid,uuid,text,text) to service_role;
grant execute on function public.v2_join_queue(uuid,uuid,text,text,text) to service_role;
grant execute on function public.v2_claim_turn(uuid,uuid,text) to service_role;
grant execute on function public.v2_process_action(uuid,uuid,text,uuid,text) to service_role;
grant execute on function public.v2_create_final_share(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.v2_start_arcade(text,text,integer) to service_role;
grant execute on function public.v2_finish_arcade(text,text,integer) to service_role;
grant execute on function public.v2_claim_lifecycle_jobs(integer) to service_role;
grant execute on function public.v2_list_contacts(uuid) to service_role;
grant execute on function public.v2_delete_contact(uuid,uuid) to service_role;
grant execute on function public.v2_create_parity_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[],text,text,integer,text) to service_role;

commit;
