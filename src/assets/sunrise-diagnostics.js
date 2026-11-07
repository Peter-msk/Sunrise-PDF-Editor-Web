/* Fixed diagnostic vocabulary shared by the browser and Worker. No document data. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SunriseDiagnostics=api;})(typeof window!=='undefined'?window:globalThis,function(){
 'use strict';
 const BUILD='diag-v1-20261107';
 const CODES=Object.freeze({
  engine_not_ready:['engine','PDF 엔진 준비 실패','필수 스크립트·PDF.js 모듈·브라우저 연결을 확인하세요.'],
  empty_file:['input','빈 파일','0바이트 파일입니다. 원본을 다시 내려받으세요.'],
  invalid_size:['input','파일 크기 정보 오류','선택한 파일의 크기 정보를 확인하세요.'],
  read_failed:['read','파일 읽기 실패','파일 접근 권한·브라우저 메모리·다른 파일 재현 여부를 확인하세요.'],
  partial_read:['read','부분 읽기·크기 불일치','원본 재다운로드 후 다시 열어 보세요.'],
  invalid_header:['header','PDF 헤더 없음','PDF 형식인지 확인하세요. 확장자 변경만으로 PDF가 되지 않습니다.'],
  password_required:['restore','암호 보호 PDF','암호 해제 도구로 허가된 복사본을 만든 뒤 여세요.'],
  pdf_parse_failed:['restore','편집용 PDF 구조 해석 실패','원본 손상·지원 구조를 확인하고 독립 뷰어에서 재현하세요.'],
  no_pages:['metadata','페이지 없음','페이지가 있는 PDF 원본인지 확인하세요.'],
  display_parse_failed:['parse','표시용 PDF 해석 실패','PDF.js Worker 로딩과 파일 구조를 확인하세요.'],
  page_metadata_failed:['metadata','페이지 정보 읽기 실패','해당 문서의 페이지 구조·크기와 독립 뷰어 표시를 확인하세요.'],
  page_render_failed:['render','첫 화면 표시 실패','PDF.js·캔버스 메모리·브라우저 렌더링을 확인하세요.'],
  open_failed_unknown:['unknown','미분류 문서 열기 실패','단계·브라우저·파일 크기 구간으로 재현 범위를 좁히세요.'],
  operation_failed:['operation','작업 실패·추가 분류 필요','해당 기능의 입력 조건과 재현 순서를 확인하세요.']
 });
 const ENUMS={origin:['file','recent','generated','unknown'],size:['empty','lt1m','1to10m','10to50m','50to200m','ge200m','unknown'],pages:['one','2to10','11to100','101to500','gt500','unknown'],browser:['edge','chrome','firefox','safari','other']};
 const includes=(a,x)=>a.includes(x);
 function sizeBucket(n){return !Number.isSafeInteger(n)||n<0?'unknown':n===0?'empty':n<1048576?'lt1m':n<10485760?'1to10m':n<52428800?'10to50m':n<209715200?'50to200m':'ge200m';}
 function pageBucket(n){return !Number.isSafeInteger(n)||n<1?'unknown':n===1?'one':n<=10?'2to10':n<=100?'11to100':n<=500?'101to500':'gt500';}
 function browser(ua){return /Edg\//.test(ua)?'edge':/Firefox\//.test(ua)?'firefox':/Chrome\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other';}
 function normalize(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['code','phase','origin','size','pages','browser','build'].includes(k)))return null;
  if(!Object.hasOwn(CODES,value.code)||CODES[value.code][0]!==value.phase||value.build!==BUILD)return null;
  for(const [key,list] of Object.entries(ENUMS))if(!includes(list,value[key]))return null;
  return Object.fromEntries(['code','phase','origin','size','pages','browser','build'].map(k=>[k,value[k]]));
 }
 function describe(code){const v=Object.hasOwn(CODES,code)?CODES[code]:CODES.operation_failed;return {phase:v[0],label:v[1],action:v[2]};}
 function tagged(code,cause){const item=describe(code),e=new Error(item.label+'. '+item.action,{cause});e.sunriseDiagnosticCode=Object.hasOwn(CODES,code)?code:'open_failed_unknown';return e;}
 function capture(error,context={}){
  const code=Object.hasOwn(CODES,error?.sunriseDiagnosticCode)?error.sunriseDiagnosticCode:context.code||'open_failed_unknown';
  const safeCode=Object.hasOwn(CODES,code)?code:'open_failed_unknown';
  return {code:safeCode,phase:CODES[safeCode][0],origin:includes(ENUMS.origin,context.origin)?context.origin:'unknown',size:sizeBucket(context.bytes),pages:pageBucket(context.pages),browser:browser(context.ua||''),build:BUILD};
 }
 function hasPdfHeader(bytes){
  if(!(bytes instanceof Uint8Array))return false;
  // PDF.js accepts a PDF header within its first 1024-byte header scan.
  const end=Math.min(bytes.length,1024);
  for(let i=0;i+7<end;i++)if(bytes[i]===37&&bytes[i+1]===80&&bytes[i+2]===68&&bytes[i+3]===70&&bytes[i+4]===45&&bytes[i+5]>=49&&bytes[i+5]<=50&&bytes[i+6]===46&&bytes[i+7]>=48&&bytes[i+7]<=57)return true;
  return false;
 }
 return Object.freeze({BUILD,CODES,ENUMS,normalize,describe,tagged,capture,sizeBucket,pageBucket,hasPdfHeader});
});
