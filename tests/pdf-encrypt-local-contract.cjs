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
  let inputs=[],state='normal';
  async function mock(args,payload){
   inputs.push({args,payload});
   if(args[0]==='--version')return {code:0,stdout:'qpdf version 12.2.0'};
   if(args[0]==='--requires-password')return {code:args[1].includes('.sunrise-pdf-lock-')?0:2,stdout:''};
   if(args[0]==='--is-encrypted')return {code:0,stdout:''};
   if(args[0]==='@-'){
    const lines=payload.split('\n');
    if(lines.includes('--encrypt')){
     if(state==='failEncryption')return {code:1};
     const stage=lines[lines.length-2];
     await fs.writeFile(stage,raw);
     return {code:0};
    }
    if(lines.includes('--check')){
     if(state==='failCorrectPassword')return {code:1};
     return {code:lines[0].includes('PASSWORD_FOR_TEST_2026')?0:2};
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
