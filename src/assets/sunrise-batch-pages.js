// Safe multi-PDF page splitting and merging, without any OCR.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunriseBatchPages=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_FILES=5;
  const MAX_SOURCE_PAGES=150,MAX_MERGED_PAGES=250,MAX_OUTPUTS=50;
  const PAGE_YIELD_INTERVAL=8;
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
  const PAGE_BOX_METHODS=['getMediaBox','getCropBox','getBleedBox','getTrimBox','getArtBox'];
  // Fingerprint only encoded page content streams (not entire PDF images or
  // resources). PDF page copying should preserve these bytes exactly. This
  // catches dropped/truncated/replaced text and drawing streams without
  // retaining source page objects or cloning their content into memory.
  function pageContentFingerprint(page){
    const contents=page.node.Contents();
    if(!contents)return {streams:0,bytes:0,hash:0};
    const isArray=typeof contents.size==='function'&&typeof contents.get==='function';
    const streams=isArray
      ? Array.from({length:contents.size()},(_,i)=>page.doc.context.lookup(contents.get(i)))
      : [contents];
    let hash=2166136261>>>0,bytes=0;
    const mix=value=>{hash=Math.imul(hash^(value&255),16777619)>>>0;};
    for(const stream of streams){
      const raw=stream?.getContents?.();
      if(!ArrayBuffer.isView(raw)||raw.BYTES_PER_ELEMENT!==1){
        throw new Error('검증할 수 없는 PDF 페이지 내용 스트림입니다.');
      }
      if(!Number.isSafeInteger(bytes+raw.byteLength)){
        throw new Error('PDF 페이지 내용 스트림의 크기를 안전하게 계산할 수 없습니다.');
      }
      bytes+=raw.byteLength;
      for(let offset=0;offset<raw.byteLength;offset++)mix(raw[offset]);
      // Preserve stream boundaries so concatenated content cannot masquerade
      // as the same sequence with different PDF stream array structure.
      for(let byte=0;byte<4;byte++)mix((raw.byteLength>>>(byte*8))&255);
    }
    return {streams:streams.length,bytes,hash};
  }
  // Store only numeric page geometry for merging. Retaining source PDFPage
  // objects through output verification would also retain entire source PDF
  // contexts, even after that source has been copied into the target.
  function snapshotPageGeometry(page){
    const boxes={};
    for(const method of PAGE_BOX_METHODS){
      const box=page[method]();
      boxes[method]={x:box.x,y:box.y,width:box.width,height:box.height};
    }
    return {rotation:page.getRotation().angle,boxes,content:pageContentFingerprint(page)};
  }
  function verifyPages(sources,actual){
    const expected=sources.flat();
    if(actual.length!==expected.length)throw new Error('저장한 PDF의 페이지 수가 일치하지 않습니다.');
    for(let index=0;index<expected.length;index++){
      // Existing page-object callers remain supported; merge supplies small
      // snapshots so source PDF contexts need not survive until verification.
      const before=typeof expected[index]?.getRotation==='function'
        ? snapshotPageGeometry(expected[index]):expected[index];
      const after=snapshotPageGeometry(actual[index]);
      if(before?.rotation!==after.rotation)
        throw new Error('결과 '+(index+1)+'쪽의 회전이 달라졌습니다.');
      // Legacy numeric snapshots without `content` retain their documented
      // geometry-only contract, while actual processing provides fingerprints.
      if(before?.content && (before.content.streams!==after.content.streams||
         before.content.bytes!==after.content.bytes||
         before.content.hash!==after.content.hash))
        throw new Error('결과 '+(index+1)+'쪽의 PDF 내용 스트림이 변경되거나 누락되었습니다.');
      for(const method of PAGE_BOX_METHODS){
        const a=before?.boxes?.[method],b=after.boxes[method];
        if(!a||!['x','y','width','height'].every(k=>Number.isFinite(a[k])&&Number.isFinite(b[k])&&Math.abs(a[k]-b[k])<.01))
          throw new Error('결과 '+(index+1)+'쪽 '+method+' 위치·크기가 달라졌습니다.');
      }
    }
  }
  function stopIfCancelled(cancelled){
    if(cancelled?.()){
      const error=new Error('일괄 PDF 작업이 취소되었습니다.');
      error.name='AbortError';
      throw error;
    }
  }
  async function readSource(file,opts,cancelled){
    stopIfCancelled(cancelled);
    const bytes=await opts.readFile(file);
    // A pending browser File.arrayBuffer() read cannot be interrupted. Avoid
    // expensive parsing if the user cancelled before the read resolved.
    stopIfCancelled(cancelled);
    if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||
       !bytes.byteLength||bytes.byteLength!==file.size)
      throw new Error('입력 PDF의 실제 읽은 바이트 수가 파일 크기와 일치하지 않습니다.');
    const pdf=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    stopIfCancelled(cancelled);
    const pages=checkSource(pdf,opts.PDFLib);
    stopIfCancelled(cancelled);
    return {pdf,pages,name:file.name};
  }
  async function verifyResult(pdf,expectedPages,opts,cancelled){
    stopIfCancelled(cancelled);
    const bytes=await pdf.save({updateFieldAppearances:false});
    // Serialization is not cancellable once started; do not parse a result
    // which the caller has already discarded.
    stopIfCancelled(cancelled);
    if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||!bytes.byteLength)
      throw new Error('저장 결과의 바이트를 읽을 수 없거나 비어 있습니다.');
    const restored=await opts.PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    stopIfCancelled(cancelled);
    checkSource(restored,opts.PDFLib,MAX_MERGED_PAGES);
    stopIfCancelled(cancelled);
    verifyPages([expectedPages],restored.getPages());
    stopIfCancelled(cancelled);
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
    const pageProgress=(done,total,name)=>handlers?.pageProgress?.(done,total,name);
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
          const source=await readSource(file,opts,cancelled);
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
            stopIfCancelled(cancelled);
            copied.forEach(page=>pdf.addPage(page));
            const bytes=await verifyResult(pdf,source.pages.slice(start,end),opts,cancelled);
            reserveOutputBytes(emittedBytes+stagedBytes,bytes.byteLength);
            stagedBytes+=bytes.byteLength;
            staged.push({index:i,part:chunk+1,startPage:start+1,endPage:end,totalParts:chunkCount,name:file.name,bytes});
            pageProgress(end,source.pages.length,file.name);
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
        const loaded=await readSource(file,opts,cancelled);
        if(expected.length+loaded.pages.length>MAX_MERGED_PAGES)
          throw new Error('병합 결과는 250쪽을 초과할 수 없습니다.');
        expected.push(...loaded.pages.map(snapshotPageGeometry));
        sources.push({pdf:loaded.pdf,pageCount:loaded.pages.length,name:loaded.name});
      }catch(e){if(cancelled())return;error({index:i,name:file.name,message:e?.message||'입력 PDF 검증에 실패했습니다.'});return}
    }
    if(cancelled())return;
    try{
      const merged=await pdfCtor.create();
      merged.setTitle('Sunrise PDF Editor - Merged PDF');
      let added=0;
      for(let sourceIndex=0;sourceIndex<sources.length;sourceIndex++){
        if(cancelled())return;
        const input=sources[sourceIndex];
        const indices=Array.from({length:input.pageCount},(_,i)=>i);
        // Copy each source once: splitting the copy into multiple calls would
        // duplicate shared PDF resources and could increase output size.
        const copied=await merged.copyPages(input.pdf,indices);
        stopIfCancelled(cancelled);
        for(let first=0;first<copied.length;first+=PAGE_YIELD_INTERVAL){
          if(cancelled())return;
          const last=Math.min(first+PAGE_YIELD_INTERVAL,copied.length);
          for(let index=first;index<last;index++)merged.addPage(copied[index]);
          added+=last-first;
          pageProgress(added,expected.length,input.name);
          // Give the UI a chance to process a Cancel click after each group.
          await yieldToBrowser();
        }
        // The merged document now owns the copied pages. Release the
        // processed source's PDF context before moving to the next file.
        sources[sourceIndex]=null;
      }
      if(cancelled())return;
      const bytes=await verifyResult(merged,expected,opts,cancelled);
      if(!cancelled())result({index:0,name:'Sunrise_batch_merged.pdf',bytes,startPage:1,endPage:expected.length,totalParts:1,part:1});
    }catch(e){if(!cancelled())error({index:-1,name:'병합 결과',message:e?.message||'병합 결과 검증에 실패했습니다.'})}
  }
  return {process,checkFiles,checkSource,verifyPages,reserveOutputBytes};
});
