'use strict';
// One cohesive implementation acceptance test: AcroForm date, 32-level
// outlines and PDF page label transfer. Uses actual serialized PDFs.
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const forms=require('../src/assets/sunrise-pdf-form-tools.js');
const bookmark=require('../src/assets/sunrise-auto-bookmarks.js');
const bytesEqual=(a,b)=>Buffer.from(a).equals(Buffer.from(b));
const fileOf=(bytes)=>({size:bytes.length,name:'input.pdf'});
const options=(bytes)=>({PDFLib:lib,readFile:async()=>bytes});
async function formDateTest(){
  const pdf=await lib.PDFDocument.create();pdf.addPage([400,600]);
  const original=await pdf.save();
  const add={action:'add',type:'date',name:'project.date',page:1,x:30,y:350,width:130,height:25,value:'2024-02-29'};
  const created=await forms.apply(fileOf(original),[add],options(original));
  assert(!bytesEqual(created.bytes,original));
  const saved=await lib.PDFDocument.load(created.bytes);
  assert.equal(saved.getForm().getTextField('project.date').getText(),'2024-02-29');
  const inspected=await forms.inspect(fileOf(created.bytes),options(created.bytes));
  assert.equal(inspected.fields[0].type,'date');
  const modify=await forms.apply(fileOf(created.bytes),[{action:'set',name:'project.date',value:'2026-11-07'}],options(created.bytes));
  assert.equal((await lib.PDFDocument.load(modify.bytes)).getForm().getTextField('project.date').getText(),'2026-11-07');
  for(const invalid of ['2026-02-29','2026-13-01','0000-01-01','2026-2-1','2026-04-31']){
    await assert.rejects(forms.apply(fileOf(created.bytes),[{action:'set',name:'project.date',value:invalid}],options(created.bytes)),/날짜/);
  }
  assert.equal((await lib.PDFDocument.load(created.bytes)).getForm().getTextField('project.date').getText(),'2024-02-29');
  await assert.rejects(forms.apply(fileOf(original),[{...add,value:'2026-02-30'}],options(original)),/날짜/);
  await assert.rejects(forms.apply(fileOf(original),[{...add,multiline:true}],options(original)),/여러 줄/);
  assert(forms.SUPPORTED_FIELD_TYPES.includes('date'));
}
function makeLabels(pdf,list){
  const dst=pdf.context;const n=lib.PDFName.of;
  pdf.catalog.set(n('PageLabels'),dst.register(dst.obj({Nums:list.flatMap(([idx,style,prefix,st])=>[
    idx,dst.obj({S:n(style),P:lib.PDFHexString.fromText(prefix),St:st})
  ])})));
}
function getLabels(pdf){
  const ctx=pdf.context,n=lib.PDFName.of;
  const nums=ctx.lookup(ctx.lookup(pdf.catalog.get(n('PageLabels'))).get(n('Nums')));
  return Array.from({length:nums.size()/2},(_,i)=>{
    const entry=ctx.lookup(nums.get(i*2+1));
    return {idx:ctx.lookup(nums.get(i*2)).asNumber(),
      style:entry.get(n('S'))?.toString(),prefix:ctx.lookup(entry.get(n('P')))?.decodeText()??null,
      st:ctx.lookup(entry.get(n('St'))).asNumber()};
  });
}
async function pageLabelsTest(){
  const src=await lib.PDFDocument.create();for(let i=0;i<4;i++)src.addPage([300+i,500]);
  makeLabels(src,[[0,'r','서문-',1],[2,'D','본문-',10]]);
  const srcBytes=await src.save({useObjectStreams:false});
  const source=await lib.PDFDocument.load(srcBytes),target=await lib.PDFDocument.create();
  await forms.transferPages(source,target,[1,3],lib);
  assert.equal(target.getPageCount(),2);
  assert.deepEqual(getLabels(target),[
    {idx:0,style:'/r',prefix:'서문-',st:2},
    {idx:1,style:'/D',prefix:'본문-',st:11}
  ]);
  const unlabeled=await lib.PDFDocument.create();unlabeled.addPage([400,600]);
  await forms.transferPages(unlabeled,target,[0],lib);
  assert.deepEqual(getLabels(target).at(-1),{idx:2,style:'/D',prefix:null,st:1});
  const after=await lib.PDFDocument.load(await target.save({useObjectStreams:false}));
  assert.deepEqual(getLabels(after),getLabels(target));
  const unchanged=await lib.PDFDocument.load(srcBytes);
  assert.deepEqual(getLabels(unchanged),[{idx:0,style:'/r',prefix:'서문-',st:1},{idx:2,style:'/D',prefix:'본문-',st:10}]);
  const bad=await lib.PDFDocument.create();bad.addPage();makeLabels(bad,[[0,'Unsupported','x',1]]);
  await assert.rejects(forms.transferPages(bad,await lib.PDFDocument.create(),[0],lib),/지원하지 않는 페이지 번호/);
}
function outlineTest(){
  assert.equal(bookmark.MAX_OUTLINE_LEVEL,31);
  const entries=Array.from({length:32},(_,i)=>({title:'제목 '+i,page:i,level:i}));
  assert.equal(bookmark.normalizeLevels(entries)[31].level,31);
  const out=bookmark.removeSubtree(entries,20);
  assert.equal(out.removedCount,12);
  assert.equal(out.bookmarks.length,20);
  assert.equal(bookmark.changeLevel(entries,31,1),null);
  assert.equal(bookmark.inferLevel('1.2.3.4.5.6.7.8.9.10 상세'),9);
}
(async()=>{await formDateTest(); await pageLabelsTest(); outlineTest(); console.log('PASS: date AcroForm re-edit, page-label merge/reorder, 32-level outline, original byte preservation');})().catch(err=>{console.error(err);process.exitCode=1});
