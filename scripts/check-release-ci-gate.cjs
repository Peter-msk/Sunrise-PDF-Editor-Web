'use strict';
// Fail-closed deployment gate: a manual confirmation alone never establishes
// that the exact main commit passed the completed full validation workflow.
function validateReleaseEvidence({head,validatedCommit,runs}){
  if(typeof head!=='string'||!/^[0-9a-f]{40}$/i.test(head)||
    validatedCommit!==head)throw new Error('배포 대상 main SHA와 수동 승인 SHA가 다릅니다.');
  if(!Array.isArray(runs))throw new Error('CI 실행 증빙이 없습니다.');
  const success=runs.some(run=>run && run.head_sha===head && run.event==='push' &&
    run.head_branch==='main' && run.status==='completed' && run.conclusion==='success');
  if(!success)throw new Error('현재 main 커밋의 완료된 전체 CI PASS 증빙이 없습니다.');
  return true;
}
async function main(){
  const repo=process.env.GITHUB_REPOSITORY||'';
  const sha=process.env.GITHUB_SHA||'';
  const approved=process.env.VALIDATED_COMMIT||'';
  const token=process.env.GITHUB_TOKEN||'';
  if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ||
    !/^[0-9a-f]{40}$/i.test(sha) || !token)
    throw new Error('GitHub 배포 증명 환경 정보가 누락되었습니다.');
  if(sha!==approved)throw new Error('수동 승인된 SHA가 현재 배포 대상과 다릅니다.');
  const url=new URL('https://api.github.com/repos/'+repo+'/actions/workflows/ci.yml/runs');
  url.searchParams.set('head_sha',sha);
  url.searchParams.set('event','push');
  url.searchParams.set('per_page','100');
  const response=await fetch(url,{headers:{
    'Accept':'application/vnd.github+json',
    'Authorization':'Bearer '+token,
    'X-GitHub-Api-Version':'2022-11-28'
  },signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('GitHub CI 검증 자료 조회 실패: HTTP '+response.status);
  const data=await response.json();
  validateReleaseEvidence({head:sha,validatedCommit:approved,runs:data.workflow_runs});
  process.stdout.write('RELEASE GATE PASS: exact main SHA has completed successful CI\n');
}
if(require.main===module) main().catch(error=>{
  console.error('RELEASE GATE BLOCKED: '+(error.message||error));
  process.exitCode=1;
});
module.exports={validateReleaseEvidence};
