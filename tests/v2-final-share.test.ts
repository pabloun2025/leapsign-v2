import {describe,expect,it} from 'vitest';
import {hashFinalShareToken,validateFinalShareToken} from '../server/v2/final-share';
describe('v2 final share capability',()=>{
 it('hashes a bounded opaque token and rejects mutations',async()=>{const token='A'.repeat(43);const hash=await hashFinalShareToken(token);expect(hash).toMatch(/^[a-f0-9]{64}$/);expect(await validateFinalShareToken(token,hash)).toBe(true);expect(await validateFinalShareToken(`${token.slice(0,-1)}B`,hash)).toBe(false);});
 it('rejects malformed secrets before hashing',async()=>{await expect(hashFinalShareToken('short')).rejects.toThrow();});
});
