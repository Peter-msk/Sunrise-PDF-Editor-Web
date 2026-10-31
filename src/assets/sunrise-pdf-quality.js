// PDF submission checks run locally in the browser and use only existing PDF
// objects/text. No OCR. This is a conservative preflight, not a PDF/A validator.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.SunrisePdfQuality=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
  'use strict';
  const MAX_FILE=50*1024*1024,MAX_SCAN=120,MAX_ISSUES=120;
  // pdf-lib can discard unsupported XFA while opening a document. Inspect the
  // original bytes before parsing, but treat this as an indicator only:
  // compressed object streams and escaped names can hide a marker.
  function hasRawPdfName(bytes,name){
    const token=Array.from('/'+name,c=>c.charCodeAt(0));
    const delimiter=b=>b===0||b===9||b===10||b===12||b===13||b===32||
      b===40||b===41||b===47||b===60||b===62||b===91||b===93||b===123||b===125;
    for(let i=0;i<=bytes.byteLength-token.length;i++){
      if(i>0&&!delimiter(bytes[i-1]))continue;
      let matched=true;
      for(let j=0;j<token.length;j++)if(bytes[i+j]!==token[j]){matched=false;break;}
      if(matched&&(i+token.length===bytes.byteLength||delimiter(bytes[i+token.length])))return true;
    }
    return false;
  }
  async function inspect(raw,opts){
    const PDFLib=opts?.PDFLib;
    if(!PDFLib?.PDFDocument?.load)throw Error('PDF 구조 검사 엔진을 불러오지 못했습니다.');
    const bytes=raw instanceof ArrayBuffer?new Uint8Array(raw):raw;
    if(!ArrayBuffer.isView(bytes)||bytes.BYTES_PER_ELEMENT!==1||!bytes.byteLength||bytes.byteLength>MAX_FILE)
      throw Error('PDF는 50 MiB 이하의 파일만 검사할 수 있습니다.');
    const rawXfa=hasRawPdfName(bytes,'XFA');
    const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    const pages=pdf.getPages();
    if(!pages.length)throw Error('페이지가 없는 PDF입니다.');
    const N=PDFLib.PDFName.of,issues=[],orientation={portrait:0,landscape:0,square:0};
    const emit=(severity,code,message,page)=>{
      if(issues.length<MAX_ISSUES)issues.push({severity,code,message,...(page===undefined?{}:{page})});
    };
    const checkCancelled=()=>{if(opts?.cancelled?.())throw Error('검사가 취소되었습니다.');};
    const ctx=pdf.context;
    const resolve=value=>value?ctx.lookup(value):null;
    let fontResources=0,formFields=0,emptyRequired=0,blankCandidates=0;
    for(let index=0;index<pages.length;index++){
      checkCancelled();
      const page=pages[index],box=page.getCropBox(),angle=((page.getRotation().angle%360)+360)%360;
      const dims=[box.x,box.y,box.width,box.height];
      if(dims.some(v=>!Number.isFinite(v))||box.width<=0||box.height<=0||![0,90,180,270].includes(angle)){
        emit('error','page-geometry','페이지 크기·좌표·회전값이 올바르지 않습니다.',index+1);
        continue;
      }
      const width=(angle===90||angle===270)?box.height:box.width;
      const height=(angle===90||angle===270)?box.width:box.height;
      if(Math.abs(width-height)<0.01)orientation.square++;
      else orientation[width>height?'landscape':'portrait']++;
      if(width<72||height<72||width>14400||height>14400)
        emit('review','unusual-page-size','페이지 크기가 일반 사무 문서와 다릅니다. 원본에서 확인해 주세요.',index+1);
      // /Resources can be inherited from ancestor page-tree nodes.
      try{
        const resources=page.node.Resources?.();
        const font=resources?.get?.(N('Font'));
        if(font){
          const fonts=resolve(font);
          if(!(fonts instanceof PDFLib.PDFDict)){
            emit('review','font-resource','페이지 글꼴 리소스를 판독하지 못했습니다.',index+1);
          }else{
            for(const [key,ref] of fonts.entries()){
              fontResources++;
              try{
                const descriptor=resolve(ref);
                if(!(descriptor instanceof PDFLib.PDFDict) || !descriptor.get(N('Subtype')))
                  emit('review','font-unresolved','글꼴 리소스 '+String(key)+'가 불완전하거나 판독할 수 없습니다.',index+1);
              }catch{
                emit('review','font-unresolved','글꼴 참조 '+String(key)+'를 읽지 못했습니다.',index+1);
              }
            }
          }
        }
      }catch{
        emit('review','font-resource','글꼴 리소스 구조를 확인하지 못했습니다.',index+1);
      }
    }
    if(orientation.portrait&&orientation.landscape)
      emit('review','mixed-orientation','세로·가로 페이지가 혼합되어 있습니다. 제출 형식에 맞는지 확인해 주세요.');
    const cat=pdf.catalog;
    if(rawXfa)emit('review','xfa-form','원본 PDF에서 XFA 구조 표기가 발견되었습니다. 지원되지 않는 양식이 누락될 수 있으므로 별도 확인하세요.');
    if(cat.get(N('Perms')))emit('review','signature','서명·권한 관련 구조가 있습니다. 서명 유효성은 별도 검사해야 합니다.');
    if(cat.get(N('Encrypt')))emit('review','security','암호·권한 설정이 있습니다. 제출처의 허용 여부를 확인해 주세요.');
    if(cat.get(N('AcroForm'))){
      try{
        const dict=resolve(cat.get(N('AcroForm')));
        if(dict?.get?.(N('XFA'))&&!rawXfa)
          emit('review','xfa-form','XFA 양식 구조가 확인되었습니다. 입력값의 표시·저장 호환성을 별도로 확인하세요.');
        const fields=pdf.getForm().getFields();
        formFields=fields.length;
        for(const field of fields){
          const fieldName=field.getName();
          const type=field.constructor?.name||'Unknown';
          if(type==='PDFSignature')emit('review','signature-field','서명 필드가 있습니다. 서명 상태를 수동 확인하세요.');
          if(!field.isRequired?.())continue;
          let empty=false,known=true;
          if(field instanceof PDFLib.PDFTextField)empty=!String(field.getText()||'').trim();
          else if(field instanceof PDFLib.PDFCheckBox)empty=!field.isChecked();
          else if(field instanceof PDFLib.PDFRadioGroup)empty=!field.getSelected();
          else if(field instanceof PDFLib.PDFDropdown || field instanceof PDFLib.PDFOptionList)
            empty=!field.getSelected()?.length;
          else known=false;
          if(known&&empty){emptyRequired++;emit('review','required-field','필수 양식 입력란이 비어 있습니다: '+fieldName);}
        }
      }catch{
        emit('review','form-unchecked','양식 필드 상태를 모두 확인할 수 없습니다.');
      }
    }
    const scanPages=Math.min(pages.length,Number.isSafeInteger(opts?.maxPages)?Math.max(1,Math.min(MAX_SCAN,opts.maxPages)):MAX_SCAN);
    let scannedPages=0,renderUnknown=false;
    if(opts?.pdfjsLib?.getDocument&&opts?.pdfjsLib?.OPS){
      let task=null,reader=null;
      try{
        task=opts.pdfjsLib.getDocument({data:new Uint8Array(bytes),useSystemFonts:true});
        reader=await task.promise;
        if(reader.isPureXfa&&!rawXfa)emit('review','xfa-form','XFA 기반 PDF입니다. 내용 표시와 양식 호환성을 직접 확인해 주세요.');
        const ops=opts.pdfjsLib.OPS;
        const visibleOps=new Set([
          ops.showText,ops.showSpacedText,ops.nextLineShowText,ops.nextLineSetSpacingShowText,
          ops.paintImageXObject,ops.paintJpegXObject,ops.paintInlineImageXObject,ops.paintImageMaskXObject,
          ops.paintImageMaskXObjectGroup,ops.paintImageXObjectRepeat,ops.paintFormXObjectBegin,
          ops.constructPath,ops.stroke,ops.closeStroke,ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,
          ops.shadingFill,ops.paintSolidColorImageMask
        ].filter(x=>Number.isInteger(x)));
        for(let i=0;i<scanPages;i++){
          checkCancelled();
          try{
            const page=await reader.getPage(i+1);
            const list=await page.getOperatorList();
            if(!list.fnArray.some(x=>visibleOps.has(x))){
              blankCandidates++;
              emit('review','blank-candidate','내용 표시 연산이 확인되지 않았습니다. 실제 빈 페이지인지 확인하세요.',i+1);
            }
            scannedPages++;
            page.cleanup?.();
          }catch(error){
            if(String(error?.message||'').includes('검사가 취소'))throw error;
            renderUnknown=true;
            emit('review','page-inspection-failed','페이지의 내용 표시를 확인하지 못했습니다.',i+1);
          }
          opts?.onProgress?.(i+1,scanPages);
        }
      }catch(error){
        if(String(error?.message||'').includes('검사가 취소'))throw error;
        renderUnknown=true;
        emit('review','render-inspection-unavailable','페이지 내용 검사가 불가능합니다. PDF를 직접 열어 확인하세요.');
      }finally{
        if(reader){try{await reader.destroy()}catch{}}
        else if(task){try{await task.destroy()}catch{}}
      }
    }else{
      renderUnknown=true;
      emit('review','render-inspection-unavailable','화면 내용 검사 엔진을 사용할 수 없어 빈 페이지를 확인하지 못했습니다.');
    }
    if(pages.length>scanPages)
      emit('review','partial-scan','앞쪽 '+scanPages+'쪽만 내용 표시를 검사했습니다. 나머지 '+(pages.length-scanPages)+'쪽은 수동 검토하세요.');
    const errors=issues.filter(x=>x.severity==='error').length;
    const reviews=issues.filter(x=>x.severity==='review').length;
    return {
      bytes:bytes.byteLength,pageCount:pages.length,orientation,fontResources,formFields,emptyRequired,
      scannedPages,blankCandidates,renderUnknown,errors,reviews,issues,
      status:errors?'error':reviews?'review':'checked',
      limitations:'OCR·내용 정확성·글꼴 실제 표시·전자서명 유효성·PDF/A 준수 여부는 검증하지 않습니다.'
    };
  }
  return {inspect};
});
