'use strict';
// R17: standalone PDF form output must preserve page geometry and every field
// state; corrupted simulated saved documents must not become downloadable bytes.
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const tool=require('../src/assets/sunrise-pdf-form-tools.js');
const n=lib.PDFName.of;

async function fixture(){
 const pdf=await lib.PDFDocument.create();
 const first=pdf.addPage([420,595]);first.setCropBox(8,16,390,550);
 first.setTrimBox(12,20,380,540);
 const second=pdf.addPage([595,420]);second.setRotation(lib.degrees(90));
 const form=pdf.getForm();
 const text=form.createTextField('owner');text.addToPage(first,{x:30,y:160,width:180,height:30});text.setText('Original');
 const agree=form.createCheckBox('approved');agree.addToPage(first,{x:30,y:220,width:20,height:20});
 const region=form.createDropdown('region');region.addOptions(['North','South']);
 region.addToPage(first,{x:30,y:270,width:180,height:30});region.select('North');
 const locked=form.createTextField('lock');locked.addToPage(first,{x:30,y:320,width:180,height:30});
 locked.setText('Keep');locked.enableReadOnly();
 return Uint8Array.from(await pdf.save({updateFieldAppearances:false}));
}

(async()=>{
 const original=await fixture(),originalSnapshot=Uint8Array.from(original);
 const file={name:'form.pdf',size:original.byteLength};
 const opts={PDFLib:lib,readFile:async()=>Uint8Array.from(original)};
 const changes=[
  {action:'set',name:'owner',value:'Updated'},
  {action:'set',name:'approved',value:true},
  {action:'set',name:'region',value:'South'}
 ];
 const result=await tool.apply(file,changes,opts);
 assert.equal(result.pageCount,2);assert.equal(result.fieldCount,4);
 assert(result.bytes.length>100);
 const reopened=await lib.PDFDocument.load(result.bytes),form=reopened.getForm();
 assert.equal(form.getTextField('owner').getText(),'Updated');
 assert.equal(form.getCheckBox('approved').isChecked(),true);
 assert.deepEqual(form.getDropdown('region').getSelected(),['South']);
 assert.equal(form.getTextField('lock').getText(),'Keep');
 assert.equal(form.getTextField('lock').isReadOnly(),true);
 assert.equal(reopened.getPage(0).getCropBox().x,8);
 assert.equal(reopened.getPage(0).getTrimBox().y,20);
 assert.equal(reopened.getPage(1).getRotation().angle,90);
 assert.deepEqual(original,originalSnapshot,'Input source must never be rewritten');
 const source=await lib.PDFDocument.load(original);
 assert.equal(source.getForm().getTextField('owner').getText(),'Original');
 assert.equal(source.getForm().getCheckBox('approved').isChecked(),false);

 for(const [name,mutate,pattern] of [
  ['field-text',doc=>doc.getForm().getTextField('owner').setText('Tampered'),/필드 값·속성/],
  ['field-flag',doc=>doc.getForm().getTextField('lock').disableReadOnly(),/필드 값·속성/],
  ['dropdown',doc=>doc.getForm().getDropdown('region').select('North'),/필드 값·속성/],
  ['field-count',doc=>doc.getForm().removeField(doc.getForm().getCheckBox('approved')),/필드 수/],
  ['page-count',doc=>doc.removePage(1),/페이지 수/],
  ['cropbox',doc=>doc.getPage(0).setCropBox(12,16,386,550),/getCropBox/],
  ['trimbox',doc=>doc.getPage(0).setTrimBox(12,22,380,538),/getTrimBox/],
  ['rotation',doc=>doc.getPage(1).setRotation(lib.degrees(180)),/회전값/]
 ]){
  let calls=0;
  const injected={...lib,PDFDocument:{
   load:async(bytes,options)=>{
    const doc=await lib.PDFDocument.load(bytes,options);
    if(++calls===2)mutate(doc);
    return doc;
   }
  }};
  await assert.rejects(tool.apply(file,changes,{...opts,PDFLib:injected}),pattern,
   name+' corrupted saved document must be withheld');
 }
 let cancelled=false;
 await assert.rejects(tool.apply(file,changes,{
  ...opts,cancelled:()=>cancelled,onProgress:()=>{cancelled=true;}
 }),error=>error.name==='AbortError','cancelled output must never be returned');
 assert.deepEqual(original,originalSnapshot);
 console.log('PASS: standalone form values, flags, five page boxes and rotation verified after save; corruption/cancel blocked');
})().catch(error=>{console.error(error);process.exitCode=1});
