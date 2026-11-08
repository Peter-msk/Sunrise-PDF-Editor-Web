// Real QPDF integration (only run where qpdf >= 11.7 is available).
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const {protectPdfFile,invokeQpdf,argsOnStdin}=require('../scripts/protect-pdf-local.cjs');
(async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'sunrise-qpdf-real-'));
 try{
  const original=path.join(tmp,'source.pdf'),secured=path.join(tmp,'secured.pdf');
  const doc=await PDFLib.PDFDocument.create();
  doc.addPage([430,540]).drawText('AES 256 REAL CHECK',{x:45,y:480,size:17});
  const originalBytes=Buffer.from(await doc.save());
  await fs.writeFile(original,originalBytes);
  const result=await protectPdfFile({
   inputPath:original,outputPath:secured,password:'Test!StrongPassphrase-2026-1234'
  });
  assert(result.verified);
  const securedBytes=await fs.readFile(secured);
  assert(!securedBytes.equals(originalBytes));
  assert.equal(securedBytes.subarray(0,5).toString('ascii'),'%PDF-');
  assert.equal((await invokeQpdf(['--is-encrypted',secured])).code,0);
  assert.equal((await invokeQpdf(['--requires-password',secured])).code,0);
  const correct=await invokeQpdf(['@-'],argsOnStdin([
   '--password=Test!StrongPassphrase-2026-1234','--show-npages',secured
  ]));
  assert.equal(correct.code,0);assert.equal(correct.stdout.trim(),'1');
  const wrong=await invokeQpdf(['@-'],argsOnStdin(['--password=wrong-one','--check',secured]));
  assert.notEqual(wrong.code,0);
  await assert.rejects(PDFLib.PDFDocument.load(securedBytes),/encrypt|password/i);
  assert.deepEqual(await fs.readFile(original),originalBytes);
  console.log('PASS: real QPDF AES-256, password barrier, correct/wrong unlock, page parity, pdf-lib refuses encrypted file and source unchanged');
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
