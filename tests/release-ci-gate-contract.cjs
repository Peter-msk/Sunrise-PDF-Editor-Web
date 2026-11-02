'use strict';
// Run with the final, post-implementation contract suite (not during code-first phase).
const assert=require('node:assert/strict');
const {validateReleaseEvidence}=require('../scripts/check-release-ci-gate.cjs');
const sha='a'.repeat(40);
const approved={head:sha,validatedCommit:sha};
const good={head_sha:sha,event:'push',head_branch:'main',status:'completed',conclusion:'success'};
assert.equal(validateReleaseEvidence({...approved,runs:[good]}),true);
for(const bad of [
 {runs:[]},{runs:[{...good,head_sha:'b'.repeat(40)}]},
 {runs:[{...good,event:'pull_request'}]},
 {runs:[{...good,status:'in_progress',conclusion:null}]},
 {runs:[{...good,head_branch:'feature'}]},
 {runs:[{...good,conclusion:'failure'}]},
 {validatedCommit:'b'.repeat(40),runs:[good]}
]){
 assert.throws(()=>validateReleaseEvidence({...approved,...bad}),/SHA|증빙/);
}
console.log('PASS: manual release gate matches exact successful main commit only');
