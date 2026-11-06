'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');
const data=JSON.parse(fs.readFileSync(path.join(root,'docs/development-progress.json'),'utf8'));
const release=JSON.parse(fs.readFileSync(path.join(root,'docs/release-evidence-r15.json'),'utf8'));
const output=execFileSync(process.execPath,[path.join(root,'scripts/progress-report.cjs'),'--summary'],
 {cwd:root,encoding:'utf8'});
const summary=JSON.parse(output.trimEnd().split('\n').at(-1));
const all=data.features.filter(x=>/^(ADM|USR)-/.test(x.id)),mean=arr=>
 Math.round(10*arr.reduce((sum,x)=>sum+x.implementation,0)/arr.length)/10;
assert.equal(data.features.length,36);
assert.equal(all.length,33);
assert.equal(mean(all),81.6);
assert.equal(summary.productImplementation,mean(all));
assert.equal(summary.generalImplementation,mean(all.filter(x=>[1,2,3].includes(x.phase))));
assert.equal(summary.specialistImplementation,mean(all.filter(x=>x.phase===4)));
assert.equal(summary.generalImplementation,89.3);
assert.equal(summary.specialistImplementation,38.6);
assert.equal(summary.overall,48);
assert.equal(release.ci.requiredJobsPassed,4);
assert.equal(release.deployment.trafficPercent,100);
assert(Date.parse(release.ci.completedAtUtc)>Date.parse(release.deployment.deployedAtUtc));
assert(output.includes('v1.2 제품 기능 33개 구현률'));
assert(output.includes('과거 기준 **7단계 균등가중 복합관리 점수 48%**'));
execFileSync(process.execPath,[path.join(root,'scripts/progress-report.cjs'),'--check'],{cwd:root});
console.log('PASS: product implementation, historical seven-phase score and R15 release evidence stay distinct');
