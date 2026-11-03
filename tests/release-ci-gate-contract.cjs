'use strict';
const assert=require('node:assert/strict');
const {validateReleaseEvidence,REQUIRED_JOBS}=require('../scripts/check-release-ci-gate.cjs');
const sha='a'.repeat(40), approved={head:sha,validatedCommit:sha};
const good={id:123,head_sha:sha,event:'push',head_branch:'main',status:'completed',conclusion:'success'};
const jobs=REQUIRED_JOBS.map((name,id)=>({id:id+1,name,head_sha:sha,status:'completed',conclusion:'success'}));
assert.equal(REQUIRED_JOBS.length,4);
assert.equal(validateReleaseEvidence({...approved,runs:[good],jobs}),true);
for(const bad of [
 {runs:[]},{runs:[{...good,head_sha:'b'.repeat(40)}]},
 {runs:[{...good,event:'pull_request'}]},
 {runs:[{...good,status:'in_progress',conclusion:null}]},
 {runs:[{...good,head_branch:'feature'}]},
 {runs:[{...good,conclusion:'failure'}]},
 {validatedCommit:'b'.repeat(40),runs:[good]},
 {jobs:[]},{jobs:jobs.slice(1)},
 {jobs:[...jobs,jobs[0]]},
 {jobs:jobs.map((j,i)=>i===0?{...j,status:'in_progress',conclusion:null}:j)},
 {jobs:jobs.map((j,i)=>i===2?{...j,conclusion:'failure'}:j)},
 {jobs:jobs.map((j,i)=>i===1?{...j,head_sha:'b'.repeat(40)}:j)}
 ]){
 assert.throws(()=>validateReleaseEvidence({...approved,runs:[good],jobs,...bad}),/SHA|증빙|누락|중복|미통과/);
}
console.log('PASS: manual release requires exact successful main CI and four completed jobs');
