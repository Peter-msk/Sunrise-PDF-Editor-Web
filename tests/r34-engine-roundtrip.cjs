/* FUTURE manual/integration test — NOT executed during R32-DEV4 code authoring.
 * Requires npm ci and a working QPDF WASM package (pdfstudio 0.4.0).
 * Validates an actual encrypted PDF, correct/wrong password behavior,
 * PDF-lib rejection, page parity, and original byte preservation.
 */
'use strict';
const assert=require('node:assert/strict');
const path=require('node:path');
const PDFLib=require(path.join(__dirname,'../dist/assets/pdf-lib/pdf-lib.min.js'));
(async()=>{
  const {createPdfToolkit}=await import('../vendor/pdfstudio/dist/index.js');
  const qpdf=await createPdfToolkit();
  const sourceDoc=await PDFLib.PDFDocument.create();
  sourceDoc.addPage([430,540]).drawText('SUNRISE AES256 CHECK',{x:42,y:480,size:18});
  sourceDoc.addPage([595.28,841.89]);
  const input=await sourceDoc.save({useObjectStreams:false});
  const reference=input.slice();
  const password='Sunrise-Local-Password-2026!';
  const output=await qpdf.lock(input,{userPassword:password,ownerPassword:password,keyLength:256});
  assert.equal(await qpdf.isEncrypted(output),true);
  assert.equal(await qpdf.requiresPassword(output),true);
  const info=await qpdf.getInfo(output,{password});
  assert.equal(info.encryption?.bits,256);
  assert.equal(info.encryption?.method,'AESv3');
  assert.equal(info.pageCount,2);
  await assert.rejects(qpdf.getInfo(output,{password:'WRONG-PASSWORD-2026'}));
  await assert.rejects(PDFLib.PDFDocument.load(output),/encrypt|password/i);
  const recovered=await qpdf.unlock(output,{password});
  const decrypted=await PDFLib.PDFDocument.load(recovered);
  assert.equal(decrypted.getPageCount(),2);
  assert.deepEqual(input,reference,'PDF input must remain unchanged');
  assert.notDeepEqual(input,output,'Encrypted output must not be the original bytes');
  console.log('USR-14 QPDF WASM AES-256 encryption and wrong-password rejection passed');
})().catch(error=>{console.error(error);process.exitCode=1});
