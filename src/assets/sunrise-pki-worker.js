/* Bounded, disposable PKCS#12 / X.509 worker. Only local, pinned forge is loaded.
 * Trust anchors must be supplied separately; certificates in a P12 are never anchors.
 */
'use strict';
// The upstream UMD browser bundle resolves its global through `window`.
// A dedicated worker has `self`; provide that alias without a DOM or network API.
self.window=self;
importScripts('/assets/node-forge/forge.min.js');
self.onmessage=event=>{
  const data=event.data||{};
  try{
    const f=self.forge;
    if(data.operation==='pkcs12'){
      if(!(data.bytes instanceof ArrayBuffer)||data.bytes.byteLength<20||data.bytes.byteLength>512*1024||
         typeof data.password!=='string'||data.password.length>1024)throw Error('input');
      const bytes=new Uint8Array(data.bytes);let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      const asn1=f.asn1.fromDer(binary,true);
      // MAC-less containers cannot establish password integrity; do not accept them.
      if(asn1.type!==16||!Array.isArray(asn1.value)||asn1.value.length!==3)throw Error('mac');
      const container=f.pkcs12.pkcs12FromAsn1(asn1,true,data.password);
      const bags=oid=>container.getBags({bagType:oid})[oid]||[];
      const keys=[...bags(f.pki.oids.pkcs8ShroudedKeyBag),...bags(f.pki.oids.keyBag)].filter(x=>x.key);
      const certs=bags(f.pki.oids.certBag).map(x=>x.cert).filter(Boolean);
      if(keys.length!==1||!certs.length||certs.length>5||!keys[0].key.n)throw Error('key');
      const key=keys[0].key;
      const leaf=certs.filter(c=>c.publicKey.n?.equals(key.n)&&c.publicKey.e?.equals(key.e));
      if(leaf.length!==1||key.n.bitLength()<2048||key.n.bitLength()>4096)throw Error('pair');
      const info=f.pki.wrapRsaPrivateKey(f.pki.privateKeyToAsn1(key));
      const certificatePem=[leaf[0],...certs.filter(c=>c!==leaf[0])].map(c=>f.pki.certificateToPem(c)).join('');
      const privateKeyPem=f.pki.privateKeyInfoToPem(info);
      bytes.fill(0);binary=null;data.password=null;
      self.postMessage({ok:true,certificatePem,privateKeyPem});
    }else if(data.operation==='chain'){
      if(!Array.isArray(data.chain)||!Array.isArray(data.anchors)||data.chain.length<1||data.chain.length>5||
         data.anchors.length<1||data.anchors.length>10||[...data.chain,...data.anchors].some(v=>typeof v!=='string'||v.length>128*1024))throw Error('input');
      const chain=data.chain.map(pem=>f.pki.certificateFromPem(pem));
      const anchors=data.anchors.map(pem=>f.pki.certificateFromPem(pem));
      const leaf=chain[0],ku=leaf.getExtension('keyUsage'),eku=leaf.getExtension('extKeyUsage');
      if(ku&&!ku.digitalSignature&&!ku.nonRepudiation)throw Error('usage');
      // Do not treat TLS-only certificates as document-signing certificates.
      if(eku&&!eku.emailProtection&&!eku['1.3.6.1.5.5.7.3.36']&&!eku['2.5.29.37.0'])throw Error('eku');
      const now=new Date();
      const ordered=[leaf],remaining=chain.slice(1);
      while(remaining.length){
        const parent=remaining.findIndex(c=>ordered[ordered.length-1].isIssuer(c));
        if(parent<0)throw Error('chain');ordered.push(remaining.splice(parent,1)[0]);
      }
      f.pki.verifyCertificateChain(f.pki.createCaStore(anchors),ordered,{validityCheckDate:now});
      self.postMessage({ok:true,chainVerified:true,revocationVerified:false,trustSource:'user-supplied-anchors'});
    }else throw Error('operation');
  }catch{
    // Library errors can contain key/certificate internals. Return only a fixed code.
    self.postMessage({ok:false,errorCode:data.operation==='pkcs12'?'PKCS12':'CHAIN'});
  }
};
