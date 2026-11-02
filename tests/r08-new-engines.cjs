const assert=require('node:assert/strict');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const Images=require('../src/assets/sunrise-images-to-pdf.js');
const Geometry=require('../src/assets/sunrise-pdf-page-geometry.js');
const Nup=require('../src/assets/sunrise-pdf-nup.js');
const Overlay=require('../src/assets/sunrise-pdf-overlay.js');
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9bfZV2cAAAAASUVORK5CYII=','base64');
function fakeFile(b,name){return {name,size:b.byteLength,arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}};
(async()=>{
 const logs=[];let pdf=await PDFLib.PDFDocument.create();for(let i=0;i<4;i++){const p=pdf.addPage([595,842]);p.drawText('Page '+(i+1),{x:30,y:790})};let data=await pdf.save();
 const pf=fakeFile(data,'four.pdf');
 const img=await Images.create([fakeFile(image,'p.png')],{page:'a4'},{PDFLib});assert.equal((await PDFLib.PDFDocument.load(img.bytes)).getPageCount(),1);logs.push('images-to-pdf');
 const geom=await Geometry.create(pf,{mode:'crop',margins:{left:3,right:3,top:3,bottom:3},pages:'1'}, {PDFLib}); assert.equal((await PDFLib.PDFDocument.load(geom.bytes)).getPageCount(),4);logs.push('pdf-crop');
 for(const size of [2,4,6,9,16]){const nup=await Nup.create([pf],{nup:size,paper:'a4',pages:'all'},{PDFLib});const nb=nup.bytes||nup.output;assert.equal((await PDFLib.PDFDocument.load(nb)).getPageCount(),Math.ceil(4/size));}logs.push('pdf-nup-2-4-6-9-16');
 const overlay=await Overlay.create(pf,pf,{pages:'1',mapping:'first'},{PDFLib});let ob=overlay.bytes||overlay.output;assert.equal((await PDFLib.PDFDocument.load(ob)).getPageCount(),4);logs.push('pdf-overlay');
 console.log('PASS: stage2 new engines',logs.join(','));
})().catch(e=>{console.error('FAIL: stage2 new engines',e);process.exitCode=1});
