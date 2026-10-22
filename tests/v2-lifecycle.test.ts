import {describe,expect,it} from 'vitest';
import {validateProcessAction} from '../server/v2/lifecycle';

const version='11111111-1111-4111-8111-111111111111';
describe('v2 lifecycle domain',()=>{
 it('requires a version only for rollback',()=>{expect(validateProcessAction({action:'rollback',versionId:version,reason:'Revisar'})).toEqual({action:'rollback',versionId:version,reason:'Revisar'});expect(validateProcessAction({action:'rollback',versionId:null,reason:''})).toBeNull();expect(validateProcessAction({action:'pause',versionId:version,reason:''})).toBeNull();});
 it('accepts only the closed action set and bounded reasons',()=>{expect(validateProcessAction({action:'resume',versionId:null,reason:'Continuar'})).toEqual({action:'resume',versionId:null,reason:'Continuar'});expect(validateProcessAction({action:'destroy',versionId:null,reason:''})).toBeNull();expect(validateProcessAction({action:'pause',versionId:null,reason:'x'.repeat(1001)})).toBeNull();});
});
