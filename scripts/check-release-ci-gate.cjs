'use strict';
// Manual release: require completed full CI for the exact main SHA AND all four
// required validation jobs. This gate does not cover unapproved direct deployments.
const fs=require('node:fs');
const path=require('node:path');
function assertNoPreviewAssets(root=path.resolve(__dirname,'..')){
 if(fs.existsSync(path.join(root,'dist','SUNRISE_PREVIEW_ONLY.json')))
  throw Error('Preview-only assets exist; run the locked production build before release.');
}
const REQUIRED_JOBS=Object.freeze([
 'Node contracts and production build',
 'Real Chromium PDF save and reopen',
 'Windows administrator and PDF - chrome',
 'Windows administrator and PDF - msedge'
]);
function selectRun({head,validatedCommit,runs}){
 if(typeof head!=='string'||!/^[0-9a-f]{40}$/i.test(head)||
   validatedCommit!==head)throw new Error('배포 대상 main SHA와 수동 승인 SHA가 다릅니다.');
 if(!Array.isArray(runs))throw new Error('CI 실행 증빙이 없습니다.');
 const run=runs.find(item=>item&&Number.isSafeInteger(item.id)&&item.id>0&&
   item.head_sha===head&&item.event==='push'&&item.head_branch==='main'&&
   item.status==='completed'&&item.conclusion==='success');
 if(!run)throw new Error('현재 main 커밋의 완료된 전체 CI PASS 증빙이 없습니다.');
 return run;
}
function validateReleaseEvidence({head,validatedCommit,runs,jobs}){
 selectRun({head,validatedCommit,runs});
 if(!Array.isArray(jobs))throw new Error('CI 세부 작업 증빙이 없습니다.');
 for(const name of REQUIRED_JOBS){
  const matching=jobs.filter(job=>job?.name===name);
  if(matching.length!==1)throw new Error('필수 CI 작업의 누락·중복: '+name);
  const job=matching[0];
  if(job.status!=='completed'||job.conclusion!=='success'||
     (job.head_sha!==undefined&&job.head_sha!==head))
   throw new Error('필수 CI 작업 미통과: '+name);
 }
 return true;
}
async function githubJson(url,token){
 const response=await fetch(url,{headers:{
  Accept:'application/vnd.github+json',
  Authorization:'Bearer '+token,
  'X-GitHub-Api-Version':'2022-11-28'
 },signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('GitHub CI 검증 자료 조회 실패: HTTP '+response.status);
 return response.json();
}
async function main(){
 assertNoPreviewAssets();
 const repo=process.env.GITHUB_REPOSITORY||'';
 const sha=process.env.GITHUB_SHA||'';
 const approved=process.env.VALIDATED_COMMIT||'';
 const token=process.env.GITHUB_TOKEN||'';
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)||
   !/^[0-9a-f]{40}$/i.test(sha)||!token)
   throw new Error('GitHub 배포 증명 환경 정보가 누락되었습니다.');
 if(sha!==approved)throw new Error('수동 승인된 SHA가 현재 배포 대상과 다릅니다.');
 const url=new URL('https://api.github.com/repos/'+repo+'/actions/workflows/ci.yml/runs');
 url.searchParams.set('head_sha',sha);
 url.searchParams.set('event','push');
 url.searchParams.set('per_page','100');
 const runsData=await githubJson(url,token);
 const run=selectRun({head:sha,validatedCommit:approved,runs:runsData.workflow_runs});
 const jobsUrl=new URL('https://api.github.com/repos/'+repo+'/actions/runs/'+run.id+'/jobs');
 jobsUrl.searchParams.set('per_page','100');
 const jobsData=await githubJson(jobsUrl,token);
 if(!Array.isArray(jobsData.jobs)||jobsData.total_count>jobsData.jobs.length)
   throw new Error('CI 세부 작업 자료가 누락되거나 페이지 범위를 초과했습니다.');
 validateReleaseEvidence({head:sha,validatedCommit:approved,runs:runsData.workflow_runs,jobs:jobsData.jobs});
 process.stdout.write('RELEASE GATE PASS: exact main SHA and all four required jobs passed\n');
}
if(require.main===module)main().catch(error=>{
 console.error('RELEASE GATE BLOCKED: '+(error.message||error));
 process.exitCode=1;
});
module.exports={validateReleaseEvidence,REQUIRED_JOBS,assertNoPreviewAssets};
