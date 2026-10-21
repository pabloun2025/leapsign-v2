import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=()=>readFileSync('v2/migrations/004_structured_validation.sql','utf8');

describe('v2 structured validation migration',()=>{
  it('requires every acceptance dimension inside the atomic commit',()=>{
    const sql=migration();
    for(const token of ["p_report->>'accepted'","p_report->'checks'->>'cryptographicIntegrity'","p_report->'checks'->>'cmsSignature'","p_report->'checks'->>'chainBuilt'","p_report->'checks'->>'trusted'","p_report->'checks'->>'certificateValidity'","p_report->'checks'->>'revocation'","not_determined_by_software"]){
      expect(sql).toContain(token);
    }
    expect(sql).toContain("p_report->'certificate' ?& array['subject','issuer','serial','fingerprint','notBefore','notAfter']");
    expect(sql).toContain("p_report->'certificate'->>'fingerprint' !~ '^[a-f0-9]{64}$'");
  });

  it('keeps the replacement commit function private',()=>{
    const sql=migration();
    expect(sql).toContain('revoke all on function signing_v2.commit_validated(uuid,text,uuid,integer,jsonb) from public,anon,authenticated,service_role');
  });
});

describe('v2 explicit owner finalization migration',()=>{
  it('locks the owner document and only transitions a fully signed final review',()=>{
    const sql=readFileSync('v2/migrations/005_owner_finalization.sql','utf8');
    for(const token of ['for update',"status is distinct from 'final_review'","owner_id is distinct from p_actor_id","status='completed'","v2_finalize_process"]){expect(sql).toContain(token);}
    expect(sql).toContain('grant execute on function public.v2_finalize_process(uuid,uuid) to service_role');
    expect(sql).toContain('revoke all on function public.v2_finalize_process(uuid,uuid) from public,anon,authenticated,service_role');
  });
});

describe('v2 QR verification migration',()=>{
  it('authorizes only the process owner or signer and keeps the RPC server-only',()=>{
    const sql=readFileSync('v2/migrations/006_authenticated_verification.sql','utf8');
    expect(sql).toContain('v2_get_verification');expect(sql).toContain('d.owner_id = p_actor_id');expect(sql).toContain('i.signer_id = p_actor_id');
    expect(sql).toContain('grant execute on function public.v2_get_verification(uuid,uuid) to service_role');
    expect(sql).toContain('revoke all on function public.v2_get_verification(uuid,uuid) from public,anon,authenticated,service_role');
  });
});

describe('v2 guest access and transactional email migration',()=>{
 it('keeps opaque guest sessions and outbox tables behind the service boundary',()=>{const sql=readFileSync('v2/migrations/007_accounts_guests_email.sql','utf8');for(const token of ['signer_invitations','guest_sessions','email_outbox','email_suppressions','admin_audit','skip locked','dead_letter','v2_exchange_guest_invitation','v2_resolve_guest_session','v2_enqueue_email_reminders'])expect(sql).toContain(token);expect(sql).toContain('revoke all on all tables in schema signing_v2 from public,anon,authenticated,service_role');expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)\s+on[\s\S]*?to\s+(?:anon|authenticated)/i);});
 it('atomically limits invitation email volume by user, process, recipient and anonymized IP',()=>{const sql=readFileSync('v2/migrations/007_accounts_guests_email.sql','utf8');for(const token of ['email_rate_budgets','reserve_email_budget',"'user'","'process'","'recipient'","'ip'",'p_client_ip_hash','EMAIL_RATE_LIMITED','on conflict(scope,scope_hash,window_start) do update'])expect(sql).toContain(token);expect(sql).toMatch(/p_client_ip_hash!~'\^\[a-f0-9\]\{64\}\$'/);});
});
