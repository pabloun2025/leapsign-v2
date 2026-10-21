import type {SignatureValidationResult} from '../../src/v2/contracts';

export function acceptedReport(overrides:Partial<SignatureValidationResult>={}):SignatureValidationResult{
  return {
    accepted:true,valid:true,policy:'leapsign-v2-ecuador-strict-1',
    baseSha256:'a'.repeat(64),signedSha256:'b'.repeat(64),
    previousSignatureCount:0,signatureCount:1,revocation:'good',
    legalOutcome:'not_determined_by_software',
    checks:{cryptographicIntegrity:'passed',cmsSignature:'passed',documentMatch:'passed',oneNewSignature:'passed',previousSignatures:'passed',chainBuilt:'passed',trusted:'passed',certificateValidity:'passed',revocation:'good'},
    certificate:{subject:'Synthetic',issuer:'Synthetic CA',serial:'1',fingerprint:'c'.repeat(64),notBefore:'2026-01-01T00:00:00Z',notAfter:'2027-01-01T00:00:00Z'},
    ...overrides,
  };
}
