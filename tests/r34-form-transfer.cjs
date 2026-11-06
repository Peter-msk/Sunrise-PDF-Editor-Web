'use strict';
const assert=require('node:assert/strict');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const core=require('../src/assets/sunrise-pdf-form-tools.js');
const n=lib.PDFName.of;
async function fixture(value){
 const p=await lib.PDFDocument.create();p.addPage([400,600]);p.addPage([600,400]);p.getPage(1).setRotation(lib.degrees(90));
 await p.attach(new TextEncoder().encode(value),'shared.txt',{mimeType:'text/plain'});
 const f=p.getForm();
 const text=f.createTextField('person.name');text.setText(value);text.addToPage(p.getPage(0),{x:20,y:40,width:100,height:20});text.addToPage(p.getPage(1),{x:25,y:40,width:100,height:20});
 const check=f.createCheckBox('approved');check.addToPage(p.getPage(0));check.check();
 const radio=f.createRadioGroup('choice');radio.addOptionToPage('A',p.getPage(0));radio.addOptionToPage('B',p.getPage(1));radio.select('A');
 return lib.PDFDocument.load(await p.save());
}
async function roundtrip(p){return lib.PDFDocument.load(await p.save({updateFieldAppearances:false}));}
async function main(){
 const a=await fixture('FIRST'),b=await fixture('SECOND'),out=await lib.PDFDocument.create();
 await core.transferPages(a,out,[0,1],lib);await core.transferPages(b,out,[0,1],lib);
 const saved=await roundtrip(out),form=saved.getForm();
 assert.equal(saved.getPageCount(),4);assert.equal(form.getTextField('Document1.person.name').getText(),'FIRST');assert.equal(form.getTextField('Document2.person.name').getText(),'SECOND');
 assert(form.getCheckBox('Document1.approved').isChecked());assert.equal(saved.getPage(3).getRotation().angle,90);
 const names=saved.context.lookup(saved.catalog.get(n('Names'))),fileTree=saved.context.lookup(names.get(n('EmbeddedFiles'))),fileNames=saved.context.lookup(fileTree.get(n('Names')));
 assert.equal(fileNames.size(),4);assert.notEqual(fileNames.get(0).decodeText(),fileNames.get(2).decodeText());
 for(let i=1;i<fileNames.size();i+=2){const spec=saved.context.lookup(fileNames.get(i)),ef=saved.context.lookup(spec.get(n('EF'))),file=saved.context.lookup(ef.get(n('F')));assert(['FIRST','SECOND'].includes(new TextDecoder().decode(lib.decodePDFRawStream(file).decode())));}
 const allPageRefs=new Set(saved.getPages().map(p=>p.ref.toString()));
 for(const field of form.getFields())for(const w of field.acroField.getWidgets())assert(allPageRefs.has(w.dict.get(n('P')).toString()),'widget page must be in output page tree');
 const part=await lib.PDFDocument.create();await core.transferPages(a,part,[1],lib);
 const result=await roundtrip(part),f=result.getForm();
 assert.equal(result.getPageCount(),1);assert.equal(f.getFields().length,2);assert.equal(f.getTextField('Document1.person.name').acroField.getWidgets().length,1);
 assert.equal(f.getTextField('Document1.person.name').getText(),'FIRST');
 f.getTextField('Document1.person.name').setText('EDITED');
 const edited=await lib.PDFDocument.load(await result.save());assert.equal(edited.getForm().getTextField('Document1.person.name').getText(),'EDITED');
 assert.equal(a.getForm().getTextField('person.name').acroField.getWidgets().length,2,'source must remain reusable for next split');
 const cycle=await fixture('CYCLE');const field=cycle.getForm().getTextField('person.name');field.acroField.dict.set(n('Kids'),cycle.context.obj([field.ref]));
 await assert.rejects(core.transferPages(cycle,await lib.PDFDocument.create(),[0],lib),/순환|구조/);
 console.log('R34 form transfer: editable merge, collision isolation, partial extraction, radio, source reuse, cycle rejection passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
