'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const protect=require('../scripts/protect-pdf-local.cjs');
assert.throws(()=>protect.validatePassword('short'),/12~200/);
assert.throws(()=>protect.validatePassword('abcdefghijkl\nmnop'),/줄바꿈/);
assert.throws(()=>protect.argsOnStdin(['--password=a\nb']),/줄바꿈/);
assert.equal(protect.validatePassword('암호한글테스트abcd'), '암호한글테스트abcd');
(async()=>{
 const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'sunrise-qpdf-test-'));
 try{
  const original=path.join(tmp,'input.pdf'),target=path.join(tmp,'output.pdf');
  const doc=await PDFLib.PDFDocument.create();
  doc.addPage([400,600]).drawText('SECRET APPLICATION',{x:40,y:500,size:14});
  const raw=Buffer.from(await doc.save());
  await fs.writeFile(original,raw);
  let inputs=[],state='normal',mutateOriginal=false;
  async function mock(args,payload){
   inputs.push({args,payload});
   if(args[0]==='--version')return {code:0,stdout:'qpdf version 12.2.0'};
   if(args[0]==='--requires-password')return {code:args[1].includes('.sunrise-pdf-lock-')?0:2,stdout:''};
   if(args[0]==='--is-encrypted'){
    if(mutateOriginal){
     const before=await fs.stat(original);
     const edited=Buffer.from(raw);
     edited[12]^=1; // Same file length; leave timestamp unchanged.
     await fs.writeFile(original,edited);
     await fs.utimes(original,before.atime,before.mtime);
     const after=await fs.stat(original);
     assert.equal(after.size,before.size,'Tamper fixture must preserve input size');
     assert.equal(after.mtimeMs,before.mtimeMs,'Tamper fixture must preserve original mtime');
     assert.equal(after.ino,before.ino,'Tamper fixture must retain file identity');
     mutateOriginal=false;
    }
    return {code:0,stdout:''};
   }
   if(args[0]==='@-'){
    const lines=payload.split('\n');
    if(lines.includes('--encrypt')){
     const sourceSnapshot=lines[lines.length-3];
     const stage=lines[lines.length-2];
     assert.notEqual(sourceSnapshot,original,'QPDF must not read the mutable original');
     assert(sourceSnapshot.includes('.sunrise-pdf-lock-'),'QPDF must read a private snapshot');
     // Tests the actual bytes supplied to the encryption engine, not merely
     // the source path or the final post-conversion fingerprint.
     assert.deepEqual(await fs.readFile(sourceSnapshot),raw);
     if(state==='failEncryption')return {code:1};
     await fs.writeFile(stage,raw);
     return {code:0};
    }
    if(lines.includes('--check')){
     if(state==='failCorrectPassword')return {code:1};
     return {code:lines[0].includes('PASSWORD_FOR_TEST_2026')?0:2};
    }
    if(lines.includes('--show-npages')){
     if(state==='failPageProbe')return {code:1,stdout:''};
     return {code:0,stdout:state==='wrongPageCount'?'2\n':'1\n'};
    }
   }
   throw Error('unexpected mock qpdf call '+JSON.stringify(args));
  }
  const password='PASSWORD_FOR_TEST_2026';
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:original,password,qpdf:mock}),/다른/);
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:target,password:'tiny',qpdf:mock}),/12~200/);
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:target,password,qpdf:async()=>({code:0,stdout:'qpdf version 10.9.0'})}),/11.7/);
  const signedPath=path.join(tmp,'signed-source.pdf');
  const signedPdf=await PDFLib.PDFDocument.create();
  signedPdf.addPage([400,600]);
  signedPdf.catalog.set(PDFLib.PDFName.of('Perms'),signedPdf.context.obj({DocMDP: signedPdf.context.obj({Type:'Sig'})}));
  await fs.writeFile(signedPath,Buffer.from(await signedPdf.save()));
  await assert.rejects(
    protect.protectPdfFile({inputPath:signedPath,outputPath:target,password,qpdf:mock}),
    /전자서명/,'Signed/certified input must not be rewritten'
  );
  const unknownPath=path.join(tmp,'unknown.pdf');
  await fs.writeFile(unknownPath,Buffer.from('%PDF-1.7\n%%EOF\n'));
  await assert.rejects(
    protect.protectPdfFile({inputPath:unknownPath,outputPath:target,password,qpdf:mock}),
    /확인할 수 없는|올바르지/,'Unreadable PDF must fail before output'
  );
  state='failEncryption';
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:target,password,qpdf:mock}),/암호화 엔진/);
  await assert.rejects(fs.stat(target),{code:'ENOENT'});
  state='normal';
  // Regression: replacing bytes in-place while preserving length and mtime
  // must never publish a protected PDF derived from a moving source.
  const tamperedTarget=path.join(tmp,'tampered.pdf');
  const fixedTime=new Date('2024-01-01T00:00:00.000Z');
  await fs.utimes(original,fixedTime,fixedTime);
  mutateOriginal=true;
  await assert.rejects(
   protect.protectPdfFile({inputPath:original,outputPath:tamperedTarget,password,qpdf:mock}),
   /원본 PDF.*변경/
  );
  await assert.rejects(fs.stat(tamperedTarget),{code:'ENOENT'});
  await fs.writeFile(original,raw);
  // A successfully encrypted but truncated/wrong document must never publish.
  const mismatchTarget=path.join(tmp,'wrong-pages.pdf');
  state='wrongPageCount';
  await assert.rejects(
   protect.protectPdfFile({inputPath:original,outputPath:mismatchTarget,password,qpdf:mock}),
   /페이지 수/);
  await assert.rejects(fs.stat(mismatchTarget),{code:'ENOENT'});
  const probeTarget=path.join(tmp,'failed-page-probe.pdf');
  state='failPageProbe';
  await assert.rejects(
   protect.protectPdfFile({inputPath:original,outputPath:probeTarget,password,qpdf:mock}),
   /페이지 수/);
  await assert.rejects(fs.stat(probeTarget),{code:'ENOENT'});
  state='normal';
  const success=await protect.protectPdfFile({inputPath:original,outputPath:target,password,qpdf:mock});
  assert.equal(success.verified,true);
  assert.equal(success.method,'qpdf AES-256');
  assert.deepEqual(await fs.readFile(original),raw);
  assert.deepEqual(await fs.readFile(target),raw);
  assert(inputs.every(x=>x.args.every(a=>!a.includes(password))), 'No secret is allowed in process argument list');
  const encryptCall=inputs.find(x=>x.payload?.includes('--encrypt'));
  assert(encryptCall?.payload.includes('--bits=256'), 'Must use AES-256');
  assert(encryptCall.payload.includes('--owner-password='));
  assert(!encryptCall.payload.includes('--owner-password='+password), 'Owner secret must differ from user secret');
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:target,password,qpdf:mock}),/이미 존재/);
  const aliases=await fs.readdir(tmp);
  assert(aliases.every(x=>!x.startsWith('.sunrise-pdf-lock-')),'No intermediate secret files after completion');
  const failedOutput=path.join(tmp,'fails.pdf');
  state='failCorrectPassword';
  await assert.rejects(protect.protectPdfFile({inputPath:original,outputPath:failedOutput,password,qpdf:mock}),/검증에 실패/);
  await assert.rejects(fs.stat(failedOutput),{code:'ENOENT'});
  console.log('PASS: signed/unreadable PDF rejection, secure qpdf stdin password transport, atomic output, no overwrite and cleanup');
 }finally{await fs.rm(tmp,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
