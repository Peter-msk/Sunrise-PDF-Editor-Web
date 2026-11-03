// Real Chromium end-to-end: browser file input -> editor load -> Save As ->
// Blob download -> disk PDF reopen -> editor reload. No OCR or live services.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const editState=require('../src/assets/sunrise-edit-state.js');
const outlineTransfer=require('../src/assets/sunrise-outline-transfer.js');
const baseDir=path.resolve(__dirname,'../dist');
const telemetryEvents=[];
const mime={
 '.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8',
 '.mjs':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8',
 '.pdf':'application/pdf','.json':'application/json','.woff2':'font/woff2',
 '.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml'
};
function serve(req,res){
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname.startsWith('/api/')){
   if(pathname==='/api/telemetry'&&req.method==='POST'){
    let body='';req.on('data',part=>body+=part);req.on('end',()=>{try{telemetryEvents.push(JSON.parse(body))}catch{}res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}')});return;
   }
   res.writeHead(200,{'content-type':'application/json'});res.end('{"ok":true}');return;
 }
 const filename=pathname.endsWith('/')?pathname+'index.html':pathname;
 const candidate=path.resolve(baseDir,'.'+filename);
 if(candidate!==baseDir&&!candidate.startsWith(baseDir+path.sep)){res.writeHead(403);res.end();return}
 fs.readFile(candidate,(err,data)=>{
   if(err){res.writeHead(404);res.end('Not Found');return}
   res.writeHead(200,{'content-type':mime[path.extname(candidate)]||'application/octet-stream',
     'cache-control':'no-store'});
   res.end(data);
 });
}
async function fixture(){
 const pdf=await PDFLib.PDFDocument.create();
 pdf.setTitle('Chromium PDF Roundtrip');
 pdf.setAuthor('Sunrise Validation');
 const first=pdf.addPage([420,595]);
 const embedded=await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFUlEQVR4nAXBAQEAAACAEP9PF0JQGR7vBPykAXTzAAAAAElFTkSuQmCC','base64'));
 first.drawImage(embedded,{x:340,y:520,width:24,height:24});
 first.drawText('Document Save Reopen Validation',{x:35,y:550,size:14});
 const second=pdf.addPage([600,420]);
 second.setRotation(PDFLib.degrees(90));
 second.drawText('Rotated Page Two',{x:30,y:390,size:12});
 const form=pdf.getForm();
 const text=form.createTextField('employee');
 text.addToPage(first,{x:35,y:490,width:180,height:25});
 text.setText('Sample Person');
 const check=form.createCheckBox('approved');
 check.addToPage(first,{x:35,y:440,width:18,height:18});check.check();
 return Buffer.from(await pdf.save());
}
// Synthetic six-page office-style fixture: two-level native outlines and mixed page geometry.
async function complexSplitFixture(){
 const pdf=await PDFLib.PDFDocument.create();
 pdf.setTitle('검토보고서 분할 무결성 시험');
 const sizes=[[420,595],[595,842],[480,640],[612,792],[360,520],[500,700]];
 for(let i=0;i<sizes.length;i++){
  const page=pdf.addPage(sizes[i]);
  page.drawText('Chapter page '+(i+1),{x:40,y:sizes[i][1]-70,size:12});
  if(i===1)page.setRotation(PDFLib.degrees(90));
  if(i===4)page.setCropBox(12,16,300,460);
 }
 const n=PDFLib.PDFName.of,context=pdf.context;
 const root=context.obj({Type:'Outlines',Count:4});
 const rootRef=context.register(root);
 const entry=(title,pageIndex,parent)=>context.obj({
  Title:PDFLib.PDFHexString.fromText(title),Parent:parent,
  Dest:context.obj([pdf.getPage(pageIndex).ref,n('Fit')])
 });
 const chapter1=entry('제1장 사업 개요',0,rootRef),chapter1Ref=context.register(chapter1);
 const detail1=entry('1.1 현황 분석',1,chapter1Ref),detail1Ref=context.register(detail1);
 const chapter2=entry('제2장 검토 결론',4,rootRef),chapter2Ref=context.register(chapter2);
 const detail2=entry('2.1 후속 대책',5,chapter2Ref),detail2Ref=context.register(detail2);
 root.set(n('First'),chapter1Ref);root.set(n('Last'),chapter2Ref);
 chapter1.set(n('First'),detail1Ref);chapter1.set(n('Last'),detail1Ref);
 chapter1.set(n('Count'),PDFLib.PDFNumber.of(1));chapter1.set(n('Next'),chapter2Ref);
 chapter2.set(n('First'),detail2Ref);chapter2.set(n('Last'),detail2Ref);
 chapter2.set(n('Count'),PDFLib.PDFNumber.of(1));chapter2.set(n('Prev'),chapter1Ref);
 pdf.catalog.set(n('Outlines'),rootRef);
 const bytes=Buffer.from(await pdf.save());
 const reopened=await PDFLib.PDFDocument.load(bytes);
 assert.deepEqual(outlineTransfer.read(reopened,PDFLib).map(x=>[x.title,x.page,x.level]),[
  ['제1장 사업 개요',0,0],['1.1 현황 분석',1,1],
  ['제2장 검토 결론',4,0],['2.1 후속 대책',5,1]
 ]);
 return bytes;
}

