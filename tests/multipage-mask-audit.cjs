'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const special=require('../src/assets/sunrise-special-pdf.js');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nAXBAQEAAACAEP9PF0JQGR7vBPykAXTzAAAAAElFTkSuQmCC','base64');
const dims=[{width:400,height:600},{width:350,height:500},{width:400,height:600}];
const plan=special.parseMaskPlan('2,105,100,100,40\n1,70,100,180,40\n1,70,160,150,55',dims);
assert.deepEqual(plan.map(x=>x.pageNumber),[1,2]);
assert.deepEqual(plan.map(x=>x.rectangles.length),[2,1]);
for(const bad of [
 '', '1,1,2,3','0,1,2,100,100','4,1,2,100,100','1,,2,100,100',
 '1,399,1,100,100','1,0,0,3,10','NaN,1,1,10,10','1,0,0,100,0',
 Array.from({length:41},()=> '1,0,0,100,100').join('\n'),
 Array.from({length:13},()=> '1,0,0,100,100').join('\n')
]){
 assert.throws(()=>special.parseMaskPlan(bad,dims),/마스킹|페이지|입력|행|영역/);
}
const renders=[],marks=[];
const makeCanvas=()=>{
 const entry={page:null};
 const ctx={
  fillStyle:'',
  fillRect(x,y,w,h){marks.push({page:entry.page,fill:this.fillStyle,x,y,w,h})},
  getImageData(x,y,width=1,height=1){
   const data=new Uint8ClampedArray(width*height*4);
   for(let row=0;row<height;row++)for(let col=0;col<width;col++){
    const px=x+col,py=y+row,offset=(row*width+col)*4;
    const covered=marks.some(m=>m.page===entry.page&&m.fill==='#000000'&&
     px>=m.x&&py>=m.y&&px<m.x+m.w&&py<m.y+m.h);
    data[offset]=covered?0:255;data[offset+1]=covered?0:255;
    data[offset+2]=covered?0:255;data[offset+3]=255;
   }
   return {data};
  }
 };
 return {get width(){return entry.width||0},set width(v){entry.width=v},
 get height(){return entry.height||0},set height(v){entry.height=v},
 getContext:()=>ctx,
 toBlob:done=>done({size:png.length,arrayBuffer:async()=>Uint8Array.from(png).buffer}),
 set _page(n){entry.page=n},get _page(){return entry.page}};
};
const reader={numPages:3,getPage:async n=>{
 const d=dims[n-1];
 return {getViewport:({scale})=>({width:d.width*scale,height:d.height*scale}),
 render:({canvas,viewport})=>{canvas._page=n;renders.push({n,w:viewport.width,h:viewport.height});return {promise:Promise.resolve()}}};
}};
(async()=>{
 const progress=[];
 const output=await special.exportMaskedPages({reader,plan,PDFLib,makeCanvas,
  cancelled:()=>false,onProgress:value=>progress.push(value)});
 assert.equal(output.pages,2);
 assert.equal(output.maskCount,3);
 assert.deepEqual(output.sourcePages,[1,2]);
 assert.deepEqual(progress.map(x=>x.done),[1,2]);
 assert.equal(renders.length,2);
 assert.equal(marks.filter(x=>x.fill==='#000000').length,3);
 assert(marks.some(x=>x.fill==='#000000'&&x.page===1&&x.x===140&&x.y===320));
 assert(marks.some(x=>x.fill==='#000000'&&x.page===2&&x.x===210&&x.y===200));
 const pdf=await PDFLib.PDFDocument.load(output.bytes);
 assert.equal(pdf.getPageCount(),2);
 assert.equal(pdf.getPage(0).getWidth(),400);
 assert.equal(pdf.getPage(1).getWidth(),350);
 assert.deepEqual(await special.checkOutputStructure(output.bytes,PDFLib,2),{pageCount:2,sourceStreamsCopied:false});
 for(const key of ['AcroForm','Outlines','Names','Perms','Metadata','SunriseWebEdits'])
  assert.equal(pdf.catalog.get(PDFLib.PDFName.of(key)),undefined);
 // Fractional box positions must cover the right/bottom edge as well as
 // the top/left. A width-only ceil would miss those final pixels.
 const fractional=special.parseMaskPlan('1,10.25,20.25,4.3,5.3',dims);
 const before=marks.length;
 await special.exportMaskedPages({reader,plan:fractional,PDFLib,makeCanvas});
 const painted=marks.slice(before).find(x=>x.fill==='#000000');
 assert.deepEqual([painted.x,painted.y,painted.w,painted.h],[20,40,10,12]);
 // No PDF may be issued if the renderer's readback shows an uncovered pixel.
 const faultyCanvas=()=>{
  const canvas=makeCanvas(),context=canvas.getContext('2d');
  context.getImageData=()=>({data:Uint8ClampedArray.from([255,255,255,255])});
  return canvas;
 };
 await assert.rejects(
  special.exportMaskedPages({reader,plan,PDFLib,makeCanvas:faultyCanvas}),
  /마스크가 불투명한 검은색/
 );
 // A mask with black corners/center but a non-black interior pixel must fail.
 const coverageBox={x:12,y:20,width:8,height:6};
 const faultyPixel={getImageData(x,y,w,h){
  const data=new Uint8ClampedArray(w*h*4);
  for(let i=0;i<w*h;i++)data[i*4+3]=255;
  const missedX=27,missedY=43;
  if(missedX>=x&&missedX<x+w&&missedY>=y&&missedY<y+h)
   data[((missedY-y)*w+(missedX-x))*4]=255;
  return {data};
 }};
 assert.throws(()=>special.verifyFullMaskCoverage(faultyPixel,[coverageBox],40,70),/가려지지 않은 픽셀/);
 await assert.rejects(special.exportMaskedPages({reader,plan,PDFLib,makeCanvas,cancelled:()=>true}),/취소/);
 await assert.rejects(special.exportMaskedPages({reader,plan:[],PDFLib,makeCanvas}),/목록/);
 await assert.rejects(special.checkOutputStructure(output.bytes,PDFLib,3),/페이지 수/);
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 for(const phrase of ['maskPlanLines','maskPlanCheck','maskPlanPreview','exportMaskedPages','목록에 없는 페이지는 제외합니다.'])
  assert(editor.includes(phrase),'Editor must expose mask plan UI and warnings: '+phrase);
 console.log('PASS: multi-page multi-mask plan, bounds, output fresh PDF/no source catalog, cancellation, progress and safeguards');
})().catch(error=>{console.error(error);process.exitCode=1});
