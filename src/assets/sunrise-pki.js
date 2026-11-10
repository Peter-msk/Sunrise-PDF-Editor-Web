(function(root){
  'use strict';
  function run(operation,payload,signal){
    if(!root.isSecureContext||typeof root.Worker!=='function')return Promise.reject(Error('인증서 처리는 HTTPS 또는 localhost에서 사용하세요.'));
    if(signal?.aborted)return Promise.reject(new DOMException('취소','AbortError'));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('/assets/sunrise-pki-worker.js',{name:'sunrise-local-pki'});
      let done=false;
      const timer=setTimeout(()=>finish(Error('인증서 처리 시간을 초과했습니다. 파일 형식을 확인하세요.')),30000);
      function finish(error,value){
        if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);worker.terminate();
        if(error)reject(error);else resolve(value);
      }
      function abort(){finish(new DOMException('인증서 작업 취소','AbortError'));}
      signal?.addEventListener('abort',abort,{once:true});
      worker.onerror=()=>finish(Error('인증서 처리 엔진을 불러오지 못했습니다.'));
      worker.onmessageerror=()=>finish(Error('인증서 처리 결과를 읽지 못했습니다.'));
      worker.onmessage=event=>{
        const data=event.data||{};
        if(!data.ok){finish(Error(operation==='pkcs12'?'P12/PFX 비밀번호·MAC·RSA 인증서와 키 쌍을 확인하세요.':'인증서 체인·유효기간·용도·신뢰 루트를 확인하세요.'));return;}
        if(operation==='pkcs12'&&(typeof data.certificatePem!=='string'||typeof data.privateKeyPem!=='string'||data.certificatePem.length>128*1024||data.privateKeyPem.length>48*1024)){
          finish(Error('인증서 컨테이너 결과가 올바르지 않습니다.'));return;
        }
        if(operation==='chain'&&data.chainVerified!==true){finish(Error('인증서 체인 확인이 완료되지 않았습니다.'));return;}
        finish(null,data);
      };
      // Abort may arrive during Worker creation, before listener registration.
      // Avoid sending certificates or private-key containers after cancellation.
      if(signal?.aborted){abort();return;}
      if(done)return;
      try{worker.postMessage({operation,...payload},payload.bytes?[payload.bytes]:[]);}
      catch{finish(Error('인증서 입력을 전달하지 못했습니다.'));}
    });
  }
  async function signPdfWithPkcs12({bytes,container,password,PDFLib,signal,trustAnchorsPem,incremental=false}){
    if(!(container instanceof Uint8Array)||container.length<20||container.length>512*1024)throw Error('P12/PFX는 512KiB 이하로 선택하세요.');
    let material;
    try{
      material=await run('pkcs12',{bytes:container.slice().buffer,password},signal);
      if(signal?.aborted)throw new DOMException('취소','AbortError');
      return await root.SunrisePdfCms.signPdfWithPem({bytes,certificatePem:material.certificatePem,
        privateKeyPem:material.privateKeyPem,PDFLib,profile:'cades',signal,trustAnchorsPem,incremental});
    }finally{if(material){material.privateKeyPem=null;material.certificatePem=null;}}
  }
  function verifyChain(certificatePem,trustAnchorsPem,signal){
    const split=pem=>String(pem||'').match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[];
    return run('chain',{chain:split(certificatePem),anchors:split(trustAnchorsPem)},signal);
  }
  root.SunrisePki=Object.freeze({signPdfWithPkcs12,verifyChain});
})(typeof window!=='undefined'?window:globalThis);
