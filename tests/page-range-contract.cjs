const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const src=fs.readFileSync('src/editor/index.html','utf8');
const start=src.indexOf('    function formatSelectedPages('),end=src.indexOf('    async function splitDocumentPages(',start); assert(start>=0 && end>start);
const doc={pageCount:10,currentPage:0,selectedPages:new Set([0])}, state={selectedInsertId:'old'};
const ctx=vm.createContext({doc,state,Set,console,activeDoc:()=>doc,renderCurrentPageCanvas:()=>{},renderLeftPane:()=>{},updateCommandStates:()=>{},showToast:()=>{}});
vm.runInContext(src.slice(start,end),ctx);
assert.equal(vm.runInContext('formatSelectedPages(new Set([0,1,2,4,7,8]))',ctx),'1-3, 5, 8-9');
const parse=(s,n=10)=>Array.from(vm.runInContext(`parseRangeInput(${JSON.stringify(s)},${n})`,ctx));
assert.deepEqual(parse('1-3, 5, 3-7'),[0,1,2,3,4,5,6]);
assert.deepEqual(parse('8-6, 2, 2'),[1,5,6,7]);
for(const s of ['', '1,,2','1,11','0','1a','1-2-3','1.5','9007199254740992','1-99999999999999','1,'.repeat(3000)]) assert.deepEqual(parse(s),[],s);
vm.runInContext('applyPageSelection(doc, [1,3,5])',ctx);assert.deepEqual([...doc.selectedPages],[1,3,5]);assert.equal(doc.currentPage,1);
ctx.doc.operationBusy=true;vm.runInContext('applyPageSelection(doc, [0])',ctx);assert.deepEqual([...doc.selectedPages],[1,3,5]);

// Regression: split filenames, stale editable-state detection, and existing save guards.
const splitStart=src.indexOf('    async function splitDocumentPages(doc){');
const splitEnd=src.indexOf('    async function deleteSelectedPagesFromDoc(doc)',splitStart);
assert(splitStart>=0&&splitEnd>splitStart);
const splitCode=src.slice(splitStart,splitEnd);
const stemExpression=splitCode.match(/const stem=(.+);/)?.[1];
assert(stemExpression,'split filename expression must remain defined');
ctx.doc.name='검토보고서.PDF';
assert.equal(vm.runInContext(stemExpression,ctx),'검토보고서','remove only the final .pdf extension');
ctx.doc.name='회의/보고서.pdf';
assert.equal(vm.runInContext(stemExpression,ctx),'회의_보고서','sanitize file name separators');
assert.match(splitCode,/captureSaveState\(doc, false\)/);
assert.match(splitCode,/saveStateIsCurrent\(doc,captured\)/);
assert.match(splitCode,/verifyPdfPageGeometry\(part,reopened,"분할"\)/);
assert(splitCode.indexOf('verifyPdfPageGeometry(part,reopened,"분할")') <
  splitCode.indexOf('downloadBytes(bytes,spec.name'),'split result must be reopened and checked before download');
const saveBegin=src.indexOf('    function captureSaveState(doc, includeSnapshot = true)');
const saveEnd=src.indexOf('    function pdfCompressionSettings(',saveBegin);
assert(saveBegin>=0&&saveEnd>saveBegin);
const safeCtx=vm.createContext({Uint8Array,JSON});
vm.runInContext(src.slice(saveBegin,saveEnd),safeCtx);
const edited={bytes:Uint8Array.from([1]),pdfJsDoc:{},overlays:[],bookmarks:[],metadata:{},attachments:[]};
safeCtx.doc=edited;
vm.runInContext('var captured=captureSaveState(doc,false)',safeCtx);
assert.equal(vm.runInContext('saveStateIsCurrent(doc,captured)',safeCtx),true);
edited.overlays.push({text:'modified while split modal is open'});
assert.equal(vm.runInContext('saveStateIsCurrent(doc,captured)',safeCtx),false,'changed overlay must invalidate prepared split');
edited.overlays.length=0;
edited.bookmarks.push({title:'changed'});
assert.equal(vm.runInContext('saveStateIsCurrent(doc,captured)',safeCtx),false,'changed bookmarks must invalidate prepared split');
edited.bookmarks.length=0;
edited.bytes=Uint8Array.from([1]);
assert.equal(vm.runInContext('saveStateIsCurrent(doc,captured)',safeCtx),false,'replacement bytes must invalidate prepared split');

console.log('PASS: bounded page ranges, split filenames and stale editable-state guards');
