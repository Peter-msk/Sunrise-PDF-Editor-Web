'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const editor = fs.readFileSync('src/editor/index.html', 'utf8');
const between = (start, end) => {
  const a = editor.indexOf(start), b = editor.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `missing source section: ${start}`);
  return editor.slice(a, b);
};

async function verifyPrintLifecycle() {
  const revoked = [], opened = [], alerts = [], downloads = [], events = {};
  let index = 0, modal = false, blockPopup = false;
  const timers = new Map();
  const bytes = new Uint8Array([37,80,68,70]);
  const doc = {name:'개발보고서.pdf',bytes:new Uint8Array([1]),overlays:[],metadata:{},attachments:[]};
  const state = {docs:[doc]};
  let active = doc, compile = async () => bytes;
  const ctx = vm.createContext({
    Blob, Uint8Array, state, activeDocumentRevision:0,
    URL:{createObjectURL:() => `blob:test-${++index}`,revokeObjectURL:url => revoked.push(url)},
    window:{open:url => {opened.push(url); if(blockPopup) return null; return {};},addEventListener:(name,fn) => {events[name] = fn;}},
    setTimeout:(fn,ms) => {assert.equal(ms,180000);const id=++index;timers.set(id,fn);return id;},
    clearTimeout:id => timers.delete(id),
    activeDoc:() => active,
    captureSaveState:x => ({snapshot:{...x},bytes:x.bytes}),
    saveStateIsCurrent:(x,capture) => x.bytes === capture.bytes,
    compileDocumentWithOverlays:obj => compile(obj),
    downloadBytes:(buffer,name) => downloads.push({buffer,name}),
    showToast:msg => alerts.push(msg),
  });
  vm.runInContext(between('    // Browser PDF preview URLs are owned by this page.', '    const pendingDownloads=[];'),ctx);
  const printBlock = between('        case "printPdf":', '        case "closeDoc":');
  vm.runInContext(`async function runPrint(){ const doc=activeDoc(); switch('printPdf'){${printBlock}} }`,ctx);

  await vm.runInContext('runPrint()',ctx);
  assert.equal(opened.length,1,'first print opens preview');
  assert.equal(revoked.length,0,'opened preview remains alive briefly');
  assert.equal(timers.size,1,'opened preview has bounded lifetime');
  await vm.runInContext('runPrint()',ctx);
  await vm.runInContext('runPrint()',ctx);
  assert.equal(opened.length,3);
  assert.deepEqual(revoked,['blob:test-1'],'oldest print preview is reclaimed at cap 2');
  assert.equal(timers.size,2);
  events.pagehide();
  assert.equal(revoked.length,3,'navigation releases both previews');
  assert.equal(timers.size,0);

  blockPopup=true;
  await vm.runInContext('runPrint()',ctx);
  assert.equal(downloads.length,1,'blocked popup falls back to download');
  assert.equal(downloads[0].name,'개발보고서_print.pdf');
  assert(revoked.includes(opened.at(-1)),'blocked popup URL revoked immediately');
  assert.equal(timers.size,0);
  blockPopup=false;

  let release;
  compile = () => new Promise(resolve => {release=resolve;});
  const stale = vm.runInContext('runPrint()',ctx);
  active = null;state.docs.length = 0;
  release(bytes);await stale;
  assert.equal(opened.length,4,'closed document must not open stale preview');
  assert.equal(downloads.length,1);
  assert(alerts.some(x=>x.includes('문서가 변경')),'user receives stale result notice');

  state.docs.push(doc);active=doc;
  const modified = vm.runInContext('runPrint()',ctx);
  doc.bytes = new Uint8Array([9]);release(bytes);await modified;
  assert.equal(opened.length,4,'edited document must not print previous snapshot');

  // Even if the user switches A -> B -> A before compile completes, the old
  // print result belongs to an obsolete navigation and cannot be shown.
  const aba = vm.runInContext('runPrint()',ctx);
  ctx.activeDocumentRevision += 2;
  release(bytes);await aba;
  assert.equal(opened.length,4,'A-B-A document switching invalidates pending print');

  compile = async()=>{throw new Error('Synthetic compile failure');};
  await vm.runInContext('runPrint()',ctx);
  assert(alerts.some(x=>x.includes('인쇄용 PDF 준비 실패')),'compilation errors reported without unhandled rejection');
  assert.equal(timers.size,0);
}

