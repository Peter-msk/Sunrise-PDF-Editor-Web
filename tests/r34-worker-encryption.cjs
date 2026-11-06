'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const lib=require('../dist/assets/pdf-lib/pdf-lib.min.js');
async function main(){
 const module=await import('../vendor/pdfstudio/dist/index.js');
 let result;
 const self={crypto:require('node:crypto').webcrypto,postMessage:value=>{result=value;}};
 const script=fs.readFileSync('src/assets/sunrise-pdf-protect-worker.js','utf8').replace('await import(JS_URL)','await loadToolkit()').replace('await module.createPdfToolkit({ wasmUrl: WASM_URL })','await module.createPdfToolkit()');
 const context=vm.createContext({self,Uint8Array,ArrayBuffer,TextEncoder,Error,loadToolkit:async()=>module});vm.runInContext(script,context);
 const pdf=await lib.PDFDocument.create();pdf.addPage([400,600]).drawText('WORKER ROUNDTRIP');
 await pdf.attach(new TextEncoder().encode('ATTACHMENT CONTENT'),'report.txt',{mimeType:'text/plain',description:'Original attachment'});
 const bytes=await pdf.save(),original=bytes.slice(),password='Synthetic-Password-1234';
 async function invoke(operation,input,pw=password){result=null;await self.onmessage({data:{operation,input:input.slice().buffer,password:pw}});assert(result,'worker must report an outcome');return result;}
 const locked=await invoke('lock',bytes);assert.equal(locked.ok,true,'lock worker: '+JSON.stringify(locked));assert.equal(locked.bits,256);
 const wrong=await invoke('unlock',new Uint8Array(locked.output),'wrong-password');assert.equal(wrong.ok,false);
 const unlocked=await invoke('unlock',new Uint8Array(locked.output));assert.equal(unlocked.ok,true);assert.equal(unlocked.pageCount,1);
 const compressed=await invoke('compress',bytes,'');assert.equal(compressed.ok,true);assert(compressed.output.byteLength<=bytes.length);
 const toolkit=await module.createPdfToolkit(),details=await toolkit.getInfo(new Uint8Array(unlocked.output));assert.equal(details.attachments.length,1);
 assert.deepEqual(bytes,original);
 console.log('R34 actual password worker: AES-256 lock, correct/wrong unlock, attachment and page retention, lossless compression passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
