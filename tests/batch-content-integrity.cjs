'use strict';
// R18 — actual pdf-lib split/merge source-size and page-content integrity.
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const batch=require('../src/assets/sunrise-batch-pages.js');

async function fixture(name,pages,rotated=false){
 const pdf=await lib.PDFDocument.create();
 for(let i=0;i<pages;i++){
  const page=pdf.addPage([420+i*10,595+i*5]);
  page.drawText(name+' source content '+(i+1),{x:30,y:500,size:12});
  if(rotated&&i===1)page.setRotation(lib.degrees(90));
  if(i===0)page.setCropBox(6,10,350,520);
 }
 const bytes=Uint8Array.from(await pdf.save());
 return {name,size:bytes.byteLength,bytes};
}
function collector(){
 const results=[],errors=[],progress=[];
 return {results,errors,progress,handlers:{
  cancelled:()=>false,result:x=>results.push(x),error:x=>errors.push(x),
  progress:(...x)=>progress.push(x)
 }};
}
const regular={PDFLib:lib,readFile:async f=>f.bytes};
function tamperedLib(onReopen,expectedLoads){
 let count=0;
 return {...lib,PDFDocument:{
  create:(...args)=>lib.PDFDocument.create(...args),
  load:async(...args)=>{
   const pdf=await lib.PDFDocument.load(...args);
   if(++count===expectedLoads)onReopen(pdf);
   return pdf;
  }
 }};
}

(async()=>{
 const first=await fixture('alpha.pdf',2,true);
 const second=await fixture('beta.pdf',1);
 const original=Uint8Array.from(first.bytes);
 const success=collector();
 await batch.process([first],{mode:'split',pagesPerFile:1},success.handlers,regular);
 assert.equal(success.errors.length,0);
 assert.equal(success.results.length,2);
 for(const part of success.results){
  const saved=await lib.PDFDocument.load(part.bytes);
  assert.equal(saved.getPageCount(),1);
  assert.equal(saved.getPage(0).getCropBox().x,part.part===1?6:0);
 }
 const merged=collector();
 await batch.process([first,second],{mode:'merge'},merged.handlers,regular);
 assert.equal(merged.errors.length,0);
 assert.equal(merged.results.length,1);
 assert.equal((await lib.PDFDocument.load(merged.results[0].bytes)).getPageCount(),3);

 // A truncated read or an inaccurate file.size must not be processed.
 const mismatch={...first,size:first.size+1};
 const splitMismatch=collector();
 await batch.process([mismatch,second],{mode:'split',pagesPerFile:1},splitMismatch.handlers,regular);
 assert.equal(splitMismatch.errors.length,1);
 assert.match(splitMismatch.errors[0].message,/바이트 수.*일치하지/);
 assert.equal(splitMismatch.results.length,1,'other valid source still processes independently');
 const mergeMismatch=collector();
 await batch.process([mismatch,second],{mode:'merge'},mergeMismatch.handlers,regular);
 assert.equal(mergeMismatch.results.length,0);
 assert.equal(mergeMismatch.errors.length,1,'merge remains atomic');

 // Corruption after save/reopen: deleting a content stream must stop output.
 for(const [scenario,onReopen] of [
  ['removed contents',pdf=>pdf.getPage(0).node.delete(lib.PDFName.of('Contents'))],
  ['altered drawing operators',pdf=>pdf.getPage(0).drawText('UNEXPECTED ADDITION',{x:10,y:400})]
 ]){
  const split=collector();
  await batch.process([first],{mode:'split',pagesPerFile:2},split.handlers,{
   PDFLib:tamperedLib(onReopen,2),readFile:regular.readFile
  });
  assert.equal(split.results.length,0,scenario+' must never expose split output');
  assert.equal(split.errors.length,1);
  assert.match(split.errors[0].message,/내용 스트림/,scenario);
 }
 const mergedCorrupt=collector();
 await batch.process([first,second],{mode:'merge'},mergedCorrupt.handlers,{
  PDFLib:tamperedLib(pdf=>pdf.getPage(0).node.delete(lib.PDFName.of('Contents')),3),
  readFile:regular.readFile
 });
 assert.equal(mergedCorrupt.results.length,0);
 assert.equal(mergedCorrupt.errors.length,1);
 assert.match(mergedCorrupt.errors[0].message,/내용 스트림/);
 assert.deepEqual(first.bytes,original,'source bytes must never mutate');
 console.log('PASS R18: input-size mismatch isolation, source-byte immutability and page-content fingerprint fail-closed in split/merge');
})().catch(error=>{console.error(error);process.exitCode=1});
