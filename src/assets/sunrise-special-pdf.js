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
 // Verify every output pixel of each requested rectangle, not just five
 // sample points. Read in bounded tiles to avoid allocating a second full
 // page image. This verifies requested geometry only: missing targets are
 // not detectable without explicit user review or a privacy-recognition model.
 function verifyFullMaskCoverage(ctx,boxes,canvasWidth,canvasHeight,scale=RENDER_SCALE){
  if(!ctx?.getImageData||!Number.isSafeInteger(canvasWidth)||!Number.isSafeInteger(canvasHeight))
   throw Error('마스킹 전체 픽셀 검사에 필요한 렌더러가 없습니다.');
  let checked=0;
  for(const box of boxes){
   const x=Math.floor(box.x*scale),y=Math.floor(box.y*scale);
   const right=Math.ceil((box.x+box.width)*scale);
   const bottom=Math.ceil((box.y+box.height)*scale);
   const width=right-x,height=bottom-y;
   if(x<0||y<0||width<1||height<1||right>canvasWidth||bottom>canvasHeight)
    throw Error('마스킹 픽셀 영역이 실제 출력 캔버스 밖에 있습니다.');
   const tileRows=Math.max(1,Math.floor(512*1024/Math.max(4,width*4)));
   for(let row=y;row<bottom;row+=tileRows){
    const count=Math.min(tileRows,bottom-row);
    let pixels;
    try{pixels=ctx.getImageData(x,row,width,count)?.data;}
    catch{throw Error('마스킹 전체 픽셀을 읽어 확인할 수 없습니다. 출력을 중단합니다.');}
    if(!pixels||pixels.length!==width*count*4)
     throw Error('마스킹 전체 픽셀 검사 결과의 크기가 올바르지 않습니다.');
    for(let offset=0;offset<pixels.length;offset+=4){
     if(pixels[offset]>2||pixels[offset+1]>2||pixels[offset+2]>2||pixels[offset+3]<253)
      throw Error('지정 영역에 검정색으로 가려지지 않은 픽셀이 남아 있어 출력을 중단했습니다.');
    }
    checked+=width*count;
   }
  }
  return checked;
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
  verifyFullMaskCoverage(ctx,[box],canvas.width,canvas.height);
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
  await checkOutputStructure(result,PDFLib,1);
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
 // USR-13 DEV6: advisory detection only. Scanned raster images, fragmented
 // text items and hidden PDF layers can contain other sensitive content.
 // Coordinates from PDF.js are approximate; require an entire *text item*
 // to be inside one mask before it is considered covered (fail-closed).
 function reviewSensitiveTextCandidates({pages,plan}){
  if(!Array.isArray(pages)||!pages.length||pages.length>30||!Array.isArray(plan))
   throw Error('민감정보 텍스트 검토 페이지 목록이 올바르지 않습니다.');
  const masks=new Map(plan.map(p=>[p.pageNumber,p.rectangles]));
  const types=[
   ['주민등록번호 형식',/(?:^|\D)\d{6}[\s-]?\d{7}(?!\d)/],
   ['휴대전화 형식',/(?:^|\D)01[016789][\s-]?\d{3,4}[\s-]?\d{4}(?!\d)/],
   ['이메일 형식',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i],
   ['사업자등록번호 형식',/(?:^|\D)\d{3}-?\d{2}-?\d{5}(?!\d)/],
   ['카드번호 형식(체크섬 확인)',/(?:^|[^\d])(?:\d[ -]?){12,18}\d(?!\d)/]
  ];
  const isValidCardCandidate=text=>{
   const digits=String(text).replace(/[^0-9]/g,'');
   if(digits.length<13||digits.length>19||/^([0-9])\1+$/.test(digits))return false;
   let total=0,twice=false;
   for(let i=digits.length-1;i>=0;i--){
    let n=Number(digits[i]);if(twice){n*=2;if(n>9)n-=9;}
    total+=n;twice=!twice;
   }
   return total%10===0;
  };
  const applicable=(kind,text)=>kind!=='카드번호 형식(체크섬 확인)'||isValidCardCandidate(text);
  const seen=new Set(),affected=new Set(),skipped=[],unmasked=[];
  // Some searchable PDFs split one visible identifier into adjacent text items.
  // Inspect only same-line, left-to-right, geometrically adjacent fragments.
  // This remains advisory: no OCR, no hidden-layer extraction, no source PII logging.
  const fragmentPatterns=types.map(([kind,re])=>[kind,new RegExp(re.source,re.ignoreCase?'gi':'g')]);
  const itemBox=(item,page)=>{
   const t=item?.transform;
   const font=Number.isFinite(item?.height)&&item.height>0?item.height:Math.abs(t?.[3]);
   if(!Array.isArray(t)||t.length<6||
      ![t[0],t[1],t[2],t[3],t[4],t[5],font,item?.width].every(Number.isFinite)||
      Math.abs(t[1])>0.1||Math.abs(t[2])>0.1||font<=0||item.width<=0)return null;
   return {x:t[4]-1,y:page.height-t[5]-font-2,width:item.width+2,height:font+4,
    font,baseline:t[5]};
  };
  const coveredByMask=(pageNumber,box)=>Boolean(box)&&
   (masks.get(pageNumber)||[]).some(rect=>
    box.x>=rect.x&&box.y>=rect.y&&
    box.x+box.width<=rect.x+rect.width&&
    box.y+box.height<=rect.y+rect.height);
  const scanAdjacentFragments=page=>{
   let run=[];
   const flush=()=>{
    if(run.length<2){run=[];return;}
    const chunks=[];let combined='';
    for(const part of run){
     const begin=combined.length;
     combined+=part.text;
     chunks.push({...part,begin,end:combined.length});
    }
    for(const [kind,re] of fragmentPatterns){
     re.lastIndex=0;
     for(const match of combined.matchAll(re)){
      if(!applicable(kind,match[0]))continue;
      const first=match.index,last=first+match[0].length;
      const spans=chunks.filter(x=>x.begin<last&&x.end>first);
      if(spans.length<2)continue; // Already handled in the per-item scan.
      // A boundary character from a preceding item may be included by a regex.
      // Do not count the same identifier again if a single item already matches.
      if(spans.some(part=>new RegExp(re.source,re.ignoreCase?'i':'').test(part.text)))continue;
      const x=Math.min(...spans.map(x=>x.box.x));
      const y=Math.min(...spans.map(x=>x.box.y));
      const right=Math.max(...spans.map(x=>x.box.x+x.box.width));
      const bottom=Math.max(...spans.map(x=>x.box.y+x.box.height));
      const bounds={x,y,width:right-x,height:bottom-y};
      totals.candidates++;totals.fragmentedCandidates++;
      if(coveredByMask(page.pageNumber,bounds))totals.covered++;
      else{
       totals.outside++;totals.fragmentedOutside++;affected.add(page.pageNumber);
       if(unmasked.length<60)unmasked.push({pageNumber:page.pageNumber,kind,fragmented:true});
      }
     }
    }
    run=[];
   };
   for(const item of page.items){
    if(typeof item?.str!=='string'||!item.str){flush();continue;}
    const text=item.str.normalize('NFKC');
    const box=itemBox(item,page);
    if(!box||!text.trim()||text.length>200||item.dir&&item.dir!=='ltr'){
     flush();continue;
    }
    const prev=run[run.length-1];
    if(prev){
     const gap=box.x-(prev.box.x+prev.box.width);
     const tolerance=Math.max(2,Math.min(prev.box.font,box.font)*0.3);
     if(prev.eol||Math.abs(prev.box.baseline-box.baseline)>tolerance||
        gap< -Math.max(2,box.font*0.3)||gap>Math.max(8,box.font*0.7)||
        run.length>=12||run.reduce((n,x)=>n+x.text.length,0)+text.length>700)flush();
    }
    run.push({text,box,eol:Boolean(item.hasEOL)});
    if(item.hasEOL)flush();
   }
   flush();
  };

  const totals={candidates:0,covered:0,outside:0,imageOnlyPages:0,skippedPages:0,fragmentedCandidates:0,fragmentedOutside:0};
  for(const page of pages){
   if(!Number.isSafeInteger(page?.pageNumber)||page.pageNumber<1||seen.has(page.pageNumber))
    throw Error('민감정보 검토 대상 페이지 번호가 중복되거나 잘못되었습니다.');
   seen.add(page.pageNumber);
   if(page.unreadable || (page.rotation||0)%360!==0 ||
      !Number.isFinite(page.width)||!Number.isFinite(page.height)||
      page.width<=0||page.height<=0||!Array.isArray(page.items)||page.items.length>100000||
      page.items.reduce((n,item)=>n+(typeof item?.str==='string'?item.str.length:0),0)>750000){
    skipped.push(page.pageNumber);totals.skippedPages++;continue;
   }
   if(!page.items.some(item=>typeof item?.str==='string'&&item.str.trim()))totals.imageOnlyPages++;
   for(const item of page.items){
    if(typeof item?.str!=='string'||!item.str.trim())continue;
    const text=item.str.normalize('NFKC');
    const matched=types.filter(([kind,re])=>re.test(text) &&
      (kind!=='카드번호 형식(체크섬 확인)' ||
       [...text.matchAll(new RegExp(re.source,'g'))].some(m=>isValidCardCandidate(m[0]))));
    if(!matched.length)continue;
    const isCovered=coveredByMask(page.pageNumber,itemBox(item,page));
    for(const [kind] of matched){
     totals.candidates++;
     if(isCovered)totals.covered++;
     else{
      totals.outside++;affected.add(page.pageNumber);
      if(unmasked.length<60)unmasked.push({pageNumber:page.pageNumber,kind});
     }
    }
   }
   scanAdjacentFragments(page);
  }
  return {...totals,outsidePages:[...affected].sort((a,b)=>a-b),skippedPagesList:skipped,unmasked};
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
    // Fresh raster output must have no font, form, or imported PDF content.
    // Require exactly one page image XObject, not an invisible text overlay.
    const resources=page.node.Resources();
    if(!resources)throw Error('마스킹 출력 페이지 리소스를 확인할 수 없습니다.');
    const fontRef=resources.get(name('Font'));
    if(fontRef&&document.context.lookup(fontRef)?.size?.()>0)
     throw Error('출력 PDF에 텍스트 글꼴 리소스가 남아 있습니다.');
    const xobjects=document.context.lookup(resources.get(name('XObject')));
    if(!(xobjects instanceof PDFLib.PDFDict)||xobjects.keys().length!==1)
     throw Error('출력 PDF 이미지 객체 수가 예상과 다릅니다.');
    for(const imageName of xobjects.keys()){
     const obj=document.context.lookup(xobjects.get(imageName));
     if(obj?.dict?.get(name('Subtype'))?.toString()!=='/Image')
      throw Error('출력 PDF에 이미지 외 그래픽 객체가 포함되었습니다.');
    }
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
    // Fail closed if any pixel in a user-specified mask is not fully covered.
    verifyFullMaskCoverage(ctx,boxes,canvas.width,canvas.height);
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

 // Independently reopen the serialized file with PDF.js. No source text,
 // annotations, attachment or outline is allowed in this image-only export.
 // Verify mask pixels after PDF decoding, not only on the input canvas.
 async function auditMaskedOutput({bytes,pdfjsLib,plan,sourcePages,cancelled,makeCanvas}){
  if(!pdfjsLib?.getDocument||!Array.isArray(sourcePages)||!sourcePages.length||sourcePages.length>30)
   throw Error('마스킹 출력 재검사 엔진 또는 페이지 정보가 없습니다.');
  const check=()=>{if(cancelled?.())throw new DOMException('마스킹 재검사 취소','AbortError');};
  const task=pdfjsLib.getDocument({data:bytes.slice(),isEvalSupported:false}),byPage=new Map(plan.map(item=>[item.pageNumber,item.rectangles]));
  let reader=null,render=null,checkedPixels=0;
  try{
   reader=await task.promise;check();
   if(reader.numPages!==sourcePages.length||Object.keys(await reader.getAttachments()||{}).length||(await reader.getOutline())?.length)throw Error('마스킹 출력에 예상하지 않은 문서 구조가 있습니다.');
   for(let i=0;i<sourcePages.length;i++){
    check();const page=await reader.getPage(i+1),text=await page.getTextContent(),annots=await page.getAnnotations();
    if(text.items.some(item=>item.str?.length)||annots.length)throw Error('마스킹 결과에 원문 텍스트 또는 주석이 남아 있습니다.');
    const boxes=byPage.get(sourcePages[i])||[];if(!boxes.length)continue;
    const viewport=page.getViewport({scale:RENDER_SCALE}),canvas=makeCanvas?makeCanvas():document.createElement('canvas');
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    try{
     checkRasterSize(viewport.width/RENDER_SCALE,viewport.height/RENDER_SCALE);
     const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw Error('마스킹 재검사 캔버스가 없습니다.');
     render=page.render({canvasContext:ctx,canvas,viewport});await render.promise;render=null;check();
     // PDF interpolation can affect the outermost edge. All requested area
     // was expanded to whole pixels before encoding; verify the full box.
     checkedPixels+=verifyFullMaskCoverage(ctx,boxes,canvas.width,canvas.height);
    }finally{canvas.width=0;canvas.height=0;}
   }
   check();return {pages:reader.numPages,checkedPixels,textItems:0,annotations:0,attachments:0};
  }finally{render?.cancel();if(reader)await reader.destroy();else await task.destroy();}
 }


 // WinAnsi supplements the original ASCII-only Type1 editing subset.
 // This is a single-byte PDF character encoding, NOT arbitrary Unicode or CID.
 // Do not accept custom Differences / ToUnicode maps or embedded fonts.
 const WINANSI_EXTRAS=new Map([
  [0x20AC,0x80],[0x201A,0x82],[0x0192,0x83],[0x201E,0x84],
  [0x2026,0x85],[0x2020,0x86],[0x2021,0x87],[0x02C6,0x88],
  [0x2030,0x89],[0x0160,0x8A],[0x2039,0x8B],[0x0152,0x8C],
  [0x017D,0x8E],[0x2018,0x91],[0x2019,0x92],[0x201C,0x93],
  [0x201D,0x94],[0x2022,0x95],[0x2013,0x96],[0x2014,0x97],
  [0x02DC,0x98],[0x2122,0x99],[0x0161,0x9A],[0x203A,0x9B],
  [0x0153,0x9C],[0x017E,0x9E],[0x0178,0x9F]
 ]);
 const WINANSI_REVERSE=new Map([...WINANSI_EXTRAS].map(([code,byte])=>[byte,code]));
 function sourceTextBytes(text){
  if(typeof text!=='string'||!text||text.length>120)return null;
  const result=[];
  for(const symbol of text){
   const code=symbol.codePointAt(0);
   const byte=code>=0x20&&code<=0x7e?code:
    code>=0xa0&&code<=0xff?code:WINANSI_EXTRAS.get(code);
   if(byte===undefined)return null;
   result.push(byte);
  }
  return result.length>0&&result.length<=120?Uint8Array.from(result):null;
 }
 function isSourceTextCandidate(text){return !!sourceTextBytes(text)}
 function decodeSourceTextBytes(data){
  let text='';
  for(const byte of data){
   const code=byte>=0x20&&byte<=0x7e?byte:
    byte>=0xa0&&byte<=0xff?byte:WINANSI_REVERSE.get(byte);
   if(code===undefined)return null;
   text+=String.fromCodePoint(code);
  }
  return text;
 }
 // Parse the two safe kinds of Tj string operands: hex or a non-nested PDF
 // literal string (including escaped parentheses/backslashes/octal bytes).
 // Unsupported escape types fail closed; no fuzzy text matching.
 function parseSourceTjOperand(raw){
  if(typeof raw!=='string'||raw.length<2)return null;
  if(raw[0]==='<'){
   if(raw[raw.length-1]!=='>'||(raw.length-2)%2)return null;
   const hex=raw.slice(1,-1);
   if(!/^[0-9A-Fa-f]*$/.test(hex))return null;
   return Uint8Array.from(hex.match(/../g)||[],v=>parseInt(v,16));
  }
  if(raw[0]!=='('||raw[raw.length-1]!==')')return null;
  const bytes=[];
  for(let i=1;i<raw.length-1;i++){
   const code=raw.charCodeAt(i);
   if(code!==92){
    if(code>255||code===40||code===41)return null;
    bytes.push(code);continue;
   }
   i++;if(i>=raw.length-1)return null;
   const esc=raw[i];
   if(esc==='('||esc===')'||esc==='\\'){
    bytes.push(esc.charCodeAt(0));continue;
   }
   if(/[0-7]/.test(esc)){
    let digits=esc;
    while(digits.length<3&&i+1<raw.length-1&&/[0-7]/.test(raw[i+1]))digits+=raw[++i];
    const value=parseInt(digits,8);
    if(value>255)return null;
    bytes.push(value);continue;
   }
   // Literal PDF line continuation is permitted by the PDF specification.
   if(esc==='\r'){if(raw[i+1]==='\n')i++;continue;}
   if(esc==='\n')continue;
   const special={n:10,r:13,t:9,b:8,f:12};
   if(Object.prototype.hasOwnProperty.call(special,esc)){
    bytes.push(special[esc]);continue;
   }
   return null;
  }
  return Uint8Array.from(bytes);
 }

 // The TJ operator can segment one logical word into several byte strings and
 // positioning numbers. Preserve those numeric adjustments and each original
 // string's byte length. Never interpret a general PDF content grammar here:
 // only a flat bracket array of literal/hex strings and finite numbers.
 function parseSourceTjArray(raw){
  if(typeof raw!=='string'||raw[0]!=='['||raw[raw.length-1]!==']'||raw.length>1200)return null;
  const inner=raw.slice(1,-1),lex=/(<([0-9A-Fa-f]*)>|\((?:\\(?:[0-7]{1,3}|[\s\S])|[^()\\])*\)|[+-]?(?:\d+(?:\.\d*)?|\.\d+))/g;
  const tokens=[];let cursor=0,strings=0,original=[];
  for(const match of inner.matchAll(lex)){
   if(inner.slice(cursor,match.index).trim())return null;
   const token=match[0];
   if(token[0]==='<'||token[0]==='('){
    const bytes=parseSourceTjOperand(token);
    if(!bytes?.length)return null;
    strings++;if(strings>12||original.length+bytes.length>120)return null;
    original.push(...bytes);tokens.push({bytes});
   }else{
    if(!Number.isFinite(Number(token))||Math.abs(Number(token))>1_000_000)return null;
    tokens.push({number:token});
   }
   cursor=match.index+token.length;
  }
  if(inner.slice(cursor).trim()||strings<2)return null;
  return {tokens,original:Uint8Array.from(original)};
 }
 // Narrow *source-stream* text replacement, not a white-box overlay.
 // Only unambiguous, single-byte Type1/Standard-14 text with one Tj
 // operand or a limited TJ array is supported. Unsupported fonts, mixed operators and ambiguous hits fail
 // closed; this is NOT a confidential-data redaction operation.
 async function replaceSimpleSourceText({bytes,pageNumber,original,replacement,PDFLib}){
  const originalBytes=sourceTextBytes(original),replacementBytes=sourceTextBytes(replacement);
  if(!PDFLib?.PDFDocument?.load||!PDFLib?.PDFRawStream||!PDFLib?.PDFRef||
     !Number.isSafeInteger(pageNumber)||pageNumber<1||!originalBytes||!replacementBytes)
   throw Error('원문 직접 수정 입력이 올바르지 않습니다. 표준 Type1 WinAnsi 문자만 허용합니다.');
  if(original===replacement||originalBytes.length!==replacementBytes.length)
   throw Error('원문과 수정문은 서로 다른 동일 바이트 길이의 WinAnsi 문자열이어야 합니다.');
  const needsWinAnsi=[...originalBytes,...replacementBytes].some(byte=>byte>0x7e);
  const {PDFDocument,PDFRawStream,PDFArray,PDFRef,PDFName,PDFNumber}=PDFLib;
  const n=PDFName.of,source=await PDFDocument.load(bytes,{updateMetadata:false});
  if(pageNumber>source.getPageCount())throw Error('원문 수정 페이지 번호가 범위를 벗어났습니다.');
  if(source.catalog.get(n('Perms'))||source.catalog.get(n('AcroForm')))
   throw Error('서명·양식이 포함된 문서는 원문 직접 수정을 지원하지 않습니다.');
  // A signature dictionary may exist even if the catalog has no /Perms.
  // Fail closed rather than silently invalidating an existing signature.
  for(const [,object] of source.context.enumerateIndirectObjects()){
   if(object?.get?.(n('ByteRange'))||object?.get?.(n('Type'))?.toString()==='/Sig')
    throw Error('전자서명 관련 객체가 있는 PDF는 원문을 수정하지 않습니다.');
  }
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
   const enc=encoding?.toString();
   return bases.has(base)&&(!needsWinAnsi?(!enc||enc==='/WinAnsiEncoding'):
     enc==='/WinAnsiEncoding')&&
     !font.has(n('ToUnicode'))&&!font.has(n('Differences'))&&!font.has(n('Widths'));
  };
  const decodeBytes=buffer=>{
   let result='';
   for(let i=0;i<buffer.length;i+=8192)
    result+=String.fromCharCode(...buffer.subarray(i,i+8192));
   return result;
  };
  const replacementHex=Array.from(replacementBytes,byte=>byte.toString(16).padStart(2,'0')).join('').toUpperCase();
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
    const tjCount=(body.match(/\bTj\b/g)||[]).length;
    const arrayCount=(body.match(/\bTJ\b/g)||[]).length;
    if(tjCount+arrayCount!==1)continue;
    let token,rawBytes,operand,replacementOperand;
    if(arrayCount){
     token=/\[[^\[\]]*\]\s+TJ(?=\s|$)/.exec(body);
     if(!token)continue;
     operand=token[0].slice(0,token[0].lastIndexOf(']')+1);
     const parsed=parseSourceTjArray(operand);
     if(!parsed)continue;
     rawBytes=parsed.original;
     if(decodeSourceTextBytes(rawBytes)!==original||rawBytes.length!==originalBytes.length)continue;
     let offset=0;
     replacementOperand='['+parsed.tokens.map(part=>{
      if(part.number!==undefined)return part.number;
      const section=replacementBytes.subarray(offset,offset+part.bytes.length);
      offset+=part.bytes.length;
      return '<'+Array.from(section,b=>b.toString(16).padStart(2,'0')).join('').toUpperCase()+'>';
     }).join(' ')+']';
    }else{
     token=/(<([0-9A-Fa-f]+)>|\((?:\\(?:[0-7]{1,3}|[\s\S])|[^()\\])*\))\s+Tj(?=\s|$)/.exec(body);
     if(!token)continue;
     operand=token[1];
     rawBytes=parseSourceTjOperand(operand);
     if(!rawBytes||decodeSourceTextBytes(rawBytes)!==original||rawBytes.length!==originalBytes.length)continue;
     replacementOperand='<'+replacementHex+'>';
    }
    const fontOps=[...body.slice(0,token.index).matchAll(/\/([A-Za-z0-9._-]+)\s+(?:\d+(?:\.\d+)?)\s+Tf(?=\s|$)/g)];
    if(fontOps.length!==1||!safeFont(fontOps[0][1]))continue;
    const tokenStart=block.index+2+token.index;
    matches.push({ref,stream,script,decoded,tokenStart,operand,replacementOperand});
   }
  }
  if(matches.length!==1)
   throw Error(matches.length?'같은 원문이 여러 곳에 있어 안전한 수정 위치를 확정하지 못했습니다.':
    '원문 직접 수정 대상이 없습니다. 표준 글꼴·단일 Tj 또는 제한적인 분절 TJ 텍스트만 지원합니다.');
  const match=matches[0],key=match.ref.toString();
  if(pages.some((other,i)=>i!==pageNumber-1&&streamRefs(other).some(x=>x.toString()===key)))
   throw Error('여러 페이지가 공유하는 스트림은 직접 수정하지 않습니다.');
  const head=match.script.slice(0,match.tokenStart),tail=match.script.slice(match.tokenStart+match.operand.length);
  const modified=head+match.replacementOperand+tail;
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

 // R27–R29: Atomic document-level batching for deliberately narrow
 // Type1/WinAnsi Tj or segmented TJ source editing. No external I/O occurs.
 const MAX_SOURCE_BATCH_EDITS=8;
 function normalizeSourceTextBatch(edits,totalPages){
  if(!Array.isArray(edits)||edits.length<1||edits.length>MAX_SOURCE_BATCH_EDITS)
   throw Error('원문 일괄 수정은 1~8개 항목만 처리할 수 있습니다.');
  if(totalPages!==undefined&&(!Number.isSafeInteger(totalPages)||totalPages<1))
   throw Error('PDF 전체 페이지 수가 유효하지 않습니다.');
  const normalized=[],tokensByPage=new Map();
  for(let i=0;i<edits.length;i++){
   const edit=edits[i]||{},pageNumber=edit.pageNumber;
   const original=edit.original,replacement=edit.replacement;
   if(!Number.isSafeInteger(pageNumber)||pageNumber<1||
      (totalPages!==undefined&&pageNumber>totalPages))
    throw Error((i+1)+'번째 원문 수정 항목의 페이지 번호가 범위를 벗어났습니다.');
   const a=sourceTextBytes(original),b=sourceTextBytes(replacement);
   if(!a||!b||original===replacement||a.length!==b.length)
    throw Error((i+1)+'번째 수정은 서로 다른 동일 바이트 길이의 WinAnsi 문자열만 허용합니다.');
   let tokens=tokensByPage.get(pageNumber);
   if(!tokens){tokens=new Set();tokensByPage.set(pageNumber,tokens)}
   // Forbid cycles and source/target collisions on a page; otherwise one edit
   // can silently change the intended target of a later edit.
   if(tokens.has(original)||tokens.has(replacement))
    throw Error((i+1)+'번째 항목의 기존/새 문구가 같은 페이지의 다른 항목과 중복·충돌합니다.');
   tokens.add(original);tokens.add(replacement);
   normalized.push({pageNumber,original,replacement});
  }
  return normalized;
 }
 function parseSourceTextBatch(raw,totalPages){
  if(typeof raw!=='string'||raw.length>5000)
   throw Error('일괄 수정 목록은 5,000자 이내로 입력해 주세요.');
  const lines=raw.replace(/\r\n?/g,'\n').split('\n').filter(row=>row.trim());
  const edits=lines.map((row,i)=>{
   const fields=row.split('\t');
   if(fields.length!==3||!/^[1-9]\d*$/.test(fields[0].trim()))
    throw Error((i+1)+'번째 줄: 페이지번호, 기존 문구, 새 문구를 탭으로 구분해 주세요.');
   return {pageNumber:Number(fields[0].trim()),original:fields[1],replacement:fields[2]};
  });
  return normalizeSourceTextBatch(edits,totalPages);
 }
 // Export the canonical, validated tab-separated plan. No server storage.
 function serializeSourceTextBatch(edits,totalPages){
  const plan=normalizeSourceTextBatch(edits,totalPages);
  return plan.map(edit=>edit.pageNumber+'\t'+edit.original+'\t'+edit.replacement).join('\n')+'\n';
 }
 async function replaceSimpleSourceTextBatch({bytes,edits,PDFLib,cancelled,onProgress}){
  const plan=normalizeSourceTextBatch(edits);
  if(!(bytes instanceof Uint8Array)||bytes.byteLength<1||bytes.byteLength>20*1024*1024)
   throw Error('일괄 수정할 PDF는 20 MiB 이하의 유효한 바이트 배열이어야 합니다.');
  if(!PDFLib?.PDFDocument?.load||typeof replaceSimpleSourceText!=='function')
   throw Error('PDF 원문 수정 엔진을 사용할 수 없습니다.');
  if(cancelled!==undefined&&typeof cancelled!=='function')
   throw Error('취소 확인 함수가 올바르지 않습니다.');
  if(onProgress!==undefined&&typeof onProgress!=='function')
   throw Error('진행상태 처리 함수가 올바르지 않습니다.');
  let working=bytes;
  // No user-visible mutation until ALL edits and the caller's final PDF.js
  // reopening checks have succeeded. A partial result is never returned.
  for(let index=0;index<plan.length;index++){
   const edit=plan[index];
   if(cancelled?.())throw Error('원문 일괄 수정이 취소되었습니다.');
   const output=await replaceSimpleSourceText({
    bytes:working,pageNumber:edit.pageNumber,
    original:edit.original,replacement:edit.replacement,PDFLib
   });
   if(!output?.bytes?.byteLength)throw Error('원문 일괄 수정 결과가 비어 있습니다.');
   // Reject oversized intermediate PDFs before beginning another edit.
   if(output.bytes.byteLength>40*1024*1024)
    throw Error('중간 PDF가 40 MiB를 초과했습니다. 파일을 나누어 수정하세요.');
   working=output.bytes;
   if(cancelled?.())throw Error('원문 일괄 수정이 취소되었습니다.');
   onProgress?.({done:index+1,total:plan.length,pageNumber:edit.pageNumber});
  }
  if(cancelled?.())throw Error('원문 일괄 수정이 취소되었습니다.');
  return {bytes:working,editCount:plan.length,affectedPages:[...new Set(plan.map(x=>x.pageNumber))]};
 }

 return {correctionCandidate,validateMaskRect,checkRasterSize,verifyFullMaskCoverage,exportMaskedPage,parseMaskPlan,checkOutputStructure,exportMaskedPages,auditMaskedOutput,reviewSensitiveTextCandidates,isSourceTextCandidate,replaceSimpleSourceText,normalizeSourceTextBatch,parseSourceTextBatch,serializeSourceTextBatch,replaceSimpleSourceTextBatch};
});
