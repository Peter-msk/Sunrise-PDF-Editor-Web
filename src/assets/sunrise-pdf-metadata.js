/* Sunrise PDF Editor - PDF document properties viewer/editor.
 * Local-only; produces a separate copy. No OCR, server requests, signatures,
 * or claims that changing Info dictionary erases all embedded metadata.
 */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunrisePdfMetadata=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_PAGES=500;
  const FIELDS=['title','author','subject','creator','producer','keywords'];
  const BOXES=['getMediaBox','getCropBox','getBleedBox','getTrimBox','getArtBox'];
  const docGetter={title:'getTitle',author:'getAuthor',subject:'getSubject',creator:'getCreator',producer:'getProducer',keywords:'getKeywords'};
  const docSetter={title:'setTitle',author:'setAuthor',subject:'setSubject',creator:'setCreator',producer:'setProducer'};
  function abort(cancelled){
    if(cancelled?.()){const error=new Error('사용자가 문서 속성 변경을 취소했습니다.');error.name='AbortError';throw error;}
  }
  function geometry(page){
    const boxes={};
    for(const name of BOXES){
      const b=page[name]();
      boxes[name]={x:b.x,y:b.y,width:b.width,height:b.height};
    }
    return {rotation:page.getRotation().angle,boxes};
  }
  function compareGeometry(before,after){
    if(before.length!==after.length)throw new Error('문서 속성 변경 결과의 페이지 수가 다릅니다.');
    for(let i=0;i<before.length;i++){
      const a=before[i],b=geometry(after[i]);
      if(a.rotation!==b.rotation)throw new Error(`${i+1}쪽 회전이 변경되었습니다.`);
      for(const key of BOXES){
        if(!['x','y','width','height'].every(k=>Number.isFinite(a.boxes[key][k])&&
          Number.isFinite(b.boxes[key][k])&&Math.abs(a.boxes[key][k]-b.boxes[key][k])<0.01)){
          throw new Error(`${i+1}쪽 ${key} 영역이 변경되었습니다.`);
        }
      }
    }
  }
  function checkProtected(pdf,lib){
    const n=lib.PDFName.of;
    if(pdf.catalog.has(n('Perms'))||pdf.catalog.has(n('DSS')))
      throw new Error('전자서명·권한 인증이 있는 PDF는 문서 속성 변경을 제한합니다.');
    if(pdf.catalog.has(n('Encrypt')))
      throw new Error('암호화된 PDF의 문서 속성은 변경하지 않습니다.');
    const form=pdf.catalog.get(n('AcroForm'));
    if(form){
      const fields=pdf.getForm().getFields();
      if(fields.some(field=>field.constructor?.name==='PDFSignature'||
         (lib.PDFSignature&&field instanceof lib.PDFSignature)))
        throw new Error('전자서명 필드가 있는 PDF는 변경하지 않습니다.');
    }
    const pages=pdf.getPages();
    if(pages.length<1||pages.length>MAX_PAGES)
      throw new Error(`문서 속성 수정은 1~${MAX_PAGES}쪽 PDF를 지원합니다.`);
    return pages;
  }
  async function loadSource(file,opts){
    if(!opts?.PDFLib?.PDFDocument||typeof opts.readFile!=='function')
      throw new Error('PDF 처리 엔진을 불러오지 못했습니다.');
    if(!Number.isSafeInteger(file?.size)||file.size<=0)
      throw new Error('유효한 PDF 파일을 선택해 주세요.');
    abort(opts.cancelled);
    const bytes=await opts.readFile(file);
    if(!ArrayBuffer.isView(bytes)||bytes.byteLength!==file.size)
      throw new Error('PDF 파일이 완전히 읽히지 않았습니다.');
    abort(opts.cancelled);
    const pdf=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    const pages=checkProtected(pdf,opts.PDFLib);
    return {pdf,pages};
  }
  function getInfo(pdf){
    const properties={};
    for(const field of FIELDS){
      const result=pdf[docGetter[field]]?.();
      properties[field]=typeof result==='string'?result:'';
    }
    return properties;
  }
  async function inspect(file,opts){
    const {pdf,pages}=await loadSource(file,opts);
    return {fileName:file.name,pageCount:pages.length,properties:getInfo(pdf),
      note:'일반 문서 정보(Info 사전)만 확인합니다. XMP·첨부파일·개인정보 완전 삭제 기능이 아닙니다.'};
  }
  function normalizeChanges(changes){
    if(!changes||typeof changes!=='object'||Array.isArray(changes))
      throw new Error('수정할 문서 속성을 입력해 주세요.');
    const allowed=new Set(FIELDS);
    const result={};
    for(const [key,val] of Object.entries(changes)){
      if(!allowed.has(key))throw new Error('지원되지 않는 PDF 문서 속성입니다: '+key);
      if(typeof val!=='string'||val.length>2048||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(val))
        throw new Error(`${key} 속성의 길이 또는 제어 문자를 확인해 주세요.`);
      result[key]=val.trim();
    }
    if(!Object.keys(result).length)throw new Error('변경할 문서 속성이 없습니다.');
    return result;
  }
  async function apply(file,changes,opts){
    const patch=normalizeChanges(changes);
    const {pdf,pages}=await loadSource(file,opts);
    const geometryBefore=pages.map(geometry);
    const originalFields=pdf.catalog.get(opts.PDFLib.PDFName.of('AcroForm'))?
      pdf.getForm().getFields().length:0;
    const old=getInfo(pdf);
    let changed=0;
    for(const key of FIELDS){
      if(!(key in patch)||old[key]===patch[key])continue;
      abort(opts.cancelled);
      if(key==='keywords'){
        // PDF-lib accepts a list of keywords and serializes it in Info.
        pdf.setKeywords(patch.keywords.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean));
      }else pdf[docSetter[key]](patch[key]);
      changed++;
      opts.onProgress?.({done:changed,total:Object.keys(patch).length,field:key});
    }
    if(!changed)throw new Error('기존 문서 속성과 달라진 내용이 없습니다.');
    abort(opts.cancelled);
    pdf.setModificationDate(new Date());
    const bytes=await pdf.save({updateFieldAppearances:false});
    abort(opts.cancelled);
    if(!ArrayBuffer.isView(bytes)||bytes.byteLength===0)
      throw new Error('PDF 저장 결과가 비어 있습니다.');
    const saved=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    const savedPages=checkProtected(saved,opts.PDFLib);
    compareGeometry(geometryBefore,savedPages);
    const finalFields=saved.catalog.get(opts.PDFLib.PDFName.of('AcroForm'))?
      saved.getForm().getFields().length:0;
    if(originalFields!==finalFields)throw new Error('문서 속성 변경 중 PDF 양식 필드 수가 달라졌습니다.');
    const after=getInfo(saved);
    for(const [key,value] of Object.entries(patch)){
      if(key==='keywords'){
        for(const term of value.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean))
          if(!after.keywords.includes(term))throw new Error('키워드 저장 검증이 완료되지 않았습니다.');
      }else if(after[key]!==value)throw new Error(`${key} 속성의 저장 결과가 다릅니다.`);
    }
    abort(opts.cancelled);
    return {bytes,pageCount:savedPages.length,properties:after,changed,
      warning:'일반 문서 정보 변경 기능입니다. XMP/첨부파일/본문에 남은 개인정보까지 지우지는 않습니다.'};
  }
  return {inspect,apply,normalizeChanges,MAX_PAGES};
});
