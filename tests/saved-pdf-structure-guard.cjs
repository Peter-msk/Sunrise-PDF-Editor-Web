'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const source=fs.readFileSync('src/editor/index.html','utf8');
const from=source.indexOf('    async function verifySavedPdfBytes(');
const to=source.indexOf('    function openSavedPdfCheckModal()',from);
assert(from>0 && to>from,'save structure guard must remain in editor');
const context=vm.createContext({
 window:{PDFLib},
 validatePdfByteLength:n=>{if(!Number.isSafeInteger(n)||n<10)throw Error('bytes missing');},
 verifyPdfPageGeometry:(a,b)=>{assert.equal(a.getPageCount(),b.getPageCount());}
});
vm.runInContext(source.slice(from,to),context);
const n=PDFLib.PDFName.of;
(async()=>{
 const original=await PDFLib.PDFDocument.create(),page=original.addPage([400,500]);
 const dict=original.context.obj({Type:'Annot',Subtype:'Text',Rect:[10,10,40,30],
  Contents:PDFLib.PDFHexString.fromText('한글 검토')});
 page.node.addAnnot(original.context.register(dict));
 const bytes=await original.save();
 await context.verifySavedPdfBytes(bytes,bytes);
 const changed=await PDFLib.PDFDocument.load(bytes);
 changed.getPage(0).node.Annots().remove(0);
 changed.getPage(0).node.delete(n('Annots'));
 const noAnnot=await changed.save();
 await assert.rejects(context.verifySavedPdfBytes(bytes,noAnnot),/원본 주석/);
 await context.verifySavedPdfBytes(bytes,noAnnot,{allowAnnotationChanges:true});
 const srcWithNames=await PDFLib.PDFDocument.load(bytes);
 srcWithNames.catalog.set(n('Names'),srcWithNames.context.obj({Dests:{}}));
 const sourceNames=await srcWithNames.save();
 await assert.rejects(context.verifySavedPdfBytes(sourceNames,bytes),/Names/);
 console.log('PASS: native annotation and catalog structure preservation on normal PDF saves');
})().catch(e=>{console.error(e);process.exitCode=1});
