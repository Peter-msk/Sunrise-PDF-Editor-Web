/* FUTURE targeted practical regression — NOT executed during DEV5 source authoring.
 * Requires Node WebCrypto, OpenSSL CLI, and the approved application PDF-lib.
 * Generates an ephemeral test-only private key; never uses a real user's key.
 */
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const {webcrypto}=require('node:crypto');
const PDFLib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-encrypted-key-'));
const previousCrypto=globalThis.crypto,previousSecure=globalThis.isSecureContext;
(async()=>{
  try{
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:webcrypto});
    Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:true});
    const keyFile=path.join(root,'plain.pem');
    const encryptedFile=path.join(root,'encrypted.pem');
    const certFile=path.join(root,'cert.pem');
    const password='Sunrise-2026-PKCS8-Test!';
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes',
      '-keyout',keyFile,'-out',certFile,'-days','1','-subj','/CN=Sunrise Encrypted Key Test'],{stdio:'ignore'});
    execFileSync('openssl',['pkcs8','-topk8','-in',keyFile,'-out',encryptedFile,
      '-v2','aes-256-cbc','-v2prf','hmacWithSHA256','-iter','4000',
      '-passout',`pass:${password}`],{stdio:'ignore'});
    const pem=fs.readFileSync(encryptedFile,'utf8');
    const cert=fs.readFileSync(certFile,'utf8');
    const signer=require('../src/assets/sunrise-pdf-cms.js');
    const doc=await PDFLib.PDFDocument.create();doc.addPage([595,842]);
    const bytes=await doc.save({useObjectStreams:false});
    const immutable=bytes.slice();
    const success=await signer.signPdfWithPem({bytes,certificatePem:cert,
      privateKeyPem:pem,keyPassword:password,PDFLib});
    assert.equal(success.cryptographicSelfCheck,true);
    assert.deepEqual(bytes,immutable,'Signing must not modify source PDF');
    assert.ok(success.bytes.byteLength>bytes.byteLength);
    await assert.rejects(signer.signPdfWithPem({bytes,certificatePem:cert,
      privateKeyPem:pem,keyPassword:'wrong-password',PDFLib}));
    await assert.rejects(signer.signPdfWithPem({bytes,certificatePem:cert,
      privateKeyPem:pem,PDFLib}));
    console.log('USR-15 encrypted PKCS#8 targeted practical regression passed');
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
    Object.defineProperty(globalThis,'crypto',{configurable:true,value:previousCrypto});
    Object.defineProperty(globalThis,'isSecureContext',{configurable:true,value:previousSecure});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
