/* Sunrise PDF Editor Web — USR-15 detached X.509/CMS signer (PEM RSA only).
 * Produces a PDF signature field with a detached CMS /adbe.pkcs7.detached value.
 * Uses browser WebCrypto; key material is never transmitted or persisted here.
 * Unencrypted PDF/AcroForm input, with optional append-only approval signatures;
 * PEM X.509 chain + unencrypted PKCS#8 RSA private key, SHA-256, RSA-PKCS1-v1_5.
 * Optional user-selected trust anchors; no revocation/PAdES LTV claims.
 */
(function(root){
  'use strict';
  const MAX_PDF_BYTES=25*1024*1024;
  const MAX_CERT_BYTES=18*1024;
  const MAX_PEM_TEXT=128*1024;
  const MAX_KEY_TEXT=48*1024;
  const CONTENTS_HEX_LEN=49152; // 24 KiB CMS reservation; fail closed on overflow.
  const BYTE_RANGE_PLACEHOLDER='1111111111';
  const SHA256_OID='2.16.840.1.101.3.4.2.1';
  const RSA_OID='1.2.840.113549.1.1.1';
  const DATA_OID='1.2.840.113549.1.7.1';
  const SIGNED_DATA_OID='1.2.840.113549.1.7.2';

  function concat(...chunks){
    const length=chunks.reduce((n,b)=>n+b.length,0);
    if(length>32*1024*1024)throw Error('서명 바이트 배열이 제한을 초과했습니다.');
    const out=new Uint8Array(length);let pos=0;
    for(const part of chunks){out.set(part,pos);pos+=part.length;}
    return out;
  }
  function ascii(str){return Uint8Array.from(str,ch=>ch.charCodeAt(0));}
  function hex(bytes){let result='';for(const b of bytes)result+=b.toString(16).padStart(2,'0');return result.toUpperCase();}
  function latin1(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...bytes.subarray(i,i+8192));return result;}
  function same(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];return diff===0;}

  // Strict ASN.1 DER length parsing: no indefinite lengths or trailing bytes.
  function tlv(data,offset){
    if(offset>=data.length)throw Error('인증서 ASN.1 구조가 잘렸습니다.');
    const start=offset,tag=data[offset++];
    if(offset>=data.length)throw Error('ASN.1 길이를 읽을 수 없습니다.');
    let len=data[offset++];
    if(len&0x80){
      const count=len&0x7f;
      if(!count||count>4||offset+count>data.length||data[offset]===0)
        throw Error('지원하지 않는 DER 길이입니다.');
      len=0;for(let i=0;i<count;i++)len=len*256+data[offset++];
      if(len<128)throw Error('DER 길이 표기가 최소 형식이 아닙니다.');
    }
    if(len>data.length-offset)throw Error('인증서 ASN.1 길이가 범위를 벗어났습니다.');
    return {tag,start,valueStart:offset,end:offset+len,bytes:data.subarray(start,offset+len)};
  }
  function children(data,node){
    const arr=[];let pos=node.valueStart;
    while(pos<node.end){const item=tlv(data,pos);arr.push(item);pos=item.end;}
    if(pos!==node.end)throw Error('인증서 ASN.1 자식 길이가 잘못되었습니다.');
    return arr;
  }
  function readX509(cert,allowExpired=false){
    const outer=tlv(cert,0);
    if(outer.tag!==0x30||outer.end!==cert.length)throw Error('X.509 인증서 형식이 올바르지 않습니다.');
    const outerParts=children(cert,outer),tbs=outerParts[0];
    if(outerParts.length!==3||tbs?.tag!==0x30)throw Error('X.509 인증서 본문이 없습니다.');
    const parts=children(cert,tbs),offset=parts[0]?.tag===0xa0?1:0;
    const serial=parts[offset],issuer=parts[offset+2],validity=parts[offset+3],spki=parts[offset+5];
    if(serial?.tag!==0x02||issuer?.tag!==0x30||validity?.tag!==0x30||spki?.tag!==0x30)
      throw Error('X.509 인증서의 일련번호·발급자·공개키 구조가 잘못되었습니다.');
    const period=children(cert,validity);
    if(period.length!==2)throw Error('X.509 인증서 유효기간을 읽을 수 없습니다.');
    const readTime=node=>{
      const raw=latin1(cert.subarray(node.valueStart,node.end));
      if(node.tag===0x17&&/^\d{12}Z$/.test(raw)){
        const y=Number(raw.slice(0,2));
        return Date.UTC(y>=50?1900+y:2000+y,Number(raw.slice(2,4))-1,Number(raw.slice(4,6)),Number(raw.slice(6,8)),Number(raw.slice(8,10)),Number(raw.slice(10,12)));
      }
      if(node.tag===0x18&&/^\d{14}Z$/.test(raw)){
        return Date.UTC(Number(raw.slice(0,4)),Number(raw.slice(4,6))-1,Number(raw.slice(6,8)),Number(raw.slice(8,10)),Number(raw.slice(10,12)),Number(raw.slice(12,14)));
      }
      throw Error('지원하지 않는 X.509 인증서 유효기간 형식입니다.');
    };
    const start=readTime(period[0]),end=readTime(period[1]),now=Date.now();
    if(!Number.isFinite(start)||!Number.isFinite(end)||(!allowExpired&&(now<start||now>end)))
      throw Error('인증서가 현재 유효기간 내에 있지 않습니다.');
    return {issuer:issuer.bytes,serial:serial.bytes,spki:spki.bytes,currentlyValid:now>=start&&now<=end};
  }
  function decodePemBlock(text,label){
    const marker='-----BEGIN '+label+'-----',end='-----END '+label+'-----';
    const blocks=[];let offset=0;
    while(true){
      const start=text.indexOf(marker,offset);
      if(start<0)break;
      const stop=text.indexOf(end,start+marker.length);
      if(stop<0)throw Error(label+' PEM 종료 표시가 없습니다.');
      const body=text.slice(start+marker.length,stop).replace(/\s+/g,'');
      if(!body||body.length>MAX_PEM_TEXT||body.length%4!==0||
         !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body))
        throw Error(label+' PEM Base64 데이터가 올바르지 않습니다.');
      const decoded=atob(body);
      blocks.push(Uint8Array.from(decoded,ch=>ch.charCodeAt(0)));
      offset=stop+end.length;
    }
    return blocks;
  }
  // Limited encrypted PKCS#8 support: RFC 8018 PBES2 + PBKDF2 + AES-256-CBC.
  // Unsupported cipher/KDF variants fail closed. Password material is never persisted.
  const PBES2_OID='1.2.840.113549.1.5.13';
  const PBKDF2_OID='1.2.840.113549.1.5.12';
  const AES256_CBC_OID='2.16.840.1.101.3.4.1.42';
  const PRF_HASHES=Object.freeze({
    '1.2.840.113549.2.7':'SHA-1',
    '1.2.840.113549.2.9':'SHA-256',
    '1.2.840.113549.2.11':'SHA-512'
  });
  function isOid(data,node,value){return node?.tag===0x06&&same(node.bytes,oid(value));}
  function readPositiveInt(data,node){
    if(node?.tag!==0x02||node.end-node.valueStart<1||node.end-node.valueStart>5)
      throw Error('암호화 개인키의 PBKDF2 반복 수가 올바르지 않습니다.');
    const raw=data.subarray(node.valueStart,node.end);
    if(raw[0]&0x80||(raw.length>1&&raw[0]===0&&!(raw[1]&0x80)))
      throw Error('암호화 개인키의 정수 인코딩이 잘못되었습니다.');
    let value=0;for(const digit of raw)value=value*256+digit;
    if(!Number.isSafeInteger(value))throw Error('암호화 개인키의 반복 수가 범위를 벗어났습니다.');
    return value;
  }
  async function decryptEncryptedPkcs8(derBytes,passphrase){
    if(typeof passphrase!=='string'||!passphrase.length||passphrase.length>1024)
      throw Error('암호화된 개인키의 비밀번호를 입력하세요.');
    const outer=tlv(derBytes,0);
    if(outer.tag!==0x30||outer.end!==derBytes.length)
      throw Error('암호화 PKCS#8의 ASN.1 형식이 잘못되었습니다.');
    const parts=children(derBytes,outer),alg=parts[0];
    if(parts.length!==2||alg.tag!==0x30||parts[1].tag!==0x04)
      throw Error('암호화 PKCS#8 키의 구조가 올바르지 않습니다.');
    const algs=children(derBytes,alg);
    if(algs.length!==2||!isOid(derBytes,algs[0],PBES2_OID)||algs[1].tag!==0x30)
      throw Error('PBES2 형식의 암호화된 PKCS#8 개인키만 지원합니다.');
    const params=children(derBytes,algs[1]);
    if(params.length!==2||params[0].tag!==0x30||params[1].tag!==0x30)
      throw Error('PBES2 KDF·암호화 파라미터가 없습니다.');
    const kdf=children(derBytes,params[0]),scheme=children(derBytes,params[1]);
    if(kdf.length!==2||!isOid(derBytes,kdf[0],PBKDF2_OID)||kdf[1].tag!==0x30||
       scheme.length!==2||!isOid(derBytes,scheme[0],AES256_CBC_OID)||scheme[1].tag!==0x04)
      throw Error('PBKDF2 + AES-256-CBC 암호화 PKCS#8 개인키만 지원합니다.');
    const kdfParams=children(derBytes,kdf[1]);
    if(kdfParams.length<2||kdfParams.length>4||kdfParams[0].tag!==0x04)
      throw Error('지원하지 않는 PBKDF2 파라미터입니다.');
    const salt=derBytes.subarray(kdfParams[0].valueStart,kdfParams[0].end);
    const iterations=readPositiveInt(derBytes,kdfParams[1]);
    if(salt.length<8||salt.length>64||iterations<1000||iterations>1_000_000)
      throw Error('PBKDF2 salt 또는 반복 횟수가 허용 범위를 벗어났습니다.');
    let position=2;
    if(kdfParams[position]?.tag===0x02){
      if(readPositiveInt(derBytes,kdfParams[position])!==32)
        throw Error('PBKDF2 출력 키 길이는 AES-256용 32바이트여야 합니다.');
      position++;
    }
    let hash='SHA-1'; // PBKDF2's documented ASN.1 default when the PRF is absent.
    if(kdfParams[position]){
      const prf=children(derBytes,kdfParams[position]);
      const match=Object.keys(PRF_HASHES).find(value=>isOid(derBytes,prf[0],value));
      if(kdfParams[position].tag!==0x30||prf.length<1||prf.length>2||
         (prf.length===2&&(prf[1].tag!==0x05||prf[1].end!==prf[1].valueStart))||!match)
        throw Error('지원하지 않는 PBKDF2 PRF 알고리즘입니다.');
      hash=PRF_HASHES[match];position++;
    }
    if(position!==kdfParams.length)throw Error('알 수 없는 PBKDF2 파라미터가 있습니다.');
    const iv=derBytes.subarray(scheme[1].valueStart,scheme[1].end);
    const ciphertext=derBytes.subarray(parts[1].valueStart,parts[1].end);
    if(iv.length!==16||ciphertext.length<16||ciphertext.length%16!==0)
      throw Error('AES-256-CBC 암호화 키 데이터가 잘못되었습니다.');
    const passwordBytes=new TextEncoder().encode(passphrase);
    if(passwordBytes.length>1024)throw Error('개인키 비밀번호가 너무 깁니다.');
    try{
      const material=await root.crypto.subtle.importKey('raw',passwordBytes,'PBKDF2',false,['deriveKey']);
      const aesKey=await root.crypto.subtle.deriveKey(
        {name:'PBKDF2',salt,iterations,hash},material,{name:'AES-CBC',length:256},false,['decrypt']);
      return new Uint8Array(await root.crypto.subtle.decrypt({name:'AES-CBC',iv},aesKey,ciphertext));
    }catch{throw Error('개인키 복호화에 실패했습니다. 비밀번호 또는 키 형식을 확인하세요.');}
    finally{passwordBytes.fill(0);}
  }
  function readPemMaterials(certificatePem,privateKeyPem){
    if(typeof certificatePem!=='string'||certificatePem.length>MAX_PEM_TEXT||
       typeof privateKeyPem!=='string'||privateKeyPem.length>MAX_KEY_TEXT)
      throw Error('PEM 인증서 또는 개인키 크기가 허용 범위를 초과했습니다.');
    const certs=decodePemBlock(certificatePem,'CERTIFICATE');
    const plain=decodePemBlock(privateKeyPem,'PRIVATE KEY');
    const encrypted=decodePemBlock(privateKeyPem,'ENCRYPTED PRIVATE KEY');
    if(!certs.length||certs.length>5||plain.length+encrypted.length!==1||
       privateKeyPem.includes('BEGIN RSA PRIVATE KEY'))
      throw Error('X.509 인증서 PEM과 PKCS#8 개인키 PEM(일반 또는 PBES2 암호화)이 필요합니다.');
    if(certs.reduce((n,c)=>n+c.length,0)>MAX_CERT_BYTES)
      throw Error('인증서 체인 크기가 제한을 초과합니다.');
    return {certs,key:plain[0]||encrypted[0],encrypted:Boolean(encrypted.length)};
  }
  function derLength(n){
    if(!Number.isSafeInteger(n)||n<0||n>0x3fffffff)throw Error('DER 길이가 범위를 벗어났습니다.');
    if(n<128)return Uint8Array.of(n);
    let size=n,parts=[];
    while(size){parts.unshift(size&255);size=Math.floor(size/256);}
    return Uint8Array.of(0x80|parts.length,...parts);
  }
  function der(tag,...parts){
    const value=concat(...parts);
    return concat(Uint8Array.of(tag),derLength(value.length),value);
  }
  function seq(...parts){return der(0x30,...parts);}
  function cmp(a,b){
    const len=Math.min(a.length,b.length);
    for(let i=0;i<len;i++)if(a[i]!==b[i])return a[i]-b[i];
    return a.length-b.length;
  }
  function set(...parts){return der(0x31,...parts.sort(cmp));}
  function oid(s){
    const nums=s.split('.').map(Number);
    if(nums.length<2||nums.some(n=>!Number.isSafeInteger(n)||n<0)||nums[0]>2||
       nums[0]<0||nums[1]>(nums[0]===2?Number.MAX_SAFE_INTEGER:39))
      throw Error('ASN.1 OID가 잘못되었습니다.');
    const values=[nums[0]*40+nums[1],...nums.slice(2)],out=[];
    for(let n of values){
      const b=[n&127];n=Math.floor(n/128);
      while(n){b.unshift((n&127)|128);n=Math.floor(n/128);}
      out.push(...b);
    }
    return der(0x06,Uint8Array.from(out));
  }
  const int1=()=>der(0x02,Uint8Array.of(1));
  const attr=(id,value)=>seq(oid(id),set(value));
  const shaAlgorithm=()=>seq(oid(SHA256_OID),der(0x05));
  const rsaAlgorithm=()=>seq(oid(RSA_OID),der(0x05));
  function cmsSignedAttributes(digest,certificateHash){
    const attributes=[attr('1.2.840.113549.1.9.3',oid(DATA_OID)),attr('1.2.840.113549.1.9.4',der(0x04,digest))];
    if(certificateHash)attributes.push(attr('1.2.840.113549.1.9.16.2.47',seq(seq(seq(der(0x04,certificateHash))))));
    return set(...attributes);
  }
  function toCMS(certs,x509,attributes,signature){
    const signedAttrs=der(0xa0,attributes.subarray(tlv(attributes,0).valueStart));
    const signerInfo=seq(
      int1(),seq(x509.issuer,x509.serial),shaAlgorithm(),
      signedAttrs,rsaAlgorithm(),der(0x04,signature)
    );
    const signedData=seq(
      int1(),set(shaAlgorithm()),seq(oid(DATA_OID)),
      der(0xa0,...certs.slice().sort(cmp)),set(signerInfo)
    );
    return seq(oid(SIGNED_DATA_OID),der(0xa0,signedData));
  }
  function validateInput(bytes,PDFLib,incremental=false){
    if(!(bytes instanceof Uint8Array)||bytes.length<100||bytes.length>MAX_PDF_BYTES)
      throw Error('서명할 PDF는 25MiB 이하의 정상 파일이어야 합니다.');
    if(!PDFLib?.PDFDocument?.load||!PDFLib?.PDFName||!PDFLib?.PDFHexString)
      throw Error('PDF 처리 엔진이 준비되지 않았습니다.');
    if(latin1(bytes.subarray(0,8)).slice(0,5)!=='%PDF-')
      throw Error('PDF 원본 헤더가 올바르지 않습니다.');
    // Conservative block: signing rewrites the PDF. Never destroy an existing signature.
    const raw=latin1(bytes);
    if(!incremental&&/\/ByteRange\b|\/DocTimeStamp\b|\/SigFlags\b/.test(raw))
      throw Error('기존 서명 또는 서명 관련 구조가 있는 PDF는 재서명하지 않습니다.');
  }
  function placeholderPdf(pdfDoc,PDFLib,profile,incremental=false){
    const {PDFName,PDFHexString,PDFNumber,PDFString}=PDFLib;
    const name=PDFName.of,ctx=pdfDoc.context;
    if(pdfDoc.catalog.has(name('Perms'))||pdfDoc.catalog.has(name('Encrypt')))
      throw Error('기존 서명·보안 설정이 있는 PDF는 서명할 수 없습니다.');
    for(const [,object] of ctx.enumerateIndirectObjects()){
      if(!incremental&&(object?.get?.(name('ByteRange'))||object?.get?.(name('Type'))?.toString()==='/Sig'))throw Error('기존 서명이 있는 PDF는 재작성하지 않습니다.');
      if(incremental&&object?.get?.(name('Reference')))throw Error('변경 권한을 제한한 인증 서명은 추가 서명하지 않습니다.');
      if(incremental&&object?.get?.(name('Lock')))throw Error('필드 잠금이 있는 서명 문서는 추가 서명하지 않습니다.');
    }
    const previous=pdfDoc.catalog.get(name('AcroForm'));
    const existing=previous?ctx.lookup(previous):null;
    if(existing&&(!(existing instanceof PDFLib.PDFDict)||existing.has(name('XFA'))||!incremental&&existing.has(name('SigFlags'))))throw Error('XFA 또는 기존 서명 양식은 지원하지 않습니다.');
    const oldFields=existing?ctx.lookup(existing.get(name('Fields'))):null;
    if(existing&&(!(oldFields instanceof PDFLib.PDFArray)||oldFields.size()>1000))throw Error('양식 필드 구조가 올바르지 않습니다.');
    const pages=pdfDoc.getPages();
    if(!pages.length||pages.length>200)throw Error('서명은 1~200쪽 PDF만 지원합니다.');
    const now=new Date().toISOString().slice(0,19).replace(/[-:T]/g,'');
    const signature=ctx.obj({
      Type:name('Sig'),Filter:name('Adobe.PPKLite'),SubFilter:name(profile==='cades'?'ETSI.CAdES.detached':'adbe.pkcs7.detached'),
      ByteRange:ctx.obj([0,1111111111,1111111111,1111111111]),
      Contents:PDFHexString.of('0'.repeat(CONTENTS_HEX_LEN)),
      M:PDFString.of('D:'+now+'Z'),
      Reason:PDFString.of('Certificate-based document signature')
    });
    const signatureRef=ctx.register(signature);
    const page=pages[0];
    const widget=ctx.obj({
      Type:name('Annot'),Subtype:name('Widget'),FT:name('Sig'),
      T:PDFString.of('SunriseDigitalSignature_'+Date.now().toString(36)),
      Rect:ctx.obj([0,0,0,0]),P:page.ref,V:signatureRef,
      F:PDFNumber.of(4)
    });
    const widgetRef=ctx.register(widget);
    page.node.addAnnot(widgetRef);
    const fields=oldFields?oldFields.clone():ctx.obj([]);fields.push(widgetRef);
    const form=existing?existing.clone():ctx.obj({});form.set(name('Fields'),fields);form.set(name('SigFlags'),PDFNumber.of(3));
    pdfDoc.catalog.set(name('AcroForm'),ctx.register(form));
  }

  // ISO 32000-1 7.5.6: preserve the original byte prefix and append only changed
  // objects, a new cross-reference section and a trailer linked by /Prev.
  function appendRevision(original,pdf,before,lib){
    if(pdf.isEncrypted)throw Error('암호화 PDF에는 증분 서명하지 않습니다.');
    const tail=latin1(original.subarray(Math.max(0,original.length-256)));
    const previous=/startxref\s+(\d+)\s+%%EOF[\r\n\x20]*$/.exec(tail);
    if(!previous)throw Error('마지막 PDF 교차 참조 위치를 확인할 수 없습니다.');
    const prev=Number(previous[1]);
    if(!Number.isSafeInteger(prev)||prev<=0||prev>=original.length)throw Error('이전 교차 참조 위치가 잘못되었습니다.');
    const chunks=[original,ascii('\n')],entries=[];let offset=original.length+1;
    for(const [ref,obj] of pdf.context.enumerateIndirectObjects()){
      if(before.get(ref.toString())===obj.toString())continue;
      const lead=ascii(ref.objectNumber+' '+ref.generationNumber+' obj\n'),end=ascii('\nendobj\n');
      const body=new Uint8Array(obj.sizeInBytes()),written=obj.copyBytesInto(body,0);
      if(written!==body.length)throw Error('증분 객체 직렬화 크기가 일치하지 않습니다.');
      entries.push({ref,offset});chunks.push(lead,body,end);offset+=lead.length+body.length+end.length;
    }
    if(!entries.length||entries.length>10000)throw Error('증분 서명 객체 수가 올바르지 않습니다.');
    const xrefOffset=offset,ctx=pdf.context,n=lib.PDFName.of;
    let xref='xref\n';
    entries.sort((a,b)=>a.ref.objectNumber-b.ref.objectNumber);
    for(const {ref,offset:position} of entries)xref+=ref.objectNumber+' 1\n'+String(position).padStart(10,'0')+' '+String(ref.generationNumber).padStart(5,'0')+' n \n';
    const trailer=ctx.obj({Size:ctx.largestObjectNumber+1,Root:ctx.trailerInfo.Root,Prev:prev});
    for(const key of ['Info','ID'])if(ctx.trailerInfo[key])trailer.set(n(key),ctx.trailerInfo[key]);
    chunks.push(ascii(xref+'trailer\n'+trailer.toString()+'\nstartxref\n'+xrefOffset+'\n%%EOF\n'));
    const result=concat(...chunks);
    if(result.length>MAX_PDF_BYTES)throw Error('증분 서명 결과가 25MiB를 초과했습니다.');
    return result;
  }

  function fillByteRange(bytes,revisionStart=0){
    const text=latin1(bytes);
    const rx=/\/ByteRange\s*\[\s*0\s+1111111111\s+1111111111\s+1111111111\s*\]/g;
    const matches=[...text.matchAll(rx)].filter(match=>match.index>=revisionStart);
    if(matches.length!==1)throw Error('PDF 서명 ByteRange 예약 위치가 유일하지 않습니다.');
    const found=matches[0],next=text.indexOf('/Contents',found.index+found[0].length);
    if(next<0||next-found.index>250||text.indexOf('/ByteRange',next+1)!==-1)
      throw Error('PDF 서명 내용 영역 위치가 올바르지 않습니다.');
    const content=text.slice(next).match(/^\/Contents\s*<([0-9A-Fa-f]+)>/);
    if(!content||content[1].length!==CONTENTS_HEX_LEN||!/^(?:0+)$/.test(content[1]))
      throw Error('PDF 서명 내용 예약 크기가 올바르지 않습니다.');
    const gapStart=next+content[0].indexOf('<'),gapEnd=gapStart+CONTENTS_HEX_LEN+2;
    const byteRange=[0,gapStart,gapEnd,bytes.length-gapEnd];
    if(byteRange.some(n=>!Number.isSafeInteger(n)||n<0||n>9999999999))
      throw Error('PDF 서명 ByteRange 수가 너무 큽니다.');
    let field=1;
    const replacement=found[0].replace(/1111111111/g,()=>String(byteRange[field++]).padStart(10,'0'));
    if(replacement.length!==found[0].length)throw Error('PDF 서명 길이 예약에 실패했습니다.');
    bytes.set(ascii(replacement),found.index);
    return {bytes,byteRange,gapStart,gapEnd};
  }
  async function signPdfWithPem({bytes,certificatePem,privateKeyPem,keyPassword,PDFLib,profile='pkcs7',signal,trustAnchorsPem,incremental=false}){
    const checkAbort=()=>{if(signal?.aborted)throw new DOMException('서명 취소','AbortError');};
    if(!['pkcs7','cades'].includes(profile))throw Error('서명 프로필을 확인하세요.');
    checkAbort();
    let chainVerified=false;
    if(trustAnchorsPem){
      if(!root.SunrisePki?.verifyChain)throw Error('인증서 체인 엔진이 없습니다.');
      const trust=await root.SunrisePki.verifyChain(certificatePem,trustAnchorsPem,signal);
      chainVerified=trust.chainVerified===true;
    }
    validateInput(bytes,PDFLib,incremental);
    if(!root.crypto?.subtle||!root.isSecureContext)
      throw Error('인증서 전자서명은 HTTPS 또는 localhost의 보안 컨텍스트에서만 사용할 수 있습니다.');
    const material=readPemMaterials(certificatePem,privateKeyPem);
    const {certs}=material,x509=readX509(certs[0]);
    let privateKey,publicKey;
    let keyBytes;
    try{
      if(material.encrypted){
        keyBytes=await decryptEncryptedPkcs8(material.key,keyPassword);
      }else{
        if(keyPassword)throw Error('일반 PKCS#8 개인키에는 암호를 입력하지 마세요.');
        keyBytes=material.key;
      }
      privateKey=await root.crypto.subtle.importKey('pkcs8',keyBytes,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
      publicKey=await root.crypto.subtle.importKey('spki',x509.spki,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    }catch(error){
      if(String(error?.message||'').startsWith('일반 PKCS#8'))throw error;
      if(String(error?.message||'').startsWith('개인키 복호화')||String(error?.message||'').includes('PBES2')||
         String(error?.message||'').includes('PBKDF2')||String(error?.message||'').includes('AES-256-CBC')||
         String(error?.message||'').includes('비밀번호'))throw error;
      throw Error('RSA PKCS#8 개인키 또는 인증서 공개키를 불러오지 못했습니다.');
    }finally{
      keyBytes?.fill(0);
      if(material.encrypted)material.key.fill(0);
    }
    if(privateKey.algorithm.modulusLength<2048||privateKey.algorithm.modulusLength>4096||
       publicKey.algorithm.modulusLength!==privateKey.algorithm.modulusLength)
      throw Error('2048~4096비트 RSA 키 쌍만 지원합니다.');
    const probe=ascii('Sunrise PDF digital signature PEM key pair check');
    const trial=new Uint8Array(await root.crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,probe));
    if(!await root.crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,trial,probe))
      throw Error('인증서 공개키와 개인키가 일치하지 않습니다.');
    checkAbort();
    const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false});
    let originalSignatures=null;
    if(incremental&&/\/ByteRange\b/.test(latin1(bytes)))originalSignatures=await verifyPdfSignature({bytes,PDFLib});
    const before=incremental?new Map(pdf.context.enumerateIndirectObjects().map(([ref,obj])=>[ref.toString(),obj.toString()])):null;
    placeholderPdf(pdf,PDFLib,profile,incremental);
    const staged=incremental?appendRevision(bytes,pdf,before,PDFLib):await pdf.save({useObjectStreams:false,updateFieldAppearances:false});
    const entry=fillByteRange(staged,incremental?bytes.length:0);
    const [a,b,c,d]=entry.byteRange;
    const signedBytes=concat(staged.subarray(a,a+b),staged.subarray(c,c+d));
    const messageDigest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',signedBytes));
    checkAbort();
    const certificateHash=profile==='cades'?new Uint8Array(await root.crypto.subtle.digest('SHA-256',certs[0])):null;
    const attrs=cmsSignedAttributes(messageDigest,certificateHash);
    const signature=new Uint8Array(await root.crypto.subtle.sign('RSASSA-PKCS1-v1_5',privateKey,attrs));
    if(!await root.crypto.subtle.verify('RSASSA-PKCS1-v1_5',publicKey,signature,attrs))
      throw Error('CMS 서명 생성 후 개인키·인증서 자체 확인에 실패했습니다.');
    const cms=toCMS(certs,x509,attrs,signature),cmsHex=hex(cms);
    if(cmsHex.length>CONTENTS_HEX_LEN)
      throw Error('CMS 인증서 서명이 예약 공간을 초과합니다. 인증서 체인을 줄여주세요.');
    const padded=cmsHex.padEnd(CONTENTS_HEX_LEN,'0');
    if(entry.gapEnd-entry.gapStart!==CONTENTS_HEX_LEN+2)
      throw Error('PDF 서명 영역 길이 보존에 실패했습니다.');
    staged.set(ascii(padded),entry.gapStart+1);
    // A final in-memory integrity check without ever reopening/saving the signed PDF.
    const finalDigest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',concat(
      staged.subarray(a,a+b),staged.subarray(c,c+d))));
    if(!same(messageDigest,finalDigest)||
       staged[entry.gapStart]!==60||staged[entry.gapEnd-1]!==62)
      throw Error('PDF ByteRange 또는 CMS 서명 영역 무결성 확인에 실패했습니다.');
    const parsedSignature=await verifyPdfSignature({bytes:staged,PDFLib});
    if(parsedSignature.cryptographicIntegrity!==true)throw Error('직렬화된 PDF 서명을 다시 검증하지 못했습니다.');
    checkAbort();
    return {bytes:staged,method:(profile==='cades'?'ETSI.CAdES.detached':'adbe.pkcs7.detached')+' / RSA-SHA256',
      certificateCount:certs.length,cryptographicSelfCheck:true,incremental,previousSignaturesPreserved:originalSignatures?.signatureCount||0,
      pkiTrustVerified:chainVerified,trustSource:chainVerified?'user-supplied-anchors':'not-checked',revocationVerified:false,timestampVerified:false,padesConformanceVerified:false};
  }
  async function verifyPdfSignature({bytes,PDFLib}){
    if(!(bytes instanceof Uint8Array)||bytes.length<100||bytes.length>MAX_PDF_BYTES||!root.crypto?.subtle)
      throw Error('서명 검사 대상은 25MiB 이하 PDF여야 합니다.');
    const pdf=await PDFLib.PDFDocument.load(bytes,{updateMetadata:false}),n=PDFLib.PDFName.of,ctx=pdf.context;
    const form=ctx.lookup(pdf.catalog.get(n('AcroForm'))),fields=ctx.lookup(form?.get?.(n('Fields'))),signatures=[],seen=new Set();
    const visit=(raw,kind,depth)=>{
      if(depth>20||seen.size>2000)throw Error('서명 양식 트리가 너무 깊거나 큽니다.');
      const field=ctx.lookup(raw);if(!(field instanceof PDFLib.PDFDict)||seen.has(field))throw Error('서명 양식에 순환 또는 구조 오류가 있습니다.');seen.add(field);
      const type=field.get(n('FT'))?.toString()||kind,value=field.get(n('V'));
      if(type==='/Sig'&&value)signatures.push(ctx.lookup(value));
      const kids=ctx.lookup(field.get(n('Kids')));
      if(kids instanceof PDFLib.PDFArray)for(let i=0;i<kids.size();i++)visit(kids.get(i),type,depth+1);
    };
    if(fields instanceof PDFLib.PDFArray)for(let i=0;i<fields.size();i++)visit(fields.get(i),null,0);
    const unique=[...new Set(signatures)];
    if(!unique.length||unique.length>20)throw Error('서명은 1~20개까지 검사합니다.');
    const results=[];
    for(const signature of unique)results.push(await verifySignatureDictionary(bytes,signature,PDFLib,ctx));
    results.sort((a,b)=>a.signedRevisionLength-b.signedRevisionLength);
    if(results.some((result,i)=>i&&result.signedRevisionLength<=results[i-1].signedRevisionLength))throw Error('서명 개정 순서가 중복되거나 모호합니다.');
    const latest=results[results.length-1];
    if(!latest.coversWholeFile)throw Error('최종 파일을 서명한 개정이 없습니다. 서명 후 추가된 내용이 있습니다.');
    return {...latest,signatureCount:results.length,signatures:results};
  }
  async function verifySignatureDictionary(bytes,signature,PDFLib,ctx){
    const n=PDFLib.PDFName.of;
    const profile=signature.get(n('SubFilter'))?.toString();
    if(!['/adbe.pkcs7.detached','/ETSI.CAdES.detached'].includes(profile))throw Error('지원하지 않는 CMS 서명 형식입니다.');
    const range=ctx.lookup(signature.get(n('ByteRange')));
    if(!(range instanceof PDFLib.PDFArray)||range.size()!==4)throw Error('서명 ByteRange가 올바르지 않습니다.');
    const br=Array.from({length:4},(_,i)=>ctx.lookup(range.get(i))?.asNumber?.());
    const [a,b,c,d]=br;
    if(br.some(v=>!Number.isSafeInteger(v)||v<0)||a!==0||b<1||c<=b||c+d>bytes.length)throw Error('서명 ByteRange가 파일 범위를 벗어났습니다.');
    const revisionEnd=c+d;
    if(!/startxref\s+\d+\s+%%EOF[\r\n\x20]*$/.test(latin1(bytes.subarray(Math.max(0,revisionEnd-128),revisionEnd))))throw Error('서명 범위가 PDF 개정 끝과 일치하지 않습니다.');
    const gap=latin1(bytes.subarray(b,c)),match=/^<([0-9a-fA-F]+)>$/.exec(gap);
    if(!match||match[1].length%2||match[1].length>CONTENTS_HEX_LEN*4)throw Error('CMS 서명 내용 영역이 올바르지 않습니다.');
    const padded=Uint8Array.from(match[1].match(/../g),h=>parseInt(h,16)),stored=ctx.lookup(signature.get(n('Contents')));
    if(!(stored instanceof PDFLib.PDFHexString)||!same(stored.asBytes(),padded))throw Error('서명 사전과 ByteRange의 CMS 내용이 다릅니다.');
    const outer=tlv(padded,0),cms=padded.subarray(0,outer.end);
    if(padded.subarray(outer.end).some(v=>v!==0))throw Error('CMS 서명 뒤에 알 수 없는 데이터가 있습니다.');
    const content=children(cms,tlv(cms,0));
    if(content.length!==2||!isOid(cms,content[0],SIGNED_DATA_OID)||content[1].tag!==0xa0)throw Error('CMS SignedData 형식이 아닙니다.');
    const container=children(cms,content[1]);if(container.length!==1)throw Error('CMS 서명 컨테이너가 모호합니다.');
    const parts=children(cms,container[0]),certTag=parts.find(x=>x.tag===0xa0),signerTag=parts[parts.length-1];
    if(!certTag||signerTag?.tag!==0x31)throw Error('CMS 인증서 또는 서명자가 없습니다.');
    const signers=children(cms,signerTag);if(signers.length!==1)throw Error('단일 CMS 서명자만 지원합니다.');
    const signer=children(cms,signers[0]);
    if(signer.length<6||signer[1].tag!==0x30||signer[3].tag!==0xa0||signer[5].tag!==0x04)throw Error('CMS 서명자 구조가 올바르지 않습니다.');
    const digestAlg=children(cms,signer[2]),signAlg=children(cms,signer[4]);
    if(!isOid(cms,digestAlg[0],SHA256_OID)||!isOid(cms,signAlg[0],RSA_OID))throw Error('RSA PKCS#1 SHA-256 서명만 검사합니다.');
    const sid=children(cms,signer[1]),certs=children(cms,certTag).map(x=>x.bytes);
    if(sid.length!==2||certs.length>5)throw Error('CMS 인증서 선택 정보를 처리할 수 없습니다.');
    const leaves=certs.map(cert=>({cert,info:readX509(cert,true)})).filter(x=>same(x.info.issuer,sid[0].bytes)&&same(x.info.serial,sid[1].bytes));
    if(leaves.length!==1)throw Error('서명자 인증서를 하나로 확정하지 못했습니다.');
    const leaf=leaves[0],attrs=children(cms,signer[3]),seenAttrs=new Set();let claimedDigest=null,contentType=false,certHash=null;
    for(const attribute of attrs){
      const pair=children(cms,attribute);if(pair.length!==2||pair[1].tag!==0x31)throw Error('CMS 서명 속성이 올바르지 않습니다.');
      const key=hex(pair[0].bytes);if(seenAttrs.has(key))throw Error('중복된 CMS 서명 속성입니다.');seenAttrs.add(key);
      const values=children(cms,pair[1]);if(values.length!==1)throw Error('복수 값 CMS 속성은 지원하지 않습니다.');
      if(isOid(cms,pair[0],'1.2.840.113549.1.9.4')){if(values[0].tag!==0x04)throw Error('서명 해시 형식이 잘못되었습니다.');claimedDigest=cms.subarray(values[0].valueStart,values[0].end);}
      if(isOid(cms,pair[0],'1.2.840.113549.1.9.3'))contentType=isOid(cms,values[0],DATA_OID);
      if(isOid(cms,pair[0],'1.2.840.113549.1.9.16.2.47')){
        const a1=children(cms,values[0]),a2=a1.length?children(cms,a1[0]):[],a3=a2.length?children(cms,a2[0]):[];
        if(a3[0]?.tag!==0x04)throw Error('기본 SHA-256 SigningCertificateV2만 지원합니다.');certHash=cms.subarray(a3[0].valueStart,a3[0].end);
      }
    }
    const actualDigest=new Uint8Array(await root.crypto.subtle.digest('SHA-256',concat(bytes.subarray(0,b),bytes.subarray(c,c+d))));
    if(!contentType||!claimedDigest||!same(claimedDigest,actualDigest))throw Error('서명 후 PDF 내용이 변경됐거나 CMS 해시가 일치하지 않습니다.');
    if(profile==='/ETSI.CAdES.detached'&&!certHash)throw Error('CAdES 서명의 인증서 결합 속성이 없습니다.');
    if(certHash&&!same(certHash,new Uint8Array(await root.crypto.subtle.digest('SHA-256',leaf.cert))))throw Error('서명 인증서 해시가 일치하지 않습니다.');
    const key=await root.crypto.subtle.importKey('spki',leaf.info.spki,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    const signedAttrs=der(0x31,cms.subarray(signer[3].valueStart,signer[3].end));
    if(!await root.crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,cms.subarray(signer[5].valueStart,signer[5].end),signedAttrs))throw Error('CMS RSA 서명의 수학적 검증에 실패했습니다.');
    return {cryptographicIntegrity:true,coversWholeFile:revisionEnd===bytes.length,signedRevisionLength:revisionEnd,certificateCurrentlyValid:leaf.info.currentlyValid,
      profile:profile.slice(1),pkiTrustVerified:false,revocationVerified:false,timestampVerified:false,padesConformanceVerified:false};
  }
  root.SunrisePdfCms=Object.freeze({signPdfWithPem,verifyPdfSignature});
  if(typeof module!=='undefined'&&module.exports)module.exports={signPdfWithPem,verifyPdfSignature};
})(typeof window!=='undefined'?window:globalThis);
