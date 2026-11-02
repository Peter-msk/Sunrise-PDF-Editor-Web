'use strict';
const assert=require('node:assert/strict');
const L=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const composer=require('../src/assets/sunrise-page-composer.js');
const batch=require('../src/assets/sunrise-batch-pages.js');
const form=require('../src/assets/sunrise-pdf-form-tools.js');
const stamp=require('../src/assets/sunrise-pdf-stamper.js');
const metadata=require('../src/assets/sunrise-pdf-metadata.js');
const preflight=require('../src/assets/sunrise-batch-preflight.js');
const quality=require('../src/assets/sunrise-pdf-quality.js');
const report=require('../src/assets/sunrise-pdf-quality-report.js');
function file(data,name='fixture.pdf'){return {name,size:data.byteLength, arrayBuffer:async()=>data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength)}}
const readFile=async f=>new Uint8Array(await f.arrayBuffer());
(async()=>{
 const origin=await L.PDFDocument.create();
 for(let i=0;i<2;i++){const p=origin.addPage([595,842]);p.drawText('Sunrise '+i,{x:35,y:760})}
 const f=file(await origin.save());const opts={PDFLib:L,readFile};const passes=[];
 const made=await composer.compose([f],'1:2,blank:A4,1:1', {...opts,checkSource:batch.checkSource});
 assert.equal((await L.PDFDocument.load(made.bytes)).getPageCount(),3);passes.push('compose-3-pages');
 const filled=await form.apply(f,[{action:'add',type:'text',name:'person',page:1,x:30,y:660,width:200,height:32,value:'Sunrise'},{action:'set',name:'person',value:'Editor'}],opts);
 const reopened=await L.PDFDocument.load(filled.bytes);assert.equal(reopened.getForm().getTextField('person').getText(),'Editor');passes.push('form-add-fill-reopen');
 const marked=await stamp.apply(f,{pages:'1-2',number:{enabled:true,template:'Page {page}/{total}'},watermark:{enabled:true,text:'DRAFT'}},opts);
 assert.equal((await L.PDFDocument.load(marked.bytes)).getPageCount(),2);passes.push('watermark-and-number');
 const info=await metadata.apply(f,{title:'R09 Metadata',author:'Sunrise' },opts);
 const m=await L.PDFDocument.load(info.bytes);assert.equal(m.getTitle(),'R09 Metadata');assert.equal(m.getAuthor(),'Sunrise');passes.push('metadata-roundtrip');
 const invalid=file(Buffer.from('not a PDF'),'invalid.pdf');
 const q=await preflight.inspectBatch([f,invalid],{...opts,quality});assert.equal(q.entries.length,2);
 assert.equal(q.entries[1].status,'failed');
 const csv=preflight.csvExport(q,report);assert(csv.includes('invalid.pdf'));passes.push('batch-preflight-partial-failure-and-csv');
 await assert.rejects(()=>composer.compose([f],'1:1',{...opts,checkSource:batch.checkSource,cancelled:()=>true}),e=>e.name==='AbortError');passes.push('compose-cancellation');
 console.log(JSON.stringify({status:'PASS',checks:passes},null,2));
})().catch(error=>{console.error('R09 remaining PDF engines FAIL:',error.stack||error);process.exitCode=1});
