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

 // A bounded, explicit page,x,y,width,height CSV-like plan. Coordinates refer to
 // the DISPLAYED page, measured from its top-left (including source rotation).
 function parseMaskPlan(raw,pageCount){
  if(typeof raw!=='string'||raw.length>8192||!Number.isSafeInteger(pageCount)||
     pageCount<1||pageCount>12)throw Error('전체 문서 마스킹은 최대 12쪽까지 지원합니다.');
  const lines=raw.replace(/\r/g,'').split('\n'),marks=[];
  for(let i=0;i<lines.length;i++){
   const line=lines[i].trim();if(!line)continue;
   const cells=line.split(',').map(s=>s.trim());
   if(cells.length!==5||!cells.every(s=>/^(?:\d+)(?:\.\d+)?$/.test(s)))
    throw Error((i+1)+'행: 쪽번호,X,Y,너비,높이를 숫자로 입력하세요.');
   const [page,x,y,width,height]=cells.map(Number);
   if(!Number.isSafeInteger(page)||page<1||page>pageCount)
    throw Error((i+1)+'행: PDF에 없는 페이지입니다.');
   marks.push({page,rectangle:{x,y,width,height}});
   if(marks.length>120)throw Error('마스킹 영역은 최대 120개까지 지원합니다.');
  }
  if(!marks.length)throw Error('최소 하나의 마스킹 영역을 입력하세요.');
  return marks;
 }
 async function exportMaskedDocument({reader,plan,PDFLib,makeCanvas,cancelled,onProgress}){
  if(!reader?.getPage||!Number.isSafeInteger(reader.numPages)||reader.numPages<1||
    reader.numPages>12||!PDFLib?.PDFDocument?.create)
   throw Error('문서 전체 마스킹은 최대 12쪽까지 지원합니다.');
  if(!Array.isArray(plan)||!plan.length||plan.length>120)
   throw Error('유효한 마스킹 영역 목록이 필요합니다.');
  // Recheck every entry. Do not trust a caller's parsed plan.
  const entries=new Map();
  for(const entry of plan){
   if(!Number.isSafeInteger(entry?.page)||entry.page<1||entry.page>reader.numPages)
    throw Error('존재하지 않는 페이지입니다.');
   const list=entries.get(entry.page)||[];
   list.push(entry.rectangle);entries.set(entry.page,list);
  }
  let totalPixels=0;
  const pageModels=[];
  // All input boundaries must pass before rendering or constructing a file.
  for(let i=1;i<=reader.numPages;i++){
   if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
   const page=await reader.getPage(i),view=page.getViewport({scale:1});
   checkRasterSize(view.width,view.height);
   const rasterPixels=Math.ceil(view.width*RENDER_SCALE)*Math.ceil(view.height*RENDER_SCALE);
   totalPixels+=rasterPixels;
   if(totalPixels>48_000_000)throw Error('문서 전체 래스터 변환이 메모리 안전 한도를 초과했습니다.');
   const boxes=(entries.get(i)||[]).map(rect=>validateMaskRect(rect,view.width,view.height));
   pageModels.push({page,view,boxes});
  }
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const output=await PDFLib.PDFDocument.create();
  let applied=0;
  for(let i=0;i<pageModels.length;i++){
   if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
   const {page,view,boxes}=pageModels[i],viewport=page.getViewport({scale:RENDER_SCALE});
   const canvas=makeCanvas?makeCanvas():document.createElement('canvas');
   try{
    canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});
    if(!ctx||typeof canvas.toBlob!=='function')throw Error('PDF 래스터 렌더러를 사용할 수 없습니다.');
    ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);
    await page.render({canvasContext:ctx,canvas,viewport}).promise;
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    ctx.fillStyle='#000000';
    for(const box of boxes){
     ctx.fillRect(Math.floor(box.x*RENDER_SCALE),Math.floor(box.y*RENDER_SCALE),
       Math.ceil(box.width*RENDER_SCALE),Math.ceil(box.height*RENDER_SCALE));
     applied++;
    }
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob?.size)throw Error('마스킹 이미지 생성에 실패했습니다.');
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
    const image=await output.embedPng(bytes);
    const target=output.addPage([view.width,view.height]);
    target.drawImage(image,{x:0,y:0,width:view.width,height:view.height});
   }finally{
    canvas.width=0;canvas.height=0;
   }
   onProgress?.({completed:i+1,total:pageModels.length,masks:applied});
  }
  if(cancelled?.())throw Error('마스킹 변환이 취소되었습니다.');
  const bytes=await output.save();
  if(!bytes?.byteLength||bytes.byteLength>50*1024*1024)
   throw Error('전체 문서 마스킹 결과가 50 MiB를 초과했습니다.');
  return {bytes,pages:pageModels.length,masked:applied,
   maskedPages:entries.size,pagesWithNoMasks:pageModels.length-entries.size};
 }
 return {correctionCandidate,validateMaskRect,checkRasterSize,exportMaskedPage,parseMaskPlan,exportMaskedDocument};
});
