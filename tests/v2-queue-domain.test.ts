import {describe,expect,it} from 'vitest';
import {parseQueueSession,queuePresentation} from '../server/v2/queue-domain';

describe('v2 open queue domain',()=>{
 it('accepts exactly one secure queue cookie',()=>{const token='a'.repeat(43);expect(parseQueueSession(`x=1; __Host-leapsign-v2-queue=${token}`)).toBe(token);expect(parseQueueSession(`__Host-leapsign-v2-queue=${token}; __Host-leapsign-v2-queue=${token}`)).toBeNull();expect(parseQueueSession('__Host-leapsign-v2-queue=short')).toBeNull();});
 it('presents a stable zero-based wait count without leaking actors',()=>{expect(queuePresentation({status:'waiting',position:3,leaseExpiresAt:null})).toEqual({state:'waiting',peopleAhead:2,leaseExpiresAt:null});expect(queuePresentation({status:'active',position:0,leaseExpiresAt:'2026-10-22T12:00:00Z'})).toEqual({state:'active',peopleAhead:0,leaseExpiresAt:'2026-10-22T12:00:00Z'});});
});
