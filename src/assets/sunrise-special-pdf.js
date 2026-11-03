// Conservative specialist PDF operations: neither source-text editing nor
// visual signing are advertised as certified editing/signing.
// Only raster-exported, masked pixels are transferred into a NEW PDF page.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseSpecialPdf=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const MAX_PIXELS=14_000_000,RENDER_SCALE=2;
 function correctionCandidate(item,viewport){
  if(!item||typeof item.str!=='string'||!item.str.trim()||item.str.length>200||
    item.dir&&item.dir!=='ltr'||!Array.isArray(item.transform)||item.transform.length<6||
    !Number.isFinite(item.width)||item.width<3||item.width>1500) return null;
  const [a,b,c,d,x,y]=item.transform;
  if(![a,b,c,d,x,y].every(Number.isFinite)||Math.abs(b)>0.01||Math.abs(c)>0.01||
    Math.abs(a)<5||Math.abs(d)<5)return null;
  if(!viewport||typeof viewport.convertToViewportPoint!=='function')return null;
  const fontH=Math.abs(d),position=viewport.convertToViewportPoint(x,y);
  const X=position[0]-2,Y=position[1]-fontH-3;
  if(!Number.isFinite(X)||!Number.isFinite(Y)||X<0||Y<0||
    X+item.width+5>viewport.width||Y+fontH+6>viewport.height)return null;
  return {original:item.str,x:Math.round(X),y:Math.round(Y),
   width:Math.round(Math.max(40,item.width+6)),height:Math.round(Math.max(20,fontH+9)),
   fontSize:Math.max(8,Math.min(72,Math.round(fontH)))};
 }
 function validateMaskRect(rect,width,height){
  if(!rect||![width,height].every(v=>Number.isFinite(v)&&v>0&&v<=6000))
    throw Error('페이지 크기를 확인할 수 없습니다.');
  const keys=['x','y','width','height'],v={};
  for(const key of keys){
   v[key]=Number(rect[key]);
   if(!Number.isFinite(v[key]))throw Error('마스킹 좌표는 유효한 숫자여야 합니다.');
  }
  if(v.x<0||v.y<0||v.width<4||v.height<4||
    v.x+v.width>width+0.001||v.y+v.height>height+0.001)
   throw Error('마스킹 사각형은 페이지 안에 있어야 합니다.');
  return v;
 }
 // Pixel rectangles must cover the complete requested floating-point box.
 // Floor the top-left and ceil the far edge independently: floor(left) +
 // ceil(width) can leave an unmasked column at fractional coordinates.
 function paintVerifiedMask(ctx,box,scale=RENDER_SCALE){
  const left=Math.floor(box.x*scale),top=Math.floor(box.y*scale);
  const right=Math.ceil((box.x+box.width)*scale),bottom=Math.ceil((box.y+box.height)*scale);
  const width=right-left,height=bottom-top;
  if(width<1||height<1||typeof ctx?.getImageData!=='function')
   throw Error('마스크 픽셀 검증을 지원하지 않는 렌더러입니다.');
  ctx.fillStyle='#000000';
  ctx.fillRect(left,top,width,height);
  // Verify actual composited pixels at five independent locations before
  // serializing. This catches a no-op/transparent draw or renderer mismatch;
  // it is not a complete semantic redaction certification.
  const samples=[[left,top],[right-1,top],[left,bottom-1],
    [right-1,bottom-1],[left+Math.floor(width/2),top+Math.floor(height/2)]];
  for(const [x,y] of samples){
   let rgba;
   try{rgba=ctx.getImageData(x,y,1,1)?.data;}
   catch{throw Error('마스킹 적용 결과를 픽셀로 확인할 수 없습니다.');}
   if(!rgba||rgba.length<4||rgba[0]>2||rgba[1]>2||rgba[2]>2||rgba[3]<253)
    throw Error('민감정보 마스크가 불투명한 검은색으로 적용되지 않았습니다. PDF 출력을 중단합니다.');
  }
 }
 function checkRasterSize(width,height,scale=RENDER_SCALE){
  if(!Number.isFinite(scale)||scale<1||scale>3||
    !Number.isFinite(width)||!Number.isFinite(height)||
    width<=0||height<=0||Math.ceil(width*scale)*Math.ceil(height*scale)>MAX_PIXELS)
   throw Error('페이지가 안전한 래스터 변환 크기를 초과했습니다.');
 }
 async function exportMaskedPage({reader,pageNumber,rectangle,PDFLib,makeCanvas,cancelled}){
  if(!reader?.getPage||!PDFLib?.PDFDocument?.create||!Number.isSafeInteger(pageNumber)||
    pageNumber<1||pageNumber>reader.numPages)throw Error('PDF 또는 페이지 입력이 올바르지 않습니다.');
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const page=await reader.getPage(pageNumber);
  const view=page.getViewport({scale:1});
  checkRasterSize(view.width,view.height);
  const box=validateMaskRect(rectangle,view.width,view.height);
  const viewport=page.getViewport({scale:RENDER_SCALE});
  const canvas=makeCanvas?makeCanvas():document.createElement('canvas');
  canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
  const ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx||typeof canvas.toBlob!=='function')throw Error('PDF 래스터 렌더러를 사용할 수 없습니다.');
  ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
  const task=page.render({canvasContext:ctx,canvas,viewport});
  await task.promise;
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  // Mutate the raster AFTER the source PDF has rendered. The fresh PDF gets
  // only the masked pixels; not the original content streams or annotations.
  paintVerifiedMask(ctx,box);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const output=await PDFLib.PDFDocument.create();
  const image=await output.embedPng(bytes);
  const pageOut=output.addPage([view.width,view.height]);
  pageOut.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
  const result=await output.save();
  if(!Number.isSafeInteger(result?.byteLength)||result.byteLength===0)
   throw Error('마스킹 PDF 출력 바이트가 올바르지 않습니다.');
  return {bytes:result,pages:1,masked:box,sourcePage:pageNumber};
 }

 // Explicit per-page coordinates only. There is no automatic privacy detection.
 // Format: page,x,y,width,height (top-left of the rendered page at scale 1).
 // When preserving all pages, require a bounded number of raster pages/pixels.
 const MAX_MASK_PAGES=10,MAX_MASK_LINES=40,MAX_MASKS_PER_PAGE=12;
 const MAX_DOCUMENT_PAGES=30, MAX_DOCUMENT_PIXELS=100_000_000;
 function parseMaskPlan(raw,pageSizes){
  if(typeof raw!=='string'||raw.length>5000||!Array.isArray(pageSizes)||!pageSizes.length)
   throw Error('마스킹 페이지 목록이 올바르지 않습니다.');
  const rows=raw.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(!rows.length||rows.length>MAX_MASK_LINES)
   throw Error('마스킹 좌표는 1~40줄까지 입력할 수 있습니다.');
  const groups=new Map();
  rows.forEach((row,index)=>{
   const parts=row.split(',').map(x=>x.trim());
   if(parts.length!==5||parts.some(x=>!x))
    throw Error((index+1)+'행은 페이지,X,Y,너비,높이 다섯 숫자가 필요합니다.');
   if(!/^\d+$/.test(parts[0]))throw Error((index+1)+'행의 페이지 번호가 올바르지 않습니다.');
   const pageNumber=Number(parts[0]);
   if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>pageSizes.length)
    throw Error((index+1)+'행의 페이지 번호가 문서 범위를 벗어났습니다.');
   const {width,height}=pageSizes[pageNumber-1]||{};
   const rectangle=validateMaskRect({x:parts[1],y:parts[2],width:parts[3],height:parts[4]},width,height);
   const list=groups.get(pageNumber)||[];
   if(list.length>=MAX_MASKS_PER_PAGE)throw Error('각 페이지의 마스크는 최대 12개입니다.');
   list.push(rectangle);groups.set(pageNumber,list);
   if(groups.size>MAX_MASK_PAGES)throw Error('한 번에 최대 10개 페이지만 출력할 수 있습니다.');
  });
  return [...groups].sort((a,b)=>a[0]-b[0])
   .map(([pageNumber,rectangles])=>({pageNumber,rectangles}));
 }
 function checkOutputStructure(bytes,PDFLib,expectedPages){
  if(!Number.isSafeInteger(bytes?.byteLength)||bytes.byteLength===0)
   throw Error('마스킹 PDF가 비어 있거나 바이트 크기를 읽을 수 없습니다.');
  if(!PDFLib?.PDFDocument?.load)throw Error('출력 PDF 구조 검증을 수행할 수 없습니다.');
  return PDFLib.PDFDocument.load(bytes).then(document=>{
   if(document.getPageCount()!==expectedPages)throw Error('출력 PDF 페이지 수가 일치하지 않습니다.');
   const name=PDFLib.PDFName.of;
   for(const key of ['AcroForm','Outlines','Names','Perms','Metadata','SunriseWebEdits'])
    if(document.catalog.get(name(key))!==undefined)
     throw Error('출력 PDF에 예상하지 못한 문서 객체가 포함되었습니다: '+key);
   for(const page of document.getPages()){
    const annotations=page.node.Annots();
    if(annotations && annotations.size()>0)
     throw Error('출력 PDF에 주석 객체가 남아 있습니다.');
   }
   return {pageCount:document.getPageCount(),sourceStreamsCopied:false};
  });
 }
 async function exportMaskedPages({reader,plan,PDFLib,makeCanvas,cancelled,onProgress,includeUnmaskedPages=false}){
  if(!reader?.getPage||!PDFLib?.PDFDocument?.create||
    !Number.isSafeInteger(reader.numPages)||reader.numPages<1||
    !Array.isArray(plan)||!plan.length||plan.length>MAX_MASK_PAGES||typeof includeUnmaskedPages!=='boolean')
   throw Error('마스킹 변환의 페이지 목록이 올바르지 않습니다.');
  if(includeUnmaskedPages&&reader.numPages>MAX_DOCUMENT_PAGES)
   throw Error('전체 페이지 보존 출력은 최대 30쪽까지 지원합니다. 원본을 분할하여 처리하세요.');
  // Validate the complete plan before producing any page; missing or duplicated targets are errors.
  const used=new Set(),byPage=new Map();
  for(const item of plan){
   const {pageNumber,rectangles}=item||{};
   if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>reader.numPages||used.has(pageNumber)||
      !Array.isArray(rectangles)||rectangles.length<1||rectangles.length>MAX_MASKS_PER_PAGE)
    throw Error('마스킹할 페이지 및 사각형 목록이 올바르지 않습니다.');
   used.add(pageNumber);byPage.set(pageNumber,rectangles);
  }
  // In document mode the untargeted pages remain visually present, but are
  // rasterized into new image-only streams (source page bytes are never copied).
  const targets=includeUnmaskedPages ?
   Array.from({length:reader.numPages},(_,index)=>({pageNumber:index+1,rectangles:byPage.get(index+1)||[]})) : plan;
  const output=await PDFLib.PDFDocument.create();
  let maskCount=0,usedPixels=0;
  for(let index=0;index<targets.length;index++){
   if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
   const {pageNumber,rectangles}=targets[index];
   const page=await reader.getPage(pageNumber);
   const view=page.getViewport({scale:1});
   checkRasterSize(view.width,view.height);
   usedPixels+=Math.ceil(view.width*RENDER_SCALE)*Math.ceil(view.height*RENDER_SCALE);
   if(usedPixels>MAX_DOCUMENT_PIXELS)
    throw Error('전체 이미지 출력 픽셀 제한을 초과했습니다. 분할하거나 페이지 수를 줄여 주세요.');
   const boxes=rectangles.map(rect=>validateMaskRect(rect,view.width,view.height));
   const viewport=page.getViewport({scale:RENDER_SCALE});
   const canvas=makeCanvas?makeCanvas():document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   const ctx=canvas.getContext('2d',{alpha:false});
   if(!ctx||typeof canvas.toBlob!=='function')throw Error('PDF 래스터 렌더러가 없습니다.');
   try{
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,canvas,viewport}).promise;
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    for(const box of boxes)paintVerifiedMask(ctx,box);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
    const data=new Uint8Array(await blob.arrayBuffer());
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    const image=await output.embedPng(data);
    const pageOut=output.addPage([view.width,view.height]);
    pageOut.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
    maskCount+=boxes.length;
    if(onProgress)onProgress({done:index+1,total:targets.length,maskCount,pageNumber});
   }finally{
    canvas.width=0;canvas.height=0;
   }
  }
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const bytes=await output.save();
  const inspection=await checkOutputStructure(bytes,PDFLib,targets.length);
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  return {bytes,pages:targets.length,maskCount,sourcePages:targets.map(x=>x.pageNumber),
   includeUnmaskedPages,inspection};
 }


 // Narrow *source-stream* text replacement, not a white-box overlay.
 // Only unambiguous, simple 7-bit Type1/Standard-14 text with one Tj operand
 // is supported. Unsupported fonts, mixed operators and ambiguous hits fail
 // closed; this is NOT a confidential-data redaction operation.
 async function replaceSimpleSourceText({bytes,pageNumber,original,replacement,PDFLib}){
  if(!PDFLib?.PDFDocument?.load||!PDFLib?.PDFRawStream||!PDFLib?.PDFRef||
     !Number.isSafeInteger(pageNumber)||pageNumber<1||
     typeof original!=='string'||typeof replacement!=='string'||
     !/^[\x20-\x7e]{1,120}$/.test(original))
   throw Error('원문 직접 수정 입력이 올바르지 않습니다.');
  if(!/^[\x20-\x7e]{1,120}$/.test(replacement)||
     original===replacement||original.length!==replacement.length)
   throw Error('기존 문구와 새 문구는 서로 다른 동일 길이의 영문·숫자·ASCII 문자열이어야 합니다.');
  const {PDFDocument,PDFRawStream,PDFArray,PDFRef,PDFName,PDFNumber}=PDFLib;
  const n=PDFName.of,source=await PDFDocument.load(bytes,{updateMetadata:false});
  if(pageNumber>source.getPageCount())throw Error('원문 수정 페이지 번호가 범위를 벗어났습니다.');
  if(source.catalog.get(n('Perms'))||source.catalog.get(n('AcroForm')))
   throw Error('서명·양식이 포함된 문서는 원문 직접 수정을 지원하지 않습니다.');
  const pages=source.getPages(),page=pages[pageNumber-1],context=source.context;
  const streamRefs=p=>{
   const raw=p.node.get(n('Contents'));
   if(!raw)return [];
   const content=context.lookup(raw);
   if(content instanceof PDFArray)return [...Array(content.size())].map((_,i)=>content.get(i));
   return [raw];
  };
  const refs=streamRefs(page);
  if(!refs.length||refs.length>40||refs.some(ref=>!(ref instanceof PDFRef)))
   throw Error('단순 PDF 텍스트 스트림만 직접 수정할 수 있습니다.');
  const resources=page.node.Resources()||page.node.normalizedEntries?.().Resources;
  const fontResources=resources&&context.lookup(resources.get(n('Font')));
  if(!fontResources?.get)
   throw Error('표준 PDF 글꼴 정보를 확인할 수 없습니다.');
  const bases=new Set(['Helvetica','Helvetica-Bold','Helvetica-Oblique',
   'Helvetica-BoldOblique','Times-Roman','Times-Bold','Times-Italic',
   'Times-BoldItalic','Courier','Courier-Bold','Courier-Oblique',
   'Courier-BoldOblique']);
  const safeFont=name=>{
   const ref=fontResources.get(n(name)),font=ref&&context.lookup(ref);
   if(!font?.get||font.get(n('Subtype'))?.toString()!=='/Type1')return false;
   const base=font.get(n('BaseFont'))?.toString()?.slice(1);
   const encoding=font.get(n('Encoding'));
   return bases.has(base)&&(!encoding||encoding.toString()==='/WinAnsiEncoding')&&
     !font.has(n('ToUnicode'))&&!font.has(n('Differences'))&&!font.has(n('Widths'));
  };
  const decodeBytes=buffer=>{
   let result='';
   for(let i=0;i<buffer.length;i+=8192)
    result+=String.fromCharCode(...buffer.subarray(i,i+8192));
   return result;
  };
  const hexToText=hex=>{
   if(hex.length%2)return null;
   let str='';
   for(let i=0;i<hex.length;i+=2)str+=String.fromCharCode(parseInt(hex.slice(i,i+2),16));
   return str;
  };
  const replacementHex=Array.from(replacement,ch=>ch.charCodeAt(0).toString(16).padStart(2,'0')).join('').toUpperCase();
  const matches=[];
  for(const ref of refs){
   const stream=context.lookup(ref),filter=stream?.dict?.get(n('Filter'));
   if(!(stream instanceof PDFRawStream)||
      filter&&filter.toString()!=='/FlateDecode'||
      stream.dict.has(n('DecodeParms'))||stream.dict.has(n('F')))
    continue;
   const raw=stream.getContents();
   if(raw.length>512*1024)continue;
   let decoded;
   try{decoded=filter?PDFLib.decodePDFRawStream(stream).decode():raw;}
   catch{continue;}
   if(decoded.length>2*1024*1024)continue;
   const script=decodeBytes(decoded),blocks=/\bBT\b([\s\S]*?)\bET\b/g;
   for(const block of script.matchAll(blocks)){
    const body=block[1];
    if(/\bTJ\b/.test(body)||(body.match(/\bTj\b/g)||[]).length!==1)continue;
    const token=/(<([0-9A-Fa-f]+)>|\(([^()\\]*)\))\s+Tj(?=\s|$)/.exec(body);
    if(!token)continue;
    const existing=token[2]!==undefined?hexToText(token[2]):token[3];
    if(existing!==original)continue;
    const fontOps=[...body.slice(0,token.index).matchAll(/\/([A-Za-z0-9._-]+)\s+(?:\d+(?:\.\d+)?)\s+Tf(?=\s|$)/g)];
    if(fontOps.length!==1||!safeFont(fontOps[0][1]))continue;
    const tokenStart=block.index+2+token.index;
    const operand=token[1];
    matches.push({ref,stream,script,decoded,tokenStart,operand});
   }
  }
  if(matches.length!==1)
   throw Error(matches.length?'같은 원문이 여러 곳에 있어 안전한 수정 위치를 확정하지 못했습니다.':
    '원문 직접 수정 대상이 없습니다. 표준 글꼴·단일 ASCII 텍스트 조각만 지원합니다.');
  const match=matches[0],key=match.ref.toString();
  if(pages.some((other,i)=>i!==pageNumber-1&&streamRefs(other).some(x=>x.toString()===key)))
   throw Error('여러 페이지가 공유하는 스트림은 직접 수정하지 않습니다.');
  const head=match.script.slice(0,match.tokenStart),tail=match.script.slice(match.tokenStart+match.operand.length);
  const modified=head+'<'+replacementHex+'>'+tail;
  const data=Uint8Array.from(modified,ch=>ch.charCodeAt(0));
  const dict=match.stream.dict.clone();
  dict.delete(n('Filter'));dict.delete(n('DecodeParms'));
  dict.set(n('Length'),PDFNumber.of(data.length));
  context.assign(match.ref,PDFRawStream.of(dict,data));
  const output=await source.save({updateFieldAppearances:false,useObjectStreams:false});
  const check=await PDFDocument.load(output,{updateMetadata:false});
  if(check.getPageCount()!==pages.length||
     check.getPage(pageNumber-1).getRotation().angle!==page.getRotation().angle)
   throw Error('원문 직접 수정 결과의 페이지 구조 검증에 실패했습니다.');
  return {bytes:output,pageNumber,original,replacement};
 }

 return {correctionCandidate,validateMaskRect,checkRasterSize,exportMaskedPage,parseMaskPlan,checkOutputStructure,exportMaskedPages,replaceSimpleSourceText};
});
