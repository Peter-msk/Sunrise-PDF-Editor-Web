// Real Chromium end-to-end: browser file input -> editor load -> Save As ->
// Blob download -> disk PDF reopen -> editor reload. No OCR or live services.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const editState=require('../src/assets/sunrise-edit-state.js');
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

   // USR-15: a signature-like mark must visibly state it is not certificate signing.
   await page.evaluate(()=>executeCommand('insertVisualSignature'));
   await page.locator('#insTextInput').waitFor({state:'visible'});
   await page.locator('#insTextInput').fill('Visual QA Signer');
   await page.locator('#insConfirmBtn').click();
   await page.locator('#annotationOverlay [data-overlay-id]',{hasText:'전자서명·인증서 서명 아님'})
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
   // USR-13: the only exported material must be masked raster pixels.
   const privacySource=await PDFLib.PDFDocument.create();
   privacySource.addPage([400,600]).drawText('Sensitive Secret 123',{x:80,y:480,size:15});
   privacySource.addPage([400,600]).drawText('Second Sensitive Page 456',{x:40,y:540,size:15});
   await page.locator('#openPdfInput').setInputFiles({
     name:'privacy-page.pdf',mimeType:'application/pdf',
     buffer:Buffer.from(await privacySource.save())
   });
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('privacy-page.pdf'),
     null,{timeout:40000});
   await page.evaluate(()=>executeCommand('maskedPageExport'));
   await page.locator('#maskExportBtn').waitFor({state:'visible'});
   await page.locator('#maskConfirmed').check();
   const maskingDownload=page.waitForEvent('download',{timeout:60000});
   await page.locator('#maskExportBtn').click();
   const maskedEvent=await maskingDownload;
   const maskedPath=path.join(downloadDir,'masked-page.pdf');
   await maskedEvent.saveAs(maskedPath);
   const maskedDisk=fs.readFileSync(maskedPath);
   const maskedPdf=await PDFLib.PDFDocument.load(maskedDisk);
   assert.equal(maskedPdf.getPageCount(),1);
   assert.equal(maskedPdf.catalog.get(PDFLib.PDFName.of('SunriseWebEdits')),undefined);
   const rasterEvidence=await page.evaluate(async b64=>{
     const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
     const document=await window.pdfjsLib.getDocument({data:bytes}).promise;
     try{
       const pdfPage=await document.getPage(1);
       const text=await pdfPage.getTextContent();
       const view=pdfPage.getViewport({scale:1});
       const canvas=globalThis.document.createElement('canvas');
       canvas.width=Math.ceil(view.width);canvas.height=Math.ceil(view.height);
       const ctx=canvas.getContext('2d');
       await pdfPage.render({canvasContext:ctx,canvas,viewport:view}).promise;
       return {text:text.items.map(x=>x.str).join(''),mask:[...ctx.getImageData(80,115,1,1).data]};
     }finally{await document.destroy()}
   },maskedDisk.toString('base64'));
   assert.equal(rasterEvidence.text,'','raster export must not copy original searchable text');
   assert(rasterEvidence.mask.slice(0,3).every(x=>x<10),'mask region must be black in actual PDF pixels');
   await page.locator('#maskExportClose').click();
   // A new two-page PDF must contain only rendered pixels, with all explicit
   // black masks visible and no PDF text layer, even on unmasked regions.
   await page.evaluate(()=>executeCommand('maskedDocumentExport'));
   await page.locator('#documentMasksExportBtn').waitFor({state:'visible'});
   await page.locator('#documentMasksInput').fill('1,70,100,180,40\n1,50,200,40,20\n2,30,40,80,30');
   await page.locator('#documentMasksConfirmed').check();
   const wholeDownload=page.waitForEvent('download',{timeout:60000});
   await page.locator('#documentMasksExportBtn').click();
   const wholeEvent=await wholeDownload;
   assert(wholeEvent.suggestedFilename().endsWith('_masked_full_document.pdf'));
   const wholePath=path.join(downloadDir,'masked-complete.pdf');
   await wholeEvent.saveAs(wholePath);
   const wholeDisk=fs.readFileSync(wholePath);
   const wholePdf=await PDFLib.PDFDocument.load(wholeDisk);
   assert.equal(wholePdf.getPageCount(),2);
   for(const field of ['AcroForm','Outlines','Names','Perms','SunriseWebEdits']){
     assert.equal(wholePdf.catalog.get(PDFLib.PDFName.of(field)),undefined,'must not copy '+field);
   }
   const wholeEvidence=await page.evaluate(async b64=>{
     const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
     const pdf=await window.pdfjsLib.getDocument({data:bytes}).promise;
     try{
       const rows=[];
       for(let n=1;n<=pdf.numPages;n++){
         const p=await pdf.getPage(n),text=await p.getTextContent();
         const viewport=p.getViewport({scale:1}),canvas=document.createElement('canvas');
         canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
         const ctx=canvas.getContext('2d');
         await p.render({canvasContext:ctx,canvas,viewport}).promise;
         const coords=n===1?[[80,115],[65,210]]:[[45,55]];
         rows.push({text:text.items.map(item=>item.str).join(''),
           pixels:coords.map(([x,y])=>[...ctx.getImageData(x,y,1,1).data])});
         canvas.width=0;canvas.height=0;
       }
       return rows;
     }finally{await pdf.destroy()}
   },wholeDisk.toString('base64'));
   assert.equal(wholeEvidence.length,2);
   for(const record of wholeEvidence){
     assert.equal(record.text,'','full-document raster export cannot retain PDF text layer');
     for(const pixel of record.pixels)
       assert(pixel.slice(0,3).every(channel=>channel<10),'masked rectangle must be black');
   }
   await page.locator('#documentMasksCloseBtn').click();

   assert.equal(pageErrors.length,0,'Editor runtime errors: '+pageErrors.join(' | '));
   console.log('PASS: PDF edit/save/reopen, visual text correction, labeled signature, single- and full-document multi-region masked raster export, embedded PNG, quality reports and range split');
   await context.close();
 }finally{
   if(browser)await browser.close();
   await new Promise(resolve=>server.close(resolve));
   fs.rmSync(downloadDir,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error('Browser save/reopen E2E:',error);process.exitCode=1});
