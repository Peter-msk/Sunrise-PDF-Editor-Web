'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),cp=require('node:child_process'),os=require('node:os'),path=require('node:path');
async function main(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sunrise-pki-'));
 try{
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem'),container=path.join(dir,'identity.p12');
  cp.execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=Sunrise Synthetic PKI'],{stdio:'ignore'});
  cp.execFileSync('openssl',['pkcs12','-export','-inkey',key,'-in',cert,'-out',container,'-passout','pass:SyntheticP12Password!'],{stdio:'ignore'});
  const sandbox={ArrayBuffer,Uint8Array,String,Date,setTimeout,clearTimeout,console,addEventListener:()=>{}};sandbox.self=sandbox;let answer;
  const context=vm.createContext(sandbox);
  sandbox.postMessage=value=>{answer=value;};sandbox.importScripts=()=>vm.runInContext(fs.readFileSync('vendor/node-forge/dist/forge.min.js','utf8'),context);
  vm.runInContext(fs.readFileSync('src/assets/sunrise-pki-worker.js','utf8'),context);
  const bytes=new Uint8Array(fs.readFileSync(container));
  sandbox.onmessage({data:{operation:'pkcs12',bytes:bytes.slice().buffer,password:'SyntheticP12Password!'}});
  assert.equal(answer.ok,true,'OpenSSL-generated AES P12 must import successfully');assert(answer.privateKeyPem.includes('BEGIN PRIVATE KEY'));assert(answer.certificatePem.includes('BEGIN CERTIFICATE'));
  sandbox.onmessage({data:{operation:'pkcs12',bytes:bytes.slice().buffer,password:'incorrect'}});assert.equal(answer.ok,false);assert.equal(answer.errorCode,'PKCS12');
  const pem=fs.readFileSync(cert,'utf8');sandbox.onmessage({data:{operation:'chain',chain:[pem],anchors:[pem]}});assert.equal(answer.ok,true);assert.equal(answer.chainVerified,true);
  sandbox.onmessage({data:{operation:'chain',chain:[pem],anchors:[]}});assert.equal(answer.ok,false,'container certificates never become automatic trust anchors');
  console.log('R34 PKI: real OpenSSL P12 import, incorrect-password rejection and explicit trust-anchor boundary passed');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
main().catch(e=>{console.error(e?.message||e);process.exitCode=1;});
