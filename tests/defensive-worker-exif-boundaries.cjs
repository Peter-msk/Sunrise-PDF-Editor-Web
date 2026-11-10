'use strict';
// R02: browser-local worker cancellation and malformed EXIF structure guards.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
function workerSandbox(script,abortOnConstruct=false){
  const controller=new AbortController();
  const observed={constructed:0,sent:0,terminated:0};
  class FakeWorker{
    constructor(){observed.constructed++;if(abortOnConstruct)controller.abort();}
    terminate(){observed.terminated++;}
    postMessage(message){
      observed.sent++;
      const data=message.operation==='chain'?{ok:true,chainVerified:true}:
        message.operation==='pkcs12'?{ok:true,certificatePem:'CERT',privateKeyPem:'KEY'}:
        {ok:true,operation:message.operation,output:new ArrayBuffer(120),pageCount:1,
          encryption:'AESv3',bits:256,requiresPassword:true,encrypted:false};
      queueMicrotask(()=>this.onmessage?.({data}));
    }
  }
  const sandbox={Worker:FakeWorker,WebAssembly,TextEncoder,Uint8Array,ArrayBuffer,
    isSecureContext:true,DOMException,Promise,setTimeout,clearTimeout,queueMicrotask,
    SunrisePdfCms:{signPdfWithPem:async()=>({bytes:new Uint8Array(120)})}};
  vm.runInNewContext(fs.readFileSync(path.join(root,script),'utf8'),sandbox,{filename:script});
  return {api:sandbox,controller,observed};
}
function exifFixture(ifdOffset,segmentLength){
  const bytes=new Uint8Array(100);
  bytes[0]=0xff;bytes[1]=0xd8;
  bytes[2]=0xff;bytes[3]=0xe1;bytes[4]=segmentLength>>8;bytes[5]=segmentLength&255;
  bytes.set([69,120,105,102,0,0,73,73,42,0],6);
  bytes[16]=ifdOffset&255;bytes[17]=(ifdOffset>>>8)&255;
  const directory=12+ifdOffset;
  bytes[directory]=1;bytes[directory+1]=0;
  bytes.set([0x12,0x01,3,0,1,0,0,0,6,0,0,0],directory+2);
  return bytes;
}
(async()=>{
  // Aborted before Worker startup must reject without ever posting secrets.
  const protect=workerSandbox('src/assets/sunrise-pdf-protect.js',true);
  await assert.rejects(protect.api.SunrisePdfProtect.protectPdf({
    bytes:new Uint8Array(140),password:'SunriseR02-password!',signal:protect.controller.signal
  }),err=>err?.name==='AbortError');
  assert.equal(protect.observed.sent,0,'Cancelled crypto request must not post passwords');
  assert.equal(protect.observed.terminated,1,'Crypto worker must be terminated on abort');
  const pki=workerSandbox('src/assets/sunrise-pki.js',true);
  await assert.rejects(pki.api.SunrisePki.verifyChain('-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
    '-----BEGIN CERTIFICATE-----\nY\n-----END CERTIFICATE-----',pki.controller.signal),
    err=>err?.name==='AbortError');
  assert.equal(pki.observed.sent,0,'Cancelled certificate request must not post the certificate');
  assert.equal(pki.observed.terminated,1,'PKI worker must be terminated on abort');
  // The normal, non-cancelled paths must still complete.
  const normalCrypto=workerSandbox('src/assets/sunrise-pdf-protect.js');
  const output=await normalCrypto.api.SunrisePdfProtect.protectPdf({
    bytes:new Uint8Array(140),password:'SunriseR02-password!',signal:normalCrypto.controller.signal});
  assert.equal(output.bytes.byteLength,120);
  assert.equal(normalCrypto.observed.sent,1);
  const normalPki=workerSandbox('src/assets/sunrise-pki.js');
  assert.equal((await normalPki.api.SunrisePki.verifyChain('-----BEGIN CERTIFICATE-----\nX\n-----END CERTIFICATE-----',
    '-----BEGIN CERTIFICATE-----\nY\n-----END CERTIFICATE-----',normalPki.controller.signal)).chainVerified,true);
  // APP1 IFD pointers must stay inside their own EXIF segment, not scan the trailing JPEG.
  const images=require('../src/assets/sunrise-images-to-pdf.js');
  assert.equal(images.jpegExifOrientation(exifFixture(8,38)),6,'Valid TIFF orientation must survive');
  assert.equal(images.jpegExifOrientation(exifFixture(28,16)),1,
    'Malformed EXIF pointer into unrelated JPEG data must not supply orientation');
  console.log('PASS R02: cancelled crypto/PKI Workers never receive input, valid paths work, EXIF APP1 bounds enforced');
})().catch(err=>{console.error(err);process.exitCode=1;});
