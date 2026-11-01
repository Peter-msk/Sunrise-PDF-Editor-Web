'use strict';
// Batch-completion gate only. Do not execute during code-first continuous development.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const korean=require('../dist/assets/korean-font.js');
const fontData={
  bytes:new Uint8Array(fs.readFileSync('dist/assets/fonts/DroidSansFallback.ttf')),
  metrics:JSON.parse(fs.readFileSync('dist/assets/fonts/DroidSansFallback.metrics.json','utf8'))
};
const source=fs.readFileSync('src/editor/index.html','utf8');
const from=source.indexOf('    function editablePdfForm(');
const to=source.indexOf('    async function openFillFormFieldModal(',from);
assert(from>=0&&to>from,'Form editing region missing');
let fontEmbeds=0;
const ctx=vm.createContext({
 window:{PDFLib:lib,SunriseKoreanFont:{embed:(pdf,texts)=>{
   fontEmbeds++;return korean.embed(pdf,texts,fontData);
 }}},
 Error,Number,Set,Map,Date,
 beginOperationMetric:()=>()=>{}
});
vm.runInContext(source.slice(from,to),ctx);
(async()=>{
  const pdf=await lib.PDFDocument.create(),page=pdf.addPage([450,620]);
  const form=pdf.getForm();
  const a=form.createTextField('신청자');a.addToPage(page,{x:20,y:200,width:180,height:25});a.setText('기존');
  const b=form.createTextField('담당자');b.addToPage(page,{x:20,y:240,width:180,height:25});b.setText('담당');
  const box=form.createCheckBox('동의');box.addToPage(page,{x:20,y:280,width:18,height:18});
  const locked=form.createTextField('읽기전용');locked.addToPage(page,{x:20,y:330,width:180,height:25});locked.setText('유지');locked.enableReadOnly();
  const original=await pdf.save({updateFieldAppearances:false});
  const values=[{name:'신청자',value:'홍길동'},{name:'담당자',value:'김하늘'},{name:'동의',value:true}];
  const modified=await ctx.updatePdfFormFields(original,values);
  assert.equal(fontEmbeds,1,'Korean font should be embedded only once for the whole batch');
  assert.notDeepEqual([...modified],[...original],'output must be new serialized PDF');
  const doc=await lib.PDFDocument.load(modified),saved=doc.getForm();
  assert.equal(saved.getTextField('신청자').getText(),'홍길동');
  assert.equal(saved.getTextField('담당자').getText(),'김하늘');
  assert.equal(saved.getCheckBox('동의').isChecked(),true);
  assert.equal(saved.getTextField('읽기전용').getText(),'유지');
  assert.equal(doc.getPageCount(),1);
  const unchanged=await lib.PDFDocument.load(original);
  assert.equal(unchanged.getForm().getTextField('신청자').getText(),'기존');
  assert.equal(unchanged.getForm().getCheckBox('동의').isChecked(),false);
  const cases=[
    [[],/1~100/],
    [[{name:'신청자',value:'A'},{name:'신청자',value:'B'}],/중복/],
    [[{name:'미존재',value:'A'}],/존재하지/],
    [[{name:'읽기전용',value:'변경'}],/읽기 전용/],
    [[{name:'동의',value:'yes'}],/참 또는 거짓/],
    [[{name:'담당자',value:true}],/1000자/],
    [[{name:'신청자',value:'a'.repeat(1001)}],/1000자/],
    [[{name:'신청자',value:'good'},{name:'담당자',value:'bad\u0000'}],/제어 문자/]
  ];
  for(const [changes,pattern] of cases){
    await assert.rejects(ctx.updatePdfFormFields(original,changes),pattern);
  }
  const signed=await lib.PDFDocument.create();signed.addPage();
  signed.catalog.set(lib.PDFName.of('Perms'),signed.context.obj({}));
  await assert.rejects(ctx.updatePdfFormFields(await signed.save(),[{name:'신청자',value:'x'}]),/서명/);
  const xfa=await lib.PDFDocument.create();xfa.addPage();
  xfa.catalog.set(lib.PDFName.of('AcroForm'),xfa.context.obj({Fields:[],XFA:lib.PDFString.of('xfa')}));
  await assert.rejects(ctx.updatePdfFormFields(await xfa.save(),[{name:'신청자',value:'x'}]),/XFA/);
  assert(source.includes('id: "fillAllFormFields"'),'Ribbon action must exist');
  assert(source.includes('case "fillAllFormFields":'),'Command dispatch must exist');
  assert(source.includes('await verifySavedPdfBytes(captured.snapshot.bytes,nextBytes)'),'Precommit save check must exist');
  console.log('PASS: atomic batch AcroForm edit, shared Unicode font, readonly, XFA/signature, invalid value, original unchanged');
})().catch(e=>{console.error(e);process.exitCode=1});
