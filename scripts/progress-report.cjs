'use strict';
const fs=require('node:fs'),path=require('node:path');
const file=path.join(__dirname,'../docs/development-progress.json');
const reportPath=path.join(__dirname,'../docs/DEVELOPMENT_PROGRESS.md');
function calculate(data){
 if(!data||data.schema!==1||!Array.isArray(data.features))throw Error('진행 현황 형식이 올바르지 않습니다.');
 const weights=data.scoreWeights||{},expected=['implementation','automated','practical','deployment'];
 if(expected.some(key=>!Number.isInteger(weights[key])||weights[key]<0)||expected.reduce((n,k)=>n+weights[k],0)!==100)
  throw Error('진행률 가중치 합계는 100이어야 합니다.');
 if(data.features.length!==36)throw Error('ADM 14, USR 19, 공통 3개 항목이 모두 필요합니다.');
 const ids=new Set();
 const score=entry=>{
  if(ids.has(entry.id)||entry.id==='USR-20')throw Error('중복된 항목이나 제외 OCR 항목이 포함됐습니다: '+entry.id);
  ids.add(entry.id);
  if(!Number.isInteger(entry.phase)||entry.phase<1||entry.phase>7)throw Error('단계가 올바르지 않습니다.');
  for(const k of expected)if(!Number.isInteger(entry[k])||entry[k]<0||entry[k]>100)throw Error(entry.id+' 진행 점수가 잘못됐습니다: '+k);
  return Math.round(expected.reduce((sum,k)=>sum+entry[k]*weights[k],0)/100);
 };
 const items=data.features.map(e=>({...e,score:score(e)}));
 for(let i=1;i<=14;i++)if(!ids.has('ADM-'+String(i).padStart(2,'0')))throw Error('ADM 필수 항목 누락: '+i);
 for(let i=1;i<=19;i++)if(!ids.has('USR-'+String(i).padStart(2,'0')))throw Error('USR 필수 항목 누락: '+i);
 for(const key of ['TECH-01','QA-01','REL-01'])if(!ids.has(key))throw Error('공통 단계 누락: '+key);
 const phaseNames={1:'관리자 운영 기능',2:'사무 핵심 기능',3:'편집 품질·자동화',4:'전문 PDF 기능',5:'코드·언어·성능 고도화',6:'전체 통합 안정화',7:'최종 배포·운영 인계'};
 const phases=Array.from({length:7},(_,index)=>{
  const phase=index+1,entries=items.filter(e=>e.phase===phase);
  if(!entries.length)throw Error('단계에 요구사항이 없습니다: '+phase);
  return {phase,name:phaseNames[phase],count:entries.length,implementation:Math.round(entries.reduce((n,e)=>n+e.implementation,0)/entries.length),percent:Math.round(entries.reduce((n,e)=>n+e.score,0)/entries.length)};
 });
 const overall=Math.round(phases.reduce((n,e)=>n+e.percent,0)/phases.length);
 const meanImplementation=entries=>Math.round(entries.reduce((n,e)=>n+e.implementation,0)*10/entries.length)/10;
 const product=items.filter(e=>e.id.startsWith('ADM-')||e.id.startsWith('USR-'));
 const general=product.filter(e=>[1,2,3].includes(e.phase));
 const specialist=product.filter(e=>e.phase===4);
 return {items,phases,overall,productImplementation:meanImplementation(product),
  generalImplementation:meanImplementation(general),specialistImplementation:meanImplementation(specialist)};
}
function render(data,report,evidence){
 const pct=x=>x+'%';
 let out='# Sunrise PDF Editor Web — 기능별·총괄 개발 진행률\n\n';
 out+='- 기준일: '+data.asOf+' (KST)\n';
 out+='- 계획: '+data.plan+'\n';
 out+='- 과거 기준 **7단계 균등가중 복합관리 점수 '+report.overall+'%** (기능 개발률이 아님; 이력 보존용)\n';
 out+='- OCR(USR-20)은 개발과 진행률 산정 모두 제외.\n';
 out+='- **산식:** 기능별 점수 = 구현×'+data.scoreWeights.implementation+'% + 자동검사×'+data.scoreWeights.automated+'% + 실사용 검증×'+data.scoreWeights.practical+'% + 운영반영×'+data.scoreWeights.deployment+'%; 단계 = 해당 기능 평균(반올림); 총괄 = 1~7단계 동일 가중치 평균(반올림).\n';
 out+='- **주의:** 점수는 소스·테스트·배포 증거에 대한 계획 관리용 보수적 추정치입니다. 외부 품질 인증이나 실제 완료율을 뜻하지 않습니다.\n';
 out+='- 소스: PR #9 / PR #10 및 feat/admin-fast-development-20261101. 과거 검사는 신규 변경의 통과 증거가 아닙니다.\n';
 out+='- 관리자 소스 구현률: **'+report.phases[0].implementation+'%**. 아래 종합 점수는 검증·운영 반영을 포함하며 소스 작성률과 다릅니다.\n\n';
 if(data.adminSourceStatus?.state==='implementation-complete-candidate')out+='- 관리자 소스 단계: 작성 마감 후보본. 최신 실행 검증은 ADMIN_VALIDATION_REPORT.md, 범위는 ADMIN_SOURCE_CLOSEOUT.md를 참조합니다. 운영 수용은 별도입니다.\n\n';
 out+='## 제품 기능 구현률과 R15 배포 증빙 (별도 지표)\n\n';
 out+='- **v1.2 제품 기능 33개 구현률:** **'+report.productImplementation.toFixed(1)+'%** (ADM 14개 + USR 19개, OCR 제외; 원천 점수 기준).\n';
 out+='- **일반 업무 기능 28개 구현률:** **'+report.generalImplementation.toFixed(1)+'%** (ADM 14개 + 2·3단계 USR 14개).\n';
 out+='- **전문 PDF 기능 5개 구현률:** **'+report.specialistImplementation.toFixed(1)+'%** (4단계, 원문 수정·민감정보 삭제·웹 암호화·인증형 서명 등 일부 미구현).\n';
 out+='- **R15 기록된 배포:** 커밋 `'+evidence.releaseCommit+'`; CI [run #'+evidence.ci.runId+'](https://github.com/Peter-msk/Sunrise-PDF-Editor-Web/actions/runs/'+evidence.ci.runId+') '+evidence.ci.requiredJobsPassed+'/'+evidence.ci.requiredJobsTotal+' PASS; Cloudflare 배포 ID `'+evidence.deployment.id+'`, 버전 `'+evidence.deployment.workerVersion+'`, 트래픽 '+evidence.deployment.trafficPercent+'%.\n';
 out+='- **출고 순서:** R15 CI 완료 '+evidence.ci.completedAtUtc+' / 배포 '+evidence.deployment.deployedAtUtc+' (UTC). 이 배포가 전체 CI 완료 이후 이루어진 것은 아닙니다.\n';
 out+='- **상태 해석:** R15 변경 패키지의 배포 사실과 v1.2 전체 기능 완성은 구별합니다. `REL-01=0%`는 오래된 점수이며 현재 배포 미실시를 뜻하지 않습니다. 실제 업무 수용·D1 격리 복원·최종 인계는 미확인입니다.\n';
 out+='- **데이터 기준:** 36개 항목 점수는 '+data.asOf+' 기준이며, R15 배포 증빙은 '+evidence.recordedAtKst+'의 별도 시점 기록입니다.\n\n';
 out+='## 단계별\n\n| 단계 | 소스 구현률 | 종합 진행률 | 추적 항목 |\n|---|---:|---:|---:|\n';
 for(const e of report.phases)out+='| '+e.phase+'. '+e.name+' | '+pct(e.implementation)+' | '+pct(e.percent)+' | '+e.count+' |\n';
 out+='| **총괄** | — | **'+pct(report.overall)+'** | **36개** |\n\n';
 for(const [title,predicate] of [
  ['관리자 기능 — ADM-01~14',e=>e.id.startsWith('ADM-')],
  ['사용자 기능 — USR-01~19',e=>e.id.startsWith('USR-')],
  ['공통 고도화·검증·배포',e=>!e.id.startsWith('ADM-')&&!e.id.startsWith('USR-')]
 ]){
  out+='## '+title+'\n\n| ID | 기능 | 소스 구현률 | 종합 진행률 | 현재 근거/미완료 범위 |\n|---|---|---:|---:|---|\n';
  for(const x of report.items.filter(predicate))
   out+='| '+x.id+' | '+x.name+' | '+pct(x.implementation)+' | '+pct(x.score)+' | '+x.note.replaceAll('|','/')+' |\n';
  out+='\n';
 }
 out+='## 갱신 정책\n\n1. 기능·테스트·실사용·배포 증빙이 생길 때 관련 원천 JSON만 갱신합니다.\n2. `npm run progress:write`로 표를 생성하고 `npm run progress:check`로 위조/불일치를 방지합니다.\n3. 매 개발 보고마다 기능별 변경률·7개 단계·총괄 진행률을 다시 표시합니다.\n4. 미확인 상태는 완료로 기록하지 않고, 검증 실패 시 점수를 낮출 수 있습니다.\n5. **완료 100%**는 전체 계획 수용 기준 충족 및 운영 배포 확인 뒤에만 부여합니다.\n';
 return out;
}
const evidencePath=path.join(__dirname,'../docs/release-evidence-r15.json');
const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
if(evidence.schema!==1||evidence.release!=='R15'||!/^[0-9a-f]{40}$/.test(evidence.releaseCommit)||
 !Number.isSafeInteger(evidence.ci?.runId)||evidence.ci.requiredJobsPassed!==4||
 evidence.ci.requiredJobsTotal!==4||evidence.deployment?.trafficPercent!==100||
 !evidence.deployment?.id||!evidence.deployment?.workerVersion||
 !Number.isFinite(Date.parse(evidence.ci.completedAtUtc))||
 !Number.isFinite(Date.parse(evidence.deployment.deployedAtUtc))||
 !evidence.recordedAtKst)throw Error('R15 배포 증빙 JSON 형식이 유효하지 않습니다.');
const data=JSON.parse(fs.readFileSync(file,'utf8')),report=calculate(data),output=render(data,report,evidence);
if(process.argv.includes('--write'))fs.writeFileSync(reportPath,output);
else if(process.argv.includes('--check')){
 if(!fs.existsSync(reportPath)||fs.readFileSync(reportPath,'utf8')!==output)throw Error('진행률 문서가 데이터와 일치하지 않습니다. npm run progress:write 실행 필요.');
}else process.stdout.write(output);
if(process.argv.includes('--summary'))process.stdout.write(JSON.stringify({overall:report.overall,productImplementation:report.productImplementation,generalImplementation:report.generalImplementation,specialistImplementation:report.specialistImplementation,phases:report.phases})+'\n');
