// USR-01/02: conservative transfer of standard PDF outline destinations.
// Works only with direct page targets; never silently drop unsupported actions.
(function(root,factory){
 const api=factory();
 if(typeof module==='object'&&module.exports)module.exports=api;
 if(root)root.SunriseOutlineTransfer=api;
})(typeof globalThis!=='undefined'?globalThis:undefined,function(){
 'use strict';
 const MAX=2000,MAX_DEPTH=4;
 function read(pdf,lib){
  const {PDFName,PDFRef,PDFDict,PDFArray,PDFNumber,PDFString,PDFHexString}=lib;
  const n=PDFName.of,ctx=pdf.context,rootRef=pdf.catalog.get(n('Outlines'));
  if(!rootRef)return [];
  if(!(rootRef instanceof PDFRef))throw Error('원본 PDF 북마크 루트 참조를 지원하지 않습니다.');
  const root=ctx.lookup(rootRef);
  if(!(root instanceof PDFDict))throw Error('원본 PDF 북마크 루트 구조가 올바르지 않습니다.');
  const pageRefs=new Map(pdf.getPages().map((page,index)=>[page.ref.toString(),index]));
  const visited=new Set(),items=[];
  const loadRef=ref=>{
   if(!(ref instanceof PDFRef))throw Error('원본 북마크 참조가 올바르지 않습니다.');
   const obj=ctx.lookup(ref);
   if(!(obj instanceof PDFDict))throw Error('원본 북마크 객체가 올바르지 않습니다.');
   return obj;
  };
  const destination=dict=>{
   const action=dict.get(n('A')),direct=dict.get(n('Dest'));
   if(action&&direct)throw Error('모호한 북마크 목적지를 가진 문서는 지원하지 않습니다.');
   let value=direct;
   if(action){
    const d=ctx.lookup(action);
    if(!(d instanceof PDFDict)||d.get(n('S'))?.toString()!=='/GoTo')
     throw Error('외부 링크·스크립트 등 지원하지 않는 북마크 동작이 있습니다.');
    value=d.get(n('D'));
   }
   if(!value)throw Error('목적지가 없는 북마크는 자동 이식할 수 없습니다.');
   const dest=ctx.lookup(value);
   if(!(dest instanceof PDFArray)||dest.size()<2)
    throw Error('이름 기반 또는 특수 목적지의 북마크를 자동 이식할 수 없습니다.');
   const first=dest.get(0);
   if(first instanceof PDFRef){
    const page=pageRefs.get(first.toString());
    if(page===undefined)throw Error('존재하지 않는 페이지를 가리키는 북마크가 있습니다.');
    return page;
   }
   if(first instanceof PDFNumber){
    const page=first.asNumber();
    if(Number.isSafeInteger(page)&&page>=0&&page<pdf.getPageCount())return page;
   }
   throw Error('북마크의 페이지 참조가 올바르지 않습니다.');
  };
  const visit=(first,last,parentRef,level)=>{
   if(!first&&!last)return;
   if(!first||!last||level>=MAX_DEPTH)throw Error('북마크 계층 또는 깊이를 지원하지 않습니다.');
   let ref=first,previous=null,lastSeen=null;
   while(ref){
    const key=ref.toString();
    if(visited.has(key)||visited.size>=MAX)throw Error('순환 또는 과다한 북마크를 지원하지 않습니다.');
    visited.add(key);
    const dict=loadRef(ref);
    if(dict.get(n('Parent'))?.toString()!==parentRef.toString())
     throw Error('북마크 상위 참조가 올바르지 않습니다.');
    if((dict.get(n('Prev'))?.toString()||null)!==(previous?.toString()||null))
     throw Error('북마크 형제 참조가 올바르지 않습니다.');
    const title=ctx.lookup(dict.get(n('Title')));
    if(!(title instanceof PDFString||title instanceof PDFHexString))
     throw Error('북마크 제목을 읽을 수 없습니다.');
    const label=title.decodeText();
    if(!label.trim()||label.length>500)throw Error('북마크 제목 길이를 지원하지 않습니다.');
    items.push({title:label,page:destination(dict),level});
    visit(dict.get(n('First')),dict.get(n('Last')),ref,level+1);
    previous=ref;lastSeen=ref;ref=dict.get(n('Next'));
   }
   if(lastSeen?.toString()!==last.toString())throw Error('북마크 마지막 참조가 올바르지 않습니다.');
  };
  visit(root.get(n('First')),root.get(n('Last')),rootRef,0);
  return items;
 }
 function subset(items,sourceIndices,offset=0){
  if(!Array.isArray(items)||!Array.isArray(sourceIndices)||!Number.isSafeInteger(offset)||offset<0)
   throw Error('북마크 페이지 매핑이 올바르지 않습니다.');
  const map=new Map();
  sourceIndices.forEach((page,index)=>{
   if(!Number.isSafeInteger(page)||page<0||map.has(page))
    throw Error('중복되거나 잘못된 추출 페이지가 있습니다.');
   map.set(page,index+offset);
  });
  const result=[];
  for(const item of items){
   if(!map.has(item.page))continue;
   const level=Math.min(item.level,result.length?result[result.length-1].level+1:0);
   result.push({title:item.title,page:map.get(item.page),level});
  }
  return result;
 }
 return {read,subset};
});
