// Local-only report export for PDF preflight. Never uploads document bytes.
// CSV text is escaped and spreadsheet formulas are neutralized.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunrisePdfQualityReport=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const MAX_ISSUES=120;
 const safeText=value=>String(value??'').slice(0,2000).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g,' ');
 function checkReport(result){
  if(!result||!Number.isInteger(result.pageCount)||result.pageCount<1||
    !Array.isArray(result.issues)||result.issues.length>MAX_ISSUES||
    !Number.isInteger(result.errors)||!Number.isInteger(result.reviews))
   throw Error('제출 전 검사 결과가 올바르지 않습니다.');
  return result;
 }
 function csvCell(value){
  let str=safeText(value);
  // Prefix data that could be executed as a spreadsheet formula, even with
  // whitespace or an invisible prefix. Do not HTML-escape CSV content.
  if(/^[\s\u200b-\u200d\ufeff]*[=+\-@]/u.test(str))str="'"+str;
  return '"'+str.replaceAll('"','""')+'"';
 }
 function createCsv(raw){
  const r=checkReport(raw),rows=[
   ['범위','페이지','종류','코드','내용'],
   ['요약','', '총 페이지','pages',r.pageCount],
   ['요약','', '구조 오류','errors',r.errors],
   ['요약','', '확인 필요','reviews',r.reviews],
   ['요약','', '내용 검사 페이지','scannedPages',r.scannedPages??0],
   ['요약','', '빈 페이지 후보','blankCandidates',r.blankCandidates??0],
   ['안내','', '검사 한계','limitations',r.limitations||'검사는 제출 적합성을 보증하지 않습니다.']
  ];
  for(const issue of r.issues){
   rows.push(['검사',Number.isInteger(issue.page)?issue.page:'',issue.severity==='error'?'오류':'확인 필요',
    safeText(issue.code),safeText(issue.message)]);
  }
  return '\uFEFF'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n')+'\r\n';
 }
 function createJson(raw){
  const r=checkReport(raw);
  const result={
   format:'Sunrise PDF Preflight 1',checkedAt:new Date().toISOString(),
   status:r.status,pageCount:r.pageCount,bytes:r.bytes,scannedPages:r.scannedPages,
   orientation:r.orientation,fontResources:r.fontResources,formFields:r.formFields,
   emptyRequired:r.emptyRequired,blankCandidates:r.blankCandidates,
   errors:r.errors,reviews:r.reviews,issues:r.issues.map(i=>({
    severity:i.severity,code:safeText(i.code),message:safeText(i.message),
    ...(Number.isInteger(i.page)?{page:i.page}:{})
   })),limitations:r.limitations
  };
  return JSON.stringify(result,null,2)+'\n';
 }
 return {createCsv,createJson,csvCell};
});
