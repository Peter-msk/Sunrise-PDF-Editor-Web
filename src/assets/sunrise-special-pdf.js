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
 return {correctionCandidate,validateMaskRect,checkRasterSize,exportMaskedPage};
});
