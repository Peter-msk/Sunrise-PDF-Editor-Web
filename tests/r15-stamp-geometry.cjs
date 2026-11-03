'use strict';
const assert=require('node:assert/strict');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const stamper=require('../src/assets/sunrise-pdf-stamper.js');
(async()=>{
 const src=await PDFLib.PDFDocument.create();
 for(const [i,dim] of [[0,[420,595]],[1,[842,595]],[2,[420,595]],[3,[420,595]],[4,[842,595]]]){
  const p=src.addPage(dim);if(i===2)p.setRotation(PDFLib.degrees(90));
 }
 const bytes=await src.save(),file={size:bytes.byteLength,name:'mixed.pdf'};
 const opts={PDFLib,readFile:async()=>bytes};
 const result=await stamper.apply(file,{pages:'*',number:{enabled:true,template:'P{page}',startAt:1,fromPage:2,skipPages:'3,5',fontSize:11,margin:24,position:'bottom-center'},watermark:{enabled:true,text:'CENTER',fontSize:65,angle:-30,opacity:0.15}},opts);
 assert.equal(result.pageCount,5);
 const parsed=await PDFLib.PDFDocument.load(result.bytes);assert.equal(parsed.getPageCount(),5);
 for(const bad of ['0','6','2-1','x']){
  await assert.rejects(stamper.apply(file,{pages:'*',number:{enabled:true,fromPage:2,skipPages:bad},watermark:{enabled:false}},opts),/페이지/);
 }
 await assert.rejects(stamper.apply(file,{pages:'*',number:{enabled:true,fromPage:5,skipPages:'5'},watermark:{enabled:false}},opts),/번호를 표시할 페이지가 없습니다/);
 console.log('PASS R15: mixed portrait/landscape and rotated watermark, start on PDF page 2, skip 3/5, validations');
})().catch(e=>{console.error(e);process.exitCode=1});
