-- Explicit, idempotent owner review. final_review is never completion by itself.
begin;

alter table signing_v2.operation_budgets drop constraint operation_budgets_operation_check;
alter table signing_v2.operation_budgets add constraint operation_budgets_operation_check
  check(operation in ('create','status','download','prepare','receipt','submit','validation','finalize'));

create or replace function public.v2_reserve_operation(p_actor_id uuid,p_operation text)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp as $$
declare v_window timestamptz:=date_trunc('minute',now());v_used integer;v_limit integer;
begin
 if p_operation not in ('create','status','download','prepare','receipt','submit','validation','finalize') then raise exception 'INVALID_OPERATION';end if;
 if not exists(select 1 from auth.users where id=p_actor_id) then raise exception 'ACTOR_NOT_FOUND';end if;
 v_limit:=case when p_operation in ('create','submit','validation','finalize') then 10 else 60 end;
 insert into signing_v2.operation_budgets(actor_id,operation,window_start,used) values(p_actor_id,p_operation,v_window,1)
 on conflict(actor_id,operation,window_start) do update set used=signing_v2.operation_budgets.used+1
 where signing_v2.operation_budgets.used<v_limit returning used into v_used;
 if v_used is null then raise exception 'RATE_LIMITED';end if;
 return jsonb_build_object('reserved',true);
end $$;

create or replace function public.v2_finalize_process(p_document_id uuid,p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp
as $$
declare v_document signing_v2.documents%rowtype;
begin
  select * into v_document from signing_v2.documents
    where id=p_document_id for update;
  if v_document.id is null or v_document.owner_id is distinct from p_actor_id then raise exception 'NOT_FOUND'; end if;
  if v_document.status='completed' then return public.v2_get_process_status(p_document_id,p_actor_id); end if;
  if v_document.status is distinct from 'final_review'
     or v_document.active_stage_id is not null
     or not exists(select 1 from signing_v2.stages where document_id=v_document.id)
     or exists(select 1 from signing_v2.stages where document_id=v_document.id and status is distinct from 'validated')
     or not exists(select 1 from signing_v2.versions where id=v_document.current_version_id and document_id=v_document.id) then
    raise exception 'FINAL_REVIEW_REQUIRED';
  end if;
  update signing_v2.documents set status='completed' where id=v_document.id and status='final_review';
  return public.v2_get_process_status(p_document_id,p_actor_id);
end $$;

alter function public.v2_reserve_operation(uuid,text) owner to postgres;
alter function public.v2_finalize_process(uuid,uuid) owner to postgres;
revoke all on function public.v2_reserve_operation(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.v2_finalize_process(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.v2_reserve_operation(uuid,text) to service_role;
grant execute on function public.v2_finalize_process(uuid,uuid) to service_role;

commit;
