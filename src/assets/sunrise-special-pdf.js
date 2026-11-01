// Conservative specialist PDF operations: neither source-text editing nor
// visual signing are advertised as certified editing/signing.
// Only raster-exported, masked pixels are transferred into a NEW PDF page.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseSpecialPdf=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const MAX_PIXELS=14_000_000,MAX_TOTAL_PIXELS=48_000_000,MAX_MASK_PAGES=12,MAX_RECTS=36,RENDER_SCALE=2;
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
   if(typeof rect[key]!=='number'&&
      (typeof rect[key]!=='string'||!rect[key].trim()))throw Error('마스킹 좌표가 비어 있습니다.');
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
 // Input text: one rectangle per line, "page,x,y,width,height".
 // Only the pages explicitly listed are included in the output PDF.
 function parseMaskPlan(raw,pageCount,pageSizes){
  if(typeof raw!=='string'||raw.length>2800||!Number.isSafeInteger(pageCount)||pageCount<1||
    !Array.isArray(pageSizes)||pageSizes.length<pageCount)
   throw Error('페이지 번호와 마스킹 입력 형식을 확인하세요.');
  const lines=raw.trim().split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length||lines.length>MAX_RECTS)throw Error('마스크는 1~36개 범위로 입력하세요.');
  const byPage=new Map();
  for(const [i,line] of lines.entries()){
   const cells=line.split(',').map(x=>x.trim());
   if(cells.length!==5||cells.some(x=>!x||!/^\d+(?:\.\d+)?$/.test(x)))
    throw Error((i+1)+'행은 페이지,X,Y,너비,높이의 양수 숫자 5개여야 합니다.');
   const number=Number(cells[0]);
   if(!Number.isSafeInteger(number)||number<1||number>pageCount)
    throw Error((i+1)+'행 페이지 번호가 문서 범위를 벗어났습니다.');
   const size=pageSizes[number-1];
   if(!size)throw Error('마스킹 대상 페이지 크기를 읽지 못했습니다.');
   const rect=validateMaskRect({x:cells[1],y:cells[2],width:cells[3],height:cells[4]},size.width,size.height);
   if(!byPage.has(number))byPage.set(number,[]);
   byPage.get(number).push(rect);
   if(byPage.size>MAX_MASK_PAGES)throw Error('한 번에 최대 12페이지만 출력할 수 있습니다.');
  }
  return [...byPage.entries()].sort((a,b)=>a[0]-b[0]).map(([pageNumber,rectangles])=>({
   pageNumber,rectangles
  }));
 }
 function validatedRegions(regions,reader){
  if(!Array.isArray(regions)||!regions.length||regions.length>MAX_MASK_PAGES)
   throw Error('마스킹 페이지는 1~12개여야 합니다.');
  const seen=new Set();let total=0;
  return regions.map(entry=>{
   const pageNumber=entry?.pageNumber,rectangles=entry?.rectangles;
   if(!Number.isSafeInteger(pageNumber)||pageNumber<1||pageNumber>reader.numPages||
      seen.has(pageNumber)||!Array.isArray(rectangles)||!rectangles.length)
    throw Error('마스킹 페이지가 중복되었거나 영역이 없습니다.');
   seen.add(pageNumber);total+=rectangles.length;
   if(total>MAX_RECTS)throw Error('마스킹 영역은 최대 36개입니다.');
   return {pageNumber,rectangles};
  }).sort((a,b)=>a.pageNumber-b.pageNumber);
 }
 async function exportMaskedPages({reader,regions,PDFLib,makeCanvas,cancelled,onProgress}){
  if(!reader?.getPage||!PDFLib?.PDFDocument?.create||!Number.isSafeInteger(reader.numPages))
   throw Error('PDF 입력이 올바르지 않습니다.');
  const plan=validatedRegions(regions,reader);
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const output=await PDFLib.PDFDocument.create();let totalPixels=0,masked=0;
  for(const [i,entry] of plan.entries()){
   if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
   const page=await reader.getPage(entry.pageNumber),view=page.getViewport({scale:1});
   checkRasterSize(view.width,view.height);
   const pixelCount=Math.ceil(view.width*RENDER_SCALE)*Math.ceil(view.height*RENDER_SCALE);
   totalPixels+=pixelCount;
   if(totalPixels>MAX_TOTAL_PIXELS)throw Error('마스킹 문서의 누적 이미지 크기가 안전 한도를 초과했습니다.');
   const rectangles=entry.rectangles.map(rect=>validateMaskRect(rect,view.width,view.height));
   const viewport=page.getViewport({scale:RENDER_SCALE});
   const canvas=makeCanvas?makeCanvas():document.createElement('canvas');
   canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
   try{
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx||typeof canvas.toBlob!=='function')throw Error('PDF 래스터 렌더러를 사용할 수 없습니다.');
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
    const task=page.render({canvasContext:ctx,canvas,viewport});
    await task.promise;
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    // Apply all masks AFTER rendering. Nothing from the source PDF document
    // is copied into the new PDF except rendered, masked raster pixels.
    ctx.fillStyle='#000000';
    for(const box of rectangles){
     ctx.fillRect(Math.floor(box.x*RENDER_SCALE),Math.floor(box.y*RENDER_SCALE),
      Math.ceil(box.width*RENDER_SCALE),Math.ceil(box.height*RENDER_SCALE));
     masked++;
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    const image=await output.embedPng(bytes);
    const pageOut=output.addPage([view.width,view.height]);
    pageOut.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
    onProgress?.({page:i+1,total:plan.length,sourcePage:entry.pageNumber});
   }finally{
    // Release temporary raster memory before rendering the next page.
    canvas.width=0;canvas.height=0;
   }
  }
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const result=await output.save();
  if(!result?.byteLength||result.byteLength>50*1024*1024)
   throw Error('마스킹 결과가 50 MiB를 초과했습니다.');
  return {bytes:result,pages:plan.length,masked,sourcePages:plan.map(x=>x.pageNumber)};
 }
 async function exportMaskedPage({reader,pageNumber,rectangle,PDFLib,makeCanvas,cancelled}){
  const result=await exportMaskedPages({
   reader,regions:[{pageNumber,rectangles:[rectangle]}],PDFLib,makeCanvas,cancelled
  });
  return {...result,masked:rectangle,sourcePage:pageNumber};
 }
 return {correctionCandidate,validateMaskRect,checkRasterSize,parseMaskPlan,exportMaskedPages,exportMaskedPage};
});
