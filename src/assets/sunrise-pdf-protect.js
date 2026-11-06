/* Sunrise PDF Editor Web · USR-14 local AES-256 PDF password protection.
 * Uses bundled QPDF WebAssembly in a dedicated same-origin worker.
 * Never uploads the input file or persists the password.
 * Code authored in DEV4: runtime/cryptographic interoperability NOT YET VERIFIED.
 */
(function (root) {
  'use strict';
  const LIMIT_BYTES = 20 * 1024 * 1024;
  const WORKER_URL = '/assets/sunrise-pdf-protect-worker.js';

  function validatePassword(password) {
    if (typeof password !== 'string' || password.length < 12 || password.includes('\0')) {
      throw new Error('열기 암호는 12자 이상이며 NUL 문자를 포함할 수 없습니다.');
    }
    const encoded = new TextEncoder().encode(password);
    if (encoded.length > 127) throw new Error('열기 암호는 UTF-8 기준 127바이트 이하여야 합니다.');
    return true;
  }

  function unlockPassword(password){
    if(typeof password !== 'string'||!password.length||password.includes('\0')||
       new TextEncoder().encode(password).length>127)
      throw Error('PDF 열기 암호는 1~127바이트이며 NUL 문자를 포함할 수 없습니다.');
  }

  function workerOperation(operation,{bytes,password,ownerPassword,signal}={}){
    if(operation==='lock'){
      validatePassword(password);
      if(ownerPassword !== undefined && ownerPassword !== null && ownerPassword !== ''){
        validatePassword(ownerPassword);
        if(ownerPassword === password)throw Error('소유자 암호는 열기 암호와 달라야 합니다.');
      }
    }else if(operation==='unlock'){
      unlockPassword(password);
    }else if(operation==='compress'){
      password='';
    }else throw Error('지원하지 않는 PDF 암호 작업입니다.');
    if(!(bytes instanceof Uint8Array)||bytes.byteLength<100||bytes.byteLength>LIMIT_BYTES)
      throw Error('PDF 입력 크기는 100바이트~20MiB까지 지원합니다.');
    if(!root.isSecureContext||typeof root.Worker!=='function'||typeof WebAssembly!=='object')
      throw Error('HTTPS 또는 localhost에서 WebAssembly와 Worker를 지원하는 브라우저가 필요합니다.');
    if(signal?.aborted)return Promise.reject(new DOMException('작업 취소','AbortError'));
    const copy=bytes.slice(); // Never detach the live editor's original Uint8Array.
    return new Promise((resolve,reject)=>{
      let worker;
      try{worker=new Worker(WORKER_URL,{type:'module',name:'sunrise-pdf-password'});}
      catch{reject(Error('PDF 암호 엔진 Worker를 시작하지 못했습니다.'));return;}
      let settled=false;
      const timeout=setTimeout(()=>complete(Error('PDF 암호 작업이 120초를 초과했습니다. 파일을 나누어 처리하세요.')),120000);
      function complete(error,output){
        if(settled)return;
        settled=true;clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();
        if(error)reject(error);else resolve(output);
      }
      function abort(){complete(new DOMException('PDF 암호 작업 취소','AbortError'));}
      signal?.addEventListener('abort',abort,{once:true});
      worker.onerror=()=>complete(Error('PDF 암호 엔진을 불러오거나 실행하지 못했습니다.'));
      worker.onmessageerror=()=>complete(Error('PDF 암호 결과를 읽을 수 없습니다.'));
      worker.onmessage=event=>{
        const data=event.data||{};
        if(data.ok!==true){
          const missing=data.errorCode==='DEPENDENCY';
          complete(Error(missing?'QPDF WebAssembly를 불러오지 못했습니다.':
            operation==='compress'?'무손실 압축을 완료하지 못했습니다. 원본은 변경되지 않았습니다.':
            operation==='unlock'?'암호 해제 실패: 비밀번호·원본 암호화 형식을 확인하세요.':
              '표준 PDF AES-256 암호 보호에 실패했습니다. 원본은 변경되지 않았습니다.'));
          return;
        }
        if(!(data.output instanceof ArrayBuffer)||data.operation!==operation||
           !Number.isSafeInteger(data.pageCount)||data.pageCount<1||data.pageCount>200||data.output.byteLength<100||data.output.byteLength>40*1024*1024||
           (operation==='lock'&&(data.encryption!=='AESv3'||data.bits!==256||data.requiresPassword!==true))||
           (['unlock','compress'].includes(operation)&&data.encrypted!==false)){
          complete(Error('PDF 암호 결과의 메타데이터가 올바르지 않아 저장하지 않았습니다.'));
          return;
        }
        complete(null,{bytes:new Uint8Array(data.output),pages:data.pageCount,
          bits:data.bits||0,method:data.encryption||null});
      };
      try{worker.postMessage({input:copy.buffer,password,
        ownerPassword:operation==='lock'?ownerPassword||null:null,operation},[copy.buffer]);}
      catch{complete(Error('암호 작업 입력을 Worker에 전달하지 못했습니다.'));}
    });
  }
  function assertUnsignedPdf(pdf,lib){
    const n=lib.PDFName.of;
    if(pdf.isEncrypted||pdf.catalog.has(n('Perms')))throw Error('기존 서명·암호 보호 문서는 처리하지 않습니다.');
    const form=pdf.context.lookup(pdf.catalog.get(n('AcroForm')));
    if(form?.has?.(n('XFA'))||form?.has?.(n('SigFlags')))throw Error('XFA 또는 서명 양식은 처리하지 않습니다.');
    for(const [,object] of pdf.context.enumerateIndirectObjects()){
      if(object?.get?.(n('ByteRange'))||object?.get?.(n('Type'))?.toString()==='/Sig')throw Error('기존 전자서명 문서는 암호화로 다시 작성하지 않습니다.');
    }
  }
  function protectPdf(options){return workerOperation('lock',options);}
  function unlockPdf(options){return workerOperation('unlock',options);}
  function compressPdf(options){return workerOperation('compress',options);}

  root.SunrisePdfProtect = Object.freeze({ protectPdf, unlockPdf, compressPdf, validatePassword, assertUnsignedPdf, LIMIT_BYTES });
})(typeof window !== 'undefined' ? window : globalThis);
