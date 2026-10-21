-- QR verification is authenticated: the opaque receipt is not a public data oracle.
begin;

create or replace function public.v2_get_verification(p_intent_id uuid,p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,signing_v2,auth,pg_temp
as $$
declare v_result jsonb;
begin
  select jsonb_build_object(
    'processId',d.id,
    'receiptId',i.id,
    'signedSha256',i.report->>'signedSha256',
    'signer',i.report->'certificate'->>'subject',
    'validatedAt',a.created_at,
    'accepted',true,
    'checks',i.report->'checks',
    'revocation',i.report->>'revocation',
    'legalOutcome',i.report->>'legalOutcome'
  ) into v_result
  from signing_v2.intents i
  join signing_v2.documents d on d.id=i.document_id
  join signing_v2.audit a on a.intent_id=i.id and a.outcome='validated'
  where i.id=p_intent_id and i.state='validated' and i.accepted_version_id is not null
    and (d.owner_id = p_actor_id or i.signer_id = p_actor_id);
  if v_result is null then raise exception 'NOT_FOUND'; end if;
  return v_result;
end $$;

alter function public.v2_get_verification(uuid,uuid) owner to postgres;
revoke all on function public.v2_get_verification(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.v2_get_verification(uuid,uuid) to service_role;

commit;
