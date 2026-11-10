'use strict';
// R06: verify the real comparison engine checks output size before blob cloning.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const compare=require('../src/assets/sunrise-pdf-visual-compare.js');
const pdf=Uint8Array.from([37,80,68,70,45,49,46,55]);
const file={name:'input.pdf',size:pdf.length,arrayBuffer:async()=>pdf.slice().buffer};
let imageRead=0, zipped=0, destroyed=0, released=0;
const oversized={size:241*1024*1024,type:'image/png',async arrayBuffer(){imageRead++;throw Error('must not clone oversized blob');}};
const mockPdfJs={getDocument(){return {
 promise:Promise.resolve({numPages:1,getPage:async()=>({getViewport:()=>({width:2,height:2}),
    render:()=>({promise:Promise.resolve(),cancel(){}}),cleanup(){released++;}})}),
 async destroy(){destroyed++;}
}}};
let canvasNo=0;
function canvas(){const role=++canvasNo;const result={width:0,height:0, getContext(){return {
 fillRect(){}, putImageData(){},getImageData(){return {width:2,height:2,data:new Uint8ClampedArray(Array.from({length:16},(_,i)=> i%4===3?255:(role===2?200:0)))};}
 };},toBlob(cb){cb(oversized);}};return result;}
const old=global.ImageData;
global.ImageData=class ImageData {constructor(data,width,height){this.data=data;this.width=width;this.height=height;}};
async function testDownloadFeedback(scriptName, imageMode) {
  const nodes=new Map(),file={name:'example.pdf',size:8,arrayBuffer:async()=>pdf.slice().buffer};
  const ids=imageMode?['sunPdfToImagesFile','sunPdfToImagesDrop','sunPdfToImagesFiles','sunPdfToImagesFormat',
   'sunPdfToImagesDpi','sunPdfToImagesPages','sunPdfToImagesQuality','sunPdfToImagesQualityLabel',
   'sunPdfToImagesStart','sunPdfToImagesCancel','sunPdfToImagesProgress','sunPdfToImagesStatus',
   'sunPdfToImagesDownloads']:['sunCmpSource','sunCmpTarget','sunCmpPages','sunCmpDpi','sunCmpTolerance',
   'sunCmpImages','sunCmpRun','sunCmpClose','sunCmpStatus','sunCmpProgress','sunCmpResults','sunCmpDownload'];
  const make=()=>({listeners:{},children:[],disabled:false,textContent:'',value:'all',files:[],
   addEventListener(type,cb){this.listeners[type]=cb;},append(...x){this.children.push(...x);},
   replaceChildren(...x){this.children=[...x];},setAttribute(){},insertAdjacentElement(){}});
  ids.forEach(id=>nodes.set(id,make()));
  nodes.set('modalBackdrop',{classList:{contains:()=>true}});
  const doc={readyState:'loading',createElement:make,head:{append(){}},body:{append(){}},
   addEventListener(){},contains:()=>true,getElementById:key=>nodes.get(key)||null};
  const engine={normalizeFiles:f=>f,normalizeSettings:()=>({}),packEntries:()=>new Blob(['ok']),
   convert:async()=>imageMode?{blob:new Blob(['ok']),count:1,results:[file],outputName:'test.zip'}:
    {blob:new Blob(['ok']),imageCount:1,fileName:'report.zip',report:{rows:[],summary:{same:1,different:0,geometry:0,missing:0}}}};
  const win={document:doc,pdfjsLib:{getDocument(){}},SunrisePdfToImages:engine,
   SunrisePdfVisualCompare:engine,SunriseLocalUI:{downloadBlob(){throw Error('다운로드 차단됨');},watchModal:()=>()=>{}},
   openModal({onMount}){onMount();},closeModal(){},showToast(){},location:{search:''}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/assets',scriptName),'utf8'),
    {window:win,AbortController,Promise,URLSearchParams,console});
  win[imageMode?'SunrisePdfToImagesLaunch':'SunrisePdfVisualCompareLaunch']();
  if(imageMode){nodes.get('sunPdfToImagesFile').files=[file];nodes.get('sunPdfToImagesFile').listeners.change();}
  else{nodes.get('sunCmpSource').files=[file];nodes.get('sunCmpTarget').files=[file];}
  const btn=nodes.get(imageMode?'sunPdfToImagesStart':'sunCmpRun');
  await btn.listeners.click();
  const result=nodes.get(imageMode?'sunPdfToImagesDownloads':'sunCmpDownload').children;
  assert.equal(result.length,1,'successful ZIP must remain available');
  result[0].listeners.click();
  assert.match(nodes.get(imageMode?'sunPdfToImagesStatus':'sunCmpStatus').textContent,/다운로드 차단됨/,
    'download failure must reach user visible status without a page error');
}

(async()=>{
 try{
  await assert.rejects(compare.convert(file,file,{pages:'1',dpi:96,createImages:true},{pdfjsLib:mockPdfJs,createCanvas:canvas,createZip(){zipped++;throw Error('must not zip oversized output');}}),/메모리 보호 한도/);
  assert.equal(imageRead,0,'do not clone oversized encoded PNG');
  assert.equal(zipped,0,'do not pack oversized output');
  assert.equal(destroyed,2,'release both PDF.js documents after guard rejects');
  assert.equal(released,2,'release both rendered pages after guard rejects');
  await testDownloadFeedback('sunrise-pdf-to-images-ui.js',true);
  await testDownloadFeedback('sunrise-pdf-visual-compare-ui.js',false);
  console.log('PASS R06: oversized difference PNG rejected before ArrayBuffer copy and ZIP; resources released; both download UIs show errors');
 }finally{global.ImageData=old;}
})().catch(error=>{console.error(error);process.exitCode=1});
