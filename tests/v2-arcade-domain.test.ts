import {describe,expect,it} from 'vitest';
import {scoreArcadeRun} from '../server/v2/arcade-domain';
describe('v2 arcade domain',()=>{
 it('scores monotonic human-paced inputs deterministically',()=>{expect(scoreArcadeRun([0,80,160,260])).toBe(300);expect(scoreArcadeRun([0,80,160,260])).toBe(300);});
 it('rejects replay-shaped, impossible, and overlong input',()=>{expect(scoreArcadeRun([0,10])).toBeNull();expect(scoreArcadeRun([0,80,70])).toBeNull();expect(scoreArcadeRun([0,300001])).toBeNull();expect(scoreArcadeRun(Array.from({length:1001},(_,i)=>i*50))).toBeNull();});
});
