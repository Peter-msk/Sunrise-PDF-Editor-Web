'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),cp=require('node:child_process');
global.isSecureContext=true;
if(!global.crypto)Object.defineProperty(global,'crypto',{value:require('node:crypto').webcrypto,configurable:true});
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const cms=require('../src/assets/sunrise-pdf-cms.js'),editState=require('../src/assets/sunrise-edit-state.js');
async function main(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-r33-signature-'));
  try{
    cp.execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(dir,'key.pem'),'-out',path.join(dir,'cert.pem'),'-days','1','-subj','/CN=Sunrise Synthetic Test'],{stdio:'ignore'});
    const certificatePem=fs.readFileSync(path.join(dir,'cert.pem'),'utf8'),privateKeyPem=fs.readFileSync(path.join(dir,'key.pem'),'utf8');
    const pdf=await lib.PDFDocument.create(),font=await pdf.embedFont(lib.StandardFonts.Helvetica);pdf.addPage([400,600]).drawText('SIGNED DOCUMENT',{font,x:20,y:500,size:12});
    const form=pdf.getForm(),field=form.createTextField('unchanged');field.setText('PRESERVED');field.addToPage(pdf.getPage(0),{x:20,y:450,width:100,height:20});
    const input=await pdf.save(),snapshot=input.slice();
    const result=await cms.signPdfWithPem({bytes:input,certificatePem,privateKeyPem,PDFLib:lib,profile:'cades'});
    assert.deepEqual(input,snapshot);assert.equal(result.pkiTrustVerified,false);
    const verified=await cms.verifyPdfSignature({bytes:result.bytes,PDFLib:lib});
    assert.equal(verified.cryptographicIntegrity,true);assert.equal(verified.profile,'ETSI.CAdES.detached');
    const saved=await lib.PDFDocument.load(result.bytes);assert.equal(saved.getForm().getTextField('unchanged').getText(),'PRESERVED');
    const restored=await editState.restore(result.bytes,lib);assert.equal(restored.signed,true);assert.strictEqual(restored.bytes,result.bytes);assert.deepEqual(restored.overlays,[]);
    const tampered=result.bytes.slice();tampered[7]=tampered[7]===55?54:55;
    await assert.rejects(cms.verifyPdfSignature({bytes:tampered,PDFLib:lib}),/해시|구조|PDF/);
    await assert.rejects(cms.signPdfWithPem({bytes:result.bytes,certificatePem,privateKeyPem,PDFLib:lib}),/기존 서명|서명 관련/);
    console.log('R33 CMS integrity and signed-file preservation regressions passed');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
