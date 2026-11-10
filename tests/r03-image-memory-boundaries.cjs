'use strict';
// R03: Errors and stabilization are one release gate: reject dangerous inputs
// before allocation, preserve conversion cleanup on failure, and retain normal outputs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Images = require('../src/assets/sunrise-images-to-pdf.js');
const PDFLib = require('../dist/assets/pdf-lib/pdf-lib.min.js');
const MiB = 1024 * 1024;
function file(bytes,name='photo.png') {
  return {name,size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};
}
function descriptor(size,name='photo.jpg') {
  let reads=0;
  return {name,size,arrayBuffer:async()=>{reads++;throw Error('Must not read over-limit file');}, get reads(){return reads;}};
}
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9bfZV2cAAAAASUVORK5CYII=','base64');
(async()=>{
  // No bytes should be read or allocated before total and per-file preflight.
  assert.throws(()=>Images.normalizeFiles([descriptor(40*MiB)]), /32|용량|크기/);
  const many=Array.from({length:5},(_,i)=>descriptor(30*MiB,'large'+i+'.jpg'));
  assert.throws(()=>Images.normalizeFiles(many),/120|용량|합계/);
  assert(many.every(x=>x.reads===0));
  // Tiny, forged PNG with 45000x45000 IHDR must be rejected before pdf-lib allocates.
  const massive=Uint8Array.from([...png]);
  massive[16]=0;massive[17]=0;massive[18]=0xaf;massive[19]=0xc8;
  massive[20]=0;massive[21]=0;massive[22]=0xaf;massive[23]=0xc8;
  let embeds=0;
  const mock={PDFDocument:{load:async()=>null,create:async()=>({setTitle(){},setCreator(){},embedPng:async()=>{embeds++;throw Error('Unsafe embedded image');}})}};
  await assert.rejects(Images.create([file(massive)],{page:'a4'},{PDFLib:mock}),/픽셀|해상도|이미지.*크기/);
  assert.equal(embeds,0,'Oversized decoded dimensions should be rejected before embedding');
  // WebP VP8X and JPEG SOF dimensions must be inspected before decoding.
  const hugeWebp=new Uint8Array(30);
  hugeWebp.set(Buffer.from('RIFF'),0);
  hugeWebp.set(Buffer.from('WEBP'),8);
  hugeWebp.set(Buffer.from('VP8X'),12);
  hugeWebp[24]=0x5f;hugeWebp[25]=0xea; // 60000px width (minus one)
  hugeWebp[27]=0x5f;hugeWebp[28]=0xea;
  let converts=0;
  await assert.rejects(Images.create([file(hugeWebp,'huge.webp')],{page:'a4'},
    {PDFLib:mock,browserConvert:async()=>{converts++;return png;}}),/해상도/);
  assert.equal(converts,0,'Oversized WebP must be stopped before createImageBitmap');
  const hugeJpeg=Uint8Array.from([255,216,255,192,0,17,8,0x9c,0x40,0x9c,0x40,
    3,1,0x11,0,2,0x11,0,3,0x11,0,255,217]);
  await assert.rejects(Images.create([file(hugeJpeg,'huge.jpg')],{page:'a4'},
    {PDFLib:mock}),/해상도/);
  assert.equal(embeds,0,'Oversized frame should not be embedded');
  // Several individually acceptable images must still obey the decoded-pixel budget.
  const fakeJpg=Uint8Array.from([255,216,255,217,0,0,0,0,0,0,0,0]);
  let jpegEmbeds=0;
  const manyJpegs={PDFDocument:{load:async()=>null,create:async()=>({setTitle(){},setCreator(){},
    embedJpg:async()=>{jpegEmbeds++;return {width:5000,height:7000};},
    addPage:()=>({drawImage(){}})})}};
  await assert.rejects(Images.create(Array.from({length:6},(_,i)=>file(fakeJpg,`j${i}.jpg`)),
    {page:'a4'},{PDFLib:manyJpegs}),/해상도 합계/);
  assert.equal(jpegEmbeds,6,'Pixel budget should stop the sixth 35MP image');
  // Normal one-page PNG remains supported.
  const output=await Images.create([file(png)],{page:'a4'},{PDFLib});
  assert.equal((await PDFLib.PDFDocument.load(output.bytes)).getPageCount(),1);
  // Conversion failure must release canvas backing store AND close ImageBitmap.
  const source=fs.readFileSync(path.join(__dirname,'../src/assets/sunrise-images-to-pdf-ui.js'),'utf8')
    .replace('  function launch() {','  root.__r03TestBrowserConvert = browserConvert;\n  function launch() {');
  let canvas=null,closed=0;
  const win={document:{readyState:'loading',addEventListener(){},getElementById(){return null},
    createElement(tag){assert.equal(tag,'canvas');canvas={width:0,height:0,
      getContext:()=>({drawImage(){}}),toBlob(callback){callback(null);}};return canvas;}},
    createImageBitmap:async()=>({width:100,height:100,close(){closed++;}})};
  vm.runInNewContext(source,{window:win,Uint8Array,Promise,URLSearchParams,console}, {filename:'sunrise-images-to-pdf-ui.js'});
  await assert.rejects(win.__r03TestBrowserConvert({}),/PNG로 변환/);
  assert.equal(closed,1,'ImageBitmap should close on failed conversion');
  assert.equal(canvas.width,0,'Failed conversion must release canvas pixels');
  assert.equal(canvas.height,0,'Failed conversion must release canvas pixels');
  // Oversized encoded PNG must be rejected before allocating an ArrayBuffer.
  let decoded=false;
  win.document.createElement=(tag)=>{canvas={width:0,height:0,
    getContext:()=>({drawImage(){}}),toBlob(callback){callback({size:33*MiB,
      arrayBuffer:async()=>{decoded=true;return new ArrayBuffer(0);}});}};return canvas;};
  await assert.rejects(win.__r03TestBrowserConvert({}),/32MB/);
  assert.equal(decoded,false,'Must not read oversized converted blob');
  assert.equal(canvas.width,0,'Oversized output must also release Canvas');
  // User-facing workflow: invalid selection must disable the create button,
  // not just display an error and leave a clickable action behind.
  const ids={};
  const makeElement=tag=>({tagName:tag,listeners:{},children:[],style:{},
    addEventListener(kind,fn){this.listeners[kind]=fn;},setAttribute(){},
    append(...items){this.children.push(...items);},replaceChildren(){this.children=[];}});
  for(const id of ['sunImagesInput','sunImagesOrder','sunImagesStatus','sunImagesProgress',
    'sunImagesMake','sunImagesCancel','sunImagesDownload','sunImagesSize',
    'sunImagesOrientation','sunImagesMargin']) ids[id]=makeElement('div');
  ids.sunImagesStatus.firstChild={textContent:''};
  ids.sunImagesMake.disabled=true;
  ids.sunImagesSize.value='a4';ids.sunImagesOrientation.value='auto';ids.sunImagesMargin.value='8';
  const browserDoc={readyState:'loading',addEventListener(){},head:{append(){}},contains:()=>true,
    getElementById(id){return id==='sunriseImagesPdfStyle'?{}:ids[id]||null;},
    createElement:makeElement};
  const browserWin={document:browserDoc,SunriseImagesToPdf:Images,PDFLib,
    openModal({onMount}){onMount();},closeModal(){},downloadBytes(){}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/assets/sunrise-images-to-pdf-ui.js'),'utf8'),
    {window:browserWin,URLSearchParams,console,Uint8Array,Promise}, {filename:'images-to-pdf-ui.js'});
  browserWin.SunriseImagesToPdfLaunch();
  ids.sunImagesInput.files=[descriptor(40*MiB)];
  ids.sunImagesInput.listeners.change();
  assert.equal(ids.sunImagesMake.disabled,true,'Invalid input must not enable create button');
  ids.sunImagesInput.files=[file(png)];
  ids.sunImagesInput.listeners.change();
  assert.equal(ids.sunImagesMake.disabled,false,'Valid input should enable create button');
  console.log('PASS R03: size preflight, PNG decompression-bomb guard, cleanup on failure, normal output');
})().catch(error=>{console.error(error);process.exitCode=1;});
