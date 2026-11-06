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

    const second=await cms.signPdfWithPem({bytes:result.bytes,certificatePem,privateKeyPem,PDFLib:lib,profile:'cades',incremental:true});
    assert.deepEqual(second.bytes.subarray(0,result.bytes.length),result.bytes,'previous signed revision must remain byte-identical');
    assert.equal(second.previousSignaturesPreserved,1);
    const both=await cms.verifyPdfSignature({bytes:second.bytes,PDFLib:lib});
    assert.equal(both.signatureCount,2);assert(both.signatures.every(x=>x.cryptographicIntegrity));
    assert.equal(both.signatures[0].coversWholeFile,false);assert.equal(both.signatures[1].coversWholeFile,true);
    const third=await cms.signPdfWithPem({bytes:second.bytes,certificatePem,privateKeyPem,PDFLib:lib,incremental:true});
    assert.equal((await cms.verifyPdfSignature({bytes:third.bytes,PDFLib:lib})).signatureCount,3);
    const parsed=await lib.PDFDocument.load(third.bytes),n=lib.PDFName.of;
    const sigs=parsed.context.enumerateIndirectObjects().map(([,obj])=>obj).filter(o=>o?.get?.(n('Type'))?.toString()==='/Sig');
    assert.equal(sigs.length,3);
    for(const [i,sig] of sigs.entries()){
      const range=parsed.context.lookup(sig.get(n('ByteRange'))),br=Array.from({length:4},(_,j)=>range.get(j).asNumber());
      const signed=Buffer.concat([Buffer.from(third.bytes.subarray(0,br[1])),Buffer.from(third.bytes.subarray(br[2],br[2]+br[3]))]);
      const cmsBytes=parsed.context.lookup(sig.get(n('Contents'))).asBytes();
      fs.writeFileSync(path.join(dir,'signed.bin'),signed);fs.writeFileSync(path.join(dir,'cms.der'),cmsBytes);
      cp.execFileSync('openssl',['cms','-verify','-binary','-inform','DER','-in',path.join(dir,'cms.der'),'-content',path.join(dir,'signed.bin'),'-noverify','-out',path.join(dir,'verified.bin')],{stdio:'ignore'});
    }
    const modified=second.bytes.slice();modified[modified.indexOf(0x25)+7]^=1;
    await assert.rejects(cms.verifyPdfSignature({bytes:modified,PDFLib:lib}),/해시|구조|PDF/);
    const forbidden=await lib.PDFDocument.load(input);forbidden.catalog.set(n('Perms'),forbidden.context.obj({}));
    await assert.rejects(cms.signPdfWithPem({bytes:await forbidden.save(),certificatePem,privateKeyPem,PDFLib:lib,incremental:true}),/서명·보안/);
    console.log('R34 incremental signing: 3 revisions, byte-prefix preservation, all CMS verified independently by OpenSSL, tamper and certification guards passed');

  }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
