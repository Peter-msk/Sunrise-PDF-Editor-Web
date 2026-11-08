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
   assert.deepEqual(restored.overlays.map(x=>x.type),['Shape','Table','Note']);
   assert.equal(restored.overlays[0].shapeKind,'ellipse');
   assert.equal(restored.overlays[0].strokeWidth,4);
   assert.equal(restored.overlays[1].cells.length,3);
   assert.equal(restored.overlays[1].cells[2][0],'대기');
   assert.equal(restored.overlays[1].width,275);
   assert.equal(restored.overlays[2].text,'검토 의견');
   assert.equal(restored.overlays[2].opacity,0.55);
   assert.equal(restored.overlays[2].bgColor,'#ffeecc');

   assert.equal(reopened.getPage(1).getRotation().angle,90);
   assert.equal(reopened.getForm().getTextField('employee').getText(),'Sample Person');
   assert.equal(reopened.getForm().getCheckBox('approved').isChecked(),true);
   await page.locator('#saveAsDownloadedBtn').click();
   await page.locator('#openPdfInput').setInputFiles({name:'reloaded-output.pdf',mimeType:'application/pdf',buffer:actual});
   await page.waitForFunction(()=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes('reloaded-output.pdf'),
     null,{timeout:40000});
   const uploaded=await page.evaluate(()=>document.querySelector('#workspaceDocumentTitle')?.textContent);
   assert(uploaded.includes('reloaded-output.pdf'));
   assert.equal(pageErrors.length,0,'Editor runtime errors: '+pageErrors.join(' | '));
   console.log('PASS: real browser shape, table, and note edits; PDF download, editable overlays restored, form/rotation preserved, browser reopen');
   await context.close();
 }finally{
   if(browser)await browser.close();
   await new Promise(resolve=>server.close(resolve));
   fs.rmSync(downloadDir,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error('Browser save/reopen E2E:',error);process.exitCode=1});
