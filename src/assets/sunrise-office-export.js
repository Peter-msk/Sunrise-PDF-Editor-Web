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
 // PDF.js text items are not paragraphs: use explicit EOL signals, then
 // conservative baseline changes; never claim to recover the source layout.
 function pageTextFromItems(items){
  if(!Array.isArray(items)||items.length>100000)
   throw Error('PDF 텍스트 레이어 항목 수가 올바르지 않습니다.');
  let out='',previous=null;
  for(const item of items){
   if(!item||typeof item.str!=='string')continue;
   const value=item.str.normalize('NFC').replace(/\r\n?/g,'\n');
   if(previous){
    const prev=previous.transform,cur=item.transform;
    const valid=Array.isArray(prev)&&prev.length>=6&&Array.isArray(cur)&&cur.length>=6&&
      [prev[4],prev[5],cur[4],cur[5],previous.width].every(Number.isFinite);
    const size=valid?Math.max(5,Math.abs(prev[3])||12):12;
    const changedLine=valid&&Math.abs(cur[5]-prev[5])>Math.max(2,size*0.35);
    if(previous.hasEOL||changedLine){
     if(!out.endsWith('\n'))out+='\n';
    }else if(value&&!/[\s]$/.test(out)&&!/^[\s]/.test(value)){
     // A measurable gap between text items indicates a word boundary.
     const spaced=!valid||cur[4]-prev[4]-previous.width>Math.max(1.5,size*0.18);
     if(spaced)out+=' ';
    }
   }
   out+=value;
   previous=item;
  }
  if(previous?.hasEOL&&!out.endsWith('\n'))out+='\n';
  return out;
 }
 function normalizePages(raw){
  if(!Array.isArray(raw)||raw.length<1||raw.length>MAX_PAGES)throw Error('최대 120페이지까지 변환합니다.');
  let size=0;
  return raw.map(v=>{
   const t=String(v??'').normalize('NFC');
   // Silent removal of control chars would change the user's extracted text.
   if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF]/.test(t))
    throw Error('원본 텍스트에 Office XML로 저장할 수 없는 제어 문자가 있습니다.');
   for(let i=0;i<t.length;i++){
    const c=t.charCodeAt(i);
    if(c>=0xd800&&c<=0xdbff){if(++i>=t.length||t.charCodeAt(i)<0xdc00||t.charCodeAt(i)>0xdfff)
      throw Error('원본 텍스트에 손상된 Unicode 문자가 있습니다.');}
    else if(c>=0xdc00&&c<=0xdfff)throw Error('원본 텍스트에 손상된 Unicode 문자가 있습니다.');
   }
   size+=encoder.encode(t).length;
   if(size>MAX_TEXT)throw Error('변환할 텍스트가 2 MiB를 초과합니다.');
   return t;
  });
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
   for(const row of text.replace(/\r\n?/g,'\n').split('\n')){
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
 // Keep every exported cell as a literal string: formula-like PDF text
 // must not execute as an Excel formula.
 function xlsxMatrix(rows,sheetName){
  if(rows.length>30000)throw Error('Excel 변환 결과가 3만 행을 초과합니다.');
  const column=idx=>{
   let n=idx+1,out='';
   while(n>0){out=String.fromCharCode(65+(n-1)%26)+out;n=Math.floor((n-1)/26)}
   return out;
  };
  const cell=(col,row,value)=>{
   const text=String(value??'');
   if(text.length>32767)throw Error('Excel 한 셀에 32,767자를 초과했습니다. 내용을 자르지 않고 변환을 중단합니다.');
   return '<c r="'+column(col)+row+'" t="inlineStr"><is><t xml:space="preserve">'+
    escapeXml(text)+'</t></is></c>';
  };
  const sheet=header+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
   rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>v===null?'':cell(j,i+1,v)).join('')+'</row>').join('')+
   '</sheetData></worksheet>';
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',header+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="'+sheetName+'" sheetId="1" r:id="rId1"/></sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
   ['xl/worksheets/sheet1.xml',sheet]
  ]);
 }
 function xlsx(rawPages){
  const pages=normalizePages(rawPages),rows=[['페이지','텍스트']];
  pages.forEach((text,i)=>{
   for(const line of text.replace(/\r\n?/g,'\n').split('\n'))rows.push([String(i+1),line]);
  });
  return xlsxMatrix(rows,'PDF Text');
 }

 // Opt-in Excel export for PDF pages with a *regular* multi-column text grid.
 // No claim of recovering original borders, merged cells or source spreadsheets.
 // Irregular/rotated text fails rather than silently shifting data between cells.
 function xlsxColumns(rawPages){
  if(!Array.isArray(rawPages)||rawPages.length<1||rawPages.length>MAX_PAGES)
   throw Error('최대 120페이지까지 변환합니다.');
  // Reuse strict Unicode/text-size and per-page text limits.
  normalizePages(rawPages.map(items=>pageTextFromItems(items)));
  const exported=[],columnCounts=[];
  let detected=false;
  for(let pageIndex=0;pageIndex<rawPages.length;pageIndex++){
   const items=rawPages[pageIndex].filter(item=>item&&typeof item.str==='string'&&item.str.length);
   const lines=[];
   for(const item of items){
    const v=item.transform;
    if(!Array.isArray(v)||v.length<6||!Number.isFinite(item.width)||item.width<0||
       ![v[0],v[1],v[2],v[3],v[4],v[5]].every(Number.isFinite)||
       Math.abs(v[1])>0.1||Math.abs(v[2])>0.1||v[0]<=0||v[3]<=0)
     throw Error((pageIndex+1)+'쪽에 회전 또는 위치 미확인 텍스트가 있어 표 열을 안전하게 추정할 수 없습니다.');
    const x=v[4],y=v[5],tolerance=Math.max(2,Math.abs(v[3])*0.28);
    let line=lines.find(row=>Math.abs(row.y-y)<=tolerance);
    if(!line){line={y,entries:[]};lines.push(line)}
    line.entries.push({x,width:item.width,font:Math.abs(v[3]),text:item.str.normalize('NFC')});
   }
   lines.sort((a,b)=>b.y-a.y);
   const rows=lines.map(line=>{
    const sorted=line.entries.sort((a,b)=>a.x-b.x),cells=[];
    for(const entry of sorted){
     const last=cells[cells.length-1];
     if(!last){cells.push({x:entry.x,right:entry.x+entry.width,text:entry.text});continue;}
     const gap=entry.x-last.right;
     if(gap< -2)throw Error('PDF 텍스트가 서로 겹쳐 표 열을 안전하게 분리할 수 없습니다.');
     if(gap>Math.max(16,entry.font*1.7)){
      cells.push({x:entry.x,right:entry.x+entry.width,text:entry.text});
     }else{
      last.text+=(gap>1.5&&!/\s$/.test(last.text)&&!/^\s/.test(entry.text)?' ':'')+entry.text;
      last.right=entry.x+entry.width;
     }
    }
    return cells;
   });
   const aligned=rows.filter(row=>row.length>=2);
   let anchors=[];
   if(aligned.length>=2){
    const reference=aligned.reduce((a,b)=>b.length>a.length?b:a,aligned[0]);
    if(reference.length>10)throw Error('한 페이지의 표 열은 최대 10개까지 추정합니다.');
    anchors=reference.map(cell=>cell.x);
    let confirmed=0;
    for(const row of aligned){
     if(row.length!==anchors.length)continue;
     const match=row.every((cell,j)=>Math.abs(cell.x-anchors[j])<=18);
     if(match)confirmed++;
    }
    if(confirmed>=2)detected=true;
    else anchors=[];
   }
   if(!anchors.length){
    // Non-table pages remain readable as one-column text in the same export.
    // A document with no recognized table at all is rejected below.
    for(const row of rows)exported.push([String(pageIndex+1),row.map(cell=>cell.text).join(' ')]);
    columnCounts.push(1);
    continue;
   }
   columnCounts.push(anchors.length);
   for(const row of rows){
    const values=Array(anchors.length).fill(null);
    for(const cell of row){
     let best=0,dist=Infinity;
     anchors.forEach((a,i)=>{const dx=Math.abs(cell.x-a);if(dx<dist){best=i;dist=dx}});
     if(dist>18){
      if(row.length===1)best=0; // heading or note, kept as text
      else throw Error('표의 열 좌표가 불규칙하여 원문을 잘못 배치할 수 있습니다.');
     }
     if(values[best]!==null)throw Error('여러 텍스트가 동일 Excel 셀에 충돌합니다.');
     values[best]=cell.text;
    }
    exported.push([String(pageIndex+1),...values]);
   }
  }
  if(!detected)throw Error('규칙적인 다열 PDF 표를 찾지 못했습니다. 기존 Excel 텍스트 출력을 이용해 주세요.');
  const cols=Math.max(...columnCounts);
  const headerRow=['페이지',...Array.from({length:cols},(_,i)=>'열 '+(i+1))];
  return xlsxMatrix([headerRow,...exported],'PDF Columns');
 }
 return {docx,xlsx,xlsxColumns,normalizePages,pageTextFromItems};
});
