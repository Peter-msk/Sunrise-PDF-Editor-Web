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
  ctx.fillStyle='#000000';
  ctx.fillRect(Math.floor(box.x*RENDER_SCALE),Math.floor(box.y*RENDER_SCALE),
   Math.ceil(box.width*RENDER_SCALE),Math.ceil(box.height*RENDER_SCALE));
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
  if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const output=await PDFLib.PDFDocument.create();
  const image=await output.embedPng(bytes);
  const pageOut=output.addPage([view.width,view.height]);
  pageOut.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
  const result=await output.save();
  if(!result?.byteLength||result.byteLength>50*1024*1024)
   throw Error('마스킹 결과가 50 MiB를 초과했습니다.');
  return {bytes:result,pages:1,masked:box,sourcePage:pageNumber};
 }

 // Explicit per-page coordinates only. There is no automatic privacy detection.
 // Format: page,x,y,width,height (top-left of the rendered page at scale 1).
 const MAX_MASK_PAGES=10,MAX_MASK_LINES=40,MAX_MASKS_PER_PAGE=12;
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
  if(!bytes?.byteLength||bytes.byteLength>50*1024*1024)
   throw Error('마스킹 PDF가 50 MiB를 초과하거나 비어 있습니다.');
  if(!PDFLib?.PDFDocument?.load)throw Error('출력 PDF 구조 검증을 수행할 수 없습니다.');
  return PDFLib.PDFDocument.load(bytes).then(document=>{
   if(document.getPageCount()!==expectedPages)throw Error('출력 PDF 페이지 수가 일치하지 않습니다.');
   const name=PDFLib.PDFName.of;
   for(const key of ['AcroForm','Outlines','Names','Perms','Metadata','SunriseWebEdits'])
    if(document.catalog.get(name(key))!==undefined)
     throw Error('출력 PDF에 예상하지 못한 문서 객체가 포함되었습니다: '+key);
   for(const page of document.getPages())
    if(page.node.get(name('Annots'))!==undefined)
     throw Error('출력 PDF에 주석 객체가 남아 있습니다.');
   return {pageCount:document.getPageCount(),sourceStreamsCopied:false};
  });
 }
 async function exportMaskedPages({reader,plan,PDFLib,makeCanvas,cancelled,onProgress}){
  if(!reader?.getPage||!PDFLib?.PDFDocument?.create||
    !Array.isArray(plan)||!plan.length||plan.length>MAX_MASK_PAGES)
   throw Error('마스킹 변환의 페이지 목록이 올바르지 않습니다.');
  const used=new Set(),output=await PDFLib.PDFDocument.create();
  let maskCount=0;
  for(let index=0;index<plan.length;index++){
   if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
   const {pageNumber,rectangles}=plan[index]||{};
   if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>reader.numPages||used.has(pageNumber)||
      !Array.isArray(rectangles)||rectangles.length<1||rectangles.length>MAX_MASKS_PER_PAGE)
    throw Error('마스킹할 페이지 및 사각형 목록이 올바르지 않습니다.');
   used.add(pageNumber);
   const page=await reader.getPage(pageNumber);
   const view=page.getViewport({scale:1});
   checkRasterSize(view.width,view.height);
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
    ctx.fillStyle='#000000';
    for(const box of boxes){
     ctx.fillRect(Math.floor(box.x*RENDER_SCALE),Math.floor(box.y*RENDER_SCALE),
       Math.ceil(box.width*RENDER_SCALE),Math.ceil(box.height*RENDER_SCALE));
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
    const data=new Uint8Array(await blob.arrayBuffer());
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    const image=await output.embedPng(data);
    const pageOut=output.addPage([view.width,view.height]);
    pageOut.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
    maskCount+=boxes.length;
    if(onProgress)onProgress({done:index+1,total:plan.length,maskCount});
   }finally{
    canvas.width=0;canvas.height=0;
   }
  }
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const bytes=await output.save();
  const inspection=await checkOutputStructure(bytes,PDFLib,plan.length);
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  return {bytes,pages:plan.length,maskCount,sourcePages:plan.map(x=>x.pageNumber),inspection};
 }

 return {correctionCandidate,validateMaskRect,checkRasterSize,exportMaskedPage,parseMaskPlan,checkOutputStructure,exportMaskedPages};
});
