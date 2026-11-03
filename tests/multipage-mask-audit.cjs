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
 const ctx={fillStyle:'',fillRect(x,y,w,h){marks.push({page:entry.page,fill:this.fillStyle,x,y,w,h})}};
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
 const fractionalPlan=special.parseMaskPlan('1,11.35,20.45,50.85,40.65',dims);
 const fractional=await special.exportMaskedPages({reader,plan:fractionalPlan,PDFLib,makeCanvas});
 assert.equal(fractional.pages,1);
 assert.deepEqual(
   marks.filter(x=>x.fill==='#000000').at(-1),
   {page:1,fill:'#000000',x:22,y:40,w:103,h:83},
   'fractional right/bottom edges must be fully covered in document-mode masks'
 );
 const pdf=await PDFLib.PDFDocument.load(output.bytes);
 assert.equal(pdf.getPageCount(),2);
 assert.equal(pdf.getPage(0).getWidth(),400);
 assert.equal(pdf.getPage(1).getWidth(),350);
 assert.deepEqual(await special.checkOutputStructure(output.bytes,PDFLib,2),{pageCount:2,sourceStreamsCopied:false});
 for(const key of ['AcroForm','Outlines','Names','Perms','Metadata','SunriseWebEdits'])
  assert.equal(pdf.catalog.get(PDFLib.PDFName.of(key)),undefined);
 await assert.rejects(special.exportMaskedPages({reader,plan,PDFLib,makeCanvas,cancelled:()=>true}),/취소/);
 await assert.rejects(special.exportMaskedPages({reader,plan:[],PDFLib,makeCanvas}),/목록/);
 await assert.rejects(special.checkOutputStructure(output.bytes,PDFLib,3),/페이지 수/);
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 for(const phrase of ['maskPlanLines','maskPlanCheck','maskPlanPreview','exportMaskedPages','목록에 없는 페이지는 제외합니다.'])
  assert(editor.includes(phrase),'Editor must expose mask plan UI and warnings: '+phrase);
 console.log('PASS: multi-page multi-mask plan, bounds, output fresh PDF/no source catalog, cancellation, progress and safeguards');
})().catch(error=>{console.error(error);process.exitCode=1});
