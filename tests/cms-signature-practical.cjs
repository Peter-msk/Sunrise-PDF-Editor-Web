/* USR-15 DEV3 - FUTURE practical regression, NOT executed during source development.
 * Requires OpenSSL CLI and Node WebCrypto. Generates disposable RSA key/certificate.
 * Checks that an independent CMS implementation can verify the PDF ByteRange.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-cms-'));
const oldCrypto=globalThis.crypto,oldSecure=globalThis.isSecureContext;
const fromHex=h=>Buffer.from(h,'hex');
try{
  // This is only a test fixture. Never ship the disposable generated private key.
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
  Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:true});
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',path.join(temp,'key.pem'),
    '-out',path.join(temp,'cert.pem'),'-days','1','-subj','/CN=Sunrise CMS test'],{stdio:'ignore'});
  const engine=require('../src/assets/sunrise-pdf-cms.js');
  (async()=>{
    const pdf=await PDFLib.PDFDocument.create();pdf.addPage([595,842]);
    const bytes=await pdf.save({useObjectStreams:false});
    const cert=fs.readFileSync(path.join(temp,'cert.pem'),'utf8');
    const key=fs.readFileSync(path.join(temp,'key.pem'),'utf8');
    const result=await engine.signPdfWithPem({bytes,certificatePem:cert,privateKeyPem:key,PDFLib});
    assert.equal(result.cryptographicSelfCheck,true);
    assert.equal(result.pkiTrustVerified,false);
    const text=Buffer.from(result.bytes).toString('latin1');
    const m=/\/ByteRange\s*\[\s*0\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/.exec(text);
    assert.ok(m,'PDF ByteRange exists');
    const [b,c,d]=m.slice(1).map(Number);
    assert.equal(c+d,result.bytes.length);
    assert.equal(text[b],'<');assert.equal(text[c-1],'>');
    const signedContent=Buffer.concat([Buffer.from(result.bytes.subarray(0,b)),Buffer.from(result.bytes.subarray(c,c+d))]);
    const hexCms=text.slice(b+1,c-1);
    const cmsPadded=fromHex(hexCms);
    const lenByte=cmsPadded[1];let header=2,len=lenByte;
    if(lenByte&128){const n=lenByte&127;assert.ok(n>=1&&n<=4);len=0;for(let i=0;i<n;i++)len=len*256+cmsPadded[header++];}
    const cms=cmsPadded.subarray(0,header+len);
    fs.writeFileSync(path.join(temp,'signed-content.bin'),signedContent);
    fs.writeFileSync(path.join(temp,'signature.der'),cms);
    execFileSync('openssl',['cms','-verify','-binary','-inform','DER','-in',path.join(temp,'signature.der'),
      '-content',path.join(temp,'signed-content.bin'),'-noverify','-out',path.join(temp,'verified.bin')],{stdio:'pipe'});
    assert.deepEqual(fs.readFileSync(path.join(temp,'verified.bin')),signedContent);
    // A separate PDF library must be used for a final acceptance review.
    console.log('USR-15 CMS ByteRange / OpenSSL detached signature practical check passed');
  })().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>{
    fs.rmSync(temp,{recursive:true,force:true});
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:oldCrypto});
    Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:oldSecure});
  });
}catch(error){fs.rmSync(temp,{recursive:true,force:true});throw error;}