async function main(){
 const downloadDir=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-chromium-e2e-'));
 const server=http.createServer(serve);
 let browser;
 try{
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
   const host='http://127.0.0.1:'+server.address().port;
   browser=await require('./helpers/launch-browser.cjs')(chromium);
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:880}});
   const page=await context.newPage();
   const pageErrors=[];
   page.on('pageerror',error=>pageErrors.push(error.message));
   await page.goto(host+'/editor/',{waitUntil:'domcontentloaded',timeout:40000});
   await page.waitForFunction(()=>Boolean(window.PDFLib&&window.pdfjsLib&&window.SunriseEditState),
     null,{timeout:40000});
   const filename='roundtrip-input.pdf',savedName='roundtrip-input_edited.pdf';
   await page.locator('#openPdfInput').setInputFiles({name:filename,mimeType:'application/pdf',buffer:await fixture()});
   await page.waitForFunction(name=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes(name),
     filename,{timeout:40000});
   // USR-16: actual binary DOCX/XLSX download for the PDF text layer.
   const docxDownload=page.waitForEvent('download',{timeout:30000});
   await page.evaluate(()=>executeCommand('exportWordText'));
   const word=await docxDownload;
   assert(word.suggestedFilename().endsWith('_text_only.docx'));
   const wordFile=path.join(downloadDir,'text-only.docx');
   await word.saveAs(wordFile);
   const wordBuffer=fs.readFileSync(wordFile);
   assert.equal(wordBuffer.readUInt32LE(0),0x04034b50,'Word document must be an actual ZIP OpenXML package');
   assert(wordBuffer.includes(Buffer.from('Document Save Reopen Validation')),'Word document must contain original PDF text');
   const xlsxDownload=page.waitForEvent('download',{timeout:30000});
   await page.evaluate(()=>executeCommand('exportExcelText'));
   const excel=await xlsxDownload;
   assert(excel.suggestedFilename().endsWith('_text_only.xlsx'));
   const excelFile=path.join(downloadDir,'text-only.xlsx');
   await excel.saveAs(excelFile);
   const excelBuffer=fs.readFileSync(excelFile);
   assert.equal(excelBuffer.readUInt32LE(0),0x04034b50,'Excel spreadsheet must be an actual ZIP OpenXML package');
   assert(excelBuffer.includes(Buffer.from('PDF Text')),'Excel workbook sheet title should exist');

   // Three end-user editing paths must be exercised in an actual Chromium/Chrome/Edge page.
   await page.evaluate(()=>executeCommand('insertShape'));
   await page.locator('#shapeConfirmBtn').waitFor({state:'visible'});
   await page.locator('#shapeKindInput').selectOption('ellipse');
   await page.locator('#shapeConfirmBtn').click();
   await page.locator('#annotationOverlay [data-overlay-id] svg ellipse').waitFor();
   await page.evaluate(()=>executeCommand('editInsertItem'));
   await page.locator('#editStrokeWidthInput').fill('4');
   await page.locator('#editItemConfirmBtn').click();

   await page.evaluate(()=>executeCommand('insertTable'));
   await page.locator('#tblConfirmBtn').waitFor({state:'visible'});
   await page.locator('#tblHeaderInput').fill('항목, 내용');
   await page.locator('#tblRowInput').fill('수질, 적합');
   await page.locator('#tblConfirmBtn').click();
   await page.evaluate(()=>executeCommand('editInsertItem'));
   await page.locator('#editTableCellsInput').waitFor({state:'visible'});
   await page.locator('#editTableCellsInput').fill('항목\t내용\n수질\t충족\n대기\t적합');
   await page.locator('#editItemWidthInput').fill('275');
   await page.locator('#editItemConfirmBtn').click();

   await page.evaluate(()=>executeCommand('insertNote'));
   await page.locator('#insConfirmBtn').waitFor({state:'visible'});
   await page.locator('#insTextInput').fill('검토 의견');
   await page.locator('#insConfirmBtn').click();
   await page.evaluate(()=>executeCommand('editInsertItem'));
   await page.locator('#editItemOpacityInput').waitFor({state:'visible'});
   await page.locator('#editItemOpacityInput').fill('0.55');
   await page.locator('#editItemBgInput').fill('#ffeecc');
   await page.locator('#editItemConfirmBtn').click();

   // R15: a signature-like visual mark is compact; the modal retains the non-certificate disclosure.
   await page.evaluate(()=>executeCommand('insertVisualSignature'));
   await page.locator('#insTextInput').waitFor({state:'visible'});
   await page.locator('#insTextInput').fill('Visual QA Signer');
   await page.locator('#insConfirmBtn').click();
   await page.locator('#annotationOverlay [data-overlay-id]',{hasText:'[전자서명 : Visual QA Signer]'})
     .waitFor({state:'visible',timeout:30000});

   // USR-05: restricted editable text layer, but original must remain extractable.
   await page.evaluate(()=>executeCommand('visualTextCorrection'));
   await page.waitForFunction(()=>Boolean(document.getElementById('correctTextConfirm') &&
     !document.getElementById('correctTextConfirm').disabled),null,{timeout:30000});
   await page.locator('#correctTextReplacement').fill('VISUAL CORRECTION ONLY');
   await page.locator('#correctTextConfirm').click();

   // USR-17: actually extract the raster XObject from PDF.js, not a page capture.
   await page.evaluate(()=>executeCommand('extractEmbeddedImages'));
   await page.locator('#embeddedImageStart').waitFor({state:'visible'});
   await page.locator('#embeddedImageStart').click();
   const embeddedSave=page.locator('#embeddedImageResults button',{hasText:'PNG 저장'}).first();
   await embeddedSave.waitFor({state:'visible',timeout:30000});
   const pngEvent=page.waitForEvent('download',{timeout:30000});
   await embeddedSave.click();
   const png=await pngEvent;
   const imagePath=path.join(downloadDir,'embedded.png');
   await png.saveAs(imagePath);
   assert(fs.readFileSync(imagePath).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),
     'embedded extracted output must be a real PNG');
   await page.locator('#embeddedImageClose').click();

   await page.locator('#quickSaveBtn').click();
   await page.locator('#saveAsConfirmBtn').waitFor({state:'visible',timeout:20000});
   // Force one preparation error, then retry in the same dialog.
   await page.evaluate(()=>{
    const original=window.compileDocumentWithOverlays;let fail=true;
    window.compileDocumentWithOverlays=async(...args)=>{if(fail){fail=false;throw new Error('synthetic retry test')}return original(...args)};
   });
   await page.locator('#saveAsConfirmBtn').click();
   await page.waitForFunction(()=>document.querySelector('#saveAsStatus')?.textContent.includes('PDF 준비 실패'),null,{timeout:20000});
   await page.locator('#saveAsConfirmBtn').click();
   const link=page.locator('#saveAsDownloadLink');
   await link.waitFor({state:'visible',timeout:60000});
   await page.waitForTimeout(1000);
   const saveEvents=telemetryEvents.filter(x=>x.type==='save_operation');
   assert.deepEqual(saveEvents.map(x=>x.stage),['started','failed','started','ready']);
   assert.equal(saveEvents[0].operationId,saveEvents[1].operationId);
   assert.equal(saveEvents[2].retryOf,saveEvents[0].operationId);
   assert.equal(saveEvents[2].operationId,saveEvents[3].operationId);
   assert(!JSON.stringify(saveEvents).includes(filename),'telemetry must not include document names');
   assert.equal(await link.getAttribute('download'),savedName);
   const saving=page.waitForEvent('download',{timeout:30000});
   await link.click();
   const download=await saving;
   assert.equal(download.suggestedFilename(),savedName);
   const disk=path.join(downloadDir,savedName);
   await download.saveAs(disk);
   const actual=fs.readFileSync(disk);
   assert(actual.byteLength>100);
   const reopened=await PDFLib.PDFDocument.load(actual);
   assert.equal(reopened.getPageCount(),2);
   const restored=await editState.restore(new Uint8Array(actual),PDFLib);
   assert.equal(restored.warning,false,'saved PDF must preserve editable overlay state');
   assert.deepEqual(restored.overlays.map(x=>x.type),['Shape','Table','Note','VisualSignature','Correction']);
   assert.equal(restored.overlays[0].shapeKind,'ellipse');
   assert.equal(restored.overlays[0].strokeWidth,4);
   assert.equal(restored.overlays[1].cells.length,3);
   assert.equal(restored.overlays[1].cells[2][0],'대기');
   assert.equal(restored.overlays[1].width,275);
   assert.equal(restored.overlays[2].text,'검토 의견');
   assert.equal(restored.overlays[2].opacity,0.55);
   assert.equal(restored.overlays[2].bgColor,'#ffeecc');
   assert.equal(restored.overlays[3].text,'Visual QA Signer');
   assert.equal(restored.overlays[4].text,'VISUAL CORRECTION ONLY');

   // The appearance correction must NOT be mistaken for true content removal.
   const searchableOriginal=await page.evaluate(async base64=>{
     const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
     const reader=await window.pdfjsLib.getDocument({data:bytes}).promise;
     try{
       const content=await (await reader.getPage(1)).getTextContent();
       return content.items.map(x=>x.str).join(' ');
     }finally{await reader.destroy()}
   },actual.toString('base64'));
   assert(searchableOriginal.includes('Document Save Reopen Validation'),
     'appearance-only text correction must preserve the original searchable source text');



   assert.equal(reopened.getPage(1).getRotation().angle,90);
   assert.equal(reopened.getForm().getTextField('employee').getText(),'Sample Person');
   assert.equal(reopened.getForm().getCheckBox('approved').isChecked(),true);
   await page.locator('#saveAsDownloadedBtn').click();
   await page.locator('#openPdfInput').setInputFiles({name:'reloaded-output.pdf',mimeType:'application/pdf',buffer:actual});
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('reloaded-output.pdf'),
     null,{timeout:40000});
   const uploaded=await page.evaluate(()=>document.querySelector('#workspaceDocumentTitle')?.textContent);
   assert(uploaded.includes('reloaded-output.pdf'));
   // USR-12: inspect the saved disk PDF and download the actual browser reports.
   await page.evaluate(()=>executeCommand('checkSavedPdf'));
   await page.locator('#savedPdfCheckInput').setInputFiles({
     name:'quality-report-fixture.pdf',mimeType:'application/pdf',buffer:actual
   });
   await page.waitForFunction(()=>!document.getElementById('savedQualityJsonBtn')?.disabled,
     null,{timeout:40000});
   const jsonDownload=page.waitForEvent('download',{timeout:20000});
   await page.locator('#savedQualityJsonBtn').click();
   const jsonSaved=await jsonDownload;
   const jsonPath=path.join(downloadDir,'preflight.json');
   await jsonSaved.saveAs(jsonPath);
   const report=JSON.parse(fs.readFileSync(jsonPath,'utf8'));
   assert.equal(report.format,'Sunrise PDF Preflight 1');
   assert.equal(report.pageCount,2);
   assert(Array.isArray(report.issues));
   assert(!('sourceName' in report),'report must not include original filename');
   const csvDownload=page.waitForEvent('download',{timeout:20000});
   await page.locator('#savedQualityCsvBtn').click();
   const csvSaved=await csvDownload;
   const csvPath=path.join(downloadDir,'preflight.csv');
   await csvSaved.saveAs(csvPath);
   const csv=fs.readFileSync(csvPath,'utf8');
   assert(csv.startsWith('\ufeff')&&csv.includes('총 페이지')&&csv.includes('page'),
     'CSV must be UTF-8 BOM with summary');
   await page.locator('#modalCloseBtn').click();
   // USR-02: range split into two outputs; output 2 must contain only page 4.
   const splitPdf=await PDFLib.PDFDocument.create();
   for(let i=0;i<4;i++)splitPdf.addPage([350,500]).drawText('Page '+(i+1));
   await page.locator('#openPdfInput').setInputFiles({
     name:'split-four-pages.pdf',mimeType:'application/pdf',buffer:Buffer.from(await splitPdf.save())
   });
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('split-four-pages.pdf'),
     null,{timeout:40000});
   await page.evaluate(()=>executeCommand('splitPages'));
   await page.locator('#splitPrepareBtn').waitFor({state:'visible'});
   await page.locator('#splitRangeInput').fill('1-2, 4');
   await page.locator('#splitSizeInput').fill('2');
   await page.locator('#splitPrepareBtn').click();
   const splitButtons=page.locator('#splitReadyResults button');
   await splitButtons.nth(1).waitFor({state:'visible',timeout:60000});
   assert.equal(await splitButtons.count(),2);
   const partEvent=page.waitForEvent('download',{timeout:30000});
   await splitButtons.nth(1).click();
   const part=await partEvent;
   const partFile=path.join(downloadDir,'split-part.pdf');
   await part.saveAs(partFile);
   const resultPart=await PDFLib.PDFDocument.load(fs.readFileSync(partFile));
   assert.equal(resultPart.getPageCount(),1);
   assert((part.suggestedFilename()||'').includes('_p4-4.pdf'));
   await page.locator('#splitCloseBtn').click();
   // USR-02/18: mixed page geometry, nested original bookmarks, separate
   // on-demand downloads, byte-for-byte source immutability, and stale plans.
   const officeBytes=await complexSplitFixture(),officeOriginal=Buffer.from(officeBytes);
   await page.locator('#openPdfInput').setInputFiles({
     name:'현장_검토보고서.PDF',mimeType:'application/pdf',buffer:officeBytes
   });
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('현장_검토보고서.PDF'),
     null,{timeout:40000});
   // R14: real mixed-size PDF must center its narrow page in the wider grid track.
   await page.waitForFunction(()=>document.querySelector('#pageStage canvas')?.width > 1);
   const centered=await page.evaluate(()=>{
     const view=document.querySelector('#canvasViewport').getBoundingClientRect();
     const first=document.querySelector('#pagesFlow .page-slot[data-page-index="0"]').getBoundingClientRect();
     return first.left+first.width/2-(view.left+view.width/2);
   });
   assert(Math.abs(centered)<4,'Mixed-width first page must be centered in the PDF pane');
   await page.evaluate(()=>executeCommand('fitWidth'));
   const fitCentered=await page.evaluate(()=>{
     const view=document.querySelector('#canvasViewport').getBoundingClientRect();
     const first=document.querySelector('#pagesFlow .page-slot[data-page-index="0"]').getBoundingClientRect();
     return first.left+first.width/2-(view.left+view.width/2);
   });
   assert(Math.abs(fitCentered)<4,'Width fit must keep mixed-width pages centered');
   const zoomBefore=await page.locator('#zoomSlider').inputValue();
   const browserScale=await page.evaluate(()=>window.visualViewport.scale);
   await page.evaluate(()=>{
     const view=document.querySelector('#canvasViewport'),r=view.getBoundingClientRect();
     const e=new WheelEvent('wheel',{deltaY:-100,ctrlKey:true,cancelable:true,bubbles:true,
       clientX:r.left+view.clientWidth/2,clientY:r.top+view.clientHeight/3});
     view.dispatchEvent(e);
     if(!e.defaultPrevented)throw Error('Ctrl-wheel must cancel native browser zoom');
   });
   await page.waitForFunction(before=>Number(document.querySelector('#zoomSlider').value)>Number(before),zoomBefore,{timeout:7000});
   assert.equal(await page.evaluate(()=>window.visualViewport.scale),browserScale,
     'Ctrl-wheel must change PDF zoom, not browser page zoom');
   await page.evaluate(()=>executeCommand('splitPages'));
   await page.locator('#splitPrepareBtn').waitFor({state:'visible'});
   await page.locator('#splitRangeInput').fill('1-6');
   await page.locator('#splitSizeInput').fill('3');
   await page.locator('#splitPrepareBtn').click();
   const officeResults=page.locator('#splitReadyResults button');
   await officeResults.nth(1).waitFor({state:'visible',timeout:60000});
   assert.equal(await officeResults.count(),2,'six pages must yield two separate three-page results');
   const expectedNames=['현장_검토보고서_part_001_p1-3.pdf','현장_검토보고서_part_002_p4-6.pdf'];
   const expectedOutlines=[
     [['제1장 사업 개요',0,0],['1.1 현황 분석',1,1]],
     [['제2장 검토 결론',1,0],['2.1 후속 대책',2,1]]
   ];
   for(let index=0;index<2;index++){
     const pending=page.waitForEvent('download',{timeout:60000});
     await officeResults.nth(index).click();
     const event=await pending;
     assert.equal(event.suggestedFilename(),expectedNames[index]);
     const pathname=path.join(downloadDir,'complex-split-'+index+'.pdf');
     await event.saveAs(pathname);
     const output=await PDFLib.PDFDocument.load(fs.readFileSync(pathname));
     assert.equal(output.getPageCount(),3);
     assert.deepEqual(outlineTransfer.read(output,PDFLib).map(x=>[x.title,x.page,x.level]),expectedOutlines[index],
       'split must map original hierarchical bookmarks into each saved PDF');
     if(index===0){
       assert.equal(output.getPage(1).getRotation().angle,90);
       assert.equal(output.getPage(1).getMediaBox().width,595);
     }else{
       assert.deepEqual(output.getPage(1).getCropBox(),
         {x:12,y:16,width:300,height:460},'asymmetric crop box must be retained');
     }
     assert.equal(await officeResults.count(),2,'saving a part must leave later on-demand results available');
   }
   assert(officeBytes.equals(officeOriginal),'splitting must not mutate original file input');

   // Simulate a document edit while a split plan is open. A stale prepared
   // result must be discarded instead of publishing another download.
   await page.evaluate(()=>{
     activeDoc().metadata.splitConcurrencyRegression='changed after plan';
   });
   await officeResults.first().click();
   assert((await page.locator('#splitPlanStatus').innerText()).includes('문서 상태가 변경'),
     'prepared PDF must reject changes to the editable document state');
   assert.equal(await officeResults.count(),0,'invalidated split plan must discard result buttons');
   await page.locator('#splitCloseBtn').click();

   // USR-13: the only exported material must be masked raster pixels.
   const privacySource=await PDFLib.PDFDocument.create();
   privacySource.addPage([400,600]).drawText('Sensitive Secret 123',{x:80,y:480,size:15});
   privacySource.addPage([400,600]).drawText('Secondary Secret 456',{x:120,y:480,size:15});
   await page.locator('#openPdfInput').setInputFiles({
     name:'privacy-page.pdf',mimeType:'application/pdf',
     buffer:Buffer.from(await privacySource.save())
   });
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('privacy-page.pdf'),
     null,{timeout:40000});
   await page.evaluate(()=>executeCommand('maskedPageExport'));
   await page.locator('#maskExportBtn').waitFor({state:'visible'});
   await page.locator('#maskPlanLines').fill('3,70,100,180,40');
   await page.locator('#maskPlanCheck').click();
   assert((await page.locator('#maskPlanPreview').innerText()).includes('검증 실패'));
   await page.locator('#maskPlanLines').fill('1,70,100,180,40\n1,260,200,50,30\n2,105,100,200,40');
   await page.locator('#maskPlanCheck').click();
   assert((await page.locator('#maskPlanPreview').innerText()).includes('2쪽 출력 / 3개 영역 적용 예정'));
   await page.locator('#maskConfirmed').check();
   const maskingDownload=page.waitForEvent('download',{timeout:60000});
   await page.locator('#maskExportBtn').click();
   const maskedEvent=await maskingDownload;
   const maskedPath=path.join(downloadDir,'masked-multiple-pages.pdf');
   await maskedEvent.saveAs(maskedPath);
   const maskedDisk=fs.readFileSync(maskedPath);
   const maskedPdf=await PDFLib.PDFDocument.load(maskedDisk);
   assert.equal(maskedPdf.getPageCount(),2);
   assert.equal(maskedPdf.catalog.get(PDFLib.PDFName.of('SunriseWebEdits')),undefined);
   const rasterEvidence=await page.evaluate(async b64=>{
     const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
     const output=await window.pdfjsLib.getDocument({data:bytes}).promise;
     try{
       const pages=[];
       for(let n=1;n<=output.numPages;n++){
         const pdfPage=await output.getPage(n);
         const text=await pdfPage.getTextContent();
         const view=pdfPage.getViewport({scale:1});
         const canvas=globalThis.document.createElement('canvas');
         canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
         const ctx=canvas.getContext('2d');
         await pdfPage.render({canvasContext:ctx,canvas,viewport:view}).promise;
         const checks=n===1?[[80,115],[270,215]]:[[120,115]];
         pages.push({text:text.items.map(x=>x.str).join(''),
           masks:checks.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data])});
       }
       return pages;
     }finally{await output.destroy()}
   },maskedDisk.toString('base64'));
   assert.equal(rasterEvidence.length,2);
   for(const p of rasterEvidence){
     assert.equal(p.text,'','new raster output must not copy original searchable text');
     for(const pixel of p.masks)
       assert(pixel.slice(0,3).every(x=>x<10),'selected mask pixels must be black');
   }
   await page.locator('#maskExportClose').click();

   // R15: a mixed portrait/landscape document must form homogeneous spread rows.
   const mixed=await PDFLib.PDFDocument.create();
   for(const [width,height] of [[420,595],[842,595],[810,595],[860,595],[420,595],[420,595],[842,595]])
     mixed.addPage([width,height]);
   await page.locator('#openPdfInput').setInputFiles({name:'r15-mixed.pdf',mimeType:'application/pdf',
     buffer:Buffer.from(await mixed.save())});
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('r15-mixed.pdf'),
     null,{timeout:40000});
   for(const [mode,expected] of [['2',[[1],[2,3],[4],[5,6],[7]]],['3',[[1],[2,3,4],[5,6],[7]]]]){
     await page.locator('#pageViewMode').selectOption(mode);
     const groups=await page.evaluate(()=>[...document.querySelectorAll('#pagesFlow > .page-orientation-row')]
       .map(row=>[...row.querySelectorAll('.page-slot')].map(slot=>Number(slot.dataset.pageIndex)+1)));
     assert.deepEqual(groups,expected,'mixed orientation groups must preserve order and separate landscape rows');
   }
   await page.evaluate(()=>executeCommand('insertPageNumber'));
   await page.locator('#pgNumFromPage').fill('2');
   await page.locator('#pgNumFirstValue').fill('10');
   await page.locator('#pgNumSkipPages').fill('3,6');
   await page.locator('#pgNumConfirmBtn').click();
   const numbered=await page.evaluate(()=>activeDoc().overlays.filter(x=>x.type==='PageNumber')
     .map(x=>({page:x.pageIndex+1,text:x.text})));
   assert.deepEqual(numbered,[
     {page:2,text:'- 10 / 4 -'},{page:4,text:'- 11 / 4 -'},
     {page:5,text:'- 12 / 4 -'},{page:7,text:'- 13 / 4 -'}
   ]);
   await page.evaluate(()=>executeCommand('insertWatermark'));
   await page.locator('#insTextInput').fill('CONFIDENTIAL');
   await page.locator('#insScopeSelect').selectOption('all');
   await page.locator('#insConfirmBtn').click();
   assert.equal(await page.evaluate(()=>activeDoc().overlays.filter(x=>x.type==='Watermark')
     .every(x=>{
       const size=activeDoc().pageSizes[x.pageIndex];
       return Math.abs(x.x+x.width/2-size.width/2)<1.1 &&
         Math.abs(x.y+x.height/2-size.height/2)<1.1;
     })),true,'all-page watermarks should have page-specific centers');
   await page.evaluate(()=>executeCommand('maskedPageExport'));
   await page.locator('#maskPlanLines').waitFor({state:'visible'});
   const maskHeight=await page.locator('#maskPlanLines').evaluate(x=>x.getBoundingClientRect().height);
   assert(maskHeight>=105,'masking dialog textarea must not collapse under flex layout');
   await page.locator('#maskExportClose').click();
   assert.equal(pageErrors.length,0,'Editor runtime errors: '+pageErrors.join(' | '));
   console.log('PASS: PDF edit/save/reopen; office-style nested-bookmark split, stale-plan protection, raster masking, embedded PNG/reports, mobile touch save/reopen');
   await context.close();

   // USR-19: real touch-enabled Chromium context (mobile emulation, not an
   // Android/iOS hardware acceptance test) must support page navigation,
   // responsive drawers, Save As and disk PDF roundtrip.
   const mobile=await browser.newContext({
     acceptDownloads:true,viewport:{width:390,height:844},deviceScaleFactor:2,
     isMobile:true,hasTouch:true
   });
   try{
     const touch=await mobile.newPage(),mobileErrors=[];
     touch.on('pageerror',error=>mobileErrors.push(error.message));
     await touch.goto(host+'/editor/',{waitUntil:'domcontentloaded',timeout:40000});
     await touch.waitForFunction(()=>Boolean(window.PDFLib&&window.pdfjsLib&&window.SunriseEditState),
       null,{timeout:40000});
     await touch.locator('#mobileBottomNav').waitFor({state:'visible',timeout:15000});
     // Real tap -> mobile file menu -> browser file chooser, not a hidden
     // input assignment that could mask a broken touch action.
     await touch.locator('#mobFileBtn').tap();
     await touch.locator('#mobileFileOpen').waitFor({state:'visible'});
     assert.equal(await touch.locator('#mobileFileSave').isDisabled(),true,
       'Save should be disabled until a PDF is open');
     const choosePdf=touch.waitForEvent('filechooser',{timeout:20000});
     await touch.locator('#mobileFileOpen').tap();
     const chooser=await choosePdf;
     await chooser.setFiles({
       name:'mobile-touch.pdf',mimeType:'application/pdf',buffer:await fixture()
     });
     await touch.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('mobile-touch.pdf'),
       null,{timeout:40000});
     await touch.locator('#modalBackdrop').waitFor({state:'hidden'});
     await touch.waitForFunction(()=>document.querySelector('#mobPageIndicator')?.textContent.trim()==='1 / 2',
       null,{timeout:30000});
     await touch.locator('#mobNextPageBtn').tap();
     await touch.waitForFunction(()=>document.querySelector('#mobPageIndicator')?.textContent.trim()==='2 / 2',
       null,{timeout:30000});
     await touch.locator('#mobPrevPageBtn').tap();
     await touch.waitForFunction(()=>document.querySelector('#mobPageIndicator')?.textContent.trim()==='1 / 2',
       null,{timeout:30000});
     await touch.locator('#mobLeftPaneBtn').tap();
     await touch.locator('#mobileDrawerBackdrop').waitFor({state:'visible'});
     // Backdrop covers the screen behind the 84vw side drawer. Tap OUTSIDE
     // that drawer; the backdrop's geometric center is inside the drawer.
     const backdrop=await touch.locator('#mobileDrawerBackdrop').boundingBox();
     assert(backdrop&&backdrop.width>=390,'mobile overlay must cover the viewport');
     await touch.locator('#mobileDrawerBackdrop').tap({
       position:{x:backdrop.width-8,y:Math.round(backdrop.height/2)}
     });
     await touch.locator('#mobileDrawerBackdrop').waitFor({state:'hidden'});
     // Mobile File button must expose Save As without scrolling the top
     // toolbar, and still use the exact same PDF save/reopen pipeline.
     await touch.locator('#mobFileBtn').tap();
     assert.equal(await touch.locator('#mobileFileSave').isEnabled(),true);
     await touch.locator('#mobileFileSave').tap();
     await touch.locator('#saveAsConfirmBtn').waitFor({state:'visible',timeout:20000});
     const modal=await touch.locator('#modalBox').boundingBox();
     assert(modal&&modal.x>=-1&&modal.x+modal.width<=391,
       'Mobile Save As modal must fit without horizontal clipping');
     await touch.locator('#saveAsConfirmBtn').tap();
     const saveLink=touch.locator('#saveAsDownloadLink');
     await saveLink.waitFor({state:'visible',timeout:60000});
     const downloadPromise=touch.waitForEvent('download',{timeout:45000});
     await saveLink.tap();
     const saved=await downloadPromise;
     const mobilePath=path.join(downloadDir,'mobile-roundtrip.pdf');
     await saved.saveAs(mobilePath);
     const mobileBytes=fs.readFileSync(mobilePath);
     const mobileDoc=await PDFLib.PDFDocument.load(mobileBytes);
     assert.equal(mobileDoc.getPageCount(),2);
     assert.equal(mobileDoc.getPage(1).getRotation().angle,90);
     assert.equal(mobileDoc.getForm().getTextField('employee').getText(),'Sample Person');
     await touch.locator('#saveAsDownloadedBtn').tap();
     // Preserve PDF merge access in the new mobile file menu.
     await touch.locator('#mobFileBtn').tap();
     await touch.locator('#mobileFileMerge').tap();
     await touch.waitForFunction(()=>document.getElementById('modalTitle')?.textContent.includes('PDF 병합'),
       null,{timeout:30000});
     await touch.locator('#modalCloseBtn').tap();
     await touch.locator('#openPdfInput').setInputFiles({
       name:'mobile-reopened.pdf',mimeType:'application/pdf',buffer:mobileBytes
     });
     await touch.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('mobile-reopened.pdf'),
       null,{timeout:40000});
     assert.equal(mobileErrors.length,0,'Mobile touch context runtime errors: '+mobileErrors.join(' | '));
   }finally{await mobile.close();}
 }finally{
   if(browser)await browser.close();
   await new Promise(resolve=>server.close(resolve));
   fs.rmSync(downloadDir,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error('Browser save/reopen E2E:',error);process.exitCode=1});
