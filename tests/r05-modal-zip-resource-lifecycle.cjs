'use strict';
// R05: Lifecycle safety belongs to the real browser download and dialog owners.
// Test UI behavior through the loaded source, not synthetic helper rewrites.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const rootDir = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(rootDir, 'src/assets', file), 'utf8');

function fixture() {
  const idNodes = new Map();
  const observers = [];
  const revoked = [], clicked = [], timers = new Map(), events = {};
  let counter = 0, visible = true, clickThrows = false;
  const backdrop = {classList: {contains: name => name === 'open' && visible}};
  const modalBody = {};
  idNodes.set('modalBackdrop', backdrop);
  idNodes.set('modalBody', modalBody);
  class Observer {
    constructor(callback) {this.callback = callback;this.targets = [];observers.push(this);this.disconnected = false;}
    observe(node, options) {this.targets.push({node, options});}
    disconnect() {this.disconnected = true;}
    trigger() {if (!this.disconnected) this.callback();}
  }
  const body = {children: [],append(node) {this.children.push(node);},};
  const make = (tag) => {
    const listeners = {};
    return {tagName: tag,style: {},listeners,disabled: false,value: '',textContent: '',hidden: false,
      children: [],files: [],classList: {contains: () => true},
      addEventListener(type, callback) {listeners[type] = callback;},
      append(...elements) {this.children.push(...elements);},
      replaceChildren(...elements) {this.children = [...elements];},
      setAttribute() {},
      remove() {const index = body.children.indexOf(this);if(index >= 0) body.children.splice(index,1);},
      click() {clicked.push({name:this.download||null,href:this.href||null});if(clickThrows)throw Error('Blocked download');},
    };
  };
  const document = {
    readyState: 'loading', body,head: {append() {}},getElementById: name => idNodes.get(name)||null,
    createElement:make, contains:node => visible && [...idNodes.values()].includes(node),
    addEventListener() {},
  };
  const win = {
    document,MutationObserver: Observer,
    setTimeout(callback, ms) {const id = ++counter;timers.set(id,{callback,ms});return id;},
    clearTimeout(id) {timers.delete(id);},
    addEventListener(type, handler) {events[type] = handler;},
    URL: {createObjectURL:() => `blob:local-${++counter}`,revokeObjectURL: url => revoked.push(url)},
    console,location:{search:''},
  };
  vm.runInNewContext(read('sunrise-local-ui.js'),{window:win,Blob,ArrayBuffer,console});
  return {win,document,make,idNodes,observers,timers,events,revoked,clicked,
    setVisible(v) {visible = v;for(const o of observers)o.trigger();},
    get visible() {return visible;},
    setThrow(v){clickThrows = v;},
  };
}

function testPdfInputLimits() {
  const engine = require('../src/assets/sunrise-pdf-to-images.js');
  const MiB = 1024*1024;
  let reads = 0;
  const f = (size,i) => ({name:`${i}.pdf`,size,arrayBuffer:async()=>{reads++;return new ArrayBuffer(0);}});
  assert.throws(()=>engine.normalizeFiles([f(61*MiB,1)]),/60MiB/);
  assert.throws(()=>engine.normalizeFiles([f(50*MiB,1),f(50*MiB,2),f(50*MiB,3)]),/120MiB/);
  assert.equal(reads,0,'unsafe PDF inputs must be rejected before reading any bytes');
  assert.equal(engine.normalizeFiles([f(60*MiB,1),f(60*MiB,2)]).length,2);
}

