'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),rules=require('../src/assets/sunrise-diagnostics.js');
const source=fs.readFileSync('src/editor/index.html','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
(async()=>{
 const pdf=await lib.PDFDocument.create();pdf.addPage();const raw=await pdf.save();
 const prefixed=new Uint8Array(raw.length+4);prefixed.set([239,187,191,10]);prefixed.set(raw,4);
 assert(rules.hasPdfHeader(prefixed));assert.equal((await lib.PDFDocument.load(prefixed)).getPageCount(),1);
 const metrics=[],recents=[];let destroyed=0,failRender=false,failRestore=false;
 const existing={id:'old'},state={docs:[existing],activeDocIndex:0};
 const context={Uint8Array,TextDecoder,Number,Math,Error,Array,Set,console,state,docIdCounter:1,overlayIdCounter:1,
  window:{PDFLib:lib,SunriseDiagnostics:rules,navigator:{userAgent:'Chrome/123'},pdfjsLib:{getDocument(){return {promise:Promise.resolve({numPages:1,getAttachments:async()=>null,getPage:async()=>({getViewport:()=>({width:400,height:600})}),destroy:async()=>{destroyed++}})}}},SunriseEditState:{restore:async bytes=>{if(failRestore)throw new lib.EncryptedPDFError();return {bytes,overlays:[]}}},sunriseTelemetryOperationStart:()=>{let ended=false;return (stage,detail)=>{if(!ended){ended=true;metrics.push({stage,detail})}}}},
  activeDoc:()=>state.docs[state.activeDocIndex],addRecentFile:name=>recents.push(name),showToast(){},renderDocTabs(){},updateCommandStates(){},refreshAllViews:async()=>{},
  setActiveDocument:async index=>{state.activeDocIndex=index;if(failRender)state.docs[index].openingFailure=rules.tagged('page_render_failed',new Error('PRIVATE'))}
 };
 vm.createContext(context);
 vm.runInContext(section('    function pdfJsLoadOptions(', '    // Read the original outline')+section('    function validatePdfByteLength(', '    function addRecentFile('),context);
 const file=(size,arrayBuffer)=>({name:'PRIVATE-FILENAME.pdf',size,arrayBuffer});
 for(const [input,code] of [[file(0,async()=>new ArrayBuffer(0)),'empty_file'],[file(100,async()=>{throw Error('PRIVATE') }),'read_failed'],[file(100,async()=>raw),'partial_read']]){
  await assert.rejects(context.openPdfFile(input));assert.equal(metrics.at(-1).detail.code,code);assert(!JSON.stringify(metrics.at(-1)).includes('PRIVATE'));
  const trace=metrics.at(-1).detail.trace;assert.equal(trace?.feature,'open');assert.equal(trace?.module,'document_open');assert.equal(trace?.code,code);assert(trace?.steps.some(step=>step.step==='read_failed'));
 }
 await context.openPdfFile(file(prefixed.length,async()=>prefixed.buffer));assert.equal(metrics.at(-1).stage,'succeeded');assert.equal(recents.length,1);
 failRestore=true;await assert.rejects(context.openPdfFile(file(raw.length,async()=>raw.buffer)));assert.equal(metrics.at(-1).detail.code,'password_required');failRestore=false;
 const before=state.docs.slice(),oldRecent=recents.length;failRender=true;
 await assert.rejects(context.openPdfFile(file(raw.length,async()=>raw.buffer)));
 assert.equal(metrics.at(-1).detail.code,'page_render_failed');assert.equal(metrics.at(-1).detail.trace?.callsite,'render_first_page');assert(metrics.at(-1).detail.trace?.steps.some(s=>s.step==='render_failed'));assert.deepEqual(state.docs,before);assert.equal(recents.length,oldRecent);assert(destroyed>0);
 const error=Error('cancel');error.name='AbortError';await assert.rejects(context.openPdfFile(file(1,async()=>{throw error})));assert.equal(metrics.at(-1).stage,'cancelled');
 // A late engine promise is awaited, rather than producing a false not-ready error.
 failRender=false;const engine=context.window.pdfjsLib;delete context.window.pdfjsLib;
 context.window.sunrisePdfEngineReady=Promise.resolve().then(()=>{context.window.pdfjsLib=engine});
 await context.openPdfFile(file(raw.length,async()=>raw.buffer));assert.equal(metrics.at(-1).stage,'succeeded');
 console.log('PASS: file read failures are measured; prefixed PDF accepted; password and first-render causes classified; failed open rolls back and destroys reader; cancellation and delayed engine are safe');
})().catch(e=>{console.error(e);process.exitCode=1});
