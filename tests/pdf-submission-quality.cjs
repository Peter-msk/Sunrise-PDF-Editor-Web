const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const quality=require('../src/assets/sunrise-pdf-quality.js');
const testOPS={showText:10,paintImageXObject:20,constructPath:30,fill:40};
const pdfjsStub=lists=>({
  OPS:testOPS,
  getDocument(){
    return {promise:Promise.resolve({
      getPage:async index=>({
        getOperatorList:async()=>({fnArray:lists[index-1]}),
        cleanup:()=>{}
      }),
      destroy:async()=>{}
    }),destroy:async()=>{}};
  }
});
(async()=>{
 const pdf=await PDFLib.PDFDocument.create();
 pdf.addPage([420,595]);
 pdf.addPage([595,420]);
 const initial=await pdf.save({updateFieldAppearances:false});
 const original=Uint8Array.from(initial);
 const inspected=await quality.inspect(initial,{
   PDFLib,pdfjsLib:pdfjsStub([[],[testOPS.paintImageXObject]]),maxPages:5
 });
 assert.equal(inspected.pageCount,2);
 assert.equal(inspected.orientation.portrait,1);
 assert.equal(inspected.orientation.landscape,1);
 assert.equal(inspected.scannedPages,2);
 assert.equal(inspected.blankCandidates,1,'textless image is not a blank page');
 assert(inspected.issues.some(x=>x.code==='blank-candidate'&&x.page===1));
 assert(inspected.issues.some(x=>x.code==='mixed-orientation'));
 assert.equal(inspected.status,'review');
 assert.deepEqual([...initial],[...original],'inspection must not mutate uploaded bytes');
 const unknown=await quality.inspect(initial,{PDFLib});
 assert.equal(unknown.scannedPages,0);
 assert.equal(unknown.blankCandidates,0,'without render engine blank status must remain unknown');
 assert.equal(unknown.renderUnknown,true);
 assert(unknown.issues.some(x=>x.code==='render-inspection-unavailable'));
 const partial=await quality.inspect(initial,{PDFLib,pdfjsLib:pdfjsStub([[],[testOPS.paintImageXObject]]),maxPages:1});
 assert.equal(partial.scannedPages,1);
 assert(partial.issues.some(x=>x.code==='partial-scan'));
 const formPdf=await PDFLib.PDFDocument.create();
 const formPage=formPdf.addPage([420,595]);
 const field=formPdf.getForm().createTextField('client-required');
 field.addToPage(formPage,{x:20,y:250,width:180,height:30});field.enableRequired();
 const formBytes=await formPdf.save({updateFieldAppearances:false});
 const formResult=await quality.inspect(formBytes,{PDFLib,pdfjsLib:pdfjsStub([[testOPS.showText]])});
 assert.equal(formResult.formFields,1);
 assert.equal(formResult.emptyRequired,1);
 assert(formResult.issues.some(x=>x.code==='required-field'));
 const filled=await PDFLib.PDFDocument.load(formBytes);
 filled.getForm().getTextField('client-required').setText('Kim');
 const filledBytes=await filled.save();
 const filledResult=await quality.inspect(filledBytes,{PDFLib,pdfjsLib:pdfjsStub([[testOPS.showText]])});
 assert.equal(filledResult.emptyRequired,0);
 const malformedFont=await PDFLib.PDFDocument.create();
 const fontPage=malformedFont.addPage([420,595]);
 fontPage.node.set(PDFLib.PDFName.of('Resources'),malformedFont.context.obj({Font:{Broken:{Type:'NotFont'}}}));
 const fontResult=await quality.inspect(await malformedFont.save(),{PDFLib});
 assert(fontResult.issues.some(x=>x.code==='font-unresolved'),'invalid font resource must trigger review, not approval');
 const xfaPdf=await PDFLib.PDFDocument.create();
 xfaPdf.addPage([420,595]);
 xfaPdf.getForm().createTextField('invoice').addToPage(xfaPdf.getPage(0));
 const acro=xfaPdf.context.lookup(xfaPdf.catalog.get(PDFLib.PDFName.of('AcroForm')));
 acro.set(PDFLib.PDFName.of('XFA'),xfaPdf.context.obj('XFA'));
 const xfaResult=await quality.inspect(await xfaPdf.save({useObjectStreams:false}),{PDFLib});
 assert(xfaResult.issues.some(x=>x.code==='xfa-form'),'unsupported XFA requires explicit manual review');
 const signed=await PDFLib.PDFDocument.create();signed.addPage([420,595]);
 signed.catalog.set(PDFLib.PDFName.of('Perms'),signed.context.obj({DocMDP:PDFLib.PDFName.of('Approval')}));
 const signatureResult=await quality.inspect(await signed.save(),{PDFLib,pdfjsLib:pdfjsStub([[testOPS.showText]])});
 assert(signatureResult.issues.some(x=>x.code==='signature'),'signature validity must not be silently approved');
 const small=await PDFLib.PDFDocument.create();small.addPage([50,50]);
 const smallResult=await quality.inspect(await small.save(),{PDFLib});
 assert(smallResult.issues.some(x=>x.code==='unusual-page-size'));
 const plain=await PDFLib.PDFDocument.load(initial);
 assert.equal(plain.catalog.get(PDFLib.PDFName.of('AcroForm')),undefined);
 await assert.rejects(quality.inspect(new Uint8Array([1,2,3]),{PDFLib}));
 await assert.rejects(quality.inspect(new Uint8Array(0),{PDFLib}));
 await assert.rejects(quality.inspect(initial,{PDFLib,pdfjsLib:pdfjsStub([[],[]]),cancelled:()=>true}),/취소/);
 const editor=fs.readFileSync('src/editor/index.html','utf8');
 const build=fs.readFileSync('scripts/build-release.cjs','utf8');
 assert(editor.includes('/assets/sunrise-pdf-quality.js'));
 assert(editor.includes('window.SunrisePdfQuality.inspect(bytes'));
 assert(editor.includes('row.textContent ='));
 assert(editor.includes('빈 페이지는 확정이 아닌 후보'));
 assert(build.includes("'sunrise-pdf-quality.js'"));
 assert(!editor.includes('SunrisePdfQualityOCR'),'OCR must stay excluded');
 console.log('PASS: pre-submit geometry, mixed orientation, image-vs-blank candidates, required forms, signatures, unscanned-page warnings, cancel and read-only source');
})().catch(e=>{console.error(e);process.exitCode=1});
