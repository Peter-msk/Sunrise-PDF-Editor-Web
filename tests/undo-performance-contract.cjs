const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const text = fs.readFileSync(require('node:path').join(__dirname,'../src/editor/index.html'),'utf8');
const a=text.indexOf('    function saveUndoSnapshot('), b=text.indexOf('    // Rendering: Ribbon',a);
assert(a>=0 && b>a);
let reloads=0;
const ctx=vm.createContext({console,Set,Date,JSON,state:{selectedInsertId:null},activeDoc:()=>ctx.doc,
  reloadDocPdfJs:async()=>{reloads++},refreshAllViews:async()=>{},showToast:()=>{}});
vm.runInContext(text.slice(a,b),ctx);
(async()=>{
 const bytes=new Uint8Array([1,2,3]);
 ctx.doc={bytes,overlays:[{pageIndex:0,text:'before'}],bookmarks:[],attachments:[],metadata:{},currentPage:0,undoStack:[],redoStack:[],history:[]};
 vm.runInContext('saveUndoSnapshot(doc,"edit")',ctx);
 assert.strictEqual(ctx.doc.undoStack[0].bytes,bytes);
 ctx.doc.overlays[0].text='after';
 await vm.runInContext('performUndo()',ctx);
 assert.equal(ctx.doc.overlays[0].text,'before'); assert.equal(reloads,0);
 await vm.runInContext('performRedo()',ctx);
 assert.equal(ctx.doc.overlays[0].text,'after'); assert.equal(reloads,0);
 vm.runInContext('saveUndoSnapshot(doc,"pages")',ctx);
 ctx.doc.bytes=new Uint8Array([4,5]);
 await vm.runInContext('performUndo()',ctx);
 assert.strictEqual(ctx.doc.bytes,bytes); assert.equal(reloads,1);
 console.log('PASS: overlay undo/redo avoids PDF reload; changed PDF bytes still reload');
})().catch(error=>{console.error(error);process.exit(1)});
