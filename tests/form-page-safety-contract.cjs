const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const src=fs.readFileSync('src/editor/index.html','utf8'),n=lib.PDFName.of;
const section=(a,b)=>{const i=src.indexOf(a),j=src.indexOf(b,i);assert(i>=0&&j>i,a);return src.slice(i,j)};
let active,notices=[],snapshots=0,downloads=0,opens=0,closes=0,callbacks={};
const state={mergeQueue:[],pageClipboard:{sourceName:'unchanged'},mergeSelectedIdx:0};
const elements={};
function el(id){return elements[id] ||= {value:'',checked:false,addEventListener(type,fn){callbacks[id+':'+type]=fn}}}
el('mergeOutputNameInput').value='merged.pdf';el('mergeOpenAfterCheck').checked=true;el('mergeDownloadCheck').checked=true;
el('extractRangeInput').value='1';el('extractNameInput').value='extracted.pdf';el('pastePosSelect').value='after';
el('splitRangeInput').value='1-2';
el('splitSizeInput').value='1';
el('splitReadyResults').isConnected=true;
el('splitReadyResults').replaceChildren=()=>{};
el('splitReadyResults').querySelectorAll=()=>[];
el('modalBackdrop').classList={contains:()=>true};
el('reorderInput').value='2, 1';el('blankPosSelect').value='after';el('blankSizeSelect').value='a4p';el('blankCountInput').value='1';
const ctx=vm.createContext({window:{PDFLib:lib,SunriseEditState:{},SunriseKoreanFont:{}},state,Set,Array,JSON,Uint8Array,
 console:{warn(){},error(){}},document:{getElementById:el},activeDoc:()=>active,showToast:s=>notices.push(s),
 saveUndoSnapshot:()=>snapshots++,reloadDocPdfJs:async()=>{},refreshAllViews:async()=>{},renderMergeQueueList(){},
 // The real editable-state comparison is covered by page-range-contract.cjs.
 // Here a stable immutable source snapshot lets us test AcroForm rejection.
 captureSaveState:doc=>({sourceBytes:doc.bytes}),
 saveStateIsCurrent:(doc,captured)=>doc.bytes===captured.sourceBytes,
 openModal:config=>config.onMount(),closeModal:()=>closes++,escapeHtml:x=>x,downloadBytes:()=>downloads++,
 openPdfFromBytes:async()=>opens++,compileDocumentWithOverlays:async doc=>doc.bytes,remapPageItems(){}});
vm.runInContext(
 section('    function validatePdfByteLength(', '    async function openPdfFromBytes(')+
 section('    async function executePdfMergeFromModal(', '    // Command Dispatcher')+
 section('    function openInsertBlankPageModal(', '    async function duplicateSelectedPages(')+
 section('    async function duplicateSelectedPages(', '    async function rotateSelectedPages(')+
 section('      document.getElementById("insertPdfInput").addEventListener', '      document.getElementById("imageToPdfInput")'),ctx);

async function makePdf(kind){
 const pdf=await lib.PDFDocument.create();const page=pdf.addPage();pdf.addPage();
 if(kind==='form'){
  const form=pdf.getForm(),field=form.createTextField('customer_name'),box=form.createCheckBox('consent');
  field.addToPage(page);field.setText('Sample Name');box.addToPage(page,{x:20,y:300});box.check();
 }
 if(kind==='xfa')pdf.catalog.set(n('AcroForm'),pdf.context.obj({Fields:[],XFA:lib.PDFString.of('example')}));
 if(kind==='orphan')page.node.set(n('Annots'),pdf.context.obj([pdf.context.register(pdf.context.obj({Type:'Annot',Subtype:'Widget',Rect:[0,0,10,10]}))]));
 return await pdf.save({updateFieldAppearances:kind==='form'});
}
const doc=bytes=>({name:'test.pdf',bytes,pageCount:2,currentPage:0,selectedPages:new Set([0]),overlays:[],bookmarks:[]});
(async()=>{
 const plain=await makePdf('plain'),form=await makePdf('form'),xfa=await makePdf('xfa'),orphan=await makePdf('orphan');
 for(const [bytes,expected] of [[plain,true],[form,false],[xfa,false],[orphan,false]]){
  ctx.pdf=await lib.PDFDocument.load(bytes);assert.equal(vm.runInContext('allowPageFormStructure(pdf)',ctx),expected);
 }
 active=doc(form);ctx.doc=active;const before=active.bytes;
 await vm.runInContext('duplicateSelectedPages(doc)',ctx);
 await vm.runInContext('copySelectedPagesToClipboard(doc,false)',ctx);
 await vm.runInContext('copySelectedPagesToClipboard(doc,true)',ctx);
 await vm.runInContext('deleteSelectedPagesFromDoc(doc)',ctx);
 vm.runInContext('openInsertBlankPageModal(doc)',ctx);await callbacks['blankInsertConfirmBtn:click']();
 vm.runInContext('openReorderPagesModal(doc)',ctx);await callbacks['reorderConfirmBtn:click']();
 assert.equal(active.bytes,before);assert.equal(state.pageClipboard.sourceName,'unchanged');assert.equal(snapshots,0);
 await vm.runInContext('splitDocumentPages(doc)',ctx);
 await callbacks['splitPrepareBtn:click']();
 vm.runInContext('openExtractPagesModal(doc)',ctx);await callbacks['extractConfirmBtn:click']();
 assert.equal(downloads,0);assert.equal(opens,0);assert.equal(closes,0);
 state.mergeQueue=[{name:'normal.pdf',bytes:plain},{name:'form.pdf',bytes:form}];
 await vm.runInContext('executePdfMergeFromModal()',ctx);
 assert.equal(downloads,0);assert.equal(opens,0);assert.equal(closes,0);
 active=doc(plain);ctx.doc=active;state.pageClipboard={sourceName:'legacy',count:2,bytes:form,overlays:[]};
 vm.runInContext('openPastePagesModal(doc)',ctx);await callbacks['pasteConfirmBtn:click']();
 const event={target:{files:[{name:'form.pdf',size:form.byteLength,arrayBuffer:async()=>form}],value:'form.pdf'}};
 await callbacks['insertPdfInput:change'](event);
 assert.equal(event.target.value,'');assert.equal(active.bytes,plain);assert.equal(snapshots,0);
 assert(notices.some(s=>s.includes('양식')));
 const original=await lib.PDFDocument.load(form),fields=original.getForm();
 assert.equal(fields.getTextField('customer_name').getText(),'Sample Name');assert.equal(fields.getCheckBox('consent').isChecked(),true);
 console.log('PASS: form/XFA/widget page operations fail safely before state change or download; normal documents remain allowed');
})().catch(e=>{console.error(e);process.exitCode=1});
