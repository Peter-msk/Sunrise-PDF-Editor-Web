'use strict';
// Defer running until the feature batch is implemented; simulates PDF save failure.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const source=fs.readFileSync('src/editor/index.html','utf8');
function slice(a,b){const i=source.indexOf(a),j=source.indexOf(b,i);assert(i>=0&&j>i,a);return source.slice(i,j);}
let snapshot=0;
const originalPdf=async()=>{
 const pdf=await lib.PDFDocument.create();
 pdf.addPage([300,450]);pdf.addPage([300,450]);
 return pdf.save();
};
const inputElements={
 reorderInput:{value:'2, 1'},
 reorderReverseBtn:{addEventListener(){}},
 reorderCancelBtn:{addEventListener(){}},
 reorderConfirmBtn:{addEventListener(_,fn){this.click=fn}}
};
const state={pageClipboard:{sourceName:'before'}};
const injectedLib={...lib,PDFDocument:{
 load:async bytes=>{
  const pdf=await lib.PDFDocument.load(bytes);
  pdf.save=async()=>{throw Error('synthetic serialization failure');};
  return pdf;
 },
 create:async()=>lib.PDFDocument.create()
}};
const ctx=vm.createContext({
 window:{PDFLib:injectedLib},state,Set,Array,console,
 beginOperationMetric:()=>()=>{},activeDoc:()=>ctx.doc,
 showToast:()=>{},saveUndoSnapshot:()=>{snapshot++;},
 allowPageStructureChange:()=>true,allowPageFormStructure:()=>true,
 reloadDocPdfJs:async()=>{},refreshAllViews:async()=>{},
 remapPageItems:()=>{throw Error('must not publish edits before save');},
 openModal:config=>config.onMount(),closeModal:()=>{},
 document:{getElementById:id=>inputElements[id]}
});
vm.runInContext(
 slice('    async function duplicateSelectedPages(', '    // Resolve supported local destinations')+
 slice('    async function copySelectedPagesToClipboard(', '    function openPastePagesModal(')+
 slice('    async function deleteSelectedPagesFromDoc(', '    function openReorderPagesModal(')+
 slice('    function openReorderPagesModal(', '    async function rotateSelectedPages('),ctx);
(async()=>{
 const bytes=await originalPdf();
 function fresh(){return {name:'sample.pdf',bytes,pageCount:2,currentPage:0,
  selectedPages:new Set([0]),overlays:[],bookmarks:[]};}
 for(const name of ['duplicateSelectedPages','deleteSelectedPagesFromDoc']){
  const doc=fresh();ctx.doc=doc;snapshot=0;
  await assert.rejects(ctx[name](doc),/synthetic serialization failure/);
  assert.equal(doc.bytes,bytes);assert.equal(snapshot,0);
  assert.equal(doc.overlays.length,0);
 }
 {
  const doc=fresh();ctx.doc=doc;snapshot=0;
  await assert.rejects(ctx.copySelectedPagesToClipboard(doc,true),/synthetic serialization failure/);
  assert.equal(doc.bytes,bytes);assert.equal(snapshot,0);
  assert.equal(state.pageClipboard.sourceName,'before');
 }
 {
  const doc=fresh();ctx.doc=doc;snapshot=0;
  ctx.openReorderPagesModal(doc);
  await assert.rejects(inputElements.reorderConfirmBtn.click(),/synthetic serialization failure/);
  assert.equal(doc.bytes,bytes);assert.equal(snapshot,0);
 }
 console.log('PASS: failed page duplication, deletion, cut and reorder do not publish state');
})().catch(error=>{console.error(error);process.exitCode=1;});
