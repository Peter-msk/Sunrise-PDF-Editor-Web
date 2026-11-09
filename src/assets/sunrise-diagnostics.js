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
  batch_read_failed:['read','일괄 PDF 입력 읽기 실패','파일 읽기 권한·크기 불일치·브라우저 메모리를 확인하세요.'],
  batch_parse_failed:['parse','일괄 PDF 해석 실패','암호 보호·손상·지원 PDF 구조 여부를 확인하세요.'],
  batch_unsupported_structure:['structure','안전 보존 불가 구조','양식·서명·북마크·주석·페이지 라벨 등 보존할 수 없는 구조를 확인하세요. 원본을 유지합니다.'],
  batch_limit_exceeded:['limit','일괄 작업 제한 초과','파일당 150쪽·출력 최대 50개·출력당 1~100쪽 제한을 확인하세요.'],
  batch_copy_failed:['copy','일괄 PDF 페이지 복사 실패','페이지 리소스·참조 관계·브라우저 메모리와 독립 뷰어 결과를 확인하세요.'],
  batch_save_failed:['save','일괄 PDF 결과 저장 실패','브라우저 메모리·PDF 직렬화 동작을 확인하세요. 원본은 보존됩니다.'],
  batch_verify_failed:['verify','일괄 PDF 저장본 검증 실패','결과 페이지 수·회전·크기·내용 스트림 무결성을 확인하세요.'],
  batch_unexpected:['operation','일괄 PDF 미분류 작업 실패','선택 파일의 지원 구조와 동작을 재현해 세부 오류 단계를 확인하세요.'],
  save_compile_failed:['compile','저장용 PDF 생성 실패','오버레이와 PDF 구조를 확인하세요.'],
  save_compress_failed:['compress','저장용 PDF 압축 실패','압축 옵션·색공간·브라우저 메모리를 확인하세요.'],
  save_verify_failed:['verify','저장 PDF 무결성 검사 실패','출력 페이지·회전·페이지 상자 보존 여부를 확인하세요.'],
  save_publish_failed:['publish','저장 결과 제공 실패','Blob URL 생성·브라우저 다운로드 허용 상태를 확인하세요.'],
  save_stale_state:['state','저장 중 문서 상태 변경','작업 중 문서를 변경하지 않았는지 확인하세요.'],
  save_unexpected:['operation','미분류 저장 준비 실패','최근 실행 단계를 확인하세요.'],
  page_parse_failed:['parse','페이지 작업 PDF 해석 실패','PDF 원본 구조와 지원 여부를 확인하세요.'],
  page_structure_failed:['structure','페이지 작업 구조 검사 실패','북마크·서명·양식의 변경 안전성 검사를 확인하세요.'],
  page_edit_failed:['copy','페이지 변경 작업 실패','삭제·복제 대상과 페이지 참조 관계를 확인하세요.'],
  page_save_failed:['save','페이지 변경 PDF 저장 실패','PDF 직렬화·브라우저 메모리를 확인하세요.'],
  page_verify_failed:['verify','페이지 변경 결과 검사 실패','페이지 수·좌표·회전 보존 여부를 확인하세요.'],
  page_display_failed:['render','페이지 편집 후 표시 실패','PDF.js 갱신·페이지 캔버스를 확인하세요.'],
  page_unexpected:['operation','미분류 페이지 작업 실패','최근 처리 단계를 확인하세요.'],
  operation_failed:['operation','작업 실패·추가 분류 필요','해당 기능의 입력 조건과 재현 순서를 확인하세요.']
 });
 const ENUMS={origin:['file','recent','generated','unknown'],size:['empty','lt1m','1to10m','10to50m','50to200m','ge200m','unknown'],pages:['one','2to10','11to100','101to500','gt500','unknown'],browser:['edge','chrome','firefox','safari','other']};
 const includes=(a,x)=>a.includes(x);
 const TRACE_SCHEMA=2,TRACE_BUILD='trace2-dev4-20261109',TRACE_MAX_BYTES=2500;
 // Both releases use the same strict schema. Existing DEV1 records must stay readable.
 const TRACE_RELEASES=Object.freeze(['trace2-dev1-20261109','trace2-dev2-20261109','trace2-dev3-20261109',TRACE_BUILD]);
 const TRACE_STEPS=Object.freeze(['select','read_start','read_ok','read_failed','parse_start','parse_ok','parse_failed','structure_ok','structure_failed','limit_failed','copy_start','copy_ok','copy_failed','save_start','save_ok','save_failed','verify_start','verify_ok','verify_failed','cancelled',
  'engine_start','engine_ok','engine_failed','header_start','header_ok','header_failed','metadata_start','metadata_ok','metadata_failed','render_start','render_ok','render_failed','compile_start','compile_ok','compile_failed','compress_start','compress_ok','compress_failed','state_start','state_ok','state_failed','publish_start','publish_ok','publish_failed','operation_start','operation_failed',
  'input_start','input_ok','input_failed','structure_start','crypto_start','crypto_ok','crypto_failed',
  'signature_start','signature_ok','signature_failed','office_start','office_ok','office_failed',
  'output_start','output_ok','output_failed']);
 const TRACE_DURATIONS=Object.freeze(['0to99','100to499','500to1999','2000to9999','ge10000']);
 const TRACE_FLAGS=Object.freeze(['is_encrypted','has_xfa','has_acroform','has_digital_signature','has_struct_tree','has_outlines','has_annots','has_attachments','has_page_labels','has_mark_info','marked_true']);
 const batchCalls=Object.freeze({batch_read_failed:'read_source',batch_parse_failed:'parse_source',batch_unsupported_structure:'check_structure',batch_limit_exceeded:'check_limits',batch_copy_failed:'copy_pages',batch_save_failed:'serialize_pdf',batch_verify_failed:'verify_roundtrip',batch_unexpected:'process_batch'});
 const openCalls=Object.freeze({engine_not_ready:'initialize_engine',empty_file:'read_file',invalid_size:'validate_file',read_failed:'read_file',partial_read:'read_file',invalid_header:'check_header',password_required:'restore_edit_state',pdf_parse_failed:'restore_edit_state',no_pages:'read_page_metadata',display_parse_failed:'parse_display',page_metadata_failed:'read_page_metadata',page_render_failed:'render_first_page',open_failed_unknown:'open_document'});
 const saveCalls=Object.freeze({save_compile_failed:'compile_document',save_compress_failed:'compress_images',save_verify_failed:'verify_saved_bytes',save_publish_failed:'publish_download',save_stale_state:'check_snapshot',save_unexpected:'prepare_download'});
 const pageCalls=Object.freeze({page_parse_failed:'load_source',page_structure_failed:'guard_structure',page_edit_failed:'edit_pages',page_save_failed:'serialize_pages',page_verify_failed:'verify_pages',page_display_failed:'refresh_pages',page_unexpected:'change_pages'});
 const TRACE_PROFILES={batch_split:{module:'batch_pages',calls:batchCalls},batch_merge:{module:'batch_pages',calls:batchCalls},
  open:{module:'document_open',calls:openCalls},save_prepare:{module:'document_save',calls:saveCalls},
  page_duplicate:{module:'page_editor',calls:pageCalls},page_delete:{module:'page_editor',calls:pageCalls}};
 // Preserve the original 44-feature contract for historical trace release validation.
 // New high-risk crypto/signature/Office workflows are explicit action owners.
 const LEGACY_FEATURES=Object.freeze(['open','save_prepare','merge','split','extract_text','search','bookmark_edit','bookmark_auto','page_duplicate','page_delete','page_rotate','form_create','form_fill','highlight','batch_compress','batch_mark','batch_split','batch_merge','page_insert','page_extract','page_reorder','page_clipboard','bookmark_add','overlay_insert','overlay_edit','overlay_duplicate','overlay_delete','local_page_compose','local_form_edit','local_stamp','local_metadata','local_batch_preflight','local_images_to_pdf','local_pdf_to_images','local_page_crop','local_page_resize','local_nup','local_pdf_overlay','local_visual_compare','form_fill_bulk','source_text_replace','split_download','extract_images','native_annotation_edit']);
 const SECURITY_FEATURES=Object.freeze(['pdf_lock','pdf_unlock','pdf_crypto_compress','signature_sign','signature_verify','office_export_text','office_export_advanced']);
 const OPERATION_FEATURES=Object.freeze([...LEGACY_FEATURES,...SECURITY_FEATURES]);
 const genericModule=feature=>feature.startsWith('local_')?'local_tools':feature.startsWith('bookmark_')?'bookmarks':feature.startsWith('overlay_')?'overlays':feature.startsWith('form_')?'acroform':feature.startsWith('page_')?'page_editor':feature.startsWith('batch_')?'batch_pages':feature.startsWith('source_')?'source_editor':feature.startsWith('native_')?'annotations':'editor_operations';
 Object.assign(TRACE_PROFILES,{
  pdf_lock:{module:'pdf_protect',calls:{operation_failed:'encrypt_pdf'}},
  pdf_unlock:{module:'pdf_protect',calls:{operation_failed:'decrypt_pdf'}},
  pdf_crypto_compress:{module:'pdf_protect',calls:{operation_failed:'compress_pdf'}},
  signature_sign:{module:'pdf_signing',calls:{operation_failed:'sign_pdf'}},
  signature_verify:{module:'pdf_signing',calls:{operation_failed:'verify_signature'}},
  office_export_text:{module:'office_export',calls:{operation_failed:'convert_text'}},
  office_export_advanced:{module:'office_export',calls:{operation_failed:'convert_layout'}}
 });
 for(const feature of OPERATION_FEATURES){
  if(Object.hasOwn(TRACE_PROFILES,feature))TRACE_PROFILES[feature]={...TRACE_PROFILES[feature],calls:{...TRACE_PROFILES[feature].calls,operation_failed:'run_'+feature}};
  else TRACE_PROFILES[feature]={module:genericModule(feature),calls:{operation_failed:'run_'+feature}};
 }
 Object.freeze(TRACE_PROFILES);
 const TRACE_TOP=['schema','id','feature','code','phase','module','callsite','fingerprint','client_release','steps','structure'];
 const TRACE_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
 const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&Object.keys(v).every(k=>keys.includes(k));
 const durationBucket=ms=>ms<100?'0to99':ms<500?'100to499':ms<2000?'500to1999':ms<10000?'2000to9999':'ge10000';
 function traceFingerprint(feature,code,phase,module,callsite){
  const input=[feature,code,phase,module,callsite].join(':');let hash=2166136261;
  for(let i=0;i<input.length;i++)hash=Math.imul(hash^input.charCodeAt(i),16777619)>>>0;
  return hash.toString(16).padStart(8,'0');
 }
 function normalizeTrace(value){
  if(!exact(value,TRACE_TOP)||value.schema!==TRACE_SCHEMA||typeof value.id!=='string'||!TRACE_UUID.test(value.id)||
   typeof value.feature!=='string'||typeof value.code!=='string'||
   !Object.hasOwn(TRACE_PROFILES,value.feature)||!Object.hasOwn(TRACE_PROFILES[value.feature].calls,value.code)||
   value.phase!==CODES[value.code][0]||value.module!==TRACE_PROFILES[value.feature].module||value.callsite!==TRACE_PROFILES[value.feature].calls[value.code]||
   (!TRACE_RELEASES.includes(value.client_release)||
    (value.client_release==='trace2-dev1-20261109'&&!['batch_split','batch_merge'].includes(value.feature))||
    (value.client_release==='trace2-dev2-20261109'&&!['batch_split','batch_merge','open','save_prepare','page_duplicate','page_delete'].includes(value.feature))||
    (value.client_release==='trace2-dev3-20261109'&&!LEGACY_FEATURES.includes(value.feature))||
    (!['trace2-dev3-20261109',TRACE_BUILD].includes(value.client_release)&&value.code==='operation_failed'))||
   value.fingerprint!==traceFingerprint(value.feature,value.code,value.phase,value.module,value.callsite)||
   !Array.isArray(value.steps)||value.steps.length<1||value.steps.length>12||
   !value.steps.every(s=>exact(s,['step','duration'])&&TRACE_STEPS.includes(s.step)&&TRACE_DURATIONS.includes(s.duration))||
   !exact(value.structure,TRACE_FLAGS)||!TRACE_FLAGS.every(k=>value.structure[k]===null||typeof value.structure[k]==='boolean'))return null;
  let json;try{json=JSON.stringify(value)}catch{return null}
  if(json.length>TRACE_MAX_BYTES)return null;
  return JSON.parse(json);
 }
 function createTrace(feature){
  if(!Object.hasOwn(TRACE_PROFILES,feature))return null;
  let id;try{id=globalThis.crypto?.randomUUID?.()}catch{return null}
  if(!TRACE_UUID.test(id||''))return null;
  const clock=()=>Number.isFinite(globalThis.performance?.now?.())?globalThis.performance.now():Date.now();
  let last=clock(),ended=false;
  const steps=[],structure=Object.fromEntries(TRACE_FLAGS.map(k=>[k,null]));
  const mark=(step)=>{
   if(ended||!TRACE_STEPS.includes(step))return false;
   const now=clock(),delta=Math.max(0,Number.isFinite(now-last)?now-last:0);last=now;
   if(steps.length>=12)steps.shift();steps.push({step,duration:durationBucket(delta)});return true;
  };
  mark('select');
  return Object.freeze({
   id,
   mark,
   structure(flags){
    if(ended||!flags||typeof flags!=='object'||Array.isArray(flags)||Object.keys(flags).some(k=>!TRACE_FLAGS.includes(k)))return false;
    for(const k of TRACE_FLAGS)if(Object.hasOwn(flags,k)){
     if(flags[k]!==null&&typeof flags[k]!=='boolean')return false;
     structure[k]=flags[k];
    }
    return true;
   },
   failure(code){
    if(ended||!Object.hasOwn(TRACE_PROFILES[feature].calls,code))return null;
    ended=true;
    const phase=CODES[code][0],module=TRACE_PROFILES[feature].module,callsite=TRACE_PROFILES[feature].calls[code];
    const value={schema:TRACE_SCHEMA,id,feature,code,phase,module,callsite,
     fingerprint:traceFingerprint(feature,code,phase,module,callsite),client_release:TRACE_BUILD,
     steps:steps.slice(),structure:{...structure}};
    return normalizeTrace(value);
   },
   cancel(){ended=true;steps.length=0;}
  });
 }

 function sizeBucket(n){return !Number.isSafeInteger(n)||n<0?'unknown':n===0?'empty':n<1048576?'lt1m':n<10485760?'1to10m':n<52428800?'10to50m':n<209715200?'50to200m':'ge200m';}
 function pageBucket(n){return !Number.isSafeInteger(n)||n<1?'unknown':n===1?'one':n<=10?'2to10':n<=100?'11to100':n<=500?'101to500':'gt500';}
 function browser(ua){return /Edg\//.test(ua)?'edge':/Firefox\//.test(ua)?'firefox':/Chrome\//.test(ua)?'chrome':/Safari\//.test(ua)?'safari':'other';}
 function normalize(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.code!=='string'||Object.keys(value).some(k=>!['code','phase','origin','size','pages','browser','build','trace'].includes(k)))return null;
  if(!Object.hasOwn(CODES,value.code)||CODES[value.code][0]!==value.phase||value.build!==BUILD)return null;
  for(const [key,list] of Object.entries(ENUMS))if(!includes(list,value[key]))return null;
  const safe=Object.fromEntries(['code','phase','origin','size','pages','browser','build'].map(k=>[k,value[k]]));
  if(Object.hasOwn(value,'trace')){
   const trace=normalizeTrace(value.trace);
   if(!trace||trace.code!==safe.code||trace.phase!==safe.phase)return null;
   safe.trace=trace;
  }
  return safe;
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
 return Object.freeze({BUILD,CODES,ENUMS,TRACE_SCHEMA,TRACE_BUILD,TRACE_FLAGS,OPERATION_FEATURES,normalize,normalizeTrace,createTrace,describe,tagged,capture,sizeBucket,pageBucket,hasPdfHeader});
});
