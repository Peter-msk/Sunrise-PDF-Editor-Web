// Safe multi-PDF page splitting and merging, without any OCR.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunriseBatchPages=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_FILES=5;
  const MAX_SOURCE_PAGES=150,MAX_MERGED_PAGES=250,MAX_OUTPUTS=50;
  // No fixed byte quota for split results. Retain checked arithmetic so a
  // rounded/overflowing byte counter cannot silently break queue accounting.
  function reserveOutputBytes(usedBytes,nextBytes){
    if(!Number.isSafeInteger(usedBytes)||usedBytes<0||
       !Number.isSafeInteger(nextBytes)||nextBytes<=0||
       !Number.isSafeInteger(usedBytes+nextBytes))
      throw new Error('분할 결과의 바이트 수를 안전하게 계산할 수 없습니다.');
    return usedBytes+nextBytes;
  }
  // Yield at file/chunk boundaries so the browser can receive a Cancel click.
  // PDF parsing or a single page-copy itself is not interruptible.
  async function yieldToBrowser(){
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const protectedCatalog=['AcroForm','Perms','Outlines','Names','AF','Collection',
    'StructTreeRoot','MarkInfo','OpenAction','AA','OCProperties','DSS','PageLabels'];
  const protectedPage=['Annots','AA','Metadata','StructParents','B','PresSteps'];
  function checkFiles(files,mode){
    if(!Array.isArray(files)||!files.length||files.length>MAX_FILES||
       (mode==='merge'&&files.length<2)||!files.every(x=>Number.isSafeInteger(x?.size)&&x.size>0)||
       !Number.isSafeInteger(files.reduce((n,f)=>n+f.size,0)))
      throw new Error(mode==='merge'
        ? '병합은 비어 있지 않은 PDF 2~5개를 선택해 주세요.'
        : '분할은 비어 있지 않은 PDF 1~5개를 선택해 주세요.');
  }
  function checkSource(pdf,lib,maxPages=MAX_SOURCE_PAGES){
    const n=lib.PDFName.of;
    for(const name of protectedCatalog){
      if(pdf.catalog.get(n(name)))throw new Error('문서 구조 보존을 위해 '+name+' 포함 PDF는 분할·병합하지 않습니다.');
    }
    const pages=pdf.getPages();
    if(!pages.length||pages.length>maxPages)
      throw new Error('페이지 수 제한을 초과했습니다. 최대 '+maxPages+'쪽까지 지원합니다.');
    for(const page of pages){
      for(const name of protectedPage){
        const reference=page.node.get(n(name));
        if(!reference)continue;
        if(name==='Annots'){
          const annots=pdf.context.lookup(reference);
          // pdf-lib initializes empty /Annots arrays even on untouched pages.
          // Block actual annotations, not the empty placeholder.
          if(annots instanceof lib.PDFArray && annots.size()===0)continue;
        }
        throw new Error('페이지의 '+name+' 구조가 있어 분할·병합을 제한합니다.');
      }
    }
    return pages;
  }
  function verifyPages(sources,actual){
    const expected=sources.flat();
    if(actual.length!==expected.length)throw new Error('저장한 PDF의 페이지 수가 일치하지 않습니다.');
    for(let index=0;index<expected.length;index++){
      const before=expected[index],after=actual[index];
      if(before.getRotation().angle!==after.getRotation().angle)
        throw new Error('결과 '+(index+1)+'쪽의 회전이 달라졌습니다.');
      for(const method of ['getMediaBox','getCropBox','getBleedBox','getTrimBox','getArtBox']){
        const a=before[method](),b=after[method]();
        if(!['x','y','width','height'].every(k=>Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<.01))
          throw new Error('결과 '+(index+1)+'쪽 '+method+' 위치·크기가 달라졌습니다.');
      }
    }
  }
  async function readSource(file,opts){
    const bytes=await opts.readFile(file);
    if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||
       !bytes.byteLength)
      throw new Error('입력 PDF 크기 또는 바이트를 확인할 수 없습니다.');
    const pdf=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    const pages=checkSource(pdf,opts.PDFLib);
    return {pdf,pages,name:file.name};
  }
  async function verifyResult(pdf,expectedPages,opts){
    const bytes=await pdf.save({updateFieldAppearances:false});
    if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||!bytes.byteLength)
      throw new Error('저장 결과의 바이트를 읽을 수 없거나 비어 있습니다.');
    const restored=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    checkSource(restored,opts.PDFLib,MAX_MERGED_PAGES);
    verifyPages([expectedPages],restored.getPages());
    return bytes;
  }
  async function process(files,settings,handlers,opts){
    const mode=settings?.mode;
    if(!['split','merge'].includes(mode))throw new Error('분할 또는 병합 작업 종류를 확인해 주세요.');
    checkFiles(files,mode);
    if(!opts?.PDFLib?.PDFDocument||typeof opts.readFile!=='function')
      throw new Error('PDF 처리 엔진 또는 파일 읽기 기능이 없습니다.');
    const cancelled=()=>Boolean(handlers?.cancelled?.());
    const progress=(i,total,name)=>handlers?.progress?.(i,total,name);
    const error=(e)=>handlers?.error?.(e);
    const result=(e)=>handlers?.result?.(e);
    const pdfCtor=opts.PDFLib.PDFDocument;
    if(mode==='split'){
      const perFile=Number(settings.pagesPerFile);
      if(!Number.isSafeInteger(perFile)||perFile<1||perFile>100)
        throw new Error('출력 PDF당 페이지 수는 1~100쪽이어야 합니다.');
      let emitted=0,emittedBytes=0;
      for(let i=0;i<files.length;i++){
        if(cancelled())break;
        const file=files[i];progress(i,files.length,file.name);
        await yieldToBrowser();
        if(cancelled())break;
        try{
          const source=await readSource(file,opts);
          const chunkCount=Math.ceil(source.pages.length/perFile);
          if(emitted+chunkCount>MAX_OUTPUTS)throw new Error('이번 작업의 결과 파일 수가 최대 50개를 초과합니다. 출력당 페이지 수를 늘려 주세요.');
          const staged=[];
          let stagedBytes=0;
          for(let chunk=0;chunk<chunkCount;chunk++){
            if(cancelled())break;
            const start=chunk*perFile,end=Math.min(source.pages.length,start+perFile);
            const pdf=await pdfCtor.create(),range=Array.from({length:end-start},(_,x)=>start+x);
            // Each split file can retain unambiguous descriptive properties;
            // creation/modification timestamps intentionally reflect a new file.
            for(const [getter,setter] of [['getTitle','setTitle'],['getAuthor','setAuthor'],
              ['getSubject','setSubject'],['getCreator','setCreator']]){
              const value=source.pdf[getter]();
              if(typeof value==='string'&&value)pdf[setter](value);
            }
            const copied=await pdf.copyPages(source.pdf,range);
            copied.forEach(page=>pdf.addPage(page));
            const bytes=await verifyResult(pdf,source.pages.slice(start,end),opts);
            reserveOutputBytes(emittedBytes+stagedBytes,bytes.byteLength);
            stagedBytes+=bytes.byteLength;
            staged.push({index:i,part:chunk+1,startPage:start+1,endPage:end,totalParts:chunkCount,name:file.name,bytes});
            await yieldToBrowser();
          }
          if(cancelled())break;
          for(const item of staged)result(item);
          emitted+=staged.length;
          emittedBytes+=stagedBytes;
        }catch(e){if(cancelled())break;error({index:i,name:file.name,message:e?.message||'분할에 실패했습니다.'})}
      }
      return;
    }
    // Merge is atomic: every source must pass before a single output is offered.
    const sources=[],expected=[];
    for(let i=0;i<files.length;i++){
      if(cancelled())return;
      const file=files[i];progress(i,files.length,file.name);
      await yieldToBrowser();
      if(cancelled())return;
      try{
        const loaded=await readSource(file,opts);
        sources.push(loaded);expected.push(...loaded.pages);
        if(expected.length>MAX_MERGED_PAGES)throw new Error('병합 결과는 250쪽을 초과할 수 없습니다.');
      }catch(e){if(cancelled())return;error({index:i,name:file.name,message:e?.message||'입력 PDF 검증에 실패했습니다.'});return}
    }
    if(cancelled())return;
    try{
      const merged=await pdfCtor.create();
      merged.setTitle('Sunrise PDF Editor - Merged PDF');
      for(const input of sources){
        if(cancelled())return;
        const indices=Array.from({length:input.pages.length},(_,i)=>i);
        const copied=await merged.copyPages(input.pdf,indices);
        copied.forEach(p=>merged.addPage(p));
      }
      if(cancelled())return;
      const bytes=await verifyResult(merged,expected,opts);
      if(!cancelled())result({index:0,name:'Sunrise_batch_merged.pdf',bytes,startPage:1,endPage:expected.length,totalParts:1,part:1});
    }catch(e){if(!cancelled())error({index:-1,name:'병합 결과',message:e?.message||'병합 결과 검증에 실패했습니다.'})}
  }
  return {process,checkFiles,checkSource,verifyPages,reserveOutputBytes};
});