async function testNormalZipConversion() {
  const images = require('../src/assets/sunrise-pdf-to-images.js');
  const compare = require('../src/assets/sunrise-pdf-visual-compare.js');
  const pdfBytes = Uint8Array.from([37,80,68,70,45,49,46,55]);
  const file = {name:'sample.pdf',size:pdfBytes.length,arrayBuffer:async()=>pdfBytes.slice().buffer};
  let destroyed=0, cleaned=0, canvasCleared=0;
  const pdfjsLib = {getDocument() {return {
    promise:Promise.resolve({numPages:1,getPage:async()=>({
      getViewport:({scale})=>({width:100*scale,height:80*scale}),
      render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){cleaned++;},
    })}),
    destroy:async()=>{destroyed++;},
  };}};
  function canvas() {
    const backing={width:0,height:0};
    const ctx={getImageData:()=>({width:backing.width,height:backing.height,
      data:new Uint8ClampedArray(backing.width*backing.height*4)}),
      putImageData(){},fillRect(){}};
    return {
      get width(){return backing.width;},set width(n){if(n===0)canvasCleared++;backing.width=n;},
      get height(){return backing.height;},set height(n){backing.height=n;},
      getContext:()=>ctx,
      toBlob(callback,type){callback(new Blob([Uint8Array.of(137,80,78,71)],{type}));},
    };
  }
  const converted=await images.convert([file],{format:'png',dpi:96,pages:'1'},
    {pdfjsLib,createCanvas:canvas});
  assert.equal(converted.count,1);
  assert.equal(converted.blob.type,'application/zip');
  const zipBytes=new Uint8Array(await converted.blob.arrayBuffer());
  assert.equal(new DataView(zipBytes.buffer).getUint32(0,true),0x04034b50,'ZIP must have a local file header');
  assert.equal(destroyed,1);
  assert(cleaned>0&&canvasCleared>0,'renderer and canvas resources must be cleaned');
  const compared=await compare.convert(file,file,{pages:'1',dpi:96,createImages:false},
    {pdfjsLib,createCanvas:canvas,createZip:images.packEntries});
  assert.equal(compared.report.summary.same,1);
  assert.equal(compared.imageCount,0);
  assert.equal(compared.blob.type,'application/zip');
  assert.equal(destroyed,3,'both PDF.js document handles are destroyed');
}

function testBoundedDownload() {
  const f = fixture();
  const u = f.win.SunriseLocalUI;
  const blob = new Blob([Uint8Array.from([1,2,3])], {type:'application/zip'});
  assert.throws(()=>u.downloadBlob(new Blob([]),'empty.zip'),/크기/);
  assert.throws(()=>u.downloadBlob(blob,'..'),/파일명/);
  u.downloadBlob(blob,'report:a.zip');
  u.downloadBlob(blob,'report:b.zip');
  assert.equal(f.revoked.length,0);
  assert.equal(f.timers.size,2);
  assert.deepEqual(f.clicked.map(x=>x.name),['report_a.zip','report_b.zip']);
  u.downloadBlob(blob,'third.zip');
  assert.deepEqual(f.revoked,[f.clicked[0].href],'oldest URL must be released at cap 2');
  assert.equal(f.timers.size,2);
  assert.equal(f.document.body.children.length,0,'temporary anchors must be removed');
  f.events.pagehide();
  assert.deepEqual(f.revoked,f.clicked.map(x=>x.href));
  assert.equal(f.timers.size,0,'all timers cleared when page closes');
  f.events.pagehide();
  assert.equal(f.revoked.length,3,'cleanup is idempotent');
  f.setThrow(true);
  assert.throws(()=>u.downloadBlob(blob,'error.zip'),/Blocked download/);
  assert(f.revoked.includes(f.clicked.at(-1).href),'click error releases object URL immediately');
  assert.equal(f.timers.size,0);
  // Use a lightweight Blob-like object to test accounting without allocating 256 MiB.
  class FakeBlob {constructor(size) {this.size=size;}}
  const g=fixture();
  vm.runInNewContext(read('sunrise-local-ui.js'),{window:g.win,Blob:FakeBlob,ArrayBuffer,console});
  const d = g.win.SunriseLocalUI.downloadBlob;
  d(new FakeBlob(150*1024*1024),'large-a.zip');
  d(new FakeBlob(150*1024*1024),'large-b.zip');
  assert.deepEqual(g.revoked,[g.clicked[0].href],'aggregate bytes must be bounded');
  assert.equal(g.timers.size,1);
  assert.throws(()=>d(new FakeBlob(257*1024*1024),'too-large.zip'),/256/);
}

