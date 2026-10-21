import {describe,expect,it} from 'vitest';
import {isPublicValidationReport} from '../src/v2/public-data';

const checks={
  cryptographicIntegrity:'passed',cmsSignature:'passed',documentMatch:'passed',
  oneNewSignature:'passed',previousSignatures:'passed',chainBuilt:'passed',
  trusted:'passed',certificateValidity:'passed',revocation:'good',
} as const;
const accepted={
  accepted:true,valid:true,policy:'leapsign-v2-ecuador-strict-1',
  baseSha256:'a'.repeat(64),signedSha256:'b'.repeat(64),
  previousSignatureCount:0,signatureCount:1,revocation:'good',checks,
  legalOutcome:'not_determined_by_software',
  certificate:{subject:'Synthetic',issuer:'Synthetic CA',serial:'1',fingerprint:'c'.repeat(64),notBefore:'2026-01-01T00:00:00Z',notAfter:'2027-01-01T00:00:00Z'},
};

describe('structured validation contract',()=>{
  it('accepts only a fully passing technical report',()=>{
    expect(isPublicValidationReport(accepted)).toBe(true);
    expect(isPublicValidationReport({...accepted,checks:{...checks,trusted:'failed'}})).toBe(false);
    expect(isPublicValidationReport({...accepted,accepted:false})).toBe(false);
  });

  it('keeps a bounded structured rejection without treating it as accepted',()=>{
    expect(isPublicValidationReport({
      accepted:false,valid:false,policy:'leapsign-v2-ecuador-strict-1',
      error:'CHAIN_NOT_TRUSTED',legalOutcome:'not_determined_by_software',
      checks:{...checks,chainBuilt:'failed',trusted:'failed',certificateValidity:'not_evaluated',revocation:'unavailable'},
    })).toBe(true);
  });

  it('rejects the former opaque valid report',()=>{
    const {accepted:_accepted,checks:_checks,legalOutcome:_legal,...legacy}=accepted;
    expect(isPublicValidationReport(legacy)).toBe(false);
  });
});
