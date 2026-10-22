import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=()=>readFileSync('v2/migrations/008_v1_parity.sql','utf8');

describe('v2 parity migration',()=>{
  it('adds every isolated parity module behind RLS',()=>{
    const sql=migration();
    for(const table of [
      'process_access','queue_entries','turn_leases','owner_contacts',
      'process_incidents','final_shares','arcade_runs','arcade_records',
      'email_templates','lifecycle_jobs','admin_roles','admin_settings',
    ]){
      expect(sql).toContain(`create table signing_v2.${table}`);
      expect(sql).toContain(`alter table signing_v2.${table} enable row level security`);
    }
  });

  it('keeps browser roles away from private tables and RPCs',()=>{
    const sql=migration();
    expect(sql).toContain('revoke all on all tables in schema signing_v2 from public,anon,authenticated,service_role');
    expect(sql).not.toMatch(/grant\s+(?:select|insert|update|delete)\s+on[\s\S]*?to\s+(?:anon|authenticated)/i);
    for(const name of ['v2_upsert_contact','v2_join_queue','v2_claim_turn','v2_process_action','v2_create_final_share','v2_start_arcade','v2_finish_arcade','v2_claim_lifecycle_jobs']){
      expect(sql).toContain(`grant execute on function public.${name}`);
      expect(sql).toMatch(new RegExp(`revoke all on function public\\.${name}\\([\\s\\S]*?from public,anon,authenticated,service_role`));
    }
  });

  it('uses atomic locks for queue claims, lifecycle work and podium writes',()=>{
    const sql=migration();
    expect(sql).toContain('for update of pa');
    expect(sql).toContain('for update skip locked');
    expect(sql).toContain('pg_advisory_xact_lock');
    expect(sql).toContain("status='active'");
    expect(sql).toContain("status='waiting'");
  });

  it('stores only derived access and share capabilities',()=>{
    const sql=migration();
    expect(sql).toContain("access_secret_hash text check(access_secret_hash is null or access_secret_hash ~ '^[a-f0-9]{64}$')");
    expect(sql).toContain("token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$')");
    expect(sql).not.toMatch(/\baccess_secret\s+text\b/);
    expect(sql).not.toMatch(/\bshare_token\s+text\b/);
  });
});
