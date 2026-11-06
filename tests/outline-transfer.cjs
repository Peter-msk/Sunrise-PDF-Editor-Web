'use strict';
// Deferred until related functionality implementation is complete.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const api=require('../src/assets/sunrise-outline-transfer.js');
const name=lib.PDFName.of;
const source=fs.readFileSync('src/editor/index.html','utf8');
const start=source.indexOf('    function appendPdfBookmarks(');
const end=source.indexOf('    async function compileDocumentWithOverlays(',start);
assert(start>=0&&end>start);
const ctx=vm.createContext({window:{PDFLib:lib,SunriseOutlineTransfer:api}});
vm.runInContext(source.slice(start,end),ctx);
function append(pdf,list){ctx.pdf=pdf;ctx.items=list;return vm.runInContext('appendPdfBookmarks(pdf,items)',ctx);}
(async()=>{
 const pdf=await lib.PDFDocument.create();
 for(let i=0;i<4;i++)pdf.addPage([400,500]);
 append(pdf,[
  {title:'제1장 개요',page:0,level:0},{title:'조사내용',page:1,level:1},
  {title:'제2장 결론',page:3,level:0}
 ]);
 const bytes=await pdf.save(),src=await lib.PDFDocument.load(bytes),items=api.read(src,lib);
 assert.deepEqual(items.map(x=>[x.title,x.page,x.level]),[
  ['제1장 개요',0,0],['조사내용',1,1],['제2장 결론',3,0]
 ]);
 const selected=api.subset(items,[1,3]);
 assert.deepEqual(selected.map(x=>[x.page,x.level]),[[0,0],[1,0]]);
 const split=await lib.PDFDocument.create();
 (await split.copyPages(src,[1,3])).forEach(page=>split.addPage(page));
 append(split,selected);
 const reopened=await lib.PDFDocument.load(await split.save());
 assert.deepEqual(api.read(reopened,lib).map(x=>[x.title,x.page,x.level]),[
  ['조사내용',0,0],['제2장 결론',1,0]
 ]);
 const merged=await lib.PDFDocument.create();
 (await merged.copyPages(src,[0,1,2,3])).forEach(page=>merged.addPage(page));
 (await merged.copyPages(src,[0,1,2,3])).forEach(page=>merged.addPage(page));
 append(merged,[
  ...api.subset(items,[0,1,2,3],0),
  ...api.subset(items,[0,1,2,3],4)
 ]);
 const twice=await lib.PDFDocument.load(await merged.save());
 assert.deepEqual(api.read(twice,lib).map(x=>x.page),[0,1,3,4,5,7]);
 const deep=await lib.PDFDocument.create();deep.addPage();append(deep,Array.from({length:32},(_,level)=>({title:'Level '+level,page:0,level})));assert.equal(api.read(await lib.PDFDocument.load(await deep.save()),lib).at(-1).level,31);
 const broken=await lib.PDFDocument.create();broken.addPage();
 const root=broken.context.obj({Type:'Outlines'}),rr=broken.context.register(root);
 broken.catalog.set(name('Outlines'),rr);
 const node=broken.context.obj({Title:lib.PDFHexString.fromText('external'),Parent:rr,
  A:{S:'URI',URI:lib.PDFString.of('https://example.org')}});
 const nr=broken.context.register(node);
 root.set(name('First'),nr);root.set(name('Last'),nr);
 assert.throws(()=>api.read(broken,lib),/외부 링크/);
 assert.throws(()=>api.subset(items,[1,1]),/중복/);
 assert(source.includes('sunrise-outline-transfer.js'));
 assert(source.includes('SunriseOutlineTransfer.subset'));
 console.log('PASS: merge, split and extract preserve simple PDF bookmarks; unsafe external action rejected');
})().catch(e=>{console.error(e);process.exitCode=1});
