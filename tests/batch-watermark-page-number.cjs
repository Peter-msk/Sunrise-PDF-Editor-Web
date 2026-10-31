const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const korean=require('../dist/assets/korean-font.js');
const fontData={bytes:new Uint8Array(fs.readFileSync('dist/assets/fonts/DroidSansFallback.ttf')),metrics:JSON.parse(fs.readFileSync('dist/assets/fonts/DroidSansFallback.metrics.json','utf8'))};
const html=fs.readFileSync('src/editor/index.html','utf8');
const a=html.indexOf('    function guardBatchSource('),b=html.indexOf('    async function batchCompressPdfs(',a);
const c=html.indexOf('    async function batchMarkPdfs('),d=html.indexOf('    function openBatchMarkModal(',c);
assert(a>=0&&b>a&&c>b&&d>c,'Batch functions must exist');
const output=[],errors=[],progress=[];
let stopped=false;
const ctx=vm.createContext({window:{PDFLib:lib,SunriseKoreanFont:{embed:(pdf,text)=>korean.embed(pdf,text,fontData)}},
 ArrayBuffer,Uint8Array,Number,Error,Set,Map,console,
 readPdfInputFile:async file=>{if(file.size>50*1024*1024)throw Error('50 MiB 초과');return file.data},
 editablePdfForm:pdf=>{
  if(pdf.catalog.get(lib.PDFName.of('Perms')))throw Error('서명 관련 문서');
  const acro=pdf.catalog.get(lib.PDFName.of('AcroForm'));
  if(acro&&pdf.context.lookup(acro).get(lib.PDFName.of('XFA')))throw Error('XFA 문서');
  return pdf.getForm();
 }});
vm.runInContext(html.slice(a,b)+html.slice(c,d),ctx);
const handlers={cancelled:()=>stopped,progress:(...x)=>progress.push(x),result:r=>output.push(r),error:r=>errors.push(r)};
(async()=>{
 const pdf=await lib.PDFDocument.create();const page=pdf.addPage([450,640]);pdf.setTitle('Business Form');
 const field=pdf.getForm().createTextField('client');field.addToPage(page,{x:25,y:440,width:200,height:30});field.setText('Sample');
 const box=pdf.getForm().createCheckBox('accepted');box.addToPage(page,{x:30,y:400,width:20,height:20});box.check();
 const source=await pdf.save({updateFieldAppearances:false}),originalSnapshot=Uint8Array.from(source);
 const file=(name,data=source)=>({name,size:data.byteLength,data});
 const invalid=file('bad.pdf',new Uint8Array([1,2,3]));
 await ctx.batchMarkPdfs([file('good-a.pdf'),invalid,file('good-b.pdf')],{kind:'watermark',text:'대외비'},handlers);
 if(output.length!==2)console.error('Batch mark failure messages:',errors.map(e=>e.message));
 assert.deepEqual(output.map(x=>x.name),['good-a.pdf','good-b.pdf']);
 assert.equal(errors.length,1);assert.equal(progress.length,3);
 for(const r of output){
  const doc=await lib.PDFDocument.load(r.bytes);
  assert.equal(doc.getPageCount(),1);
  assert.equal(doc.getForm().getTextField('client').getText(),'Sample');
  assert.equal(doc.getForm().getCheckBox('accepted').isChecked(),true);
  assert.equal(doc.getTitle(),'Business Form');
  assert(r.bytes.byteLength>0);
 }
 assert.deepEqual([...source],[...originalSnapshot],'Input source unchanged');
 output.length=0;errors.length=0;progress.length=0;
 await ctx.batchMarkPdfs([file('number.pdf')],{kind:'page-number',text:''},handlers);
 assert.equal(output.length,1);
 const numbered=await lib.PDFDocument.load(output[0].bytes);
 assert.equal(numbered.getForm().getTextField('client').getText(),'Sample');
 assert.notDeepEqual([...output[0].bytes],[...source],'Output should contain added page number');
 // Common office PDFs have no AcroForm: inspection must not synthesize one.
 const plain=await lib.PDFDocument.create();plain.addPage([450,640]);
 const plainBytes=await plain.save();
 output.length=0;errors.length=0;
 await ctx.batchMarkPdfs([file('plain.pdf',plainBytes)],{kind:'page-number',text:''},handlers);
 assert.equal(output.length,1,'ordinary non-form PDF must succeed');
 assert.equal(errors.length,0);
 const plainSaved=await lib.PDFDocument.load(output[0].bytes);
 assert.equal(plainSaved.catalog.get(lib.PDFName.of('AcroForm')),undefined,'must not create a blank form dictionary');

 const rotated=await lib.PDFDocument.load(source);rotated.getPage(0).setRotation(lib.degrees(90));
 errors.length=0;output.length=0;
 await ctx.batchMarkPdfs([file('rotated.pdf',await rotated.save())],{kind:'watermark',text:'TEST'},handlers);
 assert.equal(output.length,0);assert.match(errors[0]?.message||'',/회전/);
 const signed=await lib.PDFDocument.load(source);signed.catalog.set(lib.PDFName.of('Perms'),signed.context.obj({}));
 errors.length=0;await ctx.batchMarkPdfs([file('signed.pdf',await signed.save())],{kind:'page-number',text:''},handlers);
 assert.match(errors[0]?.message||'',/서명/);
 await assert.rejects(ctx.batchMarkPdfs(Array(6).fill(file('x.pdf')),{kind:'watermark',text:'TEST'},handlers),/최대 5개/);
 await assert.rejects(ctx.batchMarkPdfs([file('x.pdf')],{kind:'watermark',text:'\u0000'},handlers),/1~40자/);
 stopped=true;output.length=0;progress.length=0;
 await ctx.batchMarkPdfs([file('cancelled.pdf')],{kind:'page-number'},handlers);
 assert.equal(output.length,0);assert.equal(progress.length,0);
 assert(html.includes('case "batchMark"'),'Ribbon must call batch mark UI');
 assert(html.includes('id="markPdfFiles"'),'Multi-file UI required');
 assert(!html.includes('batchMarkOCR'),'OCR excluded');
 console.log('PASS: batch Korean watermark & page numbers, field preservation, corrupt file isolation, signature/rotation guards, cancellation');
})().catch(e=>{console.error(e);process.exitCode=1});
