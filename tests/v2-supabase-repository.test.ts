import {describe,expect,it,vi} from 'vitest';
import {DefiniteTransactionRejection} from '../server/v2/supabase-private';
import {createSupabaseRepositories} from '../server/v2/supabase-repository';

const owner='11111111-1111-4111-8111-111111111111';
const processResult={id:'22222222-2222-4222-8222-222222222222',filename:'Contrato.pdf',status:'ready_for_signer',signerCount:1};
const prepared={pdf:new TextEncoder().encode('%PDF-prepared'),sha256:'a'.repeat(64),byteSize:13,pageCount:1,lastPageWidth:595,lastPageHeight:842,signatureCount:0};
const input={ownerId:owner,clientIpHash:'b'.repeat(64),filename:'Contrato.pdf',pdf:new TextEncoder().encode('%PDF-input'),signers:['ana@example.test']};
function fixture(failure:Error){const cleanup=vi.fn(async()=>{});const database={rpc:vi.fn(),rpcWithDefiniteRejection:vi.fn(async()=>{throw failure;}),stagePrivateObject:vi.fn(async()=>({cleanupAfterDefiniteRejection:cleanup})),readPrivateObject:vi.fn()};const validator={prepare:vi.fn(async()=>prepared)};return{cleanup,database,repository:createSupabaseRepositories(database as never,validator)};}

describe('v2 process storage compensation',()=>{
 it('deletes a staged PDF after a confirmed transaction rejection',async()=>{const f=fixture(new DefiniteTransactionRejection());await expect(f.repository.create(input)).rejects.toThrow('UNAVAILABLE');expect(f.cleanup).toHaveBeenCalledOnce();});
 it('retains a staged PDF when the transaction result is ambiguous',async()=>{const f=fixture(Error('network timeout'));await expect(f.repository.create(input)).rejects.toThrow('UNAVAILABLE');expect(f.cleanup).not.toHaveBeenCalled();});
 it('does not compensate after a committed process',async()=>{const f=fixture(Error());f.database.rpcWithDefiniteRejection.mockResolvedValueOnce(processResult as never);await expect(f.repository.create(input)).resolves.toEqual(processResult);expect(f.cleanup).not.toHaveBeenCalled();});
});
