/* Sunrise PDF Editor Web · local-only AES-256 QPDF WASM worker.
 * Dedicated worker is terminated after each operation (also on cancellation).
 * No fetch of user PDFs, no network transmission, no storage or logging of credentials.
 * Runtime integration pending independent verification after dependency installation.
 */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
const WASM_URL = '/assets/pdfstudio/wasm/qpdf.wasm';
const JS_URL = '/assets/pdfstudio/index.js';

self.onmessage = async event => {
  const message = event.data || {};
  let pdf;
  try {
    if (!(message.input instanceof ArrayBuffer) || message.input.byteLength < 100 ||
        message.input.byteLength > MAX_INPUT_BYTES || typeof message.password !== 'string') {
      throw Error('Invalid input');
    }
    let module;
    try { module = await import(JS_URL); }
    catch { self.postMessage({ ok: false, errorCode: 'DEPENDENCY' }); return; }
    if (typeof module.createPdfToolkit !== 'function') {
      self.postMessage({ ok: false, errorCode: 'DEPENDENCY' }); return;
    }
    pdf = await module.createPdfToolkit({ wasmUrl: WASM_URL });
    const source = new Uint8Array(message.input);
    const attachmentNames=info=>JSON.stringify((info.attachments||[]).map(a=>[a.name,a.filename||'',a.description||'']).sort((a,b)=>a[0].localeCompare(b[0])));
    if(message.operation==='compress'){
      const before=await pdf.getInfo(source);
      if(before.encrypted||before.pageCount<1||before.pageCount>200)throw Error('Unsupported compression input');
      const compressed=await pdf.compress(source,{compressionLevel:9,objectStreams:true,linearize:false});
      const after=await pdf.getInfo(compressed);
      if(after.encrypted||after.pageCount!==before.pageCount||attachmentNames(after)!==attachmentNames(before))throw Error('Compression changed document structure');
      const output=(compressed.length<source.length?compressed:source).slice();
      self.postMessage({ok:true,operation:'compress',output:output.buffer,pageCount:after.pageCount,encrypted:false},[output.buffer]);
      return;
    }
    if(message.operation==='unlock'){
      if(typeof message.password!=='string'||!message.password.length||
         new TextEncoder().encode(message.password).length>127||message.password.includes('\0'))
        throw Error('Invalid unlock password');
      if(!await pdf.isEncrypted(source))throw Error('Source not encrypted');
      const before=await pdf.getInfo(source,{password:message.password});
      if(!Number.isSafeInteger(before.pageCount)||before.pageCount<1||before.pageCount>200)
        throw Error('Unsupported encrypted PDF page count');
      const unlocked=await pdf.unlock(source,{password:message.password});
      if(!(unlocked instanceof Uint8Array)||unlocked.byteLength<100||await pdf.isEncrypted(unlocked))
        throw Error('PDF unlock output remained encrypted');
      const after=await pdf.getInfo(unlocked);
      if(after.pageCount!==before.pageCount||attachmentNames(after)!==attachmentNames(before))throw Error('PDF unlock lost pages or attachments');
      const output=unlocked.slice();
      self.postMessage({ok:true,operation:'unlock',output:output.buffer,
        pageCount:after.pageCount,encrypted:false},[output.buffer]);
      return;
    }
    if(message.operation!=='lock')throw Error('Unsupported PDF password operation');
    if (await pdf.isEncrypted(source)) throw Error('Encrypted input not supported');
    const before = await pdf.getInfo(source);
    if (!Number.isSafeInteger(before.pageCount) || before.pageCount < 1 || before.pageCount > 200) {
      throw Error('Unsupported page count');
    }
    // Distinct owner and user credentials; a 256-bit random owner secret is used
    // when the user does not supply one. No password or owner secret is logged.
    let ownerPassword = message.ownerPassword;
    if(ownerPassword === null || ownerPassword === undefined || ownerPassword === ''){
      const random=new Uint8Array(32);
      self.crypto.getRandomValues(random);
      ownerPassword=Array.from(random,b=>b.toString(16).padStart(2,'0')).join('');
      random.fill(0);
    }
    if(typeof ownerPassword !== 'string'||ownerPassword===message.password||
       ownerPassword.length<12||new TextEncoder().encode(ownerPassword).length>127||
       ownerPassword.includes('\0'))throw Error('Invalid owner password');
    const locked = await pdf.lock(source, {
      userPassword: message.password,
      ownerPassword,
      keyLength: 256,
    });
    ownerPassword = null;
    if (!(locked instanceof Uint8Array) || locked.length < 100 ||
        !(await pdf.isEncrypted(locked)) || !(await pdf.requiresPassword(locked))) {
      throw Error('Encryption verification failed');
    }
    const info = await pdf.getInfo(locked, { password: message.password });
    if (info.pageCount !== before.pageCount || info.encryption?.bits !== 256 ||
        info.encryption?.method !== 'AESv3'||attachmentNames(info)!==attachmentNames(before)) {
      throw Error('Encrypted PDF metadata mismatch');
    }
    const invalidBytes=new Uint8Array(24);self.crypto.getRandomValues(invalidBytes);
    const invalidPassword=Array.from(invalidBytes,b=>b.toString(16).padStart(2,'0')).join('');invalidBytes.fill(0);
    let wrongPasswordAccepted=false;
    try{await pdf.getInfo(locked,{password:invalidPassword});wrongPasswordAccepted=true;}
    catch(error){if(error?.name!=='PdfPasswordError')throw Error('Wrong-password check could not be completed');}
    if(wrongPasswordAccepted)throw Error('Wrong password accepted');
    const bytes = locked.slice();
    self.postMessage({ ok: true, operation:'lock', output: bytes.buffer, pageCount: info.pageCount,
      bits: 256, encryption: 'AESv3', requiresPassword: true }, [bytes.buffer]);
  } catch {
    // Do not echo QPDF error details: they may include passwords or PDF internals.
    self.postMessage({ ok: false, errorCode: 'ENCRYPTION' });
  } finally {
    pdf = null;
  }
};
