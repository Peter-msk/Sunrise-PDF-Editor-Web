// Real Chromium end-to-end: browser file input -> editor load -> Save As ->
// Blob download -> disk PDF reopen -> editor reload. No OCR or live services.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const baseDir=path.resolve(__dirname,'../dist');
const mime={
 '.html':'text/html;charset=utf-8','.js':'text/javascript;charset=utf-8',
 '.mjs':'text/javascript;charset=utf-8','.css':'text/css;charset=utf-8',
 '.pdf':'application/pdf','.json':'application/json','.woff2':'font/woff2',
 '.ttf':'font/ttf','.png':'image/png','.svg':'image/svg+xml'
};
function serve(req,res){
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(pathname.startsWith('/api/')){
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
   browser=await chromium.launch({headless:true,args:['--no-sandbox']});
   const context=await browser.newContext({acceptDownloads:true,viewport:{width:1366,height:880}});
   const page=await context.newPage();
   const pageErrors=[];
   page.on('pageerror',error=>pageErrors.push(error.message));
   await page.goto(host+'/editor/',{waitUntil:'domcontentloaded',timeout:40000});
   await page.waitForFunction(()=>Boolean(window.PDFLib&&window.pdfjsLib&&window.SunriseEditState),
     {timeout:40000});
   const filename='roundtrip-input.pdf';
   await page.locator('#openPdfInput').setInputFiles({name:filename,mimeType:'application/pdf',buffer:await fixture()});
   await page.waitForFunction(name=>document.querySelector('#workspaceDocumentTitle')?.textContent.includes(name),
     filename,{timeout:40000});
   await page.locator('#quickSaveBtn').click();
   await page.locator('#saveAsConfirmBtn').waitFor({state:'visible',timeout:20000});
   await page.locator('#saveAsConfirmBtn').click();
   const link=page.locator('#saveAsDownloadLink');
   await link.waitFor({state:'visible',timeout:60000});
   assert.equal(await link.getAttribute('download'),filename);
   const saving=page.waitForEvent('download',{timeout:30000});
   await link.click();
   const download=await saving;
   assert.equal(download.suggestedFilename(),filename);
   const disk=path.join(downloadDir,filename);
   await download.saveAs(disk);
   const actual=fs.readFileSync(disk);
   assert(actual.byteLength>100);
   const reopened=await PDFLib.PDFDocument.load(actual);
   assert.equal(reopened.getPageCount(),2);
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
   console.log('PASS: real headless Chromium PDF open, Save As, actual Blob download to disk, reopen form/rotation, browser reload');
   await context.close();
 }finally{
   if(browser)await browser.close();
   await new Promise(resolve=>server.close(resolve));
   fs.rmSync(downloadDir,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error('Browser save/reopen E2E:',error);process.exitCode=1});
