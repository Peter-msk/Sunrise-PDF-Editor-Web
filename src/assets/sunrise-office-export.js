// Text-only Office conversions. No OCR or layout-perfect PDF conversion claims.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseOfficeExport=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const encoder=new TextEncoder(),MAX_PAGES=120,MAX_TEXT=2*1024*1024;
 function escapeXml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/g,'');}
 function normalizePages(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>MAX_PAGES)throw Error('최대 120페이지까지 변환합니다.');
  let size=0;
  return raw.map(v=>{
   const t=String(v??'').normalize('NFC');size+=encoder.encode(t).length;
   if(size>MAX_TEXT)throw Error('변환할 텍스트가 2 MiB를 초과합니다.');
   return t;
  });
 }
 // Preserve explicit PDF.js end-of-line markers and distinct horizontal text baselines.
 // This is text extraction only: it does not reconstruct tables or visual layout.
 function linesFromTextItems(items){
  if(!Array.isArray(items)||items.length>40000)throw Error('PDF 텍스트 항목이 너무 많습니다.');
  const rows=[];let line='',previousY=null,previousFont=null;
  const push=()=>{rows.push(line.trimEnd());line='';};
  for(const item of items){
   if(!item||typeof item.str!=='string')continue;
   const value=item.str.replace(/[\r\n]+/g,' ');
   const t=item.transform;
   const y=Array.isArray(t)&&t.length>=6&&Number.isFinite(t[5])?t[5]:null;
   const height=Number.isFinite(item.height)&&item.height>0?item.height:12;
   if(line&&y!==null&&previousY!==null&&Math.abs(y-previousY)>Math.max(2,Math.min(height,previousFont||height)*0.35))
    push();
   if(value){
    const addSpace=line&&!(line.endsWith(' ')||value.startsWith(' '));
    line+=(addSpace?' ':'')+value;
   }
   if(y!==null){previousY=y;previousFont=height;}
   if(item.hasEOL)push();
  }
  if(line||!rows.length)push();
  return rows.join('\n');
 }
 async function extractPdfPages(reader,cancelled){
  if(!reader?.getPage||!Number.isSafeInteger(reader.numPages)||reader.numPages<1||reader.numPages>MAX_PAGES)
   throw Error('텍스트 변환은 최대 120쪽까지 지원합니다.');
  const pages=[];let bytes=0;
  for(let number=1;number<=reader.numPages;number++){
   if(cancelled?.())throw Error('문서 변경으로 변환이 취소됐습니다.');
   const page=await reader.getPage(number);
   const content=await page.getTextContent();
   if(cancelled?.())throw Error('문서 변경으로 변환이 취소됐습니다.');
   const text=linesFromTextItems(content.items);
   bytes+=encoder.encode(text).byteLength;
   if(bytes>MAX_TEXT)throw Error('변환할 텍스트가 2 MiB를 초과합니다.');
   pages.push(text);
  }
  return normalizePages(pages);
 }
 function push16(a,v){a.push(v&255,(v>>>8)&255)}
 function push32(a,v){push16(a,v);push16(a,v>>>16)}
 const crcTable=Array.from({length:256},(_,i)=>{
  let c=i;for(let j=0;j<8;j++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);return c>>>0;
 });
 function crc32(data){let c=0xffffffff;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xffffffff)>>>0}
 function zip(files){
  if(!Array.isArray(files)||!files.length||files.length>12)throw Error('잘못된 Office ZIP');
  const local=[],central=[],known=new Set();let offset=0;
  for(const [path,text] of files){
   if(!/^[A-Za-z0-9_./\[\]-]+$/.test(path)||path.includes('..')||known.has(path))
    throw Error('Office 항목명이 올바르지 않습니다.');
   known.add(path);
   const name=encoder.encode(path),body=encoder.encode(text),crc=crc32(body);
   const head=[];push32(head,0x04034b50);push16(head,20);push16(head,0);push16(head,0);
   push16(head,0);push16(head,0);push32(head,crc);push32(head,body.length);
   push32(head,body.length);push16(head,name.length);push16(head,0);
   local.push(Uint8Array.from(head),name,body);
   const cd=[];push32(cd,0x02014b50);push16(cd,20);push16(cd,20);push16(cd,0);push16(cd,0);
   push16(cd,0);push16(cd,0);push32(cd,crc);push32(cd,body.length);
   push32(cd,body.length);push16(cd,name.length);push16(cd,0);push16(cd,0);
   push16(cd,0);push16(cd,0);push32(cd,0);push32(cd,offset);
   central.push(Uint8Array.from(cd),name);
   offset+=head.length+name.length+body.length;
  }
  const sizeCentral=central.reduce((n,v)=>n+v.length,0);
  const ending=[];push32(ending,0x06054b50);push16(ending,0);push16(ending,0);
  push16(ending,files.length);push16(ending,files.length);push32(ending,sizeCentral);
  push32(ending,offset);push16(ending,0);
  const chunks=[...local,...central,Uint8Array.from(ending)],size=offset+sizeCentral+ending.length;
  if(size>12*1024*1024)throw Error('Office 결과가 12 MiB를 초과했습니다.');
  const output=new Uint8Array(size);let pos=0;
  for(const chunk of chunks){output.set(chunk,pos);pos+=chunk.length}
  return output;
 }
 const header='<?xml version="1.0" encoding="UTF-8"?>';
 const ct='<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">';
 const ctRels='<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>';
 const ctXml='<Default Extension="xml" ContentType="application/xml"/>';
 const relHead='<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
 const relType='http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
 function docx(rawPages){
  const pages=normalizePages(rawPages),items=[];
  pages.forEach((text,i)=>{
   if(i)items.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>');
   for(const row of text.replace(/\r\n/g,'\n').split('\n')){
    items.push('<w:p><w:r><w:t xml:space="preserve">'+escapeXml(row)+'</w:t></w:r></w:p>');
   }
  });
  const doc=header+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
   +items.join('')+'<w:sectPr/></w:body></w:document>';
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="word/document.xml"/></Relationships>'],
   ['word/document.xml',doc]
  ]);
 }
 function xlsx(rawPages){
  const pages=normalizePages(rawPages),rows=[['페이지','텍스트']];
  pages.forEach((text,i)=>{
   for(const line of text.replace(/\r\n/g,'\n').split('\n'))rows.push([String(i+1),line]);
  });
  if(rows.length>30000)throw Error('Excel 변환 결과가 3만 행을 초과합니다.');
  if(rows.some(row=>row.some(value=>value.length>32767)))throw Error('Excel 한 셀이 32,767자를 초과합니다. 데이터 손실을 막기 위해 중단했습니다.');
  const cell=(col,r,value)=>'<c r="'+col+r+'" t="inlineStr"><is><t xml:space="preserve">'+
   escapeXml(value)+'</t></is></c>';
  const sheet=header+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
   rows.map((row,i)=>'<row r="'+(i+1)+'">'+cell('A',i+1,row[0])+cell('B',i+1,row[1])+'</row>').join('')+
   '</sheetData></worksheet>';
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',header+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="PDF Text" sheetId="1" r:id="rId1"/></sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
   ['xl/worksheets/sheet1.xml',sheet]
  ]);
 }
 return {docx,xlsx,normalizePages,linesFromTextItems,extractPdfPages};
});
