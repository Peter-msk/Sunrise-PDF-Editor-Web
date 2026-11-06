// Local editable Office exports. No OCR or layout-perfect PDF conversion claims.
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
 function zip(files,maxBytes=12*1024*1024){
  if(!Array.isArray(files)||!files.length||files.length>65)throw Error('잘못된 Office ZIP');
  const local=[],central=[],known=new Set();let offset=0;
  for(const [path,text] of files){
   if(!/^[A-Za-z0-9_./\[\]-]+$/.test(path)||path.includes('..')||known.has(path))
    throw Error('Office 항목명이 올바르지 않습니다.');
   known.add(path);
   const name=encoder.encode(path),body=text instanceof Uint8Array?text:encoder.encode(text),crc=crc32(body);
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
  if(size>maxBytes)throw Error('Office 결과가 허용된 파일 크기를 초과했습니다.');
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
 function worksheetXml(rows){
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
  return header+'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'+
   rows.map((row,i)=>'<row r="'+(i+1)+'">'+row.map((v,j)=>v===null?'':cell(j,i+1,v)).join('')+'</row>').join('')+
   '</sheetData></worksheet>';
 }
 function xlsxMatrix(rows,sheetName){
  const sheet=worksheetXml(rows);
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

 // Export each source page to its own editable worksheet, preserving page
 // boundaries instead of flattening unrelated pages into one long sheet.
 // Every PDF string stays literal (inlineStr), never an executable formula.
 function xlsxPerPage(rawPages){
  const pages=normalizePages(rawPages);
  if(pages.length>50)throw Error('페이지별 Excel은 최대 50쪽까지 지원합니다.');
  const sheets=pages.map((page,index)=>{
   const lines=page.replace(/\r\n?/g,'\n').split('\n');
   return {index:index+1,xml:worksheetXml([['행','텍스트'],...lines.map((line,i)=>[String(i+1),line])])};
  });
  const sheetTag=sheets.map(({index})=>'<sheet name="PDF '+index+'" sheetId="'+index+'" r:id="rId'+index+'"/>').join('');
  const relTags=sheets.map(({index})=>'<Relationship Id="rId'+index+'" Type="'+relType+
    'worksheet" Target="worksheets/sheet'+index+'.xml"/>').join('');
  const overrides=sheets.map(({index})=>'<Override PartName="/xl/worksheets/sheet'+index+
    '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+overrides+'</Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',header+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'+sheetTag+'</sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',header+relHead+relTags+'</Relationships>'],
   ...sheets.map(({index,xml})=>['xl/worksheets/sheet'+index+'.xml',xml])
  ]);
 }

 // Opt-in Excel export for PDF pages with a *regular* multi-column text grid.
 // No claim of recovering original borders, merged cells or source spreadsheets.
 // Irregular/rotated text fails rather than silently shifting data between cells.
 function xlsxColumns(rawPages){
  if(!Array.isArray(rawPages)||rawPages.length<1||rawPages.length>MAX_PAGES)
   throw Error('최대 120페이지까지 변환합니다.');
  normalizePages(rawPages.map(items=>pageTextFromItems(items)));
  const pages=[];
  for(let pageIndex=0;pageIndex<rawPages.length;pageIndex++){
   const entries=rawPages[pageIndex].filter(item=>item&&typeof item.str==='string'&&item.str.trim().length)
    .map(item=>{
     const v=item.transform;
     if(!Array.isArray(v)||v.length<6||!Number.isFinite(item.width)||item.width<0||
        ![v[0],v[1],v[2],v[3],v[4],v[5]].every(Number.isFinite)||
        Math.abs(v[1])>0.1||Math.abs(v[2])>0.1||v[0]<=0||v[3]<=0)
      throw Error((pageIndex+1)+'쪽에 회전 또는 위치 미확인 텍스트가 있어 표 열을 안전하게 추정할 수 없습니다.');
     return {x:v[4],y:v[5],width:item.width,font:Math.abs(v[3]),text:item.str.normalize('NFC')};
    });
   // Sort once, then group adjacent baselines instead of repeated line scans.
   entries.sort((a,b)=>b.y-a.y||a.x-b.x);
   const lines=[];
   for(const entry of entries){
    let line=lines[lines.length-1];
    const tolerance=Math.max(2,Math.min(line?.font||entry.font,entry.font)*0.28);
    if(!line||Math.abs(line.y-entry.y)>tolerance){
     line={y:entry.y,font:entry.font,entries:[]};lines.push(line);
    }
    line.entries.push(entry);
   }
   const rows=lines.map(line=>{
    const cells=[];
    line.entries.sort((a,b)=>a.x-b.x);
    for(const entry of line.entries){
     const last=cells[cells.length-1];
     if(!last){cells.push({x:entry.x,right:entry.x+entry.width,text:entry.text});continue;}
     const gap=entry.x-last.right;
     if(gap< -2)throw Error('PDF 텍스트가 서로 겹쳐 표 열을 안전하게 분리할 수 없습니다.');
     if(gap>Math.max(16,entry.font*1.7)){
      cells.push({x:entry.x,right:entry.x+entry.width,text:entry.text});
     }else{
      last.text+=(gap>1.5&&!/\s$/.test(last.text)&&!/^\s/.test(entry.text)?' ':'')+entry.text;
      last.right=Math.max(last.right,entry.x+entry.width);
     }
    }
    return cells;
   });
   const multi=rows.filter(row=>row.length>=2);
   let anchors=[];
   if(multi.length>=2){
    const reference=multi.reduce((a,b)=>b.length>a.length?b:a,multi[0]);
    if(reference.length>10)throw Error('한 페이지의 표 열은 최대 10개까지 추정합니다.');
    const proposed=reference.map(cell=>cell.x);
    const confirmed=multi.filter(row=>row.length===proposed.length&&
      row.every((cell,j)=>Math.abs(cell.x-proposed[j])<=18)).length;
    if(confirmed>=2)anchors=proposed;
   }
   pages.push({pageIndex,rows,anchors});
  }
  const recognized=pages.filter(page=>page.anchors.length>=2);
  if(!recognized.length)
   throw Error('규칙적인 다열 PDF 표를 찾지 못했습니다. 기존 Excel 텍스트 출력을 이용해 주세요.');
  // Stable X coordinate schema across pages prevents silent column shifts.
  const global=recognized.reduce((best,page)=>page.anchors.length>best.length?page.anchors:best,
    recognized[0].anchors);
  const nearest=x=>{
   let index=-1,distance=Infinity;
   global.forEach((anchor,i)=>{
    const d=Math.abs(x-anchor);
    if(d<distance){distance=d;index=i;}
   });
   return {index,distance};
  };
  const exported=[];
  let notesPresent=false;
  for(const page of pages){
   if(page.anchors.length){
    const used=new Set();
    for(const anchor of page.anchors){
     const hit=nearest(anchor);
     if(hit.distance>18||used.has(hit.index))
      throw Error((page.pageIndex+1)+'쪽의 표 열 배치가 다른 페이지와 달라 Excel 열을 안전하게 맞출 수 없습니다.');
     used.add(hit.index);
    }
   }
   for(const row of page.rows){
    const values=Array(global.length).fill(null);
    let note=null;
    if(!page.anchors.length){
     note=row.map(cell=>cell.text).join(' ');
    }else{
     for(const cell of row){
      const hit=nearest(cell.x);
      if(hit.distance>18){
       if(row.length!==1)
        throw Error((page.pageIndex+1)+'쪽의 표 열 좌표가 불규칙하여 원문을 잘못 배치할 수 있습니다.');
       note=cell.text;
       continue;
      }
      if(values[hit.index]!==null)
       throw Error((page.pageIndex+1)+'쪽의 여러 텍스트가 동일 Excel 셀에 충돌합니다.');
      values[hit.index]=cell.text;
     }
    }
    if(note!==null)notesPresent=true;
    exported.push([String(page.pageIndex+1),...values,note]);
   }
  }
  const header=['페이지',...global.map((_,i)=>'열 '+(i+1))];
  if(notesPresent)header.push('비정렬 원문');
  return xlsxMatrix([header,...exported.map(row=>notesPresent?row:row.slice(0,-1))],'PDF Columns');
}


 // Opt-in DOCX with *estimated* text-line layout and editable regular grids.
 // This is not PDF-to-Word layout fidelity: original images, vector shapes,
 // multi-column reading order, merged cells and exact fonts are not restored.
 // The plain text DOCX route remains available for ambiguous documents.
 function docxLayout(rawPages, options={}){
  if(options===null || typeof options!=='object' ||
     ![undefined,'single','two','three','auto'].includes(options.columnMode))
   throw Error('Word 읽기 순서 선택값이 올바르지 않습니다.');
  const columnCount=options.columnMode==='three'?3:options.columnMode==='two'?2:options.columnMode==='auto'?0:1;
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>MAX_PAGES)
   throw Error('구조 추정 Word 변환은 최대 120페이지까지 지원합니다.');
  const pageTexts=rawPages.map((page,index)=>{
   if(!page||!Array.isArray(page.items)||page.items.length>100000||
      !Number.isFinite(page.width)||page.width<=0||page.width>6000||
      !Number.isFinite(page.height)||page.height<=0||page.height>6000||
      (page.rotation||0)%360!==0)
    throw Error((index+1)+'쪽의 페이지 크기 또는 회전 정보를 처리할 수 없습니다. 텍스트 전용 Word를 이용해 주세요.');
   return pageTextFromItems(page.items);
  });
  normalizePages(pageTexts); // Reuse the same Unicode and 2 MiB limits as plain export.
  const median=values=>{
   const sorted=values.slice().sort((a,b)=>a-b);
   return sorted.length?sorted[Math.floor(sorted.length/2)]:12;
  };
  const clamp=(v,low,high)=>Math.max(low,Math.min(high,v));
  const xmlText=s=>String(s).split('\n').map((part,i)=>(i?'<w:br/>':'')+
   (part?'<w:t xml:space="preserve">'+escapeXml(part)+'</w:t>':'')).join('');
  const renderRun=run=>{
   if(!run.text)return '';
   const style=[];
   if(run.bold)style.push('<w:b/>');
   if(run.italic)style.push('<w:i/>');
   style.push('<w:sz w:val="'+clamp(Math.round(run.font*2),12,144)+'"/>');
   return '<w:r><w:rPr>'+style.join('')+'</w:rPr>'+xmlText(run.text)+'</w:r>';
  };
  const renderParagraph=(line,base,pageWidth,origin,spaceBefore=0)=>{
   const maxFont=Math.max(...line.runs.map(r=>r.font));
   const heading=line.text.length<=140&&maxFont>=base*1.38?'Heading1':
    line.text.length<=160&&maxFont>=base*1.18?'Heading2':null;
   const indent=clamp(Math.round((line.x-origin)*20),0,2200);
   const centered=line.text.length<=110&&line.x>origin+12&&
    Math.abs((line.x+line.right)/2-pageWidth/2)<pageWidth*0.065;
   const align=centered?'<w:jc w:val="center"/>':'';
   const pPr='<w:pPr>'+(heading?'<w:pStyle w:val="'+heading+'"/>':'')+
    (indent&&!centered?'<w:ind w:left="'+indent+'"/>':'')+align+
    '<w:spacing w:before="'+clamp(Math.round(spaceBefore*20),0,1440)+'" w:after="0" w:line="276" w:lineRule="auto"/></w:pPr>';
   return '<w:p>'+pPr+line.runs.map(renderRun).join('')+'</w:p>';
  };
  const detectColumns=(items,pageWidth)=>{
   // Conservative: only accept one unambiguous column count, with at least 4
   // distinct baselines per column and vertical overlap of their reading spans.
   const valid=[];
   for(const count of [2,3]){
    const gutter=Math.max(8,pageWidth*0.015);
    const columns=Array.from({length:count},()=>[]);
    let ambiguous=false;
    for(const item of items){
     const index=columns.findIndex((_,i)=>item.x>=(i===0?0:pageWidth*i/count+gutter)&&
      item.x+item.width<=(i===count-1?pageWidth:pageWidth*(i+1)/count-gutter));
     if(index<0){ambiguous=true;break;}
     columns[index].push(item);
    }
    if(ambiguous||columns.some(col=>col.length<5))continue;
    // A 3-column page can otherwise be mistaken for two columns if the first
    // two columns fit inside one half; require one coherent x-origin per band.
    if(columns.some(col=>Math.max(...col.map(x=>x.x))-Math.min(...col.map(x=>x.x))>
       pageWidth/count*0.25))continue;
    const extents=columns.map(col=>({
     upper:Math.max(...col.map(x=>x.y)),lower:Math.min(...col.map(x=>x.y)),
     baselines:new Set(col.map(x=>Math.round(x.y/3)))
    }));
    if(extents.some(x=>x.baselines.size<4))continue;
    const overlap=Math.min(...extents.map(x=>x.upper))-Math.max(...extents.map(x=>x.lower));
    if(overlap<Math.max(35,Math.min(...extents.map(x=>x.upper-x.lower))*0.4))continue;
    valid.push(count);
   }
   if(valid.length>1)throw Error('여러 단 구조가 겹쳐 자동 판정할 수 없습니다. 2단 또는 3단 변환을 직접 선택해 주세요.');
   return valid[0]||1;
  };
  const linesByPage=[],columnsByPage=[],pageColumnCounts=[];
  for(let pageIndex=0;pageIndex<rawPages.length;pageIndex++){
   const page=rawPages[pageIndex],items=[];
   for(const item of page.items){
    if(!item||typeof item.str!=='string'||!item.str)continue;
    const t=item.transform;
    if(!Array.isArray(t)||t.length<6||![...t.slice(0,6),item.width].every(Number.isFinite)||
       item.width<0||Math.abs(t[1])>0.1||Math.abs(t[2])>0.1||t[0]<=0||t[3]<=0||
       (item.dir&&item.dir!=='ltr'))
     throw Error((pageIndex+1)+'쪽에 회전·세로쓰기·좌표 미확인 텍스트가 있습니다. 텍스트 전용 Word를 이용해 주세요.');
    const name=String(item.fontName||'');
    const fontFamily=String(page.styles?.[name]?.fontFamily||'');
    const hint=name+' '+fontFamily;
    items.push({text:item.str.normalize('NFC'),x:t[4],y:t[5],width:item.width,
     font:clamp(Math.abs(t[3]),6,72),bold:/bold|semibold|black|heavy/i.test(hint),
     italic:/italic|oblique/i.test(hint)});
   }
   if(items.length>100000)throw Error('Word 레이아웃 텍스트가 너무 많습니다.');
   const groupLines=entries=>{
    entries.sort((a,b)=>b.y-a.y||a.x-b.x);
    const lines=[];
    for(const item of entries){
     const prev=lines[lines.length-1];
     const tolerance=Math.max(2,Math.min(item.font,prev?.font||item.font)*0.28);
     if(!prev||Math.abs(prev.y-item.y)>tolerance){
      lines.push({y:item.y,font:item.font,items:[item]});
     }else prev.items.push(item);
    }
    for(const line of lines){
     line.items.sort((a,b)=>a.x-b.x);
     const runs=[];let previous=null;
     for(const item of line.items){
      if(previous){
       const gap=item.x-(previous.x+previous.width);
       if(gap<-Math.max(2,previous.font*0.25))
        throw Error((pageIndex+1)+'쪽에 겹치는 텍스트가 있어 Word 레이아웃을 안전하게 추정할 수 없습니다.');
       if(gap>Math.max(1.5,item.font*0.15)&&!/^\s/.test(item.text)&&
          !/\s$/.test(previous.text))runs.push({...item,text:' '});
      }
      runs.push(item);previous=item;
     }
     line.runs=runs;
     line.text=runs.map(r=>r.text).join('');
     line.x=line.items[0]?.x||0;
     line.right=Math.max(...line.items.map(x=>x.x+x.width),line.x);
    }
    return lines;
   };
   const pageColumnCount=columnCount||detectColumns(items,page.width);
   pageColumnCounts.push(pageColumnCount);
   if(pageColumnCount>1){
    // Conservative opt-in layout: reject any text touching a gutter.
    // This does not recover spanning headings, uneven columns or illustrations.
    const gutter=Math.max(8,page.width*0.015);
    const columns=Array.from({length:pageColumnCount},()=>[]);
    for(const item of items){
     const column=columns.findIndex((_,i)=>
      item.x >= (i===0?0:page.width*i/pageColumnCount+gutter) &&
      item.x+item.width <= (i===pageColumnCount-1?page.width:page.width*(i+1)/pageColumnCount-gutter));
     if(column<0)throw Error((pageIndex+1)+'쪽에 단 경계를 넘거나 열 배치를 확인할 수 없는 텍스트가 있습니다. 단락·표 추정 Word를 이용해 주세요.');
     columns[column].push(item);
    }
    const ordered=columns.map(groupLines);
    if(ordered.some(lines=>lines.length<3))
     throw Error((pageIndex+1)+'쪽의 '+pageColumnCount+'단 각각에 3줄 이상 있어야 합니다.');
    columnsByPage.push(ordered);
    linesByPage.push(ordered.flat());
   }else{
    columnsByPage.push(null);
    linesByPage.push(groupLines(items));
   }
  }
  const fontSamples=linesByPage.flatMap(lines=>lines.flatMap(line=>line.items.map(item=>item.font)));
  const bodyFont=median(fontSamples.filter(Number.isFinite));
  const result=[];
  // Word sections preserve source PDF paper size and orientation. Inferred
  // margins are bounded and approximate; never silently normalize landscape
  // to A4 portrait or discard a mixed-size PDF's page geometry.
  const sectionFor=(page,lines)=>{
   const sizeW=Math.round(page.width*20),sizeH=Math.round(page.height*20);
   if(sizeW<2880||sizeH<2880||sizeW>31680||sizeH>31680)
    throw Error('Word에서 안전하게 나타낼 수 없는 PDF 용지 크기입니다. 텍스트 전용 Word를 사용해 주세요.');
   const leftPoints=lines.length?Math.min(...lines.map(line=>line.x)):36;
   const rightPoints=lines.length?Math.min(...lines.map(line=>page.width-line.right)):36;
   const topPoints=lines.length?page.height-Math.max(...lines.map(line=>line.y)):36;
   const bottomPoints=lines.length?Math.min(...lines.map(line=>line.y)):36;
   const clampMargin=v=>Math.round(clamp(v,24,Math.min(90,page.width/4,page.height/4))*20);
   const left=clampMargin(leftPoints),right=clampMargin(rightPoints);
   const top=clampMargin(topPoints),bottom=clampMargin(bottomPoints);
   const orient=page.width>page.height?' w:orient="landscape"':'';
   return '<w:sectPr><w:pgSz w:w="'+sizeW+'" w:h="'+sizeH+'"'+orient+'/>'+
    '<w:pgMar w:top="'+top+'" w:right="'+right+'" w:bottom="'+bottom+'" w:left="'+left+'"'+
    ' w:header="360" w:footer="360" w:gutter="0"/></w:sectPr>';
  };
  const renderTable=(tableLines,pageWidth)=>{
   const count=tableLines[0].cells.length;
   const width=Math.round(clamp((pageWidth-90)*20/count,720,5000));
   const grid=Array.from({length:count},()=>'<w:gridCol w:w="'+width+'"/>').join('');
   const rows=tableLines.map(line=>'<w:tr>'+line.cells.map(cell=>
    '<w:tc><w:tcPr><w:tcW w:w="'+width+'" w:type="dxa"/></w:tcPr><w:p>'+cell.map(renderRun).join('')+'</w:p></w:tc>').join('')+'</w:tr>');
   return '<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/></w:tblPr>'+ 
    '<w:tblGrid>'+grid+'</w:tblGrid>'+rows.join('')+'</w:tbl>';
  };
  let finalSection='';
  for(let pageIndex=0;pageIndex<linesByPage.length;pageIndex++){
   const lines=linesByPage[pageIndex],page=rawPages[pageIndex];
   const section=sectionFor(page,lines);
   const pageColumnCount=pageColumnCounts[pageIndex];
   const bodyLeft=lines.length?Math.min(...lines.map(line=>line.x)):0;
   // Recognize only a run of 3+ rows with a stable 2..8-column schema.
   // No guesses about actual PDF borders or merged cells are made.
   const cellGroups=line=>{
    const groups=[];
    let right=-Infinity;
    for(const item of line.items){
     const gap=item.x-right;
     if(groups.length&&gap<=Math.max(24,item.font*2.1)){
      const group=groups[groups.length-1];
      if(gap>Math.max(1.5,item.font*0.15)&&!/^\s/.test(item.text))
       group.runs.push({...item,text:' '});
      group.runs.push(item);right=Math.max(right,item.x+item.width);
     }else{
      groups.push({x:item.x,runs:[item]});right=item.x+item.width;
     }
    }
    return groups;
   };
   if(pageColumnCount>1){
    const columns=columnsByPage[pageIndex];
    const width=Math.round(clamp((page.width-84)*20/pageColumnCount,600,13000));
    const makeCell=column=>{
     const origin=Math.min(...column.map(line=>line.x));
     const paragraphs=column.map((line,j)=>{
      const previous=j?column[j-1]:null;
      const delta=previous?Math.max(0,previous.y-line.y):0;
      const before=Math.max(0,delta-Math.max(previous?.font||bodyFont,line.font)*1.35);
      return renderParagraph(line,bodyFont,page.width,origin,before);
     });
     return '<w:tc><w:tcPr><w:tcW w:w="'+width+'" w:type="dxa"/></w:tcPr>'+
      paragraphs.join('')+'</w:tc>';
    };
    // Independent editable cells preserve column reading order.
    result.push('<w:tbl><w:tblPr><w:tblW w:w="'+(pageColumnCount*width)+'" w:type="dxa"/>'+
     '<w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="nil"/>'+
     '<w:bottom w:val="nil"/><w:left w:val="nil"/><w:right w:val="nil"/>'+
     '<w:insideH w:val="nil"/><w:insideV w:val="nil"/></w:tblBorders></w:tblPr>'+
     '<w:tblGrid>'+columns.map(()=>'<w:gridCol w:w="'+width+'"/>').join('')+'</w:tblGrid>'+
     '<w:tr>'+columns.map(makeCell).join('')+'</w:tr></w:tbl>');
   }else{
   const grouped=lines.map(cellGroups);
   let i=0;
   while(i<lines.length){
    const seed=grouped[i],count=seed.length;
    let end=i+1;
    if(count>=2&&count<=8){
     while(end<lines.length&&grouped[end].length===count&&
       Math.abs(lines[end-1].y-lines[end].y)<=Math.max(30,bodyFont*2.3)&&
       grouped[end].every((cell,j)=>Math.abs(cell.x-seed[j].x)<=12))end++;
    }
    if(end-i>=3){
     result.push(renderTable(grouped.slice(i,end).map((cells,j)=>
      ({cells:cells.map(cell=>cell.runs),line:lines[i+j]})),page.width));
     i=end;
    }else{
     const previous=i>0?lines[i-1]:null;
     const baselineDelta=previous?Math.max(0,previous.y-lines[i].y):0;
     const estimatedBefore=Math.max(0,baselineDelta-Math.max(previous?.font||bodyFont,lines[i].font)*1.35);
     result.push(renderParagraph(lines[i],bodyFont,page.width,bodyLeft,estimatedBefore));i++;
    }
   }
   }
   // In WordprocessingML intermediate section properties belong to the
   // paragraph that terminates the preceding section; the last sectPr is a
   // direct child of w:body. This also works for mixed A4/Letter/landscape.
   if(pageIndex<linesByPage.length-1)
    result.push('<w:p><w:pPr>'+section+'</w:pPr></w:p>');
   else finalSection=section;
  }
  const doc=header+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+ 
   result.join('')+finalSection+'</w:body></w:document>';
  const styles=header+'<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'+
   '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>'+
   '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/></w:rPr></w:style>'+
   '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/></w:rPr></w:style></w:styles>';
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'+
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="word/document.xml"/></Relationships>'],
   ['word/_rels/document.xml.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'styles" Target="styles.xml"/></Relationships>'],
   ['word/document.xml',doc],['word/styles.xml',styles]
  ]);
 }

 const docxTwoColumn=rawPages=>docxLayout(rawPages,{columnMode:'two'});
 const docxThreeColumn=rawPages=>docxLayout(rawPages,{columnMode:'three'});
 const docxAutoColumns=rawPages=>docxLayout(rawPages,{columnMode:'auto'});
 // Recover merged cells only when explicit horizontal/vertical source strokes
 // form a bounded, rectangular grid. Missing rules join cells; nonrectangular
 // connected regions are rejected instead of inventing table structure.
 function gridModel(page,rules){
  if(!page||!Array.isArray(page.items)||(page.rotation||0)%360!==0||!rules||
     !Array.isArray(rules.horizontal)||!Array.isArray(rules.vertical))throw Error('표 페이지 좌표·선 정보를 읽을 수 없습니다.');
  const hs=rules.horizontal,vs=rules.vertical;
  if(hs.length+vs.length>6000)throw Error('표 선이 너무 많습니다.');
  const cluster=values=>{
   const sorted=values.slice().sort((a,b)=>a-b),out=[];
   for(const value of sorted){if(!Number.isFinite(value))throw Error('표 선 좌표가 올바르지 않습니다.');if(!out.length||value-out[out.length-1]>1.5)out.push(value);}
   return out;
  };
  const xs=cluster(vs.map(x=>x.at)),ys=cluster(hs.map(x=>x.at)).reverse();
  if(xs.length<2||xs.length>41||ys.length<2||ys.length>201)throw Error('명확한 표 격자를 찾지 못했습니다. 텍스트 또는 원본 모양 Word 변환을 이용하세요.');
  const covers=(lines,at,from,to)=>{
   let end=from;
   const segments=lines.filter(s=>Math.abs(s.at-at)<=1.6).sort((a,b)=>a.from-b.from);
   for(const s of segments){if(s.from>end+1.6)break;if(s.to>=end)end=s.to;if(end>=to-1.6)return true;}
   return false;
  };
  if(!covers(hs,ys[0],xs[0],xs[xs.length-1])||!covers(hs,ys[ys.length-1],xs[0],xs[xs.length-1])||
     !covers(vs,xs[0],ys[ys.length-1],ys[0])||!covers(vs,xs[xs.length-1],ys[ys.length-1],ys[0]))
   throw Error('표의 바깥 테두리를 확정하지 못했습니다. 서로 분리된 표는 나누어 변환하세요.');
  const rows=ys.length-1,cols=xs.length-1,parent=Array.from({length:rows*cols},(_,i)=>i);
  const find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{parent[find(b)]=find(a);};
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
   if(c+1<cols&&!covers(vs,xs[c+1],ys[r+1],ys[r]))join(r*cols+c,r*cols+c+1);
   if(r+1<rows&&!covers(hs,ys[r+1],xs[c],xs[c+1]))join(r*cols+c,(r+1)*cols+c);
  }
  const groups=new Map();
  for(let r=0;r<rows;r++)for(let c=0;c<cols;c++){
   const id=find(r*cols+c);if(!groups.has(id))groups.set(id,[]);groups.get(id).push({r,c});
  }
  const cells=[];
  for(const positions of groups.values()){
   const r0=Math.min(...positions.map(x=>x.r)),r1=Math.max(...positions.map(x=>x.r));
   const c0=Math.min(...positions.map(x=>x.c)),c1=Math.max(...positions.map(x=>x.c));
   if(positions.length!==(r1-r0+1)*(c1-c0+1))throw Error('표 셀 병합 영역이 직사각형이 아닙니다.');
   for(let r=r0;r<=r1;r++)for(let c=c0;c<c1;c++)
    if(covers(vs,xs[c+1],ys[r+1],ys[r]))throw Error('병합 셀 안에 분리선이 남아 있어 표 구조가 모호합니다.');
   for(let r=r0;r<r1;r++)for(let c=c0;c<=c1;c++)
    if(covers(hs,ys[r+1],xs[c],xs[c+1]))throw Error('병합 셀 안에 분리선이 남아 있어 표 구조가 모호합니다.');
   cells.push({r0,r1,c0,c1,items:[],text:''});
  }
  const outside=[];
  for(const item of page.items){
   if(typeof item?.str!=='string'||!item.str)continue;
   const t=item.transform;
   if(!Array.isArray(t)||t.length<6||![...t,item.width].every(Number.isFinite)||Math.abs(t[1])>.1||Math.abs(t[2])>.1||item.width<0)
    throw Error('표 안의 회전·세로쓰기 텍스트를 처리할 수 없습니다.');
   const x=t[4],y=t[5],center=x+item.width/2;
   const candidates=cells.filter(cell=>center>=xs[cell.c0]-1&&center<=xs[cell.c1+1]+1&&y>=ys[cell.r1+1]-1&&y<=ys[cell.r0]+1);
   if(!candidates.length){outside.push(item);continue;}
   if(candidates.length!==1||x<xs[candidates[0].c0]-2||x+item.width>xs[candidates[0].c1+1]+2)
    throw Error('글자가 여러 표 셀 경계에 걸쳐 있어 배치를 확정할 수 없습니다.');
   candidates[0].items.push(item);
  }
  for(const cell of cells){cell.items.sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4]);cell.text=pageTextFromItems(cell.items);}
  outside.sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4]);
  normalizePages([cells.map(x=>x.text).join('\n'),pageTextFromItems(outside)]);
  return {xs,ys,rows,cols,cells,outside};
 }

 // Connected source strokes separate independent tables before cell recovery.
 // Text is assigned exactly once; content between tables stays in reading order.
 function splitGridPages(rawPages,rulesByPage){
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>50||rulesByPage?.length!==rawPages.length)throw Error('표 변환은 최대 50쪽입니다.');
  const output=[];
  rawPages.forEach((page,pageIndex)=>{
   const rules=rulesByPage[pageIndex];
   if(!Array.isArray(page.items)||!Array.isArray(rules?.horizontal)||!Array.isArray(rules?.vertical))throw Error('표 원문과 선 정보를 읽을 수 없습니다.');
   const lines=[...rules.horizontal.map(s=>({...s,axis:'h'})),...rules.vertical.map(s=>({...s,axis:'v'}))];
   if(lines.length>6000)throw Error('표 선이 너무 많습니다.');
   if(lines.some(s=>![s.at,s.from,s.to].every(Number.isFinite)||s.to<=s.from))throw Error('표 선 좌표가 올바르지 않습니다.');
   const parent=lines.map((_,i)=>i),find=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
   for(let i=0;i<lines.length;i++)for(let j=i+1;j<lines.length;j++){
    const a=lines[i],b=lines[j],h=a.axis==='h'?a:b,v=a.axis==='v'?a:b;
    const touches=a.axis===b.axis?Math.abs(a.at-b.at)<=1.6&&a.from<=b.to+1.6&&b.from<=a.to+1.6:
      v.at>=h.from-1.6&&v.at<=h.to+1.6&&h.at>=v.from-1.6&&h.at<=v.to+1.6;
    if(touches)parent[find(j)]=find(i);
   }
   const components=new Map();
   lines.forEach((line,i)=>{const id=find(i);if(!components.has(id))components.set(id,{horizontal:[],vertical:[]});components.get(id)[line.axis==='h'?'horizontal':'vertical'].push(line);});
   const tables=[...components.values()].filter(r=>r.horizontal.length>=2&&r.vertical.length>=2).map(r=>({rules:r,
    left:Math.min(...r.vertical.map(s=>s.at)),right:Math.max(...r.vertical.map(s=>s.at)),top:Math.max(...r.horizontal.map(s=>s.at)),bottom:Math.min(...r.horizontal.map(s=>s.at)),items:[]}));
   tables.sort((a,b)=>b.top-a.top||a.left-b.left);
   if(tables.length>20)throw Error('한 페이지의 표 수가 20개를 초과했습니다.');
   if(!tables.length){output.push({page,rules:null,name:'PDF '+(pageIndex+1)});return;}
   for(const item of page.items){
    if(typeof item?.str!=='string'||!item.str)continue;
    const t=item.transform;
    if(!Array.isArray(t)||t.length!==6||![...t,item.width].every(Number.isFinite))throw Error('텍스트 위치를 읽을 수 없습니다.');
    const x=t[4]+item.width/2,y=t[5];
    const hits=tables.filter(table=>x>=table.left-1&&x<=table.right+1&&y>=table.bottom-1&&y<=table.top+1);
    if(hits.length>1)throw Error('표 영역이 겹쳐 원문을 안전하게 나눌 수 없습니다.');
    // Outside text belongs to the next table in vertical reading order; text
    // after the final table belongs to that final table's trailing paragraph.
    const owner=hits[0]||tables.find(table=>table.top<y)||tables[tables.length-1];owner.items.push(item);
   }
   tables.forEach((table,i)=>output.push({page:{...page,items:table.items},rules:table.rules,name:'PDF '+(pageIndex+1)+(tables.length>1?' Table '+(i+1):''),sourcePage:pageIndex}));
  });
  if(output.length>50)throw Error('전체 표·페이지 시트 수가 50개를 초과했습니다. PDF를 나누어 변환하세요.');
  return output;
 }

 function columnName(index){let out='',n=index+1;while(n){out=String.fromCharCode(65+(n-1)%26)+out;n=Math.floor((n-1)/26);}return out;}
 function xlsxGrids(rawPages,rulesByPage){
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>50||rulesByPage?.length!==rawPages.length)throw Error('표 Excel은 최대 50쪽을 변환합니다.');
  normalizePages(rawPages.map(p=>pageTextFromItems(p.items)));
  const sheets=splitGridPages(rawPages,rulesByPage).map(({page,rules,name},i)=>{
   if(!rules)return {index:i+1,name,xml:worksheetXml(pageTextFromItems(page.items).split('\n').map(text=>[text]))};
   const grid=gridModel(page,rules),rows=Array.from({length:grid.rows},()=>Array(grid.cols).fill(null));
   const merges=[];
   for(const cell of grid.cells){rows[cell.r0][cell.c0]=cell.text;if(cell.r0!==cell.r1||cell.c0!==cell.c1)merges.push(columnName(cell.c0)+(cell.r0+1)+':'+columnName(cell.c1)+(cell.r1+1));}
   if(grid.outside.length){rows.push([]);rows.push(['표 밖 원문']);for(const line of pageTextFromItems(grid.outside).split('\n'))rows.push([line]);}
   const cols='<cols>'+grid.xs.slice(0,-1).map((x,c)=>'<col min="'+(c+1)+'" max="'+(c+1)+'" width="'+Math.max(4,Math.min(80,(grid.xs[c+1]-x)/5)).toFixed(2)+'" customWidth="1"/>').join('')+'</cols>';
   const merged=merges.length?'<mergeCells count="'+merges.length+'">'+merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells>':'';
   const xml=worksheetXml(rows).replace('<sheetData>',cols+'<sheetData>').replace('</worksheet>',merged+'</worksheet>');
   return {index:i+1,name,xml};
  });
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+'<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+sheets.map(s=>'<Override PartName="/xl/worksheets/sheet'+s.index+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')+'</Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="xl/workbook.xml"/></Relationships>'],
   ['xl/workbook.xml',header+'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="'+relType.slice(0,-1)+'"><sheets>'+sheets.map(s=>'<sheet name="'+escapeXml(s.name)+'" sheetId="'+s.index+'" r:id="rId'+s.index+'"/>').join('')+'</sheets></workbook>'],
   ['xl/_rels/workbook.xml.rels',header+relHead+sheets.map(s=>'<Relationship Id="rId'+s.index+'" Type="'+relType+'worksheet" Target="worksheets/sheet'+s.index+'.xml"/>').join('')+'</Relationships>'],
   ...sheets.map(s=>['xl/worksheets/sheet'+s.index+'.xml',s.xml])
  ]);
 }
 const wordSection=page=>{
  if(![page.width,page.height].every(v=>Number.isFinite(v)&&v>=144&&v<=1584))throw Error('Word 지원 용지 범위를 벗어났습니다.');
  return '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="'+Math.round(page.width*20)+'" w:h="'+Math.round(page.height*20)+'"'+(page.width>page.height?' w:orient="landscape"':'')+'/><w:pgMar w:top="0" w:right="0" w:bottom="0" w:left="0" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>';
 };
 function wordPackage(body,extras=[],relationships=[],png=false,maxBytes){
  return zip([
   ['[Content_Types].xml',header+ct+ctRels+ctXml+(png?'<Default Extension="png" ContentType="image/png"/>':'')+'<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'],
   ['_rels/.rels',header+relHead+'<Relationship Id="rId1" Type="'+relType+'officeDocument" Target="word/document.xml"/></Relationships>'],
   ['word/document.xml',header+'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="'+relType.slice(0,-1)+'" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><w:body>'+body+'</w:body></w:document>'],
   ['word/_rels/document.xml.rels',header+relHead+relationships.join('')+'</Relationships>'],...extras
  ],maxBytes);
 }
 function wordGrid(grid,position=''){
  const paragraph=text=>'<w:p><w:r><w:t xml:space="preserve">'+escapeXml(text)+'</w:t></w:r></w:p>';
  let body='';
   body+='<w:tbl><w:tblPr>'+position+'<w:tblW w:w="0" w:type="auto"/><w:tblLayout w:type="fixed"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(k=>'<w:'+k+' w:val="single" w:sz="4"/>').join('')+'</w:tblBorders></w:tblPr><w:tblGrid>'+grid.xs.slice(0,-1).map((x,c)=>'<w:gridCol w:w="'+Math.round((grid.xs[c+1]-x)*20)+'"/>').join('')+'</w:tblGrid>';
   for(let r=0;r<grid.rows;r++){
    body+='<w:tr>';
    const cells=grid.cells.filter(cell=>cell.r0<=r&&cell.r1>=r).sort((a,b)=>a.c0-b.c0);
    for(const cell of cells){
     body+='<w:tc><w:tcPr><w:tcW w:w="'+Math.round((grid.xs[cell.c1+1]-grid.xs[cell.c0])*20)+'" w:type="dxa"/>'+
       (cell.c1>cell.c0?'<w:gridSpan w:val="'+(cell.c1-cell.c0+1)+'"/>':'')+(cell.r1>cell.r0?'<w:vMerge'+(r===cell.r0?' w:val="restart"':'')+'/>':'')+'</w:tcPr>'+
       (r===cell.r0?cell.text.split('\n').map(paragraph).join(''):'<w:p/>')+'</w:tc>';
    }
    body+='</w:tr>';
   }
   body+='</w:tbl>';
   return body;
 }

 function docxGrids(rawPages,rulesByPage){
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>50||rulesByPage?.length!==rawPages.length)throw Error('표 Word는 최대 50쪽입니다.');
  normalizePages(rawPages.map(p=>pageTextFromItems(p.items)));
  const paragraph=text=>'<w:p><w:r><w:t xml:space="preserve">'+escapeXml(text)+'</w:t></w:r></w:p>';
  let body='';
  const parts=splitGridPages(rawPages,rulesByPage);
  rawPages.forEach((page,i)=>{
   const pageParts=parts.filter(part=>part.sourcePage===i||part.sourcePage===undefined&&part.page===page);
   for(const part of pageParts){
   if(!part.rules){for(const line of pageTextFromItems(part.page.items).split('\n'))body+=paragraph(line);continue;}
   const grid=gridModel(part.page,part.rules);
   const before=grid.outside.filter(item=>item.transform[5]>grid.ys[0]),after=grid.outside.filter(item=>item.transform[5]<=grid.ys[0]);
   for(const line of pageTextFromItems(before).split('\n'))if(line)body+=paragraph(line);
   body+=wordGrid(grid)+'<w:p/>';for(const line of pageTextFromItems(after).split('\n'))if(line)body+=paragraph(line);
   }
   const section=wordSection(page);body+=i===rawPages.length-1?section:'<w:p><w:pPr>'+section+'</w:pPr></w:p>';
  });
  return wordPackage(body);
 }

 // Mixed editable export keeps text as Word text boxes and grid cells, and
 // embeds each original decoded raster separately. Fonts/reading flow remain
 // estimates; no screenshot page or invisible duplicate text layer is used.
 function docxMixed(rawPages,rulesByPage){
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>30)throw Error('혼합 Word는 최대 30쪽입니다.');
  normalizePages(rawPages.map(p=>pageTextFromItems(p.items)));
  const parts=splitGridPages(rawPages,rulesByPage),extras=[],relationships=[];
  let body='',id=0,imageBytes=0;
  const emu=v=>String(Math.round(v*12700));
  const anchor=(x,y,w,h,graphic,background=false)=>{
   if(![x,y,w,h].every(Number.isFinite)||w<=0||h<=0||[x,y,w,h].some(v=>Math.abs(v)>1584))throw Error('Word 객체 좌표가 지원 범위를 벗어났습니다.');
   if(++id>12000)throw Error('Word 개별 객체 수가 12000개를 초과했습니다.');
   return '<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="'+id+'" behindDoc="'+(background?'1':'0')+'" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>'+emu(x)+'</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>'+emu(y)+'</wp:posOffset></wp:positionV><wp:extent cx="'+emu(w)+'" cy="'+emu(h)+'"/><wp:wrapNone/><wp:docPr id="'+id+'" name="PDF object '+id+'"/><wp:cNvGraphicFramePr/>'+graphic+'</wp:anchor></w:drawing></w:r>';
  };
  rawPages.forEach((page,pageIndex)=>{
   if((page.rotation||0)%360!==0)throw Error('회전된 페이지의 혼합 Word는 지원하지 않습니다.');
   const section=wordSection(page),runs=[];
   for(const image of page.images||[]){
    if(!(image.png instanceof Uint8Array)||image.png.length<32||!image.png.subarray(0,8).every((v,i)=>v===[137,80,78,71,13,10,26,10][i]))throw Error('혼합 Word 내장 PNG 형식이 올바르지 않습니다.');
    imageBytes+=image.png.length;if(extras.length>=40||imageBytes>60*1024*1024)throw Error('혼합 Word는 최대 40개 이미지·60MiB를 지원합니다.');
    const number=extras.length+1,rid='rImage'+number;
    extras.push(['word/media/image'+number+'.png',image.png]);relationships.push('<Relationship Id="'+rid+'" Type="'+relType+'image" Target="media/image'+number+'.png"/>');
    const cx=emu(image.width),cy=emu(image.height),graphic='<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="'+number+'" name="PDF image '+number+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="'+rid+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm'+(image.flipH?' flipH="1"':'')+(image.flipV?' flipV="1"':'')+'><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>';
    runs.push(anchor(image.x,page.height-image.y-image.height,image.width,image.height,graphic,true));
   }
   const tableParts=parts.filter(part=>part.sourcePage===pageIndex),tableItems=new Set();
   const tables=[];
   for(const part of tableParts){
    const grid=gridModel(part.page,part.rules);for(const cell of grid.cells)for(const item of cell.items)tableItems.add(item);
    const position='<w:tblpPr w:leftFromText="0" w:rightFromText="0" w:topFromText="0" w:bottomFromText="0" w:vertAnchor="page" w:horzAnchor="page" w:tblpX="'+Math.round(grid.xs[0]*20)+'" w:tblpY="'+Math.round((page.height-grid.ys[0])*20)+'"/>';
    tables.push(wordGrid(grid,position));
   }
   for(const item of page.items){
    if(!item?.str||tableItems.has(item))continue;
    const t=item.transform;
    if(!Array.isArray(t)||t.length!==6||![...t,item.width].every(Number.isFinite)||Math.abs(t[1])>.1||Math.abs(t[2])>.1||t[0]<=0||t[3]<=0||item.dir&&item.dir!=='ltr')throw Error('회전·세로쓰기 텍스트의 Word 혼합 배치를 처리할 수 없습니다.');
    const size=Math.abs(t[3]);if(size<1||size>144)throw Error('Word 글자 크기가 지원 범위를 벗어났습니다.');
    const style=page.styles?.[item.fontName]||{},family=/serif/i.test(style.fontFamily||'')&&!/sans/i.test(style.fontFamily||'')?'바탕':'맑은 고딕';
    const escaped=escapeXml(item.str),paragraph='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="'+Math.round(size*20)+'" w:lineRule="exact"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="'+family+'" w:hAnsi="'+family+'" w:eastAsia="'+family+'"/><w:sz w:val="'+Math.round(size*2)+'"/></w:rPr><w:t xml:space="preserve">'+escaped+'</w:t></w:r></w:p>';
    const width=Math.max(1,item.width),height=size*1.3;
    const graphic='<a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+emu(width)+'" cy="'+emu(height)+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>'+paragraph+'</w:txbxContent></wps:txbx><wps:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic>';
    runs.push(anchor(t[4],page.height-t[5]-size*.85,width,height,graphic));
   }
   body+='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr>'+runs.join('')+'</w:p>'+tables.join('');
   body+=pageIndex===rawPages.length-1?section:'<w:p><w:pPr>'+section+'</w:pPr></w:p>';
  });
  return wordPackage(body,extras,relationships,true,64*1024*1024);
 }

 function docxVisual(rawPages){
  if(!Array.isArray(rawPages)||!rawPages.length||rawPages.length>30)throw Error('원본 모양 Word는 최대 30쪽입니다.');
  const extras=[],relationships=[];let body='',total=0;
  rawPages.forEach((page,i)=>{
   const data=page.png;
   if(!(data instanceof Uint8Array)||data.length<32||data[0]!==137||data[1]!==80||data[2]!==78||data[3]!==71)throw Error('페이지 PNG 이미지가 올바르지 않습니다.');
   total+=data.length;if(total>60*1024*1024)throw Error('Word 페이지 이미지가 60MiB를 초과했습니다.');
   const section=wordSection(page),id=i+1,cx=Math.round(page.width*12700),cy=Math.round(page.height*12700);
   extras.push(['word/media/page'+id+'.png',data]);relationships.push('<Relationship Id="rId'+id+'" Type="'+relType+'image" Target="media/page'+id+'.png"/>');
   body+='<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="1" w:lineRule="exact"/></w:pPr><w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:wrapNone/><wp:docPr id="'+id+'" name="PDF page '+id+'"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="'+id+'" name="page'+id+'.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId'+id+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>';
   body+=i===rawPages.length-1?section:'<w:p><w:pPr>'+section+'</w:pPr></w:p>';
  });
  return wordPackage(body,extras,relationships,true,64*1024*1024);
 }
 return {docx,docxLayout,docxTwoColumn,docxThreeColumn,docxAutoColumns,xlsx,xlsxColumns,xlsxPerPage,normalizePages,pageTextFromItems,gridModel,splitGridPages,xlsxGrids,docxGrids,docxMixed,docxVisual};
});
