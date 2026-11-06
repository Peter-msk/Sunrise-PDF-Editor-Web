'use strict';
// Consistent 33-feature source/evidence inventory. No test 'PASS' is inferred
// from source/test presence; use `npm test` for runnable regression results.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const ledger=JSON.parse(fs.readFileSync(path.join(root,'docs/SOURCE_FEATURE_SCOPE.json'),'utf8'));
if(ledger.schema!==1||!Array.isArray(ledger.entries)||ledger.entries.length!==33)
 throw Error('필수 관리자·사용자 33개 기능 원본 현황이 올바르지 않습니다.');
const seen=new Set();let mapped=0;
const items=ledger.entries.map(entry=>{
 if(seen.has(entry.id)||!/^ADM-(0[1-9]|1[0-4])$|^USR-(0[1-9]|1[0-9])$/.test(entry.id))
   throw Error('기능 ID가 중복되거나 지원 범위를 벗어났습니다: '+entry.id);
 seen.add(entry.id);
 const file=(name)=>typeof name==='string'&&/^(?:src|scripts|tests)\/[a-z0-9_./-]+$/i.test(name)&&
  !name.split('/').includes('..')&&fs.existsSync(path.join(root,name))&&fs.statSync(path.join(root,name)).size>0;
 const code=file(entry.source),test=file(entry.test),valid=['core','verified-safe-scope'].includes(entry.scope);
 if(!valid||!code||!test)throw Error('소스·검증 계약 누락: '+entry.id);
 mapped++;
 return {...entry,codeMapped:code,testMapped:test,regressionRun:'npm test (separate execution required)'};
});
for(const kind of ['ADM','USR'])for(let i=1;i<=(kind==='ADM'?14:19);i++){
 const key=kind+'-'+String(i).padStart(2,'0');if(!seen.has(key))throw Error('원본 요구 누락: '+key);
}
const pct=(mapped/33*100).toFixed(1);
const report=[
 '# Sunrise PDF Editor — 소스 기능 추적·수용 현황',
 '',
 '**기준:** v1.2 (OCR 제외). GitHub·Cloudflare·실브라우저 수용 전 소스 인계용.',
 '',
 `**필수 기능 ID별 소스·회귀검사 연결: ${mapped}/33 (${pct}%).** 이는 전체 기능이 실무의 모든 PDF에서 검증됐다는 뜻이 아닙니다.`,
 '',
 '과거 관리 점수 81.6%는 이전 작성일의 추정치이며, 이 파일의 33/33은 그 점수의 단순 상향이나 배포 준비율이 아닙니다.',
 '',
 '| ID | 기능 | 소스 | 계약검사 | 구현 계약 |',
 '|---|---|---|---|---|',
 ...items.map(x=>`| ${x.id} | ${x.name} | \`${x.source}\` | \`${x.test}\` | ${x.scope==='core'?'기본 기능':'검증된 안전 범위'} |`),
 '',
 '## 전문 PDF 지원 경계 — 소스 단계 결정',
 '',
 ...items.filter(x=>x.scope!=='core').map(x=>`- **${x.id}:** ${x.limits}`),
 '',
 '## 다음 단계로 이관할 검증 (이번 소스 개발 범위 제외)',
 '',
 '정식 고정 의존성 빌드, 독립 PDF 뷰어·Office 프로그램·Windows/Android/iOS 실기, Github CI와 Cloudflare 운영 배포, 원격 D1 안전검증.',
 '',
 '**확인 방법:** `npm test`로 회귀 실행, `npm run source:audit`로 33개 경로·증빙 연결 정합성 확인. 실제 통과 결과는 별도 검증 기록 참조.',
 ''
].join('\n');
if(process.argv.includes('--write')){
 fs.writeFileSync(path.join(root,'docs/SOURCE_FEATURE_AUDIT.md'),report);
 fs.writeFileSync(path.join(root,'docs/SOURCE_FEATURE_AUDIT.json'),JSON.stringify({schema:1,mapped,total:33,mappingPercent:100,items},null,2)+'\n');
}
else if(process.argv.includes('--check')){
 const p=path.join(root,'docs/SOURCE_FEATURE_AUDIT.md');
 if(!fs.existsSync(p)||fs.readFileSync(p,'utf8')!==report)throw Error('소스 현황 문서가 원본과 일치하지 않습니다.');
}
else process.stdout.write(report);
