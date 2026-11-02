// Medium-sized workload, deterministic cancellation, and safe byte accounting.
const assert=require('node:assert/strict');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const {process:processBatch,reserveOutputBytes}=require('../src/assets/sunrise-batch-pages.js');
const MiB=1024*1024;
async function main(){
 assert.equal(reserveOutputBytes(0,1),1);
 assert.equal(reserveOutputBytes(50*MiB,50*MiB),100*MiB);
 assert.equal(reserveOutputBytes(50*MiB,50*MiB+1),100*MiB+1);
 assert.equal(reserveOutputBytes(99*MiB,2*MiB),101*MiB);
 assert.throws(()=>reserveOutputBytes(-1,1),/바이트/);
 assert.throws(()=>reserveOutputBytes(0,0),/바이트/);
 assert.throws(()=>reserveOutputBytes(Number.MAX_SAFE_INTEGER,1),/바이트/);

 // The 120-page workload repeatedly serializes separate page groups.
 // It runs through the actual PDF processing engine, not a mocked algorithm.
 const pdf=await PDFLib.PDFDocument.create();
 for(let i=0;i<120;i++){
   const page=pdf.addPage([595,842]);
   page.drawText('Page '+(i+1),{x:40,y:790,size:12});
 }
 const bytes=await pdf.save();
 const input={name:'long-office-report.pdf',size:bytes.byteLength,bytes};
 const outcomes=[],failures=[],progress=[];
 const options={PDFLib,readFile:async file=>file.bytes};
 const handlers={cancelled:()=>false,progress:(...args)=>progress.push(args),
   result:item=>outcomes.push(item),error:reason=>failures.push(reason)};
 const start=Date.now();
 await processBatch([input],{mode:'split',pagesPerFile:6},handlers,options);
 const elapsed=Date.now()-start;
 assert.equal(failures.length,0,JSON.stringify(failures));
 assert.equal(outcomes.length,20);
 assert.deepEqual(outcomes.map(x=>x.part),Array.from({length:20},(_,i)=>i+1));
 const size=outcomes.reduce((n,item)=>n+item.bytes.byteLength,0);
 assert(Number.isSafeInteger(size)&&size>0,'serialized split sizes must be safe positive integers');
 for(const item of [outcomes[0],outcomes[9],outcomes[19]]){
   const restored=await PDFLib.PDFDocument.load(item.bytes);
   assert.equal(restored.getPageCount(),6);
   assert.equal(restored.getPage(0).getMediaBox().width,595);
 }
 assert.equal(progress.length,1);

 // Cancellation can arrive through the browser task queue while an in-flight
 // PDF is being split. No partial output for that source may be exposed.
 let timerCancellation=false,readCount=0;
 const partialResults=[],partialErrors=[];
 await processBatch([input],{mode:'split',pagesPerFile:1},{
   cancelled:()=>timerCancellation,progress:()=>{},
   result:item=>partialResults.push(item),error:item=>partialErrors.push(item)
 },{
   PDFLib,
   readFile:async file=>{
     readCount++;
     setTimeout(()=>{timerCancellation=true},0);
     return file.bytes;
   }
 });
 assert.equal(readCount,1,'document read should begin before cancellation');
 assert.equal(timerCancellation,true,'event loop must receive cancellation timer');
 assert.equal(partialResults.length,0,'cancelled source must not offer incomplete split set');
 assert.equal(partialErrors.length,0,'cancellation is not a document error');

 // USR-11: real multi-file merge yields page progress without allocating a
 // new PDF object copier per small group. Cancelling mid-merge must publish
 // no result, including no partially merged PDF.
 const left=await PDFLib.PDFDocument.create();
 const right=await PDFLib.PDFDocument.create();
 for(let i=0;i<24;i++)left.addPage([400,600]).drawText('Left '+i);
 for(let i=0;i<12;i++)right.addPage([600,400]).drawText('Right '+i);
 const leftBytes=await left.save(),rightBytes=await right.save();
 const twoInputs=[
   {name:'left.pdf',size:leftBytes.byteLength,bytes:leftBytes},
   {name:'right.pdf',size:rightBytes.byteLength,bytes:rightBytes}
 ];
 const mergeProgress=[],mergeFiles=[],mergedResults=[],mergeErrors=[];
 await processBatch(twoInputs,{mode:'merge'},{
   cancelled:()=>false,
   progress:(...args)=>mergeFiles.push(args),
   pageProgress:(done,total,name)=>mergeProgress.push([done,total,name]),
   result:part=>mergedResults.push(part),error:e=>mergeErrors.push(e)
 },options);
 assert.deepEqual(mergeProgress,[
   [8,36,'left.pdf'],[16,36,'left.pdf'],[24,36,'left.pdf'],
   [32,36,'right.pdf'],[36,36,'right.pdf']
 ],'merge progress must count validated pages without losing source names');
 assert.equal(mergeFiles.length,2,'normal file-level progress must stay compatible');
 assert.equal(mergeErrors.length,0);
 assert.equal(mergedResults.length,1);
 const verifiedMerge=await PDFLib.PDFDocument.load(mergedResults[0].bytes);
 assert.equal(verifiedMerge.getPageCount(),36);
 assert.equal(verifiedMerge.getPage(0).getMediaBox().width,400);
 assert.equal(verifiedMerge.getPage(35).getMediaBox().width,600);

 let stopMerge=false;
 const cancelledMergeResults=[],cancelledMergeErrors=[],cancelledMergeProgress=[];
 await processBatch(twoInputs,{mode:'merge'},{
   cancelled:()=>stopMerge,
   pageProgress:(done,total)=>{
     cancelledMergeProgress.push([done,total]);
     if(done===8)setTimeout(()=>{stopMerge=true},0);
   },
   result:x=>cancelledMergeResults.push(x),
   error:x=>cancelledMergeErrors.push(x)
 },options);
 assert.equal(stopMerge,true,'cancel signal must run on the browser/event loop');
 assert.deepEqual(cancelledMergeProgress,[[8,36]]);
 assert.equal(cancelledMergeResults.length,0,'mid-merge cancellation must not publish a partial document');
 assert.equal(cancelledMergeErrors.length,0,'cancellation must not be reported as PDF corruption');

 // Fail-fast when result count would be greater than the allowed 50 files.
 outcomes.length=0;failures.length=0;
 await processBatch([input],{mode:'split',pagesPerFile:2},handlers,options);
 assert.equal(outcomes.length,0);
 assert.match(failures[0]?.message||'',/50개/);
 console.log('PASS: 120-page split workload, safe output byte accounting, timer-driven split/merge cancellation without partial files, page progress, output count cap; elapsed='+elapsed+'ms');
}
main().catch(error=>{console.error(error);process.exitCode=1});