async function verifyDocumentActivationRevision() {
  const docs = [{name:'A.pdf'},{name:'B.pdf'}];
  const state = {docs,activeDocIndex:0,selectedInsertId:null};
  let renders=0;
  const ctx=vm.createContext({
    state, activeDoc:()=>state.docs[state.activeDocIndex] || null,
    cancelPlacement(){}, clearSearchResults(){}, refreshAllViews:async()=>{renders++;},
  });
  const src=between('    // Detect even A -> B -> A tab switches', '    async function refreshAllViews() {');
  vm.runInContext(src,ctx);
  assert.equal(vm.runInContext('activeDocumentRevision',ctx),0);
  await vm.runInContext('setActiveDocument(1)',ctx);
  await vm.runInContext('setActiveDocument(0)',ctx);
  assert.equal(vm.runInContext('activeDocumentRevision',ctx),2,'A-B-A invalidates older async work');
  await vm.runInContext('setActiveDocument(0)',ctx);
  assert.equal(vm.runInContext('activeDocumentRevision',ctx),2,'same-document refresh does not create false changes');
  assert.equal(renders,3);
}

async function verifyRenderCancellation() {
  const body = between('    let currentRenderTask = null;', '    function visualSignatureLabel(');
  const elements = {};
  const created = [];
  const document = {
    getElementById(id){
      if(elements[id])return elements[id];
      const node = {dataset:{},style:{},clientWidth:900,clientHeight:700,width:1,height:1,replaceChildren(){},getContext(){return {drawImage(){created.push('draw');}}}};
      elements[id]=node;return node;
    },
    createElement(tag){assert.equal(tag,'canvas');return {width:1,height:1,getContext(){return {};}};},
  };
  const reader = {getPage:async()=>({getViewport:()=>({width:400,height:500}),render:()=>({promise:Promise.resolve(),cancel(){}})})};
  const doc = {id:'current',pageSizes:[{width:400,height:500}],pageCount:1,currentPage:0,zoom:1,
    fitMode:'custom',pdfJsDoc:reader};
  let requests=0;
  reader.getPage=async()=>{requests++;return {getViewport:()=>({width:400,height:500}),render:()=>({promise:Promise.resolve(),cancel(){}})};};
  const ctx=vm.createContext({
    document,window:{devicePixelRatio:1},console,activeDoc:()=>doc,
    isMobileViewport:()=>false,viewColumns:()=>1,preparePageFlow:()=>{},
    renderOverlayItems:()=>{},renderSearchIndicator:()=>{},updateCommandStates:()=>{},syncThumbnailSelection:()=>{},
  });
  vm.runInContext(body,ctx);
  let release;const inFlight=new Promise(resolve=>{release=resolve;});
  let cancelled=0;
  ctx.oldTask={cancel(){cancelled++;},promise:inFlight};
  vm.runInContext('currentRenderTask=oldTask',ctx);
  const earlier=vm.runInContext('renderCurrentPageCanvas()',ctx);
  const latest=vm.runInContext('renderCurrentPageCanvas()',ctx);
  release();await Promise.all([earlier,latest]);
  assert.equal(cancelled,2,'both navigations cancel prior render task');
  assert.equal(requests,1,'only newest navigation requests a fresh page');
  assert.equal(created.filter(x=>x==='draw').length,1,'only newest generation paints to the visible canvas');
}

Promise.resolve().then(verifyPrintLifecycle).then(verifyDocumentActivationRevision).then(verifyRenderCancellation).then(()=>{
  console.log('PASS R04: bounded print preview Blob URLs, stale document print cancellation, fallback and async render generation safety');
}).catch(error=>{console.error(error);process.exitCode=1;});
