'use strict';
// R19: cancellation must stop PDF parsing/reopening at the next async boundary.
// Real pdf-lib serialization is used; only the signal timing is injected.
const assert=require('node:assert/strict');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const batch=require('../src/assets/sunrise-batch-pages.js');

async function makeFile(name,pages){
 const pdf=await PDFLib.PDFDocument.create();
 for(let i=0;i<pages;i++)pdf.addPage([420,595]).drawText(name+' page '+i);
 const bytes=Uint8Array.from(await pdf.save());
 return {name,size:bytes.length,bytes};
}
function collect(flag){
 const results=[],errors=[];
 return {results,errors,handlers:{
  cancelled:()=>flag.cancelled,
  result:r=>results.push(r),
  error:e=>errors.push(e),
  progress:()=>{},
  pageProgress:()=>{}
 }};
}
function injectedEngine({onLoad,onCreate}={}){
 let loads=0,creates=0,saves=0;
 const document={
  async load(bytes,options){
   loads++;
   const pdf=await PDFLib.PDFDocument.load(bytes,options);
   onLoad?.(loads,pdf);
   return pdf;
  },
  async create(...args){
   creates++;
   const pdf=await PDFLib.PDFDocument.create(...args);
   const originalSave=pdf.save.bind(pdf);
   pdf.save=async(...saveArgs)=>{
    saves++;
    const bytes=await originalSave(...saveArgs);
    onCreate?.(saves,pdf);
    return bytes;
   };
   return pdf;
  }
 };
 return {lib:{...PDFLib,PDFDocument:document},counts:()=>({loads,creates,saves})};
}
async function run(files,settings,signal,engine,readFile){
 const output=collect(signal);
 await batch.process(files,settings,output.handlers,{
  PDFLib:engine.lib,
  readFile:readFile||async f=>f.bytes
 });
 return output;
}

(async()=>{
 const left=await makeFile('left.pdf',12),right=await makeFile('right.pdf',8);
 const inputCopy=Uint8Array.from(left.bytes);

 // A deferred browser read resolves after cancellation. The PDF parser must
 // never be invoked and no result/error callback should fire.
 for(const mode of ['split','merge']){
  const signal={cancelled:false},engine=injectedEngine();
  const files=mode==='split'?[left]:[left,right];
  const out=await run(files,{mode,pagesPerFile:6},signal,engine,async file=>{
   signal.cancelled=true;
   return file.bytes;
  });
  assert.deepEqual(engine.counts(),{loads:0,creates:0,saves:0},mode+' cancelled read');
  assert.equal(out.results.length,0);assert.equal(out.errors.length,0);
 }
 // Cancellation after source parsing must prevent starting the output engine.
 for(const mode of ['split','merge']){
  const signal={cancelled:false};
  const engine=injectedEngine({onLoad:count=>{if(count===1)signal.cancelled=true;}});
  const files=mode==='split'?[left]:[left,right];
  const out=await run(files,{mode,pagesPerFile:6},signal,engine);
  assert.equal(engine.counts().loads,1);
  assert.equal(engine.counts().creates,0);
  assert.equal(out.results.length,0);assert.equal(out.errors.length,0);
 }
 // Saving may already have started when cancellation is requested. Do not
 // perform an unnecessary PDF round-trip parse or publish a discarded result.
 for(const mode of ['split','merge']){
  const signal={cancelled:false};
  const engine=injectedEngine({onCreate:count=>{if(count===1)signal.cancelled=true;}});
  const files=mode==='split'?[left]:[left,right];
  const out=await run(files,{mode,pagesPerFile:6},signal,engine);
  const count=engine.counts();
  assert.equal(count.creates,1);assert.equal(count.saves,1);
  assert.equal(count.loads,files.length,'cancel after save must skip output PDF parse');
  assert.equal(out.results.length,0);assert.equal(out.errors.length,0);
 }
 // A completed output reload must also honor cancellation before costly
 // resource/page verification and before returning downloadable bytes.
 for(const mode of ['split','merge']){
  const signal={cancelled:false};
  const inputCount=mode==='split'?1:2;
  const engine=injectedEngine({onLoad:count=>{
   if(count===inputCount+1)signal.cancelled=true;
  }});
  const files=mode==='split'?[left]:[left,right];
  const out=await run(files,{mode,pagesPerFile:6},signal,engine);
  assert.equal(engine.counts().loads,inputCount+1);
  assert.equal(out.results.length,0);assert.equal(out.errors.length,0);
 }
 // Keep existing success contract, including actual PDF save/reopen and
 // original bytes unchanged.
 for(const mode of ['split','merge']){
  const signal={cancelled:false},engine=injectedEngine();
  const files=mode==='split'?[left]:[left,right];
  const out=await run(files,{mode,pagesPerFile:6},signal,engine);
  assert.equal(out.errors.length,0);
  assert.equal(out.results.length,mode==='split'?2:1);
  for(const item of out.results){
   const pdf=await PDFLib.PDFDocument.load(item.bytes);
   assert.equal(pdf.getPageCount(),mode==='split'?6:20);
  }
 }
 assert.deepEqual(left.bytes,inputCopy);
 console.log('PASS R19: cancelled reads/parses/saves/reopens halt before further heavy PDF work; split and merge success unaffected');
})().catch(error=>{console.error(error);process.exitCode=1});
