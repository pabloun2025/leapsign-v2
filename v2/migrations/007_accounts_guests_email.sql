-- Dedicated v2 only. Owner accounts stay in Supabase Auth; invited signers use
-- one-use opaque links and server-held guest sessions. No object is exposed to
-- anon/authenticated roles: the Worker is the only service boundary.
begin;

create table signing_v2.signer_invitations(
 id uuid primary key default gen_random_uuid(), stage_id uuid not null unique references signing_v2.stages(id),
 actor_id uuid not null unique, signer_email text not null check(char_length(signer_email) between 3 and 254),
 token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), invitation_url text,
 expires_at timestamptz not null, exchanged_at timestamptz,
 created_at timestamptz not null default now(), check(expires_at>created_at)
);
create table signing_v2.guest_sessions(
 id uuid primary key default gen_random_uuid(), actor_id uuid not null references signing_v2.signer_invitations(actor_id),
 stage_id uuid not null references signing_v2.stages(id), session_hash text not null unique check(session_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, revoked_at timestamptz, created_at timestamptz not null default now(),
 check(expires_at>created_at)
);
create index guest_sessions_actor_active on signing_v2.guest_sessions(actor_id,expires_at) where revoked_at is null;

create table signing_v2.email_suppressions(
 recipient text primary key, reason text not null check(reason in ('hard_bounce','complaint')),
 provider_event_id text not null, created_at timestamptz not null default now()
);
create table signing_v2.email_outbox(
 id uuid primary key default gen_random_uuid(), idempotency_key text not null unique,
 kind text not null check(kind in ('account_created','confirmation_pending','recovery','signer_invitation','signer_turn','signer_reminder','signature_received','process_blocked','process_completed','final_review','receipt','final_download','account_sensitive')),
 recipient text not null check(char_length(recipient) between 3 and 254), data jsonb not null check(jsonb_typeof(data)='object'),
 status text not null default 'pending' check(status in ('pending','processing','sent','failed','dead_letter')),
 attempts integer not null default 0 check(attempts between 0 and 8), available_at timestamptz not null default now(),
 locked_at timestamptz, provider_id text, error_code text, sent_at timestamptz,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index email_outbox_ready on signing_v2.email_outbox(available_at,created_at) where status in ('pending','failed','processing');
create table signing_v2.email_events(
 provider_event_id text primary key, provider_message_id text not null, event_type text not null,
 recipient text, received_at timestamptz not null default now()
);
create table signing_v2.email_rate_budgets(
 scope text not null check(scope in ('user','process','recipient','ip')),
 scope_hash text not null check(scope_hash ~ '^[a-f0-9]{64}$'), window_start timestamptz not null,
 used integer not null check(used between 1 and 60), primary key(scope,scope_hash,window_start)
);
create table signing_v2.admin_audit(
 id bigint generated always as identity primary key, administrator_id uuid not null,
 action text not null check(action in ('invite','resend_invitation','recovery','suspend','reactivate')),
 target_user_id uuid, target_email text, created_at timestamptz not null default now()
);

alter table signing_v2.signer_invitations enable row level security;
alter table signing_v2.guest_sessions enable row level security;
alter table signing_v2.email_suppressions enable row level security;
alter table signing_v2.email_outbox enable row level security;
alter table signing_v2.email_events enable row level security;
alter table signing_v2.admin_audit enable row level security;
revoke all on all tables in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on all sequences in schema signing_v2 from public,anon,authenticated,service_role;

create function signing_v2.reserve_email_budget(p_scope text,p_scope_hash text,p_window_start timestamptz,p_amount integer,p_limit integer)
returns void language plpgsql set search_path=pg_catalog,signing_v2,pg_temp as $$
declare v_used integer;
begin
 if p_scope not in ('user','process','recipient','ip') or p_scope_hash!~'^[a-f0-9]{64}$' or p_amount not between 1 and 20 or p_limit not between p_amount and 60 then raise exception 'INVALID_EMAIL_BUDGET';end if;
 insert into signing_v2.email_rate_budgets(scope,scope_hash,window_start,used) values(p_scope,p_scope_hash,p_window_start,p_amount)
 on conflict(scope,scope_hash,window_start) do update set used=signing_v2.email_rate_budgets.used+excluded.used where signing_v2.email_rate_budgets.used+excluded.used<=p_limit returning used into v_used;
 if v_used is null then raise exception 'EMAIL_RATE_LIMITED';end if;
end $$;
revoke all on function signing_v2.reserve_email_budget(text,text,timestamptz,integer,integer) from public,anon,authenticated,service_role;

drop function public.v2_create_process(uuid,uuid,uuid,text,text,integer,integer,real,real,integer,text[]);
create function public.v2_create_process(
 p_owner_id uuid,p_client_ip_hash text,p_document_id uuid,p_version_id uuid,p_filename text,p_sha256 text,p_byte_size integer,
 p_page_count integer,p_last_page_width real,p_last_page_height real,p_existing_signature_count integer,
 p_signer_emails text[],p_invitation_tokens text[]
) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,auth,extensions,pg_temp as $$
declare v_emails text[];v_email text;v_token text;v_count integer;v_ordinal integer:=0;v_stage uuid;v_actor uuid;v_first uuid;
begin
 if not exists(select 1 from signing_v2.settings where (external_enabled or direct_enabled) and profile_enabled) then raise exception 'V2_DISABLED';end if;
 if not exists(select 1 from auth.users where id=p_owner_id and deleted_at is null and (banned_until is null or banned_until<=now())) then raise exception 'OWNER_NOT_FOUND';end if;
 if p_client_ip_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_CLIENT_ADDRESS';end if;
 if p_signer_emails is null or cardinality(p_signer_emails) not between 1 and 20 or cardinality(p_invitation_tokens)<>cardinality(p_signer_emails) then raise exception 'INVALID_SIGNERS';end if;
 select array_agg(lower(btrim(item)) order by ordinality) into v_emails from unnest(p_signer_emails) with ordinality requested(item,ordinality);v_count:=cardinality(v_emails);
 if p_existing_signature_count not between 0 and 19 or p_existing_signature_count+v_count>20 then raise exception 'INVALID_SIGNATURE_COUNT';end if;
 if exists(select 1 from unnest(v_emails) email where email is null or char_length(email)>254 or email!~'^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
   or (select count(distinct email) from unnest(v_emails) email)<>v_count
   or exists(select 1 from unnest(p_invitation_tokens) token where token!~'^invite_[A-Za-z0-9_-]{43}$') then raise exception 'INVALID_SIGNERS';end if;
 perform signing_v2.reserve_email_budget('user',encode(extensions.digest(p_owner_id::text,'sha256'),'hex'),date_trunc('hour',now()),v_count,40);
 perform signing_v2.reserve_email_budget('ip',p_client_ip_hash,date_trunc('hour',now()),v_count,60);
 perform signing_v2.reserve_email_budget('process',encode(extensions.digest(p_document_id::text,'sha256'),'hex'),'epoch'::timestamptz,v_count,20);
 for v_email in select recipient from unnest(v_emails) recipient order by recipient loop
  perform signing_v2.reserve_email_budget('recipient',encode(extensions.digest(v_email,'sha256'),'hex'),date_trunc('hour',now()),1,5);
 end loop;
 insert into signing_v2.documents(id,owner_id,current_version_id,active_stage_id,status,filename) values(p_document_id,p_owner_id,null,null,'draft',p_filename);
 insert into signing_v2.versions(id,document_id,sha256,storage_path,byte_size,parent_id,signature_count,page_count,last_page_width,last_page_height)
 values(p_version_id,p_document_id,p_sha256,p_document_id::text||'/versions/'||p_version_id::text||'.pdf',p_byte_size,null,p_existing_signature_count,p_page_count,p_last_page_width,p_last_page_height);
 foreach v_email in array v_emails loop
  v_ordinal:=v_ordinal+1;v_stage:=gen_random_uuid();v_actor:=gen_random_uuid();v_token:=p_invitation_tokens[v_ordinal];
  insert into signing_v2.stages(id,document_id,ordinal,signer_id,role) values(v_stage,p_document_id,v_ordinal,v_actor,'signer');
  insert into signing_v2.signer_invitations(stage_id,actor_id,signer_email,token_hash,invitation_url,expires_at) values(v_stage,v_actor,v_email,encode(extensions.digest(v_token,'sha256'),'hex'),'https://pruebas.leapsign.app/firmar/'||v_token,now()+interval '7 days');
  insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values(
   'stage:'||v_stage::text||':invitation',case when v_ordinal=1 then 'signer_turn' else 'signer_invitation' end,v_email,
   jsonb_build_object('documentName',p_filename,'actionUrl','https://pruebas.leapsign.app/firmar/'||v_token)
  );
  if v_first is null then v_first:=v_stage;end if;
 end loop;
 update signing_v2.documents set current_version_id=p_version_id,active_stage_id=v_first,status='ready_for_signer' where id=p_document_id;
 return jsonb_build_object('id',p_document_id,'filename',p_filename,'status','ready_for_signer','signerCount',v_count);
end $$;

create function public.v2_exchange_guest_invitation(p_invitation_hash text,p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare invitation signing_v2.signer_invitations%rowtype;session_expiry timestamptz;
begin
 if p_invitation_hash!~'^[a-f0-9]{64}$' or p_session_hash!~'^[a-f0-9]{64}$' then raise exception 'INVALID_TOKEN';end if;
 select * into invitation from signing_v2.signer_invitations where token_hash=p_invitation_hash for update;
 if invitation.id is null or invitation.exchanged_at is not null or invitation.expires_at<=now()
  or not exists(select 1 from signing_v2.documents d join signing_v2.stages s on s.document_id=d.id where s.id=invitation.stage_id and s.signer_id=invitation.actor_id and s.status='ready_for_signer' and d.active_stage_id=s.id and d.status='ready_for_signer') then return null;end if;
 session_expiry:=least(invitation.expires_at,now()+interval '24 hours');
 update signing_v2.signer_invitations set exchanged_at=now(),invitation_url=null where id=invitation.id;
 insert into signing_v2.guest_sessions(actor_id,stage_id,session_hash,expires_at) values(invitation.actor_id,invitation.stage_id,p_session_hash,session_expiry);
 return (select jsonb_build_object('actorId',invitation.actor_id,'documentId',s.document_id,'email',invitation.signer_email,'expiresAt',session_expiry) from signing_v2.stages s where s.id=invitation.stage_id);
end $$;

create function public.v2_resolve_guest_session(p_session_hash text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare result jsonb;
begin
 if p_session_hash!~'^[a-f0-9]{64}$' then return null;end if;
 select jsonb_build_object('actorId',g.actor_id,'documentId',s.document_id,'email',i.signer_email,'expiresAt',g.expires_at) into result
 from signing_v2.guest_sessions g join signing_v2.stages s on s.id=g.stage_id and s.signer_id=g.actor_id
 join signing_v2.signer_invitations i on i.stage_id=s.id
 join signing_v2.documents d on d.id=s.document_id
 where g.session_hash=p_session_hash and g.revoked_at is null and g.expires_at>now()
   and ((s.status='ready_for_signer' and d.active_stage_id=s.id and d.status='ready_for_signer') or s.status='validated');
 return result;
end $$;

create or replace function public.v2_reserve_operation(p_actor_id uuid,p_operation text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare v_window timestamptz:=date_trunc('minute',now());v_used integer;v_limit integer;
begin
 if p_operation not in ('create','status','download','prepare','receipt','submit','validation','finalize') then raise exception 'INVALID_OPERATION';end if;
 if not exists(select 1 from auth.users where id=p_actor_id and deleted_at is null and (banned_until is null or banned_until<=now()))
  and not exists(select 1 from signing_v2.guest_sessions where actor_id=p_actor_id and revoked_at is null and expires_at>now()) then raise exception 'ACTOR_NOT_FOUND';end if;
 v_limit:=case when p_operation in ('create','submit','validation','finalize') then 10 else 60 end;
 insert into signing_v2.operation_budgets(actor_id,operation,window_start,used) values(p_actor_id,p_operation,v_window,1)
 on conflict(actor_id,operation,window_start) do update set used=signing_v2.operation_budgets.used+1 where signing_v2.operation_budgets.used<v_limit returning used into v_used;
 if v_used is null then raise exception 'RATE_LIMITED';end if;return jsonb_build_object('reserved',true);
end $$;

create function public.v2_claim_email_outbox(p_limit integer default 20)
returns setof signing_v2.email_outbox language sql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
 with ranked as materialized(select id,recipient,row_number() over(partition by recipient order by available_at,created_at) as recipient_order from signing_v2.email_outbox where ((status in ('pending','failed') and available_at<=now()) or (status='processing' and locked_at<now()-interval '10 minutes'))),
 candidates as(select o.id from signing_v2.email_outbox o join ranked r on r.id=o.id and r.recipient_order=1 where o.recipient not in(select recipient from signing_v2.email_suppressions) and not exists(select 1 from signing_v2.email_outbox recent where recent.recipient=o.recipient and recent.sent_at>now()-interval '1 minute') order by o.available_at,o.created_at for update of o skip locked limit least(greatest(p_limit,1),20))
 update signing_v2.email_outbox o set status='processing',locked_at=now(),updated_at=now() from candidates c where o.id=c.id returning o.*
$$;
create function public.v2_enqueue_email_reminders() returns integer language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
declare inserted_count integer;
begin
 insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data)
 select 'stage:'||i.stage_id||':reminder','signer_reminder',i.signer_email,jsonb_build_object('documentName',d.filename,'actionUrl',i.invitation_url)
 from signing_v2.signer_invitations i join signing_v2.stages s on s.id=i.stage_id join signing_v2.documents d on d.id=s.document_id
 where i.exchanged_at is null and i.invitation_url is not null and i.expires_at>now() and i.expires_at<=now()+interval '24 hours' and s.status='ready_for_signer' and d.active_stage_id=s.id
 on conflict do nothing;get diagnostics inserted_count=row_count;return inserted_count;
end $$;
create function public.v2_mark_email_sent(p_id uuid,p_provider_id text) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin if p_provider_id!~'^[A-Za-z0-9_-]{1,200}$' then raise exception 'INVALID_PROVIDER_ID';end if;update signing_v2.email_outbox set status='sent',provider_id=p_provider_id,sent_at=now(),locked_at=null,data='{}',updated_at=now() where id=p_id and status='processing';if not found then raise exception 'NOT_PROCESSING';end if;return jsonb_build_object('ok',true);end $$;
create function public.v2_mark_email_failed(p_id uuid,p_attempts integer,p_dead boolean,p_error_code text) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin if p_attempts not between 1 and 8 or p_error_code!~'^[A-Z_]{1,64}$' then raise exception 'INVALID_FAILURE';end if;update signing_v2.email_outbox set status=case when p_dead or p_attempts>=8 then 'dead_letter' else 'failed' end,attempts=p_attempts,error_code=p_error_code,available_at=now()+make_interval(secs=>least(3600,30*(2^least(p_attempts,7))::integer)),locked_at=null,updated_at=now() where id=p_id and status='processing';if not found then raise exception 'NOT_PROCESSING';end if;return jsonb_build_object('ok',true);end $$;
create function public.v2_record_email_event(p_event_id text,p_message_id text,p_event_type text,p_recipient text) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin
 if p_event_id!~'^[A-Za-z0-9_-]{1,200}$' or p_message_id!~'^[A-Za-z0-9_-]{1,200}$' or p_event_type not in ('email.delivered','email.bounced','email.complained','email.failed') then raise exception 'INVALID_EVENT';end if;
 insert into signing_v2.email_events(provider_event_id,provider_message_id,event_type,recipient) values(p_event_id,p_message_id,p_event_type,lower(p_recipient)) on conflict do nothing;
 if p_event_type in ('email.bounced','email.complained') then insert into signing_v2.email_suppressions(recipient,reason,provider_event_id) values(lower(p_recipient),case when p_event_type='email.complained' then 'complaint' else 'hard_bounce' end,p_event_id) on conflict(recipient) do nothing;end if;return jsonb_build_object('ok',true);
end $$;
create function public.v2_record_admin_action(p_administrator_id uuid,p_action text,p_target_user_id uuid,p_target_email text) returns jsonb language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin if p_action not in ('invite','resend_invitation','recovery','suspend','reactivate') then raise exception 'INVALID_ACTION';end if;insert into signing_v2.admin_audit(administrator_id,action,target_user_id,target_email) values(p_administrator_id,p_action,p_target_user_id,lower(p_target_email));return jsonb_build_object('ok',true);end $$;
create function public.v2_list_admin_audit(p_limit integer,p_offset integer) returns setof signing_v2.admin_audit language sql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$ select * from signing_v2.admin_audit order by created_at desc,id desc limit least(greatest(p_limit,1),50) offset greatest(p_offset,0) $$;
create function public.v2_admin_list_users(p_page integer,p_search text) returns jsonb language sql security definer set search_path=pg_catalog,auth,pg_temp as $$
 with filtered as materialized(select id,email,email_confirmed_at,banned_until,created_at,last_sign_in_at from auth.users where deleted_at is null and email is not null and (coalesce(p_search,'')='' or lower(email) like '%'||lower(p_search)||'%')),
 page_rows as(select * from filtered order by created_at desc,id limit 50 offset (greatest(p_page,1)-1)*50)
 select jsonb_build_object('users',coalesce((select jsonb_agg(jsonb_build_object('id',id,'email',email,'status',case when banned_until>now() then 'suspended' when email_confirmed_at is null then 'unconfirmed' else 'active' end,'createdAt',created_at,'lastSignInAt',last_sign_in_at) order by created_at desc,id) from page_rows),'[]'::jsonb),'page',greatest(p_page,1),'total',(select count(*) from filtered))
$$;

create function signing_v2.enqueue_process_email() returns trigger language plpgsql set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare recipient text;next_inv signing_v2.signer_invitations%rowtype;receipt_id uuid;
begin
 if tg_table_name='stages' and old.status='ready_for_signer' and new.status='validated' then
  select signer_email into recipient from signing_v2.signer_invitations where stage_id=new.id;if recipient is null then select email into recipient from auth.users where id=new.signer_id;end if;
  if recipient is not null then insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('stage:'||new.id||':received','signature_received',recipient,jsonb_build_object('documentName',(select filename from signing_v2.documents where id=new.document_id),'actionUrl','https://pruebas.leapsign.app')) on conflict do nothing;end if;
  select id into receipt_id from signing_v2.intents where stage_id=new.id and state='validated' order by issued_at desc limit 1;
  if receipt_id is not null and recipient is not null then insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('intent:'||receipt_id||':receipt','receipt',recipient,jsonb_build_object('documentName',(select filename from signing_v2.documents where id=new.document_id),'actionUrl','https://pruebas.leapsign.app/verificar/'||receipt_id)) on conflict do nothing;end if;
  select i.* into next_inv from signing_v2.stages s join signing_v2.signer_invitations i on i.stage_id=s.id where s.document_id=new.document_id and s.status='ready_for_signer' order by s.ordinal limit 1;
  if next_inv.id is not null and next_inv.invitation_url is not null then insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('stage:'||next_inv.stage_id||':turn','signer_turn',next_inv.signer_email,jsonb_build_object('documentName',(select filename from signing_v2.documents where id=new.document_id),'actionUrl',next_inv.invitation_url)) on conflict do nothing;end if;
 elsif tg_table_name='documents' and old.status is distinct from new.status and new.status in ('final_review','completed','failed') then
  select email into recipient from auth.users where id=new.owner_id;
  insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('document:'||new.id||':'||new.status,case new.status when 'final_review' then 'final_review' when 'completed' then 'process_completed' else 'process_blocked' end,recipient,jsonb_build_object('documentName',new.filename,'actionUrl','https://pruebas.leapsign.app/procesos/'||new.id)) on conflict do nothing;
  if new.status='completed' then insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('document:'||new.id||':final_download','final_download',recipient,jsonb_build_object('documentName',new.filename,'actionUrl','https://pruebas.leapsign.app/procesos/'||new.id)) on conflict do nothing;end if;
 end if;return new;
end $$;
create trigger v2_stage_email after update of status on signing_v2.stages for each row execute function signing_v2.enqueue_process_email();
create trigger v2_document_email after update of status on signing_v2.documents for each row execute function signing_v2.enqueue_process_email();

create function signing_v2.enqueue_account_email() returns trigger language plpgsql security definer set search_path=pg_catalog,signing_v2,pg_temp as $$
begin
 if old.email_confirmed_at is null and new.email_confirmed_at is not null and new.email is not null then insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('account:'||new.id||':created','account_created',lower(new.email),jsonb_build_object('actionUrl','https://pruebas.leapsign.app')) on conflict do nothing;end if;return new;
end $$;
create trigger v2_account_email after update of email_confirmed_at on auth.users for each row execute function signing_v2.enqueue_account_email();
create function signing_v2.enqueue_rejection_email() returns trigger language plpgsql set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare owner_email text;document_name text;
begin
 if old.state is distinct from new.state and new.state in ('rejected','failed') then select u.email,d.filename into owner_email,document_name from signing_v2.documents d join auth.users u on u.id=d.owner_id where d.id=new.document_id;insert into signing_v2.email_outbox(idempotency_key,kind,recipient,data) values('intent:'||new.id||':blocked','process_blocked',owner_email,jsonb_build_object('documentName',document_name,'actionUrl','https://pruebas.leapsign.app/procesos/'||new.document_id)) on conflict do nothing;end if;return new;
end $$;
create trigger v2_rejection_email after update of state on signing_v2.intents for each row execute function signing_v2.enqueue_rejection_email();

alter function signing_v2.reserve_email_budget(text,text,timestamptz,integer,integer) owner to postgres;
alter function public.v2_create_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[]) owner to postgres;
alter function public.v2_exchange_guest_invitation(text,text) owner to postgres;alter function public.v2_resolve_guest_session(text) owner to postgres;
alter function public.v2_claim_email_outbox(integer) owner to postgres;alter function public.v2_mark_email_sent(uuid,text) owner to postgres;alter function public.v2_mark_email_failed(uuid,integer,boolean,text) owner to postgres;alter function public.v2_record_email_event(text,text,text,text) owner to postgres;alter function public.v2_record_admin_action(uuid,text,uuid,text) owner to postgres;alter function public.v2_list_admin_audit(integer,integer) owner to postgres;
alter function public.v2_enqueue_email_reminders() owner to postgres;
alter function public.v2_admin_list_users(integer,text) owner to postgres;
revoke all on all functions in schema signing_v2 from public,anon,authenticated,service_role;
revoke all on function public.v2_create_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[]) from public,anon,authenticated,service_role;
revoke all on function public.v2_exchange_guest_invitation(text,text) from public,anon,authenticated,service_role;revoke all on function public.v2_resolve_guest_session(text) from public,anon,authenticated,service_role;
revoke all on function public.v2_claim_email_outbox(integer) from public,anon,authenticated,service_role;revoke all on function public.v2_mark_email_sent(uuid,text) from public,anon,authenticated,service_role;revoke all on function public.v2_mark_email_failed(uuid,integer,boolean,text) from public,anon,authenticated,service_role;revoke all on function public.v2_record_email_event(text,text,text,text) from public,anon,authenticated,service_role;revoke all on function public.v2_record_admin_action(uuid,text,uuid,text) from public,anon,authenticated,service_role;revoke all on function public.v2_list_admin_audit(integer,integer) from public,anon,authenticated,service_role;
revoke all on function public.v2_enqueue_email_reminders() from public,anon,authenticated,service_role;
revoke all on function public.v2_admin_list_users(integer,text) from public,anon,authenticated,service_role;
grant execute on function public.v2_create_process(uuid,text,uuid,uuid,text,text,integer,integer,real,real,integer,text[],text[]) to service_role;
grant execute on function public.v2_exchange_guest_invitation(text,text) to service_role;grant execute on function public.v2_resolve_guest_session(text) to service_role;
grant execute on function public.v2_claim_email_outbox(integer) to service_role;grant execute on function public.v2_mark_email_sent(uuid,text) to service_role;grant execute on function public.v2_mark_email_failed(uuid,integer,boolean,text) to service_role;grant execute on function public.v2_record_email_event(text,text,text,text) to service_role;grant execute on function public.v2_record_admin_action(uuid,text,uuid,text) to service_role;grant execute on function public.v2_list_admin_audit(integer,integer) to service_role;
grant execute on function public.v2_enqueue_email_reminders() to service_role;
grant execute on function public.v2_admin_list_users(integer,text) to service_role;
grant execute on function public.v2_reserve_operation(uuid,text) to service_role;
commit;
