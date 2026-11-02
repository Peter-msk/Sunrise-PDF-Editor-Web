const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js'),n=lib.PDFName.of;
const src=fs.readFileSync('src/editor/index.html','utf8');
const start=src.indexOf('    function appendPdfBookmarks('),end=src.indexOf('    async function openMergePdfModal(',start);
assert(start>=0&&end>start);
const ctx=vm.createContext({window:{PDFLib:lib,SunriseEditState:{},SunriseKoreanFont:{}},console,Map,Set});
vm.runInContext(src.slice(start,end),ctx);

(async()=>{
 const pdf=await lib.PDFDocument.create(),page=pdf.addPage(),form=pdf.getForm();
 const text=form.createTextField('customer_name');text.addToPage(page);text.setText('Sample Name');
 const box=form.createCheckBox('consent');box.addToPage(page,{x:30,y:300});box.check();
 const original=await pdf.save();
 ctx.doc={bytes:original,metadata:{},attachments:[],bookmarks:[],overlays:[]};
 const result=await vm.runInContext('compileDocumentWithOverlays(doc)',ctx);
 const reopened=await lib.PDFDocument.load(result),saved=reopened.getForm();
 assert.equal(saved.getTextField('customer_name').getText(),'Sample Name');
 assert.equal(saved.getCheckBox('consent').isChecked(),true);
 assert.equal(reopened.getPageCount(),1);
 if(process.env.SUNRISE_TEST_PDF)fs.writeFileSync(process.env.SUNRISE_TEST_PDF,result);

 const xfa=await lib.PDFDocument.create();xfa.addPage();
 xfa.catalog.set(n('AcroForm'),xfa.context.obj({Fields:[],XFA:lib.PDFString.of('fixture-xfa')}));
 ctx.doc={bytes:await xfa.save({updateFieldAppearances:false}),metadata:{},attachments:[],bookmarks:[],overlays:[]};
 const xfaResult=await vm.runInContext('compileDocumentWithOverlays(doc)',ctx);
 const roundtrip=await lib.PDFDocument.load(xfaResult);
 const acro=roundtrip.context.lookup(roundtrip.catalog.get(n('AcroForm')));
 assert(acro.get(n('XFA')),'unchanged XFA is retained in the tested no-overlay save');
 console.log('PASS: basic form values and unchanged XFA survive the tested no-overlay save and reopen');
})().catch(e=>{console.error(e);process.exitCode=1});