async function testModalConversion(module, launchName, buttonId, name) {
  const f = fixture();
  const defers = [];
  const args=[];
  const ids = name==='images'
    ? ['sunPdfToImagesFile','sunPdfToImagesDrop','sunPdfToImagesFiles','sunPdfToImagesFormat',
      'sunPdfToImagesDpi','sunPdfToImagesPages','sunPdfToImagesQuality','sunPdfToImagesQualityLabel',
      'sunPdfToImagesStart','sunPdfToImagesCancel','sunPdfToImagesProgress','sunPdfToImagesStatus',
      'sunPdfToImagesDownloads']
    : ['sunCmpSource','sunCmpTarget','sunCmpPages','sunCmpDpi','sunCmpTolerance','sunCmpImages',
      'sunCmpRun','sunCmpClose','sunCmpStatus','sunCmpProgress','sunCmpResults','sunCmpDownload'];
  for(const id of ids) f.idNodes.set(id,f.make('div'));
  f.idNodes.get(buttonId).disabled = false;
  f.win.showToast=()=>{};
  const fakePdf = {name:'report.pdf',size:20,arrayBuffer:async()=>new ArrayBuffer(20)};
  const engine = {
    normalizeFiles(files) {if(files.length!==1 || files[0].size>100)throw Error('Bad file');return files;},
    normalizeSettings:()=>({format:'png',dpi:150}),
    convert(...values) {args.push(values.at(-1));return new Promise((resolve,reject)=>defers.push({resolve,reject}));},
    packEntries:()=>new Blob([1]),
  };
  f.win.SunrisePdfToImages=engine;
  f.win.SunrisePdfVisualCompare=engine;
  f.win.pdfjsLib={getDocument:()=>{}};
  f.win.openModal=({onMount})=>onMount();
  f.win.closeModal=()=>f.setVisible(false);
  vm.runInNewContext(read(module),{
    window:f.win,Blob,ArrayBuffer,AbortController,DOMException,URLSearchParams,Promise,
    setTimeout,console,
  }, {filename:module});
  f.win[launchName]();
  const run=f.idNodes.get(buttonId);
  if(name==='images') {
    const file=f.idNodes.get('sunPdfToImagesFile');
    file.files=[{name:'huge.pdf',size:500,arrayBuffer:async()=>new ArrayBuffer(500)}];
    file.listeners.change();
    assert.equal(run.disabled,true,'invalid PDF file must disable start');
    file.files=[fakePdf];file.listeners.change();
    assert.equal(run.disabled,false,'valid PDF must enable start');
  } else {
    f.idNodes.get('sunCmpSource').files=[fakePdf];
    f.idNodes.get('sunCmpTarget').files=[fakePdf];
    f.idNodes.get('sunCmpPages').value='all';
    f.idNodes.get('sunCmpDpi').value='96';
    f.idNodes.get('sunCmpTolerance').value='28';
  }
  const pending=run.listeners.click();
  await Promise.resolve();
  assert.equal(defers.length,1,'real convert must be invoked');
  assert.equal(args.length,1);
  assert.equal(args[0].signal.aborted,false);
  assert.equal(args[0].cancelled(),false);
  f.setVisible(false); // Escape/backdrop / another modal, not the feature's close button.
  assert.equal(args[0].signal.aborted,true,'modal dismissal must abort in-flight renderer');
  assert.equal(args[0].cancelled(),true,'cancellation callback must reflect invisible modal');
  defers[0].resolve(name==='images'?{blob:new Blob([1]),count:1,results:[],outputName:'a.zip'}:
    {blob:new Blob([1]),imageCount:1,fileName:'compare.zip',report:{summary:{same:1,different:0,geometry:0,missing:0},rows:[]}});
  await pending;
  const downloads=f.idNodes.get(name==='images'?'sunPdfToImagesDownloads':'sunCmpDownload');
  assert.equal(downloads.children.length,0,'hidden modal must not publish stale ZIP');
  assert.equal(f.observers.at(-1).disconnected,true,'dismissed modal stops observing');
}

(async()=>{
  testPdfInputLimits();
  testBoundedDownload();
  await testNormalZipConversion();
  await testModalConversion('sunrise-pdf-to-images-ui.js','SunrisePdfToImagesLaunch',
    'sunPdfToImagesStart','images');
  await testModalConversion('sunrise-pdf-visual-compare-ui.js','SunrisePdfVisualCompareLaunch',
    'sunCmpRun','compare');
  console.log('PASS R05: PDF input preflight, bounded ZIP URLs, pagehide/error cleanup, modal cancellation and stale output rejection');
})().catch(e=>{console.error(e);process.exitCode=1;});
