import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

const migration=()=>readFileSync('v2/migrations/004_structured_validation.sql','utf8');

describe('v2 structured validation migration',()=>{
  it('requires every acceptance dimension inside the atomic commit',()=>{
    const sql=migration();
    for(const token of ["p_report->>'accepted'","p_report->'checks'->>'cryptographicIntegrity'","p_report->'checks'->>'cmsSignature'","p_report->'checks'->>'chainBuilt'","p_report->'checks'->>'trusted'","p_report->'checks'->>'certificateValidity'","p_report->'checks'->>'revocation'","not_determined_by_software"]){
      expect(sql).toContain(token);
    }
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
