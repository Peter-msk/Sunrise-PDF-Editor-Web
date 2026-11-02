// Integration: exercise the production batch compressor with real PDF bytes,
// serialize results to disk and reopen them. No browser download is simulated.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const source=fs.readFileSync('src/editor/index.html','utf8');
const start=source.indexOf('    function pdfCompressionSettings(');
const end=source.indexOf('    function openBatchCompressModal(',start);
assert(start>=0&&end>start,'Production compressor function anchors must exist');
const context=vm.createContext({
 window:{PDFLib:lib},CompressionStream,DecompressionStream,Blob,Response,Uint8Array,ArrayBuffer,
 Number,Map,Set,Error,console,
 readPdfInputFile:async file=>file.bytes,
 editablePdfForm:pdf=>{
  if(pdf.catalog.get(lib.PDFName.of('Perms')))throw Error('서명 문서 보호');
  return pdf.getForm();
 }
});
vm.runInContext(source.slice(start,end),require('./helpers/editor-metrics.cjs')(context));
(async()=>{
 const form=await lib.PDFDocument.create();
 form.setTitle('Batch Integrity Fixture');
 const a=form.addPage([420,610]),b=form.addPage([600,420]);
 b.setRotation(lib.degrees(90));
 a.drawText('Repeated company report '.repeat(15),{x:20,y:570,size:9});
 const text=form.getForm().createTextField('applicant');
 text.addToPage(a,{x:35,y:470,width:175,height:24});text.setText('Tester');
 const check=form.getForm().createCheckBox('approved');
 check.addToPage(a,{x:35,y:420,width:18,height:18});check.check();
 const input=await form.save({updateFieldAppearances:false});
 const files=[{name:'real-form.pdf',size:input.byteLength,bytes:input},
  {name:'corrupt.pdf',size:3,bytes:new Uint8Array([1,2,3])},
  {name:'second-form.pdf',size:input.byteLength,bytes:input}];
 const results=[],errors=[],progress=[];
 await context.batchCompressPdfs(files,{strength:0,quality:100,maxEdge:0},{
  cancelled:()=>false,progress:(...x)=>progress.push(x),
  result:x=>results.push(x),error:x=>errors.push(x)
 });
 assert.equal(results.length,2,'valid files before and after corrupt file must complete');
 assert.deepEqual(results.map(x=>x.name),['real-form.pdf','second-form.pdf']);
 assert.equal(errors.length,1,'corrupt PDF fails without stopping later file');
 assert.equal(progress.length,3);
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-batch-roundtrip-'));
 try{
  for(const item of results){
   const target=path.join(temp,item.name);
   fs.writeFileSync(target,item.bytes);
   const reopened=await lib.PDFDocument.load(fs.readFileSync(target));
   assert.equal(reopened.getPageCount(),2);
   assert.equal(reopened.getPage(1).getRotation().angle,90);
   assert.equal(reopened.getForm().getTextField('applicant').getText(),'Tester');
   assert.equal(reopened.getForm().getCheckBox('approved').isChecked(),true);
   assert.equal(reopened.getTitle(),'Batch Integrity Fixture');
  }
 }finally{fs.rmSync(temp,{recursive:true,force:true})}
 console.log('PASS: production lossless batch compressor, actual disk bytes saved/reopened, form values, page rotation, per-file failure isolation');
})().catch(error=>{console.error(error);process.exitCode=1});
